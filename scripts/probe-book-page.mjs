#!/usr/bin/env node
/**
 * 课本做底的孩子端整条线(语文的「课本」,activity 头上 base: textbook)手动验收:不进 pnpm test,要本机 Chrome 和一本课本 PDF;假百炼 + 假老师,不花钱。
 * 本进程起服务(临时 workspace,vault 的 教材/ 里放一条指向给的 PDF 的链接;老师是 tests/_fake-teacher.ts,嘴是 tests/_fake-realtime.ts),无头 Chrome 开孩子端:
 *  〇、首页不进课本,课本那张就换上封面(首页空闲时画了第 1 页交上来)。
 *  一、首页点语文的「课本」方砖:不到拍照屏,直接上板,板上是课本的目录(舞台 book.tsx 铺好两页);板的顶栏没有拍照、相册;只进门(记一条进门),老师不开口。
 *  二、孩子说「我要预习坐井观天」:老师的课本卡落下,板换成这一课(两页),窗对着第 6–7 段,「井沿」圈上了。
 *  三、手指点板上的一个字:田字格浮出来;经实时那条连接报 {k:'pick', base:'<册子>#坐井观天'};服务端记进板的日志。
 *  四、手指拖着往下看:报 {k:'view', box};服务端说成一句(「第 55 页:…」)记进板的日志。
 *  五、孩子再说一句:那一轮的上下文包里有这一课分好段的全文、他点了什么、「孩子在看」。
 *  六、笔画一道:「擦掉」贴着屏幕边出现、「给老师看」出现;擦掉了都收起。
 *  七、顶栏「目录」:翻回目录,窗停在《坐井观天》那一行(中间);报 {k:'open', title:'目录'};目录上点字不弹田字格。
 *  八、鼠标移到《寒号鸟》那一行:浅浅铺上它的范围;拖着滚不算点。
 *  九、按下窗里的一项:按着的那一行深一点;松手翻到那一课、报 {k:'open'},不叫老师(下一轮「孩子做的」带上)。
 *  十、顶栏课名两边的一对箭头:点「›」翻到下一课、「‹」翻回来,报 {k:'open'},不叫老师。
 *  十一、滚到这一课最后一页下面:一行「下一课 …」,点了翻过去。
 * iPad 横屏各截一张。
 * 用法:node scripts/probe-book-page.mjs --pdf <课本 PDF> [--out <截图目录>]
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS } from './_quiet.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const pdf = opt('--pdf');
if (!pdf) { console.error('要 --pdf <课本 PDF>'); process.exit(2); }
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cdp = 9359;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };
const tmp = probeDir('cotutor-probe-book-page-');
const shots = opt('--out') ?? join(tmp, 'shots');
mkdirSync(shots, { recursive: true });
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import(join(repo, 'src', 'app', 'cli', 'init.ts'));
const { loadWorkspace } = await import(join(repo, 'src', 'app', 'workspace.ts'));
const { createContext, createHandler } = await import(join(repo, 'src', 'app', 'http', 'app.ts'));
const { makeLiveUpgrade } = await import(join(repo, 'src', 'app', 'ws', 'route.ts'));
const { startFakeRealtime } = await import(join(repo, 'tests', '_fake-realtime.ts'));
const { startFakeTeacher } = await import(join(repo, 'tests', '_fake-teacher.ts'));
const { readBoard } = await import(join(repo, 'src', 'runtime', 'journal', 'board-log.ts'));
const { bookIndex } = await import(join(repo, 'src', 'memory', 'textbook-pdf.ts'));
const { bookLesson } = await import(join(repo, 'src', 'board', 'lesson-fit.ts'));
const { bookCut, bookFind, bookSheets } = await import(join(repo, 'src', 'chalk', 'index.ts'));

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
cfg.live = { voices: { 'chinese-tutor': 'Serena' } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const wsx = loadWorkspace(wsRoot);
mkdirSync(wsx.paths.textbooks, { recursive: true });
const name = basename(pdf);
symlinkSync(resolve(pdf), join(wsx.paths.textbooks, name));
const ctx = createContext(wsx);
await ctx.reload();
const upgrade = makeLiveUpgrade({ endpoint: fake.endpoint });
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void upgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const T = 'chinese-tutor';

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
  /** 页面经实时那条连接发出去的 */
  const frames = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Network.webSocketFrameSent' && m.params.response.opcode === 1) { try { frames.push(JSON.parse(m.params.response.payloadData)); } catch {} }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, n), Buffer.from(r.result.data, 'base64')); return join(shots, n); };
  const until = async (expr, ms = 15000) => { for (let t = 0; t < ms; t += 200) { const v = await evaluate(expr); if (v) return v; await sleep(200); } return null; };
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' || type === 'mouseMoved' ? 0 : 1, clickCount: 1 });
  const tapAt = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await sleep(50); await mouse('mouseReleased', x, y); };
  /** 舞台里的板(iframe 里) */
  const STAGE = `document.querySelector('#st-frame')?.contentDocument`;
  const stageEval = (js) => evaluate(`(() => { const d = ${STAGE}; if (!d) return null; return (${js})(d, document.querySelector('#st-frame').getBoundingClientRect()); })()`);
  const camera = () => stageEval(`(d, fr) => { const p = d.querySelector('.bk-paper'), v = d.querySelector('.bk-view'); if (!p || !v) return null; const m = /translate\\(([-\\d.e]+)px, ([-\\d.e]+)px\\) scale\\(([-\\d.e]+)\\)/.exec(p.style.transform); const r = v.getBoundingClientRect(); return m ? { tx: +m[1], ty: +m[2], s: +m[3], left: fr.left + r.left, top: fr.top + r.top, w: r.width, h: r.height } : null; }`);
  const center = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  /** 孩子按住头像说一句(假嘴把这一次听成 text;走页面自己那条实时连接,老师这一轮页面自己放)。新开的浏览器第一次按麦克风还在热,没收下就再按 */
  const say = async (text) => {
    const n0 = (await (await fetch(`${base}/api/kid/conversations/${T}/today`)).json()).messages?.length ?? 0;
    for (let k = 0; k < 3; k++) {
      fake.kidTexts.push(text);
      // 板开着:按住说话是板角上那颗老师小头像(左栏那颗被舞台盖着)
      const h = (await center('#cv-hold')) ?? (await center('#lv-hold'));
      await mouse('mouseMoved', h.x, h.y);
      await mouse('mousePressed', h.x, h.y);
      await sleep(1200);
      await mouse('mouseReleased', h.x, h.y);
      for (let i = 0; i < 20; i++) { if (((await (await fetch(`${base}/api/kid/conversations/${T}/today`)).json()).messages?.length ?? 0) > n0) return true; await sleep(250); }
      fake.kidTexts.length = 0;
    }
    return false;
  };
  const bookState = () => stageEval(`(d) => ({ phase: d.querySelector('.bk-board')?.dataset.phase ?? null, pages: d.querySelectorAll('.bk-page').length, rings: d.querySelectorAll('.bk-ring').length, inks: d.querySelectorAll('.bk-ink path').length })`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });

  // 一、首页点语文的「课本」
  await send('Page.navigate', { url: `${base}/` });
  // 首页一位老师一章:先点语文老师的小旗翻到那一章
  const flag = await until(`(() => { const b = document.querySelector('.tab[data-tutor="${T}"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (flag) { await tapAt(flag.x, flag.y); await sleep(600); }
  const tile = await until(`(() => { const b = document.querySelector('.pc[data-tutor="${T}"] .bt-tile[data-tile="textbook"]'); if (!b) return null; const r = b.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  ok('首页有语文的「课本」方砖', Boolean(tile));
  // 首页课本那张卡的封面:一开始没有,首页空闲时画第 1 页交上来、直接换上(长边 480 的 jpeg),不用先进课本
  let cover = null;
  for (let t = 0; t < 20000 && !cover; t += 300) { const h = await (await fetch(`${base}/api/kid/home`)).json(); cover = h.cards.find((c) => c.kind === 'tutor' && c.props.tutor === T)?.props.tiles?.find((x) => x.id === 'textbook')?.cover?.image ?? null; if (!cover) await sleep(300); }
  const coverImg = cover ? await fetch(`${base}${cover}`) : null;
  const coverBuf = coverImg?.ok ? Buffer.from(await coverImg.arrayBuffer()) : null;
  const coverShown = await until(`(() => { const i = document.querySelector('.pc[data-tutor="${T}"] .bt-tile[data-tile="textbook"] .cv-book img'); return i && i.complete && i.naturalWidth > 0 ? i.naturalWidth : null; })()`, 5000);
  ok('没进课本:首页画了第 1 页交上来,课本那张换上封面(jpeg)', Boolean(coverBuf && coverBuf[0] === 0xff && coverBuf[1] === 0xd8 && coverBuf.length > 5000 && coverShown), JSON.stringify({ cover, size: coverBuf?.length, coverShown }));
  if (coverBuf) writeFileSync(join(shots, '0-封面.jpg'), coverBuf);
  console.log('  ', await shot('0-首页.png'));
  await tapAt(tile.x, tile.y);
  const opened = await until(`(() => { const d = ${STAGE}; return d && d.querySelector('.bk-board')?.dataset.phase === 'ready' && d.querySelectorAll('.bk-page').length >= 1; })()`, 20000);
  const top = await evaluate(`({ bp: document.querySelector('#stage').classList.contains('bp'), bk: document.querySelector('#stage').classList.contains('bk'), cam: getComputedStyle(document.querySelector('#st-bp')).display, start: Boolean(document.querySelector('#board .bp-start')) })`);
  ok('点方砖:不到拍照屏,直接上板,铺的是课本的目录(两页)', Boolean(opened) && !top.start && (await bookState()).pages === 2, JSON.stringify({ top, st: await bookState() }));
  ok('板的顶栏没有拍照、相册', top.bk && top.cam === 'none', JSON.stringify(top));
  await sleep(1500);
  console.log('  ', await shot('1-目录.png'));

  // 二、孩子说要预习坐井观天(另起一条实时连接发进同一个话题;页面轮询拿到老师的卡)
  const day = async () => (await (await fetch(`${base}/api/kid/conversations/${T}/today`)).json());
  let thread = null;
  for (let i = 0; i < 40 && !thread; i++) { thread = (await day()).messages?.slice(-1)[0]?.thread ?? null; if (!thread) await sleep(250); }
  ok('开了一节铺课本的课', Boolean(thread) && (await day()).messages.some((m) => m.base === 'textbook'), String(thread));
  await sleep(1500);
  const door = JSON.parse(readFileSync(join(wsRoot, 'conversations', T, `${(await day()).date}.json`), 'utf8')).messages;
  ok('孩子先说:只进了门(一条进门),老师没开口', door.length === 1 && door[0].enter === true && !door[0].section, JSON.stringify(door.map((m) => ({ t: m.text, enter: m.enter, r: m.result }))));
  for (let i = 0; i < 40 && (await day()).messages.some((m) => m.result === 'running'); i++) await sleep(250);
  if (process.env.PROBE_DEBUG) console.log('  说之前:', JSON.stringify(await evaluate(`({ voice: document.querySelector('#lv-hold')?.dataset.voice, holdRect: document.querySelector('#lv-hold')?.getBoundingClientRect().toJSON(), top: (() => { const r = document.querySelector('#lv-hold').getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el ? el.id || el.className : null; })() })`)), 'conns', fake.conns.length, Boolean(fake.conns[fake.conns.length - 1]?.session));
  const said = await say('我要预习坐井观天');
  ok('孩子按住说「我要预习坐井观天」:收下了', said);
  const landed = await until(`(() => { const d = ${STAGE}; return d && d.querySelector('.bk-board')?.dataset.phase === 'ready' && d.querySelectorAll('.bk-ring').length === 1; })()`, 25000);
  await sleep(1200);
  const cam = await camera();
  const ix = await bookIndex(wsx.paths.textbooks, join(tmp, 'cache'), name);
  const at = bookLesson(ix, '坐井观天');
  const sheets = bookSheets(at.pages, undefined, bookCut(ix.pages));
  const v = [-cam.tx / cam.s, -cam.ty / cam.s, (cam.w - cam.tx) / cam.s, (cam.h - cam.ty) / cam.s];
  const p6 = bookFind(at.pages, sheets, '青蛙笑了');
  ok('老师的动作落下:翻到这一课(两页),「井沿」圈上了,窗里是第 6 段', Boolean(landed) && (await bookState()).pages === 2 && p6 && v[1] <= p6[1] && v[3] >= p6[3], JSON.stringify({ st: await bookState(), v: v.map(Math.round), p6 }));
  console.log('  ', await shot('2-坐井观天.png'));

  // 三、点一个字
  // 窗里的那个「朋」(第一个「朋」在第 4 段,不在窗里)
  const ch = bookFind(at.pages, sheets, '朋', v);
  const sx = cam.left + cam.tx + ((ch[0] + ch[2]) / 2) * cam.s, sy = cam.top + cam.ty + ((ch[1] + ch[3]) / 2) * cam.s;
  const nPick = frames.length;
  await tapAt(sx, sy);
  await sleep(800);
  const pickFrame = frames.slice(nPick).find((f) => f.t === 'board' && f.body?.k === 'pick');
  const tzg = await evaluate(`(() => { const p = document.querySelector('#st-pick'); return p && !p.hidden ? p.textContent : null; })()`);
  ok('点「朋」:田字格浮出来,报 pick(底是「册子#坐井观天」)', pickFrame?.body?.text === '朋' && pickFrame.body.base === `${name}#坐井观天` && Boolean(tzg), JSON.stringify({ pickFrame, tzg }));
  console.log('  ', await shot('3-点字.png'));
  await evaluate(`document.querySelector('#st-pick') && (document.querySelector('#st-pick').hidden = true), true`);

  // 四、手指拖着往下看
  const nView = frames.length;
  await mouse('mouseMoved', 700, 600);
  await mouse('mousePressed', 700, 600);
  for (let i = 1; i <= 12; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 600 - i * 30, button: 'left', buttons: 1 }); await sleep(16); }
  await mouse('mouseReleased', 700, 240);
  // 松手带惯性(book.tsx 的 fling):滑停了再过 SETTLE_MS 才报
  await sleep(3500);
  const viewFrame = frames.slice(nView).find((f) => f.t === 'board' && f.body?.k === 'view');
  ok('拖着往下看:不落笔,停下报一次窗', Boolean(viewFrame) && viewFrame.body.box.length === 4 && (await bookState()).inks === 0, JSON.stringify(viewFrame?.body));
  const log = await readBoard(wsx, T, (await day()).date ?? new Date().toISOString().slice(0, 10), thread);
  const vLog = log.filter((e) => e.k === 'view').slice(-1)[0];
  ok('服务端记下:点的字、窗停在哪一页哪一块', log.some((e) => e.k === 'pick' && e.text === '朋') && /^第 5\d/.test(vLog?.text ?? ''), JSON.stringify(log.slice(-3)));
  console.log('  ', await shot('4-往下看.png'));

  // 五、再说一句:上下文包里有全文、点了什么、孩子在看
  for (let i = 0; i < 40 && (await day()).messages.some((m) => m.result === 'running'); i++) await sleep(250);
  await say('这个字我不会');
  await sleep(800);
  for (let i = 0; i < 60 && (await day()).messages.some((m) => m.result === 'running'); i++) await sleep(250);
  const last = (await day()).messages.slice(-1)[0];
  const run = JSON.parse(readFileSync(join(wsRoot, 'conversations', T, `${(await day()).date}.${last.job}.run.json`), 'utf8'));
  const pr = run.prompt.slice(run.prompt.indexOf('  board:'), run.prompt.indexOf('  board:') + 2000);
  ok('下一轮的上下文包:底是这一课、全文分好段、点了「朋」、孩子在看', pr.includes('《坐井观天》第 54–55 页') && pr.includes('第1段 青蛙坐在井里') && pr.includes('朋') && pr.includes('孩子在看:'), pr);
  // 六、笔画一道:「擦掉」贴着屏幕边冒出来(课本铺满屏宽,没有工具那一栏),「给老师看」这才出现;擦掉了两颗都收起
  for (let i = 0; i < 60 && (await day()).messages.some((m) => m.result === 'running'); i++) await sleep(250);
  await sleep(1500);
  const goShown = () => evaluate(`(() => { const g = document.querySelector('#st-go'); return Boolean(g) && getComputedStyle(g).display !== 'none' && g.getBoundingClientRect().width > 0; })()`);
  const wipeBox = () => stageEval(`(d, fr) => { const w = d.querySelector('.bk-wipe'); if (!w) return null; const r = w.getBoundingClientRect(); return { x: fr.left + r.left + r.width / 2, y: fr.top + r.top + r.height / 2, left: r.left }; }`);
  const before = { go: await goShown(), wipe: await wipeBox(), col: await stageEval(`(d) => Boolean(d.querySelector('.kt-tools'))`), view: await stageEval(`(d) => d.querySelector('.bk-view').getBoundingClientRect().left`) };
  const pen = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen' });
  await pen('mousePressed', 500, 420);
  for (let i = 1; i <= 10; i++) { await pen('mouseMoved', 500 + i * 22, 420 + (i % 2) * 6); await sleep(16); }
  await pen('mouseReleased', 720, 420);
  await sleep(900);
  const after = { go: await goShown(), wipe: await wipeBox(), inks: (await bookState()).inks };
  ok('没动笔:没有工具栏、课本贴着屏幕左边、没有「擦掉」和「给老师看」', before.col === false && before.view === 0 && before.wipe === null && before.go === false, JSON.stringify(before));
  ok('画了一笔:「擦掉」贴着屏幕边出现,「给老师看」出现', after.inks === 1 && after.wipe?.left === 0 && after.go === true, JSON.stringify(after));
  console.log('  ', await shot('5-动了笔.png'));
  if (after.wipe) await tapAt(after.wipe.x, after.wipe.y);
  await sleep(600);
  ok('擦掉:笔画没了,两颗钮收起', (await bookState()).inks === 0 && (await wipeBox()) === null && (await goShown()) === false);

  // 七、顶栏「目录」
  const tocBtn = await center('#st-toc');
  ok('一课里顶栏有「目录」', Boolean(tocBtn));
  const nToc = frames.length;
  await tapAt(tocBtn.x, tocBtn.y);
  const onToc = await until(`(() => { const d = ${STAGE}; return d && d.querySelector('.bk-board')?.dataset.phase === 'ready' && d.querySelectorAll('.bk-page').length === 2 && d.querySelectorAll('.bk-ring').length === 0 && document.querySelector('#st-toc').hidden; })()`, 15000);
  await sleep(800);
  const toc = (await (await fetch(`${base}/api/kid/textbook/base?tutor=${T}`)).json()).toc;
  const box = (t) => toc.entries.find((e) => e.title === t).box;
  const c2 = await camera();
  const scr = (b) => ({ x: c2.left + c2.tx + ((b[0] + b[2]) / 2) * c2.s, y: c2.top + c2.ty + ((b[1] + b[3]) / 2) * c2.s });
  const zj = scr(box('坐井观天'));
  const backFrame = frames.slice(nToc).find((f) => f.t === 'board' && f.body?.k === 'open');
  ok('按「目录」:翻回目录,《坐井观天》那一行在窗的中间;报 open 目录', Boolean(onToc) && Math.abs(zj.y - (c2.top + c2.h / 2)) < 40 && backFrame?.body?.title === '目录' && backFrame.body.base === `${name}#坐井观天`, JSON.stringify({ zj, c2, backFrame }));
  console.log('  ', await shot('6-回到目录.png'));
  // 目录上点字:不弹田字格(点在一行的字上 = 点这一项;点在空处什么都不做)
  const nNoPick = frames.length;
  await tapAt(c2.left + 20, c2.top + c2.h - 30);
  await sleep(700);
  ok('目录上点空处:不弹田字格、不翻', !frames.slice(nNoPick).some((f) => f.t === 'board' && (f.body?.k === 'pick' || f.body?.k === 'open')) && (await evaluate(`document.querySelector('#st-pick').hidden`)));

  // 八、鼠标移上去
  const hh = scr(box('寒号鸟'));
  await mouse('mouseMoved', hh.x, hh.y);
  await sleep(200);
  const hover = await stageEval(`(d) => { const r = d.querySelector('.bk-toc'); return r ? r.getAttribute('fill-opacity') : null; }`);
  ok('鼠标移到《寒号鸟》那一行:浅浅铺上范围', hover === '0.06', String(hover));
  console.log('  ', await shot('7-悬停.png'));
  await mouse('mouseMoved', c2.left + 20, c2.top + 120);
  await sleep(150);
  ok('移开:范围拿掉', (await stageEval(`(d) => d.querySelectorAll('.bk-toc').length`)) === 0);
  // 拖着滚不算点
  const nDrag = frames.length;
  const c3 = await camera();
  await mouse('mouseMoved', hh.x, hh.y);
  await mouse('mousePressed', hh.x, hh.y);
  for (let i = 1; i <= 8; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hh.x, y: hh.y - i * 20, button: 'left', buttons: 1 }); await sleep(16); }
  await mouse('mouseReleased', hh.x, hh.y - 160);
  await sleep(2500);
  ok('按着拖:滚了,不翻、按着的那一行拿掉', !frames.slice(nDrag).some((f) => f.t === 'board' && f.body?.k === 'open') && (await stageEval(`(d) => d.querySelectorAll('.bk-toc').length`)) === 0 && (await camera()).ty !== c3.ty);

  // 九、按下《寒号鸟》
  // 拖完窗滑走了:挑窗中间附近能看见的一项点
  const c4 = await camera();
  const onScreen = (b) => ({ x: c4.left + c4.tx + ((b[0] + b[2]) / 2) * c4.s, y: c4.top + c4.ty + ((b[1] + b[3]) / 2) * c4.s });
  const pickE = toc.entries.filter((e) => e.title !== '坐井观天').map((e) => ({ e, p: onScreen(e.box) })).filter((x) => x.p.y > 150 && x.p.y < c4.h - 150 && x.p.x > 120).sort((a, b) => Math.abs(a.p.y - c4.h / 2) - Math.abs(b.p.y - c4.h / 2))[0];
  const want = pickE.e.title, hp = pickE.p;
  for (let i = 0; i < 60 && (await day()).messages.some((m) => m.result === 'running'); i++) await sleep(250);
  const n0 = (await day()).messages.length;
  const nOpen = frames.length;
  await mouse('mouseMoved', hp.x, hp.y);
  await mouse('mousePressed', hp.x, hp.y);
  await sleep(200);
  const press = await stageEval(`(d) => { const r = d.querySelector('.bk-toc'); return r ? r.getAttribute('fill-opacity') : null; }`);
  console.log('  ', await shot('8-按下.png'));
  await mouse('mouseReleased', hp.x, hp.y);
  const turned = await until(`(() => { const d = ${STAGE}; return document.querySelector('#st-ttl').textContent === ${JSON.stringify(want)} && d && d.querySelector('.bk-board')?.dataset.phase === 'ready'; })()`, 15000);
  const openFrame = frames.slice(nOpen).find((f) => f.t === 'board' && f.body?.k === 'open');
  ok(`按下《${want}》:那一行铺深一点;松手翻过去,报 open`, press === '0.14' && Boolean(turned) && openFrame?.body?.title === want, JSON.stringify({ press, openFrame }));
  const indexNow = async () => JSON.parse(readFileSync(join(wsRoot, 'conversations', T, `${(await day()).date}.json`), 'utf8')).messages;
  await sleep(2500);
  ok('点了一课不叫老师:没有新的一轮', (await day()).messages.length === n0, JSON.stringify((await indexNow()).slice(-2).map((m) => ({ t: m.text, enter: m.enter }))));
  await sleep(1500);
  console.log('  ', await shot('9-点过去.png'));

  // 十、顶栏的上一课、下一课:课名两边一对箭头;点了翻过去、报 open,不叫老师
  const navState = () => evaluate(`({ on: document.querySelector('#st-nav').classList.contains('on'), prev: !document.querySelector('#st-prev').hidden, next: !document.querySelector('#st-next').hidden, ttl: document.querySelector('#st-ttl').textContent })`);
  const nav0 = await navState();
  ok('一课里:课名两边一对箭头', nav0.on && nav0.prev && nav0.next, JSON.stringify(nav0));
  const n10 = (await day()).messages.length;
  const nNext = frames.length;
  const nb = await center('#st-next');
  await tapAt(nb.x, nb.y);
  const went = await until(`document.querySelector('#st-ttl').textContent !== ${JSON.stringify(nav0.ttl)}`, 10000);
  const nav1 = await navState();
  const fNext = frames.slice(nNext).find((f) => f.t === 'board' && f.body?.k === 'open');
  await sleep(1500);
  const after10 = (await day()).messages;
  ok(`点「›」:从《${nav0.ttl}》翻到下一课《${nav1.ttl}》,报 open,不叫老师`, Boolean(went) && fNext?.body?.title === nav1.ttl && after10.length === n10, JSON.stringify({ nav0, nav1, f: fNext?.body, n10, n: after10.length }));
  console.log('  ', await shot('10-下一课.png'));
  const pb = await center('#st-prev');
  await tapAt(pb.x, pb.y);
  const back10 = await until(`document.querySelector('#st-ttl').textContent === ${JSON.stringify(nav0.ttl)}`, 10000);
  ok(`点「‹」:翻回《${nav0.ttl}》`, Boolean(back10), JSON.stringify(await navState()));
  // 十一、滚到这一课最后一页下面:一行「下一课」,点了翻过去
  await until(`(() => { const d = ${STAGE}; return d && d.querySelector('.bk-board')?.dataset.phase === 'ready'; })()`, 15000);
  let row = null;
  for (let i = 0; i < 40 && !row; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 500, deltaX: 0, deltaY: 600 });
    await sleep(120);
    row = await stageEval(`(d, fr) => { const n = d.querySelector('.bk-next'); if (!n) return null; const r = n.getBoundingClientRect(); return r.bottom > 0 && r.bottom < fr.height - 10 ? { x: fr.left + r.left + r.width / 2, y: fr.top + r.top + r.height / 2, text: n.textContent } : null; }`);
  }
  console.log('  ', await shot('11-最后一页下面.png'));
  ok('滚到最后一页下面:一行「下一课」(写着下一课的名字)', Boolean(row) && row.text.includes(nav1.ttl), JSON.stringify(row));
  if (row) {
    const nRow = frames.length;
    await tapAt(row.x, row.y);
    const rowWent = await until(`document.querySelector('#st-ttl').textContent === ${JSON.stringify(nav1.ttl)}`, 10000);
    ok('点那一行:翻到下一课,报 open', Boolean(rowWent) && frames.slice(nRow).some((f) => f.t === 'board' && f.body?.k === 'open' && f.body.title === nav1.ttl));
  }
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
