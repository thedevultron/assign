import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useMotionValue, useSpring, animate } from 'motion/react';
import Icon from '../components/Icon.jsx';
import { Avatar, Prio, Seg, Modal, Button, EmptyState, Field, Tip, useNow, EASE_OUT, quick } from '../components/ui.jsx';
import { useStore, useKey } from '../lib/store.js';
import { STATUSES, PRIORITIES, dueLabel, relTime, sortTasks, cx } from '../lib/helpers.js';

const SOFT = { stiffness: 380, damping: 40, mass: 0.6 }; // critically damped: no overshoot

const Card = memo(function Card({ task, agent, onPointerDown, flash, landed, now, k }) {
  const due = dueLabel(task.deadline);
  const { setUI, startTask, moveTask } = useStore.getState();
  return (
    <motion.div
      layout="position" data-card={task.id}
      className={cx('tcard', task._pending && 'pending', task.priority === 'critical' && task.status !== 'done' && 'critical')}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: task.status === 'done' ? 0.62 : 1, y: 0, scale: landed ? [0.98, 1] : 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
      transition={{ layout: { duration: 0.32, ease: EASE_OUT }, default: { duration: 0.3, ease: EASE_OUT } }}
      onPointerDown={(e) => onPointerDown(e, task)} tabIndex={0} role="button" aria-label={`${k} ${task.title}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setUI({ taskId: task.id }); } }}
    >
      <div className="t-foot">
        <Prio p={task.priority} />
        <span className="label">{k}</span>
        {task.start_mode === 'scheduled' && task.status === 'backlog' ? <Icon name="schedule" size={13} style={{ color: 'var(--t-muted)' }} /> : null}
        {task.auto_route && !task.assignee_id ? <Tip label="Auto-routed"><span style={{ display: 'inline-flex', color: 'var(--t-muted)' }}><Icon name="route" size={13} /></span></Tip> : null}
        <span className="spacer" />
        <Avatar agent={agent} size={22} />
      </div>
      <div className="t-title">{task.title}</div>
      {(task.tags?.length > 0 || due || task.status !== 'backlog') && (
        <div className="t-meta">
          {task.tags?.slice(0, 3).map((t) => <span key={t} className="chip">{t}</span>)}
          {due && task.status !== 'done' ? <span className={cx('chip', due.tone === 'overdue' && 'warn')}><Icon name="clock" size={11} />{due.text}</span> : null}
          {task.status === 'in_progress' ? <span className="label">{task.progress || 0}%</span> : null}
          {task.status === 'queued' && task.dispatched_at ? <span className="label">Sent {relTime(task.dispatched_at, now)}</span> : null}
          {task.status === 'review' ? <span className="label">Ready for review</span> : null}
          {task.status === 'done' && task.completed_at ? <span className="label">Done {relTime(task.completed_at, now)}</span> : null}
        </div>
      )}
      {task.status === 'backlog' && task.start_mode === 'scheduled' && task.scheduled_at ? <span className="label">Starts {relTime(task.scheduled_at, now)}</span> : null}
      {task.status === 'backlog' && task.start_mode === 'manual' ? <span className="label">On hold · press start</span> : null}
      {task.status === 'in_progress' ? <div className="progress"><i style={{ width: `${task.progress || 0}%` }} /></div> : null}
      <div className="quick">
        {task.status === 'backlog' ? <Tip label="Send now"><button className="icon-btn sm" aria-label="Send now" onClick={(e) => { e.stopPropagation(); startTask(task.id); }}><Icon name="play" size={14} /></button></Tip> : null}
        {task.status === 'review' ? <Tip label="Approve → Done"><button className="icon-btn sm" aria-label="Approve" onClick={(e) => { e.stopPropagation(); moveTask(task.id, 'done', -Date.now() / 1e9); }}><Icon name="check" size={14} /></button></Tip> : null}
      </div>
      <AnimatePresence>{flash ? <motion.span key={flash} className="sweep" initial={{ scaleX: 0, opacity: 1 }} animate={{ scaleX: 1, opacity: [1, 1, 0] }} exit={{ opacity: 0 }} transition={{ duration: 1.1, ease: EASE_OUT }} /> : null}</AnimatePresence>
    </motion.div>
  );
});

function BoardEditor({ board, open, onClose }) {
  const saveBoard = useStore((s) => s.saveBoard);
  const deleteBoard = useStore((s) => s.deleteBoard);
  const boards = useStore((s) => s.boards);
  const [f, setF] = useState(board);
  const [confirm, setConfirm] = useState('');
  useEffect(() => { if (open) { setF(board); setConfirm(''); } }, [open]); // eslint-disable-line
  const submit = (e) => { e.preventDefault(); if (!f.name.trim()) return; saveBoard({ id: board.id, name: f.name.trim(), description: f.description || '', repo: f.repo || '' }); onClose(); };
  return (
    <Modal open={open} onClose={onClose} label="Edit board">
      <form onSubmit={submit}>
        <div className="modal-head"><span className="label">Board settings</span><span className="spacer" /><button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        <div className="modal-body col" style={{ gap: 20 }}>
          <input className="input title bare" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Board name" autoFocus maxLength={80} />
          <Field label="Description"><input className="input" value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What lives on this board?" maxLength={400} /></Field>
          <Field label="Repository" hint="Agents receive this with every task on the board."><input className="input" value={f.repo || ''} onChange={(e) => setF({ ...f, repo: e.target.value })} placeholder="github.com/acme/web" maxLength={300} /></Field>
          {boards.length > 1 && (
            <div className="warnbox col" style={{ gap: 10 }}>
              <span className="small">Delete this board and every task on it. This can’t be undone.</span>
              <div className="row" style={{ gap: 8 }}>
                <input className="input" style={{ height: 34, maxWidth: 220 }} placeholder={`Type “${board.name}”`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                <Button variant="danger" size="sm" arrow={false} disabled={confirm !== board.name} onClick={async () => { onClose(); if (await deleteBoard(board.id)) location.hash = '#/'; }}>Delete board</Button>
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot"><span className="spacer" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">Save</Button></div>
      </form>
    </Modal>
  );
}

export default function Board({ boardId, col, taskQ }) {
  const boards = useStore((s) => s.boards);
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const flashes = useStore((s) => s.flashes);
  const settings = useStore((s) => s.settings);
  const { setUI, moveTask } = useStore.getState();
  const keyOf = useKey();
  const board = boards.find((b) => b.id === boardId);
  const now = useNow(30000);
  const [q, setQ] = useState('');
  const [agentFilter, setAgentFilter] = useState([]);
  const [prio, setPrio] = useState('all');
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [landed, setLanded] = useState(null);
  const colsRef = useRef(null);
  const px = useMotionValue(0), py = useMotionValue(0);
  const rot = useSpring(0, SOFT);
  const scale = useSpring(1, SOFT);
  const overRef = useRef(null);
  const scrollVel = useRef({ x: 0, y: 0, col: null });
  const prefix = (settings?.key_prefix || 'ASG').toLowerCase();

  const agentById = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
  const visible = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return tasks.filter((t) => t.board_id === boardId
      && (!ql || t.title.toLowerCase().includes(ql) || `${prefix}-${t.number}`.includes(ql) || (t.tags || []).some((g) => g.toLowerCase().includes(ql)))
      && (!agentFilter.length || agentFilter.includes(t.assignee_id || '__none'))
      && (prio === 'all' || t.priority === prio));
  }, [tasks, boardId, q, agentFilter, prio, prefix]);
  const byStatus = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s.id, sortTasks(visible.filter((t) => t.status === s.id))])), [visible]);
  const byStatusRef = useRef(byStatus);
  byStatusRef.current = byStatus;

  useEffect(() => { if (taskQ) setUI({ taskId: taskQ }); }, [boardId, taskQ, setUI]);
  // ?col=review (from the sidebar project tree) — scroll that column into view and pulse it
  useEffect(() => {
    if (!col) return;
    const t = setTimeout(() => {
      const ids = col === 'in_progress' ? ['in_progress', 'queued'] : [col];
      const el = ids.map((c) => colsRef.current?.querySelector(`[data-col="${c}"]`)).find(Boolean);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      el.classList.remove('col-pulse'); void el.offsetWidth; el.classList.add('col-pulse');
    }, 350);
    return () => clearTimeout(t);
  }, [col, boardId]);

  const computeOver = useCallback((x, y, dragId) => {
    const cols = [...(colsRef.current?.querySelectorAll('[data-col]') || [])];
    if (!cols.length) return;
    let col = cols.find((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x <= r.right; });
    if (!col) col = cols.reduce((best, c) => { const r = c.getBoundingClientRect(); const d = Math.min(Math.abs(x - r.left), Math.abs(x - r.right)); return !best || d < best.d ? { c, d } : best; }, null).c;
    const cards = [...col.querySelectorAll('[data-card]')].filter((el) => el.dataset.card !== dragId);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) { const r = cards[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { index = i; break; } }
    const next = { status: col.dataset.col, index };
    if (!overRef.current || overRef.current.status !== next.status || overRef.current.index !== next.index) { overRef.current = next; setOver(next); }
    const cr = colsRef.current.getBoundingClientRect();
    scrollVel.current.x = x < cr.left + 60 ? -14 : x > cr.right - 60 ? 14 : 0;
    const body = col.querySelector('.col-body'); const br = body.getBoundingClientRect();
    scrollVel.current.y = y < br.top + 50 ? -10 : y > br.bottom - 50 ? 10 : 0; scrollVel.current.col = body;
  }, []);

  useEffect(() => {
    if (!drag) return;
    let raf;
    const loop = () => {
      const v = scrollVel.current;
      if (v.x && colsRef.current) colsRef.current.scrollLeft += v.x;
      if (v.y && v.col) v.col.scrollTop += v.y;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const block = (e) => e.preventDefault();
    window.addEventListener('touchmove', block, { passive: false });
    return () => { cancelAnimationFrame(raf); window.removeEventListener('touchmove', block); };
  }, [drag]);

  const onPointerDown = useCallback((e, task) => {
    if (e.button !== 0 || e.target.closest('button, a, input, textarea')) return;
    const el = e.currentTarget; const r = el.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, offX = sx - r.left, offY = sy - r.top;
    const touch = e.pointerType === 'touch';
    let started = false, lastX = sx, timer = null, cancelled = false;
    const begin = (x, y) => {
      started = true;
      px.set(x - offX); py.set(y - offY); rot.jump(0); scale.set(1.03);
      overRef.current = null;
      setDrag({ id: task.id, task, w: r.width, h: r.height });
      computeOver(x, y, task.id);
      document.body.style.cursor = 'grabbing';
      if (touch && navigator.vibrate) navigator.vibrate(10);
    };
    if (touch) timer = setTimeout(() => !cancelled && begin(sx, sy), 260);
    const move = (ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > (touch ? 8 : 5)) { if (touch) { cleanup(); return; } begin(ev.clientX, ev.clientY); } else return;
      }
      px.set(ev.clientX - offX); py.set(ev.clientY - offY);
      rot.set(Math.max(-6, Math.min(6, (ev.clientX - lastX) * 0.6))); lastX = ev.clientX;
      computeOver(ev.clientX, ev.clientY, task.id);
    };
    const up = async () => {
      cleanup();
      if (!started) { if (!cancelled) setUI({ taskId: task.id }); return; }
      document.body.style.cursor = '';
      scrollVel.current = { x: 0, y: 0, col: null };
      const o = overRef.current;
      const ph = document.querySelector('[data-placeholder]');
      if (ph) {
        const pr = ph.getBoundingClientRect();
        rot.set(0); scale.set(1);
        await Promise.all([animate(px, pr.left, { duration: 0.2, ease: EASE_OUT }), animate(py, pr.top, { duration: 0.2, ease: EASE_OUT })]);
      }
      if (o) {
        const list = sortTasks(useStore.getState().tasks.filter((t) => t.board_id === task.board_id && t.status === o.status && t.id !== task.id));
        const visList = (byStatusRef.current[o.status] || []).filter((t) => t.id !== task.id);
        const prev = visList[o.index - 1], next = visList[o.index];
        const P = (t) => list.find((x) => x.id === t?.id)?.position;
        let pos;
        if (prev && next) pos = (P(prev) + P(next)) / 2;
        else if (prev) pos = P(prev) + 1;
        else if (next) pos = P(next) - 1;
        else pos = 0;
        const origVis = byStatusRef.current[task.status] || [];
        const origIndex = origVis.findIndex((t) => t.id === task.id);
        if (!(o.status === task.status && o.index === origIndex)) {
          moveTask(task.id, o.status, pos);
          setLanded(task.id + ':' + Date.now());
        }
      }
      setDrag(null); setOver(null); overRef.current = null;
    };
    const cancel = () => { cancelled = true; cleanup(); if (started) { document.body.style.cursor = ''; setDrag(null); setOver(null); overRef.current = null; } };
    const onEsc = (ev) => { if (ev.key === 'Escape') cancel(); };
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onEsc);
    }
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onEsc);
  }, [computeOver, moveTask, px, py, rot, scale, setUI]);

  if (!board) {
    return <div className="page"><EmptyState icon="board" title="This board doesn’t exist" body="It may have been deleted." action={<Button onClick={() => (location.hash = '#/')}>Back to overview</Button>} /></div>;
  }
  const boardTasks = tasks.filter((t) => t.board_id === boardId);
  const filtering = q || agentFilter.length || prio !== 'all';
  const toggleAgent = (id) => setAgentFilter((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  return (
    <div className="board-wrap">
      <div className="board-tools">
        <label className="search-pill filter-input" style={{ minWidth: 0 }}>
          <Icon name="search" size={15} />
          <input className="input bare" placeholder="Filter tasks…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter tasks" style={{ flex: 1, minWidth: 0, fontSize: 13 }} />
          {q ? <button className="icon-btn xs" onClick={() => setQ('')} aria-label="Clear"><Icon name="close" size={12} /></button> : null}
        </label>
        {agents.length > 0 && (
          <div className="agent-filter" role="group" aria-label="Filter by agent">
            {agents.map((a) => (
              <Tip key={a.id} label={`${a.name} · @${a.handle}`}>
                <button className={cx(agentFilter.length && !agentFilter.includes(a.id) && 'dim', agentFilter.includes(a.id) && 'on')} onClick={() => toggleAgent(a.id)} aria-pressed={agentFilter.includes(a.id)}>
                  <Avatar agent={a} size={26} title="" />
                </button>
              </Tip>
            ))}
            <Tip label="Unassigned"><button className={cx(agentFilter.length && !agentFilter.includes('__none') && 'dim', agentFilter.includes('__none') && 'on')} onClick={() => toggleAgent('__none')}><Avatar agent={null} size={26} title="" /></button></Tip>
          </div>
        )}
        <Seg className="hide-sm" size="sm" options={[{ value: 'all', label: 'All' }, ...PRIORITIES.map((p) => ({ value: p.id, label: p.label }))]} value={prio} onChange={setPrio} />
        <AnimatePresence>{filtering ? <motion.button className="btn btn-quiet btn-sm" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={quick} onClick={() => { setQ(''); setAgentFilter([]); setPrio('all'); }}>Clear</motion.button> : null}</AnimatePresence>
        <span className="spacer" />
        {board.repo ? <span className="chip hide-sm"><Icon name="github" size={12} />{board.repo.replace(/^https?:\/\/(www\.)?/, '')}</span> : null}
        <Tip label="Board settings"><button className="icon-btn" onClick={() => setEditing(true)} aria-label="Board settings"><Icon name="settings" size={17} /></button></Tip>
      </div>

      {boardTasks.length === 0 ? (
        <div className="grow" style={{ display: 'grid', placeItems: 'center' }}>
          <EmptyState icon="board" title={<>A quiet <em>board.</em></>} body={agents.length ? 'Create the first task and hand it to one of your agents — or let auto-routing choose.' : 'Add an agent first, then create tasks for it to pick up.'}
            action={<div className="row" style={{ gap: 10 }}>{!agents.length && <Button variant="ghost" onClick={() => setUI({ agentEditor: {} })}>Add agent</Button>}<Button onClick={() => setUI({ composer: { initial: { board_id: boardId } } })}>Create a task</Button></div>} />
        </div>
      ) : (
        <div className="columns" ref={colsRef}>
          {STATUSES.map((s, ci) => {
            const list = byStatus[s.id].filter((t) => !drag || t.id !== drag.id);
            const isOver = drag && over?.status === s.id;
            return (
              <motion.section key={s.id} data-col={s.id} className={cx('column', isOver && 'over')} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: ci * 0.05, duration: 0.5, ease: EASE_OUT }}>
                <header className="col-head">
                  <span className="label" style={{ color: '#fff' }}>{s.label}</span>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span key={byStatus[s.id].length} className="count" initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 6, opacity: 0 }} transition={{ duration: 0.2 }}>{byStatus[s.id].length}</motion.span>
                  </AnimatePresence>
                  <span className="spacer" />
                  <span className="tiny muted">{s.hint}</span>
                </header>
                <div className="col-body">
                  <AnimatePresence initial={false}>
                    {(() => {
                      const nodes = [];
                      const ph = <motion.div key="ph" layout data-placeholder className="drop-ph" style={{ height: drag?.h }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.18 }} />;
                      list.forEach((t, i) => {
                        if (isOver && over.index === i) nodes.push(ph);
                        const f = flashes[t.id] && Date.now() - flashes[t.id] < 2500 ? flashes[t.id] : null;
                        nodes.push(<Card key={t.id} task={t} k={keyOf(t)} agent={agentById[t.assignee_id]} onPointerDown={onPointerDown} flash={f} landed={!!landed && landed.startsWith(t.id + ':')} now={now} />);
                      });
                      if (isOver && over.index >= list.length) nodes.push(ph);
                      return nodes;
                    })()}
                  </AnimatePresence>
                  {list.length === 0 && !isOver && (
                    <motion.div className="col-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      {filtering ? 'No matches' : { backlog: 'Ideas land here', queued: 'Drop here to send to an agent', in_progress: 'Agents pick up queued work', review: 'Finished work waits here', done: 'Nothing shipped yet' }[s.id]}
                    </motion.div>
                  )}
                </div>
                {s.id !== 'done' && s.id !== 'in_progress' && s.id !== 'review' && (
                  <button className="col-add" onClick={() => setUI({ composer: { initial: { board_id: boardId, start_mode: s.id === 'queued' ? 'now' : 'policy' } } })}>
                    <Icon name="plus" size={15} />{s.id === 'queued' ? 'Add & send now' : 'Add task'}
                  </button>
                )}
              </motion.section>
            );
          })}
        </div>
      )}

      {createPortal(
        <AnimatePresence>
          {drag && (
            <motion.div className="drag-ghost" style={{ x: px, y: py, width: drag.w, rotate: rot, scale, left: 0, top: 0 }} initial={{ opacity: 0.9 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.05 } }}>
              <div className={cx('tcard', drag.task.priority === 'critical' && 'critical')} style={{ pointerEvents: 'none' }}>
                <div className="t-foot"><Prio p={drag.task.priority} /><span className="label">{keyOf(drag.task)}</span><span className="spacer" /><Avatar agent={agentById[drag.task.assignee_id]} size={22} /></div>
                <div className="t-title">{drag.task.title}</div>
                <AnimatePresence>{over?.status === 'queued' && drag.task.status !== 'queued' && (
                  <motion.div className="label row" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ gap: 6, color: '#fff' }}>
                    <Icon name="send" size={12} />Release to send to {agentById[drag.task.assignee_id]?.name || 'best-fit agent'}
                  </motion.div>
                )}</AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
      <BoardEditor board={board} open={editing} onClose={() => setEditing(false)} />
    </div>
  );
}
