import { C } from './ui.ts';

/**
 * Pixel band on the home screen: a strip of small square cells.
 * Modes: wave (water, default), rain, life, off. It animates for 20 s after you
 * wake the lens or press a key, then freezes to save battery.
 *
 * wave = a little pixel-art sea. A 1-D wave equation with walls at both ends: swells roll in from
 * alternating sides, travel across, crash into the far wall (white spray) and slosh back.
 */
const COLS = 64;
const ROWS = 9;
const CELL = 8;
const GAP = 1;
const ACTIVE_MS = 20_000;
const FPS = 20;

let canvas: HTMLCanvasElement | null = null;
let mode: 'wave' | 'rain' | 'life' | 'off' = 'wave';
let activeUntil = 0;
let raf = 0;
let t = 0;
let life: number[] = [];
let drops: number[] = [];

const palette = [C.pink, C.orange, C.yellow, C.green, C.cyan, C.purple];

// ---------- water ----------
const SEA = ROWS * 0.4; // resting water level, in rows from the bottom
let h = new Float32Array(COLS); // surface offset (rows)
let v = new Float32Array(COLS);
let spray: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
let nextSwell = 0;
let fromLeft = true;

function swell() {
  // A broad bump near one wall; the wave equation carries it across.
  const amp = 3 + Math.random() * 1.6;
  const width = 2.5 + Math.random() * 2.5;
  const at = fromLeft ? 2 : COLS - 3;
  for (let i = 0; i < COLS; i++) h[i] += amp * Math.exp(-((i - at) ** 2) / (2 * width * width));
  // Walls keep all the water in, so take back what the swell added: the sea level stays put.
  let mean = 0;
  for (let i = 0; i < COLS; i++) mean += h[i];
  mean /= COLS;
  for (let i = 0; i < COLS; i++) h[i] -= mean;
  fromLeft = !fromLeft;
  nextSwell = t + Math.round(FPS * (2.2 + Math.random() * 1.6));
}

function stepWater() {
  if (t >= nextSwell) swell();
  const K = 0.32; // wave speed² per substep
  const DAMP = 0.006;
  for (let s = 0; s < 3; s++) {
    const a = new Float32Array(COLS);
    for (let i = 0; i < COLS; i++) {
      const l = h[i === 0 ? 0 : i - 1]; // reflecting walls
      const r = h[i === COLS - 1 ? COLS - 1 : i + 1];
      a[i] = K * (l + r - 2 * h[i]) - DAMP * v[i];
    }
    for (let i = 0; i < COLS; i++) {
      v[i] += a[i];
      h[i] += v[i];
    }
  }
  // Crash: a fast, high surge hitting a wall throws spray back over the water.
  for (const [i, dir] of [[0, 1], [COLS - 1, -1]] as const) {
    if (h[i] > 1.6 && Math.abs(v[i]) > 0.15 && Math.random() < 0.9) {
      for (let k = 0; k < 4; k++)
        spray.push({ x: i, y: SEA + h[i], vx: dir * (0.3 + Math.random() * 0.9), vy: 0.4 + Math.random() * 0.6, life: 1 });
    }
  }
  // Breaking crests mid-sea throw a little foam too.
  for (let i = 1; i < COLS - 1; i++) {
    if (h[i] > 2.2 && Math.abs(h[i + 1] - h[i - 1]) > 1.1 && Math.random() < 0.1)
      spray.push({ x: i, y: SEA + h[i], vx: Math.sign(v[i - 1] - v[i + 1]) * 0.2, vy: 0.2 + Math.random() * 0.2, life: 0.8 });
  }
  spray = spray
    .map((p) => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, vy: p.vy - 0.08, life: p.life - 0.06 }))
    .filter((p) => p.life > 0 && p.x >= 0 && p.x < COLS && p.y > SEA + h[Math.max(0, Math.min(COLS - 1, Math.round(p.x)))] - 0.5)
    .slice(-120);
}

