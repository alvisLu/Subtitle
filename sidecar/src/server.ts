import { WebSocketServer, WebSocket } from 'ws'
import { loadModel, transcribe, STT_BASE_CONFIG } from './stt.ts'

/*
 * How to test:
 * wscat -c ws://localhost:8765
 * # After connecting, send：
 * {"type":"start","sourceLang":"zh","sampleRate":16000}
 */

const PORT = Number(process.env.PORT ?? 8765)
const DEFAULT_LANG = process.env.DEFAULT_LANG ?? 'zh'
// Fallback sample rate if client does not send sampleRate in start message
const INCOMING_SAMPLE_RATE = Number(process.env.INCOMING_SAMPLE_RATE ?? 48000)

type Channel = 'mic' | 'loopback'

interface Session {
  ws: WebSocket
  sourceLang: string
  sampleRate: number
  running: boolean
  // Prevent concurrent STT calls
  flushing: boolean
}

function send(ws: WebSocket, payload: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function handleControl(session: Session, raw: string) {
  let msg: { type: string; sourceLang?: string; sampleRate?: number }
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }

  if (msg.type === 'start') {
    session.sourceLang = msg.sourceLang ?? DEFAULT_LANG
    session.sampleRate = msg.sampleRate ?? INCOMING_SAMPLE_RATE
    session.running = true
    send(session.ws, { type: 'status', state: 'listening' })
    send(session.ws, {
      type: 'config',
      config: { language: session.sourceLang, ...STT_BASE_CONFIG },
    })
    console.log(`[Server] Started — lang: ${session.sourceLang}`)
  } else if (msg.type === 'setLang') {
    session.sourceLang = msg.sourceLang ?? session.sourceLang
    console.log(`[Server] Language changed to: ${session.sourceLang}`)
  } else if (msg.type === 'stop') {
    session.running = false
    send(session.ws, { type: 'status', state: 'idle' })
    console.log('[Server] Stopped')
  }
}

async function transcribeSegment(
  session: Session,
  pcm: Float32Array,
  channel: Channel,
) {

  // Skip silent audio as a safety net (VAD should have already filtered silence)
  const rms = Math.sqrt(pcm.reduce((s, v) => s + v * v, 0) / pcm.length)
  if (rms < 0.01) {
    console.log(
      `[Server] Skipping silent ${channel} segment (rms=${rms.toFixed(4)})`,
    )
    return
  }

  send(session.ws, { type: 'status', state: 'processing' })

  try {
    const text = await transcribe(pcm, session.sampleRate, session.sourceLang)
    if (text) {
      send(session.ws, { type: 'transcript', channel, text, final: true })
    }
  } catch (err) {
    send(session.ws, { type: 'error', message: String(err) })
  }

  if (session.running) {
    send(session.ws, { type: 'status', state: 'listening' })
  }
}

function handleAudio(session: Session, data: Buffer) {
  if (!session.running || session.flushing) return

  const channel: Channel = data[0] === 0 ? 'mic' : 'loopback'
  // Float32Array requires 4-byte aligned offset; copy PCM bytes into a fresh ArrayBuffer
  const pcmByteLength = data.length - 1
  const ab = new ArrayBuffer(pcmByteLength)
  new Uint8Array(ab).set(
    new Uint8Array(data.buffer, data.byteOffset + 1, pcmByteLength),
  )
  const pcm = new Float32Array(ab)

  // Each binary frame is a VAD-segmented speech chunk — transcribe directly
  session.flushing = true
  transcribeSegment(session, pcm, channel).finally(() => {
    session.flushing = false
  })
}

async function main() {
  await loadModel('small')

  const wss = new WebSocketServer({ port: PORT })
  console.log(`[Server] WebSocket listening on ws://localhost:${PORT}`)

  wss.on('connection', (ws) => {
    console.log('[Server] Client connected')

    const session: Session = {
      ws,
      sourceLang: DEFAULT_LANG,
      sampleRate: INCOMING_SAMPLE_RATE,
      running: false,
      flushing: false,
    }

    send(ws, { type: 'status', state: 'idle' })

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        handleAudio(session, data as Buffer)
      } else {
        handleControl(session, data.toString())
      }
    })

    ws.on('close', () => {
      console.log('[Server] Client disconnected')
      session.running = false
    })

    ws.on('error', (err) => {
      console.error('[Server] WS error:', err)
    })
  })
}

main().catch(console.error)
