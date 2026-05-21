import Phaser from "phaser";

export class Switch extends Phaser.GameObjects.Rectangle {
    Body!: Phaser.Physics.Arcade.Body;
    switchType: 'button' | 'lever';
    powered: boolean = false;

    private touchingThisFrame: boolean = false;
    private wasTouching: boolean = false;
    private framesWithoutTouch: number = 0;
    private static readonly EXIT_GRACE_FRAMES = 5;

    constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, switchType: 'button' | 'lever' = 'button') {
        super(scene, x, y, width, height, 0x00ffff);
        scene.add.existing(this);
        scene.physics.add.existing(this, true);
        this.Body = this.body as Phaser.Physics.Arcade.Body;
        this.switchType = switchType;
    }

    onOverlap() {
        this.touchingThisFrame = true;
    }

    tick() {
        if (this.touchingThisFrame) {
            this.framesWithoutTouch = 0;
        } else {
            this.framesWithoutTouch++;
        }

        // Don't treat a brief gap in overlap detection as an exit — only exit after
        // EXIT_GRACE_FRAMES consecutive frames with no overlap
        const effectivelyTouching = this.touchingThisFrame || this.framesWithoutTouch < Switch.EXIT_GRACE_FRAMES;
        const entered = effectivelyTouching && !this.wasTouching;

        if (this.switchType === 'button') {
            this.powered = effectivelyTouching;
        } else if (entered) {
            this.powered = !this.powered;
        }

        this.wasTouching = effectivelyTouching;
        this.touchingThisFrame = false;
    }
}
