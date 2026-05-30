import React, { useContext, useEffect, useRef } from 'react';
import { useDrop } from 'react-dnd';
import { DataContext } from './DataRepeater';
import { playInteractionSound, getInteractionAssets, getInteractionSettings } from '../../lib/interactionAudio';
import { resolveDatabaseRecord } from '../../lib/databaseBinding';

function Window({
  title = 'Window1',
  width = 400,
  height = '',
  sizing = {},
  bgColor = '',
  textColor = '',
  borderColor = '',
  bgImage = '',
  bgImageFit = 'cover',
  layout = { direction: 'row', gap: 8, align: 'flex-start', justify: 'flex-start', wrap: false },
  children,
  onAddChild,
  onMoveChild,
  id,
  showClose = false,
  closeNextScreenId = null,
  onNavigate,
  staggered = false,
  dataSourceType = 'manual',
  database = null,
  dataSourceTable = '',
  dataFilterField = '',
  dataFilterValue = '',
  dataField = '',
  suppressOpenSound = false,
  soundSettings = null,
  assets = null,
  soundActions = null,
}) {
  const data = useContext(DataContext);
  const openedRef = useRef(false);

  // Derive CSS dimensions from sizing modes, same pattern as Image.jsx.
  // Falls back gracefully for components created before sizing was added.
  const widthMode  = sizing?.widthMode;
  const heightMode = sizing?.heightMode;

  const cssWidth = widthMode === 'fill' ? '100%'
    : widthMode === 'hug' ? 'fit-content'
    : (typeof width === 'number' ? `${width}px`
       : (typeof width === 'string' && width.includes('%')) ? width
       : 'auto');

  // For fixed or fill modes the content area should use flex: 1 1 0 so it
  // fills the Window's definite height. For hug mode (height: auto parent)
  // flex-basis: 0 + min-height: 0 from the CSS class collapses the content
  // to 0 because there is no free space to distribute. Override to
  // flex: 0 0 auto so the content simply sizes to its children.
  const isHeightConstrained = heightMode === 'fill'
    || (heightMode === 'fixed' && typeof height === 'number' && height > 0)
    || (heightMode === 'fixed' && typeof height === 'string' && height.includes('%'))
    || (!heightMode && typeof height === 'number' && height > 0);
  const contentFlex = isHeightConstrained ? '1 1 0' : '0 0 auto';

  const cssHeight = heightMode === 'fill' ? '100%'
    : (!heightMode && typeof height === 'number' && height > 0) ? `${height}px`
    : (heightMode === 'fixed' && typeof height === 'number' && height > 0) ? `${height}px`
    : (heightMode === 'fixed' && typeof height === 'string' && height.includes('%')) ? height
    : 'auto';

  const sourceData = dataSourceType === 'database'
    ? resolveDatabaseRecord({
        database,
        tableName: dataSourceTable,
        filterField: dataFilterField,
        filterValue: dataFilterValue,
        templateSource: data,
        fallbackData: data,
      })
    : data;

  const resolvedTitle = (dataSourceType === 'database' && sourceData && dataField)
    ? String(sourceData[dataField] ?? title)
    : title;

  useEffect(() => {
    if (suppressOpenSound) return;
    if (openedRef.current) return;
    openedRef.current = true;
    playInteractionSound(getInteractionSettings(soundSettings), getInteractionAssets(assets), 'open', soundActions);
  }, [assets, soundActions, soundSettings, suppressOpenSound]);

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

  return (
    <div
      ref={drop}
      className="retro-window"
      style={{
        width: cssWidth,
        height: cssHeight,
        background: bgColor || 'var(--bg)',
        borderColor: borderColor || 'var(--border)',
        // bgImage uses the same data-URL / URL shape as the Image component's
        // `src`. bgImageFit follows CSS background-size keywords: cover,
        // contain, fill (stretch) or tile (repeat). Falls back to nothing
        // when bgImage is empty, preserving existing visual.
        ...(bgImage ? {
          backgroundImage: `url(${bgImage})`,
          backgroundSize: bgImageFit === 'tile' ? 'auto' : (bgImageFit === 'fill' ? '100% 100%' : bgImageFit),
          backgroundRepeat: bgImageFit === 'tile' ? 'repeat' : 'no-repeat',
          backgroundPosition: 'center',
        } : {}),
      }}
    >
      <div className="retro-window-titlebar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          className="retro-window-title"
          style={{ color: textColor || 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
        >
          {resolvedTitle}
        </span>
        {showClose && (
          <button 
            className="retro-window-close"
            onClick={(e) => {
              playInteractionSound(getInteractionSettings(soundSettings), getInteractionAssets(assets), 'close', soundActions);
              if ((e.metaKey || e.ctrlKey) && onNavigate && closeNextScreenId) {
                e.stopPropagation();
                onNavigate({ props: { action: 'screen', targetScreenId: closeNextScreenId } });
              }
            }}
          >
            X
          </button>
        )}
      </div>
      <div
        className="retro-window-content"
        style={{
          display: 'flex',
          flexDirection: layout.direction,
          gap: layout.gap,
          alignItems: layout.align,
          justifyContent: layout.justify,
          flexWrap: layout.wrap ? 'wrap' : 'nowrap',
          paddingTop: (layout.paddingTop ?? 0) + 12,
          paddingRight: (layout.paddingRight ?? 0) + 12,
          paddingBottom: (layout.paddingBottom ?? 0) + 12,
          paddingLeft: (layout.paddingLeft ?? 0) + 12,
          outline: isOver ? '2px dashed var(--accent)' : 'none',
          outlineOffset: -4,
          transition: 'outline 0.1s',
          minHeight: 40,
          flex: contentFlex,
        }}
      >
        {children}
        {isOver && (
          <div className="drop-indicator">[+ drop here +]</div>
        )}
      </div>
    </div>
  );
}

export default Window;
