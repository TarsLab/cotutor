/**
 * 板书(孩子端老师页)的纯逻辑:卡片 JSON 契约、标注锚点、播放状态机、字幕行与输入条的状态。
 * 这份文件两处共用:服务端(测试、将来的小语法解析器)与孩子端页面——kid-page.ts 把它剥掉类型内联进 <script>,
 * 所以**不能有运行时 import、不能碰 DOM、不能用 enum / namespace**(Node 的 stripTypeScriptTypes 只剥类型)。
 *
 * 契约的分工:老师写「## 板书」小语法(待定稿),服务端解析成下面的 BoardSection JSON 放进对话索引;
 * 孩子端只认 JSON,不认小语法。小语法怎么改,页面都不用动。
 */

/** 一张卡;`type` 决定样子,标注样式也按它定(markStyle) */
export type BoardCard =
  | { type: 'cover'; title: string; subtitle?: string }
  | { type: 'oneline'; text: string }
  | { type: 'section'; title: string }
  | { type: 'types'; items: { name: string; note?: string }[] }
  | { type: 'fact'; text: string }
  | { type: 'list'; items: { lead: string; text?: string }[] }
  | { type: 'image'; caption: string }
  | { type: 'quote'; text: string }
  | { type: 'checklist'; items: string[] }
  | { type: 'think'; question: string; back?: string }
  | { type: 'problem'; text: string }
  | { type: 'core'; title?: string; text: string }
  | { type: 'formula'; text: string }
  | { type: 'calc'; title: string; text: string }
  | { type: 'figure'; caption?: string }
  | { type: 'text'; text: string };

export type CardType = BoardCard['type'];

/** 一处敲黑板:第几张卡上的哪个词 */
export interface BoardMark {
  card: number;
  phrase: string;
}

/** 讲稿的一句:配音文件(没有 = 浏览器合成)、这句念到时要画的标注、是不是问句(末句问句 → 停下等) */
export interface BoardLine {
  text: string;
  audio: string | null;
  marks: BoardMark[];
  ask: boolean;
}

/** 一节板书 = 一轮回复:卡整块铺,讲稿逐句播 */
export interface BoardSection {
  cards: BoardCard[];
  lines: BoardLine[];
}

/** 一张卡上所有能被标注的文字 */
export function cardTexts(card: BoardCard): string[] {
  switch (card.type) {
    case 'cover':
      return [card.title, card.subtitle ?? ''];
    case 'section':
      return [card.title];
    case 'types':
      return card.items.flatMap((i) => [i.name, i.note ?? '']);
    case 'list':
      return card.items.flatMap((i) => [i.lead, i.text ?? '']);
    case 'checklist':
      return [...card.items];
    case 'think':
      return [card.question, card.back ?? ''];
    case 'core':
      return [card.title ?? '', card.text];
    case 'calc':
      return [card.title, card.text];
    case 'image':
      return [card.caption];
    case 'figure':
      return [card.caption ?? ''];
    default:
      return [card.text];
  }
}

/** 讲稿里方括号的词落到哪张卡:第一张含这个词的卡;找不到的词丢掉(只出字幕,不报错) */
export function anchorMarks(cards: readonly BoardCard[], phrases: readonly string[]): BoardMark[] {
  const out: BoardMark[] = [];
  for (const raw of phrases) {
    const phrase = raw.trim();
    if (!phrase) continue;
    const card = cards.findIndex((c) => cardTexts(c).some((t) => t.includes(phrase)));
    if (card >= 0) out.push({ card, phrase });
  }
  return out;
}

