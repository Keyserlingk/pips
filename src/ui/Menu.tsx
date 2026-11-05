import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * A button that opens a dropdown of MenuItems below it. Choosing an item or tapping anywhere
 * else closes it, and it moves itself back inside the screen on narrow phones.
 */
export function MenuButton({
  label,
  ariaLabel,
  className = 'btn ghost',
  align = 'right',
  children,
}: {
  label: ReactNode;
  ariaLabel?: string;
  className?: string;
  /** Which edge of the button the menu lines up with. */
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    const shift = Math.max(16 - r.left, 0) - Math.max(r.right - (innerWidth - 16), 0);
    el.style.transform = `translateX(${shift}px)`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !anchor.current?.contains(e.target as Node) && setOpen(false);
    addEventListener('pointerdown', close);
    return () => removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <span className="menu-anchor" ref={anchor}>
      <button className={className} onClick={() => setOpen((o) => !o)} aria-label={ariaLabel} aria-expanded={open}>
        {label}
      </button>
      {open && (
        <div className={`menu ${align}`} role="menu" ref={menu} onClick={(e) => (e.target as Element).closest('button') && setOpen(false)}>
          {children}
        </div>
      )}
    </span>
  );
}

/** One line in a menu, with an optional explanation under it. */
export function MenuItem({ onClick, disabled, hint, children }: { onClick: () => void; disabled?: boolean; hint?: string; children: ReactNode }) {
  return (
    <button role="menuitem" disabled={disabled} onClick={onClick}>
      {children}
      {hint && <span className="muted small">{hint}</span>}
    </button>
  );
}
