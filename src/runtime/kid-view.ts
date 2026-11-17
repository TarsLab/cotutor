/**
 * 孩子视图:最终文本剥掉「记账」段后,正文就是讲稿——
 * 普通段落一行一句、句子后面的动作(src/board/parse.ts 解析;课里没有卡了,围栏不上页);kidText = 讲稿各句拼起来(家长视图的「孩子看到」摘要),
 * 每句按 replyMaxChars 截;第一个 H2 起是给家长的尾巴(parentText),孩子看不到。出错什么都不出现。机械规则,不靠模型判断。
 * 正文取自 kidSource:带围栏 / 带固定段的顶层文本段 + 最后一段(老师写完之后又用了工具也不丢)。
 */
import { type ActivityBase, type Bookkeeping, type ConversationMessage, type LessonAct, type LineAct } from '../schema/index.ts';
import { BOOK_TOC } from '../chalk/index.ts';
import { parseBoard } from '../board/parse.ts';
import { threads } from '../schema/index.ts';
import type { BoardSection, KidLecture } from '../board/presentation.ts';
import { parseSections } from '../board/sections.ts';
import type { Transcript } from '../brain/transcript.ts';

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
  /** 讲稿一节(句子与动作);没有讲稿也没有动作 = null */
  section: BoardSection | null;
  /** 解析时的提醒(写错的动作、不上页的围栏等),家长视图转录里显示 */
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
 * 孩子看的正文从哪来:`result.result` 只是这轮**最后一段**顶层文本——老师写完板书再用一次工具、再补一句,
 * 板书和「## 记账」段就没了。所以正文 = 这轮里**带围栏(卡)或带 H2 固定段的顶层文本段** + **最后一段**(顺序不变,重复不算两次);
 * 中间那些「我先看看账本」之类没卡没段的话不进。子代理的话本来就不在顶层。
 */
export function kidSource(t: Transcript): string | null {
  if (!t.final?.text) return null;
  const last = t.final.text.trim();
  const blocks = t.items.filter((i) => i.kind === 'text' && !i.sub).map((i) => i.text.trim());
  // 已经拼在最后一段里的(工具调用写成正文那次的正文,runner 接在 resume 那次前面)不再算一次
  const kept = blocks.filter((b) => !last.includes(b) && FENCE_OR_H2.test(b));
  return [...kept, last].join('\n\n');
}

export function deriveKidView(t: Transcript, policy: { replyMaxChars: number }): KidView {
  if (!t.final) return none(false);
  if (!t.final.ok || !t.final.text) return none(t.final.ok);
  const { body, bookkeeping, memory } = parseSections(kidSource(t) ?? t.final.text);
  const board = parseBoard(body);
  const { lines } = board.section;
  if (!lines.length && !board.section.acts?.length) return { ...none(true, bookkeeping), memory, warnings: board.warnings.map((w) => w.text), parentText: board.tail };
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
  /** 孩子自己说的;系统发的不给孩子看,为 null */
  question: string | null;
  /** 老师给孩子的话;还在跑或这轮没有 = null */
  reply: string | null;
  /** 老师还在想 */
  pending: boolean;
  /** 本次运行新增的产物 id */
  artifacts: string[];
  /** 讲稿一节(句子与动作) */
  section?: BoardSection | null;
  /** 孩子这条带的作业照片(相对 workspace 根;页面经 /api/kid/image?p= 取);只在孩子自己的问句上 */
  photos?: string[];
  /** 这条是看完小课堂后的第一条:哪份课包、课名、画过的几处(录像照它画);again = 再看一遍又画的那条 */
  lecture?: KidLecture;
  /** 孩子的话怎么记:「给老师看」不写;首页按钮发的(正文就是按钮上的字)不写,从按钮进来后孩子自己说的照写 */
  action?: 'submit';
  fromHome?: true;
  /** 这一轮是实时的:讲稿不配音、嘴照念 */
  live?: true;
  /** 话题第一条:这一节课铺哪种页(课本、孩子拍的作业;一节课的样子另取,/api/kid/lesson) */
  base?: ActivityBase;
  /** 这节课一直听(话题第一条记的,activity 头上 listen: open):孩子端回到这节课照它换 */
  listen?: 'open';
}

