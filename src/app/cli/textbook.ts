/**
 * cotutor textbook:给编程助手整册出课本分块用(技能 cotutor-textbook;协议在 src/schema/zones.ts,设计稿 docs/artifact/分块初始化/,docs/dev/课本.md 的「分块」)。
 *   list [<册>]            vault 教材/ 里的课本、每一课在 PDF 的哪几页、现在用的是规则出的还是 vault 里改好的
 *   prep <册> [--lesson <课>] [--out <目录>]
 *                          摊开给编程助手读:book.md(页码对照、页名与种类、目录、样式表),每页一份页面数据 004.md(一行一条:行号、离页顶、缩进、
 *                          样式、离上一行的空、字;能写的格的候选)与 004.data.json(同一份,给脚本读)、页图 004.png(200dpi,有 poppler 的 pdftoppm
 *                          用它,没有试 python3 的 PyMuPDF;都没有就不出图,说一句)、空着的分块 004.json(编程助手填它;已经有的不动)、styles.json(样式表,
 *                          编程助手写每种样式是什么)、progress.json(哪几课存过了)、prep.json(哪一册)。缺省放 .cotutor/zones-work/<册名>/;重跑只补缺的
 *   check <目录> [--lesson] 一次列全要改的(checkZonePages):形状、页名、id、cont、字行(行号、截号或框)对不上文字层、能写的格没吸上候选、
 *                          候选没人认领、有字的行没有块认领、一课里叫法重名、标了页眉页脚;不挡用的(块叠得多)是提醒
 *   preview <目录> [--lesson] 把分块叠在页图上出 004.preview.png:块一层一色(外到里 红、紫、粉、棕)、作答区橙、没人认领的候选红粗框
 *   push <目录> [--lesson] 一课一课写进 vault 的 教材/.zones/<指纹>/:这一课的页都写了、check 干净才写(book.json 记 agent,样式表跟着);
 *                          写之前把行号换成框,作答区的框吸到候选上,progress.json 记下
 * 编程助手不直接写 vault;课本 PDF、agents/、cotutor.json 都不动。页名和页的种类照 src/memory/textbook-page-names.ts,编程助手不改。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { bookPageNames, type PageName } from '../../memory/textbook-page-names.ts';
import { bookIndex, bookFile, listBooks } from '../../memory/textbook-pdf.ts';
import { linePermille } from '../../memory/textbook-zones-rules.ts';
import { bookZones, vaultZonesDir, writeZonePages } from '../../memory/textbook-zones.ts';
import { LINE_REF, ZONE_FORMAT, ZoneFileSchema, bookChrome, needsZones, resolveDraft, lineStyle, pickBookZones, pickZones, spacedText, styleOf, walkZones, zonePageProblems, zoneStem, type BookIndex, type BookLesson, type BookLine, type BookPage, type BookZones, type PermilleBox, type Workspace, type Zone, type ZonePage, type ZoneRegion } from '../../schema/index.ts';
import { decodePng, encodePng } from '../../ui/shared/png.ts';
import { UsageError, loadWorkspace, redactDeep, redactHome } from '../workspace.ts';

const CACHE = join('.cotutor', 'textbooks');
const WORK = join('.cotutor', 'zones-work');
const PREP = 'prep.json';
const PROGRESS = 'progress.json';
const STYLES = 'styles.json';
/** 候选和作答区、字行算对上:重合(交 / 并)到这么多 */
export const SNAP = 0.5;

export interface Book { file: string; index: BookIndex; zones: BookZones; names: Map<number, PageName>; warnings: string[] }

/** prep 出来的目录记着哪一册 */
export interface PrepMeta { file: string; sha: string; title: string; layout: BookIndex['layout'] }

/** 一页的候选:文字层的行(L0…,一行里隔开的几截 L4.1…)、能写的格(id 就是作答区的 id:「4-格3」)、表格(T0…) */
export interface Candidates {
  page: number;
  name: string;
  printed: number | null;
  lines: { id: string; text: string; box: PermilleBox; chrome?: true; segs?: PermilleBox[] }[];
  cells: { id: string; kind: string; box: PermilleBox; ch?: string; m?: string; row?: number; col?: number; table?: string }[];
  tables: { id: string; box: PermilleBox }[];
}

export const iou = (a: readonly number[], b: readonly number[]): number => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return a.every((v, k) => Math.abs(v - b[k]) <= 0.2) ? 1 : 0;
  const i = w * h;
  return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i);
};

/** 一册,照文件名(教材/ 里列得出的那个名字);没有、读不出 = null。工作台的分块页也用(src/app/http/dev-zones.ts) */
export async function loadBook(ws: Workspace, file: string): Promise<Book | null> {
  if (!(await listBooks(ws.paths.textbooks, null)).includes(file)) return null;
  const cache = join(ws.root, CACHE);
  const index = await bookIndex(ws.paths.textbooks, cache, file);
  if (!index) return null;
  const n = bookPageNames(index);
  return { file, index, zones: await bookZones(ws.paths.textbooks, cache, index), names: new Map(n.pages.map((x) => [x.n, x])), warnings: n.warnings };
}

/** 一册:名字是文件名或文件名里的一段(「数学」「语文二年级上册」);对不上、对上好几本都说清楚 */
async function openBook(ws: Workspace, name: string): Promise<Book> {
  const names = await listBooks(ws.paths.textbooks, null);
  if (!names.length) throw new UsageError(`${redactHome(ws.paths.textbooks)} 里没有课本 PDF`);
  const hit = names.includes(name) ? [name] : names.filter((n) => n.includes(name));
  if (hit.length !== 1) throw new UsageError(hit.length ? `「${name}」对上好几本:${hit.join('、')},写全一点` : `教材里没有名字带「${name}」的课本(有:${names.join('、')})`);
  const b = await loadBook(ws, hit[0]);
  if (!b) throw new UsageError(`课本《${hit[0]}》读不出来`);
  return b;
}

