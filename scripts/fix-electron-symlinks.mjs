import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// Only needed on macOS
if (process.platform !== 'darwin') process.exit(0)

const frameworksDir = path.join(
  root,
  'node_modules/electron/dist/Electron.app/Contents/Frameworks',
)

if (!fs.existsSync(frameworksDir)) {
  console.log('[fix-electron-symlinks] Electron not found, skipping.')
  process.exit(0)
}

function ensureSymlink(target, linkPath) {
  if (fs.existsSync(linkPath)) return
  fs.symlinkSync(target, linkPath)
  console.log(`[fix-electron-symlinks] Created: ${path.relative(root, linkPath)} -> ${target}`)
}

// Fix each .framework bundle under Frameworks/
for (const entry of fs.readdirSync(frameworksDir)) {
  if (!entry.endsWith('.framework')) continue
  const fw = path.join(frameworksDir, entry)
  const versionsDir = path.join(fw, 'Versions')
  if (!fs.existsSync(versionsDir)) continue

  // Versions/Current -> A
  ensureSymlink('A', path.join(versionsDir, 'Current'))

  // Top-level symlinks -> Versions/Current/<name>
  const aDir = path.join(versionsDir, 'A')
  for (const file of fs.readdirSync(aDir)) {
    ensureSymlink(path.join('Versions', 'Current', file), path.join(fw, file))
  }
}

console.log('[fix-electron-symlinks] Done.')
