import React, { useContext } from 'react';
import { FormContext } from './Form';

const getThemeColor = (val, themeVar) => {
  if (!val || val.toLowerCase() === '#00ff00' || val.toLowerCase() === '#000000' || val === 'transparent') return `var(${themeVar})`;
  return val;
};

function TextBox({ 
  label = '',
  placeholder = 'Enter text...', 
  width = 150, 
  maxLength = 0, 
  readOnly = false, 
  disabled = false, 
  textColor = '', 
  borderColor = '', 
  bgColor = '', 
  inputType = 'text',
  isOTP = false,
  digits = 4,
  dataField = ''
}) {
  const formContext = useContext(FormContext);
  const value = (formContext && dataField) ? (formContext.formData[dataField] || '') : '';
  const onChange = (e) => {
    if (formContext && dataField) {
      formContext.updateField(dataField, e.target.value);
    }
  };

  const finalWidth = typeof width === 'string' && width.includes('%') ? width : `${width}px`;

  if (isOTP) {
    const digitCount = parseInt(digits) || 4;
    return (
      <div className="property-group" style={{ width: 'auto' }}>
        {label && <label>{label}</label>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {Array.from({ length: digitCount }).map((_, i) => (
            <React.Fragment key={i}>
              <input
                type="text"
                className="retro-textbox"
                maxLength={1}
                disabled={disabled}
                readOnly={readOnly}
                style={{
                  width: 36,
                  height: 42,
                  textAlign: 'center',
                  fontSize: 18,
                  borderColor: getThemeColor(borderColor, '--text'),
                  color: getThemeColor(textColor, '--text'),
                  background: getThemeColor(bgColor, '--input-bg')
                }}
              />
              {digitCount === 6 && i === 2 && <span style={{ color: 'var(--border)' }}>-</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="property-group" style={{ width: finalWidth }}>
      {label && <label>{label}</label>}
      <input
        type={inputType}
        className="retro-textbox"
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        value={value}
        onChange={onChange}
        maxLength={maxLength > 0 ? maxLength : undefined}
        style={{
          width: '100%',
          borderColor: getThemeColor(borderColor, '--text'),
          color: getThemeColor(textColor, '--text'),
          background: getThemeColor(bgColor, '--input-bg')
        }}
      />
    </div>
  );
}

export default TextBox;
