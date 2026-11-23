/** 年级包来源、旧 hash 迁移、自定义保护、坏来源不回退。 */
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const testHome = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-grades-')));
process.env.HOME = testHome;
delete process.env.COTUTOR_WORKSPACE;
const { gradePacks, requireGradePack, workspaceGradePack } = await import('../src/app/cli/grades.ts');
const { gradeOfSemester } = await import('../src/memory/grade.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { readManifest, writeManifest, sha256 } = await import('../src/app/cli/tutors.ts');
const { upgradeActivities, restoreActivity, shippedActivityText, shippedActivities } = await import('../src/app/cli/activities.ts');
const { lintActivity, resolveParams, renderTutorSection } = await import('../src/runtime/activity.ts');
const { parseExamples } = await import('../src/app/activity-eval-rules.ts');
const { doctorWorkspace } = await import('../src/app/cli/doctor.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { packDryRun } = await import('../src/runtime/runner.ts');
const { findActivityFile } = await import('../src/runtime/activities.ts');

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
  const activity = join(root, 'agents/math-tutor/activities/检查作业.md');
  const factoryActivity = readFileSync(activity, 'utf8');
  const mineActivity = factoryActivity + '\n家长的话:今天只看一题。\n';
  writeFileSync(activity, mineActivity);
  const profile = join(`${root}-vault`, '孩子.md'); // vault 在旁边(2026-11-09)
  const profileText = '---\ncotutor: profile\nsemester: 三年级上\n---\n孩子英语刚起步。\n';
  writeFileSync(profile, profileText);
  const configText = readFileSync(join(root, 'cotutor.json'), 'utf8');

  // 模拟旧版出厂清单(没有 teachingPack):自定义的 activity 照样保留
  const m = await readManifest(root);
  delete m.teachingPack;
  await writeManifest(root, m);
  check('只读旧来源不改记录', (await workspaceGradePack(root)).grade === 2 && !(await readManifest(root)).teachingPack);
  const acts = await upgradeActivities(root);
  check('旧版自定义 activity 保留', acts.find((s) => s.key === 'math-tutor/检查作业')?.action === 'kept-custom' && readFileSync(activity, 'utf8') === mineActivity);
  check('迁移补来源', (await readManifest(root)).teachingPack?.grade === 2);
  await initWorkspace({ slug: 'kid', dir: root });
  check('重复 init 保留自定义、档案和配置', readFileSync(activity, 'utf8') === mineActivity && readFileSync(profile, 'utf8') === profileText && readFileSync(join(root, 'cotutor.json'), 'utf8') === configText);
  await restoreActivity(root, 'math-tutor', '检查作业');
  check('恢复正确包的出厂件并备份', readFileSync(activity, 'utf8') === factoryActivity && readFileSync(activity + '.bak', 'utf8') === mineActivity);
  const report = await doctorWorkspace(root, { probeEnv: false, now: new Date('2026-10-27T00:00:00Z') });
  check('doctor 提醒年级不匹配但不自动换包', report.checks.some((c) => c.name === 'teachingPack.grade' && !c.ok && !c.required) && (await readManifest(root)).teachingPack?.grade === 2);

  // 每个新 activity 都能检查、解析例子、填参数并进入独立提示词。
  const refs = await shippedActivities(root);
  // 语文、数学的预习、复习合成了「课本」;英语照旧
  const common: Record<string, string[]> = { 'chinese-tutor': ['课本', '检查作业'], 'math-tutor': ['课本', '检查作业'], 'english-tutor': ['预习', '检查作业', '复习'] };
  for (const [tutor, names] of Object.entries(common)) {
    for (const name of names) {
      const file = refs.find((r) => r.tutor === tutor && r.name === name)!.file;
      const parsed = lintActivity(readFileSync(file, 'utf8'), { fileName: name });
      check(`${tutor}/${name} 独立提示词通过检查`, parsed.issues.length === 0 && !!renderTutorSection(parsed.activity, {})?.includes('二年级'), JSON.stringify(parsed.issues));
      const ex = parseExamples(readFileSync(file.replace(/\.md$/, '.例子.md'), 'utf8'));
      check(`${tutor}/${name} 有可运行的材料与结束例子`, ex.issues.length === 0 && ex.examples.length >= 3 && ex.examples.every((e) => resolveParams(parsed.activity, Object.fromEntries(e.params.split(';').filter(Boolean).map((s) => s.split('=')))).issues.length === 0), JSON.stringify(ex.issues));
    }
  }
  const ws = loadWorkspace(root);
  const dry = await packDryRun(ws, 'math-tutor', { from: 'kid', at: new Date('2026-10-27T00:00:00Z'), text: '帮我检查', activity: { name: '检查作业', params: { 范围: '23 + 18 = 31' } } });
  check('pack 里活动参数与孩子学期都在,不会伪改孩子年级', dry.prompt.includes('23 + 18 = 31') && dry.prompt.includes('三年级上') && dry.pack.activity?.name === '检查作业');

  // 2026-11-03「批改」改名「检查作业」:老 workspace 里旧名的文件 upgrade 时挪成新名;没改过的照旧换新,改过的只改头上的名字
  {
    const old = join(testHome, 'renamed');
    await initWorkspace({ slug: 'kid', dir: old, grade: 2 });
    const dir = (t: string): string => join(old, 'agents', t, 'activities');
    const om = await readManifest(old);
    const toOld = (t: string, extra: string): void => {
      // 旧版的样子:头上叫批改,正文那句也是「带孩子批改」(新版改了这一句,没改过的升级后要换成新版)
      const shipped = readFileSync(join(dir(t), '检查作业.md'), 'utf8').replace(/^name: 检查作业$/m, 'name: 批改').replace('带孩子检查作业', '带孩子批改');
      writeFileSync(join(dir(t), '批改.md'), shipped + extra);
      rmSync(join(dir(t), '检查作业.md'));
      const ex = readFileSync(join(dir(t), '检查作业.例子.md'), 'utf8').replace(/^activity: 检查作业$/m, 'activity: 批改');
      writeFileSync(join(dir(t), '批改.例子.md'), ex);
      rmSync(join(dir(t), '检查作业.例子.md'));
      delete om.activities![`${t}/检查作业`];
      delete om.activities![`${t}/检查作业.例子`];
      om.activities![`${t}/批改`] = { hash: sha256(shipped), version: '0.1.0' };
      om.activities![`${t}/批改.例子`] = { hash: sha256(ex), version: '0.1.0' };
    };
    toOld('math-tutor', '');
    toOld('chinese-tutor', '\n家长的话:只看第一题。\n');
    await writeManifest(old, om);
    check('没 upgrade 的老 workspace:方砖要的「检查作业」读旧名的文件,旧名照样认', findActivityFile(old, 'math-tutor', '检查作业').endsWith('批改.md') && findActivityFile(old, 'math-tutor', '批改').endsWith('批改.md'));
    const steps = await upgradeActivities(old);
    const shippedText = readFileSync((await shippedActivities(old)).find((r) => r.tutor === 'math-tutor' && r.name === '检查作业')!.file, 'utf8');
    const mineNow = readFileSync(join(dir('chinese-tutor'), '检查作业.md'), 'utf8');
    check('upgrade 把旧名挪成新名(文件与例子),没有旧名留下', steps.filter((s) => s.action === 'renamed').map((s) => `${s.key}<${s.from}`).sort().join() === ['chinese-tutor/检查作业.例子<批改.例子', 'chinese-tutor/检查作业<批改', 'math-tutor/检查作业.例子<批改.例子', 'math-tutor/检查作业<批改'].sort().join() && !existsSync(join(dir('math-tutor'), '批改.md')) && !existsSync(join(dir('chinese-tutor'), '批改.例子.md')), JSON.stringify(steps.filter((s) => s.action === 'renamed')));
    const after = (key: string): string | undefined => steps.find((s) => s.key === key && s.action !== 'renamed')?.action;
    check('没改过的换成新版;改过的留着家长的话、头上改了名、算自定义', readFileSync(join(dir('math-tutor'), '检查作业.md'), 'utf8') === shippedText && mineNow.includes('家长的话:只看第一题') && /^name: 检查作业$/m.test(mineNow) && after('chinese-tutor/检查作业') === 'kept-custom' && after('math-tutor/检查作业') === 'upgraded');
    check('挪完以后旧草稿里的「批改」认到新文件', findActivityFile(old, 'chinese-tutor', '批改').endsWith('检查作业.md') && !('chinese-tutor/批改' in (await readManifest(old)).activities!));
    check('再 upgrade 一次不再挪', !(await upgradeActivities(old)).some((s) => s.action === 'renamed'));
  }

  // 2026-11-17 听写不是 activity 了:老 workspace 里 activities/听写.md 挪到老师的家 agents/<老师>/听写.md;没改过的换新,改过的内容不动
  {
    const old = join(testHome, 'dictation-moved');
    await initWorkspace({ slug: 'kid', dir: old, grade: 2 });
    const home = (t: string): string => join(old, 'agents', t, '听写.md');
    const inActs = (t: string): string => join(old, 'agents', t, 'activities', '听写.md');
    const om = await readManifest(old);
    const oldZh = readFileSync(home('chinese-tutor'), 'utf8').replace('lang: zh', 'page: dictation');
    writeFileSync(inActs('chinese-tutor'), oldZh);
    rmSync(home('chinese-tutor'));
    om.activities!['chinese-tutor/听写'] = { hash: sha256(oldZh), version: '0.1.0' };
    const mineEn = readFileSync(home('english-tutor'), 'utf8').replace('lang: en', 'page: dictation-en') + '\n家长加的一句\n';
    writeFileSync(inActs('english-tutor'), mineEn);
    rmSync(home('english-tutor'));
    om.activities!['english-tutor/听写'] = { hash: sha256('不一样'), version: '0.1.0' };
    await writeManifest(old, om);
    const steps = await upgradeActivities(old);
    const shippedZh = readFileSync((await shippedActivities(old)).find((r) => r.tutor === 'chinese-tutor' && r.home)!.file, 'utf8');
    check('upgrade 把 activities/听写.md 挪到老师的家里,activities/ 下不留', steps.filter((s) => s.action === 'moved').map((s) => s.key).sort().join() === 'chinese-tutor/听写,english-tutor/听写' && !existsSync(inActs('chinese-tutor')) && !existsSync(inActs('english-tutor')), JSON.stringify(steps.filter((s) => s.action === 'moved')));
    check('没改过的换成新版(头上 lang),改过的内容不动、算自定义', readFileSync(home('chinese-tutor'), 'utf8') === shippedZh && readFileSync(home('english-tutor'), 'utf8') === mineEn && steps.find((s) => s.key === 'english-tutor/听写' && s.action !== 'moved')?.action === 'kept-custom');
    check('再 upgrade 一次不再挪', !(await upgradeActivities(old)).some((s) => s.action === 'moved'));
  }

  // 2026-11-23 语文、数学的预习、复习合成「课本」:没改过的 refresh 删掉,改过的留着、报一句;英语的不动
  {
    const old = join(testHome, 'textbook-merged');
    await initWorkspace({ slug: 'kid', dir: old, grade: 2 });
    const dir = (t: string): string => join(old, 'agents', t, 'activities');
    const om = await readManifest(old);
    const put = (t: string, name: string, text: string, recorded: string): void => {
      writeFileSync(join(dir(t), `${name}.md`), text);
      om.activities![`${t}/${name}`] = { hash: sha256(recorded), version: '0.1.0' };
    };
    put('math-tutor', '预习', '旧的数学预习\n', '旧的数学预习\n');
    put('math-tutor', '预习.例子', '旧的例子\n', '旧的例子\n');
    put('math-tutor', '复习', '旧的数学复习\n', '旧的数学复习\n');
    put('chinese-tutor', '预习', '旧的语文预习\n家长加的一句\n', '旧的语文预习\n');
    put('chinese-tutor', '预习.例子', '旧的例子\n', '旧的例子\n');
    await writeManifest(old, om);
    const steps = await upgradeActivities(old);
    const act = (key: string): string | undefined => steps.find((s) => s.key === key)?.action;
    check('没改过的删掉(连例子),出厂记录也删', act('math-tutor/预习') === 'retired' && act('math-tutor/预习.例子') === 'retired' && act('math-tutor/复习') === 'retired' && !existsSync(join(dir('math-tutor'), '预习.md')) && !existsSync(join(dir('math-tutor'), '复习.md')) && !('math-tutor/预习' in (await readManifest(old)).activities!), JSON.stringify(steps.filter((s) => s.action.includes('retired'))));
    check('改过的留着、例子跟着留,说为什么', act('chinese-tutor/预习') === 'kept-retired' && act('chinese-tutor/预习.例子') === 'kept-retired' && existsSync(join(dir('chinese-tutor'), '预习.例子.md')) && readFileSync(join(dir('chinese-tutor'), '预习.md'), 'utf8').includes('家长加的一句') && steps.find((s) => s.key === 'chinese-tutor/预习')?.note === '出厂已经合成「课本」');
    check('英语的预习、复习照旧是出厂件;两位老师都有课本', act('english-tutor/预习') === 'latest' && act('english-tutor/复习') === 'latest' && act('math-tutor/课本') === 'latest' && act('chinese-tutor/课本') === 'latest', JSON.stringify(steps.filter((s) => s.key.startsWith('english-tutor'))));
  }

  const { readLecture } = await import('../src/runtime/lecture.ts');
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
    ['升级 activity', () => upgradeActivities(root)],
    ['恢复 activity', () => restoreActivity(root, 'math-tutor', '检查作业')],
    ['查看 activity 出厂差异', () => shippedActivityText('math-tutor', '检查作业', root)],
  ] as const) await rejects(`${label} 不回退到二年级`, op, /没有完整的 3/);
  const missing = await doctorWorkspace(root, { probeEnv: false });
  check('doctor 报缺失包而不崩溃', missing.checks.some((c) => c.name === 'teachingPack' && !c.ok && c.required));
  check('失败操作不改 activity', readFileSync(activity, 'utf8') === factoryActivity);
  writeFileSync(join(root, '.cotutor/shipped.json'), '{bad');
  await rejects('损坏记录不重建 hash', () => initWorkspace({ slug: 'kid', dir: root }), /出厂记录用不了/);
  const corrupt = await doctorWorkspace(root, { probeEnv: false });
  check('doctor 报损坏记录而不崩溃', corrupt.checks.some((c) => c.name === 'teachingPack' && !c.ok));
  check('损坏记录保留原样供修复', readFileSync(join(root, '.cotutor/shipped.json'), 'utf8') === '{bad');
} finally {
  rmSync(testHome, { recursive: true, force: true });
}
done();
