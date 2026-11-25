/**
 * 工作台「分块」页的接口(页面在 src/ui/dev/zones-tab.ts;docs/dev/课本.md,画布 https://claude.ai/artifact/Xvt6t4pp1xkLJ6VA6GBnkR):
 *   GET    /api/dev/zones                 每本课本、每一课用的是哪份(规则 / 编程助手 / 工作台,谁什么时候存的),vault 里读不出的页,换过课本留下的旧指纹;
 *                                         vault 练习册/ 下每一册(几页几题,workbook.json 什么时候写的;读不出来的带一句为什么,同 cotutor workbook check 的第一条)
 *   GET    /api/dev/zones/workbook?w      一册练习册,同一课的样子(每页的分块、文字层的行,语文、英语的行带每个字的左右),外加 check(同 cotutor workbook check);
 *                                         练习册只看不改:块是排版脚本写的,这里改了脚本一重跑就没了,要改复制一句给编程助手(docs/dev/练习册.md)
 *   GET    /api/dev/zones/lesson?b&l      一课(l = 「课名@PDF 头一页」,目录上最里一层;给的课里的页落在别的课里的,那几课一起带上,同 pull)
 *                                         每页挑好的分块(全的,给老师的、答案都在)、候选(文字层的行、能写的格、表格;语文带每个字的左右,当孩子点用)
 *                                         和 version(vault 里这几页现在的样子;存的时候带回来,对不上 409)
 *   POST   /api/dev/zones/check {b,l,pages}          边改边查,同 cotutor textbook check(checkZonePages),不落盘
 *   PUT    /api/dev/zones/lesson {b,l,version,pages} 一课一起存:查干净才写 vault 的 教材/.zones/<指纹>/,写之前吸到候选上(同 push),book.json 记 workbench;
 *                                         规则出的那一课也是整课写进去(没改的页照规则出的抄一份)
 *   DELETE /api/dev/zones/lesson?b&l      还原成规则出的:删掉 vault 里这一课的页
 *   DELETE /api/dev/zones/stale?sha       删掉换过的课本留下的旧分块(现在哪本课本的指纹都不删)
 *   POST   /api/dev/zones/say {b|w,text}  念一遍:用这一科老师「点读的声音」合成(有缓存),回声音;w 是练习册,照它的 subject 挑老师
 * 只认 教材/ 里列得出的册名和目录里有的课,不拼路径;课本 PDF 不动。
 */
import { createHash } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { candidatesOf, checkZonePages, lessonDraft, loadBook, snapZonePage, wholeLessons, type Book, type Candidates } from '../cli/textbook.ts';
import { checkWorkbook } from '../cli/workbook.ts';
import { WORKBOOK_FILE, listWorkbooks, readWorkbook } from '../../memory/workbook.ts';
import { workbookLayer } from '../../chalk/index.ts';
import { listBooks } from '../../memory/textbook-pdf.ts';
import { bookZones, readZoneBook, removeZonePages, vaultZoneDirs, vaultZonesDir, writeZonePages } from '../../memory/textbook-zones.ts';
import { synthesize } from '../../media/tts.ts';
import { canonicalSubject, cardVoice, pickBookZones, workbookZonePage, zoneFile, zoneKey, type BookLesson, type Workspace, type ZonePage, type ZoneWriter } from '../../schema/index.ts';

export interface DevZoneLessonRow {
  title: string;
  /** 「课名@PDF 头一页」:接口认它 */
  key: string;
  depth: number;
  /** 目录上最里一层(下面没有课了):能点开改 */
  leaf: boolean;
  printed: [number, number];
  pages: [number, number];
  which: 'vault' | 'rules' | 'mixed';
  /** vault 的:这一课最后是谁存的、什么时候 */
  by?: ZoneWriter;
  at?: string;
}

export interface DevZoneBook {
  file: string;
  sha: string;
  layout: string;
  pages: number;
  vaultPages: number;
  /** vault 里读不过形状的页 */
  problems: string[];
  lessons: DevZoneLessonRow[];
}

const lessonKey = (l: BookLesson): string => `${l.title}@${l.pages[0]}`;
const rangeOf = (r: readonly [number, number]): number[] => Array.from({ length: r[1] - r[0] + 1 }, (_, k) => r[0] + k);

