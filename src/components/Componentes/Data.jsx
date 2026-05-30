import React from 'react';

function Data({ tableName = '', dataSource = 'sqlite', query = '' }) {
  const queryLabel = dataSource === 'sqlite' ? 'Query' : dataSource === 'json' ? 'JSON Path' : 'API URL';

  return (
    <div className="retro-data" style={{ fontSize: '11px', color: 'var(--text-dim)', padding: '4px 8px', border: '1px dashed var(--border)' }}>
      [DATA] Table: {tableName || 'none'} | Source: {dataSource}
      {query && <div style={{ fontSize: 9, marginTop: 2 }}>{queryLabel}: {query}</div>}
    </div>
  );
}

export default Data;
