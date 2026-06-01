'use strict'

// ─── Constants ────────────────────────────────────────────────────────────────

const BUBBLE_W   = 310
const CREATURE_H = 100

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  config:           {},
  blindspots:       {},
  session:          {},
  bubbleOpen:       false,
  bubbleMode:       null,   // 'onboarding' | 'idle' | 'nudge' | 'settings'
  pendingNudge:        null,   // category id waiting for user
  pendingNudgeSnippet: null,   // excerpt that triggered the nudge
  pendingNudgeSource:  null,   // 'terminal' | 'clipboard' | 'manual' | 'heartbeat'
  activeNudge:             null,   // category id currently in bubble
  activeNudgeExplanation:  null,   // Claude-generated explanation for current nudge
  exchangeCount:    0,
  isThinking:       false,
  clipboardEnabled: false,
  needsPermission:  false,
  updateReady:      false
}

const $ = id => document.getElementById(id)

// ─── Creature state ───────────────────────────────────────────────────────────

function setCreatureState (s) {
  const sprite = $('nanobot')
  if (sprite) sprite.setAttribute('class', s)   // 'idle' | 'think' | 'nudge' | 'happy'

  const dot = $('nudge-dot')
  if (dot) dot.classList.toggle('visible', s === 'nudge')

  const sd = $('status-dot')
  if (sd) {
    sd.className = ''
    if (s === 'think')  sd.classList.add('thinking')
    else if (s !== 'nudge') sd.classList.add('watching')
  }
}

// ─── Bubble management ────────────────────────────────────────────────────────

async function openBubble (html) {
  const body = $('bubble-body')
  if (!body) return
  body.innerHTML = html
  const bubble = $('bubble')
  bubble.classList.remove('hidden')
  state.bubbleOpen = true
  // Measure actual rendered height after layout
  await new Promise(resolve => requestAnimationFrame(resolve))
  const bubbleH = bubble.offsetHeight
  await window.nano.resizeWindow({ width: BUBBLE_W, height: bubbleH + 8 + CREATURE_H })
}

async function closeBubble () {
  // If dismissing a nudge early, still mark it seen so it doesn't loop
  if (state.activeNudge) {
    if (!state.session.resolvedCategories) state.session.resolvedCategories = []
    if (!state.session.resolvedCategories.includes(state.activeNudge.id)) {
      state.session.resolvedCategories.push(state.activeNudge.id)
      await window.nano.saveSession(state.session)
    }
  }
  const bubble = $('bubble')
  if (bubble) bubble.classList.add('hidden')
  const body = $('bubble-body')
  if (body) body.innerHTML = ''
  state.bubbleOpen = false
  state.bubbleMode = null
  state.activeNudge = null
  state.activeNudgeExplanation = null
  await window.nano.resizeWindow({ width: CREATURE_H, height: CREATURE_H })
}

// ─── Drag (OpenClippy pattern) ────────────────────────────────────────────────

function initDrag () {
  const creature = $('creature')
  if (!creature) return

  let dragStartX, dragStartY, winStartX, winStartY, isDragging = false

  creature.addEventListener('mousedown', async e => {
    if (e.button !== 0) return
    e.preventDefault()
    dragStartX = e.screenX
    dragStartY = e.screenY
    const pos = await window.nano.getWindowPosition()
    winStartX = pos.x
    winStartY = pos.y
    isDragging = false
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })

  function onMove (e) {
    const dx = e.screenX - dragStartX
    const dy = e.screenY - dragStartY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging = true
    if (isDragging) window.nano.setWindowPosition({ x: winStartX + dx, y: winStartY + dy })
  }

  function onUp () {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (!isDragging) handleCreatureClick()
    isDragging = false
  }

  creature.addEventListener('contextmenu', e => {
    e.preventDefault()
    if (state.bubbleMode === 'settings') closeBubble()
    else { closeBubble().then(() => openSettingsBubble()) }
  })
}

