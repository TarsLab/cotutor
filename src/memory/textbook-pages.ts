/**
 * 课本页(《画板为主设计》「从 vault 选课本页」:预习、复习不用每次拍):家长把扫好的页放在教材那篇旁边、同名的文件夹里,
 * `教材/语文二年级上册.md` 的页就在 `教材/语文二年级上册/023.jpg`(文件名里的数当页码)。
 * 孩子在以板为主的 activity 的拍照屏上「选课本页」,挑一页;应用把它拷进 captures/(同孩子拍的照片),认字、铺板都照旧。
 * 这里只读 vault:列出这位老师学科的册子与页、给一页的文件路径。
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const IMAGE = /\.(jpe?g|png)$/i;
/** 册名、页文件名:不带路径分隔、不以点开头 */
const SAFE = /^[^/\\.][^/\\]{0,120}$/;

export interface TextbookPages {
  book: string;
  pages: { file: string; n: number | null }[];
}

const pageNo = (file: string): number | null => { const m = /(\d+)/.exec(file); return m ? Number(m[1]) : null; };

/** 教材目录下有页的册子(文件夹里有图);subject 给了就只要册名里带这个学科的(「语文二年级上册」) */
export async function listTextbookPages(dir: string, subject: string | null): Promise<TextbookPages[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: TextbookPages[] = [];
  for (const book of names.sort()) {
    if (!SAFE.test(book) || (subject && !book.includes(subject))) continue;
    if (!(await stat(join(dir, book)).catch(() => null))?.isDirectory()) continue;
    const files = (await readdir(join(dir, book)).catch(() => [] as string[])).filter((f) => IMAGE.test(f) && SAFE.test(f));
    if (!files.length) continue;
    const pages = files.map((file) => ({ file, n: pageNo(file) })).sort((a, b) => (a.n ?? 1e9) - (b.n ?? 1e9) || a.file.localeCompare(b.file));
    out.push({ book, pages });
  }
  return out;
}

/** 一页的文件路径;册名、文件名不对(越界、不是图、不在)回 null */
export async function textbookPageFile(dir: string, book: string, file: string): Promise<string | null> {
  if (!SAFE.test(book) || !SAFE.test(file) || !IMAGE.test(file)) return null;
  const p = join(dir, book, file);
  return (await stat(p).catch(() => null))?.isFile() ? p : null;
}
