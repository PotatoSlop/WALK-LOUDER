import Phaser from "phaser";

export class Switch extends Phaser.GameObjects.Rectangle {
    switchType: 'button' | 'lever' | 'oneshot';
    powered: boolean = false;
    tileSprite: Phaser.GameObjects.Image | null = null;
    /** Frame index (0-based) of the inactive tile */
    baseFrame: number = -1;
    /** How many frames to advance when powered (e.g. 2 → GID 372 becomes 374) */
    activeFrameOffset: number = 2;

    private touchingThisFrame: boolean = false;
    private wasTouching: boolean = false;
    // Initialise to grace-window length so the switch starts in a clean "not touching"
    // state — otherwise oneshot switches latch on at scene start before any overlap fires.
    private framesWithoutTouch: number = Switch.EXIT_GRACE_FRAMES;
    private static readonly EXIT_GRACE_FRAMES = 5;

    constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, switchType: 'button' | 'lever' | 'oneshot' = 'button') {
        super(scene, x, y, width, height, 0x00ffff);
        scene.add.existing(this);
        this.switchType = switchType;

    }

    onOverlap() {
        this.touchingThisFrame = true;
    }

    tick() {
        // Oneshot switches latch permanently once powered
        if (this.switchType === 'oneshot' && this.powered) {
            this.touchingThisFrame = false;
            return;
        }

        if (this.touchingThisFrame) {
            this.framesWithoutTouch = 0;
        } else {
            this.framesWithoutTouch++;
        }

        const effectivelyTouching = this.touchingThisFrame || this.framesWithoutTouch < Switch.EXIT_GRACE_FRAMES;
        const entered = effectivelyTouching && !this.wasTouching;

        if (this.switchType === 'button' || this.switchType === 'oneshot') {
            this.powered = effectivelyTouching;
        } else if (entered) {
            this.powered = !this.powered;
        }

        this.wasTouching = effectivelyTouching;
        this.touchingThisFrame = false;

        // Swap tile sprite between inactive / active frame
        if (this.tileSprite && this.baseFrame >= 0) {
            this.tileSprite.setFrame(this.baseFrame + (this.powered ? this.activeFrameOffset : 0));
        }
    }
}
