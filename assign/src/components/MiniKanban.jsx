import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

/* A pockable mini-board: cards cycle on their own; clicking a card nudges it one
   column over; clicking "assign agent" makes it work with a live progress bar. */

const PRIO = { high: '#e5484d', medium: '#847dff', low: '#5b5b5f' };
const COLS = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'doing', label: 'In progress' },
  { id: 'done', label: 'Done' },
];
const AGENTS = [
  { name: 'Mira', color: '#847dff', initials: 'MI', tool: 'claude' },
  { name: 'Taige', color: '#00b3dd', initials: 'TA', tool: 'codex' },
];
const IDEAS = [
  'Wire SSE reconnects to heartbeat', 'Cache skill.zip in memory', 'Rate-limit pairing per agent',
  'Add retry backoff to dispatch', 'Truncate inbox bodies at 4 KB', 'Prune analytics cache daily',
  'Accept assigned_cls on tasks', 'Index tasks by board+status', 'Ship gzip for /api/export',
  'Batch inbox deletes nightly',
];

let seq = 100;
const seed = () => [
  { id: ++seq, title: 'Fix flaky auth test', col: 'backlog', prio: 'high', agent: null, progress: 0, log: '' },
  { id: ++seq, title: 'Darken task-drawer backdrop', col: 'backlog', prio: 'low', agent: null, progress: 0, log: '' },
  { id: ++seq, title: 'Type-safe analytics payload', col: 'doing', prio: 'medium', agent: 0, progress: 64, log: 'running vitest coverage…' },
  { id: ++seq, title: 'Gzip /api/bootstrap', col: 'doing', prio: 'medium', agent: 1, progress: 31, log: 'benching 99th pct…' },
  { id: ++seq, title: 'Slide-to-approve reviews', col: 'done', prio: 'high', agent: 0, progress: 100, log: 'shipped in 1.7.0' },
];

export default function MiniKanban() {
  const [cards, setCards] = useState(seed);
  const [count, setCount] = useState(1);
  const busy = useRef(false);

  // the board breathes on its own: working cards tick; there's always something new
  useEffect(() => {
    const t = setInterval(() => {
      setCards((cs) => {
        const working = cs.filter((c) => c.agent != null && c.col === 'doing');
        if (!working.length || Math.random() < 0.28) {
          const freeBacklog = cs.find((c) => c.col === 'backlog');
          const idle = Math.random() < 0.5 ? 0 : 1;
          if (freeBacklog && !cs.some((c) => c.col === 'doing' && c.agent === idle)) {
            return cs.map((c) => c.id === freeBacklog.id ? { ...c, agent: idle, col: 'doing', progress: 2, log: 'claiming task…' } : c);
          }
        }
        return cs.map((c) => {
          if (c.col !== 'doing' || c.agent == null) return c;
          const gain = 6 + Math.random() * 10;
          const p = Math.min(100, c.progress + gain);
          const log = p < 30 ? 'reading the code…' : p < 60 ? 'editing files…' : p < 90 ? 'running tests…' : 'wrapping up + summary…';
          if (p >= 100) return { ...c, progress: 100, col: 'done', log: `${AGENTS[c.agent].name} shipped it ✓` };
          return { ...c, progress: p, log };
        });
      });
    }, 1400);
    const t2 = setInterval(() => {
      setCards((cs) => {
        const open = cs.filter((c) => c.col !== 'done').length;
        if (open >= 5) return cs;
        const idea = IDEAS[(seq) % IDEAS.length];
        return [...cs, { id: ++seq, title: idea, col: 'backlog', prio: ['high', 'medium', 'low'][seq % 3], agent: null, progress: 0, log: '' }];
      });
    }, 9000);
    return () => { clearInterval(t); clearInterval(t2); };
  }, []);

  const poke = (card) => {
    if (busy.current) return; busy.current = true;
    setTimeout(() => (busy.current = false), 120);
    setCards((cs) => cs.map((c) => {
      if (c.id !== card.id) return c;
      if (c.col === 'backlog') return { ...c, col: 'doing', agent: card.agent ?? (Math.random() < 0.5 ? 0 : 1), progress: Math.max(c.progress, 4), log: 'claiming task…' };
      if (c.col === 'doing') { setCount((n) => n + 1); return { ...c, col: 'done', progress: 100, log: 'shipped it ✓' }; }
      return c;
    }));
  };

  return (
    <div className="mini-board" aria-label="Interactive mini kanban">
      <div className="mini-head">
        <span className="label">demo · click any card</span>
        <span className="mini-dots"><i /><i /><i /></span>
        <span className="label">{count} shipped</span>
      </div>
      <div className="mini-cols">
        {COLS.map((col) => (
          <div key={col.id} className="mini-col">
            <div className="mini-col-head">
              <span>{col.label}</span>
              <span className="num">{cards.filter((c) => c.col === col.id).length}</span>
            </div>
            <AnimatePresence initial={false}>
              {cards.filter((c) => c.col === col.id).map((c) => (
                <motion.button key={c.id} layout layoutId={`mk-${c.id}`} className={`mini-card ${col.id}`} onClick={() => poke(c)}
                  initial={{ opacity: 0, scale: 0.92, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.88 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 34, mass: 0.9 }}>
                  <span className="mini-card-title">{c.title}</span>
                  {col.id === 'doing' && c.agent != null ? (
                    <span className="mini-progress"><i style={{ width: `${c.progress}%`, background: AGENTS[c.agent].color }} /></span>
                  ) : null}
                  <span className="mini-card-meta">
                    <span className="mini-prio" style={{ background: PRIO[c.prio] }} />
                    {c.agent != null && col.id !== 'backlog' ? (
                      <span className="mini-av" style={{ background: AGENTS[c.agent].color }}>{AGENTS[c.agent].initials}</span>
                    ) : <span className="mini-av ghost">?</span>}
                    <span className="mini-log">{c.log || 'waiting'}</span>
                  </span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}
