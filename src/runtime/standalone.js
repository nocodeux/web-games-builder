// Standalone game player entry point.
// Bundled as an IIFE via vite.runtime.config.js → public/runtime/tuify-game.js
//
// Expected page shape:
//   window.__TUIFY_WORLD__  = { id, name, levels: [...], ... }
//   window.__TUIFY_ASSETS__ = { sprites, tilesets, sounds, backgrounds }

import { GameRuntime } from './gameRuntime.js';
import { MultiplayerAdapter } from './MultiplayerAdapter.js';

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

// ─── Lightweight DOM HUD renderer ────────────────────────────────────────────
// Mirrors the component tree structure used by GameHUD.jsx but produces plain
// DOM nodes so it works in the published standalone page (no React).

function layoutToObj(layout = {}) {
  return {
    display:        'flex',
    flexDirection:  layout.direction  || 'row',
    gap:            (layout.gap != null ? layout.gap : 8) + 'px',
    alignItems:     layout.align      || 'flex-start',
    justifyContent: layout.justify    || 'flex-start',
    flexWrap:       layout.wrap ? 'wrap' : 'nowrap',
    paddingTop:    (layout.paddingTop    || 0) + 'px',
    paddingRight:  (layout.paddingRight  || 0) + 'px',
    paddingBottom: (layout.paddingBottom || 0) + 'px',
    paddingLeft:   (layout.paddingLeft   || 0) + 'px',
  };
}

function applyStyles(el, styles) {
  Object.assign(el.style, styles);
}

function hudWrapperStyle(p = {}) {
  const sizing = p.sizing || {};
  const wFill  = sizing.widthMode  === 'fill';
  const hFill  = sizing.heightMode === 'fill';
  return {
    display:   (wFill || hFill) ? 'flex' : 'inline-flex',
    flex:      wFill ? '1 1 0' : (hFill ? '1 1 auto' : '0 0 auto'),
    alignSelf: (hFill || (wFill && (p.layout?.direction || 'row') === 'column')) ? 'stretch' : 'auto',
    minWidth:  '0',
    boxSizing: 'border-box',
    maxWidth:  '100%',
  };
}

// ── Live gameState binding (standalone) ──────────────────────────────────────
function resolveStandaloneBinding(bindTo, template, gameState) {
  if (!bindTo || !gameState) return template;
  let value;
  switch (bindTo) {
    case 'score':   value = gameState.score   ?? 0; break;
    case 'lives':   value = gameState.lives   ?? 0; break;
    case 'coins':   value = gameState.coins   ?? 0; break;
    case 'xp':      value = gameState.xp      ?? 0; break;
    case 'xpLevel': value = gameState.xpLevel ?? 1; break;
    case 'wave':    value = gameState.wave    ?? 0; break;
    case 'timer': {
      const t = Math.max(0, Math.ceil(gameState.timer ?? 0));
      value = t >= 60 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : String(t);
      break;
    }
    default: return template;
  }
  const str = String(value);
  if (typeof template === 'string' && template.includes('{value}')) return template.replace('{value}', str);
  return str;
}

