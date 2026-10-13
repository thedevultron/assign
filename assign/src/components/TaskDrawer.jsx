import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import Icon from './Icon.jsx';
import { Drawer, Seg, Select, TagsInput, Avatar, Prio, Button, CopyButton, Spinner, Field, Tip, useNow, EASE_OUT, quick } from './ui.jsx';
import { assigneeOptions, DeadlineField, policyText, RouteHint } from './TaskComposer.jsx';
import { ActivityItem } from './Feed.jsx';
import QuickActions from './QuickActions.jsx';
import SlideCommit from '@/components/reactbits/SlideCommit';
import { HoldConfirm } from './ui.jsx';
import { useStore, useKey } from '../lib/store.js';
import { api } from '../lib/api.js';
import { PRIORITIES, STATUSES, relTime, fmtDateTime, toLocalInput, fromLocalInput, dueLabel, cx, providerLabel } from '../lib/helpers.js';

function AutoText({ value, onSave, className, placeholder, rows = 3, as = 'textarea', ...rest }) {
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  const commit = () => { if ((v || '') !== (value || '')) onSave(v); };
  const P = { className, placeholder, value: v, onChange: (e) => setV(e.target.value), onBlur: commit, ...rest };
  return as === 'input'
    ? <input {...P} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.stopPropagation(); setV(value || ''); setTimeout(() => e.target.blur()); } }} />
    : <textarea {...P} rows={rows} />;
}

function LocalRunButton({ task, onlineRunners, onRun }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!onlineRunners.length) return null;
  return (
    <>
      <Button size="sm" variant="ghost" arrow={false} onClick={() => setOpen(true)}><Icon name="terminal" size={13} />Run locally</Button>
      {open ? (
        <ConfirmLocalRun task={task} runners={onlineRunners} busy={busy} onClose={() => setOpen(false)} onPick={async (r) => { setBusy(true); try { await onRun(r); setOpen(false); } catch {} finally { setBusy(false); } }} />
      ) : null}
    </>
  );
}

function ConfirmLocalRun({ task, runners, busy, onPick, onClose }) {
  const k = useKey()(task);
  return (
    <ConfirmShroud onClose={onClose} label={`Run ${k} locally`}>
      <div className="col" style={{ gap: 14 }}>
        <span className="label" style={{ color: '#d1c9ff', letterSpacing: '0.14em' }}>Run on your machine</span>
        <span className="h4 serif" style={{ fontSize: 22, lineHeight: 1.2 }}>{k} — {task.title}</span>
        <span className="small muted">The runner spawns <b style={{ fontWeight: 400, color: '#fff' }}>{runners.length === 1 ? `${runners[0].name}` : 'your chosen runner'}</b>'s agent CLI inside its folder, live. Processes execute on your computer — that's the point.</span>
        {(() => { const agent = useStore.getState().agents.find((a) => a.id === task.assignee_id); return agent ? <span className="chip mono" style={{ alignSelf: 'flex-start', fontSize: 10.5 }}><Icon name="robot" size={11} />{providerLabel(agent.provider)} CLI</span> : <span className="chip warn" style={{ alignSelf: 'flex-start' }}><Icon name="alert" size={11} />No agent assigned — runner will echo only</span>; })()}
        <div className="col" style={{ gap: 8, flexDirection: 'column' }}>
          {runners.map((r) => (
            <button key={r.id} className="runner-pick" disabled={busy} onClick={() => onPick(r)}>
              <span className={`runner-dot ${r.online ? 'on' : ''}`} style={{ marginTop: 3 }} />
              <span className="col grow" style={{ minWidth: 0, textAlign: 'left' }}>
                <span className="small" style={{ color: '#fff' }}>{r.name}</span>
                {r.cwd ? <span className="tiny muted mono trunc">{r.cwd}</span> : null}
              </span>
              <Icon name="play" size={14} />
            </button>
          ))}
        </div>
        <button className="link small" style={{ alignSelf: 'flex-end' }} onClick={onClose}>Not now</button>
      </div>
    </ConfirmShroud>
  );
}

