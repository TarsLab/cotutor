/**
 * 老师回的结构化段落进 vault(从 runner 拆出来,2026-10-29):老师(LLM)不直接写 vault,回结构化段由应用落盘,
 * 写了什么、没写成为什么都回给调用方,进这一轮的提醒。
 * - 「## 记忆」:每条先成建议、证据对孩子说过的话(proposals.ts),对不上的不记;其余增 / 改 / 删落进这位 agent 的记忆文件,
 *   `孩子:` 开头的(有脸的老师写的)落进孩子的记忆(agent: all,所有有脸的老师共用);讲课的轮每轮最多 max 条,多的丢(整理轮 max = null 不限)
 * - 「## 记账」:这个话题在日记里的一段(打分不够只留孩子问与观察),追加到当天日记
 * 只算不写(planMemory、planDiary):调用方先在这一轮的索引上记 pending,再写(writeVaultMemory、writeDiaryBlock),
 * 写完把 pending 换成 memoryLines / diaryBlock / booked(《运行层行为设计》§5,2026-10-30)。中间断了由 recoverPending 补。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendDiary, diaryTopic, entryFor, renderDiaryBlock } from './diary.ts';
import { childItem, proposalsOf } from './proposals.ts';
import { CHILD_MEMORY_AGENT, textHash, type MemoryLine } from './vault-notes.ts';
import type { Bookkeeping, ConversationIndex, ConversationMessage, MemoryProposal, PendingMemory } from '../schema/index.ts';
import { planVaultMemory, writeDiary, type MemoryPlan, type Vault } from './vault.ts';

type Seen = { path: string; hash: string; clip: number };

/**
 * 「## 记忆」段 → 建议与要怎么改(不写)。said = 孩子说过的话(proposals.ts 的 kidSaid),证据拿它对;
 * shared = 这位是有脸的老师,`孩子:` 的那几条进孩子的记忆(不是的照旧进自己的,前缀留着);
 * seen / childSeen = 这轮上下文包里老师看到的两篇的版本(见 planVaultMemory)。写不进(vault 不在、同名文件没属性)进提醒,不影响这一轮
 */
