/**
 * 课本 PDF:vault 的 `教材/` 下家长放的教材 PDF(从国家中小学智慧教育平台这类网站下的,个人学习用)。
 * 这里只读:列出这位老师学科的册子、挑这学期的那一册、读 PDF 的文字层做成索引(textbook-index.ts)存进 `.cotutor/textbooks/<指纹>.json`。
 * 索引能重新生成(不进备份);PDF 换了(指纹变了)就重做。整本 126 页读一遍约 2 秒,只在第一次用到时读。
 *
 * pdf.js 不是运行时依赖(装 cotutor 不多带 35 MB):打包时把它的几个压缩文件拷进 dist/stage/pdf/(scripts/build-stage.mjs),
 * 服务端和舞台用同一份;仓库里直跑时退回 node_modules 里的 pdfjs-dist(devDependencies)。
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOK_INDEX_VERSION, type BookIndex, type PdfItem, type PdfPage } from '../schema/index.ts';
import { opsCells } from './textbook-cells.ts';
import { buildBookIndex } from './textbook-index.ts';

/** 册子的文件名:不带路径分隔、不以点开头、是 .pdf */
const SAFE = /^[^/\\.][^/\\]{0,160}\.pdf$/i;

/** 教材目录下的 PDF;subject 给了就只要文件名里带这个学科的(「语文二年级上册-人教统编版.pdf」) */
export async function listBooks(dir: string, subject: string | null): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter((n) => SAFE.test(n) && (!subject || n.includes(subject))).sort();
}

/** 这学期的那一册:2–7 月是下册,其余是上册;文件名里没写上下册的、或只有一册,取第一册 */
export function pickBook(names: readonly string[], now: Date): string | null {
  if (!names.length) return null;
  const half = now.getMonth() + 1 >= 2 && now.getMonth() + 1 <= 7 ? '下册' : '上册';
  return names.find((n) => n.includes(half)) ?? names[0];
}

/** 一册的文件路径;名字不对、不在 = null */
export async function bookFile(dir: string, name: string): Promise<string | null> {
  if (!SAFE.test(name)) return null;
  const p = join(dir, name);
  return (await stat(p).catch(() => null))?.isFile() ? p : null;
}

type Pdfjs = typeof import('pdfjs-dist');
let pdfjs: Promise<Pdfjs> | null = null;

/** pdf.js:先找打包好的(dist/stage/pdf/;npm 包里这个文件在 dist/memory/,仓库里在 src/memory/),没有再找 node_modules */
export function loadPdfjs(): Promise<Pdfjs> {
  pdfjs ??= (async () => {
    // 载入时 pdf.js 想给画图补 DOMMatrix、Path2D(要 @napi-rs/canvas,没装),打几行 Warning:只取文字用不上,别混进服务的日志
    const log = console.log, warn = console.warn;
    const quiet = (f: typeof console.log) => (...a: unknown[]) => { if (!(typeof a[0] === 'string' && a[0].startsWith('Warning: Cannot'))) f(...a); };
    console.log = quiet(log); console.warn = quiet(warn);
    try {
      for (const rel of ['../stage/pdf/', '../../dist/stage/pdf/']) {
        const dir = new URL(rel, import.meta.url);
        if (!existsSync(fileURLToPath(new URL('pdf.min.mjs', dir)))) continue;
        const lib = (await import(new URL('pdf.min.mjs', dir).href)) as Pdfjs;
        // Node 里是假 worker:照这个地址在本进程里 import(不写它就去找不带 .min 的 pdf.worker.mjs,没拷)
        lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', dir).href;
        return lib;
      }
      const spec = 'pdfjs-dist/legacy/build/pdf.min.mjs';
      return (await import(spec)) as Pdfjs;
    } finally {
      console.log = log; console.warn = warn;
    }
  })();
  pdfjs.catch(() => { pdfjs = null; });
  return pdfjs;
}

/**
 * 读 PDF 每一页的文字(PdfItem:基线从页顶量)和页上画的田字格、填空、表格、小方框(./textbook-cells.ts;画图的指令读不出就当没有)。
 * 读画图的指令时不解页上的图(maxImageSize: 1,pdf.js 把图都跳过):要解的话广东版科学二上 163 张高清 CMYK 的 JPEG 读一遍 20 秒,跳过 0.5 秒,
 * 人教数学二上 3.4 秒 → 1.3 秒(2026-11-25 量的);只要线和字,用不着图。cells: false 只读文字(字体就只有 pdf.js 的编号)
 */
