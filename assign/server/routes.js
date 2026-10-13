import crypto from 'node:crypto';
import express from 'express';
import { db, now, uid, newToken, hydrate, getSettings, saveSettings, nextTaskNumber, getWorkspace, POLICY_PRESETS, slugify } from './db.js';
import { emit, emitTask, getTask, getAgent, listAgents, logActivity, routeTask, dispatchTask, applyStartPolicy, addClient, deliver, taskBrief, keyOf, publicAgent, STATUSES, PRIORITIES, STATUS_LABEL, PROVIDERS, agentLoad } from './core.js';
import { runAutomation } from './scheduler.js';
import { hashPassword, verifyPassword, createSession, destroySession, destroyUserSessions, requireAuth, publicUser, rateLimit, tokenFromReq, userFromToken } from './auth.js';
import { clientConfigs, personalSkill, zip, baseUrlFrom, serverKey, CLIENTS, detectProvider } from './skill.js';
import { persona } from './mcp.js';
import { runnerRoutes, listRunners, listSessions } from './runners.js';

const r = express.Router();
const wrap = (fn) => (req, res) => { try { const out = fn(req, res); if (out !== undefined && !res.headersSent) res.json(out); } catch (e) { if (!e.status || e.status >= 500) console.error(e); res.status(e.status || 500).json({ error: e.message || 'Server error' }); } };
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const str = (v, max = 5000) => (v == null ? '' : String(v)).slice(0, max);
const iso = (v) => { if (!v) return null; const d = new Date(v); if (isNaN(d)) throw bad('Invalid date'); return d.toISOString(); };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const AGENT_COLORS = ['#847dff', '#00b3dd', '#dd90d8', '#90b8f0', '#d1c9ff', '#4b49aa'];
const SIGNUPS = process.env.ALLOW_SIGNUPS !== 'false';

r.get('/health', (req, res) => res.json({ ok: true, time: now(), version: '2.0.0' }));

/* ================= auth ================= */
function validTz(tz) { if (typeof tz !== 'string' || !tz || tz.length > 60) return false; try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }

r.post('/auth/signup', wrap((req) => {
  if (!SIGNUPS) throw bad('Sign-ups are closed on this server', 403);
  if (!rateLimit(`signup:${req.ip}`, { max: 20, windowMs: 60 * 60e3 })) throw bad('Too many sign-ups from this address. Try again later.', 429);
  const name = str(req.body.name, 60).trim();
  const email = str(req.body.email, 200).trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name) throw bad('What should we call you?');
  if (!EMAIL.test(email)) throw bad('Enter a valid email address');
  if (password.length < 8) throw bad('Use at least 8 characters for your password');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('An account with this email already exists — sign in instead', 409);
  const ts = now();
  const userId = uid('u_');
  const wsId = uid('w_');
  const tz = validTz(req.body.timezone) ? req.body.timezone : 'UTC';
  db.transaction(() => {
    db.prepare('INSERT INTO users (id, email, name, password_hash, workspace_id, created_at) VALUES (?,?,?,?,?,?)').run(userId, email, name, hashPassword(password), wsId, ts);
    db.prepare('INSERT INTO workspaces (id, name, owner_id, settings, onboarding, onboarded, created_at) VALUES (?,?,?,?,?,0,?)')
      .run(wsId, `${name.split(' ')[0]}'s workspace`, userId, JSON.stringify({ timezone: tz }), JSON.stringify({ step: 1, data: req.body.pending_task ? { pending_task: str(req.body.pending_task, 500) } : {} }), ts);
  })();
  const s = createSession(userId, req.headers['user-agent']);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return { token: s.token, user: publicUser(user), workspace: getWorkspace(wsId) };
}));

r.post('/auth/login', wrap((req) => {
  const email = str(req.body.email, 200).trim().toLowerCase();
  if (!rateLimit(`login:${req.ip}:${email}`, { max: 10, windowMs: 10 * 60e3 })) throw bad('Too many attempts. Wait a few minutes and try again.', 429);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(req.body.password || '', user.password_hash)) throw bad('Email or password is incorrect', 401);
  const s = createSession(user.id, req.headers['user-agent']);
  return { token: s.token, user: publicUser(user), workspace: getWorkspace(user.workspace_id) };
}));

r.post('/auth/logout', wrap((req) => { destroySession(tokenFromReq(req)); return { ok: true }; }));

r.get('/auth/me', wrap((req) => {
  const user = userFromToken(tokenFromReq(req));
  if (!user) throw bad('Not signed in', 401);
  return { user: publicUser(user), workspace: getWorkspace(user.workspace_id), settings: getSettings(user.workspace_id) };
}));

/* ---- realtime: EventSource can't send headers, so the session token rides in ?session= ---- */
r.get('/events', (req, res) => {
  const user = userFromToken(tokenFromReq(req));
  if (!user) return res.status(401).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');
  const off = addClient(user.workspace_id, res);
  req.on('close', off);
});

/* ================= everything below requires a session ================= */
r.use(requireAuth);
runnerRoutes(r, { wrap, bad, str });

/* ---------------- onboarding ---------------- */
r.patch('/onboarding', wrap((req) => {
  const w = getWorkspace(req.ws);
  const next = { step: Math.max(1, Math.min(8, parseInt(req.body.step) || w.onboarding.step || 1)), data: { ...(w.onboarding.data || {}), ...(req.body.data || {}) } };
  const raw = JSON.stringify(next);
  if (raw.length > 200000) throw bad('Too much data');
  db.prepare('UPDATE workspaces SET onboarding = ? WHERE id = ?').run(raw, req.ws);
  return { onboarding: next };
}));

function uniqueHandle(ws, base, exceptId = null) {
  const root = slugify(base, 24).replace(/-/g, '') || 'agent';
  let h = root; let i = 2;
  while (db.prepare('SELECT 1 FROM agents WHERE workspace_id = ? AND handle = ? AND id != ?').get(ws, h, exceptId || '')) h = `${root}${i++}`;
  return h;
}

