/** 给人看的路径里把家目录换成 $HOME(报错、doctor、--json 输出不带出用户名;从 app/workspace.ts 挪来,2026-10-29) */
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** cotutor.json 里的路径:~ 与 ~/ 是家目录,绝对的照用,相对的相对 base(从 app/workspace.ts 挪来,2026-11-09:托盘不带 zod 也要用) */
export function expandPath(p: string, base: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(base, p);
}

export function redactHome(value: string): string {
  const home = homedir();
  return home && value.startsWith(home) ? '$HOME' + value.slice(home.length) : value;
}

export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactHome(value) as T;
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactDeep(v)])) as T;
  }
  return value;
}