/** 一课的页(在这本 PDF 里的)最后是谁存的:vault 的 book.json 里最晚的那条 */
function lastWriter(meta: Awaited<ReturnType<typeof readZoneBook>>, pages: readonly number[]): { by: ZoneWriter; at: string } | null {
  let best: { by: ZoneWriter; at: string } | null = null;
  for (const n of pages) { const w = meta?.pages[zoneKey(n)]; if (w && (!best || w.at > best.at)) best = w; }
  return best;
}

/** 练习册/ 下的一册:读得出来的带册名、几页几题;读不出来的只有 why */
export interface DevWorkbookRow { name: string; title?: string; subject?: string; pages: number; questions: number; at?: string; why?: string }

async function listDevWorkbooks(ws: Workspace): Promise<DevWorkbookRow[]> {
  const out: DevWorkbookRow[] = [];
  for (const name of await listWorkbooks(ws.paths.workbooks)) {
    const at = (await stat(join(ws.paths.workbooks, name, WORKBOOK_FILE)).catch(() => null))?.mtime.toISOString();
    const r = await readWorkbook(ws.paths.workbooks, name);
    if ('why' in r) { out.push({ name, pages: 0, questions: 0, ...(at ? { at } : {}), why: r.why.replace(/^练习册\/[^/]+\//, '') }); continue; }
    out.push({ name, title: r.wb.title, subject: r.wb.subject, pages: r.wb.pages.length, questions: r.wb.pages.reduce((n, p) => n + p.zones.length, 0), ...(at ? { at } : {}) });
  }
  return out;
}

export async function listDevZones(ws: Workspace): Promise<{ books: DevZoneBook[]; unreadable: string[]; stale: { sha: string; title: string | null; pages: number }[]; workbooks: DevWorkbookRow[] }> {
  const books: DevZoneBook[] = [];
  const unreadable: string[] = [];
  for (const file of await listBooks(ws.paths.textbooks, null)) {
    const b = await loadBook(ws, file).catch(() => null);
    if (!b) { unreadable.push(file); continue; }
    const meta = await readZoneBook(vaultZonesDir(ws.paths.textbooks, b.index.sha));
    const all = b.index.lessons;
    const depth = (l: BookLesson, seen = 0): number => { const up = l.parent ? all.find((x) => x.title === l.parent) : undefined; return up && seen < 6 ? 1 + depth(up, seen + 1) : 0; };
    const zones = await bookZones(ws.paths.textbooks, join(ws.root, '.cotutor', 'textbooks'), b.index);
    books.push({
      file, sha: b.index.sha, layout: b.index.layout, pages: b.index.pages.length, vaultPages: Object.keys(b.zones.vault).length, problems: zones.problems,
      lessons: all.map((l) => {
        const ns = rangeOf(l.pages).filter((n) => b.index.pages.some((p) => p.n === n));
        const which = pickBookZones(b.index, b.zones, ns).which;
        const w = which === 'rules' ? null : lastWriter(meta, ns);
        return { title: l.title, key: lessonKey(l), depth: depth(l), leaf: !all.some((x) => x.parent === l.title), printed: [l.from, l.to] as [number, number], pages: l.pages, which, ...(w ? { by: w.by, at: w.at } : {}) };
      }),
    });
  }
  const shas = new Set(books.map((b) => b.sha));
  const stale = (await vaultZoneDirs(ws.paths.textbooks)).filter((d) => !shas.has(d.sha) && d.pages > 0);
  return { books, unreadable, stale, workbooks: await listDevWorkbooks(ws) };
}

interface LessonRef { book: Book; lessons: { title: string; pages: [number, number] }[]; pages: number[] }

/** 册名 + 课的 key → 这一课(连着页落在一起的几课,同 pull 的 wholeLessons);认不出 = null */
export async function devZoneLesson(ws: Workspace, file: string, key: string): Promise<LessonRef | null> {
  const book = await loadBook(ws, file).catch(() => null);
  const l = book?.index.lessons.find((x) => lessonKey(x) === key);
  if (!book || !l) return null;
  const got = wholeLessons(book.index, rangeOf(l.pages));
  return got.pages.length ? { book, ...got } : null;
}

/** vault 里这几页现在的样子(存的时候对一下,编程助手在别处 push 过就不盖) */
async function vaultVersion(ws: Workspace, ref: LessonRef): Promise<string> {
  const dir = vaultZonesDir(ws.paths.textbooks, ref.book.index.sha);
  const h = createHash('sha1');
  for (const n of ref.pages) h.update(`${n}:${await readFile(join(dir, zoneFile(n)), 'utf8').catch(() => '-')}\n`);
  return h.digest('hex').slice(0, 16);
}

export interface DevZonePage {
  n: number;
  printed: number | null;
  w: number;
  h: number;
  zones: ZonePage;
  /** 候选;语文的行多一个 ch:每个能点的字的左右(千分比),当孩子点时照它认点没点在字上 */
  cand: Candidates & { lines: (Candidates['lines'][number] & { ch?: [number, number][] })[] };
  by?: ZoneWriter;
  at?: string;
}

export async function readDevZoneLesson(ws: Workspace, ref: LessonRef): Promise<{ file: string; title: string; sha: string; layout: string; lessons: LessonRef['lessons']; which: 'vault' | 'rules' | 'mixed'; version: string; pages: DevZonePage[] }> {
  const { book } = ref;
  const draft = lessonDraft(book, ref);
  const meta = await readZoneBook(vaultZonesDir(ws.paths.textbooks, book.index.sha));
  const which = pickBookZones(book.index, book.zones, ref.pages).which;
  const pages = ref.pages.map((n): DevZonePage => {
    const p = book.index.pages.find((x) => x.n === n)!;
    const cand = candidatesOf(p);
    const lines = book.index.layout === 'prose'
      ? cand.lines.map((l, i) => ({ ...l, ch: p.lines[i].chars.filter((c) => /\p{Script=Han}/u.test(c.c)).map((c): [number, number] => [Math.round((c.x1 / p.w) * 10000) / 10, Math.round((c.x2 / p.w) * 10000) / 10]) }))
      : cand.lines;
    const w = book.zones.vault[n] ? meta?.pages[zoneKey(n)] : undefined;
    return { n, printed: p.printed, w: p.w, h: p.h, zones: draft.get(n) ?? { page: n, zones: [] }, cand: { ...cand, lines }, ...(w ? { by: w.by, at: w.at } : {}) };
  });
  return { file: book.file, title: book.index.title, sha: book.index.sha, layout: book.index.layout, lessons: ref.lessons, which, version: await vaultVersion(ws, ref), pages };
}

/**
 * 一册练习册,同一课的样子给工作台看:页号就是第几页,页宽 1000、高照图(src/chalk/kit/workbook.ts 的 workbookLayer),分块就是这一页的块;
 * 候选只有文字层的行(框是排版时记下的,没有要认领的格);语文、英语的行照字数等分出每个汉字的左右(同孩子端照片页的点字),当孩子点用。读不出来 = null
 */
export async function readDevWorkbook(ws: Workspace, name: string): Promise<{ kind: 'workbook'; file: string; title: string; subject: string; layout: 'math' | 'prose'; lessons: []; which: 'workbook'; version: ''; sha: ''; pages: DevZonePage[]; check: { problems: string[]; notes: string[] }; says: number; at?: string } | null> {
  const r = await readWorkbook(ws.paths.workbooks, name);
  if ('why' in r) return null;
  const { wb } = r;
  const c = await checkWorkbook(ws.paths.workbooks, name);
  const layer = workbookLayer(wb);
  const prose = wb.subject !== '数学';
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  const pages = wb.pages.map((pg, i): DevZonePage => {
    const lines = pg.lines.map((l, k) => {
      const cs = Array.from(l.text), w = (l.box[2] - l.box[0]) / Math.max(1, cs.length);
      const ch = cs.flatMap((x, j): [number, number][] => (/\p{Script=Han}/u.test(x) ? [[r1(l.box[0] + j * w), r1(l.box[0] + (j + 1) * w)]] : []));
      return { id: `L${k + 1}`, text: l.text, box: l.box, ...(prose ? { ch } : {}) };
    });
    return { n: i + 1, printed: null, w: layer.pages[i]!.w, h: layer.pages[i]!.h, zones: workbookZonePage(pg, i + 1), cand: { page: i + 1, printed: null, lines, cells: [], tables: [] } };
  });
  const at = (await stat(join(ws.paths.workbooks, name, WORKBOOK_FILE)).catch(() => null))?.mtime.toISOString();
  return { kind: 'workbook', file: name, title: wb.title, subject: wb.subject, layout: prose ? 'prose' : 'math', lessons: [], which: 'workbook', version: '', sha: '', pages, check: { problems: c.problems, notes: c.notes }, says: c.says, ...(at ? { at } : {}) };
}

/** 练习册念一遍用哪一科的声音:读得出来就照它的 subject */
export async function workbookSubject(ws: Workspace, name: string): Promise<string | null> {
  const r = await readWorkbook(ws.paths.workbooks, name);
  return 'wb' in r ? r.wb.subject : null;
}

/** 页面交上来的几页 → 页号 → 原样(没交的那页记一句) */
function rawPages(ref: LessonRef, pages: unknown): Map<number, unknown> {
  const list = Array.isArray(pages) ? pages : [];
  const out = new Map<number, unknown>();
  for (const n of ref.pages) out.set(n, list.find((p) => p && typeof p === 'object' && (p as { page?: unknown }).page === n) ?? { __bad: '没交上来(一课的页要一起存)' });
  return out;
}

export function checkDevZoneLesson(ref: LessonRef, pages: unknown): { problems: string[]; notes: string[] } {
  const r = checkZonePages(ref.book, ref.lessons, rawPages(ref, pages));
  return { problems: r.problems, notes: r.notes };
}

export class ZonesConflict extends Error {}

/** 一课一起存:version 对不上(别处改过)抛 ZonesConflict;查出要改的不存,回 problems */
export async function saveDevZoneLesson(ws: Workspace, ref: LessonRef, version: string, pages: unknown, now = new Date()): Promise<{ ok: boolean; wrote: number; problems: string[]; notes: string[] }> {
  if ((await vaultVersion(ws, ref)) !== version) throw new ZonesConflict('这一课的分块在别处改过了');
  const r = checkZonePages(ref.book, ref.lessons, rawPages(ref, pages));
  if (r.problems.length) return { ok: false, wrote: 0, problems: r.problems, notes: r.notes };
  const out = ref.pages.map((n) => snapZonePage(r.parsed.get(n)!, ref.book.index.pages.find((p) => p.n === n)!));
  await writeZonePages(vaultZonesDir(ws.paths.textbooks, ref.book.index.sha), { title: ref.book.index.title, sha: ref.book.index.sha }, out, 'workbench', now);
  return { ok: true, wrote: out.length, problems: [], notes: r.notes };
}

/** 还原成规则出的:删掉 vault 里这一课的页 */
export async function restoreDevZoneLesson(ws: Workspace, ref: LessonRef): Promise<{ removed: number }> {
  return { removed: await removeZonePages(vaultZonesDir(ws.paths.textbooks, ref.book.index.sha), ref.pages) };
}

/** 删掉换过的课本留下的旧分块;现在哪本课本用着这个指纹就不删(回 false) */
export async function dropStaleZones(ws: Workspace, sha: string): Promise<boolean> {
  if (!/^[0-9a-f]{16}$/.test(sha)) return false;
  const { stale } = await listDevZones(ws);
  if (!stale.some((d) => d.sha === sha)) return false;
  await rm(vaultZonesDir(ws.paths.textbooks, sha), { recursive: true, force: true });
  return true;
}

/** 念一遍用谁的声音:这本课本那一科的老师里有「点读的声音」的第一位,没有就随便哪位有的 */
export function sayVoice(ws: Workspace, file: string): string | undefined {
  const names = Object.keys(ws.config.tutors);
  for (const t of names) {
    const sub = canonicalSubject(ws.config.tutors[t].subject);
    if (sub && file.includes(sub)) { const v = cardVoice(ws.config.tutors, t); if (v) return v; }
  }
  for (const t of names) { const v = cardVoice(ws.config.tutors, t); if (v) return v; }
  return undefined;
}

export async function sayDevZone(ws: Workspace, file: string, text: string): Promise<{ file: string } | { error: string }> {
  const voice = sayVoice(ws, file);
  if (!voice) return { error: '没有老师配了点读的声音' };
  const r = await synthesize({ text, voice }, { cacheDir: ws.dirs.tts, env: process.env });
  return r.file ? { file: r.file } : { error: r.error ?? '没合成出来' };
}
