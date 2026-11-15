/** 点读卡:一行一段,孩子点哪段听哪段;配音在一轮跑完后后台按段合成到 .cards/<n>/<段>.mp3,还没好的段退浏览器合成声。 */
import { z } from 'zod';
import { bodyLines, type CardKind } from './kind.ts';

export const ReadPropsSchema = z.object({ segments: z.array(z.string().min(1)).min(1) });
export type ReadProps = z.infer<typeof ReadPropsSchema>;

export const read: CardKind<ReadProps> = {
  name: 'read',
  props: ReadPropsSchema,
  parse(body) {
    const segments = bodyLines(body);
    if (!segments.length) throw new Error('一行都没有(一行一段)');
    return { segments };
  },
  assets(p) {
    return p.segments.map((text, k) => ({ file: `${k + 1}.mp3`, text }));
  },
};
