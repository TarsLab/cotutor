/**
 * 板书(孩子端老师页)的纯逻辑:卡片 JSON 契约、标注锚点、播放状态机、字幕行与输入条的状态。
 * 这份文件两处共用:服务端(解析器、测试)与孩子端页面——kid-page.ts 把它剥掉类型内联进 <script>,
 * 所以**不能有运行时 import、不能碰 DOM、不能用 enum / namespace**(Node 的 stripTypeScriptTypes 只剥类型)。
 *
 * 契约的分工(《板书卡片设计.md》):老师写「段落 = 讲稿,围栏 = 卡」的正文,服务端(src/lib/board.ts + src/cards/)解析成
 * 下面的 BoardSection JSON 放进对话索引;孩子端只认 JSON。卡 = {kind, props},每种卡的 props 契约在 src/cards/<kind>.ts;
 * 这里只知道每种卡「哪些字能被标注、笔是什么样」,不认识的 kind 也有兜底。
 */

/**
 * 一张卡:kind 是种类(text / read / choice / fill / image / code…),props 由那种卡自己定;state 是孩子在卡上做的事(存服务端,形状由那种卡定);
 * assets 是已经生成好的配音文件(相对 conversations/<老师>/,如 2026-09-10.1620-1.cards/2/1.mp3),点读段按 <段号>.mp3 找
 */
export interface BoardCard {
  kind: string;
  props: Record<string, unknown>;
  state?: unknown;
  assets?: string[];
  /** 交给老师过了(服务端按今天交答案那几条算,kid-view 的 submittedCards):锁住,不能改、不能再交 */
  submitted?: boolean;
  /** 样子(围栏行上写的 tint= / look= / emoji=;没有就走机械规则 tintFor / lookFor):底色槽、字形槽、emoji,名字来自主题清单 */
  look?: CardLook;
}

export interface CardLook {
  tint?: string;
  look?: string;
  emoji?: string;
}

/** 五支笔:面类 marker / tint 一下子涂上;线条类 underline / box / circle 是 SVG 路径,描出来 */
export type PenName = 'marker' | 'tint' | 'underline' | 'box' | 'circle';
export const PENS: readonly PenName[] = ['marker', 'tint', 'underline', 'box', 'circle'];
export const LINE_PENS: readonly PenName[] = ['underline', 'box', 'circle'];

/** 孩子端是什么端(发消息时带上;渲染器按它量卡、排行) */
export type Device = 'phone' | 'tablet-portrait' | 'tablet-landscape';

/** 一节明写的并排(课文件 / 老师的 same):为哪个端排的、每行哪几张卡(下标;顺序 = 讲的顺序);没有 = 全按宽度排(rowsFor) */
export interface BoardLayout {
  for: Device;
  rows: number[][];
}

/** 一处敲黑板:第几张卡上的哪个词;pen 没有就按 penFor 的机械规则 */
export interface BoardMark {
  card: number;
  phrase: string;
  pen?: PenName;
  /** 讲稿里念到它的那个词(卡上写「三个角」、讲稿说「几个角」时填);没有 = 用 phrase 在讲稿里找。只用来定时,不影响标在卡上哪个词 */
  said?: string;
}

/** 讲到这句时对某张卡做的事(讲稿里 [[名 参数]]):open / close / play… 页面按卡的种类执行,不认识的忽略 */
export interface BoardCue {
  card: number;
  name: string;
  arg?: string;
}

/** 讲稿的一句:配音文件(没有 = 不出声按字数计时,mock 里是浏览器合成)、这句念到时要画的标注、是不是问句(末句问句 → 停下等)、锚到上一张卡 */
export interface BoardLine {
  text: string;
  audio: string | null;
  marks: BoardMark[];
  ask: boolean;
  /** 这句上面最近的一张卡(没有 = null);播到这句就滚到它,不依赖老师打括号 */
  anchor: number | null;
  cues: BoardCue[];
  /** 热身(讲稿的 [[echo 词]] / [[say 词]]):念完等孩子说 word;say = 你先说(老师没说出来) */
  echo?: { word: string; say?: true };
  /** 讲稿的 [[call]]:念完进打电话 */
  call?: true;
}

