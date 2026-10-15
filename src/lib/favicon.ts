/**
 * 网页图标(浏览器标签上那枚):一位老师的页面用这位老师的头像,首页与不归哪位老师的页面(听写、口语课、家长端、工作台)用三色 C、脸空着。
 * 画法照孩子端的头像(老师颜色的 C 形开口环、开口朝右 72°,白底圆里放头像),只为标签上的 16 px 把环加粗。
 * 三色 C:三门主科色,从右上起逆时针数学、语文、英语,段间留缝。
 * SVG 给认 SVG 的浏览器,脸里画 emoji / 首字 / 缩到 64×64 内联的头像图(图标里的 SVG 读不了别的地址);
 * PNG 给不认的(Safari),没有字体,只画环与白底圆,脸空着。
 */
import { inflateSync } from 'node:zlib';
import { encodePng } from './icon.ts';
import { SUBJECT_COLORS } from './tutor-color.ts';

/** 三色 C 的三段,顺时针从下面的开口端起:英语(下)、语文(左)、数学(上) */
export const HOME_RING: readonly string[] = [SUBJECT_COLORS['英语'], SUBJECT_COLORS['语文'], SUBJECT_COLORS['数学']];

/** 网页上引图标的两行;tutor 给了就是那位老师的。PNG 带 sizes 写在前面,Chrome 才不会放着 SVG 不用 */
export function faviconLinks(tutor?: string | null): string {
  const q = tutor ? `?tutor=${encodeURIComponent(tutor)}` : '';
  return `<link rel="icon" id="fav-png" href="/favicon-32.png${q}" sizes="32x32" type="image/png">\n<link rel="icon" id="fav-svg" href="/favicon.svg${q}" type="image/svg+xml">`;
}

export interface FaviconFace {
  color: string;
  /** cotutor.json 的 avatar:emoji、字,或图片相对路径(图片要另读成 image) */
  avatar?: string | null;
  subject?: string | null;
  display?: string | null;
  image?: { data: Uint8Array; type: string } | null;
}

/** /favicon.svg、/favicon-32.png(/favicon.ico 给同一张 PNG);?tutor= 查得到就画那位老师,否则三色 C。不是这几条路由 null */
export async function faviconResponse(path: string, tutor: string | null, face: (name: string) => Promise<FaviconFace | null>): Promise<{ body: Uint8Array; contentType: string } | null> {
  const svg = path === '/favicon.svg';
  if (!svg && path !== '/favicon-32.png' && path !== '/favicon.ico') return null;
  const f = tutor ? await face(tutor) : null;
  if (svg) return { body: Buffer.from(f ? tutorFaviconSvg(f) : homeFaviconSvg()), contentType: 'image/svg+xml; charset=utf-8' };
  return { body: faviconPng(f ? [f.color] : HOME_RING), contentType: 'image/png' };
}

// ---- 几何:64 见方,按标签上的 16 px 那一档 ----

const SW = 10; // 环粗(孩子端头像是直径的 7%,16 px 时不到 1 个像素)
const R = 26; // 环心半径
const FACE_R = 19.5;
const A0 = 36; // 开口朝右 72°:环从 36° 顺时针画到 324°(SVG 角度,0 = 右、90 = 下)
const A1 = 324;
const GAP = 13; // 三色段间的缝(度)
const PAPER = '#ffffff';

interface Seg {
  a1: number;
  a2: number;
  color: string;
}
/** 环分几段就几种颜色;段内平头,两个开口端另画圆头 */
function segs(colors: readonly string[]): Seg[] {
  const span = (A1 - A0) / colors.length;
  return colors.map((color, i) => ({ a1: A0 + i * span + (i === 0 ? 0 : GAP / 2), a2: A0 + (i + 1) * span - (i === colors.length - 1 ? 0 : GAP / 2), color }));
}
const f2 = (n: number): number => Math.round(n * 100) / 100;
const at = (deg: number): [number, number] => [32 + R * Math.cos((deg * Math.PI) / 180), 32 + R * Math.sin((deg * Math.PI) / 180)];

// ---- SVG ----

