/**
 * 端口的规矩(src/app/cli/port.ts):init 选一次写进 cotutor.json,以后不变;运行时被占只报错。
 * 选端口、被占的判断、谁占着、绑不上时那句话、地址里不写 443、电脑名从哪来、cotutor open、doctor 的那一项。
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-port-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.COTUTOR_WORKSPACE;

const { PORT_CANDIDATES, answersLocally, bindFailure, choiceNote, choosePort, holderScript, knownPorts, parseHolder, parseLsof, portHolder, portState, sandboxPort, tryBind } = await import('../src/app/cli/port.ts');
const { computerName, listenInfo, localName, serveWorkspace, siteUrl } = await import('../src/app/cli/serve.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { doctorWorkspace } = await import('../src/app/cli/doctor.ts');
const { realHost } = await import('../src/app/cli/service.ts');
const { DEFAULT_PORT } = await import('../src/schema/index.ts');
const { UsageError, parseConfig } = await import('../src/app/workspace.ts');

const listen = (host: string, port = 0): Promise<Server> => new Promise((resolve, reject) => {
  // 读掉对方发的:不读就收不到对方关连接,close 等不到头
  const s = createServer((c) => { c.on('error', () => {}); c.resume(); });
  s.once('error', reject);
  s.listen(port, host, () => resolve(s));
});
const portOf = (s: Server): number => (s.address() as { port: number }).port;
const close = (s: Server): Promise<void> => new Promise((resolve) => s.close(() => resolve()));
const allFree = async (): Promise<'free'> => 'free';
const onlyFree = (...free: number[]) => async (p: number): Promise<'free' | 'busy'> => (free.includes(p) ? 'free' : 'busy');
const readConfig = (root: string): { server: { port: number } } => JSON.parse(readFileSync(join(root, 'cotutor.json'), 'utf8')) as { server: { port: number } };

// ---- 选端口 ----
check('先 443,再 8443、8445:隔一个号给 sandbox 留的', PORT_CANDIDATES[0] === 443 && PORT_CANDIDATES[1] === 8443 && PORT_CANDIDATES[2] === 8445);
check('备选和备选的 sandbox 互不相撞', new Set(PORT_CANDIDATES.flatMap((p) => [p, sandboxPort(p)])).size === PORT_CANDIDATES.length * 2);
check('备选不进系统的动态端口段(49152 起,Windows 上有几段被保留)', PORT_CANDIDATES.every((p) => p < 49152));
check('sandbox 是 +1;65535 没有 +1 就 -1', sandboxPort(443) === 444 && sandboxPort(5180) === 5181 && sandboxPort(65535) === 65534);

const fresh = await choosePort([], allFree);
check('都空着:443', fresh.port === 443 && fresh.skipped.length === 0, JSON.stringify(fresh));
check('443 的说明:地址里不用写端口,选定不变', choiceNote(fresh).includes('不用写端口') && choiceNote(fresh).includes('不再变'), choiceNote(fresh));

const linux = await choosePort([], async (p) => (p < 1024 ? 'denied' : 'free'));
check('系统不让绑 443(Linux):自己落到 8443,说得出为什么', linux.port === 8443 && linux.skipped[0].why === 'denied' && choiceNote(linux).includes('8443') && choiceNote(linux).includes('不让'), choiceNote(linux));

const busy = await choosePort([], onlyFree(8443));
check('443 被占:8443', busy.port === 8443 && choiceNote(busy).includes('443 被占着'), choiceNote(busy));

check('第二个孩子让开第一个', (await choosePort([443], allFree)).port === 8443);
check('第三个孩子:8445,不是 8444(那是第二个孩子的 sandbox)', (await choosePort([443, 8443], allFree)).port === 8445);
check('别人的端口正好是我的 +1:也让开', (await choosePort([444], allFree)).port === 8443);
check('别人的 sandbox 正好是我:也让开', (await choosePort([442], allFree)).port === 8443);
check('旧孩子在 5180:不影响新孩子用 443', (await choosePort([5180], allFree)).port === 443);
const taken = await choosePort([443], allFree);
check('让给别的孩子的说明', choiceNote(taken).includes('留给了另一个孩子'), choiceNote(taken));

let threw = '';
try { await choosePort([], async () => 'busy', [443, 8443]); } catch (e) { if (e instanceof UsageError) threw = e.message; }
check('一个都用不了:用法错误,让他 --port', threw.includes('--port'), threw);

// ---- 被占的判断(真绑) ----
{
  const wild = await listen('0.0.0.0');
  check('有人听着 0.0.0.0:busy', (await portState(portOf(wild))) === 'busy' && (await answersLocally(portOf(wild))));
  const p = portOf(wild);
  await close(wild);
  check('关掉就空了:free', (await portState(p)) === 'free' && !(await answersLocally(p)));

  // macOS 的坑:别人只占 127.0.0.1 时,绑 0.0.0.0 照样成功,光试绑看不出来
  const lo = await listen('127.0.0.1');
  check('只占 127.0.0.1 也算 busy(先问一声)', (await portState(portOf(lo))) === 'busy');
  check('Windows 那条路绑 127.0.0.1:探不出弹窗,被占也知道', (await tryBind(portOf(lo), 'win32')) === 'busy');
  await close(lo);

  if (process.platform === 'linux' && process.getuid?.() !== 0) check('Linux 普通用户绑 443:denied', (await tryBind(443)) === 'denied');
}

// ---- 谁占着 ----
check('lsof 的输出', JSON.stringify(parseLsof('p1234\nf15\ncnginx\n')) === '{"pid":1234,"name":"nginx"}' || JSON.stringify(parseLsof('p1234\ncnginx\nf15\n')) === '{"pid":1234,"name":"nginx"}');
check('lsof 没输出:不知道', parseLsof('') === null);
check('PowerShell 的输出', parseHolder('{"pid":4,"name":"System"}\r\n')?.name === 'System');
check('PowerShell 没输出、坏的:不知道', parseHolder('') === null && parseHolder('oops') === null && parseHolder('{"pid":"x"}') === null);
check('脚本里有端口;不按 State 查(build 26300 上状态是乱的)', holderScript(443).includes('-LocalPort 443') && holderScript(443).includes('RemotePort -eq 0') && !holderScript(443).includes('-State'));
{
  const seen: string[] = [];
  const fake = (platform: NodeJS.Platform, stdout: string) => ({ platform, run: async (cmd: string) => { seen.push(cmd); return { code: 0, stdout, stderr: '' }; } });
  check('darwin 走 lsof', (await portHolder(fake('darwin', 'p9\ncCaddy\n'), 443))?.name === 'Caddy' && seen.at(-1) === 'lsof');
  check('win32 走 PowerShell', (await portHolder(fake('win32', '{"pid":9,"name":"nginx"}'), 443))?.name === 'nginx' && seen.at(-1) === 'powershell.exe');
  check('linux 没装 lsof:不知道,不抛', (await portHolder({ platform: 'linux', run: async () => ({ code: 1, stdout: '', stderr: 'ENOENT' }) }, 443)) === null);
  if (process.platform !== 'linux') {
    const s = await listen('0.0.0.0');
    const got = await portHolder(realHost(), portOf(s));
    check('真的查:占着的是这个 node', got?.pid === process.pid && /node/i.test(got?.name ?? ''), JSON.stringify(got));
    await close(s);
  }
}

// ---- 绑不上时那句话 ----
{
  const nginx = { text: 'nginx(pid 12)', cotutor: null };
  const fg = bindFailure('EADDRINUSE', 443, nginx, false);
  check('别的程序占着(终端):说是谁、怎么办,提醒改端口的代价', fg.includes('端口 443 被占着') && fg.includes('nginx(pid 12)') && fg.includes('--port') && fg.includes('重新扫码'), fg);
  const bg = bindFailure('EADDRINUSE', 443, nginx, true);
  check('别的程序占着(后台服务):先不起,腾出来 start', bg.includes('后台服务先不起') && bg.includes('cotutor service start') && bg.includes('nginx'), bg);
  const svc = bindFailure('EADDRINUSE', 443, { text: 'cotutor 的后台服务(pid 9)', cotutor: 'service' }, false);
  check('后台服务占着(终端里调试):先 stop', svc.includes('cotutor service stop') && !svc.includes('重新扫码'), svc);
  const term = bindFailure('EADDRINUSE', 443, { text: '另一个 cotutor serve(pid 9)', cotutor: 'serve' }, true);
  check('终端里的 serve 占着(后台服务):关掉它再 start', term.includes('关掉它') && term.includes('cotutor service start'), term);
  const unknown = bindFailure('EADDRINUSE', 443, { text: null, cotutor: null }, false);
  check('查不到是谁:照样说被占着', unknown.includes('端口 443 被占着。'), unknown);
  const denied = bindFailure('EACCES', 443, null, false);
  check('系统不让绑(终端):说清楚,给换端口的办法', denied.includes('系统不让') && denied.includes('--port') && denied.includes('server.port'), denied);
  check('系统不让绑(后台服务):先不起', bindFailure('EACCES', 443, null, true).includes('后台服务先不起'));
}

// ---- 地址 ----
check('https 的 443 不写端口', siteUrl('https', 'ae86s-Mac.local', 443) === 'https://ae86s-Mac.local/');
check('大小写不改(URL 解析会把主机名压成小写,这里不用它)', siteUrl('https', 'ae86s-Mac.local', 8443).includes('ae86s-Mac'));
check('别的端口要写', siteUrl('https', 'x.local', 8443) === 'https://x.local:8443/' && siteUrl('https', 'localhost', 5180, '/parent/home') === 'https://localhost:5180/parent/home');
check('http 的 443 要写,http 的 80 不写', siteUrl('http', 'localhost', 443, '/parent/home') === 'http://localhost:443/parent/home' && siteUrl('http', 'x', 80) === 'http://x/');
const info = listenInfo(true, 443);
check('扫码页的两条:443 都不写端口', info.name.endsWith('.local/') && !info.name.includes(':443') && (info.ip === null || !info.ip.includes(':443')), JSON.stringify(info));
check('扫码页的两条:8443 都写', listenInfo(true, 8443).name.endsWith(':8443/'));

// ---- 电脑名 ----
check('macOS:读本地主机名,不看 os.hostname', computerName('darwin', () => 'ae86s-Mac\n', 'dhcp-10-0-0-9.lan') === 'ae86s-Mac');
check('macOS 读不到:退回 os.hostname,去掉 .local', computerName('darwin', () => { throw new Error('no'); }, 'ae86s-Mac.local') === 'ae86s-Mac');
check('macOS 读到空的:也退回', computerName('darwin', () => '  \n', 'fallback') === 'fallback');
check('Windows:os.hostname,不去读 scutil', computerName('win32', () => { throw new Error('不该读'); }, 'DESKTOP-ABC') === 'DESKTOP-ABC');
check('Linux:os.hostname', computerName('linux', () => { throw new Error('不该读'); }, 'nas') === 'nas');
check('localName 带上 .local,不重复', localName('ae86s-Mac') === 'ae86s-Mac.local' && localName('ae86s-Mac.local') === 'ae86s-Mac.local');
if (process.platform !== 'darwin') check('真的读:和 os.hostname 一样', computerName() === hostname().replace(/\.local$/i, ''));

// ---- init ----
{
  const first = await initWorkspace({ slug: 'first' });
  const a = readConfig(first.root).server.port;
  const note = first.steps.find((s) => s.item === 'cotutor.json')?.note ?? '';
  check('init 选了一个写进文件,说明里有它', PORT_CANDIDATES.includes(a) && note.includes(`端口 ${a}`) && note.includes('不再变'), note);
  check('别的 workspace 的端口读得到', knownPorts().includes(a), JSON.stringify(knownPorts()));

  const second = await initWorkspace({ slug: 'second' });
  const b = readConfig(second.root).server.port;
  check('第二个孩子自动让开,sandbox 也不撞', b !== a && b !== sandboxPort(a) && sandboxPort(b) !== a, `${a} ${b}`);

  // 旧配置不搬:没写端口的还是 5180,不跟着新规矩换地址
  const noPort = JSON.parse(readFileSync(join(first.root, 'cotutor.json'), 'utf8')) as Record<string, unknown>;
  delete noPort.server;
  check('cotutor.json 没写端口的:还是 5180', DEFAULT_PORT === 5180 && parseConfig(noPort, 'cotutor.json').server.port === 5180);

  const again = await initWorkspace({ slug: 'first' });
  check('再 init 不动端口(幂等补缺)', readConfig(first.root).server.port === a && again.steps.find((s) => s.item === 'cotutor.json')?.action === 'kept');

  const given = await initWorkspace({ slug: 'third', port: 7777 });
  check('--port 给了就听它的,不探', readConfig(given.root).server.port === 7777 && !given.steps.find((s) => s.item === 'cotutor.json')?.note);

  // 不在 ~/cotutor/ 下、但用户配置指着的:也要让开
  const outside = await initWorkspace({ slug: 'out', dir: join(home, 'elsewhere', 'out'), port: 6000 });
  writeFileSync(join(home, '.config', 'cotutor', 'config.json'), JSON.stringify({ workspace: outside.root }));
  check('用户配置指的那个也算', knownPorts().includes(6000), JSON.stringify(knownPorts()));
}

// ---- cotutor open、doctor ----
const bin = fileURLToPath(new URL('../bin/cotutor.js', import.meta.url));
const cli = (args: string[]): Promise<{ code: number; out: string; err: string }> => new Promise((resolve) => {
  execFile(process.execPath, [bin, ...args], { env: { ...process.env }, timeout: 60_000 }, (err, stdout, stderr) => resolve({ code: err ? Number((err as { code?: unknown }).code ?? 1) : 0, out: stdout, err: stderr }));
});
{
  const spare = await listen('127.0.0.1');
  const port = portOf(spare);
  await close(spare);
  const { root } = await initWorkspace({ slug: 'opener', port });

  const off = await cli(['open', '--workspace', root, '--print']);
  check('没在跑:以 1 退,说怎么起,地址也给', off.code === 1 && off.err.includes(`localhost:${port}/parent/home`) && off.err.includes('cotutor service start'), off.err);
  const offJson = await cli(['open', '--workspace', root, '--json']);
  check('--json:没在跑也给地址', offJson.code === 1 && JSON.parse(offJson.out).running === false && String(JSON.parse(offJson.out).url).includes(String(port)), offJson.out);

  const free = await doctorWorkspace(root);
  check('doctor:端口空着', free.checks.find((c) => c.name === 'server.port')?.ok === true, JSON.stringify(free.checks.find((c) => c.name === 'server.port')));

  const r = await serveWorkspace({ workspace: root, http: true, awake: false });
  const on = await cli(['open', '--workspace', root, '--print']);
  check('在跑:打印家长端地址,以 0 退', on.code === 0 && on.out.trim() === `http://localhost:${port}/parent/home`, JSON.stringify(on));
  const onJson = await cli(['open', '--workspace', root, '--json']);
  check('--json:在跑', onJson.code === 0 && JSON.parse(onJson.out).running === true, onJson.out);
  const up = await doctorWorkspace(root);
  check('doctor:cotutor 自己在答应,不算被占', up.checks.find((c) => c.name === 'server.port')?.ok === true && (up.checks.find((c) => c.name === 'server.port')?.detail ?? '').includes('cotutor 在答应'));
  await new Promise<void>((resolve) => r.server.close(() => resolve()));
  (r.server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();

  // 只占 127.0.0.1 时绑通配地址照样成功(macOS、Windows 都这样):serve 要先问一声,不然平板连这边、本机的 localhost 到了别的程序
  const onlyLo = await listen('127.0.0.1', port);
  let loErr: NodeJS.ErrnoException | null = null;
  try { await serveWorkspace({ workspace: root, http: true, awake: false }); } catch (e) { loErr = e as NodeJS.ErrnoException; }
  check('serve:别的程序只占 127.0.0.1,也当被占(带端口,main 能接住)', loErr?.code === 'EADDRINUSE' && (loErr as { port?: number }).port === port, String(loErr));
  const loCli = await cli(['serve', '--workspace', root, '--http']);
  check('命令行:以 1 退,说被占着', loCli.code === 1 && loCli.err.includes(`端口 ${port} 被占着`), loCli.err.slice(-300));
  await close(onlyLo);

  const blocker = await listen('0.0.0.0', port);
  const held = await doctorWorkspace(root);
  const c = held.checks.find((x) => x.name === 'server.port');
  check('doctor:别的程序占着,报出来(不是必需项),给办法', c?.ok === false && c.required === false && c.detail.includes('被占着') && (c.fix ?? '').includes('server.port'), JSON.stringify(c));
  await close(blocker);

  const sb = await cli(['open', '--workspace', root, '--sandbox', '--print']);
  check('--sandbox:开试用的那个,端口 +1,提示怎么起', sb.code === 1 && sb.err.includes(`localhost:${port + 1}/parent/home`) && sb.err.includes('cotutor serve --sandbox'), sb.err);
}

done();
process.exit(0);
