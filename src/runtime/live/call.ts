/**
 * 实时老师的一次通话:孩子端的 WebSocket ↔ 嘴(百炼 realtime,手动轮次)+ 脑(应用直连百炼,经 Runner)。
 * 一轮:孩子按住说 → 松手(嘴不接话,拍照才先说一句「我看一看图片」,src/realtime/cues.ts)→ 孩子那句的转写交给脑(实时轮:讲稿不配音)→ 脑的讲稿定稿一句交一句,
 * 嘴一空就把排着的几句一起交给它照念(src/runtime/delivery/queue.ts,流水线:嘴出完上一段就交下一段,声音在孩子端接着排)→ 讲完就停。
 * 转写是空的(按了没说清):嘴在说就掐掉,改说「没听清」,不交给脑;按着时声音不到 100 毫秒(不 commit)、commit 没收下也一样。孩子在嘴的声音还在放时按下 = 打断:掐掉、孩子端清播放队列,
 * 没念的拍丢掉,孩子听到第几句(src/runtime/delivery/playback.ts 按声音排到哪算)进下一轮的上下文包 live:。嘴只接住、只照念,不讲新内容;嘴先答的 activity 例外(reply: mouth)。
 * 断线重连、换连接、一直听、请孩子说、嘴先答、录像按段、字幕重放、事件这些规矩写在 docs/dev/实时通话.md 的「一次通话里的规矩」。
 *
 * 孩子端 → 这里:二进制帧 = PCM16 16k 单声道一块(按着时才推);文本帧 = JSON
 *   {t:'hold'} 按下 · {t:'release', body} 松手(body 同 send 的那条少 text:thread / via / device…,runner.accept 验)
 *   {t:'hush'} 停下不开新一轮(上滑取消):嘴在出就掐、孩子端清了、没念的丢掉
 *   {t:'send', body} 不是说的(打字、拍照、「给老师看」、首页按钮):body 是那一条(text / thread / via / photos…,runner.accept 验) · {t:'view', w, h} 屏幕多大 · {t:'bye'}
 *   {t:'staged'} 放小课堂一段的那句([[看 0:19–0:30]])那一段放完了(或放不了、被关):后面的讲稿接着交给嘴
 *   {t:'board', body} 一节课里孩子在页上做了一件事(点字 {k:'pick', thread, text, base};课本上挪了窗 {k:'view', thread, base, box}):记进板的日志(Runner.boardEvent),不起脑;
 *     课本的窗停下来以后舞台交的图 {k:'shot', thread, base, box, image} 也走这里:存下来等下一轮附给脑,不算孩子动了手;
 *     课本上落的一笔 {k:'stroke', thread, base, pts}、擦掉 {k:'wipe'} 落进一节课的状态;报来的一件一件排着记,交给脑之前先等记完;
 *   安静时嘴照念这个字词的念法(认字时写好的「傍,傍晚的傍」),老师正在说就不念;再点下一个,上一句掐掉。
 *   点过以后 STILL_MS 没动静(没开口、没再点),应用替他叫一次老师(app: still,带上他做了什么);连着只叫一次,孩子开口了才再叫
 *   一节课里落笔 {k:'pen'}、抬笔(stroke 收下了)走收笔(./pen.ts 的 turnStep):抬笔停 live.pen 的秒数没再落笔,替他交一轮(app: pen,嘴先说「我看看你写的」);他先开口了就不交
 * 这里 → 孩子端:二进制帧 = PCM16 24k 嘴的声音;文本帧 = JSON
 *   {t:'ready'} 嘴连上了 · {t:'down', why} 连不上(孩子端回到「正在叫老师」,过一会儿重连)· {t:'kid', text} 孩子那句的转写 · {t:'tutor', of, delta} / {t:'tutor', of, done} 嘴的字(of:catch 接住 / read 照念)
 *   {t:'turn', job, thread} 脑开始写这一轮 · {t:'read', job, line, text, play?} 讲稿这一句开始放(play = 念完放小课堂那一段;一句一个,按孩子端放到的时刻发:一段里第一句在段首,
 *   后面几句等这段的声音出齐、按字数比例摊)· {t:'flush'} 清播放队列
 *   {t:'state', speaking, holding} · {t:'err', status, error} 发不出去(400 / 409 …)· {t:'end', why}
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Runner } from '../runner.ts';
import { needsParent, troubleKind } from '../../shared/qianwen.ts';
import { localDate } from '../../shared/time.ts';
import { catchCue, readCue, replyCue, type CatchKind } from '../../realtime/cues.ts';
import { judge } from '../../realtime/listen.ts';
import { coverage, echoKind, echoLines, type EchoBeat } from '../../board/echo.ts';
import type { Beat, Echo } from '../delivery/queue.ts';
import { Delivery, type Said } from '../delivery/delivery.ts';
import { MIX_RATE } from '../journal/mix.ts';
import { wavOfPcm } from '../../shared/wav.ts';
import { mouthInstructions } from '../../realtime/prompt.ts';
import { mouthVoice, type ContextPack } from '../../schema/index.ts';
import { INPUT_RATE, MAX_IMAGE_B64, OUTPUT_RATE, RealtimeSession } from '../../realtime/bailian.ts';
import { CallRecorder, renderTake, type RawTake } from '../journal/recorder.ts';
import { MouthEvents, MouthTakes, type MouthEvent } from '../journal/mouth.ts';
import { Turns } from './turns.ts';
import { penInit, turnStep, type PenEvent, type PenTimes } from './pen.ts';

/** 孩子端那条 WebSocket 里一次通话用得上的(app/ws/ws.ts 的 ServerSocket 满足它) */
export interface KidSocket {
  sendText(text: string): boolean;
  sendBinary(data: Buffer | Uint8Array): boolean;
  close(code?: number, reason?: string): void;
}

/** 实时老师从应用拿的(app/http/app.ts 的 AppContext 满足它):运行时与时钟,不认路由与页面 */
export interface LiveApp {
  readonly runner: Runner;
  now(): Date;
  /** 嘴连上了(null)、连不上(原因)、通话中百炼报错(midCall):app 那层记下,给家长看 */
  mouthHealth?(why: string | null, midCall?: boolean): Promise<void>;
}

export interface LiveDeps {
  ctx: LiveApp;
  tutor: string;
  /** 哪一台设备(升级请求里的设备 cookie):孩子发的每一条记上 */
  deviceId?: string | null;
  /** 测试:realtime 的端点与环境 */
  endpoint?: string;
  env?: NodeJS.ProcessEnv;
  /** 测试:心跳间隔、孩子多久没动静就不跳、输入多少 token 换连接 */
  heartbeatMs?: number;
  keepAliveMs?: number;
  swapTokens?: number;
  /** 一直听:进来就是(连接带 ?listen=open);测试:放过的句子攒着多久没回答就换连接 */
  listen?: 'hold' | 'open';
  idleSwapMs?: number;
  /** 测试:请他说的那句念完等孩子多久 */
  echoWaitMs?: number;
  /** 测试:板上点完字多久没动静替孩子叫老师 */
  stillMs?: number;
  /** 测试:收笔的秒数(缺省照 cotutor.json 的 live.pen) */
  pen?: Partial<PenTimes>;
  /** 测试:要嘴说了多久一个字没出算卡住 */
  stallMs?: number;
  /** 测试:录像这一段多久没动静、录了多久就切(心跳时看) */
  idleCutMs?: number;
  maxTakeMs?: number;
  onFinished?(why: string): void;
}

