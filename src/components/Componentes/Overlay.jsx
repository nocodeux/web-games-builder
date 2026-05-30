import React from 'react';
import { useDrop } from 'react-dnd';

function Overlay({ 
  title = 'Modal Overlay',
  isOpen = true, 
  onAddChild, 
  onMoveChild, 
  id, 
  children,
  bgColor = 'rgba(0,0,0,0.7)',
  modalBg = '',
  borderColor = '',
  layout = { direction: 'column', gap: 8, align: 'stretch', justify: 'flex-start' },
  onUpdate,
  width: overrideWidth,
  height: overrideHeight
}) {
  const [{ isOver }, drop] = useDrop(() => ({
    accept: ['COMPONENT', 'EXISTING_COMPONENT'],
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      if (item.id === undefined) {
        if (onAddChild) onAddChild(item.type);
      } else if (item.id && onMoveChild) {
        onMoveChild(item);
      }
      return { handled: true };
    },
    collect: (monitor) => ({
      isOver: !!monitor.isOver({ shallow: true })
    })
  }), [onAddChild, onMoveChild]);

  if (!isOpen) return null;

  return (
    <div 
      className="projects-overlay"
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: bgColor,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'all'
      }}
      onClick={() => onUpdate && onUpdate({ isOpen: false })}
    >
      <div 
        ref={drop}
        className="projects-modal"
        style={{
          width: overrideWidth || 400,
          minHeight: overrideHeight || 200,
          background: modalBg || 'var(--panel-bg)',
          borderColor: borderColor || 'var(--border)',
          position: 'relative',
          boxShadow: '0 0 30px rgba(0,0,0,0.5)',
          outline: isOver ? '2px dashed var(--accent)' : 'none',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-titlebar">
          <span className="modal-title">[ {title} ]</span>
          <button className="modal-close" onClick={() => onUpdate && onUpdate({ isOpen: false })}>X</button>
        </div>
        <div 
          className="modal-body" 
          style={{ 
            padding: 20,
            display: 'flex',
            flexDirection: layout.direction || 'column',
            gap: layout.gap || 8,
            alignItems: layout.align || 'stretch',
            justifyContent: layout.justify || 'flex-start',
            minHeight: 100,
            outline: isOver ? '2px dashed var(--accent)' : 'none',
            position: 'relative'
          }}
        >
          {children}
          {isOver && (
            <div className="drop-indicator">[+ drop here +]</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Overlay;
