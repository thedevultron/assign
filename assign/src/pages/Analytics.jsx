import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { curveMonotoneX } from '@visx/curve';
import Icon from '../components/Icon.jsx';
import { AnimatedNumber, Seg, Avatar, Button, KanbanLoader, EASE } from '../components/ui.jsx';
import LivePulse from '../components/LivePulse.jsx';
import {
  LineChart, Line, AreaChart, Area, Grid, XAxis, ChartTooltip, BarChart, Bar, BarXAxis,
  PieChart, PieSlice, PieCenter, FunnelChart, Gauge,
  HeatmapChart, HeatmapCells, HeatmapXAxis, HeatmapYAxis, HeatmapTooltip,
} from '@/components/charts';
import { useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import { providerLabel } from '../lib/helpers.js';

const fade = (i = 0) => ({ initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9, ease: EASE, delay: 0.05 * i } });
const RANGES = [{ value: 7, label: '7D' }, { value: 14, label: '14D' }, { value: 30, label: '30D' }, { value: 90, label: '90D' }];
const PRIO_COLORS = { critical: '#dd90d8', high: '#847dff', medium: '#90b8f0', low: '#6a6b6b' };
const PRIO_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const HEAT_LEVELS = ['#18191a', '#2b2a5e', '#4b49aa', '#847dff', '#d1c9ff'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parseDay = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };

export function fmtTok(n) { if (!n) return '0'; if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`; if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`; return `${n}`; }
function fmtHours(h) {
  if (h == null) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}
