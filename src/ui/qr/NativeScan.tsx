import { useEffect, useRef, useState } from 'react';
import { type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { pipsRoute } from './links';

/*
 * The Android app's scanner: the app's own QrScanner plugin
 * (android/.../QrScannerPlugin.java), which uses Android's camera, with its
 * autofocus, and ZXing to read the codes, all on the phone, so it works offline.
 * The camera is drawn behind the page; while scanning, the page is made
 * transparent (the native-scan class in app.css) except for this screen's
 * frame and hint.
 */

interface QrScannerPlugin {
  /** Asks for the camera permission if needed, then shows the camera and starts reading. */
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  addListener(event: 'qrScanned', listener: (e: { text: string }) => void): Promise<PluginListenerHandle>;
}
const QrScanner = registerPlugin<QrScannerPlugin>('QrScanner');
export function NativeScan({ go }: { go: (hash: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [notPips, setNotPips] = useState(false);
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    let live = true;
    const handles: PluginListenerHandle[] = [];
    const root = document.documentElement;
    (async () => {
      handles.push(
        await QrScanner.addListener('qrScanned', ({ text }) => {
          const route = pipsRoute(text);
          if (route && live) goRef.current(route);
          else if (live) setNotPips(true);
        }),
      );
      if (!live) return;
      root.classList.add('native-scan');
      await QrScanner.startScan();
      // Closed while the camera was starting: stop it again.
      if (!live) await QrScanner.stopScan();
    })().catch((e: Error) => live && setError(e.message || 'Could not start the camera.'));
    return () => {
      live = false;
      root.classList.remove('native-scan');
      handles.forEach((h) => h.remove());
      QrScanner.stopScan().catch(() => {});
    };
  }, []);

  return (
    <div className="scan native">
      <div className="play-bar scan-panel">
        <button className="btn ghost" onClick={() => go('#/more')}>
          ← Back
        </button>
        <strong>Scan a puzzle</strong>
        <span />
      </div>
      {error ? (
        <p className="panel">{error}</p>
      ) : (
        <>
          <div className="scan-view">
            <div className="scan-frame" />
          </div>
          <div className="scan-panel">
            <p className="small center">
              {notPips ? "That QR code isn't a Pips puzzle." : 'Point the camera at a Pips QR code (Share ▾ → Show QR code). No internet needed.'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
