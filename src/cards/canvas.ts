/**
 * 画板卡:孩子在上面画。底图四种——课包 id(整幅终帧做底层)、行内小骨架 JSON、一张图(孩子拍的作业
 * captures/… 或别的 workspace 里的图片,R5:在自己的作业照片上圈错题、写答案)、空白 + 题目;
 * 舞台是舞台包里的 excalidraw 编辑器(底层锁定,孩子的笔打 customData.layer = 'ink');「给老师看」→ 导出 png 存 .cards/<n>.png,
 * 状态存 ink 元素;清空前那一版存一张图(《画板设计.md》拍板 9,cleared);describe 给笔数、各颜色几笔、画了多久、清空过几次与图的路径,
 * 老师 Read 看图(进上下文包时 runner 换成绝对路径、这轮带只读工具;看不了图就靠笔数)。
 */
import { z } from 'zod';
import { BUNDLE_ID_RE, bodyLines, type CardKind } from './kind.ts';
import { IMAGE_EXT } from './image.ts';
import { canvasMinutesText, canvasStrokes, canvasSummary } from '../lib/canvas-chat.ts';

export const CanvasPropsSchema = z.object({
  /** 底图:课包 id / 行内骨架 / 一张图(相对 workspace 根,如 captures/2026-09-14/1620-1.jpg)/ 没有(空白) */
  base: z.union([z.object({ bundle: z.string().regex(BUNDLE_ID_RE) }), z.object({ skeletons: z.array(z.record(z.string(), z.unknown())).min(1).max(40) }), z.object({ image: z.string().min(1) })]).nullable(),
  /** 题目(空白画板必须有;有底图时可选,画在顶栏) */
  prompt: z.string().optional(),
});
export type CanvasProps = z.infer<typeof CanvasPropsSchema>;

/** 清空过的一版(页面记):清空的时刻、那一版第一笔画完的时刻、几笔、清空前导出的那张图(captures/…,先 POST photos 拿到的路径) */
export const CanvasClearedSchema = z.object({ at: z.number(), from: z.number().optional(), strokes: z.number().int().nonnegative(), image: z.string().optional() });

export const CanvasStateSchema = z.object({
  /** 孩子画的 excalidraw 元素(customData.layer = 'ink') */
  ink: z.array(z.record(z.string(), z.unknown())).max(2000),
  /** 「给老师看」时导出的 png(相对 workspace 根,如 conversations/math-tutor/2026-09-10.1620-1.cards/2.png);服务端写,页面不填 */
  image: z.string().optional(),
  /** 清空过的几版(《画板设计.md》拍板 9:清空前自动存一张图,脑和家长都看得到) */
  cleared: z.array(CanvasClearedSchema).max(50).optional(),
});
export type CanvasState = z.infer<typeof CanvasStateSchema>;

/** 「画了 103 笔(黑 12、红 40、蓝 51),画了约 7 分钟,清空重画过 4 次,清掉的那几版:…(用 Read 看)」;图另写 */
export function canvasInkText(s: Pick<CanvasState, 'ink' | 'cleared'>): string {
  const sum = canvasSummary(canvasStrokes(s.ink));
  const cleared = s.cleared ?? [];
  if (!sum.strokes && !cleared.length) return '还没画';
  const named = sum.colors.filter((c) => c.name !== '别的颜色');
  const parts = [`画了 ${sum.strokes} 笔${named.length ? `(${named.map((c) => `${c.name} ${c.strokes}`).join('、')})` : ''}`];
  const starts = [...cleared.map((c) => c.from ?? c.at), ...(sum.firstAt !== null ? [sum.firstAt] : [])].filter((x) => x > 0);
  const end = sum.lastAt ?? (cleared.length ? cleared[cleared.length - 1].at : null);
  if (starts.length && end !== null) parts.push(`画了${canvasMinutesText(end - Math.min(...starts))}`);
  if (cleared.length) {
    const imgs = cleared.flatMap((c) => (c.image ? [c.image] : []));
    parts.push(`清空重画过 ${cleared.length} 次${imgs.length ? `,清掉的那几版:${imgs.join('、')}(用 Read 看)` : ''}`);
  }
  return parts.join(',');
}

export const canvas: CardKind<CanvasProps, CanvasState> = {
  name: 'canvas',
  props: CanvasPropsSchema,
  parse(body, mods) {
    const lines = bodyLines(body);
    const first = lines[0] ?? '';
    const rest = lines.slice(1).join(' ').trim();
    const promptFromTag = mods.join(' ').trim();
    if (first.startsWith('{')) {
      let obj: unknown;
      try {
        obj = JSON.parse(lines.join('\n'));
      } catch (err) {
        throw new Error(`行内骨架不是合法 JSON:${err instanceof Error ? err.message : String(err)}`);
      }
      const sk = (obj as { skeletons?: unknown }).skeletons;
      if (!Array.isArray(sk) || !sk.length) throw new Error('行内骨架要有 skeletons 数组');
      return { base: { skeletons: sk as Record<string, unknown>[] }, ...(promptFromTag ? { prompt: promptFromTag } : {}) };
    }
    if (first && IMAGE_EXT.test(first) && !/^https?:\/\//.test(first)) return { base: { image: first }, ...(rest || promptFromTag ? { prompt: rest || promptFromTag } : {}) };
    if (first && BUNDLE_ID_RE.test(first) && !/[一-鿿]/.test(first)) return { base: { bundle: first }, ...(rest || promptFromTag ? { prompt: rest || promptFromTag } : {}) };
    const prompt = [promptFromTag, ...lines].filter(Boolean).join(' ').trim();
    if (!prompt) throw new Error('空白画板要有题目(写在正文或标签后面)');
    return { base: null, prompt };
  },
  state: CanvasStateSchema,
  describe(_p, s) {
    const ink = canvasInkText(s);
    if (ink === '还没画') return ink;
    return `${ink}${s.image ? `,图:${s.image}(用 Read 看)` : ''}`;
  },
};
