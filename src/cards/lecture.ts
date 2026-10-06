/**
 * 小课堂卡(《小课堂设计.md》§六):老师答孩子时放课里的一段,不另讲一遍。正文第一行「<课包 id> 0:19-0:30」,第二行可以写一句给孩子的话。
 * 拿现成的课包,不起画图老师(场景卡放新 id 会起);时间照上下文包 lecture.lines 抄。
 * 课名、真放的起止(对齐到段界,lib/lecture.ts lectureRange)、能不能放(ready)、末帧停在 SVG 的哪一刻,都是服务端下发时从课包现算的快照(src/server/lecture.ts 的 enrichLectures)。
 * 状态 = 那一段看完没;讲稿 [[play]] 锚到它:念到那句,铺满放那一段(课里原来的声音),放完停在末帧接着念。
 */
import { z } from 'zod';
import { bodyLines, type CardKind } from './kind.ts';
import { BUNDLE_ID_RE } from './scene.ts';
import { clockLabel, parseClock } from '../lib/lecture.ts';

export const LecturePropsSchema = z.object({
  /** 课包 id(bundles/<id>/) */
  bundle: z.string().regex(BUNDLE_ID_RE),
  /** 老师写的起止(毫秒);不写止 = 起点那一段放完;都不写 = 整堂课 */
  from: z.number().int().nonnegative().optional(),
  to: z.number().int().nonnegative().optional(),
  /** 老师在第二行写的一句(卡上标题下面一行) */
  text: z.string().optional(),
  /** 以下是下发时从课包算的快照 */
  title: z.string().optional(),
  /** 真放的起止(毫秒,对齐到段界) */
  start: z.number().nonnegative().optional(),
  end: z.number().nonnegative().optional(),
  /** 末帧停在 SVG 的哪一刻(紧凑态缩略图) */
  still: z.number().nonnegative().optional(),
  /** 课包读得出来、起止对得上 */
  ready: z.boolean().optional(),
});
export type LectureProps = z.infer<typeof LecturePropsSchema>;

export const LectureStateSchema = z.object({ done: z.boolean() });
export type LectureState = z.infer<typeof LectureStateSchema>;

export const lecture: CardKind<LectureProps, LectureState> = {
  name: 'lecture',
  props: LecturePropsSchema,
  parse(body) {
    const [first, ...rest] = bodyLines(body);
    const [bundle, range, ...more] = (first ?? '').split(/\s+/).filter(Boolean);
    if (!bundle) throw new Error('第一行要是课包 id 和一段时间,照上下文包 lecture.source 与 lines 抄,如 2026-09-18-po13-jian-8 0:19-0:30');
    if (!BUNDLE_ID_RE.test(bundle)) throw new Error(`课包 id 只能是小写字母、数字、连字符:${bundle}`);
    if (more.length) throw new Error(`第一行只写课包 id 和一段时间:${first}`);
    let from: number | undefined;
    let to: number | undefined;
    if (range) {
      const [a, b, ...c] = range.split(/[-–~]/);
      from = parseClock(a) ?? undefined;
      to = b === undefined ? undefined : (parseClock(b) ?? undefined);
      if (from === undefined || (b !== undefined && to === undefined) || c.length) throw new Error(`时间写成「分:秒-分:秒」,如 0:19-0:30:${range}`);
      if (to !== undefined && to <= from) throw new Error(`止要在起之后:${range}`);
    }
    const text = rest.join(' ').trim();
    return { bundle, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}), ...(text ? { text } : {}) };
  },
  state: LectureStateSchema,
  describe(p, s) {
    const at = p.from !== undefined ? `(${clockLabel(p.from)}${p.to !== undefined ? `–${clockLabel(p.to)}` : ''})` : '';
    return s.done ? `看完了这一段${at}` : `还没看完这一段${at}`;
  },
};
