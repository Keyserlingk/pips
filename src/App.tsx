import { useEffect, useState } from 'react';
import { getPuzzle, loadQuick, loadTheme, saveTheme } from './model/storage';
import { decodePuzzle } from './model/serialize';
import { THEMES } from './styles/themes';
import { Home } from './ui/home/Home';
import { Play } from './ui/play/Play';
import { Editor } from './ui/editor/Editor';

function useHash() {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(location.hash || '#/');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const [theme, setTheme] = useState(loadTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  const go = (h: string) => (location.hash = h);
  const home = () => go('#/');
  const parts = hash.replace(/^#\/?/, '').split('/');

  let page: JSX.Element;
  if (parts[0] === 'play') {
    const puzzle =
      parts[1] === 'quick' ? loadQuick() : parts[1] === 'local' ? getPuzzle(parts[2]) : parts[1] === 's' ? decodePuzzle(parts[2] ?? '') : null;
    page = puzzle ? (
      <Play
        key={puzzle.id + hash}
        puzzle={puzzle}
        onHome={home}
        onEdit={parts[1] === 'local' ? () => go(`#/edit/${puzzle.id}`) : undefined}
      />
    ) : (
      <NotFound onHome={home} />
    );
  } else if (parts[0] === 'edit') {
    page = <Editor key={parts[1]} id={parts[1] || 'new'} onHome={home} onPlay={(id) => go(`#/play/local/${id}`)} />;
  } else {
    page = <Home go={go} />;
  }

  return (
    <div className="app">
      <header className="top">
        <a href="#/" className="logo">
          <svg viewBox="0 0 64 32" width="40" height="20" aria-hidden>
            <rect x="2" y="2" width="60" height="28" rx="6" fill="var(--domino-bg)" stroke="var(--domino-border)" strokeWidth="3" />
            <line x1="32" y1="6" x2="32" y2="26" stroke="var(--domino-border)" strokeWidth="2" />
            <circle cx="17" cy="16" r="3.5" fill="var(--pip)" />
            <circle cx="41" cy="10" r="3.5" fill="var(--pip)" />
            <circle cx="53" cy="22" r="3.5" fill="var(--pip)" />
          </svg>
          Custom Pips
        </a>
        <label className="theme-pick">
          <span className="muted small">Theme</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      <main>{page}</main>
    </div>
  );
}

function NotFound({ onHome }: { onHome: () => void }) {
  return (
    <div className="panel">
      <p>That puzzle could not be found.</p>
      <button className="btn" onClick={onHome}>
        Home
      </button>
    </div>
  );
}