function delta(cur, prev) {
  if (cur == null || prev == null) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** Tiny inline sparkline for KPI cards (no axes, no fills — flat Origin style). */
function Spark({ values, color = '#847dff' }) {
  const v = values.map((x) => x ?? 0);
  if (v.length < 2 || v.every((x) => x === 0)) return <svg className="kpi-spark" viewBox="0 0 100 28" aria-hidden="true"><line x1="0" y1="26" x2="100" y2="26" stroke="#2e2e2e" strokeWidth="1" /></svg>;
  const max = Math.max(...v, 1);
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 100},${26 - (x / max) * 22}`).join(' ');
  return (
    <svg className="kpi-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <motion.polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: EASE }} />
    </svg>
  );
}

function Kpi({ label, value, display, prev, unit, lowerIsBetter, spark, color, i, hint }) {
  const d = delta(value, prev);
  const good = d == null || d === 0 ? null : lowerIsBetter ? d < 0 : d > 0;
  return (
    <motion.div className="kpi" {...fade(i)}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <span className="label">{label}</span>
        {d == null ? <span className="kpi-delta flat">new</span>
          : <span className={`kpi-delta ${good == null ? 'flat' : good ? 'up' : 'down'}`}>{d > 0 ? '▲' : d < 0 ? '▼' : '•'} {Math.abs(d)}%</span>}
      </div>
      <span className="big">{display ?? (value == null ? '—' : <AnimatedNumber value={value} />)}{unit && value != null ? <small>{unit}</small> : null}</span>
      <Spark values={spark} color={color} />
      <span className="tiny muted">{hint}</span>
    </motion.div>
  );
}

function Empty({ text = 'No data in this range yet.' }) {
  return <div className="chart-empty"><span className="label">Nothing yet</span><span className="small muted">{text}</span></div>;
}

export default function Analytics() {
  const [days, setDays] = useState(() => +localStorage.getItem('assign:range') || 30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [hoverPie, setHoverPie] = useState(null);
  const activityLen = useStore((s) => s.activity.length);
  const taskSig = useStore((s) => s.tasks.map((t) => t.status).join());
  const timer = useRef(null);

  const load = (d = days) => api.get(`/analytics?days=${d}`).then((r) => { setData(r); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { setData(null); load(days); localStorage.setItem('assign:range', String(days)); }, [days]); // eslint-disable-line
  // live: recompute a few seconds after new activity or status changes
  useEffect(() => {
    if (!data) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => load(), 4000);
    return () => clearTimeout(timer.current);
  }, [activityLen, taskSig]); // eslint-disable-line

  const v = useMemo(() => {
    if (!data) return null;
    const daily = data.daily.map((d) => ({ date: parseDay(d.day), created: d.created, completed: d.completed, cycle: d.cycle_h ?? 0 }));
    const hasFlow = daily.some((d) => d.created || d.completed);
    const hasCycle = daily.some((d) => d.cycle);
    // funnel = how many tasks reached at least each stage
    const order = ['backlog', 'queued', 'in_progress', 'review', 'done'];
    const counts = Object.fromEntries(data.funnel.map((f) => [f.status, f.count]));
    const stageNames = ['Created', 'Sent', 'Started', 'Handed back', 'Done'];
    const funnel = order.map((s, i) => ({ label: stageNames[i], value: order.slice(i).reduce((n, k) => n + (counts[k] || 0), 0) }));
    const pie = data.priorities.filter((p) => p.created > 0).map((p) => ({ label: PRIO_LABEL[p.priority], value: p.created, color: PRIO_COLORS[p.priority] }));
    const agents = data.per_agent.filter((a) => a.completed || a.active || a.review || a.events).map((a) => ({ name: a.name, completed: a.completed, active: a.active + a.review }));
    // calendar heatmap: full Sunday-start weeks
    const cal = data.calendar || [];
    const columns = [];
    if (cal.length) {
      const counts2 = Object.fromEntries(cal.map((c) => [c.day, c.count]));
      const first = parseDay(cal[0].day); first.setDate(first.getDate() - first.getDay());
      const last = parseDay(cal[cal.length - 1].day);
      for (let w = 0, d = new Date(first); d <= last; w++) {
        const bins = [];
        for (let r = 0; r < 7; r++) {
          const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          bins.push({ bin: r, count: counts2[k] || 0, date: new Date(d) });
          d.setDate(d.getDate() + 1);
        }
        columns.push({ bin: w, bins });
      }
    }
    const calMax = Math.max(1, ...cal.map((c) => c.count));
    const heatMax = Math.max(1, ...data.heatmap.flat());
    const u = data.usage || { daily: [], models: [], agents: [] };
    const usageDaily = (u.daily || []).map((d) => ({ date: parseDay(d.day), tokens: d.tokens_in + d.tokens_out, cost: +(d.cost_usd || 0).toFixed(4) }));
    const hasUsage = usageDaily.some((d) => d.tokens || d.cost);
    const models = (u.models || []).filter((m) => m.tokens_in + m.tokens_out || m.cost_usd);
    const agentUsage = (u.agents || []).map((a) => {
      const info = data.per_agent.find((x) => x.id === a.agent_id) || {};
      return { name: info.name || 'Unknown', color: info.color || '#847dff', tokens: a.tokens_in + a.tokens_out, cost: a.cost_usd || 0, reports: a.reports };
    }).filter((x) => x.tokens || x.cost);
    const usageTotals = { tokens: (u.tokens_in || 0) + (u.tokens_out || 0), cost: u.cost_usd || 0, reports: u.reports || 0 };
    return { daily, hasFlow, hasCycle, funnel, pie, agents, columns, calMax, heatMax, calTotal: cal.reduce((n, c) => n + c.count, 0), usageDaily, hasUsage, models, agentUsage, usageTotals };
  }, [data]);

  const colorScale = (c) => {
    if (!c) return HEAT_LEVELS[0];
    const r = c / (v?.calMax || 1);
    return HEAT_LEVELS[r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1];
  };

  const t = data?.totals, p = data?.previous;
  return (
    <div className="page">
      <motion.div className="page-head" {...fade(0)}>
        <div className="grow">
          <span className="label">Analytics · {data?.timezone || 'workspace time'}</span>
          <h1 className="h1">How your agents <em>are doing.</em></h1>
          <p className="lede" style={{ marginTop: 14 }}>Real task history, compared against the previous {days} days.</p>
        </div>
        <Seg options={RANGES} value={days} onChange={setDays} />
      </motion.div>

      {err ? <div className="warnbox"><Icon name="alert" size={16} />{err}<Button size="sm" variant="ghost" onClick={() => load()}>Retry</Button></div> : null}
      {!data && !err ? <div style={{ display: 'grid', placeItems: 'center', padding: '80px 0' }}><KanbanLoader label="Crunching numbers" /></div> : null}

      {data && v && (
        <>
          <section className="kpis">
            <Kpi i={1} label="Shipped" value={t.completed} prev={p.completed} spark={v.daily.map((d) => d.completed)} color="#00b3dd" hint={`${p.completed} the period before`} />
            <Kpi i={2} label="Created" value={t.created} prev={p.created} spark={v.daily.map((d) => d.created)} color="#847dff" hint={`${data.open} open right now`} />
            <Kpi i={3} label="Cycle time" value={t.cycle_h} display={fmtHours(t.cycle_h)} prev={p.cycle_h} lowerIsBetter spark={v.daily.map((d) => d.cycle)} color="#90b8f0" hint="Median, claim → done" />
            <Kpi i={4} label="Pickup" value={t.pickup_min} display={t.pickup_min == null ? '—' : fmtHours(t.pickup_min / 60)} prev={p.pickup_min} lowerIsBetter spark={[]} hint="Median, sent → claimed" />
            <Kpi i={5} label="On time" value={t.on_time} unit="%" prev={p.on_time} spark={[]} color="#dd90d8" hint={t.with_deadline ? `${t.with_deadline} tasks had a deadline` : 'No deadlines in range'} />
            <Kpi i={6} label="Agent events" value={t.agent_events} prev={p.agent_events} spark={[]} hint="Tool calls that changed something" />
          </section>

          <section className="grid-2">
            <motion.div className="panel" {...fade(3)}>
              <div className="section-head"><span className="h4">Throughput</span><span className="label">Per day</span><span className="spacer" />
                <span className="row tiny" style={{ gap: 14 }}><span className="row" style={{ gap: 6 }}><i className="lg-dot" style={{ background: '#00b3dd' }} />Shipped</span><span className="row" style={{ gap: 6 }}><i className="lg-dot" style={{ background: '#847dff' }} />Created</span></span>
              </div>
              {v.hasFlow ? (
                <div className="chart-box">
                  <LineChart key={days} data={v.daily} aspectRatio="auto" className="h-full" animationDuration={1400}>
                    <Grid horizontal />
                    <Line dataKey="created" stroke="#847dff" strokeWidth={1.5} curve={curveMonotoneX} />
                    <Line dataKey="completed" stroke="#00b3dd" strokeWidth={2} curve={curveMonotoneX} />
                    <XAxis />
                    <ChartTooltip />
                  </LineChart>
                </div>
              ) : <Empty text="Created and shipped tasks will chart here." />}
            </motion.div>
            <motion.div className="panel gauge-panel" {...fade(4)}>
              <div className="section-head"><span className="h4">On-time rate</span><span className="label">{t.with_deadline} with deadline</span></div>
              {t.on_time == null ? <Empty text="Give tasks a deadline to track this." /> : (
                <div className="gauge-box">
                  <Gauge key={days} value={t.on_time} totalNotches={36} defaultLabel="On time" suffix="%" activeFill="#847dff" inactiveFill="#2e2e2e" inactiveFillOpacity={1} width={260} height={180} />
                </div>
              )}
            </motion.div>
          </section>

          <section className="grid-2">
            <motion.div className="panel" {...fade(5)}>
              <div className="section-head"><span className="h4">Cycle time</span><span className="label">Median hours, claim → done</span></div>
              {v.hasCycle ? (
                <div className="chart-box">
                  <AreaChart key={days} data={v.daily.map((d) => ({ date: d.date, hours: d.cycle }))} aspectRatio="auto" className="h-full" animationDuration={1400}>
                    <Grid horizontal />
                    <Area dataKey="hours" stroke="#90b8f0" fill="#90b8f0" fillOpacity={0.12} gradientToOpacity={0.12} strokeWidth={1.75} curve={curveMonotoneX} />
                    <XAxis />
                    <ChartTooltip />
                  </AreaChart>
                </div>
              ) : <Empty text="Appears once agents finish claimed tasks." />}
            </motion.div>
            <motion.div className="panel ring-panel" {...fade(6)}>
              <div className="section-head"><span className="h4">Priority mix</span><span className="label">Created in range</span></div>
              {v.pie.length ? (
                <div className="ring-row">
                  <PieChart key={days} data={v.pie} size={200} innerRadius={64} padAngle={0.03} cornerRadius={4} hoveredIndex={hoverPie} onHoverChange={setHoverPie}>
                    {v.pie.map((d, i) => <PieSlice key={d.label} index={i} hoverEffect="translate" />)}
                    <PieCenter defaultLabel="Tasks" />
                  </PieChart>
                  <div className="col" style={{ gap: 8, minWidth: 0 }}>
                    {v.pie.map((d, i) => (
                      <div key={d.label} className="row small" style={{ gap: 10, opacity: hoverPie == null || hoverPie === i ? 1 : 0.4, transition: 'opacity .2s ease' }} onMouseEnter={() => setHoverPie(i)} onMouseLeave={() => setHoverPie(null)}>
                        <i className="lg-dot" style={{ background: d.color }} /><span className="grow">{d.label}</span><span className="num" style={{ color: '#fff' }}>{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <Empty text="Create tasks to see the mix." />}
            </motion.div>
          </section>

          <section className="grid-2">
            <motion.div className="panel" {...fade(7)}>
              <div className="section-head"><span className="h4">Pipeline funnel</span><span className="label">How far tasks get</span></div>
              {v.funnel[0].value ? (
                <div className="funnel-box">
                  <FunnelChart key={days} data={v.funnel} color="#847dff" layers={3} showPercentage showValues showLabels gap={4} edges="curved" grid={{ bands: true, bandColor: 'rgba(255,255,255,0.02)', lines: true, lineColor: 'rgba(255,255,255,0.06)' }} />
                </div>
              ) : <Empty text="Your pipeline will appear once you have tasks." />}
            </motion.div>
            <motion.div className="panel" {...fade(8)}>
              <div className="section-head"><span className="h4">By agent</span><span className="label">Shipped vs. in flight</span><span className="spacer" />
                <span className="row tiny" style={{ gap: 14 }}><span className="row" style={{ gap: 6 }}><i className="lg-dot" style={{ background: '#00b3dd' }} />Shipped</span><span className="row" style={{ gap: 6 }}><i className="lg-dot" style={{ background: '#847dff' }} />In flight</span></span>
              </div>
              {v.agents.length ? (
                <div className="chart-box">
                  <BarChart key={days} data={v.agents} xDataKey="name" aspectRatio="auto" className="h-full">
                    <Grid horizontal />
                    <Bar dataKey="completed" fill="#00b3dd" lineCap="round" />
                    <Bar dataKey="active" fill="#847dff" lineCap="round" />
                    <BarXAxis />
                    <ChartTooltip />
                  </BarChart>
                </div>
              ) : <Empty text="Agents appear here once they work on something." />}
            </motion.div>
          </section>

          <section className="grid-2">
            <motion.div className="panel" {...fade(8)}>
              <div className="section-head"><span className="h4">Tokens</span><span className="label">Self-reported daily</span><span className="spacer" /><span className="tiny mono" style={{ color: '#d1c9ff' }}>{fmtTok(v.usageTotals.tokens)} total</span></div>
              {v.hasUsage ? (
                <div className="chart-box">
                  <AreaChart key={`u${days}`} data={v.usageDaily} aspectRatio="auto" className="h-full" animationDuration={1400}>
                    <Grid horizontal />
                    <Area dataKey="tokens" stroke="#dd90d8" fill="#dd90d8" fillOpacity={0.1} gradientToOpacity={0.1} strokeWidth={1.75} curve={curveMonotoneX} />
                    <XAxis />
                    <ChartTooltip />
                  </AreaChart>
                </div>
              ) : <Empty text="Agents report tokens with the report_usage tool once they finish work." />}
            </motion.div>
            <motion.div className="panel" {...fade(8)}>
              <div className="section-head"><span className="h4">Estimated cost</span><span className="label">Self-reported, exact only</span><span className="spacer" /><span className="tiny mono" style={{ color: '#d1c9ff' }}>{v.usageTotals.cost ? `$${v.usageTotals.cost.toFixed(2)}` : '—'}</span></div>
              {v.usageDaily.some((d) => d.cost) ? (
                <div className="chart-box">
                  <AreaChart key={`c${days}`} data={v.usageDaily} aspectRatio="auto" className="h-full" animationDuration={1400}>
                    <Grid horizontal />
                    <Area dataKey="cost" stroke="#00b3dd" fill="#00b3dd" fillOpacity={0.1} gradientToOpacity={0.1} strokeWidth={1.75} curve={curveMonotoneX} />
                    <XAxis />
                    <ChartTooltip />
                  </AreaChart>
                </div>
              ) : <Empty text="Cost appears when agents include cost_usd in their usage report. Token counts still chart on the left." />}
            </motion.div>
          </section>

          {v.models.length || v.agentUsage.length ? (
            <section className="grid-2">
              {v.models.length ? (
                <motion.div className="panel" {...fade(9)}>
                  <div className="section-head"><span className="h4">By model</span><span className="label">Tokens + cost</span></div>
                  <div className="col" style={{ gap: 10 }}>
                    {v.models.slice(0, 6).map((m, i) => {
                      const max = Math.max(...v.models.map((x) => x.tokens_in + x.tokens_out)) || 1;
                      const tot = m.tokens_in + m.tokens_out;
                      return (
                        <div key={m.model} className="row" style={{ gap: 10, minWidth: 0 }}>
                          <span className="small mono grow trunc" style={{ color: '#fff' }}>{m.model}</span>
                          <span className="usage-bar"><i style={{ width: `${(tot / max) * 100}%`, background: i % 2 ? '#847dff' : '#dd90d8' }} /></span>
                          <span className="tiny mono muted" style={{ width: 66, textAlign: 'right' }}>{fmtTok(tot)}</span>
                          <span className="tiny mono muted" style={{ width: 56, textAlign: 'right' }}>{m.cost_usd ? `$${m.cost_usd.toFixed(2)}` : '—'}</span>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              ) : null}
              {v.agentUsage.length ? (
                <motion.div className="panel" {...fade(9)}>
                  <div className="section-head"><span className="h4">By agent</span><span className="label">Who consumed what</span></div>
                  <div className="col" style={{ gap: 10 }}>
                    {v.agentUsage.slice(0, 6).map((a) => {
                      const max = Math.max(...v.agentUsage.map((x) => x.tokens)) || 1;
                      return (
                        <div key={a.name} className="row" style={{ gap: 10, minWidth: 0 }}>
                          <i className="lg-dot" style={{ background: a.color }} />
                          <span className="small grow trunc" style={{ color: '#fff' }}>{a.name}</span>
                          <span className="usage-bar"><i style={{ width: `${(a.tokens / max) * 100}%`, background: a.color }} /></span>
                          <span className="tiny mono muted" style={{ width: 66, textAlign: 'right' }}>{fmtTok(a.tokens)}</span>
                          <span className="tiny mono muted" style={{ width: 56, textAlign: 'right' }}>{a.cost ? `$${a.cost.toFixed(2)}` : '—'}</span>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              ) : null}
            </section>
          ) : null}

          <motion.section className="panel" {...fade(9)}>
            <div className="section-head"><span className="h4">Activity calendar</span><span className="label">Last 26 weeks · {v.calTotal} events</span><span className="spacer" /><HeatmapLegendInline /></div>
            {v.columns.length ? (
              <div className="heat-box">
                <HeatmapChart data={v.columns} layout="fluid" gap={3} colorScale={colorScale} levelColors={HEAT_LEVELS} margin={{ top: 22, right: 4, bottom: 4, left: 34 }}>
                  <HeatmapCells cornerRadius={3} colorScale={colorScale} />
                  <HeatmapXAxis />
                  <HeatmapYAxis />
                  <HeatmapTooltip formatLabel={(c, d) => `${c} event${c === 1 ? '' : 's'} · ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`} />
                </HeatmapChart>
              </div>
            ) : <Empty />}
          </motion.section>

          <section className="grid-2">
            <motion.div className="panel" {...fade(10)}>
              <div className="section-head"><span className="h4">Busiest hours</span><span className="label">Agent activity by weekday × hour</span></div>
              <div className="hours" role="img" aria-label="Agent activity by weekday and hour">
                <span />
                {Array.from({ length: 24 }, (_, h) => <span key={h} className="hours-h">{h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>)}
                {data.heatmap.map((row, d) => (
                  <Row key={d} label={DOW[d]} row={row} max={v.heatMax} />
                ))}
              </div>
            </motion.div>
            <motion.div className="panel" {...fade(11)}>
              <div className="section-head"><span className="h4">Live pulse</span><span className="label">Agent events, trailing 2 min</span><span className="spacer" /><span className="conn label on" style={{ height: 'auto' }}><i />Live</span></div>
              <LivePulse height={240} />
            </motion.div>
          </section>

          <motion.section className="panel" {...fade(12)}>
            <div className="section-head"><span className="h4">Agent leaderboard</span><span className="label">{days} days</span></div>
            {data.per_agent.length ? (
              <div className="lb">
                <div className="lb-row lb-head label"><span>Agent</span><span>Shipped</span><span>In flight</span><span>Review</span><span>Cycle</span><span>Events</span></div>
                {[...data.per_agent].sort((a, b) => b.completed - a.completed || b.events - a.events).map((a) => (
                  <div key={a.id} className="lb-row">
                    <span className="row" style={{ gap: 10, minWidth: 0 }}><Avatar agent={useStore.getState().agents.find((x) => x.id === a.id) || a} size={24} /><span className="col" style={{ gap: 0, minWidth: 0 }}><span className="trunc" style={{ color: '#fff' }}>{a.name}</span><span className="tiny muted trunc">{providerLabel(a.provider)}</span></span></span>
                    <span className="num">{a.completed}</span><span className="num">{a.active}</span><span className="num">{a.review}</span><span className="num">{fmtHours(a.cycle_h)}</span><span className="num">{a.events}</span>
                  </div>
                ))}
              </div>
            ) : <Empty text="Add an agent to see its numbers." />}
          </motion.section>
          <p className="tiny muted" style={{ margin: 0 }}>Charts by bklit UI. Updated {new Date(data.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · refreshes as agents work.</p>
        </>
      )}
    </div>
  );
}

function Row({ label, row, max }) {
  return (
    <>
      <span className="hours-d">{label}</span>
      {row.map((n, h) => <i key={h} title={`${label} ${String(h).padStart(2, '0')}:00 · ${n}`} style={{ background: n ? HEAT_LEVELS[Math.min(4, 1 + Math.floor((n / max) * 3.999))] : HEAT_LEVELS[0] }} />)}
    </>
  );
}

function HeatmapLegendInline() {
  return (
    <span className="row tiny muted" style={{ gap: 6 }}>Less{HEAT_LEVELS.map((c) => <i key={c} style={{ width: 10, height: 10, borderRadius: 3, background: c, display: 'inline-block' }} />)}More</span>
  );
}
