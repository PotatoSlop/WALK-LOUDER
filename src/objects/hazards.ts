import Phaser from "phaser";
import { Switch } from "./switches";

type Vec2 = { x: number; y: number };

export class Hazard extends Phaser.GameObjects.Rectangle {
    Body!: Phaser.Physics.Arcade.Body;
    isStatic: boolean;
    mode: 'auto' | 'driven';
    powered: boolean = false;
    tileSprite: Phaser.GameObjects.Image | Phaser.GameObjects.Container | null = null;

    private startPos: Vec2;
    private endPos: Vec2;
    private speed: number;
    private headingToEnd: boolean = true;
    private linkedSwitch: Switch | null = null;
    private switchInverted: boolean = false;

    constructor(
        scene: Phaser.Scene,
        x: number, y: number,
        width: number, height: number,
        isStatic: boolean = true,
        endPos?: Vec2,
        speed?: number,
        mode: 'auto' | 'driven' = 'auto'
    ) {
        super(scene, x, y, width, height, 0xff0000);
        scene.add.existing(this);
        scene.physics.add.existing(this, isStatic);
        this.isStatic = isStatic;
        this.startPos = { x, y };
        this.endPos = endPos ?? { x, y };
        this.speed = speed ?? 0;
        this.mode = mode;

        if (!isStatic) {
            this.Body = this.body as Phaser.Physics.Arcade.Body;
            this.Body.setAllowGravity(false);
        }
    }

    linkSwitch(sw: Switch, inverted: boolean = false) {
        this.linkedSwitch = sw;
        this.switchInverted = inverted;
    }

    setEnabled(state: boolean) {
        this.setVisible(state);
        this.setActive(state);
        // StaticBody is missing 'enable' in Phaser's TS types but it exists at runtime
        (this.body as any).enable = state;
        // Also show/hide the tile sprite visual
        if (this.tileSprite) this.tileSprite.setVisible(state);
    }

    syncPosition(x: number, y: number) {
        if (this.isStatic) {
            (this.body as Phaser.Physics.Arcade.StaticBody).reset(x, y);
        } else {
            this.Body.reset(x, y);
        }
    }

    update() {
        if (this.linkedSwitch) {
            const shouldBeEnabled = this.linkedSwitch.powered !== this.switchInverted;
            if (shouldBeEnabled !== this.active) {
                this.setEnabled(shouldBeEnabled);
            }
        }

        // Keep tile sprite visual in sync with physics position
        if (this.tileSprite) {
            this.tileSprite.setPosition(this.x, this.y);
        }

        if (!this.active || this.isStatic) return;

        if (this.mode === 'auto') {
            const target = this.headingToEnd ? this.endPos : this.startPos;
            const reached = this.seekTarget(target);
            if (reached) this.headingToEnd = !this.headingToEnd;
        } else {
            this.seekTarget(this.powered ? this.endPos : this.startPos);
        }
    }

    private seekTarget(target: Vec2): boolean {
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 2) {
            this.Body.setVelocityX((dx / dist) * this.speed);
            this.Body.setVelocityY((dy / dist) * this.speed);
            return false;
        }

        this.Body.setVelocity(0, 0);
        this.setPosition(target.x, target.y);
        return true;
    }
}
