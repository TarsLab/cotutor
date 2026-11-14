/**
 * 千问的两套账:千问 AI 平台的 Token Plan(`sk-sp-`,只认 token-plan 域名,按订阅 Credits 抵)
 * 与百炼按量(`sk-` / `sk-ws-`,dashscope 域名)。两把 key 互不通用。
 * 一条线调哪个模型:Token Plan 有这个模型、本机又有它的 key 就走 Token Plan,否则走按量(2026-10-13 定)。key 只进请求头。
 * key 只放机器级的 ~/.config/cotutor/(2026-11-02 起,所有命令读同一处;环境变量、本机 qwen、voxtell 的配置都不看):
 * - bailian.json:百炼按量 key + 业务空间 id,家长端「首页」写(src/app/machine/bailian.ts),每台都要有;
 * - token-plan.json:Token Plan 的 key,只有开发机有,手写;文件在就是开关。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const TOKEN_PLAN_HOST = 'token-plan.maas.qianwenaiapi.com';
export const DASHSCOPE_HOST = 'dashscope.aliyuncs.com';

/**
 * Token Plan 个人版调得通的模型(2026-10-13:文档表、token-plan 的 /models、实测三处对过)。
 * 没有 omni 系列、qwen-image-2.0、qwen-plus
 */
export const TOKEN_PLAN_MODELS: ReadonlySet<string> = new Set([
  'qwen3.8-max',
  'qwen3.8-flash',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.6-flash',
  'qwen-audio-3.0-tts-plus',
  'qwen-audio-3.0-realtime-plus',
  'qwen-audio-3.0-asr-flash',
  'qwen-image-3.0-pro',
  'wan2.7-image',
  'wan2.7-image-pro',
]);

export const isPlanKey = (key: string): boolean => key.startsWith('sk-sp-');

