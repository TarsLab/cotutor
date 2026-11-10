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

/** 本机的两把 key(env 只取 HOME,测试拿它指别的家);放错了套(bailian.json 里放了 `sk-sp-`)就挪到对的那格 */
export function qianwenKeys(env: NodeJS.ProcessEnv = process.env): QianwenKeys {
  const home = env.HOME || homedir();
  const plan = tokenPlanKey(home);
  const payg = cotutorBailian(home).apiKey;
  return {
    plan: plan && isPlanKey(plan) ? plan : payg && isPlanKey(payg) ? payg : null,
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