function handleCreatureClick () {
  if (state.isThinking) return
  if (state.bubbleOpen) { closeBubble(); return }
  if (state.pendingNudge) { openNudgeBubble(state.pendingNudge); return }
  openIdleBubble()
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init () {
  state.config     = await window.nano.getConfig()
  state.blindspots = await window.nano.getBlindspots()
  state.session    = await window.nano.getSession()

  initDrag()
  bindIpcListeners()
  initUpdaterUI()

  if (!state.config.onboardingComplete || !state.config.apiKey) {
    openOnboardingBubble()
  } else {
    setCreatureState('idle')
    await requestTerminalWatch()
    setTimeout(() => {
      if (state.config.projectDescription) {
        runScan(state.config.projectDescription, 'project_description')
      }
    }, 1200)
  }
}

// ─── Terminal watcher ─────────────────────────────────────────────────────────

async function requestTerminalWatch () {
  const hasPermission = await window.nano.checkAccessibility()
  if (hasPermission) {
    await window.nano.startTerminalWatcher()
  } else {
    state.needsPermission = true
  }
}

// ─── IPC listeners ────────────────────────────────────────────────────────────

function bindIpcListeners () {
  window.nano.onTerminalContent(({ text }) => {
    if (text && text.length > 50) runScan(text, 'terminal')
  })

  window.nano.onClipboardChanged(({ text }) => {
    if (state.clipboardEnabled && text && text.length > 50) runScan(text, 'clipboard')
  })

  window.nano.onSessionReset(() => {
    state.session = {
      projectDescription: state.config.projectDescription,
      exchanges: [],
      resolvedCategories: [],
      nudgeCount: { critical: 0, high: 0, medium: 0, low: 0 },
      summary: '',
      startedAt: new Date().toISOString()
    }
    state.pendingNudge = null
    setCreatureState('idle')
    if (state.bubbleOpen) closeBubble()
  })

  window.nano.onHeartbeat(() => {
    if (state.pendingNudge || state.isThinking || state.bubbleOpen) return
    if (!state.session.exchanges || state.session.exchanges.length === 0) return
    const ctx = `Project: ${state.config.projectDescription}\nSession: ${state.session.summary || 'just started'}`
    runScan(ctx, 'heartbeat')
  })
}

// ─── Onboarding bubble ────────────────────────────────────────────────────────

function openOnboardingBubble () {
  state.bubbleMode = 'onboarding'
  const html = `
    <h2 class="ob-title">Hi, I'm Nano 👋</h2>
    <p class="ob-sub">I watch your Claude Code and Codex sessions and flag blindspots you didn't know to ask about. Set me up in 2 minutes.</p>
    <div class="field">
      <label class="field-label">Anthropic API key</label>
      <input type="password" class="field-input" id="ob-key" placeholder="sk-ant-..." />
      <button class="field-link" id="ob-get-key">Get a free key →</button>
    </div>
    <div class="field">
      <label class="field-label">What are you building?</label>
      <textarea class="field-textarea" id="ob-project" rows="2" placeholder="e.g. a task manager with React and a Node backend..."></textarea>
    </div>
    <div class="field">
      <label class="field-label">Your experience level</label>
      <div class="radio-row">
        <label class="radio-opt"><input type="radio" name="ob-skill" value="novice" checked /> Novice</label>
        <label class="radio-opt"><input type="radio" name="ob-skill" value="some" /> Some coding</label>
        <label class="radio-opt"><input type="radio" name="ob-skill" value="dev" /> Developer</label>
      </div>
    </div>
    <p class="err-msg" id="ob-err"></p>
    <button class="btn-primary" id="ob-submit">Start watching →</button>
  `
  openBubble(html)
  requestAnimationFrame(() => {
    $('ob-get-key')?.addEventListener('click', () => {
      window.nano.openExternal('https://console.anthropic.com/settings/keys')
    })
    $('ob-submit')?.addEventListener('click', onboardingSubmit)
  })
}

async function onboardingSubmit () {
  const apiKey  = $('ob-key')?.value.trim()
  const project = $('ob-project')?.value.trim()
  const skill   = document.querySelector('input[name="ob-skill"]:checked')?.value || 'novice'
  const errEl   = $('ob-err')
  const btn     = $('ob-submit')

  if (errEl) errEl.style.display = 'none'
  if (!apiKey)  { $('ob-key')?.classList.add('error'); return }
  if (!project) { $('ob-project')?.classList.add('error'); return }

  btn.textContent = 'Connecting...'
  btn.disabled = true

  const result = await window.nano.chat({
    messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    systemPrompt: 'Reply only: ready',
    apiKey
  })

  if (result.error) {
    btn.textContent = 'Start watching →'
    btn.disabled = false
    if (errEl) { errEl.textContent = 'Could not connect: ' + result.error; errEl.style.display = 'block' }
    return
  }

  state.config = await window.nano.saveConfig({
    apiKey, projectDescription: project, skillLevel: skill, onboardingComplete: true
  })

  state.session = {
    projectDescription: project,
    exchanges: [],
    resolvedCategories: [],
    nudgeCount: { critical: 0, high: 0, medium: 0, low: 0 },
    summary: '',
    startedAt: new Date().toISOString()
  }
  await window.nano.saveSession(state.session)

  await closeBubble()
  setCreatureState('happy')
  setTimeout(() => setCreatureState('idle'), 1500)

  await requestTerminalWatch()
  setTimeout(() => runScan(project, 'project_description'), 1000)
}

// ─── Idle bubble ─────────────────────────────────────────────────────────────

function openIdleBubble () {
  state.bubbleMode = 'idle'

  const permHtml = state.needsPermission ? `
    <div class="perm-banner">
      <strong>Terminal access needed</strong> — lets me watch your Claude Code sessions automatically.
      <div class="perm-actions">
        <button class="btn-perm" id="idle-grant">Enable in Settings</button>
        <button class="btn-perm-dismiss" id="idle-skip-perm">Skip</button>
      </div>
    </div>` : ''

  const updateHtml = state.updateReady ? `
    <div class="update-banner">
      <span>Update ready</span>
      <button class="btn-update" id="idle-update">Restart</button>
    </div>` : ''

  const html = `
    <button class="bubble-close" id="idle-close">✕</button>
    ${updateHtml}
    ${permHtml}
    <p class="idle-status">Watching your terminal. Paste to scan manually:</p>
    <textarea class="scan-ta" id="idle-ta" placeholder="Paste code or text here..."></textarea>
    <div class="scan-row">
      <button class="btn-scan" id="idle-scan">Scan</button>
      <label class="clip-toggle">
        <input type="checkbox" id="idle-clip" ${state.clipboardEnabled ? 'checked' : ''} />
        Auto-watch clipboard
      </label>
    </div>
    <div class="idle-footer">
      <button class="btn-secondary" id="idle-settings" style="font-size:11px;padding:4px 10px;">⚙ Settings</button>
    </div>
  `
  openBubble(html)
  requestAnimationFrame(() => {
    $('idle-close')?.addEventListener('click', closeBubble)
    $('idle-scan')?.addEventListener('click', handleIdleScan)
    $('idle-ta')?.addEventListener('keydown', e => { if (e.key === 'Enter' && e.metaKey) handleIdleScan() })
    $('idle-clip')?.addEventListener('change', async e => {
      state.clipboardEnabled = e.target.checked
      await window.nano.setClipboardWatcher(e.target.checked)
    })
    $('idle-settings')?.addEventListener('click', () => closeBubble().then(() => openSettingsBubble()))
    $('idle-grant')?.addEventListener('click', async () => {
      await window.nano.requestAccessibility()
      window.nano.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
      state.needsPermission = false
      closeBubble()
    })
    $('idle-skip-perm')?.addEventListener('click', () => {
      state.needsPermission = false
      closeBubble().then(() => openIdleBubble())
    })
    $('idle-update')?.addEventListener('click', () => window.updater?.installUpdate())
  })
}

async function handleIdleScan () {
  const ta = $('idle-ta')
  const text = ta?.value.trim()
  if (!text) return
  ta.value = ''
  await closeBubble()
  await runScan(text, 'manual')
}

// ─── Nudge bubble ─────────────────────────────────────────────────────────────

async function openNudgeBubble (categoryId) {
  const cat = getCategoryById(categoryId)
  if (!cat) return

  state.bubbleMode  = 'nudge'
  state.activeNudge = cat
  state.exchangeCount = 0
  const snippet = state.pendingNudgeSnippet
  const source  = state.pendingNudgeSource
  state.pendingNudge        = null
  state.pendingNudgeSnippet = null
  state.pendingNudgeSource  = null
  setCreatureState('idle')

  const sourceLabels = {
    terminal:            'Terminal',
    clipboard:           'Clipboard',
    manual:              'Manual paste',
    heartbeat:           'Session context',
    project_description: 'Project description'
  }
  const sourceLabel = sourceLabels[source] || source || 'scan'

  const snippetHtml = snippet ? `
    <div class="nudge-snippet">
      <span class="nudge-snippet-label">spotted in ${sourceLabel}</span>
      <code class="nudge-snippet-text">${snippet.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>
    </div>` : ''

  const html = `
    <button class="bubble-close" id="nudge-close">✕</button>
    <button class="back-btn" id="nudge-back">← back to scan</button>
    ${snippetHtml}
    <div id="nudge-explanation">
      <div class="chat-msg"><div class="thinking-dots"><span></span><span></span><span></span></div></div>
    </div>
    <div id="nudge-chat"></div>
    <div class="reply-row" id="nudge-reply-row" style="display:none">
      <input type="text" class="reply-input" id="nudge-input" placeholder="Reply..." />
      <button class="btn-send" id="nudge-send">Send</button>
    </div>
  `
  await openBubble(html)

  requestAnimationFrame(() => {
    $('nudge-close')?.addEventListener('click', closeBubble)
    $('nudge-back')?.addEventListener('click', () => closeBubble().then(() => openIdleBubble()))
  })

  // Ask Claude to explain this specific detection in context
  const skillLabel = { novice: 'a complete non-developer', some: 'someone with some coding experience', dev: 'a developer' }[state.config.skillLevel] || 'a non-developer'
  const snippetLine = snippet ? `\n\nThe exact line that caught my attention:\n"${snippet}"` : ''

  const result = await window.nano.chat({
    messages: [{
      role: 'user',
      content: `I'm building: ${state.config.projectDescription}${snippetLine}

You flagged this as a "${cat.name}" concern (${cat.severity} severity).

In 2–3 short sentences, tell me:
1. What specifically is wrong with what I wrote above
2. What could go wrong because of it

Then ask me ONE follow-up question to understand my situation better so you can give me the right fix.

I am ${skillLabel} — no jargon.`
    }],
    systemPrompt: buildSystemPrompt()
  })

  const expl = $('nudge-explanation')
  if (expl) {
    expl.innerHTML = result.error
      ? `<div class="nudge-plain">${cat.explanation.plain}<br><br><em>${cat.explanation.follow_up_question}</em></div>`
      : `<div class="nudge-plain">${result.content}</div>`
  }

  // Store the generated explanation for follow-up context
  state.activeNudgeExplanation = result.content || cat.explanation.plain

  // Resize to fit new content then show reply input
  await new Promise(resolve => requestAnimationFrame(resolve))
  const bubbleH = $('bubble')?.offsetHeight || 400
  await window.nano.resizeWindow({ width: BUBBLE_W, height: bubbleH + 8 + CREATURE_H })

  const replyRow = $('nudge-reply-row')
  if (replyRow) replyRow.style.display = 'flex'

  requestAnimationFrame(() => {
    const sendFn = () => handleNudgeReply(cat)
    $('nudge-send')?.addEventListener('click', sendFn)
    $('nudge-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendFn() })
    setTimeout(() => $('nudge-input')?.focus(), 200)
  })
}

async function handleNudgeReply (cat) {
  const input = $('nudge-input')
  const userText = input?.value.trim()
  if (!userText || state.isThinking) return

  state.exchangeCount++
  state.isThinking = true
  setCreatureState('think')

  const chat = $('nudge-chat')
  const replyRow = $('nudge-reply-row')
  if (replyRow) replyRow.style.display = 'none'

  if (chat) {
    const userEl = document.createElement('div')
    userEl.className = 'chat-msg user'
    userEl.textContent = userText
    chat.appendChild(userEl)

    const thinkEl = document.createElement('div')
    thinkEl.className = 'chat-msg'
    thinkEl.id = 'nudge-thinking'
    thinkEl.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>'
    chat.appendChild(thinkEl)
  }

  const isFinal = state.exchangeCount >= 2
  const messages = [{
    role: 'user',
    content: `Project: ${state.config.projectDescription}
Category: ${cat.name}
My explanation to them: "${state.activeNudgeExplanation || cat.explanation.plain}"
User replied: "${userText}"

Exchange ${state.exchangeCount} of 2. ${isFinal ? 'FINAL exchange — give a brief reply only, then stop.' : 'Give a brief, specific reply based on what they said.'}`
  }]

  const result = await window.nano.chat({ messages, systemPrompt: buildSystemPrompt() })
  $('nudge-thinking')?.remove()

  state.isThinking = false
  setCreatureState('idle')

  if (result.error) {
    const errEl = document.createElement('div')
    errEl.className = 'chat-msg'
    errEl.style.color = 'var(--danger)'
    errEl.textContent = 'API error — check your connection.'
    chat?.appendChild(errEl)
    if (replyRow) { replyRow.style.display = 'flex'; input.value = '' }
    return
  }

  const respEl = document.createElement('div')
  respEl.className = 'chat-msg'
  respEl.textContent = result.content
  chat?.appendChild(respEl)

  state.session.exchanges.push({
    role: 'assistant', content: result.content, categoryId: cat.id, timestamp: Date.now()
  })

  if (isFinal) {
    const prompt = buildHandoffPrompt(cat)
    const handoffEl = document.createElement('div')
    handoffEl.innerHTML = `
      <div class="handoff-box">
        <div class="handoff-head">
          <span class="handoff-label">Take to your main chat</span>
          <button class="btn-copy" id="nudge-copy">Copy</button>
        </div>
        <div class="handoff-text">${prompt}</div>
      </div>
      <p class="watching-line">I'll keep watching.</p>
    `
    chat?.appendChild(handoffEl)

    requestAnimationFrame(() => {
      $('nudge-copy')?.addEventListener('click', () => {
        navigator.clipboard.writeText(prompt)
        const btn = $('nudge-copy')
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { if ($('nudge-copy')) $('nudge-copy').textContent = 'Copy' }, 2000) }
      })
    })

    if (!state.session.resolvedCategories) state.session.resolvedCategories = []
    if (!state.session.resolvedCategories.includes(cat.id)) {
      state.session.resolvedCategories.push(cat.id)
    }
    await new Promise(resolve => requestAnimationFrame(resolve))
    const bubbleH = $('bubble')?.offsetHeight || 500
    window.nano.resizeWindow({ width: BUBBLE_W, height: bubbleH + 8 + CREATURE_H })
  } else {
    if (replyRow) { replyRow.style.display = 'flex'; input.value = '' }
    setTimeout(() => $('nudge-input')?.focus(), 100)
  }

  await window.nano.saveSession(state.session)
}

