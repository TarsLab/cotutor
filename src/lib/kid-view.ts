/**
 * 精简视图(《cotutor契约草案.md》§4):孩子只看每次运行最终文本的**最后一段**(剥掉「待裁量」「转交」段之后,
 * 以空行分段取最后一段——家规让老师把给孩子的话放最后一段,前面的话是给家长看的思路),再按 replyMaxChars 截断;
 * 出错什么都不出现。机械规则,不靠模型判断。
 */
import type { Handoff, HoldupAsk } from '../schema/index.ts';
import { parseSections } from './sections.ts';
import type { Transcript } from './transcript.ts';

export interface KidView {
  /** 给孩子的话;null = 这次运行没有(出错、还在跑、或最终文本剥完是空的) */
  kidText: string | null;
  truncated: boolean;
  holdup: HoldupAsk | null;
  handoff: Handoff | null;
  /** 运行是否正常收尾 */
  ok: boolean;
}

const SENTENCE_END = new Set(['。', '!', '!', '?', '?', ';', ';', '\n']);

/** 以空行分段,取最后一个非空段(段内换行保留) */
export function lastParagraph(text: string): string {
  const paras = text
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paras[paras.length - 1] ?? '';
}

/** 按码点数截断;能在句末断就在句末断(不加省略号),否则硬截加 … */
export function truncateReply(text: string, max: number): { text: string; truncated: boolean } {
  const cps = Array.from(text);
  if (cps.length <= max) return { text, truncated: false };
  let cut = -1;
  for (let i = Math.min(max, cps.length) - 1; i >= Math.floor(max * 0.4); i--) {
    if (SENTENCE_END.has(cps[i])) {
      cut = i + 1;
      break;
    }
  }
  if (cut > 0) return { text: cps.slice(0, cut).join('').trim(), truncated: true };
  return { text: `${cps.slice(0, max).join('').trim()}…`, truncated: true };
}

export function deriveKidView(t: Transcript, policy: { replyMaxChars: number }): KidView {
  if (!t.final) return { kidText: null, truncated: false, holdup: null, handoff: null, ok: false };
  if (!t.final.ok || !t.final.text) return { kidText: null, truncated: false, holdup: null, handoff: null, ok: t.final.ok };
  const { body, holdup, handoff } = parseSections(t.final.text);
  const last = lastParagraph(body);
  if (!last) return { kidText: null, truncated: false, holdup, handoff, ok: true };
  const { text, truncated } = truncateReply(last, policy.replyMaxChars);
  return { kidText: text, truncated, holdup, handoff, ok: true };
}
