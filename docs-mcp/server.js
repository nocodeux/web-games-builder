#!/usr/bin/env node
/* global fetch */
/**
 * TUIFY Docs MCP Server
 *
 * Exposes platform documentation as MCP resources so AI tools (Claude, Codex,
 * Cursor, etc.) can generate valid TUIFY projects, screens, and game worlds.
 *
 * Configure in your AI tool:
 *   { "command": "node", "args": ["/absolute/path/to/docs-mcp/server.js"] }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR = join(__dir, 'resources');

// ── Resource registry ──────────────────────────────────────────────────────────

function buildResourceList() {
  const list = [];

  // Components
  const compDir = join(RESOURCES_DIR, 'components');
  for (const file of readdirSync(compDir).filter(f => f.endsWith('.json'))) {
    const name = basename(file, '.json');
    list.push({
      uri: `tuify://components/${name}`,
      name: `Component: ${name}`,
      description: `TUIFY ${name} component — props, defaults, examples`,
      mimeType: 'application/json',
    });
  }

  // Schemas
  const schemaDir = join(RESOURCES_DIR, 'schemas');
  for (const file of readdirSync(schemaDir).filter(f => f.endsWith('.json'))) {
    const name = basename(file, '.json');
    list.push({
      uri: `tuify://schemas/${name}`,
      name: `Schema: ${name}`,
      description: `JSON schema for TUIFY ${name}`,
      mimeType: 'application/json',
    });
  }

  // Tutorials
  const tutDir = join(RESOURCES_DIR, 'tutorials');
  for (const file of readdirSync(tutDir).filter(f => f.endsWith('.md'))) {
    const name = basename(file, '.md');
    list.push({
      uri: `tuify://tutorials/${name}`,
      name: `Tutorial: ${name}`,
      description: `Step-by-step guide: ${name.replace(/-/g, ' ')}`,
      mimeType: 'text/markdown',
    });
  }

  return list;
}

function readResource(uri) {
  const [, , category, name] = uri.split('/');
  if (category === 'components') {
    return readFileSync(join(RESOURCES_DIR, 'components', `${name}.json`), 'utf8');
  }
  if (category === 'schemas') {
    return readFileSync(join(RESOURCES_DIR, 'schemas', `${name}.json`), 'utf8');
  }
  if (category === 'tutorials') {
    return readFileSync(join(RESOURCES_DIR, 'tutorials', `${name}.md`), 'utf8');
  }
  throw new Error(`Unknown resource URI: ${uri}`);
}

// ── Server setup ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'tuify-docs', version: '1.0.0' },
  { capabilities: { resources: {}, tools: {} } }
);

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: buildResourceList(),
}));

server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
  const content = readResource(params.uri);
  const isJson = params.uri.includes('/components/') || params.uri.includes('/schemas/');
  return {
    contents: [{
      uri: params.uri,
      mimeType: isJson ? 'application/json' : 'text/markdown',
      text: content,
    }],
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_components',
      description: 'List all available TUIFY UI component types with their categories',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_component_spec',
      description: 'Get the full spec (props, defaults, examples) for a specific TUIFY component type',
      inputSchema: {
        type: 'object',
        required: ['type'],
        properties: {
          type: {
            type: 'string',
            description: 'Component type name (e.g. Button, Text, DataRepeater)',
          },
        },
      },
    },
    {
      name: 'get_project_schema',
      description: 'Get the full JSON schema for a TUIFY project file — the format used to define screens, components, and database',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_sizing_guide',
      description: 'Explain how the sizing system works (widthMode/heightMode: hug, fill, fixed) and how layout containers work',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'create_project',
      description: 'Save a TUIFY project JSON to a running TUIFY instance via the API. Returns the project ID and an editor URL.',
      inputSchema: {
        type: 'object',
        required: ['apiBase', 'token', 'project'],
        properties: {
          apiBase: { type: 'string', description: 'Base URL of the TUIFY API, e.g. https://tuify.app/api' },
          token:   { type: 'string', description: 'JWT token from Settings → TUIFY API → Copy' },
          project: { type: 'object', description: 'Full TUIFY project JSON object' },
        },
      },
    },
    // ── Cortex (Knowledge Board) tools ──────────────────────────────────────
    {
      name: 'cortex_list_boards',
      description: 'List public Cortex knowledge boards on TUIFY. Supports search query.',
      inputSchema: {
        type: 'object',
        required: ['apiBase'],
        properties: {
          apiBase: { type: 'string', description: 'TUIFY API base URL, e.g. https://tuify.app/api' },
          q:       { type: 'string', description: 'Optional search query' },
          limit:   { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },
    {
      name: 'cortex_create_board',
      description: 'Create a new Cortex knowledge board. Returns the board ID and URL.',
      inputSchema: {
        type: 'object',
        required: ['apiBase', 'name'],
        properties: {
          apiBase:           { type: 'string', description: 'TUIFY API base URL' },
          name:              { type: 'string', description: 'Board name (max 100 chars)' },
          description:       { type: 'string', description: 'Optional board description' },
          expires_in_hours:  { type: 'number', description: 'TTL in hours (default: 24 for guests). Omit for permanent (requires auth).' },
          parent_id:         { type: 'string', description: 'Optional parent board ID for nested boards' },
        },
      },
    },
    {
      name: 'cortex_remember',
      description: 'Add a piece of knowledge (text, URL, or file path) to a Cortex board. The system extracts context automatically.',
      inputSchema: {
        type: 'object',
        required: ['apiBase', 'boardId'],
        properties: {
          apiBase: { type: 'string', description: 'TUIFY API base URL' },
          boardId: { type: 'string', description: 'Target board ID' },
          text:    { type: 'string', description: 'Text or Mermaid diagram to remember' },
          url:     { type: 'string', description: 'URL to scrape and remember' },
        },
      },
    },
    {
      name: 'cortex_search',
      description: 'Search a Cortex board using BM25 semantic search. Returns ranked pieces with context fragments.',
      inputSchema: {
        type: 'object',
        required: ['apiBase', 'boardId', 'query'],
        properties: {
          apiBase:  { type: 'string', description: 'TUIFY API base URL' },
          boardId:  { type: 'string', description: 'Board ID to search in' },
          query:    { type: 'string', description: 'Natural language search query' },
          top_k:    { type: 'number', description: 'Number of results (default 5)' },
          category: { type: 'string', description: 'Filter by category: visual | textual | sonoro | técnico | referencia | otro' },
        },
      },
    },
    {
      name: 'cortex_get_wiki',
      description: 'Get the auto-generated living wiki (markdown) for a Cortex board — includes all pieces, categories, and API reference.',
      inputSchema: {
        type: 'object',
        required: ['apiBase', 'boardId'],
        properties: {
          apiBase: { type: 'string', description: 'TUIFY API base URL' },
          boardId: { type: 'string', description: 'Board ID' },
        },
      },
    },
    {
      name: 'cortex_get_board',
      description: 'Get a Cortex board with all its pieces.',
      inputSchema: {
        type: 'object',
        required: ['apiBase', 'boardId'],
        properties: {
          apiBase: { type: 'string', description: 'TUIFY API base URL' },
          boardId: { type: 'string', description: 'Board ID' },
        },
      },
    },
    {
      name: 'cortex_forget',
      description: 'Delete a specific piece from a Cortex board.',
      inputSchema: {
        type: 'object',
        required: ['apiBase', 'boardId', 'pieceId'],
        properties: {
          apiBase:  { type: 'string', description: 'TUIFY API base URL' },
          boardId:  { type: 'string', description: 'Board ID' },
          pieceId:  { type: 'string', description: 'Piece ID to delete' },
        },
      },
    },
    {
      name: 'render_app',
      description: 'Save a TUIFY project and publish it in one call. Returns the live URL. For games (publishMode "game") no extra HTML is needed. For UI pages supply pageHtml.',
      inputSchema: {
        type: 'object',
        required: ['apiBase', 'token', 'project'],
        properties: {
          apiBase:     { type: 'string', description: 'Base URL of the TUIFY API, e.g. https://tuify.app/api' },
          token:       { type: 'string', description: 'JWT token from Settings → TUIFY API → Copy' },
          project:     { type: 'object', description: 'Full TUIFY project JSON object' },
          slug:        { type: 'string', description: 'URL slug for the published page (auto-derived from project.name if omitted)' },
          title:       { type: 'string', description: 'Page title (defaults to project.name)' },
          description: { type: 'string', description: 'Short page description' },
          publishMode: { type: 'string', enum: ['game', 'page', 'page+game'], description: 'What to publish — "game" for game worlds, "page" for UI screens (requires pageHtml)' },
          pageHtml:    { type: 'string', description: 'Pre-rendered page HTML (required when publishMode is "page" or "page+game")' },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  switch (params.name) {
    case 'list_components': {
      const compDir = join(RESOURCES_DIR, 'components');
      const components = readdirSync(compDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const spec = JSON.parse(readFileSync(join(compDir, f), 'utf8'));
          return { type: spec.type, category: spec.category, description: spec.description, canHaveChildren: spec.canHaveChildren };
        });
      return { content: [{ type: 'text', text: JSON.stringify(components, null, 2) }] };
    }
    case 'get_component_spec': {
      const name = params.arguments?.type;
      const compDir = join(RESOURCES_DIR, 'components');
      // Try direct filename first, then scan aliases
      try {
        const content = readFileSync(join(compDir, `${name}.json`), 'utf8');
        return { content: [{ type: 'text', text: content }] };
      } catch {
        // Scan all files for an alias match
        const files = readdirSync(compDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const raw = readFileSync(join(compDir, file), 'utf8');
            const spec = JSON.parse(raw);
            if (spec.aliases?.includes(name)) {
              return { content: [{ type: 'text', text: raw }] };
            }
          } catch { /* skip */ }
        }
        return { content: [{ type: 'text', text: `Component '${name}' not found. Use list_components to see available types.` }], isError: true };
      }
    }
    case 'get_project_schema': {
      const content = readFileSync(join(RESOURCES_DIR, 'schemas', 'project.schema.json'), 'utf8');
      return { content: [{ type: 'text', text: content }] };
    }
    case 'get_sizing_guide': {
      const guide = readFileSync(join(RESOURCES_DIR, 'tutorials', '00-sizing-and-layout.md'), 'utf8');
      return { content: [{ type: 'text', text: guide }] };
    }
    case 'create_project': {
      const { apiBase, token, project } = params.arguments || {};
      if (!apiBase || !token || !project) {
        return { content: [{ type: 'text', text: 'apiBase, token, and project are required' }], isError: true };
      }
      try {
        const res = await fetch(`${apiBase}/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(project),
        });
        const data = await res.json();
        if (!res.ok) return { content: [{ type: 'text', text: `API error: ${data.error || res.status}` }], isError: true };
        const origin = new URL(apiBase).origin;
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, id: project.id, editorUrl: `${origin}/?project=${project.id}` }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Request failed: ${err.message}` }], isError: true };
      }
    }
    case 'cortex_list_boards': {
      const { apiBase, q = '', limit = 20 } = params.arguments || {};
      if (!apiBase) return { content: [{ type: 'text', text: 'apiBase required' }], isError: true };
      try {
        const url = `${apiBase}/cortex?q=${encodeURIComponent(q)}&limit=${limit}`;
        const r = await fetch(url);
        const d = await r.json();
        return { content: [{ type: 'text', text: JSON.stringify(d, null, 2) }] };
      } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
    }
    case 'cortex_create_board': {
      const { apiBase, name, description, expires_in_hours, parent_id } = params.arguments || {};
      if (!apiBase || !name) return { content: [{ type: 'text', text: 'apiBase and name required' }], isError: true };
      try {
        const body = { name, description, expires_in_hours, parent_id };
        const r = await fetch(`${apiBase}/cortex`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) return { content: [{ type: 'text', text: `Error: ${d.error}` }], isError: true };
        const origin = new URL(apiBase).origin;
        return { content: [{ type: 'text', text: JSON.stringify({ ...d, url: `${origin}/cortex/${d.id}`, wiki: `${origin}/cortex/${d.id}/wiki` }) }] };
      } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
    }
    case 'cortex_remember': {
      const { apiBase, boardId, text, url } = params.arguments || {};
      if (!apiBase || !boardId) return { content: [{ type: 'text', text: 'apiBase and boardId required' }], isError: true };
      if (!text && !url) return { content: [{ type: 'text', text: 'Provide text or url' }], isError: true };
      try {
        const body = {};
        if (text) body.text = text;
        if (url)  body.url  = url;
        const r = await fetch(`${apiBase}/cortex/${boardId}/piezas`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) return { content: [{ type: 'text', text: `Error: ${d.error}` }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify({ piece_id: d.id, status: d.status, note: 'Processing async — use cortex_search after ~2s to retrieve it' }) }] };
      } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
    }
    case 'cortex_search': {
      const { apiBase, boardId, query, top_k = 5, category } = params.arguments || {};
      if (!apiBase || !boardId || !query) return { content: [{ type: 'text', text: 'apiBase, boardId and query required' }], isError: true };
      try {
        const body = { query, top_k, ...(category ? { category } : {}) };
        const r = await fetch(`${apiBase}/cortex/${boardId}/query`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const d = await r.json();
        return { content: [{ type: 'text', text: JSON.stringify(d, null, 2) }] };
      } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
    }
    case 'cortex_get_wiki': {
      const { apiBase, boardId } = params.arguments || {};
      if (!apiBase || !boardId) return { content: [{ type: 'text', text: 'apiBase and boardId required' }], isError: true };
      try {
        const r = await fetch(`${apiBase}/cortex/${boardId}/wiki`);
        const d = await r.json();
        return { content: [{ type: 'text', text: d.content_md || JSON.stringify(d) }] };
      } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
    }
    case 'cortex_get_board': {
      const { apiBase, boardId } = params.arguments || {};
      if (!apiBase || !boardId) return { content: [{ type: 'text', text: 'apiBase and boardId required' }], isError: true };
      try {
        const r = await fetch(`${apiBase}/cortex/${boardId}`);
        const d = await r.json();
        return { content: [{ type: 'text', text: JSON.stringify(d, null, 2) }] };
      } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
    }
    case 'cortex_forget': {
      const { apiBase, boardId, pieceId } = params.arguments || {};
      if (!apiBase || !boardId || !pieceId) return { content: [{ type: 'text', text: 'apiBase, boardId, pieceId required' }], isError: true };
      try {
        const r = await fetch(`${apiBase}/cortex/${boardId}/piezas/${pieceId}`, { method: 'DELETE' });
        const d = await r.json();
        return { content: [{ type: 'text', text: JSON.stringify(d) }] };
      } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
    }
    case 'render_app': {
      const { apiBase, token, project, slug, title, description, publishMode = 'game', pageHtml } = params.arguments || {};
      if (!apiBase || !token || !project) {
        return { content: [{ type: 'text', text: 'apiBase, token, and project are required' }], isError: true };
      }
      try {
        const body = { project, slug, title, description, publishMode, pageHtml };
        const res = await fetch(`${apiBase}/publish/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) return { content: [{ type: 'text', text: `API error: ${data.error || res.status}` }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Request failed: ${err.message}` }], isError: true };
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${params.name}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
