import React, { useState, useEffect } from 'react';
import { apiFetch } from '../lib/apiFetch';

const SECTIONS = [
  { id: 'components', label: 'Components' },
  { id: 'api', label: 'API Reference' },
  { id: 'mcp', label: 'MCP Setup' },
  { id: 'tutorials', label: 'Tutorials' },
];

const API_ENDPOINTS = [
  {
    method: 'POST',
    path: '/api/projects',
    description: 'Save a project (create or update)',
    body: '{ ...TUIFY project JSON with id field }',
    response: '{ id, name, slug, updatedAt }',
  },
  {
    method: 'GET',
    path: '/api/projects',
    description: 'List all projects for the authenticated user',
    response: '[ { id, name, slug, updatedAt } ]',
  },
  {
    method: 'GET',
    path: '/api/projects/:id',
    description: 'Load a single project by ID',
    response: '{ ...full TUIFY project JSON }',
  },
  {
    method: 'POST',
    path: '/api/publish/render',
    description: 'Save + publish in one call. Returns live URL.',
    body: '{ project, slug?, title?, description?, publishMode?, pageHtml? }',
    response: '{ success, id, slug, url, editorUrl, username }',
    highlight: true,
  },
  {
    method: 'GET',
    path: '/api/settings',
    description: 'Load user settings',
    response: '{ apiKey, externalApis, tutorial }',
  },
  {
    method: 'POST',
    path: '/api/settings',
    description: 'Save user settings',
    body: '{ apiKey?, externalApis?, tutorial? }',
    response: '{ success }',
  },
  {
    method: 'POST',
    path: '/api/assets/upload',
    description: 'Upload a file asset (multipart/form-data, field: file)',
    response: '{ url }',
  },
];

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={handle}
      title="Copy"
      style={{
        position: 'absolute',
        top: 6,
        right: 6,
        padding: '2px 8px',
        fontSize: 10,
        fontFamily: 'monospace',
        cursor: 'pointer',
        border: '1px solid var(--border)',
        borderRadius: 3,
        background: copied ? 'rgba(0,200,100,0.15)' : 'rgba(0,0,0,0.6)',
        color: copied ? '#00cc66' : 'var(--text-dim)',
        transition: 'color 0.15s, background 0.15s',
        lineHeight: 1.6,
      }}
    >
      {copied ? '✓ copied' : 'copy'}
    </button>
  );
}

