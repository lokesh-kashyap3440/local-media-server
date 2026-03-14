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

export default function App() {
  const [media, setMedia] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('stream');
  const [error, setError] = useState('');

  async function fetchLibrary(query = '') {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const res = await fetch(`${API}/library${qs}`);
    const data = await res.json();
    setMedia(data.media || []);
    if (!selectedId && data.media?.length) {
      setSelectedId(data.media[0].id);
    }
  }

  async function scanLibrary() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/library/scan`, { method: 'POST' });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || 'Scan failed');
      }
      await fetchLibrary(search);
    } catch (scanError) {
      setError(scanError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLibrary(search);
  }, [search]);

  const selected = useMemo(
    () => media.find((item) => item.id === selectedId) || null,
    [media, selectedId]
  );

  const videoSrc = selected
    ? `${API}/${mode === 'stream' ? 'stream' : 'transcode'}/${selected.id}`
    : '';

  return (
    <main className="layout">
      <aside className="sidebar">
        <div className="toolbar">
          <h1>Media Library</h1>
          <button onClick={scanLibrary} disabled={loading}>{loading ? 'Scanning...' : 'Scan'}</button>
        </div>

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
                <small>{formatDuration(item.durationSec)} • {item.codec || 'unknown codec'}</small>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="player-pane">
        {selected ? (
          <>
            <h2>{selected.title}</h2>
            <p>{selected.relativePath}</p>
            <p className="meta">
              {selected.width && selected.height ? `${selected.width}×${selected.height}` : 'Unknown resolution'}
              {' · '}
              {formatDuration(selected.durationSec)}
              {' · '}
              {(selected.size / (1024 * 1024)).toFixed(1)} MB
            </p>

            <div className="mode-toggle" role="group" aria-label="Playback mode">
              <button className={mode === 'stream' ? 'pill active' : 'pill'} onClick={() => setMode('stream')}>Direct Stream</button>
              <button className={mode === 'transcode' ? 'pill active' : 'pill'} onClick={() => setMode('transcode')}>Transcode</button>
            </div>

            <video
              key={`${selected.id}-${mode}`}
              controls
              preload="metadata"
              src={videoSrc}
              className="player"
            />
          </>
        ) : (
          <p>No media indexed yet. Click <strong>Scan</strong> after setting MEDIA_ROOT.</p>
        )}
      </section>
    </main>
  );
}