function insertAgent(ws, f, actor = 'you') {
  const used = db.prepare('SELECT color FROM agents WHERE workspace_id = ?').all(ws).map((x) => x.color);
  const color = f.color || AGENT_COLORS.find((c) => !used.includes(c)) || AGENT_COLORS[used.length % AGENT_COLORS.length];
  const a = { id: uid('a_'), workspace_id: ws, avatar: '', role: '', personality: '', system_prompt: '', webhook_url: '', skills: '[]', max_concurrent: 3, paused: 0, provider: 'claude-code', paired_at: getSettings(ws).require_pairing === false ? now() : null, ...f, color, handle: uniqueHandle(ws, f.handle || f.name), token: newToken(), created_at: now() };
  const cols = Object.keys(a);
  db.prepare(`INSERT INTO agents (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(a);
  logActivity(ws, { agent_id: a.id, actor, kind: 'agent', message: `Added agent ${a.name} (${CLIENTS[a.provider]?.label || a.provider})` });
  const out = publicAgent(getAgent(ws, a.id));
  emit(ws, 'agent', out);
  return out;
}

r.post('/onboarding/complete', wrap((req) => {
  const ws = req.ws;
  const b = req.body || {};
  const w = getWorkspace(ws);
  if (w.onboarded) throw bad('This workspace is already set up');
  const wsName = str(b.workspace?.name, 60).trim() || w.name;
  const tz = validTz(b.workspace?.timezone) ? b.workspace?.timezone : getSettings(ws).timezone;
  const tools = (Array.isArray(b.tools) ? b.tools : []).filter((t) => PROVIDERS.includes(t));
  const preset = POLICY_PRESETS[b.preset] ? b.preset : 'balanced';
  const agents = (Array.isArray(b.agents) ? b.agents : []).slice(0, 12);
  const boardName = str(b.board?.name, 80).trim() || 'Main';
  const repo = str(b.board?.repo, 300).trim();
  let created = { agents: [], task: null };
  db.transaction(() => {
    db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(wsName, ws);
    saveSettings(ws, { ...getSettings(ws), timezone: tz, description: str(b.workspace?.description, 1000), tools, preset, policy: POLICY_PRESETS[preset] });
    const boardId = uid('b_');
    db.prepare('INSERT INTO boards (id, workspace_id, name, description, repo, emoji, position, created_at) VALUES (?,?,?,?,?,?,?,?)').run(boardId, ws, boardName, '', repo, '', 1, now());
    for (const a of agents) {
      const name = str(a.name, 40).trim(); if (!name) continue;
      created.agents.push(insertAgent(ws, {
        name, handle: a.handle, provider: PROVIDERS.includes(a.provider) ? a.provider : 'other',
        role: str(a.role, 200), personality: str(a.personality, 1000), skills: JSON.stringify((a.skills || []).map((s) => str(s, 30)).filter(Boolean).slice(0, 20)),
        color: /^#[0-9a-f]{6}$/i.test(a.color || '') ? a.color : undefined,
      }));
    }
    if (b.digest?.enabled) {
      const time = /^\d{2}:\d{2}$/.test(b.digest.time) ? b.digest.time : '09:00';
      db.prepare('INSERT INTO automations (id, workspace_id, name, kind, time, days, agent_ids, priorities, params, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)')
        .run(uid('au_'), ws, 'Morning digest', 'daily_digest', time, '[1,2,3,4,5]', '[]', JSON.stringify(PRIORITIES), '{}', now());
      db.prepare('INSERT INTO automations (id, workspace_id, name, kind, time, days, agent_ids, priorities, params, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)')
        .run(uid('au_'), ws, 'Deadline reminders', 'deadline_reminder', '10:00', '[1,2,3,4,5]', '[]', JSON.stringify(PRIORITIES), '{"hours":24}', now());
    }
    db.prepare("UPDATE workspaces SET onboarded = 1, onboarding = ? WHERE id = ?").run(JSON.stringify({ step: 8, data: {}, completed_at: now() }), ws);
    logActivity(ws, { kind: 'board', message: `Workspace “${wsName}” is ready` });
    const title = str(b.task?.title, 200).trim();
    if (title) {
      const ts = now();
      const t = { id: uid('t_'), workspace_id: ws, number: nextTaskNumber(ws), board_id: boardId, title, description: str(b.task.description, 10000), acceptance: '', priority: PRIORITIES.includes(b.task.priority) ? b.task.priority : 'medium', status: 'backlog', assignee_id: null, auto_route: created.agents.length ? 1 : 0, start_mode: 'policy', tags: '[]', repo, position: 0, created_at: ts, updated_at: ts };
      const cols = Object.keys(t);
      db.prepare(`INSERT INTO tasks (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(t);
      logActivity(ws, { task_id: t.id, kind: 'create', message: `Created ${keyOf(ws, t)} ${t.title}` });
      created.task = t.id;
    }
  })();
  if (created.task) applyStartPolicy(ws, created.task);
  return { workspace: getWorkspace(ws), settings: getSettings(ws), created };
}));

/* ---------------- bootstrap ---------------- */
r.get('/bootstrap', wrap((req) => {
  const ws = req.ws;
  return {
    user: publicUser(req.user),
    workspace: getWorkspace(ws),
    settings: getSettings(ws),
    boards: db.prepare('SELECT * FROM boards WHERE workspace_id = ? ORDER BY position, created_at').all(ws),
    agents: listAgents(ws).map(publicAgent),
    tasks: db.prepare('SELECT * FROM tasks WHERE workspace_id = ? ORDER BY position').all(ws).map(hydrate.task),
    automations: db.prepare('SELECT * FROM automations WHERE workspace_id = ? ORDER BY created_at').all(ws).map(hydrate.automation),
    activity: db.prepare('SELECT * FROM activity WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 120').all(ws),
    runners: listRunners(ws),
    runner_sessions: listSessions(ws, 30),
    serverTime: now(),
  };
}));

/* ---------------- boards ---------------- */
const getBoard = (ws, id) => db.prepare('SELECT * FROM boards WHERE id = ? AND workspace_id = ?').get(id, ws);
r.post('/boards', wrap((req) => {
  const ws = req.ws;
  const name = str(req.body.name, 80).trim(); if (!name) throw bad('Board name is required');
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM boards WHERE workspace_id = ?').get(ws).p;
  const b = { id: uid('b_'), workspace_id: ws, name, description: str(req.body.description, 400), repo: str(req.body.repo, 300).trim(), emoji: str(req.body.emoji, 8), position: pos, created_at: now() };
  db.prepare('INSERT INTO boards (id, workspace_id, name, description, repo, emoji, position, created_at) VALUES (@id,@workspace_id,@name,@description,@repo,@emoji,@position,@created_at)').run(b);
  emit(ws, 'board', b); logActivity(ws, { kind: 'board', message: `Created board “${b.name}”` });
  return b;
}));
r.patch('/boards/:id', wrap((req) => {
  const ws = req.ws;
  const b = getBoard(ws, req.params.id); if (!b) throw bad('Board not found', 404);
  const next = { ...b };
  if ('name' in req.body) next.name = str(req.body.name, 80).trim() || b.name;
  if ('description' in req.body) next.description = str(req.body.description, 400);
  if ('repo' in req.body) next.repo = str(req.body.repo, 300).trim();
  if ('emoji' in req.body) next.emoji = str(req.body.emoji, 8);
  db.prepare('UPDATE boards SET name=@name, description=@description, repo=@repo, emoji=@emoji WHERE id=@id').run(next);
  emit(ws, 'board', next); return next;
}));
r.delete('/boards/:id', wrap((req) => {
  const ws = req.ws;
  const b = getBoard(ws, req.params.id); if (!b) throw bad('Board not found', 404);
  if (db.prepare('SELECT COUNT(*) n FROM boards WHERE workspace_id = ?').get(ws).n <= 1) throw bad('You need at least one board');
  db.prepare('DELETE FROM boards WHERE id = ?').run(b.id);
  emit(ws, 'board:delete', { id: b.id }); logActivity(ws, { kind: 'board', message: `Deleted board “${b.name}”` });
  return { ok: true };
}));

