/**
 * 孩子视图(《cotutor契约草案.md》§4,2026-09-10 改板书):最终文本剥掉「记账」段后,正文就是板书——
 * 普通段落是讲稿(一行一句),围栏是卡(src/lib/board.ts 解析);kidText = 讲稿各句拼起来(家长视图的「孩子看到」摘要),
 * 每句按 replyMaxChars 截;第一个 H2 起是给家长的尾巴(parentText),孩子看不到。出错什么都不出现。机械规则,不靠模型判断。
 * 正文取自 kidSource:带卡 / 带固定段的顶层文本段 + 最后一段(老师板书之后又用了工具也不丢)。
 */
import { stripSecrets } from '../cards/index.ts';
import type { Bookkeeping, ConversationMessage } from '../schema/index.ts';
import { parseBoard } from './board.ts';
import { threads, type CardAssets, type CardStates } from './conversation.ts';
import type { BoardSection } from './kid-board.ts';
import { parseSections } from './sections.ts';
import type { Transcript } from './transcript.ts';

export interface KidView {
  /** 给孩子的话(讲稿各句,换行分隔);null = 这次运行没有(出错、还在跑、或最终文本剥完是空的) */
  kidText: string | null;
  truncated: boolean;
  /** 记账任务的回答(「## 记账」段);应用按它写日记 */
  bookkeeping: Bookkeeping | null;
  /** 「## 记忆」段的条目;应用追加进 vault 的记忆文件 */
  memory: string[];
  /** 运行是否正常收尾 */
  ok: boolean;
  /** 板书节(卡 + 讲稿);没有卡也没有讲稿 = null */
  section: BoardSection | null;
  /** 解析时的提醒(卡没解析成等),家长视图转录里显示 */
  warnings: string[];
  /** 第一个 H2 起给家长的尾巴(老师写的任何标题段);没有 = 空串 */
  parentText: string;
}

const SENTENCE_END = new Set(['。', '!', '!', '?', '?', ';', ';', '\n']);

/** 按码点数截断;能在句末断就在句末断(不加省略号),否则硬截加 … */
export function truncateReply(text: string, max: number): { text: string; truncated: boolean } {
  const cps = Array.from(text);
  if (cps.length <= max) return { text, truncated: false };
  let cut = -1;
  for (let i = Math.min(max, cps.length) - 1; i >= Math.floor(max * 0.4); i--) {
    if (SENTENCE_END.has(cps[i])) {
      cut = i + 1;
      break;
    }
  }
  if (cut > 0) return { text: cps.slice(0, cut).join('').trim(), truncated: true };
  return { text: `${cps.slice(0, max).join('').trim()}…`, truncated: true };
}

const none = (ok: boolean, bookkeeping: Bookkeeping | null = null): KidView => ({ kidText: null, truncated: false, bookkeeping, memory: [], ok, section: null, warnings: [], parentText: '' });

