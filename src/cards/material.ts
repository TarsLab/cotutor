/**
 * 素材卡(《备课设计.md》§11.3):正文只写素材 id(workspace 的 materials/<id>/,家长备课时做好、审过的现成动画)。
 * 拿现成的,不起任何人:id 写错退文字卡。场景卡放新 id 会起画图老师、花一轮钱,所以不复用它。
 * 标题、段数、能不能播(ready)是服务端下发时从 material.md 现读的快照(src/server/material.ts 的 materialSnapshot),素材改了下一次下发就跟上。
 * 状态 = 看到第几段、看完没;紧凑态「N 段 ▷」,舞台一段一个 <video>,播完停在末帧;讲稿 [[play N]] 只播第 N 段。
 */
import { z } from 'zod';
import { bodyLines, type CardKind } from './kind.ts';

/** 素材 id = materials/ 下的目录名:小写字母、数字、连字符(拼进路径与路由) */
export const MATERIAL_ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export const MaterialPropsSchema = z.object({
  /** 素材 id(materials/<id>/) */
  id: z.string().regex(MATERIAL_ID_RE),
  /** 老师在 id 后面写的一句(卡上标题下面一行) */
  text: z.string().optional(),
  /** 以下是下发时从素材读的快照 */
  title: z.string().optional(),
  /** 几段(一段一个 mp4) */
  segments: z.number().int().positive().optional(),
  /** 素材在、没有要改的 */
  ready: z.boolean().optional(),
});
export type MaterialProps = z.infer<typeof MaterialPropsSchema>;

export const MaterialStateSchema = z.object({
  /** 看到第几段(1 起;0 = 还没开始) */
  segment: z.number().int().nonnegative(),
  done: z.boolean(),
});
export type MaterialState = z.infer<typeof MaterialStateSchema>;

export const material: CardKind<MaterialProps, MaterialState> = {
  name: 'material',
  props: MaterialPropsSchema,
  parse(body) {
    const [first, ...rest] = bodyLines(body);
    if (!first) throw new Error('第一行要是素材 id(上下文包 materials: 每行开头那个)');
    if (!MATERIAL_ID_RE.test(first)) throw new Error(`素材 id 只能是小写字母、数字、连字符:${first}`);
    const text = rest.join(' ').trim();
    return { id: first, ...(text ? { text } : {}) };
  },
  state: MaterialStateSchema,
  // 只看孩子的状态:索引里存的是老师写的原卡,没有下发时补的快照(段数、ready),有状态就说明孩子看过
  describe(p, s) {
    const of = p.segments ? `(共 ${p.segments} 段)` : '';
    if (s.done) return `看完了${of}`;
    if (s.segment <= 0) return '还没看';
    return `看到第 ${s.segment} 段${of}`;
  },
};
