#!/usr/bin/env node
/**
 * 作业本(数学「检查作业」,activity 头上 base: homework)孩子端的手动验收:不进 pnpm test,要本机 Chrome;假百炼 + 假老师 + 假看图,不花钱。
 * 本进程起服务(临时 workspace):先当是 11 月 20 日,孩子检查作业拍了一张、在上面画了一笔;再拨到 11 月 23 日,无头 Chrome 开孩子端:
 *  一、点「检查作业」:今天还没拍,先到拍照屏,多一颗「翻作业本」。
 *  二、点它:进门铺 20 日那一天(顶栏「11月20日」、有「目录」),照片上垫着那天画的一笔(只看)。
 *  三、选一张课本页当今天拍的:换到今天这一章「11月23日」,顶栏左边一颗前一天。
 *  四、按前一天:回到 20 日;这一天最后一页下面一行「后一天 11月23日」。
 *  五、按「目录」:一天一行(新的在上);点 23 日翻回今天。
 * iPad 横屏各截一张。
 * 用法:node scripts/probe-homework.mjs [--photo <作业照片>] [--out <截图目录>]
 */
import { probeDir, spawn } from './_guard.mjs';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
mkdirSync(join(wsx.paths.textbooks, '数学二年级上册'), { recursive: true });
copyFileSync(photo, join(wsx.paths.textbooks, '数学二年级上册', '42.jpg'));
let now = new Date(2026, 10, 20, 19, 5);
const ctx = createContext(wsx, { look, now: () => now });
await ctx.reload();
const T = 'math-tutor';

// 11 月 20 日:检查作业拍了一张(课本页当照片),孩子在上面画了一笔
{
  const home = (await route('GET', '/api/kid/home', ctx)).json;
  const up = (await route('POST', `/api/kid/conversations/${T}/photos`, ctx, { image: `data:image/jpeg;base64,${readFileSync(photo).toString('base64')}` })).json;
  const sent = await kidSend(ctx, T, { text: '', via: { home: home.home, button: 'check' }, photos: [up.path] });
  for (let i = 0; i < 200 && ctx.runner.running(T); i++) await sleep(25);
  await ctx.runner.flush();
  await ctx.runner.boardEvent(T, '2026-11-20', { k: 'stroke', thread: sent.json.thread, base: '作业', pts: Array.from({ length: 12 }, (_, i) => [200 + i * 40, 500 + (i % 2) * 20]) });
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

  // 一、首页点数学的「检查作业」:今天还没拍,先到拍照屏,多一颗「翻作业本」
  await send('Page.navigate', { url: `${base}/` });
  await until(`Boolean(document.querySelector('[data-tutor="math-tutor"]'))`);
  await evaluate(`document.querySelector('#tabs .tab[data-tutor="math-tutor"]').click(), true`);
  await until(`document.querySelector('.pc[data-tutor="math-tutor"]').classList.contains('front')`, 5000);
  await sleep(800);
  // 首页「检查作业」那张是作业本的封面:学科色 +「作业本」+ 最近那一张(20 日拍的)和那天
  const hwCover = await until(`(() => { const c = document.querySelector('[data-tutor="math-tutor"] .bt-tile[data-tile="check"] .cv-hw'); const img = c && c.querySelector('.hp img'); return img && img.complete && img.naturalWidth ? { day: c.querySelector('.hd')?.textContent, label: c.querySelector('.hl b')?.textContent } : null; })()`);
  ok('首页「检查作业」是作业本的封面,带最近那一张和那天', hwCover?.label === '作业本' && hwCover?.day === '11月20日', JSON.stringify(hwCover));
  console.log('  ', await shot('0-首页.png'));
  const tile = await until(`(() => { const b = document.querySelector('[data-tutor="math-tutor"] .bt-tile[data-tile="check"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tapAt(tile.x, tile.y);
  const start = await until(`(() => { const t = [...document.querySelectorAll('#lv-acts .lv-go, #board .ask-go')].map((x) => x.textContent.trim()); return t.some((x) => x.includes('翻作业本')) ? t : null; })()`);
  ok('点「检查作业」:今天还没拍,先到拍照屏(拍照、选课本页、从相册选、不拍用白纸),多一颗「翻作业本」', Array.isArray(start) && start.some((x) => x.includes('拍照')) && start.some((x) => x.includes('选课本页')), JSON.stringify(start));
  console.log('  ', await shot('1-拍照屏.png'));

  // 二、翻作业本:铺 20 日那一天,照片上垫着那天画的一笔
  await tapText('#lv-acts .lv-go, #board .ask-go', '翻作业本');
  const laid = await until(`(() => { const d = ${STAGE}; return d && d.querySelector('.bk-board')?.dataset.phase === 'ready' && d.querySelectorAll('.bk-past path').length > 0; })()`, 20000);
  const b2 = await bar();
  ok('翻作业本:铺 20 日那一天,顶栏「11月20日」、有目录,没有前后天;那天画的一笔垫在页上', Boolean(laid) && b2.ttl === '11月20日' && b2.toc && !b2.prev && !b2.next, JSON.stringify({ b2, st: await stage() }));
  await sleep(800);
  console.log('  ', await shot('2-11月20日.png'));

  // 三、选一张课本页当今天拍的:换到今天这一章
  await tapSel('#st-tb');
  const pg = await until(`(() => { const b = document.querySelector('#tbk.on .pg'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (pg) await tapAt(pg.x, pg.y);
  const today = await until(`document.querySelector('#st-ttl').textContent === '11月23日'`, 15000);
  const b3 = await bar();
  ok('今天拍了一张:换到「11月23日」,顶栏有前一天', Boolean(today) && b3.prev && !b3.next, JSON.stringify(b3));
  for (let i = 0; i < 60 && (await (await fetch(`${base}/api/kid/conversations/${T}/today`)).json()).messages?.some((m) => m.result === 'running'); i++) await sleep(250);
  await sleep(1000);
  console.log('  ', await shot('3-11月23日.png'));

  // 四、前一天:回到 20 日;最后一页下面一行「后一天 11月23日」
  await tapSel('#st-prev');
  await until(`document.querySelector('#st-ttl').textContent === '11月20日'`, 8000);
  const end = await until(`(() => { const d = ${STAGE}; return d?.querySelector('.bk-next')?.textContent ?? null; })()`, 8000);
  const b4 = await bar();
  ok('前一天:回到 20 日,顶栏有后一天;最后一页下面一行「后一天 11月23日」', b4.ttl === '11月20日' && b4.next && !b4.prev && /后一天.*11月23日/.test(end ?? ''), JSON.stringify({ b4, end }));
  const turned = await until(`fetch('/api/kid/conversations/${T}/today').then((r) => r.json()).then(() => true)`);
  void turned;

  // 五、目录:一天一行(新的在上);点 23 日翻回今天
  await tapSel('#st-toc');
  const rows = await until(`(() => { const r = [...document.querySelectorAll('#hwk.on .day b')].map((x) => x.textContent); return r.length ? r : null; })()`, 5000);
  ok('作业本的目录:一天一行,新的在上', JSON.stringify(rows) === '["11月23日","11月20日"]', JSON.stringify(rows));
  console.log('  ', await shot('4-目录.png'));
  await tapText('#hwk .day', '11月23日');
  const back = await until(`!document.querySelector('#hwk').classList.contains('on') && document.querySelector('#st-ttl').textContent === '11月23日'`, 8000);
  ok('点 23 日:目录收起,翻回今天', Boolean(back));
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
