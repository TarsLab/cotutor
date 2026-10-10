/**
 * 一次通话的中转:孩子端的 WebSocket ↔ 百炼 realtime(《wip/口语课设想.md》§三)。
 * 跟读与聊各一条 realtime 会话(silence 喂过音频改不了,见 realtime.ts);两边的声音与字都记下,挂了落盘(store.finishCall)。
 *
 * 孩子端 → 这里:二进制帧 = PCM16 16k 单声道一块;文本帧 = JSON
 *   {t:'hold'} 跟读按下 · {t:'release'} 松手 · {t:'again'} 再听老师读 · {t:'next'} 下一句(到头开聊)· {t:'chat'} 直接开聊 · {t:'bye'} 挂断
 * 这里 → 孩子端:二进制帧 = PCM16 24k 老师的声音;文本帧 = JSON
 *   {t:'state', phase, i, n, item, speaking, deadline, interrupt} · {t:'tutor', delta} / {t:'tutor', done} · {t:'kid', text} · {t:'flush'}(清播放队列)· {t:'err', msg} · {t:'end', why}
 *
 * 轮次:跟读段手动——按住才把声音推给模型,松手 commit + response.create;聊那段 semantic_vad——声音一直推(interrupt=false 时孩子端自己在老师放声时不推),
 * 模型判出孩子开口(speech_started)就掐掉正在出的回答、让孩子端清播放队列。
 */
import type { TalkConfig } from '../schema/config.ts';
import { itemsOf, type Line, type ListItem } from './lib/used.ts';
import { chatCloseCue, chatInstructions, chatOpenCue, readAgainCue, readCue, readInstructions, readSummary } from './prompt.ts';
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
/** 松手时推过去的声音不到这么多就当没说(0.15 秒) */
const MIN_HOLD_BYTES = 4800;

