import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

/** Tiny JSON-file store. Each key is one file in DATA_DIR. */
export function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(config.dataDir, `${key}.json`), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  const file = path.join(config.dataDir, `${key}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
