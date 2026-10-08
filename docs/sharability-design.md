# Design: Sharability & Clip Export

## Goal
Letting players **record a full run (gameplay +
audio), preview it, trim it to selected levels, and export a branded, social-ready clip** —
entirely client-side, no backend. A leaderboard is left as a swappable stub to wire up later
if the game gains traction.

Guiding principle: **capture one uniform full-run recording; do all the highlight/branding/
format work at export time.** This keeps recording dead-simple and cheap while still giving
players highlight-style control via level markers.

## Why this is cheap (and why the earlier plan isn't needed)
By dropping in-house verification/leaderboards, we **do not need deterministic replay**, and
therefore **do not need the `performance.now()` → fixed-clock timing refactor.** We record the
real canvas + real audio in real time. Recording is self-contained and barely touches the
physics/gameplay code.

Serious-runner anti-cheat is delegated to speedrun.com (no monetary incentive here; that
community self-regulates). See "Leaderboard (stub)" below.

---

## Architecture overview

```
[Game canvas] ──captureStream(30fps)──┐
                                       ├─► MediaRecorder ─► WebM Blob (full run)
[Web Audio: mic + SFX] ──MediaStream──┘            +
                                            [level markers: {levelId, tMs}]
                                                     │
                     preview (<video> + CSS vertical framing, scrub between markers)
                                                     │
                        export: trim to level range ─► FFmpeg.wasm
                                (vertical composite + burned branding) ─► MP4 Blob
                                                     │
                              navigator.share() / download + preset caption to clipboard
```

Everything above runs in the browser. The only stored artifact is a local Blob until the user
shares/downloads.

---

## 1. Recording pipeline

**Video source.** Record the **raw game canvas** at 30fps via
`game.canvas.captureStream(30)`. Record raw (not pre-composited) — vertical framing + branding
happen once at export, so recording stays cheap and the source stays highest-fidelity.
- In-game UI (run timer, death count) is rendered by `UIScene` onto the **same canvas**, so it
  is captured automatically — no need to re-draw it into the clip. (This satisfies the
  "capture UI/timers/deaths as they appear in game" requirement for free.)

**Audio source (mic + SFX mixed).** Build one `MediaStreamAudioDestinationNode` on the shared
`AudioContext` and route both inputs into it:
- **SFX:** Phaser's `WebAudioSoundManager` exposes `game.sound.context` and a master gain node.
  Connect the master output to our recording destination (in addition to `context.destination`
  so the player still hears it).
- **Mic:** the existing `MicInput` source node → same recording destination.
- Add the destination's audio track to the `MediaRecorder` stream alongside the video track.

**Recorder.** `new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' })`.
Toggle = start/stop. Collect `dataavailable` chunks into a single WebM Blob.

**Toggle behavior.** Recording is opt-in (settings toggle). Start on first level load, stop on
final completion (or manual stop). Recording at 30fps keeps overhead low; the game render loop
is unaffected by the 120Hz physics step.

---

## 2. Level markers (highlight-without-highlight-complexity)

During recording, timestamp each level boundary relative to recording start:

```
markers: { levelId: string, tMs: number }[]
```

- Capture `t0 = recording start`. On each level transition (hook the existing `level-changed`
  event / `switchLevel`), push `{ levelId, tMs: now - t0 }`.
- The array of markers = segment boundaries for the whole run.

**Export selection:** the user picks a contiguous level range (e.g. levels 4–7). Compute
`[startMs, endMs]` from the markers bracketing that range. Everything downstream (preview,
trim, export) operates on that window. Full-run export = first→last marker.

This gives highlight-clip value (share just the hard level, or a PB segment) while keeping a
single uniform capture and no rolling-buffer machinery.

> Note: the in-canvas run timer keeps showing **run-relative** time in the footage (it's part
> of the recorded canvas). That's intentional — a clip of levels 4–7 still shows the true
> in-run clock, which reads as authentic. The burned-in branding (below) can add the final
> run time separately.

---

## 3. Playback / preview

Before exporting, the player previews exactly what they'll post:
- Load the WebM Blob into a `<video>` element (WebM plays natively in Chromium/Firefox).
- Constrain playback to the selected `[startMs, endMs]` (seek to start; pause/loop at end;
  Media Fragments or a `timeupdate` guard).
- Wrap the `<video>` in the **vertical framing via CSS** (title above, game centered) so the
  preview approximates the final composited output without a transcode. The real burn-in is
  done by FFmpeg at export.

This lets users confirm they're exporting only the selected levels and that audio/gameplay
look right before posting.

---

## 4. Vertical framing + burned-in branding

**Default output: 9:16 vertical** (e.g. 1080×1920) so it drops straight into Reels/TikTok/
Shorts.

Chosen layout (mirrors the current site: title above the 3:2 game, full gameplay in view):
```
┌───────────────┐  1080×1920
│  WALK LOUDER  │  ← title branding (top)
│               │
│ ┌───────────┐ │
│ │  GAMEPLAY │ │  ← 3:2 game scaled to 1080 wide (→ 720 tall), centered
│ │  (3:2)    │ │
│ └───────────┘ │
│   TIME  ·  URL │  ← final run time + play-at URL (bottom)
└───────────────┘
```

