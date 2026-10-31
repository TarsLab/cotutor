/**
 * 实时那一轮的交付(从 call.ts 拆出来,2026-10-29,行为不变):
 * 讲稿排队(src/runtime/delivery/queue.ts)、嘴的声音在孩子端排到哪(src/runtime/delivery/playback.ts)、告诉孩子端第几句开始放、打断时孩子听到第几句。
 * 哪一拍该交给嘴由排队定,交给嘴(要嘴说、热身那句要不要等孩子)由 LiveCall 在 onRead 里做;嘴这次回答的进度(要了没、出完没)也在 LiveCall。
 * - 按句不按拍(2026-10-19):讲稿定稿一句交一句(lines),嘴一空就把排着的几句一起交给它照念
 * - 一段照念的第一句按第一块声音到孩子端的时刻发 read;第二句起等这段的声音出齐、按字数比例摊(readRest)
 * - 打断(cut):孩子端在放的那段里亮到了哪句就报哪句,还没亮报段首;这一轮一句都没念到就被打断报 0;进下一轮的上下文包 live:,带了就清
 */
import type { MouthEvent } from '../journal/mouth.ts';
import { addChunk, flushAt, playbackInit, playingAt, type Playback } from './playback.ts';
import { queueInit, queueStep, type Beat, type Echo, type QueueEvent, type QueueState } from './queue.ts';

/** 嘴这次回答是什么:接住(孩子这一轮)、照念哪几句、边画边聊(哪张画) */
export type Said = { kind: 'catch' } | { kind: 'read'; beat: Beat } | { kind: 'chat'; canvas: string };

export interface DeliveryDeps {
  /** 通话里的毫秒(录像的钟) */
  now(): number;
  /** 发给孩子端 */
  send(o: Record<string, unknown>): void;
  /** 记嘴这一道的一条事件(那一轮起来了补进它的 events.jsonl) */
  event(job: string | null, at: number, ev: MouthEvent): void;
  /** 排队说这一拍该交给嘴了 */
  onRead(beat: Beat): void;
  ended(): boolean;
}

export class Delivery {
  private q: QueueState = queueInit();
  /** 嘴的声音在孩子端排到哪(按它的排法算),每段带它是接住还是哪一拍 */
  private play: Playback<Said> = playbackInit();
  /** 最近告诉孩子端开始放的那句;打断时报它 */
  private lastRead: { job: string; line: number } | null = null;
  /** 最近开始放的那句是问句:孩子再开口就是在答(接住只「嗯」一声,cue 的 answer) */
  private askedNow = false;
  /** 一段里第一句的 read(挂电话时撤)与第二句起的(按字数摊的时刻;打断时撤) */
  private readonly firstTimers: NodeJS.Timeout[] = [];
  private readTimers: NodeJS.Timeout[] = [];
  /** 正在写的那一轮(脑)与已经交给排队的讲稿句数 */
  private current: string | null = null;
  private queued = 0;
  /** 上一轮讲稿念到第几句被打断(1 起);交给脑时带上,带了就清 */
  private cutAt: number | undefined;
  private readonly deps: DeliveryDeps;
  constructor(deps: DeliveryDeps) {
    this.deps = deps;
  }

  get job(): string | null {
    return this.current;
  }
  get asked(): boolean {
    return this.askedNow;
  }
  /** 排着没交给嘴的拍数、闸关着没有(小课堂那段、热身那句、打电话的铃) */
  get pending(): number {
    return this.q.pending.length;
  }
  get gated(): QueueState['gated'] {
    return this.q.gated;
  }
  /** 嘴的声音在孩子端放到什么时候(通话毫秒) */
  get end(): number {
    return this.play.end;
  }

  /** 排队走一步;该交给嘴的交给 onRead;回按下时丢掉的拍 */
  step(ev: QueueEvent): Beat[] {
    const { s, act } = queueStep(this.q, ev);
    this.q = s;
    if (act?.kind === 'read') this.deps.onRead(act.beat);
    return act?.kind === 'dropped' ? act.beats : [];
  }

  /** 告诉排队一件事,不管它回什么(要了接住、松手、开口暂停) */
  note(ev: QueueEvent): void {
    this.q = queueStep(this.q, ev).s;
  }

  /** 嘴这次回答完了(或断了):排队可以交下一段 */
  idle(): void {
    this.q = { ...this.q, busy: false };
  }

  /** 交给嘴的那段一个字都没出就卡住了:放回排头,换好连接 done 了再交 */
  retry(beat: Beat): void {
    this.note({ e: 'retry', beat });
  }

  /** 嘴的一块声音到了:接在孩子端排着的后面;回它在孩子端开始放的时刻 */
  add(said: Said, ms: number): number {
    const r = addChunk(this.play, said, this.deps.now(), ms);
    this.play = r.p;
    return r.start;
  }

