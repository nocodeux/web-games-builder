import React, { useState } from 'react';

const getThemeColor = (val, themeVar) => {
  if (!val || val.toLowerCase() === '#00ff00' || val.toLowerCase() === '#000000' || val === 'transparent') return `var(${themeVar})`;
  return val;
};

function ScrollBar({ value = 50, min = 0, max = 100, width = 150, height = 100, bgColor = '', thumbColor = '', onChange }) {
  const isHorizontal = width > height;
  const [currentValue, setCurrentValue] = useState(value);
  const percentage = max > min ? ((currentValue - min) / (max - min)) * 100 : 0;

  const handleClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickPos = isHorizontal ? e.clientX - rect.left : e.clientY - rect.top;
    const total = isHorizontal ? rect.width : rect.height;
    const newPercentage = Math.min(100, Math.max(0, (clickPos / total) * 100));
    const newValue = min + (newPercentage / 100) * (max - min);
    setCurrentValue(Math.round(newValue));
    if (onChange) onChange(Math.round(newValue));
  };

  const barStyle = isHorizontal
    ? { width: `${width}px`, height: '12px' }
    : { width: '12px', height: `${height}px` };

  const thumbStyle = isHorizontal
    ? { width: `${percentage}%`, height: '100%' }
    : { width: '100%', height: `${percentage}%` };

  return (
    <div className="retro-scrollbar" style={{ ...barStyle, background: getThemeColor(bgColor, '--input-bg'), border: '1px solid var(--border)' }} onClick={handleClick}>
      <div style={{ ...thumbStyle, background: getThemeColor(thumbColor, '--text'), opacity: 0.5 }} />
    </div>
  );
}

export default ScrollBar;
