/**
 * 字形 → ChalkSkeleton(freedraw),一笔一个元素、数组顺序即笔顺。
 *
 * 这里封掉两个实测出来的坑,消费方不必知道:
 * 1. freedraw 走 convertToExcalidrawElements 是**原样透传**的(不像 rectangle/text
 *    走工厂补默认值),groupIds 等字段缺一个,animateSvg 的 createGroups 就会
 *    在 NodeList.forEach 里炸 "Cannot read properties of undefined"。故 FREEDRAW_BASE
 *    把整套字段给全。
 * 2. freedraw 的 strokeWidth 会被 perfect-freehand 放大,视觉粗细约是 strokeWidth 的 4 倍。
 *    默认 xHeight/30 是**量出来的**:Excalifont 的竖笔画粗细 = 0.20×x 高(canvas 像素扫描
 *    取行游程中位数),字形包要与它同重量才不会在同一块黑板上一个轻一个重。
 * 3. simulatePressure 必须关。开着时 perfect-freehand 拿点间距当书写速度反推压力,
 *    于是**采样越密笔画越粗**——sampleStep 本该只是性能旋钮,却会改变字的视觉。
 *    关掉并显式给一条恒定 pressures,字形粗细就只由 strokeWidth 决定。
 */

import type { ChalkSkeleton } from '../player/types.ts';
import { GLYPHS } from './registry.ts';
import { sampleStroke, strokeLength } from './sample.ts';
import type { Pt } from './sample.ts';
import type { Glyph } from './types.ts';

/** freedraw 透传所需的完整字段(见文件头坑 1) */
const FREEDRAW_BASE = {
  angle: 0,
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeStyle: 'solid',
  /** 字形要的是干净笔迹,不要 roughjs 抖动 */
  roughness: 0,
  opacity: 100,
  roundness: null,
  groupIds: [] as string[],
  frameId: null,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
  isDeleted: false,
  version: 1,
  versionNonce: 1,
  // 见文件头坑 3:压力恒定,笔画粗细与采样密度解耦
  simulatePressure: false,
} as const;

export interface GlyphPenOptions {
  /** x 高(px):字形的度量基准,四线三格的一格 */
  xHeight: number;
  /** 基线左端的画布坐标 */
  x: number;
  y: number;
  strokeColor?: string;
  /** 缺省 xHeight/30 —— 对齐 Excalifont 的笔画重量(见文件头坑 2) */
  strokeWidth?: number;
  /** 每 1 个 x 高单位弧长的毫秒数,决定"手写速度";缺省 200 */
  msPerUnit?: number;
  /** 单笔时长下限(i/j 的点只有 0.1 单位);缺省 90 */
  minStrokeMs?: number;
  /** 元素 id 前缀,同一场景里要唯一 */
  idPrefix?: string;
  /** 字间距(x 高为 1 单位);缺省 0.22 */
  letterSpacing?: number;
  /** 采样步长(归一化单位);缺省 SAMPLE_STEP。调小更平滑,但动画 DOM 体积约按平方涨 */
  sampleStep?: number;
  /**
   * 字形表(provider):缺省内置拉丁包(a–z / A–Z)。扩展字形数据包
   * (如 drawtell-glyphs-hanzi)导出同构的 Map,从这里传入即共用同一支笔——
   * 归一化约定由各包自定并写明(拉丁 = 四线三格;汉字 = 格子高 1、底线 y=0、顶 y=-1)。
   */
  glyphs?: ReadonlyMap<string, Glyph>;
}

const DEFAULTS = { msPerUnit: 200, minStrokeMs: 90, letterSpacing: 0.22, idPrefix: 'g' };
/** 空格的前进宽度(x 高为 1 单位):不产生笔画,只让光标走一段 */
export const SPACE_ADVANCE = 0.55;

/** 字形表未收录的字符:由调用方决定回退,这里不猜 */
export class UnknownGlyphError extends Error {
  /** node 的 strip-only 类型擦除不支持构造函数参数属性,字段显式声明 */
  ch: string;
  constructor(ch: string) {
    super(`字形表未收录 '${ch}'。内置包只有 a–z 与 A–Z;汉字等扩展字形经 glyphs 选项传入(如 drawtell-glyphs-hanzi)。`);
    this.ch = ch;
  }
}

