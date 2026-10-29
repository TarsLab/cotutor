/**
 * 看一张图(百炼 Chat Completions 的流式接口:一张图 + 一段提示词)。从 app/talk/list.ts、app/dictation/recognize.ts 拆出来(2026-10-29,行为不变):
 * key 与端点按模型定(src/shared/qianwen.ts:Token Plan 有这个模型就走它,否则百炼按量),key 只进请求头;出错、超时都不抛。
 * 两种读法:
 * - 不给 onDelta:整段收完再拼(readStream),流里有一块报错就算没成(bad_reply)。口语单这样读
 * - 给 onDelta:一块一块交出去(拍照认词要边认边出),读不懂的行跳过
 * 怎么写提示词、回的字怎么解析是场景的事(scenes/),这里只管请求。
 */
import { chatUrl, qianwenKeys, qianwenLine, readStream } from '../shared/qianwen.ts';

export type Seen = { ok: true; text: string; ms: number } | { ok: false; error: string; ms: number };

export interface LookAt {
  image: { data: Buffer; mime: string };
  prompt: string;
  model: string;
  /** 请求体里多带的(modalities、reasoning_effort、temperature、enable_thinking…) */
  params?: Record<string, unknown>;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  /** 测试与探针:假的接口地址 */
  endpoint?: string;
  onDelta?: (text: string) => void;
}

/** 兼容接口的流(data: {...} 一行一块)里的一块 → delta.content;不是内容块 → '' */
function deltaOf(line: string): string {
  const s = line.trim();
  if (!s.startsWith('data:') || s === 'data: [DONE]') return '';
  try {
    const j = JSON.parse(s.slice(5)) as { choices?: { delta?: { content?: unknown } }[] };
    const c = j.choices?.[0]?.delta?.content;
    return typeof c === 'string' ? c : '';
  } catch {
    return '';
  }
}

export async function lookAt(o: LookAt): Promise<Seen> {
  const env = o.env ?? process.env;
  const t0 = Date.now();
  const fail = (error: string): Seen => ({ ok: false, error, ms: Date.now() - t0 });
  const line = qianwenLine(o.model, qianwenKeys(env));
  if (!line) return fail('no_key');
  try {
    const res = await fetch(o.endpoint ?? chatUrl(line.host), {
      method: 'POST',
      headers: { authorization: `Bearer ${line.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: o.model, stream: true, ...o.params, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${o.image.mime};base64,${o.image.data.toString('base64')}` } }, { type: 'text', text: o.prompt }] }] }),
      signal: AbortSignal.timeout(o.timeoutMs),
    });
    if (o.onDelta) {
      if (!res.ok || !res.body) return fail(`http_${res.status}`);
      const dec = new TextDecoder();
      let sse = '';
      let text = '';
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        sse += dec.decode(chunk, { stream: true });
        let i: number;
        while ((i = sse.indexOf('\n')) >= 0) {
          const d = deltaOf(sse.slice(0, i));
          sse = sse.slice(i + 1);
          if (d) { text += d; o.onDelta(d); }
        }
      }
      const d = deltaOf(sse);
      text += d;
      o.onDelta(d);
      return { ok: true, text, ms: Date.now() - t0 };
    }
    if (!res.ok) return fail(`http_${res.status}`);
    const text = readStream(await res.text());
    if (text === null) return fail('bad_reply');
    return { ok: true, text, ms: Date.now() - t0 };
  } catch (err) {
    return fail(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network');
  }
}
