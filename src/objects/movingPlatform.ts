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
    private arrived: boolean = false;
    private attached: { obj: { syncPosition(x: number, y: number): void }; offsetX: number; offsetY: number; friction: number }[] = [];
    private linkedSwitch: Switch | null = null;
    private switchInverted: boolean = false;

    /** Riders with a friction below this slide instead of being carried (e.g. icy boxes). */
    private static readonly STICK_FRICTION_THRESHOLD = 0.2;

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
        this.Body.friction.x = 1;
        this.Body.friction.y = 1;

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

    // friction defaults to 1 so riders without a friction value (e.g. switches) always stick.
    attachObj(obj: { syncPosition(x: number, y: number): void }, offsetX: number, offsetY: number, friction: number = 1) {
        this.attached.push({ obj, offsetX, offsetY, friction });
    }

    update(delta: number) {
        if (this.linkedSwitch) {
            const next = this.linkedSwitch.powered !== this.switchInverted;
            if (next !== this.powered) {
                this.powered = next;
                this.arrived = false;
            }
        }

        if (this.mode === 'auto') {
            const target = this.headingToEnd ? this.endPos : this.startPos;
            const reached = this.seekTarget(target, delta);
            if (reached) {
                this.headingToEnd = !this.headingToEnd;

                const next = this.headingToEnd ? this.endPos : this.startPos;
                const dx   = next.x - target.x;
                const dy   = next.y - target.y;

                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0) {
                    this.Body.setVelocityX((dx / dist) * this.speed);
                    this.Body.setVelocityY((dy / dist) * this.speed);
                }
            }
        } else if (!this.arrived) {
            const reached = this.seekTarget(this.powered ? this.endPos : this.startPos, delta);
            if (reached) this.arrived = true;
        }

        if (this.tileSprite) this.tileSprite.setPosition(Math.round(this.x), Math.round(this.y));

        for (const {obj, offsetX, offsetY, friction} of this.attached) {
            if (friction < MovingPlatform.STICK_FRICTION_THRESHOLD) continue;
        obj.syncPosition(this.x + offsetX, this.y + offsetY);
    }
    }

    private seekTarget(target: Vec2, delta: number): boolean {
        const bx   = this.Body.center.x;
        const by   = this.Body.center.y;
        const dx   = target.x - bx;
        const dy   = target.y - by;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const fps  = this.scene.physics.world.fps || 60;
        const dt   = Math.max(delta, 1000 / fps) / 1000;
        const step = this.speed * dt;

        if (dist > step) {
            this.Body.setVelocityX((dx / dist) * this.speed);
            this.Body.setVelocityY((dy / dist) * this.speed);
            return false;
        }

        this.Body.reset(target.x, target.y);
        return true;
    }

    
}
