import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Icon from './Icon.jsx';
import CodeSlots from '@/components/reactbits/CodeSlots';
import PixelTransition from '@/components/reactbits/PixelTransition';
import { Modal, HoldConfirm, TagsInput, Avatar, Button, Toggle, CopyButton, CodeBlock, Field, Spinner, Tip, useNow, EASE_OUT, quick } from './ui.jsx';
import { useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import { AGENT_COLORS, COLOR_NAMES, PROVIDERS, ROLE_PRESETS, providerLabel, resizeImage, relTime, cx, toHandle, isOnline, detectProvider } from '../lib/helpers.js';
import { downloadSkill } from '../pages/Agents.jsx';

const PERSONAS = [
  { label: 'Meticulous', text: 'Meticulous and detail-oriented. Double-checks edge cases and leaves code cleaner than it found it.' },
  { label: 'Pragmatic', text: 'Fast and pragmatic. Ships the simplest thing that works, then iterates. Avoids gold-plating.' },
  { label: 'Sceptical', text: 'Sceptical in the best way. Assumes everything is broken until proven otherwise and backs claims with tests.' },
  { label: 'Teacher', text: 'Warm and explanatory. Writes clear commit messages and leaves helpful notes for humans.' },
];
const promptTemplate = (name, role) => `You are ${name || 'an AI coding agent'}, ${role ? `a ${role.toLowerCase()}` : 'a senior software engineer'}.

Rules:
- Read the task brief and acceptance criteria fully before writing code.
- Work on the branch assign gives you; keep commits small and descriptive.
- Run the test suite before calling complete_task.
- If blocked, post a comment explaining why and release the task.
- Summarise what changed and how to verify it when you finish.`;

const blank = (initial = {}) => ({ name: '', handle: '', color: AGENT_COLORS[Math.floor(Math.random() * AGENT_COLORS.length)], avatar: '', role: '', personality: '', system_prompt: '', provider: 'claude-code', provider_label: '', skills: [], webhook_url: '', max_concurrent: 3, paused: false, ...initial });

function FilesEditor({ agentId }) {
  const { toast } = useStore.getState();
  const [files, setFiles] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; api.get(`/agents/${agentId}/files`).then((r) => { if (live) setFiles(r || []); }).catch(() => { if (live) setFiles([]); }); return () => { live = false; }; }, [agentId]);
  const refresh = async () => setFiles(await api.get(`/agents/${agentId}/files`).catch(() => []));
  const save = async () => {
    if (!draft.name.trim()) { toast('Files need a name', { tone: 'warn' }); return; }
    setBusy(true);
    try {
      await api.put(`/agents/${agentId}/files/${encodeURIComponent(draft.name.trim())}`, { content: draft.content || '' });
      const saved = draft.name.trim(); setDraft(null); await refresh(); toast(`Saved ${saved}`);
    } catch (e) { toast(e.message, { tone: 'error' }); }
    setBusy(false);
  };
  const remove = async (name) => {
    try { await api.del(`/agents/${agentId}/files/${encodeURIComponent(name)}`); setDraft(null); await refresh(); toast(`Deleted ${name}`, { tone: 'warn' }); }
    catch (e) { toast(e.message, { tone: 'error' }); }
  };
  return (
    <div className="afiles">
      {files === null ? <Spinner /> : (<>
        {files.length === 0 && !draft ? <p className="small muted" style={{ margin: 0 }}>Nothing attached yet. Attach notes the agent should read before big jobs.</p> : null}
        {files.map((f) => (draft && !draft.isNew && draft.name === f.name) ? null : (
          <div key={f.name} className="afile-row">
            <Icon name="file" size={14} style={{ color: 'var(--t-muted)', flex: 'none' }} />
            <span className="afile-name">{f.name}</span>
            <span className="tiny muted">{f.content.length > 999 ? `${(f.content.length / 1000).toFixed(1)}k chars` : `${f.content.length} chars`}</span>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDraft({ ...f, isNew: false })}><Icon name="edit" size={12} />Edit</button>
          </div>
        ))}
        {draft ? (
          <div className="afile-edit">
            <div className="row" style={{ gap: 8 }}>
              <input className="input mono" placeholder="style-guide.md" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} disabled={!draft.isNew} maxLength={80} aria-label="File name" />
              <span className="spacer" />
              {draft.isNew ? null : <HoldConfirm size="sm" onConfirm={() => remove(draft.name)} resetAfter={1200}>Hold</HoldConfirm>}
              <Button variant="quiet" size="sm" onClick={() => setDraft(null)} disabled={busy}>Cancel</Button>
              <Button size="sm" arrow={false} loading={busy} onClick={save}>Save file</Button>
            </div>
            <textarea className="textarea mono" rows={7} placeholder={'# Conventions\n\n- small components…'} value={draft.content} onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))} aria-label="File contents" />
          </div>
        ) : (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDraft({ name: '', content: '', isNew: true })}><Icon name="plus" size={13} />Attach a file</button>
        )}
      </>)}
    </div>
  );
}