/** 一节板书 = 一轮回复:卡整块铺,讲稿逐句播;partial = 还在流式生成 */
export interface BoardSection {
  cards: BoardCard[];
  lines: BoardLine[];
  partial?: boolean;
  /** 流式时:前几拍已经就绪(关了)——页面就绪一拍铺一拍卡;定稿的节没有这个字段(全部就绪) */
  ready?: number;
  layout?: BoardLayout;
}

/**
 * 拍(2026-09-13,《工作流程.md》§二):一张卡 + 它后面直到下一张卡之前的讲稿句;第一张卡之前的句子是没有卡的一拍。
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
 * 流式时前几拍就绪了:一拍要「关了」(后面已经有下一张卡,或老师写完了)。讲稿不配音(《产品规划.md》拍板 30),不等配音。
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
    case 'fill':
      return [str(p.text)];
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
    case 'record':
      return [str(p.show) || (p.mode === 'pinyin' ? '' : str(p.text))];
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
    case 'fill':
    case 'canvas':
    case 'record':
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
    case 'fill':
      return 'underline';
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

/** 独占一行的卡:标题行、提问卡、画板、录音卡、小课堂、画图、拍给我看(选择题、填空题量得下就能半宽,2026-10-01) */
export function standsAlone(card: BoardCard): boolean {
  return isHeading(card) || isAskCard(card) || card.kind === 'canvas' || card.kind === 'record' || card.kind === 'lecture' || card.kind === 'paint' || card.kind === 'photo';
}

const HALF_KINDS = ['text', 'read', 'code', 'tianzige', 'word', 'choice', 'fill'];

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
 * 一节的行(2026-10-01 起排版归代码,《工作流程.md》§二「排版」):每张卡半宽还是全宽,看它自己量出来的样子
 * (half(i),页面在量具里量;没给就按 isShortCard 估)。从左往右排,只看前面的卡:
 * - 相邻两张半宽的并一行;一张半宽后面跟的不是半宽,它自己一行、占左半(右边空着)
 * - 全宽的一行一张;标题行、提问卡、画板、录音卡、小课堂永远独占
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
  if (state.status === 'waiting' && !state.replay && state.line === s.lines.length - 1 && askAt >= 0 && isAskCard(s.cards[askAt])) return askAt;
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

