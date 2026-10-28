#!/usr/bin/env node
/**
 * 家长端「首页」(/parent/home)的手动验收(不进 pnpm test,要本机 Chrome;老师是假 CLI,不花钱):
 * 临时 workspace + HTTP serve → 手机尺寸开 /parent/home:预览是孩子端首页本身(/preview)→ 给英语老师加一个开场按钮 → 发布了、孩子端与预览都有 →
 * 在预览里点后面那张换老师、设语文这周的词 → 一排里拖数学到第一 → 宽屏:在预览里点那颗、右栏改、改字时预览跟着变、切手机样子、拖语文到第一 →
 * 「记录」有两个标签,时间线上有这次听写;截图。
 *
 * 用法:node scripts/probe-parent-home.mjs [--out <截图目录>] [--keep]
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
const port = 8794;
const cdp = 9336;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);

const home = probeDir('cotutor-probe-parent-home-');
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

// 老师都走实时:嘴是假百炼,serve 认 COTUTOR_LIVE_ENDPOINT(当百炼配好了)
const { startFakeRealtime } = await import(join(repo, 'tests', '_fake-realtime.ts'));
const mouth = await startFakeRealtime();
const serve = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'serve', '--workspace', root, '--http'], { env: { ...process.env, HOME: home, COTUTOR_LIVE_ENDPOINT: mouth.endpoint }, stdio: 'ignore', detached: keep });
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
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `${base}/parent/home` });
  // 预览里的东西(iframe 同源,直接读它的 DOM);点预览里的东西用 CDP 鼠标(iframe 缩着,坐标照缩放算)
  const pv = (expr) => `(() => { const d = document.querySelector('#pvf').contentDocument; return d ? (${expr}) : null; })()`;
  const tapPv = async (expr) => {
    const r = await evaluate(`(() => { const f = document.querySelector('#pvf'), d = f.contentDocument, el = ${expr}; const fr = f.getBoundingClientRect(), k = fr.width / f.offsetWidth, b = el.getBoundingClientRect(); return { x: fr.left + (b.left + b.width / 2) * k, y: fr.top + (b.top + b.height / 2) * k }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await sleep(200);
  };
  const front = pv(`d.querySelector('#deck .pc.front')?.dataset.tutor`);
  const drag = async (sel, dx) => {
    const g = await evaluate(`(() => { const el = ${sel}; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.x, y: g.y, button: 'left', clickCount: 1 });
    for (let k = 1; k <= 10; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x + (dx * k) / 10, y: g.y, button: 'left', buttons: 1 }); await sleep(30); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.x + dx, y: g.y, button: 'left', clickCount: 1 });
    await sleep(300);
  };
  ok('打开:三位老师一排,语文在前;「首页」标签亮着;预览里是孩子端首页本身(牌堆三张,语文在最前)', await until(`document.querySelectorAll('.ord .ch').length === 3 && document.querySelector('.seg .on')?.textContent === '首页' && document.querySelector('.ord .ch.on')?.textContent.includes('语文') && ${pv(`d.querySelectorAll('#deck .pc').length === 3`)} && ${front} === 'chinese-tutor'`, 60));
  console.log('  ', await shot('parent-home.png'));

  // ---- 英语老师加一个开场按钮(手机:点下面的「加一个」→ 整屏的表单) ----
  await tap(byText('.ord .ch', '英语'));
  ok('点一排里的英语:预览里英语那张换到最前', await until(`${front} === 'english-tutor'`));
  await tap(`document.querySelector('#pv-under .addb')`);
  ok('表单:缺省「只今天」,字为空时发布灰着', await until(`document.querySelector('#sheet').classList.contains('on') && document.querySelector('#sheet .seg .on')?.textContent === '只今天' && document.querySelector('#sheet .nav button:last-child').disabled`));
  await typeInto('#b-label', '我想说说我的小汽车');
  await typeInto('#b-brief', '多问他喜欢什么颜色');
  const form = await evaluate(`({ count: document.querySelector('#sheet .gh span').textContent, go: document.querySelector('#sheet .nav button:last-child').disabled })`);
  ok('打字:计数 9 / 16,发布能点了', form.count === '9 / 16' && !form.go, JSON.stringify(form));
  console.log('  ', await shot('parent-button.png'));
  await tap(`document.querySelector('#sheet .nav button:last-child')`);
  await until(`!document.querySelector('#sheet').classList.contains('on')`);
  const kid1 = (await api('GET', '/api/kid/home')).json;
  const enBtns = kid1.cards.find((c) => c.kind === 'tutor' && c.props.tutor === 'english-tutor')?.props.buttons.map((b) => b.label);
  ok('发布了:孩子端英语老师多了这个按钮,讲法不下发;预览里英语那张也有了', enBtns?.join() === '新话题,我想说说我的小汽车' && !JSON.stringify(kid1).includes('颜色') && await until(pv(`[...d.querySelectorAll('#deck .pc[data-tutor="english-tutor"] .btx')].some((x) => x.textContent === '我想说说我的小汽车')`)), JSON.stringify(enBtns));

  // ---- 语文这周的词:在预览里点语文那张(后面那张,照孩子端换到最前),再改这周的词 ----
  await tapPv(`d.querySelector('#deck .pc[data-tutor="chinese-tutor"] .pc-hd')`);
  ok('预览里点后面那张(语文):换到最前,家长页也换到语文', await until(`${front} === 'chinese-tutor' && document.querySelector('.ord .ch.on')?.textContent.includes('语文')`));
  await until(`!!${byTitle('这周的词')}`);
  await tap(byTitle('这周的词'));
  await until(`document.querySelector('#sheet').classList.contains('on')`);
  await typeInto('#w-text', '春天\n叶 树叶的叶');
  await tap(`document.querySelector('#sheet .nav button:last-child')`);
  ok('这周的词:发布了,那一行写着「2 个词:春天、叶」', await until(`!document.querySelector('#sheet').classList.contains('on') && ${byTitle('这周的词')}.textContent.includes('2 个词:春天、叶')`));
  const kid2 = (await api('GET', '/api/kid/home')).json;
  ok('孩子端:一张归语文的听写卡,看不到字', kid2.cards.some((c) => c.kind === 'dictation' && c.owner === 'chinese-tutor' && c.props.count === 2) && !JSON.stringify(kid2).includes('春天'));

  // ---- 数学调到第一:一排里按住数学往左拖两格 ----
  const order0 = await evaluate(`[...document.querySelectorAll('.ord .ch')].map((c) => c.dataset.tutor).join()`);
  const step = await evaluate(`document.querySelectorAll('.ord .ch')[1].getBoundingClientRect().left - document.querySelectorAll('.ord .ch')[0].getBoundingClientRect().left`);
  await drag(`document.querySelector('.ord .ch[data-tutor="math-tutor"]')`, -2 * step);
  ok('拖着排:数学排第一', await until(`document.querySelector('.ord .ch')?.dataset.tutor === 'math-tutor'`), order0);
  const kid3 = (await api('GET', '/api/kid/home')).json;
  ok('孩子端:老师卡的先后跟着变;预览里牌堆的先后也跟着变(排第一的在最前)', kid3.cards.filter((c) => c.kind === 'tutor')[0].props.tutor === 'math-tutor' && await until(`${front} === 'math-tutor'`), kid3.cards.filter((c) => c.kind === 'tutor').map((c) => c.props.tutor).join());
  console.log('  ', await shot('parent-home-after.png'));

  // ---- 宽屏:预览在左、右边就地改;在预览里点按钮改它,改字时牌上跟着变 ----
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  ok('宽屏:两栏,预览在左、按 iPad 横屏的尺寸缩着', await until(`getComputedStyle(document.querySelector('.main')).display === 'grid' && document.querySelector('#pv').getBoundingClientRect().right < document.querySelector('#body').getBoundingClientRect().left && document.querySelector('#pvf').offsetWidth === 1180`));
  await tap(byText('.ord .ch', '英语'));
  await until(`${front} === 'english-tutor'`);
  await sleep(1000);
  await tapPv(`[...d.querySelectorAll('#deck .pc.front .bt')].find((x) => x.textContent.includes('我想说说我的小汽车'))`);
  ok('在预览里点那颗:右栏出表单,字是那颗的;预览里那颗框起来', await until(`document.querySelector('#body #b-label')?.value === '我想说说我的小汽车' && ${pv(`!!d.querySelector('#deck .pc.front .bt.pv-sel')`)} && !document.querySelector('#sheet').classList.contains('on')`));
  await typeInto('#b-label', '我想讲讲小汽车');
  ok('改字时预览里那颗跟着变,孩子端还是原来的(没发布)', await until(pv(`d.querySelector('#deck .pc.front .bt.pv-sel .btx')?.textContent === '我想讲讲小汽车'`)) && (await api('GET', '/api/kid/home')).json.cards.find((c) => c.kind === 'tutor' && c.props.tutor === 'english-tutor').props.buttons.some((b) => b.label === '我想说说我的小汽车'));
  console.log('  ', await shot('parent-home-wide.png'));
  await tap(`document.querySelector('#body .btns .go')`);
  await until(pv(`[...d.querySelectorAll('#deck .pc[data-tutor="english-tutor"] .btx')].some((x) => x.textContent === '我想讲讲小汽车')`));
  const kid4 = (await api('GET', '/api/kid/home')).json;
  ok('右栏发布:孩子端那颗换了字,表单还开着', kid4.cards.find((c) => c.kind === 'tutor' && c.props.tutor === 'english-tutor')?.props.buttons.some((b) => b.label === '我想讲讲小汽车') && await until(`document.querySelector('#body #b-label')?.value === '我想讲讲小汽车'`));
  // 切到手机的样子:预览按手机的尺寸开,牌竖着叠
  await tap(`document.querySelector('#pvdev button[data-d="phone"]')`);
  ok('切到手机:预览按手机的尺寸开,牌竖着叠', await until(`document.querySelector('#pvf').offsetWidth === 390`) && await until(pv(`(() => { const a = [...d.querySelectorAll('#deck .pc')].map((x) => x.getBoundingClientRect()); const mid = (r) => r.left + r.width / 2; return a.length === 3 && Math.abs(mid(a[0]) - mid(a[2])) < 2 && Math.abs(a[0].top - a[2].top) > 20; })()`)));
  console.log('  ', await shot('parent-home-wide-phone.png'));
  await tap(`document.querySelector('#pvdev button[data-d="tablet"]')`);
  // 拖:按住语文往左拖到第一
  const s2 = await evaluate(`document.querySelectorAll('.ord .ch')[1].getBoundingClientRect().left - document.querySelectorAll('.ord .ch')[0].getBoundingClientRect().left`);
  const ci = await evaluate(`[...document.querySelectorAll('.ord .ch')].findIndex((c) => c.dataset.tutor === 'chinese-tutor')`);
  await drag(`document.querySelector('.ord .ch[data-tutor="chinese-tutor"]')`, -ci * s2);
  ok('拖着排:语文排到第一', await until(`document.querySelector('.ord .ch')?.dataset.tutor === 'chinese-tutor'`));
  const kid5 = (await api('GET', '/api/kid/home')).json;
  ok('孩子端:老师卡的先后跟着拖的变', kid5.cards.filter((c) => c.kind === 'tutor')[0].props.tutor === 'chinese-tutor', kid5.cards.filter((c) => c.kind === 'tutor').map((c) => c.props.tutor).join());
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // ---- 记录:两个标签,听写挂在语文下面 ----
  const h0 = kid5.home;
  const n = kid5.cards.filter((c) => c.kind === 'dictation').length - 1;
  const st = await api('POST', '/api/dictation', { home: h0, n });
  ok('开一次听写(孩子端点「听写」)', st.status === 201, JSON.stringify(st.json).slice(0, 120));
  await tap(`[...document.querySelectorAll('.seg a')].find((a) => a.textContent === '记录')`);
  ok('「记录」:有两个标签,「记录」亮着;时间线上有这次听写(语文老师的),点了去录像', await until(`location.pathname === '/parent' && document.querySelector('#ptabs .on')?.textContent === '记录' && [...document.querySelectorAll('#ptl .pev')].some((e) => e.querySelector('.pv-who').lastChild.textContent === '语文老师' && e.querySelector('a.kid[href^="/parent/dictation/reel?id="]'))`, 80));
  console.log('  ', await shot('parent-record.png'));
  await tap(`[...document.querySelectorAll('#ptabs a')].find((a) => a.textContent === '首页')`);
  ok('「首页」标签回到 /parent/home', await until(`location.pathname === '/parent/home'`));
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
