import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), tailwind(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['mark.svg', 'apple-touch-icon.png'],
    manifest: {
      id: '/', name: 'Turnierleitung', short_name: 'Turnierleitung', lang: 'de',
      description: 'Spielplan und Live-Ergebnisse für deinen Turniertag',
      start_url: '/', scope: '/', display: 'standalone',
      background_color: '#edf0f4', theme_color: '#244a78',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/auth\//, /^\/rest\//],
      cleanupOutdatedCaches: true, clientsClaim: true,
    },
  })],
  test: { include: ['src/**/*.test.ts'] },
})
