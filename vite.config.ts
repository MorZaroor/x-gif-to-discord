import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Set GITHUB_PAGES=true in CI for project Pages (username.github.io/repo-name/).
const base = process.env.GITHUB_PAGES === 'true' ? '/x-gif-to-discord/' : '/'

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      input: {
        main: resolve('index.html'),
        editor: resolve('editor.html'),
      },
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
