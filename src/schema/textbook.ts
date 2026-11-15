/**
 * 课本(2026-11-14《语文预习:PDF 课本与镜头交互》):家长从教育网站下载的教材 PDF 放在 vault 的 `教材/` 下,预习时整页铺在板上。
 * 应用读 PDF 的文字层(不认图):每个字在页上的位置、头上的拼音、目录、印刷页码。读一次存成索引(`.cotutor/textbooks/<指纹>.json`,能重新生成)。
 *
 * 坐标:PDF 的点(pt),原点在页的左上角,y 往下长。PdfItem 的 y 是这一段字的基线。
 */

/** pdf.js 取出来的一段字(一个 text item):s 原文,f 字体,x 左边,y 基线(从页顶量),z 字号,w 宽 */
export interface PdfItem {
  s: string;
  f: string;
  x: number;
  y: number;
  z: number;
  w: number;
}

/** 一页的原始文字:n 是 PDF 里的第几页(从 1 起) */
export interface PdfPage {
  n: number;
  w: number;
  h: number;
  items: PdfItem[];
}

/** 一个字:左右边(行的上下边就是它的上下边);py = 头上印的拼音(已解码成带调的,如 jǐng) */
export interface BookChar {
  c: string;
  x1: number;
  x2: number;
  py?: string;
}

/** 一行:同一基线、同一字号连着的字。y1、y2 是字的上下边(不含拼音);f 字体(PDF 内部的名字,只在这本书里有意义) */
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
}

/**
 * 目录里的一项:一课、一个语文园地,或一课下面的一首诗(parent 是那一课)。
 * 数学(layout: math):一个单元(no 是「二」)、单元之间没编号的综合实践(校园小导游);单元下面页里的小节(1.乘法的初步认识)、课题(6的乘法口诀),parent 是上一层。
 * from / to 是印刷页码(to = 下一项开始的前一页);pages 是对应的 PDF 页 [头, 尾]。
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
}

/** 索引的版本:取字、分行的规则改了就加一,旧缓存重做 */
export const BOOK_INDEX_VERSION = 3;

/**
 * 一册怎么分块(src/chalk/kit/book.ts 的 lessonBlocks):prose = 课文(自然段、语文园地的栏目);
 * math = 数学课本(例题、做一做 / 练一练这些栏目和下面的题)。照文件名定:带「数学」的是 math
 */
export type BookLayout = 'prose' | 'math';

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
  /** 目录在 PDF 的哪几页(刚进预习、还没定哪一课时铺的就是它) */
  toc: number[];
  lessons: BookLesson[];
  /** 自检发现的问题(拼音解不出、没有页码、没有目录……);有问题这一册照样能看,但给家长端报一行 */
  problems: string[];
}

// ——— 数学课本的版式(读目录的 src/memory/textbook-index.ts 与分块的 src/chalk/kit/book.ts 都用) ———

/** 数学课本的栏目名:和课题一个字号,不算课题(整理和复习的「复」有的字体取出来是乱码) */
export const MATH_COLUMNS = /^(做一做|练一练|试一试|整理和.习|你知道吗[?？]?|成长小档案|小讲堂|自我评价|后记)$/;

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
