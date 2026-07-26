import Phaser from "phaser";
import { getSetting } from "./settingsManager";

// All sfx keys map 1:1 to files in public/assets/sfx/<key>.wav
const SFX_KEYS = [
    'bullet_die',
    'bullet_hit_wall',
    'die',
    'door_win',
    'gun_fire',
    'key_pickup',
    'magnet',
    'movePlatform',
    'PauseUI',
    'punch',
    'SelectUI',
    'SuccessUI',
    'switch',
    'trigger_spike',
    'walk',
    'jump',
    'saw',
] as const;

// Footsteps and jumps get a little pitch variation so repeats don't sound robotic.
function randomRate(spread = 0.12): number {
    // performance.now() gives us a cheap, ever-changing seed (Math.random is unavailable here).
    const t = performance.now();
    const frac = t - Math.floor(t);
    return 1 - spread + frac * spread * 2;
}

export class SoundManager {
    private game: Phaser.Game;
    private sound: Phaser.Sound.BaseSoundManager;

    // Looping / sustained sounds — held so they can be started and stopped by game state.
    private jumpSound?: Phaser.Sound.BaseSound;
    private magnetSound?: Phaser.Sound.BaseSound;
    private platformSound?: Phaser.Sound.BaseSound;
    private sawSound?: Phaser.Sound.BaseSound;

    constructor(scene: Phaser.Scene) {
        this.game = scene.game;
        this.sound = scene.game.sound;
        // Apply the persisted master volume before anything plays.
        this.sound.volume = getSetting('volume') / 100;
        this.registerEvents();
    }

    // Queue every sfx file on the given scene's loader. The audio cache is global and
    // persists across scene restarts, so guarding on cache.exists keeps this idempotent.
    static preload(scene: Phaser.Scene) {
        for (const key of SFX_KEYS) {
            if (!scene.cache.audio.exists(key)) {
                scene.load.audio(key, `assets/sfx/${key}.wav`);
            }
        }
    }

    // ── one-shot helper ───────────────────────────────────────────────────────
    // Fire-and-forget: a fresh Sound per trigger that removes itself on completion. We hold
    // no long-lived reference, so nothing can go stale when a scene restarts (respawn / level
    // change) — the classic "plays once, then never again" bug. The global sound manager keeps
    // its own list and calls destroy() for us once the clip ends via `remove-on-complete`.
    private play(key: string, config?: Phaser.Types.Sound.SoundConfig) {
        if (!this.game.cache.audio.exists(key)) return;
        this.sound.play(key, config);
    }

    private registerEvents() {
        const e = this.game.events;

        // Deaths — the fx payload carries the cause so bullet deaths get their own sound.
        e.on('player-death-fx', this.playDeath, this);

        // Bullets
        e.on('sfx-gun-fire',      () => this.play('gun_fire'),        this);
        e.on('sfx-bullet-hit-wall', () => this.play('bullet_hit_wall'), this);

        // World hazards / interactables
        e.on('sfx-trigger-spike', () => this.play('trigger_spike'),   this);
        e.on('sfx-punch',         () => this.play('punch'),           this);

        // Movement
        e.on('sfx-walk',       this.playWalk,      this);
        e.on('sfx-jump-start', this.startJump,     this);
        e.on('sfx-jump-stop',  this.stopJump,      this);

        // Sustained field/platform loops (payload: { active | moving: boolean })
        e.on('sfx-magnet',        this.toggleMagnet,   this);
        e.on('sfx-platform-move', this.togglePlatform, this);
        e.on('sfx-saw',           this.toggleSaw,      this);

        // Progression
        e.on('item-collect', () => this.play('key_pickup'), this);
        e.on('sfx-door-win', () => this.play('door_win'),   this);

        // UI
        e.on('sfx-pause',  () => this.play('PauseUI'),  this);
        e.on('sfx-select', () => this.play('SelectUI'), this);
        e.on('sfx-switch', () => this.play('switch'),   this);
        e.on('success',    () => this.play('SuccessUI'), this);

        //level reset
        e.on('sfx-stop-loops', this.stopLoops, this);

        // Pause menu: suspend/restore the sustained loops without tearing them down, so they
        // resume mid-whir exactly where the (frozen) hazard left off.
        e.on('sfx-pause-loops',  this.pauseLoops,  this);
        e.on('sfx-resume-loops', this.resumeLoops, this);
    }

