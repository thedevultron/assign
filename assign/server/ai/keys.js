// Encrypted, per-workspace storage for AI provider API keys.
// Keys are sealed with AES-256-GCM. The master secret comes from AI_SECRET, or is
// generated once into DATA_DIR/.ai-secret (0600). Plain keys never leave the server.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, now } from '../db.js';

db.exec(`CREATE TABLE IF NOT EXISTS ai_keys (
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  sealed TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, provider)
)`);

let master = null;
function secret() {
  if (master) return master;
  if (process.env.AI_SECRET) {
    master = crypto.createHash('sha256').update(process.env.AI_SECRET).digest();
    return master;
  }
  const dir = path.resolve(process.env.DATA_DIR || './data');
  const file = path.join(dir, '.ai-secret');
  try {
    master = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (master.length !== 32) throw new Error('bad secret');
  } catch {
    master = crypto.randomBytes(32);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, master.toString('base64'), { mode: 0o600 });
  }
  return master;
}

function seal(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secret(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}
function unseal(s) {
  const [v, iv, tag, enc] = String(s).split('.');
  if (v !== 'v1') throw new Error('Unknown key format');
  const d = crypto.createDecipheriv('aes-256-gcm', secret(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

const hintOf = (k) => (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '••••');

// Optional built-in key so chat + voice work without each user adding their own.
// Set DEFAULT_GOOGLE_API_KEY in the environment (server-side only — never sent to
// the browser). Any key saved in Settings → AI overrides it for that workspace.
export function defaultKey(provider) {
  if (provider === 'google' && process.env.DEFAULT_GOOGLE_API_KEY?.trim()) return process.env.DEFAULT_GOOGLE_API_KEY.trim();
  return null;
}
export function hasDbKey(ws, provider) {
  return !!db.prepare('SELECT 1 FROM ai_keys WHERE workspace_id = ? AND provider = ?').get(ws, provider);
}
export function isDefaultKey(ws, provider) {
  return !hasDbKey(ws, provider) && !!defaultKey(provider);
}

export function setKey(ws, provider, key) {
  const ts = now();
  db.prepare(`INSERT INTO ai_keys (workspace_id, provider, sealed, hint, created_at, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(workspace_id, provider) DO UPDATE SET sealed = excluded.sealed, hint = excluded.hint, updated_at = excluded.updated_at`)
    .run(ws, provider, seal(key), hintOf(key), ts, ts);
}
export function getKey(ws, provider) {
  const row = db.prepare('SELECT sealed FROM ai_keys WHERE workspace_id = ? AND provider = ?').get(ws, provider);
  if (!row) return defaultKey(provider);
  try { return unseal(row.sealed); } catch { return defaultKey(provider); }
}
export function deleteKey(ws, provider) {
  db.prepare('DELETE FROM ai_keys WHERE workspace_id = ? AND provider = ?').run(ws, provider);
}
export function listKeys(ws) {
  return db.prepare('SELECT provider, hint, updated_at FROM ai_keys WHERE workspace_id = ?').all(ws);
}
export function deleteWorkspaceKeys(ws) {
  db.prepare('DELETE FROM ai_keys WHERE workspace_id = ?').run(ws);
}
