/** 年级包来源、旧 hash 迁移、自定义保护、坏来源不回退。 */
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const testHome = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-grades-')));
process.env.HOME = testHome;
delete process.env.COTUTOR_WORKSPACE;
const { gradePacks, requireGradePack, workspaceGradePack } = await import('../src/cli/grades.ts');
const { gradeOfSemester } = await import('../src/lib/grade.ts');
const { initWorkspace } = await import('../src/cli/init.ts');
const { readManifest, writeManifest, sha256, upgradeTutors, restoreTutor, shippedTutorText } = await import('../src/cli/tutors.ts');
const { upgradeActivities, restoreActivity, shippedActivityText, shippedActivities } = await import('../src/cli/activities.ts');
const { lintActivity, resolveParams, renderTutorSection } = await import('../src/lib/activity.ts');
const { parseExamples } = await import('../src/lib/activity-eval.ts');
const { doctorWorkspace } = await import('../src/cli/doctor.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { packDryRun } = await import('../src/server/runner.ts');

async function rejects(label: string, fn: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try { await fn(); check(label, false, '没有拒绝'); }
  catch (err) { check(label, pattern.test((err as Error).message), (err as Error).message); }
}

try {
  check('当前只提供二年级', (await gradePacks()).map((p) => p.grade).join() === '2');
  for (const n of [0, 7, 2.5, NaN]) await rejects(`年级 ${n} 不合法`, () => requireGradePack(n), /1–6/);
  await rejects('未提供年级不回退', () => requireGradePack(3), /可用年级:2/);
  const absent = join(testHome, 'unsupported');
  await rejects('初始化前验证年级', () => initWorkspace({ slug: 'a', dir: absent, grade: 6 }), /没有完整/);
  check('失败的初始化不留半个 workspace', !existsSync(absent));
  check('学期对比支持上下学期与假期', ['二年级上', '二年级下', '二年级暑假', '2年级上'].every((s) => gradeOfSemester(s) === 2) && gradeOfSemester(null) === null && gradeOfSemester('初一') === null);

  // 发现靠目录和必要内容,不写死每个年级;不完整的包不列出。
  const catalog = join(testHome, 'catalog');
  const source = await requireGradePack(2);
  cpSync(source.dir, join(catalog, 'grade-4'), { recursive: true });
  mkdirSync(join(catalog, 'grade-3'), { recursive: true });
  check('贡献新年级无需注册表,不完整的包不列出', (await gradePacks(catalog)).map((p) => p.grade).join() === '4' && (await requireGradePack(4, catalog)).agentsDir === join(catalog, 'grade-4', 'agents'));

  const root = join(testHome, 'family');
  const first = await initWorkspace({ slug: 'kid', dir: root, grade: 2 });
  check('显式安装来源写入清单', (await readManifest(root)).teachingPack?.grade === 2 && first.steps.some((s) => s.item === 'teachingPack'));
  const teacher = join(root, '.claude/agents/math-tutor.md');
  const activity = join(root, 'agents/math-tutor/activities/批改.md');
  const factoryTeacher = readFileSync(teacher, 'utf8');
  const factoryActivity = readFileSync(activity, 'utf8');
  const mine = factoryTeacher + '\n家长的话:先摆小棒。\n';
  const mineActivity = factoryActivity + '\n家长的话:今天只看一题。\n';
  writeFileSync(teacher, mine);
  writeFileSync(activity, mineActivity);
  const profile = join(root, '孩子.md');
  const profileText = '---\ncotutor: profile\nsemester: 三年级上\n---\n孩子英语刚起步。\n';
  writeFileSync(profile, profileText);
  const configText = readFileSync(join(root, 'cotutor.json'), 'utf8');

  // 模拟旧版出厂清单:记录一个未改过的旧老师版本,另两份已经自定义。
  const m = await readManifest(root);
  delete m.teachingPack;
  const enFile = join(root, '.claude/agents/english-tutor.md');
  const oldEnglish = readFileSync(enFile, 'utf8') + '\n旧版出厂教学说明。\n';
  writeFileSync(enFile, oldEnglish);
  m.tutors['english-tutor'] = { hash: sha256(oldEnglish), version: '0.1.0' };
  const customHash = m.tutors['math-tutor'].hash;
  await writeManifest(root, m);
  check('只读旧来源不改记录', (await workspaceGradePack(root)).grade === 2 && !(await readManifest(root)).teachingPack);
  const upgrade = await upgradeTutors(root);
  const acts = await upgradeActivities(root);
  check('旧版未改文件按原 hash 更新', upgrade.find((s) => s.name === 'english-tutor')?.action === 'upgraded' && !readFileSync(enFile, 'utf8').includes('旧版出厂教学说明'));
  check('旧版自定义老师和 activity 保留', upgrade.find((s) => s.name === 'math-tutor')?.action === 'kept-custom' && acts.find((s) => s.key === 'math-tutor/批改')?.action === 'kept-custom' && readFileSync(teacher, 'utf8') === mine && readFileSync(activity, 'utf8') === mineActivity);
  check('迁移补来源但不重置自定义 hash', (await readManifest(root)).teachingPack?.grade === 2 && (await readManifest(root)).tutors['math-tutor'].hash === customHash);
  await initWorkspace({ slug: 'kid', dir: root });
  check('重复 init 保留自定义、档案和配置', readFileSync(teacher, 'utf8') === mine && readFileSync(activity, 'utf8') === mineActivity && readFileSync(profile, 'utf8') === profileText && readFileSync(join(root, 'cotutor.json'), 'utf8') === configText);
  await restoreTutor(root, 'math-tutor');
  await restoreActivity(root, 'math-tutor', '批改');
  check('恢复正确包的出厂件并备份', readFileSync(teacher, 'utf8') === factoryTeacher && readFileSync(teacher + '.bak', 'utf8') === mine && readFileSync(activity, 'utf8') === factoryActivity && readFileSync(activity + '.bak', 'utf8') === mineActivity);
  const report = await doctorWorkspace(root, { probeEnv: false, now: new Date('2026-10-27T00:00:00Z') });
  check('doctor 提醒年级不匹配但不自动换包', report.checks.some((c) => c.name === 'teachingPack.grade' && !c.ok && !c.required) && (await readManifest(root)).teachingPack?.grade === 2);

  // 每个新 activity 都能检查、解析例子、填参数并进入独立提示词。
  const refs = await shippedActivities(root);
  const common = ['预习', '批改', '复习'];
  for (const tutor of ['chinese-tutor', 'math-tutor', 'english-tutor']) {
    for (const name of [...common, ...(tutor === 'chinese-tutor' ? ['写话'] : [])]) {
      const file = refs.find((r) => r.tutor === tutor && r.name === name)!.file;
      const parsed = lintActivity(readFileSync(file, 'utf8'), { fileName: name, tutorCards: [] });
      check(`${tutor}/${name} 独立提示词与卡通过检查`, parsed.issues.length === 0 && !!renderTutorSection(parsed.activity, { cards: parsed.activity.cards })?.includes('二年级'), JSON.stringify(parsed.issues));
      const ex = parseExamples(readFileSync(file.replace(/\.md$/, '.例子.md'), 'utf8'));
      check(`${tutor}/${name} 有可运行的材料与结束例子`, ex.issues.length === 0 && ex.examples.length >= 3 && ex.examples.every((e) => resolveParams(parsed.activity, Object.fromEntries(e.params.split(';').filter(Boolean).map((s) => s.split('=')))).issues.length === 0), JSON.stringify(ex.issues));
    }
  }
  const ws = loadWorkspace(root);
  const dry = await packDryRun(ws, 'math-tutor', { from: 'kid', at: new Date('2026-10-27T00:00:00Z'), text: '帮我检查', activity: { name: '批改', params: { 范围: '23 + 18 = 31' } } });
  check('pack 里活动参数与孩子学期都在,不会伪改孩子年级', dry.prompt.includes('23 + 18 = 31') && dry.prompt.includes('三年级上') && dry.pack.activity?.name === '批改');

  const { readLecture } = await import('../src/server/lecture.ts');
  const { default: sample } = await import('../grades/grade-2/examples/2026-10-27-pingjunfen.ts');
  const sampleDir = join(source.dir, 'examples', sample.id);
  const lesson = await readLecture({ dirs: { bundles: join(source.dir, 'examples') } }, sample.id);
  const sceneJson = JSON.parse(readFileSync(join(sampleDir, 'scene.json'), 'utf8'));
  const lessonManifest = JSON.parse(readFileSync(join(sampleDir, 'manifest.json'), 'utf8'));
  check('平均分样例可读取、已烤画面、讲稿与源一致', lesson?.baked && lesson.subject === '数学' && isDeepStrictEqual(sceneJson.skeletons, sample.skeletons) && lessonManifest.steps.every((step: { line: string }, i: number) => step.line === sample.steps![i].line));
  check('平均分样例配音齐全,没有失效引用', lessonManifest.steps.every((step: { audioSrc?: string; audioDurationMs?: number }) => step.audioSrc && existsSync(join(sampleDir, step.audioSrc)) && (step.audioDurationMs ?? 0) > 0));

  const good = readFileSync(join(root, '.cotutor/shipped.json'), 'utf8');
  const broken = JSON.parse(good);
  broken.teachingPack.grade = 3;
  writeFileSync(join(root, '.cotutor/shipped.json'), JSON.stringify(broken));
  for (const [label, op] of [
    ['升级老师', () => upgradeTutors(root)], ['升级 activity', () => upgradeActivities(root)],
    ['恢复老师', () => restoreTutor(root, 'math-tutor')], ['恢复 activity', () => restoreActivity(root, 'math-tutor', '批改')],
    ['查看老师出厂差异', () => shippedTutorText('math-tutor', root)], ['查看 activity 出厂差异', () => shippedActivityText('math-tutor', '批改', root)],
  ] as const) await rejects(`${label} 不回退到二年级`, op, /没有完整的 3/);
  const missing = await doctorWorkspace(root, { probeEnv: false });
  check('doctor 报缺失包而不崩溃', missing.checks.some((c) => c.name === 'teachingPack' && !c.ok && c.required));
  check('失败操作不改老师文件', readFileSync(teacher, 'utf8') === factoryTeacher && readFileSync(activity, 'utf8') === factoryActivity);
  writeFileSync(join(root, '.cotutor/shipped.json'), '{bad');
  await rejects('损坏记录不重建 hash', () => initWorkspace({ slug: 'kid', dir: root }), /出厂记录用不了/);
  const corrupt = await doctorWorkspace(root, { probeEnv: false });
  check('doctor 报损坏记录而不崩溃', corrupt.checks.some((c) => c.name === 'teachingPack' && !c.ok));
  check('损坏记录保留原样供修复', readFileSync(join(root, '.cotutor/shipped.json'), 'utf8') === '{bad');
} finally {
  rmSync(testHome, { recursive: true, force: true });
}
done();
