import { defineConfig } from 'vite';
import { readFileSync } from 'fs';

// Read the app version from the project-root capacitor.config.ts so the
// client always sees the same version that ships in the APK.
const capacitorConfigPath = new URL('../capacitor.config.ts', import.meta.url);
const capacitorConfigRaw = readFileSync(capacitorConfigPath, 'utf-8');
const versionMatch = capacitorConfigRaw.match(/version:\s*['"]([^'"]+)['"]/);
const APP_VERSION = versionMatch?.[1] || '0.0.0';

export default defineConfig({
  root: '.',
  define: {
    // Available as a global at build time: const APP_VERSION = '0.1.4';
    'globalThis.__APP_VERSION__': JSON.stringify(APP_VERSION),
  },
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