/** 嘴接住的那句最多等多久再把孩子的话交给脑(接住的字一般 1 秒内齐;脑知道嘴说了什么,第一句就不再重复) */
const CATCH_WAIT_MS = 1500;
const BYTES_PER_MS = (OUTPUT_RATE * 2) / 1000;
/** 按着时到的声音不到 100 毫秒就不 commit:百炼回「buffer too small, or have no audio」,不会有转写(2026-10-19 iPad 麦克风没开,嘴照样接住说了「你想问什么」) */
const MIN_COMMIT_BYTES = (INPUT_RATE * 2 * 100) / 1000;
/** 心跳间隔;孩子最后一次动静之后跳多久(过了就让百炼 300 秒后关,回来按下再连,连一次约半秒) */
const HEARTBEAT_MS = 30_000;
const KEEP_ALIVE_MS = 15 * 60_000;
/** 嘴最近一次回答的输入过了这么多 token,安静时换一条新连接(约 9 轮一换) */
const SWAP_TOKENS = 3000;
/** 放小课堂一段的那句:孩子端放那一段,最多等它这么久就接着念(孩子端没回 staged 时不卡死) */
const GATE_MS = 180_000;
/** 现连时攒着的声音最多一分钟;一直听时只留最近 10 秒(更早的孩子早不等了) */
const MAX_BACKLOG_BYTES = INPUT_RATE * 2 * 60;
const MAX_OPEN_BACKLOG_BYTES = INPUT_RATE * 2 * 10;
/** 一直听:收下一句以后,孩子停一下又开口(或刚说完在等转写),交给脑最多再等这么久,收下的并进来 */
const MERGE_WAIT_MS = 8000;
/** 一直听:一句收下以后先等这么久,看孩子是不是又开口(没有接住那句垫着了) */
const OPEN_PEEK_MS = 800;
/** 一直听:commit 了没回答,离上次回答这么久就在安静时换连接(百炼 300 秒报 response_idle_timeout) */
const IDLE_SWAP_MS = 240_000;
/** 请他说:[[请 说]] 那句在孩子端放完,这么久没开口就接着下一拍(不催);连着这么多拍没开口就停下交脑 */
const ECHO_WAIT_MS = 8000;
const QUIET_BEATS = 2;
/** 嘴先答:连着这么多次没说中,就交给脑(脑在页上写句型、换个问法) */
const REPLY_MISSES = 2;
/**
 * 嘴先答:一条连接里给了这么多张图,安静时换一条新的(图比字贵得多,嘴每次回答都带着整条连接的历史)。
 * 起点,没量过:要拿 scripts/probe-live-*.mjs 的做法真连百炼量一张图多少 token、几张以后首包变慢(花钱,先问 Jack)
 */
const MOUTH_IMAGES_SWAP = 3;
/**
 * 录像切段:这一段这么久没动静、或录了这么久(两轮之间安静着才切),就收下落盘、接着录新的一段。
 * 页面开着不关能挂几个钟头(2026-10-25 一段 2 小时、361 MB 的 wav,几乎没说话):不切的话声音全攒在内存里,挂断时一起混
 */
const IDLE_CUT_MS = 5 * 60_000;
const MAX_TAKE_MS = 30 * 60_000;
/** 板上点完字多久没动静,应用替孩子叫一次老师(起点,试用后调) */
const STILL_MS = 12_000;
/**
 * 要嘴说了,这么久一块声音、一个字都没出就算卡住(真百炼首包约 0.5 秒;2026-10-31 照念第二段回了 created 就再没动静,孩子只听到第一句):
 * 当这条连接坏了,照念的那段放回排头、换一条接着念(一个字没出,孩子没听过,再念不重复)
 */
const STALL_MS = 10_000;

/** 字幕重放的声音最多留几轮在内存里(一轮约 1–2 MB;落了盘就只为接着往后接) */
const MOUTH_KEEP = 3;




export class LiveCall {
  private session: RealtimeSession | null = null;
  private readonly rec: CallRecorder;
  /** 交付:讲稿排队、嘴的声音在孩子端排到哪、第几句开始放、打断时听到第几句(./delivery.ts) */
  private readonly d: Delivery;
  private holding = false;
  /** 这一次按着推进去多少字节的声音 */
  private heldBytes = 0;
  /** 要了还没出完的那次回答;afterDone = 它出完(或被掐)之后再做的 */
  private said: Said | null = null;
  private afterDone: (() => void) | null = null;
  private cancelOnCreate = false;
  /** 这次回答出过声音或字没有(看门狗 STALL_MS 看它) */
  private saidOut = false;
  /** 这一轮:嘴接住时说的、接住出完没有 */
  private caught = '';
  private caughtDone = false;
  /** 嘴这一道的事件(补进那一轮的 events.jsonl)与字幕重放的声音(./journal.ts) */
  private readonly events: MouthEvents;
  private readonly takes: MouthTakes;
  /** 交给脑:验与拼、runner.send、脑忙时排着(./turns.ts) */
  private readonly turns: Turns;
  private turnSeq = 0;
  /** 按住说的这一轮还在等转写 */
  private pendingVoice: { seq: number; body: Record<string, unknown> } | null = null;
  private readonly timers: NodeJS.Timeout[] = [];
  /** 孩子最近一次按下、松手、发来,或嘴说完一次的墙钟(心跳看它) */
  private lastActive = Date.now();
  /** 嘴最近一次回答的输入 token(连接的历史越长越多);过了 SWAP_TOKENS 安静时换连接 */
  private lastInput = 0;
  private swapping = false;
  /** 第一次连上了:之后嘴没了是断了要现连,不是连不上 */
  private opened = false;
  /** 正在现连;连上之前孩子端来的按下、松手、发来、按着的声音照到达的顺序攒着 */
  private reviving: Promise<boolean> | null = null;
  private backlog: ({ m: Record<string, unknown>; at: number } | { pcm: Buffer })[] = [];
  private backlogBytes = 0;
  private backlogHolding = false;
  /** 一直听:孩子端要的(open)与嘴这条会话开着 VAD 没有(mouthOpen);不一样就在安静时换连接 */
  private open: boolean;
  private mouthOpen = false;
  /** 一直听:VAD 判着孩子在说、开口的时刻(通话毫秒);说完了在等转写的(说完的时刻) */
  private vadOn = false;
  private vadFrom = 0;
  /** 孩子开口那一刻嘴的声音还在放(或刚放完 300 毫秒内):只有这时才可能是回声 */
  private vadOverMouth = false;
  private vadAwait: number | null = null;
  /** 一直听:嘴的声音让孩子端压低着 */
  private ducked = false;
  /** 一直听:孩子端开口时报的这一轮上下文(话题、设备、via、舞台上的卡),收下时当松手的 body */
  private ctxBody: Record<string, unknown> = {};
  /** 嘴最近说过的话(比回声),at = 那段在孩子端放完的墙钟 */
  private saidLog: { text: string; at: number }[] = [];
  /** 一直听:收下了还没交给脑的几句(孩子停一下接着说的并进来) */
  private draft: { seq: number; texts: string[] } | null = null;
  /** 一直听:孩子的声音最后到的墙钟、上次回答以后有没有 commit 过、上次回答(或连上)的墙钟、孩子端关着麦 */
  private lastAudioAt = 0;
  private committedSince = false;
  private lastResponseAt = Date.now();
  private gated = false;
  /** 请他说:交给嘴的那段最后一句要孩子说。endAt = 那句在孩子端放完的通话毫秒(嘴出完才知道);heardAt = 孩子开口的通话毫秒;overdue = 等够了时孩子正在说 */
  private echoing: { echo: Echo; ask: string; endAt: number | null; heardAt: number | null; timer: NodeJS.Timeout | null; overdue: boolean } | null = null;
  /** 请他说:按住说时松手了、在等这一下的转写(说了那句还是对老师说的);那一下松手的 body */
  private echoHeld: Record<string, unknown> | null = null;
  /** 请他说的每拍记的、连着没开口的拍数 */
  private warm: EchoBeat[] = [];
  private quietBeats = 0;
  /**
   * 嘴先答(脑这一轮起来时 runner 说的 reply: mouth):这一轮是不是;连着没说中几次;嘴在提示、提示完了接着等的那一句;
   * 上一轮以后嘴替脑接的那几句(交给脑时带 live.mouth、带了就清);孩子眼前那块最新的图、给过这条连接的那张、这条连接里给过几张
   */
  private reply = false;
  private replyMiss = 0;
  private replyArm: { echo: Echo; ask: string } | null = null;
  private mouthLog: string[] = [];
  private shotJpeg: Buffer | null = null;
  private shotGiven: Buffer | null = null;
  private mouthImages = 0;
  /** 嘴这次(或孩子端还在放的那段)是照念点字的那句 */
  private sayingPick = false;
  /** 板上点完字,等着看他开不开口;stillUsed = 这一回已经替他叫过老师 */
  private stillTimer: NodeJS.Timeout | null = null;
  /** 板上报来的事(Runner.boardEvent)排成一条 */
  private boards: Promise<void> = Promise.resolve();
  private stillUsed = false;
  /** 收笔(./pen.ts):笔在不在页上、什么时候替他交;那一个计时 */
  private pen = penInit();
  private penTimer: NodeJS.Timeout | null = null;
  private penThread: string | null = null;
  private offEvents: (() => void) | null = null;
  /** 录像一段一段排着落盘(按顺序、一次混一段);挂了等它们都落完 */
  private saving: Promise<void> = Promise.resolve();
  private ended = false;
  private readonly sock: KidSocket;
  private readonly deps: LiveDeps;

