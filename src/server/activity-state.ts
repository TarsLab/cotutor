/**
 * activity 话题里应用算的值与拦法的接线(《wip/activity设计.md》§四 4.1、拍板 1):读这个话题的 activity 文件、
 * 数这个话题画了几张、今天还剩几张、上一张为什么没画。纯判断在 src/lib/activity.ts(gatePasses / failingGate),这里只管读盘。
 */
import { readFile } from 'node:fs/promises';
import type { Workspace } from '../cli/workspace.ts';
import { activityFile } from '../cli/activities.ts';
import { failingGate, parseActivity } from '../lib/activity.ts';
import { threads } from '../lib/conversation.ts';
import { PAINT_DEFAULT, type Activity, type ActivityRun, type ActivityValue, type ConversationMessage } from '../schema/index.ts';
import { paintRecordAt, paintedToday } from '../paint/painter.ts';

/** 这个话题是从哪个 activity 起的:话题里第一条带 activity 的消息(只记在第一条);没有 → null */
export function threadActivity(messages: readonly ConversationMessage[], thread: string): ActivityRun | null {
  const ths = threads(messages);
  return messages.find((m, i) => ths[i] === thread && m.activity)?.activity ?? null;
}

/** 读 workspace 里那份 activity 文件;不在 → null */
export async function readActivity(ws: Workspace, tutor: string, name: string): Promise<Activity | null> {
  const text = await readFile(activityFile(ws.root, tutor, name), 'utf8').catch(() => null);
  return text === null ? null : parseActivity(text).activity;
}

/** 这个话题里的画图卡,文件顺序:哪一轮第几张 */
function paintCards(messages: readonly ConversationMessage[], thread: string): { job: string; n: number }[] {
  const ths = threads(messages);
  return messages.flatMap((m, i) => (ths[i] === thread && m.section ? m.section.cards.flatMap((c, n) => (c.kind === 'paint' ? [{ job: m.job, n }] : [])) : []));
}

/**
 * 应用算的值,只算 activity 文件「应用算的」里列了的:
 *   还能画 = 参数「最多画」减这个话题画了的(画好的与在画的),再和今天剩的(paint.daily 减今天各老师画了的)取小的,不小于 0
 *   缺 = 这个话题最后一张画图卡被哪条拦法拦下了;画了、没被拦、还没有画图卡 → 空
 */
export async function activityState(ws: Workspace, tutor: string, date: string, messages: readonly ConversationMessage[], thread: string, run: ActivityRun, a: Pick<Activity, 'state'>, now: number = Date.now()): Promise<Record<string, ActivityValue>> {
  const out: Record<string, ActivityValue> = {};
  const want = new Set(a.state.map((s) => s.name));
  if (!want.size) return out;
  const cards = paintCards(messages, thread);
  const records = await Promise.all(cards.map((c) => paintRecordAt(ws, tutor, date, c.job, c.n, now)));
  if (want.has('还能画')) {
    const drawn = records.filter((r) => r?.state === 'done' || r?.state === 'drawing').length;
    const max = typeof run.params.最多画 === 'number' ? run.params.最多画 : Infinity;
    const daily = Math.max(0, (ws.config.paint ?? PAINT_DEFAULT).daily - (await paintedToday(ws, date, now)));
    out.还能画 = Math.max(0, Math.min(max - drawn, daily));
  }
  if (want.has('缺')) {
    const last = records[records.length - 1];
    out.缺 = last?.state === 'none' && last.error.startsWith('gate:') ? last.error.slice(5) : '';
  }
  return out;
}

/** 这一轮(job)所在话题的 activity 文件「画家收到什么」;不在 activity 话题、文件不在、没有那节 → null(照 cotutor.json 的画风) */
export async function paintTool(ws: Workspace, tutor: string, date: string, job: string): Promise<{ prompt: string; negative?: string } | null> {
  const { readIndex } = await import('./store.ts');
  const index = await readIndex(ws, tutor, date);
  const at = index.messages.findIndex((m) => m.job === job);
  if (at < 0) return null;
  const run = threadActivity(index.messages, threads(index.messages)[at]);
  const t = run ? (await readActivity(ws, tutor, run.name))?.tools.find((x) => x.tool === '画家') : null;
  return t ? { prompt: t.prompt, ...(t.negative ? { negative: t.negative } : {}) } : null;
}

/**
 * 画图前的拦:这一轮(job)在 activity 话题里,就照 activity 文件「应用拦的」查;不在 activity 话题、文件不在 → null(照旧画)。
 * 返回的函数在画图队里现调,同一轮第二张看得到第一张已经在画。
 */
export async function paintGate(ws: Workspace, tutor: string, date: string, job: string, now: () => number): Promise<(() => Promise<string | null>) | null> {
  const { readIndex } = await import('./store.ts');
  const index = await readIndex(ws, tutor, date);
  const at = index.messages.findIndex((m) => m.job === job);
  if (at < 0) return null;
  const thread = threads(index.messages)[at];
  const run = threadActivity(index.messages, thread);
  const a = run ? await readActivity(ws, tutor, run.name) : null;
  if (!run || !a || !a.gates.length) return null;
  return async () => {
    const latest = await readIndex(ws, tutor, date);
    const ths = threads(latest.messages);
    const mine = latest.messages.filter((_, i) => ths[i] === thread);
    // 这一轮还没轮到的卡没有记录,不算;同一轮前面那张已经在画,算
    const state = await activityState(ws, tutor, date, mine, thread, run, { state: [{ name: '还能画', type: '数', line: 0 }] }, now());
    return failingGate(a, { thread: mine, job, state });
  };
}
