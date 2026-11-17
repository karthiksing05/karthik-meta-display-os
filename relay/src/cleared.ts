import type { SessionInfo } from '../../shared/protocol.ts';
import { load, save } from './store.ts';

/**
 * Sessions you cleared from the lens list. Nothing is deleted: the relay just stops showing them.
 * Each one remembers its last activity when cleared, and comes back if it does anything new.
 * Saved in DATA_DIR/cleared.json.
 */
const cleared = new Map<string, number>(Object.entries(load<Record<string, number>>('cleared', {})));
const persist = () => save('cleared', Object.fromEntries(cleared));

export const isCleared = (s: SessionInfo) => {
  const at = cleared.get(s.id);
  return at != null && s.lastActivity <= at;
};

export function clearSessions(ids: string[], all: SessionInfo[]) {
  for (const id of ids) {
    const s = all.find((x) => x.id === id);
    if (s) cleared.set(id, s.lastActivity);
  }
  persist();
}

export function restoreCleared() {
  cleared.clear();
  persist();
}

/** The sessions to show, and how many are hidden. A cleared session that's active again is un-cleared. */
export function visible(all: SessionInfo[]): { sessions: SessionInfo[]; cleared: number } {
  let changed = false;
  for (const s of all) {
    const at = cleared.get(s.id);
    if (at != null && s.lastActivity > at) changed = cleared.delete(s.id);
  }
  if (changed) persist();
  const sessions = all.filter((s) => !isCleared(s));
  return { sessions, cleared: all.length - sessions.length };
}
