import Phaser from 'phaser';
import { Player } from '../objects/player';
import { micInput } from '../systems/MicInput';
import { Door } from '../objects/door';
import { Hazard } from '../objects/hazards';
import { Key } from '../objects/key';
import { MovingPlatform } from '../objects/movingPlatform';
import { Switch } from '../objects/switches';
import { PunchBox } from '../objects/punchBox';
import { Box } from '../objects/box';
import { bodyOverlapsSensor } from '../systems/overlap';
import { getSetting } from '../systems/settingsManager';
import { LEVEL_NAMES } from '../data/levels';
import { TiledContext } from '../systems/tiled';
import { LevelBuilder } from '../systems/levelBuilder';
import { setupCameraFX } from '../systems/cameraFX';
import { PlayerController } from '../systems/playerController';

// Door unlock visual frames — swapped when a locked door opens
const DOOR_UNLOCKED_GID = 376;      // door body without handle (unlocked visual)
const DOOR_UNLOCKED_TOP_GID = 356;  // top piece paired with the unlocked body

// Camera zoom factor — canvas runs at 960×640, world stays 240×160
const CAMERA_ZOOM = 4;

export class GameScene extends Phaser.Scene {

    player: any;
    cursors: any;
    platformGroup: any;
    hazardGroup: any;
    doorGroup: any;
    itemGroup: any;
    switchGroup: any;
    bulletGroup: any;
    punchBoxGroup: any;
    boxGroup: any;
    mic: any;
    escKey: any;

    private controlsHint!: Phaser.GameObjects.Image;
    private moveLabel!: Phaser.GameObjects.Text;

    private deathCt: number = 0;

    private currentLevelId: string = 'level01';
    private transitioning: boolean = false;
    private debugKey!: Phaser.Input.Keyboard.Key;
    private playerController!: PlayerController;

    constructor() {
        super({ key: 'main' });
    }

    init(data: { levelId?: string }) {
        this.currentLevelId = data.levelId ?? 'level01';
        this.transitioning = false;
        this.deathCt = this.game.registry.get('deathCt') ?? 0;
    }

    preload() {
        this.load.tilemapTiledJSON(this.currentLevelId, `assets/data/levels/${this.currentLevelId}.tmj`);
        this.load.image('tiles', 'assets/walk-louder-tile-sheet.png');
        this.load.image('controls-callout', 'assets/Control_callout.png');
        this.load.spritesheet('tileSprites', 'assets/walk-louder-tile-sheet.png', { frameWidth: 8, frameHeight: 8 });
        this.load.spritesheet('player', 'assets/walkter-Sheet.png', { frameWidth: 8, frameHeight: 16 });
    }

    create() {
        this.escKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

        // Tilemap
        const map = this.make.tilemap({ key: this.currentLevelId });
        const tileset = map.addTilesetImage('walk-louder-tile-sheet', 'tiles');
        const platformLayer = map.createLayer('Tile Layer 1', tileset!);

        // Lock world + camera to tilemap dimensions (screen edge = level edge)
        this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
        this.physics.world.TILE_BIAS = 8;
        // Run physics at 120Hz: halves per-step displacement vs the 60fps default, so fast
        // bodies can't skip past thin platform bodies (Arcade has no continuous collision).
        this.physics.world.setFPS(120);
        this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
        this.cameras.main.setZoom(CAMERA_ZOOM);

        setupCameraFX(this);

        this.events.on('playerDeath', () => {
            if (this.transitioning) return;
            this.transitioning = true;
            this.deathCt++;
            this.game.registry.set('deathCt', this.deathCt);

            const color = getSetting('bloodMode')
                ? 0xff0000
                : this.player.tintTopLeft ?? 0xffffff;

            // Freeze and hide player immediately so particles play at death position
            this.player.setVisible(false);
            this.player.Body.setVelocity(0, 0);
            (this.player.Body as Phaser.Physics.Arcade.Body).setEnable(false);

            this.game.events.emit('player-death-fx', { x: this.player.x, y: this.player.y, color });

            this.time.delayedCall(500, () => this.switchLevel(this.currentLevelId));
        });

        // Build the level — LevelBuilder owns the groups and spawns the player
        const rawJson = this.cache.tilemap.get(this.currentLevelId)?.data;
        const tiled = new TiledContext(this, rawJson);
        const level = new LevelBuilder(this, map, tiled).build();
        this.player       = level.player;
        this.platformGroup = level.groups.platform;
        this.hazardGroup   = level.groups.hazard;
        this.doorGroup     = level.groups.door;
        this.itemGroup     = level.groups.item;
        this.switchGroup   = level.groups.switch;
        this.boxGroup      = level.groups.box;
        this.punchBoxGroup = level.groups.punchBox;
        this.bulletGroup   = level.groups.bullet;

        this.playerController = new PlayerController(this, this.player, this.platformGroup);

        // Player scene-side wiring (controls hint + fall-out-of-world death)
        this.buildControlsHint();
        this.player.Body.onWorldBounds = true;
        this.physics.world.on('worldbounds', (body: Phaser.Physics.Arcade.Body, _up: boolean, down: boolean) => {
            if (body.gameObject === this.player && down) this.player.death();
        });

        // Collisions
        this.physics.add.collider(this.player, platformLayer!);
        this.physics.add.collider(this.player, this.platformGroup);
        this.physics.add.collider(this.player, this.boxGroup);
        this.physics.add.collider(this.boxGroup, platformLayer!);
        this.physics.add.collider(this.boxGroup, this.platformGroup);
        this.physics.add.collider(this.boxGroup, this.boxGroup);
        platformLayer!.setCollision([42]);

        for (const h of this.hazardGroup.getChildren()) {
            this.physics.add.overlap(this.player, h, (p) => (p as Player).death());
        }

        // Keys are collected via a plain AABB test in update() (see itemGroup loop) — no
        // physics overlap, which would corrupt the player's ground/jump state on contact.

        for (const d of this.doorGroup.getChildren()) {
            this.physics.add.overlap(this.player, d, (p, door) => {
                if (this.transitioning) return;

                const doorObj = door as Door;
                const player = p as Player;

                if (doorObj.isLocked) {
                    doorObj.open(player.items);
                    if (!doorObj.isLocked) {
                        doorObj.tileSprite?.setFrame(DOOR_UNLOCKED_GID - 1);
                        doorObj.topSprite?.setFrame(DOOR_UNLOCKED_TOP_GID - 1);
                        this.transitioning = true;
                        this.time.delayedCall(500, () => this.switchLevel(doorObj.targetLevel));
                    }
                    return;
                }
                this.transitioning = true;
                this.switchLevel(doorObj.targetLevel);
                this.game.events.emit('level-changed', doorObj.targetLevel.slice(-2));
            });
        }

        this.physics.add.collider(this.bulletGroup, platformLayer! || this.player, bullet => bullet.destroy());
        this.physics.add.collider(this.bulletGroup, this.platformGroup, bullet => bullet.destroy());
        this.physics.add.overlap(this.bulletGroup, this.boxGroup, bullet => bullet.destroy());
        this.physics.add.overlap(this.player, this.bulletGroup, p => (p as Player).death());

        this.cursors = this.input.keyboard!.createCursorKeys();
        this.debugKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);

