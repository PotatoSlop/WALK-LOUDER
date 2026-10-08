# WALK LOUDER — Audio & Signal Processing: Interview Notes

Two parts: a **high-level summary** you can say in about two minutes, then a **low-level deep dive** with
the exact numbers, formulas and file references, so you can answer follow-up questions. At the end there's
a list of likely interview questions and an honest list of limitations and what you'd improve.

---

## Part 1 — High-level summary

### Elevator pitch
WALK LOUDER is a browser platformer where **your voice is the analog throttle**. Arrow keys pick the
direction, and your microphone's loudness sets how fast you run and how high you jump. The audio work
falls into three parts:

1. **Input DSP (mic → control signal).** Capture the mic with the Web Audio API and get a loudness value
   from an FFT analyser. Calibrate it per user and per room (noise floor plus a robust peak). Normalize it
   to [0, 1], then split it into two control paths with different latency and smoothing: a **smoothed**
   path for running speed and a **fast, peak-held** path for jumps.
2. **Feedback/visualization.** A segmented LED-style level meter with proper meter ballistics (instant
   attack, exponential release). There's also a loudness-to-color mapping on the player sprite and a
   guided calibration UI.
3. **Output audio engine (SFX).** An event-driven sound manager. It uses a loudness-normalized,
   role-based mix table (gain staging) and a master bus. One-shots and sustained loops are handled
   separately (voice management), with pitch/rate randomization so repeats don't sound the same.
   Footsteps are synced to the animation, and their tempo follows your voice. The audio lifecycle stays
   correct across pause, respawn and hot reload.

There's also a **game mechanic built on signal inversion**: "Flip" pickups map `v → 1 − v`, so being
loud makes you slow.

### Architecture at a glance
```
 Mic ─getUserMedia─► MediaStreamSource ─► AnalyserNode (FFT 2048, dB→byte)
                                              │  (NOT connected to speakers → no feedback loop)
                                              ▼
                         getVolume(): mean(byte spectrum)/255     ← raw "loudness" in a log/dB domain
                                              │
                    Calibration: floor = mean(quiet 3s), ceiling = 80th pct(loud 3s)
                                              │
                      normalized = clamp((raw − floor)/(ceil − floor), 0, 1)
                     ┌────────────────────────┼─────────────────────────┐
                     ▼                        ▼                         ▼
          EMA (α=0.3) → run speed    instantaneous → jump +      Meter ballistics → LED bar,
          + walk-anim/footstep tempo  150 ms peak-hold boost      mic "clip" icon, player hue
                     └──── Flip pickup: v → 1 − v ────┘

 Game events (pub/sub) ─► SoundManager ─► per-key normalized gain ─► Phaser master bus (settings slider)
```

### The design decisions worth highlighting
- **Two control paths for two jobs.** Running needs stability, so it's smoothed. A jump is a one-time
  impulse that needs low latency, so it reads the raw value and holds the peak in a short window after
  takeoff. This is the classic trade-off between responsiveness and stability, applied to each control
  separately.
- **Per-user calibration with robust statistics.** Mics, rooms and voices differ a lot, so absolute
  thresholds don't work. The calibration uses the **mean** for the noise floor and the **80th percentile**
  instead of the max for the ceiling, so a single cough or plosive pop doesn't set the ceiling.
- **Meter ballistics like a real VU/PPM.** Instant attack and a 500 ms half-life release, computed so the
  decay doesn't depend on frame rate. The meter uses exactly the same normalization as the jump path, so
  the bar shows the boost you'll actually get.
- **Mixing done properly.** SFX levels were measured offline (RMS via `ffmpeg volumedetect`), normalized,
  and then trimmed by role: impacts loud, ambient beds low, frequent ticks lowest. There is one table for
  relative levels and a master bus on top.
- **Correct audio resource lifecycle.** Browsers cap the number of AudioContexts at about 6 and require a
  user gesture before audio plays (autoplay policy). Mic tracks are stopped and the context is closed on
  teardown, including on Vite hot reload.

---

## Part 2 — Low-level deep dive

### 2.1 Microphone capture — [MicInput.ts](../src/systems/MicInput.ts)

