// In-app assistant: config, chat (streamed agent loop) and shared UI state.
// Voice lives in voice.js and reports into the same store.
import { create } from 'zustand';
import { api, session } from './api.js';
import { useStore } from './store.js';

const SAVE_KEY = 'assign:ai-chat';
const uid = () => Math.random().toString(36).slice(2, 10);
const load = () => { try { const j = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return j && Array.isArray(j.messages) ? j : null; } catch { return null; } };
const saved = load();

export const TOOL_LABEL = {
  get_workspace_overview: 'Overview', list_tasks: 'Find tasks', get_task: 'Read task', list_agents: 'Agents', get_agent: 'Read agent', list_projects: 'Projects',
  list_automations: 'Automations', get_analytics: 'Analytics', get_recent_activity: 'Activity', get_settings: 'Settings',
  create_task: 'Create task', update_task: 'Edit task', move_task: 'Move task', assign_task: 'Assign', send_task: 'Send task', comment_on_task: 'Comment',
  request_changes: 'Request changes', create_project: 'New project', create_agent: 'New agent', update_agent: 'Edit agent', create_automation: 'New automation',
  update_automation: 'Edit automation', run_automation: 'Run automation', approve_task: 'Approve', delete_task: 'Delete task', delete_agent: 'Remove agent',
  list_agent_files: 'Agent files', save_agent_file: 'Save file', delete_agent_file: 'Delete file',
  delete_project: 'Delete project', delete_automation: 'Delete automation', update_settings: 'Settings', open_page: 'Open',
  list_runners: 'Local runners', list_local_runs: 'Local runs', run_task_on_runner: 'Run locally', stop_local_run: 'Stop run', get_run_output: 'Read output',
};
export const toolIcon = (name) => (/^(get_|list_)/.test(name) ? 'search' : name === 'open_page' ? 'file' : /delete|approve|settings/.test(name) ? 'terminal' : 'edit');
export function toolArg(name, args = {}) {
  const a = args || {};
  return a.task || a.title || a.agent || a.name || a.project || a.automation || a.page || a.query || a.status || (a.days ? `${a.days} days` : '') || '';
}

