/**
 * 家长端与工作台的锁(src/server/access.ts,《产品规划.md》拍板 21):没设 PIN 全开、设了孩子端白名单照旧开、别的要凭证;
 * 本机免密;对 PIN 换 cookie;连错锁;改 PIN 换密钥;doctor 的 server.access;孩子端页面源码里用到的接口都在白名单里。
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-access-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { KID_PAGE } = await import('../src/server/kid-page.ts');
const { createAccess, setPin, clearPin, readPin, isKidPath, signToken, verifyToken, cookieOf, COOKIE_NAME, USER_PIN_FILE } = await import('../src/server/access.ts');
const { doctorWorkspace } = await import('../src/cli/doctor.ts');

try {
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  let now = new Date(2026, 9, 17, 20, 0);
  const access = createAccess({ now: () => now });
  const ctx = createContext(loadWorkspace(root), { now: () => now, access });
  const anon = (method: string, p: string, body?: unknown) => route(method, p, ctx, body, 'anon');
  const local = (method: string, p: string, body?: unknown) => route(method, p, ctx, body);
  const fakeReq = (addr: string, cookie?: string) => ({ headers: cookie ? { cookie } : {}, socket: { remoteAddress: addr } });

  // ---- 没设 PIN:和以前一字不差 ----
  check('PIN 文件在机器级 ~/.config/cotutor/', USER_PIN_FILE === join(home, '.config', 'cotutor', 'pin.json'), USER_PIN_FILE);
  check('没设 PIN:匿名开家长端、工作台、配置接口都 200', (await anon('GET', '/parent')).status === 200 && (await anon('GET', '/dev')).status === 200 && (await anon('GET', '/api/config')).status === 200 && (await anon('GET', '/api/overview/today')).status === 200);
  check('没设 PIN:/api/auth 回 who 与 pin:false;对任何 PIN 都 401', ((await anon('GET', '/api/auth')).json as { who: string; pin: boolean }).pin === false && (await anon('POST', '/api/auth', { pin: '2468' })).status === 401);
  check('没设 PIN:谁都是 anon 或 local', (await access.whoOf(fakeReq('192.168.1.5'))) === 'anon' && (await access.whoOf(fakeReq('127.0.0.1'))) === 'local' && (await access.whoOf(fakeReq('::1'))) === 'local' && (await access.whoOf(fakeReq('::ffff:127.0.0.1'))) === 'local');
  const d0 = await doctorWorkspace(root, { probeEnv: false });
  const a0 = d0.checks.find((c) => c.name === 'server.access');
  check('doctor:没设 PIN 提一句,不算错(required false),fix 是 cotutor pin', a0?.ok === false && a0.required === false && a0.fix?.startsWith('cotutor pin') === true && a0.detail.includes('全开'), JSON.stringify(a0));

  // ---- 设了 PIN ----
  let threw = '';
  try { await setPin('12'); } catch (e) { threw = (e as Error).message; }
  check('PIN 要 4–8 位数字', threw.includes('4 到 8 位'));
  await setPin('2468');
  check('设了:孩子端白名单照旧开', (await Promise.all(['/', '/api/kid/home', '/api/kid/conversations/math-tutor/today', '/api/health', '/dictation', '/talk', '/api/dictation', '/api/talk', '/api/live/chinese-tutor/ws', '/stage/', '/kid/theme.css', '/favicon.svg', '/icon-180.png', '/manifest.webmanifest'].map((p) => anon('GET', p)))).every((r) => r.status !== 401));
  const gate = await anon('GET', '/parent');
  check('设了:匿名开家长端是输 PIN 的页(401 + html),页面不含孩子端以外的路径泄露', gate.status === 401 && (gate.html ?? '').includes('家长的页') && (gate.html ?? '').includes("fetch('/api/auth'"), String(gate.status));
  check('输 PIN 页的脚本能解析', (() => { const js = /<script>([\s\S]*?)<\/script>/.exec(gate.html ?? '')?.[1] ?? ''; try { new Function(js); return js.length > 0; } catch { return false; } })());
  check('设了:匿名开工作台、录像 iframe、预览也是输 PIN 的页;接口 401 json', (await anon('GET', '/dev')).status === 401 && (await anon('GET', '/reel')).status === 401 && (await anon('GET', '/preview')).status === 401 && (await anon('GET', '/parent/home')).status === 401 && ((await anon('GET', '/api/config')).json as { error: string }).error === 'auth' && (await anon('PATCH', '/api/config', { title: 'x' })).status === 401 && (await anon('POST', '/api/conversations/math-tutor/messages', { text: 'x' })).status === 401 && (await anon('GET', '/api/overview/today')).status === 401 && (await anon('GET', '/parent/xlaoshi')).status === 401 && (await anon('GET', '/api/xlaoshi')).status === 401 && (await anon('GET', '/parent/dictation')).status === 401);
  check('设了:本机照旧免密', (await local('GET', '/parent')).status === 200 && (await local('GET', '/dev')).status === 200 && (await local('GET', '/api/config')).status === 200);
  check('设了:配置里仍然看不到 PIN 相关的东西(不进 cotutor.json)', !JSON.stringify((await local('GET', '/api/config')).json).includes('2468') && !JSON.stringify((await local('GET', '/api/workspace')).json).includes('pin.json'));

  // ---- 对 PIN 换 cookie ----
  check('错的 PIN 401', (await anon('POST', '/api/auth', { pin: '0000' })).status === 401 && (await anon('POST', '/api/auth', { pin: 2468 })).status === 401);
  const ok = await anon('POST', '/api/auth', { pin: '2468' });
  const setCookie = ok.setCookie ?? '';
  check('对的 PIN 200 + Set-Cookie:HttpOnly、SameSite、90 天;没 https 不带 Secure', ok.status === 200 && setCookie.startsWith(`${COOKIE_NAME}=`) && setCookie.includes('HttpOnly') && setCookie.includes('SameSite=Lax') && setCookie.includes(`Max-Age=${90 * 86400}`) && !setCookie.includes('Secure'), setCookie);
  const token = cookieOf(setCookie.split(';')[0]) ?? '';
  check('带 cookie 的别的设备是 parent;本机还是 local', (await access.whoOf(fakeReq('192.168.1.5', `${COOKIE_NAME}=${token}`))) === 'parent' && (await access.whoOf(fakeReq('192.168.1.5', `foo=bar; ${COOKIE_NAME}=${token}; x=y`))) === 'parent' && (await access.whoOf(fakeReq('127.0.0.1'))) === 'local');
  check('parent 开家长端、工作台、接口都 200', (await route('GET', '/parent', ctx, undefined, 'parent')).status === 200 && (await route('GET', '/api/overview/today', ctx, undefined, 'parent')).status === 200);
  check('改过的、过期的、乱写的 cookie 都是 anon', (await access.whoOf(fakeReq('192.168.1.5', `${COOKIE_NAME}=${token.slice(0, -1)}0`))) === 'anon' && (await access.whoOf(fakeReq('192.168.1.5', `${COOKIE_NAME}=abc`))) === 'anon' && (await (async () => { const was = now; now = new Date(now.getTime() + 91 * 86400000); const w = await access.whoOf(fakeReq('192.168.1.5', `${COOKIE_NAME}=${token}`)); now = was; return w; })()) === 'anon');
  check('令牌:签名对、没过期才认', verifyToken('k', signToken('k', 1000), 999) && !verifyToken('k', signToken('k', 1000), 1000) && !verifyToken('k2', signToken('k', 1000), 1) && !verifyToken('k', 'x', 1));

  // ---- 连错锁 ----
  for (let i = 0; i < 4; i++) await anon('POST', '/api/auth', { pin: '1111' });
  const fifth = await anon('POST', '/api/auth', { pin: '1111' });
  check('连错 5 次 → 429 锁 60 秒,对的也进不去', fifth.status === 429 && (fifth.json as { retryMs: number }).retryMs === 60000 && (await anon('POST', '/api/auth', { pin: '2468' })).status === 429, JSON.stringify(fifth.json));
  now = new Date(now.getTime() + 61_000);
  check('60 秒后对的又能进', (await anon('POST', '/api/auth', { pin: '2468' })).status === 200);

  // ---- 改 PIN 换密钥;撤掉回全开 ----
  await setPin('1357');
  check('改 PIN:旧 cookie 作废,旧 PIN 不认', (await access.whoOf(fakeReq('192.168.1.5', `${COOKIE_NAME}=${token}`))) === 'anon' && (await anon('POST', '/api/auth', { pin: '2468' })).status === 401 && (await anon('POST', '/api/auth', { pin: '1357' })).status === 200);
  const d1 = await doctorWorkspace(root, { probeEnv: false });
  check('doctor:设了 PIN 是 ok', d1.checks.find((c) => c.name === 'server.access')?.ok === true);
  await clearPin();
  check('撤掉:文件没了,匿名又全开', (await readPin()) === null && (await anon('GET', '/parent')).status === 200 && (await anon('GET', '/api/config')).status === 200);

  // ---- 护栏:孩子端页面(孩子模式)源码里用到的接口都在白名单里;家长模式才有的那几条不在 ----
  const used = new Set([...KID_PAGE.matchAll(/'(\/api\/[a-z-]+(?:\/[a-z-]+)?)/g)].map((m) => m[1]));
  const kidOnly = [...used].filter((p) => !/^\/api\/(conversations|overview)/.test(p));
  check('孩子端源码里的接口前缀都在白名单里(/api/conversations、/api/overview 是家长模式才用)', kidOnly.every((p) => isKidPath(p) || isKidPath(`${p}/`)), kidOnly.filter((p) => !isKidPath(p) && !isKidPath(`${p}/`)).join(' '));
  check('白名单不放家长与工作台的路径', !isKidPath('/parent') && !isKidPath('/dev') && !isKidPath('/api/config') && !isKidPath('/api/conversations/x') && !isKidPath('/api/parent/home') && !isKidPath('/api/xlaoshi') && !isKidPath('/reel') && !isKidPath('/preview'));
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
