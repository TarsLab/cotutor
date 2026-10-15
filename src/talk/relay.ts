/**
 * 一次通话的中转:孩子端的 WebSocket ↔ 百炼 realtime(《口语课设计.md》§三)。
 * 跟读与聊各一条 realtime 会话(silence 喂过音频改不了,见 realtime.ts);两边的声音与字都记下,挂了落盘(store.finishCall)。
 *
 * 孩子端 → 这里:二进制帧 = PCM16 16k 单声道一块;文本帧 = JSON
 *   {t:'again'} 再听老师读 · {t:'next'} 下一句(到头开聊)· {t:'chat'} 直接开聊 · {t:'bye'} 挂断
 *   只记进录像的:{t:'say', w} 孩子点了单词卡上的「听」(浏览器的声,不经这里)· {t:'view', w, h} 屏幕多大
 * 这里 → 孩子端:二进制帧 = PCM16 24k 老师的声音;文本帧 = JSON
 *   {t:'state', phase, i, n, item, speaking, deadline, interrupt, rd} · {t:'tutor', delta} / {t:'tutor', done} · {t:'kid', text} · {t:'flush'}(清播放队列)· {t:'err', msg} · {t:'end', why}
 *   {t:'card', i}(聊那段老师讲到口语单上第 i 个词:那张单词卡亮、写一遍;由这里从老师的字里认,录像照它放)
 *   rd(跟读段)= {mode: tutor|listen|speech|heard|wait, left: 离自动再读还有几毫秒 | null, wait: 一共等几毫秒, again: 这句自动再读了几遍}
 *
 * 录像(§8.3,录数据不录屏幕):发给孩子端的每条消息、孩子端发来的每条都带毫秒记下(reel.json),两边的声音照到达时刻混成 call.wav(lib/mix.ts);
 *   录像模式把这些消息原样喂回孩子端页面自己的处理函数,画出来就是孩子当时看到的。
 *
 * 轮次:跟读段手动轮次,但不用按(§8.1,lib/read-flow.ts)——孩子端在老师放声时不推,这里按响度判开口 / 停:开口起把声音(带 300 毫秒前垫)推给模型,
 *   停了 commit 拿转写,读到这句的词过半就下一句(「接一两个词 + 下一句」一次回答),不到就再读;老师读完几秒没开口也再读。老师的声音什么时候放完由这里估
 *   (第一块到的时刻 + 声音长度),孩子端不用报。聊那段 semantic_vad——声音一直推(interrupt=false 时孩子端自己在老师放声时不推),
 * 模型判出孩子开口(speech_started)就掐掉正在出的回答、让孩子端清播放队列。
 */
import type { TalkConfig } from '../schema/config.ts';
import { readInit, readLeft, readStep, vadInit, vadStep, type ReadEvent, type ReadState, type Vad } from './lib/read-flow.ts';
import { appears, itemsOf, type Line, type ListItem } from './lib/used.ts';
import { mixCall, type Chunk } from './lib/mix.ts';
import { rms } from './lib/wav.ts';
import { chatCloseCue, chatInstructions, chatOpenCue, readAgainCue, readCue, readInstructions, readLastCue, readNextCue, readSummary } from './prompt.ts';
import { INPUT_RATE, OUTPUT_RATE, RealtimeSession, type Usage } from './realtime.ts';
import { finishCall, type TalkMeta } from './store.ts';
import type { ServerSocket } from './ws.ts';

export interface CallDeps {
  root: string;
  config: TalkConfig;
  kidName: string;
  env?: NodeJS.ProcessEnv;
  /** 测试用:realtime 的端点 */
  endpoint?: string;
  now?: () => Date;
  /** 落盘完了(测试等它) */
  onFinished?(why: string): void;
}

type Phase = 'read' | 'chat' | 'ended';

