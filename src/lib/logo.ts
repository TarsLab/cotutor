/**
 * cotutor 的 logo「一起教」双 C的几何,只在这里定义一份:页面里的 SVG(src/server/brand.ts)、
 * 网页图标与主屏幕图标(favicon.ts)都从这里画。100 见方:大 C 是家长、小 C 是老师,圆心都在 (50,50),开口都朝右 72°、圆头,
 * 同老师头像的 C 形开口环。大号时小 C 侧头 28°;24 px 以下两圈加粗、小 C 半径收一点、摆正。
 */

export const LOGO_INK = '#2B2B2B';
export const LOGO_CLAY = '#B4531F';
export const LOGO_PAPER = '#FAF9F4';

export interface LogoGeom {
  outW: number; // 大 C 的粗
  inR: number; // 小 C 的半径
  inW: number; // 小 C 的粗
  tilt: number; // 小 C 侧头(度,顺时针)
}
export const LOGO_BIG: LogoGeom = { outW: 10, inR: 19, inW: 9, tilt: 28 };
export const LOGO_SMALL: LogoGeom = { outW: 13, inR: 17, inW: 12, tilt: 0 };
export const OUT_R = 40;
/** 环从 36° 顺时针画 288°(SVG 角度,0 = 右、90 = 下),开口 72° 居中在右 */
const A0 = 36;
const SPAN = 288;

/** 画多大用哪一档 */
export const logoGeom = (size: number): LogoGeom => (size > 24 ? LOGO_BIG : LOGO_SMALL);

/** 描 80%、留 20% 的 dasharray */
export const ringDash = (r: number): string => {
  const c = 2 * Math.PI * r;
  return `${((c * SPAN) / 360).toFixed(2)} ${c.toFixed(2)}`;
};

export interface LogoColors {
  outer: string;
  inner: string;
  /** 小 C 的不透明度(色块上白线时小 C 淡一档) */
  innerOpacity?: number;
}

/** 两个 C(100 见方坐标):外层 g.ct-go / g.ct-gi 给页面里的动作挂,侧头在里面一层,动的时候不丢 */
export function logoBody(g: LogoGeom, c: LogoColors): string {
  const op = c.innerOpacity !== undefined && c.innerOpacity < 1 ? ` opacity="${c.innerOpacity}"` : '';
  return `<g class="ct-go"><circle class="ct-out" cx="50" cy="50" r="${OUT_R}" fill="none" stroke="${c.outer}" stroke-width="${g.outW}" stroke-linecap="round" stroke-dasharray="${ringDash(OUT_R)}" transform="rotate(${A0} 50 50)"/></g>`
    + `<g class="ct-gi"><g transform="rotate(${g.tilt} 50 50)"><circle class="ct-in" cx="50" cy="50" r="${g.inR}" fill="none" stroke="${c.inner}" stroke-width="${g.inW}" stroke-linecap="round" stroke-dasharray="${ringDash(g.inR)}" transform="rotate(${A0} 50 50)"${op}/></g></g>`;
}

/** (u, v) 落在哪个 C 上(PNG 逐点画用):环身在弧里、或在两个圆头里 */
export function logoHit(u: number, v: number, g: LogoGeom): 'out' | 'in' | null {
  const d = Math.hypot(u - 50, v - 50);
  const deg = ((Math.atan2(v - 50, u - 50) * 180) / Math.PI + 360) % 360;
  const on = (r: number, w: number, a0: number): boolean => {
    const half = w / 2;
    if (Math.abs(d - r) <= half && (((deg - a0) % 360) + 360) % 360 <= SPAN) return true;
    return [a0, a0 + SPAN].some((a) => Math.hypot(u - 50 - r * Math.cos((a * Math.PI) / 180), v - 50 - r * Math.sin((a * Math.PI) / 180)) <= half);
  };
  if (on(OUT_R, g.outW, A0)) return 'out';
  if (on(g.inR, g.inW, A0 + g.tilt)) return 'in';
  return null;
}
