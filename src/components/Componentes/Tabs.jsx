import React, { useState } from 'react';
import { useDrop } from 'react-dnd';

function Tabs({
  tabs = [],
  activeTabIndex = 0,
  onAddChild,
  onMoveChild,
  id,
  children,
  layout = { direction: 'column', gap: 8, align: 'stretch', justify: 'flex-start' },
  containerStyle = {},
  contentStyle = {},
}) {
  const [internalActiveTab, setInternalActiveTab] = useState(activeTabIndex);

  const [{ isOver }, drop] = useDrop(() => ({
    accept: ['COMPONENT', 'EXISTING_COMPONENT'],
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      
      const extraProps = { tabIndex: internalActiveTab };
      
      if (item.id === undefined) {
        if (onAddChild) onAddChild(item.type, extraProps);
      } else if (item.id && onMoveChild) {
        onMoveChild({ ...item, extraProps });
      }
      return { handled: true };
    },
    collect: (monitor) => ({
      isOver: !!monitor.isOver({ shallow: true })
    })
  }), [onAddChild, onMoveChild, internalActiveTab]);

  return (
    <div className="retro-tabs-container" style={{ width: '100%', display: 'flex', flexDirection: 'column', ...containerStyle }}>
      <div className="retro-tabs-header" style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        {tabs.map((tab, idx) => (
          <div 
            key={tab.id || idx}
            onClick={() => setInternalActiveTab(idx)}
            className={`retro-tab ${internalActiveTab === idx ? 'active' : ''}`}
            style={{
              padding: '6px 12px',
              cursor: 'pointer',
              fontSize: '11px',
              fontFamily: 'monospace',
              border: '1px solid var(--border)',
              borderBottom: internalActiveTab === idx ? '1px solid var(--bg)' : '1px solid var(--border)',
              background: internalActiveTab === idx ? 'var(--bg)' : 'rgba(0,0,0,0.2)',
              color: internalActiveTab === idx ? 'var(--accent)' : 'var(--text-dim)',
              marginBottom: -1,
              marginRight: 2,
              fontWeight: internalActiveTab === idx ? 'bold' : 'normal',
              whiteSpace: 'nowrap'
            }}
          >
            {tab.label}
          </div>
        ))}
      </div>
      <div
        ref={drop}
        className="retro-tabs-content"
        style={{
          border: '1px solid var(--border)',
          borderTop: 'none',
          padding: 12,
          minHeight: 100,
          background: 'var(--bg)',
          position: 'relative',
          outline: isOver ? '2px dashed var(--accent)' : 'none',
          display: 'flex',
          flexDirection: layout.direction || 'column',
          gap: layout.gap || 8,
          alignItems: layout.align || 'stretch',
          justifyContent: layout.justify || 'flex-start',
          ...contentStyle,
        }}
      >
        {React.Children.map(children, child => {
          // Accessing child.props.comp.props is for Canvas rendering
          // Accessing child.props.tabIndex is for standard React rendering
          const childProps = child.props?.comp?.props || child.props || {};
          const childTabIndex = childProps.tabIndex;
          
          const effectiveTabIndex = childTabIndex !== undefined ? childTabIndex : 0;
          if (effectiveTabIndex !== internalActiveTab) {
            return null;
          }
          return child;
        })}
        {isOver && (
          <div className="drop-indicator">[+ drop here +]</div>
        )}
      </div>
    </div>
  );
}

export default Tabs;
