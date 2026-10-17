// Tools the in-app assistant (chat + voice) can use to read and control the workspace.
// Reads go straight to SQLite (workspace-scoped). Writes go through the app's own REST API
// as the signed-in user, so validation, side effects, activity and live updates are identical
// to clicking the UI.
import { db, hydrate, getSettings, getWorkspace } from '../db.js';
import { STATUS_LABEL } from '../core.js';

const PORT = Number(process.env.PORT) || 3000;
const STATUS = ['backlog', 'queued', 'in_progress', 'review', 'done'];
const PRIO = ['critical', 'high', 'medium', 'low'];
const PROVIDERS = ['claude-code', 'cursor', 'codex', 'windsurf', 'vscode', 'gemini-cli', 'cline', 'other'];
const KINDS = ['daily_digest', 'dispatch_batch', 'deadline_reminder', 'stale_nudge'];
const PAGES = ['overview', 'boards', 'board', 'agents', 'analytics', 'automations', 'activity', 'settings', 'docs'];

class ToolError extends Error {}
const fail = (m) => { throw new ToolError(m); };

/* ───────────── schema helpers ───────────── */
const S = (description, extra = {}) => ({ type: 'string', description, ...extra });
const N = (description) => ({ type: 'number', description });
const B = (description) => ({ type: 'boolean', description });
const A = (description, items = { type: 'string' }) => ({ type: 'array', description, items });
const obj = (properties = {}, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const TASK_REF = S('Task key like "ASG-12", a number like "12", or a distinctive part of the title');
const AGENT_REF = S('Agent name or handle');

/* ───────────── lookups ───────────── */
const prefix = (ws) => getSettings(ws).key_prefix || 'ASG';
const boards = (ws) => db.prepare('SELECT * FROM boards WHERE workspace_id = ? ORDER BY position, created_at').all(ws);
const agents = (ws) => db.prepare('SELECT * FROM agents WHERE workspace_id = ? ORDER BY created_at').all(ws).map(hydrate.agent);
const tasks = (ws) => db.prepare('SELECT * FROM tasks WHERE workspace_id = ?').all(ws).map(hydrate.task);
const autos = (ws) => db.prepare('SELECT * FROM automations WHERE workspace_id = ? ORDER BY created_at').all(ws).map(hydrate.automation);
const norm = (s) => String(s || '').toLowerCase().trim();

function findTask(ws, ref) {
  if (ref == null || ref === '') fail('Which task? Give its key (e.g. ASG-12) or title.');
  const m = String(ref).match(/(\d+)\s*$/);
  if (m && /^\s*(#|[a-z]{2,6}-)?\s*\d+\s*$/i.test(String(ref))) {
    const t = db.prepare('SELECT * FROM tasks WHERE workspace_id = ? AND number = ?').get(ws, +m[1]);
    if (t) return hydrate.task(t);
    fail(`No task ${prefix(ws)}-${m[1]}.`);
  }
  const q = norm(ref);
  const all = tasks(ws);
  const exact = all.filter((t) => norm(t.title) === q);
  if (exact.length === 1) return exact[0];
  const hits = all.filter((t) => norm(t.title).includes(q));
  if (hits.length === 1) return hits[0];
  if (!hits.length) fail(`No task matches “${ref}”. Use list_tasks to search.`);
  fail(`“${ref}” matches ${hits.length} tasks: ${hits.slice(0, 6).map((t) => `${prefix(ws)}-${t.number} ${t.title}`).join('; ')}. Ask which one.`);
}
function findAgent(ws, ref) {
  const q = norm(ref).replace(/^@/, '');
  if (!q) fail('Which agent?');
  const all = agents(ws);
  const a = all.find((x) => norm(x.handle) === q || norm(x.name) === q) || (() => { const h = all.filter((x) => norm(x.name).includes(q) || norm(x.handle).includes(q)); return h.length === 1 ? h[0] : null; })();
  if (!a) fail(`No agent called “${ref}”. Agents: ${all.map((x) => x.name).join(', ') || 'none yet'}.`);
  return a;
}
function findBoard(ws, ref) {
  const all = boards(ws);
  if (!ref) return all[0] || fail('There are no projects yet. Create one first.');
  const q = norm(ref);
  const b = all.find((x) => norm(x.name) === q) || (() => { const h = all.filter((x) => norm(x.name).includes(q)); return h.length === 1 ? h[0] : null; })();
  if (!b) fail(`No project called “${ref}”. Projects: ${all.map((x) => x.name).join(', ')}.`);
  return b;
}
function findAuto(ws, ref) {
  const q = norm(ref);
  const all = autos(ws);
  const a = all.find((x) => norm(x.name) === q) || (() => { const h = all.filter((x) => norm(x.name).includes(q) || norm(x.kind).replace('_', ' ').includes(q)); return h.length === 1 ? h[0] : null; })();
  if (!a) fail(`No automation matches “${ref}”. Automations: ${all.map((x) => x.name).join(', ') || 'none'}.`);
  return a;
}
const isoOrNull = (v, label) => {
  if (v == null || v === '' || /^(none|null|clear|remove)$/i.test(String(v))) return null;
  const d = new Date(v); if (isNaN(d)) fail(`${label} must be an ISO 8601 date-time, e.g. 2026-10-14T17:00:00+05:30`);
  return d.toISOString();
};

/* ───────────── shapes returned to the model ───────────── */
function taskOut(ws, t, { full = false } = {}) {
  const a = t.assignee_id ? agents(ws).find((x) => x.id === t.assignee_id) : null;
  const b = boards(ws).find((x) => x.id === t.board_id);
  const out = {
    key: `${prefix(ws)}-${t.number}`, title: t.title, status: STATUS_LABEL[t.status] || t.status, priority: t.priority,
    agent: a ? a.name : t.auto_route ? 'Auto' : 'Unassigned', project: b?.name, progress: t.progress,
    deadline: t.deadline, overdue: !!(t.deadline && t.status !== 'done' && new Date(t.deadline) < new Date()), tags: t.tags,
  };
  if (full) Object.assign(out, { description: t.description, acceptance: t.acceptance, branch: t.branch, repo: t.repo, send_mode: t.start_mode, scheduled_at: t.scheduled_at, created_at: t.created_at, started_at: t.started_at, completed_at: t.completed_at, updated_at: t.updated_at });
  return out;
}
function agentOut(ws, a) {
  const open = tasks(ws).filter((t) => t.assignee_id === a.id && ['queued', 'in_progress'].includes(t.status)).length;
  const online = a.last_seen_at && Date.now() - new Date(a.last_seen_at).getTime() < 10 * 60e3;
  return { name: a.name, handle: a.handle, role: a.role, tool: a.provider, skills: a.skills, status: a.paused ? 'paused' : !a.paired_at && getSettings(ws).require_pairing !== false ? 'not paired' : online ? 'online' : 'idle', open_tasks: open, max_concurrent: a.max_concurrent, last_seen_at: a.last_seen_at };
}
const autoOut = (a) => ({ name: a.name, kind: a.kind, enabled: a.enabled, time: a.time, days: a.days, last_run_at: a.last_run_at, run_count: a.run_count, hours: a.params?.hours });

/* ───────────── internal API ───────────── */
async function api(ctx, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api${path}`, {
    method, headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json', 'X-Assign-Actor': 'assistant' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) fail(j.error || `Request failed (${res.status})`);
  return j;
}
const focus = (t) => ({ focus: { task_id: t.id, board_id: t.board_id } });

/* ───────────── tool definitions ───────────── */
// risk: 'read' | 'write' | 'risky' (needs confirmation). risky may be a function of args.
export const TOOLS = [
  /* ---------- read ---------- */
  { name: 'get_workspace_overview', risk: 'read', description: 'Snapshot of the workspace: task counts by column, what is waiting for review, overdue and due-soon tasks, agent status and projects. Call this first when the user asks a general question like "what\'s going on?"', parameters: obj(),
    run: (ctx) => {
      const ws = ctx.ws; const all = tasks(ws); const nowMs = Date.now();
      const counts = Object.fromEntries(STATUS.map((s) => [STATUS_LABEL[s], all.filter((t) => t.status === s).length]));
      const open = all.filter((t) => t.status !== 'done');
      return {
        workspace: getWorkspace(ws)?.name, counts,
        waiting_for_review: all.filter((t) => t.status === 'review').slice(0, 10).map((t) => taskOut(ws, t)),
        overdue: open.filter((t) => t.deadline && new Date(t.deadline) < nowMs).slice(0, 10).map((t) => taskOut(ws, t)),
        due_next_48h: open.filter((t) => t.deadline && new Date(t.deadline) >= nowMs && new Date(t.deadline) - nowMs < 48 * 3600e3).slice(0, 10).map((t) => taskOut(ws, t)),
        in_progress: all.filter((t) => t.status === 'in_progress').slice(0, 10).map((t) => taskOut(ws, t)),
        agents: agents(ws).map((a) => agentOut(ws, a)),
        projects: boards(ws).map((b) => ({ name: b.name, open_tasks: open.filter((t) => t.board_id === b.id).length })),
        completed_last_7_days: all.filter((t) => t.completed_at && nowMs - new Date(t.completed_at) < 7 * 86400e3).length,
      };
    } },
  { name: 'list_tasks', risk: 'read', description: 'Find tasks. All filters are optional and combine.', parameters: obj({
      status: S('Column', { enum: STATUS }), project: S('Project (board) name'), agent: S('Agent name or handle, "auto" or "unassigned"'), priority: S('Priority', { enum: PRIO }),
      query: S('Text to search in title, description and tags'), overdue: B('Only overdue tasks'), limit: N('Max results (default 20, max 50)'),
    }),
    run: (ctx, a) => {
      const ws = ctx.ws; let all = tasks(ws);
      if (a.status) all = all.filter((t) => t.status === a.status);
      if (a.project) { const b = findBoard(ws, a.project); all = all.filter((t) => t.board_id === b.id); }
      if (a.agent) { const q = norm(a.agent); all = q === 'auto' ? all.filter((t) => !t.assignee_id && t.auto_route) : q === 'unassigned' ? all.filter((t) => !t.assignee_id && !t.auto_route) : (() => { const ag = findAgent(ws, a.agent); return all.filter((t) => t.assignee_id === ag.id); })(); }
      if (a.priority) all = all.filter((t) => t.priority === a.priority);
      if (a.query) { const q = norm(a.query); all = all.filter((t) => norm(t.title).includes(q) || norm(t.description).includes(q) || t.tags.some((g) => norm(g).includes(q))); }
      if (a.overdue) all = all.filter((t) => t.deadline && t.status !== 'done' && new Date(t.deadline) < new Date());
      all.sort((x, y) => PRIO.indexOf(x.priority) - PRIO.indexOf(y.priority) || (y.updated_at || '').localeCompare(x.updated_at || ''));
      const limit = Math.min(50, Math.max(1, +a.limit || 20));
      return { total: all.length, tasks: all.slice(0, limit).map((t) => taskOut(ws, t)) };
    } },
  { name: 'get_task', risk: 'read', description: 'Full details of one task, including description, acceptance criteria and its recent activity and comments.', parameters: obj({ task: TASK_REF }, ['task']),
    run: (ctx, a) => {
      const t = findTask(ctx.ws, a.task);
      const acts = db.prepare('SELECT actor, kind, message, created_at FROM activity WHERE task_id = ? ORDER BY created_at DESC LIMIT 12').all(t.id);
      return { ...taskOut(ctx.ws, t, { full: true }), activity: acts };
    } },
  { name: 'list_agents', risk: 'read', description: 'All coding agents with their role, tool, status (online / idle / paused / not paired) and current load.', parameters: obj(),
    run: (ctx) => ({ agents: agents(ctx.ws).map((a) => agentOut(ctx.ws, a)) }) },
  { name: 'get_agent', risk: 'read', description: 'One agent in detail, with personality and its open tasks.', parameters: obj({ agent: AGENT_REF }, ['agent']),
    run: (ctx, a) => {
      const ag = findAgent(ctx.ws, a.agent);
      return { ...agentOut(ctx.ws, ag), personality: ag.personality, client: ag.client_name, tasks: tasks(ctx.ws).filter((t) => t.assignee_id === ag.id && t.status !== 'done').map((t) => taskOut(ctx.ws, t)) };
    } },
  { name: 'list_projects', risk: 'read', description: 'All projects (boards) with open task counts.', parameters: obj(),
    run: (ctx) => { const all = tasks(ctx.ws); return { projects: boards(ctx.ws).map((b) => ({ name: b.name, repo: b.repo, description: b.description, open_tasks: all.filter((t) => t.board_id === b.id && t.status !== 'done').length, done: all.filter((t) => t.board_id === b.id && t.status === 'done').length })) }; } },
  { name: 'list_automations', risk: 'read', description: 'All automations (digests, batch sends, reminders, stale check-ins).', parameters: obj(),
    run: (ctx) => ({ automations: autos(ctx.ws).map(autoOut) }) },
  { name: 'get_analytics', risk: 'read', description: 'Delivery metrics for a period: tasks created and shipped, median cycle time, pickup time, on-time rate, and per-agent numbers, compared with the previous period.', parameters: obj({ days: N('7, 14, 30 or 90 (default 7)') }),
    run: async (ctx, a) => {
      const days = [7, 14, 30, 90].includes(+a.days) ? +a.days : 7;
      const j = await api(ctx, 'GET', `/analytics?days=${days}`);
      return { days, totals: j.totals, previous_period: j.previous, per_agent: (j.per_agent || []).map((p) => ({ agent: p.name, completed: p.completed, open: p.open, cycle_h: p.cycle_h, events: p.events })), open: j.open, priorities: j.priorities };
    } },
  { name: 'get_recent_activity', risk: 'read', description: 'The latest events in the workspace (or for one task): status changes, comments, dispatches, agent updates.', parameters: obj({ task: S('Optional task key or title'), limit: N('Max events (default 15, max 50)') }),
    run: (ctx, a) => {
      const limit = Math.min(50, Math.max(1, +a.limit || 15));
      const rows = a.task ? db.prepare('SELECT actor, kind, message, created_at FROM activity WHERE task_id = ? ORDER BY created_at DESC LIMIT ?').all(findTask(ctx.ws, a.task).id, limit)
        : db.prepare('SELECT actor, kind, message, created_at FROM activity WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(ctx.ws, limit);
      return { events: rows };
    } },
  { name: 'get_settings', risk: 'read', description: 'Workspace settings: routing strategy, sending policy per priority, timezone, pairing requirement.', parameters: obj(),
    run: (ctx) => { const s = getSettings(ctx.ws); return { routing: s.routing, preset: s.preset, policy: s.policy, timezone: s.timezone, require_pairing: s.require_pairing !== false, key_prefix: s.key_prefix, description: s.description }; } },

  /* ---------- write ---------- */
  { name: 'create_task', risk: 'write', description: 'Create a task. If no project is given the first project is used. agent may be a name, "auto" (let routing pick) or omitted (unassigned).', parameters: obj({
      title: S('Short outcome-focused title'), description: S('Details, context, links'), acceptance: S('Acceptance criteria — what done looks like'),
      priority: S('Default medium', { enum: PRIO }), project: S('Project (board) name'), agent: S('Agent name/handle or "auto"'),
      send: S('policy = follow the sending policy (default), now = send immediately, hold = keep in backlog, schedule = send at scheduled_at', { enum: ['policy', 'now', 'hold', 'schedule'] }),
      scheduled_at: S('ISO 8601 date-time, required when send is schedule'), deadline: S('ISO 8601 date-time'), tags: A('Short tags'),
    }, ['title']),
    run: async (ctx, a) => {
      const ws = ctx.ws; const b = findBoard(ws, a.project);
      const body = { title: a.title, description: a.description || '', acceptance: a.acceptance || '', priority: PRIO.includes(a.priority) ? a.priority : 'medium', board_id: b.id, tags: a.tags || [] };
      if (a.agent) { if (norm(a.agent) === 'auto') body.auto_route = true; else body.assignee_id = findAgent(ws, a.agent).id; }
      body.start_mode = { now: 'now', hold: 'manual', schedule: 'scheduled' }[a.send] || 'policy';
      if (body.start_mode === 'scheduled') body.scheduled_at = isoOrNull(a.scheduled_at, 'scheduled_at') || fail('scheduled_at is required to schedule');
      if (a.deadline) body.deadline = isoOrNull(a.deadline, 'deadline');
      const t = await api(ctx, 'POST', '/tasks', body);
      return { result: { created: taskOut(ws, t) }, summary: `${prefix(ws)}-${t.number} · ${t.title}`, client: focus(t) };
    } },
  { name: 'update_task', risk: 'write', description: 'Edit a task\'s fields. Only pass what changes. Use "none" to clear the deadline.', parameters: obj({
      task: TASK_REF, title: S('New title'), description: S('New description'), acceptance: S('New acceptance criteria'), priority: S('Priority', { enum: PRIO }),
      deadline: S('ISO 8601 date-time, or "none"'), tags: A('Replace tags'), project: S('Move to this project'), progress: N('0–100'),
    }, ['task']),
    run: async (ctx, a) => {
      const ws = ctx.ws; const t = findTask(ws, a.task); const body = {};
      for (const k of ['title', 'description', 'acceptance']) if (a[k] != null) body[k] = a[k];
      if (a.priority) body.priority = a.priority;
      if (a.deadline !== undefined) body.deadline = isoOrNull(a.deadline, 'deadline');
      if (a.tags) body.tags = a.tags;
      if (a.project) body.board_id = findBoard(ws, a.project).id;
      if (a.progress != null) body.progress = a.progress;
      if (!Object.keys(body).length) fail('Nothing to change.');
      const n = await api(ctx, 'PATCH', `/tasks/${t.id}`, body);
      return { result: { updated: taskOut(ws, n), changed: Object.keys(body) }, summary: `${prefix(ws)}-${n.number} · ${Object.keys(body).join(', ')}`, client: focus(n) };
    } },
  { name: 'move_task', risk: (a) => (a.status === 'done' ? 'risky' : 'write'), description: 'Move a task to another column. Moving to queued sends it to its agent. Moving to done counts as approving it.', parameters: obj({ task: TASK_REF, status: S('Target column', { enum: STATUS }) }, ['task', 'status']),
    confirm: (ctx, a) => `Move ${refText(ctx, a.task)} to ${STATUS_LABEL[a.status] || a.status}`,
    run: async (ctx, a) => {
      if (!STATUS.includes(a.status)) fail(`status must be one of ${STATUS.join(', ')}`);
      const t = findTask(ctx.ws, a.task); const n = await api(ctx, 'PATCH', `/tasks/${t.id}`, { status: a.status });
      return { result: { moved: taskOut(ctx.ws, n) }, summary: `${prefix(ctx.ws)}-${n.number} → ${STATUS_LABEL[n.status]}`, client: focus(n) };
    } },
  { name: 'assign_task', risk: 'write', description: 'Assign a task to an agent, to "auto" (routing picks) or "none" (unassign).', parameters: obj({ task: TASK_REF, agent: S('Agent name/handle, "auto" or "none"') }, ['task', 'agent']),
    run: async (ctx, a) => {
      const ws = ctx.ws; const t = findTask(ws, a.task); const q = norm(a.agent);
      const body = q === 'auto' ? { assignee_id: null, auto_route: true } : ['none', 'nobody', 'unassigned'].includes(q) ? { assignee_id: null, auto_route: false } : { assignee_id: findAgent(ws, a.agent).id, auto_route: false };
      const n = await api(ctx, 'PATCH', `/tasks/${t.id}`, body);
      return { result: { assigned: taskOut(ws, n) }, summary: `${prefix(ws)}-${n.number} → ${taskOut(ws, n).agent}`, client: focus(n) };
    } },
  { name: 'send_task', risk: 'write', description: 'Send a backlog task to its agent right now, ignoring the sending policy. Unassigned tasks are auto-routed.', parameters: obj({ task: TASK_REF }, ['task']),
    run: async (ctx, a) => {
      const t = findTask(ctx.ws, a.task);
      if (t.status !== 'backlog') fail(`${prefix(ctx.ws)}-${t.number} is already ${STATUS_LABEL[t.status]}.`);
      const n = await api(ctx, 'POST', `/tasks/${t.id}/start`);
      return { result: { sent: taskOut(ctx.ws, n) }, summary: `${prefix(ctx.ws)}-${n.number} sent to ${taskOut(ctx.ws, n).agent}`, client: focus(n) };
    } },
  { name: 'comment_on_task', risk: 'write', description: 'Post a comment on a task. If an agent is working on it, the comment lands in its inbox.', parameters: obj({ task: TASK_REF, message: S('The comment') }, ['task', 'message']),
    run: async (ctx, a) => {
      const t = findTask(ctx.ws, a.task); await api(ctx, 'POST', `/tasks/${t.id}/comments`, { message: a.message });
      return { result: { ok: true }, summary: `Comment on ${prefix(ctx.ws)}-${t.number}`, client: focus(t) };
    } },
  { name: 'request_changes', risk: 'write', description: 'Send a task in Review back to In progress with feedback for the agent.', parameters: obj({ task: TASK_REF, feedback: S('What needs to change') }, ['task', 'feedback']),
    run: async (ctx, a) => {
      const t = findTask(ctx.ws, a.task);
      await api(ctx, 'POST', `/tasks/${t.id}/comments`, { message: a.feedback });
      const n = await api(ctx, 'PATCH', `/tasks/${t.id}`, { status: 'in_progress' });
      return { result: { returned: taskOut(ctx.ws, n) }, summary: `${prefix(ctx.ws)}-${n.number} back to In progress`, client: focus(n) };
    } },
  { name: 'create_project', risk: 'write', description: 'Create a new project (board).', parameters: obj({ name: S('Project name'), description: S('What it is'), repo: S('Repository URL or path') }, ['name']),
    run: async (ctx, a) => { const b = await api(ctx, 'POST', '/boards', { name: a.name, description: a.description || '', repo: a.repo || '' }); return { result: { created: b.name }, summary: b.name, client: { navigate: `#/board/${b.id}` } }; } },
  { name: 'create_agent', risk: 'write', description: 'Add a coding agent. It gets its own token; the user still has to connect and pair it from the Agents page.', parameters: obj({
      name: S('Agent name'), role: S('e.g. Frontend engineer'), tool: S('Coding tool it runs in', { enum: PROVIDERS }), skills: A('Skills used for routing, e.g. react, sql'), personality: S('How it should behave'), max_concurrent: N('Max tasks at once (1–20, default 3)'),
    }, ['name']),
    run: async (ctx, a) => {
      const body = { name: a.name, role: a.role || '', provider: PROVIDERS.includes(a.tool) ? a.tool : 'claude-code', skills: a.skills || [], personality: a.personality || '' };
      if (a.max_concurrent) body.max_concurrent = a.max_concurrent;
      const ag = await api(ctx, 'POST', '/agents', body);
      return { result: { created: ag.name, handle: ag.handle, next_step: 'Open Agents → Connect to set it up in the coding tool.' }, summary: `${ag.name} (@${ag.handle})`, client: { navigate: '#/agents' } };
    } },
  { name: 'update_agent', risk: 'write', description: 'Change an agent\'s profile, pause it or resume it.', parameters: obj({
      agent: AGENT_REF, name: S('New name'), role: S('New role'), skills: A('Replace skills'), personality: S('New personality'), system_prompt: S('New system prompt'), max_concurrent: N('1–20'), paused: B('true pauses (receives nothing), false resumes'),
    }, ['agent']),
    run: async (ctx, a) => {
      const ag = findAgent(ctx.ws, a.agent); const body = {};
      for (const k of ['name', 'role', 'skills', 'personality', 'system_prompt', 'max_concurrent', 'paused']) if (a[k] != null) body[k] = a[k];
      if (!Object.keys(body).length) fail('Nothing to change.');
      const n = await api(ctx, 'PATCH', `/agents/${ag.id}`, body);
      return { result: { updated: agentOut(ctx.ws, hydrate.agent(db.prepare('SELECT * FROM agents WHERE id = ?').get(n.id))), changed: Object.keys(body) }, summary: `${n.name} · ${Object.keys(body).join(', ')}` };
    } },
  { name: 'create_automation', risk: 'write', description: 'Create a scheduled automation. days are 0=Sun … 6=Sat. hours applies to deadline_reminder (due within N hours) and stale_nudge (quiet for N hours).', parameters: obj({
      kind: S('daily_digest = summary to each agent, dispatch_batch = send waiting backlog, deadline_reminder, stale_nudge', { enum: KINDS }), name: S('Optional name'), time: S('HH:MM in workspace time, default 09:00'),
      days: A('Days of week 0–6, default weekdays', { type: 'number' }), agents: A('Agent names; empty = all agents'), priorities: A('Priorities; empty = all', { type: 'string', enum: PRIO }), hours: N('Hours window'),
    }, ['kind']),
    run: async (ctx, a) => {
      const LABEL = { daily_digest: 'Daily digest', dispatch_batch: 'Batch send', deadline_reminder: 'Deadline reminder', stale_nudge: 'Stale check-in' };
      const body = { kind: a.kind, name: a.name || LABEL[a.kind], time: a.time || '09:00', days: a.days?.length ? a.days : [1, 2, 3, 4, 5], agent_ids: (a.agents || []).map((n) => findAgent(ctx.ws, n).id), priorities: a.priorities?.length ? a.priorities : PRIO, params: { hours: +a.hours || 24 }, enabled: true };
      const au = await api(ctx, 'POST', '/automations', body);
      return { result: { created: autoOut(au) }, summary: au.name, client: { navigate: '#/automations' } };
    } },
  { name: 'update_automation', risk: 'write', description: 'Turn an automation on/off or change its schedule.', parameters: obj({ automation: S('Automation name'), enabled: B('On or off'), time: S('HH:MM'), days: A('0–6', { type: 'number' }), name: S('New name') }, ['automation']),
    run: async (ctx, a) => {
      const au = findAuto(ctx.ws, a.automation); const body = {};
      for (const k of ['enabled', 'time', 'days', 'name']) if (a[k] != null) body[k] = a[k];
      if (!Object.keys(body).length) fail('Nothing to change.');
      const n = await api(ctx, 'PATCH', `/automations/${au.id}`, body);
      return { result: { updated: autoOut(n) }, summary: `${n.name} · ${Object.keys(body).join(', ')}` };
    } },
  { name: 'run_automation', risk: 'write', description: 'Run an automation once, right now.', parameters: obj({ automation: S('Automation name') }, ['automation']),
    run: async (ctx, a) => { const au = findAuto(ctx.ws, a.automation); const r = await api(ctx, 'POST', `/automations/${au.id}/run`); return { result: r, summary: `Ran ${au.name}` }; } },

  /* ---------- risky (confirmation required) ---------- */
  { name: 'approve_task', risk: 'risky', description: 'Approve a task in Review and move it to Done.', parameters: obj({ task: TASK_REF }, ['task']),
    confirm: (ctx, a) => `Approve ${refText(ctx, a.task)} and move it to Done`,
    run: async (ctx, a) => { const t = findTask(ctx.ws, a.task); const n = await api(ctx, 'PATCH', `/tasks/${t.id}`, { status: 'done' }); return { result: { approved: taskOut(ctx.ws, n) }, summary: `${prefix(ctx.ws)}-${n.number} approved`, client: focus(n) }; } },
  { name: 'delete_task', risk: 'risky', description: 'Permanently delete a task.', parameters: obj({ task: TASK_REF }, ['task']),
    confirm: (ctx, a) => `Delete ${refText(ctx, a.task)}`,
    run: async (ctx, a) => { const t = findTask(ctx.ws, a.task); await api(ctx, 'DELETE', `/tasks/${t.id}`); return { result: { deleted: `${prefix(ctx.ws)}-${t.number} ${t.title}` }, summary: `Deleted ${prefix(ctx.ws)}-${t.number}` }; } },
  { name: 'list_agent_files', risk: 'read', description: 'Personal reference files attached to an agent (context notes, style guides it can fetch while working).', parameters: obj({ agent: AGENT_REF }, ['agent']),
    run: async (ctx, a) => {
      const ag = findAgent(ctx.ws, a.agent);
      const rows = await api(ctx, 'GET', `/agents/${ag.id}/files`);
      return { result: rows.length ? rows.map((r) => ({ name: r.name, chars: r.content.length })) : 'none', summary: `${rows.length} file${rows.length === 1 ? '' : 's'} on ${ag.name}` };
    } },
  { name: 'save_agent_file', risk: 'write', description: 'Create or replace a reference file attached to an agent (notes, style guides — the agent reads it via its get_files tool and its skill zip). Max 50,000 characters.', parameters: obj({ agent: AGENT_REF, name: S('File name, e.g. architecture.md'), content: S('Full file contents') }, ['agent', 'name', 'content']),
    run: async (ctx, a) => {
      const ag = findAgent(ctx.ws, a.agent);
      await api(ctx, 'PUT', `/agents/${ag.id}/files/${encodeURIComponent(a.name)}`, { content: a.content || '' });
      return { result: { saved: a.name, agent: ag.name }, summary: `Saved ${a.name} on ${ag.name}` };
    } },
  { name: 'delete_agent_file', risk: 'risky', description: 'Delete a reference file from an agent.', parameters: obj({ agent: AGENT_REF, name: S('File name') }, ['agent', 'name']),
    run: async (ctx, a) => {
      const ag = findAgent(ctx.ws, a.agent);
      await api(ctx, 'DELETE', `/agents/${ag.id}/files/${encodeURIComponent(a.name)}`);
      return { result: { deleted: a.name, agent: ag.name }, summary: `Deleted ${a.name} from ${ag.name}` };
    } },
  { name: 'delete_agent', risk: 'risky', description: 'Remove an agent. Its token stops working and its open tasks become unassigned.', parameters: obj({ agent: AGENT_REF }, ['agent']),
    confirm: (ctx, a) => { try { return `Remove agent ${findAgent(ctx.ws, a.agent).name}`; } catch { return `Remove agent ${a.agent}`; } },
    run: async (ctx, a) => { const ag = findAgent(ctx.ws, a.agent); await api(ctx, 'DELETE', `/agents/${ag.id}`); return { result: { removed: ag.name }, summary: `Removed ${ag.name}` }; } },
  { name: 'delete_project', risk: 'risky', description: 'Delete a project (board) and all its tasks.', parameters: obj({ project: S('Project name') }, ['project']),
    confirm: (ctx, a) => { try { const b = findBoard(ctx.ws, a.project); return `Delete project “${b.name}” and its ${tasks(ctx.ws).filter((t) => t.board_id === b.id).length} tasks`; } catch { return `Delete project ${a.project}`; } },
    run: async (ctx, a) => { const b = findBoard(ctx.ws, a.project); await api(ctx, 'DELETE', `/boards/${b.id}`); return { result: { deleted: b.name }, summary: `Deleted ${b.name}`, client: { navigate: '#/' } }; } },
  { name: 'delete_automation', risk: 'risky', description: 'Delete an automation.', parameters: obj({ automation: S('Automation name') }, ['automation']),
    confirm: (ctx, a) => `Delete automation “${a.automation}”`,
    run: async (ctx, a) => { const au = findAuto(ctx.ws, a.automation); await api(ctx, 'DELETE', `/automations/${au.id}`); return { result: { deleted: au.name }, summary: `Deleted ${au.name}` }; } },
  { name: 'update_settings', risk: 'risky', description: 'Change workspace settings: routing strategy, sending preset, pairing requirement or timezone.', parameters: obj({
      routing: S('How Auto picks agents', { enum: ['smart', 'least_loaded', 'round_robin'] }), preset: S('Sending policy preset', { enum: ['fast', 'balanced', 'hands_on'] }), require_pairing: B('Require pairing codes for new agents'), timezone: S('IANA timezone, e.g. Asia/Kolkata'),
    }),
    confirm: (ctx, a) => `Change settings: ${Object.entries(a).filter(([k]) => k !== 'confirmed').map(([k, v]) => `${k.replace('_', ' ')} → ${v}`).join(', ')}`,
    run: async (ctx, a) => {
      const body = {}; for (const k of ['routing', 'preset', 'require_pairing', 'timezone']) if (a[k] != null) body[k] = a[k];
      if (!Object.keys(body).length) fail('Nothing to change.');
      const s = await api(ctx, 'PATCH', '/settings', body);
      return { result: { routing: s.routing, preset: s.preset, require_pairing: s.require_pairing, timezone: s.timezone }, summary: Object.keys(body).join(', ') };
    } },

  /* ---------- UI ---------- */
  { name: 'open_page', risk: 'read', description: 'Show something on the user\'s screen: a page, a project board, or a specific task. Use it whenever the user asks to see or open something, or when showing your work helps.', parameters: obj({ page: S('Page to open', { enum: PAGES }), project: S('Project name, for page=board'), task: S('Task key or title to open in the side drawer') }, ['page']),
    run: (ctx, a) => {
      if (a.task) { const t = findTask(ctx.ws, a.task); return { result: { opened: `${prefix(ctx.ws)}-${t.number}` }, summary: `${prefix(ctx.ws)}-${t.number}`, client: { navigate: `#/board/${t.board_id}?task=${t.id}` } }; }
      const map = { overview: '#/', boards: '#/boards', agents: '#/agents', analytics: '#/analytics', automations: '#/automations', activity: '#/activity', settings: '#/settings', docs: '#/docs' };
      if (a.page === 'board') { const b = findBoard(ctx.ws, a.project); return { result: { opened: b.name }, summary: b.name, client: { navigate: `#/board/${b.id}` } }; }
      if (!map[a.page]) fail(`page must be one of ${PAGES.join(', ')}`);
      return { result: { opened: a.page }, summary: a.page, client: { navigate: map[a.page] } };
    } },
/* ---------- local runners ---------- */
  { name: 'list_runners', risk: 'read', description: 'Local runners registered for this workspace (a small Node script on the user\'s own computer that can start agent CLIs locally). Shows online/offline status, label, cwd and capacity.', parameters: obj(),
    run: async (ctx) => {
      const rows = await api(ctx, 'GET', '/runners');
      return rows.length ? { runners: rows.map((r) => ({ name: r.name, online: r.online, label: r.label, platform: r.platform, cwd: r.cwd, max_concurrent: r.max_concurrent, last_seen: r.last_seen_at })) } : 'No local runners yet — the user can set one up in assign → Agents → Runners.';
    } },
  { name: 'list_local_runs', risk: 'read', description: 'Local runner sessions: which tasks a runner is executing on the user\'s machine, with status (queued/running/done/failed/stopped), live output tail and exit code.', parameters: obj({ only_active: B('Only sessions still running/queued (default false)') }),
    run: async (ctx, a) => {
      let rows = await api(ctx, 'GET', '/runner-sessions');
      if (a.only_active) rows = rows.filter((r) => ['queued', 'waiting', 'assigned', 'running', 'stopping'].includes(r.status));
      return rows.length ? { sessions: rows.slice(0, 20).map((r) => ({ id: r.id, task: r.task_id, cmd: r.cmd, status: r.status, exit_code: r.exit_code, started: r.started_at, ended: r.ended_at })) } : 'No local runs yet.';
    } },
  { name: 'run_task_on_runner', risk: 'risky', description: 'Start a task on a LOCAL runner on the user\'s own computer: the runner spawns the assigned agent\'s CLI (claude / codex / gemini…) in its working folder and streams output live back to assign. Only when the user asks for local execution.', parameters: obj({ task: TASK_REF, runner: S('Runner name (omit to use the only online runner)') }, ['task']),
    confirm: (ctx, a) => { const t = findTask(ctx.ws, a.task); return `Start ${prefix(ctx.ws)}-${t.number} on a local runner (runs processes on this computer)`; },
    run: async (ctx, a) => {
      const t = findTask(ctx.ws, a.task);
      const runners = await api(ctx, 'GET', '/runners');
      let r = runners.find((x) => x.online);
      if (a.runner) r = runners.find((x) => norm(x.name) === norm(a.runner)) || r;
      if (!r) fail('No runner is online. Ask the user to start the runner on their machine (assign → Agents → Runners has the command).');
      const s = await api(ctx, 'POST', `/runners/${r.id}/run-task`, { task_id: t.id });
      return { result: { started: prefix(ctx.ws) + '-' + t.number, on: r.name, status: s.status }, summary: `${prefix(ctx.ws)}-${t.number} started on ${r.name}` };
    } },
  { name: 'stop_local_run', risk: 'risky', description: 'Stop a running local runner session (sends SIGTERM).', parameters: obj({ session: S('Session id, e.g. rs_… (see list_local_runs)') }, ['session']),
    run: async (ctx, a) => { const s = await api(ctx, 'POST', `/runner-sessions/${encodeURIComponent(a.session)}/stop`); return { result: { stopped: a.session, status: s.status }, summary: 'Local run stopping' }; } },
  { name: 'get_run_output', risk: 'read', description: 'Live console output of a local runner session (what the agent CLI is printing right now).', parameters: obj({ session: S('Session id, e.g. rs_…') , tail_chars: N('Tail of output to return (default 4000)') }, ['session']),
    run: async (ctx, a) => { const s = await api(ctx, 'GET', `/runner-sessions/${encodeURIComponent(a.session)}/output`); const n = Math.min(12000, Math.max(500, +a.tail_chars || 4000)); return { status: s.status, cmd: s.cmd, output: (s.output || '').slice(-n) }; } },
  /* ---------- long-term memory ---------- */
  { name: 'remember', risk: 'write', description: 'Save a durable fact about the user or their workspace to long-term memory (MEMORY.md / memory.json). Use when the user states a preference, project context, a person, or anything worth recalling later. Do not re-ask what is already remembered.', parameters: obj({
      kind: S('Memory kind', { enum: ['fact', 'preference', 'project', 'person', 'note'] }),
      title: S('Short title (a few words)'),
      content: S('Longer detail, optional'),
    }, ['title']),
    run: async (ctx, a) => {
      let learn = true;
      try { const s = await api(ctx, 'GET', '/settings'); learn = s?.ai?.memory_learn !== false; } catch { learn = true; }
      if (!learn) return { result: { skipped: true, reason: 'Auto-learn is off in Settings → AI' }, summary: 'Memory auto-learn is disabled' };
      const m = await api(ctx, 'POST', '/memory', { kind: a.kind || 'fact', title: a.title, content: a.content || '' });
      return { result: { saved: m.title, kind: m.kind, id: m.id }, summary: `Remembered: ${m.title}` };
    } },
  { name: 'forget_memory', risk: 'write', description: 'Delete a memory by id. Use when the user asks you to forget something.', parameters: obj({ id: S('Memory id (m_…)') }, ['id']),
    run: async (ctx, a) => { await api(ctx, 'DELETE', `/memory/${encodeURIComponent(a.id)}`); return { result: { deleted: a.id }, summary: 'Forgot that' }; } },
  { name: 'list_memory', risk: 'read', description: 'List what is remembered about the user. Use before asking questions you might already know the answer to.', parameters: obj({ kind: S('Optional kind filter: fact, preference, project, person, note') }),
    run: async (ctx, a) => { const r = await api(ctx, 'GET', `/memory${a.kind ? `?kind=${encodeURIComponent(a.kind)}` : ''}`); return { memories: r.memories || [], count: (r.memories || []).length }; } },
];
const BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

function refText(ctx, ref) { try { const t = findTask(ctx.ws, ref); return `${prefix(ctx.ws)}-${t.number} “${t.title}”`; } catch { return String(ref); } }
export const riskOf = (name, args = {}) => { const t = BY_NAME[name]; if (!t) return 'write'; return typeof t.risk === 'function' ? t.risk(args) : t.risk; };
export function confirmText(ctx, name, args) { const t = BY_NAME[name]; return t?.confirm ? t.confirm(ctx, args) : `${name.replace(/_/g, ' ')}`; }

/** Declarations for the model. voice=true adds a `confirmed` flag to risky tools (spoken confirmation). */
export function declarations({ voice = false } = {}) {
  return TOOLS.map((t) => {
    const params = JSON.parse(JSON.stringify(t.parameters));
    const mayBeRisky = t.risk === 'risky' || typeof t.risk === 'function';
    if (voice && mayBeRisky) params.properties.confirmed = B('Set true ONLY after the user clearly said yes to this exact action in this conversation.');
    return { name: t.name, description: t.description + (mayBeRisky ? ' Requires the user\'s confirmation.' : ''), parameters: params };
  });
}

/** Execute one tool. Returns { ok, result, summary?, client?, needs_confirmation?, error? } */
export async function execTool(ctx, name, args = {}, { confirmed = false } = {}) {
  const t = BY_NAME[name];
  if (!t) return { ok: false, error: `Unknown tool ${name}` };
  const risky = riskOf(name, args) === 'risky' && ctx.confirmRisky !== false;
  if (risky && !confirmed) return { ok: false, needs_confirmation: true, confirm: confirmText(ctx, name, args), error: 'This action needs the user\'s confirmation first.' };
  try {
    const out = await t.run(ctx, args || {});
    if (out && typeof out === 'object' && 'result' in out) return { ok: true, ...out };
    return { ok: true, result: out };
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, error: e.message };
    console.error('[ai tool]', name, e);
    return { ok: false, error: 'Something went wrong running that action.' };
  }
}
