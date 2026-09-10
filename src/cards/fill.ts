/** 填空卡:句子里 ___ 留空;答案行 `= 答案` 只有老师知道,不下发孩子端。状态 = 孩子按空的顺序填的字(舞台在步 5)。 */
import { z } from 'zod';
import type { CardKind } from './kind.ts';

export const FillPropsSchema = z.object({
  /** 句子,空一律写成 ___ */
  text: z.string().min(1),
  blanks: z.number().int().positive(),
  /** 按空的顺序;老师没写就没有 */
  answers: z.array(z.string()).optional(),
});
export type FillProps = z.infer<typeof FillPropsSchema>;

export const FillStateSchema = z.object({
  /** 按空的顺序;没填的空是空串 */
  answers: z.array(z.string().max(200)).max(20),
});
export type FillState = z.infer<typeof FillStateSchema>;

const BLANK = /_{2,}/g;
const ANSWER = /^=\s*(.*)$/;

export const fill: CardKind<FillProps, FillState> = {
  name: 'fill',
  props: FillPropsSchema,
  parse(body) {
    const textLines: string[] = [];
    const answers: string[] = [];
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const m = ANSWER.exec(line);
      if (m) answers.push(m[1].trim());
      else textLines.push(line);
    }
    const text = textLines.join('\n').replace(BLANK, '___');
    const blanks = (text.match(/___/g) ?? []).length;
    if (!text) throw new Error('没有句子');
    if (!blanks) throw new Error('句子里没有 ___ 留空');
    return { text, blanks, ...(answers.length ? { answers } : {}) };
  },
  strip(p) {
    const { answers: _drop, ...rest } = p;
    return rest;
  },
  state: FillStateSchema,
  describe(p, s) {
    const parts: string[] = [];
    for (let i = 0; i < p.blanks; i++) {
      const got = (s.answers[i] ?? '').trim();
      const key = p.answers?.[i];
      parts.push(`第 ${i + 1} 空${got ? `填「${got}」` : '没填'}${key ? `(答案「${key}」)` : ''}`);
    }
    return parts.join(',');
  },
  doc: `### fill — 填空

句子里用 \`___\` 留空,下一行 \`= 答案\`(多个空按顺序各一行)。答案孩子看不到;孩子填了、交给你,上下文包的 cards 段会写「第 1 空填「…」(答案「…」)」。

\`\`\`\`
\`\`\`fill
三角形的面积等于底乘高再除以___。
= 2
\`\`\`
\`\`\`\``,
};
