import Phaser from 'phaser';

// The one screen/mode the game is in. This is the single source of truth: the run clock
// below is derived entirely from it (see the timing section), so there is no second state
// enum to keep in sync. Add future screens (e.g. 'menu', 'calibration') here and handle
// their side effects in GameScene.applyMode.
export type GameMode = 'playing' | 'paused' | 'settings' | 'results';

export const GAMEMODE_CHANGED = 'gamemode-changed';

/** A run split, recorded when the player reaches a new level. */
export interface Split { levelId: string; tMs: number; }

// Single source of truth for game mode + run timing.
//
// It only tracks state and announces changes; the side effects (pausing physics, launching
// the settings overlay, etc.) live in GameScene.applyMode so all coordination is in one place.
//
// Run timing is derived from the mode: the clock advances only while mode === 'playing'. Every
// other mode (paused, settings, results) freezes it — results is simply the terminal one. That
// removes the old RunTimer's separate idle/running/paused/finished enum, which duplicated GameMode.
export class GameState {
    private events: Phaser.Events.EventEmitter;
    private _mode: GameMode = 'playing';

    splits: Split[] = [];
    private started = false;
    private runStart = 0;
    private pausedTotal = 0;   // accumulated time spent in non-playing modes
    private pauseStart = 0;    // performance.now() when the clock last stopped

    constructor(events: Phaser.Events.EventEmitter) {
        this.events = events;
    }

    // ── mode ────────────────────────────────────────────────────────────────
    get mode(): GameMode { return this._mode; }
    is(mode: GameMode): boolean { return this._mode === mode; }
    isPlaying(): boolean { return this._mode === 'playing'; }

    // Change mode, keep the run clock in step, and announce it. No-op if unchanged.
    set(mode: GameMode): void {
        if (mode === this._mode) return;

        // The clock runs iff mode === 'playing'. Fold pause time on every crossing of that
        // boundary — transitions between two non-playing modes (paused ↔ settings) leave the
        // clock frozen and need no accounting.
        if (this.started) {
            const wasPlaying = this._mode === 'playing';
            const nowPlaying = mode === 'playing';
            if (wasPlaying && !nowPlaying) this.pauseStart = performance.now();
            else if (!wasPlaying && nowPlaying) this.pausedTotal += performance.now() - this.pauseStart;
        }

        this._mode = mode;
        this.events.emit(GAMEMODE_CHANGED, mode);
    }

    // ── run timing ──────────────────────────────────────────────────────────
    // Begin the run on the first level. Idempotent so scene restarts (death/respawn) don't reset it.
    startRun(firstLevelId: string): void {
        if (this.started) return;
        this.started = true;
        this.runStart = performance.now();
        this.pausedTotal = 0;
        this.pauseStart = 0;
        this.splits = [{ levelId: firstLevelId, tMs: 0 }];
    }

    // Record reaching a level. Dedupes consecutive same-level calls (death-respawn).
    split(levelId: string): void {
        if (!this.started) return;
        const last = this.splits[this.splits.length - 1];
        if (last?.levelId === levelId) return;
        this.splits.push({ levelId, tMs: this.elapsedMs() });
    }

    resetRun(): void {
        this.started = false;
        this.splits = [];
        this.runStart = this.pausedTotal = this.pauseStart = 0;
    }

    elapsedMs(): number {
        if (!this.started) return 0;
        // While not playing, (now - pauseStart) cancels the now term below, so elapsed is
        // frozen at the moment the clock stopped — no special-casing of results needed.
        const paused = this.pausedTotal + (this._mode !== 'playing' ? performance.now() - this.pauseStart : 0);
        return performance.now() - this.runStart - paused;
    }

    currentLevelId(): string | undefined {
        return this.splits[this.splits.length - 1]?.levelId;
    }
}

export function formatRunTime(ms: number): string {
    const totalCs = Math.max(0, Math.floor(ms / 10));   // centiseconds
    const cs  = totalCs % 100;
    const sec = Math.floor(totalCs / 100) % 60;
    const min = Math.floor(totalCs / 6000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${min}:${pad(sec)}.${pad(cs)}`;
}
