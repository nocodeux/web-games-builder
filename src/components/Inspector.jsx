/**
 * Inspector.jsx — With AutoLayout panel when a ROW is selected
 *
 * When isRow=true, shows layout controls:
 * - Direction (row / column)
 * - Gap (spacing between children)
 * - Align items (cross-axis)
 * - Justify content (main-axis)
 * - Wrap
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DEFAULT_MOBILE_ROW_LAYOUT, DEFAULT_MOBILE_SCREEN_LAYOUT } from './Canvas';
import IconPicker from './IconPicker';
import { resolveTilesetView, cellOrigin, listTileSources } from '../lib/tilesetView';
import { NumericInput } from '../lib/inputs';
import { loadMaskedImage } from '../lib/imageMask';
import { uploadAsset } from '../lib/assetUpload';
import Selector from './Componentes/Selector';
import { GENRE_TREE, getPreset, getSubtypes, buildLevelEntities } from '../lib/gamePresets';
import { DEFAULT_INTERACTION_SOUNDS, SOUND_ACTIONS, BUILTIN_MACHINE_SOUNDS, getScreenSoundSettings, listAvailableSounds } from '../lib/interactionAudio';
import { playInteractionSound } from '../lib/interactionAudio';

const mkId = () => Math.random().toString(36).substring(2, 9);

// Retro-styled toggle checkbox for the inspector.
function RetroCheckbox({ checked, onChange }) {
  return (
    <div
      onClick={() => {
        playInteractionSound(null, null, 'click');
        onChange(!checked);
      }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 14, height: 14,
        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
        background: checked ? 'var(--accent)' : 'transparent',
        color: checked ? 'var(--bg)' : 'transparent',
        fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold',
        cursor: 'pointer', userSelect: 'none',
        transition: 'background 0.1s, border-color 0.1s',
      }}
    >
      {checked ? '✓' : ''}
    </div>
  );
}

// ─── Tile palette ─────────────────────────────────────────────────────────
// Renders each cell of the active tileset as a clickable swatch. Selecting
// arms a paint brush; the LevelCanvas reads the brush and paints on click.
function TileSwatch({ tileset, cellIndex, size, isSelected, onPick }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !tileset?.src) return;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, size, size);
      const cols = Math.max(1, tileset.cols || 1);
      const col = cellIndex % cols;
      const row = Math.floor(cellIndex / cols);
      const { x: sx, y: sy } = cellOrigin(tileset, col, row);
      // Letterbox the tile inside the swatch while preserving aspect.
      const aspect = tileset.tileWidth / tileset.tileHeight;
      let dw = size, dh = size;
      if (aspect > 1) dh = size / aspect; else dw = size * aspect;
      const dx = (size - dw) / 2;
      const dy = (size - dh) / 2;
      ctx.drawImage(img, sx, sy, tileset.tileWidth, tileset.tileHeight, dx, dy, dw, dh);
    };
    img.src = tileset.src;
  }, [tileset?.src, cellIndex, size, tileset?.cols, tileset?.tileWidth, tileset?.tileHeight,
      JSON.stringify(tileset?.gapX), JSON.stringify(tileset?.gapY),
      JSON.stringify(tileset?.offsetLeft), JSON.stringify(tileset?.offsetTop)]);
  return (
    <canvas
      ref={ref}
      width={size} height={size}
      onClick={() => onPick(cellIndex)}
      title={`tile #${cellIndex}`}
      style={{
        display: 'block', cursor: 'pointer', imageRendering: 'pixelated',
        background: 'rgba(0,0,0,0.4)',
        border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
        outline: 'none', padding: 0, margin: 0,
      }}
    />
  );
}

function TilePalette({ tileset, brush, layerId, onSetBrush }) {
  if (!tileset) return null;
  const total = (tileset.cols || 1) * (tileset.rows || 1);
  const SWATCH = 32;
  const isEraser = brush?.layerId === layerId && brush?.tileValue === 0;
  return (
    <div>
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${SWATCH + 2}px)`,
        gap: 2, padding: 2, background: 'rgba(0,0,0,0.25)',
        border: '1px solid var(--border)', maxHeight: 200, overflowY: 'auto',
      }}>
        {Array.from({ length: total }, (_, i) => {
          const tileValue = i + 1; // 0 reserved for empty/eraser
          const isSelected = brush?.layerId === layerId && brush?.tileValue === tileValue;
          return (
            <TileSwatch
              key={i}
              tileset={tileset}
              cellIndex={i}
              size={SWATCH}
              isSelected={isSelected}
              onPick={() => onSetBrush(isSelected ? null : { layerId, tileValue })}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button
          type="button"
          className="small-btn"
          onClick={() => onSetBrush(isEraser ? null : { layerId, tileValue: 0 })}
          style={{
            flex: 1,
            background: isEraser ? '#ff5566' : 'transparent',
            color: isEraser ? 'var(--bg)' : '#ff8899',
            borderColor: '#ff5566',
          }}
        >{isEraser ? '◉ erasing — click to disarm' : '⌫ eraser'}</button>
        {brush && !isEraser && (
          <button
            type="button"
            className="small-btn"
            onClick={() => onSetBrush(null)}
            title="Clear brush"
          >× disarm</button>
        )}
      </div>
    </div>
  );
}

// ─── Panel AutoLayout (solo para filas) ──────────────────────────────────────
function AutoLayoutPanel({ layout = {}, onUpdate }) {
  const [localGap, setLocalGap] = useState(layout.gap ?? 8);
  const [localP, setLocalP] = useState({
    T: layout.paddingTop ?? 0,
    R: layout.paddingRight ?? 0,
    B: layout.paddingBottom ?? 0,
    L: layout.paddingLeft ?? 0
  });

  useEffect(() => {
    setLocalGap(layout.gap ?? 8);
    setLocalP({
      T: layout.paddingTop ?? 0,
      R: layout.paddingRight ?? 0,
      B: layout.paddingBottom ?? 0,
      L: layout.paddingLeft ?? 0
    });
  }, [layout]);

  const dir = layout.direction || 'row';
  const align = layout.align || 'flex-start';
  const justify = layout.justify || 'flex-start';
  const wrap = layout.wrap || false;
  const pLinked = layout.paddingLinked !== false;

  const AlignBtn = ({ value, icon, field, current }) => (
    <button className={`al-btn ${current === value ? 'al-active' : ''}`} onClick={() => onUpdate({ [field]: value })} title={value}>{icon}</button>
  );

  const commitPadding = (side, val) => {
    const v = parseInt(val, 10);
    if (isNaN(v)) {
      setLocalP(prev => ({ ...prev, [side]: layout[`padding${side === 'T' ? 'Top' : side === 'R' ? 'Right' : side === 'B' ? 'Bottom' : 'Left'}`] ?? 0 }));
      return;
    }
    if (pLinked) {
      onUpdate({ paddingTop: v, paddingRight: v, paddingBottom: v, paddingLeft: v });
    } else {
      const field = side === 'T' ? 'paddingTop' : side === 'R' ? 'paddingRight' : side === 'B' ? 'paddingBottom' : 'paddingLeft';
      onUpdate({ [field]: v });
    }
  };

  const commitGap = (val) => {
    const v = parseInt(val, 10);
    if (!isNaN(v)) onUpdate({ gap: v });
    else setLocalGap(layout.gap ?? 8);
  };

  return (
    <div className="autolayout-panel">
      <div className="al-section-title">AUTO LAYOUT</div>
      <div className="property-group">
        <label>DIRECTION</label>
        <div className="al-btn-group">
          <button className={`al-btn ${dir === 'row' ? 'al-active' : ''}`} onClick={() => onUpdate({ direction: 'row' })}>→ Row</button>
          <button className={`al-btn ${dir === 'column' ? 'al-active' : ''}`} onClick={() => onUpdate({ direction: 'column' })}>↓ Col</button>
        </div>
      </div>
      <div className="property-group">
        <label>GAP (px)</label>
        <input 
          type="text" 
          inputMode="numeric" 
          value={localGap}
          onChange={e => setLocalGap(e.target.value)}
          onBlur={e => commitGap(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && e.target.blur()}
          style={{ width: '100%' }} 
        />
      </div>
      <div className="property-group">
        <label>{dir === 'row' ? 'ALIGN VERTICAL' : 'ALIGN HORIZONTAL'}</label>
        <div className="al-btn-group">
          <AlignBtn field="align" value="flex-start" current={align} icon={dir === 'row' ? '⬆' : '⬅'} />
          <AlignBtn field="align" value="center" current={align} icon="⊕" />
          <AlignBtn field="align" value="flex-end" current={align} icon={dir === 'row' ? '⬇' : '➡'} />
          <AlignBtn field="align" value="stretch" current={align} icon="↕" />
        </div>
      </div>
      <div className="property-group">
        <label>{dir === 'row' ? 'JUSTIFY HORIZONTAL' : 'JUSTIFY VERTICAL'}</label>
        <div className="al-btn-group">
          <AlignBtn field="justify" value="flex-start" current={justify} icon="⊢" />
          <AlignBtn field="justify" value="center" current={justify} icon="⊙" />
          <AlignBtn field="justify" value="flex-end" current={justify} icon="⊣" />
          <AlignBtn field="justify" value="space-between" current={justify} icon="⟺" />
          <AlignBtn field="justify" value="space-around" current={justify} icon="↔" />
        </div>
      </div>
      <div className="property-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <label style={{ margin: 0 }}>WRAP</label>
        <input type="checkbox" checked={wrap} onChange={e => onUpdate({ wrap: e.target.checked })} />
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{wrap ? 'On' : 'Off'}</span>
      </div>
      {/* Padding */}
      <div className="property-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>PADDING
          <button onClick={() => onUpdate({ paddingLinked: !pLinked })} style={{ background: 'none', border: '1px solid var(--border)', color: pLinked ? 'var(--accent)' : 'var(--text-dim)', cursor: 'pointer', fontSize: 9, padding: '1px 4px', fontFamily: 'monospace' }}>{pLinked ? '🔗' : '⋯'}</button>
        </label>
        {pLinked ? (
          <input 
            type="text" 
            inputMode="numeric" 
            value={localP.T} 
            onChange={e => { const v = e.target.value; setLocalP({ T: v, R: v, B: v, L: v }); }} 
            onBlur={e => commitPadding('T', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && e.target.blur()}
            style={{ width: '100%' }} 
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <div><span style={{ fontSize: 8, color: 'var(--text-dim)' }}>T</span><input type="text" inputMode="numeric" value={localP.T} onChange={e => setLocalP(prev => ({ ...prev, T: e.target.value }))} onBlur={e => commitPadding('T', e.target.value)} onKeyDown={e => e.key === 'Enter' && e.target.blur()} style={{ width: '100%' }} /></div>
            <div><span style={{ fontSize: 8, color: 'var(--text-dim)' }}>R</span><input type="text" inputMode="numeric" value={localP.R} onChange={e => setLocalP(prev => ({ ...prev, R: e.target.value }))} onBlur={e => commitPadding('R', e.target.value)} onKeyDown={e => e.key === 'Enter' && e.target.blur()} style={{ width: '100%' }} /></div>
            <div><span style={{ fontSize: 8, color: 'var(--text-dim)' }}>B</span><input type="text" inputMode="numeric" value={localP.B} onChange={e => setLocalP(prev => ({ ...prev, B: e.target.value }))} onBlur={e => commitPadding('B', e.target.value)} onKeyDown={e => e.key === 'Enter' && e.target.blur()} style={{ width: '100%' }} /></div>
            <div><span style={{ fontSize: 8, color: 'var(--text-dim)' }}>L</span><input type="text" inputMode="numeric" value={localP.L} onChange={e => setLocalP(prev => ({ ...prev, L: e.target.value }))} onBlur={e => commitPadding('L', e.target.value)} onKeyDown={e => e.key === 'Enter' && e.target.blur()} style={{ width: '100%' }} /></div>
          </div>
        )}
      </div>
      {/* Preview */}
      <div className="al-preview">
        <div style={{ display: 'flex', flexDirection: dir, gap: Math.min(parseInt(localGap, 10) || 0, 6), alignItems: align, justifyContent: justify, flexWrap: wrap ? 'wrap' : 'nowrap', width: '100%', height: 40, padding: 4 }}>
          {[1,2,3].map(i => (<div key={i} style={{ width: 14, height: 14, background: 'var(--accent)', opacity: 0.7, flexShrink: 0 }} />))}
        </div>
      </div>
    </div>
  );
}

// Nullable numeric input — empty string means "no override" (null).
// Used for per-animation-slot renderH and spriteOffsetY overrides.
function NullNumInput({ value, placeholder, onCommit, style }) {
  const [draft, setDraft] = React.useState(value != null ? String(value) : '');
  React.useEffect(() => { setDraft(value != null ? String(value) : ''); }, [value]);
  const commit = () => {
    const s = draft.trim();
    if (s === '') { onCommit(null); return; }
    const n = parseInt(s, 10);
    if (!Number.isNaN(n)) { onCommit(n); } else { setDraft(value != null ? String(value) : ''); }
  };
  return (
    <input
      type="text" inputMode="numeric"
      value={draft}
      placeholder={placeholder}
      onChange={e => { if (/^-?\d*$/.test(e.target.value)) setDraft(e.target.value); }}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { commit(); e.target.blur(); } }}
      style={style}
    />
  );
}

function FilterValueInput({ value, onCommit, placeholder }) {
  const [draft, setDraft] = React.useState(value ?? '');
  React.useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  return (
    <input
      type="text"
      value={draft}
      onChange={e => {
        const next = e.target.value;
        setDraft(next);
        onCommit(next);
      }}
      onPaste={e => {
        const next = e.clipboardData.getData('text');
        if (next !== undefined) {
          setDraft(next);
          onCommit(next);
        }
      }}
      placeholder={placeholder}
    />
  );
}

// Overlay preview: draws the idle ghost + the slot's live animation on a canvas
// so the user can compare size/position side-by-side without leaving the inspector.
function SlotOverlayPreview({ entity, slot, assets }) {
  const canvasRef = useRef(null);
  const idleImgRef = useRef(null);
  const slotImgRef = useRef(null);
  const [frame, setFrame] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const sprites = assets?.sprites || [];
  const defaultSlot = (entity.animations || []).find(a => a.name === entity.defaultAnimation) || null;
  const isDefaultSlot = defaultSlot?.id === slot.id;
  const defaultSheet  = isDefaultSlot ? null : sprites.find(s => s.id === defaultSlot?.spriteSheetId) || null;
  const defaultAnimDef = defaultSheet ? (defaultSheet.animations || []).find(a => a.name === defaultSlot?.animName) || null : null;
  const slotSheet   = sprites.find(s => s.id === slot.spriteSheetId) || null;
  const slotAnimDef = slotSheet ? (slotSheet.animations || []).find(a => a.name === slot.animName) || null : null;

  // Load both images whenever sheets change.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    idleImgRef.current = null;
    slotImgRef.current = null;
    const loads = [];
    if (defaultSheet?.src) {
      loads.push(
        loadMaskedImage(defaultSheet.src, defaultSheet.frame?.transparentColor || null, defaultSheet.frame?.transparentTolerance || 0)
          .then(e => { if (!cancelled && e) idleImgRef.current = e.img; })
      );
    }
    if (slotSheet?.src) {
      loads.push(
        loadMaskedImage(slotSheet.src, slotSheet.frame?.transparentColor || null, slotSheet.frame?.transparentTolerance || 0)
          .then(e => { if (!cancelled && e) slotImgRef.current = e.img; })
      );
    }
    Promise.all(loads).then(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [defaultSheet?.id, slotSheet?.id]);

  // Cycle the slot animation frames.
  useEffect(() => {
    const frames = slotAnimDef?.frames || [];
    if (frames.length <= 1) { setFrame(0); return; }
    const fps = Math.max(1, slotAnimDef.fps || 6);
    setFrame(0);
    const id = setInterval(() => setFrame(f => (f + 1) % frames.length), 1000 / fps);
    return () => clearInterval(id);
  }, [slotAnimDef?.frames?.length, slotAnimDef?.fps]);

  // Redraw canvas whenever anything changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const PH = canvas.height;
    const PW = canvas.width;
    ctx.clearRect(0, 0, PW, PH);

    const entityRenderH = entity.renderSize?.height || 64;

    const drawLayer = (sheet, animDef, imgEl, frameIdx, renderH, offY, alpha) => {
      if (!imgEl || !animDef?.frames?.length || !sheet?.frame) return;
      const f = sheet.frame;
      const fi = animDef.frames[Math.min(frameIdx, animDef.frames.length - 1)] ?? 0;
      const cols = Math.max(1, f.cols || 1);
      const view = {
        tileWidth: f.width, tileHeight: f.height,
        cols: f.cols, rows: f.rows,
        offsetLeft: f.offsetLeft ?? f.offsetX ?? 0,
        offsetTop:  f.offsetTop  ?? f.offsetY ?? 0,
        gapX: f.gapX, gapY: f.gapY,
      };
      const { x: sx, y: sy } = cellOrigin(view, fi % cols, Math.floor(fi / cols));
      const fw = f.width, fh = f.height;
      const dh = renderH;
      const dw = Math.round(fw * (renderH / fh));
      const px = Math.round((PW - dw) / 2);
      const py = PH - dh - offY;
      ctx.globalAlpha = alpha;
      ctx.drawImage(imgEl, sx, sy, fw, fh, px, py, dw, dh);
      ctx.globalAlpha = 1;
    };

    // Ghost layer — idle / default animation dimmed
    if (!isDefaultSlot && defaultAnimDef && idleImgRef.current) {
      const idleH   = defaultSlot?.renderH != null ? defaultSlot.renderH : entityRenderH;
      const idleOff = defaultSlot?.spriteOffsetY != null ? defaultSlot.spriteOffsetY : (entity.spriteOffsetY || 0);
      drawLayer(defaultSheet, defaultAnimDef, idleImgRef.current, 0, idleH, idleOff, 0.35);
    }

    // Active layer — slot animation at full opacity
    if (slotAnimDef && slotImgRef.current) {
      const slotH   = slot.renderH != null ? slot.renderH : entityRenderH;
      const slotOff = slot.spriteOffsetY != null ? slot.spriteOffsetY : (entity.spriteOffsetY || 0);
      drawLayer(slotSheet, slotAnimDef, slotImgRef.current, frame, slotH, slotOff, 1.0);
    }

    // Ground line
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, PH - 0.5);
    ctx.lineTo(PW, PH - 0.5);
    ctx.stroke();
  }, [loaded, frame, isDefaultSlot,
      slot.renderH, slot.spriteOffsetY,
      entity.renderSize?.height, entity.spriteOffsetY,
      defaultSlot?.renderH, defaultSlot?.spriteOffsetY]);

  const PH = Math.min(128, Math.max(64, entity.renderSize?.height ?? 64));
  const PW = Math.round(PH * 2.2);

  if (!slotSheet || !slotAnimDef) return null;

  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <canvas
        ref={canvasRef}
        width={PW} height={PH}
        style={{
          display: 'block', imageRendering: 'pixelated',
          background: 'rgba(0,0,0,0.55)',
          border: '1px solid var(--border)',
        }}
      />
      <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
        {!isDefaultSlot && defaultAnimDef
          ? `ghost = ${defaultSlot?.name || 'idle'} · active = ${slot.name}`
          : `preview = ${slot.name}`}
      </div>
    </div>
  );
}

