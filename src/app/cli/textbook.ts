/**
 * cotutor textbook:给改课本分块的编程助手用(技能 cotutor-textbook;分块的形状在 src/schema/zones.ts,docs/dev/课本.md 的「分块」)。
 *   list [<册>]            vault 教材/ 里的课本、每一课在 PDF 的哪几页、现在用的是规则出的还是 vault 里改好的
 *   pull <册> --pages|--lesson [--out <目录>]
 *                          取几课出来改:给的页落在哪几课(目录上最里一层),就把那几课的页都取全。每页出页图 p078.png(200dpi,
 *                          有 poppler 的 pdftoppm 用它,没有试 python3 的 PyMuPDF;都没有就不出图,说一句)、候选 p078.candidates.json
 *                          (文字层的行 L0…、能写的格 0…、表格 T0…,千分比的框;格的编号就是规则出的作答区 id)、这一页现在用的分块 p078.json 当草稿,
 *                          外加 pull.json(哪一册、哪几课、哪几页)。缺省放 .cotutor/zones-work/<册名>-p<头>-<尾>/
 *   check <目录>           一次列全要改的(checkZoneDir):形状、id、小块出了大块、字行对不上文字层、能写的格没吸上候选、候选没人认领、
 *                          一课里叫法重名、标了页眉页脚、答案引的作答区不在;不挡用的(块叠得多)是提醒
 *   preview <目录>         把分块叠在页图上出 p078.preview.png:块一层一色(外到里 红、紫、粉、棕)、作答区橙、没人认领的候选红粗框;字不画,对着 json 看
 *   push <目录>            check 干净才写进 vault 的 教材/.zones/<指纹>/(一课的页一起写,book.json 记 agent);写之前把作答区的框吸到候选上、字行吸到文字层的行上
 * 编程助手不直接写 vault;课本 PDF、agents/、cotutor.json 都不动。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { bookIndex, bookFile, listBooks } from '../../memory/textbook-pdf.ts';
import { linePermille } from '../../memory/textbook-zones-rules.ts';
import { bookZones, vaultZonesDir, writeZonePages } from '../../memory/textbook-zones.ts';
import { ZonePageSchema, bookChrome, pickZones, walkZones, zoneFile, zoneKey, zonePageProblems, type BookIndex, type BookLesson, type BookPage, type BookZones, type PermilleBox, type Workspace, type Zone, type ZonePage, type ZoneRegion } from '../../schema/index.ts';
import { decodePng, encodePng } from '../../ui/shared/png.ts';
import { UsageError, loadWorkspace, redactDeep, redactHome } from '../workspace.ts';

const CACHE = join('.cotutor', 'textbooks');
const WORK = join('.cotutor', 'zones-work');
const PULL = 'pull.json';
/** 候选和作答区、字行算对上:重合(交 / 并)到这么多 */
const SNAP = 0.5;

interface Book { file: string; index: BookIndex; zones: BookZones }

/** 取出来的那一份记着什么 */
export interface PullMeta { file: string; sha: string; title: string; layout: BookIndex['layout']; lessons: { title: string; pages: [number, number] }[]; pages: number[] }

/** 一页的候选:文字层的行(L0…)、能写的格(id 同规则出的作答区:这一页第几格)、表格(T0…) */
export interface Candidates {
  page: number;
  printed: number | null;
  lines: { id: string; text: string; box: PermilleBox; chrome?: true }[];
  cells: { id: string; kind: string; box: PermilleBox; ch?: string; m?: string; row?: number; col?: number; table?: string }[];
  tables: { id: string; box: PermilleBox }[];
}

const iou = (a: readonly number[], b: readonly number[]): number => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return a.every((v, k) => Math.abs(v - b[k]) <= 0.2) ? 1 : 0;
  const i = w * h;
  return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i);
};

/** 一册:名字是文件名或文件名里的一段(「数学」「语文二年级上册」);对不上、对上好几本都说清楚 */
async function openBook(ws: Workspace, name: string): Promise<Book> {
  const names = await listBooks(ws.paths.textbooks, null);
  if (!names.length) throw new UsageError(`${redactHome(ws.paths.textbooks)} 里没有课本 PDF`);
  const hit = names.includes(name) ? [name] : names.filter((n) => n.includes(name));
  if (hit.length !== 1) throw new UsageError(hit.length ? `「${name}」对上好几本:${hit.join('、')},写全一点` : `教材里没有名字带「${name}」的课本(有:${names.join('、')})`);
  const cache = join(ws.root, CACHE);
  const index = await bookIndex(ws.paths.textbooks, cache, hit[0]);
  if (!index) throw new UsageError(`课本《${hit[0]}》读不出来`);
  return { file: hit[0], index, zones: await bookZones(ws.paths.textbooks, cache, index) };
}

