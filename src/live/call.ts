/**
 * 实时老师的一次通话(《wip/实时老师开发计划.md》P2.4):孩子端的 WebSocket ↔ 嘴(百炼 realtime,手动轮次)+ 脑(老师 CLI,Runner)。
 * 一轮:孩子按住说 → 松手,嘴马上接住(很短地说接下来做什么,不复述、不答内容)→ 孩子那句的转写交给脑(实时轮:讲稿不配音)→ 脑的讲稿定稿一句交一句,
 * 嘴一空就把排着的几句一起交给它照念(lib/queue.ts,流水线:嘴出完上一段就交下一段,声音在孩子端接着排)→ 讲完就停。
 * 按句不按拍(2026-10-19):卡宁缺毋滥以后一节常常只有一拍、甚至没卡,按拍要等脑整段写完才念;卡只管自己闭合了就铺,和念哪句不挂钩。
 * 转写是空的(按了没说清):嘴在说就掐掉,改说「没听清」,不交给脑;按着时声音不到 100 毫秒(不 commit)、commit 没收下也一样。孩子在嘴的声音还在放时按下 = 打断:掐掉、孩子端清播放队列,
 * 没念的拍丢掉,孩子听到第几句(lib/playback.ts 按声音排到哪算)进下一轮的上下文包 live:。嘴只接住、只照念,不讲新内容(2026-10-19 P1)。
 *
 * 孩子端 → 这里:二进制帧 = PCM16 16k 单声道一块(按着时才推);文本帧 = JSON
 *   {t:'hold'} 按下 · {t:'release', body} 松手(body 同 POST /api/kid/conversations/<老师>/messages 少 text:thread / newThread / device…)
 *   {t:'hush'} 停下不开新一轮(上滑取消、按下录音卡的录音键):嘴在出就掐、孩子端清了、没念的丢掉
 *   {t:'send', body} 不是说的(打字、拍照、交卡、首页按钮;卡上的「?」带 focus.card 与 ask: true):body 同那条 POST · {t:'view', w, h} 屏幕多大 · {t:'bye'}
 *   {t:'staged'} 讲稿 [[play]] 的小课堂那一段放完了(或放不了、被关):后面的讲稿接着交给嘴
 * 这里 → 孩子端:二进制帧 = PCM16 24k 嘴的声音;文本帧 = JSON
 *   {t:'ready'} 嘴连上了 · {t:'fallback', why} 连不上(这一句走板书)· {t:'kid', text} 孩子那句的转写 · {t:'tutor', of, delta} / {t:'tutor', of, done} 嘴的字(of:catch 接住 / read 照念)
 *   {t:'turn', job, thread} 脑开始写这一轮 · {t:'read', job, line, text, play?} 讲稿这一句开始放(play = 念完放小课堂那一段;一句一个,按孩子端放到的时刻发:一段里第一句在段首,
 *   后面几句等这段的声音出齐、按字数比例摊)· {t:'flush'} 清播放队列
 *   {t:'state', speaking, holding} · {t:'err', status, error} 发不出去(429 limit / 400 …)· {t:'end', why}
 * 嘴的会话断了(百炼 300 秒没输入就关,2026-10-20 照 Qwen-Live-Harness 的换连接):电话不挂、孩子端不知道;下次按下或发来时现连,
 *   连上之前来的照序攒着补(录像里记一条 {t:'lost'},只记不发)。平时孩子没按着就 30 秒一次心跳,最后一次动静 15 分钟后停跳。
 * 录像:进出的消息、两边的声音都记(CallRecorder),挂了落在 conversations/<老师>/<日期>.live/<时分秒>.reel.json / .wav。
 * 事件:嘴这一道(mouth:按下、松手 / 发了、接住开始放、第几句开始放、打断)补进那一轮的 events.jsonl(Runner.noteEvent),工作台的时间线上看;
 * 按下、松手、接住在脑起来之前,先攒着,等那一轮的老师进程起来(main:start)再按它的起点换成相对毫秒(负的)。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { kidSendInput, type AppContext } from '../server/app.ts';
import { BusyError, type SendStarted } from '../server/runner.ts';
import type { RunEvent } from '../lib/events.ts';
import { readIndex } from '../server/store.ts';
import { localDate } from '../lib/conversation.ts';
import { playsLecture } from '../lib/board.ts';
import { catchCue, readCue, type CatchKind } from './lib/cue.ts';
import { addChunk, flushAt, playbackInit, playingAt, type Playback } from './lib/playback.ts';
import { queueInit, queueStep, type Beat, type QueueEvent, type QueueState } from './lib/queue.ts';
import { MIX_RATE } from './lib/mix.ts';
import { wavOfPcm } from './lib/wav.ts';
import { mouthInstructions } from './prompt.ts';
import { INPUT_RATE, OUTPUT_RATE, RealtimeSession } from './realtime.ts';
import { CallRecorder } from './recorder.ts';
import type { ServerSocket } from './ws.ts';

export interface LiveDeps {
  ctx: AppContext;
  tutor: string;
  /** 测试:realtime 的端点与环境 */
  endpoint?: string;
  env?: NodeJS.ProcessEnv;
  /** 测试:心跳间隔、孩子多久没动静就不跳 */
  heartbeatMs?: number;
  keepAliveMs?: number;
  onFinished?(why: string): void;
}

