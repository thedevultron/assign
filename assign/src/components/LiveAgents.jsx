import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import Icon from './Icon.jsx';
import { Avatar, useNow } from './ui.jsx';
import { useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import { providerLabel, relTime } from '../lib/helpers.js';
import { EASE } from './ui.jsx';

const kfmt = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n || 0}`;
const money = (c) => c >= 1 ? `$${c.toFixed(2)}` : c > 0 ? `$${c.toFixed(4)}` : '';

/** Who is doing what right now: per-agent live sessions, last log line, model + today tokens/cost. */
export default function LiveAgents() {
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const activity = useStore((s) => s.activity);
  const liveUsage = useStore((s) => s.usage);
  const now = useNow(15000);
  const [usageToday, setUsageToday] = useState({});
  useEffect(() => {
    let alive = true;
    api.get('/analytics?days=1').then((j) => {
      if (!alive) return;
      const m = {};
      for (const a of j.usage?.agents || []) m[a.agent_id] = a;
      setUsageToday(m);
    }).catch(() => {});
    const t = setInterval(() => { api.get('/analytics?days=1').then((j) => { const m = {}; for (const a of j.usage?.agents || []) m[a.agent_id] = a; if (alive) setUsageToday(m); }).catch(() => {}); }, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const mergedUsage = useMemo(() => {
    const m = { ...usageToday };
    for (const u of liveUsage) {
      const cur = m[u.agent_id] || { tokens_in: 0, tokens_out: 0, cost_usd: 0, reports: 0 };
      m[u.agent_id] = { ...cur, tokens_in: cur.tokens_in + u.tokens_in, tokens_out: cur.tokens_out + u.tokens_out, cost_usd: cur.cost_usd + (u.cost_usd || 0), reports: cur.reports + 1 };
    }
    return m;
  }, [usageToday, liveUsage]);

  const live = agents.map((a) => {
    const running = tasks.filter((t) => t.assignee_id === a.id && t.status === 'in_progress');
    const queued = tasks.filter((t) => t.assignee_id === a.id && t.status === 'queued').length;
    const lastLog = activity.find((e) => e.agent_id === a.id && (e.kind === 'log' || e.kind === 'status' || e.kind === 'usage'));
    const lastU = liveUsage.find((u) => u.agent_id === a.id);
    const sess = running.map((t) => {
      const since = Date.parse(t.started_at || t.claimed_at || t.dispatched_at || t.updated_at);
      const lastTaskLog = activity.find((e) => e.task_id === t.id && (e.kind === 'log' || e.kind === 'status'));
      return { task: t, elapsed: now - since, lastLog: lastTaskLog?.message };
    });
    const totals = mergedUsage[a.id];
    return { agent: a, sess, queued, lastLog: lastLog?.message, totals, model: lastU?.model || '' };
  });
  const activeCount = live.reduce((n, l) => n + l.sess.length, 0);

  return (
    <motion.div className="panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.3 }}>
      <div className="section-head">
        <span className="h4">Now playing</span>
        <span className="label">{activeCount} task{activeCount === 1 ? '' : 's'} in flight</span>
        <span className="spacer" />
      </div>
      <div className="live-agents">
        {live.map(({ agent: a, sess, queued, lastLog, totals, model }) => (
          <div key={a.id} className={`live-agent ${sess.length ? 'on' : ''}`}>
            <div className="row" style={{ gap: 10, minWidth: 0 }}>
              <Avatar agent={a} size={34} status />
              <div className="col grow" style={{ minWidth: 0, gap: 1 }}>
                <span className="small" style={{ color: '#fff' }}>{a.name}</span>
                <span className="tiny muted trunc">{providerLabel(a.provider)}{model ? ` · ${model}` : ''}</span>
              </div>
              {totals ? (
                <div className="col" style={{ alignItems: 'flex-end', gap: 1 }}>
                  <span className="tiny mono" style={{ color: '#d1c9ff' }}>{kfmt((totals.tokens_in || 0) + (totals.tokens_out || 0))} tok</span>
                  {totals.cost_usd ? <span className="tiny mono muted">{money(totals.cost_usd)}</span> : <span className="tiny mono muted">cost n/a</span>}
                </div>
              ) : <span className="tiny muted">today</span>}
            </div>
            {sess.length ? (
              <div className="col" style={{ gap: 6, marginTop: 10 }}>
                {sess.map(({ task, elapsed, lastLog: ll }) => (
                  <div key={task.id} className="live-session">
                    <div className="row" style={{ gap: 8, minWidth: 0 }}>
                      <span className="live-orb" />
                      <span className="small trunc grow" style={{ color: '#dcdee2' }}>{task.title}</span>
                      <span className="tiny mono muted" style={{ flex: 'none' }}>{fmtElapsed(elapsed)}</span>
                    </div>
                    <div className="live-bar"><i style={{ width: `${task.progress || 0}%` }} /></div>
                    {ll ? <div className="tiny muted mono trunc">“{ll}”</div> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <span className="tiny muted grow">{queued ? `${queued} queued` : lastLog ? `last: ${lastLog.slice(0, 60)}${lastLog.length > 60 ? '…' : ''}` : 'idle'}</span>
                {lastLog && !queued ? null : <span className="tiny muted">{a.last_seen_at ? relTime(a.last_seen_at, now) : '—'}</span>}
              </div>
            )}
          </div>
        ))}
        {!agents.length ? <div className="empty small muted">Add agents on the Agents page to see them here.</div> : null}
      </div>
    </motion.div>
  );
}

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
