import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Icon from './Icon.jsx';
import { Modal, Seg, Select, TagsInput, Avatar, Prio, Button, Field, Spinner, quick, EASE_OUT } from './ui.jsx';
import { useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import { PRIORITIES, STATUSES, toLocalInput, fromLocalInput, providerLabel, taskKey } from '../lib/helpers.js';

export function policyText(settings, priority) {
  const p = settings?.policy?.[priority];
  if (!p) return '';
  return { instant: 'sent instantly', batched: `batched every ${p.interval} min`, daily: `sent daily at ${p.time}`, manual: 'held until you start it' }[p.mode];
}

export function assigneeOptions(agents, { withAuto = true, withNone = true } = {}) {
  return [
    ...(withAuto ? [{ value: '__auto', label: 'Auto-route', sub: 'Best fit by skills & load', icon: <span className="avatar" style={{ width: 24, height: 24, background: 'transparent', border: '1px solid var(--line-3)', color: '#fff' }}><Icon name="route" size={13} /></span> }] : []),
    ...(withNone ? [{ value: '', label: 'Unassigned', sub: 'Keep it on the board', icon: <Avatar agent={null} size={24} /> }] : []),
    ...agents.map((a) => ({ value: a.id, label: a.name, sub: `${providerLabel(a.provider)}${a.paused ? ' · paused' : ''}`, icon: <Avatar agent={a} size={24} status /> })),
  ];
}

export function RouteHint({ title, description, tags, agents }) {
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!title?.trim()) { setRes(null); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try { setRes(await api.post('/route-preview', { title, description, tags })); } catch { setRes(null); }
      setLoading(false);
    }, 350);
    return () => clearTimeout(t);
  }, [title, description, tags]);
  const agent = agents.find((a) => a.id === res?.agent_id);
  return (
    <motion.div className="route-hint" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={quick}>
      <Icon name="route" size={15} style={{ flex: 'none' }} />
      <AnimatePresence mode="wait">
        <motion.span key={agent?.id || (loading ? 'l' : 'n')} className="row wrap" style={{ gap: 8 }} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.18 }}>
          {!title?.trim() ? 'Type a title to preview routing' : agent ? (<>Would go to <Avatar agent={agent} size={18} /><span style={{ color: '#fff' }}>{agent.name}</span><span className="muted">— {res.reason}</span></>) : loading ? <><Spinner />Finding the best agent…</> : res?.reason || 'No agent available'}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  );
}

export function DeadlineField({ value, onChange }) {
  const presets = [
    { label: 'Today 6pm', get: () => { const d = new Date(); d.setHours(18, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); return d; } },
    { label: 'Tomorrow', get: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(17, 0, 0, 0); return d; } },
    { label: '3 days', get: () => { const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(17, 0, 0, 0); return d; } },
    { label: 'Next week', get: () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(17, 0, 0, 0); return d; } },
  ];
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 6 }}>
        <input type="datetime-local" className="input" value={toLocalInput(value)} onChange={(e) => onChange(fromLocalInput(e.target.value))} />
        {value ? <button type="button" className="icon-btn sm" onClick={() => onChange(null)} aria-label="Clear deadline"><Icon name="close" size={14} /></button> : null}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {presets.map((q) => <button type="button" key={q.label} className="chip" onClick={() => onChange(q.get().toISOString())}>{q.label}</button>)}
      </div>
    </div>
  );
}

const START_OPTS = [
  { value: 'policy', label: 'By priority' },
  { value: 'now', label: 'Send now' },
  { value: 'scheduled', label: 'Schedule' },
  { value: 'manual', label: 'Hold' },
];

