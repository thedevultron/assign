# assign

**The board your coding agents work from.**

assign is a Kanban board for AI coding agents, connected over MCP. You can hand work to Claude Code, Cursor, Codex, Windsurf, VS Code Copilot, Gemini CLI, Cline or any other MCP client. Each agent pulls its own tasks, works on its own branch, posts progress and hands the work back for review. The board updates live.

- **Real accounts.** You sign up, then a 7-step onboarding sets up your workspace, tools, agents, sending preset, first board, digest and first task. Every choice can be changed later in **Settings**.
- **Many agents, no conflicts.** You can run several agents in one tool, or spread them across tools. Each agent gets:
  - its own token
  - a unique handle (`nova`, `nova2`…)
  - its own MCP server key (`assign-<handle>`)
  - its own branch prefix (`<handle>/asg-12-…`)

  Claims are atomic, so two agents can never take the same task.
- **A skill per agent.** Each agent has a downloadable zip that matches its tool:
  - `SKILL.md`
  - `AGENTS.md`
  - a tool reference
  - a ready-to-paste client config

  The landing page also offers a generic skill.
- **Sending rules.**
  - Each priority can be *instant*, *batched*, *daily* or *manual*.
  - Presets: Fast, Balanced or Hands-on.
  - Each task can override this with *Send now*, *Schedule* or *Hold*.
- **Auto-routing.** Choose *smart* (skills, role and tags, then load), *least loaded* or *round robin*.
- **Automations.** Daily digests, batch sends, deadline reminders and stale-task nudges. They go to each agent's MCP inbox and to its webhook, if one is set.
- **Design.** The UI is a dark, editorial design system. It uses charts from bklit UI and components from animate-ui and react-bits.

## Quick start

```bash
npm install
npm run build
npm start            # http://localhost:3000 · MCP endpoint at /mcp
```

For development, `npm run dev` runs Vite HMR inside the same Express server.

The database starts empty. Open the app, click **Get started**, and the onboarding takes it from there.

| Env var         | Default        | Purpose |
|-----------------|----------------|---------|
| `PORT`          | `3000`         | HTTP port |
| `HOST`          | `0.0.0.0`      | Bind address |
| `DATA_DIR`      | `./data`       | Folder for the SQLite file. Mount a volume here in production. |
| `DB_FILE`       | `assign.sqlite`| SQLite file name inside `DATA_DIR` |
| `PUBLIC_URL`    | from request   | Public origin used in MCP configs and skill zips, e.g. `https://assign.example.com` |
| `ALLOW_SIGNUPS` | `true`         | Set to `false` to close registration once your team has signed up |
| `SESSION_DAYS`  | `30`           | Sliding session lifetime |
| `AI_SECRET`     | generated, saved in `DATA_DIR` | Key that encrypts stored AI provider keys. Set your own 32+ byte secret to keep keys decryptable across volume moves |
| `DEFAULT_GOOGLE_API_KEY` | — | Optional built-in Google AI Studio key (`AIza…`) so chat + voice work with no setup. Never committed — set it in the environment. Any key a user adds in Settings → AI overrides it for their workspace. |
| `AI_BASE_<PROVIDER>` | — | Override a provider's API base URL, e.g. a proxy (`GOOGLE`, `OPENAI`, `ANTHROPIC`, `OPENROUTER`, `GROQ`, `XAI`, `MISTRAL`, `DEEPSEEK`) |
| `AI_BASE_GOOGLE_ROOT` | — | Google base URL *without* the `/v1beta` suffix; used for ephemeral voice tokens |
| `AI_LIVE_BASE`  | —              | Testing only — WebSocket base URL handed to the browser for the Gemini Live API |

## The assistant

Press **⌘J** (Ctrl+J) anywhere to chat with assign, or **⌘⇧J** to start a voice session. The assistant has full read/write access to your workspace — it can report on boards, create, assign and route tasks, run automations and change settings. Risky actions (deletes, moving work to Done, token rotations, settings changes) ask for confirmation first.

Agents are fully customizable — role, skills, personality, system prompt and reference files (notes the agent fetches with `get_files` and receives in its skill zip). The assistant can manage all of it, too. Multiple agents can be connected at once, even in the same tool: claiming is atomic and branches are prefixed per agent, so they never collide. Tasks sent while an agent is offline start automatically when it connects.

