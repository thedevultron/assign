import { lazy, Suspense, useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import Icon from '../Icon.jsx';
import { Button, Tip, Spinner, EASE, EASE_OUT, quick } from '../ui.jsx';
import { useStore } from '../../lib/store.js';
import { useAI, TOOL_LABEL, toolIcon, toolArg, canDictate, dictate } from '../../lib/ai.js';
import { voice, voiceLevel } from '../../lib/voice.js';
import { cx } from '../../lib/helpers.js';
import { api } from '../../lib/api.js';
import PromptBar from '../reactbits/PromptBar';
import CallChip from '../reactbits/CallChip';
import ThoughtLine from '../reactbits/ThoughtLine';

const Orb = lazy(() => import('../reactbits/Orb'));
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';

/* ───────────── orb (react-bits Orb, WebGL) with a CSS fallback while it loads ───────────── */
export function AIOrb({ size = 160, level, hue = 0, intensity = 0.25, className }) {
  return (
    <div className={cx('ai-orb', className)} style={{ width: size, height: size }}>
      <Suspense fallback={<span className="ai-orb-fallback" />}>
        <Orb hue={hue} hoverIntensity={intensity} rotateOnHover forceHoverState={false} backgroundColor="#0f1011" getLevel={level} />
      </Suspense>
    </div>
  );
}

/* ───────────── tiny, safe markdown renderer ───────────── */
function inline(text, keyBase = 'i') {
  const out = []; let rest = text; let k = 0;
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^\s)]+|#\/[^\s)]*)\))/;
  while (rest) {
    const m = rest.match(re);
    if (!m) { out.push(rest); break; }
    if (m.index) out.push(rest.slice(0, m.index));
    const t = m[0];
    if (m[1]) out.push(<code key={keyBase + k++} className="md-code">{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<b key={keyBase + k++}>{t.slice(2, -2)}</b>);
    else if (m[3]) out.push(<i key={keyBase + k++}>{t.slice(1, -1)}</i>);
    else { const label = t.slice(1, t.indexOf('](')); const href = m[5]; out.push(<a key={keyBase + k++} className="link" href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer">{label}</a>); }
    rest = rest.slice(m.index + t.length);
  }
  return out;
}
export function Markdown({ text }) {
  const blocks = useMemo(() => {
    const lines = String(text || '').split('\n'); const out = []; let list = null; let code = null;
    const flush = () => { if (list) { out.push(list); list = null; } };
    for (const line of lines) {
      if (/^```/.test(line)) { if (code) { out.push(code); code = null; } else { flush(); code = { type: 'code', lines: [] }; } continue; }
      if (code) { code.lines.push(line); continue; }
      const li = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
      if (li) { const ordered = /\d/.test(li[1]); if (!list || list.ordered !== ordered) { flush(); list = { type: 'list', ordered, items: [] }; } list.items.push(li[2]); continue; }
      flush();
      if (/^#{1,4}\s+/.test(line)) out.push({ type: 'h', text: line.replace(/^#{1,4}\s+/, '') });
      else if (line.trim()) out.push({ type: 'p', text: line });
      else out.push({ type: 'gap' });
    }
    flush(); if (code) out.push(code);
    return out.filter((b, i, a) => !(b.type === 'gap' && (i === 0 || a[i - 1]?.type === 'gap' || i === a.length - 1)));
  }, [text]);
  return (
    <div className="md">
      {blocks.map((b, i) => b.type === 'list' ? (
        b.ordered ? <ol key={i}>{b.items.map((x, j) => <li key={j}>{inline(x, `${i}-${j}-`)}</li>)}</ol> : <ul key={i}>{b.items.map((x, j) => <li key={j}>{inline(x, `${i}-${j}-`)}</li>)}</ul>
      ) : b.type === 'code' ? <pre key={i} className="md-pre">{b.lines.join('\n')}</pre>
        : b.type === 'h' ? <p key={i} className="md-h">{inline(b.text, `${i}-`)}</p>
        : b.type === 'gap' ? <div key={i} className="md-gap" />
        : <p key={i}>{inline(b.text, `${i}-`)}</p>)}
    </div>
  );
}

/* ───────────── tool call chip (react-bits CallChip) ───────────── */
function ToolChip({ call, compact }) {
  const status = call.status === 'done' ? 'done' : call.status === 'error' ? 'error' : call.status === 'declined' ? 'error' : call.status === 'pending' ? 'idle' : 'running';
  const label = TOOL_LABEL[call.name] || call.name;
  const arg = call.status === 'done' && call.summary ? call.summary : call.status === 'declined' ? 'Declined' : call.status === 'error' ? (call.error || 'Failed') : call.status === 'pending' ? 'Waiting for your OK' : toolArg(call.name, call.args);
  return (
    <motion.div className="ai-chip-row" initial={{ opacity: 0, y: 6, filter: 'blur(3px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.35, ease: EASE_OUT }}>
      <CallChip icon={toolIcon(call.name)} name={label} argument={String(arg || '').slice(0, 64)} status={status} expectedMs={1400} size={compact ? 30 : 32} radius={8}
        color="#cacaca" surfaceColor="#1a1b1c" progressColor="#847dff" progressOpacity={0.14} doneColor="#9be3b4" errorColor="#ffb4a8" showTimer={false} />
    </motion.div>
  );
}

/* ───────────── no key yet ───────────── */
export function KeySetup({ provider = 'google', compact, onDone }) {
  const config = useAI((s) => s.config);
  const { saveKey } = useAI.getState();
  const toast = useStore((s) => s.toast);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const P = config?.providers?.find((p) => p.id === provider);
  const submit = async (e) => {
    e?.preventDefault(); if (!key.trim()) return;
    setBusy(true); setErr('');
    try { const c = await saveKey(provider, key.trim()); setKey(''); toast(c.warning || `${P?.label || 'Key'} connected · ${c.settings.chat_model || 'ready'}`, { tone: c.warning ? 'warn' : 'success' }); onDone?.(c); }
    catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };
  return (
    <form className={cx('ai-keycard', compact && 'compact')} onSubmit={submit}>
      <div className="row" style={{ gap: 10 }}>
        <span className="ai-keyico"><Icon name="key" size={16} /></span>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span style={{ color: '#fff', fontSize: 14 }}>Connect {P?.label || 'Google AI Studio'}</span>
          <span className="tiny muted">Your key is encrypted on this server and never sent to the browser. {provider === 'google' ? 'Chat uses Gemini 3.5 Flash-Lite and voice uses Gemini 3.8 Live.' : ''}</span>
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder={P?.placeholder || 'AIza…'} value={key} onChange={(e) => setKey(e.target.value)} aria-label="API key" />
        <Button type="submit" size="sm" loading={busy} disabled={!key.trim()}>Connect</Button>
      </div>
      {err ? <span className="tiny" style={{ color: '#ffb4a8' }}>{err}</span> : null}
      <div className="row tiny muted" style={{ gap: 12, flexWrap: 'wrap' }}>
        <a className="link" href={P?.keyUrl || 'https://aistudio.google.com/apikey'} target="_blank" rel="noreferrer">Get a free key ↗</a>
        <a className="link" href="#/settings/ai" onClick={() => useAI.getState().closePanel()}>Other providers</a>
      </div>
    </form>
  );
}

/* ───────────── chat ───────────── */
const SUGGESTIONS = [
  { icon: 'eye', text: 'What needs my review?' },
  { icon: 'plus', text: 'Create a high-priority task to add rate limiting to the search API' },
  { icon: 'chart', text: 'How did my agents do this week?' },
  { icon: 'clock', text: 'Anything overdue or stuck?' },
];
const SLASH = [
  { key: 'review', name: '/review', description: 'Summarise the review queue' },
  { key: 'standup', name: '/standup', description: 'Daily stand-up of every agent' },
  { key: 'overdue', name: '/overdue', description: 'Overdue and stuck work' },
  { key: 'plan', name: '/plan', description: 'Break a goal into tasks' },
];
const expandSlash = (t) => t
  .replace(/^\/review\b/, 'What is waiting for my review? Summarise each item and what I should check.')
  .replace(/^\/standup\b/, 'Give me a quick stand-up: what each agent did recently, is doing now, and anything blocked.')
  .replace(/^\/overdue\b/, 'List overdue tasks and anything that has gone quiet, and suggest what to do.')
  .replace(/^\/plan\b/, 'Break this goal into well-scoped tasks with acceptance criteria and create them in the backlog:');

function ChatView() {
  const thread = useAI((s) => s.thread);
  const busy = useAI((s) => s.busy);
  const config = useAI((s) => s.config);
  const agents = useStore((s) => s.agents);
  const user = useStore((s) => s.auth.user);
  const { send, stop, decide, saveSettings } = useAI.getState();
  const scroller = useRef(null);
  const [models, setModels] = useState([]);
  const st = config?.settings;
  const provider = config?.providers?.find((p) => p.id === st?.chat_provider);
  const hasKey = !!provider?.set;

  useEffect(() => { const el = scroller.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [thread, busy]);
  useEffect(() => {
    if (!hasKey) return;
    let live = true;
    api.get(`/ai/models?provider=${st.chat_provider}`).then((r) => { if (live) setModels(r.models || []); }).catch(() => {});
    return () => { live = false; };
  }, [hasKey, st?.chat_provider]);

  const modelOpts = useMemo(() => {
    const list = models.filter((m) => !m.live).slice(0, 14).map((m) => ({ key: m.id, name: m.label || m.id }));
    if (st?.chat_model && !list.some((m) => m.key === st.chat_model)) list.unshift({ key: st.chat_model, name: st.chat_model });
    return list.length ? list : [{ key: st?.chat_model || 'model', name: st?.chat_model || 'Model' }];
  }, [models, st?.chat_model]);
  const EFF = ['Minimal', 'Low', 'Medium', 'High'];

  const onSend = (text, detail) => {
    if (detail?.model?.key && detail.model.key !== st?.chat_model && models.some((m) => m.id === detail.model.key)) saveSettings({ chat_model: detail.model.key });
    send(expandSlash(text));
  };

  const startVoice = () => {
    useAI.getState().set({ view: 'voice' });
    useAI.getState().setVoice({ minimized: false });
    if (!voice.active) voice.start();
  };

  if (config && !hasKey) {
    return (
      <div className="ai-scroll ai-empty">
        <AIOrb size={150} />
        <div className="col" style={{ alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <h3 className="h3 serif" style={{ margin: 0 }}>Bring your <em>own</em> model.</h3>
          <p className="small muted" style={{ margin: 0, maxWidth: 320 }}>Add an API key and the assistant can answer questions about your board and make changes for you.</p>
        </div>
        <KeySetup provider="google" />
      </div>
    );
  }

  return (
    <>
      <div className="ai-scroll" ref={scroller}>
        {thread.length === 0 ? (
          <div className="ai-empty">
            <AIOrb size={150} />
            <div className="col" style={{ alignItems: 'center', gap: 8, textAlign: 'center' }}>
              <h3 className="h3 serif" style={{ margin: 0 }}>{user?.name ? <>Hi {user.name.split(' ')[0]}, what’s <em>next?</em></> : <>What’s <em>next?</em></>}</h3>
              <p className="small muted" style={{ margin: 0, maxWidth: 320 }}>Ask about your board or tell me what to change.</p>
            </div>
            <div className="ai-suggest">
              {SUGGESTIONS.map((s, i) => (
                <motion.button key={s.text} className="ai-sug" onClick={() => send(s.text)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE, delay: 0.1 + i * 0.06 }}>
                  <Icon name={s.icon} size={14} /><span>{s.text}</span>
                </motion.button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ai-thread">
            {thread.map((it) => {
              if (it.type === 'user') return <motion.div key={it.id} className="ai-msg user" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }}>{it.text}</motion.div>;
              if (it.type === 'assistant') {
                const thinking = it.streaming && !it.text;
                const secs = Math.max(1, Math.round(((it.firstTextAt || it.endedAt || Date.now()) - it.startedAt) / 1000));
                return (
                  <motion.div key={it.id} className="ai-msg bot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                    {(thinking || it.thoughts) && (
                      <ThoughtLine label="Thinking…" doneLabel={`Thought for ${secs}s`} working={thinking} steps={thoughtSteps(it.thoughts)} collapsible collapseOnSettle
                        color="#9f9fa0" glyphColor="#847dff" fontSize={13} showTimer={thinking} shimmer />
                    )}
                    {it.text ? <Markdown text={it.text} /> : null}
                    {it.streaming && it.text ? <span className="ai-caret" /> : null}
                  </motion.div>
                );
              }
              if (it.type === 'call') return <ToolChip key={it.id} call={it} />;
              if (it.type === 'confirm') return <ConfirmCard key={it.id} item={it} onDecide={(ok) => decide(it.id, ok)} busy={busy} />;
              if (it.type === 'error') return (
                <motion.div key={it.id} className="ai-error" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                  <Icon name="alert" size={14} /><span>{it.message}</span>
                  {it.code === 'no_key' || it.code === 'auth' || it.code === 'model' ? <a className="link" href="#/settings/ai" onClick={() => useAI.getState().closePanel()}>Settings → AI</a> : null}
                </motion.div>
              );
              return null;
            })}
            {busy && !thread.some((x) => x.type === 'assistant' && x.streaming) && thread[thread.length - 1]?.type !== 'call' ? (
              <div className="ai-msg bot"><ThoughtLine label="Working…" working color="#9f9fa0" glyphColor="#847dff" fontSize={13} showTimer={false} /></div>
            ) : null}
          </div>
        )}
      </div>
      <div className="ai-input">
        <div className="ai-input-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <PromptBar
              key={`${st?.chat_provider}:${st?.chat_model}:${modelOpts.length}`}
              placeholder="Ask or tell assign anything…"
              sources={agents.map((a) => ({ key: a.id, name: a.name, description: a.role || a.provider }))}
              commands={SLASH}
              models={modelOpts}
              defaultModel={st?.chat_model}
              efforts={EFF}
              defaultEffort={EFF.find((e) => e.toLowerCase() === st?.chat_effort) || 'Medium'}
              onEffortChange={(e) => saveSettings({ chat_effort: e.toLowerCase() })}
              busy={busy}
              onSend={onSend}
              onStop={stop}
              onDictate={canDictate() ? dictate : undefined}
              background="#1a1b1c" color="#f5f5f7" menuBackground="#2e2e2e" sparkColor="#847dff" width={2000} radius={14} maxRows={6}
            />
          </div>
          <Tip label={voice.active ? `Voice is live — open it (${MOD}I)` : `Talk instead — start voice (${MOD}I)`}>
            <button className={cx('icon-btn ai-mic', voice.active && 'live')} onClick={startVoice} aria-label="Start voice assistant">
              <Icon name="mic" size={17} />
            </button>
          </Tip>
        </div>
        <div className="ai-foot tiny">
          <span className="trunc">{st?.chat_model}</span>
          <span className="kbd">{MOD} J</span>
        </div>
      </div>
    </>
  );
}
function thoughtSteps(t) {
  if (!t) return [];
  return t.split(/\n(?=\*\*)|\n{2,}/).map((x) => x.replace(/\*\*/g, '').trim()).filter(Boolean).slice(-6).map((x) => (x.length > 140 ? x.slice(0, 137) + '…' : x));
}
function ConfirmCard({ item, onDecide, busy }) {
  return (
    <motion.div className={cx('ai-confirm', item.resolved && 'resolved')} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.4, ease: EASE_OUT }}>
      <div className="row" style={{ gap: 8 }}><Icon name="shield" size={15} /><span className="label" style={{ color: '#d1c9ff' }}>Needs your OK</span></div>
      <ul>{item.calls.map((c) => <li key={c.id}>{c.confirm}</li>)}</ul>
      {item.resolved ? (
        <span className="tiny muted">{item.resolved === 'approved' ? 'Approved' : 'Declined'}</span>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" onClick={() => onDecide(true)} disabled={busy}>Approve</Button>
          <Button size="sm" variant="ghost" arrow={false} onClick={() => onDecide(false)} disabled={busy}>Decline</Button>
        </div>
      )}
    </motion.div>
  );
}

/* ───────────── voice (panel view) ───────────── */
const STATUS_TEXT = { idle: 'Ready', connecting: 'Connecting', listening: 'Listening', speaking: 'Speaking', working: 'Working', reconnecting: 'Reconnecting', error: 'Stopped', ended: 'Ended' };
function VoiceView() {
  const v = useAI((s) => s.voice);
  const config = useAI((s) => s.config);
  const scroller = useRef(null);
  const [typed, setTyped] = useState('');
  const running = !['idle', 'ended', 'error'].includes(v.status);
  const hasGoogle = !!config?.providers?.find((p) => p.id === 'google')?.set;
  const callsById = useMemo(() => Object.fromEntries(v.calls.map((c) => [c.id, c])), [v.calls]);
  useEffect(() => { const el = scroller.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [v.lines, v.calls]);
  const vm = config?.voice_models?.find((m) => m.id === config?.settings?.voice_model);

  // one mic button starts everything — no extra chips, no extra entry points
  if (!running) {
    return (
      <div className="ai-scroll ai-empty">
        <AIOrb size={190} intensity={0.3} />
        <div className="col" style={{ alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <h3 className="h3 serif" style={{ margin: 0 }}>Just <em>say it.</em></h3>
          <p className="small muted" style={{ margin: 0, maxWidth: 330 }}>Talk hands-free. It listens, answers out loud, and works on your board.</p>
        </div>
        {v.status === 'error' && v.error ? <div className="ai-error"><Icon name="alert" size={14} /><span>{v.error}</span></div> : null}
        {config && !hasGoogle ? <KeySetup provider="google" /> : (
          <div className="col" style={{ alignItems: 'center', gap: 10 }}>
            <button className={cx('ai-mic-big', v.status === 'error' && 'shake')} onClick={() => voice.start()} disabled={!config} aria-label="Start talking">
              <Icon name="mic" size={22} />
            </button>
            <span className="small" style={{ color: '#fff' }}>Talk</span>
            <span className="tiny muted">{vm?.label || 'Gemini 3.8 Live'}{vm?.thinking ? ` · ${config?.settings?.voice_effort} thinking` : ''} · voice {config?.settings?.voice_name}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="ai-voice-stage">
        <motion.div animate={{ scale: v.status === 'speaking' ? 1.04 : v.status === 'connecting' || v.status === 'reconnecting' ? 0.92 : 1 }} transition={{ duration: 0.6, ease: EASE }}>
          <AIOrb size={168} level={voiceLevel} intensity={0.22} hue={0} />
        </motion.div>
        <div className="col" style={{ alignItems: 'center', gap: 6 }}>
          <span className={cx('ai-status label', v.status)}><i />{STATUS_TEXT[v.status]}{v.muted ? ' · muted' : ''}</span>
          <AnimatePresence mode="wait">
            {v.thought && v.status !== 'speaking' ? (
              <motion.span key="th" className="tiny muted ai-thought" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{lastLine(v.thought)}</motion.span>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
      <div className="ai-scroll ai-transcript" ref={scroller}>
        {v.lines.length === 0 ? <p className="small muted" style={{ textAlign: 'center', margin: '8px 0' }}>Listening… try “What’s waiting for review?”</p> : null}
        {v.lines.map((l) => {
          if (l.role === 'call') { const c = callsById[l.callId]; if (!c) return null; return (
            <Fragment key={l.id}>
              <ToolChip call={c} compact />
              {c.status === 'pending' ? (
                <div className="ai-confirm inline"><span className="small">{c.confirm}</span><div className="row" style={{ gap: 6 }}><Button size="sm" onClick={() => voice.approve(c.id)}>Approve</Button><Button size="sm" variant="ghost" arrow={false} onClick={() => voice.decline(c.id)}>No</Button></div></div>
              ) : null}
            </Fragment>
          ); }
          return <motion.div key={l.id} className={cx('ai-line', l.role)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }}><span className="who label">{l.role === 'user' ? 'You' : 'assign'}</span><span>{l.text}</span></motion.div>;
        })}
      </div>
      <div className="ai-voicebar">
        <form className="ai-type" onSubmit={(e) => { e.preventDefault(); voice.sendText(typed); setTyped(''); }}>
          <input className="input" placeholder="Type instead…" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type to the voice assistant" />
        </form>
        <div className="row" style={{ gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
          <Tip label={v.muted ? 'Unmute' : 'Mute'}>
            <button className={cx('icon-btn ai-round', v.muted && 'danger')} onClick={() => voice.toggleMute()} aria-label={v.muted ? 'Unmute microphone' : 'Mute microphone'}>
              <Icon name={v.muted ? 'micOff' : 'mic'} size={17} />
            </button>
          </Tip>
          <Tip label="Minimise — keep talking"><button className="icon-btn ai-round" onClick={() => { useAI.getState().setVoice({ minimized: true }); useAI.getState().closePanel(); }} aria-label="Minimise voice"><Icon name="shrink" size={17} /></button></Tip>
          <Tip label="End"><button className="icon-btn ai-round danger" onClick={() => voice.stop()} aria-label="End voice session"><Icon name="hangup" size={17} /></button></Tip>
        </div>
      </div>
    </>
  );
}
const lastLine = (t) => { const s = t.replace(/\*\*/g, '').trim().split(/\n+/).pop() || ''; return s.length > 90 ? s.slice(0, 87) + '…' : s; };

/* ───────────── the panel ───────────── */
export function AssistantPanel() {
  const open = useAI((s) => s.open);
  const view = useAI((s) => s.view);
  const busy = useAI((s) => s.busy);
  const config = useAI((s) => s.config);
  const vstatus = useAI((s) => s.voice.status);
  const { closePanel, set, clear, setVoice } = useAI.getState();
  useEffect(() => { if (open && !config) useAI.getState().loadConfig(); }, [open]); // eslint-disable-line
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) closePanel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line
  const voiceOn = !['idle', 'ended', 'error'].includes(vstatus);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="ai-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} onClick={closePanel} />
          <motion.aside className="ai-panel" role="dialog" aria-label="Assistant"
            initial={{ x: '104%', opacity: 0.6 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '104%', opacity: 0.6 }} transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}>
            <header className="ai-head">
              <span className="ai-mark"><Icon name="magic" size={15} /></span>
              <div className="col" style={{ gap: 0, minWidth: 0 }}>
                <span className="serif" style={{ fontSize: 19, color: '#fff', lineHeight: 1.1 }}>Assistant</span>
                <span className="tiny muted trunc">{voiceOn ? 'Live voice' : 'Chat'}</span>
              </div>
              <span className="spacer" />
              {view === 'voice'
                ? <Tip label="Back to chat"><button className="icon-btn sm" onClick={() => set({ view: 'chat' })} aria-label="Back to chat"><Icon name="chat" size={16} /></button></Tip>
                : null}
              {view === 'chat' ? <Tip label="New chat"><button className="icon-btn sm" onClick={clear} disabled={busy} aria-label="New chat"><Icon name="refresh" size={16} /></button></Tip> : null}
              
              <Tip label="Close"><button className="icon-btn sm" onClick={() => { if (view === 'voice' && voiceOn) setVoice({ minimized: true }); closePanel(); }} aria-label="Close assistant"><Icon name="close" size={16} /></button></Tip>
            </header>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={view} className="ai-body" initial={{ opacity: 0, x: view === 'voice' ? 24 : -24, filter: 'blur(6px)' }} animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, x: view === 'voice' ? 24 : -24, filter: 'blur(6px)' }} transition={{ duration: 0.35, ease: EASE_OUT }}>
                {!config ? <div className="ai-scroll ai-empty"><Spinner /></div> : view === 'chat' ? <ChatView /> : <VoiceView />}
              </motion.div>
            </AnimatePresence>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ───────────── minimised voice ball (react-bits Orb) ───────────── */
export function VoiceBall() {
  const v = useAI((s) => s.voice);
  const open = useAI((s) => s.open);
  const running = !['idle', 'ended', 'error'].includes(v.status);
  const show = running && (v.minimized || !open);
  const [caption, setCaption] = useState(null);
  const dragged = useRef(false);
  const constraints = useRef(null);

  // live caption next to the ball: the latest thing said or done
  const last = v.lines[v.lines.length - 1];
  const lastCall = last?.role === 'call' ? v.calls.find((c) => c.id === last.callId) : null;
  const capText = lastCall ? `${TOOL_LABEL[lastCall.name] || lastCall.name}${lastCall.summary ? ` · ${lastCall.summary}` : lastCall.status === 'pending' ? ' · say yes to confirm' : '…'}` : last?.text || '';
  useEffect(() => {
    if (!capText) return undefined;
    setCaption({ text: capText.length > 120 ? '…' + capText.slice(-118) : capText, role: last?.role, id: last?.id });
    const t = setTimeout(() => setCaption(null), last?.role === 'call' ? 3500 : 5000);
    return () => clearTimeout(t);
  }, [capText]); // eslint-disable-line

  const expand = () => { if (dragged.current) return; useAI.getState().setVoice({ minimized: false }); useAI.getState().openPanel('voice'); };
  return (
    <>
      <div ref={constraints} className="ai-ball-bounds" aria-hidden />
      <AnimatePresence>
        {show && (
          <motion.div className={cx('ai-ball-wrap', v.status)} drag dragConstraints={constraints} dragElastic={0.12} dragMomentum={false}
            onDragStart={() => { dragged.current = true; }} onDragEnd={() => setTimeout(() => { dragged.current = false; }, 60)}
            initial={{ opacity: 0, scale: 0.4, y: 30 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.4, y: 30 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
            <AnimatePresence>
              {caption && (
                <motion.div key={caption.id} className={cx('ai-caption', caption.role)} initial={{ opacity: 0, x: 12, filter: 'blur(4px)' }} animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, x: 8, filter: 'blur(4px)' }} transition={{ duration: 0.35, ease: EASE_OUT }}>
                  <span className="label">{caption.role === 'user' ? 'You' : caption.role === 'call' ? 'Doing' : 'assign'}</span>
                  <span>{caption.text}</span>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="ai-ball-ctrls">
              <Tip label={v.muted ? 'Unmute' : 'Mute'} side="left"><button className={cx('ai-mini', v.muted && 'on')} onClick={() => voice.toggleMute()} aria-label={v.muted ? 'Unmute' : 'Mute'}><Icon name={v.muted ? 'micOff' : 'mic'} size={14} /></button></Tip>
              <Tip label="End" side="left"><button className="ai-mini danger" onClick={() => voice.stop()} aria-label="End voice"><Icon name="hangup" size={14} /></button></Tip>
            </div>
            <button className="ai-ball" onClick={expand} aria-label={`Voice assistant: ${STATUS_TEXT[v.status]}. Open`}>
              <span className="ai-ball-ring" />
              <AIOrb size={76} level={voiceLevel} intensity={0.25} hue={0} />
              <span className={cx('ai-ball-dot', v.status, v.muted && 'muted')} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
