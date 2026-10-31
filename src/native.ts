import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/** Android app only: the back button goes back a screen, and leaves the app from the first one. */
export function setupNative() {
  if (!Capacitor.isNativePlatform()) return;
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) history.back();
    else App.exitApp();
  });
}
