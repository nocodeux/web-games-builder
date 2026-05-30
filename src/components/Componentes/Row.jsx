import React from 'react';
import { useDrop } from 'react-dnd';

function Row({
  layout = { direction: 'row', gap: 8, align: 'flex-start', justify: 'flex-start', wrap: false },
  children,
  onAddChild,
  onMoveChild,
  width = '100%',
  height = 'auto',
  bgColor = '',
  bgImage = '',
  bgImageFit = 'cover',
}) {
  const [{ isOver }, drop] = useDrop(() => ({
    accept: ['COMPONENT', 'EXISTING_COMPONENT'],
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      if (item.type !== undefined) {
        if (onAddChild) onAddChild(item.type);
      } else if (item.id && onMoveChild) {
        onMoveChild(item);
      }
      return { handled: true };
    },
    collect: (monitor) => ({ isOver: !!monitor.isOver({ shallow: true }) })
  }), [onAddChild, onMoveChild]);

  const fmtDim = (val) => {
    if (!val || val === 'auto') return 'auto';
    if (typeof val === 'string' && (val.includes('%') || val.includes('vw') || val.includes('vh'))) return val;
    return `${val}px`;
  };

  return (
    <div
      ref={drop}
      className="retro-row"
      style={{
        display: 'flex',
        flexDirection: layout.direction,
        gap: layout.gap,
        alignItems: layout.align,
        justifyContent: layout.justify,
        flexWrap: layout.wrap ? 'wrap' : 'nowrap',
        paddingTop: layout.paddingTop ?? 0,
        paddingRight: layout.paddingRight ?? 0,
        paddingBottom: layout.paddingBottom ?? 0,
        paddingLeft: layout.paddingLeft ?? 0,
        width: fmtDim(width),
        height: fmtDim(height),
        minHeight: (height === 'auto' || !height) ? '24px' : fmtDim(height),
        ...(bgColor ? { background: bgColor } : {}),
        ...(bgImage ? {
          backgroundImage: `url(${bgImage})`,
          backgroundSize: bgImageFit === 'tile' ? 'auto' : (bgImageFit === 'fill' ? '100% 100%' : bgImageFit),
          backgroundRepeat: bgImageFit === 'tile' ? 'repeat' : 'no-repeat',
          backgroundPosition: 'center',
        } : {}),
      }}
    >
      {children}
      {isOver && <div className="drop-indicator">[+ drop here +]</div>}
    </div>
  );
}

export default Row;
