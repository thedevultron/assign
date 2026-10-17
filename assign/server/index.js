import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import './db.js';
import api from './routes.js';
import aiRouter from './ai/router.js';
import { actorStore } from './core.js';
import { mountMcp } from './mcp.js';
import { startScheduler } from './scheduler.js';
import { genericSkill, zip, baseUrlFrom, SKILL_VERSION } from './skill.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const isDev = process.argv.includes('--dev');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  if (!isDev) {
    // the voice agent dials the configured AI provider from the browser over wss/https; everything else is same-origin
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '));
  }
  next();
});
const jsonSmall = express.json({ limit: '1mb' });
const jsonLarge = express.json({ limit: '8mb' }); // assistant conversations carry model reasoning signatures
app.use((req, res, next) => (req.path.startsWith('/api/ai/') ? jsonLarge : jsonSmall)(req, res, next));
if (!isDev) {
  const { default: compression } = await import('compression');
  app.use(compression({ filter: (req, res) => (req.path === '/api/events' || req.path === '/api/ai/chat' ? false : compression.filter(req, res)) })); // SSE must flush per message — never compress it
}
// the assistant calls the API on the user's behalf over loopback; tag those requests
app.use((req, res, next) => {
  const loop = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (loop && req.headers['x-assign-actor'] === 'assistant') return actorStore.run('assistant', () => next());
  next();
});

/* ---- public, generic Agent Skill (no secrets) ---- */
app.get('/skill/assign-skill.zip', (req, res) => {
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="assign-skill-v${SKILL_VERSION}.zip"`, 'Cache-Control': 'no-cache' });
  res.send(zip(genericSkill({ baseUrl: baseUrlFrom(req) })));
});
app.get('/skill/SKILL.md', (req, res) => {
  res.type('text/markdown; charset=utf-8').send(genericSkill({ baseUrl: baseUrlFrom(req) })[0].data);
});
app.get('/skill/AGENTS.md', (req, res) => {
  res.type('text/markdown; charset=utf-8').send(genericSkill({ baseUrl: baseUrlFrom(req) }).find((f) => f.name.endsWith('AGENTS.md')).data);
});

mountMcp(app);
app.use('/api/ai', aiRouter);
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

if (isDev) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true, hmr: { port: 24679 } }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(dist)) { console.error('dist/ not found — run `npm run build` first'); process.exit(1); }
  app.use(express.static(dist, { index: false, maxAge: '1y', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get(/^(?!\/api\/|\/mcp|\/skill\/).*/, (req, res) => res.setHeader('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  console.error(err); res.status(500).json({ error: 'Server error' });
});

import { attachRunnerSocket } from './runners.js';

startScheduler();
const httpServer = app.listen(PORT, HOST, () => console.log(`• assign running on http://${HOST}:${PORT}  (MCP endpoint: /mcp)`));
attachRunnerSocket(httpServer);
