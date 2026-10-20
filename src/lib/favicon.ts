/**
 * 网页图标(浏览器标签上那枚)与主屏幕图标:所有页面都是 cotutor 的 logo「一起教」双 C(《产品规划.md》拍板 20、23,几何在 logo.ts),
 * 不跟着老师换(老师的头像缩到 16 px 认不出)。
 * 网页图标:纸色圆底上墨色大 C、陶土色小 C(24 px 以下那一档),深色的标签栏上也看得见;SVG 给认 SVG 的浏览器,PNG 给 Safari 这些。
 * 主屏幕图标(icon.ts):陶土色底、白线,同工作台页头那块;大号那一档,小 C 侧头;不透明(iOS 的图标不该有透明)。
 */
import { encodePng } from './png.ts';
import { LOGO_BIG, LOGO_CLAY, LOGO_INK, LOGO_PAPER, LOGO_SMALL, logoBody, logoHit, type LogoGeom } from './logo.ts';

/** 网页上引图标的两行。PNG 带 sizes 写在前面,Chrome 才不会放着 SVG 不用 */
export function faviconLinks(): string {
  return '<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">\n<link rel="icon" href="/favicon.svg" type="image/svg+xml">';
}

/** /favicon.svg、/favicon-32.png(/favicon.ico 给同一张 PNG);不是这几条路由 null */
export function faviconResponse(path: string): { body: Uint8Array; contentType: string } | null {
  if (path === '/favicon.svg') return { body: Buffer.from(faviconSvg()), contentType: 'image/svg+xml; charset=utf-8' };
  if (path === '/favicon-32.png' || path === '/favicon.ico') return { body: faviconPng(), contentType: 'image/png' };
  return null;
}

/** 两个 C 在纸色圆底里占多大(圆底半径 50,大 C 外沿 46.5 × 0.86 ≈ 40,四周留一圈纸色) */
const TAB_MARK = 0.86;
/** 主屏幕图标里两个 C 占多大:iOS 切圆角、安卓切圆都切不到 */
const HOME_MARK = 0.62;
/** 主屏幕图标上小 C 的白线淡一档 */
const HOME_INNER = 0.75;

export function faviconSvg(): string {
  const k = TAB_MARK;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="64" height="64"><circle cx="50" cy="50" r="50" fill="${LOGO_PAPER}"/>`
    + `<g transform="translate(50 50) scale(${k}) translate(-50 -50)">${logoBody(LOGO_SMALL, { outer: LOGO_INK, inner: LOGO_CLAY })}</g></svg>`;
}

// ---- PNG:4×4 超采样 ----

type RGB = [number, number, number];
const rgb = (hex: string): RGB => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;
const SS = 4;
const pngCache = new Map<number, Buffer>();

/** 网页图标的 PNG:纸色圆底,圆外透明 */
export function faviconPng(size = 32): Buffer {
  const n = Math.min(256, Math.max(16, Math.round(size)));
  const hit = pngCache.get(n);
  if (hit) return hit;
  const out = logoPng(n, { g: LOGO_SMALL, mark: TAB_MARK, outer: rgb(LOGO_INK), inner: rgb(LOGO_CLAY), disc: rgb(LOGO_PAPER), bg: null });
  pngCache.set(n, out);
  return out;
}

/** 主屏幕图标:陶土色底、白线,不透明;缓存在 icon.ts */
export function homeScreenPng(n: number): Buffer {
  const clay = rgb(LOGO_CLAY);
  const white: RGB = [255, 255, 255];
  return logoPng(n, { g: LOGO_BIG, mark: HOME_MARK, outer: white, inner: mix(clay, white, HOME_INNER), disc: null, bg: clay });
}

/** 100 见方的画布铺满 n×n;两个 C 按 mark 缩在中间;disc 给了就在半径 50 的圆里铺它;bg 给了就是不透明 RGB,不给是透明 RGBA */
function logoPng(n: number, o: { g: LogoGeom; mark: number; outer: RGB; inner: RGB; disc: RGB | null; bg: RGB | null }): Buffer {
  const colorAt = (u: number, v: number): RGB | null => {
    const hit = logoHit(50 + (u - 50) / o.mark, 50 + (v - 50) / o.mark, o.g);
    if (hit) return hit === 'out' ? o.outer : o.inner;
    if (o.disc && Math.hypot(u - 50, v - 50) <= 50) return o.disc;
    return o.bg;
  };
  const ch = o.bg ? 3 : 4;
  const unit = 100 / n;
  const px = Buffer.alloc(n * n * ch);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let k = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((x + (sx + 0.5) / SS) * unit, (y + (sy + 0.5) / SS) * unit);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          k++;
        }
      }
      const off = (y * n + x) * ch;
      if (k) {
        px[off] = Math.round(r / k);
        px[off + 1] = Math.round(g / k);
        px[off + 2] = Math.round(b / k);
      }
      if (!o.bg) px[off + 3] = Math.round((255 * k) / (SS * SS));
    }
  }
  return encodePng(n, px, ch);
}