export interface QianwenKeys {
  /** Token Plan 的 key(`sk-sp-`) */
  plan: string | null;
  /** 百炼按量的 key */
  payg: string | null;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** 家长端配的百炼(机器级,几个孩子的 workspace 共用;写在 src/app/machine/bailian.ts):按量 key 与业务空间 id */
export const bailianFile = (home = homedir()): string => join(home, '.config', 'cotutor', 'bailian.json');
export function cotutorBailian(home = homedir()): { apiKey: string | null; workspaceId: string | null } {
  const v = readJson(bailianFile(home));
  return { apiKey: text(v?.apiKey), workspaceId: text(v?.workspaceId) };
}

/** 开发机的 Token Plan:{"apiKey": "sk-sp-…"},手写;家长端存 bailian.json 是整份重写,所以不和它放一起 */
export const tokenPlanFile = (home = homedir()): string => join(home, '.config', 'cotutor', 'token-plan.json');
export const tokenPlanKey = (home = homedir()): string | null => text(readJson(tokenPlanFile(home))?.apiKey);

/** 百炼的业务空间 id(按量的 realtime、配音走它的域名) */
export function bailianWorkspaceId(env: NodeJS.ProcessEnv = process.env): string | null {
  return cotutorBailian(env.HOME || homedir()).workspaceId;
}

/** 业务空间的域名(北京地域);公网域名连 realtime 1 秒就断、配音不认 */
export const workspaceHost = (workspaceId: string): string => `${workspaceId}.cn-beijing.maas.aliyuncs.com`;

/** 百炼报错按错误码分几类(官方错误码表);表里没有的算 other。家长端的说法在 src/app/machine/bailian.ts */
export type TroubleKind = 'key' | 'money' | 'space' | 'network' | 'other';
export function troubleKind(why: string): TroubleKind {
  if (/InvalidApiKey|invalid_api_key|\b401\b/i.test(why)) return 'key';
  if (/Arrearage|BillOverdue|AllocationQuota|CommodityNotPurchased|Unpurchased|insufficient_quota/i.test(why)) return 'money';
  if (/AccessDenied|\b403\b/i.test(why)) return 'space';
  if (/^network$|^timeout$|请求或流断了/.test(why)) return 'network';
  return 'other';
}
/** 这几类等不好,要家长动手(换 key、充钱、核对业务空间) */
export const needsParent = (kind: TroubleKind): boolean => kind === 'key' || kind === 'money' || kind === 'space';

/**
 * Token Plan 拒了(订阅到期、Credits 用完、key 失效;2026-11-14 开发机上整天 403 AccessDenied.Unpurchased,老师一句没回):
 * 本进程一小时内不再走它,全走按量;过了一小时再试(续上了就回来),重起 serve 也回来。
 */
const PLAN_DOWN_MS = 3600_000;
let planDownUntil = 0;
/** Token Plan 这次的错算不算「拒了」(要换线的那几类);限流、断流不算 */
export const planRefusal = (status: number, body: string): boolean => (status === 401 || status === 403 || status === 429) && needsParent(troubleKind(`${status} ${body}`));
export function refusePlan(why: string, now = Date.now()): void {
  if (now >= planDownUntil) console.warn(`cotutor: Token Plan 拒了(${why.slice(0, 120)}),这一小时改走百炼按量`);
  planDownUntil = now + PLAN_DOWN_MS;
}
export const planDown = (now = Date.now()): boolean => now < planDownUntil;
/** 测试用:当作 Token Plan 没拒过 */
export function resetPlanDown(): void { planDownUntil = 0; }

/** 本机的两把 key(env 只取 HOME,测试拿它指别的家);放错了套(bailian.json 里放了 `sk-sp-`)就挪到对的那格;Token Plan 刚拒过就当没有它 */
export function qianwenKeys(env: NodeJS.ProcessEnv = process.env): QianwenKeys {
  const home = env.HOME || homedir();
  const plan = planDown() ? null : tokenPlanKey(home);
  const payg = cotutorBailian(home).apiKey;
  return {
    plan: plan && isPlanKey(plan) ? plan : !planDown() && payg && isPlanKey(payg) ? payg : null,
    payg: payg && !isPlanKey(payg) ? payg : null,
  };
}

export interface QianwenLine {
  /** 域名(不带协议):https 与 wss 都是它 */
  host: string;
  key: string;
  /** 走的是 Token Plan */
  plan: boolean;
}

/** 这个模型走哪条线;两把 key 都用不上 → null */
export function qianwenLine(model: string, keys: QianwenKeys): QianwenLine | null {
  if (keys.plan && TOKEN_PLAN_MODELS.has(model)) return { host: TOKEN_PLAN_HOST, key: keys.plan, plan: true };
  if (keys.payg) return { host: DASHSCOPE_HOST, key: keys.payg, plan: false };
  return null;
}

/** 几种接口的地址 */
export const chatUrl = (host: string): string => `https://${host}/compatible-mode/v1/chat/completions`;
export const compatibleBase = (host: string): string => `https://${host}/compatible-mode/v1`;

/**
 * 兼容接口(老师的脑,src/brain/api.ts)这个模型发到哪:Token Plan 有它、本机有 token-plan.json 就走 Token Plan(2026-11-02 起,同配音、画图);
 * 否则百炼按量,知道业务空间 id 走它的域名,不知道走公网域名
 */
export function compatibleLine(model: string, env: NodeJS.ProcessEnv = process.env): { baseURL: string; key: string; plan: boolean } | null {
  const line = qianwenLine(model, qianwenKeys(env));
  if (!line) return null;
  if (line.plan) return { baseURL: compatibleBase(line.host), key: line.key, plan: true };
  const ws = bailianWorkspaceId(env);
  return { baseURL: compatibleBase(ws ? workspaceHost(ws) : line.host), key: line.key, plan: false };
}
/**
 * 兼容接口的 fetch:走 Token Plan 时它拒了(planRefusal)就记下(refusePlan),同一个请求改发按量那条线(again 给;没有按量 key 就照原样回)。
 * 拒的时候还没流出一个字,换线重发孩子听不出来
 */
export function planFallbackFetch(from: string, again: () => { baseURL: string; key: string; plan: boolean } | null, base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    if (res.ok) return res;
    const body = await res.clone().text().catch(() => '');
    if (!planRefusal(res.status, body)) return res;
    refusePlan(`HTTP ${res.status} ${/"code"\s*:\s*"([A-Za-z0-9_.-]{2,64})"/.exec(body)?.[1] ?? ''}`.trim());
    const next = again();
    if (!next || next.plan) return res;
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(from)) return res;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('Authorization', `Bearer ${next.key}`);
    return base(next.baseURL + url.slice(from.length), { ...init, headers });
  };
}

/** 直接发到 https://<线的域名>/… 的(看图、画图)用的 fetch:走 Token Plan 时拒了就改发按量,同上 */
export function lineFetch(model: string, line: QianwenLine, env: NodeJS.ProcessEnv = process.env): typeof fetch {
  if (!line.plan) return fetch;
  return planFallbackFetch(`https://${line.host}`, () => {
    const l = qianwenLine(model, qianwenKeys(env));
    return l ? { baseURL: `https://${l.host}`, key: l.key, plan: l.plan } : null;
  });
}

export const imageUrl = (host: string): string => `https://${host}/api/v1/services/aigc/multimodal-generation/generation`;
export const ttsUrl = (host: string): string => `https://${host}/api/v1/services/audio/tts/SpeechSynthesizer`;

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
