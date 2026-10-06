/**
 * 发文件的分段取(Range):parseRange 的几种写法;起一个真 HTTP 服务,视频小课堂 /api/kid/lectures/<id>/video.mp4 走 206 / 416 / HEAD。
 * iPad Safari 放视频先要 bytes=0-1,拿不到 206 就不放;拖进度条也靠它。
 */
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-media-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { parseRange } = await import('../src/lib/range.ts');
const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, createHandler } = await import('../src/server/app.ts');

// ---- parseRange
check('没给 / 写坏 / 多段 / 两头空 → 当没给', parseRange(undefined, 100) === null && parseRange('items=0-1', 100) === null && parseRange('bytes=0-1,5-6', 100) === null && parseRange('bytes=-', 100) === null);
check('bytes=0-1 → 头两个字节', JSON.stringify(parseRange('bytes=0-1', 100)) === '{"start":0,"end":1}');
check('bytes=90- → 到尾', JSON.stringify(parseRange('bytes=90-', 100)) === '{"start":90,"end":99}');
check('bytes=-5 → 末尾 5 个;比文件长就从头', JSON.stringify(parseRange('bytes=-5', 100)) === '{"start":95,"end":99}' && JSON.stringify(parseRange('bytes=-500', 100)) === '{"start":0,"end":99}');
check('终点越界截到尾;终点比起点小当没给', JSON.stringify(parseRange('bytes=50-999', 100)) === '{"start":50,"end":99}' && parseRange('bytes=9-3', 100) === null);
check('起点越过文件尾、-0、空文件 → 416', parseRange('bytes=100-', 100) === 'unsatisfiable' && parseRange('bytes=-0', 100) === 'unsatisfiable' && parseRange('bytes=0-1', 0) === 'unsatisfiable');

// ---- 真 HTTP:视频小课堂的 mp4(样本 tests/fixtures/lectures/)
const server = createServer();
try {
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const ws = loadWorkspace(root);
  const VID = '2026-10-06-pingjunfen';
  const src = fileURLToPath(new URL(`./fixtures/lectures/${VID}/`, import.meta.url));
  cpSync(src, join(ws.dirs.lectures, VID), { recursive: true });
  const bytes = readFileSync(join(src, 'video.mp4'));
  const N = bytes.length;
  server.on('request', createHandler(createContext(ws)));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const url = `${base}/api/kid/lectures/${VID}/video.mp4`;
  const get = async (range?: string, method = 'GET') => {
    const r = await fetch(url, { method, headers: range ? { range } : {} });
    return { status: r.status, h: r.headers, body: Buffer.from(await r.arrayBuffer()) };
  };

  const full = await get();
  check('整份:200、video/mp4、accept-ranges、长度、no-cache、内容对', full.status === 200 && full.h.get('content-type') === 'video/mp4' && full.h.get('accept-ranges') === 'bytes' && full.h.get('content-length') === String(N) && full.h.get('cache-control') === 'no-cache' && full.body.equals(bytes), JSON.stringify(Object.fromEntries(full.h)));
  const first = await get('bytes=0-1');
  check('Safari 的头一下 bytes=0-1:206、content-range、两个字节', first.status === 206 && first.h.get('content-range') === `bytes 0-1/${N}` && first.h.get('content-length') === '2' && first.body.equals(bytes.subarray(0, 2)), JSON.stringify(Object.fromEntries(first.h)));
  const mid = await get('bytes=500-');
  const tail = await get('bytes=-10');
  check('中间到尾、末尾 10 个', mid.status === 206 && mid.body.equals(bytes.subarray(500)) && mid.h.get('content-range') === `bytes 500-${N - 1}/${N}` && tail.status === 206 && tail.body.equals(bytes.subarray(N - 10)));
  const over = await get(`bytes=${N}-`);
  check('起点越界:416、content-range bytes */<长度>', over.status === 416 && over.h.get('content-range') === `bytes */${N}` && over.body.length === 0);
  const multi = await get('bytes=0-1,5-6');
  check('多段:当没给,回整份 200', multi.status === 200 && multi.body.length === N);
  const head = await get(undefined, 'HEAD');
  check('HEAD:200、长度、没正文', head.status === 200 && head.h.get('content-length') === String(N) && head.h.get('accept-ranges') === 'bytes' && head.body.length === 0);
  const miss = await fetch(`${base}/api/kid/lectures/2026-01-01-nope/video.mp4`);
  const bad = await fetch(`${base}/api/kid/lectures/Ping/video.mp4`);
  const up = await fetch(`${base}/api/kid/lectures/..%2Fcotutor.json/video.mp4`);
  check('没有这一课 404;id 不合规、想跳出目录都不认', miss.status === 404 && bad.status === 404 && up.status === 404);
} finally {
  server.close();
  rmSync(home, { recursive: true, force: true });
}
done();