/** 页 n 落在目录上最里一层的哪一课(页码范围最小的那个);目录页、封面这种不在课里的 = null */
function leafOf(index: BookIndex, n: number): BookLesson | null {
  return index.lessons.filter((l) => n >= l.pages[0] && n <= l.pages[1]).sort((a, b) => a.pages[1] - a.pages[0] - (b.pages[1] - b.pages[0]))[0] ?? null;
}

/** 这几页按课取全:每页所在的那一课的页都带上 */
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

/** 一页的候选(从索引现取,和规则出分块看的是同一份) */
export function candidatesOf(p: BookPage): Candidates {
  return {
    page: p.n,
    printed: p.printed,
    lines: p.lines.map((l, i) => ({ id: `L${i}`, text: l.text, box: linePermille(p, l), ...(bookChrome(p, l) ? { chrome: true as const } : {}) })),
    cells: (p.cells ?? []).map((c, i) => ({ id: String(i), kind: c.kind, box: linePermille(p, c), ...(c.ch ? { ch: c.ch } : {}), ...(c.m ? { m: c.m } : {}), ...(c.r !== undefined ? { row: c.r + 1, col: (c.c ?? 0) + 1 } : {}), ...(c.t !== undefined ? { table: `T${c.t}` } : {}) })),
    tables: (p.tables ?? []).map((t, k) => ({ id: `T${k}`, box: linePermille(p, { x1: t[0], y1: t[1], x2: t[2], y2: t[3] }) })),
  };
}

/** 孩子要动手的候选(范字不算:那是照着写的字) */
const WRITABLE = new Set(['trace', 'empty', 'blank', 'table', 'tick']);

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

const pageRange = (v: string): number[] => {
  const m = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(v.trim());
  if (!m) throw new UsageError(`--pages 写成 PDF 的页,如 78 或 76-83(写的是「${v}」)`);
  const a = Number(m[1]), b = Number(m[2] ?? m[1]);
  if (b < a || b - a > 60) throw new UsageError('--pages 一次最多 60 页,从小到大');
  return Array.from({ length: b - a + 1 }, (_, k) => a + k);
};

// ——— list ———

export async function listCommand(ws: Workspace, name?: string): Promise<{ books: { file: string; sha: string; layout: string; pages: number; vaultPages: number; lessons: { title: string; printed: [number, number]; pages: [number, number]; zones: 'vault' | 'rules'; depth: number }[] }[] }> {
  const files = name ? [(await openBook(ws, name)).file] : await listBooks(ws.paths.textbooks, null);
  const out = [];
  for (const f of files) {
    const b = await openBook(ws, f);
    const depth = (l: BookLesson): number => (l.parent ? 1 + depth(b.index.lessons.find((x) => x.title === l.parent) ?? { ...l, parent: undefined }) : 0);
    out.push({
      file: b.file, sha: b.index.sha, layout: b.index.layout, pages: b.index.pages.length, vaultPages: Object.keys(b.zones.vault).length,
      lessons: b.index.lessons.map((l) => {
        const ns = Array.from({ length: l.pages[1] - l.pages[0] + 1 }, (_, k) => l.pages[0] + k);
        return { title: l.title, printed: [l.from, l.to] as [number, number], pages: l.pages, zones: pickZones(b.zones, ns).which, depth: depth(l) };
      }),
    });
  }
  return { books: out };
}

// ——— pull ———

