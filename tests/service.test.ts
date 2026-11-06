/**
 * 后台服务(src/app/cli/service.ts)与 serve 的日志(serve-log.ts):不真装,launchctl / systemctl 换成记账的假命令。
 * 服务文件写出来再读回参数一字不差(带空格、引号、&、%);按 --workspace 找服务、同名目录加 hash、重装同名;装 / 卸 / 起停各跑什么命令;
 * launchctl print、systemctl show、pmset 的解析;日志按天落、每行带时刻、留 14 天;/api/health 带 pid、mode、vault;
 * 命令行:没装说没装、试用 workspace 不让装、端口被占时终端里以 1 退、后台服务以 0 退(不一直重试)。
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-service-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
delete process.env.COTUTOR_SERVICE;

const svc = await import('../src/app/cli/service.ts');
const { teeLogs, pruneLogs } = await import('../src/app/cli/serve-log.ts');
const { UsageError } = await import('../src/app/workspace.ts');

{
  check('服务名:目录名的小写字母数字连字符;撞了加路径的短 hash', svc.serviceName('/x/Ray Home') === 'ray-home' && svc.serviceName('/x/小明') === 'workspace' && /^ray-[0-9a-f]{6}$/.test(svc.serviceName('/x/ray', true)) && svc.serviceName('/x/ray', true) !== svc.serviceName('/y/ray', true));
  const spec = { name: 'ray', label: 'com.tarslab.cotutor.ray', root: '/Users/a b/cotutor/ray & co', logDir: '/L/ray', path: '/opt/homebrew/bin:/usr/bin', args: ['/n o/node', '/p/bin/cotutor.js', 'serve', '--workspace', '/Users/a b/cotutor/ray & co', '--log-dir', '/L/<ray>'] };
  const plist = svc.launchdPlist(spec);
  check('plist:参数读回来一字不差(空格、&、<)', JSON.stringify(svc.serviceArgs(plist)) === JSON.stringify(spec.args), JSON.stringify(svc.serviceArgs(plist)));
  check('plist:登录就起、只在崩了时拉起(退出码 0 不拉)、PATH 写死、带 COTUTOR_SERVICE、launchd 的输出进日志目录', plist.includes('<key>RunAtLoad</key><true/>') && /<key>SuccessfulExit<\/key><false\/>/.test(plist) && plist.includes('<string>/opt/homebrew/bin:/usr/bin</string>') && plist.includes('<key>COTUTOR_SERVICE</key><string>com.tarslab.cotutor.ray</string>') && plist.includes('<string>/L/ray/launchd.log</string>'));
  const unit = svc.systemdUnit({ ...spec, label: 'cotutor-ray', args: ['/n o/node', '/p/bin/cotutor.js', 'serve', '--workspace', '/w/"q"\\x 100%'] });
  check('systemd:参数读回来一字不差(空格、引号、反斜杠、%)', JSON.stringify(svc.serviceArgs(unit)) === JSON.stringify(['/n o/node', '/p/bin/cotutor.js', 'serve', '--workspace', '/w/"q"\\x 100%']) && unit.includes('Restart=on-failure') && unit.includes('100%%'), JSON.stringify(svc.serviceArgs(unit)));
  const h = { platform: 'linux' as const, home: '/h', env: { XDG_STATE_HOME: '/s' } };
  check('放哪:macOS LaunchAgents / Library/Logs;Linux systemd/user / XDG_STATE_HOME', svc.serviceDir({ platform: 'darwin', home: '/h', env: {} }) === '/h/Library/LaunchAgents' && svc.serviceLogDir({ platform: 'darwin', home: '/h', env: {} }, 'ray') === '/h/Library/Logs/cotutor/ray' && svc.serviceDir(h) === '/h/.config/systemd/user' && svc.serviceLogDir(h, 'ray') === '/s/cotutor/logs/ray');
  let win = '';
  try { svc.servicePlatform('win32'); } catch (err) { win = err instanceof UsageError ? err.message : ''; }
  check('Windows:还没做,说清楚、指 cotutor serve', win.includes('Windows') && win.includes('cotutor serve'), win);
}

/** 假的系统:记下跑了什么;launchctl print 按 loaded 回 */
const fakeHost = (platform: 'darwin' | 'linux', root: string) => {
  const calls: string[] = [];
  const loaded = new Set<string>();
  const host = {
    platform, home: root, uid: 501, env: { PATH: '/opt/homebrew/bin:/usr/bin' } as NodeJS.ProcessEnv, calls, loaded,
    run: async (cmd: string, args: string[]) => {
      calls.push(`${cmd} ${args.join(' ')}`);
      if (cmd === 'launchctl' && args[0] === 'bootstrap') loaded.add(svc.serviceArgs(readFileSync(args[2], 'utf8')).length ? args[2] : '');
      if (cmd === 'launchctl' && args[0] === 'print') return loaded.size ? { code: 0, stdout: '\tstate = running\n\tpid = 4242\n\tlast exit code = (never exited)\n\t\tstate = active\n', stderr: '' } : { code: 113, stdout: '', stderr: 'Could not find service' };
      if (cmd === 'launchctl' && args[0] === 'bootout') loaded.clear();
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return host;
};

{
  const fh = join(home, 'mac');
  const host = fakeHost('darwin', fh);
  const ws1 = join(home, 'kids', 'ray');
  const ws2 = join(home, 'other', 'ray');
  mkdirSync(ws1, { recursive: true });
  mkdirSync(ws2, { recursive: true });
  const a = await svc.installService(host, ws1, { node: '/usr/local/bin/node', bin: '/pkg/bin/cotutor.js' });
  const plistFile = join(fh, 'Library', 'LaunchAgents', 'com.tarslab.cotutor.ray.plist');
  check('macOS 装:写 LaunchAgent、先 bootout 再 bootstrap gui/<uid>、建日志目录', existsSync(plistFile) && host.calls.join('|') === `launchctl bootout gui/501/com.tarslab.cotutor.ray|launchctl bootstrap gui/501 ${plistFile}` && existsSync(join(fh, 'Library', 'Logs', 'cotutor', 'ray')) && !a.replaced, host.calls.join(' | '));
  check('跑的是 node bin serve --workspace <root> --log-dir <日志目录>(写死装的那一刻的)', JSON.stringify(a.spec.args) === JSON.stringify(['/usr/local/bin/node', '/pkg/bin/cotutor.js', 'serve', '--workspace', ws1, '--log-dir', join(fh, 'Library', 'Logs', 'cotutor', 'ray')]));
  const again = await svc.installService(host, ws1, { node: '/opt/node22/bin/node', bin: '/pkg/bin/cotutor.js' });
  check('再装一次:同一个名字、照新的 node 重写', again.replaced && again.spec.name === 'ray' && svc.serviceArgs(readFileSync(plistFile, 'utf8'))[0] === '/opt/node22/bin/node');
  const b = await svc.installService(host, ws2);
  check('另一个同名目录的 workspace:名字加 hash,不盖掉', b.spec.name !== 'ray' && b.spec.name.startsWith('ray-') && existsSync(plistFile) && (await svc.listServices(host)).length === 2);
  check('按 --workspace 找服务', (await svc.findService(host, ws1))?.name === 'ray' && (await svc.findService(host, ws2))?.name === b.spec.name && (await svc.findService(host, join(home, 'nope'))) === null);
  host.calls.length = 0;
  await svc.controlService(host, ws1, 'restart');
  check('重起:装着的 kickstart -k', host.calls.at(-1) === 'launchctl kickstart -k gui/501/com.tarslab.cotutor.ray', host.calls.join(' | '));
  await svc.controlService(host, ws1, 'stop');
  check('停:bootout(文件还在)', host.calls.at(-1) === 'launchctl bootout gui/501/com.tarslab.cotutor.ray' && existsSync(plistFile));
  await svc.controlService(host, ws1, 'start');
  check('停了再起:没装上就 bootstrap', host.calls.at(-1) === `launchctl bootstrap gui/501 ${plistFile}`, host.calls.join(' | '));
  const gone = await svc.uninstallService(host, ws1);
  check('卸:bootout、删文件;另一个还在', gone?.name === 'ray' && !existsSync(plistFile) && (await svc.listServices(host)).length === 1 && host.calls.at(-1) === 'launchctl bootout gui/501/com.tarslab.cotutor.ray');
  let err = '';
  try { await svc.controlService(host, ws1, 'start'); } catch (e) { err = (e as Error).message; }
  check('没装的起:说装', err.includes('cotutor service install'), err);
}

{
  const fh = join(home, 'linux');
  const host = fakeHost('linux', fh);
  const ws = join(home, 'kids', 'ming');
  mkdirSync(ws, { recursive: true });
  await svc.installService(host, ws, { node: '/usr/bin/node', bin: '/pkg/bin/cotutor.js' });
  const unit = join(fh, '.config', 'systemd', 'user', 'cotutor-ming.service');
  check('Linux 装:写用户单元、daemon-reload、enable --now', existsSync(unit) && host.calls.join('|') === 'systemctl --user daemon-reload|systemctl --user enable --now cotutor-ming.service' && existsSync(join(fh, '.local', 'state', 'cotutor', 'logs', 'ming')), host.calls.join(' | '));
  await svc.uninstallService(host, ws);
  check('Linux 卸:disable --now、删文件、daemon-reload', !existsSync(unit) && host.calls.slice(-2).join('|') === 'systemctl --user disable --now cotutor-ming.service|systemctl --user daemon-reload');
}

{
  check('launchctl print:一层缩进的 state / pid / last exit code', JSON.stringify(svc.parseLaunchctlPrint('gui/501/x = {\n\tpath = /p\n\tstate = running\n\tpid = 1295\n\tlast exit code = (never exited)\n\t\tstate = active\n}')) === '{"running":true,"pid":1295,"lastExit":"(never exited)"}' && svc.parseLaunchctlPrint('\tstate = not running\n\tlast exit code = 1\n').running === false);
  check('systemctl show', JSON.stringify(svc.parseSystemctlShow('ActiveState=active\nMainPID=77\nExecMainStatus=0\n')) === '{"running":true,"pid":77,"lastExit":"0"}' && svc.parseSystemctlShow('ActiveState=failed\nMainPID=0\n').pid === null);
  const pm = 'Battery Power:\n Sleep On Power Button 1\n sleep                1\nAC Power:\n Sleep On Power Button 1\n displaysleep         10\n sleep                0\n tcpkeepalive         1\n';
  check('pmset:只看接着电源那一段的 sleep', svc.acSleepMinutes(pm) === 0 && svc.acSleepMinutes(pm.replace(/sleep {16}0/, 'sleep                15')) === 15 && svc.acSleepMinutes('Battery Power:\n sleep 1\n') === null);
}

{
  // 日志:一天一个文件、每行带时刻、写进来的不一定是整行;换天开新文件;留 14 天
  const dir = join(home, 'logs');
  mkdirSync(dir, { recursive: true });
  for (const d of ['2026-10-20', '2026-10-24', '2026-10-25']) writeFileSync(join(dir, `${d}.log`), 'old\n');
  writeFileSync(join(dir, 'launchd.log'), 'x\n');
  let clock = new Date(2026, 10, 6, 9, 5, 7);
  const undo = teeLogs(dir, { now: () => clock });
  console.log('起来了');
  process.stderr.write('半行');
  process.stderr.write('接着\n第二行\n');
  clock = new Date(2026, 10, 7, 0, 0, 3);
  console.error('第二天');
  undo();
  const day1 = readFileSync(join(dir, '2026-11-06.log'), 'utf8');
  const day2 = readFileSync(join(dir, '2026-11-07.log'), 'utf8');
  check('日志:每行带时分秒,半行接着写不再加', day1 === '09:05:07 起来了\n09:05:07 半行接着\n09:05:07 第二行\n', JSON.stringify(day1));
  check('日志:换天开新文件', day2 === '00:00:03 第二天\n', JSON.stringify(day2));
  // 11-07 留 14 天:10-25 起;10-24、10-20 删掉;launchd.log 不动
  check('日志:留 14 天,更早的删掉;launchd.log 不动', JSON.stringify(readdirSync(dir).sort()) === JSON.stringify(['2026-10-25.log', '2026-11-06.log', '2026-11-07.log', 'launchd.log']), JSON.stringify(readdirSync(dir)));
  check('pruneLogs 按文件名的日期', JSON.stringify(pruneLogs(dir, new Date(2026, 10, 20), 14)) === JSON.stringify(['2026-10-25.log', '2026-11-06.log']));
}

// ---- /api/health 与命令行:要一个 workspace ----
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
const wsRoot = join(home, 'cotutor', 'kid');
await initWorkspace({ slug: 'kid', dir: wsRoot });
{
  const ctx = createContext(loadWorkspace(wsRoot));
  const r1 = (await route('GET', '/api/health', ctx)).json as Record<string, unknown>;
  process.env.COTUTOR_SERVICE = 'com.tarslab.cotutor.kid';
  const r2 = (await route('GET', '/api/health', ctx)).json as Record<string, unknown>;
  delete process.env.COTUTOR_SERVICE;
  check('/api/health:pid、mode(终端 / 后台服务)、vault 读不读得到', r1.pid === process.pid && r1.mode === 'foreground' && r2.mode === 'service' && ['ok', 'missing'].includes(String(r1.vault)), JSON.stringify([r1.mode, r2.mode, r1.vault]));
}

const bin = join(import.meta.dirname, '..', 'bin', 'cotutor.js');
const cli = (args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; out: string }> => new Promise((resolve) => {
  execFile(process.execPath, [bin, ...args], { env: { ...process.env, HOME: home, ...env }, timeout: 30_000 }, (err, stdout, stderr) => resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` }));
});
if (process.platform === 'darwin' || process.platform === 'linux') {
  const st = await cli(['service', 'status', '--workspace', wsRoot]);
  check('service status:没装说没装', st.code === 0 && st.out.includes('没装'), st.out);
  const sb = await cli(['service', 'install', '--workspace', wsRoot, '--sandbox']);
  check('试用 workspace 不让装', sb.code === 2 && sb.out.includes('试用'), sb.out);
  const bad = await cli(['service', 'nope', '--workspace', wsRoot]);
  check('不认的子命令:用法错', bad.code === 2, bad.out);
}
{
  // 端口被占:终端里以 1 退、说可能是后台服务;后台服务以 0 退(launchd / systemd 不拉起)
  const blocker = createServer(() => {});
  await new Promise<void>((r) => blocker.listen(0, '0.0.0.0', r));
  const port = String((blocker.address() as { port: number }).port);
  const fg = await cli(['serve', '--workspace', wsRoot, '--port', port, '--http']);
  const logDir = join(home, 'svc-logs');
  const bg = await cli(['serve', '--workspace', wsRoot, '--port', port, '--http', '--log-dir', logDir], { COTUTOR_SERVICE: 'com.tarslab.cotutor.kid' });
  blocker.close();
  const logged = existsSync(logDir) ? readdirSync(logDir).filter((f) => f.endsWith('.log')).map((f) => readFileSync(join(logDir, f), 'utf8')).join('') : '';
  check('端口被占:终端里以 1 退,说怎么办', fg.code === 1 && fg.out.includes(`端口 ${port} 被占着`) && fg.out.includes('cotutor service'), fg.out.slice(-400));
  check('端口被占:后台服务以 0 退(不一直重试),那句进了日志文件', bg.code === 0 && logged.includes(`端口 ${port} 被占着`) && /^\d\d:\d\d:\d\d /m.test(logged), JSON.stringify({ code: bg.code, logged: logged.slice(-300) }));
}

done();