/** 嘴接住的那句最多等多久再把孩子的话交给脑(接住的字一般 1 秒内齐;脑知道嘴说了什么,第一句就不再重复) */
const CATCH_WAIT_MS = 1500;
const BYTES_PER_MS = (OUTPUT_RATE * 2) / 1000;
/** 按着时到的声音不到 100 毫秒就不 commit:百炼回「buffer too small, or have no audio」,不会有转写(2026-10-19 iPad 麦克风没开,嘴照样接住说了「你想问什么」) */
const MIN_COMMIT_BYTES = (INPUT_RATE * 2 * 100) / 1000;
/** 心跳间隔(Qwen-Live-Harness 也是 30 秒);孩子最后一次动静之后跳多久(过了就让百炼 300 秒后关,回来按下再连,连一次约半秒) */
const HEARTBEAT_MS = 30_000;
const KEEP_ALIVE_MS = 15 * 60_000;
/** 讲稿的 [[play]]:孩子端放小课堂那一段,最多等它这么久就接着念(孩子端没回 staged 时不卡死) */
const GATE_MS = 180_000;
/** 现连时攒着的声音最多一分钟(同 Qwen-Live-Harness 的 MAX_RECOVERY_AUDIO_BYTES) */
const MAX_BACKLOG_BYTES = INPUT_RATE * 2 * 60;

/** 嘴这次回答是什么:接住(孩子这一轮)或照念哪几句 */
type Said = { kind: 'catch' } | { kind: 'read'; beat: Beat };

