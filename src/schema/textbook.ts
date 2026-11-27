/**
 * 课本:家长从教育网站下载的教材 PDF 放在 vault 的 `教材/` 下,进「课本」时整页铺成页。
 * 应用读 PDF 的文字层(不认图):每个字在页上的位置、头上的拼音、目录、印刷页码。读一次存成索引(`.cotutor/textbooks/<指纹>.json`,能重新生成)。
 *
 * 坐标:PDF 的点(pt),原点在页的左上角,y 往下长。PdfItem 的 y 是这一段字的基线。
 */

/** pdf.js 取出来的一段字(一个 text item):s 原文,f 字体的真名(读不到是 pdf.js 的编号),x 左边,y 基线(从页顶量),z 字号,w 宽 */
export interface PdfItem {
  s: string;
  f: string;
  x: number;
  y: number;
  z: number;
  w: number;
}

/** 一页的原始文字:n 是 PDF 里的第几页(从 1 起);cells = 页上画的田字格(src/memory/textbook-cells.ts 从画图的指令里认的) */
export interface PdfPage {
  n: number;
  w: number;
  h: number;
  items: PdfItem[];
  cells?: PdfCell[];
  /** 页上描边的小方框(10–60pt 宽、10–30pt 高,田字格以外的):数学算式里的空(□)从这里挑(textbook-index.ts 的 blankCells) */
  boxes?: [number, number, number, number][];
  /** 页上画的表格(src/memory/textbook-cells.ts 的 findTables):一张表一组格,r、c 是第几行第几列(从 0 起) */
  tables?: PdfTableCell[][];
  /** 描边、没填颜色、6–30pt 近似方的小方框:打勾的 □ 从这里挑(textbook-index.ts 的 tickCells) */
  squares?: [number, number, number, number][];
  /** 实线描边、没涂色的数框和符号圈:和文字拼得成算式的才是作答区 */
  formulaShapes?: { symbol: '□' | '○'; box: [number, number, number, number] }[];
  /** 页上画了东西的小地方(120pt 以内的图标、小插图、画的框;src/memory/textbook-cells.ts):算式等号后面这里画了东西就不是留给孩子写的空白 */
  marks?: [number, number, number, number][];
}

/** 表格里的一格(PDF 的点,左上角起) */
export interface PdfTableCell { r: number; c: number; box: [number, number, number, number] }

/** 页上画的一个田字格(PDF 的点,左上角起):格里印的字(没有 = 空格)、那个字是不是红的(描红) */
export interface PdfCell {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ch?: string;
  red?: boolean;
}

/**
 * 一页上孩子能写的一格(docs/dev/课本.md):田字格分 model = 印着黑字的范字,trace = 印着红字让孩子描的,empty = 空着让孩子写的;
 * blank = 填空:算式里的空方框(□)、空着的括号(没有田字格的线,没有范字);table = 表格里没字的一格(r、c 是第几行第几列,从 0 起);
 * tick = 打勾的小方框(没填颜色、里面没字、旁边贴着字)。
 * ch = 格里印的字;m = 这一格照着写的那个字(同一排它左边最近的范字;描红就是它自己的字;前面没有范字的空格没有)。坐标同 BookLine(PDF 的点)
 */
export interface BookCell {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'model' | 'trace' | 'empty' | 'blank' | 'table' | 'tick';
  ch?: string;
  m?: string;
  r?: number;
  c?: number;
  /** 表格的格:是这一页第几张表(从 0 起,同 BookPage.tables) */
  t?: number;
}

/**
 * 一个字:左右边(行的上下边就是它的上下边);py = 头上印的拼音(已解码成带调的,如 jǐng);
 * dot = 字下面加了着重号(「读一读,注意加点的词」);sp = 和前一个字之间空开一个字宽以上(「灌溉田地  发动机器」,一行里隔开的词)
 */
export interface BookChar {
  c: string;
  x1: number;
  x2: number;
  py?: string;
  dot?: true;
  sp?: true;
}

/** 一行:同一基线、同一字号连着的字。y1、y2 是字的上下边(不含拼音);f 字体的真名(去掉子集前缀的 FZKTRJK--GBK1-0,整册一样;读不到时是 pdf.js 的页内编号);text 不带空格(隔开的地方看字的 sp,spacedText) */
export interface BookLine {
  text: string;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  z: number;
  f: string;
  chars: BookChar[];
}

export interface BookPage {
  /** PDF 里的第几页(从 1 起) */
  n: number;
  /** 页脚印的页码;封面、插图页没有 = null */
  printed: number | null;
  w: number;
  h: number;
  /** 从上到下、从左到右 */
  lines: BookLine[];
  /** 页上的田字格(从上到下、从左到右);没有就不写 */
  cells?: BookCell[];
  /** 页上的表格(外框,PDF 的点);有空格的表格才记;没有就不写 */
  tables?: [number, number, number, number][];
}

