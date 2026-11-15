/** 页面交来的 jpeg(data:image/jpeg;base64,…)→ 字节;不是 jpeg、base64 长过 maxB64 回 null(挡住塞进来的大文件) */
export function jpegFromDataUrl(v: unknown, maxB64: number): Buffer | null {
  const m = typeof v === 'string' ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(v) : null;
  if (!m || m[1].length > maxB64) return null;
  const buf = Buffer.from(m[1], 'base64');
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 ? buf : null;
}