export function AgentEditor() {
  const state = useStore((s) => s.ui.agentEditor);
  const agents = useStore((s) => s.agents);
  const { setUI, saveAgent, deleteAgent, toast } = useStore.getState();
  const open = !!state;
  const editing = state?.agent ? agents.find((a) => a.id === state.agent.id) || state.agent : null;
  const [f, setF] = useState(blank);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [handleTouched, setHandleTouched] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    setF(editing ? { ...blank(), ...editing } : blank(state?.initial));
    setErr(''); setConfirm(false); setBusy(false); setHandleTouched(!!editing);
  }, [open]); // eslint-disable-line
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const close = () => setUI({ agentEditor: null });

  const handle = handleTouched ? f.handle : toHandle(f.name);
  const clash = agents.find((a) => a.id !== editing?.id && a.handle === handle);
  const sameTool = agents.filter((a) => a.id !== editing?.id && a.provider === f.provider);

  const onFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    try { set('avatar')(await resizeImage(file)); } catch { toast('Could not read that image', { tone: 'error' }); }
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) { setErr('Your agent needs a name'); return; }
    if (editing && clash) { setErr(`@${handle} is already used by ${clash.name}`); return; }
    const payload = { name: f.name.trim(), handle: (handle || '').replace(/[^a-z0-9_-]/g, ''), color: f.color, avatar: f.avatar || '', role: f.role, personality: f.personality, system_prompt: f.system_prompt, provider: f.provider, skills: f.skills, webhook_url: f.webhook_url, max_concurrent: f.max_concurrent, paused: !!f.paused };
    if (editing) payload.id = editing.id;
    setBusy(true);
    try {
      const a = await saveAgent(payload);
      close();
      if (!editing) { toast(`${a.name} joined the team · @${a.handle}`, { tone: 'dispatch', color: a.color, action: 'Connect', onAction: () => setUI({ connectAgentId: a.id }) }); setTimeout(() => setUI({ connectAgentId: a.id }), 250); }
      else toast(`Saved ${a.name}`);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  const preview = { ...f, name: f.name || 'Agent', id: 'preview' };
  return (
    <Modal open={open} onClose={close} wide label={editing ? 'Edit agent' : 'New agent'}>
      <form onSubmit={submit}>
        <div className="modal-head">
          <span className="label">{editing ? `Edit agent · @${editing.handle}` : 'New coding agent'}</span>
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={close} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="modal-body">
          <div className="row" style={{ gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <motion.button type="button" key={f.color + (f.avatar ? 'p' : '')} initial={{ scale: 0.92, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3, ease: EASE_OUT }}
              onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}
              style={{ borderRadius: 9999, position: 'relative' }} aria-label="Upload photo" className="avatar-edit">
              <Avatar agent={preview} size={84} title="" />
              <span className="avatar-edit-hint"><Icon name="image" size={16} /></span>
            </motion.button>
            <div className="col grow" style={{ gap: 14, minWidth: 260 }}>
              <input className="input title bare" placeholder="Name your agent" value={f.name} onChange={(e) => { set('name')(e); setErr(''); }} maxLength={40} autoFocus />
              <div className="row wrap" style={{ gap: 10 }}>
                <div className="swatches">
                  {AGENT_COLORS.map((c) => (
                    <Tip key={c} label={COLOR_NAMES[c]}><button type="button" className={cx('swatch', f.color === c && !f.avatar && 'on')} style={{ background: c }} onClick={() => setF((s) => ({ ...s, color: c, avatar: '' }))} aria-label={COLOR_NAMES[c]} /></Tip>
                  ))}
                </div>
                <span className="vsep" />
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => fileRef.current?.click()}><Icon name="image" size={14} />{f.avatar ? 'Replace photo' : 'Photo'}</button>
                {f.avatar ? <button type="button" className="btn btn-quiet btn-sm" onClick={() => set('avatar')('')}>Remove</button> : null}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files[0])} />
              </div>
            </div>
          </div>

          <Field as="div" label="Runs in">
            <div className="provider-pick">
              {PROVIDERS.map((p) => (
                <button type="button" key={p.id} className={f.provider === p.id ? 'on' : ''} onClick={() => set('provider')(p.id)}>
                  <span className="pm">{p.short}</span>{p.label}
                </button>
              ))}
            </div>
          </Field>
          {f.provider === 'other' ? (
            <Field label="Custom client name" hint="e.g. Zed, Neovim, Aider — shows on cards and inside the skill.">
              <input className="input" value={f.provider_label || ''} onChange={set('provider_label')} placeholder="Name your MCP client" maxLength={60} />
            </Field>
          ) : null}
          <AnimatePresence initial={false}>
            {sameTool.length > 0 && (
              <motion.div className="infobox" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={quick}>
                <Icon name="layers" size={16} style={{ flex: 'none', marginTop: 2 }} />
                <span>{sameTool.map((a) => a.name).join(', ')} also run{sameTool.length === 1 ? 's' : ''} in {providerLabel(f.provider, f)}. That’s fine — this agent gets its own MCP server key <span className="mono" style={{ color: '#fff' }}>assign-{handle || 'handle'}</span> and token, so they never collide.</span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="form-grid">
            <Field label="Handle" hint={clash ? <span className="err">@{handle} is taken by {clash.name}{editing ? '' : ' — a number will be added'}</span> : `Branches: ${handle || 'handle'}/asg-12-…`}>
              <div className="input-affix"><span className="mono muted">@</span><input className="input bare" value={handle} onChange={(e) => { setHandleTouched(true); set('handle')(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '')); }} maxLength={24} placeholder="nova" /></div>
            </Field>
            <Field label="Role">
              <input className="input" list="agent-roles" placeholder="e.g. Frontend engineer" value={f.role} onChange={set('role')} maxLength={200} />
              <datalist id="agent-roles">{ROLE_PRESETS.map((r) => <option key={r} value={r} />)}</datalist>
            </Field>
            <Field as="div" className="full" label="Skills" hint="Used by auto-routing to pick the best agent for a task."><TagsInput value={f.skills} onChange={set('skills')} placeholder="react, postgres, playwright…" /></Field>
            <Field as="div" className="full" label="Personality">
              <textarea className="textarea" rows={2} style={{ minHeight: 72 }} placeholder="How should this agent think, communicate and make trade-offs?" value={f.personality} onChange={set('personality')} maxLength={1000} />
              <span className="row wrap" style={{ gap: 6 }}>{PERSONAS.map((p) => <button type="button" key={p.label} className={cx('chip', f.personality === p.text && 'solid')} onClick={() => set('personality')(p.text)}>{p.label}</button>)}</span>
            </Field>
            <Field as="div" className="full" label="System prompt" right={<button type="button" className="link tiny" onClick={() => set('system_prompt')(promptTemplate(f.name, f.role))}>Use template</button>}>
              <textarea className="textarea mono" rows={6} style={{ fontSize: 12.5 }} placeholder="Sent to the agent on every MCP connection, together with its persona." value={f.system_prompt} onChange={set('system_prompt')} />
            </Field>
            <Field as="div" className="full" label="Reference files" hint={editing ? 'Style guides, architecture notes — the agent fetches these with its get_files tool and gets them inside its skill zip.' : 'Save the agent first, then attach files.'}>
              {editing ? <FilesEditor agentId={editing.id} /> : null}
            </Field>
            <Field as="div" label="Max concurrent tasks">
              <div className="stepper">
                <button type="button" className="icon-btn sm" onClick={() => set('max_concurrent')(Math.max(1, f.max_concurrent - 1))} aria-label="Fewer">−</button>
                <AnimatePresence mode="popLayout" initial={false}><motion.span key={f.max_concurrent} className="serif" style={{ fontSize: 26, minWidth: 28, textAlign: 'center', color: '#fff' }} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }} transition={{ duration: 0.18 }}>{f.max_concurrent}</motion.span></AnimatePresence>
                <button type="button" className="icon-btn sm" onClick={() => set('max_concurrent')(Math.min(20, f.max_concurrent + 1))} aria-label="More"><Icon name="plus" size={14} /></button>
              </div>
            </Field>
            <Field label="Webhook" hint="Optional — POSTed when work is sent to this agent."><input className="input" placeholder="https://runner.example.com/hooks/assign" value={f.webhook_url} onChange={set('webhook_url')} /></Field>
            <div className="full set-row split">
              <div className="col" style={{ gap: 2 }}><span>Paused</span><span className="small muted">Paused agents are skipped by auto-routing and can’t claim work.</span></div>
              <Toggle on={!!f.paused} onChange={set('paused')} label="Paused" />
            </div>
          </div>
          <AnimatePresence>{err ? <motion.div className="err" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>{err}</motion.div> : null}</AnimatePresence>
        </div>
        <div className="modal-foot">
          {editing ? (
            <AnimatePresence mode="wait" initial={false}>
              {confirm ? (
                <motion.span key="c" className="row" style={{ gap: 10 }} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={quick}>
                  <span className="small muted">Remove {editing.name}? Its tasks become unassigned and its token stops working.</span>
                  <HoldConfirm doneLabel="Removed" onConfirm={() => { setTimeout(() => { close(); deleteAgent(editing.id); }, 450); }}>Hold to remove</HoldConfirm>
                  <Button variant="quiet" size="sm" onClick={() => setConfirm(false)}>Keep</Button>
                </motion.span>
              ) : <motion.span key="d" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Button variant="quiet" size="sm" onClick={() => setConfirm(true)}><Icon name="trash" size={14} />Remove agent</Button></motion.span>}
            </AnimatePresence>
          ) : <span className="small muted hide-sm">You’ll get a token and connection steps next.</span>}
          <span className="spacer" />
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" loading={busy}>{editing ? 'Save agent' : 'Create agent'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ═════════════════════ Pairing ═════════════════════ */
/** Step that proves the person at the keyboard owns the agent: the agent shows a 6-digit code, you type it here. */
function PairSection({ agent, requirePairing, now }) {
  const { toast } = useStore.getState();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('idle');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const paired = !!agent.paired;
  const pending = !!agent.pair_pending;
  useEffect(() => { setCode(''); setStatus(paired ? 'success' : 'idle'); setMsg(''); }, [agent.id, paired]);

  const submit = async (c) => {
    if (busy || c.length !== 6) return;
    setBusy(true); setMsg('');
    try {
      const a = await api.post(`/agents/${agent.id}/pair`, { code: c });
      useStore.setState((s) => ({ agents: s.agents.map((x) => (x.id === a.id ? a : x)) }));
      setStatus('success'); toast(`${agent.name} is paired`);
    } catch (e) {
      setStatus('error'); setMsg(e.message);
      setTimeout(() => { setCode(''); setStatus('idle'); }, 900);
    } finally { setBusy(false); }
  };
  const unpair = async () => {
    try {
      const a = await api.post(`/agents/${agent.id}/unpair`);
      useStore.setState((s) => ({ agents: s.agents.map((x) => (x.id === a.id ? a : x)) }));
      toast(`${agent.name} unpaired — it must pair again before it can work`);
    } catch (e) { toast(e.message, { tone: 'error' }); }
  };
  const minsLeft = pending && agent.pair_expires_at ? Math.max(1, Math.round((Date.parse(agent.pair_expires_at) - now) / 60000)) : null;

  if (!requirePairing) {
    return <div className="small muted">Pairing is switched off for this workspace, so any client holding the token can work. Turn it on in <a className="link" href="#/settings/routing" onClick={() => useStore.getState().setUI({ connectAgentId: null })}>Settings</a>.</div>;
  }
  return (
    <div className="pair-box">
      <div className="pair-avatar" aria-hidden="true">
        <PixelTransition key={agent.id} active={paired} once={false} gridSize={9} pattern="ripple" pixelShape="rounded" pixelColor="#847dff" animationStepDuration={0.45} aspectRatio="100%"
          firstContent={<div className="pair-wait"><span className="pair-ring" /><Icon name="lock" size={22} /></div>}
          secondContent={<div className="pair-done"><Avatar agent={agent} size={64} /></div>} />
      </div>
      <div className="col grow" style={{ gap: 10, minWidth: 0 }}>
        {paired ? (
          <>
            <span className="row" style={{ gap: 8 }}><span className="chip ok"><Icon name="done" size={11} />Paired</span><span className="small muted">{agent.pair_client ? `with ${agent.pair_client}` : ''}{agent.paired_at ? ` · ${relTime(agent.paired_at, now)}` : ''}</span></span>
            <span className="small muted">{agent.name} can claim and complete tasks. Unpair to make the next client prove itself again — rotating the token also resets pairing.</span>
            <div><Button variant="ghost" size="sm" arrow={false} onClick={unpair}><Icon name="link" size={14} />Unpair</Button></div>
          </>
        ) : (
          <>
            <span className="small">{pending
              ? <><b style={{ fontWeight: 400, color: '#fff' }}>{agent.pair_client || agent.name}</b> is asking to pair. Type the 6-digit code it shows you{minsLeft ? ` · expires in ${minsLeft} min` : ''}.</>
              : <>Waiting for {agent.name} to connect. After step 03 it will show a <b style={{ fontWeight: 400, color: '#fff' }}>6-digit pairing code</b> — type it here. Until then it can’t touch tasks.</>}
            </span>
            <CodeSlots length={6} value={code} onChange={(v) => { setCode(v.replace(/\D/g, '')); if (status === 'error') setStatus('idle'); }} onComplete={submit} status={status} disabled={busy}
              accentColor="#847dff" inkColor="#ffffff" slotColor="#2e2e2e" digitColor="#f5f5f7" dangerColor="#e5484d" slotSize={44} gap={8} radius={8} ariaLabel={`Pairing code for ${agent.name}`} />
            <AnimatePresence>{msg ? <motion.div className="err small" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>{msg}</motion.div> : null}</AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}

/* ═════════════════════ Connect panel ═════════════════════ */
export function ConnectPanel() {
  const id = useStore((s) => s.ui.connectAgentId);
  const agent = useStore((s) => s.agents.find((a) => a.id === s.ui.connectAgentId));
  const { setUI, rotateToken } = useStore.getState();
  const requirePairing = useStore((s) => s.settings?.require_pairing !== false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('claude-code');
  const [reveal, setReveal] = useState(false);
  const [test, setTest] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [dl, setDl] = useState(false);
  const now = useNow(15000);

  const load = () => {
    if (!id) return;
    setErr('');
    api.get(`/agents/${id}/connect`).then((d) => { setData(d); }).catch((e) => setErr(e.message));
    api.get(`/agents/${id}/inbox`).then(setInbox).catch(() => setInbox([]));
  };
  useEffect(() => {
    if (!id) return;
    setData(null); setReveal(false); setTest(null); setInbox(null);
    setTab(agent?.provider || 'claude-code');
    load();
  }, [id]); // eslint-disable-line
  // live: refresh when the agent connects
  useEffect(() => { if (id && agent?.last_seen_at && data && agent.client_name !== data.client?.name) load(); }, [agent?.last_seen_at]); // eslint-disable-line

  const close = () => setUI({ connectAgentId: null });
  const online = agent && isOnline(agent);

  const runTest = async () => {
    if (!data) return;
    setTest({ state: 'loading' });
    try {
      const call = (body) => fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${data.token}` }, body: JSON.stringify(body) }).then(async (r) => { const j = await r.json(); if (!r.ok && !j.error) throw new Error(`HTTP ${r.status}`); return j; });
      const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'assign-dashboard-test', version: '2' } } });
      if (init.error) throw new Error(init.error.message);
      const tools = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      setTest({ state: 'ok', text: `Handshake OK · MCP ${init.result.protocolVersion} · ${tools.result?.tools?.length || 0} tools` });
    } catch (e) { setTest({ state: 'err', text: e.message }); }
  };

  const conf = data?.configs?.[tab];
  return (
    <Modal open={!!agent} onClose={close} wide label={agent ? `Connect ${agent.name}` : 'Connect'}>
      {agent ? (
        <>
          <div className="modal-head" style={{ paddingBottom: 14 }}>
            <Avatar agent={agent} size={44} status />
            <div className="col" style={{ gap: 4, minWidth: 0 }}>
              <span className="h3" style={{ lineHeight: 1 }}>Connect <em>{agent.name}</em></span>
              <span className="label">{providerLabel(agent.provider, agent)} · MCP server key assign-{agent.handle}</span>
            </div>
            <span className="spacer" />
            <span className={cx('chip', online && agent.paired && 'ok', requirePairing && !agent.paired && 'iris')}>{requirePairing && !agent.paired ? (agent.pair_pending ? 'Pairing requested' : 'Not paired yet') : online ? `Live · ${agent.client_name || 'connected'}` : agent.last_seen_at ? `Seen ${relTime(agent.last_seen_at, now)}` : 'Waiting for first connection'}</span>
            <button type="button" className="icon-btn" onClick={close} aria-label="Close"><Icon name="close" /></button>
          </div>
          <div className="modal-body" style={{ gap: 26 }}>
            {err ? <div className="warnbox"><Icon name="alert" size={16} />{err}<Button size="sm" variant="ghost" onClick={load}>Retry</Button></div> : null}
            {!data && !err ? <div className="row muted" style={{ gap: 10, padding: 30, justifyContent: 'center' }}><Spinner />Preparing connection details…</div> : null}
            {data && (
              <>
                {data.client?.mismatch ? (
                  <div className="warnbox"><Icon name="alert" size={16} style={{ flex: 'none', marginTop: 2 }} /><span>This token was last used from <b style={{ fontWeight: 400, color: '#fff' }}>{data.client.name}</b>, which looks like {providerLabel(data.client.detected)} — not {providerLabel(agent.provider, agent)}. If that’s intended, switch the agent’s tool so the right config and skill are generated.</span></div>
                ) : null}

                <section className="col" style={{ gap: 12 }}>
                  <div className="step-title"><span className="n">01</span><span className="h4">Add the MCP server</span></div>
                  <div className="ctabs" role="tablist">
                    {PROVIDERS.map((p) => (
                      <button key={p.id} role="tab" aria-selected={tab === p.id} className={tab === p.id ? 'on' : ''} onClick={() => setTab(p.id)}>
                        {tab === p.id ? <motion.span layoutId="ctab-hl" className="ctab-hl" transition={{ duration: 0.25, ease: EASE_OUT }} /> : null}
                        <span style={{ position: 'relative' }}>{p.label}{p.id === agent.provider ? ' ·' : ''}</span>
                      </button>
                    ))}
                  </div>
                  <AnimatePresence mode="wait">
                    <motion.div key={tab} className="col" style={{ gap: 10 }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
                      {tab !== agent.provider ? <div className="small muted">This agent is set up for {providerLabel(agent.provider, agent)}. Using {providerLabel(tab)} instead? <button className="link" onClick={() => useStore.getState().saveAgent({ id: agent.id, provider: tab })}>Switch the agent to {providerLabel(tab)}</button></div> : null}
                      {conf?.steps.map((s, i) => <CodeBlock key={i} code={s.code} lang={s.lang} title={s.label} />)}
                    </motion.div>
                  </AnimatePresence>
                </section>

                <section className="col" style={{ gap: 12 }}>
                  <div className="step-title"><span className="n">02</span><span className="h4">Give it the skill</span></div>
                  <div className="skill-row">
                    <div className="col grow" style={{ gap: 4 }}>
                      <span>assign-{agent.handle}-skill.zip</span>
                      <span className="small muted">SKILL.md with {agent.name}’s persona, the tool reference, the ownership rules and a ready-made {providerLabel(agent.provider)} config. Unzip it into your project.</span>
                    </div>
                    <Button loading={dl} arrow="↓" onClick={async () => { setDl(true); await downloadSkill(agent); setDl(false); }}>Download</Button>
                  </div>
                </section>

                <section className="col" style={{ gap: 12 }}>
                  <div className="step-title"><span className="n">03</span><span className="h4">Say hello</span></div>
                  <div className="small muted">Ask your agent: <span className="mono" style={{ color: '#fff', fontSize: 12 }}>“Use assign to get my next task.”</span> It’ll call <span className="mono">whoami</span>, receive its persona, then pull work.</div>
                  <div className="row wrap" style={{ gap: 12 }}>
                    <Button variant="ghost" size="sm" arrow={false} onClick={runTest}><Icon name="plug" size={14} />Test connection</Button>
                    <AnimatePresence mode="wait">
                      {test && (
                        <motion.span key={test.state} className={cx('row small', test.state === 'err' ? 'err' : 'muted')} style={{ gap: 8 }} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                          {test.state === 'loading' ? <Spinner /> : <Icon name={test.state === 'ok' ? 'done' : 'alert'} size={15} />}{test.text}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </section>

                <section className="col" style={{ gap: 12 }}>
                  <div className="step-title"><span className="n">04</span><span className="h4">Pair it</span></div>
                  <PairSection agent={agent} requirePairing={requirePairing} now={now} />
                </section>

                <details className="advanced">
                  <summary><span className="label">Token, isolation & deliveries</span><Icon name="chevron" size={14} /></summary>
                  <div className="col" style={{ gap: 18, paddingTop: 16 }}>
                    <div className="form-grid">
                      <Field as="div" label="MCP endpoint · streamable HTTP">
                        <div className="input-affix"><span className="mono trunc grow" style={{ fontSize: 12 }}>{data.mcp_url}</span><CopyButton text={data.mcp_url} /></div>
                      </Field>
                      <Field as="div" label="Agent token" right={<button type="button" className="link tiny" onClick={async () => { await rotateToken(agent.id); load(); }}>Rotate{requirePairing ? ' · re-pair' : ''}</button>}>
                        <div className="input-affix">
                          <span className="mono trunc grow" style={{ fontSize: 12 }}>{reveal ? data.token : data.token.slice(0, 8) + '•'.repeat(18)}</span>
                          <button type="button" className="icon-btn xs" onClick={() => setReveal((r) => !r)} aria-label={reveal ? 'Hide token' : 'Reveal token'}><Icon name={reveal ? 'eyeOff' : 'eye'} size={14} /></button>
                          <CopyButton text={data.token} label="Copy token" />
                        </div>
                      </Field>
                    </div>
                    <CodeBlock title="Several agents in one repo? Give each a worktree" lang="bash" code={data.worktree} />
                    <div>
                      <div className="label" style={{ marginBottom: 6 }}>Recent deliveries to {agent.name}</div>
                      {inbox === null ? <Spinner /> : inbox.length === 0 ? <div className="small muted">Nothing sent yet.</div> : (
                        <div className="feed">{inbox.slice(0, 6).map((m) => (
                          <div key={m.id} className="feed-item">
                            <span className="sys-ico"><Icon name={m.kind === 'digest' ? 'mail' : m.kind === 'task' ? 'send' : 'bell'} size={14} /></span>
                            <div className="col grow" style={{ gap: 2 }}><span className="msg">{m.title}</span><span className="label">{m.kind}{m.read_at ? ' · read' : ' · unread'}{m.webhook_status ? ` · webhook ${m.webhook_status}` : ''}</span></div>
                            <span className="label">{relTime(m.created_at, now)}</span>
                          </div>
                        ))}</div>
                      )}
                    </div>
                  </div>
                </details>
              </>
            )}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
