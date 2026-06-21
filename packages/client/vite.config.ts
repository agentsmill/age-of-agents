import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  build: {
    // Shared distribution directory at the repository root (root/dist/web).
    outDir: fileURLToPath(new URL('../../dist/web', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8123', ws: true },
      '/hooks': 'http://127.0.0.1:8123',
      '/health': 'http://127.0.0.1:8123',
      '/building-stats': 'http://127.0.0.1:8123',
      '/tool-mapping': 'http://127.0.0.1:8123',
      '/model-config': 'http://127.0.0.1:8123',
      '/permission-policy': 'http://127.0.0.1:8123',
      '/sessions': 'http://127.0.0.1:8123',
      '/fs': 'http://127.0.0.1:8123',
    },
  },
});
