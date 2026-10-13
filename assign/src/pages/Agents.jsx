import { useState } from 'react';
import { motion } from 'motion/react';
import Icon from '../components/Icon.jsx';
import { Avatar, Toggle, Button, IconBtn, EmptyState, Tip, useNow, EASE, EASE_OUT } from '../components/ui.jsx';
import { useStore } from '../lib/store.js';
import { api } from '../lib/api.js';
import RunnersPanel from '../components/RunnersPanel.jsx';
import { isOnline, providerLabel, providerShort, relTime, PROVIDERS, clientMismatch, detectProvider } from '../lib/helpers.js';

export function downloadSkill(agent) {
  return api.download(`/agents/${agent.id}/skill.zip`, `assign-${agent.handle}-skill.zip`)
    .then(() => useStore.getState().toast(`Downloaded ${agent.name}’s skill`))
    .catch((e) => useStore.getState().fail(e));
}

function AgentCard({ a, i, now }) {
  const tasks = useStore((s) => s.tasks);
  const requirePairing = useStore((s) => s.settings?.require_pairing !== false);
  const { setUI, saveAgent } = useStore.getState();
  const [dl, setDl] = useState(false);
  const mine = tasks.filter((t) => t.assignee_id === a.id);
  const active = mine.filter((t) => t.status === 'queued' || t.status === 'in_progress').length;
  const review = mine.filter((t) => t.status === 'review').length;
  const done = mine.filter((t) => t.status === 'done').length;
  const online = isOnline(a);
  const mismatch = clientMismatch(a);
  const cur = mine.find((t) => t.status === 'in_progress');
  const needsPair = requirePairing && !a.paired;
  const status = a.paused ? 'Paused' : online ? (cur ? `Working · ${cur.progress || 0}%` : 'Online') : a.last_seen_at ? `Seen ${relTime(a.last_seen_at, now)}` : 'Never connected';
  return (
    <motion.article className="agent-card" layout initial={{ opacity: 0, y: 24 }} animate={{ opacity: a._pending ? 0.6 : 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: i * 0.05 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
        <button onClick={() => setUI({ agentEditor: { agent: a } })} aria-label={`Edit ${a.name}`} style={{ borderRadius: 9999 }}><Avatar agent={a} size={52} status /></button>
        <div className="col grow" style={{ minWidth: 0, gap: 4 }}>
          <button className="serif" style={{ fontSize: 28, lineHeight: 1, color: 'var(--t-head)', textAlign: 'left' }} onClick={() => setUI({ agentEditor: { agent: a } })}>{a.name}</button>
          <span className="small muted trunc">{a.role || 'No role yet'}</span>
        </div>
        <Tip label={a.paused ? 'Resume agent' : 'Pause agent'}><span><Toggle on={!a.paused} onChange={(v) => saveAgent({ id: a.id, paused: !v })} label={`${a.name} active`} /></span></Tip>
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="chip solid">{providerLabel(a.provider)}</span>
        <span className="chip mono" style={{ fontSize: 10.5 }}>assign-{a.handle}</span>
        <span className={`chip ${online && !a.paused ? 'ok' : ''}`}>{status}</span>
        {needsPair ? <button className="chip iris" onClick={() => setUI({ connectAgentId: a.id })}><Icon name="lock" size={11} />{a.pair_pending ? 'Enter pairing code' : 'Not paired'}</button> : null}
      </div>
      {mismatch ? (
        <div className="warnbox" style={{ padding: '10px 12px', fontSize: 12.5 }}>
          <Icon name="alert" size={14} style={{ flex: 'none', marginTop: 2 }} />
          <span>Connected from <b style={{ fontWeight: 400, color: '#fff' }}>{a.client_name}</b>, but set up for {providerLabel(a.provider)}. <button className="link" onClick={() => saveAgent({ id: a.id, provider: detectProvider(a.client_name) })}>Switch to {providerLabel(detectProvider(a.client_name))}</button></span>
        </div>
      ) : null}
      <div className="ac-meta">
        <div><span className="label">Active</span><div className="v">{active}<span className="tiny muted"> / {a.max_concurrent}</span></div></div>
        <div><span className="label">Review</span><div className="v">{review}</div></div>
        <div><span className="label">Shipped</span><div className="v">{done}</div></div>
      </div>
      {a.skills?.length ? <div className="row wrap" style={{ gap: 6 }}>{a.skills.slice(0, 5).map((s) => <span key={s} className="chip">{s}</span>)}{a.skills.length > 5 ? <span className="chip">+{a.skills.length - 5}</span> : null}</div> : null}
      <div className="row" style={{ gap: 6, marginTop: 'auto' }}>
        <Button size="sm" onClick={() => setUI({ connectAgentId: a.id })}>{a.last_seen_at ? 'Connection' : 'Connect'}</Button>
        <Button size="sm" variant="ghost" arrow={false} loading={dl} onClick={async () => { setDl(true); await downloadSkill(a); setDl(false); }}><Icon name="download" size={14} />Skill</Button>
        <span className="spacer" />
        <IconBtn name="plus" label={`Assign a task to ${a.name}`} onClick={() => setUI({ composer: { initial: { assignee_id: a.id } } })} />
        <IconBtn name="edit" label="Edit agent" onClick={() => setUI({ agentEditor: { agent: a } })} />
      </div>
    </motion.article>
  );
}

export default function Agents() {
  const agents = useStore((s) => s.agents);
  const setUI = useStore((s) => s.setUI);
  const now = useNow(30000);
  const groups = PROVIDERS.map((p) => ({ p, list: agents.filter((a) => a.provider === p.id) })).filter((g) => g.list.length);
  const multiSameTool = groups.some((g) => g.list.length > 1);
  let i = 0;
  return (
    <div className="page">
      <motion.div className="page-head" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE }}>
        <div className="grow">
          <span className="label">{agents.length} agent{agents.length === 1 ? '' : 's'} · {groups.length} tool{groups.length === 1 ? '' : 's'}</span>
          <h1 className="h1">Your coding <em>agents.</em></h1>
          <p className="lede" style={{ marginTop: 14, maxWidth: 640 }}>Every seat gets its own token, MCP key and branch prefix.</p>
        </div>
        <Button onClick={() => setUI({ agentEditor: {} })}>Add agent</Button>
      </motion.div>

      {agents.length === 0 ? (
        <div className="panel"><EmptyState icon="robot" title={<>No agents <em>yet.</em></>} body="An agent is one seat in a coding tool — a Claude Code session, a Cursor window, a Codex CLI. Add one per seat." action={<Button onClick={() => setUI({ agentEditor: {} })}>Add your first agent</Button>} /></div>
      ) : (
        groups.map(({ p, list }) => (
          <section key={p.id} className="provider-group">
            <div className="section-head">
              <span className="tm-sm">{providerShort(p.id)}</span>
              <span className="h3">{p.label}</span>
              <span className="label">{list.length} agent{list.length === 1 ? '' : 's'}</span>
              <span className="spacer" />
              <Button variant="quiet" size="sm" arrow={false} onClick={() => setUI({ agentEditor: { initial: { provider: p.id } } })}><Icon name="plus" size={14} />Add to {p.label}</Button>
            </div>
            <div className="agent-grid">{list.map((a) => <AgentCard key={a.id} a={a} i={i++} now={now} />)}</div>
          </section>
        ))
      )}

      <RunnersPanel />

      <motion.section className="grid-3" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 1.2, ease: EASE }}>
        {[
          ['key', 'Separate identities', 'Every agent authenticates with its own token. The board always knows exactly who is calling.'],
          ['target', 'Atomic claims', 'Claims are compare-and-swap in one transaction. Two agents racing for a task — one wins, the other moves on.'],
          ['branch', 'Own branches', `Agents work on <handle>/<key>-<slug>. ${multiSameTool ? 'Several agents in one tool? Give each its own git worktree.' : 'Add a git worktree per agent for full isolation.'}`],
        ].map(([ic, t, d]) => (
          <div key={t} className="panel tight col" style={{ gap: 12 }}>
            <Icon name={ic} size={20} />
            <span className="h4">{t}</span>
            <span className="small muted">{d}</span>
          </div>
        ))}
      </motion.section>
    </div>
  );
}
