/**
 * 孩子端的流水(src/server/kid-log.ts,《孩子端流水设计.md》):设备 cookie、打开登记设备、页面出错一行;各页都带 KID_LOG_JS;
 * 自动标签(src/lib/kid-device.ts);孩子发的消息记 deviceId。新加孩子端页面要在 PAGES 里登记。
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-kid-log-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, kidSendInput, route } = await import('../src/server/app.ts');
const { KID_LOG_JS, readDevices, readKidLog, renameDevice } = await import('../src/server/kid-log.ts');
const { deviceLabel } = await import('../src/lib/kid-device.ts');

// ---- 自动标签 ----
{
  const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15';
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';
  const HOME_APP = 'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const CRIOS = 'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1';
  check('标签:iPad 的 Safari,只写 Safari 版本(浏览器信息里的系统版本是冻住的)', deviceLabel({ ua: IPAD, touch: 5 }) === 'iPad · Safari 27', deviceLabel({ ua: IPAD, touch: 5 }));
  check('标签:iPad 请求桌面网站(浏览器信息写 Mac)靠触点认出', deviceLabel({ ua: MAC, touch: 5 }) === 'iPad · Safari 26' && deviceLabel({ ua: MAC, touch: 0 }) === 'Mac · Safari 26');
  check('标签:iPhone、主屏幕(没有 Safari 版本)', deviceLabel({ ua: IPHONE, touch: 5 }) === 'iPhone · Safari 27' && deviceLabel({ ua: HOME_APP, touch: 5, standalone: true }) === 'iPad · 主屏幕', deviceLabel({ ua: HOME_APP, touch: 5, standalone: true }));
  check('标签:Chrome(Mac、iPad 上的 CriOS)', deviceLabel({ ua: CHROME }) === 'Mac · Chrome 141' && deviceLabel({ ua: CRIOS, touch: 5 }) === 'iPad · Chrome 141');
  check('标签:认不出来的', deviceLabel({ ua: '' }) === '不认得的浏览器');
}

// ---- 页面里的那段脚本:假的 window 里跑 ----
check('KID_LOG_JS 能插进模板字符串(没有反斜杠、反引号)', !/[\\`]/.test(KID_LOG_JS));
{
  type Handler = (e: unknown) => void;
  type Fake = { log: { start(o: Record<string, unknown>): void } & Record<string, (...a: unknown[]) => void>; posts: Record<string, unknown>[]; fire(type: string, e: unknown): void; doc: { hidden: boolean; fire(type: string): void }; clock: { t: number }; tick(): void };
  /** 假的 window / document / 钟 / 定时器;nav 盖在缺省的 navigator 上(权限、语音识别那几样) */
  const run = (over: { nav?: Record<string, unknown>; win?: Record<string, unknown> } = {}): Fake => {
    const handlers: Record<string, Handler[]> = {};
    const docHandlers: Record<string, Handler[]> = {};
    const timers: (() => void)[] = [];
    const posts: Record<string, unknown>[] = [];
    const clock = { t: 1_000_000 };
    const win = { addEventListener: (t: string, f: Handler) => { (handlers[t] ??= []).push(f); }, devicePixelRatio: 2, ...over.win };
    const doc = { hidden: false, addEventListener: (t: string, f: Handler) => { (docHandlers[t] ??= []).push(f); } };
    const nav = { userAgent: 'UA-x', maxTouchPoints: 5, language: 'zh-CN', standalone: false, ...over.nav };
    const fetch = (_u: string, o: { body: string }): Promise<void> => { posts.push(JSON.parse(o.body)); return Promise.resolve(); };
    const log = new Function('window', 'document', 'navigator', 'screen', 'innerWidth', 'innerHeight', 'matchMedia', 'fetch', 'Date', 'setInterval', `${KID_LOG_JS}; return kidLog;`)(win, doc, nav, { width: 820, height: 1180 }, 1180, 820, () => ({ matches: true }), fetch, { now: () => clock.t }, (f: () => void) => { timers.push(f); return timers.length; });
    return {
      log, posts, clock,
      fire: (type, e) => { for (const f of handlers[type] ?? []) f(e); },
      doc: Object.assign(doc, { fire: (type: string) => { for (const f of docHandlers[type] ?? []) f({}); } }),
      tick: () => { for (const f of timers) f(); },
    };
  };
  const a = run();
  a.log.start({ page: 'kid', mode: 'kid', v: 'abc', ctx: () => ({ tutor: 'chinese-tutor' }) });
  const open = a.posts[0];
  check('孩子端:报一次打开,带认设备要的那几样', a.posts.length === 1 && open.k === 'open' && open.page === 'kid' && open.v === 'abc' && open.ua === 'UA-x' && open.touch === 5 && open.standalone === true && open.w === 820 && open.dpr === 2 && open.lang === 'zh-CN', JSON.stringify(open));
  a.fire('error', { message: 'x is null', lineno: 12, colno: 3, error: { stack: 'at f' } });
  a.fire('error', { message: 'x is null', lineno: 12, colno: 3, error: { stack: 'at f' } });
  const err = a.posts[1];
  check('出错:一行带报错、位置、调用栈、页面给的 ctx;同一条只报一次', a.posts.length === 2 && err.k === 'error' && err.msg === 'x is null' && err.where === '12:3' && err.stack === 'at f' && err.mode === 'kid' && (err.ctx as { tutor: string }).tutor === 'chinese-tutor', JSON.stringify(a.posts));
  a.fire('error', { type: 'error' });
  check('图片、声音读不出(不是脚本错,没有 message)不收', a.posts.length === 2);
  a.fire('unhandledrejection', { reason: { message: 'boom', stack: 's' } });
  check('没接住的 Promise 也收', a.posts.length === 3 && String(a.posts[2].msg).includes('boom'));
  for (let i = 0; i < 30; i++) a.fire('error', { message: `e${i}`, lineno: i, colno: 0 });
  check('一次打开最多报 20 条(护栏)', a.posts.filter((p) => p.k === 'error').length === 20, String(a.posts.length));
  const b = run();
  b.log.start({ page: 'kid', mode: 'parent', ctx: () => { throw new Error('S 还没有'); } });
  b.fire('error', { message: 'y', lineno: 1, colno: 1 });
  check('家长端、录像、预览:不报打开,出错照记(ctx 抛了记 null)', b.posts.length === 1 && b.posts[0].k === 'error' && b.posts[0].mode === 'parent' && b.posts[0].ctx === null, JSON.stringify(b.posts));

  // 前台计时(7.4):切后台记一笔、回来重新计、5 分钟一笔、离开页面一笔;不满 1 秒不记;家长模式不计
  const f = run();
  f.log.start({ page: 'dictation', mode: 'kid' });
  f.clock.t += 90_000; f.doc.hidden = true; f.doc.fire('visibilitychange');
  f.clock.t += 600_000; f.doc.hidden = false; f.doc.fire('visibilitychange');
  f.clock.t += 300_000; f.tick();
  f.clock.t += 400; f.fire('pagehide', {});
  f.clock.t += 30_000; f.fire('pagehide', {});
  const fg = f.posts.filter((p) => p.k === 'fg');
  check('前台:切后台记 90 秒,后台那 10 分钟不算,5 分钟一笔,不满 1 秒的不记,离开页面再记一笔', fg.map((p) => p.ms).join() === '90000,300000,30400' && fg.every((p) => p.page === 'dictation'), JSON.stringify(fg));
  const fp = run();
  fp.log.start({ page: 'kid', mode: 'reel' });
  fp.clock.t += 90_000; fp.doc.hidden = true; fp.doc.fire('visibilitychange'); fp.tick();
  check('录像、家长端不计前台', fp.posts.length === 0);
}

