---
workflow: product-launch-video
flow: automation
storyboard: no
message: "assign is the one board your AI coding agents work from — many agents, conflict-free by design."
destination: website-embed
aspect: 1920x1080
language: en
audience: developers, engineering teams and AI agent builders
length: 60s
angle: conflict-free-agent-team
style_preset: code-editorial
---

## Intent

A 60-second premium launch promo for **assign** — the Kanban board your AI coding
agents work from. The spine is the differentiator the product owns: run many agents
(Claude Code, Cursor, Codex, Windsurf, Copilot, Gemini CLI, Cline) on one board and
they never collide, because task claims are atomic and every agent gets its own
identity, token and branch. Tone is dark, editorial and precision-engineered — the
feel of a well-made developer tool, not a marketing deck. Premium motion: kinetic
typography, a live board, real code surfaces, count-up numbers.

## Assets

- The **assign** app in this workspace (`assign/`) is the product and the source of
  truth for brand tokens, feature copy, agent handles (`@nova`, `@atlas`, `@sable`),
  task keys (`ASG-42`), branch prefixes (`nova/asg-42-…`) and the dark editorial
  design system (Obsidian/Abyss canvas, Iris `#847dff`, Cyan `#00b3dd`, Orchid
  `#dd90d8`, Inter + Newsreader + Roboto Mono).
- `assign/src/assets/hero-clouds.jpg`, `assign/src/assets/board-shot.jpg` — real
  product imagery from the app.
- `product demo/assets/sfx/` (sibling project, read-only) — a curated SFX pack
  (`whoosh-cinematic`, `whoosh-short`, `whoosh`, `impact-bass-1/2`, `riser`,
  `typing`, `key-press`, `click`, `click-soft`, `pop`, `ping`, `chime`, `sparkle`,
  `notification`, `glitch-1/2/3`, `error`, `error`); reuse by copying in.

## Customizations

- **SFX on every beat** — cinematic whoosh + sub-bass impact opens; typing/clack
  under code; soft pops as cards move; lock click + ping on the atomic claim; riser
  into the finale impact. Authored as `sfx:` cues in `STORYBOARD.md`.
- **Placeholder voiceover** — a local (Kokoro) narration track stands in so word
  timings are real and the cut is complete. The user replaces it with their own
  voice. The transcript with per-beat timing ships alongside as `SCRIPT.md`.
- **No BGM in the build** (`music: none`) — the user supplies their own music. A
  mixing/ducking guide is delivered with recommendations.
- **Captions skipped** — the promo carries its own kinetic typography, and the user
  re-records the narration; baked captions would risk drifting from their take.
- **Real code surfaces** — show the actual MCP client config, the branch prefix and
  the agent skill as first-class editorial elements.

## Notes

- **Do not modify any existing workspace file.** Everything lives inside
  `video-demo-2/`. The `product demo/` project is read-only research material.
- Canvas is landscape **1920×1080**.
- Target length **60s** (route hard cap ~3 min).
- Mode is **autonomous** (`flow: automation`, `storyboard: no`): decisions are made
  and stated; the only kept question is the final render-or-changes approval.
- Sign-in status: **signed out** of HeyGen → local engines (Kokoro TTS, local SFX).
- **Placeholder VO generated** with Kokoro `am_michael` (7 lines, total 54.977 s) into
  `assets/voice/01.wav` … `07.wav`; `SCRIPT.md` timings synced to the real durations.
- **SFX bed**: 38 cues authored as host entries in `audio_meta.json` (local files under
  `assets/sfx/`), so the video is fully voiced with sound offline.
- **Rendered MP4**: `renders/video-demo-2_2026-10-17_11-12-12.mp4` — 5.2 MB, 55.0 s,
  1920 × 1080, H.264 + AAC. `npm run check` passes (0 errors).
- **Music**: not baked in (`music: none`); guidance in `MUSIC_GUIDE.md` for the user to
  add their own track.
- **Transcript**: `SCRIPT.md` (this file's companion) — what to say, per beat, with
  exact time windows and delivery notes.
