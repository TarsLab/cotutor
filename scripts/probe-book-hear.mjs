#!/usr/bin/env node
/**
 * 点读一块(课本分块里写了念法 say 的块,docs/dev/课本.md 的「分块」;设计稿 https://claude.ai/artifact/CHC2ikn5Dy1FggG8wF1WqW)孩子端手动验收:
 * 不进 pnpm test,要本机 Chrome、一本课本 PDF 和一份改好的分块(编程助手 push 出来的 教材/.zones/<指纹>/);假百炼 + 假老师 + 假配音,不花钱。
 * 搭法同 scripts/probe-book-read.mjs:本进程起服务,临时 workspace 的 教材/ 里链着给的 PDF、拷一份给的分块;这本书「上次翻到」记成那一课、窗停在那一块上。
 *  一、首页点这位老师的「课本」:直接铺那一课,窗在那一块上;平时不画范围。
 *  二、鼠标移到那一块(不在格子上):浅浅铺一层(.bk-zone-hint);移开收掉。
 *  三、点它:假配音收到那一块的念法(一次);念的时候那一块铺学科色(.bk-say 的 z.<id>);报 {k:'hear', text: 叫法},服务端记进板的日志。
 *  四、念着再点同一块:停,铺的色收掉。
 *  五、再点:从头念;不再合成(有缓存)。念完铺的色收掉。
 * iPad 横屏各截一张。
 * 用法:node scripts/probe-book-hear.mjs --pdf <课本 PDF> --zones <教材/.zones/<指纹> 目录> --lesson <课名> --block <块的叫法> [--tutor math-tutor] [--out <截图目录>]
 *  例:--pdf 数学二年级上册-人教版.pdf --zones <vault>/教材/.zones/dd7a53795587fa44 --lesson 7～9的乘法口诀 --block 二七
 */
import { probeDir, spawn } from './_guard.mjs';
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS } from './_quiet.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const pdf = opt('--pdf'), zonesDir = opt('--zones'), lessonName = opt('--lesson'), blockLabel = opt('--block');
const T = opt('--tutor') ?? 'math-tutor';
if (!pdf || !zonesDir || !lessonName || !blockLabel) { console.error('要 --pdf <课本 PDF> --zones <分块目录> --lesson <课名> --block <块的叫法>'); process.exit(2); }
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cdp = 9362;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };
const tmp = probeDir('cotutor-probe-book-hear-');
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
const { bookCut, bookSayZones, bookSheets } = await import(join(repo, 'src', 'chalk', 'index.ts'));
const { bookZones } = await import(join(repo, 'src', 'memory', 'textbook-zones.ts'));
const { pickBookZones } = await import(join(repo, 'src', 'schema', 'index.ts'));
const { startFakeTts } = await import(join(repo, 'tests', '_fake-tts.ts'));

