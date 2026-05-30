/**
 * Canvas.jsx — Enhanced drag & drop with position-aware insertion
 *
 * KEY CHANGES FROM PREVIOUS VERSION:
 * 1. Removed separate DropZone components — each component now detects
 *    cursor position (before/after) based on row direction
 * 2. Insertion indicator matches the size of the drop target area
 * 3. Smooth row-to-row movement with visual feedback
 * 4. Rows themselves are drop targets with position detection
 * 5. Between-row drop zones for creating new rows
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDrop, useDrag } from 'react-dnd';
import Window from './Componentes/Window';
import Frame from './Componentes/Frame';
import Button from './Componentes/Button';
import Text from './Componentes/Text';
import TextBox from './Componentes/TextBox';
import Row from './Componentes/Row';
import CheckBox from './Componentes/CheckBox';
import RadioButton from './Componentes/RadioButton';
import ComboBox from './Componentes/ComboBox';
import Selector from './Componentes/Selector';
import ListBox from './Componentes/ListBox';
import Data from './Componentes/Data';
import Timer from './Componentes/Timer';
import Shape from './Componentes/Shape';
import Line from './Componentes/Line';
import ImageComp from './Componentes/Image';
import ScrollBar from './Componentes/ScrollBar';
import Table from './Componentes/Table';
import Loader from './Componentes/Loader';
import Tabs from './Componentes/Tabs';
import Overlay from './Componentes/Overlay';
import DataRepeater from './Componentes/DataRepeater';
import Form from './Componentes/Form';
import GameEmbed from './Componentes/GameEmbed';
import GradualBlur from './Componentes/GradualBlur';

// Mobile-specific defaults — independent from desktop, not inherited.
export const DEFAULT_MOBILE_ROW_LAYOUT = { direction: 'row', gap: 8, align: 'flex-start', justify: 'flex-start', wrap: false };
export const DEFAULT_MOBILE_SCREEN_LAYOUT = { direction: 'column', gap: 0, align: 'stretch', justify: 'flex-start', wrap: false, paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16, paddingLinked: true };

// Resolve a row layout for the current viewMode.
// Mobile: preserve desktop direction/gap/etc, then apply mobile-specific overrides on top.
export function resolveLayout(layout, viewMode) {
  if (!layout) return null;
  if (viewMode === 'mobile') {
    return { ...DEFAULT_MOBILE_ROW_LAYOUT, ...layout, ...(layout.mobile || {}) };
  }
  return layout;
}

const componentMap = {
  Window, Frame, Row, Button, Text, Label: Text, Input: TextBox, TextBox, CheckBox, RadioButton,
  ComboBox, Selector, ListBox, Timer, Shape, Line, Image: ImageComp,
  HScrollBar: ScrollBar, VScrollBar: ScrollBar, Data, Table, Loader, Tabs, Overlay, DataRepeater, Form,
  GameEmbed, GradualBlur,
};

const CONTAINER_TYPES = ['Window', 'Frame', 'Row', 'Tabs', 'DataRepeater', 'Form'];

// ─── Draggable component with position-aware drop detection ─────────────────
function DraggableComponent({
  comp, rowId, topRowId, index, totalSiblings, selectedIds, onSelect, onDelete, onDuplicate,
  onAddComponent, activeWindow, onMoveComponent, rowDirection, onNavigate, onUpdateComponent, database, onSaveRecord,
  editingTextId, onStartTextEdit, onCommitTextEdit,
  assets, soundSettings,
}) {
  const currentTopRowId = topRowId || rowId;
  const ref = useRef(null);
  const [dropIndicator, setDropIndicator] = useState(null); // 'before' | 'after' | null
  const isEditingText = comp.type === 'Text' && editingTextId === comp.id;

  const [{ isDragging }, drag] = useDrag(() => ({
    type: 'EXISTING_COMPONENT',
    item: () => {
      // Capture the element's dimensions for the insertion indicator
      const rect = ref.current?.getBoundingClientRect();
      return {
        id: comp.id,
        fromRowId: rowId,
        topRowId: currentTopRowId,
        fromIndex: index,
        width: rect?.width || 80,
        height: rect?.height || 32,
      };
    },
    canDrag: !isEditingText,
    collect: monitor => ({ isDragging: !!monitor.isDragging() }),
    end: () => setDropIndicator(null),
  }), [comp.id, rowId, index, onMoveComponent, isEditingText]);

  // This component is also a drop target — detects cursor position
  const [{ isOver }, drop] = useDrop(() => ({
    accept: ['COMPONENT', 'EXISTING_COMPONENT'],
    hover: (item, monitor) => {
      if (!ref.current) return;
      // Don't detect over self
      if (item.id === comp.id) { setDropIndicator(null); return; }

      const hoverRect = ref.current.getBoundingClientRect();
      const clientOffset = monitor.getClientOffset();
      if (!clientOffset) return;

      const isHorizontal = rowDirection === 'row';
      const isContainer = CONTAINER_TYPES.includes(comp.type);

      // Detection for "Inside" drop if it's a container
      const margin = 12; 
      if (isContainer) {
        const isInside = clientOffset.x > hoverRect.left + margin && 
                         clientOffset.x < hoverRect.right - margin &&
                         clientOffset.y > hoverRect.top + margin &&
                         clientOffset.y < hoverRect.bottom - margin;
        
        if (isInside) {
          setDropIndicator('inside');
          return;
        }
      }

      if (isHorizontal) {
        const midX = hoverRect.left + hoverRect.width / 2;
        setDropIndicator(clientOffset.x < midX ? 'before' : 'after');
      } else {
        const midY = hoverRect.top + hoverRect.height / 2;
        setDropIndicator(clientOffset.y < midY ? 'before' : 'after');
      }
    },
    drop: (item, monitor) => {
      // If a nested container (Window/Frame) already handled this, stop
      if (monitor.didDrop()) return;
      
      const dropResult = monitor.getDropResult();
      if (dropResult && dropResult.handled) return;

      // Check if we are directly over this wrapper and not a child container
      if (!monitor.isOver({ shallow: true })) return;

      if (dropIndicator === 'inside') {
        if (item.id === undefined) {
          onAddComponent(item.type, topRowId, 0, comp.id);
        } else {
          onMoveComponent(item, topRowId, 0, null, comp.id);
        }
      } else {
        const insertIndex = dropIndicator === 'before' ? index : index + 1;
        if (item.id === undefined) {
          onAddComponent(item.type, currentTopRowId, insertIndex, rowId !== currentTopRowId ? rowId : null);
        } else {
          onMoveComponent(item, rowId, insertIndex, null, rowId !== currentTopRowId ? rowId : null);
        }
      }
      setDropIndicator(null);
      return { handled: true };
    },
    collect: monitor => ({
      isOver: monitor.isOver({ shallow: true }),
    }),
  }), [comp.id, rowId, index, dropIndicator, rowDirection, onAddComponent, onMoveComponent]);

  // Clear indicator when not hovering
  if (!isOver && dropIndicator) {
    setTimeout(() => setDropIndicator(null), 0);
  }

  // Combine drag and drop refs
  const combinedRef = (node) => {
    ref.current = node;
    drag(drop(node));
  };

  const Component = componentMap[comp.type];
  if (!Component) return null;

  // Hidden windows
  if (comp.type === 'Window' && activeWindow && comp.id !== activeWindow) {
    return (
      <div
      ref={combinedRef}
      className={`component-wrapper ${selectedIds && selectedIds.includes(comp.id) ? 'selected' : ''}`}
      style={{
        opacity: 0.35,
        cursor: 'grab'
      }}
      title={comp.props.title}
      onClick={e => { e.stopPropagation(); onSelect(comp.id); }}
    >
        <Component {...comp.props} id={comp.id} suppressOpenSound />
      </div>
    );
  }

  const isContainer = CONTAINER_TYPES.includes(comp.type);
  const isSelected = selectedIds && selectedIds.includes(comp.id);
  const isHidden = comp.type === 'Window' && activeWindow && comp.id !== activeWindow;
  
  // Always hide Overlay from the row flow. 
  // It's rendered at the top level when open, 
  // and accessed via the bottom indicators for selection.
  if (comp.type === 'Overlay') {
    return null; 
  }

  const childCount = comp.children?.length || 0;
  const isHorizontal = rowDirection === 'row';

  // Render children of containers (Window/Frame/Row/PictureBox)
  const renderContainerChildren = () => {
    return (comp.children || []).map((child, ci) => (
         <DraggableComponent
          key={child.id}
          comp={child}
          rowId={comp.id}
          topRowId={currentTopRowId}
          index={ci}
          totalSiblings={(comp.children || []).length}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onAddComponent={onAddComponent}
          activeWindow={activeWindow}
          onMoveComponent={onMoveComponent}
          rowDirection={comp.props?.layout?.direction || 'row'}
          onNavigate={onNavigate}
          onUpdateComponent={onUpdateComponent}
          database={database}
          onSaveRecord={onSaveRecord}
          editingTextId={editingTextId}
          onStartTextEdit={onStartTextEdit}
          onCommitTextEdit={onCommitTextEdit}
          assets={assets}
          soundSettings={soundSettings}
        />
    ));
  };

  // Sizing styles
  const sizingStyle = {};
  const sizing = comp.props?.sizing;
  const isWidthFill = sizing?.widthMode === 'fill';
  const isHeightFill = sizing?.heightMode === 'fill';
  const isWidthHug = sizing?.widthMode === 'hug';
  const isHeightHug = sizing?.heightMode === 'hug';

  if (isWidthFill) {
    if (rowDirection === 'column') {
      // Column parent: width is the cross axis — stretch to fill it, don't grow along height.
      sizingStyle.alignSelf = 'stretch';
      sizingStyle.flexShrink = 0;
    } else {
      // Row parent: width is the main axis — grow to fill it.
      sizingStyle.flexGrow = 1;
      sizingStyle.flexShrink = 1;
      sizingStyle.flexBasis = 0;
      sizingStyle.minWidth = 0;
      if (isHeightFill) {
        sizingStyle.alignSelf = 'stretch';
      }
    }
  } else if (isWidthHug) {
    sizingStyle.flexShrink = 0;
    sizingStyle.maxWidth = 'none';
    sizingStyle.overflow = 'visible';
  }

  if (isHeightFill) {
    sizingStyle.flexDirection = 'column'; // so the child component can use height:100%
    if (rowDirection === 'column') {
      // Column parent: height is the main axis — grow to fill it.
      sizingStyle.flexGrow = 1;
      sizingStyle.flexShrink = 1;
      sizingStyle.flexBasis = 0;
      sizingStyle.minHeight = 0;
    }
    // Row parent: do NOT set alignSelf:stretch. With no explicit row height,
    // stretch creates a circular dependency — the row collapses to minHeight:32
    // and all fill items show only a title bar.
    // Without alignSelf, height:100% on the child has no definite parent to
    // resolve against, so CSS treats it as height:auto, and the component sizes
    // to its content — the same behaviour the old block-canvas gave for free.
  } else if (isHeightHug && comp.type === 'GameEmbed') {
    // GameEmbed has a fixed pixel height from nativeH — prevent parent stretch from overriding it.
    sizingStyle.alignSelf = 'flex-start';
  }

  // Calculate padding based on drop indicator to create the "gap"
  const wrapperPadding = {};
  if (isOver && dropIndicator) {
    const gapSize = 48;
    if (dropIndicator === 'inside') {
      wrapperPadding.outline = '2px dashed var(--accent)';
      wrapperPadding.outlineOffset = '-2px';
      wrapperPadding.backgroundColor = 'rgba(0,255,0,0.05)';
    } else if (isHorizontal) {
      if (dropIndicator === 'before') wrapperPadding.paddingLeft = gapSize;
      else wrapperPadding.paddingRight = gapSize;
    } else {
      if (dropIndicator === 'before') wrapperPadding.paddingTop = gapSize;
      else wrapperPadding.paddingBottom = gapSize;
    }
  }

  return (
    <div
      ref={combinedRef}
      className={`component-wrapper ${isSelected ? 'selected' : ''}`}
      style={{
        position: 'relative',
        opacity: isDragging ? 0.3 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
        // block when only width-fill so child width:100% resolves in a block context;
        // flex when height-fill (needs flex-direction:column for height:100% child).
        display: isHeightFill ? 'flex' : isWidthFill ? 'block' : 'inline-flex',
        transition: 'padding 0.15s ease-out', // Smooth transition for the gap
        ...sizingStyle,
        ...wrapperPadding,
        outline: isSelected ? '1px dashed #ffff00' : 'none',
        outlineOffset: '2px',
        zIndex: isSelected ? 10 : 1,
      }}
      onClick={e => {
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && onNavigate) {
            onNavigate(comp);
        } else {
            onSelect(comp.id, e.shiftKey);
        }
      }}
      onDoubleClick={e => {
        if (comp.type === 'Text' && onStartTextEdit) {
          e.stopPropagation();
          onSelect(comp.id);
          onStartTextEdit(comp.id);
        }
      }}
    >
      {/* Floating delete button for selected component */}
      {isSelected && (
        <button 
          onClick={(e) => { e.stopPropagation(); onDelete(comp.id); }}
          style={{
            position: 'absolute',
            top: -10,
            right: -10,
            width: 20,
            height: 20,
            borderRadius: '0',
            background: '#330000',
            border: '1px solid #ff0000',
            color: '#ff6666',
            fontSize: '10px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            boxShadow: '0 0 5px rgba(255,0,0,0.5)',
            fontFamily: 'monospace'
          }}
          title="Delete"
        >
          X
        </button>
      )}

      {/* Indicator line positioned in the gap area */}
      {isOver && dropIndicator && (
        <div
          className="drop-indicator-line"
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            zIndex: 100,
            // Position the line in the middle of the padding
            ...(isHorizontal ? {
              top: 0,
              bottom: 0,
              width: 4,
              left: dropIndicator === 'before' ? 22 : 'auto',
              right: dropIndicator === 'after' ? 22 : 'auto',
            } : {
              left: 0,
              right: 0,
              height: 4,
              top: dropIndicator === 'before' ? 22 : 'auto',
              bottom: dropIndicator === 'after' ? 22 : 'auto',
            })
          }}
        />
      )}

      <Component
        {...comp.props}
        id={comp.id}
        suppressOpenSound={false}
        selected={selectedIds && selectedIds.includes(comp.id)}
        width={isWidthFill ? '100%' : (isWidthHug ? 'auto' : (comp.props.width != null && comp.props.width !== '' ? comp.props.width : 'auto'))}
        height={isHeightFill ? '100%' : (isHeightHug ? 'auto' : (comp.props.height != null && comp.props.height !== '' ? comp.props.height : 'auto'))}
        database={database}
        assets={assets}
        soundSettings={soundSettings}
        onSaveRecord={onSaveRecord}
        rows={comp.type === 'Table' && comp.props.dataSourceType === 'database' && comp.props.dataSource && database?.data?.[comp.props.dataSource]
              ? database.data[comp.props.dataSource]
              : comp.props.rows}
        onAddChild={isContainer ? (type, extra) => onAddComponent(type, currentTopRowId, childCount, comp.id, extra) : undefined}
        onMoveChild={isContainer ? item => onMoveComponent(item, currentTopRowId, childCount, null, comp.id) : undefined}
        onNavigate={onNavigate}
        onUpdate={(props) => onUpdateComponent(comp.id, props)}
        tableName={comp.props.tableName}
        isEditing={isEditingText}
        onCommitText={(text) => onCommitTextEdit && onCommitTextEdit(comp.id, text)}
      >
        {isContainer && renderContainerChildren()}
      </Component>
    </div>
  );
}

