/**
 * 烤好的课包画面(bake.json,《重新设计.md》第 4 步):excalidraw 在 build 之后、在浏览器里只跑一次(drawtell bake),
 * 把每个元素的静态 SVG 节点、每条路径的长度、笔尖走的轨迹、内嵌字体存下来;播放时不再有 excalidraw 与 SMIL,
 * 某一刻的画面 = 每个元素画了多少(frameAt 的 progress)→ 描边画到哪(stroke-dashoffset)、字露到哪(裁剪框)。
 * 时长不进 bake:配音、拉伸只改时钟,画面变了才要重烤(source.hash 对不上)。
 *
 * 本文件纯计算:类型、一个元素在 progress p 时怎么画(paintElement)、整幅画面拼成 SVG 字符串(renderFrameSvg,服务端出缩略图用)。
 * 浏览器里的增量渲染在 drawtell/render(同一份 paintElement)。
 */

import type { LessonFrame } from './clock.ts';
import { DEFAULT_POINTER_IMG, ERASER_POINTER_IMG } from '../player/pointer.ts';

/** 一个 SVG 节点(元素静态导出的样子,原样存属性);路径多存长度,好按描边揭示 */
export interface BakedNode {
  tag: string;
  attrs: Record<string, string>;
  /** text / tspan 的字 */
  text?: string;
  children?: BakedNode[];
  /** path 的总长(SVG 坐标):有描边的路径按它揭示 */
  len?: number;
}

export interface BakedElement {
  id: string;
  /** 顶层节点(excalidraw 每个元素导出成一个 <g>) */
  node: BakedNode;
  /** 文字的揭示框(元素局部坐标,即 <g> transform 之内):从左往右露 */
  reveal?: { width: number; height: number };
  /** 笔尖走的轨迹(SVG 坐标):[x, y, 走到这里是全程的几分之几] */
  track: [number, number, number][];
  /** 橡皮那一笔:笔尖换成橡皮 */
  eraser?: boolean;
}

export interface BakedLesson {
  schema: 'drawtell-bake';
  version: 1;
  /** 烤它的 excalidraw 版本、画面的 hash(scene.json 的 skeletons 与 background;变了要重烤) */
  source: { excalidraw: string; hash: string };
  viewBox: [number, number, number, number];
  /** 场景坐标 → SVG 坐标的平移(导出时留了白、整体挪过) */
  offset: [number, number];
  /** 导出时内嵌的字体(@font-face,data URI) */
  fonts: string;
  /** <defs> 里字体以外的东西(箭头的遮罩之类),原样 */
  defs: string;
  /** 背景图:src 相对课包目录,x/y/width/height 是 SVG 坐标 */
  background?: { src: string; x: number; y: number; width: number; height: number };
  elements: BakedElement[];
}

/**
 * 画面的指纹:scene.json 里决定画面的那几样(skeletons、background),按 JSON 原样算(FNV-1a,两路 32 位拼 16 位十六进制)。
 * 纯 JS:播放页拿到 scene.json 与 bake.json 自己对一下,对不上(画面改过、没重烤)就别用这份烤好的。
 */
