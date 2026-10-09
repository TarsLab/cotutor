/**
 * 按住说话的原声交给 qwen omni 听写(2026-10-09 起试,cotutor.json 的 kid.listen: omni)。
 * 浏览器的识别照样边听边出字;松手后孩子端把原声 POST /api/kid/listen,这里交给百炼的 omni 听一遍,回它听出的字,孩子端发这个。
 * 同日实测(ray 的 12 段真录音):每段 0.4–0.9 秒;「是否」听成「四 four」、「三个Siri」听成「三个 three」、「嗯,腿的英语」听成「鸡腿的英语」;
 * 带上老师刚问的那句听法不变,所以不带;静音、噪声回 <无>。webm / m4a / ogg / wav 原样交,不用转码。
 * key 与 qwen 老师同一份(环境变量 DASHSCOPE_API_KEY,没有就读本机 ~/.qwen/settings.json 的 env),只进请求头。
 */
import { homedir } from 'node:os';
import { localDashscopeKey } from '../clis/qwen.ts';

export const LISTEN_MODEL = 'qwen3.5-omni-flash';
/** 孩子松手后最多等这么久;过了孩子端就发浏览器认的字 */
export const LISTEN_TIMEOUT_MS = 8000;
const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
/** 没人说话时模型回的记号(让它回「空格」它会真写「空格」两个字) */
const NOTHING = '<无>';
const SYSTEM = `你是语音转写器。用户给你一段孩子按住说话的录音,你只把孩子说的话逐字写成文字:不回答、不解释、不加引号;中文里夹的英文照写英文;口头禅照写。录音里没有人说话(静音、噪声、听不出字)就只回 ${NOTHING}。`;

export type Listened = { ok: true; text: string; model: string; ms: number } | { ok: false; error: string; ms: number };
export type Transcribe = (audio: { data: Buffer; ext: string }) => Promise<Listened>;

/** 听写一段原声;出错、超时都不抛,回 {ok: false} */
export async function listenOmni(audio: { data: Buffer; ext: string }, opts: { env?: NodeJS.ProcessEnv; endpoint?: string; model?: string; timeoutMs?: number } = {}): Promise<Listened> {
  const env = opts.env ?? process.env;
  const t0 = Date.now();
  const ms = (): number => Date.now() - t0;
  const key = env.DASHSCOPE_API_KEY?.trim() || localDashscopeKey(env.HOME || homedir());
  if (!key) return { ok: false, error: 'no_key', ms: ms() };
  const model = opts.model ?? LISTEN_MODEL;
  const body = {
    model,
    stream: true,
    modalities: ['text'],
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:;base64,${audio.data.toString('base64')}`, format: audio.ext } }] },
    ],
  };
  try {
    const res = await fetch(opts.endpoint ?? ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? LISTEN_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}`, ms: ms() };
    const text = readStream(await res.text());
    if (text === null) return { ok: false, error: 'bad_reply', ms: ms() };
    return { ok: true, text: tidy(text), model, ms: ms() };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network', ms: ms() };
  }
}

/** 兼容接口的流(data: {...} 一行一块):拼出 delta.content;流里报错 → null */
export function readStream(raw: string): string | null {
  let out = '';
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('data:') || s === 'data: [DONE]') continue;
    try {
      const e = JSON.parse(s.slice(5)) as { error?: unknown; choices?: { delta?: { content?: unknown } }[] };
      if (e.error) return null;
      for (const c of e.choices ?? []) if (typeof c.delta?.content === 'string') out += c.delta.content;
    } catch {
      return null;
    }
  }
  return out;
}

/** 去掉「没人说话」的记号与首尾空白、引号;只剩标点也当没听出字 */
export function tidy(text: string): string {
  const t = text.replaceAll(NOTHING, '').trim().replace(/^["“「]|["”」]$/g, '').trim();
  return /^[\s，。！？、,.!?…]*$/.test(t) ? '' : t;
}
