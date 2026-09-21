/**
 * 文字卡:一段字。正文第一行以 `#` 开头就是标题(2026-09-12:样子归主题与后期,老师只写 ```text);
 * 只有一行 `# 标题` 没正文 = 小节标题(heading:渲染成无底加粗一行,不算一张卡)。
 * 修饰词只有 formula(算式,衬线居中);别的修饰词不认,整段当正文。
 */
import { z } from 'zod';
import type { CardKind } from './kind.ts';

export const TEXT_STYLES = ['formula'] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

export const TextPropsSchema = z.object({
  style: z.enum(TEXT_STYLES).optional(),
  /** 第一行 `# 标题` */
  title: z.string().optional(),
  /** 正文 */
  text: z.string(),
  /** 小节标题行(只有 `# 标题`):不算卡 */
  heading: z.boolean().optional(),
  /** 提问卡:解析器在末句问句没配能答的卡时补的(老师写不出来),text 就是那句问话 */
  ask: z.boolean().optional(),
});
export type TextProps = z.infer<typeof TextPropsSchema>;

export const text: CardKind<TextProps> = {
  name: 'text',
  where: ['board', 'home'],
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
    return { ...(style ? { style } : {}), text: trimmed.trim() };
  },
};
