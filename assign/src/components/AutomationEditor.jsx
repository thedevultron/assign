import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Icon from './Icon.jsx';
import { Modal, Avatar, Button, Toggle, Prio, Field, quick, EASE_OUT } from './ui.jsx';
import { useStore } from '../lib/store.js';
import { AUTOMATION_KINDS, DAYS, DAY_NAMES, PRIORITIES, cx } from '../lib/helpers.js';

export const KIND_ICON = { daily_digest: 'mail', dispatch_batch: 'send', deadline_reminder: 'clock', stale_nudge: 'bell' };
const blank = () => ({ name: '', kind: 'daily_digest', time: '09:00', days: [1, 2, 3, 4, 5], agent_ids: [], priorities: ['critical', 'high', 'medium', 'low'], params: { hours: 24 }, enabled: true });

export default function AutomationEditor() {
  const state = useStore((s) => s.ui.automationEditor);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const { setUI, saveAutomation, toast } = useStore.getState();
  const open = !!state;
  const editing = state?.automation;
  const [f, setF] = useState(blank);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(editing ? { ...blank(), ...editing, params: { hours: 24, ...(editing.params || {}) } } : { ...blank(), ...(state?.preset || {}) }); setErr(''); setBusy(false); } }, [open]); // eslint-disable-line
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const toggleIn = (k, v) => setF((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));
  const close = () => setUI({ automationEditor: null });
  const kind = AUTOMATION_KINDS.find((k) => k.id === f.kind);
  const submit = async (e) => {
    e.preventDefault();
    const name = f.name.trim() || kind.label;
    if (!f.days.length) { setErr('Pick at least one day'); return; }
    if (!f.priorities.length) { setErr('Pick at least one priority'); return; }
    setBusy(true);
    const { id, time, days, agent_ids, priorities, params, enabled } = f;
    try {
      await saveAutomation({ ...(editing ? { id } : {}), name, kind: f.kind, time, days, agent_ids, priorities, params, enabled });
      close();
      toast(editing ? 'Automation saved' : `“${name}” is live`, { tone: 'dispatch' });
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  const needsHours = f.kind === 'deadline_reminder' || f.kind === 'stale_nudge';
  const summary = `${f.days.length === 7 ? 'Every day' : f.days.length === 5 && [1, 2, 3, 4, 5].every((d) => f.days.includes(d)) ? 'Weekdays' : [...f.days].sort().map((d) => DAY_NAMES[d]).join(', ') || 'No days'} at ${f.time} · ${f.agent_ids.length ? `${f.agent_ids.length} agent${f.agent_ids.length === 1 ? '' : 's'}` : 'all agents'}`;
  return (
    <Modal open={open} onClose={close} wide label="Automation">
      <form onSubmit={submit}>
        <div className="modal-head">
          <span className="label">{editing ? 'Edit automation' : 'New automation'}</span>
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={close} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="modal-body">
          <input className="input title bare" placeholder={kind.label} value={f.name} onChange={set('name')} maxLength={80} autoFocus />
          <Field as="div" label="What it does">
            <div className="kind-pick">
              {AUTOMATION_KINDS.map((k) => (
                <button type="button" key={k.id} onClick={() => set('kind')(k.id)} className={f.kind === k.id ? 'on' : ''}>
                  {f.kind === k.id ? <motion.span layoutId="kind-hl" className="kind-hl" transition={{ duration: 0.28, ease: EASE_OUT }} /> : null}
                  <span className="col" style={{ position: 'relative', gap: 10 }}>
                    <Icon name={KIND_ICON[k.id]} size={18} />
                    <span>{k.label}</span>
                    <span className="small" style={{ opacity: 0.7, lineHeight: 1.45 }}>{k.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </Field>
          <div className="form-grid">
            <Field label="Time" hint={settings?.timezone ? `Workspace time · ${settings.timezone.replace(/_/g, ' ')}` : undefined}><input type="time" className="input" value={f.time} onChange={set('time')} required /></Field>
            <Field as="div" label="Days">
              <div className="days">{DAYS.map((d, i) => <button type="button" key={i} className={f.days.includes(i) ? 'on' : ''} onClick={() => toggleIn('days', i)} aria-pressed={f.days.includes(i)} aria-label={DAY_NAMES[i]}>{d}</button>)}</div>
            </Field>
            <Field as="div" className="full" label="Agents" right={<span className="tiny muted">{f.agent_ids.length ? `${f.agent_ids.length} selected` : 'All agents'}</span>}>
              <div className="row wrap" style={{ gap: 6 }}>
                {agents.length === 0 ? <span className="small muted">No agents yet — this will apply to every agent you add.</span> : agents.map((a) => {
                  const on = f.agent_ids.includes(a.id);
                  return (
                    <button type="button" key={a.id} onClick={() => toggleIn('agent_ids', a.id)} className={cx('pick-chip', on && 'on')} aria-pressed={on}>
                      <Avatar agent={a} size={20} />{a.name}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field as="div" className="full" label="Priorities included">
              <div className="row wrap" style={{ gap: 6 }}>
                {PRIORITIES.map((p) => (
                  <button type="button" key={p.id} onClick={() => toggleIn('priorities', p.id)} className={cx('pick-chip', f.priorities.includes(p.id) && 'on')} aria-pressed={f.priorities.includes(p.id)}>
                    <Prio p={p.id} />{p.label}
                  </button>
                ))}
              </div>
            </Field>
            <AnimatePresence initial={false}>
              {needsHours && (
                <motion.div className="full" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={quick} style={{ overflow: 'hidden' }}>
                  <Field label={f.kind === 'deadline_reminder' ? 'Remind when due within (hours)' : 'Nudge after quiet for (hours)'}>
                    <input type="number" min={1} max={720} className="input" style={{ maxWidth: 160 }} value={f.params.hours} onChange={(e) => setF((s) => ({ ...s, params: { ...s.params, hours: Math.max(1, Math.min(720, +e.target.value || 1)) } }))} />
                  </Field>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="full set-row split">
              <div className="col" style={{ gap: 2 }}><span>Enabled</span><span className="small muted">{summary}</span></div>
              <Toggle on={f.enabled} onChange={set('enabled')} label="Enabled" />
            </div>
          </div>
          <AnimatePresence>{err ? <motion.div className="err" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>{err}</motion.div> : null}</AnimatePresence>
        </div>
        <div className="modal-foot">
          <span className="small muted hide-sm">Delivered to each agent’s MCP inbox (and webhook, if set).</span>
          <span className="spacer" />
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" loading={busy}>{editing ? 'Save' : 'Create automation'}</Button>
        </div>
      </form>
    </Modal>
  );
}
