/**
 * cotutor update:升级一条命令管到底。问 npm 有没有新版本 → 换程序 → 每个孩子更新出厂文件、重起服务和图标。
 * 不自动跑:要重起服务,孩子可能在上课,所以孩子在通话时不动(--anyway 才动)。npm 没成就停,服务一点没碰,还在跑旧版。
 * 换完程序以后只用子进程跑新的 bin:这个进程还是旧代码,再 import 会读到新文件,新旧混着。所以这里用到的模块都写在文件头,别改成动态 import。
 * 再跑一次也行:程序已经是新的、只差重起的(手动 npm i -g 过、上次中断了),接着把后面做完。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isNewer } from '../../shared/upgrade.ts';
import { BUILD } from '../build.ts';
import { fetchRelease, type Release } from '../machine/update.ts';
import { binPath, listServices, probeHealth, realHost, stableNode, type Health } from './service.ts';
import { inspectService } from './tray.ts';

const MIRROR = 'https://registry.npmmirror.com';

export interface UpdateService {
  name: string;
  kid: string;
  root: string;
  port: number;
  node: string;
  health: Health | null;
}

export interface UpdateDeps {
  current: string;
  /** 从仓库跑的:版本跟着 git 走,npm 不管 */
  fromRepo: boolean;
  nodeVersion: string;
  release(): Promise<Release | null>;
  services(): Promise<UpdateService[]>;
  health(port: number): Promise<Health | null>;
  npm(spec: string, registry: string | null): Promise<{ code: number; out: string }>;
  /** 现在装着的版本:读文件,npm 刚换过 */
  installed(): string | null;
  /** 跑新的 bin */
  cli(args: string[]): Promise<{ code: number; out: string }>;
  /** 没有后台服务时,在终端里跑 serve 的那个孩子 */
  workspace(): string | null;
  stableNode(path: string): string;
  print(line: string): void;
}

const nodeTooOld = (have: string, min: [number, number]): boolean => {
  const [major = 0, minor = 0] = have.replace(/^v/, '').split('.').map(Number);
  return major < min[0] || (major === min[0] && minor < min[1]);
};

/** 只说要家长知道的:升好了的、已是最新的不用一行行念 */
const worthSaying = (out: string): string[] => out.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() && !/已是最新|已换新/.test(l));

async function updateOne(d: UpdateDeps, s: UpdateService, target: string): Promise<boolean> {
  let ok = true;
  const up = await d.cli(['upgrade', '--workspace', s.root]);
  for (const l of worthSaying(up.out)) d.print(`  ${l}`);
  if (up.code !== 0) { d.print(`  ! ${s.kid}:出厂文件没更新完,先接着往下走`); ok = false; }
  // 以前装的写死了带版本号的 node(Homebrew):趁这次换掉,不然下次 brew upgrade 就起不来。--no-tray:图标下一步 restart 管,没开图标的不能装回来
  if (d.stableNode(s.node) !== s.node) {
    const re = await d.cli(['service', 'install', '--no-open', '--no-tray', '--workspace', s.root]);
    if (re.code !== 0) { for (const l of worthSaying(re.out)) d.print(`  ${l}`); ok = false; }
  }
  const restart = await d.cli(['service', 'restart', '--workspace', s.root]);
  for (const l of restart.out.split('\n')) if (l.trim().startsWith('!')) d.print(`  ${l.trim()}`);
  const h = await d.health(s.port);
  if (restart.code === 0 && h?.version === target) d.print(`✓ ${s.kid}:在跑 ${target}`);
  else {
    d.print(`! ${s.kid}:服务没换上 ${target}(在跑 ${h?.version ?? '没答应'})。cotutor service logs --workspace ${s.root} 看看`);
    ok = false;
  }
  const doc = await d.cli(['doctor', '--workspace', s.root, '--json']);
  try {
    const checks = (JSON.parse(doc.out) as { checks: { name: string; ok: boolean; cmd?: string }[] }).checks;
    const migrate = checks.find((c) => c.name === 'config.migrate' && !c.ok);
    if (migrate) d.print(`  ! ${s.kid} 的配置要迁移:${migrate.cmd ?? 'cotutor upgrade --config'}`);
  } catch { /* 体检读不了不影响升级 */ }
  return ok;
}

