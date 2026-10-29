/**
 * 照念的排队:脑写完的讲稿一拍一拍进来,嘴一空就交给它。纯函数。
 * 2026-10-19 改成流水线:原来等上一段声音放完再交,段与段之间静 1.3 秒;嘴出字比念快得多(一段字 1.9 秒出完、声音要放 11.6 秒),
 * 现在嘴出完上一段就交下一段,声音在孩子端接着排,中间不空。排着的几拍一次交(同一轮的并成一段念)。
 * 孩子按下 = 打断:排着的都丢,那一轮后面再来的拍也丢;孩子听到哪由调用方按声音排到哪算(src/runtime/delivery/playback.ts)。
 * 讲稿的 [[play]](小课堂,P3.2):并段到那句为止;交出去以后关闸,孩子端放完那一段(staged)才交后面的。
 * 一直听:孩子开口先 pause(不交新的、也不丢),判出这句是对老师说的才 hold(丢),放过就 release 接着交。
 * 热身:讲稿的 [[echo 词]] / [[say 词]] 同 [[play]],并段到那句为止、交出去关闸,孩子跟完(或等够了)echoed 才交后面的;
 * [[call]] 并段到那句为止、交出去关闸(孩子端响铃),铃响够了 rung 才交打电话那一轮的;那一轮后面再来的拍都不要(打电话那段由下一轮写)。
 */

/** 热身那句要孩子说的:word = 记号里的词;say = 你先说(老师没说出这个词) */
export interface Echo { word: string; say?: true }

/** 一拍的讲稿:哪一轮、讲稿第几句(0 起)、句子;play = 最后一句念完孩子端放小课堂那一段;echo = 最后一句念完等孩子跟;call = 最后一句念完进打电话 */
export interface Beat { job: string; lines: number[]; texts: string[]; play?: boolean; echo?: Echo; call?: true }

export interface QueueState {
  pending: Beat[];
  /** 嘴有一次回答要了还没出完(接住或照念) */
  busy: boolean;
  holding: boolean;
  /** 最近交进来的那一轮;打断时它后面再来的拍都丢 */
  lastJob: string | null;
  dropJob: string | null;
  /** 交给嘴的那段最后一句要放小课堂(play:孩子端放完 staged 之前不交下一段)、要孩子跟(echo:孩子跟完 echoed 之前不交)、进打电话(call:铃响够了 rung 之前不交) */
  gated: false | 'play' | 'echo' | 'call';
  /** 念过 [[call]] 的那一轮:后面再来的拍都不要 */
  closedJob: string | null;
}

export type QueueEvent =
  | { e: 'beat'; beat: Beat }
  /** drop = 这一刻正在答的那一轮(调用方知道,它的拍可能还没来):打断后它的拍都丢 */
  | { e: 'hold'; drop?: string | null }
  /** 一直听时孩子开口:还不知道是不是对老师说的,先不交新的、排着的不丢;release 接着交 */
  | { e: 'pause' }
  | { e: 'release' }
  /** 调用方让嘴说了一句别的(接住):嘴出完之前不交讲稿 */
  | { e: 'asked' }
  | { e: 'done' }
  /** 孩子端放完了小课堂那一段(或放不了、被关) */
  | { e: 'staged' }
  /** 孩子跟完了 [[echo]] / [[say]] 那句(或等够了没开口) */
  | { e: 'echoed' }
  /** [[call]] 那句放完、铃响够了 */
  | { e: 'rung' };

/** read = 把这几句交给嘴;dropped = 按下时还排着没交的(调用方算孩子听到哪) */
export type QueueAction = { kind: 'read'; beat: Beat } | { kind: 'dropped'; beats: Beat[] } | null;

export const queueInit = (): QueueState => ({ pending: [], busy: false, holding: false, lastJob: null, dropJob: null, gated: false, closedJob: null });

/** 这拍念完要停下来等的(小课堂、孩子跟)或这一轮到此为止的(打电话) */
const stops = (b: Beat): boolean => Boolean(b.play || b.echo || b.call);

function drain(s: QueueState): { s: QueueState; act: QueueAction } {
  if (s.holding || s.busy || s.gated || !s.pending.length) return { s, act: null };
  const job = s.pending[0].job;
  const take: Beat[] = [];
  for (const b of s.pending) {
    if (b.job !== job) continue;
    take.push(b);
    if (stops(b)) break;
  }
  const last = take[take.length - 1];
  const beat: Beat = { job, lines: take.flatMap((b) => b.lines), texts: take.flatMap((b) => b.texts), ...(last.play ? { play: true } : {}), ...(last.echo ? { echo: last.echo } : {}), ...(last.call ? { call: true as const } : {}) };
  // [[call]]:那一轮排着的、后面再来的都不要
  const pending = s.pending.filter((b) => !take.includes(b) && !(last.call && b.job === job));
  return { s: { ...s, pending, busy: true, gated: last.play ? 'play' : last.echo ? 'echo' : last.call ? 'call' : false, ...(last.call ? { closedJob: job } : {}) }, act: { kind: 'read', beat } };
}

export function queueStep(s: QueueState, ev: QueueEvent): { s: QueueState; act: QueueAction } {
  switch (ev.e) {
    case 'beat':
      if (ev.beat.job === s.dropJob || ev.beat.job === s.closedJob || !ev.beat.texts.some((x) => x.trim())) return { s, act: null };
      return drain({ ...s, pending: [...s.pending, ev.beat], lastJob: ev.beat.job });
    case 'hold':
      return { s: { ...s, holding: true, pending: [], gated: false, dropJob: ev.drop ?? s.lastJob }, act: s.pending.length ? { kind: 'dropped', beats: s.pending } : null };
    case 'pause':
      return { s: { ...s, holding: true }, act: null };
    case 'release':
      return drain({ ...s, holding: false });
    case 'asked':
      return { s: { ...s, busy: true }, act: null };
    case 'done':
      return drain({ ...s, busy: false });
    // 各开各的闸:小课堂放完开不了等孩子跟的闸,反过来也一样;没关闸时照常交
    case 'staged':
      return s.gated && s.gated !== 'play' ? { s, act: null } : drain({ ...s, gated: false });
    case 'echoed':
      return s.gated && s.gated !== 'echo' ? { s, act: null } : drain({ ...s, gated: false });
    case 'rung':
      return s.gated && s.gated !== 'call' ? { s, act: null } : drain({ ...s, gated: false });
  }
}
