// TouchControls — adaptive mobile controls for the game runtime.
// Reads worldSettings.mobileControls schema; falls back to a preset layout
// inferred from worldSettings.gameType. Never shows raw key names — all
// labels are semantic ("Jump", "Run", "Fire") or directional arrows.
//
// Schema (worldSettings.mobileControls):
//   layout:   preset layout name (string)
//   buttons:  override button list [{ input, label, size? }]
//   gestures: swipe bindings      [{ type: 'swipe-up'|..., input }]
//   tapZone:  action fired on full-screen tap (e.g. 'jump' for Flappy Bird)

import React, { useRef } from 'react';
import { getPreset } from '../lib/gamePresets';

// ── Button style constants ─────────────────────────────────────────────────────
const BASE_BTN = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(255,255,255,0.10)',
  border: '1px solid rgba(255,255,255,0.22)',
  borderRadius: 6,
  color: 'rgba(255,255,255,0.80)',
  fontFamily: 'monospace',
  userSelect: 'none', WebkitUserSelect: 'none',
  touchAction: 'none',
  boxSizing: 'border-box',
  flexShrink: 0,
};
const BTN_MD = { ...BASE_BTN, width: 48, height: 48, fontSize: 17 };
const BTN_LG = { ...BASE_BTN, width: 64, height: 64, fontSize: 13, fontWeight: 'bold', letterSpacing: 0.5 };
const BTN_SM = { ...BASE_BTN, width: 48, height: 48, fontSize: 9, letterSpacing: 0.5 };

function Btn({ label, input, size = 'md', rtRef }) {
  const style = size === 'lg' ? BTN_LG : size === 'sm' ? BTN_SM : BTN_MD;
  const fire = (e, active) => {
    e.preventDefault(); e.stopPropagation();
    rtRef.current?.setInput(input, active);
  };
  return (
    <div
      style={style}
      onTouchStart={e => fire(e, true)}
      onTouchEnd={e => fire(e, false)}
      onTouchCancel={e => fire(e, false)}
    >{label}</div>
  );
}

// ── D-pad layouts ──────────────────────────────────────────────────────────────
const DIR_LABELS = { left: '←', right: '→', up: '↑', down: '↓' };

function DPad({ rtRef, directions }) {
  if (!directions?.length) return null;

  const has = (d) => directions.includes(d);
  const b = (d) => <Btn key={d} label={DIR_LABELS[d]} input={d} rtRef={rtRef} />;
  const sp = <span key={`sp-${Math.random()}`} style={{ width: 48, height: 48 }} />;

  // Full 4-direction cross
  if (has('up') && has('down') && has('left') && has('right')) {
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 48px)',
        gridTemplateRows: 'repeat(2, 48px)',
        gap: 4, pointerEvents: 'auto',
      }}>
        {sp} {b('up')} {sp}
        {b('left')} {b('down')} {b('right')}
      </div>
    );
  }

  // Left + Right only (side-scroller, paddle)
  if (has('left') && has('right') && !has('up') && !has('down')) {
    return (
      <div style={{ display: 'flex', gap: 4, pointerEvents: 'auto' }}>
        {b('left')} {b('right')}
      </div>
    );
  }

  // Up + Down only (Pong-style)
  if (has('up') && has('down') && !has('left') && !has('right')) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'auto' }}>
        {b('up')} {b('down')}
      </div>
    );
  }

  // Fallback: render whatever directions are listed
  return (
    <div style={{ display: 'flex', gap: 4, pointerEvents: 'auto' }}>
      {directions.map(d => b(d))}
    </div>
  );
}