/** 索引里的小课堂 → 孩子端(画不带那段话)/ 家长端(带) */
function lectureView(l: NonNullable<ConversationMessage['lecture']>, parent: boolean): KidLecture {
  return { bundle: l.bundle, title: l.title, ...(l.again ? { again: true as const } : {}), ...(l.video ? { video: true as const } : {}), ...(l.marks?.length ? { marks: l.marks.map((m) => ({ atMs: m.atMs, svgMs: m.svgMs, strokes: m.strokes, ...(m.image ? { image: m.image } : {}), ...(parent && m.text ? { text: m.text } : {}) })) } : {}) };
}

/**
 * 对话索引 → 孩子端条目(的机械过滤在服务端做):不带 result / error / 费用 / 家长尾巴;
 * 出错的运行:没有 question 的直接不出现;有 question 的只留问句(老师头像不灰,下一条照常)。
 */
export function kidConversation(index: { messages: readonly ConversationMessage[] }): KidMessage[] {
  const out: KidMessage[] = [];
  const ths = threads(index.messages);
  for (const [i, m] of index.messages.entries()) {
    // 记账那轮是家长晚上起的任务,老师回的「记好了」不是给孩子的话
    if (m.bookkeep || m.tidy) continue;
    const question = m.from === 'kid' ? m.text : null;
    const reply = m.result === 'ok' ? (m.kidText ?? null) : null;
    const pending = m.result === 'running';
    if (question === null && reply === null && !pending) continue;
    const section = m.result === 'ok' && m.section ? m.section : undefined;
    out.push({ job: m.job, thread: ths[i], at: m.at, question, reply, pending, artifacts: reply ? [...m.artifacts] : [], ...(section ? { section } : {}), ...(question !== null && m.photos?.length ? { photos: [...m.photos] } : {}), ...(m.lecture ? { lecture: lectureView(m.lecture, false) } : {}), ...(question !== null && m.action ? { action: m.action } : {}), ...(question !== null && m.via && question.trim() === m.via.label.trim() ? { fromHome: true as const } : {}), ...(m.live ? { live: true as const } : {}), ...(m.base ? { base: m.base } : {}), ...(m.listen ? { listen: m.listen } : {}) });
  }
  return out;
}

/**
 * 家长板书页的一条:形状同 KidMessage,家长多看到的都是可选字段;
 * `question` 不管谁发的都给;记账 / 整理记忆那两种轮也在(旁注写「已记进日记」「整理了记忆」)。
 */
export interface ParentMessage extends KidMessage {
  from: ConversationMessage['from'];
  via?: ConversationMessage['via'];
  action?: ConversationMessage['action'];
  parentText?: string;
  remembered?: string[];
  warnings?: string[];
  /** 不 ok 时的原因;孩子端什么都不出现,家长页出一行 */
  error?: string;
  bookkeep?: ConversationMessage['bookkeep'];
  tidy?: true;
  /** 家长端多看到看的情况:看了多久、看完没、停过几次 */
  lectureWatch?: Pick<NonNullable<ConversationMessage['lecture']>, 'watchedMs' | 'finished' | 'pauses'>;
}

/** 对话索引 → 家长板书页条目:和 kidConversation 同一个循环,差集恰好是 ParentMessage 里多出的字段 */
export function parentConversation(index: { messages: readonly ConversationMessage[] }): ParentMessage[] {
  const out: ParentMessage[] = [];
  const ths = threads(index.messages);
  for (const [i, m] of index.messages.entries()) {
    const reply = m.result === 'ok' ? (m.kidText ?? null) : null;
    const pending = m.result === 'running';
    const section = m.result === 'ok' && m.section ? m.section : undefined;
    out.push({
      job: m.job, thread: ths[i], at: m.at, from: m.from, question: m.text, reply, pending, artifacts: reply ? [...m.artifacts] : [],
      ...(section ? { section } : {}),
      ...(m.photos?.length ? { photos: [...m.photos] } : {}),
      ...(m.via ? { via: m.via } : {}),
      ...(m.action ? { action: m.action } : {}),
      ...(m.parentText ? { parentText: m.parentText } : {}),
      ...(m.remembered?.length ? { remembered: m.remembered } : {}),
      ...(m.warnings?.length ? { warnings: m.warnings } : {}),
      ...(m.result === 'error' ? { error: m.error ?? '没成' } : {}),
      ...(m.bookkeep ? { bookkeep: m.bookkeep } : {}),
      ...(m.tidy ? { tidy: true as const } : {}),
      ...(m.lecture ? { lecture: lectureView(m.lecture, true), lectureWatch: { watchedMs: m.lecture.watchedMs, finished: m.lecture.finished, pauses: m.lecture.pauses } } : {}),
    });
  }
  return out;
}