const fake = await startFakeRealtime();
fake.audioMs = 300;
const teacher = await startFakeTeacher();
const tts = await startFakeTts({ tone: true });
process.env.COTUTOR_TTS_ENDPOINT = tts.url;
process.env.COTUTOR_BRAIN_ENDPOINT = teacher.baseURL;
const wsRoot = join(tmp, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot, grade: 2 });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.runtimes = { default: 'stream', stream: { api: 'bailian', model: 'fake-stream' } };
for (const t of Object.values(cfg.tutors)) delete t.runtime;
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const wsx = loadWorkspace(wsRoot);
mkdirSync(wsx.paths.textbooks, { recursive: true });
const name = basename(pdf);
symlinkSync(resolve(pdf), join(wsx.paths.textbooks, name));
const sha = createHash('sha1').update(readFileSync(pdf)).digest('hex').slice(0, 16);
cpSync(resolve(zonesDir), join(wsx.paths.textbooks, '.zones', sha), { recursive: true });
// 这一块在场景里在哪:窗停在它上面(「上次翻到」记成这一课、这个窗)
const cache = join(wsRoot, '.cotutor', 'textbooks');
const ix = await bookIndex(wsx.paths.textbooks, cache, name);
const at = bookLesson(ix, lessonName);
if (!at) { console.error(`没有《${lessonName}》`); process.exit(2); }
const ns = at.pages.map((p) => p.n);
const zones = await bookZones(wsx.paths.textbooks, cache, ix);
const picked = pickBookZones(ix, zones, ns);
const sheets = bookSheets(at.pages, undefined, bookCut(ix.pages));
const say = bookSayZones(at.pages, sheets, picked.pages);
const target = say.find((z) => z.label === blockLabel);
if (!target) { console.error(`《${lessonName}》的分块里没有写了念法、叫「${blockLabel}」的块(用的是${picked.which === 'vault' ? '给的分块' : '规则出的'})`); process.exit(2); }
let sayText = '';
for (const zp of picked.pages) { const walk = (zs) => { for (const z of zs) { if (z.id === target.id && z.say) sayText = z.say; if (z.children) walk(z.children); } }; walk(zp.zones); }
const [, ty1, , ty2] = target.box;
mkdirSync(join(wsRoot, '.cotutor'), { recursive: true });
writeFileSync(join(wsRoot, '.cotutor', 'book-last.json'), JSON.stringify({ [name]: { title: at.title, view: [0, Math.max(0, (ty1 + ty2) / 2 - 300), 1000, (ty1 + ty2) / 2 + 300], at: new Date().toISOString() } }));
const ctx = createContext(wsx);
await ctx.reload();
const upgrade = makeLiveUpgrade({ endpoint: fake.endpoint });
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void upgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

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
  const day = async () => (await (await fetch(`${base}/api/kid/conversations/${T}/today`)).json());
  const hint = () => stageEval(`(d) => [...d.querySelectorAll('.bk-zone-hint')].map((r) => r.getAttribute('fill-opacity'))`);
  const lit = () => stageEval(`(d) => [...d.querySelectorAll('.bk-say g:not(.bk-gone)')].map((g) => g.dataset.say)`);

  // 一、进课本:直接铺那一课,窗在那一块上
  await send('Page.navigate', { url: `${base}/` });
  const flag = await until(`(() => { const b = document.querySelector('#tabs .tab[data-tutor="${T}"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 30 }; })()`);
  if (flag) { await tapAt(flag.x, flag.y); await sleep(900); }
  const tile = await until(`(() => { const b = document.querySelector('.pc.front[data-tutor="${T}"] .bt-tile[data-tile="textbook"]') ?? document.querySelector('[data-tutor="${T}"] .bt-tile[data-tile="textbook"]'); if (!b) return null; const r = b.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  ok('首页有「课本」方砖', Boolean(tile));
  await tapAt(tile.x, tile.y);
  const landed = await until(`(() => { const d = ${STAGE}; return d && document.querySelector('#st-ttl').textContent === ${JSON.stringify(at.title)} && d.querySelector('.bk-board')?.dataset.phase === 'ready'; })()`, 25000);
  ok(`直接铺《${at.title}》(用的是${picked.which === 'vault' ? '给的分块' : '规则出的'})`, Boolean(landed));
  await sleep(2500);
  const cam = await camera();
  // 点在这一块左边四分之一(叫法、题面那里,不在格子上)
  const pt = { x: cam.left + cam.tx + (target.box[0] + (target.box[2] - target.box[0]) * 0.12) * cam.s, y: cam.top + cam.ty + ((target.box[1] + target.box[3]) / 2) * cam.s };
  ok('那一块在窗里', pt.y > cam.top + 20 && pt.y < cam.top + cam.h - 60, JSON.stringify({ pt, cam }));
  ok('平时不画范围', (await hint()).length === 0 && (await lit()).length === 0);
  console.log('  ', await shot('0-进来.png'));

  // 二、悬停
  await mouse('mouseMoved', pt.x, pt.y);
  await sleep(300);
  const hv = await hint();
  ok('鼠标移到那一块:浅浅铺一层', hv.length >= 1 && hv.every((o) => o === '0.06'), JSON.stringify(hv));
  console.log('  ', await shot('1-悬停.png'));
  await mouse('mouseMoved', cam.left + 20, cam.top + 20);
  await sleep(300);
  ok('移开:收掉', (await hint()).length === 0, JSON.stringify(await hint()));

  // 三、点它:念
  const n0 = tts.requests.length, nf = frames.length;
  await tapAt(pt.x, pt.y);
  const on = await until(`(() => { const d = ${STAGE}; return d && [...d.querySelectorAll('.bk-say g:not(.bk-gone)')].some((g) => g.dataset.say === 'z.${target.id}'); })()`, 15000);
  ok('点它:那一块铺学科色(念的时候)', Boolean(on), JSON.stringify(await lit()));
  const sent = tts.requests.slice(n0);
  ok('假配音收到那一块的念法(一次)', sent.length === 1 && sent[0].text === sayText && !sent[0].sse, JSON.stringify({ sent, sayText }));
  const hf = frames.slice(nf).find((f) => f.t === 'board' && f.body?.k === 'hear');
  ok('报 hear(叫法)', hf?.body?.text === blockLabel, JSON.stringify(hf));
  console.log('  ', await shot('2-在念.png'));
  await sleep(400);
  const d0 = await day();
  const log = await readBoard(wsx, T, d0.date, d0.messages.slice(-1)[0]?.thread ?? '');
  ok('服务端记进板的日志', log.some((e) => e.k === 'hear' && e.text === blockLabel), JSON.stringify(log.slice(-3)));

  // 四、念着再点:停
  await tapAt(pt.x, pt.y);
  const off = await until(`(() => { const d = ${STAGE}; return d && ![...d.querySelectorAll('.bk-say g:not(.bk-gone)')].length; })()`, 4000);
  ok('念着再点同一块:停,铺的色收掉', Boolean(off), JSON.stringify(await lit()));

  // 五、再点:从头念,不再合成;念完收掉
  await sleep(500);
  await tapAt(pt.x, pt.y);
  const again = await until(`(() => { const d = ${STAGE}; return d && [...d.querySelectorAll('.bk-say g:not(.bk-gone)')].some((g) => g.dataset.say === 'z.${target.id}'); })()`, 15000);
  ok('再点:又念,不再合成', Boolean(again) && tts.requests.length === n0 + 1, String(tts.requests.length - n0));
  const done = await until(`(() => { const d = ${STAGE}; return d && ![...d.querySelectorAll('.bk-say g:not(.bk-gone)')].length; })()`, 12000);
  ok('念完:铺的色收掉', Boolean(done));
  console.log('  ', await shot('3-念完.png'));
  ok('页面没有脚本报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`\n截图在 ${shots}`);
  ws.close();
} finally {
  browser?.kill();
  server.close();
  await teacher.close();
  await tts.close();
  await fake.close?.();
}
process.exit(bad ? 1 : 0);
