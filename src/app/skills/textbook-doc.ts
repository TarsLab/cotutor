/**
 * cotutor-textbook 技能(改课本的分块)的生成部分:references/命令.md 从命令表(app/cli/commands.ts,经 usage.ts 的 commandsReference)现生成,
 * scripts/gen-skills.ts 写进包根 skills/cotutor-textbook/,tests/skills.test.ts 断言入库的和生成的一致。
 * SKILL.md、references/格式.md 与三科的规范(数学.md、语文.md、科学.md)是手写的:格式.md 里那份例子过 ZonePageSchema 与 zonePageProblems、字段名照 schema 查全(tests/textbook-skill.test.ts)。
 */
import { commandsReference } from '../cli/usage.ts';

export const TEXTBOOK_SKILL = 'cotutor-textbook';

export function textbookSkillGeneratedFiles(): Record<string, string> {
  return {
    'references/命令.md': `# 命令(机器生成,别改)

在 workspace 根跑;每条就是 cotutor <命令> --help 的内容。

\`\`\`
${commandsReference(['textbook'])}
\`\`\`
`,
  };
}
