/**
 * cotutor service:把一个 workspace 的 serve 装成这台电脑的后台服务——登录后自己起来、崩了自己拉起、日志按天落文件(serve-log.ts)。
 *   macOS:用户级 LaunchAgent ~/Library/LaunchAgents/com.tarslab.cotutor.<名>.plist(launchctl bootstrap gui/<uid>);日志 ~/Library/Logs/cotutor/<名>/
 *   Linux:systemd 用户服务 ~/.config/systemd/user/cotutor-<名>.service(systemctl --user);日志 ~/.local/state/cotutor/logs/<名>/;不登录也要跑要 loginctl enable-linger
 *   Windows:还没做(计划任务 + 藏控制台窗口,要在真机上试),先 cotutor serve 在前台跑。
 * 一个 workspace 一个服务;找服务按文件里写的 --workspace 找,不按名字推(两个同名目录的 workspace 不会认错)。
 * 装的那一刻把 node、bin、PATH 写死:launchd 的 PATH 里没有 Homebrew 和 nvm;换了 node 版本、包挪了地方,再 install 一次(幂等)。
 * 退出码 0 不拉起(端口被别人占着时 serve 以 0 退,不一直重试);崩了(非 0、被杀)隔 10 秒拉起。
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../workspace.ts';
import { logFileFor } from './serve-log.ts';

export type ServicePlatform = 'darwin' | 'linux';

/** 跑命令、读写文件之外要的:系统、家目录、uid;run 测试换假的 */
export interface ServiceHost {
  platform: NodeJS.Platform;
  home: string;
  uid: number;
  env: NodeJS.ProcessEnv;
  run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
}

export const realHost = (): ServiceHost => ({
  platform: process.platform,
  home: process.env.HOME ?? '',
  uid: process.getuid?.() ?? 0,
  env: process.env,
  run: (cmd, args) => new Promise((resolve) => {
    execFile(cmd, args, { timeout: 20_000, encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? (err ? err.message : '')) });
    });
  }),
});

const LABEL_PREFIX = 'com.tarslab.cotutor.';
const UNIT_PREFIX = 'cotutor-';

/** 这个系统做没做 */
export function servicePlatform(platform: NodeJS.Platform): ServicePlatform {
  if (platform === 'darwin' || platform === 'linux') return platform;
  throw new UsageError(platform === 'win32'
    ? 'Windows 上还没做后台服务(计划任务 + 藏控制台窗口,还没在真机上试过)。先用 cotutor serve 在前台跑,终端开着别关。'
    : `${platform} 上没做后台服务,用 cotutor serve 在前台跑`);
}

/** 服务名:workspace 目录名的小写字母数字连字符;撞了别的 workspace 加路径的短 hash */
export function serviceName(root: string, taken = false): string {
  const base = basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  return taken ? `${base}-${createHash('sha256').update(root).digest('hex').slice(0, 6)}` : base;
}

/** 服务文件放哪 */
export function serviceDir(host: Pick<ServiceHost, 'platform' | 'home' | 'env'>): string {
  return servicePlatform(host.platform) === 'darwin' ? join(host.home, 'Library', 'LaunchAgents') : join(host.env.XDG_CONFIG_HOME || join(host.home, '.config'), 'systemd', 'user');
}

/** 日志放哪(一个服务一个目录) */
export function serviceLogDir(host: Pick<ServiceHost, 'platform' | 'home' | 'env'>, name: string): string {
  return servicePlatform(host.platform) === 'darwin' ? join(host.home, 'Library', 'Logs', 'cotutor', name) : join(host.env.XDG_STATE_HOME || join(host.home, '.local', 'state'), 'cotutor', 'logs', name);
}

const fileOf = (host: Pick<ServiceHost, 'platform' | 'home' | 'env'>, name: string): string =>
  join(serviceDir(host), servicePlatform(host.platform) === 'darwin' ? `${LABEL_PREFIX}${name}.plist` : `${UNIT_PREFIX}${name}.service`);

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

const xml = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
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
  const mac = servicePlatform(host.platform) === 'darwin';
  const out: InstalledService[] = [];
  for (const f of (await readdir(dir).catch(() => [] as string[])).sort()) {
    const m = mac ? /^com\.tarslab\.cotutor\.(.+)\.plist$/.exec(f) : /^cotutor-(.+)\.service$/.exec(f);
    if (!m) continue;
    const args = serviceArgs(await readFile(join(dir, f), 'utf8').catch(() => ''));
    const root = workspaceOf(args);
    if (!root) continue;
    const li = args.indexOf('--log-dir');
    out.push({ name: m[1], label: mac ? `${LABEL_PREFIX}${m[1]}` : `${UNIT_PREFIX}${m[1]}`, file: join(dir, f), args, root, logDir: li >= 0 ? args[li + 1] ?? null : null });
  }
  return out;
}

