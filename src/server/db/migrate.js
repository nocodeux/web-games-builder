/**
 * Phase 2 migration: filesystem → PostgreSQL
 *
 * Reads every projects/*.json and projects/*.assets.json and inserts them
 * into the projects table.
 *
 * Safe to run multiple times — uses ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node src/server/db/migrate.js
 *
 * Before running:
 *   cp -r projects/ projects_backup_$(date +%Y%m%d)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query, runSchema } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectsDir = path.resolve(__dirname, '../../../projects');

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set.');
    console.error('Usage: DATABASE_URL=postgresql://... node src/server/db/migrate.js');
    process.exit(1);
  }

  console.log('[migrate] Applying schema...');
  await runSchema();

  if (!fs.existsSync(projectsDir)) {
    console.log('[migrate] No projects/ directory found. Nothing to migrate.');
    process.exit(0);
  }

  const jsonFiles = fs.readdirSync(projectsDir)
    .filter(f => f.endsWith('.json') && !f.endsWith('.assets.json'));

  if (jsonFiles.length === 0) {
    console.log('[migrate] No project files found. Nothing to migrate.');
    process.exit(0);
  }

  console.log(`[migrate] Found ${jsonFiles.length} project(s) to migrate.`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of jsonFiles) {
    const id = file.replace('.json', '');
    try {
      const projectData = JSON.parse(fs.readFileSync(path.join(projectsDir, file), 'utf-8'));
      const assetsFile = path.join(projectsDir, `${id}.assets.json`);
      const assetsData = fs.existsSync(assetsFile)
        ? JSON.parse(fs.readFileSync(assetsFile, 'utf-8'))
        : { sprites: [], tilesets: [], sounds: [], backgrounds: [], videos: [] };

      const result = await query(
        `INSERT INTO projects (id, name, data, assets_json, last_saved, created_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          id,
          projectData.name || 'Untitled',
          JSON.stringify(projectData),
          JSON.stringify(assetsData),
          projectData.lastSaved ? new Date(projectData.lastSaved) : new Date(),
        ]
      );

      if (result.rowCount > 0) {
        console.log(`  ✓ Migrated: "${projectData.name}" (${id})`);
        migrated++;
      } else {
        console.log(`  ~ Skipped (already exists): "${projectData.name}" (${id})`);
        skipped++;
      }
    } catch (err) {
      console.error(`  ✗ Error migrating ${id}:`, err.message);
      errors++;
    }
  }

  console.log('\n[migrate] Done.');
  console.log(`  Migrated: ${migrated}  Skipped: ${skipped}  Errors: ${errors}`);

  if (errors > 0) {
    console.error('\n[migrate] Some projects failed. Check errors above.');
    console.error('[migrate] Restore from backup if needed: cp -r projects_backup_*/ projects/');
    process.exit(1);
  }

  // Verify count matches
  const { rows } = await query('SELECT COUNT(*) FROM projects');
  const dbCount = parseInt(rows[0].count, 10);
  console.log(`\n[migrate] DB now has ${dbCount} project(s). Expected ≥ ${jsonFiles.length}.`);

  // Seed admin user from env vars and assign orphaned projects
  await seedAdminUser();

  process.exit(0);
}

async function seedAdminUser() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  let adminId;

  if (existing.rows.length) {
    adminId = existing.rows[0].id;
    console.log(`[migrate] Admin user already exists (${email})`);
  } else {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, display_name, role) VALUES ($1, $2, 'Admin', 'admin') RETURNING id`,
      [email, hash]
    );
    adminId = rows[0].id;
    console.log(`[migrate] Admin user created (${email})`);
  }

  // Assign all projects without an owner to the admin user
  const { rowCount } = await query(
    'UPDATE projects SET owner_id = $1 WHERE owner_id IS NULL',
    [adminId]
  );
  if (rowCount > 0) console.log(`[migrate] Assigned ${rowCount} orphaned project(s) to admin`);
}

migrate().catch(err => {
  console.error('[migrate] Fatal error:', err);
  process.exit(1);
});
