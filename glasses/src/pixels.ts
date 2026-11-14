import { C } from './ui.ts';

/**
 * Pixel band on the home screen: a few rows of square cells.
 * Modes: wave (default), rain, life, off. It animates for 20 s after you
 * wake the lens or press a key, then freezes to save battery.
 */
const COLS = 36;
const ROWS = 4;
const CELL = 14;
const GAP = 2;
const ACTIVE_MS = 20_000;
const FPS = 12;

let canvas: HTMLCanvasElement | null = null;
let mode: 'wave' | 'rain' | 'life' | 'off' = 'wave';
let activeUntil = 0;
let raf = 0;
let t = 0;
let life: number[] = [];
let drops: number[] = [];

const palette = [C.pink, C.orange, C.yellow, C.green, C.cyan, C.purple];

export function attachPixels(el: HTMLCanvasElement, m: typeof mode) {
  canvas = el;
  mode = m;
  el.width = COLS * (CELL + GAP);
  el.height = ROWS * (CELL + GAP);
  if (!life.length) life = Array.from({ length: COLS * ROWS }, () => (Math.random() < 0.3 ? 1 : 0));
  if (!drops.length) drops = Array.from({ length: COLS }, () => Math.random() * ROWS * 3);
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
  if (mode === 'life' && t % 3 === 0) {
    const next = life.map((v, i) => {
      const x = i % COLS, y = Math.floor(i / COLS);
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          n += life[((y + dy + ROWS) % ROWS) * COLS + ((x + dx + COLS) % COLS)];
        }
      return n === 3 || (v && n === 2) ? 1 : 0;
    });
    life = next.some(Boolean) ? next : life.map(() => (Math.random() < 0.3 ? 1 : 0));
  }
  if (mode === 'rain') drops = drops.map((d) => (d > ROWS + 4 ? -Math.random() * 6 : d + 0.35));
}

function level(x: number, y: number): number {
  if (mode === 'wave') {
    const h = (Math.sin(x * 0.35 + t * 0.25) + Math.sin(x * 0.13 - t * 0.12)) * 0.25 + 0.5; // 0..1
    const row = ROWS - 1 - y;
    return row < h * ROWS ? 0.35 + 0.65 * (row / ROWS) : 0;
  }
  if (mode === 'rain') {
    const d = drops[x] - y;
    return d >= 0 && d < 3 ? 1 - d / 3 : 0;
  }
  if (mode === 'life') return life[y * COLS + x] ? 0.9 : 0;
  return 0;
}

function draw() {
  const ctx = canvas?.getContext('2d');
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const v = mode === 'off' ? 0 : level(x, y);
      ctx.globalAlpha = v ? v : 0.08;
      ctx.fillStyle = v ? palette[Math.floor((x / COLS) * palette.length)] : C.cm;
      ctx.fillRect(x * (CELL + GAP), y * (CELL + GAP), CELL, CELL);
    }
  ctx.globalAlpha = 1;
}
