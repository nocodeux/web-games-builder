import pg from 'pg';

const { Pool } = pg;

let _pool = null;

function getPool() {
  if (!_pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL not set — using filesystem fallback');
    }
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Reasonable defaults for a small platform
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    _pool.on('error', (err) => {
      console.error('[db] pool error:', err.message);
    });
  }
  return _pool;
}

export async function query(sql, params = []) {
  return getPool().query(sql, params);
}

export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Returns true if DATABASE_URL is configured and the DB is reachable
export async function isAvailable() {
  if (!process.env.DATABASE_URL) return false;
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// Run schema.sql — called on server startup
export async function runSchema() {
  const { readFileSync } = await import('fs');
  const { fileURLToPath } = await import('url');
  const { dirname, join } = await import('path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  await query(sql);
  console.log('[db] schema applied');
}
