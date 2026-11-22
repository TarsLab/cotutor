#!/usr/bin/env node
/**
 * 首页的手动验收(不进 pnpm test,要本机 Chrome;老师是假 CLI,不花钱):
 * 临时 workspace + HTTP serve → 写草稿(老师卡上只有 activity 与小课堂按钮)、cotutor home publish →
 * Chrome 开孩子端(桌上一本书,老师是钉在屏幕下沿的便利贴小旗):小旗的先后、只摊开最前那位的一章、方砖、橙点在小旗上;小旗一排、写着学科(手机在左下角,横屏在右页),「XX的老师们」是书下面桌上的名牌;点小旗、左右划翻章;手机与平板各截一张 →
 * 点 activity 按钮:老师页打开、按钮上的字发出去、索引里那条带 via 与 activity → 回首页点方砖「检查作业」:照那个 activity 起新话题 →
 *
 * 用法:node scripts/probe-home.mjs [--out <截图目录>] [--keep](留下临时 workspace 与 serve)
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS } from './_quiet.mjs';

const keep = process.argv.includes('--keep');
const outAt = process.argv.indexOf('--out');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8793;
const cdp = 9335;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);

const home = probeDir('cotutor-probe-home-');
const shots = outAt > 0 ? process.argv[outAt + 1] : join(home, 'shots');
mkdirSync(shots, { recursive: true });
const root = join(home, 'ws');
const run = (args) => new Promise((resolve, reject) => { const p = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), ...args], { env: { ...process.env, HOME: home, COTUTOR_WORKSPACE: '' }, stdio: 'pipe' }); let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('exit', (c) => (c === 0 ? resolve(out) : reject(new Error(out)))); });
await run(['init', 'probe', '--dir', root, '--name', '小探']);
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
// 老师是假老师(tests/_fake-teacher.ts,逐行吐),serve 经 COTUTOR_BRAIN_ENDPOINT 找它
const { startFakeTeacher } = await import(join(repo, 'tests', '_fake-teacher.ts'));
const teacher = await startFakeTeacher();
cfg.runtimes.default = 'fake';
cfg.runtimes.fake = { api: 'bailian', model: 'fake-stream' };
// 出厂老师写死了 runtime(api):探针一律用假老师
for (const t of Object.values(cfg.tutors)) delete t.runtime;
cfg.server.port = port;
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

// 老师都走实时:嘴是假百炼,serve 认 COTUTOR_LIVE_ENDPOINT(当百炼配好了)
const { startFakeRealtime } = await import(join(repo, 'tests', '_fake-realtime.ts'));
const mouth = await startFakeRealtime();
const serve = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'serve', '--workspace', root, '--http'], { env: { ...process.env, HOME: home, COTUTOR_LIVE_ENDPOINT: mouth.endpoint, COTUTOR_BRAIN_ENDPOINT: teacher.baseURL }, stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }
const api = async (method, path, body) => { const r = await fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
const settle = async (tutor) => { for (let i = 0; i < 80; i++) { const d = (await api('GET', `/api/kid/conversations/${tutor}/today`)).json; if (d && !d.pending && d.messages.every((m) => !m.pending)) return d; await sleep(250); } return null; };

let browser = null;
try {
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  mkdirSync(join(root, 'home'), { recursive: true });
  writeFileSync(join(root, 'home', 'draft.md'), `---
for: ${day}
---

\`\`\`tutor chinese-tutor
activity 预习 我要预习小蝌蚪找妈妈
讲法: 第 22 课。先带他把 1–3 自然段读顺,重点字 塘、脑、袋
activity 看图说话 我要看图说话
\`\`\`

\`\`\`tutor math-tutor
activity 复习 再练两道退位减法
讲法: 出 52−7、80−3,先让他说怎么想
\`\`\`

## 为什么这么排

- 探针
`);
  const pub = await run(['home', 'publish', '--workspace', root]);
  ok('cotutor home publish', pub.includes('发布了'), pub.split('\n')[0]);

  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(home, 'chrome')}`, `${base}/`], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page' && t.url.startsWith('http'))?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
  const device = async (w, h, dsf, mobile) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile }); await sleep(400); };
  const open = async (url) => { await send('Page.navigate', { url }); for (let i = 0; i < 40; i++) { if (await evaluate(`document.querySelectorAll('#deck .pc.front .bt').length > 0`)) break; await sleep(250); } await sleep(1200); };
  // 手指点:CDP 鼠标事件走命中判定(点到的是谁由页面说了算);换老师点他的小旗
  const tapAt = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
  const tapTab = async (name) => { const r = await evaluate(`(() => { const b = document.querySelector('#tabs .tab[data-tutor="${name}"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`); await tapAt(r.x, r.y); };
  const stack = () => evaluate(`(() => { const tabs = [...document.querySelectorAll('#tabs .tab')]; const f = document.querySelector('#deck .pc.front'); const r = (e) => e.getBoundingClientRect(); return { order: tabs.map((e) => e.dataset.tutor), front: tabs.filter((e) => e.classList.contains('front')).map((e) => e.dataset.tutor), shown: [...document.querySelectorAll('#deck .pc')].filter((e) => e.offsetParent).map((e) => e.dataset.tutor), dots: tabs.filter((e) => e.querySelector('.dot')).map((e) => e.dataset.tutor), card: f.dataset.tutor, buttons: [...f.querySelectorAll('.bt:not(.bt-extra):not(.bt-tile)')].map((b) => b.querySelector('.btx').textContent), tiles: [...f.querySelectorAll('.tls .bt-tile')].map((b) => b.dataset.tile + ':' + b.querySelector('.btx').textContent + ':' + Boolean(b.querySelector('.ta svg text, .ta svg path'))), extras: [...f.querySelectorAll('.bt-extra')].map((b) => b.getAttribute('href')), owned: [...f.querySelectorAll('.kcards > *')].map((c) => c.className), shared: [...document.querySelectorAll('#hcards > *')].map((c) => c.className), brief: document.body.innerHTML.includes('重点字'), rects: tabs.map((e) => [Math.round(r(e).left), Math.round(r(e).bottom)]), vh: innerHeight, fixed: getComputedStyle(document.querySelector('#tabs')).position, subs: tabs.map((e) => e.querySelector('.sub') ? e.querySelector('.sub').textContent : ''), ttl: !document.querySelector('#pages #ttl') && r(document.querySelector('#ttl h1')).top > r(document.querySelector('#pages')).bottom, vw: innerWidth, plate: Math.round((r(document.querySelector('#ttl')).left + r(document.querySelector('#ttl')).right) / 2), plateText: [r(document.querySelector('#ct-mark')).left, r(document.querySelector('#ttl h1')).right].map(Math.round) }; })()`);
  await send('Runtime.enable');
  await send('Page.enable');

  // ---- 孩子端首页 ----
  await device(390, 844, 2, true);
  await open(`${base}/`);
  const v0 = await stack();
  ok('小旗的先后照家长排的:语文、数学、补的英语;语文那章摊开,书里只摆他', v0.order.join() === 'chinese-tutor,math-tutor,english-tutor' && v0.front.join() === 'chinese-tutor' && v0.shown.join() === 'chinese-tutor' && v0.card === 'chinese-tutor', JSON.stringify(v0));
  ok('语文的卡:按钮齐(没有新话题、开场、接着);「每天都在」有拍照听写;讲法不在页面里', v0.buttons.join('|') === '我要预习小蝌蚪找妈妈|我要看图说话' && v0.extras.join() === '/dictation?tutor=chinese-tutor' && !v0.brief, JSON.stringify(v0.buttons));
  ok('方砖:第一行三张纸,预习、检查作业、复习,都有图', v0.tiles.join() === 'preview:预习:true,check:检查作业:true,review:复习:true', JSON.stringify(v0.tiles));
  ok('手机:小旗钉在屏幕左下角一排(贴着下沿、一张挨一张往右),写着学科;名牌在书下面的桌上、靠右,不碰小旗', v0.fixed === 'fixed' && v0.rects[0][0] < v0.rects[1][0] && v0.rects[1][0] < v0.rects[2][0] && v0.rects[0][0] < 60 && v0.rects.every((x) => x[1] === v0.vh) && v0.subs.every(Boolean) && v0.ttl && v0.plateText[1] > v0.vw - 30 && v0.plateText[0] > v0.rects[2][0] + 58, JSON.stringify([v0.rects, v0.vh, v0.fixed, v0.subs, v0.ttl, v0.plateText]));
  ok('首页只有老师卡:书外、牌里都没有别的卡', v0.shared.length === 0 && v0.owned.length === 0, JSON.stringify([v0.shared, v0.owned]));
  ok('橙点在小旗上:数学(家长排了按钮、孩子还没找过)亮;最前的语文、什么都没排的英语不亮', v0.dots.join() === 'math-tutor', JSON.stringify(v0.dots));
  console.log('  ', await shot('home-phone.png'));

  // ---- 点数学的小旗:翻到数学那章,小旗不挪 ----
  await tapTab('math-tutor');
  await sleep(900);
  const v1 = await stack();
  ok('翻章:数学那章摊开、书里只摆他,小旗的先后不变;橙点灭', v1.order.join() === v0.order.join() && v1.front.join() === 'math-tutor' && v1.shown.join() === 'math-tutor' && v1.buttons.join('|') === '再练两道退位减法' && v1.dots.length === 0 && v1.extras.length === 0, JSON.stringify(v1));
  await tapTab('math-tutor');
  await sleep(400);
  ok('点摊开这章的小旗:不翻', (await stack()).card === 'math-tutor');
  await sleep(5600);
  const v2 = await stack();
  ok('5 秒一轮的刷新:先后与在看的老师不变', v2.order.join() === v1.order.join() && v2.card === 'math-tutor', JSON.stringify(v2.order));
  await device(1180, 820, 1, false);
  await sleep(300);
  const vt = await stack();
  ok('平板横屏:小旗在右页(中线往右起排)一排;名牌在桌上正中,不碰小旗', vt.rects[0][0] < vt.rects[1][0] && vt.rects[1][0] < vt.rects[2][0] && vt.rects[0][0] > vt.vw / 2 && vt.rects.every((x) => x[1] === vt.vh) && vt.ttl && Math.abs((vt.plateText[0] + vt.plateText[1]) / 2 - vt.vw / 2) < 20 && vt.plateText[1] < vt.rects[0][0] && vt.card === 'math-tutor', JSON.stringify([vt.rects, vt.vh, vt.ttl, vt.plateText, vt.vw]));
  console.log('  ', await shot('home-tablet.png'));

  await device(390, 844, 2, true);
  await tapTab('chinese-tutor');
  await sleep(900);

  // ---- activity 按钮:老师页打开,按钮上的字发出去 ----
  await evaluate(`[...document.querySelectorAll('#deck .pc.front[data-tutor="chinese-tutor"] .bt:not(.bt-tile)')].find((b) => b.textContent.includes('看图说话')).click()`);
  await sleep(500);
  const d = await settle('chinese-tutor');
  const idx = (await api('GET', '/api/conversations/chinese-tutor/today')).json?.index;
  const last = idx?.messages[idx.messages.length - 1];
  ok('activity 按钮:按钮上的字发给语文老师、新话题、带 via、照 activity 带', last?.text === '我要看图说话' && last?.via?.button === 1 && last?.activity?.name === '看图说话' && last.thread === last.job, JSON.stringify({ text: last?.text, via: last?.via, activity: last?.activity, thread: last?.thread }));
  await sleep(1500);
  const page = await evaluate(`({ secs: document.querySelectorAll('#board .sec').length, blank: !!document.querySelector('#board .blank') })`);
  ok('老师页铺上了这一节', d && page.secs === 1 && !page.blank, JSON.stringify(page));
  console.log('  ', await shot('tutor-after-start.png'));

  // ---- 方砖:三块都以板为主(board: page),点「检查作业」先到拍照屏,拍了才发 ----
  await evaluate(`document.querySelector('#back').click()`);
  await sleep(1500);
  const before = (await api('GET', '/api/conversations/chinese-tutor/today')).json?.index?.messages.length ?? 0;
  await evaluate(`document.querySelector('#deck .pc.front[data-tutor="chinese-tutor"] .bt-tile[data-tile="check"]').click()`);
  await sleep(1200);
  const bp = await evaluate(`({ on: document.querySelector('#tutor').classList.contains('on'), start: Boolean(document.querySelector('#board .bp-start')) })`);
  const after = (await api('GET', '/api/conversations/chinese-tutor/today')).json?.index?.messages.length ?? 0;
  ok('方砖「检查作业」:老师页打开、先到拍照屏,还没发消息', bp.on && bp.start && after === before, JSON.stringify({ ...bp, before, after }));

  ws.close();
} finally {
  mouth.close();
  void teacher.close();
  if (browser) browser.kill();
  if (!keep) {
    serve.kill();
    if (outAt < 0) console.log(`截图在 ${shots}(临时目录,--out 指定目录可以留下)`);
    else rmSync(root, { recursive: true, force: true });
  } else console.log(`留着:workspace ${root},serve ${base}(pid ${serve.pid})`);
}