/**
 * 目录里的一项:一课、一个语文园地,或一课下面的一首诗(parent 是那一课)。
 * 数学(layout: math):一个单元(no 是「二」)、单元之间没编号的综合实践(校园小导游);单元下面页里的小节(1.乘法的初步认识)、课题(6的乘法口诀),parent 是上一层。
 * from / to 是印刷页码(to = 下一项开始的前一页);pages 是对应的 PDF 页 [头, 尾]。
 * toc:这一项印在目录页的哪一行(PDF 第几页、PDF 的点 [左, 上, 右, 下],从序号到页码,点线也算);孩子在目录上点它就翻过去。页里读出来的小节、课题没有
 * kind:lesson = 有编号的一课、一个单元和它下面的;garden = ◎ 开头的(语文园地、快乐读书吧)、数学的综合实践;other = 识字表这类附录。
 */
export interface BookLesson {
  title: string;
  unit: string | null;
  no: string | null;
  kind: 'lesson' | 'garden' | 'other';
  parent?: string;
  from: number;
  to: number;
  pages: [number, number];
  toc?: { n: number; box: [number, number, number, number] };
}

/** 索引的版本:取字、分行的规则改了就加一,旧缓存重做 */
export const BOOK_INDEX_VERSION = 12;

/**
 * 一册怎么分块(出分块的规则 src/memory/textbook-zones-rules.ts):prose = 课文(自然段、语文园地的栏目);
 * math = 数学课本(例题、做一做 / 练一练这些栏目和下面的题);science = 科学课本(问题与想法、探索与实践这些栏目,栏目下面分段)。
 * 照文件名定:带「数学」的是 math,带「科学」的是 science
 */
export type BookLayout = 'prose' | 'math' | 'science';

export interface BookIndex {
  v: number;
  /** PDF 相对 vault 根的路径(`教材/语文二年级上册-人教统编版.pdf`) */
  file: string;
  /** 文件内容的指纹(sha1 前 16 位):换了文件旧缓存不用 */
  sha: string;
  /** 册名:文件名去掉扩展名 */
  title: string;
  layout: BookLayout;
  pages: BookPage[];
  /** 目录在 PDF 的哪几页(第一次进课本、还没翻到哪一课时铺的就是它) */
  toc: number[];
  lessons: BookLesson[];
  /** 自检发现的问题(拼音解不出、没有页码、没有目录……);有问题这一册照样能看,但给家长端报一行 */
  problems: string[];
}

// ——— 数学课本的版式(读目录的 src/memory/textbook-index.ts 与分块的 src/chalk/kit/book.ts 都用) ———

/** 数学课本的栏目名:和课题一个字号,不算课题(整理和复习的「复」有的字体取出来是乱码) */
export const MATH_COLUMNS = /^(做一做|练一练|试一试|整理和.习|你知道吗[?？]?|成长小档案|小讲堂|自我评价|后记)$/;

// ——— 科学课本的版式(分块的 src/chalk/kit/book.ts 用) ———

/**
 * 科学课本的栏目名独占一行,后面可带一个序号(广东版「探索与实践1」;教科版的聚焦、探索、研讨、拓展);回「探索与实践 1」这样的名字,不是 = null
 */
const SCIENCE_COLUMN = /^(问题与想法|探索与实践|讨论与发现|思考与练习|聚焦|探索|研讨|拓展)(\d{0,2})$/;
export function scienceColumn(text: string): string | null {
  const m = SCIENCE_COLUMN.exec(text.replace(/\s/g, ''));
  return m ? (m[2] ? `${m[1]} ${m[2]}` : m[1]) : null;
}

/** 正文的字号:六个字以上的汉字行里字最多的那种 */
export function bodySize(lines: readonly BookLine[]): number {
  const w = new Map<number, number>();
  for (const l of lines) if (l.chars.length >= 6 && /\p{Script=Han}/u.test(l.text)) w.set(l.z, (w.get(l.z) ?? 0) + l.chars.length);
  return [...w].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 16;
}