  constructor(sock: KidSocket, deps: LiveDeps) {
    this.sock = sock;
    this.deps = deps;
    this.rec = new CallRecorder(deps.ctx.now);
    this.events = new MouthEvents((date, job, ev) => void deps.ctx.runner.noteEvent(deps.tutor, date, job, ev));
    this.d = new Delivery({ now: () => this.ms(), send: (o) => this.send(o), event: (job, at, ev) => this.events.record(job, at, ev), onRead: (beat) => this.read(beat), ended: () => this.ended });
    this.turns = new Turns({
      runner: deps.ctx.runner,
      now: deps.ctx.now,
      tutor: deps.tutor,
      deviceId: deps.deviceId,
      live: (body) => this.liveOf(body),
      send: (o) => this.send(o),
      started: (st) => {
        this.d.begin(st.job);
        this.reply = st.reply === 'mouth';
        this.replyMiss = 0;
        // 字幕重放:这一轮的声音从这里接
        this.takes.open(st.job, st.date);
        this.send({ t: 'turn', job: st.job, thread: st.thread });
      },
      lines: (job, lines) => { if (this.d.job === job) this.d.lines(lines); },
      failed: (job, why) => this.brainFailed(job, why),
      settled: () => this.maybeSwap(),
      timer: (t) => this.timers.push(t),
      ended: () => this.ended,
    });
    this.takes = new MouthTakes({ conversations: () => deps.ctx.runner.ws.dirs.conversations, tutor: deps.tutor, keep: MOUTH_KEEP, bytesPerMs: BYTES_PER_MS, rate: OUTPUT_RATE });
    this.open = deps.listen === 'open';
  }

  private ms(): number { return this.rec.ms(); }
  /** 通话里的毫秒 → 墙钟 */
  private wall(ms: number): number { return this.rec.startedAt.getTime() + ms; }
  /** 记嘴这一道的一条:那一轮起来了就补进它的事件,还不知道是哪一轮(job = null)就先攒着 */
  private mouth(job: string | null, at: number, ev: MouthEvent): void {
    this.events.record(job, at, ev);
  }
  private send(o: Record<string, unknown>): void {
    this.rec.out(o);
    this.sock.sendText(JSON.stringify(o));
  }
  private playing(): boolean { return Boolean(this.session?.responding) || this.ms() < this.d.end; }
  private state(): void { this.send({ t: 'state', speaking: this.playing(), holding: this.holding }); }

  /** 排队说这一拍该交给嘴了:要嘴照念;请他说的那句念完要等孩子说 */
  private read(beat: Beat): void {
    if (beat.echo) this.echoing = { echo: beat.echo, ask: beat.texts[beat.texts.length - 1] ?? '', endAt: null, heardAt: null, timer: null, overdue: false };
    this.ask({ kind: 'read', beat }, readCue(beat.texts));
    // 这段最后一句念完孩子端放小课堂那一段:排队关着闸,等 staged;孩子端一直没回也别卡死
    if (beat.play) this.timers.push(setTimeout(() => { if (!this.ended && this.d.gated) this.d.step({ e: 'staged' }); }, GATE_MS));
  }

  /** 让嘴说一次;接住要先告诉排队,嘴出完之前别交讲稿 */
  private ask(said: Said, instructions: string): void {
    this.said = said;
    this.sayingPick = said.kind === 'say';
    this.saidOut = false;
    if (said.kind !== 'read') this.d.note({ e: 'asked' });
    this.session?.createResponse(instructions);
    this.timers.push(setTimeout(() => this.stalled(said), this.deps.stallMs ?? STALL_MS));
  }

  /** 要嘴说的这次一个字、一块声音都没出(STALL_MS):当这条连接坏了,照念的那段放回排头、换一条接着念;别的(接住、点字照念、嘴先答的提示)不补 */
  private stalled(said: Said): void {
    if (this.ended || this.said !== said || this.saidOut) return;
    const old = this.session;
    this.rec.out({ t: 'stall', kind: said.kind });
    this.lost('stall');
    old?.close('stall');
    // 放回排头以后排队不交(连接还没换好),现连好了 revive 里 done 再交
    if (said.kind === 'read') { this.d.retry(said.beat); void this.revive(); }
  }

  /** 连嘴;连不上告诉孩子端(它灰着「正在叫老师」、过一会儿重连)、挂掉 */
  async start(): Promise<void> {
    const why = await this.connectMouth();
    if (this.ended) return;
    if (why !== null) { this.send({ t: 'down', why }); await this.end(`connect:${why}`); return; }
    this.opened = true;
    const { ctx, tutor } = this.deps;
    this.offEvents = ctx.runner.onEvent((e) => {
      if (e.tutor !== tutor || e.job !== this.d.job) return;
      // 这一轮的老师进程起来了:攒着的按下、松手、接住按它的起点补进它的事件
      if (e.event.lane === 'main' && e.event.kind === 'start') this.events.started(e.job, e.date, Date.now() - e.event.t);
      // 讲稿定稿一句(partial 解析器压着没换行的最后一句,发出来的都是定稿的)就交给排队
      if (e.event.lane === 'main' && e.event.kind === 'line') this.d.lines([{ i: e.event.line, text: e.event.text, play: e.event.play === true, echo: e.event.echo }]);
    });
    this.timers.push(setInterval(() => this.keepAlive(), this.deps.heartbeatMs ?? HEARTBEAT_MS));
    this.send({ t: 'ready' });
  }

  /** 开一条嘴的会话(第一次、断了以后现连、换连接都走这里);不是 this.session 的会话,回调都不认 */
  private async openMouth(): Promise<{ why: string | null; s: RealtimeSession; open: boolean }> {
    const { ctx, tutor } = this.deps;
    const cfg = ctx.runner.ws.config;
    const t = cfg.tutors[tutor];
    let firstOfAnswer = true;
    const open = this.open;
    const s: RealtimeSession = new RealtimeSession({ instructions: mouthInstructions({ display: t?.display ?? tutor, kidName: cfg.kid.name ?? cfg.kid.slug }), voice: mouthVoice(cfg.live, tutor), model: cfg.live.model, turn: open ? cfg.live.vad : 'manual', silenceMs: cfg.live.silenceMs, vad: { createResponse: false, interruptResponse: false }, endpoint: this.deps.endpoint, env: this.deps.env }, {
      onAudio: (pcm) => {
        if (this.session !== s) return;
        this.saidOut = true;
        const said: Said = this.said ?? { kind: 'catch' };
        const start = this.d.add(said, pcm.length / BYTES_PER_MS);
        // 照念的第一块:到它在孩子端开始放的那一刻,告诉孩子端这段的第一句;接住的第一块记一条(开始放的时刻)
        if (firstOfAnswer && said.kind === 'read') this.d.readAt(said.beat, 0, start);
        if (firstOfAnswer && said.kind === 'catch' && this.holding === false) this.mouth(null, this.wall(start), { lane: 'mouth', kind: 'catch', text: '' });
        firstOfAnswer = false;
        // 字幕重放:照念的声音另留一份(孩子端放没放都留)
        const seg = this.mouthSeg(said);
        if (seg) { seg.pcm.push(pcm); seg.bytes += pcm.length; }
        this.rec.tutor(pcm);
        this.sock.sendBinary(pcm);
      },
      onTutorText: (delta, done) => {
        if (this.session !== s) return;
        this.saidOut = true;
        const kind = this.said?.kind ?? 'catch';
        // 垫的那句在孩子端同接住的字一样上字幕
        const of = kind === 'read' ? 'read' : 'catch';
        if (done !== null) {
          if (done.trim()) this.saidLog = [...this.saidLog.slice(-5), { text: done.trim(), at: Date.now() }];
          if (kind === 'catch') { this.caught = done.trim(); this.caughtDone = true; this.events.caught(this.caught); }
          if (kind === 'reply' && done.trim()) this.mouthLog.push(`嘴:${done.trim()}`);
          this.send({ t: 'tutor', of, done: done.trim() });
          return;
        }
        if (delta) {
          // 字幕重放:这段没出齐就停了的话,按出了几个字摊每句的起点
          const seg = this.said ? this.mouthSeg(this.said, false) : null;
          if (seg) seg.heard += delta.length;
          this.send({ t: 'tutor', of, delta });
        }
      },
      onKidText: (text) => { if (this.session !== s) return; if (this.mouthOpen) this.verdict(text); else this.heard(text); },
      onSpeech: (st) => { if (this.session === s && this.mouthOpen) this.speech(st); },
      onRejected: () => { if (this.session === s && this.mouthOpen) this.verdict(null, 'rejected'); },
      onKidFailed: () => { if (this.session === s) this.kidFailed(); },
      onResponse: (st, status, usage) => {
        if (this.session !== s) return;
        if (st === 'done' && usage) this.lastInput = usage.input;
        if (st === 'created') {
          firstOfAnswer = true;
          if (this.cancelOnCreate) { this.cancelOnCreate = false; this.session?.cancel(); }
          this.state();
          return;
        }
        if (this.said?.kind === 'read') this.mouthEnd(this.said, status !== 'cancelled');
        if (status === 'cancelled') this.d.flush();
        else if (this.said?.kind === 'read') {
          this.d.readRest(this.said);
          // 请他说的那句出齐了:知道它在孩子端什么时候放完,从那时起等孩子
          if (this.said.beat.echo) this.armEcho(this.d.end);
        }
        // 比回声按这段在孩子端放完的时刻算(字早就出完了,声音要放十几秒)
        const last = this.saidLog[this.saidLog.length - 1];
        if (last && status !== 'cancelled') last.at = Math.max(last.at, this.wall(this.d.end));
        this.lastResponseAt = Date.now();
        this.committedSince = false;
        if (this.said?.kind === 'catch') this.caughtDone = true;
        // 嘴先答提示完了:接着等他说那一句(从提示在孩子端放完的时刻起等)
        if (this.said?.kind === 'reply') this.rearmReply(status === 'cancelled' ? this.ms() : this.d.end);
        this.said = null;
        this.lastActive = Date.now();
        this.d.idle();
        const next = this.afterDone;
        this.afterDone = null;
        if (next) next();
        else this.d.step({ e: 'done' });
        this.state();
        this.maybeSwap();
      },
      onError: (m) => {
        if (this.session !== s) return;
        this.send({ t: 'err', status: 502, error: m });
        void this.deps.ctx.mouthHealth?.(m, true);
        // commit 没收下(声音太少):这一句不会有转写,照转写是空的办
        if ((this.pendingVoice || this.echoHeld) && /committing input audio buffer/i.test(m)) this.heard('');
      },
      // 连上以后断了才收;还在连的时候断(配会话报错)由调用方处理
      onClose: (r) => { if (!this.ended && this.session === s) this.lost(r); },
    });
    const why = await s.connect();
    if (this.ended) { s.close(); return { why: 'ended', s, open }; }
    return { why, s, open };
  }

