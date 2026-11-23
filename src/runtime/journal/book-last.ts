/**
 * 每一册上次翻到哪:.cotutor/book-last.json,{ <册>: { title, view?, at } }。册:课本是 PDF 的文件名,练习册是它的页 id「练习册#<名>」(chalk 的 workbookPageId)。
 * title = 翻到的那一课(练习册是册名);view = 窗停在哪(这一课的场景坐标,孩子挪窗停下记的;换了一课就清掉)。孩子在目录上点的、翻到上一课下一课的、老师翻的都算,目录不算。
 * 下次进门直接铺那一课、窗摆回那里(src/board/lesson-fit.ts 的 lessonOpen);老师看目录时也知道上次到哪(board-pack 的 bookSlateParts)。
 * 是孩子的状态,不是课本的缓存(索引换版本会重做,记的不能跟着丢);.cotutor/ 整个不进 sandbox(SANDBOX_SKIP)。读不出来当没记过;以前只记了 title 的照读。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Workspace } from '../../schema/index.ts';

type Box = [number, number, number, number];
/** 一册上次翻到哪:那一课,和窗停在哪(没挪过窗没有) */
export interface LastSpot { title: string; view?: Box }
type Last = Record<string, LastSpot & { at: string }>;

const fileOf = (ws: Workspace): string => join(ws.root, '.cotutor', 'book-last.json');

async function load(file: string): Promise<Last> {
  try {
    const v = JSON.parse(await readFile(file, 'utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Last) : {};
  } catch {
    return {};
  }
}

const isBox = (v: unknown): v is Box => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** 这一册上次翻到哪;没记过 = null */
export async function lastSpot(ws: Workspace, book: string): Promise<LastSpot | null> {
  const hit = (await load(fileOf(ws)))[book];
  if (!hit || typeof hit.title !== 'string' || !hit.title) return null;
  return { title: hit.title, ...(isBox(hit.view) ? { view: hit.view } : {}) };
}

/** 这本书上次翻到的那一课(页上的名字,lessonName);没记过 = null */
export async function bookLast(ws: Workspace, book: string): Promise<string | null> {
  return (await lastSpot(ws, book))?.title ?? null;
}

let chain: Promise<unknown> = Promise.resolve();
/** 记下这一册翻到了哪一课(view = 窗停在哪;不给 = 还是这一课就留着原来的窗,换了一课就清掉);写不下不抛(只是下次不定位) */
export function rememberBook(ws: Workspace, book: string, title: string, now: Date, view?: Box): Promise<void> {
  const file = fileOf(ws);
  const next = chain.catch(() => undefined).then(async () => {
    const all = await load(file);
    const was = all[book];
    const keep = view ?? (was?.title === title && isBox(was.view) ? was.view : undefined);
    if (was?.title === title && JSON.stringify(was.view ?? null) === JSON.stringify(keep ?? null)) return;
    all[book] = { title, ...(keep ? { view: keep } : {}), at: now.toISOString() };
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(all, null, 1));
    await rename(`${file}.tmp`, file);
  }).catch(() => undefined);
  chain = next;
  return next;
}
