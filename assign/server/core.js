import { AsyncLocalStorage } from 'node:async_hooks';
import { db, now, uid, hydrate, getSettings, saveSettings, slugify } from './db.js';
import { CLIENTS, clientLabel } from './skill.js';

/* ---------------- realtime bus (SSE, one channel per workspace) ---------------- */
const channels = new Map(); // ws -> Set(res)
export function addClient(ws, res) {
  if (!channels.has(ws)) channels.set(ws, new Set());
  channels.get(ws).add(res);
  return () => { const set = channels.get(ws); if (set) { set.delete(res); if (!set.size) channels.delete(ws); } };
}
export function emit(ws, type, data) {
  const set = channels.get(ws); if (!set) return;
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) { try { res.write(payload); } catch { /* ignore */ } }
}
setInterval(() => { for (const set of channels.values()) for (const res of set) { try { res.write(': ping\n\n'); } catch {} } }, 25000).unref();

/* ---------------- constants ---------------- */
export const STATUSES = ['backlog', 'queued', 'in_progress', 'review', 'done'];
export const PRIORITIES = ['critical', 'high', 'medium', 'low'];
export const STATUS_LABEL = { backlog: 'Backlog', queued: 'Queued', in_progress: 'In progress', review: 'Review', done: 'Done' };
export const PROVIDERS = ['claude-code', 'cursor', 'codex', 'windsurf', 'vscode', 'gemini-cli', 'cline', 'other'];
export const PRIO_ORDER = "CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END";

export const keyOf = (ws, t) => `${getSettings(ws).key_prefix || 'ASG'}-${t.number}`;

