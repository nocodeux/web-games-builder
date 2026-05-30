export function renderDocsPage() {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TUIFY Docs</title>
<meta name="description" content="TUIFY component reference, API docs, and MCP setup guide">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:       #0a0a0a;
  --panel-bg: #0c0c0c;
  --border:   #2a5a2a;
  --text:     #33ff33;
  --text-dim: #1a7a1a;
  --accent:   #ffaa00;
  --selected: #1e3a1e;
}

html, body {
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: 'Courier New', Courier, monospace;
  font-size: 13px;
}

body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  min-height: 100vh;
  padding: 24px 16px;
}

/* ── Panel shell ── */
.docs-panel {
  width: 100%;
  max-width: 1100px;
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  background: var(--panel-bg);
  min-height: 0;
}

/* ── Header ── */
.docs-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(0,0,0,0.3);
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 8px;
}

.docs-title {
  font-size: 14px;
  color: var(--accent);
  font-weight: bold;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

@keyframes docs-caret-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}
.docs-caret {
  display: inline-block;
  width: 9px;
  height: 14px;
  background: var(--accent);
  animation: docs-caret-blink 1s step-end infinite;
  vertical-align: middle;
  margin-left: 2px;
  flex-shrink: 0;
}

.docs-tabs {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
}

.docs-tab {
  padding: 4px 12px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  border-radius: 3px;
}
.docs-tab.active {
  border-color: var(--accent);
  background: var(--selected);
  color: var(--accent);
}
.docs-tab:hover:not(.active) {
  color: var(--text);
  border-color: var(--text-dim);
}

/* ── Body ── */
.docs-body {
  display: flex;
  flex: 1;
  min-height: 600px;
  overflow: hidden;
}

/* ── Sidebar ── */
.sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  overflow-y: auto;
}

.sidebar-item {
  padding: 6px 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  border-left: 2px solid transparent;
  color: var(--text);
}
.sidebar-item:hover { color: var(--accent); }
.sidebar-item.active {
  background: var(--selected);
  color: var(--accent);
  border-left-color: var(--accent);
}
.sidebar-item .cat {
  font-size: 10px;
  color: var(--text-dim);
  width: 60px;
  flex-shrink: 0;
  opacity: 0.5;
}

/* ── Content pane ── */
.content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

/* ── Code blocks ── */
.code-wrap {
  position: relative;
  margin: 8px 0 16px;
}
pre {
  background: rgba(0,0,0,0.4);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 10px 44px 10px 12px;
  font-size: 11px;
  color: var(--accent);
  overflow-x: auto;
  line-height: 1.5;
  font-family: inherit;
  white-space: pre;
}
pre.wrap { white-space: pre-wrap; color: var(--text); font-size: 12px; }

.copy-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 8px;
  font-size: 10px;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: rgba(0,0,0,0.6);
  color: var(--text-dim);
  transition: color .15s, background .15s;
  line-height: 1.6;
}
.copy-btn.copied {
  background: rgba(0,200,100,0.15);
  color: #00cc66;
  border-color: #00cc66;
}

/* ── Props table ── */
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th {
  padding: 4px 8px;
  text-align: left;
  font-size: 10px;
  color: var(--text-dim);
  font-weight: normal;
  text-transform: uppercase;
  border-bottom: 1px solid var(--border);
}
td { padding: 5px 8px; border-bottom: 1px solid var(--border); }
td:first-child { font-family: inherit; color: var(--accent); word-break: break-all; }
td:nth-child(2), td:nth-child(3) { color: var(--text-dim); word-break: break-word; }
td:last-child { color: var(--text); line-height: 1.5; }

/* ── Method badge ── */
.method {
  display: inline-block;
  font-size: 10px;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}
