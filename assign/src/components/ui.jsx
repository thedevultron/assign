import { useEffect, useLayoutEffect, useRef, useState, useId, useCallback, cloneElement } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import Icon from './Icon.jsx';
import { cx, initials, inkOn, PRIORITIES, isOnline } from '../lib/helpers.js';
import SquishSwitch from '@/components/reactbits/SquishSwitch';
import RubberSegment from '@/components/reactbits/RubberSegment';
import WarmTooltip, { WarmTooltipGroup } from '@/components/reactbits/WarmTooltip';
import HoldButton from '@/components/reactbits/HoldButton';
export { WarmTooltipGroup };
import { CopyButton as AUCopyButton } from '@/components/animate-ui/components/buttons/copy';
import { SlidingNumber } from '@/components/animate-ui/primitives/texts/sliding-number';

/* Motion language: 0.2s ease for state, 2.5s cubic-bezier for reveals. No springs. */
export const EASE = [0.455, 0.03, 0.515, 0.955];
export const EASE_OUT = [0.22, 0.61, 0.36, 1];
export const quick = { duration: 0.2, ease: 'easeOut' };
export const smooth = { duration: 0.42, ease: EASE_OUT };
export const reveal = { duration: 2.5, ease: EASE };

/* ─────────── logo ─────────── */
export function LogoMark({ size = 26 }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#fff" />
      <rect x="7" y="8" width="5" height="16" rx="1.5" fill="#0f1011" />
      <rect x="13.5" y="8" width="5" height="10" rx="1.5" fill="#0f1011" />
      <rect x="20" y="8" width="5" height="6" rx="1.5" fill="#847dff" />
    </svg>
  );
}
export function Wordmark({ size = 26 }) {
  return <span className="wordmark"><LogoMark size={size} /><span className="hide-c">assign</span></span>;
}

