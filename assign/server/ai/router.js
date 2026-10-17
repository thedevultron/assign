// /api/ai — the in-app assistant: provider keys, model settings, chat (SSE agent loop),
// live voice sessions (ephemeral Gemini Live tokens) and tool execution for voice.
import express from 'express';
import { getSettings, saveSettings } from '../db.js';
import { emit } from '../core.js';
import { requireAuth, rateLimit } from '../auth.js';
import { PROVIDERS, CHAT_EFFORTS, listModels, modelStep, createLiveToken, ProviderError } from './providers.js';
import { setKey, getKey, deleteKey, listKeys, defaultKey, isDefaultKey } from './keys.js';
import { declarations, execTool, riskOf, confirmText } from './tools.js';
import { chatPrompt, voicePrompt } from './prompts.js';

const r = express.Router();
r.use(requireAuth);

export const VOICE_MODELS = [
  { id: 'gemini-3.8-live-extended-thinking', label: 'Gemini 3.8 Live · Extended thinking', thinking: true },
  { id: 'gemini-3.8-live', label: 'Gemini 3.8 Live', thinking: false },
];
export const VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda', 'Orus', 'Zephyr'];
const VOICE_EFFORTS = ['low', 'medium', 'high'];
export const AI_DEFAULTS = {
  chat_provider: 'google', chat_model: 'gemini-3.5-flash-lite', chat_effort: 'medium',
  voice_model: 'gemini-3.8-live-extended-thinking', voice_effort: 'medium', voice_name: 'Kore',
  confirm_risky: true, follow_along: true, memory_learn: true,
};
const PREFERRED = {
  openai: [/^gpt-5(\.\d+)?-mini$/, /^gpt-5(\.\d+)?$/, /^gpt-4\.1-mini$/, /^gpt-4o-mini$/, /^gpt/],
  anthropic: [/sonnet/, /haiku/, /opus/],
  openrouter: [/google\/gemini-3\.5-flash-lite/, /google\/gemini/, /anthropic\/claude.*sonnet/, /openai\/gpt/],
  groq: [/gpt-oss-120b/, /llama-3\.3-70b/, /qwen/, /llama/],
  xai: [/grok-\d+(\.\d+)?-fast/, /grok-\d/, /grok/],
  mistral: [/mistral-medium-latest/, /mistral-large-latest/, /mistral-small-latest/, /mistral/],
  deepseek: [/deepseek-chat/, /deepseek/],
};
const pickModel = (provider, models) => {
  for (const re of PREFERRED[provider] || []) { const m = models.find((x) => re.test(x.id)); if (m) return m.id; }
  return models[0]?.id || '';
};

const aiSettings = (ws) => ({ ...AI_DEFAULTS, ...(getSettings(ws).ai || {}) });
function saveAi(ws, next) {
  const s = getSettings(ws); s.ai = { ...aiSettings(ws), ...next }; saveSettings(ws, s); emit(ws, 'settings', s); return s.ai;
}
function config(ws) {
  const keys = Object.fromEntries(listKeys(ws).map((k) => [k.provider, k]));
  return {
    settings: aiSettings(ws),
    providers: Object.entries(PROVIDERS).map(([id, p]) => {
      const isDefault = !keys[id] && !!defaultKey(id);
      return { id, label: p.label, keyUrl: p.keyUrl, placeholder: p.placeholder, voice: !!p.voice, set: !!keys[id] || isDefault, hint: keys[id]?.hint || (isDefault ? 'built-in' : ''), isDefault, updated_at: keys[id]?.updated_at || null };
    }),
    chat_efforts: CHAT_EFFORTS, voice_models: VOICE_MODELS, voice_efforts: VOICE_EFFORTS, voices: VOICES,
  };
}
const bad = (res, status, error, code) => res.status(status).json({ error, code });
const send = (res, e) => (e instanceof ProviderError ? bad(res, e.status, e.message, e.code) : (console.error(e), bad(res, 500, 'Something went wrong')));

/* ───────────── config & settings ───────────── */
r.get('/config', (req, res) => res.json(config(req.ws)));