// ─── Attack slot (behavior accordion item) ────────────────────────────────────
function AttackSlot({ attack, allAttacks, animSlots, expanded, onToggle, onChange, onRemove }) {
  const btnBase = { background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 11, lineHeight: 1, cursor: 'pointer', padding: '0 2px', flexShrink: 0 };
  return (
    <div style={{ border: '1px solid var(--border)', marginBottom: 3, borderRadius: 2 }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', cursor: 'pointer', userSelect: 'none', background: 'rgba(0,0,0,0.2)' }}>
        <span style={{ fontSize: 9, color: 'var(--text-dim)', width: 8, flexShrink: 0 }}>{expanded ? '▼' : '▶'}</span>
        <span style={{ flex: 1, fontSize: 10, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {attack.name || '(unnamed)'}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-dim)', flexShrink: 0 }}>
          {attack.anim || '—'} · {attack.damage ?? 25}dmg{attack.comboNext ? ' →' : ''}
        </span>
        <button type="button" onClick={e => { e.stopPropagation(); onRemove(); }} style={btnBase}>×</button>
      </div>
      {expanded && (
        <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="property-group" style={{ margin: 0 }}>
            <label>NAME</label>
            <input type="text" value={attack.name || ''} onChange={e => onChange({ name: e.target.value })} style={{ fontFamily: 'monospace', fontSize: 10 }} />
          </div>
          <div className="property-group" style={{ margin: 0 }}>
            <label title="Animation slot to play during this attack.">ANIM</label>
            <Selector value={attack.anim || ''} onChange={v => onChange({ anim: v || null })} options={[{value:'',label:'— none —'}, ...animSlots.map(a => ({value:a.name,label:a.name}))]} width="100%" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <div className="property-group" style={{ margin: 0 }}>
              <label title="Damage dealt to the target on a successful hit.">DAMAGE</label>
              <NumericInput min={0} value={attack.damage ?? 25} onCommit={n => onChange({ damage: n })} />
            </div>
            <div className="property-group" style={{ margin: 0 }}>
              <label title="Milliseconds the attack animation locks movement.">DURATION (ms)</label>
              <NumericInput min={50} value={attack.duration ?? 400} onCommit={n => onChange({ duration: n })} />
            </div>
            <div className="property-group" style={{ margin: 0 }}>
              <label title="Pixel distance in front of the character that the hit detects. Leave blank to auto (1.8× character width).">REACH (px)</label>
              <NumericInput min={1} value={attack.reach ?? ''} placeholder="auto"
                onCommit={n => onChange({ reach: n > 0 ? n : null })} />
            </div>
          </div>
          <div className="property-group" style={{ margin: 0 }}>
            <label title="Press attack again during the combo window to chain into this next attack.">NEXT IN COMBO</label>
            <Selector value={attack.comboNext || ''} onChange={v => onChange({ comboNext: v || null })} options={[{value:'',label:'— end of combo —'}, ...allAttacks.filter(a => a.id !== attack.id).map(a => ({value:a.id,label:a.name || '(unnamed)'}))]} width="100%" />
          </div>
          {attack.comboNext && (
            <div className="property-group" style={{ margin: 0 }}>
              <label title="Time in ms after the attack ends where pressing attack again chains to the next.">COMBO WINDOW (ms)</label>
              <NumericInput min={50} value={attack.comboWindow ?? 500} onCommit={n => onChange({ comboWindow: n })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Idle slot (behavior accordion item) ─────────────────────────────────────
function IdleSlot({ idle, animSlots, expanded, onToggle, onChange, onRemove }) {
  const btnBase = { background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 11, lineHeight: 1, cursor: 'pointer', padding: '0 2px', flexShrink: 0 };
  return (
    <div style={{ border: '1px solid var(--border)', marginBottom: 3, borderRadius: 2 }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', cursor: 'pointer', userSelect: 'none', background: 'rgba(0,0,0,0.2)' }}>
        <span style={{ fontSize: 9, color: 'var(--text-dim)', width: 8, flexShrink: 0 }}>{expanded ? '▼' : '▶'}</span>
        <span style={{ flex: 1, fontSize: 10, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {idle.name || '(unnamed)'}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-dim)', flexShrink: 0 }}>{idle.anim || '—'}</span>
        <button type="button" onClick={e => { e.stopPropagation(); onRemove(); }} style={btnBase}>×</button>
      </div>
      {expanded && (
        <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="property-group" style={{ margin: 0 }}>
            <label>NAME</label>
            <input type="text" value={idle.name || ''} onChange={e => onChange({ name: e.target.value })} style={{ fontFamily: 'monospace', fontSize: 10 }} />
          </div>
          <div className="property-group" style={{ margin: 0 }}>
            <label title="Animation slot to play for this idle variation.">ANIM</label>
            <Selector value={idle.anim || ''} onChange={v => onChange({ anim: v || null })} options={[{value:'',label:'— none —'}, ...animSlots.map(a => ({value:a.name,label:a.name}))]} width="100%" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <div className="property-group" style={{ margin: 0 }}>
              <label title="Minimum seconds before cycling to another idle.">MIN (s)</label>
              <NumericInput min={0.5} value={idle.minTime ?? 2} onCommit={n => onChange({ minTime: n })} />
            </div>
            <div className="property-group" style={{ margin: 0 }}>
              <label title="Maximum seconds this idle plays before switching.">MAX (s)</label>
              <NumericInput min={1} value={idle.maxTime ?? 6} onCommit={n => onChange({ maxTime: n })} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Retro checkbox (styled, matches canvas CheckBox component) ───────────────
function RetroCheck({ checked, onChange }) {
  return (
    <span
      onClick={() => {
        playInteractionSound(null, null, 'click');
        onChange();
      }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 13, height: 13, flexShrink: 0,
        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
        background: checked ? 'var(--accent)' : 'var(--bg)',
        cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, lineHeight: 1,
        color: checked ? 'var(--bg)' : 'transparent',
        userSelect: 'none', boxSizing: 'border-box',
      }}
    >✓</span>
  );
}

// ─── Collider shape list with selection, inline rename, one-way toggle ────────
function ColliderShapeList({ shapes, selectedColliderShapeId, onSelectColliderShape, onUpdateLevel, lvlId }) {
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const selectedRef = useRef(null);

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedColliderShapeId]);

  const commitName = (shapeId) => {
    const trimmed = editingName.trim();
    onUpdateLevel(lvlId, {
      colliderShapes: shapes.map(s => s.id === shapeId ? { ...s, name: trimmed || undefined } : s),
    });
    setEditingId(null);
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 4, letterSpacing: 1 }}>COLLISION LINES</div>
      {shapes.map((shape, si) => {
        const isSelected = shape.id === selectedColliderShapeId;
        const displayName = shape.name || `Line ${si + 1}`;
        const nameColor = shape.oneWay ? 'rgba(100,220,100,0.95)' : 'rgba(255,165,0,0.9)';
        return (
          <div
            key={shape.id || si}
            ref={isSelected ? selectedRef : null}
            onClick={() => onSelectColliderShape(shape.id)}
            style={{
              display: 'flex', flexDirection: 'column', gap: 3,
              marginBottom: 4, padding: '4px 6px',
              border: `1px solid ${isSelected ? (shape.oneWay ? 'rgba(100,220,100,0.5)' : 'rgba(255,165,0,0.5)') : 'rgba(255,255,255,0.07)'}`,
              borderRadius: 2, cursor: 'pointer',
              background: isSelected ? 'rgba(255,255,255,0.04)' : 'transparent',
            }}
          >
            {/* Name row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {editingId === shape.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  onBlur={() => commitName(shape.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitName(shape.id);
                    if (e.key === 'Escape') setEditingId(null);
                    e.stopPropagation();
                  }}
                  onClick={e => e.stopPropagation()}
                  style={{
                    flex: 1, fontFamily: 'monospace', fontSize: 10, padding: '1px 4px',
                    background: 'var(--bg)', border: `1px solid ${nameColor}`,
                    color: nameColor, outline: 'none',
                  }}
                />
              ) : (
                <span
                  onDoubleClick={e => { e.stopPropagation(); setEditingId(shape.id); setEditingName(shape.name || ''); }}
                  title="Double-click to rename"
                  style={{ flex: 1, fontSize: 10, fontFamily: 'monospace', color: nameColor, userSelect: 'none' }}
                >
                  {shape.oneWay ? '⬆ ' : ''}{displayName}
                  <span style={{ fontSize: 8, color: 'var(--text-dim)', marginLeft: 4 }}>· {shape.points?.length || 0} pts</span>
                </span>
              )}
              <button
                style={{ fontFamily: 'monospace', fontSize: 10, padding: '1px 5px', cursor: 'pointer',
                  border: '1px solid var(--border)', background: 'transparent', color: '#ff6666', borderColor: '#ff6666', flexShrink: 0 }}
                onClick={e => { e.stopPropagation(); onUpdateLevel(lvlId, { colliderShapes: shapes.filter(s => s.id !== shape.id) }); }}
                title="Delete">×</button>
            </div>
            {/* One-way toggle */}
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 9, color: 'var(--text-dim)', userSelect: 'none' }}
              onClick={e => e.stopPropagation()}
            >
              <RetroCheck
                checked={!!shape.oneWay}
                onChange={() => onUpdateLevel(lvlId, { colliderShapes: shapes.map(s => s.id === shape.id ? { ...s, oneWay: !s.oneWay } : s) })}
              />
              ONE-WAY PLATFORM
            </label>
          </div>
        );
      })}
    </div>
  );
}

// ─── Mask shape list with selection and inline rename ─────────────────────────
function MaskShapeList({ shapes, selectedOcclusionShapeId, onSelectOcclusionShape, onUpdateLevel, lvlId }) {
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const selectedRef = useRef(null);

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedOcclusionShapeId]);

  const commitName = (shapeId) => {
    const trimmed = editingName.trim();
    onUpdateLevel(lvlId, {
      occlusionShapes: shapes.map(s => s.id === shapeId ? { ...s, name: trimmed || undefined } : s),
    });
    setEditingId(null);
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 4, letterSpacing: 1 }}>MASKS</div>
      {shapes.map((shape, si) => {
        const isSelected = shape.id === selectedOcclusionShapeId;
        const displayName = shape.name || `Mask ${si + 1}`;
        return (
          <div
            key={shape.id || si}
            ref={isSelected ? selectedRef : null}
            onClick={() => onSelectOcclusionShape(shape.id)}
            style={{
              display: 'flex', flexDirection: 'column', gap: 3,
              marginBottom: 4, padding: '4px 6px',
              border: `1px solid ${isSelected ? 'rgba(200,100,255,0.5)' : 'rgba(255,255,255,0.07)'}`,
              borderRadius: 2, cursor: 'pointer',
              background: isSelected ? 'rgba(200,100,255,0.06)' : 'transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {editingId === shape.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  onBlur={() => commitName(shape.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitName(shape.id);
                    if (e.key === 'Escape') setEditingId(null);
                    e.stopPropagation();
                  }}
                  onClick={e => e.stopPropagation()}
                  style={{
                    flex: 1, fontFamily: 'monospace', fontSize: 10, padding: '1px 4px',
                    background: 'var(--bg)', border: '1px solid rgba(200,100,255,0.7)',
                    color: 'rgba(200,100,255,0.9)', outline: 'none',
                  }}
                />
              ) : (
                <span
                  onDoubleClick={e => { e.stopPropagation(); setEditingId(shape.id); setEditingName(shape.name || ''); }}
                  title="Double-click to rename"
                  style={{ flex: 1, fontSize: 10, fontFamily: 'monospace', color: isSelected ? 'rgba(220,120,255,1)' : 'rgba(180,0,255,0.9)', userSelect: 'none' }}
                >
                  {displayName}
                  <span style={{ fontSize: 8, color: 'var(--text-dim)', marginLeft: 4 }}>· {shape.points?.length || 0} pts</span>
                </span>
              )}
              <button
                style={{ fontFamily: 'monospace', fontSize: 10, padding: '1px 5px', cursor: 'pointer',
                  border: '1px solid var(--border)', background: 'transparent', color: '#ff6666', borderColor: '#ff6666', flexShrink: 0 }}
                onClick={e => { e.stopPropagation(); onUpdateLevel(lvlId, { occlusionShapes: shapes.filter(s => s.id !== shape.id) }); }}
                title="Delete">×</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Inspector principal ──────────────────────────────────────────────────────
function Inspector({
  component, isRow, onUpdate, onDelete, onDuplicate,
  windows, database, screenLayout, onUpdateScreenLayout,
  selectedIds = [], themeColors = {}, activeScreen, screens, onUpdateScreen,
  overlays = [],
  viewMode = 'desktop',
  gameMode = false, selectedLevel = null, onUpdateLevel = () => {},
  selectedEntity = null, onUpdateEntity = () => {}, assets = null,
  paintBrush = null, onSetPaintBrush = () => {},
  onBuildGame = () => {},
  onAddBackgroundLayer = () => {}, onUpdateBackgroundLayer = () => {},
  onRemoveBackgroundLayer = () => {}, onMoveBackgroundLayer = () => {},
  selectedColliderShapeId = null, onSelectColliderShape = () => {},
  selectedOcclusionShapeId = null, onSelectOcclusionShape = () => {},
  tutorialHoverBindings = () => ({}),
}) {
  const selectedId = selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null;
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [iconPickerTarget, setIconPickerTarget] = useState(null);
  const [localProps, setLocalProps] = useState({});
  const [tabsText, setTabsText] = useState('');
  // Aspect lock for entity render size — UI preference, not persisted on
  // the entity. Default ON whenever an entity is selected so size edits
  // preserve the sprite's intrinsic aspect ratio by default.
  const [aspectLocked, setAspectLocked] = useState(true);
  const [expandedSlots, setExpandedSlots] = useState(() => new Set());
  const [expandedAttacks, setExpandedAttacks] = useState(() => new Set());
  const [expandedIdles, setExpandedIdles] = useState(() => new Set());
  const [buildLevelCount, setBuildLevelCount] = useState(3);
  useEffect(() => {
    if (component) {
      const layoutProps = isRow
        ? (component.layout || {})
        : (component.props?.layout || {});
      const mergedProps = { ...component.props, ...layoutProps };
      setLocalProps(mergedProps);
      
      if (component.type === 'Tabs') {
        setTabsText((mergedProps.tabs || []).map(t => t.label).join(', '));
      }
    }
  }, [component?.id, component?.props]);

  const commitChange = useCallback((field, value) => {
    if (selectedIds && selectedIds.length > 0) {
      selectedIds.forEach(id => onUpdate(id, { [field]: value }));
    }
  }, [selectedIds, onUpdate]);

  const soundOptions = [
    { value: '', label: 'None' },
    ...listAvailableSounds(assets).map(s => ({ value: s.id, label: s.builtin ? `Built-in · ${s.name}` : (s.name || 'Untitled sound') })),
  ];

  // Game-entity sound selector: shows both project-imported audio and built-in
  // sounds (which also have a real src path the runtime can play).
  // Searchable so long asset libraries are easy to navigate.
  // Game-entity sound selector: project audio first, then built-in sounds.
  // Both have a real src the runtime can play. Searchable for long libraries.
  const renderGameSoundSelector = (value, onChange) => {
    const projectSounds = (assets?.sounds || []).filter(s => !s.builtin);
    const builtins      = BUILTIN_MACHINE_SOUNDS;
    const opts = [
      { value: '', label: 'None' },
      ...projectSounds.map(s => ({ value: s.id, label: s.name || 'Untitled sound' })),
      ...builtins.map(s => ({ value: s.id, label: `Built-in · ${s.name}` })),
    ];
    return <Selector value={value || ''} onChange={onChange} options={opts} width="100%" searchable searchPlaceholder="Search sounds…" />;
  };

  const renderSoundSelector = (value, onChange, { allowDefault = false } = {}) => (
    <Selector
      value={value || ''}
      onChange={onChange}
      options={[
        ...(allowDefault ? [{ value: '', label: 'Use global default' }, { value: '__none__', label: 'No sound' }] : []),
        ...soundOptions,
      ]}
      width="100%"
    />
  );

  const updateActiveSoundSettings = (patch) => {
    if (!activeScreen) return;
    const current = getScreenSoundSettings(activeScreen);
    const next = {
      ...current,
      ...patch,
      defaults: {
        ...(current.defaults || DEFAULT_INTERACTION_SOUNDS.defaults),
        ...(patch.defaults || {}),
      },
    };
    if (activeScreen.kind === 'world') {
      const ws = activeScreen.worldSettings || {};
      onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, interactionSounds: next } });
    } else {
      const settings = activeScreen.settings || {};
      onUpdateScreen(activeScreen.id, { settings: { ...settings, interactionSounds: next } });
    }
  };

  const renderGlobalSoundSettings = () => {
    if (!activeScreen) return null;
    const cfg = getScreenSoundSettings(activeScreen);
    return (
      <>
        <div className="property-divider" />
        <div className="al-section-title">INTERACTION SOUND</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <RetroCheckbox
            checked={cfg.enabled !== false}
            onChange={v => updateActiveSoundSettings({ enabled: v })}
          />
          <span style={{ fontSize: 11, color: 'var(--text)' }}>Sound enabled</span>
        </div>
        <div className="property-group">
          <label>VOLUME (%)</label>
          <NumericInput
            min={0}
            max={100}
            value={Math.round((cfg.volume ?? 0.7) * 100)}
            onCommit={n => updateActiveSoundSettings({ volume: Math.max(0, Math.min(1, (Number(n) || 0) / 100)) })}
          />
        </div>
        {SOUND_ACTIONS.map(a => (
          <div className="property-group" key={a.key}>
            <label>{a.label.toUpperCase()} DEFAULT</label>
            {renderSoundSelector(cfg.defaults?.[a.key] || '', v => updateActiveSoundSettings({ defaults: { [a.key]: v } }))}
          </div>
        ))}
        {!(assets?.sounds || []).length && (
          <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.5, marginTop: 4 }}>
            Built-in machine sounds are available. Import audio in Assets → Audio to add project-specific sounds.
          </div>
        )}
      </>
    );
  };

  const renderComponentSoundSettings = (actions = ['hover', 'click']) => {
    const current = localProps.soundActions || {};
    return (
      <>
        <div className="property-divider" />
        <div className="al-section-title">SOUND OVERRIDES</div>
        {actions.map(action => {
          const label = SOUND_ACTIONS.find(a => a.key === action)?.label || action;
          return (
            <div className="property-group" key={action}>
              <label>{label.toUpperCase()}</label>
              {renderSoundSelector(current[action] || '', v => updateAndCommit('soundActions', { ...current, [action]: v }), { allowDefault: true })}
            </div>
          );
        })}
      </>
    );
  };

  // ── GameEntity Inspector branch ─────────────────────────────────────────
  // Active when a placed entity is selected on the LevelCanvas.
  if (gameMode && selectedEntity) {
    const ent = selectedEntity;
    const sprites = assets?.sprites || [];
    // Resolve the "primary" sheet for aspect-lock — use the defaultAnimation
    // slot, or the first slot, or the legacy spriteSheetAssetId.
    const defaultSlot = (ent.animations || []).find(a => a.name === ent.defaultAnimation) || (ent.animations || [])[0];
    const defaultSheet = sprites.find(s => s.id === (defaultSlot?.spriteSheetId || ent.spriteSheetAssetId)) || null;
    return (
      <div className="inspector">
        <h3>[INSPECTOR]</h3>
        <div style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: 10, fontSize: 11 }}>
          [ {ent.name || ent.type} · {ent.role} ]
        </div>
        <div className="property-divider" style={{ marginTop: 15 }} />

        <div className="al-section-title">IDENTITY</div>
        <div className="property-group">
          <label>NAME</label>
          <input type="text" value={ent.name || ''}
            onChange={e => onUpdateEntity(ent.id, { name: e.target.value })} />
        </div>
        <div className="property-group">
          <label>ROLE</label>
          <Selector value={ent.role || 'prop'} onChange={v => onUpdateEntity(ent.id, { role: v })} options={[{value:'playerMain',label:'Player (main)'},{value:'player2',label:'Player 2'},{value:'player3',label:'Player 3'},{value:'player4',label:'Player 4'},{value:'enemy',label:'Enemy'},{value:'tower',label:'Tower (Tower Defense)'},{value:'collectible',label:'Collectible (coin, gem, item…)'},{value:'powerup-grow',label:'Powerup — Grow (8s, double size)'},{value:'powerup-star',label:'Powerup — Star (10s, invincible)'},{value:'powerup-fire',label:'Powerup — Fire (15s, shoot)'},{value:'npc',label:'NPC'},{value:'interactive',label:'Interactive'},{value:'teleporter',label:'Teleporter (sends player to a level)'},{value:'spawnPoint',label:'Spawn Point'},{value:'particleEmitter',label:'Particle Emitter'},{value:'soundEmitter',label:'Sound Emitter'},{value:'prop',label:'Prop'}]} width="100%" />
        </div>
        {ent.role === 'particleEmitter' && (
          <div className="property-group" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
            <label>PARTICLE IMAGE</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ cursor: 'pointer' }}>
                <span className="small-btn" style={{ padding: '2px 8px', fontSize: 9 }}>
                  {ent.particleImageUrl ? '⟳ Replace' : '↑ Upload image'}
                </span>
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const { url } = await uploadAsset(file, 'image');
                      onUpdateEntity(ent.id, { particleImageUrl: url });
                    } catch {
                      const reader = new FileReader();
                      reader.onload = ev => onUpdateEntity(ent.id, { particleImageUrl: ev.target.result });
                      reader.readAsDataURL(file);
                    }
                  }}
                />
              </label>
              {ent.particleImageUrl && (
                <>
                  <img src={ent.particleImageUrl} alt="" style={{ width: 32, height: 32, objectFit: 'contain', border: '1px solid var(--border)', background: '#111' }} />
                  <button className="small-btn" style={{ color: '#ff5566', borderColor: '#ff5566' }}
                    onClick={() => onUpdateEntity(ent.id, { particleImageUrl: null })}>clear</button>
                </>
              )}
            </div>
          </div>
        )}
        {(ent.role === 'enemy') && (
          <div className="property-group">
            <label>ENEMY TYPE</label>
            <Selector value={ent.enemyType || 'regular'} onChange={v => onUpdateEntity(ent.id, { enemyType: v })} options={[{value:'regular',label:'Regular'},{value:'elite',label:'Elite'},{value:'miniboss',label:'Mini-boss'},{value:'boss',label:'Boss'}]} width="100%" />
          </div>
        )}
        {ent.role === 'enemy' && selectedLevel?.runnerMode && (selectedLevel?.runnerLanes ?? 1) > 1 && (
          <div className="property-group">
            <label>RUNNER LANE</label>
            <Selector
              value={String(ent.runnerLane ?? 'any')}
              onChange={v => onUpdateEntity(ent.id, { runnerLane: v === 'any' ? 'any' : parseInt(v, 10) })}
              options={[
                { value: 'any', label: 'Any (random on recycle)' },
                ...Array.from({ length: selectedLevel.runnerLanes }, (_, i) => ({ value: String(i), label: `Lane ${i}${i === 0 ? ' (ground)' : ''}` })),
              ]}
              width="100%"
            />
          </div>
        )}
        {(ent.role === 'tower') && (<>
          <div className="al-section-title">TOWER STATS</div>
          <div className="property-group">
            <label>RANGE (px)</label>
            <NumericInput value={ent.stats?.range ?? 120} onChange={v => onUpdateEntity(ent.id, { stats: { ...(ent.stats || {}), range: v } })} min={40} max={600} step={10} />
          </div>
          <div className="property-group">
            <label>DAMAGE</label>
            <NumericInput value={ent.stats?.damage ?? 20} onChange={v => onUpdateEntity(ent.id, { stats: { ...(ent.stats || {}), damage: v } })} min={1} max={500} step={5} />
          </div>
          <div className="property-group">
            <label>FIRE RATE (shots/s)</label>
            <NumericInput value={ent.stats?.fireRate ?? 1} onChange={v => onUpdateEntity(ent.id, { stats: { ...(ent.stats || {}), fireRate: v } })} min={0.1} max={10} step={0.1} />
          </div>
        </>)}

        <div className="property-divider" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div className="al-section-title" style={{ marginBottom: 0 }}>ANIMATIONS</div>
          <button
            type="button"
            className="small-btn"
            onClick={() => {
              const slot = { id: mkId(), name: 'new_anim', spriteSheetId: null, animName: null };
              onUpdateEntity(ent.id, { animations: [...(ent.animations || []), slot] });
            }}
            style={{ fontSize: 9 }}
          >+ Add</button>
        </div>
        {ent.spriteSheetAssetId && !(ent.animations?.length) && (
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4, display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Legacy sprite set —</span>
            <button
              type="button"
              className="small-btn"
              style={{ fontSize: 9 }}
              onClick={() => {
                const legacySheet = sprites.find(s => s.id === ent.spriteSheetAssetId);
                const slots = (legacySheet?.animations || []).map(a => ({ id: mkId(), name: a.name, spriteSheetId: ent.spriteSheetAssetId, animName: a.name }));
                onUpdateEntity(ent.id, {
                  animations: slots.length ? slots : [{ id: mkId(), name: 'idle', spriteSheetId: ent.spriteSheetAssetId, animName: null }],
                  spriteSheetAssetId: null,
                });
              }}
            >convert to slots</button>
          </div>
        )}
        {!(ent.animations?.length) && !ent.spriteSheetAssetId && (
          <div style={{ fontSize: 10, color: 'var(--text-dim)', padding: '4px 0' }}>
            No animations — click + Add to assign sprite animations to this entity.
          </div>
        )}
        {/* Accordion: each slot collapses to a single header row; click to expand */}
        {(ent.animations || []).map(slot => {
          const slotSheet = sprites.find(s => s.id === slot.spriteSheetId) || null;
          const slotAnims = slotSheet?.animations || [];
          const nativeDir = slot.nativeDir || 'right';
          const hasOverride = slot.renderH != null || slot.spriteOffsetY != null;
          const isOpen = expandedSlots.has(slot.id);
          const isDefault = ent.defaultAnimation === slot.name;
          const toggleSlot = () => setExpandedSlots(prev => {
            const next = new Set(prev);
            if (next.has(slot.id)) next.delete(slot.id); else next.add(slot.id);
            return next;
          });
          const updateSlot = (patch) => {
            const updated = (ent.animations || []).map(a => a.id === slot.id ? { ...a, ...patch } : a);
            onUpdateEntity(ent.id, { animations: updated });
          };
          const isMissingSheet = !!(slot.spriteSheetId && !slotSheet);
          const summary = isMissingSheet
            ? '⚠ missing sheet'
            : (slotSheet ? `${slotSheet.name}${slot.animName ? ' · ' + slot.animName : ''}` : 'no sheet');
          const effectivelyOpen = isOpen || isMissingSheet;
          return (
            <div key={slot.id} style={{ marginBottom: 2, border: `1px solid ${isMissingSheet ? '#ff5566' : 'var(--border)'}`, background: effectivelyOpen ? 'rgba(0,0,0,0.25)' : 'transparent' }}>
              {/* Header — click to toggle */}
              <div
                onClick={toggleSlot}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 6px', cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <span style={{ fontSize: 10, color: 'var(--text-dim)', flex: '0 0 auto' }}>{effectivelyOpen ? '▼' : '▶'}</span>
                <span style={{ fontSize: 11, color: isDefault ? 'var(--accent)' : 'var(--text)', fontWeight: isDefault ? 'bold' : 'normal', flex: '0 0 auto', minWidth: 60 }}>
                  {slot.name || '—'}
                </span>
                <span style={{ fontSize: 9, color: isMissingSheet ? '#ff5566' : 'var(--text-dim)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {summary}
                </span>
                {isDefault && <span style={{ fontSize: 9, color: 'var(--accent)', flex: '0 0 auto' }} title="This is the default (idle) animation">★</span>}
                {hasOverride && <span style={{ fontSize: 9, color: 'var(--accent)', flex: '0 0 auto' }} title="Has size overrides">⚙</span>}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onUpdateEntity(ent.id, { animations: (ent.animations || []).filter(a => a.id !== slot.id) }); }}
                  style={{ background: 'transparent', border: 'none', color: '#ff5566', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1, flex: '0 0 auto' }}
                  title="Remove animation slot"
                >×</button>
              </div>
              {/* Expanded body */}
              {effectivelyOpen && (
                <div style={{ padding: '4px 8px 8px 8px', borderTop: `1px solid ${isMissingSheet ? '#ff5566' : 'var(--border)'}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="property-group" style={{ margin: 0 }}>
                    <label>NAME</label>
                    <input
                      type="text"
                      value={slot.name || ''}
                      placeholder="local name"
                      onChange={e => updateSlot({ name: e.target.value })}
                      style={{ fontSize: 10 }}
                    />
                  </div>
                  <div className="property-group" style={{ margin: 0 }}>
                    <label>SHEET</label>
                    <Selector value={slot.spriteSheetId || ''} onChange={v => updateSlot({ spriteSheetId: v || null, animName: null })} options={[{value:'',label:'— none —'}, ...sprites.map(s => ({value:s.id,label:s.name}))]} width="100%" />
                  </div>
                  <div className="property-group" style={{ margin: 0 }}>
                    <label>ANIMATION</label>
                    <Selector value={slot.animName || ''} onChange={v => updateSlot({ animName: v || null })} options={[{value:'',label:'— none —'}, ...slotAnims.map(a => ({value:a.name,label:a.name}))]} width="100%" containerStyle={!slotSheet ? {opacity:0.5,pointerEvents:'none'} : undefined} />
                  </div>
                  <div className="property-group" style={{ margin: 0 }}>
                    <label title="Which direction the sprite faces in the source sheet">FACING IN SHEET</label>
                    <button
                      type="button"
                      onClick={() => updateSlot({ nativeDir: nativeDir === 'right' ? 'left' : 'right' })}
                      style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, padding: '2px 8px', borderRadius: 2 }}
                      title="Click to toggle native direction"
                    >{nativeDir === 'right' ? '▶ right' : '◀ left'}</button>
                  </div>
                  <SlotOverlayPreview entity={ent} slot={slot} assets={assets} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 2, paddingTop: 4, borderTop: '1px dashed rgba(255,255,255,0.08)' }}>
                    <div className="property-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: 9 }} title="Override render height for this animation only. Empty = use entity RENDER H.">H OVERRIDE</label>
                      <NullNumInput
                        value={slot.renderH ?? null}
                        placeholder={`${ent.renderSize?.height ?? 64}`}
                        onCommit={n => updateSlot({ renderH: n })}
                        style={{ fontSize: 10, padding: '1px 4px' }}
                      />
                    </div>
                    <div className="property-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: 9 }} title="Override foot offset for this animation only. Empty = use entity FOOT OFFSET.">FOOT OFF</label>
                      <NullNumInput
                        value={slot.spriteOffsetY ?? null}
                        placeholder={`${ent.spriteOffsetY ?? 0}`}
                        onCommit={n => updateSlot({ spriteOffsetY: n })}
                        style={{ fontSize: 10, padding: '1px 4px' }}
                      />
                    </div>
                  </div>
                  {hasOverride && (
                    <button
                      type="button"
                      className="small-btn"
                      onClick={() => updateSlot({ renderH: null, spriteOffsetY: null })}
                      style={{ fontSize: 9, color: 'var(--text-dim)', alignSelf: 'flex-start' }}
                    >clear overrides</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div className="property-group" style={{ marginTop: 6 }}>
          <label title="The animation played when the entity is at rest — no movement or attack input. If you have multiple idle variations, set the primary one here.">DEFAULT ANIM (idle)</label>
          <Selector value={ent.defaultAnimation || ''} onChange={v => onUpdateEntity(ent.id, { defaultAnimation: v || null })} options={[{value:'',label:'— none —'}, ...(ent.animations || []).map(a => ({value:a.name,label:a.name}))]} width="100%" />
        </div>
        <div className="property-group">
          <label>FACING</label>
          <Selector value={ent.facing || 'right'} onChange={v => onUpdateEntity(ent.id, { facing: v })} options={[{value:'right',label:'right'},{value:'left',label:'left'}]} width="100%" />
        </div>

        <div className="property-divider" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="al-section-title" style={{ marginBottom: 0 }}>PLACEMENT</div>
          {defaultSheet?.frame?.width && defaultSheet?.frame?.height && (
            <button
              type="button"
              className="small-btn"
              onClick={() => onUpdateEntity(ent.id, {
                renderSize: { width: defaultSheet.frame.width, height: defaultSheet.frame.height }
              })}
              title={`Reset render size to sprite frame (${defaultSheet.frame.width}×${defaultSheet.frame.height})`}
              style={{ fontSize: 9 }}
            >↺ fit aspect</button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <div className="property-group">
            <label>X (px)</label>
            <NumericInput value={ent.position?.x ?? 0}
              onCommit={n => onUpdateEntity(ent.id, { position: { ...(ent.position || {}), x: n } })} />
          </div>
          <div className="property-group">
            <label>Y (px)</label>
            <NumericInput value={ent.position?.y ?? 0}
              onCommit={n => onUpdateEntity(ent.id, { position: { ...(ent.position || {}), y: n } })} />
          </div>
        </div>
        {(() => {
          const fw = defaultSheet?.frame?.width;
          const fh = defaultSheet?.frame?.height;
          const canLock = !!(fw && fh);
          const aspect = canLock ? fw / fh : 1;
          const effectiveLock = aspectLocked && canLock;
          const updateRenderW = (newW) => {
            const w = Math.max(1, newW);
            const patch = { renderSize: { ...(ent.renderSize || {}), width: w } };
            if (effectiveLock) patch.renderSize.height = Math.max(1, Math.round(w / aspect));
            onUpdateEntity(ent.id, patch);
          };
          const updateRenderH = (newH) => {
            const h = Math.max(1, newH);
            const patch = { renderSize: { ...(ent.renderSize || {}), height: h } };
            if (effectiveLock) patch.renderSize.width = Math.max(1, Math.round(h * aspect));
            onUpdateEntity(ent.id, patch);
          };
          const iconUrl = `/img/icons/${effectiveLock ? 'imgi_43_lock' : 'imgi_13_unlock'}.svg`;
          return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 28px 1fr', gap: 4, alignItems: 'end' }}>
              <div className="property-group">
                <label>RENDER W (px)</label>
                <NumericInput min={1} value={ent.renderSize?.width ?? 64}
                  onCommit={updateRenderW} />
              </div>
              {/* Wrap the lock toggle in a property-group with an invisible
                  label so it occupies the same vertical structure as the
                  W/H inputs and the icon centers on the input row. */}
              <div className="property-group" style={{ alignItems: 'stretch' }}>
                <label style={{ visibility: 'hidden' }}>L</label>
                <button
                  type="button"
                  onClick={() => canLock && setAspectLocked(l => !l)}
                  disabled={!canLock}
                  title={!canLock ? 'No sprite frame to lock against' : (effectiveLock ? `Aspect locked to sprite (${fw}:${fh}) — click to unlock` : 'Aspect free — click to lock to sprite')}
                  style={{
                    padding: 0,
                    background: effectiveLock ? 'var(--accent)' : 'transparent',
                    color: effectiveLock ? 'var(--bg)' : 'var(--text-dim)',
                    border: '1px solid var(--border)',
                    cursor: canLock ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    minHeight: 22,
                  }}
                >
                  <div style={{
                    width: 14, height: 14,
                    backgroundColor: 'currentColor',
                    maskImage: `url(${iconUrl})`,
                    WebkitMaskImage: `url(${iconUrl})`,
                    maskSize: 'contain',
                    WebkitMaskSize: 'contain',
                    maskRepeat: 'no-repeat',
                    WebkitMaskRepeat: 'no-repeat',
                    maskPosition: 'center',
                    WebkitMaskPosition: 'center',
                  }} />
                </button>
              </div>
              <div className="property-group">
                <label>RENDER H (px)</label>
                <NumericInput min={1} value={ent.renderSize?.height ?? 64}
                  onCommit={updateRenderH} />
              </div>
            </div>
          );
        })()}
        <div className="property-group">
          <label title="Pixels to shift the sprite UP relative to the hitbox bottom. Use when transparent space at the bottom of the frame makes the character appear to float.">FOOT OFFSET (px)</label>
          <NumericInput value={ent.spriteOffsetY ?? 0}
            onCommit={n => onUpdateEntity(ent.id, { spriteOffsetY: n })} />
        </div>

        <div className="property-divider" />
        <div className="al-section-title">STATS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
          <div className="property-group">
            <label>HP</label>
            <NumericInput min={0} value={ent.stats?.hp ?? 100}
              onCommit={n => onUpdateEntity(ent.id, { stats: { ...(ent.stats || {}), hp: n } })} />
          </div>
          <div className="property-group">
            <label>SPEED</label>
            <NumericInput min={0} value={ent.stats?.speed ?? 100}
              onCommit={n => onUpdateEntity(ent.id, { stats: { ...(ent.stats || {}), speed: n } })} />
          </div>
          <div className="property-group">
            <label title="Speed when Shift is held (run). Defaults to 1.8× SPEED if not set.">RUN SPEED</label>
            <NumericInput min={0} value={ent.stats?.runSpeed ?? Math.round((ent.stats?.speed ?? 100) * 1.8)}
              onCommit={n => onUpdateEntity(ent.id, { stats: { ...(ent.stats || {}), runSpeed: n } })} />
          </div>
          <div className="property-group">
            <label>DAMAGE</label>
            <NumericInput min={0} value={ent.stats?.damage ?? 10}
              onCommit={n => onUpdateEntity(ent.id, { stats: { ...(ent.stats || {}), damage: n } })} />
          </div>
          <div className="property-group">
            <label title="Jump height in tiles (platformer only)">JUMP (tiles)</label>
            <NumericInput min={1} value={ent.stats?.jumpHeight ?? 3}
              onCommit={n => onUpdateEntity(ent.id, { stats: { ...(ent.stats || {}), jumpHeight: n } })} />
          </div>
          <div className="property-group">
            <label title="Flat damage reduction applied to every hit this entity receives. High values make bosses/tanks absorb more damage.">DEFENSE</label>
            <NumericInput min={0} value={ent.stats?.defense ?? 0}
              onCommit={n => onUpdateEntity(ent.id, { stats: { ...(ent.stats || {}), defense: n } })} />
          </div>
        </div>

        <div className="property-divider" />
        <div className="al-section-title">BEHAVIOR</div>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 6 }}>
          Controls: ←→/WASD move · Space jump · Z attack · Shift run · E interact
        </div>
        <div className="property-group">
          <label title="Animation name to play while airborne (Space jump, platformer only). Leave blank to auto-detect (jump/leap/air/fall).">JUMP ANIM</label>
          <Selector value={ent.behavior?.jumpAnim || ''} onChange={v => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), jumpAnim: v || null } })} options={[{value:'',label:'— auto-detect —'}, ...(ent.animations || []).map(a => ({value:a.name,label:a.name}))]} width="100%" />
        </div>
        <div className="property-group">
          <label title="Animation name to play when Shift + move. Leave blank to auto-detect (run).">RUN ANIM</label>
          <Selector value={ent.behavior?.runAnim || ''} onChange={v => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), runAnim: v || null } })} options={[{value:'',label:'— auto-detect —'}, ...(ent.animations || []).map(a => ({value:a.name,label:a.name}))]} width="100%" />
        </div>

        <div className="property-divider" style={{ margin: '8px 0 6px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div className="al-section-title" style={{ marginBottom: 0 }}>ATTACKS</div>
          <button
            type="button" className="small-btn"
            onClick={() => {
              const atk = { id: mkId(), name: 'Attack', anim: null, damage: 25, duration: 400, comboNext: null, comboWindow: 500 };
              onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), attacks: [...(ent.behavior?.attacks || []), atk] } });
              setExpandedAttacks(prev => new Set([...prev, atk.id]));
            }}
            style={{ fontSize: 9 }}
          >+ Add</button>
        </div>
        {!(ent.behavior?.attacks?.length) && (
          <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 6 }}>
            No attacks — Z uses auto-detect (attack/slash/punch/combo).
          </div>
        )}
        {(ent.behavior?.attacks || []).map(atk => (
          <AttackSlot
            key={atk.id}
            attack={atk}
            allAttacks={ent.behavior?.attacks || []}
            animSlots={ent.animations || []}
            expanded={expandedAttacks.has(atk.id)}
            onToggle={() => setExpandedAttacks(prev => { const n = new Set(prev); n.has(atk.id) ? n.delete(atk.id) : n.add(atk.id); return n; })}
            onChange={patch => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), attacks: (ent.behavior?.attacks || []).map(a => a.id === atk.id ? { ...a, ...patch } : a) } })}
            onRemove={() => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), attacks: (ent.behavior?.attacks || []).filter(a => a.id !== atk.id) } })}
          />
        ))}

        <div className="property-divider" style={{ margin: '8px 0 6px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div className="al-section-title" style={{ marginBottom: 0 }}>IDLES</div>
          <button
            type="button" className="small-btn"
            onClick={() => {
              const idle = { id: mkId(), name: 'Idle', anim: null, minTime: 2, maxTime: 6 };
              onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), idles: [...(ent.behavior?.idles || []), idle] } });
              setExpandedIdles(prev => new Set([...prev, idle.id]));
            }}
            style={{ fontSize: 9 }}
          >+ Add</button>
        </div>
        {!(ent.behavior?.idles?.length) && (
          <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 6 }}>
            No idles — uses DEFAULT ANIM only.
          </div>
        )}
        {(ent.behavior?.idles || []).map(idle => (
          <IdleSlot
            key={idle.id}
            idle={idle}
            animSlots={ent.animations || []}
            expanded={expandedIdles.has(idle.id)}
            onToggle={() => setExpandedIdles(prev => { const n = new Set(prev); n.has(idle.id) ? n.delete(idle.id) : n.add(idle.id); return n; })}
            onChange={patch => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), idles: (ent.behavior?.idles || []).map(i => i.id === idle.id ? { ...i, ...patch } : i) } })}
            onRemove={() => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), idles: (ent.behavior?.idles || []).filter(i => i.id !== idle.id) } })}
          />
        ))}

        <div className="property-divider" style={{ margin: '8px 0 6px' }} />
        <div className="al-section-title" style={{ marginBottom: 4 }}>HIT REACTIONS</div>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 6 }}>
          Animations played when this entity receives damage. Priority: heavy (≥ threshold) → normal.
        </div>
        <div className="property-group">
          <label title="Played on any hit. Auto-detect: hurt / pain / flinch / damage.">HIT ANIM (normal)</label>
          <Selector value={ent.behavior?.hitAnim || ''} onChange={v => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), hitAnim: v || null } })} options={[{value:'',label:'— auto-detect —'}, ...(ent.animations || []).map(a => ({value:a.name,label:a.name}))]} width="100%" />
        </div>
        <div className="property-group">
          <label title="Played when damage ≥ HIT THRESHOLD. Auto-detect: heavy / stagger / knockback / ko.">HIT ANIM (heavy)</label>
          <Selector value={ent.behavior?.heavyHitAnim || ''} onChange={v => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), heavyHitAnim: v || null } })} options={[{value:'',label:'— none —'}, ...(ent.animations || []).map(a => ({value:a.name,label:a.name}))]} width="100%" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <div className="property-group" style={{ margin: 0 }}>
            <label title="If the raw incoming hit power reaches this value, the heavy hit animation plays instead of the normal one. This controls ANIMATION only — actual damage reduction is set by DEFENSE in Stats.">ANIM THRESHOLD</label>
            <NumericInput min={1} value={ent.behavior?.hitThreshold ?? 30}
              onCommit={n => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), hitThreshold: n } })} />
          </div>
          <div className="property-group" style={{ margin: 0 }}>
            <label title="How long the hit animation plays before returning to normal (milliseconds).">DURATION (ms)</label>
            <NumericInput min={50} value={ent.behavior?.hitDuration ?? 500}
              onCommit={n => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), hitDuration: n } })} />
          </div>
        </div>

        <div className="property-divider" style={{ margin: '8px 0 6px' }} />
        <div className="al-section-title" style={{ marginBottom: 4 }}>DEATH</div>
        <div className="property-group">
          <label title="Animation to play when HP reaches 0. Auto-detect: death / die / dead.">DEATH ANIM</label>
          <Selector value={ent.behavior?.deathAnim || ''} onChange={v => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), deathAnim: v || null } })} options={[{value:'',label:'— auto-detect —'}, ...(ent.animations || []).map(a => ({value:a.name,label:a.name}))]} width="100%" />
        </div>
        <div className="property-group">
          <label title="Milliseconds after the death animation starts before the entity is removed from the scene. Leave empty to keep the corpse visible indefinitely.">VANISH (ms)</label>
          <NullNumInput
            value={ent.behavior?.vanishDelay ?? null}
            placeholder="never"
            onCommit={n => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), vanishDelay: n } })}
            style={{ fontFamily: 'monospace', fontSize: 10, width: '100%' }}
          />
        </div>

        {ent.role === 'enemy' && (<>
          <div className="property-divider" style={{ margin: '8px 0 6px' }} />
          <div className="al-section-title" style={{ marginBottom: 4 }}>ENEMY AI</div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 6 }}>
            Patrol → Chase → Attack state machine. Ranges in tiles; attack range in pixels.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <div className="property-group" style={{ margin: 0 }}>
              <label title="How far (in tiles) the enemy can see the player and start chasing.">DETECT (tiles)</label>
              <NumericInput min={1} value={ent.behavior?.detectionRange ?? 8}
                onCommit={n => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), detectionRange: n } })} />
            </div>
            <div className="property-group" style={{ margin: 0 }}>
              <label title="Distance in pixels at which the enemy stops and attacks.">ATTACK (px)</label>
              <NumericInput min={1} value={ent.behavior?.attackRange ?? 48}
                onCommit={n => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), attackRange: n } })} />
            </div>
            <div className="property-group" style={{ margin: 0 }}>
              <label title="How many tiles from spawn the enemy patrols before turning around.">PATROL (tiles)</label>
              <NumericInput min={1} value={ent.behavior?.patrolRange ?? 3}
                onCommit={n => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), patrolRange: n } })} />
            </div>
            <div className="property-group" style={{ margin: 0 }}>
              <label title="Milliseconds between attacks (contact damage cooldown).">ATK CD (ms)</label>
              <NumericInput min={100} value={ent.behavior?.attackCooldown ?? 1200}
                onCommit={n => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), attackCooldown: n } })} />
            </div>
          </div>
        </>)}

        {/* ── Events section ── shown per role ───────────────────────────── */}
        {(() => {
          const role = ent.role || 'prop';
          const showDeath   = role === 'playerMain' || role === 'enemy';
          const showDamage  = role === 'playerMain' || role === 'enemy';
          const showCollect = role === 'collectible';
          if (!showDeath && !showDamage && !showCollect) return null;

          const ev = ent.events || {};
          const upEv = (patch) => onUpdateEntity(ent.id, { events: { ...ev, ...patch } });

          const DEATH_OPTS = [
            { value: 'lose-life',     label: 'Lose a life' },
            { value: 'game-over',     label: 'Game Over immediately' },
            { value: 'restart-level', label: 'Restart level' },
            { value: 'none',          label: 'None (do nothing)' },
          ];
          const DAMAGE_OPTS = [
            { value: 'flash-screen',  label: 'Flash screen red' },
            { value: 'none',          label: 'None' },
          ];
          const COLLECT_OPTS = [
            { value: 'add-score:100', label: '+100 score' },
            { value: 'add-score:50',  label: '+50 score' },
            { value: 'add-score:10',  label: '+10 score' },
            { value: 'add-score:1',   label: '+1 score' },
            { value: 'add-life',      label: '+1 life' },
            { value: 'add-coin',      label: '+1 coin' },
            { value: 'none',          label: 'None' },
          ];

          return (
            <>
              <div className="property-divider" style={{ margin: '8px 0 6px' }} />
              <div className="al-section-title" style={{ marginBottom: 4 }}>EVENTS</div>
              {showDeath && (
                <div className="property-group">
                  <label>ON DEATH</label>
                  <Selector
                    value={ev.onDeath || (role === 'playerMain' ? 'lose-life' : 'none')}
                    onChange={v => upEv({ onDeath: v })}
                    options={DEATH_OPTS}
                    width="100%"
                  />
                </div>
              )}
              {showDamage && (
                <div className="property-group">
                  <label>ON DAMAGE</label>
                  <Selector
                    value={ev.onDamage || 'flash-screen'}
                    onChange={v => upEv({ onDamage: v })}
                    options={DAMAGE_OPTS}
                    width="100%"
                  />
                </div>
              )}
              {showCollect && (
                <div className="property-group">
                  <label>ON COLLECT</label>
                  <Selector
                    value={ev.onCollect || 'add-score:100'}
                    onChange={v => upEv({ onCollect: v })}
                    options={COLLECT_OPTS}
                    width="100%"
                  />
                </div>
              )}
            </>
          );
        })()}

        {ent.role === 'collectible' && (() => {
          const snd = ent.behavior?.sounds || {};
          const upSnd = (patch) => onUpdateEntity(ent.id, { behavior: { ...(ent.behavior || {}), sounds: { ...snd, ...patch } } });
          return (
            <>
              <div className="property-divider" style={{ margin: '8px 0 6px' }} />
              <div className="al-section-title" style={{ marginBottom: 4 }}>SOUNDS</div>
              <div className="property-group">
                <label title="Loops while this collectible is on the field.">IDLE SOUND</label>
                {renderGameSoundSelector(snd.idle || '', v => upSnd({ idle: v || null }))}
              </div>
              <div className="property-group">
                <label title="Plays once when the player collects this item.">COLLECT SOUND</label>
                {renderGameSoundSelector(snd.collect || '', v => upSnd({ collect: v || null }))}
              </div>
            </>
          );
        })()}

        {ent.role === 'teleporter' && (() => {
          const beh = ent.behavior || {};
          const upBeh = (patch) => onUpdateEntity(ent.id, { behavior: { ...beh, ...patch } });
          const levelOptions = [
            { value: '', label: '— Select destination level —' },
            ...(screens || []).filter(s => s.kind === 'world').flatMap(w =>
              (w.levels || []).map(l => ({ value: l.id, label: `${w.name || 'World'} · ${l.name || 'Level'}` }))
            ),
          ];
          return (
            <>
              <div className="property-divider" style={{ margin: '8px 0 6px' }} />
              <div className="al-section-title" style={{ marginBottom: 4 }}>TELEPORTER</div>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 6 }}>
                Sends the player to another level when triggered.
              </div>
              <div className="property-group">
                <label title="Which level to load when the player triggers this teleporter.">DESTINATION</label>
                <Selector value={beh.targetLevelId || ''} onChange={v => upBeh({ targetLevelId: v || null })} options={levelOptions} width="100%" />
              </div>
              <div className="property-group">
                <label title="overlap: fires when player walks in. interact: fires when player presses E.">TRIGGER</label>
                <Selector
                  value={beh.triggerMode || 'overlap'}
                  onChange={v => upBeh({ triggerMode: v })}
                  options={[
                    { value: 'overlap', label: 'Walk in (overlap)' },
                    { value: 'interact', label: 'Press E (interact)' },
                  ]}
                  width="100%"
                />
              </div>
            </>
          );
        })()}
      </div>
    );
  }

  // ── Level Inspector branch ──────────────────────────────────────────────
  // Active when a level tab is selected and there is no component selection.
  if (gameMode && selectedLevel && selectedIds.length === 0) {
    const lvl = selectedLevel;
    const tm = lvl.tileMap || {};
    const patchTileMap = (patch) => onUpdateLevel(lvl.id, { tileMap: { ...tm, ...patch } });

    // Resize cols/rows while preserving painted content. Anchored at the
    // bottom-left (data row 0 = floor) so growing adds empty rows on top
    // and shrinking trims from the top — the user's existing world keeps
    // its position. Data is a flat row-major array of length cols*rows.
    const resizeTileMap = (newCols, newRows) => {
      const oldCols = tm.cols || 0;
      const oldRows = tm.rows || 0;
      if (newCols === oldCols && newRows === oldRows) return;
      const nextLayers = (tm.layers || []).map(layer => {
        const oldData = layer.data || [];
        const next = new Array(newCols * newRows).fill(0);
        const copyRows = Math.min(oldRows, newRows);
        const copyCols = Math.min(oldCols, newCols);
        for (let r = 0; r < copyRows; r++) {
          for (let c = 0; c < copyCols; c++) {
            next[r * newCols + c] = oldData[r * oldCols + c] | 0;
          }
        }
        return { ...layer, data: next };
      });
      onUpdateLevel(lvl.id, { tileMap: { ...tm, cols: newCols, rows: newRows, layers: nextLayers } });
    };
    return (
      <div className="inspector">
        <h3>[INSPECTOR]</h3>
        <div style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: 10, fontSize: 11 }}>
          [ Level: {lvl.name} ]
        </div>
        <div className="property-divider" style={{ marginTop: 15 }} />

        <div className="al-section-title">LEVEL</div>
        <div className="property-group">
          <label>NAME</label>
          <input type="text" value={lvl.name || ''}
            onChange={e => onUpdateLevel(lvl.id, { name: e.target.value })} />
        </div>
        <div className="property-group">
          <label>TYPE</label>
          <Selector value={lvl.levelType || 'hud-only'} onChange={v => onUpdateLevel(lvl.id, { levelType: v })} options={[{value:'hud-only',label:'HUD only (intro / menu / game over)'},{value:'game',label:'Game only (no HUD overlay)'},{value:'game+hud',label:'Game + HUD overlay'}]} width="100%" />
        </div>
        <div className="property-group">
          <label>VIEWPORT</label>
          <Selector value={lvl.viewport || 'custom'} onChange={v => onUpdateLevel(lvl.id, { viewport: v })} options={[{value:'custom',label:'Manual / no preset'},{value:'topdown',label:'Top-down'},{value:'platformer',label:'Platformer'},{value:'isometric',label:'Isometric'},{value:'board',label:'Board'}]} width="100%" />
        </div>
        {(() => {
          const presets = {
            platformer: { gravity: 800, label: 'Platformer', hint: 'gravity 800 · speed 180 · jump 3 tiles' },
            topdown:    { gravity: 0,   label: 'Top-down',   hint: 'no gravity · speed 150 · 4-directional' },
            isometric:  { gravity: 0,   label: 'Isometric',  hint: 'no gravity · speed 120 · 8-directional' },
            board:      { gravity: 0,   label: 'Board',      hint: 'no gravity · speed 100 · grid movement' },
          };
          const speeds = { platformer: 180, topdown: 150, isometric: 120, board: 100 };
          const vp = lvl.viewport || 'custom';
          const p = presets[vp];
          if (!p) return null;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <button
                type="button"
                className="small-btn"
                style={{ fontSize: 9 }}
                title={p.hint}
                onClick={() => {
                  onUpdateLevel(lvl.id, { gravity: p.gravity });
                  // Also patch all playerMain entities with recommended speed
                  // We don't have direct access here — leave a hint instead.
                }}
              >↺ apply {p.label} defaults</button>
              <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{p.hint}</span>
            </div>
          );
        })()}
        <div className="property-group">
          <label>GRAVITY</label>
          <NumericInput value={lvl.gravity ?? 0}
            onCommit={n => onUpdateLevel(lvl.id, { gravity: n })} />
        </div>
        <div className="property-group">
          <label>GRAVITY DIRECTION</label>
          <Selector
            value={lvl.gravityDir || 'down'}
            onChange={v => onUpdateLevel(lvl.id, { gravityDir: v })}
            options={[
              { value: 'down',  label: 'Down (standard platformer)' },
              { value: 'up',    label: 'Up (inverted / ceiling walk)' },
              { value: 'left',  label: 'Left (90° rotated)' },
              { value: 'right', label: 'Right (90° rotated)' },
              { value: 'none',  label: 'None (top-down / zero gravity)' },
            ]}
            width="100%"
          />
        </div>

        <div className="property-divider" />
        <div className="al-section-title">CAMERA / VIEWPORT</div>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 4 }}>
          Tiles visible at once. Smaller than the level → camera follows player.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <div className="property-group">
            <label>VIEWPORT W (tiles)</label>
            <NumericInput min={4} value={lvl.viewportCols ?? 20}
              onCommit={n => onUpdateLevel(lvl.id, { viewportCols: n })} />
          </div>
          <div className="property-group">
            <label>VIEWPORT H (tiles)</label>
            <NumericInput min={4} value={lvl.viewportRows ?? 14}
              onCommit={n => onUpdateLevel(lvl.id, { viewportRows: n })} />
          </div>
        </div>
        <div className="property-group">
          <label>CAMERA FOLLOWS</label>
          <Selector
            value={lvl.cameraAxis || 'both'}
            onChange={v => onUpdateLevel(lvl.id, { cameraAxis: v })}
            options={[
              { value: 'both',  label: 'Both axes (default)' },
              { value: 'x',     label: 'X only (classic side-scroller)' },
              { value: 'y',     label: 'Y only (vertical climber)' },
              { value: 'fixed', label: 'Fixed (single-screen game)' },
            ]}
            width="100%"
          />
        </div>

        <div className="property-divider" />
        <div className="al-section-title">ENDLESS RUNNER</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <RetroCheckbox
            checked={lvl.runnerMode || false}
            onChange={v => onUpdateLevel(lvl.id, { runnerMode: v, cameraAxis: v ? 'x' : (lvl.cameraAxis || 'both') })}
          />
          <span style={{ fontSize: 11, color: 'var(--text)' }}>Endless runner mode</span>
        </div>
        {lvl.runnerMode && (
          <div className="property-group">
            <label>BASE SPEED (px/s)</label>
            <NumericInput min={50} value={lvl.runnerBaseSpeed ?? 240}
              onCommit={n => onUpdateLevel(lvl.id, { runnerBaseSpeed: n })} />
          </div>
        )}
        {lvl.runnerMode && (
          <div className="property-group">
            <label>RUNNER LANES</label>
            <Selector
              value={String(lvl.runnerLanes ?? 1)}
              onChange={v => onUpdateLevel(lvl.id, { runnerLanes: parseInt(v, 10) })}
              options={[
                { value: '1', label: '1 — Classic (jump over)' },
                { value: '2', label: '2 — Two lanes' },
                { value: '3', label: '3 — Three lanes (Subway style)' },
                { value: '4', label: '4 — Four lanes' },
                { value: '5', label: '5 — Five lanes' },
              ]}
              width="100%"
            />
          </div>
        )}
        {lvl.runnerMode && (lvl.runnerLanes ?? 1) > 1 && (
          <div className="property-group">
            <label>LANE SPACING (px, 0 = auto)</label>
            <NumericInput min={0} value={lvl.runnerLaneSpacing ?? 0}
              onCommit={n => onUpdateLevel(lvl.id, { runnerLaneSpacing: n })} />
          </div>
        )}
        {lvl.runnerMode && (
          <div className="property-group">
            <label>WIN DISTANCE (tiles, 0 = infinite)</label>
            <NumericInput min={0} value={lvl.gameSettings?.winDistance ?? 0}
              onCommit={n => onUpdateLevel(lvl.id, { gameSettings: { ...(lvl.gameSettings || {}), winDistance: n } })} />
          </div>
        )}
        {lvl.runnerMode && (<>
          <div className="al-section-title" style={{ marginTop: 8 }}>SPEED RAMP</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <div className="property-group" style={{ margin: 0 }}>
              <label>RAMP RATE (%)</label>
              <NumericInput min={0} step={0.5} value={lvl.speedRampRate ?? 1}
                onCommit={n => onUpdateLevel(lvl.id, { speedRampRate: n })} />
            </div>
            <div className="property-group" style={{ margin: 0 }}>
              <label>INTERVAL (s)</label>
              <NumericInput min={1} value={lvl.speedRampInterval ?? 10}
                onCommit={n => onUpdateLevel(lvl.id, { speedRampInterval: n })} />
            </div>
          </div>
          <div className="property-group">
            <label>MAX SPEED (px/s, 0 = unlimited)</label>
            <NumericInput min={0} step={20} value={lvl.speedMax ?? 0}
              onCommit={n => onUpdateLevel(lvl.id, { speedMax: n })} />
          </div>
          <div className="al-section-title" style={{ marginTop: 8 }}>PLAYER ACTIONS</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <RetroCheckbox checked={lvl.playerCanShoot || false}
              onChange={v => onUpdateLevel(lvl.id, { playerCanShoot: v })} />
            <span style={{ fontSize: 11, color: 'var(--text)' }}>Can shoot (Z / attack)</span>
          </div>
          {lvl.playerCanShoot && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <div className="property-group" style={{ margin: 0 }}>
                <label>BULLET SPEED</label>
                <NumericInput min={100} step={50} value={lvl.playerBulletSpeed ?? 600}
                  onCommit={n => onUpdateLevel(lvl.id, { playerBulletSpeed: n })} />
              </div>
              <div className="property-group" style={{ margin: 0 }}>
                <label>DAMAGE</label>
                <NumericInput min={1} value={lvl.playerBulletDamage ?? 20}
                  onCommit={n => onUpdateLevel(lvl.id, { playerBulletDamage: n })} />
              </div>
              <div className="property-group" style={{ margin: 0 }}>
                <label>SIZE (px)</label>
                <NumericInput min={2} value={lvl.playerBulletSize ?? 5}
                  onCommit={n => onUpdateLevel(lvl.id, { playerBulletSize: n })} />
              </div>
              <div className="property-group" style={{ margin: 0 }}>
                <label>COLOR</label>
                <input type="color" value={lvl.playerBulletColor || '#fffa60'}
                  onChange={e => onUpdateLevel(lvl.id, { playerBulletColor: e.target.value })}
                  style={{ width: '100%', height: 28, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }} />
              </div>
            </div>
          )}
        </>)}

        {/* Game rules + Win/Lose conditions — shown for all game levels */}
        {(lvl.levelType === 'game' || lvl.levelType === 'game+hud') && (() => {
          const gs = lvl.gameSettings || {};
          const upGs = (patch) => onUpdateLevel(lvl.id, { gameSettings: { ...gs, ...patch } });
          const hasTimer = (gs.timerSeconds ?? 0) > 0;
          return (
            <>
              <div className="property-divider" />
              <div className="al-section-title">GAME RULES</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                <div className="property-group" style={{ margin: 0 }}>
                  <label title="Starting lives. 0 = infinite lives (no game over on death).">LIVES (0 = ∞)</label>
                  <NumericInput min={0} value={gs.lives ?? 3} onCommit={n => upGs({ lives: n })} />
                </div>
                <div className="property-group" style={{ margin: 0 }}>
                  <label title="Countdown timer in seconds. 0 = no timer.">TIMER (s, 0 = off)</label>
                  <NumericInput min={0} value={gs.timerSeconds ?? 0} onCommit={n => upGs({ timerSeconds: n })} />
                </div>
              </div>
              {hasTimer && (
                <div className="property-group">
                  <label title="What happens when the timer reaches 0.">TIMER ENDS →</label>
                  <Selector
                    value={gs.winOnTimerEnd ? 'win' : (gs.timerEndAction || 'lose-life')}
                    onChange={v => upGs(v === 'win' ? { winOnTimerEnd: true, timerEndAction: null } : { winOnTimerEnd: false, timerEndAction: v })}
                    options={[
                      { value: 'lose-life',     label: 'Lose a life (survival)' },
                      { value: 'game-over',     label: 'Game Over immediately' },
                      { value: 'win',           label: 'Win level (survive to the end)' },
                    ]}
                    width="100%"
                  />
                </div>
              )}

              <div className="property-divider" style={{ margin: '8px 0 6px' }} />
              <div className="al-section-title">WIN CONDITION</div>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 6 }}>
                Level completes when ANY active condition is met. Use a Teleporter entity to send the player to the next level manually.
              </div>

              <div className="property-group">
                <label title="Defeat all enemy entities on the level to win. Requires at least one enemy placed.">WIN: ALL ENEMIES DEFEATED</label>
                <RetroCheckbox
                  checked={gs.winAllEnemies || false}
                  onChange={v => upGs({ winAllEnemies: v })}
                />
              </div>
              <div className="property-group">
                <label title="Collect this many coins/items. 0 = disabled.">WIN: COLLECT (coins, 0 = off)</label>
                <NumericInput min={0} value={gs.winCoins ?? 0} onCommit={n => upGs({ winCoins: n })} />
              </div>
              <div className="property-group">
                <label title="Reach this score to win. 0 = disabled.">WIN: SCORE (0 = off)</label>
                <NumericInput min={0} value={gs.winScore ?? 0} onCommit={n => upGs({ winScore: n })} />
              </div>
              <div className="property-group">
                <label title="Survive this many waves. 0 = disabled.">WIN: WAVES (0 = off)</label>
                <NumericInput min={0} value={gs.winWaves ?? 0} onCommit={n => upGs({ winWaves: n })} />
              </div>
              {lvl.runnerMode && (
                <div className="property-group">
                  <label title="Travel this many tiles to win. 0 = infinite runner.">WIN: DISTANCE (tiles, 0 = ∞)</label>
                  <NumericInput min={0} value={gs.winDistance ?? 0} onCommit={n => upGs({ winDistance: n })} />
                </div>
              )}
            </>
          );
        })()}

        <div className="property-divider" />
        <div className="al-section-title">WAVE SPAWNER</div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6 }}>
          {lvl.runnerMode ? 'Spawn enemies from the right edge at a set distance or time.' : 'Spawn enemies from screen edges at timed intervals.'}
        </div>
        {(lvl.spawnWaves || []).map((wave, wi) => {
          const patchWave = patch => {
            const waves = [...(lvl.spawnWaves || [])];
            waves[wi] = { ...waves[wi], ...patch };
            onUpdateLevel(lvl.id, { spawnWaves: waves });
          };
          const isByDistance = wave.triggerType === 'distance';
          return (
            <div key={wi} style={{ padding: 6, marginBottom: 4, border: '1px solid var(--border)', display: 'flex', gap: 4, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {lvl.runnerMode && (
                <div className="property-group" style={{ flex: '1 1 90px', marginBottom: 0 }}>
                  <label>TRIGGER</label>
                  <Selector value={wave.triggerType || 'time'} onChange={v => patchWave({ triggerType: v })}
                    options={[{ value: 'time', label: 'Time (s)' }, { value: 'distance', label: 'Distance (tiles)' }]} width="100%" />
                </div>
              )}
              <div className="property-group" style={{ flex: '1 1 70px', marginBottom: 0 }}>
                <label>{isByDistance ? 'DISTANCE' : 'TIME (s)'}</label>
                <NumericInput min={0}
                  value={isByDistance ? (wave.triggerDistance ?? wi * 40) : (wave.triggerTime ?? wi * 20)}
                  onCommit={n => patchWave(isByDistance ? { triggerDistance: n } : { triggerTime: n })} />
              </div>
              <div className="property-group" style={{ flex: '1 1 50px', marginBottom: 0 }}>
                <label>COUNT</label>
                <NumericInput min={1} value={wave.count ?? 4} onCommit={n => patchWave({ count: n })} />
              </div>
              {lvl.runnerMode && (lvl.runnerLanes ?? 1) > 1 && (
                <div className="property-group" style={{ flex: '1 1 70px', marginBottom: 0 }}>
                  <label>LANE</label>
                  <Selector value={String(wave.runnerLane ?? 'any')} onChange={v => patchWave({ runnerLane: v === 'any' ? 'any' : parseInt(v, 10) })}
                    options={[{ value: 'any', label: 'Any' }, ...Array.from({ length: lvl.runnerLanes }, (_, i) => ({ value: String(i), label: `Lane ${i}` }))]} width="100%" />
                </div>
              )}
              <button type="button" onClick={() => onUpdateLevel(lvl.id, { spawnWaves: (lvl.spawnWaves || []).filter((_, i) => i !== wi) })}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', padding: '2px 6px', fontSize: 11, cursor: 'pointer', alignSelf: 'flex-end' }}>✕</button>
            </div>
          );
        })}
        <button type="button"
          onClick={() => {
            const waves = lvl.spawnWaves || [];
            const last = waves[waves.length - 1];
            const triggerTime = last ? (last.triggerTime ?? 0) + 20 : 0;
            const triggerDistance = last ? (last.triggerDistance ?? 0) + 40 : 40;
            const triggerType = last?.triggerType || 'time';
            onUpdateLevel(lvl.id, { spawnWaves: [...waves, { triggerType, triggerTime, triggerDistance, count: 4 }] });
          }}
          style={{ fontSize: 10, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', padding: '3px 8px', cursor: 'pointer', marginBottom: 4 }}
        >+ Add wave</button>

        {activeScreen?.worldSettings?.gameType?.primary === 'strategy' && activeScreen?.worldSettings?.gameType?.secondary === 'match-3' && (<>
          <div className="property-divider" />
          <div className="al-section-title">MATCH-3 GRID</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <div className="property-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>COLUMNS</label>
              <NumericInput min={4} max={12} value={lvl.m3Cols ?? 7} onCommit={n => onUpdateLevel(lvl.id, { m3Cols: n })} />
            </div>
            <div className="property-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>ROWS</label>
              <NumericInput min={4} max={12} value={lvl.m3Rows ?? 7} onCommit={n => onUpdateLevel(lvl.id, { m3Rows: n })} />
            </div>
          </div>
          <div className="property-group">
            <label>MOVES (0 = unlimited)</label>
            <NumericInput min={0} value={lvl.gameSettings?.moves ?? 30} onCommit={n => onUpdateLevel(lvl.id, { gameSettings: { ...(lvl.gameSettings || {}), moves: n } })} />
          </div>
        </>)}

        <div className="property-divider" />
        <div className="al-section-title">MOBILE VIEWPORT</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <RetroCheckbox
            checked={lvl.mobileViewport?.enabled || false}
            onChange={v => onUpdateLevel(lvl.id, { mobileViewport: { ...(lvl.mobileViewport || {}), enabled: v } })}
          />
          <span style={{ fontSize: 11, color: 'var(--text)' }}>Separate mobile viewport</span>
        </div>
        {lvl.mobileViewport?.enabled && (<>
          <div className="property-group">
            <label>ORIENTATION</label>
            <Selector
              value={lvl.mobileViewport?.orientation || 'portrait'}
              onChange={v => onUpdateLevel(lvl.id, { mobileViewport: { ...(lvl.mobileViewport || {}), orientation: v } })}
              options={[
                { value: 'portrait',  label: 'Portrait (tall)' },
                { value: 'landscape', label: 'Landscape (wide)' },
                { value: 'both',      label: 'Both orientations' },
              ]}
              width="100%"
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <div className="property-group">
              <label>MOBILE W (tiles)</label>
              <NumericInput min={4} value={lvl.mobileViewport?.cols ?? 10}
                onCommit={n => onUpdateLevel(lvl.id, { mobileViewport: { ...(lvl.mobileViewport || {}), cols: n } })} />
            </div>
            <div className="property-group">
              <label>MOBILE H (tiles)</label>
              <NumericInput min={4} value={lvl.mobileViewport?.rows ?? 18}
                onCommit={n => onUpdateLevel(lvl.id, { mobileViewport: { ...(lvl.mobileViewport || {}), rows: n } })} />
            </div>
          </div>
        </>)}

        <div className="property-divider" />
        <div className="al-section-title">BACKGROUNDS</div>
        {(() => {
          const bgs = lvl.backgrounds || [];
          const available = assets?.backgrounds || [];
          return (
            <>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <Selector value="" onChange={v => { if (v) onAddBackgroundLayer(v); }} options={[{value:'',label:available.length ? '+ Add background layer…' : 'No backgrounds (import in Sprites→Backgrounds)'}, ...available.map(a => ({value:a.id,label:a.name}))]} containerStyle={{ flex: 1, opacity: available.length === 0 ? 0.5 : 1, pointerEvents: available.length === 0 ? 'none' : 'auto' }} />
              </div>
              {bgs.length === 0 && (
                <div style={{ fontSize: 10, color: 'var(--text-dim)', padding: 8 }}>
                  Layers render bottom-to-top — the first one is the farthest back.
                </div>
              )}
              {bgs.map((layer, i) => {
                const asset = available.find(a => a.id === layer.assetId);
                const isMissingBg = !!(layer.assetId && !asset);
                return (
                  <div key={layer.id} style={{ padding: 6, marginTop: 6, border: `1px solid ${isMissingBg ? '#ff5566' : 'var(--border)'}`, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                      {asset?.src && <img src={asset.src} alt="" style={{ width: 40, height: 28, objectFit: 'cover', background: 'rgba(0,0,0,0.4)', imageRendering: 'pixelated', flex: '0 0 40px' }} />}
                      {isMissingBg ? (
                        <Selector
                          value=""
                          onChange={v => { if (v) onUpdateBackgroundLayer(layer.id, { assetId: v }); }}
                          options={[{ value: '', label: '⚠ missing — pick replacement…' }, ...available.map(a => ({ value: a.id, label: a.name }))]}
                          containerStyle={{ flex: '1 1 0', minWidth: 0 }}
                        />
                      ) : (
                      <span
                        title={asset?.name || ''}
                        style={{ flex: '1 1 0', minWidth: 0, fontSize: 11, color: 'var(--accent)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >{asset?.name}</span>
                      )}
                      <button className="small-btn" onClick={() => onMoveBackgroundLayer(layer.id, 'up')}   disabled={i === 0} style={{ minWidth: 22, padding: '0 4px', flex: '0 0 auto' }} title="Move farther back">↑</button>
                      <button className="small-btn" onClick={() => onMoveBackgroundLayer(layer.id, 'down')} disabled={i === bgs.length - 1} style={{ minWidth: 22, padding: '0 4px', flex: '0 0 auto' }} title="Move closer">↓</button>
                      <button className="small-btn" onClick={() => onRemoveBackgroundLayer(layer.id)} style={{ color: '#ff5566', borderColor: '#ff5566', padding: '0 6px', flex: '0 0 auto' }}>×</button>
                    </div>
                    {/* Background behavior toggle */}
                    <div style={{ display: 'flex', gap: 0, marginTop: 4, marginBottom: 4, border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                      {[
                        { val: 'world',    label: 'WORLD',    title: 'Anchored to world — colliders and sprites align perfectly. Matches the canvas editor exactly.' },
                        { val: 'parallax', label: 'PARALLAX', title: 'Background drifts at a different speed than the world — creates depth/distance illusion for far backgrounds.' },
                      ].map(opt => {
                        const active = (layer.behavior || 'world') === opt.val;
                        return (
                          <button
                            key={opt.val}
                            type="button"
                            title={opt.title}
                            onClick={() => onUpdateBackgroundLayer(layer.id, { behavior: opt.val })}
                            style={{
                              flex: 1, padding: '4px 0', fontSize: 10, fontFamily: 'monospace',
                              background: active ? 'var(--accent)' : 'transparent',
                              color: active ? 'var(--bg)' : 'var(--text-dim)',
                              border: 'none', cursor: 'pointer', fontWeight: active ? 'bold' : 'normal',
                            }}
                          >{opt.label}</button>
                        );
                      })}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
                      {(layer.behavior || 'world') === 'parallax' && (<>
                      <div className="property-group">
                        <label>PARALLAX X</label>
                        <NumericInput value={Math.round((layer.parallax?.x ?? 1) * 100)}
                          onCommit={n => onUpdateBackgroundLayer(layer.id, { parallax: { ...(layer.parallax || {}), x: n / 100 } })} />
                      </div>
                      <div className="property-group">
                        <label>PARALLAX Y</label>
                        <NumericInput value={Math.round((layer.parallax?.y ?? 1) * 100)}
                          onCommit={n => onUpdateBackgroundLayer(layer.id, { parallax: { ...(layer.parallax || {}), y: n / 100 } })} />
                      </div>
                      </>)}
                      <div className="property-group">
                        <label>OFFSET X</label>
                        <NumericInput value={layer.offset?.x ?? 0}
                          onCommit={n => onUpdateBackgroundLayer(layer.id, { offset: { ...(layer.offset || {}), x: n } })} />
                      </div>
                      <div className="property-group">
                        <label>OFFSET Y</label>
                        <NumericInput value={layer.offset?.y ?? 0}
                          onCommit={n => onUpdateBackgroundLayer(layer.id, { offset: { ...(layer.offset || {}), y: n } })} />
                      </div>
                      <div className="property-group">
                        <label title="Auto-scroll speed in play mode only — not visible in editor">SCROLL X (px/s) ▶</label>
                        <NumericInput value={layer.scroll?.x ?? 0}
                          onCommit={n => onUpdateBackgroundLayer(layer.id, { scroll: { ...(layer.scroll || {}), x: n } })} />
                      </div>
                      <div className="property-group">
                        <label title="Auto-scroll speed in play mode only — not visible in editor">SCROLL Y (px/s) ▶</label>
                        <NumericInput value={layer.scroll?.y ?? 0}
                          onCommit={n => onUpdateBackgroundLayer(layer.id, { scroll: { ...(layer.scroll || {}), y: n } })} />
                      </div>
                      <div className="property-group">
                        <label>OPACITY %</label>
                        <NumericInput min={0} max={100} value={Math.round((layer.opacity ?? 1) * 100)}
                          onCommit={n => onUpdateBackgroundLayer(layer.id, { opacity: n / 100 })} />
                      </div>
                      <div className="property-group">
                        <label>SCALE %</label>
                        <NumericInput min={1} value={Math.round((layer.scale ?? 1) * 100)}
                          onCommit={n => onUpdateBackgroundLayer(layer.id, { scale: n / 100 })} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 10, color: 'var(--text-dim)' }}>
                      <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="checkbox" checked={layer.repeat?.x !== false} onChange={e => onUpdateBackgroundLayer(layer.id, { repeat: { ...(layer.repeat || {}), x: e.target.checked } })} /> repeat X
                      </label>
                      <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="checkbox" checked={layer.repeat?.y === true} onChange={e => onUpdateBackgroundLayer(layer.id, { repeat: { ...(layer.repeat || {}), y: e.target.checked } })} /> repeat Y
                      </label>
                    </div>
                    <div className="property-group" style={{ marginTop: 6 }}>
                      <label title="Swap to this asset when device is in portrait orientation">PORTRAIT ASSET</label>
                      <Selector
                        value={layer.assetIdPortrait || ''}
                        onChange={v => onUpdateBackgroundLayer(layer.id, { assetIdPortrait: v || null })}
                        options={[
                          { value: '', label: '(same as landscape)' },
                          ...available.map(a => ({ value: a.id, label: a.name })),
                        ]}
                        width="100%"
                      />
                    </div>
                  </div>
                );
              })}
              {bgs.length > 0 && (
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
                  WORLD: background matches the canvas editor exactly — use for terrain/collision guides. PARALLAX: background drifts for depth effect (0% = fixed, 100% = tracks world).
                </div>
              )}
            </>
          );
        })()}

        <div className="property-divider" />
        <div className="al-section-title">TILEMAP</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <div className="property-group">
            <label>TILE W (px)</label>
            <NumericInput min={1} value={tm.tileWidth || 32}
              onCommit={n => patchTileMap({ tileWidth: n })} />
          </div>
          <div className="property-group">
            <label>TILE H (px)</label>
            <NumericInput min={1} value={tm.tileHeight || 32}
              onCommit={n => patchTileMap({ tileHeight: n })} />
          </div>
          <div className="property-group">
            <label>COLS</label>
            <NumericInput min={1} value={tm.cols || 22}
              onCommit={n => resizeTileMap(n, tm.rows || 22)} />
          </div>
          <div className="property-group">
            <label>ROWS</label>
            <NumericInput min={1} value={tm.rows || 22}
              onCommit={n => resizeTileMap(tm.cols || 22, n)} />
          </div>
        </div>

        <div className="property-group">
          <label>TILESET</label>
          {(() => {
            const sources = listTileSources(assets);
            const tilesets = sources.filter(s => s.kind === 'tileset');
            const sprites  = sources.filter(s => s.kind === 'spriteSheet');
            const allSources = [...tilesets, ...sprites];
            const isMissingTileset = !!(tm.tilesetAssetId && !allSources.find(s => s.id === tm.tilesetAssetId));
            const opts = [
              { value: '', label: isMissingTileset ? '⚠ missing — pick replacement…' : '— none —' },
              ...tilesets.map(s => ({ value: s.id, label: s.name })),
              ...sprites.map(s => ({ value: s.id, label: s.name })),
            ];
            return (
              <Selector
                value={isMissingTileset ? '' : (tm.tilesetAssetId || '')}
                onChange={v => patchTileMap({ tilesetAssetId: v || null })}
                options={opts}
                width="100%"
                containerStyle={isMissingTileset ? { outline: '1px solid #ff5566' } : undefined}
              />
            );
          })()}
        </div>

        {(() => {
          const tileset = resolveTilesetView(assets, tm.tilesetAssetId);
          const layerId = (tm.layers || [])[0]?.id || null;
          if (!tileset) {
            if (!layerId) {
              return (
                <div style={{ fontSize: 10, color: 'var(--text-dim)', padding: 8, border: '1px dashed var(--border)', marginTop: 4 }}>
                  Pick a tileset above. Anything with a grid works — including sprite sheets imported in the Sprites tab.
                </div>
              );
            }
            // No tileset but a layer exists — show collision painter with TILE / LINE mode selector.
            const isLineBrush = paintBrush?.mode === 'line';
            const isMaskBrush = paintBrush?.mode === 'mask';
            const isTileBrush = !isLineBrush && !isMaskBrush;
            const solidArmed  = isTileBrush && paintBrush?.layerId === layerId && paintBrush?.tileValue === 1;
            const eraseArmed  = isTileBrush && paintBrush?.layerId === layerId && paintBrush?.tileValue === 0;
            const shapes         = selectedLevel?.colliderShapes  || [];
            const occlusionShapes = selectedLevel?.occlusionShapes || [];
            const btnBase = { fontFamily: 'monospace', fontSize: 10, padding: '2px 6px', cursor: 'pointer', border: '1px solid var(--border)' };
            return (
              <>
                <div className="al-section-title" style={{ marginTop: 8 }}>COLLISION PAINTER</div>
                {/* Mode selector: Tile / Line / Mask */}
                <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
                  {[
                    ['■ Tile', 'tile',  null],
                    ['/ Line', 'line', { mode: 'line' }],
                    ['◈ Mask', 'mask', { mode: 'mask' }],
                  ].map(([label, id, brush]) => {
                    const active = id === 'tile' ? isTileBrush && !solidArmed && !eraseArmed
                                 : id === 'line' ? isLineBrush : isMaskBrush;
                    return (
                      <button key={id} className="retro-button" style={{ flex: 1,
                        background: active ? 'var(--accent)' : undefined,
                        color:      active ? 'var(--bg)'     : undefined,
                      }} onClick={() => onSetPaintBrush(active ? null : brush)}>
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* TILE mode */}
                {isTileBrush && (
                  <>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button className="retro-button"
                        style={{ flex: 1, background: solidArmed ? 'var(--accent)' : undefined, color: solidArmed ? 'var(--bg)' : undefined }}
                        onClick={() => onSetPaintBrush(solidArmed ? null : { layerId, tileValue: 1 })}
                        title="Paint solid collision blocks">■ Solid</button>
                      <button className="retro-button"
                        style={{ flex: 1, background: eraseArmed ? 'var(--accent)' : undefined, color: eraseArmed ? 'var(--bg)' : undefined }}
                        onClick={() => onSetPaintBrush(eraseArmed ? null : { layerId, tileValue: 0 })}
                        title="Erase collision blocks">□ Erase</button>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>
                      {(solidArmed || eraseArmed) ? 'Click/drag on the canvas · click again to disarm' : 'Arm a brush then paint collision cells on the background.'}
                    </div>
                  </>
                )}

                {/* LINE mode */}
                {isLineBrush && (
                  <>
                    <div style={{ fontSize: 10, color: 'rgba(0,220,255,0.85)', marginTop: 6, lineHeight: 1.5 }}>
                      Click to place points · dbl-click or Esc to finish.<br/>Backspace undoes last point.
                    </div>
                    {shapes.length > 0 ? (
                      <ColliderShapeList
                        shapes={shapes}
                        selectedColliderShapeId={selectedColliderShapeId}
                        onSelectColliderShape={onSelectColliderShape}
                        onUpdateLevel={onUpdateLevel}
                        lvlId={lvl.id}
                      />
                    ) : <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>No lines yet.</div>}
                  </>
                )}

                {/* MASK mode */}
                {isMaskBrush && (
                  <>
                    <div style={{ fontSize: 10, color: 'rgba(180,0,255,0.85)', marginTop: 6, lineHeight: 1.5 }}>
                      Click to place points · dbl-click or Esc to finish.<br/>
                      Nested masks punch holes (donut effect).
                    </div>
                    {occlusionShapes.length > 0 ? (
                      <MaskShapeList
                        shapes={occlusionShapes}
                        selectedOcclusionShapeId={selectedOcclusionShapeId}
                        onSelectOcclusionShape={onSelectOcclusionShape}
                        onUpdateLevel={onUpdateLevel}
                        lvlId={lvl.id}
                      />
                    ) : <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>No masks yet.</div>}
                  </>
                )}
              </>
            );
          }
          if (!layerId) {
            return (
              <div style={{ fontSize: 10, color: 'var(--text-dim)', padding: 8 }}>
                This level has no tilemap layers.
              </div>
            );
          }
          return (
            <>
              <div className="al-section-title" style={{ marginTop: 8 }}>PALETTE</div>
              <TilePalette
                tileset={tileset}
                brush={paintBrush}
                layerId={layerId}
                onSetBrush={onSetPaintBrush}
              />
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>
                {paintBrush
                  ? 'Click on the canvas to paint · drag to paint a stroke · click brush again to disarm'
                  : 'Click a tile to arm the brush.'}
              </div>
            </>
          );
        })()}
      </div>
    );
  }

  if (!component) {
    return (
      <div className="inspector">
        <h3>[INSPECTOR]</h3>
        <div style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: 10, fontSize: 11 }}>
          [ {activeScreen?.name || 'Screen'} selected ]
        </div>
        
        <div className="property-divider" style={{ marginTop: 15 }} />
        
        <div className="al-section-title">SCREEN SETTINGS</div>
        <div className="property-group">
          <label>NAME</label>
          <input
            type="text"
            value={activeScreen?.name || ''}
            onChange={e => onUpdateScreen(activeScreen.id, { name: e.target.value })}
          />
        </div>
        <div className="property-group">
          <label style={{ fontSize: 10 }}>PUBLISH SLUG <span style={{ opacity: 0.5 }}>(URL path)</span></label>
          <input
            type="text"
            value={activeScreen?.settings?.slug || ''}
            onChange={e => onUpdateScreen(activeScreen.id, { settings: { ...activeScreen.settings, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') } })}
            placeholder="my-page"
          />
        </div>
        <div className="property-group">
          <label style={{ fontSize: 10 }}>DESCRIPTION <span style={{ opacity: 0.5 }}>(meta)</span></label>
          <textarea
            value={activeScreen?.settings?.description || ''}
            onChange={e => onUpdateScreen(activeScreen.id, { settings: { ...activeScreen.settings, description: e.target.value } })}
            rows={2}
            style={{ fontSize: 10, fontFamily: 'monospace' }}
            placeholder="Short description for social sharing"
          />
        </div>

        <div className="property-divider" style={{ opacity: 0.3 }} />
        
        <div className="property-group">
          <label>WEB TITLE (Export)</label>
          <input 
            type="text" 
            value={activeScreen?.settings?.webTitle || ''} 
            onChange={e => onUpdateScreen(activeScreen.id, { settings: { ...activeScreen.settings, webTitle: e.target.value } })}
            placeholder="Global title if Screen 1"
            {...tutorialHoverBindings('Inspector.WebTitle', 'Web Title')}
          />
        </div>

        <div className="property-group">
          <label>META TAGS (Export)</label>
          <textarea 
            value={activeScreen?.settings?.metaTags || ''} 
            onChange={e => onUpdateScreen(activeScreen.id, { settings: { ...activeScreen.settings, metaTags: e.target.value } })}
            placeholder='e.g. <meta name="description" content="..."> '
            rows={3}
            style={{ fontSize: 10, fontFamily: 'monospace' }}
          />
        </div>

        <div className="property-divider" style={{ opacity: 0.3 }} />

        <div className="property-group">
          <label>AUTO JUMP (sec)</label>
          <input
            type="text" inputMode="numeric"
            value={activeScreen?.settings?.timeout ?? ''}
            onChange={e => onUpdateScreen(activeScreen.id, { settings: { ...activeScreen.settings, timeout: e.target.value } })}
            onBlur={e => {
              const n = parseInt(e.target.value, 10);
              onUpdateScreen(activeScreen.id, { settings: { ...activeScreen.settings, timeout: isNaN(n) ? 0 : n } });
            }}
            placeholder="0 = disabled"
          />
        </div>
        {(activeScreen?.settings?.timeout > 0) && (
          <div className="property-group">
            <label>NEXT SCREEN</label>
            <Selector value={activeScreen?.settings?.nextScreenId || ''} onChange={v => onUpdateScreen(activeScreen.id, { settings: { ...activeScreen.settings, nextScreenId: v } })} options={[{value:'',label:'-- Select Screen --'}, ...(screens || []).filter(s => s.id !== activeScreen.id).map(s => ({value:s.id,label:s.name}))]} width="100%" />
          </div>
        )}

        <div className="property-divider" style={{ marginTop: 20 }} />
        {screenLayout && onUpdateScreenLayout && (() => {
          const desktopLayout = screenLayout;
          const mobileOverride = desktopLayout.mobile || null;
          const hasMobileOverride = mobileOverride && Object.keys(mobileOverride).length > 0;
          // Mobile is fully independent — start from mobile defaults, not from desktop
          const activeLayout = viewMode === 'mobile'
            ? { ...DEFAULT_MOBILE_SCREEN_LAYOUT, ...(mobileOverride || {}) }
            : desktopLayout;

          const handleScreenLayoutUpdate = (changes) => {
            if (viewMode === 'mobile') {
              const newMobile = { ...(mobileOverride || {}), ...changes };
              onUpdateScreenLayout({ mobile: newMobile });
            } else {
              onUpdateScreenLayout(changes);
            }
          };

          return (
            <>
              <div style={{
                padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6,
                background: viewMode === 'mobile' ? 'rgba(255,140,0,0.1)' : 'rgba(0,200,100,0.06)',
                borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 'bold', color: viewMode === 'mobile' ? '#ff9900' : 'var(--accent)' }}>
                  {viewMode === 'mobile' ? '[MOBILE]' : '[DESKTOP]'}
                </span>
                {viewMode === 'mobile' && hasMobileOverride && (
                  <>
                    <span style={{ fontSize: 9, color: '#ff9900', marginLeft: 'auto' }}>custom</span>
                    <button
                      onClick={() => onUpdateScreenLayout({ mobile: null })}
                      title="Reset to mobile defaults"
                      style={{ fontSize: 9, background: 'none', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: 'pointer', padding: '1px 5px', fontFamily: 'monospace' }}
                    >reset</button>
                  </>
                )}
                {viewMode === 'mobile' && !hasMobileOverride && (
                  <span style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 'auto' }}>mobile defaults</span>
                )}
              </div>
              <AutoLayoutPanel layout={activeLayout} onUpdate={handleScreenLayoutUpdate} />
            </>
          );
        })()}
        {gameMode && activeScreen?.kind === 'world' && (() => {
          const ws = activeScreen.worldSettings || {};
          const primaryGenre  = ws.gameType?.primary  || '';
          const secondaryGenre = ws.gameType?.secondary || '';
          const preset = getPreset(primaryGenre, secondaryGenre);
          const subtypeOptions = getSubtypes(primaryGenre).map(s => ({ value: s.value, label: s.label }));
          const primaryOptions = [{ value: '', label: '— Select genre —' }, ...GENRE_TREE.map(g => ({ value: g.value, label: g.label }))];

          const applyPreset = () => {
            if (!preset) return;
            const presetKey    = `${primaryGenre}.${secondaryGenre}`;
            const mobileLayout = preset.mobileControls?.layout || 'platformer';
            const isVertical   = preset.gravityDir === 'down' || preset.gravityDir === 'up';
            const viewportType = isVertical ? 'platformer' : 'topdown';

            // 1. Update world settings — preserve gameType already set by genre selectors
            onUpdateScreen(activeScreen.id, {
              worldSettings: {
                ...ws,
                defaultGravity:  preset.physics.gravity,
                defaultViewport: viewportType,
                controlLayout:   mobileLayout,
                mobileControls:  { ...(ws.mobileControls || {}), layout: mobileLayout },
              },
            });

            // 2. Apply physics + orientation + entities to the active level (if any)
            if (selectedLevel) {
              const tm    = selectedLevel.tileMap || {};
              const tileW = tm.tileWidth  || 32;
              const tileH = tm.tileHeight || 32;
              const cols  = tm.cols || 22;
              const rows  = tm.rows || 16;

              // Derive viewport dimensions from the level grid or sensible defaults
              const vCols = selectedLevel.viewportCols ?? cols;
              const vRows = selectedLevel.viewportRows ?? rows;

              const levelPatch = {
                gravity:      preset.physics.gravity,
                gravityDir:   preset.gravityDir || 'none',
                cameraAxis:   preset.camera?.axis || 'both',
                levelType:    'game',
                viewport:     viewportType,
                controlLayout: mobileLayout,
                viewportCols: vCols,
                viewportRows: vRows,
              };

              // Auto-build entities only when the level has none yet
              if ((selectedLevel.entities || []).length === 0) {
                levelPatch.entities = buildLevelEntities(presetKey, tileW, tileH, cols, rows);
              }

              onUpdateLevel(selectedLevel.id, levelPatch);
            }
          };

          return (
            <>
              <div className="property-divider" style={{ marginTop: 20 }} />
              <div className="al-section-title">WORLD</div>

              {/* Genre selector */}
              <div className="property-group">
                <label>GENRE</label>
                <Selector
                  value={primaryGenre}
                  onChange={v => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, gameType: { primary: v, secondary: '' } } })}
                  options={primaryOptions}
                  width="100%"
                />
              </div>
              {primaryGenre && (
                <div className="property-group">
                  <label>SUBTYPE</label>
                  <Selector
                    value={secondaryGenre}
                    onChange={v => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, gameType: { primary: primaryGenre, secondary: v } } })}
                    options={[{ value: '', label: '— Select subtype —' }, ...subtypeOptions]}
                    width="100%"
                  />
                </div>
              )}
              {preset && (
                <div style={{ marginBottom: 8 }}>
                  {/* Preset info */}
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 4, lineHeight: 1.5 }}>
                    {preset.description}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.6 }}>
                    Gravity: {preset.physics.gravity} · Speed: {preset.playerStats?.speed ?? '—'} px/s
                    {preset.playerStats?.jumpHeight ? ` · Jump: ${preset.playerStats.jumpHeight} tiles` : ''}
                    · Lives: {preset.game?.lives === 0 ? '∞' : (preset.game?.lives ?? '—')}
                  </div>

                  {/* ── Build Game Wizard ── */}
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--accent)', padding: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 9, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 6, letterSpacing: 1 }}>
                      BUILD GAME
                    </div>
                    <div className="property-group" style={{ marginBottom: 6 }}>
                      <label style={{ fontSize: 9 }}>LEVELS</label>
                      <NumericInput
                        value={buildLevelCount}
                        onCommit={n => setBuildLevelCount(Math.max(1, Math.min(10, Math.round(n))))}
                        min={1} max={10}
                        style={{ width: 48 }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => onBuildGame(activeScreen.id, {
                        primary: primaryGenre,
                        secondary: secondaryGenre,
                        preset,
                        numLevels: buildLevelCount,
                      })}
                      style={{
                        width: '100%', padding: '6px 0', fontSize: 11, fontFamily: 'monospace',
                        background: 'var(--accent)', color: 'var(--bg)',
                        border: 'none', cursor: 'pointer', fontWeight: 'bold', letterSpacing: 0.5,
                      }}
                    >
                      ⚡ Build Game
                    </button>
                    <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.5 }}>
                      Creates {buildLevelCount} level{buildLevelCount > 1 ? 's' : ''} with physics,
                      {` `}entities and backgrounds pre-configured. Replaces existing levels.
                    </div>
                  </div>

                  {/* ── Apply to active level only ── */}
                  <button
                    type="button"
                    onClick={applyPreset}
                    style={{
                      width: '100%', padding: '3px 0', fontSize: 9, fontFamily: 'monospace',
                      background: 'transparent', color: 'var(--text-dim)',
                      border: '1px solid var(--border)', cursor: 'pointer',
                    }}
                  >
                    ↓ Apply physics to active level only
                  </button>
                  {!selectedLevel && (
                    <div style={{ fontSize: 8, color: 'var(--text-dim)', marginTop: 2 }}>
                      (select a level in the canvas first)
                    </div>
                  )}
                </div>
              )}

              {/* Mobile Controls section */}
              <div className="property-divider" style={{ marginTop: 8 }} />
              <div className="al-section-title">MOBILE CONTROLS</div>
              {(() => {
                const mc = ws.mobileControls || {};
                const LAYOUTS = [
                  { value: '',                 label: 'Manual / choose later' },
                  { value: 'platformer',       label: 'Platformer (←→ + Jump/Run/Attack)' },
                  { value: 'platformer-dash',  label: 'Platformer + Dash' },
                  { value: 'topdown-action',   label: 'Top-Down Action (D-pad + ⚔/Dash/Use)' },
                  { value: 'topdown-move-only',label: 'Top-Down Move Only' },
                  { value: 'dpad-only',        label: 'D-Pad Only (4 directions)' },
                  { value: 'left-right-only',  label: 'Left / Right Only' },
                  { value: 'up-down-only',     label: 'Up / Down Only' },
                  { value: 'tap-only',         label: 'Tap-Only (Flappy Bird)' },
                  { value: 'swipe-jump',       label: 'Swipe Gestures (Endless Runner)' },
                  { value: 'arcade-shooter',   label: 'Arcade Shooter (←→ + Fire)' },
                  { value: 'custom',           label: 'Custom (set by preset)' },
                ];
                const layoutPhysics = {
                  platformer:      { viewport: 'platformer', gravity: 800, gravityDir: 'down' },
                  'platformer-dash': { viewport: 'platformer', gravity: 800, gravityDir: 'down' },
                  'swipe-jump':    { viewport: 'platformer', gravity: 800, gravityDir: 'down' },
                  'tap-only':      { viewport: 'platformer', gravity: 800, gravityDir: 'down' },
                  'topdown-action': { viewport: 'topdown', gravity: 0, gravityDir: 'none' },
                  'topdown-move-only': { viewport: 'topdown', gravity: 0, gravityDir: 'none' },
                  'dpad-only':     { viewport: 'topdown', gravity: 0, gravityDir: 'none' },
                };
                const updateMc = (patch) => {
                  const nextLayout = Object.prototype.hasOwnProperty.call(patch, 'layout') ? patch.layout : mc.layout;
                  onUpdateScreen(activeScreen.id, {
                    worldSettings: {
                      ...ws,
                      controlLayout: nextLayout || '',
                      mobileControls: { ...mc, ...patch },
                    },
                  });
                  const physics = layoutPhysics[nextLayout];
                  if (selectedLevel && physics) {
                    onUpdateLevel(selectedLevel.id, {
                      controlLayout: nextLayout,
                      viewport: physics.viewport,
                      gravity: physics.gravity,
                      gravityDir: physics.gravityDir,
                      levelType: 'game',
                    });
                  }
                };
                return (
                  <>
                    <div className="property-group">
                      <label>LAYOUT</label>
                      <Selector
                        value={mc.layout || ws.controlLayout || ''}
                        onChange={v => updateMc({ layout: v })}
                        options={LAYOUTS}
                        width="100%"
                      />
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 6 }}>
                      Controls are shared by desktop and mobile. Genre presets can set this automatically, or choose one manually for a blank game.
                    </div>
                  </>
                );
              })()}

              {/* ── Mobile Viewport ── */}
              <div className="property-divider" style={{ marginTop: 8 }} />
              <div className="al-section-title">MOBILE VIEWPORT</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <RetroCheckbox
                  checked={ws.mobileViewport?.enabled || false}
                  onChange={v => { const cur = ws.mobileViewport || {}; onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, mobileViewport: { enabled: v, orientation: cur.orientation ?? 'portrait', cols: cur.cols ?? 10, rows: cur.rows ?? 18, renderWidth: cur.renderWidth ?? 390, renderHeight: cur.renderHeight ?? 844 } } }); }}
                />
                <span style={{ fontSize: 11, color: 'var(--text)' }}>Separate mobile viewport</span>
              </div>
              {ws.mobileViewport?.enabled && (<>
                <div className="property-group">
                  <label>ORIENTATION</label>
                  <Selector
                    value={ws.mobileViewport?.orientation || 'portrait'}
                    onChange={v => {
                      const cur = ws.mobileViewport || {};
                      const needsDefault = cur.renderWidth == null || cur.renderHeight == null;
                      const defaults = v === 'landscape'
                        ? { renderWidth: 844, renderHeight: 390 }
                        : { renderWidth: 390, renderHeight: 844 };
                      onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, mobileViewport: { ...cur, orientation: v, ...(needsDefault ? defaults : {}) } } });
                    }}
                    options={[
                      { value: 'portrait',  label: 'Portrait (tall)' },
                      { value: 'landscape', label: 'Landscape (wide)' },
                      { value: 'both',      label: 'Both orientations' },
                    ]}
                    width="100%"
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  <div className="property-group">
                    <label>RENDER W (px)</label>
                    <NumericInput min={120} value={ws.mobileViewport?.renderWidth ?? 390}
                      onCommit={n => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, mobileViewport: { ...(ws.mobileViewport || {}), renderWidth: n } } })} />
                  </div>
                  <div className="property-group">
                    <label>RENDER H (px)</label>
                    <NumericInput min={120} value={ws.mobileViewport?.renderHeight ?? 844}
                      onCommit={n => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, mobileViewport: { ...(ws.mobileViewport || {}), renderHeight: n } } })} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  <div className="property-group">
                    <label>MOBILE W (tiles)</label>
                    <NumericInput min={4} value={ws.mobileViewport?.cols ?? 10}
                      onCommit={n => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, mobileViewport: { ...(ws.mobileViewport || {}), cols: n } } })} />
                  </div>
                  <div className="property-group">
                    <label>MOBILE H (tiles)</label>
                    <NumericInput min={4} value={ws.mobileViewport?.rows ?? 18}
                      onCommit={n => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, mobileViewport: { ...(ws.mobileViewport || {}), rows: n } } })} />
                  </div>
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 6, lineHeight: 1.5 }}>
                  Render size controls the real mobile aspect. Tile counts are still useful for level planning, but do not force the screen aspect.
                </div>
              </>)}

              <div className="property-group">
                <label style={{ fontSize: 10 }}>PUBLISH SLUG <span style={{ opacity: 0.5 }}>(URL path)</span></label>
                <input
                  type="text"
                  value={ws.slug || ''}
                  onChange={e => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') } })}
                  placeholder="my-game"
                />
              </div>
              <div className="property-group">
                <label style={{ fontSize: 10 }}>DESCRIPTION</label>
                <textarea
                  value={ws.description || ''}
                  onChange={e => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, description: e.target.value } })}
                  rows={2}
                  style={{ fontSize: 10, fontFamily: 'monospace' }}
                  placeholder="Short description for social sharing"
                />
              </div>
              {/* ── Multiplayer ───────────────────────────────── */}
              <div style={{ border: '1px solid var(--border)', padding: 12, position: 'relative', marginTop: 8 }}>
                <div style={{ position: 'absolute', top: -10, left: 10, background: 'var(--bg)', padding: '0 5px', fontSize: 11, color: 'var(--accent)' }}>MULTIPLAYER</div>
                <div className="property-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <label style={{ margin: 0 }}>ENABLED</label>
                  <input type="checkbox" checked={!!ws.multiplayer?.enabled}
                    onChange={e => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, multiplayer: { ...(ws.multiplayer || {}), enabled: e.target.checked } } })} />
                </div>
                {ws.multiplayer?.enabled && (<>
                  <div className="property-group">
                    <label>MAX PLAYERS</label>
                    <input type="number" min={2} max={16} value={ws.multiplayer?.maxPlayers ?? 8}
                      onChange={e => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, multiplayer: { ...(ws.multiplayer || {}), maxPlayers: Number(e.target.value) } } })} />
                  </div>
                  <div className="property-group">
                    <label>MODE</label>
                    <Selector value={ws.multiplayer?.mode || 'open'}
                      onChange={v => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, multiplayer: { ...(ws.multiplayer || {}), mode: v } } })}
                      options={[{ value: 'open', label: 'Open' }, { value: 'cooperative', label: 'Cooperative' }, { value: 'competitive', label: 'Competitive' }]}
                      width="100%" />
                  </div>
                  <div className="property-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <label style={{ margin: 0 }}>SHOW USERNAMES</label>
                    <input type="checkbox" checked={ws.multiplayer?.showUsernames !== false}
                      onChange={e => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, multiplayer: { ...(ws.multiplayer || {}), showUsernames: e.target.checked } } })} />
                  </div>
                  <div className="property-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <label style={{ margin: 0 }}>SYNC HP</label>
                    <input type="checkbox" checked={!!ws.multiplayer?.syncHp}
                      onChange={e => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, multiplayer: { ...(ws.multiplayer || {}), syncHp: e.target.checked } } })} />
                  </div>
                </>)}
              </div>
              <div className="property-group">
                <label>DEFAULT VIEWPORT (new levels)</label>
                <Selector value={ws.defaultViewport || ''} onChange={v => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, defaultViewport: v } })} options={[{value:'',label:'Manual / no preset'},{value:'topdown',label:'Top-down'},{value:'platformer',label:'Platformer'},{value:'isometric',label:'Isometric'},{value:'board',label:'Board'}]} width="100%" />
              </div>
              <div className="property-group">
                <label>DEFAULT GRAVITY (new levels)</label>
                <input
                  type="text" inputMode="numeric"
                  value={ws.defaultGravity ?? ''}
                  onChange={e => onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, defaultGravity: e.target.value } })}
                  onBlur={e => {
                    const n = parseFloat(e.target.value);
                    onUpdateScreen(activeScreen.id, { worldSettings: { ...ws, defaultGravity: isNaN(n) ? 0 : n } });
                  }}
                />
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 6 }}>
                {(activeScreen.levels || []).length} level{(activeScreen.levels || []).length === 1 ? '' : 's'} in this world.
              </div>
            </>
          );
        })()}

        {renderGlobalSoundSettings()}

        <div className="property-divider" />
        <div style={{ color: 'var(--text-dim)', fontSize: 10, lineHeight: 1.7 }}>
          <b style={{ color: 'var(--accent)' }}>SHORTCUTS</b><br />
          Delete — remove<br />
          Ctrl+D — duplicate<br />
          Drag — reorder<br />
        </div>
      </div>
    );
  }

  // ── Si es una fila seleccionada, mostrar AutoLayout ──────────────────────
  if (isRow) {
    const desktopLayout = component.layout || {};
    const mobileOverride = desktopLayout.mobile || null;
    const hasMobileOverride = mobileOverride && Object.keys(mobileOverride).length > 0;
    // Mobile is fully independent — start from mobile defaults, not from desktop
    const activeLayout = viewMode === 'mobile'
      ? { ...DEFAULT_MOBILE_ROW_LAYOUT, ...(mobileOverride || {}) }
      : desktopLayout;

    const handleLayoutUpdate = (changes) => {
      if (viewMode === 'mobile') {
        const newMobile = { ...(mobileOverride || {}), ...changes };
        onUpdate(component.id, { mobile: newMobile });
      } else {
        onUpdate(component.id, changes);
      }
    };

    return (
      <div className="inspector">
        <h3>[ROW LAYOUT]</h3>
        <div className="property-group">
          <label>ID</label>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', wordBreak: 'break-all' }}>{component.id}</div>
        </div>
        <div style={{
          padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6,
          background: viewMode === 'mobile' ? 'rgba(255,140,0,0.1)' : 'rgba(0,200,100,0.06)',
          borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 'bold', color: viewMode === 'mobile' ? '#ff9900' : 'var(--accent)' }}>
            {viewMode === 'mobile' ? '[MOBILE]' : '[DESKTOP]'}
          </span>
          {viewMode === 'mobile' && hasMobileOverride && (
            <>
              <span style={{ fontSize: 9, color: '#ff9900', marginLeft: 'auto' }}>custom</span>
              <button
                onClick={() => onUpdate(component.id, { mobile: null })}
                title="Reset to mobile defaults"
                style={{ fontSize: 9, background: 'none', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: 'pointer', padding: '1px 5px', fontFamily: 'monospace' }}
              >reset</button>
            </>
          )}
          {viewMode === 'mobile' && !hasMobileOverride && (
            <span style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 'auto' }}>mobile defaults</span>
          )}
        </div>
        <div className="property-divider" />
        <AutoLayoutPanel
          layout={activeLayout}
          onUpdate={handleLayoutUpdate}
        />
        <div className="property-divider" />
        <button className="inspector-btn delete" onClick={onDelete} style={{ width: '100%' }}>
          Delete Row
        </button>
      </div>
    );
  }

  // ── Inspector normal para componentes ─────────────────────────────────────
  const updateLocal = (field, value) => setLocalProps(prev => ({ ...prev, [field]: value }));
  const updateAndCommit = (field, value) => { updateLocal(field, value); commitChange(field, value); };
  
  const renderDataBinding = () => {
    const tableNames = Object.keys(database?.data || {});
    const findTableContext = (id) => {
      const findInRows = (items, parentTable = null) => {
        for (const item of items) {
          let currentTable = parentTable;
          if (item.type === 'Form') currentTable = item.props.targetTable;
          if (item.type === 'DataRepeater') currentTable = item.props.tableName;
          if (item.id === id) return currentTable;
          if (item.children) {
            const result = findInRows(item.children, currentTable);
            if (result) return result;
          }
        }
        return null;
      };
      return findInRows(activeScreen?.rows || []);
    };

    const contextTable = findTableContext(component.id);
    const selectedTable = localProps.dataSourceTable || contextTable || '';
    const fields = (database?.tables || []).find(t => t.name === selectedTable)?.fields || [];
    const isInherited = !localProps.dataSourceTable && contextTable;

    return (
      <div className="property-group">
        <div className="al-section-title">DYNAMIC CONTENT</div>
        <label>CONTENT TYPE</label>
        <Selector value={localProps.dataSourceType||'manual'} onChange={v => updateAndCommit('dataSourceType', v)} options={[{value:'manual',label:'Static Content (Manual)'},{value:'database',label:'Dynamic Data (Linked)'}]} width="100%" />

        {localProps.dataSourceType === 'database' && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!isInherited && (
              <div>
                <label>SOURCE TABLE</label>
                <Selector
                  value={localProps.dataSourceTable || ''}
                  onChange={v => {
                    updateAndCommit('dataSourceTable', v);
                    updateAndCommit('dataField', '');
                    updateAndCommit('dataFilterField', '');
                    updateAndCommit('dataFilterValue', '');
                  }}
                  options={[{value:'',label:'-- Select Table --'}, ...tableNames.map(t => ({value:t,label:t}))]}
                  width="100%"
                  searchable
                />
              </div>
            )}
            
            {isInherited && (
              <div style={{ fontSize: 9, color: 'var(--accent)', marginBottom: 4 }}>
                [ Linked to table: <b>{contextTable}</b> ]
              </div>
            )}

            {(selectedTable) && (
              <div>
                <label>MAPPING FIELD</label>
                <Selector value={localProps.dataField || ''} onChange={v => updateAndCommit('dataField', v)} options={[{value:'',label:'-- Select Field --'}, ...fields.map(f => ({value:f.name,label:`${f.name} (${f.type})`}))]} width="100%" />
              </div>
            )}

            {(selectedTable) && (
              <>
                <div>
                  <label>FILTER BY FIELD</label>
                  <Selector
                    value={localProps.dataFilterField || ''}
                    onChange={v => {
                      updateAndCommit('dataFilterField', v);
                      updateAndCommit('dataFilterValue', '');
                    }}
                    options={[{value:'',label:'-- No Filter --'}, ...fields.map(f => ({value:f.name,label:`${f.name} (${f.type})`}))]}
                    width="100%"
                  />
                </div>
                {localProps.dataFilterField && (
                  <div>
                    <label>FILTER VALUE</label>
                    <FilterValueInput
                      value={localProps.dataFilterValue || ''}
                      onCommit={value => updateAndCommit('dataFilterValue', value)}
                      placeholder="Value, number, or {{template}}"
                    />
                  </div>
                )}
              </>
            )}

            <div className="property-group" style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
              <input 
                type="checkbox" 
                checked={localProps.requireLogin || false} 
                onChange={e => updateAndCommit('requireLogin', e.target.checked)}
                style={{ width: 'auto', marginRight: 8 }}
              />
              <label style={{ margin: 0, cursor: 'pointer' }} onClick={() => updateAndCommit('requireLogin', !localProps.requireLogin)}>
                REQUIRE LOGIN
              </label>
            </div>

            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4, fontStyle: 'italic' }}>
              {selectedTable ? `[ Showing ${selectedTable}.${localProps.dataField || '?'} ]` : '[ Link a table first ]'}
            </div>
          </div>
        )}
        <div className="property-divider" />
      </div>
    );
  };

  const showLayoutPanel = ['Window', 'Frame', 'Row', 'DataRepeater', 'Tabs', 'Form'].includes(component.type);

  const renderNumber = (field, label, placeholder = '', onAfterCommit) => (
    <div className="property-group">
      <label>{label}</label>
      <input
        type="text" inputMode="numeric"
        value={localProps[field] ?? ''}
        onChange={e => updateLocal(field, e.target.value)}
        onBlur={() => {
          const v = localProps[field];
          if (v === '' || v === undefined) { commitChange(field, 0); updateLocal(field, 0); return; }
          const n = parseInt(v, 10);
          if (!isNaN(n)) { 
            commitChange(field, n); 
            updateLocal(field, n); 
            if (onAfterCommit) onAfterCommit(n);
          }
          else updateLocal(field, component.props[field] || 0);
        }}
        onKeyDown={e => { 
          if (e.key === 'Enter') { 
            const n = parseInt(localProps[field], 10); 
            if (!isNaN(n)) { 
              commitChange(field, n); 
              if (onAfterCommit) onAfterCommit(n);
            } 
            e.target.blur(); 
          } 
        }}
        placeholder={placeholder}
      />
    </div>
  );

  const isHex = v => /^#[0-9a-fA-F]{6}$/.test(v);
  const normalizePickerColor = (value, fallback) => isHex(value) ? value : fallback;
  const isTransparentColor = v => v === 'transparent';
  const isTransparentPrefix = v => 'transparent'.startsWith((v || '').toLowerCase());

  const TOKEN_SLOTS = [
    { key: 'accent',  css: 'var(--accent)',   hex: themeColors.accent  || '#ffff00' },
    { key: 'text',    css: 'var(--text)',     hex: themeColors.text    || '#00ff00' },
    { key: 'textDim', css: 'var(--text-dim)', hex: themeColors.textDim || '#008800' },
    { key: 'bg',      css: 'var(--bg)',       hex: themeColors.bg      || '#000000' },
    { key: 'border',  css: 'var(--border)',   hex: themeColors.border  || '#00aa00' },
  ];
  const isTokenValue = v => typeof v === 'string' && v.startsWith('var(--');
  const resolveTokenHex = v => TOKEN_SLOTS.find(s => s.css === v)?.hex || '#888888';

  const renderColor = (label, field, defValue = '', allowTransparent = false) => {
    let themeDefault = defValue;
    if (!themeDefault) {
      const fl = field.toLowerCase();
      if (fl.includes('text') || fl.includes('color') || fl.includes('icon')) themeDefault = themeColors.text || '#00ff00';
      else if (fl.includes('border')) themeDefault = themeColors.border || '#00ff00';
      else if (fl.includes('bg')) themeDefault = themeColors.bg || '#000000';
      else themeDefault = themeColors.text || '#00ff00';
    }

    const rawValue = localProps[field] ?? '';
    const isToken = isTokenValue(rawValue);
    const tokenName = isToken ? rawValue.replace('var(--', '').replace(')', '') : '';
    const resolvedHex = isToken ? resolveTokenHex(rawValue) : '';

    return (
      <div className="property-group">
        <label>{label}</label>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="text"
            className="hex-input"
            placeholder={themeDefault}
            maxLength={isToken ? 10 : (allowTransparent ? 11 : 7)}
            value={isToken ? tokenName : rawValue}
            style={isToken ? { opacity: 0.7, fontStyle: 'italic' } : {}}
            onChange={e => {
              if (isToken) { updateLocal(field, ''); return; }
              const value = e.target.value;
              if (value === '' || /^#[0-9a-fA-F]{0,6}$/.test(value) || (allowTransparent && isTransparentPrefix(value))) {
                updateLocal(field, value);
              }
            }}
            onBlur={() => {
              if (isToken) return;
              const value = localProps[field];
              if (value === '' || isHex(value) || (allowTransparent && isTransparentColor(value))) {
                commitChange(field, value);
              } else {
                updateLocal(field, component.props[field] ?? '');
              }
            }}
            onKeyDown={e => {
              if (isToken) {
                if (e.key === 'Backspace' || e.key === 'Delete') commitChange(field, '');
                return;
              }
              const value = localProps[field];
              if (e.key === 'Enter' && (value === '' || isHex(value) || (allowTransparent && isTransparentColor(value)))) {
                commitChange(field, value);
                e.target.blur();
              }
            }}
          />
          <input
            type="color"
            className="color-picker"
            value={normalizePickerColor(isToken ? resolvedHex : rawValue, themeDefault)}
            onChange={e => commitChange(field, e.target.value.toLowerCase())}
          />
        </div>
        <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
          {TOKEN_SLOTS.map(({ key, css, hex }) => {
            const isActive = rawValue === css;
            return (
              <button
                key={key}
                title={`${key} · ${hex}`}
                onClick={() => commitChange(field, isActive ? '' : css)}
                style={{
                  width: 16, height: 16, background: hex,
                  border: isActive ? '2px solid var(--accent)' : '1px solid var(--border)',
                  cursor: 'pointer', padding: 0, flexShrink: 0,
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            );
          })}
          {allowTransparent && (
            <button
              title="transparent"
              onClick={() => commitChange(field, rawValue === 'transparent' ? '' : 'transparent')}
              style={{
                width: 16, height: 16,
                background: 'repeating-conic-gradient(#666 0% 25%, #333 0% 50%) 0 0 / 8px 8px',
                border: rawValue === 'transparent' ? '2px solid var(--accent)' : '1px solid var(--border)',
                cursor: 'pointer', padding: 0, flexShrink: 0,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          )}
        </div>
      </div>
    );
  };

  const renderProps = () => {
    const t = component.type;
    switch (t) {
      case 'Window': return (<>
        {renderDataBinding()}
        <div className="property-group"><label>TITLE</label><input type="text" value={localProps.title||''} onChange={e => updateAndCommit('title', e.target.value)} /></div>
        {renderNumber('width','WIDTH (px)','400')}
        <div className="property-group"><label>HEIGHT</label>
          <Selector value={String(localProps.height||'')} onChange={v => updateAndCommit('height', v)} options={[{value:'',label:'Auto'}, ...[200,300,400,500,600,700,800].map(h => ({value:String(h),label:`${h}px`}))]} width="100%" />
        </div>
        {renderColor('TEXT COLOR','textColor','#00ff00')}
        {renderColor('BACKGROUND','bgColor','#000000', true)}
        {renderColor('BORDER COLOR','borderColor','#00ff00')}

        <div className="property-divider" />
        <div className="al-section-title">BACKGROUND IMAGE</div>
        <div className="property-group">
          <label>SOURCE</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              type="text"
              value={localProps.bgImage || ''}
              onChange={e => updateAndCommit('bgImage', e.target.value)}
              placeholder="https://… or paste data URL"
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label className="upload-file-label">
                Upload File
                <input
                  type="file"
                  style={{ display: 'none' }}
                  accept="image/*"
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const { url } = await uploadAsset(file, 'image');
                      updateAndCommit('bgImage', url);
                    } catch {
                      const reader = new FileReader();
                      reader.onload = (ev) => updateAndCommit('bgImage', ev.target.result);
                      reader.readAsDataURL(file);
                    }
                  }}
                />
              </label>
              {localProps.bgImage && (
                <button className="small-btn" onClick={() => updateAndCommit('bgImage', '')} style={{ color: '#ff5566', borderColor: '#ff5566' }}>clear</button>
              )}
              {localProps.bgImage?.startsWith('data:') && <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>local</span>}
            </div>
          </div>
        </div>
        {localProps.bgImage && (
          <div className="property-group">
            <label>FIT</label>
            <Selector value={localProps.bgImageFit || 'cover'} onChange={v => updateAndCommit('bgImageFit', v)} options={[{value:'cover',label:'Cover (crop to fill)'},{value:'contain',label:'Contain (fit inside)'},{value:'fill',label:'Fill (stretch to size)'},{value:'tile',label:'Tile (repeat)'}]} width="100%" />
          </div>
        )}

        <div className="property-divider" />
        <div className="property-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <label style={{ margin: 0 }}>SHOW CLOSE [X]</label>
          <input type="checkbox" checked={localProps.showClose||false} onChange={e => updateAndCommit('showClose', e.target.checked)} />
        </div>
        {localProps.showClose && (
          <div className="property-group">
            <label>CLOSE ACTION</label>
            <Selector value={localProps.closeNextScreenId||''} onChange={v => updateAndCommit('closeNextScreenId', v)} options={[{value:'',label:'-- Select --'},{value:'__close_window__',label:'Close Window'}, ...(screens||[]).map(s => ({value:s.id,label:s.name}))]} width="100%" />
          </div>
        )}
      </>);
      case 'Row': return (<>
        <div className="al-section-title">FONDO</div>
        {renderColor('COLOR','bgColor','#000000', true)}
        <div className="property-divider" />
        <div className="al-section-title">IMAGE</div>
        <div className="property-group">
          <label>URL</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              type="text"
              value={localProps.bgImage || ''}
              onChange={e => updateAndCommit('bgImage', e.target.value)}
              placeholder="https://… or paste data URL"
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label className="upload-file-label">
                Upload File
                <input
                  type="file"
                  style={{ display: 'none' }}
                  accept="image/*"
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const { url } = await uploadAsset(file, 'image');
                      updateAndCommit('bgImage', url);
                    } catch {
                      const reader = new FileReader();
                      reader.onload = (ev) => updateAndCommit('bgImage', ev.target.result);
                      reader.readAsDataURL(file);
                    }
                  }}
                />
              </label>
              {localProps.bgImage && (
                <button className="small-btn" onClick={() => updateAndCommit('bgImage', '')} style={{ color: '#ff5566', borderColor: '#ff5566' }}>clear</button>
              )}
              {localProps.bgImage?.startsWith('data:') && <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>local</span>}
            </div>
          </div>
        </div>
        {localProps.bgImage && (
          <div className="property-group">
            <label>FIT</label>
            <Selector value={localProps.bgImageFit || 'cover'} onChange={v => updateAndCommit('bgImageFit', v)} options={[{value:'cover',label:'Cover (crop to fill)'},{value:'contain',label:'Contain (fit inside)'},{value:'fill',label:'Fill (stretch to size)'},{value:'tile',label:'Tile (repeat)'}]} width="100%" />
          </div>
        )}
      </>);
      case 'Frame': return (<>
        <div className="property-group"><label>TITLE</label><input type="text" value={localProps.title||''} onChange={e => updateAndCommit('title', e.target.value)} /></div>
        {renderNumber('width','WIDTH (px)','300')}
        {renderNumber('height','HEIGHT (px)','auto')}
        {renderNumber('fontSize','FONT SIZE (px)','12')}
        <div className="property-group"><label>ALIGNMENT</label>
          <Selector value={localProps.alignment||'left'} onChange={v => updateAndCommit('alignment', v)} options={[{value:'left',label:'Left'},{value:'center',label:'Center'},{value:'right',label:'Right'}]} width="100%" />
        </div>
        <div className="property-group"><label>BORDER STYLE</label>
          <Selector value={localProps.borderStyle||'single'} onChange={v => updateAndCommit('borderStyle', v)} options={[{value:'single',label:'Single'},{value:'double',label:'Double'},{value:'dashed',label:'Dashed'}]} width="100%" />
        </div>
        {renderColor('TEXT COLOR','textColor','#ffff00')}
        {renderColor('BACKGROUND','bgColor','#000000', true)}
        {renderColor('BORDER COLOR','borderColor','#00ff00')}
        <div className="property-divider" />
        {renderDataBinding()}
      </>);
      case 'Button': return (<>
        {localProps.action !== 'submit' && renderDataBinding()}
        <div className="property-group"><label>VARIANT</label>
          <Selector value={localProps.variant||'default'} onChange={v => updateAndCommit('variant', v)} options={[{value:'default',label:'Default'},{value:'primary',label:'Primary (outline)'},{value:'secondary',label:'Secondary (ghost)'},{value:'link',label:'Link (text only)'}]} width="100%" />
        </div>
        <div className="property-group"><label>TEXT</label><input type="text" value={localProps.text||''} onChange={e => updateAndCommit('text', e.target.value)} /></div>
        {renderNumber('width','WIDTH (px)','80')}
        <div className="property-group"><label>DISABLED</label><input type="checkbox" checked={localProps.disabled||false} onChange={e => updateAndCommit('disabled', e.target.checked)} /></div>
        {renderColor('TEXT COLOR','textColor','#00ff00')}
        {renderColor('BACKGROUND','bgColor','#000000', true)}
        {renderColor('BORDER COLOR','borderColor','#00ff00')}
        <div className="property-divider" />
        <div className="al-section-title">ICONS</div>
        {['Left', 'Right'].map(side => {
          const modeKey = `icon${side}Mode`;
          const srcKey = `icon${side}Src`;
          const urlKey = `icon${side}Url`;
          const mode = localProps[modeKey] || 'none';
          const previewSrc = localProps[urlKey] || localProps[srcKey] || '';
          const previewMaskUrl = previewSrc.includes('<svg')
            ? `data:image/svg+xml,${previewSrc.replace(/"/g, "'").replace(/#/g, '%23').replace(/[\n\r]/g, '').replace(/\s+/g, ' ')}`
            : previewSrc;
          return (
            <div className="property-group" key={side}>
              <label>{side.toUpperCase()} ICON</label>
              <Selector
                value={mode}
                onChange={v => updateAndCommit(modeKey, v)}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'picker', label: 'Icon Picker' },
                  { value: 'url', label: 'URL' },
                ]}
                width="100%"
              />
              {mode === 'picker' && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                  <button
                    onClick={() => { setIconPickerTarget(side); setShowIconPicker(true); }}
                    style={{ flex: 1, background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)', padding: '6px', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer' }}
                  >
                    {localProps[srcKey] ? 'Change Icon' : 'Browse Icons'}
                  </button>
                  {localProps[srcKey] && <button className="small-btn" onClick={() => updateAndCommit(srcKey, '')}>clear</button>}
                </div>
              )}
              {mode === 'url' && (
                <input
                  type="text"
                  value={localProps[urlKey] || ''}
                  onChange={e => updateAndCommit(urlKey, e.target.value)}
                  placeholder="https://... or /img/icon.svg"
                />
              )}
              {mode !== 'none' && (localProps[srcKey] || localProps[urlKey]) && (
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      backgroundColor: 'var(--text)',
                      maskImage: `url("${previewMaskUrl}")`,
                      WebkitMaskImage: `url("${previewMaskUrl}")`,
                      maskRepeat: 'no-repeat',
                      WebkitMaskRepeat: 'no-repeat',
                      maskPosition: 'center',
                      WebkitMaskPosition: 'center',
                      maskSize: 'contain',
                      WebkitMaskSize: 'contain',
                    }}
                  />
                  <span style={{ fontSize: 9, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(previewSrc || '').slice(0, 40)}
                  </span>
                </div>
              )}
            </div>
          );
        })}
        <div className="property-divider" />
        <div className="property-group"><label>ACTION</label>
          <Selector value={localProps.action||'none'} onChange={v => updateAndCommit('action', v)} options={[{value:'none',label:'None'},{value:'screen',label:'Navigate to Screen'}, ...(activeScreen?.kind === 'world' ? [{value:'level',label:'Go to Level'}] : []), {value:'overlay',label:'Open Overlay'},{value:'external',label:'Open External Link'},{value:'email',label:'Send Email'},{value:'submit',label:'Submit Form (Save to DB)'}]} width="100%" />
        </div>
        {localProps.action === 'screen' && (<>
          <div className="property-group"><label>TARGET SCREEN</label>
            <Selector value={localProps.targetScreenId||''} onChange={v => updateAndCommit('targetScreenId', v)} options={[{value:'',label:'-- Select Screen --'}, ...(screens||[]).map(s => ({value:s.id,label:s.name}))]} width="100%" />
          </div>
          <div className="property-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <label style={{ margin: 0 }}>STAGGERED (overlay)</label>
            <input type="checkbox" checked={localProps.staggered||false} onChange={e => updateAndCommit('staggered', e.target.checked)} />
          </div>
        </>)}
        {localProps.action === 'level' && (
          <div className="property-group"><label>TARGET LEVEL</label>
            <Selector value={localProps.targetLevelId||''} onChange={v => updateAndCommit('targetLevelId', v)} options={[{value:'',label:'-- Select Level --'}, ...(screens||[]).filter(s => s.kind === 'world').flatMap(s => (s.levels||[]).map(l => ({value:l.id,label:`${s.name} · ${l.name}`})))]} width="100%" />
          </div>
        )}
        {localProps.action === 'overlay' && (
          <div className="property-group"><label>TARGET OVERLAY</label>
            <Selector value={localProps.targetOverlayId||''} onChange={v => updateAndCommit('targetOverlayId', v)} options={[{value:'',label:'-- Select Overlay --'}, ...(overlays||[]).map(ov => ({value:ov.id,label:ov.props?.title || 'Overlay'}))]} width="100%" />
          </div>
        )}
        {localProps.action === 'external' && (
          <div className="property-group"><label>URL</label><input type="text" value={localProps.href||''} onChange={e => updateAndCommit('href', e.target.value)} placeholder="https://..." /></div>
        )}
        {localProps.action === 'email' && (
          <div className="property-group"><label>EMAIL</label><input type="text" value={localProps.mailto||''} onChange={e => updateAndCommit('mailto', e.target.value)} placeholder="user@example.com" /></div>
        )}
        {renderComponentSoundSettings(['hover', 'click', 'swipe'])}
        {showIconPicker && iconPickerTarget && (
          <IconPicker
            currentIcon=""
            onSelect={(filename, svg) => {
              updateAndCommit(`icon${iconPickerTarget}Mode`, 'picker');
              updateAndCommit(`icon${iconPickerTarget}Src`, svg);
              updateAndCommit(`icon${iconPickerTarget}Url`, '');
              setShowIconPicker(false);
              setIconPickerTarget(null);
            }}
            onClose={() => { setShowIconPicker(false); setIconPickerTarget(null); }}
          />
        )}
      </>);
      case 'Form': {
        const tableNames = Object.keys(database?.data || {});
        const selectedSourceTable = localProps.sourceTable || '';
        const sourceFields = (database?.tables || []).find(t => t.name === selectedSourceTable)?.fields || [];
        
        return (<>
          <div className="al-section-title">DATA SOURCE (Read)</div>
          <div className="property-group">
            <label>SOURCE TABLE</label>
            <Selector value={localProps.sourceTable || ''} onChange={v => updateAndCommit('sourceTable', v)} options={[{value:'',label:'-- None --'}, ...tableNames.map(t => ({value:t,label:t}))]} width="100%" />
          </div>
          {localProps.sourceTable && (
            <div className="property-group">
              <label>FILTER BY FIELD</label>
              <Selector value={localProps.filterField || ''} onChange={v => updateAndCommit('filterField', v)} options={[{value:'',label:'-- No Filter --'}, ...sourceFields.map(f => ({value:f.name,label:f.name}))]} width="100%" />
            </div>
          )}
          {localProps.sourceTable && localProps.filterField && (
          <div className="property-group">
            <label>FILTER VALUE</label>
            <FilterValueInput
              value={localProps.filterValue || ''}
              onCommit={value => updateAndCommit('filterValue', value)}
              placeholder="Value or {{template}}"
            />
          </div>
        )}
          <div className="property-divider" />
          <div className="al-section-title">TARGET (Write)</div>
          <div className="property-group">
            <label>TARGET TABLE (Save to)</label>
            <Selector value={localProps.targetTable || ''} onChange={v => updateAndCommit('targetTable', v)} options={[{value:'',label:'-- Select Table --'}, ...tableNames.map(t => ({value:t,label:t}))]} width="100%" searchable />
          </div>
          <div className="property-divider" />
        </>);
      }

      case 'Text':
      case 'Label': {
        const wrapSelection = (tag) => {
          const editor = document.querySelector('.canvas-text-editor');
          if (editor) {
            // Buttons use onMouseDown preventDefault to keep focus on the editor.
            // execCommand applies formatting to the current selection in the focused contentEditable.
            const cmdMap = { b: 'bold', i: 'italic', u: 'underline', s: 'strikeThrough', sup: 'superscript', sub: 'subscript' };
            const cmd = cmdMap[tag];
            if (cmd) document.execCommand(cmd, false, null);
          } else {
            // Fallback: wrap entire text when not in inline edit mode
            const val = localProps.text || '';
            updateAndCommit('text', `[${tag}]${val}[/${tag}]`);
          }
        };

        return (<>
          {renderDataBinding()}
          <div className="property-group" style={{ flexDirection: 'column', gap: 4 }}>
            <label style={{ color: 'var(--text-dim)', fontSize: 9, letterSpacing: 1 }}>TEXT — double-click on canvas to edit</label>
            <div className="text-tools" style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <button title="Bold" onMouseDown={e => e.preventDefault()} onClick={() => wrapSelection('b')}><b>B</b></button>
              <button title="Italic" onMouseDown={e => e.preventDefault()} onClick={() => wrapSelection('i')}><i>I</i></button>
              <button title="Underline" onMouseDown={e => e.preventDefault()} onClick={() => wrapSelection('u')}><u>U</u></button>
              <button title="Strike" onMouseDown={e => e.preventDefault()} onClick={() => wrapSelection('s')}><s>S</s></button>
              <button title="Superscript" onMouseDown={e => e.preventDefault()} onClick={() => wrapSelection('sup')}>x²</button>
              <button title="Subscript" onMouseDown={e => e.preventDefault()} onClick={() => wrapSelection('sub')}>x₂</button>
            </div>
          </div>
          {renderNumber('fontSize','FONT SIZE (px)','12')}
          <div className="property-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <label style={{ margin: 0 }}>BLINK CARET</label>
            <input type="checkbox" checked={!!localProps.showCaret} onChange={e => updateAndCommit('showCaret', e.target.checked)} />
          </div>
          <div className="property-group"><label>ALIGNMENT</label>
            <Selector value={localProps.alignment||'left'} onChange={v => updateAndCommit('alignment', v)} options={[{value:'left',label:'Left'},{value:'center',label:'Center'},{value:'right',label:'Right'}]} width="100%" />
          </div>
          {renderColor('TEXT COLOR','textColor','#00ff00')}
          <div className="property-divider" />
          <div className="property-group"><label>ACTION</label>
            <Selector value={localProps.action||'none'} onChange={v => updateAndCommit('action', v)} options={[{value:'none',label:'None'},{value:'screen',label:'Navigate to Screen'},{value:'overlay',label:'Open Overlay'},{value:'external',label:'Open External Link'},{value:'email',label:'Send Email'}, ...(activeScreen?.kind === 'world' ? [{value:'level',label:'Go to Level'}] : [])]} width="100%" />
          </div>
          {localProps.action === 'screen' && (<>
            <div className="property-group"><label>TARGET SCREEN</label>
              <Selector value={localProps.targetScreenId||''} onChange={v => updateAndCommit('targetScreenId', v)} options={[{value:'',label:'-- Select Screen --'}, ...(screens||[]).map(s => ({value:s.id,label:s.name}))]} width="100%" />
            </div>
            <div className="property-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <label style={{ margin: 0 }}>STAGGERED (overlay)</label>
              <input type="checkbox" checked={localProps.staggered||false} onChange={e => updateAndCommit('staggered', e.target.checked)} />
            </div>
          </>)}
          {localProps.action === 'overlay' && (
            <div className="property-group"><label>TARGET OVERLAY</label>
              <Selector value={localProps.targetOverlayId||''} onChange={v => updateAndCommit('targetOverlayId', v)} options={[{value:'',label:'-- Select Overlay --'}, ...(overlays||[]).map(ov => ({value:ov.id,label:ov.props?.title || 'Overlay'}))]} width="100%" />
            </div>
          )}
          {localProps.action === 'external' && (
            <div className="property-group"><label>URL</label><input type="text" value={localProps.href||''} onChange={e => updateAndCommit('href', e.target.value)} placeholder="https://..." /></div>
          )}
          {localProps.action === 'email' && (
            <div className="property-group"><label>EMAIL</label><input type="text" value={localProps.mailto||''} onChange={e => updateAndCommit('mailto', e.target.value)} placeholder="user@example.com" /></div>
          )}
          {localProps.action === 'level' && (
            <div className="property-group"><label>TARGET LEVEL</label>
              <Selector value={localProps.targetLevelId||''} onChange={v => updateAndCommit('targetLevelId', v)} options={[{value:'',label:'-- Select Level --'}, ...(screens||[]).filter(s => s.kind === 'world').flatMap(s => (s.levels||[]).map(l => ({value:l.id,label:`${s.name} · ${l.name}`})))]} width="100%" />
            </div>
          )}
          {activeScreen?.kind === 'world' && (<>
            <div className="property-divider" />
            <div className="al-section-title">GAME BINDING</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6 }}>
              Show a live game value. Use <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{'{value}'}</span> in your text as the placeholder.
            </div>
            <div className="property-group">
              <label>BIND TO</label>
              <Selector
                value={localProps.bindTo || ''}
                onChange={v => updateAndCommit('bindTo', v || undefined)}
                options={[
                  { value: '',        label: 'None (static text)' },
                  { value: 'score',   label: 'Score' },
                  { value: 'lives',   label: 'Lives' },
                  { value: 'coins',   label: 'Coins' },
                  { value: 'timer',   label: 'Timer (MM:SS)' },
                  { value: 'xp',      label: 'XP (current)' },
                  { value: 'xpLevel', label: 'XP Level' },
                  { value: 'wave',    label: 'Wave number' },
                ]}
                width="100%"
              />
            </div>
          </>)}
          {renderComponentSoundSettings(['hover', 'click', 'swipe'])}
        </>);
      }
      case 'Input':
      case 'TextBox': return (<>
        <div className="property-group"><label>LABEL</label><input type="text" value={localProps.label||''} onChange={e => updateAndCommit('label', e.target.value)} placeholder="e.g. USERNAME" /></div>
        <div className="property-group"><label>PLACEHOLDER</label><input type="text" value={localProps.placeholder||''} onChange={e => updateAndCommit('placeholder', e.target.value)} /></div>
        {renderDataBinding()}
        <div className="property-divider" />
        {renderNumber('width','WIDTH (px)','150')}
        <div className="property-group"><label>INPUT TYPE</label>
          <Selector value={localProps.inputType||'text'} onChange={v => updateAndCommit('inputType', v)} options={[{value:'text',label:'Text'},{value:'password',label:'Password'},{value:'number',label:'Number'},{value:'email',label:'Email'}]} width="100%" />
        </div>
        <div className="property-divider" />
        <div className="property-group"><label>OTP MODE</label><input type="checkbox" checked={localProps.isOTP||false} onChange={e => updateAndCommit('isOTP', e.target.checked)} /></div>
        {localProps.isOTP && (
          <div className="property-group"><label>DIGITS</label>
            <Selector value={String(localProps.digits||4)} onChange={v => updateAndCommit('digits', parseInt(v))} options={[{value:'4',label:'4 Digits'},{value:'6',label:'6 Digits'}]} width="100%" />
          </div>
        )}
        <div className="property-divider" />
        <div className="property-group"><label>READ ONLY</label><input type="checkbox" checked={localProps.readOnly||false} onChange={e => updateAndCommit('readOnly', e.target.checked)} /></div>
        <div className="property-group"><label>DISABLED</label><input type="checkbox" checked={localProps.disabled||false} onChange={e => updateAndCommit('disabled', e.target.checked)} /></div>
        {renderColor('TEXT COLOR','textColor','#00ff00')}
        {renderColor('BORDER COLOR','borderColor','#00ff00')}
        {renderColor('BACKGROUND','bgColor','#000000')}
      </>);
      case 'CheckBox': return (<>
        <div className="property-group"><label>TEXT</label><input type="text" value={localProps.text||''} onChange={e => updateAndCommit('text', e.target.value)} /></div>
        {renderDataBinding()}
        <div className="property-group"><label>CHECKED (Static)</label><input type="checkbox" checked={localProps.checked||false} onChange={e => updateAndCommit('checked', e.target.checked)} /></div>
        {renderColor('TEXT COLOR','textColor','#00ff00')}
      </>);
      case 'RadioButton': return (<>
        <div className="property-group"><label>TEXT</label><input type="text" value={localProps.text||''} onChange={e => updateAndCommit('text', e.target.value)} /></div>
        <div className="property-group"><label>GROUP</label><input type="text" value={localProps.group||'group1'} onChange={e => updateAndCommit('group', e.target.value)} /></div>
        {renderDataBinding()}
        <div className="property-group"><label>CHECKED (Static)</label><input type="checkbox" checked={localProps.checked||false} onChange={e => updateAndCommit('checked', e.target.checked)} /></div>
        {renderColor('TEXT COLOR','textColor','#00ff00')}
      </>);
      case 'Shape': return (<>
        <div className="property-group"><label>SHAPE</label>
          <Selector value={localProps.shapeType||'rectangle'} onChange={v => updateAndCommit('shapeType', v)} options={[{value:'rectangle',label:'Rectangle'},{value:'circle',label:'Circle'},{value:'square',label:'Square'}]} width="100%" />
        </div>
        {renderNumber('width','WIDTH (px)','60')}
        {renderNumber('height','HEIGHT (px)','40')}
        <div className="property-group"><label>FILL</label><input type="checkbox" checked={localProps.fill||false} onChange={e => updateAndCommit('fill', e.target.checked)} /></div>
        {renderColor('BORDER COLOR','borderColor','#00ff00')}
        {renderColor('FILL COLOR','bgColor','#000000', true)}
      </>);
      case 'Line': return (<>
        {renderNumber('thickness','THICKNESS (px)','1')}
        <div className="property-group"><label>LINE STYLE</label>
          <Selector value={localProps.lineStyle||'solid'} onChange={v => updateAndCommit('lineStyle', v)} options={[{value:'solid',label:'Solid'},{value:'double',label:'Double'},{value:'dashed',label:'Dashed'}]} width="100%" />
        </div>
        {renderColor('COLOR','color','#00ff00')}
      </>);
      case 'Image': return (<>
        {renderDataBinding()}
        <div className="property-group" style={{ opacity: localProps.dataSourceType === 'database' ? 0.4 : 1, pointerEvents: localProps.dataSourceType === 'database' ? 'none' : 'auto' }}>
          <label>IMAGE SOURCE {localProps.dataSourceType === 'database' && '(Overridden by DB)'}</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input type="text" value={localProps.src||''} onChange={e => updateAndCommit('src', e.target.value)} placeholder="https://..." />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label className="upload-file-label">
                Upload File
                <input 
                  type="file" 
                  style={{ display: 'none' }} 
                  accept="image/*,.gif"
                  onChange={async e => {
                    const file = e.target.files[0];
                    if (!file) return;
                    let src;
                    try {
                      const { url } = await uploadAsset(file, 'image');
                      src = url;
                    } catch {
                      src = await new Promise((res, rej) => {
                        const r = new FileReader();
                        r.onload = () => res(r.result);
                        r.onerror = rej;
                        r.readAsDataURL(file);
                      });
                    }
                    updateAndCommit('src', src);
                    const img = new window.Image();
                    img.onload = () => {
                      if (img.width > 4 && img.height > 4) {
                        updateAndCommit('aspectRatio', img.width / img.height);
                        updateAndCommit('width', img.width);
                        updateAndCommit('height', img.height);
                      }
                    };
                    img.src = src;
                  }}
                />
              </label>
              {localProps.src?.startsWith('data:') && <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>local</span>}
            </div>
          </div>
        </div>
        {renderNumber('width','WIDTH (px)','80', (newVal) => {
          if (localProps.keepAspect && localProps.aspectRatio) {
            const newHeight = Math.round(newVal / localProps.aspectRatio);
            updateAndCommit('height', newHeight);
          }
        })}
        {renderNumber('height','HEIGHT (px)','80', (newVal) => {
          if (localProps.keepAspect && localProps.aspectRatio) {
            const newWidth = Math.round(newVal * localProps.aspectRatio);
            updateAndCommit('width', newWidth);
          }
        })}
        
        {component.props.sizing?.widthMode === 'fixed' && component.props.sizing?.heightMode === 'fixed' && (
          <div className="property-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <label style={{ margin: 0 }}>KEEP ASPECT</label>
            <input 
              type="checkbox" 
              checked={localProps.keepAspect||false} 
              onChange={e => {
                const checked = e.target.checked;
                updateAndCommit('keepAspect', checked);
                if (checked && localProps.width && localProps.height && !localProps.aspectRatio) {
                  updateAndCommit('aspectRatio', localProps.width / localProps.height);
                }
              }} 
            />
          </div>
        )}

        <div className="property-group"><label>ALT TEXT</label><input type="text" value={localProps.alt||''} onChange={e => updateAndCommit('alt', e.target.value)} /></div>
        {gameMode && (<>
          <div className="property-divider" />
          <div className="al-section-title">RESPONSIVE SOURCES</div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 6 }}>Override the default image based on device orientation.</div>
          <div className="property-group">
            <label>PORTRAIT SOURCE</label>
            <input type="text" value={localProps.srcPortrait||''} onChange={e => updateAndCommit('srcPortrait', e.target.value)} placeholder="URL for portrait…" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <label className="upload-file-label">
                Upload Portrait
                <input type="file" style={{ display: 'none' }} accept="image/*,.gif"
                  onChange={async e => {
                    const file = e.target.files[0]; if (!file) return;
                    let src;
                    try { const { url } = await uploadAsset(file, 'image'); src = url; }
                    catch { src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
                    updateAndCommit('srcPortrait', src);
                  }}
                />
              </label>
              {localProps.srcPortrait && <button className="small-btn" onClick={() => updateAndCommit('srcPortrait', '')} style={{ color: '#ff5566', borderColor: '#ff5566' }}>clear</button>}
            </div>
          </div>
          <div className="property-group">
            <label>LANDSCAPE SOURCE</label>
            <input type="text" value={localProps.srcLandscape||''} onChange={e => updateAndCommit('srcLandscape', e.target.value)} placeholder="URL for landscape…" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <label className="upload-file-label">
                Upload Landscape
                <input type="file" style={{ display: 'none' }} accept="image/*,.gif"
                  onChange={async e => {
                    const file = e.target.files[0]; if (!file) return;
                    let src;
                    try { const { url } = await uploadAsset(file, 'image'); src = url; }
                    catch { src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
                    updateAndCommit('srcLandscape', src);
                  }}
                />
              </label>
              {localProps.srcLandscape && <button className="small-btn" onClick={() => updateAndCommit('srcLandscape', '')} style={{ color: '#ff5566', borderColor: '#ff5566' }}>clear</button>}
            </div>
          </div>
        </>)}
        {renderNumber('borderThickness', 'BORDER', '1')}
        {renderColor('BORDER COLOR', 'borderColor', '')}
        <div className="property-divider" />
        <div className="al-section-title">ICON LIBRARY</div>
        {localProps.iconSrc && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div dangerouslySetInnerHTML={{ __html: localProps.iconSrc }} style={{ width: 24, height: 24, color: localProps.iconColor || '#00ff00' }} />
            <button onClick={() => { updateAndCommit('iconSrc', ''); }} style={{ background: 'none', border: '1px solid #ff6666', color: '#ff6666', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, padding: '2px 6px' }}>Clear</button>
          </div>
        )}
        {renderColor('ICON COLOR', 'iconColor', '#00ff00')}
        <button onClick={() => setShowIconPicker(true)} style={{ width: '100%', background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)', padding: '6px', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', marginTop: 4 }}>
          {localProps.iconSrc ? 'Change Icon' : 'Browse Icons'}
        </button>
        {showIconPicker && !iconPickerTarget && (
          <IconPicker
            currentIcon=""
            onSelect={(filename, svg) => { updateAndCommit('iconSrc', svg); setShowIconPicker(false); }}
            onClose={() => setShowIconPicker(false)}
          />
        )}
      </>);
      case 'Timer': return (<>
        {renderNumber('interval','INTERVAL (ms)','1000')}
        <div className="property-group"><label>ENABLED</label><input type="checkbox" checked={localProps.enabled||false} onChange={e => updateAndCommit('enabled', e.target.checked)} /></div>
      </>);
      case 'Selector':
      case 'ComboBox': return (<>
        <div className="al-section-title">OPTIONS SOURCE</div>
        {!localProps.optionTable && (
          <div className="property-group">
            <label>OPTIONS (comma separated)</label>
            <input
              type="text"
              value={(localProps.items || ['Option 1', 'Option 2', 'Option 3']).join(', ')}
              onChange={e => updateAndCommit('items', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
              placeholder="Option 1, Option 2, Option 3"
            />
          </div>
        )}
        <div className="property-group">
          <label>SOURCE TABLE</label>
          <Selector value={localProps.optionTable||''} onChange={v => updateAndCommit('optionTable', v)} options={[{value:'',label:'-- Manual (above) --'}, ...Object.keys(database?.data||{}).map(t => ({value:t,label:t}))]} width="100%" searchable />
        </div>
        {localProps.optionTable && (
          <div className="property-group">
            <label>DISPLAY FIELD</label>
            <Selector value={localProps.optionField||''} onChange={v => updateAndCommit('optionField', v)} options={[{value:'',label:'-- Select Field --'}, ...((database?.tables||[]).find(t => t.name === localProps.optionTable)?.fields||[]).map(f => ({value:f.name,label:f.name}))]} width="100%" searchable />
          </div>
        )}
        {localProps.optionTable && (
          <>
            <div className="property-group">
              <label>FILTER BY FIELD</label>
              <Selector value={localProps.optionFilterField||''} onChange={v => updateAndCommit('optionFilterField', v)} options={[{value:'',label:'-- No Filter --'}, ...((database?.tables||[]).find(t => t.name === localProps.optionTable)?.fields||[]).map(f => ({value:f.name,label:f.name}))]} width="100%" searchable />
            </div>
            {localProps.optionFilterField && (
              <div className="property-group">
                <label>FILTER VALUE</label>
                <FilterValueInput
                  value={localProps.optionFilterValue || ''}
                  onCommit={value => updateAndCommit('optionFilterValue', value)}
                  placeholder="e.g. active or {{id}}"
                />
              </div>
            )}
          </>
        )}
        <div className="property-divider" />
        {renderDataBinding()}
        <div className="property-divider" />
        {renderNumber('width','WIDTH (px)','150')}
        <div className="property-group"><label>SELECTED INDEX</label><input type="text" inputMode="numeric" value={localProps.selectedIndex ?? ''} onChange={e => updateLocal('selectedIndex', e.target.value)} onBlur={() => { const n = parseInt(localProps.selectedIndex, 10); updateAndCommit('selectedIndex', isNaN(n) ? 0 : n); }} /></div>
        {renderColor('TEXT COLOR','textColor','#00ff00')}
        {renderColor('BORDER COLOR','borderColor','#00ff00')}
        {renderColor('BACKGROUND','bgColor','#000000', true)}
      </>);
      case 'ListBox': return (<>
        <div className="al-section-title">OPTIONS SOURCE (The List)</div>
        <div className="property-group">
          <label>SOURCE TABLE</label>
          <Selector value={localProps.optionTable||''} onChange={v => updateAndCommit('optionTable', v)} options={[{value:'',label:'-- Select Table --'}, ...Object.keys(database?.data||{}).map(t => ({value:t,label:t}))]} width="100%" searchable />
        </div>
        {localProps.optionTable && (
          <div className="property-group">
            <label>DISPLAY FIELD</label>
            <Selector value={localProps.optionField||''} onChange={v => updateAndCommit('optionField', v)} options={[{value:'',label:'-- Select Field --'}, ...((database?.tables||[]).find(t => t.name === localProps.optionTable)?.fields||[]).map(f => ({value:f.name,label:f.name}))]} width="100%" searchable />
          </div>
        )}
        {localProps.optionTable && (
          <>
            <div className="property-group">
              <label>FILTER BY FIELD</label>
              <Selector value={localProps.optionFilterField||''} onChange={v => updateAndCommit('optionFilterField', v)} options={[{value:'',label:'-- No Filter --'}, ...((database?.tables||[]).find(t => t.name === localProps.optionTable)?.fields||[]).map(f => ({value:f.name,label:f.name}))]} width="100%" searchable />
            </div>
            {localProps.optionFilterField && (
              <div className="property-group">
                <label>FILTER VALUE</label>
                <FilterValueInput
                  value={localProps.optionFilterValue || ''}
                  onCommit={value => updateAndCommit('optionFilterValue', value)}
                  placeholder="e.g. active or {{id}}"
                />
              </div>
            )}
          </>
        )}
        <div className="property-divider" />
        {renderDataBinding()}
        <div className="property-divider" />
        {renderNumber('width','WIDTH (px)','150')}
        {renderNumber('height','HEIGHT (px)','100')}
        <div className="property-group"><label>MULTI-SELECT</label><input type="checkbox" checked={localProps.multiSelect||false} onChange={e => updateAndCommit('multiSelect', e.target.checked)} /></div>
        {renderColor('TEXT COLOR','textColor','#00ff00')}
        {renderColor('BORDER COLOR','borderColor','#00ff00')}
        {renderColor('BACKGROUND','bgColor','#000000', true)}
      </>);
      case 'Table': return (<>
        {renderNumber('width','WIDTH (px)','400')}
        {renderNumber('height','HEIGHT (px)','200')}
        <div className="property-group"><label>SHOW HEADERS</label><input type="checkbox" checked={localProps.showHeaders!==false} onChange={e => updateAndCommit('showHeaders', e.target.checked)} /></div>
        <div className="property-group"><label>STRIPED ROWS</label><input type="checkbox" checked={localProps.stripedRows!==false} onChange={e => updateAndCommit('stripedRows', e.target.checked)} /></div>
        {renderColor('TEXT COLOR','textColor','#00ff00')}
        {renderColor('BORDER COLOR','borderColor','#00ff00')}
        {renderColor('HEADER BG','headerBgColor','#003300')}
        <div className="property-divider" />
        <div className="al-section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
          DATA SOURCE
          <button onClick={() => window.openDatabasePanel?.()} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 9, cursor: 'pointer', textDecoration: 'underline' }}>Manage Data</button>
        </div>
        <div className="property-group"><label>SOURCE TYPE</label>
          <Selector value={localProps.dataSourceType||'manual'} onChange={v => updateAndCommit('dataSourceType', v)} options={[{value:'manual',label:'Manual'},{value:'database',label:'Database Table'}]} width="100%" />
        </div>
        {localProps.dataSourceType === 'database' && (database?.tables||[]).length > 0 && (
          <div className="property-group"><label>TABLE</label>
            <Selector value={localProps.dataSource||''} onChange={v => updateAndCommit('dataSource', v)} options={[{value:'',label:'-- Select --'}, ...(database.tables||[]).map(t => ({value:t.name,label:t.name}))]} width="100%" searchable />
          </div>
        )}
        <div className="property-divider" />
        <div className="al-section-title">COLUMNS</div>
        {(localProps.columns||[]).map((col, ci) => (
          <div key={ci} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
            <input type="text" value={col.name} style={{ flex: 1, fontSize: 10 }}
              onChange={e => { const cols = [...(localProps.columns||[])]; cols[ci] = { ...cols[ci], name: e.target.value }; updateAndCommit('columns', cols); }} />
            <input type="text" inputMode="numeric" value={col.width ?? 80} style={{ width: 50, fontSize: 10 }}
              onChange={e => { 
                const cols = [...(localProps.columns||[])]; 
                cols[ci] = { ...cols[ci], width: e.target.value }; 
                updateAndCommit('columns', cols); 
              }} 
              onBlur={e => {
                const n = parseInt(e.target.value, 10);
                const cols = [...(localProps.columns||[])];
                cols[ci] = { ...cols[ci], width: isNaN(n) ? 80 : n };
                updateAndCommit('columns', cols);
              }}
            />
            <button onClick={() => { const cols = (localProps.columns||[]).filter((_,i)=>i!==ci); updateAndCommit('columns', cols); }}
              style={{ background: 'none', border: 'none', color: '#ff6666', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>×</button>
          </div>
        ))}
        <button onClick={() => { const cols = [...(localProps.columns||[]), { name: `Col${(localProps.columns||[]).length+1}`, type: 'text', width: 80 }]; updateAndCommit('columns', cols); }}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, padding: '3px 8px', width: '100%' }}>+ Add Column</button>
        <div className="al-section-title">ROWS ({(localProps.rows||[]).length})</div>
        {(localProps.rows||[]).map((row, ri) => (
          <div key={ri} style={{ border: '1px solid var(--border)', padding: 4, marginBottom: 4, fontSize: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: 'var(--text-dim)' }}>Row {ri+1}</span>
              <button onClick={() => { updateAndCommit('rows', (localProps.rows||[]).filter((_,i)=>i!==ri)); }}
                style={{ background: 'none', border: 'none', color: '#ff6666', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10 }}>×</button>
            </div>
            {(localProps.columns||[]).map((col, ci) => (
              <input key={ci} type="text" value={String(row[col.name]??'')} placeholder={col.name}
                style={{ width: '100%', marginBottom: 2, fontSize: 10 }}
                onChange={e => { const rows = [...(localProps.rows||[])]; rows[ri] = { ...rows[ri], [col.name]: e.target.value }; updateAndCommit('rows', rows); }} />
            ))}
          </div>
        ))}
        <button onClick={() => { const newRow = {}; (localProps.columns||[]).forEach(c => { newRow[c.name] = ''; }); updateAndCommit('rows', [...(localProps.rows||[]), newRow]); }}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, padding: '3px 8px', width: '100%', marginTop: 4 }}>+ Add Row</button>
      </>);
      case 'DataRepeater': {
        const selectedTable = localProps.tableName || '';
        const fields = (database?.tables || []).find(t => t.name === selectedTable)?.fields || [];
        return (<>
          <div className="al-section-title">DATA SOURCE</div>
          <div className="property-group">
            <label>TABLE</label>
            <Selector value={localProps.tableName||''} onChange={v => updateAndCommit('tableName', v)} options={[{value:'',label:'-- Select Table --'}, ...(database?.tables||[]).map(t => ({value:t.name,label:t.name}))]} width="100%" searchable />
          </div>
          <div className="property-group">
            <label>FILTER BY FIELD</label>
            <Selector value={localProps.filterField || ''} onChange={v => updateAndCommit('filterField', v)} options={[{value:'',label:'-- No Filter --'}, ...fields.map(f => ({value:f.name,label:f.name}))]} width="100%" />
          </div>
          {localProps.filterField && (
            <div className="property-group">
              <label>FILTER VALUE</label>
              <FilterValueInput
                value={localProps.filterValue || ''}
                onCommit={value => updateAndCommit('filterValue', value)}
                placeholder="Value or {{template}}"
              />
            </div>
          )}
          <div className="property-divider" />
        
        <AutoLayoutPanel
          layout={localProps.layout || {}}
          onUpdate={(changes) => onUpdate(component.id, { layout: { ...(localProps.layout || {}), ...changes } })}
        />
      </>);
    }
      case 'Data': return (<>
        <div className="property-group"><label>TABLE</label>
          <Selector
            value={localProps.tableName || ''}
            onChange={v => updateAndCommit('tableName', v)}
            options={[{value:'',label:'-- Select Table --'}, ...(database?.tables||[]).map(t => ({value:t.name,label:t.name}))]}
            width="100%"
            searchable
          />
        </div>
        <div className="property-group"><label>SOURCE</label>
          <Selector value={localProps.dataSource||'sqlite'} onChange={v => updateAndCommit('dataSource', v)} options={[{value:'sqlite',label:'SQLite'},{value:'json',label:'JSON'},{value:'api',label:'API'}]} width="100%" />
        </div>
        <div className="property-group"><label>QUERY / PATH</label>
          <input type="text" value={localProps.query||''} onChange={e => updateAndCommit('query', e.target.value)} />
        </div>
      </>);
      case 'Loader': return (<>
        <div className="property-group"><label>TYPE</label>
          <Selector value={localProps.loaderType||'spinner'} onChange={v => updateAndCommit('loaderType', v)} options={[{value:'spinner',label:'Spinner'},{value:'dots',label:'Dots'},{value:'bar',label:'Bar'},{value:'bounce',label:'Bounce'}]} width="100%" />
        </div>
        {renderNumber('speed','SPEED (x)','1')}
        {renderNumber('thickness','THICKNESS','4')}
        {renderColor('COLOR','color','#00ff00')}
      </>);
      case 'Tabs': return (<>
        <div className="property-group">
          <label>TABS (comma separated)</label>
          <textarea 
            value={tabsText} 
            onChange={e => setTabsText(e.target.value)}
            onBlur={e => {
              const labels = e.target.value.split(',').map(s=>s.trim()).filter(Boolean);
              const newTabs = labels.map((l, i) => ({ 
                id: (localProps.tabs || [])[i]?.id || mkId(), 
                label: l 
              }));
              updateAndCommit('tabs', newTabs);
            }} 
            rows={3} 
          />
        </div>
        <div className="property-group"><label>ACTIVE TAB</label>
          <Selector value={String(localProps.activeTabIndex||0)} onChange={v => updateAndCommit('activeTabIndex', parseInt(v))} options={(localProps.tabs||[]).map((t, i) => ({value:String(i),label:t.label}))} width="100%" />
        </div>
      </>);
      case 'GradualBlur': return (<>
        <div className="property-group">
          <label>POSITION</label>
          <Selector value={localProps.position || 'bottom'} onChange={v => updateAndCommit('position', v)}
            options={[{value:'bottom',label:'Bottom'},{value:'top',label:'Top'},{value:'left',label:'Left'},{value:'right',label:'Right'}]} width="100%" />
        </div>
        <div className="property-group">
          <label>STRENGTH (px)</label>
          <input type="number" min={0} max={80} value={localProps.strength ?? 12}
            onChange={e => updateAndCommit('strength', Number(e.target.value))} />
        </div>
        <div className="property-group">
          <label>SIZE (px)</label>
          <input type="number" min={4} max={800} value={localProps.height ?? 200}
            onChange={e => updateAndCommit('height', Number(e.target.value))} />
        </div>
        <div className="property-group">
          <label>LAYERS</label>
          <input type="number" min={2} max={32} value={localProps.divCount ?? 16}
            onChange={e => updateAndCommit('divCount', Number(e.target.value))} />
        </div>
        <div className="property-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <label style={{ margin: 0 }}>EXPONENTIAL CURVE</label>
          <input type="checkbox" checked={localProps.exponential !== false}
            onChange={e => updateAndCommit('exponential', e.target.checked)} />
        </div>
        <div className="property-group">
          <label>OPACITY</label>
          <input type="range" min={0} max={1} step={0.05} value={localProps.opacity ?? 1}
            onChange={e => updateAndCommit('opacity', Number(e.target.value))} style={{ width: '100%' }} />
          <span style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 32, textAlign: 'right' }}>{((localProps.opacity ?? 1) * 100).toFixed(0)}%</span>
        </div>
        <div className="property-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <label style={{ margin: 0 }}>ANIMATED</label>
          <input type="checkbox" checked={!!localProps.animated}
            onChange={e => updateAndCommit('animated', e.target.checked)} />
        </div>
      </>);
      case 'Overlay': return (<>
        <div className="property-group"><label>TITLE</label><input type="text" value={localProps.title||''} onChange={e => updateAndCommit('title', e.target.value)} /></div>
        <div className="property-group"><label>IS OPEN (Editor)</label><input type="checkbox" checked={localProps.isOpen!==false} onChange={e => updateAndCommit('isOpen', e.target.checked)} /></div>
        {renderColor('MASK COLOR','bgColor','rgba(0,0,0,0.7)')}
        {renderColor('MODAL BG','modalBg','')}
        {renderColor('BORDER COLOR','borderColor','')}
      </>);
      case 'GameEmbed': {
        const worlds = (screens || []).filter(s => s.kind === 'world');
        return (<>
          <div className="property-group">
            <label>WORLD</label>
            <Selector value={localProps.worldId || ''} onChange={v => { const w = worlds.find(s => s.id === v); updateAndCommit('worldId', v); setTimeout(() => updateAndCommit('worldName', w?.name || ''), 0); }} options={[{value:'',label:'-- Select World --'}, ...worlds.map(w => ({value:w.id,label:w.name}))]} width="100%" />
          </div>
          <div className="property-group">
            <label>SCALING</label>
            <Selector value={localProps.scaling || 'fit'} onChange={v => updateAndCommit('scaling', v)} options={[{value:'fit',label:'Fit'},{value:'fill',label:'Fill'},{value:'fixed',label:'Fixed'}]} width="100%" />
          </div>
          {(localProps.scaling || 'fit') !== 'fixed' && (
            <div className="property-group">
              <label>MAINTAIN ASPECT</label>
              <input
                type="checkbox"
                checked={localProps.maintainAspect !== false}
                onChange={e => updateAndCommit('maintainAspect', e.target.checked)}
              />
            </div>
          )}
          <div className="property-group">
            <label>SHOW WINDOW</label>
            <RetroCheckbox
              checked={localProps.showWindow !== false}
              onChange={v => updateAndCommit('showWindow', v)}
            />
          </div>
          {localProps.showWindow !== false && (
            <div className="property-group">
              <label>WINDOW TITLE</label>
              <input
                type="text"
                value={localProps.windowTitle ?? ''}
                placeholder={localProps.worldName || 'World name'}
                onChange={e => updateAndCommit('windowTitle', e.target.value)}
              />
            </div>
          )}
          <div className="property-group">
            <label>SHOW CONTROLS</label>
            <input
              type="checkbox"
              checked={localProps.showControls !== false}
              onChange={e => updateAndCommit('showControls', e.target.checked)}
            />
          </div>
          {!localProps.worldId && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', padding: '6px 0', lineHeight: 1.5 }}>
              Select a world to embed. The game renders live — size it via the Sizing panel below.
            </div>
          )}
        </>);
      }
      default: return <div style={{ color: 'var(--text-dim)' }}>[ Properties not available ]</div>;
    }
  };

  // Sizing mode panel
  const sizing = component.props?.sizing;
  const renderSizingPanel = () => {
    if (!sizing) return null;
    return (
      <>
        <div className="property-divider" />
        <div className="al-section-title">SIZING</div>
        <div className="property-group">
          <label>WIDTH MODE</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <Selector value={sizing.widthMode || 'fixed'} onChange={v => onUpdate(component.id, { sizing: { ...sizing, widthMode: v } })} options={[{value:'fixed',label:'Fixed'},{value:'fill',label:'Fill Container'},{value:'hug',label:'Hug Contents'}]} containerStyle={{ flex: 1 }} />
            <input 
              type="text" 
              inputMode="numeric"
              value={localProps.width ?? component.props.width ?? ''} 
              disabled={sizing.widthMode !== 'fixed'}
              style={{ width: 55, opacity: sizing.widthMode !== 'fixed' ? 0.5 : 1 }}
              onChange={e => updateLocal('width', e.target.value)}
              onBlur={() => {
                const n = parseInt(localProps.width, 10);
                if (!isNaN(n)) commitChange('width', n);
                else updateLocal('width', component.props.width);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const n = parseInt(localProps.width, 10);
                  if (!isNaN(n)) commitChange('width', n);
                  e.target.blur();
                }
              }}
            />
          </div>
        </div>
        <div className="property-group">
          <label>HEIGHT MODE</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <Selector value={sizing.heightMode || 'hug'} onChange={v => onUpdate(component.id, { sizing: { ...sizing, heightMode: v } })} options={[{value:'fixed',label:'Fixed'},{value:'fill',label:'Fill Container'},{value:'hug',label:'Hug Contents'}]} containerStyle={{ flex: 1 }} />
            <input 
              type="text" 
              inputMode="numeric"
              value={localProps.height ?? component.props.height ?? ''} 
              disabled={sizing.heightMode !== 'fixed'}
              style={{ width: 55, opacity: sizing.heightMode !== 'fixed' ? 0.5 : 1 }}
              onChange={e => updateLocal('height', e.target.value)}
              onBlur={() => {
                const n = parseInt(localProps.height, 10);
                if (!isNaN(n)) commitChange('height', n);
                else updateLocal('height', component.props.height);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const n = parseInt(localProps.height, 10);
                  if (!isNaN(n)) commitChange('height', n);
                  e.target.blur();
                }
              }}
            />
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="inspector">
      <h3 {...tutorialHoverBindings('Inspector.Title', 'Inspector Title')}>
        [{(component.type || 'COMPONENT').toUpperCase()}]
      </h3>
      <div className="property-group">
        <label>ID</label>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', wordBreak: 'break-all' }}>{component.id}</div>
      </div>
      <div className="property-divider" />
      {showLayoutPanel && (
        <>
          <AutoLayoutPanel
            layout={component.props?.layout || component.layout || {}}
            onUpdate={(changes) => onUpdate(component.id, changes)}
          />
          <div className="property-divider" />
        </>
      )}
      {renderProps()}
      {renderSizingPanel()}
      <div className="property-divider" />
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="inspector-btn duplicate" onClick={onDuplicate}>Duplicate</button>
        <button className="inspector-btn delete" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

export default Inspector;
