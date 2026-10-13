// Generates the downloadable "assign" Agent Skill (SKILL.md + references) and per-client MCP configs.
// Two flavours:
//   • generic  — public, no secrets: teaches any AI how to connect to an assign board and work tasks.
//   • personal — per agent: pre-filled with that agent's token, persona, MCP server key and client config.
import zlib from 'node:zlib';

export const CLIENTS = {
  'claude-code': { label: 'Claude Code', match: /claude[-\s]?code|^claude$/i, file: '.mcp.json', skillDir: '.claude/skills', context: 'CLAUDE.md' },
  cursor: { label: 'Cursor', match: /cursor/i, file: '.cursor/mcp.json', skillDir: '.cursor/rules', context: 'AGENTS.md' },
  codex: { label: 'OpenAI Codex', match: /codex/i, file: '~/.codex/config.toml', skillDir: '~/.codex/skills', context: 'AGENTS.md' },
  windsurf: { label: 'Windsurf', match: /windsurf|codeium|cascade/i, file: '~/.codeium/windsurf/mcp_config.json', skillDir: '.windsurf/rules', context: 'AGENTS.md' },
  vscode: { label: 'VS Code · Copilot', match: /visual studio code|vscode|copilot/i, file: '.vscode/mcp.json', skillDir: '.github', context: '.github/copilot-instructions.md' },
  'gemini-cli': { label: 'Gemini CLI', match: /gemini/i, file: '~/.gemini/settings.json', skillDir: '.gemini', context: 'GEMINI.md' },
  cline: { label: 'Cline', match: /cline|roo/i, file: 'cline_mcp_settings.json', skillDir: '.clinerules', context: '.clinerules/assign.md' },
  other: { label: 'Other MCP client', match: /$^/, file: 'mcp.json', skillDir: '.', context: 'AGENTS.md' },
};

/** Map an MCP initialize clientInfo.name to one of our providers. */
export function detectProvider(clientName = '') {
  const n = String(clientName);
  if (!n) return null;
  if (/mcp-remote/i.test(n)) return null; // bridge — can't tell
  for (const [k, c] of Object.entries(CLIENTS)) if (k !== 'other' && c.match.test(n)) return k;
  return 'other';
}

export const serverKey = (agent) => `assign-${agent?.handle || 'agent'}`;