/** 页 n 落在目录上最里一层的哪一课(页码范围最小的那个);目录页、封面这种不在课里的 = null */
export function leafOf(index: BookIndex, n: number): BookLesson | null {
  return index.lessons.filter((l) => n >= l.pages[0] && n <= l.pages[1]).sort((a, b) => a.pages[1] - a.pages[0] - (b.pages[1] - b.pages[0]))[0] ?? null;
}

/** 这几页按课取全:每页所在的那一课的页都带上(工作台一课一课改) */
export function wholeLessons(index: BookIndex, want: readonly number[]): { lessons: { title: string; pages: [number, number] }[]; pages: number[] } {
  const lessons = new Map<string, { title: string; pages: [number, number] }>();
  const pages = new Set<number>();
  for (const n of want) {
    if (!index.pages.some((p) => p.n === n)) continue;
    const l = leafOf(index, n);
    if (!l) { pages.add(n); continue; }
    lessons.set(`${l.title}@${l.pages[0]}`, { title: l.title, pages: l.pages });
    for (let k = l.pages[0]; k <= l.pages[1]; k++) if (index.pages.some((p) => p.n === k)) pages.add(k);
  }
  return { lessons: [...lessons.values()], pages: [...pages].sort((a, b) => a - b) };
}

/** 编程助手一次做的一组:目录上最里一层的一课(连着它的页),不在课里的页一页一组 */
export interface WorkGroup { key: string; title: string | null; pages: number[] }
export function workGroups(b: Book, only?: readonly number[]): WorkGroup[] {
  const out = new Map<string, WorkGroup>();
  for (const p of b.index.pages) {
    if (only && !only.includes(p.n)) continue;
    const l = leafOf(b.index, p.n);
    const key = l ? `${l.title}@${l.pages[0]}` : b.names.get(p.n)!.name;
    const g = out.get(key) ?? { key, title: l?.title ?? null, pages: [] };
    g.pages.push(p.n);
    out.set(key, g);
  }
  return [...out.values()];
}

/** 一行里隔开的几截(字的 sp):两截以上才有;框是那几个字的左右、这一行的上下 */
function lineSegs(p: BookPage, l: BookLine): PermilleBox[] | undefined {
  const runs: BookLine['chars'][] = [];
  for (const c of l.chars) { if (!runs.length || c.sp) runs.push([]); runs[runs.length - 1].push(c); }
  if (runs.length < 2) return undefined;
  return runs.map((r) => linePermille(p, { x1: r[0].x1, x2: r[r.length - 1].x2, y1: l.y1, y2: l.y2 }));
}

/** 一页的候选(从索引现取,和规则出分块看的是同一份);name = 这一页的页名(作答区 id 照它起头) */
export function candidatesOf(p: BookPage, name: string): Candidates {
  return {
    page: p.n,
    name,
    printed: p.printed,
    lines: p.lines.map((l, i) => { const segs = lineSegs(p, l); return { id: `L${i}`, text: spacedText(l), box: linePermille(p, l), ...(bookChrome(p, l) ? { chrome: true as const } : {}), ...(segs ? { segs } : {}) }; }),
    cells: (p.cells ?? []).map((c, i) => ({ id: `${name}-格${i}`, kind: c.kind, box: linePermille(p, c), ...(c.ch ? { ch: c.ch } : {}), ...(c.m ? { m: c.m } : {}), ...(c.r !== undefined ? { row: c.r + 1, col: (c.c ?? 0) + 1 } : {}), ...(c.t !== undefined ? { table: `T${c.t}` } : {}) })),
    tables: (p.tables ?? []).map((t, k) => ({ id: `T${k}`, box: linePermille(p, { x1: t[0], y1: t[1], x2: t[2], y2: t[3] }) })),
  };
}

/** 孩子要动手的候选(范字不算:那是照着写的字) */
export const WRITABLE = new Set(['trace', 'empty', 'blank', 'table', 'tick']);

/** 草稿:一课挑一份(同运行时);不在课里的页单页挑。工作台读一课时用 */
export function lessonDraft(b: Book, got: { lessons: { pages: [number, number] }[]; pages: number[] }): Map<number, ZonePage> {
  const draft = new Map<number, ZonePage>();
  for (const l of got.lessons) {
    const ns = got.pages.filter((n) => n >= l.pages[0] && n <= l.pages[1]);
    for (const z of pickZones(b.zones, ns).pages) draft.set(z.page, z);
  }
  for (const n of got.pages) if (!draft.has(n)) { const z = pickZones(b.zones, [n]).pages[0]; if (z) draft.set(n, z); }
  return draft;
}

/** 页图:200dpi、照 PDF 的裁切框(和索引的坐标一套);先 pdftoppm,再 PyMuPDF;都没有回 false */
function renderPage(pdf: string, n: number, png: string): boolean {
  try {
    execFileSync('pdftoppm', ['-png', '-r', '200', '-cropbox', '-f', String(n), '-l', String(n), '-singlefile', pdf, png.replace(/\.png$/, '')], { stdio: 'ignore' });
    if (existsSync(png)) return true;
  } catch { /* 没装 poppler */ }
  try {
    execFileSync('python3', ['-c', 'import sys,fitz;d=fitz.open(sys.argv[1]);d[int(sys.argv[2])-1].get_pixmap(dpi=200).save(sys.argv[3])', pdf, String(n), png], { stdio: 'ignore' });
    return existsSync(png);
  } catch {
    return false;
  }
}

// ——— 页面数据 ———

const KIND_ZH: Record<string, string> = { model: '范字', trace: '描红', empty: '空格', blank: '填空', table: '表格的格', tick: '打勾的方框' };
const r0 = (n: number): number => Math.round(n);
const clip = (t: string, n: number): string => { const cs = Array.from(t); return cs.length > n ? `${cs.slice(0, n).join('')}…` : t; };
const closes = (t: string): boolean => /[。！？!?…”」』]$/.test(t.trim());

/** 一页的页面数据(prep 的 004.md 和 004.data.json):一行一条,单位都是 pt,离页顶从页顶量;空 = 这一行顶 − 上一行底,负的是并排 */
export interface PageData {
  page: number; name: string; kind: string; inferred?: true; lesson: string | null; w: number; h: number;
  prev?: { style: string; text: string; closed: boolean };
  lines: { id: string; y: number; x: number; style: string; gap: number | null; text: string; dots?: string; chrome?: true; segs?: { id: string; text: string }[]; box: PermilleBox }[];
  cells: Candidates['cells'];
  tables: Candidates['tables'];
}

