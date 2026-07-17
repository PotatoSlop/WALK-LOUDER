import Phaser from "phaser";

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

    // One dedicated Sound per one-shot key, restarted on each play. Reusing the instance
    // (rather than game.sound.play(key), which failed to re-trigger reliably here) guarantees
    // repeated playback and gives the "overwrite" behaviour footsteps/switches want.
    private oneShots: Record<string, Phaser.Sound.BaseSound> = {};

    // Looping / sustained sounds — held so they can be started and stopped by game state.
    private jumpSound?: Phaser.Sound.BaseSound;
    private magnetSound?: Phaser.Sound.BaseSound;
    private platformSound?: Phaser.Sound.BaseSound;
    private sawSound?: Phaser.Sound.BaseSound;

    constructor(scene: Phaser.Scene) {
        this.game = scene.game;
        this.sound = scene.game.sound;
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
    private play(key: string, config?: Phaser.Types.Sound.SoundConfig) {
        if (!this.game.cache.audio.exists(key)) return;
        let s = this.oneShots[key];
        if (!s) {
            s = this.sound.add(key);
            this.oneShots[key] = s;
        }
        if (s.isPlaying) s.stop();
        s.play(config);
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

        // A level reset / restart tears down every sustained loop.
        e.on('sfx-stop-loops', this.stopLoops, this);
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

    // Variable jump: sustains while the jump is held, released with the key.
    private startJump() {
        if (this.jumpSound?.isPlaying) return;
        if (!this.game.cache.audio.exists('jump')) return;
        this.jumpSound = this.sound.add('jump', { rate: randomRate(0.05) });
        this.jumpSound.play();
    }

    private stopJump() {
        if (this.jumpSound?.isPlaying) this.jumpSound.stop();
    }

    private toggleMagnet({ active }: { active: boolean }) {
        if (active) {
            if (this.magnetSound?.isPlaying) return;
            if (!this.game.cache.audio.exists('magnet')) return;
            this.magnetSound = this.sound.add('magnet', { loop: true, volume: 0.6 });
            this.magnetSound.play();
        } else if (this.magnetSound?.isPlaying) {
            this.magnetSound.stop();
        }
    }

    private togglePlatform({ moving }: { moving: boolean }) {
        if (moving) {
            if (this.platformSound?.isPlaying) return;
            if (!this.game.cache.audio.exists('movePlatform')) return;
            this.platformSound = this.sound.add('movePlatform', { loop: true, volume: 0.6 });
            this.platformSound.play();
        } else if (this.platformSound?.isPlaying) {
            this.platformSound.stop();
        }
    }

    // Saw blade: a quiet sustained whir whenever any saw is travelling.
    private toggleSaw({ moving }: { moving: boolean }) {
        if (moving) {
            if (this.sawSound?.isPlaying) return;
            if (!this.game.cache.audio.exists('saw')) return;
            this.sawSound = this.sound.add('saw', { loop: true, volume: 0.15 });
            this.sawSound.play();
        } else if (this.sawSound?.isPlaying) {
            this.sawSound.stop();
        }
    }

    private stopLoops() {
        this.stopJump();
        this.magnetSound?.stop();
        this.platformSound?.stop();
        this.sawSound?.stop();
    }
}
