/**
 * HTTP 分段取(Range,RFC 9110 §14):iPad Safari 放视频一定先要 bytes=0-1,拿不到 206 就不放(小课堂的视频)。
 * 只认单段 `bytes=a-b` / `bytes=a-` / `bytes=-n`;多段、写坏的、b < a 的当没给(回整份 200,规范允许);起点越过文件尾 → 416。
 */
export type ByteRange = { start: number; end: number } | 'unsatisfiable' | null;

export function parseRange(header: string | undefined, size: number): ByteRange {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    // 末尾 n 字节
    const n = Number(m[2]);
    if (n === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  if (start >= size) return 'unsatisfiable';
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return end < start ? null : { start, end };
}
