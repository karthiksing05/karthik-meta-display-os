import { config } from './config.ts';

/**
 * FreeFlow-style cleanup: the glasses composer gives raw dictated text; Groq
 * fixes punctuation, drops filler words and formats code terms, without
 * changing the meaning. Falls back to light local cleanup without a key.
 */
const SYSTEM = `You clean up dictated text before it is sent to a coding agent.
Rules:
- Fix punctuation, casing and obvious mis-hearings. Remove filler words (um, uh, like, you know).
- Keep the speaker's meaning and wording. Do not add content, do not answer the request.
- Format code terms: file names, functions and commands in backticks when obvious (e.g. "package dot json" -> \`package.json\`, "npm run dev").
- If the speaker corrects themselves ("no wait, I mean X"), keep only the correction.
- Output only the cleaned text.`;

export async function cleanDictation(text: string, context?: string): Promise<string> {
  const raw = text.trim();
  if (!raw) return raw;
  if (!config.groqKey) return localClean(raw);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.groqKey}` },
      body: JSON.stringify({
        model: config.groqModel,
        temperature: 0,
        max_tokens: 800,
        // gpt-oss models think first; keep it short and out of the reply.
        ...(config.groqModel.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {}),
        messages: [
          { role: 'system', content: SYSTEM + (context ? `\nContext (names you may see): ${context}` : '') },
          { role: 'user', content: raw },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`groq ${res.status}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content?.trim() || localClean(raw);
  } catch (err) {
    console.warn('[dictation] groq failed, using local cleanup:', (err as Error).message);
    return localClean(raw);
  }
}

function localClean(s: string): string {
  let out = s.replace(/\b(um+|uh+|erm|you know|i mean)\b[,]?\s*/gi, '').replace(/\s{2,}/g, ' ').trim();
  out = out.charAt(0).toUpperCase() + out.slice(1);
  if (!/[.!?]$/.test(out)) out += '.';
  return out;
}
