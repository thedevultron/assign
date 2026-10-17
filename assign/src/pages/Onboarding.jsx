import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Icon from '../components/Icon.jsx';
import { Button, LogoMark, Field, Toggle, Seg, Prio, Spinner, EASE, EASE_OUT, smooth } from '../components/ui.jsx';
import { useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import {
  PROVIDERS, AGENT_COLORS, inkOn, guessTimezone, TIMEZONES, POLICY_PRESETS, PRESET_META, PRIORITIES, SEND_MODES,
  AGENT_NAMES, ROLE_PRESETS, toHandle, rid,
} from '../lib/helpers.js';

const TOTAL = 7;
const STEP_LABEL = { 2: 'Workspace', 3: 'Tools', 4: 'Agents', 5: 'Sending', 6: 'Digest', 7: 'First board' };

function dedupeHandles(agents) {
  const seen = {};
  return agents.map((a) => {
    const root = toHandle(a.name);
    seen[root] = (seen[root] || 0) + 1;
    return seen[root] === 1 ? root : `${root}${seen[root]}`;
  });
}

function defaults(user, workspace) {
  const d = workspace?.onboarding?.data || {};
  let pending = d.pending_task || '';
  try { pending = pending || sessionStorage.getItem('assign:pending_task') || ''; } catch {}
  return {
    workspace: { name: workspace?.name || '', description: '', timezone: guessTimezone(), ...(d.workspace || {}) },
    tools: d.tools || [],
    agents: d.agents || [],
    preset: d.preset || 'balanced',
    digest: { enabled: true, time: '09:00', ...(d.digest || {}) },
    board: { name: 'Main', repo: '', ...(d.board || {}) },
    task: { title: pending, priority: 'medium', ...(d.task || {}) },
  };
}

export default function Onboarding() {
  const { user, workspace } = useStore((s) => s.auth);
  const setWorkspace = useStore((s) => s.setWorkspace);
  const logout = useStore((s) => s.logout);
  const [step, setStep] = useState(() => Math.max(2, Math.min(TOTAL, workspace?.onboarding?.step || 2)));
  const [dir, setDir] = useState(1);
  const [d, setD] = useState(() => defaults(user, workspace));
  const [err, setErr] = useState('');
  const [finishing, setFinishing] = useState(false);
  const saveT = useRef(null);
  useEffect(() => { window.scrollTo(0, 0); }, [step]);

  // autosave so the wizard is resumable
  useEffect(() => {
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => { api.patch('/onboarding', { step, data: d }).catch(() => {}); }, 500);
    return () => clearTimeout(saveT.current);
  }, [d, step]);

  const patch = (k, v) => setD((x) => ({ ...x, [k]: typeof v === 'function' ? v(x[k]) : { ...x[k], ...v } }));
  const setArr = (k, v) => setD((x) => ({ ...x, [k]: typeof v === 'function' ? v(x[k]) : v }));

  const validate = () => {
    if (step === 2 && !d.workspace.name.trim()) return 'Give your workspace a name';
    if (step === 3 && !d.tools.length) return 'Pick at least one tool — you can change this later';
    if (step === 4 && d.agents.some((a) => !a.name.trim())) return 'Every agent needs a name';
    if (step === 7 && !d.board.name.trim()) return 'Name your first board';
    return '';
  };
  const next = async () => {
    const e = validate(); setErr(e); if (e) return;
    if (step === 3) {
      // seed one agent per newly chosen tool, drop agents for removed tools
      setArr('agents', (list) => {
        const kept = list.filter((a) => d.tools.includes(a.provider));
        const used = new Set(kept.map((a) => a.name));
        const out = [...kept];
        d.tools.forEach((t) => {
          if (!out.some((a) => a.provider === t)) {
            const name = AGENT_NAMES.find((n) => !used.has(n)) || `Agent ${out.length + 1}`;
            used.add(name);
            out.push({ id: rid('x'), name, provider: t, role: ROLE_PRESETS[0], color: AGENT_COLORS[out.length % AGENT_COLORS.length] });
          }
        });
        return out;
      });
    }
    if (step < TOTAL) { setDir(1); setStep(step + 1); return; }
    finish();
  };
  const back = () => { setErr(''); setDir(-1); setStep((s) => Math.max(2, s - 1)); };

  const skip = async () => {
    setFinishing(true);
    try {
      const r = await api.post('/onboarding/complete', { workspace: { name: d.workspace?.name, timezone: d.workspace?.timezone }, preset: 'balanced', board: { name: d.board?.name || 'Main', repo: '' } });
      try { sessionStorage.removeItem('assign:pending_task'); } catch {}
      await new Promise((res) => setTimeout(res, 1400));
      setWorkspace(r.workspace);
      location.hash = '#/';
    } catch (e2) {
      if (e2.status === 400 || /already/.test(e2.message)) { setWorkspace({ ...workspace, onboarded: true }); location.hash = '#/'; }
      else { setErr(e2.message); setFinishing(false); }
    }
  };

  const finish = async () => {
    setFinishing(true);
    try {
      const handles = dedupeHandles(d.agents);
      const r = await api.post('/onboarding/complete', {
        workspace: d.workspace, tools: d.tools, preset: d.preset, digest: d.digest, board: d.board,
        agents: d.agents.map((a, i) => ({ name: a.name, handle: handles[i], provider: a.provider, role: a.role, color: a.color, skills: a.skills || [] })),
        task: d.task.title.trim() ? d.task : null,
      });
      try { sessionStorage.removeItem('assign:pending_task'); } catch {}
      await new Promise((res) => setTimeout(res, 1400));
      useStore.setState({ settings: r.settings });
      setWorkspace(r.workspace);
      location.hash = '#/';
    } catch (e) {
      if (/already set up/.test(e.message)) { setWorkspace({ ...workspace, onboarded: true }); location.hash = '#/'; return; }
      setErr(e.message); setFinishing(false);
    }
  };

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); next(); } };

  return (
    <div className="ob" onKeyDown={onKey}>
      <div className="ob-top">
        <span className="wordmark"><LogoMark size={22} />assign</span>
        <div className="ob-steps" aria-label={`Step ${step} of ${TOTAL}`}>
          {Array.from({ length: TOTAL }, (_, i) => (
            <i key={i}><motion.b initial={false} animate={{ scaleX: i + 1 <= step ? 1 : 0 }} transition={{ duration: 0.6, ease: EASE_OUT }} /></i>
          ))}
        </div>
        <button className="link small" onClick={skip} disabled={finishing}>Skip setup →</button>
        <button className="btn btn-quiet btn-sm" onClick={logout}>Sign out</button>
      </div>

      <div className="ob-body">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div key={step} custom={dir}
            initial={{ opacity: 0, x: dir * 36, filter: 'blur(6px)' }} animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, x: dir * -24, filter: 'blur(4px)' }}
            transition={{ duration: 0.5, ease: EASE_OUT }}>
            <span className="label">Step {step} of {TOTAL} · {STEP_LABEL[step]}</span>
            {step === 2 && <StepWorkspace d={d} patch={patch} user={user} />}
            {step === 3 && <StepTools d={d} setArr={setArr} />}
            {step === 4 && <StepAgents d={d} setArr={setArr} />}
            {step === 5 && <StepPreset d={d} setArr={setArr} />}
            {step === 6 && <StepDigest d={d} patch={patch} />}
            {step === 7 && <StepBoard d={d} patch={patch} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="ob-foot">
        <div className="inner">
          {step > 2 ? <Button variant="ghost" onClick={back}><Icon name="left" size={16} />Back</Button> : <span className="small muted">You can change all of this later in Settings.</span>}
          <div className="spacer" />
          <AnimatePresence>{err ? <motion.span className="err" role="alert" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>{err}</motion.span> : null}</AnimatePresence>
          {step === 4 && d.agents.length === 0 ? <Button variant="quiet" onClick={() => { setDir(1); setStep(5); }}>Skip for now</Button> : null}
          <Button arrow onClick={next} loading={finishing}>{step === TOTAL ? 'Finish setup' : 'Continue'}</Button>
        </div>
      </div>

      <AnimatePresence>{finishing && <Finishing d={d} />}</AnimatePresence>
    </div>
  );
}

