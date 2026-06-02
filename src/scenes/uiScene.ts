import Phaser from 'phaser';
import { getSetting } from '../systems/settingsManager';

// Screen coords of the callout image: centered on the level01 player spawn (world 20,116 × zoom 4)
const CALLOUT_X = 80;
const CALLOUT_Y = 420;

export class UIScene extends Phaser.Scene {
    private levelText!:     Phaser.GameObjects.Text;
    private deathCount!:    Phaser.GameObjects.Text;
    private skullIcon!:     Phaser.GameObjects.Image;
    private controlsHint!:  Phaser.GameObjects.Image;
    private moveLabel!:     Phaser.GameObjects.Text;
    private deathEmitter!:  Phaser.GameObjects.Particles.ParticleEmitter;

    constructor() {
        super({ key: 'ui' });
    }

    preload() {
        this.load.image('controls-callout', 'assets/Control_callout.png');
        this.load.image('skull', 'assets/skull.png');
    }

    create() {
        this.buildLevelDisplay();
        this.buildControlsHint();
        this.buildDeathEmitter();
        this.registerEvents();
        this.buildDeathCountDisplay();

        // Read current registry values immediately — covers the normal case where
        // GameScene.create() set them before launching this scene.
        const level = this.game.registry.get('currentLevel') as string | undefined;
        if (level) this.showLevel(level);

        const hint = this.game.registry.get('showHint') as string | undefined;
        if (hint === 'arrow-keys') {
            this.controlsHint.setVisible(true);
            this.moveLabel.setVisible(true);
        }

        const deaths = this.game.registry.get('deathCt') as number | undefined;
        this.deathCount.setText(`${deaths ?? 0}`);

        this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    }

    private showLevel(level: string) {
        if (!level) return;
        document.fonts.load('36px "Press Start 2P"').then(() => {
            if (this.levelText?.scene?.sys.isActive()) {
                this.levelText.setText(level).setVisible(true);
            }
        });
    }

    private buildDeathCountDisplay() {
        this.skullIcon = this.add.image(24, 80, 'skull')
            .setOrigin(0, 0)
            .setDisplaySize(18, 18);

        this.deathCount = this.add.text(48, 80, '0', {
                fontFamily: '"Press Start 2P"',
                fontSize:   '18px',
                color:      '#c0c0c0',
            })
            .setVisible(true);
    }

    // level display 

    private buildLevelDisplay() {
        this.levelText = this.add.text(24, 24, '', {
                fontFamily: '"Press Start 2P"',
                fontSize:   '36px',
                color:      '#c0c0c0',
                padding:    { top: 6 },
            })
            .setVisible(false);
    }

    // controls hint 

    private buildControlsHint() {
        this.moveLabel = this.add.text(CALLOUT_X, CALLOUT_Y - 70, 'Move', {
                fontFamily: '"Press Start 2P"',
                fontSize:   '10px',
                color:      '#c0c0c0',
            })
            .setOrigin(0.5, 1)
            .setAlpha(0.6)
            .setVisible(false);

        this.controlsHint = this.add
            .image(CALLOUT_X, CALLOUT_Y, 'controls-callout')
            .setOrigin(0.5, 1)
            .setAlpha(0.6)
            .setVisible(false);
    }

    // death particles

    private buildDeathEmitter() {
        this.deathEmitter = this.add.particles(0, 0, '__WHITE', {
            speed:    { min: 300, max: 700 },
            angle:    { min: 0, max: 360 },
            scale:    { start: 4, end: 0 },
            alpha:    { start: 1, end: 0 },
            lifespan: { min: 30, max: 150 },
            gravityY: 700,
            emitting: false,
        });
        this.deathEmitter.setDepth(20);
    }

    // event wiring

    private registerEvents() {
        this.game.events.on('level-changed', this.showLevel, this);

        this.game.events.on('show-hint', (hintKey: string) => {
            if (hintKey === 'arrow-keys') {
                this.controlsHint.setVisible(true);
                this.moveLabel.setVisible(true);
            }
        }, this);

        this.game.events.on('hide-hint', () => {
            this.controlsHint.setVisible(false);
            this.moveLabel.setVisible(false);
        }, this);

        this.game.events.on('player-death-fx', ({ x, y, color }: { x: number; y: number; color: number }) => {
            if (!getSetting('particlesEnabled')) return;
            const gameCam = this.scene.get('main').cameras.main;
            const screenX = (x - gameCam.worldView.x) * gameCam.zoom;
            const screenY = (y - gameCam.worldView.y) * gameCam.zoom;
            this.deathEmitter.setParticleTint(color);
            this.deathEmitter.explode(100, screenX, screenY);
        }, this);

        // Fallback: catches the currentLevel value if it is set AFTER this scene's
        // create() runs (first-launch timing edge case where the scene boots before
        // GameScene finishes its create() sequence).
        this.game.registry.events.on('changedata-currentLevel', (_: any, value: string) => {
            this.showLevel(value);
        }, this);

        this.game.registry.events.on('changedata-deathCt', (_: any, value: number) => {
            this.deathCount.setText(`${value}`);
        }, this);
    }

    // ── shutdown cleanup ──────────────────────────────────────────────────────

    private cleanup() {
        this.game.events.off('level-changed',    this.showLevel, this);
        this.game.events.off('show-hint',        undefined, this);
        this.game.events.off('hide-hint',        undefined, this);
        this.game.events.off('player-death-fx',  undefined, this);
        this.game.registry.events.off('changedata-currentLevel', undefined, this);
        this.game.registry.events.off('changedata-deathCt',      undefined, this);
    }
}