export async function readPdfPages(data: Uint8Array, opts: { cells?: boolean } = {}): Promise<PdfPage[]> {
  const lib = await loadPdfjs();
  // fontExtraProperties:字体对象带上真名(FZKTRJK--GBK1-0),不然只有 pdf.js 一页一页起的编号(g_d0_f17,同一种字换一页换个名)
  const task = lib.getDocument({ data, disableFontFace: true, verbosity: 0, maxImageSize: 1, fontExtraProperties: true });
  const doc = await task.promise;
  try {
    const out: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      // 先读画图的指令:字体是这时候载进 commonObjs 的,后面取文字才认得出真名
      let got: ReturnType<typeof opsCells> = { cells: [], boxes: [], tables: [], squares: [], formulaShapes: [], marks: [] };
      if (opts.cells !== false) try { got = opsCells(await page.getOperatorList({ annotationMode: 0 }), lib.OPS as unknown as Record<string, number>, vp.transform); } catch { /* 画图的指令读不出:没有格子 */ }
      const tc = await page.getTextContent();
      const fonts = new Map<string, string>();
      const font = (id: string): string => {
        if (!fonts.has(id)) {
          let name = id;
          try { if (page.commonObjs.has(id)) name = String((page.commonObjs.get(id) as { name?: string }).name || id).replace(/^[A-Z]{6}\+/, ''); } catch { /* 没载进来:用编号 */ }
          fonts.set(id, name);
        }
        return fonts.get(id)!;
      };
      const items: PdfItem[] = [];
      for (const it of tc.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const [a, b, , , e, f] = it.transform as number[];
        // 换到页面左上角起的坐标要经视口:页面框的原点不一定是 (0,0)(人教的 PDF 是 (8.5, 8.5),只用页高翻 y 时字的框整体偏右上 8.5pt)
        const [x, y] = vp.convertToViewportPoint(e, f);
        items.push({ s: it.str, f: font(it.fontName), x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(Math.hypot(a, b) * 100) / 100, w: Math.round(it.width * 100) / 100 });
      }
      out.push({ n, w: vp.width, h: vp.height, items, ...(got.cells.length ? { cells: got.cells } : {}), ...(got.boxes.length ? { boxes: got.boxes } : {}), ...(got.tables.length ? { tables: got.tables } : {}), ...(got.squares.length ? { squares: got.squares } : {}), ...(got.formulaShapes.length ? { formulaShapes: got.formulaShapes } : {}), ...(got.marks.length ? { marks: got.marks } : {}) });
      page.cleanup();
    }
    return out;
  } finally {
    await task.destroy();
  }
}

/** 同一个文件(路径 + 大小 + 改动时间)这个进程里只读一次 */
const memo = new Map<string, Promise<BookIndex | null>>();

/**
 * 一册的索引:缓存里有、版本对、指纹对就用;不然读 PDF 现做,写进缓存。文件不在 = null;PDF 读不了抛(调用的那层给家长说一句)。
 * cacheDir = `<workspace>/.cotutor/textbooks`
 */
export async function bookIndex(dir: string, cacheDir: string, name: string): Promise<BookIndex | null> {
  const file = await bookFile(dir, name);
  if (!file) return null;
  const st = await stat(file);
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  let hit = memo.get(key);
  if (!hit) {
    hit = (async () => {
      const data = await readFile(file);
      const sha = createHash('sha1').update(data).digest('hex').slice(0, 16);
      const cache = join(cacheDir, `${sha}.json`);
      const old = await readFile(cache, 'utf8').then((s) => JSON.parse(s) as BookIndex).catch(() => null);
      if (old && old.v === BOOK_INDEX_VERSION && old.sha === sha) return { ...old, file: name };
      const title = name.replace(/\.pdf$/i, '');
      const index = buildBookIndex(await readPdfPages(new Uint8Array(data)), { file: name, sha, title });
      await mkdir(cacheDir, { recursive: true });
      const tmp = `${cache}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(index));
      await rename(tmp, cache);
      return index;
    })();
    memo.set(key, hit);
    hit.catch(() => memo.delete(key));
  }
  return hit;
}

/** 测试用:清掉进程里记着的 */
export function forgetBooks(): void {
  memo.clear();
}