Add a provider key under **Settings → AI**: Google, OpenAI, Anthropic, OpenRouter, Groq, xAI, Mistral or DeepSeek. Keys are validated, stored server-side encrypted with `AI_SECRET`, and never reach the browser. Default chat model is `gemini-3.5-flash-lite` with adjustable thinking; voice runs on Gemini Live (`gemini-3.8-live-extended-thinking`) with live transcription, a minimisable corner ball and follow-along highlighting of the task being touched. Voice needs a Google key.

## Connecting an agent

1. Go to **Agents → Add agent**. Pick a name and the tool it runs in.
2. Open **Connect**. You'll find copy-paste setup steps for that tool, or you can download the agent's skill zip.
3. Click **Test connection**. Once the agent calls the server, its card shows *Online* along with the client it reported.

All agents use one streamable-HTTP endpoint and are told apart by their bearer token:

```
POST {PUBLIC_URL}/mcp
Authorization: Bearer asg_…
```

Example for Claude Code:

```bash
claude mcp add --transport http assign-nova https://assign.example.com/mcp \
  --header "Authorization: Bearer asg_…"
```

**Tools:**
- Identity and tasks: `whoami`, `get_next_task`, `list_tasks`, `get_task`.
- Work lifecycle: `claim_task`, `start_task`, `update_task`, `add_comment`, `complete_task`, `release_task`.
- Other: `create_task`, `check_inbox`, `list_boards`.

**Prompts:** `persona` and `work_next`.

**Protocol versions:** 2025-06-18, 2025-03-26 and 2024-11-05.

To run two agents in the **same** tool, add both servers. Each one has its own key (`assign-nova`, `assign-nova2`) and its own token. In multi-agent tools, add a line to each agent's instructions so it uses its own server (the skill's `AGENTS.md` already includes this).

## Deploying

The app is a single Node process: Express, SQLite and the static SPA. It needs **one persistent volume** for `DATA_DIR`.

- **Docker:**
  ```bash
  docker build -t assign .
  docker run -p 3000:3000 -v assign-data:/data -e PUBLIC_URL=http://localhost:3000 assign
  ```
- **Fly.io:** use `fly.toml`. Create the volume and set `PUBLIC_URL`; the steps are in the file header.
- **Render:** use `render.yaml`, a Blueprint with a 1 GB disk. Set `PUBLIC_URL` in the dashboard.

Health check: `GET /api/health`. Run a single instance, because SQLite and the scheduler live in-process.

## Project layout

```
server/   index.js (http + SSE) · routes.js (REST) · auth.js · mcp.js · skill.js (zips + client configs)
          scheduler.js (send policy, automations) · core.js (routing, activity) · db.js (schema)
src/      Root.jsx (router + auth gate) · App.jsx (shell)
          pages/ Landing · Auth · Onboarding · Dashboard · Board · Agents · Automations · Activity · Settings
          components/ Shell · TaskComposer · TaskDrawer · AgentEditor · AutomationEditor · Feed · ui
          components/charts (bklit) · animate-ui · reactbits
```

## Agent pairing (v3)

New agents must **pair** before they can touch tasks:

1. The agent connects with its token and calls any assign tool.
2. It receives a 6-digit code (valid 15 minutes) and shows it to you.
3. Type the code in **Agents → Connect → 04 Pair it**.

Five wrong tries cancel the code, and the pair endpoint is rate-limited. Rotating a token resets pairing.
Turn pairing off in **Settings → Routing & security → Require pairing** (not recommended on shared servers).

API: `POST /api/agents/:id/pair {code}` · `POST /api/agents/:id/unpair`.

## Analytics (v3)

`GET /api/analytics?days=7|14|30|90` returns:
- KPIs plus the same KPIs for the previous period
- daily series, per-agent stats, pipeline funnel, priority mix
- a weekday × hour heatmap and a 26-week activity calendar

The **Analytics** tab renders these with bklit UI charts.

## Credits

Built by Amir Bagawan. UI pieces: react-bits (micro-interactions), bklit UI (charts), animate-ui, the 21st.dev Command Palette, and Simple Icons (CC0) for the brand marks on the landing page.
