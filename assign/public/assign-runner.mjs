#!/usr/bin/env node
/*
 * assign-runner — zero-dependency local runner for assign boards.
 *
 * This script runs on YOUR machine. It connects out to an assign server over a
 * WebSocket, accepts "exec" commands for tasks you started from the browser
 * (agent CLIs like `claude`, `codex`, `gemini` in a repo folder), streams the
 * output back live, and reports the exit code. It never executes anything
 * outside its allow list (see --allow) and never runs a shell string.
 *
 * Usage:
 *   node assign-runner.mjs --token rnr_... [--url https://your-assign-host] [--cwd ~/projects] [--allow claude,codex,npx] [--max 2]
 *
 * Get a token: assign app → Agents → Runners → "Add runner".
 * Stop with Ctrl+C. Requires Node.js 18+.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import os from 'node:os';

/* ---------------- args ---------------- */
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; return v && !v.startsWith('--') ? v : d; };
const TOKEN = flag('token', process.env.ASSIGN_RUNNER_TOKEN || '');
const URL_RAW = flag('url', process.env.ASSIGN_URL || 'http://localhost:3000');
const CWD = flag('cwd', process.cwd());
const ALLOW = new Set(flag('allow', 'claude,codex,gemini,cursor-agent,aider,cline,node,npx,npm,python3,git,echo').split(',').map((s) => s.trim()).filter(Boolean));
const MAX_CONCURRENT = Math.max(1, Math.min(5, parseInt(flag('max', '2')) || 2));
const LABEL = [os.hostname(), os.userInfo?.().username].filter(Boolean).join(' · ');

if (!TOKEN) { console.error('\n  assign-runner: missing --token rnr_…\n  Get one in assign → Agents → Runners → Add runner.\n'); process.exit(1); }
if (!/^wss?:\/\/|^https?:\/\//.test(URL_RAW)) { console.error('  --url must start with http(s):// or ws(s)://'); process.exit(1); }

const C = { dim: '\x1b[2m', iris: '\x1b[38;5;141m', ok: '\x1b[38;5;114m', warn: '\x1b[38;5;215m', bad: '\x1b[38;5;203m', reset: '\x1b[0m' };
const stamp = () => C.dim + new Date().toTimeString().slice(0, 8) + C.reset;
const say = (m) => console.log(`${stamp()} ${C.iris}runner${C.reset} ${m}`);
const clog = (color, m) => console.log(`${stamp()} ${color}${m}${C.reset}`);

/* ---------------- tiny WebSocket client (zero deps, Node ≥18) ---------------- */
function wsConnect(url, { onOpen, onText, onClose, onError }) {
  const u = new URL(url);
  const secure = u.protocol === 'wss:';
  const port = Number(u.port) || (secure ? 443 : 80);
  const key = crypto.randomBytes(16).toString('base64');
  const sock = (secure ? tls : net).connect(port, u.hostname, () => {
    sock.write(
      `GET ${(u.pathname || '/') + u.search} HTTP/1.1\r\nHost: ${u.hostname}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${(secure ? 'https' : 'http') + '://' + u.hostname}\r\n\r\n`
    );
  });
  let upgraded = false; let hs = Buffer.alloc(0); let buf = Buffer.alloc(0);
  const sendFrame = (opcode, payload) => {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
    const mask = crypto.randomBytes(4);
    let header;
    if (data.length < 126) header = Buffer.from([0x80 | opcode, 0x80 | data.length]);
    else if (data.length < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i & 3];
    sock.write(Buffer.concat([header, mask, masked]));
  };
  const sendText = (obj) => sendFrame(0x1, JSON.stringify(obj));
  sock.on('data', (chunk) => {
    if (!upgraded) {
      hs = Buffer.concat([hs, chunk]);
      const idx = hs.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = hs.subarray(0, idx).toString();
      if (!/101/.test(head)) { onError(new Error('Handshake failed: ' + head.split('\r\n')[0])); sock.destroy(); return; }
      upgraded = true; buf = hs.subarray(idx + 4); onOpen({ sendText });
    } else buf = Buffer.concat([buf, chunk]);
    // parse frames
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80; const op = buf[0] & 0x0f; let len = buf[1] & 0x7f; let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const maskKey = buf[1] & 0x80 ? 4 : 0;
      const frameLen = off + maskKey + len;
      if (buf.length < frameLen) return;
      let payload = buf.subarray(off + maskKey, frameLen);
      if (maskKey) payload = Buffer.from(payload.map((b, i) => b ^ buf[off + (i % 4)]));
      buf = buf.subarray(frameLen);
      if (op === 0x8) { try { sendFrame(0x8, Buffer.alloc(0)); } catch {} sock.end(); onClose(); return; }
      if (op === 0x9) { sendFrame(0xA, payload); continue; } // ping → pong
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x0) onText(payload.toString());
      void fin;
    }
  });
  sock.on('error', onError);
  sock.on('close', onClose);
  return { sendText: (...a) => (upgraded ? sendText(...a) : undefined), close: () => sock.end() };
}

