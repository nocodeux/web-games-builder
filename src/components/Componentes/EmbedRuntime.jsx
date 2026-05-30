// Lightweight game runtime for GameEmbed (WYSIWYG builder + published embeds).
// No debug HUD, no key-hint bar — just the canvas.
//
// Scaling approach: set CSS width/height on the canvas (not CSS transform).
// A flex-center wrapper centres the canvas inside the container so any
// letterbox bars are symmetric, not pinned to one corner.

import React, { useEffect, useRef, useState } from 'react';
import { GameRuntime } from '../../runtime/gameRuntime';
import GameHUD from '../../runtime/GameHUD';
import TouchControls from '../../runtime/TouchControls';

const KEY_MAP = {
  ArrowLeft: 'left',  a: 'left',  A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  ArrowUp: 'up',    w: 'up',    W: 'up',
  ArrowDown: 'down', s: 'down',  S: 'down',
  ' ': 'jump',
  z: 'attack', Z: 'attack',
  e: 'interact', E: 'interact',
  Shift: 'dash',
};

function hasGameContent(level) {
  if (!level) return false;
  const hasTiles = (level.tileMap?.layers || []).some(layer => (layer.data || []).some(v => v));
  return !!((level.entities || []).length || (level.backgrounds || []).length || hasTiles);
}

function effectiveLevelType(level) {
  const type = level?.levelType || 'game';
  if (type === 'hud-only' && !(level.rows || []).length && hasGameContent(level)) return 'game';
  return type;
}

