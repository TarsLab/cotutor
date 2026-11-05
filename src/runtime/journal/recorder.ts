/**
 * 一次通话的录像记录(录数据,不录屏幕):口语课与实时老师共用。
 * 发给孩子端(o)/ 孩子端发来(i)的每条消息带离开始的毫秒;两边的声音每块带到达的毫秒;孩子端清播放队列的时刻;屏幕多大。
 * 按段收(2026-11-06):页面开着不关,一通电话能挂几个钟头,声音全攒在内存里挂断时再混,一个钟头就上 G。
 *   cut() 收下这一段、接着录新的一段;什么时候切由调用方定(call.ts:两轮之间安静着、没动静够久了或这一段够长了)。
 *   ms() 一直是离通话开始的毫秒(调用方的时钟,切段不动它);收下的那一段里的时刻都换成离这一段开始的毫秒。
 *   一段尾巴上没动静的那截不要(TAKE_TAIL_MS 之后);没动静的一段收下来 stirred = false,调用方丢掉;
 *   没动静的一段第一次有动静时,TAKE_LEAD_MS 之前的那截丢掉(孩子走开一个钟头再回来,录像不从一个钟头前开始)。
 * 收下的(RawTake)交给 renderTake:两边按到达时刻混成一条(src/runtime/journal/mix.ts,分片混、不卡事件循环),给出录像的数据(reel.json 的形状)与要落盘的声音;落在哪由调用方定。
 */
import { mixCallSliced, type Chunk } from './mix.ts';

export type ReelMsg = [number, 'o' | 'i', Record<string, unknown>];

/** reel.json:消息、老师出声的时段、孩子有声的时段、屏幕多大;声音另在同名的 .wav(24k 单声道) */
export interface CallReel { v: 1; startedAt: string; ms: number; view: [number, number] | null; msgs: ReelMsg[]; playing: [number, number][]; kidVoice: [number, number][] }

/** 收下的一段,还没混:时刻都是离这一段开始的毫秒(开始之前到的块是负的,混的时候落在外面的不要) */
export interface RawTake {
  startedAt: Date;
  ms: number;
  view: [number, number] | null;
  msgs: ReelMsg[];
  kid: Chunk[];
  tutor: Chunk[];
  flushes: number[];
  /** 这一段有没有动静(孩子按下、发来、嘴说了……);没有的不落 */
  stirred: boolean;
}

export interface CallTake {
  ms: number;
  reel: CallReel;
  /** 两边按时刻混好的一条(MIX_RATE) */
  callPcm: Buffer;
}

/** 一段尾巴上:最后一次动静之后留这么久 */
export const TAKE_TAIL_MS = 2000;
/** 一段开头:第一次动静之前留这么久 */
export const TAKE_LEAD_MS = 2000;
/** 不算动静的:孩子端报屏幕尺寸、说再见;嘴连上、换连接、断了、挂断(只记不发的那几条也在) */
const STILL_IN = new Set(['view', 'bye']);
const STILL_OUT = new Set(['ready', 'swap', 'lost', 'down', 'end']);
/** 孩子端排老师的声音起步(同 mix.ts 的 LEAD_MS):估这块放完的时刻用 */
const TUTOR_LEAD_MS = 60;
const TUTOR_RATE = 24000;

