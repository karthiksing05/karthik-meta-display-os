import { defineConfig } from 'vite';

// In dev, the relay runs on :8787 and Vite proxies the socket and API to it,
// so the app always talks to its own origin (same as in production).
export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/api': 'http://localhost:8787',
      '/spotify': 'http://localhost:8787',
      '/install': 'http://localhost:8787',
    },
  },
  build: { target: 'es2020', assetsInlineLimit: 0 },
});
