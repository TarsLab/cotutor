/**
 * 板书解析器:老师的回复正文(已剥掉「待裁量」「转交」段)→ 一节 BoardSection。
 * 三条规则(《板书卡片设计.md》§2):围栏 = 卡(标签第一个词是 kind),普通行 = 讲稿一句,第一个 H2 起是给家长的尾巴。
 * 讲稿句里 [词] 是标注(落到第一张含这个词的卡,整节找,卡在前在后都行),[[名 参数]] 是对上一张卡的动作(cue)。
 * partial 模式给流式用:没闭合的围栏和没换行结束的最后一行压着不算,下次整段重解析自然补上。
 * 永不抛错:围栏没闭合当到文末,卡解析不出退成文字卡并记一句 warning。
 * spans 是「这张卡 / 这句话是原文哪几行」,家长端「看原文」据此在原文旁边标出解析器怎么读的;孩子端的 BoardSection 不带它。
 */
import { parseCard } from '../cards/index.ts';
import { anchorMarks, isHeading, isQuestion, phrasesIn, plainLine, type BoardCard, type BoardCue, type BoardLine, type BoardSection } from './kid-board.ts';
import { parseSections } from './sections.ts';
import type { Handoff, HoldupAsk } from '../schema/index.ts';

export interface ParseBoardOptions {
  /** 文本还在长(流式):压住没闭合的围栏与没换行结束的最后一行 */
  partial?: boolean;
}

/** 解析提醒;line = 出问题的那一行(0 起,相对传进来的文本),没有行的就不带 */
export interface BoardWarning {
  text: string;
  line?: number;
}

/** 行区间 [起, 止],含两端,0 起 */
export type LineSpan = [number, number];

export interface BoardSpans {
  /** 与 section.cards 同序 */
  cards: LineSpan[];
  /** 与 section.lines 同序 */
  lines: LineSpan[];
  /** 第一个 H2 起到文末 */
  tail: LineSpan | null;
}

export interface ParsedBoard {
  section: BoardSection;
  /** 没解析成的卡等,家长视图转录里显示;孩子端不报 */
  warnings: BoardWarning[];
  /** 第一个 H2 起的尾巴(「## 家长」等,原文含标题行);没有 = 空串 */
  tail: string;
  spans: BoardSpans;
}

/** 尾巴的末行:掐掉后面的空行,免得「看原文」把末尾空行也染成家长段 */
function tailTo(lines: readonly string[], from: number): number {
  let k = lines.length - 1;
  while (k > from && !lines[k].trim()) k--;
  return k;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const H2 = /^##\s+\S/;
const CUE = /\[\[([^\[\]]+)\]\]/g;

function fenceClose(line: string, fence: string): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return Boolean(m && m[1][0] === fence[0] && m[1].length >= fence.length);
}

/** 讲稿一行的清洗:去掉老师不该写但常写的标题号、列表号、引用号、粗体号;整行的 HTML 注释不算话 */
export function cleanSpeech(line: string): string {
  const t = line.trim();
  if (/^<!--.*-->$/.test(t)) return '';
  return t
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/\*\*/g, '')
    .trim();
}

interface RawLine {
  text: string;
  anchor: number | null;
  cues: BoardCue[];
  line: number;
}

/** 句子锚到上一张卡;小节标题行不算卡,跳过它 */
function lastCard(cards: readonly BoardCard[]): number | null {
  for (let k = cards.length - 1; k >= 0; k--) if (!isHeading(cards[k])) return k;
  return null;
}

function rawLine(line: string, cards: readonly BoardCard[], at: number): RawLine {
  const anchor = lastCard(cards);
  const cues: BoardCue[] = [];
  const text = line
    .replace(CUE, (_, inner: string) => {
      const [name, ...rest] = inner.trim().split(/\s+/);
      if (name && anchor !== null) cues.push({ card: anchor, name: name.toLowerCase(), ...(rest.length ? { arg: rest.join(' ') } : {}) });
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text, anchor, cues, line: at };
}

export function parseBoard(text: string, opts: ParseBoardOptions = {}): ParsedBoard {
  const partial = opts.partial === true;
  const all = text.split('\n');
  const lines = partial && !text.endsWith('\n') ? all.slice(0, -1) : all;
  const cards: BoardCard[] = [];
  const cardSpans: LineSpan[] = [];
  const raws: RawLine[] = [];
  const warnings: BoardWarning[] = [];
  let tail: string[] | null = null;
  let tailFrom = -1;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (tail) {
      tail.push(line);
      i++;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const fence = open[1];
      const tag = open[2].trim();
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      for (; j < lines.length; j++) {
        if (fenceClose(lines[j], fence)) {
          closed = true;
          break;
        }
        body.push(lines[j]);
      }
      if (!closed && partial) break;
      if (!closed) warnings.push({ text: `围栏没闭合(${tag || '无标签'}),当到文末`, line: i });
      const r = parseCard(tag, body.join('\n'));
      cards.push(r.card);
      cardSpans.push([i, closed ? j : Math.max(i, j - 1)]);
      if (r.warning) warnings.push({ text: r.warning, line: i });
      i = closed ? j + 1 : j;
      continue;
    }
    if (H2.test(line)) {
      tail = [line];
      tailFrom = i;
      i++;
      continue;
    }
    const speech = cleanSpeech(line);
    if (speech) raws.push(rawLine(speech, cards, i));
    i++;
  }
  // 标注整节找(老师把卡写在句子后面也认),所以卡收齐了再落
  const kept = raws.filter((r) => r.text);
  const out: BoardLine[] = kept.map((r) => {
    const marks = anchorMarks(cards, phrasesIn(r.text));
    const plain = plainLine(r.text);
    return { text: plain, audio: null, marks, ask: isQuestion(plain), anchor: r.anchor, cues: r.cues };
  });
  return {
    section: { cards, lines: out, ...(partial ? { partial: true } : {}) },
    warnings,
    tail: tail ? tail.join('\n').trim() : '',
    spans: {
      cards: cardSpans,
      lines: kept.map((r): LineSpan => [r.line, r.line]),
      tail: tail ? [tailFrom, tailTo(lines, tailFrom)] : null,
    },
  };
}

