/* global process */

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
export default ({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'))
  const frontendEnv = loadEnv(mode, __dirname)

  // Merge env vars into the existing process.env object to avoid replacing it.
  Object.assign(process.env, rootEnv, frontendEnv)

  return defineConfig({
    plugins: [react()],
    build: {
    // Avoid CI failures from optional native lightningcss binaries on Linux runners.
    cssMinify: 'esbuild',
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) requires manualChunks as a function
        manualChunks(id) {
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) {
            return 'vendor-charts';
          }
          if (id.includes('@supabase')) {
            return 'vendor-supabase';
          }
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('react-router-dom')) {
            return 'vendor-react';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})

