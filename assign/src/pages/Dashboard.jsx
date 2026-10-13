import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { curveMonotoneX } from '@visx/curve';
import Icon from '../components/Icon.jsx';
import { Avatar, AnimatedNumber, Prio, Button, EmptyState, useNow, EASE, EASE_OUT } from '../components/ui.jsx';
import { ActivityItem } from '../components/Feed.jsx';
import { AreaChart, Area, Grid, XAxis, ChartTooltip, RingChart, Ring, RingCenter, BarChart, Bar, BarXAxis, Gauge } from '@/components/charts';
import LivePulse from '../components/LivePulse.jsx';
import LiveAgents from '../components/LiveAgents.jsx';
import { api } from '../lib/api.js';
import { useStore, useKey } from '../lib/store.js';
import { dueLabel, isOnline, greeting, providerLabel, relTime, cx, STATUSES, sortTasks } from '../lib/helpers.js';

const fade = (i = 0) => ({ initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9, ease: EASE, delay: 0.06 * i } });
const DAY = 864e5;

function dayKey(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }

export default function Overview() {
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const activity = useStore((s) => s.activity);
  const settings = useStore((s) => s.settings);
  const user = useStore((s) => s.auth.user);
  const boards = useStore((s) => s.boards);
  const setUI = useStore((s) => s.setUI);
  const keyOf = useKey();
  const now = useNow(60000);

  const open = tasks.filter((t) => t.status !== 'done');
  const moving = tasks.filter((t) => t.status === 'queued' || t.status === 'in_progress');
  const review = tasks.filter((t) => t.status === 'review');
  const weekAgo = now - 7 * DAY;
  const shipped = tasks.filter((t) => t.status === 'done' && t.completed_at && Date.parse(t.completed_at) > weekAgo);
  const overdue = open.filter((t) => t.deadline && Date.parse(t.deadline) < now);
  const needsYou = [...review, ...overdue.filter((t) => t.status !== 'review'), ...tasks.filter((t) => t.status === 'backlog' && !t.assignee_id && !t.auto_route)].slice(0, 6);

  const series = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => dayKey(now - (13 - i) * DAY));
    const created = {}; const done = {};
    tasks.forEach((t) => {
      if (t.created_at) created[dayKey(t.created_at)] = (created[dayKey(t.created_at)] || 0) + 1;
      if (t.completed_at) done[dayKey(t.completed_at)] = (done[dayKey(t.completed_at)] || 0) + 1;
    });
    return days.map((d) => ({ date: new Date(d), created: created[d] || 0, shipped: done[d] || 0 }));
  }, [tasks, Math.floor(now / DAY)]); // eslint-disable-line
  const hasSeries = series.some((d) => d.created || d.shipped);

  const ring = useMemo(() => {
    const total = Math.max(1, tasks.length);
    return [
      { label: 'Backlog', value: tasks.filter((t) => t.status === 'backlog').length, color: '#4b49aa' },
      { label: 'Queued', value: tasks.filter((t) => t.status === 'queued').length, color: '#90b8f0' },
      { label: 'In progress', value: tasks.filter((t) => t.status === 'in_progress').length, color: '#00b3dd' },
      { label: 'Review', value: review.length, color: '#dd90d8' },
      { label: 'Done', value: tasks.filter((t) => t.status === 'done').length, color: '#d1c9ff' },
    ].map((d) => ({ ...d, maxValue: total }));
  }, [tasks, review.length]);

  const load = agents.map((a) => ({ name: a.name, open: tasks.filter((t) => t.assignee_id === a.id && t.status !== 'done').length }));
  const firstName = user?.name?.split(' ')[0] || '';
  const working = agents.filter((a) => tasks.some((t) => t.assignee_id === a.id && t.status === 'in_progress')).length;
  const connectedOnce = agents.some((a) => a.last_seen_at);

  const steps = [
    { done: agents.length > 0, label: 'Add a coding agent', action: () => setUI({ agentEditor: {} }) },
    { done: connectedOnce, label: 'Connect it over MCP', action: () => (agents[0] ? setUI({ connectAgentId: agents[0].id }) : setUI({ agentEditor: {} })) },
    { done: tasks.length > 0, label: 'Create a task', action: () => setUI({ composer: { initial: {} } }) },
    { done: tasks.some((t) => t.status === 'done' || t.status === 'review'), label: 'Get your first hand-back', action: () => boards[0] && (location.hash = `#/board/${boards[0].id}`) },
  ];
  const showSetup = steps.some((s) => !s.done);

  return (
    <div className="page">
      <motion.div className="page-head" {...fade(0)}>
        <div className="grow">
          <span className="label">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          <h1 className="h1">{greeting(settings?.timezone)}{firstName ? `, ${firstName}` : ''}. <em>{moving.length ? `${moving.length} task${moving.length === 1 ? '' : 's'} in motion.` : agents.length ? 'All quiet.' : 'Let’s begin.'}</em></h1>
          <p className="lede" style={{ marginTop: 14 }}>{agents.length ? `${working} of ${agents.length} agent${agents.length === 1 ? '' : 's'} working · ${review.length} waiting on your review` : 'Add an agent, connect it, and hand it your first task.'}</p>
          {!useStore.getState().workspace?.onboarded ? (
            <div className="row" style={{ marginTop: 14, gap: 10, padding: '10px 14px', border: '1px solid rgba(132,125,255,0.25)', borderRadius: 12, background: 'rgba(132,125,255,0.05)' }}>
              <Icon name="sparkles" size={15} style={{ color: 'var(--iris)', flex: 'none' }} />
              <span className="small grow">Finish the 1-minute setup to get a board, policy and your first agent wired.</span>
              <a className="link small" href="#/onboarding">Set up →</a>
            </div>
          ) : null}
        </div>
        <Button onClick={() => setUI({ composer: { initial: {} } })}>Assign a task</Button>
      </motion.div>

      {showSetup && (
        <motion.section className="panel setup" {...fade(1)}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
            <div><span className="label">Getting started</span><div className="h3" style={{ marginTop: 8 }}>{steps.filter((s) => s.done).length} of {steps.length} <em>done</em></div></div>
            <div className="setup-bar"><motion.b initial={{ scaleX: 0 }} animate={{ scaleX: steps.filter((s) => s.done).length / steps.length }} transition={{ duration: 1.2, ease: EASE }} /></div>
          </div>
          <div className="setup-steps">
            {steps.map((s, i) => (
              <button key={s.label} className={`setup-step ${s.done ? 'done' : ''}`} onClick={s.action} disabled={s.done}>
                <span className="n">{s.done ? <Icon name="check" size={13} /> : `0${i + 1}`}</span>
                <span>{s.label}</span>
                {!s.done && <span className="arr" style={{ marginLeft: 'auto' }}>→</span>}
              </button>
            ))}
          </div>
        </motion.section>
      )}

      <section className="stats">
        {[
          ['Open tasks', open.length, `${tasks.filter((t) => t.status === 'backlog').length} in backlog`],
          ['In motion', moving.length, `${tasks.filter((t) => t.status === 'in_progress').length} being worked`],
          ['Needs review', review.length, review.length ? 'Waiting on you' : 'Nothing waiting'],
          ['Shipped · 7d', shipped.length, overdue.length ? `${overdue.length} overdue` : 'Nothing overdue'],
        ].map(([l, v, s], i) => (
          <motion.div key={l} className="stat" {...fade(i + 1)}>
            <span className="label">{l}</span>
            <span className="big"><AnimatedNumber value={v} /></span>
            <span className="small muted">{s}</span>
          </motion.div>
        ))}
      </section>

      <motion.section className="panel" {...fade(3)}>
        <BoardSnapshot />
      </motion.section>

      <section className="grid-2">
        <motion.div className="panel" {...fade(3)}>
          <div className="section-head"><span className="h4">Throughput</span><span className="label">Last 14 days</span><span className="spacer" />
            <span className="row tiny" style={{ gap: 14 }}><span className="row" style={{ gap: 6 }}><i className="lg-dot" style={{ background: '#00b3dd' }} />Shipped</span><span className="row" style={{ gap: 6 }}><i className="lg-dot" style={{ background: '#847dff' }} />Created</span></span>
          </div>
          {hasSeries ? (
            <div className="chart-box">
              <AreaChart data={series} aspectRatio="auto" className="h-full" animationDuration={1400}>
                <Grid horizontal />
                <Area dataKey="created" stroke="#847dff" fill="#847dff" fillOpacity={0.12} gradientToOpacity={0.12} strokeWidth={1.5} curve={curveMonotoneX} />
                <Area dataKey="shipped" stroke="#00b3dd" fill="#00b3dd" fillOpacity={0.16} gradientToOpacity={0.16} strokeWidth={2} curve={curveMonotoneX} />
                <XAxis />
                <ChartTooltip />
              </AreaChart>
            </div>
          ) : (
            <div className="chart-empty"><span className="label">No data yet</span><span className="small muted">Created and shipped tasks will chart here.</span></div>
          )}
        </motion.div>
        <motion.div className="panel ring-panel" {...fade(4)}>
          <div className="section-head"><span className="h4">Pipeline</span><span className="label">{tasks.length} total</span></div>
          <div className="ring-row">
            <RingChart data={ring} size={200} strokeWidth={8} ringGap={4} baseInnerRadius={40} animationDuration={1400}>
              {ring.map((d, i) => <Ring key={d.label} index={i} />)}
              <RingCenter defaultLabel="Tasks" />
            </RingChart>
            <div className="col" style={{ gap: 8, minWidth: 0 }}>
              {ring.map((d) => (
                <div key={d.label} className="row small" style={{ gap: 10 }}><i className="lg-dot" style={{ background: d.color }} /><span className="grow">{d.label}</span><span className="num" style={{ color: '#fff' }}>{d.value}</span></div>
              ))}
            </div>
          </div>
        </motion.div>
      </section>

      <section>
        <LiveAgents />
      </section>

      <section className="grid-2">
        <motion.div className="panel" {...fade(5)}>
          <div className="section-head"><span className="h4">Live pulse</span><span className="label">Agent events · trailing 2 min</span><span className="spacer" /><span className="conn label on" style={{ height: 'auto' }}><i />Live</span></div>
          <LivePulse height={220} />
        </motion.div>
        <motion.div className="panel gauge-panel" {...fade(5)}>
          <div className="section-head"><span className="h4">Last 30 days</span><span className="spacer" /><a className="link small" href="#/analytics">Open analytics →</a></div>
          <MonthGauge />
        </motion.div>
      </section>

      <section className="grid-2">
        <motion.div className="panel" {...fade(5)}>
          <div className="section-head"><span className="h4">Needs you</span><span className="label">{needsYou.length}</span></div>
          {needsYou.length === 0 ? (
            <div className="chart-empty" style={{ height: 160 }}><Icon name="done" size={20} /><span className="small muted">You’re all caught up.</span></div>
          ) : (
            <div className="col">
              {needsYou.map((t) => {
                const a = agents.find((x) => x.id === t.assignee_id);
                const due = dueLabel(t.deadline);
                const why = t.status === 'review' ? 'Review' : due?.tone === 'overdue' ? 'Overdue' : 'Unassigned';
                return (
                  <button key={t.id} className="list-row" onClick={() => setUI({ taskId: t.id })}>
                    <Prio p={t.priority} />
                    <span className="label" style={{ width: 64 }}>{keyOf(t)}</span>
                    <span className="trunc grow" style={{ color: '#fff', textAlign: 'left' }}>{t.title}</span>
                    <span className={`chip ${why === 'Overdue' ? 'warn' : why === 'Review' ? 'iris' : ''}`}>{why}</span>
                    <Avatar agent={a} size={22} />
                  </button>
                );
              })}
            </div>
          )}
        </motion.div>
        <motion.div className="panel" {...fade(6)}>
          <div className="section-head"><span className="h4">Live feed</span><span className="spacer" /><a className="link small" href="#/activity">All activity →</a></div>
          {activity.length === 0 ? <div className="chart-empty" style={{ height: 160 }}><span className="small muted">Activity will stream in here.</span></div> : (
            <div className="feed" style={{ maxHeight: 360, overflow: 'auto', marginRight: -8, paddingRight: 8 }}>
              {activity.slice(0, 10).map((ev) => <ActivityItem key={ev.id} ev={ev} compact />)}
            </div>
          )}
        </motion.div>
      </section>

      <motion.section {...fade(7)}>
        <div className="section-head"><span className="h3">The <em>team</em></span><span className="label">{agents.length} agent{agents.length === 1 ? '' : 's'}</span><span className="spacer" /><Button variant="ghost" size="sm" onClick={() => setUI({ agentEditor: {} })}><Icon name="plus" size={15} />Add agent</Button></div>
        {agents.length === 0 ? (
          <div className="panel"><EmptyState icon="robot" title="No agents yet" body="Create an agent for each coding tool seat — Claude Code, Cursor, Codex and more." action={<Button onClick={() => setUI({ agentEditor: {} })}>Add your first agent</Button>} /></div>
        ) : (
          <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="team-list">
              {agents.map((a, i) => {
                const mine = tasks.filter((t) => t.assignee_id === a.id && t.status !== 'done');
                const cur = mine.find((t) => t.status === 'in_progress');
                return (
                  <motion.button key={a.id} className="team-row" onClick={() => setUI({ agentEditor: { agent: a } })} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease: EASE_OUT, delay: i * 0.04 }}>
                    <Avatar agent={a} size={34} status />
                    <span className="col" style={{ minWidth: 0, gap: 2, flex: 1, textAlign: 'left' }}>
                      <span className="row" style={{ gap: 8 }}><span style={{ color: '#fff' }}>{a.name}</span><span className="label">{providerLabel(a.provider)}</span></span>
                      <span className="small muted trunc">{a.paused ? 'Paused' : cur ? `Working on ${keyOf(cur)} · ${cur.progress || 0}%` : isOnline(a) ? 'Online · idle' : a.last_seen_at ? `Seen ${relTime(a.last_seen_at, now)}` : 'Never connected'}</span>
                    </span>
                    <span className="num" style={{ color: '#fff' }}>{mine.length}</span>
                  </motion.button>
                );
              })}
            </div>
            <div className="panel">
              <div className="section-head"><span className="h4">Workload</span><span className="label">Open tasks per agent</span></div>
              <div className="chart-box" style={{ height: 220 }}>
                <BarChart data={load} xDataKey="name" aspectRatio="auto" className="h-full">
                  <Grid horizontal />
                  <Bar dataKey="open" fill="#847dff" lineCap="round" />
                  <BarXAxis />
                  <ChartTooltip />
                </BarChart>
              </div>
            </div>
          </div>
        )}
      </motion.section>
    </div>
  );
}

