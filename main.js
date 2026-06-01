const { autoUpdater } = require('electron-updater')
const { app, BrowserWindow, Tray, Menu, ipcMain, clipboard, nativeImage, screen, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

// ─── Constants ───────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(os.homedir(), '.nano-bot', 'config.json')
const SESSION_PATH = path.join(os.homedir(), '.nano-bot', 'session.json')
const BLINDSPOTS_PATH = path.join(__dirname, 'blindspots.v2.json')
const CREATURE_W = 100
const CREATURE_H = 100
const BUBBLE_W = 310
const CLIPBOARD_POLL_MS = 1500
const CONFIG_DEFAULTS = {
  apiKey: '',
  projectDescription: '',
  skillLevel: 'novice',
  clipboardWatcher: false,
  windowPosition: null,
  onboardingComplete: false
}

// ─── State ───────────────────────────────────────────────────────────────────

let mainWindow = null
let tray = null
let clipboardInterval = null
let lastClipboardText = ''
let config = {}
let blindspots = {}

// ─── Config helpers ───────────────────────────────────────────────────────────

function ensureConfigDir () {
  const dir = path.dirname(CONFIG_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function loadConfig () {
  ensureConfigDir()
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      config = { ...CONFIG_DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }
    } catch {
      config = { ...CONFIG_DEFAULTS }
    }
  } else {
    config = { ...CONFIG_DEFAULTS }
  }
  return config
}

function saveConfig (updates) {
  ensureConfigDir()
  config = { ...config, ...updates }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  return config
}

function loadBlindspots () {
  try {
    blindspots = JSON.parse(fs.readFileSync(BLINDSPOTS_PATH, 'utf8'))
  } catch (e) {
    console.error('Failed to load blindspots:', e)
    blindspots = { categories: [] }
  }
  return blindspots
}

// ─── Session helpers ──────────────────────────────────────────────────────────

function loadSession () {
  if (fs.existsSync(SESSION_PATH)) {
    try { return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8')) } catch { }
  }
  return {
    projectDescription: '',
    exchanges: [],
    resolvedCategories: [],
    nudgeCount: { critical: 0, high: 0, medium: 0, low: 0 },
    summary: '',
    startedAt: new Date().toISOString()
  }
}

function saveSession (session) {
  ensureConfigDir()
  fs.writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2))
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow () {
  const { workArea } = screen.getPrimaryDisplay()

  // Default position: bottom-right corner
  const defaultX = workArea.x + workArea.width - CREATURE_W - 20
  const defaultY = workArea.y + workArea.height - CREATURE_H - 20

  const savedPos = config.windowPosition
  const x = savedPos ? savedPos.x : defaultX
  const y = savedPos ? savedPos.y : defaultY

  mainWindow = new BrowserWindow({
    width: CREATURE_W,
    height: CREATURE_H,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // Save position when moved
  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition()
    saveConfig({ windowPosition: { x, y } })
  })

  mainWindow.on('closed', () => { mainWindow = null })

  // Open DevTools in dev mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function createTray () {
  const iconPath = path.join(__dirname, 'assets', 'nanobot.png')
  let icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()
  icon = icon.resize({ width: 24, height: 24 })

  tray = new Tray(icon)
  tray.setToolTip('NanoBot')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Nano', click: () => { if (mainWindow) mainWindow.show() } },
    { label: 'Hide Nano', click: () => { if (mainWindow) mainWindow.hide() } },
    { type: 'separator' },
    { label: 'New Session', click: () => {
      saveSession({
        projectDescription: '',
        exchanges: [],
        resolvedCategories: [],
        nudgeCount: { critical: 0, high: 0, medium: 0, low: 0 },
        summary: '',
        startedAt: new Date().toISOString()
      })
      if (mainWindow) mainWindow.webContents.send('session-reset')
    }},
    { type: 'separator' },
    { label: 'Quit NanoBot', click: () => app.quit() }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
    }
  })
}

// ─── Clipboard watcher ────────────────────────────────────────────────────────

