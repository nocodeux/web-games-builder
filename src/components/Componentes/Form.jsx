import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { DataContext } from './DataRepeater';

export const FormContext = createContext(null);

function Form({ 
  children, 
  targetTable = '', 
  sourceTable = '',
  filterField = '',
  filterValue = '',
  padding = 10,
  layout = {},
  database = { data: {}, schema: [] }
}) {
  const parentData = useContext(DataContext);
  const [formData, setFormData] = useState({});
  const initialDataLoaded = useRef(false);

  const resolveTemplates = (txt, dataSource) => {
    if (!txt || !dataSource) return txt;
    return txt.replace(/\{\{(.*?)\}\}/g, (match, field) => {
      const trimmedField = field.trim();
      return dataSource[trimmedField] !== undefined ? String(dataSource[trimmedField]) : match;
    });
  };

  useEffect(() => {
    if (sourceTable && filterField && filterValue && database?.data?.[sourceTable]) {
      const records = database.data[sourceTable];
      const resolvedValue = resolveTemplates(filterValue, parentData);
      const valStr = String(resolvedValue).trim();
      const record = records.find(r => String(r[filterField]) === valStr);
      
      if (record && !initialDataLoaded.current) {
        setFormData(record);
        initialDataLoaded.current = true;
      }
    }
  }, [sourceTable, filterField, filterValue, database, parentData]);

  // Reset flag if source changes
  useEffect(() => {
    initialDataLoaded.current = false;
  }, [sourceTable, filterField, filterValue]);

  const updateField = (fieldName, value) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
  };

  const style = {
    padding: `${padding}px`,
    width: '100%',
    minHeight: '40px',
    border: '1px dashed var(--border)',
    background: 'rgba(255, 255, 255, 0.02)',
    display: 'flex',
    flexDirection: layout.direction || 'column',
    gap: `${layout.gap || 8}px`,
    alignItems: layout.align || 'stretch',
    justifyContent: layout.justify || 'flex-start',
    flexWrap: layout.wrap ? 'wrap' : 'nowrap',
    boxSizing: 'border-box'
  };

  return (
    <FormContext.Provider value={{ targetTable, formData, updateField, setFormData }}>
      <DataContext.Provider value={formData}>
        <div className="retro-form" style={style}>
          {children}
        </div>
      </DataContext.Provider>
    </FormContext.Provider>
  );
}

export default Form;
