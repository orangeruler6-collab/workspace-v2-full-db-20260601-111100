import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const rootDir = dirname(fileURLToPath(import.meta.url))
const apiProxyTimeoutMs = Number(process.env.VITE_API_PROXY_TIMEOUT_MS || 600000)

export default defineConfig({
  root: rootDir,
  publicDir: false,
  plugins: [vue()],
  server: {
    watch: {
      ignored: [
        '**/apps/account-style-library/.next/**',
        '**/apps/account-style-library/node_modules/**'
      ]
    },
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: [
      'localhost',
      'usagi.local',
      'style.usagi.local',
      'api.usagi.local',
      'content-board.changwankeji.com',
      'frp-hat.com',
      'www.racvv49tc.nyat.app',
      'www-nas.racvv49tc.nyat.app',
      'racvv49tc.nyat.app'
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:5555',
        changeOrigin: true,
        rewrite: (path) => path,
        timeout: apiProxyTimeoutMs,
        proxyTimeout: apiProxyTimeoutMs
      },
      '/uploads': {
        target: 'http://localhost:5555',
        changeOrigin: true,
        rewrite: (path) => path,
        timeout: 120000
      },
      '/raw_bf': {
        target: 'http://localhost:5555',
        changeOrigin: true,
        rewrite: (path) => path,
        timeout: 120000
      },
      '/style-workbench': {
        target: 'http://localhost:3100',
        changeOrigin: true,
        rewrite: (path) => path,
        timeout: 120000
      },
      '/v1': {
        target: 'http://127.0.0.1:18789',
        changeOrigin: true,
        rewrite: (path) => path
      }
    }
  }
})