export class LiveCall {
  private session: RealtimeSession | null = null;
  private readonly rec: CallRecorder;
  private q: QueueState = queueInit();
  /** 嘴的声音在孩子端排到哪(按它的排法算),每段带它是接住还是哪一拍 */
  private play: Playback<Said> = playbackInit();
  private holding = false;
  /** 这一次按着推进去多少字节的声音 */
  private heldBytes = 0;
  /** 要了还没出完的那次回答;afterDone = 它出完(或被掐)之后再做的 */
  private said: Said | null = null;
  private afterDone: (() => void) | null = null;
  private cancelOnCreate = false;
  /** 这一轮:嘴接住时说的、接住出完没有 */
  private caught = '';
  private caughtDone = false;
  /** 上一轮讲稿念到第几句被打断(1 起);交给脑时带上,带了就清 */
  private cut: number | undefined;
  /** 最近开始放的那句是问句:孩子再开口就是在答(接住只「嗯」一声,cue 的 answer) */
  private asked = false;
  /** 最近告诉孩子端开始放的那句;打断时报它 */
  private lastRead: { job: string; line: number } | null = null;
  /** 一段里第二句起的 read(按字数摊的时刻);打断时撤 */
  private readTimers: NodeJS.Timeout[] = [];
  /** 嘴这一道的事件:每一轮老师进程起来的墙钟(换相对毫秒用)、日期;还没到那一轮的先攒在 pre(墙钟) */
  private readonly runT0 = new Map<string, { t0: number; date: string }>();
  private pre: { at: number; ev: MouthEvent }[] = [];
  /** 正在写的那一轮(脑)与已经交给排队的讲稿句数 */
  private job: string | null = null;
  private linesQueued = 0;
  private running: SendStarted | null = null;
  /** 脑在忙时孩子又说的:等它写完合并成一条 */
  private waiting: Record<string, unknown>[] = [];
  private turnSeq = 0;
  /** 按住说的这一轮还在等转写 */
  private pendingVoice: { seq: number; body: Record<string, unknown> } | null = null;
  private readonly timers: NodeJS.Timeout[] = [];
  /** 孩子最近一次按下、松手、发来,或嘴说完一次的墙钟(心跳看它) */
  private lastActive = Date.now();
  /** 第一次连上了:之后嘴没了是断了要现连,不是连不上 */
  private opened = false;
  /** 正在现连;连上之前孩子端来的按下、松手、发来、按着的声音照到达的顺序攒着 */
  private reviving: Promise<boolean> | null = null;
  private backlog: ({ m: Record<string, unknown>; at: number } | { pcm: Buffer })[] = [];
  private backlogBytes = 0;
  private backlogHolding = false;
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
  /** 通话里的毫秒 → 墙钟 */
  private wall(ms: number): number { return this.rec.startedAt.getTime() + ms; }
  /** 记嘴这一道的一条:那一轮起来了就补进它的事件,还不知道是哪一轮(job = null)就先攒着 */
  private mouth(job: string | null, at: number, ev: MouthEvent): void {
    const r = job ? this.runT0.get(job) : undefined;
    if (job && r) void this.deps.ctx.runner.noteEvent(this.deps.tutor, r.date, job, { t: at - r.t0, ...ev } as RunEvent);
    else if (!job) this.pre.push({ at, ev });
  }
  private send(o: Record<string, unknown>): void {
    this.rec.out(o);
    this.sock.sendText(JSON.stringify(o));
  }
  private playing(): boolean { return Boolean(this.session?.responding) || this.ms() < this.play.end; }
  private state(): void { this.send({ t: 'state', speaking: this.playing(), holding: this.holding }); }

  /** 排队走一步;要交给嘴的就交;回按下时丢掉的拍 */
  private step(ev: QueueEvent): Beat[] {
    const { s, act } = queueStep(this.q, ev);
    this.q = s;
    if (act?.kind === 'read') {
      this.ask({ kind: 'read', beat: act.beat }, readCue(act.beat.texts));
      // 这段最后一句念完孩子端放小课堂那一段:排队关着闸,等 staged;孩子端一直没回也别卡死
      if (act.beat.play) this.timers.push(setTimeout(() => { if (!this.ended && this.q.gated) this.step({ e: 'staged' }); }, GATE_MS));
    }
    return act?.kind === 'dropped' ? act.beats : [];
  }

  /** 让嘴说一次;接住要先告诉排队,嘴出完之前别交讲稿 */
  private ask(said: Said, instructions: string): void {
    this.said = said;
    if (said.kind === 'catch') this.q = queueStep(this.q, { e: 'asked' }).s;
    this.session?.createResponse(instructions);
  }

