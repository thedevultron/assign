// Dependency-free MCP server (Streamable HTTP transport, JSON responses).
// Spec: https://modelcontextprotocol.io — initialize, ping, tools/*, prompts/*.
// Every agent token belongs to exactly one workspace; every query below is scoped to it.
import crypto from 'node:crypto';
import { db, now, uid, hydrate, nextTaskNumber, getWorkspace } from './db.js';
import { getTask, getAgent, logActivity, emit, emitTask, taskBrief, keyOf, claimTask, branchFor, publicAgent, isPaired, STATUSES, PRIORITIES, PRIO_ORDER, applyStartPolicy } from './core.js';
import { CLIENTS, detectProvider, serverKey, clientLabel } from './skill.js';

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

export function persona(agent) {
  const ws = getWorkspace(agent.workspace_id);
  const client = clientLabel(agent) || 'an MCP client';
  return [
    `You are ${agent.name} (@${agent.handle}), an AI coding agent on the "${ws?.name || 'assign'}" board in assign, running in ${client}.`,
    agent.role ? `Role: ${agent.role}.` : '',
    agent.personality ? `Personality: ${agent.personality}` : '',
    agent.skills?.length ? `Strengths: ${agent.skills.join(', ')}.` : '',
    agent.system_prompt ? `\n${agent.system_prompt}` : '',
    `\nWorkflow: call get_next_task to claim work, check out the branch it gives you (prefix ${agent.handle}/), post progress with update_task / add_comment, call get_files for reference files your human attached to you, and finish with complete_task. You can only change tasks you own — other agents on this board own theirs. Check check_inbox for digests and reminders.`,
  ].filter(Boolean).join('\n');
}

const fmt = (ws, t) => t && ({
  id: t.id, key: keyOf(ws, t), title: t.title, status: t.status, priority: t.priority, progress: t.progress,
  deadline: t.deadline, scheduled_at: t.scheduled_at, tags: t.tags, repo: t.repo, branch: t.branch,
  description: t.description, acceptance: t.acceptance, assignee_id: t.assignee_id, board_id: t.board_id,
});

const TID = { task_id: { type: 'string', description: 'Task id or key, e.g. ASG-12' } };
const TOOLS = [
  { name: 'whoami', description: 'Return your agent profile, persona and the board rules. Call once at the start of a session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_tasks', description: 'List tasks. Defaults to open tasks assigned to you.', inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['mine', 'unassigned', 'all'], default: 'mine' }, status: { type: 'string', enum: STATUSES }, limit: { type: 'number', default: 25 } } } },
  { name: 'get_next_task', description: 'Atomically claim your highest-priority queued task. Moves it to In progress and returns the brief and branch name.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_task', description: 'Full details and recent activity for a task.', inputSchema: { type: 'object', properties: TID, required: ['task_id'] } },
  { name: 'claim_task', description: 'Claim an unassigned task for yourself. Fails if another agent owns it.', inputSchema: { type: 'object', properties: TID, required: ['task_id'] } },
  { name: 'start_task', description: 'Move one of your tasks to In progress.', inputSchema: { type: 'object', properties: TID, required: ['task_id'] } },
  { name: 'update_task', description: 'Update status and/or progress (0-100) of a task you own, optionally with a note.', inputSchema: { type: 'object', properties: { ...TID, status: { type: 'string', enum: STATUSES }, progress: { type: 'number', minimum: 0, maximum: 100 }, note: { type: 'string' } }, required: ['task_id'] } },
  { name: 'add_comment', description: 'Post a comment on a task you own (visible to humans on the board).', inputSchema: { type: 'object', properties: { ...TID, message: { type: 'string' } }, required: ['task_id', 'message'] } },
  { name: 'complete_task', description: 'Finish a task you own with a summary. Goes to Review by default, or Done if needs_review is false.', inputSchema: { type: 'object', properties: { ...TID, summary: { type: 'string' }, needs_review: { type: 'boolean', default: true } }, required: ['task_id', 'summary'] } },
  { name: 'release_task', description: 'Give a task back (unassign it and return it to Backlog) with a reason, e.g. when blocked.', inputSchema: { type: 'object', properties: { ...TID, reason: { type: 'string' } }, required: ['task_id', 'reason'] } },
  { name: 'create_task', description: 'Create a follow-up task on a board.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string', enum: PRIORITIES, default: 'medium' }, board_id: { type: 'string' }, assign_to_self: { type: 'boolean', default: false } }, required: ['title'] } },
  { name: 'check_inbox', description: 'Read dispatches, daily digests, reminders and comments sent to you.', inputSchema: { type: 'object', properties: { unread_only: { type: 'boolean', default: true } } } },
  { name: 'get_files', description: 'Your personal reference files the human attached to you in assign (style guides, architecture notes). Returns name + contents.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_boards', description: 'List boards in this workspace.', inputSchema: { type: 'object', properties: {} } },
];

