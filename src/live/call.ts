/**
 * 实时老师的一次通话(《wip/实时老师开发计划.md》P2.4):孩子端的 WebSocket ↔ 嘴(百炼 realtime,手动轮次)+ 脑(老师 CLI,Runner)。
 * 一轮:孩子按住说 → 松手(嘴不接话,拍照才先说一句「我看一看图片」,lib/cue.ts)→ 孩子那句的转写交给脑(实时轮:讲稿不配音)→ 脑的讲稿定稿一句交一句,
 * 嘴一空就把排着的几句一起交给它照念(lib/queue.ts,流水线:嘴出完上一段就交下一段,声音在孩子端接着排)→ 讲完就停。
 * 按句不按拍(2026-10-19):卡宁缺毋滥以后一节常常只有一拍、甚至没卡,按拍要等脑整段写完才念;卡只管自己闭合了就铺,和念哪句不挂钩。
 * 转写是空的(按了没说清):嘴在说就掐掉,改说「没听清」,不交给脑;按着时声音不到 100 毫秒(不 commit)、commit 没收下也一样。孩子在嘴的声音还在放时按下 = 打断:掐掉、孩子端清播放队列,
 * 没念的拍丢掉,孩子听到第几句(lib/playback.ts 按声音排到哪算)进下一轮的上下文包 live:。嘴只接住、只照念,不讲新内容(2026-10-19 P1)。
 *
 * 孩子端 → 这里:二进制帧 = PCM16 16k 单声道一块(按着时才推);文本帧 = JSON
 *   {t:'hold'} 按下 · {t:'release', body} 松手(body 同 POST /api/kid/conversations/<老师>/messages 少 text:thread / newThread / device…)
 *   {t:'hush'} 停下不开新一轮(上滑取消):嘴在出就掐、孩子端清了、没念的丢掉
 *   {t:'send', body} 不是说的(打字、拍照、交卡、首页按钮;舞台开着带 focus.card):body 同那条 POST · {t:'view', w, h} 屏幕多大 · {t:'bye'}
 *   {t:'staged'} 讲稿 [[play]] 的小课堂那一段放完了(或放不了、被关):后面的讲稿接着交给嘴
 * 这里 → 孩子端:二进制帧 = PCM16 24k 嘴的声音;文本帧 = JSON
 *   {t:'ready'} 嘴连上了 · {t:'fallback', why} 连不上(孩子端回到「正在叫老师」,过一会儿重连)· {t:'kid', text} 孩子那句的转写 · {t:'tutor', of, delta} / {t:'tutor', of, done} 嘴的字(of:catch 接住 / read 照念)
 *   {t:'turn', job, thread} 脑开始写这一轮 · {t:'read', job, line, text, play?} 讲稿这一句开始放(play = 念完放小课堂那一段;一句一个,按孩子端放到的时刻发:一段里第一句在段首,
 *   后面几句等这段的声音出齐、按字数比例摊)· {t:'flush'} 清播放队列
 *   {t:'state', speaking, holding} · {t:'err', status, error} 发不出去(400 / 409 …)· {t:'end', why}
 * 嘴的会话断了(百炼 300 秒没输入就关,2026-10-20 照 Qwen-Live-Harness 的换连接):电话不挂、孩子端不知道;下次按下或发来时现连,
 *   连上之前来的照序攒着补(录像里记一条 {t:'lost'},只记不发)。平时孩子没按着就 30 秒一次心跳,最后一次动静 15 分钟后停跳。
 * 换连接:嘴的历史越长每次回答越贵,输入过了 SWAP_TOKENS 就在安静时换一条新的(录像里记 {t:'swap'},只记不发)。
 * 一直听(《wip/实时老师常开麦设计.md》;孩子端只在口语课、或 live.listen 是 open 时连接带 ?listen=open,中途发 {t:'listen', open} 也能换):孩子端一直推声音(卡的声音、录音、小课堂、关麦时不推,{t:'gate', on} 告诉这里),
 *   嘴的会话开 VAD(live.vad 缺省 server_vad、live.silenceMs),create_response / interrupt_response 关着:开口(speech_started)先暂停照念、嘴在放就让孩子端压低({t:'duck'}),
 *   转写回来 lib/listen.ts 判收下 / 放过——收下才算按下 + 松手(打断、接住、交给脑;交给脑之前孩子停一下又开口的并成一句),放过的恢复音量接着念({t:'skip', why} / {t:'unduck'})。
 *   孩子那一句的上下文(话题、设备、舞台上的卡)孩子端开口时报一次 {t:'ctx', body}。换模式 = 安静时换一条连接(silence 只有新连接能给)。
 *   commit 了不回答 300 秒百炼就关(response_idle_timeout,探针 probe-live-vad):放过的多了,离上次回答 IDLE_SWAP_MS 就在安静时换连接。
 * 口语课(《wip/口语课改实时老师设计.md》§三):先热身、再打电话。热身是脑一轮写完的跟读,讲稿的 [[echo 词]] / [[say 词]] 那句念完关闸(lib/queue.ts),
 *   孩子说完(像跟读,lib/warm.ts)开闸下一拍,不接住、不交脑;对老师说的照收下办(打断、接住、交脑);ECHO_WAIT_MS 没开口接着走,连着两拍没开口停下交脑(app: quiet)。
 *   每拍记进摸底(录像 {t:'echo'},只记不发),交脑时带上(live.warmup)。[[call]] 那句念完孩子端响铃,这里马上交脑一轮(app: call,不接住),
 *   之后的接住换英文(cue.ts 的 CATCH_EN),交脑带打电话几分钟(live.phone)。孩子端连上发来的第一条带 talk(口语单)时嘴先说「好,我们先热热身!」。
 * 录像:进出的消息、两边的声音都记(CallRecorder),挂了落在 conversations/<老师>/<日期>.live/<时分秒>.reel.json / .wav。
 * 字幕重放(《wip/实时老师设想.md》拍板 21):嘴照念的声音按轮另留一份,出了的都留(孩子按下时清掉、没放出来的也在),
 *   一段出完(或被掐、断了)就落 <日期>.<job>.mouth.wav 与每句的起点 .mouth.json(lib/mouth.ts);接住那句不在里面。孩子端从 /api/kid/conversations/<老师>/mouth/<日期>/<job> 取。
 * 事件:嘴这一道(mouth:按下、松手 / 发了、接住开始放、第几句开始放、打断)补进那一轮的 events.jsonl(Runner.noteEvent),工作台的时间线上看;
 * 按下、松手、接住在脑起来之前,先攒着,等那一轮的老师进程起来(main:start)再按它的起点换成相对毫秒(负的)。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { kidSendInput, type AppContext } from '../server/app.ts';
import { BusyError, type SendStarted } from '../server/runner.ts';
import type { RunEvent } from '../lib/events.ts';
import { readIndex } from '../server/store.ts';
import { conversationFiles, localDate } from '../lib/conversation.ts';
import { lineFlags } from '../lib/board.ts';
import { catchCue, readCue, type CatchKind } from './lib/cue.ts';
import { judge } from './lib/listen.ts';
import { echoKind, warmLines, type WarmBeat } from './lib/warm.ts';
import { coverage } from '../lib/en-words.ts';
import { addChunk, flushAt, playbackInit, playingAt, type Playback } from './lib/playback.ts';
import { queueInit, queueStep, type Beat, type Echo, type QueueEvent, type QueueState } from './lib/queue.ts';
import { MIX_RATE } from './lib/mix.ts';
import { mouthIndex, type MouthSeg } from './lib/mouth.ts';
import { wavOfPcm } from './lib/wav.ts';
import { mouthInstructions } from './prompt.ts';
import { mouthVoice } from '../schema/index.ts';
import { INPUT_RATE, OUTPUT_RATE, RealtimeSession } from './realtime.ts';
import { CallRecorder } from './recorder.ts';
import type { ServerSocket } from './ws.ts';

export interface LiveDeps {
  ctx: AppContext;
  tutor: string;
  /** 哪一台设备(升级请求里的设备 cookie,《孩子端流水设计.md》§二):孩子发的每一条记上 */
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

