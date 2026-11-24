/**
 * 测试用的一本科学小书(照广东版科学二年级上册的排法造的,字是编的):PDF 第 1 页是目录,印刷页码 = PDF 页 − 1。
 *   拼音是标准 Unicode,一个字头上一段,g 印成 ɡ、轻声的 a 印成 ɑ;目录里每一项头上也印拼音。
 *   目录:「第1单元 空气和水 / 1」(单元带页码)、「第1课 认识空气 / 2」「第2课 观察水 / 4」:页码前一道斜杠,课号是「第1课」。
 *   第 1 页单元页;第 2–3 页《认识空气》:课名、开头一段、问题与想法1、探索与实践1(两段,第一段中间并排一条安全提示,下面一张小表)、
 *   讨论与发现1(跨到下一页)、思考与练习;第 4 页《观察水》。
 * tests/textbook.test.ts 用。
 */
import { buildBookIndex } from '../src/memory/textbook-index.ts';
import type { BookIndex, PdfItem, PdfPage } from '../src/schema/index.ts';

export const SW = 521.6, SH = 737;
const wOf = (s: string, z: number): number => Array.from(s).reduce((a, c) => a + (c.trim() ? (c.charCodeAt(0) < 0x2000 ? 0.55 : 1) : 0.5), 0) * z;
const it = (s: string, x: number, y: number, z: number, f = 'body'): PdfItem => ({ s, f, x, y, z, w: wOf(s, z) });
/** 一行字,一个字一段;py 给了就在字头上印 Unicode 拼音(一个音节一段) */
function line(text: string, x: number, y: number, z: number, f: string, py?: (string | undefined)[]): PdfItem[] {
  const out: PdfItem[] = [];
  Array.from(text).forEach((c, k) => {
    const cx = x + k * z;
    out.push({ s: c, f, x: cx, y, z, w: z });
    const p = py?.[k];
    if (p) { const pz = z * 0.65, w = p.length * pz * 0.5; out.push({ s: p, f: 'py', x: cx + z / 2 - w / 2, y: y - z * 1.05, z: pz, w }); }
  });
  return out;
}
/** 正文一行:每个汉字头上都印拼音(拼音照字给,随便编) */
const body = (text: string, x: number, y: number): PdfItem[] => line(text, x, y, 16, 'body', Array.from(text).map((c) => (/\p{Script=Han}/u.test(c) ? 'kōnɡ' : undefined)));
const foot = (printed: number): PdfItem => it(String(printed), printed % 2 ? 461 : 54, 695, 12, 'num');
const page = (n: number, items: PdfItem[]): PdfPage => ({ n, w: SW, h: SH, items: [...items, foot(n - 1)] });

/** 目录的一项:序号、名字、「/ 页码」各一段,头上印拼音 */
const entry = (no: string, name: string, at: number, y: number, x: number): PdfItem[] => [
  it(no, x, y, 16, 'toc'),
  ...line(name, x + 70, y, 16, 'toc', Array.from(name).map(() => 'ɡuān')),
  it(`/ ${at}`, x + 90 + 16 * Array.from(name).length, y, 16, 'toc'),
];

const toc: PdfPage = { n: 1, w: SW, h: SH, items: [
  it('目 录', 364, 72, 50, 'toc'),
  ...entry('第1单元', '空气和水', 1, 194, 54),
  ...entry('第1课', '认识空气', 2, 249, 82),
  ...entry('第2课', '观察水', 4, 290, 82),
] };

export const sciencePages: PdfPage[] = [
  toc,
  page(2, [
    it('1', 83, 414, 59, 'big'),
    it('第单元', 41, 431, 30.7, 'big'),
    ...line('空气和水', 253, 479, 45, 'big'),
    ...body('我们的生活离不开空气和水。', 96, 569),
  ]),
  page(3, [
    it('空气在哪里？', 265, 57, 12, 'cap'),
    ...line('第1课认识空气', 72, 215, 30, 'title'),
    ...body('雨后的公园里，他们在说什么？', 96, 284),
    it('问题与想法1', 61, 371, 17, 'col'),
    ...body('空气在哪里？', 97, 419),
    it('探索与实践1', 61, 473, 17, 'col'),
    ...body('准备一个保鲜袋，观察袋', 97, 522),
    // 和正文并排的安全提示(小字),夹在这一段的两行之间
    it('不要被牙签扎到。', 339, 540, 12, 'tip'),
    ...body('内是否有东西。', 54, 563),
    ...body('将袋口打开，抖动几下。', 97, 605),
    it('观察时刻', 62, 640, 12, 'tbl'),
    it('抖动前', 268, 640, 12, 'tbl'),
    it('讨论与发现1', 61, 670, 17, 'col'),
  ]),
  page(4, [
    ...line('从上述现象中，你发现了什么？', 97, 60, 16, 'body', ['cónɡ', 'shànɡ', 'shù', 'xiàn', 'xiànɡ', 'zhōnɡ', undefined, 'nǐ', 'fā', 'xiàn', 'le', 'shén', 'mɑ']),
    it('思考与练习', 71, 177, 17, 'col'),
    ...body('1.空气有什么特征呢？', 96, 228),
  ]),
  page(5, [
    ...line('第2课观察水', 72, 215, 30, 'title'),
    ...body('水是什么样子的？', 96, 284),
  ]),
];

export const scienceIndexOf = (): BookIndex => buildBookIndex(sciencePages, { file: '科学二年级上册.pdf', sha: 's', title: '科学二年级上册' });
