import React, { useContext, useRef, useState, useEffect } from 'react';
import { DataContext } from './DataRepeater';
import { FormContext } from './Form';
import { resolveDatabaseRecord } from '../../lib/databaseBinding';

function useIsPortrait() {
  const [portrait, setPortrait] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(orientation: portrait)').matches
      : false
  );
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const handler = e => setPortrait(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return portrait;
}

const getThemeColor = (val, themeVar) => {
  if (!val || val.toLowerCase() === '#00ff00' || val.toLowerCase() === '#000000' || val === 'transparent') return `var(${themeVar})`;
  return val;
};

function Image({
  src = '',
  srcPortrait = '',
  srcLandscape = '',
  width = 80,
  height = 80,
  alt = 'Image',
  iconSrc = '',
  iconColor = '',
  borderThickness = 1,
  borderColor = '',
  sizing = {},
  dataSourceType = 'manual',
  database = null,
  dataSourceTable = '',
  dataFilterField = '',
  dataFilterValue = '',
  dataField = '',
  requireLogin = false
}) {
  const data = useContext(DataContext);
  const formContext = useContext(FormContext);
  const fileInputRef = useRef(null);
  const isAuthenticated = false; // Simulated auth state
  const isPortrait = useIsPortrait();

  let resolvedSrc = (isPortrait && srcPortrait) ? srcPortrait
    : (!isPortrait && srcLandscape) ? srcLandscape
    : src;
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

  if (dataSourceType === 'database') {
    if (requireLogin && !isAuthenticated) {
      resolvedSrc = '';
    } else if (formContext && formContext.formData && dataField) {
      resolvedSrc = formContext.formData[dataField] || src;
    } else if (sourceData && dataField) {
      resolvedSrc = String(sourceData[dataField] ?? '');
    }
  }

  const handleImageClick = () => {
    if (formContext && dataField && fileInputRef.current) {
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

  const isWidthFill = sizing.widthMode === 'fill';
  const isHeightFill = sizing.heightMode === 'fill';
  const isWidthHug = sizing.widthMode === 'hug';
  const isHeightHug = sizing.heightMode === 'hug';

  if (dataSourceType === 'database' && requireLogin && !isAuthenticated) {
    return (
      <div style={{
        width: isWidthFill ? '100%' : (isWidthHug ? 'auto' : `${width}px`),
        height: isHeightFill ? '100%' : (isHeightHug ? 'auto' : `${height}px`),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,0,0,0.1)', border: '1px dashed #ff4444',
        color: '#ff4444', fontSize: 10, textAlign: 'center', padding: 8
      }}>
        [ Private Content Needs Login ]
      </div>
    );
  }

  const isSvg = resolvedSrc && (resolvedSrc.toLowerCase().endsWith('.svg') || resolvedSrc.startsWith('data:image/svg+xml'));
  const bThick = borderThickness !== undefined ? borderThickness : 1;
  const bColor = getThemeColor(borderColor, '--border');

  const resolvedW = (typeof width === 'number' && width > 0) ? width : (typeof width === 'string' && width !== 'auto' ? parseInt(width, 10) || 80 : 80);
  const resolvedH = (typeof height === 'number' && height > 0) ? height : (typeof height === 'string' && height !== 'auto' ? parseInt(height, 10) || 80 : 80);
  const containerStyle = {
    width: sizing.widthMode === 'fill' ? '100%' : (isWidthHug ? 'auto' : `${resolvedW}px`),
    height: sizing.heightMode === 'fill' ? '100%' : (isHeightHug ? 'auto' : `${resolvedH}px`),
    border: bThick > 0 ? `${bThick}px solid ${bColor}` : 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: 'transparent',
    cursor: (formContext && dataField) ? 'pointer' : 'default'
  };

  const imgStyle = {
    width: isWidthHug ? 'auto' : '100%',
    height: isHeightHug ? 'auto' : '100%',
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain'
  };

  const finalIconColor = getThemeColor(iconColor, '--accent');

  // Si hay iconSrc (de la librería interna), lo priorizamos
  if (iconSrc) {
    const b64 = btoa(unescape(encodeURIComponent(iconSrc)));
    const dataUri = `data:image/svg+xml;base64,${b64}`;
    return (
      <div style={containerStyle}>
        <div style={{
          ...imgStyle,
          backgroundColor: finalIconColor,
          maskImage: `url("${dataUri}")`,
          maskRepeat: 'no-repeat',
          maskPosition: 'center',
          maskSize: 'contain',
          WebkitMaskImage: `url("${dataUri}")`,
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          WebkitMaskSize: 'contain',
        }} />
      </div>
    );
  }

  // Si es un SVG por URL/DataURI y tenemos color, usamos MASK para poder teñirlo
  if (isSvg && iconColor) {
    return (
      <div style={containerStyle}>
        <div style={{
          ...imgStyle,
          width: isWidthHug ? (width ? `${width}px` : '40px') : '100%',
          height: isHeightHug ? (height ? `${height}px` : '40px') : '100%',
          minWidth: isWidthHug ? 20 : 0,
          minHeight: isHeightHug ? 20 : 0,
          backgroundColor: finalIconColor,
          maskImage: `url("${resolvedSrc}")`,
          maskRepeat: 'no-repeat',
          maskPosition: 'center',
          maskSize: 'contain',
          WebkitMaskImage: `url("${resolvedSrc}")`,
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          WebkitMaskSize: 'contain',
        }} />
      </div>
    );
  }

  // Comportamiento normal para imágenes
  return (
    <div style={containerStyle} onClick={handleImageClick}>
      {resolvedSrc ? (
        <img 
          src={resolvedSrc} 
          alt={alt} 
          style={imgStyle} 
        />
      ) : (
        <div style={{ fontSize: '10px', color: 'var(--text-dim)', textAlign: 'center', padding: '4px' }}>
          {formContext && dataField ? '[CLICK TO UPLOAD]' : `[IMG ${width}x${height}]`}
        </div>
      )}
      {formContext && dataField && (
        <input 
          type="file" 
          ref={fileInputRef}
          style={{ display: 'none' }} 
          accept="image/*,.gif"
          onChange={handleFileChange}
        />
      )}
    </div>
  );
}

export default Image;
