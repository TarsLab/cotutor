/**
 * cotutor service:把一个 workspace 的 serve 装成这台电脑的后台服务——登录后自己起来、崩了自己拉起、日志按天落文件(serve-log.ts)。
 *   macOS:用户级 LaunchAgent ~/Library/LaunchAgents/com.tarslab.cotutor.<名>.plist(launchctl bootstrap gui/<uid>);日志 ~/Library/Logs/cotutor/<名>/
 *   Linux:systemd 用户服务 ~/.config/systemd/user/cotutor-<名>.service(systemctl --user);日志 ~/.local/state/cotutor/logs/<名>/;不登录也要跑要 loginctl enable-linger
 *   Windows:用户的 Run 注册表项 + wscript 跑的隐藏启动器 %LOCALAPPDATA%\cotutor\service\cotutor-<名>.js + 看护进程 cotutor service run(runKeeper);为什么这样见 service-windows.ts;日志 %LOCALAPPDATA%\cotutor\logs\<名>\
 * 一个 workspace 一个服务;找服务按文件里写的 --workspace 找,不按名字推(两个同名目录的 workspace 不会认错)。
 * 装的那一刻把 node、bin、PATH 写死:launchd 的 PATH 里没有 Homebrew 和 nvm;换了 node 版本、包挪了地方,再 install 一次(幂等)。
 * 退出码 0 不拉起(端口被别人占着时 serve 以 0 退,不一直重试);崩了(非 0、被杀)隔 10 秒拉起。
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, realpathSync, renameSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../../shared/errors.ts';
import { logFileFor } from './serve-log.ts';
import { RUN_KEY, STARTUP_APPROVED_KEY, decodeServiceFile, encodeLauncher, findProcsScript, launcherArgs, parseProcs, psArgs, runValue, startupDisabled, windowsLauncher, type WinProc } from './service-windows.ts';

export type ServicePlatform = 'darwin' | 'linux' | 'win32';

/** 跑命令、读写文件之外要的:系统、家目录、uid;run 测试换假的 */
export interface ServiceHost {
  platform: NodeJS.Platform;
  home: string;
  uid: number;
  env: NodeJS.ProcessEnv;
  run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
}

/** 命令的输出:先按 UTF-8;中文 Windows 上 reg、taskkill 这些回的是 GBK */
function decodeOutput(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gbk').decode(buf);
  }
}

export const realHost = (): ServiceHost => ({
  platform: process.platform,
  home: homedir(),
  uid: process.getuid?.() ?? 0,
  env: process.env,
  run: (cmd, args) => new Promise((resolve) => {
    execFile(cmd, args, { timeout: 30_000, encoding: 'buffer', windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      const errText = decodeOutput(stderr ?? Buffer.alloc(0));
      resolve({ code, stdout: decodeOutput(stdout ?? Buffer.alloc(0)), stderr: errText || (err ? err.message : '') });
    });
  }),
});

const LABEL_PREFIX = 'com.tarslab.cotutor.';
const UNIT_PREFIX = 'cotutor-';

/** 这个系统做没做 */
export function servicePlatform(platform: NodeJS.Platform): ServicePlatform {
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') return platform;
  throw new UsageError(`${platform} 上没做后台服务,用 cotutor serve 在前台跑`);
}

type HostPaths = Pick<ServiceHost, 'platform' | 'home' | 'env'>;
const winLocal = (host: HostPaths): string => host.env.LOCALAPPDATA || join(host.home, 'AppData', 'Local');

/** 服务名:workspace 目录名的小写字母数字连字符;撞了别的 workspace 加路径的短 hash */
export function serviceName(root: string, taken = false): string {
  const base = basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  return taken ? `${base}-${createHash('sha256').update(root).digest('hex').slice(0, 6)}` : base;
}

