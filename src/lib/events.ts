/**
 * 一轮运行的事件(《工作流程.md》§四):runner 在每道工序的关键点发一条,追加到 <日期>.<job>.events.jsonl,
 * 也给内存里的订阅者(cotutor send 现场打印、serve --trace、以后的时间线站)。三个消费者共用一份事件,不各自再算。
 * 道(lane):main 老师 / tts 配音 / post 板书后期 / ready 就绪 / index 索引 / scene 画图作业 / ledger 账本。t = 从老师进程起算的毫秒。
 * 这里只有形状与格式化,纯函数;发事件的在 server/runner.ts。
 */

export type Lane = 'main' | 'tts' | 'post' | 'ready' | 'index' | 'scene' | 'ledger';
export const LANES: readonly Lane[] = ['main', 'tts', 'post', 'ready', 'index', 'scene', 'ledger'];

export type RunEvent = { t: number } & (
  | { lane: 'main'; kind: 'start'; cli: string; runtime: string; resume: boolean }
  | { lane: 'main'; kind: 'card'; card: number; label: string }
  | { lane: 'main'; kind: 'line'; line: number; text: string }
  | { lane: 'main'; kind: 'tool'; name: string; sub: boolean }
  | { lane: 'main'; kind: 'exit'; ok: boolean; reason?: string; costUsd?: number; turns?: number }
  /** 断流:老师进程 idleMs 没吐一个字节(工具不在跑),杀掉;retry = 接着跑第几次(0 = 次数用完,不再跑),kept = 断前已写出的正文字数 */
  | { lane: 'main'; kind: 'stall'; idleMs: number; retry: number; kept: number }
  | { lane: 'tts'; kind: 'queued'; label: string }
  | { lane: 'tts'; kind: 'done'; label: string; ms: number; file: string }
  | { lane: 'tts'; kind: 'failed'; label: string; ms: number; error: string }
  | { lane: 'post'; kind: 'start'; beat: number; card: number; context: number }
  | { lane: 'post'; kind: 'done'; beat: number; ms: number; kept: { marks: number; anchors: number; look: boolean; row: 'same' | 'new' }; dropped: number; costUsd?: number }
  | { lane: 'post'; kind: 'failed'; beat: number; ms: number; error: string }
  | { lane: 'ready'; kind: 'beat'; beat: number; card: number | null; first: boolean }
  | { lane: 'ready'; kind: 'all'; cards: number; lines: number }
  | { lane: 'index'; kind: 'written'; warnings: number }
  /** 场景卡起了 scene-maker 的一轮 / 没起 */
  | { lane: 'scene'; kind: 'started'; bundle: string; job: string }
  | { lane: 'scene'; kind: 'skipped'; bundle: string; why: string }
  | { lane: 'ledger'; kind: 'artifact'; id: string; status: string }
  /** 记账:话题的一段写进了 vault 的日记(file 是日记文件名) */
  | { lane: 'ledger'; kind: 'diary'; thread: string; file: string }
);

/** 发事件时给的形状:少一个 t(runner 补);Omit 直接套在联合上会塌成公共键,所以逐个分发 */
export type RunEventInput = RunEvent extends infer E ? (E extends RunEvent ? Omit<E, 't'> : never) : never;

/** 内存订阅者拿到的:事件 + 是谁的哪一轮 */
export interface RunEventEnvelope {
  tutor: string;
  date: string;
  job: string;
  event: RunEvent;
}

const secs = (ms: number): string => (ms / 1000).toFixed(2);
const money = (v: number | undefined): string => (v === undefined ? '' : ` · $${v.toFixed(3)}`);

