import { C } from './ui.ts';

/**
 * Pixel band on the home screen: mountains at sunset, seen from a slowly moving train, with a river
 * rushing along the bottom (white and grey foam, the odd rainbow fleck).
 *
 * The scenery is pixel art (a 143×34 grid of 3 px dots), but it moves smoothly: each range is drawn
 * once into its own strip and slid sideways by fractional pixels, the near foothills fastest and the
 * snowy far peaks slowest (parallax). The sun sits still behind them, its stripes sinking slowly, and
 * the stars twinkle. Nearer ranges hide whatever is behind them, so the dithered slopes stay airy on
 * the additive display without the far range showing through.
 *
 * It moves for 30 s after you wake the lens or press a key, then holds still to save battery; the
 * next wake carries on from where it stopped.
 */
const COLS = 143; // 571 px: fits the 600 px lens inside the 14 px margins
const ROWS = 34;
const PITCH = 4; // px per grid cell
const DOT = 3; // px of it that's lit (the rest is the gap that makes it look like pixels)
const S = 2.25; // grid cells per scene unit: the scene is laid out on a 64 × 15 unit band
const ACTIVE_MS = 30_000;
const W = COLS * PITCH - (PITCH - DOT);
const H = ROWS * PITCH - (PITCH - DOT);

type Peak = [x: number, top: number, slope: number]; // in scene units

/** Tiny deterministic hash so the jagged edges look the same every time. */
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** Smooth 1-D value noise: rough ridgelines without single-cell spikes. */
const noise = (x: number, seed: number) => {
  const i = Math.floor(x);
  const f = x - i;
  const k = f * f * (3 - 2 * f);
  return hash(i + seed) * (1 - k) + hash(i + 1 + seed) * k;
};

/** speed in scene units per second; period = how often the range repeats, in scene units. */
const ranges: { peaks: Peak[]; period: number; speed: number; color: string; edge: number; fill: number; seed: number; snow?: number }[] = [
  // far: tall, steep, snow on the tops
  { peaks: [[7, 1, 0.75], [19, 3, 0.85], [47, 0, 0.7], [60, 2, 0.9], [78, 2, 0.8]], period: 90, speed: 0.35, color: C.purple, edge: 0.75, fill: 0.3, seed: 1, snow: 2 },
  // middle
  { peaks: [[3, 7, 0.5], [15, 6, 0.45], [53, 6, 0.4], [72, 7, 0.5]], period: 84, speed: 0.9, color: C.cyan, edge: 0.8, fill: 0.32, seed: 40 },
  // near foothills
  { peaks: [[10, 9.8, 0.2], [37, 9.2, 0.15], [62, 9.8, 0.22]], period: 72, speed: 2, color: C.green, edge: 0.85, fill: 0.36, seed: 90 },
];

const SUN = { x: 33, y: 6.5, r: 4 };

/** The river along the bottom: rows of foam, each rushing left at its own speed (px/s, fastest mid-stream). */
const RIVER_SPEEDS = [55, 80, 110, 95, 70];
const RIVER_TOP = ROWS - RIVER_SPEEDS.length;
const RIVER_CELLS = 256; // one strip repeats every this many cells
const RAINBOW = [C.pink, C.orange, C.yellow, C.green, C.cyan, C.purple];
const STARS = [[4, 1], [15, 0.4], [21, 2], [29, 1], [38, 3], [49, 0.3], [55, 1.2], [62, 2], [1, 4], [61, 5], [10, 3], [44, 2], [25, 3.6], [57, 3.4]];

const dot = (ctx: CanvasRenderingContext2D, gx: number, gy: number, color: string, alpha: number) => {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(gx * PITCH, gy * PITCH, DOT, DOT);
};

/** One range as pixel art, one period wide, plus a solid silhouette used to hide what's behind it. */
function drawRange(r: (typeof ranges)[number]) {
  const cols = Math.round(r.period * S);
  const unit = r.period / cols; // scene units per column, exact so the strip tiles seamlessly
  const art = document.createElement('canvas');
  const mask = document.createElement('canvas');
  art.width = mask.width = cols * PITCH;
  art.height = mask.height = H;
  const a = art.getContext('2d')!;
  const m = mask.getContext('2d')!;
  for (let gx = 0; gx < cols; gx++) {
    const u = gx * unit;
    let top = 99;
    for (const [px, pt, slope] of r.peaks) {
      const dx = Math.abs(u - px);
      top = Math.min(top, pt + Math.min(dx, r.period - dx) * slope);
    }
    top += (noise(u * 1.3, r.seed) - 0.5) * 1.1 + (noise(u * 4, r.seed + 7) - 0.5) * 0.35;
    const first = Math.max(0, Math.ceil(top * S));
    m.fillRect(gx * PITCH, first * PITCH, PITCH, H);
    for (let gy = first; gy < ROWS; gy++) {
      const d = gy - first;
      const snowy = r.snow !== undefined && top <= r.snow + 1;
      if (d === 0) dot(a, gx, gy, snowy ? C.fg : r.color, snowy ? 0.95 : r.edge);
      else if (snowy && d < 3) dot(a, gx, gy, C.fg, 0.75 - d * 0.15);
      else if (d < 3 && (gx + gy) % 2 === 0) dot(a, gx, gy, r.color, r.fill * 1.3);
      else if (d < 5 && (gx + gy) % 4 === 0) dot(a, gx, gy, r.color, r.fill * 0.9);
    }
  }
  return { art, mask, width: cols * PITCH };
}

