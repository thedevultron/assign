import { useState } from 'react';
import { motion } from 'motion/react';
import Icon from '../components/Icon.jsx';
import { Avatar, Button, EmptyState, EASE_OUT } from '../components/ui.jsx';
import { useStore, useKey } from '../lib/store.js';
import { cx, STATUS_LABEL } from '../lib/helpers.js';

const COLUMNS = ['backlog', 'queued', 'in_progress', 'review', 'done'];

export default function Boards() {
  const boards = useStore((s) => s.boards);
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const { saveBoard } = useStore.getState();
  const keyOf = useKey();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const sorted = [...boards].sort((a, b) => a.position - b.position);

  const create = async (e) => {
    e?.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const b = await saveBoard({ name: n });
      setName('');
      location.hash = `#/board/${b.id}`;
    } catch { /* store toasts */ } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <motion.div className="page-head" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}>
        <div className="grow">
          <span className="label">{boards.length} project{boards.length === 1 ? '' : 's'}</span>
          <h1 className="h1">Boards. <em>Pick a lane.</em></h1>
          <p className="lede" style={{ marginTop: 14 }}>Every project is its own Kanban board. Open one to move work, or spin up a new lane.</p>
        </div>
      </motion.div>

      <form className="row" style={{ gap: 8, maxWidth: 520 }} onSubmit={create}>
        <input className="input" style={{ flex: 1 }} placeholder="New board name…" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="New board name" />
        <Button type="submit" loading={busy} disabled={!name.trim()}><Icon name="plus" size={15} />New board</Button>
      </form>

      {sorted.length === 0 ? (
        <div className="panel" style={{ marginTop: 18 }}>
          <EmptyState icon="board" title={<>No boards <em>yet.</em></>} body="Create your first board above and start assigning work." />
        </div>
      ) : (
        <div className="boards-grid" style={{ marginTop: 18 }}>
          {sorted.map((b, i) => {
            const mine = tasks.filter((t) => t.board_id === b.id);
            const open = mine.filter((t) => t.status !== 'done');
            const recent = [...mine].sort((x, y) => (y.updated_at || '').localeCompare(x.updated_at || '')).slice(0, 3);
            return (
              <motion.button
                key={b.id} className="board-card" onClick={() => { location.hash = `#/board/${b.id}` }}
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE_OUT, delay: i * 0.05 }}
              >
                <span className="row" style={{ gap: 10 }}>
                  <span className="board-glyph lg">{(b.emoji || b.name[0] || '·').toUpperCase()}</span>
                  <span className="col grow" style={{ minWidth: 0, gap: 2, textAlign: 'left' }}>
                    <span className="h4 trunc" style={{ color: '#fff' }}>{b.name}</span>
                    <span className="tiny muted trunc">{b.repo || 'No repo linked'}</span>
                  </span>
                  <span className={cx('chip', !open.length && 'ok')}>{open.length} open</span>
                </span>
                <span className="board-counts">
                  {COLUMNS.map((c) => (
                    <span key={c} className="board-count"><b>{mine.filter((t) => t.status === c).length}</b><i>{STATUS_LABEL[c]}</i></span>
                  ))}
                </span>
                {recent.length > 0 && (
                  <span className="col" style={{ gap: 6 }}>
                    {recent.map((t) => (
                      <span key={t.id} className="row small" style={{ gap: 8, minWidth: 0 }}>
                        <span className="label mono" style={{ flex: 'none' }}>{keyOf(t)}</span>
                        <span className="trunc grow" style={{ color: '#cacaca', textAlign: 'left' }}>{t.title}</span>
                        <Avatar agent={agents.find((a) => a.id === t.assignee_id)} size={18} />
                      </span>
                    ))}
                  </span>
                )}
                <span className="link small">Open board →</span>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