export class CallRecorder {
  readonly startedAt: Date;
  private readonly now: () => Date;
  private msgs: ReelMsg[] = [];
  private kidChunks: Chunk[] = [];
  private tutorChunks: Chunk[] = [];
  private flushes: number[] = [];
  private size: [number, number] | null = null;
  /** 这一段从哪一刻起(离通话开始的毫秒) */
  private base = 0;
  /** 这一段最后一次动静(老师的声音算到它在孩子端放完);没动静时 = base */
  private lastStir = 0;
  private stirredNow = false;
  /** 老师的声音在孩子端排到哪(估的,flush 不截;只用来算最后一次动静) */
  private tutorEnd = 0;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
    this.startedAt = now();
  }

  /** 离通话开始多少毫秒(切段不动它) */
  ms(): number { return this.now().getTime() - this.startedAt.getTime(); }

  /** 这一段多久没动静了 */
  quietMs(): number { return this.ms() - this.lastStir; }

  /** 这一段录了多久 */
  takeMs(): number { return this.ms() - this.base; }

  /** 这一段有过动静没有 */
  get stirred(): boolean { return this.stirredNow; }

  /** 发给孩子端的一条;{t:'flush'} 同时记下清队列的时刻 */
  out(m: Record<string, unknown>): void {
    const t = this.ms();
    this.msgs.push([t, 'o', m]);
    if (m.t === 'flush') { this.flushes.push(t); this.tutorEnd = 0; }
    if (!STILL_OUT.has(String(m.t))) this.stir(t);
  }

  /** 孩子端发来的一条 */
  in(m: Record<string, unknown>, t = this.ms()): void {
    if (!STILL_IN.has(String(m.t))) this.stir(t);
    // 一直听时孩子那一句的开口 / 说完(补记的 hold / release)要记回它当时的时刻,按时刻插进去,录像按顺序读
    let i = this.msgs.length;
    while (i > 0 && this.msgs[i - 1][0] > t) i--;
    this.msgs.splice(i, 0, [t, 'i', m]);
  }

  /** 孩子端清了播放队列,但没有一条 flush 消息(比如换段时页面自己清) */
  flush(): void {
    const t = this.ms();
    this.flushes.push(t);
    this.tutorEnd = 0;
    this.stir(t);
  }

  /** 孩子的一块声音(16k);t 缺省现在(开口前垫上的那几块带自己到的时刻)。不算动静:一直听时没人说话也一直在推 */
  kid(pcm: Buffer, t = this.ms()): void { this.kidChunks.push({ t, pcm }); }

  /** 老师的一块声音(24k):算动静,算到它在孩子端放完 */
  tutor(pcm: Buffer): void {
    const t = this.ms();
    this.tutorChunks.push({ t, pcm });
    this.tutorEnd = Math.max(t + TUTOR_LEAD_MS, this.tutorEnd) + ((pcm.length >> 1) * 1000) / TUTOR_RATE;
    this.stir(t);
    this.lastStir = Math.max(this.lastStir, this.tutorEnd);
  }

  /** 孩子端报的屏幕尺寸;不像样的不记 */
  view(w: unknown, h: unknown): void {
    if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) this.size = [Math.round(w), Math.round(h)];
  }

  /** 收这一段,从现在起录新的一段(调用方在两轮之间安静时切) */
  cut(): RawTake {
    const now = this.ms();
    const raw = this.take(now);
    this.msgs = [];
    this.kidChunks = [];
    this.tutorChunks = [];
    this.flushes = [];
    this.base = now;
    this.lastStir = now;
    this.stirredNow = false;
    this.tutorEnd = 0;
    return raw;
  }

  /** 挂了:收最后一段(ms 缺省现在) */
  finish(ms = this.ms()): RawTake { return this.take(ms); }

  /** 有动静:这一段头一次有动静就把 TAKE_LEAD_MS 之前的丢掉 */
  private stir(t: number): void {
    if (!this.stirredNow) {
      this.stirredNow = true;
      const from = t - TAKE_LEAD_MS;
      if (from > this.base) {
        this.base = from;
        this.msgs = this.msgs.filter(([at]) => at >= from);
        this.kidChunks = this.kidChunks.filter((c) => c.t > from);
        this.tutorChunks = this.tutorChunks.filter((c) => c.t > from);
        this.flushes = this.flushes.filter((at) => at >= from);
      }
    }
    if (t > this.lastStir) this.lastStir = t;
  }

  /** 这一段到 end 为止(有动静的截到最后一次动静 + TAKE_TAIL_MS),时刻换成离这一段开始的毫秒 */
  private take(end: number): RawTake {
    const b = this.base;
    const stop = this.stirredNow ? Math.min(end, this.lastStir + TAKE_TAIL_MS) : end;
    return {
      startedAt: new Date(this.startedAt.getTime() + b),
      ms: Math.max(0, Math.round(stop - b)),
      view: this.size,
      msgs: this.msgs.map(([t, d, m]): ReelMsg => [Math.max(0, t - b), d, m]),
      kid: this.kidChunks.map((c) => ({ t: c.t - b, pcm: c.pcm })),
      tutor: this.tutorChunks.map((c) => ({ t: c.t - b, pcm: c.pcm })),
      flushes: this.flushes.map((t) => t - b),
      stirred: this.stirredNow,
    };
  }
}

/** 混声音、拼录像的数据(分片混,不卡事件循环) */
export async function renderTake(raw: RawTake): Promise<CallTake> {
  const mix = await mixCallSliced({ kid: raw.kid, tutor: raw.tutor, flushes: raw.flushes, ms: raw.ms });
  return {
    ms: raw.ms,
    reel: { v: 1, startedAt: raw.startedAt.toISOString(), ms: raw.ms, view: raw.view, msgs: raw.msgs, playing: mix.playing, kidVoice: mix.kidVoice },
    callPcm: mix.pcm,
  };
}