**Acquisition** ([MicInput.ts:1-9](../src/systems/MicInput.ts:1), [MicInput.ts:34-44](../src/systems/MicInput.ts:34))
- `navigator.mediaDevices.getUserMedia({ audio: true, video: false })` returns a `MediaStream`. It returns
  `null` if permission is denied, and then every volume getter returns 0, so the game still runs.
- **Autoplay policy:** an `AudioContext` created before a user gesture starts `suspended`, so `init()`
  calls `audioContext.resume()` first.
- **Audio graph:** `MediaStreamAudioSourceNode → AnalyserNode`, and that's all. The analyser is **not**
  connected to `audioContext.destination`, so the mic is never played back through the speakers. That
  rules out acoustic feedback and the user hearing themselves.
- The constraints are plain `audio: true`, so the browser **applies its defaults: echo cancellation, noise
  suppression and automatic gain control** (Chrome turns all three on). See limitations: AGC matters a lot
  for a loudness-controlled game.

**AnalyserNode configuration** (all Web Audio spec defaults, since nothing is overridden)

| Parameter | Value | What it means |
|---|---|---|
| `fftSize` | 2048 | Analysis window = 2048 samples ≈ **42.7 ms @ 48 kHz** |
| `frequencyBinCount` | 1024 | fftSize/2 bins, 0 Hz → Nyquist (24 kHz @ 48 kHz) |
| Bin width | ≈ **23.4 Hz** | sampleRate / fftSize |
| Window | Blackman | Reduces spectral leakage |
| `smoothingTimeConstant` | 0.8 | Per-bin exponential averaging over time *inside* the analyser: `X̂ = 0.8·X̂_prev + 0.2·|X|` |
| `minDecibels` / `maxDecibels` | −100 / −30 dB | Byte mapping range |

**The loudness metric** ([MicInput.ts:46-56](../src/systems/MicInput.ts:46))
```ts
analyser.getByteFrequencyData(dataArray);         // 1024 bins, each 0..255
volume = (Σ dataArray[i] / 1024) / 255;           // → [0, 1]
```
`getByteFrequencyData` converts each smoothed magnitude to **dB**. It then maps [−100, −30] dB linearly
onto [0, 255] and clamps. So the "volume" is **the mean of the dB-scaled magnitude spectrum**, not RMS
amplitude. Consequences you should be able to explain:
- It is in the **log domain**. Averaging dB values is like taking a geometric mean of the magnitudes.
  Because perceived loudness is roughly logarithmic, a *linear* mapping from this value to speed gives a
  roughly perceptual loudness-to-speed curve. That's a happy side effect.
- It is **full-band with equal weight for every bin**. Voice energy sits mostly in about 80 Hz–4 kHz, which
  is only the bottom ~170 of the 1024 bins. A loud voice therefore lifts only a fraction of the bins, which
  compresses the raw value into a narrow range. That narrow range is why the calibration step below is
  essential.
- It clips at both ends. Below −100 dB a bin reads 0, and above −30 dB it reads 255.
- (Minor: the `Math.abs` is a no-op on a `Uint8Array`.)

### 2.2 Calibration — [MicInput.ts:58-105](../src/systems/MicInput.ts:58), [calibrationScene.ts](../src/scenes/calibrationScene.ts)

**Flow** ([calibrationScene.ts:83-97](../src/scenes/calibrationScene.ts:83)). It starts automatically after
mic init ([gameScene.ts:314-320](../src/scenes/gameScene.ts:314)).
1. "Stay quiet…": 3 s of samples → **noise floor = arithmetic mean**.
2. A sound cue (`sfx-switch`) marks the change of phase.
3. "Make some noise!": 3 s of samples → **ceiling = 80th percentile**. The samples are sorted descending
   and the code takes the value at index `floor(n·0.2)`.
4. A success cue plays and the overlay closes. A live LED meter stays on screen the whole time as
   feedback, and a countdown is driven by `calibrationStartTime`.

**Sampling loop** ([MicInput.ts:58-71](../src/systems/MicInput.ts:58))
- The loop polls `getVolume()` about every 16 ms (≈ 60 Hz), so roughly 180 samples per phase.
- **It stops on wall-clock time (`performance.now()`), not a fixed iteration count.** `setTimeout(16)`
  drifts, especially when the main thread is busy, so a fixed count of 187 iterations overran 3 s. The
  countdown then showed 0.0 while sampling continued, which looked like a freeze. Bounding by elapsed time
  keeps the data and the UI in sync.

