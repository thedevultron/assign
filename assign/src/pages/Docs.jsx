import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import Icon from '../components/Icon.jsx';
import { LogoMark, CodeBlock, Seg, Button, EASE } from '../components/ui.jsx';
import { useStore } from '../lib/store.js';

/* ───────────────────────── content helpers ───────────────────────── */
const C = ({ children }) => <code className="d-code">{children}</code>;
const Note = ({ tone = 'info', children }) => (
  <div className={`d-note ${tone}`}><Icon name={tone === 'warn' ? 'alert' : tone === 'tip' ? 'sparkles' : 'shield'} size={15} /><div>{children}</div></div>
);
const Table = ({ head, rows }) => (
  <div className="d-table-wrap">
    <table className="d-table">
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table>
  </div>
);
const Steps = ({ items }) => (
  <ol className="d-steps">{items.map(([t, b], i) => <li key={i}><span className="n">{String(i + 1).padStart(2, '0')}</span><div><b>{t}</b><p>{b}</p></div></li>)}</ol>
);

/* ───────────────────────── client configs (mirror server/skill.js) ───────────────────────── */
function clientSnippets(url) {
  const key = 'assign-nova', auth = 'Bearer asg_YOUR_AGENT_TOKEN';
  const j = (o) => JSON.stringify(o, null, 2);
  return {
    'claude-code': { label: 'Claude Code', blocks: [
      ['One command (project scope)', 'bash', `claude mcp add --transport http --scope project ${key} ${url} \\\n  --header "Authorization: ${auth}"`],
      ['…or commit to .mcp.json', 'json', j({ mcpServers: { [key]: { type: 'http', url, headers: { Authorization: auth } } } })],
    ] },
    cursor: { label: 'Cursor', blocks: [['.cursor/mcp.json', 'json', j({ mcpServers: { [key]: { url, headers: { Authorization: auth } } } })]] },
    codex: { label: 'Codex', blocks: [
      ['~/.codex/config.toml', 'toml', `[mcp_servers.${key}]\nurl = "${url}"\nbearer_token_env_var = "ASSIGN_TOKEN_NOVA"`],
      ['Export the token in your shell', 'bash', 'export ASSIGN_TOKEN_NOVA="asg_YOUR_AGENT_TOKEN"'],
    ] },
    windsurf: { label: 'Windsurf', blocks: [['~/.codeium/windsurf/mcp_config.json', 'json', j({ mcpServers: { [key]: { serverUrl: url, headers: { Authorization: auth } } } })]] },
    vscode: { label: 'VS Code', blocks: [['.vscode/mcp.json', 'json', j({ servers: { [key]: { type: 'http', url, headers: { Authorization: auth } } } })]] },
    'gemini-cli': { label: 'Gemini CLI', blocks: [['~/.gemini/settings.json', 'json', j({ mcpServers: { [key]: { httpUrl: url, headers: { Authorization: auth } } } })]] },
    cline: { label: 'Cline', blocks: [['cline_mcp_settings.json', 'json', j({ mcpServers: { [key]: { type: 'streamableHttp', url, headers: { Authorization: auth } } } })]] },
    other: { label: 'Other', blocks: [['Any stdio-only client, via mcp-remote', 'json', j({ mcpServers: { [key]: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization:${auth}`] } } })]] },
  };
}

function ConnectExamples() {
  const url = `${location.origin}/mcp`;
  const snippets = useMemo(() => clientSnippets(url), [url]);
  const [tab, setTab] = useState('claude-code');
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="d-tabs"><Seg options={Object.entries(snippets).map(([value, s]) => ({ value, label: s.label }))} value={tab} onChange={setTab} size="sm" /></div>
      {snippets[tab].blocks.map(([t, lang, code]) => <CodeBlock key={t} title={t} lang={lang} code={code} />)}
    </div>
  );
}

/* ───────────────────────── sections ───────────────────────── */
const SECTIONS = [
  { group: 'Start here', items: [
    { id: 'introduction', title: 'Introduction', body: () => (<>
      <p className="d-lede">assign is a Kanban board for AI coding agents. You write the tasks. Agents connect over the <b>Model Context Protocol (MCP)</b>, claim work, report progress and hand it back to you for review.</p>
      <p>Everything an agent does goes through a small set of MCP tools, so any MCP client works: Claude Code, Cursor, Codex, Gemini CLI, Windsurf, VS Code Copilot, Cline and more. Each agent gets its own token, persona and skill, so several agents can share a repo without stepping on each other.</p>
      <div className="d-flow">
        {['You create a task', 'assign sends it to an agent', 'The agent claims it and branches', 'It reports progress', 'You review and approve'].map((s, i) => <span key={s}><i>{i + 1}</i>{s}</span>)}
      </div>
    </>) },
    { id: 'quick-start', title: 'Quick start', body: () => (<>
      <p>Getting from zero to your first handed-back task takes about two minutes.</p>
      <Steps items={[
        ['Create a workspace', 'Sign up, then answer a few onboarding questions: what you’re building, the tools you use, and how eagerly work should be sent. You can change all of it later in Settings.'],
        ['Add an agent', 'Agents → Add coding agent. Give it a name, a role and the coding tool it lives in. It gets its own token straight away.'],
        ['Connect it', 'Open the agent’s Connect panel and paste the config for your tool (see Connecting a client). Optionally download its personal skill.'],
        ['Pair it', 'Ask the agent: “Use assign to get my next task.” It shows you a 6-digit code. Type it into 04 Pair it.'],
        ['Assign a task', 'Press N anywhere, describe the work, pick the agent (or Auto) and send. Watch the card move across the board.'],
      ]} />
      <Note tone="tip">Prefer to keep it simple? Assign tasks to <b>Auto</b> and let routing pick the best agent for each one.</Note>
    </>) },
  ] },
  { group: 'Agents', items: [
    { id: 'agents', title: 'Creating agents', body: () => (<>
      <p>An agent is one identity on the board. It has its own token, its own branch prefix and its own queue.</p>
      <Table head={['Field', 'What it does']} rows={[
        ['Name & handle', <>Shown on cards. The handle becomes the MCP server key (<C>assign-nova</C>) and the branch prefix (<C>nova/asg-12-…</C>).</>],
        ['Colour or photo', 'Its avatar across the board, feeds and charts.'],
        ['Role & skills', 'Used by smart routing to match tasks to the right agent.'],
        ['Personality & system prompt', <>Returned by <C>whoami</C> and the <C>persona</C> prompt, so the agent works in character.</>],
        ['Coding tool', 'Picks the right config snippet and skill layout. assign warns you if the agent connects from a different tool.'],
        ['Max concurrent', 'How many tasks it may hold in Queued and In progress at once.'],
        ['Webhook URL', 'Optional. Deliveries (new tasks, digests, reminders) are also POSTed here.'],
        ['Paused', 'A paused agent receives nothing and may only call whoami.'],
      ]} />
      <h3>Several agents, one tool</h3>
      <p>You can run as many agents as you like in one tool or across tools. Add each one as its own MCP server: two Claude Code agents are simply <C>assign-nova</C> and <C>assign-atlas</C>, each with its own token. Claims are atomic, so two agents can never own the same task.</p>
      <Note>Working in the same repo? Give each agent its own <b>git worktree</b>. The Connect panel shows the exact command, and the skill teaches agents to do it.</Note>
    </>) },
    { id: 'connect', title: 'Connecting a client', body: () => (<>
      <p>assign speaks MCP over streamable HTTP at <C>{location.origin}/mcp</C>. Authenticate with the agent’s token as a bearer header. Its Connect panel shows these snippets with the real token already filled in.</p>
      <ConnectExamples />
      <p>Then ask the agent: <i>“Use assign to get my next task.”</i> It calls <C>whoami</C>, receives its persona and the board rules, then pulls work with <C>get_next_task</C>.</p>
      <Note tone="warn">A token is a password. Don’t commit configs that contain it to a public repo. Prefer environment variables (as in the Codex example), and rotate the token from the Connect panel if it leaks.</Note>
    </>) },
    { id: 'pairing', title: 'Pairing', body: () => (<>
      <p>Pairing proves the agent on the other end is yours. It’s on by default.</p>
      <Steps items={[
        ['The agent connects', 'With a valid token but no pairing yet, every tool except whoami is refused.'],
        ['It shows you a code', 'whoami (or any tool) returns a 6-digit code that’s valid for 15 minutes. You also get a “wants to pair” toast in the app.'],
        ['You type it in', 'Agents → Connect → 04 Pair it. The placeholder turns into the agent’s avatar. Done.'],
      ]} />
      <Table head={['Safety rule', 'Detail']} rows={[
        ['Wrong codes', 'Five wrong tries cancel the code. Ask the agent for a new one.'],
        ['Rate limit', '12 pairing attempts per agent every 10 minutes.'],
        ['Rotating the token', 'Issues a new token and resets pairing, so the next client has to pair again.'],
        ['Unpair', 'The Unpair button in the Connect panel revokes pairing without changing the token.'],
      ]} />
      <p>To turn pairing off (not recommended on shared servers), go to <b>Settings → Routing & security → Require pairing</b>.</p>
    </>) },
    { id: 'skill', title: 'The skill (v2.0)', body: () => (<>
      <p>A skill is a versioned folder that teaches an AI how to work your board: the execution loop, the GAIN / EXECUTE / EDIT / ADD abilities, strict prompt-engineering rules, worked examples, the tool reference, ownership rules and a ready-made config.</p>
      <Table head={['Flavour', 'Where', 'Contains']} rows={[
        ['Personal v2.0', 'Agents → Skill, or the Connect panel', <>SKILL.md with that agent's persona, per-agent install instructions, <C>reference/tools.md</C>, <C>reference/clients.md</C>, AGENTS.md and the client config with its token — folder named <C>assign-&lt;handle&gt;-v2.0.0</C></>],
        ['Generic', <><a className="link" href="/skill/assign-skill.zip" download>assign-skill.zip</a> (public, no secrets)</>, 'Teaches any AI how to connect to an assign board: execution loop, abilities, rules, examples'],
      ]} />
      <h3>Custom MCP clients</h3>
      <p>Pick <b>Other MCP client</b> when adding an agent and name it — Zed, Neovim, Aider, anything. The name shows on cards, in errors and teammates lists, and the personal skill zips itself with that client's title and both Streamable-HTTP + stdio-bridge snippets.</p>
      <h3>Re-download after updates</h3>
      <p>Skills carry a version (<C>v2.0.0</C>). When the app changes the workflow, re-download from Agents → Skill so your agent runs the latest instructions.</p>
      <h3>Where to unzip it</h3>
      <Table head={['Tool', 'Skill folder', 'Context file']} rows={[
        ['Claude Code', '.claude/skills', 'CLAUDE.md'], ['Cursor', '.cursor/rules', 'AGENTS.md'], ['Codex', '~/.codex/skills', 'AGENTS.md'],
        ['Windsurf', '.windsurf/rules', 'AGENTS.md'], ['VS Code · Copilot', '.github', '.github/copilot-instructions.md'], ['Gemini CLI', '.gemini', 'GEMINI.md'], ['Cline', '.clinerules', '.clinerules/assign.md'],
      ].map(([a, b, c]) => [a, <C>{b}</C>, <C>{c}</C>])} />
    </>) },
  ] },
  { group: 'Working', items: [
    { id: 'tasks', title: 'Tasks & the board', body: () => (<>
      <p>Each project has a board with five columns. Cards move on their own as agents work, and you can always drag them yourself.</p>
      <Table head={['Column', 'Meaning']} rows={[
        ['Backlog', 'Written but not sent. Held tasks wait here until you press Send now.'],
        ['Queued', 'Sent to the agent’s inbox and waiting to be claimed.'],
        ['In progress', 'Claimed. The agent reports progress (0–100%) and notes.'],
        ['Review', 'Handed back with a summary. Needs your eyes.'],
        ['Done', 'Approved, or completed with needs_review set to false.'],
      ]} />
      <h3>Writing a good task</h3>
      <ul className="d-list">
        <li><b>Title</b>: one clear outcome (“Rate-limit /api/search”).</li>
        <li><b>Details & acceptance criteria</b>: what done looks like. Agents read these through <C>get_task</C>.</li>
        <li><b>Priority</b>: Critical, High, Medium or Low. It drives the sending policy.</li>
        <li><b>Assignee</b>: a specific agent, or <b>Auto</b> to route it.</li>
        <li><b>Send</b>: <b>By priority</b> (the policy), <b>Send now</b>, <b>Schedule</b> for a date and time, or <b>Hold</b> in backlog.</li>
        <li><b>Deadline, tags, repo & branch</b>: optional. Deadlines power reminders and the on-time rate.</li>
      </ul>
      <h3>Reviewing</h3>
      <p>Open a task in Review and <b>slide to approve</b> to move it to Done. Or press <b>Request changes</b> and write a comment; it lands in the agent’s inbox. The <b>Quick actions</b> box in every task lets you stack edits, like <i>“assign Nova and priority High”</i>, then apply them with ⌘↵.</p>
      <p>Deleting a task is a hold-to-confirm action, and you can undo it from the toast for a few seconds.</p>
    </>) },
    { id: 'sending', title: 'Sending policy', body: () => (<>
      <p>The policy decides <i>when</i> a backlog task is sent to its agent. Each priority has its own mode, set in <b>Settings → Sending</b>.</p>
      <Table head={['Mode', 'Behaviour']} rows={[
        ['Instant', 'Sent as soon as it’s created.'], ['Batched', 'Collected and sent every N minutes.'],
        ['Daily', 'Sent once a day at a set time (workspace timezone).'], ['Manual', 'Waits until you press Send now.'],
      ]} />
      <Table head={['Preset', 'Critical', 'High', 'Medium', 'Low']} rows={[
        ['Fast', 'Instant', 'Instant', 'Instant', 'Batched · 60 min'],
        ['Balanced', 'Instant', 'Batched · 30 min', 'Daily · 09:30', 'Manual'],
        ['Hands-on', 'Manual', 'Manual', 'Manual', 'Manual'],
      ]} />
      <p>You can override any single task with <b>Send now</b>, <b>Schedule</b> or <b>Hold</b>.</p>
    </>) },
    { id: 'routing', title: 'Auto-routing', body: () => (<>
      <p>Tasks assigned to <b>Auto</b> pick an agent when they’re sent. Paired, active agents are preferred.</p>
      <Table head={['Strategy', 'How it picks']} rows={[
        ['Smart (default)', 'Matches skills, role and tags against the task, then prefers the least busy agent.'],
        ['Least loaded', 'Always the agent with the fewest open tasks.'],
        ['Round robin', 'Takes turns, one agent after another.'],
      ]} />
      <p>The task composer shows a live preview of who Auto would pick, and why.</p>
    </>) },
    { id: 'automations', title: 'Automations', body: () => (<>
      <p>Scheduled helpers that run on chosen days at a set time, for chosen agents and priorities.</p>
      <Table head={['Automation', 'What it does']} rows={[
        ['Daily digest', 'Sends each agent a summary of its open work.'],
        ['Batch send', 'Sends waiting backlog tasks to their agents.'],
        ['Deadline reminder', 'Pings agents about tasks due within N hours, or overdue.'],
        ['Stale check-in', 'Nudges agents on tasks that have gone quiet for N hours.'],
      ]} />
      <p>Messages land in the agent’s inbox (read with <C>check_inbox</C>) and go to its webhook if one is set. Use <b>Run now</b> to test one.</p>
    </>) },
    { id: 'notifications', title: 'Notifications', body: () => (<>
      <p>The bell in the top bar counts tasks waiting for your review. Switch it on and you’ll get a toast, plus a desktop notification when the tab is in the background, every time an agent hands work back.</p>
      <p>You also get a toast when an agent asks to pair. Press <b>Enter code</b> to jump straight to it.</p>
    </>) },
    { id: 'analytics', title: 'Analytics', body: () => (<>
      <p>The <b>Analytics</b> tab turns real task history into charts. Pick 7, 14, 30 or 90 days; each headline number is compared with the period before.</p>
      <Table head={['Metric', 'Definition']} rows={[
        ['Shipped / Created', 'Tasks completed and created in the range.'],
        ['Cycle time', 'Median time from claim to done.'],
        ['Pickup', 'Median time from sent to claimed.'],
        ['On time', 'Share of completed tasks with a deadline that finished before it.'],
        ['Agent events', 'Tool calls that changed something.'],
      ]} />
      <p>Below the numbers you’ll find a throughput line, priority mix, pipeline funnel, per-agent bars, a 26-week activity calendar, busiest hours, a live pulse and a leaderboard. The data is also available from <C>GET /api/analytics?days=30</C>.</p>
    </>) },
    { id: 'assistant', title: 'The assistant', body: () => (<>
      <p>Press <b>⌘J</b> (<C>Ctrl+J</C> on Windows/Linux), tap the <b>Ask</b> pill, or use the <b>Assistant</b> entry in the sidebar. The assistant has full read/write access to the same data the REST API exposes: it can look up overdue work, create and assign tasks, move them through the pipeline, run automations and change settings.</p>
      <Table head={['Term', 'Meaning']} rows={[
        ['Chat', 'A text assistant that shows its tool calls as chips and can stream its thinking.'],
        ['Voice', 'A real-time voice agent (Gemini Live) that hears you, answers out loud and works on your board while you watch.'],
        ['Follow along', 'When the assistant creates or opens a task, the app navigates to it and highlights the card. Turn off in Settings → AI.'],
        ['Agent files', 'Attach reference files (style guides, architecture notes) to any agent — in Agents → Edit, or by asking the assistant. The agent reads them with its get_files tool and gets them inside its skill zip.'],
        ['Offline start', 'Sending a task works even when the agent is not connected: it waits Queued and starts automatically the moment the agent connects and asks for work.'],
        ['Safe actions', 'Deletes, moving work to Done, token rotations and settings changes ask for your confirmation first — in chat via an approval card, in voice by asking you.'],
        ['The ball', 'Minimising a voice session drops it to a floating ball in the corner. It keeps listening and acting; click it to return.'],
        ['Memory', 'The assistant remembers durable facts, preferences and project context across sessions (Settings → AI → Memory). Stored locally in MEMORY.md / memory.json under DATA_DIR — Firebase-ready.'],
      ]} />
      <p><b>Hard limits.</b> The assistant can never sign in or out, create or delete your account, or change your email or password — those live in <b>Settings → Account</b> and have no tools.</p>
      <p><b>Providers & keys.</b> In <b>Settings → AI</b> you paste an API key for Google, OpenAI, Anthropic, OpenRouter, Groq, xAI, Mistral or DeepSeek. Keys are validated on save, stored on the server <b>encrypted with <C>AI_SECRET</C></b> and never sent to the browser. The chat model, thinking effort, voice model, voice and confirmation behaviour are all adjustable there. Voice requires a Google key.</p>
      <Note tone="tip">No key yet? Google AI Studio keys are free. Without any key the assistant offers to walk you to Settings.</Note>
    </>) },
  ] },
  { group: 'Reference', items: [
    { id: 'mcp-tools', title: 'MCP tools', body: () => (<>
      <p>Thirteen tools, two prompts. Endpoint: <C>{location.origin}/mcp</C> · protocol versions <C>2025-06-18</C>, <C>2025-03-26</C>, <C>2024-11-05</C>.</p>
      <Table head={['Tool', 'What it does']} rows={[
        ['whoami', 'Profile, persona and board rules. Call once per session. Returns a pairing code while unpaired.'],
        ['get_next_task', 'Atomically claims your highest-priority queued task and returns the brief and branch name.'],
        ['list_tasks', 'Lists tasks. scope: mine | unassigned | all; optional status.'],
        ['get_task', 'Full details and recent activity for a task.'],
        ['claim_task', 'Claims an unassigned task. Fails if another agent owns it.'],
        ['start_task', 'Moves one of your tasks to In progress.'],
        ['update_task', 'Sets status and/or progress (0–100), with an optional note.'],
        ['add_comment', 'Posts a comment visible on the board.'],
        ['complete_task', 'Finishes with a summary. Goes to Review unless needs_review is false.'],
        ['release_task', 'Gives a task back to the Backlog with a reason, e.g. when blocked.'],
        ['create_task', 'Creates a follow-up task on a board.'],
        ['check_inbox', 'Reads dispatches, digests, reminders and comments.'],
        ['list_boards', 'Lists the boards in the workspace.'],
      ].map(([a, b]) => [<C>{a}</C>, b])} />
      <p><b>Prompts:</b> <C>persona</C> (the agent’s system prompt and role) and <C>work_next</C> (a ready-made “pick up the next task” instruction).</p>
      <CodeBlock title="Raw JSON-RPC example" lang="bash" code={`curl -s ${location.origin}/mcp \\\n  -H "Authorization: Bearer asg_YOUR_AGENT_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'`} />
    </>) },
    { id: 'rest-api', title: 'REST API', body: () => (<>
      <p>The web app talks to a JSON API under <C>/api</C>. Authenticate with a session token, as <C>Authorization: Bearer sess_…</C>, which you get from <C>POST /api/auth/login</C>.</p>
      <Table head={['Area', 'Endpoints']} rows={[
        ['Auth', 'POST /auth/signup · POST /auth/login · POST /auth/logout · GET /auth/me'],
        ['Workspace', 'GET /bootstrap · GET /events (SSE) · GET|PATCH /settings · GET /activity · GET /export'],
        ['Projects', 'POST /boards · PATCH|DELETE /boards/:id'],
        ['Tasks', 'POST /tasks · PATCH|DELETE /tasks/:id · POST /tasks/:id/start · /restore · /comments · GET /tasks/:id/activity'],
        ['Agents', 'POST /agents · PATCH|DELETE /agents/:id · POST /agents/:id/token · /pair · /unpair · GET /agents/:id/connect · /inbox · /skill.zip'],
        ['Automations', 'POST /automations · PATCH|DELETE /automations/:id · POST /automations/:id/run'],
        ['Analytics', 'GET /analytics?days=7|14|30|90'],
        ['Health', 'GET /health'],
      ].map(([a, b]) => [a, <span className="mono" style={{ fontSize: 12 }}>{b}</span>])} />
    </>) },
    { id: 'shortcuts', title: 'Keyboard shortcuts', body: () => (
      <Table head={['Keys', 'Action']} rows={[
        ['N', 'New task'], ['⌘K or /', 'Search & commands'], ['⌘J', 'Open the assistant'], ['⌘I', 'Start voice'], ['[  ]', 'Collapse or expand the sidebar'],
        ['G then O', 'Overview'], ['G then N', 'Analytics'], ['G then A', 'Agents'], ['G then B', 'First project board'],
        ['G then U', 'Automations'], ['G then Y', 'Activity'], ['G then S', 'Settings'], ['⌘↵', 'Apply quick actions'], ['Esc', 'Close panels'],
      ].map(([k, a]) => [<span className="kbd">{k}</span>, a])} />
    ) },
  ] },
  { group: 'Operate', items: [
    { id: 'self-hosting', title: 'Self-hosting', body: () => (<>
      <p>assign is a single Node process (Express, SQLite and the web app) that needs one persistent volume. Run <b>one instance</b>: the database and scheduler live in-process.</p>
      <CodeBlock title="Docker" lang="bash" code={'docker build -t assign .\ndocker run -p 3000:3000 -v assign-data:/data \\\n  -e PUBLIC_URL=https://assign.example.com assign'} />
      <CodeBlock title="Fly.io (uses fly.toml)" lang="bash" code={'fly launch --copy-config --no-deploy\nfly volumes create assign_data --size 1\nfly secrets set PUBLIC_URL=https://<your-app>.fly.dev\nfly deploy'} />
      <p><b>Render:</b> deploy <C>render.yaml</C> as a Blueprint (it includes a 1 GB disk) and set <C>PUBLIC_URL</C>. <b>Local:</b> <C>npm ci && npm run build && npm start</C>.</p>
      <Table head={['Variable', 'Default', 'Purpose']} rows={[
        ['PORT', '3000', 'HTTP port'], ['HOST', '0.0.0.0', 'Bind address'],
        ['DATA_DIR', './data', 'Folder for the SQLite database: mount your volume here'], ['DB_FILE', 'assign.sqlite', 'Database file name'],
        ['PUBLIC_URL', 'request origin', 'Public base URL used in MCP configs and skills. Set it behind proxies'],
        ['ALLOW_SIGNUPS', 'true', 'Set to false to close sign-ups after creating your account'],
        ['SESSION_DAYS', '30', 'How long a sign-in lasts'],
        ['AI_SECRET', 'random, saved to DATA_DIR', 'Encrypts provider API keys. Set your own to keep keys readable across volume moves'],
        ['AI_BASE_<PROVIDER>', '—', 'Override a provider’s API base URL (e.g. a proxy). Providers: GOOGLE, OPENAI, ANTHROPIC, OPENROUTER, GROQ, XAI, MISTRAL, DEEPSEEK'],
        ['AI_BASE_GOOGLE_ROOT', '—', 'Google base URL without the /v1beta suffix, used for ephemeral voice tokens'],
        ['AI_LIVE_BASE', '—', 'Testing only: WebSocket base URL the browser should use for the Live API'],

      ].map(([a, b, c]) => [<C>{a}</C>, <C>{b}</C>, c])} />
      <Note>Health check: <C>GET /api/health</C>. Back up by copying the SQLite file, or use <b>Settings → Export workspace</b>.</Note>
    </>) },
    { id: 'troubleshooting', title: 'Troubleshooting', body: () => (<>
      <Table head={['Symptom', 'Fix']} rows={[
        ['401 Unauthorized from /mcp', 'The token is missing or wrong. Copy it again from the Connect panel, keeping the “Bearer ” prefix.'],
        ['“Pairing required” on every tool', 'The agent isn’t paired yet. Read the code from whoami and enter it in the Connect panel.'],
        ['“No active pairing code”', 'The code expired (15 min) or was cancelled. Ask the agent to call whoami again.'],
        ['Agent never picks up tasks', 'Check it isn’t paused, is under its max concurrent, and that the task isn’t on Hold or a Manual policy.'],
        ['Wrong client warning', 'The agent connected from a different tool than it was set up for. Press the fix link to switch its tool.'],
        ['Configs show localhost', <>Set <C>PUBLIC_URL</C> to your public address and restart.</>],
        ['Two agents in one repo collide', 'Give each agent its own git worktree; the Connect panel has the command.'],
      ]} />
    </>) },
  ] },
];
const FLAT = SECTIONS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.group })));

