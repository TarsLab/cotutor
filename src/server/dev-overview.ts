/**
 * 工作台概览(2026-10-16,《工作台设计.md》):把近七天各老师的会话索引读一遍,算成一页数字。
 * 只读不写;只看 conversations/ 下的索引(回放在 evals/,不算)、今天画了几张(不限张数,只数)、孩子端的流水与设备表(《孩子端流水设计.md》§五)。
 * 「轮」只算孩子的话(from: kid);记账、整理记忆这类应用派的任务(from: system)单记,钱和 token 照算进用量。
 */
import { localDate, localMinute, weekOf } from '../lib/conversation.ts';
import type { ConversationMessage } from '../schema/conversation.ts';
import { listTutors } from '../schema/config.ts';
import type { Workspace } from '../cli/workspace.ts';
import { paintedToday } from '../paint/painter.ts';
import { readIndex } from './store.ts';
import { readDevices, readKidLog, type KidDevice, type KidLogLine } from './kid-log.ts';
import { deviceLabel } from '../lib/kid-device.ts';

/** 首句就绪(没有就首卡)超过它算慢;与工作台对话页的 SLOW_FIRST 同数 */
export const SLOW_FIRST_MS = 15_000;
const MAX_ISSUES = 8;

export interface DevIssue {
  /** js = 孩子端页面脚本出错(流水里的 error;tutor、job 可能是空的) */
  kind: 'slow' | 'error' | 'warn' | 'js';
  tutor: string;
  date: string;
  job: string;
  /** 消息的 at(到分钟) */
  at: string;
  /** 孩子那句话(截短) */
  text: string;
  /** 一句说明:多慢、什么错、什么提醒 */
  detail: string;
  /** 页面出错:同一条(报错 + 位置 + 页面 + 页面版本)七天里合成一条 */
  js?: { page: string; mode: string; where: string; stack: string; count: number; devices: string[]; first: string; thread: string | null };
}

/** 概览「设备」卡的一行(近 30 天开过的) */
export interface DevDevice {
  id: string;
  name: string | null;
  label: string;
  last: string;
  /** 今天开了几次 */
  today: number;
  /** 近 7 天页面出错几条 */
  errors: number;
  /** 最近一次打开时服务端的提交(7.1) */
  commit: string | null;
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
  paint: { today: number };
  issues: DevIssue[];
  /** 近 30 天开过的设备,最近开的在前;更早的折起来 */
  devices: DevDevice[];
  olderDevices: DevDevice[];
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

  const kid = await kidSide(ws, today, days);
  issues.push(...kid.issues);
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
    paint: { today: await paintedToday(ws, today, now.getTime()).catch(() => 0) },
    issues: issues.slice(0, MAX_ISSUES),
    devices: kid.devices,
    olderDevices: kid.older,
  };
}

const DEVICE_DAYS = 30;

/** 设备卡与页面出错(《孩子端流水设计.md》§五):设备表 + 近 7 天的流水 */
async function kidSide(ws: Workspace, today: string, days: readonly string[]): Promise<{ devices: DevDevice[]; older: DevDevice[]; issues: DevIssue[] }> {
  const table = await readDevices(ws);
  const log = await readKidLog(ws, days).catch(() => [] as KidLogLine[]);
  const nameOf = (id: string, ua: string): string => table[id]?.name ?? table[id]?.label ?? deviceLabel({ ua });
  const errorsBy = new Map<string, number>();
  const groups = new Map<string, DevIssue & { js: NonNullable<DevIssue['js']> }>();
  for (const l of log) {
    if (l.k !== 'error') continue;
    errorsBy.set(l.device, (errorsBy.get(l.device) ?? 0) + 1);
    // 流水的时刻是 ISO(UTC),概览别的轮次是本地的「日期T时:分」,换成一样的
    const at = localMinute(new Date(l.at));
    const tutor = typeof l.ctx?.tutor === 'string' ? l.ctx.tutor : '';
    const thread = typeof l.ctx?.thread === 'string' ? l.ctx.thread : null;
    const dev = nameOf(l.device, l.ua);
    const key = [l.msg, l.where, l.page, l.v].join('\u0000');
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { kind: 'js', tutor, date: at.slice(0, 10), job: '', at, text: clip(l.msg, 80), detail: `${l.page}${l.mode && l.mode !== 'kid' ? `(${l.mode})` : ''} · ${l.where || '—'}`, js: { page: l.page, mode: l.mode, where: l.where, stack: l.stack, count: 1, devices: [dev], first: at, thread } });
      continue;
    }
    g.js.count++;
    if (!g.js.devices.includes(dev)) g.js.devices.push(dev);
    // 流水按时刻追加,后来的就是最近一次:时刻、老师、话题跟着它
    g.at = at;
    g.date = at.slice(0, 10);
    if (tutor) g.tutor = tutor;
    if (thread) g.js.thread = thread;
  }
  const floor = new Date(Date.parse(`${today}T00:00:00`) - (DEVICE_DAYS - 1) * 86_400_000).toISOString();
  const opensToday = new Map<string, number>();
  for (const l of log) if (l.k === 'open' && localDate(new Date(l.at)) === today) opensToday.set(l.device, (opensToday.get(l.device) ?? 0) + 1);
  const all = Object.entries(table).sort((a, b) => (a[1].last < b[1].last ? 1 : -1));
  const row = ([id, d]: [string, KidDevice]): DevDevice => ({ id, name: d.name ?? null, label: d.label, last: d.last, today: opensToday.get(id) ?? 0, errors: errorsBy.get(id) ?? 0, commit: d.commit ?? null });
  return {
    devices: all.filter(([, d]) => d.last >= floor).map(row),
    older: all.filter(([, d]) => d.last < floor).map(row),
    issues: [...groups.values()],
  };
}
