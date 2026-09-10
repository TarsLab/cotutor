/**
 * 选择题卡:问题 + 选项;答案(哪几项对)只有老师知道,不下发孩子端。
 * 状态 = 孩子选了哪几项(舞台里点大按钮);「交给老师」时 describe 成「选了「B 三个」(答案:「三个」)」进上下文包——对错只在老师嘴里。
 */
import { z } from 'zod';
import { bodyLines, type CardKind } from './kind.ts';

export const ChoicePropsSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(1),
  /** 对的选项下标(可多个);老师没标就没有 */
  answer: z.array(z.number().int().nonnegative()).optional(),
  /** 多选(老师标了多个 [x]);孩子端靠它决定能不能多选,答案剥掉它还在 */
  multi: z.boolean().optional(),
});
export type ChoiceProps = z.infer<typeof ChoicePropsSchema>;

export const ChoiceStateSchema = z.object({
  /** 选了的下标,按点的顺序 */
  picked: z.array(z.number().int().nonnegative()).max(26),
});
export type ChoiceState = z.infer<typeof ChoiceStateSchema>;

const OPTION = /^[-*+]\s+(?:\[([ xX])\]\s*)?(.+)$/;
const LETTER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 「B 三个」;下标越界只写字母 */
export function optionLabel(options: readonly string[], i: number): string {
  const letter = LETTER[i] ?? String(i + 1);
  return options[i] ? `${letter} ${options[i]}` : letter;
}

export const choice: CardKind<ChoiceProps, ChoiceState> = {
  name: 'choice',
  props: ChoicePropsSchema,
  parse(body) {
    const question: string[] = [];
    const options: string[] = [];
    const answer: number[] = [];
    for (const line of bodyLines(body)) {
      const m = OPTION.exec(line);
      if (!m) {
        if (options.length) continue; // 选项后面的散话不要
        question.push(line);
        continue;
      }
      if (m[1] && m[1] !== ' ') answer.push(options.length);
      options.push(m[2].trim());
    }
    if (!question.length) throw new Error('第一行要是问题');
    if (!options.length) throw new Error('没有选项行(- [ ] 选项)');
    return { question: question.join(' '), options, ...(answer.length ? { answer } : {}), ...(answer.length > 1 ? { multi: true } : {}) };
  },
  strip(p) {
    const { answer: _drop, ...rest } = p;
    return rest;
  },
  state: ChoiceStateSchema,
  describe(p, s) {
    const picked = s.picked.filter((i) => i < p.options.length);
    if (!picked.length) return '没选';
    const chosen = picked.map((i) => `「${optionLabel(p.options, i)}」`).join('');
    const key = p.answer?.length ? `(答案:${p.answer.map((i) => `「${optionLabel(p.options, i)}」`).join('')})` : '';
    return `选了${chosen}${key}`;
  },
  doc: `### choice — 选择题

第一行是问题,后面每行 \`- [ ] 选项\`,对的那项写 \`- [x]\`(标了多个就是多选)。答案孩子看不到,只有你知道;孩子选了、交给你,上下文包的 cards 段会写「选了「B …」(答案:「…」)」,对错由你口头说。

\`\`\`\`
\`\`\`choice
底 6 厘米、高 4 厘米的三角形,面积是多少?
- [ ] 24 平方厘米
- [x] 12 平方厘米
- [ ] 10 平方厘米
\`\`\`
\`\`\`\``,
};
