/** 老师文件的出厂 / 自定义状态与 upgrade:没改过的换新、改过的只报 diff、--force 覆盖留 .bak、缺的补;lineDiff。 */
import { mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-teachers-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { addTeacherFile, installTeachers, lineDiff, readManifest, teacherStatuses, upgradeTeachers, writeManifest } = await import('../src/cli/teachers.ts');
const { doctorWorkspace } = await import('../src/cli/doctor.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { patchConfig } = await import('../src/server/store.ts');
const { parseAgentFile } = await import('../src/lib/agent-file.ts');
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

  // ---- 自家加老师:add 出模板 + 进 cotutor.json + 目录 + 链;doctor 认它;upgrade 不碰 ----
  const added = await addTeacherFile(root, { name: 'science-teacher', display: '科学老师', subject: '科学' });
  const fm = parseAgentFile(readFileSync(added.file, 'utf8'));
  check('模板:frontmatter name 一致、带约定', fm.frontmatter.name === 'science-teacher' && fm.frontmatter.memory === 'project' && fm.body.includes('科学老师') && fm.body.includes('最后一段') && fm.body.includes('待裁量'), fm.body.slice(0, 80));
  check('目录与 .qwen 链', existsSync(join(root, 'agents', 'science-teacher', '.gitkeep')) && readlinkSync(join(root, '.qwen', 'agents', 'science-teacher.md')) === '../../.claude/agents/science-teacher.md');
  let dup = '';
  try {
    await addTeacherFile(root, { name: 'science-teacher', display: 'x' });
  } catch (e) {
    dup = (e as Error).message;
  }
  check('重名拒绝', dup.includes('已经在了'));
  let badName = '';
  try {
    await addTeacherFile(root, { name: 'Science Teacher', display: 'x' });
  } catch (e) {
    badName = (e as Error).message;
  }
  check('名字不合规拒绝', badName.includes('不合规'));
  await patchConfig(loadWorkspace(root), { teachers: { 'science-teacher': { display: '科学老师', subject: '科学', avatar: '🔬', enabled: true } } });
  const d = await doctorWorkspace(root, { probeEnv: false });
  check('doctor:自家老师文件 / 链 / 目录都 ✓,origin 标自家的', d.ok && d.checks.some((c) => c.name === 'teacher.science-teacher.claude' && c.ok) && d.checks.some((c) => c.name === 'teacher.science-teacher.qwen' && c.ok) && d.checks.some((c) => c.name === 'teacher.science-teacher.home' && c.ok) && d.checks.some((c) => c.name === 'teacher.science-teacher.origin' && c.detail.includes('自家')), JSON.stringify(d.checks.filter((c) => c.name.includes('science'))));
  check('upgrade 不碰自家老师', !(await upgradeTeachers(root)).some((s) => s.name === 'science-teacher') && readFileSync(added.file, 'utf8').includes('科学老师'));
  check('teacherStatuses 只列出厂的', !(await teacherStatuses(root)).some((s) => s.name === 'science-teacher'));

  // 只在 cotutor.json 里加了名字、没写文件:init 补目录,doctor 点名怎么写
  await patchConfig(loadWorkspace(root), { teachers: { 'art-teacher': { display: '美术老师', enabled: true } } });
  const steps = await installTeachers(root, ['science-teacher', 'art-teacher']);
  check('installTeachers 给配置里的老师补目录,文件缺的点名 add', existsSync(join(root, 'agents', 'art-teacher')) && steps.some((s) => s.item === '.claude/agents/art-teacher.md' && s.action === 'kept' && s.note?.includes('cotutor add art-teacher')), JSON.stringify(steps.filter((s) => s.item.includes('art'))));
  const d2 = await doctorWorkspace(root, { probeEnv: false });
  check('doctor:文件缺 → 必需失败,修复说写文件或 add', !d2.ok && d2.checks.some((c) => c.name === 'teacher.art-teacher.claude' && !c.ok && c.fix?.includes('cotutor add art-teacher')), JSON.stringify(d2.checks.filter((c) => c.name.includes('art'))));
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
