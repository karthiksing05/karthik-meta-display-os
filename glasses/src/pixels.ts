import { C } from './ui.ts';

/**
 * Pixel band on the home screen: mountains at sunset, seen from a slowly moving train.
 *
 * Three ranges back to front (purple peaks with snow, cyan ridges, green foothills) scroll sideways
 * at different speeds, so the near hills pass quickly and the far peaks drift by (parallax); the sun
 * slips behind the peaks and out again. The sun's stripes sink slowly and the stars twinkle.
 * Ridgelines are lit and the slopes below are dithered, so the band stays airy on the additive
 * display. It moves for 30 s after you wake the lens or press a key, then holds still to save battery;
 * the next wake carries on from where it stopped.
 */
const COLS = 64;
const ROWS = 15;
const CELL = 8;
const GAP = 1;
const ACTIVE_MS = 30_000;
const FPS = 12;

type Px = [string, number] | null; // colour, alpha
type Peak = [x: number, top: number, slope: number];

/** Tiny deterministic hash so the jagged edges look the same every time. */
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Top row of a range at world column wx: the highest of its peaks there, roughened a little.
 * The range repeats every `period` columns, so it can scroll forever.
 */
function ridge(wx: number, peaks: Peak[], period: number, seed: number): number {
  const x = ((wx % period) + period) % period;
  let top = ROWS;
  for (const [px, pt, slope] of peaks) {
    const dx = Math.abs(x - px);
    top = Math.min(top, pt + Math.min(dx, period - dx) * slope);
  }
  return Math.round(top + (hash(x + seed) - 0.5) * 0.9);
}

/** speed = columns per second; nearer ranges move faster. */
const ranges: { peaks: Peak[]; period: number; speed: number; color: string; edge: number; fill: number; seed: number; snow?: number }[] = [
  // far: tall, steep, snow on the tops
  { peaks: [[7, 1, 0.75], [19, 3, 0.85], [47, 0, 0.7], [60, 2, 0.9], [78, 2, 0.8]], period: 90, speed: 0.35, color: C.purple, edge: 0.75, fill: 0.3, seed: 1, snow: 2 },
  // middle
  { peaks: [[3, 7, 0.5], [15, 6, 0.45], [53, 6, 0.4], [72, 7, 0.5]], period: 84, speed: 0.9, color: C.cyan, edge: 0.8, fill: 0.32, seed: 40 },
  // near foothills
  { peaks: [[10, 12, 0.2], [37, 11, 0.15], [62, 12, 0.25]], period: 72, speed: 2, color: C.green, edge: 0.85, fill: 0.36, seed: 90 },
];

const SUN = { x: 33, y: 6.5, r: 4 };
const STARS = [[4, 1], [15, 0], [21, 2], [29, 1], [38, 3], [49, 0], [55, 1], [62, 2], [1, 4], [61, 5], [10, 3], [44, 2]];

let canvas: HTMLCanvasElement | null = null;
let activeUntil = 0;
let raf = 0;
let frame = 0;

function scene(time: number): Px[][] {
  const g: Px[][] = Array.from({ length: ROWS }, () => Array<Px>(COLS).fill(null));

  // Stars twinkle, each at its own pace.
  for (const [x, y] of STARS) {
    const tw = 0.5 + 0.5 * Math.sin(time * (0.8 + hash(x + y * 3) * 1.6) + hash(x * 7 + y) * 6.3);
    if (tw > 0.15) g[y][x] = [hash(x * 7 + y) > 0.5 ? C.fg : C.yellow, 0.15 + tw * 0.45];
  }

  // The sun: banded yellow → orange → pink top to bottom, with stripes that slowly sink.
  const sink = Math.floor(time * 1.2);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const d = Math.hypot(x - SUN.x, (y - SUN.y) * 1.15);
      if (d > SUN.r) continue;
      const v = (y - (SUN.y - SUN.r)) / (2 * SUN.r); // 0 top → 1 bottom
      if (v > 0.5 && (y - sink) % 2 !== 0) continue; // the stripes
      g[y][x] = [v < 0.35 ? C.yellow : v < 0.65 ? C.orange : C.pink, 0.9];
    }

  // Ranges back to front; nearer ones cover farther ones.
  for (const r of ranges) {
    const shift = Math.floor(time * r.speed);
    for (let x = 0; x < COLS; x++) {
      const wx = x + shift;
      const top = Math.max(0, ridge(wx, r.peaks, r.period, r.seed));
      for (let y = top; y < ROWS; y++) {
        const depth = y - top;
        if (depth === 0) {
          const snowy = r.snow !== undefined && top <= r.snow + 1;
          g[y][x] = [snowy ? C.fg : r.color, snowy ? 0.95 : r.edge];
        } else if (depth === 1 && r.snow !== undefined && top <= r.snow) {
          g[y][x] = [C.fg, 0.6];
        } else {
          // Dither just under the ridge, fading out: the next range shows through below.
          // It's keyed to the world column so the pattern travels with the mountain.
          const on = depth === 1 ? (wx + y) % 2 === 0 : depth === 2 ? (wx + y) % 4 === 0 : false;
          g[y][x] = on ? [r.color, r.fill * (depth === 1 ? 1.3 : 0.9)] : null;
        }
      }
    }
  }
  return g;
}

export function attachPixels(el: HTMLCanvasElement) {
  canvas = el;
  el.width = COLS * (CELL + GAP) - GAP;
  el.height = ROWS * (CELL + GAP) - GAP;
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
    if (!canvas?.isConnected || ts > activeUntil) {
      raf = 0;
      return;
    }
    if (ts - last > 1000 / FPS) {
      last = ts;
      frame++;
      draw();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function draw() {
  const ctx = canvas?.getContext('2d');
  if (!ctx || !canvas) return;
  const g = scene(frame / FPS);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const p = g[y][x];
      ctx.globalAlpha = p ? p[1] : 0.05;
      ctx.fillStyle = p ? p[0] : C.cm;
      ctx.fillRect(x * (CELL + GAP), y * (CELL + GAP), CELL, CELL);
    }
  ctx.globalAlpha = 1;
}
