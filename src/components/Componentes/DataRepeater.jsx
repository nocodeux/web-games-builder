import React from 'react';

export const DataContext = React.createContext(null);

function DataRepeater({ 
  children, 
  tableName, 
  database, 
  layout = { direction: 'column', gap: 8, align: 'stretch', justify: 'flex-start' },
  width = '100%',
  height = 'auto',
  onAddChild,
  onMoveChild,
  filterField = '',
  filterValue = ''
}) {
  let records = database?.data?.[tableName] || [];

  if (filterField && filterValue) {
    records = records.filter(r => String(r[filterField]) === String(filterValue));
  }

  const style = {
    display: 'flex',
    flexDirection: layout.direction || 'column',
    gap: layout.gap || 8,
    alignItems: layout.align || 'stretch',
    justifyContent: layout.justify || 'flex-start',
    width: typeof width === 'string' ? width : `${width}px`,
    height: typeof height === 'string' ? height : (height ? `${height}px` : 'auto'),
    minHeight: 40,
    border: '1px dashed var(--accent)',
    borderRadius: 4,
    padding: 8,
    position: 'relative'
  };

  // In the editor, we want to see the children even if there are no records yet.
  // We'll use one empty record as a fallback for the template.
  const previewRecords = records.length > 0 ? records.slice(0, 3) : [{}];
  const hasChildren = React.Children.count(children) > 0;

  return (
    <div style={style}>
      <div style={{ position: 'absolute', top: -14, left: 4, fontSize: 8, color: 'var(--accent)', background: 'var(--bg)', padding: '0 4px', border: '1px solid var(--accent)', borderRadius: 2, zIndex: 10 }}>
        REPEATER: {tableName || 'No Table'} ({records.length} items)
      </div>
      
      {!hasChildren && (
        <div style={{ 
          border: '1px dashed var(--accent)', 
          padding: 20, 
          textAlign: 'center', 
          fontSize: 10, 
          color: 'var(--accent)',
          background: 'rgba(0,255,0,0.05)',
          width: '100%'
        }}>
          DRAG COMPONENTS HERE TO CREATE THE TEMPLATE
        </div>
      )}

      {hasChildren && previewRecords.map((record, index) => (
        <DataContext.Provider key={index} value={record}>
          <div className="repeater-item-preview" style={{ 
            border: '1px dotted var(--border)', 
            padding: 8, 
            borderRadius: 2,
            position: 'relative',
            background: 'rgba(0,255,0,0.02)',
            minHeight: 30,
            width: '100%',
            marginBottom: index < previewRecords.length - 1 ? layout.gap || 8 : 0
          }}>
            <div style={{ position: 'absolute', right: 2, top: 2, fontSize: 7, color: 'var(--text-dim)', opacity: 0.5 }}>
              {records.length > 0 ? `#${index + 1}` : 'TEMPLATE'}
            </div>
            {children}
          </div>
        </DataContext.Provider>
      ))}

      {records.length > 3 && hasChildren && (
        <div style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'center', marginTop: 4 }}>
          + {records.length - 3} more items hidden in editor
        </div>
      )}
      
      {!tableName && hasChildren && (
        <div style={{ fontSize: 8, color: '#ff6666', textAlign: 'center', marginTop: 4 }}>
          (No table selected - template only)
        </div>
      )}
    </div>
  );
}


export default DataRepeater;