/** 服务文件放哪 */
export function serviceDir(host: HostPaths): string {
  const p = servicePlatform(host.platform);
  if (p === 'darwin') return join(host.home, 'Library', 'LaunchAgents');
  if (p === 'win32') return join(winLocal(host), 'cotutor', 'service');
  return join(host.env.XDG_CONFIG_HOME || join(host.home, '.config'), 'systemd', 'user');
}

/** 日志放哪(一个服务一个目录) */
export function serviceLogDir(host: HostPaths, name: string): string {
  const p = servicePlatform(host.platform);
  if (p === 'darwin') return join(host.home, 'Library', 'Logs', 'cotutor', name);
  if (p === 'win32') return join(winLocal(host), 'cotutor', 'logs', name);
  return join(host.env.XDG_STATE_HOME || join(host.home, '.local', 'state'), 'cotutor', 'logs', name);
}

const fileOf = (host: HostPaths, name: string): string => {
  const p = servicePlatform(host.platform);
  return join(serviceDir(host), p === 'darwin' ? `${LABEL_PREFIX}${name}.plist` : p === 'win32' ? `${UNIT_PREFIX}${name}.js` : `${UNIT_PREFIX}${name}.service`);
};

const labelOf = (platform: ServicePlatform, name: string): string => (platform === 'darwin' ? `${LABEL_PREFIX}${name}` : `${UNIT_PREFIX}${name}`);

/** serve 起来之前的输出(node 自己报的、模块没加载上)去哪:给人看的一句 */
export function earlyLogHint(platform: ServicePlatform, s: { label: string; logDir: string | null }): string {
  if (platform === 'linux') return `journalctl --user -u ${s.label}.service`;
  return join(s.logDir ?? '', platform === 'win32' ? KEEPER_LOG : 'launchd.log');
}

/** 看护进程的日志(Windows):serve 退了几次、起来之前的输出 */
export const KEEPER_LOG = 'keeper.log';
const KEEPER_LOG_MAX = 5 * 1024 * 1024;
const KEEPER_RESTART_MS = 10_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/**
 * launchctl bootout 发完信号就回,进程还没退;这时 bootstrap 报 5: Input/output error,服务就停在那儿了(2026-11-07 实测重装 12 次失败 10 次)。
 * 等它真的卸下来再往下走。launchd 最多等进程 20 秒(ExitTimeOut 缺省),再不走它自己会杀。
 */
export async function launchdUnload(host: Pick<ServiceHost, 'run'>, target: string, waitMs = 25_000): Promise<void> {
  await host.run('launchctl', ['bootout', target]);
  const until = Date.now() + waitMs;
  while ((await host.run('launchctl', ['print', target])).code === 0 && Date.now() < until) await sleep(200);
}

/** 装上;刚卸下的那一下还可能报错,隔一秒再试几次,真的不行才算不行 */
export async function launchdLoad(host: Pick<ServiceHost, 'run' | 'uid'>, file: string, tries = 5): Promise<{ code: number; stdout: string; stderr: string }> {
  let r = await host.run('launchctl', ['bootstrap', `gui/${host.uid}`, file]);
  for (let i = 1; i < tries && r.code !== 0; i++) {
    await sleep(1000);
    r = await host.run('launchctl', ['bootstrap', `gui/${host.uid}`, file]);
  }
  return r;
}

/**
 * 写进服务文件、登录项的 node。Homebrew 的 process.execPath 是带版本号的路径(实测 /opt/homebrew/Cellar/node/26.12.1_1/bin/node),
 * brew upgrade 清掉旧版后,服务和图标下次登录都起不来,连报警的都没了;opt/<formula> 这个链接 brew 一直维护。别的管理器(nvm、asdf)不会自己删旧版,不动。
 */
export function stableNode(execPath: string, exists: (p: string) => boolean = existsSync): string {
  const m = /^(.*)\/Cellar\/(node(?:@\d+)?)\/[^/]+\/bin\/node$/.exec(execPath);
  if (!m) return execPath;
  const opt = `${m[1]}/opt/${m[2]}/bin/node`;
  return exists(opt) ? opt : execPath;
}

