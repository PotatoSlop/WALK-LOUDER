import Phaser from 'phaser';
import { GameScene } from './gameScene';

export class DebugScene extends Phaser.Scene {
    private overlay!: HTMLDivElement;

    constructor() {
        super({ key: 'debug' });
    }

    create() {
        // DOM overlay — renders at native screen resolution, not affected by pixelArt scaling
        this.overlay = document.createElement('div');
        this.overlay.id = 'debug-overlay';
        Object.assign(this.overlay.style, {
            position: 'absolute',
            top: '8px',
            left: '8px',
            pointerEvents: 'none',
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#ff0000',
            zIndex: '1000',
            lineHeight: '1.6',
        });

        const canvas = this.game.canvas;
        const parent = canvas.parentElement!;
        parent.style.position = 'relative';
        parent.appendChild(this.overlay);

        this.events.on('shutdown', () => this.overlay?.remove());
    }

    update() {
        const gameScene = this.scene.get('main') as GameScene;
        if (!gameScene?.player || !this.overlay) return;

        const player = gameScene.player;
        const mic = gameScene.mic;

        const vol = mic?.getNormalizedVolume?.() ?? -1;
        const vx = player.Body?.velocity?.x ?? 0;
        const vy = player.Body?.velocity?.y ?? 0;
        const floor = mic?.noiseFloor ?? -1;
        const ceiling = mic?.noiseCeiling ?? -1;
        const range = ceiling - floor;

        this.overlay.innerHTML = [
            `vol: ${Number.isNaN(vol) ? 'NaN!' : vol.toFixed(4)}`,
            `pos: (${player.x.toFixed(1)}, ${player.y.toFixed(1)})`,
            `vel: (${vx.toFixed(1)}, ${vy.toFixed(1)})`,
            `floor: ${floor.toFixed(4)}  ceil: ${ceiling.toFixed(4)}`,
            `range: ${range.toFixed(4)}${range <= 0 ? '  BAD (div by zero!)' : ''}`,
            `items: [${(gameScene.player.items ?? []).join(', ')}]`,
        ].join('<br>');
    }
}
