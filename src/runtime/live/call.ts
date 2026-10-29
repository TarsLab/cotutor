/**
 * 实时老师的一次通话:孩子端的 WebSocket ↔ 嘴(百炼 realtime,手动轮次)+ 脑(老师 CLI,Runner)。
 * 一轮:孩子按住说 → 松手(嘴不接话,拍照才先说一句「我看一看图片」,src/realtime/cues.ts)→ 孩子那句的转写交给脑(实时轮:讲稿不配音)→ 脑的讲稿定稿一句交一句,
 * 嘴一空就把排着的几句一起交给它照念(src/runtime/delivery/queue.ts,流水线:嘴出完上一段就交下一段,声音在孩子端接着排)→ 讲完就停。
 * 按句不按拍(2026-10-19):卡宁缺毋滥以后一节常常只有一拍、甚至没卡,按拍要等脑整段写完才念;卡只管自己闭合了就铺,和念哪句不挂钩。
 * 转写是空的(按了没说清):嘴在说就掐掉,改说「没听清」,不交给脑;按着时声音不到 100 毫秒(不 commit)、commit 没收下也一样。孩子在嘴的声音还在放时按下 = 打断:掐掉、孩子端清播放队列,
 * 没念的拍丢掉,孩子听到第几句(src/runtime/delivery/playback.ts 按声音排到哪算)进下一轮的上下文包 live:。嘴只接住、只照念,不讲新内容(2026-10-19 P1);画板开着时例外(边画边聊,见下)。
 *
 * 孩子端 → 这里:二进制帧 = PCM16 16k 单声道一块(按着时才推);文本帧 = JSON
 *   {t:'hold'} 按下 · {t:'release', body} 松手(body 同 POST /api/kid/conversations/<老师>/messages 少 text:thread / newThread / device…)
 *   {t:'hush'} 停下不开新一轮(上滑取消):嘴在出就掐、孩子端清了、没念的丢掉
 *   {t:'send', body} 不是说的(打字、拍照、交卡、首页按钮;舞台开着带 focus.card):body 同那条 POST · {t:'view', w, h} 屏幕多大 · {t:'bye'}
 *   {t:'staged'} 讲稿 [[play]] 的小课堂那一段放完了(或放不了、被关):后面的讲稿接着交给嘴
 *   边画边聊:画板开着时按头像说的,松手带 chat {canvas, image, ask}——只给嘴(图跟着声音进对话、嘴接住),不起脑;
 *   {t:'chat', canvas, image, ask} 孩子端觉得该说一句了(换了颜色、停笔很久,src/board/canvas-chat.ts):安静时 0.5 秒静音 + 图交给嘴、嘴主动说一句,回 {t:'chat', canvas, said};不安静回 {t:'chat', canvas, skipped}。
 *   这张画上孩子说的、嘴说的记下来,交画那一轮(交画板卡 / 纸上的 drawing)带给脑(live.draw)
 * 这里 → 孩子端:二进制帧 = PCM16 24k 嘴的声音;文本帧 = JSON
 *   {t:'ready'} 嘴连上了 · {t:'down', why} 连不上(孩子端回到「正在叫老师」,过一会儿重连)· {t:'kid', text} 孩子那句的转写 · {t:'tutor', of, delta} / {t:'tutor', of, done} 嘴的字(of:catch 接住 / read 照念)
 *   {t:'turn', job, thread} 脑开始写这一轮 · {t:'read', job, line, text, play?} 讲稿这一句开始放(play = 念完放小课堂那一段;一句一个,按孩子端放到的时刻发:一段里第一句在段首,
 *   后面几句等这段的声音出齐、按字数比例摊)· {t:'flush'} 清播放队列
 *   {t:'state', speaking, holding} · {t:'err', status, error} 发不出去(400 / 409 …)· {t:'end', why}
 * 嘴的会话断了(百炼 300 秒没输入就关,2026-10-20 照 Qwen-Live-Harness 的换连接):电话不挂、孩子端不知道;下次按下或发来时现连,
 *   连上之前来的照序攒着补(录像里记一条 {t:'lost'},只记不发)。平时孩子没按着就 30 秒一次心跳,最后一次动静 15 分钟后停跳。
 * 换连接:嘴的历史越长每次回答越贵,输入过了 SWAP_TOKENS 就在安静时换一条新的(录像里记 {t:'swap'},只记不发)。
 * 一直听(孩子端只在口语课、或 live.listen 是 open 时连接带 ?listen=open,中途发 {t:'listen', open} 也能换):孩子端一直推声音(卡的声音、录音、小课堂、关麦时不推,{t:'gate', on} 告诉这里),
 *   嘴的会话开 VAD(live.vad 缺省 server_vad、live.silenceMs),create_response / interrupt_response 关着:开口(speech_started)先暂停照念、嘴在放就让孩子端压低({t:'duck'}),
 *   转写回来 src/realtime/listen.ts 判收下 / 放过——收下才算按下 + 松手(打断、接住、交给脑;交给脑之前孩子停一下又开口的并成一句),放过的恢复音量接着念({t:'skip', why} / {t:'unduck'})。
 *   孩子那一句的上下文(话题、设备、舞台上的卡)孩子端开口时报一次 {t:'ctx', body}。换模式 = 安静时换一条连接(silence 只有新连接能给)。
 *   commit 了不回答 300 秒百炼就关(response_idle_timeout,探针 probe-live-vad):放过的多了,离上次回答 IDLE_SWAP_MS 就在安静时换连接。
 * 口语课:先热身、再打电话。热身是脑一轮写完的跟读,讲稿的 [[echo 词]] / [[say 词]] 那句念完关闸(src/runtime/delivery/queue.ts),
 *   孩子说完(像跟读,src/scenes/talk/warmup.ts)开闸下一拍,不接住、不交脑;对老师说的照收下办(打断、接住、交脑);ECHO_WAIT_MS 没开口接着走,连着两拍没开口停下交脑(app: quiet)。
 *   每拍记进摸底(录像 {t:'echo'},只记不发),交脑时带上(live.warmup)。[[call]] 那句念完孩子端响铃,这里马上交脑一轮(app: call,不接住),
 *   之后的接住换英文(cue.ts 的 CATCH_EN),交脑带打电话几分钟(live.phone)。孩子端连上发来的第一条带 talk(口语单)时嘴先说「好,我们先热热身!」。
 * 录像:进出的消息、两边的声音都记(CallRecorder),挂了落在 conversations/<老师>/<日期>.live/<时分秒>.reel.json / .wav。
 * 字幕重放:嘴照念的声音按轮另留一份,出了的都留(孩子按下时清掉、没放出来的也在),
 *   一段出完(或被掐、断了)就落 <日期>.<job>.mouth.wav 与每句的起点 .mouth.json(src/runtime/journal/mouth-index.ts);接住那句不在里面。孩子端从 /api/kid/conversations/<老师>/mouth/<日期>/<job> 取。
 * 事件:嘴这一道(mouth:按下、松手 / 发了、接住开始放、第几句开始放、打断)补进那一轮的 events.jsonl(Runner.noteEvent),工作台的时间线上看;
 * 按下、松手、接住在脑起来之前,先攒着,等那一轮的老师进程起来(main:start)再按它的起点换成相对毫秒(负的)。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Runner } from '../runner.ts';
import { localDate } from '../../shared/time.ts';
import { catchCue, chatCue, readCue, type CatchKind, type ChatAsk } from '../../realtime/cues.ts';
import { judge } from '../../realtime/listen.ts';
import { echoKind, warmLines, type WarmBeat } from '../../scenes/talk/warmup.ts';
import { coverage } from '../../scenes/talk/en-words.ts';
import type { Beat, Echo } from '../delivery/queue.ts';
import { Delivery, type Said } from '../delivery/delivery.ts';
import { MIX_RATE } from '../journal/mix.ts';
import { wavOfPcm } from '../../shared/wav.ts';
import { mouthInstructions } from '../../realtime/prompt.ts';
import { mouthVoice, type ContextPack } from '../../schema/index.ts';
import { INPUT_RATE, MAX_IMAGE_B64, OUTPUT_RATE, RealtimeSession } from '../../realtime/bailian.ts';
import { CallRecorder } from '../journal/recorder.ts';
import { MouthEvents, MouthTakes, type MouthEvent } from '../journal/mouth.ts';
import { Turns } from './turns.ts';

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
  /** 测试:热身那句念完等孩子多久、打电话先响多久的铃 */
  echoWaitMs?: number;
  ringMs?: number;
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
/** 嘴最近一次回答的输入过了这么多 token,安静时换一条新连接(约 9 轮一换) */
const SWAP_TOKENS = 3000;
/** 讲稿的 [[play]]:孩子端放小课堂那一段,最多等它这么久就接着念(孩子端没回 staged 时不卡死) */
const GATE_MS = 180_000;
/** 现连时攒着的声音最多一分钟(同 Qwen-Live-Harness 的 MAX_RECOVERY_AUDIO_BYTES);一直听时只留最近 10 秒(更早的孩子早不等了) */
const MAX_BACKLOG_BYTES = INPUT_RATE * 2 * 60;
const MAX_OPEN_BACKLOG_BYTES = INPUT_RATE * 2 * 10;
/** 一直听:收下一句以后,孩子停一下又开口(或刚说完在等转写),交给脑最多再等这么久,收下的并进来 */
const MERGE_WAIT_MS = 8000;
/** 一直听:一句收下以后先等这么久,看孩子是不是又开口(没有接住那句垫着了) */
const OPEN_PEEK_MS = 800;
/** 一直听:commit 了没回答,离上次回答这么久就在安静时换连接(百炼 300 秒报 response_idle_timeout) */
const IDLE_SWAP_MS = 240_000;
/** 热身:[[echo]] / [[say]] 那句在孩子端放完,这么久没开口就接着下一拍(不催);连着这么多拍没开口就停下交脑 */
const ECHO_WAIT_MS = 8000;
const QUIET_BEATS = 2;
/** 打电话:[[call]] 那句放完先响这么久的铃,脑的英文开场来得再早也等它(孩子听得到在打电话) */
const RING_MS = 3000;

