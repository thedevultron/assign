// Provider adapters. Every adapter takes a provider-neutral conversation and returns one
// model step: { text, thoughts, calls:[{id,name,args}], raw }.
//
// Neutral messages:
//   { role:'user', text }
//   { role:'assistant', text, calls:[{id,name,args}], raw:{ provider, content } }
//   { role:'tool', results:[{ id, name, result }] }
import crypto from 'node:crypto';

export const PROVIDERS = {
  google: { label: 'Google AI Studio', kind: 'google', base: 'https://generativelanguage.googleapis.com/v1beta', keyUrl: 'https://aistudio.google.com/apikey', placeholder: 'AIza…', voice: true, defaultModel: 'gemini-3.5-flash-lite' },
  openai: { label: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', placeholder: 'sk-…', effortParam: 'reasoning_effort' },
  anthropic: { label: 'Anthropic', kind: 'anthropic', base: 'https://api.anthropic.com/v1', keyUrl: 'https://console.anthropic.com/settings/keys', placeholder: 'sk-ant-…' },
  openrouter: { label: 'OpenRouter', kind: 'openai', base: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', placeholder: 'sk-or-…', effortParam: 'reasoning' },
  groq: { label: 'Groq', kind: 'openai', base: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', placeholder: 'gsk_…', effortParam: 'reasoning_effort' },
  xai: { label: 'xAI', kind: 'openai', base: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai', placeholder: 'xai-…', effortParam: 'reasoning_effort' },
  mistral: { label: 'Mistral', kind: 'openai', base: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys', placeholder: '…' },
  deepseek: { label: 'DeepSeek', kind: 'openai', base: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys', placeholder: 'sk-…' },
};
export const CHAT_EFFORTS = ['minimal', 'low', 'medium', 'high'];
const baseOf = (p) => process.env[`AI_BASE_${p.toUpperCase()}`] || PROVIDERS[p].base;
const callId = () => 'call_' + crypto.randomBytes(5).toString('hex');

export class ProviderError extends Error {
  constructor(message, status = 502, code = '') { super(message); this.status = status; this.code = code; }
}
async function readError(res) {
  let msg = `${res.status} ${res.statusText}`;
  try { const j = await res.json(); msg = j.error?.message || j.message || j.error || JSON.stringify(j).slice(0, 300); } catch { /* not json */ }
  return typeof msg === 'string' ? msg : JSON.stringify(msg);
}
function friendly(provider, status, msg) {
  const label = PROVIDERS[provider]?.label || provider;
  if (status === 401 || status === 403) return new ProviderError(`${label} rejected the API key. Check it in Settings → AI.`, 401, 'auth');
  if (status === 429) return new ProviderError(`${label} rate limit or quota reached. Try again in a moment.`, 429, 'rate');
  if (status === 404) return new ProviderError(`${label}: model not found. Pick another model in Settings → AI. (${msg})`, 400, 'model');
  return new ProviderError(`${label}: ${msg}`, status >= 500 ? 502 : 400);
}

/* ───────────── list models (also validates keys) ───────────── */
export async function listModels(provider, key, { signal } = {}) {
  const P = PROVIDERS[provider]; if (!P) throw new ProviderError('Unknown provider', 400);
  let res;
  if (P.kind === 'google') res = await fetch(`${baseOf(provider)}/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal });
  else if (P.kind === 'anthropic') res = await fetch(`${baseOf(provider)}/models?limit=100`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal });
  else res = await fetch(`${baseOf(provider)}/models`, { headers: { Authorization: `Bearer ${key}` }, signal });
  if (!res.ok) throw friendly(provider, res.status, await readError(res));
  const j = await res.json();
  if (P.kind === 'google') {
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).some((x) => x === 'generateContent' || x === 'bidiGenerateContent'))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name, live: (m.supportedGenerationMethods || []).includes('bidiGenerateContent') && !(m.supportedGenerationMethods || []).includes('generateContent') }))
      .filter((m) => /gemini|gemma/i.test(m.id) && !/embedding|image|tts|aqa|imagen|veo/i.test(m.id));
  }
  const rows = j.data || j.models || [];
  return rows.map((m) => ({ id: m.id, label: m.display_name || m.name || m.id }))
    .filter((m) => !/embed|whisper|tts|dall-e|moderation|image|audio|transcribe|realtime|guard/i.test(m.id));
}

/* ───────────── Google (Gemini generateContent, streamed) ───────────── */
function toGemini(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', parts: [{ text: m.text || ' ' }] });
    else if (m.role === 'assistant') {
      if (m.raw?.provider === 'google' && m.raw.content) { out.push(m.raw.content); continue; }
      const parts = [];
      if (m.text) parts.push({ text: m.text });
      // calls produced by another provider: Gemini 3 accepts this documented placeholder signature
      (m.calls || []).forEach((c) => parts.push({ functionCall: { name: c.name, args: c.args || {} }, thoughtSignature: 'skip_thought_signature_validator' }));
      if (parts.length) out.push({ role: 'model', parts });
    } else if (m.role === 'tool') {
      out.push({ role: 'user', parts: (m.results || []).map((r) => ({ functionResponse: { name: r.name, response: { output: r.result } } })) });
    }
  }
  return out;
}
function geminiThinking(model, effort) {
  if (/gemini-2\.5|gemini-2\.0|gemma/i.test(model)) {
    if (/gemma|2\.0/.test(model)) return undefined;
    const pro = /pro/.test(model);
    const budget = { minimal: pro ? 128 : 0, low: 1024, medium: 4096, high: 12288 }[effort] ?? 1024;
    return { thinkingBudget: budget, includeThoughts: budget > 0 };
  }
  return { thinkingLevel: CHAT_EFFORTS.includes(effort) ? effort : 'low', includeThoughts: true };
}
async function googleStep({ key, model, effort, system, messages, tools, onEvent, signal }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: toGemini(messages),
    tools: tools.length ? [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }] : undefined,
    generationConfig: { thinkingConfig: geminiThinking(model, effort) },
  };
  const res = await fetch(`${baseOf('google')}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!res.ok) throw friendly('google', res.status, await readError(res));
  const parts = [];
  let text = '', thoughts = '', blocked = '';
  const push = (p) => {
    const last = parts[parts.length - 1];
    const isText = typeof p.text === 'string' && !p.functionCall;
    if (isText && last && typeof last.text === 'string' && !last.functionCall && !!last.thought === !!p.thought && !last.thoughtSignature) {
      last.text += p.text; if (p.thoughtSignature) last.thoughtSignature = p.thoughtSignature;
    } else parts.push({ ...p });
  };
  await readSSE(res, (data) => {
    let j; try { j = JSON.parse(data); } catch { return; }
    if (j.error) throw friendly('google', j.error.code || 500, j.error.message);
    const cand = j.candidates?.[0];
    if (j.promptFeedback?.blockReason) blocked = j.promptFeedback.blockReason;
    for (const p of cand?.content?.parts || []) {
      push(p);
      if (p.functionCall) continue;
      if (typeof p.text === 'string' && p.text) {
        if (p.thought) { thoughts += p.text; onEvent?.('thought', { text: p.text }); }
        else { text += p.text; onEvent?.('text', { delta: p.text }); }
      }
    }
    if (cand?.finishReason && !['STOP', 'MAX_TOKENS', 'FINISH_REASON_UNSPECIFIED'].includes(cand.finishReason) && !text && !parts.some((p) => p.functionCall)) blocked = cand.finishReason;
  });
  if (blocked && !text && !parts.some((p) => p.functionCall)) throw new ProviderError(`Gemini stopped: ${blocked}`, 400);
  const calls = parts.filter((p) => p.functionCall).map((p) => ({ id: p.functionCall.id || callId(), name: p.functionCall.name, args: p.functionCall.args || {} }));
  return { text, thoughts, calls, raw: { provider: 'google', content: { role: 'model', parts } } };
}

/* ───────────── OpenAI-compatible (OpenAI, OpenRouter, Groq, xAI, Mistral, DeepSeek) ───────────── */
function toOpenAI(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text || ' ' });
    else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.text || null };
      if (m.calls?.length) msg.tool_calls = m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
      if (msg.content || msg.tool_calls) out.push(msg);
    } else if (m.role === 'tool') {
      for (const r of m.results || []) out.push({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.result) });
    }
  }
  return out;
}
async function openaiStep({ provider, key, model, effort, system, messages, tools, onEvent, signal }) {
  const P = PROVIDERS[provider];
  const body = { model, messages: toOpenAI(system, messages) };
  if (tools.length) { body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })); body.tool_choice = 'auto'; }
  const withEffort = { ...body };
  if (P.effortParam === 'reasoning') withEffort.reasoning = { effort: effort === 'minimal' ? 'low' : effort };
  else if (P.effortParam && effort) withEffort.reasoning_effort = effort;
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (provider === 'openrouter') Object.assign(headers, { 'HTTP-Referer': 'https://assign.app', 'X-Title': 'assign' });
  const post = (b) => fetch(`${baseOf(provider)}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(b), signal });
  let res = await post(withEffort);
  if (!res.ok && res.status === 400 && withEffort !== body) {
    const msg = await readError(res);
    // many models don't take a reasoning effort — retry once without it
    if (/reason|effort|unsupported|not support|unrecognized|unknown/i.test(msg)) res = await post(body);
    else throw friendly(provider, 400, msg);
  }
  if (!res.ok) throw friendly(provider, res.status, await readError(res));
  const j = await res.json();
  const msg = j.choices?.[0]?.message || {};
  const thoughts = msg.reasoning_content || msg.reasoning || '';
  if (thoughts) onEvent?.('thought', { text: thoughts });
  const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((c) => c.text || '').join('') : '';
  if (text) onEvent?.('text', { delta: text });
  const calls = (msg.tool_calls || []).map((c) => { let args = {}; try { args = JSON.parse(c.function?.arguments || '{}'); } catch { /* bad json */ } return { id: c.id || callId(), name: c.function?.name, args }; });
  return { text, thoughts, calls, raw: { provider, content: null } };
}

/* ───────────── Anthropic ───────────── */
function toAnthropic(messages) {
  const out = [];
  const add = (role, content) => {
    const last = out[out.length - 1];
    if (last && last.role === role) { last.content = [...(Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content }]), ...(Array.isArray(content) ? content : [{ type: 'text', text: content }])]; }
    else out.push({ role, content });
  };
  for (const m of messages) {
    if (m.role === 'user') add('user', m.text || ' ');
    else if (m.role === 'assistant') {
      if (m.raw?.provider === 'anthropic' && m.raw.content) { add('assistant', m.raw.content); continue; }
      const blocks = [];
      if (m.text) blocks.push({ type: 'text', text: m.text });
      (m.calls || []).forEach((c) => blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} }));
      if (blocks.length) add('assistant', blocks);
    } else if (m.role === 'tool') add('user', (m.results || []).map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: JSON.stringify(r.result) })));
  }
  return out;
}
async function anthropicStep({ key, model, effort, system, messages, tools, onEvent, signal }) {
  const budget = { minimal: 0, low: 2048, medium: 6144, high: 16384 }[effort] ?? 2048;
  const body = { model, system, max_tokens: budget + 4096, messages: toAnthropic(messages) };
  if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  if (budget) body.thinking = { type: 'enabled', budget_tokens: budget };
  const post = (b) => fetch(`${baseOf('anthropic')}/messages`, { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal });
  let res = await post(body);
  if (!res.ok && res.status === 400 && body.thinking) {
    const msg = await readError(res);
    if (/thinking/i.test(msg)) { const { thinking, ...rest } = body; res = await post({ ...rest, max_tokens: 4096 }); }
    else throw friendly('anthropic', 400, msg);
  }
  if (!res.ok) throw friendly('anthropic', res.status, await readError(res));
  const j = await res.json();
  let text = '', thoughts = '';
  const calls = [];
  for (const b of j.content || []) {
    if (b.type === 'text') text += b.text;
    else if (b.type === 'thinking') thoughts += b.thinking || '';
    else if (b.type === 'tool_use') calls.push({ id: b.id, name: b.name, args: b.input || {} });
  }
  if (thoughts) onEvent?.('thought', { text: thoughts });
  if (text) onEvent?.('text', { delta: text });
  return { text, thoughts, calls, raw: { provider: 'anthropic', content: j.content } };
}

export async function modelStep(args) {
  const P = PROVIDERS[args.provider]; if (!P) throw new ProviderError('Unknown provider', 400);
  if (P.kind === 'google') return googleStep(args);
  if (P.kind === 'anthropic') return anthropicStep(args);
  return openaiStep(args);
}

/* ───────────── SSE reader ───────────── */
async function readSSE(res, onData) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      const data = chunk.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data && data !== '[DONE]') onData(data);
    }
  }
  const rest = buf.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
  if (rest && rest !== '[DONE]') onData(rest);
}

/* ───────────── Live API ephemeral token ───────────── */
export async function createLiveToken(key, model) {
  const expireTime = new Date(Date.now() + 30 * 60e3).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 2 * 60e3).toISOString();
  const body = { uses: 1, expireTime, newSessionExpireTime, liveConnectConstraints: { model: `models/${model}` } };
  const root = process.env.AI_BASE_GOOGLE_ROOT || 'https://generativelanguage.googleapis.com';
  let lastErr;
  for (const version of ['v1alpha', 'v1beta']) {
    const res = await fetch(`${root}/${version}/auth_tokens`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) { const j = await res.json(); return { token: j.name, version, expireTime }; }
    lastErr = friendly('google', res.status, await readError(res));
    if (res.status === 401 || res.status === 403 || res.status === 429) break;
  }
  throw lastErr;
}
