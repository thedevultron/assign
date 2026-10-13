import crypto from 'node:crypto';
import { db, now, uid } from './db.js';

const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/* ---------------- passwords (scrypt) ---------------- */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, saltB64, keyB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const key = Buffer.from(keyB64, 'base64');
    const test = crypto.scryptSync(String(pw), Buffer.from(saltB64, 'base64'), key.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(key, test);
  } catch { return false; }
}

/* ---------------- sessions (opaque bearer tokens, stored hashed) ---------------- */
export function createSession(userId, userAgent = '') {
  const token = 'sess_' + crypto.randomBytes(32).toString('base64url');
  const ts = now();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at, user_agent) VALUES (?,?,?,?,?,?)').run(sha(token), userId, ts, expires, ts, String(userAgent).slice(0, 200));
  return { token, expires_at: expires };
}
export function destroySession(token) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token)); }
export function destroyUserSessions(userId, exceptToken) {
  if (exceptToken) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha(exceptToken));
  else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function userFromToken(token) {
  if (!token || typeof token !== 'string' || !token.startsWith('sess_')) return null;
  const row = db.prepare('SELECT s.token_hash, s.expires_at, s.last_used_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(sha(token));
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash); return null; }
  // sliding expiry, touched at most once an hour
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 36e5) {
    db.prepare('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?').run(now(), new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), row.token_hash);
  }
  const { token_hash, expires_at, last_used_at, password_hash, ...user } = row;
  return user;
}

export function tokenFromReq(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  if (typeof req.query?.session === 'string') return req.query.session; // EventSource can't set headers
  return null;
}

/** Express middleware: requires a signed-in user with a workspace. Sets req.user, req.ws, req.token. */
export function requireAuth(req, res, next) {
  const token = tokenFromReq(req);
  const user = userFromToken(token);
  if (!user) return res.status(401).json({ error: 'Not signed in', code: 'unauthenticated' });
  req.user = user; req.ws = user.workspace_id; req.token = token;
  next();
}

export const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, created_at: u.created_at });

/* ---------------- tiny in-memory rate limiter ---------------- */
const buckets = new Map();
export function rateLimit(key, { max = 10, windowMs = 10 * 60e3 } = {}) {
  const t = Date.now();
  const b = buckets.get(key) || { n: 0, reset: t + windowMs };
  if (t > b.reset) { b.n = 0; b.reset = t + windowMs; }
  b.n++; buckets.set(key, b);
  return b.n <= max;
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (t > b.reset) buckets.delete(k); }, 60e3).unref();
setInterval(() => { try { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()); } catch {} }, 6 * 36e5).unref();

export { uid, sha };
