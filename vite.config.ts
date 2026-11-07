import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Tauri loads the bundle from disk, so the PWA service worker and the
// inspector plugin from the original template were removed: they only added
// startup work and bytes to every launch.
export default defineConfig({
  base: './',
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 3000,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    cssMinify: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 900,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
