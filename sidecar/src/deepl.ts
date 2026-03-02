import * as deepl from 'deepl-node'

const apiKey = process.env.DEEPL_API_KEY
let translator: deepl.Translator | null = null

function getTranslator(): deepl.Translator {
  if (!translator) {
    if (!apiKey) throw new Error('[DeepL] DEEPL_API_KEY not set in .env')
    translator = new deepl.Translator(apiKey)
  }
  return translator
}

export async function translateText(
  text: string,
  targetLang: deepl.TargetLanguageCode,
  id: string,
): Promise<string> {
  if (!text.trim()) return ''
  const t = Date.now()
  const result = await getTranslator().translateText(text, null, targetLang)
  const translated = Array.isArray(result) ? result[0].text : result.text
  console.log(`[DeepL] [${id}] ${Date.now() - t}ms → "${translated}"`)
  return translated
}