  /** 开一条嘴的会话并换上(第一次、断了以后现连) */
  private async connectMouth(): Promise<string | null> {
    const { why, s, open } = await this.openMouth();
    if (why === null) {
      this.mounted(s, open);
      void this.deps.ctx.mouthHealth?.(null);
    } else await this.deps.ctx.mouthHealth?.(why);
    return why;
  }

  /** 换上一条嘴的会话:一直听的状态都从头来 */
  private mounted(s: RealtimeSession, open: boolean): void {
    this.session = s;
    // 新连接里没有图:孩子眼前那块下次照给
    this.shotGiven = null;
    this.mouthImages = 0;
    if (this.mouthOpen !== open) this.send({ t: 'listen', open });
    this.mouthOpen = open;
    this.vadOn = false;
    this.vadAwait = null;
    this.committedSince = false;
    this.lastResponseAt = Date.now();
    if (this.ducked) { this.ducked = false; this.send({ t: 'unduck' }); }
  }

  /** 安静:孩子没按着、嘴没在说也没要说的、讲稿没排着、脑没在写、没在现连 / 换连接 */
  private quiet(): boolean {
    return !this.holding && !this.vadOn && this.vadAwait === null && !this.said && !this.session?.responding && !this.d.pending && !this.d.gated && !this.turns.busy && !this.reviving && !this.swapping;
  }

  /**
   * 换连接:嘴的输入每次回答都带着整条连接的历史,一轮约多 230 token(2026-10-20 真连 15 轮:843 涨到 5468,
   * 首包不变,只是钱);嘴每次都给词、不靠前情,安静时开一条新的换上就行,不用摘要。开的时候孩子动了就作废这次。
   */
  private maybeSwap(): void {
    if (this.ended || !this.session) return;
    // 换的三种:历史长了;孩子端换了模式(按住说 ↔ 一直听);一直听放过的句子攒着没回答,快到百炼的 response_idle_timeout
    const why = this.open !== this.mouthOpen ? 'listen' : this.lastInput >= (this.deps.swapTokens ?? SWAP_TOKENS) ? 'tokens' : this.mouthImages >= MOUTH_IMAGES_SWAP ? 'images' : this.mouthOpen && this.committedSince && Date.now() - this.lastResponseAt > (this.deps.idleSwapMs ?? IDLE_SWAP_MS) ? 'idle' : null;
    if (!why || !this.quiet()) return;
    this.swapping = true;
    void this.openMouth().then(({ why: failed, s, open }) => {
      this.swapping = false;
      if (failed !== null) return;
      if (this.ended || !this.session || !this.quiet()) { s.close('swap-abort'); return; }
      const old = this.session;
      this.rec.out({ t: 'swap', input: this.lastInput, why });
      this.mounted(s, open);
      this.lastInput = 0;
      old.close('swap');
    });
  }

  /** 嘴的会话断了(百炼 300 秒没输入就关、网断了):电话不挂;讲稿还排着就马上连、接着念,不然等孩子下次按下或发来再连 */
  private lost(why: string): void {
    this.session = null;
    // 只记进录像,孩子端不知道
    this.rec.out({ t: 'lost', why });
    // 照念到一半断了:出了的那截留着
    if (this.said?.kind === 'read') this.mouthEnd(this.said, false);
    if (this.said?.kind === 'catch') this.caughtDone = true;
    // 嘴先答提示到一半断了:接着等他说那一句
    if (this.said?.kind === 'reply') this.rearmReply(this.ms());
    if (this.said) { this.said = null; this.afterDone = null; this.cancelOnCreate = false; this.d.idle(); }
    // 请他说那句没出齐就断了:从现在起等孩子,别卡死
    if (this.echoing && this.echoing.endAt === null) this.armEcho(this.ms());
    // 按着时断的:推过去的声音跟着那条会话没了,松手就说没听清
    this.heldBytes = 0;
    // 一直听时孩子说到一半断的:那一句跟着会话没了
    this.vadOn = false;
    this.vadAwait = null;
    if (this.ducked) { this.ducked = false; this.send({ t: 'unduck' }); }
    // 一直听、声音还在推:没有「下次按下」,马上连
    if (this.d.pending || (this.open && Date.now() - this.lastAudioAt < 5000)) void this.revive();
  }

  /** 现连嘴(最多两次);连上了把攒着的照到达的顺序补上、排着的讲稿接着念;连不上告诉孩子端、挂掉 */
  private revive(): Promise<boolean> {
    this.reviving ??= (async () => {
      let why: string | null = 'ended';
      for (let i = 0; i < 2 && !this.ended && why !== null; i++) why = await this.connectMouth();
      this.reviving = null;
      if (this.ended) return false;
      if (why !== null) { this.send({ t: 'down', why }); await this.end(`reconnect:${why}`); return false; }
      const items = this.backlog.splice(0);
      this.backlogBytes = 0;
      this.backlogHolding = false;
      for (const x of items) { if ('pcm' in x) this.pushAudio(x.pcm); else this.handle(x.m, x.at); }
      if (!this.said) this.d.step({ e: 'done' });
      return true;
    })();
    return this.reviving;
  }

  /** 心跳(RealtimeSession.heartbeat):嘴连着、孩子没按着、嘴没在说、最近有动静;孩子走开久了就不跳,让百炼关,回来按下再连 */
  private keepAlive(): void {
    const s = this.session;
    this.maybeSwap();
    this.maybeCut();
    if (!s?.isReady || this.holding || this.vadOn || s.responding || Date.now() - this.lastActive > (this.deps.keepAliveMs ?? KEEP_ALIVE_MS)) return;
    // 一直听、声音一直在推:本来就有输入,不用跳
    if (this.mouthOpen && Date.now() - this.lastAudioAt < 5000) return;
    s.heartbeat();
  }

  /** 字幕重放:这次照念在它那一轮里的那一段(第一块声音到时开;make = false 只找不开);接住、那一轮不在内存里的不留 */
  private mouthSeg(said: Said, make = true): ReturnType<MouthTakes['seg']> {
    return said.kind === 'read' ? this.takes.seg(said, said.beat, make) : null;
  }

