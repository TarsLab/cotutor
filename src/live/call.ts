/**
 * 实时老师的一次通话(《wip/实时老师开发计划.md》P2.4):孩子端的 WebSocket ↔ 嘴(百炼 realtime,手动轮次)+ 脑(老师 CLI,Runner)。
 * 一轮:孩子按住说 → 松手,嘴先接住(复述他问的,不答内容)→ 孩子那句的转写交给脑(实时轮:讲稿不配音)→ 脑的板书一拍关一拍,
 * 这一拍的讲稿排队交给嘴照念(lib/queue.ts)→ 讲完就停。孩子在嘴说话时按下 = 打断:掐掉、孩子端清播放队列,没念的拍丢掉,
 * 孩子听到第几句记下来,下一轮进上下文包 live:。嘴只接住、只照念,不讲新内容(2026-10-19 P1:嘴自己带不了)。
 *
 * 孩子端 → 这里:二进制帧 = PCM16 16k 单声道一块(按着时才推);文本帧 = JSON
 *   {t:'hold'} 按下 · {t:'release', body} 松手(body 同 POST /api/kid/conversations/<老师>/messages 少 text:thread / newThread / device…)
 *   {t:'send', body} 不是说的(打字、拍照、交卡、首页按钮):body 同那条 POST · {t:'view', w, h} 屏幕多大 · {t:'bye'}
 * 这里 → 孩子端:二进制帧 = PCM16 24k 嘴的声音;文本帧 = JSON
 *   {t:'ready'} 嘴连上了 · {t:'fallback', why} 连不上(这一句走板书)· {t:'kid', text} 孩子那句的转写 · {t:'tutor', delta} / {t:'tutor', done} 嘴的字
 *   {t:'turn', job, thread} 脑开始写这一轮 · {t:'read', job, lines} 嘴开始念讲稿的这几句 · {t:'flush'} 清播放队列
 *   {t:'state', speaking, holding} · {t:'err', status, error} 发不出去(429 limit / 400 …)· {t:'end', why}
 * 录像:进出的消息、两边的声音都记(CallRecorder),挂了落在 conversations/<老师>/<日期>.live/<时分秒>.reel.json / .wav。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { kidSendInput, type AppContext } from '../server/app.ts';
import { BusyError, type SendStarted } from '../server/runner.ts';
import { readIndex } from '../server/store.ts';
import { localDate } from '../lib/conversation.ts';
import { beatsOf, type BoardSection } from '../lib/kid-board.ts';
import { catchCue, readCue, type CatchKind } from './lib/cue.ts';
import { queueInit, queueStep, type Beat, type QueueEvent, type QueueState } from './lib/queue.ts';
import { MIX_RATE } from './lib/mix.ts';
import { wavOfPcm } from './lib/wav.ts';
import { mouthInstructions } from './prompt.ts';
import { OUTPUT_RATE, RealtimeSession } from './realtime.ts';
import { CallRecorder } from './recorder.ts';
import type { ServerSocket } from './ws.ts';

export interface LiveDeps {
  ctx: AppContext;
  tutor: string;
  /** 测试:realtime 的端点与环境 */
  endpoint?: string;
  env?: NodeJS.ProcessEnv;
  onFinished?(why: string): void;
}

/** 嘴接住的那句最多等多久再把孩子的话交给脑(接住的字一般 1 秒内齐) */
const CATCH_WAIT_MS = 1500;
/** 松手后等孩子那句的转写最多多久再让嘴接住(转写一般 0.3 秒回来;空的就说没听清,不交给脑) */
const HEAR_WAIT_MS = 800;
/** 多久看一次排队(放完了没有) */
const TICK_MS = 100;
/** 嘴的声音放完再多等一点才算放完(孩子端排队起步 60 毫秒,网络也慢一点) */
const PLAY_PAD_MS = 300;
const BYTES_PER_MS = (OUTPUT_RATE * 2) / 1000;

type Kind = 'catch' | 'read';

