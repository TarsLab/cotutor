/**
 * 课本的分块文件(形状在 src/schema/zones.ts):读、写、一课挑哪份。
 *   规则出的  `<workspace>/.cotutor/textbooks/zones/<指纹>/`:建索引后接着出(./textbook-zones-rules.ts),规则或索引的版本变了重出;能重做,不进备份
 *   改好的    `<vault>/教材/.zones/<指纹>/`:编程助手(cotutor textbook push)、工作台写的;点开头,Obsidian 里不显示,备份照样带上
 * 一页一份 `p078.json` 外加 `book.json`(每页最后是谁写的);写的时候先写临时文件再改名,写坏了只坏一页。读不过形状的那一页当没有(给家长端报一行)。
 * 运行时一课挑一份(schema 的 pickZones):这一课的页在 vault 里都有就用 vault 的,不然用规则出的。工作台「还原成规则出的」删掉 vault 里那一课的页(removeZonePages)。
 * 规则出一整册约几十毫秒(人教数学二上 126 页),第一次用到这一册时出完,不分先后。
 * 家长换了课本 PDF(指纹变了),vault 里旧指纹的分块用不上了:staleZoneDirs 列出来,工作台能删、doctor 说一句。
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BOOK_INDEX_VERSION, ZONES_RULES_VERSION, ZoneBookSchema, ZonePageSchema, zoneFile, zoneKey, type BookIndex, type BookZones, type ZoneBook, type ZonePage, type ZoneWriter } from '../schema/index.ts';
import { ruleZones } from './textbook-zones-rules.ts';

/** 规则出的放哪:cacheDir = `<workspace>/.cotutor/textbooks` */
export const ruleZonesDir = (cacheDir: string, sha: string): string => join(cacheDir, 'zones', sha);
/** 改好的放哪:textbooksDir = vault 的 `教材/` */
export const vaultZonesDir = (textbooksDir: string, sha: string): string => join(textbooksDir, '.zones', sha);

const BOOK = 'book.json';

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

