import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function devApiProxyTarget(): string {
  const fromEnv = process.env.VITE_API_PROXY_TARGET?.trim()
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '')
  }
  try {
    const portFile = path.join(__dirname, 'server', '.dev-api-port')
    const raw = fs.readFileSync(portFile, 'utf8').trim()
    if (/^\d+$/.test(raw)) {
      return `http://127.0.0.1:${raw}`
    }
  } catch {
    /* file missing before backend starts */
  }
  return 'http://127.0.0.1:8080'
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'tiptap-markdown',
              test: /node_modules[\\/]@tiptap[\\/]markdown/,
              priority: 30,
            },
            {
              name: 'tiptap-prosemirror',
              test: /node_modules[\\/](?:@tiptap[\\/]pm|prosemirror-)/,
              priority: 20,
            },
            {
              name: 'app-store',
              test: /[\\/]src[\\/]store\.tsx$/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: devApiProxyTarget(),
        changeOrigin: true,
      },
    },
  },
})
