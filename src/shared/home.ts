/** 给人看的路径里把家目录换成 $HOME(报错、doctor、--json 输出不带出用户名;从 cli/workspace.ts 挪来,2026-10-29) */
import { homedir } from 'node:os';

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
