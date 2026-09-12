/**
 * 画板卡(《drawtell接入与场景卡.md》§5):孩子在上面画。底图三种——课包 id(整幅终帧做底层)、行内小骨架 JSON、空白 + 题目;
 * 舞台是舞台包里的 excalidraw 编辑器(底层锁定,孩子的笔打 customData.layer = 'ink');「给老师看」→ 导出 png 存 .cards/<n>.png,
 * 状态存 ink 元素;describe 给笔数与图的路径,老师 Read 看图(qwen 看不了图就靠笔数)。
 */
import { z } from 'zod';
import { bodyLines, type CardKind } from './kind.ts';
import { BUNDLE_ID_RE } from './scene.ts';

export const CanvasPropsSchema = z.object({
  /** 底图:课包 id / 行内骨架 / 没有(空白) */
  base: z.union([z.object({ bundle: z.string().regex(BUNDLE_ID_RE) }), z.object({ skeletons: z.array(z.record(z.string(), z.unknown())).min(1).max(40) })]).nullable(),
  /** 题目(空白画板必须有;有底图时可选,画在顶栏) */
  prompt: z.string().optional(),
});
export type CanvasProps = z.infer<typeof CanvasPropsSchema>;

export const CanvasStateSchema = z.object({
  /** 孩子画的 excalidraw 元素(customData.layer = 'ink') */
  ink: z.array(z.record(z.string(), z.unknown())).max(2000),
  /** 「给老师看」时导出的 png(相对 workspace 根,如 conversations/math-tutor/2026-09-10.1620-1.cards/2.png);服务端写,页面不填 */
  image: z.string().optional(),
});
export type CanvasState = z.infer<typeof CanvasStateSchema>;

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
    if (first && BUNDLE_ID_RE.test(first) && !/[一-鿿]/.test(first)) return { base: { bundle: first }, ...(rest || promptFromTag ? { prompt: rest || promptFromTag } : {}) };
    const prompt = [promptFromTag, ...lines].filter(Boolean).join(' ').trim();
    if (!prompt) throw new Error('空白画板要有题目(写在正文或标签后面)');
    return { base: null, prompt };
  },
  state: CanvasStateSchema,
  describe(_p, s) {
    const n = s.ink.length;
    if (!n) return '还没画';
    return `画了 ${n} 笔${s.image ? `,图:${s.image}(用 Read 看)` : ''}`;
  },
};