export async function pullCommand(ws: Workspace, name: string, opts: { pages?: string; lesson?: string; out?: string }): Promise<{ dir: string; meta: PullMeta; images: number; noImages: boolean }> {
  const b = await openBook(ws, name);
  let want: number[] = [];
  if (opts.pages) want = pageRange(opts.pages);
  else if (opts.lesson) {
    const l = b.index.lessons.find((x) => x.title === opts.lesson) ?? b.index.lessons.find((x) => x.title.includes(opts.lesson!));
    if (!l) throw new UsageError(`《${b.file}》里没有「${opts.lesson}」这一课(cotutor textbook list ${name} 看有哪些)`);
    want = Array.from({ length: l.pages[1] - l.pages[0] + 1 }, (_, k) => l.pages[0] + k);
  } else throw new UsageError('要 --pages <PDF 页> 或 --lesson <课名>');
  const got = wholeLessons(b.index, want);
  if (!got.pages.length) throw new UsageError(`《${b.file}》没有这几页(一共 ${b.index.pages.length} 页)`);
  const dir = resolve(ws.root, opts.out ?? join(WORK, `${b.index.title}-p${got.pages[0]}-${got.pages[got.pages.length - 1]}`));
  const old = await readFile(join(dir, PULL), 'utf8').then((s) => JSON.parse(s) as PullMeta, () => null);
  if (old && old.sha !== b.index.sha) throw new UsageError(`${redactHome(dir)} 是另一本课本取出来的,换个 --out`);
  if (!old && (await readdir(dir).catch(() => [] as string[])).length) throw new UsageError(`${redactHome(dir)} 不是空的,换个 --out`);
  await mkdir(dir, { recursive: true });
  const meta: PullMeta = { file: b.file, sha: b.index.sha, title: b.index.title, layout: b.index.layout, lessons: got.lessons, pages: got.pages };
  // 草稿:一课挑一份(同运行时);不在课里的页单页挑
  const draft = new Map<number, ZonePage>();
  for (const l of got.lessons) {
    const ns = got.pages.filter((n) => n >= l.pages[0] && n <= l.pages[1]);
    for (const z of pickZones(b.zones, ns).pages) draft.set(z.page, z);
  }
  for (const n of got.pages) if (!draft.has(n)) { const z = pickZones(b.zones, [n]).pages[0]; if (z) draft.set(n, z); }
  const pdf = await bookFile(ws.paths.textbooks, b.file);
  let images = 0, noImages = false;
  for (const n of got.pages) {
    const p = b.index.pages.find((x) => x.n === n)!;
    await writeFile(join(dir, zoneFile(n)), `${JSON.stringify(draft.get(n) ?? { page: n, zones: [] }, null, 1)}\n`);
    await writeFile(join(dir, `${zoneKey(n)}.candidates.json`), `${JSON.stringify(candidatesOf(p), null, 1)}\n`);
    const png = join(dir, `${zoneKey(n)}.png`);
    if (existsSync(png)) { images++; continue; }
    if (!noImages && pdf && renderPage(pdf, n, png)) images++;
    else noImages = true;
  }
  await writeFile(join(dir, PULL), `${JSON.stringify(meta, null, 1)}\n`);
  return { dir, meta, images, noImages };
}

// ——— check ———

export interface ZoneDirCheck { dir: string; book?: string; pages: number; zones: number; regions: number; problems: string[]; notes: string[] }

async function readDir(ws: Workspace, dir: string): Promise<{ meta: PullMeta; book: Book; pages: Map<number, unknown> } | string> {
  const meta = await readFile(join(dir, PULL), 'utf8').then((s) => JSON.parse(s) as PullMeta, () => null);
  if (!meta) return `${redactHome(dir)} 里没有 ${PULL}:不是 cotutor textbook pull 取出来的目录`;
  const book = await openBook(ws, meta.file).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  if (typeof book === 'string') return book;
  if (book.index.sha !== meta.sha) return `课本《${meta.file}》换过了(指纹 ${book.index.sha},取的时候是 ${meta.sha}),重新 pull`;
  const pages = new Map<number, unknown>();
  for (const n of meta.pages) pages.set(n, await readFile(join(dir, zoneFile(n)), 'utf8').then((s) => JSON.parse(s) as unknown, (e: unknown) => ({ __bad: e instanceof SyntaxError ? `不是 JSON:${e.message}` : '不在' })));
  return { meta, book, pages };
}