**Why the 80th percentile instead of the max:** it's a robust statistic. A plosive, cough, desk bump or
clipping spike would set a max-based ceiling far too high, and normal speech would then never reach full
power. A percentile ignores the top 20 % of outliers.

**Normalization** ([MicInput.ts:77-82](../src/systems/MicInput.ts:77))
```ts
normalized = clamp((raw − noiseFloor) / (noiseCeiling − noiseFloor), 0, 1)   // returns 0 if range ≤ 0
```
This is min-max normalization with a guard against division by zero or a negative range.

### 2.3 Two control paths — [gameScene.ts:421-431](../src/scenes/gameScene.ts:421)

```ts
let vol     = mic.smoothedVolume();        // movement path
let jumpVol = mic.getNormalizedVolume();   // jump path
if (flipped) { vol = 1 - vol; jumpVol = 1 - jumpVol; }   // Flip mechanic: signal inversion
```
(Holding **F** is a debug override that forces both to 0.8 for testing without a mic.)

**Movement path: EMA low-pass** ([MicInput.ts:84-88](../src/systems/MicInput.ts:84))
- `s = 0.3·x + 0.7·s_prev`. This is a first-order IIR low-pass, updated once per rendered frame.
- Equivalent time constant at 60 fps: τ = −Δt / ln(1−α) = 16.7 / 0.357 ≈ **47 ms**.
- Speed map ([player.ts:76-86](../src/objects/player.ts:76)): `speed = 40 + vol·3·40` → **40–160 px/s**,
  linear in the (dB-domain) normalized value. You still move at a base speed when silent, so the game
  stays playable in a quiet setting.
- The same `vol` drives the **walk animation tempo**: `timeScale = (10 + vol·18)/10` → 1.0×–2.8×
  ([playerController.ts:102](../src/systems/playerController.ts:102)). Footsteps are tied to animation
  frames, so **footstep rate tracks your voice**.
- `vol` also sets **box push speed**, with a log-mass decay
  ([gameScene.ts:621-645](../src/scenes/gameScene.ts:621)).

**Jump path: instantaneous value + peak-hold window** ([player.ts:90-110](../src/objects/player.ts:90))
- Takeoff velocity: `vy = −180 − jumpVol·95`.
- **Vocal boost window (150 ms):** each frame after takeoff, `applyVocalBoost` tracks the running **max**
  of `jumpVol`. If the current value beats the peak, it raises the jump velocity again. This is a
  **peak-hold / max detector over a short window**. Players tend to press the key and shout a beat later,
  so the window absorbs that onset latency (both the human's and the pipeline's).
- Why skip the EMA here: a jump is a one-time impulse that can't be corrected later, so 47 ms of extra lag
  would be noticeable. The run speed is corrected continuously, so smoothing it costs little.
- Variable jump height on key release uses `vy *= 0.85^(Δt/16.66)`, which **is** frame-rate independent.
  That's a useful contrast with the EMA (see limitations).
- Coyote time and jump buffering (150 ms) sit on top of this. That's game feel, not DSP.
- Subtle point: the "instantaneous" path is still smoothed by the analyser's internal
  `smoothingTimeConstant = 0.8`. Queried at 60 Hz, that is τ ≈ −16.7/ln(0.8) ≈ **75 ms**. The 150 ms
  peak-hold window is long enough to cover it.

**Latency budget (rough, for the "how responsive is it?" question)**

| Stage | Approx. |
|---|---|
| OS/device input buffer | 10–20 ms |
| FFT window (2048 @ 48 kHz) | ~43 ms of history |
| Analyser smoothing (0.8) | τ ≈ 75 ms |
| EMA (movement only) | τ ≈ 47 ms |
| Frame / physics step | ~8–17 ms |

So movement responds in roughly 100+ ms, and the jump path is noticeably faster. This is the reason for
splitting the two paths.

### 2.4 Flip mechanic: signal inversion — [gameScene.ts:405-431](../src/scenes/gameScene.ts:405), [flip.ts](../src/objects/flip.ts)
- Collecting a Flip toggles a single boolean. That one flag drives the control inversion (`1 − v`, which
  stays in [0, 1] because both signals are already clamped), a color-matrix invert of the camera, and a
  `flip-changed` event.