    // ── handlers ──────────────────────────────────────────────────────────────

    private playDeath({ cause }: { cause?: string } = {}) {
        this.stopLoops();
        this.play(cause === 'bullet' ? 'bullet_die' : 'die');
    }

    // Overwritten per step, quieter than the rest, randomized pitch.
    private playWalk() {
        this.play('walk', { volume: 0.01, rate: randomRate(0.25) });
    }

    // Reuse (or lazily create) a single looping Sound instance for a sustained effect, so
    // repeated start/stop cycles never stack overlapping copies. Returns the live instance.
    private ensureLoop(existing: Phaser.Sound.BaseSound | undefined, key: string, volume: number): Phaser.Sound.BaseSound | undefined {
        if (!this.game.cache.audio.exists(key)) return existing;
        let s = existing;
        if (!s || s.pendingRemove) s = this.sound.add(key, { loop: true, volume });
        if (!s.isPlaying) s.play();
        return s;
    }

    // Variable jump: sustains while the jump is held, released with the key. One reused
    // instance — creating a fresh Sound per jump is what made it sound doubled.
    private startJump() {
        if (!this.game.cache.audio.exists('jump')) return;
        if (!this.jumpSound || this.jumpSound.pendingRemove) this.jumpSound = this.sound.add('jump');
        if (this.jumpSound.isPlaying) return;
        this.jumpSound.play({ rate: randomRate(0.15) });
    }

    private stopJump() {
        if (this.jumpSound?.isPlaying) this.jumpSound.stop();
    }

    private toggleMagnet({ active }: { active: boolean }) {
        if (active) this.magnetSound = this.ensureLoop(this.magnetSound, 'magnet', 0.6);
        else this.magnetSound?.stop();
    }

    private togglePlatform({ moving }: { moving: boolean }) {
        if (moving) this.platformSound = this.ensureLoop(this.platformSound, 'movePlatform', 0.6);
        else this.platformSound?.stop();
    }

    // Saw blade: a quiet sustained whir whenever any saw is travelling.
    private toggleSaw({ moving }: { moving: boolean }) {
        if (moving) this.sawSound = this.ensureLoop(this.sawSound, 'saw', 0.15);
        else this.sawSound?.stop();
    }

    // Tear every sustained loop down completely — stop, destroy, and drop the reference.
    // Because this SoundManager lives in the game registry across scene restarts (respawn /
    // level change), a merely-stopped instance can be left stale or torn down by the old
    // scene, so reusing it later plays nothing. Nulling forces a fresh Sound next time.
    private stopLoops() {
        for (const s of [this.jumpSound, this.magnetSound, this.platformSound, this.sawSound]) {
            if (s && !s.pendingRemove) { s.stop(); s.destroy(); }
        }
        this.jumpSound = this.magnetSound = this.platformSound = this.sawSound = undefined;
    }

    // Freeze any currently-playing loop (called when gameplay pauses).
    private pauseLoops() {
        for (const s of [this.jumpSound, this.magnetSound, this.platformSound, this.sawSound]) {
            if (s?.isPlaying) s.pause();
        }
    }

    // Restore the loops frozen by pauseLoops (called when gameplay resumes).
    private resumeLoops() {
        for (const s of [this.jumpSound, this.magnetSound, this.platformSound, this.sawSound]) {
            if (s?.isPaused) s.resume();
        }
    }

    
}
