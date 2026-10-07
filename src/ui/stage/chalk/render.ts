/**
 * drawtell/render —— 在浏览器里画烤好的课包(bake.json),不用 excalidraw、不用 SMIL(《重新设计.md》第 4 步)。
 * mountBaked 把画面建成一张 SVG(只建一次),paint(frame) 按这一刻每个元素画了多少改属性:描边画到哪(dashoffset)、
 * 字露到哪(裁剪框)、实心填充淡入、笔尖在哪。没变的元素不碰,一帧只动正在画的那一两个。
 * 「这一刻画了多少」是 drawtell/core 的 frameAt(时钟)给的,两边同一份 paintElement,和服务端 renderFrameSvg 出的图一样。
 */

import { bakedPaths, paintElement, pointerBox, progressMap, type BakedNode, type BakedPicture, type FrameProgress } from '../core/bake.ts';

const NS = 'http://www.w3.org/2000/svg';

export interface MountOptions {
  /** 背景图的 URL(bake 里的 src 相对课包目录,调用方拼好) */
  backgroundHref?: string;
  /** 画不画笔尖;缺省画 */
  pointer?: boolean;
  /** 换一支笔(笔尖落在图片 (0,0),30×30);橡皮那一笔照旧是橡皮 */
  pointerImg?: string;
}

export interface MountedLesson {
  svg: SVGSVGElement;
  /** 画到这一刻 */
  paint(frame: FrameProgress): void;
}

let seq = 0;

function build(n: BakedNode, paths: SVGElement[]): SVGElement {
  const el = document.createElementNS(NS, n.tag) as SVGElement;
  for (const [k, v] of Object.entries(n.attrs)) el.setAttribute(k, v);
  if (n.text !== undefined) el.textContent = n.text;
  for (const c of n.children ?? []) el.append(build(c, paths));
  if (n.tag === 'path') paths.push(el);
  return el;
}

export function mountBaked(baked: BakedPicture, opts: MountOptions = {}): MountedLesson {
  const uid = `dt${++seq}`;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', baked.viewBox.join(' '));
  const defs = document.createElementNS(NS, 'defs');
  const style = document.createElementNS(NS, 'style');
  style.textContent = baked.fonts;
  defs.append(style);
  if (baked.defs) {
    const tmp = document.createElementNS(NS, 'g');
    tmp.innerHTML = baked.defs;
    defs.append(...Array.from(tmp.childNodes));
  }
  svg.append(defs);
  if (baked.background && opts.backgroundHref) {
    const img = document.createElementNS(NS, 'image');
    img.setAttribute('href', opts.backgroundHref);
    for (const k of ['x', 'y', 'width', 'height'] as const) img.setAttribute(k, String(baked.background[k]));
    img.setAttribute('preserveAspectRatio', 'none');
    svg.append(img);
  }
  const els = baked.elements.map((el, i) => {
    const paths: SVGElement[] = [];
    const root = build(el.node, paths);
    let clipRect: SVGRectElement | null = null;
    if (el.reveal) {
      // 字:元素 <g> 里再套一层裁剪(元素局部坐标),框的宽 = 露出来的宽
      const clip = document.createElementNS(NS, 'clipPath');
      clip.id = `${uid}-c${i}`;
      clipRect = document.createElementNS(NS, 'rect');
      clipRect.setAttribute('x', '-2');
      clipRect.setAttribute('y', String(-el.reveal.height * 0.5));
      clipRect.setAttribute('height', String(el.reveal.height * 2));
      clip.append(clipRect);
      defs.append(clip);
      const inner = document.createElementNS(NS, 'g');
      inner.append(...Array.from(root.childNodes));
      root.append(inner);
      inner.setAttribute('clip-path', `url(#${clip.id})`);
    }
    root.style.display = 'none';
    svg.append(root);
    return { el, root, paths, clipRect, last: -1 };
  });
  const pen = document.createElementNS(NS, 'image');
  pen.style.display = 'none';
  pen.style.pointerEvents = 'none';
  svg.append(pen);
  const showPointer = opts.pointer !== false;
  const kinds = baked.elements.map((el) => bakedPaths(el.node));

  return {
    svg,
    paint(frame) {
      const prog = progressMap(frame);
      let pointer: { at: [number, number]; eraser: boolean } | null = null;
      els.forEach((x, i) => {
        const p = prog.get(x.el.id) ?? 0;
        if (p === x.last) {
          if (p > 0 && p < 1) { const pp = paintElement(x.el, p); if (pp.pointer) pointer = { at: pp.pointer, eraser: Boolean(x.el.eraser) }; }
          return;
        }
        x.last = p;
        const pp = paintElement(x.el, p);
        x.root.style.display = pp.visible ? '' : 'none';
        if (!pp.visible) return;
        x.paths.forEach((path, j) => {
          const s = pp.paths[j];
          if (s?.dash) {
            path.setAttribute('stroke-dasharray', `${s.dash.len} ${s.dash.len}`);
            path.setAttribute('stroke-dashoffset', String(s.dash.offset));
          } else if (!kinds[i][j]?.dashed) {
            path.removeAttribute('stroke-dasharray');
            path.removeAttribute('stroke-dashoffset');
          }
          if (s?.opacity !== undefined && s.opacity < 1) path.setAttribute('opacity', String(s.opacity));
          else path.removeAttribute('opacity');
        });
        if (x.clipRect) x.clipRect.setAttribute('width', String((pp.clip ?? 0) + 2));
        if (pp.pointer && !pp.done) pointer = { at: pp.pointer, eraser: Boolean(x.el.eraser) };
      });
      const at = pointer as { at: [number, number]; eraser: boolean } | null;
      if (showPointer && at) {
        const b = !at.eraser && opts.pointerImg ? { href: opts.pointerImg, x: at.at[0], y: at.at[1], size: 30 } : pointerBox(at.at, at.eraser);
        if (pen.getAttribute('href') !== b.href) pen.setAttribute('href', b.href);
        pen.setAttribute('x', String(b.x));
        pen.setAttribute('y', String(b.y));
        pen.setAttribute('width', String(b.size));
        pen.setAttribute('height', String(b.size));
        pen.style.display = '';
      } else pen.style.display = 'none';
    },
  };
}
