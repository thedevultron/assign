# Background Music (BGM) Direction & Mixing Guide

This guide gives you exact track specifications, mood benchmarks, licensing sources, and audio mixing levels for the **assign** 30-second product demo video.

---

## 1. Musical Profile & Sonic Identity

| Parameter | Recommended Specification | Rationale |
| :--- | :--- | :--- |
| **Genre** | Tech Minimal / Cybernetic Electronic / Future Bass Downtempo | Matches the dark obsidian, precision-engineered editorial UI. |
| **Tempo (BPM)** | **118 – 120 BPM** | Aligns with the 0.5s beat grid of the typography and card entrances. |
| **Key / Tonality** | D Minor or F Minor with a lift to Major at Beat 6 | Conveys focused seriousness during problem/tech, resolves into triumph at CTA. |
| **Instrumentation** | Analog synth pluck, warm sub-bass, 808/clean kick, subtle hi-hat stutter, atmospheric pad | Leaves clear midrange frequencies (500Hz – 4kHz) open for voiceover. |
| **Energy Arc** | Subdued tension (0–4.5s) → Driving rhythm (4.5–19.5s) → Percussive peak (19.5–24.5s) → Grand melodic release (24.5–29.5s) | Keeps viewer engaged without fatiguing ears in 30 seconds. |

---

## 2. Recommended Royalty-Free Tracks

Here are hand-picked reference tracks and direct search queries you can drop straight into the video:

### Option A: The "Apple / Linear" Tech Vibe (Recommended)
- **Track Style:** *Minimalist Tech Pulse / Future Forward*
- **Search Query on Artlist / Epidemic Sound:** `"Tech Innovation", "Minimal Electronic", "Modern Future Bass 120 BPM"`
- **Examples:**
  - *“Signals”* or *“Silicon Dreams”* on Epidemic Sound (Search: Electronica > Modern > 118 BPM)
  - *“Neural Pulse”* by Ian Post (Artlist)
  - *“Beyond Borders”* by Lux-Inspira (AudioJungle)
- **Why it fits:** Crisp transient clicks, deep rolling bassline, no clashing vocal chops, perfect 0.5s subdivisions.

### Option B: The "Stripe / Vercel" Driving Melodic Vibe
- **Track Style:** *Deep Tech House / Uplifting Synthwave*
- **Search Query:** `"Abstract Tech", "Deep Cybernetic Groove", "Product Launch Electronic"`
- **Examples:**
  - *“Gridlock”* by Peter Sandberg (Epidemic Sound)
  - *“Digital Architect”* by Oliver Michael (Artlist)
- **Why it fits:** Forward momentum that accelerates the perception of speed and productivity.

---

## 3. Cue-Point Timing & Hit Markers

Match these musical landmarks to the video's timecodes:

| Timecode | Visual Event | Music Hit / Automation |
| :--- | :--- | :--- |
| **00:00.0** | Cold open typography: *"Stop pasting tasks..."* | Filtered atmospheric synth pad; kick drum muted. |
| **00:00.8** | LogoMark slams in | **First major downbeat / sub-bass drop** hits in sync with `impact-bass-1.mp3`. |
| **00:04.5** | Multi-agent cards emerge | Bassline engages; 16th-note hi-hat groove starts driving the tempo. |
| **00:09.5** | Kanban columns expand & slide | Full drum groove active; smooth filtered sweep. |
| **00:14.5** | Voice orb & ⌘J command center | Harmonic synth chords shimmer; subtle micro-drop. |
| **00:19.5** | "By The Numbers" stats explosion | Snare roll build-up; high-energy rhythmic percussion. |
| **00:24.0** | Transition to Finale | **Riser sweep** peaks at 00:24.8. |
| **00:25.0** | "Give your agents a board" CTA | **Full triumphant drop**, wide stereo spread, ringing melodic chord. |
| **00:28.5 – 29.5** | Logo glow & fade | Reverb tail decay to clean silence (no abrupt cut-off). |

---

## 4. Professional Mixing & Ducking Levels

To make both the Voiceover and Sound Effects sit cleanly above the music:

```
┌─────────────────────────────────────────────────────────────┐
│ MASTER OUTPUT (-1.0 dB True Peak, LUFS -14 integrated)      │
├─────────────────────────────────────────────────────────────┤
│ 1. Voiceover Track:    -2 dB to -4 dB (Master of clarity)   │
│ 2. Sound Effects (SFX): -6 dB to -10 dB (Crisp punctuation) │
│ 3. Music (Under Voice): -18 dB to -22 dB (Subtle bed)       │
│ 4. Music (At 0.8s & 25s drops): -8 dB to -10 dB (Full power)│
└─────────────────────────────────────────────────────────────┘
```

- **Spectral Carve:** Cut `800 Hz – 3.2 kHz` by **3.5 dB** with a wide Q on the music track so the human voice intelligibility remains 100% effortless.
- **Sidechain Ducking:** Set a fast sidechain compressor on the music track keyed to the voice track: 2:1 ratio, 20ms attack, 250ms release, 4dB to 6dB gain reduction when speaking.
