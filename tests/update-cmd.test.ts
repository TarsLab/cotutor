/**
 * cotutor update(src/app/cli/update-cmd.ts):问新版本 → 换程序 → 每个孩子更新出厂文件、重起。全假,不上网、不动服务。
 * 孩子在通话不动;Node 太旧、npm 没成都停在服务没动的地方;走镜像;装到别处看得出来;上次中断了再跑接着做;顺手把带版本号的 node 换掉。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const { runUpdate } = await import('../src/app/cli/update-cmd.ts');
import type { UpdateDeps, UpdateService } from '../src/app/cli/update-cmd.ts';

const kid = (name: string, o: Partial<UpdateService> = {}, health: Record<string, unknown> = {}): UpdateService => ({ name, kid: name.toUpperCase(), root: `/w/${name}`, port: 8443, node: '/usr/local/bin/node', health: { version: '0.4.2', started: 'x', calls: 0, ...health }, ...o });
const REL = { version: '0.5.0', notes: ['改了这个', '改了那个'], minNode: [22, 18] as [number, number], mirror: false };

function world(o: Partial<UpdateDeps> & { kids?: UpdateService[] } = {}) {
  const npm: [string, string | null][] = [];
  const cli: string[] = [];
  const lines: string[] = [];
  let installed = '0.4.2';
  const deps: UpdateDeps = {
    current: '0.4.2',
    fromRepo: false,
    nodeVersion: 'v22.20.0',
    release: async () => REL,
    services: async () => o.kids ?? [kid('ray')],
    health: async () => ({ version: installed, started: 'x' }),
    npm: async (spec, registry) => { npm.push([spec, registry]); installed = spec; return { code: 0, out: 'changed 275 packages' }; },
    installed: () => installed,
    cli: async (args) => { cli.push(args.join(' ')); return { code: 0, out: args[0] === 'doctor' ? '{"checks":[]}' : '✓ theme default 已是最新\n✓ skill x 已换新(基于 0.4.2)' }; },
    workspace: () => null,
    stableNode: (p) => p.replace('/Cellar/node/1/bin', '/opt/node/bin'),
    print: (l) => lines.push(l),
    ...o,
  };
  return { deps, npm, cli, lines, text: () => lines.join('\n') };
}

{
  const w = world();
  const code = await runUpdate(w.deps);
  check('有新版本:说改了什么、换程序、更新文件、重起、看一眼体检,以 0 退', code === 0 && w.npm[0][0] === '0.5.0' && w.npm[0][1] === null && w.cli.join('|') === 'refresh --workspace /w/ray|service restart --workspace /w/ray|doctor --workspace /w/ray --json', w.cli.join('|'));
  check('家长看得到版本和说明、每个孩子的结果', w.text().includes('0.4.2') && w.text().includes('改了这个') && w.text().includes('✓ RAY:在跑 0.5.0') && w.text().includes('升好了:0.4.2 → 0.5.0'), w.text());
  check('「已是最新」「已换新」这种一行行不念', !w.text().includes('已是最新') && !w.text().includes('已换新'), w.text());
}
{
  const w = world({ kids: [kid('ray'), kid('ming', { port: 8445 })] });
  await runUpdate(w.deps);
  check('几个孩子:只下载一次,每个孩子都更新、重起', w.npm.length === 1 && w.cli.filter((c) => c.startsWith('refresh')).length === 2 && w.cli.filter((c) => c.startsWith('service restart')).length === 2);
}
{
  const w = world({ fromRepo: true });
  check('从仓库跑的:不动,说用 git pull', await runUpdate(w.deps) === 1 && !w.npm.length && !w.cli.length && w.text().includes('git pull'));
}
{
  const w = world({ release: async () => ({ ...REL, version: '0.4.2' }) });
  check('已经是最新:不下载、不重起,以 0 退', await runUpdate(w.deps) === 0 && !w.npm.length && !w.cli.length && w.text().includes('已经是最新'));
}
{
  const w = world({ release: async () => null });
  check('问不到 npm:说清楚,以 1 退,不动', await runUpdate(w.deps) === 1 && !w.cli.length && w.text().includes('问不到'));
}
{
  const w = world({ release: async () => null, kids: [kid('ray', {}, { version: '0.4.1' })] });
  check('问不到 npm,但服务落后于程序:照样把服务换上去', await runUpdate(w.deps) === 0 && !w.npm.length && w.cli.includes('service restart --workspace /w/ray'), w.text());
}
{
  const w = world({ kids: [kid('ray', {}, { calls: 1 })] });
  check('孩子在通话:不动,说怎么办', await runUpdate(w.deps) === 1 && !w.npm.length && !w.cli.length && w.text().includes('RAY') && w.text().includes('--anyway'), w.text());
  const x = world({ kids: [kid('ray', {}, { calls: 1 })] });
  check('--anyway:照样升', await runUpdate(x.deps, { anyway: true }) === 0 && x.npm.length === 1);
}
{
  const w = world({ nodeVersion: 'v22.17.0' });
  check('新版本要的 Node 比这台新:不下载(装上也跑不起来),说去装 Node', await runUpdate(w.deps) === 1 && !w.npm.length && !w.cli.length && w.text().includes('22.18') && w.text().includes('nodejs.org'), w.text());
  const x = world({ nodeVersion: 'v24.1.0' });
  check('Node 主版本更新:放行', await runUpdate(x.deps) === 0 && x.npm.length === 1);
}
{
  const w = world({ npm: async () => ({ code: 1, out: 'npm error network timeout\n' }) });
  check('下载没成:服务一点没碰,说还在跑旧版,带上 npm 的话', await runUpdate(w.deps) === 1 && !w.cli.length && w.text().includes('服务没动') && w.text().includes('0.4.2') && w.text().includes('network timeout'), w.text());
  const x = world({ npm: async () => ({ code: 243, out: 'npm error code EACCES\n' }) });
  check('没权限(当初用 sudo 装的):说这种情况怎么办', await runUpdate(x.deps) === 1 && !x.cli.length && x.text().includes('sudo npm i -g cotutor@0.5.0') && x.text().includes('服务没动'), x.text());
}
{
  const w = world({ npm: async () => ({ code: 0, out: '' }) });
  check('npm 说好了,这里还是旧版(装到了别的目录):看得出来,服务不动', await runUpdate(w.deps) === 1 && !w.cli.length && w.text().includes('别的目录'), w.text());
}
{
  const w = world({ release: async () => ({ ...REL, mirror: true }) });
  await runUpdate(w.deps);
  check('问的时候 npm 不通、镜像答的:下载也走镜像', w.npm[0][1] === 'https://registry.npmmirror.com');
}
{
  const w = world({ kids: [kid('ray', { node: '/opt/homebrew/Cellar/node/1/bin/node' })] });
  await runUpdate(w.deps);
  const i = w.cli.findIndex((c) => c.startsWith('service install'));
  check('服务写死了带版本号的 node:趁这次换掉;--no-open 不弹页面,--no-tray 不把关掉的图标装回来;再重起', i >= 0 && w.cli[i] === 'service install --no-open --no-tray --workspace /w/ray' && w.cli[i + 1] === 'service restart --workspace /w/ray', w.cli.join('|'));
  const x = world();
  await runUpdate(x.deps);
  check('路径没问题:不重装', !x.cli.some((c) => c.startsWith('service install')));
}
{
  const w = world({ health: async () => null });
  check('重起后服务没答应:说出来,以 1 退,不说升好了', await runUpdate(w.deps) === 1 && w.text().includes('没换上') && !w.text().includes('升好了'), w.text());
}
{
  const w = world({ kids: [] , workspace: () => '/w/solo' });
  check('没装后台服务:更新文件,提醒重开 serve', await runUpdate(w.deps) === 0 && w.cli.join() === 'refresh --workspace /w/solo' && w.text().includes('重开'), w.text());
}
{
  const w = world({ cli: async (args) => ({ code: 0, out: args[0] === 'doctor' ? JSON.stringify({ checks: [{ name: 'config.migrate', ok: false, cmd: 'cotutor refresh --config' }] }) : '  chinese-tutor 你改过,没换,差异……' }) });
  await runUpdate(w.deps);
  check('要迁移配置、家长改过的文件没换:都说出来', w.text().includes('cotutor refresh --config') && w.text().includes('你改过'), w.text());
}
{
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'app', 'cli', 'update-cmd.ts'), 'utf8').replace(/^\s*\*.*$/gm, '');
  check('换完程序后这个进程还是旧代码:文件里不能有动态 import,不然新旧混着', !/\bimport\(/.test(src));
}

done();