/** 嘴这次回答是什么:接住(孩子这一轮)、照念哪几句、脑想得久时垫的一句、一直听进来先招呼的一句 */
type Said = { kind: 'catch' } | { kind: 'read'; beat: Beat };

/** 一轮嘴照念的声音(字幕重放):每段是一次照念的回答;writing 把这一轮的落盘串起来 */
interface MouthTake { date: string; segs: (MouthSeg & { said: Said; pcm: Buffer[] })[]; writing: Promise<void> }

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
  /** 脑最近写的那一轮的话题(应用起的那一轮接在它后面) */
  private thread: string | null = null;
  /** 字幕重放:最近几轮嘴照念的声音(job → 那一轮的几段) */
  private readonly takes = new Map<string, MouthTake>();
  private offEvents: (() => void) | null = null;
  private ended = false;
  private readonly sock: ServerSocket;
  private readonly deps: LiveDeps;

  constructor(sock: ServerSocket, deps: LiveDeps) {
    this.sock = sock;
    this.deps = deps;
    this.rec = new CallRecorder(deps.ctx.now);
    this.open = deps.listen === 'open';
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
      if (act.beat.echo) this.echoing = { echo: act.beat.echo, endAt: null, heardAt: null, timer: null, overdue: false };
      this.ask({ kind: 'read', beat: act.beat }, readCue(act.beat.texts));
      // 这段最后一句念完孩子端放小课堂那一段:排队关着闸,等 staged;孩子端一直没回也别卡死
      if (act.beat.play) this.timers.push(setTimeout(() => { if (!this.ended && this.q.gated) this.step({ e: 'staged' }); }, GATE_MS));
    }
    return act?.kind === 'dropped' ? act.beats : [];
  }

  /** 让嘴说一次;接住要先告诉排队,嘴出完之前别交讲稿 */
  private ask(said: Said, instructions: string): void {
    this.said = said;
    if (said.kind !== 'read') this.q = queueStep(this.q, { e: 'asked' }).s;
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
      if (e.event.lane === 'main' && e.event.kind === 'line') this.linesUpTo([{ i: e.event.line, text: e.event.text, play: e.event.play === true, echo: e.event.echo, call: e.event.call }]);
    });
    this.timers.push(setInterval(() => this.keepAlive(), this.deps.heartbeatMs ?? HEARTBEAT_MS));
    this.send({ t: 'ready' });
  }

  /** 开一条嘴的会话(第一次、断了以后现连、换连接都走这里);不是 this.session 的会话,回调都不认 */
  private async openMouth(): Promise<{ why: string | null; s: RealtimeSession; open: boolean }> {
    const { ctx, tutor } = this.deps;
    const cfg = ctx.ws.config;
    const t = cfg.tutors[tutor];
    let firstOfAnswer = true;
    const open = this.open;
    const s: RealtimeSession = new RealtimeSession({ instructions: mouthInstructions({ display: t?.display ?? tutor, kidName: cfg.kid.name ?? cfg.kid.slug }), voice: mouthVoice(cfg.live, tutor), model: cfg.live.model, turn: open ? cfg.live.vad : 'manual', silenceMs: cfg.live.silenceMs, vad: { createResponse: false, interruptResponse: false }, endpoint: this.deps.endpoint, env: this.deps.env }, {
      onAudio: (pcm) => {
        if (this.session !== s) return;
        const said: Said = this.said ?? { kind: 'catch' };
        const r = addChunk(this.play, said, this.ms(), pcm.length / BYTES_PER_MS);
        this.play = r.p;
        // 照念的第一块:到它在孩子端开始放的那一刻,告诉孩子端这段的第一句;接住的第一块记一条(开始放的时刻)
        if (firstOfAnswer && said.kind === 'read') this.readAt(said.beat, 0, r.start);
        if (firstOfAnswer && said.kind === 'catch' && this.holding === false) this.mouth(null, this.wall(r.start), { lane: 'mouth', kind: 'catch', text: '' });
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
          if (kind === 'catch') { this.caught = done.trim(); this.caughtDone = true; const c = [...this.pre].reverse().find((x) => x.ev.kind === 'catch'); if (c && c.ev.kind === 'catch') c.ev.text = this.caught; }
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
        if (status === 'cancelled') this.play = flushAt(this.play, this.ms());
        else if (this.said?.kind === 'read') {
          this.readRest(this.said);
          // 热身那句出齐了:知道它在孩子端什么时候放完,从那时起等孩子;[[call]] 那句出齐了:开始打电话
          if (this.said.beat.echo) this.armEcho(this.play.end);
          if (this.said.beat.call) this.startPhone();
        }
        // 比回声按这段在孩子端放完的时刻算(字早就出完了,声音要放十几秒)
        const last = this.saidLog[this.saidLog.length - 1];
        if (last && status !== 'cancelled') last.at = Math.max(last.at, this.wall(this.play.end));
        this.lastResponseAt = Date.now();
        this.committedSince = false;
        if (this.said?.kind === 'catch') this.caughtDone = true;
        this.said = null;
        this.lastActive = Date.now();
        this.q = { ...this.q, busy: false };
        const next = this.afterDone;
        this.afterDone = null;
        if (next) next();
        else this.step({ e: 'done' });
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
    return !this.holding && !this.vadOn && this.vadAwait === null && !this.said && !this.session?.responding && !this.q.pending.length && !this.q.gated && !this.running && !this.reviving && !this.swapping;
  }

  /**
   * 换连接(《wip/实时老师开发计划.md》P3.3):嘴的输入每次回答都带着整条连接的历史,一轮约多 230 token(2026-10-20 真连 15 轮:843 涨到 5468,
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
    if (this.said) { this.said = null; this.afterDone = null; this.cancelOnCreate = false; this.q = { ...this.q, busy: false }; }
    // 热身那句没出齐就断了:从现在起等孩子,别卡死
    if (this.echoing && this.echoing.endAt === null) this.armEcho(this.ms());
    // 按着时断的:推过去的声音跟着那条会话没了,松手就说没听清
    this.heldBytes = 0;
    // 一直听时孩子说到一半断的:那一句跟着会话没了
    this.vadOn = false;
    this.vadAwait = null;
    if (this.ducked) { this.ducked = false; this.send({ t: 'unduck' }); }
    // 一直听、声音还在推:没有「下次按下」,马上连
    if (this.q.pending.length || (this.open && Date.now() - this.lastAudioAt < 5000)) void this.revive();
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
    this.maybeSwap();
    if (!s?.isReady || this.holding || this.vadOn || s.responding || Date.now() - this.lastActive > (this.deps.keepAliveMs ?? KEEP_ALIVE_MS)) return;
    // 一直听、声音一直在推:本来就有输入,不用跳
    if (this.mouthOpen && Date.now() - this.lastAudioAt < 5000) return;
    s.heartbeat();
  }

  /** 到 at(孩子端放到的时刻)告诉孩子端:这一段的第 k 句开始放了 */
  private readAt(beat: Beat, k: number, at: number): void {
    const t = setTimeout(() => {
      if (this.ended || this.q.dropJob === beat.job) return;
      this.lastRead = { job: beat.job, line: beat.lines[k] };
      this.asked = /[?？]\s*$/.test(beat.texts[k] ?? '');
      // play:这句念完孩子端放小课堂那一段(放完回 staged);echo:念完卡亮「轮到你」;call:念完响铃
      const last = k === beat.lines.length - 1;
      this.send({ t: 'read', job: beat.job, line: beat.lines[k], text: beat.texts[k], ...(beat.play && last ? { play: true } : {}), ...(beat.echo && last ? { echo: true } : {}), ...(beat.call && last ? { call: true } : {}) });
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

  /** 字幕重放:这次照念在它那一轮里的那一段(第一块声音到时开;make = false 只找不开);接住、那一轮不在内存里的不留 */
  private mouthSeg(said: Said, make = true): (MouthSeg & { said: Said; pcm: Buffer[] }) | null {
    if (said.kind !== 'read') return null;
    const take = this.takes.get(said.beat.job);
    if (!take) return null;
    const last = take.segs[take.segs.length - 1];
    if (last?.said === said) return last;
    if (!make) return null;
    const seg = { lines: [...said.beat.lines], texts: [...said.beat.texts], bytes: 0, heard: 0, done: false, said, pcm: [] as Buffer[] };
    take.segs.push(seg);
    return seg;
  }

  /** 字幕重放:一段出完了(done)/ 被掐了、断了:这一轮整份重落一次(接在前面的落盘后面,不并发写) */
  private mouthEnd(said: Said, done: boolean): void {
    const seg = this.mouthSeg(said, false);
    if (!seg || said.kind !== 'read') return;
    seg.done = done;
    const job = said.beat.job;
    const take = this.takes.get(job)!;
    const pcm = Buffer.concat(take.segs.flatMap((s) => s.pcm));
    const index = mouthIndex(take.segs, BYTES_PER_MS);
    const f = conversationFiles(this.deps.ctx.ws.dirs.conversations, this.deps.tutor, take.date);
    take.writing = take.writing
      .then(async () => {
        await writeFile(f.mouth(job, 'wav'), wavOfPcm(pcm, OUTPUT_RATE));
        await writeFile(f.mouth(job, 'json'), JSON.stringify(index));
      })
      .catch((err) => console.error('live: 嘴的声音落盘失败', err));
  }

  /** 讲稿又定稿了几句:按序号接着交给排队(重复的、跳号的不收) */
  private linesUpTo(lines: { i: number; text: string; play?: boolean; echo?: Echo; call?: true }[]): void {
    if (!this.job) return;
    for (const l of lines) {
      if (l.i !== this.linesQueued) continue;
      this.linesQueued++;
      this.step({ e: 'beat', beat: { job: this.job, lines: [l.i], texts: [l.text], ...(l.play ? { play: true } : {}), ...(l.echo ? { echo: l.echo } : {}), ...(l.call ? { call: true as const } : {}) } });
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
    // 脑这一轮还一句都没念到(还没写出第一句)就被打断:报 0,下一轮脑才知道孩子一句没听到
    // (10-20 21:18 连着两轮在第一句之前被按掉,脑以为提示给过了,下一轮直接讲了答案)
    else if (this.job && this.lastRead?.job !== this.job) this.cut = 0;
    if (playing && this.job) this.mouth(this.job, Date.now(), { lane: 'mouth', kind: 'cut', line: at?.kind === 'read' && this.lastRead?.job === this.job ? this.lastRead.line : null });
    for (const t of this.readTimers.splice(0)) clearTimeout(t);
    // 热身不等了(排着的那几拍跟着丢了;摸底留着)
    if (this.echoing?.timer) clearTimeout(this.echoing.timer);
    this.echoing = null;
    this.echoHeld = null;
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
        // 热身在等孩子跟:按下就是在跟,不打断(排着的几拍留着);那句的声音还没放完就清掉
        if (this.echoing) {
          if (this.echoing.heardAt === null) this.echoing.heardAt = this.ms();
          if (this.playing()) { this.play = flushAt(this.play, this.ms()); this.send({ t: 'flush' }); }
        } else this.interrupt();
        this.state();
        break;
      }
      case 'release': {
        if (!this.session || !this.holding) return;
        this.holding = false;
        this.pre.push({ at, ev: { lane: 'mouth', kind: 'release', how: 'voice' } });
        const body = isObj(m.body) ? m.body : {};
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
        const kind: CatchKind = body.action === 'submit' ? 'card' : Array.isArray(body.photos) && body.photos.length ? 'photo' : isObj(body.talk) ? 'warm' : isObj(body.via) ? 'start' : 'text';
        this.interrupt();
        this.pre = [{ at, ev: { lane: 'mouth', kind: 'release', how: kind === 'card' || kind === 'photo' ? kind : 'text' } }];
        const text = typeof body.text === 'string' ? body.text : '';
        this.turn(kind, body, text);
        break;
      }
      // 孩子端放完了小课堂那一段(或放不了、被关):后面的讲稿接着交给嘴
      case 'staged': this.step({ e: 'staged' }); break;
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
   * 一轮开始:多半嘴不出声,等脑的第一句(孩子端板上有占位卡);拍照、热身这几种才先说一句(lib/cue.ts;上一次回答被掐了还没回 done 就等它回了再说)。
   * 说的等转写回来再交给脑,不是说的直接交
   */
  private turn(kind: CatchKind, body: Record<string, unknown>, text?: string): void {
    const seq = ++this.turnSeq;
    this.caught = '';
    this.q = queueStep(this.q, { e: 'release' }).s;
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
    this.send({ t: 'kid', text });
    const v = this.pendingVoice;
    this.pendingVoice = null;
    if (!v || v.seq !== this.turnSeq) return;
    if (text.trim()) { void this.toBrain(v.seq, { ...v.body, text }); return; }
    const sorry = (): void => this.ask({ kind: 'catch' }, catchCue('empty', this.lang())!);
    if (!this.said) { sorry(); return; }
    // 接住还在要 / 在出:掐掉,出完(被掐)再说没听清
    this.afterDone = sorry;
    if (this.session?.responding) this.session.cancel(); else this.cancelOnCreate = true;
    if (this.playing()) { this.play = flushAt(this.play, this.ms()); this.send({ t: 'flush' }); }
  }

  /** 一直听:VAD 判出孩子开口 / 说完。开口先暂停照念(不丢)、嘴在放就让孩子端压低;说完了等转写 */
  private speech(st: 'started' | 'stopped'): void {
    this.lastActive = Date.now();
    if (st === 'started') {
      this.vadOn = true;
      this.vadFrom = this.ms();
      if (this.echoing && this.echoing.heardAt === null) this.echoing.heardAt = this.vadFrom;
      this.vadOverMouth = this.playing() || this.ms() < this.play.end + 300;
      this.q = queueStep(this.q, { e: 'pause' }).s;
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
    if (!this.holding) this.step({ e: 'release' });
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
    const v = text === null ? { take: false as const, why: failed ?? 'rejected' } : judge(text, { asked: this.asked && !this.echoing, said: this.saidLog, now: Date.now(), mouthOn: this.vadOverMouth && !after });
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
      if (!this.holding) this.step({ e: 'release' });
      return;
    }
    this.pre = [{ at: this.wall(from), ev: { lane: 'mouth', kind: 'hold' } }, { at: this.wall(to), ev: { lane: 'mouth', kind: 'release', how: 'vad' } }];
    this.ducked = false;
    this.interrupt();
    const body = { ...this.ctxBody };
    // draft 先占上(turn 里交给脑是同步起步的,停一下接着说的要并得进来)
    this.draft = { seq: this.turnSeq + 1, texts: [said] };
    this.turn(this.asked && body.newThread !== true ? 'answer' : 'voice', body, said);
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
    if (this.running) { this.waiting.push(body); return; }
    await this.dispatch(body);
  }

  private async dispatch(body: Record<string, unknown>): Promise<void> {
    const { ctx, tutor } = this.deps;
    const { app, ...rest } = body;
    const r = await kidSendInput(ctx, tutor, rest, localDate(ctx.now()), this.deps.deviceId);
    if ('error' in r) { this.send({ t: 'err', status: r.error.status, error: (r.error.json as { error?: string } | undefined)?.error ?? 'error' }); return; }
    // 口语课:热身的摸底一直带着;打了电话带打了几分钟;应用起的这一轮说明为什么
    const live = {
      ...(this.caught ? { caught: this.caught } : {}),
      ...(this.cut !== undefined ? { cut: this.cut } : {}),
      ...(this.warm.length ? { warmup: warmLines(this.warm) } : {}),
      ...(this.phoneAt !== null ? { phone: Math.max(0, Math.floor((Date.now() - this.phoneAt) / 60_000)) } : {}),
      ...(app === 'call' || app === 'quiet' ? { app: app as 'call' | 'quiet' } : {}),
    };
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
    this.thread = started.thread;
    this.linesQueued = 0;
    // 字幕重放:这一轮的声音从这里接;更早的几轮落过盘了,内存里只留最近几轮
    this.takes.set(started.job, { date: started.date, segs: [], writing: Promise.resolve() });
    for (const old of [...this.takes.keys()].slice(0, -MOUTH_KEEP)) this.takes.delete(old);
    this.send({ t: 'turn', job: started.job, thread: started.thread });
    const job = started.job;
    void started.done.then(async (index) => {
      // 收尾:整块出的运行时、或流式时没发出来的最后几句,从正式的一节补上
      const m = index.messages.find((x) => x.job === job) ?? (await readIndex(ctx.ws, tutor, started.date)).messages.find((x) => x.job === job);
      const sec = m?.section;
      if (sec && this.job === job) this.linesUpTo(sec.lines.map((l, i) => ({ i, text: l.text, ...lineFlags(l, sec.cards) })));
    }, () => {}).finally(() => {
      if (this.running === started) this.running = null;
      this.flushWaiting();
      this.maybeSwap();
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
      this.q = queueStep(this.q, { e: 'release' }).s;
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
    this.step({ e: 'echoed' });
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
    this.turn(this.asked && body.newThread !== true ? 'answer' : 'voice', body, text);
  }

  /** [[call]] 那句出齐了:它在孩子端放完时开始响铃、算打电话的起点;马上交脑写英文开场(铃声垫着,嘴不接) */
  private startPhone(): void {
    if (this.phoneAt !== null) return;
    this.phoneAt = this.wall(this.play.end);
    // 铃响够之前英文开场先不交(排队在 [[call]] 那句关着闸,rung 才开;孩子开口的暂停 / 放过开不了它)
    this.timers.push(setTimeout(() => { if (!this.ended) this.step({ e: 'rung' }); }, Math.max(0, this.play.end - this.ms()) + (this.deps.ringMs ?? RING_MS)));
    this.appTurn('(打电话)', 'call');
  }

  /** 应用起的一轮(不是孩子说的):嘴不出声,接在这次通话的话题后面交给脑 */
  private appTurn(text: string, app: 'call' | 'quiet'): void {
    const seq = ++this.turnSeq;
    this.caught = '';
    this.caughtDone = true;
    this.pendingVoice = null;
    this.draft = null;
    const body: Record<string, unknown> = { text, app, ...(this.thread ? { thread: this.thread } : {}), ...(this.ctxBody.device ? { device: this.ctxBody.device } : {}) };
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
    for (const t of [...this.timers, ...this.readTimers]) { clearTimeout(t); clearInterval(t); }
    if (this.echoing?.timer) clearTimeout(this.echoing.timer);
    this.offEvents?.();
    const s = this.session;
    this.session = null;
    s?.close('end');
    this.send({ t: 'end', why });
    // 字幕重放:挂的时候嘴还在出的那段,出了的那截也落;等这几轮都落完
    if (this.said?.kind === 'read') this.mouthEnd(this.said, false);
    await Promise.all([...this.takes.values()].map((x) => x.writing));
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
