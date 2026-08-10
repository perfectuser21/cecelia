import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'child_process'
import type { Plugin } from 'vite'

// Core features — point to api's features directory (monorepo: core → api)
const coreFeaturesPath = path.resolve(__dirname, '../api/features')

function resolveBuildSha(): string {
  if (process.env.GIT_SHA) return process.env.GIT_SHA

  try {
    return execSync('git rev-parse HEAD', { cwd: __dirname }).toString().trim()
  } catch {
    return 'unknown'
  }
}

const buildSha = resolveBuildSha()

// 产物自报身份：把构建时的 git sha 烙进 build-info.json（deploy-local.sh 判变对账用）。
// emitFile 自动跟随 --outDir（deploy-local 构建到 .dist-staging，写死 dist/ 不行）。
// docker 构建容器（node:20-alpine）无 git，GIT_SHA 由 deploy-local.sh 以 -e 传入。
function buildInfoPlugin(): Plugin {
  return {
    name: 'build-info',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-info.json',
        source: JSON.stringify({ git_sha: buildSha, built_at: new Date().toISOString() }, null, 2),
      })
    },
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(buildSha),
  },
  resolve: {
    alias: [
      { find: '@features/core', replacement: coreFeaturesPath },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
    dedupe: [
      'react', 'react-dom', 'react-router-dom',
      'lucide-react', 'axios', 'recharts', '@hello-pangea/dnd',
    ],
    preserveSymlinks: false,
  },
  optimizeDeps: {
    include: [
      'react', 'react-dom', 'react-router-dom',
      'lucide-react', 'axios', 'recharts', '@hello-pangea/dnd',
    ],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/],
    },
  },
  plugins: [
    react(),
    buildInfoPlugin(),
  ],
  server: {
    port: 5211,
    host: '0.0.0.0',
    allowedHosts: [
      'localhost',
      'perfect21',
      
      'dev-autopilot.zenjoymedia.media',
      
      'autopilot.zenjoymedia.media',
    ],
    proxy: {
      '/api/brain/ws': {
        target: 'ws://localhost:5221',
        changeOrigin: true,
        ws: true,
      },
      '/api/brain': {
        target: 'http://localhost:5221',
        changeOrigin: true,
      },
      '/api/cecelia': {
        target: 'http://localhost:5221',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:5211',
        changeOrigin: true,
      }
    }
  }
})
