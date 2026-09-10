/**
 * 场景卡(《drawtell接入与场景卡.md》§2):正文是课包 id,课包在 workspace 的 bundles/<id>/(drawtell build 的产物,scene-maker 作业出)。
 * 解析器只认 id;题面、步数、有没有做好(ready)、缩略图是服务端下发时从课包现读的快照(src/server/scene-props.ts),
 * 所以课包落地后卡自己变成可播,不用老师再说一遍。状态 = 孩子看到第几步、看完没;紧凑态「N 步 ▷」,舞台是 drawtell 播放器。
 */
import { z } from 'zod';
import { bodyLines, type CardKind } from './kind.ts';

export const BUNDLE_ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export const ScenePropsSchema = z.object({
  /** 课包 id(bundles/<id>/) */
  bundle: z.string().regex(BUNDLE_ID_RE),
  /** 老师在 id 后面写的一句(课包还没到时孩子看到它) */
  text: z.string().optional(),
  /** 以下是下发时从课包读的快照;没到就没有 */
  title: z.string().optional(),
  problem: z.string().optional(),
  /** 每步讲稿 */
  steps: z.array(z.string()).optional(),
  /** 课包在不在(scene.json + manifest.json 都在) */
  ready: z.boolean().optional(),
  /** 终帧缩略图(相对 workspace 根,/api/kid/image?p= 供图);没截过就没有 */
  thumb: z.string().optional(),
});
export type SceneProps = z.infer<typeof ScenePropsSchema>;

export const SceneStateSchema = z.object({
  /** 看到第几步(1 起;0 = 还没开始) */
  step: z.number().int().nonnegative(),
  done: z.boolean(),
});
export type SceneState = z.infer<typeof SceneStateSchema>;

export const scene: CardKind<SceneProps, SceneState> = {
  name: 'scene',
  props: ScenePropsSchema,
  parse(body) {
    const [first, ...rest] = bodyLines(body);
    if (!first) throw new Error('第一行要是课包 id');
    if (first.startsWith('{')) throw new Error('行内 JSON 场景还没接(下一步);先写课包 id');
    if (!BUNDLE_ID_RE.test(first)) throw new Error(`课包 id 只能是小写字母、数字、连字符:${first}`);
    const text = rest.join(' ').trim();
    return { bundle: first, ...(text ? { text } : {}) };
  },
  state: SceneStateSchema,
  describe(p, s) {
    const total = p.steps?.length ?? 0;
    if (!p.ready) return '课包还没做好,孩子看不了';
    if (s.done) return `看完了(共 ${total} 步)`;
    if (s.step <= 0) return '还没开始看';
    return `看到第 ${s.step} 步(共 ${total} 步)停在气口`;
  },
  doc: `### scene — 讲解动画(课包)

正文第一行是课包 id(bundles/<id>/,由 scene-maker 作业做出来;id 形如 \`2026-09-10-guilv\`),第二行可以写一句给孩子的话。
课包没做好之前孩子看到「图还在路上」,做好了卡自己变成可播,舞台里是逐笔画出来的讲解,自带讲稿与声音。
讲作业题、要画图才讲得清的题用它:回复里放这张卡 + 一句「我去把图画出来」,同时「## 转交」给 scene-maker(to: scene-maker;why: 题面与讲法要点;refs: 课包 id)。
讲稿里 \`[[play]]\` 锚到它,念到那句就把动画铺满播,播完接着念下一句。一天最多起两个作业(policy scenes.dailyMax)。

\`\`\`\`
\`\`\`scene
2026-09-10-guilv
我去把这道题画出来,画好了我们一起看。
\`\`\`
\`\`\`\``,
};