/** 整个通话最长;聊那段孩子多久不出声就收 */
const CALL_MAX_MS = 20 * 60_000;
const IDLE_MS = 3 * 60_000;
/** 开口前垫上几块(100 毫秒一块):响度判出开口要 200 毫秒,头一个音别丢了 */
const PREROLL = 3;
/** 老师的声音放完再多等一点才算放完(孩子端排队有 60 毫秒起步,网络也慢一点) */
const IDLE_PAD_MS = 300;
/** 跟读段多久看一次钟(自动再读、转写超时) */
const READ_TICK_MS = 200;

export class TalkCall {
  private phase: Phase = 'read';
  private i = 0;
  private readonly items: ListItem[];
  private session: RealtimeSession | null = null;
  private speaking = false;
  /** 跟读段:一句的状态、响度判开口、开口前垫的几块、在不在往模型推、读完最后一句要开聊 */
  private rd: ReadState = readInit();
  private vad: Vad = vadInit();
  private preroll: Chunk[] = [];
  private pushing = false;
  private toChat = false;
  /** 这次回答的第一块声音什么时候到、一共多少字节(估老师什么时候放完) */
  private firstAudioAt: number | null = null;
  private answerBytes = 0;
  /** 聊那段:这次回答到现在的字、这次回答里亮过哪几张单词卡 */
  private answerText = '';
  private lit = new Set<number>();
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly lines: Line[] = [];
  private readonly kidLines: string[] = [];
  /** 两边的声音,每块带到达的毫秒(混 call.wav 用) */
  private readonly kidPcm: Chunk[] = [];
  private readonly tutorPcm: Chunk[] = [];
  /** 录像:发出去 / 收进来的每条消息 [毫秒, o|i, 消息];孩子端清播放队列的时刻;屏幕多大 */
  private readonly rec: [number, 'o' | 'i', Record<string, unknown>][] = [];
  private readonly flushes: number[] = [];
  private view: [number, number] | null = null;
  private usage: Usage = { input: 0, output: 0, inputAudio: 0, outputAudio: 0 };
  private readonly startedAt: Date;
  private deadline: number | null = null;
  private closing = false;
  private ended = false;
  private readonly afterIdle: (() => void)[] = [];
  private timers: NodeJS.Timeout[] = [];
  private lastKidAudioAt = 0;
  private readonly meta: TalkMeta;
  private readonly sock: ServerSocket;
  private readonly deps: CallDeps;

  constructor(meta: TalkMeta, sock: ServerSocket, deps: CallDeps) {
    this.meta = meta;
    this.sock = sock;
    this.deps = deps;
    this.items = itemsOf(meta.list);
    this.startedAt = (deps.now ?? (() => new Date()))();
  }

  private ms(): number { return (this.deps.now ?? (() => new Date()))().getTime() - this.startedAt.getTime(); }
  private send(o: Record<string, unknown>): void {
    const t = this.ms();
    this.rec.push([t, 'o', o]);
    if (o.t === 'flush') this.flushes.push(t);
    this.sock.sendText(JSON.stringify(o));
  }
  private state(): void {
    const rules = this.deps.config.read;
    const rd = this.phase === 'read' ? { mode: this.rd.mode, left: readLeft(this.rd, this.ms(), rules), wait: rules.waitMs, again: this.rd.again } : null;
    this.send({ t: 'state', phase: this.phase, i: this.i, n: this.items.length, item: this.items[this.i] ?? null, speaking: this.speaking, deadline: this.deadline, interrupt: this.deps.config.interrupt, rd });
  }
  private note(who: Line['who'], text: string): void {
    if (!text) return;
    this.lines.push({ who, text, at: this.ms(), phase: this.phase === 'ended' ? 'chat' : this.phase, ...(this.phase === 'read' ? { item: this.i } : {}) });
    if (who === 'kid') this.kidLines.push(text);
  }

  /** 老师没在说就做,在说就先掐掉、等它停了再做 */
  private whenIdle(fn: () => void): void {
    if (!this.speaking) { fn(); return; }
    this.afterIdle.push(fn);
    this.session?.cancel();
    this.send({ t: 'flush' });
  }

