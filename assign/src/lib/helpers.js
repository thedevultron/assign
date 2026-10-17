export const STATUSES = [
  { id: 'backlog', label: 'Backlog', hint: 'Not sent yet' },
  { id: 'queued', label: 'Queued', hint: 'Sent to agent' },
  { id: 'in_progress', label: 'In progress', hint: 'Agent working' },
  { id: 'review', label: 'Review', hint: 'Needs your eyes' },
  { id: 'done', label: 'Done', hint: 'Shipped' },
];
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));

export const PRIORITIES = [
  { id: 'critical', label: 'Critical', bars: 4 },
  { id: 'high', label: 'High', bars: 3 },
  { id: 'medium', label: 'Medium', bars: 2 },
  { id: 'low', label: 'Low', bars: 1 },
];
export const PRIO_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

export const PROVIDERS = [
  { id: 'claude-code', label: 'Claude Code', short: 'CC', vendor: 'Anthropic' },
  { id: 'cursor', label: 'Cursor', short: 'CU', vendor: 'Anysphere' },
  { id: 'codex', label: 'Codex', short: 'CX', vendor: 'OpenAI' },
  { id: 'windsurf', label: 'Windsurf', short: 'WS', vendor: 'Windsurf' },
  { id: 'vscode', label: 'VS Code Copilot', short: 'VS', vendor: 'GitHub' },
  { id: 'gemini-cli', label: 'Gemini CLI', short: 'GE', vendor: 'Google' },
  { id: 'cline', label: 'Cline', short: 'CL', vendor: 'Cline' },
  { id: 'other', label: 'Other MCP client', short: '··', vendor: 'Any' },
];
export const providerLabel = (id, agent) => {
  if (id === 'other' && agent && String(agent.provider_label || '').trim()) return String(agent.provider_label).trim();
  return PROVIDERS.find((p) => p.id === id)?.label || 'MCP client';
};
export const providerShort = (id, agent) => {
  if (id === 'other' && agent && String(agent.provider_label || '').trim())
    return String(agent.provider_label).trim().split(/[\s_-]+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '··';
  return PROVIDERS.find((p) => p.id === id)?.short || '··';
};

// The six chromatic tokens — the only colours agents can wear.
export const AGENT_COLORS = ['#847dff', '#00b3dd', '#dd90d8', '#90b8f0', '#d1c9ff', '#4b49aa'];
export const COLOR_NAMES = { '#847dff': 'Iris', '#00b3dd': 'Cyan', '#dd90d8': 'Orchid', '#90b8f0': 'Periwinkle', '#d1c9ff': 'Pale iris', '#4b49aa': 'Deep iris' };
export const inkOn = (hex) => (['#4b49aa', '#847dff'].includes(String(hex).toLowerCase()) ? '#ffffff' : '#0b0b0c');

export const AUTOMATION_KINDS = [
  { id: 'daily_digest', label: 'Daily digest', desc: 'Send each agent a summary of their open work.' },
  { id: 'dispatch_batch', label: 'Batch send', desc: 'Send waiting backlog tasks to their agents.' },
  { id: 'deadline_reminder', label: 'Deadline reminder', desc: 'Ping agents about tasks due soon or overdue.' },
  { id: 'stale_nudge', label: 'Stale check-in', desc: 'Nudge agents on tasks that went quiet.' },
];
export const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const rid = (p) => p + Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10);

export function relTime(iso, nowMs = Date.now()) {
  if (!iso) return '';
  const diff = Date.parse(iso) - nowMs;
  const abs = Math.abs(diff);
  const m = 60e3, h = 60 * m, d = 24 * h;
  const fmt = (n, u) => `${n}${u}`;
  let s;
  if (abs < 45e3) return 'just now';
  if (abs < h) s = fmt(Math.round(abs / m), 'm');
  else if (abs < d) s = fmt(Math.round(abs / h), 'h');
  else if (abs < 30 * d) s = fmt(Math.round(abs / d), 'd');
  else return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return diff < 0 ? `${s} ago` : `in ${s}`;
}

