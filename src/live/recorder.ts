/**
 * 一次通话的录像记录(录数据,不录屏幕;《家长录像设计.md》、《口语课设计.md》§8.3):口语课与实时老师共用。
 * 发给孩子端(o)/ 孩子端发来(i)的每条消息带离开始的毫秒;两边的声音每块带到达的毫秒;孩子端清播放队列的时刻;屏幕多大。
 * 挂了 finish:两边按到达时刻混成一条(lib/mix.ts),给出录像的数据(reel.json 的形状)与要落盘的声音;落在哪、还落什么由调用方定。
 */
import { mixCall, type Chunk } from './lib/mix.ts';

export type ReelMsg = [number, 'o' | 'i', Record<string, unknown>];

/** reel.json:消息、老师出声的时段、孩子有声的时段、屏幕多大;声音另在 call.wav(24k 单声道) */
export interface CallReel { v: 1; startedAt: string; ms: number; view: [number, number] | null; msgs: ReelMsg[]; playing: [number, number][]; kidVoice: [number, number][] }

export interface CallTake {
  ms: number;
  reel: CallReel;
  /** 两边按时刻混好的一条(MIX_RATE) */
  callPcm: Buffer;
  /** 两边各自首尾相接(孩子 16k、老师 24k),没有时刻 */
  kidPcm: Buffer;
  tutorPcm: Buffer;
}

export class CallRecorder {
  readonly startedAt: Date;
  private readonly now: () => Date;
  private readonly msgs: ReelMsg[] = [];
  private readonly kidChunks: Chunk[] = [];
  private readonly tutorChunks: Chunk[] = [];
  private readonly flushes: number[] = [];
  private size: [number, number] | null = null;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
    this.startedAt = now();
  }

  /** 离开始多少毫秒 */
  ms(): number { return this.now().getTime() - this.startedAt.getTime(); }

  /** 发给孩子端的一条;{t:'flush'} 同时记下清队列的时刻 */
  out(m: Record<string, unknown>): void {
    const t = this.ms();
    this.msgs.push([t, 'o', m]);
    if (m.t === 'flush') this.flushes.push(t);
  }

  /** 孩子端发来的一条 */
  in(m: Record<string, unknown>, t = this.ms()): void {
    // 一直听时孩子那一句的开口 / 说完(补记的 hold / release)要记回它当时的时刻,按时刻插进去,录像按顺序读
    let i = this.msgs.length;
    while (i > 0 && this.msgs[i - 1][0] > t) i--;
    this.msgs.splice(i, 0, [t, 'i', m]);
  }

  /** 孩子端清了播放队列,但没有一条 flush 消息(比如换段时页面自己清) */
  flush(): void { this.flushes.push(this.ms()); }

  /** 孩子的一块声音(16k);t 缺省现在(开口前垫上的那几块带自己到的时刻) */
  kid(pcm: Buffer, t = this.ms()): void { this.kidChunks.push({ t, pcm }); }

  /** 老师的一块声音(24k) */
  tutor(pcm: Buffer): void { this.tutorChunks.push({ t: this.ms(), pcm }); }

  /** 孩子端报的屏幕尺寸;不像样的不记 */
  view(w: unknown, h: unknown): void {
    if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) this.size = [Math.round(w), Math.round(h)];
  }

  /** 收:混声音、拼录像的数据(ms 缺省现在) */
  finish(ms = this.ms()): CallTake {
    const mix = mixCall({ kid: this.kidChunks, tutor: this.tutorChunks, flushes: this.flushes, ms });
    return {
      ms,
      reel: { v: 1, startedAt: this.startedAt.toISOString(), ms, view: this.size, msgs: this.msgs, playing: mix.playing, kidVoice: mix.kidVoice },
      callPcm: mix.pcm,
      kidPcm: Buffer.concat(this.kidChunks.map((c) => c.pcm)),
      tutorPcm: Buffer.concat(this.tutorChunks.map((c) => c.pcm)),
    };
  }
}
