import { readFileSync } from 'fs'
import { loadModel, transcribe, ModelSize } from './stt.ts'

// Usage: pnpm test:stt [file.wav] [lang] [model: tiny|base|small]
// Example: `pnpm tsx src/sidecar/test-stt.ts ./datas/test-eng.wav en`
const wavPath = process.argv[2] ?? 'test.wav'
const language = process.argv[3] ?? 'zh'
const modelSize = (process.argv[4] ?? 'tiny') as ModelSize

console.log(`Audio : ${wavPath}`)
console.log(`Model : ${modelSize}`)
console.log(`Lang  : ${language}`)
console.log('---')

const { samples, sampleRate } = readWav(wavPath)
console.log(
  `WAV   : ${sampleRate}Hz, ${samples.length} samples (${(samples.length / sampleRate).toFixed(2)}s)`,
)
console.log('---')

await loadModel(modelSize)
await transcribe(samples, sampleRate, language)

// --- WAV parser ---

function readWav(filePath: string): {
  samples: Float32Array
  sampleRate: number
} {
  const buf = readFileSync(filePath)

  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Not a WAV file')
  if (buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Not a WAVE file')

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

    offset += chunkSize + (chunkSize % 2) // WAV chunks are word-aligned
  }

  if (!sampleRate || !dataOffset)
    throw new Error('Invalid WAV: missing fmt or data chunk')

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
    samples[i] = sum / numChannels // stereo → mono
  }

  return { samples, sampleRate }
}
