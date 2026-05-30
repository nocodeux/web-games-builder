// GameEmbed — embeds a live game world inside a page screen.
// In the builder: renders the actual game via EmbedRuntime (WYSIWYG).
// In export: renderComponentExport outputs a container div the React player mounts into.
import React, { useRef, useState, useEffect } from 'react';
import { useGameContext } from '../../contexts/gameContext';
import EmbedRuntime from './EmbedRuntime';

const KEY_STYLE = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  minWidth: 16, height: 16, padding: '0 3px',
  border: '1px solid rgba(255,255,255,0.25)',
  borderRadius: 2, fontSize: 9, fontFamily: 'monospace',
  color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.06)',
  letterSpacing: 0,
};

function ControlsCard() {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center',
      gap: '6px 10px', padding: '5px 8px',
      border: '1px solid rgba(255,255,255,0.1)',
      borderTop: 'none',
      background: 'rgba(0,0,0,0.7)',
      fontFamily: 'monospace', fontSize: 9,
      color: 'rgba(255,255,255,0.35)',
      userSelect: 'none',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <span style={KEY_STYLE}>←</span>
        <span style={KEY_STYLE}>↑</span>
        <span style={KEY_STYLE}>↓</span>
        <span style={KEY_STYLE}>→</span>
        <span style={{ marginLeft: 2, opacity: 0.5 }}>/ WASD</span>
      </span>
      <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <span style={KEY_STYLE}>SPC</span>
        <span style={{ opacity: 0.5 }}>jump</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <span style={KEY_STYLE}>Z</span>
        <span style={{ opacity: 0.5 }}>attack</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <span style={KEY_STYLE}>E</span>
        <span style={{ opacity: 0.5 }}>interact</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <span style={KEY_STYLE}>⇧</span>
        <span style={{ opacity: 0.5 }}>dash</span>
      </span>
    </div>
  );
}

// SVG icons: reliable across all fonts/platforms
function IconExpand() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <polyline points="1,4 1,1 4,1" />
      <polyline points="5,8 8,8 8,5" />
      <line x1="1" y1="1" x2="4.5" y2="4.5" />
      <line x1="8" y1="8" x2="4.5" y2="4.5" />
    </svg>
  );
}
function IconCompress() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <polyline points="4,1 4,4 1,4" />
      <polyline points="5,8 5,5 8,5" />
      <line x1="4" y1="4" x2="1" y2="1" />
      <line x1="5" y1="5" x2="8" y2="8" />
    </svg>
  );
}

const MAX_BTN_STYLE = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 16, height: 16,
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 2,
  color: 'rgba(255,255,255,0.55)',
  background: 'rgba(255,255,255,0.04)',
  cursor: 'pointer',
  userSelect: 'none',
  flexShrink: 0,
};

function WindowFrame({ title, width, children, showControls, isFullscreen, onToggleFullscreen }) {
  const outerStyle = isFullscreen
    ? { display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }
    : { display: 'inline-flex', flexDirection: 'column', width, maxWidth: '100%' };

  const windowStyle = isFullscreen
    ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }
    : { width, maxWidth: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' };

  return (
    <div style={outerStyle}>
      <div className="retro-window" style={windowStyle}>
        <div className="retro-window-titlebar">
          <span className="retro-window-title">{title}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {onToggleFullscreen && (
              <span
                style={MAX_BTN_STYLE}
                onClick={onToggleFullscreen}
                title={isFullscreen ? 'Restaurar' : 'Pantalla completa'}
              >
                {isFullscreen ? <IconCompress /> : <IconExpand />}
              </span>
            )}
            <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'monospace', opacity: 0.6 }}>▦</span>
          </div>
        </div>
        {children}
      </div>
      {showControls && <ControlsCard />}
    </div>
  );
}

