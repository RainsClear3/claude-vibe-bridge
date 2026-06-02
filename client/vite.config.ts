import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 3901,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3900',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3900',
      },
    },
  },
});