// ─── Settings bubble ──────────────────────────────────────────────────────────

function openSettingsBubble () {
  state.bubbleMode = 'settings'
  const cfg = state.config
  const html = `
    <button class="bubble-close" id="set-close">✕</button>
    <h3 class="settings-title">Settings</h3>
    <div class="field">
      <label class="field-label">API key</label>
      <input type="password" class="field-input" id="set-key" value="${cfg.apiKey || ''}" />
    </div>
    <div class="field">
      <label class="field-label">What are you building?</label>
      <textarea class="field-textarea" id="set-project" rows="2">${cfg.projectDescription || ''}</textarea>
    </div>
    <div class="field">
      <label class="field-label">Experience level</label>
      <div class="radio-row">
        <label class="radio-opt"><input type="radio" name="set-skill" value="novice" ${cfg.skillLevel === 'novice' ? 'checked' : ''} /> Novice</label>
        <label class="radio-opt"><input type="radio" name="set-skill" value="some" ${cfg.skillLevel === 'some' ? 'checked' : ''} /> Some coding</label>
        <label class="radio-opt"><input type="radio" name="set-skill" value="dev" ${cfg.skillLevel === 'dev' ? 'checked' : ''} /> Developer</label>
      </div>
    </div>
    <button class="btn-primary" id="set-save">Save</button>
    <p class="settings-section">Session</p>
    <button class="btn-danger" id="set-reset">Start new session</button>
  `
  openBubble(html)
  requestAnimationFrame(() => {
    $('set-close')?.addEventListener('click', closeBubble)
    $('set-save')?.addEventListener('click', saveSettings)
    $('set-reset')?.addEventListener('click', resetSession)
  })
}

