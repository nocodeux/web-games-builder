import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { query, isAvailable } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sign(payload) {
  return jwt.sign({ ...payload, jti: randomUUID() }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '30d' });
}

function frontendUrl() {
  return (process.env.FRONTEND_URL || process.env.CORS_ORIGINS?.split(',')[0] || 'http://localhost:3001').trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Constant-time string comparison via HMAC to prevent timing attacks
function safeCompare(a, b) {
  const key = randomBytes(32);
  const ha = createHmac('sha256', key).update(String(a ?? '')).digest();
  const hb = createHmac('sha256', key).update(String(b ?? '')).digest();
  // HMAC-SHA256 always produces 32-byte buffers — timingSafeEqual length requirement is satisfied
  return timingSafeEqual(ha, hb);
}

// Pre-computed dummy hash so failed logins spend the same time as real ones
let _dummyHash = null;
async function dummyHash() {
  if (!_dummyHash) _dummyHash = await bcrypt.hash('__tuify_timing_dummy__', 12);
  return _dummyHash;
}

// Rate limiter: 10 attempts per 15 min window on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — try again in 15 minutes' },
});

// In-memory OAuth state store (10-min TTL, cleared after use)
const oauthStates = new Map();
function storeState(state, data) {
  oauthStates.set(state, { ...data, exp: Date.now() + 10 * 60_000 });
}
function consumeState(state) {
  const d = oauthStates.get(state);
  if (!d || d.exp < Date.now()) { oauthStates.delete(state); return null; }
  oauthStates.delete(state);
  return d;
}

