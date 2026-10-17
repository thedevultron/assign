import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Icon from '../components/Icon.jsx';
import { Seg, Prio, HoldConfirm, Toggle, Button, Modal, Field, BorderTrace, EASE, EASE_OUT, quick } from '../components/ui.jsx';
import { useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import AISettings from '../components/ai/AISettings.jsx';
import { PRIORITIES, PROVIDERS, SEND_MODES, PRESET_META, TIMEZONES, guessTimezone, cx } from '../lib/helpers.js';

const SECTIONS = [
  { id: 'account', label: 'Account', icon: 'user' },
  { id: 'workspace', label: 'Workspace', icon: 'board' },
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'sending', label: 'Sending', icon: 'send' },
  { id: 'routing', label: 'Routing & security', icon: 'route' },
  { id: 'ai', label: 'AI assistant', icon: 'magic' },
  { id: 'help', label: 'Tutorial & help', icon: 'rocket' },
  { id: 'data', label: 'Data & danger', icon: 'alert' },
];
const ROUTING = [
  { value: 'smart', label: 'Smart', desc: 'Match skills, role and tags, then prefer the least busy agent.' },
  { value: 'least_loaded', label: 'Least loaded', desc: 'Always pick the agent with the fewest open tasks.' },
  { value: 'round_robin', label: 'Round robin', desc: 'Take turns, one agent after another.' },
];

function Row({ title, desc, children, split }) {
  return (
    <div className={cx('set-row', split && 'split')}>
      <div className="label-col"><div className="head" style={{ color: '#fff' }}>{title}</div>{desc ? <div className="muted">{desc}</div> : null}</div>
      <div>{children}</div>
    </div>
  );
}

/** Text input that saves on blur / Enter and shows a quiet "Saved" tick. */
function SaveInput({ value, onSave, ...rest }) {
  const [v, setV] = useState(value || '');
  const [saved, setSaved] = useState(false);
  useEffect(() => setV(value || ''), [value]);
  const commit = async () => {
    if ((v || '').trim() === (value || '')) return;
    const ok = await onSave(v.trim());
    if (ok === false) { setV(value || ''); return; }
    setSaved(true); setTimeout(() => setSaved(false), 1400);
  };
  return (
    <div className="save-input">
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setV(value || ''); } }} {...rest} />
      <AnimatePresence>{saved ? <motion.span className="affix" style={{ color: '#9be3b4' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={quick}><Icon name="check" size={14} /></motion.span> : null}</AnimatePresence>
    </div>
  );
}

function Section({ id, title, desc, children, i }) {
  return (
    <motion.section id={`set-${id}`} className="set-section" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.05 + i * 0.05 }}>
      <div><h3 className="h3">{title}</h3>{desc ? <p className="small muted" style={{ marginTop: 6, maxWidth: 560 }}>{desc}</p> : null}</div>
      {children}
    </motion.section>
  );
}