// ─── Row of layout (with position-aware drop on empty area) ─────────────────
function LayoutRow({
  row, rowIndex, selectedIds, onSelect, onDelete, onDuplicate,
  onAddComponent, activeWindow, onMoveComponent, onDropToRow, onSelectRow, onNavigate, onUpdateComponent, database, onSaveRecord,
  editingTextId, onStartTextEdit, onCommitTextEdit,
  assets, soundSettings,
  viewMode = 'desktop',
}) {
  const layout = resolveLayout(row.layout, viewMode) || { direction: 'row', gap: 8, align: 'flex-start', justify: 'flex-start', wrap: false };
  const rowRef = useRef(null);

  // Row is a drop target — drops at the end (or calculates position)
  const [{ isOver: isOverRow }, dropRow] = useDrop(() => ({
    accept: ['COMPONENT', 'EXISTING_COMPONENT'],
    hover: (item, monitor) => {
      // Could add edge-detection here for top/bottom row splitting
    },
    drop: (item, monitor) => {
      // If a nested component handled the drop, stop
      if (monitor.didDrop()) return;
      const dropResult = monitor.getDropResult();
      if (dropResult && dropResult.handled) return;
      
      // If we are over a component wrapper in this row, let the wrapper handle it
      if (!monitor.isOver({ shallow: true })) return;

      // Calculate drop position based on cursor location
      let insertIndex = row.children.length; // default: end

      if (rowRef.current && row.children.length > 0) {
        const clientOffset = monitor.getClientOffset();
        if (clientOffset) {
          const rowRect = rowRef.current.getBoundingClientRect();
          const isHorizontal = layout.direction === 'row';

          // Find the component whose position is closest to cursor
          const wrappers = rowRef.current.querySelectorAll(':scope > .component-wrapper');
          for (let i = 0; i < wrappers.length; i++) {
            const wr = wrappers[i].getBoundingClientRect();
            if (isHorizontal) {
              if (clientOffset.x < wr.left + wr.width / 2) {
                insertIndex = i;
                break;
              }
            } else {
              if (clientOffset.y < wr.top + wr.height / 2) {
                insertIndex = i;
                break;
              }
            }
          }
        }
      }

      if (item.type !== undefined) {
        onDropToRow(item.type, row.id, insertIndex);
      } else {
        onMoveComponent(item, row.id, insertIndex);
      }
      return { handled: true };
    },
    collect: monitor => ({ isOver: !!monitor.isOver({ shallow: true }) })
  }), [row.id, row.children.length, layout.direction, onDropToRow, onMoveComponent]);

  const isRowSelected = selectedIds && selectedIds.includes(row.id);

  // Padding from layout
  const padding = {
    paddingTop: layout.paddingTop ?? 0,
    paddingRight: layout.paddingRight ?? 0,
    paddingBottom: layout.paddingBottom ?? 0,
    paddingLeft: layout.paddingLeft ?? 0,
  };

  const combinedRowRef = (node) => {
    rowRef.current = node;
    dropRow(node);
  };

  return (
    <div
      ref={combinedRowRef}
      className={`layout-row ${isRowSelected ? 'row-selected' : ''}`}
      style={{
        display: 'flex',
        flexDirection: layout.direction,
        gap: layout.gap,
        alignItems: layout.align,
        justifyContent: layout.justify,
        flexWrap: layout.wrap ? 'wrap' : 'nowrap',
        width: row.props?.sizing?.widthMode === 'hug' ? 'fit-content' : '100%',
        // fill → flex-grow; hug → auto height; default → stretch cross-axis so height:100%
        // children resolve correctly regardless of canvas align-items setting.
        ...(row.props?.sizing?.heightMode === 'fill'
          ? { flex: '1 1 0', minHeight: 0 }
          : row.props?.sizing?.heightMode === 'hug'
            ? { height: 'auto', minHeight: 0, flexShrink: 0 }
            : { minHeight: 32, alignSelf: 'stretch', flexShrink: 0 }),
        ...padding,
        border: isRowSelected ? '1px dashed var(--accent)' : '1px dashed transparent',
        borderRadius: 2,
        position: 'relative',
        background: isOverRow ? 'rgba(0,255,0,0.04)' : 'transparent',
        transition: 'border-color 0.15s, background 0.15s',
        cursor: 'default',
      }}
      onClick={e => { e.stopPropagation(); onSelectRow(row.id, e.shiftKey); }}
    >
      {/* Row label */}
      {isRowSelected && (
        <div style={{
          position: 'absolute', top: -16, left: 0,
          fontSize: 9, color: 'var(--accent)', background: 'var(--bg)',
          padding: '1px 4px', pointerEvents: 'none', zIndex: 10,
          border: '1px solid var(--accent)'
        }}>
          ROW {rowIndex + 1} · {layout.direction === 'row' ? '→' : '↓'} gap:{layout.gap}
        </div>
      )}

      {row.children.map((comp, ci) => (
        <DraggableComponent
          key={comp.id}
          comp={comp}
          rowId={row.id}
          index={ci}
          totalSiblings={row.children.length}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onAddComponent={onAddComponent}
          activeWindow={activeWindow}
          onMoveComponent={onMoveComponent}
          rowDirection={layout.direction}
          topRowId={row.id}
          onNavigate={onNavigate}
          onUpdateComponent={onUpdateComponent}
          onSaveRecord={onSaveRecord}
          database={database}
          editingTextId={editingTextId}
          onStartTextEdit={onStartTextEdit}
          onCommitTextEdit={onCommitTextEdit}
          assets={assets}
          soundSettings={soundSettings}
        />
      ))}

      {/* Empty row placeholder */}
      {row.children.length === 0 && (
        <div style={{
          color: 'var(--text-dim)', fontSize: 10, padding: '8px 12px',
          pointerEvents: 'none', opacity: isOverRow ? 0 : 0.6,
          width: '100%', textAlign: 'center',
        }}>
          [ drop components here ]
        </div>
      )}
    </div>
  );
}

