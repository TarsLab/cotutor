/**
 * 配音:听写念的词、课包配音、点读课文与家长端的试听;讲稿不配音,由实时的嘴照念。
 * 百炼 Qwen-Audio-TTS 的非实时合成:POST 回一个 24 小时有效的音频地址,马上下载。
 * 走哪条线按模型定(src/shared/qianwen.ts):Token Plan 有这个模型就走它;否则百炼按量,端点是业务空间的域名(2026-08-07 实测,公网域名不认)。
 * 模型:id 带前缀的看前缀(以前选的 3.0 基础音色 qwen-audio-3.0-tts-plus-xxx;flash 的音色给 plus 回 400);3.1 的 id 不带前缀,照音色表(tts-voices.ts)的 model;
 * 都不是的老短名走 TTS_MODEL。
 * 点读课文整篇一次合成、要每个字的时间(synthesizeTimed):同一个接口开 SSE(X-DashScope-SSE: enable)加 word_timestamp_enabled,
 * 声音一块一块(base64)、字的时间在 output.sentence.words 里;时间戳只有流式给(非流式不给,WebSocket 也给但要另写一套任务协议)。
 * 2026-11-25 实测:3.0-plus 的基础音色、3.1-plus 龙安灵心都回字级时间戳;《坐井观天》整篇 199 字 SSE 10.9 秒收完;一次最多多少字文档没写。
 * 缓存:按「模型 + 音色 + 字 + 格式(+ 语气)」寻址,放在调用方给的目录(workspace 的 .cotutor/tts/);同一句同一个音色合成过就直接给那个文件,不再花钱。
 * 语气(instruction)只有课包配音用(cotutor chalk dub --instruction),别的不带。
 * 失败不抛、不响:结果带原因(不含 key),调用方写进 err.log 或回给家长端;孩子端点了不出声。
 * 测试与探针:COTUTOR_TTS_ENDPOINT 指到假百炼(tests/_fake-tts.ts)。
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bailianWorkspaceId, qianwenKeys, qianwenLine, ttsUrl, workspaceHost } from '../shared/qianwen.ts';

import { TTS_VOICES } from './tts-voices.ts';

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

const MODEL_OF = new Map(TTS_VOICES.map((v) => [v.voice, v.model]));

/** 音色 id 的前缀就是模型;没前缀的照音色表 */
export function ttsModelOf(voice: string): string {
  return /^(qwen-audio-[\d.]+-tts-[a-z]+)-/.exec(voice)?.[1] ?? MODEL_OF.get(voice) ?? TTS_MODEL;
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

/** 一句要合成的:字、音色、语气;给了 out 就把音频放到那里(缓存里留一份) */
export interface Say {
  text: string;
  voice: string;
  instruction?: string;
  out?: string;
}

/** 合成一句 */
export async function synthesize(say: Say, opts: TtsOptions): Promise<TtsResult> {
  const model = ttsModelOf(say.voice);
  const key = createHash('sha256').update(JSON.stringify({ format: FORMAT, ...(say.instruction ? { instruction: say.instruction } : {}), model, sampleRate: SAMPLE_RATE, text: say.text, voice: say.voice })).digest('hex');
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

async function fetchAudio(model: string, say: Say, file: string, opts: TtsOptions): Promise<TtsResult> {
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
        body: JSON.stringify({ model, input: { text: say.text, voice: say.voice, format: FORMAT, sample_rate: SAMPLE_RATE, ...(say.instruction ? { instruction: say.instruction } : {}) } }),
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

/** 一个字(标点粘在后一个字前面:「。我」)在声音里从第几毫秒到第几毫秒 */
export interface TtsWord { text: string; begin_time: number; end_time: number }
export interface TimedResult { file: string | null; words: TtsWord[]; error: string | null }

const timedInflight = new Map<string, Promise<TimedResult>>();

/**
 * 合成一大段(点读整篇课文)并要每个字的时间:缓存 <key>.mp3 + <key>.words.json,同一段同一个音色只合成一次。
 * 失败不抛,结果带原因
 */
export async function synthesizeTimed(say: { text: string; voice: string }, opts: TtsOptions): Promise<TimedResult> {
  const model = ttsModelOf(say.voice);
  const key = createHash('sha256').update(JSON.stringify({ format: FORMAT, model, sampleRate: SAMPLE_RATE, text: say.text, voice: say.voice, words: true })).digest('hex').slice(0, 24);
  const audio = join(opts.cacheDir, `${key}.${FORMAT}`), meta = join(opts.cacheDir, `${key}.words.json`);
  const had = await readFile(meta, 'utf8').then((t) => JSON.parse(t) as TtsWord[]).catch(() => null);
  if (had && (await stat(audio).catch(() => null))?.size) return { file: audio, words: had, error: null };
  let p = timedInflight.get(key);
  if (!p) {
    p = fetchTimed(model, say, audio, meta, opts).finally(() => timedInflight.delete(key));
    timedInflight.set(key, p);
  }
  return p;
}

interface SseEvent {
  code?: string;
  message?: string;
  output?: { audio?: { data?: string }; sentence?: { index?: number; words?: (TtsWord & { begin_index?: number })[] } };
}

async function fetchTimed(model: string, say: { text: string; voice: string }, file: string, meta: string, opts: TtsOptions): Promise<TimedResult> {
  const fail = (error: string): TimedResult => ({ file: null, words: [], error });
  const target = ttsTarget(model, opts.env ?? process.env);
  if ('error' in target) return fail(target.error);
  const timeoutMs = opts.timeoutMs ?? 180_000;
  let last = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(1500 * (attempt - 1));
    try {
      const res = await fetch(target.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${target.key}`, 'content-type': 'application/json', 'X-DashScope-SSE': 'enable' },
        body: JSON.stringify({ model, input: { text: say.text, voice: say.voice, format: FORMAT, sample_rate: SAMPLE_RATE, word_timestamp_enabled: true } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await res.text();
      if (!res.ok) {
        let j: SseEvent = {};
        try { j = JSON.parse(raw) as SseEvent; } catch { /* 不是 JSON */ }
        const detail = `${j.code ?? ''} ${j.message ?? raw.slice(0, 200)}`.trim();
        if (res.status === 401 || res.status === 403) return fail(`百炼不认这把 key(HTTP ${res.status}:${detail});业务空间要开通 ${model}`);
        if (res.status === 429 || res.status >= 500) { last = `百炼${res.status === 429 ? '限流或额度不够' : '出错'}(HTTP ${res.status}:${detail})`; continue; }
        return fail(`合成被拒(HTTP ${res.status}:${detail});核对音色 ${say.voice} 和字`);
      }
      // 一行 data: {...} 一个事件;字的时间同一句会重发(句末带全),按句号 + 起始位置去重、留先来的顺序
      const chunks: Buffer[] = [];
      const words = new Map<string, TtsWord>();
      let bad = '';
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data:')) continue;
        let e: SseEvent;
        try { e = JSON.parse(line.slice(5)) as SseEvent; } catch { continue; }
        if (e.code) bad = `${e.code} ${e.message ?? ''}`.trim();
        if (e.output?.audio?.data) chunks.push(Buffer.from(e.output.audio.data, 'base64'));
        const sent = e.output?.sentence;
        for (const w of sent?.words ?? []) {
          const k = `${sent?.index ?? 0}.${w.begin_index ?? w.begin_time}`;
          if (!words.has(k)) words.set(k, { text: w.text, begin_time: w.begin_time, end_time: w.end_time });
        }
      }
      const bytes = Buffer.concat(chunks);
      if (bad && !bytes.length) return fail(`合成被拒(${bad})`);
      if (!bytes.length) return fail('百炼给的音频是空的');
      await mkdir(opts.cacheDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, file);
      await writeFile(`${meta}.${process.pid}.tmp`, JSON.stringify([...words.values()]));
      await rename(`${meta}.${process.pid}.tmp`, meta);
      return { file, words: [...words.values()], error: null };
    } catch (err) {
      last = err instanceof Error && err.name === 'TimeoutError' ? `等了 ${timeoutMs / 1000} 秒没合成完` : `连不上百炼:${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return fail(last);
}
