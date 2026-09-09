/**
 * 孩子视图(《cotutor契约草案.md》§4):孩子只看每次运行最终文本的**最后一段**(剥掉「待裁量」「转交」段之后,
 * 以空行分段取最后一段——家规让老师把给孩子的话放最后一段,前面的话是给家长看的思路),再按 replyMaxChars 截断;
 * 出错什么都不出现。机械规则,不靠模型判断。
 */
import type { ConversationMessage, Handoff, HoldupAsk } from '../schema/index.ts';
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

/** 孩子端的一条:自己问的话(别人问的不显示)+ 老师给孩子的话 + 配音;出错的运行什么都不出现(问句还在) */
export interface KidMessage {
  job: string;
  at: string;
  /** 孩子自己说的;家长 / 系统发的不给孩子看,为 null */
  question: string | null;
  /** 老师给孩子的话;还在跑或这轮没有 = null */
  reply: string | null;
  /** 配音文件名(conversations/<老师>/ 下);没有 = 用浏览器自带的声 */
  audio: string | null;
  /** 老师还在想 */
  pending: boolean;
  /** 本次运行新增的产物 id */
  artifacts: string[];
}

/**
 * 对话索引 → 孩子端条目(《契约草案.md》§4 的机械过滤在服务端做):不带 result / error / holdup / handoff / 费用。
 * 出错的运行:没有 question 的直接不出现;有 question 的只留问句(老师头像不灰,下一条照常)。
 */
export function kidConversation(index: { messages: readonly ConversationMessage[] }): KidMessage[] {
  const out: KidMessage[] = [];
  for (const m of index.messages) {
    const question = m.from === 'kid' ? m.text : null;
    const reply = m.result === 'ok' ? (m.kidText ?? null) : null;
    const pending = m.result === 'running';
    if (question === null && reply === null && !pending) continue;
    out.push({ job: m.job, at: m.at, question, reply, audio: reply ? (m.audio ?? null) : null, pending, artifacts: reply ? [...m.artifacts] : [] });
  }
  return out;
}

/** 今天孩子已发的条数(每日上限按它算;家长发的不算) */
export function kidMessageCount(index: { messages: readonly ConversationMessage[] }): number {
  return index.messages.filter((m) => m.from === 'kid').length;
}
