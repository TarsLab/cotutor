#!/usr/bin/env node
/**
 * 首页(《首页设计.md》)的手动验收(不进 pnpm test,要本机 Chrome;老师是假 CLI,不花钱):
 * 临时 workspace + HTTP serve → 语文老师先讲一轮(给「接着」一个话题)→ 写草稿、cotutor home publish →
 * Chrome 开孩子端:老师卡置顶、按钮齐、讲法不在页面里;手机与平板各截一张 →
 * 点「新话题」是空白老师页 → 回首页点开场按钮:老师页打开、按钮上的字发出去、索引里那条带 via →
 * 家长端「首页」页:预览 iframe 在、右边有发布与点击;截一张。
 *
 * 用法:node scripts/probe-home.mjs [--out <截图目录>] [--keep](留下临时 workspace 与 serve)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const keep = process.argv.includes('--keep');
const outAt = process.argv.indexOf('--out');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8793;
const cdp = 9335;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);

const home = mkdtempSync(join(tmpdir(), 'cotutor-probe-home-'));
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
cfg.policyDefaults = { post: { mode: 'off' } };
cfg.server.port = port;
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

const serve = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'serve', '--workspace', root, '--http'], { env: { ...process.env, HOME: home }, stdio: 'ignore', detached: keep });
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

\`\`\`tutor chinese-tutor
我要预习小蝌蚪找妈妈
讲法: 第 22 课。先带他把 1–3 自然段读顺,重点字 塘、脑、袋
接着 ${day} ${thread} 接着讲刚才的板书
\`\`\`

\`\`\`tutor math-tutor
再练两道退位减法
讲法: 出 52−7、80−3,先让他说怎么想
\`\`\`

\`\`\`text
# 今晚
先读课文,再练两道题
\`\`\`

\`\`\`tianzige
塘脑袋
\`\`\`

## 为什么这么排

- 探针
`);
  const pub = await run(['home', 'publish', '--workspace', root]);
  ok('cotutor home publish', pub.includes('发布了'), pub.split('\n')[0]);

  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(home, 'chrome')}`, `${base}/`], { stdio: 'ignore' });
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
  const open = async (url) => { await send('Page.navigate', { url }); for (let i = 0; i < 40; i++) { if (await evaluate(`document.querySelectorAll('.c-tutor').length > 0 || !!document.querySelector('#home-side')`)) break; await sleep(250); } await sleep(300); };
  await send('Runtime.enable');
  await send('Page.enable');

  // ---- 孩子端首页 ----
  await device(390, 844, 2, true);
  await open(`${base}/`);
  const view = await evaluate(`(() => ({ tutors: [...document.querySelectorAll('.c-tutor')].map((c) => ({ who: c.dataset.tutor, buttons: [...c.querySelectorAll('.bt')].map((b) => b.textContent) })), cards: [...document.querySelectorAll('#hcards > *')].map((c) => c.className), html: document.body.innerHTML.includes('重点字') }))()`);
  ok('老师卡置顶:语文 / 数学 / 英语(补的),按钮齐(接着的就是今天那个话题,不再加「接着刚才的」)', view.tutors.map((t) => t.who).join() === 'chinese-tutor,math-tutor,english-tutor' && view.tutors[0].buttons.join('|') === '新话题|我要预习小蝌蚪找妈妈|接着讲刚才的板书' && view.tutors[2].buttons.join('|') === '新话题', JSON.stringify(view.tutors));
  ok('其余卡:一段字、田字格;讲法不在页面里', view.cards.length === 2 && view.cards[0].includes('c-text') && view.cards[1].includes('c-tianzige') && !view.html, JSON.stringify(view.cards));
  console.log('  ', await shot('home-phone.png'));
  await device(1180, 820, 1, false);
  await sleep(300);
  const cols = await evaluate(`getComputedStyle(document.querySelector('#tutors')).gridTemplateColumns.split(' ').length`);
  ok('平板横屏:老师卡并排', cols >= 2, `${cols} 列`);
  console.log('  ', await shot('home-tablet.png'));

  // ---- 新话题:空白老师页 ----
  await device(390, 844, 2, true);
  await evaluate(`document.querySelector('.c-tutor[data-tutor="math-tutor"] .bt-new').click()`);
  await sleep(600);
  const blank = await evaluate(`({ on: document.querySelector('#tutor').classList.contains('on'), blank: document.querySelector('#board .blank b')?.textContent, mo: document.querySelector('#c-mo').textContent })`);
  ok('新话题:空白老师页,等孩子开口', blank.on && blank.blank === '想问什么?' && blank.mo === '新话题', JSON.stringify(blank));
  await evaluate(`document.querySelector('#back').click()`);
  await sleep(800);

  // ---- 开场按钮:老师页打开,按钮上的字发出去 ----
  await evaluate(`[...document.querySelectorAll('.c-tutor[data-tutor="chinese-tutor"] .bt')].find((b) => b.textContent.includes('预习')).click()`);
  await sleep(500);
  const d = await settle('chinese-tutor');
  const idx = (await api('GET', '/api/conversations/chinese-tutor/today')).json?.index;
  const last = idx?.messages[idx.messages.length - 1];
  ok('开场:按钮上的字发给语文老师、新话题、带 via', last?.text === '我要预习小蝌蚪找妈妈' && last?.via?.button === 0 && last.thread === last.job, JSON.stringify({ text: last?.text, via: last?.via, thread: last?.thread }));
  await sleep(1500);
  const page = await evaluate(`({ secs: document.querySelectorAll('#board .sec').length, blank: !!document.querySelector('#board .blank') })`);
  ok('老师页铺上了这一节', d && page.secs === 1 && !page.blank, JSON.stringify(page));
  console.log('  ', await shot('tutor-after-start.png'));

  // ---- 家长端「首页」页 ----
  await device(1440, 900, 1, false);
  await send('Page.navigate', { url: `${base}/dev#home` });
  for (let i = 0; i < 40; i++) { if (await evaluate(`!!document.querySelector('#home-side .panel')`)) break; await sleep(250); }
  await sleep(2500);
  const parent = await evaluate(`({ frame: document.querySelector('#home iframe')?.getAttribute('src'), panels: [...document.querySelectorAll('#home-side .panel h4')].map((x) => x.textContent), clicks: document.querySelector('#home-side')?.textContent.includes('点了 1 次'), briefs: document.querySelector('#home-side')?.textContent.includes('讲法:第 22 课') })`);
  ok('工作台首页页:预览 iframe、草稿与已发布两块、讲法与点击', parent.frame === '/dev/home-preview?which=draft' && parent.panels.join() === '草稿,已发布' && parent.clicks && parent.briefs, JSON.stringify(parent));
  console.log('  ', await shot('parent-home.png'));
  ws.close();
} finally {
  if (browser) browser.kill();
  if (!keep) {
    serve.kill();
    if (outAt < 0) console.log(`截图在 ${shots}(临时目录,--out 指定目录可以留下)`);
    else rmSync(root, { recursive: true, force: true });
  } else console.log(`留着:workspace ${root},serve ${base}(pid ${serve.pid})`);
}