/** 讲稿一句里的 [词] → 词列表;顺序保留 */
export function phrasesIn(line: string): string[] {
  const out: string[] = [];
  const re = /\[([^\[\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1]);
  return out;
}

/** 去掉讲稿一句里的方括号(念的时候不念括号) */
export function plainLine(line: string): string {
  return line.replace(/\[([^\[\]]+)\]/g, '$1');
}

export type MarkStyle = 'marker' | 'circle' | 'wave' | 'box' | 'green';

/** 笔的样子按卡定:一句话看懂涂荧光笔、类型格画圈、列表加框、讲题的绿底、其余波浪线 */
export function markStyle(type: CardType): MarkStyle {
  switch (type) {
    case 'oneline':
    case 'cover':
      return 'marker';
    case 'types':
      return 'circle';
    case 'list':
    case 'checklist':
      return 'box';
    case 'core':
    case 'calc':
    case 'formula':
    case 'problem':
      return 'green';
    default:
      return 'wave';
  }
}

export function isQuestion(text: string): boolean {
  const t = text.trim();
  return t.endsWith('?') || t.endsWith('?');
}

/** 孩子端条目里页面用到的字段(与 kid-view 的 KidMessage 兼容) */
export interface BoardMessage {
  job: string;
  question: string | null;
  reply: string | null;
  audio: string | null;
  pending: boolean;
  section?: BoardSection | null;
}

export interface BoardEntry extends BoardSection {
  job: string;
}

function lineFrom(text: string, audio: string | null): BoardLine {
  return { text, audio, marks: [], ask: isQuestion(text) };
}

/**
 * 孩子端条目 → 板书节。有 section 用 section(讲稿空就把 reply 当一句);只有 reply 的退成一张文字卡 + 一句讲稿;
 * 孩子的话不上板;还在跑 / 没回复的不出节。
 */
export function sectionsFromMessages(messages: readonly BoardMessage[]): BoardEntry[] {
  const out: BoardEntry[] = [];
  for (const m of messages) {
    if (m.section && m.section.cards.length) {
      const lines = m.section.lines.length ? m.section.lines : m.reply ? [lineFrom(m.reply, m.audio)] : [];
      out.push({ job: m.job, cards: m.section.cards, lines });
    } else if (m.reply) out.push({ job: m.job, cards: [{ type: 'text', text: m.reply }], lines: [lineFrom(m.reply, m.audio)] });
  }
  return out;
}

/** 一节在目录里的名字:封面 > 小节 > 题目 > 第一张有字的卡;截到 14 个字 */
export function sectionTitle(s: BoardSection): string {
  const pick = (): string => {
    for (const c of s.cards) if (c.type === 'cover') return c.title;
    for (const c of s.cards) if (c.type === 'section') return c.title;
    for (const c of s.cards) if (c.type === 'problem') return c.text;
    for (const c of s.cards) {
      const t = cardTexts(c).find((x) => x.trim());
      if (t) return t;
    }
    return '';
  };
  const cps = Array.from(pick().trim());
  return cps.length > 14 ? `${cps.slice(0, 14).join('')}…` : cps.join('');
}

export type PlayStatus = 'idle' | 'playing' | 'paused' | 'waiting' | 'done';

export interface PlayerState {
  section: number;
  line: number;
  status: PlayStatus;
}

/** 打开页面时的位置:停在最后一节末尾;末句是问句就等着(继续钮在) */
export function playerAtEnd(sections: readonly BoardSection[]): PlayerState {
  if (!sections.length) return { section: -1, line: -1, status: 'idle' };
  const section = sections.length - 1;
  const line = sections[section].lines.length - 1;
  const last = sections[section].lines[line];
  return { section, line, status: last && last.ask ? 'waiting' : 'done' };
}

/** 新来一节:从它第一句开始播;没讲稿就直接算完 */
export function startSection(index: number, sections: readonly BoardSection[]): PlayerState {
  const s = sections[index];
  if (!s || !s.lines.length) return { section: index, line: -1, status: 'done' };
  return { section: index, line: 0, status: 'playing' };
}

/**
 * 一句播完往下走:同节还有句 → 下一句;没了 → 有下一节就进下一节(孩子已经答过了,不用等);
 * 没下一节且末句是问句 → 停下等;否则完。
 */
export function advance(state: PlayerState, sections: readonly BoardSection[]): PlayerState {
  const s = sections[state.section];
  if (!s) return { ...state, status: 'done' };
  if (state.line < s.lines.length - 1) return { section: state.section, line: state.line + 1, status: 'playing' };
  if (state.section < sections.length - 1) return startSection(state.section + 1, sections);
  const last = s.lines[state.line];
  return { ...state, status: last && last.ask ? 'waiting' : 'done' };
}

/** 当前节里播到这句为止该画上的标注(打开页面或跳到某句时一次画齐) */
export function marksUpTo(sections: readonly BoardSection[], state: PlayerState): BoardMark[] {
  const s = sections[state.section];
  if (!s || state.line < 0) return [];
  return s.lines.slice(0, state.line + 1).flatMap((l) => l.marks);
}

export interface SubtitleInput {
  state: PlayerState;
  sections: readonly BoardSection[];
  /** 孩子刚说的话,短暂回显(拍板 2026-09-10) */
  echo: string | null;
  pending: boolean;
  /** 等老师时那句人设话 */
  thinking: string;
  limit: boolean;
}

export interface SubtitleView {
  text: string;
  kind: 'line' | 'echo' | 'thinking' | 'limit' | 'empty';
  right: 'pause' | 'play' | 'continue' | 'none';
}

/** 字幕行:上限 > 回显孩子的话 > 等老师 > 当前句(按播放状态定右侧的钮) */
export function subtitleFor(i: SubtitleInput): SubtitleView {
  if (i.limit) return { text: '今天聊够啦,明天再来', kind: 'limit', right: 'none' };
  if (i.echo) return { text: i.echo, kind: 'echo', right: 'none' };
  if (i.pending) return { text: i.thinking, kind: 'thinking', right: 'none' };
  const line = i.sections[i.state.section]?.lines[i.state.line];
  const text = line ? plainLine(line.text) : '';
  switch (i.state.status) {
    case 'playing':
      return { text, kind: 'line', right: 'pause' };
    case 'paused':
      return { text, kind: 'line', right: 'play' };
    case 'waiting':
      return { text, kind: 'line', right: 'continue' };
    case 'done':
      return { text, kind: text ? 'line' : 'empty', right: 'none' };
    default:
      return { text: '', kind: 'empty', right: 'none' };
  }
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

export type Layout = 'phone' | 'tablet';

/** 平板横屏才用两列板书 + 左栏;竖屏与手机一律单列 */
export function layoutFor(width: number, height: number): Layout {
  return width >= 900 && width > height ? 'tablet' : 'phone';
}

/** 没配音也没浏览器合成时,一句停多久(毫秒):按字数估 */
export function lineDurationMs(text: string): number {
  return Math.max(1200, Array.from(plainLine(text)).length * 260);
}
