import { readFileSync } from 'fs'
import { WebSocket } from 'ws'

// Usage: pnpm tsx src/sidecar/test-server.ts [file.wav] [lang]
// Example: pnpm tsx src/sidecar/test-server.ts ./datas/test-eng.wav en
const wavPath = process.argv[2] ?? './datas/test-eng.wav'
const language = process.argv[3] ?? 'zh'

const { samples, sampleRate } = readWav(wavPath)
console.log(`Audio : ${wavPath}`)
console.log(`WAV   : ${sampleRate}Hz, ${samples.length} samples (${(samples.length / sampleRate).toFixed(2)}s)`)
console.log('---')

const ws = new WebSocket('ws://localhost:8765')

ws.on('open', () => {
  console.log('[Client] Connected')

  ws.send(JSON.stringify({ type: 'start', sourceLang: language, sampleRate }))

  // Send PCM in chunks of 4096 samples (typical Web Audio API chunk size)
  const CHUNK_SIZE = 4096
  for (let i = 0; i < samples.length; i += CHUNK_SIZE) {
    const chunk = samples.slice(i, i + CHUNK_SIZE)
    // [1 byte channel=mic(0)][Float32Array PCM]
    const frame = new Uint8Array(1 + chunk.byteLength)
    frame[0] = 0 // mic channel
    frame.set(new Uint8Array(chunk.buffer), 1)
    ws.send(frame)
  }

  console.log(`[Client] Sent ${samples.length} samples in chunks of ${CHUNK_SIZE}`)
})

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.type === 'transcript') {
    console.log(`[Transcript] (${msg.channel}) ${msg.text}`)
    ws.close()
  } else if (msg.type === 'status') {
    console.log(`[Status] ${msg.state}`)
  } else if (msg.type === 'error') {
    console.error(`[Error] ${msg.message}`)
    ws.close()
  }
})

ws.on('error', (err) => {
  console.error('[Client] Connection error:', err.message)
  console.error('Make sure the server is running: pnpm sidecar')
  process.exit(1)
})

// --- WAV parser ---

function readWav(filePath: string): { samples: Float32Array; sampleRate: number } {
  const buf = readFileSync(filePath)

  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Not a WAV file')
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAVE file')

  let offset = 12
  let sampleRate = 0
  let numChannels = 0
  let bitsPerSample = 0
  let dataOffset = 0
  let dataSize = 0

  while (offset < buf.length - 8) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    offset += 8

    if (chunkId === 'fmt ') {
      numChannels = buf.readUInt16LE(offset + 2)
      sampleRate = buf.readUInt32LE(offset + 4)
      bitsPerSample = buf.readUInt16LE(offset + 14)
    } else if (chunkId === 'data') {
      dataOffset = offset
      dataSize = chunkSize
      break
    }

    offset += chunkSize + (chunkSize % 2)
  }

  if (!sampleRate || !dataOffset) throw new Error('Invalid WAV: missing fmt or data chunk')

  const bytesPerSample = bitsPerSample / 8
  const numSamples = Math.floor(dataSize / (bytesPerSample * numChannels))
  const samples = new Float32Array(numSamples)

  for (let i = 0; i < numSamples; i++) {
    let sum = 0
    for (let c = 0; c < numChannels; c++) {
      const pos = dataOffset + (i * numChannels + c) * bytesPerSample
      if (bitsPerSample === 16) {
        sum += buf.readInt16LE(pos) / 32768.0
      } else if (bitsPerSample === 32) {
        sum += buf.readFloatLE(pos)
      } else if (bitsPerSample === 8) {
        sum += (buf.readUInt8(pos) - 128) / 128.0
      }
    }
    samples[i] = sum / numChannels
  }

  return { samples, sampleRate }
}