export class TalkCall {
  private phase: Phase = 'read';
  private i = 0;
  private readonly items: ListItem[];
  private session: RealtimeSession | null = null;
  private holding = false;
  private heldBytes = 0;
  private speaking = false;
  private readonly lines: Line[] = [];
  private readonly kidLines: string[] = [];
  private readonly kidPcm: Buffer[] = [];
  private readonly tutorPcm: Buffer[] = [];
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
  private send(o: Record<string, unknown>): void { this.sock.sendText(JSON.stringify(o)); }
  private state(): void {
    this.send({ t: 'state', phase: this.phase, i: this.i, n: this.items.length, item: this.items[this.i] ?? null, speaking: this.speaking, deadline: this.deadline, interrupt: this.deps.config.interrupt });
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
      onAudio: (pcm) => { this.tutorPcm.push(pcm); this.sock.sendBinary(pcm); },
      onTutorText: (delta, done) => { if (done !== null) { this.note('tutor', done.trim()); this.send({ t: 'tutor', done: done.trim() }); } else if (delta) this.send({ t: 'tutor', delta }); },
      onKidText: (text) => { this.note('kid', text); this.send({ t: 'kid', text }); },
      onSpeech: (s) => {
        if (s === 'started' && this.phase === 'chat') { if (this.session?.responding) this.session.cancel(); this.send({ t: 'flush' }); }
      },
      onResponse: (st, _status, usage) => {
        this.speaking = st === 'created';
        if (usage) this.usage = { input: this.usage.input + usage.input, output: this.usage.output + usage.output, inputAudio: this.usage.inputAudio + usage.inputAudio, outputAudio: this.usage.outputAudio + usage.outputAudio };
        this.state();
        if (st === 'done') {
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
    const s = new RealtimeSession({ instructions: readInstructions(this.meta.list, this.deps.kidName), voice: this.deps.config.voice, model: this.deps.config.model, turn: 'manual', endpoint: this.deps.endpoint, env: this.deps.env }, this.events());
    const why = await s.connect();
    if (why !== null) { this.send({ t: 'err', msg: `connect:${why}` }); await this.end(`connect:${why}`); return; }
    this.session = s;
    this.cue(readCue(this.items[this.i]));
  }

  private cue(text: string): void {
    this.whenIdle(() => { this.session?.addText(text); this.session?.createResponse(); this.state(); });
  }

  /** 孩子端的一条文本消息 */
  onText(raw: string): void {
    if (this.ended) return;
    let m: { t?: unknown };
    try { m = JSON.parse(raw) as { t?: unknown }; } catch { return; }
    switch (m.t) {
      case 'hold':
        if (this.phase !== 'read' || !this.session) return;
        if (this.session.responding) { this.session.cancel(); this.send({ t: 'flush' }); }
        this.holding = true;
        this.heldBytes = 0;
        break;
      case 'release':
        if (this.phase !== 'read' || !this.session || !this.holding) return;
        this.holding = false;
        if (this.heldBytes < MIN_HOLD_BYTES) { this.session.clearAudio(); return; }
        this.whenIdle(() => { this.session?.commit(); this.session?.createResponse(); });
        break;
      case 'again':
        if (this.phase === 'read' && this.items[this.i]) this.cue(readAgainCue(this.items[this.i]));
        break;
      case 'next':
        if (this.phase !== 'read') return;
        this.holding = false;
        this.i++;
        if (this.i < this.items.length) this.cue(readCue(this.items[this.i]));
        else void this.startChat();
        break;
      case 'chat':
        if (this.phase === 'read') void this.startChat();
        break;
      case 'bye':
        void this.end('bye');
        break;
      default: break;
    }
  }

  /** 孩子端的一块声音 */
  onAudio(pcm: Buffer): void {
    if (this.ended || !this.session?.isReady) return;
    if (this.phase === 'read') {
      if (!this.holding) return;
      this.heldBytes += pcm.length;
    }
    this.lastKidAudioAt = this.ms();
    this.kidPcm.push(pcm);
    this.session.appendAudio(pcm);
  }

  private async startChat(): Promise<void> {
    if (this.phase !== 'read' || this.ended) return;
    const read = Math.min(this.i, this.items.length);
    const old = this.session;
    this.session = null;
    this.speaking = false;
    this.afterIdle.length = 0;
    old?.close('read-done');
    this.phase = 'chat';
    this.state();
    const cfg = this.deps.config;
    const s = new RealtimeSession({ instructions: chatInstructions(this.meta.list, this.deps.kidName, cfg.minutes, readSummary(this.meta.list, read, this.kidLines)), voice: cfg.voice, model: cfg.model, turn: 'semantic_vad', silenceMs: cfg.silenceMs, endpoint: this.deps.endpoint, env: this.deps.env }, this.events());
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
    const s = this.session;
    this.session = null;
    // 老师说到一半被挂了,那半句也记下(真跑里孩子刚答完就挂,老师的「Great job!」没等到 done)
    if (s?.partialTutorText.trim()) this.note('tutor', s.partialTutorText.trim());
    s?.close('end');
    const read = Math.min(this.i, this.items.length);
    this.phase = 'ended';
    this.send({ t: 'end', why });
    try {
      await finishCall(this.deps.root, this.meta, { startedAt: this.startedAt.toISOString(), ms: this.ms(), why, model: this.deps.config.model, voice: this.deps.config.voice, items: this.items.length, read, lines: this.lines, usage: this.usage, kidPcm: Buffer.concat(this.kidPcm), tutorPcm: Buffer.concat(this.tutorPcm), kidRate: INPUT_RATE, tutorRate: OUTPUT_RATE });
    } catch (err) {
      console.error('talk: 落盘失败', err);
    }
    this.sock.close(1000, why);
    this.deps.onFinished?.(why);
  }

  /** 孩子端断了 */
  onSocketClose(): void { if (!this.ended) void this.end('kid-gone'); }
}
