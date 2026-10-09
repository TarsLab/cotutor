/**
 * 老师进程的代理(2026-09-26):本机的 claude 走代理,可出厂运行时带 `--setting-sources project`,读不到 ~/.claude/settings.json 里的代理;
 * serve 又常从没 export 代理的终端起 → 老师 403「Request not allowed」(0 token、不到 1 秒)。
 * 办法:cotutor.json 的 proxy 记下家长的选择,起 claude 子进程时把 HTTP(S)_PROXY 注进它的环境——不靠 serve 从哪个终端起,
 * 也不靠 .claude/settings.local.json(那条路要 --setting-sources 含 local,且 workspace 是 git 仓:claude 以 git 根为项目根找 .claude/)。
 * 只注给 claude:qwen、voxtell、koubo 连的是国内服务,不动。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { adapterFor } from '../clis/index.ts';

export interface DetectedProxy {
  url: string;
  /** 从哪探到的:~/.claude/settings.json(claude 自己用的那份)/ 环境变量 */
  source: string;
}

const KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'] as const;
export const PROXY_URL_RE = /^(https?|socks5h?):\/\/\S+$/;

function pick(env: Record<string, unknown> | undefined): string | null {
  for (const k of KEYS) {
    const v = env?.[k];
    if (typeof v === 'string' && PROXY_URL_RE.test(v.trim())) return v.trim();
  }
  return null;
}

/** 本机的代理:先看 ~/.claude/settings.json 的 env(claude 平常就用它),再看当前环境变量;都没有 → null */
export function detectProxy(opts: { home?: string; env?: NodeJS.ProcessEnv } = {}): DetectedProxy | null {
  const home = opts.home ?? homedir();
  try {
    const s = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')) as { env?: Record<string, unknown> };
    const url = pick(s.env);
    if (url) return { url, source: '~/.claude/settings.json' };
  } catch {
    /* 没有或坏了:看环境变量 */
  }
  const url = pick(opts.env ?? process.env);
  return url ? { url, source: '环境变量' } : null;
}

/** 起子进程的环境:按命令认 CLI 适配器,由它决定代理怎么注(claude 注 HTTP(S)_PROXY,别的原样);老师进程走 src/clis/ 的 processEnv,这里给只有一条命令的调用 */
export function withProxy(argv: readonly string[], env: NodeJS.ProcessEnv, proxy: string | false | undefined): NodeJS.ProcessEnv {
  if (!argv.length) return env;
  return adapterFor({ run: argv }).env(env, { proxy });
}
