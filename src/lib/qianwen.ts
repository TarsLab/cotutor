/**
 * 千问的两套账(《wip/2026-10-13-token-plan调研.md》):千问 AI 平台的 Token Plan(`sk-sp-`,只认 token-plan 域名,按订阅 Credits 抵)
 * 与百炼按量(`sk-` / `sk-ws-`,dashscope 域名)。两把 key 互不通用。
 * 一条线调哪个模型:Token Plan 有这个模型、本机又有它的 key 就走 Token Plan,否则走按量(2026-10-13 定)。key 只进请求头与子进程环境。
 * - Token Plan 的 key:环境变量 QWENCLOUD_TOKEN_PLAN_API_KEY(Qwen Code 官方页用的名字);DASHSCOPE_API_KEY 里放的是 `sk-sp-` 也认作它。
 * - 按量的 key:DASHSCOPE_API_KEY(不是 `sk-sp-` 时),再看本机 qwen(~/.qwen/settings.json 的 env)、voxtell(~/.config/voxtell/config.json)的配置。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const TOKEN_PLAN_HOST = 'token-plan.maas.qianwenaiapi.com';
export const DASHSCOPE_HOST = 'dashscope.aliyuncs.com';
export const TOKEN_PLAN_KEY_ENV = 'QWENCLOUD_TOKEN_PLAN_API_KEY';

/**
 * Token Plan 个人版调得通的模型(2026-10-13:文档表、token-plan 的 /models、实测三处对过)。
 * 没有 omni 系列、qwen-image-2.0、qwen-plus、paraformer(握手能过,文档与 /models 都没有,不算)
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

/** 本机 qwen 配好的百炼 key(~/.qwen/settings.json 的 env);读不到就是 null */
export function localDashscopeKey(home = homedir()): string | null {
  const env = readJson(join(home, '.qwen', 'settings.json'))?.env;
  return env && typeof env === 'object' ? text((env as Record<string, unknown>).DASHSCOPE_API_KEY) : null;
}

/** voxtell 的配置(~/.config/voxtell/config.json):按量 key 与业务空间 id */
export function voxtellConfig(home = homedir()): { apiKey: string | null; workspaceId: string | null } {
  const v = readJson(join(home, '.config', 'voxtell', 'config.json'));
  return { apiKey: text(v?.apiKey), workspaceId: text(v?.workspaceId) };
}

/** 本机的两把 key:先看环境,再看 qwen、voxtell 的配置;哪处放错了套(按量的位置放了 `sk-sp-`)就挪到对的那格 */
export function qianwenKeys(env: NodeJS.ProcessEnv = process.env): QianwenKeys {
  const home = env.HOME || homedir();
  const named = text(env[TOKEN_PLAN_KEY_ENV]);
  const candidates = [text(env.DASHSCOPE_API_KEY), localDashscopeKey(home), voxtellConfig(home).apiKey];
  return {
    plan: named ?? candidates.find((k) => k && isPlanKey(k)) ?? null,
    payg: candidates.find((k) => k && !isPlanKey(k)) ?? null,
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
export const imageUrl = (host: string): string => `https://${host}/api/v1/services/aigc/multimodal-generation/generation`;
export const ttsUrl = (host: string): string => `https://${host}/api/v1/services/audio/tts/SpeechSynthesizer`;
export const inferenceWs = (host: string): string => `wss://${host}/api-ws/v1/inference/`;