/* ---------------- lookups (always workspace scoped) ---------------- */
export function getTask(ws, id) {
  const s = String(id ?? '').trim();
  const num = s.replace(/^#/, '').replace(/^[a-z]{2,6}-?/i, '');
  const row = db.prepare('SELECT * FROM tasks WHERE workspace_id = ? AND (id = ? OR (? GLOB \'[0-9]*\' AND number = CAST(? AS INTEGER)))').get(ws, s, num, num);
  return hydrate.task(row);
}
export function getAgent(ws, id) { return hydrate.agent(db.prepare('SELECT * FROM agents WHERE workspace_id = ? AND id = ?').get(ws, id)); }
export function listAgents(ws) { return db.prepare('SELECT * FROM agents WHERE workspace_id = ? ORDER BY created_at').all(ws).map(hydrate.agent); }
export function emitTask(ws, id) { const t = getTask(ws, id); if (t) emit(ws, 'task', t); return t; }
export function publicAgent(a) {
  if (!a) return a;
  const { token, pair_code, pair_attempts, ...rest } = a;
  const pending = !a.paired_at && !!pair_code && !!a.pair_expires_at && Date.parse(a.pair_expires_at) > Date.now();
  return { ...rest, paired: !!a.paired_at, pair_pending: pending, pair_expires_at: pending ? a.pair_expires_at : null, token_hint: token ? token.slice(0, 8) + '…' + token.slice(-4) : '' };
}
/** True when the agent may touch tasks (paired, or pairing switched off for the workspace). */
export function isPaired(ws, a) { return !!a.paired_at || getSettings(ws).require_pairing === false; }

// Requests made by the in-app assistant run inside this store so their activity reads "Assistant".
export const actorStore = new AsyncLocalStorage();
export function logActivity(ws, { task_id = null, agent_id = null, actor = 'you', kind = 'info', message }) {
  if (actor === 'you' && actorStore.getStore() === 'assistant') actor = 'assistant';
  const row = { id: uid('ev_'), workspace_id: ws, task_id, agent_id, actor, kind, message, created_at: now() };
  db.prepare('INSERT INTO activity (id, workspace_id, task_id, agent_id, actor, kind, message, created_at) VALUES (@id,@workspace_id,@task_id,@agent_id,@actor,@kind,@message,@created_at)').run(row);
  emit(ws, 'activity', row);
  return row;
}

export function agentLoad(agentId) {
  return db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status IN ('queued','in_progress')").get(agentId).n;
}

export function branchFor(agent, t) {
  return `${agent.handle}/asg-${t.number}-${slugify(t.title, 32) || 'task'}`;
}

/* ---------------- auto routing ---------------- */
const STOP = new Set('a an the and or of to in on for with is are be this that it as at by from into we our you your fix add make update new use'.split(' '));
const words = (s) => (s || '').toLowerCase().replace(/[^a-z0-9+#.\s/-]/g, ' ').split(/[\s/]+/).filter((w) => w.length > 1 && !STOP.has(w));

export function routeTask(ws, task, { dryRun = false } = {}) {
  const settings = getSettings(ws);
  const active = listAgents(ws).filter((a) => !a.paused);
  if (!active.length) return { agent: null, reason: 'No active agents yet — add one on the Agents page' };
  // Prefer agents that have paired; fall back to everyone so work is never stranded.
  const paired = active.filter((a) => isPaired(ws, a));
  const agents = paired.length ? paired : active;
  const loads = Object.fromEntries(agents.map((a) => [a.id, agentLoad(a.id)]));

  if (settings.routing === 'round_robin') {
    const i = (settings.runtime.rr || 0) % agents.length;
    if (!dryRun) { settings.runtime.rr = i + 1; saveSettings(ws, settings); }
    return { agent: agents[i], reason: 'Round robin rotation' };
  }
  if (settings.routing === 'least_loaded') {
    const a = [...agents].sort((x, y) => loads[x.id] - loads[y.id])[0];
    return { agent: a, reason: `Least loaded (${loads[a.id]} active)` };
  }
  const tw = new Set([...words(task.title), ...words(task.description), ...(task.tags || []).flatMap(words)]);
  let best = null;
  for (const a of agents) {
    const kw = new Set([...a.skills.flatMap(words), ...words(a.role)]);
    const hits = [...kw].filter((k) => tw.has(k) || [...tw].some((t) => t.length > 3 && (t.startsWith(k) || k.startsWith(t))));
    const capacityPenalty = loads[a.id] >= (a.max_concurrent || 3) ? 4 : 0;
    const score = hits.length * 3 - loads[a.id] * 1.1 - capacityPenalty;
    if (!best || score > best.score) best = { agent: a, score, hits };
  }
  if (!best.hits.length) {
    const a = [...agents].sort((x, y) => loads[x.id] - loads[y.id])[0];
    return { agent: a, reason: `No skill match — least loaded (${loads[a.id]} active)` };
  }
  return { agent: best.agent, reason: `Matched ${best.hits.slice(0, 3).join(', ')}` };
}

/* ---------------- delivery (inbox + optional webhook) ---------------- */
export function deliver(ws, agent, { kind, title, body = '', task_id = null }) {
  const row = { id: uid('in_'), workspace_id: ws, agent_id: agent.id, kind, title, body, task_id, webhook_status: agent.webhook_url ? 'pending' : null, read_at: null, created_at: now() };
  db.prepare('INSERT INTO inbox (id, workspace_id, agent_id, kind, title, body, task_id, webhook_status, read_at, created_at) VALUES (@id,@workspace_id,@agent_id,@kind,@title,@body,@task_id,@webhook_status,@read_at,@created_at)').run(row);
  emit(ws, 'inbox', row);
  if (agent.webhook_url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch(agent.webhook_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-assign-event': kind },
      body: JSON.stringify({ event: kind, agent: { id: agent.id, name: agent.name, handle: agent.handle }, title, body, task: task_id ? getTask(ws, task_id) : null, sent_at: row.created_at }),
      signal: ctrl.signal,
    })
      .then((r) => r.status)
      .catch((e) => 'error: ' + (e.name === 'AbortError' ? 'timeout' : e.message))
      .then((status) => { clearTimeout(timer); try { db.prepare('UPDATE inbox SET webhook_status = ? WHERE id = ?').run(String(status), row.id); } catch {} });
  }
  return row;
}

export function taskBrief(ws, t) {
  const lines = [
    `${keyOf(ws, t)} · ${t.title}`,
    `Priority: ${t.priority}${t.deadline ? ` · Deadline: ${t.deadline}` : ''}`,
    t.repo ? `Repo: ${t.repo}` : '',
    t.branch ? `Branch: ${t.branch}` : '',
    '',
    t.description || '',
    t.acceptance ? `\nAcceptance criteria:\n${t.acceptance}` : '',
  ];
  return lines.filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------------- dispatch ---------------- */
export function dispatchTask(ws, taskId, { actor = 'system', reason = '' } = {}) {
  let t = getTask(ws, taskId);
  if (!t) return null;
  if (['in_progress', 'review', 'done'].includes(t.status)) return t;
  let agent = t.assignee_id ? getAgent(ws, t.assignee_id) : null;
  if (!agent) {
    const r = routeTask(ws, t);
    if (!r.agent) { logActivity(ws, { task_id: t.id, actor: 'system', kind: 'warn', message: `Could not send ${keyOf(ws, t)}: ${r.reason}` }); return t; }
    agent = r.agent;
    db.prepare('UPDATE tasks SET assignee_id = ?, updated_at = ? WHERE id = ?').run(agent.id, now(), t.id);
    logActivity(ws, { task_id: t.id, agent_id: agent.id, actor: 'system', kind: 'route', message: `Auto-routed ${keyOf(ws, t)} to ${agent.name} — ${r.reason}` });
  }
  const ts = now();
  const minPos = db.prepare("SELECT COALESCE(MIN(position), 1000) AS p FROM tasks WHERE board_id = ? AND status = 'queued'").get(t.board_id).p;
  const branch = t.branch || branchFor(agent, t);
  db.prepare("UPDATE tasks SET status = 'queued', dispatched_at = ?, position = ?, branch = ?, updated_at = ? WHERE id = ?").run(ts, minPos - 1, branch, ts, t.id);
  t = getTask(ws, t.id);
  deliver(ws, agent, { kind: 'task', title: `New task: ${keyOf(ws, t)} ${t.title}`, body: taskBrief(ws, t), task_id: t.id });
  logActivity(ws, { task_id: t.id, agent_id: agent.id, actor, kind: 'dispatch', message: `Sent ${keyOf(ws, t)} to ${agent.name}${reason ? ` · ${reason}` : ''}` });
  emit(ws, 'task', t);
  return t;
}

/* Honour start mode + priority policy after create/edit */
export function applyStartPolicy(ws, taskId, actor = 'you') {
  const t = getTask(ws, taskId);
  if (!t || t.status !== 'backlog' || t.dispatched_at) return t;
  if (!t.assignee_id && !t.auto_route) return t;
  if (t.start_mode === 'now') return dispatchTask(ws, t.id, { actor, reason: 'Started immediately' });
  if (t.start_mode === 'policy') {
    const pol = getSettings(ws).policy[t.priority];
    if (pol?.mode === 'instant') return dispatchTask(ws, t.id, { actor: 'system', reason: `${t.priority} priority · instant send` });
  }
  return t;
}

/* ---------------- conflict-free claiming ----------------
 * A task can be owned by exactly one agent. Claims are compare-and-swap updates inside
 * an IMMEDIATE transaction, so two agents (even in the same coding tool) can never both win. */
export const claimTask = db.transaction((ws, agent, taskId, { from = ['backlog', 'queued'], allowOwn = true } = {}) => {
  const t = getTask(ws, taskId);
  if (!t) return { ok: false, error: `Task ${taskId} not found` };
  if (t.assignee_id && t.assignee_id !== agent.id) {
    const owner = getAgent(ws, t.assignee_id);
    return { ok: false, error: `${keyOf(ws, t)} is owned by @${owner?.handle || 'another agent'}${owner ? ` (${clientLabel(owner)})` : ''}. Leave it alone — call get_next_task for your own work.`, owner };
  }
  if (t.assignee_id === agent.id && allowOwn) return { ok: true, task: t, already: true };
  if (!from.includes(t.status)) return { ok: false, error: `${keyOf(ws, t)} is ${t.status.replace('_', ' ')} and can't be claimed.` };
  const ts = now();
  const branch = t.branch || branchFor(agent, t);
  const res = db.prepare('UPDATE tasks SET assignee_id = ?, claimed_at = ?, branch = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND assignee_id IS NULL').run(agent.id, ts, branch, ts, t.id, ws);
  if (res.changes !== 1) return { ok: false, error: `${keyOf(ws, t)} was just claimed by another agent.` };
  return { ok: true, task: getTask(ws, t.id) };
});
