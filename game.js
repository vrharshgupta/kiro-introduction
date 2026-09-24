// ─── Flappy Kiro ────────────────────────────────────────────────────────────
// A Flappy Bird-style endless runner featuring Ghosty the ghost.

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

// ─── Constants ───────────────────────────────────────────────────────────────
const W = canvas.width;   // 800
const H = canvas.height;  // 600

const GRAVITY        = 0.45;
const FLAP_STRENGTH  = -9;
const PIPE_SPEED     = 3;
const PIPE_WIDTH     = 80;
const PIPE_GAP       = 180;   // vertical gap between top and bottom pipe
const PIPE_INTERVAL  = 1800;  // ms between new pipes
const SCORE_BAR_H    = 50;    // dark bar at the bottom
const GAME_H         = H - SCORE_BAR_H; // playable height

const GHOSTY_W = 48;
const GHOSTY_H = 48;
const GHOSTY_X = 160; // fixed horizontal position

// ─── Assets ──────────────────────────────────────────────────────────────────
const ghostyImg   = new Image();
ghostyImg.src     = 'assets/ghosty.png';

const jumpSound    = new Audio('assets/jump.wav');
const gameOverSound = new Audio('assets/game_over.wav');
jumpSound.volume    = 0.5;
gameOverSound.volume = 0.6;

// ─── Game State ──────────────────────────────────────────────────────────────
let state; // 'start' | 'playing' | 'dead'
let score, highScore;
let ghosty;
let pipes;
let clouds;
let lastPipeTime;
let animFrame;
let lastTime;
let bgScratch; // pre-rendered scratchy background

// ─── Sketchy background helper ───────────────────────────────────────────────
// Draws rough diagonal hatch lines over a solid colour to mimic the
// hand-drawn look in the reference screenshot.
function buildBackground() {
  const offscreen = document.createElement('canvas');
  offscreen.width  = W;
  offscreen.height = GAME_H;
  const oc = offscreen.getContext('2d');

  // Base sky colour
  oc.fillStyle = '#8ecae6';
  oc.fillRect(0, 0, W, GAME_H);

  // Slightly varied tint patches
  const rng = seededRng(42);
  for (let i = 0; i < 60; i++) {
    const px = rng() * W;
    const py = rng() * GAME_H;
    const pw = 60 + rng() * 120;
    const ph = 40 + rng() * 80;
    oc.fillStyle = `rgba(100,160,200,${0.08 + rng() * 0.12})`;
    oc.beginPath();
    oc.ellipse(px, py, pw, ph, rng() * Math.PI, 0, Math.PI * 2);
    oc.fill();
  }

  // Pencil hatch strokes
  oc.strokeStyle = 'rgba(70,120,170,0.18)';
  oc.lineWidth   = 1;
  for (let i = 0; i < 200; i++) {
    const sx = rng() * W * 1.4 - W * 0.2;
    const sy = rng() * GAME_H * 1.4 - GAME_H * 0.2;
    const len = 30 + rng() * 90;
    oc.beginPath();
    oc.moveTo(sx, sy);
    oc.lineTo(sx + len * 0.7, sy + len);
    oc.stroke();
  }

  return offscreen;
}

// Simple seeded pseudo-random (mulberry32) for deterministic bg
function seededRng(seed) {
  let s = seed;
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ─── Cloud ───────────────────────────────────────────────────────────────────
function createCloud(x) {
  const rng = seededRng(x | 0);
  return {
    x,
    y   : 40 + rng() * (GAME_H - 120),
    w   : 90 + rng() * 80,
    h   : 40 + rng() * 30,
    speed: 0.6 + rng() * 0.8,
  };
}

function drawCloud(c) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.shadowColor = 'rgba(180,220,255,0.5)';
  ctx.shadowBlur  = 8;
  ctx.beginPath();
  // rounded rectangle cloud shape
  const r = c.h * 0.42;
  ctx.moveTo(c.x + r, c.y);
  ctx.lineTo(c.x + c.w - r, c.y);
  ctx.quadraticCurveTo(c.x + c.w, c.y, c.x + c.w, c.y + r);
  ctx.lineTo(c.x + c.w, c.y + c.h - r);
  ctx.quadraticCurveTo(c.x + c.w, c.y + c.h, c.x + c.w - r, c.y + c.h);
  ctx.lineTo(c.x + r, c.y + c.h);
  ctx.quadraticCurveTo(c.x, c.y + c.h, c.x, c.y + c.h - r);
  ctx.lineTo(c.x, c.y + r);
  ctx.quadraticCurveTo(c.x, c.y, c.x + r, c.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ─── Pipe ────────────────────────────────────────────────────────────────────
function createPipe(x) {
  // gapTop = y coordinate where the gap starts (top of bottom pipe)
  const minGapTop = 60;
  const maxGapTop = GAME_H - PIPE_GAP - 60;
  const gapTop = minGapTop + Math.random() * (maxGapTop - minGapTop);
  return { x, gapTop, scored: false };
}

// Draw one pipe (top or bottom) with a darker cap
function drawPipeSegment(x, y, w, h) {
  if (h <= 0) return;

  // Pipe body gradient (green)
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0,   '#2d6a1f');
  grad.addColorStop(0.3, '#4caf2f');
  grad.addColorStop(0.7, '#3a8a22');
  grad.addColorStop(1,   '#1e4a14');
  ctx.fillStyle = grad;
  ctx.fillRect(x + 6, y, w - 12, h);

  // Pipe cap (wider, darker)
  const capH = 24;
  const capX = x;
  const capY = (y === 0) ? y + h - capH : y; // cap at the open end
  const capGrad = ctx.createLinearGradient(capX, 0, capX + w, 0);
  capGrad.addColorStop(0,   '#1e4a14');
  capGrad.addColorStop(0.3, '#3a8a22');
  capGrad.addColorStop(0.7, '#2d6a1f');
  capGrad.addColorStop(1,   '#163810');
  ctx.fillStyle = capGrad;
  ctx.fillRect(capX, capY, w, capH);

  // Highlight sheen on body
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x + 10, y, 10, h);
}