const wrap = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${body}</svg>`;
const FACE_DISK = `<circle cx="32" cy="32" r="${FACE_R}" fill="${PAPER}"/>`;

function ringSvg(colors: readonly string[]): string {
  const ss = segs(colors);
  const paths = ss.map((s) => {
    const [x1, y1] = at(s.a1).map(f2);
    const [x2, y2] = at(s.a2).map(f2);
    return `<path d="M${x1} ${y1}A${R} ${R} 0 ${s.a2 - s.a1 > 180 ? 1 : 0} 1 ${x2} ${y2}" fill="none" stroke="${s.color}" stroke-width="${SW}"/>`;
  });
  const [sx, sy] = at(A0).map(f2);
  const [ex, ey] = at(A1).map(f2);
  return paths.join('') + `<circle cx="${sx}" cy="${sy}" r="${SW / 2}" fill="${ss[0].color}"/><circle cx="${ex}" cy="${ey}" r="${SW / 2}" fill="${ss[ss.length - 1].color}"/>`;
}

export function homeFaviconSvg(): string {
  return wrap(FACE_DISK + ringSvg(HOME_RING));
}

const IMAGE_PATH = /\.(png|jpe?g|webp|gif|svg)$/i;
const xml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const firstGrapheme = (s: string | null | undefined): string => {
  const t = (s ?? '').trim();
  if (!t) return '';
  for (const g of new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(t)) return g.segment;
  return '';
};

export function tutorFaviconSvg(face: FaviconFace): string {
  const color = /^#[0-9a-f]{6}$/i.test(face.color) ? face.color : '#6b6458';
  const uri = face.image ? avatarDataUri(face.image) : null;
  let inner = '';
  if (uri) {
    const x = f2(32 - FACE_R);
    inner = `<clipPath id="f"><circle cx="32" cy="32" r="${FACE_R}"/></clipPath><image href="${uri}" x="${x}" y="${x}" width="${FACE_R * 2}" height="${FACE_R * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#f)"/>`;
  } else {
    // 和孩子端一样:avatar 是字就画它,是图片路径(读不到)或没写就画学科 / 名字的首字
    const g = (face.avatar && !IMAGE_PATH.test(face.avatar) ? firstGrapheme(face.avatar) : '') || firstGrapheme(face.subject) || firstGrapheme(face.display);
    if (g) {
      const emoji = /\p{Extended_Pictographic}/u.test(g);
      const font = emoji ? "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif" : "'Songti SC','STSong','Noto Serif SC',serif";
      inner = `<text x="32" y="${f2(32 + FACE_R * (emoji ? 0.03 : 0.05))}" font-size="${f2(FACE_R * (emoji ? 1.2 : 1.12))}" font-family="${font}" font-weight="900" text-anchor="middle" dominant-baseline="central" fill="${color}">${xml(g)}</text>`;
    }
  }
  return wrap(FACE_DISK + ringSvg([color]) + inner);
}

/** 头像图内联成 data URI:PNG 缩到 64×64 再编;别的格式(或解不了的 PNG)小于 48 KB 原样内联,再大就不画(退回首字) */
const RAW_LIMIT = 48 * 1024;
function avatarDataUri(img: { data: Uint8Array; type: string }): string | null {
  const data = Buffer.from(img.data);
  if (img.type === 'image/png') {
    const small = shrinkPng(data, 64);
    if (small) return `data:image/png;base64,${small.toString('base64')}`;
  }
  return data.length <= RAW_LIMIT ? `data:${img.type};base64,${data.toString('base64')}` : null;
}

// ---- 头像 PNG 缩小:解 8 位 RGB / RGBA、不隔行的 PNG(figshot 出的那种),取中间的正方形,按块平均 ----

function decodePng(buf: Buffer): { w: number; h: number; rgba: Buffer } | null {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let type = -1;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const t = buf.toString('ascii', off + 4, off + 8);
    const d = buf.subarray(off + 8, off + 8 + len);
    if (t === 'IHDR') {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      depth = d[8];
      type = d[9];
      interlace = d[12];
    } else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    off += 12 + len;
  }
  const ch = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!ch || depth !== 8 || interlace !== 0 || !w || !h || w * h > 4096 * 4096) return null;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  if (raw.length < h * (stride + 1)) return null;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const base = y * (stride + 1);
    const ft = raw[base];
    for (let i = 0; i < stride; i++) {
      const x = raw[base + 1 + i];
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v: number;
      if (ft === 0) v = x;
      else if (ft === 1) v = x + a;
      else if (ft === 2) v = x + b;
      else if (ft === 3) v = x + ((a + b) >> 1);
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else return null;
      cur[i] = v & 0xff;
    }
    for (let px = 0; px < w; px++) {
      const o = (y * w + px) * 4;
      out[o] = cur[px * ch];
      out[o + 1] = cur[px * ch + 1];
      out[o + 2] = cur[px * ch + 2];
      out[o + 3] = ch === 4 ? cur[px * ch + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { w, h, rgba: out };
}

export function shrinkPng(buf: Buffer, n: number): Buffer | null {
  let img: ReturnType<typeof decodePng>;
  try {
    img = decodePng(buf);
  } catch {
    return null;
  }
  if (!img) return null;
  const s = Math.min(img.w, img.h);
  const ox = Math.floor((img.w - s) / 2);
  const oy = Math.floor((img.h - s) / 2);
  const out = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    const y0 = oy + Math.floor((y * s) / n);
    const y1 = Math.max(y0 + 1, oy + Math.floor(((y + 1) * s) / n));
    for (let x = 0; x < n; x++) {
      const x0 = ox + Math.floor((x * s) / n);
      const x1 = Math.max(x0 + 1, ox + Math.floor(((x + 1) * s) / n));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let k = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * img.w + xx) * 4;
          const al = img.rgba[o + 3];
          r += img.rgba[o] * al;
          g += img.rgba[o + 1] * al;
          b += img.rgba[o + 2] * al;
          a += al;
          k++;
        }
      }
      const o = (y * n + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / k);
    }
  }
  return encodePng(n, out, 4);
}

// ---- PNG:环与白底圆,4×4 超采样,透明底 ----

const rgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const v = m ? parseInt(m[1], 16) : 0x6b6458;
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
};
const SS = 4;
const pngCache = new Map<string, Buffer>();

export function faviconPng(colors: readonly string[], size = 32): Buffer {
  const n = Math.min(256, Math.max(16, Math.round(size)));
  const key = `${colors.join(',')}@${n}`;
  const hit = pngCache.get(key);
  if (hit) return hit;
  const ss = segs(colors).map((s) => ({ ...s, c: rgb(s.color) }));
  const [sx, sy] = at(A0);
  const [ex, ey] = at(A1);
  const paper = rgb(PAPER);
  const half = SW / 2;
  const colorAt = (u: number, v: number): [number, number, number] | null => {
    const dx = u - 32;
    const dy = v - 32;
    const d = Math.hypot(dx, dy);
    if (d <= FACE_R) return paper;
    if (Math.hypot(u - sx, v - sy) <= half) return ss[0].c;
    if (Math.hypot(u - ex, v - ey) <= half) return ss[ss.length - 1].c;
    if (Math.abs(d - R) > half) return null;
    const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    return ss.find((s) => deg >= s.a1 && deg <= s.a2)?.c ?? null;
  };
  const px = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let k = 0;
      for (let sy2 = 0; sy2 < SS; sy2++) {
        for (let sx2 = 0; sx2 < SS; sx2++) {
          const c = colorAt(((x + (sx2 + 0.5) / SS) / n) * 64, ((y + (sy2 + 0.5) / SS) / n) * 64);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          k++;
        }
      }
      const o = (y * n + x) * 4;
      if (k) {
        px[o] = Math.round(r / k);
        px[o + 1] = Math.round(g / k);
        px[o + 2] = Math.round(b / k);
      }
      px[o + 3] = Math.round((255 * k) / (SS * SS));
    }
  }
  const out = encodePng(n, px, 4);
  pngCache.set(key, out);
  return out;
}
