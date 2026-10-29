/**
 * 板书解析器:老师的回复正文(已剥掉「记账」段)→ 一节 BoardSection。
 * 三条规则(见 docs/卡片协议.md):围栏 = 卡(标签第一个词是 kind),普通行 = 讲稿一句,第一个 H2 起是给家长的尾巴。
 * 讲稿句里 [词] 是标注(落到第一张含这个词的卡,整节找,卡在前在后都行),[[名 参数]] 是对上一张卡的动作(cue)。
 * partial 模式给流式用:没闭合的围栏和没换行结束的最后一行压着不算,下次整段重解析自然补上。
 * 永不抛错:围栏没闭合当到文末,卡解析不出退成文字卡并记一句 warning。
 * spans 是「这张卡 / 这句话是原文哪几行」,家长端「看原文」据此在原文旁边标出解析器怎么读的;孩子端的 BoardSection 不带它。
 */
import { parseCard, type CardPlace } from './cards/index.ts';
import { anchorMarks, hasState, isAskCard, isHeading, isQuestion, lineTarget, MAX_CARDS_PER_ROW, phrasesIn, plainLine, standsAlone, type BoardCard, type BoardCue, type BoardLine, type BoardSection, type Device } from './presentation.ts';
import { parseSections } from './sections.ts';

export interface ParseBoardOptions {
  /** 文本还在长(流式):压住没闭合的围栏与没换行结束的最后一行 */
  partial?: boolean;
  /** 卡用在哪(缺省板书);首页文件同一个解析器,place = home */
  place?: CardPlace;
  /** 围栏行上写了排版修饰词(same)时,排出来的行是给哪个端的(layout.for);缺省平板横屏 */
  device?: Device;
  /** 实时的一轮:板是脑写的笔记与练习,末句的问话不补成提问卡(字幕上就是这句) */
  live?: boolean;
}

/**
 * 排版修饰词:写在围栏标签里种类后面,哪种卡都认,解析器先摘掉再按种类解析——
 * `same` 和上一张并排(没写 = 孩子端按卡的宽度排,board/presentation.ts 的 rowsFor)、`tint=<底色槽>`、`look=<字形槽>`、`emoji=<一个>`。槽名没人对着主题查(解析器不认识主题),对不上的 CSS 落回缺省。
 * 老师也写得出来:cotutor-board 技能不教,写了就当已定
 */
export interface CardMods {
  same?: true;
  tint?: string;
  look?: string;
  emoji?: string;
}
const MOD_RE = /^(tint|look|emoji)=(.+)$/i;
export function splitMods(tag: string): { rest: string; mods: CardMods; warnings: string[] } {
  const mods: CardMods = {};
  const warnings: string[] = [];
  const rest: string[] = [];
  for (const w of tag.trim().split(/\s+/).filter(Boolean)) {
    if (w.toLowerCase() === 'same') { mods.same = true; continue; }
    const m = MOD_RE.exec(w);
    if (!m) { rest.push(w); continue; }
    const key = m[1].toLowerCase() as 'tint' | 'look' | 'emoji';
    const v = m[2];
    if (key === 'emoji' && (Array.from(v).length > 2 || /[A-Za-z0-9]/.test(v))) { warnings.push(`emoji=${v} 不像一个 emoji,不要了`); continue; }
    mods[key] = v;
  }
  return { rest: rest.join(' '), mods, warnings };
}

/** 解析提醒;line = 出问题的那一行(0 起,相对传进来的文本),没有行的就不带 */
export interface BoardWarning {
  text: string;
  line?: number;
  /** 这张卡没照标签解析成(退了文字卡 / 代码卡) */
  fallback?: boolean;
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
  /** 写成正文的工具调用(TOOL_OPEN 起到收尾行),不进板书 */
  toolCalls: LineSpan[];
}

export interface ParsedBoard {
  section: BoardSection;
  /** 没解析成的卡等,家长视图转录里显示;孩子端不报 */
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
const CUE = /\[\[([^\[\]]+)\]\]/g;

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
  anchor: number | null;
  cues: BoardCue[];
  line: number;
  echo?: BoardLine['echo'];
  call?: true;
}

/**
 * 热身的记号:不锚卡,记在这句上。[[echo 词]] 跟我说、[[say 词]] 你先说(念完等孩子说「词」),[[call]] 念完进打电话。
 * echo 没写词就取这句里的英文;一句写了几个,算最后一个
 */