// PKCE helpers
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function pkce() {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ─── upsertUser ──────────────────────────────────────────────────────────────
// Matches by provider ID first to prevent email-based account hijacking.
// Returns null if an email+password account already owns this email (caller must
// redirect to an error — never silently merge OAuth into a password account).
async function upsertUser({ email, displayName, avatarUrl, xId, xHandle, googleId, role = 'user' }) {
  // 1. Match by provider ID — most precise, immune to email collision
  if (xId || googleId) {
    const { rows } = xId
      ? await query('SELECT * FROM users WHERE x_id = $1', [xId])
      : await query('SELECT * FROM users WHERE google_id = $1', [googleId]);

    if (rows.length) {
      await query(
        `UPDATE users SET
           display_name = COALESCE($2, display_name),
           avatar_url   = COALESCE($3, avatar_url),
           x_handle     = COALESCE($4, x_handle),
           last_login   = now()
         WHERE id = $1`,
        [rows[0].id, displayName || null, avatarUrl || null, xHandle || null]
      );
      const { rows: updated } = await query('SELECT * FROM users WHERE id = $1', [rows[0].id]);
      return updated[0];
    }
  }

  // 2. Check email — allow linking only to OAuth-only accounts
  const { rows: byEmail } = await query('SELECT * FROM users WHERE email = $1', [email]);
  if (byEmail.length) {
    const existing = byEmail[0];
    if (existing.password_hash) {
      // Email is owned by a password account — do NOT link OAuth (prevents takeover)
      return null;
    }
    // Another OAuth account with the same email — safe to link provider IDs
    await query(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         avatar_url   = COALESCE($3, avatar_url),
         x_id         = COALESCE($4, x_id),
         x_handle     = COALESCE($5, x_handle),
         google_id    = COALESCE($6, google_id),
         last_login   = now()
       WHERE id = $1`,
      [existing.id, displayName || null, avatarUrl || null, xId || null, xHandle || null, googleId || null]
    );
    const { rows: updated } = await query('SELECT * FROM users WHERE id = $1', [existing.id]);
    return updated[0];
  }

  // 3. New user
  const { rows } = await query(
    `INSERT INTO users (email, display_name, avatar_url, x_id, x_handle, google_id, role, last_login)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING *`,
    [email, displayName || null, avatarUrl || null, xId || null, xHandle || null, googleId || null, role]
  );
  return rows[0];
}

function userToken(user) {
  return sign({ userId: user.id, email: user.email, role: user.role, displayName: user.display_name });
}

function userPublic(user) {
  return {
    userId:      user.id,
    email:       user.email,
    role:        user.role,
    displayName: user.display_name,
    avatarUrl:   user.avatar_url,
    xHandle:     user.x_handle,
    username:    user.username,
    credits:     user.credits ?? 0,
  };
}

async function seedDemosForUser(userId) {
  try {
    const { rows: u } = await query('SELECT role FROM users WHERE id = $1', [userId]);
    if (!u[0] || u[0].role === 'admin') return;

    const { rows: demos } = await query(
      'SELECT id, name, data, assets_json FROM projects WHERE is_demo = true ORDER BY demo_order ASC'
    );
    await query(
      `DELETE FROM projects
       WHERE owner_id = $1
         AND cloned_from IS NOT NULL
         AND NOT user_edited
         AND NOT EXISTS (
           SELECT 1 FROM projects d WHERE d.id = projects.cloned_from AND d.is_demo = true
         )`,
      [userId]
    );

    if (!demos.length) return;

    for (const demo of demos) {
      const { rows: existing } = await query(
        'SELECT id, user_edited FROM projects WHERE owner_id = $1 AND cloned_from = $2',
        [userId, demo.id]
      );

      if (existing.length) {
        if (!existing[0].user_edited) {
          const synced = { ...demo.data, id: existing[0].id };
          await query(
            'UPDATE projects SET data = $1, assets_json = $2, name = $3 WHERE id = $4',
            [JSON.stringify(synced), JSON.stringify(demo.assets_json), demo.name, existing[0].id]
          );
        }
      } else {
        const newId = randomUUID();
        const newData = { ...demo.data, id: newId };
        await query(
          `INSERT INTO projects (id, name, data, assets_json, owner_id, cloned_from, last_saved, user_edited)
           VALUES ($1, $2, $3, $4, $5, $6, now(), false)`,
          [newId, demo.name, JSON.stringify(newData), JSON.stringify(demo.assets_json), userId, demo.id]
        );
      }
    }

    await query('UPDATE users SET demos_seeded = true WHERE id = $1', [userId]);
  } catch (err) {
    console.error('[auth] seedDemosForUser error:', err.message);
  }
}

// ─── Register ────────────────────────────────────────────────────────────────

authRouter.post('/register', authLimiter, async (req, res) => {
  if (!process.env.JWT_SECRET) return res.status(500).json({ error: 'Server misconfigured' });
  if (!await isAvailable()) {
    return res.status(503).json({ error: 'Registration requires a database — set DATABASE_URL to enable.' });
  }
  const { email, password, displayName } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  if (password.length < 12) return res.status(400).json({ error: 'Password must be at least 12 characters' });
  if (displayName && displayName.length > 100) return res.status(400).json({ error: 'Display name too long' });

  const password_hash = await bcrypt.hash(password, 12);
  // Atomic upsert — eliminates TOCTOU race between check and insert
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, display_name, role)
     VALUES ($1, $2, $3, 'user')
     ON CONFLICT (email) DO NOTHING
     RETURNING *`,
    [email, password_hash, displayName?.slice(0, 100) || email.split('@')[0]]
  );
  if (!rows.length) return res.status(409).json({ error: 'Email already registered' });
  const user = rows[0];
  await seedDemosForUser(user.id);
  // Generate crypto wallets in the background — non-blocking
  import('../lib/walletGen.js').then(m => m.generateUserWallets(user.id)).catch(() => {});
  res.json({ token: userToken(user), ...userPublic(user) });
});

// ─── Login ────────────────────────────────────────────────────────────────────

authRouter.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!process.env.JWT_SECRET) return res.status(500).json({ error: 'JWT_SECRET not configured' });

  // DB path (multi-user mode)
  if (await isAvailable()) {
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];

    // Always run bcrypt.compare to prevent timing-based user enumeration
    const hash = user?.password_hash || await dummyHash();
    const valid = await bcrypt.compare(password || '', hash);

    if (valid && user?.password_hash) {
      await query('UPDATE users SET last_login = now() WHERE id = $1', [user.id]);
      await seedDemosForUser(user.id);
      return res.json({ token: userToken(user), ...userPublic(user) });
    }
    // Check env-var admin BEFORE the social-login block — the admin email may be
    // an OAuth account in DB (no password_hash) but still needs password login to work.
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      const emailOk = safeCompare(email, process.env.ADMIN_EMAIL);
      const passOk  = safeCompare(password, process.env.ADMIN_PASSWORD);
      if (emailOk && passOk) {
        // Upsert into DB so admin gets a real userId (needed for publishing, assets, etc.)
        const adminUser = await upsertUser({ email, displayName: 'Admin', role: 'admin' });
        if (adminUser) {
          await query('UPDATE users SET role = $1, last_login = now() WHERE id = $2', ['admin', adminUser.id]);
          const { rows: refreshed } = await query('SELECT * FROM users WHERE id = $1', [adminUser.id]);
          return res.json({ token: userToken(refreshed[0]), ...userPublic(refreshed[0]) });
        }
        return res.json({ token: sign({ email, role: 'admin' }), email, role: 'admin' });
      }
    }
    if (user && !user.password_hash) {
      return res.status(401).json({ error: 'This account uses social login — use X or Google to sign in' });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Fallback: single-user env vars (no DB) — constant-time comparison
  const emailOk = safeCompare(email, process.env.ADMIN_EMAIL);
  const passOk  = safeCompare(password, process.env.ADMIN_PASSWORD);
  if (emailOk && passOk) {
    return res.json({ token: sign({ email, role: 'admin' }), email, role: 'admin' });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

// ─── Me ───────────────────────────────────────────────────────────────────────

authRouter.get('/me', requireAuth, async (req, res) => {
  if (req.user.userId && await isAvailable()) {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.userId]);
    if (rows.length) return res.json(userPublic(rows[0]));
  }
  res.json(req.user);
});