  /** 字幕重放:一段出完了(done)/ 被掐了、断了:这一轮整份重落一次 */
  private mouthEnd(said: Said, done: boolean): void {
    if (said.kind === 'read') this.takes.end(said, said.beat, done);
  }

  /** 孩子按下(或不是说的那一轮开始):嘴在出就掐、还在放就清孩子端;排着的丢掉;记下孩子听到第几句 */
  private interrupt(): void {
    const now = this.ms();
    const playing = this.playing();
    // 排着的丢掉、记下孩子听到第几句、撤掉还没发的 read
    this.d.interrupt(playing, this.said, now);
    // 请他说不等了(排着的那几拍跟着丢了;摸底留着)
    if (this.echoing?.timer) clearTimeout(this.echoing.timer);
    this.echoing = null;
    this.echoHeld = null;
    this.afterDone = null;
    if (this.session?.responding) this.session.cancel();
    else if (this.said) this.cancelOnCreate = true;
    if (playing) { this.d.flush(now); this.send({ t: 'flush' }); }
  }

  /**
   * 录像切段:两轮之间安静着(孩子没在说、嘴没在说也没在放、脑没在写、没在等转写),这一段没动静够久了或录得够长了,就收下落盘。
   * 一轮不会被切开:录像按轮在一段里找按下、松手、turn 和 read
   */
  private maybeCut(): void {
    if (this.ended || !this.quiet() || this.playing() || this.pendingVoice || this.draft || this.echoing) return;
    const idle = this.rec.quietMs() >= (this.deps.idleCutMs ?? IDLE_CUT_MS);
    const long = this.rec.stirred && this.rec.takeMs() >= (this.deps.maxTakeMs ?? MAX_TAKE_MS);
    if (idle || long) this.saveTake(this.rec.cut());
  }

  /** 落一段录像(排在前面那几段后面):没动静的、只有连上那两条的不落 */
  private saveTake(raw: RawTake): void {
    if (!raw.stirred || raw.msgs.length <= 2) return;
    const { ctx, tutor } = this.deps;
    this.saving = this.saving.then(async () => {
      const take = await renderTake(raw);
      const dir = join(ctx.runner.ws.dirs.conversations, tutor, `${localDate(raw.startedAt)}.live`);
      await mkdir(dir, { recursive: true });
      const name = takeName(dir, raw.startedAt);
      await writeFile(join(dir, `${name}.wav`), wavOfPcm(take.callPcm, MIX_RATE));
      await writeFile(join(dir, `${name}.reel.json`), JSON.stringify(take.reel));
    }).catch((err) => { console.error('live: 录像落盘失败', err); });
  }