export function pageData(b: Book, p: BookPage): PageData {
  const nm = b.names.get(p.n)!;
  const cand = candidatesOf(p, nm.name);
  const prevPage = b.index.pages.find((x) => x.n === p.n - 1);
  const prevLine = prevPage ? [...prevPage.lines].reverse().find((l) => !bookChrome(prevPage, l)) : undefined;
  let bottom: number | null = null;
  const lines = p.lines.map((l, i) => {
    const gap = bottom === null ? null : r0(l.y1 - bottom);
    bottom = l.y2;
    const text = spacedText(l, ' ', (c) => (c.dot ? `〈${c.c}〉` : c.c)).replace(/〉〈/g, '');
    const runs = spacedText(l).split(' ');
    const dots = l.chars.filter((c) => c.dot).map((c) => c.c).join('');
    return {
      id: `L${i}`, y: r0(l.y1), x: r0(l.x1), style: lineStyle(l), gap, text,
      ...(dots ? { dots } : {}), ...(bookChrome(p, l) ? { chrome: true as const } : {}),
      ...(runs.length > 1 ? { segs: runs.map((t, k) => ({ id: `L${i}.${k + 1}`, text: t })) } : {}),
      box: cand.lines[i].box,
    };
  });
  return {
    page: p.n, name: nm.name, kind: nm.kind, ...(nm.inferred ? { inferred: true as const } : {}), lesson: leafOf(b.index, p.n)?.title ?? null, w: r0(p.w), h: r0(p.h),
    ...(prevLine ? { prev: { style: lineStyle(prevLine), text: clip(spacedText(prevLine), 24), closed: closes(prevLine.text) } } : {}),
    lines, cells: cand.cells, tables: cand.tables,
  };
}

export function pageDataMd(d: PageData): string {
  const out = [`# 页 ${d.name}`, '', `PDF 第 ${d.page} 页 · ${d.kind}${d.inferred ? '(页码没印,推出来的)' : ''} · ${d.lesson ? `课:${d.lesson}` : '不在哪一课里'} · 页宽 ${d.w} 页高 ${d.h}(pt)`];
  out.push(d.prev ? `上一页最后一行:${d.prev.style}「${d.prev.text}」 ${d.prev.closed ? '收了句' : '没收句,这一页开头可能接着它'}` : '上一页:没有');
  out.push('', '单位都是 pt。离顶 = 字的上边离页顶;空 = 这一行顶 − 上一行底(负的是和上一行并排);〈〉里是加了着重号的字;隔开的词之间一个空格,每一截有自己的号。', '');
  out.push('| 行 | 离顶 | 缩进 | 样式 | 空 | 字 |', '|---|---|---|---|---|---|');
  for (const l of d.lines) {
    const note = l.chrome ? '(页眉页脚,不标)' : l.segs ? `(${l.segs.map((s) => s.id).join(' ')})` : '';
    out.push(`| ${l.id} | ${l.y} | ${l.x} | ${l.style} | ${l.gap === null ? '—' : l.gap < 0 ? `${l.gap} 并排` : l.gap} | ${l.text.replace(/\|/g, '\\|')}${note ? ` ${note}` : ''} |`);
  }
  out.push('', '## 能写的格');
  if (!d.cells.length) out.push('', '(无)');
  else {
    out.push('', 'id 就是作答区的 id,照抄;框是千分比 [左, 上, 右, 下]。', '', '| id | 种类 | 在哪 | 框 |', '|---|---|---|---|');
    for (const c of d.cells) out.push(`| ${c.id} | ${KIND_ZH[c.kind] ?? c.kind} | ${[c.table ? `${c.table} 第 ${c.row} 行第 ${c.col} 格` : '', c.ch ? `格里印着「${c.ch}」` : '', c.m ? `照着「${c.m}」写` : ''].filter(Boolean).join(',') || '—'} | [${c.box.join(', ')}] |`);
  }
  out.push('', '## 表格');
  out.push('', d.tables.length ? d.tables.map((t) => `- ${t.id} [${t.box.join(', ')}]`).join('\n') : '(无)');
  return `${out.join('\n')}\n`;
}

/** 整册的 book.md:页码对照、警告、目录、样式表 */
export function bookMd(b: Book, done: ReadonlySet<string>): string {
  const out = [`# 《${b.index.title}》`, '', `PDF ${b.index.pages.length} 页 · 指纹 ${b.index.sha} · 分法 ${b.index.layout}`, '', '## 页', '', '页名和种类照 cotutor 定的写进分块文件(name、kind),不改;觉得不对的写进报告。', '', '| PDF | 页名 | 种类 | 说明 |', '|---|---|---|---|'];
  for (const p of b.index.pages) {
    const nm = b.names.get(p.n)!;
    out.push(`| ${p.n} | ${nm.name} | ${nm.kind} | ${[nm.inferred ? '页码没印,推出来的' : '', leafOf(b.index, p.n)?.title ?? ''].filter(Boolean).join(';')} |`);
  }
  out.push('', '## 警告', '', b.warnings.length ? b.warnings.map((w) => `- ${w}`).join('\n') : '(无)');
  out.push('', '## 课', '', '目录上最里一层的一课一组,一组一起写、一起 push。', '', '| 课 | 印的页 | PDF 页 | 页名 | 存了 |', '|---|---|---|---|---|');
  for (const g of workGroups(b)) {
    if (!g.title) continue;
    const l = b.index.lessons.find((x) => `${x.title}@${x.pages[0]}` === g.key)!;
    out.push(`| ${g.title} | ${l.from}–${l.to} | ${g.pages[0]}–${g.pages[g.pages.length - 1]} | ${g.pages.map((n) => b.names.get(n)!.name).join('、')} | ${done.has(g.key) ? '✓' : ''} |`);
  }
  const styles = new Map<string, { chars: number; pages: Set<number>; ex: string[] }>();
  for (const p of b.index.pages) for (const l of p.lines) {
    if (bookChrome(p, l)) continue;
    const k = lineStyle(l);
    const s = styles.get(k) ?? { chars: 0, pages: new Set<number>(), ex: [] };
    s.chars += l.chars.length; s.pages.add(p.n);
    const t = clip(spacedText(l), 12);
    if (s.ex.length < 3 && !s.ex.includes(t)) s.ex.push(t);
    styles.set(k, s);
  }
  out.push('', '## 样式', '', '样式 = 字体 × 字号。同一种样式在这本书里多半是同一种东西;先看几页,在 styles.json 里给每种写上是什么(「习题的指令」),后面照它认。', '', '| 样式 | 字数 | 页数 | 例子 |', '|---|---|---|---|');
  for (const [k, s] of [...styles].sort((a, c) => c[1].chars - a[1].chars)) out.push(`| ${k} | ${s.chars} | ${s.pages.size} | ${s.ex.join(' / ').replace(/\|/g, '\\|')} |`);
  return `${out.join('\n')}\n`;
}