// scaling: 'fit' | 'fill' | 'fixed'
// maintainAspect: boolean (ignored when scaling='fixed')
// onNavigateExternal: optional — called when navigation targets a different world/screen
// nativeW/nativeH: explicit pixel dims passed by GameEmbed (world-canonical); per-level dims used as fallback
// mobileViewport: resolved mobile config from parent (GameEmbed); takes precedence over per-level lookup
// mpAdapter: optional MultiplayerAdapter instance for multiplayer games
export default function EmbedRuntime({ world, assets, scaling = 'fit', maintainAspect = true, onNavigateExternal, nativeW: propNativeW, nativeH: propNativeH, isFullscreen = false, mobileViewport: propMobileViewport, mpAdapter = null }) {
  const levels = world?.levels || [];

  const [currentLevelId, setCurrentLevelId] = useState(() => levels[0]?.id || null);
  const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  const isPhoneScreen = typeof window !== 'undefined' && Math.min(window.screen.width, window.screen.height) < 600;
  const isMobileDevice = isTouch || isPhoneScreen;

  // Portrait orientation detection — updates on device rotation.
  const [isPortrait, setIsPortrait] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(orientation: portrait)').matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const handler = e => setIsPortrait(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Reset to first level whenever the world changes.
  const worldIdRef = useRef(world?.id);
  useEffect(() => {
    if (world?.id !== worldIdRef.current) {
      worldIdRef.current = world?.id;
      setCurrentLevelId(levels[0]?.id || null);
    }
  }, [world?.id, levels]);

  const level     = levels.find(l => l.id === currentLevelId) || levels[0] || null;
  const levelType = effectiveLevelType(level);
  const showGame  = levelType === 'game' || levelType === 'game+hud';
  const showHUD   = levelType === 'hud-only' || levelType === 'game+hud';

  // Per-level native pixel dimensions.
  // propMobileViewport (from GameEmbed) is resolved against the canonical game level and takes
  // precedence — this prevents the current level (e.g. a HUD-only splash with no mobile config)
  // from overriding the world's mobile viewport settings and reverting to desktop dimensions.
  // Use explicit ternary (not ??) so that null passed by the parent ("no mobile on this device")
  // is respected rather than falling through to the level/world config.
  // When no prop is passed (standalone use), gate the fallback on device detection.
  const _rawMv = level?.mobileViewport?.enabled ? level.mobileViewport : world?.worldSettings?.mobileViewport;
  const mv = propMobileViewport !== undefined
    ? propMobileViewport
    : (isMobileDevice ? _rawMv : null);
  const useMobile = mv?.enabled === true;
  const tileW = level?.tileMap?.tileWidth  || 32;
  const tileH = level?.tileMap?.tileHeight || 32;
  const defaultMobileW = mv?.orientation === 'landscape' ? 844 : 390;
  const defaultMobileH = mv?.orientation === 'landscape' ? 390 : 844;
  const nativeW = level
    ? (useMobile ? (Number(mv.renderWidth) || defaultMobileW) : (level.viewportCols || 20) * tileW)
    : (propNativeW || 640);
  const nativeH = level
    ? (useMobile ? (Number(mv.renderHeight) || defaultMobileH) : (level.viewportRows || 14) * tileH)
    : (propNativeH || 360);

  const wrapRef    = useRef(null);
  const canvasRef  = useRef(null);
  const rtRef      = useRef(null);
  const [gameState, setGameState] = useState(null);

  const handleNavigateLevel = (id) => {
    if (levels.some(l => l.id === id)) setCurrentLevelId(id);
  };
  const handleNavigateScreen = (id) => {
    if (levels.some(l => l.id === id)) {
      setCurrentLevelId(id);
    } else if (id === world?.id) {
      // "go to world" from HUD → jump to first playable level (skip hud-only)
      const gameLevel = levels.find(l => {
        const type = effectiveLevelType(l);
        return type === 'game' || type === 'game+hud';
      });
      setCurrentLevelId((gameLevel || levels[0])?.id || null);
    } else {
      // Target is in a different world — delegate to parent
      onNavigateExternal?.(id);
    }
  };

  // ── GameRuntime lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    if (!showGame || !level) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    setGameState(null); // clear any leftover overlay from previous level
    canvas.width  = nativeW;
    canvas.height = nativeH;

    // Sync multiplayer adapter to current level
    if (mpAdapter) {
      if (mpAdapter._levelId !== level.id) mpAdapter.changeLevel(level.id);
    }

    const rt = new GameRuntime({ level, assets, canvas, worldSettings: world?.worldSettings, mobileViewport: useMobile ? mv : null, onGameStateChange: setGameState, onNavigateLevel: handleNavigateLevel, mpAdapter: mpAdapter || null });
    rtRef.current = rt;
    let cancelled = false;
    rt.preloadPromise.then(() => {
      if (!cancelled) {
        rt.start();
        canvas.focus({ preventScroll: true });
      }
    });

    const handleKey = (e, pressed) => {
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const a = KEY_MAP[e.key];
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      rt.setInput(a, pressed);
    };
    const onDown = (e) => handleKey(e, true);
    const onUp   = (e) => handleKey(e, false);
    window.addEventListener('keydown', onDown, { capture: true });
    window.addEventListener('keyup',   onUp,   { capture: true });

    return () => {
      cancelled = true;
      rt.stop();
      rtRef.current = null;
      window.removeEventListener('keydown', onDown, { capture: true });
      window.removeEventListener('keyup',   onUp,   { capture: true });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, assets, nativeW, nativeH, showGame, mpAdapter]);

  // ── Scaling: set CSS display dimensions (no transform) ────────────────────
  // The canvas pixel buffer is always nativeW×nativeH.
  // We set the CSS width/height to the scaled display size so the browser
  // stretches the buffer to the right visual size without any transform offset.
  // A flex-center wrapper then centres the scaled canvas inside the container,
  // giving symmetric letterbox bars when aspect ratios differ.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const applyScale = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const cw = wrap.clientWidth  || nativeW;
      const ch = wrap.clientHeight || nativeH;

      // In fullscreen, always fill (no black letterbox bars).
      const effectiveScaling = (isFullscreen && scaling !== 'fixed') ? 'fill' : scaling;

      if (effectiveScaling === 'fixed') {
        canvas.style.width  = `${nativeW}px`;
        canvas.style.height = `${nativeH}px`;
        return;
      }

      let displayW, displayH;
      if (!maintainAspect) {
        displayW = cw;
        displayH = ch;
      } else if (effectiveScaling === 'fill') {
        const s = Math.max(cw / nativeW, ch / nativeH);
        displayW = Math.round(nativeW * s);
        displayH = Math.round(nativeH * s);
      } else {
        // Fit (default): scale down so both dimensions <= container (letterbox)
        const s = Math.min(cw / nativeW, ch / nativeH);
        displayW = Math.round(nativeW * s);
        displayH = Math.round(nativeH * s);
      }

      canvas.style.width  = `${displayW}px`;
      canvas.style.height = `${displayH}px`;
    };

    applyScale();
    const obs = new ResizeObserver(applyScale);
    obs.observe(wrap);
    return () => obs.disconnect();
  }, [scaling, maintainAspect, nativeW, nativeH, isFullscreen]);

  if (!level) return null;

  const isHudOnly = !showGame && showHUD;

  // On a phone with mobile viewport, use 100dvh as the wrapper height instead of the
  // aspect-ratio placeholder. 100dvh (dynamic viewport height) already excludes browser
  // chrome (address bar + bottom bar), so the game always fits without scroll or crop.
  const useViewportHeight = !isFullscreen && isMobileDevice && useMobile;

  // Normal: auto-height wrapper, placeholder div establishes nativeH in normal flow.
  // Fullscreen: height:100% wrapper (flex child), no placeholder — container height is definite.
  // Mobile viewport: 100dvh wrapper, no placeholder — fits visible viewport exactly.
  const wrapStyle = isFullscreen
    ? { position: 'relative', width: '100%', height: '100%', cursor: 'default' }
    : useViewportHeight
    ? { position: 'relative', width: '100%', height: '100dvh', cursor: 'default' }
    : { position: 'relative', width: '100%', cursor: 'default' };

  return (
    <div
      ref={wrapRef}
      style={wrapStyle}
      onClick={() => canvasRef.current?.focus({ preventScroll: true })}
    >
      {showGame && (
        <>
          {/* Normal-flow placeholder: pushes auto-height container to nativeH.
              Skipped in fullscreen and mobile-viewport modes — height is definite there. */}
          {!isFullscreen && !useViewportHeight && (
            <div style={{ width: '100%', aspectRatio: `${nativeW} / ${nativeH}`, visibility: 'hidden', pointerEvents: 'none' }} />
          )}
          {/* Canvas centred via absolute overlay */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <canvas
              ref={canvasRef}
              tabIndex={0}
              onClick={(e) => {
                canvasRef.current?.focus({ preventScroll: true });
                const rt   = rtRef.current;
                const rect = e.currentTarget.getBoundingClientRect();
                if (rt?.m3HandleTap)  rt.m3HandleTap(e.clientX, e.clientY, rect);
                if (rt?.solHandleTap) rt.solHandleTap(e.clientX, e.clientY, rect);
              }}
              onMouseMove={(e) => {
                const rt = rtRef.current;
                if (!rt) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const scaleX = nativeW / rect.width;
                const scaleY = nativeH / rect.height;
                const mx = (e.clientX - rect.left) * scaleX + rt.cameraX;
                const my = (e.clientY - rect.top)  * scaleY + rt.cameraY;
                const player = rt.entities?.find(en => en.role === 'playerMain');
                if (player) {
                  const pcx = player.position.x + (player.renderSize?.width  || 32) / 2;
                  const pcy = player.position.y + (player.renderSize?.height || 32) / 2;
                  rt.setAimDirection(mx - pcx, my - pcy);
                }
              }}
              style={{ display: 'block', imageRendering: 'pixelated', outline: 'none', flexShrink: 0 }}
            />
          </div>
          {/* Touch controls — shown only on touch devices, sit in the bottom letterbox area */}
          {isTouch && <TouchControls rtRef={rtRef} world={world} />}

          {/* Game Over overlay */}
          {gameState?.gameOver && !gameState?.levelComplete && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.82)', fontFamily: 'monospace' }}>
              <div style={{ color: '#ff4444', fontSize: 24, fontWeight: 'bold', letterSpacing: 4, marginBottom: 8 }}>GAME OVER</div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginBottom: 4 }}>SCORE · {gameState.score}</div>
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginBottom: 20 }}>COINS · {gameState.coins}</div>
              <button type="button" onClick={() => { setGameState(null); setCurrentLevelId(levels[0]?.id || null); }} style={{ padding: '6px 22px', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold', background: 'var(--accent,#33ff33)', color: '#000', border: 'none', cursor: 'pointer' }}>▶ PLAY AGAIN</button>
            </div>
          )}

          {/* Level Complete overlay */}
          {gameState?.levelComplete && !gameState?.gameOver && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', fontFamily: 'monospace' }}>
              <div style={{ color: '#88ff88', fontSize: 20, fontWeight: 'bold', letterSpacing: 3, marginBottom: 8 }}>LEVEL COMPLETE</div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginBottom: 20 }}>SCORE · {gameState.score}</div>
              <button type="button" onClick={() => { setGameState(null); setCurrentLevelId(levels[0]?.id || null); }} style={{ padding: '6px 22px', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold', background: 'var(--accent,#33ff33)', color: '#000', border: 'none', cursor: 'pointer' }}>▶ PLAY AGAIN</button>
            </div>
          )}

          {/* World Complete overlay */}
          {gameState?.levelComplete && gameState?.gameOver && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.82)', fontFamily: 'monospace' }}>
              <div style={{ color: '#ffdd44', fontSize: 20, fontWeight: 'bold', letterSpacing: 3, marginBottom: 8 }}>YOU WIN!</div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginBottom: 20 }}>FINAL SCORE · {gameState.score}</div>
              <button type="button" onClick={() => { setGameState(null); setCurrentLevelId(levels[0]?.id || null); }} style={{ padding: '6px 22px', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold', background: 'var(--accent,#33ff33)', color: '#000', border: 'none', cursor: 'pointer' }}>▶ PLAY AGAIN</button>
            </div>
          )}
        </>
      )}

      {/* HUD:
          - hud-only normal:     block mode, normal flow, drives auto height
          - hud-only fullscreen: overlay mode, position:absolute fills container
          - game+hud:            always overlay mode over canvas */}
      {showHUD && (
        <GameHUD
          rows={level?.rows || []}
          onNavigateLevel={handleNavigateLevel}
          onNavigateScreen={handleNavigateScreen}
          overlay={!isHudOnly || isFullscreen}
          fillContainer={isFullscreen && isHudOnly}
          gameState={gameState}
        />
      )}
    </div>
  );
}
