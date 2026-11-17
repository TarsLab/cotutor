/**
 * 孩子端老师页的纯逻辑:讲稿一句的清洗、板上的节(老师开始写、写完、出错撤掉)、输入条的状态。
 * 这份文件两处共用:服务端(解析器、测试)与孩子端页面——kid-page.ts 把它剥掉类型内联进 <script>,
 * 所以**不能有运行时 import、不能碰 DOM、不能用 enum / namespace**(Node 的 stripTypeScriptTypes 只剥类型)。
 * 2026-11-17(《多模态教学harness-开发计划》阶段 5)起课里没有卡:排卡、铺卡、标注、提问卡、交卡的那些删了;老师对页做什么是讲稿里的动作(src/board/acts.ts)。
 */

// 讲稿的数据类型(进索引、下发孩子端的那份契约)在 src/schema/board.ts;这里只 import type(剥类型时一起没了,内联照样成立)
import type { BoardCard, Device, BoardLine, BoardSection } from '../schema/board.ts';
export type { BoardCard, Device, BoardLine, BoardSection };

/** 去掉讲稿一句里的方括号(念的时候不念括号;以前标注卡上的词,2026-11-17 起没有卡了,老师写了照样去掉) */
export function plainLine(line: string): string {
  return line.replace(/\[([^\[\]]+)\]/g, '$1');
}

/** 端:宽 ≥ 900 且横 → 平板横屏;短边 ≥ 600 → 平板竖屏;其余手机 */
export function deviceFor(width: number, height: number): Device {
  if (width >= 900 && width > height) return 'tablet-landscape';
  if (Math.min(width, height) >= 600) return 'tablet-portrait';
  return 'phone';
}

// ---- 拼音 ----

const TONE_MARKS: Record<string, string> = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', ü: 'ǖǘǚǜ' };

/** shi4 → shì:调号标在 a / e 上,ou 标在 o 上,否则标在最后一个元音上;5 是轻声不标;认不出的原样 */
export function toneMark(syl: string): string {
  const m = /^([a-zü]+)([1-5])$/.exec(syl.toLowerCase().replace(/v/g, 'ü'));
  if (!m) return syl;
  const [, base, t] = m;
  if (t === '5') return base;
  let at = base.search(/[ae]/);
  if (at < 0) at = base.includes('ou') ? base.indexOf('o') : Math.max(...Array.from(base).map((c, i) => (TONE_MARKS[c] ? i : -1)));
  if (at < 0) return base;
  return base.slice(0, at) + TONE_MARKS[base[at]][Number(t) - 1] + base.slice(at + 1);
}

export function isQuestion(text: string): boolean {
  const t = text.trim();
  return t.endsWith('?') || t.endsWith('？');
}

/** 孩子端一条带的小课堂:画的几处(时刻、几笔、截图;录像照它画);家长端的画多一段老师拿到的话(text);again = 再看一遍又画的那条 */
export interface KidLecture {
  bundle: string;
  title: string;
  again?: true;
  video?: true;
  marks?: { atMs: number; svgMs: number; strokes: [number, number][][]; text?: string; image?: string }[];
}

/** 孩子端条目里页面用到的字段(与 kid-view 的 KidMessage 兼容) */
export interface BoardMessage {
  job: string;
  at?: string;
  question: string | null;
  reply: string | null;
  pending: boolean;
  section?: BoardSection | null;
  /** 孩子这条带的作业照片(相对 workspace 根) */
  photos?: string[];
  /** 看完小课堂后的第一条 */
  lecture?: KidLecture;
  /** 孩子这条不是说的话:submit = 「给老师看」 */
  action?: 'submit';
  /** 首页按钮发的:按钮上的字,不是孩子说的 */
  fromHome?: boolean;
  /** 实时的一轮(讲稿嘴照念):只给字幕重放、录像用 */
  live?: boolean;
}

/** 孩子的一句话:text 是显示的,full 是原话 */
export interface KidSaid {
  text: string;
  full: string;
}

export interface BoardEntry extends BoardSection {
  job: string;
  at?: string;
  /** 老师还在说:讲稿只增不改;整轮跑完换成正式的一节 */
  partial?: boolean;
  /** 这一节答的是看完小课堂后的第一问 */
  lecture?: KidLecture;
  /** 孩子引出这一节的那句话(左栏 #lv-kid、录像用) */
  said?: KidSaid;
}

/** 只发照片时应用补的那句(runner 的「(拍了一张)」「(拍了 N 张)」):不是孩子说的 */
const PHOTO_FILLER = /^\(拍了(一|\s*\d+\s*)张\)$/;

/**
 * 每条孩子的话:交了「给老师看」、首页按钮、空的、只发照片时补的那句不记;按 job 给,还在跑的那条也有(刚发出去先挂上)。
 */
export function kidSaid(messages: readonly BoardMessage[]): Map<string, KidSaid> {
  const out = new Map<string, KidSaid>();
  for (const m of messages) {
    const q = (m.question ?? '').trim();
    if (!q || m.action || m.fromHome || (m.photos?.length && PHOTO_FILLER.test(q))) continue;
    out.set(m.job, { text: q, full: q });
  }
  return out;
}

