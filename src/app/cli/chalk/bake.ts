/**
 * bake:课包 → bake.json(《重新设计.md》第 4 步;格式在 core/bake.ts)。起临时 serve,playwright 打开播放页的 ?bake=<id>,
 * 在浏览器里用 excalidraw 静态导出一次、量好路径;运行时就不用 excalidraw 与 SMIL 了。
 * source.hash 是画面的指纹(skeletons + background):scene.json 的画面变了,bakeIsFresh 就是 false,要重烤;配音与时长不算画面。
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { bakeMatches, pictureHash, type BakedLesson } from '../core/bake.ts';
import { startServer } from './serve.ts';

export const BAKE_FILE = 'bake.json';

export { pictureHash };

function excalidrawVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require('@excalidraw/excalidraw/package.json') as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

/** 课包有没有烤过、烤的是不是现在这幅画面 */
export async function bakeIsFresh(bundleDir: string): Promise<boolean> {
  try {
    const scene = JSON.parse(await readFile(join(bundleDir, 'scene.json'), 'utf8')) as Record<string, unknown>;
    return bakeMatches(JSON.parse(await readFile(join(bundleDir, BAKE_FILE), 'utf8')), scene);
  } catch {
    return false;
  }
}

/** 烤一个或几个课包(同一个浏览器);返回每个写到哪 */
export async function bakeBundles(bundlesDir: string, ids: readonly string[]): Promise<{ id: string; file: string; elements: number; bytes: number }[]> {
  let chromium: (typeof import('playwright'))['chromium'];
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('bake 需要 playwright(optionalDependency,npm 装时会带上;没装就 pnpm add playwright)');
  }
  const server = await startServer({ port: 0, bundlesDir });
  const browser = await chromium.launch();
  const out: { id: string; file: string; elements: number; bytes: number }[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    for (const id of ids) {
      await page.goto(`http://127.0.0.1:${server.port}/?bake=${encodeURIComponent(id)}`);
      await page.waitForFunction(`document.body.dataset.drawtellBaked === '1'`, null, { timeout: 120_000 });
      const err = await page.evaluate(() => (window as unknown as { __drawtellBakeError?: string }).__drawtellBakeError ?? null);
      if (err) throw new Error(`课包 '${id}' 烤不了:${err}`);
      const picture = (await page.evaluate(() => (window as unknown as { __drawtellBake: unknown }).__drawtellBake)) as Omit<BakedLesson, 'source'>;
      const scene = JSON.parse(await readFile(join(bundlesDir, id, 'scene.json'), 'utf8')) as Record<string, unknown>;
      const baked: BakedLesson = { ...picture, source: { excalidraw: excalidrawVersion(), hash: pictureHash(scene) } };
      const file = join(bundlesDir, id, BAKE_FILE);
      const text = `${JSON.stringify(baked)}\n`;
      await writeFile(file, text);
      out.push({ id, file, elements: baked.elements.length, bytes: Buffer.byteLength(text) });
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return out;
}