  /** 连嘴;连不上告诉孩子端走板书 */
  async start(): Promise<void> {
    const why = await this.connectMouth();
    if (this.ended) return;
    if (why !== null) { this.send({ t: 'fallback', why }); await this.end(`connect:${why}`); return; }
    this.opened = true;
    const { ctx, tutor } = this.deps;
    this.offEvents = ctx.runner.onEvent((e) => {
      if (e.tutor !== tutor || e.job !== this.job) return;
      // 这一轮的老师进程起来了:攒着的按下、松手、接住按它的起点补进它的事件
      if (e.event.lane === 'main' && e.event.kind === 'start') {
        this.runT0.set(e.job, { t0: Date.now() - e.event.t, date: e.date });
        for (const x of this.pre.splice(0)) this.mouth(e.job, x.at, x.ev);
      }
      // 讲稿定稿一句(partial 解析器压着没换行的最后一句,发出来的都是定稿的)就交给排队
      if (e.event.lane === 'main' && e.event.kind === 'line') this.linesUpTo([{ i: e.event.line, text: e.event.text, play: e.event.play === true }]);
    });
    this.timers.push(setInterval(() => this.keepAlive(), this.deps.heartbeatMs ?? HEARTBEAT_MS));
    this.send({ t: 'ready' });
  }

  /** 开一条嘴的会话(第一次、断了以后现连都走这里);连上了才换成 this.session,别的会话的回调都不认 */
  private async connectMouth(): Promise<string | null> {
    const { ctx, tutor } = this.deps;
    const cfg = ctx.ws.config;
    const t = cfg.tutors[tutor];
    let firstOfAnswer = true;
    const s: RealtimeSession = new RealtimeSession({ instructions: mouthInstructions({ display: t?.display ?? tutor, kidName: cfg.kid.name ?? cfg.kid.slug }), voice: cfg.live.voices[tutor], model: cfg.live.model, turn: 'manual', endpoint: this.deps.endpoint, env: this.deps.env }, {
      onAudio: (pcm) => {
        if (this.session !== s) return;
        const said: Said = this.said ?? { kind: 'catch' };
        const r = addChunk(this.play, said, this.ms(), pcm.length / BYTES_PER_MS);
        this.play = r.p;
        // 照念的第一块:到它在孩子端开始放的那一刻,告诉孩子端这段的第一句;接住的第一块记一条(开始放的时刻)
        if (firstOfAnswer && said.kind === 'read') this.readAt(said.beat, 0, r.start);
        if (firstOfAnswer && said.kind === 'catch' && this.holding === false) this.mouth(null, this.wall(r.start), { lane: 'mouth', kind: 'catch', text: '' });
        firstOfAnswer = false;
        this.rec.tutor(pcm);
        this.sock.sendBinary(pcm);
      },
      onTutorText: (delta, done) => {
        if (this.session !== s) return;
        const of = this.said?.kind ?? 'catch';
        if (done !== null) {
          if (of === 'catch') { this.caught = done.trim(); this.caughtDone = true; const c = [...this.pre].reverse().find((x) => x.ev.kind === 'catch'); if (c && c.ev.kind === 'catch') c.ev.text = this.caught; }
          this.send({ t: 'tutor', of, done: done.trim() });
          return;
        }
        if (delta) this.send({ t: 'tutor', of, delta });
      },
      onKidText: (text) => { if (this.session === s) this.heard(text); },
      onResponse: (st, status) => {
        if (this.session !== s) return;
        if (st === 'created') {
          firstOfAnswer = true;
          if (this.cancelOnCreate) { this.cancelOnCreate = false; this.session?.cancel(); }
          this.state();
          return;
        }
        if (status === 'cancelled') this.play = flushAt(this.play, this.ms());
        else if (this.said?.kind === 'read') this.readRest(this.said);
        if (this.said?.kind === 'catch') this.caughtDone = true;
        this.said = null;
        this.lastActive = Date.now();
        this.q = { ...this.q, busy: false };
        const next = this.afterDone;
        this.afterDone = null;
        if (next) next();
        else this.step({ e: 'done' });
        this.state();
      },
      onError: (m) => {
        if (this.session !== s) return;
        this.send({ t: 'err', status: 502, error: m });
        // commit 没收下(声音太少):这一句不会有转写,照转写是空的办
        if (this.pendingVoice && /committing input audio buffer/i.test(m)) this.heard('');
      },
      // 连上以后断了才收;还在连的时候断(配会话报错)由调用方处理
      onClose: (r) => { if (!this.ended && this.session === s) this.lost(r); },
    });
    const why = await s.connect();
    if (this.ended) { s.close(); return 'ended'; }
    if (why === null) this.session = s;
    return why;
  }