export default function TaskComposer() {
  const composer = useStore((s) => s.ui.composer);
  const agents = useStore((s) => s.agents);
  const boards = useStore((s) => s.boards);
  const settings = useStore((s) => s.settings);
  const { setUI, createTask, toast } = useStore.getState();
  const open = !!composer;
  const initial = composer?.initial || {};
  const blank = () => {
    const routeMatch = location.hash.match(/#\/board\/([^/?]+)/);
    return {
      title: '', description: '', acceptance: '', priority: 'medium', status: 'backlog',
      board_id: initial.board_id || (routeMatch && boards.find((b) => b.id === routeMatch[1]) ? routeMatch[1] : boards[0]?.id),
      assign: initial.assignee_id ?? (agents.length ? '__auto' : ''), start_mode: initial.start_mode || 'policy', scheduled_at: null, deadline: null, tags: [], repo: '', branch: '',
      ...Object.fromEntries(Object.entries(initial).filter(([k]) => !['assignee_id'].includes(k))),
    };
  };
  const [f, setF] = useState(blank);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const titleRef = useRef(null);
  useEffect(() => { if (open) { setF(blank()); setErr(''); setMore(false); setBusy(false); setTimeout(() => titleRef.current?.focus(), 80); } }, [open]); // eslint-disable-line
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const close = () => setUI({ composer: null });

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    if (!f.title.trim()) { setErr('Give the task a title'); titleRef.current?.focus(); return; }
    if (!f.board_id) { setErr('Create a board first'); return; }
    if (f.start_mode === 'scheduled' && !f.scheduled_at) { setErr('Pick when this task should start'); return; }
    setBusy(true);
    const payload = {
      title: f.title.trim(), description: f.description, acceptance: f.acceptance, priority: f.priority, status: f.status,
      board_id: f.board_id, assignee_id: f.assign && f.assign !== '__auto' ? f.assign : null, auto_route: f.assign === '__auto',
      start_mode: f.start_mode, scheduled_at: f.start_mode === 'scheduled' ? f.scheduled_at : null, deadline: f.deadline, tags: f.tags, repo: f.repo, branch: f.branch,
    };
    close();
    try {
      const t = await createTask(payload);
      const k = taskKey(useStore.getState().settings, t);
      const a = useStore.getState().agents.find((x) => x.id === t.assignee_id);
      if (t.status === 'queued') toast(`${k} sent to ${a?.name || 'agent'}`, { tone: 'dispatch', color: a?.color });
      else if (t.start_mode === 'scheduled') toast(`${k} scheduled`, { tone: 'dispatch' });
      else toast(`Created ${k}`, { action: 'Open', onAction: () => setUI({ taskId: t.id }) });
    } catch { /* toast shown */ }
  };

  const prioOpts = PRIORITIES.map((p) => ({ value: p.id, label: <span className="row" style={{ gap: 6 }}><Prio p={p.id} />{p.label}</span> }));
  const startHint = useMemo(() => {
    if (f.start_mode === 'policy') return f.assign === '' ? 'Unassigned tasks wait on the board until you assign or start them.' : `${PRIORITIES.find((p) => p.id === f.priority)?.label} priority is ${policyText(settings, f.priority)} — change this in Settings.`;
    if (f.start_mode === 'now') return 'Sent to the agent the moment you create it.';
    if (f.start_mode === 'scheduled') return 'Sent automatically at the time you choose.';
    return 'Stays in Backlog until you press Send.';
  }, [f.start_mode, f.priority, f.assign, settings]);
  const board = boards.find((b) => b.id === f.board_id);

  return (
    <Modal open={open} onClose={close} wide label="New task">
      <form onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }}>
        <div className="modal-head">
          <span className="label">New task{board ? ` · ${board.name}` : ''}</span>
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={close} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="modal-body">
          <input ref={titleRef} className="input title bare" placeholder="What should your agent build?" value={f.title} onChange={(e) => { set('title')(e); setErr(''); }} maxLength={200} />
          <textarea className="textarea" rows={3} placeholder="Context, links, constraints — everything the agent needs to do it right." value={f.description} onChange={set('description')} />
          <div className="form-grid">
            <Field as="div" label="Assign to"><Select value={f.assign} onChange={set('assign')} options={assigneeOptions(agents)} /></Field>
            <Field as="div" label="Board"><Select value={f.board_id} onChange={set('board_id')} options={boards.map((b) => ({ value: b.id, label: b.name, icon: <span className="board-glyph">{(b.name[0] || '·').toUpperCase()}</span> }))} /></Field>
            <AnimatePresence>{f.assign === '__auto' && agents.length > 0 && <div className="full"><RouteHint title={f.title} description={f.description} tags={f.tags} agents={agents} /></div>}</AnimatePresence>
            <Field as="div" className="full" label="Priority"><Seg options={prioOpts} value={f.priority} onChange={set('priority')} block /></Field>
            <div className="field full">
              <span className="label">When to send</span>
              <Seg options={START_OPTS} value={f.start_mode} onChange={set('start_mode')} />
              <AnimatePresence mode="wait"><motion.span key={startHint} className="hint" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>{startHint}</motion.span></AnimatePresence>
              <AnimatePresence>
                {f.start_mode === 'scheduled' && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={quick} style={{ overflow: 'hidden' }}>
                    <input type="datetime-local" className="input" style={{ maxWidth: 300 }} value={toLocalInput(f.scheduled_at)} onChange={(e) => set('scheduled_at')(fromLocalInput(e.target.value))} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <Field as="div" className="full" label="Deadline"><DeadlineField value={f.deadline} onChange={set('deadline')} /></Field>
            <div className="full"><button type="button" className="link small row" style={{ gap: 6 }} onClick={() => setMore((m) => !m)}><motion.span animate={{ rotate: more ? 180 : 0 }} transition={quick} style={{ display: 'inline-flex' }}><Icon name="chevron" size={14} /></motion.span>{more ? 'Fewer details' : 'Acceptance criteria, tags, repo & branch'}</button></div>
            <AnimatePresence>
              {more && (
                <motion.div className="full form-grid" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }} style={{ overflow: 'hidden' }}>
                  <Field className="full" label="Acceptance criteria"><textarea className="textarea" rows={3} placeholder={'- Tests pass\n- Works on mobile'} value={f.acceptance} onChange={set('acceptance')} /></Field>
                  <Field as="div" className="full" label="Tags"><TagsInput value={f.tags} onChange={set('tags')} /></Field>
                  <Field label="Repository" hint={board?.repo ? `Defaults to ${board.repo}` : undefined}><input className="input" placeholder={board?.repo || 'org/repo'} value={f.repo} onChange={set('repo')} /></Field>
                  <Field label="Branch" hint="Leave empty — agents get handle/key-slug"><input className="input" placeholder="auto" value={f.branch} onChange={set('branch')} /></Field>
                  <Field as="div" label="Column"><Select value={f.status} onChange={set('status')} options={STATUSES.filter((s) => s.id !== 'queued').map((s) => ({ value: s.id, label: s.label, sub: s.hint }))} up /></Field>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <AnimatePresence>{err ? <motion.div className="err" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>{err}</motion.div> : null}</AnimatePresence>
        </div>
        <div className="modal-foot">
          <span className="small muted hide-sm"><span className="kbd">⌘</span> <span className="kbd">↵</span> to create</span>
          <span className="spacer" />
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" loading={busy}>{f.start_mode === 'now' ? 'Create & send' : f.start_mode === 'scheduled' ? 'Schedule task' : 'Create task'}</Button>
        </div>
      </form>
    </Modal>
  );
}
