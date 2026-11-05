import { useEffect, useRef, useState } from 'react';

/*
 * Reads a Pips QR code with the camera and opens it, all on the device, so
 * puzzles can be passed on without internet. Decoding uses jsQR (loaded with
 * this screen) rather than the browser's BarcodeDetector, which some Android
 * WebViews offer but which then finds nothing.
 */

/** Routes a scanned link may open. */
const ROUTES = ['s', 'p', 'g', 'play', 'duel'];

/** The app route (#/...) in a scanned Pips link, or null for anything else. */
export function pipsRoute(text: string): string | null {
  const i = text.indexOf('#/');
  if (i < 0 || !/^https?:\/\//.test(text)) return null;
  const route = text.slice(i);
  return ROUTES.includes(route.slice(2).split('/')[0]) ? route : null;
}

type Detect = (video: HTMLVideoElement) => Promise<string | null>;

async function makeDetector(): Promise<Detect> {
  const jsQR = (await import('jsqr')).default;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return async (video) => {
    // Scaled down for speed, but sharp enough for the dense codes of whole puzzles.
    const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

export function Scan({ go }: { go: (hash: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notPips, setNotPips] = useState(false);
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    let live = true;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (e) {
        const denied = (e as Error).name === 'NotAllowedError';
        return live && setError(denied ? 'Pips needs the camera to scan. Allow camera access and try again.' : 'No camera found on this device.');
      }
      if (!live) return stream.getTracks().forEach((t) => t.stop());
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const detect = await makeDetector();
      const tick = async () => {
        if (!live) return;
        const text = video.readyState >= 2 ? await detect(video).catch(() => null) : null;
        const route = text && pipsRoute(text);
        if (route) return goRef.current(route);
        if (text) setNotPips(true);
        timer = setTimeout(tick, 150);
      };
      tick();
    })();
    return () => {
      live = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="scan">
      <div className="play-bar">
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
            <video ref={videoRef} muted playsInline />
            <div className="scan-frame" />
          </div>
          <p className="muted small center">
            {notPips ? "That QR code isn't a Pips puzzle." : 'Point the camera at a Pips QR code (Share ▾ → Show QR code). No internet needed.'}
          </p>
        </>
      )}
    </div>
  );
}
