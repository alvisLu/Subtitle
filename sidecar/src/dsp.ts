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
function normalizeRms(
  pcm: Float32Array,
  targetRms = 0.1,
  maxGain = 20.0,
): Float32Array {
  let sumSq = 0
  for (let i = 0; i < pcm.length; i++) sumSq += pcm[i] * pcm[i]
  const rms = Math.sqrt(sumSq / pcm.length)
  if (rms === 0) return pcm
  const gain = Math.min(targetRms / rms, maxGain)
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * gain
  return out
}

export function denoiseAudio(
  pcm: Float32Array,
  sampleRate: number,
): Float32Array {
  const hp = highPassFilter(pcm, sampleRate)
  const gated = noiseGate(hp, sampleRate)
  return normalizeRms(gated)
}

/** Parse a binary audio frame from the client.
 *  Frame format: [isFinal byte (0=interim, 1=final)][channel byte (0=mic, 1=loopback)][id: uint32LE 4 bytes][Float32 PCM bytes...]
 */
export function parseAudioFrame(data: Buffer): {
  isFinal: boolean
  channel: 'mic' | 'loopback'
  id: number
  pcm: Float32Array
} {
  const isFinal = data[0] === 1
  const channel = data[1] === 0 ? 'mic' : 'loopback'
  const id = data.readUInt32LE(2)
  // Float32Array requires 4-byte aligned offset; copy PCM bytes into a fresh ArrayBuffer
  const pcmByteLength = data.length - 6
  const ab = new ArrayBuffer(pcmByteLength)
  new Uint8Array(ab).set(
    new Uint8Array(data.buffer, data.byteOffset + 6, pcmByteLength),
  )
  return { isFinal, channel, id, pcm: new Float32Array(ab) }
}

/** Build the denoised-PCM binary frame sent back to Electron: [0xDA][channel: 0=mic,1=loopback][id: uint32LE 4 bytes][Float32Array bytes] */
export function buildDenoisedFrame(pcm: Float32Array, channel: 'mic' | 'loopback', id: number): Uint8Array {
  const pcmBytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const frame = new Uint8Array(6 + pcmBytes.byteLength)
  frame[0] = 0xda
  frame[1] = channel === 'mic' ? 0 : 1
  new DataView(frame.buffer).setUint32(2, id, true)
  frame.set(pcmBytes, 6)
  return frame
}

/** Returns RMS of a Float32Array */
export function rms(pcm: Float32Array): number {
  return Math.sqrt(pcm.reduce((s, v) => s + v * v, 0) / pcm.length)
}
