import React, { useContext } from 'react';
import { DataContext } from './DataRepeater';
import { FormContext } from './Form';
import { resolveDatabaseRecord } from '../../lib/databaseBinding';

const getThemeColor = (val, themeVar) => {
  if (!val || val.toLowerCase() === '#00ff00' || val.toLowerCase() === '#000000' || val === 'transparent') return `var(${themeVar})`;
  return val;
};

function RetroRadio({ checked, onChange, disabled }) {
  return (
    <span
      onClick={disabled ? undefined : onChange}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 14, height: 14, flexShrink: 0,
        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '50%',
        background: 'var(--bg)',
        cursor: disabled ? 'default' : 'pointer',
        userSelect: 'none',
        boxSizing: 'border-box',
      }}
    >
      {checked && (
        <span style={{
          width: 6, height: 6,
          borderRadius: '50%',
          background: 'var(--accent)',
          flexShrink: 0,
        }} />
      )}
    </span>
  );
}

function RadioButton({
  text = 'Option1',
  checked = false,
  group = 'group1',
  textColor = '',
  database = null,
  dataSourceTable = '',
  dataFilterField = '',
  dataFilterValue = '',
  dataField = '',
  dataSourceType = 'manual'
}) {
  const data = useContext(DataContext);
  const formContext = useContext(FormContext);

  const resolveTemplates = (txt, dataSource) => {
    if (!txt || !dataSource) return txt;
    return txt.replace(/\{\{(.*?)\}\}/g, (_, field) => {
      const f = field.trim();
      return dataSource[f] !== undefined ? String(dataSource[f]) : `{{${f}}}`;
    });
  };

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

  const resolvedText = (dataSourceType === 'database' && sourceData)
    ? resolveTemplates(text, sourceData)
    : text;

  const isChecked = (formContext && dataField)
    ? formContext.formData[dataField] === text
    : checked;

  const handleSelect = () => {
    if (formContext && dataField) {
      formContext.updateField(dataField, text);
    }
  };

  const disabled = !formContext || !dataField;

  return (
    <label
      className="retro-radio"
      style={{ color: getThemeColor(textColor, '--text'), display: 'inline-flex', alignItems: 'center', gap: 6, cursor: disabled ? 'default' : 'pointer' }}
    >
      <RetroRadio checked={isChecked} onChange={handleSelect} disabled={disabled} />
      <span>{resolvedText}</span>
    </label>
  );
}

export default RadioButton;
