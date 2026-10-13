// Live voice assistant over the Gemini Live API.
// The browser connects straight to Google with a short-lived token minted by our server
// (the real API key never reaches the browser). Tool calls are executed by our server.
import { api } from './api.js';
import { useAI, applyClient, TOOL_LABEL } from './ai.js';
import { useStore } from './store.js';

export const levels = { in: 0, out: 0 };
export const voiceLevel = () => Math.max(levels.in * 0.9, levels.out);

const uid = () => Math.random().toString(36).slice(2, 10);
const S = () => useAI.getState();
const setVoice = (p) => S().setVoice(p);

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.pos = 0; this.out = new Int16Array(640); this.n = 0; this.sum = 0; this.cnt = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) { this.sum += ch[i] * ch[i]; this.cnt++; }
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos), f = this.pos - i;
      const a = ch[i], b = i + 1 < ch.length ? ch[i + 1] : a;
      const s = Math.max(-1, Math.min(1, a + (b - a) * f));
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.out.length) {
        this.port.postMessage({ pcm: this.out.buffer.slice(0), level: Math.sqrt(this.sum / Math.max(1, this.cnt)) });
        this.n = 0; this.sum = 0; this.cnt = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor('assign-capture', Capture);
`;

function b64FromBuffer(buf) {
  const bytes = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function pcmFromB64(b64) {
  const bin = atob(b64); const n = bin.length >> 1; const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8); if (v >= 0x8000) v -= 0x10000; out[i] = v / 0x8000; }
  return out;
}

class VoiceSession {
  constructor() {
    this.session = null; this.handle = null; this.ending = false; this.setupDone = false;
    this.sources = new Set(); this.nextT = 0; this.pendingTools = 0; this.attempts = 0;
    this.curUser = null; this.curModel = null; this.raf = 0;
  }

  async start() {
    setVoice({ status: 'connecting', error: '', lines: [], calls: [], thought: '', muted: false, startedAt: Date.now() });
    try {
      await this._audio();
      await this._connect();
    } catch (e) {
      this._fail(e);
    }
  }

  async _audio() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t access a microphone.');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) {
      throw new Error(e?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.' : 'Couldn’t open the microphone.');
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.inCtx = new Ctx();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await this.inCtx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.src = this.inCtx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.inCtx, 'assign-capture');
    this.node.port.onmessage = (e) => {
      const muted = S().voice.muted;
      levels.in = muted ? 0 : Math.min(1, e.data.level * 4);
      if (!muted && this.session && this.setupDone) {
        try { this.session.sendRealtimeInput({ audio: { data: b64FromBuffer(e.data.pcm), mimeType: 'audio/pcm;rate=16000' } }); } catch { /* socket closing */ }
      }
    };
    this.src.connect(this.node);
    // keep the graph pulling without making noise
    const mute = this.inCtx.createGain(); mute.gain.value = 0; this.node.connect(mute).connect(this.inCtx.destination);

    this.outCtx = new Ctx();
    this.outGain = this.outCtx.createGain();
    this.analyser = this.outCtx.createAnalyser(); this.analyser.fftSize = 512;
    this.outGain.connect(this.analyser).connect(this.outCtx.destination);
    const buf = new Float32Array(this.analyser.fftSize);
    const tick = () => {
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      levels.out = Math.min(1, Math.sqrt(sum / buf.length) * 5);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    if (this.inCtx.state === 'suspended') await this.inCtx.resume();
    if (this.outCtx.state === 'suspended') await this.outCtx.resume();
  }

  async _connect({ resume = false, altVersion = false } = {}) {
    const live = await api.post('/ai/live');
    this.live = live;
    setVoice({ model: live.model_label });
    const { GoogleGenAI } = await import('@google/genai');
    const version = altVersion ? (live.version === 'v1alpha' ? 'v1beta' : 'v1alpha') : live.version;
    const ai = new GoogleGenAI({ apiKey: live.token, httpOptions: { apiVersion: version, ...(live.base_url ? { baseUrl: live.base_url } : {}) } });
    const config = { ...live.config };
    if (resume && this.handle) config.sessionResumption = { handle: this.handle };
    this.setupDone = false;
    const opened = { v: false };
    this.session = await ai.live.connect({
      model: live.model,
      config,
      callbacks: {
        onopen: () => { opened.v = true; },
        onmessage: (m) => this._onMessage(m),
        onerror: (e) => { console.warn('[voice] socket error', e?.message || e); },
        onclose: (e) => this._onClose(e, { opened: opened.v, altVersion }),
      },
    });
  }

  _onMessage(m) {
    if (m.setupComplete) {
      this.setupDone = true; this.attempts = 0;
      if (S().voice.status === 'connecting' || S().voice.status === 'reconnecting') setVoice({ status: 'listening' });
    }
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) this.handle = m.sessionResumptionUpdate.newHandle;
    if (m.goAway) { this._reconnect('goaway'); return; }
    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) { this._interrupt(); this._finishModel(); }
      if (sc.inputTranscription?.text) this._appendLine('user', sc.inputTranscription.text);
      if (sc.outputTranscription?.text) this._appendLine('model', sc.outputTranscription.text);
      for (const p of sc.modelTurn?.parts || []) {
        if (p.inlineData?.data && /audio/.test(p.inlineData.mimeType || 'audio')) this._play(p.inlineData.data);
        else if (p.thought && p.text) setVoice((v) => ({ thought: (v.thought + p.text).slice(-600) }));
      }
      if (sc.turnComplete || sc.generationComplete) { this._finishModel(); this.curUser = null; }
    }
    if (m.toolCall?.functionCalls?.length) for (const fc of m.toolCall.functionCalls) this._runTool(fc);
    if (m.toolCallCancellation?.ids?.length) {
      const ids = new Set(m.toolCallCancellation.ids);
      setVoice((v) => ({ calls: v.calls.map((c) => (ids.has(c.id) && c.status === 'running' ? { ...c, status: 'error', error: 'Cancelled' } : c)) }));
    }
  }

  _appendLine(role, text) {
    const key = role === 'user' ? 'curUser' : 'curModel';
    if (role === 'user' && this.curModel) this._finishModel();
    if (!this[key]) {
      this[key] = uid();
      const id = this[key];
      setVoice((v) => ({ lines: [...v.lines, { id, role, text, at: Date.now() }].slice(-60), thought: role === 'model' ? '' : v.thought }));
    } else {
      const id = this[key];
      setVoice((v) => ({ lines: v.lines.map((l) => (l.id === id ? { ...l, text: l.text + text } : l)) }));
    }
    if (role === 'user' && S().voice.status !== 'speaking') setVoice({ status: 'listening' });
  }
  _finishModel() { this.curModel = null; }

  _play(b64) {
    const data = pcmFromB64(b64);
    if (!data.length) return;
    const buf = this.outCtx.createBuffer(1, data.length, 24000);
    buf.copyToChannel(data, 0);
    const src = this.outCtx.createBufferSource();
    src.buffer = buf; src.connect(this.outGain);
    const t = Math.max(this.outCtx.currentTime + 0.03, this.nextT);
    src.start(t); this.nextT = t + buf.duration;
    this.sources.add(src);
    if (S().voice.status !== 'speaking') setVoice({ status: 'speaking' });
    src.onended = () => {
      this.sources.delete(src);
      if (!this.sources.size) setVoice({ status: this.pendingTools ? 'working' : 'listening' });
    };
  }
  _interrupt() {
    for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } }
    this.sources.clear(); this.nextT = 0;
    setVoice({ status: this.pendingTools ? 'working' : 'listening' });
  }

  async _runTool(fc) {
    const item = { id: fc.id || uid(), name: fc.name, args: fc.args || {}, status: 'running', at: Date.now() };
    setVoice((v) => ({ calls: [...v.calls, item].slice(-30), lines: [...v.lines, { id: 'c' + item.id, role: 'call', callId: item.id, at: Date.now() }].slice(-60) }));
    this.curModel = null;
    this.pendingTools++;
    if (!this.sources.size) setVoice({ status: 'working' });
    let r;
    try { r = await api.post('/ai/tool', { name: fc.name, args: fc.args || {} }); }
    catch (e) { r = { ok: false, error: e.message }; }
    this.pendingTools--;
    const status = r.ok ? 'done' : r.needs_confirmation ? 'pending' : 'error';
    setVoice((v) => ({ calls: v.calls.map((c) => (c.id === item.id ? { ...c, status, summary: r.summary || '', error: r.error || '', confirm: r.confirm || '' } : c)), status: this.sources.size ? 'speaking' : this.pendingTools ? 'working' : 'listening' }));
    if (r.ok && r.client) applyClient(r.client);
    const response = r.ok ? { output: r.result } : { error: r.error, ...(r.needs_confirmation ? { needs_confirmation: true, ask_user: r.confirm } : {}) };
    try { this.session?.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response }] }); } catch { /* closed */ }
  }

  /** The user tapped Approve on a call that was waiting for a spoken yes. */
  async approve(callId) {
    const c = S().voice.calls.find((x) => x.id === callId);
    if (!c || c.status !== 'pending') return;
    setVoice((v) => ({ calls: v.calls.map((x) => (x.id === callId ? { ...x, status: 'running' } : x)) }));
    let r;
    try { r = await api.post('/ai/tool', { name: c.name, args: { ...c.args, confirmed: true } }); } catch (e) { r = { ok: false, error: e.message }; }
    setVoice((v) => ({ calls: v.calls.map((x) => (x.id === callId ? { ...x, status: r.ok ? 'done' : 'error', summary: r.summary || '', error: r.error || '' } : x)) }));
    if (r.ok && r.client) applyClient(r.client);
    const note = r.ok ? `I approved it on screen: ${c.confirm || TOOL_LABEL[c.name]}. Done — ${r.summary || 'it worked'}. Briefly confirm out loud.` : `I approved ${c.confirm || c.name} on screen but it failed: ${r.error}. Tell me briefly.`;
    try { this.session?.sendClientContent({ turns: [{ role: 'user', parts: [{ text: note }] }], turnComplete: true }); } catch { /* closed */ }
  }
  decline(callId) {
    const c = S().voice.calls.find((x) => x.id === callId);
    setVoice((v) => ({ calls: v.calls.map((x) => (x.id === callId ? { ...x, status: 'declined' } : x)) }));
    try { this.session?.sendClientContent({ turns: [{ role: 'user', parts: [{ text: `No — don't ${c?.confirm || 'do that'}.` }] }], turnComplete: true }); } catch { /* closed */ }
  }

  sendText(text) {
    const t = String(text || '').trim(); if (!t || !this.session) return;
    this.curUser = null; this._appendLine('user', t); this.curUser = null;
    try { this.session.sendRealtimeInput({ text: t }); } catch { /* closed */ }
  }

  async _reconnect(why) {
    if (this.ending || this.reconnecting) return;
    this.reconnecting = true;
    setVoice({ status: 'reconnecting' });
    const old = this.session; this.session = null;
    try { old?.close(); } catch { /* */ }
    try { await this._connect({ resume: true }); }
    catch (e) { this._fail(e); }
    finally { this.reconnecting = false; }
  }

  _onClose(e, { opened, altVersion }) {
    if (this.ending || this.reconnecting) return;
    const code = e?.code;
    // the token endpoint version differs between rollouts — retry once on the other version
    if (!this.setupDone && !altVersion && this.attempts === 0) {
      this.attempts++;
      this._connect({ altVersion: true }).catch((err) => this._fail(err));
      return;
    }
    if (this.setupDone && this.handle && this.attempts < 3) { this.attempts++; this._reconnect('closed'); return; }
    const reason = e?.reason || '';
    this._fail(new Error(reason ? `Voice session closed: ${reason}` : code === 1000 ? 'The voice session ended.' : `Voice session closed (${code || 'network'}).`));
  }

  _fail(e) {
    console.warn('[voice]', e);
    const msg = e?.message || 'Voice failed to start.';
    this.stop(false);
    setVoice({ status: 'error', error: msg });
  }

  stop(final = true) {
    this.ending = true;
    try { this.session?.close(); } catch { /* */ }
    this.session = null;
    this._interrupt();
    cancelAnimationFrame(this.raf);
    try { this.node?.disconnect(); this.src?.disconnect(); } catch { /* */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    try { this.inCtx?.close(); this.outCtx?.close(); } catch { /* */ }
    levels.in = 0; levels.out = 0;
    if (final) setVoice({ status: 'ended', minimized: false });
  }
}

let current = null;
export const voice = {
  get active() { return !!current && !['idle', 'ended', 'error'].includes(S().voice.status); },
  async start() {
    if (current && voice.active) return;
    const cfg = S().config || (await S().loadConfig());
    if (cfg && !cfg.providers.find((p) => p.id === 'google')?.set) {
      setVoice({ status: 'error', error: 'Voice runs on the Gemini Live API. Add a Google AI Studio key to start talking.', code: 'no_google_key' });
      return;
    }
    current = new VoiceSession();
    await current.start();
  },
  stop() { current?.stop(); current = null; },
  toggleMute() { const m = !S().voice.muted; setVoice({ muted: m }); if (m) levels.in = 0; },
  setMuted(m) { setVoice({ muted: !!m }); if (m) levels.in = 0; },
  sendText(t) { current?.sendText(t); },
  approve(id) { current?.approve(id); },
  decline(id) { current?.decline(id); },
};

// end the session if the user signs out
useStore.subscribe((s, prev) => { if (prev.auth?.status === 'authed' && s.auth?.status !== 'authed') { voice.stop(); useAI.getState().clear(); useAI.setState({ config: null, open: false }); } });
