import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// v2 uses a fresh, multi-tenant database file. (v1's demo database `assign.db` is left untouched.)
export const db = new Database(path.join(DATA_DIR, process.env.DB_FILE || 'assign.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  workspace_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  user_agent TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  onboarding TEXT NOT NULL DEFAULT '{}',
  onboarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  repo TEXT DEFAULT '',
  emoji TEXT DEFAULT '',
  position REAL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_boards_ws ON boards(workspace_id);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  color TEXT NOT NULL,
  avatar TEXT DEFAULT '',
  role TEXT DEFAULT '',
  personality TEXT DEFAULT '',
  system_prompt TEXT DEFAULT '',
  provider TEXT DEFAULT 'claude-code',
  skills TEXT DEFAULT '[]',
  webhook_url TEXT DEFAULT '',
  max_concurrent INTEGER DEFAULT 3,
  token TEXT NOT NULL UNIQUE,
  paused INTEGER DEFAULT 0,
  client_name TEXT DEFAULT '',
  client_version TEXT DEFAULT '',
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, handle)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  acceptance TEXT DEFAULT '',
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'backlog',
  assignee_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  auto_route INTEGER DEFAULT 0,
  start_mode TEXT DEFAULT 'policy',
  scheduled_at TEXT,
  deadline TEXT,
  tags TEXT DEFAULT '[]',
  repo TEXT DEFAULT '',
  branch TEXT DEFAULT '',
  position REAL DEFAULT 0,
  progress INTEGER DEFAULT 0,
  dispatched_at TEXT,
  claimed_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, number)
);
CREATE INDEX IF NOT EXISTS idx_tasks_ws ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(board_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id TEXT,
  agent_id TEXT,
  actor TEXT DEFAULT 'you',
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_ws ON activity(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity(task_id);
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  task_id TEXT,
  webhook_status TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_agent ON inbox(agent_id, created_at);
CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  time TEXT DEFAULT '09:00',
  days TEXT DEFAULT '[1,2,3,4,5]',
  agent_ids TEXT DEFAULT '[]',
  priorities TEXT DEFAULT '["critical","high","medium","low"]',
  params TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  last_run_at TEXT,
  run_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automations_ws ON automations(workspace_id);

CREATE TABLE IF NOT EXISTS agent_files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(agent_id, name)
);
CREATE INDEX IF NOT EXISTS idx_agent_files_ws ON agent_files(workspace_id);

CREATE TABLE IF NOT EXISTS runners (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  label TEXT DEFAULT '',
  platform TEXT DEFAULT '',
  cwd TEXT DEFAULT '',
  allow TEXT DEFAULT 'claude,codex,node,npx,git,python3',
  max_concurrent INTEGER DEFAULT 2,
  last_seen_at TEXT,
  online INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runners_ws ON runners(workspace_id);

CREATE TABLE IF NOT EXISTS runner_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  runner_id TEXT NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  task_id TEXT,
  agent_id TEXT,
  kind TEXT NOT NULL DEFAULT 'task',
  cmd TEXT NOT NULL,
  args TEXT DEFAULT '[]',
  cwd TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  exit_code INTEGER,
  output TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runner_sessions_ws ON runner_sessions(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id TEXT,
  task_id TEXT,
  model TEXT DEFAULT '',
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_ws ON usage_events(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'fact',
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'user',
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_ws ON memories(workspace_id, updated_at);
`);

// ── migrations (additive, idempotent) ──
{
  const cols = new Set(db.prepare("PRAGMA table_info(agents)").all().map((c) => c.name));
  const add = (name, def) => { if (!cols.has(name)) db.exec(`ALTER TABLE agents ADD COLUMN ${name} ${def}`); };
  const hadPairing = cols.has('paired_at');
  add('paired_at', 'TEXT');
  add('pair_code', 'TEXT');
  add('provider_label', "TEXT DEFAULT ''");
  add('pair_expires_at', 'TEXT');
  add('pair_client', "TEXT DEFAULT ''");
  add('pair_attempts', 'INTEGER DEFAULT 0');
  // Agents that existed before pairing shipped keep working.
  if (!hadPairing) db.exec('UPDATE agents SET paired_at = created_at WHERE paired_at IS NULL');
}

/* ---------------- memory store (local-first, Firebase-ready) ----------------
 * Local today: SQLite table `memories` + mirrored MEMORY.md / memory.json files
 * under DATA_DIR (per workspace). Later: swap `MemoryProvider` for a Firebase
 * implementation — the REST + assistant-tool surface stays identical.
 * The assistant auto-learns (source 'assistant'), you can add/edit/delete.
 * Export includes memories; MEMORY.md is human-readable, memory.json is exact. */

function memDir(ws) {
  const dir = path.join(DATA_DIR, 'memory', ws);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const MEMORY_KINDS = ['fact', 'preference', 'project', 'person', 'note'];

export function listMemories(ws, { kind } = {}) {
  const rows = kind
    ? db.prepare('SELECT * FROM memories WHERE workspace_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT 200').all(ws, kind)
    : db.prepare('SELECT * FROM memories WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200').all(ws);
  return rows;
}

export function getMemory(ws, id) {
  return db.prepare('SELECT * FROM memories WHERE workspace_id = ? AND id = ?').get(ws, id);
}

function touchFiles(ws) {
  try {
    const rows = listMemories(ws);
    const dir = memDir(ws);
    const md = ['# MEMORY.md — what assign remembers about you', '', `Updated: ${now()}`, '', ...rows.map((m) => `## [${m.kind}] ${m.title}\n${m.content}\n_(id: ${m.id} · source: ${m.source} · updated: ${m.updated_at})_`), ''].join('\n');
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), md);
    fs.writeFileSync(path.join(dir, 'memory.json'), JSON.stringify({ version: 1, workspace: ws, exported_at: now(), memories: rows }, null, 2));
  } catch (e) { console.warn('[memory] mirror failed', e.message); }
}

