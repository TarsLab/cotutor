/**
 * 口播老师的接线(《口播老师设计.md》§8;要本包 node_modules 里的 koubo):出厂关着 → init 不装 koubo 的技能、不跑 koubo init,壳照写;
 * 打开后 upgrade → 两个技能补上、koubo 工作区建在 workspace 根、.gitignore 补一行;再来一次不重复;关着的 workspace 的 doctor 不查 koubo。
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-koubo-setup-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
const { initWorkspace } = await import('../src/cli/init.ts');
const { upgradeSkills, activeSkills, kouboBin, KOUBO_SHIM } = await import('../src/cli/skills.ts');
const { setupKoubo } = await import('../src/cli/koubo-setup.ts');
const { doctorWorkspace } = await import('../src/cli/doctor.ts');

const { root } = await initWorkspace({ slug: 'jack', name: 'Jack' });
check('本包装了 koubo(link:../koubo)', kouboBin() !== null);
check('出厂关着:init 不装 koubo 的技能、不建 koubo 工作区;壳照写', !existsSync(join(root, '.claude', 'skills', 'koubo-coach')) && !existsSync(join(root, 'koubo.json')) && existsSync(join(root, KOUBO_SHIM)));
check('关着时该有的技能里没有 koubo 的', !(await activeSkills(root)).some((s) => s.source === 'koubo'));
const d0 = await doctorWorkspace(root, { probeEnv: false });
check('关着:doctor 不查 koubo', !d0.checks.some((c) => c.name === 'koubo' || c.name.startsWith('koubo.')), JSON.stringify(d0.checks.filter((c) => c.name.startsWith('koubo')).map((c) => c.name)));

const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.tutors['koubo-tutor'].enabled = true;
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const up = await upgradeSkills(root);
const steps = await setupKoubo(root);
check('打开后 upgrade:koubo-cli / koubo-coach 补上,.qwen 链也在', up.filter((s) => s.name.startsWith('koubo-')).every((s) => s.action === 'installed') && existsSync(join(root, '.claude', 'skills', 'koubo-coach', 'SKILL.md')) && existsSync(join(root, '.qwen', 'skills', 'koubo-cli')), JSON.stringify(up.filter((s) => s.name.startsWith('koubo-'))));
check('koubo 工作区就是 workspace 根:koubo.json、takes/;ledger/ 两家共用(cotutor 的 artifacts.jsonl 还在)', existsSync(join(root, 'koubo.json')) && existsSync(join(root, 'takes')) && existsSync(join(root, 'ledger', 'artifacts.jsonl')), JSON.stringify(steps));
check('.gitignore 补了 takes/**/*.wav', readFileSync(join(root, '.gitignore'), 'utf8').includes('takes/**/*.wav'));
await setupKoubo(root);
check('再来一次:那一行不重复,koubo.json 不重建', readFileSync(join(root, '.gitignore'), 'utf8').split('\n').filter((l) => l === 'takes/**/*.wav').length === 1);
const d1 = await doctorWorkspace(root, { probeEnv: false });
check('开着:doctor 查壳与 koubo,并进 koubo doctor 的各项(cloud 政策在)', d1.checks.some((c) => c.name === 'koubo' && c.ok) && d1.checks.some((c) => c.name === 'koubo.cloud 政策'), JSON.stringify(d1.checks.filter((c) => c.name.startsWith('koubo')).map((c) => [c.name, c.ok])));
done();
