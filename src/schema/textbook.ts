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
 * from / to 是印刷页码(to = 下一项开始的前一页);pages 是对应的 PDF 页 [头, 尾]。
 * kind:lesson = 有编号的一课;garden = ◎ 开头的(语文园地、快乐读书吧);other = 识字表这类附录。
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
export const BOOK_INDEX_VERSION = 1;

export interface BookIndex {
  v: number;
  /** PDF 相对 vault 根的路径(`教材/语文二年级上册-人教统编版.pdf`) */
  file: string;
  /** 文件内容的指纹(sha1 前 16 位):换了文件旧缓存不用 */
  sha: string;
  /** 册名:文件名去掉扩展名 */
  title: string;
  pages: BookPage[];
  /** 目录在 PDF 的哪几页(刚进预习、还没定哪一课时铺的就是它) */
  toc: number[];
  lessons: BookLesson[];
  /** 自检发现的问题(拼音解不出、没有页码、没有目录……);有问题这一册照样能看,但给家长端报一行 */
  problems: string[];
}
