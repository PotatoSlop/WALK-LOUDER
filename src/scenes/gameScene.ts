import Phaser from 'phaser';
import { Player } from '../objects/player';
import { micInput } from '../systems/MicInput';
import { Door } from '../objects/door';
import { Hazard } from '../objects/hazards';
import { Key } from '../objects/key';
import { MovingPlatform } from '../objects/movingPlatform';
import { Switch } from '../objects/switches';
import { VolumeBarScene, volumeToTintColor } from './volumeBarScene';
import {SettingsScene} from './settings';
import { getSetting } from '../systems/settingsManager';

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

// Trigger spike sequence — [frameIndex, dwellMs, isDangerous]
const TRIGGER_SPIKE_SEQUENCE: [number, number, boolean][] = [
    [0, 1000, false],  // retracted — safe
    [1,  80, false ],  // extending
    [2,  80, true ],  // extending
    [3, 500, true ],  // fully extended
    [2,  80, true ],  // retracting
    [1,  80, false ],  // retracting
];

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
    mic: any;
    escKey: any;

    distortionAmount: number = 1.05;
    private barrelFilter: any;
    private colorMatrixFilter: any;

    private currentLevelId: string = 'level01';
    private transitioning: boolean = false;
    private mapHeightInPixels: number = 0;
    private debugKey!: Phaser.Input.Keyboard.Key;

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

        this.escKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

        // Tilemap
        const map = this.make.tilemap({ key: this.currentLevelId });
        const tileset = map.addTilesetImage('walk-louder-tile-sheet', 'tiles');
        const platformLayer = map.createLayer('Tile Layer 1', tileset!);
        platformLayer!.setCollision([42]);

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

        // Apply saved scanlines state
        document.body.classList.toggle('scanlines-enabled', getSetting('scanlinesEnabled'));

        this.game.events.on('setting-changed', ({ key, value }: { key: string, value: any }) => {
            if (key === 'saturation' && this.colorMatrixFilter) {
                this.colorMatrixFilter.colorMatrix.saturate((value - 50) / 50);
            }
            if (key === 'barrelEnabled' && this.barrelFilter) {
                this.barrelFilter.active = value;
            }
            if (key === 'scanlinesEnabled') {
                document.body.classList.toggle('scanlines-enabled', value);
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
        this.player.Body.onWorldBounds = true;
        this.physics.world.on('worldbounds', (body: Phaser.Physics.Arcade.Body, up: boolean, down: boolean) => {
            if (body.gameObject === this.player && down) {
                this.player.death();
            }
        });

        this.events.on('playerDeath', () => {
            if (this.transitioning) return;
            this.transitioning = true;

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

        // Spawn interactables first
        const switchById = new Map<number, Switch>();
        const doorByX = new Map<number, Door>();
        const interLayer = map.getObjectLayer('Interactables');
        if (interLayer) {
            for (const obj of interLayer.objects) this.spawnInteractable(obj, switchById, doorByX);
        }

        // ── Spawn all hazards from the Tiled Hazards layer
        const hazardLayer = map.getObjectLayer('Hazards');
        if (hazardLayer) {
            for (const obj of hazardLayer.objects) this.spawnHazard(obj, switchById, objectById);
        }

        //  Collision callbacks
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

        for (const s of this.switchGroup.getChildren()) {
            this.physics.add.overlap(this.player, s, (_p, sw) => (sw as Switch).onOverlap());
        }

        this.physics.add.collider(this.bulletGroup, platformLayer! || this.player, bullet => bullet.destroy());
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

        if (this.scene.isActive('ui')) this.scene.stop('ui');
        this.scene.launch('ui');

        // Emit after a 1-frame delay so UIScene.create() has run and listeners are set up
        this.time.delayedCall(0, () => {
            this.game.events.emit('level-changed', this.currentLevelId.slice(-2));
            if (this.currentLevelId === 'level01') {
                this.game.events.emit('show-hint', 'arrow-keys');
            }
        });

        this.scene.resume();
    }

    // Helpers 
    private addTileSprite(
        gid: number,
        tiledX: number,
        tiledY: number,
        rotation: number = 0
    ): Phaser.GameObjects.Image {
        const img = this.add.image(tiledX, tiledY, 'tileSprites', gid - 1);
        img.setOrigin(0, 1);
        if (rotation !== 0) {
            img.setAngle(rotation);
        }
        return img;
    }

    private getTiledProp<T = any>(
        obj: Phaser.Types.Tilemaps.TiledObject, name: string): T | undefined {
        const prop = obj.properties?.find((p: any) => p.name === name);
        return prop?.value;
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
        doorByX: Map<number, Door>
    ) {
        const type = this.getTiledProp<string>(obj, 'type') ?? obj.type;
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
        switchById: Map<number, Switch>,
        objectById: Map<number, Phaser.Types.Tilemaps.TiledObject>
    ) {
        const type = this.getTiledProp<string>(obj, 'type') ?? obj.type;
        const { cx, cy, w, h, rot } = this.objectGeometry(obj);

        switch (type) {
            case 'spike': {
                const spikeSwitchId = this.getTiledProp<number>(obj, 'linkedSwitchId');
                if (!obj.gid && spikeSwitchId !== undefined) {
                    // No tile sprite + switch linked → animated trigger-spike driven by lever
                    const sw = switchById.get(spikeSwitchId);
                    if (sw) {
                        const startEnabled = this.getTiledProp<boolean>(obj, 'enabled') ?? true;
                        this.spawnSwitchDrivenSpike(cx, cy, w, h, sw, startEnabled);
                    }
                    break;
                }
                if (obj.gid) this.addTileSprite(obj.gid, obj.x!, obj.y!, rot);
                const spike = new Hazard(this, cx, cy, w, h, true);
                spike.setAlpha(0);
                // Hitbox shrink only for tile-based spikes — triangle texture, not a full tile.
                if (obj.gid) (spike.body as Phaser.Physics.Arcade.StaticBody).setSize(6, h * 0.75);
                if (spikeSwitchId !== undefined) {
                    const sw = switchById.get(spikeSwitchId);
                    if (sw) {
                        const startEnabled = this.getTiledProp<boolean>(obj, 'enabled') ?? true;
                        spike.linkSwitch(sw, startEnabled);
                        spike.setEnabled(startEnabled);
                    }
                }
                this.hazardGroup.add(spike);
                break;
            }
            case 'trigger_spike': {
                const spikeSwitchId = this.getTiledProp<number>(obj, 'linkedSwitchId');
                if (spikeSwitchId !== undefined) {
                    const sw = switchById.get(spikeSwitchId);
                    if (sw) {
                        const startEnabled = this.getTiledProp<boolean>(obj, 'enabled') ?? true;
                        this.spawnSwitchDrivenSpike(cx, cy, w, h, sw, startEnabled);
                    }
                } else {
                    this.spawnTriggerSpike(cx, cy, w, h, this.getTiledProp<number>(obj, 'offTime'));
                }
                break;
            }
            case 'saw':
                this.spawnSaw(obj, cx, cy, switchById, objectById);
                break;
            case 'turret':
                this.spawnTurret(obj, cx, cy);
                break;
        }
    }

    private spawnTriggerSpike(cx: number, cy: number, w: number, h: number, offTime?: number) {
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

        let step = 0;
        const tick = () => {
            const [frameIdx, baseDwell, dangerous] = TRIGGER_SPIKE_SEQUENCE[step];
            const dwell = (step === 0 && offTime !== undefined) ? offTime : baseDwell;
            tiles.forEach(t => t.setFrame(TRIGGER_SPIKE_FRAMES[frameIdx] - 1));
            (hazard.body as any).enable = dangerous;
            step = (step + 1) % TRIGGER_SPIKE_SEQUENCE.length;
            this.time.delayedCall(dwell, tick);
        };
        tick();

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
        turret.direction = direction as 'left' | 'right';
        this.hazardGroup.add(turret);
        

        this.time.addEvent({
            delay: 1000,
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

        if (this.cursors.left.isDown) {
            this.player.moveLeft(vol);
        } else if (this.cursors.right.isDown) {
            this.player.moveRight(vol);
        } else {
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

        // Player animation 
        const isGrounded = this.player.Body.blocked.down;
        const vy = this.player.Body.velocity.y;
        const vx = Math.abs(this.player.Body.velocity.x);
        if (!isGrounded) {
            this.player.anims.timeScale = 1;
            if (vy < 0) {
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

        this.switchGroup.getChildren().forEach((s: Phaser.GameObjects.GameObject) => (s as Switch).tick());
        this.hazardGroup.getChildren().forEach((h: Phaser.GameObjects.GameObject) => (h as Hazard).update());
        this.platformGroup.getChildren().forEach((p: Phaser.GameObjects.GameObject) => (p as MovingPlatform).update(delta));
    }
}
