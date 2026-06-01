'use strict'

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  config: {},
  blindspots: {},
  session: {},
  currentScreen: 'onboarding',
  activeNudgeId: null,      // category id currently open in detail screen
  exchangeCount: 0,         // per-nudge exchange count (max 2 before handoff)
  isThinking: false,
  nudgeCards: [],           // rendered nudge card ids in the feed
  clipboardEnabled: false
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id)
const screens = {
  onboarding: $('screen-onboarding'),
  main:       $('screen-main'),
  settings:   $('screen-settings'),
  nudge:      $('screen-nudge')
}

// ─── Screen navigation ────────────────────────────────────────────────────────

function showScreen (name) {
  const prev = state.currentScreen
  if (prev === name) return
  if (screens[prev]) {
    screens[prev].classList.remove('active')
    screens[prev].classList.add('slide-out')
    setTimeout(() => screens[prev]?.classList.remove('slide-out'), 300)
  }
  screens[name].classList.add('active')
  state.currentScreen = name
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init () {
  state.config     = await window.nano.getConfig()
  state.blindspots = await window.nano.getBlindspots()
  state.session    = await window.nano.getSession()

  if (state.config.onboardingComplete && state.config.apiKey) {
    applyConfig()
    showScreen('main')
    renderFeed()
    await requestTerminalWatch()
  } else {
    showScreen('onboarding')
  }

  bindEvents()
  bindIpcListeners()
}

// ─── Apply config to UI ───────────────────────────────────────────────────────

function applyConfig () {
  const proj = state.config.projectDescription || 'Your project'
  const pill = $('project-pill-text')
  if (pill) pill.textContent = proj.length > 40 ? proj.slice(0, 38) + '…' : proj
  setStatus('Watching...')
}

// ─── Status ───────────────────────────────────────────────────────────────────

function setStatus (text, type = '') {
  const el = $('header-status')
  if (!el) return
  el.textContent = text
  el.className = 'header-status' + (type ? ' ' + type : '')
}

// ─── Event bindings ───────────────────────────────────────────────────────────

function bindEvents () {
  // Onboarding
  $('btn-start')?.addEventListener('click', onboardingSubmit)
  $('link-get-key')?.addEventListener('click', e => {
    e.preventDefault()
    window.nano.openExternal('https://console.anthropic.com/settings/keys')
  })

  // Header controls
  $('btn-settings')?.addEventListener('click', () => {
    populateSettings()
    showScreen('settings')
  })
  $('btn-minimize')?.addEventListener('click', () => window.nano.minimize())
  $('btn-hide')?.addEventListener('click', () => window.nano.hide())

  // Scan
  $('btn-scan')?.addEventListener('click', handleScan)
  $('scan-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.metaKey) handleScan()
  })

  // Clipboard toggle
  $('toggle-clipboard')?.addEventListener('change', async e => {
    const enabled = e.target.checked
    await window.nano.setClipboardWatcher(enabled)
    state.clipboardEnabled = enabled
  })

  // Settings
  $('btn-back-settings')?.addEventListener('click', () => showScreen('main'))
  $('btn-save-settings')?.addEventListener('click', saveSettings)
  $('btn-new-session')?.addEventListener('click', resetSession)

  // Nudge detail
  $('btn-back-nudge')?.addEventListener('click', () => showScreen('main'))
}