async function saveSettings () {
  const apiKey  = $('set-key')?.value.trim()
  const project = $('set-project')?.value.trim()
  const skill   = document.querySelector('input[name="set-skill"]:checked')?.value || 'novice'
  state.config = await window.nano.saveConfig({ apiKey, projectDescription: project, skillLevel: skill })
  await closeBubble()
  setCreatureState('happy')
  setTimeout(() => setCreatureState('idle'), 1000)
}

async function resetSession () {
  state.session = {
    projectDescription: state.config.projectDescription,
    exchanges: [], resolvedCategories: [],
    nudgeCount: { critical: 0, high: 0, medium: 0, low: 0 },
    summary: '', startedAt: new Date().toISOString()
  }
  state.pendingNudge = null
  await window.nano.saveSession(state.session)
  await closeBubble()
  setCreatureState('idle')
}

// ─── Scan engine ─────────────────────────────────────────────────────────────

async function runScan (text, source) {
  if (state.isThinking) return
  state.isThinking = true
  setCreatureState('think')

  try {
    state.session.exchanges.push({ role: 'user', content: text, source, timestamp: Date.now() })

    const triggered = detectTriggeredCategories(text)

    if (triggered.length === 0) {
      await claudeSoftScan(text, source)
    } else {
      const best = pickBestNudge(triggered)
      if (best) setPendingNudge(best.id, best.severity, extractTriggerSnippet(text, best), source)
    }

    if (state.session.exchanges.length % 5 === 0) await summarizeSession()
    await window.nano.saveSession(state.session)
  } catch (err) {
    console.error('runScan:', err)
  } finally {
    state.isThinking = false
    if (!state.pendingNudge) setCreatureState('idle')
  }
}

