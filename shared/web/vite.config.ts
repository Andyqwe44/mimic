// ═══ Vite config — production build for MimicClient WebView2 ═══
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// PC: version.h. Android APK build may pass VITE_APP_VERSION=0.1.x
const versionHeader = readFileSync(
  fileURLToPath(new URL('../../pc/client/src/version.h', import.meta.url)),
  'utf8',
)
const appVersion =
  process.env.VITE_APP_VERSION ||
  versionHeader.match(/APP_VERSION\s+"([^"]+)"/)?.[1] ||
  '0.0.0'

export default defineConfig({
  // Relative base so file:///android_asset/www/ and gam.local both resolve assets
  base: './',
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
})
