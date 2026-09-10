import { defineConfig } from 'vite'

// Set GITHUB_PAGES=true in CI for project Pages (username.github.io/repo-name/).
const base = process.env.GITHUB_PAGES === 'true' ? '/x-gif-to-discord/' : '/'

export default defineConfig({
  base,
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