/* ---------------- tasks ---------------- */
function taskFields(ws, body, existing = {}) {
  const f = {};
  if ('title' in body) { f.title = str(body.title, 200).trim(); if (!f.title) throw bad('Title is required'); }
  for (const k of ['description', 'acceptance', 'repo', 'branch']) if (k in body) f[k] = str(body[k], k === 'description' || k === 'acceptance' ? 10000 : 300);
  if ('priority' in body) { if (!PRIORITIES.includes(body.priority)) throw bad('Invalid priority'); f.priority = body.priority; }
  if ('status' in body) { if (!STATUSES.includes(body.status)) throw bad('Invalid status'); f.status = body.status; }
  if ('assignee_id' in body) { if (body.assignee_id && !getAgent(ws, body.assignee_id)) throw bad('Agent not found'); f.assignee_id = body.assignee_id || null; }
  if ('auto_route' in body) f.auto_route = body.auto_route ? 1 : 0;
  if ('start_mode' in body) { if (!['policy', 'now', 'scheduled', 'manual'].includes(body.start_mode)) throw bad('Invalid start mode'); f.start_mode = body.start_mode; }
  if ('scheduled_at' in body) f.scheduled_at = iso(body.scheduled_at);
  if ('deadline' in body) f.deadline = iso(body.deadline);
  if ('tags' in body) f.tags = JSON.stringify((Array.isArray(body.tags) ? body.tags : []).map((t) => str(t, 30).trim()).filter(Boolean).slice(0, 10));
  if ('board_id' in body) { if (!getBoard(ws, body.board_id)) throw bad('Board not found'); f.board_id = body.board_id; }
  if ('position' in body) f.position = Number(body.position) || 0;
  if ('progress' in body) f.progress = Math.max(0, Math.min(100, Math.round(+body.progress || 0)));
  if (f.start_mode === 'scheduled' && !(f.scheduled_at || existing.scheduled_at)) throw bad('Pick a time to schedule this task');
  return f;
}

r.post('/tasks', wrap((req) => {
  const ws = req.ws;
  const f = taskFields(ws, { priority: 'medium', status: 'backlog', start_mode: 'policy', ...req.body });
  if (!f.title) throw bad('Title is required');
  if (!f.board_id) { const b = db.prepare('SELECT id FROM boards WHERE workspace_id = ? ORDER BY position LIMIT 1').get(ws); if (!b) throw bad('Create a board first'); f.board_id = b.id; }
  if (!('repo' in f) || !f.repo) f.repo = getBoard(ws, f.board_id)?.repo || '';
  const ts = now();
  const minPos = db.prepare('SELECT COALESCE(MIN(position), 1000) AS p FROM tasks WHERE board_id = ? AND status = ?').get(f.board_id, f.status).p;
  const id = req.body.id && /^t_[a-z0-9]{6,20}$/.test(req.body.id) && !db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(req.body.id) ? req.body.id : uid('t_');
  const t = { id, workspace_id: ws, number: nextTaskNumber(ws), description: '', acceptance: '', branch: '', assignee_id: null, auto_route: 0, scheduled_at: null, deadline: null, tags: '[]', progress: 0, position: minPos - 1, ...f, created_at: ts, updated_at: ts };
  if (t.status === 'done') t.completed_at = ts;
  const cols = Object.keys(t);
  db.prepare(`INSERT INTO tasks (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(t);
  logActivity(ws, { task_id: t.id, kind: 'create', message: `Created ${keyOf(ws, t)} ${t.title}` });
  emitTask(ws, t.id);
  return applyStartPolicy(ws, t.id) || getTask(ws, t.id);
}));

r.patch('/tasks/:id', wrap((req) => {
  const ws = req.ws;
  const t = getTask(ws, req.params.id); if (!t) throw bad('Task not found', 404);
  const f = taskFields(ws, req.body, t);
  if (!Object.keys(f).length) return t;
  const ts = now();
  f.updated_at = ts;
  const K = keyOf(ws, t);
  if (f.status && f.status !== t.status) {
    if (f.status === 'done') { f.completed_at = ts; f.progress = 100; }
    else if (t.status === 'done') f.completed_at = null;
    if (f.status === 'in_progress' && !t.started_at) f.started_at = ts;
    if (f.status === 'backlog') { f.dispatched_at = null; f.claimed_at = null; }
    if (f.status === 'queued' && !t.dispatched_at) {
      const rest = Object.keys(f).filter((k) => k !== 'status');
      db.prepare(`UPDATE tasks SET ${rest.map((k) => `${k}=@${k}`).join(',')} WHERE id=@id`).run({ ...Object.fromEntries(rest.map((k) => [k, f[k]])), id: t.id });
      logActivity(ws, { task_id: t.id, kind: 'status', message: `Moved ${K} to Queued` });
      return dispatchTask(ws, t.id, { actor: 'you', reason: 'Moved to Queued' });
    }
    logActivity(ws, { task_id: t.id, kind: 'status', message: `Moved ${K} to ${STATUS_LABEL[f.status]}` });
  }
  if ('assignee_id' in f && f.assignee_id !== t.assignee_id) {
    const a = f.assignee_id ? getAgent(ws, f.assignee_id) : null;
    f.claimed_at = null;
    if (a && !('branch' in req.body)) f.branch = `${a.handle}/asg-${t.number}-${slugify(t.title, 32) || 'task'}`;
    logActivity(ws, { task_id: t.id, agent_id: a?.id, kind: 'assign', message: a ? `Assigned ${K} to ${a.name}` : `Unassigned ${K}` });
    if (a && t.dispatched_at && ['queued', 'in_progress'].includes(t.status)) {
      setImmediate(() => { const nt = getTask(ws, t.id); if (nt) deliver(ws, a, { kind: 'task', title: `Reassigned to you: ${K} ${nt.title}`, body: taskBrief(ws, nt), task_id: nt.id }); });
    }
  }
  if ('deadline' in f && f.deadline !== t.deadline) logActivity(ws, { task_id: t.id, kind: 'edit', message: f.deadline ? `Deadline set for ${K}` : `Deadline cleared on ${K}` });
  if ('priority' in f && f.priority !== t.priority) logActivity(ws, { task_id: t.id, kind: 'edit', message: `Priority of ${K} → ${f.priority}` });
  const sets = Object.keys(f).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE tasks SET ${sets} WHERE id = @id`).run({ ...f, id: t.id });
  emitTask(ws, t.id);
  return applyStartPolicy(ws, t.id) || getTask(ws, t.id);
}));

