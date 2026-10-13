import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Seg, Avatar, Prio, Button, Spinner, EmptyState, useNow, EASE, EASE_OUT } from '../components/ui.jsx';
import { ActivityItem } from '../components/Feed.jsx';
import { useStore, useKey } from '../lib/store.js';
import { api } from '../lib/api.js';
import { relTime } from '../lib/helpers.js';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'agent', label: 'Agents' },
  { value: 'dispatch', label: 'Sends' },
  { value: 'comment', label: 'Comments' },
  { value: 'automation', label: 'Automations' },
];
const match = (f, e) => f === 'all' || (f === 'agent' ? e.actor === 'agent' : f === 'dispatch' ? ['dispatch', 'route', 'assign'].includes(e.kind) : f === 'comment' ? e.kind === 'comment' : ['automation', 'digest', 'daily_digest', 'reminder', 'nudge'].includes(e.kind));

export default function Activity() {
  const activity = useStore((s) => s.activity);
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const { setUI, updateTask, addComment } = useStore.getState();
  const keyOf = useKey();
  const now = useNow(30000);
  const [filter, setFilter] = useState('all');
  const [older, setOlder] = useState([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(100);
  const [exhausted, setExhausted] = useState(false);
  const review = tasks.filter((t) => t.status === 'review').sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const loadMore = async () => {
    setLoading(true);
    try {
      const next = limit + 150;
      const r = await api.get(`/activity?limit=${next}`);
      setOlder(r); setLimit(next); if (r.length < next) setExhausted(true);
    } catch { /* toast handled by api consumers */ }
    setLoading(false);
  };
  const all = useMemo(() => {
    const m = new Map();
    for (const e of [...older, ...activity]) m.set(e.id, e);
    return [...m.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [older, activity]);
  const list = all.filter((e) => match(filter, e));

  return (
    <div className="page">
      <motion.div className="page-head" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE }}>
        <div className="grow">
          <span className="label">{review.length ? `${review.length} waiting for review` : 'Everything reviewed'}</span>
          <h1 className="h1">The <em>record.</em></h1>
          <p className="lede" style={{ marginTop: 14, maxWidth: 560 }}>Every send, claim, comment and hand-off — from you, your agents and your automations.</p>
        </div>
      </motion.div>

      <AnimatePresence initial={false}>
        {review.length > 0 && (
          <motion.section key="review" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.5, ease: EASE_OUT }}>
            <div className="section-head"><span className="h3">Waiting for <em>review</em></span><span className="spacer" /><span className="label">{review.length} task{review.length === 1 ? '' : 's'}</span></div>
            <div className="review-grid">
              <AnimatePresence initial={false}>
                {review.map((t) => {
                  const a = agents.find((x) => x.id === t.assignee_id);
                  return (
                    <motion.div key={t.id} layout className="panel tight col" style={{ gap: 12 }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.35, ease: EASE_OUT }}>
                      <div className="row" style={{ gap: 10 }}><Prio p={t.priority} /><span className="label">{keyOf(t)}</span><span className="spacer" />{a ? <Avatar agent={a} size={22} /> : null}</div>
                      <button className="trunc" style={{ textAlign: 'left', color: '#fff', fontSize: 15.5 }} onClick={() => setUI({ taskId: t.id })}>{t.title}</button>
                      <span className="small muted">{a?.name || 'Agent'} finished {relTime(t.completed_at || t.updated_at, now)}</span>
                      <div className="row" style={{ gap: 8, marginTop: 'auto' }}>
                        <Button size="sm" arrow={false} onClick={() => updateTask(t.id, { status: 'done' }).catch(() => {})}>Approve</Button>
                        <Button size="sm" variant="ghost" arrow={false} onClick={async () => { try { await updateTask(t.id, { status: 'in_progress' }); await addComment(t.id, 'Sent back for changes — see notes on the task.'); } catch { /* shown */ } }}>Send back</Button>
                        <span className="spacer" />
                        <button className="link tiny" onClick={() => setUI({ taskId: t.id })}>Open →</button>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <section>
        <div className="section-head wrap" style={{ gap: 12 }}>
          <span className="h3">Log</span><span className="spacer" />
          <Seg options={FILTERS} value={filter} onChange={setFilter} size="sm" />
        </div>
        <div className="panel" style={{ padding: '6px 22px' }}>
          {list.length === 0 ? <EmptyState icon="activity" title={<>Quiet <em>for now.</em></>} body={filter === 'all' ? 'Create a task or connect an agent and things will start showing up here.' : 'Nothing matches this filter yet.'} />
            : <div className="feed"><AnimatePresence initial={false}>{list.map((ev) => <ActivityItem key={ev.id} ev={ev} showTask />)}</AnimatePresence></div>}
        </div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
          {loading ? <Spinner /> : !exhausted && all.length >= Math.min(limit, 80) ? <Button variant="ghost" size="sm" arrow="↓" onClick={loadMore}>Load older</Button> : null}
        </div>
      </section>
    </div>
  );
}