  /** 孩子的一条文本消息 */
  onText(raw: string): void {
    if (this.ended) return;
    let m: Record<string, unknown>;
    try { m = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    if (typeof m.t !== 'string') return;
    // 录像不存图(一张一两百 KB,画在纸上的那张交画时另存了)
    this.rec.in(withoutImages(m));
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
        this.events.begin([{ at, ev: { lane: 'mouth', kind: 'hold' } }]);
        this.holding = true;
        this.stillReset();
        this.heldBytes = 0;
        this.session.clearAudio();
        // 请他说在等孩子跟:按下就是在跟,不打断(排着的几拍留着);那句的声音还没放完就清掉
        if (this.echoing) {
          if (this.echoing.heardAt === null) this.echoing.heardAt = this.ms();
          if (this.playing()) { this.d.flush(); this.send({ t: 'flush' }); }
        } else this.interrupt();
        this.state();
        break;
      }
      case 'release': {
        if (!this.session || !this.holding) return;
        this.holding = false;
        const body = isObj(m.body) ? m.body : {};
        this.events.record(null, at, { lane: 'mouth', kind: 'release', how: 'voice' });
        // 请他说在等孩子跟:等转写回来再判是跟读还是对老师说的(heard)
        if (this.echoing) {
          if (this.heldBytes < MIN_COMMIT_BYTES) { this.session.clearAudio(); this.echoHeard(''); break; }
          // 嘴先答:孩子眼前那块图跟着这段声音进对话(百炼要先有声音再有图)
          if (this.replyTakes()) this.giveShot();
          this.session.commit();
          this.echoHeld = body;
          this.state();
          break;
        }
        if (this.heldBytes < MIN_COMMIT_BYTES) {
          this.session.clearAudio();
          // 按住「给老师看」没说出话:照交,嘴不先说
          if (handsIn(body)) { this.turn('card', body, ''); break; }
          this.send({ t: 'kid', text: '' });
          this.turn('empty', body);
          break;
        }
        this.session.commit();
        this.turn(this.d.asked && !opensThread(body) ? 'answer' : 'voice', body);
        break;
      }
      case 'hush': {
        if (!this.session) return;
        // 按了说话又取消也是他动了:等着替他叫的那次作废
        this.stillReset();
        if (this.holding) { this.holding = false; this.session.clearAudio(); }
        this.interrupt();
        this.d.note({ e: 'release' });
        this.state();
        break;
      }
      case 'send': {
        if (!this.session || !isObj(m.body)) return;
        const body = m.body;
        const kind: CatchKind = body.action === 'submit' ? 'card' : Array.isArray(body.photos) && body.photos.length ? 'photo' : isObj(body.via) ? 'start' : 'text';
        this.interrupt();
        this.events.begin([{ at, ev: { lane: 'mouth', kind: 'release', how: kind === 'card' || kind === 'photo' ? kind : 'text' } }]);
        const text = typeof body.text === 'string' ? body.text : '';
        this.turn(kind, body, text);
        break;
      }
      // 孩子端放完了小课堂那一段(或放不了、被关):后面的讲稿接着交给嘴
      case 'staged': this.d.step({ e: 'staged' }); break;
      // 孩子在页上点了一个字
      // 一件一件排着记(「给老师看」前舞台先交的那张窗图要先落下,交给脑那一轮在 toBrain 里等它)
      case 'board': { const body = m.body, seq = this.turnSeq; this.boards = this.boards.then(() => this.board(body, seq)).catch(() => undefined); break; }
      // 一直听:孩子端开口时报的上下文(收下时当松手的 body)
      case 'ctx': if (isObj(m.body)) this.ctxBody = m.body; break;
      // 一直听:孩子端停推(关麦、卡的声音、录音、小课堂)/ 接着推;停的时候孩子正说到一半,那一句作废
      case 'gate': {
        this.gated = m.on === false;
        if (!this.gated) break;
        this.lastActive = Date.now();
        if (this.vadOn || this.vadAwait !== null) {
          this.session?.clearAudio();
          this.vadOn = false;
          this.vadAwait = null;
          this.send({ t: 'vad', on: false });
          this.resume();
        }
        break;
      }
      // 从首页「一直听」进来:嘴先招呼一句(不进脑、不算一条);嘴在说、孩子在说、按住说时都不招呼
      // 孩子端换了模式:安静时换一条连接(silence 只有新连接能给)
      case 'listen': {
        if (typeof m.open !== 'boolean') break;
        this.open = m.open;
        this.lastActive = Date.now();
        if (!this.session && this.opened) void this.revive();
        else this.maybeSwap();
        break;
      }
      case 'view': this.rec.view(m.w, m.h); break;
      case 'bye': void this.end('bye'); break;
      default: break;
    }
  }

  /**
   * 一轮开始:多半嘴不出声,等脑的第一句(孩子端左栏头像在想);拍照、收笔这几种才先说一句(src/realtime/cues.ts;上一次回答被掐了还没回 done 就等它回了再说)。
   * 说的等转写回来再交给脑,不是说的直接交
   */
  private turn(kind: CatchKind, body: Record<string, unknown>, text?: string, cueOverride?: string): void {
    const seq = ++this.turnSeq;
    this.stillReset();
    if (kind !== 'pen') this.penStep({ e: 'turn' });
    this.caught = '';
    this.d.note({ e: 'release' });
    // 按住说的等转写回来(heard);一直听的转写已经有了(text)
    this.pendingVoice = (kind === 'voice' || kind === 'answer') && text === undefined ? { seq, body } : null;
    // 嘴先答说中了:嘴先接的那句就是这一轮的接住
    const cue = cueOverride ?? catchCue(kind);
    this.caughtDone = cue === null;
    if (cue !== null) {
      const go = (): void => this.ask({ kind: 'catch' }, cue);
      if (this.said) this.afterDone = go; else go();
    }
    if (text !== undefined) void this.toBrain(seq, { ...body, text });
  }

  /**
   * 脑这一轮没成、一句也没写出来:孩子不能对着不出声的老师一直说。嘴说一句(cues 的 away / retry),不说错、不说原因;
   * 已经念了几句的、孩子又开口换了一轮的(d.job 不是它)不说
   */
  private brainFailed(job: string, why: string): void {
    if (this.ended || this.d.job !== job || this.d.queuedLines > 0 || !this.session) return;
    const cue = catchCue(needsParent(troubleKind(why)) ? 'away' : 'retry')!;
    const go = (): void => this.ask({ kind: 'catch' }, cue);
    if (this.said) this.afterDone = go; else go();
  }

  /** 孩子那句的转写回来了:空的改说没听清、不交给脑;不空交给脑 */
  private heard(text: string): void {
    if (this.echoHeld) { this.echoHeard(text); return; }
    this.send({ t: 'kid', text });
    const v = this.pendingVoice;
    this.pendingVoice = null;
    if (!v || v.seq !== this.turnSeq) return;
    if (text.trim()) { void this.toBrain(v.seq, { ...v.body, text }); return; }
    // 按住「给老师看」说的转写是空的:板照交,不说没听清
    if (handsIn(v.body)) { void this.toBrain(v.seq, { ...v.body, text: '' }); return; }
    const sorry = (): void => this.ask({ kind: 'catch' }, catchCue('empty')!);
    if (!this.said) { sorry(); return; }
    // 接住还在要 / 在出:掐掉,出完(被掐)再说没听清
    this.afterDone = sorry;
    if (this.session?.responding) this.session.cancel(); else this.cancelOnCreate = true;
    if (this.playing()) { this.d.flush(); this.send({ t: 'flush' }); }
  }

  /** 一直听:VAD 判出孩子开口 / 说完。开口先暂停照念(不丢)、嘴在放就让孩子端压低;说完了等转写 */
  private speech(st: 'started' | 'stopped'): void {
    this.lastActive = Date.now();
    if (st === 'started') {
      this.vadOn = true;
      this.vadFrom = this.ms();
      if (this.echoing && this.echoing.heardAt === null) this.echoing.heardAt = this.vadFrom;
      // 嘴先答:孩子眼前那块图趁他在说放进这段声音(说完 VAD 一起交)
      if (this.echoing && this.replyTakes()) this.giveShot();
      this.vadOverMouth = this.playing() || this.ms() < this.d.end + 300;
      this.d.note({ e: 'pause' });
      if (this.playing() && !this.ducked) { this.ducked = true; this.send({ t: 'duck' }); }
      this.send({ t: 'vad', on: true });
      return;
    }
    if (!this.vadOn) return;
    this.vadOn = false;
    this.vadAwait = this.ms();
    this.committedSince = true;
    this.send({ t: 'vad', on: false });
  }

  /** 一直听:放过一句(或孩子端关麦作废了一句),照念接着走、压低的恢复 */
  private resume(): void {
    if (this.ducked) { this.ducked = false; this.send({ t: 'unduck' }); }
    if (!this.holding) this.d.step({ e: 'release' });
    this.maybeSwap();
  }

  /** 一直听:一句的转写回来了(null = VAD 不收、转写失败)。收下 = 按下 + 松手;放过的什么都不做,照念接着走 */
  private verdict(text: string | null, failed?: 'rejected' | 'failed'): void {
    const from = this.vadFrom;
    const to = this.vadAwait ?? this.ms();
    this.vadOn = false;
    this.vadAwait = null;
    // 请他说在等孩子跟:「嗯」不算回答(那句是问句也一样);那句放完以后才开口的,字和嘴说的一样就是在跟,不比回声(放完前 300 毫秒的尾巴也不算嘴)
    const after = this.echoing?.endAt != null && from >= this.echoing.endAt;
    const v = text === null ? { take: false as const, why: failed ?? 'rejected' } : judge(text, { asked: this.d.asked && !this.echoing, said: this.saidLog, now: Date.now(), mouthOn: this.vadOverMouth && !after });
    if (!v.take) {
      this.send({ t: 'skip', why: v.why, text: text ?? '' });
      this.resume();
      if (this.echoing?.overdue) this.echoDue();
      return;
    }
    const said = text ?? '';
    this.lastActive = Date.now();
    // 请他说:像跟读就开闸下一拍(不接住、不交脑);对老师说的记一笔,照收下往下走
    let cue: string | undefined;
    if (this.echoing) {
      const kind = echoKind(said, this.echoing.echo.word);
      this.noteEcho(kind, said);
      if (kind === 'said' && !this.echoLast()) {
        this.rec.in({ t: 'hold', vad: true }, from);
        this.rec.in({ t: 'release', vad: true, echo: true }, to);
        this.echoed();
        return;
      }
      // 嘴先答:最后那句请他说的,他答了;没说中嘴提示、接着等(不交脑);说中了嘴接一句当接住
      if (kind === 'said' && this.replyTakes()) {
        const r = this.replyTo(said);
        if (r.to === 'mouth') {
          this.send({ t: 'kid', text: said });
          this.rec.in({ t: 'hold', vad: true }, from);
          this.rec.in({ t: 'release', vad: true, reply: true }, to);
          return;
        }
        cue = r.cue;
      }
    }
    this.send({ t: 'kid', text: said });
    // 录像按孩子端的按下 / 松手画这一句:补记开口、说完两条(当时的时刻)
    this.rec.in({ t: 'hold', vad: true }, from);
    this.rec.in({ t: 'release', vad: true, body: this.ctxBody }, to);
    // 停一下接着说的:上一句还没交给脑,并进去
    if (this.draft && this.draft.seq === this.turnSeq) {
      this.draft.texts.push(said);
      if (this.ducked) { this.ducked = false; this.send({ t: 'unduck' }); }
      if (!this.holding) this.d.step({ e: 'release' });
      return;
    }
    this.events.begin([{ at: this.wall(from), ev: { lane: 'mouth', kind: 'hold' } }, { at: this.wall(to), ev: { lane: 'mouth', kind: 'release', how: 'vad' } }]);
    this.ducked = false;
    this.interrupt();
    const body = { ...this.ctxBody };
    // draft 先占上(turn 里交给脑是同步起步的,停一下接着说的要并得进来)
    this.draft = { seq: this.turnSeq + 1, texts: [said] };
    this.turn(this.d.asked && !opensThread(body) ? 'answer' : 'voice', body, said, cue);
  }

  /** 孩子那句转写失败:按住说的照转写是空的办;一直听时不到 1 秒的放过,长的嘴说没听清 */
  private kidFailed(): void {
    if (!this.mouthOpen) { this.heard(''); return; }
    const long = (this.vadAwait ?? this.ms()) - this.vadFrom >= 1000;
    this.verdict(null, 'failed');
    if (long && !this.said && this.session) this.ask({ kind: 'catch' }, catchCue('empty')!);
  }

  /** 等嘴接住(最多 CATCH_WAIT_MS),交给脑;脑在忙就排着,它写完合并发 */
  private async toBrain(seq: number, body: Record<string, unknown>): Promise<void> {
    const until = Date.now() + CATCH_WAIT_MS;
    while (!this.caughtDone && Date.now() < until && !this.ended && seq === this.turnSeq) await new Promise((r) => setTimeout(r, 20));
    // 一直听:嘴不先说了,先留一小会儿看孩子是不是停一下又开口(原来接住那句正好留出这段)
    const peek = Date.now() + OPEN_PEEK_MS;
    while (this.mouthOpen && this.draft?.seq === seq && !this.vadOn && this.vadAwait === null && Date.now() < peek && !this.ended && seq === this.turnSeq) await new Promise((r) => setTimeout(r, 20));
    // 一直听:孩子停一下又开口了(或刚说完在等转写),等这一句判完,收下的并进来(probe-live-vad:句与句之间常常只隔 0–300 毫秒)
    const more = Date.now() + MERGE_WAIT_MS;
    while (this.draft?.seq === seq && (this.vadOn || this.vadAwait !== null) && Date.now() < more && !this.ended && seq === this.turnSeq) await new Promise((r) => setTimeout(r, 20));
    if (this.ended || seq !== this.turnSeq) return;
    if (this.draft?.seq === seq) { body = { ...body, text: this.draft.texts.join(',') }; this.draft = null; }
    // 板上报来的事先记完(窗里的图、落的笔),这一轮的 board: 才看得到
    await this.boards;
    if (this.ended || seq !== this.turnSeq) return;
    await this.turns.submit(body);
  }

  /**
   * 这一轮实时的那些(收下了才算,交给脑时带):请他说的那几拍一直带着,应用起的这一轮说明为什么;
   * 上一轮念到第几句被打断,带了就清
   */
  private liveOf(body: Record<string, unknown>): NonNullable<ContextPack['live']> {
    const { app } = body;
    const cut = this.d.takeCut();
    return {
      ...(this.caught ? { caught: this.caught } : {}),
      ...(cut !== undefined ? { cut } : {}),
      ...(this.warm.length ? { echo: echoLines(this.warm) } : {}),
      ...(this.mouthLog.length ? { mouth: this.mouthLog.splice(0) } : {}),
      ...(app === 'quiet' || app === 'still' || app === 'pen' ? { app: app as 'quiet' | 'still' | 'pen' } : {}),
    };
  }

  /** 请他说那句在孩子端放完的时刻(通话毫秒)知道了:从那时起等 ECHO_WAIT_MS */
  private armEcho(endAt: number): void {
    const e = this.echoing;
    if (!e || e.endAt !== null) return;
    e.endAt = endAt;
    e.timer = setTimeout(() => this.echoDue(), Math.max(0, endAt - this.ms()) + (this.deps.echoWaitMs ?? ECHO_WAIT_MS));
  }

  /** 请他说等够了:孩子正在说(或说完了在等转写、按着)就等它判完;没开口记一笔,接着下一拍;连着 QUIET_BEATS 拍没开口停下交脑 */
  private echoDue(): void {
    const e = this.echoing;
    if (!e || this.ended) return;
    e.timer = null;
    if (this.vadOn || this.vadAwait !== null || this.holding || this.echoHeld) { e.overdue = true; return; }
    this.noteEcho('silent');
    // 连着两拍没开口;或请他说的是最后一句(后面没有可念的了,不交脑他就对着不出声的老师)
    if (this.quietBeats >= QUIET_BEATS || this.echoLast()) {
      this.interrupt();
      this.d.note({ e: 'release' });
      this.quietBeats = 0;
      this.appTurn('(没出声)', 'quiet');
      return;
    }
    this.echoed();
  }

  /** 请他说记一拍(摸底;录像里一条 {t:'echo'},只记不发) */
  private noteEcho(outcome: 'said' | 'silent' | 'talk', text?: string): void {
    const e = this.echoing;
    if (!e) return;
    const startMs = e.heardAt !== null && e.endAt !== null ? Math.max(0, e.heardAt - e.endAt) : undefined;
    const beat: EchoBeat = { word: e.echo.word, say: e.echo.say === true, outcome, ...(text !== undefined ? { text } : {}), ...(startMs !== undefined && outcome !== 'silent' ? { startMs } : {}), ...(text !== undefined && e.echo.word ? { hit: coverage(e.echo.word, text) } : {}) };
    this.warm.push(beat);
    this.quietBeats = outcome === 'silent' ? this.quietBeats + 1 : 0;
    this.rec.out({ t: 'echo', ...beat });
  }

  /**
   * 请他说的那句是这一轮的最后一句(脑写完了、后面没排着的):他说了也没有下一拍可念,这句交给老师(照对老师说的办),
   * 不然开了闸什么都不念,他对着不出声的老师
   */
  private echoLast(): boolean {
    return !this.turns.busy && this.d.pending === 0;
  }

  /** 嘴先答这一回接不接:这节课是嘴先答的,在等他说的是这一轮最后一句(请他说的范围就是那一句) */
  private replyTakes(): boolean {
    return this.reply && this.echoing !== null && this.echoLast();
  }

  /**
   * 嘴先答:他答了最后那句请他说的(像在说那一句)。说中了(那一句的词、字说出一半以上):嘴接一句(当这一轮的接住),交脑往下走;
   * 没说中、还没到 REPLY_MISSES 次:嘴在范围里提示一下,提示完接着等他(不交脑);到了就交脑(嘴不先说,脑看 live.mouth)
   */
  private replyTo(text: string): { to: 'mouth' } | { to: 'brain'; cue?: string } {
    const e = this.echoing!;
    const scope = { ask: e.ask, want: e.echo.word, heard: text, img: this.shotGiven !== null };
    if (coverage(e.echo.word, text) >= 0.5) { this.replyMiss = 0; return { to: 'brain', cue: replyCue('hit', scope) }; }
    this.mouthLog.push(`孩子:${text}`);
    if (this.replyMiss >= REPLY_MISSES) { this.replyMiss = 0; return { to: 'brain' }; }
    this.replyMiss++;
    this.lastActive = Date.now();
    this.replyArm = { echo: e.echo, ask: e.ask };
    if (e.timer) clearTimeout(e.timer);
    this.echoing = null;
    this.resume();
    const go = (): void => this.ask({ kind: 'reply' }, replyCue('miss', scope));
    if (this.said) this.afterDone = go; else go();
    return { to: 'mouth' };
  }

  /** 嘴先答提示完了(或被掐、断了):从 endAt(孩子端放完的时刻)起接着等他说那一句 */
  private rearmReply(endAt: number): void {
    const a = this.replyArm;
    this.replyArm = null;
    if (!a || this.ended) return;
    this.echoing = { ...a, endAt: null, heardAt: null, timer: null, overdue: false };
    this.armEcho(endAt);
  }

  /** 嘴先答:孩子眼前那块最新的图(舞台交的窗图)放进嘴这一段的输入;这条连接里已经有这张就不再放。回嘴看不看得到那张 */
  private giveShot(): boolean {
    const s = this.session, j = this.shotJpeg;
    if (!s || !j) return false;
    if (j === this.shotGiven) return true;
    if (!s.appendImage(j)) { this.rec.out({ t: 'mouth-img', skipped: true }); return false; }
    this.shotGiven = j;
    this.mouthImages++;
    this.rec.out({ t: 'mouth-img' });
    return true;
  }

  /** 请他说这拍过了:开闸,下一拍接着念;压低的恢复 */
  private echoed(): void {
    if (this.echoing?.timer) clearTimeout(this.echoing.timer);
    this.echoing = null;
    this.d.step({ e: 'echoed' });
    this.resume();
  }

  /** 请他说里按住说的那一下转写回来了:空的接着等;像跟读开闸;对老师说的同松手(打断、接住、交给脑) */
  private echoHeard(text: string): void {
    const body = this.echoHeld ?? {};
    this.echoHeld = null;
    if (!this.echoing) return;
    if (!text.trim()) { if (this.echoing.overdue) this.echoDue(); return; }
    const kind = echoKind(text, this.echoing.echo.word);
    this.noteEcho(kind, text);
    if (kind === 'said' && !this.echoLast()) { this.echoed(); return; }
    this.send({ t: 'kid', text });
    let cue: string | undefined;
    if (kind === 'said' && this.replyTakes()) {
      const r = this.replyTo(text);
      if (r.to === 'mouth') return;
      cue = r.cue;
    }
    this.interrupt();
    this.turn(this.d.asked && !opensThread(body) ? 'answer' : 'voice', body, text, cue);
  }

  /** 应用起的一轮(不是孩子说的):嘴不出声,接在这次通话的话题后面交给脑 */
  private appTurn(text: string, app: 'quiet' | 'still', thread: string | null = this.turns.thread): void {
    const seq = ++this.turnSeq;
    this.penStep({ e: 'turn' });
    this.caught = '';
    this.caughtDone = true;
    this.pendingVoice = null;
    this.draft = null;
    const body: Record<string, unknown> = { text, app, ...(thread ? { thread } : {}), ...(this.ctxBody.device ? { device: this.ctxBody.device } : {}) };
    void this.toBrain(seq, body);
  }

  /**
   * 孩子在页上点了一个字(孩子端已经弹了田字格)。验过记进板的日志;安静时嘴照念它的念法,
   * 嘴正在念上一个字就掐掉换这个;老师在说(照念讲稿、接住、脑在写、孩子在说)不念。之后等 STILL_MS 看他开不开口
   */
  private async board(body: unknown, seq: number): Promise<void> {
    const { ctx, tutor } = this.deps;
    const b = isObj(body) ? body : {};
    // 窗停下来以后舞台交的图:嘴先答时交给嘴的就是它(只留最新一张;落盘、附给脑照旧在 runner)
    if (b.k === 'shot') { const j = jpegOf(b.image); if (j) this.shotJpeg = j; }
    // 笔落在页上:等着替他交的那次取消(写字不打断老师,不进板的日志)
    if (b.k === 'pen') { this.lastActive = Date.now(); this.penStep({ e: 'down', at: Date.now() }); return; }
    const r = await ctx.runner.boardEvent(tutor, localDate(ctx.now()), body).catch(() => null);
    if (!r || this.ended || r.shot) return;
    // 抬笔(这一笔收下了):停一会儿没再落笔就替他交给老师
    // 这一笔报来以后孩子已经开口、开了一轮(seq 是报来那一刻的):这一笔随那一轮走了,不再等
    if (b.k === 'stroke' && seq === this.turnSeq) { this.penThread = r.thread; this.penStep({ e: 'up', at: Date.now(), strip: typeof b.strip === 'string' }); }
    this.lastActive = Date.now();
    // 课本上挪窗、放大(view):他在自己读,不替他叫老师,先前点字起的那一下也取消
    if (r.still === false) { if (this.stillTimer) clearTimeout(this.stillTimer); this.stillTimer = null; } else this.stillArm(r.thread);
    if (!r.say) return;
    const say = r.say;
    const s = this.session;
    if (!s?.isReady || this.echoing || this.holding || this.vadOn) return;
    const mine = this.said?.kind === 'say' || (!this.said && this.sayingPick);
    if (!mine && (!this.quiet() || this.playing())) return;
    const go = (): void => this.ask({ kind: 'say' }, readCue([say]));
    if (!mine) { go(); return; }
    // 上一个字还在念:掐掉,出完(被掐)再念这个
    if (this.said) {
      this.afterDone = go;
      if (s.responding) s.cancel(); else this.cancelOnCreate = true;
    }
    if (this.playing()) { this.d.flush(); this.send({ t: 'flush' }); }
    if (!this.said) go();
  }

  /** 收笔的秒数:测试给的,不然照 cotutor.json 的 live.pen */
  private penTimes(): PenTimes {
    const cfg = this.deps.ctx.runner.ws.config.live.pen;
    return { blankMs: this.deps.pen?.blankMs ?? cfg.blankMs, stripMs: this.deps.pen?.stripMs ?? cfg.stripMs, retryMs: this.deps.pen?.retryMs ?? 1000 };
  }

  /** 收笔的一件事(./pen.ts 的 turnStep):照它起、停计时;到点交一轮(嘴先说「我看看你写的」,带着窗里的图) */
  private penStep(ev: PenEvent): void {
    const r = turnStep(this.pen, ev, this.penTimes());
    this.pen = r.s;
    for (const d of r.do) {
      if (d.k === 'cancel' || d.k === 'arm') { if (this.penTimer) clearTimeout(this.penTimer); this.penTimer = null; }
      if (d.k === 'arm') this.penTimer = setTimeout(() => { this.penTimer = null; this.penStep({ e: 'due', at: Date.now(), busy: !this.quiet() || this.playing() || Boolean(this.pendingVoice || this.draft || this.echoing || this.holding || this.vadOn) }); }, Math.max(0, d.at - Date.now()));
      if (d.k === 'send' && !this.ended) {
        // 写完了也算他动了手:替他叫老师的那次(still)不用了
        if (this.stillTimer) clearTimeout(this.stillTimer);
        this.stillTimer = null;
        const text = '(孩子在页上写完了,停了笔)';
        this.turn('pen', { text, app: 'pen', ...(this.penThread ?? this.turns.thread ? { thread: this.penThread ?? this.turns.thread } : {}), ...(this.ctxBody.device ? { device: this.ctxBody.device } : {}) }, text);
      }
    }
  }

  /** 板上点完字:STILL_MS 后看他动没动;这一回已经替他叫过就不再叫 */
  private stillArm(thread: string): void {
    if (this.stillTimer) clearTimeout(this.stillTimer);
    this.stillTimer = null;
    if (this.stillUsed) return;
    this.stillTimer = setTimeout(() => this.stillDue(thread), this.deps.stillMs ?? STILL_MS);
  }

  /** 孩子自己开口、发了东西:等的作废,下回点完了还能替他叫 */
  private stillReset(): void {
    if (this.stillTimer) clearTimeout(this.stillTimer);
    this.stillTimer = null;
    this.stillUsed = false;
  }

  /** 等够了:老师还在说、孩子在说就再等一回;不然替他叫一次老师(嘴不出声,脑那一轮带 app: still 和他做了什么) */
  private stillDue(thread: string): void {
    this.stillTimer = null;
    if (this.ended || this.stillUsed) return;
    if (!this.quiet() || this.playing() || this.pendingVoice || this.draft || this.echoing) { this.stillArm(thread); return; }
    this.stillUsed = true;
    const { ctx, tutor } = this.deps;
    void ctx.runner.boardStill(tutor, localDate(ctx.now()), thread);
    this.appTurn('(孩子在板上做完了,没出声)', 'still', thread);
  }

  /** 孩子端的一块声音:按着才推,一直听时一直推;嘴在现连时按着说的先攒着(最多一分钟),一直听的只留最近 10 秒 */
  onAudio(pcm: Buffer): void {
    if (this.ended) return;
    if (this.open) this.lastAudioAt = Date.now();
    if (!this.session) {
      if (this.open && this.opened) {
        this.rec.kid(pcm);
        this.backlog.push({ pcm });
        this.backlogBytes += pcm.length;
        while (this.backlogBytes > MAX_OPEN_BACKLOG_BYTES) {
          const i = this.backlog.findIndex((x) => 'pcm' in x);
          if (i < 0) break;
          this.backlogBytes -= (this.backlog[i] as { pcm: Buffer }).pcm.length;
          this.backlog.splice(i, 1);
        }
        void this.revive();
        return;
      }
      if (this.backlogHolding && this.backlogBytes + pcm.length <= MAX_BACKLOG_BYTES) { this.rec.kid(pcm); this.backlog.push({ pcm }); this.backlogBytes += pcm.length; }
      return;
    }
    if (!(this.holding || this.mouthOpen) || !this.session.isReady) return;
    this.rec.kid(pcm);
    this.pushAudio(pcm);
  }

  private pushAudio(pcm: Buffer): void {
    if (!(this.holding || this.mouthOpen) || !this.session?.isReady) return;
    if (this.holding) this.heldBytes += pcm.length;
    this.session.appendAudio(pcm);
  }

  /** 收:关嘴、落录像、告诉孩子端 */
  async end(why: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    this.d.stop();
    if (this.echoing?.timer) clearTimeout(this.echoing.timer);
    if (this.stillTimer) clearTimeout(this.stillTimer);
    if (this.penTimer) clearTimeout(this.penTimer);
    this.offEvents?.();
    const s = this.session;
    this.session = null;
    s?.close('end');
    this.send({ t: 'end', why });
    // 字幕重放:挂的时候嘴还在出的那段,出了的那截也落;等这几轮都落完
    if (this.said?.kind === 'read') this.mouthEnd(this.said, false);
    await this.takes.flush();
    this.saveTake(this.rec.finish());
    await this.saving;
    this.sock.close(1000, why);
    this.deps.onFinished?.(why);
  }

  /** 孩子端断了 */
  onSocketClose(): void { if (!this.ended) void this.end('kid-gone'); }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** 一段录像的文件名:开始的时分秒;这一秒已经有一段了(同一位老师两次通话、切段撞在同一秒)往后挪一秒,不盖掉 */