r.delete('/tasks/:id', wrap((req) => {
  const ws = req.ws;
  const t = getTask(ws, req.params.id); if (!t) throw bad('Task not found', 404);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  logActivity(ws, { kind: 'delete', message: `Deleted ${keyOf(ws, t)} ${t.title}` });
  emit(ws, 'task:delete', { id: t.id });
  return { ok: true, task: t };
}));

r.post('/tasks/:id/restore', wrap((req) => {
  const ws = req.ws;
  const t = req.body.task; if (!t || !t.id) throw bad('Nothing to restore');
  const existing = getTask(ws, t.id); if (existing) return existing;
  if (db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(t.id)) throw bad('Cannot restore this task');
  const row = { ...t, workspace_id: ws, tags: JSON.stringify(t.tags || []), auto_route: t.auto_route ? 1 : 0 };
  if (!getBoard(ws, row.board_id)) throw bad('Board no longer exists');
  if (row.assignee_id && !getAgent(ws, row.assignee_id)) row.assignee_id = null;
  if (db.prepare('SELECT 1 FROM tasks WHERE workspace_id = ? AND number = ?').get(ws, row.number)) row.number = nextTaskNumber(ws);
  const cols = ['id', 'workspace_id', 'number', 'board_id', 'title', 'description', 'acceptance', 'priority', 'status', 'assignee_id', 'auto_route', 'start_mode', 'scheduled_at', 'deadline', 'tags', 'repo', 'branch', 'position', 'progress', 'dispatched_at', 'claimed_at', 'started_at', 'completed_at', 'created_at', 'updated_at'];
  db.prepare(`INSERT INTO tasks (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(Object.fromEntries(cols.map((c) => [c, row[c] ?? null])));
  logActivity(ws, { task_id: t.id, kind: 'create', message: `Restored ${keyOf(ws, row)}` });
  return emitTask(ws, t.id);
}));

r.post('/tasks/:id/start', wrap((req) => {
  const ws = req.ws;
  const t = getTask(ws, req.params.id); if (!t) throw bad('Task not found', 404);
  if (!t.assignee_id && !t.auto_route) db.prepare('UPDATE tasks SET auto_route = 1 WHERE id = ?').run(t.id);
  db.prepare("UPDATE tasks SET start_mode = 'now', dispatched_at = NULL WHERE id = ? AND status = 'backlog'").run(t.id);
  return dispatchTask(ws, t.id, { actor: 'you', reason: 'Started now' });
}));

r.get('/tasks/:id/activity', wrap((req) => {
  const t = getTask(req.ws, req.params.id); if (!t) throw bad('Task not found', 404);
  return db.prepare('SELECT * FROM activity WHERE task_id = ? ORDER BY created_at DESC LIMIT 200').all(t.id);
}));
r.post('/tasks/:id/comments', wrap((req) => {
  const ws = req.ws;
  const t = getTask(ws, req.params.id); if (!t) throw bad('Task not found', 404);
  const body = str(req.body.message, 4000).trim(); if (!body) throw bad('Comment is empty');
  const ev = logActivity(ws, { task_id: t.id, kind: 'comment', actor: 'you', message: body });
  if (t.assignee_id && t.dispatched_at && t.status !== 'done') { const a = getAgent(ws, t.assignee_id); if (a) deliver(ws, a, { kind: 'comment', title: `Comment on ${keyOf(ws, t)}`, body, task_id: t.id }); }
  return ev;
}));

r.post('/route-preview', wrap((req) => {
  const res = routeTask(req.ws, { title: str(req.body.title), description: str(req.body.description), tags: req.body.tags || [] }, { dryRun: true });
  return { agent_id: res.agent?.id || null, reason: res.reason };
}));

/* ---------------- agents ---------------- */
function agentFields(body) {
  const f = {};
  if ('name' in body) { f.name = str(body.name, 40).trim(); if (!f.name) throw bad('Agent name is required'); }
  if ('handle' in body) { f.handle = str(body.handle, 24).toLowerCase().replace(/[^a-z0-9_-]/g, ''); if (!f.handle) delete f.handle; }
  if ('color' in body) { if (!/^#[0-9a-f]{6}$/i.test(body.color)) throw bad('Invalid colour'); f.color = body.color; }
  if ('avatar' in body) { const v = str(body.avatar, 400000); if (v && !v.startsWith('data:image/')) throw bad('Avatar must be an image'); f.avatar = v; }
  if ('provider' in body) { if (!PROVIDERS.includes(body.provider)) throw bad('Unknown coding tool'); f.provider = body.provider; }
  for (const k of ['role', 'personality', 'system_prompt', 'webhook_url']) if (k in body) f[k] = str(body[k], k === 'system_prompt' ? 20000 : 1000);
  if (f.webhook_url && !/^https?:\/\//.test(f.webhook_url)) throw bad('Webhook must be an http(s) URL');
  if ('skills' in body) f.skills = JSON.stringify((Array.isArray(body.skills) ? body.skills : []).map((s) => str(s, 30).trim()).filter(Boolean).slice(0, 20));
  if ('max_concurrent' in body) f.max_concurrent = Math.max(1, Math.min(20, parseInt(body.max_concurrent) || 3));
  if ('paused' in body) f.paused = body.paused ? 1 : 0;
  return f;
}
r.post('/agents', wrap((req) => {
  const f = agentFields({ provider: 'claude-code', ...req.body });
  if (!f.name) throw bad('Agent name is required');
  return insertAgent(req.ws, f);
}));
r.patch('/agents/:id', wrap((req) => {
  const ws = req.ws;
  const a = getAgent(ws, req.params.id); if (!a) throw bad('Agent not found', 404);
  const f = agentFields(req.body); if (!Object.keys(f).length) return publicAgent(a);
  if (f.handle && f.handle !== a.handle && db.prepare('SELECT 1 FROM agents WHERE workspace_id = ? AND handle = ? AND id != ?').get(ws, f.handle, a.id)) throw bad(`@${f.handle} is already used by another agent`, 409);
  db.prepare(`UPDATE agents SET ${Object.keys(f).map((k) => `${k}=@${k}`).join(',')} WHERE id=@id`).run({ ...f, id: a.id });
  if ('paused' in f && !!f.paused !== a.paused) logActivity(ws, { agent_id: a.id, kind: 'agent', message: `${a.name} ${f.paused ? 'paused' : 'resumed'}` });
  const out = publicAgent(getAgent(ws, a.id)); emit(ws, 'agent', out); return out;
}));
r.post('/agents/:id/token', wrap((req) => {
  const ws = req.ws;
  const a = getAgent(ws, req.params.id); if (!a) throw bad('Agent not found', 404);
  const repair = getSettings(ws).require_pairing !== false;
  db.prepare("UPDATE agents SET token = ?, paired_at = CASE WHEN ? THEN NULL ELSE paired_at END, pair_code = NULL, pair_expires_at = NULL, pair_attempts = 0, last_seen_at = NULL WHERE id = ?").run(newToken(), repair ? 1 : 0, a.id);
  logActivity(ws, { agent_id: a.id, kind: 'agent', message: `Rotated MCP token for ${a.name}${repair ? ' — it will need to pair again' : ''}` });
  const out = publicAgent(getAgent(ws, a.id)); emit(ws, 'agent', out); return out;
}));
r.post('/agents/:id/pair', wrap((req) => {
  const ws = req.ws;
  const a = db.prepare('SELECT * FROM agents WHERE workspace_id = ? AND id = ?').get(ws, req.params.id);
  if (!a) throw bad('Agent not found', 404);
  if (a.paired_at) return publicAgent(getAgent(ws, a.id));
  if (!rateLimit(`pair:${a.id}`, { max: 12, windowMs: 10 * 60e3 })) throw bad('Too many attempts. Wait a few minutes and ask the agent for a new code.', 429);
  const code = String(req.body?.code || '').replace(/\D/g, '');
  if (!a.pair_code || !a.pair_expires_at || Date.parse(a.pair_expires_at) < Date.now()) throw bad(`${a.name} has no active pairing code. Ask it to call whoami (or any assign tool) to get one.`, 410);
  const match = code.length === a.pair_code.length && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(a.pair_code));
  if (!match) {
    const attempts = (a.pair_attempts || 0) + 1;
    if (attempts >= 5) {
      db.prepare('UPDATE agents SET pair_code = NULL, pair_expires_at = NULL, pair_attempts = 0 WHERE id = ?').run(a.id);
      logActivity(ws, { agent_id: a.id, actor: 'system', kind: 'warn', message: `Pairing code for ${a.name} cancelled after 5 wrong attempts` });
      emit(ws, 'agent', publicAgent(getAgent(ws, a.id)));
      throw bad('Too many wrong codes — that code is cancelled. Ask the agent for a new one.', 422);
    }
    db.prepare('UPDATE agents SET pair_attempts = ? WHERE id = ?').run(attempts, a.id);
    throw bad(`That code doesn’t match. ${5 - attempts} ${5 - attempts === 1 ? 'try' : 'tries'} left.`, 422);
  }
  db.prepare('UPDATE agents SET paired_at = ?, pair_code = NULL, pair_expires_at = NULL, pair_attempts = 0 WHERE id = ?').run(now(), a.id);
  logActivity(ws, { agent_id: a.id, kind: 'connect', message: `Paired ${a.name}${a.pair_client ? ` with ${a.pair_client}` : ''}` });
  const out = publicAgent(getAgent(ws, a.id)); emit(ws, 'agent', out); return out;
}));
r.post('/agents/:id/unpair', wrap((req) => {
  const ws = req.ws;
  const a = getAgent(ws, req.params.id); if (!a) throw bad('Agent not found', 404);
  db.prepare('UPDATE agents SET paired_at = NULL, pair_code = NULL, pair_expires_at = NULL, pair_attempts = 0 WHERE id = ?').run(a.id);
  logActivity(ws, { agent_id: a.id, kind: 'agent', message: `Unpaired ${a.name}` });
  const out = publicAgent(getAgent(ws, a.id)); emit(ws, 'agent', out); return out;
}));
r.delete('/agents/:id', wrap((req) => {
  const ws = req.ws;
  const a = getAgent(ws, req.params.id); if (!a) throw bad('Agent not found', 404);
  db.prepare("UPDATE tasks SET assignee_id = NULL, claimed_at = NULL, status = CASE WHEN status = 'queued' THEN 'backlog' ELSE status END, dispatched_at = CASE WHEN status = 'queued' THEN NULL ELSE dispatched_at END WHERE assignee_id = ? AND workspace_id = ?").run(a.id, ws);
  db.prepare('DELETE FROM agents WHERE id = ?').run(a.id);
  emit(ws, 'agent:delete', { id: a.id }); logActivity(ws, { kind: 'agent', message: `Removed agent ${a.name}` });
  return { ok: true };
}));
r.get('/agents/:id/inbox', wrap((req) => {
  const a = getAgent(req.ws, req.params.id); if (!a) throw bad('Agent not found', 404);
  return db.prepare('SELECT * FROM inbox WHERE agent_id = ? ORDER BY created_at DESC LIMIT 50').all(a.id);
}));
r.get('/agents/:id/connect', wrap((req) => {
  const ws = req.ws;
  const a = getAgent(ws, req.params.id); if (!a) throw bad('Agent not found', 404);
  const base = baseUrlFrom(req);
  const detected = detectProvider(a.client_name);
  return {
    token: a.token, mcp_url: `${base}/mcp`, server_key: serverKey(a), provider: a.provider,
    client: { name: a.client_name, version: a.client_version, detected, mismatch: !!(detected && detected !== a.provider && a.provider !== 'other') },
    configs: clientConfigs(a, `${base}/mcp`), load: agentLoad(a.id),
    worktree: `git worktree add ../${slugify(getWorkspace(ws).name, 20) || 'repo'}-${a.handle} -b ${a.handle}/main`,
  };
}));
r.get('/agents/:id/skill.zip', (req, res) => {
  const ws = req.ws;
  const a = getAgent(ws, req.params.id);
  if (!a) return res.status(404).json({ error: 'Agent not found' });
  const refFiles = db.prepare('SELECT name, content FROM agent_files WHERE agent_id = ? ORDER BY name').all(a.id);
  const files = personalSkill({ baseUrl: baseUrlFrom(req), agent: a, workspace: getWorkspace(ws), persona: persona(a), prefix: getSettings(ws).key_prefix, refFiles });
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${serverKey(a)}-skill.zip"`, 'Cache-Control': 'no-store' });
  res.send(zip(files));
});

