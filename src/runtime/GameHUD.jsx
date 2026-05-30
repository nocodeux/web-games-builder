// GameHUD.jsx — renders level.rows (HUD layer) in play mode.
//
// Rendering exactly mirrors the export (exportHTML in App.jsx):
//   • Same wrapperStyle formula and parentDirection threading
//   • Row: single div (no extra wrapper) — no retro-row CSS class
//   • isSingleWindow centering matches editor / export preview-area logic
//   • viewMode='mobile' applies 420px max-width constraint matching the editor

import React from 'react';
import Window from '../components/Componentes/Window';
import Frame from '../components/Componentes/Frame';
import Button from '../components/Componentes/Button';
import Text from '../components/Componentes/Text';
import TextBox from '../components/Componentes/TextBox';
import CheckBox from '../components/Componentes/CheckBox';
import RadioButton from '../components/Componentes/RadioButton';
import ComboBox from '../components/Componentes/ComboBox';
import Selector from '../components/Componentes/Selector';
import ListBox from '../components/Componentes/ListBox';
import Shape from '../components/Componentes/Shape';
import Line from '../components/Componentes/Line';
import ImageComp from '../components/Componentes/Image';
import ScrollBar from '../components/Componentes/ScrollBar';
import Loader from '../components/Componentes/Loader';
import Tabs from '../components/Componentes/Tabs';
import DataRepeater from '../components/Componentes/DataRepeater';
import Form from '../components/Componentes/Form';

const componentMap = {
  Window, Frame, Button, Text, Label: Text, Input: TextBox, TextBox,
  CheckBox, RadioButton, ComboBox, Selector, ListBox, Shape, Line,
  Image: ImageComp, HScrollBar: ScrollBar, VScrollBar: ScrollBar,
  Loader, Tabs, DataRepeater, Form,
  // Row: intentionally excluded — rendered inline to avoid retro-row CSS
};

const CONTAINER_TYPES = ['Window', 'Frame', 'Tabs', 'DataRepeater', 'Form'];

// Mirrors layoutToStyles() from App.jsx
function layoutToStyles(layout = {}) {
  return {
    display:        'flex',
    flexDirection:  layout.direction  || 'row',
    gap:            (layout.gap !== '' && layout.gap != null) ? layout.gap : 8,
    alignItems:     layout.align      || 'flex-start',
    justifyContent: layout.justify    || 'flex-start',
    flexWrap:       layout.wrap ? 'wrap' : 'nowrap',
    paddingTop:     layout.paddingTop    || undefined,
    paddingRight:   layout.paddingRight  || undefined,
    paddingBottom:  layout.paddingBottom || undefined,
    paddingLeft:    layout.paddingLeft   || undefined,
  };
}

// Mirrors renderComponentExport() from App.jsx.
// parentDirection: flex-direction of the enclosing container row.
function renderComp(comp, ctx, parentDirection = 'row') {
  const p = comp.props || {};
  const { onNavigateLevel, onNavigateScreen, overlay, forceHeight } = ctx;
  // In block mode (hud-only), fill height has no definite parent — treat as auto.
  const isOverlay = overlay !== false;

  const isWFill = p.sizing?.widthMode  === 'fill';
  const isHFill = p.sizing?.heightMode === 'fill';
  const isWHug  = p.sizing?.widthMode  === 'hug';
  const isHHug  = p.sizing?.heightMode === 'hug';

  // Same wrapperStyle formula as export (App.jsx renderComponentExport)
  const shouldStretch = isHFill || (isWFill && parentDirection === 'column');
  const wrapStyle = {
    display:   (isWFill || isHFill) ? 'flex' : 'inline-flex',
    flex:      isWFill ? '1 1 0' : (isHFill ? '1 1 auto' : '0 0 auto'),
    alignSelf: shouldStretch ? 'stretch' : 'auto',
    minWidth:  0,
    minHeight: isHFill ? 0 : undefined,
    boxSizing: 'border-box',
    maxWidth:  '100%',
  };

  const handleClick = () => {
    if (p.action === 'level'    && p.targetLevelId)  onNavigateLevel?.(p.targetLevelId);
    else if (p.action === 'screen' && p.targetScreenId) onNavigateScreen?.(p.targetScreenId);
    else if (p.action === 'external' && p.href)         window.open(p.href, '_blank');
  };

  // ── Row: single div, no retro-row class, mirrors export case 'Row' ────────
  if (comp.type === 'Row') {
    const rowDir = p.layout?.direction || 'row';
    // forceHeight: row is a direct child of a fillContainer rowList div — fill regardless of heightMode.
    // Strip forceHeight from children so nested rows aren't affected.
    const childCtx = forceHeight ? { ...ctx, forceHeight: false } : ctx;
    const fillH = forceHeight || (isHFill && isOverlay);
    const heightVal    = fillH ? '100%' : 'auto';
    const minHeightVal = fillH ? 0 : (p.height ? (typeof p.height === 'string' ? p.height : `${p.height}px`) : 32);
    const effectiveWrap = forceHeight
      ? { ...wrapStyle, flex: '1 1 auto', alignSelf: 'stretch', minHeight: 0 }
      : wrapStyle;
    return (
      <div style={{
        ...effectiveWrap,
        ...layoutToStyles(p.layout),
        width:     isWFill ? '100%' : (p.width ? (typeof p.width === 'string' ? p.width : `${p.width}px`) : '100%'),
        minHeight: minHeightVal,
        height:    heightVal,
        ...(p.bgColor ? { background: p.bgColor } : {}),
        ...(p.bgImage ? {
          backgroundImage: `url(${p.bgImage})`,
          backgroundSize: p.bgImageFit === 'tile' ? 'auto' : (p.bgImageFit === 'fill' ? '100% 100%' : (p.bgImageFit || 'cover')),
          backgroundRepeat: p.bgImageFit === 'tile' ? 'repeat' : 'no-repeat',
          backgroundPosition: 'center',
        } : {}),
      }}>
        {(comp.children || []).map(child => (
          <React.Fragment key={child.id}>
            {renderComp(child, childCtx, rowDir)}
          </React.Fragment>
        ))}
      </div>
    );
  }

  const Comp = componentMap[comp.type];
  if (!Comp) return null;

  const isContainer = CONTAINER_TYPES.includes(comp.type);
  const childDir = p.layout?.direction || 'row';
  const children = isContainer
    ? (comp.children || []).map(child => (
        <React.Fragment key={child.id}>
          {renderComp(child, ctx, childDir)}
        </React.Fragment>
      ))
    : null;

  // Live game state binding — replace text for Text/Label components.
  const resolvedText = (comp.type === 'Text' || comp.type === 'Label') && p.bindTo
    ? resolveBinding(p.bindTo, p.text, ctx.gameState)
    : p.text;

  return (
    <div style={wrapStyle}>
      <Comp
        {...p}
        text={resolvedText}
        id={comp.id}
        width={isWFill  ? '100%' : isWHug  ? 'auto' : p.width  || 'auto'}
        height={isHFill ? '100%' : isHHug  ? 'auto' : p.height || 'auto'}
        onClick={handleClick}
      >
        {children}
      </Comp>
    </div>
  );
}