/** Lightweight top layer for risky-ish confirmations — rendered as a fixed overlay. */
function ConfirmShroud({ children, onClose, label }) {
  useEffect(() => { const h = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return createPortal(
    <motion.div className="confirm-shroud" role="dialog" aria-label={label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={onClose}>
      <motion.div className="confirm-card" initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }} onClick={(e) => e.stopPropagation()}>
        {children}
      </motion.div>
    </motion.div>, document.body);
}

export default function TaskDrawer() {
  const taskId = useStore((s) => s.ui.taskId);
  const task = useStore((s) => s.tasks.find((t) => t.id === s.ui.taskId));
  const agents = useStore((s) => s.agents);
  const boards = useStore((s) => s.boards);
  const settings = useStore((s) => s.settings);
  const activity = useStore((s) => s.activity);
  const { setUI, updateTask, deleteTask, startTask, addComment, runOnRunner, fail } = useStore.getState();
  const runners = useStore((s) => s.runners);
  const onlineRunners = useMemo(() => runners.filter((r) => r.online), [runners]);
  const keyOf = useKey();
  const now = useNow(30000);
  const [hist, setHist] = useState(null);
  const [comment, setComment] = useState('');
  const taRef = useRef(null);

  useEffect(() => {
    setComment('');
    if (!taskId) return;
    setHist(null);
    let alive = true;
    api.get(`/tasks/${taskId}/activity`).then((r) => alive && setHist(r)).catch(() => alive && setHist([]));
    return () => { alive = false; };
  }, [taskId]);

  const events = useMemo(() => {
    if (!task) return [];
    const map = new Map();
    for (const e of hist || []) map.set(e.id, e);
    for (const e of activity) if (e.task_id === task.id) map.set(e.id, e);
    return [...map.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [hist, activity, task]);

  const close = () => setUI({ taskId: null });
  if (!task) return <Drawer open={false} onClose={close} />;

  const save = (patch) => updateTask(task.id, patch).catch(() => {});
  const assignValue = task.assignee_id || (task.auto_route ? '__auto' : '');
  const due = dueLabel(task.deadline);
  const agent = agents.find((a) => a.id === task.assignee_id);
  const k = keyOf(task);
  const send = async (e) => {
    e?.preventDefault();
    const m = comment.trim(); if (!m) return;
    setComment(''); if (taRef.current) taRef.current.style.height = 'auto';
    try { await addComment(task.id, m); } catch { setComment(m); }
  };

  return (
    <Drawer open onClose={close} label={`Task ${k}`}>
      <div className="drawer-head">
        <span className="label">{k}</span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={task.status} className={cx('chip', task.status === 'review' && 'iris', task.status === 'done' && 'ok', task.status === 'in_progress' && 'solid')} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={quick}>{STATUSES.find((s) => s.id === task.status)?.label}</motion.span>
        </AnimatePresence>
        <span className="spacer" />
        <LocalRunButton task={task} onlineRunners={onlineRunners} onRun={(r) => runOnRunner(r.id, task.id).then(() => useStore.getState().toast(`Running on ${r.name} — watch it in Agents → Runners`, { tone: 'dispatch' })).catch(fail)} />
        {task.status === 'backlog' ? <Button size="sm" arrow={false} onClick={() => startTask(task.id)}><Icon name="play" size={13} />Send now</Button> : null}
        <CopyButton text={`${location.origin}${location.pathname}#/board/${task.board_id}?task=${task.id}`} label="Copy link" />
        <button className="icon-btn" onClick={close} aria-label="Close"><Icon name="close" /></button>
      </div>
      <div className="drawer-body">
        {task.status === 'review' ? (
          <div className="review-box">
            <div className="col" style={{ gap: 4, minWidth: 0 }}>
              <span className="label" style={{ color: '#d1c9ff' }}>Needs your review</span>
              <span className="small">{agent ? `${agent.name} handed this back.` : 'Handed back for review.'} Approve to move it to Done, or reply below to send it back.</span>
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <SlideCommit key={task.id} label="Slide to approve" doneLabel="Approved" errorLabel="Couldn’t save" width={260} height={48} radius={8}
                trackColor="#2e2e2e" handleColor="#ffffff" successColor="#847dff" dangerColor="#e5484d"
                onConfirm={() => updateTask(task.id, { status: 'done' })} />
              <Button size="sm" variant="ghost" arrow={false} onClick={() => { save({ status: 'in_progress' }); setTimeout(() => taRef.current?.focus(), 50); }}>Request changes</Button>
            </div>
          </div>
        ) : null}
        <div className="col" style={{ gap: 12 }}>
          <AutoText as="input" className="input title bare" value={task.title} onSave={(v) => v.trim() && save({ title: v.trim() })} placeholder="Task title" maxLength={200} />
          <div className="row wrap" style={{ gap: 10 }}>
            {agent ? <span className="row small" style={{ gap: 8 }}><Avatar agent={agent} size={20} status /><span style={{ color: '#fff' }}>{agent.name}</span><span className="muted">· {providerLabel(agent.provider)}</span></span> : null}
            {due ? <span className={cx('chip', due.tone === 'overdue' && 'warn')}><Icon name="clock" size={11} />{due.text}</span> : null}
            {task.start_mode === 'scheduled' && task.status === 'backlog' && task.scheduled_at ? <span className="chip"><Icon name="schedule" size={11} />Starts {relTime(task.scheduled_at, now)}</span> : null}
            {task.branch ? <span className="chip mono" style={{ fontSize: 10.5 }}><Icon name="branch" size={11} />{task.branch}</span> : null}
            <span className="label">Updated {relTime(task.updated_at, now)}</span>
          </div>
        </div>

        <div className="field">
          <span className="label">Status{task.status === 'in_progress' ? <span style={{ marginLeft: 'auto' }}>{task.progress || 0}%</span> : null}</span>
          <Seg options={STATUSES.map((s) => ({ value: s.id, label: s.label }))} value={task.status} onChange={(v) => save({ status: v })} block size="sm" />
          <div className="progress-line"><motion.b initial={false} animate={{ scaleX: (task.status === 'done' ? 100 : task.progress || 0) / 100 }} transition={{ duration: 0.6, ease: EASE_OUT }} /></div>
        </div>

        <div className="kv">
          <span className="label">Assignee</span>
          <Select value={assignValue} onChange={(v) => save(v === '__auto' ? { assignee_id: null, auto_route: true } : { assignee_id: v || null, auto_route: false })} options={assigneeOptions(agents)} />
          <AnimatePresence>{assignValue === '__auto' && !task.assignee_id ? <><span /><RouteHint title={task.title} description={task.description} tags={task.tags} agents={agents} /></> : null}</AnimatePresence>
          <span className="label">Priority</span>
          <Seg options={PRIORITIES.map((p) => ({ value: p.id, label: <span className="row" style={{ gap: 6 }}><Prio p={p.id} />{p.label}</span> }))} value={task.priority} onChange={(v) => save({ priority: v })} block size="sm" />
          <span className="label">Send</span>
          <div className="col" style={{ gap: 8 }}>
            {task.dispatched_at ? (
              <span className="small muted">Sent {relTime(task.dispatched_at, now)} · {fmtDateTime(task.dispatched_at)}{task.claimed_at ? ` · claimed ${relTime(task.claimed_at, now)}` : ''}</span>
            ) : (
              <>
                <Seg size="sm" options={[{ value: 'policy', label: 'By priority' }, { value: 'scheduled', label: 'Schedule' }, { value: 'manual', label: 'Hold' }]} value={task.start_mode === 'now' ? 'policy' : task.start_mode}
                  onChange={(v) => save(v === 'scheduled' ? { start_mode: v, scheduled_at: task.scheduled_at || new Date(Date.now() + 3600e3).toISOString() } : { start_mode: v })} />
                {task.start_mode === 'scheduled' ? <input type="datetime-local" className="input" value={toLocalInput(task.scheduled_at)} onChange={(e) => e.target.value && save({ scheduled_at: fromLocalInput(e.target.value) })} /> : null}
                <span className="hint">{task.start_mode === 'policy' ? `${PRIORITIES.find((p) => p.id === task.priority)?.label} priority is ${policyText(settings, task.priority)}.` : task.start_mode === 'manual' ? 'Held in backlog until you press Send now.' : 'Sent automatically at the scheduled time.'}</span>
              </>
            )}
          </div>
          <span className="label">Deadline</span>
          <DeadlineField value={task.deadline} onChange={(v) => save({ deadline: v })} />
          <span className="label">Board</span>
          <Select value={task.board_id} onChange={(v) => save({ board_id: v })} options={boards.map((b) => ({ value: b.id, label: b.name, icon: <span className="board-glyph">{(b.name[0] || '·').toUpperCase()}</span> }))} />
          <span className="label">Tags</span>
          <TagsInput value={task.tags || []} onChange={(v) => save({ tags: v })} />
          <span className="label">Repo · branch</span>
          <div className="form-grid" style={{ gap: 8 }}>
            <AutoText as="input" className="input" value={task.repo} onSave={(v) => save({ repo: v })} placeholder="org/repo" />
            <AutoText as="input" className="input" value={task.branch} onSave={(v) => save({ branch: v })} placeholder="auto" />
          </div>
        </div>

        <Field label="Details"><AutoText className="textarea" rows={5} value={task.description} onSave={(v) => save({ description: v })} placeholder="Add context for the agent…" /></Field>
        <Field label="Acceptance criteria"><AutoText className="textarea" rows={3} value={task.acceptance} onSave={(v) => save({ acceptance: v })} placeholder="- What does done look like?" /></Field>

        <div className="field">
          <span className="label">Quick actions<span className="muted" style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>type “assign”, “priority”, “due”… then ⌘↵</span></span>
          <QuickActions task={task} />
        </div>

        <div>
          <div className="section-head" style={{ marginBottom: 10 }}><span className="h4">Activity</span><span className="label">{events.length}</span></div>
          <form className="comment-box" onSubmit={send}>
            <textarea ref={taRef} rows={1} value={comment} placeholder={agent ? `Message ${agent.name}… (delivered to its inbox)` : 'Leave a comment…'}
              onChange={(e) => { setComment(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} />
            <motion.button type="submit" className="icon-btn sm" whileTap={{ scale: 0.9 }} disabled={!comment.trim()} aria-label="Send comment" style={{ opacity: comment.trim() ? 1 : 0.35, transition: 'opacity .2s ease' }}><Icon name="send" size={16} /></motion.button>
          </form>
          <div className="feed" style={{ marginTop: 6 }}>
            {hist === null ? <div className="row muted small" style={{ gap: 8, padding: 24 }}><Spinner />Loading history…</div> : events.length === 0 ? <div className="small muted center" style={{ padding: '24px 0' }}>No activity yet</div>
              : <AnimatePresence initial={false}>{events.map((ev) => <ActivityItem key={ev.id} ev={ev} showTask={false} />)}</AnimatePresence>}
          </div>
        </div>

        <div className="danger-row">
          <div className="col" style={{ gap: 2 }}><span className="small" style={{ color: '#fff' }}>Delete this task</span><span className="tiny muted">You can undo from the toast for a few seconds.</span></div>
          <HoldConfirm onConfirm={() => deleteTask(task.id)}>Hold to delete</HoldConfirm>
        </div>
      </div>
    </Drawer>
  );
}
