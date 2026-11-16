/** 页面交来的 jpeg(data:image/jpeg;base64,…)→ 字节;不是 jpeg、base64 长过 maxB64 回 null(挡住塞进来的大文件) */
export function jpegFromDataUrl(v: unknown, maxB64: number): Buffer | null {
  const m = typeof v === 'string' ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(v) : null;
  if (!m || m[1].length > maxB64) return null;
  const buf = Buffer.from(m[1], 'base64');
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 ? buf : null;
}

/**
 * 一张图的像素宽高(只读文件头,不解码):jpeg 找 SOF 段,png 读 IHDR。读不出回 null。
 * 照片页照它排(一张宽 1000,高照宽高比;src/board/lesson.ts 的 photoSheetBox),服务端和孩子端(上传时回给页面)用同一个数。
 * 不看 EXIF 的方向:孩子端上传前已经画进画布、导成 jpeg,方向是正的
 */
export function imageSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    return w > 0 && h > 0 ? { w, h } : null;
  }
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    // 没有长度的段:填充、RST、SOI、EOI
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xd9) return null;
    const len = buf.readUInt16BE(i + 2);
    // SOF0–SOF15,除了 DHT(c4)、JPG(c8)、DAC(cc)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const h = buf.readUInt16BE(i + 5), w = buf.readUInt16BE(i + 7);
      return w > 0 && h > 0 ? { w, h } : null;
    }
    i += 2 + len;
  }
  return null;
}
