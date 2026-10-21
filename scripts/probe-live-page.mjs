#!/usr/bin/env node
/**
 * 孩子端实时老师页(《工作流程.md》§孩子端「实时老师」,《wip/实时老师开发计划.md》P2.6)的手动验收(不进 pnpm test,要本机 Chrome;假百炼 + 假老师,不花钱):
 * 本进程起服务(临时 workspace,语文老师开实时;老师是 tests/_fake-cli.ts --stream,嘴是 tests/_fake-realtime.ts,一次回答的声音拉长到 1.5 秒),
 * 无头 Chrome 带假麦克风开孩子端语文老师(新话题):
 *   横屏是左栏大头像 + 字幕、右边白板;按住说话(CDP 鼠标)→ 推了声音、松手嘴不先说、头像在想(板上没有占位卡,拍板 19)→ 脑写的卡铺上、卡角没有钮(拍板 18 撤了「?」)、讲稿一句一句上字幕;
 *   嘴在说时按下 = 打断(孩子端清了、字幕那句淡加省略号)、上滑松手作废;点开一张卡再按住说 = 问这张卡(消息带 focus);板是脑写的(节头是它那张「# 标题」卡、没写就接着上一节、孩子的话在左栏、不出卡的一轮板上不留字、卡和讲稿不同步);嘴连不上回到板书;
 *   首页点 activity 按钮也开实时,开场那条走嘴的连接(P3.1);讲稿的 [[play]] 念完铺满放小课堂那一段,放完嘴才接着念(P3.2);
 *   一直听(《wip/实时老师常开麦设计.md》;孩子端没有开关,家长在 live.listen 开):连接开 VAD、不用按声音一直推、关麦就不推、一段声音收下了就是一轮;
 *   口语课(《wip/口语课改实时老师设计.md》):口语单页过来点一下开始,热身那拍念完卡亮「轮到你」、孩子跟了下一拍,[[call]] 念完响铃、老师说英文。
 * iPad 横屏、手机各截一张。
 * 用法:node scripts/probe-live-page.mjs [--out <截图目录>] [--keep]
 */
