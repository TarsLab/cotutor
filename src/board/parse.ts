/**
 * 讲稿解析器:老师的回复正文(已剥掉「记账」段)→ 一节 BoardSection(讲稿一句一行 + 动作)。
 * 规则:普通行 = 讲稿一句,[[名 参数]] 在 ./acts.ts 读——老师的动作(看、圈…)记在这句上、念完生效;只有动作的一行跟着上一句,第一句前面的记在这一节上、马上生效;
 * `[[请 说 词]]` 另外记成这句的 echo(念完等孩子说)。写错的、不认得的丢掉,记一行 warning。第一个 H2 起是给家长的尾巴。
 * 课里没有卡:老师写了围栏,整块不上页、不念,记一行 warning。
 * 首页文件(老师牌、听写牌)的围栏还是卡:parseHomeBody。
 * partial 模式给流式用:没闭合的围栏和没换行结束的最后一行压着不算,下次整段重解析自然补上。永不抛错。
 * spans 是「这句话 / 这块围栏是原文哪几行」,家长端「看原文」据此在原文旁边标出解析器怎么读的;孩子端的 BoardSection 不带它。
 */
import { parseCard } from './cards/index.ts';
import { isQuestion, plainLine, type BoardCard, type BoardLine, type BoardSection } from './presentation.ts';
import { parseSections } from './sections.ts';
import { actParts, readMarks } from './acts.ts';
import { sayFirst } from './echo.ts';
import type { LineAct } from '../schema/index.ts';

export interface ParseBoardOptions {
  /** 文本还在长(流式):压住没闭合的围栏与没换行结束的最后一行 */
  partial?: boolean;
}

/** 解析提醒;line = 出问题的那一行(0 起,相对传进来的文本),没有行的就不带 */
export interface BoardWarning {
  text: string;
  line?: number;
  /** 首页的这张卡没照标签解析成(退了文字卡 / 代码卡) */
  fallback?: boolean;
}

/** 行区间 [起, 止],含两端,0 起 */
export type LineSpan = [number, number];

export interface BoardSpans {
  /** 老师写的围栏(课里不上页):每块的起止 */
  fences: LineSpan[];
  /** 与 section.lines 同序 */
  lines: LineSpan[];
  /** 第一个 H2 起到文末 */
  tail: LineSpan | null;
  /** 写成正文的工具调用(TOOL_OPEN 起到收尾行),不进讲稿 */
  toolCalls: LineSpan[];
}

export interface ParsedBoard {
  section: BoardSection;
  /** 写错的动作、不上页的围栏等,家长视图转录里显示;孩子端不报 */
  warnings: BoardWarning[];
  /** 第一个 H2 起的尾巴(老师写的任何标题段,原文含标题行);没有 = 空串 */
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

function fenceClose(line: string, fence: string): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return Boolean(m && m[1][0] === fence[0] && m[1].length >= fence.length);
}

/**
 * 写成正文的工具调用:这轮没有那个工具时,qwen 照它自己的格式把调用写进正文——`<tool_call>` 独占一行起、`</tool_call>` 止
 * (中间是 `<function=Read>` `<parameter=…>` 几行或一行 JSON),也见过不带外层的 `<function=名>` … `</function>`。
 * 整块不是讲稿:板上不出、嘴不念(10-21 Ray 交画那轮,这 7 行在板上、嘴念了 25 秒)
 */
const TOOL_OPEN = /^\s*<(tool_call|function=[^>\s]+)>\s*$/;
const toolClose = (open: string): RegExp => (open === 'tool_call' ? /^\s*<\/tool_call>\s*$/ : /^\s*<\/function>\s*$/);
/** 块里调的是哪个工具:`<function=名>` 或 JSON 的 "name" */
function toolName(block: readonly string[]): string {
  for (const l of block) {
    const m = /<function=([^>\s]+)>/.exec(l) ?? /"name"\s*:\s*"([^"]+)"/.exec(l);
    if (m) return m[1];
  }
  return '?';
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
  line: number;
  echo?: BoardLine['echo'];
  acts: LineAct[];
  /** [[ ]] 里写错的、不认得的:丢掉,给家长记一行 */
  bad: string[];
}

/**
 * 一行讲稿:[[ ]] 都在 ./acts.ts 读——老师的动作(看、圈…)记在这句上、念完生效。
 * `[[请 说 词]]` 除了是动作(开放说),还记成这句的 echo:念完停下等孩子说「词」;老师这句里自己说了那个词是跟我说,没说是你先说(一句写了几个,算最后一个)
 */
