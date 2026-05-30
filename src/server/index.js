import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { projectsRouter }   from './routes/projects.js';
import { settingsRouter }   from './routes/settings.js';
import { authRouter }       from './routes/auth.js';
import { assetsRouter }     from './routes/assets.js';
import { publishRouter }    from './routes/publish.js';
import { migrateRouter }    from './routes/migrate.js';
import { mobileRouter }     from './routes/mobile.js';
import { requireAuth }      from './middleware/auth.js';
import { runSchema, isAvailable, query } from './db/index.js';
import { createMultiplayerServer } from './routes/multiplayer.js';

try {
  const { config } = await import('dotenv');
  config();
} catch { /* dotenv optional */ }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT   = process.env.PORT || 3002;
const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', 1);

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:3001', 'http://localhost:3000'];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const uploadsPath = path.resolve(process.cwd(), process.env.STORAGE_PATH || './uploads');
app.use('/uploads', express.static(uploadsPath));

const runtimePath = isProd
  ? path.resolve(__dirname, '../../dist/runtime')
  : path.resolve(__dirname, '../../public/runtime');
app.use('/runtime', express.static(runtimePath));

// In dev, redirect / to the Vite builder on 3001
if (!isProd) {
  app.get('/', (_req, res) => res.redirect(302, 'http://localhost:3001'));
}

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',     authRouter);
app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/assets',   assetsRouter);
app.use('/api/publish',  requireAuth, publishRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/migrate',  migrateRouter);
app.use('/api/mobile',   mobileRouter);

// ─── Published page route: /:username/:slug ───────────────────────────────────
app.get('/:username/:slug', async (req, res, next) => {
  const { username, slug } = req.params;
  if (username.startsWith('_') || username === 'api' || username === 'runtime' || username === 'uploads') return next();
  if (!await isAvailable()) return next();
  try {
    const { rows } = await query(
      `SELECT pp.html_content, pp.is_public
       FROM published_pages pp
       JOIN users u ON u.id = pp.owner_id
       WHERE u.username = $1 AND pp.slug = $2`,
      [username, slug]
    );
    if (!rows.length || !rows[0].html_content) return next();
    if (!rows[0].is_public) return res.status(403).send('This page is private');
    query('UPDATE published_pages SET visit_count = visit_count + 1 WHERE owner_id = (SELECT id FROM users WHERE username = $1) AND slug = $2', [username, slug]).catch(() => {});
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(rows[0].html_content);
  } catch (err) {
    console.error('[serve]', err.message);
    next();
  }
});

// ─── Serve built React app in production ──────────────────────────────────────
if (isProd) {
  const distPath = path.resolve(__dirname, '../../dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

const server = app.listen(PORT, async () => {
  createMultiplayerServer(server);
  console.log(`Web Games Builder :${PORT} [${isProd ? 'production' : 'development'}]`);
  if (!isProd) console.log(`  → Builder UI: http://localhost:3001`);
  if (process.env.DATABASE_URL) {
    try {
      await runSchema();
      console.log('[db] PostgreSQL connected ✓');
    } catch (err) {
      console.warn('[db] PostgreSQL unavailable — filesystem fallback:', err.message);
    }
  }
});
