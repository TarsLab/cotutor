/**
 * 课本做底的舞台(画法「课本」,src/chalk/kit/book.ts;2026-11-14《语文预习:PDF 课本与镜头交互》)。
 * 一课的几页从上往下连成一条(场景坐标:一页宽 1000),屏幕是看它的一扇窗:
 *  - 窗只有两种大小(2026-11-15):页宽铺满、两倍,双击切换;不两指缩放、不滚轮缩放。页宽时手指只上下滚,两倍时上下左右都能挪,松手带惯性。
 *  - 老师的卡写了「看」:窗滚到那一块(大小不变,近的滑过去,远的直接到),那一块亮一下;没写就不动——他眼前的就是老师要讲的。
 *  - 只读(录像、家长看)照记录的窗摆:以前孩子缩放过的窗照样放得下(camFor)。
 *  - Apple Pencil(pointerType = pen)写画,手指永远不落笔;笔在纸上时别的手指(手掌)不算。
 *  - 轻点(手指或笔;手指的等一下看是不是双击)一个字:本地照课本的行和字算出是哪个字(bookPick),告诉页面(pick)弹田字格;点在盖住的拼音上就揭开(reveal)。
 *  - 孩子挪完、切完大小停下来:把窗(场景坐标)告诉页面(view),页面报给服务端说成一句「第 55 页:第 7 段」给老师。
 * 画面:pdf.js(/stage/pdf/,不打进 stage.js)现画。每页先画一张中等清晰度的(移动、缩放时用它),停下来再把窗里那一块照屏幕的像素重画一张盖上去,放大了字也清楚。
 * 老师的记号(圈、盖拼音的块)和孩子的笔画是一层 SVG,和页面在同一个随窗变换的容器里,所以对得齐;孩子的笔画挂在书页上,老师下一张卡还是这一课就还在。
 * 类名带 bk-(舞台页也装孩子端的 theme.css);工具列用 kit.tsx 的 kt- 那几个,样子一样。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type * as Pdfjs from 'pdfjs-dist';
import { BOOK_ASPECT, BOOK_W, KID_INK, KID_INK_WIDTH, KIT_MARK_MAX, KIT_MARK_POINTS, bookPages, bookPick, bookSheets, bookSpots, kitOf, kitOps, kitParams, type BookSheet, type KitState } from '../../chalk/index.ts';
import type { BookPage } from '../../schema/index.ts';
import type { KitStageHandle, KitStageProps } from './kit.tsx';

export interface BookStageProps extends KitStageProps {
  /** 孩子挪完窗停下来的地方(场景坐标 [左, 上, 右, 下]) */
  onView?(box: [number, number, number, number]): void;
  /** 窗停下来以后(老师移完、孩子挪完、落了笔、刚铺好)窗里那一块的图(jpeg data URL):老师下一轮看得见孩子眼前的课本 */
  onShot?(box: [number, number, number, number], image: string): void;
}

type Lib = typeof Pdfjs;
type Box = [number, number, number, number];
const SVG_NS = 'http://www.w3.org/2000/svg';
const PDF_BASE = '/stage/pdf/';
const RED = '#e03131';
const PAPER = '#f4f1ea';
/** 动了多少像素以内算轻点 */
const TAP_PX = 10;
/** 停下来多久才算挪完(报给老师、重画清楚的那一块) */
const SETTLE_MS = 700;
/** 窗滑过去多久;远过三屏直接到 */
const GLIDE_MS = 600;
/** 每页先画的那一张最宽多少像素(iPad 上几页加起来的画布内存要收着) */
const BASE_PX = 1600;
/** 窗那一块重画时最多多少像素(iOS 一块画布的上限是 1677 万) */
const SHARP_MAX_PX = 6_000_000;
/** 两下轻点隔多久以内算双击 */
const DOUBLE_MS = 280;
/** 松手时快过这个(像素 / 毫秒)才带惯性;每 16 毫秒剩多少 */
const FLING_MIN = 0.25;
const FLING_KEEP = 0.95;
/** 老师的「看」滚过去时,那一块上面留多少像素(顶栏浮在板上) */
const LOOK_TOP_PX = 64;
/** 交给老师的那张图的长边 */
const SHOT_SIDE = 1024;
/** 窗停下来多久交窗里的图(清楚的那一块多半已经重画好了) */
const SHOT_MS = 1200;

let libP: Promise<Lib> | null = null;
/** pdf.js:不打进 stage.js,铺课本时才取(build:stage 拷到 dist/stage/pdf/) */
function loadLib(): Promise<Lib> {
  libP ??= (async () => {
    const url = `${PDF_BASE}pdf.min.mjs`;
    const lib = (await import(/* @vite-ignore */ url)) as Lib;
    lib.GlobalWorkerOptions.workerSrc = `${PDF_BASE}pdf.worker.min.mjs`;
    return lib;
  })();
  libP.catch(() => { libP = null; });
  return libP;
}
const docs = new Map<string, Promise<Pdfjs.PDFDocumentProxy>>();
/** 一本 PDF 只开一次(老师换一课、换一张卡都还是它);分段取,只拉要画的那几页 */
function openDoc(url: string): Promise<Pdfjs.PDFDocumentProxy> {
  let d = docs.get(url);
  if (!d) {
    d = loadLib().then((lib) => lib.getDocument({ url, cMapUrl: `${PDF_BASE}cmaps/`, cMapPacked: true, standardFontDataUrl: `${PDF_BASE}standard_fonts/`, rangeChunkSize: 1 << 16, disableAutoFetch: true, disableStream: true }).promise);
    docs.set(url, d);
    d.catch(() => docs.delete(url));
  }
  return d;
}

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const ease = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const icon = (paths: string): JSX.Element => (
  <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: paths }} />
);
const WIPE = '<path d="M4 15l8-8 6 6-6 6H8z"></path><path d="M12 21h8"></path>';

