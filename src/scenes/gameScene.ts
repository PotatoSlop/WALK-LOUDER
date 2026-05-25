import Phaser from 'phaser';
import { Player } from '../objects/player';
import { micInput } from '../systems/MicInput';
import { Door } from '../objects/door';
import { Hazard } from '../objects/hazards';
import { Key } from '../objects/key';
import { MovingPlatform } from '../objects/movingPlatform';
import { Switch } from '../objects/switches';

// Door tile GIDs — determines lock behaviour
const DOOR_LOCKED_GID = 378;   // door with handle → locked, requires key
const DOOR_UNLOCKED_GID = 376; // door without handle → always unlocked

// Saw animation frames — each sub-array is one anim frame with 3 tile GIDs [left, center, right]
const SAW_ANIM_FRAMES = [
    [93, 94, 95],
    [113, 114, 115],
    [133, 134, 135],
];

// Turret tiles — 2×2 grid [topLeft, topRight, bottomLeft, bottomRight]
const TURRET_TILE_GIDS = [36, 37, 56, 57];

// Trigger spike animation frames — retracted (92) → fully extended (152)
const TRIGGER_SPIKE_FRAMES = [92, 112, 132, 152];

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
    mic: any;

    private currentLevelId: string = 'level01';

    constructor() {
        super({ key: 'main' });
    }

