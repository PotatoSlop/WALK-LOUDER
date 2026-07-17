import Phaser from 'phaser';
import { Switch } from './switches';

export type MagnetFacing = 'left' | 'right' | 'up' | 'down';

// A directional magnet. Its field is a straight line of tiles projecting out of the face it
// points at, up to `radiusTiles` long, cut short by the first solid tile / moving platform in
// the way. Any body inside that line is pulled back toward the magnet along the field axis, with
// a pull that ramps up the closer it gets. The kill is a plain Arcade overlap on the magnet's own
// tile body (wired in GameScene) — a body dragged flush against the magnet just touches it.
export class Magnet extends Phaser.GameObjects.Rectangle {
    facing: MagnetFacing;
    radiusTiles: number;
    strength: number;                 // px/s pull at the magnet face (the curve's max)
    enabled: boolean;
    tileSprite: Phaser.GameObjects.Image | null = null;

    // True on any frame this magnet actually pulled at least one body — read by the
    // scene to drive the sustained magnet sound.
    pulledThisFrame: boolean = false;

    private linkedSwitch: Switch | null = null;
    private switchInverted: boolean = false;

    // Field hint particles: white/blue motes drifting back toward the magnet along the field.
    private emitter: Phaser.GameObjects.Particles.ParticleEmitter;
    private fieldZone = new Phaser.Geom.Rectangle(0, 0, 1, 1);
    private killZone = new Phaser.Geom.Rectangle(0, 0, 1, 1);
    private fxOn = false;

    private static readonly TILE = 8;
    // Constant drift speed (px/s) of the hint particles toward the magnet.
    private static readonly FX_SPEED = 50;
    private static readonly FX_PARTICLE_PX = 2;

    constructor(
        scene: Phaser.Scene,
        x: number, y: number,
        width: number, height: number,
        facing: MagnetFacing,
        radiusTiles: number,
        strength: number = 150,
        startEnabled: boolean = true
    ) {
        super(scene, x, y, width, height, 0xff0000);
        scene.add.existing(this);
        // Static body on the magnet's own tile. The kill is a plain Arcade overlap against this
        // (see GameScene) rather than a hand-rolled proximity check.
        scene.physics.add.existing(this, true);
        this.facing = facing;
        this.radiusTiles = radiusTiles;
        this.strength = strength;
        this.enabled = startEnabled;
        this.emitter = this.createFieldEmitter(scene);
    }

    private createFieldEmitter(scene: Phaser.Scene): Phaser.GameObjects.Particles.ParticleEmitter {
        const horizontal = this.horizontal;
        const speed = -this.outward * Magnet.FX_SPEED;   // constant drift toward the magnet

        // Hard stop: particles are destroyed the instant they enter the magnet's own tile, so none
        // overshoot it regardless of spawn distance. The magnet never moves, so the zone is fixed.
        this.killZone.setTo(this.x - Magnet.TILE / 2, this.y - Magnet.TILE / 2, Magnet.TILE, Magnet.TILE);
        // Fallback cap so a particle can't linger if it somehow never reaches the kill zone.
        const maxLife = ((this.radiusTiles + 1) * Magnet.TILE / Magnet.FX_SPEED) * 1000;

        // Constant size, in world px, regardless of the source texture's dimensions.
        const texW = scene.textures.get('__WHITE').getSourceImage().width || 4;
        const scale = Magnet.FX_PARTICLE_PX / texW;

        const emitter = scene.add.particles(this.x, this.y, '__WHITE', {
            lifespan: maxLife,
            speedX: horizontal ? speed : 0,
            speedY: horizontal ? 0 : speed,
            scale,                                  // constant size — only alpha fades
            alpha: { start: 0.7, end: 0 },
            tint: [0x66ccff, 0x99ddff, 0xffffff],
            blendMode: 'ADD',
            frequency: 50,                          // denser stream
            quantity: 4,
            emitting: false,
            emitZone: { type: 'random', source: this.fieldZone, quantity: 1 },
            deathZone: { type: 'onEnter', source: this.killZone },
        });
        emitter.setDepth(40);
        return emitter;
    }

