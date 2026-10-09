/**
 * paraformer 补转(《wip/小老师设想.md》拍板 7):原声先用 ffmpeg 转成 16k 单声道 PCM,再走百炼的实时识别 WebSocket(paraformer-realtime-v2),
 * 按约 4 倍速推过去,收 sentence_end 的句子(带起止毫秒和每个词的标点)。
 * key:DASHSCOPE_API_KEY 先看环境,再看本机 qwen(~/.qwen/settings.json)、voxtell(~/.config/voxtell/config.json)的配置;只在内存里用。
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { localDashscopeKey } from '../clis/qwen.ts';
import type { AsrSentence } from './lib/transcript.ts';

const URL_WS = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/';
const MODEL = 'paraformer-realtime-v2';
/** 200 毫秒一块,40 毫秒发一块 ≈ 5 倍速 */
const CHUNK = 6400;
const PACE_MS = 40;

export function dashscopeKey(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.DASHSCOPE_API_KEY) return env.DASHSCOPE_API_KEY;
  const home = env.HOME || homedir();
  const q = localDashscopeKey(home);
  if (q) return q;
  try {
    const v = JSON.parse(readFileSync(join(home, '.config', 'voxtell', 'config.json'), 'utf8')) as { apiKey?: unknown };
    return typeof v.apiKey === 'string' && v.apiKey ? v.apiKey : null;
  } catch {
    return null;
  }
}

/** 任何 ffmpeg 认得的音频 → 16k 单声道 s16le */
export function toPcm(file: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (b: Buffer) => out.push(b));
    p.stderr.on('data', (b: Buffer) => { err += b.toString(); });
    p.on('error', (e) => reject(new Error((e as NodeJS.ErrnoException).code === 'ENOENT' ? '没有 ffmpeg(brew install ffmpeg)' : e.message)));
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg 转不了这段原声:${err.trim().slice(0, 200)}`))));
  });
}

interface WsMsg {
  header: { event?: string; error_code?: string; error_message?: string };
  payload?: { output?: { sentence?: { begin_time: number; end_time: number; text: string; sentence_end?: boolean; words?: { begin_time: number; end_time: number; text: string; punctuation: string }[] } } };
}

/** 一段 PCM → paraformer 的句子;timeoutMs 内没收完就报错 */
export function recognizePcm(pcm: Buffer, key: string, opts: { url?: string; timeoutMs?: number } = {}): Promise<AsrSentence[]> {
  const id = randomUUID().replace(/-/g, '');
  const timeoutMs = opts.timeoutMs ?? 60_000 + Math.round((pcm.length / 32_000) * 1000 * 0.5);
  return new Promise((resolve, reject) => {
    const out: AsrSentence[] = [];
    let settled = false;
    const ws = new WebSocket(opts.url ?? URL_WS, { headers: { Authorization: `bearer ${key}` } } as unknown as string[]);
    const finish = (err: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* 已经关了 */ }
      if (err) reject(err);
      else resolve(out);
    };
    const timer = setTimeout(() => finish(new Error(`paraformer 超时(${Math.round(timeoutMs / 1000)} 秒)`)), timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ header: { action: 'run-task', task_id: id, streaming: 'duplex' }, payload: { task_group: 'audio', task: 'asr', function: 'recognition', model: MODEL, parameters: { format: 'pcm', sample_rate: 16000 }, input: {} } }));
    ws.onerror = () => finish(new Error('连不上百炼的识别服务'));
    ws.onclose = () => finish(settled ? null : new Error('识别服务断开了'));
    ws.onmessage = (e) => {
      let m: WsMsg;
      try { m = JSON.parse(String(e.data)) as WsMsg; } catch { return; }
      const ev = m.header.event;
      if (ev === 'task-started') {
        void (async () => {
          for (let i = 0; i < pcm.length && !settled; i += CHUNK) {
            ws.send(pcm.subarray(i, i + CHUNK));
            await new Promise((r) => setTimeout(r, PACE_MS));
          }
          if (!settled) ws.send(JSON.stringify({ header: { action: 'finish-task', task_id: id, streaming: 'duplex' }, payload: { input: {} } }));
        })();
      } else if (ev === 'result-generated') {
        const s = m.payload?.output?.sentence;
        if (s?.sentence_end) out.push({ begin: s.begin_time, end: s.end_time, text: s.text, words: (s.words ?? []).map((w) => ({ begin: w.begin_time, end: w.end_time, text: w.text, punctuation: w.punctuation ?? '' })) });
      } else if (ev === 'task-finished') finish(null);
      else if (ev === 'task-failed') finish(new Error(`paraformer 出错:${m.header.error_code ?? ''} ${m.header.error_message ?? ''}`.trim()));
    };
  });
}

/** 一个音频文件 → 句子(补转的默认实现;测试换成假的) */
export async function transcribeFile(file: string, env: NodeJS.ProcessEnv = process.env): Promise<AsrSentence[]> {
  const key = dashscopeKey(env);
  if (!key) throw new Error('拿不到百炼 key(DASHSCOPE_API_KEY,或本机 qwen / voxtell 的配置)');
  return recognizePcm(await toPcm(file), key);
}