/*     init(data: { levelId?: string }) {
        this.currentLevelId = data.levelId
            ?? localStorage.getItem('walkloud_currentLevel')
            ?? 'level01';
    } */

    init(data: { levelId?: string }) {
        this.currentLevelId = data.levelId ?? 'level01';
    }

    preload() {
        this.load.tilemapTiledJSON(this.currentLevelId, `assets/data/levels/${this.currentLevelId}.tmj`);
        this.load.image('tiles', 'assets/walk-louder-tile-sheet.png');
        this.load.spritesheet('tileSprites', 'assets/walk-louder-tile-sheet.png', { frameWidth: 8, frameHeight: 8 });
        this.load.json('hazardConfig', 'assets/data/hazards.json');
    }

    create() {
        // Groups
        this.hazardGroup   = this.add.group();
        this.doorGroup     = this.add.group();
        this.itemGroup     = this.add.group();
        this.switchGroup   = this.add.group();
        this.platformGroup = this.add.group();

        // Tilemap
        const map = this.make.tilemap({ key: this.currentLevelId });
        const tileset = map.addTilesetImage('walk-louder-tile-sheet', 'tiles');
        const platformLayer = map.createLayer('Tile Layer 1', tileset!);
        platformLayer!.setCollision([42]);

        // Lock world + camera to tilemap dimensions (screen edge = level edge)
        this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
        this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
        this.cameras.main.setZoom(CAMERA_ZOOM);

        // ── Spawn player ──────────────────────────────────────────────
        const spawnLayer = map.getObjectLayer('Spawn');
        const sp = spawnLayer!.objects[0];
        const spawnX = sp.x! + sp.width! / 2;
        const spawnY = (sp.gid ? sp.y! - sp.height! : sp.y!) + sp.height! / 2;
        this.player = new Player(this, spawnX, spawnY);
        this.player.levelStartX = spawnX;
        this.player.levelStartY = spawnY;

        // ── Spawn hazards from Tiled (spikes, trigger_spikes) ──────────
        // Saws and turrets are now driven by hazards.json — see below.
        const hazardLayer = map.getObjectLayer('Hazards');
        if (hazardLayer) {
            for (const obj of hazardLayer.objects) {
                const type = this.getTiledProp(obj, 'type');
                if (type === 'saw' || type === 'turret') continue; // handled by config

                const w = obj.width!;
                const h = obj.height!;
                const rot = obj.rotation ?? 0;

                // Compute center — tile objects (gid) use bottom-left origin
                // and rotation is around that corner, which shifts the center.
                let cx: number, cy: number;
                if (obj.gid) {
                    const rad = rot * Math.PI / 180;
                    const cosR = Math.cos(rad);
                    const sinR = Math.sin(rad);
                    cx = obj.x! + (w / 2) * cosR + (h / 2) * sinR;
                    cy = obj.y! + (w / 2) * sinR - (h / 2) * cosR;
                } else {
                    // Plain rectangle — top-left origin, no rotation
                    cx = obj.x! + w / 2;
                    cy = obj.y! + h / 2;
                }

                // Render tile sprite for objects that have a gid
                if (obj.gid) this.addTileSprite(obj.gid, obj.x!, obj.y!, rot);

                switch (type) {
                    case 'spike': {
                        const spike = new Hazard(this, cx, cy, w, h, true);
                        if (obj.gid) spike.setAlpha(0); // visual handled by tile sprite
                        this.hazardGroup.add(spike);
                        break;
                    }
                    case 'trigger_spike': {
                        // Visual — animated pop-up spike tile(s)
                        const numSpikeTiles = Math.max(1, Math.round(w / 8));
                        const trigContainer = this.add.container(cx, cy);
                        trigContainer.setDepth(50);
                        const trigTiles: Phaser.GameObjects.Image[] = [];
                        for (let i = 0; i < numSpikeTiles; i++) {
                            const tileX = (i - (numSpikeTiles - 1) / 2) * 8;
                            const tile = this.add.image(tileX, 0, 'tileSprites', TRIGGER_SPIKE_FRAMES[0] - 1);
                            tile.setOrigin(0.5, 0.5);
                            trigContainer.add(tile);
                            trigTiles.push(tile);
                        }
                        // Cycle: retract → extend → retract
                        let trigFrame = 0;
                        let trigForward = true;
                        this.time.addEvent({
                            delay: 250,
                            loop: true,
                            callback: () => {
                                if (trigForward) {
                                    trigFrame++;
                                    if (trigFrame >= TRIGGER_SPIKE_FRAMES.length - 1) trigForward = false;
                                } else {
                                    trigFrame--;
                                    if (trigFrame <= 0) trigForward = true;
                                }
                                const frame = TRIGGER_SPIKE_FRAMES[trigFrame] - 1;
                                trigTiles.forEach(t => t.setFrame(frame));
                            },
                        });

                        const tSpike = new Hazard(this, cx, cy, w, h, true);
                        tSpike.setAlpha(0);
                        tSpike.tileSprite = trigContainer;
                        this.hazardGroup.add(tSpike);
                        break;
                    }
                }
            }
        }

        // ── Spawn interactables (before config hazards so switches exist for linking) ──
        const interLayer = map.getObjectLayer('Interactables');
        if (interLayer) {
            for (const obj of interLayer.objects) {
                const type = this.getTiledProp(obj, 'type');
                const x = obj.x!;
                const y = obj.gid ? obj.y! - obj.height! : obj.y!;
                const w = obj.width!;
                const h = obj.height!;
                const cx = x + w / 2;
                const cy = y + h / 2;

                switch (type) {
                    case 'door': {
                        const targetLevel = this.getTiledProp(obj, 'targetLevel') ?? '';
                        // Lock state from tile: handle = locked, no handle = unlocked
                        const locked = obj.gid === DOOR_LOCKED_GID;
                        const keyType = locked ? 'default' : null;
                        const sprite = obj.gid
                            ? this.addTileSprite(obj.gid, obj.x!, obj.y!)
                            : null;
                        const door = new Door(this, cx, cy, w, h, locked, keyType, targetLevel);
                        door.setAlpha(0);
                        door.tileSprite = sprite;
                        this.doorGroup.add(door);
                        break;
                    }
                    case 'door_top': {
                        // Decorative top piece — visual only
                        if (obj.gid) this.addTileSprite(obj.gid, obj.x!, obj.y!);
                        break;
                    }
                    case 'key': {
                        const keyType = this.getTiledProp(obj, 'keyType') ?? 'default';
                        const sprite = obj.gid
                            ? this.addTileSprite(obj.gid, obj.x!, obj.y!)
                            : null;
                        const k = new Key(this, cx, cy, w, h, keyType);
                        k.setAlpha(0);
                        k.tileSprite = sprite;
                        this.itemGroup.add(k);
                        break;
                    }
                    case 'switch': {
                        const switchType = (this.getTiledProp(obj, 'switchType') ?? 'button') as 'button' | 'lever' | 'oneshot';
                        const sprite = obj.gid ? this.addTileSprite(obj.gid, obj.x!, obj.y!) : null;
                        const sw = new Switch(this, cx, cy, w, h, switchType);
                        sw.setAlpha(0);
                        if (sprite) {
                            sw.tileSprite = sprite;
                            sw.baseFrame = obj.gid! - 1;
                        }
                        this.switchGroup.add(sw);
                        break;
                    }
                }
            }
        }

        // ── Spawn dynamic hazards from config (hazards.json) ──────────
        // Edit hazards.json directly to add/move/tune saws and turrets.
        // Positions are center coords in world space — no grid snap.
        // Runs AFTER interactables so switches are available for linking.
        const hazardConfig = this.cache.json.get('hazardConfig');
        const levelHazards = hazardConfig?.[this.currentLevelId];

        if (levelHazards?.saws) {
            for (const cfg of levelHazards.saws) {
                const { x, y, endX = x, endY = y, speed = 30 } = cfg;
                const hasMovement = endX !== x || endY !== y;

                // Visual — 3-tile-wide saw with cycling animation
                const sawContainer = this.add.container(x, y);
                sawContainer.setDepth(50);
                const sawTiles: Phaser.GameObjects.Image[] = [];
                for (let i = 0; i < 3; i++) {
                    const tile = this.add.image((i - 1) * 8, 0, 'tileSprites', SAW_ANIM_FRAMES[0][i] - 1);
                    tile.setOrigin(0.5, 0.5);
                    sawContainer.add(tile);
                    sawTiles.push(tile);
                }
                let sawFrame = 0;
                this.time.addEvent({
                    delay: 150,
                    loop: true,
                    callback: () => {
                        sawFrame = (sawFrame + 1) % SAW_ANIM_FRAMES.length;
                        for (let i = 0; i < 3; i++) {
                            sawTiles[i].setFrame(SAW_ANIM_FRAMES[sawFrame][i] - 1);
                        }
                    },
                });

                // Hitbox: center 8×8 tile only
                const saw = new Hazard(
                    this, x, y, 8, 8,
                    !hasMovement,
                    hasMovement ? { x: endX, y: endY } : undefined,
                    hasMovement ? speed : undefined,
                    'auto'
                );
                saw.setAlpha(0);
                saw.tileSprite = sawContainer;

                // Link to a switch if configured — saw starts disabled
                if (cfg.linkedSwitch !== undefined) {
                    const switches = this.switchGroup.getChildren();
                    const sw = switches[cfg.linkedSwitch] as Switch;
                    if (sw) {
                        saw.linkSwitch(sw);
                        saw.setEnabled(false);
                    }
                }

                this.hazardGroup.add(saw);
            }
        }

        if (levelHazards?.turrets) {
            for (const cfg of levelHazards.turrets) {
                const { x, y, direction = 'right' } = cfg;

                // Visual — 2×2 tile grid in a container
                const turretContainer = this.add.container(x, y);
                turretContainer.setDepth(50);
                const offsets = [[-4, -4], [4, -4], [-4, 4], [4, 4]];
                for (let i = 0; i < 4; i++) {
                    const tile = this.add.image(offsets[i][0], offsets[i][1], 'tileSprites', TURRET_TILE_GIDS[i] - 1);
                    tile.setOrigin(0.5, 0.5);
                    turretContainer.add(tile);
                }
                const dirAngles: Record<string, number> = { right: 0, down: 90, left: 180, up: -90 };
                turretContainer.setAngle(dirAngles[direction] ?? 0);

                const turret = new Hazard(this, x, y, 16, 16, true);
                turret.setAlpha(0);
                turret.tileSprite = turretContainer;
                this.hazardGroup.add(turret);
            }
        }

        // ── Collision callbacks ────────────────────────────────────────
        // Per-object overlaps — bypasses Phaser's group-level canCollide gate
        // which silently blocks all overlap checks on plain groups.
        this.physics.add.collider(this.player, platformLayer!);

        for (const h of this.hazardGroup.getChildren()) {
            this.physics.add.overlap(this.player, h, (p) => {
                (p as Player).death();
            });
        }

        for (const item of this.itemGroup.getChildren()) {
            this.physics.add.overlap(this.player, item, (p, i) => {
                const key = i as Key;
                (p as Player).items.push(key.keyType);
                if (key.tileSprite) key.tileSprite.destroy();
                key.destroy();
            });
        }

        for (const d of this.doorGroup.getChildren()) {
            this.physics.add.overlap(this.player, d, (p, door) => {
                const doorObj = door as Door;
                const player = p as Player;
                if (doorObj.isLocked) {
                    doorObj.open(player.items);
                    if (!doorObj.isLocked && doorObj.tileSprite) {
                        doorObj.tileSprite.setFrame(DOOR_UNLOCKED_GID - 1);
                    }
                }
                if (!doorObj.isLocked) this.switchLevel(doorObj.targetLevel);
            });
        }

        for (const s of this.switchGroup.getChildren()) {
            this.physics.add.overlap(this.player, s, (_p, sw) => (sw as Switch).onOverlap());
        }

        // ── Input ─────────────────────────────────────────────────────
        this.cursors = this.input.keyboard!.createCursorKeys();

        // ── Mic ───────────────────────────────────────────────────────
        if (!this.mic) {
            this.mic = new micInput();
            this.mic.init().then(() => {
                this.scene.launch('calibration', { mic: this.mic });
            });
        }

        if (this.scene.isActive('debug')) this.scene.stop('debug');
        this.scene.launch('debug');
    }

    // ── Helpers ────────────────────────────────────────────────────────

    /**
     * Place a tile sprite from the spritesheet.
     * Uses Tiled's raw (x, y) — bottom-left origin for tile objects.
     */
    private addTileSprite(
        gid: number,
        tiledX: number,
        tiledY: number,
        rotation: number = 0
    ): Phaser.GameObjects.Image {
        const img = this.add.image(tiledX, tiledY, 'tileSprites', gid - 1);
        // Tile objects in Tiled use bottom-left as their anchor point
        img.setOrigin(0, 1);
        if (rotation !== 0) {
            img.setAngle(rotation);
        }
        return img;
    }

    private getTiledProp(
        obj: Phaser.Types.Tilemaps.TiledObject,
        name: string
    ): string | undefined {
        const prop = obj.properties?.find((p: any) => p.name === name);
        return prop?.value;
    }

    switchLevel(levelId: string) {
        // Normalise: Tiled uses "level-02" but filenames / config keys use "level02"
        const id = levelId.replace(/-/g, '');
        localStorage.setItem('walkloud_currentLevel', id);
        this.scene.restart({ levelId: id });
    }

    // ── Game loop ──────────────────────────────────────────────────────

    update(_time: number, delta: number) {
        var debugKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);

        const vol = debugKey.isDown ? 0.8 : (this.mic?.smoothedVolume() ?? 0);

        if (this.cursors.left.isDown) {
            this.player.moveLeft(vol);
        } else if (this.cursors.right.isDown) {
            this.player.moveRight(vol);
        } else {
            // Bleed speed whether airborne or grounded — heavier on ground,
            // light in air so the landing transition isn't a hard cliff.
            const friction = this.player.Body.blocked.down ? 0.82 : 0.97;
            this.player.setSpeedMultiplier(friction);
        }

        if (this.player.Body.blocked.down && performance.now() - this.player.jumpTime > 100) {
            this.player.lastGroundedTime = performance.now();
        }

        if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
            this.player.lastJumpInputTime = performance.now();
        }

        if (performance.now() - this.player.lastJumpInputTime <= this.player.JumpBufferTime) {
            this.player.jump(vol);
        }

        this.player.applyVocalBoost(vol);

        const boostActive = performance.now() - this.player.jumpTime < this.player.jumpBoostWindow;
        if (this.cursors.up.isUp && this.player.Body.velocity.y < 0 && !boostActive) {
            this.player.Body.setVelocityY(this.player.Body.velocity.y * 0.85);
        }

        this.switchGroup.getChildren().forEach((s: Phaser.GameObjects.GameObject) => (s as Switch).tick());
        this.hazardGroup.getChildren().forEach((h: Phaser.GameObjects.GameObject) => (h as Hazard).update());
        this.platformGroup.getChildren().forEach((p: Phaser.GameObjects.GameObject) => (p as MovingPlatform).update(delta));
    }
}