function rawLine(line: string, at: number): RawLine {
  const acts: LineAct[] = [];
  const bad: string[] = [];
  let say = '';
  const read = readMarks(line);
  for (const m of read.marks) {
    if (m.kind === 'act') {
      acts.push(m.act);
      if (m.warn) bad.push(m.warn);
      if (m.act.name === '请') { const p = actParts(m.act); if (p.name === '请' && p.say) say = p.say; }
    }
    else bad.push(`讲稿里的 [[${m.text}]] 没做:${m.why}`);
  }
  const text = read.text;
  const base = { text, line: at, acts, bad };
  if (!say) return base;
  return { ...base, echo: { word: say, ...(sayFirst(text, say) ? { say: true as const } : {}) } };
}

/** 一句讲稿交给嘴时要带的:放小课堂里的一段(这句的 [[看 0:19–0:30]] 落在小课堂上)、请孩子说的 echo(runner 的 line 事件、mock 的假嘴都用它) */
export function lineFlags(line: { acts?: readonly LineAct[]; echo?: BoardLine['echo'] }): { play?: true; echo?: NonNullable<BoardLine['echo']> } {
  return { ...(playsLecture(line) ? { play: true as const } : {}), ...(line.echo ? { echo: line.echo } : {}) };
}

/** 这句念完放小课堂里的一段(这句有落在小课堂上的「看」,带 at):实时时服务端在这句之后等孩子端放完再交讲稿(src/runtime/delivery/queue.ts) */
export function playsLecture(line: { acts?: readonly LineAct[] }): boolean {
  return (line.acts ?? []).some((a) => a.do?.k === '看' && Boolean(a.do.at));
}

/** 正文扫一遍:围栏(标签、正文、起止)、普通行、写成正文的工具调用、第一个 H2 起的尾巴 */
interface Scanned {
  fences: { tag: string; body: string[]; span: LineSpan; closed: boolean }[];
  says: { text: string; line: number }[];
  toolCalls: LineSpan[];
  tail: string[] | null;
  tailFrom: number;
  /** 压住的行数之后的都不算(流式) */
  lines: string[];
  warnings: BoardWarning[];
}

function scan(text: string, partial: boolean): Scanned {
  const all = text.split('\n');
  const lines = partial && !text.endsWith('\n') ? all.slice(0, -1) : all;
  const out: Scanned = { fences: [], says: [], toolCalls: [], tail: null, tailFrom: -1, lines, warnings: [] };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (out.tail) {
      out.tail.push(line);
      i++;
      continue;
    }
    const call = TOOL_OPEN.exec(line);
    if (call) {
      const close = toolClose(call[1]);
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j])) j++;
      // 和围栏一样:流式时没收尾的块压着,后面的也不出
      if (j >= lines.length && partial) break;
      const end = Math.min(j, lines.length - 1);
      out.toolCalls.push([i, end]);
      out.warnings.push({ text: `老师把工具调用写成了正文(${toolName(lines.slice(i, end + 1))}),不念、不上页`, line: i });
      i = end + 1;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const fence = open[1];
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
      out.fences.push({ tag: open[2].trim(), body, span: [i, closed ? j : Math.max(i, j - 1)], closed });
      i = closed ? j + 1 : j;
      continue;
    }
    if (H2.test(line)) {
      out.tail = [line];
      out.tailFrom = i;
      i++;
      continue;
    }
    const speech = cleanSpeech(line);
    if (speech) out.says.push({ text: speech, line: i });
    i++;
  }
  return out;
}

export function parseBoard(text: string, opts: ParseBoardOptions = {}): ParsedBoard {
  const partial = opts.partial === true;
  const sc = scan(text, partial);
  const warnings = [...sc.warnings];
  // 课里没有卡:围栏整块不上页、不念,给家长记一行
  for (const f of sc.fences) warnings.push({ text: `老师写了一块围栏(${f.tag || '无标签'}),课里没有卡,不上页、不念:对页做什么写在讲稿的句子后面`, line: f.span[0] });
  const raws = sc.says.map((x) => rawLine(x.text, x.line));
  // 写错的动作:丢掉,给家长记一行
  for (const r of raws) for (const b of r.bad) warnings.push({ text: b, line: r.line });
  // 只有动作没有话的一行:动作跟着上一句(念完它才生效);第一句前面的马上生效(记在这一节上)
  const lead: LineAct[] = [];
  const kept: RawLine[] = [];
  for (const r of raws) {
    if (r.text) { kept.push(r); continue; }
    if (!r.acts.length) continue;
    const prev = kept[kept.length - 1];
    if (prev) prev.acts = [...prev.acts, ...r.acts];
    else lead.push(...r.acts);
  }
  const out: BoardLine[] = kept.map((r) => {
    const plain = plainLine(r.text);
    return { text: plain, ask: isQuestion(plain), ...(r.echo ? { echo: r.echo } : {}), ...(r.acts.length ? { acts: r.acts } : {}) };
  });
  return {
    section: { lines: out, ...(partial ? { partial: true } : {}), ...(lead.length ? { acts: lead } : {}) },
    warnings,
    tail: sc.tail ? sc.tail.join('\n').trim() : '',
    spans: {
      fences: sc.fences.map((f) => f.span),
      lines: kept.map((r): LineSpan => [r.line, r.line]),
      tail: sc.tail ? [sc.tailFrom, tailTo(sc.lines, sc.tailFrom)] : null,
      toolCalls: sc.toolCalls,
    },
  };
}

