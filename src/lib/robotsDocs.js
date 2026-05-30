export const DEFAULT_ROBOTS_CONFIG = {
  enabled: true,
  experience: 'both', // human | agent | both
  humanLandingDoc: '',
  agentLandingDoc: '',
  documents: [],
  generatedProjectDoc: '',
  generatedAt: '',
};

const listComponentTypes = (rows = []) => {
  const acc = new Map();
  const walk = (items = []) => {
    for (const item of items) {
      if (!item) continue;
      const type = item.type || 'Unknown';
      acc.set(type, (acc.get(type) || 0) + 1);
      if (Array.isArray(item.children) && item.children.length) walk(item.children);
    }
  };
  walk(rows);
  return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};

const countRows = (rows = []) => rows.reduce((sum, row) => sum + 1 + countRows(row.children || []), 0);

export function normalizeRobotsConfig(config) {
  const src = config || {};
  return {
    ...DEFAULT_ROBOTS_CONFIG,
    ...src,
    experience: ['human', 'agent', 'both'].includes(src.experience) ? src.experience : DEFAULT_ROBOTS_CONFIG.experience,
    documents: Array.isArray(src.documents) ? src.documents.map(doc => ({
      id: doc.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: doc.name || 'document',
      kind: doc.kind === 'md' ? 'md' : 'txt',
      content: String(doc.content || ''),
      scope: doc.scope === 'agent' ? 'agent' : 'human',
      source: doc.source || 'manual',
      updatedAt: doc.updatedAt || new Date().toISOString(),
    })) : [],
  };
}

export function buildProjectRobotsDoc({
  builderName = 'TUI Builder',
  project = {},
  screens = [],
  database = { tables: [], data: {}, externalConnections: [] },
  assets = { sprites: [], tilesets: [], sounds: [], backgrounds: [], videos: [] },
}) {
  const screenList = (screens || []).map(screen => {
    const rows = screen.rows || [];
    const components = listComponentTypes(rows);
    return {
      name: screen.name || screen.id,
      kind: screen.kind || 'page',
      rowCount: rows.length,
      componentCount: countRows(rows),
      components,
      isWorld: screen.kind === 'world',
    };
  });

  const dbTables = (database.tables || []).map(table => ({
    name: table.name,
    rows: (database.data?.[table.name] || []).length,
    fields: (table.fields || []).length,
  }));

  const assetSummary = {
    sprites: assets?.sprites?.length || 0,
    tilesets: assets?.tilesets?.length || 0,
    sounds: assets?.sounds?.length || 0,
    backgrounds: assets?.backgrounds?.length || 0,
    videos: assets?.videos?.length || 0,
  };

  const lines = [];
  lines.push(`# ${builderName} Project Documentation`);
  lines.push('');
  lines.push(`Project: ${project.name || 'Untitled'}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Screens');
  if (screenList.length === 0) {
    lines.push('- No screens yet.');
  } else {
    for (const screen of screenList) {
      lines.push(`- ${screen.name} [${screen.kind}] - ${screen.rowCount} rows, ${screen.componentCount} components`);
      if (screen.components.length) {
        lines.push(`  - Components: ${screen.components.map(([type, count]) => `${type} (${count})`).join(', ')}`);
      }
    }
  }
  lines.push('');
  lines.push('## Database');
  lines.push(`- Tables: ${dbTables.length}`);
  lines.push(`- Records: ${Object.values(database.data || {}).reduce((sum, rows) => sum + (rows?.length || 0), 0)}`);
  if (dbTables.length) {
    for (const table of dbTables) {
      lines.push(`- ${table.name}: ${table.rows} rows, ${table.fields} fields`);
    }
  }
  lines.push('');
  lines.push('## Assets');
  lines.push(`- Sprites: ${assetSummary.sprites}`);
  lines.push(`- Tilesets: ${assetSummary.tilesets}`);
  lines.push(`- Sounds: ${assetSummary.sounds}`);
  lines.push(`- Backgrounds: ${assetSummary.backgrounds}`);
  lines.push(`- Videos: ${assetSummary.videos}`);
  lines.push('');
  lines.push('## External Databases');
  const ext = database.externalConnections || [];
  if (ext.length === 0) {
    lines.push('- None configured.');
  } else {
    for (const conn of ext) {
      lines.push(`- ${conn.name || conn.id} [${String(conn.type || 'sql').toUpperCase()}] linked to ${conn.targetTable || 'no table'}`);
    }
  }
  lines.push('');
  lines.push('## Agent Notes');
  lines.push('- Keep human and agent experiences separate.');
  lines.push('- Prefer structured metadata over free-form assumptions.');
  return lines.join('\n');
}

export function serializeRobotsTxt(config, docPath = '/docs/project.md') {
  const cfg = normalizeRobotsConfig(config);
  const lines = [
    'User-agent: *',
    cfg.enabled === false ? 'Disallow: /' : 'Allow: /',
    `# Experience: ${cfg.experience}`,
    `# Docs: ${docPath}`,
  ];
  return lines.join('\n');
}