/** The board itself, condensed: first project's columns with clickable cards. */
function BoardSnapshot() {
  const boards = useStore((s) => s.boards);
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const setUI = useStore((s) => s.setUI);
  const keyOf = useKey();
  const board = [...boards].sort((a, b) => a.position - b.position)[0];
  if (!board) {
    return (
      <>
        <div className="section-head"><span className="h4">Board</span><span className="label">No projects yet</span></div>
        <div className="chart-empty" style={{ height: 140 }}>
          <span className="small muted">Create a project to get a Kanban board.</span>
          <Button size="sm" onClick={() => setUI({ projectPicker: true })}>Browse projects</Button>
        </div>
      </>
    );
  }
  const mine = tasks.filter((t) => t.board_id === board.id);
  return (
    <>
      <div className="section-head">
        <span className="h4">{board.name}</span>
        <span className="label">{mine.filter((t) => t.status !== 'done').length} open</span>
        <span className="spacer" />
        <a className="link small" href={`#/board/${board.id}`}>Open board →</a>
      </div>
      <div className="snap-cols">
        {STATUSES.map((s) => {
          const list = sortTasks(mine.filter((t) => t.status === s.id));
          return (
            <div key={s.id} className="snap-col">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="label" style={{ color: '#fff' }}>{s.label}</span>
                <span className="tiny muted">{list.length}</span>
              </div>
              <div className="col" style={{ gap: 6 }}>
                {list.slice(0, 4).map((t) => (
                  <button key={t.id} className="snap-card" onClick={() => setUI({ taskId: t.id })}>
                    <span className="row" style={{ gap: 6 }}>
                      <Prio p={t.priority} />
                      <span className="label mono">{keyOf(t)}</span>
                      <span className="spacer" />
                      <Avatar agent={agents.find((a) => a.id === t.assignee_id)} size={18} />
                    </span>
                    <span className="trunc" style={{ color: '#fff', textAlign: 'left', fontSize: 13 }}>{t.title}</span>
                  </button>
                ))}
                {list.length === 0 ? <span className="tiny muted" style={{ padding: '4px 2px' }}>—</span> : null}
                {list.length > 4 ? <a className="link tiny" href={`#/board/${board.id}`}>+{list.length - 4} more</a> : null}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** On-time gauge + headline numbers from /api/analytics (30 days). */
function MonthGauge() {
  const [a, setA] = useState(null);
  const taskSig = useStore((s) => s.tasks.filter((t) => t.status === 'done').length);
  useEffect(() => { api.get('/analytics?days=30').then(setA).catch(() => setA(false)); }, [taskSig]);
  if (a === null) return <div className="chart-empty" style={{ height: 220 }}><span className="label">Loading</span></div>;
  if (!a) return <div className="chart-empty" style={{ height: 220 }}><span className="small muted">Couldn’t load analytics.</span></div>;
  const t = a.totals;
  const fmt = (h) => (h == null ? '—' : h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : `${h < 10 ? h.toFixed(1) : Math.round(h)}h`);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="gauge-box" style={{ height: 150 }}>
        {t.on_time == null
          ? <div className="col" style={{ alignItems: 'center', gap: 6 }}><span className="label">On-time rate</span><span className="small muted">Add deadlines to track it</span></div>
          : <Gauge value={t.on_time} totalNotches={30} defaultLabel="On time" suffix="%" activeFill="#847dff" inactiveFill="#2e2e2e" inactiveFillOpacity={1} width={220} height={150} />}
      </div>
      <div className="mini-kpis">
        <div><span className="label">Shipped</span><b>{t.completed}</b></div>
        <div><span className="label">Cycle</span><b>{fmt(t.cycle_h)}</b></div>
        <div><span className="label">Pickup</span><b>{t.pickup_min == null ? '—' : fmt(t.pickup_min / 60)}</b></div>
      </div>
    </div>
  );
}