// ——— list ———

export async function listCommand(ws: Workspace, name?: string): Promise<{ books: { file: string; sha: string; layout: string; pages: number; vaultPages: number; lessons: { title: string; printed: [number, number]; pages: [number, number]; zones: 'vault' | 'rules' | 'mixed'; depth: number }[] }[] }> {
  const files = name ? [(await openBook(ws, name)).file] : await listBooks(ws.paths.textbooks, null);
  const out = [];
  for (const f of files) {
    const b = await openBook(ws, f);
    const depth = (l: BookLesson): number => (l.parent ? 1 + depth(b.index.lessons.find((x) => x.title === l.parent) ?? { ...l, parent: undefined }) : 0);
    out.push({
      file: b.file, sha: b.index.sha, layout: b.index.layout, pages: b.index.pages.length, vaultPages: Object.keys(b.zones.vault).length,
      lessons: b.index.lessons.map((l) => {
        const ns = Array.from({ length: l.pages[1] - l.pages[0] + 1 }, (_, k) => l.pages[0] + k);
        return { title: l.title, printed: [l.from, l.to] as [number, number], pages: l.pages, zones: pickBookZones(b.index, b.zones, ns).which, depth: depth(l) };
      }),
    });
  }
  return { books: out };
}

// ——— prep ———

/** --lesson 取目录项的页段。单元导入单列一页的课本,选单元名只取那一页。 */
function lessonPages(b: Book, want: string): number[] {
  const l = b.index.lessons.find((x) => x.title === want) ?? b.index.lessons.find((x) => x.title.includes(want));
  if (!l) throw new UsageError(`《${b.file}》里没有「${want}」这一课(cotutor textbook list 看有哪些)`);
  return b.index.pages.filter((p) => p.n >= l.pages[0] && p.n <= l.pages[1]).map((p) => p.n);
}

const readJson = <T>(file: string): Promise<T | null> => readFile(file, 'utf8').then((s) => JSON.parse(s) as T, () => null);

export async function prepCommand(ws: Workspace, name: string, opts: { lesson?: string; out?: string }): Promise<{ dir: string; meta: PrepMeta; pages: number; drafts: number; images: number; noImages: boolean; warnings: string[] }> {
  const b = await openBook(ws, name);
  const want = opts.lesson ? lessonPages(b, opts.lesson) : b.index.pages.map((p) => p.n);
  const dir = resolve(ws.root, opts.out ?? join(WORK, b.index.title));
  const old = await readJson<PrepMeta>(join(dir, PREP));
  if (old && old.sha !== b.index.sha) throw new UsageError(`${redactHome(dir)} 是另一本课本(或换过的 PDF)摊开的,换个 --out`);
  await mkdir(dir, { recursive: true });
  const meta: PrepMeta = { file: b.file, sha: b.index.sha, title: b.index.title, layout: b.index.layout };
  await writeFile(join(dir, PREP), `${JSON.stringify(meta, null, 1)}\n`);
  const progress = (await readJson<{ done: Record<string, unknown> }>(join(dir, PROGRESS))) ?? { done: {} };
  if (!existsSync(join(dir, PROGRESS))) await writeFile(join(dir, PROGRESS), `${JSON.stringify(progress, null, 1)}\n`);
  await writeFile(join(dir, 'book.md'), bookMd(b, new Set(Object.keys(progress.done))));
  if (!existsSync(join(dir, STYLES))) {
    const styles: Record<string, string> = {};
    for (const p of b.index.pages) for (const l of p.lines) if (!bookChrome(p, l)) styles[lineStyle(l)] = '';
    await writeFile(join(dir, STYLES), `${JSON.stringify(styles, null, 1)}\n`);
  }
  const pdf = await bookFile(ws.paths.textbooks, b.file);
  let drafts = 0, images = 0, noImages = false;
  for (const n of want) {
    const p = b.index.pages.find((x) => x.n === n)!;
    const nm = b.names.get(n)!;
    const stem = join(dir, zoneStem(nm.name));
    const d = pageData(b, p);
    await writeFile(`${stem}.md`, pageDataMd(d));
    await writeFile(`${stem}.data.json`, `${JSON.stringify(d, null, 1)}\n`);
    if (!existsSync(`${stem}.json`)) { await writeFile(`${stem}.json`, `${JSON.stringify({ v: ZONE_FORMAT, page: n, name: nm.name, kind: nm.kind, zones: [] }, null, 1)}\n`); drafts++; }
    if (existsSync(`${stem}.png`)) { images++; continue; }
    if (!noImages && pdf && renderPage(pdf, n, `${stem}.png`)) images++;
    else noImages = true;
  }
  return { dir, meta, pages: want.length, drafts, images, noImages, warnings: b.warnings };
}

// ——— check ———

export interface ZoneDirCheck { dir: string; book?: string; pages: number; zones: number; regions: number; problems: string[]; notes: string[] }