const FENCE_OR_H2 = /^\s*(?:```|~~~|## )/m;

/**
 * 孩子看的正文从哪来(2026-09-10 拍板,两次真跑的教训):`result.result` 只是这轮**最后一段**顶层文本——老师写完板书再用一次工具、再补一句,
 * 板书和「## 记账」段就没了。所以正文 = 这轮里**带围栏(卡)或带 H2 固定段的顶层文本段** + **最后一段**(顺序不变,重复不算两次);
 * 中间那些「我先看看账本」之类没卡没段的话不进。子代理的话本来就不在顶层。
 */
export function kidSource(t: Transcript): string | null {
  if (!t.final?.text) return null;
  const last = t.final.text.trim();
  const blocks = t.items.filter((i) => i.kind === 'text' && !i.sub).map((i) => i.text.trim());
  const kept = blocks.filter((b) => b !== last && FENCE_OR_H2.test(b));
  return [...kept, last].join('\n\n');
}

export function deriveKidView(t: Transcript, policy: { replyMaxChars: number }): KidView {
  if (!t.final) return none(false);
  if (!t.final.ok || !t.final.text) return none(t.final.ok);
  const { body, bookkeeping, memory } = parseSections(kidSource(t) ?? t.final.text);
  const board = parseBoard(body);
  const { cards, lines } = board.section;
  if (!cards.length && !lines.length) return { ...none(true, bookkeeping), memory, warnings: board.warnings.map((w) => w.text), parentText: board.tail };
  let truncated = false;
  const cut = lines.map((l) => {
    const r = truncateReply(l.text, policy.replyMaxChars);
    truncated = truncated || r.truncated;
    return { ...l, text: r.text };
  });
  const section: BoardSection = { ...board.section, lines: cut };
  const kidText = cut.map((l) => l.text).join('\n');
  return { kidText: kidText || null, truncated, bookkeeping, memory, ok: true, section, warnings: board.warnings.map((w) => w.text), parentText: board.tail };
}

/** 孩子端的一条:自己问的话(别人问的不显示)+ 老师给孩子的话 + 配音;出错的运行什么都不出现(问句还在) */
export interface KidMessage {
  job: string;
  /** 话题 id(话题第一条的 job) */
  thread: string;
  at: string;
  /** 孩子自己说的;家长 / 系统发的不给孩子看,为 null */
  question: string | null;
  /** 老师给孩子的话;还在跑或这轮没有 = null */
  reply: string | null;
  /** 老师还在想 */
  pending: boolean;
  /** 本次运行新增的产物 id */
  artifacts: string[];
  /** 板书节(卡 + 讲稿;答案等秘密已剥;配音在讲稿句上) */
  section?: BoardSection | null;
  /** 孩子这条带的作业照片(相对 workspace 根;页面经 /api/kid/image?p= 取);只在孩子自己的问句上 */
  photos?: string[];
}

/** 孩子做的状态(states)与已生成的资产(assets,都从 .cards/ 读)并到这轮的卡上;都没有就原样 */
function cardsWithState(m: ConversationMessage, states: CardStates, assets: CardAssets): BoardSection | null | undefined {
  const per = states[m.job];
  const files = assets[m.job];
  return m.section && (per || files) ? { ...m.section, cards: m.section.cards.map((c, n) => ({ ...c, ...(per?.[n] ? { state: per[n].state } : {}), ...(files?.[n]?.length ? { assets: files[n] } : {}) })) } : m.section;
}

/**
 * 对话索引 → 孩子端条目(《契约草案.md》§4 的机械过滤在服务端做):不带 result / error / 费用 / 家长尾巴;
 * 卡上的答案剥掉,孩子自己做的状态(states)与已生成的资产(assets,都从 .cards/ 读)并到卡上。出错的运行:没有 question 的直接不出现;有 question 的只留问句(老师头像不灰,下一条照常)。
 */
export function kidConversation(index: { messages: readonly ConversationMessage[] }, states: CardStates = {}, assets: CardAssets = {}): KidMessage[] {
  const out: KidMessage[] = [];
  const ths = threads(index.messages);
  for (const [i, m] of index.messages.entries()) {
    // 记账那轮是家长晚上起的任务,老师回的「记好了」不是给孩子的话
    if (m.bookkeep || m.tidy) continue;
    const question = m.from === 'kid' ? m.text : null;
    const reply = m.result === 'ok' ? (m.kidText ?? null) : null;
    const pending = m.result === 'running';
    if (question === null && reply === null && !pending) continue;
    const withState = cardsWithState(m, states, assets);
    const section = m.result === 'ok' && withState ? stripSecrets(withState) : undefined;
    out.push({ job: m.job, thread: ths[i], at: m.at, question, reply, pending, artifacts: reply ? [...m.artifacts] : [], ...(section ? { section } : {}), ...(question !== null && m.photos?.length ? { photos: [...m.photos] } : {}) });
  }
  return out;
}

/**
 * 家长板书页的一条(《家长板书页设计.md》§3、§4.1):形状同 KidMessage,家长多看到的都是可选字段;
 * `section` **不剥答案**;`question` 不管谁发的都给;记账 / 整理记忆那两种轮也在(旁注写「已记进日记」「整理了记忆」)。
 */
export interface ParentMessage extends KidMessage {
  from: ConversationMessage['from'];
  via?: ConversationMessage['via'];
  action?: ConversationMessage['action'];
  /** 这条带给老师的卡(上一轮之后孩子改过状态的):「孩子在板书上做的」 */
  cards?: ConversationMessage['cards'];
  parentText?: string;
  remembered?: string[];
  warnings?: string[];
  /** 不 ok 时的原因;孩子端什么都不出现,家长页出一行 */
  error?: string;
  bookkeep?: ConversationMessage['bookkeep'];
  tidy?: true;
  /** 试用那轮(《家长板书页设计.md》§5):费用给家长看(只这一处),记忆段原文是「本来会记住的」 */
  tryout?: true;
  memoryDraft?: string[];
  costUsd?: number;
}

/** 对话索引 → 家长板书页条目:和 kidConversation 同一个循环,差集恰好是 ParentMessage 里多出的字段与「答案不剥」 */
export function parentConversation(index: { messages: readonly ConversationMessage[] }, states: CardStates = {}, assets: CardAssets = {}): ParentMessage[] {
  const out: ParentMessage[] = [];
  const ths = threads(index.messages);
  for (const [i, m] of index.messages.entries()) {
    const reply = m.result === 'ok' ? (m.kidText ?? null) : null;
    const pending = m.result === 'running';
    const withState = cardsWithState(m, states, assets);
    const section = m.result === 'ok' && withState ? withState : undefined;
    out.push({
      job: m.job, thread: ths[i], at: m.at, from: m.from, question: m.text, reply, pending, artifacts: reply ? [...m.artifacts] : [],
      ...(section ? { section } : {}),
      ...(m.photos?.length ? { photos: [...m.photos] } : {}),
      ...(m.via ? { via: m.via } : {}),
      ...(m.action ? { action: m.action } : {}),
      ...(m.cards?.length ? { cards: m.cards } : {}),
      ...(m.parentText ? { parentText: m.parentText } : {}),
      ...(m.remembered?.length ? { remembered: m.remembered } : {}),
      ...(m.warnings?.length ? { warnings: m.warnings } : {}),
      ...(m.result === 'error' ? { error: m.error ?? '没成' } : {}),
      ...(m.bookkeep ? { bookkeep: m.bookkeep } : {}),
      ...(m.tidy ? { tidy: true as const } : {}),
      ...(m.tryout ? { tryout: true as const } : {}),
      ...(m.memoryDraft?.length ? { memoryDraft: m.memoryDraft } : {}),
      ...(typeof m.costUsd === 'number' ? { costUsd: m.costUsd } : {}),
    });
  }
  return out;
}

export interface KidThread {
  thread: string;
  /** 话题第一条的时间 */
  at: string;
  /** 话题名:孩子的第一句话截 20 字;没有孩子的话 → 「老师主动说的」 */
  title: string;
  /** 老师讲了几节 */
  sections: number;
  /** 一共几张卡 */
  cards: number;
}

/**
 * 「以前的」列表:一天的孩子端条目按话题分组。一句孩子的话都没有的话题不列;还在跑的、出错的轮不算节。
 */
export function kidThreads(messages: readonly KidMessage[]): KidThread[] {
  const by = new Map<string, KidThread & { asked: boolean }>();
  for (const m of messages) {
    const t = by.get(m.thread) ?? { thread: m.thread, at: m.at, title: '', sections: 0, cards: 0, asked: false };
    if (m.question && !t.asked) { t.asked = true; t.title = m.question.trim().slice(0, 20); }
    if (m.reply !== null || (m.section && !m.pending)) { t.sections++; t.cards += m.section?.cards.length ?? 0; }
    by.set(m.thread, t);
  }
  return [...by.values()].filter((t) => t.asked).map(({ asked: _a, ...t }) => t);
}

/** 今天孩子已发的条数(每日上限按它算;家长发的不算,「继续」不算,交答案算) */
export function kidMessageCount(index: { messages: readonly ConversationMessage[] }): number {
  return index.messages.filter((m) => m.from === 'kid' && m.action !== 'continue').length;
}
