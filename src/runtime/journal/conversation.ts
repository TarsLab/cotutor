/**
 * 对话索引的纯函数:job 命名、空索引、话题、把一次运行的结果并进索引(不改旧对象)。日期在 shared/time.ts,文件布局与卡 id 在 schema/conversation-files.ts。
 */
import { ConversationIndexSchema, threads, type CardStateFile, type CardStates, type ConversationIndex, type ConversationMessage, type Session, type Timing } from '../../schema/index.ts';
import type { KidView } from '../kid-view.ts';
import type { Transcript } from '../../brain/transcript.ts';

const pad = (n: number): string => String(n).padStart(2, '0');

/** HHMM-<序号>,同一天内不重复 */
export function jobId(d: Date, seq: number): string {
  return `${pad(d.getHours())}${pad(d.getMinutes())}-${seq}`;
}

export function emptyIndex(tutor: string, date: string): ConversationIndex {
  return ConversationIndexSchema.parse({ tutor, date });
}

/** 一个话题里上一轮之后改过状态的卡(按 job、下标排):发消息时逐张 describe 进上下文包。turn 是存卡时那个话题的末条 job */
export function changedCards(index: { messages: readonly Pick<ConversationMessage, 'job' | 'from' | 'thread'>[] }, states: CardStates, thread: string): { job: string; n: number; file: CardStateFile }[] {
  const last = lastJobOf(index, thread);
  if (!last) return [];
  const t = threads(index.messages);
  const out: { job: string; n: number; file: CardStateFile }[] = [];
  index.messages.forEach((m, i) => {
    const per = states[m.job];
    if (!per || t[i] !== thread) return;
    for (const n of Object.keys(per).map(Number).sort((a, b) => a - b)) if (per[n].turn === last) out.push({ job: m.job, n, file: per[n] });
  });
  return out;
}

/** 当前话题 = 末条消息的;空索引 null */
export function currentThread(index: { messages: readonly Pick<ConversationMessage, 'job' | 'from' | 'thread'>[] }): string | null {
  const t = threads(index.messages);
  return t.length ? t[t.length - 1] : null;
}

/** 某个话题的会话(没有 = 新开) */
export function sessionFor(index: { sessions: Record<string, Session> }, thread: string): Session | null {
  return index.sessions[thread] ?? null;
}

/** 某个话题里最后一条消息的 job(卡的状态文件 turn 记它;没有这个话题 → null) */
export function lastJobOf(index: { messages: readonly Pick<ConversationMessage, 'job' | 'from' | 'thread'>[] }, thread: string): string | null {
  const t = threads(index.messages);
  for (let i = t.length - 1; i >= 0; i--) if (t[i] === thread) return index.messages[i].job;
  return null;
}

export function addMessage(index: ConversationIndex, msg: ConversationMessage): ConversationIndex {
  return { ...index, messages: [...index.messages, msg] };
}

/** 一次运行收尾:写 result / tokens / kidText / artifacts / timing,首次拿到 session 就记下 */
export function applyRun(
  index: ConversationIndex,
  job: string,
  run: { transcript: Transcript; kidView: KidView; runtime: string; artifacts?: string[]; timing?: Timing; tools?: ConversationMessage['tools'] },
): ConversationIndex {
  const { transcript, kidView } = run;
  // 会话按话题记:这个话题首次拿到就记;换了运行时(agent 不同)就以这次的为准——跨 CLI 不能 resume。顶层 session = 当前话题的
  const i = index.messages.findIndex((m) => m.job === job);
  const thread = i >= 0 ? threads(index.messages)[i] : job;
  // 话题第一条(thread === job)一律新会话
  const prev = thread === job ? null : sessionFor(index, thread);
  const keep = prev && prev.runtime === run.runtime ? prev : null;
  const messages = index.messages.map((m) =>
    m.job === job
      ? {
          ...m,
          result: transcript.final ? (transcript.final.ok ? ('ok' as const) : ('error' as const)) : ('running' as const),
          ...(transcript.final?.inTokens !== undefined ? { tokens: { in: transcript.final.inTokens, out: transcript.final.outTokens ?? 0, ...(transcript.final.cachedTokens !== undefined ? { cached: transcript.final.cachedTokens } : {}), ...(transcript.final.contextTokens !== undefined ? { context: transcript.final.contextTokens } : {}) } } : {}),
          kidText: kidView.kidText,
          artifacts: run.artifacts ?? m.artifacts,
          runtime: run.runtime,
          ...(m.bookkeep || kidView.bookkeeping ? { bookkeeping: kidView.bookkeeping } : {}),
          section: kidView.section,
          ...(kidView.parentText ? { parentText: kidView.parentText } : {}),
          ...(kidView.warnings.length ? { warnings: [...(m.warnings ?? []), ...kidView.warnings] } : {}),
          error: transcript.final?.ok === false ? transcript.final.reason : null,
          ...(run.timing ? { timing: run.timing } : {}),
          ...(run.tools?.length ? { tools: run.tools } : {}),
        }
      : m,
  );
  const mine = keep ?? (transcript.sessionId ? { id: transcript.sessionId, runtime: run.runtime } : prev);
  const sessions = mine ? { ...index.sessions, [thread]: mine } : index.sessions;
  const cur = currentThread(index);
  const session = cur ? (sessions[cur] ?? null) : null;
  return { ...index, session, sessions, messages };
}
