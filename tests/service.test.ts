/**
 * 后台服务(src/app/cli/service.ts、service-windows.ts)与 serve 的日志(serve-log.ts):不真装,launchctl / systemctl / reg 换成记账的假命令。
 * 服务文件写出来再读回参数一字不差(带空格、引号、&、%、中文);按 --workspace 找服务、同名目录加 hash、重装同名;装 / 卸 / 起停各跑什么命令;
 * launchctl print、systemctl show、pmset、powercfg 的解析;Windows 的命令行转义、启动器 UTF-16、看护进程(非 0 再起、0 不起);日志按天落、每行带时刻、留 14 天;/api/health 带 pid、mode、vault;
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
const win = await import('../src/app/cli/service-windows.ts');
const { teeLogs, pruneLogs } = await import('../src/app/cli/serve-log.ts');
const { UsageError } = await import('../src/app/workspace.ts');

// ---- 装完开不开家长端:只有第一次;2026-11-07 用户定的,别的启动都不是人要看页面 ----
{
  const opens = (o: Partial<Parameters<typeof svc.opensAfterInstall>[0]> = {}): boolean => svc.opensAfterInstall({ firstTime: true, open: false, noOpen: false, platform: 'darwin', env: {}, ...o });
  check('第一次装:开(Mac、Windows)', opens() && opens({ platform: 'win32' }));
  check('重装(换了 Node 版本之类):不开', !opens({ firstTime: false }));
  check('--no-open:不开,和 --open 一起也不开', !opens({ noOpen: true }) && !opens({ noOpen: true, open: true }));
  check('--open:重装也开', opens({ firstTime: false, open: true }));
  check('ssh 进来的:不开', !opens({ env: { SSH_CONNECTION: '1 2 3 4' } }) && !opens({ env: { SSH_TTY: '/dev/ttys001' } }) && !opens({ platform: 'win32', env: { SSH_CONNECTION: '1 2 3 4' } }));
  check('ssh 进来但明说 --open:开', opens({ open: true, env: { SSH_CONNECTION: '1 2 3 4' } }));
  check('Linux:有图形会话才开', !opens({ platform: 'linux' }) && opens({ platform: 'linux', env: { DISPLAY: ':0' } }) && opens({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } }));
}

{
  check('服务名:目录名的小写字母数字连字符;撞了加路径的短 hash', svc.serviceName('/x/Ray Home') === 'ray-home' && svc.serviceName('/x/小明') === 'workspace' && /^ray-[0-9a-f]{6}$/.test(svc.serviceName('/x/ray', true)) && svc.serviceName('/x/ray', true) !== svc.serviceName('/y/ray', true));
  const spec = { name: 'ray', label: 'com.tarslab.cotutor.ray', root: '/Users/a b/cotutor/ray & co', logDir: '/L/ray', path: '/opt/homebrew/bin:/usr/bin', args: ['/n o/node', '/p/bin/cotutor.js', 'serve', '--workspace', '/Users/a b/cotutor/ray & co', '--log-dir', '/L/<ray>'] };
  const plist = svc.launchdPlist(spec);
  check('plist:参数读回来一字不差(空格、&、<)', JSON.stringify(svc.serviceArgs(plist)) === JSON.stringify(spec.args), JSON.stringify(svc.serviceArgs(plist)));
  check('plist:登录就起、只在崩了时拉起(退出码 0 不拉)、PATH 写死、带 COTUTOR_SERVICE、launchd 的输出进日志目录', plist.includes('<key>RunAtLoad</key><true/>') && /<key>SuccessfulExit<\/key><false\/>/.test(plist) && plist.includes('<string>/opt/homebrew/bin:/usr/bin</string>') && plist.includes('<key>COTUTOR_SERVICE</key><string>com.tarslab.cotutor.ray</string>') && plist.includes(`<string>${join('/L/ray', 'launchd.log')}</string>`));
  const unit = svc.systemdUnit({ ...spec, label: 'cotutor-ray', args: ['/n o/node', '/p/bin/cotutor.js', 'serve', '--workspace', '/w/"q"\\x 100%'] });
  check('systemd:参数读回来一字不差(空格、引号、反斜杠、%)', JSON.stringify(svc.serviceArgs(unit)) === JSON.stringify(['/n o/node', '/p/bin/cotutor.js', 'serve', '--workspace', '/w/"q"\\x 100%']) && unit.includes('Restart=on-failure') && unit.includes('100%%'), JSON.stringify(svc.serviceArgs(unit)));
  const h = { platform: 'linux' as const, home: '/h', env: { XDG_STATE_HOME: '/s' } };
  const wh = { platform: 'win32' as const, home: '/h', env: { LOCALAPPDATA: '/local' } };
  check('放哪:macOS LaunchAgents / Library/Logs;Linux systemd/user / XDG_STATE_HOME;Windows LOCALAPPDATA', svc.serviceDir({ platform: 'darwin', home: '/h', env: {} }) === join('/h', 'Library', 'LaunchAgents') && svc.serviceLogDir({ platform: 'darwin', home: '/h', env: {} }, 'ray') === join('/h', 'Library', 'Logs', 'cotutor', 'ray') && svc.serviceDir(h) === join('/h', '.config', 'systemd', 'user') && svc.serviceLogDir(h, 'ray') === join('/s', 'cotutor', 'logs', 'ray') && svc.serviceDir(wh) === join('/local', 'cotutor', 'service') && svc.serviceLogDir(wh, 'ray') === join('/local', 'cotutor', 'logs', 'ray') && svc.serviceDir({ ...wh, env: {} }) === join('/h', 'AppData', 'Local', 'cotutor', 'service'));
  let other = '';
  try { svc.servicePlatform('freebsd'); } catch (err) { other = err instanceof UsageError ? err.message : ''; }
  check('三个系统都做了;别的说清楚、指 cotutor serve', svc.servicePlatform('win32') === 'win32' && other.includes('cotutor serve'), other);
}

{
  // Windows 的命令行转义(CommandLineToArgvW 的规矩;真机上跑过:带空格、中文、结尾反斜杠、引号,node 收到的一字不差)
  check('转义:普通的不加引号;空格加引号;引号转义;引号前、结尾的反斜杠翻倍;中间的反斜杠不动', win.winQuote('serve') === 'serve' && win.winQuote('C:\\a\\b') === 'C:\\a\\b' && win.winQuote('C:\\a b') === '"C:\\a b"' && win.winQuote('q"r') === '"q\\"r"' && win.winQuote('C:\\x y\\') === '"C:\\x y\\\\"' && win.winQuote('a\\"b') === '"a\\\\\\"b"' && win.winQuote('') === '""', JSON.stringify([win.winQuote('C:\\x y\\'), win.winQuote('a\\"b')]));
  const args = ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\张 三\\bin\\cotutor.js', 'service', 'run', '--workspace', 'C:\\Users\\张 三\\cotutor\\ray', '--log-dir', 'C:\\L\\ray'];
  const js = win.windowsLauncher(args, args[5]);
  check('启动器:藏着窗口(Run 的第二个参数 0)、不等它(false),命令行转义过', js.includes(`Run(${JSON.stringify(win.winCommandLine(args))}, 0, false)`) && js.includes('ActiveXObject("WScript.Shell")'), js);
  const encoded = win.encodeLauncher(js);
  check('启动器存成 UTF-16 带 BOM(wscript 按这个读中文),读回来一样', encoded[0] === 0xff && encoded[1] === 0xfe && win.decodeServiceFile(encoded) === js && win.decodeServiceFile(Buffer.from('普通的', 'utf8')) === '普通的');
  check('启动器:参数读回来一字不差;不是启动器的回 null', JSON.stringify(svc.serviceArgs(js)) === JSON.stringify(args) && win.launcherArgs('// args: [1]') === null && win.launcherArgs('别的') === null);
  check('找进程的输出:一个、几个、没有、坏的', JSON.stringify(win.parseProcs('{"pid":7,"keeper":true}')) === '[{"pid":7,"keeper":true}]' && win.parseProcs('[{"pid":7,"keeper":true},{"pid":8,"keeper":false}]').length === 2 && win.parseProcs('').length === 0 && win.parseProcs('[]').length === 0 && win.parseProcs('啊').length === 0);
  const script = win.findProcsScript("C:\\it's");
  check('找进程:路径里的单引号写两个;只认看护进程与带 --log-dir 的 serve(终端里的不算)', script.includes("'C:\\it''s'") && script.includes("' service run '") && script.includes("'--log-dir'"));
  const decoded = Buffer.from(win.psArgs('echo 1').at(-1) as string, 'base64').toString('utf16le');
  check('PowerShell:编码传、输出定成 UTF-8、关进度', decoded.includes('UTF8') && decoded.includes("$ProgressPreference='SilentlyContinue'") && decoded.endsWith('echo 1'));
  const pc = (ac: string, dc: string, words: string[]) => `${words[0]}: 0x00000000\n${words[1]}: 0xffffffff\n${words[2]}: 0x00000001\n${words[3]}: Seconds\n${words[4]}: 0x${ac}\n${words[5]}: 0x${dc}\n`;
  const en = ['Minimum Possible Setting', 'Maximum Possible Setting', 'Possible Settings increment', 'Possible Settings units', 'Current AC Power Setting Index', 'Current DC Power Setting Index'];
  const zh = ['最小可能的设置', '最大可能的设置', '可能的设置增量', '可能的设置单位', '当前交流电源设置索引', '当前直流电源设置索引'];
  check('powercfg:接着电源的秒数,认顺序不认字(中文系统一样);读不出 null', win.winAcSleepSeconds(pc('00001c20', '000005dc', en)) === 7200 && win.winAcSleepSeconds(pc('00000000', '000005dc', zh)) === 0 && win.winAcSleepSeconds('没有') === null);
  check('拦睡眠:ES_CONTINUOUS | ES_SYSTEM_REQUIRED,等 serve 退出', win.awakeScript(42).includes('2147483649') && win.awakeScript(42).includes('Wait-Process -Id 42') && 0x80000001 === 2147483649);
  check('早期输出去哪:macOS launchd.log、Linux journal、Windows keeper.log', svc.earlyLogHint('darwin', { label: 'x', logDir: '/L' }) === join('/L', 'launchd.log') && svc.earlyLogHint('linux', { label: 'cotutor-x', logDir: '/L' }).includes('journalctl --user -u cotutor-x.service') && svc.earlyLogHint('win32', { label: 'x', logDir: '/L' }) === join('/L', 'keeper.log'));
}

/** 假的系统:记下跑了什么;launchctl print 按 loaded 回;Windows 上 wscript 算起了看护进程,taskkill 算杀了 */
const fakeHost = (platform: 'darwin' | 'linux' | 'win32', root: string) => {
  const calls: string[] = [];
  const loaded = new Set<string>();
  let keepers = 0;
  let regValue: string | null = null;
  let approved = '';
  const host = {
    platform, home: root, uid: 501, env: { PATH: '/opt/homebrew/bin:/usr/bin', LOCALAPPDATA: join(root, 'local'), SystemRoot: 'C:\\Windows' } as NodeJS.ProcessEnv, calls, loaded,
    get regValue() { return regValue; },
    get approved() { return approved; },
    set approved(v: string) { approved = v; },
    run: async (cmd: string, args: string[]) => {
      if (cmd === 'powershell.exe') { calls.push('powershell'); return { code: 0, stdout: keepers ? JSON.stringify([{ pid: 900, keeper: true }, { pid: 901, keeper: false }]) : '[]', stderr: '' }; }
      calls.push(`${cmd} ${args.join(' ')}`);
      if (cmd.endsWith('wscript.exe')) keepers = 1;
      if (cmd === 'taskkill.exe') keepers = 0;
      if (cmd === 'reg.exe' && args[1] === win.STARTUP_APPROVED_KEY) {
        if (args[0] === 'delete') approved = '';
        return { code: approved ? 0 : 1, stdout: approved, stderr: '' };
      }
      if (cmd === 'reg.exe' && args[0] === 'add') regValue = args[args.indexOf('/d') + 1];
      if (cmd === 'reg.exe' && args[0] === 'delete') regValue = null;
      if (cmd === 'reg.exe' && args[0] === 'query') return { code: regValue ? 0 : 1, stdout: '', stderr: '' };
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
  const fh = join(home, 'win');
  const host = fakeHost('win32', fh);
  const ws = join(home, 'kids', 'tian');
  mkdirSync(ws, { recursive: true });
  const a = await svc.installService(host, ws, { node: 'C:\\Program Files\\nodejs\\node.exe', bin: 'C:\\pkg\\bin\\cotutor.js' });
  const file = join(fh, 'local', 'cotutor', 'service', 'cotutor-tian.js');
  const logDir = join(fh, 'local', 'cotutor', 'logs', 'tian');
  const wscript = join('C:\\Windows', 'System32', 'wscript.exe');
  check('Windows 装:写启动器、写用户的 Run 项、起看护进程(service run,不是 serve)', existsSync(file) && JSON.stringify(a.spec.args) === JSON.stringify(['C:\\Program Files\\nodejs\\node.exe', 'C:\\pkg\\bin\\cotutor.js', 'service', 'run', '--workspace', ws, '--log-dir', logDir]) && host.calls.join('|') === `reg.exe add ${win.RUN_KEY} /v cotutor-tian /t REG_SZ /d "${wscript}" //B //Nologo "${file}" /f|reg.exe delete ${win.STARTUP_APPROVED_KEY} /v cotutor-tian /f|${wscript} //B //Nologo ${file}` && existsSync(logDir), host.calls.join(' | '));
  check('Windows:Run 项里 wscript 带 //B,路径带引号', host.regValue === `"${wscript}" //B //Nologo "${file}"`, String(host.regValue));
  check('Windows:按启动器里的 --workspace 找服务(不分大小写)', (await svc.findService(host, ws))?.label === 'cotutor-tian' && (await svc.findService({ ...host, run: host.run }, ws.toUpperCase()))?.label === 'cotutor-tian');
  const st = await svc.serviceStatus(host, ws, 9);
  check('Windows 状态:看护进程在就是在跑;pid 是 serve 的;登录项在', st.running && st.pid === 901 && st.autostart === true, JSON.stringify(st));
  // 任务管理器里关掉:Run 项还在,StartupApproved 第一个字节变单数(真机上 reg query 的样子)
  const line = (hex: string): string => `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run\r\n    cotutor-tian    REG_BINARY    ${hex}\r\n\r\n`;
  check('StartupApproved:02 开、03 关、06 开、07 关;没这个值不算关', !win.startupDisabled(line('020000000000000000000000')) && win.startupDisabled(line('030000000000000000000000')) && !win.startupDisabled(line('060000000000000000000000')) && win.startupDisabled(line('07000000D0A9B1F2')) && !win.startupDisabled('ERROR: The system was unable to find the specified registry key or value.'));
  host.approved = line('020000000000000000000000');
  check('Windows 状态:任务管理器里开着,算会自己起来', (await svc.serviceStatus(host, ws, 9)).autostart === true);
  host.approved = line('030000000000000000000000');
  check('Windows 状态:任务管理器里关掉了,Run 项还在也算不会自己起来', (await svc.serviceStatus(host, ws, 9)).autostart === false && host.regValue !== null);
  const fixed = await svc.installService(host, ws, { node: 'C:\\Program Files\\nodejs\\node.exe', bin: 'C:\\pkg\\bin\\cotutor.js' });
  check('Windows 再装一次:关掉的记录去掉,又会自己起来', fixed.replaced && host.approved === '' && (await svc.serviceStatus(host, ws, 9)).autostart === true);
  host.calls.length = 0;
  await svc.controlService(host, ws, 'start');
  check('Windows 起:已经在跑就不再起一个', !host.calls.some((c) => c.includes('wscript')), host.calls.join(' | '));
  await svc.controlService(host, ws, 'restart');
  check('Windows 重起:杀进程树(看护进程先)、再起', host.calls.includes('taskkill.exe /PID 900 /T /F') && host.calls.indexOf('taskkill.exe /PID 900 /T /F') < host.calls.findIndex((c) => c.includes('wscript')), host.calls.join(' | '));
  host.calls.length = 0;
  await svc.controlService(host, ws, 'stop');
  check('Windows 停:杀进程树,文件和 Run 项还在', host.calls.includes('taskkill.exe /PID 900 /T /F') && existsSync(file) && host.regValue !== null && !(await svc.serviceStatus(host, ws, 9)).running, host.calls.join(' | '));
  const again = await svc.installService(host, ws, { node: 'C:\\nodejs22\\node.exe', bin: 'C:\\pkg\\bin\\cotutor.js' });
  check('Windows 再装一次:同一个名字、照新的 node 重写', again.replaced && again.spec.name === 'tian' && svc.serviceArgs(win.decodeServiceFile(readFileSync(file)))[0] === 'C:\\nodejs22\\node.exe');
  host.approved = line('030000000000000000000000');
  await svc.uninstallService(host, ws);
  check('Windows 卸:杀进程、删 Run 项、删启动器、关掉的记录也不留', !existsSync(file) && host.regValue === null && host.approved === '' && host.calls.some((c) => c.startsWith('reg.exe delete')) && host.calls.includes('taskkill.exe /PID 900 /T /F'), host.calls.join(' | '));
}

{
  // 看护进程:真起子进程。假的 bin:按次数退(1、1、0),记下收到的参数与 COTUTOR_SERVICE
  const dir = join(home, 'keeper');
  mkdirSync(dir, { recursive: true });
  const fakeBin = join(dir, 'fake-bin.mjs');
  const seen = join(dir, 'seen.log');
  writeFileSync(fakeBin, `import { appendFileSync, readFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(seen)}, JSON.stringify({ argv: process.argv.slice(2), svc: process.env.COTUTOR_SERVICE }) + '\\n');\nconst n = readFileSync(${JSON.stringify(seen)}, 'utf8').trim().split('\\n').length;\nprocess.exit(n < 3 ? 1 : 0);\n`);
  const logDir = join(dir, 'logs');
  const code = await svc.runKeeper({ root: join(dir, 'ws'), logDir, label: 'cotutor-x', bin: fakeBin, restartMs: 20 });
  const lines = readFileSync(seen, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { argv: string[]; svc: string });
  const keeperLog = readFileSync(join(logDir, svc.KEEPER_LOG), 'utf8');
  check('看护进程:非 0 再起,0 不起,自己以 0 退', code === 0 && lines.length === 3, JSON.stringify({ code, n: lines.length }));
  check('看护进程:起的是 serve,带 --workspace、--log-dir、COTUTOR_SERVICE', JSON.stringify(lines[0].argv) === JSON.stringify(['serve', '--workspace', join(dir, 'ws'), '--log-dir', logDir]) && lines[0].svc === 'cotutor-x', JSON.stringify(lines[0]));
  check('看护进程:每次退了记一笔', (keeperLog.match(/serve 退了\(1\)/g) ?? []).length === 2 && keeperLog.includes('不再起'), keeperLog);
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
  check('/api/health:pid、mode(终端 / 后台服务)、vault 读不读得到', r1.pid === process.pid && r1.mode === 'foreground' && r2.mode === 'service' && ['ok', 'missing'].includes(String(r1.vault)) && r1.calls === 0 && typeof r1.bailian === 'boolean', JSON.stringify([r1.mode, r2.mode, r1.vault]));
}

const bin = join(import.meta.dirname, '..', 'bin', 'cotutor.js');
const cli = (args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; out: string }> => new Promise((resolve) => {
  execFile(process.execPath, [bin, ...args], { env: { ...process.env, HOME: home, ...env }, timeout: 30_000 }, (err, stdout, stderr) => resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` }));
});
{
  const st = await cli(['service', 'status', '--workspace', wsRoot]);
  check('service status:没装说没装', st.code === 0 && st.out.includes('没装'), st.out);
  // 一次答清「装好没有」:INSTALL.md 让 agent 只读这一份
  const sj = await cli(['service', 'status', '--workspace', wsRoot, '--json']);
  const facts = JSON.parse(sj.out) as { installed: unknown; health: unknown; version: string; parentPage: string; tabletUrl: string; cert: { present: boolean; coversName: boolean; serving: boolean }; bailian: boolean; tray: unknown };
  check('service status --json:没装、没答应,地址、证书、百炼、版本都答得出', facts.installed === null && facts.health === null && /^\d+\.\d+\.\d+/.test(facts.version) && facts.parentPage.endsWith('/parent/home') && facts.parentPage.includes('localhost') && /^https?:\/\/[^/]+\.local/.test(facts.tabletUrl) && facts.cert.present === false && facts.cert.coversName === false && facts.cert.serving === false && facts.bailian === false, sj.out);
  check('service status --json:Linux 没做图标时是 null,别的系统答得出装没装', process.platform === 'linux' ? facts.tray === null : (facts.tray as { installed: boolean }).installed === false, sj.out);
  const sb = await cli(['service', 'install', '--workspace', wsRoot, '--sandbox']);
  check('试用 workspace 不让装', sb.code === 2 && sb.out.includes('试用'), sb.out);
  const bad = await cli(['service', 'nope', '--workspace', wsRoot]);
  check('不认的子命令:用法错', bad.code === 2, bad.out);
}
{
  // 端口被占:终端里以 1 退、说怎么办;后台服务以 0 退(launchd / systemd 不拉起)。那句话的各种情况在 port.test
  const blocker = createServer(() => {});
  await new Promise<void>((r) => blocker.listen(0, '0.0.0.0', r));
  const port = String((blocker.address() as { port: number }).port);
  const fg = await cli(['serve', '--workspace', wsRoot, '--port', port, '--http']);
  const logDir = join(home, 'svc-logs');
  const bg = await cli(['serve', '--workspace', wsRoot, '--port', port, '--http', '--log-dir', logDir], { COTUTOR_SERVICE: 'com.tarslab.cotutor.kid' });
  blocker.close();
  const logged = existsSync(logDir) ? readdirSync(logDir).filter((f) => f.endsWith('.log')).map((f) => readFileSync(join(logDir, f), 'utf8')).join('') : '';
  check('端口被占:终端里以 1 退,说怎么办', fg.code === 1 && fg.out.includes(`端口 ${port} 被占着`) && fg.out.includes('--port'), fg.out.slice(-400));
  check('端口被占:后台服务以 0 退(不一直重试),那句进了日志文件', bg.code === 0 && logged.includes(`端口 ${port} 被占着`) && /^\d\d:\d\d:\d\d /m.test(logged), JSON.stringify({ code: bg.code, logged: logged.slice(-300) }));
}

done();
