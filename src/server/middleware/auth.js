import jwt from 'jsonwebtoken';
import { query, isAvailable } from '../db/index.js';

export async function requireAuth(req, res, next) {
  try {
    if (!process.env.JWT_SECRET) return res.status(500).json({ error: 'Server misconfigured' });

    // Accept X-Tuify-Key (agent clients) or Authorization: Bearer (standard)
    const tuifyKey = req.headers['x-tuify-key'];
    const bearer   = req.headers.authorization || '';
    let rawToken = null;
    if (tuifyKey) {
      rawToken = tuifyKey.startsWith('tk_live_') ? tuifyKey.slice(8) : tuifyKey;
    } else if (bearer.startsWith('Bearer ')) {
      const stripped = bearer.slice(7);
      rawToken = stripped.startsWith('tk_live_') ? stripped.slice(8) : stripped;
    }
    const token = rawToken;
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Check revocation list when DB is available
    if (payload.jti && await isAvailable()) {
      const { rows } = await query('SELECT 1 FROM token_blacklist WHERE jti = $1', [payload.jti]);
      if (rows.length) return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = payload;
    next();
  } catch (err) {
    next(err);
  }
}
