/**
 * 课本页上的田字格(src/memory/textbook-cells.ts 认格子,src/memory/textbook-index.ts 的 bookCells 分范字 / 描红 / 空格、记照着写的字,
 * src/chalk/kit/book.ts 的 bookCellsOf 换到场景里)。路径和字是照人教统编语文二上画田字格的样子造的(39pt 见方、两条虚线中线、范字深灰、描红红),
 * 真课本的核实见 docs/dev/课本.md;pdf.js 画图指令那一层在最后一段用手写的一页 PDF 真跑。
 */
import { findBoxes, findCells, type CellGlyph, type CellPath } from '../src/memory/textbook-cells.ts';
import { blankCells, bookCells } from '../src/memory/textbook-index.ts';
import { bookCellsOf, bookSheets } from '../src/chalk/index.ts';
import type { BookPage, PdfItem } from '../src/schema/index.ts';
import { check, done } from './_check.ts';

const S = 39.3;
/** 一个田字格的三条路径:外框、竖中线、横中线(虚线) */
const cell = (x: number, y: number): CellPath[] => [
  { box: [x, y, x + S, y + S], quad: true, dashed: false },
  { box: [x + S / 2, y - 0.1, x + S / 2, y + S + 0.1], quad: false, dashed: true },
  { box: [x - 0.2, y + S / 2, x + S + 0.2, y + S / 2], quad: false, dashed: true },
];
/** 格里一个字:字形起点在格的左下(基线),字号比格小一点 */
const glyph = (s: string, x: number, y: number, fill: string): CellGlyph => ({ s, x: x + 3, y: y + S - 6, size: 33, fill });
const DARK = '#2c2e35', RED = '#ff8281';

// 一排:转(范字)转(描红)□ □ 夹(范字)夹(描红)□ □;另一排单独一个空格(选字填空)
const row = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => 113.5 + i * S);
const paths: CellPath[] = [
  ...row.flatMap((x) => cell(x, 336)),
  ...cell(120, 500),
  // 同一格描了两遍
  ...cell(120, 500),
  // 标点的小方框:没有中线,不算
  { box: [300, 600, 320, 620], quad: true, dashed: false },
  // 一个正方形,只有一条中线:不算
  { box: [400, 600, 439, 639], quad: true, dashed: false },
  { box: [419.5, 600, 419.5, 639], quad: false, dashed: true },
  // 太大的框(插图的边):不算
  ...cell(0, 0).map((p) => (p.quad ? { ...p, box: [0, 0, 200, 200] as [number, number, number, number] } : p)),
];
const glyphs: CellGlyph[] = [glyph('转', row[0], 336, DARK), glyph('转', row[1], 336, RED), glyph('夹', row[4], 336, DARK), glyph('夹', row[5], 336, RED), { s: '一排字不是一个字', x: row[2], y: 360, size: 20, fill: DARK }];

const raw = findCells(paths, glyphs);
check('认出田字格:正方形 + 横竖两条虚线中线;标点小方框、只有一条中线的、太大的框不算;描两遍的只算一格', raw.length === 9, JSON.stringify(raw.map((c) => [c.x1, c.y1])));
check('从上到下、从左到右', raw[0].x1 < raw[1].x1 && raw[8].y1 > raw[0].y1);
check('格里的字:红的是描红,一段好几个字的不算格里的字', raw[0].ch === '转' && !raw[0].red && raw[1].ch === '转' && raw[1].red === true && raw[2].ch === undefined && raw[3].ch === undefined, JSON.stringify(raw.slice(0, 4)));

const cells = bookCells(raw);
check('分成范字、描红、空格', cells.map((c) => c.kind).join() === 'model,trace,empty,empty,model,trace,empty,empty,empty', cells.map((c) => c.kind).join());
check('空格照它左边最近的范字写;一排里隔开的两组各照各的', cells.map((c) => c.m ?? '-').join('') === '转转转转夹夹夹夹-', cells.map((c) => c.m ?? '-').join(''));
check('前面没有范字的空格(选字填空)没有照着写的字', cells[8].kind === 'empty' && cells[8].m === undefined);

const page: BookPage = { n: 16, printed: 11, w: 521.6, h: 737, lines: [], cells };
const sheets = bookSheets([page]);
const scene = bookCellsOf([page], sheets);
const k = 1000 / page.w;
check('换到场景里:id 是「PDF 第几页.第几格」,框照页宽 1000 缩放', scene.length === 9 && scene[2].id === '16.2' && Math.abs(scene[2].box[0] - cells[2].x1 * k) < 0.2 && Math.abs(scene[2].box[2] - scene[2].box[0] - S * k) < 0.5, JSON.stringify(scene[2]));
check('没有格的页:没有', bookCellsOf([{ ...page, cells: undefined }], sheets).length === 0);

