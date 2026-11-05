/** A 1–5 star rating; tapping the current rating again clears it. */
export function Stars({ value, onChange }: { value?: number; onChange: (n: number | undefined) => void }) {
  return (
    <span className="stars" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={value && n <= value ? 'on' : ''}
          // Tapping the current rating again clears it.
          onClick={() => onChange(value === n ? undefined : n)}
        >
          ★
        </button>
      ))}
    </span>
  );
}
