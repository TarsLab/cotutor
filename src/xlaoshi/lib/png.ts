/**
 * 把某一刻的笔迹画成一张 PNG(给家长的 Claude Code 用 Read 看图,也给页面当缩略图)。
 * 不加依赖:白底、每笔沿线盖圆点,橡皮盖白;不抗锯齿,看得清画了什么就够。
 */
import { deflateSync } from 'node:zlib';
import { visibleAt, type Strokes } from './strokes.ts';

const WHITE = [255, 255, 255] as const;

function rgb(c: string): readonly [number, number, number] {
  if (c === 'erase') return WHITE;
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/** t 那一刻的画面;宽 width 像素,高按画板比例 */
export function framePng(s: Strokes, t: number, width = 800): Buffer {
  const k = width / s.size.w;
  const W = Math.round(width);
  const H = Math.max(1, Math.round(s.size.h * k));
  const px = Buffer.alloc(W * H * 3, 255);
  const dot = (cx: number, cy: number, r: number, col: readonly number[]): void => {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(H - 1, Math.ceil(cy + r));
    const rr = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > rr) continue;
        const i = (y * W + x) * 3;
        px[i] = col[0];
        px[i + 1] = col[1];
        px[i + 2] = col[2];
      }
    }
  };
  for (const st of visibleAt(s, t)) {
    const col = rgb(st.c);
    const r = Math.max(1, (st.w * k) / 2);
    const step = Math.max(0.5, r * 0.6);
    let [px0, py0] = [st.pts[0][0] * k, st.pts[0][1] * k];
    dot(px0, py0, r, col);
    for (let i = 1; i < st.pts.length; i++) {
      const x1 = st.pts[i][0] * k;
      const y1 = st.pts[i][1] * k;
      const d = Math.hypot(x1 - px0, y1 - py0);
      const n = Math.max(1, Math.ceil(d / step));
      for (let j = 1; j <= n; j++) dot(px0 + ((x1 - px0) * j) / n, py0 + ((y1 - py0) * j) / n, r, col);
      px0 = x1;
      py0 = y1;
    }
  }
  return encodePng(W, H, px);
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePng(w: number, h: number, px: Buffer): Buffer {
  const stride = w * 3;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
