import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Same aliases as electron.vite.config.ts / tsconfig.web.json. Node environment by default; a test
// that needs the DOM opts in with a `// @vitest-environment jsdom` (or happy-dom) comment.
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
