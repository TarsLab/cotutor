/** init 幂等补缺、老师文件是拷贝(旧链自动换);doctor 把缺文件、坏配置、坏账本摆到明面。 */
import { statSync, existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-init-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
const originalCwd = process.cwd();

const { initWorkspace } = await import('../src/cli/init.ts');
const { doctorWorkspace } = await import('../src/cli/doctor.ts');
const { PACKAGE_AGENTS_DIR } = await import('../src/cli/skeleton.ts');

try {
  const r1 = await initWorkspace({ slug: 'ming', name: '小明' });
  const ws = join(home, 'cotutor', 'ming');
  check('缺省建在 ~/cotutor/<slug>', r1.root === ws && existsSync(ws), r1.root);
  check('骨架目录齐', ['agents', 'ledger', 'conversations', '.claude/agents', '.qwen/agents', 'scenes', 'bundles', 'snaps'].every((d) => existsSync(join(ws, d))));
  check('老师目录齐', ['math-tutor', 'chinese-tutor', 'reading-tutor', 'homework-tutor', 'planner'].every((n) => existsSync(join(ws, 'agents', n, '.gitkeep'))));
  const link = join(ws, '.claude', 'agents', 'math-tutor.md');
  check('老师文件是拷贝,内容同本包', !lstatSync(link).isSymbolicLink() && readFileSync(link, 'utf8') === readFileSync(join(PACKAGE_AGENTS_DIR, 'math-tutor.md'), 'utf8'));
  check('.qwen 是指向 .claude 的相对链', lstatSync(join(ws, '.qwen', 'agents', 'planner.md')).isSymbolicLink() && readlinkSync(join(ws, '.qwen', 'agents', 'planner.md')) === '../../.claude/agents/planner.md');
  check('出厂 hash 记下', (JSON.parse(readFileSync(join(ws, '.cotutor', 'shipped.json'), 'utf8')) as { tutors: Record<string, { hash: string }> }).tutors['math-tutor'].hash.startsWith('sha256:'));
  check('账本空文件在', existsSync(join(ws, 'ledger', 'observations.jsonl')) && existsSync(join(ws, 'ledger', 'artifacts.jsonl')));
  check('板书语法表出厂(从卡的注册表生成)', readFileSync(join(ws, '.cotutor', '板书语法.md'), 'utf8').includes('### choice'));
  check('四个领域 skill 拷进 .claude/skills/,.qwen/skills/ 是相对链,hash 记下', existsSync(join(ws, '.claude', 'skills', 'drawtell-scene', 'SKILL.md')) && existsSync(join(ws, '.claude', 'skills', 'drawtell-teaching', 'models-index.md')) && lstatSync(join(ws, '.qwen', 'skills', 'drawtell-cli')).isSymbolicLink() && readlinkSync(join(ws, '.qwen', 'skills', 'drawtell-cli')) === '../../.claude/skills/drawtell-cli' && (JSON.parse(readFileSync(join(ws, '.cotutor', 'shipped.json'), 'utf8')) as { skills: Record<string, { hash: string }> }).skills['drawtell-verify'].hash.startsWith('sha256:'));
  check('drawtell 壳脚本在,可执行,指向本包的 drawtell', readFileSync(join(ws, '.cotutor', 'drawtell'), 'utf8').includes('drawtell.js') && (statSync(join(ws, '.cotutor', 'drawtell')).mode & 0o100) !== 0);
  check('scene-maker 在老师表里:hidden、runtime claude-scene;模板有 claude-scene 运行时', (JSON.parse(readFileSync(join(ws, 'cotutor.json'), 'utf8')) as { tutors: Record<string, { hidden?: boolean; runtime?: string }>; runtimes: Record<string, unknown> }).tutors['scene-maker'].runtime === 'claude-scene' && 'claude-scene' in (JSON.parse(readFileSync(join(ws, 'cotutor.json'), 'utf8')) as { runtimes: Record<string, unknown> }).runtimes);
  const cfg = JSON.parse(readFileSync(join(ws, 'cotutor.json'), 'utf8')) as { kid: { slug: string; name?: string } };
  check('cotutor.json 模板带 slug 与名', cfg.kid.slug === 'ming' && cfg.kid.name === '小明');
  check('家规两份', readFileSync(join(ws, 'CLAUDE.md'), 'utf8').includes('家规') && existsSync(join(ws, 'QWEN.md')));
  check('用户配置指过来', (JSON.parse(readFileSync(join(home, '.config', 'cotutor', 'config.json'), 'utf8')) as { workspace: string }).workspace === ws);
  check('首跑全部 created', r1.steps.every((s) => s.action === 'created'), JSON.stringify(r1.steps.filter((s) => s.action !== 'created')));

  writeFileSync(join(ws, 'CLAUDE.md'), '# 我家的规矩');
  const r2 = await initWorkspace({ slug: 'ming' });
  check('重跑没有 created', r2.steps.every((s) => s.action !== 'created'), JSON.stringify(r2.steps.filter((s) => s.action === 'created')));
  check('家规不覆盖', readFileSync(join(ws, 'CLAUDE.md'), 'utf8') === '# 我家的规矩');

  const r3 = await initWorkspace({ slug: 'hong', dir: join(home, 'elsewhere') });
  check('--dir 覆盖缺省位置', r3.root === join(home, 'elsewhere') && existsSync(join(home, 'elsewhere', 'cotutor.json')));
  check('用户配置已指向别处 → kept', r3.steps.find((s) => s.item === 'user-config')?.action === 'kept');

  const d1 = await doctorWorkspace(ws, { probeEnv: false });
  check('健康workspace体检通过', d1.ok, JSON.stringify(d1.checks.filter((c) => c.required && !c.ok)));
  check('doctor 查板书语法表', d1.checks.some((c) => c.name === 'board.syntax' && c.ok && c.required));
  check('老师链都查了(六位:含 scene-maker)', d1.checks.filter((c) => c.name.startsWith('tutor.') && c.name.endsWith('.claude')).length === 6);
  check('doctor 查 skill 与 drawtell 壳', d1.checks.filter((c) => c.name.startsWith('skill.') && c.ok).length === 4 && d1.checks.some((c) => c.name === 'drawtell' && c.ok && !c.required));
  check('默认运行时是 claude → .claude 链必需、.qwen 链非必需', d1.checks.some((c) => c.name === 'tutor.math-tutor.claude' && c.required) && d1.checks.some((c) => c.name === 'tutor.math-tutor.qwen' && !c.required));
  check('git 是建议', d1.checks.some((c) => c.name === 'git' && !c.ok && !c.required));

  unlinkSync(link);
  const d2 = await doctorWorkspace(ws, { probeEnv: false });
  check('文件没了 → 必需失败附 init', !d2.ok && d2.checks.some((c) => c.name === 'tutor.math-tutor.claude' && !c.ok && c.fix?.includes('init')));
  await initWorkspace({ slug: 'ming' });
  check('init 补拷', existsSync(link) && !lstatSync(link).isSymbolicLink());
  // 旧workspace:指向包的链 → init 换成拷贝
  unlinkSync(link);
  symlinkSync(join(PACKAGE_AGENTS_DIR, 'math-tutor.md'), link);
  const dLegacy = await doctorWorkspace(ws, { probeEnv: false });
  check('旧的包内链 → doctor 提醒换拷贝', dLegacy.checks.some((c) => c.name === 'tutor.math-tutor.origin' && !c.ok && c.detail.includes('旧链')));
  const rLegacy = await initWorkspace({ slug: 'ming' });
  check('init 把旧链换成拷贝', !lstatSync(link).isSymbolicLink() && rLegacy.steps.some((s) => s.item === '.claude/agents/math-tutor.md' && s.action === 'replaced'));
  // 家长改过的文件:init 不动,doctor 标自定义
  writeFileSync(link, readFileSync(link, 'utf8') + '\n再温柔一点。\n');
  await initWorkspace({ slug: 'ming' });
  check('改过的老师文件 init 不动', readFileSync(link, 'utf8').includes('再温柔一点'));
  check('doctor 标自定义', (await doctorWorkspace(ws, { probeEnv: false })).checks.some((c) => c.name === 'tutor.math-tutor.origin' && c.ok && c.detail.includes('自定义')));

  writeFileSync(join(ws, 'ledger', 'observations.jsonl'), '{"id":"o-1","date":"2026-09-08","author":"math-tutor","claim":"ok"}\n坏行\n');
  const d3 = await doctorWorkspace(ws, { probeEnv: false });
  check('账本坏行 → 必需失败并点名行号', !d3.ok && d3.checks.some((c) => c.name === 'ledger.observations' && !c.ok && c.detail.includes('第 2 行')));
  writeFileSync(join(ws, 'ledger', 'observations.jsonl'), '');

  writeFileSync(join(ws, 'cotutor.json'), '{ 坏');
  const d4 = await doctorWorkspace(ws, { probeEnv: false });
  check('配置坏 → 必需失败,不死', !d4.ok && d4.checks.some((c) => c.name === 'cotutor.json' && !c.ok && c.required));

  process.chdir(join(ws, 'agents', 'planner'));
  const d5 = await doctorWorkspace(undefined, { probeEnv: false, env: {} });
  check('老师目录里跑 doctor 找到根', d5.root === ws && d5.source === 'cwd', JSON.stringify({ root: d5.root, source: d5.source }));
} finally {
  process.chdir(originalCwd);
  rmSync(home, { recursive: true, force: true });
}
{
  const { configTemplate } = await import('../src/cli/skeleton.ts');
  const tpl = JSON.parse(configTemplate({ slug: 'x', name: 'x', tutors: [] })) as { runtimes: { claude: { run: string[]; resume: string[] }; qwen: { run: string[] } } };
  check('claude 模板带 --include-partial-messages(流式),qwen 没有这个开关', tpl.runtimes.claude.run.includes('--include-partial-messages') && tpl.runtimes.claude.resume.includes('--include-partial-messages') && !tpl.runtimes.qwen.run.includes('--include-partial-messages'));
  const tplS = JSON.parse(configTemplate({ slug: 'x', name: 'x', tutors: [] })) as { runtimes: Record<string, { run: string[] }> };
  check('普通老师的 claude 模板禁掉 Agent(不派子代理);claude-scene 不禁(scene-maker 要派检验)', tplS.runtimes.claude.run.join(' ').includes('--disallowedTools Agent') && !tplS.runtimes['claude-scene'].run.includes('--disallowedTools'));
}
done();
