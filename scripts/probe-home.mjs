#!/usr/bin/env node
/**
 * 首页(《首页设计.md》)的手动验收(不进 pnpm test,要本机 Chrome;老师是假 CLI,不花钱):
 * 临时 workspace + HTTP serve → 语文老师先讲一轮(给「接着」一个话题)→ 写草稿、cotutor home publish →
 * Chrome 开孩子端(牌堆,一位老师一张牌):叠的顺序、最前那张在最上层、卡的归属、橙点;手机竖着叠、平板横着叠;点后面那张抽出换到最前;手机与平板各截一张 →
 * 点「新话题」是空白老师页 → 回首页点开场按钮:老师页打开、按钮上的字发出去、索引里那条带 via →
 *
 * 用法:node scripts/probe-home.mjs [--out <截图目录>] [--keep](留下临时 workspace 与 serve)
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS, quiet } from './_quiet.mjs';

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
const fake = join(repo, 'tests', '_fake-cli.ts');
cfg.runtimes.default = 'fake';
cfg.runtimes.fake = { run: [process.execPath, '--experimental-strip-types', '--no-warnings', fake, '--stream', '--agent', '{agent}', '{prompt}'], resume: [process.execPath, '--experimental-strip-types', '--no-warnings', fake, '--stream', '--agent', '{agent}', '--resume', '{session}', '{prompt}'] };
// 出厂的语文老师走 qwen:探针一律用假老师
for (const t of Object.values(cfg.tutors)) delete t.runtime;
cfg.server.port = port;
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

// 老师都走实时(《产品规划.md》拍板 30):嘴是假百炼,serve 认 COTUTOR_LIVE_ENDPOINT(当百炼配好了)
const { startFakeRealtime } = await import(join(repo, 'tests', '_fake-realtime.ts'));
const mouth = await startFakeRealtime();
const serve = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'serve', '--workspace', root, '--http'], { env: { ...process.env, HOME: home, COTUTOR_LIVE_ENDPOINT: mouth.endpoint }, stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }
const api = async (method, path, body) => { const r = await fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
const settle = async (tutor) => { for (let i = 0; i < 80; i++) { const d = (await api('GET', `/api/kid/conversations/${tutor}/today`)).json; if (d && !d.pending && d.messages.every((m) => !m.pending)) return d; await sleep(250); } return null; };

let browser = null;
try {
  // ---- 语文老师先讲一轮,首页的「接着」指它 ----
  const first = await api('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '讲讲板书', newThread: true });
  await settle('chinese-tutor');
  const thread = first.json?.thread;
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  mkdirSync(join(root, 'home'), { recursive: true });
  writeFileSync(join(root, 'home', 'draft.md'), `---
for: ${day}
---

\`\`\`text
# 今晚
先读课文,再练两道题
\`\`\`

\`\`\`tutor chinese-tutor
我要预习小蝌蚪找妈妈
讲法: 第 22 课。先带他把 1–3 自然段读顺,重点字 塘、脑、袋
接着 ${day} ${thread} 接着讲刚才的板书
\`\`\`

\`\`\`tutor math-tutor
再练两道退位减法
讲法: 出 52−7、80−3,先让他说怎么想
\`\`\`

\`\`\`tianzige
塘脑袋
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
  // 手指点:CDP 鼠标事件走命中判定(后面的牌只露出头那一行 / 左边一格,点到的是谁由页面说了算);点的是牌角的头像
  const tapAt = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
  const tapAvatar = async (name) => { const r = await evaluate(`(() => { const b = document.querySelector('#deck .pc[data-tutor="${name}"] .pc-hd .av').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`); await tapAt(r.x, r.y); };
  const stack = () => evaluate(`(() => { const els = [...document.querySelectorAll('#deck .pc')].sort((a, b) => a.style.zIndex - b.style.zIndex); const f = document.querySelector('#deck .pc.front'); const r = (e) => e.getBoundingClientRect(); return { order: els.map((e) => e.dataset.tutor), front: els.filter((e) => e.classList.contains('front')).map((e) => e.dataset.tutor), dots: els.filter((e) => e.querySelector('.dot')).map((e) => e.dataset.tutor), card: f.dataset.tutor, name: f.querySelector('.pc-hd .nm').textContent, buttons: [...f.querySelectorAll('.bt:not(.bt-extra)')].map((b) => b.querySelector('.btx').textContent), extras: [...f.querySelectorAll('.bt-extra')].map((b) => b.getAttribute('href')), owned: [...f.querySelectorAll('.kcards > *')].map((c) => c.className), shared: [...document.querySelectorAll('#hcards > *')].map((c) => c.className), brief: document.body.innerHTML.includes('重点字'), rects: els.map((e) => [Math.round(r(e).left), Math.round(r(e).top), Math.round(r(e).bottom)]), heights: [...new Set(els.map((e) => e.offsetHeight))] }; })()`);
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);

  // ---- 孩子端首页 ----
  await device(390, 844, 2, true);
  await open(`${base}/`);
  const v0 = await stack();
  ok('叠的顺序:家长排第一的(语文)在最前(最上层),排第二的(数学)紧挨在后面,补的英语在最底下', v0.order.join() === 'english-tutor,math-tutor,chinese-tutor' && v0.front.join() === 'chinese-tutor' && v0.card === 'chinese-tutor' && v0.name === '语文老师', JSON.stringify(v0));
  ok('语文的卡:按钮齐(接着的就是今天那个话题,不再加「接着刚才的」);「每天都在」有拍照听写;讲法不在页面里', v0.buttons.join('|') === '新话题|我要预习小蝌蚪找妈妈|接着讲刚才的板书' && v0.extras.join() === '/dictation?tutor=chinese-tutor' && !v0.brief, JSON.stringify(v0.buttons));
  ok('手机竖着叠:后面的牌在上面、一张比一张高,左边对齐;几张牌一样高', v0.rects[0][1] < v0.rects[1][1] && v0.rects[1][1] < v0.rects[2][1] && v0.heights.length === 1, JSON.stringify([v0.rects, v0.heights]));
  ok('卡的归属:写在老师卡前面的一段字是公共的(牌堆上面);跟在数学后面的田字格不在语文的牌里', v0.shared.length === 1 && v0.shared[0].includes('c-text') && v0.owned.length === 0, JSON.stringify([v0.shared, v0.owned]));
  ok('橙点:数学(家长排了按钮、孩子还没找过)亮;最前的语文、什么都没排的英语不亮', v0.dots.join() === 'math-tutor', JSON.stringify(v0.dots));
  console.log('  ', await shot('home-phone.png'));

  // ---- 点后面的数学:抽出 → 换到最上层 → 落到最前 ----
  await tapAvatar('math-tutor');
  await sleep(400);
  const mid = await evaluate(`(() => { const m = document.querySelector('#deck .pc[data-tutor="math-tutor"]'); return { z: m.style.zIndex, moving: m.getAnimations().length > 0, front: document.querySelectorAll('#deck .pc.front').length }; })()`);
  ok('换牌途中(400 ms):数学已换到最上层、还在飘;这时没有哪张是最前(按钮点不到)', mid.z === '50' && mid.moving && mid.front === 0, JSON.stringify(mid));
  await sleep(250);
  const bite = await evaluate(`document.querySelector('#deck .pc[data-tutor="math-tutor"] .pc-hd .ring circle').getAnimations().length > 0`);
  ok('落下时张嘴:新的最前那张开口一张一合', bite);
  await sleep(700);
  const v1 = await stack();
  ok('换位:数学到最前,语文往上让一格,英语不动;田字格归数学、在他的牌里;橙点灭', v1.order.join() === 'english-tutor,chinese-tutor,math-tutor' && v1.front.join() === 'math-tutor' && v1.card === 'math-tutor' && v1.name === '数学老师' && v1.buttons.join('|') === '新话题|再练两道退位减法' && v1.owned.length === 1 && v1.owned[0].includes('c-tianzige') && v1.dots.length === 0 && v1.extras.length === 0, JSON.stringify(v1));
  await tapAvatar('math-tutor');
  await sleep(400);
  ok('点最前那张:不换人', (await stack()).order.join() === v1.order.join());
  await sleep(5600);
  const v2 = await stack();
  ok('5 秒一轮的刷新:顺序与展开的老师不变', v2.order.join() === v1.order.join() && v2.card === 'math-tutor', JSON.stringify(v2.order));
  await device(1180, 820, 1, false);
  await sleep(300);
  const vt = await stack();
  ok('平板横屏:横着叠,后面的牌在左边、一张比一张靠左,底对齐(往后一张缩一点,是从左下角缩的)', vt.rects[0][0] < vt.rects[1][0] && vt.rects[1][0] < vt.rects[2][0] && Math.abs(vt.rects[2][2] - vt.rects[0][2]) < 2 && vt.card === 'math-tutor', JSON.stringify(vt.rects));
  console.log('  ', await shot('home-tablet.png'));

  // ---- 新话题:空白老师页;回来停在刚才那位 ----
  await device(390, 844, 2, true);
  await evaluate(`document.querySelector('#deck .pc.front .bt-new').click()`);
  await sleep(600);
  const blank = await evaluate(`({ on: document.querySelector('#tutor').classList.contains('on'), blank: document.querySelector('#board .blank b')?.textContent, mo: document.querySelector('#c-mo').textContent })`);
  ok('新话题:空白老师页,等孩子开口;胶囊旁不挂「新话题」小标签(《产品规划.md》拍板 26)', blank.on && blank.blank === '想问什么?' && blank.mo === '', JSON.stringify(blank));
  await evaluate(`document.querySelector('#back').click()`);
  await sleep(1500);
  ok('从老师页回来:还是数学在最前', (await stack()).card === 'math-tutor');
  await tapAvatar('chinese-tutor');
  await sleep(900);

  // ---- 开场按钮:老师页打开,按钮上的字发出去 ----
  await evaluate(`[...document.querySelectorAll('#deck .pc.front[data-tutor="chinese-tutor"] .bt')].find((b) => b.textContent.includes('预习')).click()`);
  await sleep(500);
  const d = await settle('chinese-tutor');
  const idx = (await api('GET', '/api/conversations/chinese-tutor/today')).json?.index;
  const last = idx?.messages[idx.messages.length - 1];
  ok('开场:按钮上的字发给语文老师、新话题、带 via', last?.text === '我要预习小蝌蚪找妈妈' && last?.via?.button === 0 && last.thread === last.job, JSON.stringify({ text: last?.text, via: last?.via, thread: last?.thread }));
  await sleep(1500);
  const page = await evaluate(`({ secs: document.querySelectorAll('#board .sec').length, blank: !!document.querySelector('#board .blank') })`);
  ok('老师页铺上了这一节', d && page.secs === 1 && !page.blank, JSON.stringify(page));
  console.log('  ', await shot('tutor-after-start.png'));

  ws.close();
} finally {
  mouth.close();
  if (browser) browser.kill();
  if (!keep) {
    serve.kill();
    if (outAt < 0) console.log(`截图在 ${shots}(临时目录,--out 指定目录可以留下)`);
    else rmSync(root, { recursive: true, force: true });
  } else console.log(`留着:workspace ${root},serve ${base}(pid ${serve.pid})`);
}