// Resolve a bound game state value from the bindTo key.
// Returns the string to display, inserting it into the text template if {value} is present.
function resolveBinding(bindTo, text, gameState) {
  if (!bindTo || !gameState) return text;
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
    default: return text;
  }
  const str = String(value);
  if (typeof text === 'string' && text.includes('{value}')) return text.replace('{value}', str);
  return str;
}

// overlay=true  (default): HUD is position:absolute inset:0 over the game canvas (game+hud levels).
// overlay=false           : HUD is a block element that drives its parent's height (hud-only levels).
export default function GameHUD({ rows, onNavigateLevel, onNavigateScreen, viewMode, overlay = true, fillContainer = false, gameState, centerVertical = false }) {
  const ctx = { onNavigateLevel, onNavigateScreen, overlay, gameState };
  const isMobile = viewMode === 'mobile';

  const isSingleWindow =
    rows?.length === 1 &&
    rows[0]?.children?.length === 1 &&
    rows[0].children[0].type === 'Window';

  const rowList = (rows || []).map(row => {
    const rowDir = row.layout?.direction || 'row';
    const rowCtx = fillContainer ? { ...ctx, forceHeight: true } : ctx;
    return (
      <div
        key={row.id}
        style={{
          ...layoutToStyles(row.layout),
          width: '100%',
          ...(fillContainer ? { flex: 1, minHeight: 0 } : {}),
          ...(isSingleWindow && overlay ? { justifyContent: 'center', alignItems: 'center' } : {}),
        }}
      >
        {(row.children || []).map(comp => (
          <React.Fragment key={comp.id}>
            {renderComp(comp, rowCtx, rowDir)}
          </React.Fragment>
        ))}
      </div>
    );
  });

  if (!overlay) {
    // Block mode for hud-only: flows in normal document flow, height driven by content.
    return (
      <div style={{
        position:      'relative',
        width:         '100%',
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        pointerEvents: 'auto',
        maxWidth:      isMobile ? 420 : undefined,
      }}>
        <div style={{
          width:          '100%',
          display:        'flex',
          flexDirection:  'column',
          ...(isSingleWindow ? { alignItems: 'center', justifyContent: 'center' } : {}),
        }}>
          {rowList}
        </div>
      </div>
    );
  }

  // Overlay mode: fills the game viewport frame (position:absolute, inset:0).
  return (
    <div style={{
      position:      'absolute',
      inset:         0,
      display:       'flex',
      flexDirection: 'column',
      alignItems:    'center',
      overflow:      'hidden',
      pointerEvents: 'auto',
    }}>
      <div style={{
        boxSizing:      'border-box',
        padding:        0,
        width:          '100%',
        maxWidth:       isMobile ? 420 : undefined,
        ...(isSingleWindow ? {
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          flex:           1,
          alignSelf:      'stretch',
        } : {
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: centerVertical ? 'center' : 'flex-start',
          flex:           1,
          alignSelf:      'stretch',
        }),
      }}>
        {rowList}
      </div>
    </div>
  );
}