import { probeDir, spawn } from './_guard.mjs';
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  /** 平板横屏实时:按住说话在左栏浮层里那块(《wip/实时老师页改版设计.md》§二) */
  const HOLD = '#lv-hold';
  const cap = () => evaluate(`({ p: document.querySelector('#lv-cap .lv-prev').textContent, c: document.querySelector('#lv-cap .lv-cur').textContent, cut: document.querySelector('#lv-cap .lv-cur').classList.contains('cut'), done: document.querySelector('#lv-cap').classList.contains('done') })`);
  const body = (cls) => evaluate(`document.body.classList.contains(${JSON.stringify(cls)})`);
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);

  // ---- 进老师页:新话题,连上嘴 ----
  await device(1180, 760, 1, false);
  fake.createDelayMs = 2500;
  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor&new=1` });
  await until(`document.body.classList.contains('live')`);
  // 嘴还没连上(正在叫老师,《工作流程.md》实时那张表):按了不接、不掉进板书的浏览器识别;按钮晃一下写「正在叫老师」,voice-diag 记 busy(connecting)
  const VOICE = `document.querySelector('#lv-hold').dataset.voice`;
  const diagRow = (where) => { try { return readFileSync(join(wsRoot, '.cotutor', 'voice-diag.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.where === where).pop() ?? null; } catch { return null; } };
  const connPre = await evaluate(VOICE);
  await press(HOLD, 300);
  const connAfter = { voice: await evaluate(VOICE), shake: await evaluate(`document.querySelector('#lv-hold').classList.contains('vb-shake')`), text: await evaluate(`document.querySelector('#lv-hold .vb-big b').textContent`), listening: await body('listening'), holdOn: await evaluate(`document.querySelector('#hold').classList.contains('on')`) };
  await sleep(300);
  const connRow = diagRow('busy');
  ok('嘴还没连上时按:不接(不在听、没起板书的识别)、按钮是「正在叫老师」并晃一下、voice-diag 记 busy(connecting)', connPre === 'connecting' && connAfter.voice === 'connecting' && connAfter.shake && connAfter.text === '正在叫老师' && !connAfter.listening && !connAfter.holdOn && connRow?.st === 'connecting', JSON.stringify({ connPre, ...connAfter, row: connRow && connRow.st }));
  fake.createDelayMs = 0;
  const connected = await untilNode(() => Boolean(conn()?.session), 8000);
  await sleep(400);
  const lay = await evaluate(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const lv = r('#lv'), wrap = r('#wrap'), hold = r('#lv-hold'), back = r('#back'), more = r('#more-btn'), tools = r('#lv-tools'); const av = document.querySelector('#lv-hold .vb-av .av'); const st = getComputedStyle(document.querySelector('#lv')); return { lv: [Math.round(lv.left), Math.round(lv.top), Math.round(lv.width), Math.round(innerHeight - lv.bottom)], pos: st.position, lvBg: st.backgroundColor, lvRadius: st.borderTopRightRadius, wrap: [Math.round(wrap.left), Math.round(wrap.top), Math.round(wrap.width)], phoneAv: getComputedStyle(document.querySelector('#lv-av')).display, av: av ? Math.round(av.getBoundingClientRect().width) : 0, hold: [Math.round(hold.width), Math.round(hold.height), Math.round(innerHeight - hold.bottom), Math.round((hold.top + hold.height / 2) / innerHeight * 100)], toolsBottom: Math.round(innerHeight - tools.bottom), voice: document.querySelector('#lv-hold').dataset.voice, backIn: back.left >= lv.left && back.right <= lv.right && back.top >= lv.top, more: [Math.round(innerWidth - more.right), Math.round(more.top), more.left > lv.right], tools: [...document.querySelectorAll('#lv-tools button')].map((b) => b.textContent), bar: getComputedStyle(document.querySelector('#bar')).display, sub: getComputedStyle(document.querySelector('#sub')).display, bg: getComputedStyle(document.querySelector('#wrap')).backgroundColor, padL: parseInt(getComputedStyle(document.querySelector('#board')).paddingLeft), cap: document.querySelector('#lv-cap .lv-cur').textContent, blank: Boolean(document.querySelector('#board .blank')) }; })()`);
  ok('进老师页:body.live、连上了嘴(配了会话)', connected, JSON.stringify(conn()?.session?.voice ?? null));
  ok('横屏(1180×760,Safari 带地址栏的高):板占满整屏(纸色、不套卡片框);左栏是贴边的白纸(上、左、下不留边,宽 360,不带圆角),回首页在白纸顶上、「更多」浮在右上;头像和按住说话是一颗按钮 312×120(头像 72 在按钮里,手机那颗藏着),下沿离屏底 ≥ 150、中心在屏高六成多;最底下一排拍照 / 相册 / 打字离底边 ~20;输入条与板书的字幕行收起;没说话时字幕写老师的名字、按钮是「按住说话」', lay.pos === 'absolute' && lay.lv[0] === 0 && lay.lv[1] === 0 && lay.lv[2] === 360 && lay.lv[3] === 0 && lay.lvBg === 'rgb(255, 255, 255)' && lay.lvRadius === '0px' && lay.wrap[0] === 0 && lay.wrap[1] === 0 && lay.wrap[2] === 1180 && lay.bg === 'rgba(0, 0, 0, 0)' && lay.padL >= 380 && lay.backIn && lay.more[0] <= 24 && lay.more[2] && lay.phoneAv === 'none' && lay.av === 72 && lay.hold[0] === 312 && lay.hold[1] === 120 && lay.hold[2] >= 150 && lay.hold[3] >= 60 && lay.hold[3] <= 72 && lay.toolsBottom >= 16 && lay.toolsBottom <= 28 && lay.voice === 'idle' && lay.tools.join() === '拍照,相册,打字' && lay.bar === 'none' && lay.sub === 'none' && lay.blank && lay.cap === '语文老师', JSON.stringify(lay));

  // ---- 按下反馈(10-21 Jack:拍照、相册、打字按着、长按都没变化):CDP 强制 :active,看样子(缩放、明暗、透明、字色)变没变;part = 变的是里面哪一块 ----
  await send('DOM.enable'); await send('CSS.enable');
  const pressLook = async (sel, part = sel) => {
    const doc = await send('DOM.getDocument', { depth: 0 });
    const nodeId = (await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: sel })).result?.nodeId;
    if (!nodeId) return { sel, missing: true };
    const look = () => evaluate(`(() => { const s = getComputedStyle(document.querySelector(${JSON.stringify(part)})); return [s.transform, s.filter, s.opacity, s.color].join('|'); })()`);
    const before = await look();
    await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] });
    await sleep(300);
    const after = await look();
    await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    await sleep(250);
    return { sel, changed: before !== after };
  };
  const PRESS = [['#lv-hold'], ['#lv-cam', '#lv-cam .ic'], ['#lv-album', '#lv-album .ic'], ['#lv-type', '#lv-type .ic'], ['#back'], ['#more-btn']];
  const pressed = [];
  for (const [sel, part] of PRESS) pressed.push(await pressLook(sel, part));
  ok('按下反馈:合成的按钮、拍照 / 相册 / 打字、回首页、「更多」按着都有样子变化(缩、暗或变淡)', pressed.every((x) => x.changed), JSON.stringify(pressed.filter((x) => !x.changed)));

  // ---- 按住说话 → 松手:嘴不先说(头像在想、板上没有占位卡)、脑写卡、讲稿一句一句上字幕 ----
  fake.kidText = '老师板书怎么写';
  const a0 = conn().audio;
  const p = await center(HOLD);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  // 第一次按下才开麦克风:开完自检 600 毫秒,假麦克风一秒嘀一声,赶上两声之间就判成哑的、重开一回(约 1.6 秒),等它接上再看
  await sleep(400);
  await until(`/松手/.test(document.querySelector('#hold').textContent)`, 20);
  await sleep(800);
  const holding = { listening: await body('listening'), voice: await evaluate(VOICE), tone: await evaluate(`document.querySelector('#lv-hold').dataset.tone`), overlay: await evaluate(`getComputedStyle(document.querySelector('#hold')).display`), drawn: await evaluate(`document.querySelector('#lv-hold').vb.drawn()`), pushed: conn().audio - a0 };
  console.log('  ', await shot('live-hold-ipad.png'));
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  ok('按住:按钮自己整块变蓝(不再盖一块上去)、孩子的竖条在轨道上往头像走、老师的弧收掉;假麦克风的声音推上去了', holding.listening && holding.voice === 'hold' && holding.tone === 'blue' && holding.overlay === 'none' && holding.drawn.bars > 0 && holding.drawn.arcs.length === 0 && holding.pushed > 3200, JSON.stringify(holding));
  // 一页只有一张脸(《产品规划.md》拍板 24):左上胶囊是 logo、字幕行那颗在实时藏着,看得见的老师头像只有左栏那颗
  const FACES = `[...document.querySelectorAll('#main .av')].filter((e) => e.getClientRects().length > 0).length`;
  const pend = await until(`document.body.classList.contains('pending')`, 20);
  const waitCard = await evaluate(`Boolean(document.querySelector('#board > .wait-card'))`);
  const firstSaid = conn().responses.length ? String(conn().responses[0]?.instructions) : '';
  const thinkVoice = await evaluate(VOICE);
  console.log('  ', await shot('live-think-ipad.png'));
  ok('松手:commit 一次、嘴不先说(第一次开口就是照念)、等脑时按钮是「老师在想」(头像转圈)、板上没有占位卡', thinkVoice === 'think' && pend && !waitCard && conn().commits === 1 && (!firstSaid || firstSaid.startsWith('把这几句话原样说给孩子听')), JSON.stringify({ ...(await cap()), firstSaid: firstSaid.slice(0, 30) }));
  // 老师在想时按住说话(10-20 晚孩子几次想打断按不动,那时这块关着 pointer-events、什么都不发生):不接,那块写「老师在想,等一下再说」,voice-diag 记 busy
  const busyPre = await body('pending');
  await press(HOLD, 300);
  const busy = { pre: busyPre, voice: await evaluate(VOICE), text: await evaluate(`document.querySelector('#lv-hold .vb-big b').textContent`), listening: await body('listening'), commits: conn().commits };
  await sleep(300);
  const busyRow = readFileSync(join(wsRoot, '.cotutor', 'voice-diag.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.where === 'busy').pop() ?? null;
  ok('老师在想时按住说话:不接(不在听、不多 commit)、按钮晃一下写「老师在想,等一下再说」、voice-diag 记 busy', busy.pre && busy.voice === 'busy' && busy.text === '老师在想,等一下再说' && !busy.listening && busy.commits === 1 && busyRow?.live === true, JSON.stringify({ ...busy, row: busyRow && { st: busyRow.st, waited: busyRow.waited } }));
  const cards = await until(`document.querySelectorAll('#board .sec .c').length >= 2`, 60);
  const board1 = await evaluate(`(() => { const sec = document.querySelector('#board .sec'); return { said: sec.querySelector('.sh')?.textContent ?? '', kidHead: document.querySelectorAll('#board .sh.said').length, marks: sec.querySelectorAll('.c .mk').length, now: document.querySelectorAll('#board .c.now').length, cards: sec.querySelectorAll('.c').length, corner: sec.querySelectorAll('.c > .again').length, qmark: [...sec.querySelectorAll('.c')].filter((c) => [...c.children].some((x) => x.textContent === '?')).length }; })()`);
  board1.faces = await evaluate(FACES); board1.backLogo = await evaluate(`Boolean(document.querySelector('#back svg.ct-logo'))`);
  ok('脑写的卡铺上:没写节头的第一节只挂时间、孩子那句不当节头(在左栏);卡落下时标注就画好了、不描边;卡角没有钮(没有「?」、没有再听的喇叭);左上是 logo,看得见的老师头像只有左栏一颗', cards && /^\d\d:\d\d$/.test(board1.said) && board1.kidHead === 0 && board1.marks >= 1 && board1.now === 0 && board1.cards >= 2 && board1.corner === 0 && board1.qmark === 0 && board1.faces === 1 && board1.backLogo, JSON.stringify(board1));
  const speaking = await until(`document.body.classList.contains('speaking') && document.querySelector('#lv-hold').dataset.voice === 'tutor'`, 40);
  await sleep(250);
  const arcs1 = await evaluate(`document.querySelector('#lv-hold').vb.drawn().arcs`);
  await sleep(300);
  const arcs2 = await evaluate(`document.querySelector('#lv-hold').vb.drawn().arcs`);
  const halo = await evaluate(`(() => { const s = getComputedStyle(document.querySelector('#lv-hold .vb-av'), '::before'); return { anim: s.animationName, op: s.opacity }; })()`);
  ok('嘴在说:按钮是「老师在说」——头像旁三道小弧(半径 9 / 17 / 25,不走、不放大,深浅在 0.12–0.45 之间),头像只有一道淡淡的静止外圈(不一圈圈放大)', speaking && arcs1.length === 3 && arcs1.map((a) => a.r).join() === '9,17,25' && arcs2.map((a) => a.r).join() === '9,17,25' && [...arcs1, ...arcs2].every((a) => a.a >= 0.1 && a.a <= 0.46) && halo.anim === 'none' && Number(halo.op) > 0 && Number(halo.op) <= 0.2, JSON.stringify({ arcs1, arcs2, halo }));
  const kidLine = await until(`document.querySelector('#lv-kid').textContent === '老师板书怎么写' && document.querySelector('#lv-kid').classList.contains('old')`, 40);
  ok('孩子刚说的那句在左栏字幕上面(老师开口了变淡)', kidLine, await evaluate(`document.querySelector('#lv-kid').outerHTML`));
  console.log('  ', await shot('live-speak-ipad.png'));
  const lastLine = await until(`document.querySelector('#lv-cap .lv-cur').textContent === '第一次说:老师板书怎么写'`, 80);
  const c1 = await cap();
  const capBox = await evaluate(`(() => { const st = getComputedStyle(document.querySelector('#lv-cap .lv-cur')); return st.borderTopWidth + ' ' + st.backgroundColor; })()`);
  ok('讲稿一句一句上字幕:念到最后一句,上一句挪上去变淡;字幕是字,不是一张卡(没有边框、底色)', lastLine && c1.p === '三角形有几个角?' && capBox === '0px rgba(0, 0, 0, 0)', JSON.stringify({ ...c1, capBox }));
  const now = await evaluate(`[...document.querySelectorAll('#board .c.now')].map((c) => c.dataset.card).join()`);
  ok('卡和讲稿不同步:讲到某句不给锚着的卡描边', now.length === 0, now);
  const quietDone = await until(`!document.body.classList.contains('speaking') && document.querySelector('#lv-cap').classList.contains('done')`, 40);
  ok('讲完就停:圈不亮了、字幕变淡', quietDone, JSON.stringify(await cap()));
  await sleep(300);
  console.log('  ', await shot('live-board-ipad.png'));
  // 字幕很长时:字幕不压到按钮上(超出的截掉),按钮离底边 ≥ 150;1180×760(Safari 带地址栏)与 1366×790(大 iPad 的 Safari)各看一次
  const fits = {};
  for (const [w, hh] of [[1180, 760], [1366, 790]]) {
    await device(w, hh, 1, false);
    fits[w + 'x' + hh] = await evaluate(`(() => { const c = document.querySelector('#lv-cap .lv-cur'), was = c.textContent; c.textContent = '先看三角形。三角形有三条边、三个角,你数一数板上这个三角形有几个角?再想一想,正方形是不是也有角,它有几个?我们一个一个来数,不着急,数完告诉老师。'; const cap = document.querySelector('#lv-cap').getBoundingClientRect(), hold = document.querySelector('#lv-hold').getBoundingClientRect(), tools = document.querySelector('#lv-tools').getBoundingClientRect(); const r = { capBottom: Math.round(cap.bottom), holdTop: Math.round(hold.top), holdGap: Math.round(innerHeight - hold.bottom), toolsGap: Math.round(innerHeight - tools.bottom), center: Math.round((hold.top + hold.height / 2) / innerHeight * 100) }; c.textContent = was; return r; })()`);
  }
  console.log('  ', await shot('live-1366-ipad.png'));
  await device(1180, 760, 1, false);
  ok('长字幕也不压按钮:1180×760 与 1366×790 字幕都在按钮上沿以上、按钮离底边 ≥ 150、最底下那排离底边 ~20', Object.values(fits).every((f) => f.capBottom <= f.holdTop && f.holdGap >= 150 && f.toolsGap >= 16 && f.toolsGap <= 28), JSON.stringify(fits));

  // ---- 字幕重放(拍板 21):安静了字幕下面露「再听一遍」;点了从这一轮第一句放(服务端留的那份嘴的声音)、字幕跟着走、上面一行「再听一遍 · 第 n 句,共 m 句」,头像不动;点「停」停;按住说话也停 ----
  const rpShown = await until(`!document.querySelector('#lv-replay').hidden && document.querySelector('#lv-replay').textContent === '再听一遍'`, 40);
  const rpPress = await pressLook('#lv-replay');
  ok('按下反馈:「再听一遍」按着变淡', rpPress.changed, JSON.stringify(rpPress));
  await tap('#lv-replay');
  const rpOn = await until(`document.querySelector('#lv-cap').classList.contains('rp') && /^再听一遍 · 第 1 句,共 3 句$/.test(document.querySelector('#lv-cap .lv-prev').textContent)`, 20);
  const rpFirst = await evaluate(`document.querySelector('#lv-cap .lv-cur').textContent`);
  const rpAdv = await until(`/^再听一遍 · 第 [23] 句/.test(document.querySelector('#lv-cap .lv-prev').textContent)`, 60);
  const rpView = { first: rpFirst, prev: await evaluate(`document.querySelector('#lv-cap .lv-prev').textContent`), stop: await evaluate(`document.querySelector('#lv-replay').classList.contains('stop')`), speaking: await body('speaking'), playing: await evaluate(`(() => { const a = [...document.querySelectorAll('audio')]; return true; })()`) };
  console.log('  ', await shot('live-replay-ipad.png'));
  ok('再听一遍:安静了露出来;点了从这一轮第一句放、字幕跟着走(上面「再听一遍 · 第 n 句,共 3 句」),那行变「停」,头像不动', rpShown && rpOn && rpFirst === '先看三角形。' && rpAdv && rpView.stop && !rpView.speaking, JSON.stringify(rpView));
  await tap('#lv-replay');
  const rpStopped = await until(`!document.querySelector('#lv-cap').classList.contains('rp') && !document.querySelector('#lv-replay').classList.contains('stop')`, 20);
  await tap('#lv-replay');
  await until(`document.querySelector('#lv-cap').classList.contains('rp')`, 20);
  const c0 = conn().commits;
  const pr = await center(HOLD);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pr.x, y: pr.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(500);
  const rpHeld = { rp: await evaluate(`document.querySelector('#lv-cap').classList.contains('rp')`), listening: await body('listening'), hidden: await evaluate(`document.querySelector('#lv-replay').hidden`) };
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pr.x, y: pr.y - 130, button: 'left', buttons: 1 });
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pr.x, y: pr.y - 130, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
  ok('点「停」停了;再放时按住说话:重放停、在听(上滑松手作废,不开新一轮)', rpStopped && !rpHeld.rp && rpHeld.listening && rpHeld.hidden && conn().commits === c0, JSON.stringify({ rpStopped, ...rpHeld, commits: conn().commits - c0 }));

  // ---- 嘴在说时按下 = 打断;上滑松手作废 ----
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  fake.kidText = '再讲一遍板书';
  await press(HOLD, 900);
  await until(`document.body.classList.contains('speaking')`, 60);
  // 第二轮的讲稿念起来(上字幕)以后按下
  await until(`document.querySelector('#lv-cap .lv-cur').textContent === '先看三角形。' && document.body.classList.contains('speaking')`, 80);
  const h0 = conn().cancels, holds0 = conn().clears;
  const p2 = await center(HOLD);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p2.x, y: p2.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(500);
  const cutView = { speaking: await body('speaking'), listening: await body('listening'), ...(await cap()), clears: conn().clears - holds0 };
  console.log('  ', await shot('live-cut-ipad.png'));
  // 往上滑过那块的高(104)再松:这一下作废
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p2.x, y: p2.y - 130, button: 'left', buttons: 1 });
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p2.x, y: p2.y - 130, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(600);
  ok('嘴在说时按下:声音停了(不再 speaking)、在听;字幕那句淡、加省略号;服务端清了缓冲', !cutView.speaking && cutView.listening && cutView.cut && cutView.c === '先看三角形。……' && cutView.clears >= 1, JSON.stringify(cutView));
  const commits = conn().commits;
  ok('上滑松手:作废,不 commit、不开新一轮', commits === 2 && !(await body('listening')), String(commits));

  // ---- 打字:点浮层下面那颗「打字」,输入条贴着软键盘上沿横跨全屏出来、拿到焦点;收起键盘(失焦、没字)就回去 ----
  // 上面打断的那一轮脑可能还在写(body.pending 时那排不接),等它写完再点,不然时快时慢地红
  await until(`!document.body.classList.contains('pending')`, 80);
  await tap('#lv-type');
  await sleep(300);
  const typing = await evaluate(`(() => { const b = document.querySelector('#bar').getBoundingClientRect(); return { shown: getComputedStyle(document.querySelector('#bar')).display !== 'none', w: Math.round(b.width), focus: document.activeElement === document.querySelector('#typed'), cam: getComputedStyle(document.querySelector('#cam')).display }; })()`);
  await evaluate(`document.querySelector('#typed').value = '老师,瀑布有多高?'`);
  console.log('  ', await shot('live-type-ipad.png'));
  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = ''; t.blur(); })()`);
  await sleep(200);
  const typedBack = await evaluate(`getComputedStyle(document.querySelector('#bar')).display === 'none'`);
  ok('打字:点「打字」输入条横跨全屏出来、#typed 拿到焦点(相机、加号在浮层里,不重复);失焦没字就收回去', typing.shown && typing.w >= 1180 && typing.focus && typing.cam === 'none' && typedBack, JSON.stringify({ ...typing, typedBack }));

  // ---- 问某张卡:点开它(舞台),再按住说 → 这一轮带 focus 那张卡(拍板 18 撤了卡上的「?」) ----
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await until(`!document.body.classList.contains('speaking')`, 40);
  const secs0 = await evaluate(`document.querySelectorAll('#board .sec').length`);
  const focusCard = await evaluate(`(() => { const c = document.querySelector('#board .sec .c'); c.scrollIntoView({ block: 'center', behavior: 'instant' }); return c.closest('.sec').dataset.job + '/' + c.dataset.card; })()`);
  await sleep(200);
  await tap('#board .sec .c');
  const stageOn = await until(`document.querySelector('#stage').classList.contains('on')`, 20);
  fake.kidText = '这张卡我没看懂';
  await press(HOLD, 900);
  const asked = await until(`document.querySelectorAll('#board .sec').length > ${secs0}`, 60);
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const askJob = await evaluate(`[...document.querySelectorAll('#board .sec')].at(-1).dataset.job`);
  const runDir = join(wsRoot, 'conversations', 'chinese-tutor');
  const runFile = readdirSync(runDir).find((f) => f.endsWith(`.${askJob}.run.json`));
  const askPrompt = runFile ? JSON.parse(readFileSync(join(runDir, runFile), 'utf8')).prompt : '';
  ok('点开一张卡再按住说:这一轮的上下文包带 focus 那张卡;嘴不先说', stageOn && asked && askPrompt.includes(`card: "${focusCard}"`) && !conn().responses.some((r) => String(r?.instructions ?? '').includes('这张卡呀')), JSON.stringify({ focusCard, askJob, runFile: Boolean(runFile) }));
  await tap('#st-x');
  await until(`!document.querySelector('#stage').classList.contains('on')`, 20);

  // ---- 系统抢走触摸(pointercancel,iPadOS 底部手势;拍板 22):照旧发出去,voice-diag 记 cancel 不记 up ----
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await until(`!document.body.classList.contains('speaking')`, 40);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  fake.kidText = '我读了一段';
  const cc0 = conn().commits;
  const pc = await center(HOLD);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pc.x, y: pc.y }] });
  await sleep(900);
  await send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await sleep(800);
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  const diagRows = readFileSync(join(wsRoot, '.cotutor', 'voice-diag.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.where === 'live');
  const lastDiag = diagRows.at(-1);
  ok('系统抢走触摸(touchCancel → pointercancel):照旧发出去(commit 一次)、voice-diag 记 cancel 不记 up', conn().commits === cc0 + 1 && Boolean(lastDiag?.ev.some((x) => x[0] === 'cancel' && x[2] === 'sent')) && !lastDiag?.ev.some((x) => x[0] === 'up'), JSON.stringify({ commits: conn().commits - cc0, ev: lastDiag?.ev }));

  // ---- 不出卡的一轮:板上什么都不留(撤了留讲稿的字,设想稿拍板 20);下一轮脑写了节头 → 新一节,节头是那张卡 ----
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await until(`!document.body.classList.contains('speaking')`, 40);
  fake.kidText = '一加一等于几';
  const secs1 = await evaluate(`document.querySelectorAll('#board .sec').length`);
  await press(HOLD, 900);
  await until(`document.querySelectorAll('#board .sec').length > ${secs1}`, 60);
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await until(`document.querySelector('#lv-cap .lv-cur').textContent.endsWith('一加一等于几')`, 80);
  const sv = await evaluate(`(() => { const s = [...document.querySelectorAll('#board .sec')].at(-1); return { cards: s.querySelectorAll('.c').length, heads: s.querySelectorAll('.sh').length, cont: s.classList.contains('cont'), says: document.querySelectorAll('#board .says').length, wait: Boolean(document.querySelector('#board > .wait-card')), kid: document.querySelector('#lv-kid').textContent }; })()`);
  ok('不出卡的一轮:板上什么都不留(没有讲稿的字、没有节头、没有占位卡),接着上一节;孩子那句在左栏', sv.cards === 0 && sv.heads === 0 && sv.cont && sv.says === 0 && !sv.wait && sv.kid === '一加一等于几', JSON.stringify(sv));
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await until(`!document.body.classList.contains('speaking')`, 40);
  fake.kidText = '换个节头讲板书';
  const secs2 = await evaluate(`document.querySelectorAll('#board .sec').length`);
  await press(HOLD, 900);
  const headed = await until(`(() => { const s = [...document.querySelectorAll('#board .sec')].at(-1); return document.querySelectorAll('#board .sec').length > ${secs2} && s.querySelector('.sh.lh .t')?.textContent === '认识三角形' && s.querySelectorAll('.c').length >= 2; })()`, 80);
  const hv = await evaluate(`(() => { const s = [...document.querySelectorAll('#board .sec')].at(-1); return { head: s.querySelector('.sh.lh .t')?.textContent, headings: s.querySelectorAll('.heading').length, cont: s.classList.contains('cont'), conts: document.querySelectorAll('#board .sec.cont').length, said: document.querySelectorAll('#board .sh.said').length }; })()`);
  ok('脑写了节头:新一节,节头是那张「# 标题」卡(不再另画一行粗字),前面没写节头的几轮接着画(cont);板上没有孩子的话', headed && hv.head === '认识三角形' && hv.headings === 0 && !hv.cont && hv.conts >= 2 && hv.said === 0, JSON.stringify(hv));
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await until(`!document.body.classList.contains('speaking')`, 60);
  await sleep(500);
  console.log('  ', await shot('live-nocard-ipad.png'));

  // ---- 手机竖屏:字幕在输入条上方一行 ----
  await device(390, 844, 2, true);
  const ph = await evaluate(`(() => { const lv = document.querySelector('#lv').getBoundingClientRect(), bar = document.querySelector('#bar').getBoundingClientRect(), av = document.querySelector('#lv-av').getBoundingClientRect(); const s = [...document.querySelectorAll('#board .sec')].at(-1); return { lvBottom: Math.round(lv.bottom), barTop: Math.round(bar.top), av: Math.round(av.width), w: document.documentElement.scrollWidth, says: [...s.querySelectorAll('.says p')].filter((p) => getComputedStyle(p).display !== 'none').length }; })()`);
  ph.faces = await evaluate(FACES);
  ok('手机:字幕一行在输入条上方(小头像 44),不横向滚;看得见的老师头像只有字幕行那颗', Math.abs(ph.lvBottom - ph.barTop) <= 2 && ph.av === 44 && ph.w <= 390 && ph.faces === 1, JSON.stringify(ph));
  console.log('  ', await shot('live-phone.png'));

  // ---- 录像(P2.8):挂了落通话的录像;家长端这个话题的录像照它放(嘴、孩子的声音在通话那一条里),孩子的屏幕是实时老师页的样子 ----
  await device(1180, 760, 1, false);
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
  // 拍板 14 以后这几轮嘴都不先说,没有接住那段;照念的第一块声音比 read 早排一两毫秒,reel 会切出 1–2 毫秒的 mouth 段(没字),不算
  const caught = mouth.filter((c) => c.to - c.from >= 100);
  ok('挂了:落通话录像;话题的录像是实时的(realtime)、讲稿每句从通话的声音里放(带 seek)、孩子按住是一段原声、嘴不先说(没有接住那段)、通话的 wav 取得到(支持 Range)', ended && rj.realtime === true && callSays.length >= 3 && callSays.every((x) => typeof x.seek === 'number') && caught.length === 0 && voice.length >= 2 && wav?.status === 206 && wav.headers.get('content-type') === 'audio/wav', JSON.stringify({ realtime: rj.realtime, says: callSays.length, mouth: mouth.map((c) => `${c.to - c.from}ms ${c.text ?? ''}`), voice: voice.length, wav: wav?.status }));
  await send('Page.navigate', { url: `${base}/reel?tutor=chinese-tutor&date=${day.date}&thread=${encodeURIComponent(day.thread)}&end=1` });
  await until(`Boolean(document.body && document.body.classList.contains('rlk'))`, 40);
  await sleep(1500);
  const rv = await evaluate(`(() => ({ live: document.body.classList.contains('live'), cur: document.querySelector('#lv-cap .lv-cur').textContent, corner: document.querySelectorAll('#board .c > .again').length, says: [...document.querySelectorAll('#board .says p')].filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.textContent) }))()`);
  rv.faces = await evaluate(FACES);
  ok('录像里孩子的屏幕:实时老师页的样子(左栏字幕停在最后一句、卡角没有钮、板上不留讲稿的字);老师头像只有左栏一颗', rv.live && rv.cur.length > 0 && rv.corner === 0 && rv.says.length === 0 && rv.faces === 1, JSON.stringify(rv));
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
  const started = await untilNode(() => fake.conns.length > nc && conn().responses.length > 0 && conn().responses.every((r) => String(r?.instructions).startsWith('把这几句话原样说给孩子听')), 10000);
  const sec = await until(`document.querySelectorAll('#board .sec').length >= 1`, 80);
  const today = await (await fetch(`${base}/api/kid/conversations/chinese-tutor/today`)).json();
  const idx = JSON.parse(readFileSync(join(wsRoot, 'conversations', 'chinese-tutor', `${today.date}.json`), 'utf8'));
  const first = idx.messages.find((m) => m.thread === today.thread && m.from === 'kid');
  ok('首页点 activity:开实时;开场那条走嘴的连接(嘴照念脑的第一句)、脑照 activity 带、实时轮', pub.ok && liveOn && started && sec && first?.activity?.name === '看图说话' && first?.live === true, JSON.stringify({ pub: pub.ok, liveOn, started, sec, activity: first?.activity?.name, live: first?.live }));

  // ---- 讲稿的 [[play]](小课堂,P3.2):念完那句孩子端铺满放那一段,放完舞台停在末帧、告诉服务端,嘴才接着念后面的 ----
  cpSync(join(repo, 'tests', 'fixtures', 'bundles', '2026-09-18-po13-jian-8'), join(wsRoot, 'bundles', '2026-09-18-po13-jian-8'), { recursive: true });
  await evaluate(`document.querySelector('#back').click()`);
  await sleep(300);
  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor&new=1` });
  await until(`Boolean(document.body && document.body.classList.contains('live'))`, 40);
  await untilNode(() => Boolean(conn()?.session), 8000);
  await sleep(400);
  fake.kidText = '放课';
  const said = (re) => conn().responses.some((r) => re.test(r?.instructions ?? ''));
  const pp = await center(HOLD);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pp.x, y: pp.y, button: 'left', buttons: 1, clickCount: 1 });
  // 新开的页面第一次按下才开麦克风(假麦克风赶上两声嘀之间要重开一回):接上了再松手
  await sleep(400);
  await until(`/松手/.test(document.querySelector('#hold').textContent)`, 20);
  await sleep(500);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pp.x, y: pp.y, button: 'left', buttons: 0, clickCount: 1 });
  const staged = await until(`Boolean(document.querySelector('#stage.on')) && document.querySelector('#st-kd').textContent === '小课堂'`, 120);
  await sleep(1500);
  const during = { rest: said(/拿走 8 根/), first: said(/我们回到那里再看一遍/) };
  console.log('  ', await shot('live-lecture-ipad.png'));
  const resumed = await untilNode(() => said(/拿走 8 根/), 30000);
  const stillOpen = await evaluate(`Boolean(document.querySelector('#stage.on'))`);
  ok('[[play]]:念完那句铺满放小课堂那一段,放着时嘴不往下念;放完舞台停在末帧不关、嘴接着念后面的', staged && during.first && !during.rest && resumed && stillOpen, JSON.stringify({ staged, during, resumed, stillOpen }));

  // ---- 一直听(《wip/实时老师常开麦设计.md》):孩子端没有开关、首页没有入口(拍板 4);家长在 live.listen 开 → 连接开 VAD;不用按,假麦克风的声音一直推;关麦就不推;一段声音收下了就是一轮 ----
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const noSwitch = await evaluate(`!document.querySelector('#lv-listen') && !document.querySelector('.bt-listen')`);
  cfg.live.listen = 'open';
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  await ctx.reload();
  // 假麦克风是一秒一声的嘀:嘀一声 = 一段;先都转写成空的(当咳嗽放过)
  fake.kidText = '';
  const nOpen = fake.conns.length;
  await evaluate(`document.querySelector('#back').click()`);
  await sleep(300);
  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor&new=1` });
  await until(`Boolean(document.body && document.body.classList.contains('live'))`, 40);
  const switched = await untilNode(() => fake.conns.length > nOpen && conn().session?.turn_detection?.type === 'server_vad', 8000);
  await sleep(600);
  const ui = await evaluate(`({ open: document.body.classList.contains('lv-open'), voice: document.querySelector('#lv-hold').dataset.voice, tone: document.querySelector('#lv-hold').dataset.tone, small: document.querySelector('#lv-hold .vb-small').textContent, ph: document.querySelector('#ph').textContent })`);
  const a1 = conn().audio;
  await sleep(1500);
  const pushedOpen = conn().audio - a1;
  ok('一直听:孩子端没有开关、首页没有入口;live.listen 开着就连开 VAD 的连接,左栏那颗是麦克风开关(淡蓝、「点一下关麦」;假麦克风一直嘀,多半是「孩子在说」)、输入条写「我在听」;不用按,声音一直推', noSwitch && switched && ui.open && ['open', 'open-kid'].includes(ui.voice) && ui.tone === 'light' && ui.small === '点一下关麦' && ui.ph.startsWith('我在听') && pushedOpen > 3200, JSON.stringify({ noSwitch, switched, ui, pushedOpen }));
  console.log('  ', await shot('live-open-ipad.png'));
  await tap(HOLD);
  await sleep(300);
  const a2 = conn().audio;
  await sleep(1200);
  const pushedMuted = conn().audio - a2;
  const mutedUi = await evaluate(`({ voice: document.querySelector('#lv-hold').dataset.voice, hold: document.querySelector('#lv-hold .vb-big b').textContent, ph: document.querySelector('#ph').textContent })`);
  ok('点左栏那颗关麦:不推了、写「麦关了」', pushedMuted === 0 && mutedUi.voice === 'muted' && mutedUi.hold === '麦关了' && mutedUi.ph.startsWith('麦关了'), JSON.stringify({ pushedMuted, mutedUi }));
  await tap(HOLD);
  const r0 = conn().responses.length;
  fake.kidTexts = ['老师一直听怎么写'];
  const took = await untilNode(() => conn().responses.slice(r0).some((r) => String(r?.instructions).startsWith('把这几句话原样说给孩子听')), 10000);
  const turned = await until(`document.querySelector('#lv-kid').textContent === '老师一直听怎么写' && document.querySelectorAll('#board .sh.said').length === 0`, 80);
  ok('一直听:一段声音转写收下 → 脑开一轮、嘴照念,孩子那句在左栏(没按过)', took && turned, JSON.stringify({ took, turned }));

  cfg.live.listen = 'hold';
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  await ctx.reload();

  // ---- 口语课(《wip/口语课改实时老师设计.md》):口语单拍好进英语老师页,点一下开始;热身那拍念完卡亮「轮到你」,孩子跟了下一拍;[[call]] 念完响铃,铃响够了老师说英文 ----
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const talkId = '2026-10-17-1106';
  mkdirSync(join(wsRoot, 'talk', talkId), { recursive: true });
  writeFileSync(join(wsRoot, 'talk', talkId, 'talk.json'), JSON.stringify({ id: talkId, createdAt: '2026-10-17T03:06:13.381Z', status: 'ready', list: { words: [{ en: 'duck', zh: '鸭子', emoji: '🦆', chunks: ['d', 'u', 'c', 'k'] }], sentences: [{ en: 'The ducks are under the bus.', zh: '鸭子们在公交车下面。' }] } }));
  cfg.live.voices['english-tutor'] = 'Theo Calm';
  cfg.talk = { ...(cfg.talk ?? {}), enabled: true };
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  await ctx.reload();
  fake.kidText = '';
  fake.kidTexts = [];
  await evaluate(`document.querySelector('#back').click()`);
  await sleep(300);
  const ncT = fake.conns.length;
  await send('Page.navigate', { url: `${base}/?tutor=english-tutor&talk=${talkId}` });
  const talkBoard = await until(`Boolean(document.querySelector('#talk-go'))`, 40);
  await untilNode(() => fake.conns.length > ncT && Boolean(conn()?.session), 8000);
  const tb = await evaluate(`({ go: document.querySelector('#talk-go').textContent, pill: document.querySelector('#pill').hidden, hold: getComputedStyle(document.querySelector('#lv-hold')).display, open: document.body.classList.contains('lv-open') })`);
  const spoke = conn().responses.length;
  ok('口语单页过来:英语老师页、一直听(live.listen 是 hold 也一样)、板上一颗「先热身,再打电话」,没点之前输入条与左栏那块都收着、嘴不出声', talkBoard && tb.go.includes('先热身,再打电话') && tb.pill && tb.hold === 'none' && tb.open && spoke === 0, JSON.stringify({ ...tb, spoke }));
  console.log('  ', await shot('talk-start-ipad.png'));
  await tap('#talk-go');
  const warmCaught = await untilNode(() => conn().responses.some((r) => r?.instructions === catchCue('warm')), 10000);
  const turnLit = await until(`Boolean(document.querySelector('#board .c.lv-turn'))`, 120);
  const firstEcho = conn().responses.some((r) => (r?.instructions ?? '').includes('我先来:duck!'));
  ok('点开始:嘴说「好,我们先热热身!」、脑写热身;第一拍念完,那张单词卡亮「轮到你」(服务端在等,不往下念)', warmCaught && firstEcho && turnLit && !conn().responses.some((r) => (r?.instructions ?? '').includes('小声一点')), JSON.stringify({ warmCaught, firstEcho, turnLit }));
  console.log('  ', await shot('talk-turn-ipad.png'));
  // 孩子跟:假麦克风嘀一声转写成 duck(开头那几声赶上嘴还在出声的会当回声放过,接着嘀)
  fake.kidText = 'duck';
  const nextBeat = await untilNode(() => conn().responses.some((r) => (r?.instructions ?? '').includes('小声一点')), 15000);
  ok('孩子跟了:下一拍接着念(不开新一轮)', nextBeat);
  // 你先说那拍也答 duck;念到打电话那句就不说了(那句还在放时孩子说话是对老师说的,会打断、不响铃)
  await untilNode(() => conn().responses.some((r) => (r?.instructions ?? '').includes('老师给你打个电话')), 20000);
  fake.kidText = '';
  const rang = await until(`document.querySelector('#lv-hold').dataset.voice === 'ring' && document.querySelector('#lv-hold .vb-av').classList.contains('vb-ring')`, 120);
  ok('[[call]] 那句念完:按钮是「老师打电话来了」、头像晃着响铃', rang);
  if (rang) console.log('  ', await shot('talk-ring-ipad.png'));
  const opened = await untilNode(() => conn().responses.some((r) => (r?.instructions ?? '').includes('Hello Ray!')), 20000);
  const stopped = await until(`document.querySelector('#lv-hold').dataset.voice !== 'ring'`, 40);
  ok('铃响够了:老师说英文开场,铃停', opened && stopped, JSON.stringify({ opened, stopped }));
  const todayT = await (await fetch(`${base}/api/kid/conversations/english-tutor/today`)).json();
  const idxT = JSON.parse(readFileSync(join(wsRoot, 'conversations', 'english-tutor', `${todayT.date}.json`), 'utf8'));
  const firstT = idxT.messages.find((m) => m.from === 'kid' && m.talk === talkId);
  ok('那个话题跑 activity 口语课、记着口语单是哪份', firstT?.activity?.name === '口语课' && String(firstT.activity.params?.口语单 ?? '').includes('🦆 duck'), JSON.stringify(firstT?.activity ?? null).slice(0, 200));

  // ---- 左撇子镜像(kid.hand: left,工作台设置页切;拍板 22、23):白纸挪到右边、板在左边、按钮里头像在右头;回首页、「更多」的位置同右手(回首页浮在板的左上,「更多」在右上点得到) ----
  const hp = await fetch(`${base}/api/config`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kid: { hand: 'left' } }) });
  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor&new=1` });
  await until(`Boolean(document.body && document.body.classList.contains('live') && document.body.classList.contains('hand-left'))`, 40);
  await untilNode(() => Boolean(conn()?.session), 8000);
  await sleep(600);
  const mir = await evaluate(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const lv = r('#lv'), back = r('#back'), more = r('#more-btn'), av = r('#lv-hold .vb-av'), hold = r('#lv-hold'); const mc = document.elementFromPoint(more.left + more.width / 2, more.top + more.height / 2), bc = document.elementFromPoint(back.left + back.width / 2, back.top + back.height / 2); return { lv: [Math.round(lv.left), Math.round(innerWidth - lv.right), Math.round(lv.width), Math.round(lv.top), Math.round(innerHeight - lv.bottom)], padR: parseInt(getComputedStyle(document.querySelector('#board')).paddingRight), padL: parseInt(getComputedStyle(document.querySelector('#board')).paddingLeft), back: [Math.round(back.left), Math.round(back.top)], backTop: Boolean(bc && bc.closest('#back')), avRight: av.left > hold.left + hold.width / 2, moreTop: Boolean(mc && mc.closest('#more-btn')), moreRight: Math.round(innerWidth - more.right) }; })()`);
  const pm = await center(HOLD);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pm.x, y: pm.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(400);
  await until(`/松手/.test(document.querySelector('#hold').textContent)`, 20);
  mir.hold = await evaluate(`({ voice: document.querySelector('#lv-hold').dataset.voice, right: document.querySelector('#lv-hold').classList.contains('vb-right'), bars: document.querySelector('#lv-hold').vb.drawn().bars })`);
  console.log('  ', await shot('live-mirror-hold-ipad.png'));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pm.x, y: pm.y - 130, button: 'left', buttons: 1 });
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pm.x, y: pm.y - 130, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
  console.log('  ', await shot('live-mirror-ipad.png'));
  ok('左撇子镜像:白纸贴右边(宽 360、上下不留边)、板从左边排起、按钮里头像在右头;回首页在左上点得到、「更多」在右上点得到;按着时按钮变蓝、竖条往右头的头像走', hp.status === 200 && mir.lv[1] === 0 && mir.lv[2] === 360 && mir.lv[3] === 0 && mir.lv[4] === 0 && mir.padR >= 380 && mir.padL <= 64 && mir.back[0] <= 40 && mir.back[1] <= 30 && mir.backTop && mir.avRight && mir.moreTop && mir.moreRight <= 24 && mir.hold.voice === 'hold' && mir.hold.right && mir.hold.bars > 0, JSON.stringify(mir));

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
