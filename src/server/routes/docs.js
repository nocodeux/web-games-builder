import express from 'express';
import { readdir, readFile, stat } from 'fs/promises';
import { watch } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

export const docsRouter = express.Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT  = path.resolve(__dirname, '../../../docs-mcp/resources');
const SRC_ROOT   = path.resolve(__dirname, '../../components/Componentes');

// ── SSE subscriber registry ───────────────────────────────────────────────────
// Each entry: { res, lastEventId }
const _sseClients = new Set();

function broadcast(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of _sseClients) {
    try { client.res.write(payload); } catch { _sseClients.delete(client); }
  }
}

// ── Content hash helper ───────────────────────────────────────────────────────
function hashContent(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

// ── Component manifest (both spec + source hashes) ───────────────────────────
async function buildManifest() {
  const specDir = path.join(DOCS_ROOT, 'components');
  const files   = (await readdir(specDir)).filter(f => f.endsWith('.json'));
  const entries = await Promise.all(files.map(async f => {
    const name  = path.basename(f, '.json');
    const specPath = path.join(specDir, f);
    const srcPath  = path.join(SRC_ROOT, `${name}.jsx`);

    const [specStat, srcStat] = await Promise.all([
      stat(specPath).catch(() => null),
      stat(srcPath).catch(() => null),
    ]);
    const [specText, srcText] = await Promise.all([
      readFile(specPath, 'utf-8').catch(() => ''),
      readFile(srcPath,  'utf-8').catch(() => ''),
    ]);

    return {
      type:             name,
      spec_hash:        hashContent(specText),
      source_hash:      srcText ? hashContent(srcText) : null,
      spec_updated_at:  specStat?.mtime.toISOString() || null,
      source_updated_at: srcStat?.mtime.toISOString() || null,
      has_source:       !!srcText,
      spec_url:         `/api/docs/components/${name}`,
      source_url:       srcText ? `/api/docs/components/${name}/source` : null,
    };
  }));
  return entries.sort((a, b) => a.type.localeCompare(b.type));
}

// ── File watcher — fires when spec or source changes ─────────────────────────
async function startWatcher() {
  const dirs = [path.join(DOCS_ROOT, 'components'), SRC_ROOT];
  for (const dir of dirs) {
    try {
      watch(dir, { persistent: false }, async (event, filename) => {
        if (!filename) return;
        const isSpec   = filename.endsWith('.json');
        const isSource = filename.endsWith('.jsx');
        if (!isSpec && !isSource) return;

        const name = path.basename(filename, isSpec ? '.json' : '.jsx');
        const layer = isSpec ? 'spec' : 'source';

        // Compute fresh hash for the changed file
        const filePath = isSpec
          ? path.join(DOCS_ROOT, 'components', filename)
          : path.join(SRC_ROOT, filename);
        const text = await readFile(filePath, 'utf-8').catch(() => null);
        if (!text) return;

        const eventData = {
          type:        name,
          layer,                    // 'spec' | 'source'
          version:     hashContent(text),
          updated_at:  new Date().toISOString(),
          spec_url:    `/api/docs/components/${name}`,
          source_url:  `/api/docs/components/${name}/source`,
        };

        broadcast('component_updated', eventData);
      });
    } catch {
      // Dir may not exist (SRC_ROOT absent in production) — skip silently
    }
  }
}

startWatcher();

// ── GET /api/docs/stream — SSE permanent connection ───────────────────────────
docsRouter.get('/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx: disable buffering
  res.flushHeaders();

  // Send component manifest immediately so the agent knows current state
  buildManifest().then(manifest => {
    res.write(`event: connected\ndata: ${JSON.stringify({ manifest, ts: new Date().toISOString() })}\n\n`);
  }).catch(() => {
    res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
  });

  // Keepalive comment every 25s (prevents proxies from closing the connection)
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
  }, 25000);

  const client = { res };
  _sseClients.add(client);

  req.on('close', () => {
    clearInterval(heartbeat);
    _sseClients.delete(client);
  });
});

