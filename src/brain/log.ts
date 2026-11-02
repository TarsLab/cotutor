/**
 * 一轮的 .log 怎么读:API 轮次一行一条统一事件({"kind": 开头,./api.ts 写的);2026-11-02 以前的轮次是 Qwen Code 的 stream-json(./stream-json.ts)。
 * 两种行长得不一样,一行一行认,同一份记录里换过也读得出。
 */
import { parseStreamJson } from './stream-json.ts';
import type { CliEvent } from './types.ts';

/** 统一事件的一行;不是这种行回 [] */
export function parseEventLine(line: string): CliEvent[] {
  if (!line.startsWith('{"kind":')) return [];
  try {
    const e = JSON.parse(line) as CliEvent;
    return typeof e.kind === 'string' ? [e] : [];
  } catch {
    return [];
  }
}

/** .log 的一行 → 统一事件:先当统一事件,不是再当旧的 stream-json */
export function parseLogLine(line: string): CliEvent[] {
  const e = parseEventLine(line);
  return e.length ? e : parseStreamJson(line);
}
