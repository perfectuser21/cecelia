import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// Core features — point to workspace's own features directory
const coreFeaturesPath = path.resolve(__dirname, '../core/features')

export default defineConfig({
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
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'logo-color.png', 'logo-white.png'],
      manifest: {
        name: 'Cecelia',
        short_name: 'Cecelia',
        description: 'Cecelia - AI Butler System',
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
            urlPattern: /^https:\/\/.*\.zenjoymedia\.media\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24
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
                maxAgeSeconds: 60 * 60 * 24 * 365
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
                maxAgeSeconds: 60 * 60 * 24 * 30
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
    port: 5212,
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
