/**
 * 诊断信息(src/app/cli/report.ts):要发给别人的。最要紧的是什么不能在里面:孩子说的话、名字、key、业务空间、IP、用户名。
 * 也要有用:版本、系统、服务状态、体检没过的、报错原因。真写一份带孩子的话和 key 的 workspace 来查。
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-report-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
delete process.env.COTUTOR_LIVE_ENDPOINT;

const { scrub, buildReport } = await import('../src/app/cli/report.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
const { writeIndex } = await import('../src/runtime/journal/store.ts');
const { recordKidLog } = await import('../src/runtime/journal/kid-log.ts');
const { BUILD } = await import('../src/app/build.ts');
const { computerName } = await import('../src/app/cli/serve.ts');
const { PARENT_SETTINGS_PAGE } = await import('../src/ui/parent/parent-settings-page.ts');
const { localDate } = await import('../src/shared/time.ts');

// ---- 抹 ----
{
  const out = scrub(`key sk-abc123def456 at /x ${home}/cotutor/小明 小明的老师们 192.168.1.20 127.0.0.1 llm-abc 小`, ['小明', '小明的老师们', 'llm-abc', '小']);
  check('key、家目录、名字、业务空间、局域网 IP 都抹掉', !out.includes('sk-abc') && !out.includes(home) && !out.includes('小明') && !out.includes('llm-abc') && !out.includes('192.168'), out);
  check('127.0.0.1 留着(说明问题用)', out.includes('127.0.0.1'));
  check('长的先抹(不留下半截)', !out.includes('的老师们'), out);
  check('一个字的小名不抹(不然满篇都被换掉)', out.includes(' 小'), out);
}

const KID_WORDS = 'ZQ孩子说的秘密话';
const KEY = 'sk-realrealrealrealrealreal1234';
const SPACE = 'llm-zqspace';
const NAME = '小明同学';
const { root } = await initWorkspace({ slug: 'zqming', name: NAME, grade: 2 });
mkdirSync(join(home, '.config', 'cotutor'), { recursive: true });
writeFileSync(join(home, '.config', 'cotutor', 'bailian.json'), JSON.stringify({ apiKey: KEY, workspaceId: SPACE }));
const now = new Date();
const today = localDate(now);
const ws = loadWorkspace(root);
await writeIndex(ws, {
  tutor: 'math-tutor', date: today,
  messages: [
    { job: 'j1', from: 'kid', at: now.toISOString(), text: KID_WORDS, result: 'error', error: 'api:HTTP 400 Arrearage', kidText: KID_WORDS },
    { job: 'j2', from: 'kid', at: now.toISOString(), text: KID_WORDS, result: 'ok', kidText: KID_WORDS },
  ],
} as never);
await recordKidLog(ws, { k: 'error', page: 'kid', mode: 'kid', v: '1', msg: 'Cannot read x', where: 'kid.js:1', stack: `at f ${KID_WORDS}`, ua: 'iPad', ctx: { said: KID_WORDS } } as never, { device: 'abc', ip: '192.168.1.77' }, now);
writeFileSync(join(root, '孩子.md'), `---\ncotutor: profile\nnickname: ${NAME}\nschool_start: 2025-09\n---\n${KID_WORDS}\n`);

const text = await buildReport(ws, { now, health: { version: BUILD.version, started: now.toISOString(), mode: 'service', scheme: 'https', bailianTrouble: { kind: 'money', message: 'x', fix: 'y', why: 'Arrearage' } } });

check('有用:版本、系统、Node、服务状态', text.includes(String(BUILD.version)) && text.includes(process.version) && text.includes('后台服务') && text.includes('百炼故障:money(Arrearage)'), text);
check('有用:最近没成的那一轮的原因', text.includes('api:HTTP 400 Arrearage') && text.includes('math-tutor'), text);
check('有用:孩子端页面的报错', text.includes('Cannot read x') && text.includes('kid.js:1'), text);
check('有用:体检没过的', text.includes('## 体检没过的'), text);
check('不能有:孩子说的话(对话、报错的 stack、ctx)', !text.includes(KID_WORDS), text);
check('不能有:key', !text.includes(KEY) && !text.includes('realreal'), text);
check('不能有:业务空间', !text.includes(SPACE), text);
check('不能有:孩子的名字、slug', !text.includes(NAME) && !text.includes('zqming'), text);
check('不能有:孩子平板的 IP', !text.includes('192.168.1.77'), text);
check('不能有:家目录、用户名、电脑名', !text.includes(home) && !text.includes(`/${userInfo().username}/`) && !text.includes(computerName()) && !text.includes(hostname()), text);
check('开头说清楚里面没有什么', text.split('\n')[1].includes('不含孩子的对话') && text.split('\n')[1].includes('key'));

// ---- 接口和页面 ----
{
  const ctx = createContext(loadWorkspace(root));
  const r = await route('GET', '/api/parent/report', ctx);
  const t = (r.json as { text: string }).text;
  check('家长端接口:给诊断信息,同样干净', r.status === 200 && t.includes('# cotutor 诊断信息') && !t.includes(KID_WORDS) && !t.includes(KEY) && !t.includes(NAME), t);
  check('设置页:先给人看再复制,有反馈入口,不自动发', PARENT_SETTINGS_PAGE.includes("api('GET', '/api/parent/report')") && PARENT_SETTINGS_PAGE.includes('id="rep-text"') && PARENT_SETTINGS_PAGE.includes('issues/new?template=bug.yml') && !/fetch\(['"]https?:/.test(PARENT_SETTINGS_PAGE));
  check('设置页:http 地址没有剪贴板接口时退回选中', PARENT_SETTINGS_PAGE.includes('sel.addRange'));
}

done();