/** The sun as pixel art: yellow → orange → pink, top to bottom. */
function drawSun() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  for (let gy = 0; gy < ROWS; gy++)
    for (let gx = 0; gx < COLS; gx++) {
      const u = (gx + 0.5) / S;
      const v = (gy + 0.5) / S;
      if (Math.hypot(u - SUN.x, (v - SUN.y) * 1.15) > SUN.r) continue;
      const k = (v - (SUN.y - SUN.r)) / (2 * SUN.r); // 0 top → 1 bottom
      dot(ctx, gx, gy, k < 0.35 ? C.yellow : k < 0.65 ? C.orange : C.pink, 0.9);
    }
  return c;
}

/** One row of river as pixel art: streaks of white and grey foam, dark water between, rare rainbow flecks. */
function drawRiverRow(row: number) {
  const c = document.createElement('canvas');
  c.width = RIVER_CELLS * PITCH;
  c.height = DOT;
  const ctx = c.getContext('2d')!;
  let x = 0;
  let n = row * 1000;
  const rnd = () => hash(++n);
  while (x < RIVER_CELLS) {
    // a streak of foam…
    const len = 2 + Math.floor(rnd() * 7);
    const tone = rnd();
    for (let k = 0; k < len && x < RIVER_CELLS; k++, x++) {
      const fleck = rnd() < 0.035;
      const [color, alpha] = fleck
        ? [RAINBOW[Math.floor(rnd() * RAINBOW.length)], 0.95]
        : tone < 0.4
          ? [C.fg, 0.9 - k * 0.06] // bright white, thinning toward its tail
          : tone < 0.75
            ? [C.fg, 0.5]
            : [C.cm, 0.55];
      ctx.globalAlpha = Math.max(0.25, alpha);
      ctx.fillStyle = color;
      ctx.fillRect(x * PITCH, 0, DOT, DOT);
    }
    // …then a little dark water
    const gap = 1 + Math.floor(rnd() * 4);
    for (let k = 0; k < gap && x < RIVER_CELLS; k++, x++) {
      if (rnd() < 0.5) continue;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = C.cm;
      ctx.fillRect(x * PITCH, 0, DOT, DOT);
    }
  }
  return c;
}

let canvas: HTMLCanvasElement | null = null;
let river: HTMLCanvasElement[] = [];
let layers: ReturnType<typeof drawRange>[] = [];
let sun: HTMLCanvasElement | null = null;
let sunNow: HTMLCanvasElement | null = null;
let activeUntil = 0;
let raf = 0;
let elapsed = 0; // seconds of motion so far; only advances while active

function draw() {
  const ctx = canvas?.getContext('2d');
  if (!ctx || !canvas || !sun || !sunNow) return;
  const t = elapsed;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, W, H);

  // Stars twinkle, each at its own pace.
  for (const [x, y] of STARS) {
    const tw = 0.5 + 0.5 * Math.sin(t * (0.8 + hash(x + y * 3) * 1.6) + hash(x * 7 + y) * 6.3);
    dot(ctx, Math.round(x * S), Math.round(y * S), hash(x * 7 + y) > 0.5 ? C.fg : C.yellow, 0.1 + tw * 0.5);
  }

  // The sun, with stripes across its lower half that sink smoothly.
  const s = sunNow.getContext('2d')!;
  s.globalCompositeOperation = 'source-over';
  s.clearRect(0, 0, W, H);
  s.drawImage(sun, 0, 0);
  s.globalCompositeOperation = 'destination-out';
  const band = 2.6 * PITCH; // stripe period in px
  const mid = SUN.y * S * PITCH;
  const bottom = (SUN.y + SUN.r) * S * PITCH;
  for (let y = mid + ((t * 6) % band); y < bottom; y += band) {
    const gap = band * (0.2 + (0.35 * (y - mid)) / (bottom - mid)); // gaps widen toward the bottom
    s.fillRect(0, y, W, gap);
  }
  ctx.globalAlpha = 1;
  ctx.drawImage(sunNow, 0, 0);

  // Ranges back to front: erase the silhouette, then draw the art, both slid smoothly.
  ranges.forEach((r, i) => {
    const L = layers[i];
    const off = (t * r.speed * S * PITCH) % L.width;
    for (const x of [-off, L.width - off]) {
      if (x >= W) continue;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(L.mask, x, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(L.art, x, 0);
    }
  });

  // The river, in front of everything.
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(0, RIVER_TOP * PITCH, W, H);
  ctx.globalCompositeOperation = 'source-over';
  river.forEach((strip, i) => {
    const off = (t * RIVER_SPEEDS[i]) % strip.width;
    for (const x of [-off, strip.width - off]) if (x < W) ctx.drawImage(strip, x, (RIVER_TOP + i) * PITCH);
  });
}

export function attachPixels(el: HTMLCanvasElement) {
  canvas = el;
  el.width = W;
  el.height = H;
  if (!layers.length) {
    layers = ranges.map(drawRange);
    sun = drawSun();
    river = RIVER_SPEEDS.map((_, i) => drawRiverRow(i));
    sunNow = document.createElement('canvas');
    sunNow.width = W;
    sunNow.height = H;
  }
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
    if (last) elapsed += Math.min(0.1, (ts - last) / 1000); // a long pause doesn't make it jump
    last = ts;
    draw();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
