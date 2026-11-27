/**
 * 把课本窗里已经画好的页、高清局部和笔迹合成一张临时画布。按住期间只重画这张图，
 * 稳定后停笔；翻页、松手都能直接回到原先的课本。坐标以窗为准，和课本自己的缩放无关。
 */
export function paperRaster(doc: Document, redraw: () => void) {
  const view = doc.querySelector<HTMLElement>('.bk-view');
  const ink = view?.querySelector<SVGSVGElement>('.bk-svg');
  if (!view || !ink || !ink.viewBox.baseVal.width) return null;
  const bounds = view.getBoundingClientRect(), sheet = ink.getBoundingClientRect();
  if (!bounds.width || !bounds.height || !sheet.width) return null;
  const source = doc.createElement('canvas'), result = doc.createElement('canvas');
  // 只留窗内的像素。按住时仍可读清小字，同时控制高倍屏的临时画布内存。
  const ratio = Math.min(doc.defaultView!.devicePixelRatio, Math.sqrt(2_500_000 / (bounds.width * bounds.height)));
  result.width = source.width = Math.max(1, Math.round(bounds.width * ratio));
  result.height = source.height = Math.max(1, Math.round(bounds.height * ratio));
  const ctx = source.getContext('2d'), out = result.getContext('2d');
  if (!ctx || !out) return null;
  const sx = source.width / bounds.width, sy = source.height / bounds.height;
  ctx.scale(sx, sy);
  ctx.fillStyle = doc.defaultView!.getComputedStyle(view.parentElement!).backgroundColor;
  ctx.fillRect(0, 0, bounds.width, bounds.height);
  let painted = false;
  for (const layer of view.querySelectorAll<HTMLCanvasElement>('.bk-page, .bk-sharp')) {
    const box = layer.getBoundingClientRect();
    if (!layer.width || !layer.height || !box.width || !box.height || box.right <= bounds.left || box.bottom <= bounds.top || box.left >= bounds.right || box.top >= bounds.bottom) continue;
    ctx.drawImage(layer, box.left - bounds.left, box.top - bounds.top, box.width, box.height);
    painted = true;
  }
  if (!painted) return null;
  const zoom = sheet.width / ink.viewBox.baseVal.width;
  Object.assign(result.style, { position: 'absolute', pointerEvents: 'none', left: (bounds.left - sheet.left) / zoom + 'px',
    top: (bounds.top - sheet.top) / zoom + 'px', width: bounds.width / zoom + 'px', height: bounds.height / zoom + 'px' });
  result.setAttribute('aria-hidden', 'true');
  result.hidden = true;
  ink.before(result); // 笔迹图解码期间，原来的笔迹仍画在课本上。
  if (ink.querySelector('g > *')) {
    // 笔迹有 SVG 属性，也有课页样式（旧记号、荧光笔、点读）。只栅格化当前窗，长课不分配整课的大图。
    const copy = ink.cloneNode(true) as SVGSVGElement;
    const originals = ink.querySelectorAll('*'), copies = copy.querySelectorAll('*');
    const props = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'visibility', 'display', 'font-size', 'font-family', 'font-weight', 'mix-blend-mode'];
    for (let i = 0; i < originals.length; i++) {
      const style = doc.defaultView!.getComputedStyle(originals[i]);
      for (const prop of props) (copies[i] as SVGElement).style.setProperty(prop, style.getPropertyValue(prop));
    }
    copy.removeAttribute('style');
    copy.setAttribute('width', String(source.width)); copy.setAttribute('height', String(source.height));
    copy.setAttribute('viewBox', [(bounds.left - sheet.left) / zoom, (bounds.top - sheet.top) / zoom, bounds.width / zoom, bounds.height / zoom].join(' '));
    const img = doc.createElement('img');
    img.onload = () => {
      if (!result.isConnected) return;
      ctx.drawImage(img, 0, 0, bounds.width, bounds.height);
      ink.after(result); // 「下一课」、白纸上的相机等控件仍在上面。
      redraw();
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy));
  }
  return {
    draw(depth: number, height: number, left: number, top: number, width: number, extent: number, map: ImageData) {
      // 每一小块沿纸面切线绘制；相邻块共用边缘采样，一个物理像素的搭边消除抗锯齿细缝。
      const move = (x: number, y: number) => {
        const mx = Math.round((x / sx + bounds.left - left) * map.width / width);
        const my = Math.round((y / sy + bounds.top - top) * map.height / extent);
        if (mx < 0 || my < 0 || mx >= map.width || my >= map.height) return 0;
        return (128 - map.data[(my * map.width + mx) * 4 + 1]) / 255 * 2 * height * depth * sy;
      };
      out.resetTransform();
      out.drawImage(source, 0, 0);
      const dx = Math.max(1, Math.round(16 * sx)), dy = Math.max(1, Math.round(32 * sy));
      for (let y = 0; y < source.height; y += dy) for (let x = 0; x < source.width; x += dx) {
        const w = Math.min(dx, source.width - x), h = Math.min(dy, source.height - y);
        const a = move(x, y), b = move(x + w, y), c = move(x, y + h);
        if (!(a || b || c)) continue;
        const shear = (b - a) / w, stretch = 1 + (c - a) / h;
        out.setTransform(1, shear, 0, stretch, 0, y + a - x * shear - y * stretch);
        const pad = 1;
        out.drawImage(source, x - pad, y - pad, w + 2 * pad, h + 2 * pad, x - pad, y - pad, w + 2 * pad, h + 2 * pad);
      }
      result.hidden = false;
    },
    dispose() { result.remove(); source.width = result.width = 0; },
  };
}