/** 这个 workspace 的服务;没装 → null */
export async function findService(host: ServiceHost, root: string): Promise<InstalledService | null> {
  const want = real(root);
  return (await listServices(host)).find((s) => real(s.root) === want) ?? null;
}

/** cotutor 的 bin(npm 装的是 dist/app/cli → 包根;仓里直跑是 src/app/cli → 仓根,一样往上三层) */
export const binPath = (): string => fileURLToPath(new URL('../../../bin/cotutor.js', import.meta.url));

/** 装:写服务文件、交给 launchd / systemd 起来;已经装过就照现在的 node、bin、PATH 重写一遍再起 */
export async function installService(host: ServiceHost, root: string, opts: { node?: string; bin?: string } = {}): Promise<{ spec: ServiceSpec; file: string; replaced: boolean }> {
  const platform = servicePlatform(host.platform);
  const had = await findService(host, root);
  let name = had?.name ?? serviceName(root);
  if (!had && existsSync(fileOf(host, name))) name = serviceName(root, true);
  const label = platform === 'darwin' ? `${LABEL_PREFIX}${name}` : `${UNIT_PREFIX}${name}`;
  const logDir = serviceLogDir(host, name);
  const spec: ServiceSpec = { name, label, root, logDir, path: host.env.PATH ?? '/usr/bin:/bin', args: [opts.node ?? process.execPath, opts.bin ?? binPath(), 'serve', '--workspace', root, '--log-dir', logDir] };
  const file = fileOf(host, name);
  await mkdir(serviceDir(host), { recursive: true });
  await mkdir(logDir, { recursive: true });
  if (platform === 'darwin') {
    // 先卸下旧的(没装过会报错,不管),再装上;bootstrap 会按 RunAtLoad 马上起
    await host.run('launchctl', ['bootout', `gui/${host.uid}/${label}`]);
    await writeFile(file, launchdPlist(spec));
    const r = await host.run('launchctl', ['bootstrap', `gui/${host.uid}`, file]);
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
  if (servicePlatform(host.platform) === 'darwin') await host.run('launchctl', ['bootout', `gui/${host.uid}/${s.label}`]);
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

/** 起 / 停 / 重起。macOS 的停是从 launchd 卸下(服务文件还在,下次登录又会起;要一直不起用 uninstall) */
export async function controlService(host: ServiceHost, root: string, what: 'start' | 'stop' | 'restart'): Promise<InstalledService> {
  const s = await need(host, root);
  if (servicePlatform(host.platform) === 'darwin') {
    const target = `gui/${host.uid}/${s.label}`;
    const loaded = (await host.run('launchctl', ['print', target])).code === 0;
    if (what === 'stop') { if (loaded) await host.run('launchctl', ['bootout', target]); return s; }
    const r = loaded ? await host.run('launchctl', what === 'restart' ? ['kickstart', '-k', target] : ['kickstart', target]) : await host.run('launchctl', ['bootstrap', `gui/${host.uid}`, s.file]);
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
export interface Health { version: string | null; started: string; pid?: number; mode?: string; vault?: string }

/** 本机问一下 serve 起来没有(自签证书不验);先 https 再 http */
export async function probeHealth(port: number, timeoutMs = 1500): Promise<Health | null> {
  const get = (secure: boolean): Promise<Health | null> => new Promise((resolve) => {
    const req = (secure ? httpsRequest : httpRequest)({ host: '127.0.0.1', port, path: '/api/health', method: 'GET', timeout: timeoutMs, ...(secure ? { rejectUnauthorized: false } : {}) }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { body += c; });
      res.on('end', () => { try { const j = JSON.parse(body) as Health & { ok?: boolean }; resolve(j.ok ? j : null); } catch { resolve(null); } });
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
}

/** 装没装、在不在跑、问得到不(端口来自 cotutor.json 或 --port) */
export async function serviceStatus(host: ServiceHost, root: string, port: number): Promise<ServiceStatus> {
  const s = await findService(host, root);
  let st = { running: false, pid: null as number | null, lastExit: null as string | null };
  if (s) {
    const r = servicePlatform(host.platform) === 'darwin'
      ? await host.run('launchctl', ['print', `gui/${host.uid}/${s.label}`])
      : await host.run('systemctl', ['--user', 'show', '-p', 'ActiveState,MainPID,ExecMainStatus', `${s.label}.service`]);
    if (r.code === 0) st = host.platform === 'darwin' ? parseLaunchctlPrint(r.stdout) : parseSystemctlShow(r.stdout);
  }
  const health = await probeHealth(port);
  return { installed: s, ...st, health, logFile: s?.logDir ? logFileFor(s.logDir, new Date()) : null };
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