function setPendingNudge (categoryId, severity, snippet = null, source = null) {
  if (state.session.resolvedCategories?.includes(categoryId)) return
  state.pendingNudge = categoryId
  state.pendingNudgeSnippet = snippet
  state.pendingNudgeSource = source
  setCreatureState('nudge')
  bumpNudgeCount(severity)
  // Auto-open nudge bubble after a brief bounce animation
  setTimeout(() => {
    if (state.pendingNudge === categoryId && !state.bubbleOpen) {
      openNudgeBubble(categoryId)
    }
  }, 700)
}

// ─── Snippet extraction ───────────────────────────────────────────────────────

function extractTriggerSnippet (text, cat) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3)

  // Find the most relevant line by keyword match
  for (const kw of (cat.triggers.keywords || [])) {
    const line = lines.find(l => l.toLowerCase().includes(kw.toLowerCase()))
    if (line) return line.slice(0, 120)
  }

  // Fall back to regex pattern match
  for (const pattern of (cat.triggers.code_patterns || [])) {
    try {
      const match = text.match(new RegExp(pattern, 'im'))
      if (match) return match[0].trim().split('\n')[0].slice(0, 120)
    } catch {}
  }

  // Last resort: first non-trivial line of the text
  return lines[0]?.slice(0, 120) || null
}