  private events(): ConstructorParameters<typeof RealtimeSession>[1] {
    return {
      onAudio: (pcm) => {
        if (this.firstAudioAt === null) this.firstAudioAt = this.ms();
        this.answerBytes += pcm.length;
        this.tutorPcm.push({ t: this.ms(), pcm });
        this.sock.sendBinary(pcm);
      },
      onTutorText: (delta, done) => {
        if (done !== null) { this.note('tutor', done.trim()); this.send({ t: 'tutor', done: done.trim() }); return; }
        if (!delta) return;
        this.send({ t: 'tutor', delta });
        if (this.phase === 'chat') this.litCards(delta);
      },
      onKidText: (text) => {
        this.note('kid', text);
        this.send({ t: 'kid', text });
        if (this.phase === 'read') this.readEvent({ e: 'text', t: this.ms(), text, target: this.items[this.i]?.en ?? '' });
      },
      onSpeech: (s) => {
        if (s === 'started' && this.phase === 'chat') { if (this.session?.responding) this.session.cancel(); this.send({ t: 'flush' }); }
      },
      onResponse: (st, _status, usage) => {
        this.speaking = st === 'created';
        if (st === 'created') { this.firstAudioAt = null; this.answerBytes = 0; this.answerText = ''; this.lit.clear(); }
        if (usage) this.usage = { input: this.usage.input + usage.input, output: this.usage.output + usage.output, inputAudio: this.usage.inputAudio + usage.inputAudio, outputAudio: this.usage.outputAudio + usage.outputAudio };
        this.state();
        if (st === 'done') {
          if (this.phase === 'read') this.idleWhenPlayed();
          const fns = this.afterIdle.splice(0);
          for (const f of fns) f();
          if (this.closing && !fns.length) void this.end('time');
        }
      },
      onError: (m) => this.send({ t: 'err', msg: m }),
      onClose: (r) => { if (!this.ended && this.session && !this.closing) void this.end(`dropped:${r}`); },
    };
  }

  /** 开始:跟读那条会话;口语单空的直接聊 */
  async start(): Promise<void> {
    this.timers.push(setTimeout(() => void this.end('max'), CALL_MAX_MS));
    this.state();
    if (!this.items.length) { await this.startChat(); return; }
    const s = new RealtimeSession({ instructions: readInstructions(this.meta.list, this.deps.kidName, this.deps.config.note ?? ''), voice: this.deps.config.voice, model: this.deps.config.model, turn: 'manual', endpoint: this.deps.endpoint, env: this.deps.env }, this.events());
    const why = await s.connect();
    if (why !== null) { this.send({ t: 'err', msg: `connect:${why}` }); await this.end(`connect:${why}`); return; }
    this.session = s;
    this.timers.push(setInterval(() => { if (this.phase === 'read') this.readEvent({ e: 'tick', t: this.ms() }); }, READ_TICK_MS));
    this.cue(readCue(this.items[this.i]), true);
  }

  /** 塞一句让老师说;跟读段同时告诉状态机「老师在读」(fresh = 换了一句,自动再读重新数) */
  private cue(text: string, fresh = false): void {
    this.whenIdle(() => {
      if (this.phase === 'read') {
        if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
        this.stopPushing(false);
        this.rd = readStep(this.rd, { e: 'cue', t: this.ms(), fresh }, this.deps.config.read).s;
      }
      this.session?.addText(text);
      this.session?.createResponse();
      this.state();
    });
  }