// bindings: array populated with { el, bindTo, template } for live updates.
function renderHudNode(comp, onNavigate, bindings) {
  const { type = '', props = {}, children = [] } = comp || {};
  const p = props;
  const layout = p.layout || {};
  const sizing = p.sizing || {};

  const wrap = document.createElement('div');
  applyStyles(wrap, hudWrapperStyle(p));

  const handleClick = () => {
    if (p.action === 'level'    && p.targetLevelId)  onNavigate(p.targetLevelId);
    else if (p.action === 'screen'   && p.targetScreenId) onNavigate(p.targetScreenId);
    else if (p.action === 'external' && p.href)           window.open(p.href, '_blank');
  };

  // ── Row ──────────────────────────────────────────────────────────────────
  if (type === 'Row') {
    applyStyles(wrap, { ...layoutToObj(p.layout), width: '100%', minHeight: '0' });
    (children || []).forEach(c => wrap.appendChild(renderHudNode(c, onNavigate, bindings)));
    return wrap;
  }

  // ── Window ───────────────────────────────────────────────────────────────
  if (type === 'Window') {
    const win = document.createElement('div');
    const w = p.width  ? (typeof p.width  === 'number' ? p.width  + 'px' : p.width)  : 'auto';
    const h = p.height ? (typeof p.height === 'number' ? p.height + 'px' : p.height) : 'auto';
    applyStyles(win, {
      border: '1px solid #33ff33',
      background: p.bgColor || '#0a0a0a',
      color: p.textColor || '#33ff33',
      fontFamily: 'monospace',
      display: 'flex',
      flexDirection: 'column',
      width: sizing.widthMode  === 'hug' ? 'auto' : (sizing.widthMode  === 'fill' ? '100%' : w),
      height: sizing.heightMode === 'hug' ? 'auto' : (sizing.heightMode === 'fill' ? '100%' : h),
      overflow: 'hidden',
    });
    if (p.title) {
      const tb = document.createElement('div');
      applyStyles(tb, { background: '#33ff33', color: '#0a0a0a', padding: '2px 6px', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', flexShrink: '0', userSelect: 'none' });
      tb.textContent = p.title;
      win.appendChild(tb);
    }
    const body = document.createElement('div');
    applyStyles(body, { ...layoutToObj(layout), flex: '1', overflow: 'auto' });
    (children || []).forEach(c => body.appendChild(renderHudNode(c, onNavigate, bindings)));
    win.appendChild(body);
    wrap.appendChild(win);
    return wrap;
  }

  // ── Frame ─────────────────────────────────────────────────────────────────
  if (type === 'Frame') {
    const frm = document.createElement('div');
    const w = p.width  ? (typeof p.width  === 'number' ? p.width  + 'px' : p.width)  : 'auto';
    const h = p.height ? (typeof p.height === 'number' ? p.height + 'px' : p.height) : 'auto';
    applyStyles(frm, {
      ...layoutToObj(layout),
      border: p.borderColor ? `1px solid ${p.borderColor}` : '1px solid transparent',
      background: p.bgColor || 'transparent',
      color: '#33ff33',
      width: sizing.widthMode  === 'hug' ? 'auto' : (sizing.widthMode  === 'fill' ? '100%' : w),
      height: sizing.heightMode === 'hug' ? 'auto' : (sizing.heightMode === 'fill' ? '100%' : h),
    });
    (children || []).forEach(c => frm.appendChild(renderHudNode(c, onNavigate, bindings)));
    wrap.appendChild(frm);
    return wrap;
  }

  // ── Button ────────────────────────────────────────────────────────────────
  if (type === 'Button') {
    const btn = document.createElement('button');
    applyStyles(btn, {
      background: 'transparent',
      border: '1px solid #33ff33',
      color: '#33ff33',
      fontFamily: 'monospace',
      fontSize: '11px',
      padding: '4px 10px',
      cursor: 'pointer',
      letterSpacing: '1px',
      outline: 'none',
      width: sizing.widthMode === 'fill' ? '100%' : (p.width ? (typeof p.width === 'number' ? p.width + 'px' : p.width) : 'auto'),
    });
    btn.textContent = p.label || '';
    btn.addEventListener('click', handleClick);
    btn.addEventListener('mouseover', () => { btn.style.background = 'rgba(51,255,51,0.12)'; });
    btn.addEventListener('mouseout',  () => { btn.style.background = 'transparent'; });
    wrap.appendChild(btn);
    return wrap;
  }

  // ── Text / Label ──────────────────────────────────────────────────────────
  if (type === 'Text' || type === 'Label') {
    const span = document.createElement('span');
    applyStyles(span, {
      color: p.textColor || '#33ff33',
      fontFamily: 'monospace',
      fontSize: (p.size || p.fontSize || 12) + 'px',
      whiteSpace: 'pre-wrap',
    });
    const template = p.text || p.label || '';
    span.textContent = template;
    if (p.bindTo && bindings) {
      bindings.push({ el: span, bindTo: p.bindTo, template });
    }
    wrap.appendChild(span);
    return wrap;
  }

  // ── Image ─────────────────────────────────────────────────────────────────
  if (type === 'Image') {
    const img = document.createElement('img');
    img.src = p.src || '';
    img.alt = p.alt || '';
    const w = sizing.widthMode  === 'fill' ? '100%' : (p.width  ? (typeof p.width  === 'number' ? p.width  + 'px' : p.width)  : 'auto');
    const h = sizing.heightMode === 'fill' ? '100%' : (p.height ? (typeof p.height === 'number' ? p.height + 'px' : p.height) : 'auto');
    applyStyles(img, { display: 'block', width: w, height: h, maxWidth: '100%', objectFit: p.bgImageFit || 'contain' });
    wrap.appendChild(img);
    return wrap;
  }

  // ── Shape ─────────────────────────────────────────────────────────────────
  if (type === 'Shape') {
    const s = document.createElement('div');
    const w = p.width  ? (typeof p.width  === 'number' ? p.width  + 'px' : p.width)  : '100%';
    const h = p.height ? (typeof p.height === 'number' ? p.height + 'px' : p.height) : '4px';
    applyStyles(s, { width: w, height: h, background: p.color || '#33ff33', flexShrink: '0' });
    wrap.appendChild(s);
    return wrap;
  }

  // ── Unknown / container fallback ──────────────────────────────────────────
  (children || []).forEach(c => wrap.appendChild(renderHudNode(c, onNavigate, bindings)));
  return wrap;
}

// Returns { el, bindings } where bindings is an array of { el, bindTo, template } for live updates.
function renderHudRows(rows, onNavigate) {
  const bindings = [];
  const container = document.createElement('div');
  applyStyles(container, { width: '100%', display: 'flex', flexDirection: 'column' });

  const isSingleWindow =
    rows?.length === 1 &&
    rows[0]?.children?.length === 1 &&
    rows[0].children[0].type === 'Window';

  (rows || []).forEach(row => {
    const rowEl = document.createElement('div');
    applyStyles(rowEl, {
      ...layoutToObj(row.layout),
      width: '100%',
      margin: isSingleWindow ? '0' : '12px 0',
      ...(isSingleWindow ? { justifyContent: 'center', alignItems: 'center' } : {}),
    });
    (row.children || []).forEach(c => rowEl.appendChild(renderHudNode(c, onNavigate, bindings)));
    container.appendChild(rowEl);
  });

  return { el: container, bindings };
}

// ── Touch Controls (vanilla DOM) ─────────────────────────────────────────────
const TOUCH_LAYOUTS = {
  'platformer':      { dpad: ['left','right'], actions: [{ input:'jump', label:'Jump', size:'lg' }, { input:'dash', label:'Run', size:'md' }, { input:'attack', label:'⚔', size:'md' }], gestures: [{ type:'swipe-up', input:'jump' }] },
  'topdown-action':  { dpad: ['up','down','left','right'], actions: [{ input:'attack', label:'⚔', size:'lg' }, { input:'dash', label:'Dash', size:'md' }, { input:'interact', label:'Use', size:'md' }], gestures: [] },
  'dpad-only':       { dpad: ['up','down','left','right'], actions: [], gestures: [] },
  'left-right-only': { dpad: ['left','right'], actions: [], gestures: [] },
  'up-down-only':    { dpad: ['up','down'], actions: [], gestures: [] },
  'tap-only':        { dpad: [], actions: [], gestures: [], tapZone: 'jump' },
  'arcade-shooter':  { dpad: ['left','right'], actions: [{ input:'attack', label:'Fire', size:'lg' }], gestures: [] },
  'swipe-jump':      { dpad: ['left','right'], actions: [], gestures: [{ type:'swipe-up', input:'jump' }, { type:'swipe-down', input:'down' }] },
};
const _GENRE_LAYOUT = { platformer: 'platformer', topdown: 'topdown-action', casual: 'tap-only', arcade: 'arcade-shooter' };
function _inferTouchLayout(gt) { return _GENRE_LAYOUT[gt?.primary] || ''; }

function _makeBtn(label, input, size, rt) {
  const dim = size === 'lg' ? 64 : 48;
  const el = document.createElement('div');
  Object.assign(el.style, { display:'flex', alignItems:'center', justifyContent:'center', width:dim+'px', height:dim+'px', background:'rgba(255,255,255,0.10)', border:'1px solid rgba(255,255,255,0.22)', borderRadius:'6px', color:'rgba(255,255,255,0.80)', fontFamily:'monospace', fontSize:size==='lg'?'13px':size==='sm'?'9px':'17px', fontWeight:size==='lg'?'bold':'normal', userSelect:'none', WebkitUserSelect:'none', touchAction:'none', boxSizing:'border-box', flexShrink:'0' });
  el.textContent = label;
  const press = (e, on) => { e.preventDefault(); e.stopPropagation(); rt.setInput(input, on); };
  el.addEventListener('touchstart', e => press(e, true),  { passive: false });
  el.addEventListener('touchend',   e => press(e, false), { passive: false });
  el.addEventListener('touchcancel',e => press(e, false), { passive: false });
  return el;
}

function _makeDPad(directions, rt) {
  if (!directions.length) return null;
  const has = d => directions.includes(d);
  if (has('up') && has('down') && has('left') && has('right')) {
    const g = document.createElement('div');
    Object.assign(g.style, { display:'grid', gridTemplateColumns:'repeat(3,48px)', gridTemplateRows:'repeat(2,48px)', gap:'4px', pointerEvents:'auto' });
    const sp = () => { const s = document.createElement('span'); Object.assign(s.style, { width:'48px', height:'48px' }); return s; };
    g.appendChild(sp()); g.appendChild(_makeBtn('↑','up','md',rt)); g.appendChild(sp());
    g.appendChild(_makeBtn('←','left','md',rt)); g.appendChild(_makeBtn('↓','down','md',rt)); g.appendChild(_makeBtn('→','right','md',rt));
    return g;
  }
  if (has('left') && has('right') && !has('up')) {
    const r = document.createElement('div'); Object.assign(r.style, { display:'flex', gap:'4px', pointerEvents:'auto' });
    r.appendChild(_makeBtn('←','left','md',rt)); r.appendChild(_makeBtn('→','right','md',rt));
    return r;
  }
  if (has('up') && has('down') && !has('left')) {
    const c = document.createElement('div'); Object.assign(c.style, { display:'flex', flexDirection:'column', gap:'4px', pointerEvents:'auto' });
    c.appendChild(_makeBtn('↑','up','md',rt)); c.appendChild(_makeBtn('↓','down','md',rt));
    return c;
  }
  const r = document.createElement('div'); Object.assign(r.style, { display:'flex', gap:'4px', pointerEvents:'auto' });
  directions.forEach(d => r.appendChild(_makeBtn({left:'←',right:'→',up:'↑',down:'↓'}[d]||d, d, 'md', rt)));
  return r;
}

function _makeActionCluster(buttons, rt) {
  if (!buttons.length) return null;
  const col = document.createElement('div');
  Object.assign(col.style, { display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'6px', pointerEvents:'auto' });
  buttons.filter(b => b.size === 'lg').forEach(b => col.appendChild(_makeBtn(b.label, b.input, 'lg', rt)));
  const sm = buttons.filter(b => b.size !== 'lg');
  if (sm.length) {
    const row = document.createElement('div'); Object.assign(row.style, { display:'flex', gap:'6px' });
    sm.forEach(b => row.appendChild(_makeBtn(b.label, b.input, b.size||'md', rt)));
    col.appendChild(row);
  }
  return col;
}

function addTouchControls(container, rt, world) {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch) return null;

  const mc = world?.worldSettings?.mobileControls;
  const gt = world?.worldSettings?.gameType;
  const layoutName = mc?.layout || world?.worldSettings?.controlLayout || _inferTouchLayout(gt);
  if (!layoutName) return null;
  const base = TOUCH_LAYOUTS[layoutName] || TOUCH_LAYOUTS['platformer'];

  const dpad     = mc?.dpad     || base.dpad;
  const buttons  = mc?.buttons  || base.actions;
  const gestures = mc?.gestures || base.gestures || [];
  const tapZone  = mc?.tapZone  != null ? mc.tapZone : base.tapZone;

  if (!dpad.length && !buttons.length && !gestures.length && !tapZone) return null;

  const wrapper = document.createElement('div');
  Object.assign(wrapper.style, { position:'absolute', inset:'0', zIndex:'20', pointerEvents:'none' });

  if (tapZone && !dpad.length && !buttons.length) {
    Object.assign(wrapper.style, { pointerEvents:'auto', touchAction:'none' });
    wrapper.addEventListener('touchstart', e => { e.preventDefault(); rt.setInput(tapZone, true); },  { passive: false });
    wrapper.addEventListener('touchend',   e => { e.preventDefault(); rt.setInput(tapZone, false); }, { passive: false });
    wrapper.addEventListener('touchcancel',e => { e.preventDefault(); rt.setInput(tapZone, false); }, { passive: false });
    const hint = document.createElement('div');
    Object.assign(hint.style, { position:'absolute', bottom:'16px', left:'0', right:'0', textAlign:'center', fontSize:'11px', fontFamily:'monospace', color:'rgba(255,255,255,0.3)', pointerEvents:'none' });
    hint.textContent = 'TAP TO PLAY';
    wrapper.appendChild(hint);
    container.appendChild(wrapper);
    return wrapper;
  }

  if (gestures.length) {
    const gl = document.createElement('div');
    Object.assign(gl.style, { position:'absolute', inset:'0', zIndex:'1', touchAction:'none', pointerEvents:'auto' });
    let ts = { x: 0, y: 0, t: 0 };
    gl.addEventListener('touchstart', e => { const t = e.touches[0]; ts = { x: t.clientX, y: t.clientY, t: Date.now() }; }, { passive: true });
    gl.addEventListener('touchend', e => {
      const t = e.changedTouches[0];
      const dx = t.clientX - ts.x, dy = t.clientY - ts.y;
      if (Date.now() - ts.t < 350 && Math.hypot(dx, dy) > 35) {
        const type = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'swipe-right' : 'swipe-left') : (dy > 0 ? 'swipe-down' : 'swipe-up');
        const m = gestures.find(g => g.type === type);
        if (m) { rt.setInput(m.input, true); setTimeout(() => rt.setInput(m.input, false), 150); }
      }
    }, { passive: true });
    wrapper.appendChild(gl);
  }

  const bar = document.createElement('div');
  Object.assign(bar.style, { position:'absolute', bottom:'0', left:'0', right:'0', zIndex:'2', display:'flex', justifyContent:'space-between', alignItems:'flex-end', padding:'6px 12px 10px', background:'linear-gradient(to bottom,transparent,rgba(0,0,0,0.55))', pointerEvents:'none' });
  const dpadEl   = _makeDPad(dpad, rt);
  const actionEl = _makeActionCluster(buttons, rt);
  if (dpadEl)   bar.appendChild(dpadEl);
  else          { const sp = document.createElement('span'); bar.appendChild(sp); }
  if (actionEl) bar.appendChild(actionEl);
  wrapper.appendChild(bar);
  container.appendChild(wrapper);
  return wrapper;
}

