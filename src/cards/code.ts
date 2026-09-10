/** 代码卡:原样显示。不认识的围栏标签也落到这里(老师教编程写 ```python 就正好是它)。 */
import { z } from 'zod';
import type { CardKind } from './kind.ts';

export const CodePropsSchema = z.object({ lang: z.string().nullable(), text: z.string() });
export type CodeProps = z.infer<typeof CodePropsSchema>;

export const code: CardKind<CodeProps> = {
  name: 'code',
  props: CodePropsSchema,
  parse(body, mods) {
    return { lang: mods[0] ?? null, text: body.replace(/\s+$/, '') };
  },
  doc: `### code — 代码或原样的文字

围栏标签写语言名(\`\`\`python)就是代码卡,原样显示,不念。`,
};