r.patch('/settings', (req, res) => {
  const b = req.body || {}; const cur = aiSettings(req.ws); const next = {};
  if ('chat_provider' in b) { if (!PROVIDERS[b.chat_provider]) return bad(res, 400, 'Unknown provider'); next.chat_provider = b.chat_provider; if (b.chat_provider !== cur.chat_provider && !('chat_model' in b)) next.chat_model = PROVIDERS[b.chat_provider].defaultModel || ''; }
  if ('chat_model' in b) next.chat_model = String(b.chat_model || '').trim().slice(0, 120);
  if ('chat_effort' in b) { if (!CHAT_EFFORTS.includes(b.chat_effort)) return bad(res, 400, 'Invalid effort'); next.chat_effort = b.chat_effort; }
  if ('voice_model' in b) { if (!VOICE_MODELS.some((m) => m.id === b.voice_model)) return bad(res, 400, 'Unknown voice model'); next.voice_model = b.voice_model; }
  if ('voice_effort' in b) { if (!VOICE_EFFORTS.includes(b.voice_effort)) return bad(res, 400, 'Invalid voice effort'); next.voice_effort = b.voice_effort; }
  if ('voice_name' in b) { if (!VOICES.includes(b.voice_name)) return bad(res, 400, 'Unknown voice'); next.voice_name = b.voice_name; }
  if ('confirm_risky' in b) next.confirm_risky = !!b.confirm_risky;
  if ('follow_along' in b) next.follow_along = !!b.follow_along;
  if ('memory_learn' in b) next.memory_learn = !!b.memory_learn;
  saveAi(req.ws, next);
  res.json(config(req.ws));
});

/* ───────────── keys ───────────── */
r.put('/keys/:provider', async (req, res) => {
  const provider = req.params.provider; const P = PROVIDERS[provider];
  if (!P) return bad(res, 404, 'Unknown provider');
  const key = String(req.body?.key || '').trim();
  if (key.length < 8 || key.length > 400 || /\s/.test(key)) return bad(res, 400, 'That doesn’t look like an API key');
  if (!rateLimit(`aikey:${req.ws}`, { max: 30, windowMs: 10 * 60e3 })) return bad(res, 429, 'Too many attempts. Try again in a few minutes.');
  let models = null, warning = '';
  try { models = await listModels(provider, key, { signal: AbortSignal.timeout(12000) }); }
  catch (e) {
    if (e instanceof ProviderError && (e.code === 'auth' || e.status === 400)) return bad(res, 400, e.message, e.code);
    warning = `Saved, but ${P.label} couldn’t be reached to verify it (${e.message || 'network error'}).`;
  }
  setKey(req.ws, provider, key);
  // auto-route: the first usable key becomes the chat provider; a Google key always routes to Gemini 3.5 Flash-Lite
  const cur = aiSettings(req.ws);
  const curHasKey = cur.chat_provider !== provider && !!getKey(req.ws, cur.chat_provider);
  if (provider === 'google' && (!curHasKey || cur.chat_provider === 'google')) saveAi(req.ws, { chat_provider: 'google', chat_model: cur.chat_provider === 'google' && cur.chat_model ? cur.chat_model : AI_DEFAULTS.chat_model });
  else if (!curHasKey && provider !== 'google') saveAi(req.ws, { chat_provider: provider, chat_model: P.defaultModel || pickModel(provider, models || []) });
  modelCache.delete(`${req.ws}:${provider}`);
  res.json({ ...config(req.ws), warning, models: models?.length || 0 });
});

r.delete('/keys/:provider', (req, res) => {
  const provider = req.params.provider; if (!PROVIDERS[provider]) return bad(res, 404, 'Unknown provider');
  deleteKey(req.ws, provider); modelCache.delete(`${req.ws}:${provider}`);
  const cur = aiSettings(req.ws);
  if (cur.chat_provider === provider) {
    const other = listKeys(req.ws).map((k) => k.provider).sort((a, b) => (a === 'google' ? -1 : b === 'google' ? 1 : 0))[0];
    if (other) saveAi(req.ws, { chat_provider: other, chat_model: other === 'google' ? AI_DEFAULTS.chat_model : '' });
  }
  res.json(config(req.ws));
});

