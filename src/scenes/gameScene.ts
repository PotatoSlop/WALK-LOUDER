import Phaser from 'phaser';
import { OBJECT_TYPES } from '../config/objectTypes';
import { LevelData, LevelObject, HazardDef, KeyDef, SwitchDef, DoorDef, MovingPlatformDef } from '../config/levelTypes';
import { Player } from '../objects/player';
import { micInput } from '../systems/MicInput';
import { Door } from '../objects/door';
import { Hazard } from '../objects/hazards';
import { Key } from '../objects/key';
import { MovingPlatform } from '../objects/movingPlatform';
import { Switch } from '../objects/switches';

export class GameScene extends Phaser.Scene {

    player: any;
    cursors: any;
    groundGroup: any;
    platformGroup: any;
    hazardGroup: any;
    doorGroup: any;
    itemGroup: any;
    switchGroup: any;
    mic: any;

    private currentLevelId: string = 'level-01';

    constructor() {
        super({ key: 'main' });
    }

    init(data: { levelId?: string }) {
        this.currentLevelId = data.levelId
            ?? localStorage.getItem('walkloud_currentLevel')
            ?? 'level-01';
    }

    preload() {
        this.load.json(this.currentLevelId, `assets/data/levels/${this.currentLevelId}.json`);
    }

    create() {
        const levelData = this.cache.json.get(this.currentLevelId) as LevelData;
        this.loadLevel(levelData);

        this.cursors = this.input.keyboard!.createCursorKeys();

        if (!this.mic) {
            this.mic = new micInput();
            this.mic.init().then(() => {
                this.scene.launch('calibration', { mic: this.mic });
            });
        }

        if (this.scene.isActive('debug')) this.scene.stop('debug');
        this.scene.launch('debug');
    }

    private loadLevel(data: LevelData) {
        this.groundGroup   = this.add.group();
        this.platformGroup = this.add.group();
        this.hazardGroup   = this.add.group();
        this.doorGroup     = this.add.group();
        this.itemGroup     = this.add.group();
        this.switchGroup   = this.add.group();

        this.player = new Player(this, data.spawn.x, data.spawn.y);
        this.player.levelStartX = data.spawn.x;
        this.player.levelStartY = data.spawn.y;

        const objectsById = new Map<string, any>();

        for (const obj of data.objects) {
            const instance = this.spawnObject(obj);
            if (instance && obj.id) objectsById.set(obj.id, instance);
        }

        for (const link of data.links ?? []) {
            const target = objectsById.get(link.objectId);
            const sw     = objectsById.get(link.switchId);
            if (target && sw) target.linkSwitch(sw, link.inverted ?? false);
        }

        this.physics.add.overlap(this.player, this.switchGroup, (_p, s) => (s as Switch).onOverlap());

        this.physics.add.overlap(this.player, this.itemGroup, (p, item) => {
            (p as Player).items.push((item as Key).keyType);
            (item as Phaser.GameObjects.GameObject).destroy();
        });

        this.physics.add.overlap(this.player, this.doorGroup, (p, d) => {
            const door   = d as Door;
            const player = p as Player;
            door.open(player.items);
            if (!door.isLocked) this.switchLevel(door.targetLevel);
        });

        this.physics.add.overlap(this.player, this.hazardGroup, (p) => {
            (p as Player).death();
        });

        this.physics.add.collider(this.player, this.platformGroup);
        this.physics.add.collider(this.player, this.groundGroup);
    }

    private spawnObject(obj: LevelObject): any {
        switch (obj.type) {
            case 'ground': {
                const rect = this.add.rectangle(obj.x, obj.y, obj.w, obj.h, OBJECT_TYPES.ground.color);
                this.physics.add.existing(rect, true);
                this.groundGroup.add(rect);
                return rect;
            }
            case 'platform': {
                const rect = this.add.rectangle(obj.x, obj.y, obj.w, obj.h, OBJECT_TYPES.platform.color);
                this.physics.add.existing(rect, true);
                this.groundGroup.add(rect);
                return rect;
            }
            case 'hazard': {
                const d = obj as HazardDef;
                const h = new Hazard(this, d.x, d.y, d.w, d.h, d.isStatic ?? true, d.endPos, d.speed, d.mode);
                this.hazardGroup.add(h);
                return h;
            }
            case 'key': {
                const d = obj as KeyDef;
                const k = new Key(this, d.x, d.y, d.w, d.h, d.keyType);
                this.itemGroup.add(k);
                return k;
            }
            case 'switch': {
                const d  = obj as SwitchDef;
                const sw = new Switch(this, d.x, d.y, d.w, d.h, d.switchType);
                this.switchGroup.add(sw);
                return sw;
            }
            case 'door': {
                const d    = obj as DoorDef;
                const door = new Door(this, d.x, d.y, d.w, d.h, d.isLocked ?? false, d.keyType ?? null, d.targetLevel);
                this.doorGroup.add(door);
                return door;
            }
            case 'movingPlatform': {
                const d  = obj as MovingPlatformDef;
                const mp = new MovingPlatform(this, d.x, d.y, d.w, d.h, d.endPos, d.speed, d.mode);
                this.platformGroup.add(mp);
                for (const ah of d.attachedHazards ?? []) {
                    const spike = new Hazard(this, d.x + ah.x, d.y + ah.y, ah.w, ah.h);
                    mp.attachHazard(spike, ah.x, ah.y);
                    this.hazardGroup.add(spike);
                }
                return mp;
            }
        }
    }

    switchLevel(levelId: string) {
        localStorage.setItem('walkloud_currentLevel', levelId);
        this.scene.restart({ levelId });
    }

    update(_time: number, delta: number) {
        var debugKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);

        const vol = debugKey.isDown ? 0.8 : this.mic.smoothedVolume();

        if (this.cursors.left.isDown) {
            this.player.moveLeft(vol);
        } else if (this.cursors.right.isDown) {
            this.player.moveRight(vol);
        } else if (this.player.Body.blocked.down) {
            this.player.setSpeedMultiplier(0.8);
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

        if (this.cursors.up.isUp && this.player.Body.velocity.y < 0) {
            this.player.Body.setVelocityY(this.player.Body.velocity.y * 0.85);
        }

        this.switchGroup.getChildren().forEach((s: Phaser.GameObjects.GameObject) => (s as Switch).tick());
        this.hazardGroup.getChildren().forEach((h: Phaser.GameObjects.GameObject) => (h as Hazard).update());
        this.platformGroup.getChildren().forEach((p: Phaser.GameObjects.GameObject) => (p as MovingPlatform).update(delta));
    }
}