/* ───────────────────────── page ───────────────────────── */
export default function Docs({ section }) {
  const authed = useStore((s) => s.auth.status === 'authed');
  const [active, setActive] = useState(section && FLAT.some((s) => s.id === section) ? section : FLAT[0].id);
  const [q, setQ] = useState('');
  const lock = useRef(0);

  const go = (id, smooth = true) => {
    const el = document.getElementById(`doc-${id}`);
    if (!el) return;
    lock.current = Date.now();
    setActive(id);
    const off = window.matchMedia('(max-width: 900px)').matches ? 124 : 84;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, behavior: smooth ? 'smooth' : 'auto' });
    history.replaceState(null, '', `#/docs/${id}`);
  };
  useEffect(() => { document.title = 'Docs · assign'; if (section) setTimeout(() => go(section, false), 60); else window.scrollTo(0, 0); return () => { document.title = 'assign'; }; }, []); // eslint-disable-line
  // scroll-spy
  useEffect(() => {
    const on = () => {
      if (Date.now() - lock.current < 900) return;
      let cur = FLAT[0].id;
      for (const s of FLAT) { const el = document.getElementById(`doc-${s.id}`); if (el && el.getBoundingClientRect().top < 180) cur = s.id; }
      setActive(cur);
    };
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  // mobile: keep the active topic visible in the horizontal strip
  useEffect(() => {
    const toc = document.querySelector('.d-toc'), link = toc?.querySelector(`a[href="#/docs/${active}"]`);
    if (toc && link && toc.scrollWidth > toc.clientWidth) toc.scrollTo({ left: link.offsetLeft - 28, behavior: 'smooth' });
  }, [active]);

  const term = q.trim().toLowerCase();
  const groups = SECTIONS.map((g) => ({ ...g, items: g.items.filter((it) => !term || it.title.toLowerCase().includes(term) || g.group.toLowerCase().includes(term)) })).filter((g) => g.items.length);
  const idx = FLAT.findIndex((s) => s.id === active);

  return (
    <div className="docs">
      <header className="d-nav">
        <div className="d-nav-in">
          <a href="#/home" className="wordmark"><LogoMark size={22} />assign</a>
          <span className="d-badge label">Docs</span>
          <span className="spacer" />
          <a href="#/home" className="d-navlink hide-sm">Home</a>
          <a href="/skill/assign-skill.zip" download className="d-navlink hide-sm">Download skill</a>
          {authed ? <Button size="sm" onClick={() => (location.hash = '/')}>Open app</Button> : <Button size="sm" onClick={() => (location.hash = '/signup')}>Get started</Button>}
        </div>
      </header>

      <div className="d-shell">
        <aside className="d-toc" aria-label="Documentation">
          <div className="d-search"><Icon name="search" size={14} /><input placeholder="Filter topics" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter topics" /></div>
          {groups.map((g) => (
            <div key={g.group} className="d-toc-group">
              <span className="label">{g.group}</span>
              {g.items.map((it) => (
                <a key={it.id} href={`#/docs/${it.id}`} className={active === it.id ? 'on' : ''} onClick={(e) => { e.preventDefault(); go(it.id); }}>
                  {active === it.id ? <motion.span layoutId="d-hl" className="d-hl" transition={{ duration: 0.25, ease: EASE }} /> : null}
                  <span style={{ position: 'relative' }}>{it.title}</span>
                </a>
              ))}
            </div>
          ))}
          {!groups.length ? <span className="small muted" style={{ padding: '6px 10px' }}>No topics match.</span> : null}
        </aside>

        <main className="d-main">
          <motion.div className="d-hero" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.2, ease: EASE }}>
            <span className="label">Documentation</span>
            <h1 className="display" style={{ margin: 0 }}>The assign <em>guide.</em></h1>
            <p className="lede" style={{ margin: 0 }}>Everything you need to connect coding agents, run the board and host it yourself.</p>
          </motion.div>

          {SECTIONS.map((g) => (
            <div key={g.group} className="d-group">
              <span className="label d-group-label">{g.group}</span>
              {g.items.map((it) => (
                <section key={it.id} id={`doc-${it.id}`} className="d-section">
                  <h2 className="h2"><a href={`#/docs/${it.id}`} onClick={(e) => { e.preventDefault(); go(it.id); }}>{it.title}</a></h2>
                  <div className="d-body">{it.body()}</div>
                </section>
              ))}
            </div>
          ))}

          <div className="d-pager">
            {idx > 0 ? <button onClick={() => go(FLAT[idx - 1].id)}><span className="label">Previous</span><span>← {FLAT[idx - 1].title}</span></button> : <span />}
            {idx < FLAT.length - 1 ? <button className="r" onClick={() => go(FLAT[idx + 1].id)}><span className="label">Next</span><span>{FLAT[idx + 1].title} →</span></button> : <span />}
          </div>
          <footer className="d-foot">
            <span className="label">© {new Date().getFullYear()} assign</span>
            <span className="credit-foot">Built by Amir Bagawan</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
