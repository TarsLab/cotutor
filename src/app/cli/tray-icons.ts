/**
 * 托盘图标的 PNG:现画,不往仓里塞图片文件(同 favicon.ts);几何都来自 logo.ts 的双 C,16、18 px 这种小尺寸用小号那档。
 * 正常时只有 logo;有事在右边缺口放状态点,橙 = 要处理,红 = 没在跑(同时 logo 变淡,不只靠颜色区分)。
 *   macOS:logo 一张模板图(系统按菜单栏深浅着色),状态点一张模板图(叠在上面单独着色),18 pt @2x
 *   Windows:没有底色,white 给深色任务栏、ink 给浅色任务栏,每种状态各画几档尺寸,按系统要的尺寸挑;变淡后对比度要过 3:1
 * 菜单第一行的小圆点两边共用。
 */
import { LOGO_INK, LOGO_SMALL, logoHit } from '../../ui/shared/logo.ts';
import { encodePng } from '../../ui/shared/png.ts';

type RGB = [number, number, number];
const rgb = (hex: string): RGB => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
};

export const TRAY_DOT = { r: 14, cx: 85.5 };
/** 没在跑时 logo 的不透明度(#F3F3F3 上墨色对比度 3.3,#202020 上白色 5.8) */
export const TRAY_DIM = 0.55;
export const TRAY_WIN_SIZES = [16, 20, 24, 32, 40, 48] as const;

const SS = 8;

/** at 返回这一点的颜色与不透明度,null = 透明 */
function draw(n: number, at: (u: number, v: number) => { c: RGB; a: number } | null): Buffer {
  const px = Buffer.alloc(n * n * 4);
  const unit = 100 / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const p = at((x + (sx + 0.5) / SS) * unit, (y + (sy + 0.5) / SS) * unit);
          if (!p) continue;
          r += p.c[0] * p.a;
          g += p.c[1] * p.a;
          b += p.c[2] * p.a;
          a += p.a;
        }
      }
      if (a <= 0) continue;
      const off = (y * n + x) * 4;
      px[off] = Math.round(r / a);
      px[off + 1] = Math.round(g / a);
      px[off + 2] = Math.round(b / a);
      px[off + 3] = Math.round((255 * a) / (SS * SS));
    }
  }
  return encodePng(n, px, 4);
}

const inDot = (u: number, v: number): boolean => Math.hypot(u - TRAY_DOT.cx, v - 50) <= TRAY_DOT.r;
const BLACK: RGB = [0, 0, 0];

/** 菜单里的小圆点(10 pt @2x) */
const MENU_DOT: Record<string, string> = { ok: '#1F9D55', warn: '#E8830C', bad: '#D92D20' };
const menuDot = (hex: string): Buffer => draw(20, (u, v) => (Math.hypot(u - 50, v - 50) <= 42 ? { c: rgb(hex), a: 1 } : null));

/** 文件名 → 内容:macOS 那几张 */
export function macTrayIcons(): Record<string, Buffer> {
  const out: Record<string, Buffer> = {
    'logo.png': draw(36, (u, v) => (logoHit(u, v, LOGO_SMALL) ? { c: BLACK, a: 1 } : null)),
    'dotmark.png': draw(36, (u, v) => (inDot(u, v) ? { c: BLACK, a: 1 } : null)),
  };
  for (const [s, c] of Object.entries(MENU_DOT)) out[`dot-${s}.png`] = menuDot(c);
  return out;
}

const WIN_THEMES: Record<string, { fg: RGB; warn: RGB; bad: RGB }> = {
  white: { fg: [255, 255, 255], warn: rgb('#FFA938'), bad: rgb('#FF5A4F') },
  ink: { fg: rgb(LOGO_INK), warn: rgb('#C96A00'), bad: rgb('#D92D20') },
};

/** 文件名 → 内容:Windows 那几张(<white|ink>-<ok|warn|bad>-<尺寸>.png、dot-<状态>.png) */
export function windowsTrayIcons(): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const [name, t] of Object.entries(WIN_THEMES)) {
    for (const s of ['ok', 'warn', 'bad'] as const) {
      for (const n of TRAY_WIN_SIZES) {
        out[`${name}-${s}-${n}.png`] = draw(n, (u, v) => {
          if (s !== 'ok' && inDot(u, v)) return { c: t[s], a: 1 };
          return logoHit(u, v, LOGO_SMALL) ? { c: t.fg, a: s === 'bad' ? TRAY_DIM : 1 } : null;
        });
      }
    }
  }
  for (const [s, c] of Object.entries(MENU_DOT)) out[`dot-${s}.png`] = menuDot(c);
  return out;
}