/* ───────── step 2 ───────── */
function StepWorkspace({ d, patch, user }) {
  const tzOptions = useMemo(() => (TIMEZONES.includes(d.workspace.timezone) ? TIMEZONES : [d.workspace.timezone, ...TIMEZONES]), [d.workspace.timezone]);
  return (
    <>
      <h1 className="h1 ob-title">Hi {user?.name?.split(' ')[0] || 'there'}. What are you <em>building?</em></h1>
      <p className="lede ob-lede">This becomes context every agent receives when it connects.</p>
      <div className="col" style={{ gap: 22 }}>
        <Field label="Workspace name"><input className="input lg" autoFocus value={d.workspace.name} onChange={(e) => patch('workspace', { name: e.target.value })} placeholder="Acme Engineering" maxLength={60} /></Field>
        <Field label="What’s the project?" hint="A sentence or two about the codebase, stack and conventions. Optional.">
          <textarea className="textarea" value={d.workspace.description} onChange={(e) => patch('workspace', { description: e.target.value })} placeholder="A Next.js + Postgres SaaS. TypeScript everywhere, tests with Vitest, PRs need a green CI." maxLength={1000} />
        </Field>
        <Field as="div" label="Timezone" hint="Used for digests, daily sends and schedules.">
          <select className="input" value={d.workspace.timezone} onChange={(e) => patch('workspace', { timezone: e.target.value })}>
            {tzOptions.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </Field>
      </div>
    </>
  );
}

/* ───────── step 3 ───────── */
function StepTools({ d, setArr }) {
  const toggle = (id) => setArr('tools', (t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  return (
    <>
      <h1 className="h1 ob-title">Which coding tools do your agents <em>use?</em></h1>
      <p className="lede ob-lede">Pick every tool you run. You can put several agents in one tool or spread them across many — assign keeps them out of each other’s way.</p>
      <div className="tool-grid">
        {PROVIDERS.map((p, i) => {
          const on = d.tools.includes(p.id);
          return (
            <motion.button key={p.id} type="button" className={`tool-opt ${on ? 'on' : ''}`} onClick={() => toggle(p.id)} aria-pressed={on}
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE_OUT, delay: i * 0.04 }} whileTap={{ scale: 0.98 }}>
              <span className="tm">{p.short}</span>
              <span className="check">{on ? <Icon name="check" size={12} /> : null}</span>
              <span className="col" style={{ gap: 2 }}>
                <span style={{ fontSize: 15 }}>{p.label}</span>
                <span className="mono muted" style={{ fontSize: 10 }}>{p.vendor}</span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </>
  );
}

/* ───────── step 4 ───────── */
function StepAgents({ d, setArr }) {
  const handles = dedupeHandles(d.agents);
  const update = (id, p) => setArr('agents', (l) => l.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const add = (provider) => setArr('agents', (l) => {
    const used = new Set(l.map((a) => a.name));
    const name = AGENT_NAMES.find((n) => !used.has(n)) || `Agent ${l.length + 1}`;
    return [...l, { id: rid('x'), name, provider, role: ROLE_PRESETS[(l.length + 1) % ROLE_PRESETS.length], color: AGENT_COLORS[l.length % AGENT_COLORS.length] }];
  });
  const removeA = (id) => setArr('agents', (l) => l.filter((a) => a.id !== id));
  return (
    <>
      <h1 className="h1 ob-title">Meet your <em>agents.</em></h1>
      <p className="lede ob-lede">Each agent gets its own token, MCP server key and branch prefix, so three agents in one Claude Code never collide. Personas, prompts and skills can be refined later.</p>
      <div className="col" style={{ gap: 28 }}>
        {d.tools.map((t) => {
          const p = PROVIDERS.find((x) => x.id === t);
          const list = d.agents.map((a, i) => ({ a, h: handles[i] })).filter(({ a }) => a.provider === t);
          return (
            <div key={t} className="col" style={{ gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 10 }}><span className="tm-sm">{p.short}</span><span className="h4">{p.label}</span><span className="label">{list.length} agent{list.length === 1 ? '' : 's'}</span></span>
                <Button variant="quiet" size="sm" onClick={() => add(t)}><Icon name="plus" size={15} />Add agent</Button>
              </div>
              <AnimatePresence initial={false}>
                {list.map(({ a, h }) => (
                  <motion.div key={a.id} layout className="ob-agent" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }} transition={smooth} style={{ overflow: 'hidden' }}>
                    <ColorDot color={a.color} onChange={(c) => update(a.id, { color: c })} name={a.name} />
                    <input className="input" value={a.name} onChange={(e) => update(a.id, { name: e.target.value })} placeholder="Agent name" maxLength={40} aria-label="Agent name" />
                    <select className="input" value={a.role} onChange={(e) => update(a.id, { role: e.target.value })} aria-label="Role">
                      {(ROLE_PRESETS.includes(a.role) ? ROLE_PRESETS : [a.role, ...ROLE_PRESETS]).map((r) => <option key={r}>{r}</option>)}
                    </select>
                    {t === 'other' ? (
                      <input className="input" value={a.provider_label || ''} onChange={(e) => update(a.id, { provider_label: e.target.value })} placeholder="Client name (e.g. Zed)" maxLength={60} aria-label="Custom client name" style={{ maxWidth: 150 }} />
                    ) : null}
                    <span className="mono muted trunc" style={{ fontSize: 10.5 }} title={`MCP key assign-${h} · branches ${h}/asg-*`}>assign-{h}</span>
                    <button className="icon-btn sm" onClick={() => removeA(a.id)} aria-label={`Remove ${a.name}`}><Icon name="close" size={15} /></button>
                  </motion.div>
                ))}
              </AnimatePresence>
              {!list.length && <button className="tool-empty" onClick={() => add(t)}>No agents on {p.label} yet — add one</button>}
            </div>
          );
        })}
      </div>
    </>
  );
}
function ColorDot({ color, onChange, name }) {
  const i = AGENT_COLORS.indexOf(color);
  return (
    <button type="button" className="avatar" title="Change colour" aria-label="Change colour" onClick={() => onChange(AGENT_COLORS[(i + 1) % AGENT_COLORS.length])}
      style={{ width: 36, height: 36, background: color, color: inkOn(color), fontSize: 13, transition: 'background-color .2s ease' }}>
      {(name || '?')[0]?.toUpperCase()}
    </button>
  );
}

/* ───────── step 5 ───────── */
function StepPreset({ d, setArr }) {
  const pol = POLICY_PRESETS[d.preset];
  return (
    <>
      <h1 className="h1 ob-title">How eagerly should work be <em>sent?</em></h1>
      <p className="lede ob-lede">A task is “sent” when it’s released to an agent’s queue. Pick a starting point; you can tune each priority in Settings.</p>
      <div className="preset-pick">
        {Object.entries(PRESET_META).map(([k, m]) => (
          <button key={k} type="button" className={d.preset === k ? 'on' : ''} onClick={() => setArr('preset', k)}>
            <span className="label">{m.label}</span>
            <span className="serif" style={{ fontSize: 28, lineHeight: 1 }}>{m.title}</span>
            <span className="small muted">{m.desc}</span>
          </button>
        ))}
      </div>
      <div className="panel" style={{ marginTop: 18, padding: 0 }}>
        {PRIORITIES.map((p) => {
          const r = pol[p.id];
          const mode = SEND_MODES.find((m) => m.id === r.mode);
          return (
            <div key={p.id} className="policy-row">
              <Prio p={p.id} label />
              <AnimatePresence mode="wait"><motion.span key={r.mode} className="chip" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>{mode.label}</motion.span></AnimatePresence>
              <span className="small muted trunc">{r.mode === 'batched' ? `Every ${r.interval} min` : r.mode === 'daily' ? `Daily at ${r.time}` : mode.desc}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ───────── step 6 ───────── */
function StepDigest({ d, patch }) {
  return (
    <>
      <h1 className="h1 ob-title">A morning <em>digest?</em></h1>
      <p className="lede ob-lede">Each weekday, every agent gets a summary of its open work in its inbox, plus reminders the day before a deadline.</p>
      <div className="panel col" style={{ gap: 0, padding: 0 }}>
        <div className="set-row split" style={{ padding: "20px 24px" }}>
          <div className="col" style={{ gap: 4 }}><span>Daily digest & deadline reminders</span><span className="small muted">Creates two automations you can edit or pause any time.</span></div>
          <Toggle on={d.digest.enabled} onChange={(v) => patch('digest', { enabled: v })} label="Daily digest" />
        </div>
        <AnimatePresence initial={false}>
          {d.digest.enabled && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={smooth} style={{ overflow: 'hidden' }}>
              <div className="set-row split" style={{ padding: "20px 24px", borderTop: '1px solid var(--line)' }}>
                <div className="col" style={{ gap: 4 }}><span>Send at</span><span className="small muted">{d.workspace.timezone.replace(/_/g, ' ')} · Mon–Fri</span></div>
                <input type="time" className="input" style={{ width: 130 }} value={d.digest.time} onChange={(e) => patch('digest', { time: e.target.value || '09:00' })} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

/* ───────── step 7 ───────── */
function StepBoard({ d, patch }) {
  return (
    <>
      <h1 className="h1 ob-title">Your first <em>board.</em></h1>
      <p className="lede ob-lede">Boards usually map to a repository. Agents see the repo with every task they pick up.</p>
      <div className="form-grid">
        <Field label="Board name"><input className="input lg" value={d.board.name} onChange={(e) => patch('board', { name: e.target.value })} placeholder="Web app" maxLength={80} /></Field>
        <Field label="Repository" hint="Optional — URL or org/repo"><input className="input lg" value={d.board.repo} onChange={(e) => patch('board', { repo: e.target.value })} placeholder="github.com/acme/web" maxLength={300} /></Field>
        <div className="full divider" style={{ margin: '8px 0' }} />
        <Field className="full" label="First task" hint={d.agents.length ? 'Auto-routed to the best-fit agent, following your sending preset.' : 'Lands in the backlog — add an agent to start working it.'}>
          <input className="input lg" value={d.task.title} onChange={(e) => patch('task', { title: e.target.value })} placeholder="e.g. Add rate limiting to the public API" maxLength={200} />
        </Field>
        <Field as="div" className="full" label="Priority">
          <Seg value={d.task.priority} onChange={(v) => patch('task', { priority: v })} options={PRIORITIES.map((p) => ({ value: p.id, label: p.label }))} />
        </Field>
      </div>
    </>
  );
}

/* ───────── finishing overlay ───────── */
function Finishing({ d }) {
  const lines = [`Creating ${d.workspace.name || 'workspace'}`, `Adding ${d.agents.length} agent${d.agents.length === 1 ? '' : 's'}`, `Setting up “${d.board.name}”`, 'Opening your board'];
  const [n, setN] = useState(0);
  useEffect(() => { const t = setInterval(() => setN((x) => Math.min(lines.length - 1, x + 1)), 380); return () => clearInterval(t); }, []); // eslint-disable-line
  return (
    <motion.div className="overlay" style={{ display: 'grid', placeItems: 'center', background: 'rgba(9,10,11,.92)', zIndex: 80 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
      <div className="col" style={{ alignItems: 'center', gap: 22 }}>
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.6, ease: EASE }}><LogoMark size={44} /></motion.div>
        <h2 className="h2">Setting the <em>stage.</em></h2>
        <div className="col" style={{ gap: 8, minWidth: 260 }}>
          {lines.map((l, i) => (
            <motion.div key={l} className="row" style={{ gap: 10, fontSize: 14 }} initial={{ opacity: 0, x: -6 }} animate={{ opacity: i <= n ? 1 : 0.25, x: 0 }} transition={{ duration: 0.3, delay: i * 0.05 }}>
              {i < n ? <Icon name="check" size={15} /> : i === n ? <Spinner /> : <span style={{ width: 15 }} />}
              <span>{l}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
