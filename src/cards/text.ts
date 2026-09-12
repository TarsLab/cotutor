/**
 * 文字卡:一段字。正文第一行以 `#` 开头就是标题(2026-09-12:样子归主题与后期,老师只写 ```text);
 * 只有一行 `# 标题` 没正文 = 小节标题(heading:渲染成无底加粗一行,不算一张卡)。
 * 老的修饰词(cover / note / quote / formula / step)照收进 style,渲染器把它们映到底色 / 字形槽,老板书不变。
 */
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
  /** 小节标题行(只有 `# 标题`):不算卡 */
  heading: z.boolean().optional(),
});
export type TextProps = z.infer<typeof TextPropsSchema>;

export const text: CardKind<TextProps> = {
  name: 'text',
  props: TextPropsSchema,
  parse(body, mods) {
    const style = mods.map((m) => m.toLowerCase()).find((m): m is TextStyle => (TEXT_STYLES as readonly string[]).includes(m));
    const trimmed = body.replace(/^\s*\n/, '').trimEnd();
    if (!trimmed.trim()) throw new Error('正文是空的');
    const hd = /^#{1,3}\s+(\S.*)$/.exec(trimmed.split('\n')[0] ?? '');
    if (hd && !style) {
      const nl = trimmed.indexOf('\n');
      const rest = nl < 0 ? '' : trimmed.slice(nl + 1).trim();
      const title = hd[1].trim();
      return rest ? { title, text: rest } : { title, text: '', heading: true };
    }
    if (style === 'cover' || style === 'step') {
      const nl = trimmed.indexOf('\n');
      const title = (nl < 0 ? trimmed : trimmed.slice(0, nl)).trim();
      const rest = nl < 0 ? '' : trimmed.slice(nl + 1).trim();
      return { style, title, text: rest };
    }
    return { ...(style ? { style } : {}), text: trimmed.trim() };
  },
  doc: `### text — 一段字

正文第一行以 \`# \` 开头就是这张卡的标题(定义、方法的名字),下面是正文;只写一行 \`# 标题\` 不写正文,就是一个小节标题(板上无底的一行,不算卡)。样子(底色、字号)不用你管。
老写法 \`text cover\`(封面:第一行标题,第二行副标题)、\`text formula\`(算式)、\`text note\`(一句要记住的话)、\`text quote\`(引一句原文)、\`text step\` 仍然认。

\`\`\`\`
\`\`\`text
# 认边
两条短边叫直角边,最长的一条叫斜边
\`\`\`

\`\`\`text formula
三角形面积 = 底 × 高 ÷ 2
\`\`\`
\`\`\`\``,
};
