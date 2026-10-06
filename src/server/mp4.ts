/**
 * mp4 的时长(视频小课堂的课长,《小课堂设计.md》§八第 4 步):走顶层的盒子找 moov,再在里面找 mvhd,读 timescale 与 duration。
 * 只读盒子头,不把整个文件读进来(moov 在末尾也行);认不出来回 null,不抛。
 */
import { open } from 'node:fs/promises';

export async function mp4DurationMs(file: string): Promise<number | null> {
  const fh = await open(file, 'r').catch(() => null);
  if (!fh) return null;
  try {
    const size = (await fh.stat()).size;
    const read = async (at: number, n: number): Promise<Buffer> => {
      const b = Buffer.alloc(n);
      const { bytesRead } = await fh.read(b, 0, n, at);
      return b.subarray(0, bytesRead);
    };
    /** [from, to) 里找某个盒子:回它的正文起点与终点 */
    const find = async (from: number, to: number, type: string): Promise<{ body: number; end: number } | null> => {
      let at = from;
      while (at + 8 <= to) {
        const h = await read(at, 16);
        if (h.length < 8) return null;
        let len = h.readUInt32BE(0);
        let head = 8;
        if (len === 1) { if (h.length < 16) return null; len = Number(h.readBigUInt64BE(8)); head = 16; }
        else if (len === 0) len = to - at;
        if (len < head) return null;
        if (h.toString('latin1', 4, 8) === type) return { body: at + head, end: Math.min(at + len, to) };
        at += len;
      }
      return null;
    };
    const moov = await find(0, size, 'moov');
    const mvhd = moov ? await find(moov.body, moov.end, 'mvhd') : null;
    if (!mvhd) return null;
    const b = await read(mvhd.body, 32);
    const v1 = b[0] === 1;
    const scale = v1 ? b.readUInt32BE(20) : b.readUInt32BE(12);
    const dur = v1 ? Number(b.readBigUInt64BE(24)) : b.readUInt32BE(16);
    return scale > 0 ? Math.round((dur / scale) * 1000) : null;
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}
