// RuntimeView — React shell around the pure-JS GameRuntime. Owns the
// <canvas> element, forwards keyboard input, and starts/stops the
// runtime around its lifecycle.
//
// Architecture:
//  • Receives the whole `world` so it can handle inter-level navigation
//    internally without touching editor state.
//  • Always starts from world.levels[0] (entry level).
//  • A "viewport frame" div — sized exactly to the level's viewport —
//    contains both the game canvas and the GameHUD overlay. This keeps
//    both layers visually confined to the same region (matching the
//    export boundary the user defined).

import React, { useEffect, useRef, useState } from 'react';
import { GameRuntime } from '../runtime/gameRuntime';
import GameHUD from '../runtime/GameHUD';
import TouchControls from '../runtime/TouchControls';

const KEY_MAP = {
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ' ': 'jump',
  z: 'attack', Z: 'attack',
  e: 'interact', E: 'interact',
  Shift: 'dash',
};

const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

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

export default function RuntimeView({ world, assets, onStop, viewMode, activeLevelId }) {
  const levels = world?.levels || [];

  // First playable level (used by Play Again and Game Over navigation).
  const firstGameLevel = levels.find(l => {
    const type = effectiveLevelType(l);
    return type === 'game' || type === 'game+hud';
  }) || levels[0] || null;

  // Always start at levels[0] (Splash Screen or first level).
  const [currentLevelId, setCurrentLevelId] = useState(() => levels[0]?.id || null);

  const currentLevel = levels.find(l => l.id === currentLevelId) || firstGameLevel || null;
  const levelType   = effectiveLevelType(currentLevel);

  const showGame = levelType === 'game' || levelType === 'game+hud';
  const showHUD  = levelType === 'hud-only' || levelType === 'game+hud';

  // Dedicated Game Over level (created by Build Game)
  const gameOverLevelObj = levels.find(l => l.name === 'Game Over');

  // Viewport dimensions. Mobile render size is separate from tile counts so
  // the canvas can match a real screen aspect instead of a desktop tile box.
  const isMobile = viewMode === 'mobile';
  const viewportLevel = currentLevel || firstGameLevel;
  const mobCfg = viewportLevel?.mobileViewport?.enabled
    ? viewportLevel.mobileViewport
    : world?.worldSettings?.mobileViewport;
  const mobVP = isMobile && mobCfg?.enabled ? mobCfg : null;
  const _masterTileW = viewportLevel?.tileMap?.tileWidth  || 32;
  const _masterTileH = viewportLevel?.tileMap?.tileHeight || 32;
  const defaultMobileW = mobVP?.orientation === 'landscape' ? 844 : 390;
  const defaultMobileH = mobVP?.orientation === 'landscape' ? 390 : 844;
  const viewportW = mobVP
    ? (Number(mobVP.renderWidth) || defaultMobileW)
    : ((viewportLevel?.viewportCols || 20) * _masterTileW);
  const viewportH = mobVP
    ? (Number(mobVP.renderHeight) || defaultMobileH)
    : ((viewportLevel?.viewportRows || 14) * _masterTileH);

  const canvasRef    = useRef(null);
  const runtimeRef   = useRef(null);
  const outerRef     = useRef(null);
  const [debug, setDebug]                 = useState(null);
  const [showDebug, setShowDebug]         = useState(true);
  const [showColliders, setShowColliders] = useState(false);
  const [gameState, setGameState]         = useState(null);
  const [containerW, setContainerW]       = useState(0);
  const [containerH, setContainerH]       = useState(0);

  // Track container size for scale-to-fit
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setContainerW(r.width);
      setContainerH(r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sync with editor tab selection while playing.
  useEffect(() => {
    if (activeLevelId && levels.some(l => l.id === activeLevelId)) {
      setCurrentLevelId(activeLevelId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLevelId]);

  // Navigate to another level. Resets game state when moving away from a game-over screen.
  const handleNavigateLevel = (levelId) => {
    if (!levels.some(l => l.id === levelId)) return;
    const target = levels.find(l => l.id === levelId);
    const targetType = effectiveLevelType(target);
    if (gameState?.gameOver && (targetType === 'game' || targetType === 'game+hud')) {
      setGameState(null);
    }
    setCurrentLevelId(levelId);
  };

  // Handle screen navigation: if the target is a level in this world, treat it as level nav.
  const handleNavigateScreen = (targetId) => {
    if (levels.some(l => l.id === targetId)) {
      handleNavigateLevel(targetId);
    } else if (targetId === world?.id) {
      setGameState(null);
      setCurrentLevelId(firstGameLevel?.id || null);
    }
  };

  // Restart: navigate to the first game level and reset state.
  const handlePlayAgain = () => {
    setGameState(null);
    setCurrentLevelId(firstGameLevel?.id || null);
  };

  // Auto-navigate to the "Game Over" level when the runtime signals game over.
  useEffect(() => {
    if (!gameState?.gameOver) return;
    if (gameOverLevelObj && gameOverLevelObj.id !== currentLevelId) {
      setCurrentLevelId(gameOverLevelObj.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.gameOver]);

  // Game-canvas runtime lifecycle. Runs only when the level type needs it.
  useEffect(() => {
    if (!showGame) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width  = viewportW;
    canvas.height = viewportH;

    const handleNextLevel = () => {
      const idx = levels.findIndex(l => l.id === currentLevelId);
      // Skip HUD-only levels (Splash, Game Over) — find the next playable game level.
      const nextGame = levels.slice(idx + 1).find(l => {
        const type = effectiveLevelType(l);
        return type === 'game' || type === 'game+hud';
      });
      if (nextGame) {
        setGameState(null);
        setCurrentLevelId(nextGame.id);
      } else {
        // No more game levels — game complete
        setGameState(gs => ({ ...(gs || {}), gameOver: true, levelComplete: true }));
      }
    };

    const rt = new GameRuntime({
      level: currentLevel,
      assets,
      canvas,
      worldSettings: world?.worldSettings,
      mobileViewport: mobVP,
      onNextLevel: handleNextLevel,
      onNavigateLevel: handleNavigateLevel,
      onGameStateChange: setGameState,
    });
    runtimeRef.current = rt;
    rt.start();

    if (document.activeElement && document.activeElement !== canvas) {
      document.activeElement.blur?.();
    }
    canvas.focus({ preventScroll: true });

    const handleKey = (e, pressed) => {
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const action = KEY_MAP[e.key];
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      rt.setInput(action, pressed);
    };
    const onDown = (e) => handleKey(e, true);
    const onUp   = (e) => handleKey(e, false);
    window.addEventListener('keydown', onDown, { capture: true });
    window.addEventListener('keyup',   onUp,   { capture: true });

    let lastJson = '';
    const pollId = setInterval(() => {
      const info = rt.getDebugInfo();
      const json = JSON.stringify(info);
      if (json !== lastJson) { lastJson = json; setDebug(info); }
    }, 100);

    return () => {
      rt.stop();
      runtimeRef.current = null;
      window.removeEventListener('keydown', onDown, { capture: true });
      window.removeEventListener('keyup',   onUp,   { capture: true });
      clearInterval(pollId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLevel, assets, viewportW, viewportH, showGame]);

  // Scale-to-fit: always show the viewport with a visible mat.
  const PAD = isMobile ? 0 : 32;
  const scaleX = containerW > 0 ? (containerW - PAD) / viewportW : 1;
  const scaleY = containerH > 0 ? (containerH - PAD) / viewportH : 1;
  const scale  = Math.max(0.05, Math.min(scaleX, scaleY));

  return (
    // Outer wrapper: dark mat — always shows behind/around the viewport frame
    <div ref={outerRef} style={{
      position: 'relative', flex: 1, minHeight: 0,
      background: isMobile ? '#111' : '#0a0a0a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    }}>
      {/* ── Viewport frame ──────────────────────────────────────────────────
          Fixed at viewportW × viewportH; CSS-scaled to always fit the
          container with a visible mat border.                          */}
      <div style={{
        position: 'relative',
        width:  viewportW,
        height: viewportH,
        flexShrink: 0,
        overflow: 'hidden',
        transform: `scale(${scale})`,
        transformOrigin: 'center center',
        boxShadow: isMobile
          ? '0 0 0 3px #333, 0 0 0 6px #222, 0 0 32px rgba(0,0,0,0.9)'
          : '0 0 0 1px var(--border), 0 0 24px rgba(0,0,0,0.7)',
        borderRadius: isMobile ? 12 : 0,
        background: '#000',
      }}>
        {/* Game canvas */}
        {showGame && (
          <canvas
            ref={canvasRef}
            tabIndex={0}
            onMouseDown={() => canvasRef.current?.focus({ preventScroll: true })}
            onClick={(e) => {
              const rt   = runtimeRef.current;
              const rect = e.currentTarget.getBoundingClientRect();
              if (rt?.m3HandleTap)  rt.m3HandleTap(e.clientX, e.clientY, rect);
              if (rt?.solHandleTap) rt.solHandleTap(e.clientX, e.clientY, rect);
            }}
            onMouseMove={(e) => {
              const rt = runtimeRef.current;
              if (!rt) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const scaleX = viewportW / rect.width;
              const scaleY = viewportH / rect.height;
              const mx = (e.clientX - rect.left) * scaleX + rt.cameraX;
              const my = (e.clientY - rect.top)  * scaleY + rt.cameraY;
              const player = rt.entities?.find(en => en.role === 'playerMain');
              if (player) {
                const pcx = player.position.x + (player.renderSize?.width  || 32) / 2;
                const pcy = player.position.y + (player.renderSize?.height || 32) / 2;
                rt.setAimDirection(mx - pcx, my - pcy);
              }
            }}
            style={{
              display: 'block',
              imageRendering: 'pixelated',
              outline: 'none',
              // Canvas pixel dimensions are set in the effect;
              // CSS size matches the viewport frame exactly.
              width:  viewportW,
              height: viewportH,
            }}
          />
        )}

        {/* HUD overlay — sits on top of the canvas (or fills frame for hud-only) */}
        {showHUD && (
          <GameHUD
            rows={currentLevel?.rows || []}
            onNavigateLevel={handleNavigateLevel}
            onNavigateScreen={handleNavigateScreen}
            viewMode={viewMode}
            gameState={gameState}
            centerVertical={levelType === 'hud-only'}
          />
        )}

        {/* Touch controls — editor play mode */}
        {showGame && isTouch && (
          <TouchControls rtRef={runtimeRef} world={world} />
        )}

        {/* Game Over overlay — only when no dedicated "Game Over" level exists */}
        {gameState?.gameOver && !gameState?.levelComplete && !gameOverLevelObj && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 50,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.82)', fontFamily: 'monospace',
          }}>
            <div style={{ color: '#ff4444', fontSize: 28, fontWeight: 'bold', letterSpacing: 4, marginBottom: 10 }}>
              GAME OVER
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 6 }}>
              SCORE · {gameState.score}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginBottom: 24 }}>
              COINS · {gameState.coins}
            </div>
            <button
              type="button"
              onClick={handlePlayAgain}
              style={{
                padding: '6px 24px', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold',
                background: 'var(--accent)', color: 'var(--bg)', border: 'none', cursor: 'pointer',
              }}
            >▶ PLAY AGAIN</button>
          </div>
        )}

        {/* Level Complete overlay */}
        {gameState?.levelComplete && !gameState?.gameOver && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 50,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.75)', fontFamily: 'monospace',
          }}>
            <div style={{ color: '#88ff88', fontSize: 22, fontWeight: 'bold', letterSpacing: 3, marginBottom: 10 }}>
              LEVEL COMPLETE
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 24 }}>
              SCORE · {gameState.score}
            </div>
            <button
              type="button"
              onClick={handlePlayAgain}
              style={{
                padding: '6px 24px', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold',
                background: 'var(--accent)', color: 'var(--bg)', border: 'none', cursor: 'pointer',
              }}
            >▶ PLAY AGAIN</button>
          </div>
        )}

        {/* World Complete overlay */}
        {gameState?.levelComplete && gameState?.gameOver && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 50,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.82)', fontFamily: 'monospace',
          }}>
            <div style={{ color: '#ffdd44', fontSize: 22, fontWeight: 'bold', letterSpacing: 3, marginBottom: 10 }}>
              YOU WIN!
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 24 }}>
              FINAL SCORE · {gameState.score}
            </div>
            <button
              type="button"
              onClick={handlePlayAgain}
              style={{
                padding: '6px 24px', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold',
                background: 'var(--accent)', color: 'var(--bg)', border: 'none', cursor: 'pointer',
              }}
            >▶ PLAY AGAIN</button>
          </div>
        )}
      </div>

      {/* Key hint — outside the frame so it doesn't cover game content */}
      {showGame && (
        <div style={{
          position: 'absolute', bottom: 8, left: 8,
          background: 'rgba(0,0,0,0.7)', padding: '4px 8px',
          border: '1px solid var(--border)',
          fontSize: 9, fontFamily: 'monospace', color: 'var(--text-dim)',
          pointerEvents: 'none',
        }}>
          Arrows/WASD · Space=jump · Z=attack · E=interact · Shift=dash
        </div>
      )}

      {/* Level name breadcrumb (only when multiple levels) */}
      {levels.length > 1 && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          background: 'rgba(0,0,0,0.7)', padding: '3px 8px',
          border: '1px solid var(--border)',
          fontSize: 9, fontFamily: 'monospace', color: 'var(--text-dim)',
        }}>
          {currentLevel?.name || '—'}
        </div>
      )}

      {/* ── Debug HUD ──────────────────────────────────────────────────────── */}
      {showGame && showDebug && debug && (
        <div style={{
          position: 'absolute', top: 8, left: 8,
          padding: '6px 8px',
          background: 'rgba(0,0,0,0.85)', border: '1px solid var(--accent)',
          fontFamily: 'monospace', fontSize: 10, color: 'var(--accent)',
          minWidth: 200, lineHeight: 1.5, zIndex: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 'bold' }}>◉ DEBUG</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={() => {
                  const next = !showColliders;
                  setShowColliders(next);
                  runtimeRef.current?.setShowColliders(next);
                }}
                style={{
                  background: showColliders ? 'rgba(255,165,0,0.25)' : 'transparent',
                  border: `1px solid ${showColliders ? 'rgba(255,165,0,0.9)' : 'var(--text-dim)'}`,
                  color: showColliders ? 'rgba(255,165,0,1)' : 'var(--text-dim)',
                  fontSize: 9, padding: '0 4px', cursor: 'pointer', fontFamily: 'monospace',
                }}
              >colliders</button>
              <button
                type="button"
                onClick={() => setShowDebug(false)}
                style={{
                  background: 'transparent', border: '1px solid var(--text-dim)', color: 'var(--text-dim)',
                  fontSize: 9, padding: '0 4px', cursor: 'pointer', fontFamily: 'monospace',
                }}
              >hide</button>
            </div>
          </div>
          <div>
            INPUT:&nbsp;
            {debug.input.left   ? '◀' : '·'}
            {debug.input.right  ? '▶' : '·'}
            {debug.input.up     ? '▲' : '·'}
            {debug.input.down   ? '▼' : '·'}
            {debug.input.jump    ? ' [SPC]'  : ''}
            {debug.input.attack  ? ' [ATK]'  : ''}
            {debug.input.interact? ' [INT]'  : ''}
            {debug.input.dash    ? ' [DASH]' : ''}
          </div>
          {debug.gameState && (
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4, marginBottom: 4 }}>
              SCORE: {debug.gameState.score} · LIVES: {debug.gameState.lives} · COINS: {debug.gameState.coins}
            </div>
          )}
          {debug.player ? (
            <>
              <div>HP: {debug.player.hp} · POS: ({debug.player.x}, {debug.player.y})</div>
              <div>VEL: ({debug.player.vx}, {debug.player.vy}){debug.player.onGround ? ' · onGround' : ' · airborne'}</div>
              <div>ANIM: {debug.player.anim || '—'} · frame {debug.player.frame}</div>
              {debug.player.hitState && (
                <div style={{ color: '#ff8844' }}>HIT: {debug.player.hitState}</div>
              )}
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => runtimeRef.current?.applyHit(10)}
                  style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid #ff8844', color: '#ff8844', fontSize: 9, padding: '1px 5px', cursor: 'pointer', fontFamily: 'monospace' }}
                >hit ×10</button>
                <button
                  type="button"
                  onClick={() => runtimeRef.current?.applyHit(50)}
                  style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid #ff4455', color: '#ff4455', fontSize: 9, padding: '1px 5px', cursor: 'pointer', fontFamily: 'monospace' }}
                >hit ×50</button>
              </div>
            </>
          ) : (
            <div style={{ color: '#ff8899' }}>no playerMain entity</div>
          )}
          {debug.enemies && debug.enemies.total > 0 && (
            <div style={{ marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 4 }}>
              ENEMIES: {debug.enemies.alive}/{debug.enemies.total} alive
            </div>
          )}
        </div>
      )}
      {showGame && !showDebug && (
        <button
          type="button"
          onClick={() => setShowDebug(true)}
          style={{
            position: 'absolute', top: 8, left: 8,
            background: 'rgba(0,0,0,0.7)', border: '1px solid var(--text-dim)', color: 'var(--text-dim)',
            padding: '2px 6px', fontFamily: 'monospace', fontSize: 9, cursor: 'pointer',
          }}
        >◉ debug</button>
      )}
    </div>
  );
}
