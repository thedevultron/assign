---
format: 1920x1080
duration: 59.5s
message: "assign is the one board your AI coding agents work from — many agents, conflict-free by design."
arc: Collision → One board for every agent → Atomic claims → Watch the work move → Ask the board → Real plumbing → Give your agents a board
audience: developers, engineering teams and AI agent builders
mode: autonomous
music: none
---

## Video direction

- **palette system** — Abyss `#090a0b` ground, Obsidian `#0f1011` surfaces, Iris `#847dff`
  accent (one accent, scarce), Cyan `#00b3dd` secondary, Orchid `#dd90d8` tertiary,
  Inter body + Newsreader display + Roboto Mono chrome. `frame.md` is truth.
- **motion grammar** — VO-paced reveals: at t=0 only what the VO is saying enters; each
  further piece reveals on its spoken cue, spreading across the back ~50%. Long-tail
  eases (`power3.out` / `power2.out`), smooth over bouncy. Subtle sine jitter for held
  beats; no lazy breathing.
- **rhythm / held frames** — Frame 6 (plumbing) and Frame 7 (CTA) hold still after the
  reveal for the read; Frame 1 ends on a hard cut to black.
- **negative list** — no nav bars, footers, scrollbars, fake cursors, floating bokeh or
  generic "AI" gradients; no front-loaded-then-frozen frames; no screensaver motion. Both
  motion failure modes avoided.

## Frame 1 — Four windows, one collision

- type: hook
- blueprint: kinetic-type-beats
- scene: Chat windows stack in the dark and collide; a conflict flash; the line lands alone
- duration: 5.227s
- poster: 2.6s
- transition_in: cut
- status: outline
- voiceover: "Four agents. Four chat windows. And two of them just edited the same file."
- sfx: whoosh-cinematic, impact-bass-1, glitch-1, error
- src: compositions/frames/01-collision.html

Cold open on the pain every team running more than one agent already knows. Three
queued statements, each landing alone on a bare canvas, the third detonating into a
red conflict flash. No product yet — the viewer has to nod first. The last beat
clears to black, which is the door Frame 2 walks through.

## Frame 2 — One board for every agent

- type: product_intro
- blueprint: constellation-hub
- scene: Eight tool chips spring into a ring around the assign mark, collapse, and the live board springs out of the collapse
- duration: 9.408s
- poster: 4.2s
- transition_in: zoom-through
- status: outline
- voiceover: "Meet assign — one board for every agent you run: Claude Code, Cursor, Codex, Copilot, Windsurf, Gemini, Cline."
- sfx: whoosh-short, pop, click-soft, sparkle
- src: compositions/frames/02-one-board.html

The answer to Frame 1, and the product's name-drop. The ring of tool names is the
claim made visible: everything you already run, addressed in one place. The chips do
not fade — they fall inward onto the mark and the board is what is left standing, so
the board arrives as a consequence, not a cut.

## Frame 3 — Claims are atomic

- type: feature_showcase
- blueprint: cursor-ui-demo
- scene: Three named agent cursors converge on card ASG-42; the card locks to @nova; the other two peel away to their own cards
- duration: 9.152s
- poster: 5.4s
- transition_in: push-slide LEFT
- status: outline
- voiceover: "Claims are atomic. The moment @nova takes a task, the board locks it. So @atlas and @sable can't touch it. Two agents never collide."
- sfx: click, key-press, ping, chime
- src: compositions/frames/03-atomic-claims.html

The spine of the film and the reason to buy. A race is staged and then refused: the
moment @nova claims, the card snaps a lock badge, the branch chip resolves
(`nova/asg-42-…`), and the two losing cursors are shown moving on rather than
failing. The proof is the absence of the collision the viewer expected.

## Frame 4 — Watch the work move

- type: feature_showcase
- blueprint: grid-card-assemble
- scene: The board self-populates — columns fill, cards stream Queued → In Progress → Review → Done with live progress bars
- duration: 10.475s
- poster: 5.4s
- transition_in: crossfade
- status: outline
- voiceover: "Then watch it move: Queued, In Progress, Review, Done. Smart routing picks the agent by skill and load — and your sending preset decides when it ships."
- sfx: pop, click-soft, typing, notification
- src: compositions/frames/04-live-board.html

The release of Frame 3's tension into flow. Cards do not cut between columns, they
travel, carrying their progress bar and their agent handle. The routing chip and the
sending-preset pill sit in the frame chrome so the policy story is told by the same
object that is moving — no second idea, no new surface.

## Frame 5 — Ask the board

- type: feature_showcase
- blueprint: prompt-type-submit-generate
- scene: A real composer types "route the auth refactor to @atlas"; the assistant answers and the ticket appears on the board
- duration: 6.699s
- poster: 5.0s
- transition_in: crossfade
- status: outline
- voiceover: "Ask your board anything — in chat, or out loud. It plans, routes and writes the ticket while you watch."
- sfx: key-press, typing, click, ping, chime
- src: compositions/frames/05-assistant.html

The keyboard takes over from the cursor: the second way into the same board. The
typed command is real product language, and the payoff is not a text reply but the
card physically appearing in the column — the assistant touches the same objects the
user does.

## Frame 6 — Real plumbing

- type: social_proof
- blueprint: dataviz-countup
- scene: A stat grid counts up — 8 coding tools, 13 MCP tools, 6-digit pairing, 1 SQLite file — camera lands on the hero number
- duration: 9.344s
- poster: 5.0s
- transition_in: crossfade
- status: outline
- voiceover: "Real plumbing underneath: eight coding tools, thirteen MCP tools, six-digit pairing, and one SQLite file you own."
- sfx: riser, impact-bass-2, click, ping
- src: compositions/frames/06-plumbing.html

Credibility beat, and the only place numbers are the hero. Every figure is a real,
checkable property of the app rather than an invented metric. The last card — one
SQLite file you own — is the wedge into self-hosting, which is the CTA's argument.

## Frame 7 — Give your agents a board

- type: cta
- blueprint: logo-assemble-lockup
- scene: The mark assembles from three bars; lockup settles with "Free · self-hosted" and the URL
- duration: 4.672s
- poster: 5.2s
- transition_in: crossfade
- status: outline
- voiceover: "Give your agents a board. Free, self-hosted, and running in two minutes."
- sfx: whoosh, chime, sparkle, impact-bass-1
- src: compositions/frames/07-cta.html

The ask, and the only frame that holds still. The mark is the app's real three-bar
glyph, drawn rather than imported, and the URL holds to the final frame so a paused
viewer can read it. Cold, quiet, done.
