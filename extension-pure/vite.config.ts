import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync } from 'fs'

const apiPort = process.env.VITE_API_PORT || '4936';
const target = `http://127.0.0.1:${apiPort}`;

const getPackageVersion = () => {
  try {
    const rootPackagePath = path.resolve(__dirname, '../package.json');
    const rootPackageJson = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
    return rootPackageJson.version;
  } catch {
    return 'unknown';
  }
};

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(getPackageVersion()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../frontend/src'),
    },
  },
  build: {
    outDir: 'sidepanel/app',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'syntax-highlighting': ['prismjs', 'react-syntax-highlighter'],
          'ui-components': ['lucide-react', 'react-icons'],
        },
      },
    },
  },
  server: {
    port: 3001,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/slides': { target, changeOrigin: true },
      '/media': { target, changeOrigin: true },
    },
  },
})