/**
 * service install 之后开不开家长端:只有这个孩子第一次装时开,下一步就是填百炼、扫码。
 * 别的启动都不开:登录、崩溃重起、升级、重启都不是人要看页面;放进 serve 的话,一直崩就隔 10 秒开一个标签页。
 * ssh 进来的不开:没人看,macOS 的 open 还会开到那台电脑的屏幕上。Linux 要有图形会话。--open 是人明说的,重装也开;--no-open 最大
 */
export function opensAfterInstall(o: { firstTime: boolean; open: boolean; noOpen: boolean; platform: NodeJS.Platform; env: NodeJS.ProcessEnv }): boolean {
  if (o.noOpen) return false;
  if (o.open) return true;
  if (!o.firstTime || o.env.SSH_CONNECTION || o.env.SSH_TTY) return false;
  return o.platform !== 'linux' || Boolean(o.env.DISPLAY || o.env.WAYLAND_DISPLAY);
}

/**
 * 看护进程(Windows;cotutor service run):起 serve,非 0 隔 10 秒再起,0 不起(端口被占着);同 launchd 的 KeepAlive、systemd 的 Restart=on-failure。
 * 给 serve 带上 COTUTOR_SERVICE(mode 算后台服务、端口被占以 0 退);返回退出码
 */
export async function runKeeper(o: { root: string; logDir: string; label: string; node?: string; bin?: string; restartMs?: number }): Promise<number> {
  mkdirSync(o.logDir, { recursive: true });
  const logFile = join(o.logDir, KEEPER_LOG);
  const note = (text: string): void => { try { appendFileSync(logFile, `${new Date().toISOString()} ${text}\n`); } catch { /* 写不了日志不能把看护带倒 */ } };
  for (;;) {
    try { if (statSync(logFile).size > KEEPER_LOG_MAX) renameSync(logFile, `${logFile}.1`); } catch { /* 还没有 */ }
    const fd = openSync(logFile, 'a');
    const child = spawn(o.node ?? process.execPath, [o.bin ?? binPath(), 'serve', '--workspace', o.root, '--log-dir', o.logDir], { stdio: ['ignore', fd, fd], windowsHide: true, env: { ...process.env, COTUTOR_SERVICE: o.label } });
    const code = await new Promise<number | null>((resolve) => {
      child.once('error', (err) => { note(`serve 起不来:${err.message}`); resolve(null); });
      child.once('exit', (c) => resolve(c));
    });
    closeSync(fd);
    if (code === 0) { note('serve 以 0 退(端口被占着?),不再起;cotutor service start 再起'); return 0; }
    note(`serve 退了(${code ?? '没起来'}),${Math.round((o.restartMs ?? KEEPER_RESTART_MS) / 1000)} 秒后再起`);
    await new Promise((r) => setTimeout(r, o.restartMs ?? KEEPER_RESTART_MS));
  }
}

