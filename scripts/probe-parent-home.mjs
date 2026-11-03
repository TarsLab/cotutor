#!/usr/bin/env node
/**
 * 家长端「首页」(/parent/home)的手动验收(不进 pnpm test,要本机 Chrome;假老师、假百炼,不花钱):
 * 临时 workspace + HTTP serve → 手机尺寸开 /parent/home:预览是孩子端首页本身(/preview)→ 给英语老师加一个开场按钮 → 发布了、孩子端与预览都有 →
 * 在预览里点后面那张换老师、设语文这周的词 → 一排里拖数学到第一 → 宽屏:在预览里点那颗、右栏改、改字时预览跟着变、切手机样子、拖语文到第一 →
 * 去工作台的链接、「扫码打开」(还没有平板连过 → 开着;孩子的平板 / 我的手机两张;能收起展开)、「样子与声音」(宽屏在右栏:挑头像;「换一个」开弹窗挑声音:筛、搜、试听、用;手机整屏、弹窗从底下升起)→
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
// 老师是假老师(tests/_fake-teacher.ts,逐行吐),serve 经 COTUTOR_BRAIN_ENDPOINT 找它
const { startFakeTeacher } = await import(join(repo, 'tests', '_fake-teacher.ts'));
const teacher = await startFakeTeacher();
cfg.runtimes.default = 'fake';
cfg.runtimes.fake = { api: 'bailian', model: 'fake-stream' };
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
    const r = await evaluate(`(() => { const f = document.querySelector('#pvf'), d = f.contentDocument, el = ${expr}; f.scrollIntoView({ block: 'center' }); const fr = f.getBoundingClientRect(), k = fr.width / f.offsetWidth, b = el.getBoundingClientRect(); return { x: fr.left + (b.left + b.width / 2) * k, y: fr.top + (b.top + b.height / 2) * k }; })()`);
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
  // ---- 去工作台、孩子的平板怎么打开、样子与声音(宽屏在右栏) ----
  const cfgNow = () => JSON.parse(readFileSync(join(root, 'cotutor.json'), 'utf8'));
  ok('导航右边有「工作台 ↗」,新窗口开 /dev', await evaluate(`(() => { const a = document.querySelector('.top .devl'); return !!a && a.getAttribute('href') === '/dev' && a.target === '_blank'; })()`));
  ok('宽屏:二维码在右栏最上面;还没有平板连过 → 开着,码画出来了(220 宽)、地址是这台的,旁边有「孩子端 ↗」', await until(`!!document.querySelector('#body #kidqr .qrimg svg') && !document.querySelector('#qrtop').children.length && document.querySelector('#kidqr .qrurl').textContent.endsWith(':${port}/') && document.querySelector('#kidqr .qrimg').getBoundingClientRect().width >= 200 && document.querySelector('#kidqr .kidl')?.getAttribute('href') === '/' && document.querySelector('#kidqr .kidl').target === '_blank'`));
  console.log('  ', await shot('parent-home-qr.png'));
  const kidSvg = await evaluate(`document.querySelector('#kidqr .qrimg').innerHTML`);
  await tap(`[...document.querySelectorAll('#kidqr .seg button')].find((b) => b.textContent === '我的手机')`);
  ok('切到「我的手机」:码换成家长端 /parent 的,打印也带 to=parent', await until(`document.querySelector('#kidqr .qrurl').textContent.endsWith(':${port}/parent') && document.querySelector('#kidqr .qrimg').innerHTML !== ${JSON.stringify(kidSvg)} && [...document.querySelectorAll('#kidqr a')].some((a) => a.getAttribute('href').includes('to=parent'))`));
  await tap(`[...document.querySelectorAll('#kidqr .seg button')].find((b) => b.textContent === '孩子的平板')`);
  await tap(`[...document.querySelectorAll('#kidqr .gh .x')].find((b) => b.textContent === '收起')`);
  ok('收起:剩一行,写着还没有平板连过', await until(`document.querySelector('#kidqr .it')?.textContent.includes('还没有平板连过')`));
  await tap(`document.querySelector('#kidqr .it')`);
  ok('展开回来', await until(`!!document.querySelector('#kidqr .qrimg svg')`));
  await tap(byText('.ord .ch', '语文'));
  await until(`document.querySelector('.ord .ch.on')?.dataset.tutor === 'chinese-tutor'`);
  ok('「这位老师」第一行是样子与声音:写着说话苏瑶、点读龙凤雨桐(出厂的)', await until(`(${byTitle('样子与声音')})?.textContent.includes('说话:苏瑶 · 点读:龙凤雨桐')`));
  await tap(byTitle('样子与声音'));
  ok('样子与声音:右栏换成面板;头像一格格(木钉娃娃亮着);声音只两行:苏瑶(女)、龙凤雨桐(女 27 岁),各一个「换一个」', await until(`document.querySelectorAll('#body #look .lkopt').length >= 8 && document.querySelector('#look .lkopt.on')?.getAttribute('aria-label') === '木钉娃娃' && document.querySelectorAll('#look .vcur').length === 2 && document.querySelector('#lk-mouth').textContent.includes('苏瑶') && document.querySelector('#lk-mouth .vface.g-f')?.textContent === '女' && document.querySelector('#lk-card').textContent.includes('27 岁') && document.querySelector('#lk-mouth .vchg').textContent.includes('56 个可选') && document.querySelector('#lk-card .vchg').textContent.includes('597 个可选')`));
  console.log('  ', await shot('parent-look-wide.png'));
  await tap(`[...document.querySelectorAll('#look .lkopt')].find((b) => b.getAttribute('aria-label') === '学科字')`);
  ok('点学科字:那格亮了、写着存好了;cotutor.json 里头像是「语」;预览里语文那张换了', await until(`document.querySelector('#look .lkopt.on')?.getAttribute('aria-label') === '学科字'`) && cfgNow().tutors['chinese-tutor'].avatar === '语' && await until(pv(`d.querySelector('#deck .pc[data-tutor="chinese-tutor"]')?.textContent.includes('语')`)));

  // 说话的声音:弹窗、筛男女与口音、搜、选、用
  const cards = `document.querySelectorAll('#vp .vcard')`;
  const chipOf = (group, text) => `[...document.querySelectorAll('#vp .vpg')].find((g) => g.querySelector('.lbl').textContent === '${group}').querySelectorAll('.chip').values().find((c) => c.firstChild.textContent === '${text}')`;
  await tap(`document.querySelector('#lk-mouth .vchg')`);
  ok('换一个:弹窗,56 个都在,苏瑶排第一选着;「用」是灰的「现在就是它」;性别、口音两组筛选,带个数', await until(`${cards}.length === 56 && document.querySelector('#vp .vcard.on')?.textContent.includes('苏瑶') && document.querySelector('#vp-use').disabled && document.querySelector('#vp-use').textContent === '现在就是它' && document.querySelectorAll('#vp .vpg').length === 2 && ${chipOf('性别', '全部')}.textContent === '全部56'`));
  console.log('  ', await shot('parent-voice-mouth.png'));
  await tap(chipOf('性别', '男'));
  ok('筛男:只剩男的(圆里都是「男」)', await until(`(() => { const c = [...${cards}]; return c.length > 10 && c.length < 56 && c.every((x) => x.querySelector('.vface').textContent === '男'); })()`));
  await tap(chipOf('口音', '四川话'));
  ok('再筛四川话:只剩程川一个(晴儿是女的);四川话标签是方言的样子', await until(`${cards}.length === 1 && ${cards}[0].textContent.includes('程川') && !!${cards}[0].querySelector('.vt.t-dia')`));
  await tap(chipOf('性别', '全部'));
  await tap(chipOf('口音', '全部'));
  await typeInto('#vp .vpctl input', '温柔');
  ok('搜「温柔」:只剩带温柔的几张,输入框还在焦点上', await until(`(() => { const c = [...${cards}]; return c.length > 0 && c.length < 12 && c.every((x) => x.textContent.includes('温柔')) && document.activeElement === document.querySelector('#vp .vpctl input'); })()`));
  await typeInto('#vp .vpctl input', '');
  ok('舒然、詹妮弗带「中英夹着说带英文腔」', await until(`[...${cards}].filter((c) => c.querySelector('.t-warn')).map((c) => c.querySelector('b').textContent).sort().join() === '舒然,詹妮弗'`));
  await tap(`${cards}[2].querySelector('.vplay')`);
  await sleep(2500);
  ok('试听说话的声音:没报「试听不了」(假百炼念的)', !(await evaluate(`document.querySelector('#toast').classList.contains('on') && document.querySelector('#toast').textContent.includes('试听不了')`)), await evaluate(`document.querySelector('#toast').textContent`));
  await tap(`[...${cards}].find((c) => c.textContent.includes('四月')).querySelector('.vpick')`);
  ok('点四月:那张选上,「用「四月」」能按', await until(`document.querySelector('#vp .vcard.on')?.textContent.includes('四月') && !document.querySelector('#vp-use').disabled && document.querySelector('#vp-use').textContent === '用「四月」'`));
  await tap(`document.querySelector('#vp-use')`);
  ok('按「用」:弹窗关了,说话的声音换成 Maia,面板上那行是四月', await until(`!document.querySelector('#vp') && document.querySelector('#lk-mouth')?.textContent.includes('四月')`) && cfgNow().live.voices['chinese-tutor'] === 'Maia');

  // 点读的声音:597 个,先列 60;筛英文、童声;清掉;更多场景;试听
  await tap(`document.querySelector('#lk-card .vchg')`);
  ok('点读的弹窗:先列 60 张,下面「再看 60 个(还有 537 个)」;四组筛选;场景有「更多」', await until(`${cards}.length === 60 && document.querySelector('#vp-list .addb')?.textContent.includes('还有 537 个') && document.querySelectorAll('#vp .vpg').length === 4 && !!document.querySelector('#vp .chip.more')`));
  await tap(`document.querySelector('#vp-list .addb')`);
  ok('点「再看 60 个」:列到 120 张', await until(`${cards}.length === 120`));
  await tap(chipOf('语言', '英文'));
  ok('筛英文:8 张,都是英文标签', await until(`${cards}.length === 8 && [...${cards}].every((c) => !!c.querySelector('.vt.t-en'))`));
  await tap(chipOf('年纪', '童声'));
  ok('再筛童声:没有,出「清掉筛选」', await until(`${cards}.length === 0 && !!document.querySelector('#vp .vpnone')`));
  await tap(`document.querySelector('#vp .vpnone button')`);
  ok('清掉筛选:回到 60 张', await until(`${cards}.length === 60`));
  await tap(chipOf('年纪', '童声'));
  ok('童声:都带紫色「童声」', await until(`${cards}.length > 0 && [...${cards}].every((c) => !!c.querySelector('.vt.t-kid'))`));
  await tap(chipOf('年纪', '全部'));
  await tap(`document.querySelector('#vp .chip.more')`);
  ok('点「更多」:场景全摊开,有「客服」', await until(`!document.querySelector('#vp .chip.more') && !!(${chipOf('场景', '客服')})`));
  console.log('  ', await shot('parent-voice-card.png'));
  await tap(`${cards}[1].querySelector('.vplay')`);
  ok('点读的试听:试听的那张顺手选上(这里没起假配音,不听声)', await until(`document.querySelector('#vp .vcard.on') === ${cards}[1]`));
  await tap(`document.querySelector('#vp .vpx')`);
  ok('关掉:没存,点读还是龙凤雨桐', await until(`!document.querySelector('#vp') && document.querySelector('#lk-card').textContent.includes('龙凤雨桐')`) && !('voice' in cfgNow().tutors['chinese-tutor']));

  // 挑回出厂的:cotutor.json 里不留
  await tap(`[...document.querySelectorAll('#look .lkopt')].find((b) => b.getAttribute('aria-label') === '木钉娃娃')`);
  await tap(`document.querySelector('#lk-mouth .vchg')`);
  ok('现在用的四月排第一,出厂的苏瑶第二', await until(`${cards}[0]?.textContent.includes('现在用的') && ${cards}[0].textContent.includes('四月') && ${cards}[1].textContent.includes('苏瑶') && ${cards}[1].textContent.includes('出厂')`));
  await tap(`${cards}[1].querySelector('.vpick')`);
  await tap(`document.querySelector('#vp-use')`);
  ok('挑回木钉娃娃、苏瑶:cotutor.json 里不留这两项', await until(`!document.querySelector('#vp') && document.querySelector('#lk-mouth')?.textContent.includes('苏瑶')`) && !('avatar' in cfgNow().tutors['chinese-tutor']) && !('chinese-tutor' in (cfgNow().live?.voices ?? {})));
  await tap(`[...document.querySelectorAll('#look .nav button')].find((b) => b.textContent.includes('返回'))`);
  ok('返回:右栏回到原来的提示', await until(`!document.querySelector('#look') && !!document.querySelector('#body .grp.hint')`));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(600);
  ok('手机:二维码挪到预览上面', await until(`!!document.querySelector('#qrtop #kidqr')`));
  await tap(byTitle('样子与声音'));
  ok('手机:样子与声音整屏', await until(`document.querySelector('#sheet').classList.contains('on') && document.querySelectorAll('#sheet #look .lkopt').length >= 8`));
  console.log('  ', await shot('parent-look-phone.png'));
  await tap(`document.querySelector('#sheet #lk-card .vchg')`);
  ok('手机:选声音从底下升起(顶上留一截)、一张一行、筛选横着滑', await until(`(() => { const b = document.querySelector('#vp .vpbox')?.getBoundingClientRect(); const c = [...${cards}]; return !!b && b.top >= 30 && b.top <= 50 && b.width === 390 && c.length > 1 && c[0].getBoundingClientRect().width > 300 && getComputedStyle(document.querySelector('#vp .vpg .chips')).flexWrap === 'nowrap'; })()`));
  console.log('  ', await shot('parent-voice-phone.png'));
  await tap(`document.querySelector('#vp .vpno')`);
  await until(`!document.querySelector('#vp')`);
  await tap(`[...document.querySelectorAll('#sheet #look .nav button')].find((b) => b.textContent.includes('返回'))`);
  await until(`!document.querySelector('#sheet').classList.contains('on')`);
  await evaluate('window.scrollTo(0, 0)');
  console.log('  ', await shot('parent-home-phone-qr.png'));

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
  void teacher.close();
  if (browser) browser.kill();
  if (!keep) {
    serve.kill();
    if (outAt < 0) console.log(`截图在 ${shots}(临时目录,--out 指定目录可以留下)`);
    else rmSync(root, { recursive: true, force: true });
  } else console.log(`留着:workspace ${root},serve ${base}(pid ${serve.pid})`);
}
