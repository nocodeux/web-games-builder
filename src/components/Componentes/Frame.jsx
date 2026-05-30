import React, { useContext } from 'react';
import { useDrop } from 'react-dnd';
import { DataContext } from './DataRepeater';
import { resolveDatabaseRecord } from '../../lib/databaseBinding';

function Frame({
  title = 'Frame1',
  width = 300,
  height = '',
  borderStyle = 'single',
  bgColor = '',
  textColor = '',
  borderColor = '',
  fontSize = 12,
  alignment = 'left',
  layout = { direction: 'row', gap: 8, align: 'flex-start', justify: 'flex-start', wrap: false },
  children,
  onAddChild,
  onMoveChild,
  dataSourceType = 'manual',
  database = null,
  dataSourceTable = '',
  dataFilterField = '',
  dataFilterValue = '',
  dataField = '',
  id
}) {
  const data = useContext(DataContext);
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
  const [{ isOver }, drop] = useDrop(() => ({
    accept: ['COMPONENT', 'EXISTING_COMPONENT'],
    drop: (item, monitor) => {
      console.log(`📍 [DEBUG] Frame drop: id=${id}, type=${item.type}, isNew=${!item.id}`);
      // Si el drop ya fue manejado por un hijo (otro container anidado), ignorar
      if (monitor.didDrop()) {
        console.log(`   -> Frame Ignored: Already handled by child`);
        return;
      }

      if (item.id === undefined) {
        // Viene del Toolbox — agregar como hijo del Frame
        console.log(`   -> Frame: Adding NEW component ${item.type}`);
        if (onAddChild) onAddChild(item.type);
      } else if (item.id && onMoveChild) {
        console.log(`   -> Frame: Moving EXISTING component ${item.id}`);
        onMoveChild(item);
      }
      // Si es EXISTING_COMPONENT (reordenar) no hacemos nada aquí —
      // el reordenamiento entre filas lo maneja el Canvas
      return { handled: true };
    },
    // Solo mostrar como drop target cuando el cursor está directamente aquí
    collect: (monitor) => ({
      isOver: !!monitor.isOver({ shallow: true })
    })
  }), [onAddChild, onMoveChild]);

  const borderValue =
    borderStyle === 'double' ? '3px double' :
    borderStyle === 'dashed' ? '1px dashed' :
    '1px solid';

  return (
    <div className="retro-frame-wrapper" style={{ width: typeof width === 'string' ? width : `${width}px` }}>
      <fieldset
        ref={drop}
        className="retro-frame"
        style={{
          border: `${borderValue} ${borderColor || 'var(--border)'}`,
          background: bgColor || 'transparent',
          height: typeof height === 'string' ? height : (height ? `${height}px` : 'auto'),
          outline: isOver ? `2px dashed var(--accent)` : 'none',
          outlineOffset: -2,
          transition: 'outline 0.1s',
        }}
      >
        <legend style={{ 
          color: textColor || 'var(--accent)',
          fontSize: fontSize ? `${fontSize}px` : 'inherit',
          textAlign: alignment
        }}>{resolvedTitle}</legend>
        <div
          className="retro-frame-content"
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
          }}
        >
          {children}
          {isOver && (
            <div className="drop-indicator">[+ drop here +]</div>
          )}
        </div>
      </fieldset>
    </div>
  );
}

export default Frame;
