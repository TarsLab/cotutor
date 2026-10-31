/**
 * bake / snap 在浏览器里开的那一页从哪来:临时起一个只听本机的 HTTP 服务,给舞台包(/stage/,和 serve 同一份 dist/stage/ 与字体)
 * 与课包目录(/api/bundles/<id>/…,和 serve 同一条路)。舞台的 ?chalk=bake / ?chalk=snap 两种样子在 src/ui/stage/chalk/tool.ts。
 */
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { bundleAsset, stageAsset, stageBuilt } from '../../http/stage.ts';
import { UsageError } from '../../workspace.ts';

export async function startPageServer(bundlesDir: string): Promise<{ origin: string; close(): Promise<void> }> {
  if (!stageBuilt()) throw new UsageError('舞台包不在(dist/stage/):仓库根 pnpm run build:stage(npm 装的包自带)');
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    void (path.startsWith('/stage/') ? stageAsset(path) : bundleAsset(bundlesDir, path)).then((f) => {
      if (!f) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': f.contentType, 'cache-control': 'no-store' });
      createReadStream(f.file).pipe(res);
    }, () => res.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