export function saveMemory(ws, { id, kind = 'fact', title, content = '', source = 'user' }) {
  if (!MEMORY_KINDS.includes(kind)) throw new Error(`kind must be one of ${MEMORY_KINDS.join(', ')}`);
  const t = String(title || '').trim().slice(0, 120);
  if (!t) throw new Error('Memory needs a title');
  const body = String(content || '').slice(0, 4000);
  const ts = now();
  if (id) {
    const cur = getMemory(ws, id);
    if (!cur) throw new Error('Memory not found');
    db.prepare('UPDATE memories SET kind = ?, title = ?, content = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').run(kind, t, body, ts, id, ws);
    touchFiles(ws);
    return getMemory(ws, id);
  }
  const row = { id: uid('m_'), workspace_id: ws, kind, title: t, content: body, source, updated_at: ts, created_at: ts };
  db.prepare('INSERT INTO memories (id, workspace_id, kind, title, content, source, updated_at, created_at) VALUES (@id,@workspace_id,@kind,@title,@content,@source,@updated_at,@created_at)').run(row);
  touchFiles(ws);
  return row;
}

export function deleteMemory(ws, id) {
  db.prepare('DELETE FROM memories WHERE workspace_id = ? AND id = ?').run(ws, id);
  touchFiles(ws);
  return { ok: true };
}

export function memoryBlock(ws, limit = 40) {
  const rows = db.prepare('SELECT kind, title, content FROM memories WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?').all(ws, limit);
  if (!rows.length) return '';
  return ['Things to remember about the user (long-term memory — respect these):', ...rows.map((m) => `- [${m.kind}] ${m.title}${m.content ? `: ${m.content}` : ''}`)].join('\n');
}

export function exportMemoryFiles(ws) {
  touchFiles(ws);
  const dir = memDir(ws);
  return [
    { name: 'MEMORY.md', data: fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8') },
    { name: 'memory.json', data: fs.readFileSync(path.join(dir, 'memory.json'), 'utf8') },
  ];
}

export const now = () => new Date().toISOString();
export const uid = (p = '') => p + crypto.randomBytes(6).toString('hex');
export const newToken = () => 'asg_' + crypto.randomBytes(20).toString('hex');

export const J = (v, d) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };

export const hydrate = {
  agent(a) {
    if (!a) return null;
    return { ...a, skills: J(a.skills, []), paused: !!a.paused };
  },
  task(t) {
    if (!t) return null;
    return { ...t, tags: J(t.tags, []), auto_route: !!t.auto_route };
  },
  automation(a) {
    if (!a) return null;
    return { ...a, days: J(a.days, []), agent_ids: J(a.agent_ids, []), priorities: J(a.priorities, []), params: J(a.params, {}), enabled: !!a.enabled };
  },
};

export const POLICY_PRESETS = {
  fast: {
    critical: { mode: 'instant', interval: 15, time: '09:00' },
    high: { mode: 'instant', interval: 15, time: '09:00' },
    medium: { mode: 'instant', interval: 30, time: '09:00' },
    low: { mode: 'batched', interval: 60, time: '09:00' },
  },
  balanced: {
    critical: { mode: 'instant', interval: 15, time: '09:00' },
    high: { mode: 'batched', interval: 30, time: '09:00' },
    medium: { mode: 'daily', interval: 60, time: '09:30' },
    low: { mode: 'manual', interval: 240, time: '17:00' },
  },
  hands_on: {
    critical: { mode: 'manual', interval: 15, time: '09:00' },
    high: { mode: 'manual', interval: 30, time: '09:00' },
    medium: { mode: 'manual', interval: 60, time: '09:30' },
    low: { mode: 'manual', interval: 240, time: '17:00' },
  },
};

export const DEFAULT_SETTINGS = {
  timezone: 'UTC',
  description: '',
  tools: [],
  routing: 'smart', // smart | least_loaded | round_robin
  preset: 'balanced',
  policy: POLICY_PRESETS.balanced,
  key_prefix: 'ASG',
  require_pairing: true,
  runtime: {},
};

export function getWorkspace(id) {
  const w = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
  if (!w) return null;
  return { ...w, onboarded: !!w.onboarded, settings: undefined, onboarding: J(w.onboarding, {}) };
}

export function getSettings(ws) {
  const row = db.prepare('SELECT settings FROM workspaces WHERE id = ?').get(ws);
  const s = J(row?.settings, {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    policy: { ...DEFAULT_SETTINGS.policy, ...(s.policy || {}) },
    runtime: s.runtime || {},
  };
}

export function saveSettings(ws, next) {
  db.prepare('UPDATE workspaces SET settings = ? WHERE id = ?').run(JSON.stringify(next), ws);
  return next;
}

export function nextTaskNumber(ws) {
  const r = db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM tasks WHERE workspace_id = ?').get(ws);
  return r.n + 1;
}

export function slugify(s, max = 40) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
}
