import Phaser from 'phaser';
import { getSetting } from '../systems/settingsManager';

// ─── layout constants ────────────────────────────────────────────────────────
/** logical px per key cell */
const KEY_SIZE  = 30;
/** gap between cells */
const KEY_GAP   = 4;
/** padding inside the background panel */
const PANEL_PAD = 8;
/** distance from canvas edges */
const EDGE_PAD  = 14;

export class UIScene extends Phaser.Scene {
    private levelText!:     Phaser.GameObjects.Text;
    private controlsHint!:  Phaser.GameObjects.Container;
    private deathEmitter!:  Phaser.GameObjects.Particles.ParticleEmitter;

    constructor() {
        super({ key: 'ui' });
    }

    create() {
        this.buildLevelDisplay();
        this.buildControlsHint();
        this.buildDeathEmitter();
        this.registerEvents();
    }

    // ── level display ─────────────────────────────────────────────────────────

    private buildLevelDisplay() {
        this.levelText = this.add
            .text(24, 24, '', {
                fontFamily: '"Press Start 2P"',
                fontSize:   '36px',
                color:      '#c0c0c0',
            })
            .setVisible(false);
    }

    // ── controls hint ─────────────────────────────────────────────────────────
    //
    //  Layout (D-pad style):
    //        [ ↑ ]
    //  [ ← ]       [ → ]
    //
    //  TODO: swap makeKey() graphics for this.add.image() once PNGs land in /public

    private buildControlsHint() {
        const S   = KEY_SIZE;
        const gap = KEY_GAP;
        const pad = PANEL_PAD;

        const panelW = 3 * S + 2 * gap + 2 * pad;
        const panelH = 2 * S + gap     + 2 * pad;

        const px = EDGE_PAD;
        const py = this.scale.height - panelH - EDGE_PAD;

        this.controlsHint = this.add.container(px, py).setVisible(false);

        // panel background
        const bg = this.add.graphics();
        bg.fillStyle(0x000000, 0.55);
        bg.fillRoundedRect(0, 0, panelW, panelH, 5);
        this.controlsHint.add(bg);

        // col(c) / row(r) give the top-left origin of each cell
        const col = (c: number) => pad + c * (S + gap);
        const row = (r: number) => pad + r * (S + gap);

        this.controlsHint.add(this.makeKey(col(1), row(0), S, 'up'));
        this.controlsHint.add(this.makeKey(col(0), row(1), S, 'left'));
        this.controlsHint.add(this.makeKey(col(2), row(1), S, 'right'));
    }

    /**
     * Draw a single keyboard key with a filled triangle arrow.
     * Replace the graphics inside here with this.add.image() once textures exist.
     */
    private makeKey(
        x: number,
        y: number,
        S: number,
        dir: 'up' | 'left' | 'right',
    ): Phaser.GameObjects.Container {
        const c = this.add.container(x, y);

        // key face
        const face = this.add.graphics();
        face.fillStyle(0x2b2b40, 1);
        face.lineStyle(1.5, 0x7070a0, 1);
        face.fillRoundedRect(0, 0, S, S, 3);
        face.strokeRoundedRect(0, 0, S, S, 3);

        // arrow glyph — inset triangle
        const arrow = this.add.graphics();
        arrow.fillStyle(0xd0d0ff, 1);

        const m    = Math.round(S * 0.25); // margin from cell edge
        const half = S / 2;

        if (dir === 'up') {
            arrow.fillTriangle(half, m,   S - m, S - m,   m, S - m);
        } else if (dir === 'left') {
            arrow.fillTriangle(m, half,   S - m, m,       S - m, S - m);
        } else {
            arrow.fillTriangle(S - m, half,   m, m,       m, S - m);
        }

        c.add([face, arrow]);
        return c;
    }

    // ── death particles ───────────────────────────────────────────────────────

    private buildDeathEmitter() {
        this.deathEmitter = this.add.particles(0, 0, '__WHITE', {
            speed:    { min: 300, max: 700 },
            angle:    { min: 0, max: 360 },
            scale:    { start: 7, end: 0 },
            alpha:    { start: 1, end: 0 },
            lifespan: { min: 100, max: 200 },
            gravityY: 180 ,
            emitting: false,
        });
        this.deathEmitter.setDepth(20);
    }

    // ── global event bus ──────────────────────────────────────────────────────

    private registerEvents() {
        // GameScene fires: this.game.events.emit('level-changed', levelID)
        this.game.events.on('level-changed', (levelID: string) => {
            this.levelText.setText(`${levelID}`).setVisible(true);
        });

        // GameScene fires: this.game.events.emit('show-hint', 'arrow-keys')
        this.game.events.on('show-hint', (hintKey: string) => {
            if (hintKey === 'arrow-keys') this.controlsHint.setVisible(true);
        });

        // GameScene fires: this.game.events.emit('hide-hint')
        this.game.events.on('hide-hint', () => {
            this.controlsHint.setVisible(false);
        });

        // GameScene fires: this.game.events.emit('player-death-fx', { x, y, color })
        this.game.events.on('player-death-fx', ({ x, y, color }: { x: number, y: number, color: number }) => {
            if (!getSetting('particlesEnabled')) return;
            const gameCam = this.scene.get('main').cameras.main;
            const screenX = (x - gameCam.worldView.x) * gameCam.zoom;
            const screenY = (y - gameCam.worldView.y) * gameCam.zoom;
            this.deathEmitter.setParticleTint(color);
            this.deathEmitter.explode(100, screenX, screenY);
        });
    }
}
