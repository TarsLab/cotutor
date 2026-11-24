#!/usr/bin/env node
/**
 * 作业本(数学「检查作业」,activity 头上 base: homework)孩子端的手动验收:不进 pnpm test,要本机 Chrome;假百炼 + 假老师 + 假看图,不花钱。
 * 本进程起服务(临时 workspace):先当是 11 月 13 日、20 日,孩子检查作业各拍了一张(20 日那张上画了一笔);再拨到 11 月 23 日(星期一),无头 Chrome 开孩子端:
 *  一、点「检查作业」:不到拍照屏,直接铺一整本:13 日、20 日的照片连着,周与周之间一道宽条,最后「今天」一张白纸(拍照、从相册选);
 *      窗停在白纸的顶上,顶栏「今天」、有目录,没有前后天、右上角没有拍照;20 日那张上垫着那天画的一笔。
 *  二、手指往下拖(往上滚):顶栏换成「星期五 11月20日」。
 *  三、目录:一周一排、老的在上,卡下只写星期几、今天还没拍是虚线框;点 13 日那张:目录收起,滚到那一天,顶栏「星期五 11月13日」,窗停下报给服务端(「11月13日第1张」)。
 *  四、目录点「今天」回到白纸;白纸上按「从相册选」,选一张、发给老师:照片接在后面,白纸上写「接着拍下一页」。
 * iPad 横屏各截一张。
 * 用法:node scripts/probe-homework.mjs [--photo <作业照片>] [--out <截图目录>]
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS } from './_quiet.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const photo = resolve(opt('--photo') ?? join(repo, 'grades', 'grade-2', 'agents', 'math-tutor', 'activities', '例子图', '疏散图-填错.jpg'));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cdp = 9363;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };
const tmp = probeDir('cotutor-probe-homework-');
const shots = opt('--out') ?? join(tmp, 'shots');
mkdirSync(shots, { recursive: true });
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import(join(repo, 'src', 'app', 'cli', 'init.ts'));
const { loadWorkspace } = await import(join(repo, 'src', 'app', 'workspace.ts'));
const { createContext, createHandler, route } = await import(join(repo, 'src', 'app', 'http', 'app.ts'));
const { makeLiveUpgrade } = await import(join(repo, 'src', 'app', 'ws', 'route.ts'));
const { startFakeRealtime } = await import(join(repo, 'tests', '_fake-realtime.ts'));
const { startFakeTeacher } = await import(join(repo, 'tests', '_fake-teacher.ts'));
const { kidSend } = await import(join(repo, 'tests', '_kid-send.ts'));
const { photoSheetBox } = await import(join(repo, 'src', 'board', 'lesson.ts'));

const look = async (o) => { const t = '{"question": "1", "box": [40, 30, 980, 900]}'; o.onDelta?.(`${t}\n`); return { ok: true, text: t, ms: 5 }; };
const fake = await startFakeRealtime();
fake.audioMs = 300;
const teacher = await startFakeTeacher();
process.env.COTUTOR_BRAIN_ENDPOINT = teacher.baseURL;
const wsRoot = join(tmp, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.runtimes = { default: 'stream', stream: { api: 'bailian', model: 'fake-stream' } };
for (const t of Object.values(cfg.tutors)) delete t.runtime;
cfg.live = { voices: { 'math-tutor': 'Serena' } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const wsx = loadWorkspace(wsRoot);
let now = new Date(2026, 10, 13, 19, 5);
const ctx = createContext(wsx, { look, now: () => now });
await ctx.reload();
const T = 'math-tutor';

// 11 月 13 日、20 日:检查作业各拍了一张,20 日那张上孩子画了一笔
for (const [d, ink] of [[13, false], [20, true]]) {
  now = new Date(2026, 10, d, 19, 5);
  const home = (await route('GET', '/api/kid/home', ctx)).json;
  const up = (await route('POST', `/api/kid/conversations/${T}/photos`, ctx, { image: `data:image/jpeg;base64,${readFileSync(photo).toString('base64')}` })).json;
  const sent = await kidSend(ctx, T, { text: '', via: { home: home.home, button: 'check' }, photos: [up.path] });
  for (let i = 0; i < 200 && ctx.runner.running(T); i++) await sleep(25);
  await ctx.runner.flush();
  if (!ink) continue;
  // 画在这一天自己那张上(作业本里上面还有以前那天的)
  const l = (await route('GET', `/api/kid/lesson?tutor=${T}&date=2026-11-${d}&thread=${sent.json.thread}`, ctx)).json.lesson;
  const pg = l.pages.find((x) => x.id === '作业');
  const top = photoSheetBox(pg.photos, pg.photos.length - 1, pg.day)[1];
  await ctx.runner.boardEvent(T, `2026-11-${d}`, { k: 'stroke', thread: sent.json.thread, base: '作业', pts: Array.from({ length: 12 }, (_, i) => [200 + i * 40, top + 300 + (i % 2) * 20]) });
}
now = new Date(2026, 10, 23, 19, 0);

const upgrade = makeLiveUpgrade({ endpoint: fake.endpoint });
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void upgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--no-sandbox', '--hide-scrollbars', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${cdp}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, n), Buffer.from(r.result.data, 'base64')); return join(shots, n); };
  const until = async (expr, ms = 15000) => { for (let t = 0; t < ms; t += 200) { const v = await evaluate(expr); if (v) return v; await sleep(200); } return null; };
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' || type === 'mouseMoved' ? 0 : 1, clickCount: 1 });
  const tapAt = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await sleep(50); await mouse('mouseReleased', x, y); };
  const STAGE = `document.querySelector('#st-frame')?.contentDocument`;
  const DOUBLE_WAIT = 400;
  const center = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  const tapSel = async (sel) => { const c = await center(sel); if (c) await tapAt(c.x, c.y); return Boolean(c); };
  const tapText = async (sel, text) => {
    const c = await until(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)}) && x.getBoundingClientRect().width > 0); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, 6000);
    if (c) await tapAt(c.x, c.y);
    return Boolean(c);
  };
  const bar = () => evaluate(`({ ttl: document.querySelector('#st-ttl').textContent, toc: !document.querySelector('#st-toc').hidden, prev: !document.querySelector('#st-prev').hidden, next: !document.querySelector('#st-next').hidden })`);
  const stage = () => evaluate(`(() => { const d = ${STAGE}; if (!d) return null; return { phase: d.querySelector('.bk-board')?.dataset.phase ?? null, past: d.querySelectorAll('.bk-past path').length, next: d.querySelector('.bk-next')?.textContent ?? null }; })()`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });

  const ttl = () => evaluate(`document.querySelector('#st-ttl').textContent`);
  const inStage = (sel) => evaluate(`(() => { const f = document.querySelector('#st-frame'), d = f?.contentDocument; const el = d?.querySelector(${JSON.stringify(sel)}); if (!el) return null; const a = f.getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: a.left + r.left + r.width / 2, y: a.top + r.top + r.height / 2, top: a.top + r.top }; })()`);
  const drag = async (x, y0, y1) => { await mouse('mouseMoved', x, y0); await mouse('mousePressed', x, y0); for (let k = 1; k <= 12; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y0 + ((y1 - y0) * k) / 12, button: 'left', buttons: 1 }); await sleep(30); } await sleep(150); await mouse('mouseReleased', x, y1); };

  // 一、首页点数学的「检查作业」:直接铺一整本,窗停在最后那张白纸
  await send('Page.navigate', { url: `${base}/` });
  await until(`Boolean(document.querySelector('[data-tutor="math-tutor"]'))`);
  await evaluate(`document.querySelector('#tabs .tab[data-tutor="math-tutor"]').click(), true`);
  await until(`document.querySelector('.pc[data-tutor="math-tutor"]').classList.contains('front')`, 5000);
  await sleep(800);
  const hwCover = await until(`(() => { const c = document.querySelector('[data-tutor="math-tutor"] .bt-tile[data-tile="check"] .cv-hw'); const img = c && c.querySelector('.hp img'); return img && img.complete && img.naturalWidth ? { day: c.querySelector('.hd')?.textContent, label: c.querySelector('.hl b')?.textContent } : null; })()`);
  ok('首页「检查作业」是作业本的封面,带最近那一张和那天', hwCover?.label === '作业本' && hwCover?.day === '11月20日', JSON.stringify(hwCover));
  console.log('  ', await shot('0-首页.png'));
  const tile = await until(`(() => { const b = document.querySelector('[data-tutor="math-tutor"] .bt-tile[data-tile="check"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tapAt(tile.x, tile.y);
  const laid = await until(`(() => { const d = ${STAGE}; return d && d.querySelector('.bk-board')?.dataset.phase === 'ready' && d.querySelector('.bk-blank') && d.querySelectorAll('.bk-past path').length > 0; })()`, 20000);
  await sleep(1200);
  const st1 = await evaluate(`(() => { const d = ${STAGE}; return { divs: [...d.querySelectorAll('.bk-div')].map((x) => (x.querySelector('.wk')?.textContent ?? '') + '|' + x.querySelector('.dy').textContent), blank: d.querySelector('.bk-blank b')?.textContent, start: Boolean(document.querySelector('#board .bp-start, #lv-acts .lv-go')), bp: getComputedStyle(document.querySelector('#st-bp')).display }; })()`);
  const paper = await inStage('.bk-blank');
  const b1 = await bar();
  ok('点「检查作业」:不到拍照屏,铺一整本(两周各一道宽条,今天一道宽条),最后一张白纸;那天画的一笔垫在页上', Boolean(laid) && !st1.start && JSON.stringify(st1.divs) === JSON.stringify(['11月9日 – 15日|星期五', '11月16日 – 22日|星期五', '11月23日 – 29日|今天']) && st1.blank === '把写好的作业拍进来', JSON.stringify(st1));
  ok('窗停在白纸的顶上(上半是 20 日那张,下半是白纸);顶栏「今天」、有目录,没有前后天,右上角没有拍照', paper && paper.top > 250 && paper.top < 560 && b1.ttl === '今天' && b1.toc && !b1.prev && !b1.next && st1.bp === 'none', JSON.stringify({ paper, b1, bp: st1.bp }));
  console.log('  ', await shot('1-进门.png'));

  // 二、往上滚:顶栏跟着写那一天
  await drag(590, 200, 760);
  const up20 = await until(`document.querySelector('#st-ttl').textContent === '星期五11月20日'`, 6000);
  ok('手指往下拖(往上滚):顶栏换成「星期五 11月20日」', Boolean(up20), await ttl());
  await sleep(800);
  console.log('  ', await shot('2-往上滚.png'));

  // 三、目录:一周一排;点 13 日那张滚过去
  await tapSel('#st-toc');
  const toc = await until(`(() => { const s = [...document.querySelectorAll('#hwk.on section')]; return s.length ? s.map((x) => x.querySelector('h4').textContent + ':' + [...x.querySelectorAll('.c')].map((c) => c.querySelector('b').textContent + (c.classList.contains('none') ? '(还没拍)' : '') + (c.classList.contains('cur') ? '*' : '')).join(',')) : null; })()`, 5000);
  ok('目录:一周一排、老的在上;卡下只写星期几;今天还没拍是虚线框;窗停在的那天描出来', JSON.stringify(toc) === JSON.stringify(['11月9日 – 15日:星期五', '11月16日 – 22日:星期五*', '11月23日 – 29日:今天(还没拍)']), JSON.stringify(toc));
  await sleep(600);
  console.log('  ', await shot('3-目录.png'));
  await tapSel('#hwk section:first-child .c');
  const at13 = await until(`!document.querySelector('#hwk').classList.contains('on') && document.querySelector('#st-ttl').textContent === '星期五11月13日'`, 8000);
  const viewed = await until(`fetch('/api/kid/conversations/${T}/today').then((r) => r.json()).then((j) => { const th = j.messages?.at(-1)?.thread; return th ? fetch('/api/kid/lesson?tutor=${T}&date=2026-11-23&thread=' + th).then((r) => r.json()).then((x) => (x.lesson?.view?.[1] ?? 9999) < 400 ? x.lesson.view : null) : null; })`, 8000);
  ok('点 13 日:目录收起,滚到那一天,顶栏「星期五 11月13日」,窗停下报给服务端', Boolean(at13) && Array.isArray(viewed) && viewed[1] < 400, JSON.stringify({ ttl: await ttl(), viewed }));
  await sleep(800);
  console.log('  ', await shot('4-11月13日.png'));

  // 四、回到今天,白纸上从相册选一张发给老师
  await tapSel('#st-toc');
  await until(`document.querySelector('#hwk').classList.contains('on')`, 4000);
  await tapSel('#hwk section:last-child .c');
  await until(`document.querySelector('#st-ttl').textContent === '今天'`, 8000);
  await sleep(900);
  const alb = await inStage('.bk-blank [data-go="album"]');
  if (alb) await tapAt(alb.x, alb.y);
  await sleep(DOUBLE_WAIT);
  const doc = await send('DOM.getDocument', { depth: 1 });
  const input = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]:not([capture])' });
  if (input.result?.nodeId) await send('DOM.setFileInputFiles', { nodeId: input.result.nodeId, files: [photo] });
  const psOn = await until(`(() => { const b = document.querySelector('#ps.on #ps-go'); return b && !b.disabled; })()`, 10000);
  ok('白纸上按「从相册选」:开相册,选了进发照片屏', Boolean(alb) && Boolean(input.result?.nodeId) && Boolean(psOn), JSON.stringify({ alb, input: input.result?.nodeId, psOn }));
  await tapSel('#ps-go');
  const got = await until(`(() => { const d = ${STAGE}; return d?.querySelector('.bk-blank b')?.textContent === '接着拍下一页' ? [...d.querySelectorAll('.bk-div')].length : null; })()`, 15000);
  for (let i = 0; i < 60 && (await (await fetch(`${base}/api/kid/conversations/${T}/today`)).json()).messages?.some((m) => m.result === 'running'); i++) await sleep(250);
  await sleep(1200);
  const why = await evaluate(`(() => { const d = ${STAGE}; return { pages: d?.querySelectorAll('.bk-page').length, blank: d?.querySelector('.bk-blank b')?.textContent, phase: d?.querySelector('.bk-board')?.dataset.phase, divs: d?.querySelectorAll('.bk-div').length }; })()`);
  const msgs = (await (await fetch(`${base}/api/kid/conversations/${T}/today`)).json()).messages?.map((m) => ({ t: m.text, p: m.photos?.length, enter: m.enter })) ?? null;
  ok('发了一张:接在后面(今天那道宽条还在),白纸上写「接着拍下一页」,顶栏「今天」', got === 3 && (await ttl()) === '今天', JSON.stringify({ got, ttl: await ttl(), why, msgs }));
  console.log('  ', await shot('5-今天拍了.png'));
  ok('页面没有脚本报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`\n截图在 ${shots}`);
  ws.close();
} finally {
  browser?.kill();
  server.close();
  await teacher.close();
  await fake.close?.();
}
process.exit(bad ? 1 : 0);