  /** 跟读段一个回答说完了:估孩子端什么时候放完(第一块到的时刻 + 声音长度),到点算老师读完 */
  private idleWhenPlayed(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const playedAt = this.firstAudioAt === null ? this.ms() : this.firstAudioAt + this.answerBytes / ((OUTPUT_RATE * 2) / 1000) + IDLE_PAD_MS;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.phase !== 'read' || this.speaking) return;
      if (this.toChat) { void this.startChat(); return; }
      this.readEvent({ e: 'idle', t: this.ms() });
    }, Math.max(0, playedAt - this.ms()));
  }

  /** 跟读段的一件事 → 状态机 → 做它说的 */
  private readEvent(ev: ReadEvent): void {
    if (this.phase !== 'read' || this.ended) return;
    const was = this.rd;
    const { s, act } = readStep(was, ev, this.deps.config.read);
    this.rd = s;
    if (ev.e === 'idle') this.vad = { ...vadInit(), floor: this.vad.floor };
    if (act === 'commit') this.stopPushing(true);
    else if (act === 'again') { const it = this.items[this.i]; if (it) this.cue(readAgainCue(it)); }
    else if (act === 'next') {
      const heard = ev.e === 'text' ? ev.text.trim() : '';
      this.i++;
      const it = this.items[this.i];
      if (it) this.cue(heard ? readNextCue(heard, it) : readCue(it), true);
      else { this.toChat = true; this.cue(heard ? readLastCue(heard) : readLastCue('…')); }
    }
    if (s.mode !== was.mode || act) this.state();
  }

  /** 停止往模型推孩子的声音;commit = 交出去转写(不然清掉) */
  private stopPushing(commit: boolean): void {
    if (!this.pushing) return;
    this.pushing = false;
    if (commit) this.session?.commit(); else this.session?.clearAudio();
  }

  /** 孩子端的一条文本消息 */
  onText(raw: string): void {
    if (this.ended) return;
    let m: { t?: unknown };
    try { m = JSON.parse(raw) as { t?: unknown }; } catch { return; }
    if (typeof m.t === 'string' && ['again', 'next', 'chat', 'bye', 'say', 'view'].includes(m.t)) this.rec.push([this.ms(), 'i', m as Record<string, unknown>]);
    switch (m.t) {
      case 'again':
        // 孩子点的「再听一遍」不算自动再读的次数
        if (this.phase === 'read' && this.items[this.i]) this.cue(readAgainCue(this.items[this.i]));
        break;
      case 'next':
        if (this.phase !== 'read') return;
        this.i++;
        if (this.i < this.items.length) this.cue(readCue(this.items[this.i]), true);
        else void this.startChat();
        break;
      case 'chat':
        if (this.phase === 'read') void this.startChat();
        break;
      case 'bye':
        void this.end('bye');
        break;
      case 'view': {
        const v = m as { w?: unknown; h?: unknown };
        if (typeof v.w === 'number' && typeof v.h === 'number' && v.w > 0 && v.h > 0) this.view = [Math.round(v.w), Math.round(v.h)];
        break;
      }
      default: break;
    }
  }

  /** 孩子端的一块声音 */
  onAudio(pcm: Buffer): void {
    if (this.ended || !this.session?.isReady) return;
    if (this.phase === 'read') { this.readAudio(pcm); return; }
    this.lastKidAudioAt = this.ms();
    this.kidPcm.push({ t: this.ms(), pcm });
    this.session.appendAudio(pcm);
  }

  /** 聊那段老师的字里出现口语单上的词 → 那张单词卡亮(一次回答里一个词只亮一次;后讲到的盖过先讲到的) */
  private litCards(delta: string): void {
    this.answerText += delta;
    // 只看已经说完整的词:流到一半的「bus」可能是「busy」
    const whole = this.answerText.replace(/[A-Za-z'’]+$/, '');
    this.meta.list.words.forEach((w, i) => {
      if (this.lit.has(i) || !appears(w.en, whole)) return;
      this.lit.add(i);
      this.send({ t: 'card', i });
    });
  }

  /** 跟读段的一块声音:等孩子时按响度判开口 / 停;开口起推给模型(带前垫),停了交给状态机 */
  private readAudio(pcm: Buffer): void {
    const listening = this.rd.mode === 'listen' || this.rd.mode === 'wait' || this.rd.mode === 'speech';
    if (!listening) { this.preroll.length = 0; return; }
    const now = this.ms();
    const { v, ev } = vadStep(this.vad, rms(pcm), pcm.length / ((INPUT_RATE * 2) / 1000), this.deps.config.read.endMs);
    this.vad = v;
    if (ev === 'start') {
      this.pushing = true;
      for (const b of [...this.preroll, { t: now, pcm }]) { this.kidPcm.push(b); this.session?.appendAudio(b.pcm); }
      this.preroll.length = 0;
      this.readEvent({ e: 'start', t: this.ms() });
      return;
    }
    if (this.pushing) { this.kidPcm.push({ t: now, pcm }); this.session?.appendAudio(pcm); }
    else { this.preroll.push({ t: now, pcm }); if (this.preroll.length > PREROLL) this.preroll.shift(); }
    if (ev === 'stop') this.readEvent({ e: 'stop', t: this.ms() });
  }

  private async startChat(): Promise<void> {
    if (this.phase !== 'read' || this.ended) return;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.pushing = false;
    const read = Math.min(this.i, this.items.length);
    const old = this.session;
    this.session = null;
    this.speaking = false;
    this.afterIdle.length = 0;
    old?.close('read-done');
    this.phase = 'chat';
    // 孩子端换到聊那一刻清播放队列(页面收到 phase chat 就 A.flush)
    this.flushes.push(this.ms());
    this.state();
    const cfg = this.deps.config;
    const s = new RealtimeSession({ instructions: chatInstructions(this.meta.list, this.deps.kidName, cfg.minutes, readSummary(this.meta.list, read, this.kidLines), cfg.note ?? ''), voice: cfg.voice, model: cfg.model, turn: 'semantic_vad', silenceMs: cfg.silenceMs, endpoint: this.deps.endpoint, env: this.deps.env }, this.events());
    const why = await s.connect();
    if (this.ended) { s.close(); return; }
    if (why !== null) { this.send({ t: 'err', msg: `connect:${why}` }); await this.end(`connect:${why}`); return; }
    this.session = s;
    this.deadline = this.ms() + cfg.minutes * 60_000;
    this.lastKidAudioAt = this.ms();
    this.timers.push(setTimeout(() => this.wrapUp(), cfg.minutes * 60_000));
    this.timers.push(setInterval(() => { if (this.phase === 'chat' && this.ms() - this.lastKidAudioAt > IDLE_MS) void this.end('idle'); }, 10_000));
    this.cue(chatOpenCue);
  }

  /** 到点:让老师收尾,说完就挂 */
  private wrapUp(): void {
    if (this.phase !== 'chat' || this.ended || this.closing) return;
    this.closing = true;
    this.whenIdle(() => { this.session?.addText(chatCloseCue); this.session?.createResponse(); });
    this.timers.push(setTimeout(() => void this.end('time'), 30_000));
  }

  /** 收:关会话、落盘、告诉孩子端 */
  async end(why: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    for (const t of this.timers) clearTimeout(t);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const s = this.session;
    this.session = null;
    // 老师说到一半被挂了,那半句也记下(真跑里孩子刚答完就挂,老师的「Great job!」没等到 done)
    if (s?.partialTutorText.trim()) this.note('tutor', s.partialTutorText.trim());
    s?.close('end');
    const read = Math.min(this.i, this.items.length);
    this.phase = 'ended';
    this.send({ t: 'end', why });
    try {
      const ms = this.ms();
      const mix = mixCall({ kid: this.kidPcm, tutor: this.tutorPcm, flushes: this.flushes, ms });
      await finishCall(this.deps.root, this.meta, {
        startedAt: this.startedAt.toISOString(), ms, why, model: this.deps.config.model, voice: this.deps.config.voice, items: this.items.length, read, lines: this.lines, usage: this.usage,
        kidPcm: Buffer.concat(this.kidPcm.map((c) => c.pcm)), tutorPcm: Buffer.concat(this.tutorPcm.map((c) => c.pcm)), kidRate: INPUT_RATE, tutorRate: OUTPUT_RATE,
        reel: { v: 1, startedAt: this.startedAt.toISOString(), ms, view: this.view, msgs: this.rec, playing: mix.playing, kidVoice: mix.kidVoice }, callPcm: mix.pcm,
      });
    } catch (err) {
      console.error('talk: 落盘失败', err);
    }
    this.sock.close(1000, why);
    this.deps.onFinished?.(why);
  }

  /** 孩子端断了 */
  onSocketClose(): void { if (!this.ended) void this.end('kid-gone'); }
}
