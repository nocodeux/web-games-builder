import React from 'react';
import './GradualBlur.css';

// Gradual blur overlay — stacks multiple backdrop-filter layers to create a
// smooth blur gradient. Meant to be placed inside a relatively-positioned
// container (Frame, Window, etc.) that holds the content you want to blur.
//
// In the builder it renders in normal flow as a visible preview.
// Export renders it as position:absolute so it floats over sibling content.
//
// position: 'top' | 'bottom' | 'left' | 'right'  — which edge is fully blurred
// strength:  blur radius in px at the dense end (default 12)
// height:    thickness of the blur region in px (default 200)
// divCount:  number of layers (more = smoother, default 16)
// exponential: true = quadratic curve, false = linear
// opacity:   opacity of the whole overlay (0–1)
// animated:  slow pulse animation
function GradualBlur({
  position = 'bottom',
  strength = 12,
  height = 200,
  divCount = 16,
  exponential = true,
  opacity = 1,
  animated = false,
  sizing = {},
}) {
  const isVertical = position === 'top' || position === 'bottom';
  const count = Math.max(2, Math.min(32, Number(divCount) || 16));
  const str   = Math.max(0, Number(strength) || 12);
  const h     = Math.max(4, Number(height) || 200);

  const layers = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const intensity = exponential ? t * t : t;
    // For 'top'/'left' the heavy blur is at the beginning; for 'bottom'/'right' it's at the end.
    const blurAmount = (position === 'top' || position === 'left')
      ? (1 - intensity) * str
      : intensity * str;

    const sizeVal = h / count;
    const layerStyle = isVertical
      ? { height: sizeVal, backdropFilter: `blur(${blurAmount.toFixed(2)}px)`, WebkitBackdropFilter: `blur(${blurAmount.toFixed(2)}px)` }
      : { width: sizeVal, backdropFilter: `blur(${blurAmount.toFixed(2)}px)`, WebkitBackdropFilter: `blur(${blurAmount.toFixed(2)}px)` };

    return <div key={i} className="gb-layer" style={layerStyle} />;
  });

  const wrapStyle = {
    display: 'flex',
    opacity: Number(opacity) ?? 1,
    pointerEvents: 'none',
    overflow: 'hidden',
    width: isVertical ? (sizing.widthMode === 'fill' ? '100%' : '100%') : `${h}px`,
    height: isVertical ? `${h}px` : '100%',
    flexDirection: isVertical ? 'column' : 'row',
    flexShrink: 0,
  };

  return (
    <div
      className={`gradual-blur-container${animated ? ' gradual-blur-animated' : ''}`}
      style={wrapStyle}
    >
      {layers}
    </div>
  );
}

export default GradualBlur;
