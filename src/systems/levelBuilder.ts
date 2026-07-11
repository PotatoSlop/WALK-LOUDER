import Phaser from 'phaser';
import { Player } from '../objects/player';
import { TiledContext } from './tiled';
import { Door } from '../objects/door';
import { Hazard } from '../objects/hazards';
import { Key } from '../objects/key';
import { MovingPlatform } from '../objects/movingPlatform';
import { Switch } from '../objects/switches';
import { PunchBox } from '../objects/punchBox';
import { Box } from '../objects/box';

//#region CONSTANTS

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
//#endregion

export interface BuiltLevel {
    player: Player;
    groups: {
        platform: Phaser.GameObjects.Group, 
        hazard: Phaser.GameObjects.Group, 
        door: Phaser.GameObjects.Group, 
        item: Phaser.GameObjects.Group, 
        switch: Phaser.GameObjects.Group, 
        box: Phaser.GameObjects.Group, 
        punchBox: Phaser.GameObjects.Group, 
        bullet: Phaser.GameObjects.Group
    };
}

export class LevelBuilder {
    private scene: Phaser.Scene;
    private map: Phaser.Tilemaps.Tilemap;
    private tiled: TiledContext;

    private platform!: Phaser.GameObjects.Group;
    private hazard!: Phaser.GameObjects.Group; 
    private door!: Phaser.GameObjects.Group;
    private item!: Phaser.GameObjects.Group; 
    private switch!: Phaser.GameObjects.Group; 
    private box!: Phaser.GameObjects.Group;
    private punchBox!: Phaser.GameObjects.Group; 
    private bullet!: Phaser.GameObjects.Group;

    private objectById = new Map<number, Phaser.Types.Tilemaps.TiledObject>();
    private switchById =  new Map<number, Switch>();
    private doorById = new Map<number, Door>();
    private platformGroups = new Map<number, {platform: MovingPlatform; cx: number; cy: number}[]>();
    private pendingTriggerSpikeStarters: (() => void)[] = [];
    
    

    constructor(scene: Phaser.Scene, map: Phaser.Tilemaps.Tilemap, tiled: TiledContext) {
        this.scene = scene;
        this.map = map;
        this.tiled = tiled;
    }

    build(): BuiltLevel {
        this.createGroups();
        this.indexObjects();

        this.spawnInteractableLayer();
        this.distributePlatforms();
        this.spawnHazards();
        this.syncTriggerSpikes();

        const player = this.spawnPlayer();

        return {
            player,
            groups: {
                platform: this.platform,
                hazard: this.hazard, 
                door: this.door, 
                item: this.item, 
                switch: this.switch, 
                box: this.box, 
                punchBox: this.punchBox, 
                bullet: this.bullet
            },
        };
    }

    private createGroups() {
        this.hazard = this.scene.add.group();
        this.door = this.scene.add.group();
        this.item = this.scene.add.group();
        this.switch = this.scene.add.group();
        this.platform =this.scene.add.group();
        this.bullet = this.scene.add.group();
        this.punchBox = this.scene.add.group();
        this.box = this.scene.add.group();
    }

    private getObjectLayer(name: string): Phaser.Tilemaps.ObjectLayer | null {
        return this.map.getObjectLayer(name);
    }


    private indexObjects() {
        for (const layer of this.map.objects ?? []) {
            for (const obj of layer.objects) {
                if (obj.id !== undefined) this.objectById.set(obj.id, obj);
            }
        }
    }

    private spawnInteractableLayer() {
        const interLayer = this.getObjectLayer('Interactables');
         if (interLayer) {
            for (const obj of interLayer.objects) {
                if (this.tiled.getObjectType(obj) === 'switch') this.createInteractable(obj);
            }
            for (const obj of interLayer.objects) {
                if (this.tiled.getObjectType(obj) !== 'switch') this.createInteractable(obj);
            }
        }
    }