export function pictureHash(sceneJson: { skeletons?: unknown; background?: unknown }): string {
  const s = JSON.stringify({ skeletons: sceneJson.skeletons ?? [], background: sceneJson.background ?? null });
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** 这份烤好的画面是不是这份 scene.json 的 */
export function bakeMatches(baked: unknown, sceneJson: { skeletons?: unknown; background?: unknown }): baked is BakedLesson {
  const b = baked as Partial<BakedLesson> | null;
  return Boolean(b && b.schema === 'drawtell-bake' && b.version === 1 && b.source?.hash === pictureHash(sceneJson));
}

/** 一条路径在 progress p 时的样子 */
export interface PathPaint {
  /** 描边揭示:dasharray = len,dashoffset = len × (1 − 画了多少);全画完 = 不设 */
  dash?: { len: number; offset: number };
  /** 没法描边揭示的(实心填充、虚线):淡入 */
  opacity?: number;
}

/** 一个元素在 progress p 时的样子:visible = 开始画了;paths 按深度优先的顺序对着元素里的每条 path;clip = 文字露出的宽 */
export interface ElementPaint {
  visible: boolean;
  done: boolean;
  paths: PathPaint[];
  clip?: number;
  /** 笔尖在哪(SVG 坐标);没在画 = 没有 */
  pointer?: [number, number];
}

const isNone = (v: string | undefined): boolean => v === undefined || v === 'none' || v === 'transparent' || v === '';

/** 元素里的 path,深度优先;stroke 继承父节点 */
export function bakedPaths(node: BakedNode): { node: BakedNode; stroke: boolean; dashed: boolean }[] {
  const out: { node: BakedNode; stroke: boolean; dashed: boolean }[] = [];
  const walk = (n: BakedNode, stroke: string | undefined, dash: string | undefined): void => {
    const s = n.attrs.stroke ?? stroke;
    const d = n.attrs['stroke-dasharray'] ?? dash;
    if (n.tag === 'path') out.push({ node: n, stroke: !isNone(s) && (n.len ?? 0) > 0, dashed: !isNone(d) });
    for (const c of n.children ?? []) walk(c, s, d);
  };
  walk(node, undefined, undefined);
  return out;
}

/** 实心填充(没法描边揭示)从 progress 多少开始淡入 */
const FILL_FROM = 0.7;
/** 画到多少以后笔尖收起 */
const POINTER_UNTIL = 0.99;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function paintElement(el: BakedElement, p: number): ElementPaint {
  const paths = bakedPaths(el.node);
  if (!(p > 0)) return { visible: false, done: false, paths: paths.map(() => ({})) };
  const done = p >= 1;
  if (done) return { visible: true, done: true, paths: paths.map(() => ({})), ...(el.reveal ? { clip: el.reveal.width } : {}) };
  // 有描边的路径(虚线也算)按长度首尾相接;虚线没法描边揭示,轮到它就整条出现;实心填充最后一段淡入
  const total = paths.reduce((a, x) => a + (x.stroke ? x.node.len! : 0), 0);
  let at = 0;
  const drawn = p * total;
  const paints = paths.map((x): PathPaint => {
    if (!x.stroke) return { opacity: total > 0 ? clamp01((p - FILL_FROM) / (1 - FILL_FROM)) : p };
    const len = x.node.len!;
    const q = clamp01((drawn - at) / len);
    at += len;
    return x.dashed ? { opacity: q > 0 ? 1 : 0 } : { dash: { len, offset: len * (1 - q) } };
  });
  // 笔尖只在真画着的时候出现:步尾定格停在画完前半毫秒(p ≈ 0.999),笔不该杵在那儿
  return { visible: true, done: false, paths: paints, ...(el.reveal ? { clip: el.reveal.width * p } : {}), ...(p < POINTER_UNTIL ? (trackAt(el.track, p) ?? {}) : {}) };
}

/** 笔尖:轨迹上走到 p 的那一点 */
function trackAt(track: readonly [number, number, number][], p: number): { pointer: [number, number] } | null {
  if (!track.length) return null;
  let i = track.findIndex((t) => t[2] >= p);
  if (i < 0) i = track.length - 1;
  if (i === 0) return { pointer: [track[0][0], track[0][1]] };
  const [x0, y0, f0] = track[i - 1];
  const [x1, y1, f1] = track[i];
  const k = f1 > f0 ? (p - f0) / (f1 - f0) : 1;
  return { pointer: [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k] };
}

/** 一刻的进度:frameAt 的结果,或 id → progress */
export type FrameProgress = LessonFrame | ReadonlyMap<string, number>;

export function progressMap(frame: FrameProgress): ReadonlyMap<string, number> {
  return 'elements' in frame ? new Map((frame as LessonFrame).elements.map((e) => [e.id, e.progress])) : (frame as ReadonlyMap<string, number>);
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attrText = (attrs: Record<string, string>): string => Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');

function nodeSvg(n: BakedNode, paintOf: Map<BakedNode, PathPaint>): string {
  const pp = paintOf.get(n);
  const extra: Record<string, string> = {};
  if (pp?.dash) { extra['stroke-dasharray'] = `${round(pp.dash.len)} ${round(pp.dash.len)}`; extra['stroke-dashoffset'] = String(round(pp.dash.offset)); }
  if (pp?.opacity !== undefined && pp.opacity < 1) extra.opacity = String(round(pp.opacity));
  const inner = `${n.text !== undefined ? esc(n.text) : ''}${(n.children ?? []).map((c) => nodeSvg(c, paintOf)).join('')}`;
  return `<${n.tag}${attrText({ ...n.attrs, ...extra })}>${inner}</${n.tag}>`;
}
const round = (n: number): number => Math.round(n * 100) / 100;

export interface RenderOptions {
  /** 背景图的 URL(bake 里存的是相对课包目录的 src;服务端给 /api/bundles/<id>/…) */
  backgroundHref?: string;
  /** 再叠一层(圈的卡:孩子的圈);SVG 坐标 */
  overlay?: string;
  /** 画不画笔尖(铅笔;橡皮那一笔是橡皮);缺省不画 */
  pointer?: boolean;
}

/**
 * 整幅画面在这一刻的 SVG 字符串(服务端出缩略图、测试用):没开始画的元素不出,画到一半的按 paintElement 揭示。
 * 字体原样内嵌,<img> 里也显示得对。
 */
export function renderFrameSvg(baked: BakedLesson, frame: FrameProgress, opts: RenderOptions = {}): string {
  const prog = progressMap(frame);
  const [vx, vy, vw, vh] = baked.viewBox;
  const clips: string[] = [];
  const body: string[] = [];
  let pointer: { at: [number, number]; eraser: boolean } | undefined;
  for (const el of baked.elements) {
    const pnt = paintElement(el, prog.get(el.id) ?? 0);
    if (!pnt.visible) continue;
    const paths = bakedPaths(el.node);
    const paintOf = new Map(paths.map((x, i) => [x.node, pnt.paths[i]] as const));
    if (pnt.clip !== undefined && !pnt.done && el.reveal) {
      const cid = `clip-${el.id}`;
      clips.push(`<clipPath id="${esc(cid)}"><rect x="-2" y="${round(-el.reveal.height * 0.5)}" width="${round(pnt.clip + 2)}" height="${round(el.reveal.height * 2)}"/></clipPath>`);
      const { tag, attrs, children, text } = el.node;
      body.push(`<${tag}${attrText(attrs)}><g clip-path="url(#${esc(cid)})">${text !== undefined ? esc(text) : ''}${(children ?? []).map((c) => nodeSvg(c, paintOf)).join('')}</g></${tag}>`);
    } else body.push(nodeSvg(el.node, paintOf));
    if (pnt.pointer && !pnt.done) pointer = { at: pnt.pointer, eraser: Boolean(el.eraser) };
  }
  const bg = baked.background && opts.backgroundHref ? `<image href="${esc(opts.backgroundHref)}" x="${baked.background.x}" y="${baked.background.y}" width="${baked.background.width}" height="${baked.background.height}" preserveAspectRatio="none"/>` : '';
  const pen = opts.pointer && pointer ? pointerSvg(pointer.at, pointer.eraser) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}"><defs><style>${baked.fonts}</style>${baked.defs}${clips.join('')}</defs>${bg}${body.join('')}${opts.overlay ?? ''}${pen}</svg>`;
}

/** 笔尖:铅笔的尖在图片 (0,0);橡皮的擦除端在 (5,5)(pointer.ts) */
export function pointerBox(at: readonly [number, number], eraser: boolean): { href: string; x: number; y: number; size: number } {
  return eraser ? { href: ERASER_POINTER_IMG, x: at[0] - 5, y: at[1] - 5, size: 36 } : { href: DEFAULT_POINTER_IMG, x: at[0], y: at[1], size: 30 };
}

function pointerSvg(at: readonly [number, number], eraser: boolean): string {
  const b = pointerBox(at, eraser);
  return `<image href="${esc(b.href)}" x="${round(b.x)}" y="${round(b.y)}" width="${b.size}" height="${b.size}"/>`;
}