/* ---------------- session management ---------------- */
const running = new Map(); // session_id → child
const queue = [];
let link = null;

function capacityFree() { return MAX_CONCURRENT - running.size; }
function exec(session) {
  const [cmd, ...rest] = [session.cmd, ...(session.args || [])];
  if (capacityFree() <= 0) { queue.push(session); say(`queued ${session.id} (at capacity ${MAX_CONCURRENT})`); return; }
  if (!ALLOW.has(cmd)) { say(`${C.warn}refused${C.reset} "${cmd}" — not in --allow list`); return; }
  const cwd = (session.cwd || CWD).replace(/^~/, os.homedir());
  say(`${C.ok}♟${C.reset} ${cmd} ${rest.length ? `(${rest.length} arg, cwd ${cwd})` : `(cwd ${cwd})`}`);
  let child;
  try { child = spawn(cmd, rest, { cwd, env: { ...process.env, FORCE_COLOR: '1' }, shell: false }); }
  catch (e) { say(`${C.bad}spawn failed: ${e.message}${C.reset}`); return; }
  running.set(session.id, child);
  const flushOutput = (() => { let acc = ''; let t = null; return (chunk) => { acc += chunk; if (!t) t = setTimeout(() => { t = null; const s = acc; acc = ''; link?.sendText({ type: 'output', session_id: session.id, chunk: s }); }, 120); }; })();
  child.stdout.on('data', (d) => { process.stdout.write(C.dim + '  │ ' + C.reset + String(d).replace(/\n/g, '\n  │ ')); flushOutput(String(d)); });
  child.stderr.on('data', (d) => { process.stdout.write(C.warn + '  │ ' + C.reset + String(d).replace(/\n/g, '\n  │ ')); flushOutput(String(d)); });
  child.on('error', (e) => { say(`${C.bad}${cmd}: ${e.message}${C.reset}`); finish(session.id, -1); });
  child.on('close', (code, signal) => { clog(code === 0 ? C.ok : C.bad, `${cmd} exited ${code ?? signal}`); setTimeout(() => finish(session.id, code ?? -1), 200); });
}
function finish(id, code) {
  running.delete(id);
  link?.sendText({ type: 'exit', session_id: id, code });
  if (queue.length && capacityFree() > 0) exec(queue.shift());
}
function stop(id) {
  const child = running.get(id);
  const qi = queue.findIndex((s) => s.id === id);
  if (qi >= 0) { queue.splice(qi, 1); link?.sendText({ type: 'exit', session_id: id, code: -2 }); return; }
  if (!child) return;
  say(`${C.warn}stopping ${id}${C.reset}`);
  child.kill('SIGTERM');
  setTimeout(() => { if (running.has(id)) { child.kill('SIGKILL'); } }, 5000);
}

/* ---------------- connect loop ---------------- */
let backoff = 1500;
function connect() {
  const base = URL_RAW.replace(/^http/, 'ws').replace(/\/$/, '');
  say(`connecting to ${C.dim}${base}/ws/runner${C.reset} as ${C.dim}${LABEL}${C.reset}`);
  const c = wsConnect(base + '/ws/runner', {
    onOpen: ({ sendText }) => {
      backoff = 1500;
      link = { sendText };
      clog(C.ok, '♟ connected — waiting for work');
      sendText({ token: TOKEN, label: LABEL, platform: `${os.platform()} ${os.arch()} · node ${process.version}`, cwd: CWD, max_concurrent: MAX_CONCURRENT });
    },
    onText: (text) => {
      let msg; try { msg = JSON.parse(text); } catch { return; }
      if (msg.type === 'exec') exec(msg.session);
      else if (msg.type === 'stop') stop(msg.session_id);
      else if (msg.type === 'hello') say(`server says hi — runner "${msg.runner.name}" registered (${msg.runner.online ? 'online' : 'offline'})`);
      else if (msg.type === 'error') { clog(C.bad, 'server: ' + msg.error); }
    },
    onClose: () => { link = null; for (const [id, child] of running) { child.kill('SIGTERM'); } running.clear(); queue.length = 0; retry(); },
    onError: (e) => { if (backoff === 1500) clog(C.warn, e.message); },
  });
}
function retry() { console.log(`${stamp()} ${C.dim}reconnecting in ${Math.round(backoff / 1000)}s…${C.reset}`); setTimeout(connect, backoff); backoff = Math.min(backoff * 1.8, 30000); }

console.log(`\n  ${C.iris}assign runner${C.reset} — ${os.platform()}/${os.arch()} · node ${process.version}`);
console.log(`  cwd: ${C.dim}${CWD}${C.reset}   allow: ${C.dim}${[...ALLOW].join(' ')}${C.reset}   max: ${MAX_CONCURRENT}\n`);
connect();
process.on('SIGINT', () => { say('bye'); for (const [, c2] of running) c2.kill('SIGTERM'); process.exit(0); });
