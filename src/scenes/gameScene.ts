import Phaser from 'phaser';
import { Player } from '../objects/player';
import { micInput } from '../systems/MicInput';
import { Door } from '../objects/door';
import { Hazard } from '../objects/hazards';
import { Key } from '../objects/key';
import { MovingPlatform } from '../objects/movingPlatform';
import { Switch } from '../objects/switches';

// Door tile GIDs — determines lock behaviour
const DOOR_LOCKED_GID = 378;        // door body with handle → locked
const DOOR_UNLOCKED_GID = 376;      // door body without handle → unlocked
const DOOR_UNLOCKED_TOP_GID = 356;  // top piece paired with the unlocked body (locked top is +2 = 358)

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
    private transitioning: boolean = false;

    constructor() {
        super({ key: 'main' });
    }

    init(data: { levelId?: string }) {
        this.currentLevelId = data.levelId ?? 'level01';
        this.transitioning = false;
    }

    preload() {
        this.load.tilemapTiledJSON(this.currentLevelId, `assets/data/levels/${this.currentLevelId}.tmj`);
        this.load.image('tiles', 'assets/walk-louder-tile-sheet.png');
        this.load.spritesheet('tileSprites', 'assets/walk-louder-tile-sheet.png', { frameWidth: 8, frameHeight: 8 });
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

        // ── Spawn interactables first — switches must exist before hazards link to them
        const switchById = new Map<number, Switch>();
        const doorByX = new Map<number, Door>();
        const interLayer = map.getObjectLayer('Interactables');
        if (interLayer) {
            for (const obj of interLayer.objects) this.spawnInteractable(obj, switchById, doorByX);
        }

        // ── Spawn all hazards from the Tiled Hazards layer
        const hazardLayer = map.getObjectLayer('Hazards');
        if (hazardLayer) {
            for (const obj of hazardLayer.objects) this.spawnHazard(obj, switchById);
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
                if (this.transitioning) return;
                const doorObj = door as Door;
                const player = p as Player;
                if (doorObj.isLocked) {
                    doorObj.open(player.items);
                    if (!doorObj.isLocked) {
                        doorObj.tileSprite?.setFrame(DOOR_UNLOCKED_GID - 1);
                        doorObj.topSprite?.setFrame(DOOR_UNLOCKED_TOP_GID - 1);
                        // Unlock animation pause — let the player see the sprite swap before transition
                        this.transitioning = true;
                        this.time.delayedCall(300, () => this.switchLevel(doorObj.targetLevel));
                    }
                    return;
                }
                this.transitioning = true;
                this.switchLevel(doorObj.targetLevel);
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

    private getTiledProp<T = any>(
        obj: Phaser.Types.Tilemaps.TiledObject,
        name: string
    ): T | undefined {
        const prop = obj.properties?.find((p: any) => p.name === name);
        return prop?.value;
    }

    /**
     * Compute world-space center + size for a Tiled object.
     * Tile objects (with gid) anchor at bottom-left; rectangles anchor at top-left.
     */
    private objectGeometry(obj: Phaser.Types.Tilemaps.TiledObject) {
        const w = obj.width!;
        const h = obj.height!;
        const rot = obj.rotation ?? 0;
        let cx: number, cy: number;
        if (obj.gid) {
            const rad = rot * Math.PI / 180;
            const cosR = Math.cos(rad);
            const sinR = Math.sin(rad);
            cx = obj.x! + (w / 2) * cosR + (h / 2) * sinR;
            cy = obj.y! + (w / 2) * sinR - (h / 2) * cosR;
        } else {
            cx = obj.x! + w / 2;
            cy = obj.y! + h / 2;
        }
        return { cx, cy, w, h, rot };
    }

    private spawnInteractable(
        obj: Phaser.Types.Tilemaps.TiledObject,
        switchById: Map<number, Switch>,
        doorByX: Map<number, Door>
    ) {
        const type = this.getTiledProp<string>(obj, 'type');
        const { cx, cy, w, h } = this.objectGeometry(obj);
        const sprite = obj.gid ? this.addTileSprite(obj.gid, obj.x!, obj.y!) : null;

        switch (type) {
            case 'door': {
                const targetLevel = this.getTiledProp<string>(obj, 'targetLevel') ?? '';
                const locked = obj.gid === DOOR_LOCKED_GID;
                const keyType = locked ? 'default' : null;
                const door = new Door(this, cx, cy, w, h, locked, keyType, targetLevel);
                door.setAlpha(0);
                door.tileSprite = sprite;
                this.doorGroup.add(door);
                doorByX.set(obj.x!, door);
                break;
            }
            case 'door_top': {
                // Decorative top piece — link to the door at the same column so the
                // top sprite can be swapped when the door unlocks at runtime.
                const door = doorByX.get(obj.x!);
                if (door) door.topSprite = sprite;
                break;
            }
            case 'key': {
                const keyType = this.getTiledProp<string>(obj, 'keyType') ?? 'default';
                const k = new Key(this, cx, cy, w, h, keyType);
                k.setAlpha(0);
                k.tileSprite = sprite;
                this.itemGroup.add(k);
                break;
            }
            case 'switch': {
                const switchType = (this.getTiledProp<string>(obj, 'switchType') ?? 'button') as 'button' | 'lever' | 'oneshot';
                const sw = new Switch(this, cx, cy, w, h, switchType);
                sw.setAlpha(0);
                if (sprite) {
                    sw.tileSprite = sprite;
                    sw.baseFrame = obj.gid! - 1;
                }
                this.switchGroup.add(sw);
                switchById.set(obj.id!, sw);
                break;
            }
        }
    }

    private spawnHazard(
        obj: Phaser.Types.Tilemaps.TiledObject,
        switchById: Map<number, Switch>
    ) {
        const type = this.getTiledProp<string>(obj, 'type');
        const { cx, cy, w, h, rot } = this.objectGeometry(obj);

        switch (type) {
            case 'spike': {
                if (obj.gid) this.addTileSprite(obj.gid, obj.x!, obj.y!, rot);
                const spike = new Hazard(this, cx, cy, w, h, true);
                if (obj.gid) spike.setAlpha(0);
                this.hazardGroup.add(spike);
                break;
            }
            case 'trigger_spike':
                this.spawnTriggerSpike(cx, cy, w, h);
                break;
            case 'saw':
                this.spawnSaw(obj, cx, cy, switchById);
                break;
            case 'turret':
                this.spawnTurret(obj, cx, cy);
                break;
        }
    }

    private spawnTriggerSpike(cx: number, cy: number, w: number, h: number) {
        const tileCount = Math.max(1, Math.round(w / 8));
        const container = this.add.container(cx, cy).setDepth(50);
        const tiles: Phaser.GameObjects.Image[] = [];
        for (let i = 0; i < tileCount; i++) {
            const t = this.add.image((i - (tileCount - 1) / 2) * 8, 0, 'tileSprites', TRIGGER_SPIKE_FRAMES[0] - 1);
            container.add(t);
            tiles.push(t);
        }
        let frame = 0;
        let forward = true;
        this.time.addEvent({
            delay: 250,
            loop: true,
            callback: () => {
                if (forward) { frame++; if (frame >= TRIGGER_SPIKE_FRAMES.length - 1) forward = false; }
                else         { frame--; if (frame <= 0) forward = true; }
                tiles.forEach(t => t.setFrame(TRIGGER_SPIKE_FRAMES[frame] - 1));
            },
        });

        const hazard = new Hazard(this, cx, cy, w, h, true);
        hazard.setAlpha(0);
        hazard.tileSprite = container;
        this.hazardGroup.add(hazard);
    }

    private spawnSaw(
        obj: Phaser.Types.Tilemaps.TiledObject,
        cx: number, cy: number,
        switchById: Map<number, Switch>
    ) {
        const endX = this.getTiledProp<number>(obj, 'endX') ?? cx;
        const endY = this.getTiledProp<number>(obj, 'endY') ?? cy;
        const speed = this.getTiledProp<number>(obj, 'speed') ?? 30;
        const linkedSwitchId = this.getTiledProp<number>(obj, 'linkedSwitchId');
        const moves = endX !== cx || endY !== cy;

        const container = this.add.container(cx, cy).setDepth(50);
        const tiles: Phaser.GameObjects.Image[] = [];
        for (let i = 0; i < 3; i++) {
            const t = this.add.image((i - 1) * 8, 0, 'tileSprites', SAW_ANIM_FRAMES[0][i] - 1);
            container.add(t);
            tiles.push(t);
        }
        let f = 0;
        this.time.addEvent({
            delay: 150,
            loop: true,
            callback: () => {
                f = (f + 1) % SAW_ANIM_FRAMES.length;
                for (let i = 0; i < 3; i++) tiles[i].setFrame(SAW_ANIM_FRAMES[f][i] - 1);
            },
        });

        // Hitbox is only the 8×8 center tile — visual is decorative
        const saw = new Hazard(
            this, cx, cy, 8, 8,
            !moves,
            moves ? { x: endX, y: endY } : undefined,
            moves ? speed : undefined,
            'auto'
        );
        saw.setAlpha(0);
        saw.tileSprite = container;

        if (linkedSwitchId !== undefined) {
            const sw = switchById.get(linkedSwitchId);
            if (sw) {
                saw.linkSwitch(sw);
                saw.setEnabled(false);
            }
        }

        this.hazardGroup.add(saw);
    }

    private spawnTurret(
        obj: Phaser.Types.Tilemaps.TiledObject,
        cx: number, cy: number
    ) {
        const direction = this.getTiledProp<string>(obj, 'direction') ?? 'right';
        const container = this.add.container(cx, cy).setDepth(50);
        const offsets: [number, number][] = [[-4, -4], [4, -4], [-4, 4], [4, 4]];
        for (let i = 0; i < 4; i++) {
            container.add(this.add.image(offsets[i][0], offsets[i][1], 'tileSprites', TURRET_TILE_GIDS[i] - 1));
        }
        const dirAngles: Record<string, number> = { right: 0, down: 90, left: 180, up: -90 };
        container.setAngle(dirAngles[direction] ?? 0);

        const turret = new Hazard(this, cx, cy, 16, 16, true);
        turret.setAlpha(0);
        turret.tileSprite = container;
        this.hazardGroup.add(turret);
    }

    switchLevel(levelId: string) {
        this.scene.restart({ levelId });
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