/** prep 出来的目录:哪一册、这几页的分块文件(读不出的写 {__bad: 原因});only = 只要这几页 */
async function readDir(ws: Workspace, dir: string, only?: readonly number[]): Promise<{ meta: PrepMeta; book: Book; pages: Map<number, unknown> } | string> {
  const meta = await readJson<PrepMeta>(join(dir, PREP));
  if (!meta) return `${redactHome(dir)} 里没有 ${PREP}:不是 cotutor textbook prep 摊开的目录`;
  const book = await openBook(ws, meta.file).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  if (typeof book === 'string') return book;
  if (book.index.sha !== meta.sha) return `课本《${meta.file}》换过了(指纹 ${book.index.sha},摊开的时候是 ${meta.sha}),重新 prep 到新目录`;
  const pages = new Map<number, unknown>();
  for (const p of book.index.pages) {
    if (only && !only.includes(p.n)) continue;
    const file = join(dir, `${zoneStem(book.names.get(p.n)!.name)}.json`);
    if (!existsSync(file)) { if (only) pages.set(p.n, { __bad: '不在' }); continue; }
    pages.set(p.n, await readFile(file, 'utf8').then((s) => JSON.parse(s) as unknown, (e: unknown) => ({ __bad: e instanceof SyntaxError ? `不是 JSON:${e.message}` : '读不出来' })));
  }
  return { meta, book, pages };
}

/** 一行、一截的框:L4 → 这一行,L4.2 → 这一行的第二截;认不出 = null */
function refBox(cand: Candidates, ref: string): PermilleBox | null {
  const m = LINE_REF.exec(ref);
  const l = m ? cand.lines[Number(m[1])] : undefined;
  if (!l) return null;
  if (m![2] === undefined) return l.box;
  return l.segs?.[Number(m![2]) - 1] ?? null;
}

/** 一页的问题:这一页的候选、索引的页对着查;strict = 编程助手整页写的(有字的行都要有块认领) */
function pageProblems(zp: ZonePage, cand: Candidates, at: string, strict: boolean): { problems: string[]; notes: string[] } {
  const problems: string[] = [], notes: string[] = [];
  if (zp.kind && !needsZones(zp.kind) && !zp.zones.length && !zp.regions?.length) return { problems, notes };
  const byId = new Map(cand.cells.map((c) => [c.id, c]));
  const regions: { r: ZoneRegion; where: string }[] = [];
  walkZones(zp.zones, (z) => { for (const r of z.regions ?? []) regions.push({ r, where: `「${z.label}」` }); });
  for (const r of zp.regions ?? []) regions.push({ r, where: '页上' });
  for (const { r, where } of regions) {
    if (r.kind !== 'write' && r.kind !== 'tick') continue;
    const c = byId.get(r.id);
    if (c) { if (iou(c.box, r.box) < SNAP) problems.push(`${at}${where}的作答区 ${r.id}「${r.label}」:框和候选 ${r.id} 对不上(id 写候选的,框就照候选的)`); continue; }
    const near = cand.cells.find((x) => iou(x.box, r.box) >= SNAP);
    if (near) problems.push(`${at}${where}的作答区「${r.label}」就是候选 ${near.id}:id 写 ${near.id}(孩子写过的字照 id 存)`);
    else if (r.src !== 'measured') problems.push(`${at}${where}的作答区「${r.label}」:框不在候选里;照候选写,或者写脚本量好了加 "src": "measured"`);
  }
  const ignore = new Set(zp.ignore ?? []);
  for (const c of cand.cells) {
    if (!WRITABLE.has(c.kind) || ignore.has(c.id) || regions.some(({ r }) => r.id === c.id || iou(r.box, c.box) >= SNAP)) continue;
    problems.push(`${at}候选 ${c.id}(${KIND_ZH[c.kind] ?? c.kind}${c.table ? `,${c.table} 第 ${c.row} 行第 ${c.col} 格` : ''})没有作答区认领:漏了就补上;不是孩子要写的,把 "${c.id}" 写进这一页的 ignore`);
  }
  // 字行:每一行要对得上文字层的一行或一截;一块的行全是页眉页脚的,是标了不该标的
  const targets = cand.lines.flatMap((l) => [{ box: l.box, l }, ...(l.segs ?? []).map((box) => ({ box, l }))]);
  walkZones(zp.zones, (z) => {
    const hits = (z.rows ?? []).map((row) => targets.find((t) => iou(t.box, row) >= SNAP)?.l);
    hits.forEach((h, k) => { if (!h) problems.push(`${at}「${z.label}」第 ${k + 1} 行 [${z.rows![k].join(', ')}]:对不上文字层的行(写行号 L…)`); });
    if (hits.length && hits.every((h) => h?.chrome)) problems.push(`${at}「${z.label}」:标的是页眉页脚(社标、页码、「仅供个人学习使用」不标)`);
  });
  // 有字的行都要有块认领:在哪块的字行里,或者落在哪块的框里(插图里的字、表里的字)
  if (strict) {
    const boxes: PermilleBox[] = [], rows: PermilleBox[] = [];
    walkZones(zp.zones, (z) => { boxes.push(z.box); rows.push(...(z.rows ?? [])); });
    const inside = (b: PermilleBox, x: number, y: number): boolean => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
    for (const l of cand.lines) {
      if (l.chrome || !/[\p{Script=Han}\p{N}]/u.test(l.text)) continue;
      const cx = (l.box[0] + l.box[2]) / 2, cy = (l.box[1] + l.box[3]) / 2;
      if (rows.some((r) => inside(l.box, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2)) || boxes.some((b) => inside(b, cx, cy))) continue;
      problems.push(`${at}${l.id}「${clip(l.text, 12)}」没有块认领:写进哪一块的 rows,或者落在插图、表格那块的框里`);
    }
  }
  // 一层里的块叠得太多:多半框画大了
  const sibs = (zs: readonly Zone[]): void => {
    zs.forEach((a, i) => zs.slice(i + 1).forEach((b) => { if (iou(a.box, b.box) > 0.5) notes.push(`${at}「${a.label}」和「${b.label}」叠了一大半`); }));
    for (const z of zs) if (z.children) sibs(z.children);
  };
  sibs(zp.zones);
  return { problems, notes };
}