// ─── Level-type-aware level switcher ─────────────────────────────────────────

let activeRuntime = null;
let onDown = null;
let onUp   = null;
let activeTouchEl = null;

function stopActiveGame() {
  if (activeRuntime) { activeRuntime.stop(); activeRuntime = null; }
  if (onDown) { window.removeEventListener('keydown', onDown, { capture: true }); onDown = null; }
  if (onUp)   { window.removeEventListener('keyup',   onUp,   { capture: true }); onUp   = null; }
  if (activeTouchEl) { activeTouchEl.remove(); activeTouchEl = null; }
}

function sizeViewportFrame(container, canvas, viewportW, viewportH) {
  // Match RuntimeView exactly: fixed pixel frame, no CSS transform.
  // canvas CSS = pixel buffer dims; container = same dims so HUD aligns.
  canvas.style.width  = viewportW + 'px';
  canvas.style.height = viewportH + 'px';
  container.style.width  = viewportW + 'px';
  container.style.height = viewportH + 'px';
}

function shouldUseMobileViewport(mv) {
  if (!mv?.enabled) return false;
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouchDevice) return false;
  const isPortrait = window.matchMedia('(orientation: portrait)').matches;
  return mv.orientation === 'both' ||
    (mv.orientation === 'portrait' && isPortrait) ||
    (mv.orientation === 'landscape' && !isPortrait);
}

