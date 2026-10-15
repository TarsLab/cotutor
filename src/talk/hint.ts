/**
 * 打电话的提示卡(《口语课设计.md》拍板 16):老师在聊那段每说完一句,问一次 qwen3.8-flash——孩子要回答,可以怎么说;
 * 回一张卡:正面中文(说一说:…),翻过来英文句型带一个空(It's ___.),空下面是口语单上能填的词。老师这句不是在问他(夸、打招呼、再见)就不出卡。
 * 模型没回来(没 key、超时、回的不对)就从口语单挑一句和老师这句最沾的当卡。卡不出声;孩子什么时候看到由孩子端定(4 秒没出声,或点小灯泡)。
 * 不抛:出错都当没有,不挡通话。
 */
import { chatUrl, qianwenKeys, qianwenLine } from '../lib/qianwen.ts';
import { wordsOf } from './lib/read-flow.ts';
import type { TalkList } from './lib/used.ts';

export const HINT_MODEL = 'qwen3.8-flash';
export const HINT_TIMEOUT_MS = 4000;
/** 句型里的空 */
export const BLANK = '___';

export interface Hint {
  /** 正面:中文,告诉他要说什么 */
  zh: string;
  /** 翻过来:一句英文,最多一个空(___) */
  en: string;
  /** 能填进空里的词(口语单上的单词),没有空就是空的 */
  opts: string[];
}

export function hintPrompt(line: string, list: TalkList): string {
  const w = list.words.map((x) => `${x.en}${x.zh ? `(${x.zh})` : ''}`).join('、');
  const s = list.sentences.map((x) => x.en).join(' / ');
  return [
    `一年级的孩子在和英语老师打电话。老师刚说:「${line}」`,
    `今天的口语单:${w ? `单词 ${w}` : ''}${w && s ? ';' : ''}${s ? `句子 ${s}` : ''}`,
    '孩子不知道怎么回答时,给他一张提示卡:',
    '- zh:一句中文,告诉他要说什么,以「说一说:」开头,16 个字以内(说一说:公共汽车是什么颜色的?);',
    `- en:他照着能说的一句简单英文,6 个词以内;要他自己挑的那个词写成 ${BLANK},只留一个空;不用挑就写整句;`,
    '- opts:能填进空里的词,只从口语单的单词里挑,2 到 4 个;没有空就是 []。',
    '老师这句不是在问他(只是夸他、打招呼、说再见)就回 {"skip": true}。',
    `只回一个 JSON,不要别的字:{"zh":"说一说:它是什么颜色的?","en":"It's ${BLANK}.","opts":["red","yellow"]}`,
  ].join('\n');
}

/** 模型的回答 → 卡;skip → 'skip';形状不对 → null。opts 只收口语单上的单词,空和 opts 要对得上 */
export function parseHint(text: string, list: TalkList): Hint | 'skip' | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let v: unknown;
  try { v = JSON.parse(m[0]); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.skip === true) return 'skip';
  const zh = typeof o.zh === 'string' ? o.zh.replace(/\s+/g, ' ').trim() : '';
  let en = typeof o.en === 'string' ? o.en.replace(/\s+/g, ' ').trim().replace(/_{2,}/g, BLANK) : '';
  if (!zh || !en || zh.length > 30 || en.length > 80 || !/[a-z]/i.test(en.replace(BLANK, ''))) return null;
  const known = new Map(list.words.map((x) => [x.en.toLowerCase(), x.en]));
  const opts = [...new Set((Array.isArray(o.opts) ? o.opts : []).map((x) => (typeof x === 'string' ? known.get(x.trim().toLowerCase()) : undefined)).filter((x): x is string => Boolean(x)))].slice(0, 4);
  const blanks = en.split(BLANK).length - 1;
  if (blanks > 1) return null;
  // 有空没词可填:空换成第一个词也说不通,不如不出;有词没空:词丢掉
  if (blanks === 1 && !opts.length) return null;
  if (blanks === 0) return { zh, en, opts: [] };
  en = en.replace(BLANK, ` ${BLANK} `).replace(/\s+/g, ' ').replace(/ ([.?!,])/g, '$1').trim();
  return { zh, en, opts };
}

/** 兜底:口语单上和老师这句最沾的一句(没有沾的就第一句);没有句子就不出 */
export function fallbackHint(line: string, list: TalkList): Hint | null {
  if (!list.sentences.length) return null;
  const said = new Set(wordsOf(line));
  let best = list.sentences[0], score = -1;
  for (const s of list.sentences) {
    const n = wordsOf(s.en).filter((w) => said.has(w)).length;
    if (n > score) { best = s; score = n; }
  }
  return { zh: best.zh ? `说一说:${best.zh}` : '照着说一说', en: best.en, opts: [] };
}

export type HintResult = { hint: Hint; by: 'model' | 'list' } | null;

/** 老师说完一句 → 一张卡(或不出);问模型,模型不行用兜底,模型说不是问话就不出 */
export async function makeHint(line: string, list: TalkList, opts: { env?: NodeJS.ProcessEnv; endpoint?: string; model?: string; timeoutMs?: number } = {}): Promise<HintResult> {
  if (!line.trim() || list.words.length + list.sentences.length === 0) return null;
  const fb = (): HintResult => { const h = fallbackHint(line, list); return h ? { hint: h, by: 'list' } : null; };
  const model = opts.model ?? HINT_MODEL;
  const ln = qianwenLine(model, qianwenKeys(opts.env ?? process.env));
  if (!ln && !opts.endpoint) return fb();
  try {
    const res = await fetch(opts.endpoint ?? chatUrl(ln!.host), {
      method: 'POST',
      headers: { authorization: `Bearer ${ln?.key ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, reasoning_effort: 'none', messages: [{ role: 'user', content: hintPrompt(line, list) }] }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? HINT_TIMEOUT_MS),
    });
    if (!res.ok) return fb();
    const j = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const text = j.choices?.[0]?.message?.content;
    const h = typeof text === 'string' ? parseHint(text, list) : null;
    if (h === 'skip') return null;
    return h ? { hint: h, by: 'model' } : fb();
  } catch {
    return fb();
  }
}
