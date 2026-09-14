/**
 * 把从卡的注册表生成的技能写进包根 skills/(入库):pnpm run gen:skills。
 * 现在只有 cotutor-board(cards/<kind>/card.md → SKILL.md + references/);tests/skills.test.ts 断言入库的和生成的一致,
 * 改了 card.md 忘了跑,测试会红。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { BOARD_SKILL, boardSkillFiles } from '../src/cards/docs.ts';
import { PACKAGE_SKILLS_DIR } from '../src/cli/skills.ts';

export function writeGeneratedSkills(base = PACKAGE_SKILLS_DIR): string[] {
  const dir = join(base, BOARD_SKILL);
  rmSync(join(dir, 'references'), { recursive: true, force: true });
  const out: string[] = [];
  for (const [rel, content] of Object.entries(boardSkillFiles())) {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    out.push(relative(process.cwd(), file));
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(relative(process.cwd(), process.argv[1]).replace(/\\/g, '/'))) {
  for (const f of writeGeneratedSkills()) process.stdout.write(`${f}\n`);
}
