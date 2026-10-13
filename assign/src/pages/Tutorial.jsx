import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Icon from '../components/Icon.jsx';
import { Button, BorderTrace, EASE, EASE_OUT } from '../components/ui.jsx';
import { useStore } from '../lib/store.js';

const KEY = 'assign:tutorial';

const STEPS = [
  {
    id: 'task', icon: 'board', title: 'Create your first task', link: '#/', linkLabel: 'Open overview',
    body: 'Press N anywhere (or “New task” on a board). Write the task like you’d brief a teammate — outcome first, context after.',
  },
  {
    id: 'agent', icon: 'agents', title: 'Connect an agent', link: '#/agents', linkLabel: 'Open agents',
    body: 'Agents → Connect agent. Pick your coding tool, download the skill (or paste the MCP config), start the tool, then approve it with the 6-digit pairing code.',
  },
  {
    id: 'dispatch', icon: 'send', title: 'Dispatch the task', link: '#/', linkLabel: 'Open your board',
    body: 'Assign it to an agent — or “Auto” and let routing pick. Urgent? Use Send now. Otherwise your Sending preset decides when it goes out.',
  },
  {
    id: 'live', icon: 'activity', title: 'Watch it work', link: '#/agents', linkLabel: 'See live agents',
    body: 'The agent claims the task, works on its own branch, and lives on the Agents page while it runs. Multiple agents never collide — each gets its own claim.',
  },
  {
    id: 'review', icon: 'inbox', title: 'Review the hand-back', link: '#/activity', linkLabel: 'Open inbox',
    body: 'Finished work lands in Review with a summary. Approve it to Done, or send it back with a comment — the agent picks it up again.',
  },
  {
    id: 'ai', icon: 'magic', title: 'Meet the assistant', link: '#/settings/ai', linkLabel: 'Add an AI key',
    body: 'Settings → AI assistant → add a Google (Gemini) key. Chat can create, assign and move tasks for you; hold the orb for voice. Keys are encrypted server-side.',
  },
  {
    id: 'auto', icon: 'automations', title: 'Automate the boring parts', link: '#/automations', linkLabel: 'Open automations',
    body: 'Auto-dispatch on creation, nudge stale tasks, daily digests. Pick a template and flip it on.',
  },
  {
    id: 'analytics', icon: 'chart', title: 'Read the numbers', link: '#/analytics', linkLabel: 'Open analytics',
    body: 'Throughput, cycle time and per-agent stats — everything your agents did, counted.',
  },
];

function load() { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); } }

export default function Tutorial() {
  const [done, setDone] = useState(load);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify([...done])); } catch { /* private mode */ } }, [done]);
  const toggle = (id) => setDone((d) => { const n = new Set(d); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pct = Math.round((done.size / STEPS.length) * 100);
  const complete = done.size === STEPS.length;
  const links = useMemo(() => [
    { label: 'Replay setup', icon: 'refresh', onClick: () => { location.hash = '#/onboarding'; } },
    { label: 'Download the agent skill', icon: 'download', href: '/skill/assign-skill.zip' },
    { label: 'Keyboard shortcuts', icon: 'command', onClick: () => useStore.getState().setUI({ palette: true }) },
    { label: 'Read the docs', icon: 'file', onClick: () => { location.hash = '#/docs'; } },
  ], []);

  return (
    <div className="page">
      <motion.div className="page-head" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE }}>
        <div className="grow">
          <span className="label">Tutorial</span>
          <h1 className="h1">Up to speed in <em>eight steps.</em></h1>
          <p className="lede" style={{ marginTop: 14, maxWidth: 560 }}>A hands-on tour of assign — from first task to a reviewed, merged result. Your progress is saved on this device.</p>
        </div>
      </motion.div>

      <motion.div className="panel" style={{ padding: '16px 22px', maxWidth: 720 }} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.06 }}>
        <div className="row" style={{ gap: 14 }}>
          <div className="tut-bar grow" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><motion.span animate={{ width: pct + '%' }} transition={{ duration: 0.5, ease: EASE_OUT }} /></div>
          <span className="small" style={{ color: pct === 100 ? '#9be3b4' : undefined, fontVariantNumeric: 'tabular-nums' }}>{complete ? 'Complete' : `${done.size} / ${STEPS.length}`}</span>
          {done.size > 0 && !complete ? <button className="small muted link-btn" onClick={() => setDone(new Set())}>Reset</button> : null}
        </div>
        <AnimatePresence>{complete ? (
          <motion.p className="small" style={{ color: '#9be3b4', marginTop: 10, marginBottom: 0 }} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            Nice one — you know the whole loop. Everything else lives in Settings.
          </motion.p>
        ) : null}</AnimatePresence>
      </motion.div>

      <div className="col" style={{ gap: 12, maxWidth: 720 }}>
        {STEPS.map((s, i) => {
          const isDone = done.has(s.id);
          return (
            <motion.div key={s.id} className={`panel tut-step${isDone ? ' done' : ''}`} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE, delay: 0.08 + i * 0.05 }}>
              {isDone ? <BorderTrace radius={16} /> : null}
              <button className={`tut-check${isDone ? ' on' : ''}`} onClick={() => toggle(s.id)} aria-label={isDone ? 'Mark not done' : 'Mark done'} aria-pressed={isDone}>
                {isDone ? <Icon name="check" size={13} /> : <span className="tut-num">{i + 1}</span>}
              </button>
              <div className="col grow" style={{ gap: 6, minWidth: 0 }}>
                <span className="row" style={{ gap: 10 }}><Icon name={s.icon} size={16} /><span style={{ color: '#fff', fontSize: 15 }}>{s.title}</span></span>
                <p className="small muted" style={{ margin: 0 }}>{s.body}</p>
              </div>
              <a className="btn btn-ghost btn-sm" href={s.link} style={{ flex: 'none' }}>{s.linkLabel}<Icon name="right" size={13} /></a>
            </motion.div>
          );
        })}
      </div>

      <motion.div className="col" style={{ gap: 14, maxWidth: 720, marginTop: 12 }} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.2 }}>
        <span className="label">Handy links</span>
        <div className="row wrap" style={{ gap: 8 }}>
          {links.map((l) => l.href
            ? <a key={l.label} className="btn btn-ghost btn-sm" href={l.href} download><Icon name={l.icon} size={14} />{l.label}</a>
            : <Button key={l.label} size="sm" variant="ghost" arrow={false} onClick={l.onClick}><Icon name={l.icon} size={14} />{l.label}</Button>)}
        </div>
      </motion.div>
    </div>
  );
}
