/** init 幂等补缺、老师定义是拷贝(旧链自动换);doctor 把缺文件、坏配置、坏账本摆到明面。 */
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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
  check('骨架目录齐', ['agents', 'ledger', 'conversations', '.claude/agents', '.qwen/agents'].every((d) => existsSync(join(ws, d))));
  check('老师目录齐', ['math-teacher', 'chinese-teacher', 'reading-teacher', 'homework-aide', 'planner'].every((n) => existsSync(join(ws, 'agents', n, '.gitkeep'))));
  const link = join(ws, '.claude', 'agents', 'math-teacher.md');
  check('老师定义是拷贝,内容同本包', !lstatSync(link).isSymbolicLink() && readFileSync(link, 'utf8') === readFileSync(join(PACKAGE_AGENTS_DIR, 'math-teacher.md'), 'utf8'));
  check('.qwen 是指向 .claude 的相对链', lstatSync(join(ws, '.qwen', 'agents', 'planner.md')).isSymbolicLink() && readlinkSync(join(ws, '.qwen', 'agents', 'planner.md')) === '../../.claude/agents/planner.md');
  check('出厂 hash 记下', (JSON.parse(readFileSync(join(ws, '.cotutor', 'shipped.json'), 'utf8')) as { teachers: Record<string, { hash: string }> }).teachers['math-teacher'].hash.startsWith('sha256:'));
  check('账本空文件在', existsSync(join(ws, 'ledger', 'observations.jsonl')) && existsSync(join(ws, 'ledger', 'artifacts.jsonl')));
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
  check('健康工作区体检通过', d1.ok, JSON.stringify(d1.checks.filter((c) => c.required && !c.ok)));
  check('老师链都查了', d1.checks.filter((c) => c.name.startsWith('teacher.') && c.name.endsWith('.claude')).length === 5);
  check('默认预设是 claude → .claude 链必需、.qwen 链非必需', d1.checks.some((c) => c.name === 'teacher.math-teacher.claude' && c.required) && d1.checks.some((c) => c.name === 'teacher.math-teacher.qwen' && !c.required));
  check('git 是建议', d1.checks.some((c) => c.name === 'git' && !c.ok && !c.required));

  unlinkSync(link);
  const d2 = await doctorWorkspace(ws, { probeEnv: false });
  check('文件没了 → 必需失败附 init', !d2.ok && d2.checks.some((c) => c.name === 'teacher.math-teacher.claude' && !c.ok && c.fix?.includes('init')));
  await initWorkspace({ slug: 'ming' });
  check('init 补拷', existsSync(link) && !lstatSync(link).isSymbolicLink());
  // 旧工作区:指向包的链 → init 换成拷贝
  unlinkSync(link);
  symlinkSync(join(PACKAGE_AGENTS_DIR, 'math-teacher.md'), link);
  const dLegacy = await doctorWorkspace(ws, { probeEnv: false });
  check('旧的包内链 → doctor 提醒换拷贝', dLegacy.checks.some((c) => c.name === 'teacher.math-teacher.origin' && !c.ok && c.detail.includes('旧链')));
  const rLegacy = await initWorkspace({ slug: 'ming' });
  check('init 把旧链换成拷贝', !lstatSync(link).isSymbolicLink() && rLegacy.steps.some((s) => s.item === '.claude/agents/math-teacher.md' && s.action === 'replaced'));
  // 家长改过的文件:init 不动,doctor 标自定义
  writeFileSync(link, readFileSync(link, 'utf8') + '\n再温柔一点。\n');
  await initWorkspace({ slug: 'ming' });
  check('改过的老师文件 init 不动', readFileSync(link, 'utf8').includes('再温柔一点'));
  check('doctor 标自定义', (await doctorWorkspace(ws, { probeEnv: false })).checks.some((c) => c.name === 'teacher.math-teacher.origin' && c.ok && c.detail.includes('自定义')));

  writeFileSync(join(ws, 'ledger', 'observations.jsonl'), '{"id":"o-1","date":"2026-09-08","author":"math-teacher","claim":"ok"}\n坏行\n');
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
done();