export function dueLabel(iso) {
  if (!iso) return null;
  const diff = Date.parse(iso) - Date.now();
  const h = diff / 3600e3;
  if (diff < 0) return { text: `Overdue ${relTime(iso).replace(' ago', '')}`, tone: 'overdue' };
  if (h < 24) return { text: `Due ${relTime(iso)}`, tone: 'soon' };
  const d = new Date(iso);
  return { text: `Due ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, tone: 'later' };
}

export const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

export function isOnline(agent) {
  return !!agent?.last_seen_at && Date.now() - Date.parse(agent.last_seen_at) < 5 * 60e3;
}

export function sortTasks(list) {
  return [...list].sort((a, b) => a.position - b.position || PRIO_RANK[a.priority] - PRIO_RANK[b.priority]);
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

export const cx = (...a) => a.filter(Boolean).join(' ');

export function resizeImage(file, size = 160) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/webp', 0.86));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export const taskKey = (settings, t) => `${settings?.key_prefix || 'ASG'}-${t?.number ?? '…'}`;
export const initials = (name = '') => name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
export const guessTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
export const TIMEZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles']; } })();
export function greeting(tz) {
  let h = new Date().getHours();
  try { h = +new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(new Date()); } catch {}
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export const SEND_MODES = [
  { id: 'instant', label: 'Instant', desc: 'Sent the moment it’s created' },
  { id: 'batched', label: 'Batched', desc: 'Grouped and sent on an interval' },
  { id: 'daily', label: 'Daily', desc: 'Sent once a day at a set time' },
  { id: 'manual', label: 'Manual', desc: 'Waits until you press Start' },
];
export const POLICY_PRESETS = {
  fast: { critical: { mode: 'instant', interval: 15, time: '09:00' }, high: { mode: 'instant', interval: 15, time: '09:00' }, medium: { mode: 'instant', interval: 30, time: '09:00' }, low: { mode: 'batched', interval: 60, time: '09:00' } },
  balanced: { critical: { mode: 'instant', interval: 15, time: '09:00' }, high: { mode: 'batched', interval: 30, time: '09:00' }, medium: { mode: 'daily', interval: 60, time: '09:30' }, low: { mode: 'manual', interval: 240, time: '17:00' } },
  hands_on: { critical: { mode: 'manual', interval: 15, time: '09:00' }, high: { mode: 'manual', interval: 30, time: '09:00' }, medium: { mode: 'manual', interval: 60, time: '09:30' }, low: { mode: 'manual', interval: 240, time: '17:00' } },
};
export const PRESET_META = {
  fast: { label: 'Fast', title: 'Full speed', desc: 'Almost everything goes out instantly. Best when agents run unattended.' },
  balanced: { label: 'Balanced', title: 'Balanced', desc: 'Urgent work goes now, the rest is batched or daily. A good default.' },
  hands_on: { label: 'Hands-on', title: 'Hands-on', desc: 'Nothing is sent until you press Start. Maximum control.' },
};
export const AGENT_NAMES = ['Nova', 'Atlas', 'Sable', 'Orion', 'Vega', 'Lyra', 'Echo', 'Juno', 'Rook', 'Iris', 'Kepler', 'Wren'];
export const ROLE_PRESETS = ['Full-stack engineer', 'Frontend engineer', 'Backend engineer', 'Tests & QA', 'Docs writer', 'DevOps & CI', 'Refactoring', 'Code reviewer'];
export const toHandle = (name = '') => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').slice(0, 24) || 'agent';

const CLIENT_MATCH = { 'claude-code': /claude[-\s]?code|^claude$/i, cursor: /cursor/i, codex: /codex/i, windsurf: /windsurf|codeium|cascade/i, vscode: /visual studio code|vscode|copilot/i, 'gemini-cli': /gemini/i, cline: /cline|roo/i };
/** Mirror of server detectProvider(): MCP clientInfo.name → provider id. */
export function detectProvider(clientName = '') {
  const n = String(clientName || '');
  if (!n || /mcp-remote/i.test(n)) return null;
  for (const [k, re] of Object.entries(CLIENT_MATCH)) if (re.test(n)) return k;
  return 'other';
}
export const clientMismatch = (a) => { const d = detectProvider(a?.client_name); return !!(d && d !== a.provider && a.provider !== 'other'); };
