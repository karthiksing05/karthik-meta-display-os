import fs from 'node:fs';
import type { ContextUse } from '../../shared/protocol.ts';

/**
 * How full a session's context window is: the input side of its latest main-thread API call
 * (fresh + cached tokens) plus what it wrote. The window is 200k, or 1M for [1m] models; when the
 * SDK reports the real window (result.modelUsage[*].contextWindow) that wins.
 */
export const usedOf = (u: any): number =>
  (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.output_tokens ?? 0);

export function limitFor(model: string | undefined, used: number, known?: number): number {
  if (known) return known;
  if (/\[1m\]|1m-context/i.test(model ?? '') || used > 200_000) return 1_000_000;
  return 200_000;
}

export function contextOf(usage: any, model?: string, known?: number): ContextUse | null {
  const used = usedOf(usage);
  return used ? { used, limit: limitFor(model, used, known) } : null;
}

/** From a session's .jsonl (outside sessions): the last main-thread assistant message with usage. */
export function contextFromFile(file: string | undefined, model?: string): ContextUse | null {
  if (!file) return null;
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue;
      try {
        const m = JSON.parse(lines[i]);
        if (m.type === 'assistant' && !m.isSidechain && m.message?.usage) return contextOf(m.message.usage, model ?? m.message.model);
      } catch {
        /* a cut-off first line */
      }
    }
  } catch {
    /* no file yet */
  }
  return null;
}

/** Same, from messages already loaded through the SDK (getSessionMessages). */
export function contextFromMessages(msgs: any[]): ContextUse | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.type === 'assistant' && !m.parent_tool_use_id && m.message?.usage) return contextOf(m.message.usage, m.message.model);
  }
  return null;
}