        // Mic 
        if (!this.mic) {
            this.mic = new micInput();
            this.mic.init().then(() => {
                this.game.registry.set('mic', this.mic);
                this.scene.launch('calibration');
            });
        }

        if (this.scene.isActive('volumeBar')) this.scene.stop('volumeBar');
        this.scene.launch('volumeBar');

        // Write initial UI state to the registry before launching UIScene so it
        // can read the correct level and hint on create() without relying on events
        // that may fire before its listener is registered.
        this.game.registry.set('currentLevel', this.currentLevelId.slice(-2));
        this.game.registry.set('levelName', LEVEL_NAMES[this.currentLevelId] ?? '');
        this.game.registry.set('showHint', this.currentLevelId === 'level01' ? 'arrow-keys' : null);

        if (this.scene.isActive('ui')) this.scene.stop('ui');
        this.scene.launch('ui');

        this.scene.resume();
    }

    private buildControlsHint() {
        const s = 1 / CAMERA_ZOOM;
        this.moveLabel = this.add.text(20, 78, 'Move', {
                fontFamily: '"Press Start 2P"',
                fontSize:   '10px',
                color:      '#c0c0c0',
            })
            .setOrigin(0.5, 1)
            .setScale(s)
            .setAlpha(0.6)
            .setDepth(5)
            .setVisible(this.currentLevelId === 'level01');

        this.controlsHint = this.add
            .image(20, 95, 'controls-callout')
            .setOrigin(0.5, 1)
            .setScale(s)
            .setAlpha(0.6)
            .setDepth(5)
            .setVisible(this.currentLevelId === 'level01');
    }

    switchLevel(levelId: string) {
        this.scene.restart({ levelId });
    }

    // Game loop 
    update(_time: number, delta: number) {
        const vol = this.debugKey.isDown ? 0.8 : (this.mic?.smoothedVolume() ?? 0);
        // Jump uses instantaneous normalized volume — EMA-smoothed vol lags too much
        // to capture a shout at the moment of jump (frame 1 smoothed ≈ 30% of actual peak).
        const jumpVol = this.debugKey.isDown ? 0.8 : (this.mic?.getNormalizedVolume() ?? vol);

        // Pause Toggle
        if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
            if (this.scene.isPaused()) {
                this.scene.resume();
                this.scene.stop('settings');
            }
            else {
                this.scene.pause();
                this.scene.launch('settings');
            }
        }

        this.playerController.update({ vol, jumpVol, cursors: this.cursors, delta });

        // Keys: AABB pickup (no physics body — see Key). Copy the list since we destroy while iterating.
        for (const item of [...this.itemGroup.getChildren()]) {
            const key = item as Key;
            if (!key.active) continue;
            if (bodyOverlapsSensor(this.player.Body, key)) {
                this.player.items.push(key.keyType);
                key.tileSprite?.destroy();
                key.destroy();
            }
        }

        this.switchGroup.getChildren().forEach((s: Phaser.GameObjects.GameObject) => {
            const sw = s as Switch;
            if (bodyOverlapsSensor(this.player.Body, sw)) sw.onOverlap();
            for (const b of this.boxGroup.getChildren()) {
                if (!b.active) continue;
                if (bodyOverlapsSensor((b as Box).Body, sw)) sw.onOverlap();
            }
            sw.tick();
        });
        this.hazardGroup.getChildren().forEach((h: Phaser.GameObjects.GameObject) => (h as Hazard).update());
        this.platformGroup.getChildren().forEach((p: Phaser.GameObjects.GameObject) => (p as MovingPlatform).update(delta));
        this.boxGroup.getChildren().forEach((b: Phaser.GameObjects.GameObject) => (b as Box).update());
        this.punchBoxGroup.getChildren().forEach((go: Phaser.GameObjects.GameObject) => {
            (go as PunchBox).update(this.player);
        });
    }
}
