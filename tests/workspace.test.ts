/** 工作区解析链:flag → env → cwd 向上 → 用户配置 → ~/cotutor 唯一 → 报错;配置坏了响亮报错。HOME 注入后动态 import。 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-ws-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
const originalCwd = process.cwd();

const { ConfigError, UsageError, loadWorkspace, resolveRoot, resolvePaths } = await import('../src/cli/workspace.ts');
const { configTemplate, shippedAgents } = await import('../src/cli/skeleton.ts');

const agents = await shippedAgents();
const mk = (dir: string, slug = 'k'): string => {
  mkdirSync(join(dir, 'agents', 'math-tutor'), { recursive: true });
  writeFileSync(join(dir, 'cotutor.json'), configTemplate({ slug, tutors: agents }));
  return dir;
};

try {
  const ws1 = mk(join(home, 'cotutor', 'ming'), 'ming');
  const other = mk(join(home, 'elsewhere'), 'other');
  const empty = join(home, 'empty');
  mkdirSync(empty);

  check('flag', resolveRoot(other, { cwd: empty }).source === 'flag');
  let threw = false;
  try {
    resolveRoot(join(home, 'nope'), { cwd: empty });
  } catch (e) {
    threw = e instanceof UsageError && e.message.includes('cotutor init');
  }
  check('flag 目录不存在 → 用法错误附修复', threw);

  check('env', resolveRoot(undefined, { cwd: empty, env: { COTUTOR_WORKSPACE: other } }).root === other);
  const up = resolveRoot(undefined, { cwd: join(ws1, 'agents', 'math-tutor'), env: {} });
  check('cwd 向上找到根(老师目录里跑)', up.root === ws1 && up.source === 'cwd', JSON.stringify(up));

  const single = resolveRoot(undefined, { cwd: empty, env: {}, homeRoot: join(home, 'cotutor') });
  check('~/cotutor 唯一一个 → home-single', single.root === ws1 && single.source === 'home-single', JSON.stringify(single));

  mk(join(home, 'cotutor', 'hong'), 'hong');
  threw = false;
  try {
    resolveRoot(undefined, { cwd: empty, env: {}, homeRoot: join(home, 'cotutor') });
  } catch (e) {
    threw = e instanceof UsageError && e.message.includes('2 个 workspace');
  }
  check('~/cotutor 两个 → 报错要求指定', threw);

  mkdirSync(join(home, '.config', 'cotutor'), { recursive: true });
  writeFileSync(join(home, '.config', 'cotutor', 'config.json'), JSON.stringify({ workspace: other }));
  const uc = resolveRoot(undefined, { cwd: empty, env: {}, homeRoot: join(home, 'cotutor') });
  check('用户配置优先于 ~/cotutor 扫描', uc.root === other && uc.source === 'user-config', JSON.stringify(uc));

  writeFileSync(join(home, '.config', 'cotutor', 'config.json'), '坏');
  threw = false;
  try {
    resolveRoot(undefined, { cwd: empty, env: {} });
  } catch (e) {
    threw = e instanceof ConfigError;
  }
  check('用户配置损坏 → ConfigError 不静默', threw);
  rmSync(join(home, '.config'), { recursive: true });

  threw = false;
  try {
    resolveRoot(undefined, { cwd: empty, env: {}, homeRoot: join(home, 'nothing') });
  } catch (e) {
    threw = e instanceof UsageError && e.message.includes('cotutor init');
  }
  check('什么都没有 → 报错附 init', threw);

  const ws = loadWorkspace(ws1, { cwd: empty });
  check('loadWorkspace 读到配置', ws.config.kid.slug === 'ming' && ws.dirs.agents === join(ws1, 'agents'));
  check('vault 未配 → 角色相对根', ws.paths.vault === ws1 && ws.paths.diary === join(ws1, 'diary') && ws.paths.profile === join(ws1, 'profile.md'));
  const paths = resolvePaths(ws1, { vault: '~/vault', diary: '日记', extra: 'x' });
  check('vault 配了 → 角色相对 vault,未知角色保留', paths.diary === join(home, 'vault', '日记') && paths.extra === join(home, 'vault', 'x'));

  writeFileSync(join(other, 'cotutor.json'), '{ 坏');
  threw = false;
  try {
    loadWorkspace(other, { cwd: empty });
  } catch (e) {
    threw = e instanceof ConfigError && e.message.includes('JSON');
  }
  check('JSON 坏 → ConfigError', threw);
  writeFileSync(join(other, 'cotutor.json'), JSON.stringify({ version: 1, kid: { slug: 'x' }, agents: { default: 'zz' } }));
  threw = false;
  let msg = '';
  try {
    loadWorkspace(other, { cwd: empty });
  } catch (e) {
    threw = e instanceof ConfigError;
    msg = (e as Error).message;
  }
  check('形状不对 → ConfigError 附逐条指南', threw && msg.includes('agents.default'), msg);
  rmSync(join(other, 'cotutor.json'));
  threw = false;
  try {
    loadWorkspace(other, { cwd: empty });
  } catch (e) {
    threw = e instanceof ConfigError && e.message.includes('不存在');
  }
  check('缺 cotutor.json → ConfigError 附 init', threw);
} finally {
  process.chdir(originalCwd);
  rmSync(home, { recursive: true, force: true });
}
done();
