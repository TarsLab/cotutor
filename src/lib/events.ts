/**
 * 一轮运行的事件(《工作流程.md》§四):runner 在每道工序的关键点发一条,追加到 <日期>.<job>.events.jsonl,
 * 也给内存里的订阅者(cotutor send 现场打印、serve --trace、以后的时间线站)。三个消费者共用一份事件,不各自再算。
 * 道(lane):main 老师 / tts 配音 / ready 就绪 / index 索引 / ledger 账本 / mouth 实时老师的嘴(老事件里的 scene 道读的时候滤掉)。t = 从老师进程起算的毫秒;
 * mouth 道是通话(src/live/call.ts)补进来的,孩子按下、松手、嘴接住都在老师进程起来之前,t 是负的。
 * 这里只有形状与格式化,纯函数;发事件的在 server/runner.ts。
 */

export type Lane = 'main' | 'tts' | 'ready' | 'index' | 'ledger' | 'mouth';
export const LANES: readonly Lane[] = ['main', 'tts', 'ready', 'index', 'ledger', 'mouth'];

export type RunEvent = { t: number } & (
  /** warmMs:用的是提前起好的进程(预热),它等了多久 */
  | { lane: 'main'; kind: 'start'; cli: string; runtime: string; resume: boolean; warmMs?: number }
  | { lane: 'main'; kind: 'card'; card: number; label: string }
  /** play:这句的 [[play]] 锚着小课堂卡(念完放那一段;实时时服务端等孩子端放完再交后面的句子);echo / call:热身的 [[echo 词]] [[say 词]] 与 [[call]](实时时服务端等孩子跟、进打电话) */
  | { lane: 'main'; kind: 'line'; line: number; text: string; play?: true; echo?: { word: string; say?: true }; call?: true }
  | { lane: 'main'; kind: 'tool'; name: string; sub: boolean }
  | { lane: 'main'; kind: 'exit'; ok: boolean; reason?: string; costUsd?: number; turns?: number }
  /** 断流:老师进程 idleMs 没吐一个字节(工具不在跑),杀掉;retry = 接着跑第几次(0 = 次数用完,不再跑),kept = 断前已写出的正文字数 */
  | { lane: 'main'; kind: 'stall'; idleMs: number; retry: number; kept: number }
  | { lane: 'tts'; kind: 'queued'; label: string }
  | { lane: 'tts'; kind: 'done'; label: string; ms: number; file: string }
  | { lane: 'tts'; kind: 'failed'; label: string; ms: number; error: string }
  | { lane: 'ready'; kind: 'beat'; beat: number; card: number | null; first: boolean }
  /** 第一句配好了,能开口了(首句就绪;2026-10-08 起比第一拍早,《工作流程.md》拍板 15) */
  | { lane: 'ready'; kind: 'speak' }
  | { lane: 'ready'; kind: 'all'; cards: number; lines: number }
  | { lane: 'index'; kind: 'written'; warnings: number }
  /** 记账:话题的一段写进了 vault 的日记(file 是日记文件名) */
  | { lane: 'ledger'; kind: 'diary'; thread: string; file: string }
  /** 实时老师的嘴(《wip/实时老师设想.md》):孩子按下 · 松手(voice)或发了不是说的(text / photo / card;ask 是卡上的「?」,拍板 18 撤了,旧记录里还有)· 嘴接住的声音开始在孩子端放 ·
   *  讲稿第几句开始放 · 孩子按下打断了这一轮(line = 正念到第几句,0 起;还没念到讲稿 = null) */
  | { lane: 'mouth'; kind: 'hold' }
  /** vad = 一直听时孩子说完(服务端 VAD 判的、应用收下了) */
  | { lane: 'mouth'; kind: 'release'; how: 'voice' | 'vad' | 'text' | 'photo' | 'card' | 'ask' }
  | { lane: 'mouth'; kind: 'catch'; text: string }
  | { lane: 'mouth'; kind: 'read'; line: number }
  | { lane: 'mouth'; kind: 'cut'; line: number | null }
  /** 脑想得久(松手几秒了讲稿还一句没有),嘴垫了一句(开始放) */
  | { lane: 'mouth'; kind: 'fill'; text: string }
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
      if (e.kind === 'start') return `起 ${e.cli}(${e.runtime},${e.resume ? 'resume' : '新会话'}${e.warmMs !== undefined ? `,预热 ${(e.warmMs / 1000).toFixed(1)}s 前起好` : ''})`;
      if (e.kind === 'card') return `卡 ${e.card} ${e.label}`;
      if (e.kind === 'line') return `句 ${e.line}「${e.text}」`;
      if (e.kind === 'tool') return `${e.sub ? '子代理 ' : ''}工具 ${e.name}`;
      if (e.kind === 'stall') return `断流:${secs(e.idleMs)}s 没动静,杀掉${e.retry ? `,resume 接着写(第 ${e.retry} 次${e.kept ? `,已写 ${e.kept} 字` : ''})` : ',接着跑的次数用完了'}`;
      return e.ok ? `退出 ok${e.turns !== undefined ? ` · ${e.turns} turns` : ''}${money(e.costUsd)}` : `退出 出错(${e.reason ?? '?'})${money(e.costUsd)}`;
    case 'tts':
      if (e.kind === 'queued') return `${e.label}排队`;
      if (e.kind === 'done') return `${e.label}✓ ${secs(e.ms)}s`;
      return `${e.label}✗ ${secs(e.ms)}s ${e.error}`;
    case 'ready':
      if (e.kind === 'speak') return '第一句配好了 ← 首句就绪(能开口)';
      if (e.kind === 'beat') return `拍 ${e.beat} ✓${e.card === null ? '(没有卡)' : `(卡 ${e.card})`}${e.first ? ' ← 第一拍' : ''}`;
      return `全部就绪(${e.cards} 张卡 ${e.lines} 句)`;
    case 'index':
      return `写入${e.warnings ? ` · 提醒 ${e.warnings}` : ''}`;
    case 'ledger':
      return `日记 ${e.file} 记了话题 ${e.thread}`;
    case 'mouth':
      if (e.kind === 'hold') return '孩子按下';
      if (e.kind === 'release') return e.how === 'voice' ? '松手' : e.how === 'vad' ? '说完(一直听)' : `发了(${{ text: '打字', photo: '照片', card: '交卡', ask: '卡上的「?」' }[e.how]})`;
      if (e.kind === 'catch') return `嘴接住「${e.text}」(开始放)`;
      if (e.kind === 'read') return `嘴念第 ${e.line + 1} 句(开始放)`;
      if (e.kind === 'fill') return `脑还在想,嘴垫了一句「${e.text}」(开始放)`;
      return `孩子按下,打断${e.line === null ? '(讲稿还没念到)' : `(念到第 ${e.line + 1} 句)`}`;
  }
}

