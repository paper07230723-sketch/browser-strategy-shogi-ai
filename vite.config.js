
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/browser-strategy-shogi-ai/',

  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },

  build: {
    rollupOptions: {
     input: {
      main: resolve(process.cwd(), 'index.html'),
      game: resolve(process.cwd(), 'game.html'),
      analysis: resolve(process.cwd(), 'analysis.html')
     }
    }
  }
});