.method-GET    { background: rgba(0,200,100,.15); color: #00cc66; }
.method-POST   { background: rgba(0,150,255,.15); color: #00aaff; }
.method-DELETE { background: rgba(255,50,50,.15);  color: #ff4444; }

/* ── Endpoint card ── */
.endpoint {
  margin-bottom: 14px;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.endpoint.highlight { border-color: var(--accent); }
.endpoint-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: rgba(0,0,0,.3);
  border-bottom: 1px solid var(--border);
}
.endpoint.highlight .endpoint-head { background: rgba(255,170,0,.08); }
.endpoint-body { padding: 10px 12px; }
.label { font-size: 10px; color: var(--text-dim); text-transform: uppercase; }

/* ── Tutorial sidebar ── */
.tut-sidebar { width: 200px; flex-shrink: 0; border-right: 1px solid var(--border); overflow-y: auto; }
.tut-item {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 12px;
  border-left: 2px solid transparent;
  color: var(--text);
  line-height: 1.4;
}
.tut-item:hover { color: var(--accent); }
.tut-item.active { background: var(--selected); color: var(--accent); border-left-color: var(--accent); }

/* ── Markdown render ── */
.md h1 { font-size: 18px; color: var(--accent); margin: 0 0 12px; }
.md h2 { font-size: 14px; color: var(--text); margin: 20px 0 8px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
.md h3 { font-size: 13px; color: var(--accent); margin: 16px 0 6px; }
.md p  { font-size: 13px; color: var(--text); line-height: 1.6; margin: 0 0 10px; }
.md hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
.md ul { margin: 0 0 10px; padding-left: 16px; }
.md li { font-size: 13px; color: var(--text); margin-bottom: 4px; line-height: 1.5; list-style: none; }
.md li::before { content: '•'; margin-right: 6px; color: var(--accent); }
.md code { font-size: 11px; color: var(--accent); background: rgba(0,0,0,.3); padding: 1px 4px; border-radius: 3px; font-family: inherit; }
.md strong { color: var(--text); }
.md table { margin-bottom: 16px; }

/* ── MCP tools list ── */
.tool-row {
  display: flex;
  gap: 12px;
  padding: 8px 12px;
  margin-bottom: 6px;
  background: rgba(0,0,0,.3);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.tool-name { font-size: 12px; color: var(--accent); flex-shrink: 0; width: 170px; }
.tool-desc { font-size: 12px; color: var(--text); }

/* ── Component header ── */
.comp-title { font-size: 18px; color: var(--accent); font-weight: bold; }
.comp-alias { font-size: 11px; color: var(--text-dim); }
.comp-cat {
  font-size: 10px; padding: 1px 6px; border-radius: 3px;
  background: rgba(255,170,0,.15); color: var(--accent); margin-left: auto;
}
.section-label {
  font-size: 11px; color: var(--text-dim);
  text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;
}

/* ── Empty / loading ── */
.placeholder { padding: 24px; color: var(--text-dim); font-size: 13px; }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
</style>
<link rel="alternate" type="text/plain" href="/llm.txt" title="LLM Discovery">
</head>
<body>

<div class="docs-panel">
  <div class="docs-header">
    <span class="docs-title">TUIFY DOCS<span class="docs-caret"></span></span>
    <div class="docs-tabs">
      <button class="docs-tab active" data-section="components">Components</button>
      <button class="docs-tab" data-section="api">API Reference</button>
      <button class="docs-tab" data-section="mcp">MCP Setup</button>
      <button class="docs-tab" data-section="tutorials">Tutorials</button>
    </div>
    <button id="docs-copy-md-btn" onclick="copyDocsMd()" style="margin-left:auto;padding:4px 14px;font-size:10px;font-family:inherit;cursor:pointer;border:1px solid var(--border);border-radius:3px;background:transparent;color:var(--text-dim);white-space:nowrap;flex-shrink:0">Copy .md</button>
  </div>

  <div class="docs-body">
    <!-- Components -->
    <div id="sec-components" class="section-view" style="display:flex;flex:1;min-height:0;overflow:hidden;">
      <div class="sidebar" id="comp-sidebar"><div class="placeholder">Loading...</div></div>
      <div class="content" id="comp-detail"><div class="placeholder">Select a component</div></div>
    </div>

    <!-- API Reference -->
    <div id="sec-api" class="section-view content" style="display:none;"></div>

    <!-- MCP -->
    <div id="sec-mcp" class="section-view content" style="display:none;"></div>

    <!-- Tutorials -->
    <div id="sec-tutorials" class="section-view" style="display:none;flex:1;min-height:0;overflow:hidden;">
      <div class="tut-sidebar" id="tut-sidebar"></div>
      <div class="content" id="tut-content"><div class="placeholder">Select a tutorial</div></div>
    </div>
  </div>
</div>

<script>
// ─── State ────────────────────────────────────────────────────────────────────
let components = [];
let tutorials  = [];
let activeSection = 'components';
let selectedComp  = null;
let selectedTut   = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function codeBlock(text, extra = '') {
  const id = 'cb-' + Math.random().toString(36).slice(2);
  return \`<div class="code-wrap">
    <pre id="\${id}" \${extra}>\${esc(text)}</pre>
    <button class="copy-btn" onclick="copyBlock('\${id}',this)">copy</button>
  </div>\`;
}

function copyBlock(id, btn) {
  const text = document.getElementById(id)?.innerText ?? '';
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓ copied';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'copy'; btn.classList.remove('copied'); }, 1800);
  });
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.docs-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    activeSection = btn.dataset.section;
    document.querySelectorAll('.docs-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.section-view').forEach(el => el.style.display = 'none');
    const sec = document.getElementById('sec-' + activeSection);
    sec.style.display = activeSection === 'components' || activeSection === 'tutorials' ? 'flex' : 'block';
  });
});

// ─── Components ──────────────────────────────────────────────────────────────
function renderCompSidebar() {
  const sidebar = document.getElementById('comp-sidebar');
  sidebar.innerHTML = components.map(c => \`
    <div class="sidebar-item \${selectedComp?.type === c.type ? 'active' : ''}"
         onclick="selectComp('\${esc(c.type)}')">
      <span class="cat">\${esc(c.category)}</span>\${esc(c.type)}
    </div>
  \`).join('');
}

function selectComp(type) {
  selectedComp = components.find(c => c.type === type);
  renderCompSidebar();
  renderCompDetail();
}

function renderCompDetail() {
  const el = document.getElementById('comp-detail');
  if (!selectedComp) { el.innerHTML = '<div class="placeholder">Select a component</div>'; return; }
  const c = selectedComp;

  let propsHtml = '';
  if (c.props && Object.keys(c.props).length) {
    const rows = Object.entries(c.props).map(([name, p]) => {
      const typeStr = p.type + (p.values ? \` (\${p.values.join(' | ')})\` : '');
      const def = p.default !== undefined ? esc(String(p.default)) : '—';
      const desc = esc(p.description || '') + (p.when ? \` <span style="opacity:.5">when: \${esc(p.when)}</span>\` : '');
      return \`<tr><td>\${esc(name)}</td><td>\${esc(typeStr)}</td><td>\${def}</td><td>\${desc}</td></tr>\`;
    }).join('');
    propsHtml = \`
      <div class="section-label">Props</div>
      <div style="overflow-x:auto;margin-bottom:20px">
        <table style="table-layout:fixed"><colgroup><col style="width:120px"><col style="width:150px"><col style="width:72px"><col></colgroup><thead><tr>
          <th>Name</th><th>Type</th><th>Default</th><th>Description</th>
        </tr></thead><tbody>\${rows}</tbody></table>
      </div>\`;
  }

  let notesHtml = '';
  if (c.notes?.length) {
    notesHtml = \`<div class="section-label">Notes</div>
      <ul style="margin:0 0 20px">\${c.notes.map(n => \`<li>\${esc(n)}</li>\`).join('')}</ul>\`;
  }

  let examplesHtml = '';
  if (c.examples?.length) {
    examplesHtml = \`<div class="section-label">Examples</div>\` +
      c.examples.map(ex => \`
        <div style="margin-bottom:16px">
          <div style="font-size:12px;color:var(--text);margin-bottom:6px">\${esc(ex.description)}</div>
          \${codeBlock(JSON.stringify(ex.json, null, 2))}
        </div>
      \`).join('');
  }

  const aliases = c.aliases?.length
    ? \`<span class="comp-alias">alias: \${esc(c.aliases.join(', '))}</span>\`
    : '';

  el.innerHTML = \`
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:4px;flex-wrap:wrap">
      <span class="comp-title">\${esc(c.type)}</span>
      \${aliases}
      <span class="comp-cat">\${esc(c.category)}</span>
    </div>
    <p style="font-size:13px;color:var(--text);margin-bottom:16px;line-height:1.5">\${esc(c.description)}</p>
    \${propsHtml}\${notesHtml}\${examplesHtml}
  \`;
}

// ─── API section ──────────────────────────────────────────────────────────────
const API_ENDPOINTS = [
  { method:'POST', path:'/api/projects',        desc:'Save a project (create or update)', body:'{ ...TUIFY project JSON with id field }', res:'{ id, name, slug, updatedAt }' },
  { method:'GET',  path:'/api/projects',        desc:'List all projects for the authenticated user', res:'[ { id, name, slug, updatedAt } ]' },
  { method:'GET',  path:'/api/projects/:id',    desc:'Load a single project by ID', res:'{ ...full TUIFY project JSON }' },
  { method:'POST', path:'/api/publish/render',  desc:'Save + publish in one call. Returns live URL.', body:'{ project, slug?, title?, description?, publishMode?, pageHtml? }', res:'{ success, id, slug, url, editorUrl, username }', highlight:true },
  { method:'GET',  path:'/api/settings',        desc:'Load user settings', res:'{ apiKey, externalApis, tutorial }' },
  { method:'POST', path:'/api/settings',        desc:'Save user settings', body:'{ apiKey?, externalApis?, tutorial? }', res:'{ success }' },
  { method:'POST', path:'/api/assets/upload',   desc:'Upload a file asset (multipart/form-data, field: file)', res:'{ url }' },
];

function renderApi() {
  const el = document.getElementById('sec-api');
  const cards = API_ENDPOINTS.map(ep => \`
    <div class="endpoint \${ep.highlight ? 'highlight' : ''}">
      <div class="endpoint-head">
        <span class="method method-\${ep.method}">\${ep.method}</span>
        <code style="font-size:12px;color:var(--text);font-family:inherit">\${esc(ep.path)}</code>
      </div>
      <div class="endpoint-body">
        <div style="font-size:12px;color:var(--text);margin-bottom:\${ep.body?'8px':'0'}">\${esc(ep.desc)}</div>
        \${ep.body ? \`<div style="margin-bottom:6px"><span class="label">Body: </span><code style="font-size:11px;color:var(--text-dim);font-family:inherit">\${esc(ep.body)}</code></div>\` : ''}
        <div><span class="label">Response: </span><code style="font-size:11px;color:var(--accent);font-family:inherit">\${esc(ep.res)}</code></div>
      </div>
    </div>
  \`).join('');
  el.innerHTML = \`
    <div style="margin-bottom:20px">
      <div style="font-size:16px;color:var(--accent);margin-bottom:4px">API Reference</div>
      <p style="font-size:12px;color:var(--text-dim);line-height:1.5">
        Base URL: <code style="color:var(--accent)">https://tuify.app/api</code><br>
        Authentication: <code>Authorization: Bearer &lt;token&gt;</code><br>
        Get your token from <strong style="color:var(--text)">Settings → API tab</strong>.
      </p>
    </div>
    \${cards}
  \`;
}

// ─── MCP section ──────────────────────────────────────────────────────────────
const MCP_CONFIG = \`{
  "mcpServers": {
    "tuify": {
      "command": "node",
      "args": ["/path/to/tuify-builder/docs-mcp/server.js"],
      "env": {
        "TUIFY_API_BASE": "https://tuify.app/api",
        "TUIFY_TOKEN": "<your-jwt-token>"
      }
    }
  }
}\`;

const MCP_TOOLS = [
  { name:'list_components',   desc:'Returns all component specs (props, examples)' },
  { name:'get_component_spec',desc:'Get detailed spec for a specific component by type name' },
  { name:'get_project_schema',desc:'Returns the full TUIFY project JSON schema' },
  { name:'create_project',    desc:'Save a project to the builder and return an editor URL' },
  { name:'render_app',        desc:'Save + publish a project in one call. Returns the live URL.' },
  { name:'list_tutorials',    desc:'List available tutorials (slugs + titles)' },
  { name:'get_tutorial',      desc:'Read a specific tutorial by slug' },
];

const MCP_PROMPT = \`"Build a product catalogue app with a home screen listing items
from a Products table and an admin screen with a form to add
new products. Deploy it and give me the live URL."\`;

function renderMcp() {
  const el = document.getElementById('sec-mcp');
  el.innerHTML = \`
    <div style="font-size:16px;color:var(--accent);margin-bottom:4px">MCP Setup</div>
    <p style="font-size:12px;color:var(--text-dim);line-height:1.6;margin-bottom:20px">
      Connect any MCP-compatible AI (Claude, Cursor, etc.) to TUIFY to generate and deploy apps from natural language.
    </p>

    <div class="section-label">1. Configure your MCP client</div>
    \${codeBlock(MCP_CONFIG)}

    <div class="section-label" style="margin-top:20px">2. Available tools</div>
    \${MCP_TOOLS.map(t => \`<div class="tool-row"><span class="tool-name">\${esc(t.name)}</span><span class="tool-desc">\${esc(t.desc)}</span></div>\`).join('')}

    <div class="section-label" style="margin-top:20px">3. Example prompt</div>
    \${codeBlock(MCP_PROMPT, 'class="wrap"')}
  \`;
}

// ─── Tutorials ────────────────────────────────────────────────────────────────
function renderTutSidebar() {
  const el = document.getElementById('tut-sidebar');
  el.innerHTML = tutorials.map(t => \`
    <div class="tut-item \${selectedTut?.slug === t.slug ? 'active' : ''}"
         onclick="selectTut('\${esc(t.slug)}')">
      \${esc(t.title)}
    </div>
  \`).join('');
}

function selectTut(slug) {
  selectedTut = tutorials.find(t => t.slug === slug);
  renderTutSidebar();
  renderTutContent();
}

function renderTutContent() {
  const el = document.getElementById('tut-content');
  if (!selectedTut) { el.innerHTML = '<div class="placeholder">Select a tutorial</div>'; return; }
  el.innerHTML = \`<div class="md">\${parseMarkdown(selectedTut.content)}</div>\`;
}

// ─── Minimal markdown parser ──────────────────────────────────────────────────
function parseMarkdown(md) {
  const lines = md.split('\\n');
  let html = '';
  let i = 0;
  let codeLines = null;

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('\`\`\`')) {
      if (codeLines === null) {
        codeLines = [];
      } else {
        html += codeBlock(codeLines.join('\\n'));
        codeLines = null;
      }
    } else if (codeLines !== null) {
      codeLines.push(line);
    } else if (line.startsWith('# '))   { html += \`<h1>\${inlineMd(line.slice(2))}</h1>\\n\`; }
    else if (line.startsWith('## '))    { html += \`<h2>\${inlineMd(line.slice(3))}</h2>\\n\`; }
    else if (line.startsWith('### '))   { html += \`<h3>\${inlineMd(line.slice(4))}</h3>\\n\`; }
    else if (line.startsWith('---'))    { html += '<hr>\\n'; }
    else if (line.startsWith('| ')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i++; }
      i--;
      const headers = rows[0].split('|').slice(1,-1).map(s=>s.trim());
      const dataRows = rows.slice(2);
      html += '<table>' +
        '<thead><tr>' + headers.map(h=>\`<th>\${esc(h)}</th>\`).join('') + '</tr></thead>' +
        '<tbody>' + dataRows.map(r=>{
          const cells = r.split('|').slice(1,-1).map(s=>s.trim());
          return '<tr>' + cells.map(c=>\`<td><code>\${esc(c)}</code></td>\`).join('') + '</tr>';
        }).join('') + '</tbody></table>\\n';
    }
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      html += \`<ul><li>\${inlineMd(line.slice(2))}</li></ul>\\n\`;
    }
    else if (/^\\d+\\.\\s/.test(line)) { html += \`<p>\${esc(line)}</p>\\n\`; }
    else if (line.trim())             { html += \`<p>\${inlineMd(line)}</p>\\n\`; }
    i++;
  }
  return html;
}

function inlineMd(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
}

// ─── Fetch & init ─────────────────────────────────────────────────────────────
async function init() {
  try {
    const [compRes, tutRes] = await Promise.all([
      fetch('/api/docs/components'),
      fetch('/api/docs/tutorials'),
    ]);
    const compData = await compRes.json();
    const tutData  = await tutRes.json();
    components = compData.components || [];
    tutorials  = tutData.tutorials  || [];

    selectedComp = components[0] || null;
    selectedTut  = tutorials[0]  || null;

    renderCompSidebar();
    renderCompDetail();
    renderApi();
    renderMcp();
    renderTutSidebar();
    renderTutContent();
  } catch (e) {
    console.error('Failed to load docs', e);
    document.getElementById('comp-sidebar').innerHTML = '<div class="placeholder">Failed to load</div>';
  }
}

// ─── Copy .md ─────────────────────────────────────────────────────────────────
async function copyDocsMd() {
  const btn  = document.getElementById('docs-copy-md-btn');
  const orig = btn.textContent;
  btn.textContent = '…';
  btn.disabled = true;
  try {
    const r    = await fetch('/docs?format=md');
    const text = await r.text();
    await navigator.clipboard.writeText(text);
    btn.textContent = '✓ copied';
    btn.style.color       = '#00cc66';
    btn.style.borderColor = '#00cc66';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.color       = '';
      btn.style.borderColor = '';
      btn.disabled = false;
    }, 2000);
  } catch {
    btn.textContent = 'error';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
  }
}

init();
</script>
</body>
</html>`;
}