// ── GET /api/docs/components/manifest — version fingerprints ─────────────────
docsRouter.get('/components/manifest', async (req, res) => {
  try {
    const manifest = await buildManifest();
    res.json({ manifest, generated_at: new Date().toISOString(), count: manifest.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/docs/components — full list (all specs) ─────────────────────────
docsRouter.get('/components', async (req, res) => {
  try {
    const dir = path.join(DOCS_ROOT, 'components');
    const files = await readdir(dir);
    const components = await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(async f => {
          const raw = await readFile(path.join(dir, f), 'utf-8');
          return JSON.parse(raw);
        })
    );
    res.json({ components: components.sort((a, b) => a.type.localeCompare(b.type)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/docs/components/:name — single component spec ───────────────────
docsRouter.get('/components/:name', async (req, res) => {
  try {
    const name = path.basename(req.params.name).replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(DOCS_ROOT, 'components', `${name}.json`);
    const raw = await readFile(filePath, 'utf-8');
    res.type('application/json').send(raw);
  } catch {
    res.status(404).json({ error: 'Component not found' });
  }
});

// Components whose spec name differs from the JSX filename
const SOURCE_ALIAS = {
  Input: 'TextBox',
};

// ── GET /api/docs/components/:name/source — React JSX source code ─────────────
docsRouter.get('/components/:name/source', async (req, res) => {
  try {
    const name    = path.basename(req.params.name).replace(/[^a-zA-Z0-9_-]/g, '');
    const srcName = SOURCE_ALIAS[name] || name;
    const srcPath = path.join(SRC_ROOT, `${srcName}.jsx`);
    const source  = await readFile(srcPath, 'utf-8');
    const version = hashContent(source);

    // Also load the spec so the agent gets both in one shot
    const specPath = path.join(DOCS_ROOT, 'components', `${name}.json`);
    let spec = null;
    try { spec = JSON.parse(await readFile(specPath, 'utf-8')); } catch {}

    if (req.headers['accept']?.includes('application/json')) {
      res.json({
        type:       name,
        version,
        updated_at: (await stat(srcPath)).mtime.toISOString(),
        source,
        spec,
      });
    } else {
      // Plain text for curl / grep / direct agent consumption
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('X-Component-Type',    name);
      res.setHeader('X-Component-Version', version);
      res.send(source);
    }
  } catch {
    res.status(404).json({ error: 'Source not found for this component' });
  }
});

// ── POST /api/docs/components/:name/notify — manual change broadcast ──────────
// Admin endpoint: trigger a component_updated SSE event without a file change.
// Useful in CI/CD: after deploy, POST here for each changed component so
// the iOS agent receives the event even if it missed the file-watch window.
docsRouter.post('/components/:name/notify', async (req, res) => {
  const name = path.basename(req.params.name).replace(/[^a-zA-Z0-9_-]/g, '');
  const layer = req.body?.layer || 'source';

  const srcPath  = path.join(SRC_ROOT, `${name}.jsx`);
  const specPath = path.join(DOCS_ROOT, 'components', `${name}.json`);
  const filePath = layer === 'spec' ? specPath : srcPath;
  const text = await readFile(filePath, 'utf-8').catch(() => null);

  const eventData = {
    type:       name,
    layer,
    version:    text ? hashContent(text) : req.body?.version || 'unknown',
    updated_at: new Date().toISOString(),
    spec_url:   `/api/docs/components/${name}`,
    source_url: `/api/docs/components/${name}/source`,
    note:       req.body?.note || null,
  };

  broadcast('component_updated', eventData);
  res.json({ ok: true, clients_notified: _sseClients.size, event: eventData });
});

// ── GET /api/docs/tutorials — markdown tutorials ──────────────────────────────
docsRouter.get('/tutorials', async (req, res) => {
  try {
    const dir = path.join(DOCS_ROOT, 'tutorials');
    const files = await readdir(dir);
    const tutorials = await Promise.all(
      files
        .filter(f => f.endsWith('.md'))
        .sort()
        .map(async f => {
          const content = await readFile(path.join(dir, f), 'utf-8');
          const titleMatch = content.match(/^#\s+(.+)/m);
          return {
            slug: f.replace('.md', ''),
            title: titleMatch ? titleMatch[1].replace('Tutorial: ', '') : f,
            content,
          };
        })
    );
    res.json({ tutorials });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/docs/schema/:name ────────────────────────────────────────────────
docsRouter.get('/schema/:name', async (req, res) => {
  try {
    const name = path.basename(req.params.name);
    const filePath = path.join(DOCS_ROOT, 'schemas', name);
    const raw = await readFile(filePath, 'utf-8');
    res.type('application/json').send(raw);
  } catch {
    res.status(404).json({ error: 'Schema not found' });
  }
});