// ─── Update profile ───────────────────────────────────────────────────────────

authRouter.patch('/me', requireAuth, async (req, res) => {
  if (!await isAvailable()) return res.status(503).json({ error: 'Database required' });
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const { displayName, avatarUrl } = req.body || {};
  if (displayName !== undefined && displayName.length > 100) return res.status(400).json({ error: 'Display name too long' });

  const setClauses = [];
  const values = [];
  let idx = 1;

  if (displayName !== undefined) { setClauses.push(`display_name = $${idx++}`); values.push(displayName.slice(0, 100)); }
  if (avatarUrl !== undefined)   { setClauses.push(`avatar_url = $${idx++}`);   values.push(avatarUrl); }

  if (setClauses.length) {
    values.push(userId);
    await query(`UPDATE users SET ${setClauses.join(', ')} WHERE id = $${idx}`, values);
  }

  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  res.json(userPublic(rows[0]));
});

// ─── Logout — revokes the JWT by adding its jti to the blacklist ──────────────

authRouter.post('/logout', async (req, res) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token && process.env.JWT_SECRET && await isAvailable()) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        if (payload.jti) {
          const expiresAt = payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await query(
            'INSERT INTO token_blacklist (jti, expires_at) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING',
            [payload.jti, expiresAt]
          );
          // Opportunistic cleanup of expired blacklist entries
          query('DELETE FROM token_blacklist WHERE expires_at < now()').catch(() => {});
        }
      } catch { /* invalid/expired token — nothing to revoke */ }
    }
  } catch { /* non-fatal */ }
  res.json({ ok: true });
});

// ─── X (Twitter) OAuth2 — PKCE ────────────────────────────────────────────────