/** 首页文件的正文(老师牌、听写牌):围栏 = 卡(标签第一个词是种类,src/board/cards/ 首页的那两种);普通行首页不显示;第一个 H2 起是给家长的「为什么这么排」 */
export interface ParsedHome {
  cards: BoardCard[];
  warnings: BoardWarning[];
  tail: string;
  spans: { cards: LineSpan[]; lines: LineSpan[] };
}

export function parseHomeBody(text: string): ParsedHome {
  const sc = scan(text, false);
  const warnings = [...sc.warnings];
  const cards: BoardCard[] = [];
  for (const f of sc.fences) {
    if (!f.closed) warnings.push({ text: `围栏没闭合(${f.tag || '无标签'}),当到文末`, line: f.span[0] });
    const r = parseCard(f.tag, f.body.join('\n'));
    cards.push(r.card);
    if (r.warning) warnings.push({ text: r.warning, line: f.span[0], ...(r.fallback ? { fallback: true } : {}) });
  }
  return { cards, warnings, tail: sc.tail ? sc.tail.join('\n').trim() : '', spans: { cards: sc.fences.map((f) => f.span), lines: sc.says.map((x): LineSpan => [x.line, x.line]) } };
}

/** 原文一行的角色:解析器把它当什么了 */
export type SourceRole =
  /** 讲稿一句(念出来) */
  | 'say'
  /** 老师写的围栏(课里不上页) */
  | 'fence'
  /** 第一个 H2 起给家长的尾巴 */
  | 'tail'
  /** 被「## 记账」吃掉,不进讲稿 */
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
  /** 右边那句「围栏 · 不上页」「讲稿 1 · 播」 */
  label?: string;
  /** role=say 时是第几句 */
  index?: number;
  /** 围栏开头那行 */
  open?: boolean;
}

export interface AnnotatedSource {
  rows: SourceRow[];
  /** 行号换算成原文的 */
  warnings: BoardWarning[];
  section: BoardSection;
  tail: string;
}

const SECTION_HEAD = /^##\s+(.+?)\s*$/;

/**
 * 家长端「看原文」用:把老师原文的每一行标上解析器怎么读的。
 * 不另写一套解析——真跑 parseSections + parseBoard,再把它们的行号映回原文,所以永远不会和真解析漂开。
 */
export function annotateSource(text: string): AnnotatedSource {
  const src = text.split('\n');
  const { body, lineMap } = parseSections(text);
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
    rows[i].label = head ? `段「${head}」· 孩子看不到` : '孩子看不到';
  }
  const at = (bodyLine: number): number | undefined => lineMap[bodyLine];
  board.spans.fences.forEach((span) => {
    for (let b = span[0]; b <= span[1]; b++) {
      const i = at(b);
      if (i === undefined) continue;
      rows[i].role = 'fence';
      if (b === span[0]) rows[i].label = '围栏 · 课里不上页';
    }
  });
  board.spans.lines.forEach((span, n) => {
    const i = at(span[0]);
    if (i === undefined) return;
    rows[i].role = 'say';
    rows[i].index = n;
    const l = board.section.lines[n];
    const waits = l.ask && n === board.section.lines.length - 1;
    rows[i].label = `讲稿 ${n + 1}${waits ? ' · 问句,停下等' : ' · 播'}${l.acts?.length ? ` · 念完${l.acts.map((a) => a.name).join('、')}` : ''}`;
  });
  // 只有动作的一行(跟着上一句,第一句前面的马上做)
  for (const r of rows) if (r.role === 'drop' && /\[\[[^\[\]]+\]\]/.test(r.text)) r.label = '动作 · 跟着上一句(第一句前面的马上做)';
  // 整块照旧是 drop,开头那行点名
  for (const span of board.spans.toolCalls) {
    const i = at(span[0]);
    if (i !== undefined) rows[i].label = '写成正文的工具调用 · 不念、不上页';
  }
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
    tail: board.tail,
  };
}