/** 一页的问题:这一页的候选、索引的页对着查 */
function pageProblems(zp: ZonePage, p: BookPage, at: string): { problems: string[]; notes: string[] } {
  const problems: string[] = [], notes: string[] = [];
  const cand = candidatesOf(p);
  const byId = new Map(cand.cells.map((c) => [c.id, c]));
  const regions: { r: ZoneRegion; where: string }[] = [];
  walkZones(zp.zones, (z) => { for (const r of z.regions ?? []) regions.push({ r, where: `「${z.label}」` }); });
  for (const r of zp.regions ?? []) regions.push({ r, where: '页上' });
  for (const { r, where } of regions) {
    if (r.kind !== 'write' && r.kind !== 'tick') continue;
    const c = byId.get(r.id);
    if (c) { if (iou(c.box, r.box) < SNAP) problems.push(`${at}${where}的作答区 ${r.id}「${r.label}」:框和候选 ${r.id} 对不上(id 写候选的编号,框就照候选的)`); continue; }
    const near = cand.cells.find((x) => iou(x.box, r.box) >= SNAP);
    if (near) problems.push(`${at}${where}的作答区「${r.label}」就是候选 ${near.id}:id 写 ${near.id}(孩子写过的字照 id 存)`);
    else if (r.src !== 'measured') problems.push(`${at}${where}的作答区「${r.label}」:框不在候选里;照候选写,或者写脚本量好了加 "src": "measured"`);
  }
  const ignore = new Set(zp.ignore ?? []);
  for (const c of cand.cells) {
    if (!WRITABLE.has(c.kind) || ignore.has(c.id) || regions.some(({ r }) => r.id === c.id || iou(r.box, c.box) >= SNAP)) continue;
    problems.push(`${at}候选 ${c.id}(${c.kind}${c.table ? `,${c.table} 第 ${c.row} 行第 ${c.col} 格` : ''})没有作答区认领:漏了就补上;不是孩子要写的,把 "${c.id}" 写进这一页的 ignore`);
  }
  // 字行:每一行要对得上文字层的一行;一块的行全是页眉页脚的,是标了不该标的
  walkZones(zp.zones, (z) => {
    const hits = (z.rows ?? []).map((row) => cand.lines.find((l) => iou(l.box, row) >= SNAP));
    hits.forEach((h, k) => { if (!h) problems.push(`${at}「${z.label}」第 ${k + 1} 行 [${z.rows![k].join(', ')}]:对不上文字层的行(照候选的 L… 的框写)`); });
    if (hits.length && hits.every((h) => h?.chrome)) problems.push(`${at}「${z.label}」:标的是页眉页脚(社标、页码、「仅供个人学习使用」不标)`);
  });
  // 一层里的块叠得太多:多半框画大了
  const sibs = (zs: readonly Zone[]): void => {
    zs.forEach((a, i) => zs.slice(i + 1).forEach((b) => { if (iou(a.box, b.box) > 0.5) notes.push(`${at}「${a.label}」和「${b.label}」叠了一大半`); }));
    for (const z of zs) if (z.children) sibs(z.children);
  };
  sibs(zp.zones);
  return { problems, notes };
}

