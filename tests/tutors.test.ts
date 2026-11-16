/** 老师的家:init 不再出厂老师文件(2026-11-16,一科通用的做法并进了每个 activity);旧 workspace 里的老师文件不删、refresh 与 doctor 提一句;自家加老师只建家;lineDiff。 */
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-tutors-home-')));
process.env.HOME = home;
// 这台电脑配好了百炼(没配时 doctor 的 bailian 是红的必需项)
mkdirSync(join(home, '.config', 'cotutor'), { recursive: true });
writeFileSync(join(home, '.config', 'cotutor', 'bailian.json'), JSON.stringify({ apiKey: 'sk-test0000000000000000', workspaceId: 'llm-test' }));
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { addTutorHome, installTutors, lineDiff, retiredTutorFiles } = await import('../src/app/cli/tutors.ts');
const { doctorWorkspace } = await import('../src/app/cli/doctor.ts');
const { loadWorkspace, patchConfig } = await import('../src/app/workspace.ts');
const { shippedAgents } = await import('../src/app/cli/skeleton.ts');

try {
  const { root } = await initWorkspace({ slug: 'ming' });
  const agents = readdirSync(join(root, 'agents'));
  check('刚 init:三位老师各一个家,没有老师文件', ['chinese-tutor', 'english-tutor', 'math-tutor'].every((n) => agents.includes(n)) && !agents.some((f) => f.endsWith('.md')), agents.join());
  check('出厂老师 = 年级包 agents/ 下的家', (await shippedAgents()).map((a) => a.name).join() === 'chinese-tutor,english-tutor,math-tutor');
  check('cotutor.json:出厂老师带一句 description', Boolean(loadWorkspace(root).config.tutors['math-tutor'].description));
  check('没有旧老师文件:不用提', (await retiredTutorFiles(root)).length === 0);

  // 旧 workspace 里家长的老师文件:不删,refresh / doctor 提一句
  writeFileSync(join(root, 'agents', 'math-tutor.md'), '---\nname: math-tutor\n---\n多夸夸孩子。\n');
  check('旧老师文件列出来', (await retiredTutorFiles(root)).join() === 'agents/math-tutor.md');
  const d0 = await doctorWorkspace(root, { probeEnv: false });
  check('doctor:旧老师文件提一句(不算错),文件不动', d0.checks.some((c) => c.name === 'tutor.files' && c.ok && c.detail.includes('agents/math-tutor.md')) && existsSync(join(root, 'agents', 'math-tutor.md')), JSON.stringify(d0.checks.filter((c) => c.name.startsWith('tutor.'))));

  check('lineDiff', lineDiff('a\nb\nc', 'a\nx\nc').join('|') === '- b|+ x' && lineDiff('a', 'a').length === 0 && lineDiff('a\nb', 'a').join('|') === '- b');

  // ---- 自家加老师:只建家 + 进 cotutor.json;doctor 认它 ----
  const added = await addTutorHome(root, 'science-tutor');
  check('建家', existsSync(join(added.home, '.gitkeep')) && !existsSync(join(root, 'agents', 'science-tutor.md')));
  let badName = '';
  try {
    await addTutorHome(root, 'Science Tutor');
  } catch (e) {
    badName = (e as Error).message;
  }
  check('名字不合规拒绝', badName.includes('不合规'));
  await patchConfig(loadWorkspace(root), { tutors: { 'science-tutor': { display: '科学老师', subject: '科学', avatar: '🔬', enabled: true } } });
  const d = await doctorWorkspace(root, { probeEnv: false });
  check('doctor:自家老师的家 ✓,没有老师文件那一项', d.ok && d.checks.some((c) => c.name === 'tutor.science-tutor.home' && c.ok) && !d.checks.some((c) => c.name === 'tutor.science-tutor.file'), JSON.stringify(d.checks.filter((c) => c.name.includes('science'))));

  // 只在 cotutor.json 里加了名字:init 补家
  await patchConfig(loadWorkspace(root), { tutors: { 'art-tutor': { display: '美术老师', enabled: true } } });
  const steps = await installTutors(root, ['science-tutor', 'art-tutor']);
  check('installTutors 给配置里的老师补家', existsSync(join(root, 'agents', 'art-tutor')) && steps.some((s) => s.item === 'agents/art-tutor/' && s.action === 'created'), JSON.stringify(steps));
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
