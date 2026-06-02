import Phaser from 'phaser';
import { Hazard, Vec2 } from './hazards';
import { Switch } from './switches';

export class MovingPlatform extends Phaser.GameObjects.Rectangle {
    Body: Phaser.Physics.Arcade.Body;
    mode: 'auto' | 'driven';
    powered: boolean = false;
    tileSprite: Phaser.GameObjects.Image | null = null;

    private startPos: Vec2;
    private endPos: Vec2;
    private speed: number;
    private headingToEnd: boolean = true;
    private attachedHazards: { hazard: Hazard; offsetX: number; offsetY: number }[] = [];
    private linkedSwitch: Switch | null = null;
    private switchInverted: boolean = false;

    constructor(
        scene: Phaser.Scene,
        x: number, y: number,
        width: number, height: number,
        endPos?: Vec2,
        speed?: number,
        mode: 'auto' | 'driven' = 'auto'
    ) {
        super(scene, x, y, width, height, 0x888888);
        scene.add.existing(this);
        scene.physics.add.existing(this, false);
        this.Body = this.body as Phaser.Physics.Arcade.Body;
        this.Body.setAllowGravity(false);
        this.Body.setImmovable(true);

        this.startPos = { x, y };
        this.endPos = endPos ?? { x, y };
        this.speed = speed ?? 0;
        this.mode = mode;
    }

    setEndPos(x: number, y: number) {
        this.endPos = { x, y };
    }

    linkSwitch(sw: Switch, inverted: boolean = false) {
        this.linkedSwitch = sw;
        this.switchInverted = inverted;
    }

    attachHazard(hazard: Hazard, offsetX: number, offsetY: number) {
        this.attachedHazards.push({ hazard, offsetX, offsetY });
    }

    update(delta: number) {
        if (this.linkedSwitch) {
            const next = this.linkedSwitch.powered !== this.switchInverted;
            if (next !== this.powered) this.powered = next;
        }

        if (this.mode === 'auto') {
            const target = this.headingToEnd ? this.endPos : this.startPos;
            const reached = this.seekTarget(target, delta);
            if (reached) this.headingToEnd = !this.headingToEnd;
        } else {
            this.seekTarget(this.powered ? this.endPos : this.startPos, delta);
        }

        this.attachedHazards.forEach(({ hazard, offsetX, offsetY }) => {
            hazard.syncPosition(this.x + offsetX, this.y + offsetY);
        });

        if (this.tileSprite) this.tileSprite.setPosition(Math.round(this.x), Math.round(this.y));
    }

    private seekTarget(target: Vec2, delta: number): boolean {
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const step = this.speed * (delta / 1000);

        if (dist > step) {
            this.Body.setVelocityX((dx / dist) * this.speed);
            this.Body.setVelocityY((dy / dist) * this.speed);
            return false;
        }

        this.Body.reset(target.x, target.y);
        return true;
    }
}