  /** 嘴的会话断了(百炼 300 秒没输入就关、网断了):电话不挂;讲稿还排着就马上连、接着念,不然等孩子下次按下或发来再连 */
  private lost(why: string): void {
    this.session = null;
    // 只记进录像,孩子端不知道
    this.rec.out({ t: 'lost', why });
    if (this.said?.kind === 'catch') this.caughtDone = true;
    if (this.said) { this.said = null; this.afterDone = null; this.cancelOnCreate = false; this.q = { ...this.q, busy: false }; }
    // 按着时断的:推过去的声音跟着那条会话没了,松手就说没听清
    this.heldBytes = 0;
    if (this.q.pending.length) void this.revive();
  }

  /** 现连嘴(最多两次);连上了把攒着的照到达的顺序补上、排着的讲稿接着念;连不上告诉孩子端走板书、挂掉 */
  private revive(): Promise<boolean> {
    this.reviving ??= (async () => {
      let why: string | null = 'ended';
      for (let i = 0; i < 2 && !this.ended && why !== null; i++) why = await this.connectMouth();
      this.reviving = null;
      if (this.ended) return false;
      if (why !== null) { this.send({ t: 'fallback', why }); await this.end(`reconnect:${why}`); return false; }
      const items = this.backlog.splice(0);
      this.backlogBytes = 0;
      this.backlogHolding = false;
      for (const x of items) { if ('pcm' in x) this.pushAudio(x.pcm); else this.handle(x.m, x.at); }
      if (!this.said) this.step({ e: 'done' });
      return true;
    })();
    return this.reviving;
  }

  /** 心跳(RealtimeSession.heartbeat):嘴连着、孩子没按着、嘴没在说、最近有动静;孩子走开久了就不跳,让百炼关,回来按下再连 */
  private keepAlive(): void {
    const s = this.session;
    if (!s?.isReady || this.holding || s.responding || Date.now() - this.lastActive > (this.deps.keepAliveMs ?? KEEP_ALIVE_MS)) return;
    s.heartbeat();
  }

  /** 到 at(孩子端放到的时刻)告诉孩子端:这一段的第 k 句开始放了 */
  private readAt(beat: Beat, k: number, at: number): void {
    const t = setTimeout(() => {
      if (this.ended || this.q.dropJob === beat.job) return;
      this.lastRead = { job: beat.job, line: beat.lines[k] };
      this.asked = /[?？]\s*$/.test(beat.texts[k] ?? '');
      // play:这句念完孩子端放小课堂那一段(放完回 staged)
      this.send({ t: 'read', job: beat.job, line: beat.lines[k], text: beat.texts[k], ...(beat.play && k === beat.lines.length - 1 ? { play: true } : {}) });
      this.mouth(beat.job, Date.now(), { lane: 'mouth', kind: 'read', line: beat.lines[k] });
    }, Math.max(0, at - this.ms()));
    (k === 0 ? this.timers : this.readTimers).push(t);
  }