const modelCache = new Map();
r.get('/models', async (req, res) => {
  const provider = String(req.query.provider || ''); if (!PROVIDERS[provider]) return bad(res, 400, 'Unknown provider');
  const key = getKey(req.ws, provider); if (!key) return bad(res, 400, `Add a ${PROVIDERS[provider].label} key first`, 'no_key');
  const ck = `${req.ws}:${provider}`; const hit = modelCache.get(ck);
  if (hit && Date.now() - hit.at < 10 * 60e3) return res.json({ models: hit.models });
  try { const models = await listModels(provider, key, { signal: AbortSignal.timeout(12000) }); modelCache.set(ck, { at: Date.now(), models }); res.json({ models }); }
  catch (e) { send(res, e); }
});

/* ───────────── chat (SSE agent loop) ───────────── */
const MAX_STEPS = 8;
function cleanHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const msgs = raw.filter((m) => m && ['user', 'assistant', 'tool'].includes(m.role)).slice(-60).map((m) => {
    if (m.role === 'user') return { role: 'user', text: String(m.text || '').slice(0, 20000) };
    if (m.role === 'assistant') return { role: 'assistant', text: String(m.text || ''), calls: Array.isArray(m.calls) ? m.calls.slice(0, 20).map((c) => ({ id: String(c.id), name: String(c.name), args: c.args && typeof c.args === 'object' ? c.args : {} })) : [], raw: m.raw && typeof m.raw === 'object' ? m.raw : null };
    return { role: 'tool', results: Array.isArray(m.results) ? m.results.map((x) => ({ id: String(x.id), name: String(x.name), result: x.result })) : [] };
  });
  while (msgs.length && msgs[0].role !== 'user') msgs.shift(); // never start mid tool-exchange
  return msgs;
}

r.post('/chat', async (req, res) => {
  const ws = req.ws; const ai = aiSettings(ws);
  const key = getKey(ws, ai.chat_provider);
  if (!key) return bad(res, 400, `Add a ${PROVIDERS[ai.chat_provider]?.label || 'provider'} API key in Settings → AI to start chatting.`, 'no_key');
  if (!ai.chat_model) return bad(res, 400, 'Pick a chat model in Settings → AI.', 'no_model');
  if (!rateLimit(`aichat:${ws}`, { max: 240, windowMs: 10 * 60e3 })) return bad(res, 429, 'You’re sending messages very fast. Take a breath and try again.');
  const messages = cleanHistory(req.body?.messages);
  const decisions = req.body?.decisions && typeof req.body.decisions === 'object' ? req.body.decisions : null;
  if (!messages.length) return bad(res, 400, 'Say something first');

  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());
  const out = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const ping = setInterval(() => out('ping', {}), 15000);
  const ctx = { ws, token: req.token, user: req.user, confirmRisky: ai.confirm_risky !== false };

  const runCall = async (c, confirmed) => {
    out('call', { id: c.id, name: c.name, args: c.args });
    const r2 = await execTool(ctx, c.name, c.args, { confirmed });
    out('result', { id: c.id, name: c.name, ok: r2.ok, summary: r2.summary || '', error: r2.ok ? '' : r2.error, client: r2.client || null });
    return { id: c.id, name: c.name, result: r2.ok ? r2.result : { error: r2.error } };
  };

  try {
    // resume after the user approved / declined risky actions
    if (decisions) {
      let toolMsg = messages[messages.length - 1]?.role === 'tool' ? messages.pop() : { role: 'tool', results: [] };
      const asst = messages[messages.length - 1];
      if (asst?.role === 'assistant' && asst.calls?.length) {
        const done = new Set(toolMsg.results.map((x) => x.id));
        for (const c of asst.calls) {
          if (done.has(c.id)) continue;
          if (decisions[c.id] === true) toolMsg.results.push(await runCall(c, true));
          else { out('result', { id: c.id, name: c.name, ok: false, declined: true, summary: 'Declined', error: '' }); toolMsg.results.push({ id: c.id, name: c.name, result: { declined: true, message: 'The user declined this action. Do not retry it unless they ask.' } }); }
        }
        // keep results in call order
        toolMsg = { role: 'tool', results: asst.calls.map((c) => toolMsg.results.find((x) => x.id === c.id)).filter(Boolean) };
        messages.push(toolMsg);
        out('tool', { ...toolMsg, replace: true });
      }
    }

    const tools = declarations();
    const system = chatPrompt(ws, req.user, { confirmRisky: ctx.confirmRisky });
    for (let step = 0; step < MAX_STEPS; step++) {
      out('step', { step });
      const res2 = await modelStep({ provider: ai.chat_provider, key, model: ai.chat_model, effort: ai.chat_effort, system, messages, tools, signal: ctrl.signal, onEvent: out });
      const asst = { role: 'assistant', text: res2.text, calls: res2.calls, raw: res2.raw };
      messages.push(asst);
      out('message', asst);
      if (!res2.calls.length) break;
      const results = []; const pending = [];
      for (const c of res2.calls) {
        if (ctx.confirmRisky && riskOf(c.name, c.args) === 'risky') { pending.push({ ...c, confirm: confirmText(ctx, c.name, c.args) }); continue; }
        results.push(await runCall(c, true));
      }
      const toolMsg = { role: 'tool', results };
      messages.push(toolMsg);
      out('tool', toolMsg);
      if (pending.length) { out('confirm', { calls: pending }); break; }
      if (step === MAX_STEPS - 1) out('text', { delta: '\n\n_(Stopped after several steps — tell me to continue if needed.)_' });
    }
    out('done', {});
  } catch (e) {
    if (ctrl.signal.aborted) { /* client went away */ }
    else { if (!(e instanceof ProviderError)) console.error('[ai chat]', e); out('error', { message: e instanceof ProviderError ? e.message : 'The assistant hit an error. Try again.', code: e.code || '' }); }
  } finally { clearInterval(ping); res.end(); }
});

