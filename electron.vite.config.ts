import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

// Serve ORT WASM .mjs files from public/ before Vite's module transform middleware,
// which would otherwise block dynamic imports of public-dir files.
function servePublicOrtWasm() {
  return {
    name: 'serve-public-ort-wasm',
    configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { setHeader: (k: string, v: string) => void; end: (d: Buffer) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (/\/ort-wasm.*\.mjs$/.test(url)) {
          const filePath = path.join(__dirname, 'src/renderer/public', url)
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'application/javascript')
            res.end(fs.readFileSync(filePath))
            return
          }
        }
        next()
      })
    },
  }
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      lib: { entry: 'src/electron/main.ts' },
    },
  },
  preload: {
    build: {
      externalizeDeps: true,
      lib: { entry: 'src/electron/preload.ts' },
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.js',
        },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss(), servePublicOrtWasm()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/renderer'),
      },
    },
    build: {
      rollupOptions: {
        input: 'src/renderer/index.html',
      },
    },
  },
})