- The DOM meter then **drains instead of filling**: `lit = 24 − loudCount`. The red clip icon is still
  driven by *actual* loudness, so it keeps meaning "you're loud" while the bar reads inverted
  ([VolumeBar.ts:129-145](../src/ui/VolumeBar.ts:129)).

### 2.5 Level meter & visual feedback — [VolumeBar.ts](../src/ui/VolumeBar.ts)

**Meter ballistics** ([VolumeBar.ts:112-127](../src/ui/VolumeBar.ts:112))
```ts
target = clamp((raw − floor)/(ceil − floor), 0, 1)        // same normalization as jumpVol
displayed = target > displayed ? target                    // instant attack
                               : max(target, displayed · 0.5^(Δt/500))   // exponential release, 500 ms half-life
```
- **Instant attack with slow exponential release** is how peak programme meters behave. It also means
  short shouts stay visible.
- Raising 0.5 to the power `Δt/500` makes the release **frame-rate independent**.
- 24 segments: `lit = round(displayed·24)`. The opacity transition (40 ms) smooths the rendering.
- **Clip/peak indicator:** the mic icon turns red when all 24 segments are lit, like a clip LED on a
  mixer.
- It's a DOM overlay, not canvas, so it isn't affected by the camera's post-processing filters. It is
  re-positioned on resize.

**Loudness → color** ([VolumeBar.ts:15-24](../src/ui/VolumeBar.ts:15), [playerController.ts:118-120](../src/systems/playerController.ts:118))
- `hue = 180° · (1 − t^1.6)`, converted HSV → RGB to tint the player sprite (cyan when quiet, red when
  loud).
- The **1.6 exponent is a gamma-style curve**. The color stays cool through most of the range and only
  goes red near the top, so red reads as "near max".
- The tint uses the *meter's* displayed value (with ballistics), not the raw signal, so the color doesn't
  flicker.

### 2.6 Output audio engine — [soundFX.ts](../src/systems/soundFX.ts)

**Architecture**
- A single `SoundManager` stored in the Phaser game registry, so it survives scene restarts
  ([gameScene.ts:137-139](../src/scenes/gameScene.ts:137)). It's built on Phaser's WebAudio sound manager.
- **Event-driven / pub-sub:** gameplay code emits semantic events such as `sfx-punch`,
  `sfx-platform-move {moving}` or `player-death-fx {cause}`, and only the manager knows about audio
  ([soundFX.ts:103-144](../src/systems/soundFX.ts:103)). Gameplay has no audio dependency, which keeps the
  coupling low.
- 17 WAV assets. Preloading is idempotent because the cache is checked first.

**Gain staging / loudness normalization** ([soundFX.ts:25-54](../src/systems/soundFX.ts:25))
- Each source WAV was measured offline (**RMS via `ffmpeg -af volumedetect`**) and given a gain toward a
  common target level. The gains were then trimmed **by role**:

| Role | Examples | Gain |
|---|---|---|
| Big moments | `die`, `bullet_die`, `door_win` | 0.95–1.0 |
| Punchy one-shots | `gun_fire`, `SuccessUI`, `punch` | 0.78–0.85 |
| Standard feedback | `jump`, `key_pickup`, `switch`, UI | 0.6–0.9 |
| Ambient loops (a "bed") | `magnet`, `movePlatform` | 0.36–0.42 |
| Frequent/repetitive | `trigger_spike`, `saw`, `walk` | 0.12–0.32 |

- In dB, 0.12 linear ≈ **−18.4 dBFS**, so footsteps sit about 18 dB under the death sound. This mix
  hierarchy keeps frequent sounds from tiring the listener.
- **Master bus:** `game.sound.volume = setting/100`, persisted in `localStorage` and applied before
  anything plays ([settings.ts:37-41](../src/scenes/settings.ts:37)). Each key's gain multiplies the
  master.

**Variation: rate randomization** ([soundFX.ts:56-62](../src/systems/soundFX.ts:56))
- Footsteps are randomized ±25 % and jumps ±15 %. Phaser's `rate` is **resampling**, so pitch *and*
  duration change together (no time-stretch).
- ±25 % is about **+3.9 / −5.0 semitones** (`12·log2(1.25)`, `12·log2(0.75)`). This avoids the
  "machine-gun effect" of hearing an identical sample over and over.
