/**
 * 英文单词配 emoji(听写模块的事,放在 server 下是因为调它的是家长端「首页」的保存):家长在家长端手输这周的单词,保存时问一次 qwen3.8-flash,能画出来的配一个,抽象的词不配。
 * 只在孩子写完对一对时出,写的时候看不到。拍照认词的那份由认词那次请求顺带回(recognize.ts 的 FORMAT_EN),不走这里。
 * 失败、超时、没有 key 都当没配,不挡保存。
 */
import { dictationEmoji } from '../../board/cards/index.ts';
import { chatUrl, qianwenKeys, qianwenLine } from '../../shared/qianwen.ts';

const EMOJI_MODEL = 'qwen3.8-flash';
const EMOJI_TIMEOUT_MS = 8000;

export function emojiPrompt(words: readonly string[]): string {
  return [
    '给下面每个英文单词配一个 emoji,给小学二年级的孩子当提示图。',
    '能画出来的东西才配(grandmother 👵、bus 🚌、apple 🍎);抽象的词(like、the、is、can)不配。',
    '只回一段 JSON,不要别的字:{"单词": "emoji"},不配的单词不写。',
    `单词:${words.join(', ')}`,
  ].join('\n');
}

/** 模型的回答 → 单词 → emoji;只收问到的单词、只收真是一个 emoji 的 */
export function parseEmojiReply(text: string, words: readonly string[]): Record<string, string> {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return {};
  let obj: unknown;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return {};
  }
  if (!obj || typeof obj !== 'object') return {};
  const got = obj as Record<string, unknown>;
  const lower = new Map(Object.entries(got).map(([k, v]) => [k.toLowerCase(), v]));
  const out: Record<string, string> = {};
  for (const w of words) {
    const e = dictationEmoji(got[w] ?? lower.get(w.toLowerCase()));
    if (e) out[w] = e;
  }
  return out;
}

/** 问一次:单词 → emoji(没配的不在里面) */
export async function wordEmoji(words: readonly string[], opts: { env?: NodeJS.ProcessEnv; endpoint?: string; model?: string; timeoutMs?: number } = {}): Promise<Record<string, string>> {
  if (!words.length) return {};
  const model = opts.model ?? EMOJI_MODEL;
  const line = qianwenLine(model, qianwenKeys(opts.env ?? process.env));
  if (!line) return {};
  try {
    const res = await fetch(opts.endpoint ?? chatUrl(line.host), {
      method: 'POST',
      headers: { authorization: `Bearer ${line.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, reasoning_effort: 'none', messages: [{ role: 'user', content: emojiPrompt(words) }] }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? EMOJI_TIMEOUT_MS),
    });
    if (!res.ok) return {};
    const j = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const text = j.choices?.[0]?.message?.content;
    return typeof text === 'string' ? parseEmojiReply(text, words) : {};
  } catch {
    return {};
  }
}
