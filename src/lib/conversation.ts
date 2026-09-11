/**
 * 对话索引的纯函数:日期与 job 命名、空索引、把一次运行的结果并进索引(不改旧对象)。
 */
import { ConversationIndexSchema, type ConversationIndex, type ConversationMessage, type Timing } from '../schema/index.ts';
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

/** 上一轮之后改过状态的卡(按 job、下标排):发消息时逐张 describe 进上下文包 */
export function changedCards(index: { messages: readonly { job: string }[] }, states: CardStates): { job: string; n: number; file: CardStateFile }[] {
  const last = index.messages[index.messages.length - 1]?.job;
  if (!last) return [];
  const out: { job: string; n: number; file: CardStateFile }[] = [];
  for (const m of index.messages) {
    const per = states[m.job];
    if (!per) continue;
    for (const n of Object.keys(per).map(Number).sort((a, b) => a - b)) if (per[n].turn === last) out.push({ job: m.job, n, file: per[n] });
  }
  return out;
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
  // 会话:首次拿到就记;换了运行时(agent 不同)就以这次的为准——跨 CLI 不能 resume,索引要跟着换
  const keep = index.session && index.session.runtime === run.runtime ? index.session : null;
  const session = keep ?? (transcript.sessionId ? { id: transcript.sessionId, runtime: run.runtime } : index.session);
  const costUsd = messages.reduce((s, m) => s + (m.costUsd ?? 0), 0);
  return { ...index, session, messages, costUsd: Math.round(costUsd * 1e4) / 1e4 };
}
