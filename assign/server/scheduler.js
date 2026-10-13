import { db, now, hydrate, getSettings, saveSettings } from './db.js';
import { dispatchTask, deliver, logActivity, emit, listAgents, keyOf, PRIORITIES, PRIO_ORDER } from './core.js';

export function localParts(tz, d = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(d);
  } catch { return localParts('UTC', d); }
  const g = (t) => parts.find((p) => p.type === t)?.value;
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[g('weekday')];
  const hh = g('hour') === '24' ? '00' : g('hour');
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hm: `${hh}:${g('minute')}`, weekday: wd };
}

const pendingFor = (ws, priority) => db.prepare(`SELECT id FROM tasks WHERE workspace_id = ? AND status = 'backlog' AND dispatched_at IS NULL AND start_mode = 'policy' AND priority = ? AND (assignee_id IS NOT NULL OR auto_route = 1)`).all(ws, priority);

export function runAutomation(a, { manual = false } = {}) {
  const ws = a.workspace_id;
  const agents = listAgents(ws).filter((x) => !x.paused && (!a.agent_ids.length || a.agent_ids.includes(x.id)));
  const prios = a.priorities.length ? a.priorities : PRIORITIES;
  const inP = prios.map(() => '?').join(',');
  let summary = '';
  if (a.kind === 'daily_digest') {
    let n = 0;
    for (const ag of agents) {
      const rows = db.prepare(`SELECT * FROM tasks WHERE workspace_id = ? AND assignee_id = ? AND status != 'done' AND priority IN (${inP}) ORDER BY ${PRIO_ORDER}, deadline IS NULL, deadline`).all(ws, ag.id, ...prios).map(hydrate.task);
      const body = rows.length
        ? rows.map((t) => `• [${t.priority.toUpperCase()}] ${keyOf(ws, t)} ${t.title} — ${t.status.replace('_', ' ')}${t.deadline ? ` · due ${t.deadline.slice(0, 10)}` : ''}`).join('\n')
        : 'Nothing on your plate. Enjoy the quiet.';
      deliver(ws, ag, { kind: 'digest', title: `${a.name} · ${rows.length} open task${rows.length === 1 ? '' : 's'}`, body });
      n++;
    }
    summary = `Digest sent to ${n} agent${n === 1 ? '' : 's'}`;
  } else if (a.kind === 'dispatch_batch') {
    const rows = db.prepare(`SELECT id, assignee_id FROM tasks WHERE workspace_id = ? AND status = 'backlog' AND dispatched_at IS NULL AND start_mode IN ('policy','manual') AND priority IN (${inP}) AND (assignee_id IS NOT NULL OR auto_route = 1)`).all(ws, ...prios);
    const allowed = new Set(agents.map((x) => x.id));
    let n = 0;
    for (const r of rows) {
      if (r.assignee_id && !allowed.has(r.assignee_id)) continue;
      dispatchTask(ws, r.id, { actor: 'automation', reason: a.name }); n++;
    }
    summary = `Sent ${n} waiting task${n === 1 ? '' : 's'}`;
  } else if (a.kind === 'deadline_reminder') {
    const hours = +a.params.hours || 24;
    const until = new Date(Date.now() + hours * 3600e3).toISOString();
    const rows = db.prepare(`SELECT * FROM tasks WHERE workspace_id = ? AND status != 'done' AND deadline IS NOT NULL AND deadline <= ? AND assignee_id IS NOT NULL AND priority IN (${inP})`).all(ws, until, ...prios).map(hydrate.task);
    let n = 0;
    for (const t of rows) {
      const ag = agents.find((x) => x.id === t.assignee_id); if (!ag) continue;
      const overdue = Date.parse(t.deadline) < Date.now();
      deliver(ws, ag, { kind: 'reminder', title: `${overdue ? 'Overdue' : 'Due soon'}: ${keyOf(ws, t)} ${t.title}`, body: `Deadline ${t.deadline}. Current status: ${t.status.replace('_', ' ')} (${t.progress}%).`, task_id: t.id }); n++;
    }
    summary = `${n} deadline reminder${n === 1 ? '' : 's'} sent`;
  } else if (a.kind === 'stale_nudge') {
    const hours = +a.params.hours || 24;
    const before = new Date(Date.now() - hours * 3600e3).toISOString();
    const rows = db.prepare(`SELECT * FROM tasks WHERE workspace_id = ? AND status = 'in_progress' AND updated_at < ? AND assignee_id IS NOT NULL AND priority IN (${inP})`).all(ws, before, ...prios).map(hydrate.task);
    let n = 0;
    for (const t of rows) {
      const ag = agents.find((x) => x.id === t.assignee_id); if (!ag) continue;
      deliver(ws, ag, { kind: 'nudge', title: `Check-in: ${keyOf(ws, t)} has been quiet for ${hours}h`, body: 'Post a progress update with update_task or flag a blocker with add_comment.', task_id: t.id }); n++;
    }
    summary = `${n} stale task nudge${n === 1 ? '' : 's'} sent`;
  }
  const ts = now();
  db.prepare('UPDATE automations SET last_run_at = ?, run_count = run_count + 1 WHERE id = ?').run(ts, a.id);
  logActivity(ws, { actor: 'automation', kind: 'automation', message: `${a.name}${manual ? ' (manual run)' : ''}: ${summary}` });
  emit(ws, 'automation', hydrate.automation(db.prepare('SELECT * FROM automations WHERE id = ?').get(a.id)));
  return summary;
}

