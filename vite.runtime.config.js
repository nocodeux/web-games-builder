import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react({ jsxRuntime: 'classic' })],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  // Separate public dir so the warning about outDir inside publicDir is avoided
  publicDir: false,
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/runtime/gamePlayer.jsx'),
      name: 'TuifyPlayer',
      formats: ['iife'],
    },
    rollupOptions: {
      output: { entryFileNames: 'tuify-game.js' },
    },
    outDir: 'public/runtime',
    emptyOutDir: false,
    minify: true,
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@lib': path.resolve(__dirname, 'src/lib'),
    },
  },
});
