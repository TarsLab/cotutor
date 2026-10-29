/**
 * 一轮运行的事件(<日期>.<job>.events.jsonl 的一行;控制台与时间线的唯一来源)。格式化与读在 runtime/journal/events.ts。
 */
import type { Tokens } from '../shared/tokens.ts';

export type Lane = 'main' | 'tts' | 'ready' | 'index' | 'ledger' | 'mouth';
export const LANES: readonly Lane[] = ['main', 'tts', 'ready', 'index', 'ledger', 'mouth'];

export type RunEvent = { t: number } & (
  /** warmMs:用的是提前起好的进程(预热),它等了多久 */
  | { lane: 'main'; kind: 'start'; cli: string; runtime: string; resume: boolean; warmMs?: number }
  | { lane: 'main'; kind: 'card'; card: number; label: string }
  /** play:这句的 [[play]] 锚着小课堂卡(念完放那一段;实时时服务端等孩子端放完再交后面的句子);echo / call:热身的 [[echo 词]] [[say 词]] 与 [[call]](实时时服务端等孩子跟、进打电话) */
  | { lane: 'main'; kind: 'line'; line: number; text: string; play?: true; echo?: { word: string; say?: true }; call?: true }
  | { lane: 'main'; kind: 'tool'; name: string; sub: boolean }
  | { lane: 'main'; kind: 'exit'; ok: boolean; reason?: string; tokens?: Tokens; turns?: number }
  /** 断流:老师进程 idleMs 没吐一个字节(工具不在跑),杀掉;retry = 接着跑第几次(0 = 次数用完,不再跑),kept = 断前已写出的正文字数 */
  | { lane: 'main'; kind: 'stall'; idleMs: number; retry: number; kept: number }
  | { lane: 'tts'; kind: 'queued'; label: string }
  | { lane: 'tts'; kind: 'done'; label: string; ms: number; file: string }
  | { lane: 'tts'; kind: 'failed'; label: string; ms: number; error: string }
  | { lane: 'ready'; kind: 'beat'; beat: number; card: number | null; first: boolean }
  /** 第一句配好了,能开口了(首句就绪;2026-10-08 起比第一拍早) */
  | { lane: 'ready'; kind: 'speak' }
  | { lane: 'ready'; kind: 'all'; cards: number; lines: number }
  | { lane: 'index'; kind: 'written'; warnings: number }
  /** 记账:话题的一段写进了 vault 的日记(file 是日记文件名) */
  | { lane: 'ledger'; kind: 'diary'; thread: string; file: string }
  /** 实时老师的嘴:孩子按下 · 松手(voice)或发了不是说的(text / photo / card;ask 是卡上的「?」 撤了,旧记录里还有)· 嘴接住的声音开始在孩子端放 ·
   *  讲稿第几句开始放 · 孩子按下打断了这一轮(line = 正念到第几句,0 起;还没念到讲稿 = null) */
  | { lane: 'mouth'; kind: 'hold' }
  /** vad = 一直听时孩子说完(服务端 VAD 判的、应用收下了) */
  | { lane: 'mouth'; kind: 'release'; how: 'voice' | 'vad' | 'text' | 'photo' | 'card' | 'ask' }
  | { lane: 'mouth'; kind: 'catch'; text: string }
  | { lane: 'mouth'; kind: 'read'; line: number }
  | { lane: 'mouth'; kind: 'cut'; line: number | null }
  /** 脑想得久(松手几秒了讲稿还一句没有),嘴垫了一句(开始放) */
  | { lane: 'mouth'; kind: 'fill'; text: string }
);

/** 发事件时给的形状:少一个 t(runner 补);Omit 直接套在联合上会塌成公共键,所以逐个分发 */
export type RunEventInput = RunEvent extends infer E ? (E extends RunEvent ? Omit<E, 't'> : never) : never;

/** 内存订阅者拿到的:事件 + 是谁的哪一轮 */
export interface RunEventEnvelope {
  tutor: string;
  date: string;
  job: string;
  event: RunEvent;
}
