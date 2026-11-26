/**
 * cotutor-textbook 技能(给课本出分块)的生成部分:references/命令.md 从命令表(app/cli/commands.ts,经 usage.ts 的 commandsReference)现生成,
 * references/分块.schema.json 从 src/schema/zones.ts 的 ZoneFileSchema 导(zod 4 的 toJSONSchema),改成草稿的写法:字行能写行号、块的 box 能不写;
 * scripts/gen-skills.ts 写进包根 skills/cotutor-textbook/,tests/skills.test.ts 断言入库的和生成的一致。
 * SKILL.md、references/格式.md 与三科的规范(数学.md、语文.md、科学.md)是手写的:格式.md 里那份例子换成存的样子后过 ZoneFileSchema 与 zonePageProblems、字段名照 schema 查全(tests/textbook-skill.test.ts)。
 */
import { z } from 'zod';
import { LINE_REF, ZoneFileSchema } from '../../schema/index.ts';
import { commandsReference } from '../cli/usage.ts';

/** 草稿的 JSON Schema:rows 的一项是框或行号;块(有 rows 的那种对象)的 box 不必写 */
function draftSchema(): unknown {
  const s = z.toJSONSchema(ZoneFileSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== 'object') return;
    const o = x as { properties?: Record<string, { items?: unknown }>; required?: string[] };
    const rows = o.properties?.rows;
    if (rows?.items) {
      rows.items = { anyOf: [rows.items, { type: 'string', pattern: LINE_REF.source }] };
      if (o.required) o.required = o.required.filter((k) => k !== 'box');
    }
    for (const v of Object.values(x)) walk(v);
  };
  walk(s);
  return { ...s, title: 'cotutor 课本分块的一页(草稿)', description: '协议版本 3;字段讲解在同目录的 格式.md' };
}

export const TEXTBOOK_SKILL = 'cotutor-textbook';

export function textbookSkillGeneratedFiles(): Record<string, string> {
  return {
    'references/命令.md': `# 命令(机器生成,别改)

在 workspace 根跑;每条就是 cotutor <命令> --help 的内容。

\`\`\`
${commandsReference(['textbook'])}
\`\`\`
`,
    'references/分块.schema.json': `${JSON.stringify(draftSchema(), null, 1)}\n`,
  };
}