function startClipboardWatcher () {
  if (clipboardInterval) return
  lastClipboardText = clipboard.readText()

  clipboardInterval = setInterval(() => {
    const current = clipboard.readText()
    if (current !== lastClipboardText && current.length > 50) {
      lastClipboardText = current
      if (mainWindow) {
        mainWindow.webContents.send('clipboard-changed', {
          text: current,
          timestamp: Date.now()
        })
      }
    }
  }, CLIPBOARD_POLL_MS)
}

function stopClipboardWatcher () {
  if (clipboardInterval) {
    clearInterval(clipboardInterval)
    clipboardInterval = null
  }
}

// ─── Terminal watcher ─────────────────────────────────────────────────────────

const { exec } = require('child_process')

const TERMINAL_POLL_MS = 3000
const DEBOUNCE_MS = 2000
const MAX_SCAN_CHARS = 1500
const MIN_NEW_CHARS = 50
const CLAUDE_MARKERS = ['claude', 'codex', '> ', '$ claude', '$ codex']

let terminalInterval = null
let terminalDebounce = null
const lastTerminalContent = { Terminal: '', iTerm2: '' }

const APPLE_SCRIPTS = {
  Terminal: `
    tell application "System Events"
      if exists process "Terminal" then
        tell application "Terminal"
          if (count windows) > 0 then
            return contents of selected tab of front window
          end if
        end tell
      end if
    end tell
    return ""
  `,
  iTerm2: `
    tell application "System Events"
      if exists process "iTerm2" then
        tell application "iTerm2"
          if (count windows) > 0 then
            tell current session of current window
              return contents
            end tell
          end if
        end tell
      end if
    end tell
    return ""
  `
}

function runAppleScript (script) {
  return new Promise(resolve => {
    const tmp = path.join(os.tmpdir(), 'nano-watch.scpt')
    fs.writeFileSync(tmp, script)
    exec(`osascript "${tmp}"`, { timeout: 5000 }, (err, stdout) => {
      resolve(err ? '' : stdout.trim())
    })
  })
}

function looksLikeCLISession (text) {
  const lower = text.toLowerCase()
  return CLAUDE_MARKERS.some(m => lower.includes(m))
}

function extractNewContent (prev, current) {
  if (current.length <= prev.length) return ''
  const newText = current.slice(prev.length)
  return newText.trim()
}

function startTerminalWatcher () {
  if (terminalInterval) return
  terminalInterval = setInterval(async () => {
    for (const app of ['Terminal', 'iTerm2']) {
      const content = await runAppleScript(APPLE_SCRIPTS[app])
      if (!content || !looksLikeCLISession(content)) continue

      const newText = extractNewContent(lastTerminalContent[app], content)
      lastTerminalContent[app] = content

      if (newText.length < MIN_NEW_CHARS) continue

      // Debounce — wait for output to settle before scanning
      clearTimeout(terminalDebounce)
      terminalDebounce = setTimeout(() => {
        const payload = newText.slice(-MAX_SCAN_CHARS)
        if (mainWindow) {
          mainWindow.webContents.send('terminal-content', { text: payload, source: app })
        }
      }, DEBOUNCE_MS)
    }
  }, TERMINAL_POLL_MS)
}

function stopTerminalWatcher () {
  if (terminalInterval) {
    clearInterval(terminalInterval)
    terminalInterval = null
  }
  clearTimeout(terminalDebounce)
}

function checkAccessibilityPermission () {
  const { systemPreferences } = require('electron')
  return systemPreferences.isTrustedAccessibilityClient(false)
}