/** 原文一行的角色:解析器把它当什么了 */
export type SourceRole =
  /** 讲稿一句(念出来) */
  | 'say'
  /** 卡的围栏(开头行 / 中间 / 结尾) */
  | 'card'
  /** 第一个 H2 起给家长的尾巴 */
  | 'tail'
  /** 被「## 待裁量」「## 转交」吃掉,不进板书 */
  | 'section'
  /** 空行 */
  | 'blank'
  /** 落在地上的行:清洗完是空的(整行注释等) */
  | 'drop';

export interface SourceRow {
  /** 0 起 */
  line: number;
  text: string;
  role: SourceRole;
  /** 右边那句「卡 2 · text step」「讲稿 1 · 播」 */
  label?: string;
  /** role=card 时是第几张卡(0 起);role=say 时是第几句 */
  index?: number;
  /** 围栏开头那行 */
  open?: boolean;
}

export interface AnnotatedSource {
  rows: SourceRow[];
  /** 行号换算成原文的 */
  warnings: BoardWarning[];
  section: BoardSection;
  holdup: HoldupAsk | null;
  handoff: Handoff | null;
  tail: string;
}

const SECTION_HEAD = /^##\s+(.+?)\s*$/;

/**
 * 家长端「看原文」用:把老师原文的每一行标上解析器怎么读的。
 * 不另写一套解析——真跑 parseSections + parseBoard,再把它们的行号映回原文,所以永远不会和真解析漂开。
 */
export function annotateSource(text: string): AnnotatedSource {
  const src = text.split('\n');
  const { body, holdup, handoff, lineMap } = parseSections(text);
  const board = parseBoard(body);
  const rows: SourceRow[] = src.map((t, line) => ({ line, text: t, role: t.trim() ? 'drop' : 'blank' }));
  // 固定段吃掉的行:不在 lineMap 里的非空行,标题从上面最近的那个 H2 取
  const keptSet = new Set(lineMap);
  let head = '';
  for (let i = 0; i < src.length; i++) {
    const m = SECTION_HEAD.exec(src[i]);
    if (m) head = m[1];
    if (keptSet.has(i) || !src[i].trim()) continue;
    rows[i].role = 'section';
    rows[i].label = head ? `段「${head}」· 不进板书` : '不进板书';
  }
  const at = (bodyLine: number): number | undefined => lineMap[bodyLine];
  board.spans.cards.forEach((span, n) => {
    const card = board.section.cards[n];
    for (let b = span[0]; b <= span[1]; b++) {
      const i = at(b);
      if (i === undefined) continue;
      rows[i].role = 'card';
      rows[i].index = n;
      if (b === span[0]) {
        rows[i].open = true;
        const style = typeof card.props.style === 'string' ? ` ${card.props.style}` : '';
        rows[i].label = `卡 ${n + 1} · ${card.kind}${style}`;
      }
    }
  });
  board.spans.lines.forEach((span, n) => {
    const i = at(span[0]);
    if (i === undefined) return;
    rows[i].role = 'say';
    rows[i].index = n;
    const l = board.section.lines[n];
    rows[i].label = `讲稿 ${n + 1}${l.ask ? ' · 问句,停下等' : ' · 播'}`;
  });
  if (board.spans.tail) {
    for (let b = board.spans.tail[0]; b <= board.spans.tail[1]; b++) {
      const i = at(b);
      if (i === undefined) continue;
      rows[i].role = 'tail';
      if (b === board.spans.tail[0]) rows[i].label = '家长尾巴 · 孩子看不到';
    }
  }
  return {
    rows,
    warnings: board.warnings.map((w) => ({ text: w.text, ...(w.line !== undefined && at(w.line) !== undefined ? { line: at(w.line) } : {}) })),
    section: board.section,
    holdup,
    handoff,
    tail: board.tail,
  };
}
