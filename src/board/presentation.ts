/**
 * 板书(孩子端老师页)的纯逻辑:卡片 JSON 契约、标注锚点、播放状态机、字幕行与输入条的状态。
 * 这份文件两处共用:服务端(解析器、测试)与孩子端页面——kid-page.ts 把它剥掉类型内联进 <script>,
 * 所以**不能有运行时 import、不能碰 DOM、不能用 enum / namespace**(Node 的 stripTypeScriptTypes 只剥类型)。
 *
 * 契约的分工(见 docs/卡片协议.md):老师写「段落 = 讲稿,围栏 = 卡」的正文,服务端(src/board/parse.ts + src/board/cards/)解析成
 * 下面的 BoardSection JSON 放进对话索引;孩子端只认 JSON。卡 = {kind, props},每种卡的 props 契约在 src/board/cards/<kind>.ts;
 * 这里只知道每种卡「哪些字能被标注、笔是什么样」,不认识的 kind 也有兜底。
 */

// 板书的数据类型(进索引、下发孩子端的那份契约)在 src/schema/board.ts;这里只 import type(剥类型时一起没了,内联照样成立)
import type { BoardCard, CardLook, PenName, Device, BoardLayout, BoardMark, BoardCue, BoardLine, BoardSection } from '../schema/board.ts';
export type { BoardCard, CardLook, PenName, Device, BoardLayout, BoardMark, BoardCue, BoardLine, BoardSection };

export const LINE_PENS: readonly PenName[] = ['underline', 'box', 'circle'];

/**
 * 拍:一张卡 + 它后面直到下一张卡之前的讲稿句;第一张卡之前的句子是没有卡的一拍。
 * 不进契约,从卡与句的顺序现算——句子锚到上一张卡(anchor),所以按 anchor 分组。
 */
export interface Beat {
  card: number | null;
  lines: number[];
}
export function beatsOf(section: Pick<BoardSection, 'cards' | 'lines'>): Beat[] {
  const beats: Beat[] = [];
  const byCard = new Map<number | null, Beat>();
  const get = (card: number | null): Beat => {
    let b = byCard.get(card);
    if (!b) { b = { card, lines: [] }; byCard.set(card, b); beats.push(b); }
    return b;
  };
  section.lines.forEach((l, i) => { if (l.anchor === null) get(null).lines.push(i); });
  section.cards.forEach((_c, k) => get(k));
  section.lines.forEach((l, i) => { if (l.anchor !== null) get(Math.min(l.anchor, section.cards.length - 1)).lines.push(i); });
  return beats;
}

/**
 * 流式时前几拍就绪了:一拍要「关了」(后面已经有下一张卡,或老师写完了)。讲稿不配音,不等配音。
 * 返回就绪的拍数(前缀:第 k 拍就绪的前提是前面都就绪)。
 */