/** 首页「今天」的一格:今天开了头的一个话题(startedThreads) */
export interface KidTodayThread {
  thread: string;
  /** 话题最后一条的时间(新的在前) */
  at: string;
  /** 从哪进来的:方砖、按钮上的字(预习、检查作业);自由话题是孩子的第一句(截 12 字) */
  label: string;
  /** 课本翻到的那一课(老师最后一次 [[翻 …]] 到的,目录不算) */
  lesson?: string;
  /** 孩子最后发的一张照片(captures/…):还没有预览图时拿它当图 */
  photo?: string;
}

/** 首页「今天」那一格的字最多几个 */
const TODAY_LABEL_MAX = 12;

type SectionLike = { acts?: readonly LineAct[]; lines?: readonly { acts?: readonly LineAct[] }[] };
/** 一节里落到页上的动作(第一句前面的、每一句的) */
const doneActs = (s: SectionLike | null | undefined): LessonAct[] => (s ? [...(s.acts ?? []), ...(s.lines ?? []).flatMap((l) => l.acts ?? [])].flatMap((a) => (a.do ? [a.do] : [])) : []);
/** 一节里最后翻到的那一课(目录不算) */
const lessonOf = (s: SectionLike | null | undefined): string | null => {
  let t: string | null = null;
  for (const a of doneActs(s)) if (a.k === '翻' && a.page.title !== BOOK_TOC) t = a.page.title;
  return t;
};

/**
 * 这一轮让话题开了头没有(2026-11-15,Jack):有孩子参与的图出现了——孩子发了照片;课本翻到了一课(目录不算)、
 * 白纸条上摆了图形。只说话、只铺了目录的不算开头:孩子端不列(首页「今天」),记录照存,家长照看。
 */
export function startsThread(m: { from: ConversationMessage['from']; photos?: readonly string[]; section?: SectionLike | null }): boolean {
  if (m.from === 'kid' && m.photos?.length) return true;
  return Boolean(lessonOf(m.section)) || doneActs(m.section).some((a) => a.k === '摆');
}

/** 一天的索引 → 开了头的话题,新的在前;记账、整理记忆那种系统起的话题不算 */
export function startedThreads(messages: readonly ConversationMessage[]): KidTodayThread[] {
  const ths = threads(messages);
  const by = new Map<string, { t: KidTodayThread; started: boolean; system: boolean; said: string[] }>();
  messages.forEach((m, i) => {
    let e = by.get(ths[i]);
    if (!e) {
      // 新话题按钮上的字(「新话题」)不说明什么:那种用孩子的第一句
      const free = !m.via || m.via.button === 'new' || m.via.button === 'recent';
      const label = (free ? '' : m.via!.label.trim()) || m.activity?.name || '';
      e = { t: { thread: ths[i], at: m.at, label }, started: false, system: m.from === 'system', said: [] };
      by.set(ths[i], e);
    }
    if (m.bookkeep || m.tidy) return;
    if (m.at > e.t.at) e.t.at = m.at;
    if (m.from === 'kid' && m.text.trim()) e.said.push(m.text.replace(/\s+/g, ' ').trim());
    if (m.from === 'kid' && m.photos?.length) e.t.photo = m.photos[m.photos.length - 1];
    if (startsThread(m)) e.started = true;
    const lesson = lessonOf(m.section);
    if (lesson) e.t.lesson = lesson;
  });
  const out: KidTodayThread[] = [];
  for (const e of by.values()) {
    if (!e.started || e.system) continue;
    if (!e.t.label) { const cps = Array.from(e.said[0] ?? ''); e.t.label = cps.length > TODAY_LABEL_MAX ? `${cps.slice(0, TODAY_LABEL_MAX).join('')}…` : cps.join(''); }
    out.push(e.t);
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
