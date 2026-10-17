import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import Icon from './Icon.jsx';
import { Avatar, Tip, Menu, LogoMark, Prio, Button, EASE_OUT, quick, Modal } from './ui.jsx';
import FolderFloat from '@/components/reactbits/FolderFloat';
import { useStore } from '../lib/store.js';
import BranchedMenu from '@/components/reactbits/BranchedMenu';
import BellToggle from '@/components/reactbits/BellToggle';
import { cx, STATUS_LABEL, providerLabel, initials } from '../lib/helpers.js';
import { useAI } from '../lib/ai.js';
import { voice } from '../lib/voice.js';
import { MOD } from './ai/Assistant.jsx';

const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

function NavItem({ item, active, collapsed, onNavigate }) {
  return (
    <Tip label={item.label} side="right" disabled={!collapsed} block>
      <a href={item.href} className={cx('nav-item', active && 'active')} onClick={onNavigate} aria-current={active ? 'page' : undefined}>
        {active ? <motion.span layoutId="nav-hl" className="nav-hl" transition={{ duration: 0.3, ease: EASE_OUT }} /> : null}
        <span className="ico">{item.icon}</span>
        <span className="hide-c trunc" style={{ transition: 'opacity .2s ease' }}>{item.label}</span>
        {item.count != null && item.count !== 0 ? <span className="count hide-c">{item.count}</span> : null}
      </a>
    </Tip>
  );
}

const COL_LABEL = { backlog: 'Backlog', queued: 'Queued', in_progress: 'In progress', review: 'Review', done: 'Done' };
/** Projects as a branched tree: each project unfolds into its columns with live counts. */
function ProjectTree({ boards, tasks, active, onNavigate }) {
  const sorted = [...boards].sort((a, b) => a.position - b.position);
  const activeId = active?.startsWith('board:') ? active.slice(6) : null;
  const items = sorted.map((b) => {
    const mine = tasks.filter((t) => t.board_id === b.id);
    return {
      label: b.name,
      children: [
        { value: `${b.id}|`, label: `Board · ${mine.filter((t) => t.status !== 'done').length} open`, icon: <Icon name="board" size={14} /> },
        ...['backlog', 'in_progress', 'review', 'done'].map((st) => ({
          value: `${b.id}|${st}`,
          label: `${COL_LABEL[st]} · ${mine.filter((t) => (st === 'in_progress' ? ['queued', 'in_progress'].includes(t.status) : t.status === st)).length}`,
          icon: <Icon name={{ backlog: 'inbox', in_progress: 'play', review: 'eye', done: 'done' }[st]} size={14} />,
        })),
      ],
    };
  });
  if (!items.length) return <div className="small muted" style={{ padding: '6px 12px' }}>No projects yet — press + to add one.</div>;
  const openIdx = Math.max(0, sorted.findIndex((b) => b.id === activeId));
  const go = (value) => {
    const [id, col] = value.split('|');
    onNavigate?.();
    location.hash = `#/board/${id}${col ? `?col=${col}` : ''}`;
  };
  return (
    <div className="project-tree">
      <BranchedMenu key={sorted.map((b) => b.id).join()} items={items} defaultOpen={openIdx} defaultActive={activeId ? `${activeId}|` : undefined} onSelect={(v) => go(v)}
        width={212} rowHeight={32} indent={20} trunk={8} radius={8} lineWidth={1} fontSize={13.5}
        color="#9f9fa0" accentColor="#ffffff" lineColor="#2e2e2e" />
    </div>
  );
}

