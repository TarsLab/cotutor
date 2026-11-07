/** 新版本提醒:比较、问 npm(不通就静默)、一天只问一次、关得掉;health、doctor、家长端拿到;孩子端不说。全程假 fetch,不上网。 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-update-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { UPGRADE_STEPS, isNewer, isPlainVersion, upgradeSteps } = await import('../src/shared/upgrade.ts');
const update = await import('../src/app/machine/update.ts');
const { BUILD } = await import('../src/app/build.ts');

// ---- 比较 ----
check('新:补丁、次版本、主版本', isNewer('0.4.1', '0.4.0') && isNewer('0.5.0', '0.4.9') && isNewer('1.0.0', '0.9.9'));
check('按数字比,不按字符串比', isNewer('0.10.0', '0.9.0') && !isNewer('0.9.0', '0.10.0'));
check('一样、更旧:不算新', !isNewer('0.4.0', '0.4.0') && !isNewer('0.3.9', '0.4.0'));
check('预发布不算,宁可不提醒', !isNewer('0.5.0-beta.1', '0.4.0') && !isPlainVersion('0.5.0-beta.1'));
check('不是版本号(网上来的,要显示给家长):不认', !isNewer('<img src=x>', '0.4.0') && !isNewer('9.9.9', null) && !isNewer(undefined, '0.4.0') && !isPlainVersion('1.2.3\n<b>') && !isPlainVersion(`${'9'.repeat(40)}.0.0`));

// ---- 问 npm ----
const answers = (map: Record<string, unknown>) => {
  const asked: string[] = [];
  const f = (async (url: string | URL | Request) => {
    const u = String(url);
    asked.push(u);
    const a = map[u];
    if (a === undefined) throw new Error('offline');
    if (typeof a === 'number') return new Response('nope', { status: a });
    return new Response(JSON.stringify(a), { status: 200 });
  }) as typeof fetch;
  return { f, asked };
};
const [NPM, MIRROR] = update.UPDATE_URLS;
{
  const a = answers({ [NPM]: { version: '0.5.0' } });
  check('npm 答了:用它,不再问镜像', await update.fetchLatest(a.f) === '0.5.0' && a.asked.length === 1, a.asked.join());
  const b = answers({ [MIRROR]: { version: '0.5.0' } });
  check('npm 不通(被墙):问镜像', await update.fetchLatest(b.f) === '0.5.0' && b.asked.length === 2);
  const c = answers({ [NPM]: 503, [MIRROR]: { version: 'garbage' } });
  check('都没给出能用的:null,不抛', await update.fetchLatest(c.f) === null);
  check('都不通:null,不抛', await update.fetchLatest(answers({}).f) === null);
  check('只问 cotutor 的 latest,URL 里不带别的', update.UPDATE_URLS.every((u) => u.endsWith('/cotutor/latest')));
}

// ---- 一天只问一次、存下来、关得掉 ----
{
  const file = join(home, 'u1.json');
  const T = Date.parse('2026-11-07T00:00:00Z');
  const a = answers({ [NPM]: { version: '0.5.0' } });
  check('第一次:问了,存下', await update.refreshLatest({ file, now: T, fetch: a.f }) === '0.5.0' && a.asked.length === 1 && JSON.parse(readFileSync(file, 'utf8')).latest === '0.5.0');
  check('不到一天:不再问,用存的', await update.refreshLatest({ file, now: T + 23 * 3600_000, fetch: a.f }) === '0.5.0' && a.asked.length === 1);
  check('过了一天:再问', await update.refreshLatest({ file, now: T + 25 * 3600_000, fetch: a.f }) === '0.5.0' && a.asked.length === 2);
  const off = answers({});
  check('问不到:继续用上次的,不写文件(下个小时再问)', await update.refreshLatest({ file, now: T + 60 * 3600_000, fetch: off.f }) === '0.5.0' && off.asked.length === 2 && Date.parse(JSON.parse(readFileSync(file, 'utf8')).checkedAt) === T + 25 * 3600_000);
  check('进程里也记着', update.knownLatest() === '0.5.0');
  const back = answers({ [NPM]: { version: '0.6.0' } });
  check('系统时间改过(存的时间在将来):算不新鲜,再问', await update.refreshLatest({ file, now: T - 3600_000, fetch: back.f }) === '0.6.0' && back.asked.length === 1);

  const offFile = join(home, 'u2.json');
  writeFileSync(offFile, '{"off": true, "latest": "9.9.9"}');
  const none = answers({ [NPM]: { version: '9.9.9' } });
  check('家长关了:不问、不提醒', await update.refreshLatest({ file: offFile, now: T, fetch: none.f }) === null && none.asked.length === 0 && update.knownLatest() === null);

  const bad = join(home, 'u3.json');
  writeFileSync(bad, 'not json');
  check('文件写坏了:当没问过,不抛', Object.keys(await update.readUpdateRecord(bad)).length === 0);
  writeFileSync(bad, JSON.stringify({ checkedAt: new Date(T).toISOString(), latest: '<script>' }));
  check('文件里不是版本号:不认', (await update.readUpdateRecord(bad)).latest === undefined);
  const ro = join(home, 'no', 'such', 'dir', 'u.json');
  mkdirSync(join(home, 'no'), { recursive: true });
  writeFileSync(join(home, 'no', 'such'), 'file');
  const w = answers({ [NPM]: { version: '0.7.0' } });
  check('写不了文件:照样知道新版本,不抛', await update.refreshLatest({ file: ro, now: T, fetch: w.f }) === '0.7.0' && !existsSync(ro));
}

// ---- 定时:先用存的,一分钟后才上网;定时器不拦进程退出(能退说明 unref 了) ----
{
  const file = join(home, 'u4.json');
  writeFileSync(file, JSON.stringify({ checkedAt: new Date().toISOString(), latest: '0.8.0' }));
  const a = answers({ [NPM]: { version: '0.9.0' } });
  const stop = update.startUpdateChecks({ file, fetch: a.f, firstMs: 60_000, everyMs: 60_000 });
  await new Promise((r) => setTimeout(r, 30));
  check('起来时:用存的那份,还没上网', update.knownLatest() === '0.8.0' && a.asked.length === 0);
  stop();
  const b = answers({ [NPM]: { version: '0.9.0' } });
  const stale = join(home, 'u5.json');
  const stop2 = update.startUpdateChecks({ file: stale, fetch: b.f, firstMs: 5, everyMs: 60_000 });
  await new Promise((r) => setTimeout(r, 60));
  stop2();
  check('到点问一次', b.asked.length === 1 && update.knownLatest() === '0.9.0');
}

// ---- health / doctor / 页面 ----
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
const { doctorWorkspace } = await import('../src/app/cli/doctor.ts');
const { PARENT_HOME_PAGE } = await import('../src/ui/parent/parent-home-page.ts');
const wsRoot = join(home, 'cotutor', 'kid');
await initWorkspace({ slug: 'kid', dir: wsRoot });
{
  const ctx = createContext(loadWorkspace(wsRoot));
  const health = async () => (await route('GET', '/api/health', ctx)).json as { latest: string | null; version: string };
  const set = async (latest: string): Promise<void> => {
    const file = join(home, 'h.json');
    writeFileSync(file, JSON.stringify({ checkedAt: new Date().toISOString(), latest }));
    await update.refreshLatest({ file });
  };
  await set('99.0.0');
  check('health:比在跑的新才带 latest', (await health()).latest === '99.0.0', JSON.stringify(await health()));
  await set(BUILD.version as string);
  check('health:一样 → null', (await health()).latest === null);
  await set('0.0.1');
  check('health:更旧(镜像还没同步)→ null', (await health()).latest === null);

  const kid = await route('GET', '/', ctx);
  check('孩子端不说新版本', typeof kid.html === 'string' && !kid.html.includes('updatebar') && !kid.html.includes('有新版本') && !kid.html.includes('npm i -g'));
  check('家长端首页说:走 /api/health、给升级步骤、知道了就这个版本不再提', PARENT_HOME_PAGE.includes('id="updatebar"') && PARENT_HOME_PAGE.includes("'/api/health'") && upgradeSteps().every((s) => PARENT_HOME_PAGE.includes(s)) && PARENT_HOME_PAGE.includes('cotutor.updateSeen'));

  // 2026-11-07 真机看到过:join 的换行符被当成文字,家长看到的是一行 npm i -g cotutor\ncotutor upgrade…。每条单独一行就不靠转义了
  const script = PARENT_HOME_PAGE.slice(PARENT_HOME_PAGE.indexOf('const showUpdate'), PARENT_HOME_PAGE.indexOf('const load = async'));
  check('提示条:每条命令单独一行,不靠换行符转义', script.includes('UPGRADE_STEPS.map') && !script.includes('.join('), script);

  const by = async () => (await doctorWorkspace(wsRoot, { probeEnv: false })).checks.find((c) => c.name === 'update');
  check('doctor:没问过 → 不提', (await by()) === undefined);
  const cfg = join(home, '.config', 'cotutor');
  mkdirSync(cfg, { recursive: true });
  writeFileSync(join(cfg, 'update.json'), JSON.stringify({ checkedAt: new Date().toISOString(), latest: '99.0.0' }));
  const c = await by();
  check('doctor:有新版本 → 不算错,给步骤,要人定(升级要重起),没有 cmd', c?.ok === false && c.required === false && c.human === true && !c.cmd && upgradeSteps().every((s) => c.fix?.includes(s)), JSON.stringify(c));
  writeFileSync(join(cfg, 'update.json'), '{"off": true, "latest": "99.0.0"}');
  check('doctor:家长关了 → 不提', (await by()) === undefined);
}

// ---- 升级步骤:命令要在 USAGE 里,README 要写全;不用 && ----
{
  const { USAGE } = await import('../src/app/cli/usage.ts');
  const readme = readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('## 数据与升级'), readme.indexOf('### 旧 workspace 换运行时'));
  check('升级步骤都写进 README 的「数据与升级」', UPGRADE_STEPS.every((s) => section.includes(s)), section);
  check('cotutor 的步骤在 USAGE 里', UPGRADE_STEPS.filter((s) => s.startsWith('cotutor ')).every((s) => USAGE.includes(s.split(' ').slice(0, 2).join(' '))));
  check('步骤里没有 &&(Windows 的 PowerShell 5.1 不认)', UPGRADE_STEPS.every((s) => !s.includes('&&')));
  // 2026-11-07 真机:新电脑的 PowerShell 拦 npm.ps1、cotutor.ps1,照提示升级第一条就报错
  check('Windows 给 .cmd:PowerShell 和 cmd.exe 都能跑', upgradeSteps('win32').join(' ; ') === 'npm.cmd i -g cotutor ; cotutor.cmd upgrade ; cotutor.cmd service restart', upgradeSteps('win32').join(' ; '));
  check('Mac、Linux 原样', upgradeSteps('darwin').join() === UPGRADE_STEPS.join() && upgradeSteps('linux').join() === UPGRADE_STEPS.join());
  check('README 说了 Windows 要带 .cmd', section.includes('npm.cmd') && section.includes('cotutor.cmd'));
  check('README 说了怎么关、只发普通请求、不自动升级', section.includes('"off": true') && section.includes('不带孩子') && section.includes('不会自动升级'));
}

done();
