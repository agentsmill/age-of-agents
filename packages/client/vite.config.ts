import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  build: {
    // Wspólny katalog dystrybucji w korzeniu repo (root/dist/web).
    outDir: fileURLToPath(new URL('../../dist/web', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8123', ws: true },
      '/hooks': 'http://127.0.0.1:8123',
      '/health': 'http://127.0.0.1:8123',
      '/building-stats': 'http://127.0.0.1:8123',
    },
  },
});