const LINE_MARKS = new Set(['echo', 'say', 'call']);
const englishIn = (text: string): string => (text.match(/[A-Za-z][A-Za-z']*/g) ?? []).join(' ');

/** 句子锚到上一张卡;小节标题行不算卡,跳过它 */
function lastCard(cards: readonly BoardCard[]): number | null {
  for (let k = cards.length - 1; k >= 0; k--) if (!isHeading(cards[k])) return k;
  return null;
}

function rawLine(line: string, cards: readonly BoardCard[], at: number): RawLine {
  const anchor = lastCard(cards);
  const cues: BoardCue[] = [];
  let mark: { name: string; arg: string } | null = null;
  const text = line
    .replace(CUE, (_, inner: string) => {
      const [name, ...rest] = inner.trim().split(/\s+/);
      const n = (name ?? '').toLowerCase();
      if (LINE_MARKS.has(n)) mark = { name: n, arg: rest.join(' ') };
      else if (name && anchor !== null) cues.push({ card: anchor, name: n, ...(rest.length ? { arg: rest.join(' ') } : {}) });
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  const m = mark as { name: string; arg: string } | null;
  if (!m) return { text, anchor, cues, line: at };
  if (m.name === 'call') return { text, anchor, cues, line: at, call: true };
  const word = m.arg || (m.name === 'echo' ? englishIn(text) : '');
  return { text, anchor, cues, line: at, echo: { word, ...(m.name === 'say' ? { say: true as const } : {}) } };
}

/** 一句讲稿交给嘴时要带的:[[play]] 到小课堂卡、热身的 echo / say、call(runner 的 line 事件、mock 的假嘴都用它) */
export function lineFlags(line: { cues?: readonly BoardCue[]; echo?: BoardLine['echo']; call?: true }, cards: readonly BoardCard[]): { play?: true; echo?: NonNullable<BoardLine['echo']>; call?: true } {
  return { ...(playsLecture(line, cards) ? { play: true as const } : {}), ...(line.echo ? { echo: line.echo } : {}), ...(line.call ? { call: true as const } : {}) };
}

/** 这句的 [[play]] 锚着小课堂卡:念完放卡上那一段(实时时服务端在这句之后等孩子端放完再交讲稿,src/runtime/delivery/queue.ts) */
export function playsLecture(line: { cues?: readonly BoardCue[] }, cards: readonly BoardCard[]): boolean {
  return (line.cues ?? []).some((c) => c.name === 'play' && cards[c.card]?.kind === 'lecture');
}

export function parseBoard(text: string, opts: ParseBoardOptions = {}): ParsedBoard {
  const partial = opts.partial === true;
  const all = text.split('\n');
  const lines = partial && !text.endsWith('\n') ? all.slice(0, -1) : all;
  const cards: BoardCard[] = [];
  const cardSpans: LineSpan[] = [];
  /** 每张卡围栏行上的排版修饰词(与 cards 同序;没写就是空对象) */
  const mods: CardMods[] = [];
  const raws: RawLine[] = [];
  const warnings: BoardWarning[] = [];
  const toolCalls: LineSpan[] = [];
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
    const call = TOOL_OPEN.exec(line);
    if (call) {
      const close = toolClose(call[1]);
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j])) j++;
      // 和围栏一样:流式时没收尾的块压着,后面的也不出
      if (j >= lines.length && partial) break;
      const end = Math.min(j, lines.length - 1);
      toolCalls.push([i, end]);
      warnings.push({ text: `老师把工具调用写成了正文(${toolName(lines.slice(i, end + 1))}),不进板书`, line: i });
      i = end + 1;
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
      const sm = splitMods(tag);
      const r = parseCard(sm.rest, body.join('\n'), opts.place);
      const look = { ...(sm.mods.tint ? { tint: sm.mods.tint } : {}), ...(sm.mods.look ? { look: sm.mods.look } : {}), ...(sm.mods.emoji ? { emoji: sm.mods.emoji } : {}) };
      cards.push(Object.keys(look).length && !isHeading(r.card) ? { ...r.card, look } : r.card);
      mods.push(sm.mods);
      cardSpans.push([i, closed ? j : Math.max(i, j - 1)]);
      for (const w of sm.warnings) warnings.push({ text: w, line: i });
      if (r.warning) warnings.push({ text: r.warning, line: i, ...(r.fallback ? { fallback: true } : {}) });
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
    return { text: plain, audio: null, marks, ask: isQuestion(plain), anchor: r.anchor, cues: r.cues, ...(r.echo ? { echo: r.echo } : {}), ...(r.call ? { call: true as const } : {}) };
  });
  // 排版:有卡写了 same 才排行(明写的并排,其余孩子端按宽度排);接不上(上一行满了、有独占一行的卡)就另起一行并提醒。提问卡(下面补的)不在行里,rowsFor 认前缀
  let layout: BoardSection['layout'];
  if (mods.some((m) => m.same)) {
    const rows: number[][] = [];
    cards.forEach((c, n) => {
      const last = rows[rows.length - 1];
      const join = mods[n].same && last !== undefined && last.length < MAX_CARDS_PER_ROW && !standsAlone(c) && !last.some((i) => standsAlone(cards[i]));
      if (mods[n].same && !join) warnings.push({ text: `卡 ${n + 1} 写了 same,接不上上一行(${last === undefined ? '它是第一张' : last.length >= MAX_CARDS_PER_ROW ? `上一行已有 ${MAX_CARDS_PER_ROW} 张` : '有独占一行的卡'}),另起一行`, line: cardSpans[n][0] });
      if (join) last!.push(n);
      else rows.push([n]);
    });
    layout = { for: opts.device ?? 'tablet-landscape', rows };
  }
  // 提问卡(2026-09-21):末句问句是孩子要答的那句,念完不能只剩字幕——没配能答的卡(choice / fill / canvas)就在节尾补一张文字卡写着这句。
  // 末句的锚点不动(还在它讲的那张卡的拍里);提问卡自己一拍、没有讲稿。
  // 老师还在写(partial)时不补:这时的末句不一定是最后一句。首页没有讲稿,不管;实时不补(板上放什么由脑定)
  const lastLine = out[out.length - 1];
  if (!partial && !opts.live && (opts.place ?? 'board') === 'board' && lastLine?.ask && !lastLine.cues.length && !lastLine.echo && !lastLine.call) {
    const t = lineTarget(lastLine);
    // 拍给我看卡也算能答:孩子拍来的照片进它的答案栏(board/presentation.ts 的 askCard)
    const answerable = (c: BoardCard | undefined): boolean => Boolean(c && (hasState(c) || c.kind === 'photo'));
    if (!cards.some((c) => c.kind === 'photo') && !answerable(t === null ? undefined : cards[t]) && !answerable(cards[cards.length - 1])) {
      cards.push({ kind: 'text', props: { text: lastLine.text, ask: true } });
      cardSpans.push([kept[kept.length - 1].line, kept[kept.length - 1].line]);
    }
  }
  return {
    section: { cards, lines: out, ...(partial ? { partial: true } : {}), ...(layout ? { layout } : {}) },
    warnings,
    tail: tail ? tail.join('\n').trim() : '',
    spans: {
      cards: cardSpans,
      lines: kept.map((r): LineSpan => [r.line, r.line]),
      tail: tail ? [tailFrom, tailTo(lines, tailFrom)] : null,
      toolCalls,
    },
  };
}

/** 回复停在写成正文的工具调用上(后面只剩空行):老师在等工具的结果,这一轮其实没写完(runner 据此 resume 一次) */
export function endsWithToolCall(text: string): boolean {
  const { spans } = parseBoard(text);
  const last = spans.toolCalls[spans.toolCalls.length - 1];
  return Boolean(last) && text.split('\n').slice(last[1] + 1).every((l) => !l.trim());
}

/** 原文一行的角色:解析器把它当什么了 */
export type SourceRole =
  /** 讲稿一句(念出来) */
  | 'say'
  /** 卡的围栏(开头行 / 中间 / 结尾) */
  | 'card'
  /** 第一个 H2 起给家长的尾巴 */
  | 'tail'
  /** 被「## 记账」吃掉,不进板书 */
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
  /** 右边那句「卡 2 · text formula」「讲稿 1 · 播」 */
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
  tail: string;
}

const SECTION_HEAD = /^##\s+(.+?)\s*$/;

/**
 * 家长端「看原文」用:把老师原文的每一行标上解析器怎么读的。
 * 不另写一套解析——真跑 parseSections + parseBoard,再把它们的行号映回原文,所以永远不会和真解析漂开。
 */
export function annotateSource(text: string, opts: Pick<ParseBoardOptions, 'live'> = {}): AnnotatedSource {
  const src = text.split('\n');
  const { body, lineMap } = parseSections(text);
  const board = parseBoard(body, opts);
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
    // 提问卡是解析器补的,原文里没有它的围栏
    if (isAskCard(card)) return;
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
    const waits = l.ask && n === board.section.lines.length - 1;
    const asked = waits && board.section.cards.some(isAskCard);
    rows[i].label = `讲稿 ${n + 1}${waits ? ` · 问句,停下等${asked ? '(补提问卡)' : ''}` : ' · 播'}`;
  });
  // 整块照旧是 drop,开头那行点名
  for (const span of board.spans.toolCalls) {
    const i = at(span[0]);
    if (i !== undefined) rows[i].label = '写成正文的工具调用 · 不进板书';
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