// ── Action button cluster ──────────────────────────────────────────────────────
function ActionButtons({ rtRef, buttons }) {
  if (!buttons?.length) return null;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
      gap: 6, pointerEvents: 'auto',
    }}>
      {/* Primary action (large) on top */}
      {buttons.filter(b => b.size === 'lg').map(b => (
        <Btn key={b.input} label={b.label} input={b.input} size="lg" rtRef={rtRef} />
      ))}
      {/* Secondary actions in a row */}
      {buttons.filter(b => b.size !== 'lg').length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {buttons.filter(b => b.size !== 'lg').map(b => (
            <Btn key={b.input} label={b.label} input={b.input} size={b.size || 'md'} rtRef={rtRef} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Preset layout definitions ─────────────────────────────────────────────────
const PRESET_LAYOUTS = {
  'platformer': {
    dpad: ['left', 'right'],
    actions: [
      { input: 'jump',    label: 'Jump',   size: 'lg' },
      { input: 'dash',    label: 'Run',    size: 'md' },
      { input: 'attack',  label: '⚔',      size: 'md' },
    ],
    gestures: [{ type: 'swipe-up', input: 'jump' }],
  },
  'platformer-dash': {
    dpad: ['left', 'right'],
    actions: [
      { input: 'jump',    label: 'Jump',   size: 'lg' },
      { input: 'dash',    label: 'Dash',   size: 'md' },
      { input: 'attack',  label: '⚔',      size: 'md' },
    ],
    gestures: [],
  },
  'topdown-action': {
    dpad: ['up', 'down', 'left', 'right'],
    actions: [
      { input: 'attack',   label: '⚔',      size: 'lg' },
      { input: 'dash',     label: 'Dash',   size: 'md' },
      { input: 'interact', label: 'Use',    size: 'md' },
    ],
    gestures: [],
  },
  'topdown-move-only': {
    dpad: ['up', 'down', 'left', 'right'],
    actions: [],
    gestures: [],
  },
  'dpad-only': {
    dpad: ['up', 'down', 'left', 'right'],
    actions: [],
    gestures: [],
  },
  'left-right-only': {
    dpad: ['left', 'right'],
    actions: [],
    gestures: [],
  },
  'up-down-only': {
    dpad: ['up', 'down'],
    actions: [],
    gestures: [],
  },
  'tap-only': {
    dpad: [],
    actions: [],
    gestures: [],
    tapZone: 'jump',
  },
  'swipe-jump': {
    dpad: ['left', 'right'],
    actions: [],
    gestures: [
      { type: 'swipe-up',   input: 'jump' },
      { type: 'swipe-down', input: 'down' },
    ],
  },
  'arcade-shooter': {
    dpad: ['left', 'right'],
    actions: [
      { input: 'attack', label: 'Fire', size: 'lg' },
    ],
    gestures: [],
  },
};

// Infer a sensible default layout from gameType if no mobileControls schema is set.
function inferLayout(gameType) {
  if (!gameType?.primary || !gameType?.secondary) return '';
  const preset = getPreset(gameType.primary, gameType.secondary);
  return preset?.mobileControls?.layout || '';
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TouchControls({ rtRef, world }) {
  const touchState = useRef({ startX: 0, startY: 0, startTime: 0, tapActive: false });

  const mc       = world?.worldSettings?.mobileControls;
  const gameType = world?.worldSettings?.gameType;

  const layoutName = mc?.layout || world?.worldSettings?.controlLayout || inferLayout(gameType);
  if (!layoutName) return null;
  const base       = PRESET_LAYOUTS[layoutName] || PRESET_LAYOUTS['platformer'];

  // Author-defined buttons/gestures override the preset, but fall back to preset.
  const dpad     = mc?.dpad     || base.dpad;
  const buttons  = mc?.buttons  || base.actions;
  const gestures = mc?.gestures || base.gestures;
  const tapZone  = mc?.tapZone  != null ? mc.tapZone : base.tapZone;

  const hasGestures = gestures.length > 0 || !!tapZone;

  // ── Gesture / tap detection on the overlay ──────────────────────────────────
  const handleTouchStart = (e) => {
    if (!hasGestures) return;
    e.preventDefault();
    const t = e.touches[0];
    touchState.current = { startX: t.clientX, startY: t.clientY, startTime: Date.now(), tapActive: true };
    if (tapZone) rtRef.current?.setInput(tapZone, true);
  };

  const handleTouchEnd = (e) => {
    if (!hasGestures) return;
    e.preventDefault();
    const { startX, startY, startTime } = touchState.current;
    if (tapZone) { rtRef.current?.setInput(tapZone, false); return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const elapsed = Date.now() - startTime;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (elapsed < 350 && dist > 35) {
      let type;
      if (Math.abs(dx) > Math.abs(dy)) type = dx > 0 ? 'swipe-right' : 'swipe-left';
      else                              type = dy > 0 ? 'swipe-down'  : 'swipe-up';
      const match = gestures.find(g => g.type === type);
      if (match) {
        rtRef.current?.setInput(match.input, true);
        setTimeout(() => rtRef.current?.setInput(match.input, false), 150);
      }
    }
  };

  // Tap-only: full-screen transparent overlay, no bottom bar.
  if (tapZone && dpad.length === 0 && buttons.length === 0) {
    return (
      <div
        style={{ position: 'absolute', inset: 0, zIndex: 20, touchAction: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div style={{
          position: 'absolute', bottom: 16, left: 0, right: 0,
          textAlign: 'center', fontSize: 11, fontFamily: 'monospace',
          color: 'rgba(255,255,255,0.3)', pointerEvents: 'none',
        }}>TAP TO PLAY</div>
      </div>
    );
  }

  const hasDpad    = dpad.length > 0;
  const hasButtons = buttons.length > 0;

  if (!hasDpad && !hasButtons && !hasGestures) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none' }}>
      {/* Swipe gesture detection overlay (transparent, behind D-pad and buttons) */}
      {gestures.length > 0 && (
        <div
          style={{ position: 'absolute', inset: 0, zIndex: 1, touchAction: 'none' }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        />
      )}

      {/* Bottom control bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 2,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        padding: '6px 12px 10px',
        background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.55))',
        pointerEvents: 'none',
      }}>
        <DPad rtRef={rtRef} directions={dpad} />
        <ActionButtons rtRef={rtRef} buttons={buttons} />
      </div>
    </div>
  );
}
