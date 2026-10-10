/**
 * 照片 → 口语单:交给 qwen3.8-omni-flash(兼容接口,不想)读出今天学的词和句,各带中文(《wip/口语课设想.md》§二 2)。
 * 只读印刷体(2026-10-10 实测:印刷稳、手写不稳);读出来的家长要看一眼改,孩子只拿改过的。
 * key 同 listen.ts(环境变量 DASHSCOPE_API_KEY,没有就读本机 qwen 的配置)。
 */
import { homedir } from 'node:os';
import { localDashscopeKey } from '../clis/qwen.ts';
import { readStream } from '../server/listen.ts';
import type { ListItem, TalkList } from './lib/used.ts';

const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
export const LIST_TIMEOUT_MS = 40_000;
const MAX_WORDS = 12;
const MAX_SENTENCES = 8;

const PROMPT = `这是家长拍的一页小学英语课本或练习册。把这一页上**印刷的**英文单词和英文句子读出来,给孩子跟读和口语练习用:
- words:单词或短语(最多 ${MAX_WORDS} 个),每个带中文意思;
- sentences:完整的英文句子(最多 ${MAX_SENTENCES} 句),每句带中文意思;
- 只要印刷的,手写的不要;题号、页码、栏目名不要;拼音、音标不要;
- 这一页没有英文就两个都空。
只回一个 JSON 对象,形如 {"words":[{"en":"red","zh":"红色"}],"sentences":[{"en":"It's a red car.","zh":"这是一辆红色的车。"}]},不要别的字。`;

export type ListResult = { ok: true; list: TalkList; model: string; ms: number } | { ok: false; error: string; ms: number };

/** 模型回的字 → 口语单;去掉围栏、找到第一个 {…};形状不对回 null */
export function parseList(text: string): TalkList | null {
  const body = text.replace(/```[a-z]*\n?/gi, '').trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let v: unknown;
  try { v = JSON.parse(body.slice(start, end + 1)); } catch { return null; }
  if (typeof v !== 'object' || v === null) return null;
  const pick = (arr: unknown, max: number): ListItem[] | null => {
    if (arr === undefined || arr === null) return [];
    if (!Array.isArray(arr)) return null;
    const out: ListItem[] = [];
    for (const x of arr as unknown[]) {
      if (typeof x !== 'object' || x === null) continue;
      const en = String((x as { en?: unknown }).en ?? '').replace(/\s+/g, ' ').trim();
      const zh = String((x as { zh?: unknown }).zh ?? '').replace(/\s+/g, ' ').trim();
      if (!en || en.length > 120) continue;
      if (out.some((o) => o.en.toLowerCase() === en.toLowerCase())) continue;
      out.push({ en, zh });
      if (out.length >= max) break;
    }
    return out;
  };
  const words = pick((v as { words?: unknown }).words, MAX_WORDS);
  const sentences = pick((v as { sentences?: unknown }).sentences, MAX_SENTENCES);
  if (!words || !sentences) return null;
  return { words, sentences };
}

/** 读一张照片;不抛,出错回 {ok: false} */
export async function readList(photo: { data: Buffer; mime: string }, opts: { env?: NodeJS.ProcessEnv; endpoint?: string; model?: string; timeoutMs?: number } = {}): Promise<ListResult> {
  const env = opts.env ?? process.env;
  const t0 = Date.now();
  const ms = (): number => Date.now() - t0;
  const key = env.DASHSCOPE_API_KEY?.trim() || localDashscopeKey(env.HOME || homedir());
  if (!key) return { ok: false, error: 'no_key', ms: ms() };
  const model = opts.model ?? 'qwen3.8-omni-flash';
  const body = {
    model,
    stream: true,
    modalities: ['text'],
    reasoning_effort: 'none',
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${photo.mime};base64,${photo.data.toString('base64')}` } }, { type: 'text', text: PROMPT }] }],
  };
  try {
    const res = await fetch(opts.endpoint ?? ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? LIST_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}`, ms: ms() };
    const text = readStream(await res.text());
    if (text === null) return { ok: false, error: 'bad_reply', ms: ms() };
    const list = parseList(text);
    if (!list) return { ok: false, error: 'bad_json', ms: ms() };
    return { ok: true, list, model, ms: ms() };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network', ms: ms() };
  }
}
