const W      = 210;
const H      = 110;
const PAD    = 10;
const BAR_H  = 14;
const KWD_TTL = 1500; // ms to show detected word before clearing

export class DebugOverlay {
  constructor(ctx, audioEngine, keywordDetector) {
    this.ctx   = ctx;
    this.audio = audioEngine;
    this.kwd   = keywordDetector;
    this.visible    = true;
    this.statusMsg  = '';
    this._kwdWord   = null;
    this._kwdAt     = 0;   // timestamp of last detection
    this._kwdMag    = 0;   // magnitude used for last impulse
  }

  toggle() { this.visible = !this.visible; }
  setStatus(msg) { this.statusMsg = msg; }

  // Call this from main.js whenever a keyword fires
  notifyKeyword(word, mag) {
    this._kwdWord = word.toUpperCase();
    this._kwdAt   = Date.now();
    this._kwdMag  = mag;
  }

  draw(canvasW) {
    if (!this.visible) return;
    const { ctx } = this;
    const x = canvasW - W - PAD;
    const y = PAD;

    // Panel
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(x, y, W, H);
    ctx.strokeStyle = '#33ff33';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, W - 1, H - 1);

    ctx.font = '11px press-start-2p-regular, monospace';
    ctx.textBaseline = 'top';

    const lx = x + PAD;
    let   ly = y + PAD;

    // ── Volume bar ──────────────────────────────────────────────────────────
    const rawRMS = this.audio?.rawRMS      ?? 0;
    const floor  = this.audio?.noiseFloor  ?? 0.01;
    const peak   = this.audio?.peakCeiling ?? 0.25;
    const vol    = this.audio?.volume      ?? 0;
    const peakV  = this.audio?.peakVolume  ?? 0;
    const barW   = W - PAD * 2;
    const scale  = peak * 1.15;
    const toX    = v => Math.min(barW, (v / scale) * barW);

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(lx, ly, barW, BAR_H);

    // Noise floor zone tint
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(lx, ly, toX(floor), BAR_H);

    // Signal fill
    const barColor = vol > 0.8 ? '#ff3333' : vol > 0.5 ? '#fffb00' : '#33ff33';
    ctx.fillStyle = barColor;
    ctx.fillRect(lx, ly, toX(rawRMS), BAR_H);

    // Noise floor marker
    ctx.strokeStyle = '#ff8800';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lx + toX(floor), ly); ctx.lineTo(lx + toX(floor), ly + BAR_H); ctx.stroke();

    // Peak ceiling marker
    ctx.strokeStyle = '#ff3333';
    ctx.beginPath(); ctx.moveTo(lx + toX(peak), ly); ctx.lineTo(lx + toX(peak), ly + BAR_H); ctx.stroke();

    // Decaying peak marker (white tick)
    const peakBarX = Math.min(lx + barW, lx + toX(peakV * scale));
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.moveTo(peakBarX, ly); ctx.lineTo(peakBarX, ly + BAR_H); ctx.stroke();

    ly += BAR_H + 3;

    // VOL + PK text
    ctx.fillStyle = '#33ff33';
    ctx.fillText(`VOL ${String(Math.round(vol * 100)).padStart(3, ' ')}%  PK ${String(Math.round(peakV * 100)).padStart(3, ' ')}%`, lx, ly);
    ly += 14;

    // ── KWD — shown for KWD_TTL ms then hidden ──────────────────────────────
    const elapsed = Date.now() - this._kwdAt;
    if (this._kwdWord && elapsed < KWD_TTL) {
      const alpha = 1 - (elapsed / KWD_TTL); // fade out
      const mag   = Math.round(this._kwdMag * 100);
      ctx.fillStyle = `rgba(255,255,51,${alpha.toFixed(2)})`;
      ctx.fillText(`KWD  ${this._kwdWord.padEnd(6, ' ')}  ${String(mag).padStart(3, ' ')}%`, lx, ly);
    }
    ly += 14;

    // ── Status message ───────────────────────────────────────────────────────
    if (this.statusMsg) {
      ctx.fillStyle = '#fffb00';
      ctx.fillText(this.statusMsg, lx, ly);
    }

    ctx.fillStyle = '#333';
    ctx.fillText('[D] toggle debug', lx, y + H - 13);
  }
}
