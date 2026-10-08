import Phaser from 'phaser';

// A collectible "flip" hazard. The player collects it via a plain Arcade overlap (see
// GameScene): touching it destroys the object and inverts the game — colours go negative
// and loud/quiet swap so the mic makes the player SLOWER the louder they are.
//
// It loops between its two tile frames at FLIP_FPS. The spritesheet is loaded with
// firstgid === 1, so frame index === gid - 1:
//   gid 139 -> frame 138 (rest), gid 159 -> frame 158 (animated).
const FLIP_FRAMES = [138, 158];
const FLIP_FPS = 4;

export class Flip extends Phaser.GameObjects.Rectangle {
    tileSprite: Phaser.GameObjects.Image | null = null;
    private animTimer?: Phaser.Time.TimerEvent;

    constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number) {
        super(scene, x, y, width, height, 0x00ffff);
        scene.add.existing(this);
        // No physics body: collection is a plain AABB test in GameScene.update (see the
        // flipGroup loop). This deliberately avoids a physics overlap, which would set the
        // player's touching flags on contact and hand out a spurious extra jump.
        this.setAlpha(0);
    }

    // Begin looping the two flip frames. Call after tileSprite is assigned.
    startAnim() {
        if (!this.tileSprite || this.animTimer) return;
        let i = 0;
        this.tileSprite.setFrame(FLIP_FRAMES[0]);
        this.animTimer = this.scene.time.addEvent({
            delay: 1000 / FLIP_FPS,
            loop: true,
            callback: () => {
                i = (i + 1) % FLIP_FRAMES.length;
                this.tileSprite?.setFrame(FLIP_FRAMES[i]);
            },
        });
    }

    // Collected — tear down the animation timer, the visual, and this sensor object.
    collect() {
        this.animTimer?.remove();
        this.animTimer = undefined;
        this.tileSprite?.destroy();
        this.tileSprite = null;
        this.destroy();
    }
}
