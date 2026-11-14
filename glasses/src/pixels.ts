import { C } from './ui.ts';

/**
 * Pixel band on the home screen: two little rainbow galaxies.
 *
 * Each is a vortex with spiral arms (pink → orange → yellow → green → cyan → purple outward along the
 * arm), turning in opposite directions while they drift slowly along the band. Only the bright parts
 * of the arms light up, so the band stays airy (about a third of the cells) rather than a solid block.
 * It animates for 20 s after you wake the lens or press a key, then freezes to save battery.
 */
const COLS = 64;
const ROWS = 15;
const CELL = 8;
const GAP = 1;
const ACTIVE_MS = 20_000;
const FPS = 20;

let canvas: HTMLCanvasElement | null = null;
let activeUntil = 0;
let raf = 0;
let t = 0;

const palette = [C.pink, C.orange, C.yellow, C.green, C.cyan, C.purple];

/** Two vortices: where they sit, which way they turn, how many arms. */
const vortices = [
  { x: 0.25, y: 0.5, spin: 1, arms: 2, drift: 0.9, phase: 0 },
  { x: 0.75, y: 0.5, spin: -1, arms: 2, drift: 1.3, phase: 2.1 },
];
const REACH = 22; // how far the arms reach, in cells
const LIT = 0.55; // brightness threshold: lower = denser band

/** Colour and brightness of cell (x, y) now, or null for an unlit cell. */
function cell(x: number, y: number): [string, number] | null {
  const time = t / FPS;
  let best = 0;
  let color = C.cm;
  for (const v of vortices) {
    // Centres wander a little, like eddies in a stream.
    const cx = (v.x + 0.06 * Math.sin(time * 0.35 * v.drift + v.phase)) * COLS;
    const cy = (v.y + 0.07 * Math.sin(time * 0.5 * v.drift + v.phase * 1.7)) * ROWS;
    const dx = x - cx;
    const dy = (y - cy) * 1.9; // the band is wide and short: stretch rows so the swirl looks round
    const r = Math.hypot(dx, dy);
    if (r > REACH) continue;
    const theta = Math.atan2(dy, dx);
    // Logarithmic spiral arms, rotating over time.
    const arm = v.arms * theta - 2.3 * Math.log(r + 1) * v.spin - time * 1.6 * v.spin;
    const onArm = (Math.cos(arm) + 1) / 2; // 1 on an arm, 0 between arms
    const fade = Math.max(0, 1 - r / REACH) ** 0.7;
    const core = Math.max(0, 1 - r / 2.5); // a bright little core
    const k = Math.max(onArm * fade, core);
    if (k > best) {
      best = k;
      // A rainbow wheel turning with the vortex: each arm sweeps through every colour as it curls out.
      const turn = (theta / (2 * Math.PI) + 0.5 + (r / REACH) * 0.35 * v.spin - time * 0.12 * v.spin) * palette.length;
      const idx = ((Math.floor(turn) % palette.length) + palette.length) % palette.length;
      color = core > 0.5 ? C.fg : palette[idx];
    }
  }
  if (best < LIT) return null;
  return [color, Math.min(1, 0.35 + (best - LIT) * 2.2)];
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
      t++;
      draw();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function draw() {
  const ctx = canvas?.getContext('2d');
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const c = cell(x, y);
      ctx.globalAlpha = c ? c[1] : 0.06;
      ctx.fillStyle = c ? c[0] : C.cm;
      ctx.fillRect(x * (CELL + GAP), y * (CELL + GAP), CELL, CELL);
    }
  ctx.globalAlpha = 1;
}
