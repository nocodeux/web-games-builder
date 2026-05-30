import React, { useContext } from 'react';
import { DataContext } from './DataRepeater';
import { FormContext } from './Form';
import { playInteractionSound, getInteractionAssets, getInteractionSettings } from '../../lib/interactionAudio';
import { resolveDatabaseRecord } from '../../lib/databaseBinding';

const getThemeColor = (val, themeVar) => {
  if (!val || val.toLowerCase() === '#00ff00' || val.toLowerCase() === '#000000' || val === 'transparent') return `var(${themeVar})`;
  return val;
};

function RetroCheckbox({ checked, onChange, disabled }) {
  return (
    <span
      onClick={disabled ? undefined : onChange}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 14, height: 14, flexShrink: 0,
        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
        background: checked ? 'var(--accent)' : 'var(--bg)',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'monospace', fontSize: 10, lineHeight: 1,
        color: checked ? 'var(--bg)' : 'transparent',
        userSelect: 'none',
        boxSizing: 'border-box',
      }}
    >✓</span>
  );
}

function CheckBox({
  text = 'CheckBox1',
  checked = false,
  textColor = '',
  database = null,
  dataSourceTable = '',
  dataFilterField = '',
  dataFilterValue = '',
  dataField = '',
  dataSourceType = 'manual',
  soundSettings = null,
  assets = null,
  soundActions = null,
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
    ? !!formContext.formData[dataField]
    : checked;

  const handleToggle = () => {
    playInteractionSound(getInteractionSettings(soundSettings), getInteractionAssets(assets), 'click', soundActions);
    if (formContext && dataField) {
      formContext.updateField(dataField, !formContext.formData[dataField]);
    }
  };

  const disabled = !formContext || !dataField;

  return (
    <label
      className="retro-checkbox"
      style={{ color: getThemeColor(textColor, '--text'), display: 'inline-flex', alignItems: 'center', gap: 6, cursor: disabled ? 'default' : 'pointer' }}
    >
      <RetroCheckbox checked={isChecked} onChange={handleToggle} disabled={disabled} />
      <span>{resolvedText}</span>
    </label>
  );
}

export default CheckBox;
