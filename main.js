const { autoUpdater } = require('electron-updater')
const { app, BrowserWindow, Tray, Menu, ipcMain, clipboard, nativeImage, screen, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

// ─── Constants ───────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(os.homedir(), '.nano-bot', 'config.json')
const SESSION_PATH = path.join(os.homedir(), '.nano-bot', 'session.json')
const BLINDSPOTS_PATH = path.join(__dirname, 'blindspots.v2.json')
const WINDOW_WIDTH = 380
const WINDOW_HEIGHT = 600
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
  const defaultX = workArea.x + workArea.width - WINDOW_WIDTH - 20
  const defaultY = workArea.y + workArea.height - WINDOW_HEIGHT - 20

  const savedPos = config.windowPosition
  const x = savedPos ? savedPos.x : defaultX
  const y = savedPos ? savedPos.y : defaultY

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
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
  // Use a simple template image; in production this would be a real icon file
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png')
  let icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()
  icon = icon.resize({ width: 16, height: 16 })
  icon.setTemplateImage(true)

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

  // On Mac, prevent dock icon (we live in the tray/floating window only)
  if (process.platform === 'darwin') app.dock?.hide()

  createWindow()
  createTray()
  setupAutoUpdater()

  // Restore clipboard watcher if it was on
  if (config.clipboardWatcher) startClipboardWatcher()
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