/* ---------------- agent reference files ---------------- */
const FILE_NAME = /^[\w.\- ]{1,80}$/;
const fileList = (agentId) => db.prepare('SELECT name, length(content) AS bytes, updated_at FROM agent_files WHERE agent_id = ? ORDER BY name').all(agentId);

r.get('/agents/:id/files', wrap((req) => {
  const a = getAgent(req.ws, req.params.id); if (!a) throw bad('Agent not found', 404);
  return db.prepare('SELECT name, content, updated_at FROM agent_files WHERE agent_id = ? ORDER BY name').all(a.id);
}));
r.put('/agents/:id/files/:name', wrap((req) => {
  const ws = req.ws;
  const a = getAgent(ws, req.params.id); if (!a) throw bad('Agent not found', 404);
  const name = str(decodeURIComponent(req.params.name), 80).trim();
  if (!FILE_NAME.test(name) || name.includes('..')) throw bad('File name: letters, numbers, spaces, dots, dashes only');
  const content = str(req.body.content, 50000);
  const count = db.prepare('SELECT COUNT(*) n, MAX(CASE WHEN name = ? THEN 1 ELSE 0 END) hasIt FROM agent_files WHERE agent_id = ?').get(name, a.id);
  if (count.n >= 20 && !count.hasIt) throw bad('20 files per agent is plenty');
  const ts = now();
  db.prepare(`INSERT INTO agent_files (id, workspace_id, agent_id, name, content, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(agent_id, name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`).run(uid('af_'), ws, a.id, name, content, ts, ts);
  logActivity(ws, { agent_id: a.id, kind: 'agent', message: `Saved file ${name} on ${a.name}` });
  emit(ws, 'agentfiles', { agent_id: a.id, files: fileList(a.id) });
  return { name, files: fileList(a.id) };
}));
r.delete('/agents/:id/files/:name', wrap((req) => {
  const ws = req.ws;
  const a = getAgent(ws, req.params.id); if (!a) throw bad('Agent not found', 404);
  const name = decodeURIComponent(req.params.name);
  const gone = db.prepare('SELECT 1 FROM agent_files WHERE agent_id = ? AND name = ?').get(a.id, name);
  db.prepare('DELETE FROM agent_files WHERE agent_id = ? AND name = ?').run(a.id, name);
  if (gone) logActivity(ws, { agent_id: a.id, kind: 'agent', message: `Removed file ${name} from ${a.name}` });
  emit(ws, 'agentfiles', { agent_id: a.id, files: fileList(a.id) });
  return { ok: true, files: fileList(a.id) };
}));

