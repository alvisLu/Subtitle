import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// IPC: session control
ipcMain.on('session:start', (_e, config) => {
  console.log('[Main] session:start', config)
  // Phase 6: forward to sidecar WebSocket
})

ipcMain.on('session:stop', () => {
  console.log('[Main] session:stop')
  // Phase 6: forward to sidecar WebSocket
})

// IPC: audio chunks from Renderer
ipcMain.on('audio:chunk', (_e, buffer: ArrayBuffer, channel: 0 | 1) => {
  const pcm = new Float32Array(buffer)
  console.log(`[Main] audio:chunk channel=${channel} samples=${pcm.length}`)
  // Phase 6: prepend channel byte, forward to sidecar WebSocket
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
