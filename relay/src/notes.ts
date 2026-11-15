import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { config } from './config.ts';

/**
 * Apple Notes for the notes session (the "notes" tile): read, rewrite and create notes in the Mac's
 * Notes app, which iCloud syncs to the iPhone. Runs osascript on the relay's Mac; the first call makes
 * macOS ask once whether ClaudeProd may control Notes.
 *
 * Every rewrite saves the note's previous body to DATA_DIR/notes-backups first.
 */
export const notesDir = path.join(config.dataDir, 'notes-workspace');
const backupDir = path.join(config.dataDir, 'notes-backups');
const prefsFile = path.join(notesDir, 'preferences.md');

function osa(script: string, args: string[], lang: 'JavaScript' | 'AppleScript' = 'JavaScript'): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('osascript', ['-l', lang, '-e', script, ...args], { timeout: 30_000, maxBuffer: 20 << 20 }, (err, out, errOut) =>
      err ? reject(new Error((errOut || err.message).trim().slice(0, 300))) : resolve(out.trim()),
    ),
  );
}

const LIST = `function run(argv) {
  const Notes = Application('Notes');
  const q = (argv[0] || '').toLowerCase();
  const names = Notes.notes.name(), ids = Notes.notes.id(), mods = Notes.notes.modificationDate();
  const out = [];
  for (let i = 0; i < names.length; i++) if (!q || names[i].toLowerCase().includes(q)) out.push({ id: ids[i], name: names[i], modified: mods[i].toISOString() });
  out.sort((a, b) => b.modified.localeCompare(a.modified));
  return JSON.stringify(out.slice(0, 60));
}`;
const READ = `function run(argv) {
  const n = Application('Notes').notes.byId(argv[0]);
  return JSON.stringify({ id: n.id(), name: n.name(), modified: n.modificationDate().toISOString(), body: n.body() });
}`;
const WRITE = `function run(argv) {
  Application('Notes').notes.byId(argv[0]).body = argv[1];
  return 'ok';
}`;
const CREATE = `on run argv
  tell application "Notes"
    set n to make new note with properties {body:item 1 of argv}
    return id of n
  end tell
end run`;

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const safe = (f: () => Promise<string>) => f().then(text, (e) => ({ ...text(`error: ${(e as Error).message}`), isError: true }));

export function notesMcp() {
  return createSdkMcpServer({
    name: 'notes',
    version: '0.1.0',
    tools: [
      tool(
        'list_notes',
        "List the user's Apple Notes (newest first, up to 60): id, name, last modified. Optional `query` filters by name.",
        { query: z.string().optional() },
        ({ query }) => safe(() => osa(LIST, [query ?? ''])),
      ),
      tool(
        'read_note',
        "Read one note: its name and full HTML body (Notes' own HTML: <div> per line, <h1> title, <ul>/<ol> lists).",
        { id: z.string() },
        ({ id }) => safe(() => osa(READ, [id])),
      ),
      tool(
        'write_note',
        "Replace a note's whole body with new HTML. Read it first and keep everything the user had unless they asked to remove it. " +
          'The first line is the note title. The previous body is backed up automatically. ' +
          "Notes' scripting can't write checkboxes: checklist items come out as plain bullets.",
        { id: z.string(), html: z.string() },
        ({ id, html }) =>
          safe(async () => {
            const before = JSON.parse(await osa(READ, [id])) as { name: string; body: string };
            fs.mkdirSync(backupDir, { recursive: true });
            const file = path.join(backupDir, `${Date.now()}-${before.name.replace(/[^\w-]+/g, '_').slice(0, 40)}.html`);
            fs.writeFileSync(file, before.body);
            await osa(WRITE, [id, html]);
            return `saved (previous version backed up to ${file})`;
          }),
      ),
      tool(
        'create_note',
        'Create a new note in the default Notes folder. The first line of the HTML becomes its title. Returns its id.',
        { html: z.string() },
        ({ html }) => safe(() => osa(CREATE, [html], 'AppleScript')),
      ),
      tool(
        'preferences',
        "Read your saved notes on the user (which note is the main to-do list, how they like it formatted). Pass `set` to replace them; keep it short.",
        { set: z.string().max(4000).optional() },
        ({ set }) =>
          safe(async () => {
            if (set != null) {
              fs.mkdirSync(notesDir, { recursive: true });
              fs.writeFileSync(prefsFile, set);
              return 'saved';
            }
            return fs.existsSync(prefsFile) ? fs.readFileSync(prefsFile, 'utf8') || '(empty)' : '(none yet)';
          }),
      ),
    ],
  });
}

export const NOTES_PROMPT = `
You are the user's notes assistant inside ClaudeProd. The user dictates to you from Meta Ray-Ban Display
glasses (speech-to-text, already cleaned up), and you keep their Apple Notes, above all their main to-do
list, in order. Notes sync to their iPhone through iCloud. Use the mcp__notes__ tools; you don't need
any other tools.

On every request:
1. Call preferences first. It says which note is the main to-do list and how the user likes it. If it
   doesn't say yet, find the list with list_notes (names like to-do, todo, tasks), ask with ask_choice
   if it's unclear, and save what you learned with preferences(set).
2. read_note the note, then make the change with write_note. Turn rambling dictation into clear,
   actionable items: one task per line, starting with a verb, with any dates, people or links kept.
   Put each item where it belongs (existing sections or headings), merge duplicates, and tidy or
   regroup the whole note when that makes it easier to use (by area, by priority or due date, done
   items at the bottom). Never drop the user's items unless they asked to remove or finish them.
3. Reply in one or two short plain sentences saying what changed (it's read on the glasses).

Questions about notes ("what's on my list for today?") are answered by reading, without writing.
Write your formatting preferences learned from the user into preferences, so they stick.
`;