/** 字幕重放的声音最多留几轮在内存里(一轮约 1–2 MB;落了盘就只为接着往后接) */
const MOUTH_KEEP = 3;

/** 嘴主动说一句前垫的静音(百炼要先有声音再有图,commit 时一起进对话):0.5 秒 */
const CHAT_SILENCE = Buffer.alloc((INPUT_RATE * 2) / 2);
/** 静音那段的转写(空的)多久之内来算它的;过了就不吞了,免得吞掉孩子后来说的 */
const CHAT_QUIET_MS = 5000;
/** 一张画上边画边说最多记几句给脑 */
const DRAW_TALK_MAX = 24;



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
  /** 热身:交给嘴的那段最后一句要孩子跟。endAt = 那句在孩子端放完的通话毫秒(嘴出完才知道);heardAt = 孩子开口的通话毫秒;overdue = 等够了时孩子正在说 */
  private echoing: { echo: Echo; endAt: number | null; heardAt: number | null; timer: NodeJS.Timeout | null; overdue: boolean } | null = null;
  /** 热身:按住说时松手了、在等这一下的转写(跟读还是对老师说的);那一下松手的 body */
  private echoHeld: Record<string, unknown> | null = null;
  /** 热身每拍记的(摸底)、连着没开口的拍数 */
  private warm: WarmBeat[] = [];
  private quietBeats = 0;
  /** 打电话从哪一刻起(墙钟,[[call]] 那句在孩子端放完、开始响铃);null = 还没打 */
  private phoneAt: number | null = null;
  /** 边画边聊:每张画(画板卡 <job>/<n>,纸 paper)上孩子说的、嘴说的,一句一行;交画那轮给脑后清掉 */
  private readonly drawTalk = new Map<string, string[]>();
  /** 边画边聊:按着头像说的那句在等转写(记到哪张画上) */
  private chatHeard: string | null = null;
  private chatHeardUntil = 0;
  /** 嘴主动说那几次垫的静音:几段转写还没回来、等到什么时候(空的转写吞掉,不说没听清) */
  private chatQuiet = 0;
  private chatQuietUntil = 0;
  private offEvents: (() => void) | null = null;
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
        // 字幕重放:这一轮的声音从这里接
        this.takes.open(st.job, st.date);
        this.send({ t: 'turn', job: st.job, thread: st.thread });
      },
      lines: (job, lines) => { if (this.d.job === job) this.d.lines(lines); },
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

  /** 排队说这一拍该交给嘴了:要嘴照念;热身那句念完要等孩子跟 */
  private read(beat: Beat): void {
    if (beat.echo) this.echoing = { echo: beat.echo, endAt: null, heardAt: null, timer: null, overdue: false };
    this.ask({ kind: 'read', beat }, readCue(beat.texts));
    // 这段最后一句念完孩子端放小课堂那一段:排队关着闸,等 staged;孩子端一直没回也别卡死
    if (beat.play) this.timers.push(setTimeout(() => { if (!this.ended && this.d.gated) this.d.step({ e: 'staged' }); }, GATE_MS));
  }

  /** 让嘴说一次;接住要先告诉排队,嘴出完之前别交讲稿 */
  private ask(said: Said, instructions: string): void {
    this.said = said;
    if (said.kind !== 'read') this.d.note({ e: 'asked' });
    this.session?.createResponse(instructions);
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
      if (e.event.lane === 'main' && e.event.kind === 'line') this.d.lines([{ i: e.event.line, text: e.event.text, play: e.event.play === true, echo: e.event.echo, call: e.event.call }]);
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
        const kind = this.said?.kind ?? 'catch';
        // 垫的那句在孩子端同接住的字一样上字幕
        const of = kind === 'read' ? 'read' : 'catch';
        if (done !== null) {
          if (done.trim()) this.saidLog = [...this.saidLog.slice(-5), { text: done.trim(), at: Date.now() }];
          if (this.said?.kind === 'chat' && done.trim()) this.noteDraw(this.said.canvas, `你:${done.trim()}`);
          if (kind === 'catch') { this.caught = done.trim(); this.caughtDone = true; this.events.caught(this.caught); }
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
          // 热身那句出齐了:知道它在孩子端什么时候放完,从那时起等孩子;[[call]] 那句出齐了:开始打电话
          if (this.said.beat.echo) this.armEcho(this.d.end);
          if (this.said.beat.call) this.startPhone();
        }
        // 比回声按这段在孩子端放完的时刻算(字早就出完了,声音要放十几秒)
        const last = this.saidLog[this.saidLog.length - 1];
        if (last && status !== 'cancelled') last.at = Math.max(last.at, this.wall(this.d.end));
        this.lastResponseAt = Date.now();
        this.committedSince = false;
        if (this.said?.kind === 'catch') this.caughtDone = true;
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
    if (why === null) this.mounted(s, open);
    return why;
  }

  /** 换上一条嘴的会话:一直听的状态都从头来 */
  private mounted(s: RealtimeSession, open: boolean): void {
    this.session = s;
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
    const why = this.open !== this.mouthOpen ? 'listen' : this.lastInput >= (this.deps.swapTokens ?? SWAP_TOKENS) ? 'tokens' : this.mouthOpen && this.committedSince && Date.now() - this.lastResponseAt > (this.deps.idleSwapMs ?? IDLE_SWAP_MS) ? 'idle' : null;
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
    if (this.said) { this.said = null; this.afterDone = null; this.cancelOnCreate = false; this.d.idle(); }
    // 热身那句没出齐就断了:从现在起等孩子,别卡死
    if (this.echoing && this.echoing.endAt === null) this.armEcho(this.ms());
    // 按着时断的:推过去的声音跟着那条会话没了,松手就说没听清
    this.heldBytes = 0;
    // 边画边聊在等的转写跟着那条会话没了
    this.chatHeard = null;
    this.chatQuiet = 0;
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
    // 热身不等了(排着的那几拍跟着丢了;摸底留着)
    if (this.echoing?.timer) clearTimeout(this.echoing.timer);
    this.echoing = null;
    this.echoHeld = null;
    this.afterDone = null;
    if (this.session?.responding) this.session.cancel();
    else if (this.said) this.cancelOnCreate = true;
    if (playing) { this.d.flush(now); this.send({ t: 'flush' }); }
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
        this.heldBytes = 0;
        this.session.clearAudio();
        // 热身在等孩子跟:按下就是在跟,不打断(排着的几拍留着);那句的声音还没放完就清掉
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
        // 边画边聊:画板开着时按头像说的只给嘴;图跟着这段声音进对话,嘴接住,不起脑
        const chat = isObj(m.chat) && typeof m.chat.canvas === 'string' && m.chat.canvas ? m.chat : null;
        if (chat && !this.echoing && !this.mouthOpen) { this.chatRelease(chat); break; }
        this.events.record(null, at, { lane: 'mouth', kind: 'release', how: 'voice' });
        // 热身在等孩子跟:等转写回来再判是跟读还是对老师说的(heard)
        if (this.echoing) {
          if (this.heldBytes < MIN_COMMIT_BYTES) { this.session.clearAudio(); this.echoHeard(''); break; }
          this.session.commit();
          this.echoHeld = body;
          this.state();
          break;
        }
        if (this.heldBytes < MIN_COMMIT_BYTES) {
          this.session.clearAudio();
          // 按住「给老师看」没说出话:照交画(画板卡已经锁了、纸上的图传好了),嘴不先说
          if (handsIn(body)) { this.turn('card', body, ''); break; }
          this.send({ t: 'kid', text: '' });
          this.turn('empty', body);
          break;
        }
        this.session.commit();
        this.turn(this.d.asked && body.newThread !== true ? 'answer' : 'voice', body);
        break;
      }
      case 'hush': {
        if (!this.session) return;
        if (this.holding) { this.holding = false; this.session.clearAudio(); }
        this.interrupt();
        this.d.note({ e: 'release' });
        this.state();
        break;
      }
      case 'send': {
        if (!this.session || !isObj(m.body)) return;
        const body = m.body;
        // 纸上交的画同交卡:嘴不先说
        const kind: CatchKind = body.action === 'submit' || isObj(body.drawing) ? 'card' : Array.isArray(body.photos) && body.photos.length ? 'photo' : isObj(body.talk) ? 'warm' : isObj(body.via) ? 'start' : 'text';
        this.interrupt();
        this.events.begin([{ at, ev: { lane: 'mouth', kind: 'release', how: kind === 'card' || kind === 'photo' ? kind : 'text' } }]);
        const text = typeof body.text === 'string' ? body.text : '';
        this.turn(kind, body, text);
        break;
      }
      // 孩子端放完了小课堂那一段(或放不了、被关):后面的讲稿接着交给嘴
      case 'staged': this.d.step({ e: 'staged' }); break;
      // 边画边聊:孩子端觉得该说一句了
      case 'chat': this.chatLook(m); break;
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
   * 一轮开始:多半嘴不出声,等脑的第一句(孩子端左栏头像在想);拍照、热身这几种才先说一句(src/realtime/cues.ts;上一次回答被掐了还没回 done 就等它回了再说)。
   * 说的等转写回来再交给脑,不是说的直接交
   */
  private turn(kind: CatchKind, body: Record<string, unknown>, text?: string): void {
    const seq = ++this.turnSeq;
    this.caught = '';
    this.d.note({ e: 'release' });
    // 按住说的等转写回来(heard);一直听的转写已经有了(text)
    this.pendingVoice = (kind === 'voice' || kind === 'answer') && text === undefined ? { seq, body } : null;
    const cue = catchCue(kind, this.lang());
    this.caughtDone = cue === null;
    if (cue !== null) {
      const go = (): void => this.ask({ kind: 'catch' }, cue);
      if (this.said) this.afterDone = go; else go();
    }
    if (text !== undefined) void this.toBrain(seq, { ...body, text });
  }

  /** 孩子那句的转写回来了:空的改说没听清、不交给脑;不空交给脑 */
  private heard(text: string): void {
    if (this.echoHeld) { this.echoHeard(text); return; }
    // 嘴主动说那次垫的静音:那段的转写(真百炼回空的;转写按 commit 的先后到)不是孩子说的
    if (this.chatQuiet > 0 && Date.now() < this.chatQuietUntil) { this.chatQuiet--; return; }
    if (this.chatHeard && Date.now() < this.chatHeardUntil) {
      const canvas = this.chatHeard;
      this.chatHeard = null;
      this.send({ t: 'kid', text });
      if (text.trim()) this.noteDraw(canvas, `孩子:${text.trim()}`);
      return;
    }
    this.send({ t: 'kid', text });
    const v = this.pendingVoice;
    this.pendingVoice = null;
    if (!v || v.seq !== this.turnSeq) return;
    if (text.trim()) { void this.toBrain(v.seq, { ...v.body, text }); return; }
    // 按住「给老师看」说的转写是空的:画照交,不说没听清
    if (handsIn(v.body)) { void this.toBrain(v.seq, { ...v.body, text: '' }); return; }
    const sorry = (): void => this.ask({ kind: 'catch' }, catchCue('empty', this.lang())!);
    if (!this.said) { sorry(); return; }
    // 接住还在要 / 在出:掐掉,出完(被掐)再说没听清
    this.afterDone = sorry;
    if (this.session?.responding) this.session.cancel(); else this.cancelOnCreate = true;
    if (this.playing()) { this.d.flush(); this.send({ t: 'flush' }); }
  }

  /** 边画边聊:这张画上记一句(孩子说的、嘴说的),交画那轮给脑 */
  private noteDraw(canvas: string, line: string): void {
    const lines = [...(this.drawTalk.get(canvas) ?? []), line];
    this.drawTalk.set(canvas, lines.slice(-DRAW_TALK_MAX));
  }

  /**
   * 边画边聊:画板开着时按着头像说完松手。声音太少照「没听清」;不然这一刻的画跟着这段声音 commit,嘴接住(看图、顺着他的话),不起脑。
   * 按下时攒的那几条嘴的事件不归哪一轮(没有这一轮),丢掉
   */
  private chatRelease(chat: Record<string, unknown>): void {
    const s = this.session!;
    const canvas = String(chat.canvas);
    this.events.begin([]);
    this.d.note({ e: 'release' });
    if (this.heldBytes < MIN_COMMIT_BYTES) {
      s.clearAudio();
      this.send({ t: 'kid', text: '' });
      const sorry = (): void => this.ask({ kind: 'catch' }, catchCue('empty', this.lang())!);
      if (this.said) this.afterDone = sorry; else sorry();
      this.state();
      return;
    }
    const img = jpegOf(chat.image);
    if (img) s.appendImage(img);
    s.commit();
    this.chatHeard = canvas;
    this.chatHeardUntil = Date.now() + 10_000;
    const go = (): void => this.ask({ kind: 'chat', canvas }, chatCue('reply', askOf(chat.ask), this.drawTalk.get(canvas) ?? []));
    if (this.said) this.afterDone = go; else go();
    this.state();
  }

  /**
   * 边画边聊:孩子端觉得该说一句了(src/board/canvas-chat.ts 的规矩)。只在安静时说(孩子没按着、嘴没在说也没要说、脑没在写、讲稿没排着),
   * 一直听、热身时不说;0.5 秒静音 + 这一刻的画 commit(百炼要先有声音再有图),嘴照应用给的题说一两句。说不了回 {t:'chat', skipped}
   */
  private chatLook(m: Record<string, unknown>): void {
    const s = this.session;
    const canvas = typeof m.canvas === 'string' ? m.canvas : '';
    const img = jpegOf(m.image);
    if (!s?.isReady || !canvas || !img || this.mouthOpen || this.echoing || !this.quiet()) { this.send({ t: 'chat', canvas, skipped: true }); return; }
    s.clearAudio();
    s.appendAudio(CHAT_SILENCE);
    if (!s.appendImage(img)) { s.clearAudio(); this.send({ t: 'chat', canvas, skipped: true }); return; }
    s.commit();
    this.chatQuiet++;
    this.chatQuietUntil = Date.now() + CHAT_QUIET_MS;
    this.lastActive = Date.now();
    this.ask({ kind: 'chat', canvas }, chatCue('look', askOf(m.ask), this.drawTalk.get(canvas) ?? []));
    this.send({ t: 'chat', canvas, said: true });
  }

  /** 一直听:VAD 判出孩子开口 / 说完。开口先暂停照念(不丢)、嘴在放就让孩子端压低;说完了等转写 */
  private speech(st: 'started' | 'stopped'): void {
    this.lastActive = Date.now();
    if (st === 'started') {
      this.vadOn = true;
      this.vadFrom = this.ms();
      if (this.echoing && this.echoing.heardAt === null) this.echoing.heardAt = this.vadFrom;
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
    // 热身在等孩子跟:「嗯」不算回答(那句是问句也一样);那句放完以后才开口的,字和嘴说的一样就是在跟,不比回声(放完前 300 毫秒的尾巴也不算嘴)
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
    // 热身:像跟读就开闸下一拍(不接住、不交脑);对老师说的记一笔,照收下往下走
    if (this.echoing) {
      const kind = echoKind(said, this.echoing.echo.word);
      this.noteEcho(kind, said);
      if (kind === 'said') {
        this.rec.in({ t: 'hold', vad: true }, from);
        this.rec.in({ t: 'release', vad: true, echo: true }, to);
        this.echoed();
        return;
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
    this.turn(this.d.asked && body.newThread !== true ? 'answer' : 'voice', body, said);
  }

  /** 孩子那句转写失败:按住说的照转写是空的办;一直听时不到 1 秒的放过,长的嘴说没听清 */
  private kidFailed(): void {
    if (!this.mouthOpen) { this.heard(''); return; }
    const long = (this.vadAwait ?? this.ms()) - this.vadFrom >= 1000;
    this.verdict(null, 'failed');
    if (long && !this.said && this.session) this.ask({ kind: 'catch' }, catchCue('empty', this.lang())!);
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
    await this.turns.submit(body);
  }

  /**
   * 这一轮实时的那些(收下了才算,交给脑时带):口语课热身的摸底一直带着,打了电话带打了几分钟,应用起的这一轮说明为什么;
   * 交画那一轮(交画板卡、纸上的画):这张画上边画边说的带给脑,之后清掉;上一轮念到第几句被打断,带了就清
   */
  private liveOf(body: Record<string, unknown>): NonNullable<ContextPack['live']> {
    const { app, ...rest } = body;
    const drawKey = rest.action === 'submit' && isObj(rest.focus) && typeof rest.focus.card === 'string' ? rest.focus.card : isObj(rest.drawing) ? 'paper' : null;
    const draw = drawKey ? this.drawTalk.get(drawKey) : undefined;
    if (drawKey) this.drawTalk.delete(drawKey);
    const cut = this.d.takeCut();
    return {
      ...(draw?.length ? { draw } : {}),
      ...(this.caught ? { caught: this.caught } : {}),
      ...(cut !== undefined ? { cut } : {}),
      ...(this.warm.length ? { warmup: warmLines(this.warm) } : {}),
      ...(this.phoneAt !== null ? { phone: Math.max(0, Math.floor((Date.now() - this.phoneAt) / 60_000)) } : {}),
      ...(app === 'call' || app === 'quiet' ? { app: app as 'call' | 'quiet' } : {}),
    };
  }

  /** 接住说中文还是英文:口语课打了电话以后说英文 */
  private lang(): 'zh' | 'en' {
    return this.phoneAt !== null ? 'en' : 'zh';
  }

  /** 热身那句在孩子端放完的时刻(通话毫秒)知道了:从那时起等 ECHO_WAIT_MS */
  private armEcho(endAt: number): void {
    const e = this.echoing;
    if (!e || e.endAt !== null) return;
    e.endAt = endAt;
    e.timer = setTimeout(() => this.echoDue(), Math.max(0, endAt - this.ms()) + (this.deps.echoWaitMs ?? ECHO_WAIT_MS));
  }

  /** 热身等够了:孩子正在说(或说完了在等转写、按着)就等它判完;没开口记一笔,接着下一拍;连着 QUIET_BEATS 拍没开口停下交脑 */
  private echoDue(): void {
    const e = this.echoing;
    if (!e || this.ended) return;
    e.timer = null;
    if (this.vadOn || this.vadAwait !== null || this.holding || this.echoHeld) { e.overdue = true; return; }
    this.noteEcho('silent');
    if (this.quietBeats >= QUIET_BEATS) {
      this.interrupt();
      this.d.note({ e: 'release' });
      this.quietBeats = 0;
      this.appTurn('(没出声)', 'quiet');
      return;
    }
    this.echoed();
  }

  /** 热身记一拍(摸底;录像里一条 {t:'echo'},只记不发) */
  private noteEcho(outcome: 'said' | 'silent' | 'talk', text?: string): void {
    const e = this.echoing;
    if (!e) return;
    const startMs = e.heardAt !== null && e.endAt !== null ? Math.max(0, e.heardAt - e.endAt) : undefined;
    const beat: WarmBeat = { word: e.echo.word, say: e.echo.say === true, outcome, ...(text !== undefined ? { text } : {}), ...(startMs !== undefined && outcome !== 'silent' ? { startMs } : {}), ...(text !== undefined && e.echo.word ? { hit: coverage(e.echo.word, text) } : {}) };
    this.warm.push(beat);
    this.quietBeats = outcome === 'silent' ? this.quietBeats + 1 : 0;
    this.rec.out({ t: 'echo', ...beat });
  }

  /** 热身这拍过了:开闸,下一拍接着念;压低的恢复 */
  private echoed(): void {
    if (this.echoing?.timer) clearTimeout(this.echoing.timer);
    this.echoing = null;
    this.d.step({ e: 'echoed' });
    this.resume();
  }

  /** 热身里按住说的那一下转写回来了:空的接着等;像跟读开闸;对老师说的同松手(打断、接住、交给脑) */
  private echoHeard(text: string): void {
    const body = this.echoHeld ?? {};
    this.echoHeld = null;
    if (!this.echoing) return;
    if (!text.trim()) { if (this.echoing.overdue) this.echoDue(); return; }
    const kind = echoKind(text, this.echoing.echo.word);
    this.noteEcho(kind, text);
    if (kind === 'said') { this.echoed(); return; }
    this.send({ t: 'kid', text });
    this.interrupt();
    this.turn(this.d.asked && body.newThread !== true ? 'answer' : 'voice', body, text);
  }

  /** [[call]] 那句出齐了:它在孩子端放完时开始响铃、算打电话的起点;马上交脑写英文开场(铃声垫着,嘴不接) */
  private startPhone(): void {
    if (this.phoneAt !== null) return;
    this.phoneAt = this.wall(this.d.end);
    // 铃响够之前英文开场先不交(排队在 [[call]] 那句关着闸,rung 才开;孩子开口的暂停 / 放过开不了它)
    this.timers.push(setTimeout(() => { if (!this.ended) this.d.step({ e: 'rung' }); }, Math.max(0, this.d.end - this.ms()) + (this.deps.ringMs ?? RING_MS)));
    this.appTurn('(打电话)', 'call');
  }

  /** 应用起的一轮(不是孩子说的):嘴不出声,接在这次通话的话题后面交给脑 */
  private appTurn(text: string, app: 'call' | 'quiet'): void {
    const seq = ++this.turnSeq;
    this.caught = '';
    this.caughtDone = true;
    this.pendingVoice = null;
    this.draft = null;
    const body: Record<string, unknown> = { text, app, ...(this.turns.thread ? { thread: this.turns.thread } : {}), ...(this.ctxBody.device ? { device: this.ctxBody.device } : {}) };
    void this.toBrain(seq, body);
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
    this.offEvents?.();
    const s = this.session;
    this.session = null;
    s?.close('end');
    this.send({ t: 'end', why });
    // 字幕重放:挂的时候嘴还在出的那段,出了的那截也落;等这几轮都落完
    if (this.said?.kind === 'read') this.mouthEnd(this.said, false);
    await this.takes.flush();
    try {
      const take = this.rec.finish();
      if (take.reel.msgs.length > 2) {
        const { ctx, tutor } = this.deps;
        const at = this.rec.startedAt;
        const dir = join(ctx.runner.ws.dirs.conversations, tutor, `${localDate(at)}.live`);
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
/** 孩子端发来的图(data:image/jpeg;base64,…)→ 字节;不是 jpeg、太大(百炼一帧上限)回 null */
const jpegOf = (v: unknown): Buffer | null => {
  const m = typeof v === 'string' ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(v) : null;
  return m && m[1].length <= MAX_IMAGE_B64 ? Buffer.from(m[1], 'base64') : null;
};
/** 这一条带着交的东西(交卡、纸上的画):没说清也要交给脑 */
const handsIn = (body: Record<string, unknown>): boolean => body.action === 'submit' || isObj(body.drawing);
/** 录像里记的那条:去掉图,留一个 image: true */
const withoutImages = (m: Record<string, unknown>): Record<string, unknown> => {
  if (typeof m.image === 'string') return { ...m, image: true };
  if (isObj(m.chat) && typeof m.chat.image === 'string') return { ...m, chat: { ...m.chat, image: true } };
  return m;
};
/** 孩子端交来的 ask:只留认得的字段 */
const askOf = (v: unknown): ChatAsk => {
  if (!isObj(v)) return {};
  const colors = Array.isArray(v.colors) ? v.colors.filter((c): c is { name: string; strokes: number; where: string } => isObj(c) && typeof c.name === 'string' && typeof c.strokes === 'number' && typeof c.where === 'string').slice(0, 6) : undefined;
  return {
    ...(typeof v.prompt === 'string' && v.prompt.trim() ? { prompt: v.prompt.trim().slice(0, 200) } : {}),
    ...(typeof v.color === 'string' && v.color ? { color: v.color.slice(0, 8) } : {}),
    ...(typeof v.ask === 'boolean' ? { ask: v.ask } : {}),
    ...(typeof v.minutes === 'string' ? { minutes: v.minutes.slice(0, 20) } : {}),
    ...(colors?.length ? { colors } : {}),
    ...(typeof v.cleared === 'number' && v.cleared > 0 ? { cleared: Math.floor(v.cleared) } : {}),
  };
};
/** 孩子这边的动作(嘴断了要攒着补的那几种) */
const INPUTS = new Set(['hold', 'release', 'hush', 'send', 'staged']);

