import { motion } from 'motion/react';
import Icon from './Icon.jsx';
import { Avatar, useNow, EASE_OUT } from './ui.jsx';
import { useStore } from '../lib/store.js';
import { relTime } from '../lib/helpers.js';

export const KIND_ICON = {
  create: 'plus', status: 'flash', dispatch: 'send', route: 'route', assign: 'target', comment: 'comment', agent: 'robot', connect: 'plug',
  board: 'board', automation: 'automations', daily_digest: 'mail', digest: 'mail', reminder: 'bell', nudge: 'bell', warn: 'alert', delete: 'trash', edit: 'edit', task: 'checklist',
};

export function ActivityItem({ ev, showTask = true, compact }) {
  const agent = useStore((s) => (ev.agent_id ? s.agents.find((a) => a.id === ev.agent_id) : null));
  const task = useStore((s) => (showTask && ev.task_id ? s.tasks.find((t) => t.id === ev.task_id) : null));
  const setUI = useStore((s) => s.setUI);
  const now = useNow(30000);
  const isComment = ev.kind === 'comment';
  const who = ev.actor === 'agent' && agent ? agent.name : ev.actor === 'you' ? 'You' : ev.actor === 'system' ? 'assign' : ev.actor === 'assistant' ? 'Assistant' : ev.actor;
  return (
    <motion.div className="feed-item" layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: ev._pending ? 0.6 : 1, y: 0 }} transition={{ duration: 0.35, ease: EASE_OUT }}>
      {ev.actor === 'agent' && agent ? <Avatar agent={agent} size={28} /> : <span className="sys-ico" style={ev.kind === 'warn' ? { color: '#ffb4a8' } : undefined}><Icon name={ev.actor === 'assistant' ? 'magic' : KIND_ICON[ev.kind] || 'sparkles'} size={14} /></span>}
      <div className="col grow" style={{ gap: 3, minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="small" style={{ color: '#fff' }}>{who}</span>
          <span className="label" style={{ fontSize: 9.5 }}>{relTime(ev.created_at, now)}</span>
        </div>
        {isComment ? <div className="msg comment">{ev.message}</div> : <div className="msg" style={compact ? { fontSize: 13.5 } : undefined}>{ev.message}</div>}
        {task && !compact ? (
          <button className="link tiny" style={{ alignSelf: 'flex-start', marginTop: 2 }} onClick={() => setUI({ taskId: task.id })}>{task.title}</button>
        ) : null}
      </div>
    </motion.div>
  );
}
