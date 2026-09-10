/** 文字卡:一段字;样式是修饰词(cover / note / quote / formula / step),不占种类。 */
import { z } from 'zod';
import type { CardKind } from './kind.ts';

export const TEXT_STYLES = ['cover', 'note', 'quote', 'formula', 'step'] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

export const TextPropsSchema = z.object({
  style: z.enum(TEXT_STYLES).optional(),
  /** cover 的标题 / step 的名字 */
  title: z.string().optional(),
  /** 正文;cover 时是副标题(可空) */
  text: z.string(),
});
export type TextProps = z.infer<typeof TextPropsSchema>;

export const text: CardKind<TextProps> = {
  name: 'text',
  props: TextPropsSchema,
  parse(body, mods) {
    const style = mods.map((m) => m.toLowerCase()).find((m): m is TextStyle => (TEXT_STYLES as readonly string[]).includes(m));
    const trimmed = body.replace(/^\s*\n/, '').trimEnd();
    if (!trimmed.trim()) throw new Error('正文是空的');
    if (style === 'cover' || style === 'step') {
      const nl = trimmed.indexOf('\n');
      const title = (nl < 0 ? trimmed : trimmed.slice(0, nl)).trim();
      const rest = nl < 0 ? '' : trimmed.slice(nl + 1).trim();
      return { style, title, text: rest };
    }
    return { ...(style ? { style } : {}), text: trimmed.trim() };
  },
  doc: `### text — 一段字

\`\`\`text\` 后可加一个修饰词定样子:\`cover\`(封面:第一行标题,第二行副标题)、\`step\`(一步:第一行是这步的名字,下面是内容)、\`formula\`(算式,单独一行)、\`note\`(一句要记住的话)、\`quote\`(引一句原文);不加修饰就是普通一段。

\`\`\`\`
\`\`\`text cover
三角形的面积
两个一样的三角形拼成一个平行四边形
\`\`\`

\`\`\`text formula
三角形面积 = 底 × 高 ÷ 2
\`\`\`
\`\`\`\``,
};