export default function Settings({ section }) {
  const settings = useStore((s) => s.settings);
  const user = useStore((s) => s.auth.user);
  const workspace = useStore((s) => s.auth.workspace || s.workspace);
  const { updateSettings, setUser, toast, fail, logout } = useStore.getState();
  const [active, setActive] = useState(section || 'account');
  const [modal, setModal] = useState(null); // 'email' | 'password' | 'clear' | 'delete'

  useEffect(() => {
    if (!section) return;
    setActive(section);
    const el = document.getElementById(`set-${section}`);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, [section]);

  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(`set-${s.id}`)).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id.slice(4));
    }, { rootMargin: '-10% 0px -70% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  if (!settings) return null;
  const saveSetting = async (patch) => { const r = await updateSettings(patch); return !!r; };
  const saveAccount = async (patch) => {
    try { const r = await api.patch('/account', patch); setUser(r.user); toast('Account updated'); return true; } catch (e) { fail(e); return false; }
  };
  const setPolicy = (p, patch) => updateSettings({ policy: { [p]: { ...settings.policy[p], ...patch } } });
  const tools = settings.tools || [];

  return (
    <div className="page">
      <motion.div className="page-head" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE }}>
        <div className="grow">
          <span className="label">{workspace?.name}</span>
          <h1 className="h1">Make it <em>yours.</em></h1>
          <p className="lede" style={{ marginTop: 14, maxWidth: 560 }}>Everything you chose during setup lives here — change it whenever you like. Changes save as you go.</p>
        </div>
      </motion.div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#/settings/${s.id}`} className={active === s.id ? 'on' : ''} onClick={(e) => { e.preventDefault(); setActive(s.id); document.getElementById(`set-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', `#/settings/${s.id}`); }}>
              {active === s.id ? <motion.span layoutId="set-nav-hl" className="nav-hl" transition={{ duration: 0.25, ease: EASE_OUT }} /> : null}
              <span className="row" style={{ gap: 10, position: 'relative' }}><Icon name={s.icon} size={15} />{s.label}</span>
            </a>
          ))}
        </nav>

        <div>
          <Section id="account" i={0} title="Account" desc="How you sign in to assign.">
            <Row title="Your name" desc="Shown on comments you leave for agents."><SaveInput value={user?.name} onSave={(v) => (v ? saveAccount({ name: v }) : false)} maxLength={60} /></Row>
            <Row title="Email" desc="Used to sign in.">
              <div className="row" style={{ gap: 8 }}><input className="input grow" value={user?.email || ''} readOnly /><Button variant="ghost" arrow={false} onClick={() => setModal('email')}>Change</Button></div>
            </Row>
            <Row title="Password" desc="Changing it signs out every other session." split><Button variant="ghost" arrow={false} onClick={() => setModal('password')}><Icon name="key" size={14} />Change password</Button></Row>
            <Row title="Sessions" desc="Signed in on another device you no longer use?" split>
              <div className="row" style={{ gap: 8 }}>
                <Button variant="ghost" arrow={false} onClick={async () => { try { await api.post('/account/logout-others'); toast('Signed out of all other sessions'); } catch (e) { fail(e); } }}>Sign out others</Button>
                <Button variant="quiet" arrow={false} onClick={logout}>Sign out</Button>
              </div>
            </Row>
          </Section>

          <Section id="workspace" i={1} title="Workspace" desc="Agents see the name and description in their briefing via whoami.">
            <Row title="Name"><SaveInput value={workspace?.name} onSave={(v) => (v ? saveSetting({ workspace: v }) : false)} maxLength={60} /></Row>
            <Row title="What you’re building" desc="A sentence or two of context for every agent.">
              <SaveTextarea value={settings.description} onSave={(v) => saveSetting({ description: v })} />
            </Row>
            <Row title="Timezone" desc="Used for daily sends, digests and automations.">
              <div className="row" style={{ gap: 8 }}>
                <input className="input grow" list="tz-list" defaultValue={settings.timezone} key={settings.timezone}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v === settings.timezone) return; if (!TIMEZONES.includes(v)) { e.target.value = settings.timezone; toast('Pick a timezone from the list', { tone: 'warn' }); return; } saveSetting({ timezone: v }); }} />
                <datalist id="tz-list">{TIMEZONES.map((z) => <option key={z} value={z} />)}</datalist>
                {guessTimezone() !== settings.timezone ? <Button variant="ghost" size="sm" arrow={false} onClick={() => saveSetting({ timezone: guessTimezone() })}>Use {guessTimezone().split('/').pop().replace(/_/g, ' ')}</Button> : null}
              </div>
            </Row>
            <Row title="Task key prefix" desc={`Tasks are numbered ${settings.key_prefix}-1, ${settings.key_prefix}-2… 2–6 letters.`}>
              <SaveInput value={settings.key_prefix} onSave={(v) => (/^[A-Za-z]{2,6}$/.test(v) ? saveSetting({ key_prefix: v }) : (toast('Use 2–6 letters', { tone: 'warn' }), false))} maxLength={6} style={{ textTransform: 'uppercase', fontFamily: 'var(--mono)', maxWidth: 160 }} />
            </Row>
          </Section>

          <Section id="general" i={2} title="General" desc="Workspace-wide preferences and display options.">
            <Row title="Compact sidebar" desc="Collapse the sidebar to icons only by default." split>
              <Toggle on={useStore((s) => s.ui.collapsed)} onChange={() => useStore.getState().toggleCollapsed()} label="Compact sidebar" />
            </Row>
            <Row title="Follow along" desc="While the assistant works, the app jumps to the board and highlights the card it’s changing.">
              <Toggle on={settings.follow_along !== false} onChange={(v) => saveSetting({ follow_along: v })} label="Follow along" />
            </Row>
            <Row title="Ask before risky actions" desc="Deletes, approvals, token changes and settings changes need your OK.">
              <Toggle on={settings.confirm_risky !== false} onChange={(v) => saveSetting({ confirm_risky: v })} label="Ask before risky actions" />
            </Row>
          </Section>

          <Section id="sending" i={3} title="Sending" desc="When a task is ready, how quickly should it reach the agent? Pick a preset or tune each priority.">
            <div className="preset-grid">
              {Object.entries(PRESET_META).map(([id, m]) => {
                const on = settings.preset === id;
                return (
                  <button key={id} className={cx('preset', on && 'on')} onClick={() => !on && updateSettings({ preset: id })} aria-pressed={on}>
                    {on ? <BorderTrace radius={16} /> : null}
                    <span className="label">{m.label}</span>
                    <span className="serif" style={{ fontSize: 26, color: '#fff', lineHeight: 1 }}>{m.title}</span>
                    <span className="small muted">{m.desc}</span>
                  </button>
                );
              })}
            </div>
            <AnimatePresence>{settings.preset === 'custom' ? <motion.span className="label" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Custom rules</motion.span> : null}</AnimatePresence>
            <div className="panel" style={{ padding: '4px 22px' }}>
              {PRIORITIES.map((p) => {
                const pol = settings.policy[p.id];
                return (
                  <div key={p.id} className="policy-row" style={{ gridTemplateColumns: '120px 1fr 170px' }}>
                    <Prio p={p.id} label />
                    <Seg size="sm" options={SEND_MODES.map((m) => ({ value: m.id, label: m.label }))} value={pol.mode} onChange={(v) => setPolicy(p.id, { mode: v })} />
                    <div>
                      {pol.mode === 'batched' ? (
                        <label className="row small muted" style={{ gap: 8 }}>every
                          <select className="input" style={{ height: 34, width: 'auto' }} value={pol.interval} onChange={(e) => setPolicy(p.id, { interval: +e.target.value })}>
                            {[5, 15, 30, 60, 120, 240, 480].map((n) => <option key={n} value={n}>{n < 60 ? `${n} min` : `${n / 60} h`}</option>)}
                          </select>
                        </label>
                      ) : pol.mode === 'daily' ? (
                        <label className="row small muted" style={{ gap: 8 }}>at<input type="time" className="input" style={{ height: 34, width: 'auto' }} value={pol.time} onChange={(e) => e.target.value && setPolicy(p.id, { time: e.target.value })} /></label>
                      ) : <span className="small muted">{SEND_MODES.find((m) => m.id === pol.mode)?.desc}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="small muted">You can always override per task with “Send now”, “Schedule” or “Hold”.</p>
          </Section>

          <Section id="routing" i={4} title="Routing & security" desc="How tasks marked “Auto” pick an agent, which coding tools your team uses, and how agents prove who they are.">
            <Row title="Auto-routing" desc={ROUTING.find((r) => r.value === (settings.routing || 'smart'))?.desc}>
              <Seg options={ROUTING.map(({ value, label }) => ({ value, label }))} value={settings.routing || 'smart'} onChange={(v) => saveSetting({ routing: v })} block />
            </Row>
            <Row title="Coding tools" desc="Shown first when you connect a new agent. Multiple agents can share one tool — each gets its own key.">
              <div className="row wrap" style={{ gap: 6 }}>
                {PROVIDERS.map((p) => {
                  const on = tools.includes(p.id);
                  return <button key={p.id} className={cx('pick-chip', on && 'on')} aria-pressed={on} onClick={() => saveSetting({ tools: on ? tools.filter((t) => t !== p.id) : [...tools, p.id] })}>{on ? <Icon name="check" size={12} /> : null}{p.label}</button>;
                })}
              </div>
            </Row>
            <Row title="Require pairing" desc={settings.require_pairing !== false ? 'On — a new agent must show you a 6-digit code before it can touch tasks. Rotating a token resets pairing.' : 'Off — any client holding a valid token can work immediately.'} split>
              <Toggle on={settings.require_pairing !== false} onChange={(v) => saveSetting({ require_pairing: v })} label="Require pairing" />
            </Row>
          </Section>

          <Section id="ai" i={5} title="AI assistant" desc="Chat and voice that can read and change everything in assign, with your keys and your rules.">
            <AISettings Row={Row} />
          </Section>
          <Section id="help" i={6} title="Tutorial & help" desc="Everything you picked during setup has a manual.">
            <Row title="Product tutorial" desc="An eight-step, hands-on tour — your progress is saved on this device." split>
              <Button variant="ghost" arrow={false} onClick={() => { location.hash = '#/tutorial'; }}><Icon name="rocket" size={14} />Open tutorial</Button>
            </Row>
            <Row title="Replay the setup" desc="Re-run the onboarding wizard — nothing is deleted, you can skip any step." split>
              <Button variant="ghost" arrow={false} onClick={() => { location.hash = '#/onboarding'; }}><Icon name="refresh" size={14} />Replay setup</Button>
            </Row>
            <Row title="Agent skill" desc="The zip your coding tool needs to talk to this workspace (SKILL.md + MCP config)." split>
              <a className="btn btn-ghost btn-sm" href="/skill/assign-skill.zip" download><Icon name="download" size={14} />Download skill</a>
            </Row>
            <Row title="Keyboard shortcuts" desc="Press ⌘K or / anywhere to search and run commands." split>
              <Button variant="ghost" arrow={false} onClick={() => useStore.getState().setUI({ palette: true })}><Icon name="command" size={14} />Show shortcuts</Button>
            </Row>
            <Row title="Docs" desc="The full manual — MCP tools, pairing, API and automations." split>
              <Button variant="ghost" arrow={false} onClick={() => { location.hash = '#/docs'; }}><Icon name="file" size={14} />Read the docs</Button>
            </Row>
          </Section>
          <Section id="data" i={7} title="Data & danger zone" desc="Your data is yours. Export everything as JSON at any time.">
            <Row title="Export workspace" desc="Boards, agents (without keys), tasks, automations and history." split>
              <Button variant="ghost" arrow={false} onClick={() => api.download('/export', `assign-export-${new Date().toISOString().slice(0, 10)}.json`).catch(fail)}><Icon name="download" size={14} />Download JSON</Button>
            </Row>
            <div className="danger-box col" style={{ gap: 18 }}>
              <Row title="Clear tasks & history" desc="Deletes every task, comment and activity entry. Agents, boards and automations stay." split>
                <Button variant="danger" arrow={false} onClick={() => setModal('clear')}>Clear workspace</Button>
              </Row>
              <Row title="Delete account" desc="Permanently deletes your account, workspace and every agent key. Connected agents stop working immediately." split>
                <Button variant="danger" arrow={false} onClick={() => setModal('delete')}><Icon name="trash" size={14} />Delete account</Button>
              </Row>
            </div>
          </Section>
        </div>
      </div>

      <ConfirmModal kind={modal} onClose={() => setModal(null)} workspace={workspace} user={user} />
    </div>
  );
}

function SaveTextarea({ value, onSave }) {
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  return <textarea className="textarea" rows={3} value={v} maxLength={1000} placeholder="e.g. A Next.js storefront with a Go API. We care about tests and small PRs." onChange={(e) => setV(e.target.value)} onBlur={() => v !== (value || '') && onSave(v)} />;
}

function ConfirmModal({ kind, onClose, workspace, user }) {
  const { setUser, toast, logout, bootstrap } = useStore.getState();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setA(''); setB(''); setErr(''); setBusy(false); }, [kind]);
  const META = {
    email: { title: 'Change email', cta: 'Save email' },
    password: { title: 'Change password', cta: 'Update password' },
    clear: { title: 'Clear tasks & history', cta: 'Clear everything' },
    delete: { title: 'Delete account', cta: 'Delete forever' },
  };
  const m = META[kind] || META.email;
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (kind === 'email') { const r = await api.patch('/account', { email: a, password: b }); setUser(r.user); toast('Email updated'); }
      if (kind === 'password') { if (b.length < 8) throw new Error('Use at least 8 characters'); await api.post('/account/password', { current: a, next: b }); toast('Password changed — other sessions signed out'); }
      if (kind === 'clear') { await api.post('/workspace/clear', { confirm: a }); await bootstrap(); toast('Workspace cleared'); }
      if (kind === 'delete') { await api.del('/account', { password: a }); onClose(); await logout(); return; }
      onClose();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  const danger = kind === 'clear' || kind === 'delete';
  const ready = kind === 'clear' ? a === workspace?.name : kind === 'delete' ? a.length > 0 : a && b;
  return (
    <Modal open={!!kind} onClose={onClose} label={m.title}>
      <form onSubmit={submit}>
        <div className="modal-head"><span className="label">{m.title}</span><span className="spacer" /><button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        <div className="modal-body">
          {kind === 'email' ? <>
            <Field label="New email"><input className="input" type="email" autoFocus value={a} onChange={(e) => setA(e.target.value)} placeholder={user?.email} autoComplete="email" /></Field>
            <Field label="Current password"><input className="input" type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="current-password" /></Field>
          </> : null}
          {kind === 'password' ? <>
            <Field label="Current password"><input className="input" type="password" autoFocus value={a} onChange={(e) => setA(e.target.value)} autoComplete="current-password" /></Field>
            <Field label="New password" hint="At least 8 characters."><input className="input" type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" /></Field>
          </> : null}
          {kind === 'clear' ? <>
            <div className="warnbox"><Icon name="alert" size={16} /><span>This deletes every task, comment and activity entry in <b>{workspace?.name}</b>. Agents, boards and automations are kept. This can’t be undone.</span></div>
            <Field label={<>Type <span className="mono" style={{ color: '#fff', textTransform: 'none' }}>{workspace?.name}</span> to confirm</>}><input className="input" autoFocus value={a} onChange={(e) => setA(e.target.value)} /></Field>
          </> : null}
          {kind === 'delete' ? <>
            <div className="warnbox"><Icon name="alert" size={16} /><span>Your account, workspace, agents and their keys will be permanently deleted. Consider exporting first.</span></div>
            <Field label="Password"><input className="input" type="password" autoFocus value={a} onChange={(e) => setA(e.target.value)} autoComplete="current-password" /></Field>
          </> : null}
          <AnimatePresence>{err ? <motion.div className="err" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>{err}</motion.div> : null}</AnimatePresence>
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {danger
            ? <HoldConfirm disabled={!ready || busy} doneLabel={kind === 'delete' ? 'Deleting…' : 'Clearing…'} resetAfter={1800} onConfirm={() => submit({ preventDefault() {} })}>{`Hold to ${m.cta.toLowerCase()}`}</HoldConfirm>
            : <Button type="submit" loading={busy} disabled={!ready}>{m.cta}</Button>}
        </div>
      </form>
    </Modal>
  );
}