function bindIpcListeners () {
  // Terminal watcher — auto-scan new CLI output
  window.nano.onTerminalContent(({ text, source }) => {
    if (text && text.length > 50) {
      runScan(text, `terminal_${source}`)
    }
  })

  // Clipboard watcher — auto-scan when content changes
  window.nano.onClipboardChanged(({ text }) => {
    if (state.clipboardEnabled && text && text.length > 50) {
      runScan(text, 'clipboard')
    }
  })

  // Session reset from tray
  window.nano.onSessionReset(() => {
    state.session = {
      projectDescription: state.config.projectDescription,
      exchanges: [],
      resolvedCategories: [],
      nudgeCount: { critical: 0, high: 0, medium: 0, low: 0 },
      summary: '',
      startedAt: new Date().toISOString()
    }
    state.nudgeCards = []
    renderFeed()
    setStatus('New session started')
    setTimeout(() => setStatus('Watching...'), 2000)
  })
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

async function onboardingSubmit () {
  const apiKey  = $('input-api-key')?.value.trim()
  const project = $('input-project')?.value.trim()
  const skill   = document.querySelector('input[name="skill"]:checked')?.value || 'novice'

  if (!apiKey) {
    $('input-api-key').style.borderColor = 'var(--danger)'
    return
  }
  if (!project) {
    $('input-project').style.borderColor = 'var(--danger)'
    return
  }

  const btn = $('btn-start')
  btn.textContent = 'Setting up...'
  btn.disabled = true

  // Test the API key before saving
  const result = await window.nano.chat({
    messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    systemPrompt: 'You are a test. Reply only with the single word: ready',
    apiKey
  })

  if (result.error) {
    btn.textContent = 'Start watching →'
    btn.disabled = false
    $('input-api-key').style.borderColor = 'var(--danger)'
    alert('Could not connect: ' + result.error)
    return
  }

  // Save config
  state.config = await window.nano.saveConfig({
    apiKey,
    projectDescription: project,
    skillLevel: skill,
    onboardingComplete: true
  })

  // Init session
  state.session = {
    projectDescription: project,
    exchanges: [],
    resolvedCategories: [],
    nudgeCount: { critical: 0, high: 0, medium: 0, low: 0 },
    summary: '',
    startedAt: new Date().toISOString()
  }
  await window.nano.saveSession(state.session)

  applyConfig()
  showScreen('main')
  renderFeed()

  // Request accessibility permission for terminal watching
  await requestTerminalWatch()

  // Fire an opening scan on the project description itself
  setTimeout(() => runScan(project, 'project_description'), 800)
}

async function requestTerminalWatch () {
  const hasPermission = await window.nano.checkAccessibility()
  if (hasPermission) {
    await window.nano.startTerminalWatcher()
    setStatus('Watching terminal...')
    return
  }

  // Show inline banner instead of blocking alert
  const banner = $('accessibility-banner')
  if (banner) banner.style.display = 'block'

  $('btn-grant-access')?.addEventListener('click', async () => {
    await window.nano.requestAccessibility()
    window.nano.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    if (banner) banner.style.display = 'none'
    setStatus('Restart app after granting access')
  })

  $('btn-dismiss-access')?.addEventListener('click', () => {
    if (banner) banner.style.display = 'none'
  })
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function populateSettings () {
  const k = $('settings-api-key')
  const p = $('settings-project')
  if (k) k.value = state.config.apiKey || ''
  if (p) p.value = state.config.projectDescription || ''
  const skill = state.config.skillLevel || 'novice'
  const radio = document.querySelector(`input[name="skill-settings"][value="${skill}"]`)
  if (radio) radio.checked = true
}

async function saveSettings () {
  const apiKey  = $('settings-api-key')?.value.trim()
  const project = $('settings-project')?.value.trim()
  const skill   = document.querySelector('input[name="skill-settings"]:checked')?.value || 'novice'

  state.config = await window.nano.saveConfig({ apiKey, projectDescription: project, skillLevel: skill })
  applyConfig()
  showScreen('main')
}

async function resetSession () {
  state.session = {
    projectDescription: state.config.projectDescription,
    exchanges: [],
    resolvedCategories: [],
    nudgeCount: { critical: 0, high: 0, medium: 0, low: 0 },
    summary: '',
    startedAt: new Date().toISOString()
  }
  state.nudgeCards = []
  await window.nano.saveSession(state.session)
  renderFeed()
  showScreen('main')
}

// ─── Feed rendering ───────────────────────────────────────────────────────────

function renderFeed () {
  const feed = $('nudge-feed')
  const empty = $('feed-empty')
  if (!feed) return

  // Remove old nudge cards (keep empty state el)
  feed.querySelectorAll('.nudge-card').forEach(el => el.remove())

  if (state.nudgeCards.length === 0) {
    if (empty) empty.style.display = 'flex'
    return
  }

  if (empty) empty.style.display = 'none'

  state.nudgeCards.forEach(cardData => {
    const card = buildNudgeCard(cardData)
    feed.appendChild(card)
  })
}

function buildNudgeCard ({ categoryId, nudgeText, severity, resolved }) {
  const card = document.createElement('div')
  card.className = `nudge-card severity-${severity}${resolved ? ' resolved' : ''}`
  card.dataset.categoryId = categoryId

  const cat = getCategoryById(categoryId)
  const name = cat?.name || categoryId

  card.innerHTML = `
    <div class="nudge-card-top">
      <span class="nudge-severity-dot"></span>
      <span class="nudge-category">${name}</span>
      <span class="nudge-expand-hint">${resolved ? '✓ resolved' : 'tap to explore →'}</span>
    </div>
    <div class="nudge-text">${nudgeText}</div>
  `

  card.addEventListener('click', () => {
    if (!resolved) openNudgeDetail(categoryId)
  })

  return card
}

function addNudgeToFeed (categoryId, severity) {
  const cat = getCategoryById(categoryId)
  if (!cat) return

  // Don't add if already in feed
  if (state.nudgeCards.find(c => c.categoryId === categoryId)) return

  const cardData = {
    categoryId,
    nudgeText: cat.nudge,
    severity,
    resolved: false
  }

  state.nudgeCards.unshift(cardData) // newest at top
  renderFeed()
}

function markNudgeResolved (categoryId) {
  const card = state.nudgeCards.find(c => c.categoryId === categoryId)
  if (card) {
    card.resolved = true
    renderFeed()
  }
}

// ─── Scan engine ─────────────────────────────────────────────────────────────

async function handleScan () {
  const input = $('scan-input')
  const text = input?.value.trim()
  if (!text || state.isThinking) return
  input.value = ''
  await runScan(text, 'manual')
}

async function runScan (text, source) {
  if (state.isThinking) return
  setThinking(true)

  try {
    state.session.exchanges.push({ role: 'user', content: text, source, timestamp: Date.now() })

    const triggered = detectTriggeredCategories(text)

    if (triggered.length === 0) {
      await claudeSoftScan(text)
    } else {
      const toNudge = pickBestNudge(triggered)
      if (toNudge) {
        addNudgeToFeed(toNudge.id, toNudge.severity)
        bumpNudgeCount(toNudge.severity)
      }
    }

    if (state.session.exchanges.length % 5 === 0) {
      await summarizeSession()
    }

    await window.nano.saveSession(state.session)
  } catch (err) {
    console.error('runScan error:', err)
  } finally {
    setThinking(false)
  }
}

// ─── Trigger detection ────────────────────────────────────────────────────────

function detectTriggeredCategories (text) {
  const lower = text.toLowerCase()
  const triggered = []

  state.blindspots.categories?.forEach(cat => {
    if (state.session.resolvedCategories?.includes(cat.id)) return
    if (state.nudgeCards.find(c => c.categoryId === cat.id)) return

    let score = 0

    // Keyword matches
    cat.triggers.keywords?.forEach(kw => {
      if (lower.includes(kw.toLowerCase())) score += 2
    })

    // Code pattern matches (regex)
    cat.triggers.code_patterns?.forEach(pattern => {
      try {
        if (new RegExp(pattern, 'i').test(text)) score += 3
      } catch { }
    })

    // Regex absent checks — fire if pattern NOT found (suggesting it's missing)
    // We flag absence only if there's a positive keyword/code match first
    if (score > 0) {
      cat.triggers.regex_absent?.forEach(pattern => {
        try {
          if (!new RegExp(pattern, 'i').test(text)) score += 1
        } catch { }
      })
    }

    if (score >= 2) {
      triggered.push({ ...cat, score })
    }
  })

  // Sort: critical first, then by score
  return triggered.sort((a, b) => {
    const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 }
    const sa = severityOrder[a.severity] || 0
    const sb = severityOrder[b.severity] || 0
    if (sa !== sb) return sb - sa
    return b.score - a.score
  })
}

function pickBestNudge (triggered) {
  const caps = state.blindspots.nudge_timing?.max_nudges_per_session_by_severity || {}

  for (const cat of triggered) {
    const sev = cat.severity
    const count = state.session.nudgeCount?.[sev] || 0

    // Critical is always exempt from cap
    if (sev === 'critical') return cat

    const cap = typeof caps[sev] === 'number' ? caps[sev] : 99
    if (count < cap) return cat
  }
  return null
}

function bumpNudgeCount (severity) {
  if (!state.session.nudgeCount) state.session.nudgeCount = {}
  state.session.nudgeCount[severity] = (state.session.nudgeCount[severity] || 0) + 1
}

// ─── Soft scan via Claude ─────────────────────────────────────────────────────

async function claudeSoftScan (text) {
  const categoryNames = state.blindspots.categories
    ?.filter(c => !state.session.resolvedCategories?.includes(c.id))
    .map(c => `${c.id}: ${c.name}`)
    .join('\n') || ''

  const systemPrompt = buildSystemPrompt()
  const userMessage = `The user just pasted this text into their session:

---
${text.slice(0, 1500)}
---

Available blindspot categories (id: name):
${categoryNames}

Does this text trigger any of these blindspot categories? 
Reply with ONLY a JSON object: { "triggered": "<category_id or null>", "reason": "<one sentence>" }
If nothing is triggered, return { "triggered": null, "reason": "" }`

  const result = await window.nano.chat({
    messages: [{ role: 'user', content: userMessage }],
    systemPrompt
  })

  if (result.error || !result.content) return

  try {
    const cleaned = result.content.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (parsed.triggered && parsed.triggered !== 'null') {
      const cat = getCategoryById(parsed.triggered)
      if (cat && !state.nudgeCards.find(c => c.categoryId === cat.id)) {
        addNudgeToFeed(cat.id, cat.severity)
        bumpNudgeCount(cat.severity)
      }
    }
  } catch { }
}

// ─── Session summarization ────────────────────────────────────────────────────

async function summarizeSession () {
  const recentExchanges = state.session.exchanges.slice(-10)
    .map(e => e.content.slice(0, 200))
    .join('\n---\n')

  const summaryPrompt = state.blindspots.session_summarization?.summary_prompt || ''

  const result = await window.nano.chat({
    messages: [{ role: 'user', content: `${summaryPrompt}\n\nRecent session content:\n${recentExchanges}` }],
    systemPrompt: 'You summarize developer sessions concisely. Output only the 3-bullet summary, nothing else.'
  })

  if (result.content) {
    state.session.summary = result.content
  }
}

// ─── Nudge detail screen ──────────────────────────────────────────────────────

function openNudgeDetail (categoryId) {
  const cat = getCategoryById(categoryId)
  if (!cat) return

  state.activeNudgeId = categoryId
  state.exchangeCount = 0

  // Set title
  const titleEl = $('nudge-detail-title')
  if (titleEl) titleEl.textContent = cat.name

  // Render explanation
  const body = $('nudge-detail-body')
  if (body) {
    const opts = cat.explanation.options?.map(o => `
      <div class="option-item">
        <div class="option-label">${o.label}</div>
        <div class="option-solution">${o.solution}</div>
      </div>
    `).join('') || ''

    body.innerHTML = `
      <p class="nudge-detail-question">${cat.nudge}</p>
      <div class="nudge-detail-plain">${cat.explanation.plain}</div>
      <p class="nudge-detail-analogy">"${cat.explanation.analogy}"</p>
      <div class="options-list">${opts}</div>
      <div class="follow-up-question">💬 ${cat.explanation.follow_up_question}</div>
    `
  }

  // Render chat area — first state: reply input open
  renderChatArea(cat, 'awaiting_reply')

  showScreen('nudge')
}

function renderChatArea (cat, phase) {
  const area = $('nudge-chat-area')
  if (!area) return
  area.innerHTML = ''

  if (phase === 'awaiting_reply') {
    const row = document.createElement('div')
    row.className = 'chat-reply-row'
    row.innerHTML = `
      <input type="text" class="chat-reply-input" id="chat-reply-input" placeholder="Reply to continue..." />
      <button class="btn-reply" id="btn-send-reply">Send</button>
    `
    area.appendChild(row)

    const sendFn = () => handleUserReply(cat)
    $('btn-send-reply')?.addEventListener('click', sendFn)
    $('chat-reply-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') sendFn()
    })
    setTimeout(() => $('chat-reply-input')?.focus(), 100)
  }

  if (phase === 'handoff') {
    const prompt = buildHandoffPrompt(cat)

    const box = document.createElement('div')
    box.innerHTML = `
      <div class="handoff-box">
        <div class="handoff-header">
          <span class="handoff-label">📋 Take this to your main chat</span>
          <button class="btn-copy" id="btn-copy-handoff">Copy</button>
        </div>
        <div class="handoff-prompt" id="handoff-prompt-text">${prompt}</div>
      </div>
      <p class="watching-line">I'll keep watching.</p>
    `
    area.appendChild(box)

    $('btn-copy-handoff')?.addEventListener('click', () => {
      navigator.clipboard.writeText(prompt)
      $('btn-copy-handoff').textContent = 'Copied!'
      setTimeout(() => {
        if ($('btn-copy-handoff')) $('btn-copy-handoff').textContent = 'Copy'
      }, 2000)
    })
  }
}

