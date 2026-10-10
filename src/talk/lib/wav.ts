/** PCM16 单声道 ↔ WAV,纯函数(口语课落盘两边的声音,探针也用) */

export function wavOfPcm(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** WAV 的 data 块(只认 PCM;不是 WAV 或没有 data 块回 null) */
export function pcmOfWav(buf: Buffer): { pcm: Buffer; rate: number; channels: number } | null {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let p = 12;
  let rate = 0;
  let channels = 0;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const len = buf.readUInt32LE(p + 4);
    if (id === 'fmt ' && p + 24 <= buf.length) { channels = buf.readUInt16LE(p + 10); rate = buf.readUInt32LE(p + 12); }
    if (id === 'data') return { pcm: buf.subarray(p + 8, Math.min(buf.length, p + 8 + len)), rate, channels };
    p += 8 + len + (len & 1);
  }
  return null;
}

/** 一段 PCM16 的均方根,0–1(页面的音量条、探针判「有声」) */
export function rms(pcm: Buffer): number {
  const n = pcm.length >> 1;
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2) / 32768; s += v * v; }
  return Math.sqrt(s / n);
}
