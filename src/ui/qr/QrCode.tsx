import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** A QR code for `text`, drawn dark on white whatever the theme, so cameras can read it. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    // Long links (whole puzzles) use the lowest error correction: a code on a screen doesn't
    // get damaged, and fewer, bigger squares scan more easily.
    const qr = qrcode(0, text.length > 100 ? 'L' : 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    // 4 modules of white margin all round: the quiet zone scanners need.
    return { size: n + 8, path: d };
  }, [text]);
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
