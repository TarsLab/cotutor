/**
 * snap:阶梯层 4 —— 起临时页面服务(./serve.ts)与本机 Chrome(./browser.ts),逐步打开舞台的 ?chalk=snap&step=<n> 截 keyframe。
 * 走真浏览器 + 孩子端同一个渲染(src/ui/stage/chalk/render.ts 画烤好的画面):截到的和孩子看到的零偏差。
 * 产物:<out>/step-<n>.png(n=0 空板起,0 号图配题面)+ index.json(图↔讲稿对照,给检验 skill 吃)。
 * index.json 里每张图还带该步新增元素清单(id/type/color/text/bbox)与画板 viewBox:
 * 检验方不读源码也能按 id 报问题、按坐标核对计数与越界。
 * `--step n` 只重截一步时,index.json 与已有内容合并(只换那一步),不覆盖整份对照表。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ChalkScene, ChalkSkeleton } from '../../../chalk/types.ts';
import { bboxOf } from '../../../chalk/check.ts';
import { isAction, resolveActions } from '../../../chalk/actions.ts';
import { withBrowser } from './browser.ts';
import { startPageServer } from './serve.ts';

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
  /** 动作(erase / board)没有 */
  bbox?: { x: number; y: number; w: number; h: number };
  /** 动作擦掉的元素 id(erase 写的 targets;board = 旧板上还在的全部) */
  erases?: string[];
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
  /** 这张图的 viewBox(换过画板的课每块板不一样;bbox 换算按它) */
  viewBox?: [number, number, number, number];
}

export interface SnapIndex {
  schema: 'drawtell-snaps';
  version: 2;
  scene: string;
  title: string;
  problem: string;
  /** 播放器 SVG 的 viewBox(场景坐标 + 出图留白):元素 bbox 与图像像素的换算依据;换过画板的课以每张图自己的 viewBox 为准 */
  board: { viewBox: [number, number, number, number] } | null;
  shots: Array<Omit<Shot, 'file'> & { file: string }>;
}

const VIEWBOX_EXPR = `document.querySelector('#chalk-snap svg')?.getAttribute('viewBox') ?? null`;

function describe(el: ChalkSkeleton, erases?: string[]): AddedElement {
  if (isAction(el)) return { id: el.id, type: el.type, erases: erases ?? [] };
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
  const byId = new Map(scene.skeletons.map((e) => [e.id, e]));
  const acts = resolveActions(scene.skeletons, scene.background);
  const addedOf = (n: number): AddedElement[] =>
    n === 0 ? [] : scene.steps[n - 1].elementIds.map((id) => byId.get(id)).filter((e): e is ChalkSkeleton => !!e).map((e) => describe(e, acts.targets.get(e.id)));

  const server = await startPageServer(bundlesDir);
  try {
    return await withBrowser(async (page) => {
      const stepNums = step != null ? [step] : Array.from({ length: scene.steps.length + 1 }, (_, i) => i);
      await mkdir(outDir, { recursive: true });
      const shots: Shot[] = [];
      let board: SnapIndex['board'] = null;
      for (const n of stepNums) {
        await page.goto(`${server.origin}/stage/?chalk=snap&bundle=${encodeURIComponent(`/api/bundles/${scene.id}/`)}&step=${n}${cursor ? '' : '&cursor=0'}`);
        await page.waitFor(`document.body.dataset.chalkDone === '1'`, 60_000);
        const pageErr = await page.evaluate<string | null>('window.__chalkError ?? null');
        if (pageErr) throw new Error(`截图那页出错(step ${n}):${pageErr}`);
        const vb = parseViewBox(await page.evaluate<string | null>(VIEWBOX_EXPR));
        if (!board) board = vb;
        const file = join(outDir, `step-${n}.png`);
        await writeFile(file, await page.screenshot('#chalk-snap'));
        shots.push({ step: n, file, line: n === 0 ? `(题面)${scene.problem}` : scene.steps[n - 1].line, added: addedOf(n), cursor, ...(vb ? { viewBox: vb.viewBox } : {}) });
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
      // schema 名照旧(drawtell-snaps):检验技能与已有的截图目录认它
      const index: SnapIndex = { schema: 'drawtell-snaps', version: 2, scene: scene.id, title: scene.title, problem: scene.problem, board, shots: merged };
      await writeFile(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
      return shots;
    });
  } finally {
    await server.close();
  }
}
