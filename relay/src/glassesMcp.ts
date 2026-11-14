import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { hub } from './hub.ts';

/**
 * In-process MCP server each Claude session gets, so the agent can reach the
 * lens on its own: notify you, show a card, or ask a quick multiple-choice
 * question that you answer with a swipe.
 */
export function glassesMcp(opts: {
  sessionId: string;
  sessionName: () => string;
  ask: (header: string, question: string, options: string[]) => Promise<string>;
}) {
  return createSdkMcpServer({
    name: 'glasses',
    version: '0.1.0',
    tools: [
      tool(
        'notify',
        'Show a short notification on the user\'s glasses (under 80 characters). Use for milestones: tests green, PR ready, blocked.',
        { text: z.string().max(120), level: z.enum(['info', 'good', 'warn', 'error']).default('info') },
        async ({ text, level }) => {
          hub.broadcast({ t: 'notify', text: `${opts.sessionName()}: ${text}`, level, sessionId: opts.sessionId });
          return { content: [{ type: 'text', text: 'shown' }] };
        },
      ),
      tool(
        'show_card',
        'Show a card on the glasses with a title and up to ~6 short lines. Use for summaries the user should glance at.',
        { title: z.string().max(60), body: z.string().max(500) },
        async ({ title, body }) => {
          hub.broadcast({ t: 'card', sessionId: opts.sessionId, title, body });
          return { content: [{ type: 'text', text: 'shown' }] };
        },
      ),
      tool(
        'ask_choice',
        'Ask the user a quick question on the glasses with 2-4 short options; returns the chosen label. Prefer this over long questions: the user answers with a swipe.',
        {
          question: z.string().max(140),
          options: z.array(z.string().max(40)).min(2).max(4),
          header: z.string().max(24).default('question'),
        },
        async ({ question, options, header }) => {
          const choice = await opts.ask(header, question, options);
          return { content: [{ type: 'text', text: `User chose: ${choice}` }] };
        },
      ),
    ],
  });
}

export const GLASSES_PROMPT = `
You are running inside "Claude Shell". The user watches and steers you from Meta Ray-Ban Display
glasses: a 600x600 lens and a wrist band with swipe and pinch, no keyboard.
- Keep messages short. The user reads them on a small screen while walking around.
- When you need a decision, prefer mcp__glasses__ask_choice (2-4 short options) or AskUserQuestion.
- Use mcp__glasses__notify for milestones (tests pass, work done, blocked).
- Keep a todo list (TodoWrite) for multi-step work: the lens shows it as a progress bar.
- Never push.
`.trim();

/** Added for sessions the relay started in a fresh worktree. */
export const WORKTREE_NOTE = '- You work in your own git worktree and branch. Commit when a step is done.';

/** One-off chats: no repo; the user's claude.ai connectors (Gmail, Calendar, Drive, Slack…) are available. */
export const CHAT_PROMPT = `
You are running inside "Claude Shell" as a general assistant. The user talks to you from Meta Ray-Ban
Display glasses: a 600x600 lens, replies by voice or a few preset phrases, no keyboard.
- This is not a coding task in a repo. Your working folder is an empty scratch folder.
- Use the user's connected tools (MCP connectors such as Gmail, Google Calendar, Drive, Slack) when
  they help. If one needs authorization, say which and that it's done at claude.ai → Settings → Connectors.
- Keep answers short and glanceable: a few lines, plain text, no tables, no long markdown.
- Ask before anything that sends, posts, deletes or books on the user's behalf; say exactly what it will do.
- When you need a decision, prefer mcp__glasses__ask_choice (2-4 short options).
`.trim();
