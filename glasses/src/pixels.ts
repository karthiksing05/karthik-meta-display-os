import { C } from './ui.ts';

/**
 * Pixel band on the home screen: a still mountain scene at dusk.
 *
 * Three ranges back to front (purple peaks with snow, cyan ridges, green foothills) under a setting
 * sun and a few stars. Ridgelines are lit; the slopes below them are dithered, so the band stays
 * airy on the additive display instead of a solid block. It's drawn once and never animates, so it
 * costs no battery.
 */
const COLS = 64;
const ROWS = 15;
const CELL = 8;
const GAP = 1;

type Px = [string, number] | null; // colour, alpha
type Peak = [x: number, top: number, slope: number];

/** Tiny deterministic hash so the jagged edges look the same every time. */
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Top row of a range at column x: the highest of its peaks there, roughened a little. */
function ridge(x: number, peaks: Peak[], seed: number): number {
  let top = ROWS;
  for (const [px, pt, slope] of peaks) top = Math.min(top, pt + Math.abs(x - px) * slope);
  return Math.round(top + (hash(x + seed) - 0.5) * 0.9);
}

const ranges: { peaks: Peak[]; color: string; edge: number; fill: number; seed: number; snow?: number }[] = [
  // far: tall, steep, snow on the tops
  { peaks: [[7, 1, 0.75], [19, 3, 0.85], [47, 0, 0.7], [60, 2, 0.9]], color: C.purple, edge: 0.75, fill: 0.3, seed: 1, snow: 2 },
  // middle
  { peaks: [[3, 7, 0.5], [15, 6, 0.45], [53, 6, 0.4], [64, 8, 0.5]], color: C.cyan, edge: 0.8, fill: 0.32, seed: 40 },
  // near foothills
  { peaks: [[10, 12, 0.2], [37, 11, 0.15], [62, 12, 0.25]], color: C.green, edge: 0.85, fill: 0.36, seed: 90 },
];

const SUN = { x: 33, y: 6.5, r: 4 };
const STARS = [[4, 1], [15, 0], [21, 2], [29, 1], [38, 3], [49, 0], [55, 1], [62, 2], [1, 4], [61, 5]];

function scene(): Px[][] {
  const g: Px[][] = Array.from({ length: ROWS }, () => Array<Px>(COLS).fill(null));

  for (const [x, y] of STARS) g[y][x] = [hash(x * 7 + y) > 0.5 ? C.fg : C.yellow, 0.45];

  // The sun: banded yellow → orange → pink top to bottom, with gaps like a retro sunset.
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const d = Math.hypot(x - SUN.x, (y - SUN.y) * 1.15);
      if (d > SUN.r) continue;
      const v = (y - (SUN.y - SUN.r)) / (2 * SUN.r); // 0 top → 1 bottom
      if (v > 0.55 && Math.floor(y) % 2 === 1) continue; // the stripes
      g[y][x] = [v < 0.35 ? C.yellow : v < 0.65 ? C.orange : C.pink, 0.9];
    }

  // Ranges back to front; nearer ones cover farther ones.
  for (const r of ranges)
    for (let x = 0; x < COLS; x++) {
      const top = Math.max(0, ridge(x, r.peaks, r.seed));
      for (let y = top; y < ROWS; y++) {
        const depth = y - top;
        if (depth === 0) {
          const snowy = r.snow !== undefined && top <= r.snow + 1;
          g[y][x] = [snowy ? C.fg : r.color, snowy ? 0.95 : r.edge];
        } else if (depth === 1 && r.snow !== undefined && top <= r.snow) {
          g[y][x] = [C.fg, 0.6];
        } else {
          // Dither just under the ridge, fading out: the next range shows through below.
          const on = depth === 1 ? (x + y) % 2 === 0 : depth === 2 ? (x + y) % 4 === 0 : false;
          g[y][x] = on ? [r.color, r.fill * (depth === 1 ? 1.3 : 0.9)] : null;
        }
      }
    }
  return g;
}

export function attachPixels(el: HTMLCanvasElement) {
  el.width = COLS * (CELL + GAP) - GAP;
  el.height = ROWS * (CELL + GAP) - GAP;
  const ctx = el.getContext('2d');
  if (!ctx) return;
  const g = scene();
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const p = g[y][x];
      ctx.globalAlpha = p ? p[1] : 0.05;
      ctx.fillStyle = p ? p[0] : C.cm;
      ctx.fillRect(x * (CELL + GAP), y * (CELL + GAP), CELL, CELL);
    }
  ctx.globalAlpha = 1;
}

/** Kept for main.ts: the scene is static, so waking does nothing. */
export function wake() {}
