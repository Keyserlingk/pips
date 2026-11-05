import { QrCode } from './QrCode';

/** A puzzle's link as a large QR code, to scan in Pips on another phone. */
export function QrModal({ link, title, onClose }: { link: string; title: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal qr-modal" onClick={(e) => e.stopPropagation()}>
        <QrCode text={link} label={`QR code for ${title || 'this puzzle'}`} />
        <p className="muted small">
          On the other phone: open Pips, tap <strong>📷 Scan QR code</strong> and point it here. Works without internet.
        </p>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
