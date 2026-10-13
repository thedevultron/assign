import { useEffect, useMemo, useRef, useState } from 'react';
import { curveMonotoneX } from '@visx/curve';
import { LiveLineChart, LiveLine, LiveXAxis, LiveYAxis, Grid } from '@/components/charts';
import { useStore } from '../lib/store.js';

const STEP = 3; // seconds between samples
const SPAN = 120; // rolling count window (s)

/** Real-time agent pulse: events in the trailing 2 minutes, sampled every 3 s (bklit Live Line). */
export default function LivePulse({ windowSecs = 300, height = 220 }) {
  const activity = useStore((s) => s.activity);
  const actRef = useRef(activity);
  actRef.current = activity;
  const countAt = (t) => {
    const from = (t - SPAN) * 1000, to = t * 1000;
    let n = 0;
    for (const e of actRef.current) { const x = Date.parse(e.created_at); if (x > from && x <= to && (e.actor === 'agent' || e.kind === 'dispatch' || e.kind === 'status')) n++; }
    return n;
  };
  const [data, setData] = useState(() => {
    const now = Date.now() / 1000;
    const pts = [];
    for (let t = now - windowSecs; t <= now; t += STEP) pts.push({ time: t, value: countAt(t) });
    return pts;
  });
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now() / 1000;
      setData((d) => [...d.filter((p) => p.time > t - windowSecs - 30), { time: t, value: countAt(t) }]);
    }, STEP * 1000);
    return () => clearInterval(id);
  }, [windowSecs]); // eslint-disable-line
  // nudge immediately when a new event arrives
  useEffect(() => { const t = Date.now() / 1000; setData((d) => [...d, { time: t, value: countAt(t) }]); }, [activity.length]); // eslint-disable-line
  const value = data.length ? data[data.length - 1].value : 0;
  const fmt = useMemo(() => (v) => `${Math.round(v)}`, []);
  return (
    <LiveLineChart data={data} value={value} window={windowSecs} numXTicks={5} margin={{ top: 16, right: 56, bottom: 28, left: 8 }} style={{ height }}>
      <Grid horizontal numTicksRows={4} />
      <LiveLine dataKey="value" stroke="#00b3dd" strokeWidth={1.75} curve={curveMonotoneX} fill pulse badge formatValue={fmt} momentumColors={{ up: '#00b3dd', down: '#847dff', flat: '#00b3dd' }} />
      <LiveXAxis numTicks={5} formatTime={(t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
      <LiveYAxis position="right" allowDecimals={false} formatValue={fmt} />
    </LiveLineChart>
  );
}
