/**
 * 把生成的技能文件写进包根 skills/(入库):pnpm run gen:skills。
 * cotutor-board 整个目录生成(cards/<kind>/card.md → SKILL.md + references/,先清空 references/);
 * cotutor-vault 只生成 references/记账.md、cotutor-analyze 只生成 references/命令与文件.md(SKILL.md 手写)。tests/skills.test.ts 断言入库的和生成的一致,改了源忘了跑,测试会红。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { BOARD_SKILL, boardSkillFiles } from '../src/cards/docs.ts';
import { VAULT_SKILL, vaultSkillGeneratedFiles } from '../src/lib/vault-doc.ts';
import { ANALYZE_SKILL, analyzeSkillGeneratedFiles } from '../src/lib/analyze-doc.ts';
import { PACKAGE_SKILLS_DIR } from '../src/cli/skills.ts';

export interface GeneratedSkill {
  files: () => Record<string, string>;
  /** true = 整个目录都是生成的(references/ 先清空,测试断言文件集合相等);false = 只有列出的文件是生成的 */
  whole: boolean;
}

export const GENERATED: Record<string, GeneratedSkill> = {
  [BOARD_SKILL]: { files: boardSkillFiles, whole: true },
  [VAULT_SKILL]: { files: vaultSkillGeneratedFiles, whole: false },
  [ANALYZE_SKILL]: { files: analyzeSkillGeneratedFiles, whole: false },
};

export function writeGeneratedSkills(base = PACKAGE_SKILLS_DIR): string[] {
  const out: string[] = [];
  for (const [name, g] of Object.entries(GENERATED)) {
    const dir = join(base, name);
    if (g.whole) rmSync(join(dir, 'references'), { recursive: true, force: true });
    for (const [rel, content] of Object.entries(g.files())) {
      const file = join(dir, rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
      out.push(relative(process.cwd(), file));
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(relative(process.cwd(), process.argv[1]).replace(/\\/g, '/'))) {
  for (const f of writeGeneratedSkills()) process.stdout.write(`${f}\n`);
}