const takeName = (dir: string, at: Date): string => {
  const hms = (d: Date): string => [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join('');
  let name = hms(at);
  for (let k = 1; k < 60 && existsSync(join(dir, `${name}.reel.json`)); k++) name = hms(new Date(at.getTime() + k * 1000));
  return name;
};
/** 这一条开新话题(首页的按钮):不算答上一轮的问 */
const opensThread = (body: Record<string, unknown>): boolean => isObj(body.via);
/** 舞台交来的图(data:image/jpeg;base64,…)→ 字节;不是 jpeg、太大(百炼一帧上限)回 null */
const jpegOf = (v: unknown): Buffer | null => {
  const m = typeof v === 'string' ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(v) : null;
  return m && m[1].length <= MAX_IMAGE_B64 ? Buffer.from(m[1], 'base64') : null;
};
/** 这一条带着交的东西(「给老师看」):没说清也要交给脑 */
const handsIn = (body: Record<string, unknown>): boolean => body.action === 'submit';
/** 录像里记的那条:去掉图,留一个 image: true */
const withoutImages = (m: Record<string, unknown>): Record<string, unknown> => {
  if (typeof m.image === 'string') return { ...m, image: true };
  if (isObj(m.body) && typeof m.body.image === 'string') return { ...m, body: { ...m.body, image: true } };
  return m;
};
/** 孩子这边的动作(嘴断了要攒着补的那几种) */
const INPUTS = new Set(['hold', 'release', 'hush', 'send', 'staged']);

