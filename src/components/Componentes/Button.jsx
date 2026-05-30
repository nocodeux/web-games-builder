import React, { useContext, useRef } from 'react';
import { DataContext } from './DataRepeater';
import { FormContext } from './Form';
import { playInteractionSound } from '../../lib/interactionAudio';
import { resolveDatabaseRecord } from '../../lib/databaseBinding';

const getThemeColor = (val, themeVar) => {
  if (!val || val.toLowerCase() === '#00ff00' || val.toLowerCase() === '#000000' || val === 'transparent') return `var(${themeVar})`;
  return val;
};

function Button({
  text = 'Button1',
  variant = 'default',
  bgColor = '',
  textColor = '',
  borderColor = '',
  width = 80,
  sizing = {},
  disabled = false,
  onClick,
  dataSourceType = 'manual',
  database = null,
  dataSourceTable = '',
  dataFilterField = '',
  dataFilterValue = '',
  dataField = '',
  action = 'none',
  iconLeftSrc = '',
  iconLeftUrl = '',
  iconRightSrc = '',
  iconRightUrl = '',
  iconSize = 12,
  soundActions = null,
  soundSettings = null,
  assets = null,
  onSaveRecord
}) {
  const data = useContext(DataContext);
  const formContext = useContext(FormContext);
  const fileInputRef = useRef(null);
  const pointerStartRef = useRef(null);

  const isHug = sizing?.widthMode === 'hug' || !sizing?.widthMode;
  const cssWidth = sizing?.widthMode === 'fill' ? '100%'
    : isHug ? 'max-content'
    : (typeof width === 'number' ? `${width}px`
       : (typeof width === 'string' && width.includes('%')) ? width
       : 'auto');
  const hasIcon = !!(iconLeftSrc || iconLeftUrl || iconRightSrc || iconRightUrl);
  
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

  const resolvedText = (dataSourceType === 'database' && sourceData && dataField)
    ? String(sourceData[dataField] ?? text)
    : text;
  const iconOnly = hasIcon && !resolvedText?.trim();

  const renderIcon = (src) => {
    const resolved = (src || '').trim();
    if (!resolved) return null;
    // Use the exact same encoding as the IconPicker — works reliably for CSS mask-image.
    // Detect SVG markup anywhere in the string (handles <?xml ...?> preambles).
    const isSvg = resolved.includes('<svg');
    const maskUrl = isSvg
      ? `url("data:image/svg+xml,${resolved.replace(/"/g, "'").replace(/#/g, '%23').replace(/[\n\r]/g, '').replace(/\s+/g, ' ')}")`
      : `url("${resolved}")`;
    return (
      <span
        aria-hidden="true"
        style={{
          width: iconSize,
          height: iconSize,
          display: 'inline-block',
          flexShrink: 0,
          backgroundColor: 'currentColor',
          maskImage: maskUrl,
          WebkitMaskImage: maskUrl,
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
        }}
      />
    );
  };

  const handleClick = (e) => {
    playInteractionSound(soundSettings, assets, 'click', soundActions);
    if (onClick) onClick(e);
    
    if (action === 'submit' && formContext && onSaveRecord) {
      if (formContext.targetTable) {
        onSaveRecord(formContext.targetTable, formContext.formData);
        formContext.setFormData({}); // Clear form after submit
        alert(`Data saved to ${formContext.targetTable}!`);
      } else {
        alert('Form has no target table selected.');
      }
    }

    if (action === 'upload' && formContext && dataField && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && formContext && dataField) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        formContext.updateField(dataField, ev.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <>
      <button
        className={`retro-button${variant && variant !== 'default' ? ` retro-button--${variant}` : ''}`}
        disabled={disabled}
        onMouseEnter={() => playInteractionSound(soundSettings, assets, 'hover', soundActions)}
        onPointerDown={e => { pointerStartRef.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={e => {
          const start = pointerStartRef.current;
          pointerStartRef.current = null;
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 28) {
            playInteractionSound(soundSettings, assets, 'swipe', soundActions);
          }
        }}
        onClick={handleClick}
        style={{
          width: iconOnly ? undefined : cssWidth,
          ...(iconOnly ? { aspectRatio: '1 / 1', padding: 4 } : isHug ? { flexShrink: 0 } : {}),
          '--button-bg': bgColor || 'transparent',
          '--button-text': getThemeColor(textColor, '--text'),
          '--button-border': getThemeColor(borderColor, '--text'),
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: hasIcon && !iconOnly ? 6 : 0,
        }}
      >
        {renderIcon(iconLeftSrc || iconLeftUrl)}
        {!iconOnly && <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{resolvedText}</span>}
        {renderIcon(iconRightSrc || iconRightUrl)}
      </button>
      {action === 'upload' && formContext && dataField && (
        <input 
          type="file" 
          ref={fileInputRef}
          style={{ display: 'none' }} 
          accept="image/*,.gif,.pdf"
          onChange={handleFileChange}
        />
      )}
    </>
  );
}

export default Button;