export class LiveCall {
  private session: RealtimeSession | null = null;
  private readonly rec: CallRecorder;
  private q: QueueState = queueInit();
  private holding = false;
  /** 这次回答是接住还是照念;第一块声音什么时候到、一共多少字节(估放完的时刻) */
  private kind: Kind | null = null;
  private firstAudioAt: number | null = null;
  private answerBytes = 0;
  /** 这一轮:嘴接住时说的、接住说完没有、孩子那句 */
  private caught = '';
  private caughtDone = false;
  /** 上一轮讲稿念到第几句被打断(1 起);交给脑时带上,带了就清 */
  private cut: number | undefined;
  /** 正在写的那一轮(脑)与已经交给排队的拍数 */
  private job: string | null = null;
  private beatsQueued = 0;
  private running: SendStarted | null = null;
  /** 脑在忙时孩子又说的:等它写完合并成一条 */
  private waiting: Record<string, unknown>[] = [];
  private turnSeq = 0;
  /** 按住说的这一轮还在等转写;caught = 嘴已经开始接住了(等转写等过了点) */
  private pendingVoice: { seq: number; body: Record<string, unknown>; caught: boolean; timer: NodeJS.Timeout | null } | null = null;
  private readonly timers: NodeJS.Timeout[] = [];
  private offEvents: (() => void) | null = null;
  private ended = false;
  private readonly sock: ServerSocket;
  private readonly deps: LiveDeps;

  constructor(sock: ServerSocket, deps: LiveDeps) {
    this.sock = sock;
    this.deps = deps;
    this.rec = new CallRecorder(deps.ctx.now);
  }

  private ms(): number { return this.rec.ms(); }
  private send(o: Record<string, unknown>): void {
    this.rec.out(o);
    this.sock.sendText(JSON.stringify(o));
  }
  private state(): void { this.send({ t: 'state', speaking: Boolean(this.session?.responding), holding: this.holding }); }

  private step(ev: QueueEvent): void {
    const { s, act } = queueStep(this.q, ev);
    this.q = s;
    if (!act) return;
    if (act.kind === 'cut') {
      if (act.speaking) { this.session?.cancel(); this.send({ t: 'flush' }); }
      if (act.line !== null) this.cut = act.line;
      return;
    }
    this.speak('read', readCue(act.beat.texts));
    this.send({ t: 'read', job: act.beat.job, lines: act.beat.lines });
  }

  private speak(kind: Kind, instructions: string): void {
    this.kind = kind;
    this.session?.createResponse(instructions);
  }

  /** 连嘴;连不上告诉孩子端走板书 */
  async start(): Promise<void> {
    const { ctx, tutor } = this.deps;
    const cfg = ctx.ws.config;
    const voice = cfg.live.voices[tutor];
    const t = cfg.tutors[tutor];
    const s = new RealtimeSession({ instructions: mouthInstructions({ display: t?.display ?? tutor, kidName: cfg.kid.name ?? cfg.kid.slug }), voice, model: cfg.live.model, turn: 'manual', endpoint: this.deps.endpoint, env: this.deps.env }, {
      onAudio: (pcm) => {
        if (this.firstAudioAt === null) this.firstAudioAt = this.ms();
        this.answerBytes += pcm.length;
        this.rec.tutor(pcm);
        this.sock.sendBinary(pcm);
      },
      onTutorText: (delta, done) => {
        if (done !== null) {
          if (this.kind === 'catch') { this.caught = done.trim(); this.caughtDone = true; }
          this.send({ t: 'tutor', done: done.trim() });
          return;
        }
        if (delta) this.send({ t: 'tutor', delta });
      },
      onKidText: (text) => this.heard(text),
      onResponse: (st, status) => {
        if (st === 'created') { this.firstAudioAt = null; this.answerBytes = 0; this.step({ e: 'created', t: this.ms() }); this.state(); return; }
        // 掐掉的那次:孩子端已经清了队列,放到的时刻就是现在
        const playedAt = status === 'cancelled' || this.firstAudioAt === null ? this.ms() : this.firstAudioAt + this.answerBytes / BYTES_PER_MS + PLAY_PAD_MS;
        if (this.kind === 'catch') this.caughtDone = true;
        this.step({ e: 'done', t: this.ms(), playedAt });
        this.state();
      },
      onError: (m) => this.send({ t: 'err', status: 502, error: m }),
      // 连上以后断了才收;还在连的时候断(配会话报错)由 start 告诉孩子端走板书
      onClose: (r) => { if (!this.ended && this.session) void this.end(`dropped:${r}`); },
    });
    const why = await s.connect();
    if (this.ended) { s.close(); return; }
    if (why !== null) { this.send({ t: 'fallback', why }); await this.end(`connect:${why}`); return; }
    this.session = s;
    this.offEvents = ctx.runner.onEvent((e) => {
      if (e.tutor !== tutor || e.job !== this.job) return;
      if (e.event.lane === 'ready' && e.event.kind === 'beat') this.beatsUpTo(e.event.beat, ctx.runner.partial(tutor));
    });
    this.timers.push(setInterval(() => this.step({ e: 'tick', t: this.ms() }), TICK_MS));
    this.send({ t: 'ready' });
  }