// ---- 各页都带 ----
const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
let now = new Date('2026-10-22T20:30:00');
const ctx = createContext(loadWorkspace(root), { now: () => now });
const html = async (p: string): Promise<string> => {
  const r = await route('GET', p, ctx);
  return r.status === 200 && typeof r.html === 'string' ? r.html : '';
};
/** 带孩子端页面那份的:孩子自己开的、家长端与录像里开的同一份页面 */
const PAGES = [['/', 'kid'], ['/parent', 'kid'], ['/reel', 'kid'], ['/preview', 'kid'], ['/dictation', 'dictation'], ['/dictation?lang=en', 'dictation-en'], ['/talk', 'talk']];
for (const [p, page] of PAGES) {
  const h = await html(p);
  check(`${p} 带 KID_LOG_JS、报的是 ${page}`, h.includes(KID_LOG_JS.trim()) && h.includes(`kidLog.start({ page: '${page}'`), String(h.length));
}
const stage = await html('/stage/');
if (stage) check('/stage/ 带 KID_LOG_JS,只记出错', stage.includes(KID_LOG_JS.trim()) && stage.includes("kidLog.start({ page: 'stage', mode: 'stage'"));
else console.log('  (舞台没打包,跳过 /stage/)');
check('老师页按模式报:家长端、录像、预览不是 kid', (await html('/')).includes("mode: PARENT ? 'parent' : REEL ? 'reel' : PREVIEW ? 'preview' : 'kid'"));