// ─── Trigger detection ────────────────────────────────────────────────────────

function detectTriggeredCategories (text) {
  const lower = text.toLowerCase()
  const triggered = []

  state.blindspots.categories?.forEach(cat => {
    if (state.session.resolvedCategories?.includes(cat.id)) return
    let score = 0
    cat.triggers.keywords?.forEach(kw => { if (lower.includes(kw.toLowerCase())) score += 2 })
    cat.triggers.code_patterns?.forEach(p => {
      try { if (new RegExp(p, 'i').test(text)) score += 3 } catch {}
    })
    if (score > 0) {
      cat.triggers.regex_absent?.forEach(p => {
        try { if (!new RegExp(p, 'i').test(text)) score += 1 } catch {}
      })
    }
    if (score >= 2) triggered.push({ ...cat, score })
  })

  return triggered.sort((a, b) => {
    const ord = { critical: 4, high: 3, medium: 2, low: 1 }
    const d = (ord[b.severity] || 0) - (ord[a.severity] || 0)
    return d !== 0 ? d : b.score - a.score
  })
}

function pickBestNudge (triggered) {
  const caps = state.blindspots.nudge_timing?.max_nudges_per_session_by_severity || {}
  for (const cat of triggered) {
    const sev = cat.severity
    if (sev === 'critical') return cat
    const count = state.session.nudgeCount?.[sev] || 0
    const cap = typeof caps[sev] === 'number' ? caps[sev] : 99
    if (count < cap) return cat
  }
  return null
}

function bumpNudgeCount (severity) {
  if (!state.session.nudgeCount) state.session.nudgeCount = {}
  state.session.nudgeCount[severity] = (state.session.nudgeCount[severity] || 0) + 1
}

// ─── LLM soft scan ────────────────────────────────────────────────────────────

