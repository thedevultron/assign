# Background Music (BGM) Direction & Mixing Guide — assign launch promo

The video ships **without** music (`music: none` in `STORYBOARD.md`): the
voiceover and the SFX bed are already mixed and rendered. **You add the music.**
This guide gives you the exact spec, sources, and mixing levels so your track
sits under the existing audio instead of fighting it.

## 1. Cut facts

| Parameter | Value |
| :--- | :--- |
| **Total length** | **54.977 s** (≈ 55 s) — match the track to this, or use a loopable clip and let the assembler loop-extend it |
| **Voiceover** | Kokoro `am_michael` placeholder, ~133 wpm, 7 lines (replace with your own take) |
| **SFX bed** | 38 cues already mixed at the root (whooshes, impacts, clicks, pops, typing, chime, sparkle, riser, notification, error, glitch) |
| **Canvas** | 1920 × 1080, landscape |

## 2. Musical profile

| Parameter | Recommended specification | Rationale |
| :--- | :--- | :--- |
| **Genre** | Tech minimal / cybernetic electronic / future bass downtempo | Matches the dark obsidian, precision-engineered editorial UI |
| **Tempo (BPM)** | **118 – 120 BPM** | Aligns with the 0.5 s beat grid of the typography and card entrances |
| **Key / tonality** | D minor or F minor, lifting to major at the finale | Focused seriousness during problem/tech, resolves into triumph at the CTA |
| **Instrumentation** | Analog synth pluck, warm sub-bass, clean kick, subtle hi-hat stutter, atmospheric pad | Leaves the midrange (500 Hz – 4 kHz) open for voiceover |
| **Energy arc** | Subdued tension (0 – 5.2 s) → driving rhythm (5.2 – 23.8 s) → percussive peak (23.8 – 41.0 s) → grand melodic release (41.0 – 55.0 s) | Keeps the viewer engaged without fatiguing the ear in 55 s |

## 3. Beat-by-beat energy map

| Window | Frame | Energy |
| :--- | :--- | :--- |
| 0.0 – 5.2 s | Four windows, one collision | Tension — sub-bass pulse, sparse pluck, no drums yet |
| 5.2 – 14.6 s | One board for every agent | Kick enters, steady 118 BPM, pluck pattern |
| 14.6 – 23.8 s | Claims are atomic | Driving — the peak of the "problem → proof" section |
| 23.8 – 34.3 s | Watch the work move | Percussive, hi-hat stutter, forward motion |
| 34.3 – 41.0 s | Ask the board | Slight pull-back, space for the assistant beat |
| 41.0 – 50.3 s | Real plumbing | Re-build, count-up energy, brighter synth |
| 50.3 – 55.0 s | Give your agents a board | Grand melodic release, major lift, then a clean tail |

## 4. Mixing levels (drop the track under the existing audio)

| Element | Target level | Notes |
| :--- | :--- | :--- |
| Voiceover (placeholder) | −6 to −3 dB | Primary. Keep it the loudest thing in the mix. |
| Music (BGM) | −18 to −12 dB under the VO | Duck 6 – 9 dB whenever the VO is speaking. |
| SFX | −12 to −6 dB | Already mixed; do not re-balance them. |
| Master | ≤ −1 dBTP (true peak) | The render already lowers the audio by 1.1 dB to stay under −1 dBTP. |

**Ducking:** sidechain the music to the voiceover with a 6 – 9 dB dip, 10 ms attack,
150 ms release. The SFX are short transients — let them punch through the duck.

## 5. Sources

- **Licensed:** Epidemic Sound, Artlist, PremiumBeat, Soundstripe — search
  "tech minimal", "cybernetic electronic", "future bass downtempo", "dark tech pulse 120 BPM".
- **Free:** YouTube Audio Library, Pixabay Music, Freesound (SFX only).

## 6. How to add it

1. Drop your track into `assets/bgm/` (e.g. `assets/bgm/track.mp3`).
2. Edit `STORYBOARD.md` top YAML: change `music: none` to `music: "your track mood/spec"`.
3. Add a `bgm` entry to `audio_meta.json`:
   ```json
   "bgm": { "path": "assets/bgm/track.mp3", "volume": 0.12 }
   ```
   (or run `npx hyperframes tts`-style tooling / the audio engine's `--only bgm` pass).
4. Re-run `npm run render`. The assembler loops a short clip to the full 55 s and
   applies a 0.4 s fade-in + 1.5 s fade-out automatically.

## 7. What NOT to do

- Do not raise the music above −12 dB — it will bury the SFX and the VO.
- Do not add a second accent instrument that competes with Iris `#847dff` in the
  high end; the SFX already live there.
- Do not extend the track past 55 s with a hard tail — fade out over the last 1.5 s
  so the CTA lands on silence + the final chime.
