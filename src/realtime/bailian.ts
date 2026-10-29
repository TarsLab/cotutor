/**
 * 百炼 Qwen-Omni-Realtime 的 WebSocket 客户端:口语课和实时老师共用。
 * 一次通话一条会话。服务端连,key 不出服务端;孩子端的声音由调用方推进来,老师的声音从这里出去。
 *
 * 协议(OpenAI realtime 同族,2026-10-10 真连核对):
 *   连上先收 session.created;发 session.update,收 session.updated 后才能喂音频。
 *   上行:input_audio_buffer.append {audio: base64 PCM16 16k 单声道} / commit / clear;input_image_buffer.append {image: base64 JPEG}(先有声音再有图,commit 时一起交);response.create / cancel;
 *         conversation.item.create {item: {type: message, role, content: [{type: input_text, text}]}}。
 *   下行:response.audio.delta {delta: base64 PCM16 24k};response.audio_transcript.delta / .done(老师的字);
 *         conversation.item.input_audio_transcription.completed {transcript}(孩子那句,qwen3-asr-flash-realtime 转的);
 *         input_audio_buffer.speech_started / speech_stopped(VAD);response.done {response: {status, usage}};error。
 *   端点要业务空间 id:wss://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=…(公网域名 dashscope.aliyuncs.com 连上 1 秒就被关)。
 *
 * 轮次:manual = 手动(实时老师的按住说话:松手 commit);semantic_vad / server_vad = 服务端判(实时老师的一直听、热身后打电话那段;一直听时 create_response / interrupt_response 关着,回不回、掐不掐由应用定)。
 *   一直听的真连(2026-10-20,scripts/probe-live-vad.mjs):孩子还在说时就有 conversation.item.created(不算收下)、转写片段;speech_stopped 与 committed 同一刻,
 *   转写约 0.2 秒后到;semantic_vad 不收的一段回 error「not accepted by semantic turn detection」(走 onRejected,不是错);commit 了 300 秒没回答报 response_idle_timeout,会话死。
 *   semantic_vad 一两个词的回答(好的、Yes、Red)不报开口,嘴先问了也不报;噪声、「嗯」、笑声也不报。server_vad 短的都收,「嗯」、笑声也报(噪声不报)。
 *   服务端的规矩(2026-10-10 真连):turn_detection 的 silence_duration_ms 喂过音频就不能再改(切成 null 再切回来也回到缺省 800),
 *   type 在 null 与 vad 之间随时能切。所以跟读与聊各开一条会话(跟读手动;聊 semantic_vad 带自己的 silence),setTurn 只在不改 silence 时用。
 * 不抛:连不上、断了、服务端报错都走 onClose / onError;send 在没连上时丢弃并回 false。
 */
import { homedir } from 'node:os';
import { cotutorBailian, qianwenKeys, voxtellConfig } from '../shared/qianwen.ts';

export const REALTIME_MODEL = 'qwen3.8-omni-flash-realtime';
export const REALTIME_VOICE = 'Serena';
export const INPUT_RATE = 16000;
export const OUTPUT_RATE = 24000;
/** 服务端一帧最多 262144 字节(2026-10-19 真连:超了就 close 1009,整条连接没了);一张图的 base64 连同 JSON 的壳得在这以内 */
export const MAX_IMAGE_B64 = 262144 - 1024;
const TRANSCRIBE_MODEL = 'qwen3-asr-flash-realtime';
const HEARTBEAT_PCM = Buffer.alloc(INPUT_RATE * 2);

export type TurnMode = 'manual' | 'semantic_vad' | 'server_vad';
/** VAD 判出说完以后服务端自己做不做:回一次(create_response)、孩子开口时掐掉在出的回答(interrupt_response);缺省都做(口语课聊那段) */
export interface VadOptions { createResponse?: boolean; interruptResponse?: boolean }

export interface RealtimeOptions {
  /** 系统提示(人设 + 规矩;口语课还有口语单) */
  instructions: string;
  voice?: string;
  model?: string;
  turn?: TurnMode;
  /** VAD 判「说完了」的静音毫秒(一年级孩子想词慢,缺省比百炼的 800 长) */
  silenceMs?: number;
  /** VAD 判出说完以后服务端自己回不回、掐不掐(实时老师的一直听两样都关,由应用定) */
  vad?: VadOptions;
  /** 测试用:整个端点(含 ?model=);不给就按 workspaceId 拼 */
  endpoint?: string;
  /** 指定 key 与业务空间 id(家长端「试连」还没存的那份);不给按 dashscopeAuth 找 */
  auth?: { key: string; workspaceId: string };
  env?: NodeJS.ProcessEnv;
  /** 握手后等 session.updated 最多多久 */
  timeoutMs?: number;
}