function drawPipe(pipe) {
  const topH    = pipe.gapTop;                        // top pipe height
  const botY    = pipe.gapTop + PIPE_GAP;             // bottom pipe start y
  const botH    = GAME_H - botY;                      // bottom pipe height

  // top pipe (hangs from top)
  drawPipeSegment(pipe.x, 0, PIPE_WIDTH, topH);
  // bottom pipe (rises from bottom)
  drawPipeSegment(pipe.x, botY, PIPE_WIDTH, botH);
}

// ─── Ghosty ───────────────────────────────────────────────────────────────────
function createGhosty() {
  return {
    x  : GHOSTY_X,
    y  : GAME_H / 2 - GHOSTY_H / 2,
    vy : 0,
    rotation: 0,
    alive: true,
  };
}

function flapGhosty() {
  ghosty.vy = FLAP_STRENGTH;
  // reset and replay each time (handles rapid clicks)
  jumpSound.currentTime = 0;
  jumpSound.play().catch(() => {});
}

function updateGhosty(dt) {
  ghosty.vy       += GRAVITY;
  ghosty.y        += ghosty.vy;
  // tilt: nose up when rising, nose down when falling
  ghosty.rotation  = Math.max(-25, Math.min(45, ghosty.vy * 3));
}

function drawGhosty() {
  ctx.save();
  const cx = ghosty.x + GHOSTY_W / 2;
  const cy = ghosty.y + GHOSTY_H / 2;
  ctx.translate(cx, cy);
  ctx.rotate((ghosty.rotation * Math.PI) / 180);

  if (ghostyImg.complete && ghostyImg.naturalWidth > 0) {
    ctx.drawImage(ghostyImg, -GHOSTY_W / 2, -GHOSTY_H / 2, GHOSTY_W, GHOSTY_H);
  } else {
    // fallback ghost shape
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(0, -6, 14, Math.PI, 0, false);
    ctx.lineTo(14, 10);
    ctx.lineTo(7, 5);
    ctx.lineTo(0, 10);
    ctx.lineTo(-7, 5);
    ctx.lineTo(-14, 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(-5, -6, 3, 0, Math.PI * 2);
    ctx.arc(5, -6, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ─── Collision detection ──────────────────────────────────────────────────────
function checkCollision() {
  // Ceiling / floor
  if (ghosty.y <= 0 || ghosty.y + GHOSTY_H >= GAME_H) return true;

  // Shrink hit-box slightly for fair feel (8px inset on each side)
  const hbx1 = ghosty.x + 8;
  const hby1 = ghosty.y + 8;
  const hbx2 = ghosty.x + GHOSTY_W - 8;
  const hby2 = ghosty.y + GHOSTY_H - 8;

  for (const pipe of pipes) {
    const px1 = pipe.x;
    const px2 = pipe.x + PIPE_WIDTH;

    if (hbx2 < px1 || hbx1 > px2) continue; // no horizontal overlap

    // Top pipe: y = 0 to gapTop
    if (hby1 < pipe.gapTop) return true;
    // Bottom pipe: y = gapTop + gap to GAME_H
    if (hby2 > pipe.gapTop + PIPE_GAP) return true;
  }
  return false;
}

// ─── Score bar ───────────────────────────────────────────────────────────────
function drawScoreBar() {
  // dark bar
  ctx.fillStyle = '#222831';
  ctx.fillRect(0, GAME_H, W, SCORE_BAR_H);

  // subtle top border
  ctx.fillStyle = '#444';
  ctx.fillRect(0, GAME_H, W, 2);

  ctx.fillStyle = '#ffffff';
  ctx.font      = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Score: ${score}  |  High: ${highScore}`, W / 2, GAME_H + SCORE_BAR_H / 2);
}

// ─── Overlay screens ─────────────────────────────────────────────────────────
function drawStartScreen() {
  // semi-transparent overlay
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, W, GAME_H);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // Title
  ctx.fillStyle = '#fff';
  ctx.font      = 'bold 52px Arial';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur  = 10;
  ctx.fillText('Flappy Kiro', W / 2, GAME_H / 2 - 80);

  ctx.shadowBlur = 0;

  // Ghost sprite centred in card
  if (ghostyImg.complete && ghostyImg.naturalWidth > 0) {
    ctx.drawImage(ghostyImg, W / 2 - 32, GAME_H / 2 - 32, 64, 64);
  }

  ctx.fillStyle = '#ffe066';
  ctx.font      = 'bold 24px Arial';
  ctx.fillText('Press SPACE or tap to start', W / 2, GAME_H / 2 + 60);

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font      = '18px Arial';
  ctx.fillText('SPACE / Click to flap', W / 2, GAME_H / 2 + 100);
}

function drawDeadScreen() {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, W, GAME_H);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#ff6b6b';
  ctx.font      = 'bold 52px Arial';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur  = 12;
  ctx.fillText('Game Over!', W / 2, GAME_H / 2 - 70);

  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.font      = 'bold 28px Arial';
  ctx.fillText(`Score: ${score}`, W / 2, GAME_H / 2 - 15);

  ctx.fillStyle = '#ffe066';
  ctx.font      = 'bold 24px Arial';
  ctx.fillText(`Best: ${highScore}`, W / 2, GAME_H / 2 + 25);

  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font      = '20px Arial';
  ctx.fillText('Press SPACE or tap to retry', W / 2, GAME_H / 2 + 75);
}

// ─── Init / Reset ─────────────────────────────────────────────────────────────
function init() {
  score        = 0;
  highScore    = highScore || 0;
  ghosty       = createGhosty();
  pipes        = [];
  lastPipeTime = 0;

  // Seed some clouds spread across the screen
  clouds = [];
  for (let i = 0; i < 6; i++) {
    clouds.push(createCloud(60 + i * (W / 5) + Math.random() * 80));
  }
}

// ─── Main loop ───────────────────────────────────────────────────────────────
function loop(timestamp) {
  const dt = lastTime ? timestamp - lastTime : 16;
  lastTime = timestamp;

  // ── Update ──
  if (state === 'playing') {
    updateGhosty(dt);

    // Spawn pipes
    if (timestamp - lastPipeTime > PIPE_INTERVAL) {
      pipes.push(createPipe(W + 10));
      lastPipeTime = timestamp;
    }

    // Move pipes & score
    for (const pipe of pipes) {
      pipe.x -= PIPE_SPEED;
      if (!pipe.scored && pipe.x + PIPE_WIDTH < GHOSTY_X) {
        pipe.scored = true;
        score++;
        if (score > highScore) highScore = score;
      }
    }
    pipes = pipes.filter(p => p.x + PIPE_WIDTH > -10);

    // Move clouds
    for (const cloud of clouds) {
      cloud.x -= cloud.speed;
      if (cloud.x + cloud.w < 0) {
        cloud.x = W + 20;
        cloud.y = 40 + Math.random() * (GAME_H - 120);
      }
    }

    // Collision
    if (checkCollision()) {
      state = 'dead';
      ghosty.alive = false;
      gameOverSound.currentTime = 0;
      gameOverSound.play().catch(() => {});
    }
  }

  // ── Draw ──
  // Background
  ctx.drawImage(bgScratch, 0, 0);

  // Clouds (behind pipes)
  for (const cloud of clouds) drawCloud(cloud);

  // Pipes
  for (const pipe of pipes) drawPipe(pipe);

  // Ghosty
  drawGhosty();

  // Score bar (always)
  drawScoreBar();

  // Overlays
  if (state === 'start') drawStartScreen();
  if (state === 'dead')  drawDeadScreen();

  animFrame = requestAnimationFrame(loop);
}

// ─── Input ───────────────────────────────────────────────────────────────────
function handleInput() {
  if (state === 'start') {
    state = 'playing';
    lastPipeTime = performance.now(); // give the player a moment before first pipe
    return;
  }
  if (state === 'dead') {
    init();
    state = 'playing';
    lastPipeTime = performance.now();
    lastTime = 0;
    return;
  }
  if (state === 'playing') {
    flapGhosty();
  }
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    handleInput();
  }
});

canvas.addEventListener('click', handleInput);
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  handleInput();
}, { passive: false });

// ─── Bootstrap ───────────────────────────────────────────────────────────────
function start() {
  bgScratch = buildBackground();
  highScore = 0;
  state     = 'start';
  init();
  lastTime  = 0;
  animFrame = requestAnimationFrame(loop);
}

// Wait for ghosty image to load (or proceed immediately if already cached)
if (ghostyImg.complete) {
  start();
} else {
  ghostyImg.onload  = start;
  ghostyImg.onerror = start; // start anyway with fallback ghost
}
