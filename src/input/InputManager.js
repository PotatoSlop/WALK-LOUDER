// Voice mode:   each detected word fires a one-shot impulse scaled by volume at that moment.
//               Player coasts to a stop between words.
// Keyboard mode: direction held continuously, magnitude from live mic volume.

export class InputManager {
  constructor() {
    this.mode = 'voice'; // 'voice' | 'keyboard'

    // Consumed by Player.update() every frame
    this.impulse = { dx: 0, jump: false, mag: 0 };
    this.continuous = false; // true in keyboard mode — Player applies velocity every frame

    // Voice: keywords arrive async between frames, buffered here until next update()
    this._pending = { dx: 0, jump: false, mag: 0 };

    this._keys = {};
    this._jumpHeld = false;

    window.addEventListener('keydown', e => { this._keys[e.code] = true; });
    window.addEventListener('keyup',   e => { this._keys[e.code] = false; });
  }

  setMode(mode) {
    this.mode = mode;
    this._pending = { dx: 0, jump: false, mag: 0 };
    this.impulse  = { dx: 0, jump: false, mag: 0 };
  }

  // Called by keyword event listeners — runs between frames, not in the game loop
  onKeyword(word, volume) {
    if (this.mode !== 'voice') return;
    switch (word) {
      case 'left':  this._pending.dx = -1; this._pending.mag = volume; break;
      case 'right': this._pending.dx =  1; this._pending.mag = volume; break;
      // 'up' can stack onto the same pending frame as a direction word
      case 'up':    this._pending.jump = true; this._pending.mag = Math.max(this._pending.mag, volume); break;
      case 'down':  this._pending.dx = 0; break;
    }
  }

  // Called once per game loop frame, before Player.update()
  update(audio) {
    if (this.mode === 'keyboard') {
      this.continuous = true;

      const left  = this._keys['KeyA'] || this._keys['ArrowLeft'];
      const right = this._keys['KeyD'] || this._keys['ArrowRight'];
      this.impulse.dx  = left ? -1 : right ? 1 : 0;
      this.impulse.mag = audio.volume;

      // Edge-detect jump so holding W doesn't multi-fire
      const jumpHeld = !!(this._keys['KeyW'] || this._keys['ArrowUp'] || this._keys['Space']);
      this.impulse.jump = jumpHeld && !this._jumpHeld;
      this._jumpHeld = jumpHeld;

    } else {
      // Voice: flush the pending impulse into this frame's impulse
      this.continuous = false;
      this.impulse = { ...this._pending };
      this._pending = { dx: 0, jump: false, mag: 0 };
    }
  }
}
