import React from 'react';

const getThemeColor = (val, themeVar) => {
  if (!val || val.toLowerCase() === '#00ff00' || val.toLowerCase() === '#000000' || val === 'transparent') return `var(${themeVar})`;
  return val;
};

function Table({
  columns = [],
  rows = [],
  width = 400,
  height = 200,
  showHeaders = true,
  stripedRows = true,
  borderColor = '',
  textColor = '',
  headerBgColor = '',
}) {
  return (
    <div
      className="retro-table-wrapper"
      style={{
        width: typeof width === 'string' && width.includes('%') ? width : (width ? `${width}px` : '100%'),
        maxHeight: typeof height === 'string' && height.includes('%') ? height : (height ? `${height}px` : 'auto'),
        height: typeof height === 'string' && height.includes('%') ? height : 'auto',
        overflow: 'auto',
        border: `1px solid ${getThemeColor(borderColor, '--border')}`,
      }}
    >
      <table
        className="retro-table"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'monospace',
          fontSize: 11,
        }}
      >
        {showHeaders && (
          <thead>
            <tr>
              {columns.map((col, ci) => (
                <th
                  key={ci}
                  style={{
                    border: `1px solid ${getThemeColor(borderColor, '--border')}`,
                    padding: '4px 8px',
                    textAlign: 'left',
                    fontSize: 10,
                    color: getThemeColor(textColor, '--accent'),
                    background: headerBgColor || 'var(--selected)',
                    whiteSpace: 'nowrap',
                    width: col.width ? `${col.width}px` : 'auto',
                  }}
                >
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              style={{
                background: stripedRows && ri % 2 === 1 ? 'rgba(255,255,255,0.03)' : 'transparent',
              }}
            >
              {columns.map((col, ci) => (
                <td
                  key={ci}
                  style={{
                    border: `1px solid ${getThemeColor(borderColor, '--border')}`,
                    padding: '4px 8px',
                    fontSize: 11,
                    color: getThemeColor(textColor, '--text'),
                  }}
                >
                  {String(row[col.name] ?? '') || '\u00A0'}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length || 1}
                style={{
                  padding: '12px',
                  textAlign: 'center',
                  fontSize: 10,
                  color: 'var(--text-dim)',
                  border: `1px solid ${borderColor || 'var(--border)'}`,
                }}
              >
                [ No data ]
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default Table;