export async function readZoneBook(dir: string): Promise<ZoneBook | null> {
  const raw = await readFile(join(dir, BOOK), 'utf8').then((s) => JSON.parse(s) as unknown, () => null);
  const r = ZoneBookSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** 一个目录里的分块:页号 → 那一页;bad = 读不过形状的文件名 */
export async function readZoneDir(dir: string): Promise<{ pages: Record<number, ZonePage>; bad: string[] }> {
  const pages: Record<number, ZonePage> = {};
  const bad: string[] = [];
  for (const f of (await readdir(dir).catch(() => [] as string[])).filter((x) => /^p\d{3,4}\.json$/.test(x)).sort()) {
    const raw = await readFile(join(dir, f), 'utf8').then((s) => JSON.parse(s) as unknown, () => undefined);
    const r = ZonePageSchema.safeParse(raw);
    if (r.success && zoneFile(r.data.page) === f) pages[r.data.page] = r.data;
    else bad.push(f);
  }
  return { pages, bad };
}

/**
 * 写几页分块进一个目录,book.json 记谁写的、什么时候(别的页的记录不动)。rules 给了就是规则出的那份(记规则与索引的版本)
 */
export async function writeZonePages(dir: string, book: { title: string; sha: string }, pages: readonly ZonePage[], by: ZoneWriter, now = new Date()): Promise<void> {
  await mkdir(dir, { recursive: true });
  const old = await readZoneBook(dir);
  const at = now.toISOString();
  const meta: ZoneBook = {
    title: book.title,
    sha: book.sha,
    ...(by === 'rules' ? { rules: { v: ZONES_RULES_VERSION, index: BOOK_INDEX_VERSION } } : old?.rules ? { rules: old.rules } : {}),
    pages: { ...(old?.sha === book.sha ? old.pages : {}) },
  };
  for (const p of pages) {
    await writeAtomic(join(dir, zoneFile(p.page)), `${JSON.stringify(p, null, 1)}\n`);
    meta.pages[zoneKey(p.page)] = { by, at };
  }
  await writeAtomic(join(dir, BOOK), `${JSON.stringify(meta, null, 1)}\n`);
}

/** 删掉几页(工作台「还原成规则出的」):页的文件和 book.json 里那几页的记录;一页都不剩就删掉整个目录。回删了几页 */
export async function removeZonePages(dir: string, pages: readonly number[]): Promise<number> {
  const meta = await readZoneBook(dir);
  let gone = 0;
  for (const n of pages) if (await unlink(join(dir, zoneFile(n))).then(() => true, () => false)) gone++;
  const left = (await readdir(dir).catch(() => [] as string[])).filter((f) => /^p\d{3,4}\.json$/.test(f));
  if (!left.length) { await rm(dir, { recursive: true, force: true }); return gone; }
  if (meta) {
    for (const n of pages) delete meta.pages[zoneKey(n)];
    await writeAtomic(join(dir, BOOK), `${JSON.stringify(meta, null, 1)}\n`);
  }
  return gone;
}

/** vault 的 教材/.zones/ 下每个指纹的目录:册名(book.json 记的)、几页;家长换了课本 PDF,旧指纹的就用不上了(工作台说一句) */
export async function vaultZoneDirs(textbooksDir: string): Promise<{ sha: string; title: string | null; pages: number }[]> {
  const root = join(textbooksDir, '.zones');
  const out: { sha: string; title: string | null; pages: number }[] = [];
  for (const sha of (await readdir(root).catch(() => [] as string[])).filter((x) => /^[0-9a-f]{16}$/.test(x)).sort()) {
    const dir = join(root, sha);
    const pages = (await readdir(dir).catch(() => [] as string[])).filter((f) => /^p\d{3,4}\.json$/.test(f)).length;
    out.push({ sha, title: (await readZoneBook(dir))?.title ?? null, pages });
  }
  return out;
}

/**
 * vault 里指纹不是哪本现在课本的分块(家长换了课本 PDF,以前改的用不上了):有页的才算。
 * vault 里没有分块目录就不读 PDF;有才把 教材/ 下每本 PDF 的指纹现算一遍(sha1 前 16 位,同索引)
 */
export async function staleZoneDirs(textbooksDir: string): Promise<{ sha: string; title: string | null; pages: number }[]> {
  const dirs = (await vaultZoneDirs(textbooksDir)).filter((d) => d.pages > 0);
  if (!dirs.length) return [];
  const now = new Set<string>();
  for (const f of (await readdir(textbooksDir).catch(() => [] as string[])).filter((x) => /\.pdf$/i.test(x) && !x.startsWith('.'))) {
    const data = await readFile(join(textbooksDir, f)).catch(() => null);
    if (data) now.add(createHash('sha1').update(data).digest('hex').slice(0, 16));
  }
  return dirs.filter((d) => !now.has(d.sha));
}

const ruled = new Map<string, Promise<Record<number, ZonePage>>>();

/** 规则出的这一册:目录里有、版本对就读;不然现出、写进去 */
export function ruleZonesOf(cacheDir: string, index: BookIndex): Promise<Record<number, ZonePage>> {
  const key = `${cacheDir}|${index.sha}`;
  let hit = ruled.get(key);
  if (!hit) {
    hit = (async () => {
      const dir = ruleZonesDir(cacheDir, index.sha);
      const meta = await readZoneBook(dir);
      if (meta?.rules?.v === ZONES_RULES_VERSION && meta.rules.index === index.v && meta.sha === index.sha) {
        const got = await readZoneDir(dir);
        if (!got.bad.length && index.pages.every((p) => got.pages[p.n])) return got.pages;
      }
      const pages = ruleZones(index);
      await writeZonePages(dir, index, pages, 'rules');
      return Object.fromEntries(pages.map((p) => [p.page, p]));
    })();
    ruled.set(key, hit);
    hit.catch(() => ruled.delete(key));
  }
  return hit;
}

/**
 * 这一册的分块:规则出的(没有就现出)和 vault 里改好的。vault 的每次现读(编程助手、工作台随时会写;一册最多百来个小文件);
 * problems = vault 里读不过形状的页(给家长端报一行)
 */
export async function bookZones(textbooksDir: string, cacheDir: string, index: BookIndex): Promise<BookZones & { problems: string[] }> {
  const rules = await ruleZonesOf(cacheDir, index);
  const v = await readZoneDir(vaultZonesDir(textbooksDir, index.sha));
  return { rules, vault: v.pages, problems: v.bad.map((f) => `教材/.zones/${index.sha}/${f} 读不出来,这一页的分块照规则出的`) };
}

/** 测试用:清掉进程里记着的 */
export function forgetZones(): void {
  ruled.clear();
}
