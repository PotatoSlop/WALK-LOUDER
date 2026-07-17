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
import { Magnet } from '../objects/magnet';
import { bodyOverlapsSensor } from '../systems/overlap';
import { getSetting } from '../systems/settingsManager';
import { LEVEL_NAMES } from '../data/levels';
import { TiledContext } from '../systems/tiled';
import { LevelBuilder } from '../systems/levelBuilder';
import { setupCameraFX } from '../systems/cameraFX';
import { PlayerController } from '../systems/playerController';
import { GameState, GAMEMODE_CHANGED, GameMode } from '../systems/gameState';
import { SoundManager } from '../systems/soundFX';

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
    magnetGroup: any;
    platformLayer: any;
    mic: any;
    escKey: any;

    private controlsHint!: Phaser.GameObjects.Image;
    private moveLabel!: Phaser.GameObjects.Text;

    private deathCt: number = 0;
    private gameState!: GameState;

    private currentLevelId: string = 'level01';
    private transitioning: boolean = false;
    private debugKey!: Phaser.Input.Keyboard.Key;
    private playerController!: PlayerController;

    // Previous frame's sustained-sound state — sounds are toggled only on transitions.
    private platformMoving: boolean = false;
    private magnetPulling: boolean = false;
    private sawTravelling: boolean = false;

    constructor() {
        super({ key: 'main' });
    }

    init(data: { levelId?: string }) {
        this.currentLevelId = data.levelId ?? 'level03';
        this.transitioning = false;
        this.deathCt = this.game.registry.get('deathCt') ?? 0;

        // Single GameState shared across scene restarts (death/respawn) — persist it in the
        // registry and reuse. Uses the global game emitter so mode-change listeners survive
        // restarts. startRun is idempotent, so the clock keeps ticking through respawns.
        this.gameState = this.game.registry.get('gameState') as GameState
            ?? new GameState(this.game.events);
        this.game.registry.set('gameState', this.gameState);
    }

    preload() {
        this.load.tilemapTiledJSON(this.currentLevelId, `assets/data/levels/${this.currentLevelId}.tmj`);
        this.load.image('tiles', 'assets/walk-louder-tile-sheet.png');
        this.load.image('controls-callout', 'assets/Control_callout.png');
        this.load.spritesheet('tileSprites', 'assets/walk-louder-tile-sheet.png', { frameWidth: 8, frameHeight: 8 });
        this.load.spritesheet('player', 'assets/walkter-Sheet.png', { frameWidth: 8, frameHeight: 16 });
        SoundManager.preload(this);
    }

    create() {
        this.escKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

        // Sound is wired through the persistent global event emitter, so build the manager
        // once and reuse it across scene restarts (respawns / level changes).
        if (!this.game.registry.get('soundManager')) {
            this.game.registry.set('soundManager', new SoundManager(this));
        }
        // Sustained-sound state is per-run — reset so the first move/pull after a
        // restart re-triggers its loop (the scene instance is reused across restarts).
        this.platformMoving = false;
        this.magnetPulling = false;
        this.sawTravelling = false;

        // Tilemap
        const map = this.make.tilemap({ key: this.currentLevelId });
        const tileset = map.addTilesetImage('walk-louder-tile-sheet', 'tiles');
        const platformLayer = map.createLayer('Tile Layer 1', tileset!);
        this.platformLayer = platformLayer!;

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

            this.game.events.emit('player-death-fx', { x: this.player.x, y: this.player.y, color, cause: this.player.deathCause });

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
        this.magnetGroup   = level.groups.magnet;

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

        const platforms = this.platformGroup.getChildren() as MovingPlatform[];
        for (const p of platforms) {
            for (const other of platforms) {
                if (p === other) continue;
                
                const pBody = p.Body;
                const oBody = other.Body;
                
                // If 'other' is sitting directly above 'p'
                if (Math.abs(oBody.bottom - pBody.top) <= 2 && 
                    oBody.right > pBody.left + 2 && 
                    oBody.left < pBody.right - 2) {
                    
                    // Disable inner edges of vertical platform blocks -> removes collison bugs with multi-tile platforms
                    pBody.checkCollision.up = false; 
                    oBody.checkCollision.down = false; 
                }
            }
        }

        for (const h of this.hazardGroup.getChildren()) {
            this.physics.add.overlap(this.player, h, (p) => (p as Player).death());
        }

        // The magnet kills on contact with its own tile — a plain overlap (disabled magnets have
        // their body turned off, so this won't fire while unpowered).
        this.physics.add.overlap(this.player, this.magnetGroup, (p) => (p as Player).death());

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
                        this.game.events.emit('sfx-door-win');
                        this.time.delayedCall(500, () => this.switchLevel(doorObj.targetLevel));
                    }
                    return;
                }
                this.transitioning = true;
                this.game.events.emit('sfx-door-win');
                this.switchLevel(doorObj.targetLevel);
                this.game.events.emit('level-changed', doorObj.targetLevel.slice(-2));
            });
        }

        // Bullets destroyed against geometry (not the player) play the wall-hit sound.
        const killBullet = (bullet: any) => {
            this.game.events.emit('sfx-bullet-hit-wall');
            bullet.destroy();
        };
        this.physics.add.collider(this.bulletGroup, platformLayer! || this.player, killBullet);
        this.physics.add.collider(this.bulletGroup, this.platformGroup, killBullet);
        this.physics.add.overlap(this.bulletGroup, this.boxGroup, killBullet);
        this.physics.add.overlap(this.player, this.bulletGroup, p => (p as Player).death('bullet'));

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

        // Run timing + mode side effects. startRun/split are idempotent, so a death-respawn
        // restart resumes cleanly; split dedupes so only genuine level changes are recorded.
        this.gameState.startRun(this.currentLevelId);
        this.gameState.split(this.currentLevelId);

        // React to mode changes in one place. Listener lives on the global emitter (fires even
        // while this scene is paused), so remove it on shutdown to avoid stale-scene callbacks.
        this.game.events.on(GAMEMODE_CHANGED, this.applyMode, this);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.game.events.off(GAMEMODE_CHANGED, this.applyMode, this);
            // Kill any sustained loops so they don't bleed across the level teardown.
            this.game.events.emit('sfx-stop-loops');
        });

        // Entering (or restarting into) gameplay is always the 'playing' mode.
        this.gameState.set('playing');
        this.applyMode('playing');
    }

    // The single place where a GameMode change turns into scene side effects.
    private applyMode(mode: GameMode) {
        switch (mode) {
            case 'playing':
                if (this.scene.isActive('settings')) this.scene.stop('settings');
                this.scene.resume();
                break;
            case 'paused':
            case 'settings':
                this.scene.pause();
                if (!this.scene.isActive('settings')) this.scene.launch('settings');
                break;
            case 'results':
                // No results screen yet — freeze gameplay; the run clock stops on its own.
                this.scene.pause();
                break;
        }
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
        const jumpVol = this.debugKey.isDown ? 0.8 : (this.mic?.getNormalizedVolume() ?? vol);

        if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
            this.game.events.emit('sfx-pause');
            this.gameState.set(this.gameState.isPlaying() ? 'settings' : 'playing');
        }

        this.playerController.update({ vol, jumpVol, cursors: this.cursors, delta });

        for (const item of [...this.itemGroup.getChildren()]) {
            const key = item as Key;
            if (!key.active) continue;
            if (bodyOverlapsSensor(this.player.Body, key)) {
                this.player.items.push(key.keyType);
                this.game.events.emit('item-collect');
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

        this.updateMagnets();
        this.updateLoopSounds();
    }

    // Toggle the sustained platform/magnet sounds on state transitions only.
    private updateLoopSounds() {
        const anyPlatformMoving = this.platformGroup.getChildren().some(
            (p: Phaser.GameObjects.GameObject) => {
                const b = (p as MovingPlatform).Body;
                return Math.abs(b.velocity.x) > 0.5 || Math.abs(b.velocity.y) > 0.5;
            });
        if (anyPlatformMoving !== this.platformMoving) {
            this.platformMoving = anyPlatformMoving;
            this.game.events.emit('sfx-platform-move', { moving: anyPlatformMoving });
        }

        const anyMagnetPulling = this.magnetGroup.getChildren().some(
            (m: Phaser.GameObjects.GameObject) => (m as Magnet).pulledThisFrame);
        if (anyMagnetPulling !== this.magnetPulling) {
            this.magnetPulling = anyMagnetPulling;
            this.game.events.emit('sfx-magnet', { active: anyMagnetPulling });
        }

        const anySawTravelling = this.hazardGroup.getChildren().some(
            (h: Phaser.GameObjects.GameObject) => {
                const hz = h as Hazard;
                return hz.isSaw && hz.active && !hz.isStatic &&
                    (Math.abs(hz.Body.velocity.x) > 0.5 || Math.abs(hz.Body.velocity.y) > 0.5);
            });
        if (anySawTravelling !== this.sawTravelling) {
            this.sawTravelling = anySawTravelling;
            this.game.events.emit('sfx-saw', { moving: anySawTravelling });
        }
    }

    private updateMagnets() {
        if (this.magnetGroup.getLength() === 0) return;

        const bodies: Phaser.Physics.Arcade.Body[] = [this.player.Body];
        for (const b of this.boxGroup.getChildren()) {
            if (b.active) bodies.push((b as Box).Body);
        }

        // A field tile is blocked by a solid map tile or any moving platform occupying it.
        const blockedAt = (wx: number, wy: number): boolean => {
            const tile = this.platformLayer.getTileAtWorldXY(wx, wy);
            if (tile && tile.collides) return true;
            for (const p of this.platformGroup.getChildren()) {
                const pb = (p as MovingPlatform).Body;
                if (wx >= pb.left && wx <= pb.right && wy >= pb.top && wy <= pb.bottom) return true;
            }
            return false;
        };

        this.magnetGroup.getChildren().forEach((m: Phaser.GameObjects.GameObject) =>
            (m as Magnet).update(bodies, blockedAt));
    }

}
