import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, isAvailable } from '../db/index.js';
import { DEFAULT_ROBOTS_CONFIG } from '../../lib/robotsDocs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsPath = path.resolve(__dirname, '../../../settings.json');
const GLOBAL_KEY = 'global';

export const settingsRouter = express.Router();

const defaultGlobal = { builderName: 'TUIFY Builder', robots: DEFAULT_ROBOTS_CONFIG };

// GET /api/settings — merges global + per-user settings
settingsRouter.get('/', async (req, res) => {
  try {
    if (await isAvailable()) {
      const userId = req.user?.userId;
      const [globalRes, userRes] = await Promise.all([
        query('SELECT value FROM settings_kv WHERE key = $1', [GLOBAL_KEY]),
        userId
          ? query('SELECT value FROM settings_kv WHERE key = $1', [`user:${userId}`])
          : Promise.resolve({ rows: [] }),
      ]);
      const global = globalRes.rows[0]?.value || defaultGlobal;
      const user = userRes.rows[0]?.value || {};
      return res.json({ ...global, ...user });
    }
    // Filesystem fallback (single-user)
    if (fs.existsSync(settingsPath)) {
      return res.json(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')));
    }
    res.json(defaultGlobal);
  } catch (err) {
    console.error('[settings] GET error:', err.message);
    res.json(defaultGlobal);
  }
});

// POST /api/settings
// - builderName / tutorial / robots → global, admin-only
// - everything else → per-user
settingsRouter.post('/', async (req, res) => {
  const { builderName, tutorial, robots, ...userFields } = req.body || {};
  const isAdmin = req.user?.role === 'admin';

  try {
    if (await isAvailable()) {
      const userId = req.user?.userId;

      const globalFields = {};
      if (builderName !== undefined && isAdmin) globalFields.builderName = builderName;
      if (tutorial     !== undefined && isAdmin) globalFields.tutorial     = tutorial;
      if (robots       !== undefined && isAdmin) globalFields.robots       = robots;

      if (Object.keys(globalFields).length > 0) {
        const cur = await query('SELECT value FROM settings_kv WHERE key = $1', [GLOBAL_KEY]);
        const existing = cur.rows[0]?.value || {};
        await query(
          `INSERT INTO settings_kv (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [GLOBAL_KEY, JSON.stringify({ ...existing, ...globalFields })]
        );
      }

      if (userId && Object.keys(userFields).length > 0) {
        const cur = await query('SELECT value FROM settings_kv WHERE key = $1', [`user:${userId}`]);
        const existing = cur.rows[0]?.value || {};
        await query(
          `INSERT INTO settings_kv (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [`user:${userId}`, JSON.stringify({ ...existing, ...userFields })]
        );
      }

      return res.json({ success: true });
    }

    // Filesystem fallback
    const existing = fs.existsSync(settingsPath)
      ? JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      : {};
    const updated = { ...existing, ...userFields };
    if (builderName !== undefined) updated.builderName = builderName;
    if (tutorial    !== undefined) updated.tutorial    = tutorial;
    if (robots      !== undefined) updated.robots      = robots;
    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error('[settings] POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
