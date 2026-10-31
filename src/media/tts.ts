/**
 * 配音:卡自己的声音(点读段、单词、听写念的词)与音色页的试听;讲稿不配音,由实时的嘴照念。
 * 百炼 Qwen-Audio-TTS 的非实时合成(2026-10-31 从 voxtell 并进来,不再起子进程):POST 回一个 24 小时有效的音频地址,马上下载。
 * 走哪条线按模型定(src/shared/qianwen.ts):Token Plan 有这个模型就走它;否则百炼按量,端点是业务空间的域名(voxtell 2026-08-07 实测,公网域名不认)。
 * 模型看音色 id 的前缀(qwen-audio-3.0-tts-plus-xxx / -flash-xxx,flash 的音色给 plus 回 400);没前缀的老短名走 TTS_MODEL。
 * 缓存:按「模型 + 音色 + 字 + 格式」寻址,放在调用方给的目录(workspace 的 .cotutor/tts/);同一句同一个音色合成过就直接给那个文件,不再花钱。
 * 失败不抛、不响:结果带原因(不含 key),调用方写进 err.log 或回给家长端;孩子端点了不出声。
 * 测试与探针:COTUTOR_TTS_ENDPOINT 指到假百炼(tests/_fake-tts.ts)。
 */
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bailianWorkspaceId, qianwenKeys, qianwenLine, ttsUrl, workspaceHost } from '../shared/qianwen.ts';

export { TTS_VOICES, type TtsVoice } from './tts-voices.ts';

/** 音色 id 不带模型前缀时用的合成模型 */
export const TTS_MODEL = 'qwen-audio-3.0-tts-plus';
const FORMAT = 'mp3';
const SAMPLE_RATE = 24000;
/** 网络错、5xx、429 最多试几次(间隔 1.5 秒、3 秒);参数与鉴权错不重试 */
const ATTEMPTS = 3;

export interface TtsResult {
  /** 成功 → 音频文件路径(给了 out 就是 out,不然是缓存里那份);失败 → null */
  file: string | null;
  error: string | null;
}

