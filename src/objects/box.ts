import Phaser from 'phaser';
import { Switch } from './switches';

export class Box extends Phaser.GameObjects.Rectangle {
    Body: Phaser.Physics.Arcade.Body;
    tileSprite: Phaser.GameObjects.Image | null = null;
    /** Surface friction (0–1). Boxes below MovingPlatform's threshold slide off instead of being carried. */
    friction: number;
    private linkedSwitch: Switch | null = null;
    private switchInverted: boolean = false;

    constructor(
        scene: Phaser.Scene,
        x: number, y: number,
        width: number, height: number,
        dragX: number = 300,
        mass: number = 1,
        friction: number = 0.6
    ) {
        super(scene, x, y, width, height, 0x000000);
        scene.add.existing(this);
        scene.physics.add.existing(this, false);
        this.Body = this.body as Phaser.Physics.Arcade.Body;
        this.Body.setCollideWorldBounds(false);
        this.Body.setDragX(dragX);
        this.Body.setMass(mass);
        // Speed ceiling. Boxes are otherwise uncapped (Phaser default 10000), so a fast head-on
        // hit — or the mass-based two-body velocity exchange Arcade runs on pushable contacts —
        // can hand a box a velocity far beyond anything designed and fling it off-screen in a
        // frame or two before it separates (the "box vanishes" bug). The ceiling sits just above
        // the strongest designed punch (forceX up to 800, forceY up to 600) and well above a
        // full-height fall (~450 at this world height), so intended launches and normal falling
        // are untouched; only runaway velocity is clamped.
        this.Body.setMaxVelocity(800, 700);
        // Boxes are never pushed BY another body's momentum. Every player↔box contact then routes
        // through Arcade's one-sided branch — the player conforms to the box (rides on top, stops
        // below, stops beside) and can never inject velocity into a box, which is what caused the
        // catapult / phase-through bugs. Boxes still move under gravity, punches, platform carry,
        // and the scene's manual shove (GameScene.pushBoxes); they just can't be flung by a
        // collision. This makes the old per-frame isolateRiddenBoxes toggling unnecessary.
        this.Body.pushable = false;
        this.friction = friction;
    }

    // Reposition the (invisible) rectangle and its visible tile sprite from the current physics
    // body. Used when scene logic nudges the body AFTER Box.update() has already run this frame
    // (e.g. ledge tolerance): Arcade won't re-sync the GameObject transform from the body until
    // the next step, so without this the sprite would lag the correction by a frame.
    //
    // prevFrame must be re-based too: Body.postUpdate applies `position - prevFrame` to the
    // GameObject, so writing the transform AND leaving prevFrame stale applies the nudge twice
    // (the box overshoots by the full nudge distance on the next preUpdate).
    syncDisplayFromBody() {
        this.Body.prevFrame.set(this.Body.x, this.Body.y);
        this.x = this.Body.center.x;
        this.y = this.Body.center.y;
        // tileSprite uses origin (0,1) — convert center to bottom-left corner
        if (this.tileSprite) this.tileSprite.setPosition(this.x - this.width / 2, this.y + this.height / 2);
    }

    // Called each frame by a MovingPlatform this box is riding. Body.reset keeps the
    // physics body locked to the platform so gravity/drag don't fight the carry.
    syncPosition(x: number, y: number) {
        this.Body.reset(x, y);
        // tileSprite uses origin (0,1) — convert center to bottom-left corner
        if (this.tileSprite) this.tileSprite.setPosition(x - this.width / 2, y + this.height / 2);
    }

    linkSwitch(sw: Switch, inverted: boolean = false) {
        this.linkedSwitch = sw;
        this.switchInverted = inverted;
    }

    setEnabled(state: boolean) {
        this.setVisible(state);
        this.setActive(state);
        (this.Body as any).enable = state;
        if (this.tileSprite) this.tileSprite.setVisible(state);
    }

    update() {
        if (this.linkedSwitch) {
            const shouldBeEnabled = this.linkedSwitch.powered !== this.switchInverted;
            if (shouldBeEnabled !== this.active) this.setEnabled(shouldBeEnabled);
        }
        // tileSprite uses origin (0,1) — convert center to bottom-left corner
        if (this.tileSprite) this.tileSprite.setPosition(this.x - this.width / 2, this.y + this.height / 2);
    }
}
