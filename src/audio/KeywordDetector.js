import * as tf from '@tensorflow/tfjs';
import * as speechCommands from '@tensorflow-models/speech-commands';

const GAME_WORDS   = new Set(['left', 'right', 'up', 'down']);
const THRESHOLD    = 0.85;
const OVERLAP      = 0.999; // ~1ms window advance per step — maximum responsiveness
const COOLDOWN_MS  = 100;   // min ms between firings of the same word

export class KeywordDetector {
  constructor() {
    this._recognizer  = null;
    this._listeners   = {};
    this._active      = false;
    this._lastWord    = null;
    this._lastConf    = 0;
    this._lastFiredAt = new Map(); // word -> timestamp, for cooldown
  }

  async init() {
    await tf.setBackend('webgl');
    await tf.ready();

    this._recognizer = speechCommands.create('BROWSER_FFT');
    await this._recognizer.ensureModelLoaded();
  }

  start() {
    if (!this._recognizer) throw new Error('KeywordDetector not initialized');
    this._active = true;

    this._recognizer.listen(result => {
      if (!this._active) return;

      const scores = Array.from(result.scores);
      const labels = this._recognizer.wordLabels();

      let bestScore = 0;
      let bestWord  = null;

      for (let i = 0; i < labels.length; i++) {
        if (GAME_WORDS.has(labels[i]) && scores[i] > bestScore) {
          bestScore = scores[i];
          bestWord  = labels[i];
        }
      }

      if (bestWord && bestScore >= THRESHOLD) {
        const now = Date.now();
        if (now - (this._lastFiredAt.get(bestWord) ?? 0) >= COOLDOWN_MS) {
          this._lastFiredAt.set(bestWord, now);
          this._lastWord = bestWord;
          this._lastConf = bestScore;
          this._listeners[bestWord]?.();
        }
      }
    }, {
      overlapFactor: OVERLAP,
      probabilityThreshold: THRESHOLD,
      invokeCallbackOnNoiseAndUnknown: false,
    });
  }

  stop() {
    this._active = false;
    if (this._recognizer?.isListening()) this._recognizer.stopListening();
  }

  on(word, fn) { 
    this._listeners[word] = fn; 
  }

  getLastDetection() { 
    return { 
      word: this._lastWord, 
      confidence: this._lastConf 
    }; 
  }
}