const NOTIFY_KEY = 'assign:notify';
/** Bell toggle: when on, hand-backs to Review raise a desktop notification and the badge counts them. */
function ReviewBell() {
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const { toast, setUI } = useStore.getState();
  const [on, setOn] = useState(() => localStorage.getItem(NOTIFY_KEY) === '1');
  const review = tasks.filter((t) => t.status === 'review');
  const seen = useRef(null);
  useEffect(() => {
    const ids = new Set(review.map((t) => t.id));
    if (seen.current && on) {
      for (const t of review) if (!seen.current.has(t.id)) {
        const a = agents.find((x) => x.id === t.assignee_id);
        const title = `${a?.name || 'An agent'} handed back ${settings?.key_prefix || 'ASG'}-${t.number}`;
        try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(title, { body: t.title, tag: t.id }); } catch { /* ignore */ }
        toast(title, { tone: 'dispatch', color: a?.color, action: 'Review', onAction: () => setUI({ taskId: t.id }) });
      }
    }
    seen.current = ids;
  }, [review.map((t) => t.id).join(), on]); // eslint-disable-line
  const change = async (v) => {
    setOn(v); localStorage.setItem(NOTIFY_KEY, v ? '1' : '0');
    if (v && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* ignore */ } }
  };
  return (
    <span className="bell-wrap hide-sm">
      <BellToggle pressed={on} onChange={change} size="sm" radius={8} offLabel="Notify me" onLabel={review.length ? `${review.length} to review` : 'Notifying'} label="Notify me about hand-backs"
        count={review.length} badge background="transparent" color="#cacaca" onBackground="#ffffff" onColor="#0b0b0c" badgeColor="#847dff" waves={false} />
    </span>
  );
}

