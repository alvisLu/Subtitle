import { pipeline } from '@huggingface/transformers'

export type ModelSize = 'tiny' | 'base' | 'small'

const MODELS: Record<ModelSize, string> = {
  tiny: 'Xenova/whisper-tiny',
  base: 'Xenova/whisper-base',
  small: 'Xenova/whisper-small',
}

// Pipeline union type is too complex for TS to represent directly
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null

export async function loadModel(size: ModelSize = 'base'): Promise<void> {
  const modelId = MODELS[size]
  console.log(`[STT] Loading ${modelId} ...`)
  const t = Date.now()
  // @ts-ignore — pipeline overloads produce a union type too complex for TS
  transcriber = await pipeline('automatic-speech-recognition', modelId)
  console.log(`[STT] Ready in ${Date.now() - t}ms`)
}

export async function transcribe(
  audio: Float32Array,
  sampleRate: number,
  language = 'zh',
): Promise<string> {
  if (!transcriber) throw new Error('[STT] Call loadModel() first')

  const resampled = sampleRate === 16000 ? audio : resample(audio, sampleRate)

  const t = Date.now()
  const result = await transcriber(resampled, { language, task: 'transcribe', num_beams: 5, temperature: 0 })
  const text: string = (Array.isArray(result) ? result.map((r: { text: string }) => r.text).join('') : result.text).trim()

  console.log(`[STT] ${Date.now() - t}ms → "${text}"`)
  return text
}

/** Linear interpolation resample to 16000 Hz */
function resample(input: Float32Array, fromRate: number, toRate = 16000): Float32Array {
  const ratio = fromRate / toRate
  const length = Math.ceil(input.length / ratio)
  const output = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    output[i] = idx + 1 < input.length
      ? input[idx] * (1 - frac) + input[idx + 1] * frac
      : input[idx]
  }
  return output
}
