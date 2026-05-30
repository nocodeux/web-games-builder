import React, { useState, useEffect, useRef, useCallback } from 'react';

// Dynamically import all SVG files as raw text
const iconModules = import.meta.glob('/src/img/icons/*.svg', { as: 'raw', eager: false });

// Extract icon names from paths
const allIconEntries = Object.keys(iconModules).map(path => {
  const filename = path.split('/').pop().replace('.svg', '');
  return { path, filename, label: filename.replace(/^imgi_\d+_/, '').replace(/-/g, ' ') };
});

const PAGE_SIZE = 20;

function IconPicker({ onSelect, onClose, currentIcon }) {
  const [icons, setIcons] = useState([]); // { filename, label, svg }[]
  const [search, setSearch] = useState('');
  const [loadedCount, setLoadedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  // Filter entries by search
  const filteredEntries = search.trim()
    ? allIconEntries.filter(e => e.label.toLowerCase().includes(search.toLowerCase()))
    : allIconEntries;

  // Load a batch of icons
  const loadBatch = useCallback(async (startIndex) => {
    if (loading) return;
    setLoading(true);
    const batch = filteredEntries.slice(startIndex, startIndex + PAGE_SIZE);
    const loaded = await Promise.all(
      batch.map(async (entry) => {
        try {
          const svg = await iconModules[entry.path]();
          return { ...entry, svg };
        } catch {
          return { ...entry, svg: '' };
        }
      })
    );
    setIcons(prev => startIndex === 0 ? loaded : [...prev, ...loaded]);
    setLoadedCount(startIndex + batch.length);
    setLoading(false);
  }, [filteredEntries, loading]);

  // Reset and load first batch when search changes
  useEffect(() => {
    setIcons([]);
    setLoadedCount(0);
    loadBatch(0);
  }, [search]);

  // Initial load
  useEffect(() => {
    loadBatch(0);
  }, []);

  // Scroll-to-load-more
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || loading) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      if (loadedCount < filteredEntries.length) {
        loadBatch(loadedCount);
      }
    }
  };

  return (
    <div className="projects-overlay" onClick={onClose}>
      <div className="projects-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '80vh' }}>
        <div className="modal-titlebar">
          <span className="modal-title">[ Icon Library ]</span>
          <button className="modal-close" onClick={onClose}>X</button>
        </div>

        <div style={{ padding: '12px 20px 8px' }}>
          <input
            type="text"
            placeholder="Search icons..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--input-bg)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              padding: '6px 8px',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
            autoFocus
          />
          <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>
            {filteredEntries.length} icons available · {loadedCount} loaded
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            padding: '8px 20px 20px',
            maxHeight: 'calc(80vh - 130px)',
            overflowY: 'auto',
          }}
        >
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))',
            gap: 6,
          }}>
            {icons.map((icon) => (
              <button
                key={icon.filename}
                onClick={() => onSelect(icon.filename, icon.svg)}
                title={icon.label}
                style={{
                  background: currentIcon === icon.filename ? 'var(--selected)' : 'transparent',
                  border: currentIcon === icon.filename ? '1px solid var(--accent)' : '1px solid var(--border)',
                  borderRadius: 2,
                  padding: 6,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  transition: 'all 0.1s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                  e.currentTarget.style.background = 'var(--selected)';
                }}
                onMouseLeave={e => {
                  if (currentIcon !== icon.filename) {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    backgroundColor: 'var(--text)',
                    maskImage: `url("data:image/svg+xml,${icon.svg.replace(/"/g, "'").replace(/#/g, '%23').replace(/[\n\r]/g, '').replace(/\s+/g, ' ')}")`,
                    maskRepeat: 'no-repeat',
                    maskPosition: 'center',
                    maskSize: 'contain',
                    WebkitMaskImage: `url("data:image/svg+xml,${icon.svg.replace(/"/g, "'").replace(/#/g, '%23').replace(/[\n\r]/g, '').replace(/\s+/g, ' ')}")`,
                    WebkitMaskRepeat: 'no-repeat',
                    WebkitMaskPosition: 'center',
                    WebkitMaskSize: 'contain',
                  }}
                  className="icon-preview-svg"
                />
                <span style={{ fontSize: 7, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                  {icon.label.length > 10 ? icon.label.slice(0, 10) + '…' : icon.label}
                </span>
              </button>
            ))}
          </div>

          {loading && (
            <div style={{ textAlign: 'center', padding: 12, color: 'var(--text-dim)', fontSize: 10 }}>
              Loading...
            </div>
          )}

          {!loading && loadedCount < filteredEntries.length && (
            <div style={{ textAlign: 'center', padding: 8 }}>
              <button
                onClick={() => loadBatch(loadedCount)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: 10,
                  padding: '4px 12px',
                }}
              >
                Load more ({filteredEntries.length - loadedCount} remaining)
              </button>
            </div>
          )}

          {!loading && icons.length === 0 && (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-dim)', fontSize: 11 }}>
              [ No icons match "{search}" ]
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default IconPicker;
