/**
 * 主屏幕图标与 web app manifest:iPad / iPhone「添加到主屏幕」用(主屏幕从 manifest 取图标,页面不写 apple-touch-icon)。
 * 图标是 cotutor 的双 C:陶土色底、白线,同工作台页头那块;不透明(iOS 的图标不该有透明)。
 * 按尺寸现画(src/ui/shared/favicon.ts),同一尺寸只画一次,之后走缓存。
 */
import { homeScreenPng } from './favicon.ts';

/** 给得出的尺寸:192 / 512 进 manifest;180 是 apple-touch-icon 的尺寸,页面不再引,路由留着给老的主屏幕快捷方式 */
export const ICON_SIZES = [180, 192, 512] as const;

const cache = new Map<number, Buffer>();

/** 画一张 size×size 的图标 PNG(不透明) */
export function appIconPng(size: number): Buffer {
  const n = Math.min(1024, Math.max(16, Math.round(size)));
  const hit = cache.get(n);
  if (hit) return hit;
  const out = homeScreenPng(n);
  cache.set(n, out);
  return out;
}

/** manifest:iOS 16.4+ 与安卓都按它装;apple-* meta 留着给老系统。家长板书页有自己的一份(start_url / scope 不同,加到主屏幕才分得开) */
export function webManifest(title: string, opts: { startUrl?: string; scope?: string } = {}): Record<string, unknown> {
  const name = title.trim() || 'cotutor';
  return {
    name,
    short_name: name,
    start_url: opts.startUrl ?? '/',
    scope: opts.scope ?? '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f6f4ee',
    theme_color: '#f6f4ee',
    lang: 'zh-CN',
    icons: ICON_SIZES.filter((s) => s !== 180).map((s) => ({ src: `/icon-${s}.png`, sizes: `${s}x${s}`, type: 'image/png' })),
  };
}
