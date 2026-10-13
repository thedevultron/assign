import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sidebar, Topbar, Toasts, Palette, ProjectPicker, MobileNav } from './components/Shell.jsx';
import { AssistantPanel, VoiceBall } from './components/ai/Assistant.jsx';
import { useAI } from './lib/ai.js';
import { voice } from './lib/voice.js';
import { WarmTooltipGroup } from './components/ui.jsx';
import Analytics from './pages/Analytics.jsx';
import TaskComposer from './components/TaskComposer.jsx';
import TaskDrawer from './components/TaskDrawer.jsx';
import { AgentEditor, ConnectPanel } from './components/AgentEditor.jsx';
import AutomationEditor from './components/AutomationEditor.jsx';
import { Button, EASE_OUT } from './components/ui.jsx';
import Overview from './pages/Dashboard.jsx';
import Board from './pages/Board.jsx';
import Boards from './pages/Boards.jsx';
import Agents from './pages/Agents.jsx';
import Automations from './pages/Automations.jsx';
import Settings from './pages/Settings.jsx';
import Tutorial from './pages/Tutorial.jsx';
import Activity from './pages/Activity.jsx';
import { useStore } from './lib/store.js';
import ConfettiParty from './components/ConfettiParty.jsx';

function Skeleton() {
  return (
    <div className="shell">
      <aside className="sidebar hide-sm" style={{ padding: 18, gap: 12 }}>
        <div className="skel" style={{ height: 26, width: 110, marginBottom: 26 }} />
        {Array.from({ length: 7 }).map((_, i) => <div key={i} className="skel" style={{ height: 20, width: `${78 - (i % 3) * 14}%`, marginBottom: 8, animationDelay: `${i * 0.08}s` }} />)}
      </aside>
      <main className="main">
        <div className="topbar"><div className="skel" style={{ height: 20, width: 160 }} /></div>
        <div className="page" style={{ width: '100%', boxSizing: 'border-box' }}>
          <div className="skel" style={{ height: 56, width: '46%' }} />
          <div className="stats">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skel" style={{ height: 140, borderRadius: 16, animationDelay: `${i * 0.1}s` }} />)}</div>
          <div className="skel" style={{ height: 280, borderRadius: 16 }} />
        </div>
      </main>
    </div>
  );
}

export default function App({ route }) {
  const loaded = useStore((s) => s.loaded);
  const error = useStore((s) => s.error);
  const boards = useStore((s) => s.boards);
  const tasks = useStore((s) => s.tasks);
  const { bootstrap, connect, disconnect, setUI, toggleCollapsed } = useStore.getState();
  const gPressed = useRef(0);

  useEffect(() => { bootstrap(); connect(); return () => disconnect(); }, []); // eslint-disable-line

  // when a hidden tab returns, refresh to catch anything missed
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible' && !useStore.getState().connected) { bootstrap(); disconnect(); connect(); } };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []); // eslint-disable-line

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        const ai = useAI.getState();
        if (e.shiftKey) {
          if (voice.active) { if (ai.open && ai.view === 'voice') { ai.setVoice({ minimized: true }); ai.closePanel(); } else ai.openPanel('voice'); }
          else { ai.openPanel('voice'); voice.start(); }
        } else ai.toggle('chat');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setUI({ palette: !useStore.getState().ui.palette }); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const ui = useStore.getState().ui;
      if (ui.composer || ui.agentEditor || ui.automationEditor || ui.palette || ui.connectAgentId || ui.taskId) return;
      const k = e.key.toLowerCase();
      if (k === 'n' || k === 'c') { e.preventDefault(); setUI({ composer: { initial: {} } }); }
      else if (k === '[' || k === ']') toggleCollapsed();
      else if (k === '/') { e.preventDefault(); setUI({ palette: true }); }
      else if (k === 'g') gPressed.current = Date.now();
      else if (Date.now() - gPressed.current < 900) {
        const b = useStore.getState().boards[0];
        const map = { n: '#/analytics', o: '#/', a: '#/agents', u: '#/automations', s: '#/settings', y: '#/activity', b: b ? `#/board/${b.id}` : null };
        if (map[k]) location.hash = map[k];
        gPressed.current = 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line

  useEffect(() => { useAI.getState().loadConfig(); }, []);

  // close overlays when the route changes (keeps the task drawer if the URL asks for it)
  useEffect(() => {
    setUI({ connectAgentId: null, agentEditor: null, automationEditor: null, projectPicker: false, palette: false, ...(route.query.task ? {} : { taskId: null }) });
  }, [route.path]); // eslint-disable-line

  if (error && !loaded) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="empty"><div className="h2">Can’t load your <em>workspace.</em></div><p className="muted" style={{ margin: 0 }}>{error}</p><Button onClick={bootstrap}>Try again</Button></div>
      </div>
    );
  }
  if (!loaded) return <Skeleton />;

  const [head, rawId] = route.parts;
  const id = head === 'board' && !rawId ? boards[0]?.id : rawId;
  let name = head || 'overview';
  if (!['overview', 'board', 'boards', 'agents', 'automations', 'settings', 'activity', 'analytics', 'tutorial'].includes(name)) name = 'overview';
  const board = name === 'board' ? boards.find((b) => b.id === id) : null;
  const TITLES = { overview: 'Overview', boards: 'Boards', agents: 'Agents', automations: 'Automations', settings: 'Settings', activity: 'Activity', analytics: 'Analytics', tutorial: 'Tutorial' };
  const title = name === 'board' ? board?.name || 'Board' : TITLES[name];
  const open = board ? tasks.filter((t) => t.board_id === board.id && t.status !== 'done').length : 0;
  const sub = board ? `${open} open${board.repo ? ' · ' + board.repo.replace(/^https?:\/\/(www\.)?/, '') : ''}` : null;
  const active = name === 'board' ? 'board:' + id : name;
  const pageKey = name === 'board' ? 'board:' + id : name;

  return (
    <WarmTooltipGroup>
      <div className="shell">
        <Sidebar active={active} />
        <main className="main">
          <Topbar title={title} sub={sub} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={pageKey} className={name === 'board' ? 'page-enter' : 'scroll'}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6, transition: { duration: 0.14 } }} transition={{ duration: 0.4, ease: EASE_OUT }}>
              {name === 'overview' && <Overview />}
              {name === 'board' && <Board boardId={id} col={route.query.col} taskQ={route.query.task} />}
              {name === 'boards' && <Boards />}
              {name === 'analytics' && <Analytics />}
              {name === 'agents' && <Agents />}
              {name === 'automations' && <Automations />}
              {name === 'settings' && <Settings section={id} />}
              {name === 'tutorial' && <Tutorial />}
              {name === 'activity' && <Activity />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <ConfettiParty />
      <TaskComposer />
      <TaskDrawer />
      <AgentEditor />
      <ConnectPanel />
      <AutomationEditor />
      <Palette />
      <ProjectPicker />
      <MobileNav active={active} />
      <AssistantPanel />
      <VoiceBall />
      <Toasts />
    </WarmTooltipGroup>
  );
}