// ─── Between-row drop zone (for creating new rows) ──────────────────────────
function NewRowDropZone({ onDropNewRow, afterIndex }) {
  const [{ isOver }, drop] = useDrop(() => ({
    accept: ['COMPONENT', 'EXISTING_COMPONENT'],
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      const type = item.type !== undefined ? item.type : null;
      onDropNewRow(type, item, afterIndex);
      return { handled: true };
    },
    collect: monitor => ({ isOver: !!monitor.isOver({ shallow: true }) })
  }), [afterIndex, onDropNewRow]);

  return (
    <div
      ref={drop}
      className={`new-row-drop ${isOver ? 'over' : ''}`}
      style={{
        height: isOver ? 40 : 8,
        border: isOver ? '2px dashed var(--accent)' : '1px dashed transparent',
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.15s',
        color: 'var(--accent)',
        fontSize: 10,
        margin: '1px 0',
        background: isOver ? 'rgba(255,255,0,0.05)' : 'transparent',
      }}
    >
      {isOver && '+ New Row'}
    </div>
  );
}

// ─── Main Canvas ────────────────────────────────────────────────────────────
function Canvas({
  rows, selectedIds, onSelect, onDelete, onDuplicate, viewMode, onAddToRow, onAddNewRow,
  onMoveComponent, onSelectRow, activeWindow, screenLayout, database, onNavigate, onUpdateComponent, onSaveRecord,
  editingTextId, onStartTextEdit, onCommitTextEdit,
  assets, soundSettings,
  tutorialHoverBindings = () => ({}),
}) {
  // Drop on empty canvas → new row
  const [{ isOver }, drop] = useDrop(() => ({
    accept: ['COMPONENT'],
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      onAddNewRow(item.type, null);
      return { handled: true };
    },
    collect: monitor => ({ isOver: !!monitor.isOver({ shallow: true }) })
  }), [onAddNewRow]);

  // Resolve screen layout — mobile is independent from desktop (uses its own defaults)
  const sl = screenLayout || {};
  const resolved = viewMode === 'mobile'
    ? { ...DEFAULT_MOBILE_SCREEN_LAYOUT, ...(sl.mobile || {}) }
    : sl;

  const direction = resolved.direction || 'column';
  const gap = resolved.gap != null ? resolved.gap : 0;
  const align = resolved.align || 'stretch';
  const justify = resolved.justify || 'flex-start';
  const wrap = resolved.wrap || false;
  const pTop    = resolved.paddingTop    ?? 20;
  const pRight  = resolved.paddingRight  ?? 20;
  const pBottom = resolved.paddingBottom ?? 20;
  const pLeft   = resolved.paddingLeft   ?? 20;

  return (
    <div className={`canvas ${viewMode}`} {...tutorialHoverBindings('Canvas', 'Canvas')}>
      <div
        ref={drop}
        className="preview-area"
        style={{
          background: isOver ? 'rgba(0,255,0,0.02)' : undefined,
          display: 'flex',
          flexDirection: direction,
          gap: `${gap}px`,
          alignItems: align,
          justifyContent: justify,
          flexWrap: wrap ? 'wrap' : 'nowrap',
          paddingTop: `${pTop}px`,
          paddingRight: `${pRight}px`,
          paddingBottom: `${pBottom}px`,
          paddingLeft: `${pLeft}px`,
        }}
        onClick={() => onSelect(null)}
      >
        {rows.length === 0 && !isOver && (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 40, pointerEvents: 'none' }}>
            [ Drag components from the toolbox to the canvas ]<br />
            [ Each drop creates a new row ]<br />
            [ Select a row to control its layout ]<br />
            [ Delete removes · Ctrl+D duplicates ]
          </div>
        )}

        {rows.map((row, ri) => (
          <React.Fragment key={row.id}>
            {/* Between-row drop zone (before first row) */}
            {ri === 0 && (
              <NewRowDropZone
                afterIndex={0}
                onDropNewRow={(type, item, idx) => {
                  if (type) onAddNewRow(type, null, idx);
                  else if (item?.id) onMoveComponent(item, '__newrow__', 0, idx);
                }}
              />
            )}

            <LayoutRow
                row={row}
                rowIndex={ri}
                selectedIds={selectedIds}
                onSelect={onSelect}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                onAddComponent={(type, rowId, index, parentId, extra) => onAddToRow(type, rowId, index, parentId, extra)}
                activeWindow={activeWindow}
                onMoveComponent={onMoveComponent}
                onDropToRow={onAddToRow}
                onSelectRow={onSelectRow}
                onNavigate={onNavigate}
                onUpdateComponent={onUpdateComponent}
                onSaveRecord={onSaveRecord}
                database={database}
                editingTextId={editingTextId}
                onStartTextEdit={onStartTextEdit}
                onCommitTextEdit={onCommitTextEdit}
                assets={assets}
                soundSettings={soundSettings}
                viewMode={viewMode}
              />

            {/* Between-row drop zone (after each row) */}
            <NewRowDropZone
              afterIndex={ri + 1}
              onDropNewRow={(type, item, idx) => {
                if (type) onAddNewRow(type, null, idx);
                else if (item?.id) onMoveComponent(item, '__newrow__', 0, idx);
              }}
            />
          </React.Fragment>
        ))}

        {/* Overlay Indicators */}
        {rows.some(r => {
          const hasOverlay = (items) => items.some(it => it.type === 'Overlay' || (it.children && hasOverlay(it.children)));
          return hasOverlay(r.children);
        }) && (
          <div style={{ marginTop: 24, borderTop: '1px dashed var(--border)', paddingTop: 16 }}>
            <div style={{ fontSize: 10, color: 'var(--accent)', marginBottom: 10, letterSpacing: 1, fontWeight: 'bold' }}>[ ACTIVE OVERLAYS ]</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {rows.flatMap(r => {
                const getOverlays = (items) => {
                  let found = [];
                  items.forEach(it => {
                    if (it.type === 'Overlay') found.push(it);
                    if (it.children) found = [...found, ...getOverlays(it.children)];
                  });
                  return found;
                };
                return getOverlays(r.children);
              }).map(ov => (
                <div 
                  key={ov.id} 
                  onClick={(e) => { e.stopPropagation(); onSelect(ov.id, e.shiftKey); }}
                  style={{ 
                    padding: '6px 12px', 
                    border: selectedIds && selectedIds.includes(ov.id) ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: selectedIds && selectedIds.includes(ov.id) ? 'var(--selected)' : 'rgba(0,0,0,0.4)',
                    fontSize: 11,
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: selectedIds && selectedIds.includes(ov.id) ? '0 0 15px var(--accent)' : 'none',
                    transition: 'all 0.2s'
                  }}
                >
                  <span style={{ opacity: 0.5, fontSize: 9 }}>OVERLAY:</span> {ov.props.title || 'Untitled'}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Render Open Overlays at top level of Canvas */}
        {rows.flatMap(r => {
           const findOpen = (items) => {
             let found = [];
             items.forEach(it => {
               if (it.type === 'Overlay' && it.props.isOpen) {
                 found.push({ ...it, rowId: r.id });
               }
               if (it.children) found = [...found, ...findOpen(it.children)];
             });
             return found;
           };
           return findOpen(r.children);
        }).map(ov => {
          const OverlayComp = componentMap['Overlay'];
          const childCount = ov.children?.length || 0;
          return (
            <OverlayComp
              key={ov.id}
              {...ov.props}
              id={ov.id}
              onUpdate={(props) => onUpdateComponent(ov.id, props)}
              onAddChild={(type, extra) => onAddToRow(type, ov.rowId, childCount, ov.id, extra)}
              onMoveChild={item => onMoveComponent(item, ov.rowId, childCount, ov.id)}
            >
              {(ov.children || []).map((child, ci) => (
                <DraggableComponent
                  key={child.id}
                  comp={child}
                  rowId={ov.rowId}
                  topRowId={ov.rowId}
                  index={ci}
                  totalSiblings={ov.children.length}
                  selectedIds={selectedIds}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onDuplicate={onDuplicate}
                  onAddComponent={onAddToRow}
                  activeWindow={activeWindow}
                  onMoveComponent={onMoveComponent}
                  rowDirection={ov.props.layout?.direction || 'column'}
                  onNavigate={onNavigate}
                  onUpdateComponent={onUpdateComponent}
                  database={database}
                  assets={assets}
                  soundSettings={soundSettings}
                  onSaveRecord={onSaveRecord}
                  editingTextId={editingTextId}
                  onStartTextEdit={onStartTextEdit}
                  onCommitTextEdit={onCommitTextEdit}
                />
              ))}
            </OverlayComp>
          );
        })}

        
      </div>
    </div>
  );
}

export default Canvas;
