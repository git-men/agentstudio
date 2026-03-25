import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [tailwindcss(), react(), viteSingleFile()],
  base: '/',
  build: {
    outDir: 'dist',
    target: 'esnext',
    cssCodeSplit: false,
  },
})