Branding burned into the pixels (survives reshares): **WALK LOUDER** title, final run time,
play-at URL. Preset **caption text** is handled separately (clipboard / share sheet) since
platforms read the caption from the upload field, not the file — see §6.

**Elegance upgrade (recommended):** instead of flat dark bars above/below, fill the vertical
background with a **blurred, upscaled copy of the gameplay** (the standard Reels technique) and
overlay the crisp 3:2 game on top. No dead space, looks intentional, and it's a couple extra
FFmpeg filters (`split` → `scale`+`boxblur` background → `overlay` foreground). Flat
background is the fallback if we want to ship faster.

---

## 5. Export (WebM → MP4 via FFmpeg.wasm)

Single FFmpeg.wasm pass on the selected window:
1. **Trim** to the level range (`-ss startMs -to endMs`).
2. **Composite** into the 9:16 frame (pad or blurred-backdrop filtergraph), scale gameplay to
   width.
3. **Burn branding** (`drawtext`: title, final time, URL).
4. **Encode** H.264 video + AAC audio → **MP4** (universally accepted by TikTok/IG/YouTube;
   WebM is not).

Output an MP4 Blob.

### ⚠️ Deployment gotcha — cross-origin isolation
Multi-threaded FFmpeg.wasm needs `SharedArrayBuffer`, which requires the page be
**cross-origin isolated**:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
- On a **custom domain** you control these headers — fine.
- On **itch.io** the game is served inside an iframe and you generally **cannot set these
  headers**, which breaks threaded FFmpeg.wasm. Mitigations: use the **single-threaded**
  ffmpeg-core (no SharedArrayBuffer, slower but works), or gate the MP4-export feature to the
  custom-domain build and offer raw WebM download on itch.
- FFmpeg.wasm core is ~25 MB — **lazy-load it only when the user opens export**, never on boot.

---

## 6. Sharing

- **Burned branding** (title/time/URL) → reshares carry attribution back to the game.
- **Preset caption + hashtags** → copy to clipboard (and pass as `text` to the share sheet) so
  the user pastes it at upload. Offer a couple of caption presets (e.g. PB brag, funny-fail).
- **`navigator.share({ files: [mp4], text: caption })`** on mobile → native share sheet →
  user picks TikTok/IG/YouTube. On desktop: download the MP4 + copy the caption.
- We do **not** integrate official platform upload APIs (OAuth + app review; not worth it at
  this stage).

---

## 7. Leaderboard (stub now, wire later)

Define a provider seam so turning it on is a 1–2 line swap:
```ts
interface LeaderboardProvider {
  fetchTop(category: string, n: number): Promise<RunEntry[]>;
  submit(run: RunSubmission): Promise<void>;
}
```
- Ship a `NoopLeaderboardProvider` (returns [] / no-ops) wired in by default.
- On traction, swap in a real provider. Likely path: **read** speedrun.com's public API to
  display an external leaderboard in-game; for **submission**, redirect the user to
  speedrun.com's own submit page (SRC hosts no video — runs link to a YouTube/Twitch upload,
  and submission needs the user's SRC API key, so we don't proxy it). Requires the game be
  listed/approved on SRC first.

---

## Browser support matrix
| Feature | Chrome/Edge | Firefox | Safari |
|---|---|---|---|
| `canvas.captureStream` | ✅ | ✅ | ✅ (recent) |
| `MediaRecorder` WebM | ✅ | ✅ | ⚠️ MP4/H264 only, inconsistent |
| FFmpeg.wasm (threaded) | ✅ w/ COOP-COEP | ✅ w/ COOP-COEP | ⚠️ limited |
| `navigator.share` files | ✅ mobile | ⚠️ | ✅ mobile |

Feature-detect and disable recording gracefully where unsupported.

---

## Phasing
1. **Run timer** — first level load → final completion, rendered by `UIScene` (so it's in the
   capture). Foundation for everything.
2. **Toggleable recorder** — canvas + mixed mic/SFX audio → WebM Blob → download. Ship raw.
3. **Level markers + preview** — record boundaries; `<video>` preview with CSS vertical frame,
   scrub/limit to selected level range.
4. **Export** — FFmpeg.wasm trim + vertical composite + burned branding → MP4; caption presets;
   `navigator.share()`.
5. **(If traction) Leaderboard** — swap the stub for SRC read + redirect-to-submit.

Steps 2–4 need no backend, no accounts, no approvals — the full sharability loop ships without
a server.

## Open decisions
- **Vertical background:** flat dark bars (fast) vs blurred-gameplay backdrop (more elegant).
- **FFmpeg on itch.io:** single-threaded core everywhere, or MP4 export only on custom domain +
  raw WebM on itch.
- **SFX tap point:** confirm Phaser is on WebAudio and locate the master node to route into the
  recording destination.
- **Persistence:** keep recordings in memory only, or stash in IndexedDB so a run survives an
  accidental reload before export.