export function Sidebar({ active }) {
  const boards = useStore((s) => s.boards);
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const connected = useStore((s) => s.connected);
  const ui = useStore((s) => s.ui);
  const user = useStore((s) => s.auth.user);
  const workspace = useStore((s) => s.workspace);
  const { toggleCollapsed, setUI, saveBoard, logout } = useStore.getState();
  const clicks = useRef([]);
  const collapsed = ui.collapsed && !isMobile();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);
  const closeMobile = () => setUI({ mobileNav: false });

  const review = tasks.filter((t) => t.status === 'review').length;
  const main = [
    { key: 'overview', label: 'Overview', href: '#/', icon: <Icon name="dashboard" size={18} /> },
    { key: 'boards', label: 'Boards', href: '#/boards', icon: <Icon name="board" size={18} />, count: boards.length },
    { key: 'agents', label: 'Agents', href: '#/agents', icon: <Icon name="agents" size={18} />, count: agents.length },
    { key: 'analytics', label: 'Analytics', href: '#/analytics', icon: <Icon name="chart" size={18} /> },
    { key: 'automations', label: 'Automations', href: '#/automations', icon: <Icon name="automations" size={18} /> },
    { key: 'activity', label: 'Activity', href: '#/activity', icon: <Icon name="activity" size={18} />, count: review ? `${review} review` : null },
  ];
  const boardItems = [...boards].sort((a, b) => a.position - b.position).map((b) => ({
    key: 'board:' + b.id, label: b.name, href: `#/board/${b.id}`,
    icon: <span className="board-glyph">{(b.emoji || b.name[0] || '·').toUpperCase()}</span>,
    count: tasks.filter((t) => t.board_id === b.id && t.status !== 'done').length,
  }));

  const submit = async (e) => {
    e?.preventDefault();
    const n = name.trim();
    setName(''); setAdding(false);
    if (!n) return;
    try { const b = await saveBoard({ name: n }); location.hash = `#/board/${b.id}`; } catch { /* toast */ }
  };

  return (
    <>
      <AnimatePresence>{ui.mobileNav && <motion.div className="mobile-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeMobile} />}</AnimatePresence>
      <aside className={cx('sidebar', collapsed && 'collapsed', ui.mobileNav && 'open')} aria-label="Primary">
        <div className="sb-head">
          <a href="#/" className="wordmark" onClick={(e) => {
            const now = Date.now();
            clicks.current = clicks.current.filter((t) => now - t < 2500); clicks.current.push(now);
            if (clicks.current.length >= 8) {
              e.preventDefault(); clicks.current = [];
              document.body.classList.add('logo-party');
              const w = e.currentTarget; w.classList.add('wiggle'); setTimeout(() => w.classList.remove('wiggle'), 600);
              setTimeout(() => document.body.classList.remove('logo-party'), 4000);
            } else closeMobile();
          }} style={{ minWidth: 0 }}><LogoMark size={24} /><span className="hide-c">assign</span></a>
          <span className="spacer" />
          <span className="hide-c"><Tip label={collapsed ? 'Expand' : 'Collapse  ['}><button className="icon-btn sm" onClick={() => (isMobile() ? closeMobile() : toggleCollapsed())} aria-label="Collapse sidebar"><Icon name={isMobile() ? 'close' : 'sidebar'} size={17} /></button></Tip></span>
        </div>
        {collapsed && <div style={{ display: 'grid', placeItems: 'center', paddingBottom: 6 }}><Tip label="Expand  ]" side="right"><button className="icon-btn sm" onClick={toggleCollapsed} aria-label="Expand sidebar"><Icon name="sidebar" size={17} /></button></Tip></div>}

        <div className="sb-scroll">
          <div className="sb-section">
            <span className="label hide-c">{workspace?.name || 'Workspace'}</span>
            {main.map((it) => <NavItem key={it.key} item={it} active={active === it.key} collapsed={collapsed} onNavigate={closeMobile} />)}
            <AssistantNav collapsed={collapsed} onNavigate={closeMobile} />
          </div>
          <div className="sb-section">
            <span className="label hide-c">Projects
              <span className="row" style={{ gap: 2, marginLeft: 'auto' }}>
                <Tip label="Browse projects"><button className="icon-btn xs" onClick={() => setUI({ projectPicker: true })} aria-label="Browse projects"><Icon name="folder" size={14} /></button></Tip>
                <Tip label="New project"><button className="icon-btn xs" onClick={() => setAdding(true)} aria-label="New project"><Icon name="plus" size={14} /></button></Tip>
              </span>
            </span>
            {collapsed
              ? boardItems.map((it) => <NavItem key={it.key} item={it} active={active === it.key} collapsed={collapsed} onNavigate={closeMobile} />)
              : <ProjectTree boards={boards} tasks={tasks} active={active} onNavigate={closeMobile} />}
            <AnimatePresence>
              {adding && !collapsed && (
                <motion.form onSubmit={submit} initial={{ height: 0, opacity: 0 }} animate={{ height: 44, opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={quick} style={{ overflow: 'hidden', paddingTop: 4 }}>
                  <input ref={inputRef} className="input" style={{ height: 36 }} placeholder="Project name ↵" value={name} onChange={(e) => setName(e.target.value)} onBlur={submit} onKeyDown={(e) => e.key === 'Escape' && (setName(''), setAdding(false))} maxLength={60} />
                </motion.form>
              )}
            </AnimatePresence>
            {collapsed && <NavItem item={{ key: 'new', label: 'Projects', href: '#/', icon: <Icon name="folder" size={18} /> }} collapsed onNavigate={(e) => { e.preventDefault(); setUI({ projectPicker: true }); }} />}
          </div>
          {agents.length > 0 && (
            <div className="sb-section hide-c">
              <span className="label">Agents</span>
              {agents.slice(0, 8).map((a) => (
                <a key={a.id} href="#/agents" className="nav-item" onClick={(e) => { closeMobile(); setUI({ agentEditor: { agent: a } }); }} style={{ height: 34 }}>
                  <span className="ico"><Avatar agent={a} size={18} status /></span>
                  <span className="trunc">{a.name}</span>
                  <span className="count">{providerLabel(a.provider).split(' ')[0]}</span>
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="sb-foot">
          <div className={cx('conn label', connected && 'on')} style={{ padding: '6px 12px', height: 28 }} title={connected ? 'Realtime connected' : 'Reconnecting…'}>
            <i /><span className="hide-c">{connected ? 'Live · MCP ready' : 'Reconnecting…'}</span>
          </div>
          <div className="credit hide-c">Built by Amir Bagawan</div>
          <Menu
            right={false}
            up
            trigger={
              <button className="user-chip" aria-label="Account menu">
                <span className="avatar" style={{ width: 28, height: 28, background: '#cacaca', color: '#0f1011', fontSize: 11, flex: 'none' }}>{initials(user?.name)}</span>
                <span className="col hide-c" style={{ minWidth: 0, gap: 0 }}><span className="trunc" style={{ fontSize: 13.5, color: '#fff' }}>{user?.name}</span><span className="trunc tiny muted">{user?.email}</span></span>
              </button>
            }
            items={[
              { label: 'Settings', icon: 'settings', onClick: () => { closeMobile(); location.hash = '#/settings'; } },
              { label: 'Tutorial', icon: 'rocket', onClick: () => { closeMobile(); location.hash = '#/tutorial'; } },
              { label: 'Keyboard shortcuts', icon: 'command', onClick: () => setUI({ palette: true }) },
              { label: 'View landing page', icon: 'external', onClick: () => { location.hash = '#/home'; } },
              'sep',
              { label: 'Sign out', icon: 'logout', onClick: logout },
            ]}
          />
        </div>
      </aside>
    </>
  );
}

/** Sidebar entry for the assistant: opens the chat panel (the single mic lives in its input bar). */
function AssistantNav({ collapsed, onNavigate }) {
  const open = useAI((s) => s.open);
  return (
    <Tip label={`Assistant  ${MOD}J`} side="right" disabled={!collapsed} block>
      <div className={cx('nav-item ai-nav', open && 'active')} role="button" tabIndex={0}
        onClick={() => { onNavigate?.(); useAI.getState().toggle('chat'); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); useAI.getState().toggle('chat'); } }}>
        <span className="ico"><span className="ai-glyph"><Icon name="magic" size={15} /></span></span>
        <span className="hide-c trunc">Assistant</span>
        <span className="hide-c" style={{ marginLeft: 'auto' }}>
          <span className="kbd">{MOD} J</span>
        </span>
      </div>
    </Tip>
  );
}

/** Phone navigation: bottom tab bar + a floating voice button (bottom right). */
export function MobileNav({ active }) {
  const boards = useStore((s) => s.boards);
  const review = useStore((s) => s.tasks.filter((t) => t.status === 'review').length);
  const setUI = useStore((s) => s.setUI);
  const vs = useAI((s) => s.voice.status);
  const aiOpen = useAI((s) => s.open);
  const live = !['idle', 'ended', 'error'].includes(vs);
  const b = [...boards].sort((x, y) => x.position - y.position)[0];
  const items = [
    { key: 'overview', label: 'Home', href: '#/', icon: 'dashboard' },
    { key: b ? 'board:' + b.id : 'board', label: 'Board', href: b ? `#/board/${b.id}` : '#/', icon: 'board', match: (k) => k.startsWith('board') },
    { key: 'activity', label: 'Inbox', href: '#/activity', icon: 'inbox', badge: review },
    { key: 'agents', label: 'Agents', href: '#/agents', icon: 'agents' },
  ];
  return (
    <>
      <nav className="mnav" aria-label="Primary (mobile)">
        {items.map((it) => {
          const on = it.match ? it.match(active) : active === it.key;
          return (
            <a key={it.label} href={it.href} className={cx('mnav-item', on && 'on')} aria-current={on ? 'page' : undefined}>
              {on ? <motion.span layoutId="mnav-hl" className="mnav-hl" transition={{ duration: 0.3, ease: EASE_OUT }} /> : null}
              <span className="mnav-ico"><Icon name={it.icon} size={20} />{it.badge ? <i className="mnav-badge">{it.badge > 9 ? '9+' : it.badge}</i> : null}</span>
              <span className="mnav-lbl">{it.label}</span>
            </a>
          );
        })}
        <button className="mnav-item" onClick={() => setUI({ mobileNav: true })} aria-label="More">
          <span className="mnav-ico"><Icon name="menu" size={20} /></span><span className="mnav-lbl">More</span>
        </button>
      </nav>
      <AnimatePresence>
        {!live && !aiOpen && (
          <motion.button className="ai-fab" aria-label="Open assistant" onClick={() => useAI.getState().openPanel('voice')}
            initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            whileTap={{ scale: 0.92 }}>
            <span className="ai-fab-halo" /><Icon name="mic" size={22} />
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}

export function Topbar({ title, sub, actions }) {
  const setUI = useStore((s) => s.setUI);
  return (
    <header className="topbar">
      <button className="menu-btn icon-btn" onClick={() => setUI({ mobileNav: true })} aria-label="Open navigation"><Icon name="menu" /></button>
      <div className="crumbs">
        <AnimatePresence mode="wait">
          <motion.span key={title} className="h4 serif" initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: EASE_OUT }}>{title}</motion.span>
        </AnimatePresence>
        {sub ? <span className="label hide-sm">{sub}</span> : null}
      </div>
      <div className="spacer" />
      {actions}
      <Tip label={`Assistant  ${MOD}J`}><button className="ask-pill hide-sm" onClick={() => useAI.getState().toggle('chat')} aria-label="Open assistant"><Icon name="magic" size={15} /><span>Ask</span></button></Tip>
      <Tip label={`Voice  ${MOD}I`}><button className="icon-btn hide-sm" aria-label="Start voice assistant" onClick={() => { const ai = useAI.getState(); ai.openPanel('voice'); ai.setVoice({ minimized: false }); if (!voice.active) voice.start(); }}><Icon name="mic" size={16} /></button></Tip>
      <ReviewBell />
      <button className="search-pill" onClick={() => setUI({ palette: true })} aria-label="Search and commands">
        <Icon name="search" size={15} /><span className="sp-text">Search or jump to…</span><span className="kbd">⌘K</span>
      </button>
      <Button size="sm" onClick={() => setUI({ composer: { initial: {} } })}><Icon name="plus" size={15} /><span className="hide-sm">New task</span></Button>
    </header>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  return createPortal(
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div key={t.id} layout className={cx('toast', t.tone === 'error' && 'error', t.tone === 'warn' && 'warn', t.tone === 'success' && 'success')} initial={{ opacity: 0, y: 24, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }} transition={{ duration: 0.35, ease: EASE_OUT }}>
            {t.tone === 'dispatch' ? <span className="t-dot" style={{ background: t.color || '#847dff' }} /> : null}
            {t.tone === 'error' || t.tone === 'warn' ? <Icon name="alert" size={15} /> : null}
            {t.tone === 'success' ? <Icon name="check" size={15} /> : null}
            <span style={{ padding: '10px 0' }}>{t.message}</span>
            {t.action ? <button className="t-act" onClick={() => { t.onAction?.(); dismissToast(t.id); }}>{t.action}</button> : null}
            <button className="icon-btn xs" style={{ color: 'inherit' }} onClick={() => dismissToast(t.id)} aria-label="Dismiss"><Icon name="close" size={13} /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

const SHORTCUTS = [['N', 'New task'], ['⌘ K  or  /', 'Search & commands'], ['[  ]', 'Collapse sidebar'], ['G then B', 'Go to first board'], ['G then N', 'Analytics'], ['Esc', 'Close panels']];

export function Palette() {
  const open = useStore((s) => s.ui.palette);
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const boards = useStore((s) => s.boards);
  const settings = useStore((s) => s.settings);
  const setUI = useStore((s) => s.setUI);
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { if (open) { setQ(''); setHl(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);
  const prefix = settings?.key_prefix || 'ASG';

  const groups = useMemo(() => {
    const ql = q.toLowerCase().trim();
    const go = (h) => () => { location.hash = h; };
    const actions = [
      { id: 'new', label: 'Create task', kbd: 'N', icon: 'plus', run: () => setUI({ composer: { initial: {} } }) },
      { id: 'agent', label: 'Add coding agent', icon: 'robot', run: () => setUI({ agentEditor: {} }) },
      { id: 'auto', label: 'New automation', icon: 'automations', run: () => setUI({ automationEditor: {} }) },
      { id: 'nav-o', label: 'Go to Overview', icon: 'dashboard', run: go('#/') },
      { id: 'nav-b', label: 'Go to Boards', icon: 'board', run: go('#/boards') },
      { id: 'nav-an', label: 'Go to Analytics', icon: 'chart', run: go('#/analytics') },
      { id: 'projects', label: 'Browse projects', icon: 'folder', run: () => setUI({ projectPicker: true }) },
      { id: 'nav-a', label: 'Go to Agents', icon: 'agents', run: go('#/agents') },
      { id: 'nav-au', label: 'Go to Automations', icon: 'automations', run: go('#/automations') },
      { id: 'nav-ac', label: 'Go to Activity', icon: 'activity', run: go('#/activity') },
      { id: 'nav-s', label: 'Open Settings', icon: 'settings', run: go('#/settings') },
      { id: 'nav-t', label: 'Open Tutorial', icon: 'rocket', run: go('#/tutorial') },
      ...boards.map((b) => ({ id: 'b' + b.id, label: `Open project · ${b.name}`, icon: 'board', run: go(`#/board/${b.id}`) })),
    ].map((x) => ({ ...x, iconEl: <Icon name={x.icon} size={17} /> }));
    const ts = tasks.filter((t) => !t._pending).map((t) => ({ id: t.id, label: t.title, sub: `${prefix}-${t.number} · ${STATUS_LABEL[t.status]}`, iconEl: <Prio p={t.priority} />, right: <Avatar agent={agents.find((a) => a.id === t.assignee_id)} size={20} />, run: () => setUI({ taskId: t.id }), hay: `${t.title} ${prefix}-${t.number} ${(t.tags || []).join(' ')}`.toLowerCase(), done: t.status === 'done' }));
    const as = agents.map((a) => ({ id: a.id, label: a.name, sub: `${providerLabel(a.provider)} · @${a.handle}`, iconEl: <Avatar agent={a} size={20} />, run: () => setUI({ agentEditor: { agent: a } }), hay: `${a.name} ${a.role} ${a.handle} ${a.provider}`.toLowerCase() }));
    const m = (x) => (x.hay || x.label.toLowerCase()).includes(ql);
    if (!ql) return [['Actions', actions.slice(0, 6)], ['Recent tasks', ts.filter((t) => !t.done).slice(-6).reverse()]].filter(([, l]) => l.length);
    return [['Actions', actions.filter(m)], ['Agents', as.filter(m)], ['Tasks', ts.filter(m).slice(0, 20)]].filter(([, l]) => l.length);
  }, [q, tasks, agents, boards, setUI, prefix]);
  const flat = groups.flatMap(([, l]) => l);

  useEffect(() => { listRef.current?.querySelector('.hl')?.scrollIntoView({ block: 'nearest' }); }, [hl]);
  const close = () => setUI({ palette: false });
  const run = (it) => { close(); setTimeout(it.run, 60); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(flat.length - 1, h + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(0, h - 1)); }
    if (e.key === 'Enter' && flat[hl]) run(flat[hl]);
  };
  let idx = -1;
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={quick} onClick={close} />
          <div className="modal-pos" style={{ pointerEvents: 'none' }}>
            <motion.div className="palette" role="dialog" aria-label="Command palette" initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, transition: { duration: 0.12 } }} transition={{ duration: 0.28, ease: EASE_OUT }} onKeyDown={onKey}>
              <div className="p-input"><Icon name="search" size={17} style={{ color: 'var(--t-muted)' }} /><input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setHl(0); }} placeholder="Search tasks, agents, actions…" aria-label="Command search" /><span className="kbd">Esc</span></div>
              <div className="p-list" ref={listRef}>
                {flat.length === 0 && <div className="muted center small" style={{ padding: 28 }}>Nothing matches “{q}”</div>}
                {groups.map(([g, list]) => (
                  <div key={g}>
                    <div className="p-group label">{g}</div>
                    {list.map((it) => {
                      idx++; const i = idx;
                      return (
                        <button key={it.id} className={cx('menu-item', i === hl && 'hl')} onMouseMove={() => hl !== i && setHl(i)} onClick={() => run(it)}>
                          <span style={{ width: 22, display: 'grid', placeItems: 'center', flex: 'none' }}>{it.iconEl}</span>
                          <span className="col" style={{ minWidth: 0, gap: 1 }}><span className="trunc">{it.label}</span>{it.sub ? <span className="tiny muted mono trunc">{it.sub}</span> : null}</span>
                          <span style={{ marginLeft: 'auto', flex: 'none' }}>{it.right || (it.kbd ? <span className="kbd">{it.kbd}</span> : i === hl ? <span className="kbd">↵</span> : null)}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
                {!q && (
                  <div style={{ padding: '6px 10px 10px' }}>
                    <div className="p-group label" style={{ padding: '10px 0 6px' }}>Shortcuts</div>
                    <div className="row wrap" style={{ gap: 14 }}>{SHORTCUTS.map(([k, l]) => <span key={l} className="row tiny muted" style={{ gap: 6 }}><span className="kbd">{k}</span>{l}</span>)}</div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Projects picker — react-bits Folder Float. Projects spill out of the folder; pick one or add a new one. */
export function ProjectPicker() {
  const open = useStore((s) => s.ui.projectPicker);
  const boards = useStore((s) => s.boards);
  const tasks = useStore((s) => s.tasks);
  const { setUI, saveBoard, toast } = useStore.getState();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => { setUI({ projectPicker: false }); setCreating(false); setName(''); };
  const sorted = [...boards].sort((a, b) => a.position - b.position);
  const items = [...sorted.slice(0, 9).map((b) => ({ label: b.name, value: b.id })), { label: '+ New project', value: '__new' }];
  const pick = (v) => {
    if (v === '__new') { setCreating(true); return; }
    close(); location.hash = `#/board/${v}`;
  };
  const create = async (e) => {
    e.preventDefault();
    const n = name.trim(); if (!n || busy) return;
    setBusy(true);
    try { const b = await saveBoard({ name: n }); close(); location.hash = `#/board/${b.id}`; toast(`Project “${b.name}” created`); }
    catch { /* store toasts */ } finally { setBusy(false); }
  };
  const open_ = tasks.filter((t) => t.status !== 'done').length;
  return (
    <Modal open={open} onClose={close} label="Projects">
      <div className="modal-head">
        <div className="col" style={{ gap: 4 }}>
          <span className="h3" style={{ lineHeight: 1 }}>Your <em>projects</em></span>
          <span className="label">{boards.length} project{boards.length === 1 ? '' : 's'} · {open_} open tasks</span>
        </div>
        <span className="spacer" />
        <button type="button" className="icon-btn" onClick={close} aria-label="Close"><Icon name="close" /></button>
      </div>
      <div className="modal-body" style={{ gap: 18 }}>
        <div className="folder-stage">
          <FolderFloat key={items.map((i) => i.value).join()} items={items} label="Projects" sublabel={`${boards.length} inside`} trigger="click" defaultOpen closeOnSelect={false}
            onSelect={(v) => pick(v)} folderColor="#2e2e2e" frontColor="#3f4041" paperColor="#cacaca" itemColor="#f5f5f7" itemTextColor="#0b0b0c" labelColor="#f5f5f7"
            width={190} height={136} radius={16} spread={200} bounce={0.15} />
        </div>
        <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>Click a project to open its board. Drag them around if you like — the folder closes on click.</p>
        <AnimatePresence initial={false}>
          {creating && (
            <motion.form onSubmit={create} className="row" style={{ gap: 8, overflow: 'hidden' }} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={quick}>
              <input autoFocus className="input" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} style={{ flex: 1 }} />
              <Button type="submit" size="sm" disabled={!name.trim() || busy}>Create →</Button>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}