/** Water cell colour + alpha for column x, row y (0 = top). */
function water(x: number, y: number): [string, number] | null {
  const row = ROWS - 1 - y; // 0 = bottom
  // A little chop on top of the swells, so calm water still moves.
  const surface = SEA + h[x] + 0.45 * Math.sin(x * 0.55 - t * 0.35) * Math.sin(x * 0.13 + t * 0.05);
  const fx = Math.round(x);
  for (const p of spray) if (Math.round(p.x) === fx && Math.round(p.y) === row) return [C.fg, Math.min(1, 0.5 + p.life)];
  if (row > surface) return null;
  const depth = surface - row; // 0 at the surface
  const steep = Math.abs(h[Math.min(COLS - 1, x + 1)] - h[Math.max(0, x - 1)]);
  // Rainbow water: each column takes its colour from the Monokai rainbow (pink → purple across the band).
  const hue = palette[Math.min(palette.length - 1, Math.floor((x / COLS) * palette.length))];
  if (depth < 1) {
    // The top cell: white foam where the wave is steep or high, full colour otherwise.
    if (steep > 1.1 || h[x] > 2.3) return [C.fg, 0.95];
    return [hue, 0.95];
  }
  if (depth < 2.2) return [hue, 0.6];
  // Deeper water: the same colour, darker, with a slow shimmer so it doesn't look flat.
  const shimmer = 0.08 * Math.sin(x * 0.7 + row * 1.3 + t * 0.15);
  return [hue, Math.max(0.15, 0.36 - depth * 0.04 + shimmer)];
}

export function attachPixels(el: HTMLCanvasElement, m: typeof mode) {
  canvas = el;
  mode = m;
  el.width = COLS * (CELL + GAP) - GAP;
  el.height = ROWS * (CELL + GAP) - GAP;
  if (!life.length) life = Array.from({ length: COLS * ROWS }, () => (Math.random() < 0.3 ? 1 : 0));
  if (!drops.length) drops = Array.from({ length: COLS }, () => Math.random() * ROWS * 3);
  if (t === 0) swell();
  draw();
  wake();
}

export function wake() {
  activeUntil = performance.now() + ACTIVE_MS;
  if (!raf) loop();
}

function loop() {
  let last = 0;
  const tick = (ts: number) => {
    if (!canvas?.isConnected || mode === 'off' || ts > activeUntil) {
      raf = 0;
      return;
    }
    if (ts - last > 1000 / FPS) {
      last = ts;
      t++;
      step();
      draw();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function step() {
  if (mode === 'wave') stepWater();
  if (mode === 'life' && t % 5 === 0) {
    const next = life.map((val, i) => {
      const x = i % COLS, y = Math.floor(i / COLS);
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          n += life[((y + dy + ROWS) % ROWS) * COLS + ((x + dx + COLS) % COLS)];
        }
      return n === 3 || (val && n === 2) ? 1 : 0;
    });
    life = next.some(Boolean) ? next : life.map(() => (Math.random() < 0.3 ? 1 : 0));
  }
  if (mode === 'rain') drops = drops.map((d) => (d > ROWS + 4 ? -Math.random() * 8 : d + 0.3));
}

function cell(x: number, y: number): [string, number] | null {
  if (mode === 'wave') return water(x, y);
  if (mode === 'rain') {
    const d = drops[x] - y;
    return d >= 0 && d < 3 ? [palette[Math.floor((x / COLS) * palette.length)], 1 - d / 3] : null;
  }
  if (mode === 'life') return life[y * COLS + x] ? [palette[Math.floor((x / COLS) * palette.length)], 0.9] : null;
  return null;
}

function draw() {
  const ctx = canvas?.getContext('2d');
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const c = mode === 'off' ? null : cell(x, y);
      ctx.globalAlpha = c ? c[1] : 0.07;
      ctx.fillStyle = c ? c[0] : C.cm;
      ctx.fillRect(x * (CELL + GAP), y * (CELL + GAP), CELL, CELL);
    }
  ctx.globalAlpha = 1;
}