- The random value is the fractional part of `performance.now()`. (Caveat: browsers coarsen timer
  precision to reduce fingerprinting, so this can be quantized. `Math.random()` would be the more robust
  choice.)

**Voice management: one-shots vs. loops** ([soundFX.ts:97-101](../src/systems/soundFX.ts:97), [soundFX.ts:158-166](../src/systems/soundFX.ts:158))
- **One-shots** are fire-and-forget: each trigger creates a new Sound that removes itself when it
  finishes, so there are no long-lived references to go stale after a scene restart (this fixed a "plays
  once, then never again" bug). Overlapping instances are allowed here.
- **Sustained loops** (magnet hum, platform drone, saw whir): `ensureLoop` reuses **one** instance per
  effect and only calls `play()` if it isn't already playing. This stops copies from **stacking**, which
  causes phasing, a "doubled" sound and clipping.
- **The jump sound is variable length.** It starts on takeoff and stops when you release the key or land
  ([playerController.ts:70-76](../src/systems/playerController.ts:70), [playerController.ts:122-124](../src/systems/playerController.ts:122)),
  so the sound follows the variable-height jump.

**State-driven loop control: edge detection** ([gameScene.ts:491-520](../src/scenes/gameScene.ts:491))
- Every frame the game combines state across objects (for example "is *any* saw moving?", using a velocity
  threshold of 0.5 px/s). It emits an event **only when that boolean changes**, which is rising/falling
  edge detection. This avoids sending audio commands every frame, and it means one sound covers many
  objects instead of N overlapping loops.

**Footstep sync** ([playerController.ts:104-110](../src/systems/playerController.ts:104))
- A footstep fires on the *transition onto* frames 1 and 4 of the 6-frame walk cycle, which are the
  foot-contact frames. It's edge-triggered, so each step plays exactly once. The tempo scales with voice
  through `anims.timeScale`.

**Lifecycle**
- **Pause:** the game scene's PAUSE/RESUME events call `pause()`/`resume()` on the loops, so they stay in
  phase with the frozen hazards rather than restarting ([gameScene.ts:349-350](../src/scenes/gameScene.ts:349)).
- **Level teardown / death:** loops are stopped, destroyed and their references cleared. Because the
  manager outlives scenes, a merely stopped instance could be stale and play nothing later
  ([soundFX.ts:197-206](../src/systems/soundFX.ts:197)). Death cuts the loops before playing the death
  sound, which works as a crude form of ducking.
- **Mic/AudioContext teardown** ([MicInput.ts:107-116](../src/systems/MicInput.ts:107)): this stops every
  `MediaStreamTrack` (which turns off the browser's recording indicator) and closes the context.
  **Vite HMR** calls it on dispose ([main.ts:47-56](../src/main.ts:47)). Without it, every hot reload
  leaked another AudioContext and open mic stream. Browsers allow about 6 contexts, so the leak degraded
  the whole browser.

### 2.7 Designed, not yet implemented — [sharability-design.md](sharability-design.md)
Say clearly in interviews that this is a *design*, not shipped code:
- Gameplay recording: `canvas.captureStream(30)` for video, plus one `MediaStreamAudioDestinationNode` on
  the shared AudioContext that **mixes the mic and the SFX master** (Phaser exposes `game.sound.context`
  and a master gain node).
- `MediaRecorder` → WebM (VP8 + Opus) → **FFmpeg.wasm** → H.264 + AAC MP4 for social platforms. The plan
  covers the COOP/COEP requirement for `SharedArrayBuffer` and lazy-loading the ~25 MB ffmpeg core.
- Also considered: TensorFlow.js keyword spotting for full voice commands
  ([game_architecture.md](../game_architecture.md)).

---

## Part 3 — Likely interview questions (with short answers)

**Q: How do you measure loudness?**
With an AnalyserNode FFT (2048 points). I take the mean of the byte-scaled dB spectrum and normalize it to
[0, 1]. It's a log-domain measure, which fits loudness perception reasonably well. If I rebuilt it, I'd
compute RMS on the time-domain signal (`getFloatTimeDomainData`), restricted to the voice band. *(See
limitations.)*

**Q: Why FFT instead of time-domain RMS?**
The analyser hands you spectral data directly, and the dB mapping gives a perceptual curve for free.
The downside is that every bin counts equally, so voice energy gets diluted by high-frequency bins.
Time-domain RMS is cheaper and more standard for pure loudness. The FFT is worth it if you weight or limit
the bands, for example voice-band only or A-weighting.

**Q: How do you handle different mics and rooms?**
A two-phase calibration: the mean of 3 s of silence gives the noise floor, and the 80th percentile of 3 s
of loud input gives the ceiling. Then min-max normalization with clamping. Using a percentile makes it
robust to outliers.

**Q: Isn't smoothing bad for latency?**
Yes, so I split the signal. Movement uses an EMA (τ ≈ 47 ms) because it's corrected continuously. Jumps use
the raw normalized value plus a 150 ms peak-hold window, so a shout that comes slightly late still counts.

**Q: How did you make the meter feel right?**
Meter ballistics: instant attack and an exponential release with a 500 ms half-life, scaled by Δt so it
doesn't depend on frame rate. It uses the same normalization as the jump path, so what you see is the
boost you get.

**Q: How did you mix the SFX?**
I measured RMS offline with ffmpeg `volumedetect`, normalized toward a target level, and then set a
role-based hierarchy, with footsteps about 18 dB under the death/win sounds. One gain table holds the
relative levels and there's a master bus on top. I also randomize rate on repeated sounds so they don't
sound mechanical.

**Q: What audio bugs did you hit?**
1. A sampling loop bounded by iteration count drifted past the countdown; I fixed it by stopping on
   wall-clock time.
2. Stacked loop instances sounded doubled; I fixed it with a single reused instance per loop.
3. Stale Sound references after scene restarts went silent; I fixed it by destroying loops and clearing
   the references.
4. AudioContext and mic leaks on hot reload; I fixed them with an explicit `destroy()` called from the HMR
   dispose hook.
5. Loops kept playing under the pause menu; I fixed it by pausing and resuming them with the scene.

**Q: Could the game's own audio move the player?**
Yes. If the speakers play near the mic, game SFX could raise the measured loudness. The browser's default
echo cancellation reduces this. A stronger fix is a frequency- or time-gated detector, or recommending
headphones.

---

## Part 4 — Honest limitations & what I'd improve

These show depth in interviews. Present them as known trade-offs and next steps.

1. **Browser AGC is on by default.** `getUserMedia({audio:true})` turns on auto gain control, which
   *compresses the very dynamic range the game uses for control*. I'd pass
   `{ autoGainControl: false, noiseSuppression: false }` and probably keep `echoCancellation: true`
   because of the SFX bleed problem above.
2. **Full-band averaging dilutes the voice.** I'd sum only the bins from about 80 Hz to 4 kHz
   (`bin = f · fftSize / sampleRate`), or apply A-weighting. Another option is time-domain RMS converted
   to dBFS (`20·log10(rms)`).
3. **The EMA depends on frame rate.** α = 0.3 per frame means τ ≈ 47 ms at 60 fps but ≈ 20 ms at 144 fps.
   The fix is `α = 1 − exp(−Δt/τ)`, which is the same idea already used in the meter's release and the
   jump decay.
4. **There's no noise gate or hysteresis.** The noise floor is a *mean*, so normal fluctuations above it
   leak through as small non-zero speed. I'd set the floor from a high percentile of the quiet samples,
   or add a deadband, or use separate on/off thresholds (hysteresis) to stop the value chattering near
   zero.
5. **Main-thread sampling.** Calibration and per-frame reads rely on `setTimeout` and rAF timing. An
   **AudioWorklet** would compute RMS sample-accurately on the audio thread and post the values back. That
   gives lower jitter and doesn't depend on frame rate.
6. **The analyser is read about 3 times per frame** (EMA path, jump path, meter). I'd compute it once per
   frame and cache the value.
7. **The master volume slider is linear in amplitude.** Perceived loudness is logarithmic, so most of the
   audible change is bunched at the low end of the slider. A dB taper (for example a −60…0 dB map) would
   feel more even.
8. **The randomness source.** I'd use `Math.random()` (or a seeded PRNG) instead of the fractional part of
   `performance.now()`, whose precision browsers may coarsen.
9. **Calibration edge case.** If the "loud" phase isn't louder than the floor, the range is ≤ 0 and
   control is silently zero. I'd detect that and prompt the user to re-calibrate.
