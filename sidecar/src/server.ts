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

/** High-pass RC filter (cutoff = 80 Hz) — removes hum, rumble, DC offset */
function highPassFilter(pcm: Float32Array, sampleRate: number): Float32Array {
  const RC = 1 / (2 * Math.PI * 80)
  const dt = 1 / sampleRate
  const alpha = RC / (RC + dt)
  const out = new Float32Array(pcm.length)
  out[0] = pcm[0]
  for (let i = 1; i < pcm.length; i++) {
    out[i] = alpha * (out[i - 1] + pcm[i] - pcm[i - 1])
  }
  return out
}

/**
 * Frame-level noise gate (20 ms frames).
 * Estimates noise floor from the quietest 20% of frames;
 * attenuates frames below 3× that threshold to 10% gain.
 */
function noiseGate(pcm: Float32Array, sampleRate: number): Float32Array {
  const frameSize = Math.floor(sampleRate * 0.02)
  const frameCount = Math.floor(pcm.length / frameSize)
  if (frameCount < 3) return pcm // too short to estimate noise floor

  const frameRms = new Float32Array(frameCount)
  for (let f = 0; f < frameCount; f++) {
    let sum = 0
    const start = f * frameSize
    for (let i = start; i < start + frameSize; i++) sum += pcm[i] * pcm[i]
    frameRms[f] = Math.sqrt(sum / frameSize)
  }

  const sorted = Float32Array.from(frameRms).sort()
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)]
  const gateThreshold = noiseFloor * 3

  const out = new Float32Array(pcm.length)
  for (let f = 0; f < frameCount; f++) {
    const gain = frameRms[f] >= gateThreshold ? 1.0 : 0.1
    const start = f * frameSize
    for (let i = start; i < start + frameSize; i++) out[i] = pcm[i] * gain
  }
  for (let i = frameCount * frameSize; i < pcm.length; i++) out[i] = pcm[i]
  return out
}

/**
 * RMS normalization — scales to TARGET_RMS, capped at MAX_GAIN
 * to avoid over-amplifying near-silent segments.
 */
function normalizeRms(pcm: Float32Array, targetRms = 0.1, maxGain = 20.0): Float32Array {
  let sumSq = 0
  for (let i = 0; i < pcm.length; i++) sumSq += pcm[i] * pcm[i]
  const rms = Math.sqrt(sumSq / pcm.length)
  if (rms === 0) return pcm
  const gain = Math.min(targetRms / rms, maxGain)
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * gain
  return out
}

function denoiseAudio(pcm: Float32Array, sampleRate: number): Float32Array {
  const hp = highPassFilter(pcm, sampleRate)
  const gated = noiseGate(hp, sampleRate)
  return normalizeRms(gated)
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

  const denoised = denoiseAudio(pcm, session.sampleRate)

  // Send denoised PCM back to electron as binary frame: [0xDA][Float32Array bytes]
  if (session.ws.readyState === session.ws.OPEN) {
    const pcmBytes = new Uint8Array(denoised.buffer, denoised.byteOffset, denoised.byteLength)
    const frame = new Uint8Array(1 + pcmBytes.byteLength)
    frame[0] = 0xda
    frame.set(pcmBytes, 1)
    session.ws.send(frame)
  }

  send(session.ws, { type: 'status', state: 'processing' })

  try {
    const text = await transcribe(denoised, session.sampleRate, session.sourceLang)
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