/** 一条事件的一句话(不带时间与道) */
export function describeEvent(e: RunEvent): string {
  switch (e.lane) {
    case 'main':
      if (e.kind === 'start') return `起 ${e.cli}(${e.runtime},${e.resume ? 'resume' : '新会话'})`;
      if (e.kind === 'card') return `卡 ${e.card} ${e.label}`;
      if (e.kind === 'line') return `句 ${e.line}「${e.text}」`;
      if (e.kind === 'tool') return `${e.sub ? '子代理 ' : ''}工具 ${e.name}`;
      if (e.kind === 'stall') return `断流:${secs(e.idleMs)}s 没动静,杀掉${e.retry ? `,resume 接着写(第 ${e.retry} 次${e.kept ? `,已写 ${e.kept} 字` : ''})` : ',接着跑的次数用完了'}`;
      return e.ok ? `退出 ok${e.turns !== undefined ? ` · ${e.turns} turns` : ''}${money(e.costUsd)}` : `退出 出错(${e.reason ?? '?'})${money(e.costUsd)}`;
    case 'tts':
      if (e.kind === 'queued') return `${e.label}排队`;
      if (e.kind === 'done') return `${e.label}✓ ${secs(e.ms)}s`;
      return `${e.label}✗ ${secs(e.ms)}s ${e.error}`;
    case 'post':
      if (e.kind === 'start') return `拍 ${e.beat} 起(卡 ${e.card},前文 ${e.context} 张)`;
      if (e.kind === 'done') return `拍 ${e.beat} ✓ ${secs(e.ms)}s 标 ${e.kept.marks} 锚 ${e.kept.anchors} ${e.kept.row === 'same' ? '接上一行' : '另起一行'}${e.kept.look ? ' 有样子' : ''} 丢 ${e.dropped}${money(e.costUsd)}`;
      return `拍 ${e.beat} ✗ ${secs(e.ms)}s ${e.error}`;
    case 'ready':
      if (e.kind === 'beat') return `拍 ${e.beat} ✓${e.card === null ? '(没有卡)' : `(卡 ${e.card})`}${e.first ? ' ← 首拍就绪' : ''}`;
      return `全部就绪(${e.cards} 张卡 ${e.lines} 句)`;
    case 'index':
      return `写入${e.warnings ? ` · 提醒 ${e.warnings}` : ''}`;
    case 'scene':
      return e.kind === 'started' ? `课包 ${e.bundle} 起了 scene-maker ${e.job}` : `课包 ${e.bundle} 没起:${e.why}`;
    case 'ledger':
      return e.kind === 'diary' ? `日记 ${e.file} 记了话题 ${e.thread}` : `课包 ${e.id} ${e.status}`;
  }
}

/** 控制台的一行:相对秒 · 道 · 一句话 */
export function formatEvent(e: RunEvent): string {
  return `${secs(e.t).padStart(6)} ${e.lane.padEnd(7)} ${describeEvent(e)}`;
}

/** --lane post,tts → 只留这几道;空 / 缺 → 全部 */
export function laneFilter(spec: string | undefined): (e: RunEvent) => boolean {
  const set = new Set((spec ?? '').split(',').map((s) => s.trim()).filter((s) => (LANES as readonly string[]).includes(s)));
  return set.size ? (e) => set.has(e.lane) : () => true;
}

/** events.jsonl → 事件(坏行跳过,不抛) */
export function parseEvents(text: string): RunEvent[] {
  const out: RunEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as RunEvent;
      if (typeof v?.t === 'number' && (LANES as readonly string[]).includes(v.lane) && typeof v.kind === 'string') out.push(v);
    } catch {
      /* 坏行跳过 */
    }
  }
  return out;
}

