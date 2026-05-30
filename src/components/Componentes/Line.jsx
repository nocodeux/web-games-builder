import React from 'react';

const getThemeColor = (val, themeVar) => {
  if (!val || val.toLowerCase() === '#00ff00' || val.toLowerCase() === '#000000' || val === 'transparent') return `var(${themeVar})`;
  return val;
};

function Line({ color = '', thickness = 1, width = '100%', lineStyle = 'solid' }) {
  const borderValue = 
    lineStyle === 'double' ? `${thickness}px double` :
    lineStyle === 'dashed' ? `${thickness}px dashed` :
    `${thickness}px solid`;

  // Asegurar que el ancho se maneje correctamente como px o %
  const finalWidth = typeof width === 'number' ? `${width}px` : (width || '100%');

  return (
    <div style={{
      width: finalWidth,
      borderTop: `${borderValue} ${getThemeColor(color, '--text')}`,
      margin: '8px 0',
      height: 0,
      boxSizing: 'border-box',
      flexShrink: 0 // Evitar que colapse en flex layouts
    }} />
  );
}

export default Line;