export interface Usage { input: number; output: number; inputAudio: number; outputAudio: number }

export interface RealtimeEvents {
  /** 一块老师的声音(PCM16 24k 单声道) */
  onAudio?(pcm: Buffer): void;
  /** 老师的字:delta 一截截来,done 时给整句 */
  onTutorText?(delta: string, done: string | null): void;
  /** 孩子那句转写完了 */
  onKidText?(text: string): void;
  /** VAD:孩子开口 / 停了 */
  onSpeech?(state: 'started' | 'stopped'): void;
  /** semantic_vad 判出这一段不算一句(附和声、噪声):不会有 committed 与转写;不是错 */
  onRejected?(): void;
  /** 孩子那句 commit 了,转写失败 */
  onKidFailed?(): void;
  /** 老师一次回答开始 / 结束(status 来自服务端:completed / cancelled / incomplete / failed) */
  onResponse?(state: 'created' | 'done', status: string | null, usage: Usage | null): void;
  onError?(message: string): void;
  onClose?(reason: string): void;
}

/** 百炼按量的 key 与业务空间 id(Token Plan 没有 omni realtime;key 怎么找见 src/shared/qianwen.ts,业务空间 id 先看家长端配的、再看环境、再看 voxtell 的配置) */
export function dashscopeAuth(env: NodeJS.ProcessEnv = process.env): { key: string; workspaceId: string } | null {
  const home = env.HOME || homedir();
  const key = qianwenKeys(env).payg;
  const workspaceId = cotutorBailian(home).workspaceId || env.DASHSCOPE_WORKSPACE_ID?.trim() || voxtellConfig(home).workspaceId;
  return key && workspaceId ? { key, workspaceId } : null;
}

export const endpointOf = (workspaceId: string, model: string): string => `wss://${workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=${model}`;

/** 轮次模式 → session.turn_detection */
export function turnDetection(turn: TurnMode, silenceMs: number, vad: VadOptions = {}): Record<string, unknown> | null {
  if (turn === 'manual') return null;
  return { type: turn, threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: silenceMs, create_response: vad.createResponse ?? true, interrupt_response: vad.interruptResponse ?? true };
}

/** session.update 的正文 */
export function sessionConfig(o: { instructions: string; voice: string; turn: TurnMode; silenceMs: number; vad?: VadOptions }): Record<string, unknown> {
  return {
    modalities: ['text', 'audio'],
    instructions: o.instructions,
    voice: o.voice,
    audio: {
      input: { format: { type: 'pcm', sample_rate: INPUT_RATE, sample_format: 's16le', channels: 1 } },
      output: { voice: o.voice, format: { type: 'pcm', sample_rate: OUTPUT_RATE } },
    },
    turn_detection: turnDetection(o.turn, o.silenceMs, o.vad),
    input_audio_transcription: { model: TRANSCRIBE_MODEL },
  };
}

type ServerEvent = { type: string; [k: string]: unknown };

const usageOf = (r: unknown): Usage | null => {
  const u = (r as { usage?: Record<string, unknown> } | undefined)?.usage;
  if (!u) return null;
  const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
  const inD = (u.input_token_details ?? u.input_tokens_details) as Record<string, unknown> | undefined;
  const outD = (u.output_token_details ?? u.output_tokens_details) as Record<string, unknown> | undefined;
  return { input: n(u.input_tokens), output: n(u.output_tokens), inputAudio: n(inD?.audio_tokens), outputAudio: n(outD?.audio_tokens) };
};

export class RealtimeSession {
  readonly model: string;
  readonly voice: string;
  private ws: WebSocket | null = null;
  private ready = false;
  private closed = false;
  private turn: TurnMode;
  private readonly silenceMs: number;
  private tutorText = '';
  private pendingUpdate: { resolve: (ok: boolean) => void; timer: NodeJS.Timeout } | null = null;
  /** 正在出的回答数(response.cancel 只在有回答时发,不然服务端报错) */
  private active = 0;

  private readonly opts: RealtimeOptions;
  private readonly ev: RealtimeEvents;