    private createInteractable(obj: Phaser.Types.Tilemaps.TiledObject) {
            const type = this.tiled.getObjectType(obj);
            const { cx, cy, w, h } = this.tiled.objectGeometry(obj);
            // Platforms get their own sprite creation (center origin) — see 'platform' case below
            const sprite = (obj.gid && type !== 'platform') ? this.tiled.addTileSprite(obj.gid, obj.x!, obj.y!) : null;
    
            switch (type) {
                case 'door': {
                    const targetLevel = this.tiled.getTiledProp<string>(obj, 'targetLevel') ?? '';
                    const locked = this.tiled.getTiledProp<boolean>(obj, 'locked') ?? false;
                    const keyType = locked ? (this.tiled.getTiledProp<string>(obj, 'keyType') ?? 'default') : null;
                    const door = new Door(this.scene, cx, cy, w, h, locked, keyType, targetLevel);
                    door.setAlpha(0);
                    door.tileSprite = sprite;
                    this.door.add(door);
                    this.doorById.set(obj.id!, door);
                    break;
                }
                case 'door_top': {
                    // Decorative top piece — linked by linkedDoorId so the top sprite can be swapped when the door unlocks at runtime.
                    const linkedDoorId = this.tiled.getTiledProp<number>(obj, 'linkedDoorId');
                    const door = linkedDoorId !== undefined ? this.doorById.get(linkedDoorId) : undefined;
                    if (door) door.topSprite = sprite;
                    break;
                }
                case 'key': {
                    const keyType = this.tiled.getTiledProp<string>(obj, 'keyType') ?? 'default';
                    const k = new Key(this.scene, cx, cy, w, h, keyType);
                    k.setAlpha(0);
                    k.tileSprite = sprite;
                    this.item.add(k);
                    break;
                }
                case 'switch': {
                    const switchType = (this.tiled.getTiledProp<string>(obj, 'switchType') ?? 'button') as 'button' | 'lever' | 'oneshot';
                    const sw = new Switch(this.scene, cx, cy, w, h, switchType);
                    sw.setAlpha(0);
                    if (sprite) {
                        sw.tileSprite = sprite;
                        sw.baseFrame = this.tiled.gidFrame(obj.gid!);
                        // Tile pairs are (off, on) spaced 2 apart. If the placed tile is the "on" variant (gid%4==2), the active offset goes backward.
                        if ((obj.gid! % 4) === 2) sw.activeFrameOffset = -2;
                    }
                    this.switch.add(sw);
                    this.switchById.set(obj.id!, sw);
                    break;
                }
                case 'platform': {
                    const endTargetId = this.tiled.getTiledProp<number>(obj, 'endTarget') || undefined;
                    let endX = cx, endY = cy;
                    if (endTargetId) {
                        const target = this.objectById.get(endTargetId);
                        if (target) {
                            endX = target.x! + (target.width ?? 0) / 2;
                            endY = target.point ? target.y! : target.y! + (target.height ?? 0) / 2;
                        }
                    }
                    const speed = this.tiled.getTiledProp<number>(obj, 'speed') ?? 50;
                    const mode  = (this.tiled.getTiledProp<string>(obj, 'mode') ?? 'auto') as 'auto' | 'driven';
                    const swId  = this.tiled.getTiledProp<number>(obj, 'linkedSwitchId') || undefined;
                    const sw    = swId ? this.switchById.get(swId) : undefined;
                    const moves = endX !== cx || endY !== cy;
                    const platform = new MovingPlatform(
                        this.scene, cx, cy, w, h,
                        moves ? { x: endX, y: endY } : undefined,
                        moves ? speed : undefined,
                        sw ? 'driven' : mode
                    );
                    platform.setAlpha(0);
                    // Center-origin sprite so setPosition(this.x, this.y) in update() aligns the visual exactly with the physics body
                    if (obj.gid) {
                        const img = this.scene.add.image(cx, cy, 'tileSprites', this.tiled.gidFrame(obj.gid & 0x1FFFFFFF));
                        img.setOrigin(0.5, 0.5);
                        platform.tileSprite = img;
                    }
                    if (sw) platform.linkSwitch(sw);
                    this.platform.add(platform);
                    // Register in group map so the distribution pass can assign slots later
                    if (endTargetId) {
                        if (!this.platformGroups.has(endTargetId)) this.platformGroups.set(endTargetId, []);
                        this.platformGroups.get(endTargetId)!.push({ platform, cx, cy });
                    }
                    break;
                }
                case 'box': {
                    const friction = this.tiled.getTiledProp<number>(obj, 'friction') ?? 0.6;
                    const mass     = this.tiled.getTiledProp<number>(obj, 'mass') ?? 1;
                    const swId     = this.tiled.getTiledProp<number>(obj, 'linkedSwitchId') || undefined;
                    const sw       = swId ? this.switchById.get(swId) : undefined;
                    const box = new Box(this.scene, cx, cy, w, h, friction * 500, mass);
                    box.setAlpha(0);
                    box.tileSprite = sprite;
                    if (sw) box.linkSwitch(sw);
                    this.box.add(box);
                    break;
                }
            }
        }

