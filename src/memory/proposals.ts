/**
 * 「## 记忆」段的一条 → 建议(schema/memory.ts,《vault重构方案》§3,2026-10-30):拆出行首 `孩子:` 与行末 `证据:「…」`,
 * 再拿证据对孩子说过的话。只认孩子发来的消息(diary.ts 的 kidQuestions:from: kid、不是首页按钮上的字、不是交卡的动作);
 * 老师自己讲的、应用派的任务都不算——生成了五道题不等于孩子做完了五道题。
 */
import { kidQuestions } from './diary.ts';
import { threads, type ConversationMessage, type EvidenceCheck, type MemoryProposal } from '../schema/index.ts';

const CHILD = /^孩子\s*[:：]/;
const EVIDENCE = /\s*证据\s*[:：]\s*(?:「([^」]*)」|“([^”]*)”|"([^"]*)")\s*$/;

/** 拆一条:证据拿出来(vault 里不写),末尾多出来的逗号分号去掉;`孩子:` 前缀留在 item 里 */
export function parseProposal(raw: string): Omit<MemoryProposal, 'check'> {
  const s = raw.replace(/\s+/g, ' ').trim();
  const m = EVIDENCE.exec(s);
  const item = m ? s.slice(0, m.index).replace(/[\s,,;;、]+$/, '') : s;
  const quote = m ? (m[1] ?? m[2] ?? m[3]).trim() : '';
  return { item, target: CHILD.test(item) ? 'child' : 'tutor', ...(quote ? { quote } : {}) };
}

/** 进孩子的记忆时去掉 `孩子:` 前缀(那篇里不用标) */
export function childItem(item: string): string {
  return item.replace(/^孩子\s*[:：]\s*/, '');
}

/** 比对用:去掉空白、标点、符号,英文不分大小写(孩子的话是语音转写,标点靠不住) */
const norm = (s: string): string => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

/** 孩子说过的话:这个话题里的;thread = null(整理记忆那轮自成话题,里面没有孩子的话)→ 这一天所有话题的 */
export function kidSaid(messages: readonly Pick<ConversationMessage, 'job' | 'from' | 'thread' | 'text' | 'action' | 'via'>[], thread: string | null): string[] {
  if (thread !== null) return kidQuestions(messages, thread);
  return [...new Set(threads(messages))].flatMap((th) => kidQuestions(messages, th));
}

/** 证据对不对得上:没写(或去掉标点后不到两个字,太短分不出)→ unverified;孩子哪句话里有它 → verified;都没有 → rejected */
export function checkEvidence(quote: string | undefined, said: readonly string[]): EvidenceCheck {
  const q = norm(quote ?? '');
  if (Array.from(q).length < 2) return 'unverified';
  return said.some((s) => norm(s).includes(q)) ? 'verified' : 'rejected';
}

/** 「## 记忆」段的几条 → 建议,各自带证据对没对上 */
export function proposalsOf(items: readonly string[], said: readonly string[]): MemoryProposal[] {
  return items.map((raw) => {
    const p = parseProposal(raw);
    return { ...p, check: checkEvidence(p.quote, said) };
  });
}