/** 有舞台交互(能改状态、能「交给老师」)的种类;其余点开只是放大看。填空停用了(《卡片协议.md》拍板 3),旧的只看 */
export function hasState(card: BoardCard): boolean {
  return card.kind === 'choice' || card.kind === 'canvas' || card.kind === 'record';
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

/** 小课堂卡能不能放(《小课堂设计.md》§六):课包读得出来,下发时服务端填 ready 与那一段的起止 */
export function lectureReady(card: BoardCard): boolean {
  const p = card.props || {};
  return card.kind === 'lecture' && p.ready === true && typeof p.start === 'number' && typeof p.end === 'number' && p.end > p.start;
}

export type StagePhase = 'drawing' | 'paused' | 'done';

/** 舞台里小课堂那一段在放时的字幕行:讲稿句是课里的,右侧按钮映射到播放器(drawing → 暂停;paused → 播放;done → 没钮) */
export function stageSubtitle(phase: StagePhase, line: string): SubtitleView {
  switch (phase) {
    case 'drawing':
      return { text: line, kind: 'line', right: 'pause' };
    case 'paused':
      return { text: line, kind: 'line', right: 'play' };
    case 'done':
      return { text: line, kind: 'line', right: 'none' };
    default:
      return { text: '', kind: 'empty', right: 'none' };
  }
}

/** 点读第 k 段(0 起)的配音文件(相对 conversations/<老师>/);没生成好 → null(孩子端等它到,mock 退浏览器合成声) */
export function segmentAudio(card: BoardCard, k: number): string | null {
  const want = `/${k + 1}.mp3`;
  return (card.assets || []).find((a) => a.endsWith(want)) ?? null;
}

/** 填空当前填了什么(按空的顺序;没填的空是空串) */
export function filledAnswers(card: BoardCard): string[] {
  const blanks = typeof (card.props || {}).blanks === 'number' ? (card.props.blanks as number) : 0;
  const st = card.state as { answers?: unknown } | undefined;
  const got = Array.isArray(st?.answers) ? st.answers.map((x) => (typeof x === 'string' ? x.trim() : '')) : [];
  return Array.from({ length: blanks }, (_, i) => got[i] ?? '');
}

/** 孩子在这张卡上做了什么(「交给老师」能不能按):选择题是选项,填空是填的字;没做 → [] */
export function stateSummary(card: BoardCard): string[] {
  if (card.kind === 'choice') return pickedLabels(card);
  if (card.kind === 'fill') return filledAnswers(card).filter(Boolean);
  if (card.kind === 'canvas') return inkCount(card) ? [`画了 ${inkCount(card)} 笔`] : [];
  if (card.kind === 'record') { const sec = recordSeconds(card); return sec ? [`录了 ${sec.toFixed(1)} 秒`] : []; }
  return [];
}

// ---- 录音卡(《口播老师设计.md》§2–3) ----

/** 录了几秒;没录 → 0 */
export function recordSeconds(card: BoardCard): number {
  const st = card.state as { audio?: unknown; seconds?: unknown } | undefined;
  return typeof st?.audio === 'string' && typeof st.seconds === 'number' ? st.seconds : 0;
}

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

/** 一串拼音(shi4 si4)→ 带调号的(shì sì) */
export function toneMarks(ref: string): string {
  return ref.split(/\s+/).filter(Boolean).map(toneMark).join(' ');
}

/** 这一节里 idx 之后(转一圈)下一张还没录的录音卡;都录了 → -1 */
export function nextUnrecorded(section: BoardSection, idx: number): number {
  const n = section.cards.length;
  for (let k = 1; k <= n; k++) {
    const j = (idx + k) % n;
    const c = section.cards[j];
    if (c && c.kind === 'record' && !recordSeconds(c)) return j;
  }
  return -1;
}

/** 这一节的录音卡锁没锁:交给老师了(这一节的 job 在 submitted 里),或者后面老师又出了一节 */
export function recordLocked(sections: readonly BoardSection[], secIdx: number, submitted: ReadonlySet<string>): boolean {
  const s = sections[secIdx] as (BoardSection & { job?: string }) | undefined;
  if (!s) return true;
  return secIdx < sections.length - 1 || Boolean(s.job && submitted.has(s.job));
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
/** 孩子端一条带的小课堂(《小课堂设计.md》§五):画的卡是截下来的图(没截图的课包现画那一刻再叠那几笔);家长端的画多一段老师拿到的话(text);again = 再看一遍又画的那条 */
export interface KidLecture {
  bundle: string;
  title: string;
  again?: true;
  video?: true;
  marks?: { atMs: number; svgMs: number; strokes: [number, number][][]; text?: string; image?: string }[];
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
  /** 看完小课堂后的第一条(《小课堂设计.md》):这一节前面是小课堂卡 */
  lecture?: KidLecture;
  /** 孩子这条不是说的话:submit = 交卡(答案在卡上) */
  action?: 'submit';
  /** 按住说话的(索引里带 voice):板上去口头禅、一行截断 */
  /** 首页按钮发的:按钮上的字,不是孩子说的 */
  fromHome?: boolean;
  /** 实时的一轮(讲稿嘴照念,不配音) */
  live?: boolean;
}

/** 板上孩子的一句话(《工作流程.md》§二「一个话题一节」):text 是显示的(语音去了口头禅),full 是原话 */
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
 * 实时的一节怎么接(《wip/实时老师设想.md》拍板 20):新一节的开头由脑定,不再机械是孩子那句。
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

/**
 * 每条孩子的话放在板上哪(《工作流程.md》§二):交卡、首页按钮、空的不放;答的是上一节的问题卡就进那张卡的答案栏(on),
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
    if ((q || photos) && !m.action && !m.fromHome) {
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
    const at = { ...(m.at ? { at: m.at } : {}), ...(m.photos?.length && !k?.said.photos ? { photos: m.photos } : {}), ...(m.lecture ? { lecture: m.lecture } : {}), ...(k ? { said: k.said, ...(k.on ? { saidOn: k.on } : {}) } : {}), ...(m.live ? { live: true as const, ...liveHead(m.section ?? { cards: [] }) } : {}) };
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

/** 板上的位置。孩子端不念讲稿了(《产品规划.md》拍板 30):讲稿由嘴照念(live-board.ts 的 liveStep),这里的状态只剩
 *  thinking = 老师还在写 · waiting = 写完了、末句是问句 · done = 写完了 · idle = 板上还没东西。
 *  playing / paused / stage 与 replay 只出现在录像里孩子的屏幕(reel 照记下的播放位置算的),孩子端自己不会进这几个状态 */
export type PlayStatus = 'idle' | 'playing' | 'paused' | 'waiting' | 'done' | 'stage' | 'thinking';

export interface PlayerState {
  section: number;
  line: number;
  status: PlayStatus;
  /** 录像里:那时孩子在「再听」的句子(板书时代的录像) */
  replay?: { lines: number[]; back: PlayerState };
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

export interface SubtitleInput {
  state: PlayerState;
  sections: readonly BoardSection[];
  pending: boolean;
  /** 孩子发出后等了多久(毫秒):第一拍前等久了换一句 */
  waitedMs: number;
}

export interface SubtitleView {
  text: string;
  /** wait = 第一拍前(板上有占位卡);gap = 拍与拍之间(留着刚念那句,变暗加点);replay = 再听(淡一档、前面一个小喇叭,和老师正在说的分开) */
  kind: 'line' | 'wait' | 'gap' | 'replay' | 'empty';
  /** stop = 再听时的钮(停,回原位置),和暂停 / 播放长得不一样;等答时没有钮(「继续」2026-10-08 去掉了) */
  right: 'pause' | 'play' | 'stop' | 'none';
}

/** 第一拍前等过这么久,字幕从「我写给你看」换成「再等我一下下」 */
export const WAIT_LONG_MS = 8000;

/** 字幕行:等老师 > 当前句(按播放状态定右侧的钮) */
export function subtitleFor(i: SubtitleInput): SubtitleView {
  const line = i.sections[i.state.section]?.lines[i.state.line];
  const text = line ? plainLine(line.text) : '';
  // 老师还在写:正在播已就绪的句子就照常出字幕;这节念过几句了就留着刚念那句等下一拍;一句还没念(第一拍前)才出等的话
  if (i.state.status === 'thinking' && text) return { text, kind: 'gap', right: 'none' };
  if (i.state.status === 'thinking' || (i.pending && i.state.status !== 'playing' && i.state.status !== 'paused' && i.state.status !== 'stage')) return { text: i.waitedMs < WAIT_LONG_MS ? '我写给你看' : '再等我一下下', kind: 'wait', right: 'none' };
  if (i.state.replay) return { text, kind: 'replay', right: 'stop' };
  switch (i.state.status) {
    case 'playing':
      return { text, kind: 'line', right: 'pause' };
    case 'paused':
      return { text, kind: 'line', right: 'play' };
    case 'waiting':
      return { text, kind: 'line', right: 'none' };
    case 'done':
      return { text, kind: text ? 'line' : 'empty', right: 'none' };
    case 'stage':
      return { text, kind: 'line', right: 'none' };
    default:
      return { text: '', kind: 'empty', right: 'none' };
  }
}

// ---- 板上的节(2026-10-22 起只剩这些,《产品规划.md》拍板 30):老师开始写、又就绪一拍、写完、出错撤掉、整节到了;页面的 reset(换老师)、halt(停卡的声音)。
// 页面只照单执行回来的「要做的事」;表在《工作流程.md》§孩子端「播放器」,每一格在 tests/player.test.ts 里有一条 ----

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
