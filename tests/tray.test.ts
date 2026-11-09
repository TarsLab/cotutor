/**
 * 托盘图标(src/app/cli/tray*.ts):不真开图标、不真装,显示脚本和 launchctl / reg 都换成记账的假的。
 * 状态怎么判断、什么时候通知、菜单长什么样、点了做什么、退出的流程、登录项、图标文件;显示脚本只查语法与协议(真的在系统里跑要人看,见 docs/wip)。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-tray-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const t = await import('../src/app/cli/tray.ts');
const svc = await import('../src/app/cli/service.ts');
const icons = await import('../src/app/cli/tray-icons.ts');
const { MAC_TRAY_SCRIPT } = await import('../src/app/cli/tray-mac.ts');
const { WINDOWS_TRAY_SCRIPT, findTrayScript, trayLauncher } = await import('../src/app/cli/tray-windows.ts');
const { decodeServiceFile, encodeLauncher } = await import('../src/app/cli/service-windows.ts');

type Probe = import('../src/app/cli/tray.ts').TrayProbe;
type Health = import('../src/app/cli/service.ts').Health;

const VERSION = '0.3.0';
const healthy = (o: Partial<Health> = {}): Health => ({ version: VERSION, started: '2026-11-03T00:00:00Z', pid: 9, mode: 'service', vault: 'ok', bailian: true, calls: 0, configError: null, scheme: 'https', ...o });
const probe = (o: Partial<Probe> = {}): Probe => ({ name: 'ray', kid: 'Ray', root: '/w/ray', vault: '/w/ray-vault', logDir: '/L/ray', port: 443, health: healthy(), holder: null, ...o });
const NOW = Date.parse('2026-11-06T00:00:00Z');
const model = (platform: NodeJS.Platform = 'darwin') => new t.TrayModel({ platform, version: () => VERSION });

// ---- 读 cotutor.json(不带 zod):孩子名、端口、vault 在哪;vault 照 resolvePaths 算 ----
{
  const ws = (name: string, cfg: unknown): { name: string; label: string; file: string; args: string[]; root: string; logDir: string } => {
    const root = join(home, 'kids', name);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'cotutor.json'), typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
    return { name, label: name, file: name, args: [], root, logDir: join(home, 'logs', name) };
  };
  const { resolvePaths } = await import('../src/app/workspace.ts');
  const resolved = (r: string, paths: Record<string, string>): string => resolvePaths(r, paths).vault;
  const tilde = ws('ming', { kid: { slug: 'ming', name: '小明' }, server: { port: 8443 }, paths: { vault: '~/cotutor/ming-vault' } });
  const rel = ws('hong', { kid: { slug: 'hong' }, paths: { vault: '../hong-notes' } });
  const old = ws('lan', { kid: { slug: 'lan' }, paths: {} });
  const bad = ws('su', '{ 坏');
  const [a, b, c, d] = await Promise.all([tilde, rel, old, bad].map((s) => t.inspectService(s)));
  check('inspectService:~/ 展开到家目录,名字和端口照读', a.vault === join(home, 'cotutor', 'ming-vault') && a.kid === '小明' && a.port === 8443, JSON.stringify(a));
  check('inspectService:相对的相对 workspace 根;没写就是根(旧版的布局);读不了也是根', b.vault === join(home, 'kids', 'hong-notes') && c.vault === old.root && d.vault === bad.root && d.kid === 'su', JSON.stringify({ b, c, d }));
  check('inspectService 和 resolvePaths 算的 vault 一样', a.vault === resolved(tilde.root, { vault: '~/cotutor/ming-vault' }) && b.vault === resolved(rel.root, { vault: '../hong-notes' }) && c.vault === resolved(old.root, {}));
}

// ---- 跑了多久 ----
check('跑了多久', t.uptimeText(NOW - 10 * 60_000, NOW) === '不到 1 小时' && t.uptimeText(NOW - 5 * 3600_000, NOW) === '5 小时' && t.uptimeText(NOW - 3 * 86400_000, NOW) === '3 天');

// ---- 有事要处理 ----
{
  const texts = (h: Partial<Health>, platform: NodeJS.Platform = 'darwin') => t.issuesOf(probe({ health: healthy(h) }), { platform, version: VERSION });
  check('都好:没事', texts({}).length === 0);
  check('读不到 vault(Mac):开隐私设置的完全磁盘访问', texts({ vault: 'denied' })[0].text.includes('磁盘权限') && JSON.stringify(texts({ vault: 'denied' })[0].fix).includes('Privacy_AllFiles'));
  check('读不到 vault(Windows):开 vault 那个目录,不是孩子的文件夹(2026-11-09 起两边分开)', texts({ vault: 'denied' }, 'win32')[0].text.includes('权限') && (texts({ vault: 'denied' }, 'win32')[0].fix as { target: string }).target === '/w/ray-vault');
  check('vault 不在、配置写坏了:开孩子的文件夹(改 cotutor.json 在那)', (texts({ vault: 'missing' }, 'win32')[0].fix as { target: string }).target === '/w/ray' && (texts({ configError: 'bad json' }, 'win32')[0].fix as { target: string }).target === '/w/ray');
  check('vault 不在', texts({ vault: 'missing' })[0].text.includes('不在了'));
  check('配置写坏了', texts({ configError: 'bad json' })[0].text.includes('写坏了'));
  check('没填百炼:开家长端,地址里不写 443', texts({ bailian: false })[0].text.includes('百炼') && (texts({ bailian: false })[0].fix as { target: string }).target === 'https://localhost/parent/home');
  check('版本不对:修法是重启', texts({ version: '0.2.0' })[0].text.includes('0.2.0') && texts({ version: '0.2.0' })[0].fix.kind === 'restart');
  check('几件事一起:都算', texts({ vault: 'denied', bailian: false }).length === 2);
  const trouble = { kind: 'money', message: '百炼欠费或没开通按量付费', fix: '到百炼控制台充值' };
  check('配好了但跑起来坏了(欠费):有事,开家长端', texts({ bailianTrouble: trouble })[0].text === trouble.message && (texts({ bailianTrouble: trouble })[0].fix as { target: string }).target.endsWith('/parent/home'));
  check('还没配就不说坏了:只说没配', texts({ bailian: false, bailianTrouble: trouble }).length === 1 && texts({ bailian: false, bailianTrouble: trouble })[0].text.includes('还没填'));
  check('服务没答应:不算有事(是另一种状态)', t.issuesOf(probe({ health: null }), { platform: 'darwin', version: VERSION }).length === 0);
}

// ---- 状态与通知 ----
{
  const m = model();
  const a = m.update([probe({ health: null })], NOW);
  check('刚起来问不到:正在启动,不通知', a.rows[0].level === 'starting' && a.notes.length === 0, JSON.stringify(a));
  const b = m.update([probe()], NOW + 5000);
  check('答应了:正常,不通知;第二行是跑了多久与版本', b.rows[0].level === 'ok' && b.notes.length === 0 && b.rows[0].detail === '已运行 3 天 · 版本 0.3.0' && b.rows[0].url === 'https://localhost/parent/home', JSON.stringify(b.rows[0]));
  const c = m.update([probe({ health: null })], NOW + 10000);
  check('问不到一次:还算正常(重起一下、网络抖一下不报)', c.rows[0].level === 'ok' && c.notes.length === 0);
  const d = m.update([probe({ health: null })], NOW + 15000);
  check('连着两次:没在跑,通知一次', d.rows[0].level === 'bad' && d.notes.length === 1 && d.notes[0].title === 'cotutor 后台服务没在跑' && d.notes[0].body.includes('孩子的平板现在打不开') && d.rows[0].url === null, JSON.stringify(d));
  const e = m.update([probe({ health: null, holder: 'nginx' })], NOW + 20000);
  check('还没在跑:不再通知;说得出谁占着端口', e.notes.length === 0 && e.rows[0].detail === '端口 443 被占着:nginx 在用');
  const f = m.update([probe()], NOW + 25000);
  check('恢复了:不打扰', f.rows[0].level === 'ok' && f.notes.length === 0);
  const g = m.update([probe({ health: healthy({ vault: 'denied' }) })], NOW + 30000);
  check('正常变成有事:通知一次,说是什么事', g.rows[0].level === 'warn' && g.notes.length === 1 && g.notes[0].title === 'cotutor 有 1 件事要处理' && g.notes[0].body.includes('读不到 vault') && g.rows[0].issues === 1);
  const h = m.update([probe({ health: healthy({ vault: 'denied' }) })], NOW + 35000);
  check('还是那件事:不再通知', h.notes.length === 0);
  m.update([probe({ health: null })], NOW + 40000);
  const i = m.update([probe({ health: null })], NOW + 45000);
  check('有事变成没在跑:再通知一次', i.rows[0].level === 'bad' && i.notes.length === 1);
}
{
  const m = model();
  const a = m.update([probe({ health: healthy({ bailian: false }) })], NOW);
  check('第一眼看到就有事:不通知(每次登录都弹太烦),菜单里看得到', a.rows[0].level === 'warn' && a.notes.length === 0);
}
{
  const m = model();
  m.update([probe({ health: healthy() })], NOW);
  const trouble = { kind: 'key', message: '百炼的 key 不对或失效了', fix: '换一把' };
  const a = m.update([probe({ health: healthy({ bailianTrouble: trouble }) })], NOW + 5000);
  check('用着用着百炼坏了:通知一次,说是什么事', a.rows[0].level === 'warn' && a.notes.length === 1 && a.notes[0].body.includes(trouble.message), JSON.stringify(a.notes));
  const b = m.update([probe({ health: healthy({ bailianTrouble: trouble }) })], NOW + 10000);
  check('还坏着:不再通知', b.notes.length === 0);
  const c = m.update([probe({ health: healthy() })], NOW + 15000);
  check('好了:图标回正常', c.rows[0].level === 'ok' && c.notes.length === 0);
}
{
  const m = model();
  m.update([probe({ health: null })], NOW);
  const a = m.update([probe({ health: healthy({ bailian: false }) })], NOW + 5000);
  check('启动中变成有事:也不通知', a.rows[0].level === 'warn' && a.notes.length === 0);
}
{
  const m = model();
  for (let at = 0; at < t.TRAY_START_GRACE_MS; at += t.TRAY_POLL_MS) m.update([probe({ health: null })], NOW + at);
  const a = m.update([probe({ health: null })], NOW + t.TRAY_START_GRACE_MS + 1000);
  check('启动等够久还没起来:没在跑,通知', a.rows[0].level === 'bad' && a.notes.length === 1);
}
{
  const m = model();
  m.update([probe()], NOW);
  m.expect('ray', NOW + 5000);
  const a = m.update([probe({ health: null })], NOW + 10000);
  check('点了重启:问不到算正在启动,不通知', a.rows[0].level === 'starting' && a.notes.length === 0);
  const b = m.update([probe()], NOW + 15000);
  check('重启好了:正常,不通知', b.rows[0].level === 'ok' && b.notes.length === 0);
  m.expect('ray', NOW + 20000);
  m.update([probe({ health: null })], NOW + 25000);
  const c = m.update([probe({ health: null })], NOW + 20000 + t.TRAY_RESTART_GRACE_MS + 1000);
  check('重启等够久还没起来:没在跑', c.rows[0].level === 'bad' && c.notes.length === 1);
}
{
  const m = model();
  m.update([probe()], NOW);
  const later = NOW + t.TRAY_WAKE_GAP_MS + 60_000;
  const a = m.update([probe({ health: null })], later);
  const b = m.update([probe({ health: null })], later + 5000);
  check('刚睡醒问不到:先别报,还显示原来的', a.rows[0].level === 'ok' && a.notes.length === 0 && b.rows[0].level === 'ok' && b.notes.length === 0);
  const c = m.update([probe({ health: null })], later + t.TRAY_WAKE_GRACE_MS + 1000);
  check('醒了一阵还问不到:才报', c.rows[0].level === 'bad' && c.notes.length === 1);
}
{
  const m = model();
  const a = m.update([probe({ health: healthy({ mode: 'foreground' }) })], NOW);
  check('在终端里跑的:说清楚', a.rows[0].detail.startsWith('在终端里跑,关了终端就停'));
  const http = model().update([probe({ port: 5180, health: healthy({ scheme: 'http' }) })], NOW);
  check('没证书的:http,带端口', http.rows[0].url === 'http://localhost:5180/parent/home');
  const calls = model().update([probe({ health: healthy({ calls: 2 }) })], NOW);
  check('开着几通电话带上', calls.rows[0].calls === 2);
}
{
  const m = model('win32');
  m.update([probe()], NOW);
  m.update([probe({ health: null })], NOW + 5000);
  const a = m.update([probe({ health: null })], NOW + 10000);
  check('Windows 的通知:点了回不到这里,请家长点图标', a.notes[0].body.endsWith('点任务栏的 cotutor 图标看看'), a.notes[0].body);
  const mac = model();
  mac.update([probe()], NOW);
  mac.update([probe({ health: null })], NOW + 5000);
  check('Mac 的通知:点了回不到这里,请家长点图标', mac.update([probe({ health: null })], NOW + 10000).notes[0].body.endsWith('点菜单栏的 cotutor 图标看看'));
}
{
  const m = model();
  const two = [probe(), probe({ name: 'lan', kid: '小红', root: '/w/lan', port: 8443 })];
  m.update(two, NOW);
  m.update([two[0], { ...two[1], health: null }], NOW + 5000);
  const a = m.update([two[0], { ...two[1], health: null }], NOW + 10000);
  check('两个孩子:只有出事的那个变,通知说是谁', a.rows[0].level === 'ok' && a.rows[1].level === 'bad' && a.notes.length === 1 && a.notes[0].title === '小红的后台服务没在跑', JSON.stringify(a.notes));
  const b = m.update([two[0]], NOW + 15000);
  check('卸了一个:不再算它', b.rows.length === 1);
}

// ---- 显示什么 ----
{
  const words = (s: { menu: { kind: string; title?: string }[] }) => s.menu.map((e) => (e.kind === 'sep' ? '-' : e.title)).join('|');
  const ok = t.trayShow(model().update([probe()], NOW).rows);
  check('正常:只有 logo;菜单照设计图', ok.icon === 'ok' && ok.tip === 'cotutor 正常' && words(ok) === 'cotutor 正常|已运行 3 天 · 版本 0.3.0|-|打开家长端|-|重启服务|看日志|-|退出 cotutor', words(ok));
  const warn = t.trayShow(model().update([probe({ health: healthy({ vault: 'denied' }) })], NOW).rows);
  check('有事:橙点;「看看怎么修」排第一、粗体', warn.icon === 'warn' && words(warn) === '有 1 件事要处理|读不到 vault:要给 node 开磁盘权限|-|看看怎么修|打开家长端|-|重启服务|看日志|-|退出 cotutor' && warn.menu.some((e) => e.kind === 'action' && e.id === 'fix:ray' && e.primary === true), words(warn));
  const down = model();
  down.update([probe()], NOW);
  down.update([probe({ health: null, holder: 'nginx' })], NOW + 5000);
  const bad = t.trayShow(down.update([probe({ health: null, holder: 'nginx' })], NOW + 10000).rows);
  check('没在跑:红点;「启动服务」排第一,没有打开家长端(打不开)', bad.icon === 'bad' && words(bad) === '后台服务没在跑|端口 443 被占着:nginx 在用|-|启动服务|看日志|-|退出 cotutor', words(bad));
  const starting = t.trayShow(model().update([probe({ health: null })], NOW).rows);
  check('正在启动:图标不报警;菜单第一行没有状态点', starting.icon === 'ok' && words(starting) === 'cotutor 正在启动|-|看日志|-|退出 cotutor' && starting.menu[0].kind === 'info' && !('level' in starting.menu[0]), words(starting));
  check('菜单第一行带状态点', ok.menu[0].kind === 'info' && ok.menu[0].level === 'ok' && warn.menu[0].kind === 'info' && warn.menu[0].level === 'warn');
  const two = model();
  two.update([probe(), probe({ name: 'lan', kid: '小红', root: '/w/lan', port: 8443 })], NOW);
  two.update([probe(), probe({ name: 'lan', kid: '小红', root: '/w/lan', port: 8443, health: null })], NOW + 5000);
  const multi = t.trayShow(two.update([probe(), probe({ name: 'lan', kid: '小红', root: '/w/lan', port: 8443, health: null })], NOW + 10000).rows);
  check('两个孩子:一个图标,有一个出事就变;每人一段', multi.icon === 'bad' && multi.tip === '小红 · 没在跑' && words(multi) === 'Ray · 正常|打开家长端|重启服务|看日志|-|小红 · 没在跑|孩子的平板现在打不开|启动服务|看日志|-|退出 cotutor', words(multi));
  check('点了分得清是谁', multi.menu.some((e) => e.kind === 'action' && e.id === 'start:lan') && multi.menu.some((e) => e.kind === 'action' && e.id === 'open:ray'));
}

// ---- 主循环:假显示脚本 ----
interface Run {
  sent: Record<string, unknown>[];
  controls: string[];
  opened: string[];
  notes: string[];
  say(m: Record<string, unknown>): void;
  exitHelper(code: number | null): void;
  spawned(): number;
  result: Promise<number>;
  closed(): boolean;
  setHealth(port: number, h: Health | null): void;
  setServices(n: number): void;
  failControl: Error | null;
  installed: string;
  seen: string | null;
}
function start(o: { services?: number; health?: Health | null; pollMs?: number } = {}): Run {
  const SERVICES = [
    { name: 'ray', label: 'x', file: 'x', args: [], root: '/w/ray', logDir: '/L/ray' },
    { name: 'lan', label: 'y', file: 'y', args: [], root: '/w/lan', logDir: '/L/lan' },
  ];
  let count = o.services ?? 1;
  const healths = new Map<number, Health | null>([[443, o.health === undefined ? healthy() : o.health], [8443, healthy()]]);
  let on: { message(m: { type: string; id?: string; yes?: boolean }): void; exit(code: number | null): void } | null = null;
  let spawned = 0;
  let closed = false;
  const run: Run = {
    sent: [], controls: [], opened: [], notes: [], failControl: null, installed: VERSION, seen: null,
    say(m) { on?.message(m as { type: string }); },
    exitHelper(code) { on?.exit(code); },
    spawned: () => spawned,
    closed: () => closed,
    setHealth(port, h) { healths.set(port, h); },
    setServices(n) { count = n; },
    result: Promise.resolve(0),
  };
  run.result = t.runTray({
    platform: 'darwin',
    version: () => run.installed,
    updateSeen: () => run.seen,
    setUpdateSeen: (v) => { run.seen = v; },
    now: () => Date.now(),
    list: async () => SERVICES.slice(0, count),
    inspect: async (s) => ({ kid: s.name === 'ray' ? 'Ray' : '小红', port: s.name === 'ray' ? 443 : 8443, vault: `${s.root}-vault` }),
    probe: async (port) => healths.get(port) ?? null,
    holder: async () => null,
    control: async (root, what) => { run.controls.push(`${what} ${root}`); if (run.failControl) throw run.failControl; },
    open: (target) => { run.opened.push(target); },
    spawnHelper: (handlers) => {
      spawned++;
      on = handlers;
      return { send: (m) => { run.sent.push(m as Record<string, unknown>); }, close: () => { closed = true; } };
    },
    note: (text) => { run.notes.push(text); },
    pollMs: o.pollMs ?? 5,
    helperRestartMs: 5,
  });
  return run;
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 2000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (f()) return true; await wait(5); }
  return f();
};
const shows = (r: Run) => r.sent.filter((m) => m.type === 'show');
{
  const r = start();
  r.say({ type: 'ready' });
  check('显示脚本就绪:发一次显示', await until(() => shows(r).length === 1), JSON.stringify(r.sent));
  await wait(40);
  check('状态没变:不重复发(菜单开着时不闪)', shows(r).length === 1, String(shows(r).length));
  r.say({ type: 'click', id: 'open:ray' });
  check('点打开家长端', r.opened.at(-1) === 'https://localhost/parent/home');
  r.say({ type: 'click', id: 'logs:ray' });
  check('点看日志:开日志目录', r.opened.at(-1) === '/L/ray');
  r.say({ type: 'click', id: 'restart:ray' });
  check('点重启服务', await until(() => r.controls.includes('restart /w/ray')));
  r.say({ type: 'click', id: 'no-colon' });
  r.say({ type: 'click', id: 'open:nobody' });
  r.setHealth(443, healthy({ vault: 'denied' }));
  check('状态变了:发新的显示和通知', await until(() => r.sent.some((m) => m.type === 'notify')));
  r.say({ type: 'click', id: 'fix:ray' });
  check('点看看怎么修:开它指的地方', r.opened.at(-1)?.includes('Privacy_AllFiles') === true, r.opened.at(-1));
  r.setHealth(443, healthy({ version: '0.2.0' }));
  await until(() => JSON.stringify(shows(r).at(-1)).includes('0.2.0'));
  const before = r.controls.length;
  r.say({ type: 'click', id: 'fix:ray' });
  check('修法是重启的:点了就重启', await until(() => r.controls.length > before && r.controls.at(-1) === 'restart /w/ray'));
  r.setHealth(443, null);
  r.say({ type: 'click', id: 'quit' });
  check('没开着电话:点退出直接停服务,显示脚本也退', await until(() => r.controls.includes('stop /w/ray') && r.sent.some((m) => m.type === 'quit') && r.closed()));
  r.exitHelper(0);
  check('退出:以 0 退(launchd 不再拉起)', (await r.result) === 0);
}
{
  const r = start({ health: healthy({ calls: 1 }) });
  r.say({ type: 'ready' });
  await until(() => shows(r).length === 1);
  r.say({ type: 'click', id: 'quit' });
  check('开着电话:先问一声,还没停', r.sent.some((m) => m.type === 'confirm' && m.id === 'quit' && String(m.body).includes('挂断')) && r.controls.length === 0, JSON.stringify(r.sent.at(-1)));
  r.say({ type: 'confirm', id: 'quit', yes: false });
  await wait(30);
  check('选先不退出:什么都不动', r.controls.length === 0 && !r.sent.some((m) => m.type === 'quit'));
  r.say({ type: 'click', id: 'quit' });
  r.say({ type: 'confirm', id: 'quit', yes: true });
  check('选退出:停服务', await until(() => r.controls.includes('stop /w/ray')));
  await until(() => r.closed());
  r.exitHelper(0);
  await r.result;
}
{
  const r = start({ services: 2 });
  r.say({ type: 'ready' });
  await until(() => shows(r).length === 1);
  r.say({ type: 'click', id: 'quit' });
  check('两个孩子:退出把两个服务都停了', await until(() => r.controls.includes('stop /w/ray') && r.controls.includes('stop /w/lan')));
  await until(() => r.closed());
  r.exitHelper(0);
  await r.result;
}
{
  const r = start();
  r.say({ type: 'ready' });
  await until(() => shows(r).length === 1);
  r.exitHelper(1);
  check('显示脚本崩了:隔一会儿再起,状态重发', await until(() => r.spawned() === 2));
  r.say({ type: 'ready' });
  check('再起来后再发一次显示', await until(() => shows(r).length === 2), String(shows(r).length));
  r.setServices(0);
  check('服务都卸了:图标退', await until(() => r.sent.some((m) => m.type === 'quit')));
  r.exitHelper(0);
  check('以 0 退', (await r.result) === 0);
}
{
  const r = start();
  r.exitHelper(t.HELPER_NO_SESSION);
  check('没有桌面的会话:不再起,以 0 退', (await r.result) === 0 && r.spawned() === 1);
}
{
  const r = start();
  r.failControl = new Error('launchctl 没成');
  r.say({ type: 'ready' });
  await until(() => shows(r).length === 1);
  r.say({ type: 'click', id: 'restart:ray' });
  check('重启失败:通知,记日志,不崩', await until(() => r.sent.some((m) => m.type === 'notify' && m.title === 'cotutor 没起来') && r.notes.some((n) => n.includes('没成'))));
  r.failControl = null;
  r.say({ type: 'error', message: 'oops' });
  check('显示脚本报错:记日志', r.notes.some((n) => n.includes('oops')));
  r.say({ type: 'click', id: 'quit' });
  await until(() => r.closed());
  r.exitHelper(0);
  await r.result;
}

// ---- 升级:图标进程一直开着,装的版本每轮重读(0.4.0 只读一次:把「都对了」报成要重启,真要重启的反而放过) ----
{
  let installed = '0.4.0';
  const m = new t.TrayModel({ platform: 'darwin', version: () => installed });
  const running = (version: string) => [probe({ health: healthy({ version }) })];
  check('升级前:都是 0.4.0,正常', m.update(running('0.4.0'), NOW).rows[0].level === 'ok');
  installed = '0.4.1';
  const stale = m.update(running('0.4.0'), NOW + 5000).rows[0];
  check('npm 换了新版、服务还跑旧的:提醒重启,版本说对', stale.level === 'warn' && stale.detail === '在跑的是 0.4.0,装的是 0.4.1:重启一下' && stale.fix?.kind === 'restart', stale.detail);
  check('服务也重启了:正常,不误报', m.update(running('0.4.1'), NOW + 10000).rows[0].level === 'ok');
}

// ---- 有新版本:菜单多一行,不算有事;每个版本通知一次 ----
{
  const m = model();
  const a = m.update([probe({ health: healthy({ latest: '9.9.9' }) })], NOW);
  check('有新版本:不出状态点,不发「有事」通知', a.rows[0].level === 'ok' && a.rows[0].update === '9.9.9' && a.notes.length === 0);
  const show = t.trayShow(a.rows);
  const entry = show.menu.find((e) => e.kind === 'action' && e.id === 'update:ray');
  check('菜单:退出前多一行,图标还是正常的', show.icon === 'ok' && entry?.kind === 'action' && entry.title === '有新版本 9.9.9,看怎么升级' && show.menu.at(-1)?.kind === 'action' && show.menu.at(-2)?.kind === 'sep' && show.menu.at(-3) === entry, JSON.stringify(show.menu));
  const plain = t.trayShow(model().update([probe()], NOW).rows);
  check('没有新版本:菜单和原来一样', !plain.menu.some((e) => e.kind === 'action' && e.id.startsWith('update:')));
  const older = model().update([probe({ health: healthy({ latest: '0.0.1' }) })], NOW);
  check('npm 上的更旧(镜像没同步):不提', older.rows[0].update === null);
  // 程序已经换上新版、只差重启:说「要重启」,不再说「有新版本」
  const installed = new t.TrayModel({ platform: 'darwin', version: () => '9.9.9' }).update([probe({ health: healthy({ latest: '9.9.9' }) })], NOW).rows[0];
  check('已经装了新版、只差重启:只说重启', installed.update === null && installed.level === 'warn' && installed.detail.includes('重启'));
  const two = model().update([probe({ health: healthy({ latest: '9.9.9' }) }), probe({ name: 'lan', kid: '小红', port: 8443, health: healthy({ latest: '9.9.9' }) })], NOW);
  check('几个孩子:版本是这台电脑的事,只说一行', t.trayShow(two.rows).menu.filter((e) => e.kind === 'action' && e.id.startsWith('update:')).length === 1);
  check('通知:Mac 说菜单栏,Windows 说任务栏', t.updateNote('9.9.9', 'darwin').title === 'cotutor 有新版本 9.9.9' && t.updateNote('9.9.9', 'darwin').body.includes('菜单栏') && t.updateNote('9.9.9', 'win32').body.includes('任务栏'));

  const r = start({ health: healthy({ latest: '9.9.9' }) });
  const notes = () => r.sent.filter((x) => x.type === 'notify');
  r.say({ type: 'ready' });
  check('第一次看到新版本:通知一次,记下', await until(() => notes().length === 1) && notes()[0].title === 'cotutor 有新版本 9.9.9' && r.seen === '9.9.9', JSON.stringify(r.sent));
  await wait(40);
  check('之后不再通知', notes().length === 1);
  r.say({ type: 'click', id: 'update:ray' });
  check('点那一行:开家长端,升级的命令写在那里', r.opened.at(-1) === 'https://localhost/parent/home', r.opened.at(-1));
  r.setHealth(443, healthy({ latest: '9.9.10' }));
  check('又出了更新的:再通知一次', await until(() => notes().length === 2) && r.seen === '9.9.10');
  r.say({ type: 'click', id: 'quit' });
  await until(() => r.closed());
  r.exitHelper(0);
  await r.result;
  const again = start({ health: healthy({ latest: '9.9.9' }) });
  again.seen = '9.9.9';
  again.say({ type: 'ready' });
  await until(() => shows(again).length > 0);
  await wait(30);
  check('重起以后:通知过的版本不再弹,菜单照样有那一行', again.sent.filter((x) => x.type === 'notify').length === 0 && JSON.stringify(shows(again).at(-1)).includes('有新版本 9.9.9'));
  again.say({ type: 'click', id: 'quit' });
  await until(() => again.closed());
  again.exitHelper(0);
  await again.result;
}

// ---- 登录项 ----
const fakeHost = (platform: NodeJS.Platform, h: string, fail: Record<string, number> = {}) => {
  const calls: string[] = [];
  let loaded = false;
  const host: import('../src/app/cli/service.ts').ServiceHost = {
    platform, home: h, uid: 501, env: { PATH: '/opt/homebrew/bin:/usr/bin', LOCALAPPDATA: join(h, 'Local'), SystemRoot: 'C:\\Windows' },
    run: async (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`);
      if (cmd === 'launchctl' && args[0] === 'bootstrap' && !fail[cmd]) loaded = true;
      if (cmd === 'launchctl' && args[0] === 'bootout') loaded = false;
      // print 跟着装没装走:卸下时等的就是它不再答应
      const code = cmd === 'launchctl' && args[0] === 'print' && !loaded ? 1 : fail[cmd] ?? 0;
      return { code, stdout: cmd === 'powershell.exe' ? '[]' : '', stderr: code ? 'nope' : '' };
    },
  };
  return { host, calls };
};
{
  const h = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-tray-mac-')));
  const { host, calls } = fakeHost('darwin', h);
  check('放哪(macOS):Application Support', t.trayDir(host) === join(h, 'Library', 'Application Support', 'cotutor', 'tray'));
  check('支持的系统:没做 Linux', t.traySupported('darwin') && t.traySupported('win32') && !t.traySupported('linux'));
  const r = await t.installTray(host, { node: '/n o/node', bin: '/p/bin/cotutor.js' });
  const plist = readFileSync(r.file, 'utf8');
  check('plist:参数读回来一字不差', JSON.stringify(svc.serviceArgs(plist)) === JSON.stringify(['/n o/node', '/p/bin/cotutor.js', 'tray', 'run', '--dir', t.trayDir(host)]), plist);
  check('plist:登录就起、崩了拉起、以 0 退不拉、只在有桌面时起', plist.includes('<key>RunAtLoad</key><true/>') && /<key>SuccessfulExit<\/key><false\/>/.test(plist) && plist.includes('<string>Aqua</string>') && plist.includes('/opt/homebrew/bin'));
  check('装:先卸旧的再 bootstrap', calls[0] === `launchctl bootout gui/501/${t.TRAY_LABEL}` && calls.includes(`launchctl bootstrap gui/501 ${r.file}`) && calls.indexOf(`launchctl bootstrap gui/501 ${r.file}`) > 0 && r.started, calls.join(' | '));
  check('图标的登录项不会被当成后台服务', (await svc.listServices(host)).length === 0);
  const st = await t.trayStatus(host);
  check('状态:装了', st.supported && st.installed && !st.off);
  // 2026-11-07 真机:没有 detached 时,cotutor open 退出码 0、地址也打印了,Windows 上浏览器却收不到请求
  for (const pf of ['win32', 'darwin', 'linux'] as const) { const c = t.openCommand(pf, 'http://x/'); check(`打开地址:${pf} 上 detached(命令马上退也打得开)、windowsHide(不弹黑窗口)`, c.options.detached === true && c.options.windowsHide === true && c.args.includes('http://x/'), JSON.stringify(c)); }
  check('service install 跟着装:起来了', (await t.ensureTray(host)) === 'started');
  check('家长没关:卸掉服务后撤掉图标,不算家长说不要', (await t.dropTrayIfNoServices(host)) === true && !existsSync(r.file) && !(await t.trayStatus(host)).off);
  await t.installTray(host);
  check('tray off:卸掉并记住', (await t.removeTray(host, { remember: true })) === true && (await t.trayStatus(host)).off && !existsSync(r.file));
  check('记住了:service install 不再带上', (await t.ensureTray(host)) === 'off' && !existsSync(r.file));
  await t.installTray(host);
  check('tray on:清掉记号', !(await t.trayStatus(host)).off && existsSync(r.file));
  const before = calls.length;
  check('service restart 时:装着图标就换上新代码', (await t.refreshTray(host)) === true && calls.slice(before).includes(`launchctl bootstrap gui/501 ${r.file}`), calls.slice(before).join(' | '));
  await t.removeTray(host);
  const after = calls.length;
  check('没开图标(--no-tray):不动,不装回来', (await t.refreshTray(host)) === false && !calls.slice(after).some((c) => c.includes('bootstrap')) && !existsSync(r.file));
  await t.installTray(host);
  // 还有别的服务在:不撤
  mkdirSync(join(h, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(join(h, 'Library', 'LaunchAgents', 'com.tarslab.cotutor.ray.plist'), svc.launchdPlist({ name: 'ray', label: 'com.tarslab.cotutor.ray', root: '/w/ray', logDir: '/L/ray', path: '/usr/bin', args: ['/n', '/b', 'serve', '--workspace', '/w/ray', '--log-dir', '/L/ray'] }));
  check('还有别的服务:不撤图标', (await t.dropTrayIfNoServices(host)) === false && existsSync(r.file));
  const failing = fakeHost('darwin', h, { launchctl: 1 });
  check('这个会话起不来(没有桌面):登录项还是写好,下次登录出现', (await t.ensureTray(failing.host)) === 'later');
}
{
  const h = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-tray-win-')));
  const { host, calls } = fakeHost('win32', h);
  check('放哪(Windows):LOCALAPPDATA', t.trayDir(host) === join(h, 'Local', 'cotutor', 'tray'));
  const r = await t.installTray(host, { node: 'C:\\Program Files\\nodejs\\node.exe', bin: 'C:\\p\\cotutor.js' });
  const text = decodeServiceFile(readFileSync(r.file));
  check('启动器:UTF-16,藏着窗口起 tray run,带上这个用户自己的目录', readFileSync(r.file)[0] === 0xff && text.includes(', 0, false)') && text.includes('tray run --dir') && text.includes('Program Files'), text);
  check('Run 项:单独一条,不和服务撞', calls.some((c) => c.startsWith('reg.exe add') && c.includes('/v cotutorTray')));
  check('任务管理器里关掉过的记号去掉', calls.some((c) => c.startsWith('reg.exe delete') && c.includes('StartupApproved') && c.includes('cotutorTray')));
  check('起:wscript 跑启动器', calls.some((c) => c.includes('wscript.exe //B //Nologo') && c.endsWith(r.file)));
  check('图标的启动器不会被当成后台服务', (await svc.listServices(host)).length === 0);
  calls.length = 0;
  await t.removeTray(host);
  check('卸:Run 项、通知的应用 ID 都清掉', calls.some((c) => c.includes(`delete ${'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'}`) && c.includes('cotutorTray')) && calls.some((c) => c.includes('AppUserModelId') && c.includes(t.TRAY_AUMID)) && !existsSync(r.file), calls.join('\n'));
  check('找进程:按这个用户自己的目录,别的账户的不动', findTrayScript("C:\\a'b\\tray").includes("'C:\\a''b\\tray'") && findTrayScript('x').includes(' tray run '));
  check('启动器文本', trayLauncher('"a b" c').includes(JSON.stringify('"a b" c')) && encodeLauncher(trayLauncher('x'))[1] === 0xfe);
}
{
  const { host } = fakeHost('linux', '/h');
  check('Linux:不装,不报错', (await t.ensureTray(host)) === 'unsupported' && (await t.dropTrayIfNoServices(host)) === false && !(await t.trayStatus(host)).supported);
}

// ---- 文件 ----
{
  const isPng = (b: Buffer): boolean => b.subarray(1, 4).toString() === 'PNG';
  const side = (b: Buffer): number => b.readUInt32BE(16);
  const mac = icons.macTrayIcons();
  check('Mac 的图标:logo 与状态点 18 pt @2x,菜单小圆点三个', Object.keys(mac).sort().join() === 'dot-bad.png,dot-ok.png,dot-warn.png,dotmark.png,logo.png' && isPng(mac['logo.png']) && side(mac['logo.png']) === 36 && side(mac['dotmark.png']) === 36);
  const win = icons.windowsTrayIcons();
  check('Windows 的图标:白、墨 × 三种状态 × 六档尺寸,加三个小圆点', Object.keys(win).length === 2 * 3 * 6 + 3 && isPng(win['white-bad-16.png']) && side(win['ink-ok-48.png']) === 48);
  check('有状态点的和没状态点的画得不一样;没在跑的和要处理的也不一样', !win['white-ok-16.png'].equals(win['white-warn-16.png']) && !win['white-warn-16.png'].equals(win['white-bad-16.png']));
  check('深浅两套不一样', !win['white-ok-16.png'].equals(win['ink-ok-16.png']));
  const dir = join(home, 'files');
  const macFile = await t.writeTrayFiles('darwin', join(dir, 'mac'));
  check('写显示脚本与图标(macOS)', readFileSync(macFile, 'utf8') === MAC_TRAY_SCRIPT && existsSync(join(dir, 'mac', 'icons', 'logo.png')));
  const winFile = await t.writeTrayFiles('win32', join(dir, 'win'));
  const ps = readFileSync(winFile);
  check('写显示脚本(Windows):UTF-8 带 BOM,不然中文按系统代码页读', ps[0] === 0xef && ps[1] === 0xbb && ps.subarray(3).toString('utf8') === WINDOWS_TRAY_SCRIPT);
  check('图标写一次就够,再起不用重画', existsSync(join(dir, 'win', 'icons', 'v1')) && readdirSync(join(dir, 'win', 'icons')).length === Object.keys(win).length + 1);
  await t.writeTrayFiles('win32', join(dir, 'win'));
}
{
  let parsed = true;
  try { new Script(`(function(){${MAC_TRAY_SCRIPT}})`); } catch { parsed = false; }
  check('Mac 的显示脚本:语法对(模板字符串没吃掉反斜杠)', parsed && MAC_TRAY_SCRIPT.includes("+ '\\n'") && MAC_TRAY_SCRIPT.includes("split('\\n')"));
  check('两边的显示脚本都讲同一套协议', ['ready', 'click', 'confirm', 'state'].every((w) => MAC_TRAY_SCRIPT.includes(`type: '${w}'`) && WINDOWS_TRAY_SCRIPT.includes(`type = '${w}'`)));
  check('两边都处理这些消息', ['show', 'notify', 'confirm', 'quit', 'inspect', 'press'].every((w) => MAC_TRAY_SCRIPT.includes(`m.type === '${w}'`) && WINDOWS_TRAY_SCRIPT.includes(`'${w}' {`)));
  check('弹窗的答案先转数字(JXA 返回的整数是字符串,不转的话点退出也算不退出)', MAC_TRAY_SCRIPT.includes('Number(a.runModal) === 1001'));
  check('stdin 断了就退', MAC_TRAY_SCRIPT.includes('Number(data.length) === 0') && WINDOWS_TRAY_SCRIPT.includes('$null -eq $line'));
  check('Windows 的:路径里的反斜杠还在、应用 ID 填进去了、深浅看任务栏那个值', WINDOWS_TRAY_SCRIPT.includes('\\icons\\') && WINDOWS_TRAY_SCRIPT.includes(`'${t.TRAY_AUMID}'`) && WINDOWS_TRAY_SCRIPT.includes('SystemUsesLightTheme') && !WINDOWS_TRAY_SCRIPT.includes('AppsUseLightTheme'));
  check('Windows 的:没有桌面的会话以约定的码退', WINDOWS_TRAY_SCRIPT.includes(`exit ${t.HELPER_NO_SESSION}`));
}

// ---- 轻 ----
{
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(/^(?:import|export)\s[^;]*?from\s+'([^']+)'/gm)) {
      if (m[1].startsWith('.')) walk(resolve(dirname(file), m[1]));
      else if (!m[1].startsWith('node:')) seen.add(`pkg:${m[1]}`);
    }
  };
  walk(join(root, 'src/app/cli/tray-run.ts'));
  const heavy = [...seen].filter((f) => f.startsWith('pkg:') || f.includes('/schema/') || f.endsWith('/workspace.ts') || f.endsWith('/main.ts') || f.endsWith('/app.ts'));
  check('托盘入口不带 zod、workspace、main:常驻进程要轻', heavy.length === 0, heavy.join(' '));
}

// ---- 真的 serve:健康接口带上开着几通电话 ----
{
  // 没填百炼时通话一连上就结束,开不住:接假百炼(要在 serve 加载之前设,ws 路由加载时读)
  const { startFakeRealtime } = await import('./_fake-realtime.ts');
  const fake = await startFakeRealtime();
  process.env.COTUTOR_LIVE_ENDPOINT = fake.endpoint;
  const { initWorkspace } = await import('../src/app/cli/init.ts');
  const { serveWorkspace } = await import('../src/app/cli/serve.ts');
  const net = await import('node:net');
  const port = await new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });
  const { root } = await initWorkspace({ slug: 'calls', dir: join(home, 'calls'), port });
  const r = await serveWorkspace({ workspace: root, http: true, awake: false });
  const first = await svc.probeHealth(port);
  check('健康接口:没开电话是 0;问到的是 http;假百炼算配好了', first?.calls === 0 && first.scheme === 'http' && first.bailian === true, JSON.stringify(first));
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live/math-tutor/ws`);
  await new Promise<void>((res) => { ws.addEventListener('open', () => res(), { once: true }); ws.addEventListener('error', () => res(), { once: true }); });
  let during = -1;
  for (let i = 0; i < 40 && during !== 1; i++) { during = (await svc.probeHealth(port))?.calls ?? -1; if (during !== 1) await wait(50); }
  check('开着一通:健康接口说 1(退出前要问一声靠它)', during === 1, String(during));
  ws.close();
  let after = -1;
  for (let i = 0; i < 100 && after !== 0; i++) { after = (await svc.probeHealth(port))?.calls ?? -1; if (after !== 0) await wait(50); }
  check('挂了:回到 0', after === 0, String(after));
  (r.server as import('node:http').Server).closeAllConnections?.();
  r.server.close();
  delete process.env.COTUTOR_LIVE_ENDPOINT;
}

// ---- 命令行 ----
{
  const bin = fileURLToPath(new URL('../bin/cotutor.js', import.meta.url));
  const cli = (args: string[]): Promise<{ code: number; out: string }> => new Promise((res) => {
    execFile(process.execPath, [bin, ...args], { env: { ...process.env, HOME: home }, timeout: 30_000 }, (err, stdout, stderr) => res({ code: err ? Number((err as { code?: unknown }).code ?? 1) : 0, out: stdout + stderr }));
  });
  const bad = await cli(['tray', 'nope']);
  check('不认的子命令:用法错', bad.code === 2 && bad.out.includes('on / off / status'), bad.out.slice(0, 200));
  const sb = await cli(['tray', 'status', '--sandbox']);
  check('--sandbox 没有意义', sb.code === 2 && sb.out.includes('不用 workspace'), sb.out.slice(0, 200));
  if (t.traySupported(process.platform)) {
    const st = await cli(['tray', 'status']);
    check('状态:没开就说没开', st.code === 0 && st.out.includes('没开') && st.out.includes('cotutor tray on'), st.out);
  }
}

done();
