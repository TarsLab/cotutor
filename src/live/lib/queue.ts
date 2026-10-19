/**
 * 照念的排队(《wip/实时老师开发计划.md》P2.4):脑写完的讲稿一拍一拍进来,嘴一空就交给它。纯函数。
 * 2026-10-19 改成流水线:原来等上一段声音放完再交,段与段之间静 1.3 秒;嘴出字比念快得多(一段字 1.9 秒出完、声音要放 11.6 秒),
 * 现在嘴出完上一段就交下一段,声音在孩子端接着排,中间不空。排着的几拍一次交(同一轮的并成一段念)。
 * 孩子按下 = 打断:排着的都丢,那一轮后面再来的拍也丢;孩子听到哪由调用方按声音排到哪算(lib/playback.ts)。
 */

/** 一拍的讲稿:哪一轮、讲稿第几句(0 起)、句子 */
export interface Beat { job: string; lines: number[]; texts: string[] }

export interface QueueState {
  pending: Beat[];
  /** 嘴有一次回答要了还没出完(接住或照念) */
  busy: boolean;
  holding: boolean;
  /** 最近交进来的那一轮;打断时它后面再来的拍都丢 */
  lastJob: string | null;
  dropJob: string | null;
}

export type QueueEvent =
  | { e: 'beat'; beat: Beat }
  /** drop = 这一刻正在答的那一轮(调用方知道,它的拍可能还没来):打断后它的拍都丢 */
  | { e: 'hold'; drop?: string | null }
  | { e: 'release' }
  /** 调用方让嘴说了一句别的(接住):嘴出完之前不交讲稿 */
  | { e: 'asked' }
  | { e: 'done' };

/** read = 把这几句交给嘴;dropped = 按下时还排着没交的(调用方算孩子听到哪) */
export type QueueAction = { kind: 'read'; beat: Beat } | { kind: 'dropped'; beats: Beat[] } | null;

export const queueInit = (): QueueState => ({ pending: [], busy: false, holding: false, lastJob: null, dropJob: null });

function drain(s: QueueState): { s: QueueState; act: QueueAction } {
  if (s.holding || s.busy || !s.pending.length) return { s, act: null };
  const job = s.pending[0].job;
  const take = s.pending.filter((b) => b.job === job);
  const beat: Beat = { job, lines: take.flatMap((b) => b.lines), texts: take.flatMap((b) => b.texts) };
  return { s: { ...s, pending: s.pending.filter((b) => b.job !== job), busy: true }, act: { kind: 'read', beat } };
}

export function queueStep(s: QueueState, ev: QueueEvent): { s: QueueState; act: QueueAction } {
  switch (ev.e) {
    case 'beat':
      if (ev.beat.job === s.dropJob || !ev.beat.texts.some((x) => x.trim())) return { s, act: null };
      return drain({ ...s, pending: [...s.pending, ev.beat], lastJob: ev.beat.job });
    case 'hold':
      return { s: { ...s, holding: true, pending: [], dropJob: ev.drop ?? s.lastJob }, act: s.pending.length ? { kind: 'dropped', beats: s.pending } : null };
    case 'release':
      return drain({ ...s, holding: false });
    case 'asked':
      return { s: { ...s, busy: true }, act: null };
    case 'done':
      return drain({ ...s, busy: false });
  }
}