function strokeSkeleton(pts: Pt[], id: string, ms: number, o: GlyphPenOptions): ChalkSkeleton {
  // excalidraw 的 freedraw 约定:x/y 是落笔点,points 相对它、首点 [0,0](可有负值),
  // width/height 是 points 的 extent。照它的约定走,少踩版本升级的坑。
  const [ox, oy] = pts[0];
  const xs = pts.map((p) => p[0] - ox);
  const ys = pts.map((p) => p[1] - oy);
  return {
    ...FREEDRAW_BASE,
    type: 'freedraw',
    id,
    animateDuration: ms,
    x: ox,
    y: oy,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    points: pts.map((_, i) => [xs[i], ys[i]] as [number, number]),
    // 长度须与 points 对齐;恒定值 = 均匀笔迹(字形不要手写的粗细起伏)
    pressures: pts.map(() => 0.5),
    strokeColor: o.strokeColor ?? '#1e1e1e',
    strokeWidth: o.strokeWidth ?? o.xHeight / 30,
  };
}

/**
 * 单个字母(大小写皆可)→ 一笔一个 freedraw 元素。
 * 返回顺序即笔顺,可直接铺进 scene.skeletons / 交给 buildAnimatedSvg。
 */
export function glyphSkeletons(ch: string, o: GlyphPenOptions): ChalkSkeleton[] {
  const glyph = (o.glyphs ?? GLYPHS).get(ch);
  if (!glyph) throw new UnknownGlyphError(ch);
  const msPerUnit = o.msPerUnit ?? DEFAULTS.msPerUnit;
  const minMs = o.minStrokeMs ?? DEFAULTS.minStrokeMs;
  const prefix = o.idPrefix ?? DEFAULTS.idPrefix;
  return glyph.strokes.map((st, i) => {
    const pts = sampleStroke(st, o.sampleStep).map(([nx, ny]) => [o.x + nx * o.xHeight, o.y + ny * o.xHeight] as Pt);
    const ms = Math.max(minMs, Math.round(strokeLength(st) * msPerUnit));
    return strokeSkeleton(pts, `${prefix}-${ch}-${i + 1}`, ms, o);
  });
}

/** 一个词的排版宽度(px),含字间距,不含末尾空隙;空格按 SPACE_ADVANCE 计 */
export function wordAdvance(word: string, o: Pick<GlyphPenOptions, 'xHeight' | 'letterSpacing' | 'glyphs'>): number {
  const table = o.glyphs ?? GLYPHS;
  const gap = o.letterSpacing ?? DEFAULTS.letterSpacing;
  let w = 0;
  [...word].forEach((ch, i) => {
    if (ch !== ' ' && !table.has(ch)) throw new UnknownGlyphError(ch);
    w += (i > 0 ? gap : 0) + (ch === ' ' ? SPACE_ADVANCE : table.get(ch)!.advance);
  });
  return w * o.xHeight;
}

/**
 * 一串字母(大小写皆可)→ 全部笔画,从左到右按 advance + letterSpacing 排;
 * 空格只让光标前进,不产生笔画(于是 'ram man' 能一次画完,不必调用方自己拆词)。
 * id 形如 `<prefix>-<序号><字母>-<笔序>`,同字母重复出现也不撞。
 */
export function wordSkeletons(word: string, o: GlyphPenOptions): ChalkSkeleton[] {
  const gap = (o.letterSpacing ?? DEFAULTS.letterSpacing) * o.xHeight;
  const prefix = o.idPrefix ?? DEFAULTS.idPrefix;
  const out: ChalkSkeleton[] = [];
  let cursor = o.x;
  const table = o.glyphs ?? GLYPHS;
  [...word].forEach((ch, i) => {
    if (ch === ' ') {
      cursor += SPACE_ADVANCE * o.xHeight + gap;
      return;
    }
    const g = table.get(ch);
    if (!g) throw new UnknownGlyphError(ch);
    out.push(...glyphSkeletons(ch, { ...o, x: cursor, idPrefix: `${prefix}-${i + 1}` }));
    cursor += g.advance * o.xHeight + gap;
  });
  return out;
}
