import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import type { PhotoItem } from '../../../shared/protocol.ts';
import { config } from '../config.ts';
import { hub, state } from '../hub.ts';

const run = promisify(execFile);

/**
 * Photo library for the lens.
 *
 *  osxphotos  The relay runs on your Mac and reads the Photos library (which iCloud Photos
 *             keeps in sync with your iPhone). Searches titles, keywords, people, places,
 *             Apple's own labels ("dog", "beach"), albums and dates. Photos stored only in
 *             iCloud are downloaded on first view.
 *             Setup: `pipx install osxphotos` (or pip), and give your terminal / node
 *             Full Disk Access in System Settings → Privacy & Security.
 *  folder     Any folder of JPEG/PNG files, e.g. a synced export on the Oracle VM.
 *
 * Images are resized for the lens (macOS `sips`) and cached in DATA_DIR/photo-cache.
 */

interface Indexed extends PhotoItem {
  path: string | null;
  missing: boolean;
  haystack: string;
}

let index: Indexed[] = [];
let indexedAt = 0;
let indexing: Promise<void> | null = null;
const cacheDir = path.join(config.dataDir, 'photo-cache');
fs.mkdirSync(cacheDir, { recursive: true });

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const dateWords = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()} ${MONTHS[d.getMonth()]} ${MONTHS[d.getMonth()].slice(0, 3)}`;
};

async function buildOsxphotos(): Promise<Indexed[]> {
  const { stdout } = await run('osxphotos', ['query', '--json', '--not-hidden', '--only-photos'], {
    maxBuffer: 1 << 30,
    timeout: 10 * 60_000,
  });
  const rows = JSON.parse(stdout) as any[];
  return rows.map((r) => {
    const date = Date.parse(r.date) || 0;
    const place = r.place?.name ?? null;
    const title = r.title || r.original_filename || r.filename || '';
    const haystack = [
      title, r.description, ...(r.keywords ?? []), ...(r.labels ?? []), ...(r.persons ?? []).filter((p: string) => p !== '_UNKNOWN_'),
      ...(r.albums ?? []), place, r.favorite ? 'favorite favorites' : '', dateWords(date),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return {
      id: String(r.uuid),
      date,
      title,
      place,
      favorite: Boolean(r.favorite),
      path: r.path_edited || r.path || null,
      missing: Boolean(r.ismissing),
      haystack,
    };
  });
}

function buildFolder(): Indexed[] {
  const out: Indexed[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jpe?g|png|webp|heic)$/i.test(e.name)) {
        const st = fs.statSync(p);
        const rel = path.relative(config.photosDir, p);
        out.push({
          id: createHash('sha1').update(rel).digest('hex').slice(0, 16),
          date: st.mtimeMs,
          title: e.name,
          place: null,
          favorite: false,
          path: p,
          missing: false,
          haystack: `${rel} ${dateWords(st.mtimeMs)}`.toLowerCase(),
        });
      }
    }
  };
  walk(config.photosDir);
  return out;
}

export async function refreshPhotos() {
  if (!config.photosSource) return;
  if (indexing) return indexing;
  indexing = (async () => {
    try {
      index = (config.photosSource === 'osxphotos' ? await buildOsxphotos() : buildFolder()).sort((a, b) => b.date - a.date);
      indexedAt = Date.now();
      state.integrations.photos = true;
      hub.changed();
      console.log(`[photos] indexed ${index.length} photos (${config.photosSource})`);
    } catch (e) {
      console.warn('[photos] index failed:', (e as Error).message.slice(0, 300));
    } finally {
      indexing = null;
    }
  })();
  return indexing;
}

/** Plain-words search: every word must match somewhere (title, people, place, labels, album, month, year). */
export async function queryPhotos(q = '', offset = 0, limit = 32) {
  if (!indexedAt || Date.now() - indexedAt > 30 * 60_000) await refreshPhotos();
  const words = q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
  const hits = words.length ? index.filter((p) => words.every((w) => p.haystack.includes(w))) : index;
  return {
    total: hits.length,
    items: hits.slice(offset, offset + limit).map(({ id, date, title, place, favorite }) => ({ id, date, title, place, favorite })),
  };
}
const STOP = new Set(['photo', 'photos', 'picture', 'pictures', 'pic', 'pics', 'of', 'the', 'a', 'an', 'in', 'at', 'from', 'with', 'show', 'me', 'my', 'and']);

async function originalFor(p: Indexed): Promise<string | null> {
  if (p.path && fs.existsSync(p.path)) return p.path;
  if (config.photosSource !== 'osxphotos') return null;
  // Only in iCloud: ask Photos to download it, export a copy into the cache.
  const dir = path.join(cacheDir, 'orig', p.id);
  fs.mkdirSync(dir, { recursive: true });
  const existing = fs.readdirSync(dir)[0];
  if (existing) return path.join(dir, existing);
  await run('osxphotos', ['export', dir, '--uuid', p.id, '--download-missing', '--skip-live', '--skip-bursts'], { timeout: 120_000 });
  const f = fs.readdirSync(dir)[0];
  return f ? path.join(dir, f) : null;
}

/** Lens-sized JPEG: thumb = 240 px, full = 600 px on the long edge. */
export async function photoImage(id: string, size: 'thumb' | 'full', res: ServerResponse) {
  const p = index.find((x) => x.id === id);
  if (!p) return res.writeHead(404).end();
  const px = size === 'thumb' ? 240 : 600;
  const out = path.join(cacheDir, `${id}-${px}.jpg`);
  try {
    if (!fs.existsSync(out)) {
      const src = await originalFor(p);
      if (!src) return res.writeHead(404).end();
      if (os.platform() === 'darwin') {
        await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', String(px), src, '--out', out], { timeout: 60_000 });
      } else if (/\.(jpe?g|png|webp)$/i.test(src)) {
        // No resizer on Linux by default: serve the original; the lens scales it.
        res.writeHead(200, { 'content-type': src.endsWith('.png') ? 'image/png' : src.endsWith('.webp') ? 'image/webp' : 'image/jpeg', 'cache-control': 'private, max-age=86400' });
        return fs.createReadStream(src).pipe(res);
      } else return res.writeHead(415).end('HEIC needs macOS (sips) to convert');
    }
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' });
    fs.createReadStream(out).pipe(res);
  } catch (e) {
    console.warn('[photos] image failed:', (e as Error).message.slice(0, 200));
    if (!res.headersSent) res.writeHead(500).end();
  }
}

export const photosEnabled = () => Boolean(config.photosSource);
