import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // App.jsx・依存JSをすべてキャッシュ
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // Supabase APIはネットワーク優先（オンライン時は常に最新を取得）
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/scoggdtvfvkecudbxztw\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
      manifest: {
        name: '水上スキー 団体戦ダッシュボード',
        short_name: 'WaterSki',
        description: '慶應水上スキー 団体戦スコア管理',
        theme_color: '#08101e',
        background_color: '#08101e',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
})
