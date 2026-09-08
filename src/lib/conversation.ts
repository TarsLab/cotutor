/**
 * 会话索引的纯函数:日期与 job 命名、空索引、把一次运行的结果并进索引(不改旧对象)。
 */
import { ConversationIndexSchema, type ConversationIndex, type ConversationMessage } from '../schema/index.ts';
import type { KidView } from './kid-view.ts';
import type { Transcript } from './transcript.ts';

const pad = (n: number): string => String(n).padStart(2, '0');

/** 本地日期 YYYY-MM-DD(会话按本地日切) */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 本地时间到分钟 YYYY-MM-DDTHH:MM(上下文包的 at) */
export function localMinute(d: Date): string {
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** HHMM-<序号>,同一天内不重复 */
export function jobId(d: Date, seq: number): string {
  return `${pad(d.getHours())}${pad(d.getMinutes())}-${seq}`;
}

export function emptyIndex(teacher: string, date: string): ConversationIndex {
  return ConversationIndexSchema.parse({ teacher, date });
}

export interface ConversationFiles {
  index: string;
  log: (job: string) => string;
  err: (job: string) => string;
}

/** conversations/<teacher>/<date>.json 与 <date>.<job>.log / .err.log */
export function conversationFiles(conversationsDir: string, teacher: string, date: string): ConversationFiles {
  const base = `${conversationsDir}/${teacher}/${date}`;
  return { index: `${base}.json`, log: (job) => `${base}.${job}.log`, err: (job) => `${base}.${job}.err.log` };
}

export function addMessage(index: ConversationIndex, msg: ConversationMessage): ConversationIndex {
  return { ...index, messages: [...index.messages, msg] };
}

/** 一次运行收尾:写 result / cost / kidText / artifacts,首次拿到 session 就记下 */
export function applyRun(
  index: ConversationIndex,
  job: string,
  run: { transcript: Transcript; kidView: KidView; agent: string; artifacts?: string[] },
): ConversationIndex {
  const { transcript, kidView } = run;
  const messages = index.messages.map((m) =>
    m.job === job
      ? {
          ...m,
          result: transcript.final ? (transcript.final.ok ? ('ok' as const) : ('error' as const)) : ('running' as const),
          costUsd: transcript.final?.costUsd,
          kidText: kidView.kidText,
          artifacts: run.artifacts ?? m.artifacts,
        }
      : m,
  );
  const session = index.session ?? (transcript.sessionId ? { id: transcript.sessionId, agent: run.agent } : null);
  const costUsd = messages.reduce((s, m) => s + (m.costUsd ?? 0), 0);
  return { ...index, session, messages, costUsd: Math.round(costUsd * 1e4) / 1e4 };
}
