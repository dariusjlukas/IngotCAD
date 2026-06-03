/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg'],
      workbox: {
        // Precache the app + WASM so it works fully offline once loaded.
        globPatterns: ['**/*.{js,css,html,wasm,svg}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: 'Hobby CAD',
        short_name: 'HobbyCAD',
        description: 'Open-source web 3D CAD for hobbyist 3D printing.',
        theme_color: '#15161b',
        background_color: '#15161b',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  // Manifold ships a pre-built ESM + .wasm bundle; pre-bundling it with esbuild
  // breaks the WASM lookup, so exclude it from dep optimization.
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