function requestAccessibilityPermission () {
  const { systemPreferences } = require('electron')
  return systemPreferences.isTrustedAccessibilityClient(true)
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

// Config
ipcMain.handle('get-config', () => config)
ipcMain.handle('save-config', (_, updates) => saveConfig(updates))

// Blindspots knowledge base
ipcMain.handle('get-blindspots', () => blindspots)

// Session
ipcMain.handle('get-session', () => loadSession())
ipcMain.handle('save-session', (_, session) => { saveSession(session); return true })

// Clipboard watcher toggle
ipcMain.handle('set-clipboard-watcher', (_, enabled) => {
  saveConfig({ clipboardWatcher: enabled })
  enabled ? startClipboardWatcher() : stopClipboardWatcher()
  return enabled
})

// Terminal watcher
ipcMain.handle('check-accessibility', () => checkAccessibilityPermission())
ipcMain.handle('request-accessibility', () => requestAccessibilityPermission())
ipcMain.handle('start-terminal-watcher', () => {
  if (!checkAccessibilityPermission()) return { error: 'no_permission' }
  startTerminalWatcher()
  return { ok: true }
})
ipcMain.handle('stop-terminal-watcher', () => {
  stopTerminalWatcher()
  return { ok: true }
})

// Window controls
ipcMain.handle('minimize-window', () => { if (mainWindow) mainWindow.minimize() })
ipcMain.handle('hide-window', () => { if (mainWindow) mainWindow.hide() })
ipcMain.handle('toggle-always-on-top', (_, flag) => {
  if (mainWindow) mainWindow.setAlwaysOnTop(flag)
  return flag
})

// Drag support — update position from renderer drag
ipcMain.handle('window-drag', (_, { x, y }) => {
  if (mainWindow) {
    mainWindow.setPosition(Math.round(x), Math.round(y))
    saveConfig({ windowPosition: { x: Math.round(x), y: Math.round(y) } })
  }
})

// Window position get/set (for drag)
ipcMain.handle('get-window-position', () => {
  if (!mainWindow) return { x: 0, y: 0 }
  const [x, y] = mainWindow.getPosition()
  return { x, y }
})

ipcMain.handle('set-window-position', (_, { x, y }) => {
  if (!mainWindow) return
  mainWindow.setPosition(Math.round(x), Math.round(y))
  saveConfig({ windowPosition: { x: Math.round(x), y: Math.round(y) } })
})

// Dynamic resize — anchors bottom-right corner (creature stays in place)
ipcMain.handle('resize-window', (_, { width, height }) => {
  if (!mainWindow) return
  const [x, y] = mainWindow.getPosition()
  const [oldW, oldH] = mainWindow.getSize()
  const { workArea } = screen.getPrimaryDisplay()
  const newX = Math.max(workArea.x, x + oldW - width)
  const newY = Math.max(workArea.y, y + oldH - height)
  mainWindow.setSize(Math.round(width), Math.round(height))
  mainWindow.setPosition(Math.round(newX), Math.round(newY))
})

// Open external links
ipcMain.handle('open-external', (_, url) => { shell.openExternal(url) })

// Anthropic API call — proxied through main process so key stays out of renderer
ipcMain.handle('anthropic-chat', async (_, { messages, systemPrompt, apiKey: keyOverride }) => {
  const key = keyOverride || config.apiKey
  if (!key) return { error: 'No API key configured' }
  try {
    const Anthropic = require('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: key })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages
    })
    return { content: response.content[0].text }
  } catch (err) {
    return { error: err.message || 'API call failed' }
  }
})

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  loadConfig()
  loadBlindspots()

  // On Mac, set app icon then hide dock (icon still shows in Accessibility settings etc.)
  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.icns'))
    if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon)
    app.dock?.hide()
  }

  createWindow()
  createTray()
  setupAutoUpdater()

  // Auto-start terminal watcher if accessibility permission already granted
  if (checkAccessibilityPermission()) startTerminalWatcher()

  // Restore clipboard watcher if it was on
  if (config.clipboardWatcher) startClipboardWatcher()

  // Proactive heartbeat — renderer checks if anything is worth flagging
  setInterval(() => {
    if (mainWindow) mainWindow.webContents.send('heartbeat')
  }, 3 * 60 * 1000)
})

app.on('window-all-closed', () => {
  // Don't quit on window close — keep running in tray
  if (process.platform !== 'darwin') {
    // On non-Mac, keep the tray alive
  }
})

app.on('activate', () => {
  if (!mainWindow) createWindow()
})

app.on('before-quit', () => {
  stopClipboardWatcher()
})

// ─── Auto-updater ─────────────────────────────────────────────────────────────

function setupAutoUpdater () {
  // Only run in packaged app, not during development
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes
      })
    }
  })

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded')
    }
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err)
  })

  // Check on launch, then every 4 hours
  autoUpdater.checkForUpdates()
  setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000)
}

// IPC: install update now (called from renderer when user confirms)
ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall()
})