export async function planMemory(
  v: Vault,
  o: { agent: string; display: string; items: readonly string[]; max: number | null; date: string; said: readonly string[]; shared: boolean; seen?: Seen; childSeen?: Seen },
): Promise<{ proposals: MemoryProposal[]; plan: MemoryPlan | null; child: MemoryPlan | null; warnings: string[] }> {
  const warnings: string[] = [];
  if (o.max !== null && o.items.length > o.max) warnings.push(`记忆:一轮最多记 ${o.max} 条,丢了 ${o.items.length - o.max} 条:${o.items.slice(o.max).join(';')}`);
  const proposals = proposalsOf(o.max === null ? o.items : o.items.slice(0, o.max), o.said);
  const rejected = proposals.filter((p) => p.check === 'rejected');
  if (rejected.length) warnings.push(`记忆:证据对不上孩子说过的话,没记:${rejected.map((p) => `${p.item}(证据「${p.quote}」)`).join(';')}`);
  const kept = proposals.filter((p) => p.check !== 'rejected');
  const toChild = (p: MemoryProposal): boolean => o.shared && p.target === 'child';
  const plans: { plan: MemoryPlan | null; child: MemoryPlan | null } = { plan: null, child: null };
  for (const [key, agent, display, items, seen] of [
    ['plan', o.agent, o.display, kept.filter((p) => !toChild(p)).map((p) => p.item), o.seen],
    ['child', CHILD_MEMORY_AGENT, '孩子', kept.filter(toChild).map((p) => childItem(p.item)), o.childSeen],
  ] as const) {
    if (!items.length) continue;
    try {
      const r = await planVaultMemory(v, { agent, display, items, date: o.date, seen });
      plans[key] = r.plan;
      warnings.push(...r.warnings);
    } catch (err) {
      warnings.push(`${key === 'child' ? '孩子的记忆' : '记忆'}没写进去:${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { proposals, ...plans, warnings };
}

/** 进孩子的记忆的那几条,在这轮的 remembered 里前面标一下(家长视图分得清) */
export const childChanges = (changes: readonly string[]): string[] => changes.map((c) => `孩子的记忆:${c}`);

/** 记账那轮的「## 记账」段 → 这个话题在日记里的一段(不写);算成了回那段原文与文件名,没有回为什么 */
export function planDiary(o: { date: string; index: ConversationIndex; thread: string; bookkeeping: Bookkeeping | null; subject: string; keepScore: number }): { block: string; file: string } | { warning: string } {
  if (!o.bookkeeping) return { warning: '记账:老师没回「## 记账」段,日记没写;再点一次记账' };
  const entry = entryFor(o.bookkeeping, o.thread);
  if (!entry) return { warning: `记账:「## 记账」段里没有话题 ${o.thread} 的那条,日记没写` };
  const block = renderDiaryBlock(diaryTopic(o.index, entry, { subject: o.subject, keepScore: o.keepScore }));
  if (!block) return { warning: '记账:这个话题没有孩子的话、摘要、观察,日记没写' };
  return { block, file: `${o.date}.md` };
}

/** 把算好的那段追加到当天日记 */
export async function writeDiaryBlock(v: Vault, date: string, block: string): Promise<void> {
  await writeDiary(v, date, (existing) => appendDiary(existing, block));
}

/** 记忆那笔写成了没有:文件就是写成之后的版本;是写之前的版本 → 没有;都不是(后来又有人改过)就看每一行:改后的那行在、删掉的那行不在 */
export function memoryLanded(text: string, p: { base: string | null; hash: string; lines: readonly MemoryLine[] }): boolean {
  const h = textHash(text);
  if (h === p.hash) return true;
  if (h === p.base) return false;
  const has = new Set(text.split('\n'));
  return p.lines.every((l) => (l.after !== null ? has.has(l.after) : l.before !== null && !has.has(l.before)));
}

/**
 * 写到一半断了的那几笔(索引上还带着 pending 的消息,《运行层行为设计》§5):对照文件里的实际结果补记或丢掉,不重写一遍。
 * 记忆写成了 → 补 remembered / memoryLines(孩子的记忆是 childLines;删话题才撤得回);日记里有那段 → 补 diaryBlock 与 booked(不再记第二遍)。
 * 没写成的丢掉:记账再点一次会重记。都进那条消息的提醒。没有 pending → 原样(changed: false)
 */
export async function recoverPending(v: Vault, index: ConversationIndex): Promise<{ index: ConversationIndex; changed: boolean }> {
  if (!index.messages.some((m) => m.pending)) return { index, changed: false };
  let booked = index.booked;
  const messages: ConversationMessage[] = [];
  for (const m of index.messages) {
    if (!m.pending) { messages.push(m); continue; }
    const { pending: p, ...rest } = m;
    let next: ConversationMessage = rest;
    const notes: string[] = [];
    const remembered: string[] = [];
    for (const [pm, child] of [[p.memory, false], [p.child, true]] as [PendingMemory | undefined, boolean][]) {
      if (!pm) continue;
      const text = await readFile(join(v.paths.vault, pm.file), 'utf8').catch(() => null);
      if (text !== null && memoryLanded(text, pm)) {
        remembered.push(...(child ? childChanges(pm.changes) : pm.changes));
        next = child ? { ...next, childLines: pm.lines } : { ...next, memoryLines: pm.lines };
        notes.push(`${child ? '孩子的记忆' : '记忆'}:上次写完 ${pm.file} 就断了,这轮的改动已补记`);
      } else notes.push(`${child ? '孩子的记忆' : '记忆'}:上次写 ${pm.file} 之前断了,这轮的记忆没写进去`);
    }
    if (remembered.length) next = { ...next, remembered };
    if (p.diary) {
      const text = await readFile(join(v.paths.diary, p.diary.file), 'utf8').catch(() => null);
      if (text?.includes(p.diary.block.trim())) {
        next = { ...next, diaryBlock: p.diary.block };
        booked = { ...booked, [p.diary.thread]: m.job };
        notes.push(`记账:上次写完日记 ${p.diary.file} 就断了,已补记为记过`);
      } else notes.push(`记账:上次写日记 ${p.diary.file} 之前断了,日记没写;再点一次记账`);
    }
    messages.push({ ...next, warnings: [...(next.warnings ?? []), ...notes] });
  }
  return { index: { ...index, messages, booked }, changed: true };
}
