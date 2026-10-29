/**
 * 照片 → 口语单:交给 qwen3.8-omni-flash(兼容接口,不想)读出今天学的词和句,各带中文。
 * 只读印刷体(2026-10-10 实测:印刷稳、手写不稳);读出来的家长要看一眼改,孩子只拿改过的。
 * 这里是口语课这个场景的规则(提示词、怎么解析、单词卡的那两样);看图的请求在 src/media/vision.ts(key:omni 只有百炼按量),由路由那层交进来。
 */
import { word as wordCard } from '../../cards/word.ts';
import type { Look } from '../look.ts';

/** 口语单的一条;词另有单词卡(cards/word)要的 emoji 与自然拼读分段(读照片时出,过 cards/word 的 parse;没有就卡上只有词) */
export interface ListItem { en: string; zh: string; emoji?: string; chunks?: string[] }
export interface TalkList { words: ListItem[]; sentences: ListItem[] }

export const LIST_TIMEOUT_MS = 40_000;
const MAX_WORDS = 12;
const MAX_SENTENCES = 8;

export const PROMPT = `这是家长拍的一页小学英语课本或练习册。把这一页上**印刷的**英文单词和英文句子读出来,给孩子跟读和口语练习用:
- words:单词或短语(最多 ${MAX_WORDS} 个),每个带中文意思;再带两样给单词卡用:emoji——能画出来的东西配一个,抽象的词(like、the)不配;split——自然拼读分段,用 - 隔开(ap-ple、sh-ee-p、c-a-t),拼起来要和单词一模一样;
- sentences:完整的英文句子(最多 ${MAX_SENTENCES} 句),每句带中文意思;
- 只要印刷的,手写的不要;题号、页码、栏目名不要;拼音、音标不要;
- 这一页没有英文就两个都空。
只回一个 JSON 对象,形如 {"words":[{"en":"red","zh":"红色","emoji":"🔴","split":"r-e-d"}],"sentences":[{"en":"It's a red car.","zh":"这是一辆红色的车。"}]},不要别的字。`;

/**
 * 口语单的一个词 → 单词卡要的 emoji 与分段:拼成单词卡的正文过 cards/word 的 parse,
 * 分段拼不回这个词就丢分段、emoji 不是 emoji 就丢——和老师写错时一个下场;词本身写不进四线三格(带标点、整句)两样都不要
 */
export function wordCardOf(en: string, emoji?: unknown, split?: unknown): { emoji?: string; chunks?: string[] } {
  const em = typeof emoji === 'string' ? emoji.trim().slice(0, 16) : '';
  const sp = typeof split === 'string' ? split.trim() : '';
  try {
    const p = wordCard.parse(`${em} ${en}\n${sp}`, []) as { word: string; chunks?: string[]; emoji?: string };
    if (p.word !== en) return {};
    return { ...(p.emoji ? { emoji: p.emoji } : {}), ...(p.chunks ? { chunks: p.chunks } : {}) };
  } catch {
    return {};
  }
}

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
  const pick = (arr: unknown, max: number, card: boolean): ListItem[] | null => {
    if (arr === undefined || arr === null) return [];
    if (!Array.isArray(arr)) return null;
    const out: ListItem[] = [];
    for (const x of arr as unknown[]) {
      if (typeof x !== 'object' || x === null) continue;
      const en = String((x as { en?: unknown }).en ?? '').replace(/\s+/g, ' ').trim();
      const zh = String((x as { zh?: unknown }).zh ?? '').replace(/\s+/g, ' ').trim();
      if (!en || en.length > 120) continue;
      if (out.some((o) => o.en.toLowerCase() === en.toLowerCase())) continue;
      out.push(card ? { en, zh, ...wordCardOf(en, (x as { emoji?: unknown }).emoji, (x as { split?: unknown }).split) } : { en, zh });
      if (out.length >= max) break;
    }
    return out;
  };
  const words = pick((v as { words?: unknown }).words, MAX_WORDS, true);
  const sentences = pick((v as { sentences?: unknown }).sentences, MAX_SENTENCES, false);
  if (!words || !sentences) return null;
  return { words, sentences };
}

/** 读一张照片(look = 看图的请求,src/media/vision.ts 的 lookAt);不抛,出错回 {ok: false} */
export async function readListWith(look: Look, photo: { data: Buffer; mime: string }, opts: { env?: NodeJS.ProcessEnv; endpoint?: string; model?: string; timeoutMs?: number } = {}): Promise<ListResult> {
  const t0 = Date.now();
  const ms = (): number => Date.now() - t0;
  const model = opts.model ?? 'qwen3.8-omni-flash';
  const r = await look({ image: photo, prompt: PROMPT, model, params: { modalities: ['text'], reasoning_effort: 'none' }, timeoutMs: opts.timeoutMs ?? LIST_TIMEOUT_MS, env: opts.env, endpoint: opts.endpoint });
  if (!r.ok) return { ok: false, error: r.error, ms: ms() };
  const list = parseList(r.text);
  if (!list) return { ok: false, error: 'bad_json', ms: ms() };
  return { ok: true, list, model, ms: ms() };
}
