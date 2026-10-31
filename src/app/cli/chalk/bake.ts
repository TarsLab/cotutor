/**
 * bake:课包 → bake.json(格式在 src/chalk/paint.ts)。起临时页面服务(./serve.ts)与本机 Chrome(./browser.ts),开舞台的 ?chalk=bake,
 * 在浏览器里用 excalidraw 静态导出一次、量好路径;孩子端播放(src/ui/stage/chalk/render.ts)与服务端出图(renderFrameSvg)就不用 excalidraw 了。
 * source.hash 是画面的指纹(skeletons + background):scene.json 的画面变了 bakeIsFresh 就是 false,要重烤;配音与时长不算画面。
 * 服务端(src/runtime/lecture.ts 的 ensureBaked)遇到没烤过的课包,起 cotutor chalk bake 补烤。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { bakeMatches, pictureHash, type BakedLesson } from '../../../chalk/paint.ts';
import { withBrowser } from './browser.ts';
import { startPageServer } from './serve.ts';

export const BAKE_FILE = 'bake.json';

function excalidrawVersion(): string {
  try {
    return (createRequire(import.meta.url)('@excalidraw/excalidraw/package.json') as { version: string }).version;
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
  const server = await startPageServer(bundlesDir);
  try {
    return await withBrowser(async (page) => {
      const out: { id: string; file: string; elements: number; bytes: number }[] = [];
      for (const id of ids) {
        await page.goto(`${server.origin}/stage/?chalk=bake&bundle=${encodeURIComponent(`/api/bundles/${id}/`)}`);
        await page.waitFor(`document.body.dataset.chalkDone === '1'`, 120_000);
        const err = await page.evaluate<string | null>('window.__chalkError ?? null');
        if (err) throw new Error(`课包 '${id}' 烤不了:${err}`);
        const picture = JSON.parse(await page.evaluate<string>('JSON.stringify(window.__chalkBake)')) as Omit<BakedLesson, 'source'>;
        const scene = JSON.parse(await readFile(join(bundlesDir, id, 'scene.json'), 'utf8')) as Record<string, unknown>;
        const baked: BakedLesson = { ...picture, source: { excalidraw: excalidrawVersion(), hash: pictureHash(scene) } };
        const file = join(bundlesDir, id, BAKE_FILE);
        const text = `${JSON.stringify(baked)}\n`;
        await writeFile(file, text);
        out.push({ id, file, elements: baked.elements.length, bytes: Buffer.byteLength(text) });
      }
      return out;
    });
  } finally {
    await server.close();
  }
}
