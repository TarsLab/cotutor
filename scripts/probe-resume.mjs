#!/usr/bin/env node
/**
 * 「接着刚才的」挪到空白板(《wip/activity设计.md》§八,设计稿 https://claude.ai/artifact/QkJBzLVbL7tgfEGKcDjaRm)的手动验收
 * (不进 pnpm test,要本机 Chrome;老师是假 CLI,不花钱):
 * 临时 workspace + HTTP serve → 语文老师先有一个自由话题、一个你说我画话题 → 发布带 `activity 你说我画` 的首页 →
 * Chrome 开孩子端:牌上没有「接着刚才的」→ 新话题的空白板有胶囊,点了回到那个话题 →
 * 点你说我画:先问「接着刚才那个 / 重新开始」(输入条藏着,没发消息)→ 接着:回到那个话题 → 再点、重新开始:按钮字发出去、新话题记 activity。
 *
 * 用法:node scripts/probe-resume.mjs [--out <截图目录>] [--keep]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS, quiet } from './_quiet.mjs';

const keep = process.argv.includes('--keep');
const outAt = process.argv.indexOf('--out');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8794;
const cdp = 9336;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, detail = '') => { if (!cond) failed++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const home = mkdtempSync(join(tmpdir(), 'cotutor-probe-resume-'));
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
for (const t of Object.values(cfg.tutors)) delete t.runtime;
cfg.server.port = port;
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

const serve = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'serve', '--workspace', root, '--http'], { env: { ...process.env, HOME: home }, stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }
const api = async (method, path, body) => { const r = await fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
const settle = async (tutor) => { for (let i = 0; i < 80; i++) { const d = (await api('GET', `/api/kid/conversations/${tutor}/today`)).json; if (d && !d.pending && d.messages.every((m) => !m.pending)) return d; await sleep(250); } return null; };
const index = async () => (await api('GET', '/api/conversations/chinese-tutor/today')).json?.index;

let browser = null;
try {
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  mkdirSync(join(root, 'home'), { recursive: true });
  writeFileSync(join(root, 'home', 'draft.md'), `---\nfor: ${day}\n---\n\n\`\`\`tutor chinese-tutor\nactivity 你说我画\n\`\`\`\n\n## 为什么这么排\n\n- 探针\n`);
  const pub = await run(['home', 'publish', '--workspace', root]);
  ok('cotutor home publish', pub.includes('发布了'), pub.split('\n')[0]);
  const homeId = (await api('GET', '/api/kid/home')).json?.home;

  // ---- 今天先有两个话题:新话题进去的自由话题、你说我画 ----
  const free = await api('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '鼓励怎么写', newThread: true, via: { home: homeId, button: 'new' } });
  await settle('chinese-tutor');
  const act = await api('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '', newThread: true, via: { home: homeId, button: 0 } });
  await settle('chinese-tutor');
  await api('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '小熊和小猴种西瓜', thread: act.json?.thread });
  await settle('chinese-tutor');
  const freeThread = free.json?.thread;
  const actThread = act.json?.thread;
  ok('准备:自由话题与你说我画话题', Boolean(freeThread && actThread && freeThread !== actThread), JSON.stringify([free.status, act.status]));

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
  // 手指点:CDP 鼠标事件走命中判定
  const tap = async (selector) => { const r = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`); if (!r) throw new Error(`没有 ${selector}`); for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }); };
  const tapButton = async (text) => { await evaluate(`(() => { for (const b of document.querySelectorAll('#deck .pc.front .bt')) b.toggleAttribute('data-probe', b.querySelector('.btx')?.textContent === ${JSON.stringify(text)}); })()`); await tap('#deck .pc.front .bt[data-probe]'); };
  const openHome = async () => { await send('Page.navigate', { url: `${base}/` }); for (let i = 0; i < 40; i++) { if (await evaluate(`document.querySelectorAll('#deck .pc.front .bt').length > 0`)) break; await sleep(250); } await sleep(1200); };
  const backHome = async () => { await tap('#back'); await sleep(1500); };
  const boardState = () => evaluate(`({ secs: document.querySelectorAll('#board .sec').length, blank: !!document.querySelector('#board .blank'), chip: document.querySelector('#board .blank .resume')?.textContent ?? null, ask: document.querySelector('#board .blank.ask b')?.textContent ?? null, choices: [...document.querySelectorAll('#board .ask-go')].map((b) => b.textContent), pill: !document.querySelector('#pill').hidden, mo: document.querySelector('#c-mo').textContent })`);
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });

  await openHome();
  const buttons = await evaluate(`[...document.querySelectorAll('#deck .pc.front .bt:not(.bt-extra)')].map((b) => b.querySelector('.btx').textContent)`);
  ok('首页语文牌:新话题、你说我画;没有应用加的「接着刚才的」', buttons.join('|') === '新话题|你说我画', JSON.stringify(buttons));

  // ---- 新话题:空白板上的胶囊 → 回到那个自由话题 ----
  await tapButton('新话题');
  await sleep(700);
  const b1 = await boardState();
  ok('新话题:空白板「想问什么?」下面一个胶囊,写着那个话题孩子的第一句', b1.blank && b1.chip?.includes('接着刚才的:鼓励怎么写') && b1.pill, JSON.stringify(b1));
  console.log('  ', await shot('resume-new.png'));
  const n0 = (await index()).messages.length;
  await tap('#board .blank .resume');
  await sleep(1500);
  const b2 = await boardState();
  const t2 = await evaluate(`document.querySelector('#c-mo').textContent`);
  ok('点胶囊:回到那个话题,照旧铺开,能接着说', b2.secs >= 1 && !b2.blank && b2.pill, JSON.stringify({ b2, t2 }));
  const before = (await index()).messages.length;
  ok('点胶囊不发消息', before === n0, `${n0} → ${before}`);
  await backHome();

  // ---- 你说我画:今天点过,先问 ----
  await tapButton('你说我画');
  await sleep(800);
  const b3 = await boardState();
  const n3 = (await index()).messages.length;
  ok('你说我画今天点过:先问接着还是重新开始;输入条藏着;没发消息', b3.ask === '今天点过「你说我画」啦' && b3.choices.length === 2 && b3.choices[0].includes('接着刚才那个') && b3.choices[0].includes('小熊和小猴种西瓜') && b3.choices[1].includes('重新开始') && !b3.pill && n3 === before, JSON.stringify({ b3, n3, before }));
  console.log('  ', await shot('resume-ask.png'));
  await tap('#board .ask-go.back');
  await sleep(1500);
  const b4 = await boardState();
  ok('接着刚才那个:回到你说我画那个话题,输入条回来', b4.secs >= 2 && !b4.blank && b4.pill, JSON.stringify(b4));
  await backHome();

  await tapButton('你说我画');
  await sleep(800);
  await tap('#board .ask-go.fresh');
  await settle('chinese-tutor');
  await sleep(1500);
  const idx = await index();
  const last = idx.messages.filter((m) => m.from === 'kid').pop();
  ok('重新开始:按钮上的字发出去,新话题,记着你说我画与 via', last?.text === '你说我画' && last.thread === last.job && last.activity?.name === '你说我画' && last.via?.button === 0 && last.thread !== actThread, JSON.stringify({ text: last?.text, thread: last?.thread, act: last?.activity, via: last?.via }));
  const b5 = await boardState();
  ok('老师页铺上新的一节', b5.secs === 1 && !b5.blank, JSON.stringify(b5));

  // ---- 手机:空白板的胶囊与两个选择不挤出屏幕 ----
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await backHome();
  await tapButton('你说我画');
  await sleep(800);
  const fit = await evaluate(`(() => { const r = [...document.querySelectorAll('#board .ask-go')].map((b) => b.getBoundingClientRect()); return r.every((x) => x.left >= 0 && x.right <= innerWidth) && document.documentElement.scrollWidth <= innerWidth; })()`);
  ok('手机:两个选择叠成两行,不出横向滚动', fit);
  console.log('  ', await shot('resume-ask-phone.png'));

  ws.close();
} finally {
  if (browser) browser.kill();
  if (!keep) {
    serve.kill();
    if (outAt < 0) console.log(`截图在 ${shots}(临时目录,--out 指定目录可以留下)`);
    else rmSync(root, { recursive: true, force: true });
  } else console.log(`留着:workspace ${root},serve ${base}(pid ${serve.pid})`);
  if (failed) process.exitCode = 1;
}
