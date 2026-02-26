import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dest = path.join(root, 'src/renderer/public')
const require = createRequire(import.meta.url)

fs.mkdirSync(dest, { recursive: true })

function copyGlob(srcDir, extensions) {
  const files = fs.readdirSync(srcDir)
  for (const file of files) {
    if (extensions.some((ext) => file.endsWith(ext))) {
      fs.copyFileSync(path.join(srcDir, file), path.join(dest, file))
    }
  }
}

// Find package root by walking up from the resolved main entry
function findPackageRoot(packageName) {
  const mainFile = require.resolve(packageName)
  let dir = path.dirname(mainFile)
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`Cannot find root for ${packageName}`)
    dir = parent
  }
}

// onnxruntime-web: copy .mjs and .wasm files
copyGlob(path.join(findPackageRoot('onnxruntime-web'), 'dist'), ['.mjs', '.wasm'])

// @ricky0123/vad-web: copy model and worklet files
copyGlob(path.join(findPackageRoot('@ricky0123/vad-web'), 'dist'), [
  '.onnx',
  'vad.worklet.bundle.min.js',
])

console.log('WASM assets copied to src/renderer/public/')