export function readyBeats(section: Pick<BoardSection, 'cards' | 'lines'>, opts: { done: boolean }): number {
  const beats = beatsOf(section);
  return opts.done ? beats.length : Math.max(0, beats.length - 1);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** 一张卡上所有能被标注的文字;不认识的 kind 拿 props 里所有字符串 */
export function cardTexts(card: BoardCard): string[] {
  const p = card.props || {};
  switch (card.kind) {
    case 'text':
      return isHeading(card) ? [] : [str(p.title), str(p.text)];
    case 'read':
      return strs(p.segments);
    case 'choice':
      return [str(p.question), ...strs(p.options)];
    case 'code':
      return [str(p.text)];
    case 'image':
      return [str(p.caption)];
    case 'lecture':
      return [str(p.title), str(p.text)];
    case 'canvas':
      return [str(p.prompt)];
    case 'tianzige':
      return []; // 田字格里是 SVG 路径不是文字,标注落不上;讲稿里的 [鼓] 去别的卡找
    case 'word':
      return [str(p.word)]; // [apple] 落到这张卡上(讲到时亮这张);格里是笔顺不是文字,页面不画标注
    case 'paint':
      return [str(p.ask), ...strs(p.panels), ...strs(p.words)];
    case 'photo':
      return [str(p.text)];
    default:
      return Object.values(p).flatMap((v) => (typeof v === 'string' ? [v] : strs(v)));
  }
}

const ALNUM = /[0-9A-Za-z]/;

/**
 * 词在一段字里的位置,数字与拉丁词按整词算(「5」不落在「25」里、「an」不落在「and」里),中文照子串;没有 → -1。
 * 标注锚点(anchorMarks)与页面画笔的落点都用它,两处一条规则。
 */
export function findPhrase(text: string, phrase: string): number {
  if (!phrase) return -1;
  const headWord = ALNUM.test(phrase[0]);
  const tailWord = ALNUM.test(phrase[phrase.length - 1]);
  let from = 0;
  while (from <= text.length) {
    const i = text.indexOf(phrase, from);
    if (i < 0) return -1;
    const before = i > 0 ? text[i - 1] : '';
    const after = i + phrase.length < text.length ? text[i + phrase.length] : '';
    if (!(headWord && ALNUM.test(before)) && !(tailWord && ALNUM.test(after))) return i;
    from = i + 1;
  }
  return -1;
}

/** 讲稿里方括号的词落到哪张卡:第一张含这个词(整词,见 findPhrase)的卡;找不到的词丢掉(只出字幕,不报错) */
export function anchorMarks(cards: readonly BoardCard[], phrases: readonly string[]): BoardMark[] {
  const out: BoardMark[] = [];
  for (const raw of phrases) {
    const phrase = raw.trim();
    if (!phrase) continue;
    const card = cards.findIndex((c) => cardTexts(c).some((t) => findPhrase(t, phrase) >= 0));
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

/** 小节标题(text 卡只有一行 `# 标题`):渲染成无底加粗一行,不算一张卡——不选中、不标注、不并排 */
export function isHeading(card: BoardCard): boolean {
  return card.kind === 'text' && (card.props || {}).heading === true;
}

/** 提问卡:末句问句没配能答的卡时解析器补的那张文字卡(《卡片协议.md》);字就是那句问话,独占一行 */
export function isAskCard(card: BoardCard): boolean {
  return card.kind === 'text' && (card.props || {}).ask === true;
}

/**
 * 底色槽(机械规则;卡上写了 look.tint 就用它):做题的卡紫(plum),定义 / 结论蓝(sky),方法绿(moss),事实 / 例子 / 引言米(sand),
 * 公式 / 图 / 代码白(paper)。名字对不上主题清单的,CSS 落回 paper。
 */
export function tintFor(card: BoardCard): string {
  const t = card.look?.tint;
  if (t) return t;
  const p = card.props || {};
  const style = str(p.style);
  switch (card.kind) {
    case 'text':
      return isAskCard(card) ? 'plum' : style === 'formula' ? 'paper' : str(p.title) ? 'sky' : 'sand';
    case 'choice':
    case 'canvas':
    case 'photo':
      return 'plum';
    case 'read':
      return 'sand';
    default:
      return 'paper';
  }
}

/** 字形槽(机械规则;卡上写了 look.look 就用它):formula → formula(衬线),其余 plain */
export function lookFor(card: BoardCard): string {
  const l = card.look?.look;
  if (l) return l;
  const style = str((card.props || {}).style);
  return style === 'formula' ? 'formula' : 'plain';
}

const LATIN = /^[0-9A-Za-z.,%°²³+\-×÷=()\s]+$/;

/**
 * 笔(机械规则;标注带了 pen 就用它):选项 → 方框;填空、数字与拉丁词 → 下划线;点读段、公式、大字 → 荧光;
 * 标题位上的词 → 圈;其余(正文里正在定义的词)→ 术语底。
 */
export function penFor(card: BoardCard, phrase: string): PenName {
  const p = card.props || {};
  switch (card.kind) {
    case 'choice':
      return strs(p.options).some((o) => findPhrase(o, phrase) >= 0) ? 'box' : 'underline';
    case 'read':
      return 'marker';
    case 'text': {
      const look = lookFor(card);
      if (look === 'formula' || look === 'title') return 'marker';
      if (str(p.title) && findPhrase(str(p.title), phrase) >= 0) return 'circle';
      return LATIN.test(phrase) ? 'underline' : 'tint';
    }
    default:
      return 'underline';
  }
}

/** 一行最多几张:明写的并排(课文件 / 老师的 same)能到 3 张;按宽度排的最多 2 张(半宽 + 半宽) */
export const MAX_CARDS_PER_ROW = 3;

/** 独占一行的卡:标题行、提问卡、画板、小课堂、画图、拍给我看(选择题量得下就能半宽,2026-10-01) */
export function standsAlone(card: BoardCard): boolean {
  return isHeading(card) || isAskCard(card) || card.kind === 'canvas' || card.kind === 'lecture' || card.kind === 'paint' || card.kind === 'photo';
}

const HALF_KINDS = ['text', 'read', 'code', 'tianzige', 'word', 'choice'];

/** 能半宽的种类:文字、点读、代码、田字格、单词卡、选择题、填空题。字形(大字等)不算:字大放不下,量出来自然是全宽 */
export function canHalf(card: BoardCard): boolean {
  return !standsAlone(card) && HALF_KINDS.includes(card.kind);
}

/** 半宽时文字卡与点读最多几行(小标题也算一行);手机的半宽只有 170 来像素,一行七八个字,只放得下标题加一行 */
export const HALF_LINES: Record<Device, number> = { phone: 2, 'tablet-portrait': 4, 'tablet-landscape': 4 };

/** 页面把卡放进量具量出来的数:半宽 / 全宽时卡的高(像素)、半宽时文字有几行、半宽时有没有横着溢出 */
export interface CardFit {
  half: number;
  full: number;
  lines: number;
  overflow: boolean;
}

/**
 * 量出来的卡能不能半宽:文字卡与点读看行数,不超过 HALF_LINES;
 * 公式、代码、田字格、单词卡、选择题、填空题半宽时不能比全宽高(折了行就是挤了:公式从中间断开没法看,选项挤成两行)。横着溢出的都不行
 */
export function fitsHalf(card: BoardCard, device: Device, m: CardFit): boolean {
  if (!canHalf(card) || m.overflow) return false;
  if ((card.kind === 'text' && lookFor(card) !== 'formula') || card.kind === 'read') return m.lines <= HALF_LINES[device];
  return m.half <= m.full + 2;
}

/** 量不了时的估计(测试;页面还没有宽度时):文字卡,字数 ≤ 20 */
export function isShortCard(card: BoardCard): boolean {
  if (card.kind !== 'text' || !canHalf(card)) return false;
  return Array.from(cardTexts(card).join('')).length <= 20;
}

/** 有 layout 时它必须恰好盖住全部卡各一次、顺序不变;否则不用它 */
function validRows(rows: readonly (readonly number[])[], n: number): boolean {
  const flat = rows.flat();
  return flat.length === n && flat.every((v, i) => v === i);
}

/**
 * 一节的行(2026-10-01 起排版归代码):每张卡半宽还是全宽,看它自己量出来的样子
 * (half(i),页面在量具里量;没给就按 isShortCard 估)。从左往右排,只看前面的卡:
 * - 相邻两张半宽的并一行;一张半宽后面跟的不是半宽,它自己一行、占左半(右边空着)
 * - 全宽的一行一张;标题行、提问卡、画板、小课堂永远独占
 * - 明写的并排(section.layout 里不止一张的行:课文件 / 老师写的 same)照办,最多 3 张;
 *   别的端排的到了手机上,超过 2 张或有不能半宽的就拆开,再按宽度排
 * 流式一张张来时,前面的行不会因为后来的卡变。
 */
export function rowsFor(section: BoardSection, device: Device, half?: (i: number) => boolean): number[][] {
  const n = section.cards.length;
  const isHalf = (i: number): boolean => canHalf(section.cards[i]) && (half ? half(i) : isShortCard(section.cards[i]));
  const lay = section.layout;
  // layout 只盖住前几张也认:流式的节,和节尾补的提问卡
  const last = section.cards[n - 1];
  const covered = lay ? lay.rows.flat().length : 0;
  const prefix = Boolean((section.partial || (last && isAskCard(last))) && lay && validRows(lay.rows, covered) && covered <= n);
  const explicit = lay && (validRows(lay.rows, n) || prefix) ? lay.rows : [];
  const fold = lay ? lay.for !== device && device === 'phone' : false;
  const joined = new Map<number, number[]>();
  for (const row of explicit) {
    if (row.length < 2 || row.some((i) => standsAlone(section.cards[i]))) continue;
    if (fold && (row.length > 2 || !row.every(isHalf))) continue;
    joined.set(row[0], [...row]);
  }
  const out: number[][] = [];
  let open: number[] | null = null;
  for (let i = 0; i < n; i++) {
    const row = joined.get(i);
    if (row) {
      out.push(row);
      open = null;
      i = row[row.length - 1];
    } else if (isHalf(i)) {
      if (open) { open.push(i); open = null; }
      else { open = [i]; out.push(open); }
    } else {
      out.push([i]);
      open = null;
    }
  }
  return out;
}

/** 一行几列:并排几张就几列;只有一张时,半宽的两列(占左半),全宽的一列 */
export function rowCols(section: BoardSection, row: readonly number[], half?: (i: number) => boolean): number {
  if (row.length > 1) return row.length;
  const c = section.cards[row[0]];
  return c && canHalf(c) && (half ? half(row[0]) : isShortCard(c)) ? 2 : 1;
}

/** 端:宽 ≥ 900 且横 → 平板横屏;短边 ≥ 600 → 平板竖屏;其余手机 */
export function deviceFor(width: number, height: number): Device {
  if (width >= 900 && width > height) return 'tablet-landscape';
  if (Math.min(width, height) >= 600) return 'tablet-portrait';
  return 'phone';
}

/** 当前卡(选中态):播到这句该在的那张(lineTarget);句子没锚就是本节第一张不是标题行的卡;没在播 → null */
export function nowCard(sections: readonly BoardSection[], state: PlayerState): number | null {
  const s = sections[state.section];
  if (!s || state.line < 0) return null;
  const line = s.lines[state.line];
  if (!line) return null;
  // 停下等答:亮的是提问卡(有的话)——孩子要答的那句在它上面
  const askAt = s.cards.length - 1;
  if (state.status === 'waiting' && state.line === s.lines.length - 1 && askAt >= 0 && isAskCard(s.cards[askAt])) return askAt;
  const t = lineTarget(line);
  if (t !== null && s.cards[t] && !isHeading(s.cards[t])) return t;
  const first = s.cards.findIndex((c) => !isHeading(c));
  return first >= 0 ? first : null;
}

// ---- 线条类的笔:SVG 路径,手绘感(端点微抖),抖动的种子取词的 hash,同一个词每次画一样 ----

function seedOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 笔画的框:相对被标注文字的一行矩形(宽 w、高 h),笔要伸出去多少 */
export function penBox(pen: PenName, w: number, h: number): PenBox {
  switch (pen) {
    case 'underline':
      return { x: -3, y: h - 4, w: w + 6, h: 10 };
    case 'box':
      return { x: -4, y: -3, w: w + 8, h: h + 6 };
    case 'circle':
      return { x: -10, y: -7, w: w + 20, h: h + 14 };
    default:
      return { x: 0, y: 0, w, h };
  }
}

const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** 笔画的路径(viewBox 0 0 w h):下划线一笔、方框一圈、圈一圈多一点;seed 定抖动 */
export function penPath(pen: PenName, w: number, h: number, seed: string): string {
  const r = rng(seedOf(seed));
  const j = (amp: number): number => (r() - 0.5) * 2 * amp;
  if (pen === 'underline') {
    const y = h * 0.5;
    return `M2 ${f1(y + j(1.5))} C ${f1(w * 0.18)} ${f1(y + j(2.5))}, ${f1(w * 0.34)} ${f1(y + j(2.5))}, ${f1(w * 0.52)} ${f1(y + j(2))} S ${f1(w * 0.84)} ${f1(y + j(2.5))}, ${f1(w - 2)} ${f1(y + j(1.5))}`;
  }
  if (pen === 'box') {
    const l = 3 + j(0.8), t = 3 + j(0.8), rt = w - 3 + j(0.8), b = h - 3 + j(0.8);
    return `M${f1(l)} ${f1(t)} C ${f1(w * 0.3)} ${f1(t + j(1))}, ${f1(w * 0.7)} ${f1(t + j(1))}, ${f1(rt)} ${f1(t + j(0.8))} C ${f1(rt + j(1))} ${f1(h * 0.3)}, ${f1(rt + j(1))} ${f1(h * 0.7)}, ${f1(rt + j(0.8))} ${f1(b)} C ${f1(w * 0.7)} ${f1(b + j(1))}, ${f1(w * 0.3)} ${f1(b + j(1))}, ${f1(l + j(0.8))} ${f1(b + j(0.8))} C ${f1(l + j(1))} ${f1(h * 0.7)}, ${f1(l + j(1))} ${f1(h * 0.3)}, ${f1(l)} ${f1(t + 2)}`;
  }
  if (pen === 'circle') {
    const cx = w / 2, cy = h / 2, rx = w / 2 - 2.5, ry = h / 2 - 2.5;
    const n = 36;
    const start = -1.1; // 从右上起笔,顺时针,多画一点收尾
    const pts: string[] = [];
    for (let k = 0; k <= n + 3; k++) {
      const a = start + (k / n) * Math.PI * 2;
      const wob = 1 + j(0.035);
      pts.push(`${f1(cx + Math.cos(a) * rx * wob)} ${f1(cy + Math.sin(a) * ry * wob)}`);
    }
    return `M${pts[0]} L ${pts.slice(1).join(' L ')}`;
  }
  return '';
}

/** 有舞台交互(能改状态、能「交给老师」)的种类;其余点开只是放大看 */
export function hasState(card: BoardCard): boolean {
  return card.kind === 'choice' || card.kind === 'canvas';
}

/** 画板上画了几笔(状态里的 ink 元素数) */
export function inkCount(card: BoardCard): number {
  const st = card.state as { ink?: unknown } | undefined;
  return Array.isArray(st?.ink) ? st.ink.length : 0;
}

/** 重卡:舞台在 iframe 里的舞台包(/stage/)开,页面只管顶栏、字幕行、输入条 */
export function isHeavy(card: BoardCard): boolean {
  return card.kind === 'canvas' || card.kind === 'lecture';
}

/** 小课堂卡能不能放:课包读得出来,下发时服务端填 ready 与那一段的起止 */
export function lectureReady(card: BoardCard): boolean {
  const p = card.props || {};
  return card.kind === 'lecture' && p.ready === true && typeof p.start === 'number' && typeof p.end === 'number' && p.end > p.start;
}

/** 点读第 k 段(0 起)的配音文件(相对 conversations/<老师>/);没生成好 → null(孩子端等它到,等不到不出声) */
export function segmentAudio(card: BoardCard, k: number): string | null {
  const want = `/${k + 1}.mp3`;
  return (card.assets || []).find((a) => a.endsWith(want)) ?? null;
}

/** 孩子在这张卡上做了什么(「交给老师」能不能按):选择题是选项;没做 → [] */
export function stateSummary(card: BoardCard): string[] {
  if (card.kind === 'choice') return pickedLabels(card);
  if (card.kind === 'canvas') return inkCount(card) ? [`画了 ${inkCount(card)} 笔`] : [];
  return [];
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

/** 舞台顶栏的名字:文字卡的标题 / 正文、选择题的问题、其余第一段有字的;截 24 字 */
export function cardTitle(card: BoardCard): string {
  const p = card.props || {};
  const first = card.kind === 'paint' ? '画家画的' : str(p.title) || str(p.question) || str(p.show) || str(p.text) || str(p.caption) || str(p.prompt) || strs(p.segments)[0] || cardTexts(card).find((t) => t.trim()) || (card.kind === 'image' ? '图' : card.kind === 'canvas' ? '画一画' : card.kind === 'tianzige' ? str(p.chars) : '');
  const cps = Array.from(first.trim().replace(/\s+/g, ' '));
  return cps.length > 24 ? `${cps.slice(0, 24).join('')}…` : cps.join('');
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 选择题:点第 i 项后的选中集合——单选换成它(再点取消),多选切换 */
export function togglePick(picked: readonly number[], i: number, multi: boolean): number[] {
  if (picked.includes(i)) return picked.filter((x) => x !== i);
  return multi ? [...picked, i] : [i];
}

/** 选择题当前选了什么(回显与紧凑态用):「B 三个」 */
export function pickedLabels(card: BoardCard): string[] {
  const options = strs((card.props || {}).options);
  const st = card.state as { picked?: unknown } | undefined;
  const picked = Array.isArray(st?.picked) ? st.picked.filter((x): x is number => typeof x === 'number') : [];
  return picked.filter((i) => i >= 0 && i < options.length).map((i) => `${LETTERS[i] ?? i + 1} ${options[i]}`);
}

export function isQuestion(text: string): boolean {
  const t = text.trim();
  return t.endsWith('?') || t.endsWith('？');
}

/** 孩子端条目里页面用到的字段(与 kid-view 的 KidMessage 兼容) */
/** 孩子端一条带的小课堂:画的卡是截下来的图(没截图的课包现画那一刻再叠那几笔);家长端的画多一段老师拿到的话(text);again = 再看一遍又画的那条 */
export interface KidLecture {
  bundle: string;
  title: string;
  again?: true;
  video?: true;
  marks?: { atMs: number; svgMs: number; strokes: [number, number][][]; text?: string; image?: string }[];
}

/** 孩子从纸上交的画在板上那张卡:图(相对 workspace 根)、几笔、画了多久 */
export interface KidDrawing {
  image: string;
  strokes: number;
  ms?: number;
}

export interface BoardMessage {
  job: string;
  at?: string;
  question: string | null;
  reply: string | null;
  pending: boolean;
  section?: BoardSection | null;
  /** 孩子这条带的作业照片(相对 workspace 根;R5):节头上回显缩略图 */
  photos?: string[];
  /** 看完小课堂后的第一条:这一节前面是小课堂卡 */
  lecture?: KidLecture;
  /** 孩子从左栏的纸交的画:这一节前面是孩子的画卡 */
  drawing?: KidDrawing;
  /** 孩子这条不是说的话:submit = 交卡(答案在卡上) */
  action?: 'submit';
  /** 按住说话的(索引里带 voice):板上去口头禅、一行截断 */
  /** 首页按钮发的:按钮上的字,不是孩子说的 */
  fromHome?: boolean;
  /** 实时的一轮(讲稿嘴照念,不配音) */
  live?: boolean;
}

/** 板上孩子的一句话:text 是显示的(语音去了口头禅),full 是原话 */
export interface KidSaid {
  text: string;
  full: string;
  /** 答拍给我看卡时拍来的照片:进那张卡的答案栏,节头不再回显 */
  photos?: string[];
}

export interface BoardEntry extends BoardSection {
  job: string;
  at?: string;
  /** 老师还在说:卡只增不改;前 ready 拍就绪了就能播(2026-09-13 之前是整轮跑完才播);整轮跑完换成正式的一节 */
  partial?: boolean;
  /** 孩子问这节时拍的照片(节头上回显) */
  photos?: string[];
  /** 这一节答的是看完小课堂后的第一问:节前画小课堂卡 */
  lecture?: KidLecture;
  /** 这一节答的是孩子从纸上交的画:节前一张孩子的画卡 */
  drawing?: KidDrawing;
  /** 孩子引出这一节的那句话;saidOn = 它答的是哪一节的哪张问题卡(写进那张卡的答案栏),没有 = 在这一节开头单独一行。实时的节头不是它(看 head),它只给左栏用 */
  said?: KidSaid;
  saidOn?: { job: string; card: number };
  /** 实时的一轮:卡闭合了就铺(不按拍);不出卡的板上留讲稿的字 */
  live?: true;
  /** 实时:这一轮开头是脑写的节头(只有一行 # 标题的文字卡),从这里起新的一件事,head 是它的标题(liveHead) */
  head?: string;
  /** 实时:这一轮开头没写节头,接着上一节画 */
  cont?: true;
}

/**
 * 实时的一节怎么接:新一节的开头由脑定,不再机械是孩子那句。
 * 这一轮第一张卡是节头 → head;没写(只有讲稿、开头是别的卡、还没写出卡)→ cont,接着上一节。一轮中间的节头卡,是从那张卡起新一节
 */
export function liveHead(s: Pick<BoardSection, 'cards'>): { head: string } | { cont: true } {
  const first = s.cards[0];
  return first && isHeading(first) && str(first.props.title).trim() ? { head: str(first.props.title).trim() } : { cont: true };
}

/**
 * 一节的问题卡:孩子下一条答的写进它的答案栏;没有 = null。
 * 有拍给我看卡就是它(最后那张),末句问不问都算:老师要的是照片;
 * 否则末句是问句(不交给小课堂)、它锚着的是文字卡(不是小节标题),或解析器补的提问卡。
 */
export function askCard(section: Pick<BoardSection, 'cards' | 'lines' | 'partial'>): number | null {
  if (section.partial) return null;
  for (let k = section.cards.length - 1; k >= 0; k--) if (section.cards[k].kind === 'photo') return k;
  const last = section.lines[section.lines.length - 1];
  if (!last || !last.ask || last.cues.length || last.echo || last.call) return null;
  const n = section.cards.length;
  if (n && section.cards[n - 1].kind === 'text' && section.cards[n - 1].props?.ask === true) return n - 1;
  const t = lineTarget(last);
  const c = t === null ? undefined : section.cards[t];
  return c && c.kind === 'text' && !isHeading(c) ? t : null;
}

/** 只发了照片、没说话时服务端补的那句(runner.ts:「(拍了一张)」「(拍了 N 张)」) */
const PHOTO_ONLY = /^\(拍了(?:一| \d+ )张\)$/;
/** 只从纸上交了画、没说话时服务端补的那句(src/board/paper.ts 的 DRAW_ONLY_TEXT):不当孩子说的话,板上有那张画卡 */
const DRAW_ONLY = /^\(画了一张,没说话\)$/;

/**
 * 每条孩子的话放在板上哪:交卡、首页按钮、空的不放;答的是上一节的问题卡就进那张卡的答案栏(on),
 * 否则在它引出的那一节开头单独一行(on = null)。看完小课堂后的第一问不算答卡。按 job 给,还在跑的那条也有(刚发出去先挂上)。
 */
export function kidSaid(messages: readonly BoardMessage[]): Map<string, { said: KidSaid; on: { job: string; card: number } | null }> {
  const out = new Map<string, { said: KidSaid; on: { job: string; card: number } | null }>();
  let prev: BoardMessage | null = null;
  for (const m of messages) {
    const q = (m.question ?? '').trim();
    const card = prev && prev.section && !m.lecture ? askCard(prev.section) : null;
    // 答拍给我看卡的照片跟着话进答案栏;只发了照片没说话(服务端补的「(拍了一张)」)就只有照片
    const photos = card !== null && prev!.section!.cards[card].kind === 'photo' && m.photos?.length ? m.photos : null;
    const words = photos && PHOTO_ONLY.test(q) ? '' : q;
    if ((q || photos) && !m.action && !m.fromHome && !(m.drawing && DRAW_ONLY.test(q))) {
      out.set(m.job, { said: { text: words, full: words, ...(photos ? { photos } : {}) }, on: prev && card !== null ? { job: prev.job, card } : null });
    }
    if (m.section && !m.section.partial && !m.pending && (m.section.cards.length || m.section.lines.length)) prev = m;
  }
  return out;
}

/**
 * 孩子端条目 → 板书节(没有 section 的条目不出节);
 * 孩子的话挂在它引出的那一节上(said / saidOn,kidSaid);还在跑的只有带 partial 板书(流式,已有卡或已有配好的句;实时的有句就算)才出节且标 partial,其余不出。
 */
export function sectionsFromMessages(messages: readonly BoardMessage[]): BoardEntry[] {
  const out: BoardEntry[] = [];
  const says = kidSaid(messages);
  for (const m of messages) {
    const k = says.get(m.job);
    const at = { ...(m.at ? { at: m.at } : {}), ...(m.photos?.length && !k?.said.photos ? { photos: m.photos } : {}), ...(m.lecture ? { lecture: m.lecture } : {}), ...(m.drawing ? { drawing: m.drawing } : {}), ...(k ? { said: k.said, ...(k.on ? { saidOn: k.on } : {}) } : {}), ...(m.live ? { live: true as const, ...liveHead(m.section ?? { cards: [] }) } : {}) };
    if (m.pending) {
      if (m.section && m.section.partial && (m.section.cards.length || (m.live && m.section.lines.length))) out.push({ job: m.job, ...at, cards: m.section.cards, lines: m.section.lines, partial: true, ready: m.section.ready ?? 0, ...(m.section.layout ? { layout: m.section.layout } : {}) });
      continue;
    }
    if (m.section && (m.section.cards.length || m.section.lines.length)) {
      out.push({ job: m.job, ...at, cards: m.section.cards, lines: m.section.lines, ...(m.section.layout ? { layout: m.section.layout } : {}) });
    }
  }
  return out;
}

/** 一节在目录里的名字:小节标题 > 有名字的文字卡 > 第一张有字的卡 > 第一句讲稿;截到 14 个字 */
export function sectionTitle(s: BoardSection): string {
  const pick = (): string => {
    for (const c of s.cards) if (isHeading(c) && str(c.props.title)) return str(c.props.title);
    for (const c of s.cards) if (c.kind === 'text' && str(c.props.title)) return str(c.props.title);
    for (const c of s.cards) {
      const t = cardTexts(c).find((x) => x.trim());
      if (t) return t;
    }
    return s.lines[0]?.text ?? '';
  };
  const cps = Array.from(pick().trim());
  return cps.length > 14 ? `${cps.slice(0, 14).join('')}…` : cps.join('');
}

/** 板上的位置。孩子端不念讲稿了:讲稿由嘴照念(runtime/delivery/player.ts 的 liveStep),这里的状态只剩
 *  thinking = 老师还在写 · waiting = 写完了、末句是问句 · done = 写完了 · idle = 板上还没东西。
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

/** 播到这句该滚到哪张卡:标注所在的卡优先,其次锚点卡,再没有就 null(页面滚到本节第一张) */
export function lineTarget(line: BoardLine): number | null {
  if (line.marks.length) return line.marks[line.marks.length - 1].card;
  return line.anchor;
}

// ---- 板上的节(2026-10-22 起只剩这些):老师开始写、又就绪一拍、写完、出错撤掉、整节到了;页面的 reset(换老师)、halt(停卡的声音)。
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
  | { type: 'liveBeat'; section: number }
  | { type: 'liveFinal'; section: number }
  | { type: 'liveDropped' }
  | { type: 'fresh'; sections: number[] };

/** stop 只停声音(卡的点读、单词);paint = 把某节的标注画齐;showNow = 选中态照现在的位置;scrollLast = 滚到最后一节 */
export type PlayerEffect =
  | { kind: 'stop' }
  | { kind: 'render' }
  | { kind: 'showNow' }
  | { kind: 'paint'; section: number }
  | { kind: 'scrollLast' };

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
      fx.push({ kind: 'paint', section: ev.section });
      m = { state: { section: ev.section, line: -1, status: 'thinking' } };
      fx.push({ kind: 'render' }, { kind: 'showNow' });
      break;
    case 'liveBeat':
      if (m.state.section !== ev.section || m.state.status !== 'thinking') break;
      fx.push({ kind: 'paint', section: ev.section }, { kind: 'render' });
      break;
    case 'liveFinal':
      fx.push({ kind: 'paint', section: ev.section });
      if (m.state.section !== ev.section) break;
      if (m.state.status !== 'thinking') { fx.push({ kind: 'showNow' }); break; }
      m = { state: playerAtEnd(secs) };
      fx.push({ kind: 'render' }, { kind: 'showNow' });
      break;
    case 'liveDropped':
      fx.push({ kind: 'stop' });
      m = { state: playerAtEnd(secs) };
      fx.push({ kind: 'render' });
      break;
    case 'fresh':
      if (!ev.sections.length) break;
      for (const i of ev.sections) fx.push({ kind: 'paint', section: i });
      m = { state: playerAtEnd(secs) };
      fx.push({ kind: 'render' }, { kind: 'showNow' }, { kind: 'scrollLast' });
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
