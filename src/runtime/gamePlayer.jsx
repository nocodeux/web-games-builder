// React-based game player for published TUIFY pages.
// Replaces the vanilla-JS standalone.js so published games use the same
// React components (EmbedRuntime, GameHUD) as the builder canvas.
//
// Reads globals set by generated HTML:
//   window.__TUIFY_WORLDS__   — array of world objects (standalone game)
//   window.__TUIFY_ASSETS__   — assets sidecar object
//   window.__TUIFY_EMBEDS__   — array of embed descriptors (page embeds)
//   window.__TUIFY_SLUG__     — published slug (multiplayer)
//   window.__TUIFY_WS_URL__   — WebSocket relay base URL (multiplayer)

import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import EmbedRuntime from '../components/Componentes/EmbedRuntime';
import { MultiplayerAdapter } from './MultiplayerAdapter';

// Wrapper for page-embed GameEmbed: detects fullscreen state set by the static
// HTML maximize button and passes isFullscreen + mobileViewport into EmbedRuntime.
function EmbedPlayer({ world, assets, scaling, maintainAspect }) {
  const wrapRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  const isPhoneScreen = typeof window !== 'undefined' && Math.min(window.screen.width, window.screen.height) < 600;
  const isMobileDevice = isTouch || isPhoneScreen;

  useEffect(() => {
    const onFsChange = () => {
      const el = wrapRef.current;
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      setIsFullscreen(!!fsEl && !!el && fsEl.contains(el));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  const levels = world?.levels || [];
  const canonicalLevel = levels.find(l => l.levelType === 'game' || l.levelType === 'game+hud') || levels[0];
  const mobileViewportCfg = canonicalLevel?.mobileViewport?.enabled
    ? canonicalLevel.mobileViewport
    : world?.worldSettings?.mobileViewport;
  const useMobileViewport = isMobileDevice && mobileViewportCfg?.enabled === true;

  return (
    <div ref={wrapRef} style={{ width: '100%', height: isFullscreen ? '100%' : 'auto' }}>
      <EmbedRuntime
        world={world}
        assets={assets}
        scaling={scaling || 'fit'}
        maintainAspect={maintainAspect !== false}
        isFullscreen={isFullscreen}
        mobileViewport={useMobileViewport ? mobileViewportCfg : null}
      />
    </div>
  );
}

// Retro join overlay shown before multiplayer games start.
function JoinOverlay({ onJoin }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const submit = () => {
    const u = name.trim();
    if (!u) { setErr('Enter a username'); return; }
    onJoin(u);
  };
  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: '#0a0a0a', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 16,
    fontFamily: 'monospace', color: '#33ff33',
  };
  const inputStyle = {
    background: 'transparent', border: '1px solid #33ff33', color: '#33ff33',
    fontFamily: 'monospace', fontSize: 14, padding: '8px 12px',
    outline: 'none', width: 220, letterSpacing: 1,
  };
  const btnStyle = {
    background: 'transparent', border: '2px solid #33ff33', color: '#33ff33',
    fontFamily: 'monospace', fontSize: 12, padding: '8px 24px',
    cursor: 'pointer', letterSpacing: 2, textTransform: 'uppercase',
    boxShadow: '0 0 12px rgba(51,255,51,.3)',
  };
  return (
    <div style={overlayStyle}>
      <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', opacity: 0.7 }}>Multiplayer</div>
      <div style={{ fontSize: 18, fontWeight: 'bold', letterSpacing: 4 }}>JOIN GAME</div>
      <input
        style={inputStyle}
        placeholder="Your username"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        autoFocus
      />
      {err && <div style={{ color: '#ff4444', fontSize: 10 }}>{err}</div>}
      <button style={btnStyle} onClick={submit}>&#9654; Join Game</button>
    </div>
  );
}

// Full-page standalone game: manages which world is currently displayed,
// handles cross-world navigation from HUD buttons.
function StandaloneGame({ worlds, assets }) {
  const [currentWorldId, setCurrentWorldId] = useState(worlds[0]?.id);
  const world = worlds.find(w => w.id === currentWorldId) || worlds[0];
  const mpSettings = world?.worldSettings?.multiplayer;
  const wsUrl = window.__TUIFY_WS_URL__;
  const slug = window.__TUIFY_SLUG__;
  const needsJoin = !!(mpSettings?.enabled && wsUrl && slug);

  const [username, setUsername] = useState(null); // null = not joined yet
  const adapterRef = useRef(null);

  // Create/destroy adapter when world changes or username is set
  useEffect(() => {
    if (!needsJoin || !username) return;
    const levels = world?.levels || [];
    const firstLevelId = levels[0]?.id || 'level-0';
    const adapter = new MultiplayerAdapter({
      wsBase: wsUrl, slug, levelId: firstLevelId, username,
    });
    adapter.connect();
    adapterRef.current = adapter;
    window.__TUIFY_MP_ADAPTER__ = adapter;
    return () => {
      adapter.destroy();
      adapterRef.current = null;
      if (window.__TUIFY_MP_ADAPTER__ === adapter) window.__TUIFY_MP_ADAPTER__ = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorldId, username]);

  const handleExternalNavigate = (targetId) => {
    if (worlds.some(w => w.id === targetId)) setCurrentWorldId(targetId);
  };

  if (!world) return null;
  if (needsJoin && !username) return <JoinOverlay onJoin={setUsername} />;

  return (
    <DndProvider backend={HTML5Backend}>
      <EmbedRuntime
        key={world.id}
        world={world}
        assets={assets}
        scaling="fit"
        maintainAspect={true}
        onNavigateExternal={handleExternalNavigate}
        mpAdapter={adapterRef.current}
      />
    </DndProvider>
  );
}

function init() {
  if (window.__TUIFY_PLAYER_INIT__) return;
  window.__TUIFY_PLAYER_INIT__ = true;
  // ── Standalone / combined game ────────────────────────────────────────────
  // Support both new array format (__TUIFY_WORLDS__) and legacy single-world
  // format (__TUIFY_WORLD__) for backwards compatibility.
  const worlds = window.__TUIFY_WORLDS__ || (window.__TUIFY_WORLD__ ? [window.__TUIFY_WORLD__] : null);
  const assets = window.__TUIFY_ASSETS__ || {};

  if (worlds?.length) {
    const gameRoot = document.getElementById('game-root');
    if (gameRoot) {
      createRoot(gameRoot).render(<StandaloneGame worlds={worlds} assets={assets} />);
    }
  }

  // ── Page embeds ───────────────────────────────────────────────────────────
  // Each embed descriptor names a container div; EmbedRuntime mounts into it.
  const embeds = window.__TUIFY_EMBEDS__;
  if (Array.isArray(embeds)) {
    embeds.forEach(({ containerId, world, assets: embedAssets, scaling, maintainAspect }) => {
      const container = document.getElementById(containerId);
      if (!container || !world) return;
      createRoot(container).render(
        <DndProvider backend={HTML5Backend}>
          <EmbedPlayer
            world={world}
            assets={embedAssets || {}}
            scaling={scaling || 'fit'}
            maintainAspect={maintainAspect !== false}
          />
        </DndProvider>
      );
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
