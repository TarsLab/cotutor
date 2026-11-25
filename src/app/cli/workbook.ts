/**
 * cotutor workbook:给出练习册的编程助手用(技能 cotutor-workbook)。
 *   check [<名>]   vault 练习册/ 下的一册或每一册:形状(全部出错的字段,不只第一条)、workbookProblems(每页照课本的分块查)、页图在不在、
 *                  宽高和 workbook.json 记的对不对得上(舞台照记的宽高铺页,框是照它算的千分比)、sha256 对不对、打印版在不在。
 *                  应用读一册(src/memory/workbook.ts 的 readWorkbook)只回第一条给家长,这里要一次列全,助手才能一轮改完。
 *   glyph <字母>   拉丁字母的笔顺(src/chalk/glyphs/,孩子端写字格与英文听写同一份),描写区 model.strokes 照它换到页上。
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkbookSchema, walkZones, workbookProblems } from '../../schema/index.ts';
import { WORKBOOK_FILE, listWorkbooks } from '../../memory/workbook.ts';
import { imageSize } from '../../shared/jpeg.ts';
import { GLYPHS, GUIDES, sampleStroke } from '../../chalk/glyphs/index.ts';

export interface WorkbookCheck {
  name: string;
  title?: string;
  subject?: string;
  pages: number;
  /** 一共几道题(每页最外一层的块) */
  questions: number;
  /** 写了念法、孩子点了能听的块 */
  says: number;
  /** 要改的,一条一句;空 = 孩子能用 */
  problems: string[];
  /** 不挡用的 */
  notes: string[];
}

/** 出错的字段:pages 的下标换成「第 n 页」(从 1 起,和 workbookProblems 一样),其余照 JSON 的路径 */
const where = (path: readonly PropertyKey[]): string => {
  if (!path.length) return '(整个文件)';
  const [a, b, ...rest] = path;
  return a === 'pages' && typeof b === 'number' ? `第 ${b + 1} 页${rest.length ? ` ${rest.map(String).join('.')}` : ''}` : path.map(String).join('.');
};

/** 查一册(dir 是 vault 的 练习册/,name 是文件夹名) */
export async function checkWorkbook(dir: string, name: string): Promise<WorkbookCheck> {
  const out: WorkbookCheck = { name, pages: 0, questions: 0, says: 0, problems: [], notes: [] };
  const raw = await readFile(join(dir, name, WORKBOOK_FILE), 'utf8').catch(() => null);
  if (raw === null) return { ...out, problems: [`${WORKBOOK_FILE} 不在`] };
  let json: unknown;
  try { json = JSON.parse(raw); } catch (e) { return { ...out, problems: [`${WORKBOOK_FILE} 不是 JSON:${(e as Error).message}`] }; }
  const parsed = WorkbookSchema.safeParse(json);
  if (!parsed.success) return { ...out, problems: parsed.error.issues.map((i) => `${where(i.path)}:${i.message}`) };
  const wb = parsed.data;
  out.title = wb.title;
  out.subject = wb.subject;
  out.pages = wb.pages.length;
  out.questions = wb.pages.reduce((n, p) => n + p.zones.length, 0);
  for (const p of wb.pages) walkZones(p.zones, (z) => { if (z.say) out.says++; });
  out.problems.push(...workbookProblems(wb));
  const files = new Set<string>();
  for (const [i, page] of wb.pages.entries()) {
    const p = `第 ${i + 1} 页`;
    if (files.has(page.image.file)) out.problems.push(`${p}:图 ${page.image.file} 和前面的页重了`);
    files.add(page.image.file);
    const buf = await readFile(join(dir, name, page.image.file)).catch(() => null);
    if (!buf) { out.problems.push(`${p}:图 ${page.image.file} 不在`); continue; }
    const size = imageSize(buf);
    if (!size || buf.readUInt32BE(0) !== 0x89504e47) { out.problems.push(`${p}:${page.image.file} 不是 PNG`); continue; }
    if (size.w !== page.image.w || size.h !== page.image.h) out.problems.push(`${p}:${page.image.file} 是 ${size.w}×${size.h},workbook.json 写的 ${page.image.w}×${page.image.h}`);
    const hash = createHash('sha256').update(buf).digest('hex');
    if (hash !== page.image.sha256) out.problems.push(`${p}:${page.image.file} 的 sha256 是 ${hash},和 workbook.json 写的不一样(图重画过,json 要一起重出)`);
    if (!page.lines.length) out.notes.push(`${p}:文字层 lines 是空的,老师「看」第几行、孩子点字都没东西可照`);
  }
  if (!out.says) out.notes.push('没有一块写了 say:孩子点一道题听不到题目(不认字的孩子要听)');
  if (wb.print && !(await stat(join(dir, name, wb.print)).catch(() => null))?.isFile()) out.notes.push(`打印版 ${wb.print} 不在(应用不读,打印用)`);
  return out;
}

/** 查练习册/ 下的一册(给了名字)或每一册 */
export async function checkWorkbooks(dir: string, name?: string): Promise<WorkbookCheck[]> {
  const names = name ? [name] : await listWorkbooks(dir);
  return Promise.all(names.map((n) => checkWorkbook(dir, n)));
}

export interface GlyphOut {
  /** 字宽(x 高 = 1) */
  advance: number;
  /** 一笔一串点 [u, v]:u 从字的左边起,v 照 guides(向下为正,基线 0) */
  strokes: [number, number][][];
}

/** 这几个字母的笔顺;不认的字母回在 unknown 里 */
export function glyphData(letters: string): { guides: typeof GUIDES; glyphs: Record<string, GlyphOut>; unknown: string[] } {
  const glyphs: Record<string, GlyphOut> = {};
  const unknown: string[] = [];
  for (const ch of new Set([...letters].filter((c) => c.trim()))) {
    const g = GLYPHS.get(ch);
    if (!g) { unknown.push(ch); continue; }
    glyphs[ch] = { advance: g.advance, strokes: g.strokes.map((s) => sampleStroke(s, 0.1).map(([u, v]) => [Math.round(u * 1000) / 1000, Math.round(v * 1000) / 1000] as [number, number])) };
  }
  return { guides: GUIDES, glyphs, unknown };
}
