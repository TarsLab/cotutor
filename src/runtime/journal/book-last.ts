/**
 * 每本课本上次翻到哪一课:.cotutor/book-last.json,{ <册子的文件名>: { title, at } }。孩子在目录上点的、老师翻的都算(目录不算)。
 * 下次进这本书的目录,窗停在这一课那一行(src/board/lesson-fit.ts 的 lessonOpen);老师看目录时也知道上次到哪(board-pack 的 bookSlateParts)。
 * 是孩子的状态,不是课本的缓存(索引换版本会重做,记的不能跟着丢);.cotutor/ 整个不进 sandbox(SANDBOX_SKIP)。读不出来当没记过。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Workspace } from '../../schema/index.ts';

type Last = Record<string, { title: string; at: string }>;

const fileOf = (ws: Workspace): string => join(ws.root, '.cotutor', 'book-last.json');

async function load(file: string): Promise<Last> {
  try {
    const v = JSON.parse(await readFile(file, 'utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Last) : {};
  } catch {
    return {};
  }
}

/** 这本书上次翻到的那一课(页上的名字,lessonName);没记过 = null */
export async function bookLast(ws: Workspace, book: string): Promise<string | null> {
  const hit = (await load(fileOf(ws)))[book];
  return hit && typeof hit.title === 'string' && hit.title ? hit.title : null;
}

let chain: Promise<unknown> = Promise.resolve();
/** 记下这本书翻到了哪一课;写不下不抛(只是下次不定位) */
export function rememberBook(ws: Workspace, book: string, title: string, now: Date): Promise<void> {
  const file = fileOf(ws);
  const next = chain.catch(() => undefined).then(async () => {
    const all = await load(file);
    if (all[book]?.title === title) return;
    all[book] = { title, at: now.toISOString() };
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(all, null, 1));
    await rename(`${file}.tmp`, file);
  }).catch(() => undefined);
  chain = next;
  return next;
}