function CodeBlock({ children, style = {} }) {
  const text = typeof children === 'string' ? children : String(children ?? '');
  return (
    <div style={{ position: 'relative' }}>
      <pre style={{
        background: 'rgba(0,0,0,0.4)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: '10px 40px 10px 12px',
        fontSize: 11,
        color: 'var(--accent)',
        overflowX: 'auto',
        margin: 0,
        lineHeight: 1.5,
        ...style,
      }}>
        {children}
      </pre>
      <CopyButton text={text} />
    </div>
  );
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function MethodBadge({ method }) {
  const colors = {
    GET: { bg: 'rgba(0,200,100,0.15)', color: '#00cc66' },
    POST: { bg: 'rgba(0,150,255,0.15)', color: '#00aaff' },
    DELETE: { bg: 'rgba(255,50,50,0.15)', color: '#ff4444' },
  };
  const s = colors[method] || {};
  return (
    <span style={{
      fontSize: 10, fontWeight: 'bold', padding: '2px 6px', borderRadius: 3,
      background: s.bg, color: s.color, fontFamily: 'monospace', flexShrink: 0,
    }}>
      {method}
    </span>
  );
}

function PropRow({ name, prop }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', wordBreak: 'break-all' }}>{name}</td>
      <td style={{ padding: '5px 8px', fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-word' }}>
        {prop.type}{prop.values ? ` (${prop.values.join(' | ')})` : ''}
      </td>
      <td style={{ padding: '5px 8px', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'monospace', wordBreak: 'break-word' }}>
        {prop.default !== undefined ? String(prop.default) : '—'}
      </td>
      <td style={{ padding: '5px 8px', fontSize: 11, color: 'var(--text)', lineHeight: 1.5 }}>
        {prop.description || ''}
        {prop.when ? <span style={{ opacity: 0.5, marginLeft: 6 }}>when: {prop.when}</span> : null}
      </td>
    </tr>
  );
}

function ComponentCard({ comp, isSelected, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '6px 10px', cursor: 'pointer',
        background: isSelected ? 'var(--selected)' : 'transparent',
        color: isSelected ? 'var(--accent)' : 'var(--text)',
        borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
        fontSize: 12, fontFamily: 'monospace',
        display: 'flex', alignItems: 'center', gap: 6,
      }}
    >
      <span style={{ opacity: 0.4, fontSize: 10, width: 60, flexShrink: 0, color: 'var(--text-dim)' }}>{comp.category}</span>
      {comp.type}
    </div>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function ComponentDetail({ comp }) {
  if (!comp) return <div style={{ padding: 24, color: 'var(--text-dim)', fontSize: 13 }}>Select a component</div>;
  return (
    <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <span style={{ fontSize: 18, fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 'bold' }}>{comp.type}</span>
        {comp.aliases?.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>alias: {comp.aliases.join(', ')}</span>
        )}
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 3,
          background: 'rgba(255,170,0,0.15)', color: 'var(--accent)',
          fontFamily: 'monospace', marginLeft: 'auto',
        }}>
          {comp.category}
        </span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 16, lineHeight: 1.5 }}>{comp.description}</p>

      {comp.props && Object.keys(comp.props).length > 0 && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Props</div>
          <div style={{ overflowX: 'auto', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 120 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 72 }} />
                <col />
              </colgroup>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Name', 'Type', 'Default', 'Description'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', textAlign: 'left', fontSize: 10, color: 'var(--text-dim)', fontWeight: 'normal', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(comp.props).map(([name, prop]) => (
                  <PropRow key={name} name={name} prop={prop} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {comp.notes?.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Notes</div>
          <ul style={{ margin: '0 0 20px 16px', padding: 0 }}>
            {comp.notes.map((n, i) => (
              <li key={i} style={{ fontSize: 12, color: 'var(--text)', marginBottom: 4, lineHeight: 1.5 }}>{n}</li>
            ))}
          </ul>
        </>
      )}

      {comp.examples?.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Examples</div>
          {comp.examples.map((ex, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 6 }}>{ex.description}</div>
              <CodeBlock style={{ margin: 0 }}>
                {JSON.stringify(ex.json, null, 2)}
              </CodeBlock>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function ApiSection() {
  return (
    <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontFamily: 'monospace', color: 'var(--accent)', marginBottom: 4 }}>API Reference</div>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          Base URL: <code style={{ color: 'var(--accent)' }}>https://tuify.app/api</code><br />
          Authentication: <code style={{ color: 'var(--text)' }}>Authorization: Bearer &lt;token&gt;</code><br />
          Get your token from <strong style={{ color: 'var(--text)' }}>Settings → API tab</strong>.
        </p>
      </div>
      {API_ENDPOINTS.map((ep, i) => (
        <div key={i} style={{
          marginBottom: 16,
          border: `1px solid ${ep.highlight ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 4, overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
            background: ep.highlight ? 'rgba(255,170,0,0.08)' : 'rgba(0,0,0,0.3)',
            borderBottom: '1px solid var(--border)',
          }}>
            <MethodBadge method={ep.method} />
            <code style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{ep.path}</code>
          </div>
          <div style={{ padding: '10px 12px' }}>
            <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: ep.body ? 8 : 0 }}>{ep.description}</div>
            {ep.body && (
              <div style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Body: </span>
                <code style={{ fontSize: 11, color: 'var(--text-dim)' }}>{ep.body}</code>
              </div>
            )}
            <div>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Response: </span>
              <code style={{ fontSize: 11, color: 'var(--accent)' }}>{ep.response}</code>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const MCP_CONFIG = `{
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
}`;

const MCP_PROMPT = `"Build a product catalogue app with a home screen listing items
from a Products table and an admin screen with a form to add
new products. Deploy it and give me the live URL."`;

function McpSection() {
  return (
    <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
      <div style={{ fontSize: 16, fontFamily: 'monospace', color: 'var(--accent)', marginBottom: 4 }}>MCP Setup</div>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 20 }}>
        Connect any MCP-compatible AI (Claude, Cursor, etc.) to TUIFY to generate and deploy apps from natural language.
      </p>

      <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>1. Configure your MCP client</div>
      <CodeBlock style={{ marginBottom: 20 }}>{MCP_CONFIG}</CodeBlock>

      <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, margin: '20px 0 8px' }}>2. Available tools</div>
      {[
        { name: 'list_components', desc: 'Returns all component specs (props, examples)' },
        { name: 'get_component_spec', desc: 'Get detailed spec for a specific component by type name' },
        { name: 'get_project_schema', desc: 'Returns the full TUIFY project JSON schema' },
        { name: 'create_project', desc: 'Save a project to the builder and return an editor URL' },
        { name: 'render_app', desc: 'Save + publish a project in one call. Returns the live URL.' },
        { name: 'list_tutorials', desc: 'List available tutorials (slugs + titles)' },
        { name: 'get_tutorial', desc: 'Read a specific tutorial by slug' },
      ].map(t => (
        <div key={t.name} style={{
          display: 'flex', gap: 12, padding: '8px 12px', marginBottom: 6,
          background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 4,
        }}>
          <code style={{ fontSize: 12, color: 'var(--accent)', flexShrink: 0, width: 160 }}>{t.name}</code>
          <span style={{ fontSize: 12, color: 'var(--text)' }}>{t.desc}</span>
        </div>
      ))}

      <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, margin: '20px 0 8px' }}>3. Example prompt</div>
      <CodeBlock style={{ color: 'var(--text)', whiteSpace: 'pre-wrap', fontSize: 12 }}>{MCP_PROMPT}</CodeBlock>
    </div>
  );
}

function TutorialsSection({ tutorials, loading }) {
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (tutorials?.length > 0 && !selected) setSelected(tutorials[0]);
  }, [tutorials]);

  if (loading) return <div style={{ padding: 24, color: 'var(--text-dim)', fontSize: 13 }}>Loading...</div>;

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div style={{ width: 180, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
        {tutorials?.map(t => (
          <div
            key={t.slug}
            onClick={() => setSelected(t)}
            style={{
              padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontFamily: 'monospace',
              background: selected?.slug === t.slug ? 'var(--selected)' : 'transparent',
              color: selected?.slug === t.slug ? 'var(--accent)' : 'var(--text)',
              borderLeft: selected?.slug === t.slug ? '2px solid var(--accent)' : '2px solid transparent',
              lineHeight: 1.4,
            }}
          >
            {t.title}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {selected
          ? <MarkdownContent content={selected.content} />
          : <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>Select a tutorial</div>
        }
      </div>
    </div>
  );
}

function MarkdownContent({ content }) {
  const lines = content.split('\n');
  const elements = [];
  let i = 0;
  let codeLines = null;

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      if (codeLines === null) {
        codeLines = [];
      } else {
        const text = codeLines.join('\n');
        elements.push(
          <CodeBlock key={i} style={{ margin: '8px 0 16px' }}>{text}</CodeBlock>
        );
        codeLines = null;
      }
    } else if (codeLines !== null) {
      codeLines.push(line);
    } else if (line.startsWith('# ')) {
      elements.push(<h1 key={i} style={{ fontSize: 18, color: 'var(--accent)', fontFamily: 'monospace', margin: '0 0 12px' }}>{line.slice(2)}</h1>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} style={{ fontSize: 14, color: 'var(--text)', fontFamily: 'monospace', margin: '20px 0 8px', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>{line.slice(3)}</h2>);
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} style={{ fontSize: 13, color: 'var(--accent)', fontFamily: 'monospace', margin: '16px 0 6px' }}>{line.slice(4)}</h3>);
    } else if (line.startsWith('---')) {
      elements.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />);
    } else if (line.startsWith('| ')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i++; }
      i--;
      const headers = rows[0].split('|').slice(1, -1).map(s => s.trim());
      const dataRows = rows.slice(2);
      elements.push(
        <div key={`tbl-${i}`} style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead>
              <tr>{headers.map((h, j) => <th key={j} style={{ padding: '4px 10px', textAlign: 'left', fontSize: 10, color: 'var(--text-dim)', borderBottom: '1px solid var(--border)', textTransform: 'uppercase' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {dataRows.map((row, j) => {
                const cells = row.split('|').slice(1, -1).map(s => s.trim());
                return <tr key={j} style={{ borderBottom: '1px solid var(--border)' }}>{cells.map((c, k) => <td key={k} style={{ padding: '5px 10px', fontSize: 12, color: 'var(--text)' }}><code style={{ fontSize: 11 }}>{c}</code></td>)}</tr>;
              })}
            </tbody>
          </table>
        </div>
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<div key={i} style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4, paddingLeft: 16, lineHeight: 1.5 }}>• {renderInline(line.slice(2))}</div>);
    } else if (/^\d+\.\s/.test(line)) {
      elements.push(<div key={i} style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4, paddingLeft: 16, lineHeight: 1.5 }}>{line}</div>);
    } else if (line.trim()) {
      elements.push(<p key={i} style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, margin: '0 0 10px' }}>{renderInline(line)}</p>);
    }
    i++;
  }

  return <div>{elements}</div>;
}