/**
 * 孩子端条目 → 一节一节(没有 section 的条目不出节);
 * 孩子的话挂在它引出的那一节上(said);还在跑的只有带 partial 讲稿(流式,已有句或动作)才出节且标 partial,其余不出。
 */
export function sectionsFromMessages(messages: readonly BoardMessage[]): BoardEntry[] {
  const out: BoardEntry[] = [];
  const says = kidSaid(messages);
  const has = (s: BoardSection): boolean => Boolean(s.lines.length || s.acts?.length);
  for (const m of messages) {
    const k = says.get(m.job);
    const at = { ...(m.at ? { at: m.at } : {}), ...(m.lecture ? { lecture: m.lecture } : {}), ...(k ? { said: k } : {}) };
    if (m.pending) {
      if (m.section && m.section.partial && has(m.section)) out.push({ job: m.job, ...at, lines: m.section.lines, ...(m.section.acts ? { acts: m.section.acts } : {}), partial: true });
      continue;
    }
    if (m.section && has(m.section)) out.push({ job: m.job, ...at, lines: m.section.lines, ...(m.section.acts ? { acts: m.section.acts } : {}) });
  }
  return out;
}

/** 板上的位置。讲稿由嘴照念(runtime/delivery/player.ts 的 liveStep),这里的状态只剩
 *  thinking = 老师还在写 · waiting = 写完了、末句是问句 · done = 写完了 · idle = 还没有。
 *  playing 只出现在录像里孩子的屏幕(嘴在念这一句),孩子端自己不会进 */
export type PlayStatus = 'idle' | 'playing' | 'waiting' | 'done' | 'thinking';

export interface PlayerState {
  section: number;
  line: number;
  status: PlayStatus;
}

/** 打开页面时的位置:停在最后一节末尾;末句是问句就等着 */
export function playerAtEnd(sections: readonly BoardSection[]): PlayerState {
  if (!sections.length) return { section: -1, line: -1, status: 'idle' };
  const section = sections.length - 1;
  const line = sections[section].lines.length - 1;
  const last = sections[section].lines[line];
  return { section, line, status: last && last.ask ? 'waiting' : 'done' };
}

// ---- 板上的节:老师开始写、写完、出错撤掉、整节到了;页面的 reset(换老师)、halt(停声音)。
// 页面只照单执行回来的「要做的事」;事件与状态的组合在 tests/player.test.ts 逐项覆盖 ----

export interface PlayerModel {
  state: PlayerState;
}

/** step 要读的页面状态(只读) */
export interface PlayerCtx {
  sections: readonly BoardSection[];
}

export type PlayerEvent =
  | { type: 'reset' }
  | { type: 'halt' }
  | { type: 'liveStart'; section: number }
  | { type: 'liveFinal'; section: number }
  | { type: 'liveDropped' }
  | { type: 'fresh'; sections: number[] };

/** stop 只停声音(点开的单词卡、田字格);render = 重画字幕、输入条 */
export type PlayerEffect =
  | { kind: 'stop' }
  | { kind: 'render' };

export function initialPlayer(): PlayerModel {
  return { state: { section: -1, line: -1, status: 'idle' } };
}

export function step(model: PlayerModel, ev: PlayerEvent, ctx: PlayerCtx): { model: PlayerModel; effects: PlayerEffect[] } {
  const fx: PlayerEffect[] = [];
  let m = model;
  const secs = ctx.sections;
  switch (ev.type) {
    case 'reset':
      m = initialPlayer();
      break;
    case 'halt':
      fx.push({ kind: 'stop' });
      break;
    case 'liveStart':
      m = { state: { section: ev.section, line: -1, status: 'thinking' } };
      fx.push({ kind: 'render' });
      break;
    case 'liveFinal':
      if (m.state.section !== ev.section || m.state.status !== 'thinking') break;
      m = { state: playerAtEnd(secs) };
      fx.push({ kind: 'render' });
      break;
    case 'liveDropped':
      fx.push({ kind: 'stop' });
      m = { state: playerAtEnd(secs) };
      fx.push({ kind: 'render' });
      break;
    case 'fresh':
      if (!ev.sections.length) break;
      m = { state: playerAtEnd(secs) };
      fx.push({ kind: 'render' });
      break;
  }
  return { model: m, effects: fx };
}

export type BarMode = 'idle' | 'typing' | 'holding';
export type BarEvent = 'tap' | 'holdStart' | 'holdEnd' | 'holdCancel' | 'sent' | 'blur';

/** 输入条中间那段:点 → 打字;按住 → 说话;松手 / 上滑取消 / 发出 / 失焦 → 回到闲置 */
export function barNext(mode: BarMode, ev: BarEvent): BarMode {
  switch (ev) {
    case 'holdStart':
      return 'holding';
    case 'holdEnd':
    case 'holdCancel':
      return mode === 'holding' ? 'idle' : mode;
    case 'tap':
      return mode === 'idle' ? 'typing' : mode;
    case 'sent':
    case 'blur':
      return 'idle';
    default:
      return mode;
  }
}

/** 一句念多久(毫秒):按字数估(mock 的假嘴、录像) */
export function lineDurationMs(text: string): number {
  return Math.max(1200, Array.from(plainLine(text)).length * 260);
}
