/**
 * TUIFY — Server-side environment migration endpoint.
 *
 * POST /api/admin/migrate
 * Authorization: Bearer <admin-jwt>
 * Body: { sourceDbUrl: string, sourceBucket?: string, dryRun?: boolean }
 *
 * What it does (all on the server — no local CLI needed):
 *   1. S3: lists every object in the staging bucket and copies it into the
 *      production bucket using a server-side S3 CopyObject call (no download).
 *   2. DB: connects to the staging PostgreSQL, reads every row in dependency
 *      order, and inserts into the production PostgreSQL with ON CONFLICT DO NOTHING.
 *   3. URLs: rewrites every embedded CDN URL from the staging bucket base to the
 *      production bucket base inline during the DB copy.
 *
 * Admin-only. Returns a JSON log of every step.
 */

import express from 'express';
import { S3Client, ListObjectsV2Command, CopyObjectCommand } from '@aws-sdk/client-s3';
import pg from 'pg';
import { query, withTransaction } from '../db/index.js';

const { Pool } = pg;
export const migrateRouter = express.Router();

// ─── Guard: admin only ─────────────────────────────────────────────────────────
migrateRouter.use((req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
});

// ─── POST /api/admin/migrate ───────────────────────────────────────────────────
migrateRouter.post('/', async (req, res) => {
  const {
    sourceDbUrl,
    sourceBucket = 'feature-game-builder-builder-staging',
    dryRun = false,
  } = req.body || {};

  if (!sourceDbUrl) {
    return res.status(400).json({
      error: 'sourceDbUrl is required — find it in Coolify → staging app → Environment Variables → DATABASE_URL',
    });
  }

  const targetBucket = process.env.AWS_BUCKET;
  if (!targetBucket) {
    return res.status(500).json({ error: 'AWS_BUCKET not set on this server' });
  }

  const OLD_BASE = `https://storage.tuify.app/${sourceBucket}`;
  const NEW_BASE = `https://storage.tuify.app/${targetBucket}`;

  const log    = [];
  const errors = [];

  function step(msg) { log.push(msg); console.log('[migrate]', msg); }
  function warn(msg) { errors.push(msg); console.warn('[migrate] WARN', msg); }

  step(`source bucket : ${sourceBucket}`);
  step(`target bucket : ${targetBucket}`);
  step(`CDN remap     : ${OLD_BASE} → ${NEW_BASE}`);
  step(`dry run       : ${dryRun}`);

  try {
    // ── 1. S3 server-side copy ─────────────────────────────────────────────────
    step('\n── S3 copy ──');

    const s3 = new S3Client({
      endpoint:   process.env.AWS_ENDPOINT_URL,
      region:     process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    });

    let totalListed = 0;
    let totalCopied = 0;
    let totalS3Err  = 0;
    let token;

    do {
      const listRes = await s3.send(new ListObjectsV2Command({
        Bucket: sourceBucket,
        ContinuationToken: token,
      }));

      const objects = listRes.Contents || [];
      totalListed += objects.length;

      for (const obj of objects) {
        if (dryRun) { totalCopied++; continue; }
        try {
          // CopySource format: bucket/key — only the key part is percent-encoded
          await s3.send(new CopyObjectCommand({
            Bucket:     targetBucket,
            CopySource: `${sourceBucket}/${obj.Key.split('/').map(encodeURIComponent).join('/')}`,
            Key:        obj.Key,
          }));
          totalCopied++;
        } catch (e) {
          warn(`copy failed: ${obj.Key} — ${e.message}`);
          totalS3Err++;
        }
      }

      token = listRes.NextContinuationToken;
    } while (token);

    step(`listed ${totalListed} objects, copied ${totalCopied}, errors ${totalS3Err}`);

    // ── 2. PostgreSQL copy ─────────────────────────────────────────────────────
    step('\n── Database copy ──');
    step('connecting to source database…');

    const srcPool = new Pool({
      connectionString: sourceDbUrl,
      connectionTimeoutMillis: 10_000,
      ssl: sourceDbUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    });

    // Verify source connectivity before opening a transaction on the target
    await srcPool.query('SELECT 1');
    step('source database connected');

    function rewrite(value) {
      if (!value) return value;
      if (typeof value === 'string') return value.replaceAll(OLD_BASE, NEW_BASE);
      return JSON.parse(JSON.stringify(value).replaceAll(OLD_BASE, NEW_BASE));
    }

    if (!dryRun) {
      await withTransaction(async (dest) => {

        // users ────────────────────────────────────────────────────────────────
        const { rows: users } = await srcPool.query('SELECT * FROM users');
        step(`users: ${users.length} rows`);
        for (const u of users) {
          // ON CONFLICT DO NOTHING (no target) suppresses conflicts on any
          // unique constraint — id, email, x_id, google_id, username.
          await dest.query(`
            INSERT INTO users
              (id, email, password_hash, display_name, avatar_url,
               x_id, x_handle, google_id, role, created_at, last_login,
               demos_seeded, username)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT DO NOTHING`,
            [u.id, u.email, u.password_hash, u.display_name, u.avatar_url,
             u.x_id, u.x_handle, u.google_id, u.role, u.created_at, u.last_login,
             u.demos_seeded ?? false, u.username]);
        }

        // projects ─────────────────────────────────────────────────────────────
        const { rows: projects } = await srcPool.query('SELECT * FROM projects');
        step(`projects: ${projects.length} rows`);
        for (const p of projects) {
          await dest.query(`
            INSERT INTO projects
              (id, name, data, assets_json, last_saved, created_at,
               owner_id, is_demo, demo_order, cloned_from, user_edited)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT DO NOTHING`,
            [p.id, p.name,
             rewrite(p.data),
             rewrite(p.assets_json),
             p.last_saved, p.created_at,
             p.owner_id, p.is_demo ?? false, p.demo_order ?? 0,
             p.cloned_from, p.user_edited ?? false]);
        }

        // assets ───────────────────────────────────────────────────────────────
        const { rows: assets } = await srcPool.query('SELECT * FROM assets');
        step(`assets: ${assets.length} rows`);
        for (const a of assets) {
          await dest.query(`
            INSERT INTO assets
              (id, project_id, owner_id, type, name, storage_key, cdn_url, frame_meta, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT DO NOTHING`,
            [a.id, a.project_id, a.owner_id, a.type, a.name,
             a.storage_key,
             rewrite(a.cdn_url),
             a.frame_meta, a.created_at]);
        }

        // settings_kv ──────────────────────────────────────────────────────────
        const { rows: settings } = await srcPool.query('SELECT * FROM settings_kv');
        step(`settings_kv: ${settings.length} rows`);
        for (const s of settings) {
          await dest.query(`
            INSERT INTO settings_kv (key, value) VALUES ($1,$2)
            ON CONFLICT (key) DO NOTHING`,
            [s.key, s.value]);
        }

        // published_pages ──────────────────────────────────────────────────────
        const { rows: pages } = await srcPool.query('SELECT * FROM published_pages');
        step(`published_pages: ${pages.length} rows`);
        for (const pg of pages) {
          await dest.query(`
            INSERT INTO published_pages
              (id, owner_id, source_id, world_id, slug, title, description,
               html_path, published_at, updated_at, is_public, visit_count,
               publish_mode, html_content)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            ON CONFLICT DO NOTHING`,
            [pg.id, pg.owner_id, pg.source_id, pg.world_id, pg.slug,
             pg.title, pg.description, pg.html_path,
             pg.published_at, pg.updated_at, pg.is_public ?? true,
             pg.visit_count ?? 0, pg.publish_mode || 'game',
             rewrite(pg.html_content)]);
        }
      });
    } else {
      // Dry run — just count rows in each table
      for (const table of ['users', 'projects', 'assets', 'settings_kv', 'published_pages']) {
        const { rows } = await srcPool.query(`SELECT COUNT(*) AS n FROM ${table}`);
        step(`[dry] ${table}: ${rows[0].n} rows (not written)`);
      }
    }

    await srcPool.end();
    step('\n── Migration complete ──');

    return res.json({
      ok:   true,
      dryRun,
      s3:   { listed: totalListed, copied: totalCopied, errors: totalS3Err },
      log,
      errors,
    });

  } catch (err) {
    console.error('[migrate] fatal:', err);
    return res.status(500).json({ ok: false, error: err.message, log, errors });
  }
});
