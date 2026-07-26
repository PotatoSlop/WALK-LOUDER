import Phaser from "phaser";

export class Switch extends Phaser.GameObjects.Rectangle {
    switchType: 'button' | 'lever' | 'oneshot';
    powered: boolean = false;
    tileSprite: Phaser.GameObjects.Image | null = null;
    baseFrame: number = -1;
    activeFrameOffset: number = 2; // For sprite handling

    triggerOffsetX: number = 0;
    triggerOffsetY: number = 0;
    triggerWidth: number;
    triggerHeight: number;

    private touchingThisFrame: boolean = false;
    private wasTouching: boolean = false;
    private framesWithoutTouch: number = Switch.EXIT_GRACE_FRAMES;
    private framesSinceFlip: number = Switch.FLIP_COOLDOWN_FRAMES;
    private static readonly FLIP_COOLDOWN_FRAMES = 30;
    private static readonly EXIT_GRACE_FRAMES = 5;

    constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, switchType: 'button' | 'lever' | 'oneshot' = 'button') {
        super(scene, x, y, width, height, 0x00ffff);
        scene.add.existing(this);
        this.switchType = switchType;
        this.triggerWidth = width;
        this.triggerHeight = height;
    }

    get triggerRect(): { x: number; y: number; width: number; height: number } {
        return {
            x: this.x + this.triggerOffsetX,
            y: this.y + this.triggerOffsetY,
            width: this.triggerWidth,
            height: this.triggerHeight,
        };
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

        this.framesSinceFlip++;

        const effectivelyTouching = this.touchingThisFrame || this.framesWithoutTouch < Switch.EXIT_GRACE_FRAMES;
        const entered = effectivelyTouching && !this.wasTouching;

        const prevPowered = this.powered;
        if (this.switchType === 'button' || this.switchType === 'oneshot') {
            this.powered = effectivelyTouching;
        } else if (entered && this.framesSinceFlip >= Switch.FLIP_COOLDOWN_FRAMES) {
            this.powered = !this.powered;
            this.framesSinceFlip = 0;
        }
        // Click on every power transition (press, release, lever flip either way).
        if (this.powered !== prevPowered) this.scene.game.events.emit('sfx-switch');

        this.wasTouching = effectivelyTouching;
        this.touchingThisFrame = false;

        // Swap tile sprite between inactive / active frame
        if (this.tileSprite && this.baseFrame >= 0) {
            this.tileSprite.setFrame(this.baseFrame + (this.powered ? this.activeFrameOffset : 0));
        }
    }

    syncPosition(x: number, y: number) {
        this.setPosition(x, y);
        // tileSprite uses a centre origin (see LevelBuilder.addOrientedTileSprite)
        if (this.tileSprite) this.tileSprite.setPosition(x, y);
    }

    
}
