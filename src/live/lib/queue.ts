/**
 * 照念的排队(《wip/实时老师开发计划.md》P2.4):脑一拍一拍写完的讲稿,等嘴有空再交给它念。纯函数,时间都是通话的毫秒。
 * 嘴有空 = 孩子没按着、嘴没在出回答、上一段声音估计已经放完,再静 GAP_MS(Qwen-Live-Harness injector 的窗口)。
 * 孩子按下 = 打断:没念完的拍都丢,那一轮(job)后面再来的拍也丢;报一句孩子听到哪(cut,讲稿第几句,1 起),下一轮进上下文包 live:。
 */

/** 一拍的讲稿:哪一轮、讲稿第几句(0 起)、句子 */
export interface Beat { job: string; lines: number[]; texts: string[] }

export interface QueueState {
  pending: Beat[];
  /** 交给嘴、嘴还在出的那一拍 */
  reading: Beat | null;
  /** 这一轮最后交给嘴的那一拍(嘴出完了声音可能还在放);孩子松手开新一轮时清掉 */
  last: Beat | null;
  holding: boolean;
  responding: boolean;
  /** 嘴的声音估计放到哪一刻 */
  playedAt: number;
  /** 最近交进来的那一轮;打断时它后面再来的拍都丢 */
  lastJob: string | null;
  dropJob: string | null;
}

export type QueueEvent =
  | { e: 'beat'; t: number; beat: Beat }
  /** drop = 这一刻正在答的那一轮(调用方知道,它的拍可能还没来):打断后它的拍都丢 */
  | { e: 'hold'; t: number; drop?: string | null }
  | { e: 'release'; t: number }
  | { e: 'created'; t: number }
  | { e: 'done'; t: number; playedAt: number }
  | { e: 'tick'; t: number };

/** read = 把这一拍交给嘴;cut = 孩子打断了:嘴在说就掐、孩子端清播放队列,line 是孩子听到的讲稿第几句(没在念讲稿就是 null) */
export type QueueAction = { kind: 'read'; beat: Beat } | { kind: 'cut'; line: number | null; speaking: boolean } | null;

/** 放完再静多久才交下一拍 */
export const GAP_MS = 300;

export const queueInit = (): QueueState => ({ pending: [], reading: null, last: null, holding: false, responding: false, playedAt: 0, lastJob: null, dropJob: null });

function drain(s: QueueState, t: number): { s: QueueState; act: QueueAction } {
  if (s.holding || s.responding || s.reading || !s.pending.length || t < s.playedAt + GAP_MS) return { s, act: null };
  const [beat, ...rest] = s.pending;
  return { s: { ...s, pending: rest, reading: beat, last: beat }, act: { kind: 'read', beat } };
}

export function queueStep(s: QueueState, ev: QueueEvent): { s: QueueState; act: QueueAction } {
  switch (ev.e) {
    case 'beat':
      if (ev.beat.job === s.dropJob || !ev.beat.texts.some((x) => x.trim())) return { s, act: null };
      return drain({ ...s, pending: [...s.pending, ev.beat], lastJob: ev.beat.job }, ev.t);
    case 'hold': {
      const playing = s.responding || ev.t < s.playedAt;
      // 孩子听到哪:声音还在出 / 在放,就是正在念的那拍的第一句(接住孩子的那句在放时不算讲稿,null);
      // 没在出声、还有排着的,就是排着的第一句(一句没听到)
      const at = playing ? (s.reading ?? s.last) : (s.pending[0] ?? null);
      const line = at ? at.lines[0] + 1 : null;
      const busy = playing || s.reading !== null || s.pending.length > 0;
      const next: QueueState = { ...s, holding: true, pending: [], reading: null, dropJob: ev.drop ?? (busy ? s.lastJob : s.dropJob), playedAt: Math.min(s.playedAt, ev.t) };
      return { s: next, act: busy ? { kind: 'cut', line, speaking: playing } : null };
    }
    case 'release':
      return { s: { ...s, holding: false, last: null }, act: null };
    case 'created':
      return { s: { ...s, responding: true }, act: null };
    case 'done':
      return drain({ ...s, responding: false, reading: null, playedAt: Math.max(s.playedAt, ev.playedAt) }, ev.t);
    case 'tick':
      return drain(s, ev.t);
  }
}