function tickWorkspace(ws) {
  const settings = getSettings(ws);
  const lp = localParts(settings.timezone);
  const rt = settings.runtime;
  rt.lastBatch = rt.lastBatch || {}; rt.lastDaily = rt.lastDaily || {};
  let dirty = false;

  // 1. scheduled starts
  for (const r of db.prepare("SELECT id FROM tasks WHERE workspace_id = ? AND status = 'backlog' AND dispatched_at IS NULL AND start_mode = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?").all(ws, now())) {
    dispatchTask(ws, r.id, { actor: 'schedule', reason: 'Scheduled start' });
  }

  // 2. priority send policy
  for (const p of PRIORITIES) {
    const pol = settings.policy[p]; if (!pol) continue;
    if (pol.mode === 'instant') {
      for (const r of pendingFor(ws, p)) dispatchTask(ws, r.id, { actor: 'system', reason: `${p} · instant send` });
    } else if (pol.mode === 'batched') {
      const last = rt.lastBatch[p] ? Date.parse(rt.lastBatch[p]) : 0;
      if (Date.now() - last >= Math.max(1, +pol.interval || 30) * 60e3) {
        for (const r of pendingFor(ws, p)) dispatchTask(ws, r.id, { actor: 'system', reason: `${p} · batch every ${pol.interval}m` });
        rt.lastBatch[p] = now(); dirty = true;
      }
    } else if (pol.mode === 'daily') {
      if (lp.hm >= (pol.time || '09:00') && rt.lastDaily[p] !== lp.date) {
        for (const r of pendingFor(ws, p)) dispatchTask(ws, r.id, { actor: 'system', reason: `${p} · daily at ${pol.time}` });
        rt.lastDaily[p] = lp.date; dirty = true;
      }
    }
  }
  if (dirty) saveSettings(ws, { ...getSettings(ws), runtime: rt });

  // 3. automations (once per local day, after their time)
  for (const a of db.prepare('SELECT * FROM automations WHERE workspace_id = ? AND enabled = 1').all(ws).map(hydrate.automation)) {
    if (!a.days.includes(lp.weekday)) continue;
    if (lp.hm < a.time) continue;
    if (a.last_run_at) {
      const last = localParts(settings.timezone, new Date(a.last_run_at));
      if (last.date === lp.date && last.hm >= a.time) continue;
    }
    if (!a.last_run_at) {
      // created after today's slot: don't fire immediately, wait for the next one
      const created = localParts(settings.timezone, new Date(a.created_at));
      if (created.date === lp.date && created.hm >= a.time) continue;
    }
    try { runAutomation(a); } catch (e) { console.error('automation failed', e); }
  }
}

export function tick() {
  for (const { id } of db.prepare('SELECT id FROM workspaces WHERE onboarded = 1').all()) {
    try { tickWorkspace(id); } catch (e) { console.error('tick failed for', id, e); }
  }
}

export function startScheduler() {
  setTimeout(() => { try { tick(); } catch (e) { console.error(e); } }, 1500);
  setInterval(() => { try { tick(); } catch (e) { console.error('tick failed', e); } }, 15000).unref?.();
}