export const useAI = create((set, get) => ({
  config: null,
  open: false,
  view: 'chat', // chat | voice
  messages: saved?.messages || [], // provider-neutral history sent to the server
  thread: saved?.thread || [], // what the panel renders
  busy: false,
  voice: { status: 'idle', minimized: false, muted: false, lines: [], calls: [], thought: '', error: '', model: '', startedAt: 0 },
  _ctrl: null,

  set: (p) => set(p),
  setVoice: (p) => set((s) => ({ voice: { ...s.voice, ...(typeof p === 'function' ? p(s.voice) : p) } })),

  async loadConfig() {
    try { const c = await api.get('/ai/config'); set({ config: c }); return c; } catch (e) { return null; }
  },
  async saveSettings(patch) {
    const prev = get().config;
    if (prev) set({ config: { ...prev, settings: { ...prev.settings, ...patch } } });
    try { const c = await api.patch('/ai/settings', patch); set({ config: c }); return c; }
    catch (e) { if (prev) set({ config: prev }); useStore.getState().toast(e.message, { tone: 'error' }); throw e; }
  },
  async saveKey(provider, key) {
    const c = await api.put(`/ai/keys/${provider}`, { key });
    set({ config: c });
    return c;
  },
  async removeKey(provider) { const c = await api.del(`/ai/keys/${provider}`); set({ config: c }); return c; },

  openPanel(view = get().view) {
    set({ open: true, view });
    if (!get().config) get().loadConfig();
  },
  closePanel() { set({ open: false }); },
  toggle(view = 'chat') {
    const s = get();
    if (s.open && s.view === view) set({ open: false });
    else s.openPanel(view);
  },

  /* ───────────── chat ───────────── */
  clear() { get()._ctrl?.abort(); set({ messages: [], thread: [], busy: false }); persist(get()); },
  stop() { get()._ctrl?.abort(); },
  async send(text) {
    const t = String(text || '').trim();
    if (!t || get().busy) return;
    set((s) => ({ messages: [...s.messages, { role: 'user', text: t }], thread: [...s.thread, { id: uid(), type: 'user', text: t }] }));
    await get()._stream({ messages: get().messages });
  },
  async decide(itemId, approve) {
    const item = get().thread.find((x) => x.id === itemId);
    if (!item || item.resolved || get().busy) return;
    const decisions = Object.fromEntries(item.calls.map((c) => [c.id, !!approve]));
    set((s) => ({ thread: s.thread.map((x) => (x.id === itemId ? { ...x, resolved: approve ? 'approved' : 'declined' } : x)) }));
    await get()._stream({ messages: get().messages, decisions });
  },

  async _stream(body) {
    const ctrl = new AbortController();
    set({ busy: true, _ctrl: ctrl });
    const upd = (fn) => set((s) => ({ thread: fn(s.thread) }));
    const lastAssistant = (th) => { for (let i = th.length - 1; i >= 0; i--) { if (th[i].type === 'assistant') return i; if (th[i].type === 'user') return -1; } return -1; };
    let cur = null; // id of the assistant item being streamed
    const ensure = () => {
      if (cur) return cur;
      cur = uid();
      const item = { id: cur, type: 'assistant', text: '', thoughts: '', streaming: true, startedAt: Date.now() };
      upd((th) => [...th, item]);
      return cur;
    };
    const patchCur = (fn) => { const id = ensure(); upd((th) => th.map((x) => (x.id === id ? { ...x, ...fn(x) } : x))); };
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.get()}` },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        let j = {}; try { j = await res.json(); } catch { /* */ }
        upd((th) => [...th, { id: uid(), type: 'error', message: j.error || `Request failed (${res.status})`, code: j.code || '' }]);
        return;
      }
      await readSSE(res, (event, d) => {
        switch (event) {
          case 'step': cur = null; ensure(); break;
          case 'thought': patchCur((x) => ({ thoughts: x.thoughts + d.text })); break;
          case 'text': patchCur((x) => ({ text: x.text + d.delta, firstTextAt: x.firstTextAt || Date.now() })); break;
          case 'message': {
            set((s) => ({ messages: [...s.messages, d] }));
            const id = ensure();
            upd((th) => th.map((x) => (x.id === id ? { ...x, text: d.text || x.text, streaming: false, endedAt: Date.now() } : x)).filter((x) => !(x.id === id && !x.text && !x.thoughts)));
            cur = null;
            break;
          }
          case 'call': upd((th) => (th.some((x) => x.type === 'call' && x.id === d.id) ? th.map((x) => (x.type === 'call' && x.id === d.id ? { ...x, status: 'running', startedAt: Date.now() } : x)) : [...th, { id: d.id, type: 'call', name: d.name, args: d.args, status: 'running', startedAt: Date.now() }])); break;
          case 'result': {
            const status = d.declined ? 'declined' : d.ok ? 'done' : 'error';
            upd((th) => (th.some((x) => x.type === 'call' && x.id === d.id) ? th.map((x) => (x.type === 'call' && x.id === d.id ? { ...x, status, summary: d.summary, error: d.error } : x)) : [...th, { id: d.id, type: 'call', name: d.name, args: {}, status, summary: d.summary, error: d.error }]));
            if (d.client) applyClient(d.client);
            break;
          }
          case 'tool':
            set((s) => {
              const msgs = [...s.messages];
              if (d.replace && msgs[msgs.length - 1]?.role === 'tool') msgs.pop();
              return { messages: [...msgs, { role: 'tool', results: d.results }] };
            });
            break;
          case 'confirm': upd((th) => [...th, { id: uid(), type: 'confirm', calls: d.calls }]); break;
          case 'error': upd((th) => [...th, { id: uid(), type: 'error', message: d.message, code: d.code }]); break;
          default: break;
        }
      });
    } catch (e) {
      if (e.name !== 'AbortError') upd((th) => [...th, { id: uid(), type: 'error', message: 'Lost connection to the assistant. Try again.' }]);
    } finally {
      // close any half-streamed item; mark interrupted calls
      upd((th) => th.filter((x) => !(x.type === 'assistant' && x.streaming && !x.text && !x.thoughts)).map((x) => (x.type === 'assistant' && x.streaming ? { ...x, streaming: false, endedAt: Date.now() } : x.type === 'call' && x.status === 'running' ? { ...x, status: 'error', error: 'Stopped' } : x)));
      // a user turn without a completed reply would confuse the next request — keep history valid
      set((s) => ({ busy: false, _ctrl: null, messages: validHistory(s.messages) }));
      persist(get());
    }
  },
}));

function validHistory(msgs) {
  const out = [...msgs];
  // drop a trailing assistant message whose tool calls never got results (stopped mid-way)
  const last = out[out.length - 1];
  if (last?.role === 'assistant' && last.calls?.length) out.pop();
  return out.slice(-40);
}
function persist(s) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ messages: s.messages.slice(-40), thread: s.thread.slice(-120) })); } catch { /* quota */ }
}

async function readSSE(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const flush = (chunk) => {
    let event = 'message'; const data = [];
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    let d; try { d = JSON.parse(data.join('\n')); } catch { return; }
    onEvent(event, d);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) { flush(buf.slice(0, i)); buf = buf.slice(i).replace(/^\r?\n\r?\n/, ''); }
  }
  if (buf.trim()) flush(buf);
}

/* ───────────── follow along: the screen shows what the assistant does ───────────── */
export function applyClient(client) {
  if (!client) return;
  const follow = useAI.getState().config?.settings?.follow_along !== false;
  if (client.navigate) { location.hash = client.navigate; return; }
  if (client.focus && follow) {
    const { board_id, task_id } = client.focus;
    if (board_id && !location.hash.startsWith(`#/board/${board_id}`)) location.hash = `#/board/${board_id}`;
    highlight(task_id);
  }
}
export function highlight(taskId, tries = 0) {
  const el = document.querySelector(`[data-card="${taskId}"]`);
  if (!el) { if (tries < 12) setTimeout(() => highlight(taskId, tries + 1), 120); return; }
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  el.classList.remove('ai-focus'); void el.offsetWidth; el.classList.add('ai-focus');
  setTimeout(() => el.classList.remove('ai-focus'), 2600);
}

/* ───────────── dictation for the chat box (Web Speech API, when available) ───────────── */
export const canDictate = () => typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
export function dictate() {
  return new Promise((resolve, reject) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { reject(new Error('Dictation not supported')); return; }
    const r = new SR(); r.lang = navigator.language || 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
    let text = '';
    r.onresult = (e) => { text = Array.from(e.results).map((x) => x[0].transcript).join(' '); };
    r.onerror = (e) => reject(e.error); r.onend = () => resolve(text);
    r.start();
  });
}
