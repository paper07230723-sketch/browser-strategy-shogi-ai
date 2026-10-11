import { defineConfig } from 'vite';

export default defineConfig({
  base: '/browser-strategy-shogi-ai/',
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
});