/* ───────────── live voice ───────────── */
r.post('/live', async (req, res) => {
  const ws = req.ws; const ai = aiSettings(ws);
  const key = getKey(ws, 'google');
  if (!key) return bad(res, 400, 'Voice uses the Gemini Live API. Add a Google AI Studio key in Settings → AI.', 'no_google_key');
  if (!rateLimit(`ailive:${ws}`, { max: 30, windowMs: 10 * 60e3 })) return bad(res, 429, 'Too many voice sessions started. Try again shortly.');
  const vm = VOICE_MODELS.find((m) => m.id === ai.voice_model) || VOICE_MODELS[0];
  try {
    const tok = await createLiveToken(key, vm.id);
    const cfg = {
      responseModalities: ['AUDIO'],
      systemInstruction: { parts: [{ text: voicePrompt(ws, req.user, { confirmRisky: ai.confirm_risky !== false }) }] },
      tools: [{ functionDeclarations: declarations({ voice: true }).map((d) => ({ ...d, behavior: 'NON_BLOCKING' })) }],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ai.voice_name } } },
      inputAudioTranscription: {}, outputAudioTranscription: {},
      sessionResumption: {},
      contextWindowCompression: { slidingWindow: {} },
    };
    if (vm.thinking) cfg.thinkingConfig = { thinkingLevel: ai.voice_effort, includeThoughts: true };
    res.json({ token: tok.token, version: tok.version, expires_at: tok.expireTime, model: vm.id, model_label: vm.label, config: cfg, follow_along: ai.follow_along !== false, ...(process.env.AI_LIVE_BASE ? { base_url: process.env.AI_LIVE_BASE } : {}) });
  } catch (e) { send(res, e); }
});

// voice tool calls arrive in the browser over the Live socket and are executed here
r.post('/tool', async (req, res) => {
  const ws = req.ws; const ai = aiSettings(ws);
  const name = String(req.body?.name || ''); const args = req.body?.args && typeof req.body.args === 'object' ? { ...req.body.args } : {};
  if (!rateLimit(`aitool:${ws}`, { max: 600, windowMs: 10 * 60e3 })) return bad(res, 429, 'Too many actions');
  const confirmed = args.confirmed === true || req.body?.confirmed === true; delete args.confirmed;
  const ctx = { ws, token: req.token, user: req.user, confirmRisky: ai.confirm_risky !== false };
  const out = await execTool(ctx, name, args, { confirmed });
  res.json({ ...out, risk: riskOf(name, args) });
});

export default r;
