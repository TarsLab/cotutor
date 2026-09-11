/**
 * 主屏幕图标与 web app manifest:iPad / iPhone「添加到主屏幕」用。
 * 图标按尺寸**现画**,不往仓里塞图片文件:没有字体可用,所以是纯几何的标记(橙底 + 纸色圆角面板 + 三条讲稿线),
 * 3 倍超采样抗锯齿,PNG 自己编(只用 node:zlib)。同一尺寸只画一次,之后走缓存。
 */
import { deflateSync } from 'node:zlib';

/** 页面上给出的尺寸:180 = apple-touch-icon,192 / 512 = manifest */
export const ICON_SIZES = [180, 192, 512] as const;

type RGB = readonly [number, number, number];
const GROUND: RGB = [0xe8, 0x74, 0x3b]; // --accent
const PANEL: RGB = [0xff, 0xfd, 0xf8]; // --card
const INK: RGB = [0x2b, 0x2b, 0x2b]; // --ink

/** 圆角矩形,坐标是 0..1 的比例(按尺寸放大);后面的盖前面的 */
interface Shape {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
  c: RGB;
}
const SHAPES: Shape[] = [
  { x0: 0.14, y0: 0.16, x1: 0.86, y1: 0.84, r: 0.07, c: PANEL },
  { x0: 0.24, y0: 0.3, x1: 0.66, y1: 0.365, r: 0.033, c: GROUND },
  { x0: 0.24, y0: 0.4675, x1: 0.76, y1: 0.5325, r: 0.033, c: INK },
  { x0: 0.24, y0: 0.635, x1: 0.56, y1: 0.7, r: 0.033, c: INK },
];

function inside(s: Shape, x: number, y: number): boolean {
  if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) return false;
  const r = Math.min(s.r, (s.x1 - s.x0) / 2, (s.y1 - s.y0) / 2);
  const cx = x < s.x0 + r ? s.x0 + r : x > s.x1 - r ? s.x1 - r : x;
  const cy = y < s.y0 + r ? s.y0 + r : y > s.y1 - r ? s.y1 - r : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

const SS = 3;
const cache = new Map<number, Buffer>();

/** 画一张 size×size 的图标 PNG(不透明,iOS 的图标不该有透明) */
export function appIconPng(size: number): Buffer {
  const n = Math.min(1024, Math.max(16, Math.round(size)));
  const hit = cache.get(n);
  if (hit) return hit;
  const px = Buffer.alloc(n * n * 3);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x + (sx + 0.5) / SS) / n;
          const uy = (y + (sy + 0.5) / SS) / n;
          let c = GROUND;
          for (const s of SHAPES) if (inside(s, ux, uy)) c = s.c;
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const k = (y * n + x) * 3;
      const m = SS * SS;
      px[k] = Math.round(r / m);
      px[k + 1] = Math.round(g / m);
      px[k + 2] = Math.round(b / m);
    }
  }
  const out = encodePng(n, px);
  cache.set(n, out);
  return out;
}

/** manifest:iOS 16.4+ 与安卓都按它装;apple-* meta 留着给老系统 */
export function webManifest(title: string): Record<string, unknown> {
  const name = title.trim() || 'cotutor';
  return {
    name,
    short_name: name,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f6f4ee',
    theme_color: '#f6f4ee',
    lang: 'zh-CN',
    icons: ICON_SIZES.filter((s) => s !== 180).map((s) => ({ src: `/icon-${s}.png`, sizes: `${s}x${s}`, type: 'image/png' })),
  };
}

// ---- 最小 PNG 编码器(8 位真彩,每行 filter 0) ----

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(n: number, px: Buffer): Buffer {
  const stride = n * 3;
  const raw = Buffer.alloc(n * (stride + 1));
  for (let y = 0; y < n; y++) {
    raw[y * (stride + 1)] = 0;
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 2; // 真彩,无 alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
