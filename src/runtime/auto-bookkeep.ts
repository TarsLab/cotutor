/**
 * 自动记账(《vault重构方案》§5,2026-10-30;cotutor.json 的 vault.autoBookkeep,缺省关):serve 隔一阵跑一次 autoBookkeep。
 * - 今天的:话题空闲过 AUTO_BOOKKEEP_IDLE_MS(2 小时)才记;不整理记忆——孩子晚上可能还来,一天只整理一次
 * - 昨天的:没记的都记,记完整理一次记忆(那天还没整理过才整理);服务停了一夜,第二天起来补上
 * - 更早的不管:刚打开开关时不把以前的一股脑记了(花钱),要记家长点「记账」
 * 只记有脸的老师的;没有孩子的话也没打分的不记(同家长点记账);记账没成的(老师没回记账段)一个话题最多试 AUTO_BOOKKEEP_TRIES 次。
 * 打分只决定写不写摘要与骨架(diary.ts),自动记账不等家长打分。
 */
import { kidQuestions } from '../memory/diary.ts';
import { localDate } from '../shared/time.ts';
import { threads, type ConversationIndex, type ConversationMessage, type Workspace } from '../schema/index.ts';
import { readIndex } from './journal/store.ts';
import type { Runner } from './runner.ts';

export const AUTO_BOOKKEEP_IDLE_MS = 2 * 60 * 60 * 1000;
export const AUTO_BOOKKEEP_TRIES = 2;
/** serve 隔多久看一次 */
export const AUTO_BOOKKEEP_EVERY_MS = 10 * 60 * 1000;

/** 一轮最后有动静的时刻:开始的那分钟(at,本地时间,和 runner 的时钟同源)+ 跑了多久 */
const lastAt = (m: ConversationMessage): number => new Date(m.at).getTime() + (m.timing?.doneMs ?? 0);

/** 这一天该自动记哪几个话题、记完要不要整理记忆。past = 不是今天(不等空闲) */
export function dueBookkeeping(index: Pick<ConversationIndex, 'messages' | 'booked' | 'ratings'>, o: { now: Date; past: boolean }): { threads: string[]; tidy: boolean } {
  const ths = threads(index.messages);
  const due: string[] = [];
  for (const th of new Set(ths.filter((_, i) => !index.messages[i].tidy))) {
    if (index.booked[th]) continue;
    const mine = index.messages.filter((_, i) => ths[i] === th);
    if (mine.some((m) => m.result === 'running')) continue;
    if (!kidQuestions(index.messages, th).length && index.ratings[th] === undefined) continue;
    if (mine.filter((m) => m.bookkeep).length >= AUTO_BOOKKEEP_TRIES) continue;
    const talk = mine.filter((m) => !m.bookkeep);
    if (!o.past && talk.length && o.now.getTime() - Math.max(...talk.map(lastAt)) < AUTO_BOOKKEEP_IDLE_MS) continue;
    due.push(th);
  }
  const booked = due.length > 0 || Object.keys(index.booked).length > 0;
  return { threads: due, tidy: o.past && booked && !index.messages.some((m) => m.tidy) };
}

/** 昨天(本地日期) */
const dayBefore = (now: Date): string => localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

/**
 * 跑一次:开关(vault.autoBookkeep)关着什么都不做;每位有脸的老师,先昨天再今天,该记的记、该整理的整理,一位一位来(等上一位记完)。
 * 老师正在回(孩子在用)就跳过,下次再看。返回这次记了什么(给测试看)
 */
export async function autoBookkeep(runner: Runner, ws: Workspace, now: Date): Promise<{ tutor: string; date: string; threads: string[]; tidied: boolean }[]> {
  const out: { tutor: string; date: string; threads: string[]; tidied: boolean }[] = [];
  if (!ws.config.vault.autoBookkeep) return out;
  for (const [tutor, t] of Object.entries(ws.config.tutors)) {
    if (!tutor.endsWith('-tutor') || t.enabled === false) continue;
    for (const [date, past] of [[dayBefore(now), true], [localDate(now), false]] as const) {
      if (runner.running(tutor)) break;
      const due = dueBookkeeping(await readIndex(ws, tutor, date), { now, past });
      try {
        if (due.threads.length) {
          const r = await runner.bookkeep(tutor, date, due.threads, { tidy: due.tidy });
          await r.done;
          out.push({ tutor, date, threads: r.queued, tidied: due.tidy });
        } else if (due.tidy) {
          const tidy = await runner.tidyMemory(tutor, date);
          if (tidy) await tidy.done;
          if (tidy) out.push({ tutor, date, threads: [], tidied: true });
        }
      } catch {
        /* 老师刚好忙起来(BusyError)、索引坏了:这次不记,下次再看 */
      }
    }
  }
  return out;
}
