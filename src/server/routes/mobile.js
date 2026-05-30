// Mobile API — builder projects + auth for iOS/native apps.
import express from 'express';
import { query, isAvailable } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

export const mobileRouter = express.Router();

// GET /api/mobile/dashboard
mobileRouter.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const db = await isAvailable();

    let profile = { id: userId, email: req.user.email, role: req.user.role };
    if (db && userId) {
      const { rows } = await query(
        'SELECT id, email, display_name, avatar_url, role, created_at, last_login FROM users WHERE id = $1',
        [userId]
      );
      if (rows.length) profile = rows[0];
    }

    let projects = [];
    if (db && userId) {
      const { rows } = await query(
        `SELECT id, name, last_saved AS "lastSaved", is_demo AS "isDemo",
                data->>'viewMode' AS "viewMode",
                jsonb_array_length(COALESCE(data->'screens', '[]'::jsonb)) AS "screenCount"
         FROM projects WHERE owner_id = $1 ORDER BY last_saved DESC LIMIT 100`,
        [userId]
      );
      projects = rows;
    }

    let published = [];
    if (db && userId) {
      const { rows } = await query(
        `SELECT id, slug, title, publish_mode AS "publishMode", updated_at AS "updatedAt", visit_count AS "visitCount"
         FROM published_pages WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 20`,
        [userId]
      ).catch(() => ({ rows: [] }));
      const origin = req.protocol + '://' + req.get('host');
      const uRow = await query('SELECT username FROM users WHERE id = $1', [userId]).catch(() => ({ rows: [] }));
      const username = uRow.rows[0]?.username || profile.email?.split('@')[0] || 'user';
      published = rows.map(r => ({ ...r, url: origin + '/' + username + '/' + r.slug }));
    }

    res.json({ profile, projects, published,
      meta: { project_count: projects.length, published_count: published.length, generated_at: new Date().toISOString() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mobile/auth-info
mobileRouter.get('/auth-info', (req, res) => {
  const origin = req.protocol + '://' + req.get('host');
  res.json({
    auth: {
      register: { method: 'POST', url: origin + '/api/auth/register' },
      login:    { method: 'POST', url: origin + '/api/auth/login' },
      me:       { method: 'GET',  url: origin + '/api/auth/me', auth: 'Bearer <token>' },
      logout:   { method: 'POST', url: origin + '/api/auth/logout', auth: 'Bearer <token>' },
    },
    endpoints: { dashboard: origin + '/api/mobile/dashboard', projects: origin + '/api/projects' },
  });
});
