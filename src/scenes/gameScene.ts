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
import { VolumeBarScene, volumeToTintColor } from './volumeBarScene';
import {SettingsScene} from './settings';
import { getSetting } from '../systems/settingsManager';
import { LEVEL_NAMES } from '../data/levels';

// Door unlock visual frames — swapped when a locked door opens
const DOOR_UNLOCKED_GID = 376;      // door body without handle (unlocked visual)
const DOOR_UNLOCKED_TOP_GID = 356;  // top piece paired with the unlocked body

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

function makeTriggerSpikeSequence(offTime: number, onTime: number, extendTime: number): [number, number, boolean][] {
    return [
        [0, offTime,    false],
        [1, extendTime, false],
        [2, extendTime, true ],
        [3, onTime,     true ],
        [2, extendTime, true ],
        [1, extendTime, false],
    ];
}

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

    distortionAmount: number = 1.1;
    private barrelFilter: any;
    private controlsHint!: Phaser.GameObjects.Image;
    private moveLabel!: Phaser.GameObjects.Text;
    private colorMatrixFilter: any;

    private deathCt: number = 0;

    private currentLevelId: string = 'level01';
    private transitioning: boolean = false;
    private mapHeightInPixels: number = 0;
    private debugKey!: Phaser.Input.Keyboard.Key;
    private pendingTriggerSpikeStarters: (() => void)[] = [];
    private gidTypeMap: Map<number, string> = new Map();
    private gidDefaultPropsMap: Map<number, any[]> = new Map();
    private tilesetFirstgids: number[] = [];

    constructor() {
        super({ key: 'main' });
    }

    init(data: { levelId?: string }) {
        this.currentLevelId = data.levelId ?? 'level13';
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
        // Groups
        this.hazardGroup   = this.add.group();
        this.doorGroup     = this.add.group();
        this.itemGroup     = this.add.group();
        this.switchGroup   = this.add.group();
        this.platformGroup = this.add.group();
        this.bulletGroup = this.add.group();
        this.punchBoxGroup = this.add.group();
        this.boxGroup = this.add.group();

        this.escKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

        // Tilemap
        const map = this.make.tilemap({ key: this.currentLevelId });
        const tileset = map.addTilesetImage('walk-louder-tile-sheet', 'tiles');
        const platformLayer = map.createLayer('Tile Layer 1', tileset!);

        this.gidTypeMap = new Map();
        this.gidDefaultPropsMap = new Map();
        this.tilesetFirstgids = [];
        const rawJson = this.cache.tilemap.get(this.currentLevelId)?.data;
        for (const ts of rawJson?.tilesets ?? []) {
            const fg: number = ts.firstgid ?? 1;
            this.tilesetFirstgids.push(fg);
            for (const tile of ts.tiles ?? []) {
                const gid = fg + tile.id;
                if (tile.type) this.gidTypeMap.set(gid, tile.type);
                if (tile.properties?.length) this.gidDefaultPropsMap.set(gid, tile.properties);
            }
        }

        // Lock world + camera to tilemap dimensions (screen edge = level edge)
        this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
        this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
        this.cameras.main.setZoom(CAMERA_ZOOM);
        this.mapHeightInPixels = map.heightInPixels;

        Phaser.Actions.AddEffectBloom(this.cameras.main, {
            threshold: 0.3,    // only pixels brighter than this glow (pixel art smears fast at lower values)
            blurRadius: 3,     // how far the glow spreads
            blurSteps: 4,      // blur quality (higher = smoother, slower)
            blendAmount: 0.8,  // bloom strength (lower = subtler)
        });

        this.barrelFilter = this.cameras.main.filters!.external.addBarrel(1.05);
        this.barrelFilter.active = getSetting('barrelEnabled');

        this.colorMatrixFilter = this.cameras.main.filters!.external.addColorMatrix();
        this.colorMatrixFilter.colorMatrix.saturate((getSetting('saturation') - 50) / 50);

        this.cameras.main.filters!.external.addVignette(0.5, 0.5, 0.75, 0.1);

        // Apply saved scanlines state — scoped to the canvas container, not the whole page
        const canvasParent = this.game.canvas.parentElement;
        if (canvasParent) {
            canvasParent.style.position = 'relative';
            canvasParent.classList.toggle('scanlines-enabled', getSetting('scanlinesEnabled'));
        }

        this.game.events.on('setting-changed', ({ key, value }: { key: string, value: any }) => {
            if (key === 'saturation' && this.colorMatrixFilter) {
                this.colorMatrixFilter.colorMatrix.saturate((value - 50) / 50);
            }
            if (key === 'barrelEnabled' && this.barrelFilter) {
                this.barrelFilter.active = value;
            }
            if (key === 'scanlinesEnabled') {
                this.game.canvas.parentElement?.classList.toggle('scanlines-enabled', value);
            }
        });

        // Spawn player
        const spawnLayer = map.getObjectLayer('Spawn');
        const sp = spawnLayer!.objects[0];
        const spawnX = sp.x! + sp.width! / 2;
        const spawnY = (sp.gid ? sp.y! - sp.height! : sp.y!) + sp.height! / 2;
        this.player = new Player(this, spawnX, spawnY);
        this.player.setTintMode(Phaser.TintModes.FILL);
        this.player.levelStartX = spawnX;
        this.player.levelStartY = spawnY;
        this.buildControlsHint();
        this.player.Body.onWorldBounds = true;
        this.physics.world.on('worldbounds', (body: Phaser.Physics.Arcade.Body, up: boolean, down: boolean) => {
            if (body.gameObject === this.player && down) {
                this.player.death();
            }
        });

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

        const objectById = new Map<number, Phaser.Types.Tilemaps.TiledObject>();
        for (const layer of map.objects ?? []) {
            for (const obj of layer.objects) {
                if (obj.id !== undefined) objectById.set(obj.id, obj);
            }
        }

        // Spawn switches first so linkedSwitchId references resolve for everything else
        const switchById = new Map<number, Switch>();
        const doorById = new Map<number, Door>();
        // platformGroups: maps endTargetId → platforms sharing that target, for slot distribution
        const platformGroups = new Map<number, { platform: MovingPlatform; cx: number; cy: number }[]>();
        const interLayer = map.getObjectLayer('Interactables');
        if (interLayer) {
            for (const obj of interLayer.objects) {
                if (this.getObjectType(obj) === 'switch') this.spawnInteractable(obj, switchById, doorById, objectById, platformGroups);
            }
            for (const obj of interLayer.objects) {
                if (this.getObjectType(obj) !== 'switch') this.spawnInteractable(obj, switchById, doorById, objectById, platformGroups);
            }
        }

        for (const [endTargetId, entries] of platformGroups) {
            if (entries.length <= 1) continue;
            const target = objectById.get(endTargetId);
            if (!target || target.point) continue;
            const tw = target.width ?? 0;
            const th = target.height ?? 0;
            if (tw >= th) {
                // Wide rect → distribute side-by-side along X
                entries.sort((a, b) => a.cx - b.cx);
                const targetCenterY = target.y! + th / 2;
                entries.forEach(({ platform }, i) => {
                    platform.setEndPos(target.x! + platform.width / 2 + i * platform.width, targetCenterY);
                });
            } else {
                // Tall rect → stack along Y
                entries.sort((a, b) => a.cy - b.cy);
                const targetCenterX = target.x! + tw / 2;
                entries.forEach(({ platform }, i) => {
                    platform.setEndPos(targetCenterX, target.y! + platform.height / 2 + i * platform.height);
                });
            }
        }

        // Spawn hazards
        const hazardLayer = map.getObjectLayer('Hazards');
        if (hazardLayer) {
            for (const obj of hazardLayer.objects) this.spawnHazard(obj, switchById, objectById);
        }

        // Start all trigger spikes on the same frame so they stay in sync
        this.time.delayedCall(0, () => {
            for (const start of this.pendingTriggerSpikeStarters) start();
            this.pendingTriggerSpikeStarters = [];
        });

        //  Collision callbacks
        this.physics.add.collider(this.player, platformLayer!);
        this.physics.add.collider(this.player, this.platformGroup);
        this.physics.add.collider(this.player, this.boxGroup);
        this.physics.add.collider(this.boxGroup, platformLayer!);
        this.physics.add.collider(this.boxGroup, this.platformGroup);
        this.physics.add.collider(this.boxGroup, this.boxGroup);

        platformLayer!.setCollision([42]);

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

        // Switches use manual AABB detection in update() — no physics body needed,
        // which avoids rubber-banding conflicts between world bounds and static bodies.

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

    // Helpers

    // Returns true when the player's physics body is side-touching a moving platform
    // in the given direction. Used to exempt platform side-contacts from the static-wall
    // velocity-zeroing that would otherwise cause the player to stick and not slide down.
    // Returns the X velocity of the first moving platform directly beneath the
    // player, or 0 if the player is on static ground. Used for relative friction.
    private getPlatformVelocityBelow(): number {
        const pb = this.player.Body;
        for (const p of this.platformGroup.getChildren()) {
            const platBody = (p as MovingPlatform).Body;
            if (pb.right <= platBody.left || pb.left >= platBody.right) continue;
            if (Math.abs(platBody.top - pb.bottom) <= 4) return platBody.velocity.x;
        }
        return 0;
    }

    private isPressingIntoPlatform(side: 'left' | 'right'): boolean {
        const pb = this.player.Body;
        for (const p of this.platformGroup.getChildren()) {
            const platBody = (p as MovingPlatform).Body;
            // Skip if there is no vertical overlap (platform is above or below)
            if (pb.bottom <= platBody.top || pb.top >= platBody.bottom) continue;
            if (side === 'left'  && Math.abs(platBody.right - pb.left)  <= 2) return true;
            if (side === 'right' && Math.abs(platBody.left  - pb.right) <= 2) return true;
        }
        return false;
    }

    // Convert a (flip-stripped) GID to the 0-based Phaser spritesheet frame index.
    // Tiled can embed the same tileset multiple times with different firstgid offsets;
    // frame = gid - firstgid, NOT gid - 1 (which only works when firstgid === 1).
    private gidFrame(gid: number): number {
        for (let i = this.tilesetFirstgids.length - 1; i >= 0; i--) {
            if (gid >= this.tilesetFirstgids[i]) return gid - this.tilesetFirstgids[i];
        }
        return gid - 1;
    }

    private addTileSprite(
        gid: number,
        tiledX: number,
        tiledY: number,
        rotation: number = 0
    ): Phaser.GameObjects.Image {
        const img = this.add.image(tiledX, tiledY, 'tileSprites', this.gidFrame(gid));
        img.setOrigin(0, 1);
        if (rotation !== 0) {
            img.setAngle(rotation);
        }
        return img;
    }

    private getTiledProp<T = any>(
        obj: Phaser.Types.Tilemaps.TiledObject, name: string): T | undefined {
        // Object's own properties take precedence over tileset tile defaults
        const prop = obj.properties?.find((p: any) => p.name === name);
        if (prop) return prop.value;
        // Fall back to the tileset tile's default property value (Tiled 1.9+)
        if (obj.gid) {
            const gid = obj.gid & 0x1FFFFFFF;
            const tileProp = this.gidDefaultPropsMap.get(gid)?.find((p: any) => p.name === name);
            if (tileProp) return tileProp.value;
        }
        return undefined;
    }

    private getObjectType(obj: Phaser.Types.Tilemaps.TiledObject): string | undefined {
        if (obj.type) return obj.type;
        const customType = this.getTiledProp<string>(obj, 'type');
        if (customType) return customType;
        if (obj.gid) {
            // Strip Tiled flip flags (high 3 bits) before lookup
            return this.gidTypeMap.get(obj.gid & 0x1FFFFFFF);
        }
        return undefined;
    }

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
        doorById: Map<number, Door>,
        objectById: Map<number, Phaser.Types.Tilemaps.TiledObject>,
        platformGroups: Map<number, { platform: MovingPlatform; cx: number; cy: number }[]>
    ) {
        const type = this.getObjectType(obj);
        const { cx, cy, w, h } = this.objectGeometry(obj);
        // Platforms get their own sprite creation (center origin) — see 'platform' case below
        const sprite = (obj.gid && type !== 'platform') ? this.addTileSprite(obj.gid, obj.x!, obj.y!) : null;

        switch (type) {
            case 'door': {
                const targetLevel = this.getTiledProp<string>(obj, 'targetLevel') ?? '';
                const locked = this.getTiledProp<boolean>(obj, 'locked') ?? false;
                const keyType = locked ? (this.getTiledProp<string>(obj, 'keyType') ?? 'default') : null;
                const door = new Door(this, cx, cy, w, h, locked, keyType, targetLevel);
                door.setAlpha(0);
                door.tileSprite = sprite;
                this.doorGroup.add(door);
                doorById.set(obj.id!, door);
                break;
            }
            case 'door_top': {
                // Decorative top piece — linked by linkedDoorId so the top sprite can
                // be swapped when the door unlocks at runtime.
                const linkedDoorId = this.getTiledProp<number>(obj, 'linkedDoorId');
                const door = linkedDoorId !== undefined ? doorById.get(linkedDoorId) : undefined;
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
                    sw.baseFrame = this.gidFrame(obj.gid!);
                    // Tile pairs are (off, on) spaced 2 apart. If the placed tile is
                    // the "on" variant (gid%4==2), the active offset goes backward.
                    if ((obj.gid! % 4) === 2) sw.activeFrameOffset = -2;
                }
                this.switchGroup.add(sw);
                switchById.set(obj.id!, sw);
                break;
            }
            case 'platform': {
                const endTargetId = this.getTiledProp<number>(obj, 'endTarget') || undefined;
                let endX = cx, endY = cy;
                if (endTargetId) {
                    const target = objectById.get(endTargetId);
                    if (target) {
                        endX = target.x! + (target.width ?? 0) / 2;
                        endY = target.point ? target.y! : target.y! + (target.height ?? 0) / 2;
                    }
                }
                const speed = this.getTiledProp<number>(obj, 'speed') ?? 50;
                const mode  = (this.getTiledProp<string>(obj, 'mode') ?? 'auto') as 'auto' | 'driven';
                const swId  = this.getTiledProp<number>(obj, 'linkedSwitchId') || undefined;
                const sw    = swId ? switchById.get(swId) : undefined;
                const moves = endX !== cx || endY !== cy;
                const platform = new MovingPlatform(
                    this, cx, cy, w, h,
                    moves ? { x: endX, y: endY } : undefined,
                    moves ? speed : undefined,
                    sw ? 'driven' : mode
                );
                platform.setAlpha(0);
                // Center-origin sprite so setPosition(this.x, this.y) in update() aligns
                // the visual exactly with the physics body — no offset arithmetic needed.
                if (obj.gid) {
                    const img = this.add.image(cx, cy, 'tileSprites', this.gidFrame(obj.gid & 0x1FFFFFFF));
                    img.setOrigin(0.5, 0.5);
                    platform.tileSprite = img;
                }
                if (sw) platform.linkSwitch(sw);
                this.platformGroup.add(platform);
                // Register in group map so the distribution pass can assign slots later
                if (endTargetId) {
                    if (!platformGroups.has(endTargetId)) platformGroups.set(endTargetId, []);
                    platformGroups.get(endTargetId)!.push({ platform, cx, cy });
                }
                break;
            }
            case 'box': {
                const friction = this.getTiledProp<number>(obj, 'friction') ?? 0.6;
                const mass     = this.getTiledProp<number>(obj, 'mass') ?? 1;
                const swId     = this.getTiledProp<number>(obj, 'linkedSwitchId') || undefined;
                const sw       = swId ? switchById.get(swId) : undefined;
                const box = new Box(this, cx, cy, w, h, friction * 500, mass);
                box.setAlpha(0);
                box.tileSprite = sprite;
                if (sw) box.linkSwitch(sw);
                this.boxGroup.add(box);
                break;
            }
        }
    }

    private spawnHazard(
        obj: Phaser.Types.Tilemaps.TiledObject,
        switchById: Map<number, Switch>,
        objectById: Map<number, Phaser.Types.Tilemaps.TiledObject>
    ) {
        const type = this.getObjectType(obj);
        const { cx, cy, w, h, rot } = this.objectGeometry(obj);

        // Treat linkedSwitchId=0 as "not linked" (0 is the tile-default sentinel for "none")
        const prop = <T>(name: string) => this.getTiledProp<T>(obj, name);
        const linkedSwitch = (id: number | undefined): Switch | undefined =>
            id ? switchById.get(id) : undefined;

        switch (type) {
            case 'spike': {
                const spikeSwitchId = prop<number>('linkedSwitchId');
                const sw = linkedSwitch(spikeSwitchId);
                if (!obj.gid && sw) {
                    // Invisible rectangle spike driven by a switch
                    const startEnabled = prop<boolean>('startEnabled') ?? true;
                    this.spawnSwitchDrivenSpike(cx, cy, w, h, sw, startEnabled);
                    break;
                }
                if (obj.gid) this.addTileSprite(obj.gid, obj.x!, obj.y!, rot);
                const spike = new Hazard(this, cx, cy, w, h, true);
                spike.setAlpha(0);
                if (obj.gid) (spike.body as Phaser.Physics.Arcade.StaticBody).setSize(6, h * 0.75);
                if (sw) {
                    const startEnabled = prop<boolean>('startEnabled') ?? true;
                    spike.linkSwitch(sw, startEnabled);
                    spike.setEnabled(startEnabled);
                }
                this.hazardGroup.add(spike);
                break;
            }
            case 'trigger_spike': {
                const spikeSwitchId = prop<number>('linkedSwitchId');
                const sw = linkedSwitch(spikeSwitchId);
                if (sw) {
                    const startEnabled = prop<boolean>('startEnabled') ?? true;
                    this.spawnSwitchDrivenSpike(cx, cy, w, h, sw, startEnabled);
                } else {
                    this.spawnTriggerSpike(
                        cx, cy, w, h,
                        prop<number>('offTime')     ?? 1000,
                        prop<number>('onTime')      ?? 500,
                        prop<number>('extendTime')  ?? 80
                    );
                }
                break;
            }
            case 'saw':
                this.spawnSaw(obj, cx, cy, switchById, objectById);
                break;
            case 'turret':
                this.spawnTurret(obj, cx, cy);
                break;
            case 'punch_box': {
                // Direction is authored purely via the tile's H-flip in Tiled:
                // flipped → punch left, unflipped → punch right. The fist's facing,
                // arm-extension direction, and shove force all derive from this.
                const flipped = !!(obj as any).flippedHorizontal;
                const faceDir = flipped ? -1 : 1;
                const forceMag = Math.abs(prop<number>('forceX') ?? -200);
                const forceX = faceDir * forceMag;
                const forceY = prop<number>('forceY') ?? 0;
                const swId   = prop<number>('linkedSwitchId');
                const sw     = linkedSwitch(swId);
                const startEnabled = prop<boolean>('startEnabled') ?? true;
                const fistFrame = obj.gid ? this.gidFrame(obj.gid & 0x1FFFFFFF) : 0;
                const pb = new PunchBox(this, cx, cy, w, h, fistFrame, flipped, forceX, forceY, startEnabled);
                if (sw) pb.linkSwitch(sw);
                this.punchBoxGroup.add(pb);
                break;
            }
        }
    }

    private spawnTriggerSpike(cx: number, cy: number, w: number, h: number, offTime = 1000, onTime = 500, extendTime = 80) {
        const tileCount = Math.max(1, Math.round(w / 8));
        const container = this.add.container(cx, cy).setDepth(50);
        const tiles: Phaser.GameObjects.Image[] = [];
        for (let i = 0; i < tileCount; i++) {
            const t = this.add.image((i - (tileCount - 1) / 2) * 8, 0, 'tileSprites', TRIGGER_SPIKE_FRAMES[0] - 1);
            container.add(t);
            tiles.push(t);
        }

        const hazard = new Hazard(this, cx, cy, w, h, true);
        hazard.setAlpha(0);
        hazard.tileSprite = container;
        // Start safe — body disabled until first dangerous frame
        (hazard.body as any).enable = false;

        const seq = makeTriggerSpikeSequence(offTime, onTime, extendTime);
        let step = 0;
        const tick = () => {
            const [frameIdx, dwell, dangerous] = seq[step];
            tiles.forEach(t => t.setFrame(TRIGGER_SPIKE_FRAMES[frameIdx] - 1));
            (hazard.body as any).enable = dangerous;
            step = (step + 1) % seq.length;
            this.time.delayedCall(dwell, tick);
        };
        // Don't start immediately — defer to pendingTriggerSpikeStarters so all
        // trigger spikes in the level start on the exact same frame and stay in sync.
        this.pendingTriggerSpikeStarters.push(tick);

        this.hazardGroup.add(hazard);
    }

    private spawnSwitchDrivenSpike(
        cx: number, cy: number, w: number, h: number,
        sw: Switch, startEnabled: boolean
    ) {
        const tileCount = Math.max(1, Math.round(w / 8));
        const container = this.add.container(cx, cy).setDepth(50);
        const tiles: Phaser.GameObjects.Image[] = [];
        for (let i = 0; i < tileCount; i++) {
            const img = this.add.image(
                (i - (tileCount - 1) / 2) * 8, 0,
                'tileSprites', TRIGGER_SPIKE_FRAMES[startEnabled ? 3 : 0] - 1
            );
            container.add(img);
            tiles.push(img);
        }

        const hazard = new Hazard(this, cx, cy, w, h, true);
        hazard.setAlpha(0);
        (hazard.body as any).enable = startEnabled;

        const setFrame = (fi: number) => tiles.forEach(t => t.setFrame(TRIGGER_SPIKE_FRAMES[fi] - 1));

        const runSeq = (seq: [number, number][], dangerousFromStep: number) => {
            let step = 0;
            const tick = () => {
                const [fi, dwell] = seq[step];
                setFrame(fi);
                (hazard.body as any).enable = step >= dangerousFromStep;
                if (++step < seq.length && dwell > 0) this.time.delayedCall(dwell, tick);
            };
            tick();
        };

        let prevPowered = sw.powered;
        this.events.on('update', () => {
            if (sw.powered === prevPowered) return;
            prevPowered = sw.powered;
            const nowEnabled = sw.powered !== startEnabled;
            if (nowEnabled) {
                runSeq([[1, 80], [2, 80], [3, 0]], 1);
            } else {
                (hazard.body as any).enable = false;
                runSeq([[2, 80], [1, 80], [0, 0]], 99);
            }
        });

        this.hazardGroup.add(hazard);
    }

    private spawnSaw(
        obj: Phaser.Types.Tilemaps.TiledObject,
        cx: number, cy: number,
        switchById: Map<number, Switch>,
        objectById: Map<number, Phaser.Types.Tilemaps.TiledObject>
    ) {
        const endTargetId = this.getTiledProp<number>(obj, 'endTarget');
        let endX: number | undefined;
        let endY: number | undefined;
        if (endTargetId !== undefined) {
            const target = objectById.get(endTargetId);
            if (target) {
                // endTarget is placed at the bottom-left corner of the destination tile cell;
                // subtract half a tile height to get the saw's center-to-center travel target.
                endX = target.x! + (target.width ?? 0) / 2;
                endY = target.y! - 4;
            }
        }
        endX ??= this.getTiledProp<number>(obj, 'endX') ?? cx;
        endY ??= this.getTiledProp<number>(obj, 'endY') ?? cy;
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
            delay: 100,
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
        // The flip/rotation flags baked into the tile in Tiled ARE the orientation data.
        // Phaser strips them out of obj.gid before we see it and exposes them as booleans.
        const H = !!obj.flippedHorizontal;
        const V = !!obj.flippedVertical;
        const D = !!obj.flippedAntiDiagonal;

        // Standard Tiled → Phaser transform conversion:
        //   D=0  H=0  V=0  →  no transform
        //   D=0  H=1  V=0  →  H-flip  (scaleX = -1)
        //   D=0  H=0  V=1  →  V-flip  (scaleY = -1)
        //   D=0  H=1  V=1  →  180°
        //   D=1  H=1  V=0  →  90° CW
        //   D=1  H=0  V=1  →  90° CCW
        //   D=1  H=0  V=0  →  anti-diagonal (90° CW + V-flip)
        //   D=1  H=1  V=1  →  90° CCW + H-flip
        let angle = 0, scaleX = 1, scaleY = 1;
        if (D) {
            if      ( H && !V) { angle =  90; }
            else if (!H &&  V) { angle = -90; }
            else if (!H && !V) { angle =  90; scaleY = -1; }
            else               { angle = -90; scaleX = -1; }
        } else {
            if      (H && V)   { angle = 180; }
            else if (H)        { scaleX = -1; }
            else if (V)        { scaleY = -1; }
        }

        // Bullet direction: H-flip means fire left, no H-flip means fire right.
        // (Extend with D-flip cases if up/down turrets are ever needed.)
        const direction: 'left' | 'right' = H ? 'left' : 'right';

        const fireInterval = this.getTiledProp<number>(obj, 'fireInterval') ?? 1000;

        // The placed anchor tile is always the BODY of the turret.
        // The barrel expands away from it in the firing direction.
        //
        //   Right-facing (H=false): body is the bottom-LEFT tile of the 2×2
        //     → container centre is 4 px right and 4 px up from the anchor
        //   Left-facing  (H=true) : body is the bottom-RIGHT tile of the 2×2
        //     → container centre is 4 px LEFT and 4 px up from the anchor
        //
        // The scaleX = -1 applied to the container then mirrors all four tile
        // images in-place, so GID 56 (body) visually ends up at the anchor world
        // position in both cases.
        const ocx = H ? -4 : 4;
        const ocy = -4;  // top row is always one tile above the body row

        const container = this.add.container(cx + ocx, cy + ocy).setDepth(50);
        const offsets: [number, number][] = [[-4, -4], [4, -4], [-4, 4], [4, 4]];
        for (let i = 0; i < 4; i++) {
            container.add(this.add.image(offsets[i][0], offsets[i][1], 'tileSprites', TURRET_TILE_GIDS[i] - 1));
        }
        // Apply the Tiled flip/rotation to the container
        container.setAngle(angle).setScale(scaleX, scaleY);

        // Hitbox covers only the anchor tile (8×8) — not the full 2×2 block.
        const turret = new Hazard(this, cx, cy, 8, 8, true);
        turret.setAlpha(0);
        turret.tileSprite = container;
        turret.direction = direction as 'left' | 'right';
        this.hazardGroup.add(turret);

        this.time.addEvent({
            delay: fireInterval,
            loop: true,
            callback: () => turret.shoot(),
        });
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

        // During a knockback window, an external force (e.g. punch box) owns horizontal
        // velocity — skip input so it isn't instantly overwritten. Friction (the else
        // branch) still runs, bleeding the impulse off to a natural stop.
        const inKnockback = this.player.inKnockback;
        if (!inKnockback && this.cursors.left.isDown) {
            if (this.player.Body.blocked.left && !this.isPressingIntoPlatform('left')) {
                this.player.Body.setVelocityX(0);
            } else {
                this.player.moveLeft(vol);
            }
        } else if (!inKnockback && this.cursors.right.isDown) {
            if (this.player.Body.blocked.right && !this.isPressingIntoPlatform('right')) {
                this.player.Body.setVelocityX(0);
            } else {
                this.player.moveRight(vol);
            }
        } else {
            if (this.player.grounded) {
                // Decelerate relative to whatever surface is below. On a moving
                // platform, Phaser's SeparateY friction already sets player.vx =
                // platform.vx each frame. Applying a flat 0.82 multiplier then
                // fights that, causing rubber-banding. By decelerating the excess
                // velocity (player.vx - platform.vx), riders stay locked to the
                // platform while still bleeding off any extra input-driven speed.
                const platVx = this.getPlatformVelocityBelow();
                const relVx  = this.player.Body.velocity.x - platVx;
                this.player.Body.setVelocityX(platVx + relVx * 0.82);
            } else {
                this.player.setSpeedMultiplier(0.97);
            }
        }

        if (this.player.grounded && performance.now() - this.player.jumpTime > 100) {
            this.player.lastGroundedTime = performance.now();
        }

        if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
            this.player.lastJumpInputTime = performance.now();
        }

        if (performance.now() - this.player.lastJumpInputTime <= this.player.JumpBufferTime) {
            this.player.jump(jumpVol);
        }

        this.player.applyVocalBoost(jumpVol);

        const boostActive = performance.now() - this.player.jumpTime < this.player.jumpBoostWindow;
        if (this.cursors.up.isUp && this.player.Body.velocity.y < 0 && !boostActive) {
            this.player.Body.setVelocityY(this.player.Body.velocity.y * 0.85);
        }

        // Player animation
        const isGrounded = this.player.grounded;
        const vy = this.player.Body.velocity.y;
        const vx = Math.abs(this.player.Body.velocity.x);
        // Grace window: keep airborne animation for 100ms after a jump fires so that
        // a single grounded frame while spam-jumping doesn't flash the idle pose.
        const justJumped = performance.now() - this.player.jumpTime < 100;
        if (!isGrounded || justJumped) {
            this.player.anims.timeScale = 1;
            if (vy < 0 || justJumped) {
                this.player.play('player_jump', true);
            } else {
                this.player.play('player_fall', true);
            }
        } else if (vx > 5) {
            this.player.play('player_walk', true);
            this.player.anims.timeScale = (10 + vol * 18) / 10;
        } else {
            this.player.stop();
            this.player.setFrame(0);
        }
        this.player.setFlipX(this.player.facing === 'left');

        const barScene = this.scene.get('volumeBar') as VolumeBarScene | undefined;
        const tintVol = barScene?.displayedVol ?? 0;
        this.player.setTint(volumeToTintColor(tintVol));

        this.switchGroup.getChildren().forEach((s: Phaser.GameObjects.GameObject) => {
            const sw = s as Switch;
            const hw = sw.width / 2, hh = sw.height / 2;
            const pb = this.player.Body;
            if (pb.x < sw.x + hw && pb.x + pb.width > sw.x - hw &&
                pb.y < sw.y + hh && pb.y + pb.height > sw.y - hh) {
                sw.onOverlap();
            }
            for (const b of this.boxGroup.getChildren()) {
                const bb = (b as Box).Body;
                if (!b.active) continue;
                if (bb.x < sw.x + hw && bb.x + bb.width > sw.x - hw &&
                    bb.y < sw.y + hh && bb.y + bb.height > sw.y - hh) {
                    sw.onOverlap();
                }
            }
            sw.tick();
        });
        this.hazardGroup.getChildren().forEach((h: Phaser.GameObjects.GameObject) => (h as Hazard).update());
        this.platformGroup.getChildren().forEach((p: Phaser.GameObjects.GameObject) => (p as MovingPlatform).update(delta));
        this.boxGroup.getChildren().forEach((b: Phaser.GameObjects.GameObject) => (b as Box).update());
        this.punchBoxGroup.getChildren().forEach((go: Phaser.GameObjects.GameObject) => {
            const box = go as PunchBox;
            box.update();
            if (!box.isPunching) return;
            // Manual AABB — same pattern as switches. The extended span is 3 tiles
            // (arm1 + arm2 + fist) reaching out in box.extendDir, centred 1 tile out.
            // Vertical tolerance is generous (24px) so alignment needn't be pixel-perfect.
            const hzCx = box.x + box.extendDir * 8; // centre of the 3-tile extended span
            const pb   = this.player.Body;
            if (pb.x < hzCx + 12 && pb.x + pb.width > hzCx - 12 &&
                pb.y < box.y + 24 && pb.y + pb.height > box.y - 24) {
                box.applyImpulse(this.player);
            }
        });
    }
}
