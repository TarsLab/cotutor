/**
 * 工作台概览(2026-10-16,《工作台设计.md》):把近七天各老师的会话索引读一遍,算成一页数字。
 * 只读不写;只看 conversations/ 下的索引(回放在 evals/,不算)与今天画了几张。
 * 「轮」只算孩子的话(from: kid);记账、整理记忆这类应用派的任务(from: system)单记,钱和 token 照算进用量。
 */
import { localDate, weekOf } from '../lib/conversation.ts';
import type { ConversationMessage } from '../schema/conversation.ts';
import { listTutors } from '../schema/config.ts';
import type { Workspace } from '../cli/workspace.ts';
import { paintedToday } from '../paint/painter.ts';
import { readIndex } from './store.ts';

/** 首句就绪(没有就首卡)超过它算慢;与工作台对话页的 SLOW_FIRST 同数 */
export const SLOW_FIRST_MS = 15_000;
const MAX_ISSUES = 8;

export interface DevIssue {
  kind: 'slow' | 'error' | 'warn';
  tutor: string;
  date: string;
  job: string;
  /** 消息的 at(到分钟) */
  at: string;
  /** 孩子那句话(截短) */
  text: string;
  /** 一句说明:多慢、什么错、什么提醒 */
  detail: string;
}

export interface DevTutorRow {
  name: string;
  display: string;
  hidden: boolean;
  enabled: boolean;
  /** 今天跑过就是最后一轮用的,没跑过是 cotutor.json 配的 */
  runtime: string;
  turns: number;
  firstMedianMs: number | null;
  lastAt: string | null;
}

export interface DevOverview {
  today: string;
  /** 近七天每天孩子说了几轮,升序,最后一天是今天 */
  days: { date: string; turns: number }[];
  todayTurns: number;
  todayTasks: number;
  todayThreads: number;
  lastAt: string | null;
  /** 近七天最新的一轮(孩子的话):概览「看原文」直达它 */
  last: { tutor: string; date: string; job: string; at: string } | null;
  firstMedianMs: number | null;
  doneMedianMs: number | null;
  slow: number;
  tutors: DevTutorRow[];
  /** 近七天,按运行时分:报钱数的记美元,只报 token 的记 token */
  usage: { runtime: string; turns: number; costUsd: number; tokensIn: number; tokensOut: number }[];
  paint: { today: number; daily: number };
  issues: DevIssue[];
}

const median = (xs: number[]): number | null => {
  const a = xs.slice().sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};
const firstOf = (m: ConversationMessage): number | undefined => m.timing?.firstReadyMs ?? m.timing?.firstCardMs;
const clip = (s: string, n = 40): string => (s.length > n ? s.slice(0, n) + '…' : s);
const secs = (ms: number): string => (ms < 10_000 ? (ms / 1000).toFixed(1) : String(Math.round(ms / 1000))) + ' s';

export async function devOverview(ws: Workspace, now: Date = new Date()): Promise<DevOverview> {
  const today = localDate(now);
  const days = weekOf(today, today);
  const tutors = listTutors(ws.config);
  const perDay = new Map(days.map((d) => [d, 0]));
  const usage = new Map<string, { runtime: string; turns: number; costUsd: number; tokensIn: number; tokensOut: number }>();
  const issues: DevIssue[] = [];
  const todayFirst: number[] = [];
  const todayDone: number[] = [];
  const threads = new Set<string>();
  let todayTasks = 0;
  let slow = 0;
  let lastAt: string | null = null;
  let last: DevOverview['last'] = null;
  const rows: DevTutorRow[] = [];

  for (const t of tutors) {
    const row: DevTutorRow = { name: t.name, display: t.display, hidden: Boolean(t.hidden), enabled: t.enabled, runtime: ws.config.tutors[t.name]?.runtime ?? ws.config.runtimes.default, turns: 0, firstMedianMs: null, lastAt: null };
    const firsts: number[] = [];
    for (const date of days) {
      const index = await readIndex(ws, t.name, date).catch(() => null);
      if (!index) continue;
      for (const m of index.messages) {
        const kid = m.from === 'kid';
        const rt = m.runtime ?? ws.config.runtimes.default;
        const u = usage.get(rt) ?? { runtime: rt, turns: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 };
        u.turns++;
        u.costUsd += m.costUsd ?? 0;
        u.tokensIn += m.tokens?.in ?? 0;
        u.tokensOut += m.tokens?.out ?? 0;
        usage.set(rt, u);
        if (kid) perDay.set(date, (perDay.get(date) ?? 0) + 1);
        if (kid && (!last || m.at > last.at)) last = { tutor: t.name, date, job: m.job, at: m.at };
        const first = firstOf(m);
        const base = { tutor: t.name, date, job: m.job, at: m.at, text: clip(m.text) };
        if (m.result === 'error') issues.push({ ...base, kind: 'error', detail: m.error || '出错了' });
        else if (first !== undefined && first > SLOW_FIRST_MS) issues.push({ ...base, kind: 'slow', detail: (m.timing?.firstReadyMs !== undefined ? '首句就绪 ' : '首卡 ') + secs(first) });
        else if (m.warnings?.length) issues.push({ ...base, kind: 'warn', detail: clip(m.warnings[0], 60) + (m.warnings.length > 1 ? ` 等 ${m.warnings.length} 条` : '') });
        if (date !== today) continue;
        if (!kid) { todayTasks++; continue; }
        row.turns++;
        row.runtime = rt;
        if (!row.lastAt || m.at > row.lastAt) row.lastAt = m.at;
        if (!lastAt || m.at > lastAt) lastAt = m.at;
        threads.add(t.name + '/' + (m.thread ?? m.job));
        if (first !== undefined) { firsts.push(first); todayFirst.push(first); if (first > SLOW_FIRST_MS) slow++; }
        if (m.timing?.doneMs !== undefined) todayDone.push(m.timing.doneMs);
      }
    }
    row.firstMedianMs = median(firsts);
    rows.push(row);
  }

  issues.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return {
    today,
    days: days.map((date) => ({ date, turns: perDay.get(date) ?? 0 })),
    todayTurns: perDay.get(today) ?? 0,
    todayTasks,
    todayThreads: threads.size,
    lastAt,
    last,
    firstMedianMs: median(todayFirst),
    doneMedianMs: median(todayDone),
    slow,
    tutors: rows,
    usage: [...usage.values()].sort((a, b) => b.turns - a.turns),
    paint: { today: await paintedToday(ws, today, now.getTime()).catch(() => 0), daily: ws.config.paint.daily },
    issues: issues.slice(0, MAX_ISSUES),
  };
}
