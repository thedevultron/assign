import { create } from 'zustand';
import { api, session, setUnauthorizedHandler } from './api.js';
import { rid, taskKey } from './helpers.js';

const upsert = (list, item) => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice(); next[i] = { ...list[i], ...item }; return next;
};
const remove = (list, id) => list.filter((x) => x.id !== id);
const swapTemp = (list, tempId, item) => upsert(remove(list, tempId), { ...item, _pending: false });

let toastSeq = 0;
const EMPTY = { loaded: false, error: null, settings: null, workspace: null, boards: [], agents: [], tasks: [], automations: [], activity: [], flashes: {}, runners: [], runnerSessions: [], runnerOutput: {}, usage: [] };

export const useStore = create((set, get) => ({
  /* ---------- auth ---------- */
  auth: { status: session.get() ? 'checking' : 'anon', user: null, workspace: null },
  ...EMPTY,
  connected: false,
  toasts: [],

  checkSession: async () => {
    if (!session.get()) { set({ auth: { status: 'anon', user: null, workspace: null } }); return null; }
    // hard watchdog: even if something above the api layer stalls, boot must complete
    const wd = setTimeout(() => { if (get().auth.status === 'checking') set({ auth: { ...get().auth, status: 'offline' } }); }, 15000);
    try {
      const me = await api.get('/auth/me');
      set({ auth: { status: 'authed', user: me.user, workspace: me.workspace }, settings: me.settings });
      return me;
    } catch (e) {
      if (e.status === 401) { session.set(null); set({ auth: { status: 'anon', user: null, workspace: null } }); return null; }
      set({ auth: { ...get().auth, status: 'offline' }, error: e.message });
      return null;
    } finally { clearTimeout(wd); }
  },
  signup: async (data) => {
    const r = await api.post('/auth/signup', data);
    session.set(r.token);
    set({ ...EMPTY, auth: { status: 'authed', user: r.user, workspace: r.workspace } });
    return r;
  },
  login: async (data) => {
    const r = await api.post('/auth/login', data);
    session.set(r.token);
    set({ ...EMPTY, auth: { status: 'authed', user: r.user, workspace: r.workspace } });
    return r;
  },
  logout: async () => {
    try { await api.post('/auth/logout'); } catch {}
    get().disconnect();
    session.set(null);
    set({ ...EMPTY, auth: { status: 'anon', user: null, workspace: null } });
    location.hash = '#/';
  },
  setWorkspace: (workspace) => set((s) => ({ workspace, auth: { ...s.auth, workspace } })),
  setUser: (user) => set((s) => ({ auth: { ...s.auth, user } })),

  /* ---------- ui ---------- */
  ui: {
    collapsed: localStorage.getItem('assign:collapsed') === '1',
    mobileNav: false,
    composer: null,
    taskId: null,
    agentEditor: null,
    connectAgentId: null,
    automationEditor: null,
    palette: false,
    projectPicker: false,
  },
  setUI: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
  toggleCollapsed: () => set((s) => { const c = !s.ui.collapsed; localStorage.setItem('assign:collapsed', c ? '1' : '0'); return { ui: { ...s.ui, collapsed: c } }; }),

  /* ---------- toasts ---------- */
  toast: (message, opts = {}) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, ...opts }] }));
    setTimeout(() => get().dismissToast(id), opts.duration || 4200);
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  fail: (e) => get().toast(e?.message || 'Something went wrong', { tone: 'error' }),
  key: (t) => taskKey(get().settings, t),

  /* ---------- bootstrap + realtime ---------- */
  bootstrap: async () => {
    const wd = setTimeout(() => { if (!get().loaded) set({ error: 'The server is taking too long — it might be restarting' }); }, 15000);
    try {
      const d = await api.get('/bootstrap');
      set((s) => ({ ...d, loaded: true, error: null, auth: { ...s.auth, user: d.user, workspace: d.workspace } }));
    } catch (e) { if (e.status !== 401) set({ error: e.message }); }
    finally { clearTimeout(wd); }
  },
  disconnect: () => { const es = get()._es; if (es) es.close(); set({ _es: null, connected: false }); },
  connect: () => {
    if (get()._es) return;
    const token = session.get(); if (!token) return;
    const es = new EventSource('/api/events?session=' + encodeURIComponent(token));
    set({ _es: es });
    es.onopen = () => set({ connected: true });
    es.onerror = () => set({ connected: false });
    const on = (type, fn) => es.addEventListener(type, (e) => { try { fn(JSON.parse(e.data)); } catch (err) { console.error(err); } });
    on('task', (t) => set((s) => {
      const prev = s.tasks.find((x) => x.id === t.id);
      const flashes = prev && prev.status !== 'queued' && t.status === 'queued' ? { ...s.flashes, [t.id]: Date.now() } : s.flashes;
      if (prev && prev.status !== 'done' && t.status === 'done' && !t._pending) window.dispatchEvent(new CustomEvent('assign:party', { detail: { kind: 'done' } }));
      return { tasks: upsert(s.tasks, { ...t, _pending: false }), flashes };
    }));
    on('task:delete', ({ id }) => set((s) => ({ tasks: remove(s.tasks, id) })));
    on('agent', (a) => {
      const prev = get().agents.find((x) => x.id === a.id);
      set((s) => ({ agents: upsert(s.agents, a) }));
      if (a.pair_pending && !prev?.pair_pending && get().ui.connectAgentId !== a.id) {
        get().toast(`${a.name} wants to pair${a.pair_client ? ` from ${a.pair_client}` : ''}`, { tone: 'dispatch', color: a.color, action: 'Enter code', onAction: () => get().setUI({ connectAgentId: a.id }), duration: 9000 });
      }
    });
    on('agent:delete', ({ id }) => set((s) => ({ agents: remove(s.agents, id) })));
    on('board', (b) => set((s) => ({ boards: upsert(s.boards, b) })));
    on('board:delete', ({ id }) => set((s) => ({ boards: remove(s.boards, id), tasks: s.tasks.filter((t) => t.board_id !== id) })));
    on('automation', (a) => set((s) => ({ automations: upsert(s.automations, a) })));
    on('automation:delete', ({ id }) => set((s) => ({ automations: remove(s.automations, id) })));
    on('activity', (ev) => set((s) => (s.activity.some((x) => x.id === ev.id) ? {} : { activity: [ev, ...s.activity].slice(0, 400) })));
    on('settings', (st) => set({ settings: st }));
    on('workspace', (w) => get().setWorkspace(w));
    on('reset', () => get().bootstrap());
    on('runner', (r) => set((s) => ({ runners: upsert(s.runners, r) })));
    on('runner:delete', ({ id }) => set((s) => ({ runners: remove(s.runners, id) })));
    on('runner_session', (sess) => set((s) => ({ runnerSessions: upsert(s.runnerSessions, sess) })));
    on('runner_output', ({ id, chunk }) => set((s) => ({ runnerOutput: { ...s.runnerOutput, [id]: ((s.runnerOutput[id] || '') + chunk).slice(-512 * 1024) } })));
    on('usage', (u) => set((s) => ({ usage: [u, ...s.usage].slice(0, 200) })));
  },

  /* ---------- tasks ---------- */
  createTask: async (data) => {
    const id = rid('t_');
    const nowIso = new Date().toISOString();
    const minPos = Math.min(0, ...get().tasks.filter((t) => t.board_id === data.board_id && t.status === (data.status || 'backlog')).map((t) => t.position));
    const temp = { id, number: '…', description: '', acceptance: '', tags: [], priority: 'medium', status: 'backlog', progress: 0, position: minPos - 1, start_mode: 'policy', created_at: nowIso, updated_at: nowIso, _pending: true, ...data };
    set((s) => ({ tasks: [...s.tasks, temp] }));
    try {
      const t = await api.post('/tasks', { ...data, id });
      set((s) => ({ tasks: swapTemp(s.tasks, id, t) }));
      return t;
    } catch (e) {
      set((s) => ({ tasks: remove(s.tasks, id) })); get().fail(e); throw e;
    }
  },
  updateTask: async (id, patch, { silent } = {}) => {
    const prev = get().tasks.find((t) => t.id === id);
    if (!prev) return;
    set((s) => ({ tasks: upsert(s.tasks, { ...patch, id }) }));
    try {
      const t = await api.patch(`/tasks/${id}`, patch);
      set((s) => ({ tasks: upsert(s.tasks, t) }));
      return t;
    } catch (e) {
      set((s) => ({ tasks: upsert(s.tasks, prev) })); if (!silent) get().fail(e); throw e;
    }
  },
  moveTask: (id, status, position) => {
    const t = get().tasks.find((x) => x.id === id);
    if (!t) return;
    if (t.status !== status && status === 'queued') set((s) => ({ flashes: { ...s.flashes, [id]: Date.now() } }));
    return get().updateTask(id, { status, position }).catch(() => {});
  },
  deleteTask: async (id) => {
    const prev = get().tasks.find((t) => t.id === id);
    if (!prev) return;
    set((s) => ({ tasks: remove(s.tasks, id), ui: s.ui.taskId === id ? { ...s.ui, taskId: null } : s.ui }));
    try {
      const { task } = await api.del(`/tasks/${id}`);
      get().toast(`Deleted ${get().key(prev)}`, {
        action: 'Undo',
        onAction: async () => {
          set((s) => ({ tasks: upsert(s.tasks, task) }));
          try { await api.post(`/tasks/${id}/restore`, { task }); } catch (e) { get().fail(e); set((s) => ({ tasks: remove(s.tasks, id) })); }
        },
      });
    } catch (e) { set((s) => ({ tasks: upsert(s.tasks, prev) })); get().fail(e); }
  },
  startTask: async (id) => {
    set((s) => ({ flashes: { ...s.flashes, [id]: Date.now() }, tasks: s.tasks.map((t) => (t.id === id && t.status === 'backlog' ? { ...t, status: 'queued' } : t)) }));
    try {
      const t = await api.post(`/tasks/${id}/start`);
      set((s) => ({ tasks: upsert(s.tasks, t) }));
      const a = get().agents.find((x) => x.id === t.assignee_id);
      if (t.status === 'queued') get().toast(`Sent to ${a?.name || 'agent'}`, { tone: 'dispatch', color: a?.color });
      else get().toast('No active agent could take this task — add or resume an agent', { tone: 'error' });
    } catch (e) { get().fail(e); get().bootstrap(); }
  },
  addComment: async (taskId, message) => {
    const temp = { id: rid('ev_'), task_id: taskId, actor: 'you', kind: 'comment', message, created_at: new Date().toISOString(), _pending: true };
    set((s) => ({ activity: [temp, ...s.activity] }));
    try {
      const ev = await api.post(`/tasks/${taskId}/comments`, { message });
      set((s) => ({ activity: [ev, ...s.activity.filter((x) => x.id !== temp.id && x.id !== ev.id)] }));
      return ev;
    } catch (e) { set((s) => ({ activity: remove(s.activity, temp.id) })); get().fail(e); throw e; }
  },

  /* ---------- agents ---------- */
  saveAgent: async (data) => {
    if (data.id && get().agents.some((a) => a.id === data.id)) {
      const prev = get().agents.find((a) => a.id === data.id);
      set((s) => ({ agents: upsert(s.agents, data) }));
      try { const a = await api.patch(`/agents/${data.id}`, data); set((s) => ({ agents: upsert(s.agents, a) })); return a; }
      catch (e) { set((s) => ({ agents: upsert(s.agents, prev) })); get().fail(e); throw e; }
    }
    const id = rid('tmp_');
    set((s) => ({ agents: [...s.agents, { skills: [], ...data, id, handle: (data.name || '').toLowerCase().replace(/[^a-z0-9]/g, ''), _pending: true, created_at: new Date().toISOString() }] }));
    try { const a = await api.post('/agents', data); set((s) => ({ agents: swapTemp(s.agents, id, a) })); return a; }
    catch (e) { set((s) => ({ agents: remove(s.agents, id) })); get().fail(e); throw e; }
  },
  deleteAgent: async (id) => {
    const prev = get().agents.find((a) => a.id === id);
    set((s) => ({ agents: remove(s.agents, id), tasks: s.tasks.map((t) => (t.assignee_id === id ? { ...t, assignee_id: null } : t)) }));
    try { await api.del(`/agents/${id}`); get().toast(`Removed ${prev?.name}`); }
    catch (e) { get().fail(e); get().bootstrap(); }
  },
  rotateToken: async (id) => {
    try { const a = await api.post(`/agents/${id}/token`); set((s) => ({ agents: upsert(s.agents, a) })); get().toast('New token issued — update your agent’s config'); return a; }
    catch (e) { get().fail(e); }
  },

  /* ---------- local runners ---------- */
  addRunner: async (name) => {
    const r = await api.post('/runners', { name });
    return r; // token included once
  },
  patchRunner: async (id, patch) => api.patch(`/runners/${id}`, patch),
  deleteRunner: async (id) => { await api.delete(`/runners/${id}`); set((s) => ({ runners: remove(s.runners, id) })); },
  runOnRunner: async (runnerId, taskId) => api.post(`/runners/${runnerId}/run-task`, { task_id: taskId }),
  stopRunnerSession: async (sessionId) => api.post(`/runner-sessions/${sessionId}/stop`),
  fetchRunnerOutput: async (sessionId) => {
    const d = await api.get(`/runner-sessions/${sessionId}/output`);
    set((s) => ({ runnerOutput: { ...s.runnerOutput, [sessionId]: d.output || '' } }));
    return d;
  },

  /* ---------- boards ---------- */
  saveBoard: async (data) => {
    if (data.id && get().boards.some((b) => b.id === data.id)) {
      const prev = get().boards.find((b) => b.id === data.id);
      set((s) => ({ boards: upsert(s.boards, data) }));
      try { const b = await api.patch(`/boards/${data.id}`, data); set((s) => ({ boards: upsert(s.boards, b) })); return b; }
      catch (e) { set((s) => ({ boards: upsert(s.boards, prev) })); get().fail(e); throw e; }
    }
    const id = rid('tmp_');
    set((s) => ({ boards: [...s.boards, { ...data, id, position: 999, _pending: true }] }));
    try { const b = await api.post('/boards', data); set((s) => ({ boards: swapTemp(s.boards, id, b) })); return b; }
    catch (e) { set((s) => ({ boards: remove(s.boards, id) })); get().fail(e); throw e; }
  },
  deleteBoard: async (id) => {
    const snapshot = { boards: get().boards, tasks: get().tasks };
    set((s) => ({ boards: remove(s.boards, id), tasks: s.tasks.filter((t) => t.board_id !== id) }));
    try { await api.del(`/boards/${id}`); get().toast('Board deleted'); return true; }
    catch (e) { set(snapshot); get().fail(e); return false; }
  },

  /* ---------- automations ---------- */
  saveAutomation: async (data) => {
    if (data.id && get().automations.some((a) => a.id === data.id)) {
      const prev = get().automations.find((a) => a.id === data.id);
      set((s) => ({ automations: upsert(s.automations, data) }));
      try { const a = await api.patch(`/automations/${data.id}`, data); set((s) => ({ automations: upsert(s.automations, a) })); return a; }
      catch (e) { set((s) => ({ automations: upsert(s.automations, prev) })); get().fail(e); throw e; }
    }
    const id = rid('tmp_');
    set((s) => ({ automations: [...s.automations, { ...data, id, run_count: 0, _pending: true }] }));
    try { const a = await api.post('/automations', data); set((s) => ({ automations: swapTemp(s.automations, id, a) })); return a; }
    catch (e) { set((s) => ({ automations: remove(s.automations, id) })); get().fail(e); throw e; }
  },
  deleteAutomation: async (id) => {
    const prev = get().automations.find((a) => a.id === id);
    set((s) => ({ automations: remove(s.automations, id) }));
    try { await api.del(`/automations/${id}`); get().toast(`Deleted “${prev?.name}”`); }
    catch (e) { set((s) => ({ automations: upsert(s.automations, prev) })); get().fail(e); }
  },
  runAutomation: async (id) => {
    try { const { summary, automation } = await api.post(`/automations/${id}/run`); set((s) => ({ automations: upsert(s.automations, automation) })); get().toast(summary, { tone: 'dispatch' }); }
    catch (e) { get().fail(e); }
  },

  /* ---------- settings ---------- */
  updateSettings: async (patch) => {
    const prev = get().settings;
    const merged = { ...prev, ...patch, policy: patch.policy ? Object.fromEntries(Object.entries(prev.policy).map(([k, v]) => [k, { ...v, ...(patch.policy[k] || {}) }])) : prev.policy };
    delete merged.workspace;
    set({ settings: merged });
    if (patch.workspace) get().setWorkspace({ ...get().workspace, name: patch.workspace });
    try { const s = await api.patch('/settings', patch); set({ settings: s }); return s; }
    catch (e) { set({ settings: prev }); get().fail(e); get().bootstrap(); }
  },
}));

let ejectGuard = 0;
setUnauthorizedHandler(() => {
  const st = useStore.getState();
  if (st.auth.status !== 'authed') return;
  const now = Date.now();
  if (now - ejectGuard < 8000) return; // coalesce bursts of 401s into one decision
  ejectGuard = now;
  // Only eject when the session is CONFIRMED dead (401). Transient server restarts
  // must never kick the user out — the next successful call simply resumes the session.
  api.get('/auth/me')
    .then((me) => { useStore.setState({ auth: { status: 'authed', user: me.user, workspace: me.workspace }, settings: me.settings }); })
    .catch((e) => {
      if (e.status === 401) {
        st.disconnect(); session.set(null);
        useStore.setState({ ...EMPTY, auth: { status: 'anon', user: null, workspace: null } });
        location.hash = '#/login';
      } else {
        useStore.setState({ error: null });
        useStore.getState().bootstrap().catch(() => {});
      }
    });
});

export const useAgent = (id) => useStore((s) => s.agents.find((a) => a.id === id));
export const useKey = () => { const settings = useStore((s) => s.settings); return (t) => taskKey(settings, t); };