function getRuntimeViewport(level, world) {
  const tileW = level.tileMap?.tileWidth  || 32;
  const tileH = level.tileMap?.tileHeight || 32;
  const mv = level?.mobileViewport?.enabled ? level.mobileViewport : world?.worldSettings?.mobileViewport;
  const useMobile = shouldUseMobileViewport(mv);
  const defaultMobileW = mv?.orientation === 'landscape' ? 844 : 390;
  const defaultMobileH = mv?.orientation === 'landscape' ? 390 : 844;
  return {
    width:  useMobile ? (Number(mv.renderWidth)  || defaultMobileW) : (level.viewportCols || 20) * tileW,
    height: useMobile ? (Number(mv.renderHeight) || defaultMobileH) : (level.viewportRows || 14) * tileH,
  };
}

// Show a level — handles hud-only, game+hud, and game.
function showLevel(world, assets, canvas, hudEl, levelId, navigate, mpAdapter) {
  stopActiveGame();

  const level = world.levels.find(l => l.id === levelId) || world.levels[0];
  if (!level) return;

  const levelType  = level.levelType || 'game';
  const showGame   = levelType === 'game' || levelType === 'game+hud';
  const showHUD    = levelType === 'hud-only' || levelType === 'game+hud';
  const hasHudRows = (level.rows || []).length > 0;

  const breadcrumb = document.getElementById('level-name');
  if (breadcrumb) breadcrumb.textContent = level.name || '';

  // ── HUD overlay ──────────────────────────────────────────────────────────
  let hudBindings = [];
  if (hudEl) {
    hudEl.innerHTML = '';
    if (showHUD && hasHudRows) {
      hudEl.style.display = 'flex';
      hudEl.style.flexDirection = 'column';
      const isSW = level.rows?.length === 1 && level.rows[0]?.children?.length === 1 && level.rows[0].children[0].type === 'Window';
      hudEl.style.alignItems    = isSW ? 'center' : '';
      hudEl.style.justifyContent = isSW ? 'center' : '';
      const { el, bindings } = renderHudRows(level.rows, navigate);
      hudEl.appendChild(el);
      hudBindings = bindings;
    } else {
      hudEl.style.display = 'none';
    }
  }

  // ── Game canvas ──────────────────────────────────────────────────────────
  if (!showGame) { canvas.style.display = 'none'; return; }

  canvas.style.display = 'block';

  const { width: viewportW, height: viewportH } = getRuntimeViewport(level, world);
  canvas.width  = viewportW;
  canvas.height = viewportH;

  const container = canvas.parentElement;
  if (container) sizeViewportFrame(container, canvas, viewportW, viewportH);

  const _rawMv = level?.mobileViewport?.enabled ? level.mobileViewport : world?.worldSettings?.mobileViewport;
  const _activeMv = shouldUseMobileViewport(_rawMv) ? _rawMv : null;

  // If the adapter exists, tell it we're now on this level
  if (mpAdapter && mpAdapter._levelId !== levelId) {
    mpAdapter.changeLevel(levelId);
  }

  const rt = new GameRuntime({
    level, assets, canvas,
    worldSettings: world?.worldSettings,
    mobileViewport: _activeMv,
    mpAdapter: mpAdapter || null,
    onGameStateChange: (gs) => {
      for (const b of hudBindings) {
        b.el.textContent = resolveStandaloneBinding(b.bindTo, b.template, gs);
      }
    },
  });
  activeRuntime = rt;

  onDown = (e) => { const a = KEY_MAP[e.key]; if (!a) return; e.preventDefault(); rt.setInput(a, true); };
  onUp   = (e) => { const a = KEY_MAP[e.key]; if (!a) return; rt.setInput(a, false); };
  window.addEventListener('keydown', onDown, { capture: true });
  window.addEventListener('keyup',   onUp,   { capture: true });

  if (container) activeTouchEl = addTouchControls(container, rt, world);

  rt.preloadPromise.catch(() => {}).then(() => {
    if (activeRuntime !== rt) return;
    // Send entity template so peers can render us correctly
    if (mpAdapter) {
      const player = rt._findPlayer?.();
      if (player) {
        mpAdapter.setEntityTemplate({
          renderSize: player.renderSize,
          spriteSheetAssetId: player.spriteSheetAssetId,
          animations: player.animations,
          defaultAnimation: player.defaultAnimation,
          color: player.color,
        });
        // Re-send join with template now that we have it
        if (mpAdapter._ws?.readyState === 1) {
          mpAdapter._ws.send(JSON.stringify({ t: 'join', username: mpAdapter._username, entityTemplate: mpAdapter._entityTpl }));
        }
      }
    }
    rt.start();
    canvas.focus({ preventScroll: true });
  });
}

