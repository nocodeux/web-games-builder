import React, { useContext } from 'react';
import { DataContext } from './DataRepeater';
import { FormContext } from './Form';

function getThemeColor(val, themeVar) {
  if (!val || val.toLowerCase() === '#00ff00' || val.toLowerCase() === '#000000' || val === 'transparent') return `var(${themeVar})`;
  return val;
}

function ListBox({ 
  items = ['Item 1', 'Item 2', 'Item 3'], 
  optionTable = '',
  optionField = '',
  optionFilterField = '',
  optionFilterValue = '',
  dataField = '',
  width = 150, 
  height = 100, 
  multiSelect = false, 
  textColor = '', 
  borderColor = '', 
  bgColor = '',
  database = { data: {} }
}) {
  const data = useContext(DataContext);
  const formContext = useContext(FormContext);
  
  const resolveTemplates = (txt, dataSource) => {
    if (!txt || !dataSource) return txt;
    return txt.replace(/\{\{(.*?)\}\}/g, (match, field) => {
      const trimmedField = field.trim();
      return dataSource[trimmedField] !== undefined ? String(dataSource[trimmedField]) : match;
    });
  };

  // Resolve items from DB if configured
  let finalItems = items;
  if (optionTable && optionField && database?.data?.[optionTable]) {
    let rows = database.data[optionTable];
    if (optionFilterField && optionFilterValue) {
      const resolvedValue = resolveTemplates(optionFilterValue, data);
      rows = rows.filter(r => String(r[optionFilterField]) === String(resolvedValue));
    }
    finalItems = rows.map(row => row[optionField]).filter(Boolean);
    // Remove duplicates
    finalItems = [...new Set(finalItems)];
  }

  const currentValue = formContext?.formData?.[dataField] || '';

  const handleChange = (e) => {
    if (formContext && dataField) {
      formContext.updateField(dataField, e.target.value);
    }
  };

  return (
    <select 
      className="retro-listbox" 
      multiple={multiSelect} 
      size="4" 
      value={currentValue}
      onChange={handleChange}
      style={{ 
        width: typeof width === 'string' ? width : `${width}px`,
        height: typeof height === 'string' ? height : (height ? `${height}px` : 'auto'), 
        borderColor: getThemeColor(borderColor, '--border'), 
        color: getThemeColor(textColor, '--text'), 
        background: getThemeColor(bgColor, '--input-bg') 
      }}
    >
      {finalItems.map((item, idx) => (
        <option key={idx} value={item}>{item}</option>
      ))}
    </select>
  );
}

export default ListBox;
