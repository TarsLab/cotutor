/**
 * 田字格卡(kind 名 tianzige):一到四个汉字,孩子端每个字一个田字格,讲到这张卡时逐笔写一遍,之后点哪个字哪个字再写一遍。
 * 笔顺数据是确定性资源(hanzi-writer-data,服务 /api/kid/tianzige/<字> 现读),老师只写字,不写笔画、不数笔画。没有状态。
 */
import { z } from 'zod';
import type { CardKind } from './kind.ts';

export const TianzigePropsSchema = z.object({
  /** 要写的字,1–4 个汉字,连着写 */
  chars: z.string().min(1),
});
export type TianzigeProps = z.infer<typeof TianzigePropsSchema>;

export const HAN = /^\p{Script=Han}$/u;
export const TIANZIGE_MAX = 4;

export const tianzige: CardKind<TianzigeProps> = {
  name: 'tianzige',
  where: ['board', 'home'],
  props: TianzigePropsSchema,
  parse(body) {
    const chars = Array.from(body.replace(/\s+/g, ''));
    if (!chars.length) throw new Error('要写的字呢(一到四个汉字)');
    const bad = chars.find((c) => !HAN.test(c));
    if (bad) throw new Error(`「${bad}」不是汉字,这张卡只写汉字;拼音、标点写在讲稿里`);
    if (chars.length > TIANZIGE_MAX) throw new Error(`一张卡最多 ${TIANZIGE_MAX} 个字(给了 ${chars.length} 个),拆成两张`);
    return { chars: chars.join('') };
  },
};
