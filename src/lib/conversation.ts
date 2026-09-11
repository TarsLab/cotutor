/**
 * 对话索引的纯函数:日期与 job 命名、空索引、把一次运行的结果并进索引(不改旧对象)。
 */
import { ConversationIndexSchema, type ConversationIndex, type ConversationMessage, type Session, type Timing } from '../schema/index.ts';
import type { KidView } from './kid-view.ts';
import type { Transcript } from './transcript.ts';

const pad = (n: number): string => String(n).padStart(2, '0');

/** 本地日期 YYYY-MM-DD(对话按本地日切) */
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
  /** 这一轮真发出去的东西:上下文包 + 完整命令行(家长端「看原文」第一站;跑完就丢的话,「老师为什么没看见」永远查不了) */
  run: (job: string) => string;
  audio: (job: string) => string;
  /** 板书讲稿第 n 句的配音(n 从 1 起) */
  lineAudio: (job: string, n: number) => string;
  /** 这一轮各张卡的状态目录 <date>.<job>.cards/ */
  cardsDir: (job: string) => string;
  /** 第 n 张卡(0 起)的状态文件 <date>.<job>.cards/<n>.json */
  card: (job: string, n: number) => string;
  /** 第 n 张卡的资产目录 <date>.<job>.cards/<n>/ */
  cardAssetsDir: (job: string, n: number) => string;
  /** 第 n 张卡的一个资产文件(点读第 k 段 = <k>.mp3) */
  cardAsset: (job: string, n: number, file: string) => string;
}

/** conversations/<tutor>/<date>.json 与 <date>.<job>.log / .err.log / .mp3(整段配音)/ .<n>.mp3(讲稿第 n 句)/ .cards/<n>.json(卡的状态) */
export function conversationFiles(conversationsDir: string, tutor: string, date: string): ConversationFiles {
  const base = `${conversationsDir}/${tutor}/${date}`;
  return {
    index: `${base}.json`,
    log: (job) => `${base}.${job}.log`,
    err: (job) => `${base}.${job}.err.log`,
    run: (job) => `${base}.${job}.run.json`,
    audio: (job) => `${base}.${job}.mp3`,
    lineAudio: (job, n) => `${base}.${job}.${n}.mp3`,
    cardsDir: (job) => `${base}.${job}.cards`,
    card: (job, n) => `${base}.${job}.cards/${n}.json`,
    cardAssetsDir: (job, n) => `${base}.${job}.cards/${n}`,
    cardAsset: (job, n, file) => `${base}.${job}.cards/${n}/${file}`,
  };
}

/** 资产在孩子端的名字:相对 conversations/<老师>/,/api/audio 认它 */
export function cardAssetName(date: string, job: string, n: number, file: string): string {
  return `${date}.${job}.cards/${n}/${file}`;
}

/** 卡的 id:<job>/<n>(n 是节里的下标,0 起);页面、上下文包、状态文件名都用它 */
export function cardId(job: string, n: number): string {
  return `${job}/${n}`;
}

/** 一张卡的状态文件:孩子做的事 + 什么时候做的 + 做的时候最后一轮是谁(下一条消息只带「上一轮之后改过的」) */
export interface CardStateFile {
  at: string;
  /** 存的时候索引里最后一条消息的 job;下一条消息发出时 turn === 当时的末条 → 这张卡要带上 */
  turn: string;
  state: unknown;
}

/** 索引里每条消息 job → 它那节里卡下标 → 状态文件(没做过的卡不在) */
export type CardStates = Record<string, Record<number, CardStateFile>>;

/** job → 卡下标 → 已生成好的资产名(相对 conversations/<老师>/) */
export type CardAssets = Record<string, Record<number, string[]>>;

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

/**
 * 每条消息的话题 id(与 messages 对齐)。有 thread 字段照它;没有(旧索引)按规则现算:第一条 = 自己的 job,
 * from: system 的(转交起的)永远开新话题,其余跟前一条。写新消息时 runner 已经填了 thread,这里只是兜底。
 */
export function threads(messages: readonly Pick<ConversationMessage, 'job' | 'from' | 'thread'>[]): string[] {
  const out: string[] = [];
  messages.forEach((m, i) => out.push(m.thread ?? (i === 0 || m.from === 'system' ? m.job : out[i - 1])));
  return out;
}

/** 当前话题 = 末条消息的;空索引 null */
export function currentThread(index: { messages: readonly Pick<ConversationMessage, 'job' | 'from' | 'thread'>[] }): string | null {
  const t = threads(index.messages);
  return t.length ? t[t.length - 1] : null;
}

/** 某个话题的会话:sessions 里有就它;旧索引(sessions 空)只有顶层 session,只对当前话题有效 */
export function sessionFor(index: { session: Session | null; sessions: Record<string, Session>; messages: readonly Pick<ConversationMessage, 'job' | 'from' | 'thread'>[] }, thread: string): Session | null {
  return index.sessions[thread] ?? (!Object.keys(index.sessions).length && thread === currentThread(index) ? index.session : null);
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

/** 一次运行收尾:写 result / cost / kidText / artifacts / timing,首次拿到 session 就记下 */
export function applyRun(
  index: ConversationIndex,
  job: string,
  run: { transcript: Transcript; kidView: KidView; runtime: string; artifacts?: string[]; audio?: string | null; timing?: Timing },
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
          section: kidView.section,
          ...(kidView.parentText ? { parentText: kidView.parentText } : {}),
          ...(kidView.warnings.length ? { warnings: kidView.warnings } : {}),
          error: transcript.final?.ok === false ? transcript.final.reason : null,
          audio: run.audio ?? null,
          ...(run.timing ? { timing: run.timing } : {}),
        }
      : m,
  );
  // 会话按话题记:这个话题首次拿到就记;换了运行时(agent 不同)就以这次的为准——跨 CLI 不能 resume。顶层 session = 当前话题的
  const i = index.messages.findIndex((m) => m.job === job);
  const thread = i >= 0 ? threads(index.messages)[i] : job;
  // 话题第一条(thread === job)一律新会话,不继承任何旧的(旧索引的顶层 session 是上一个话题的)
  const prev = thread === job ? null : sessionFor(index, thread);
  const keep = prev && prev.runtime === run.runtime ? prev : null;
  const mine = keep ?? (transcript.sessionId ? { id: transcript.sessionId, runtime: run.runtime } : prev);
  const sessions = mine ? { ...index.sessions, [thread]: mine } : index.sessions;
  const cur = currentThread(index);
  const session = cur ? (sessions[cur] ?? (cur === thread ? mine : index.session)) : index.session;
  const costUsd = messages.reduce((s, m) => s + (m.costUsd ?? 0), 0);
  return { ...index, session, sessions, messages, costUsd: Math.round(costUsd * 1e4) / 1e4 };
}
