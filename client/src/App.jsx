import { useEffect, useMemo, useState } from 'react';

const API = '/api';

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes) {
  const mb = Number(bytes || 0) / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export default function App() {
  const [media, setMedia] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('stream');
  const [error, setError] = useState('');
  const [health, setHealth] = useState(null);

  async function fetchHealth() {
    try {
      const res = await fetch(`${API}/health`);
      if (!res.ok) return;
      const data = await res.json();
      setHealth(data);
    } catch {
      setHealth(null);
    }
  }

  async function fetchLibrary(query = '') {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const res = await fetch(`${API}/library${qs}`);
    const data = await res.json();
    const list = data.media || [];

    setMedia(list);
    setSelectedId((prev) => {
      if (prev && list.some((item) => item.id === prev)) return prev;
      return list[0]?.id || null;
    });
  }

  async function scanLibrary() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/library/scan`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Scan failed');
      }
      await fetchLibrary(search);
      await fetchHealth();
    } catch (scanError) {
      setError(scanError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLibrary(search);
  }, [search]);

  useEffect(() => {
    fetchHealth();
  }, []);

  const selected = useMemo(
    () => media.find((item) => item.id === selectedId) || null,
    [media, selectedId]
  );

  const videoSrc = selected
    ? `${API}/${mode === 'stream' ? 'stream' : 'transcode'}/${selected.id}`
    : '';

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Local Infrastructure Streaming</p>
          <h1>Nova Media Hub</h1>
          <p className="subtitle">A fast, private, self-hosted Plex alternative built with Node.js + React + FFmpeg.</p>
        </div>
        <button className="cta" onClick={scanLibrary} disabled={loading}>{loading ? 'Scanning…' : 'Scan Library'}</button>
      </header>

      <section className="status-grid">
        <article className="status-card">
          <span>Indexed media</span>
          <strong>{media.length}</strong>
        </article>
        <article className="status-card">
          <span>Media root status</span>
          <strong>{health?.mediaRootStatus || 'unknown'}</strong>
        </article>
        <article className="status-card">
          <span>Server uptime</span>
          <strong>{health ? `${health.uptimeSec}s` : 'n/a'}</strong>
        </article>
      </section>

      <section className="layout">
        <aside className="sidebar glass">
          <input
            className="search"
            placeholder="Search titles or file path..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {error ? <p className="error">{error}</p> : null}

          <ul>
            {media.map((item) => (
              <li key={item.id}>
                <button
                  className={item.id === selectedId ? 'item active' : 'item'}
                  onClick={() => setSelectedId(item.id)}
                >
                  <strong>{item.title}</strong>
                  <small>{formatDuration(item.durationSec)} • {item.codec || 'codec unknown'}</small>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="player-pane glass">
          {selected ? (
            <>
              <div className="player-header">
                <h2>{selected.title}</h2>
                <div className="mode-toggle" role="group" aria-label="Playback mode">
                  <button className={mode === 'stream' ? 'pill active' : 'pill'} onClick={() => setMode('stream')}>Direct</button>
                  <button className={mode === 'transcode' ? 'pill active' : 'pill'} onClick={() => setMode('transcode')}>Transcode</button>
                </div>
              </div>

              <p className="meta">
                {selected.width && selected.height ? `${selected.width}×${selected.height}` : 'Unknown resolution'}
                {' · '}
                {formatDuration(selected.durationSec)}
                {' · '}
                {formatSize(selected.size)}
              </p>
              <p className="path">{selected.relativePath}</p>

              <video
                key={`${selected.id}-${mode}`}
                controls
                preload="metadata"
                src={videoSrc}
                className="player"
              />
            </>
          ) : (
            <p className="empty">No media indexed yet. Click <strong>Scan Library</strong> to begin.</p>
          )}
        </section>
      </section>
    </main>
  );
}
