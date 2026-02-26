import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dest = path.join(root, 'src/renderer/public')

fs.mkdirSync(dest, { recursive: true })

function copyGlob(srcDir, extensions) {
  const files = fs.readdirSync(srcDir)
  for (const file of files) {
    if (extensions.some((ext) => file.endsWith(ext))) {
      fs.copyFileSync(path.join(srcDir, file), path.join(dest, file))
    }
  }
}

// onnxruntime-web: copy .mjs and .wasm files
copyGlob(path.join(root, 'node_modules/onnxruntime-web/dist'), ['.mjs', '.wasm'])

// @ricky0123/vad-web: copy model and worklet files
copyGlob(path.join(root, 'node_modules/@ricky0123/vad-web/dist'), [
  '.onnx',
  'vad.worklet.bundle.min.js',
])

console.log('WASM assets copied to src/renderer/public/')
