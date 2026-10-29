/**
 * 老师回的结构化段落进 vault(从 runner 拆出来,2026-10-29,行为不变):老师(LLM)不直接写 vault,回结构化段由应用落盘,
 * 写了什么、没写成为什么都回给调用方,进这一轮的提醒。
 * - 「## 记忆」:增 / 改 / 删落进这位 agent 的记忆文件;讲课的轮每轮最多 max 条,多的丢(整理轮 max = null 不限)
 * - 「## 记账」:这个话题在日记里的一段(打分不够只留孩子问与观察),追加到当天日记
 * 记账去重(索引的 booked)、删话题时撤回要的原文(memoryLines、diaryBlock)由调用方记在这一轮的索引上。
 */
import { appendDiary, diaryTopic, entryFor, renderDiaryBlock } from './diary.ts';
import type { MemoryLine } from './vault-notes.ts';
import type { Bookkeeping, ConversationIndex } from '../schema/index.ts';
import { updateVaultMemory, writeDiary, type Vault } from './vault.ts';

/** 「## 记忆」段落进 agent 的记忆文件;写不进(vault 不在、同名文件没属性)进提醒,不影响这一轮 */
export async function commitMemory(v: Vault, o: { agent: string; display: string; items: readonly string[]; max: number | null; date: string }): Promise<{ changes: string[]; lines: MemoryLine[]; warnings: string[] }> {
  const warnings: string[] = [];
  if (o.max !== null && o.items.length > o.max) warnings.push(`记忆:一轮最多记 ${o.max} 条,丢了 ${o.items.length - o.max} 条:${o.items.slice(o.max).join(';')}`);
  try {
    const r = await updateVaultMemory(v, o.agent, o.display, o.max === null ? o.items : o.items.slice(0, o.max), o.date);
    return { changes: r.changes, lines: r.lines, warnings: [...warnings, ...r.warnings] };
  } catch (err) {
    return { changes: [], lines: [], warnings: [...warnings, `记忆没写进去:${err instanceof Error ? err.message : String(err)}`] };
  }
}

/** 记账那轮的「## 记账」段 → 这个话题在日记里的一段,追加到当天日记;写成了回那段原文与文件名,没写成回为什么 */
export async function commitDiary(
  v: Vault,
  o: { date: string; index: ConversationIndex; thread: string; bookkeeping: Bookkeeping | null; subject: string; keepScore: number },
): Promise<{ block: string; file: string } | { warning: string }> {
  if (!o.bookkeeping) return { warning: '记账:老师没回「## 记账」段,日记没写;再点一次记账' };
  const entry = entryFor(o.bookkeeping, o.thread);
  if (!entry) return { warning: `记账:「## 记账」段里没有话题 ${o.thread} 的那条,日记没写` };
  const topic = diaryTopic(o.index, entry, { subject: o.subject, keepScore: o.keepScore });
  const block = renderDiaryBlock(topic);
  if (!block) return { warning: '记账:这个话题没有孩子的话、摘要、观察,日记没写' };
  const file = await writeDiary(v, o.date, (existing) => appendDiary(existing, block));
  return { block, file };
}
