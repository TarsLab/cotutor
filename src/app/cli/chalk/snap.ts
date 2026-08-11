/**
 * snap:阶梯层 4 —— 起临时 serve,playwright 逐步打开播放页(?scene=&step=&bare=1)截 keyframe。
 * 必须走真浏览器 + 真播放器:skeleton→元素依赖浏览器字体测量(契约 1),
 * 截到的和孩子看到的是同一渲染器,零偏差。
 * 产物:<out>/step-<n>.png(n=0 空板起,0 号图配题面)+ index.json(图↔讲稿对照,给检验 skill 吃)。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ChalkScene } from '../player/types';
import { startServer } from './serve.ts';

export interface SnapOptions {
  scene: ChalkScene;
  bundlesDir: string;
  outDir: string;
  /** 只截这一步(0 = 空板);缺省 0..steps 全截 */
  step?: number;
}

export interface Shot {
  step: number;
  file: string;
  /** 该步讲稿(step 0 为题面):检验 skill 逐张对照"画面 ↔ 讲稿" */
  line: string;
}

const READY_EXPR = `document.body.dataset.drawtellReady === '1' || (document.querySelector('.bench-problem')?.textContent ?? '').includes('⚠')`;
const ERROR_EXPR = `document.body.dataset.drawtellReady === '1' ? null : (document.querySelector('.bench-problem')?.textContent ?? null)`;

export async function snapScene({ scene, bundlesDir, outDir, step }: SnapOptions): Promise<Shot[]> {
  let chromium: (typeof import('playwright'))['chromium'];
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('snap 需要 playwright(devDependency):pnpm add -D playwright && npx playwright install chromium');
  }

  const { port, close } = await startServer({ port: 0, bundlesDir });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    const stepNums = step != null ? [step] : Array.from({ length: scene.steps.length + 1 }, (_, i) => i);
    await mkdir(outDir, { recursive: true });
    const shots: Shot[] = [];
    for (const n of stepNums) {
      await page.goto(`http://127.0.0.1:${port}/?scene=${encodeURIComponent(scene.id)}&step=${n}&bare=1`);
      await page.waitForFunction(READY_EXPR, undefined, { timeout: 20_000 });
      const pageErr = (await page.evaluate(ERROR_EXPR)) as string | null;
      if (pageErr) throw new Error(`播放页报错(step ${n}):${pageErr.trim()}`);
      const file = join(outDir, `step-${n}.png`);
      await page.locator('.chalk-player').screenshot({ path: file });
      shots.push({ step: n, file, line: n === 0 ? `(题面)${scene.problem}` : scene.steps[n - 1].line });
    }
    await writeFile(
      join(outDir, 'index.json'),
      `${JSON.stringify(
        {
          schema: 'drawtell-snaps',
          version: 1,
          scene: scene.id,
          title: scene.title,
          problem: scene.problem,
          shots: shots.map((s) => ({ ...s, file: basename(s.file) })),
        },
        null,
        2,
      )}\n`,
    );
    return shots;
  } finally {
    await browser.close();
    await close();
  }
}
