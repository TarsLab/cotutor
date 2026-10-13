/**
 * 交给百炼文生图(同步接口 multimodal-generation)画一张,拿回 PNG。百炼给的图片地址 24 小时就过期,拿到就下载。
 * key 与 qwen 老师同一份(环境变量 DASHSCOPE_API_KEY,没有就读本机 ~/.qwen/settings.json 的 env),只进请求头。出错、超时都不抛。
 * 2026-10-11 实测:qwen-image-2.0 一张 4 秒、qwen-image-2.0-pro 15 秒(1536*1536);公网域名能用,不用业务空间的域名。
 */
import { homedir } from 'node:os';
import { localDashscopeKey } from '../clis/qwen.ts';
import { PAINT_NEGATIVE } from './prompt.ts';

const ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
export const DRAW_TIMEOUT_MS = 180_000;

export type Drawn = ({ ok: true; data: Buffer; model: string } | { ok: false; error: string }) & { ms: number };
/** 画一张:提示词、模型、尺寸、反向提示词(缺省 PAINT_NEGATIVE)→ PNG(测试与 mock 注入假的) */
export type Draw = (job: { prompt: string; model: string; size: string; negative?: string }) => Promise<Drawn>;

interface GenerationReply {
  code?: string;
  message?: string;
  output?: { choices?: { message?: { content?: { image?: string }[] } }[] };
}

export function makeDraw(opts: { env?: NodeJS.ProcessEnv; endpoint?: string; timeoutMs?: number } = {}): Draw {
  return async ({ prompt, model, size, negative }) => {
    const env = opts.env ?? process.env;
    const t0 = Date.now();
    const fail = (error: string): Drawn => ({ ok: false, error, ms: Date.now() - t0 });
    const key = env.DASHSCOPE_API_KEY?.trim() || localDashscopeKey(env.HOME || homedir());
    if (!key) return fail('no_key');
    const signal = AbortSignal.timeout(opts.timeoutMs ?? DRAW_TIMEOUT_MS);
    try {
      const res = await fetch(opts.endpoint ?? ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: { messages: [{ role: 'user', content: [{ text: prompt }] }] }, parameters: { size, n: 1, prompt_extend: false, watermark: false, negative_prompt: negative || PAINT_NEGATIVE } }),
        signal,
      });
      const j = (await res.json().catch(() => ({}))) as GenerationReply;
      // 内容审核没过是 400 + DataInspectionFailed:原样记下,家长端看得到
      if (!res.ok) return fail(`http_${res.status}${j.code ? `:${j.code}` : ''}`);
      const url = j.output?.choices?.[0]?.message?.content?.find((c) => typeof c.image === 'string')?.image;
      if (!url) return fail(j.code ? `no_image:${j.code}` : 'no_image');
      const img = await fetch(url, { signal });
      if (!img.ok) return fail(`download_${img.status}`);
      const data = Buffer.from(await img.arrayBuffer());
      if (data.length < 8 || data.readUInt32BE(0) !== 0x89504e47) return fail('not_png');
      return { ok: true, data, model, ms: Date.now() - t0 };
    } catch (err) {
      return fail(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network');
    }
  };
}
