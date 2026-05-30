import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, isAvailable } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectsDir = path.resolve(__dirname, '../../../projects');

export const projectsRouter = express.Router();

async function useDb() { return isAvailable(); }

function ensureDir() {
  if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });
}

// owner_id from JWT — undefined in single-user (env) mode
function ownerId(req) { return req.user?.userId || null; }

// ─── List projects ─────────────────────────────────────────────────────────────
// Admin-only: GET /api/projects?all=true returns every project across all users.
projectsRouter.get('/', async (req, res) => {
  try {
    if (await useDb()) {
      const owner   = ownerId(req);
      const isAdmin = req.user?.role === 'admin';
      const allMode = isAdmin && req.query.all === 'true';
      const { rows } = allMode
        ? await query(
            `SELECT id, name, owner_id AS "ownerId", last_saved AS "lastSaved", is_demo AS "isDemo", demo_order AS "demoOrder", cloned_from AS "clonedFrom"
             FROM projects ORDER BY last_saved DESC`
          )
        : owner
          ? await query(
              `SELECT id, name, last_saved AS "lastSaved", is_demo AS "isDemo", demo_order AS "demoOrder", cloned_from AS "clonedFrom"
               FROM projects WHERE owner_id = $1 ORDER BY last_saved DESC`,
              [owner]
            )
          : await query(
              `SELECT id, name, last_saved AS "lastSaved", is_demo AS "isDemo", demo_order AS "demoOrder", cloned_from AS "clonedFrom"
               FROM projects ORDER BY last_saved DESC`
            );
      return res.json(rows);
    }
    ensureDir();
    const projects = fs.readdirSync(projectsDir)
      .filter(f => f.endsWith('.json') && !f.endsWith('.assets.json'))
      .map(f => {
        try {
          const p = JSON.parse(fs.readFileSync(path.join(projectsDir, f), 'utf-8'));
          return { id: p.id, name: p.name || 'Untitled', lastSaved: p.lastSaved || new Date().toISOString() };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.lastSaved) - new Date(a.lastSaved));
    res.json(projects);
  } catch (err) {
    console.error('[projects] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// ─── Load project ──────────────────────────────────────────────────────────────
projectsRouter.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (await useDb()) {
      const owner   = ownerId(req);
      const isAdmin = req.user?.role === 'admin';
      const { rows } = (owner && !isAdmin)
        ? await query('SELECT data FROM projects WHERE id = $1 AND owner_id = $2', [id, owner])
        : await query('SELECT data FROM projects WHERE id = $1', [id]);
      if (!rows.length) return res.status(404).json({ error: 'Project not found' });
      return res.json(rows[0].data);
    }
    const filePath = path.join(projectsDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Project not found' });
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  } catch (err) {
    console.error('[projects] GET /:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Load assets sidecar ───────────────────────────────────────────────────────
projectsRouter.get('/:id/assets', async (req, res) => {
  const { id } = req.params;
  const empty = { sprites: [], tilesets: [], sounds: [], backgrounds: [], videos: [] };
  try {
    if (await useDb()) {
      const owner   = ownerId(req);
      const isAdmin = req.user?.role === 'admin';
      const { rows } = (owner && !isAdmin)
        ? await query('SELECT assets_json FROM projects WHERE id = $1 AND owner_id = $2', [id, owner])
        : await query('SELECT assets_json FROM projects WHERE id = $1', [id]);
      return res.json(rows.length ? (rows[0].assets_json || empty) : empty);
    }
    ensureDir();
    const filePath = path.join(projectsDir, `${id}.assets.json`);
    res.json(fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) : empty);
  } catch (err) {
    console.error('[projects] GET /:id/assets error:', err.message);
    res.json(empty);
  }
});

// ─── Save project ──────────────────────────────────────────────────────────────
projectsRouter.post('/', async (req, res) => {
  const project = req.body;
  if (!project?.id) return res.status(400).json({ error: 'Project ID required' });
  if (project.id === 'default') return res.status(400).json({ error: 'Invalid project ID' });
  try {
    if (await useDb()) {
      const owner = ownerId(req);
      await query(
        `INSERT INTO projects (id, name, data, owner_id, last_saved)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
           SET name       = EXCLUDED.name,
               data       = EXCLUDED.data,
               owner_id   = COALESCE(projects.owner_id, EXCLUDED.owner_id),
               last_saved = EXCLUDED.last_saved
         WHERE projects.owner_id IS NULL OR projects.owner_id = EXCLUDED.owner_id`,
        [project.id, project.name || 'Untitled', JSON.stringify(project), owner, project.lastSaved ? new Date(project.lastSaved) : new Date()]
      );
      // Break sync with source demo once user saves their own changes
      if (owner) {
        await query(
          `UPDATE projects SET user_edited = true
           WHERE id = $1 AND owner_id = $2 AND cloned_from IS NOT NULL AND NOT user_edited`,
          [project.id, owner]
        );
      }
      // If this is a demo project, immediately propagate name+data to all unedited user clones.
      // Each clone keeps its own id embedded in data so we use jsonb_set to override only that field.
      const { rows: demoCheck } = await query(
        'SELECT is_demo FROM projects WHERE id = $1 AND is_demo = true', [project.id]
      );
      if (demoCheck.length) {
        await query(
          `UPDATE projects
           SET name = $1,
               data = jsonb_set(
                 jsonb_set($2::jsonb, '{id}', to_jsonb(id::text), true),
                 '{name}', to_jsonb($1::text), true
               )
           WHERE cloned_from = $3 AND NOT user_edited`,
          [project.name || 'Untitled', JSON.stringify(project), project.id]
        );
      }
      return res.json({ success: true });
    }
    ensureDir();
    fs.writeFileSync(path.join(projectsDir, `${project.id}.json`), JSON.stringify(project, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error('[projects] POST / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Save assets sidecar ───────────────────────────────────────────────────────
projectsRouter.post('/:id/assets', async (req, res) => {
  const { id } = req.params;
  if (id === 'default') return res.status(400).json({ error: 'Invalid project ID' });
  try {
    if (await useDb()) {
      const owner = ownerId(req);
      await query(
        `INSERT INTO projects (id, name, data, assets_json, owner_id)
         VALUES ($1, 'Untitled', '{}', $2, $3)
         ON CONFLICT (id) DO UPDATE
           SET assets_json = EXCLUDED.assets_json
         WHERE projects.owner_id IS NULL OR projects.owner_id = EXCLUDED.owner_id`,
        [id, JSON.stringify(req.body), owner]
      );
      return res.json({ success: true });
    }
    ensureDir();
    fs.writeFileSync(path.join(projectsDir, `${id}.assets.json`), JSON.stringify(req.body));
    res.json({ success: true });
  } catch (err) {
    console.error('[projects] POST /:id/assets error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete assets sidecar ─────────────────────────────────────────────────────
projectsRouter.delete('/:id/assets', async (req, res) => {
  const { id } = req.params;
  try {
    if (await useDb()) {
      const owner = ownerId(req);
      const empty = { sprites: [], tilesets: [], sounds: [], backgrounds: [], videos: [] };
      const { rowCount } = owner
        ? await query('UPDATE projects SET assets_json = $1 WHERE id = $2 AND owner_id = $3', [JSON.stringify(empty), id, owner])
        : await query('UPDATE projects SET assets_json = $1 WHERE id = $2', [JSON.stringify(empty), id]);
      if (!rowCount) return res.status(404).json({ error: 'Project not found' });
      return res.json({ success: true });
    }
    const filePath = path.join(projectsDir, `${id}.assets.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    console.error('[projects] DELETE /:id/assets error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin: claim orphan projects ─────────────────────────────────────────────
// POST /api/projects/admin/claim-orphans
// One-time fix: assign projects with owner_id = NULL to the calling admin user.
projectsRouter.post('/admin/claim-orphans', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  if (!await useDb()) return res.status(503).json({ error: 'Database required' });
  const owner = ownerId(req);
  if (!owner) return res.status(400).json({ error: 'Admin user has no userId in token — log out and back in first' });
  try {
    const { rowCount } = await query(
      'UPDATE projects SET owner_id = $1 WHERE owner_id IS NULL',
      [owner]
    );
    res.json({ success: true, claimed: rowCount });
  } catch (err) {
    console.error('[projects] claim-orphans error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin: toggle demo flag ───────────────────────────────────────────────────
// PATCH /api/projects/:id/demo  { isDemo: bool, demoOrder?: number }
projectsRouter.patch('/:id/demo', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  if (!await useDb()) return res.status(503).json({ error: 'Database required' });
  const { id } = req.params;
  const { isDemo, demoOrder } = req.body || {};
  const owner = ownerId(req);
  try {
    // Admin route — no owner_id filter needed (role already verified above)
    const { rowCount } = await query(
      `UPDATE projects SET is_demo = $1, demo_order = COALESCE($2, demo_order) WHERE id = $3`,
      [Boolean(isDemo), demoOrder ?? null, id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Project not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[projects] PATCH /:id/demo error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete project ────────────────────────────────────────────────────────────
projectsRouter.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (await useDb()) {
      const owner = ownerId(req);
      const { rowCount } = owner
        ? await query('DELETE FROM projects WHERE id = $1 AND owner_id = $2', [id, owner])
        : await query('DELETE FROM projects WHERE id = $1', [id]);
      if (!rowCount) return res.status(404).json({ error: 'Project not found' });
      // Remove all unedited clones that point to this project so users don't see orphaned demos
      await query('DELETE FROM projects WHERE cloned_from = $1 AND NOT user_edited', [id]);
      return res.json({ success: true });
    }
    const filePath = path.join(projectsDir, `${id}.json`);
    const assetsPath = path.join(projectsDir, `${id}.assets.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Project not found' });
    fs.unlinkSync(filePath);
    if (fs.existsSync(assetsPath)) fs.unlinkSync(assetsPath);
    res.json({ success: true });
  } catch (err) {
    console.error('[projects] DELETE /:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