    linkSwitch(sw: Switch, inverted: boolean = false) {
        this.linkedSwitch = sw;
        this.switchInverted = inverted;
    }

    setEnabled(state: boolean) {
        this.enabled = state;
        // Disable the body too so a powered-off magnet neither pulls nor kills.
        (this.body as Phaser.Physics.Arcade.StaticBody).enable = state;
        if (this.tileSprite) this.tileSprite.setVisible(state);
    }

    private get horizontal(): boolean {
        return this.facing === 'left' || this.facing === 'right';
    }

    // +1 if the field projects in the +axis direction (right / down), else -1. The pull is the
    // opposite sign (back toward the magnet).
    private get outward(): number {
        return this.facing === 'right' || this.facing === 'down' ? 1 : -1;
    }

    // Pull speed (px/s) at a given distance into the field. Ease-in curve: a gentle drift at the
    // far edge that ramps toward full `strength` at the face, so being close is near-inescapable.
    private pullSpeed(dist: number, fieldLen: number): number {
        const t = Phaser.Math.Clamp(1 - dist / fieldLen, 0, 1);   // 1 at the face, 0 at the edge
        return this.strength * (0.12 + 0.88 * t * t);
    }

    // How many tiles the field reaches before a wall stops it. blockedAt returns true when the
    // given world point is inside a solid tile or platform — evaluated live so moving platforms
    // can cut the field as they pass through it.
    private clearFieldLen(blockedAt: (worldX: number, worldY: number) => boolean): number {
        const T = Magnet.TILE;
        let clear = 0;
        for (let i = 1; i <= this.radiusTiles; i++) {
            const wx = this.horizontal ? this.x + this.outward * i * T : this.x;
            const wy = this.horizontal ? this.y : this.y + this.outward * i * T;
            if (blockedAt(wx, wy)) break;
            clear = i;
        }
        return clear * T;
    }

    // Point the hint emitter at the current (unblocked) field span, or turn it off.
    private setFieldFx(fieldLen: number) {
        if (fieldLen <= 0) {
            if (this.fxOn) { this.emitter.stop(); this.fxOn = false; }
            return;
        }
        const half = Magnet.TILE / 2;
        this.emitter.setPosition(this.x, this.y);
        if (this.horizontal) {
            this.fieldZone.setTo(this.outward > 0 ? half : -half - fieldLen, -3, fieldLen, 6);
        } else {
            this.fieldZone.setTo(-3, this.outward > 0 ? half : -half - fieldLen, 6, fieldLen);
        }
        if (!this.fxOn) { this.emitter.start(); this.fxOn = true; }
    }

    update(bodies: Phaser.Physics.Arcade.Body[], blockedAt: (worldX: number, worldY: number) => boolean) {
        this.pulledThisFrame = false;
        if (this.linkedSwitch) {
            const on = this.linkedSwitch.powered !== this.switchInverted;
            if (on !== this.enabled) this.setEnabled(on);
        }
        if (!this.enabled) { this.setFieldFx(0); return; }

        const fieldLen = this.clearFieldLen(blockedAt);
        this.setFieldFx(fieldLen);
        if (fieldLen <= 0) return;

        const T = Magnet.TILE;
        const out = this.outward;

        for (const body of bodies) {
            if (!body.enable) continue;

            if (this.horizontal) {
                // Must share the magnet's row (thin horizontal line field).
                if (body.bottom <= this.y - T / 2 || body.top >= this.y + T / 2) continue;
                const rel = (body.center.x - this.x) * out;   // distance out in front of the magnet
                if (rel <= 0 || rel > fieldLen) continue;
                body.velocity.x = -out * this.pullSpeed(rel, fieldLen);
                this.pulledThisFrame = true;
            } else {
                if (body.right <= this.x - T / 2 || body.left >= this.x + T / 2) continue;
                const rel = (body.center.y - this.y) * out;
                if (rel <= 0 || rel > fieldLen) continue;
                body.velocity.y = -out * this.pullSpeed(rel, fieldLen);
                this.pulledThisFrame = true;
            }
        }
    }
}