export async function checkZoneDir(ws: Workspace, dir: string): Promise<ZoneDirCheck & { parsed?: Map<number, ZonePage>; meta?: PullMeta; bookOf?: Book }> {
  const out: ZoneDirCheck = { dir, pages: 0, zones: 0, regions: 0, problems: [], notes: [] };
  const got = await readDir(ws, dir);
  if (typeof got === 'string') return { ...out, problems: [got] };
  out.book = got.meta.file;
  const parsed = new Map<number, ZonePage>();
  for (const [n, raw] of got.pages) {
    const at = `第 ${n} 页`;
    if (raw && typeof raw === 'object' && '__bad' in raw) { out.problems.push(`${at}:${zoneFile(n)} ${(raw as { __bad: string }).__bad}`); continue; }
    const r = ZonePageSchema.safeParse(raw);
    if (!r.success) { out.problems.push(...r.error.issues.map((i) => `${at}:${i.path.map(String).join('.') || '(整页)'} ${i.message}`)); continue; }
    if (r.data.page !== n) { out.problems.push(`${at}:${zoneFile(n)} 里写的 page 是 ${r.data.page}`); continue; }
    parsed.set(n, r.data);
    out.pages++;
    out.regions += r.data.regions?.length ?? 0;
    walkZones(r.data.zones, (z) => { out.zones++; out.regions += z.regions?.length ?? 0; });
    out.problems.push(...zonePageProblems(r.data));
    const pp = pageProblems(r.data, got.book.index.pages.find((p) => p.n === n)!, `${at}`);
    out.problems.push(...pp.problems);
    out.notes.push(...pp.notes);
  }
  // 一课里叫法不重名(跨页的同一块 id 一样不算):老师 [[看 …]] 照叫法找
  for (const l of got.meta.lessons) {
    const names = new Map<string, Set<string>>();
    for (const [n, zp] of parsed) if (n >= l.pages[0] && n <= l.pages[1]) walkZones(zp.zones, (z) => { names.set(z.label, (names.get(z.label) ?? new Set()).add(z.id)); });
    for (const [label, ids] of names) if (ids.size > 1) out.problems.push(`《${l.title}》里有 ${ids.size} 块都叫「${label}」(${[...ids].join('、')}):老师说「看 ${label}」会找错,改成书上的号或从上往下数`);
  }
  return { ...out, parsed, meta: got.meta, bookOf: got.book };
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

export async function previewZoneDir(ws: Workspace, dir: string): Promise<{ files: string[]; missing: number[]; check: ZoneDirCheck }> {
  const c = await checkZoneDir(ws, dir);
  const files: string[] = [], missing: number[] = [];
  for (const [n, zp] of c.parsed ?? new Map<number, ZonePage>()) {
    const buf = await readFile(join(dir, `${zoneKey(n)}.png`)).catch(() => null);
    const img = buf ? decodePng(buf) : null;
    if (!img) { missing.push(n); continue; }
    const p = c.bookOf!.index.pages.find((x) => x.n === n)!;
    const cand = candidatesOf(p);
    const regions: ZoneRegion[] = [...(zp.regions ?? [])];
    walkZones(zp.zones, (z, depth) => { drawBox(img, z.box, COLORS[Math.min(depth, COLORS.length - 1)], 4); regions.push(...(z.regions ?? [])); });
    for (const r of regions) drawBox(img, r.box, ORANGE, 3);
    const ignore = new Set(zp.ignore ?? []);
    for (const x of cand.cells) if (WRITABLE.has(x.kind) && !ignore.has(x.id) && !regions.some((r) => r.id === x.id || iou(r.box, x.box) >= SNAP)) drawBox(img, x.box, RED, 7);
    const file = join(dir, `${zoneKey(n)}.preview.png`);
    await writeFile(file, encodePng(img.w, img.px, 3, img.h));
    files.push(file);
  }
  return { files, missing, check: c };
}

// ——— push ———

/** 吸到候选上:作答区的 id 是候选编号的换成候选的框,字行换成重合最多的那一行的框 */
function snap(zp: ZonePage, p: BookPage): ZonePage {
  const cand = candidatesOf(p);
  const cells = new Map(cand.cells.map((c) => [c.id, c]));
  const region = (r: ZoneRegion): ZoneRegion => { const c = cells.get(r.id); return c && iou(c.box, r.box) >= SNAP ? { ...r, box: c.box } : r; };
  const zone = (z: Zone): Zone => ({
    ...z,
    ...(z.rows ? { rows: z.rows.map((row) => { const l = cand.lines.map((x) => ({ x, s: iou(x.box, row) })).sort((a, b) => b.s - a.s)[0]; return l && l.s >= SNAP ? l.x.box : row; }) } : {}),
    ...(z.regions ? { regions: z.regions.map(region) } : {}),
    ...(z.children ? { children: z.children.map(zone) } : {}),
  });
  return { ...zp, zones: zp.zones.map(zone), ...(zp.regions ? { regions: zp.regions.map(region) } : {}) };
}

export async function pushZoneDir(ws: Workspace, dir: string, now = new Date()): Promise<{ check: ZoneDirCheck; wrote: number; to?: string; lessons: string[] }> {
  const c = await checkZoneDir(ws, dir);
  if (c.problems.length || !c.parsed || !c.meta || !c.bookOf) return { check: c, wrote: 0, lessons: [] };
  const missing = c.meta.pages.filter((n) => !c.parsed!.has(n));
  if (missing.length) return { check: { ...c, problems: [`第 ${missing.join('、')} 页没有分块文件:一课的页要一起写`] }, wrote: 0, lessons: [] };
  const to = vaultZonesDir(ws.paths.textbooks, c.meta.sha);
  const pages = c.meta.pages.map((n) => snap(c.parsed!.get(n)!, c.bookOf!.index.pages.find((p) => p.n === n)!));
  await writeZonePages(to, { title: c.meta.title, sha: c.meta.sha }, pages, 'agent', now);
  return { check: c, wrote: pages.length, to, lessons: c.meta.lessons.map((l) => l.title) };
}

// ——— 命令行 ———

export async function textbookCommand(positionals: readonly string[], flags: Record<string, string | true>, o: { workspace?: string; json: boolean }): Promise<void> {
  const [sub, arg] = positionals;
  const ws = loadWorkspace(o.workspace);
  const say = (s: string): void => { process.stdout.write(`${s}\n`); };
  const dirOf = (): string => { if (!arg) throw new UsageError(`textbook ${sub} 要 pull 出来的目录`); return resolve(arg); };
  if (sub === 'list') {
    const r = await listCommand(ws, arg);
    if (o.json) { say(JSON.stringify(redactDeep(r), null, 2)); return; }
    for (const b of r.books) {
      say(`《${b.file}》 ${b.layout},${b.pages} 页,指纹 ${b.sha}${b.vaultPages ? `,vault 里改好的 ${b.vaultPages} 页` : ''}`);
      for (const l of b.lessons) say(`  ${'  '.repeat(l.depth)}${l.title}  印 ${l.printed[0]}–${l.printed[1]} 页 = PDF ${l.pages[0]}–${l.pages[1]}${l.zones === 'vault' ? '  [vault 里改好的]' : ''}`);
    }
    return;
  }
  if (sub === 'pull') {
    if (!arg) throw new UsageError('textbook pull 要课本的名字(文件名里的一段,如 数学)');
    const r = await pullCommand(ws, arg, { pages: typeof flags.pages === 'string' ? flags.pages : undefined, lesson: typeof flags.lesson === 'string' ? flags.lesson : undefined, out: typeof flags.out === 'string' ? flags.out : undefined });
    if (o.json) { say(JSON.stringify(redactDeep({ ok: true, ...r }), null, 2)); return; }
    say(`取到 ${redactHome(r.dir)}:《${r.meta.file}》${r.meta.lessons.map((l) => `《${l.title}》`).join('')} PDF 第 ${r.meta.pages.join('、')} 页`);
    say(`  每页:${zoneFile(r.meta.pages[0])}(草稿,改它)、${zoneKey(r.meta.pages[0])}.candidates.json(候选)、${zoneKey(r.meta.pages[0])}.png(页图,${r.images}/${r.meta.pages.length} 张)`);
    if (r.noImages) say('  有的页图没出来:要 poppler 的 pdftoppm 或 python3 的 PyMuPDF(装之前问家长),或者自己把 PDF 那几页按 200dpi、照裁切框出成 p078.png');
    return;
  }
  if (sub === 'check' || sub === 'preview') {
    const dir = dirOf();
    const r = sub === 'check' ? { check: await checkZoneDir(ws, dir), files: [] as string[], missing: [] as number[] } : await previewZoneDir(ws, dir);
    const { parsed: _p, meta: _m, bookOf: _b, ...c } = r.check as ZoneDirCheck & { parsed?: unknown; meta?: unknown; bookOf?: unknown };
    if (o.json) say(JSON.stringify(redactDeep({ ok: !c.problems.length, ...c, ...(sub === 'preview' ? { files: r.files, missing: r.missing } : {}) }), null, 2));
    else {
      say(`${c.problems.length ? '✗' : '✓'} ${redactHome(dir)}${c.book ? `  《${c.book}》${c.pages} 页 ${c.zones} 块 ${c.regions} 个作答区` : ''}`);
      for (const p of c.problems) say(`    要改:${p}`);
      for (const p of c.notes) say(`    提醒:${p}`);
      for (const f of r.files) say(`    预览:${redactHome(f)}`);
      if (r.missing.length) say(`    第 ${r.missing.join('、')} 页没有页图(${zoneKey(r.missing[0])}.png),出不了预览`);
      say(c.problems.length ? `有 ${c.problems.length} 条要改` : '都对得上');
    }
    if (c.problems.length) process.exitCode = 1;
    return;
  }
  if (sub === 'push') {
    const r = await pushZoneDir(ws, dirOf());
    const { parsed: _p, meta: _m, bookOf: _b, ...c } = r.check as ZoneDirCheck & { parsed?: unknown; meta?: unknown; bookOf?: unknown };
    if (o.json) say(JSON.stringify(redactDeep({ ok: r.wrote > 0, wrote: r.wrote, to: r.to, lessons: r.lessons, problems: c.problems }), null, 2));
    else if (!r.wrote) { say(`✗ 没写:有 ${c.problems.length} 条要改(cotutor textbook check 看全)`); for (const p of c.problems.slice(0, 20)) say(`    要改:${p}`); }
    else say(`✓ 写进 ${redactHome(r.to!)}:${r.wrote} 页,${r.lessons.map((l) => `《${l}》`).join('')}从下一轮起用这一份`);
    if (!r.wrote) process.exitCode = 1;
    return;
  }
  throw new UsageError(`textbook 的子命令是 list、pull、check、preview、push`);
}

