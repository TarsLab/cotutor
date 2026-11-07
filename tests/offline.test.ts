/**
 * 孩子端的离线页(src/ui/kid/offline-sw.ts):电脑关了、睡着了时,给「老师们休息中」,不给浏览器的报错。
 * 把 worker 的源码放进一个假的 self 里跑:只接管孩子端那几页的打开;通的时候原样给;连不上、太久没回应才给离线页;什么都不缓存。
 */
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-offline-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { KID_SW_JS } = await import('../src/ui/kid/offline-sw.ts');
const { isKidPath } = await import('../src/app/http/access.ts');
const { KID_PAGE } = await import('../src/ui/kid/kid-page.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');

type Ev = { request: { mode: string; method: string; url: string }; respondWith(p: Promise<Response>): void; waitUntil(p: Promise<unknown>): void };
function worker(fetchImpl: (r: unknown) => Promise<Response>, waitMs = 60) {
  const on: Record<string, (e: unknown) => void> = {};
  const self = { addEventListener: (t: string, f: (e: unknown) => void) => { on[t] = f; }, location: { origin: 'https://ming.local' }, skipWaiting() {}, clients: { claim: async () => undefined } };
  vm.runInNewContext(KID_SW_JS.replace('const WAIT_MS = 12000', `const WAIT_MS = ${waitMs}`), { self, fetch: fetchImpl, Response, URL, Set, Promise, setTimeout });
  return async (url: string, mode = 'navigate', method = 'GET'): Promise<Response | null> => {
    let got: Promise<Response> | null = null;
    on.fetch({ request: { mode, method, url }, respondWith: (p: Promise<Response>) => { got = p; }, waitUntil() {} } as Ev);
    return got ? await got : null;
  };
}
const page = new Response('真的孩子端', { status: 200 });

{
  const ok = worker(async () => page);
  check('通的时候:原样给真的页面', (await ok('https://ming.local/')) === page);
  const down = worker(async () => { throw new TypeError('Failed to fetch'); });
  const off = await down('https://ming.local/');
  const text = off ? await off.text() : '';
  check('连不上:给离线页,说老师们休息中、叫爸爸妈妈', off?.status === 200 && text.includes('老师们休息中') && text.includes('叫爸爸妈妈'), text.slice(0, 80));
  check('离线页和页面开着时断线是同一句(kid-page 的 #rest)', KID_PAGE.includes('<p id="rest">老师们休息中</p>') && text.includes('老师们休息中') && !text.includes('还没到'));
  check('离线页:不说错误、连接、服务器(孩子端永远没有错误)', !/错误|失败|连接|服务器|error/i.test(text.replace(/<script>[\s\S]*<\/script>/, '')));
  check('离线页:通了自己刷新回去', text.includes('/api/health') && text.includes('location.reload'));
  check('离线页:不缓存', off?.headers.get('cache-control') === 'no-store');
  const slow = worker(() => new Promise(() => {}), 30);
  const late = await slow('https://ming.local/dictation');
  check('一直没回应(电脑睡着了):到点给离线页', Boolean(late && (await late.text()).includes('老师们休息中')));
  check('听写、口语课的页面也接管', Boolean(await down('https://ming.local/dictation')) && Boolean(await down('https://ming.local/talk?x=1')));
  check('接口不接管(请求照常失败,页面自己处理)', (await down('https://ming.local/api/kid/home', 'cors')) === null);
  check('家长端、工作台的页面不接管', (await down('https://ming.local/parent/home')) === null && (await down('https://ming.local/dev')) === null);
  check('别的网站不接管', (await down('https://example.com/')) === null);
  check('不是 GET 不接管', (await down('https://ming.local/', 'navigate', 'POST')) === null);
}
check('worker 里不缓存东西(没有 caches)', !/caches\./.test(KID_SW_JS));
check('mock 也给 /sw.js(不花钱看前端时一样有离线页)', readFileSync(join(import.meta.dirname, '..', 'src', 'app', 'mock', 'mock.ts'), 'utf8').includes("p === '/sw.js'"));
check('孩子端的源码里不出现家长端的路径', !KID_SW_JS.includes('/parent'));
check('/sw.js 在孩子端的白名单里(设了家长密码也给)', isKidPath('/sw.js'));
check('孩子端页面:只在安全上下文里装,回放和预览不装', KID_PAGE.includes("navigator.serviceWorker.register('/sw.js')") && KID_PAGE.includes('window.isSecureContext') && /!REEL && !PREVIEW && window\.isSecureContext/.test(KID_PAGE));
{
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const r = await route('GET', '/sw.js', createContext(loadWorkspace(root)));
  check('GET /sw.js:是脚本,不缓存', r.status === 200 && r.contentType?.startsWith('text/javascript') === true && r.cacheControl === 'no-cache' && Buffer.from(r.body ?? []).toString().includes('老师们休息中'));
}

done();
