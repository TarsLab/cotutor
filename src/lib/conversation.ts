/**
 * 对话索引的纯函数:日期与 job 命名、空索引、把一次运行的结果并进索引(不改旧对象)。
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

export function emptyIndex(tutor: string, date: string): ConversationIndex {
  return ConversationIndexSchema.parse({ tutor, date });
}

export interface ConversationFiles {
  index: string;
  log: (job: string) => string;
  err: (job: string) => string;
  audio: (job: string) => string;
}

/** conversations/<tutor>/<date>.json 与 <date>.<job>.log / .err.log / .mp3(配音) */
export function conversationFiles(conversationsDir: string, tutor: string, date: string): ConversationFiles {
  const base = `${conversationsDir}/${tutor}/${date}`;
  return { index: `${base}.json`, log: (job) => `${base}.${job}.log`, err: (job) => `${base}.${job}.err.log`, audio: (job) => `${base}.${job}.mp3` };
}

export function addMessage(index: ConversationIndex, msg: ConversationMessage): ConversationIndex {
  return { ...index, messages: [...index.messages, msg] };
}

/** 一次运行收尾:写 result / cost / kidText / artifacts,首次拿到 session 就记下 */
export function applyRun(
  index: ConversationIndex,
  job: string,
  run: { transcript: Transcript; kidView: KidView; runtime: string; artifacts?: string[]; audio?: string | null },
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
          runtime: run.runtime,
          holdup: kidView.holdup,
          handoff: kidView.handoff,
          error: transcript.final?.ok === false ? transcript.final.reason : null,
          audio: run.audio ?? null,
        }
      : m,
  );
  // 会话:首次拿到就记;换了运行时(agent 不同)就以这次的为准——跨 CLI 不能 resume,索引要跟着换
  const keep = index.session && index.session.runtime === run.runtime ? index.session : null;
  const session = keep ?? (transcript.sessionId ? { id: transcript.sessionId, runtime: run.runtime } : index.session);
  const costUsd = messages.reduce((s, m) => s + (m.costUsd ?? 0), 0);
  return { ...index, session, messages, costUsd: Math.round(costUsd * 1e4) / 1e4 };
}
