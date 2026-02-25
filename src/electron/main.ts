import { app, BrowserWindow, ipcMain } from 'electron'
import { join, resolve } from 'path'
import { spawn, ChildProcess } from 'child_process'
import WebSocket from 'ws'

let win: BrowserWindow | null = null
let ws: WebSocket | null = null
let sidecar: ChildProcess | null = null

const isDev = !!process.env['ELECTRON_RENDERER_URL']
const projectRoot = isDev ? resolve(__dirname, '../..') : process.resourcesPath

function spawnSidecar(): ChildProcess {
  const tsx = resolve(projectRoot, 'node_modules/.bin/tsx')
  const script = resolve(projectRoot, 'src/sidecar/server.ts')
  const proc = spawn(tsx, [script], { stdio: 'inherit' })
  proc.on('error', (err) => console.error('[Main] Sidecar spawn error:', err))
  return proc
}

async function connectSidecar(): Promise<WebSocket> {
  for (let i = 0; i < 20; i++) {
    try {
      return await new Promise<WebSocket>((resolve, reject) => {
        const sock = new WebSocket('ws://localhost:8765')
        sock.once('open', () => resolve(sock))
        sock.once('error', reject)
      })
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error('[Main] Sidecar connection timeout (10s)')
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
      } else if (msg.type === 'error') {
        console.error('[Sidecar]', msg.message)
      }
    } catch {
      // ignore non-JSON frames
    }
  })

  sock.on('close', () => {
    console.log('[Main] Sidecar WS disconnected')
    ws = null
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
    win.loadURL(process.env['ELECTRON_RENDERER_URL']!)
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

async function startSidecar() {
  // Try to reuse an already-running sidecar (e.g. hot-reload, leftover process)
  try {
    ws = await new Promise<WebSocket>((resolve, reject) => {
      const sock = new WebSocket('ws://localhost:8765')
      sock.once('open', () => resolve(sock))
      sock.once('error', reject)
    })
    console.log('[Main] Reusing existing sidecar on port 8765')
    attachSidecarHandlers(ws)
    return
  } catch {
    // No existing sidecar — spawn one
  }

  sidecar = spawnSidecar()
  sidecar.on('exit', (code) => {
    console.log('[Main] Sidecar exited with code', code)
    sidecar = null
    ws = null
  })

  try {
    ws = await connectSidecar()
    console.log('[Main] Connected to sidecar')
    attachSidecarHandlers(ws)
  } catch (err) {
    console.error('[Main] Failed to connect to sidecar:', err)
  }
}

app.whenReady().then(async () => {
  createWindow()
  await startSidecar()
})

app.on('before-quit', () => {
  ws?.close()
  sidecar?.kill()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