const ok = (data, text) => ({ content: [{ type: 'text', text: text ?? JSON.stringify(data, null, 2) }], structuredContent: Array.isArray(data) ? { items: data } : data });
const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });
class ToolError extends Error {}

/** Resolve a task the agent is allowed to change: owned by them, or unassigned (then atomically claimed). */
function ownTask(agent, id, verb = 'change') {
  const ws = agent.workspace_id;
  const t = getTask(ws, id);
  if (!t) throw new ToolError(`Task ${id} not found on this board.`);
  if (t.assignee_id === agent.id) return t;
  if (t.assignee_id) {
    const owner = getAgent(ws, t.assignee_id);
    throw new ToolError(`You can't ${verb} ${keyOf(ws, t)} — it's owned by @${owner?.handle || 'another agent'}${owner ? ` (${clientLabel(owner)})` : ''}. Pick up your own work with get_next_task.`);
  }
  if (t.status === 'done') throw new ToolError(`${keyOf(ws, t)} is already done.`);
  const r = claimTask(ws, agent, t.id, { from: ['backlog', 'queued', 'in_progress', 'review'] });
  if (!r.ok) throw new ToolError(r.error);
  logActivity(ws, { task_id: t.id, agent_id: agent.id, actor: 'agent', kind: 'assign', message: `${agent.name} claimed ${keyOf(ws, t)}` });
  return r.task;
}