/** 窗:中心(场景坐标)与倍数(一个场景单位多少 CSS 像素) */
interface Cam { cx: number; cy: number; s: number }

/** 这一课铺好的样子:哪本、哪几页、各页在场景里的位置、每页先画的那张、课本的行与字(点字用,后到) */
interface Geo {
  key: string;
  pdf: string;
  sheets: (BookSheet & { w: number; h: number })[];
  height: number;
  aspect: number;
  base: Map<number, HTMLCanvasElement>;
  /** 先画的那张已经画好的页(交窗里的图要等窗里的页都画好) */
  drawn: Set<number>;
  lines: BookPage[];
}

const pathD = (pts: readonly [number, number][]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

export const BookStage = forwardRef<KitStageHandle, BookStageProps>(function BookStage({ id, kit, params, ops, state, readonly, hand, onState, onSubmit, onPick, onReveal, onView, onShot, onError }, ref) {
  const view = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const sharp = useRef<HTMLCanvasElement>(null);
  const geo = useRef<Geo | null>(null);
  const cam = useRef<Cam>({ cx: BOOK_W / 2, cy: 400, s: 1 });
  const cur = useRef<KitState>({ marks: [] });
  const glide = useRef(0);
  const settle = useRef(0);
  const sharpTask = useRef<{ cancel(): void } | null>(null);
  /** 手指:按下的几根、这一下是轻点还是拖、两指时的起点 */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'tap' | 'pan' | 'pinch'; x0: number; y0: number; cam0: Cam; d0?: number; m0?: [number, number] } | null>(null);
  const moved = useRef(false);
  /** 窗的大小:页宽铺满(1)、两倍(2) */
  const zoom = useRef<1 | 2>(1);
  /** 拖的最后几个点(松手算惯性) */
  const trail = useRef<{ t: number; x: number; y: number }[]>([]);
  /** 手指轻点了一下,等着看是不是双击 */
  const lastTap = useRef<{ t: number; x: number; y: number; timer: number } | null>(null);
  /** 笔:正在画的一笔 */
  const pen = useRef<{ id: number; pts: [number, number][]; el: SVGPathElement; x0: number; y0: number } | null>(null);
  /** 孩子手上动着的时候老师的新窗先记着,手停了再去 */
  const pendingFrame = useRef<Box | null>(null);
  const revealed = useRef(new Set<string>());
  /** 回过状态的那张卡(换卡时才再回) */
  const emitted = useRef('');
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading');
  const [marks, setMarks] = useState(0);

  const def = kitOf(kit);
  const kp = def ? kitParams(def, params) : {};
  const open = def ? kitOps(def, ops) : [];
  const canMark = open.includes('圈') || open.includes('画');
  const canPick = open.includes('点字');
  const pdfUrl = kp['书'] ? `/api/kid/textbook/pdf?b=${encodeURIComponent(kp['书'])}` : '';
  const pages = bookPages(kp['页']);
  const geoKey = `${kp['书']}|${pages.join(',')}`;

  // ---- 窗 ----
  /** 窗的大小(CSS 像素) */
  const vsize = (): [number, number] => { const r = view.current?.getBoundingClientRect(); return [r?.width || 1, r?.height || 1]; };
  /** 倍数的上下限:缩到整页看得全,放到一页宽的六倍 */
  const sRange = (): [number, number] => {
    const [vw, vh] = vsize();
    const g = geo.current;
    const pageH = g?.sheets[0]?.height ?? BOOK_W * BOOK_ASPECT;
    return [Math.min(vw / BOOK_W, vh / pageH) * 0.9, (vw / BOOK_W) * 6];
  };
  /** 窗不跑出这一条:孩子的窗大小定死(页宽 × zoom),边贴着书页;只读的照以前,中心留在条子里 */
  const clamp = (c: Cam): Cam => {
    if (!readonly) {
      const [vw, vh] = vsize();
      const h = geo.current?.height ?? BOOK_W;
      const s = (vw / BOOK_W) * zoom.current;
      const hw = vw / 2 / s, hh = vh / 2 / s;
      return { s, cx: hw * 2 >= BOOK_W ? BOOK_W / 2 : Math.min(BOOK_W - hw, Math.max(hw, c.cx)), cy: hh * 2 >= h ? hh : Math.min(h - hh, Math.max(hh, c.cy)) };
    }
    const [lo, hi] = sRange();
    const s = Math.min(hi, Math.max(lo, c.s));
    const h = geo.current?.height ?? BOOK_W;
    return { s, cx: Math.min(BOOK_W, Math.max(0, c.cx)), cy: Math.min(h, Math.max(0, c.cy)) };
  };
  /** 窗现在看着的那一块(场景坐标) */
  const viewBox = (c = cam.current): Box => { const [vw, vh] = vsize(); return [c.cx - vw / 2 / c.s, c.cy - vh / 2 / c.s, c.cx + vw / 2 / c.s, c.cy + vh / 2 / c.s]; };
  const apply = (): void => {
    const [vw, vh] = vsize();
    const c = cam.current;
    if (paper.current) paper.current.style.transform = `translate(${vw / 2 - c.cx * c.s}px, ${vh / 2 - c.cy * c.s}px) scale(${c.s})`;
  };
  /** 一块(场景坐标)放进窗里:整块看得见,四周留点边 */
  const camFor = (b: Box): Cam => {
    const [vw, vh] = vsize();
    return clamp({ cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, s: Math.min(vw / (b[2] - b[0]), vh / (b[3] - b[1])) });
  };
  /** 老师的「看」:窗大小不变,滚到那一块——放得下就摆在窗中间,放不下就块顶贴着窗顶(让过顶栏);只读的照 camFor */
  const lookAt = (b: Box): Cam => {
    if (readonly) return camFor(b);
    const [vw, vh] = vsize();
    const s = (vw / BOOK_W) * zoom.current;
    const fits = (b[3] - b[1]) * s <= vh - LOOK_TOP_PX * 2;
    return clamp({ s, cx: (b[0] + b[2]) / 2, cy: fits ? (b[1] + b[3]) / 2 : b[1] - LOOK_TOP_PX / s + vh / 2 / s });
  };
  /** 老师要看的那一块左边亮一道竖条(孩子知道从哪看到哪;不盖字,跨页的块也不把页脚、页缝罩进去) */
  const flashLook = (b: Box): void => {
    if (readonly) return;
    const hl = svg.current?.querySelector('.bk-hl');
    if (!hl) return;
    const r = el('rect', { x: String(Math.max(4, b[0] - 16)), y: String(b[1]), width: '8', height: String(Math.max(8, b[3] - b[1])), rx: '4', class: 'bk-look' });
    hl.querySelector('.bk-look')?.remove();
    hl.append(r);
    window.setTimeout(() => r.remove(), 2600);
  };
  const goLook = (b: Box): void => { moveTo(lookAt(b), true); flashLook(b); };
  /** 老师没写「看」:页宽铺满窗、第一页的顶贴着窗顶(2026-11-14:原来整页塞进窗,横屏两边各空一大块;顶栏浮在上面,不占地方) */
  const pageTop = (): Cam => {
    const [vw, vh] = vsize();
    const s = vw / BOOK_W;
    return clamp({ s, cx: BOOK_W / 2, cy: vh / 2 / s });
  };
  const moveTo = (to: Cam, animate: boolean): void => {
    cancelAnimationFrame(glide.current);
    const from = { ...cam.current };
    const [, vh] = vsize();
    const far = Math.abs(to.cy - from.cy) * Math.min(from.s, to.s) > vh * 3;
    if (!animate || far) { cam.current = to; apply(); scheduleSharp(); return; }
    const t0 = performance.now();
    const tick = (now: number): void => {
      const x = Math.min(1, (now - t0) / GLIDE_MS), k = ease(x);
      // 倍数按比例插(放大缩小看着匀)
      cam.current = { cx: from.cx + (to.cx - from.cx) * k, cy: from.cy + (to.cy - from.cy) * k, s: from.s * Math.pow(to.s / from.s, k) };
      apply();
      if (x < 1) glide.current = requestAnimationFrame(tick); else scheduleSharp();
    };
    glide.current = requestAnimationFrame(tick);
  };

  // ---- 画面 ----
  /** 停下来以后把窗里那一块照屏幕的像素重画一张盖上去(先画的那张放大了糊) */
  const scheduleSharp = (): void => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => void drawSharp(), 250);
    scheduleShot();
  };
  // ---- 交窗里的图 ----
  const shotTimer = useRef(0);
  const shotKey = useRef('');
  const shotTries = useRef(0);
  const cardRef = useRef('');
  const scheduleShot = (): void => {
    if (!onShot || readonly) return;
    window.clearTimeout(shotTimer.current);
    shotTimer.current = window.setTimeout(shoot, SHOT_MS);
  };
  /** 窗里的页都画好了才交;窗、老师的卡、孩子的笔画都没变就不再交 */
  const shoot = (): void => {
    const g = geo.current;
    if (!g || !onShot || readonly || touches.current.size || pen.current) return;
    const b = viewBox();
    const seen = g.sheets.filter((sh) => sh.top < b[3] && sh.top + sh.height > b[1]);
    if (seen.some((sh) => !g.drawn.has(sh.n))) { if (shotTries.current++ < 20) scheduleShot(); return; }
    shotTries.current = 0;
    const box = b.map((v) => Math.round(v)) as Box;
    const key = `${g.key}|${box.join(',')}|${cardRef.current}|${(cur.current.marks ?? []).length}`;
    if (key === shotKey.current) return;
    const image = snapshot('image/jpeg');
    if (!image) return;
    shotKey.current = key;
    onShot(box, image);
  };
  const drawSharp = async (): Promise<void> => {
    const g = geo.current, cv = sharp.current;
    if (!g || !cv) return;
    sharpTask.current?.cancel();
    const c = cam.current;
    const dpr = window.devicePixelRatio || 1;
    const [x0, y0, x1, y1] = viewBox(c);
    // 先画的那张够清楚就不用
    const need = c.s * dpr;
    const have = Math.min(...g.sheets.map((sh) => (g.base.get(sh.n)?.width ?? 0) / BOOK_W));
    if (need <= have * 1.15) { cv.style.display = 'none'; return; }
    let k = need;
    const w = (x1 - x0) * k, h = (y1 - y0) * k;
    if (w * h > SHARP_MAX_PX) k *= Math.sqrt(SHARP_MAX_PX / (w * h));
    const doc = await openDoc(g.pdf);
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, Math.round((x1 - x0) * k));
    tmp.height = Math.max(1, Math.round((y1 - y0) * k));
    let cancelled = false;
    sharpTask.current = { cancel: () => { cancelled = true; } };
    // 一页一页画它露在窗里的那一截(白底),再拼进窗那一块;页和页之间的缝空着(透出底下先画的那层和纸色)。
    // 不能几页画进同一张透明画布:pdf.js 把透明底画成黑的
    const ctx = tmp.getContext('2d');
    for (const sh of g.sheets) {
      const ix0 = Math.max(x0, 0), iy0 = Math.max(y0, sh.top), ix1 = Math.min(x1, BOOK_W), iy1 = Math.min(y1, sh.top + sh.height);
      if (ix1 <= ix0 || iy1 <= iy0 || cancelled || !ctx) continue;
      const page = await doc.getPage(sh.n);
      if (cancelled) return;
      const part = document.createElement('canvas');
      part.width = Math.max(1, Math.round((ix1 - ix0) * k));
      part.height = Math.max(1, Math.round((iy1 - iy0) * k));
      const vp = page.getViewport({ scale: sh.s * k });
      const task = page.render({ canvas: part, viewport: vp, transform: [1, 0, 0, 1, -ix0 * k, (sh.top - iy0) * k], background: '#ffffff' });
      sharpTask.current = { cancel: () => { cancelled = true; task.cancel(); } };
      try { await task.promise; } catch { return; }
      ctx.drawImage(part, Math.round((ix0 - x0) * k), Math.round((iy0 - y0) * k));
    }
    if (cancelled || geo.current !== g) return;
    cv.width = tmp.width; cv.height = tmp.height;
    cv.getContext('2d')?.drawImage(tmp, 0, 0);
    Object.assign(cv.style, { display: 'block', left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
  };

  /** 老师的记号:圈(一笔画出来)、盖拼音的块;孩子揭开过的不再盖 */
  const paintTeacher = useCallback((p: Record<string, string>) => {
    const s = svg.current;
    if (!s) return;
    const layer = s.querySelector('.bk-teacher');
    if (!layer) return;
    const out: SVGElement[] = [];
    for (const { text, box } of bookSpots(p['圈'])) {
      if (!box) continue;
      const pad = Math.max(4, (box[3] - box[1]) * 0.35);
      const e = el('ellipse', { cx: String((box[0] + box[2]) / 2), cy: String((box[1] + box[3]) / 2), rx: String((box[2] - box[0]) / 2 + pad * 1.4), ry: String((box[3] - box[1]) / 2 + pad), fill: 'none', stroke: RED, 'stroke-width': '3', 'vector-effect': 'non-scaling-stroke', class: 'bk-ring', 'data-text': text, pathLength: '1' });
      out.push(e);
    }
    for (const { text, box } of bookSpots(p['遮'])) {
      if (!box || revealed.current.has(text)) continue;
      const h = box[3] - box[1];
      out.push(el('rect', { x: String(box[0] - h * 0.1), y: String(box[1] - h * 0.95), width: String(box[2] - box[0] + h * 0.2), height: String(h * 0.9), rx: String(h * 0.15), fill: '#f1e6c8', stroke: '#d9c9a3', 'stroke-width': '1', 'vector-effect': 'non-scaling-stroke', class: 'bk-cover', 'data-cover': text }));
    }
    // 盖:印好的字整个盖住(和 book.ts 的 build 一样大)
    for (const { text, box } of bookSpots(p['盖'])) {
      if (!box || revealed.current.has(text)) continue;
      const h = box[3] - box[1];
      out.push(el('rect', { x: String(box[0] - h * 0.25), y: String(box[1] - h * 0.2), width: String(box[2] - box[0] + h * 0.5), height: String(h * 1.4), rx: String(h * 0.2), fill: '#f1e6c8', stroke: '#d9c9a3', 'stroke-width': '1', 'vector-effect': 'non-scaling-stroke', class: 'bk-cover', 'data-cover': text }));
    }
    layer.replaceChildren(...out);
  }, []);

  /** 孩子画的几笔 */
  const paintInk = useCallback(() => {
    const layer = svg.current?.querySelector('.bk-ink');
    if (!layer) return;
    const common = { fill: 'none', stroke: KID_INK, 'stroke-width': String(KID_INK_WIDTH * 0.7), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', opacity: '0.9' };
    const out = (cur.current.marks ?? []).map((st) => el('path', { d: pathD(st), ...common }));
    layer.replaceChildren(...out, ...(pen.current ? [pen.current.el] : []));
    setMarks((cur.current.marks ?? []).length);
  }, []);

  const emit = useCallback(() => {
    const s = cur.current;
    onState({ marks: (s.marks ?? []).map((st) => st.map((p) => [p[0], p[1]] as [number, number])), ...(s.aspect ? { aspect: s.aspect } : {}) });
  }, [onState]);

  // ---- 铺这一课:开 PDF、量页、每页先画一张、拉行和字 ----
  useEffect(() => {
    if (!pdfUrl || !pages.length) { onError('课本卡没有书或页'); return; }
    if (geo.current?.key === geoKey) return;
    let cancelled = false;
    setPhase('loading');
    (async () => {
      const doc = await openDoc(pdfUrl);
      const dims: { n: number; w: number; h: number }[] = [];
      for (const n of pages) { const pg = await doc.getPage(n); const vp = pg.getViewport({ scale: 1 }); dims.push({ n, w: vp.width, h: vp.height }); }
      if (cancelled) return;
      const sheets = bookSheets(dims).map((sh, i) => ({ ...sh, w: dims[i].w, h: dims[i].h }));
      const height = sheets.length ? sheets[sheets.length - 1].top + sheets[sheets.length - 1].height : BOOK_W;
      const aspect = Math.round((dims[0].h / dims[0].w) * 10000) / 10000;
      const [vw] = vsize();
      const px = Math.min(BASE_PX, Math.round(vw * (window.devicePixelRatio || 1)));
      const base = new Map<number, HTMLCanvasElement>();
      const host = paper.current;
      if (!host) return;
      // 换了一课:旧的页拿掉
      for (const old of Array.from(host.querySelectorAll('.bk-page'))) old.remove();
      for (const sh of sheets) {
        const cv = document.createElement('canvas');
        cv.className = 'bk-page';
        Object.assign(cv.style, { left: '0px', top: `${sh.top}px`, width: `${BOOK_W}px`, height: `${sh.height}px` });
        host.prepend(cv);
        base.set(sh.n, cv);
      }
      geo.current = { key: geoKey, pdf: pdfUrl, sheets, height, aspect, base, drawn: new Set(), lines: [] };
      if (svg.current) { svg.current.setAttribute('viewBox', `0 0 ${BOOK_W} ${height}`); Object.assign(svg.current.style, { width: `${BOOK_W}px`, height: `${height}px` }); }
      if (sharp.current) sharp.current.style.display = 'none';
      // 换了一课,孩子在上一课画的不带过来;同一课(重开、看录像)照状态摆
      cur.current = { marks: (state?.marks ?? []).slice(0, KIT_MARK_MAX), aspect };
      revealed.current = new Set();
      paintInk();
      const frame = bookSpots(kp['看'])[0]?.box ? def?.build(kp, { aspect }).frame : null;
      // 换了一课从页宽看起
      zoom.current = 1;
      const fb: Box | null = frame ? [frame[0], frame[1], frame[0] + frame[2], frame[1] + frame[3]] : null;
      cam.current = fb ? lookAt(fb) : pageTop();
      apply();
      if (fb) flashLook(fb);
      setPhase('ready');
      emitted.current = id;
      emit();
      // 每页先画一张(从窗里看得见的那页起)
      const order = [...sheets].sort((a, b) => Math.abs(a.top + a.height / 2 - cam.current.cy) - Math.abs(b.top + b.height / 2 - cam.current.cy));
      for (const sh of order) {
        const pg = await doc.getPage(sh.n);
        if (cancelled) return;
        const k = px / sh.w;
        const vp = pg.getViewport({ scale: k });
        const cv = base.get(sh.n)!;
        cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        await pg.render({ canvas: cv, viewport: vp }).promise.catch(() => {});
        geo.current?.drawn.add(sh.n);
      }
      scheduleSharp();
      // 点字要的行和字
      const r = await fetch(`/api/kid/textbook/lines?b=${encodeURIComponent(kp['书'])}&p=${pages[0]}-${pages[pages.length - 1]}`, { cache: 'no-store' }).catch(() => null);
      const j = r?.ok ? ((await r.json()) as { pages?: BookPage[] }) : null;
      if (!cancelled && geo.current?.key === geoKey && Array.isArray(j?.pages)) geo.current.lines = j!.pages!;
    })().catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoKey]);

  // ---- 老师的下一张卡(同一课):记号换上,写了「看」就把窗移过去;孩子手上动着就等他停 ----
  const cardKey = `${id}|${JSON.stringify(params)}`;
  useEffect(() => {
    const g = geo.current;
    if (!g || g.key !== geoKey || phase !== 'ready') return;
    paintTeacher(kp);
    cardRef.current = cardKey;
    scheduleShot();
    // 这张卡的状态从孩子手上那份起(笔画挂在书页上,换卡不清);一张卡只回一次
    if (!readonly && emitted.current !== id) { emitted.current = id; emit(); }
    const look = bookSpots(kp['看'])[0];
    if (look?.box) {
      const f = def?.build(kp, { aspect: g.aspect }).frame;
      const b: Box | null = f ? [f[0], f[1], f[0] + f[2], f[1] + f[3]] : null;
      if (b) { if (touches.current.size || pen.current) pendingFrame.current = b; else goLook(b); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey, phase]);

  useEffect(() => {
    const ro = new ResizeObserver(() => { cam.current = clamp(cam.current); apply(); scheduleSharp(); });
    if (view.current) ro.observe(view.current);
    return () => { ro.disconnect(); cancelAnimationFrame(glide.current); window.clearTimeout(settle.current); window.clearTimeout(shotTimer.current); window.clearTimeout(lastTap.current?.timer); sharpTask.current?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 手 ----
  const toScene = (x: number, y: number): [number, number] => {
    const r = view.current!.getBoundingClientRect();
    const [vw, vh] = [r.width, r.height];
    const c = cam.current;
    return [(x - r.left - vw / 2) / c.s + c.cx, (y - r.top - vh / 2) / c.s + c.cy];
  };
  /** 挪完了:等一下再报(连着挪就只报最后一次),顺手把窗里那块画清楚;手上动着时老师要看的那块这时去 */
  const settled = (): void => {
    scheduleSharp();
    if (pendingFrame.current) { const b = pendingFrame.current; pendingFrame.current = null; goLook(b); return; }
    if (!moved.current) return;
    moved.current = false;
    window.clearTimeout(reportTimer.current);
    reportTimer.current = window.setTimeout(() => { const b = viewBox(); onView?.([Math.round(b[0]), Math.round(b[1]), Math.round(b[2]), Math.round(b[3])]); }, SETTLE_MS);
  };
  const reportTimer = useRef(0);

  /** 轻点:先看是不是盖住的拼音,再看是不是一个字 */
  const tap = (x: number, y: number): void => {
    const [sx, sy] = toScene(x, y);
    const layer = svg.current?.querySelector('.bk-teacher');
    for (const c of Array.from(layer?.querySelectorAll<SVGRectElement>('.bk-cover') ?? [])) {
      const bx = Number(c.getAttribute('x')), by = Number(c.getAttribute('y')), bw = Number(c.getAttribute('width')), bh = Number(c.getAttribute('height'));
      const pad = bh * 0.3;
      if (sx >= bx - pad && sx <= bx + bw + pad && sy >= by - pad && sy <= by + bh + pad) {
        const t = c.getAttribute('data-cover') ?? '';
        revealed.current.add(t);
        c.remove();
        onReveal?.(t);
        return;
      }
    }
    const g = geo.current;
    if (!g || !canPick || readonly) return;
    const hit = bookPick(g.lines, g.sheets, sx, sy);
    if (!hit) return;
    const hl = svg.current?.querySelector('.bk-hl');
    if (hl) {
      const r = el('rect', { x: String(hit.box[0] - 3), y: String(hit.box[1] - 3), width: String(hit.box[2] - hit.box[0] + 6), height: String(hit.box[3] - hit.box[1] + 6), rx: '5', class: 'bk-hit' });
      hl.replaceChildren(r);
      window.setTimeout(() => r.remove(), 700);
    }
    onPick?.(hit.c);
  };

  /** 手指轻点:等一下看是不是双击;双击切窗的大小,不是双击就照轻点 */
  const fingerTap = (x: number, y: number): void => {
    if (readonly) { tap(x, y); return; }
    const L = lastTap.current, now = performance.now();
    if (L && now - L.t < DOUBLE_MS && Math.hypot(x - L.x, y - L.y) < TAP_PX * 4) {
      window.clearTimeout(L.timer);
      lastTap.current = null;
      toggleZoom(x, y);
      return;
    }
    if (L) { window.clearTimeout(L.timer); tap(L.x, L.y); }
    lastTap.current = { t: now, x, y, timer: window.setTimeout(() => { lastTap.current = null; tap(x, y); }, DOUBLE_MS) };
  };
  /** 双击:页宽 ↔ 两倍,点的那一点留在手指底下 */
  const toggleZoom = (x: number, y: number): void => {
    const [ax, ay] = toScene(x, y);
    zoom.current = zoom.current === 1 ? 2 : 1;
    const r = view.current!.getBoundingClientRect();
    const s = (r.width / BOOK_W) * zoom.current;
    moveTo(clamp({ s, cx: ax - (x - r.left - r.width / 2) / s, cy: ay - (y - r.top - r.height / 2) / s }), true);
    moved.current = true;
    settled();
  };
  /** 松手还在动:顺着滑一段慢慢停,停了才算挪完 */
  const fling = (): boolean => {
    const tr = trail.current;
    trail.current = [];
    if (readonly || tr.length < 2) return false;
    const a = tr[0], b = tr[tr.length - 1];
    const dt = b.t - a.t;
    if (dt <= 0 || performance.now() - b.t > 80) return false;
    let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
    if (Math.hypot(vx, vy) < FLING_MIN) return false;
    let t0 = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(48, now - t0);
      t0 = now;
      const c = cam.current;
      const to = clamp({ ...c, cx: c.cx - (vx * dt) / c.s, cy: c.cy - (vy * dt) / c.s });
      // 撞到边就不再往那边走
      if (to.cx === c.cx) vx = 0;
      if (to.cy === c.cy) vy = 0;
      cam.current = to;
      apply();
      const k = Math.pow(FLING_KEEP, dt / 16);
      vx *= k; vy *= k;
      if (Math.hypot(vx, vy) > 0.02) glide.current = requestAnimationFrame(tick);
      else settled();
    };
    glide.current = requestAnimationFrame(tick);
    return true;
  };

  const down = (e: React.PointerEvent): void => {
    if (phase !== 'ready') return;
    cancelAnimationFrame(glide.current);
    if (e.pointerType === 'pen') {
      // 笔:写画(开放了圈、画);点一下当轻点
      touches.current.clear(); gesture.current = null;
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* 合成的指针捕获不了 */ }
      const p = toScene(e.clientX, e.clientY);
      const path = el('path', { d: pathD([p]), fill: 'none', stroke: KID_INK, 'stroke-width': String(KID_INK_WIDTH * 0.7), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', opacity: '0.9' });
      if (canMark && !readonly) svg.current?.querySelector('.bk-ink')?.append(path);
      pen.current = { id: e.pointerId, pts: [p], el: path, x0: e.clientX, y0: e.clientY };
      return;
    }
    // 笔在纸上:别的手(手掌)不算;孩子的窗不两指缩放,第二根手指不算
    if (pen.current) return;
    if (!readonly && touches.current.size) return;
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* 同上 */ }
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...touches.current.values()];
    if (pts.length === 1) { gesture.current = { kind: 'tap', x0: e.clientX, y0: e.clientY, cam0: { ...cam.current } }; trail.current = []; }
    else if (pts.length === 2) {
      const [a, b] = pts;
      gesture.current = { kind: 'pinch', x0: 0, y0: 0, cam0: { ...cam.current }, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: [(a.x + b.x) / 2, (a.y + b.y) / 2] };
      moved.current = true;
    }
  };
  const move = (e: React.PointerEvent): void => {
    const p = pen.current;
    if (p && e.pointerId === p.id) {
      if (!canMark || readonly) return;
      const q = toScene(e.clientX, e.clientY);
      const last = p.pts[p.pts.length - 1];
      if (Math.hypot(q[0] - last[0], q[1] - last[1]) * cam.current.s < 2) return;
      p.pts.push(q);
      p.el.setAttribute('d', pathD(p.pts));
      return;
    }
    if (!touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...touches.current.values()];
    if (g.kind === 'pinch' && pts.length >= 2) {
      const [a, b] = pts;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      const r = view.current!.getBoundingClientRect();
      const [vw, vh] = [r.width, r.height];
      // 两指起点中间那个点(场景坐标)跟着两指现在的中间走
      const c0 = g.cam0;
      const ax = (g.m0![0] - r.left - vw / 2) / c0.s + c0.cx, ay = (g.m0![1] - r.top - vh / 2) / c0.s + c0.cy;
      const s = clamp({ ...c0, s: c0.s * (d / g.d0!) }).s;
      cam.current = clamp({ s, cx: ax - (m[0] - r.left - vw / 2) / s, cy: ay - (m[1] - r.top - vh / 2) / s });
      apply();
      return;
    }
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (g.kind === 'tap' && Math.hypot(dx, dy) < TAP_PX) return;
    g.kind = 'pan';
    moved.current = true;
    trail.current = [...trail.current, { t: performance.now(), x: e.clientX, y: e.clientY }].filter((p, _, all) => all[all.length - 1].t - p.t <= 100);
    cam.current = clamp({ ...g.cam0, cx: g.cam0.cx - dx / g.cam0.s, cy: g.cam0.cy - dy / g.cam0.s });
    apply();
  };
  const up = (e: React.PointerEvent): void => {
    const p = pen.current;
    if (p && e.pointerId === p.id) {
      pen.current = null;
      const tiny = Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < TAP_PX && p.pts.length < 6;
      if (tiny || !canMark || readonly) { p.el.remove(); if (tiny) tap(e.clientX, e.clientY); settled(); return; }
      const step = Math.ceil(p.pts.length / KIT_MARK_POINTS);
      const pts = p.pts.filter((_, i) => i % step === 0 || i === p.pts.length - 1).slice(-KIT_MARK_POINTS).map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]);
      cur.current = { ...cur.current, marks: [...(cur.current.marks ?? []), pts].slice(-KIT_MARK_MAX) };
      paintInk();
      emit();
      settled();
      return;
    }
    if (!touches.current.has(e.pointerId)) return;
    touches.current.delete(e.pointerId);
    const g = gesture.current;
    const left = [...touches.current.values()];
    if (left.length === 1) {
      // 两指放开一指:剩下那根接着拖,从这里重新算起(不跳)
      gesture.current = { kind: 'pan', x0: left[0].x, y0: left[0].y, cam0: { ...cam.current } };
      return;
    }
    if (left.length) return;
    gesture.current = null;
    if (g?.kind === 'tap' && e.type === 'pointerup') fingerTap(e.clientX, e.clientY);
    if (g?.kind === 'pan' && e.type === 'pointerup' && fling()) return;
    settled();
  };
  /** 电脑上:滚轮上下滚(两倍时也左右);只读的照以前滚轮放大缩小(围着鼠标那一点) */
  const wheel = (e: React.WheelEvent): void => {
    if (phase !== 'ready') return;
    if (!readonly) {
      if (e.ctrlKey) return;
      const c = cam.current;
      cam.current = clamp({ ...c, cx: c.cx + e.deltaX / c.s, cy: c.cy + e.deltaY / c.s });
      apply();
      moved.current = true;
      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(settled, 200);
      return;
    }
    const [ax, ay] = toScene(e.clientX, e.clientY);
    const c = cam.current;
    const s = clamp({ ...c, s: c.s * Math.exp(-e.deltaY * 0.0015) }).s;
    const r = view.current!.getBoundingClientRect();
    cam.current = clamp({ s, cx: ax - (e.clientX - r.left - r.width / 2) / s, cy: ay - (e.clientY - r.top - r.height / 2) / s });
    apply();
    moved.current = true;
    window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(settled, 200);
  };
  const wheelTimer = useRef(0);

  const wipe = useCallback(() => {
    if (readonly || !(cur.current.marks ?? []).length) return;
    cur.current = { ...cur.current, marks: [] };
    paintInk();
    emit();
  }, [readonly, paintInk, emit]);

  /** 窗此刻的样子导成一张图(交板是 png,交给老师看的窗是 jpeg):每页先画的那张、重画清楚的那一块 + 老师的圈 + 孩子的笔画,纸色打底 */
  const snapshot = useCallback((type: 'image/png' | 'image/jpeg' = 'image/png'): string | undefined => {
    const g = geo.current;
    if (!g) return undefined;
    try {
      const [x0, y0, x1, y1] = viewBox();
      const k = SHOT_SIDE / Math.max(x1 - x0, y1 - y0);
      const cv = document.createElement('canvas');
      cv.width = Math.round((x1 - x0) * k); cv.height = Math.round((y1 - y0) * k);
      const ctx = cv.getContext('2d');
      if (!ctx) return undefined;
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
      for (const sh of g.sheets) { const b = g.base.get(sh.n); if (b && b.width) ctx.drawImage(b, 0, sh.top, BOOK_W, sh.height); }
      // 窗那一块重画过的清楚的那张(盖在上面,和屏幕上一样)
      const sc = sharp.current;
      if (sc && sc.style.display === 'block' && sc.width) ctx.drawImage(sc, parseFloat(sc.style.left), parseFloat(sc.style.top), parseFloat(sc.style.width), parseFloat(sc.style.height));
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = RED; ctx.lineWidth = 3 / k;
      for (const e of Array.from(svg.current?.querySelectorAll<SVGEllipseElement>('.bk-ring') ?? [])) { ctx.beginPath(); ctx.ellipse(Number(e.getAttribute('cx')), Number(e.getAttribute('cy')), Number(e.getAttribute('rx')), Number(e.getAttribute('ry')), 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.strokeStyle = KID_INK; ctx.lineWidth = (KID_INK_WIDTH * 0.7) / k;
      for (const st of cur.current.marks ?? []) { ctx.beginPath(); st.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
      return type === 'image/jpeg' ? cv.toDataURL('image/jpeg', 0.8) : cv.toDataURL('image/png');
    } catch {
      return undefined;
    }
  }, []);

  useImperativeHandle(ref, () => ({
    submit() {
      const s = cur.current;
      onSubmit({ marks: s.marks ?? [], ...(s.aspect ? { aspect: s.aspect } : {}) }, snapshot());
    },
    peek() { return Promise.resolve(snapshot('image/jpeg') ?? null); },
  }), [onSubmit, snapshot]);

  return (
    <div className={`kt-wrap${hand === 'left' ? ' kt-hand-left' : ''}`}>
      {readonly || !canMark ? null : <div className="kt-tools">
        <button type="button" className="kt-btn kt-wipe" onClick={wipe} disabled={phase !== 'ready' || !marks} aria-label="擦掉">{icon(WIPE)}<span>擦掉</span></button>
      </div>}
      <div className="kt-board bk-board" data-phase={phase} data-marks={marks}>
        <div className="bk-view" ref={view} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
          <div className="bk-paper" ref={paper}>
            <canvas className="bk-sharp" ref={sharp} />
            <svg className="bk-svg" ref={svg} xmlns={SVG_NS}>
              <g className="bk-hl" />
              <g className="bk-teacher" />
              <g className="bk-ink" />
            </svg>
          </div>
        </div>
        {phase === 'loading' && <div className="stage-wait">翻课本…</div>}
      </div>
    </div>
  );
});
