import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.claudevibebridge.app',
  appName: 'Claude Vibe Bridge',
  webDir: 'client/dist',
  server: {
    androidScheme: 'http'
  }
};

export default config;
