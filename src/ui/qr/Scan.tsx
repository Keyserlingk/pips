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

/** The middle of the camera picture is decoded at up to this many pixels square. */
const DECODE_PX = 960;

async function makeDetector(): Promise<Detect> {
  const jsQR = (await import('jsqr')).default;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return async (video) => {
    // The view shows the middle square of the picture; decode just that, at up to DECODE_PX,
    // so the dense codes of whole puzzles keep enough detail.
    const side = Math.min(video.videoWidth, video.videoHeight);
    const size = Math.min(side, DECODE_PX);
    canvas.width = canvas.height = size;
    ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    return jsQR(img.data, size, size, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

/** Camera features browsers offer on many phones but TypeScript doesn't describe yet. */
type CameraCaps = MediaTrackCapabilities & { focusMode?: string[]; zoom?: { min: number; max: number; step: number }; pointsOfInterest?: unknown };
const tune = (track: MediaStreamTrack, c: Record<string, unknown>) => track.applyConstraints({ advanced: [c as MediaTrackConstraintSet] }).catch(() => {});

export function Scan({ go }: { go: (hash: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [caps, setCaps] = useState<CameraCaps | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
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
        // Ask for a sharp picture: phones otherwise often give 640×480, too coarse for dense codes.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (e) {
        const denied = (e as Error).name === 'NotAllowedError';
        return live && setError(denied ? 'Pips needs the camera to scan. Allow camera access and try again.' : 'No camera found on this device.');
      }
      if (!live) return stream.getTracks().forEach((t) => t.stop());
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      const c = (track.getCapabilities?.() ?? {}) as CameraCaps;
      setCaps(c);
      // Many phone cameras keep one fixed focus unless asked to keep focusing.
      if (c.focusMode?.includes('continuous')) await tune(track, { focusMode: 'continuous' });
      if (c.zoom) setZoom(c.zoom.min);
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

  /** Tap to focus: on that spot where the camera allows it, then back to focusing on its own. */
  const refocus = async (e: React.MouseEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track || !caps?.focusMode?.includes('single-shot')) return;
    const r = e.currentTarget.getBoundingClientRect();
    const spot = caps.pointsOfInterest ? { pointsOfInterest: [{ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }] } : {};
    await tune(track, { focusMode: 'single-shot', ...spot });
    if (caps.focusMode.includes('continuous')) setTimeout(() => tune(track, { focusMode: 'continuous' }), 1500);
  };

  const changeZoom = (z: number) => {
    setZoom(z);
    if (trackRef.current) tune(trackRef.current, { zoom: z });
  };

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
          <div className="scan-view" onClick={refocus}>
            <video ref={videoRef} muted playsInline />
            <div className="scan-frame" />
          </div>
          {caps?.zoom && zoom !== null && caps.zoom.max > caps.zoom.min && (
            <label className="scan-zoom">
              <span className="muted small">Zoom</span>
              <input
                type="range"
                min={caps.zoom.min}
                max={Math.min(caps.zoom.max, caps.zoom.min * 5)}
                step={caps.zoom.step || 0.1}
                value={zoom}
                onChange={(e) => changeZoom(Number(e.target.value))}
              />
            </label>
          )}
          <p className="muted small center">
            {notPips ? "That QR code isn't a Pips puzzle." : 'Point the camera at a Pips QR code (Share ▾ → Show QR code). No internet needed.'}
          </p>
          <p className="muted small center">
            Blurry? Hold the phone a little further away{caps?.zoom ? ' and zoom in' : ''}
            {caps?.focusMode?.includes('single-shot') ? ', or tap the picture to focus' : ''}.
          </p>
        </>
      )}
    </div>
  );
}