/**
 * 几课的分块一起查(prep 出来的目录、工作台改的一课都走这里):行号换成框,每页过形状,再查页名、id、cont、关系、对着这一页的候选和文字层查,最后一课里叫法不重名。
 * raw = PDF 页号 → 读进来的样子(还没过形状;读不出的写 {__bad: 原因});strict = 编程助手写的(有字的行都要有块认领;工作台改的是规则出的那份,只提醒)
 */
export function checkZonePages(book: Book, lessons: readonly { title: string; pages: [number, number] }[], raw: ReadonlyMap<number, unknown>, opts: { strict?: boolean } = {}): { pages: number; zones: number; regions: number; problems: string[]; notes: string[]; parsed: Map<number, ZonePage> } {
  const out = { pages: 0, zones: 0, regions: 0, problems: [] as string[], notes: [] as string[] };
  const parsed = new Map<number, ZonePage>();
  for (const [n, one] of raw) {
    const nm = book.names.get(n);
    const at = `页 ${nm?.name ?? n}(PDF 第 ${n} 页)`;
    const pg = book.index.pages.find((p) => p.n === n);
    if (!pg || !nm) { out.problems.push(`${at}:《${book.file}》没有这一页`); continue; }
    if (one && typeof one === 'object' && '__bad' in one) { out.problems.push(`${at}:${zoneStem(nm.name)}.json ${(one as { __bad: string }).__bad}`); continue; }
    const cand = candidatesOf(pg, nm.name);
    const r = ZoneFileSchema.safeParse(resolveDraft(one, (ref) => refBox(cand, ref), at, out.problems));
    if (!r.success) { out.problems.push(...r.error.issues.map((i) => `${at}:${i.path.map(String).join('.') || '(整页)'} ${i.message}`)); continue; }
    if (r.data.page !== n || r.data.name !== nm.name || r.data.kind !== nm.kind) { out.problems.push(`${at}:page、name、kind 照 book.md 写(${n}、${nm.name}、${nm.kind}),写的是 ${r.data.page}、${r.data.name}、${r.data.kind}`); continue; }
    parsed.set(n, r.data);
    out.pages++;
    out.regions += r.data.regions?.length ?? 0;
    walkZones(r.data.zones, (z) => { out.zones++; out.regions += z.regions?.length ?? 0; });
    out.problems.push(...zonePageProblems(r.data));
    // id 照页名起头,整册不重
    const stem = `${nm.name}-`;
    walkZones(r.data.zones, (z) => {
      if (!z.id.startsWith(stem)) out.problems.push(`${at}「${z.label}」:id「${z.id}」要照页名起头(${stem}1、${stem}2.1)`);
      for (const x of z.regions ?? []) if (!x.id.startsWith(stem)) out.problems.push(`${at}「${z.label}」的作答区「${x.label}」:id「${x.id}」要照页名起头(候选的格照抄,量的写 ${stem}量1)`);
    });
    for (const x of r.data.regions ?? []) if (!x.id.startsWith(stem)) out.problems.push(`${at}页上的作答区「${x.label}」:id「${x.id}」要照页名起头`);
    const pp = pageProblems(r.data, cand, at, opts.strict ?? false);
    out.problems.push(...pp.problems);
    out.notes.push(...pp.notes);
  }
  // cont 要指着上一页的一块(上一页在这一批里照这一批,不在照现在用的那份)
  const ids = (zp: ZonePage | undefined): Set<string> => { const s = new Set<string>(); if (zp) walkZones(zp.zones, (z) => s.add(z.id)); return s; };
  const canon = new Map<string, string>();
  for (const [n, zp] of [...parsed].sort((a, b) => a[0] - b[0])) {
    const prev = parsed.get(n - 1) ?? pickZones(book.zones, [n - 1]).pages[0];
    const there = ids(prev);
    walkZones(zp.zones, (z) => {
      if (!z.cont) return;
      if (!there.has(z.cont)) out.problems.push(`页 ${zp.name}「${z.label}」:cont「${z.cont}」不是上一页(${prev?.name ?? '没有'})的块`);
      else canon.set(z.id, canon.get(z.cont) ?? z.cont);
    });
  }
  // 一课里叫法不重名(接着上一页的那一截和它算一块):老师 [[看 …]] 照叫法找。小题(sub)只在同一块里不重名:
  // 一课里好几处「7×2」,老师写「练一练第 1 题的 7×2」找得到(src/chalk/kit/book.ts 的 bookTarget)
  for (const l of lessons) {
    const names = new Map<string, Set<string>>();
    for (const [n, zp] of parsed) if (n >= l.pages[0] && n <= l.pages[1]) walkZones(zp.zones, (z, _d, parent) => {
      const key = z.kind === 'sub' ? `${parent ? canon.get(parent.id) ?? parent.id : ''}\u0000${z.label}` : z.label;
      names.set(key, (names.get(key) ?? new Set()).add(canon.get(z.id) ?? z.id));
    });
    for (const [key, set] of names) {
      if (set.size < 2) continue;
      const [owner, label] = key.includes('\u0000') ? key.split('\u0000') : ['', key];
      out.problems.push(owner ? `《${l.title}》里同一块(${owner})下面有 ${set.size} 个小题都叫「${label}」(${[...set].join('、')}):同一道题里的小题不重名` : `《${l.title}》里有 ${set.size} 块都叫「${label}」(${[...set].join('、')}):老师说「看 ${label}」会找错,改成书上的号或从上往下数`);
    }
  }
  return { ...out, parsed };
}

/** --lesson 落到哪几组;没给就是 groups 全部 */
function pickGroups(b: Book, lesson?: string): WorkGroup[] {
  const all = workGroups(b);
  if (!lesson) return all;
  const want = new Set(lessonPages(b, lesson));
  return all.filter((g) => g.pages.some((n) => want.has(n)));
}

const lessonsOf = (gs: readonly WorkGroup[]): { title: string; pages: [number, number] }[] => gs.flatMap((g) => (g.title ? [{ title: g.title, pages: [g.pages[0], g.pages[g.pages.length - 1]] as [number, number] }] : []));

