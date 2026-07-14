import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const rootDir = dirname(fileURLToPath(import.meta.url))
const apiProxyTimeoutMs = Number(process.env.VITE_API_PROXY_TIMEOUT_MS || 600000)
const benignSocketErrorCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'])

function normalizeMalformedRequestUrl(value) {
  const raw = String(value || '')
  try {
    decodeURI(raw)
    return raw
  } catch (e) {
    const safePercent = raw.replace(/%(?![0-9A-Fa-f]{2})/g, '%25')
    try {
      decodeURI(safePercent)
      return safePercent
    } catch (inner) {
      return safePercent.replace(/%/g, '%25')
    }
  }
}

function isSensitiveLocalFileRequest(value) {
  const raw = String(value || '')
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch (e) {
    // Malformed escapes are handled by the regular URL normalizer.
  }
  const pathOnly = decoded.split(/[?#]/, 1)[0].replace(/\\/g, '/')
  // No browser-facing feature needs Vite's absolute-file endpoint. Blocking
  // every spelling also covers scanner variants such as /_nuxt/@fs and
  // malformed Windows paths before plugin-vue attempts to read them.
  if (/(?:^|\/)@fs(?:\/|[A-Za-z]:)/i.test(pathOnly)) return true

  // Dotfiles are never public assets. Match dot-directories too, not only a
  // dotfile in the final path segment (for example .aws/config).
  return /(?:^|\/)\.(?!well-known(?:\/|$))[^/]+(?:\/|$)/i.test(pathOnly)
}

function sanitizeMalformedRequestUriPlugin() {
  let processErrorGuardInstalled = false
  return {
    name: 'usagi-sanitize-malformed-request-uri',
    configureServer(server) {
      if (!processErrorGuardInstalled) {
        processErrorGuardInstalled = true
        process.on('uncaughtException', (err) => {
          if (benignSocketErrorCodes.has(err?.code)) {
            console.warn('[vite] swallowed socket reset:', err.code)
            return
          }
          throw err
        })
      }
      server.httpServer?.on('clientError', (err, socket) => {
        if (benignSocketErrorCodes.has(err?.code)) {
          socket.destroy()
          return
        }
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      })
      server.middlewares.use((req, res, next) => {
        const attachSocketErrorHandler = (socket, label) => {
          if (!socket || socket.__usagiErrorHandlerAttached) return
          socket.__usagiErrorHandlerAttached = true
          socket.on?.('error', (err) => {
            if (!benignSocketErrorCodes.has(err?.code)) {
              console.warn(`[vite] ${label} socket error:`, err?.message || err)
            }
          })
        }
        attachSocketErrorHandler(req.socket, 'request')
        attachSocketErrorHandler(res.socket, 'response')
        if (isSensitiveLocalFileRequest(req.url)) {
          res.statusCode = 404
          res.end('Not found')
          return
        }
        if (req.url) req.url = normalizeMalformedRequestUrl(req.url)
        next()
      })
    }
  }
}

function attachProxySocketGuards(proxy) {
  proxy.on('proxyReq', (proxyReq) => {
    proxyReq.on('error', (err) => {
      if (!benignSocketErrorCodes.has(err?.code)) {
        console.warn('[vite] proxy request socket error:', err?.message || err)
      }
    })
  })
  proxy.on('proxyRes', (proxyRes) => {
    proxyRes.on('error', (err) => {
      if (!benignSocketErrorCodes.has(err?.code)) {
        console.warn('[vite] proxy response socket error:', err?.message || err)
      }
    })
  })
}

function resilientProxyOptions(options) {
  return {
    ...options,
    configure(proxy) {
      options.configure?.(proxy)
      attachProxySocketGuards(proxy)
      proxy.on('error', (err, req, res) => {
        const detail = err?.message || 'proxy target unavailable'
        console.warn(`[vite] proxy target unavailable: ${req?.url || ''} ${detail}`)
        if (!res || res.destroyed) return
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
        }
        if (!res.writableEnded) {
          res.end(JSON.stringify({ ok: false, error: 'proxy target unavailable', detail }))
        }
      })
    }
  }
}

export default defineConfig({
  root: rootDir,
  publicDir: false,
  plugins: [sanitizeMalformedRequestUriPlugin(), vue()],
  server: {
    watch: {
      ignored: [        '**/data/**',
        '**/dist/**',
        '**/logs/**',
        '**/public/uploads/**',
        '**/watchdog-*.log'
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
      '/api': resilientProxyOptions({
        target: 'http://localhost:5555',
        changeOrigin: true,
        rewrite: (path) => path,
        timeout: apiProxyTimeoutMs,
        proxyTimeout: apiProxyTimeoutMs
      }),
      '/uploads': resilientProxyOptions({
        target: 'http://localhost:5555',
        changeOrigin: true,
        rewrite: (path) => path,
        timeout: 120000
      }),
      '/raw_bf': resilientProxyOptions({
        target: 'http://localhost:5555',
        changeOrigin: true,
        rewrite: (path) => path,
        timeout: 120000
      }),
      '/v1': resilientProxyOptions({
        target: 'http://127.0.0.1:18789',
        changeOrigin: true,
        rewrite: (path) => path
      })
    }
  }
})
