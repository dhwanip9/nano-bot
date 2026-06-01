const { contextBridge, ipcRenderer } = require('electron')

// Expose a clean, typed API to the renderer — no raw IPC, no Node access
contextBridge.exposeInMainWorld('nano', {

  // ── Config ──────────────────────────────────────────────────────────────────
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (updates) => ipcRenderer.invoke('save-config', updates),

  // ── Knowledge base ───────────────────────────────────────────────────────────
  getBlindspots: () => ipcRenderer.invoke('get-blindspots'),

  // ── Session ──────────────────────────────────────────────────────────────────
  getSession: () => ipcRenderer.invoke('get-session'),
  saveSession: (session) => ipcRenderer.invoke('save-session', session),

  // ── Clipboard watcher ────────────────────────────────────────────────────────
  setClipboardWatcher: (enabled) => ipcRenderer.invoke('set-clipboard-watcher', enabled),

  // ── Window controls ──────────────────────────────────────────────────────────
  minimize: () => ipcRenderer.invoke('minimize-window'),
  hide: () => ipcRenderer.invoke('hide-window'),
  toggleAlwaysOnTop: (flag) => ipcRenderer.invoke('toggle-always-on-top', flag),
  dragWindow: (pos) => ipcRenderer.invoke('window-drag', pos),
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  setWindowPosition: (pos) => ipcRenderer.invoke('set-window-position', pos),
  resizeWindow: (size) => ipcRenderer.invoke('resize-window', size),

  // ── External links ───────────────────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // ── Anthropic API ────────────────────────────────────────────────────────────
  chat: (payload) => ipcRenderer.invoke('anthropic-chat', payload),

  // ── Terminal watcher ─────────────────────────────────────────────────────────
  checkAccessibility: () => ipcRenderer.invoke('check-accessibility'),
  requestAccessibility: () => ipcRenderer.invoke('request-accessibility'),
  startTerminalWatcher: () => ipcRenderer.invoke('start-terminal-watcher'),
  stopTerminalWatcher: () => ipcRenderer.invoke('stop-terminal-watcher'),

  // ── Event listeners ──────────────────────────────────────────────────────────
  onClipboardChanged: (callback) => {
    ipcRenderer.on('clipboard-changed', (_, data) => callback(data))
  },
  onTerminalContent: (callback) => {
    ipcRenderer.on('terminal-content', (_, data) => callback(data))
  },
  onSessionReset: (callback) => {
    ipcRenderer.on('session-reset', () => callback())
  },
  onHeartbeat: (callback) => {
    ipcRenderer.on('heartbeat', () => callback())
  },

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel)
  }
})

// Auto-updater (exposed separately so renderer can show update UI)
contextBridge.exposeInMainWorld('updater', {
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
  installUpdate: () => ipcRenderer.invoke('install-update')
})