export default function GameEmbed({
  worldId, worldName, scaling = 'fit', maintainAspect = true,
  showControls = true, showWindow = true, windowTitle = '', width, height,
}) {
  const { screens, assets } = useGameContext();

  // ── Fullscreen ─────────────────────────────────────────────────────────────
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPortrait, setIsPortrait] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(orientation: portrait)').matches : false
  );
  const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  // Phone-sized screen: shorter dimension < 600 CSS px (covers phones that don't report touch correctly)
  const isPhoneScreen = typeof window !== 'undefined' && Math.min(window.screen.width, window.screen.height) < 600;
  const isMobileDevice = isTouch || isPhoneScreen;

  useEffect(() => {
    const onFsChange = () => {
      const el = containerRef.current;
      setIsFullscreen(
        document.fullscreenElement === el ||
        document.webkitFullscreenElement === el
      );
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const handler = e => setIsPortrait(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!isFullscreen) {
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    }
  };

  const world  = worldId ? (screens || []).find(s => s.id === worldId && s.kind === 'world') : null;
  const levels = world?.levels || [];

  // Canonical game level drives native canvas dimensions.
  const canonicalLevel =
    levels.find(l => l.levelType === 'game' || l.levelType === 'game+hud') ||
    levels[0];

  const mobileViewport = canonicalLevel?.mobileViewport?.enabled
    ? canonicalLevel.mobileViewport
    : world?.worldSettings?.mobileViewport;
  const useMobileViewport = isMobileDevice && mobileViewport?.enabled === true;
  const nativeW = canonicalLevel
    ? (useMobileViewport
      ? (Number(mobileViewport.renderWidth) || (mobileViewport.orientation === 'landscape' ? 844 : 390))
      : (canonicalLevel.viewportCols || 20) * (canonicalLevel.tileMap?.tileWidth  || 32))
    : 640;
  const nativeH = canonicalLevel
    ? (useMobileViewport
      ? (Number(mobileViewport.renderHeight) || (mobileViewport.orientation === 'landscape' ? 390 : 844))
      : (canonicalLevel.viewportRows || 14) * (canonicalLevel.tileMap?.tileHeight || 32))
    : 360;

  const resolvedW = (width === 'auto' || !width) ? nativeW : width;
  const resolvedH = (height === 'auto' || !height) ? nativeH : height;

  // Normal mode: fixed width, auto height driven by EmbedRuntime content.
  // Fullscreen mode: flex-fill — the game area expands to fill the window frame.
  const gameAreaStyle = isFullscreen
    ? { flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden',
        background: '#0a0a0a', boxSizing: 'border-box', fontFamily: 'monospace' }
    : { width: resolvedW, aspectRatio: `${nativeW} / ${nativeH}`, position: 'relative', overflow: 'hidden',
        background: '#0a0a0a', boxSizing: 'border-box', fontFamily: 'monospace', flexShrink: 0 };

  if (!worldId) {
    const pw = (width === 'auto' || !width) ? 640 : width;
    const ph = (height === 'auto' || !height) ? 360 : height;
    const placeholder = (
      <div style={{ width: pw, height: ph, border: '1px dashed var(--border)', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6, boxSizing: 'border-box' }}>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: 1 }}>▦ GAME EMBED</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Select a world in the inspector</div>
      </div>
    );
    if (showWindow) {
      return (
        <div ref={containerRef}>
          <WindowFrame title={windowTitle || 'GAME EMBED'} width={pw} showControls={showControls}
            isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}>
            {placeholder}
          </WindowFrame>
        </div>
      );
    }
    return (
      <div ref={containerRef} style={{ display: 'inline-flex', flexDirection: 'column' }}>
        {placeholder}
        {showControls && <ControlsCard />}
      </div>
    );
  }

  if (!world) {
    const errorContent = (
      <div style={{ width: resolvedW, height: resolvedH, border: '1px dashed var(--accent)', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6, boxSizing: 'border-box' }}>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: 1 }}>▦ GAME EMBED</div>
        <div style={{ fontSize: 13, color: 'var(--accent)' }}>{worldName || worldId}</div>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: 1 }}>World not found</div>
      </div>
    );
    if (showWindow) {
      return (
        <div ref={containerRef}>
          <WindowFrame title={windowTitle || worldName || 'World not found'} width={resolvedW} showControls={showControls}
            isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}>
            {errorContent}
          </WindowFrame>
        </div>
      );
    }
    return (
      <div ref={containerRef} style={{ display: 'inline-flex', flexDirection: 'column' }}>
        {errorContent}
        {showControls && <ControlsCard />}
      </div>
    );
  }

  const gameContent = (
    <div style={gameAreaStyle}>
      {!showWindow && !isFullscreen && (
        <div style={{
          position: 'absolute', top: 4, left: 6, zIndex: 10,
          fontSize: 8, color: 'rgba(255,255,255,0.3)', letterSpacing: 1,
          pointerEvents: 'none', userSelect: 'none',
        }}>▦ {world.name || 'GAME EMBED'}</div>
      )}
      <EmbedRuntime
        world={world}
        assets={assets}
        scaling={scaling}
        maintainAspect={maintainAspect}
        nativeW={nativeW}
        nativeH={nativeH}
        isFullscreen={isFullscreen}
        mobileViewport={useMobileViewport ? mobileViewport : null}
      />
    </div>
  );

  if (showWindow) {
    return (
      <div ref={containerRef} style={isFullscreen ? { width: '100%', height: '100%' } : {}}>
        <WindowFrame
          title={windowTitle || world.name || 'GAME'}
          width={resolvedW}
          showControls={showControls}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        >
          {gameContent}
        </WindowFrame>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={isFullscreen
        ? { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#0a0a0a' }
        : { display: 'inline-flex', flexDirection: 'column', width: resolvedW, maxWidth: '100%' }
      }
    >
      {gameContent}
      {showControls && <ControlsCard />}
    </div>
  );
}
