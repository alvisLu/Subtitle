import { SessionConfig } from '@/electron'
import 'dotenv/config'
import { app, BrowserWindow, ipcMain, desktopCapturer } from 'electron'
import { join } from 'path'
import WebSocket from 'ws'

let win: BrowserWindow | null = null
let ws: WebSocket | null = null
let reconnecting = false
let activeSessionConfig: SessionConfig | null = null

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
  // 防止 close 事件多次觸發時產生多個並發重連迴圈
  if (reconnecting) return
  reconnecting = true
  // 先設 null：讓重連期間的 audio:chunk IPC 提前 return，避免對已斷線的 socket 送資料
  ws = null
  // 等待重連成功，確保後續的 attachSidecarHandlers 和重送 start 都在新 socket 已 OPEN 後執行
  ws = await connectSidecar()
  reconnecting = false
  attachSidecarHandlers(ws)
  if (activeSessionConfig) {
    ws.send(
      JSON.stringify({
        type: 'start',
        sourceLang: activeSessionConfig.sourceLang,
        targetLang: activeSessionConfig.targetLang,
        sampleRate: activeSessionConfig.sampleRate,
        enableDenoise: activeSessionConfig.enableDenoise ?? false,
      } as SessionConfig),
    )
    console.log('[Main] Reconnected to sidecar', activeSessionConfig)
  }
}

function attachSidecarHandlers(sock: WebSocket) {
  sock.on('message', (data, isBinary) => {
    if (!win) return

    // Binary frame: denoised audio [0xDA][channel][id: 21 bytes ASCII][Float32Array bytes]
    if (isBinary) {
      const buf = data as Buffer
      if (buf[0] === 0xda) {
        const channel = buf[1] === 0 ? 'mic' : 'loopback'
        const id = buf.toString('ascii', 2, 23)
        const pcmBuf = buf.subarray(23)
        // Copy into a clean ArrayBuffer so IPC can transfer it
        const ab = pcmBuf.buffer.slice(
          pcmBuf.byteOffset,
          pcmBuf.byteOffset + pcmBuf.byteLength,
        )
        win.webContents.send('denoised-audio', { channel, id, buffer: ab })
      }
      return
    }

    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'transcript') {
        win.webContents.send('transcript', {
          channel: msg.channel,
          id: msg.id,
          text: msg.text,
          final: msg.final,
        })
      } else if (msg.type === 'translation') {
        win.webContents.send('translation', {
          channel: msg.channel,
          id: msg.id,
          text: msg.text,
          final: msg.final,
        })
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
    width: 1200,
    height: 800,
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
ipcMain.on('session:start', (_e, config: SessionConfig) => {
  console.log('[Main] session:start', config)
  activeSessionConfig = {
    ...config,
    enableDenoise: config.enableDenoise ?? false,
  }
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'start',
        sourceLang: config.sourceLang,
        targetLang: config.targetLang,
        sampleRate: config.sampleRate,
        enableDenoise: config.enableDenoise ?? false,
      }),
    )
  }
})

ipcMain.on('session:stop', () => {
  console.log('[Main] session:stop')
  activeSessionConfig = null
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'stop' }))
  }
})

// IPC: always-on-top toggle
ipcMain.handle('window:setAlwaysOnTop', (_e, flag: boolean) => {
  win?.setAlwaysOnTop(flag)
})

// IPC: list screen sources for ScreenCaptureKit system audio
ipcMain.handle('desktop-capturer:getSources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
  })
  return sources.map((s) => ({ id: s.id, name: s.name }))
})

// IPC: audio chunks from Renderer → prepend [isFinal][channel][id: 21 bytes ASCII] → forward to sidecar
ipcMain.on(
  'audio:chunk',
  (_e, buffer: ArrayBuffer, channel: 0 | 1, isFinal: boolean, id: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const pcmBytes = new Uint8Array(buffer)
    const frame = new Uint8Array(23 + pcmBytes.byteLength)
    frame[0] = isFinal ? 1 : 0
    frame[1] = channel
    for (let i = 0; i < 21; i++) frame[2 + i] = id.charCodeAt(i) || 0
    frame.set(pcmBytes, 23)
    ws.send(frame)
  },
)

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