export async function checkZoneDir(ws: Workspace, dir: string, opts: { lesson?: string } = {}): Promise<ZoneDirCheck & { parsed?: Map<number, ZonePage>; meta?: PrepMeta; bookOf?: Book }> {
  const out: ZoneDirCheck = { dir, pages: 0, zones: 0, regions: 0, problems: [], notes: [] };
  const first = await readDir(ws, dir);
  if (typeof first === 'string') return { ...out, problems: [first] };
  const groups = pickGroups(first.book, opts.lesson);
  const got = opts.lesson ? await readDir(ws, dir, groups.flatMap((g) => g.pages)) : first;
  if (typeof got === 'string') return { ...out, problems: [got] };
  out.book = got.meta.file;
  const r = checkZonePages(got.book, lessonsOf(groups), got.pages, { strict: true });
  return { ...out, ...r, parsed: r.parsed, meta: got.meta, bookOf: got.book };
}

// ——— preview ———

const COLORS: [number, number, number][] = [[214, 39, 40], [148, 103, 189], [227, 119, 194], [140, 86, 75]];
const ORANGE: [number, number, number] = [255, 127, 14];
const RED: [number, number, number] = [255, 0, 0];

function drawBox(img: { w: number; h: number; px: Buffer }, b: readonly number[], rgb: readonly number[], t: number): void {
  const x1 = Math.round((b[0] / 1000) * img.w), y1 = Math.round((b[1] / 1000) * img.h), x2 = Math.round((b[2] / 1000) * img.w), y2 = Math.round((b[3] / 1000) * img.h);
  const put = (x: number, y: number): void => { if (x < 0 || y < 0 || x >= img.w || y >= img.h) return; const o = (y * img.w + x) * 3; img.px[o] = rgb[0]; img.px[o + 1] = rgb[1]; img.px[o + 2] = rgb[2]; };
  for (let k = 0; k < t; k++) {
    for (let x = x1; x <= x2; x++) { put(x, y1 + k); put(x, y2 - k); }
    for (let y = y1; y <= y2; y++) { put(x1 + k, y); put(x2 - k, y); }
  }
}

export async function previewZoneDir(ws: Workspace, dir: string, opts: { lesson?: string } = {}): Promise<{ files: string[]; missing: string[]; check: ZoneDirCheck }> {
  const c = await checkZoneDir(ws, dir, opts);
  const files: string[] = [], missing: string[] = [];
  for (const [n, zp] of c.parsed ?? new Map<number, ZonePage>()) {
    const stem = join(dir, zoneStem(zp.name!));
    const buf = await readFile(`${stem}.png`).catch(() => null);
    const img = buf ? decodePng(buf) : null;
    if (!img) { missing.push(zp.name!); continue; }
    const p = c.bookOf!.index.pages.find((x) => x.n === n)!;
    const cand = candidatesOf(p, zp.name!);
    const regions: ZoneRegion[] = [...(zp.regions ?? [])];
    walkZones(zp.zones, (z, depth) => { drawBox(img, z.box, COLORS[Math.min(depth, COLORS.length - 1)], 4); regions.push(...(z.regions ?? [])); });
    for (const r of regions) drawBox(img, r.box, ORANGE, 3);
    const ignore = new Set(zp.ignore ?? []);
    for (const x of cand.cells) if (WRITABLE.has(x.kind) && !ignore.has(x.id) && !regions.some((r) => r.id === x.id || iou(r.box, x.box) >= SNAP)) drawBox(img, x.box, RED, 7);
    const file = `${stem}.preview.png`;
    await writeFile(file, encodePng(img.w, img.px, 3, img.h));
    files.push(file);
  }
  return { files, missing, check: c };
}

// ——— push ———

/** 存之前:作答区的 id 是候选的换成候选的框,字行换成重合最多的那一行(或那一截)的框,每块记上样式 */
export function snapZonePage(zp: ZonePage, p: BookPage): ZonePage {
  const cand = candidatesOf(p, zp.name ?? String(p.n));
  const cells = new Map(cand.cells.map((c) => [c.id, c]));
  const targets = cand.lines.flatMap((l, i) => [{ box: l.box, l: p.lines[i] }, ...(l.segs ?? []).map((box) => ({ box, l: p.lines[i] }))]);
  const region = (r: ZoneRegion): ZoneRegion => { const c = cells.get(r.id); return c && iou(c.box, r.box) >= SNAP ? { ...r, box: c.box } : r; };
  const zone = (z: Zone): Zone => {
    const hits = (z.rows ?? []).map((row) => targets.map((x) => ({ x, s: iou(x.box, row) })).sort((a, b) => b.s - a.s)[0]);
    const style = styleOf(hits.flatMap((h) => (h && h.s >= SNAP ? [h.x.l] : [])));
    return {
      ...z,
      ...(style ? { style } : {}),
      ...(z.rows ? { rows: z.rows.map((row, k) => (hits[k] && hits[k].s >= SNAP ? hits[k].x.box : row)) } : {}),
      ...(z.regions ? { regions: z.regions.map(region) } : {}),
      ...(z.children ? { children: z.children.map(zone) } : {}),
    };
  };
  return { ...zp, v: ZONE_FORMAT, zones: zp.zones.map(zone), ...(zp.regions ? { regions: zp.regions.map(region) } : {}) };
}

export interface PushResult { title: string; pages: string[]; wrote: boolean; problems: string[] }

