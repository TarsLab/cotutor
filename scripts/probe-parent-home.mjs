#!/usr/bin/env node
/**
 * 家长端「首页」(/parent/home,《家长板书页设计.md》拍板 20)的手动验收(不进 pnpm test,要本机 Chrome;老师是假 CLI,不花钱):
 * 临时 workspace + HTTP serve → 手机尺寸开 /parent/home → 给英语老师加一个开场按钮(字、讲法、只今天)→ 发布了、孩子端看得到 →
 * 设语文这周的词 → 把数学调到第一 → 孩子端的先后跟着变 → 「记录」有两个标签,听写那一行挂在语文下面;截图。
 *
 * 用法:node scripts/probe-parent-home.mjs [--out <截图目录>] [--keep]
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
const ok = (name, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);

const home = mkdtempSync(join(tmpdir(), 'cotutor-probe-parent-home-'));
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
cfg.server.port = port;
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

const serve = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'serve', '--workspace', root, '--http'], { env: { ...process.env, HOME: home }, stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }
const api = async (method, path, body) => { const r = await fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
const settle = async (tutor) => { for (let i = 0; i < 80; i++) { const d = (await api('GET', `/api/kid/conversations/${tutor}/today`)).json; if (d && !d.pending && d.messages.every((m) => !m.pending)) return d; await sleep(250); } return null; };

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${cdp}`, '--window-size=780,1688', `--user-data-dir=${join(home, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const until = async (expr, n = 40) => { for (let i = 0; i < n; i++) { if (await evaluate(expr).catch(() => false)) return true; await sleep(250); } return false; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
  const tap = async (expr) => { const r = await evaluate(`(() => { const el = ${expr}; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`); for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }); await sleep(150); };
  const byTitle = (text) => `[...document.querySelectorAll('#body .it')].find((x) => x.querySelector('b')?.textContent === '${text}')`;
  const byText = (sel, text) => `[...document.querySelectorAll('${sel}')].find((x) => x.textContent.includes('${text}'))`;
  const typeInto = async (sel, text) => { await evaluate(`(() => { const el = document.querySelector('${sel}'); el.focus(); el.value = ''; el.dispatchEvent(new Event('input')); })()`); await send('Input.insertText', { text }); await sleep(100); };
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `${base}/parent/home` });
  ok('打开:三位老师,语文在前;「首页」标签亮着', await until(`document.querySelectorAll('#who .mini').length === 3 && document.querySelector('.seg .on')?.textContent === '首页' && document.querySelector('#who .mini.on')?.textContent.includes('语文')`));
  console.log('  ', await shot('parent-home.png'));

  // ---- 英语老师加一个开场按钮 ----
  await tap(byText('#who .mini', '英语'));
  await until(`!!${byText('#body .it', '加一个开场按钮')}`);
  await tap(byText('#body .it', '加一个开场按钮'));
  ok('表单:缺省「只今天」,字为空时发布灰着', await until(`document.querySelector('#sheet').classList.contains('on') && document.querySelector('#sheet .seg .on')?.textContent === '只今天' && document.querySelector('#sheet .nav button:last-child').disabled`));
  await typeInto('#b-label', '我想说说我的小汽车');
  await typeInto('#b-brief', '多问他喜欢什么颜色');
  const form = await evaluate(`({ count: document.querySelector('#sheet .gh span').textContent, prev: document.querySelector('#sheet .pill').textContent })`);
  ok('打字:计数 9 / 16,「孩子看到的」跟着变', form.count === '9 / 16' && form.prev === '我想说说我的小汽车', JSON.stringify(form));
  console.log('  ', await shot('parent-button.png'));
  await tap(`document.querySelector('#sheet .nav button:last-child')`);
  await until(`!document.querySelector('#sheet').classList.contains('on')`);
  const kid1 = (await api('GET', '/api/kid/home')).json;
  const enBtns = kid1.cards.find((c) => c.kind === 'tutor' && c.props.tutor === 'english-tutor')?.props.buttons.map((b) => b.label);
  ok('发布了:孩子端英语老师多了这个按钮,讲法不下发;家长端那一行写着「只今天」', enBtns?.join() === '新话题,我想说说我的小汽车' && !JSON.stringify(kid1).includes('颜色') && await until(`!!${byText('#body .it', '我想说说我的小汽车')} && ${byText('#body .it', '我想说说我的小汽车')}.textContent.includes('只今天')`), JSON.stringify(enBtns));

  // ---- 语文这周的词 ----
  await tap(byText('#who .mini', '语文'));
  await until(`!!${byTitle('这周的词')}`);
  await tap(byTitle('这周的词'));
  await until(`document.querySelector('#sheet').classList.contains('on')`);
  await typeInto('#w-text', '春天\n叶 树叶的叶');
  await tap(`document.querySelector('#sheet .nav button:last-child')`);
  ok('这周的词:发布了,那一行写着「2 个词:春天、叶」', await until(`!document.querySelector('#sheet').classList.contains('on') && ${byTitle('这周的词')}.textContent.includes('2 个词:春天、叶')`));
  const kid2 = (await api('GET', '/api/kid/home')).json;
  ok('孩子端:一张归语文的听写卡,看不到字', kid2.cards.some((c) => c.kind === 'dictation' && c.owner === 'chinese-tutor' && c.props.count === 2) && !JSON.stringify(kid2).includes('春天'));

  // ---- 数学调到第一 ----
  await tap(byText('#who .mini', '数学'));
  await until(`${byText('#body .it', '排在第')}.textContent.includes('第 3')`);
  await tap(`document.querySelector('[aria-label="往前"]')`);
  await until(`${byText('#body .it', '排在第')}.textContent.includes('第 2')`);
  await tap(`document.querySelector('[aria-label="往前"]')`);
  ok('调先后:数学排第 1', await until(`${byText('#body .it', '排在第')}.textContent.includes('第 1') && document.querySelector('#who .mini')?.textContent.includes('数学')`));
  const kid3 = (await api('GET', '/api/kid/home')).json;
  ok('孩子端:老师卡的先后跟着变', kid3.cards.filter((c) => c.kind === 'tutor').map((c) => c.props.tutor).join() === 'math-tutor,english-tutor,chinese-tutor', kid3.cards.filter((c) => c.kind === 'tutor').map((c) => c.props.tutor).join());
  console.log('  ', await shot('parent-home-after.png'));

  // ---- 记录:两个标签,听写挂在语文下面 ----
  const h0 = kid3.home;
  const n = kid3.cards.filter((c) => c.kind === 'dictation').length - 1;
  const st = await api('POST', '/api/dictation', { home: h0, n });
  ok('开一次听写(孩子端点「听写」)', st.status === 201, JSON.stringify(st.json).slice(0, 120));
  await tap(`[...document.querySelectorAll('.seg a')].find((a) => a.textContent === '记录')`);
  ok('「记录」:有两个标签,「记录」亮着;听写那一行挂在语文下面,点了去录像', await until(`location.pathname === '/parent' && document.querySelector('#ptabs .on')?.textContent === '记录' && !!document.querySelector('.pt[data-tutor="chinese-tutor"] a.tr-x[href^="/dictation/reel?id="]')`, 80));
  console.log('  ', await shot('parent-record.png'));
  await tap(`[...document.querySelectorAll('#ptabs a')].find((a) => a.textContent === '首页')`);
  ok('「首页」标签回到 /parent/home', await until(`location.pathname === '/parent/home'`));
  ws.close();
} finally {
  if (browser) browser.kill();
  if (!keep) {
    serve.kill();
    if (outAt < 0) console.log(`截图在 ${shots}(临时目录,--out 指定目录可以留下)`);
    else rmSync(root, { recursive: true, force: true });
  } else console.log(`留着:workspace ${root},serve ${base}(pid ${serve.pid})`);
}
