const MAG_DECAY = 0.94; // per frame — ~0.5s half-life at 60fps

export class InputManager {
  constructor() {
    this.impulse    = { dx: 0, jump: false, mag: 0 };
    this.continuous = true;

    this._keys   = {};
    this._jumpHeld = false;
    this._moveMag  = 0; // decaying magnitude tracker

    window.addEventListener('keydown', e => { this._keys[e.code] = true; });
    window.addEventListener('keyup',   e => { this._keys[e.code] = false; });
  }

  // Called once per game loop frame, before Player.update()
  update(audio) {
    const left  = this._keys['KeyA'] || this._keys['ArrowLeft'];
    const right = this._keys['KeyD'] || this._keys['ArrowRight'];
    this.impulse.dx = left ? -1 : right ? 1 : 0;

    // Rise instantly to current volume, decay slowly when quiet
    this._moveMag    = Math.max(audio.volume, this._moveMag * MAG_DECAY);
    this.impulse.mag = this._moveMag;

    // Edge-detect jump so holding W doesn't multi-fire
    const jumpHeld = !!(this._keys['KeyW'] || this._keys['ArrowUp'] || this._keys['Space']);
    this.impulse.jump = jumpHeld && !this._jumpHeld;
    this._jumpHeld = jumpHeld;
  }
}
