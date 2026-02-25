import { WebSocketServer, WebSocket } from 'ws'
import { loadModel, transcribe } from './stt.ts'

/*
* How to test: 
* wscat -c ws://localhost:8765
* # After connecting, send：
* {"type":"start","sourceLang":"zh"}
*/

const PORT = 8765
// Browser Web Audio API default sample rate
const INCOMING_SAMPLE_RATE = 48000
const FLUSH_SECONDS = 3

type Channel = 'mic' | 'loopback'

interface Session {
  ws: WebSocket
  sourceLang: string
  sampleRate: number
  running: boolean
  micBuffer: Float32Array[]
  loopbackBuffer: Float32Array[]
  micSamples: number
  loopbackSamples: number
  // Prevent concurrent STT calls per channel
  micFlushing: boolean
  loopbackFlushing: boolean
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
    session.sourceLang = msg.sourceLang ?? 'zh'
    session.sampleRate = msg.sampleRate ?? INCOMING_SAMPLE_RATE
    session.running = true
    send(session.ws, { type: 'status', state: 'listening' })
    console.log(`[Server] Started — lang: ${session.sourceLang}`)
  } else if (msg.type === 'stop') {
    session.running = false
    send(session.ws, { type: 'status', state: 'idle' })
    console.log('[Server] Stopped')
  }
}

async function flushBuffer(session: Session, channel: Channel) {
  const buffer = channel === 'mic' ? session.micBuffer : session.loopbackBuffer
  if (buffer.length === 0) return

  // Snapshot and reset
  const chunks = buffer.splice(0)
  if (channel === 'mic') session.micSamples = 0
  else session.loopbackSamples = 0

  // Concat chunks
  const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0)
  const combined = new Float32Array(totalSamples)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }

  send(session.ws, { type: 'status', state: 'processing' })

  try {
    const text = await transcribe(combined, session.sampleRate, session.sourceLang)
    if (text) {
      send(session.ws, { type: 'transcript', channel, text, final: true })
    }
  } catch (err) {
    send(session.ws, { type: 'error', message: String(err) })
  }

  if (session.running) {
    send(session.ws, { type: 'status', state: 'listening' })
  }

  if (channel === 'mic') session.micFlushing = false
  else session.loopbackFlushing = false
}

function handleAudio(session: Session, data: Buffer) {
  if (!session.running) return

  const channel: Channel = data[0] === 0 ? 'mic' : 'loopback'
  // Float32Array requires 4-byte aligned offset; copy PCM bytes into a fresh ArrayBuffer
  const pcmByteLength = data.length - 1
  const ab = new ArrayBuffer(pcmByteLength)
  new Uint8Array(ab).set(new Uint8Array(data.buffer, data.byteOffset + 1, pcmByteLength))
  const pcm = new Float32Array(ab)

  if (channel === 'mic') {
    session.micBuffer.push(pcm.slice())
    session.micSamples += pcm.length
    if (session.micSamples >= session.sampleRate * FLUSH_SECONDS && !session.micFlushing) {
      session.micFlushing = true
      flushBuffer(session, 'mic')
    }
  } else {
    session.loopbackBuffer.push(pcm.slice())
    session.loopbackSamples += pcm.length
    if (session.loopbackSamples >= session.sampleRate * FLUSH_SECONDS && !session.loopbackFlushing) {
      session.loopbackFlushing = true
      flushBuffer(session, 'loopback')
    }
  }
}

async function main() {
  await loadModel('tiny')

  const wss = new WebSocketServer({ port: PORT })
  console.log(`[Server] WebSocket listening on ws://localhost:${PORT}`)

  wss.on('connection', (ws) => {
    console.log('[Server] Client connected')

    const session: Session = {
      ws,
      sourceLang: 'zh',
      sampleRate: INCOMING_SAMPLE_RATE,
      running: false,
      micBuffer: [],
      loopbackBuffer: [],
      micSamples: 0,
      loopbackSamples: 0,
      micFlushing: false,
      loopbackFlushing: false,
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