export const wscriptPath = (host: ServiceHost): string => join(host.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');

/** 这个 workspace 的看护进程与 serve 现在的进程 */
async function windowsProcs(host: ServiceHost, root: string): Promise<WinProc[]> {
  return parseProcs((await host.run('powershell.exe', psArgs(findProcsScript(root)))).stdout);
}

/** 停:看护进程连着子进程一起杀;看护没了留下的 serve 也杀 */
async function stopWindows(host: ServiceHost, root: string): Promise<void> {
  const procs = await windowsProcs(host, root);
  for (const p of [...procs].sort((a, b) => Number(b.keeper) - Number(a.keeper))) await host.run('taskkill.exe', ['/PID', String(p.pid), '/T', '/F']);
}

/** 起:wscript 跑启动器,藏着窗口起看护进程,马上回来 */
async function startWindows(host: ServiceHost, file: string): Promise<void> {
  const r = await host.run(wscriptPath(host), ['//B', '//Nologo', file]);
  if (r.code !== 0) throw new UsageError(`wscript 没成(系统可能关了 Windows Script Host):${(r.stderr || r.stdout).trim()}`);
}

export interface ServiceSpec {
  name: string;
  /** launchd 的 Label / systemd 的单元名(不带 .service) */
  label: string;
  /** 跑什么:node、bin、serve 与它的旗标 */
  args: string[];
  root: string;
  logDir: string;
  path: string;
}

export const xml = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const unxml = (s: string): string => s.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');

/** macOS 的 LaunchAgent */
export function launchdPlist(s: ServiceSpec): string {
  const str = (v: string): string => `<string>${xml(v)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- cotutor service install 写的;改了会被下次 install 盖掉。卸掉:cotutor service uninstall --workspace ${xml(s.root)} -->
<plist version="1.0">
<dict>
  <key>Label</key>${str(s.label)}
  <key>ProgramArguments</key>
  <array>
${s.args.map((a) => `    ${str(a)}`).join('\n')}
  </array>
  <key>WorkingDirectory</key>${str(s.root)}
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>${str(s.path)}
    <key>COTUTOR_SERVICE</key>${str(s.label)}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key>${str(join(s.logDir, 'launchd.log'))}
  <key>StandardErrorPath</key>${str(join(s.logDir, 'launchd.log'))}
</dict>
</plist>
`;
}

/** systemd 的一个参数:双引号括起来,反斜杠与引号转义,% 写两个 */
const sd = (v: string): string => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;

/** Linux 的 systemd 用户服务 */
export function systemdUnit(s: ServiceSpec): string {
  return `# cotutor service install 写的;改了会被下次 install 盖掉。卸掉:cotutor service uninstall --workspace ${s.root}
[Unit]
Description=cotutor (${s.name})
After=network-online.target

[Service]
ExecStart=${s.args.map(sd).join(' ')}
WorkingDirectory=${sd(s.root)}
Environment=${sd(`PATH=${s.path}`)}
Environment=${sd(`COTUTOR_SERVICE=${s.label}`)}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
}

/** 从服务文件里读回跑的参数(找它是哪个 workspace 的) */
export function serviceArgs(text: string): string[] {
  const js = launcherArgs(text);
  if (js) return js;
  const plist = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text);
  if (plist) return [...plist[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unxml(m[1]));
  const line = /^ExecStart=(.*)$/m.exec(text)?.[1];
  if (!line) return [];
  const out: string[] = [];
  for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1').replaceAll('%%', '%') : m[2]);
  return out;
}

const workspaceOf = (args: string[]): string | null => { const i = args.indexOf('--workspace'); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
const real = (p: string): string => { try { return realpathSync(p); } catch { return p; } };

export interface InstalledService {
  name: string;
  label: string;
  file: string;
  args: string[];
  root: string;
  logDir: string | null;
}

/** 这台电脑上 cotutor 装的服务(各是哪个 workspace 的) */
export async function listServices(host: ServiceHost): Promise<InstalledService[]> {
  const dir = serviceDir(host);
  const platform = servicePlatform(host.platform);
  const pattern = platform === 'darwin' ? /^com\.tarslab\.cotutor\.(.+)\.plist$/ : platform === 'win32' ? /^cotutor-(.+)\.js$/ : /^cotutor-(.+)\.service$/;
  const out: InstalledService[] = [];
  for (const f of (await readdir(dir).catch(() => [] as string[])).sort()) {
    const m = pattern.exec(f);
    if (!m) continue;
    const args = serviceArgs(decodeServiceFile(await readFile(join(dir, f)).catch(() => Buffer.alloc(0))));
    const root = workspaceOf(args);
    if (!root) continue;
    const li = args.indexOf('--log-dir');
    out.push({ name: m[1], label: labelOf(platform, m[1]), file: join(dir, f), args, root, logDir: li >= 0 ? args[li + 1] ?? null : null });
  }
  return out;
}

/** 这个 workspace 的服务;没装 → null(Windows 上路径不分大小写) */
export async function findService(host: ServiceHost, root: string): Promise<InstalledService | null> {
  const norm = (p: string): string => (host.platform === 'win32' ? real(p).toLowerCase() : real(p));
  const want = norm(root);
  return (await listServices(host)).find((s) => norm(s.root) === want) ?? null;
}

/** cotutor 的 bin(npm 装的是 dist/app/cli → 包根;仓里直跑是 src/app/cli → 仓根,一样往上三层) */
export const binPath = (): string => fileURLToPath(new URL('../../../bin/cotutor.js', import.meta.url));

/** 装:写服务文件、交给 launchd / systemd 起来;已经装过就照现在的 node、bin、PATH 重写一遍再起 */
export async function installService(host: ServiceHost, root: string, opts: { node?: string; bin?: string } = {}): Promise<{ spec: ServiceSpec; file: string; replaced: boolean }> {
  const platform = servicePlatform(host.platform);
  const had = await findService(host, root);
  let name = had?.name ?? serviceName(root);
  if (!had && existsSync(fileOf(host, name))) name = serviceName(root, true);
  const label = labelOf(platform, name);
  const logDir = serviceLogDir(host, name);
  // Windows 上跑的是看护进程,它再起 serve(那边没有 launchd / systemd 替你拉起)
  const run = platform === 'win32' ? ['service', 'run'] : ['serve'];
  const spec: ServiceSpec = { name, label, root, logDir, path: host.env.PATH ?? '/usr/bin:/bin', args: [opts.node ?? stableNode(process.execPath), opts.bin ?? binPath(), ...run, '--workspace', root, '--log-dir', logDir] };
  const file = fileOf(host, name);
  await mkdir(serviceDir(host), { recursive: true });
  await mkdir(logDir, { recursive: true });
  if (platform === 'win32') {
    if (had) await stopWindows(host, root);
    await writeFile(file, encodeLauncher(windowsLauncher(spec.args, root)));
    const reg = await host.run('reg.exe', ['add', RUN_KEY, '/v', label, '/t', 'REG_SZ', '/d', runValue(wscriptPath(host), file), '/f']);
    if (reg.code !== 0) throw new UsageError(`写登录项没成:${(reg.stderr || reg.stdout).trim()}`);
    // 再装一次 = 要它:以前在任务管理器里关掉的记录也去掉(没有这一笔时报错,不管)
    await host.run('reg.exe', ['delete', STARTUP_APPROVED_KEY, '/v', label, '/f']);
    await startWindows(host, file);
  } else if (platform === 'darwin') {
    // 先卸下旧的(没装过会报错,不管),再装上;bootstrap 会按 RunAtLoad 马上起
    await launchdUnload(host, `gui/${host.uid}/${label}`);
    await writeFile(file, launchdPlist(spec));
    const r = await launchdLoad(host, file);
    if (r.code !== 0) throw new UsageError(`launchctl bootstrap 没成:${(r.stderr || r.stdout).trim()}`);
  } else {
    await writeFile(file, systemdUnit(spec));
    await host.run('systemctl', ['--user', 'daemon-reload']);
    const r = await host.run('systemctl', ['--user', 'enable', '--now', `${label}.service`]);
    if (r.code !== 0) throw new UsageError(`systemctl --user enable 没成:${(r.stderr || r.stdout).trim()}`);
    if (had) await host.run('systemctl', ['--user', 'restart', `${label}.service`]);
  }
  return { spec, file, replaced: Boolean(had) };
}

/** 卸:停下、删服务文件;日志留着 */
export async function uninstallService(host: ServiceHost, root: string): Promise<InstalledService | null> {
  const s = await findService(host, root);
  if (!s) return null;
  const platform = servicePlatform(host.platform);
  if (platform === 'win32') {
    await stopWindows(host, s.root);
    await host.run('reg.exe', ['delete', RUN_KEY, '/v', s.label, '/f']);
    await host.run('reg.exe', ['delete', STARTUP_APPROVED_KEY, '/v', s.label, '/f']);
  } else if (platform === 'darwin') await host.run('launchctl', ['bootout', `gui/${host.uid}/${s.label}`]);
  else await host.run('systemctl', ['--user', 'disable', '--now', `${s.label}.service`]);
  await rm(s.file, { force: true });
  if (host.platform === 'linux') await host.run('systemctl', ['--user', 'daemon-reload']);
  return s;
}

const need = async (host: ServiceHost, root: string): Promise<InstalledService> => {
  const s = await findService(host, root);
  if (!s) throw new UsageError('这个 workspace 没装后台服务:cotutor service install');
  return s;
};

/** 起 / 停 / 重起。macOS 的停是从 launchd 卸下、Windows 的停是杀进程(服务文件都还在,下次登录又会起;要一直不起用 uninstall) */
export async function controlService(host: ServiceHost, root: string, what: 'start' | 'stop' | 'restart'): Promise<InstalledService> {
  const s = await need(host, root);
  const platform = servicePlatform(host.platform);
  if (platform === 'win32') {
    if (what !== 'start') await stopWindows(host, s.root);
    if (what === 'stop') return s;
    // 已经在跑就不再起一个(再起一个也会因为端口被占以 0 退,只是多转一圈)
    if (!(await windowsProcs(host, s.root)).some((p) => p.keeper)) await startWindows(host, s.file);
    return s;
  }
  if (platform === 'darwin') {
    const target = `gui/${host.uid}/${s.label}`;
    const loaded = (await host.run('launchctl', ['print', target])).code === 0;
    if (what === 'stop') { if (loaded) await launchdUnload(host, target); return s; }
    const r = loaded ? await host.run('launchctl', what === 'restart' ? ['kickstart', '-k', target] : ['kickstart', target]) : await launchdLoad(host, s.file);
    if (r.code !== 0) throw new UsageError(`launchctl 没成:${(r.stderr || r.stdout).trim()}`);
    return s;
  }
  const r = await host.run('systemctl', ['--user', what, `${s.label}.service`]);
  if (r.code !== 0) throw new UsageError(`systemctl --user ${what} 没成:${(r.stderr || r.stdout).trim()}`);
  return s;
}

/** launchctl print 那一大段里要的几行(一层缩进的 state / pid / last exit code) */
export function parseLaunchctlPrint(text: string): { running: boolean; pid: number | null; lastExit: string | null } {
  const field = (k: string): string | null => new RegExp(`^\\t${k} = (.*)$`, 'm').exec(text)?.[1]?.trim() ?? null;
  const pid = Number(field('pid'));
  return { running: field('state') === 'running', pid: Number.isInteger(pid) && pid > 0 ? pid : null, lastExit: field('last exit code') };
}

/** systemctl show -p ActiveState,MainPID,ExecMainStatus 的输出 */
export function parseSystemctlShow(text: string): { running: boolean; pid: number | null; lastExit: string | null } {
  const kv = Object.fromEntries(text.split('\n').map((l) => l.split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()]));
  const pid = Number(kv.MainPID);
  return { running: kv.ActiveState === 'active', pid: pid > 0 ? pid : null, lastExit: kv.ExecMainStatus ?? null };
}

/** /api/health 回的(只取要的) */
export interface Health {
  version: string | null;
  started: string;
  pid?: number;
  mode?: string;
  vault?: string;
  /** 现在开着几通电话(托盘:退出前要不要问一声) */
  calls?: number;
  /** 百炼配了没有(托盘:没配算有事要处理) */
  bailian?: boolean;
  /** 跑起来以后百炼出的问题(欠费、key 失效、连不上);没有 → null(machine/bailian.ts) */
  bailianTrouble?: { kind: string; message: string; fix: string; why?: string; blocked?: boolean } | null;
  /** npm 上比在跑的这份新的版本;没有 → null(machine/update.ts) */
  latest?: string | null;
  /** 那个版本写的更新说明 */
  latestNotes?: string[];
  configError?: string | null;
  /** 问到的是 https 还是 http(这边加的,不是服务回的) */
  scheme?: 'https' | 'http';
}

/** 本机问一下 serve 起来没有(自签证书不验);先 https 再 http */
export async function probeHealth(port: number, timeoutMs = 1500): Promise<Health | null> {
  const get = (secure: boolean): Promise<Health | null> => new Promise((resolve) => {
    const req = (secure ? httpsRequest : httpRequest)({ host: '127.0.0.1', port, path: '/api/health', method: 'GET', timeout: timeoutMs, ...(secure ? { rejectUnauthorized: false } : {}) }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { body += c; });
      res.on('end', () => { try { const j = JSON.parse(body) as Health & { ok?: boolean }; resolve(j.ok ? { ...j, scheme: secure ? 'https' : 'http' } : null); } catch { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
  return (await get(true)) ?? (await get(false));
}

export interface ServiceStatus {
  installed: InstalledService | null;
  running: boolean;
  pid: number | null;
  lastExit: string | null;
  health: Health | null;
  logFile: string | null;
  /** Windows:下次登录还会不会自己起来(Run 项被删了、任务管理器里关掉了都算不会);别的系统 null */
  autostart: boolean | null;
}

/** 装没装、在不在跑、问得到不(端口来自 cotutor.json 或 --port) */
export async function serviceStatus(host: ServiceHost, root: string, port: number): Promise<ServiceStatus> {
  const s = await findService(host, root);
  let st = { running: false, pid: null as number | null, lastExit: null as string | null };
  let autostart: boolean | null = null;
  if (s && host.platform === 'win32') {
    const procs = await windowsProcs(host, s.root);
    st = { running: procs.some((p) => p.keeper), pid: (procs.find((p) => !p.keeper) ?? procs[0])?.pid ?? null, lastExit: null };
    autostart = (await host.run('reg.exe', ['query', RUN_KEY, '/v', s.label])).code === 0 && !startupDisabled((await host.run('reg.exe', ['query', STARTUP_APPROVED_KEY, '/v', s.label])).stdout);
  } else if (s) {
    const r = host.platform === 'darwin'
      ? await host.run('launchctl', ['print', `gui/${host.uid}/${s.label}`])
      : await host.run('systemctl', ['--user', 'show', '-p', 'ActiveState,MainPID,ExecMainStatus', `${s.label}.service`]);
    if (r.code === 0) st = host.platform === 'darwin' ? parseLaunchctlPrint(r.stdout) : parseSystemctlShow(r.stdout);
  }
  const health = await probeHealth(port);
  return { installed: s, ...st, health, logFile: s?.logDir ? logFileFor(s.logDir, new Date()) : null, autostart };
}

/** 起来以后等它答应(装完、重起完);等不到 → null */
export async function waitHealthy(port: number, ms = 15_000, since?: string): Promise<Health | null> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const h = await probeHealth(port, 1000);
    if (h && (!since || h.started > since)) return h;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/** 日志的最后 n 行(今天的没有就找最近一天的) */
export async function tailLog(logDir: string, n = 50): Promise<{ file: string; lines: string[] } | null> {
  const files = (await readdir(logDir).catch(() => [] as string[])).filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
  const last = files.at(-1);
  if (!last) return null;
  const file = join(logDir, last);
  const lines = (await readFile(file, 'utf8').catch(() => '')).split('\n');
  if (lines.at(-1) === '') lines.pop();
  return { file, lines: lines.slice(-n) };
}

/** pmset -g custom 里「AC Power:」那一段的 sleep(接着电源几分钟没人碰就睡,0 = 不睡);没有那一段 → null */
export function acSleepMinutes(pmset: string): number | null {
  const ac = /^AC Power:\s*$([\s\S]*?)(?=^\S|(?![\s\S]))/m.exec(pmset)?.[1];
  const v = ac ? /^\s+sleep\s+(\d+)/m.exec(ac)?.[1] : undefined;
  return v === undefined ? null : Number(v);
}
