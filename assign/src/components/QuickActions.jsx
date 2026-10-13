import CommandPalette from '@/components/twentyfirst/CommandPalette';
import Icon from './Icon.jsx';
import { useStore } from '../lib/store.js';
import { PRIORITIES, STATUSES } from '../lib/helpers.js';

const PRIO_DOT = { critical: '#dd90d8', high: '#847dff', medium: '#90b8f0', low: '#6a6b6b' };
const endOfDay = (offsetDays) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); d.setHours(18, 0, 0, 0); return d.toISOString(); };

/**
 * Quick actions for a task — 21st.dev Command Palette (component 31802).
 * Stage several clauses ("assign Nova and priority High") and apply them in one go.
 */
export default function QuickActions({ task }) {
  const agents = useStore((s) => s.agents);
  const boards = useStore((s) => s.boards);
  const { updateTask, startTask, toast } = useStore.getState();
  const byName = (n) => agents.find((a) => a.name === n);

  const commands = [
    {
      id: 'assign', label: 'Assign to', icon: <Icon name="agents" size={15} />,
      slots: [{ name: 'agent', prompt: 'Which agent?', kind: 'person', options: [{ value: 'Auto-route', hint: 'best match' }, ...agents.map((a) => ({ value: a.name, hint: a.role || '@' + a.handle }))] }],
      message: ([a]) => `assigned to ${a.value}`,
    },
    {
      id: 'priority', label: 'Set priority', icon: <Icon name="flash" size={15} />,
      slots: [{ name: 'priority', prompt: 'Priority', kind: 'dot', options: PRIORITIES.map((p) => ({ value: p.label, dot: PRIO_DOT[p.id] })) }],
      message: ([p]) => `priority ${p.value.toLowerCase()}`,
    },
    {
      id: 'move', label: 'Move to', icon: <Icon name="board" size={15} />,
      slots: [{ name: 'status', prompt: 'Column', kind: 'plain', options: STATUSES.map((s) => ({ value: s.label, hint: s.hint })) }],
      message: ([s]) => `moved to ${s.value}`,
    },
    {
      id: 'due', label: 'Due', icon: <Icon name="clock" size={15} />,
      slots: [{ name: 'when', prompt: 'When?', kind: 'plain', options: [{ value: 'Today', hint: '6 pm' }, { value: 'Tomorrow', hint: '6 pm' }, { value: 'In 3 days' }, { value: 'Next week' }, { value: 'No deadline' }] }],
      message: ([w]) => `due ${w.value.toLowerCase()}`,
    },
    ...(boards.length > 1 ? [{
      id: 'project', label: 'Move to project', icon: <Icon name="folder" size={15} />,
      slots: [{ name: 'project', prompt: 'Project', kind: 'plain', options: boards.filter((b) => b.id !== task.board_id).map((b) => ({ value: b.name })) }],
      message: ([b]) => `moved to ${b.value}`,
    }] : []),
    ...(task.status === 'backlog' ? [{
      id: 'send', label: 'Send now', icon: <Icon name="play" size={15} />,
      slots: [], message: () => 'sent to the agent',
    }] : []),
  ];

  const apply = async (clauses) => {
    const patch = {}; let send = false; const said = [];
    for (const { command, values } of clauses) {
      const v = values[0]?.value;
      said.push(command.message(values));
      if (command.id === 'assign') Object.assign(patch, v === 'Auto-route' ? { assignee_id: null, auto_route: true } : { assignee_id: byName(v)?.id || null, auto_route: false });
      if (command.id === 'priority') patch.priority = PRIORITIES.find((p) => p.label === v)?.id;
      if (command.id === 'move') patch.status = STATUSES.find((s) => s.label === v)?.id;
      if (command.id === 'project') patch.board_id = boards.find((b) => b.name === v)?.id;
      if (command.id === 'due') patch.deadline = { Today: endOfDay(0), Tomorrow: endOfDay(1), 'In 3 days': endOfDay(3), 'Next week': endOfDay(7), 'No deadline': null }[v];
      if (command.id === 'send') send = true;
    }
    try {
      if (Object.keys(patch).length) await updateTask(task.id, patch);
      if (send) await startTask(task.id);
      if (said.length) toast(`Task ${said.join(', ')}`);
    } catch { /* store already toasts errors */ }
  };

  return (
    <div className="cp-scope">
      <CommandPalette key={task.id + task.status} commands={commands} onApply={apply} matcher="fuzzy" />
    </div>
  );
}
