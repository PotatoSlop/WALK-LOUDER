import { AudioEngine } from './audio/AudioEngine.js';
import { Calibrator } from './audio/Calibrator.js';
import { KeywordDetector } from './audio/KeywordDetector.js';
import { InputManager } from './input/InputManager.js';
import { Player } from './game/Player.js';
import { World } from './game/World.js';
import { DebugOverlay } from './render/DebugOverlay.js';

// ─── Canvas setup ────────────────────────────────────────────────────────────
// Internal low-res resolution — scaled up for pixelated retro look
const INTERNAL_W = 640;
const INTERNAL_H = 360;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = INTERNAL_W;
canvas.height = INTERNAL_H;

function applyScale() {
  const scale = Math.min(
    window.innerWidth / INTERNAL_W,
    window.innerHeight / INTERNAL_H
  );
  canvas.style.width  = `${INTERNAL_W * scale}px`;
  canvas.style.height = `${INTERNAL_H * scale}px`;
}
applyScale();
window.addEventListener('resize', applyScale);

// ─── Globals ─────────────────────────────────────────────────────────────────
let audio    = null;
let keywords = null;
let input    = null;
let player   = null;
let world    = null;
let overlay  = null;

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function bootstrap() {
  drawTitle('WALK LOUDER', 'press ENTER to start');
  await waitForKey('Enter');

  // 1. Mic access
  status('requesting mic...');
  audio = new AudioEngine();
  try {
    await audio.init();
  } catch {
    status('MIC DENIED — allow mic and reload', '#ff3333');
    return;
  }

  // 2. Create overlay early so calibration messages render live
  overlay = new DebugOverlay(ctx, audio, null);
  startRenderLoop();

  // 3. Auto-calibrate
  const cal = new Calibrator(audio);
  cal.onStateChange = (_state, msg) => overlay.setStatus(msg);
  await cal.run();

  // 4. Load TF.js speech-commands model (keyboard fallback if it fails/times out)
  overlay.setStatus('loading voice model...');
  input = new InputManager();
  keywords = new KeywordDetector();
  let voiceAvailable = false;
  try {
    await keywords.init();
    overlay.kwd = keywords;
    keywords.on('left',  () => { const m = audio.peakVolume; input.onKeyword('left',  m); overlay?.notifyKeyword('left',  m); });
    keywords.on('right', () => { const m = audio.peakVolume; input.onKeyword('right', m); overlay?.notifyKeyword('right', m); });
    keywords.on('up',    () => { const m = audio.peakVolume; input.onKeyword('up',    m); overlay?.notifyKeyword('up',    m); });
    keywords.on('down',  () => { const m = audio.peakVolume; input.onKeyword('down',  m); overlay?.notifyKeyword('down',  m); });
    keywords.start();
    voiceAvailable = true;
  } catch (err) {
    console.warn('[kwd] voice model unavailable:', err.message);
    input.setMode('keyboard');
    overlay.setStatus('voice unavailable — keyboard mode (WASD)');
  }

  // 6. Build world and spawn player
  world  = new World(INTERNAL_W, INTERNAL_H);
  player = new Player(40, INTERNAL_H - 18 - 24);

  overlay.setStatus(voiceAvailable ? 'ready — speak to play' : 'WASD to move  |  K = voice when ready');
}

// ─── Render loop ─────────────────────────────────────────────────────────────
let _loopStarted = false;

function startRenderLoop() {
  if (_loopStarted) return;
  _loopStarted = true;
  loop();
}

function loop() {
  requestAnimationFrame(loop);

  // Update
  if (input && player && world) {
    input.update(audio);
    player.update(input, world);

    if (player.dead) {
      player.x = 40;
      player.y = INTERNAL_H - 18 - 24;
      player.vx = 0;
      player.vy = 0;
      player.dead = false;
    }
  }

  // Clear
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);

  // World + player
  world?.draw(ctx);
  player?.draw(ctx);

  // Scanlines on top for CRT feel
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < INTERNAL_H; y += 2) {
    ctx.fillRect(0, y, INTERNAL_W, 1);
  }

  overlay?.draw(INTERNAL_W);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function drawTitle(line1, line2 = '') {
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#33ff33';
  ctx.font = '22px VT323, monospace';
  ctx.fillText(line1, INTERNAL_W / 2, INTERNAL_H / 2 - 12);
  if (line2) {
    ctx.fillStyle = '#555';
    ctx.font = '12px VT323, monospace';
    ctx.fillText(line2, INTERNAL_W / 2, INTERNAL_H / 2 + 10);
  }
  ctx.textAlign = 'left';
}

function status(msg, color = '#33ff33') {
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.font = '13px VT323, monospace';
  ctx.fillText(msg, INTERNAL_W / 2, INTERNAL_H / 2);
  ctx.textAlign = 'left';
}

function waitForKey(key) {
  return new Promise(resolve => {
    const handler = e => {
      if (e.key === key) {
        window.removeEventListener('keydown', handler);
        resolve();
      }
    };
    window.addEventListener('keydown', handler);
  });
}

window.addEventListener('keydown', e => {
  if ((e.key === 'd' || e.key === 'D') && overlay) overlay.toggle();
  // K — toggle keyboard / voice mode
  if ((e.key === 'k' || e.key === 'K') && input) {
    const next = input.mode === 'voice' ? 'keyboard' : 'voice';
    input.setMode(next);
    overlay?.setStatus(`mode: ${next}`);
  }
});

bootstrap();
