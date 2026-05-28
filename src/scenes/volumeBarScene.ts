import Phaser from 'phaser';
import { GameScene } from './gameScene';

const SEGMENT_COUNT = 24;
const HUE_START = 180;

function volumeHue(t: number): number {
    const clamped = Math.min(1, Math.max(0, t));
    return HUE_START * (1 - Math.pow(clamped, 1.6));
}

export function volumeToTintColor(t: number): number {
    const c = Phaser.Display.Color.HSVToRGB(volumeHue(t) / 360, 1, 1) as Phaser.Types.Display.ColorObject;
    return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
}

const SEGMENT_COLORS = Array.from({ length: SEGMENT_COUNT }, () => '#ffffff');

const DECAY_HALFLIFE_MS = 500;

export class VolumeBarScene extends Phaser.Scene {
    private overlay!: HTMLDivElement;
    private segments: HTMLDivElement[] = [];
    displayedVol: number = 0;

    constructor() {
        super({ key: 'volumeBar' });
    }

    create() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'volume-bar-overlay';
        Object.assign(this.overlay.style, {
            position: 'fixed',
            display: 'flex',
            flexDirection: 'row',
            gap: '3px',
            padding: '6px',
            background: 'rgba(0, 0, 0, 0.45)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '2px',
            pointerEvents: 'none',
            zIndex: '20',
        });

        for (let i = 0; i < SEGMENT_COUNT; i++) {
            const seg = document.createElement('div');
            Object.assign(seg.style, {
                width: '10px',
                height: '26px',
                backgroundColor: SEGMENT_COLORS[i],
                opacity: '0.12',
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.3)',
                transition: 'opacity 40ms linear',
            });
            this.overlay.appendChild(seg);
            this.segments.push(seg);
        }

        document.body.appendChild(this.overlay);
        this.positionOverlay();

        this.scale.on('resize', this.positionOverlay, this);
        window.addEventListener('resize', this.positionOverlay);

        this.events.on('shutdown', () => {
            this.scale.off('resize', this.positionOverlay, this);
            window.removeEventListener('resize', this.positionOverlay);
            this.overlay?.remove();
            this.segments = [];
        });
    }

    private positionOverlay = () => {
        if (!this.overlay) return;
        const rect = this.game.canvas.getBoundingClientRect();
        // segment: 10px wide + 3px gap, 24 segments, 6px padding each side
        const containerW = 24 * 10 + 23 * 3 + 12;
        const containerH = 26 + 12;
        this.overlay.style.left = `${rect.left + rect.width / 2 - containerW / 2}px`;
        this.overlay.style.top  = `${rect.top + rect.height - containerH - 12}px`;
    };

    update(_time: number, delta: number) {
        const gameScene = this.scene.get('main') as GameScene;
        const mic = gameScene?.mic;
        const raw = mic?.getRawVolume?.() ?? 0;
        const ceiling = mic?.noiseCeiling && mic.noiseCeiling > 0 ? mic.noiseCeiling : 1;
        const target = Phaser.Math.Clamp(raw / (ceiling * 0.5), 0, 1);

        if (target > this.displayedVol) {
            this.displayedVol = target;
        } else {
            this.displayedVol = Math.max(target, this.displayedVol * Math.pow(0.5, delta / DECAY_HALFLIFE_MS));
        }

        const activeCount = Math.round(this.displayedVol * SEGMENT_COUNT);
        for (let i = 0; i < SEGMENT_COUNT; i++) {
            this.segments[i].style.opacity = i < activeCount ? '1' : '0.12';
        }
    }
}
