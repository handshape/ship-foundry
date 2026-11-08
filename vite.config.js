import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// Ship Foundry is purely client-side, so the build must be host-agnostic
// (relative base) so `dist/` can be dropped on any static host or opened directly.
export default defineConfig({
  plugins: [tailwindcss()],
  base: './',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
})
