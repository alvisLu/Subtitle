import 'dotenv/config'
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import WebSocket from 'ws'

let win: BrowserWindow | null = null
let ws: WebSocket | null = null

const SIDECAR_URL = process.env.SIDECAR_URL ?? 'ws://localhost:8765'
const isDev = !!process.env.ELECTRON_RENDERER_URL

async function connectSidecar(): Promise<WebSocket> {
  while (true) {
    try {
      return await new Promise<WebSocket>((resolve, reject) => {
        const sock = new WebSocket(SIDECAR_URL)
        sock.once('open', () => resolve(sock))
        sock.once('error', reject)
      })
    } catch {
      console.log(`[Main] Waiting for sidecar at ${SIDECAR_URL} ...`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

async function scheduleReconnect() {
  ws = null
  ws = await connectSidecar()
  console.log('[Main] Reconnected to sidecar')
  attachSidecarHandlers(ws)
}

function attachSidecarHandlers(sock: WebSocket) {
  sock.on('message', (data) => {
    if (!win) return
    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'transcript') {
        win.webContents.send('transcript', {
          channel: msg.channel,
          text: msg.text,
          final: msg.final,
        })
      } else if (msg.type === 'status') {
        win.webContents.send('status', msg.state)
      } else if (msg.type === 'config') {
        win.webContents.send('stt-config', msg.config)
      } else if (msg.type === 'error') {
        console.error('[Sidecar]', msg.message)
      }
    } catch {
      // ignore non-JSON frames
    }
  })

  sock.on('close', () => {
    console.log('[Main] Sidecar WS disconnected')
    scheduleReconnect()
  })

  sock.on('error', (err) => {
    console.error('[Main] Sidecar WS error:', err)
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
    },
  })

  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL!)
    win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// IPC: session control
ipcMain.on(
  'session:start',
  (
    _e,
    config: {
      sourceLang: string
      targetLang: string
      engine: string
      sampleRate: number
    },
  ) => {
    console.log('[Main] session:start', config)
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'start',
          sourceLang: config.sourceLang,
          sampleRate: config.sampleRate,
        }),
      )
    }
  },
)

ipcMain.on('session:stop', () => {
  console.log('[Main] session:stop')
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'stop' }))
  }
})

ipcMain.on('session:setLang', (_e, lang: string) => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'setLang', sourceLang: lang }))
  }
})

// IPC: audio chunks from Renderer → prepend channel byte → forward to sidecar
ipcMain.on('audio:chunk', (_e, buffer: ArrayBuffer, channel: 0 | 1) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  const pcmBytes = new Uint8Array(buffer)
  const frame = new Uint8Array(1 + pcmBytes.byteLength)
  frame[0] = channel
  frame.set(pcmBytes, 1)
  ws.send(frame)
})

app.whenReady().then(async () => {
  createWindow()
  console.log(`[Main] Connecting to sidecar at ${SIDECAR_URL} ...`)
  ws = await connectSidecar()
  console.log('[Main] Connected to sidecar')
  attachSidecarHandlers(ws)
})

app.on('before-quit', () => {
  ws?.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