  /** 孩子端清了播放队列:时间线从 at(缺省现在)截断 */
  flush(at = this.deps.now()): void {
    this.play = flushAt(this.play, at);
  }

  /** 脑开始写新的一轮 */
  begin(job: string): void {
    this.current = job;
    this.queued = 0;
  }

  /** 讲稿又定稿了几句:按序号接着交给排队(重复的、跳号的不收) */
  lines(lines: { i: number; text: string; play?: boolean; echo?: Echo; call?: true }[]): void {
    if (!this.current) return;
    for (const l of lines) {
      if (l.i !== this.queued) continue;
      this.queued++;
      this.step({ e: 'beat', beat: { job: this.current, lines: [l.i], texts: [l.text], ...(l.play ? { play: true } : {}), ...(l.echo ? { echo: l.echo } : {}), ...(l.call ? { call: true as const } : {}) } });
    }
  }

  /** 到 at(孩子端放到的时刻)告诉孩子端:这一段的第 k 句开始放了 */
  readAt(beat: Beat, k: number, at: number): void {
    const t = setTimeout(() => {
      if (this.deps.ended() || this.q.dropJob === beat.job) return;
      this.lastRead = { job: beat.job, line: beat.lines[k] };
      this.askedNow = /[?？]\s*$/.test(beat.texts[k] ?? '');
      // play:这句念完孩子端放小课堂那一段(放完回 staged);echo:念完卡亮「轮到你」;call:念完响铃
      const last = k === beat.lines.length - 1;
      this.deps.send({ t: 'read', job: beat.job, line: beat.lines[k], text: beat.texts[k], ...(beat.play && last ? { play: true } : {}), ...(beat.echo && last ? { echo: true } : {}), ...(beat.call && last ? { call: true } : {}) });
      this.deps.event(beat.job, Date.now(), { lane: 'mouth', kind: 'read', line: beat.lines[k] });
    }, Math.max(0, at - this.deps.now()));
    (k === 0 ? this.firstTimers : this.readTimers).push(t);
  }

  /** 一段照念的声音出齐了:这段在孩子端从哪放到哪已知,第二句起按字数比例摊开各发一个 read */
  readRest(said: Said & { kind: 'read' }): void {
    const { beat } = said;
    const span = this.play.spans.find((x) => x.tag === said);
    if (!span || beat.lines.length < 2) return;
    const lens = beat.texts.map((x) => Math.max(1, x.length));
    const total = lens.reduce((a, b) => a + b, 0);
    let before = lens[0];
    for (let k = 1; k < beat.lines.length; k++) {
      this.readAt(beat, k, span.start + ((span.end - span.start) * before) / total);
      before += lens[k];
    }
  }

  /**
   * 孩子按下(或不是说的那一轮开始):排着的丢掉,记下孩子听到第几句,撤掉还没发的 read。
   * playing = 嘴的声音还在出 / 还在放;said = 嘴这次在要的回答;now = 打断的时刻
   */
  interrupt(playing: boolean, said: Said | null, now: number): void {
    const at = playingAt(this.play, now)?.tag;
    const dropped = this.step({ e: 'hold', drop: this.current });
    const heard = at?.kind === 'read' ? at.beat : said?.kind === 'read' ? said.beat : dropped[0];
    // 孩子端在放的那段里亮到了哪句就报哪句;那段还没亮(声音没到孩子端)报段首
    if (heard) this.cutAt = (this.lastRead && this.lastRead.job === heard.job && heard.lines.includes(this.lastRead.line) ? this.lastRead.line : heard.lines[0]) + 1;
    // 脑这一轮还一句都没念到(还没写出第一句)就被打断:报 0,下一轮脑才知道孩子一句没听到
    // (10-20 21:18 连着两轮在第一句之前被按掉,脑以为提示给过了,下一轮直接讲了答案)
    else if (this.current && this.lastRead?.job !== this.current) this.cutAt = 0;
    if (playing && this.current) this.deps.event(this.current, Date.now(), { lane: 'mouth', kind: 'cut', line: at?.kind === 'read' && this.lastRead?.job === this.current ? this.lastRead.line : null });
    for (const t of this.readTimers.splice(0)) clearTimeout(t);
  }

  /** 交给脑时带上上一轮念到第几句被打断;带了就清 */
  takeCut(): number | undefined {
    const c = this.cutAt;
    this.cutAt = undefined;
    return c;
  }

  /** 挂电话:还没发的 read 都撤 */
  stop(): void {
    for (const t of [...this.firstTimers, ...this.readTimers]) clearTimeout(t);
  }
}