// ---- 接口 ----
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1';
const openBody = { k: 'open', page: 'kid', v: 'abc', ua: IPAD, touch: 5, standalone: false, w: 820, h: 1180, vw: 1180, vh: 820, dpr: 2, lang: 'zh-CN' };
const r1 = await route('POST', '/api/kid/log', ctx, openBody, 'local', { ip: '192.168.1.20' });
const id = /^cotutor_kid=([0-9a-f]{12});/.exec(r1.setCookie ?? '')?.[1] ?? '';
check('没有设备 cookie:种一枚(400 天、HttpOnly、SameSite=Lax)', r1.status === 200 && id.length === 12 && /Max-Age=34560000/.test(r1.setCookie!) && /HttpOnly/.test(r1.setCookie!) && /SameSite=Lax/.test(r1.setCookie!), r1.setCookie);
const day = await readKidLog(ctx.ws, ['2026-10-22']);
check('流水:按天一行,服务端补时刻、设备、来源地址', day.length === 1 && day[0].k === 'open' && day[0].device === id && day[0].ip === '192.168.1.20' && day[0].at === now.toISOString() && existsSync(join(root, '.cotutor', 'kid-log', '2026-10-22.jsonl')), JSON.stringify(day));
check('打开那行服务端补 srv:版本、提交、启动时刻(7.1)', typeof day[0].srv?.v === 'string' && /^[0-9a-f]{7}$/.test(day[0].srv?.commit ?? '') && !Number.isNaN(Date.parse(day[0].srv?.started ?? '')), JSON.stringify(day[0].srv));
let devs = await readDevices(ctx.ws);
check('打开登记设备:第一次、最近、几次、自动标签、那次服务端的提交', devs[id]?.opens === 1 && devs[id].label === 'iPad · Safari 27' && devs[id].first === now.toISOString() && devs[id].last === now.toISOString() && devs[id].commit === day[0].srv?.commit, JSON.stringify(devs));
now = new Date('2026-10-22T20:40:00');
const r2 = await route('POST', '/api/kid/log', ctx, { ...openBody, standalone: true }, 'local', { device: id });
devs = await readDevices(ctx.ws);
check('带着 cookie:不再种,同一台开过两次,标签跟着最近一次', r2.status === 200 && !r2.setCookie && devs[id].opens === 2 && devs[id].label === 'iPad · Safari 27 · 主屏幕' && devs[id].first !== devs[id].last);
const r3 = await route('POST', '/api/kid/log', ctx, { k: 'error', page: 'kid', mode: 'kid', v: 'abc', msg: 'x is null', where: '12:3', stack: 'at f', ua: IPAD, ctx: { tutor: 'chinese-tutor' } }, 'local', { device: id });
const day2 = await readKidLog(ctx.ws, ['2026-10-22']);
check('出错:记一行,不动设备表', r3.status === 200 && day2.length === 3 && day2[2].k === 'error' && (day2[2] as { msg: string }).msg === 'x is null' && (await readDevices(ctx.ws))[id].opens === 2);
const bad = await Promise.all([route('POST', '/api/kid/log', ctx, { page: 'kid' }), route('POST', '/api/kid/log', ctx, { k: 'nope' }), route('POST', '/api/kid/log', ctx, { k: 'error', msg: 'x'.repeat(5000) }), route('POST', '/api/kid/log', ctx, [1])]);
check('坏正文、k 不认得、太长:400', bad.every((r) => r.status === 400), bad.map((r) => r.status).join());
const fgOk = await route('POST', '/api/kid/log', ctx, { k: 'fg', page: 'kid', ms: 90_000 }, 'local', { device: id });
const fgBad = await Promise.all([{ k: 'fg', ms: 0 }, { k: 'fg', ms: 7 * 3600_000 }, { k: 'fg', ms: '9' }].map((b) => route('POST', '/api/kid/log', ctx, b, 'local', { device: id })));
check('前台一笔收下;0、超过 6 小时、不是数的 400', fgOk.status === 200 && (await readKidLog(ctx.ws, ['2026-10-22'])).some((l) => l.k === 'fg' && l.ms === 90_000) && fgBad.every((r) => r.status === 400), fgBad.map((r) => r.status).join());
const r4 = await route('POST', '/api/kid/log', ctx, openBody, 'local', { device: '../etc' });
check('cookie 不像设备编号:当没有,种新的', /^cotutor_kid=[0-9a-f]{12};/.test(r4.setCookie ?? ''));
check('起名、去掉名字;没有这台 → false', (await renameDevice(ctx.ws, id, '  Ray 的 iPad  ')) && (await readDevices(ctx.ws))[id].name === 'Ray 的 iPad' && (await renameDevice(ctx.ws, id, '')) && !('name' in (await readDevices(ctx.ws))[id]) && !(await renameDevice(ctx.ws, 'ffffffffffff', 'x')));
check('流水文件是一行一个 JSON', readFileSync(join(root, '.cotutor', 'kid-log', '2026-10-22.jsonl'), 'utf8').trim().split('\n').every((l) => JSON.parse(l).device));

// ---- 消息记设备 ----
const s1 = await kidSendInput(ctx, 'chinese-tutor', { text: '你好' }, '2026-10-22', id);
const s2 = await kidSendInput(ctx, 'chinese-tutor', { text: '你好' }, '2026-10-22', 'not-an-id');
check('孩子发的一条带上设备编号;不像编号的不带', 'input' in s1 && s1.input.deviceId === id && 'input' in s2 && s2.input.deviceId === undefined);

done();
