// Local runner bridge: the assign-runner.mjs script on the user's machine connects
// here over a long-lived WebSocket. The browser spawns local processes through it
// (agent CLIs like `claude`/`codex` in a task's repo folder) and watches them live.
import { WebSocketServer } from 'ws';
import { readFileSync } from 'node:fs';
import { db, now, uid, newToken } from './db.js';
import { emit, logActivity, getTask, getAgent, keyOf } from './core.js';

/* Why long-lives here: runner script holds one WS; server routes /api/runners/*. */
const socketsByRunner = new Map(); // runner_id → ws
const OUTPUT_MAX = 256 * 1024;      // keep a rolling tail of each session's output

const pubRunner = (r) => ({ id: r.id, name: r.name, label: r.label, platform: r.platform, cwd: r.cwd, allow: r.allow, max_concurrent: r.max_concurrent, online: !!r.online, last_seen_at: r.last_seen_at, created_at: r.created_at });
export const getRunner = (ws, id) => db.prepare('SELECT * FROM runners WHERE workspace_id = ? AND id = ?').get(ws, id);
export const pubSession = (s) => s && ({ ...s, args: undefined, output: undefined });

function bumpRunner(wsId, runnerId, patch) {
  db.prepare(`UPDATE runners SET ${Object.keys(patch).map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...patch, id: runnerId });
  const r = db.prepare('SELECT * FROM runners WHERE id = ?').get(runnerId);
  emit(wsId, 'runner', pubRunner(r));
  return r;
}

function setSession(wsId, id, patch) {
  const keys = Object.keys(patch);
  if (keys.length) db.prepare(`UPDATE runner_sessions SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...patch, id });
  const s = db.prepare('SELECT * FROM runner_sessions WHERE id = ?').get(id);
  emit(wsId, 'runner_session', pubSession(s));
  return s;
}

export const activeSessionRows = (wsId, runnerId) =>
  db.prepare("SELECT * FROM runner_sessions WHERE workspace_id = ? AND runner_id = ? AND status IN ('queued','running','stopping') ORDER BY created_at").all(wsId, runnerId || '');
// ---- helpers ----
export function runnerBusyCount(wsId, runnerId) {
  return db.prepare("SELECT COUNT(*) n FROM runner_sessions WHERE runner_id = ? AND status IN ('running','queued','stopping')").get(runnerId).n;
}

/* Command the runner should execute for a task. Server-side template — the browser
   sends only a task id; the runner never gets arbitrary shell from the network. */
export function execForTask(wsId, task, agent) {
  const brief = [task.title, task.description, task.acceptance && `Acceptance criteria:\n${task.acceptance}`].filter(Boolean).join('\n\n').slice(0, 6000);
  const preamble = `You are ${agent?.name || 'an agent'} on the assign board. Work this task, then report back:\n`;
  const cmdMap = {
    'claude-code': { cmd: 'claude', args: ['-p', preamble + brief] },
    'codex': { cmd: 'codex', args: ['exec', '--skip-git-repo-check', preamble + brief] },
    'gemini-cli': { cmd: 'gemini', args: ['-p', preamble + brief] },
    'cursor': { cmd: 'cursor-agent', args: ['-p', preamble + brief] },
    'windsurf': { cmd: 'windsurf', args: ['--prompt', preamble + brief] },
    'cline': { cmd: 'cline', args: ['-p', preamble + brief] },
    'aider': { cmd: 'aider', args: ['-m', preamble + brief] },
    'other': null,
  };
  const map = agent?.provider ? cmdMap[agent.provider] : null;
  return map || { cmd: 'echo', args: [`No CLI mapping for ${agent?.provider || 'unassigned'} — task ${task.title}`] };
}

export function createSession(wsId, { runnerId, taskId = null, agentId = null, cmd, args = [], cwd = '', kind = 'task', actor = 'you' }) {
  const runner = getRunner(wsId, runnerId);
  if (!runner) throw Object.assign(new Error('Runner not found'), { status: 404 });
  const busy = runnerBusyCount(wsId, runnerId);
  const status = busy >= runner.max_concurrent ? 'queued' : 'waiting';
  const s = { id: uid('rs_'), workspace_id: wsId, runner_id: runnerId, task_id: taskId, agent_id: agentId, kind, cmd: String(cmd).slice(0, 200), args: JSON.stringify(args || []), cwd, status, created_at: now() };
  db.prepare(`INSERT INTO runner_sessions (id, workspace_id, runner_id, task_id, agent_id, kind, cmd, args, cwd, status, created_at)
    VALUES (@id,@workspace_id,@runner_id,@task_id,@agent_id,@kind,@cmd,@args,@cwd,@status,@created_at)`).run(s);
  const t = taskId ? getTask(wsId, taskId) : null;
  logActivity(wsId, { task_id: taskId, agent_id: agentId, actor, kind: 'route', message: t ? `Started ${keyOf(wsId, t)} on runner ${runner.name}` : `Started a local session on runner ${runner.name}` });
  return getSession(wsId, s.id);
  function getSession(w, i) { return db.prepare('SELECT * FROM runner_sessions WHERE workspace_id = ? AND id = ?').get(w, i); }
}