// ─── User reply handling ──────────────────────────────────────────────────────

async function handleUserReply (cat) {
  const input = $('chat-reply-input')
  const userText = input?.value.trim()
  if (!userText || state.isThinking) return

  state.exchangeCount++
  setThinking(true)

  // Show the user's reply in the chat area
  const area = $('nudge-chat-area')
  const replyEl = document.createElement('div')
  replyEl.className = 'chat-exchange'
  replyEl.style.color = 'var(--text-primary)'
  replyEl.textContent = userText
  area.innerHTML = ''
  area.appendChild(replyEl)

  // Add thinking indicator
  const thinking = document.createElement('div')
  thinking.className = 'chat-exchange'
  thinking.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div>`
  area.appendChild(thinking)

  // Build the context-rich prompt for Nano's response
  const systemPrompt = buildSystemPrompt()
  const messages = [
    {
      role: 'user',
      content: buildNudgeContext(cat) + `\n\nThe user replied: "${userText}"\n\nThis is exchange ${state.exchangeCount} of maximum 2. ${state.exchangeCount >= 2 ? 'This is the FINAL exchange — you MUST generate a handoff prompt after your brief reply.' : 'Give a brief, grounded response and ask your one follow-up question.'}`
    }
  ]

  const result = await window.nano.chat({ messages, systemPrompt })
  thinking.remove()

  if (result.error) {
    const errEl = document.createElement('div')
    errEl.className = 'chat-exchange'
    errEl.style.color = 'var(--danger)'
    errEl.textContent = 'Could not reach Claude API. Check your connection and API key.'
    area.appendChild(errEl)
    setThinking(false)
    return
  }

  // Show Nano's response
  const responseEl = document.createElement('div')
  responseEl.className = 'chat-exchange'
  responseEl.style.color = 'var(--text-secondary)'
  responseEl.textContent = result.content
  area.appendChild(responseEl)

  // Log exchange to session
  state.session.exchanges.push({
    role: 'assistant',
    content: result.content,
    categoryId: cat.id,
    timestamp: Date.now()
  })

  setThinking(false)

  // After exchange 2, always go to handoff
  if (state.exchangeCount >= 2) {
    setTimeout(() => renderChatArea(cat, 'handoff'), 600)
    // Mark as resolved in session
    if (!state.session.resolvedCategories) state.session.resolvedCategories = []
    if (!state.session.resolvedCategories.includes(cat.id)) {
      state.session.resolvedCategories.push(cat.id)
    }
    markNudgeResolved(cat.id)
  } else {
    // Still in first exchange — keep reply input open
    const row = document.createElement('div')
    row.className = 'chat-reply-row'
    row.style.marginTop = '8px'
    row.innerHTML = `
      <input type="text" class="chat-reply-input" id="chat-reply-input" placeholder="Reply..." />
      <button class="btn-reply" id="btn-send-reply">Send</button>
    `
    area.appendChild(row)

    const sendFn = () => handleUserReply(cat)
    $('btn-send-reply')?.addEventListener('click', sendFn)
    $('chat-reply-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') sendFn()
    })
    setTimeout(() => $('chat-reply-input')?.focus(), 100)
  }

  await window.nano.saveSession(state.session)
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
    novice: 'not a developer — avoid all jargon and use plain language and analogies',
    some:   'has some coding experience but is not a professional developer',
    dev:    'is a developer but may lack production app experience'
  }[state.config.skillLevel] || 'not a developer'

  return `${persona}

The user ${skillLabel}.

Rules:
- ${rules}

Project context: ${state.config.projectDescription || 'unknown project'}
Session summary: ${state.session.summary || 'Session just started.'}`
}

function buildNudgeContext (cat) {
  return `Blindspot category: ${cat.name}
Nudge shown to user: "${cat.nudge}"
Plain explanation given: "${cat.explanation.plain}"
Analogy used: "${cat.explanation.analogy}"
Follow-up question asked: "${cat.explanation.follow_up_question}"
Project: ${state.config.projectDescription}`
}

function buildHandoffPrompt (cat) {
  let template = cat.handoff_prompt_template || ''
  const vars = cat.template_variables || {}

  // Fill template variables from session context and config
  const context = {
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

  // Replace placeholders, falling back to template_variable fallbacks
  template = template.replace(/\{(\w+)\}/g, (_, key) => {
    return context[key] || vars[key]?.fallback || key
  })

  // Append novice tag
  if (state.config.skillLevel === 'novice' && !template.includes('not a developer')) {
    template += ' I am not a developer — please explain as you go.'
  }

  return template
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCategoryById (id) {
  return state.blindspots.categories?.find(c => c.id === id) || null
}

function setThinking (on) {
  state.isThinking = on
  const avatar = $('avatar-main')
  const btn = $('btn-scan')
  if (avatar) avatar.classList.toggle('thinking', on)
  if (btn) btn.disabled = on
  setStatus(on ? 'Thinking...' : 'Watching...', on ? 'thinking' : '')
}

// ─── Boot ─────────────────────────────────────────────────────────────────────


// ─── Auto-updater UI ──────────────────────────────────────────────────────────

function initUpdaterUI () {
  if (!window.updater) return

  window.updater.onUpdateAvailable((info) => {
    console.log('Update available:', info.version)
  })

  window.updater.onUpdateDownloaded(() => {
    const feed = document.getElementById('nudge-feed')
    if (!feed) return

    const banner = document.createElement('div')
    banner.style.cssText = `
      background: #1a2a1a; border: 0.5px solid #2a4a2a; border-radius: 8px;
      padding: 10px 14px; display: flex; align-items: center;
      justify-content: space-between; gap: 10px; animation: slide-in 0.25s ease;
    `
    banner.innerHTML = `
      <span style="font-size:12px; color:#6ec99a;">
        NanoBot update ready — restart to install
      </span>
      <button onclick="window.updater.installUpdate()" style="
        background:#1d4a1d; border:0.5px solid #2a6a2a; border-radius:4px;
        color:#6ec99a; font-size:11px; font-family:monospace;
        padding:4px 10px; cursor:pointer; white-space:nowrap;
      ">Restart now</button>
    `
    feed.prepend(banner)
  })
}

document.addEventListener('DOMContentLoaded', () => {
  init()
  initUpdaterUI()
})
