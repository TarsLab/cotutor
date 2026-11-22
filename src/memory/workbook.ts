/**
 * 练习册:vault 的 `练习册/` 下一册一个文件夹,里面 workbook.json(形状在 src/schema/workbook.ts)和每页的 PNG(打印版 PDF 可有可无,这里不读)。
 * 这里只读:按名字(文件夹名)读一册、过形状与检查、找某一页的图;列出有哪几册。家长放进来的,应用不改。
 * 谁用:runner 铺练习册页、拼给老师的 <page>;孩子端的接口取页图和文字层;首页检查按钮挂的那一册在不在。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkbookSchema, workbookProblems, type Workbook } from '../schema/index.ts';

/** 一册的名字(文件夹名):不带路径分隔、不以点开头 */
const SAFE = /^[^/\\.][^/\\]{0,80}$/;
export const WORKBOOK_FILE = 'workbook.json';

/** 读一册:读不到、形状不对、检查有问题都回 why(给家长看的一句);图在不在不查(取页图时再说) */
export async function readWorkbook(dir: string, name: string): Promise<{ wb: Workbook } | { why: string }> {
  if (!SAFE.test(name)) return { why: `练习册的名字「${name}」不对:写 练习册/ 下那一册的文件夹名` };
  const raw = await readFile(join(dir, name, WORKBOOK_FILE), 'utf8').catch(() => null);
  if (raw === null) return { why: `练习册/${name}/${WORKBOOK_FILE} 不在` };
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { why: `练习册/${name}/${WORKBOOK_FILE} 不是 JSON` }; }
  const parsed = WorkbookSchema.safeParse(json);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { why: `练习册/${name}/${WORKBOOK_FILE} 的形状不对:${i ? `${i.path.join('.')} ${i.message}` : ''}` };
  }
  const problems = workbookProblems(parsed.data);
  if (problems.length) return { why: `练习册/${name}/${WORKBOOK_FILE}:${problems[0]}${problems.length > 1 ? `(还有 ${problems.length - 1} 处)` : ''}` };
  return { wb: parsed.data };
}

/** 第 n 页(从 1 起)的图的路径;页不在、文件不在 = null */
export async function workbookImageFile(dir: string, name: string, wb: Workbook, n: number): Promise<string | null> {
  const page = Number.isInteger(n) && n >= 1 ? wb.pages[n - 1] : undefined;
  if (!page || !SAFE.test(name)) return null;
  const p = join(dir, name, page.image.file);
  return (await stat(p).catch(() => null))?.isFile() ? p : null;
}

/** 练习册/ 下有哪几册(有 workbook.json 的文件夹,按名字排) */
export async function listWorkbooks(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: string[] = [];
  for (const n of names.sort()) if (SAFE.test(n) && (await stat(join(dir, n, WORKBOOK_FILE)).catch(() => null))?.isFile()) out.push(n);
  return out;
}
