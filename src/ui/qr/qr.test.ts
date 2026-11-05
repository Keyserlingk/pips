import { describe, expect, it } from 'vitest';
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import { pipsRoute } from './Scan';

/** Draws a QR code the way QrCode does (with a quiet zone), as RGBA pixels. */
function render(text: string, px = 4) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount() + 8;
  const size = n * px;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r = Math.floor(y / px) - 4;
      const c = Math.floor(x / px) - 4;
      if (r >= 0 && c >= 0 && r < n - 8 && c < n - 8 && qr.isDark(r, c)) data.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
    }
  return { data, size };
}

describe('QR codes', () => {
  it.each([
    'https://keyserlingk.github.io/pips/#/s/1.e.1hdg1mp.1ha1kmh',
    // A full puzzle link is much longer, and must still fit and read back.
    `https://keyserlingk.github.io/pips/#/p/z${'Ab9_-'.repeat(90)}`,
  ])('read back what they were made from (%#)', (text) => {
    const { data, size } = render(text);
    expect(jsQR(data, size, size)?.data).toBe(text);
  });

  it('only open Pips links', () => {
    expect(pipsRoute('https://keyserlingk.github.io/pips/#/s/1.e.abc.def')).toBe('#/s/1.e.abc.def');
    expect(pipsRoute('http://localhost:5173/#/p/zabc')).toBe('#/p/zabc');
    expect(pipsRoute('https://example.com/')).toBeNull();
    expect(pipsRoute('https://example.com/#/edit/x')).toBeNull();
    expect(pipsRoute('#/s/1.e.abc.def')).toBeNull();
    expect(pipsRoute('javascript:alert(1)#/s/x')).toBeNull();
  });
});