/** Client-specific MCP configuration snippets for one agent. */
export function clientConfigs(agent, mcpUrl) {
  const key = serverKey(agent);
  const token = agent?.token || '<YOUR_AGENT_TOKEN>';
  const auth = `Bearer ${token}`;
  const json = (o) => JSON.stringify(o, null, 2);
  const envVar = `ASSIGN_TOKEN_${(agent?.handle || 'AGENT').toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return {
    'claude-code': {
      title: 'Claude Code',
      steps: [
        { label: 'One command (project scope)', lang: 'bash', code: `claude mcp add --transport http --scope project ${key} ${mcpUrl} \\\n  --header "Authorization: ${auth}"` },
        { label: `…or commit to ${CLIENTS['claude-code'].file}`, lang: 'json', code: json({ mcpServers: { [key]: { type: 'http', url: mcpUrl, headers: { Authorization: auth } } } }) },
      ],
    },
    cursor: {
      title: 'Cursor',
      steps: [{ label: CLIENTS.cursor.file, lang: 'json', code: json({ mcpServers: { [key]: { url: mcpUrl, headers: { Authorization: auth } } } }) }],
    },
    codex: {
      title: 'OpenAI Codex',
      steps: [
        { label: CLIENTS.codex.file, lang: 'toml', code: `[mcp_servers.${key}]\nurl = "${mcpUrl}"\nbearer_token_env_var = "${envVar}"` },
        { label: 'Export the token in your shell', lang: 'bash', code: `export ${envVar}="${token}"` },
      ],
    },
    windsurf: {
      title: 'Windsurf',
      steps: [{ label: CLIENTS.windsurf.file, lang: 'json', code: json({ mcpServers: { [key]: { serverUrl: mcpUrl, headers: { Authorization: auth } } } }) }],
    },
    vscode: {
      title: 'VS Code · Copilot',
      steps: [{ label: CLIENTS.vscode.file, lang: 'json', code: json({ servers: { [key]: { type: 'http', url: mcpUrl, headers: { Authorization: auth } } } }) }],
    },
    'gemini-cli': {
      title: 'Gemini CLI',
      steps: [{ label: CLIENTS['gemini-cli'].file, lang: 'json', code: json({ mcpServers: { [key]: { httpUrl: mcpUrl, headers: { Authorization: auth } } } }) }],
    },
    cline: {
      title: 'Cline',
      steps: [{ label: CLIENTS.cline.file, lang: 'json', code: json({ mcpServers: { [key]: { type: 'streamableHttp', url: mcpUrl, headers: { Authorization: auth } } } }) }],
    },
    other: {
      title: 'Any MCP client (stdio bridge)',
      steps: [{ label: 'mcp.json', lang: 'json', code: json({ mcpServers: { [key]: { command: 'npx', args: ['-y', 'mcp-remote', mcpUrl, '--header', `Authorization:${auth}`] } } }) }],
    },
  };
}

const TOOLS_MD = (prefix = 'ASG') => `# assign MCP tools

| Tool | What it does |
| --- | --- |
| \`whoami\` | Your agent profile, persona and the rules of the board. Call first. |
| \`get_next_task\` | Atomically claims your highest-priority queued task, moves it to *In progress*, returns the brief and the branch to use. |
| \`list_tasks\` | Lists tasks. \`scope: "mine"\` (default) or \`"all"\`; filter by \`status\`. |
| \`get_task\` | Full brief + recent activity for a task id or key (e.g. \`${prefix}-12\`). |
| \`claim_task\` | Claim an *unassigned* task. Fails if another agent owns it. |
| \`start_task\` | Move one of your tasks to *In progress*. |
| \`update_task\` | Report \`progress\` (0–100), change \`status\`, add a \`note\`. Only on tasks you own. |
| \`add_comment\` | Post a comment humans will see on the card. Only on tasks you own. |
| \`complete_task\` | Finish with a \`summary\`. Goes to *Review* unless \`needs_review: false\`. |
| \`release_task\` | Hand a task back (unassign → Backlog) with a reason, e.g. when blocked. |
| \`create_task\` | File a follow-up task; optionally assign it to yourself. |
| \`check_inbox\` | Dispatches, daily digests, deadline reminders and comments addressed to you. |
| \`list_boards\` | Boards in this workspace and their repos. |
| \`post_log\` | One-line progress note on a task you own — streams live on the board. |
| \`report_usage\` | Report \`model\`, \`tokens_in\`, \`tokens_out\` (and exact \`cost_usd\` if you know it) after finishing work. Feeds the human's token & cost charts. Never estimate cost. |

Prompts: \`persona\` (your system prompt) and \`work_next\` (pick up and execute the next task).

## Ownership rules (why there are never conflicts)
- Every task has exactly one owner. Claims are atomic — if two agents race, one wins and the other gets a clear error.
- You can only update, comment on or complete tasks **you own**. Touching an unassigned task claims it for you.
- Each task gets its own branch: \`<your-handle>/asg-<number>-<slug>\`. Never commit to another agent's branch.
- When several agents share one checkout, use a separate git worktree per agent (see clients.md).
`;

const CLIENTS_MD = (mcpUrl, agent) => {
  const cfg = clientConfigs(agent, mcpUrl);
  const parts = Object.entries(cfg).map(([k, c]) => `## ${c.title}\n\n${c.steps.map((s) => `${s.label}:\n\n\`\`\`${s.lang}\n${s.code}\n\`\`\``).join('\n\n')}`);
  return `# Connecting from your coding tool

Endpoint: \`${mcpUrl}\` (MCP Streamable HTTP, protocol 2025-06-18 / 2025-03-26 / 2024-11-05).
Auth: \`Authorization: Bearer <agent token>\` — every agent has its own token. Get one in assign → Agents → Connect.

**Several agents in one tool?** Give each its own server key (\`assign-<handle>\`) so they live side by side, e.g. \`assign-nova\` and \`assign-atlas\` in the same \`.mcp.json\`. Better still, run each agent in its own git worktree with a project-scoped config:

\`\`\`bash
git worktree add ../app-nova -b nova/main
git worktree add ../app-atlas -b atlas/main
\`\`\`

${parts.join('\n\n')}
`;
};

