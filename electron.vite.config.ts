import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

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
    plugins: [react(), tailwindcss()],
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
