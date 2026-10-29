/**
 * 实时那一轮的两样记录(从 call.ts 拆出来,2026-10-29,行为不变):
 * - MouthEvents:嘴这一道的事件(按下、松手、接住、第几句开始放、打断)补进那一轮的 events.jsonl(Runner.noteEvent)。
 *   按下、松手、接住在脑起来之前,先攒着,等那一轮的老师进程起来(main:start)再按它的起点换成相对毫秒(负的)
 * - MouthTakes:字幕重放。嘴照念的声音按轮另留一份,出了的都留(孩子按下时清掉、没放出来的也在);
 *   一段出完(或被掐、断了)就落 <日期>.<job>.mouth.wav 与每句的起点 .mouth.json(lib/mouth.ts);接住那句不在里面。内存里只留最近几轮
 */
import { writeFile } from 'node:fs/promises';
import { conversationFiles } from '../lib/conversation.ts';
import type { RunEvent } from '../lib/events.ts';
import type { Beat } from './lib/queue.ts';
import { mouthIndex, type MouthSeg } from './lib/mouth.ts';
import { wavOfPcm } from './lib/wav.ts';

/** 嘴这一道的一条(没有 t;补进事件时按那一轮的起点换) */
export type MouthEvent = Extract<RunEvent, { lane: 'mouth' }> extends infer E ? (E extends RunEvent ? Omit<E, 't'> : never) : never;

export class MouthEvents {
  /** 每一轮老师进程起来的墙钟(换相对毫秒用)、日期 */
  private readonly runT0 = new Map<string, { t0: number; date: string }>();
  /** 还没到那一轮的(墙钟) */
  private pre: { at: number; ev: MouthEvent }[] = [];
  private readonly note: (date: string, job: string, event: RunEvent) => void;
  constructor(note: (date: string, job: string, event: RunEvent) => void) {
    this.note = note;
  }

  /** 记一条:那一轮起来了就补进它的事件,还不知道是哪一轮(job = null)就先攒着 */
  record(job: string | null, at: number, ev: MouthEvent): void {
    const r = job ? this.runT0.get(job) : undefined;
    if (job && r) this.note(r.date, job, { t: at - r.t0, ...ev } as RunEvent);
    else if (!job) this.pre.push({ at, ev });
  }

  /** 新起一轮的头几条(按下、松手…):攒着的换成这几条 */
  begin(evs: { at: number; ev: MouthEvent }[]): void {
    this.pre = evs;
  }

  /** 这一轮的老师进程起来了:攒着的按它的起点补进它的事件 */
  started(job: string, date: string, t0: number): void {
    this.runT0.set(job, { t0, date });
    for (const x of this.pre.splice(0)) this.record(job, x.at, x.ev);
  }

  /** 接住说完了:攒着的那条接住补上字 */
  caught(text: string): void {
    const c = [...this.pre].reverse().find((x) => x.ev.kind === 'catch');
    if (c && c.ev.kind === 'catch') c.ev.text = text;
  }
}

type Seg = MouthSeg & { key: object; pcm: Buffer[] };
/** 一轮嘴照念的声音:每段是一次照念的回答;writing 把这一轮的落盘串起来 */
interface MouthTake {
  date: string;
  segs: Seg[];
  writing: Promise<void>;
}

export class MouthTakes {
  private readonly takes = new Map<string, MouthTake>();
  private readonly conversations: () => string;
  private readonly tutor: string;
  private readonly keep: number;
  private readonly bytesPerMs: number;
  private readonly rate: number;
  constructor(opts: { conversations: () => string; tutor: string; keep: number; bytesPerMs: number; rate: number }) {
    this.conversations = opts.conversations;
    this.tutor = opts.tutor;
    this.keep = opts.keep;
    this.bytesPerMs = opts.bytesPerMs;
    this.rate = opts.rate;
  }

  /** 这一轮的声音从这里接;更早的几轮落过盘了,内存里只留最近几轮 */
  open(job: string, date: string): void {
    this.takes.set(job, { date, segs: [], writing: Promise.resolve() });
    for (const old of [...this.takes.keys()].slice(0, -this.keep)) this.takes.delete(old);
  }

  /** 这次照念(key 认那一次)在它那一轮里的那一段(第一块声音到时开;make = false 只找不开);那一轮不在内存里的不留 */
  seg(key: object, beat: Beat, make = true): Seg | null {
    const take = this.takes.get(beat.job);
    if (!take) return null;
    const last = take.segs[take.segs.length - 1];
    if (last?.key === key) return last;
    if (!make) return null;
    const seg: Seg = { lines: [...beat.lines], texts: [...beat.texts], bytes: 0, heard: 0, done: false, key, pcm: [] };
    take.segs.push(seg);
    return seg;
  }

  /** 一段出完了(done)/ 被掐了、断了:这一轮整份重落一次(接在前面的落盘后面,不并发写) */
  end(key: object, beat: Beat, done: boolean): void {
    const seg = this.seg(key, beat, false);
    if (!seg) return;
    seg.done = done;
    const job = beat.job;
    const take = this.takes.get(job)!;
    const pcm = Buffer.concat(take.segs.flatMap((s) => s.pcm));
    const index = mouthIndex(take.segs, this.bytesPerMs);
    const f = conversationFiles(this.conversations(), this.tutor, take.date);
    take.writing = take.writing
      .then(async () => {
        await writeFile(f.mouth(job, 'wav'), wavOfPcm(pcm, this.rate));
        await writeFile(f.mouth(job, 'json'), JSON.stringify(index));
      })
      .catch((err) => console.error('live: 嘴的声音落盘失败', err));
  }

  /** 等这几轮都落完(挂电话时) */
  async flush(): Promise<void> {
    await Promise.all([...this.takes.values()].map((x) => x.writing));
  }
}