export interface TtsOptions {
  /** 缓存目录(workspace 的 dirs.tts) */
  cacheDir: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/** 音色 id 的前缀就是模型 */
export function ttsModelOf(voice: string): string {
  return /^(qwen-audio-[\d.]+-tts-[a-z]+)-/.exec(voice)?.[1] ?? TTS_MODEL;
}

/** 这个模型发到哪、带哪把 key;两把 key 都用不上、按量又没有业务空间 id → 原因 */
export function ttsTarget(model: string, env: NodeJS.ProcessEnv = process.env): { url: string; key: string; plan: boolean } | { error: string } {
  const line = qianwenLine(model, qianwenKeys(env));
  const fake = env.COTUTOR_TTS_ENDPOINT?.trim();
  if (fake) return { url: fake, key: line?.key ?? 'sk-test', plan: false };
  if (!line) return { error: '没有百炼的 key(家长端「首页」里填)' };
  if (line.plan) return { url: ttsUrl(line.host), key: line.key, plan: true };
  const ws = bailianWorkspaceId(env);
  if (!ws) return { error: '按量的配音要百炼的业务空间 id(家长端「首页」里填)' };
  return { url: ttsUrl(workspaceHost(ws)), key: line.key, plan: false };
}

/** 同一个文件正在合成:后来的等它,不再花一次钱 */
const inflight = new Map<string, Promise<TtsResult>>();

/** 合成一句;给了 out 就把音频放到那里(缓存里留一份) */
export async function synthesize(say: { text: string; voice: string; out?: string }, opts: TtsOptions): Promise<TtsResult> {
  const model = ttsModelOf(say.voice);
  const key = createHash('sha256').update(JSON.stringify({ format: FORMAT, model, sampleRate: SAMPLE_RATE, text: say.text, voice: say.voice })).digest('hex');
  const cached = join(opts.cacheDir, `${key.slice(0, 24)}.${FORMAT}`);
  let r: TtsResult;
  if ((await stat(cached).catch(() => null))?.size) r = { file: cached, error: null };
  else {
    let p = inflight.get(cached);
    if (!p) {
      p = fetchAudio(model, say, cached, opts).finally(() => inflight.delete(cached));
      inflight.set(cached, p);
    }
    r = await p;
  }
  if (!r.file || !say.out) return r;
  try {
    await copyFile(r.file, say.out);
    return { file: say.out, error: null };
  } catch (err) {
    return { file: null, error: `合成好了但放不到 ${say.out}:${err instanceof Error ? err.message : String(err)}` };
  }
}

interface TtsReply {
  request_id?: string;
  code?: string;
  message?: string;
  output?: { audio?: { url?: string } };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function fetchAudio(model: string, say: { text: string; voice: string }, file: string, opts: TtsOptions): Promise<TtsResult> {
  const fail = (error: string): TtsResult => ({ file: null, error });
  const target = ttsTarget(model, opts.env ?? process.env);
  if ('error' in target) return fail(target.error);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  let last = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(1500 * (attempt - 1));
    try {
      const res = await fetch(target.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${target.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: { text: say.text, voice: say.voice, format: FORMAT, sample_rate: SAMPLE_RATE } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await res.text();
      let j: TtsReply = {};
      try {
        j = JSON.parse(raw) as TtsReply;
      } catch {
        /* 不是 JSON:按状态码说 */
      }
      const detail = `${j.code ?? ''} ${j.message ?? raw.slice(0, 200)}`.trim();
      if (res.status === 401 || res.status === 403) return fail(`百炼不认这把 key(HTTP ${res.status}:${detail});看家长端「首页」里填的 key${target.plan ? '' : '与业务空间'},业务空间要开通 ${model}`);
      if (res.status === 429 || res.status >= 500) {
        last = `百炼${res.status === 429 ? '限流或额度不够' : '出错'}(HTTP ${res.status}:${detail})`;
        continue;
      }
      if (!res.ok) return fail(`合成被拒(HTTP ${res.status}:${detail});核对音色 ${say.voice} 和字`);
      const url = j.output?.audio?.url;
      if (!url) return fail(`百炼没给音频地址(request_id ${j.request_id ?? '?'})`);
      const audio = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!audio.ok) {
        last = `下载音频失败(HTTP ${audio.status})`;
        continue;
      }
      const bytes = Buffer.from(await audio.arrayBuffer());
      if (!bytes.length) return fail('百炼给的音频是空的');
      // 先写到旁边再改名:缓存里只有整份(别的请求看见就能直接给)
      await mkdir(opts.cacheDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, file);
      return { file, error: null };
    } catch (err) {
      last = err instanceof Error && err.name === 'TimeoutError' ? `等了 ${timeoutMs / 1000} 秒没合成完` : `连不上百炼:${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return fail(last);
}

/**
 * 一轮的配音队列:卡自己的声音(点读段、单词),三个并行,先进先出。
 * 每个文件一项;失败写 err.log、结果 null。
 */
export class DubQueue {
  private readonly queue: (() => Promise<void>)[] = [];
  private running = 0;
  private readonly voice: string;
  private readonly err: string;
  private readonly opts: TtsOptions;
  /** 每条的进展(排队 / 完成 / 失败)报给谁:runner 把它变成 tts 道的事件 */
  report?: (e: { kind: 'queued' | 'done' | 'failed'; label: string; ms: number; file?: string; error?: string }) => void;
  constructor(voice: string, err: string, opts: TtsOptions) {
    this.voice = voice;
    this.err = err;
    this.opts = opts;
  }

  /** 合成 text 到 out;resolve 成文件名(最后一段)或 null;label 是 err.log 里的称呼 */
  add(out: string, text: string, label: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.report?.({ kind: 'queued', label, ms: 0 });
      const t0 = Date.now();
      this.queue.push(async () => {
        const r = await synthesize({ text, voice: this.voice, out }, this.opts);
        if (r.error) await appendFile(this.err, `cotutor tts: ${label}没合成(${r.error});这段不出声\n`).catch(() => {});
        const file = out.slice(out.lastIndexOf('/') + 1);
        if (r.error) this.report?.({ kind: 'failed', label, ms: Date.now() - t0, error: r.error });
        else this.report?.({ kind: 'done', label, ms: Date.now() - t0, file });
        resolve(r.error ? null : file);
      });
      this.pump();
    });
  }

  private pump(): void {
    while (this.running < 3 && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void job().finally(() => {
        this.running--;
        this.pump();
      });
    }
  }
}
