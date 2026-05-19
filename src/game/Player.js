const GRAVITY = 0.55;
const MAX_FALL = 14;

// Voice impulse: vx set once per word, scales with how loud the word was said
const VOICE_STEP_MIN = 1.5;  // quiet word
const VOICE_STEP_MAX = 9.0;  // yelled word
const VOICE_FRICTION = 0.80; // how quickly the burst decays on the ground

// Keyboard continuous: vx held while key is down, scaled by live volume
const KBD_SPEED_MIN = 1.5;
const KBD_SPEED_MAX = 7.0;
const KBD_FRICTION  = 0.72;

const AIR_DAMPING = 0.97;
const JUMP_MIN    = 8.5;
const JUMP_MAX    = 13.5;

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.w = 16;
    this.h = 24;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.facing = 1; // 1 = right, -1 = left
    this.dead = false;
  }

  update(input, world) {
    // ── Horizontal ──────────────────────────────────────────────────────────
    if (input.impulse.dx !== 0) {
      this.facing = input.impulse.dx;

      if (input.continuous) {
        // Keyboard: volume is live magnitude while key held
        this.vx = input.impulse.dx * (KBD_SPEED_MIN + (KBD_SPEED_MAX - KBD_SPEED_MIN) * input.impulse.mag);
      } else {
        // Voice: one-shot burst — how loud you said the word = how far you go
        this.vx = input.impulse.dx * (VOICE_STEP_MIN + (VOICE_STEP_MAX - VOICE_STEP_MIN) * input.impulse.mag);
      }
    } else {
      // No input this frame: coast to stop
      const friction = this.onGround
        ? (input.continuous ? KBD_FRICTION : VOICE_FRICTION)
        : AIR_DAMPING;
      this.vx *= friction;
      if (Math.abs(this.vx) < 0.08) this.vx = 0;
    }

    // ── Jump ────────────────────────────────────────────────────────────────
    if (input.impulse.jump && this.onGround) {
      this.vy = -(JUMP_MIN + (JUMP_MAX - JUMP_MIN) * input.impulse.mag);
      this.onGround = false;
    }

    // ── Gravity ─────────────────────────────────────────────────────────────
    this.vy = Math.min(this.vy + GRAVITY, MAX_FALL);

    // ── Integrate ───────────────────────────────────────────────────────────
    this.x += this.vx;
    this.y += this.vy;

    // ── Collisions ──────────────────────────────────────────────────────────
    this.onGround = false;
    for (const p of world.platforms) this._resolve(p);

    // ── World bounds ─────────────────────────────────────────────────────────
    this.x = Math.max(0, Math.min(world.w - this.w, this.x));
    if (this.y > world.h + 60) this.dead = true;
  }

  _resolve(rect) {
    if (this.x + this.w <= rect.x || this.x >= rect.x + rect.w) return;
    if (this.y + this.h <= rect.y || this.y >= rect.y + rect.h) return;

    const ol  = (this.x + this.w) - rect.x;
    const or_ = (rect.x + rect.w) - this.x;
    const ot  = (this.y + this.h) - rect.y;
    const ob  = (rect.y + rect.h) - this.y;

    if (Math.min(ot, ob) < Math.min(ol, or_)) {
      if (ot < ob) {
        this.y -= ot; this.vy = 0; this.onGround = true;
      } else {
        this.y += ob; if (this.vy < 0) this.vy = 0;
      }
    } else {
      if (ol < or_) { this.x -= ol; } else { this.x += or_; }
      this.vx = 0;
    }
  }

  draw(ctx) {
    const px = Math.round(this.x);
    const py = Math.round(this.y);

    // Body
    ctx.fillStyle = '#33ff33';
    ctx.fillRect(px, py, this.w, this.h);

    // Helmet
    ctx.fillStyle = '#1a8c1a';
    ctx.fillRect(px, py, this.w, 6);

    // Eye on facing side
    const eyeOffX = this.facing === 1 ? this.w - 5 : 3;
    ctx.fillStyle = '#000';
    ctx.fillRect(px + eyeOffX, py + 8, 3, 3);

    // Legs — alternate based on horizontal position for walk cycle feel
    const legOffset = Math.abs(this.vx) > 0.5 ? Math.round(this.x * 0.5) % 2 : 0;
    ctx.fillStyle = '#1a8c1a';
    ctx.fillRect(px + 2,          py + this.h - 4, 4, 4 + legOffset);
    ctx.fillRect(px + this.w - 6, py + this.h - 4, 4, 4 - legOffset);
  }
}