export function dispatchNext(wsId, runnerId) {
  const sock = socketsByRunner.get(runnerId);
  const runner = db.prepare('SELECT * FROM runners WHERE id = ?').get(runnerId);
  if (!runner) return;
  const busy = runnerBusyCount(wsId, runnerId);
  if (!sock || sock.readyState !== 1) return;
  if (busy >= (runner.max_concurrent || 2)) return;
  const next = db.prepare("SELECT * FROM runner_sessions WHERE runner_id = ? AND status IN ('queued','waiting') ORDER BY created_at LIMIT 1").get(runnerId);
  if (!next) return;
  setSession(wsId, next.id, { status: 'assigned' });
  sock.send(JSON.stringify({ type: 'exec', session: { id: next.id, cmd: next.cmd, args: JSON.parse(next.args || '[]'), cwd: next.cwd || runner.cwd || '' } }));
}

export function listRunners(wsId) { return db.prepare('SELECT * FROM runners WHERE workspace_id = ? ORDER BY created_at').all(wsId).map(pubRunner); }
export function listSessions(wsId, limit = 50) { return db.prepare('SELECT * FROM runner_sessions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(wsId, limit).map(pubSession); }

/* ───────── WebSocket side ───────── */
export function attachRunnerSocket(server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws/runner')) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (sock, req) => {
    let runner = null; const wsIdHolder = { ws: null };
    sock.on('pong', () => { if (runner) { bumpRunner(wsIdHolder.ws, runner.id, { last_seen_at: now(), online: 1 }); } });
    const kill = setInterval(() => { if (runner && Date.now() - new Date(runner.last_seen_at || 0).getTime() > 45000) { try { sock.ping(); } catch {} } }, 30000);

   sock.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (!runner) {
        const r = db.prepare('SELECT * FROM runners WHERE token = ?').get(String(msg.token || ''));
        if (!r) { sock.send(JSON.stringify({ type: 'error', error: 'Bad token' })); sock.close(); return; }
        runner = r; wsIdHolder.ws = r.workspace_id;
        socketsByRunner.set(r.id, sock);
        runner = bumpRunner(r.workspace_id, r.id, { online: 1, last_seen_at: now(), label: String(msg.label || r.label).slice(0, 120), platform: String(msg.platform || r.platform).slice(0, 60), cwd: String(msg.cwd || r.cwd).slice(0, 400), allow: r.allow, max_concurrent: Math.max(1, Math.min(5, msg.max_concurrent || r.max_concurrent || 2)) });
        sock.send(JSON.stringify({ type: 'hello', runner: pubRunner(runner) }));
        dispatchNext(runner.workspace_id, r.id);
        return;
      }
      const wsId = runner.workspace_id;
      if (msg.type === 'output' && msg.session_id) {
        const s = db.prepare('SELECT * FROM runner_sessions WHERE id = ? AND runner_id = ?').get(msg.session_id, runner.id);
        if (!s) return;
        const chunk = String(msg.chunk || '').slice(0, 64 * 1024);
        let output = (s.output || '') + chunk;
        if (output.length > OUTPUT_MAX) output = output.slice(-OUTPUT_MAX);
        db.prepare('UPDATE runner_sessions SET output = ? WHERE id = ?').run(output, s.id);
        emit(wsId, 'runner_output', { id: s.id, chunk });
        if (s.status === 'assigned') setSession(wsId, s.id, { status: 'running', started_at: now() });
      } else if (msg.type === 'exit' && msg.session_id) {
        const s = db.prepare("SELECT * FROM runner_sessions WHERE id = ? AND runner_id = ?").get(msg.session_id, runner.id);
        if (!s) return;
        const status = s.status === 'stopping' ? 'stopped' : msg.code === 0 ? 'done' : 'failed';
        setSession(wsId, s.id, { status, exit_code: msg.code ?? null, ended_at: now() });
        logActivity(wsId, { task_id: s.task_id, agent_id: s.agent_id, actor: 'system', kind: status === 'done' ? 'info' : 'warn', message: s.task_id ? `Local run on runner ${runner.name} ${status} (exit ${msg.code ?? '—'})` : `Local session on ${runner.name} ${status}` });
        dispatchNext(wsId, runner.id);
      }
    });

    sock.on('close', () => {
      clearInterval(kill);
      if (runner) { socketsByRunner.delete(runner.id); bumpRunner(runner.workspace_id, runner.id, { online: 0 }); }
    });
  });
}

