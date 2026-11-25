/**
 * 最小 PNG 编解码(8 位,只用 node:zlib):编码给主屏幕图标与网页图标现画用(不往仓里塞图片文件)、课本分块的预览图(src/app/cli/textbook.ts)用;
 * 解码只给预览图读页图(pdftoppm、PyMuPDF 出的 8 位灰度 / 真彩、不隔行)。
 */
import { deflateSync, inflateSync } from 'node:zlib';

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

/** n = 宽,h = 高(缺省同宽,图标是方的);px 一行接一行,每像素 channels 个字节 */
export function encodePng(n: number, px: Buffer, channels: 3 | 4 = 3, h = n): Buffer {
  const stride = n * channels;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = channels === 4 ? 6 : 2; // 真彩,6 = 带 alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 读一张 8 位、不隔行的 PNG(灰度、灰度带 alpha、真彩、真彩带 alpha),回 RGB;别的(调色板、16 位、隔行)回 null */
export function decodePng(buf: Buffer): { w: number; h: number; px: Buffer } | null {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let w = 0, h = 0, depth = 0, type = -1, interlace = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at + 8 <= buf.length;) {
    const len = buf.readUInt32BE(at), kind = buf.toString('ascii', at + 4, at + 8), data = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    at += len + 12;
  }
  const ch = ({ 0: 1, 4: 2, 2: 3, 6: 4 } as Record<number, number>)[type];
  if (!w || !h || depth !== 8 || interlace || !ch) return null;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      const pr = (): number => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
      cur[i] = (line[i] + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? pr() : 0)) & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3, s = x * ch;
      if (ch <= 2) { px[o] = px[o + 1] = px[o + 2] = cur[s]; } else { px[o] = cur[s]; px[o + 1] = cur[s + 1]; px[o + 2] = cur[s + 2]; }
    }
    cur.copy(prev);
  }
  return { w, h, px };
}