/* ---------------- automations ---------------- */
const KINDS = ['daily_digest', 'dispatch_batch', 'deadline_reminder', 'stale_nudge'];
function autoFields(ws, body) {
  const f = {};
  if ('name' in body) { f.name = str(body.name, 80).trim(); if (!f.name) throw bad('Name is required'); }
  if ('kind' in body) { if (!KINDS.includes(body.kind)) throw bad('Invalid automation type'); f.kind = body.kind; }
  if ('time' in body) { if (!/^\d{2}:\d{2}$/.test(body.time)) throw bad('Time must be HH:MM'); f.time = body.time; }
  if ('days' in body) f.days = JSON.stringify((body.days || []).map(Number).filter((d) => d >= 0 && d <= 6));
  if ('agent_ids' in body) f.agent_ids = JSON.stringify((body.agent_ids || []).filter((id) => getAgent(ws, id)));
  if ('priorities' in body) f.priorities = JSON.stringify((body.priorities || []).filter((p) => PRIORITIES.includes(p)));
  if ('params' in body) f.params = JSON.stringify(body.params || {});
  if ('enabled' in body) f.enabled = body.enabled ? 1 : 0;
  return f;
}
const getAuto = (ws, id) => hydrate.automation(db.prepare('SELECT * FROM automations WHERE id = ? AND workspace_id = ?').get(id, ws));
r.post('/automations', wrap((req) => {
  const ws = req.ws;
  const f = autoFields(ws, { kind: 'daily_digest', time: '09:00', days: [1, 2, 3, 4, 5], agent_ids: [], priorities: PRIORITIES, params: {}, enabled: true, ...req.body });
  if (!f.name) throw bad('Name is required');
  const a = { id: uid('au_'), workspace_id: ws, ...f, created_at: now(), last_run_at: null, run_count: 0 };
  const cols = Object.keys(a);
  db.prepare(`INSERT INTO automations (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(a);
  const out = getAuto(ws, a.id); emit(ws, 'automation', out); logActivity(ws, { kind: 'automation', actor: 'you', message: `Created automation “${out.name}”` });
  return out;
}));
r.patch('/automations/:id', wrap((req) => {
  const ws = req.ws;
  const a = getAuto(ws, req.params.id); if (!a) throw bad('Automation not found', 404);
  const f = autoFields(ws, req.body); if (!Object.keys(f).length) return a;
  db.prepare(`UPDATE automations SET ${Object.keys(f).map((k) => `${k}=@${k}`).join(',')} WHERE id=@id`).run({ ...f, id: a.id });
  const out = getAuto(ws, a.id); emit(ws, 'automation', out); return out;
}));
r.delete('/automations/:id', wrap((req) => {
  const ws = req.ws;
  const a = getAuto(ws, req.params.id); if (!a) throw bad('Automation not found', 404);
  db.prepare('DELETE FROM automations WHERE id = ?').run(a.id);
  emit(ws, 'automation:delete', { id: a.id }); return { ok: true };
}));
r.post('/automations/:id/run', wrap((req) => {
  const ws = req.ws;
  const a = getAuto(ws, req.params.id); if (!a) throw bad('Automation not found', 404);
  const summary = runAutomation(a, { manual: true });
  return { summary, automation: getAuto(ws, a.id) };
}));

/* ---------------- analytics ---------------- */
function tzParts(tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return (iso) => {
    const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24, dow: DOW[p.weekday] };
  };
}
const hoursBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 3600e3;
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

r.get('/analytics', wrap((req) => {
  const ws = req.ws;
  const days = [7, 14, 30, 90].includes(+req.query.days) ? +req.query.days : 30;
  const tz = getSettings(ws).timezone || 'UTC';
  const at = tzParts(tz);
  const end = Date.now();
  const start = end - days * 864e5;
  const prevStart = start - days * 864e5;
  const inRange = (iso, a = start, b = end) => iso && Date.parse(iso) >= a && Date.parse(iso) < b;

  const tasks = db.prepare('SELECT * FROM tasks WHERE workspace_id = ?').all(ws).map(hydrate.task);
  const agents = listAgents(ws);
  const acts = db.prepare('SELECT kind, actor, agent_id, created_at FROM activity WHERE workspace_id = ? AND created_at >= ?').all(ws, new Date(prevStart).toISOString());

  // Daily series (workspace timezone), oldest → newest
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(at(new Date(end - i * 864e5).toISOString()).day);
  const series = Object.fromEntries(keys.map((k) => [k, { day: k, created: 0, completed: 0, cycle: [] }]));
  for (const t of tasks) {
    if (inRange(t.created_at)) { const k = at(t.created_at).day; if (series[k]) series[k].created++; }
    if (t.status === 'done' && inRange(t.completed_at)) {
      const k = at(t.completed_at).day;
      if (series[k]) { series[k].completed++; const from = t.claimed_at || t.started_at || t.dispatched_at; if (from) series[k].cycle.push(hoursBetween(from, t.completed_at)); }
    }
  }
  const daily = keys.map((k) => ({ day: k, created: series[k].created, completed: series[k].completed, cycle_h: round(median(series[k].cycle)) }));

  const period = (a, b) => {
    const done = tasks.filter((t) => t.status === 'done' && inRange(t.completed_at, a, b));
    const cycles = done.map((t) => { const from = t.claimed_at || t.started_at || t.dispatched_at; return from ? hoursBetween(from, t.completed_at) : null; }).filter((x) => x != null && x >= 0);
    const pickups = tasks.filter((t) => t.dispatched_at && t.claimed_at && inRange(t.claimed_at, a, b)).map((t) => hoursBetween(t.dispatched_at, t.claimed_at) * 60).filter((x) => x >= 0);
    const withDeadline = done.filter((t) => t.deadline);
    const onTime = withDeadline.filter((t) => Date.parse(t.completed_at) <= Date.parse(t.deadline)).length;
    return {
      created: tasks.filter((t) => inRange(t.created_at, a, b)).length,
      completed: done.length,
      cycle_h: round(median(cycles)),
      pickup_min: round(median(pickups), 0),
      on_time: withDeadline.length ? Math.round((onTime / withDeadline.length) * 100) : null,
      with_deadline: withDeadline.length,
      agent_events: acts.filter((e) => e.actor === 'agent' && inRange(e.created_at, a, b)).length,
    };
  };
  const cur = period(start, end);
  const prev = period(prevStart, start);

  const perAgent = agents.map((a) => {
    const mine = tasks.filter((t) => t.assignee_id === a.id);
    const done = mine.filter((t) => t.status === 'done' && inRange(t.completed_at));
    const cyc = done.map((t) => { const from = t.claimed_at || t.started_at; return from ? hoursBetween(from, t.completed_at) : null; }).filter((x) => x != null && x >= 0);
    return {
      id: a.id, name: a.name, handle: a.handle, color: a.color, provider: a.provider,
      completed: done.length,
      active: mine.filter((t) => ['queued', 'in_progress'].includes(t.status)).length,
      review: mine.filter((t) => t.status === 'review').length,
      cycle_h: round(median(cyc)),
      events: acts.filter((e) => e.agent_id === a.id && e.actor === 'agent' && inRange(e.created_at)).length,
    };
  });

  const funnel = STATUSES.map((s) => ({ status: s, label: STATUS_LABEL[s], count: tasks.filter((t) => t.status === s).length }));
  const priorities = PRIORITIES.map((p) => ({ priority: p, created: tasks.filter((t) => t.priority === p && inRange(t.created_at)).length, open: tasks.filter((t) => t.priority === p && t.status !== 'done').length }));
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const e of acts) if (inRange(e.created_at) && (e.actor === 'agent' || ['dispatch', 'status', 'comment'].includes(e.kind))) { const p = at(e.created_at); heat[p.dow][p.hour]++; }
  const kinds = {};
  for (const e of acts) if (inRange(e.created_at)) kinds[e.kind] = (kinds[e.kind] || 0) + 1;

  // 26-week activity calendar (independent of the range) for the contribution-style heatmap
  const calStart = end - 181 * 864e5;
  const calRows = db.prepare('SELECT created_at FROM activity WHERE workspace_id = ? AND created_at >= ? AND (actor = \'agent\' OR kind IN (\'dispatch\',\'status\',\'comment\'))').all(ws, new Date(calStart - 864e5).toISOString());
  const calCount = {};
  for (const e of calRows) { const k = at(e.created_at).day; calCount[k] = (calCount[k] || 0) + 1; }
  const calendar = [];
  for (let i = 181; i >= 0; i--) { const k = at(new Date(end - i * 864e5).toISOString()).day; if (!calendar.length || calendar[calendar.length - 1].day !== k) calendar.push({ day: k, count: calCount[k] || 0 }); }

  const uRows = db.prepare('SELECT agent_id, task_id, model, tokens_in, tokens_out, cost_usd, created_at FROM usage_events WHERE workspace_id = ? AND created_at >= ?').all(ws, new Date(prevStart).toISOString());
  const inU = (iso) => inRange(iso);
  const usageDaily = keys.map((k) => ({ day: k, tokens_in: 0, tokens_out: 0, cost_usd: 0 }));
  const ud = Object.fromEntries(usageDaily.map((x) => [x.day, x]));
  for (const e of uRows) { if (!inU(e.created_at)) continue; const k = at(e.created_at).day; if (ud[k]) { ud[k].tokens_in += e.tokens_in; ud[k].tokens_out += e.tokens_out; ud[k].cost_usd += e.cost_usd || 0; } }
  const byModel = {};
  const byAgentUsage = {};
  let used = { tokens_in: 0, tokens_out: 0, cost_usd: 0, reports: 0 };
  for (const e of uRows) { if (!inU(e.created_at)) continue; used.tokens_in += e.tokens_in; used.tokens_out += e.tokens_out; used.cost_usd += e.cost_usd || 0; used.reports++; (byModel[e.model || 'unknown'] ??= { model: e.model || 'unknown', tokens_in: 0, tokens_out: 0, cost_usd: 0, reports: 0 }); const bm = byModel[e.model || 'unknown']; bm.tokens_in += e.tokens_in; bm.tokens_out += e.tokens_out; bm.cost_usd += e.cost_usd || 0; bm.reports++; (byAgentUsage[e.agent_id] ??= { agent_id: e.agent_id, tokens_in: 0, tokens_out: 0, cost_usd: 0, reports: 0 }); const ba = byAgentUsage[e.agent_id]; ba.tokens_in += e.tokens_in; ba.tokens_out += e.tokens_out; ba.cost_usd += e.cost_usd || 0; ba.reports++; }
  const usage = { ...used, daily: usageDaily, models: Object.values(byModel).sort((a2, b2) => b2.cost_usd - a2.cost_usd), agents: Object.values(byAgentUsage).sort((a2, b2) => b2.tokens_in + b2.tokens_out - (a2.tokens_in + a2.tokens_out)) };

  return { days, timezone: tz, generated_at: now(), totals: cur, previous: prev, daily, per_agent: perAgent, funnel, priorities, heatmap: heat, calendar, kinds, usage, open: tasks.filter((t) => t.status !== 'done').length };
}));

/* ---------------- storage hygiene ---------------- */
// Retention caps keep the SQLite file small on long-lived workspaces.
const pruneStorage = db.transaction(() => {
  db.prepare('DELETE FROM activity WHERE created_at < ?').run(new Date(Date.now() - 90 * 864e5).toISOString());
  db.prepare("DELETE FROM inbox WHERE read_at IS NOT NULL AND created_at < ?").run(new Date(Date.now() - 60 * 864e5).toISOString());
  db.prepare('DELETE FROM usage_events WHERE created_at < ?').run(new Date(Date.now() - 365 * 864e5).toISOString());
  db.prepare("DELETE FROM runner_sessions WHERE status IN ('done','failed','stopped') AND created_at < ?").run(new Date(Date.now() - 30 * 864e5).toISOString());
});
function tidyStorage() {
  try { pruneStorage(); db.pragma('analysis_limit = 1000'); db.exec('ANALYZE'); db.pragma('optimize');
    const [{ free_list_count: free } = {}] = db.pragma('freelist_count'); const [{ page_count: pages } = {}] = db.pragma('page_count');
    if (pages && free / pages > 0.15) { db.pragma('incremental_vacuum = 500'); db.exec('VACUUM'); }
  } catch (e) { console.error('storage tidy failed', e); }
}
setImmediate(() => tidyStorage());
setInterval(() => tidyStorage(), 12 * 3600e3).unref?.();

/* ---------------- settings ---------------- */
r.get('/settings', wrap((req) => getSettings(req.ws)));
r.patch('/settings', wrap((req) => {
  const ws = req.ws;
  const s = getSettings(ws);
  const b = req.body || {};
  if ('workspace' in b) {
    const name = str(b.workspace, 60).trim(); if (!name) throw bad('Workspace name is required');
    db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, ws);
    emit(ws, 'workspace', getWorkspace(ws));
  }
  if ('description' in b) s.description = str(b.description, 1000);
  if ('timezone' in b) { if (!validTz(b.timezone)) throw bad('Unknown timezone'); s.timezone = b.timezone; }
  if ('routing' in b) { if (!['smart', 'least_loaded', 'round_robin'].includes(b.routing)) throw bad('Invalid routing'); s.routing = b.routing; }
  if ('tools' in b) s.tools = (Array.isArray(b.tools) ? b.tools : []).filter((t) => PROVIDERS.includes(t));
  if ('require_pairing' in b) s.require_pairing = !!b.require_pairing;
  if ('key_prefix' in b) { const p = str(b.key_prefix, 6).toUpperCase().replace(/[^A-Z]/g, ''); if (p.length < 2) throw bad('Prefix needs 2–6 letters'); s.key_prefix = p; }
  if ('preset' in b && POLICY_PRESETS[b.preset]) { s.preset = b.preset; s.policy = JSON.parse(JSON.stringify(POLICY_PRESETS[b.preset])); }
  if (b.policy) {
    for (const p of PRIORITIES) {
      if (!b.policy[p]) continue;
      const v = { ...s.policy[p], ...b.policy[p] };
      if (!['instant', 'batched', 'daily', 'manual'].includes(v.mode)) throw bad('Invalid send mode');
      v.interval = Math.max(1, Math.min(1440, parseInt(v.interval) || 30));
      if (!/^\d{2}:\d{2}$/.test(v.time)) v.time = '09:00';
      s.policy[p] = v;
    }
    s.preset = Object.entries(POLICY_PRESETS).find(([, pr]) => PRIORITIES.every((p) => pr[p].mode === s.policy[p].mode && (pr[p].mode !== 'batched' || +pr[p].interval === +s.policy[p].interval) && (pr[p].mode !== 'daily' || pr[p].time === s.policy[p].time)))?.[0] || 'custom';
  }
  saveSettings(ws, s); emit(ws, 'settings', s); return s;
}));
r.get('/activity', wrap((req) => db.prepare('SELECT * FROM activity WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(req.ws, Math.min(500, parseInt(req.query.limit) || 100))));

/* ---------------- account ---------------- */
r.patch('/account', wrap((req) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const next = { name: u.name, email: u.email };
  if ('name' in req.body) { next.name = str(req.body.name, 60).trim(); if (!next.name) throw bad('Name is required'); }
  if ('email' in req.body) {
    next.email = str(req.body.email, 200).trim().toLowerCase();
    if (!EMAIL.test(next.email)) throw bad('Enter a valid email address');
    if (next.email !== u.email) {
      if (!verifyPassword(req.body.password || '', u.password_hash)) throw bad('Enter your current password to change email', 401);
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(next.email, u.id)) throw bad('That email is already in use', 409);
    }
  }
  db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(next.name, next.email, u.id);
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) };
}));
r.post('/account/password', wrap((req) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!rateLimit(`pw:${u.id}`, { max: 10 })) throw bad('Too many attempts', 429);
  if (!verifyPassword(req.body.current || '', u.password_hash)) throw bad('Current password is incorrect', 401);
  const next = String(req.body.next || '');
  if (next.length < 8) throw bad('Use at least 8 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), u.id);
  destroyUserSessions(u.id, req.token);
  return { ok: true };
}));
r.post('/account/logout-others', wrap((req) => { destroyUserSessions(req.user.id, req.token); return { ok: true }; }));
r.delete('/account', wrap((req) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(req.body?.password || '', u.password_hash)) throw bad('Password is incorrect', 401);
  db.transaction(() => {
    db.prepare('DELETE FROM ai_keys WHERE workspace_id = ?').run(u.workspace_id);
    db.prepare('DELETE FROM workspaces WHERE id = ? AND owner_id = ?').run(u.workspace_id, u.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  })();
  return { ok: true };
}));

/* ---------------- workspace data ---------------- */
r.get('/export', (req, res) => {
  const ws = req.ws;
  const data = {
    exported_at: now(), version: 2,
    workspace: getWorkspace(ws), settings: getSettings(ws),
    boards: db.prepare('SELECT * FROM boards WHERE workspace_id = ?').all(ws),
    agents: listAgents(ws).map(({ token, ...a }) => a),
    tasks: db.prepare('SELECT * FROM tasks WHERE workspace_id = ?').all(ws).map(hydrate.task),
    automations: db.prepare('SELECT * FROM automations WHERE workspace_id = ?').all(ws).map(hydrate.automation),
    activity: db.prepare('SELECT * FROM activity WHERE workspace_id = ? ORDER BY created_at').all(ws),
  };
  res.set({ 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="assign-export-${now().slice(0, 10)}.json"` });
  res.send(JSON.stringify(data, null, 2));
});
r.post('/workspace/clear', wrap((req) => {
  const ws = req.ws;
  if (req.body?.confirm !== getWorkspace(ws).name) throw bad('Type the workspace name to confirm');
  db.transaction(() => {
    db.prepare('DELETE FROM tasks WHERE workspace_id = ?').run(ws);
    db.prepare('DELETE FROM activity WHERE workspace_id = ?').run(ws);
    db.prepare('DELETE FROM inbox WHERE workspace_id = ?').run(ws);
  })();
  logActivity(ws, { kind: 'delete', message: 'Cleared all tasks and history' });
  emit(ws, 'reset', {});
  return { ok: true };
}));

export default r;
