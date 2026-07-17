import Phaser from 'phaser';
import { getSetting } from '../systems/settingsManager';
import { GameState, formatRunTime } from '../systems/gameState';

export class UIScene extends Phaser.Scene {
    private levelText!:          Phaser.GameObjects.Text;
    private levelNameText!:      Phaser.GameObjects.Text;
    private deathCount!:         Phaser.GameObjects.Text;
    private timerText!:          Phaser.GameObjects.Text;
    private skullIcon!:          Phaser.GameObjects.Image;
    private deathEmitter!:       Phaser.GameObjects.Particles.ParticleEmitter;
    private showDeathCounter:    boolean = true;
    private showTimer:           boolean = false;

    constructor() {
        super({ key: 'ui' });
    }

    preload() {
        this.load.image('skull', 'assets/Skull-Icon.png');
    }

    create() {
        this.buildLevelDisplay();
        this.buildDeathEmitter();
        this.registerEvents();
        this.buildDeathCountDisplay();
        this.buildRunTimer();

        // Read current registry values immediately — covers the normal case where
        // GameScene.create() set them before launching this scene.
        const level = this.game.registry.get('currentLevel') as string | undefined;
        if (level) this.showLevel(level);

        const levelName = this.game.registry.get('levelName') as string | undefined;
        if (levelName) this.showLevelName(levelName);

        const deaths = this.game.registry.get('deathCt') as number | undefined;
        if (deaths !== undefined) this.deathCount.setText(`${deaths}`);

        this.showDeathCounter = getSetting('deathCounterEnabled');
        this.showTimer = getSetting('timerCounterEnabled');

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

    private showLevelName(name: string) {
        document.fonts.load('12px "Press Start 2P"').then(() => {
            if (this.levelNameText?.scene?.sys.isActive()) {
                this.levelNameText.setText(name).setVisible(!!name);
            }
        });
    }

    private buildDeathCountDisplay() {
        this.skullIcon = this.add.image(0, 0, 'skull')
            .setDisplaySize(16, 16)
            .setOrigin(0, 0.5)
            .setVisible(false);

        this.deathCount = this.add.text(0, 0, '0', {
                fontFamily:      '"Press Start 2P"',
                fontSize:        '18px',
                color:           '#c0c0c0',
                stroke:          '#000000',
                strokeThickness: 2,
            })
            .setOrigin(0, 0.5)
            .setVisible(false);
    }

    update() {
        // Run timer — rendered every frame, before the death-counter early-return below so
        // it keeps ticking regardless of the death-counter's visibility.
        const gs = this.game.registry.get('gameState') as GameState | undefined;
        
        if (gs) {
            this.timerText.setText(formatRunTime(gs.elapsedMs()));
        }

        this.timerText.setVisible(this.showTimer);

        const gameScene = this.scene.get('main') as any;
        const player = gameScene?.player;
        if (!player?.active || !this.showDeathCounter) {
            this.skullIcon.setVisible(false);
            this.deathCount.setVisible(false);
            return;
        }

        const gameCam = gameScene.cameras.main;
        const screenX = (player.x - gameCam.worldView.x) * gameCam.zoom;
        const screenY = (player.y - gameCam.worldView.y) * gameCam.zoom;

        // Player sprite is 16 world px tall; at zoom 4 = 64 screen px. Sit cluster above the top.
        const counterY = screenY - 50;

        // Center [skull][gap][number] cluster over the player's horizontal midpoint
        const skullW = 16;
        const gap    = 4;
        const startX = screenX - (skullW + gap + this.deathCount.width) / 2;

        this.skullIcon.setPosition(startX, counterY).setVisible(true);
        this.deathCount.setPosition(startX + skullW + gap, counterY).setVisible(true);
    }

    // level display 

    private buildLevelDisplay() {
        this.levelText = this.add.text(24, 24, '', {
                fontFamily:      '"Press Start 2P"',
                fontSize:        '36px',
                color:           '#c0c0c0',
                stroke:          '#000000',
                strokeThickness: 2,
                padding:         { top: 6 },
            })
            .setVisible(false);

        this.levelNameText = this.add.text(24, 66, '', {
                fontFamily:      '"Press Start 2P"',
                fontSize:        '12px',
                color:           '#c0c0c0',
                stroke:          '#000000',
                strokeThickness: 2,
            })
            .setVisible(false);
    }

    // run timer — top-center, stays centered in the vertical 9:16 clip frame

    private buildRunTimer() {
        this.timerText = this.add.text(this.scale.width / 2, 24, '', {
                fontFamily:      '"Press Start 2P"',
                fontSize:        '24px',
                color:           '#c0c0c0',
                stroke:          '#000000',
                strokeThickness: 2,
                padding:         { top: 12 },
            })
            .setOrigin(0.5, 0)
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

        this.game.registry.events.on('changedata-levelName', (_: any, value: string) => {
            this.showLevelName(value);
        }, this);

        this.game.registry.events.on('changedata-deathCt', (_: any, value: number) => {
            this.deathCount.setText(`${value}`);
        }, this);

        this.game.events.on('setting-changed', ({ key, value }: { key: string; value: any }) => {
            if (key === 'deathCounterEnabled') this.showDeathCounter = value;
            if (key === 'timerCounterEnabled') this.showTimer = value;
        }, this);
    }

    // ── shutdown cleanup ──────────────────────────────────────────────────────

    private cleanup() {
        this.game.events.off('level-changed',    this.showLevel, this);
        this.game.events.off('player-death-fx',  undefined, this);
        this.game.registry.events.off('changedata-currentLevel', undefined, this);
        this.game.registry.events.off('changedata-levelName',    undefined, this);
        this.game.registry.events.off('changedata-deathCt',      undefined, this);
        this.game.events.off('setting-changed',                  undefined, this);
    }
}