export async function pushZoneDir(ws: Workspace, dir: string, opts: { lesson?: string } = {}, now = new Date()): Promise<{ to?: string; results: PushResult[]; problems: string[] }> {
  const got = await readDir(ws, dir);
  if (typeof got === 'string') return { results: [], problems: [got] };
  const b = got.book;
  const groups = pickGroups(b, opts.lesson);
  const to = vaultZonesDir(ws.paths.textbooks, got.meta.sha);
  const styles = Object.fromEntries(Object.entries((await readJson<Record<string, string>>(join(dir, STYLES))) ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()));
  const progress = (await readJson<{ done: Record<string, { at: string; pages: string[] }> }>(join(dir, PROGRESS))) ?? { done: {} };
  const results: PushResult[] = [];
  for (const g of groups) {
    const title = g.title ?? `页 ${b.names.get(g.pages[0])!.name}`;
    const names = g.pages.map((n) => b.names.get(n)!.name);
    const missing = g.pages.filter((n) => !got.pages.has(n));
    if (missing.length) { if (opts.lesson) results.push({ title, pages: names, wrote: false, problems: [`页 ${missing.map((n) => b.names.get(n)!.name).join('、')} 没有分块文件:一课的页要一起写`] }); continue; }
    const r = checkZonePages(b, lessonsOf([g]), new Map(g.pages.map((n) => [n, got.pages.get(n)])), { strict: true });
    if (r.problems.length) { results.push({ title, pages: names, wrote: false, problems: r.problems }); continue; }
    const pages = g.pages.map((n) => snapZonePage(r.parsed.get(n)!, b.index.pages.find((p) => p.n === n)!));
    await writeZonePages(to, { title: got.meta.title, sha: got.meta.sha }, pages, 'agent', now, Object.keys(styles).length ? styles : undefined);
    progress.done[g.key] = { at: now.toISOString(), pages: names };
    results.push({ title, pages: names, wrote: true, problems: [] });
  }
  await writeFile(join(dir, PROGRESS), `${JSON.stringify(progress, null, 1)}\n`);
  await writeFile(join(dir, 'book.md'), bookMd(b, new Set(Object.keys(progress.done))));
  return { to, results, problems: [] };
}

// ——— 命令行 ———

export async function textbookCommand(positionals: readonly string[], flags: Record<string, string | true>, o: { workspace?: string; json: boolean }): Promise<void> {
  const [sub, arg] = positionals;
  const ws = loadWorkspace(o.workspace);
  const say = (s: string): void => { process.stdout.write(`${s}\n`); };
  const lesson = typeof flags.lesson === 'string' ? flags.lesson : undefined;
  const dirOf = (): string => { if (!arg) throw new UsageError(`textbook ${sub} 要 prep 摊开的目录`); return resolve(arg); };
  if (sub === 'list') {
    const r = await listCommand(ws, arg);
    if (o.json) { say(JSON.stringify(redactDeep(r), null, 2)); return; }
    for (const b of r.books) {
      say(`《${b.file}》 ${b.layout},${b.pages} 页,指纹 ${b.sha}${b.vaultPages ? `,vault 里改好的 ${b.vaultPages} 页` : ''}`);
      for (const l of b.lessons) say(`  ${'  '.repeat(l.depth)}${l.title}  印 ${l.printed[0]}–${l.printed[1]} 页 = PDF ${l.pages[0]}–${l.pages[1]}${l.zones === 'vault' ? '  [vault 里改好的]' : l.zones === 'mixed' ? '  [有几课是 vault 里改好的]' : ''}`);
    }
    return;
  }
  if (sub === 'prep') {
    if (!arg) throw new UsageError('textbook prep 要课本的名字(文件名里的一段,如 数学)');
    const r = await prepCommand(ws, arg, { lesson, out: typeof flags.out === 'string' ? flags.out : undefined });
    if (o.json) { say(JSON.stringify(redactDeep({ ok: true, ...r }), null, 2)); return; }
    say(`摊开到 ${redactHome(r.dir)}:《${r.meta.file}》${r.pages} 页,新的空分块 ${r.drafts} 份,页图 ${r.images}/${r.pages} 张`);
    say('  先读 book.md(页名、目录、样式表),再一课一课:读 004.md 和 004.png,写 004.json,check、preview、push --lesson');
    for (const w of r.warnings) say(`  警告:${w}`);
    if (r.noImages) say('  有的页图没出来:要 poppler 的 pdftoppm 或 python3 的 PyMuPDF(装之前问家长),或者自己把 PDF 那几页按 200dpi、照裁切框出成 004.png');
    return;
  }
  if (sub === 'check' || sub === 'preview') {
    const dir = dirOf();
    const r = sub === 'check' ? { check: await checkZoneDir(ws, dir, { lesson }), files: [] as string[], missing: [] as string[] } : await previewZoneDir(ws, dir, { lesson });
    const { parsed: _p, meta: _m, bookOf: _b, ...c } = r.check as ZoneDirCheck & { parsed?: unknown; meta?: unknown; bookOf?: unknown };
    if (o.json) say(JSON.stringify(redactDeep({ ok: !c.problems.length, ...c, ...(sub === 'preview' ? { files: r.files, missing: r.missing } : {}) }), null, 2));
    else {
      say(`${c.problems.length ? '✗' : '✓'} ${redactHome(dir)}${c.book ? `  《${c.book}》${c.pages} 页 ${c.zones} 块 ${c.regions} 个作答区` : ''}`);
      for (const p of c.problems) say(`    要改:${p}`);
      for (const p of c.notes) say(`    提醒:${p}`);
      for (const f of r.files) say(`    预览:${redactHome(f)}`);
      if (r.missing.length) say(`    页 ${r.missing.join('、')} 没有页图,出不了预览`);
      say(c.problems.length ? `有 ${c.problems.length} 条要改` : '都对得上');
    }
    if (c.problems.length) process.exitCode = 1;
    return;
  }
  if (sub === 'push') {
    const r = await pushZoneDir(ws, dirOf(), { lesson });
    const bad = r.problems.length || r.results.some((x) => !x.wrote) || !r.results.length;
    if (o.json) say(JSON.stringify(redactDeep({ ok: !bad, ...r }), null, 2));
    else {
      for (const p of r.problems) say(`✗ ${p}`);
      for (const x of r.results) {
        if (x.wrote) say(`✓ 《${x.title}》页 ${x.pages.join('、')} 写进 ${redactHome(r.to!)},从下一轮起用这一份`);
        else { say(`✗ 《${x.title}》没写:有 ${x.problems.length} 条要改(cotutor textbook check --lesson 看全)`); for (const p of x.problems.slice(0, 20)) say(`    要改:${p}`); }
      }
      if (!r.problems.length && !r.results.length) say('没有一课是页都写齐了的');
    }
    if (bad) process.exitCode = 1;
    return;
  }
  throw new UsageError(`textbook 的子命令是 list、prep、check、preview、push`);
}