export async function runUpdate(d: UpdateDeps, o: { anyway?: boolean } = {}): Promise<number> {
  if (d.fromRepo) {
    d.print('这份是从仓库跑的:git pull,再 cotutor upgrade、cotutor service restart。cotutor update 只管 npm 装的。');
    return 1;
  }
  const services = await d.services();
  const rel = await d.release();
  const newer = rel !== null && isNewer(rel.version, d.current);
  // 程序已经是新的、服务还在跑旧版:手动 npm i -g 过,或者上次中断了
  const behind = services.filter((s) => s.health?.version && s.health.version !== d.current);
  if (!newer && !behind.length) {
    if (!rel) { d.print('问不到 npm 上的版本(断网或连不上),现在是 ' + d.current + '。过一会儿再试。'); return 1; }
    d.print(`已经是最新的:${d.current}`);
    return 0;
  }
  const busy = services.filter((s) => (s.health?.calls ?? 0) > 0);
  if (busy.length && !o.anyway) {
    d.print(`${busy.map((s) => s.kid).join('、')}正在和老师通话,升级要重起服务,会挂断。等下课再升;一定要现在升:cotutor update --anyway`);
    return 1;
  }
  let target = d.current;
  if (newer) {
    if (rel.minNode && nodeTooOld(d.nodeVersion, rel.minNode)) {
      d.print(`新版本 ${rel.version} 要 Node ${rel.minNode.join('.')} 以上,这台电脑是 ${d.nodeVersion}。先到 https://nodejs.org 装新的 LTS 版,再跑一次 cotutor update。服务没动。`);
      return 1;
    }
    d.print(`现在是 ${d.current},新版本是 ${rel.version}`);
    for (const n of rel.notes) d.print(`  · ${n}`);
    d.print('正在下载新版本,要一两分钟……');
    const got = await d.npm(rel.version, rel.mirror ? MIRROR : null);
    if (got.code !== 0) {
      const tail = worthSaying(got.out).slice(-6).map((l) => `  ${l}`).join('\n');
      d.print(/EACCES|EPERM/.test(got.out)
        ? `这个账户写不了 npm 的全局目录,服务没动,还在跑 ${d.current}。当初是用 sudo 装的话,在终端里跑 sudo npm i -g cotutor@${rel.version},再跑一次 cotutor update。\n${tail}`
        : `下载没成,服务没动,还在跑 ${d.current}。连不上 npm 的话过一会儿再试。\n${tail}`);
      return 1;
    }
    const now = d.installed();
    if (now !== rel.version) {
      d.print(`npm 说装好了,但这里还是 ${now ?? '读不到版本'}:npm 可能装到了别的目录(npm prefix -g 看装到了哪)。服务没动。`);
      return 1;
    }
    target = rel.version;
  } else d.print(`程序已经是 ${d.current},把${behind.map((s) => s.kid).join('、')}的服务换上去`);

  let ok = true;
  for (const s of services) ok = (await updateOne(d, s, target)) && ok;
  if (!services.length) {
    const root = d.workspace();
    if (root) {
      const up = await d.cli(['upgrade', '--workspace', root]);
      for (const l of worthSaying(up.out)) d.print(`  ${l}`);
      if (up.code !== 0) ok = false;
      d.print('没装后台服务:在终端里跑的 cotutor serve 要关掉重开才用上新版。');
    }
  }
  if (!ok) return 1;
  d.print(newer ? `升好了:${d.current} → ${target}` : `都换好了:${target}`);
  return 0;
}

const capture = (cmd: string, args: string[], shell = false): Promise<{ code: number; out: string }> => new Promise((resolve) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell });
  let out = '';
  const take = (c: Buffer): void => { out += c.toString('utf8'); };
  child.stdout?.on('data', take);
  child.stderr?.on('data', take);
  child.on('error', (err) => resolve({ code: 1, out: `${out}${err.message}\n` }));
  child.on('close', (code) => resolve({ code: code ?? 1, out }));
});

/** 用跟这个 node 配套的 npm:PATH 里排第一的可能是另一套 Node 的,会装到别处。Windows 上 .cmd 要经 shell 才跑得起来(Node 18.20 起),路径带空格要引起来 */
function runNpm(spec: string, registry: string | null): Promise<{ code: number; out: string }> {
  const win = process.platform === 'win32';
  const near = join(dirname(process.execPath), win ? 'npm.cmd' : 'npm');
  const npm = existsSync(near) ? near : win ? 'npm.cmd' : 'npm';
  const args = ['i', '-g', `cotutor@${spec}`, '--no-audit', '--no-fund', ...(registry ? [`--registry=${registry}`] : [])];
  return capture(win ? `"${npm}"` : npm, args, win);
}

export function realUpdateDeps(workspace: () => string | null): UpdateDeps {
  const host = realHost();
  const bin = binPath();
  return {
    current: BUILD.version ?? '0.0.0',
    fromRepo: Boolean(BUILD.commit),
    nodeVersion: process.version,
    release: () => fetchRelease(),
    services: async () => Promise.all((await listServices(host)).map(async (s) => {
      const w = await inspectService(s);
      return { name: s.name, kid: w.kid, root: s.root, port: w.port, node: s.args[0], health: await probeHealth(w.port) };
    })),
    health: (port) => probeHealth(port),
    npm: runNpm,
    installed: () => {
      try { return (JSON.parse(readFileSync(join(dirname(bin), '..', 'package.json'), 'utf8')) as { version: string }).version; } catch { return null; }
    },
    cli: (args) => capture(process.execPath, [bin, ...args]),
    workspace,
    stableNode,
    print: (line) => process.stdout.write(`${line}\n`),
  };
}
