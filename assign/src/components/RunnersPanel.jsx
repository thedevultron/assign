import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Icon from './Icon.jsx';
import { Avatar, Button, CopyButton, Drawer, EmptyState, IconBtn, HoldConfirm, Modal, Tip, useNow, EASE } from './ui.jsx';
import { useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import { relTime, taskKey } from '../lib/helpers.js';
import { providerLabel } from '../lib/helpers.js';

const stripAnsi = (s) => String(s || '').replace(/\[[0-9;]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0b-\x1f]/g, '');

const STATUS_META = {
  queued: { label: 'Queued', tone: '' }, waiting: { label: 'Waiting', tone: '' }, assigned: { label: 'Starting', tone: 'iris' },
  running: { label: 'Running', tone: 'ok' }, stopping: { label: 'Stopping', tone: '' },
  done: { label: 'Done', tone: 'ok' }, failed: { label: 'Failed', tone: 'warn' }, stopped: { label: 'Stopped', tone: '' },
};

function RunnerCard({ r, i }) {
  const { deleteRunner, toast } = useStore.getState();
  const [edit, setEdit] = useState(false);
  return (
    <motion.article className="panel tight col runner-card" style={{ gap: 12 }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: i * 0.06 }}>
      <div className="row" style={{ gap: 12 }}>
        <div className={`runner-dot ${r.online ? 'on' : ''}`} aria-hidden />
        <div className="col grow" style={{ minWidth: 0, gap: 2 }}>
          <span className="serif runner-name" style={{ fontSize: 22 }}>{r.name}</span>
          <span className="small muted trunc">{r.label || 'Not connected yet'}</span>
        </div>
        <span className={`chip ${r.online ? 'ok' : ''}`}>{r.online ? 'Online' : r.last_seen_at ? 'Offline' : 'New'}</span>
      </div>
      <div className="row wrap small muted" style={{ gap: 6 }}>
        <span className="chip mono" style={{ fontSize: 10.5 }}><Icon name="clock" size={11} />{r.last_seen_at ? `seen ${relTime(r.last_seen_at)}` : 'waiting for first connect'}</span>
        {r.cwd ? <span className="chip mono trunc" style={{ fontSize: 10.5, maxWidth: 320 }}><Icon name="folder" size={11} />{r.cwd}</span> : null}
        <span className="chip mono" style={{ fontSize: 10.5 }}>{r.max_concurrent}× parallel</span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <Button size="sm" variant="ghost" arrow={false} onClick={() => setEdit(true)}><Icon name="settings" size={14} />Settings</Button>
        <span className="spacer" />
        <HoldConfirm size="sm" onConfirm={async () => { await deleteRunner(r.id); toast(`Runner ${r.name} removed`); }}>Hold to remove</HoldConfirm>
      </div>
      <RunnerEditModal open={edit} r={r} onClose={() => setEdit(false)} />
    </motion.article>
  );
}

function Field({ label, hint, children }) {
  return <label className="field"><span className="label">{label}</span>{children}{hint ? <span className="tiny muted">{hint}</span> : null}</label>;
}

function RunnerEditModal({ open, r, onClose }) {
  const patchRunner = useStore((s) => s.patchRunner);
  const [form, setForm] = useState({ name: r.name, cwd: r.cwd || '', allow: r.allow, max_concurrent: r.max_concurrent || 2 });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setForm({ name: r.name, cwd: r.cwd || '', allow: r.allow, max_concurrent: r.max_concurrent || 2 }); }, [open, r]);
  return (
    <Modal open={open} onClose={onClose} label={`${r.name} settings`}>
      <div className="col" style={{ gap: 16 }}>
        <h3 className="h3">Runner <em>settings.</em></h3>
        <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Working directory" hint="Where tasks get spawned. Leave blank to use the runner's own cwd."><input className="input mono" value={form.cwd} onChange={(e) => setForm({ ...form, cwd: e.target.value })} placeholder="~/code/myrepo" /></Field>
        <Field label="Allowed commands (comma separated)" hint="The runner refuses anything not on this list. Shell interpolation impossible — spawn without shell.">
          <input className="input mono" value={form.allow} onChange={(e) => setForm({ ...form, allow: e.target.value })} />
        </Field>
        <Field label="Parallel sessions">
          <input className="input" type="number" min={1} max={5} value={form.max_concurrent} onChange={(e) => setForm({ ...form, max_concurrent: +e.target.value })} style={{ maxWidth: 110 }} />
        </Field>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" arrow={false} onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => { setBusy(true); try { await patchRunner(r.id, form); useStore.getState().toast('Runner updated'); onClose(); } catch (e) { useStore.getState().fail(e); } finally { setBusy(false); } }}>Save</Button>
        </div>
        <RunnerRunbook r={r} />
      </div>
    </Modal>
  );
}

