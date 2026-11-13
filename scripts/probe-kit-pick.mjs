#!/usr/bin/env node
/**
 * 照片板「点字」的手动验收(不进 pnpm test,要本机 Chrome 与一个跑着的 mock;不花钱)。
 * mock 的语文老师:说的话里有「课本」就出一张照片板(假课本页,操作: 点字);认出的字词头两次问还在认(三项),之后认完(八项)。
 * 一、打字发一句 → 照片板落下就自己铺满打开;没有「给老师看」、没有擦掉的钮(只点字,没有东西要交)。
 * 二、认出的字词垫着底,一个一个出来(先三项,后八项);课本要会写的那几项深一点。
 * 三、手指点「变」→ 田字格浮在板的一角、一笔一笔写;这一笔不留在板上;状态里记下点过「变」。
 * 四、圈住「海洋」→ 田字格换成两个字;状态里两项,照先后。点空白处:什么都不弹,板上也不留笔画。
 * 五、正文里没垫底的字也能点:点那一行的第 3 个字「课」→ 田字格是「课」;点在逗号上不弹。
 * 六、× 收起田字格;给老师的那句照先后列出点过的;关掉舞台田字格也跟着收。
 * iPad 横屏各截一张。用法:node scripts/probe-kit-pick.mjs [mock 根地址] [--out <截图目录>]
 *   缺省 http://127.0.0.1:8790(先 cotutor mock --http)
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUIET_ARGS } from './_quiet.mjs';
import { liveSend } from './_live-send.mjs';
import { describeKit, kitOf, kitOps, kitParams } from '../src/chalk/index.ts';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const base = (args.find((a, i) => !a.startsWith('--') && (outAt < 0 || i !== outAt + 1)) ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9353;
const tmp = probeDir('cotutor-probe-kit-pick-');
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
/** 页面经 WebSocket 发出去的(实时那条连接) */
const sent = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Network.webSocketFrameSent' && m.params.response.opcode === 1) { try { sent.push(JSON.parse(m.params.response.payloadData)); } catch {} }
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
const until = async (expr, ms = 8000, every = 100) => { for (let t = 0; t < ms; t += every) { const v = await evaluate(expr); if (v) return v; await sleep(every); } return null; };
const center = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
/** 手指点一下(CDP 鼠标事件走命中判定;AGENTS.md「坑」) */
const tap = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const press = async (sel) => { const p = await center(sel); if (!p) return false; await tap(p.x, p.y); return true; };
/** 舞台 iframe 里一个元素在整页上的中心(iframe 的位置 + 元素在 iframe 里的位置) */
const inStage = (js) => evaluate(`(() => { const f = document.querySelector('#st-frame'); const d = f.contentDocument; if (!d) return null; const el = (${js})(d); if (!el) return null; const fr = f.getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: fr.left + r.left + r.width / 2, y: fr.top + r.top + r.height / 2, w: r.width, h: r.height }; })()`);
/** 图上写着这个字的那一处在整页上的位置 */
const wordAt = (ch) => inStage(`(d) => [...d.querySelectorAll('.kt-svg text')].find((t) => t.textContent.trim() === ${JSON.stringify(ch)})`);
const phase = () => evaluate(`document.querySelector('#st-frame')?.contentDocument?.querySelector('.kt-board')?.dataset.phase ?? null`);
const day = async () => (await (await fetch(`${base}/api/kid/conversations/chinese-tutor/today`)).json());
const kitCards = async () => (await day()).messages.flatMap((m) => (m.section?.cards ?? []).map((c, n) => ({ ...c, id: `${m.job}/${n}` }))).filter((c) => c.kind === 'kit');
/** 孩子在页面里打字发一句(左栏「打字」→ 输入 → 发) */
const type = async (text) => {
  await press('#lv-type');
  await until(`!document.querySelector('#typed').hidden`, 3000);
  await evaluate(`document.querySelector('#typed').focus()`);
  await send('Input.insertText', { text });
  await until(`!document.querySelector('#go').hidden`, 3000);
  await press('#go');
};