/** 控制台的一行:相对秒 · 道 · 一句话 */
export function formatEvent(e: RunEvent): string {
  return `${secs(e.t).padStart(6)} ${e.lane.padEnd(7)} ${describeEvent(e)}`;
}

/** --lane main,tts → 只留这几道;空 / 缺 → 全部 */
export function laneFilter(spec: string | undefined): (e: RunEvent) => boolean {
  const set = new Set((spec ?? '').split(',').map((s) => s.trim()).filter((s) => (LANES as readonly string[]).includes(s)));
  return set.size ? (e) => set.has(e.lane) : () => true;
}

/** events.jsonl → 事件(坏行跳过,不抛);按 t 排(嘴这一道是事后补的,t 比文件里前面的还早) */
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
  return out.sort((a, b) => a.t - b.t);
}

/** 一拍的埋点(从事件推,不另记账):关 = 下一张卡出现(末拍 = 老师退出)、配音齐 = 这拍最后一句配完、就绪 */
export interface BeatTiming {
  card: number | null;
  closedMs?: number;
  dubbedMs?: number;
  readyMs?: number;
}
export function beatTimings(events: readonly RunEvent[], beats: readonly { card: number | null; lines: readonly number[] }[]): BeatTiming[] {
  const cardAt = new Map<number, number>();
  const lineDub = new Map<number, number>();
  const readyAt = new Map<number, number>();
  let exit: number | undefined;
  let all: number | undefined;
  for (const e of events) {
    if (e.lane === 'main' && e.kind === 'card') cardAt.set(e.card, e.t);
    else if (e.lane === 'main' && e.kind === 'exit') exit = e.t;
    else if (e.lane === 'tts' && (e.kind === 'done' || e.kind === 'failed')) { const m = /^第 (\d+) 句/.exec(e.label); if (m) lineDub.set(Number(m[1]) - 1, e.t); }
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
    else out.push({ lane: e.lane, from: e.t, to: e.t, label: describeEvent(e), state: e.lane === 'index' && e.warnings ? 'warn' : 'ok' });
  }
  // 没收尾的(进程还在、或被杀):画到最后一条事件
  const last = events.length ? events[events.length - 1].t : 0;
  for (const [k, o] of open) out.push({ lane: k.split(':')[0] as Lane, from: o.from, to: last, label: `${o.label}(没收尾)`, state: 'warn' });
  return out.sort((a, b) => a.from - b.from);
}
