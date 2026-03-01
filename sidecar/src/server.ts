import { WebSocketServer, WebSocket } from 'ws'
import { loadModel, transcribe, translate, STT_BASE_CONFIG } from './stt.ts'
import {
  denoiseAudio,
  parseAudioFrame,
  buildDenoisedFrame,
  rms,
} from './dsp.ts'

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
type Mode = 'transcript' | 'translate'

interface ChannelState {
  processing: boolean
  streamBuffer: Float32Array[]
  interimTimer: ReturnType<typeof setTimeout> | null
  pendingFinal: Float32Array | null
  pendingFinalId: number
  currentId: number
}

interface Session {
  ws: WebSocket
  sourceLang: string
  sampleRate: number
  mode: Mode
  running: boolean
  channels: Record<Channel, ChannelState>
}

function makeChannelState(): ChannelState {
  return {
    processing: false,
    streamBuffer: [],
    interimTimer: null,
    pendingFinal: null,
    pendingFinalId: 0,
    currentId: 0,
  }
}

function send(ws: WebSocket, payload: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function handleControl(session: Session, raw: string) {
  let msg: {
    type: string
    sourceLang?: string
    sampleRate?: number
    mode?: Mode
  }
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }

  if (msg.type === 'start') {
    session.sourceLang = msg.sourceLang ?? DEFAULT_LANG
    session.sampleRate = msg.sampleRate ?? INCOMING_SAMPLE_RATE
    session.mode = msg.mode ?? 'transcript'
    session.running = true
    send(session.ws, { type: 'status', state: 'listening' })
    send(session.ws, {
      type: 'config',
      config: { language: session.sourceLang, ...STT_BASE_CONFIG },
    })
    console.log(
      `[Server] Started — lang: ${session.sourceLang}, mode: ${session.mode}`,
    )
  } else if (msg.type === 'setLang') {
    session.sourceLang = msg.sourceLang ?? session.sourceLang
    console.log(`[Server] Language changed to: ${session.sourceLang}`)
  } else if (msg.type === 'setMode') {
    session.mode = msg.mode ?? session.mode
    console.log(`[Server] Mode changed to: ${session.mode}`)
  } else if (msg.type === 'stop') {
    session.running = false
    send(session.ws, { type: 'status', state: 'idle' })
    console.log('[Server] Stopped')
  }
}

function mergeBuffer(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((s, f) => s + f.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const f of chunks) {
    out.set(f, offset)
    offset += f.length
  }
  return out
}

function runPendingFinal(session: Session, channel: Channel) {
  const ch = session.channels[channel]
  if (!ch.pendingFinal) return
  const pcm = ch.pendingFinal
  const id = ch.pendingFinalId
  ch.pendingFinal = null
  ch.processing = true
  transcribeSegment(session, pcm, channel, id).finally(() => {
    ch.processing = false
  })
}

async function transcribeInterim(
  session: Session,
  pcm: Float32Array,
  channel: Channel,
  id: number,
) {
  // Skip near-silent interim frames (Float32 RMS < 0.01 ≈ inaudible)
  if (rms(pcm) < 0.01) return
  const denoised = denoiseAudio(pcm, session.sampleRate)
  try {
    if (session.mode === 'translate') {
      const { original, translated } = await translate(
        denoised,
        session.sampleRate,
        session.sourceLang,
      )
      if (original)
        send(session.ws, {
          type: 'transcript',
          channel,
          id,
          text: original,
          final: false,
        })
      if (translated)
        send(session.ws, {
          type: 'translation',
          channel,
          id,
          text: translated,
          final: false,
        })
    } else {
      const text = await transcribe(
        denoised,
        session.sampleRate,
        session.sourceLang,
      )
      if (text)
        send(session.ws, { type: 'transcript', channel, id, text, final: false })
    }
  } catch {
    // ignore interim errors silently
  }
}

async function transcribeSegment(
  session: Session,
  pcm: Float32Array,
  channel: Channel,
  id: number,
) {
  // Skip silent audio as a safety net (VAD should have already filtered silence)
  const segmentRms = rms(pcm)
  if (segmentRms < 0.01) {
    console.log(
      `[Server] Skipping silent ${channel} segment (rms=${segmentRms.toFixed(4)})`,
    )
    return
  }

  const denoised = denoiseAudio(pcm, session.sampleRate)

  // Send denoised PCM back to Electron as binary frame: [0xDA][channel][id][Float32Array bytes]
  if (session.ws.readyState === session.ws.OPEN) {
    session.ws.send(buildDenoisedFrame(denoised, channel, id))
  }

  send(session.ws, { type: 'status', state: 'processing' })

  try {
    if (session.mode === 'translate') {
      const { original, translated } = await translate(
        denoised,
        session.sampleRate,
        session.sourceLang,
      )
      if (original) {
        send(session.ws, {
          type: 'transcript',
          channel,
          id,
          text: original,
          final: true,
        })
      }
      if (translated) {
        send(session.ws, {
          type: 'translation',
          channel,
          id,
          text: translated,
          final: true,
        })
      }
    } else {
      const text = await transcribe(
        denoised,
        session.sampleRate,
        session.sourceLang,
      )
      if (text) {
        send(session.ws, { type: 'transcript', channel, id, text, final: true })
      }
    }
  } catch (err) {
    send(session.ws, { type: 'error', message: String(err) })
  }

  if (session.running) {
    send(session.ws, { type: 'status', state: 'listening' })
  }
}

function handleAudio(session: Session, data: Buffer) {
  if (!session.running) return

  const { isFinal, channel, id, pcm } = parseAudioFrame(data)
  const ch = session.channels[channel]
  ch.currentId = id

  if (!isFinal) {
    // Interim chunk: append to growing buffer, debounce Whisper run
    ch.streamBuffer.push(pcm)
    if (ch.interimTimer) clearTimeout(ch.interimTimer)
    ch.interimTimer = setTimeout(() => {
      ch.interimTimer = null
      if (ch.processing || ch.streamBuffer.length === 0) return
      const merged = mergeBuffer(ch.streamBuffer)
      ch.processing = true
      transcribeInterim(session, merged, channel, ch.currentId).finally(() => {
        ch.processing = false
        runPendingFinal(session, channel)
      })
    }, 200)
    return
  }

  // Final chunk: clear stream state, run definitive transcription
  if (ch.interimTimer) {
    clearTimeout(ch.interimTimer)
    ch.interimTimer = null
  }
  ch.streamBuffer = []

  if (ch.processing) {
    ch.pendingFinal = pcm
    ch.pendingFinalId = id
    return
  }
  ch.processing = true
  transcribeSegment(session, pcm, channel, id).finally(() => {
    ch.processing = false
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
      mode: 'transcript',
      running: false,
      channels: {
        mic: makeChannelState(),
        loopback: makeChannelState(),
      },
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
