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
    private attached: { obj: { syncPosition(x: number, y: number): void }; offsetX: number; offsetY: number }[] = [];
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
        // No implicit velocity transfer to touching bodies — riders are carried manually
        // via PlayerController.getPlatformVelocityBelow(). Leaving friction on would also
        // drag the player when they press into a moving platform's side (the "sticking" bug).
        this.Body.setFriction(0, 0);

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

    attachObj(obj: { syncPosition(x: number, y: number): void }, offsetX: number, offsetY: number) {
        this.attached.push({ obj, offsetX, offsetY });
    }

    update(delta: number) {
        if (this.linkedSwitch) {
            const next = this.linkedSwitch.powered !== this.switchInverted;
            if (next !== this.powered) {
                this.powered = next;
                this.arrived = false; // target changed — start moving again
            }
        }

        if (this.mode === 'auto') {
            const target = this.headingToEnd ? this.endPos : this.startPos;
            const reached = this.seekTarget(target, delta);
            if (reached) {
                this.headingToEnd = !this.headingToEnd;
                // Immediately apply velocity for the return leg so there is no
                // zero-velocity frame at the turnaround point (Body.reset() zeroes
                // velocity, which otherwise lets the player free-fall for one frame).
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

        this.attached.forEach(({ obj, offsetX, offsetY }) => {
            obj.syncPosition(this.x + offsetX, this.y + offsetY);
        });

        if (this.tileSprite) this.tileSprite.setPosition(Math.round(this.x), Math.round(this.y));
    }

    private seekTarget(target: Vec2, delta: number): boolean {
        // Use body centre (updated in PRE_UPDATE) rather than this.x/y (synced in
        // POST_UPDATE — stale by one frame in scene.update(), causing slight overshoot).
        const bx   = this.Body.center.x;
        const by   = this.Body.center.y;
        const dx   = target.x - bx;
        const dy   = target.y - by;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Arrival threshold must cover at least one fixed physics tick of travel. The body
        // moves ~speed/fps per physics step, but the render `delta` can be far smaller at
        // high refresh rates — a threshold of speed*renderDelta would then be smaller than
        // the actual per-tick step, so the body overshoots the target every tick and
        // oscillates forever (velocity never zeroes, never "arrives"). Worse at high speed.
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
