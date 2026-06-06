import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.claudevibebridge.app',
  appName: 'VibeBridge',
  version: '0.1.4',
  webDir: 'client/dist',
  server: {
    androidScheme: 'http'
  }
};

export default config;