// ─── Embed scaling ────────────────────────────────────────────────────────────
// Mirrors EmbedRuntime.jsx exactly: set CSS width/height on the canvas
// (pixel buffer stays at native), flex-center wrapper handles alignment.
function applyEmbedScale(container, canvas, nativeW, nativeH, scaling, maintainAspect) {
  canvas.style.transform = '';
  const update = () => {
    const cw = container.clientWidth  || nativeW;
    const ch = container.clientHeight || nativeH;
    if (scaling === 'fixed') {
      canvas.style.width  = nativeW + 'px';
      canvas.style.height = nativeH + 'px';
      return;
    }
    let displayW, displayH;
    if (!maintainAspect) {
      displayW = cw;
      displayH = ch;
    } else if (scaling === 'fill') {
      const s = Math.max(cw / nativeW, ch / nativeH);
      displayW = Math.round(nativeW * s);
      displayH = Math.round(nativeH * s);
    } else {
      const s = Math.min(cw / nativeW, ch / nativeH);
      displayW = Math.round(nativeW * s);
      displayH = Math.round(nativeH * s);
    }
    canvas.style.width  = displayW + 'px';
    canvas.style.height = displayH + 'px';
  };
  update();
  new ResizeObserver(update).observe(container);
}

// ─── Multiple inline embeds (GameEmbed component in page export) ──────────────
function initEmbeds() {
  const embeds = window.__TUIFY_EMBEDS__;
  if (!Array.isArray(embeds) || !embeds.length) return;

  embeds.forEach(({ canvasId, hudElId, world, assets: embedAssets, scaling = 'fit', maintainAspect = true }) => {
    if (!world?.levels?.length) return;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const hudEl    = hudElId ? document.getElementById(hudElId) : null;
  const safeAssets = embedAssets || { sprites: [], tilesets: [], sounds: [], backgrounds: [], videos: [] };
    let rt = null;
    let localDown = null;
    let localUp   = null;
    let localTouchEl = null;

    function stopEmbed() {
      if (rt) { rt.stop(); rt = null; }
      if (localDown) { canvas.removeEventListener('keydown', localDown, { capture: true }); localDown = null; }
      if (localUp)   { canvas.removeEventListener('keyup',   localUp,   { capture: true }); localUp   = null; }
      if (localTouchEl) { localTouchEl.remove(); localTouchEl = null; }
    }

    function navigate(levelId) {
      const target = world.levels.find(l => l.id === levelId);
      if (!target) return;
      startEmbed(levelId);
    }

    function startEmbed(levelId) {
      stopEmbed();
      const level = world.levels.find(l => l.id === levelId) || world.levels[0];
      if (!level) return;

      const levelType  = level.levelType || 'game';
      const showGame   = levelType === 'game' || levelType === 'game+hud';
      const showHUD    = levelType === 'hud-only' || levelType === 'game+hud';
      const hasHudRows = (level.rows || []).length > 0;

      // ── HUD overlay ────────────────────────────────────────────────────────
      let hudBindings = [];
      if (hudEl) {
        hudEl.innerHTML = '';
        if (showHUD && hasHudRows) {
          hudEl.style.display = 'flex';
          hudEl.style.flexDirection = 'column';
          const isSW = level.rows?.length === 1 && level.rows[0]?.children?.length === 1 && level.rows[0].children[0].type === 'Window';
          hudEl.style.alignItems    = isSW ? 'center' : '';
          hudEl.style.justifyContent = isSW ? 'center' : '';
          const { el, bindings } = renderHudRows(level.rows, navigate);
          hudEl.appendChild(el);
          hudBindings = bindings;
        } else {
          hudEl.style.display = 'none';
        }
      }

      // ── Game canvas ────────────────────────────────────────────────────────
      if (!showGame) { canvas.style.display = 'none'; return; }

      canvas.style.display = 'block';

      const { width: vW, height: vH } = getRuntimeViewport(level, world);
      canvas.width  = vW;
      canvas.height = vH;

      const outerContainer = canvas.parentElement?.parentElement;
      if (outerContainer) {
        outerContainer.style.aspectRatio = `${vW} / ${vH}`;
        outerContainer.style.maxWidth = '100%';
        applyEmbedScale(outerContainer, canvas, vW, vH, scaling, maintainAspect);
      }

      const _rawMvE = level?.mobileViewport?.enabled ? level.mobileViewport : world?.worldSettings?.mobileViewport;
      const _activeMvE = shouldUseMobileViewport(_rawMvE) ? _rawMvE : null;

      const newRt = new GameRuntime({
        level, assets: safeAssets, canvas,
        worldSettings: world?.worldSettings,
        mobileViewport: _activeMvE,
        onGameStateChange: (gs) => {
          for (const b of hudBindings) {
            b.el.textContent = resolveStandaloneBinding(b.bindTo, b.template, gs);
          }
        },
      });
      rt = newRt;

      localDown = (e) => { const a = KEY_MAP[e.key]; if (!a) return; e.preventDefault(); newRt.setInput(a, true); };
      localUp   = (e) => { const a = KEY_MAP[e.key]; if (!a) return; newRt.setInput(a, false); };
      canvas.addEventListener('keydown', localDown, { capture: true });
      canvas.addEventListener('keyup',   localUp,   { capture: true });

      const embedContainer = canvas.parentElement;
      if (embedContainer) localTouchEl = addTouchControls(embedContainer, newRt, world);

      newRt.preloadPromise.catch(() => {}).then(() => {
        if (rt !== newRt) return;
        newRt.start();
        canvas.focus({ preventScroll: true });
      });
    }

    canvas.addEventListener('click', () => canvas.focus({ preventScroll: true }));
    startEmbed(world.startLevelId || world.levels[0]?.id);
  });
}

