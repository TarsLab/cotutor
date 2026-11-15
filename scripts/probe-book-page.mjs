#!/usr/bin/env node
/**
 * 课本做底的孩子端整条线(语文预习,activity 头上 base: textbook)手动验收:不进 pnpm test,要本机 Chrome 和一本课本 PDF;假百炼 + 假老师,不花钱。
 * 本进程起服务(临时 workspace,vault 的 教材/ 里放一条指向给的 PDF 的链接;老师是 tests/_fake-teacher.ts,嘴是 tests/_fake-realtime.ts),无头 Chrome 开孩子端:
 *  一、首页点语文的「预习」方砖:不到拍照屏,直接上板,板上是课本的目录(舞台 book.tsx 铺好两页);板的顶栏没有拍照、相册。
 *  二、孩子说「我要预习坐井观天」:老师的课本卡落下,板换成这一课(两页),窗对着第 6–7 段,「井沿」圈上了。
 *  三、手指点板上的一个字:田字格浮出来;经实时那条连接报 {k:'pick', base:'<册子>#坐井观天'};服务端记进板的日志。
 *  四、手指拖着往下看:报 {k:'view', box};服务端说成一句(「第 55 页:…」)记进板的日志。
 *  五、孩子再说一句:那一轮的上下文包里有这一课分好段的全文、他点了什么、「孩子在看」。
 *  六、笔画一道:「擦掉」贴着屏幕边出现、「给老师看」出现;擦掉了都收起。
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
const { bookLesson } = await import(join(repo, 'src', 'board', 'board-page.ts'));
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

  // 一、首页点语文的「预习」
  await send('Page.navigate', { url: `${base}/` });
  const tile = await until(`(() => { const b = [...document.querySelectorAll('.bt-tile[data-tile="preview"]')].find((x) => x.closest('[data-tutor], .card, section')?.textContent.includes('语文')) ?? null; if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  ok('首页有语文的「预习」方砖', Boolean(tile));
  await tapAt(tile.x, tile.y);
  const opened = await until(`(() => { const d = ${STAGE}; return d && d.querySelector('.bk-board')?.dataset.phase === 'ready' && d.querySelectorAll('.bk-page').length >= 1; })()`, 20000);
  const top = await evaluate(`({ bp: document.querySelector('#stage').classList.contains('bp'), bk: document.querySelector('#stage').classList.contains('bk'), cam: getComputedStyle(document.querySelector('#st-bp')).display, start: Boolean(document.querySelector('#board .bp-start')) })`);
  ok('点方砖:不到拍照屏,直接上板,铺的是课本的目录(两页)', Boolean(opened) && !top.start && (await bookState()).pages === 2, JSON.stringify({ top, st: await bookState() }));
  ok('板的顶栏没有拍照、相册', top.bk && top.cam === 'none', JSON.stringify(top));
  await sleep(1500);
  console.log('  ', await shot('1-目录.png'));

  // 二、孩子说要预习坐井观天(另起一条实时连接发进同一个话题;页面轮询拿到老师的卡)
  const day = async () => (await (await fetch(`${base}/api/kid/conversations/${T}/today`)).json());
  const thread = (await day()).messages?.slice(-1)[0]?.thread;
  ok('开了一个以板为主的话题', Boolean(thread) && (await day()).messages.some((m) => m.board === 'page'), String(thread));
  await until(`(() => true)()`);
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
  ok('老师的课本卡落下:板换成这一课(两页),「井沿」圈上了,窗里是第 6 段', Boolean(landed) && (await bookState()).pages === 2 && p6 && v[1] <= p6[1] && v[3] >= p6[3], JSON.stringify({ st: await bookState(), v: v.map(Math.round), p6 }));
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
