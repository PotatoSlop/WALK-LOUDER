const PHASE_MS = 3000;
const TICK_MS = 16; // ~60 samples/sec

export class Calibrator {
  constructor(audioEngine) {
    this.audio = audioEngine;
    this.state = 'idle';
    this.onStateChange = null; // (state, message) => void
  }

  async run() {
    this._set('noise', 'be quiet (3s)');
    const floor = await this._sample(PHASE_MS, 'max');

    this._set('peak', 'TALK LOUD (3s)');
    const peak = await this._sample(PHASE_MS, 'max');

    // If peak isn't meaningfully above floor, fall back to safe defaults
    const noiseFloor = floor * 1.2;
    const peakCeiling = peak > noiseFloor * 2 ? peak * 0.9 : 0.25;

    this.audio.setCalibration(noiseFloor, peakCeiling);
    this._set('done', `Calibrated — floor: ${noiseFloor.toFixed(3)} peak: ${peakCeiling.toFixed(3)}`);
  }

  _sample(durationMs, mode) {
    return new Promise(resolve => {
      const samples = [];
      const count = Math.floor(durationMs / TICK_MS);
      let i = 0;

      const id = setInterval(() => {
        samples.push(this.audio.rawRMS);
        if (++i >= count) {
          clearInterval(id);
          const val = mode === 'max'
            ? Math.max(...samples)
            : samples.reduce((a, b) => a + b, 0) / samples.length;
          resolve(val);
        }
      }, TICK_MS);
    });
  }

  _set(state, message) {
    this.state = state;
    this.onStateChange?.(state, message);
  }
}