/** 数学课本里一行是不是标题:section = 小节(1.乘法的初步认识),topic = 课题(6的乘法口诀);不是 = null */
export function mathHeading(l: BookLine, pageW: number, body: number): 'section' | 'topic' | null {
  const t = l.text;
  // 标题不以括号起头、不以标点收尾(题目「用乘法口诀求商。」「（）六十二」字号也可能大)
  if (!/\p{Script=Han}/u.test(t) || MATH_COLUMNS.test(t) || l.chars.length > 16 || /^[（(]/.test(t) || /[。？！：，?!:,]$/.test(t)) return null;
  if (l.z >= 1.2 * body && /^\d{1,2}[.．]\S/.test(t)) return 'section';
  if (l.z >= 1.1 * body && l.z < 1.25 * body && l.x1 < 0.3 * pageW) return 'topic';
  return null;
}

// ——— 页眉页脚、带读音的字(出分块的规则 src/memory/textbook-zones-rules.ts 与读分块的 src/chalk/kit/book.ts 都用) ———

/** 页脚:页码;和页码同一条基线的小字(数学的页脚是「16 1～6的表内乘法」、偶数页另起的单元名) */
function bookFooter(p: BookPage, l: BookLine): boolean {
  if (l.y1 <= p.h - 70) return false;
  if (/^\d{1,3}$/.test(l.text)) return true;
  if (p.printed === null || l.z > 12.5) return false;
  const no = String(p.printed);
  return p.lines.some((o) => o.y1 > p.h - 70 && Math.abs(o.y1 - l.y1) < 2 && o.text.startsWith(no));
}

/**
 * 页眉(单元名)、页脚(页码、「仅供个人学习使用」)不算正文。
 * 页顶的数只在它就是这一页的页码时算页眉:数学的题号常印在页顶(第 5 题从这一页开头)
 */
export const bookChrome = (p: BookPage, l: BookLine): boolean => (l.y1 < 45 && (/单元/.test(l.text) || (p.printed !== null && l.text === String(p.printed)))) || bookFooter(p, l) || /仅供个人学习使用/.test(l.text);

/** 一行的字,隔开的地方(字的 sp)留一个空格:「灌溉田地 发动机器」;sep 换掉空格(念的时候用顿号) */
export function spacedText(l: Pick<BookLine, 'chars'>, sep = ' ', f: (c: BookChar) => string = (c) => c.c): string {
  return l.chars.map((c, k) => (k && c.sp ? sep : '') + f(c)).join('');
}

/** 一行短的、几乎每个字都带拼音的(认字栏、识字加油站的词):给老师看时带上读音「观(guān)沿(yán)」;别的只给字(隔开的地方留空格) */
export function withPinyin(l: BookLine): string {
  const han = l.chars.filter((c) => /\p{Script=Han}/u.test(c.c));
  if (l.chars.length > 14 || !han.length || han.filter((c) => c.py).length < han.length * 0.8) return spacedText(l);
  return spacedText(l, ' ', (c) => (c.py ? `${c.c}(${c.py})` : c.c));
}

/**
 * 字体的简称(给人和编程助手看的样式「宋 16」):方正的几种常见字体照字体名的头认,别的去掉「--GBK1-0」这种编码尾巴。
 * 2026-11-26 数过人教语文、数学二上和广东版科学二上用到的
 */
const FONT_SHORT: [RegExp, string][] = [
  [/^FZKT/, '楷'], [/^FZSS|^FZS3|^FZSY/, '宋'], [/^FZFS/, '仿'], [/^FZHT|^FZH(EI)?/, '黑'], [/^FZZHUNY/, '准圆'], [/^FZZY/, '中圆'], [/^FZCY/, '粗圆'],
  [/^FZXH/, '细黑'], [/^FZLTH/, '兰亭黑'], [/^HanyuXi|pinyin/i, '拼音'], [/kenten/i, '着重号'],
];
/** 数字、运算符、页码用的西文字体:不分是哪一家,只分粗细 */
const LATIN = /^(KannadaSangam|KhmerSangam|Univers|CenturyGothic|Helvetica|Futura|Arial|Times)/;
export function fontShort(f: string): string {
  for (const [re, s] of FONT_SHORT) if (re.test(f)) return s;
  if (LATIN.test(f)) return /bold/i.test(f) ? '西文粗' : '西文';
  return f.replace(/--GBK?1?-?\d*$|--GB1-0$/, '').replace(/-(Regular|Medium)$/, '');
}

/** 一行的样式:字体简称 × 字号(「楷 18」) */
export const lineStyle = (l: Pick<BookLine, 'f' | 'z'>): string => `${fontShort(l.f)} ${Math.round(l.z * 2) / 2}`;

/** 几行里字最多的样式;没有字 = undefined */
export function styleOf(lines: readonly Pick<BookLine, 'f' | 'z' | 'chars'>[]): string | undefined {
  const w = new Map<string, number>();
  for (const l of lines) w.set(lineStyle(l), (w.get(lineStyle(l)) ?? 0) + l.chars.length);
  return [...w].sort((a, b) => b[1] - a[1])[0]?.[0];
}
