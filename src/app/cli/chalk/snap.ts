/**
 * snap:阶梯层 4 —— 起临时 serve,playwright 逐步打开播放页(?scene=&step=&bare=1)截 keyframe。
 * 必须走真浏览器 + 真播放器:skeleton→元素依赖浏览器字体测量(契约 1),
 * 截到的和孩子看到的是同一渲染器,零偏差。
 * 产物:<out>/step-<n>.png(n=0 空板起,0 号图配题面)+ index.json(图↔讲稿对照,给检验 skill 吃)。
 * index.json 里每张图还带该步新增元素清单(id/type/color/text/bbox)与画板 viewBox:
 * 检验方不读源码也能按 id 报问题、按坐标核对计数与越界。
 * `--step n` 只重截一步时,index.json 与已有内容合并(只换那一步),不覆盖整份对照表。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ChalkScene, ChalkSkeleton } from '../player/types.ts';
import { bboxOf } from './check.ts';
import { startServer } from './serve.ts';

export interface SnapOptions {
  scene: ChalkScene;
  bundlesDir: string;
  outDir: string;
  /** 只截这一步(0 = 空板);缺省 0..steps 全截 */
  step?: number;
  /** 画不画笔尖(默认画);检验用 keyframe 建议关掉,只剩笔迹 */
  cursor?: boolean;
}

/** 该步新增的一个元素:给检验方按 id 说话、按坐标数数;bbox 是 check 的近似包围盒(场景坐标) */
export interface AddedElement {
  id: string;
  type: string;
  strokeColor?: string;
  /** 有填充(涂色)时给出 */
  backgroundColor?: string;
  fillStyle?: string;
  strokeStyle?: string;
  text?: string;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface Shot {
  step: number;
  file: string;
  /** 该步讲稿(step 0 为题面):检验 skill 逐张对照"画面 ↔ 讲稿" */
  line: string;
  /** 该步新增元素(step 0 为空) */
  added: AddedElement[];
  /** 这张图截的时候画没画笔尖(单步重截可能与其他步不同) */
  cursor: boolean;
}

export interface SnapIndex {
  schema: 'drawtell-snaps';
  version: 2;
  scene: string;
  title: string;
  problem: string;
  /** 播放器 SVG 的 viewBox(场景坐标 + 出图留白):元素 bbox 与图像像素的换算依据 */
  board: { viewBox: [number, number, number, number] } | null;
  shots: Array<Omit<Shot, 'file'> & { file: string }>;
}

const READY_EXPR = `document.body.dataset.drawtellReady === '1' || (document.querySelector('.bench-problem')?.textContent ?? '').includes('⚠')`;
const ERROR_EXPR = `document.body.dataset.drawtellReady === '1' ? null : (document.querySelector('.bench-problem')?.textContent ?? null)`;
const VIEWBOX_EXPR = `document.querySelector('.chalk-stage svg')?.getAttribute('viewBox') ?? null`;

function describe(el: ChalkSkeleton): AddedElement {
  const b = bboxOf(el);
  const out: AddedElement = {
    id: el.id,
    type: el.type,
    bbox: { x: round(b.minX), y: round(b.minY), w: round(b.maxX - b.minX), h: round(b.maxY - b.minY) },
  };
  if (typeof el.strokeColor === 'string') out.strokeColor = el.strokeColor;
  if (typeof el.backgroundColor === 'string' && el.backgroundColor !== 'transparent') {
    out.backgroundColor = el.backgroundColor;
    if (typeof el.fillStyle === 'string') out.fillStyle = el.fillStyle;
  }
  if (typeof el.strokeStyle === 'string' && el.strokeStyle !== 'solid') out.strokeStyle = el.strokeStyle;
  if (el.type === 'text' && typeof el.text === 'string') out.text = el.text;
  return out;
}

const round = (n: number) => Math.round(n * 10) / 10;

function parseViewBox(s: string | null): SnapIndex['board'] {
  if (!s) return null;
  const nums = s.trim().split(/[\s,]+/).map(Number);
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null;
  return { viewBox: [nums[0], nums[1], nums[2], nums[3]] };
}

/** 读已有 index.json(同一场景才合并;读不到或格式不对就当没有) */
async function readExistingIndex(outDir: string, sceneId: string): Promise<SnapIndex | null> {
  try {
    const raw = JSON.parse(await readFile(join(outDir, 'index.json'), 'utf8')) as Partial<SnapIndex>;
    if (raw.schema !== 'drawtell-snaps' || raw.scene !== sceneId || !Array.isArray(raw.shots)) return null;
    return raw as SnapIndex;
  } catch {
    return null;
  }
}

export async function snapScene({ scene, bundlesDir, outDir, step, cursor = true }: SnapOptions): Promise<Shot[]> {
  let chromium: (typeof import('playwright'))['chromium'];
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('snap 需要 playwright(devDependency):pnpm add -D playwright && npx playwright install chromium');
  }

  const byId = new Map(scene.skeletons.map((e) => [e.id, e]));
  const addedOf = (n: number): AddedElement[] =>
    n === 0 ? [] : scene.steps[n - 1].elementIds.map((id) => byId.get(id)).filter((e): e is ChalkSkeleton => !!e).map(describe);

  const { port, close } = await startServer({ port: 0, bundlesDir });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    const stepNums = step != null ? [step] : Array.from({ length: scene.steps.length + 1 }, (_, i) => i);
    await mkdir(outDir, { recursive: true });
    const shots: Shot[] = [];
    let board: SnapIndex['board'] = null;
    for (const n of stepNums) {
      const q = `?scene=${encodeURIComponent(scene.id)}&step=${n}&bare=1${cursor ? '' : '&cursor=0'}`;
      await page.goto(`http://127.0.0.1:${port}/${q}`);
      await page.waitForFunction(READY_EXPR, undefined, { timeout: 20_000 });
      const pageErr = (await page.evaluate(ERROR_EXPR)) as string | null;
      if (pageErr) throw new Error(`播放页报错(step ${n}):${pageErr.trim()}`);
      if (!board) board = parseViewBox((await page.evaluate(VIEWBOX_EXPR)) as string | null);
      const file = join(outDir, `step-${n}.png`);
      await page.locator('.chalk-player').screenshot({ path: file });
      shots.push({ step: n, file, line: n === 0 ? `(题面)${scene.problem}` : scene.steps[n - 1].line, added: addedOf(n), cursor });
    }

    // 单步重截:与已有对照表合并,只替换这一步(第一批真题里三组生成方都踩过"覆盖成单条")
    let merged = shots.map((s) => ({ ...s, file: basename(s.file) }));
    if (step != null) {
      const existing = await readExistingIndex(outDir, scene.id);
      if (existing) {
        const others = existing.shots.filter((s) => s.step !== step);
        merged = [...others, ...merged].sort((a, b) => a.step - b.step);
        if (!board) board = existing.board ?? null;
      }
    }
    const index: SnapIndex = {
      schema: 'drawtell-snaps',
      version: 2,
      scene: scene.id,
      title: scene.title,
      problem: scene.problem,
      board,
      shots: merged,
    };
    await writeFile(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    return shots;
  } finally {
    await browser.close();
    await close();
  }
}
