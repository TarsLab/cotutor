/**
 * 浏览器里的 pdf.js:怎么装、怎么开一本课本(舞台 book.tsx 铺课本用),和首页课本那张卡的封面(bookCover)。
 * 也是舞台包的第二个入口 dist/stage/cover.js(scripts/build-stage.mjs):孩子端首页(家长端首页里的预览也是这个页面)
 * 见这一册还没有封面就 import 它画第 1 页交上来,不开整个舞台(不带 React、excalidraw)。
 * 服务端画不了:只读文字层,课本第 1 页是几张图、几百条路径和字拼起来的(2026-11-24 看过人教版语文、数学二上),抠不出一张现成的图。
 * pdf.js 不打进来:build:stage 原样拷到 dist/stage/pdf/,用到才 import。
 */
import type * as Pdfjs from 'pdfjs-dist';

export type Lib = typeof Pdfjs;
export const PDF_BASE = '/stage/pdf/';
/** 课本 PDF 的地址(Range 由服务端的 sendFile 管) */
const bookPdfUrl = (book: string): string => `/api/kid/textbook/pdf?b=${encodeURIComponent(book)}`;

let libP: Promise<Lib> | null = null;
/** pdf.js:用到才取 */
export function loadLib(): Promise<Lib> {
  libP ??= (async () => {
    const url = `${PDF_BASE}pdf.min.mjs`;
    const lib = (await import(/* @vite-ignore */ url)) as Lib;
    lib.GlobalWorkerOptions.workerSrc = `${PDF_BASE}pdf.worker.min.mjs`;
    return lib;
  })();
  libP.catch(() => { libP = null; });
  return libP;
}

/** 开一本 PDF 的那一趟(关掉它 = 关掉这本):分段取,只拉要画的那几页 */
async function pdfTask(url: string): Promise<Pdfjs.PDFDocumentLoadingTask> {
  const lib = await loadLib();
  return lib.getDocument({ url, cMapUrl: `${PDF_BASE}cmaps/`, cMapPacked: true, standardFontDataUrl: `${PDF_BASE}standard_fonts/`, rangeChunkSize: 1 << 16, disableAutoFetch: true, disableStream: true });
}

/** 开一本 PDF(舞台开着就一直留着) */
export async function openPdf(url: string): Promise<Pdfjs.PDFDocumentProxy> {
  return (await pdfTask(url)).promise;
}

/** 封面的长边(首页的卡一两百像素宽,按 2 倍屏;服务端收的上限在 src/memory/textbook-cover.ts) */
const COVER_SIDE = 480;

/**
 * 首页课本那张卡的封面:这一册 PDF 的第 1 页,长边 side 的 jpeg(白底);画不出 = null。画完就关掉这本(首页不留着它)。
 * 第 1 页横着的(宽过高的 1.2 倍)是封底连封面摊开的一张,只画右半边的封面:广东版科学二上(印厂的骑马钉 PDF)第 1 页正好两页宽,书脊不占宽(2026-11-24 量过)
 */
export async function bookCover(book: string, side = COVER_SIDE): Promise<string | null> {
  let task: Pdfjs.PDFDocumentLoadingTask | null = null;
  try {
    task = await pdfTask(bookPdfUrl(book));
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const vp0 = page.getViewport({ scale: 1 });
    const spread = vp0.width > vp0.height * 1.2;
    const w0 = spread ? vp0.width / 2 : vp0.width;
    const scale = side / Math.max(w0, vp0.height);
    const vp = page.getViewport({ scale, ...(spread ? { offsetX: -vp0.width / 2 * scale } : {}) });
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w0 * scale));
    cv.height = Math.max(1, Math.round(vp.height));
    await page.render({ canvas: cv, viewport: vp, background: '#ffffff', annotationMode: 0 }).promise;
    return cv.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  } finally {
    void task?.destroy().catch(() => {});
  }
}
