/**
 * 把一个文件发出去:不在 404,支持分段取(Range,iPad Safari 放 mp4 非这样不可;视频小课堂拖进度条也靠它)。服务与 mock 共用。
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseRange } from '../lib/range.ts';

export async function sendFile(req: IncomingMessage, res: ServerResponse, r: { status: number; file: string; contentType?: string; cacheControl?: string }): Promise<void> {
  const st = await stat(r.file).catch(() => null);
  if (!st?.isFile()) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  const head = { 'content-type': r.contentType ?? 'application/octet-stream', 'cache-control': r.cacheControl ?? 'private, max-age=86400', 'accept-ranges': 'bytes' };
  const range = r.status === 200 ? parseRange(req.headers.range, st.size) : null;
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...head, 'content-range': `bytes */${st.size}` });
    res.end();
    return;
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : st.size - 1;
  res.writeHead(range ? 206 : r.status, { ...head, 'content-length': String(st.size ? end - start + 1 : 0), ...(range ? { 'content-range': `bytes ${start}-${end}/${st.size}` } : {}) });
  if (req.method === 'HEAD' || !st.size) { res.end(); return; }
  createReadStream(r.file, { start, end }).on('error', () => res.end()).pipe(res);
}