function renderInline(text) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} style={{ fontSize: 11, color: 'var(--accent)', background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: 3 }}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} style={{ color: 'var(--text)' }}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function DocsPanel({ onClose }) {
  const [section, setSection] = useState('components');
  const [components, setComponents] = useState([]);
  const [tutorials, setTutorials] = useState([]);
  const [selectedComp, setSelectedComp] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [compRes, tutRes] = await Promise.all([
          apiFetch('/api/docs/components'),
          apiFetch('/api/docs/tutorials'),
        ]);
        const compData = await compRes.json();
        const tutData = await tutRes.json();
        setComponents(compData.components || []);
        setTutorials(tutData.tutorials || []);
        if (compData.components?.length > 0) setSelectedComp(compData.components[0]);
      } catch (e) {
        console.error('Failed to load docs', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <style>{`
        @keyframes docs-caret-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
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
      `}</style>

      <div style={{
        width: '90vw', maxWidth: 1100, height: '85vh',
        background: 'var(--panel-bg, var(--bg))',
        border: '1px solid var(--border)',
        borderRadius: 4,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', fontFamily: 'monospace',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(0,0,0,0.3)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, color: 'var(--accent)', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            TUIFY DOCS<span className="docs-caret" />
            <a
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              title="Open public docs page"
              style={{ fontSize: 10, color: 'var(--text-dim)', textDecoration: 'none', fontWeight: 'normal', borderBottom: '1px solid var(--border)', paddingBottom: 1 }}
            >
              tuify.app/docs ↗
            </a>
          </span>
          <div style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                style={{
                  padding: '4px 12px', fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
                  border: '1px solid',
                  borderColor: section === s.id ? 'var(--accent)' : 'var(--border)',
                  background: section === s.id ? 'var(--selected)' : 'transparent',
                  color: section === s.id ? 'var(--accent)' : 'var(--text-dim)',
                  borderRadius: 3,
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto', padding: '4px 10px', fontSize: 11,
              fontFamily: 'monospace', cursor: 'pointer',
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-dim)', borderRadius: 3,
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {section === 'components' && (
            <>
              <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
                {loading
                  ? <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 12 }}>Loading...</div>
                  : components.map(c => (
                    <ComponentCard
                      key={c.type}
                      comp={c}
                      isSelected={selectedComp?.type === c.type}
                      onClick={() => setSelectedComp(c)}
                    />
                  ))
                }
              </div>
              <ComponentDetail comp={selectedComp} />
            </>
          )}
          {section === 'api' && <ApiSection />}
          {section === 'mcp' && <McpSection />}
          {section === 'tutorials' && <TutorialsSection tutorials={tutorials} loading={loading} />}
        </div>
      </div>
    </div>
  );
}