function frontmatter(name, description) {
  return `---\nname: ${name}\ndescription: ${description.replace(/\n/g, ' ')}\n---\n`;
}

const WORKFLOW = (prefix = 'ASG') => `## Workflow
1. Call \`whoami\` once per session to load your persona and the board rules. **First connection only:** if it says *PAIRING REQUIRED*, show the user the 6-digit code it returns and ask them to enter it in assign → Agents → Connect. Wait until they confirm, then call \`whoami\` again.
2. Call \`get_next_task\`. If your queue is empty, call \`check_inbox\`, then stop and tell the user.
3. Check out the branch given in the brief (\`git switch -c <branch>\` or \`git switch <branch>\`). Work only in that branch.
4. Post progress with \`update_task\` at meaningful milestones (≈25 / 50 / 75%), and \`post_log\` one-liners while you work (they stream live on the board). Ask questions or flag blockers with \`add_comment\`.
5. When the acceptance criteria are met, call \`complete_task\` with a concise summary: what changed, files touched, how to verify.
6. Call \`report_usage\` once before moving on — your model name and token counts for that task (from your CLI's usage display). Exact cost only if you know it; never estimate.
7. Repeat from step 2 until the queue is empty.

## Rules
- Never modify a task you don't own; never push to another agent's branch. If a tool says a task is owned by someone else, move on.
- Keep summaries factual and short. Humans read them on the card.
- If you're blocked for more than a few minutes, \`release_task\` with the reason instead of silently stalling.
- Task keys look like \`${prefix}-12\`. You can pass either the key or the id to any tool.
- Reporting usage keeps the human's costs predictable — always \`report_usage\` after finishing work, even a rough token count.
`;

export function genericSkill({ baseUrl }) {
  const mcpUrl = `${baseUrl}/mcp`;
  const skill = frontmatter('assign-board', 'Connect to an "assign" Kanban board over MCP to pick up, work on and complete coding tasks assigned to you. Use when the user mentions assign, a task key like ASG-12, asks you to "pick up the next task", "check the board" or "work through the queue".')
    + `
# assign — work the board

assign is a Kanban board where humans hand coding tasks to AI agents. You are one of those agents. You connect over MCP, claim tasks, report progress and hand work back for review.

## Connect (one time)
Your human needs to create an agent for you in assign (Agents → New agent) and copy its token. Then add the MCP server to your tool — exact snippets for Claude Code, Cursor, Codex, Windsurf, VS Code, Gemini CLI and Cline are in [reference/clients.md](reference/clients.md).

Endpoint: \`${mcpUrl}\` · Header: \`Authorization: Bearer asg_…\`

If the assign tools aren't available yet, tell the user what to add and stop — don't guess.

${WORKFLOW()}
See [reference/tools.md](reference/tools.md) for every tool and the ownership rules.

> Tip: for a skill that's pre-filled with your agent's token and persona, download it from assign → Agents → (your agent) → Connect → Download skill.
`;
  const agents = `# AGENTS.md — assign\n\nThis repository's work is coordinated on an **assign** board (${baseUrl}).\nConnect the MCP server \`assign-<your-handle>\` (${mcpUrl}) with your agent token, then:\n\n${WORKFLOW()}`;
  return [
    { name: 'assign-board/SKILL.md', data: skill },
    { name: 'assign-board/reference/tools.md', data: TOOLS_MD() },
    { name: 'assign-board/reference/clients.md', data: CLIENTS_MD(mcpUrl, null) },
    { name: 'assign-board/AGENTS.md', data: agents },
    { name: 'assign-board/README.txt', data: `assign skill\n============\n\nClaude Code:  copy the assign-board folder to .claude/skills/ (project) or ~/.claude/skills/ (personal).\nCodex:        copy it to ~/.codex/skills/, or put AGENTS.md at your repo root.\nCursor / Windsurf / Cline / Gemini / Copilot: put AGENTS.md (or its contents) in your rules / context file.\nThen add the MCP server — see reference/clients.md.\n` },
  ];
}