// ─── Multiplayer join overlay ─────────────────────────────────────────────────
function showJoinOverlay(container, onJoin) {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'absolute', inset: '0', zIndex: '50',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.88)', fontFamily: 'monospace',
  });

  const box = document.createElement('div');
  Object.assign(box.style, {
    border: '1px solid #33ff33', padding: '24px 32px', display: 'flex',
    flexDirection: 'column', gap: '14px', minWidth: '260px', background: '#0a0a0a',
  });

  const title = document.createElement('div');
  title.textContent = '[ MULTIPLAYER ]';
  Object.assign(title.style, { color: '#33ff33', fontSize: '13px', letterSpacing: '2px', fontWeight: 'bold' });

  const sub = document.createElement('div');
  sub.textContent = 'Enter your player name:';
  Object.assign(sub.style, { color: 'rgba(255,255,255,0.55)', fontSize: '11px' });

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 20;
  input.placeholder = 'Player';
  Object.assign(input.style, {
    background: '#111', border: '1px solid #33ff33', color: '#33ff33',
    fontFamily: 'monospace', fontSize: '14px', padding: '8px 10px',
    outline: 'none', letterSpacing: '1px',
  });

  const btn = document.createElement('button');
  btn.textContent = '▶ Join Game';
  Object.assign(btn.style, {
    background: 'transparent', border: '1px solid #33ff33', color: '#33ff33',
    fontFamily: 'monospace', fontSize: '12px', padding: '8px', cursor: 'pointer',
    letterSpacing: '2px', textTransform: 'uppercase',
  });
  btn.onmouseenter = () => { btn.style.background = 'rgba(51,255,51,0.12)'; };
  btn.onmouseleave = () => { btn.style.background = 'transparent'; };

  const errMsg = document.createElement('div');
  Object.assign(errMsg.style, { color: '#ff4444', fontSize: '10px', minHeight: '14px' });

  const join = () => {
    const name = input.value.trim() || 'Player';
    overlay.remove();
    onJoin(name);
  };

  btn.onclick = join;
  input.onkeydown = (e) => { if (e.key === 'Enter') join(); };

  box.appendChild(title);
  box.appendChild(sub);
  box.appendChild(input);
  box.appendChild(btn);
  box.appendChild(errMsg);
  overlay.appendChild(box);

  const wrap = container.parentElement || container;
  wrap.style.position = 'relative';
  wrap.appendChild(overlay);
  setTimeout(() => input.focus(), 50);

  return { overlay, errMsg };
}