try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor` });
  await until(`document.body.classList.contains('live') && Boolean(document.querySelector('#lv-type'))`, 10000);
  await until(`!document.body.classList.contains('pending')`, 15000);
  const ready = (ms = 15000) => until(`document.querySelector('#st-frame')?.contentDocument?.querySelector('.kt-board')?.dataset.phase === 'ready'`, ms, 50);
  const tools = () => evaluate(`[...(document.querySelector('#st-frame')?.contentDocument?.querySelectorAll('.kt-btn') ?? [])].map((b) => b.textContent.trim()).join()`);
  const inkCount = () => evaluate(`document.querySelector('#st-frame')?.contentDocument?.querySelectorAll('.kt-ink > *').length ?? -1`);
  const wordCount = () => evaluate(`document.querySelector('#st-frame')?.contentDocument?.querySelectorAll('.kt-word').length ?? -1`);
  /** 第 n 个垫底的框在整页上的位置(框的先后 = 认出的先后) */
  const wordBox = (n) => inStage(`(d) => d.querySelectorAll('.kt-word')[${n}]`);
  const stroke = async (pts) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0][0], y: pts[0][1] });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], button: 'left', buttons: 1, clickCount: 1 });
    for (const [x, y] of pts.slice(1)) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }); await sleep(10); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], button: 'left', buttons: 0, clickCount: 1 });
    await sleep(250);
  };
  const picked = () => evaluate(`[...document.querySelectorAll('#st-pick .hz')].map((b) => b.dataset.ch).join('')`);
  const pickCard = async () => (await kitCards()).at(-1);
  const waitState = async (test) => { for (let i = 0; i < 30; i++) { const c = await pickCard(); if (c && test(c.state ?? {})) return c; await sleep(200); } return pickCard(); };

  // ---- 一、发一句,照片板落下就自己打开 ----
  await type('我们看看课本这一页');
  ok('照片板落下就自己铺满打开(没点)', Boolean(await until(`document.querySelector('#stage').classList.contains('on') && document.querySelector('#stage').classList.contains('cv')`, 20000)));
  ok('画完了,能动手', Boolean(await ready()));
  ok('只开放「点字」:没有「给老师看」,工具列没有擦掉、转的钮', (await evaluate(`document.querySelector('#st-act').hidden`)) === true && (await tools()) === '', await tools());
  ok('田字格那一层还没出来', (await evaluate(`document.querySelector('#st-pick').hidden`)) === true);

  // ---- 二、字词的底一个一个出来 ----
  const n1 = await until(`document.querySelector('#st-frame')?.contentDocument?.querySelectorAll('.kt-word').length || 0`, 8000);
  ok('还在认:先出来三项', n1 === 3, String(n1));
  await shot('pick-1-running.png');
  ok('认完:八项都垫着底', Boolean(await until(`document.querySelector('#st-frame')?.contentDocument?.querySelectorAll('.kt-word').length === 8`, 10000)), String(await wordCount()));
  ok('课本要会写的五项深一点(写字三个、词语两个),识字的三个淡', (await evaluate(`document.querySelector('#st-frame').contentDocument.querySelectorAll('.kt-word.kt-key').length`)) === 5);
  // 垫的底套在字上:第 4 项是「变」,照片上那个字的位置(假课本页 800 × 1000,变在 (200, 400) 的基线上)
  const bian = await wordBox(3);
  const photoBox = await inStage(`(d) => d.querySelector('.kt-svg image')`);
  const expectX = photoBox.x - photoBox.w / 2 + (200 / 800) * photoBox.w, expectY = photoBox.y - photoBox.h / 2 + ((400 - 64 * 0.35) / 1000) * photoBox.h;
  ok('底套在照片上的那个字上(差不到半个字)', Math.abs(bian.x - expectX) < bian.w / 2 && Math.abs(bian.y - expectY) < bian.h / 2, JSON.stringify({ bian, expectX: Math.round(expectX), expectY: Math.round(expectY) }));
  await shot('pick-2-words.png');

  // ---- 三、点「变」 ----
  await tap(bian.x, bian.y);
  ok('点「变」:田字格浮出来,是这个字', Boolean(await until(`!document.querySelector('#st-pick').hidden`, 3000)) && (await picked()) === '变', await picked());
  ok('田字格在一笔一笔写(有正在写的那一层)', Boolean(await until(`Boolean(document.querySelector('#st-pick .hz .ink'))`, 4000)));
  ok('这一笔不留在板上', (await inkCount()) === 0, String(await inkCount()));
  let c = await waitState((s) => Array.isArray(s.picked) && s.picked.length === 1);
  ok('状态里记下点过「变」', JSON.stringify(c.state?.picked) === '["变"]', JSON.stringify(c.state));
  const pk = await center('#st-pick');
  const st = await center('#stage');
  ok('田字格在板的右上角(右手:工具在左),不挡照片中间', pk.x > st.x && pk.y < st.y, JSON.stringify({ pk, st }));
  await shot('pick-3-bian.png');

  // ---- 四、圈住「海洋」;点空白处 ----
  const hy = await wordBox(6);
  const rx = hy.w * 0.7, ry = hy.h * 0.9;
  await stroke(Array.from({ length: 25 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return [hy.x + Math.cos(a) * rx, hy.y + Math.sin(a) * ry]; }));
  ok('圈住「海洋」:田字格换成两个字', Boolean(await until(`[...document.querySelectorAll('#st-pick .hz')].length === 2`, 3000)) && (await picked()) === '海洋', await picked());
  c = await waitState((s) => Array.isArray(s.picked) && s.picked.length === 2);
  ok('状态里两项,照先后', JSON.stringify(c.state?.picked) === '["变","海洋"]', JSON.stringify(c.state));
  await shot('pick-4-haiyang.png');
  await tap(photoBox.x + photoBox.w * 0.4, photoBox.y + photoBox.h * 0.42);
  await sleep(300);
  ok('点空白处:田字格不变,板上不留笔画', (await picked()) === '海洋' && (await inkCount()) === 0);

  // ---- 五、正文里的字(没有底):照行框按字数等分 ----
  // 假课本页那一行「朗读课文,说说我是什么。」从 x = 120 起、字号 26、基线 800(照片 800 × 1000)
  const lineAt = (i) => ({ x: photoBox.x - photoBox.w / 2 + ((120 + 26 * (i + 0.5)) / 800) * photoBox.w, y: photoBox.y - photoBox.h / 2 + ((800 - 26 * 0.35) / 1000) * photoBox.h });
  const ke = lineAt(2);
  await tap(ke.x, ke.y);
  ok('点正文里的「课」(没有底):田字格换成它', Boolean(await until(`[...document.querySelectorAll('#st-pick .hz')].map((b) => b.dataset.ch).join('') === '课'`, 3000)), await picked());
  const comma = lineAt(4);
  await tap(comma.x, comma.y);
  await sleep(300);
  ok('点在逗号上:不弹别的,板上不留笔画', (await picked()) === '课' && (await inkCount()) === 0, await picked());
  c = await waitState((s) => Array.isArray(s.picked) && s.picked.length === 3);
  await shot('pick-5-line.png');

  // ---- 六、收起;给老师的那句 ----
  await press('#st-pick-x');
  ok('× 收起田字格', Boolean(await until(`document.querySelector('#st-pick').hidden`, 2000)));
  const k = kitOf(c.props.kit);
  const said = describeKit(k, kitParams(k, c.props.params), c.state ?? {}, kitOps(k, c.props.ops));
  ok('给老师的那句', said === '请他做的:点字;大概:点开看了笔顺:「变」「海洋」「课」', said);
  await tap(bian.x, bian.y);
  await until(`!document.querySelector('#st-pick').hidden`, 3000);
  await press('#st-x');
  ok('关掉舞台,田字格也跟着收', Boolean(await until(`!document.querySelector('#stage').classList.contains('on')`, 3000)) && (await evaluate(`document.querySelector('#st-pick').hidden`)) === true);
  await shot('pick-6-board.png');
} catch (err) {
  bad++;
  console.error('✗ 探针出错:', err instanceof Error ? err.stack : err);
} finally {
  console.log(`截图在 ${shots}`);
  ws.close();
  proc.kill();
  process.exitCode = bad ? 1 : 0;
}