  constructor(opts: RealtimeOptions, ev: RealtimeEvents = {}) {
    this.opts = opts;
    this.ev = ev;
    this.model = opts.model ?? REALTIME_MODEL;
    this.voice = opts.voice ?? REALTIME_VOICE;
    this.turn = opts.turn ?? 'manual';
    this.silenceMs = opts.silenceMs ?? 1200;
  }

  get isReady(): boolean { return this.ready && !this.closed; }
  /** 老师说到一半、还没 done 的字(挂断时记进字幕用) */
  get partialTutorText(): string { return this.tutorText; }
  get turnMode(): TurnMode { return this.turn; }
  get responding(): boolean { return this.active > 0; }

  /** 连上、配好会话;回 null 成功,否则是原因(no_auth / connect / timeout / <服务端的话>) */
  async connect(): Promise<string | null> {
    let url = this.opts.endpoint;
    let key = '';
    if (url) key = this.opts.env?.DASHSCOPE_API_KEY ?? 'sk-test';
    else {
      const auth = this.opts.auth ?? dashscopeAuth(this.opts.env);
      if (!auth) return 'no_auth';
      key = auth.key;
      url = endpointOf(auth.workspaceId, this.model);
    }
    const timeoutMs = this.opts.timeoutMs ?? 10_000;
    return new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (why: string | null): void => { if (!settled) { settled = true; clearTimeout(timer); resolve(why); } };
      const timer = setTimeout(() => { finish('timeout'); this.close('timeout'); }, timeoutMs);
      let ws: WebSocket;
      try {
        ws = new WebSocket(url, { headers: { authorization: `Bearer ${key}` } } as unknown as string[]);
      } catch (err) {
        finish(`connect:${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      this.ws = ws;
      ws.onerror = () => { finish('connect'); };
      ws.onclose = (e) => {
        this.ready = false;
        finish(`closed:${e.code}`);
        if (!this.closed) { this.closed = true; this.ev.onClose?.(`closed:${e.code}${e.reason ? ` ${e.reason}` : ''}`); }
      };
      ws.onmessage = (m) => {
        let e: ServerEvent;
        try { e = JSON.parse(String(m.data)) as ServerEvent; } catch { return; }
        if (e.type === 'session.created') { this.sendRaw({ type: 'session.update', session: sessionConfig({ instructions: this.opts.instructions, voice: this.voice, turn: this.turn, silenceMs: this.silenceMs, vad: this.opts.vad }) }); return; }
        if (e.type === 'session.updated') {
          if (!this.ready) { this.ready = true; finish(null); }
          if (this.pendingUpdate) { clearTimeout(this.pendingUpdate.timer); this.pendingUpdate.resolve(true); this.pendingUpdate = null; }
          return;
        }
        if (e.type === 'error') {
          const err = e.error as { message?: string; code?: string } | undefined;
          const msg = `${err?.code ? `${err.code}: ` : ''}${err?.message ?? JSON.stringify(e).slice(0, 200)}`;
          if (!this.ready) { finish(msg); this.close('error'); return; }
          if (this.pendingUpdate) { clearTimeout(this.pendingUpdate.timer); this.pendingUpdate.resolve(false); this.pendingUpdate = null; }
          // semantic_vad 不收的一段(2026-10-20 照 Qwen-Live-Harness:不致命,回到在听)
          if (/not accepted by semantic turn detection/i.test(err?.message ?? '')) { this.ev.onRejected?.(); return; }
          this.ev.onError?.(msg);
          // user_idle_timeout / response_idle_timeout:服务端说会话关了,连接却还开着,再发什么都没回音(2026-10-19 ray 那次挂了 10 分钟才 close),当场关
          if (err?.code?.endsWith('_idle_timeout')) this.close(`idle:${err.code}`);
          return;
        }
        this.handle(e);
      };
    });
  }

  private handle(e: ServerEvent): void {
    switch (e.type) {
      case 'response.audio.delta':
        if (typeof e.delta === 'string') this.ev.onAudio?.(Buffer.from(e.delta, 'base64'));
        break;
      case 'response.audio_transcript.delta':
      case 'response.text.delta':
        if (typeof e.delta === 'string') { this.tutorText += e.delta; this.ev.onTutorText?.(e.delta, null); }
        break;
      case 'response.audio_transcript.done':
      case 'response.text.done': {
        const whole = typeof e.transcript === 'string' ? e.transcript : typeof e.text === 'string' ? e.text : this.tutorText;
        this.tutorText = '';
        this.ev.onTutorText?.('', whole);
        break;
      }
      case 'conversation.item.input_audio_transcription.completed':
        if (typeof e.transcript === 'string') this.ev.onKidText?.(e.transcript.trim());
        break;
      case 'conversation.item.input_audio_transcription.failed': this.ev.onKidFailed?.(); break;
      case 'input_audio_buffer.speech_started': this.ev.onSpeech?.('started'); break;
      case 'input_audio_buffer.speech_stopped': this.ev.onSpeech?.('stopped'); break;
      case 'response.created': this.active++; this.ev.onResponse?.('created', null, null); break;
      case 'response.done': {
        this.active = Math.max(0, this.active - 1);
        const r = e.response as { status?: string } | undefined;
        this.ev.onResponse?.('done', r?.status ?? null, usageOf(r));
        break;
      }
      default: break;
    }
  }

  private sendRaw(msg: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** 一块孩子的声音(PCM16 16k 单声道) */
  appendAudio(pcm: Buffer): boolean { return this.isReady && this.sendRaw({ type: 'input_audio_buffer.append', audio: pcm.toString('base64') }); }
  /** 一张图(JPEG)跟着这一段声音交:百炼要先有声音再有图(Qwen-Live-Harness 也这样),commit 时一起进对话;太大(见 MAX_IMAGE_B64)不发、回 false,调用方先缩 */
  appendImage(jpeg: Buffer): boolean {
    const image = jpeg.toString('base64');
    return this.isReady && image.length <= MAX_IMAGE_B64 && this.sendRaw({ type: 'input_image_buffer.append', image });
  }
  /** 手动轮次:松手 */
  commit(): boolean { return this.isReady && this.sendRaw({ type: 'input_audio_buffer.commit' }); }
  clearAudio(): boolean { return this.isReady && this.sendRaw({ type: 'input_audio_buffer.clear' }); }
  /**
   * 心跳:1 秒全零的声音接着 clear,不 commit、不要回答(照 Qwen-Live-Harness 的静音心跳)。百炼 300 秒没输入就关会话(user_idle_timeout)。
   * 2026-10-20 真连(scripts/probe-live-idle.mjs,手动轮次,每 30 秒一次):不发的 302 秒被关;只 append 不 clear 的 300 秒报 response_idle_timeout
   * (缓冲里有输入一直没回答),会话就死了;append 完马上 clear 的过了 400 秒照常说话。
   */
  heartbeat(): boolean { return this.appendAudio(HEARTBEAT_PCM) && this.clearAudio(); }
  /** 让老师说;instructions = 只管这一次回答的指令(response.instructions,不进对话历史、不改系统提示) */
  createResponse(instructions?: string): boolean { return this.isReady && this.sendRaw({ type: 'response.create', ...(instructions ? { response: { instructions } } : {}) }); }
  /** 老师正在说就掐掉(没在说不发,服务端会报错) */
  cancel(): boolean { return this.isReady && this.active > 0 && this.sendRaw({ type: 'response.cancel' }); }
  /** 应用塞一条文字进对话(口语课跟读段「现在读这句」、切段的指令);role 缺省 user */
  addText(text: string, role: 'user' | 'system' = 'user'): boolean {
    return this.isReady && this.sendRaw({ type: 'conversation.item.create', item: { type: 'message', role, content: [{ type: 'input_text', text }] } });
  }
  /** 中途在手动与 VAD 之间切(只给 type,silence 喂过音频后改不了);等 session.updated,错或超时回 false */
  setTurn(turn: TurnMode, timeoutMs = 5000): Promise<boolean> {
    if (!this.isReady) return Promise.resolve(false);
    return new Promise((resolve) => {
      if (this.pendingUpdate) { clearTimeout(this.pendingUpdate.timer); this.pendingUpdate.resolve(false); }
      const timer = setTimeout(() => { this.pendingUpdate = null; resolve(false); }, timeoutMs);
      this.pendingUpdate = { resolve: (ok) => { if (ok) this.turn = turn; resolve(ok); }, timer };
      this.sendRaw({ type: 'session.update', session: { turn_detection: turn === 'manual' ? null : { type: turn, create_response: true, interrupt_response: true } } });
    });
  }

  close(reason = 'bye'): void {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    try { this.ws?.close(1000, reason); } catch { /* 已经断了 */ }
    this.ev.onClose?.(reason);
  }
}