/** 一拍的埋点(从事件推,不另记账):关 = 下一张卡出现(末拍 = 老师退出)、配音齐 = 这拍最后一句配完、后期回、就绪 */
export interface BeatTiming {
  card: number | null;
  closedMs?: number;
  dubbedMs?: number;
  postMs?: number;
  readyMs?: number;
}
export function beatTimings(events: readonly RunEvent[], beats: readonly { card: number | null; lines: readonly number[] }[]): BeatTiming[] {
  const cardAt = new Map<number, number>();
  const lineDub = new Map<number, number>();
  const postAt = new Map<number, number>();
  const readyAt = new Map<number, number>();
  let exit: number | undefined;
  let all: number | undefined;
  for (const e of events) {
    if (e.lane === 'main' && e.kind === 'card') cardAt.set(e.card, e.t);
    else if (e.lane === 'main' && e.kind === 'exit') exit = e.t;
    else if (e.lane === 'tts' && (e.kind === 'done' || e.kind === 'failed')) { const m = /^第 (\d+) 句/.exec(e.label); if (m) lineDub.set(Number(m[1]) - 1, e.t); }
    else if (e.lane === 'post' && (e.kind === 'done' || e.kind === 'failed')) postAt.set(e.beat, e.t);
    else if (e.lane === 'ready' && e.kind === 'beat') readyAt.set(e.beat, e.t);
    else if (e.lane === 'ready' && e.kind === 'all') all = e.t;
  }
  return beats.map((b, k) => {
    const next = beats[k + 1];
    const closedMs = next && next.card !== null ? cardAt.get(next.card) : exit;
    const dubs = b.lines.map((i) => lineDub.get(i));
    const dubbedMs = b.lines.length && dubs.every((t) => t !== undefined) ? Math.max(...(dubs as number[])) : b.lines.length ? undefined : closedMs;
    const out: BeatTiming = { card: b.card };
    if (closedMs !== undefined) out.closedMs = closedMs;
    if (dubbedMs !== undefined) out.dubbedMs = dubbedMs;
    const post = postAt.get(k);
    if (post !== undefined) out.postMs = post;
    const ready = readyAt.get(k) ?? all;
    if (ready !== undefined) out.readyMs = ready;
    return out;
  });
}

/** 时间线上的一段(甘特):起止、道、一句话、状态;瞬时的事件 to = from */
export interface TimelineSpan {
  lane: Lane;
  from: number;
  to: number;
  label: string;
  state: 'ok' | 'warn' | 'fail';
}
export function timelineSpans(events: readonly RunEvent[]): TimelineSpan[] {
  const out: TimelineSpan[] = [];
  const open = new Map<string, { from: number; label: string }>();
  for (const e of events) {
    if (e.lane === 'main' && e.kind === 'start') open.set('main', { from: e.t, label: describeEvent(e) });
    else if (e.lane === 'main' && e.kind === 'exit') { const o = open.get('main'); out.push({ lane: 'main', from: o?.from ?? 0, to: e.t, label: `老师 ${o?.label ?? ''} → ${describeEvent(e)}`, state: e.ok ? 'ok' : 'fail' }); open.delete('main'); }
    else if (e.lane === 'tts' && e.kind === 'queued') open.set(`tts:${e.label}`, { from: e.t, label: e.label });
    else if (e.lane === 'tts' && (e.kind === 'done' || e.kind === 'failed')) { const o = open.get(`tts:${e.label}`); out.push({ lane: 'tts', from: o?.from ?? e.t, to: e.t, label: describeEvent(e), state: e.kind === 'done' ? 'ok' : 'fail' }); open.delete(`tts:${e.label}`); }
    else if (e.lane === 'post' && e.kind === 'start') open.set(`post:${e.beat}`, { from: e.t, label: describeEvent(e) });
    else if (e.lane === 'post' && (e.kind === 'done' || e.kind === 'failed')) { const o = open.get(`post:${e.beat}`); out.push({ lane: 'post', from: o?.from ?? e.t, to: e.t, label: describeEvent(e), state: e.kind === 'failed' ? 'fail' : e.dropped ? 'warn' : 'ok' }); open.delete(`post:${e.beat}`); }
    else out.push({ lane: e.lane, from: e.t, to: e.t, label: describeEvent(e), state: (e.lane === 'scene' && e.kind === 'skipped') || (e.lane === 'index' && e.warnings) ? 'warn' : 'ok' });
  }
  // 没收尾的(进程还在、或被杀):画到最后一条事件
  const last = events.length ? events[events.length - 1].t : 0;
  for (const [k, o] of open) out.push({ lane: k.split(':')[0] as Lane, from: o.from, to: last, label: `${o.label}(没收尾)`, state: 'warn' });
  return out.sort((a, b) => a.from - b.from);
}
