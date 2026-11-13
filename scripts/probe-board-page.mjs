#!/usr/bin/env node
/**
 * 以板为主的 activity(语文「预习」,头上 board: page)的手动验收(不进 pnpm test,要本机 Chrome 与一个跑着的 mock;不花钱)。
 * mock 的语文老师牌上「预习」方砖以板为主;孩子拍来的那张照假课本页认字(探针拍的就是那一页的截图)。
 * 一、点「预习」→ 先到拍照屏(拍照、从相册选、不拍用白板),不发东西、老师不开口。
 * 二、拍一张 → 发照片屏 → 发:照片马上铺满一块板,不等老师;字词的底一个一个垫出来。
 * 三、老师的照片板(不写图)落在同一块板上:板不关,顶栏换成老师的题目。
 * 四、点「变」→ 田字格浮出来;经实时那条连接报给服务端 {t:'board', body:{k:'pick', text:'变', thread, base}};假嘴念「变」。
 * 五、按住头像说一句 → 老师这一轮出了别的卡(服务端只上板卡):板还在。
 * 六、板上的「拍照」换一张 → 新照片铺上(换底),板不关;× 回到首页。
 * 七、再点「预习」→ 今天点过,选「重新开始」→ 拍照屏 →「不拍,用白板」→ 板是白板。
 * iPad 横屏各截一张。用法:node scripts/probe-board-page.mjs [mock 根地址] [--out <截图目录>]
 *   缺省 http://127.0.0.1:8790(先 cotutor mock --http;探针会发消息,再跑要重起 mock)
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUIET_ARGS } from './_quiet.mjs';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const base = (args.find((a, i) => !a.startsWith('--') && (outAt < 0 || i !== outAt + 1)) ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9357;
const tmp = probeDir('cotutor-probe-board-page-');
const shots = outAt >= 0 ? args[outAt + 1] : join(tmp, 'shots');
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const proc = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome 没起来');
}

const ws = new WebSocket(await target());
await new Promise((r) => { ws.onopen = r; });
let seq = 0;
const pending = new Map();
/** 页面经 WebSocket 发出去的、收到的(实时那条连接) */
const sent = [];
const got = [];
/** 文件选择框开了:回它的 backendNodeId */
let chooser = null;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Network.webSocketFrameSent' && m.params.response.opcode === 1) { try { sent.push(JSON.parse(m.params.response.payloadData)); } catch {} }
  if (m.method === 'Network.webSocketFrameReceived' && m.params.response.opcode === 1) { try { got.push(JSON.parse(m.params.response.payloadData)); } catch {} }
  if (m.method === 'Page.fileChooserOpened') chooser = m.params.backendNodeId;
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
const until = async (expr, ms = 8000, every = 100) => { for (let t = 0; t < ms; t += every) { const v = await evaluate(expr); if (v) return v; await sleep(every); } return null; };
const center = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); if (!r.width) return null; return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const tap = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const press = async (sel) => { const p = await center(sel); if (!p) return false; await tap(p.x, p.y); return true; };
/** 按到写着这几个字的那颗(拍照屏的按钮在左栏) */
const pressText = async (sel, text) => {
  const p = await evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.textContent.includes(${JSON.stringify(text)}) && b.getBoundingClientRect().width > 0); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!p) return false;
  await tap(p.x, p.y);
  return true;
};
const inStage = (js) => evaluate(`(() => { const f = document.querySelector('#st-frame'); const d = f.contentDocument; if (!d) return null; const el = (${js})(d); if (!el) return null; const fr = f.getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: fr.left + r.left + r.width / 2, y: fr.top + r.top + r.height / 2, w: r.width, h: r.height }; })()`);
const stageOn = () => evaluate(`document.querySelector('#stage').classList.contains('on') && document.querySelector('#stage').classList.contains('bp')`);
const photoHref = () => evaluate(`document.querySelector('#st-frame')?.contentDocument?.querySelector('.kt-svg image')?.getAttribute('href') ?? null`);
const ready = (ms = 15000) => until(`document.querySelector('#st-frame')?.contentDocument?.querySelector('.kt-board')?.dataset.phase === 'ready'`, ms, 50);
const day = async () => (await (await fetch(`${base}/api/kid/conversations/chinese-tutor/today`)).json());
/** 拍一张:点了拍照 / 相册,文件选择框里放这张,发照片屏里按「发给」 */
const choose = async (file) => {
  chooser = null;
  for (let i = 0; i < 40 && chooser === null; i++) await sleep(100);
  if (chooser === null) return false;
  await send('DOM.setFileInputFiles', { files: [file], backendNodeId: chooser });
  if (!(await until(`document.querySelector('#ps').classList.contains('on')`, 5000))) return false;
  await sleep(300);
  return press('#ps-go');
};

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('DOM.enable');
  // 假课本页拍成一张 png(探针拍的「课本」):mock 照它认字
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/api/kid/image?p=${encodeURIComponent('captures/2026-09-10/page.jpg')}` });
  await sleep(800);
  const pagePng = join(tmp, 'page.png');
  writeFileSync(pagePng, Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 800, height: 1000, scale: 1 } })).result.data, 'base64'));
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });

  // ---- 一、点「预习」→ 拍照屏 ----
  await send('Page.navigate', { url: `${base}/` });
  await until(`Boolean(document.querySelector('[data-tile="preview"]'))`, 10000);
  const tile = await evaluate(`(() => { const t = [...document.querySelectorAll('.c-tutor')].find((c) => c.textContent.includes('语文老师')); const b = t && t.querySelector('[data-tile="preview"]'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  ok('语文老师牌上有「预习」方砖', Boolean(tile));
  await tap(tile.x, tile.y);
  ok('点了先到拍照屏:拍照、从相册选、不拍用白板', Boolean(await until(`document.querySelector('#tutor').classList.contains('on') && [...document.querySelectorAll('#lv-acts .lv-go, .bp-start .ask-go')].map((b) => b.textContent).join('|').includes('不拍,用白板')`, 8000)));
  await sleep(500);
  ok('拍照屏不发东西:今天还没有这个话题', (await day()).messages.length === 0 || !(await day()).messages.some((m) => m.board === 'page'));
  await shot('board-1-start.png');

  // ---- 二、拍一张:马上铺板 ----
  await pressText('#lv-acts .lv-go, .bp-start .ask-go', '拍照');
  ok('拍照:进发照片屏、发出去', await choose(pagePng));
  ok('照片马上铺满一块板(不等老师)', Boolean(await until(`document.querySelector('#stage').classList.contains('on') && document.querySelector('#stage').classList.contains('bp')`, 5000)));
  ok('铺板时老师还没写出这一节(顶栏还没有老师的题目)', (await evaluate(`document.querySelector('#st-ttl').textContent`)) === '');
  ok('板上是孩子拍的那张', Boolean(await until(`(document.querySelector('#st-frame')?.contentDocument?.querySelector('.kt-svg image')?.getAttribute('href') ?? '').includes('captures')`, 10000)), await photoHref());
  const first = sent.find((m) => m.t === 'send');
  ok('发出去的那条:带首页的方砖和照片', Boolean(first?.body?.via?.button === 'preview' && first?.body?.photos?.length === 1), JSON.stringify(first?.body));
  ok('字词的底垫出来', Boolean(await until(`(document.querySelector('#st-frame')?.contentDocument?.querySelectorAll('.kt-word').length ?? 0) >= 3`, 10000)));
  await shot('board-2-photo.png');

  // ---- 三、老师的照片板落在同一块板上 ----
  ok('老师这一轮写完了', Boolean(await until(`!document.body.classList.contains('pending')`, 20000)));
  ok('板没关,顶栏是老师的题目', Boolean(await until(`document.querySelector('#st-ttl').textContent.includes('点一点')`, 5000)) && (await stageOn()), await evaluate(`document.querySelector('#st-ttl').textContent`));
  const d1 = await day();
  const head = d1.messages.find((m) => m.board === 'page');
  ok('话题第一条记着 board: page;老师的照片板补上了底', Boolean(head) && d1.messages.some((m) => m.thread === head.thread && m.section?.cards.some((c) => c.kind === 'kit' && c.props.params?.['图'] === head.photos?.[0])), JSON.stringify(d1.messages.map((m) => [m.board, m.photos, m.section?.cards.map((c) => c.props.params?.['图'])])));
  await ready();
  await until(`document.querySelector('#st-frame')?.contentDocument?.querySelectorAll('.kt-word').length === 8`, 10000);
  await shot('board-3-teacher.png');

  // ---- 四、点「变」 ----
  // 等老师念完(嘴在念讲稿时点字,嘴不念这个字)
  await until(`!document.body.classList.contains('speaking')`, 15000);
  await sleep(800);
  const bian = await inStage(`(d) => d.querySelectorAll('.kt-word')[3]`);
  const before = sent.length;
  await tap(bian.x, bian.y);
  ok('点「变」:田字格浮出来', Boolean(await until(`[...document.querySelectorAll('#st-pick .hz')].map((b) => b.dataset.ch).join('') === '变'`, 3000)));
  const ev = await (async () => { for (let i = 0; i < 20; i++) { const x = sent.slice(before).find((m) => m.t === 'board'); if (x) return x; await sleep(100); } return null; })();
  ok('报给服务端:点字、哪个话题、哪块底', ev?.body?.k === 'pick' && ev.body.text === '变' && ev.body.thread === head.thread && ev.body.base === head.photos[0], JSON.stringify(ev));
  for (let i = 0; i < 20 && !got.some((m) => m.t === 'tutor' && m.done === '变'); i++) await sleep(100);
  ok('假嘴念了「变」', got.some((m) => m.t === 'tutor' && m.done === '变'), JSON.stringify(got.filter((m) => m.t === 'tutor').slice(-2)));
  await shot('board-4-pick.png');

  // ---- 五、按住头像说一句:老师这一轮出了别的卡,板还在 ----
  await press('#st-pick-x');
  const hold = await center('#cv-hold');
  ok('板上有老师的小头像(按住说话)', Boolean(hold));
  await until(`!document.body.classList.contains('speaking') && !document.body.classList.contains('pending')`, 15000);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hold.x, y: hold.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hold.x, y: hold.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(1200);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hold.x, y: hold.y, button: 'left', buttons: 0, clickCount: 1 });
  for (let i = 0; i < 30 && !sent.some((m) => m.t === 'release'); i++) await sleep(100);
  ok('松手交给老师了(带着这个话题)', sent.filter((m) => m.t === 'release').slice(-1)[0]?.body?.thread === head.thread, JSON.stringify(sent.filter((m) => m.t === 'release').slice(-1)[0]));
  await sleep(500);
  ok('老师写完这一轮', Boolean(await until(`!document.body.classList.contains('pending')`, 20000)));
  await sleep(600);
  const d2 = await day();
  ok('服务端只上板卡:这一轮别的卡没给孩子看', d2.messages.slice(-1)[0]?.section?.cards.every((c) => c.kind === 'kit') !== false, JSON.stringify(d2.messages.slice(-1)[0]?.section?.cards.map((c) => c.kind)));
  ok('板还在', await stageOn());
  await shot('board-5-talk.png');

  // ---- 六、板上的拍照:换一张;× 回首页 ----
  const href1 = await photoHref();
  await press('#st-cam');
  ok('板上的拍照:换一张发出去', await choose(pagePng));
  ok('新照片铺上(换底),板没关', Boolean(await until(`(document.querySelector('#st-frame')?.contentDocument?.querySelector('.kt-svg image')?.getAttribute('href') ?? '') !== ${JSON.stringify(href1)}`, 8000)) && (await stageOn()), await photoHref());
  ok('换底的那条发在同一个话题', sent.filter((m) => m.t === 'send').slice(-1)[0]?.body?.thread === head.thread, JSON.stringify(sent.filter((m) => m.t === 'send').slice(-1)[0]?.body));
  for (let i = 0; i < 100 && (await day()).messages.some((m) => m.pending); i++) await sleep(200);
  await shot('board-6-swap.png');
  await press('#st-x');
  ok('× 回到首页', Boolean(await until(`!document.querySelector('#tutor').classList.contains('on')`, 5000)));

  // ---- 七、再点「预习」→ 重新开始 → 白板 ----
  await until(`Boolean(document.querySelector('[data-tile="preview"]'))`, 8000);
  const tile2 = await evaluate(`(() => { const t = [...document.querySelectorAll('.c-tutor')].find((c) => c.textContent.includes('语文老师')); const b = t && t.querySelector('[data-tile="preview"]'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tap(tile2.x, tile2.y);
  // 今天点过的(真服务给 resume):先问接着还是重新开始;mock 的方砖不给 resume,直接到拍照屏
  if (await until(`[...document.querySelectorAll('#lv-acts .lv-go, .ask-go')].some((b) => b.textContent.includes('重新开始') || b.textContent.includes('不拍'))`, 6000) && (await evaluate(`[...document.querySelectorAll('#lv-acts .lv-go, .ask-go')].some((b) => b.textContent.includes('重新开始'))`))) await pressText('#lv-acts .lv-go, .ask-go', '重新开始');
  ok('再点:到拍照屏', Boolean(await until(`[...document.querySelectorAll('#lv-acts .lv-go, .bp-start .ask-go')].some((b) => b.textContent.includes('不拍,用白板'))`, 4000)));
  await pressText('#lv-acts .lv-go, .bp-start .ask-go', '不拍,用白板');
  ok('不拍:板是白板(没有照片)', Boolean(await until(`document.querySelector('#stage').classList.contains('bp') && document.querySelector('#st-frame')?.contentDocument?.querySelector('.kt-board')?.dataset.phase === 'ready'`, 10000)) && !(await photoHref()));
  ok('发的是方砖上的字,新话题', (() => { const m = sent.filter((x) => x.t === 'send').slice(-1)[0]; return m?.body?.via?.button === 'preview' && m.body.newThread === true && !m.body.photos; })(), JSON.stringify(sent.filter((x) => x.t === 'send').slice(-1)[0]?.body));
  await until(`!document.body.classList.contains('pending')`, 20000);
  ok('老师说完,白板还在', await stageOn());
  await shot('board-7-white.png');
} catch (err) {
  bad++;
  console.error('✗ 探针出错:', err instanceof Error ? err.stack : err);
} finally {
  console.log(`截图在 ${shots}`);
  ws.close();
  proc.kill();
  process.exitCode = bad ? 1 : 0;
}
