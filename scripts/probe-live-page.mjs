#!/usr/bin/env node
/**
 * 孩子端实时老师页(《工作流程.md》§孩子端「实时老师」,《wip/实时老师开发计划.md》P2.6)的手动验收(不进 pnpm test,要本机 Chrome;假百炼 + 假老师,不花钱):
 * 本进程起服务(临时 workspace,语文老师开实时;老师是 tests/_fake-cli.ts --stream,嘴是 tests/_fake-realtime.ts,一次回答的声音拉长到 1.5 秒),
 * 无头 Chrome 带假麦克风开孩子端语文老师(新话题):
 *   横屏是左栏大头像 + 字幕、右边白板;按住说话(CDP 鼠标)→ 推了声音、松手嘴接住(字幕)→ 脑写的卡铺上、卡角是「?」、讲稿一句一句上字幕;
 *   嘴在说时按下 = 打断(孩子端清了、字幕那句淡加省略号)、上滑松手作废;点「?」= 问这张卡的一轮;不出卡的一轮板上留讲稿的字;嘴连不上回到板书;
 *   首页点 activity 按钮也开实时,开场那条走嘴的连接(P3.1)。
 * iPad 横屏、手机各截一张。
 * 用法:node scripts/probe-live-page.mjs [--out <截图目录>] [--keep]
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS, quiet } from './_quiet.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const outAt = process.argv.indexOf('--out');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cdp = 9341;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const tmp = probeDir('cotutor-probe-live-page-');
const shots = outAt > 0 ? process.argv[outAt + 1] : join(tmp, 'shots');
mkdirSync(shots, { recursive: true });
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import(join(repo, 'src', 'cli', 'init.ts'));
const { loadWorkspace } = await import(join(repo, 'src', 'cli', 'workspace.ts'));
const { createContext, createHandler } = await import(join(repo, 'src', 'server', 'app.ts'));
const { makeLiveUpgrade } = await import(join(repo, 'src', 'live', 'route.ts'));
const { startFakeRealtime } = await import(join(repo, 'tests', '_fake-realtime.ts'));
const { publishHome } = await import(join(repo, 'src', 'server', 'home.ts'));
const { catchCue } = await import(join(repo, 'src', 'live', 'lib', 'cue.ts'));

// ---- 临时 workspace:老师都是假 CLI(流式),语文老师开实时;嘴是假百炼 ----
const fake = await startFakeRealtime();
fake.audioMs = 1500;
const FAKE = join(repo, 'tests', '_fake-cli.ts');
const rt = { run: [process.execPath, '--experimental-strip-types', '--no-warnings', FAKE, '--stream', '--tools', '{tools}', '--agent', '{agent}', '{prompt}'], resume: [process.execPath, '--experimental-strip-types', '--no-warnings', FAKE, '--stream', '--tools', '{tools}', '--agent', '{agent}', '--resume', '{session}', '{prompt}'] };
const wsRoot = join(tmp, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot, proxy: false });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.runtimes = { default: 'stream', stream: rt };
for (const t of Object.values(cfg.tutors)) delete t.runtime;
cfg.live = { enabled: true, voices: { 'chinese-tutor': 'Serena' } };
cfg.kid.name = 'Ray';
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const ctx = createContext(loadWorkspace(wsRoot), { warm: false });
await ctx.reload();
const upgrade = makeLiveUpgrade({ endpoint: fake.endpoint, env: { DASHSCOPE_API_KEY: 'sk-probe' } });
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void upgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const conn = () => fake.conns[fake.conns.length - 1];

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
  const device = async (w, h, dsf, mobile) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile }); await sleep(400); };
  const until = async (expr, n = 40) => { for (let i = 0; i < n; i++) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
  const untilNode = async (f, ms = 10000) => { const t = Date.now() + ms; while (!f() && Date.now() < t) await sleep(50); return f(); };
  /** 手指:CDP 鼠标(走命中判定,CLAUDE.md「坑」);按住 hold 毫秒再松,dy = 松手前往上滑多少 */
  const center = async (sel) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const press = async (sel, holdMs, dy = 0) => {
    const p = await center(sel);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(holdMs);
    if (dy) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y - dy, button: 'left', buttons: 1 }); await sleep(100); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y - dy, button: 'left', buttons: 0, clickCount: 1 });
  };
  const tap = async (sel) => press(sel, 40);
  const cap = () => evaluate(`({ p: document.querySelector('#lv-cap .lv-prev').textContent, c: document.querySelector('#lv-cap .lv-cur').textContent, cut: document.querySelector('#lv-cap .lv-cur').classList.contains('cut'), done: document.querySelector('#lv-cap').classList.contains('done') })`);
  const body = (cls) => evaluate(`document.body.classList.contains(${JSON.stringify(cls)})`);
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);

  // ---- 进老师页:新话题,连上嘴 ----
  await device(1180, 820, 1, false);
  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor&new=1` });
  await until(`document.body.classList.contains('live')`);
  const connected = await untilNode(() => Boolean(conn()?.session), 8000);
  await sleep(400);
  const lay = await evaluate(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const lv = r('#lv'), wrap = r('#wrap'), av = r('#lv-av'), bar = r('#bar'); return { lv: [Math.round(lv.left), Math.round(lv.width)], wrap: [Math.round(wrap.left), Math.round(wrap.top), Math.round(wrap.width)], av: Math.round(av.width), bar: Math.round(bar.width), sub: getComputedStyle(document.querySelector('#sub')).display, bg: getComputedStyle(document.querySelector('#wrap')).backgroundColor, cap: document.querySelector('#lv-cap .lv-cur').textContent, blank: Boolean(document.querySelector('#board .blank')) }; })()`);
  ok('进老师页:body.live、连上了嘴(配了会话)', connected, JSON.stringify(conn()?.session?.voice ?? null));
  ok('横屏:左栏 340(大头像 140)、右边白板、输入条横跨、板书的字幕行收起;没说话时字幕写老师的名字', lay.lv[1] === 340 && lay.av === 140 && lay.wrap[0] > lay.lv[0] + 340 && lay.bg === 'rgb(255, 255, 255)' && lay.bar > 1000 && lay.sub === 'none' && lay.blank && lay.cap === '语文老师', JSON.stringify(lay));

  // ---- 按住说话 → 松手:嘴接住、脑写卡、讲稿一句一句上字幕 ----
  fake.kidText = '老师板书怎么写';
  const a0 = conn().audio;
  const p = await center('#mid');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(1400);
  const holding = { listening: await body('listening'), hold: await evaluate(`document.querySelector('#hold').classList.contains('on')`), chip: await evaluate(`getComputedStyle(document.querySelector('#lv-chip')).display`), pushed: conn().audio - a0, holdText: await evaluate(`document.querySelector('#hold span').textContent`) };
  console.log('  ', await shot('live-hold-ipad.png'));
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  ok('按住:头像变蓝(listening)、「在听你说」、输入条上的蓝胶囊;假麦克风的声音推上去了', holding.listening && holding.hold && holding.chip !== 'none' && holding.pushed > 3200, JSON.stringify(holding));
  const caught = await until(`document.querySelector('#lv-cap .lv-cur').textContent === "It's a red car."`, 20);
  ok('松手:commit 一次、嘴接住(接住的字一到就上字幕)', caught && conn().commits === 1, JSON.stringify(await cap()));
  const cards = await until(`document.querySelectorAll('#board .sec .c').length >= 2`, 60);
  const board1 = await evaluate(`(() => { const sec = document.querySelector('#board .sec'); return { said: sec.querySelector('.sh')?.textContent ?? '', cards: sec.querySelectorAll('.c').length, asks: sec.querySelectorAll('.c > .again.ask').length, askVisible: [...sec.querySelectorAll('.c > .again.ask')].every((b) => getComputedStyle(b).display !== 'none'), speakers: sec.querySelectorAll('.c > .again:not(.ask)').length }; })()`);
  ok('脑写的卡铺上:节头是孩子那句、卡角都是「?」(看得见)、没有再听的喇叭', cards && board1.said.includes('老师板书怎么写') && board1.asks === board1.cards && board1.askVisible && board1.speakers === 0, JSON.stringify(board1));
  const speaking = await until(`document.body.classList.contains('speaking')`, 40);
  ok('嘴在说:头像外的圈亮(body.speaking)', speaking);
  const lastLine = await until(`document.querySelector('#lv-cap .lv-cur').textContent === '第一次说:老师板书怎么写'`, 80);
  const c1 = await cap();
  const capBox = await evaluate(`(() => { const st = getComputedStyle(document.querySelector('#lv-cap .lv-cur')); return st.borderTopWidth + ' ' + st.backgroundColor; })()`);
  ok('讲稿一句一句上字幕:念到最后一句,上一句挪上去变淡;字幕是字,不是一张卡(没有边框、底色)', lastLine && c1.p === '三角形有几个角?' && capBox === '0px rgba(0, 0, 0, 0)', JSON.stringify({ ...c1, capBox }));
  const now = await evaluate(`[...document.querySelectorAll('#board .c.now')].map((c) => c.dataset.card).join()`);
  ok('讲到某句它锚的卡描边', now.length > 0, now);
  const quietDone = await until(`!document.body.classList.contains('speaking') && document.querySelector('#lv-cap').classList.contains('done')`, 40);
  ok('讲完就停:圈不亮了、字幕变淡', quietDone, JSON.stringify(await cap()));
  await sleep(300);
  console.log('  ', await shot('live-board-ipad.png'));

  // ---- 嘴在说时按下 = 打断;上滑松手作废 ----
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  fake.kidText = '再讲一遍板书';
  await press('#mid', 900);
  await until(`document.body.classList.contains('speaking')`, 60);
  // 第二轮的讲稿念起来(上字幕)以后按下
  await until(`document.querySelector('#lv-cap .lv-cur').textContent === '先看三角形。' && document.body.classList.contains('speaking')`, 80);
  const h0 = conn().cancels, holds0 = conn().clears;
  const p2 = await center('#mid');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p2.x, y: p2.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(500);
  const cutView = { speaking: await body('speaking'), listening: await body('listening'), ...(await cap()), clears: conn().clears - holds0 };
  console.log('  ', await shot('live-cut-ipad.png'));
  // 往上滑 80 再松:这一下作废
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p2.x, y: p2.y - 80, button: 'left', buttons: 1 });
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p2.x, y: p2.y - 80, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(600);
  ok('嘴在说时按下:声音停了(不再 speaking)、在听;字幕那句淡、加省略号;服务端清了缓冲', !cutView.speaking && cutView.listening && cutView.cut && cutView.c === '先看三角形。……' && cutView.clears >= 1, JSON.stringify(cutView));
  const commits = conn().commits;
  ok('上滑松手:作废,不 commit、不开新一轮', commits === 2 && !(await body('listening')), String(commits));

  // ---- 点「?」:问这张卡 ----
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const secs0 = await evaluate(`document.querySelectorAll('#board .sec').length`);
  await evaluate(`document.querySelector('#board .sec .c > .again.ask').scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await sleep(200);
  await tap('#board .sec .c > .again.ask');
  const asked = await until(`document.querySelectorAll('#board .sec').length > ${secs0}`, 60);
  const askHead = await evaluate(`[...document.querySelectorAll('#board .sec')].at(-1).querySelector('.sh')?.textContent ?? ''`);
  const lastResp = conn().responses.map((r) => r?.instructions ?? '').find((x) => x.includes('这张卡呀'));
  ok('点「?」:嘴用问卡的那句接住、新一节的节头是「讲讲这张卡」(脑拿到 focus)', asked && Boolean(lastResp) && askHead.includes('讲讲这张卡'), JSON.stringify({ askHead }));

  // ---- 不出卡的一轮:板上留讲稿的字 ----
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await until(`!document.body.classList.contains('speaking')`, 40);
  fake.kidText = '一加一等于几';
  // 接住拉长到 4 秒:脑早写完了,嘴还没念到讲稿——这时板上不该先露字
  fake.audioMs = 4000;
  const secs1 = await evaluate(`document.querySelectorAll('#board .sec').length`);
  await press('#mid', 900);
  await until(`document.querySelectorAll('#board .sec').length > ${secs1}`, 60);
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await sleep(1200);
  const early = await evaluate(`(() => { const s = [...document.querySelectorAll('#board .sec')].at(-1); return { shown: [...s.querySelectorAll('.says p')].filter((p) => getComputedStyle(p).display !== 'none').length, cap: document.querySelector('#lv-cap .lv-cur').textContent }; })()`);
  fake.audioMs = 1500;
  ok('不出卡的一轮:脑写完了、嘴还在接住时,板上先不露讲稿的字', early.shown === 0 && early.cap === "It's a red car.", JSON.stringify(early));
  const says = await until(`(() => { const s = [...document.querySelectorAll('#board .sec')].at(-1); const ps = s ? [...s.querySelectorAll('.says p')].filter((p) => getComputedStyle(p).display !== 'none') : []; return ps.length >= 1 && ps.at(-1).textContent.endsWith('一加一等于几'); })()`, 80);
  const sv = await evaluate(`(() => { const s = [...document.querySelectorAll('#board .sec')].at(-1); return { cards: s.querySelectorAll('.c').length, says: [...s.querySelectorAll('.says p')].map((p) => p.textContent + (getComputedStyle(p).display === 'none' ? '(没露)' : '')), wait: Boolean(document.querySelector('#board > .wait-card')) }; })()`);
  ok('不出卡的一轮:板上留讲稿的字(念到才露)、没有占位卡', says && sv.cards === 0 && !sv.wait, JSON.stringify(sv));
  await sleep(500);
  console.log('  ', await shot('live-nocard-ipad.png'));

  // ---- 手机竖屏:字幕在输入条上方一行 ----
  await device(390, 844, 2, true);
  const ph = await evaluate(`(() => { const lv = document.querySelector('#lv').getBoundingClientRect(), bar = document.querySelector('#bar').getBoundingClientRect(), av = document.querySelector('#lv-av').getBoundingClientRect(); const s = [...document.querySelectorAll('#board .sec')].at(-1); return { lvBottom: Math.round(lv.bottom), barTop: Math.round(bar.top), av: Math.round(av.width), w: document.documentElement.scrollWidth, says: [...s.querySelectorAll('.says p')].filter((p) => getComputedStyle(p).display !== 'none').length }; })()`);
  ok('手机:字幕一行在输入条上方(小头像 44),不横向滚;换了排版讲稿的留字还在', Math.abs(ph.lvBottom - ph.barTop) <= 2 && ph.av === 44 && ph.w <= 390 && ph.says === 1, JSON.stringify(ph));
  console.log('  ', await shot('live-phone.png'));

  // ---- 录像(P2.8):挂了落通话的录像;家长端这个话题的录像照它放(嘴、孩子的声音在通话那一条里),孩子的屏幕是实时老师页的样子 ----
  await device(1180, 820, 1, false);
  const day = await (await fetch(`${base}/api/kid/conversations/chinese-tutor/today`)).json();
  await send('Page.navigate', { url: 'about:blank' });
  const ended = await untilNode(() => conn()?.closed === true, 8000);
  await sleep(800);
  const rj = await (await fetch(`${base}/api/conversations/chinese-tutor/${day.date}/threads/${day.thread}/reel`)).json();
  if (process.env.PROBE_DEBUG) console.log(JSON.stringify({ says: rj.reel?.says, clips: rj.reel?.clips }, null, 0).slice(0, 3000));
  const callSays = (rj.reel?.says ?? []).filter((x) => /\.live\/\d{6}\.wav$/.test(x.audio ?? ''));
  const mouth = (rj.reel?.clips ?? []).filter((c) => c.kind === 'mouth');
  const voice = (rj.reel?.clips ?? []).filter((c) => c.kind === 'voice');
  const wav = callSays[0] ? await fetch(`${base}/api/audio/chinese-tutor/${callSays[0].audio}`, { headers: { range: 'bytes=0-99' } }) : null;
  ok('挂了:落通话录像;话题的录像是实时的(realtime)、讲稿每句从通话的声音里放(带 seek)、嘴接住与孩子按住各是一段、通话的 wav 取得到(支持 Range)', ended && rj.realtime === true && callSays.length >= 3 && callSays.every((x) => typeof x.seek === 'number') && mouth.length >= 3 && voice.length >= 2 && wav?.status === 206 && wav.headers.get('content-type') === 'audio/wav', JSON.stringify({ realtime: rj.realtime, says: callSays.length, mouth: mouth.map((c) => c.text), voice: voice.length, wav: wav?.status }));
  await send('Page.navigate', { url: `${base}/reel?tutor=chinese-tutor&date=${day.date}&thread=${encodeURIComponent(day.thread)}&end=1` });
  await until(`Boolean(document.body && document.body.classList.contains('rlk'))`, 40);
  await sleep(1500);
  const rv = await evaluate(`(() => ({ live: document.body.classList.contains('live'), cur: document.querySelector('#lv-cap .lv-cur').textContent, asks: document.querySelectorAll('#board .c > .again.ask').length, speakers: [...document.querySelectorAll('#board .c > .again:not(.ask)')].filter((b) => getComputedStyle(b).display !== 'none').length, says: [...document.querySelectorAll('#board .says p')].filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.textContent) }))()`);
  ok('录像里孩子的屏幕:实时老师页的样子(左栏字幕停在最后一句、卡角「?」、没有喇叭);不出卡那轮念到的字露着', rv.live && rv.cur.endsWith('一加一等于几') && rv.asks >= 4 && rv.speakers === 0 && rv.says.some((x) => x.endsWith('一加一等于几')), JSON.stringify(rv));
  console.log('  ', await shot('live-reel-ipad.png'));

  // ---- 嘴连不上:回到板书 ----
  fake.failUpdate = true;
  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor&new=1` });
  await until(`Boolean(document.querySelector('#board .blank'))`);
  const fell = await until(`!document.body.classList.contains('live')`, 40);
  fake.failUpdate = false;
  ok('嘴连不上:回到板书的样子(没有 body.live、字幕行回来)', fell && (await evaluate(`getComputedStyle(document.querySelector('#sub')).display`)) !== 'none');

  // ---- activity 也走实时(P3.1):首页点「看图说话」→ 开实时、开场那条等嘴连上走那条连接发(嘴说开场那句)、脑照 activity 带 ----
  mkdirSync(join(wsRoot, 'home'), { recursive: true });
  writeFileSync(join(wsRoot, 'home', 'draft.md'), '```tutor chinese-tutor\nactivity 看图说话\n```\n\n## 为什么这么排\n\n试实时\n');
  const pub = await publishHome(ctx.ws, { now: new Date() });
  // 先回首页再换地址:老师页离开时记着这位老师(sessionStorage 的 kid-resume),直接换地址会把老师页恢复回来
  await evaluate(`document.querySelector('#back').click()`);
  await sleep(300);
  const nc = fake.conns.length;
  await send('Page.navigate', { url: `${base}/` });
  await until(`Boolean([...document.querySelectorAll('#deck .pc[data-tutor="chinese-tutor"] .bt')].find((b) => b.textContent.includes('看图说话')))`, 40);
  await sleep(1200);
  const bt = await evaluate(`(() => { const b = [...document.querySelectorAll('#deck .pc[data-tutor="chinese-tutor"] .bt')].find((x) => x.textContent.includes('看图说话')); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: bt.x, y: bt.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  const liveOn = await until(`document.body.classList.contains('live')`, 40);
  const started = await untilNode(() => fake.conns.length > nc && conn().responses.some((r) => r?.instructions === catchCue('start')), 10000);
  const sec = await until(`document.querySelectorAll('#board .sec').length >= 1`, 80);
  const today = await (await fetch(`${base}/api/kid/conversations/chinese-tutor/today`)).json();
  const idx = JSON.parse(readFileSync(join(wsRoot, 'conversations', 'chinese-tutor', `${today.date}.json`), 'utf8'));
  const first = idx.messages.find((m) => m.thread === today.thread && m.from === 'kid');
  ok('首页点 activity:开实时;开场那条走嘴的连接(嘴说开场那句)、脑照 activity 带、实时轮', pub.ok && liveOn && started && sec && first?.activity?.name === '看图说话' && first?.live === true, JSON.stringify({ pub: pub.ok, liveOn, started, sec, activity: first?.activity?.name, live: first?.live }));

  ok('页面没有报错', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  if (browser) browser.kill();
  server.close();
  fake.close();
  await ctx.runner.flush?.().catch?.(() => {});
}
console.log(bad ? `\n${bad} 项没过` : '\n全过');
console.log(`截图:${shots}`);
process.exit(bad ? 1 : 0);
