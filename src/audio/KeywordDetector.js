// Web Speech API — Chrome only, requires internet (audio sent to Google).
//
// Fires one impulse per word occurrence as it appears in interim transcripts.
// Each result index is tracked independently so finalized words never re-fire.
// "left left left" in one utterance = three impulses.

const GAME_WORDS = new Set(['left', 'right', 'up', 'down']);
const CONFIDENCE_THRESHOLD = 0.6; // only used on final results (interim confidence is always 0)

export class KeywordDetector {
  constructor() {
    this._recognition  = null;
    this._listeners    = {};
    this._active       = false;
    this._lastWord     = null;
    // Map<resultIndex, Map<word, firedCount>> — tracks what we've already fired
    this._firedCounts  = new Map();
  }

  async init() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error('SpeechRecognition not available — requires Chrome');

    const r = new SR();
    r.continuous     = true;
    r.interimResults = true;
    r.lang           = 'en-US';
    r.maxAlternatives = 1;

    r.onresult = (event) => {
      const idx     = event.results.length - 1;
      const result  = event.results[idx];
      const isFinal = result.isFinal;
      const conf    = result[0].confidence; // only reliable on final results
      const words   = result[0].transcript.toLowerCase().trim().split(/\s+/);

      // Skip final results below confidence threshold
      if (isFinal && conf > 0 && conf < CONFIDENCE_THRESHOLD) {
        this._firedCounts.delete(idx);
        return;
      }

      if (!this._firedCounts.has(idx)) this._firedCounts.set(idx, new Map());
      const fired = this._firedCounts.get(idx);

      for (const word of GAME_WORDS) {
        const currCount = words.filter(w => w === word).length;
        const prevCount = fired.get(word) || 0;
        const delta     = currCount - prevCount;
        for (let i = 0; i < delta; i++) {
          this._lastWord = word;
          this._listeners[word]?.();
        }
        if (delta > 0) fired.set(word, currCount);
      }

      // Clean up: remove this and any older result indices once finalized
      if (isFinal) {
        for (const k of this._firedCounts.keys()) {
          if (k <= idx) this._firedCounts.delete(k);
        }
      }
    };

    r.onerror = (e) => {
      if (e.error === 'no-speech') return;
      console.warn('[kwd] error:', e.error);
      if (this._active) setTimeout(() => { try { r.start(); } catch {} }, 500);
    };

    r.onend = () => {
      this._firedCounts.clear();
      if (this._active) { try { r.start(); } catch {} }
    };

    this._recognition = r;
  }

  start() {
    this._active = true;
    this._recognition.start();
  }

  stop() {
    this._active = false;
    this._recognition?.stop();
  }

  on(word, fn)       { this._listeners[word] = fn; }
  getLastDetection() { return { word: this._lastWord, confidence: 1 }; }
}
