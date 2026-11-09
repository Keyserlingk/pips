import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { checkForUpdate, dismissUpdate } from '../../model/updates';

/** Android app only: offers a newer release from GitHub, checked at start (at most once an hour). */
export function UpdateBanner() {
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let live = true;
    App.getInfo()
      .then((info) => checkForUpdate(info.version))
      .then((u) => live && setUpdate(u))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!update) return null;
  return (
    <div className="update-banner" role="status">
      <span className="update-text">
        🎉 <strong>Pips {update.version}</strong> is available!
      </span>
      <div className="row">
        <a className="btn" href={update.url} target="_blank" rel="noreferrer" onClick={() => setUpdate(null)}>
          Download
        </a>
        <button
          className="btn ghost"
          onClick={() => {
            dismissUpdate();
            setUpdate(null);
          }}
        >
          Later
        </button>
      </div>
    </div>
  );
}
