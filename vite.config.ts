/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves project sites from /<repo>/, so the production build must
// be based at /IngotCAD/. The deploy workflow sets GITHUB_PAGES=true; local dev,
// preview and root/custom-domain builds stay at '/'.
const base = process.env.GITHUB_PAGES === 'true' ? '/IngotCAD/' : '/'

// https://vite.dev/config/
export default defineConfig({
  base,
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
        name: 'Ingot',
        short_name: 'Ingot',
        description: 'Open-source web 3D CAD for hobbyist 3D printing.',
        theme_color: '#15161b',
        background_color: '#15161b',
        display: 'standalone',
        // Relative URLs resolve against the manifest's own location (<base>/),
        // so the PWA installs correctly whether served from '/' or '/IngotCAD/'.
        start_url: '.',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
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