function setStatus(agent, t, status, extra = {}) {
  const ws = agent.workspace_id;
  const ts = now();
  const fields = { status, updated_at: ts, ...extra };
  if (status === 'in_progress' && !t.started_at) fields.started_at = ts;
  if (status === 'done') { fields.completed_at = ts; fields.progress = 100; }
  if (status !== 'done' && t.status === 'done') fields.completed_at = null;
  if (!t.branch) fields.branch = branchFor(agent, t);
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE tasks SET ${sets} WHERE id = @id AND workspace_id = @ws AND assignee_id = @agent`).run({ ...fields, id: t.id, ws, agent: agent.id });
  return emitTask(ws, t.id);
}

const claimNext = db.transaction((agent) => {
  const ws = agent.workspace_id;
  const row = db.prepare(`SELECT * FROM tasks WHERE workspace_id = ? AND assignee_id = ? AND status = 'queued' ORDER BY ${PRIO_ORDER}, deadline IS NULL, deadline, dispatched_at LIMIT 1`).get(ws, agent.id);
  if (!row) return null;
  const ts = now();
  const branch = row.branch || branchFor(agent, row);
  const r = db.prepare("UPDATE tasks SET status = 'in_progress', claimed_at = COALESCE(claimed_at, @ts), started_at = COALESCE(started_at, @ts), progress = MAX(progress, 5), branch = @branch, updated_at = @ts WHERE id = @id AND assignee_id = @agent AND status = 'queued'").run({ ts, branch, id: row.id, agent: agent.id });
  return r.changes === 1 ? row.id : null;
});


const PAIR_TTL = 15 * 60e3;
/** Return the agent's live pairing code, minting a fresh one when needed. */
function pairCode(agent) {
  const row = db.prepare('SELECT pair_code, pair_expires_at FROM agents WHERE id = ?').get(agent.id);
  if (row?.pair_code && row.pair_expires_at && Date.parse(row.pair_expires_at) > Date.now() + 60e3) return row.pair_code;
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  db.prepare('UPDATE agents SET pair_code = ?, pair_expires_at = ?, pair_attempts = 0, pair_client = ? WHERE id = ?')
    .run(code, new Date(Date.now() + PAIR_TTL).toISOString(), agent.client_name || '', agent.id);
  logActivity(agent.workspace_id, { agent_id: agent.id, actor: 'agent', kind: 'connect', message: `${agent.name} asked to pair${agent.client_name ? ` from ${agent.client_name}` : ''}` });
  emit(agent.workspace_id, 'agent', publicAgent(getAgent(agent.workspace_id, agent.id)));
  return code;
}
const pairText = (agent, code) => [
  `PAIRING REQUIRED — ${agent.name} (@${agent.handle}) is not paired with the board yet.`,
  ``,
  `Tell the user, word for word:`,
  `  "To pair me with assign, open Agents → ${agent.name} → Connect and enter code ${code.slice(0, 3)} ${code.slice(3)}."`,
  ``,
  `The code expires in 15 minutes. After the user enters it, call whoami again and continue. Do not try to guess or brute-force the code.`,
].join('\n');

const handlers = {
  whoami: (agent) => {
    const others = db.prepare('SELECT name, handle, provider, provider_label FROM agents WHERE workspace_id = ? AND id != ?').all(agent.workspace_id, agent.id);
    return ok({ id: agent.id, name: agent.name, handle: agent.handle, provider: agent.provider, server_key: serverKey(agent), role: agent.role, personality: agent.personality, system_prompt: agent.system_prompt, skills: agent.skills, teammates: others },
      `${persona(agent)}\n\nTeammates on this board: ${others.length ? others.map((o) => `@${o.handle} (${clientLabel(o)})`).join(', ') : 'none yet'}.`);
  },
  list_tasks: (agent, { scope = 'mine', status, limit = 25 }) => {
    const ws = agent.workspace_id;
    const where = ['workspace_id = @ws']; const p = { ws };
    if (scope === 'mine') { where.push('assignee_id = @a'); p.a = agent.id; }
    if (scope === 'unassigned') where.push('assignee_id IS NULL');
    if (status) { where.push('status = @s'); p.s = status; } else where.push("status != 'done'");
    const rows = db.prepare(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY ${PRIO_ORDER}, deadline IS NULL, deadline LIMIT ${Math.min(+limit || 25, 100)}`).all(p);
    return ok(rows.map((r) => fmt(ws, hydrate.task(r))));
  },
  get_files: (agent) => {
    const rows = db.prepare('SELECT name, content, updated_at FROM agent_files WHERE agent_id = ? ORDER BY name').all(agent.id);
    if (!rows.length) return { content: [{ type: 'text', text: 'You have no reference files yet — the human can attach some in assign → Agents → Edit.' }] };
    return { content: [{ type: 'text', text: rows.map((r) => `----- ${r.name} -----\n${r.content}`).join('\n\n') }] };
  },
  get_next_task: (agent) => {
    const ws = agent.workspace_id;
    const id = claimNext(agent);
    if (!id) return ok({ task: null }, 'Your queue is empty. Nothing to pick up right now — call check_inbox, or list_tasks with scope "unassigned" and claim_task one.');
    const t = emitTask(ws, id);
    logActivity(ws, { task_id: t.id, agent_id: agent.id, actor: 'agent', kind: 'status', message: `${agent.name} picked up ${keyOf(ws, t)}` });
    return ok(fmt(ws, t), `Claimed ${keyOf(ws, t)}. Work on branch \`${t.branch}\`.\n\n${taskBrief(ws, t)}`);
  },
  get_task: (agent, { task_id }) => {
    const ws = agent.workspace_id;
    const t = getTask(ws, task_id); if (!t) throw new ToolError(`Task ${task_id} not found on this board.`);
    const acts = db.prepare('SELECT actor, kind, message, created_at FROM activity WHERE task_id = ? ORDER BY created_at DESC LIMIT 15').all(t.id);
    const owner = t.assignee_id ? getAgent(ws, t.assignee_id) : null;
    return ok({ ...fmt(ws, t), owner: owner ? `@${owner.handle}` : null, yours: t.assignee_id === agent.id, activity: acts });
  },
  claim_task: (agent, { task_id }) => {
    const ws = agent.workspace_id;
    const r = claimTask(ws, agent, task_id);
    if (!r.ok) throw new ToolError(r.error);
    if (!r.already) logActivity(ws, { task_id: r.task.id, agent_id: agent.id, actor: 'agent', kind: 'assign', message: `${agent.name} claimed ${keyOf(ws, r.task)}` });
    emitTask(ws, r.task.id);
    return ok(fmt(ws, r.task), `${keyOf(ws, r.task)} is yours. Branch: \`${r.task.branch}\`. Call start_task when you begin.`);
  },
  start_task: (agent, { task_id }) => {
    const ws = agent.workspace_id;
    const t = setStatus(agent, ownTask(agent, task_id, 'start'), 'in_progress');
    logActivity(ws, { task_id: t.id, agent_id: agent.id, actor: 'agent', kind: 'status', message: `${agent.name} started ${keyOf(ws, t)}` });
    return ok(fmt(ws, t), `${keyOf(ws, t)} is now in progress on \`${t.branch}\`.`);
  },
  update_task: (agent, { task_id, status, progress, note }) => {
    const ws = agent.workspace_id;
    if (status && !STATUSES.includes(status)) return fail(`Invalid status. Use one of ${STATUSES.join(', ')}`);
    let t = ownTask(agent, task_id, 'update');
    const extra = {};
    if (progress != null) extra.progress = Math.max(0, Math.min(100, Math.round(+progress || 0)));
    t = setStatus(agent, t, status || t.status, extra);
    const bits = [status && `moved to ${status.replace('_', ' ')}`, progress != null && `${extra.progress}%`].filter(Boolean).join(' · ');
    if (note) logActivity(ws, { task_id: t.id, agent_id: agent.id, actor: 'agent', kind: 'comment', message: String(note).slice(0, 4000) });
    if (bits || !note) logActivity(ws, { task_id: t.id, agent_id: agent.id, actor: 'agent', kind: 'status', message: `${agent.name} updated ${keyOf(ws, t)}${bits ? ': ' + bits : ''}` });
    return ok(fmt(ws, t), `Updated ${keyOf(ws, t)}${bits ? ' — ' + bits : ''}.`);
  },
  add_comment: (agent, { task_id, message }) => {
    const ws = agent.workspace_id;
    const t = ownTask(agent, task_id, 'comment on');
    logActivity(ws, { task_id: t.id, agent_id: agent.id, actor: 'agent', kind: 'comment', message: String(message || '').slice(0, 4000) || '(empty)' });
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now(), t.id); emitTask(ws, t.id);
    return ok({ ok: true }, `Comment posted on ${keyOf(ws, t)}.`);
  },
  complete_task: (agent, { task_id, summary, needs_review = true }) => {
    const ws = agent.workspace_id;
    const status = needs_review === false ? 'done' : 'review';
    const t = setStatus(agent, ownTask(agent, task_id, 'complete'), status, { progress: 100 });
    logActivity(ws, { task_id: t.id, agent_id: agent.id, actor: 'agent', kind: 'comment', message: String(summary || 'Completed.').slice(0, 6000) });
    logActivity(ws, { task_id: t.id, agent_id: agent.id, actor: 'agent', kind: 'status', message: `${agent.name} ${status === 'done' ? 'completed' : 'sent for review'} ${keyOf(ws, t)}` });
    return ok(fmt(ws, t), `${keyOf(ws, t)} moved to ${status}. Nice work — call get_next_task for more.`);
  },
  release_task: (agent, { task_id, reason }) => {
    const ws = agent.workspace_id;
    const t = getTask(ws, task_id); if (!t) throw new ToolError(`Task ${task_id} not found on this board.`);
    if (t.assignee_id !== agent.id) throw new ToolError(`${keyOf(ws, t)} isn't yours to release.`);
    db.prepare("UPDATE tasks SET assignee_id = NULL, status = 'backlog', dispatched_at = NULL, claimed_at = NULL, updated_at = ? WHERE id = ? AND assignee_id = ?").run(now(), t.id, agent.id);
    logActivity(ws, { task_id: t.id, agent_id: agent.id, actor: 'agent', kind: 'warn', message: `${agent.name} released ${keyOf(ws, t)}: ${String(reason || 'no reason given').slice(0, 1000)}` });
    emitTask(ws, t.id);
    return ok({ ok: true }, `Released ${keyOf(ws, t)} back to the backlog.`);
  },
  create_task: (agent, { title, description = '', priority = 'medium', board_id, assign_to_self = false }) => {
    const ws = agent.workspace_id;
    if (!String(title || '').trim()) return fail('Title is required');
    const board = board_id ? db.prepare('SELECT id, repo FROM boards WHERE id = ? AND workspace_id = ?').get(board_id, ws) : db.prepare('SELECT id, repo FROM boards WHERE workspace_id = ? ORDER BY position LIMIT 1').get(ws);
    if (!board) return fail('No board found');
    const ts = now();
    const t = { id: uid('t_'), workspace_id: ws, number: nextTaskNumber(ws), board_id: board.id, title: String(title).slice(0, 200), description: String(description).slice(0, 10000), acceptance: '', priority: PRIORITIES.includes(priority) ? priority : 'medium', status: 'backlog', assignee_id: assign_to_self ? agent.id : null, auto_route: 0, start_mode: 'policy', tags: '["agent-created"]', repo: board.repo || '', position: -Date.now() / 1e6, created_at: ts, updated_at: ts };
    const cols = Object.keys(t);
    db.prepare(`INSERT INTO tasks (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(t);
    logActivity(ws, { task_id: t.id, agent_id: agent.id, actor: 'agent', kind: 'create', message: `${agent.name} created ${keyOf(ws, t)} ${t.title}` });
    emitTask(ws, t.id);
    const out = applyStartPolicy(ws, t.id, 'agent') || getTask(ws, t.id);
    return ok(fmt(ws, out), `Created ${keyOf(ws, out)}.`);
  },
  check_inbox: (agent, { unread_only = true }) => {
    const rows = db.prepare(`SELECT id, kind, title, body, task_id, created_at FROM inbox WHERE agent_id = ? ${unread_only ? 'AND read_at IS NULL' : ''} ORDER BY created_at DESC LIMIT 30`).all(agent.id);
    if (rows.length) db.prepare('UPDATE inbox SET read_at = ? WHERE agent_id = ? AND read_at IS NULL').run(now(), agent.id);
    return ok(rows, rows.length ? rows.map((r) => `[${r.kind}] ${r.title}\n${r.body}`).join('\n\n———\n\n') : 'Inbox zero.');
  },
  list_boards: (agent) => ok(db.prepare('SELECT id, name, description, repo FROM boards WHERE workspace_id = ? ORDER BY position').all(agent.workspace_id)),
  report_usage: (agent, { task_id, model, tokens_in = 0, tokens_out = 0, cost_usd = 0, note } = {}) => {
    const ws = agent.workspace_id;
    const t = task_id ? getTask(ws, task_id) : null;
    if (task_id && !t) return fail(`No task ${task_id} on this board.`);
    const row = { id: uid('us_'), workspace_id: ws, agent_id: agent.id, task_id: t?.id || null,
      model: String(model || '').slice(0, 80),
      tokens_in: Math.max(0, Math.min(1e9, Math.round(+tokens_in || 0))),
      tokens_out: Math.max(0, Math.min(1e9, Math.round(+tokens_out || 0))),
      cost_usd: Math.max(0, Math.min(1e5, +cost_usd || 0)),
      note: String(note || '').slice(0, 300), created_at: now() };
    db.prepare(`INSERT INTO usage_events (id, workspace_id, agent_id, task_id, model, tokens_in, tokens_out, cost_usd, note, created_at)
      VALUES (@id,@workspace_id,@agent_id,@task_id,@model,@tokens_in,@tokens_out,@cost_usd,@note,@created_at)`).run(row);
    const task = t ? fmt(ws, t) : null;
    emit(ws, 'usage', { id: row.id, agent_id: agent.id, task_id: task?.id || null, task_key: task?.key, agent_name: agent.name, model: row.model, tokens_in: row.tokens_in, tokens_out: row.tokens_out, cost_usd: row.cost_usd, note: row.note, created_at: row.created_at });
    logActivity(ws, { task_id: task?.id, agent_id: agent.id, actor: 'agent', kind: 'usage', message: `${agent.name} reported ${row.tokens_in + row.tokens_out} tokens${row.cost_usd ? ` / $${row.cost_usd.toFixed(2)}` : ''}${task?.key ? ` on ${task.key}` : ''}` });
    return ok({ recorded: true, message: `Recorded ${row.tokens_in} in / ${row.tokens_out} out tokens${row.cost_usd ? ` ($${row.cost_usd.toFixed(2)})` : ''}${task?.key ? ` on ${task.key}` : ''}.` });
  },
  post_log: (agent, { task_id, message } = {}) => {
    const ws = agent.workspace_id;
    const t = getTask(ws, task_id);
    if (!t) return fail(`No task ${task_id} on this board.`);
    const msg = String(message || '').slice(0, 300).trim();
    if (!msg) return fail('message is required.');
    logActivity(ws, { task_id: t.id, agent_id: agent.id, actor: 'agent', kind: 'log', message: msg });
    return ok({ posted: true });
  },
};

function authAgent(req) {
  const h = req.headers.authorization || '';
  const token = (h.startsWith('Bearer ') ? h.slice(7) : '') || req.headers['x-assign-token'] || req.query.token;
  if (!token) return null;
  return hydrate.agent(db.prepare('SELECT * FROM agents WHERE token = ?').get(String(token).trim()));
}

function touch(agent) {
  const ts = now();
  const prev = agent.last_seen_at ? Date.parse(agent.last_seen_at) : 0;
  db.prepare('UPDATE agents SET last_seen_at = ? WHERE id = ?').run(ts, agent.id);
  if (Date.now() - prev > 5 * 60 * 1000) logActivity(agent.workspace_id, { agent_id: agent.id, actor: 'agent', kind: 'connect', message: `${agent.name} connected over MCP${agent.client_name ? ` from ${agent.client_name}` : ''}` });
  emit(agent.workspace_id, 'agent', publicAgent({ ...getAgent(agent.workspace_id, agent.id) }));
}

async function handleMessage(agent, msg) {
  const { id, method, params = {} } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const error = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined || id === null) return null; // notification
  switch (method) {
    case 'initialize': {
      const v = SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED[0];
      const ci = params.clientInfo || {};
      if (ci.name) {
        db.prepare('UPDATE agents SET client_name = ?, client_version = ? WHERE id = ?').run(String(ci.name).slice(0, 80), String(ci.version || '').slice(0, 40), agent.id);
        const detected = detectProvider(ci.name);
        if (detected && detected !== agent.provider && agent.provider !== 'other') {
          logActivity(agent.workspace_id, { agent_id: agent.id, actor: 'system', kind: 'warn', message: `${agent.name} is set up for ${CLIENTS[agent.provider]?.label} but connected from ${ci.name}` });
        }
        emit(agent.workspace_id, 'agent', publicAgent(getAgent(agent.workspace_id, agent.id)));
      }
      return reply({ protocolVersion: v, capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } }, serverInfo: { name: serverKey(agent), title: `assign — ${agent.name}`, version: '2.0.0' }, instructions: persona(agent) + (isPaired(agent.workspace_id, agent) ? '' : '\n\nPAIRING REQUIRED: before any other work, call whoami. It returns a 6-digit code — ask the user to enter it in assign → Agents → Connect, then continue.') });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      const fn = handlers[params.name];
      if (!fn) return error(-32602, `Unknown tool: ${params.name}`);
      const fresh = hydrate.agent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id));
      if (!isPaired(fresh.workspace_id, fresh)) {
        const code = pairCode(fresh);
        if (params.name === 'whoami') return reply(ok({ id: fresh.id, name: fresh.name, handle: fresh.handle, paired: false, pairing_code: code, expires_in_minutes: 15 }, pairText(fresh, code)));
        return reply(fail(pairText(fresh, code)));
      }
      if (fresh.paused && params.name !== 'whoami') return reply(fail(`${fresh.name} is paused on the board. Ask a human to resume you.`));
      try { return reply(await fn(fresh, params.arguments || {})); } catch (e) { if (!(e instanceof ToolError)) console.error(e); return reply(fail(e.message)); }
    }
    case 'prompts/list': return reply({ prompts: [{ name: 'persona', title: `${agent.name} persona`, description: `System prompt and role for ${agent.name}` }, { name: 'work_next', title: 'Work on next task', description: 'Pick up and execute your next queued task' }] });
    case 'prompts/get': {
      if (params.name === 'persona') return reply({ description: `${agent.name} persona`, messages: [{ role: 'user', content: { type: 'text', text: persona(agent) } }] });
      if (params.name === 'work_next') return reply({ description: 'Work on next task', messages: [{ role: 'user', content: { type: 'text', text: `${persona(agent)}\n\nCall get_next_task, check out the branch it returns, implement the task in this repository, post progress with update_task, then call complete_task with a concise summary of the changes.` } }] });
      return error(-32602, 'Unknown prompt');
    }
    case 'resources/list': return reply({ resources: [] });
    case 'resources/templates/list': return reply({ resourceTemplates: [] });
    default: return error(-32601, `Method not found: ${method}`);
  }
}

export function mountMcp(app) {
  app.all('/mcp', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, mcp-session-id, mcp-protocol-version, x-assign-token');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if (req.method === 'GET') return res.status(405).set('Allow', 'POST').json({ error: 'SSE stream not offered; use POST' });
    if (req.method === 'DELETE') return res.sendStatus(200);
    if (req.method !== 'POST') return res.sendStatus(405);

    const agent = authAgent(req);
    if (!agent) return res.status(401).set('WWW-Authenticate', 'Bearer').json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized: pass your agent token as "Authorization: Bearer asg_…" (assign → Agents → Connect)' } });
    touch(agent);

    const body = req.body;
    const msgs = Array.isArray(body) ? body : [body];
    if (!msgs.length || msgs.some((m) => !m || m.jsonrpc !== '2.0')) return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    const out = [];
    for (const m of msgs) { const r = await handleMessage(agent, m); if (r) out.push(r); }
    if (msgs.some((m) => m.method === 'initialize')) res.setHeader('Mcp-Session-Id', crypto.randomUUID());
    if (!out.length) return res.sendStatus(202);
    res.json(Array.isArray(body) ? out : out[0]);
  });
}
