import { pipeline } from '@huggingface/transformers'

export type ModelSize = 'tiny' | 'base' | 'small'

const MODELS: Record<ModelSize, string> = {
  tiny: 'onnx-community/whisper-tiny',
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small',
}

export const STT_BASE_CONFIG = {
  task: 'transcribe',
  num_beams: 5,
  temperature: 0,
  do_sample: false,
  condition_on_previous_text: false,
  ompression_ratio_threshold: 1.35,
  // no_repeat_ngram_size: 5,
  no_speech_threshold: 0.3,
  logprob_threshold: -1.0,
}

// Pipeline union type is too complex for TS to represent directly
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null

export async function loadModel(size: ModelSize = 'base'): Promise<void> {
  const modelId = MODELS[size]
  console.log(`[STT] Loading ${modelId} ...`)
  const t = Date.now()
  transcriber = await pipeline('automatic-speech-recognition', modelId)
  console.log(`[STT] Ready in ${Date.now() - t}ms`)
}

export async function translate(
  audio: Float32Array,
  sampleRate: number,
  language = 'zh',
): Promise<{ original: string; translated: string }> {
  if (!transcriber) throw new Error('[STT] Call loadModel() first')

  const resampled = sampleRate === 16000 ? audio : resample(audio, sampleRate)

  const t = Date.now()
  const [transcribeResult, translateResult] = await Promise.all([
    transcriber(resampled, { language, ...STT_BASE_CONFIG }),
    transcriber(resampled, {
      language, ...STT_BASE_CONFIG,
      task: 'translate',
    }),
  ])

  const original: string = (
    Array.isArray(transcribeResult)
      ? transcribeResult.map((r: { text: string }) => r.text).join('')
      : transcribeResult.text
  ).trim()

  const translated: string = (
    Array.isArray(translateResult)
      ? translateResult.map((r: { text: string }) => r.text).join('')
      : translateResult.text
  ).trim()

  console.log(`[STT] ${Date.now() - t}ms → "${original}" → "${translated}"`)
  return { original, translated }
}

export async function transcribe(
  audio: Float32Array,
  sampleRate: number,
  language = 'zh',
): Promise<string> {
  if (!transcriber) throw new Error('[STT] Call loadModel() first')

  const resampled = sampleRate === 16000 ? audio : resample(audio, sampleRate)

  const t = Date.now()
  const config = { language, ...STT_BASE_CONFIG }
  const result = await transcriber(resampled, config)
  const text: string = (
    Array.isArray(result)
      ? result.map((r: { text: string }) => r.text).join('')
      : result.text
  ).trim()

  console.log(`[STT] ${Date.now() - t}ms → "${text}"`)
  return text
}

/** Linear interpolation resample to 16000 Hz */
function resample(
  input: Float32Array,
  fromRate: number,
  toRate = 16000,
): Float32Array {
  const ratio = fromRate / toRate
  const length = Math.ceil(input.length / ratio)
  const output = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    output[i] =
      idx + 1 < input.length
        ? input[idx] * (1 - frac) + input[idx + 1] * frac
        : input[idx]
  }
  return output
}