async function claudeSoftScan (text, source = null) {
  const categoryNames = state.blindspots.categories
    ?.filter(c => !state.session.resolvedCategories?.includes(c.id))
    .map(c => `${c.id}: ${c.name}`).join('\n') || ''

  const result = await window.nano.chat({
    messages: [{
      role: 'user',
      content: `Text:\n---\n${text.slice(0, 1500)}\n---\n\nCategories:\n${categoryNames}\n\nReply ONLY with JSON: { "triggered": "<id or null>", "reason": "<one sentence>" }`
    }],
    systemPrompt: buildSystemPrompt()
  })

  if (result.error || !result.content) return
  try {
    const parsed = JSON.parse(result.content.replace(/```json|```/g, '').trim())
    if (parsed.triggered && parsed.triggered !== 'null') {
      const cat = getCategoryById(parsed.triggered)
      if (cat) setPendingNudge(cat.id, cat.severity, parsed.reason || extractTriggerSnippet(text, cat), source)
    }
  } catch {}
}

// ─── Session summarization ────────────────────────────────────────────────────

async function summarizeSession () {
  const recent = state.session.exchanges.slice(-10).map(e => e.content.slice(0, 200)).join('\n---\n')
  const prompt  = state.blindspots.session_summarization?.summary_prompt || ''
  const result  = await window.nano.chat({
    messages: [{ role: 'user', content: `${prompt}\n\nRecent session:\n${recent}` }],
    systemPrompt: 'Summarize developer sessions concisely. Output only 3 bullets.'
  })
  if (result.content) state.session.summary = result.content
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildSystemPrompt () {
  const persona = state.blindspots.system_prompt?.nano_persona || ''
  const rules = [
    ...(state.blindspots.system_prompt?.explanation_rules || []),
    ...(state.blindspots.system_prompt?.hard_rules || []),
    ...(state.blindspots.system_prompt?.handoff_rules || [])
  ].join('\n- ')
  const skillLabel = {
    novice: 'not a developer — avoid all jargon, use plain language and analogies',
    some:   'has some coding experience but is not a professional developer',
    dev:    'is a developer but may lack production experience'
  }[state.config.skillLevel] || 'not a developer'
  return `${persona}\n\nUser ${skillLabel}.\n\nRules:\n- ${rules}\n\nProject: ${state.config.projectDescription || 'unknown'}\nSession: ${state.session.summary || 'just started'}`
}

function buildNudgeContext (cat) {
  return `Category: ${cat.name}\nNudge: "${cat.nudge}"\nExplanation: "${cat.explanation.plain}"\nAnalogy: "${cat.explanation.analogy}"\nFollowup: "${cat.explanation.follow_up_question}"\nProject: ${state.config.projectDescription}`
}

function buildHandoffPrompt (cat) {
  let template = cat.handoff_prompt_template || ''
  const vars = cat.template_variables || {}
  const ctx = {
    project:             state.config.projectDescription || 'my app',
    data_type:           state.session.detectedDataType  || 'my data',
    use_case:            state.session.lastUserReply     || 'I can access it next time',
    number_of_users:     state.session.detectedUserCount || 'multiple people',
    file_or_data:        state.session.detectedFile      || 'the file or data being modified',
    failure_scenario:    state.session.detectedApi       || 'the network request fails',
    field_list:          state.session.detectedFields    || 'All fields',
    sensitive_data_type: state.session.detectedSensitiveData || 'sensitive personal information',
    audience:            state.session.detectedAudience  || 'other people',
    services:            state.session.detectedApis      || 'paid external APIs',
    api_name:            state.session.detectedApis      || 'the external API',
    call_limit:          '10',
    data_collected:      state.session.detectedSensitiveData || 'personal information',
    button_name:         'submit'
  }
  template = template.replace(/\{(\w+)\}/g, (_, key) => ctx[key] || vars[key]?.fallback || key)
  if (state.config.skillLevel === 'novice' && !template.includes('not a developer')) {
    template += ' I am not a developer — please explain as you go.'
  }
  return template
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCategoryById (id) {
  return state.blindspots.categories?.find(c => c.id === id) || null
}

// ─── Auto-updater UI ──────────────────────────────────────────────────────────

function initUpdaterUI () {
  if (!window.updater) return
  window.updater.onUpdateDownloaded(() => {
    state.updateReady = true
  })
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => init())
