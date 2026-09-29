/**
 * mp3 的时长(录像要知道每句念多久,《家长录像设计.md》§3.4):跳过 ID3v2,有 Xing / Info 头就按它记的帧数,没有就逐帧数。
 * 只认 Layer III(voxtell 出的是 LAME 的 MPEG-2 Layer III,24kHz、每帧 576 个样本)。坏文件、不是 mp3 → null,不抛。
 */

/** 比特率表(kbps):[MPEG-1][下标]、[MPEG-2 / 2.5][下标];0 与 15 不合法 */
const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
/** 采样率表:按版本位(0 = 2.5、2 = 2、3 = 1) */
const SAMPLE_RATES: Record<number, number[]> = { 0: [11025, 12000, 8000], 2: [22050, 24000, 16000], 3: [44100, 48000, 32000] };

interface FrameHeader {
  /** 这一帧多少字节(含头) */
  size: number;
  samples: number;
  rate: number;
  mono: boolean;
  v1: boolean;
}

function frameAt(b: Uint8Array, i: number): FrameHeader | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1] >> 3) & 3;
  const layer = (b[i + 1] >> 1) & 3;
  if (version === 1 || layer !== 1) return null;
  const v1 = version === 3;
  const kbps = (v1 ? BITRATES_V1 : BITRATES_V2)[b[i + 2] >> 4];
  const rate = SAMPLE_RATES[version][(b[i + 2] >> 2) & 3];
  if (!kbps || !rate) return null;
  const pad = (b[i + 2] >> 1) & 1;
  const samples = v1 ? 1152 : 576;
  return { size: Math.floor((samples / 8) * kbps * 1000 / rate) + pad, samples, rate, mono: (b[i + 3] >> 6) === 3, v1 };
}

/** 第一帧里的 Xing / Info 头记的总帧数(没有、或没记帧数 → null) */
function xingFrames(b: Uint8Array, i: number, f: FrameHeader): number | null {
  const side = f.v1 ? (f.mono ? 17 : 32) : (f.mono ? 9 : 17);
  const at = i + 4 + side;
  if (at + 12 > b.length) return null;
  const tag = String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
  if (tag !== 'Xing' && tag !== 'Info') return null;
  if (!(b[at + 7] & 1)) return null;
  return ((b[at + 8] << 24) | (b[at + 9] << 16) | (b[at + 10] << 8) | b[at + 11]) >>> 0;
}

export function mp3DurationMs(b: Uint8Array): number | null {
  let i = 0;
  if (b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
    if (b[5] & 0x10) i += 10;
  }
  // 头后面可能有几个字节的垃圾:往后找第一个像样的帧(后面紧跟着也是帧才算)
  let first: FrameHeader | null = null;
  for (let tries = 0; i < b.length && tries < 4096; i++, tries++) {
    const f = frameAt(b, i);
    if (f && (i + f.size >= b.length || frameAt(b, i + f.size))) { first = f; break; }
  }
  if (!first) return null;
  const xing = xingFrames(b, i, first);
  if (xing) return Math.round((xing * first.samples * 1000) / first.rate);
  let samples = 0;
  let rate = first.rate;
  for (let f: FrameHeader | null = first; f; f = frameAt(b, i)) {
    samples += f.samples;
    rate = f.rate;
    i += f.size;
  }
  return samples ? Math.round((samples * 1000) / rate) : null;
}
