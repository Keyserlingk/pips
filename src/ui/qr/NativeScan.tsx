import { useEffect, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { BarcodeFormat, BarcodeScanner, Resolution } from '@capacitor-mlkit/barcode-scanning';
import { pipsRoute } from './links';

/*
 * The Android app's scanner: Android's own camera (with real autofocus) and
 * Google's ML Kit barcode reader, which ships inside the app, so it works
 * offline. The camera is drawn behind the page; while scanning, the page is
 * made transparent (the native-scan class in app.css) except for this screen's
 * frame and controls.
 */
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
      const { camera } = await BarcodeScanner.requestPermissions();
      if (camera !== 'granted' && camera !== 'limited') throw new Error('Pips needs the camera to scan. Allow camera access and try again.');
      handles.push(
        await BarcodeScanner.addListener('barcodesScanned', ({ barcodes }) => {
          const text = barcodes[0]?.rawValue;
          const route = text && pipsRoute(text);
          if (route && live) goRef.current(route);
          else if (text) setNotPips(true);
        }),
        await BarcodeScanner.addListener('scanError', ({ message }) => live && setError(message)),
      );
      if (!live) return;
      root.classList.add('native-scan');
      await BarcodeScanner.startScan({ formats: [BarcodeFormat.QrCode], resolution: Resolution['1920x1080'] });
      // Closed while the camera was starting: stop it again.
      if (!live) await BarcodeScanner.stopScan();
    })().catch((e: Error) => live && setError(e.message || 'Could not start the camera.'));
    return () => {
      live = false;
      root.classList.remove('native-scan');
      handles.forEach((h) => h.remove());
      BarcodeScanner.stopScan().catch(() => {});
    };
  }, []);

  return (
    <div className="scan native">
      <div className="play-bar scan-panel">
        <button className="btn ghost" onClick={() => go('#/')}>
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
