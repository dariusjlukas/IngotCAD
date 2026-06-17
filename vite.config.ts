/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Tauri sets TAURI_ENV_* env vars when it runs the before*Command for
// `tauri dev` / `tauri build`. In that case we're packaging the native desktop
// app: assets load from Tauri's local protocol and are bundled in the binary,
// so the PWA service worker is redundant (and would just log registration
// noise in the webview). Detect it to drop the SW and force the root base path.
const isTauri = !!process.env.TAURI_ENV_PLATFORM

// GitHub Pages serves project sites from /<repo>/, so the production *web* build
// must be based at /IngotCAD/. The deploy workflow sets GITHUB_PAGES=true; local
// dev, preview, the Tauri desktop build and root/custom-domain builds stay at '/'.
const base = !isTauri && process.env.GITHUB_PAGES === 'true' ? '/IngotCAD/' : '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    // The offline service worker only matters for the browser/PWA build — the
    // Tauri desktop app is already fully local — so skip it when packaging.
    ...(isTauri
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.svg', 'icon.svg'],
            workbox: {
              // Precache the app shell + WASM kernel + the Helvetiker font JSON
              // (the 3D-text tool fetches it) so everything works fully offline.
              // NOTE: keep `json` here — without it the font is silently left out
              // of the precache and the text tool breaks with no network.
              globPatterns: ['**/*.{js,css,html,wasm,svg,json}'],
              // The main JS chunk is ~1.6MB today; 8MB leaves headroom so a
              // growing bundle never gets silently dropped from the precache.
              maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
            },
            manifest: {
              name: 'Ingot',
              short_name: 'Ingot',
              description: 'Open-source web 3D CAD for hobbyist 3D printing.',
              theme_color: '#15161b',
              background_color: '#15161b',
              display: 'standalone',
              // Relative URLs resolve against the manifest's own location
              // (<base>/), so the PWA installs correctly from '/' or '/IngotCAD/'.
              start_url: '.',
              icons: [
                { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
              ],
            },
          }),
        ]),
  ],
  // Manifold ships a pre-built ESM + .wasm bundle; pre-bundling it with esbuild
  // breaks the WASM lookup, so exclude it from dep optimization.
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  // The engine worker is a module worker; the default iife format breaks if the
  // worker graph ever code-splits.
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
