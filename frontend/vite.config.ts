import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import fs from 'fs'

// Core features (Dashboard, Today, Work, Knowledge, System, Brain)
const coreFeaturesPath = path.resolve(__dirname, './src/features/core')
const coreAvailable = fs.existsSync(coreFeaturesPath)

export default defineConfig({
  resolve: {
    alias: [
      { find: '@features/core', replacement: coreFeaturesPath },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
    // Dedupe to ensure single instances of dependencies
    dedupe: [
      'react', 'react-dom', 'react-router-dom',
      'lucide-react', 'axios', 'recharts', '@hello-pangea/dnd',
      '@tldraw/tldraw',
    ],
    // Ensure external features can resolve dependencies from this project's node_modules
    preserveSymlinks: false,
  },
  // Optimize deps to pre-bundle external feature dependencies
  optimizeDeps: {
    include: [
      'react', 'react-dom', 'react-router-dom',
      'lucide-react', 'axios', 'recharts', '@hello-pangea/dnd',
      '@tldraw/tldraw', 'd3', 'echarts', 'mermaid', 'react-grid-layout', 'reactflow',
    ],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/],
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'logo-color.png', 'logo-white.png'],
      manifest: {
        name: '悦升云端',
        short_name: 'ZenithJoy',
        description: '内部运营中台 - 统一管理多平台社媒运营数据',
        theme_color: '#1e3a8a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/logo-color.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/logo-white.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'monochrome'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/dashboard\.zenjoymedia\.media:.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 // 24 hours
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  server: {
    port: 3001,
    allowedHosts: [
      'localhost',
      'dev-core.zenjoymedia.media',
      'dev-autopilot.zenjoymedia.media',
      'core.zenjoymedia.media',
      'autopilot.zenjoymedia.media',
    ],
    proxy: {
      // Brain API (Seats, Tick, etc.)
      '/api/brain': {
        target: 'http://localhost:5221',
        changeOrigin: true,
      },
      // Other APIs
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