authRouter.get('/x', (req, res) => {
  if (!process.env.X_CLIENT_ID) return res.status(501).json({ error: 'X OAuth not configured — set X_CLIENT_ID and X_CLIENT_SECRET' });
  const state = base64url(randomBytes(16));
  const { verifier, challenge } = pkce();
  const returnTo = /^[a-z0-9/-]{0,64}$/.test(req.query.return_to || '') ? req.query.return_to : '';
  storeState(state, { verifier, returnTo });
  const callback = process.env.X_CALLBACK_URL || `${frontendUrl()}/api/auth/x/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.X_CLIENT_ID,
    redirect_uri: callback,
    scope: 'tweet.read users.read offline.access',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  res.redirect(`https://twitter.com/i/oauth2/authorize?${params}`);
});

authRouter.get('/x/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`${frontendUrl()}/#error=${encodeURIComponent(error)}`);

  const stored = consumeState(state);
  if (!stored) return res.redirect(`${frontendUrl()}/#error=invalid_state`);

  try {
    const callback = process.env.X_CALLBACK_URL || `${frontendUrl()}/api/auth/x/callback`;
    const basicAuth = Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64');

    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callback, client_id: process.env.X_CLIENT_ID, code_verifier: stored.verifier }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error(tokenData.error_description || 'Token exchange failed');

    const userRes = await fetch('https://api.twitter.com/2/users/me?user.fields=id,name,username,profile_image_url', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const { data: xUser } = await userRes.json();

    const user = await upsertUser({ email: `${xUser.username}@x.tuify`, displayName: xUser.name, avatarUrl: xUser.profile_image_url, xId: xUser.id, xHandle: xUser.username });
    if (!user) return res.redirect(`${frontendUrl()}/#error=${encodeURIComponent('This email is already registered with a password — sign in with email instead')}`);
    await seedDemosForUser(user.id);
    const dest = stored.returnTo ? `${frontendUrl()}/${stored.returnTo}` : frontendUrl();
    res.redirect(`${dest}#token=${userToken(user)}`);
  } catch (err) {
    console.error('[auth] X callback error:', err.message);
    res.redirect(`${frontendUrl()}/#error=${encodeURIComponent(err.message)}`);
  }
});

// ─── Google OAuth2 — PKCE ─────────────────────────────────────────────────────

authRouter.get('/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(501).json({ error: 'Google OAuth not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET' });
  const state = base64url(randomBytes(16));
  const { verifier, challenge } = pkce();
  const returnTo = /^[a-z0-9/-]{0,64}$/.test(req.query.return_to || '') ? req.query.return_to : '';
  storeState(state, { verifier, returnTo });
  const callback = process.env.GOOGLE_CALLBACK_URL || `${frontendUrl()}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: callback,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

authRouter.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`${frontendUrl()}/#error=${encodeURIComponent(error)}`);

  const stored = consumeState(state);
  if (!stored) return res.redirect(`${frontendUrl()}/#error=invalid_state`);

  try {
    const callback = process.env.GOOGLE_CALLBACK_URL || `${frontendUrl()}/api/auth/google/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: callback, grant_type: 'authorization_code', code_verifier: stored.verifier }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error(tokenData.error_description || 'Token exchange failed');

    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const gUser = await infoRes.json();

    const user = await upsertUser({ email: gUser.email, displayName: gUser.name, avatarUrl: gUser.picture, googleId: gUser.sub });
    if (!user) return res.redirect(`${frontendUrl()}/#error=${encodeURIComponent('This email is already registered with a password — sign in with email instead')}`);
    await seedDemosForUser(user.id);
    const dest = stored.returnTo ? `${frontendUrl()}/${stored.returnTo}` : frontendUrl();
    res.redirect(`${dest}#token=${userToken(user)}`);
  } catch (err) {
    console.error('[auth] Google callback error:', err.message);
    res.redirect(`${frontendUrl()}/#error=${encodeURIComponent(err.message)}`);
  }
});
