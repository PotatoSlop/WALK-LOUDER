import Phaser from 'phaser';
import { micInput } from '../systems/MicInput';

const SEGMENT_COUNT    = 24;
const HUE_START        = 180;
const DECAY_HALFLIFE_MS = 500;
const MIC_SIZE         = 26;   // px — matches segment height
const MIC_GAP          = 8;    // px — gap between mic icon and bar left edge

// CSS filter to force any icon to white (brightness(0) → black, invert → white)
const FILTER_WHITE = 'brightness(0) invert(1)';
// CSS filter to force any icon to red (generated from black input → #FF0000)
const FILTER_RED   = 'brightness(0) invert(16%) sepia(97%) saturate(6398%) hue-rotate(359deg) brightness(104%) contrast(111%)';

function volumeHue(t: number): number {
    const clamped = Math.min(1, Math.max(0, t));
    return HUE_START * (1 - Math.pow(clamped, 1.6));
}

export function volumeToTintColor(t: number): number {
    const c = Phaser.Display.Color.HSVToRGB(volumeHue(t) / 360, 1, 1) as Phaser.Types.Display.ColorObject;
    return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
}

export class VolumeBar {
    displayedVol: number = 0;

    private overlay:   HTMLDivElement;
    private micIconEl: HTMLImageElement;
    private segments:  HTMLDivElement[] = [];
    private mic:       micInput | null;
    private scene:     Phaser.Scene;
    private atPeak:    boolean = false;
    private flipped:   boolean = false;

    constructor(scene: Phaser.Scene, mic: micInput | null) {
        this.scene = scene;
        this.mic   = mic;

        // ── volume bar (segments only) ────────────────────────────────────────
        this.overlay = document.createElement('div');
        Object.assign(this.overlay.style, {
            position:      'fixed',
            display:       'flex',
            flexDirection: 'row',
            gap:           '3px',
            padding:       '6px',
            background:    'rgba(0, 0, 0, 0.45)',
            border:        '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius:  '2px',
            pointerEvents: 'none',
            zIndex:        '20',
        });

        for (let i = 0; i < SEGMENT_COUNT; i++) {
            const seg = document.createElement('div');
            Object.assign(seg.style, {
                width:           '10px',
                height:          '26px',
                backgroundColor: '#ffffff',
                opacity:         '0.12',
                boxShadow:       'inset 0 0 0 1px rgba(0,0,0,0.3)',
                transition:      'opacity 40ms linear',
            });
            this.overlay.appendChild(seg);
            this.segments.push(seg);
        }
        document.body.appendChild(this.overlay);

        // ── mic icon (separate element, sits to the left of the bar) ─────────
        this.micIconEl = document.createElement('img');
        this.micIconEl.src = 'assets/mic_icon.png';
        Object.assign(this.micIconEl.style, {
            position:      'fixed',
            width:         `${MIC_SIZE}px`,
            height:        `${MIC_SIZE}px`,
            objectFit:     'contain',
            pointerEvents: 'none',
            zIndex:        '20',
            filter:        FILTER_WHITE,
            transition:    'filter 80ms linear',
        });
        document.body.appendChild(this.micIconEl);

        this.positionOverlay();
        scene.scale.on('resize', this.positionOverlay, this);
        window.addEventListener('resize', this.positionOverlay);
    }

    get hasMic(): boolean { return this.mic !== null; }

    setMic(mic: micInput) {
        this.mic = mic;
    }

    private positionOverlay = () => {
        if (!this.overlay) return;
        const rect       = this.scene.game.canvas.getBoundingClientRect();
        const containerW = SEGMENT_COUNT * 10 + (SEGMENT_COUNT - 1) * 3 + 12;
        const containerH = MIC_SIZE + 12;
        const barLeft    = rect.left + rect.width / 2 - containerW / 2;
        const barTop     = rect.top  + rect.height - containerH - 12 - 20;

        this.overlay.style.left = `${barLeft}px`;
        this.overlay.style.top  = `${barTop}px`;

        // Vertically centre mic icon with the bar's segments (6px padding inside bar)
        this.micIconEl.style.left = `${barLeft - MIC_SIZE - MIC_GAP}px`;
        this.micIconEl.style.top  = `${barTop + 6}px`;
    };

    update(delta: number) {
        const raw          = this.mic?.getRawVolume?.() ?? 0;
        const noiseCeiling = this.mic?.noiseCeiling ?? 1;
        const noiseFloor   = this.mic?.noiseFloor ?? 0;
        const ceiling      = noiseCeiling > 0 ? noiseCeiling : 1;
        const range        = ceiling - noiseFloor;
        // Mirror the same normalization the game uses for jump so bar == actual boost
        const target       = range > 0
            ? Phaser.Math.Clamp((raw - noiseFloor) / range, 0, 1)
            : Phaser.Math.Clamp(raw / ceiling, 0, 1);

        if (target > this.displayedVol) {
            this.displayedVol = target;
        } else {
            this.displayedVol = Math.max(target, this.displayedVol * Math.pow(0.5, delta / DECAY_HALFLIFE_MS));
        }

        // The number of lit segments tracks loudness. The "flip" hazard inverts the *level*
        // (not the colours): the bar defaults to full and louder sounds DRAIN it instead of
        // filling it — so lit = SEGMENT_COUNT - loud while flipped.
        const loudCount   = Math.round(this.displayedVol * SEGMENT_COUNT);
        const activeCount = this.flipped ? SEGMENT_COUNT - loudCount : loudCount;
        for (let i = 0; i < this.segments.length; i++) {
            this.segments[i].style.opacity = i < activeCount ? '1' : '0.12';
        }

        // Mic icon: white normally, red at peak loudness. Keyed off actual loudness (not the
        // lit count) so it still means "you're loud" while the flipped bar reads inverted.
        const peak = loudCount >= SEGMENT_COUNT;
        if (peak !== this.atPeak) {
            this.atPeak = peak;
            this.micIconEl.style.filter = peak ? FILTER_RED : FILTER_WHITE;
        }
    }

    // While the "flip" hazard is active the bar drains instead of fills (see update()). The
    // mic UI colours are left untouched — only the fill level is inverted.
    setFlipped(on: boolean) {
        this.flipped = on;
    }

    destroy() {
        this.scene.scale.off('resize', this.positionOverlay, this);
        window.removeEventListener('resize', this.positionOverlay);
        this.overlay?.remove();
        this.micIconEl?.remove();
        this.segments = [];
    }
}
