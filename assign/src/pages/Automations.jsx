import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Icon from '../components/Icon.jsx';
import { AvatarStack, Toggle, EmptyState, Button, Prio, IconBtn, useNow, EASE, EASE_OUT } from '../components/ui.jsx';
import { KIND_ICON } from '../components/AutomationEditor.jsx';
import { policyText } from '../components/TaskComposer.jsx';
import { useStore } from '../lib/store.js';
import { AUTOMATION_KINDS, DAYS, PRIORITIES, SEND_MODES, relTime } from '../lib/helpers.js';

const TEMPLATES = [
  { name: 'Morning digest', kind: 'daily_digest', time: '09:00', days: [1, 2, 3, 4, 5], priorities: ['critical', 'high', 'medium', 'low'] },
  { name: 'Friday wrap-up', kind: 'daily_digest', time: '16:30', days: [5], priorities: ['critical', 'high', 'medium', 'low'] },
  { name: 'Overnight batch', kind: 'dispatch_batch', time: '22:00', days: [0, 1, 2, 3, 4, 5, 6], priorities: ['low', 'medium'] },
  { name: 'Critical watch', kind: 'deadline_reminder', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6], priorities: ['critical'], params: { hours: 12 } },
  { name: 'Stale check-in', kind: 'stale_nudge', time: '14:00', days: [1, 2, 3, 4, 5], priorities: ['critical', 'high', 'medium'], params: { hours: 6 } },
];

export default function Automations() {
  const automations = useStore((s) => s.automations);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const { setUI, saveAutomation, deleteAutomation, runAutomation } = useStore.getState();
  const [running, setRunning] = useState(null);
  const now = useNow(30000);
  const run = async (id) => { setRunning(id); await runAutomation(id); setTimeout(() => setRunning(null), 600); };

  return (
    <div className="page">
      <motion.div className="page-head" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE }}>
        <div className="grow">
          <span className="label">{automations.filter((a) => a.enabled).length} running · {settings?.timezone?.replace(/_/g, ' ')}</span>
          <h1 className="h1">Work on <em>autopilot.</em></h1>
          <p className="lede" style={{ marginTop: 14, maxWidth: 620 }}>Digests, batch sends, deadline reminders and check-ins — delivered to each agent’s MCP inbox, and its webhook if one is set.</p>
        </div>
        <Button onClick={() => setUI({ automationEditor: {} })}>New automation</Button>
      </motion.div>

      {automations.length === 0 ? (
        <div className="panel"><EmptyState icon="automations" title={<>Nothing on <em>autopilot</em> yet.</>} body="Start with a morning digest so every agent knows what’s on its plate." action={<Button onClick={() => setUI({ automationEditor: { preset: TEMPLATES[0] } })}>Create a digest</Button>} /></div>
      ) : (
        <div className="list">
          <AnimatePresence initial={false}>
            {automations.map((a, i) => {
              const targets = a.agent_ids?.length ? agents.filter((x) => a.agent_ids.includes(x.id)) : agents;
              return (
                <motion.div key={a.id} layout className="list-row auto-row" initial={{ opacity: 0, y: 12 }} animate={{ opacity: a.enabled ? 1 : 0.55, y: 0 }} exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }} transition={{ duration: 0.45, ease: EASE_OUT, delay: i * 0.03 }}>
                  <motion.span className="sys-ico" style={{ width: 40, height: 40 }} animate={running === a.id ? { scale: [1, 0.9, 1] } : { scale: 1 }} transition={{ duration: 0.4 }}><Icon name={KIND_ICON[a.kind]} size={18} /></motion.span>
                  <button className="col grow" style={{ minWidth: 0, gap: 4, textAlign: 'left' }} onClick={() => setUI({ automationEditor: { automation: a } })}>
                    <span className="row" style={{ gap: 12, alignItems: 'baseline' }}><span className="serif" style={{ fontSize: 26, color: '#fff', lineHeight: 1 }}>{a.time}</span><span className="trunc" style={{ color: '#fff' }}>{a.name}</span></span>
                    <span className="label">{AUTOMATION_KINDS.find((k) => k.id === a.kind)?.label} · {a.last_run_at ? `ran ${relTime(a.last_run_at, now)}` : 'never run'} · {a.run_count || 0} runs</span>
                  </button>
                  <div className="col hide-sm" style={{ gap: 8 }}>
                    <div className="days mini">{DAYS.map((d, k) => <span key={k} className={a.days?.includes(k) ? 'on' : ''}>{d}</span>)}</div>
                    <div className="row" style={{ gap: 8 }}>{PRIORITIES.filter((p) => a.priorities?.includes(p.id)).map((p) => <Prio key={p.id} p={p.id} />)}</div>
                  </div>
                  <div className="row hide-sm" style={{ gap: 10, minWidth: 150 }}>
                    {targets.length ? <AvatarStack agents={targets} size={24} max={4} /> : null}
                    <span className="label">{a.agent_ids?.length ? `${targets.length} agents` : 'All agents'}</span>
                  </div>
                  <div className="row" style={{ gap: 2 }}>
                    <IconBtn name="play" label="Run now" onClick={() => run(a.id)} />
                    <IconBtn name="edit" label="Edit" className="hide-sm" onClick={() => setUI({ automationEditor: { automation: a } })} />
                    <IconBtn name="trash" label="Delete" onClick={() => deleteAutomation(a.id)} />
                    <span style={{ width: 8 }} />
                    <Toggle on={a.enabled} onChange={(v) => saveAutomation({ id: a.id, enabled: v })} label={`${a.name} enabled`} />
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <section className="grid-2" style={{ gridTemplateColumns: '1.4fr 1fr', alignItems: 'start' }}>
        <div>
          <div className="section-head"><span className="h3">Templates</span></div>
          <div className="tpl-grid">
            {TEMPLATES.map((t, i) => (
              <motion.button key={t.name} className="tpl" onClick={() => setUI({ automationEditor: { preset: t } })} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8, ease: EASE, delay: i * 0.06 }}>
                <Icon name={KIND_ICON[t.kind]} size={18} />
                <span style={{ color: '#fff' }}>{t.name}</span>
                <span className="label">{t.time} · {t.days.length === 7 ? 'Every day' : t.days.length === 5 ? 'Weekdays' : t.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}</span>
                <span className="small link" style={{ marginTop: 'auto' }}>Use template <span className="arr">→</span></span>
              </motion.button>
            ))}
          </div>
        </div>
        <div>
          <div className="section-head"><span className="h3">Send rules</span><span className="spacer" /><a className="link small" href="#/settings/sending">Edit →</a></div>
          <div className="panel" style={{ padding: '4px 22px' }}>
            {PRIORITIES.map((p) => (
              <div key={p.id} className="policy-row" style={{ gridTemplateColumns: '120px 90px 1fr' }}>
                <Prio p={p.id} label />
                <span className="chip">{SEND_MODES.find((m) => m.id === settings?.policy?.[p.id]?.mode)?.label}</span>
                <span className="small muted trunc">{policyText(settings, p.id)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