// ─── Standalone init ──────────────────────────────────────────────────────────
function init() {
  if (window.__TUIFY_EMBEDS__) { initEmbeds(); return; }

  // Support __TUIFY_WORLDS__ (all worlds, new format) and
  // __TUIFY_WORLD__ (single world, legacy format — wrap in array).
  const worlds = window.__TUIFY_WORLDS__ ||
    (window.__TUIFY_WORLD__ ? [window.__TUIFY_WORLD__] : null);
  const assets = window.__TUIFY_ASSETS__ || { sprites: [], tilesets: [], sounds: [], backgrounds: [], videos: [] };

  if (!worlds?.length) {
    document.body.innerHTML = '<p style="color:#f44;font-family:monospace;padding:20px">No world data.</p>';
    return;
  }

  const canvas = document.getElementById(window.__TUIFY_CANVAS_ID__ || 'game-canvas');
  const hudEl  = document.getElementById('hud-overlay');
  if (!canvas) return;

  canvas.addEventListener('click', () => canvas.focus({ preventScroll: true }));

  // One multiplayer adapter per world (persists across level changes within same world)
  let mpAdapters = new Map(); // worldId → MultiplayerAdapter

  function getMpAdapter(world, levelId) {
    const mp = world?.worldSettings?.multiplayer;
    if (!mp?.enabled) return null;
    const wsBase = window.__TUIFY_WS_URL__;
    const slug   = window.__TUIFY_SLUG__;
    if (!wsBase || !slug) return null;
    if (mpAdapters.has(world.id)) {
      const existing = mpAdapters.get(world.id);
      if (existing._levelId !== levelId) existing.changeLevel(levelId);
      return existing;
    }
    return null; // will be created after join overlay
  }

  function createMpAdapter(world, levelId, username) {
    const wsBase = window.__TUIFY_WS_URL__;
    const slug   = window.__TUIFY_SLUG__;
    if (!wsBase || !slug) return null;
    const adapter = new MultiplayerAdapter({
      wsBase, slug, levelId, username,
      onError: (msg) => console.warn('[mp] Server error:', msg),
    });
    adapter.connect();
    mpAdapters.set(world.id, adapter);
    return adapter;
  }

  // Navigate to any level or world by ID — searches across ALL worlds.
  function navigate(targetId, mpAdapter) {
    for (const w of worlds) {
      if ((w.levels || []).some(l => l.id === targetId)) {
        const adapter = getMpAdapter(w, targetId) || mpAdapter;
        showLevel(w, assets, canvas, hudEl, targetId, (id) => navigate(id, adapter), adapter);
        return;
      }
    }
    // Target is a world ID — start that world from its first level
    const targetWorld = worlds.find(w => w.id === targetId);
    if (targetWorld?.levels?.length) {
      const startId = targetWorld.startLevelId || targetWorld.levels[0]?.id;
      const adapter = getMpAdapter(targetWorld, startId) || mpAdapter;
      showLevel(targetWorld, assets, canvas, hudEl, startId, (id) => navigate(id, adapter), adapter);
    }
  }

  // Start at first world's first level
  const firstWorld = worlds[0];
  const startId = firstWorld.startLevelId || firstWorld.levels?.[0]?.id;
  const mpSettings = firstWorld?.worldSettings?.multiplayer;

  function startGame(mpAdapter) {
    showLevel(firstWorld, assets, canvas, hudEl, startId, (id) => navigate(id, mpAdapter), mpAdapter);
  }

  // If multiplayer is enabled, show join overlay first
  if (mpSettings?.enabled && window.__TUIFY_WS_URL__ && window.__TUIFY_SLUG__) {
    const container = canvas.parentElement || document.body;
    const { overlay, errMsg } = showJoinOverlay(container, (username) => {
      const adapter = createMpAdapter(firstWorld, startId, username);
      startGame(adapter);
    });
  } else {
    startGame(null);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