export function stopSession(wsId, sessionId) {
  const s = db.prepare('SELECT * FROM runner_sessions WHERE workspace_id = ? AND id = ?').get(wsId, sessionId);
  if (!s) throw Object.assign(new Error('Session not found'), { status: 404 });
  if (['done', 'failed', 'stopped'].includes(s.status)) return s;
  if (s.status === 'queued' || s.status === 'waiting') return setSession(wsId, s.id, { status: 'stopped', ended_at: now() });
  setSession(wsId, s.id, { status: 'stopping' });
  const sock = socketsByRunner.get(s.runner_id);
  if (sock && sock.readyState === 1) sock.send(JSON.stringify({ type: 'stop', session_id: s.id }));
  return s;
}

export function runnerOnline(wsId, runnerId) { const s = socketsByRunner.get(runnerId); return !!(s && s.readyState === 1); }

/* ───────── REST (mounted by routes.js) ───────── */
export function runnerRoutes(r, { wrap, bad, str }) {
  r.get('/runners', wrap((req) => listRunners(req.ws)));
  r.post('/runners', wrap((req) => {
    const name = str(req.body.name, 60).trim(); if (!name) throw bad('Runner needs a name');
    const row = { id: uid('rn_'), workspace_id: req.ws, name, token: 'rnr_' + newToken().slice(4), created_at: now() };
    db.prepare('INSERT INTO runners (id, workspace_id, name, token, created_at) VALUES (?,?,?,?,?)').run(row.id, row.workspace_id, row.name, row.token, row.created_at);
    emit(req.ws, 'runner', pubRunner(row));
    return { ...pubRunner(row), token: row.token };
  }));
  r.patch('/runners/:id', wrap((req) => {
    const r0 = getRunner(req.ws, req.params.id); if (!r0) throw bad('Runner not found', 404);
    const patch = {};
    if ('name' in req.body) patch.name = str(req.body.name, 60).trim() || r0.name;
    if ('cwd' in req.body) patch.cwd = str(req.body.cwd, 400);
    if ('allow' in req.body) patch.allow = str(req.body.allow, 500);
    if ('max_concurrent' in req.body) patch.max_concurrent = Math.max(1, Math.min(5, parseInt(req.body.max_concurrent) || 2));
    return bumpRunner(req.ws, r0.id, patch) && pubRunner(getRunner(req.ws, r0.id));
  }));
  r.delete('/runners/:id', wrap((req) => {
    const r0 = getRunner(req.ws, req.params.id); if (!r0) throw bad('Runner not found', 404);
    for (const s of activeSessionRows(req.ws, r0.id).filter((x) => x.runner_id === r0.id)) setSession(req.ws, s.id, { status: 'stopped', ended_at: now() });
    db.prepare('DELETE FROM runners WHERE id = ?').run(r0.id);
    emit(req.ws, 'runner:delete', { id: r0.id });
    return { ok: true };
  }));
  r.get('/runners/:id/sessions', wrap((req) => db.prepare('SELECT * FROM runner_sessions WHERE workspace_id = ? AND runner_id = ? ORDER BY created_at DESC LIMIT 50').all(req.ws, req.params.id).map(pubSession)));
  r.get('/runner-sessions', wrap((req) => listSessions(req.ws)));
  r.get('/runner-sessions/:id/output', wrap((req) => {
    const s = db.prepare('SELECT output, status, cmd FROM runner_sessions WHERE workspace_id = ? AND id = ?').get(req.ws, req.params.id);
    if (!s) throw bad('Session not found', 404);
    return s;
  }));
  r.post('/runners/:id/run-task', wrap((req) => {
    const r0 = getRunner(req.ws, req.params.id); if (!r0) throw bad('Runner not found', 404);
    if (!runnerOnline(req.ws, r0.id)) throw bad(`${r0.name} is offline — start it on your machine first (see the Runners panel)`, 409);
    const t = getTask(req.ws, str(req.body.task_id || '')); if (!t) throw bad('Task not found', 404);
    const agent = t.assignee_id ? getAgent(req.ws, t.assignee_id) : null;
    const spec = execForTask(req.ws, t, agent);
    const s = createSession(req.ws, { runnerId: r0.id, taskId: t.id, agentId: agent?.id || null, ...spec, cwd: r0.cwd, actor: 'you' });
    dispatchNext(req.ws, r0.id);
    return pubSession(s);
  }));
  r.post('/runner-sessions/:id/stop', wrap((req) => pubSession(stopSession(req.ws, req.params.id))));
  r.get('/runners-script', (req, res) => {
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="assign-runner.mjs"' });
    res.send(readFileSync(new URL('../public/assign-runner.mjs', import.meta.url), 'utf8'));
  });
  return r;
}
