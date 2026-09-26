/**
 * 老师进程的代理(2026-09-26):本机的 claude 走代理,可出厂运行时带 `--setting-sources project`,读不到 ~/.claude/settings.json 里的代理;
 * serve 又常从没 export 代理的终端起 → 老师 403「Request not allowed」(0 token、不到 1 秒)。
 * 办法:cotutor.json 的 proxy 记下家长的选择,起 claude 子进程时把 HTTP(S)_PROXY 注进它的环境——不靠 serve 从哪个终端起,
 * 也不靠 .claude/settings.local.json(那条路要 --setting-sources 含 local,且 workspace 是 git 仓:claude 以 git 根为项目根找 .claude/)。
 * 只注给 claude:qwen、voxtell、koubo 连的是国内服务,不动。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

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

/** 起子进程的环境:命令是 claude 且 cotutor.json 设了代理,就注 HTTP(S)_PROXY(大小写都给);别的原样 */
export function withProxy(argv: readonly string[], env: NodeJS.ProcessEnv, proxy: string | false | undefined): NodeJS.ProcessEnv {
  if (typeof proxy !== 'string' || !argv.length || basename(argv[0]) !== 'claude') return env;
  return { ...env, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy };
}