export function personalSkill({ baseUrl, agent, workspace, persona, prefix = 'ASG', refFiles = [] }) {
  const mcpUrl = `${baseUrl}/mcp`;
  const key = serverKey(agent);
  const client = CLIENTS[agent.provider] || CLIENTS.other;
  const cfg = clientConfigs(agent, mcpUrl)[agent.provider] || clientConfigs(agent, mcpUrl).other;
  const dir = key;
  const skill = frontmatter(key, `You are ${agent.name} (@${agent.handle})${agent.role ? `, ${agent.role}` : ''}, on the "${workspace.name}" assign board. Use this skill to pick up, work on and complete your assigned coding tasks via the ${key} MCP server. Trigger when the user says "next task", "check assign", mentions ${prefix}-<n>, or asks you to work the queue.`)
    + `
# ${agent.name} — assign agent

${persona}

## Your connection
- MCP server key: \`${key}\` (so you can coexist with other assign agents in ${client.label})
- Endpoint: \`${mcpUrl}\`
- Client: ${client.label} — config file: \`${client.file}\`
- Branch prefix: \`${agent.handle}/\`

${cfg.steps.map((s) => `${s.label}:\n\n\`\`\`${s.lang}\n${s.code}\n\`\`\``).join('\n\n')}

> This file contains your secret agent token. Don't commit it to a public repo. Rotate it in assign → Agents → Connect if it leaks.

${WORKFLOW(prefix)}
${refFiles.length ? `## Reference files
Your human attached ${refFiles.length === 1 ? 'a file' : 'files'} for you — read ${refFiles.length === 1 ? 'it' : 'them'} before big jobs, and fetch fresh copies any time with the get_files tool:
${refFiles.map((r) => `- [reference/files/${r.name}](reference/files/${r.name})`).join('\n')}

` : ''}Every tool: [reference/tools.md](reference/tools.md) · Other clients: [reference/clients.md](reference/clients.md)
`;
  const agentsMd = `# AGENTS.md — ${agent.name} (@${agent.handle})\n\n${persona}\n\nUse the \`${key}\` MCP server (${mcpUrl}).\n\n${WORKFLOW(prefix)}`;
  const files = [
    { name: `${dir}/SKILL.md`, data: skill },
    { name: `${dir}/reference/tools.md`, data: TOOLS_MD(prefix) },
    { name: `${dir}/reference/clients.md`, data: CLIENTS_MD(mcpUrl, agent) },
    { name: `${dir}/AGENTS.md`, data: agentsMd },
  ];
  refFiles.forEach((r) => files.push({ name: `${dir}/reference/files/${r.name}`, data: r.content }));
  // drop-in config for the agent's own client
  const main = cfg.steps.find((s) => s.lang === 'json' || s.lang === 'toml');
  if (main) files.push({ name: `${dir}/config/${client.file.replace(/^~\//, '').replace(/\//g, '__')}`, data: main.code + '\n' });
  files.push({ name: `${dir}/README.txt`, data: `${agent.name} · assign skill for ${client.label}\n\n1. Add the MCP server: see SKILL.md → "Your connection" (or config/).\n2. Install the skill: copy this folder to ${client.skillDir}/ ${agent.provider === 'claude-code' ? '' : `(or paste AGENTS.md into ${client.context})`}.\n3. Ask your agent: "pick up my next assign task".\n` });
  return files;
}

/* ---------------- minimal ZIP writer (deflate) ---------------- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zip(files) {
  const d = new Date();
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  const locals = []; const centrals = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const comp = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function baseUrlFrom(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
  return `${proto}://${host}`;
}
