// Phase 2 test layout — placeholder geometry to validate physics feel.
// Phase 3 replaces this with a proper tilemap loader.

export class World {
  constructor(w, h) {
    this.w = w;
    this.h = h;

    this.platforms = [
      // Ground
      { x: 0,   y: h - 18, w: w,  h: 18 },
      // Platforms — ascending left to right to test jumps at various heights
      { x: 80,  y: h - 72,  w: 80, h: 10 },
      { x: 240, y: h - 120, w: 70, h: 10 },
      { x: 390, y: h - 90,  w: 90, h: 10 },
      { x: 530, y: h - 155, w: 80, h: 10 },
      // A wall to test horizontal collision
      { x: 310, y: h - 180, w: 12, h: 60 },
    ];
  }

  draw(ctx) {
    for (const p of this.platforms) {
      // Main surface
      ctx.fillStyle = '#1e4d1e';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      // Top edge highlight
      ctx.fillStyle = '#33ff33';
      ctx.fillRect(p.x, p.y, p.w, 2);
    }
  }
}