  /** 一段照念的声音出齐了:这段在孩子端从哪放到哪已知,第二句起按字数比例摊开各发一个 read */
  private readRest(said: Said & { kind: 'read' }): void {
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

  /** 讲稿又定稿了几句:按序号接着交给排队(重复的、跳号的不收) */
  private linesUpTo(lines: { i: number; text: string; play?: boolean }[]): void {
    if (!this.job) return;
    for (const l of lines) {
      if (l.i !== this.linesQueued) continue;
      this.linesQueued++;
      this.step({ e: 'beat', beat: { job: this.job, lines: [l.i], texts: [l.text], ...(l.play ? { play: true } : {}) } });
    }
  }

  /** 孩子按下(或不是说的那一轮开始):嘴在出就掐、还在放就清孩子端;排着的丢掉;记下孩子听到第几句 */
  private interrupt(): void {
    const now = this.ms();
    const playing = this.playing();
    const at = playingAt(this.play, now)?.tag;
    const dropped = this.step({ e: 'hold', drop: this.job });
    const heard = at?.kind === 'read' ? at.beat : this.said?.kind === 'read' ? this.said.beat : dropped[0];
    // 孩子端在放的那段里亮到了哪句就报哪句;那段还没亮(声音没到孩子端)报段首
    if (heard) this.cut = (this.lastRead && this.lastRead.job === heard.job && heard.lines.includes(this.lastRead.line) ? this.lastRead.line : heard.lines[0]) + 1;
    if (playing && this.job) this.mouth(this.job, Date.now(), { lane: 'mouth', kind: 'cut', line: at?.kind === 'read' && this.lastRead?.job === this.job ? this.lastRead.line : null });
    for (const t of this.readTimers.splice(0)) clearTimeout(t);
    this.afterDone = null;
    if (this.session?.responding) this.session.cancel();
    else if (this.said) this.cancelOnCreate = true;
    if (playing) { this.play = flushAt(this.play, now); this.send({ t: 'flush' }); }
  }

  /** 孩子的一条文本消息 */
  onText(raw: string): void {
    if (this.ended) return;
    let m: Record<string, unknown>;
    try { m = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    if (typeof m.t !== 'string') return;
    this.rec.in(m);
    // 嘴断了:按下、松手、发来的先攒着,现连,连上了照序补
    if (!this.session && this.opened && INPUTS.has(m.t)) {
      this.backlog.push({ m, at: Date.now() });
      if (m.t === 'hold') this.backlogHolding = true;
      else if (m.t === 'release' || m.t === 'hush') this.backlogHolding = false;
      void this.revive();
      return;
    }
    this.handle(m, Date.now());
  }

  /** 一条孩子端的消息;at = 到的墙钟(现连时补的那几条照原来到的时刻记事件) */
  private handle(m: Record<string, unknown>, at: number): void {
    if (typeof m.t === 'string' && INPUTS.has(m.t)) this.lastActive = Date.now();
    switch (m.t) {
      case 'hold': {
        if (!this.session) return;
        this.pre = [{ at, ev: { lane: 'mouth', kind: 'hold' } }];
        this.holding = true;
        this.heldBytes = 0;
        this.session.clearAudio();
        this.interrupt();
        this.state();
        break;
      }
      case 'release': {
        if (!this.session || !this.holding) return;
        this.holding = false;
        this.pre.push({ at, ev: { lane: 'mouth', kind: 'release', how: 'voice' } });
        const body = isObj(m.body) ? m.body : {};
        if (this.heldBytes < MIN_COMMIT_BYTES) {
          this.session.clearAudio();
          this.send({ t: 'kid', text: '' });
          this.turn('empty', body);
          break;
        }
        this.session.commit();
        this.turn(this.asked && body.newThread !== true ? 'answer' : 'voice', body);
        break;
      }
      case 'hush': {
        if (!this.session) return;
        if (this.holding) { this.holding = false; this.session.clearAudio(); }
        this.interrupt();
        this.q = queueStep(this.q, { e: 'release' }).s;
        this.state();
        break;
      }
      case 'send': {
        if (!this.session || !isObj(m.body)) return;
        const body = m.body;
        const kind: CatchKind = body.ask === true && isObj(body.focus) ? 'ask' : body.action === 'submit' ? 'card' : Array.isArray(body.photos) && body.photos.length ? 'photo' : isObj(body.via) ? 'start' : 'text';
        this.interrupt();
        this.pre = [{ at, ev: { lane: 'mouth', kind: 'release', how: kind === 'ask' || kind === 'card' || kind === 'photo' ? kind : 'text' } }];
        this.turn(kind, body, typeof body.text === 'string' ? body.text : '');
        break;
      }
      // 孩子端放完了小课堂那一段(或放不了、被关):后面的讲稿接着交给嘴
      case 'staged': this.step({ e: 'staged' }); break;
      case 'view': this.rec.view(m.w, m.h); break;
      case 'bye': void this.end('bye'); break;
      default: break;
    }
  }

  /** 一轮开始:嘴马上接住(上一次回答被掐了还没回 done 就等它回了再接);说的等转写回来再交给脑,不是说的直接交 */
  private turn(kind: CatchKind, body: Record<string, unknown>, text?: string): void {
    const seq = ++this.turnSeq;
    this.caught = '';
    this.caughtDone = false;
    this.q = queueStep(this.q, { e: 'release' }).s;
    this.pendingVoice = kind === 'voice' || kind === 'answer' ? { seq, body } : null;
    const go = (): void => this.ask({ kind: 'catch' }, catchCue(kind));
    if (this.said) this.afterDone = go; else go();
    if (text !== undefined) void this.toBrain(seq, { ...body, text });
  }

  /** 孩子那句的转写回来了:空的改说没听清、不交给脑;不空交给脑 */
  private heard(text: string): void {
    this.send({ t: 'kid', text });
    const v = this.pendingVoice;
    this.pendingVoice = null;
    if (!v || v.seq !== this.turnSeq) return;
    if (text.trim()) { void this.toBrain(v.seq, { ...v.body, text }); return; }
    const sorry = (): void => this.ask({ kind: 'catch' }, catchCue('empty'));
    if (!this.said) { sorry(); return; }
    // 接住还在要 / 在出:掐掉,出完(被掐)再说没听清
    this.afterDone = sorry;
    if (this.session?.responding) this.session.cancel(); else this.cancelOnCreate = true;
    if (this.playing()) { this.play = flushAt(this.play, this.ms()); this.send({ t: 'flush' }); }
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
    const { ask: _ask, ...rest } = body;
    const r = await kidSendInput(ctx, tutor, rest, localDate(ctx.now()));
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
    this.linesQueued = 0;
    this.send({ t: 'turn', job: started.job, thread: started.thread });
    const job = started.job;
    void started.done.then(async (index) => {
      // 收尾:整块出的运行时、或流式时没发出来的最后几句,从正式的一节补上
      const m = index.messages.find((x) => x.job === job) ?? (await readIndex(ctx.ws, tutor, started.date)).messages.find((x) => x.job === job);
      const sec = m?.section;
      if (sec && this.job === job) this.linesUpTo(sec.lines.map((l, i) => ({ i, text: l.text, play: playsLecture(l, sec.cards) })));
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

  /** 孩子端的一块声音:按着才推;嘴在现连时按着说的先攒着(最多一分钟) */
  onAudio(pcm: Buffer): void {
    if (this.ended) return;
    if (!this.session) {
      if (this.backlogHolding && this.backlogBytes + pcm.length <= MAX_BACKLOG_BYTES) { this.rec.kid(pcm); this.backlog.push({ pcm }); this.backlogBytes += pcm.length; }
      return;
    }
    if (!this.holding || !this.session.isReady) return;
    this.rec.kid(pcm);
    this.pushAudio(pcm);
  }

  private pushAudio(pcm: Buffer): void {
    if (!this.holding || !this.session?.isReady) return;
    this.heldBytes += pcm.length;
    this.session.appendAudio(pcm);
  }

  /** 收:关嘴、落录像、告诉孩子端 */
  async end(why: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    for (const t of [...this.timers, ...this.readTimers]) { clearTimeout(t); clearInterval(t); }
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
/** 孩子这边的动作(嘴断了要攒着补的那几种) */
const INPUTS = new Set(['hold', 'release', 'hush', 'send', 'staged']);

/** 嘴这一道的一条(没有 t;补进事件时按那一轮的起点换) */
type MouthEvent = Extract<RunEvent, { lane: 'mouth' }> extends infer E ? (E extends RunEvent ? Omit<E, 't'> : never) : never;
