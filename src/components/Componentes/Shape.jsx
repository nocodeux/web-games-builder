import React from 'react';

const getThemeColor = (val, themeVar) => {
  if (!val || val.toLowerCase() === '#00ff00' || val.toLowerCase() === '#000000' || val === 'transparent') return `var(${themeVar})`;
  return val;
};

function Shape({ shapeType = 'rectangle', width = 60, height = 40, borderColor = '', bgColor = '', fill = false }) {
  const style = {
    width: typeof width === 'string' ? width : `${width}px`,
    height: typeof height === 'string' ? height : (height ? `${height}px` : 'auto'),
    border: `1px solid ${getThemeColor(borderColor, '--text')}`,
    backgroundColor: fill ? getThemeColor(bgColor, '--text') : 'transparent',
    display: 'inline-block',
    verticalAlign: 'middle'
  };

  if (shapeType === 'circle') {
    return <div style={{ ...style, borderRadius: '50%' }} />;
  }
  if (shapeType === 'square') {
    return <div style={{ ...style, width: `${height}px` }} />;
  }
  return <div style={style} />;
}

export default Shape;