/* The exact steps to get the runner script onto the machine. Also used right after creation. */
export function RunnerRunbook({ r, token }) {
  const origin = location.origin;
  const script = `${origin}/api/runners-script`;
  const cmd = token ? `curl -sS ${script} -o assign-runner.mjs\nnode assign-runner.mjs --token ${token}` : `curl -sS ${script} -o assign-runner.mjs\nnode assign-runner.mjs --token <token>  # token shown once, when adding a runner`;
  return (
    <div className="runner-how col" style={{ gap: 10 }}>
      <span className="label">Run it on your machine</span>
      <div className="runner-cmd mono">{cmd.split('\n').map((l, i) => <div key={i} className="cmd-line"><span className="cmd-prompt">$</span><span>{l}</span></div>)}</div>
      <div className="row wrap" style={{ gap: 6 }}>
        <CopyButton text={cmd} label="Copy commands" />
        <Button size="sm" variant="ghost" arrow={false} onClick={() => api.download('/runners-script', 'assign-runner.mjs').then(() => useStore.getState().toast('Saved assign-runner.mjs')).catch((e) => useStore.getState().fail(e))}><Icon name="download" size={14} />Download script</Button>
      </div>
      <span className="tiny muted">Needs Node.js 18+. Keep the terminal open (or use tmux). Output streams live into this panel.</span>
    </div>
  );
}

function SessionDrawer({ session, spaRunner, onClose }) {
  const { runnerOutput, fetchRunnerOutput, stopRunnerSession, tasks, agents } = useStore.getState();
  const out = runnerOutput[session.id] || '';
  const preRef = useRef(null);
  const [follow, setFollow] = useState(true);
  const active = ['queued', 'waiting', 'assigned', 'running', 'stopping'].includes(session.status);
  const task = tasks.find((t) => t.id === session.task_id);
  const agent = agents.find((a) => a.id === session.agent_id);
  useEffect(() => { fetchRunnerOutput(session.id).catch(() => {}); const t = setInterval(() => active && fetchRunnerOutput(session.id).catch(() => {}), 8000); return () => clearInterval(t); }, [session.id, active]);
  useEffect(() => { if (follow && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight; }, [out, follow]);
  const text = stripAnsi(out);
  return (
    <Drawer open onClose={onClose} label={`Session ${session.cmd}`}>
      <div className="col" style={{ gap: 12, height: '100%' }}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          {agent ? <Avatar agent={agent} size={40} /> : <Avatar agent={{ name: 'Runner', color: 'var(--iris)' }} size={40} />}
          <div className="col grow" style={{ minWidth: 0, gap: 4 }}>
            <span className="serif" style={{ fontSize: 22, lineHeight: 1.1 }}>{task ? `${taskKey(useStore.getState().settings, task)} · ${task.title}` : 'Local session'}</span>
            <span className="small muted mono trunc">{session.cmd} {session.cwd ? `· ${session.cwd}` : ''} · {spaRunner?.name}</span>
          </div>
          <span className={`chip ${STATUS_META[session.status]?.tone || ''}`}>{STATUS_META[session.status]?.label || session.status}</span>
        </div>
        <pre ref={preRef} className="runner-term" onScroll={(e) => { const el = e.target; setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40); }}>{text || '— waiting for output —'}</pre>
        <div className="row" style={{ gap: 8 }}>
          <CopyButton text={text} label="Copy output" />
          <span className="muted small">{session.exit_code != null ? `exit ${session.exit_code}` : active ? 'live' : ''}</span>
          <span className="spacer" />
          {!follow ? <Button size="sm" variant="ghost" arrow={false} onClick={() => { setFollow(true); if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight; }}><Icon name="down" size={14} />Follow</Button> : null}
          {active ? <Button size="sm" variant="danger" arrow={false} onClick={() => stopRunnerSession(session.id).catch((e) => useStore.getState().fail(e))}><Icon name="stop" size={14} />Stop</Button> : null}
        </div>
      </div>
    </Drawer>
  );
}

