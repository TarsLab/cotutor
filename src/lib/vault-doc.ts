/**
 * cotutor-vault 技能的生成部分:references/记账.md 从记账段的契约(schema/sections.ts 的 .describe())与真提示词(diary.ts bookkeepingPrompt)
 * 现生成,scripts/gen-skills.ts 写进包根 skills/cotutor-vault/,tests/skills.test.ts 断言入库的和生成的一致——老师看到的写法永远和解析器同源。
 * SKILL.md 本体是手写的(《obsidian仓库设计.md》§7 老师读 vault 的路径),不在这里。
 */
import { BookkeepingEntrySchema } from '../schema/sections.ts';
import { bookkeepingPrompt } from './diary.ts';

export const VAULT_SKILL = 'cotutor-vault';

/** references/记账.md:字段表(从 zod 取)+ 记账消息原样一份 + 解析器认什么 + 应用替你做的 */
export function bookkeepingReferenceDoc(): string {
  const shape = BookkeepingEntrySchema.shape;
  const rows = (Object.keys(shape) as (keyof typeof shape)[]).map((k) => {
    const s = shape[k];
    const optional = s.safeParse(undefined).success;
    return `| \`${k}\` | ${optional ? '可选' : '必需'} | ${s.description ?? ''} |`;
  });
  const kept = bookkeepingPrompt({ thread: '1620-1', rating: 4, keepScore: 4, headings: ['人教数学一下#4 100以内数的认识', '人教数学一下#6 100以内的加法和减法(一)'], photos: 1 });
  const thin = bookkeepingPrompt({ thread: '1705-3', keepScore: 4, headings: [] });
  return `# 记账段的形状(机器生成,别改)

记账任务的上下文包 \`from: system\`,消息正文长这样(打分够、话题里有一张作业照片的那种):

\`\`\`\`
${kept}
\`\`\`\`

家长没打分或不够 keepScore 时,消息里就没有 summary / steps 两行——别自己补,应用会丢掉:

\`\`\`\`
${thin}
\`\`\`\`

## 字段

| 字段 | 必需 | 说明 |
|---|---|---|
${rows.join('\n')}

## 解析器认什么

- 「## 记账」段里 \`- thread:\` 开一条,下面缩进的 \`key: value\` 是它的字段,\`observations:\` 下面缩进的 \`- \` 是观察行。
- 记账任务一次只记一个话题:漏写 \`- thread:\` 直接写 \`thread:\`(或只写字段)也认;thread 写错了但只有一条也认。
- 缺 thread 或 name 的那条整个丢掉;别的字段写坏了退成普通正文、日记不写,应用在家长端报一条 warning——格式是增强不是门槛,但写错等于白记。

## 应用替你做的(不用你写)

- 「孩子问」:这个话题里孩子每一句非空的话,应用从对话索引机械抄(「继续」、交卡不算)。
- 打分不够时丢掉 summary / steps / textbook / 课包;打分够时摘要行末尾加 ★ 与 \`→ [[册#节]]\`,课包 id 从这个话题的产物里取。
- textbook 你写成 \`[[人教数学一下#4 100以内数的认识]]\` 或不带括号都行,应用会剥掉再加。
- 日记里的 H2 = \`学科 · name\`;学科取老师条目的 subject,你不用写。
`;
}

/** 技能目录里生成的那几个文件(相对技能根);SKILL.md 手写,不在其中 */
export function vaultSkillGeneratedFiles(): Record<string, string> {
  return { 'references/记账.md': bookkeepingReferenceDoc() };
}
