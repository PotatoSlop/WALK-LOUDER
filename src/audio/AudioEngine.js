const FFT_SIZE = 256;
const SMOOTHING = 0.5;
const JUMP_SPIKE_THRESHOLD = 0.35; // normalized volume rise in one frame to trigger jump

export class AudioEngine {
  constructor() {
    this.context = null;
    this.stream = null; // Device stream
    this.analyser = null;
    this.dataBuffer = null;
    this.volume = 0;          // normalized 0.0–1.0 after calibration
    this.rawRMS = 0;          // used by Calibrator
    this.peakVolume = 0;      // recent peak — decays over ~600ms, use this for word magnitude
    this.jumpTriggered = false;
    this._prevVolume = 0;
    this._running = false;
    this._rafId = null;

    this.noiseFloor = 0.01;
    this.peakCeiling = 0.25;
  }

  async init() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.context = new AudioContext();

    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = SMOOTHING;
    source.connect(this.analyser);

    this.dataBuffer = new Float32Array(this.analyser.fftSize);
    this._running = true;
    this._tick();
  }

  _tick() {
    if (!this._running) return;
    this.analyser.getFloatTimeDomainData(this.dataBuffer);

    let sum = 0;
    for (let i = 0; i < this.dataBuffer.length; i++) {
      sum += this.dataBuffer[i] * this.dataBuffer[i];
    }
    this.rawRMS = Math.sqrt(sum / this.dataBuffer.length);

    const normalized = (this.rawRMS - this.noiseFloor) / (this.peakCeiling - this.noiseFloor);
    this.volume = Math.max(0, Math.min(1, normalized));

    this.jumpTriggered = (this.volume - this._prevVolume) > JUMP_SPIKE_THRESHOLD;
    this._prevVolume = this.volume;

    // Decaying peak: rises instantly, decays at ~0.99/frame (~3s to zero at 60fps)
    // Slow decay so Web Speech API network latency doesn't drain the magnitude
    this.peakVolume = Math.max(this.volume, this.peakVolume * 0.99);

    this._rafId = requestAnimationFrame(() => this._tick());
  }

  setCalibration(noiseFloor, peakCeiling) {
    this.noiseFloor = noiseFloor;
    this.peakCeiling = peakCeiling;
  }

  destroy() {
    this._running = false;
    cancelAnimationFrame(this._rafId);
    this.stream?.getTracks().forEach(t => t.stop());
    this.context?.close();
  }
}
