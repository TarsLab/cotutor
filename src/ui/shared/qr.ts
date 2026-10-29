/**
 * 二维码编码器:只做 serve 要的那一小块——字节模式、纠错 M、版本 1–10(够 200 来字节,一条局域网地址三十来字节落在版本 3)。
 * 纯函数零依赖;装不下返回 null,不抛。矩阵 modules[y][x],true = 黑。不含静区,留白是画的人的事。
 * 测试拿 node-qrcode 同一掩码的输出逐格对过(tests/qr.test.ts 里的样本)。
 */

export interface QrCode {
  version: number;
  size: number;
  /** 选中的掩码 0–7 */
  mask: number;
  modules: boolean[][];
}

/** 纠错 M:每块的纠错码字数、块数(下标 = 版本) */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const MAX_VERSION = 10;

/** 这一版能放多少码字(数据 + 纠错) */
function rawCodewords(ver: number): number {
  let bits = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    bits -= (25 * n - 10) * n - 55;
    if (ver >= 7) bits -= 36;
  }
  return Math.floor(bits / 8);
}

function dataCodewords(ver: number): number {
  return rawCodewords(ver) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
}

/* ---------- Reed-Solomon,GF(256) 模 0x11D ---------- */

function gfMul(a: number, b: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((b >>> i) & 1) * a;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j], root);
      if (j + 1 < degree) out[j] ^= out[j + 1];
    }
    root = gfMul(root, 2);
  }
  return out;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const out = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (out.shift() as number);
    out.push(0);
    divisor.forEach((c, i) => (out[i] ^= gfMul(c, factor)));
  }
  return out;
}

/* ---------- 数据 → 码字 ---------- */

function encodeData(bytes: Uint8Array, ver: number): number[] {
  const bits: number[] = [];
  const push = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const cap = dataCodewords(ver) * 8;
  push(0, Math.min(4, cap - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

/** 分块、各算纠错、交错 */
function addEcc(data: number[], ver: number): number[] {
  const nBlocks = NUM_BLOCKS[ver];
  const eccLen = ECC_PER_BLOCK[ver];
  const raw = rawCodewords(ver);
  const nShort = nBlocks - (raw % nBlocks);
  const shortLen = Math.floor(raw / nBlocks) - eccLen;
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  const eccs: number[][] = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const len = shortLen + (i < nShort ? 0 : 1);
    const block = data.slice(k, k + len);
    k += len;
    blocks.push(block);
    eccs.push(rsRemainder(block, divisor));
  }
  const out: number[] = [];
  for (let i = 0; i <= shortLen; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < eccLen; i++) for (const e of eccs) out.push(e[i]);
  return out;
}

/* ---------- 画 ---------- */

interface Grid {
  size: number;
  modules: boolean[][];
  /** 功能图形(定位、校正、时序、格式、版本):不放数据、不吃掩码 */
  isFunction: boolean[][];
}

function newGrid(ver: number): Grid {
  const size = ver * 4 + 17;
  const blank = (): boolean[][] => Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, modules: blank(), isFunction: blank() };
}

function setFn(g: Grid, x: number, y: number, dark: boolean): void {
  if (x < 0 || y < 0 || x >= g.size || y >= g.size) return;
  g.modules[y][x] = dark;
  g.isFunction[y][x] = true;
}

function drawFunctionPatterns(g: Grid, ver: number): void {
  const { size } = g;
  for (let i = 0; i < size; i++) {
    setFn(g, 6, i, i % 2 === 0);
    setFn(g, i, 6, i % 2 === 0);
  }
  // 三个定位图形,连同一圈分隔
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(g, cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  }
  const pos = ALIGN[ver];
  for (const ax of pos) {
    for (const ay of pos) {
      // 撞上定位图形的三个角不画
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(g, ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  drawFormat(g, 0); // 先占位,掩码定了再画真的
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(g, a, b, dark);
      setFn(g, b, a, dark);
    }
  }
}

function drawFormat(g: Grid, mask: number): void {
  const { size } = g;
  const data = mask; // 纠错 M 的两位是 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) setFn(g, 8, i, bit(i));
  setFn(g, 8, 7, bit(6));
  setFn(g, 8, 8, bit(7));
  setFn(g, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFn(g, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) setFn(g, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFn(g, 8, size - 15 + i, bit(i));
  setFn(g, 8, size - 8, true);
}

function drawCodewords(g: Grid, data: number[]): void {
  const { size } = g;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (g.isFunction[y][x] || i >= data.length * 8) continue;
        g.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** 异或,再施一次即还原 */
function applyMask(g: Grid, mask: number): void {
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.isFunction[y][x] && MASKS[mask](x, y)) g.modules[y][x] = !g.modules[y][x];
}

/** 规范的四条惩罚分,越低越好扫 */
function penalty(g: Grid): number {
  const { size, modules: m } = g;
  let score = 0;
  let dark = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < size; i++) {
    lines.push(m[i]);
    lines.push(m.map((row) => row[i]));
  }
  for (const line of lines) {
    // 一:同色连续 5 格起
    for (let i = 0, run = 1; i < size; i++, run++) {
      if (i + 1 < size && line[i + 1] === line[i]) continue;
      if (run >= 5) score += run - 2;
      run = 0;
    }
    // 三:像定位图形的 1011101,一侧带四格白
    for (let i = 0; i + 11 <= size; i++) {
      const s = line.slice(i, i + 11).map((b) => (b ? '1' : '0')).join('');
      if (s === '10111010000' || s === '00001011101') score += 40;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      // 二:2×2 同色
      if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    }
  }
  // 四:黑白比偏离一半
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

/** 编一条文本(UTF-8 字节模式)。forceMask 给测试对样本用;超过版本 10 的容量返回 null */
export function encodeQR(text: string, forceMask?: number): QrCode | null {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  while (ver <= MAX_VERSION && 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver) * 8) ver++;
  if (ver > MAX_VERSION) return null;
  const g = newGrid(ver);
  drawFunctionPatterns(g, ver);
  drawCodewords(g, addEcc(encodeData(bytes, ver), ver));
  let mask = forceMask ?? -1;
  if (!(Number.isInteger(mask) && mask >= 0 && mask <= 7)) {
    let best = Infinity;
    for (let k = 0; k < 8; k++) {
      applyMask(g, k);
      drawFormat(g, k);
      const p = penalty(g);
      if (p < best) {
        best = p;
        mask = k;
      }
      applyMask(g, k);
    }
  }
  applyMask(g, mask);
  drawFormat(g, mask);
  return { version: ver, size: g.size, mask, modules: g.modules };
}
