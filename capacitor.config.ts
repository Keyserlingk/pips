import type { CapacitorConfig } from '@capacitor/cli';

// The Android app: the built site (dist/) wrapped in a native shell. See README.
const config: CapacitorConfig = {
  appId: 'io.github.keyserlingk.pips',
  appName: 'Pips',
  webDir: 'dist',
};

export default config;