  /** 脑的第 0…k 拍关了:还没交的交给排队 */
  private beatsUpTo(k: number, section: Pick<BoardSection, 'cards' | 'lines'> | null): void {
    if (!section || !this.job) return;
    const beats = beatsOf(section);
    for (; this.beatsQueued <= k && this.beatsQueued < beats.length; this.beatsQueued++) {
      const b = beats[this.beatsQueued];
      const beat: Beat = { job: this.job, lines: b.lines, texts: b.lines.map((i) => section.lines[i]?.text ?? '') };
      this.step({ e: 'beat', t: this.ms(), beat });
    }
  }

  /** 孩子的一条文本消息 */
  onText(raw: string): void {
    if (this.ended) return;
    let m: Record<string, unknown>;
    try { m = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    if (typeof m.t !== 'string') return;
    this.rec.in(m);
    switch (m.t) {
      case 'hold': {
        if (!this.session) return;
        this.holding = true;
        this.session.clearAudio();
        this.step({ e: 'hold', t: this.ms(), drop: this.job });
        this.state();
        break;
      }
      case 'release': {
        if (!this.session || !this.holding) return;
        this.holding = false;
        this.step({ e: 'release', t: this.ms() });
        this.session.commit();
        this.turn('voice', isObj(m.body) ? m.body : {});
        break;
      }
      case 'send': {
        if (!this.session || !isObj(m.body)) return;
        const body = m.body;
        const kind: CatchKind = body.action === 'submit' ? 'card' : Array.isArray(body.photos) && body.photos.length ? 'photo' : 'text';
        this.step({ e: 'hold', t: this.ms(), drop: this.job });
        this.step({ e: 'release', t: this.ms() });
        this.turn(kind, body, typeof body.text === 'string' ? body.text : '');
        break;
      }
      case 'view': this.rec.view(m.w, m.h); break;
      case 'bye': void this.end('bye'); break;
      default: break;
    }
  }

  /** 一轮开始:嘴接住,孩子的话交给脑。说的先等转写(最多 HEAR_WAIT_MS):空的只说没听清;等过了点照常接住,转写回来再交给脑 */
  private turn(kind: CatchKind, body: Record<string, unknown>, text?: string): void {
    const seq = ++this.turnSeq;
    this.caught = '';
    this.caughtDone = false;
    if (this.pendingVoice?.timer) clearTimeout(this.pendingVoice.timer);
    this.pendingVoice = null;
    if (kind === 'voice') {
      const p = { seq, body, caught: false, timer: null as NodeJS.Timeout | null };
      p.timer = setTimeout(() => { p.timer = null; if (this.pendingVoice === p && !p.caught) { p.caught = true; this.speak('catch', catchCue('voice')); } }, HEAR_WAIT_MS);
      this.pendingVoice = p;
      return;
    }
    this.speak('catch', catchCue(kind));
    if (text !== undefined) void this.toBrain(seq, { ...body, text });
  }

  /** 孩子那句的转写回来了 */
  private heard(text: string): void {
    this.send({ t: 'kid', text });
    const v = this.pendingVoice;
    this.pendingVoice = null;
    if (!v) return;
    if (v.timer) clearTimeout(v.timer);
    if (!text.trim()) { if (!v.caught) this.speak('catch', catchCue('empty')); return; }
    if (!v.caught) this.speak('catch', catchCue('voice'));
    void this.toBrain(v.seq, { ...v.body, text });
  }

  /** 等嘴接住(最多 CATCH_WAIT_MS),交给脑;脑在忙就排着,它写完合并发 */
  private async toBrain(seq: number, body: Record<string, unknown>): Promise<void> {
    const until = Date.now() + CATCH_WAIT_MS;
    while (!this.caughtDone && Date.now() < until && !this.ended && seq === this.turnSeq) await new Promise((r) => setTimeout(r, 20));
    if (this.ended || seq !== this.turnSeq) return;
    if (this.running) { this.waiting.push(body); return; }
    await this.dispatch(body);
  }

  private async dispatch(body: Record<string, unknown>): Promise<void> {
    const { ctx, tutor } = this.deps;
    const r = await kidSendInput(ctx, tutor, body, localDate(ctx.now()));
    if ('error' in r) { this.send({ t: 'err', status: r.error.status, error: (r.error.json as { error?: string } | undefined)?.error ?? 'error' }); return; }
    const live = { ...(this.caught ? { caught: this.caught } : {}), ...(this.cut ? { cut: this.cut } : {}) };
    this.cut = undefined;
    let started: SendStarted;
    try {
      started = await ctx.runner.send(tutor, { ...r.input, live });
    } catch (err) {
      // 别处(页面、工作台)正在让这位老师写:排着,它写完再发
      if (err instanceof BusyError) { this.waiting.push(body); this.afterBusy(); return; }
      this.send({ t: 'err', status: 500, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    this.running = started;
    this.job = started.job;
    this.beatsQueued = 0;
    this.send({ t: 'turn', job: started.job, thread: started.thread });
    const job = started.job;
    void started.done.then(async (index) => {
      // 收尾:流式时没赶上关的最后一拍(进程退出才关),从正式的一节补上
      const m = index.messages.find((x) => x.job === job) ?? (await readIndex(ctx.ws, tutor, started.date)).messages.find((x) => x.job === job);
      if (m?.section && this.job === job) this.beatsUpTo(Number.MAX_SAFE_INTEGER, m.section);
    }, () => {}).finally(() => {
      if (this.running === started) this.running = null;
      this.flushWaiting();
    });
  }

  /** 别处在写:等那一轮完了再发排着的 */
  private afterBusy(): void {
    const { ctx, tutor } = this.deps;
    const busy = ctx.runner.running(tutor);
    const poll = setInterval(() => {
      if (this.ended || ctx.runner.running(tutor)?.job === busy?.job) return;
      clearInterval(poll);
      this.flushWaiting();
    }, 200);
    this.timers.push(poll);
  }

  /** 脑忙时孩子说的几句:合并成一条(话题等照最后一句的),发 */
  private flushWaiting(): void {
    if (this.ended || this.running || !this.waiting.length) return;
    const all = this.waiting.splice(0);
    const last = all[all.length - 1];
    void this.dispatch({ ...last, text: all.map((b) => String(b.text ?? '').trim()).filter(Boolean).join('\n') });
  }

  /** 孩子端的一块声音:按着才推 */
  onAudio(pcm: Buffer): void {
    if (this.ended || !this.holding || !this.session?.isReady) return;
    this.rec.kid(pcm);
    this.session.appendAudio(pcm);
  }

  /** 收:关嘴、落录像、告诉孩子端 */
  async end(why: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    for (const t of this.timers) clearInterval(t);
    this.offEvents?.();
    const s = this.session;
    this.session = null;
    s?.close('end');
    this.send({ t: 'end', why });
    try {
      const take = this.rec.finish();
      if (take.reel.msgs.length > 2) {
        const { ctx, tutor } = this.deps;
        const at = this.rec.startedAt;
        const dir = join(ctx.ws.dirs.conversations, tutor, `${localDate(at)}.live`);
        const name = [at.getHours(), at.getMinutes(), at.getSeconds()].map((n) => String(n).padStart(2, '0')).join('');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${name}.wav`), wavOfPcm(take.callPcm, MIX_RATE));
        await writeFile(join(dir, `${name}.reel.json`), JSON.stringify(take.reel));
      }
    } catch (err) {
      console.error('live: 录像落盘失败', err);
    }
    this.sock.close(1000, why);
    this.deps.onFinished?.(why);
  }

  /** 孩子端断了 */
  onSocketClose(): void { if (!this.ended) void this.end('kid-gone'); }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