/* ─────────── buttons ─────────── */
export function Button({ variant = 'primary', size, arrow, loading, block, className, children, type = 'button', ...rest }) {
  const showArrow = arrow ?? variant === 'primary';
  return (
    <button type={type} className={cx('btn', `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className)} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" /> : null}
      {children}
      {showArrow && !loading ? <span className="arr">{typeof arrow === 'string' ? arrow : '→'}</span> : null}
    </button>
  );
}

export function IconBtn({ name, label, size = 18, className, tip = true, side = 'bottom', ...rest }) {
  const btn = (
    <button type="button" aria-label={label} className={cx('icon-btn', className)} {...rest}>
      <Icon name={name} size={size} />
    </button>
  );
  return tip && label ? <Tip label={label} side={side}>{btn}</Tip> : btn;
}

/* ─────────── avatar ─────────── */
export function Avatar({ agent, size = 32, status = false, className, title }) {
  const [pet, setPet] = useState(0);
  if (!agent) {
    return <span className={cx('avatar', className)} style={{ width: size, height: size, background: '#2e2e2e', color: '#9f9fa0', fontSize: size * 0.34 }} title={title || 'Unassigned'}><Icon name="user" size={size * 0.5} /></span>;
  }
  const online = isOnline(agent);
  return (
    <motion.span className={cx('avatar', status && online && !agent.paused && 'online', agent.paused && 'paused', pet && 'petting', className)}
      key={pet}
      onClick={() => setPet((p) => p + 1)}
      style={{ width: size, height: size, background: agent.avatar ? 'transparent' : agent.color, color: inkOn(agent.color), fontSize: Math.max(9, size * 0.34) }}
      title={title || agent.name}>
      {agent.avatar ? <img src={agent.avatar} alt="" /> : initials(agent.name)}
      {status ? <span className="st" /> : null}
    </motion.span>
  );
}

export function AvatarStack({ agents, size = 26, max = 5 }) {
  const shown = agents.slice(0, max);
  return (
    <div className="avatar-stack">
      {shown.map((a, i) => (
        <motion.span key={a.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ ...smooth, delay: i * 0.05 }} whileHover={{ y: -3, transition: quick }}>
          <Tip label={`${a.name} · @${a.handle}`}><span><Avatar agent={a} size={size} /></span></Tip>
        </motion.span>
      ))}
      {agents.length > max ? <span className="avatar" style={{ width: size, height: size, background: '#2e2e2e', color: '#fff', fontSize: 10 }}>+{agents.length - max}</span> : null}
    </div>
  );
}

export function Prio({ p, label }) {
  const def = PRIORITIES.find((x) => x.id === p) || PRIORITIES[2];
  return (
    <span className="row" style={{ gap: 7 }} title={`${def.label} priority`}>
      <span className={cx('prio', p)}>{[1, 2, 3, 4].map((i) => <i key={i} className={i <= def.bars ? 'on' : ''} />)}</span>
      {label ? <span className="label" style={{ color: 'var(--t-body)' }}>{def.label}</span> : null}
    </span>
  );
}

/* ─────────── switch (animate-ui) ─────────── */
export function Toggle({ on, onChange, label, disabled }) {
  return (
    <SquishSwitch checked={!!on} onChange={(v) => onChange?.(v)} disabled={disabled} ariaLabel={label}
      width={40} height={24} trackColor="#3f4041" trackOnColor="#ffffff" thumbColor="#cacaca" thumbOnColor="#0f1011" colorDuration={200} />
  );
}

/* ─────────── segmented ─────────── */
export function Seg({ options, value, onChange, block, className, size }) {
  const items = options.map((o) => ({ value: String(o.value), label: o.label, icon: o.icon }));
  return (
    <span className={cx('rs-wrap', block && 'rs-block', className)}>
      <RubberSegment items={items} value={String(value)} onChange={(v) => { const o = options.find((x) => String(x.value) === v); if (o) onChange(o.value); }}
        size={size === 'sm' ? 'sm' : 'md'} radius={8} inset={3} trackColor="#151617" thumbColor="#ffffff" textColor="#cacaca" activeTextColor="#0b0b0c"
        equalSlots={!!block} stretch={70} squash={2} glide={60} className={block ? 'rs-track-block' : ''} />
    </span>
  );
}

/* ─────────── hooks ─────────── */
export function useClickOutside(ref, fn, active = true) {
  useEffect(() => {
    if (!active) return;
    const on = (e) => { if (ref.current && !ref.current.contains(e.target)) fn(e); };
    document.addEventListener('pointerdown', on);
    return () => document.removeEventListener('pointerdown', on);
  }, [ref, fn, active]);
}
export function useNow(interval = 30000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), interval); return () => clearInterval(t); }, [interval]);
  return n;
}

/* ─────────── select ─────────── */
export function Select({ value, onChange, options, placeholder = 'Select…', renderValue, up, right, className, disabled }) {
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);
  const cur = options.find((o) => o.value === value);
  useEffect(() => { if (open) setHl(Math.max(0, options.findIndex((o) => o.value === value))); }, [open]); // eslint-disable-line
  const onKey = (e) => {
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(options.length - 1, h + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(0, h - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); const o = options[hl]; if (o) { onChange(o.value); setOpen(false); } }
  };
  return (
    <div className={cx('menu-wrap', className)} ref={ref}>
      <button type="button" className={cx('trigger', open && 'open')} onClick={() => !disabled && setOpen((o) => !o)} onKeyDown={onKey} aria-haspopup="listbox" aria-expanded={open} disabled={disabled}>
        {cur ? (renderValue ? renderValue(cur) : <>{cur.icon}<span className="trunc">{cur.label}</span></>) : <span className="muted">{placeholder}</span>}
        <Icon name="chevron" size={16} className="chev" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className={cx('menu', up && 'up', right && 'right')} role="listbox" initial={{ opacity: 0, y: up ? 6 : -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: up ? 4 : -4, transition: { duration: 0.12 } }} transition={quick}>
            {options.map((o, i) => (
              <button key={String(o.value)} type="button" role="option" aria-selected={o.value === value} className={cx('menu-item', i === hl && 'hl')} onMouseEnter={() => setHl(i)} onClick={() => { onChange(o.value); setOpen(false); }}>
                {o.icon}<span className="trunc">{o.label}</span>{o.sub ? <span className="sub">{o.sub}</span> : null}
                {o.value === value ? <Icon name="check" size={15} style={{ marginLeft: o.sub ? 8 : 'auto' }} /> : null}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* dropdown menu for actions */
export function Menu({ trigger, items, right = true, up = false, width = 200 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div className="menu-wrap" ref={ref}>
      {typeof trigger === 'function'
        ? trigger({ open, toggle: () => setOpen((o) => !o) })
        : cloneElement(trigger, { onClick: (e) => { e.stopPropagation(); setOpen((o) => !o); }, 'aria-expanded': open })}
      <AnimatePresence>
        {open && (
          <motion.div className={cx('menu', right && 'right', up && 'up')} style={{ minWidth: width }} initial={{ opacity: 0, y: up ? 6 : -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }} transition={quick}>
            {items.filter(Boolean).map((it, i) => it === '-' || it === 'sep' ? <div key={i} className="menu-sep" /> : (
              <button key={i} type="button" className={cx('menu-item', it.danger && 'danger')} onClick={() => { setOpen(false); it.onClick(); }}>
                {it.icon ? <Icon name={it.icon} size={16} /> : null}{it.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─────────── tags ─────────── */
export function TagsInput({ value = [], onChange, placeholder = 'Type and press Enter' }) {
  const [v, setV] = useState('');
  const add = () => { const t = v.trim().replace(/,$/, ''); if (t && !value.includes(t)) onChange([...value, t]); setV(''); };
  return (
    <div className="tags-input" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
      <AnimatePresence initial={false}>
        {value.map((t) => (
          <motion.span key={t} className="chip" layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={quick}>
            {t}<button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}><Icon name="close" size={11} /></button>
          </motion.span>
        ))}
      </AnimatePresence>
      <input value={v} placeholder={value.length ? '' : placeholder} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !v && value.length) onChange(value.slice(0, -1)); }}
        onBlur={add} />
    </div>
  );
}

/* ─────────── overlays ─────────── */
function useEsc(open, onClose) {
  useEffect(() => {
    if (!open) return;
    const on = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [open, onClose]);
}
export function Modal({ open, onClose, children, wide, label }) {
  useEsc(open, onClose);
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="ov" className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <div className="modal-pos" key="pos">
            <motion.div className={cx('modal', wide && 'wide')} role="dialog" aria-modal="true" aria-label={label}
              initial={{ opacity: 0, y: 16, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.99, transition: { duration: 0.15 } }} transition={smooth}>
              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
export function Drawer({ open, onClose, children, label }) {
  useEsc(open, onClose);
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="ov" className="overlay" style={{ background: 'rgba(5,5,6,.45)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.aside key="dr" className="drawer" role="dialog" aria-label={label} initial={{ x: '104%' }} animate={{ x: 0 }} exit={{ x: '104%', transition: { duration: 0.22, ease: EASE } }} transition={{ duration: 0.45, ease: EASE_OUT }}>
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* tooltip */
export function Tip({ label, children, side = 'bottom', disabled, block }) {
  if (!label) return children;
  return (
    <WarmTooltip content={label} side={side} disabled={!!disabled} size="sm" radius={8} gap={8} surfaceColor="#cacaca" inkColor="#0b0b0c" popDuration={180} className={block ? 'wt-block' : ''}>
      {children}
    </WarmTooltip>
  );
}

/** Hold-to-confirm for destructive actions (react-bits Hold Button). */
export function HoldConfirm({ children = 'Hold to delete', doneLabel = 'Deleted', onConfirm, size = 'sm', holdTime = 1100, icon = 'trash', className, disabled, resetAfter }) {
  return (
    <span className={cx('hold-wrap', className)}>
      <HoldButton size={size} radius={8} holdTime={holdTime} backgroundColor="rgba(229,72,77,0.10)" fillColor="#e5484d" textColor="#ff8b8f" fillTextColor="#ffffff"
        icon={icon ? <Icon name={icon} size={14} /> : undefined} doneLabel={doneLabel} glow={false} wave disabled={disabled} resetAfter={resetAfter} onHold={onConfirm}>{children}</HoldButton>
    </span>
  );
}

export function AnimatedNumber({ value, className, decimals = 0 }) {
  return <SlidingNumber number={Number(value) || 0} className={className} decimalPlaces={decimals} />;
}

/* ─────────── copy (animate-ui) ─────────── */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }
}
export function CopyButton({ text, label = 'Copy', className, size = 'sm' }) {
  const [copied, setCopied] = useState(false);
  const onClick = async (e) => {
    e.stopPropagation();
    const ok = await copyText(text);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
  };
  return (
    <Tip label={copied ? 'Copied' : label}>
      <span><AUCopyButton content="" copied={copied} onClick={onClick} variant="ghost" size={size} aria-label={label}
        className={cx('text-[#9f9fa0] hover:text-white hover:bg-white/10 rounded-[8px] cursor-pointer', className)} /></span>
    </Tip>
  );
}

/* ─────────── code block ─────────── */
function highlight(code, lang) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const wrap = (cls, s) => `<span class="${cls}">${esc(s)}</span>`;
  // single pass over the raw text so inserted markup is never re-matched
  const STR = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/.source;
  let re, fn;
  if (lang === 'json') { re = new RegExp(`(${STR})(\\s*:)?`, 'g'); fn = (m, s, c) => (c ? wrap('tok-k', s) + c : wrap('tok-s', s)); }
  else if (lang === 'toml') { re = new RegExp(`(^\\[[^\\n]*\\]$)|(${STR})|(#[^\\n]*)`, 'gm'); fn = (m, k, s, c) => wrap(k ? 'tok-k' : s ? 'tok-s' : 'tok-c', m); }
  else if (lang === 'bash') { re = new RegExp(`(^[ \\t]*[A-Za-z_][\\w.-]*)|(${STR})|((?:^|(?<=\\s))#[^\\n]*)`, 'gm'); fn = (m, k, s, c) => wrap(k ? 'tok-k' : s ? 'tok-s' : 'tok-c', m); }
  else return esc(code);
  let out = '', last = 0;
  code.replace(re, (...a) => { const m = a[0], at = a[a.length - 2]; out += esc(code.slice(last, at)) + fn(...a.slice(0, -2)); last = at + m.length; return m; });
  return out + esc(code.slice(last));
}
export function CodeBlock({ code, lang = 'bash', title }) {
  return (
    <div className="code">
      <div className="code-head"><span className="label grow trunc">{title || lang}</span><CopyButton text={code} /></div>
      <pre dangerouslySetInnerHTML={{ __html: highlight(code, lang) }} />
    </div>
  );
}

/* ─────────── misc ─────────── */
export function Spinner() { return <span className="spinner" />; }

export function EmptyState({ icon = 'sparkles', title, body, action }) {
  return (
    <motion.div className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={smooth}>
      <div className="glyph"><Icon name={icon} size={24} /></div>
      <div className="h3" style={{ maxWidth: 460 }}>{title}</div>
      {body ? <p className="muted" style={{ margin: 0, maxWidth: 440 }}>{body}</p> : null}
      {action}
    </motion.div>
  );
}

/** 'borderTurn' — a single light segment tracing a rounded border. */
export function BorderTrace({ radius = 16, duration = 6 }) {
  const ref = useRef(null);
  const [len, setLen] = useState(1000);
  useLayoutEffect(() => {
    const r = ref.current?.querySelector('rect');
    if (r && r.getTotalLength) { try { setLen(r.getTotalLength()); } catch {} }
  }, []);
  return (
    <svg ref={ref} className="trace" width="100%" height="100%" aria-hidden>
      <rect x="0.5" y="0.5" width="calc(100% - 1px)" height="calc(100% - 1px)" rx={radius} ry={radius} pathLength="1000" style={{ animationDuration: `${duration}s` }} />
    </svg>
  );
}

export function Field({ label, hint, children, className, right, as: Tag = 'label' }) {
  return (
    <Tag className={cx('field', className)} {...(Tag === 'label' ? {} : { role: 'group' })}>
      {label ? <span className="label">{label}{right ? <span style={{ marginLeft: 'auto' }}>{right}</span> : null}</span> : null}
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </Tag>
  );
}

export function useAsync() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn) => { setBusy(true); try { return await fn(); } finally { setBusy(false); } }, []);
  return [busy, run];
}

/** Product loader — a task card hops Backlog → In progress → Review → Done. Pure CSS, respects reduced motion. */
export function KanbanLoader({ label = 'Loading', size = 1 }) {
  return (
    <div className="kl" role="status" aria-label={label} style={{ '--kl-s': size }}>
      <div className="kl-board" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <span key={i} className="kl-col"><i /><i /></span>)}
        <span className="kl-card"><b /><b /></span>
      </div>
      <span className="label kl-label">{label}</span>
    </div>
  );
}