    private spawnHazards() {
        const hazardLayer = this.getObjectLayer('Hazards');
        if (!hazardLayer) return;
        for (const obj of hazardLayer.objects) this.spawnHazard(obj);
    }

    private spawnHazard(obj: Phaser.Types.Tilemaps.TiledObject) {
            const type = this.tiled.getObjectType(obj);
            const { cx, cy, w, h, rot } = this.tiled.objectGeometry(obj);

            // Treat linkedSwitchId=0 as "not linked" (0 is the tile-default sentinel for "none")
            const prop = <T>(name: string) => this.tiled.getTiledProp<T>(obj, name);
            const linkedSwitch = (id: number | undefined): Switch | undefined =>
                id ? this.switchById.get(id) : undefined;

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
                    if (obj.gid) this.tiled.addTileSprite(obj.gid, obj.x!, obj.y!, rot);
                    const spike = new Hazard(this.scene, cx, cy, w, h, true);
                    spike.setAlpha(0);
                    if (obj.gid) (spike.body as Phaser.Physics.Arcade.StaticBody).setSize(6, h * 0.75);
                    if (sw) {
                        const startEnabled = prop<boolean>('startEnabled') ?? true;
                        spike.linkSwitch(sw, startEnabled);
                        spike.setEnabled(startEnabled);
                    }
                    this.hazard.add(spike);
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
                    this.spawnSaw(obj, cx, cy);
                    break;
                case 'turret':
                    this.spawnTurret(obj, cx, cy);
                    break;
                case 'punch_box': {
                    const forceX = prop<number>('forceX');
                    const forceY = prop<number>('forceY');
                    // The body tile (frame 173) carries no force props — it's the static,
                    // collidable housing. Render it where Tiled placed it, oriented by its own
                    // flip flags, and let the fist object (which has the force props) own the
                    // punch logic and derive the body cell for its trigger zone.
                    if (forceX === undefined && forceY === undefined) {
                        this.tiled.addOrientedTileSprite(obj, cx, cy, 48);
                        break;
                    }
                    const swId   = prop<number>('linkedSwitchId');
                    const sw     = linkedSwitch(swId);
                    const startEnabled = prop<boolean>('startEnabled') ?? true;
                    const fistFrame = obj.gid ? this.tiled.gidFrame(obj.gid & 0x1FFFFFFF) : 0;

                    // The punch direction is the CARDINAL direction from the body to this fist
                    // (never the force vector — a 2D force is just a feel offset). Find the
                    // nearest body tile (a punch_box object with no force props) and snap the
                    // body→fist offset to its dominant axis.
                    let dirX = 0, dirY = 0, best = Infinity;
                    for (const other of this.objectById.values()) {
                        if (other === obj || this.tiled.getObjectType(other) !== 'punch_box') continue;
                        if (this.tiled.getTiledProp(other, 'forceX') !== undefined ||
                            this.tiled.getTiledProp(other, 'forceY') !== undefined) continue; // skip other fists
                        const g = this.tiled.objectGeometry(other);
                        const dx = cx - g.cx, dy = cy - g.cy;
                        const dist = Math.hypot(dx, dy);
                        if (dist < best) {
                            best = dist;
                            if (Math.abs(dx) >= Math.abs(dy)) { dirX = Math.sign(dx); dirY = 0; }
                            else                               { dirX = 0; dirY = Math.sign(dy); }
                        }
                    }
                    // Fallback if no body is found: snap the force to its dominant axis.
                    if (dirX === 0 && dirY === 0) {
                        const fx = forceX ?? 0, fy = forceY ?? 0;
                        if (Math.abs(fx) >= Math.abs(fy)) dirX = Math.sign(fx) || -1;
                        else                              dirY = Math.sign(fy);
                    }

                    const pb = new PunchBox(this.scene, cx, cy, w, h, fistFrame, dirX, dirY, forceX ?? -200, forceY ?? 0, startEnabled);
                    if (sw) pb.linkSwitch(sw);
                    this.punchBox.add(pb);
                    break;
                }
            }
        }
    
        private spawnTriggerSpike(cx: number, cy: number, w: number, h: number, offTime = 1000, onTime = 500, extendTime = 80) {
                const tileCount = Math.max(1, Math.round(w / 8));
                const container = this.scene.add.container(cx, cy).setDepth(50);
                const tiles: Phaser.GameObjects.Image[] = [];
                for (let i = 0; i < tileCount; i++) {
                    const t = this.scene.add.image((i - (tileCount - 1) / 2) * 8, 0, 'tileSprites', TRIGGER_SPIKE_FRAMES[0] - 1);
                    container.add(t);
                    tiles.push(t);
                }
        
                const hazard = new Hazard(this.scene, cx, cy, w, h, true);
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
                    this.scene.time.delayedCall(dwell, tick);
                };
                // Don't start immediately — defer to pendingTriggerSpikeStarters so all
                // trigger spikes in the level start on the exact same frame and stay in sync.
                this.pendingTriggerSpikeStarters.push(tick);
        
                this.hazard.add(hazard);
            }
        
            private spawnSwitchDrivenSpike(
                cx: number, cy: number, w: number, h: number,
                sw: Switch, startEnabled: boolean
            ) {
                const tileCount = Math.max(1, Math.round(w / 8));
                const container = this.scene.add.container(cx, cy).setDepth(50);
                const tiles: Phaser.GameObjects.Image[] = [];
                for (let i = 0; i < tileCount; i++) {
                    const img = this.scene.add.image(
                        (i - (tileCount - 1) / 2) * 8, 0,
                        'tileSprites', TRIGGER_SPIKE_FRAMES[startEnabled ? 3 : 0] - 1
                    );
                    container.add(img);
                    tiles.push(img);
                }
        
                const hazard = new Hazard(this.scene, cx, cy, w, h, true);
                hazard.setAlpha(0);
                (hazard.body as any).enable = startEnabled;
        
                const setFrame = (fi: number) => tiles.forEach(t => t.setFrame(TRIGGER_SPIKE_FRAMES[fi] - 1));
        
                const runSeq = (seq: [number, number][], dangerousFromStep: number) => {
                    let step = 0;
                    const tick = () => {
                        const [fi, dwell] = seq[step];
                        setFrame(fi);
                        (hazard.body as any).enable = step >= dangerousFromStep;
                        if (++step < seq.length && dwell > 0) this.scene.time.delayedCall(dwell, tick);
                    };
                    tick();
                };
        
                let prevPowered = sw.powered;
                this.scene.events.on('update', () => {
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
        
                this.hazard.add(hazard);
            }
        
            private spawnSaw(
                obj: Phaser.Types.Tilemaps.TiledObject,
                cx: number, cy: number
            ) {
                const endTargetId = this.tiled.getTiledProp<number>(obj, 'endTarget');
                let endX: number | undefined;
                let endY: number | undefined;
                if (endTargetId !== undefined) {
                    const target = this.objectById.get(endTargetId);
                    if (target) {
                        // endTarget is placed at the bottom-left corner of the destination tile cell;
                        // subtract half a tile height to get the saw's center-to-center travel target.
                        endX = target.x! + (target.width ?? 0) / 2;
                        endY = target.y! - 4;
                    }
                }
                endX ??= this.tiled.getTiledProp<number>(obj, 'endX') ?? cx;
                endY ??= this.tiled.getTiledProp<number>(obj, 'endY') ?? cy;
                const speed = this.tiled.getTiledProp<number>(obj, 'speed') ?? 30;
                const linkedSwitchId = this.tiled.getTiledProp<number>(obj, 'linkedSwitchId');
                const moves = endX !== cx || endY !== cy;
        
                const container = this.scene.add.container(cx, cy).setDepth(50);
                const tiles: Phaser.GameObjects.Image[] = [];
                for (let i = 0; i < 3; i++) {
                    const t = this.scene.add.image((i - 1) * 8, 0, 'tileSprites', SAW_ANIM_FRAMES[0][i] - 1);
                    container.add(t);
                    tiles.push(t);
                }
                let f = 0;
                this.scene.time.addEvent({
                    delay: 100,
                    loop: true,
                    callback: () => {
                        f = (f + 1) % SAW_ANIM_FRAMES.length;
                        for (let i = 0; i < 3; i++) tiles[i].setFrame(SAW_ANIM_FRAMES[f][i] - 1);
                    },
                });
        
                // Hitbox is only the 8×8 center tile — visual is decorative
                const saw = new Hazard( this.scene, cx, cy, 8, 8, !moves, moves ? { x: endX, y: endY } : undefined, moves ? speed : undefined, 'auto');
                saw.setAlpha(0);
                saw.tileSprite = container;
        
                if (linkedSwitchId !== undefined) {
                    const sw = this.switchById.get(linkedSwitchId);
                    if (sw) {
                        saw.linkSwitch(sw);
                        saw.setEnabled(false);
                    }
                }
        
                this.hazard.add(saw);
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
        
                const fireInterval = this.tiled.getTiledProp<number>(obj, 'fireInterval') ?? 1000;
        
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
        
                const container = this.scene.add.container(cx + ocx, cy + ocy).setDepth(50);
                const offsets: [number, number][] = [[-4, -4], [4, -4], [-4, 4], [4, 4]];
                for (let i = 0; i < 4; i++) {
                    container.add(this.scene.add.image(offsets[i][0], offsets[i][1], 'tileSprites', TURRET_TILE_GIDS[i] - 1));
                }
                // Apply the Tiled flip/rotation to the container
                container.setAngle(angle).setScale(scaleX, scaleY);
        
                // Hitbox covers only the anchor tile (8×8) — not the full 2×2 block.
                const turret = new Hazard(this.scene, cx, cy, 8, 8, true);
                turret.setAlpha(0);
                turret.tileSprite = container;
                turret.direction = direction as 'left' | 'right';
                this.hazard.add(turret);
        
                this.scene.time.addEvent({
                    delay: fireInterval,
                    loop: true,
                    callback: () => turret.shoot(),
                });
            }

    private distributePlatforms() {
        for (const [endTargetId, entries] of this.platformGroups) {
            if (entries.length <= 1) continue;
            const target = this.objectById.get(endTargetId);
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
    }

    private syncTriggerSpikes() {
         this.scene.time.delayedCall(0, () => {
            for (const start of this.pendingTriggerSpikeStarters) start();
            this.pendingTriggerSpikeStarters = [];
        });
    }

    private spawnPlayer(): Player {
        const spawnLayer = this.map.getObjectLayer('Spawn');
        const sp = spawnLayer!.objects[0];
        const spawnX = sp.x! + sp.width! / 2;
        const spawnY = (sp.gid ? sp.y! - sp.height! : sp.y!) + sp.height! / 2;

        const player = new Player(this.scene, spawnX, spawnY);
        player.setTintMode(Phaser.TintModes.FILL);
        player.levelStartX = spawnX;
        player.levelStartY = spawnY;
        
        return player;
    }
}   