// ——— 填空(R5):算式里的□、空着的括号(照人教数学二上的排法造的:字号 16,一个□ 17pt 见方) ———
{
  const it = (s: string, x: number, y: number, w: number): PdfItem => ({ s, f: 'g', x, y, z: 16, w });
  const sq = (x: number, y: number, w = 17, h = 17): CellPath => ({ box: [x, y - 14, x + w, y - 14 + h], quad: true, dashed: false });
  // 4×2=□   □×4=8   表格里连着的三格   框里有字的   一段话后面单独一个框
  const boxPaths = [sq(140, 100), sq(60, 140), sq(60, 200), sq(77, 200), sq(94, 200), sq(200, 140), sq(300, 260)];
  const items = [
    it('4×2=', 100, 100, 40), it('×4=8', 78, 140, 40), it('5', 203, 140, 10), it('一共有多少个', 150, 260, 96),
    // 口诀:二四 得(   ) / 编号「(1)」的 1 单独一段 / 括号挨着没空
    it('二四 得(', 300, 300, 64), it(')', 400, 300, 16), it('(', 50, 340, 16), it('1', 66, 340, 9), it(')', 76, 340, 16), it('和是(', 120, 380, 48), it(')', 170, 380, 16),
  ];
  const boxes = findBoxes(boxPaths, []);
  check('小方框:10–60pt 宽、10–30pt 高的描边框都收(还没分是不是空)', boxes.length === 7);
  const blanks = blankCells({ items, boxes });
  const at = (x: number, y: number): boolean => blanks.some((b) => b.x1 <= x && b.x2 >= x && b.y1 <= y && b.y2 >= y);
  check('算式里的空:左边以 = 收尾、右边以 × 起头的空框都算', at(148, 95) && at(68, 135), JSON.stringify(blanks));
  check('表格里连着的格、框里有字的、旁边不是算式的:不算', !at(68, 195) && !at(85, 195) && !at(205, 135) && !at(305, 255), JSON.stringify(blanks));
  check('空着的括号:从「(」那段的末尾到「)」那段的开头', at(380, 295) && blanks.every((b) => b.kind === 'blank'), JSON.stringify(blanks));
  check('「(1)」这种编号、括号挨着没空的:不算', !at(70, 335) && !at(169, 375) && blanks.length === 3, JSON.stringify(blanks));
}

// ——— 走真的 pdf.js:认格子读的是 pdf.js 画图指令的内部格式(constructPath 的参数),换了版本格式一变就一格也认不出、还不报错,这里盯着 ———
{
  const { readPdfPages } = await import('../src/memory/textbook-pdf.ts');
  // 手写一页 PDF,画法照人教统编语文二上:蓝色描边的闭合四点路径(m l l l h S),两条虚线中线;格里的字红的是描红、深灰是范字,第三格空着
  const cellOps = (x: number, y: number, ch: string | null, rgb: string): string => [
    '0.15 0.79 0.96 RG 0.71 w [] 0 d',
    `${x} ${y} m ${x + 39} ${y} l ${x + 39} ${y + 39} l ${x} ${y + 39} l h S`,
    '[1.72] 0 d 0.34 w',
    `${x + 19.5} ${y} m ${x + 19.5} ${y + 39} l S`,
    `${x} ${y + 19.5} m ${x + 39} ${y + 19.5} l S`,
    ...(ch ? [`${rgb} rg BT /F1 30 Tf ${x + 8} ${y + 6} Td (${ch}) Tj ET`] : []),
  ].join('\n');
  const content = [cellOps(40, 100, 'A', '0.17 0.18 0.21'), cellOps(79, 100, 'A', '1 0.51 0.51'), cellOps(118, 100, null, '')].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const [page] = await readPdfPages(new TextEncoder().encode(pdf));
  const got = page?.cells ?? [];
  check('真的 pdf.js:认出三个田字格(左上角起、y 往下)', got.length === 3 && got.every((c, i) => Math.abs(c.x1 - (40 + i * 39)) < 0.5 && Math.abs(c.y1 - 61) < 0.5 && Math.abs(c.x2 - c.x1 - 39) < 0.5), JSON.stringify(got));
  check('真的 pdf.js:深灰的字是范字,红的是描红,第三格空着', got[0]?.ch === 'A' && !got[0]?.red && got[1]?.ch === 'A' && got[1]?.red === true && got[2] && !got[2].ch, JSON.stringify(got));
}

done();