function SessionRow({ s, onOpen }) {
  const tasks = useStore((st) => st.tasks);
  const agent = useStore((st) => st.agents.find((a) => a.id === s.agent_id));
  const t = tasks.find((x) => x.id === s.task_id);
  const meta = STATUS_META[s.status] || { label: s.status };
  const dur = s.started_at ? Date.parse((s.ended_at) || new Date().toISOString()) - Date.parse(s.started_at) : null;
  const active = ['queued', 'waiting', 'assigned', 'running', 'stopping'].includes(s.status);
  return (
    <motion.button className="runner-session" onClick={() => onOpen(s)} initial={false} layout title={`${s.cmd} — ${t?.title || 'local session'}`}>
      <span className={`sess-dot ${active ? 'live' : meta.tone === 'ok' ? 'ok' : meta.tone === 'bad' ? 'bad' : ''}`} />
      <span className="mono small trunc grow" style={{ textAlign: 'left' }}>{agent ? `@${agent.handle} ` : ''}{t ? taskKey(useStore.getState().settings, t) : s.cmd}</span>
      {active ? <span className="tiny muted mono">{s.status === 'running' ? (dur != null ? `${Math.max(1, Math.round(dur / 1000))}s` : 'live') : meta.label}</span> : <span className="tiny muted">{meta.label}{s.exit_code != null && s.status !== 'done' ? ` · ${s.exit_code}` : ''}</span>}
    </motion.button>
  );
}

export default function RunnersPanel() {
  const runners = useStore((s) => s.runners);
  const sessions = useStore((s) => s.runnerSessions);
  const { addRunner, fail } = useStore.getState();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openSession, setOpenSession] = useState(null);
  const recent = useMemo(() => sessions.slice(0, 12), [sessions]);
  const openRunner = openSession ? runners.find((r) => r.id === openSession.runner_id) : null;
  return (
    <section id="runners" className="col" style={{ gap: 14, marginTop: 30 }}>
      <div className="section-head">
        <span className="tm-sm">brew</span>
        <span className="h3">Local runners</span>
        <span className="label">{runners.filter((r) => r.online).length} online</span>
        <span className="spacer" />
        <Button variant="quiet" size="sm" arrow={false} onClick={() => setAddOpen(true)}><Icon name="plus" size={14} />Add runner</Button>
      </div>
      <p className="small muted" style={{ marginTop: -6, maxWidth: 700 }}>A tiny script on your computer that spawns agent CLIs on tasks you click “Run” on — its output streams back here live. Outbound connection only; nothing listens on your machine.</p>

      {recent.length ? (
        <div className="panel tight col" style={{ gap: 4, padding: 10 }}>
          <div className="row" style={{ padding: '0 6px 6px' }}><span className="label">Live sessions</span><span className="spacer" /><span className="tiny muted">{sessions.filter((s) => ['queued', 'waiting', 'assigned', 'running'].includes(s.status)).length} active</span></div>
          <div className="runner-sessions">
            <AnimatePresence initial={false}>
              {recent.map((s) => <SessionRow key={s.id} s={s} onOpen={setOpenSession} />)}
            </AnimatePresence>
          </div>
        </div>
      ) : null}

      {runners.length ? (
        <div className="runner-grid">{runners.map((r, i) => <RunnerCard key={r.id} r={r} i={i} />)}</div>
      ) : (
        <div className="panel"><EmptyState icon="terminal" title={<>Run tasks on <em>your machine.</em></>} body="Download one script, run it with a token, and this page can start claude/codex/gemini locally on any task — with a live console here. No ports to open; the runner dials out." action={<Button onClick={() => setAddOpen(true)}>Add a runner</Button>} /></div>
      )}

      <Modal open={addOpen} onClose={() => { setAddOpen(false); setCreated(null); setName(''); }} label="Add runner">
        <div className="col" style={{ gap: 16 }}>
          {!created ? (
            <>
              <h3 className="h3">Add a <em>runner.</em></h3>
              <Field label="Name" hint="The machine name, e.g. “Amir's MacBook”, “office build box”.">
                <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My computer" onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { document.getElementById('runner-create')?.click(); } }} />
              </Field>
              <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                <Button variant="ghost" arrow={false} onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button id="runner-create" loading={busy} onClick={async () => { if (!name.trim()) return; setBusy(true); try { const r = await addRunner(name.trim()); setCreated(r); } catch (e) { fail(e); } finally { setBusy(false); } }}>Create</Button>
              </div>
            </>
          ) : (
            <>
              <h3 className="h3"><Icon name="done" size={18} style={{ color: 'var(--iris)' }} /> {created.name} is <em>ready.</em></h3>
              <span className="small muted">Token shown once — copy these commands into a terminal on that machine:</span>
              <RunnerRunbook r={created} token={created.token} />
              <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}><Button onClick={() => { setAddOpen(false); setCreated(null); setName(''); }}>Done</Button></div>
            </>
          )}
        </div>
      </Modal>

      {openSession ? <SessionDrawer session={openSession} spaRunner={openRunner} onClose={() => setOpenSession(null)} /> : null}
    </section>
  );
}
