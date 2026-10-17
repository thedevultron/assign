import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Icon from '../Icon.jsx';
import { Button, Seg, Toggle, Spinner, HoldConfirm, EASE_OUT, quick } from '../ui.jsx';
import { useStore } from '../../lib/store.js';
import { api } from '../../lib/api.js';
import { useAI } from '../../lib/ai.js';
import { cx } from '../../lib/helpers.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const MONO = { google: 'G', openai: 'O', anthropic: 'A', openrouter: 'R', groq: 'Q', xai: 'X', mistral: 'M', deepseek: 'D' };

function ProviderRow({ p, i }) {
  const toast = useStore((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async (e) => {
    e?.preventDefault(); if (!key.trim()) return;
    setBusy(true); setErr('');
    try {
      const c = await useAI.getState().saveKey(p.id, key.trim());
      setKey(''); setEditing(false);
      toast(c.warning ? c.warning : `${p.label} key saved`, { tone: c.warning ? 'warn' : 'success' });
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    try { await useAI.getState().removeKey(p.id); toast(`${p.label} key removed`); } catch (e) { toast(e.message, { tone: 'error' }); }
  };
  return (
    <motion.div className={cx('ai-prov', p.set && 'set')} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE_OUT, delay: i * 0.03 }}>
      <div className="row" style={{ gap: 12, minWidth: 0 }}>
        <span className="ai-prov-mono">{MONO[p.id] || p.label[0]}</span>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span className="row" style={{ gap: 8 }}><span style={{ color: '#fff', fontSize: 14 }}>{p.label}</span>{p.voice ? <span className="chip-mini">Chat + voice</span> : null}</span>
          <span className="tiny muted trunc">{p.set ? <><i className="ai-ok" />{p.isDefault ? 'Built-in key active' : 'Connected'} · <span className="mono">{p.hint}</span>{p.isDefault ? ' — add your own below to override it' : ''}</> : 'Not connected'}</span>
        </div>
        <span className="spacer" />
        {!editing && (
          <div className="row" style={{ gap: 6 }}>
            {p.set && !p.isDefault ? <HoldConfirm size="sm" onConfirm={remove} doneLabel="Removed" holdTime={900}>Hold to remove</HoldConfirm> : null}
            <Button size="sm" variant="ghost" arrow={false} onClick={() => setEditing(true)}>{p.set && !p.isDefault ? 'Replace' : 'Add key'}</Button>
          </div>
        )}
      </div>
      <AnimatePresence initial={false}>
        {editing && (
          <motion.form onSubmit={save} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={quick} style={{ overflow: 'hidden' }}>
            <div className="col" style={{ gap: 8, paddingTop: 12 }}>
              <div className="row" style={{ gap: 8 }}>
                <input className="input" type="password" autoFocus autoComplete="off" spellCheck={false} placeholder={p.placeholder} value={key} onChange={(e) => setKey(e.target.value)} aria-label={`${p.label} API key`} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} />
                <Button type="submit" size="sm" loading={busy} disabled={!key.trim()}>Save</Button>
                <Button size="sm" variant="ghost" arrow={false} onClick={() => { setEditing(false); setKey(''); setErr(''); }}>Cancel</Button>
              </div>
              {err ? <span className="tiny" style={{ color: '#ffb4a8' }}>{err}</span> : <span className="tiny muted">We check the key with {p.label} before saving. <a className="link" href={p.keyUrl} target="_blank" rel="noreferrer">Get a key ↗</a></span>}
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function AISettings({ Row }) {
  const config = useAI((s) => s.config);
  const { saveSettings } = useAI.getState();
  const [models, setModels] = useState(null);
  const [custom, setCustom] = useState(false);
  const [memories, setMemories] = useState([]);
  const [memKind, setMemKind] = useState('fact');
  const [memTitle, setMemTitle] = useState('');
  const [memContent, setMemContent] = useState('');
  const [memBusy, setMemBusy] = useState(false);
  const loadMemories = async () => { try { const r = await api.get('/memory'); setMemories(r.memories || []); } catch { setMemories([]); } };
  useEffect(() => { loadMemories(); }, []);
  useEffect(() => { if (!config) useAI.getState().loadConfig(); }, []); // eslint-disable-line
  const st = config?.settings;
  const prov = config?.providers?.find((p) => p.id === st?.chat_provider);
  useEffect(() => {
    if (!prov?.set) { setModels(null); return undefined; }
    let live = true; setModels(null);
    api.get(`/ai/models?provider=${prov.id}`).then((r) => live && setModels((r.models || []).filter((m) => !m.live))).catch(() => live && setModels([]));
    return () => { live = false; };
  }, [prov?.id, prov?.set]);
  const modelList = useMemo(() => {
    const l = models || [];
    return st?.chat_model && !l.some((m) => m.id === st.chat_model) ? [{ id: st.chat_model, label: st.chat_model }, ...l] : l;
  }, [models, st?.chat_model]);

  if (!config) return <div className="set-row"><Spinner /></div>;
  const keyed = config.providers.filter((p) => p.set);
  const vm = config.voice_models.find((m) => m.id === st.voice_model);
  const google = config.providers.find((p) => p.id === 'google');

  return (
    <>
      <Row title="API keys" desc="Your keys are encrypted on this server and never sent to the browser. Google powers voice; any provider can power chat. A built-in Google key can be supplied by the server admin — adding your own always overrides it." split>
        <div className="col" style={{ gap: 8, maxHeight: 260, overflowY: 'auto', paddingRight: 4 }}>
          {config.providers.map((p, i) => <ProviderRow key={p.id} p={p} i={i} />)}
        </div>
      </Row>
      <Row title="Chat model" desc="The model behind the assistant panel. More thinking is slower but better at multi-step changes.">
        <div className="col" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select className="input" style={{ maxWidth: 210 }} value={st.chat_provider} onChange={(e) => saveSettings({ chat_provider: e.target.value })} aria-label="Chat provider">
              {(keyed.some((p) => p.id === st.chat_provider) ? keyed : [prov, ...keyed].filter(Boolean)).map((p) => <option key={p.id} value={p.id}>{p.label}{p.set ? '' : ' (no key)'}</option>)}
            </select>
            {custom || (models && !models.length) ? (
              <input className="input" style={{ flex: 1, minWidth: 200 }} defaultValue={st.chat_model} placeholder="model id" aria-label="Chat model id"
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== st.chat_model) saveSettings({ chat_model: v }); }} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
            ) : (
              <select className="input" style={{ flex: 1, minWidth: 200 }} value={st.chat_model} onChange={(e) => (e.target.value === '__custom' ? setCustom(true) : saveSettings({ chat_model: e.target.value }))} disabled={!models} aria-label="Chat model">
                {modelList.map((m) => <option key={m.id} value={m.id}>{m.label && m.label !== m.id ? `${m.label} — ${m.id}` : m.id}</option>)}
                <option value="__custom">Other model id…</option>
              </select>
            )}
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span className="label" style={{ minWidth: 70 }}>Thinking</span>
            <Seg size="sm" options={config.chat_efforts.map((e) => ({ value: e, label: cap(e) }))} value={st.chat_effort} onChange={(v) => saveSettings({ chat_effort: v })} />
          </div>
          {!keyed.length ? <span className="tiny muted">Add a key above to start chatting.</span> : null}
        </div>
      </Row>
      <Row title="Voice" desc={google?.set ? 'Live, interruptible voice on the Gemini Live API. Minimise it and it keeps working.' : 'Voice needs a Google AI Studio key (free tier works).'}>
        <div className="col" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span className="label" style={{ minWidth: 70 }}>Model</span>
            <Seg size="sm" options={config.voice_models.map((m) => ({ value: m.id, label: m.thinking ? 'Extended thinking' : 'Standard' }))} value={st.voice_model} onChange={(v) => saveSettings({ voice_model: v })} />
          </div>
          <div className={cx('row', !vm?.thinking && 'dim')} style={{ gap: 10, flexWrap: 'wrap' }}>
            <span className="label" style={{ minWidth: 70 }}>Effort</span>
            <Seg size="sm" options={config.voice_efforts.map((e) => ({ value: e, label: cap(e) }))} value={st.voice_effort} onChange={(v) => vm?.thinking && saveSettings({ voice_effort: v })} />
            {!vm?.thinking ? <span className="tiny muted">Only for extended thinking</span> : null}
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <span className="label" style={{ minWidth: 70, paddingTop: 8 }}>Voice</span>
            <div className="ai-voices">
              {config.voices.map((n) => (
                <button key={n} className={cx('ai-voice-chip', st.voice_name === n && 'on')} onClick={() => saveSettings({ voice_name: n })} aria-pressed={st.voice_name === n}>
                  {st.voice_name === n ? <motion.span layoutId="voice-hl" className="ai-voice-hl" transition={{ duration: 0.3, ease: EASE_OUT }} /> : null}
                  <span>{n}</span>
                </button>
              ))}
            </div>
          </div>
          <span className="tiny muted">{vm?.label} · {vm?.thinking ? 'reasons before acting, best for multi-step requests' : 'lowest latency'}</span>
        </div>
      </Row>

      <Row title="Memory (long-term)" desc="What assign remembers about you. Stored locally in MEMORY.md / memory.json — Firebase-ready. The assistant auto-learns when this is on.">
        <div className="col" style={{ gap: 12 }}>
          <Toggle on={st.memory_learn !== false} onChange={(v) => saveSettings({ memory_learn: v })} label="Auto-learn" />
          <div className="col" style={{ gap: 6, maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
            {memories.length === 0 ? <span className="tiny muted">Nothing remembered yet.</span> : memories.map((m) => (
              <div key={m.id} className="row" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line-2)' }}>
                <span className="chip-mini">{m.kind}</span>
                <span style={{ color: '#fff', fontSize: 13, flex: 1, minWidth: 0 }} className="trunc">{m.title}</span>
                <button className="icon-btn xs" aria-label="Delete memory" onClick={async () => { await api.del(`/memory/${m.id}`); await loadMemories(); }}><Icon name="trash" size={12} /></button>
              </div>
            ))}
          </div>
          <form className="col" style={{ gap: 8 }} onSubmit={async (e) => { e.preventDefault(); if (!memTitle.trim()) return; setMemBusy(true); try { await api.post('/memory', { kind: memKind, title: memTitle.trim(), content: memContent.trim() }); setMemTitle(''); setMemContent(''); await loadMemories(); } finally { setMemBusy(false); } }}>
            <div className="row" style={{ gap: 8 }}>
              <select className="input" style={{ width: 110 }} value={memKind} onChange={(e) => setMemKind(e.target.value)} aria-label="Memory kind">
                {['fact','preference','project','person','note'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <input className="input" style={{ flex: 1 }} placeholder="Title" value={memTitle} onChange={(e) => setMemTitle(e.target.value)} aria-label="Memory title" />
            </div>
            <textarea className="textarea" rows={2} placeholder="Detail (optional)" value={memContent} onChange={(e) => setMemContent(e.target.value)} aria-label="Memory content" />
            <Button type="submit" size="sm" loading={memBusy} disabled={!memTitle.trim()}>Add memory</Button>
          </form>
        </div>
      </Row>

    </>
  );
}
