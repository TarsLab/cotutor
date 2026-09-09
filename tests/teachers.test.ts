/** 老师文件的出厂 / 自定义状态与 upgrade:没改过的换新、改过的只报 diff、--force 覆盖留 .bak、缺的补;lineDiff。 */
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-teachers-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { lineDiff, readManifest, teacherStatuses, upgradeTeachers, writeManifest } = await import('../src/cli/teachers.ts');
const { PACKAGE_VERSION } = await import('../src/cli/skeleton.ts');

try {
  const { root } = await initWorkspace({ slug: 'ming' });
  const file = (n: string): string => join(root, '.claude', 'agents', `${n}.md`);
  const states = () => teacherStatuses(root).then((l) => Object.fromEntries(l.map((s) => [s.name, s.state])));
  check('刚 init:全部 latest', Object.values(await states()).every((s) => s === 'latest'), JSON.stringify(await states()));
  const u0 = await upgradeTeachers(root);
  check('都最新 → 全 latest,不动', u0.every((s) => s.action === 'latest'));

  // 模拟「包更新了、家长没改」:把记录的 hash 与文件一起改成旧内容
  const old = readFileSync(file('math-teacher'), 'utf8').replace('数学老师', '算术老师');
  writeFileSync(file('math-teacher'), old);
  const m = await readManifest(root);
  const { sha256 } = await import('../src/cli/teachers.ts');
  m.teachers['math-teacher'] = { hash: sha256(old), version: '0.0.9' };
  await writeManifest(root, m);
  check('状态 upgradable', (await states())['math-teacher'] === 'upgradable');
  const u1 = await upgradeTeachers(root);
  check('upgrade 换新版并记新 hash', u1.find((s) => s.name === 'math-teacher')?.action === 'upgraded' && readFileSync(file('math-teacher'), 'utf8').includes('数学老师') && (await readManifest(root)).teachers['math-teacher'].version === PACKAGE_VERSION);

  // 家长改过:upgrade 只报 diff,文件不动
  writeFileSync(file('chinese-teacher'), readFileSync(file('chinese-teacher'), 'utf8') + '\n多夸夸孩子的字。\n');
  check('状态 custom', (await states())['chinese-teacher'] === 'custom');
  const u2 = await upgradeTeachers(root);
  const zh = u2.find((s) => s.name === 'chinese-teacher');
  check('custom → kept-custom 带 diff', zh?.action === 'kept-custom' && zh.diff?.some((l) => l === '- 多夸夸孩子的字。') === true && readFileSync(file('chinese-teacher'), 'utf8').includes('多夸夸'), JSON.stringify(zh));
  const u3 = await upgradeTeachers(root, { force: ['chinese-teacher'] });
  check('--force 覆盖并留 .bak', u3.find((s) => s.name === 'chinese-teacher')?.action === 'forced' && !readFileSync(file('chinese-teacher'), 'utf8').includes('多夸夸') && readFileSync(`${file('chinese-teacher')}.bak`, 'utf8').includes('多夸夸'));

  // 没有记录的手写文件:untracked,当 custom
  const m2 = await readManifest(root);
  delete m2.teachers['reading-teacher'];
  await writeManifest(root, m2);
  writeFileSync(file('reading-teacher'), '---\nname: reading-teacher\n---\n手写的');
  check('无记录 → untracked', (await states())['reading-teacher'] === 'untracked');
  check('untracked 也不覆盖', (await upgradeTeachers(root)).find((s) => s.name === 'reading-teacher')?.action === 'kept-custom' && readFileSync(file('reading-teacher'), 'utf8').includes('手写'));

  // 缺的补
  unlinkSync(file('planner'));
  check('缺 → installed', (await upgradeTeachers(root)).find((s) => s.name === 'planner')?.action === 'installed' && existsSync(file('planner')));

  check('lineDiff', lineDiff('a\nb\nc', 'a\nx\nc').join('|') === '- b|+ x' && lineDiff('a', 'a').length === 0 && lineDiff('a\nb', 'a').join('|') === '- b');
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
