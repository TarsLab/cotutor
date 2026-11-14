/**
 * 测试用的一本小书(照人教统编版排法造的,字是编的):PDF 第 1 页是目录;印刷页码 = PDF 页 − 1,印在页脚。
 *   《小鱼吹泡泡》1–2 页:正文带拼音(自造编码:jJng = jǐng),第 1 段一行、第 2 段从第 1 页底跨到第 2 页顶,后面是认字栏;
 *   《古诗两首》3–4 页,下面两首各一页;语文园地一 5–7 页,按栏目分(第 7 页空着);识字表在最后。
 * tests/textbook.test.ts、tests/board-page.test.ts 用。真的 PDF(pdf.js 读文字层)走 scripts/probe-textbook.mjs,拿家长放的教材跑
 */
import { PINYIN_TONES, buildBookIndex } from '../src/memory/textbook-index.ts';
import type { BookIndex, PdfItem, PdfPage } from '../src/schema/index.ts';

const W = 520, H = 736;
export { W, H };
// 带调的韵母 → 自造字体的大写字母(PINYIN_TONES 反过来)
const ENC = Object.fromEntries(Object.entries(PINYIN_TONES).map(([k, v]) => [v, k]));
const enc = (py: string): string => Array.from(py).map((c) => ENC[c] ?? c).join('');

/** 一行字:一个字一段(真 PDF 也有几个字一段的,见 splitItem 那条);py 给了就在每个字头上印拼音 */
function line(text: string, x: number, y: number, z: number, f: string, py?: string[]): PdfItem[] {
  const out: PdfItem[] = [];
  Array.from(text).forEach((c, k) => {
    const cx = x + k * z;
    out.push({ s: c, f, x: cx, y, z, w: z });
    const p = py?.[k];
    if (p) { const w = p.length * z * 0.3; out.push({ s: enc(p), f: 'py', x: cx + z / 2 - w / 2, y: y - z, z: z * 0.55, w }); }
  });
  return out;
}
const foot = (printed: number): PdfItem => ({ s: String(printed), f: 'num', x: printed % 2 ? 474 : 51, y: H - 49, z: 12, w: 14 });
const page = (n: number, items: PdfItem[]): PdfPage => ({ n, w: W, h: H, items: [...items, foot(n - 1)] });
const entry = (no: string, title: string, at: number, y: number, x = 56): PdfItem[] => [
  ...(no ? [{ s: no, f: 'toc', x, y, z: 14, w: 14 * 0.55 * no.length }] : []),
  { s: title, f: 'toc', x: x + 26, y, z: 14, w: 14 * Array.from(title).length },
  // 点线比字高 4 个点(真目录就这样)
  { s: '..........', f: 'toc', x: x + 30 + 14 * Array.from(title).length, y: y - 4, z: 14, w: 60 },
  { s: String(at), f: 'toc', x: 228, y, z: 14, w: 14 },
];

const toc: PdfPage = { n: 1, w: W, h: H, items: [
  { s: '目录', f: 'toc', x: 230, y: 40, z: 20, w: 40 },
  { s: '第一单元·阅读', f: 'toc', x: 54, y: 200, z: 14, w: 98 },
  ...entry('1', '小鱼吹泡泡', 1, 230),
  ...entry('2', '古诗两首', 3, 256),
  ...entry('', '静夜思', 3, 282, 80),
  ...entry('', '春晓', 4, 308, 80),
  ...entry('◎', '语文园地一', 5, 334),
  ...entry('', '识字表', 8, 380, 30),
] };
const B = 'body';
export const pages: PdfPage[] = [
  toc,
  page(2, [
    { s: '第一单元·阅读', f: 'hdr', x: 28, y: 30, z: 16, w: 112 },
    ...line('小鱼吹泡泡', 200, 100, 27.5, 'title', ['xiǎo', 'yú', 'chuī', 'pào', 'pao']),
    // 第 1 段:缩进两个字
    ...line('小鱼在水里吹泡泡。', 100, 183, 18, B, ['xiǎo', 'yú', 'zài', 'shuǐ', 'lǐ', 'chuī', 'pào', 'pao']),
    // 第 2 段:缩进起头,下一行顶格,跨到下一页
    ...line('小鱼说：“泡泡圆圆的，像一个个', 100, 223, 18, B, ['xiǎo', 'yú', 'shuō']),
    ...line('小月亮，飞到天上去。泡泡飞呀', 58, 263, 18, B),
  ]),
  page(3, [
    ...line('飞，飞进了井沿边的小花园。”', 58, 69, 18, B, [undefined, undefined, undefined, undefined, undefined, 'jǐng', 'yán'] as string[]),
    // 第 3 段
    ...line('小鸟听了，也来吹泡泡。', 100, 109, 18, B, ['xiǎo', 'niǎo']),
    // 认字栏:隔开一大截
    ...line('泡圆像井沿', 163, 200, 18, B, ['pào', 'yuán', 'xiàng', 'jǐng', 'yán']),
    ...line('读一读，说一说小鱼的泡泡像什么。', 94, 300, 16, 'q'),
  ]),
  page(4, [
    ...line('古诗两首', 239, 115, 27.5, 'title'),
    ...line('静夜思', 223, 200, 24, 'title'),
    ...line('床前明月光，', 210, 310, 21, B),
    ...line('疑是地上霜。', 210, 354, 21, B),
  ]),
  page(5, [...line('春晓', 223, 200, 24, 'title'), ...line('春眠不觉晓，', 210, 310, 21, B), ...line('处处闻啼鸟。', 210, 354, 21, B)]),
  page(6, [
    ...line('语文园地一', 215, 64, 18, 'h1'),
    ...line('识字加油站', 61, 130, 16, 'sec'),
    ...line('小鱼小鸟小花', 122, 208, 16, 'g', ['xiǎo', 'yú', 'xiǎo', 'niǎo', 'xiǎo', 'huā']),
    ...line('字词句运用', 61, 477, 16, 'sec'),
    ...line('圆圆的泡泡像什么？', 74, 518, 16, 'g'),
  ]),
  page(7, [...line('日积月累', 86, 455, 16, 'sec'), ...line('◎月亮弯弯像小船。', 93, 519, 14, 'g')]),
  page(8, []),
  page(9, [...line('识字表', 200, 60, 20, 'h1')]),
];


/** 这本小书的索引(文件名「语文一年级下册.pdf」) */
export const bookIndexOf = (): BookIndex => buildBookIndex(pages, { file: '语文一年级下册.pdf', sha: 'abc', title: '语文一年级下册' });
