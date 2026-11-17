#!/usr/bin/env node
/**
 * 看录像(录像 = 孩子的屏幕 + 录像栏)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 起 cotutor mock,孩子端再发一条「继续」(话题里两轮)→ Chrome 开 /parent,点语文老师的话题 → 顶上「看录像」→
 * 上半是 iframe 里的孩子端(/reel,按 iPad 横屏开、等比缩)、下半是录像栏;孩子屏幕上是孩子端的样子(板上只有实时一种画法:孩子的话在左栏、不当节头;输入条在、没有旁注);
 * 一开始孩子刚开口:实时老师页的样子(左栏 + 白板)、那句在左栏、头像在想(没有占位卡)、录像栏写「等老师」;播着往前走(写完整节铺上、不念);拖到头两节都在;拖回开头又空了;
 * 关掉「跳过空白」变长;倍速;点进度条上的点跳过去;退出后原样重开这个话题。iPad 横屏与手机各截一张。(录像里的弹窗 2026-11-17 跟着课里的卡删了)
 *
 * 用法:node scripts/probe-reel.mjs [--out <截图目录>] [--keep](留下 mock)
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS } from './_quiet.mjs';
import { liveSend } from './_live-send.mjs';

const keep = process.argv.includes('--keep');
const outAt = process.argv.indexOf('--out');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8795;
const cdp = 9337;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const tmp = probeDir('cotutor-probe-reel-');
const shots = outAt > 0 ? process.argv[outAt + 1] : join(tmp, 'shots');
mkdirSync(shots, { recursive: true });

const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '0'], { stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  // 孩子再说一句,话题里两轮
  await liveSend(base, 'chinese-tutor', { text: '继续' });
  for (let i = 0; i < 40; i++) { const d = await (await fetch(`${base}/api/kid/conversations/chinese-tutor/today`)).json(); if (!d.pending && d.messages.length >= 2) break; await sleep(250); }

  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, `${base}/parent`], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page' && t.url.startsWith('http'))?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
  const device = async (w, h, dsf, mobile) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile }); await sleep(400); };
  const until = async (expr, n = 40) => { for (let i = 0; i < n; i++) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
  await send('Runtime.enable');
  await send('Page.enable');
  const errors = [];
  send('Runtime.enable');
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });

  /** 在孩子的屏幕(iframe)里求值:表达式里的 document 是 iframe 的 */
  const kid = (expr) => evaluate(`(() => { const document = window.document.querySelector('#rl-frame').contentDocument; return (${expr}); })()`);

  await device(1180, 820, 1, false);
  await send('Page.navigate', { url: `${base}/parent` });
  // 清单是一天的时间线(最新的在上):语文老师最新那件的 .kid 开录像
  const ZH_EV = `[...document.querySelectorAll('.pev')].find((p) => (p.querySelector('.pv-who')?.textContent ?? '').includes('语文'))?.querySelector('.kid')`;
  await until(`Boolean(${ZH_EV})`);
  // ---- 记录里点话题:就是录像,停在最后一帧 ----
  await evaluate(`${ZH_EV}.click()`);
  await until(`!document.querySelector('#rl').hidden && !document.querySelector('#rl-screen').hidden`);
  await until(`Boolean(document.querySelector('#rl-frame').contentWindow.cotutorReel)`, 40);
  await until(`(() => { const d = document.querySelector('#rl-frame').contentDocument; return !!d && d.querySelectorAll('#board .sec').length === 2; })()`, 40);
  await sleep(400);
  const e0 = await evaluate(`({ src: document.querySelector('#rl-frame').getAttribute('src'), v: Number(document.querySelector('#rl-seek').value), max: Number(document.querySelector('#rl-seek').max), play: document.querySelector('#rl-play').getAttribute('aria-label'), log: document.querySelector('#rl-log').hidden, notes: document.querySelectorAll('.notes').length })`);
  const ek = await kid(`({ secs: document.querySelectorAll('#board .sec').length, pend: 0 })`);
  ok('点记录里的话题:直接是录像(src 带 end=1)、停在最后一帧不放(两节、卡都露着)、经过收着;没有板书页的旁注', e0.src.includes('end=1') && e0.v >= e0.max - 100 && e0.play === '播放' && e0.log && e0.notes === 0 && ek.secs === 2 && ek.pend === 0, JSON.stringify({ e0, ek }));
  // 停着能翻:滚轮在孩子的屏幕上翻板书;点卡没反应(开不了弹窗)
  const fr = await evaluate(`(() => { const r = document.querySelector('#rl-frame').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  // mock 的两节一屏放得下:板尾垫一块高的,让它有得翻(只为测滚轮进得去)
  await kid(`(() => { const b = document.querySelector('#board'); const x = document.createElement('div'); x.style.height = '1600px'; x.style.flex = 'none'; b.append(x); b.scrollTo({ top: b.scrollHeight, behavior: 'instant' }); })()`);
  await sleep(300);
  const top0 = await kid(`document.querySelector('#board').scrollTop`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: fr.x, y: fr.y, deltaX: 0, deltaY: -600 });
  await sleep(500);
  const top1 = await kid(`document.querySelector('#board').scrollTop`);
  ok('停着能翻:滚轮往上,孩子屏幕上的板书翻上去', top0 > 0 && top1 < top0, `${top0} → ${top1}`);
  await kid(`(() => { const b = document.querySelector('#board'); b.lastElementChild.remove(); })()`);
  await evaluate(`document.querySelector('#rl-more').click()`);
  await sleep(300);
  const lg = await evaluate(`document.querySelector('#rl-log').innerText`);
  ok('经过展得开:孩子开口那条在', lg.includes('孩子'), lg.slice(0, 300));
  await evaluate(`document.querySelector('#rl-more').click()`);
  // 回到开头,下面照旧从头放
  await evaluate(`(() => { const r = document.querySelector('#rl-seek'); r.value = '0'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); document.querySelector('#rl-play').click(); })()`);
  await sleep(300);
  const s0 = await evaluate(`({ board: document.querySelector('#board') ? 'shown' : 'none', screen: !document.querySelector('#rl-screen').hidden, src: document.querySelector('#rl-frame').getAttribute('src'), fw: document.querySelector('#rl-frame').style.width, scale: document.querySelector('#rl-frame').style.transform, max: Number(document.querySelector('#rl-seek').max), marks: [...document.querySelectorAll('#rl-marks i')].map((i) => i.className), cap: document.querySelector('#rl-cap').textContent, clock: document.querySelector('#rl-clock').textContent, sub: document.querySelector('#rl-sub').textContent, fill: (() => { const a = document.querySelector('#rl-screen').getBoundingClientRect(), b = document.querySelector('#rl-frame').getBoundingClientRect(); return Math.abs(a.width - b.width) < 2 || Math.abs(a.height - b.height) < 2; })() })`);
  ok('进录像:整页盖一层(家长页上没有板书),上半是孩子的屏幕(/reel,按 iPad 横屏 1180 宽开、等比缩到铺满),下半录像栏;时间是「放到哪 / 一共多久」、下面小字当时几点', s0.board === 'none' && s0.screen && s0.src.startsWith('/reel?') && s0.fw === '1180px' && /scale\(0\.\d+\)/.test(s0.scale) && /^\d+:\d\d \/ \d+:\d\d$/.test(s0.clock) && /^当时 \d\d:\d\d:\d\d$/.test(s0.sub) && s0.fill, JSON.stringify(s0));
  ok('进度条上的点:两次开口、停下等孩子', s0.marks.filter((c) => c === 'said').length === 2 && s0.marks.includes('ask') && s0.max > 0, JSON.stringify(s0.marks));
  const k0 = await kid(`({ rlk: document.body.classList.contains('rlk'), pill: !document.querySelector('#pill').hidden, bar: getComputedStyle(document.querySelector('#bar')).pointerEvents, secs: document.querySelectorAll('#board .sec').length, kidCol: document.querySelector('#lv-kid').textContent, saidHeads: document.querySelectorAll('#board .sh.said').length, wait: document.querySelectorAll('#board > .wait-card').length, live: document.body.classList.contains('live'), think: document.body.classList.contains('pending'), notes: document.querySelectorAll('.notes').length, reelUi: !document.querySelector('#reel').hidden, mo: !document.querySelector('#c-mo') || document.querySelector('#c-mo').hidden, back: !document.querySelector('#back-today') || document.querySelector('#back-today').hidden })`);
  ok('孩子的屏幕:孩子端的样子——输入条露着(点不动)、没有旁注、没有录像栏、没有「以前的」「回到今天」', k0.rlk && k0.pill && k0.bar === 'none' && k0.notes === 0 && !k0.reelUi && k0.mo && k0.back, JSON.stringify(k0));
  ok('一开始:孩子刚开口——实时老师页的样子、那句在左栏(板上不挂)、头像在想(没有占位卡)、板上没有节;录像栏写「等老师」', k0.live && k0.secs === 0 && k0.kidCol.length > 0 && k0.saidHeads === 0 && k0.wait === 0 && k0.think && s0.cap.startsWith('⏳ 等老师'), JSON.stringify({ k0, cap: s0.cap }));
  await until(`(() => { const d = document.querySelector('#rl-frame').contentDocument; return d.querySelectorAll('#board .sec').length > 0; })()`, 60);
  const s1 = await evaluate(`({ v: Number(document.querySelector('#rl-seek').value), cap: document.querySelector('#rl-cap').textContent })`);
  const k1 = await kid(`({ secs: document.querySelectorAll('#board .sec').length, saidHeads: document.querySelectorAll('#board .sh.said').length, kidCol: document.querySelector('#lv-kid').textContent })`);
  // 不是实时的轮(mock 从接口发的):写完那一刻整节铺上、不念
  ok('播着:进度往前走;第一节写完整节出来,孩子的话还在左栏、不当节头;不念', s1.v > 0 && k1.secs === 1 && k1.saidHeads === 0 && k1.kidCol.length > 0 && s1.cap !== '🔊 老师在念', JSON.stringify({ s1, k1 }));
  console.log('  ', await shot('reel-ipad.png'));

  // ---- 拖到头 / 拖回开头 ----
  const seek = (v) => evaluate(`(() => { const r = document.querySelector('#rl-seek'); r.value = String(${v}); r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
  await seek('Number(document.querySelector("#rl-seek").max)');
  await sleep(400);
  const s2 = await kid(`({ secs: document.querySelectorAll('#board .sec').length, pend: 0, notes: document.querySelectorAll('.notes').length })`);
  const p2 = await evaluate(`document.querySelector('#rl-play').getAttribute('aria-label')`);
  ok('拖到头:两节都在、卡都露着、没有旁注、停了(按钮回到「播放」)', s2.secs === 2 && s2.pend === 0 && s2.notes === 0 && p2 === '播放', JSON.stringify({ s2, p2 }));
  // 不是实时的轮整节铺上:讲稿里的标注每节都画上(同孩子端);停着时板不再整块重画
  await kid(`(() => { window.__rebuilt = 0; new MutationObserver(() => { window.__rebuilt++; }).observe(document.querySelector('#board'), { childList: true }); })()`);
  await sleep(1000);
  const mk = await kid(`({ secs: document.querySelectorAll('#board > .sec').length, rebuilt: window.__rebuilt })`);
  ok('拖到头:停着一秒板没重画', mk.secs === 2 && mk.rebuilt === 0, JSON.stringify(mk));
  await seek(0);
  await sleep(300);
  const s3 = await kid(`({ secs: document.querySelectorAll('#board .sec').length, kidCol: document.querySelector('#lv-kid').textContent })`);
  ok('拖回开头:板上又空了,左栏只有孩子刚说的那句', s3.secs === 0 && s3.kidCol.length > 0, JSON.stringify(s3));

  // ---- 跳过空白、倍速、点标记 ----
  const m0 = await evaluate(`({ max: Number(document.querySelector('#rl-seek').max), on: document.querySelector('#rl-skip').checked, label: document.querySelector('#rl-skip').closest('label').textContent, sw: document.querySelector('#rl-skip').getAttribute('role') })`);
  await evaluate(`document.querySelector('#rl-skip').click()`);
  await sleep(200);
  const m1 = await evaluate(`({ max: Number(document.querySelector('#rl-seek').max), on: document.querySelector('#rl-skip').checked })`);
  ok('「跳过空白」是个开关(role=switch),缺省开着;关掉变长(按真实时间放)', m0.on && m0.label === '跳过空白' && m0.sw === 'switch' && !m1.on && m1.max > m0.max + 10000, `${JSON.stringify(m0)} → ${JSON.stringify(m1)}`);
  await evaluate(`document.querySelector('#rl-skip').click()`);
  await sleep(200);
  await evaluate(`document.querySelector('#rl-speed').click()`);
  ok('倍速 1× → 1.5×', (await evaluate(`document.querySelector('#rl-speed').textContent`)) === '1.5×');
  await evaluate(`[...document.querySelectorAll('#rl-marks i.said')][1].click()`);
  await sleep(300);
  const s4 = await kid(`({ secs: document.querySelectorAll('#board .sec').length })`);
  ok('点第二次开口的点:跳到那儿,第一节在', s4.secs === 1, JSON.stringify(s4));
  const c4 = await evaluate(`({ seps: document.querySelectorAll('#rl-chaps i').length, chap: document.querySelector('#rl-chap').textContent, hidden: document.querySelector('#rl-chap').hidden })`);
  ok('章:孩子每开口一次一轮,进度条上断开一处;跳到第二次开口时说明那行左边写「第 2 轮」', c4.seps === 1 && !c4.hidden && c4.chap === '第 2 轮', JSON.stringify(c4));

  // ---- 录像栏收起 / 展开 ----
  const tall = await evaluate(`document.querySelector('#rl-screen').getBoundingClientRect().height`);
  await evaluate(`document.querySelector('#rl-fold').click()`);
  await sleep(300);
  const f0 = await evaluate(`({ min: document.querySelector('#reel').classList.contains('min'), row: getComputedStyle(document.querySelector('.rl-row')).display, cap: getComputedStyle(document.querySelector('.rl-caprow')).display, mplay: getComputedStyle(document.querySelector('#rl-mplay')).display, mclock: document.querySelector('#rl-mclock').textContent, h: document.querySelector('#reel').offsetHeight, sc: document.querySelector('#rl-screen').getBoundingClientRect().height, kept: localStorage.getItem('parent-reel-min') })`);
  ok('收起:只剩一行(播放、细进度条、时间),上半跟着变高;这台设备记住', f0.min && f0.row === 'none' && f0.cap === 'none' && f0.mplay === 'grid' && /^\d+:\d\d \/ \d+:\d\d$/.test(f0.mclock) && f0.h < 80 && f0.sc > tall + 30 && f0.kept === '1', JSON.stringify({ f0, tall }));
  await evaluate(`document.querySelector('#rl-unfold').click()`);
  await sleep(300);
  const f1 = await evaluate(`({ min: document.querySelector('#reel').classList.contains('min'), row: getComputedStyle(document.querySelector('.rl-row')).display, mplay: getComputedStyle(document.querySelector('#rl-mplay')).display })`);
  ok('展开:控制行回来', !f1.min && f1.row === 'flex' && f1.mplay === 'none', JSON.stringify(f1));

  // ---- 手机:家长在手机上看 iPad 的录像,孩子的屏幕缩进上半;录像栏不撑出横向滚动 ----
  await device(390, 844, 2, true);
  await sleep(300);
  const narrow = await evaluate(`({ w: document.documentElement.scrollWidth, vw: innerWidth, row: document.querySelector('.rl-row').scrollWidth <= document.querySelector('.rl-row').clientWidth + 1, fr: document.querySelector('#rl-frame').getBoundingClientRect().width })`);
  ok('手机宽度:孩子的屏幕缩进去(不超宽)、录像栏不撑出横向滚动', narrow.w <= narrow.vw && narrow.row && narrow.fr <= narrow.vw, JSON.stringify(narrow));
  console.log('  ', await shot('reel-phone.png'));

  // ---- 回到 iPad 横屏再退出 ----
  await device(1180, 820, 1, false);
  // ---- 退出 ----
  await evaluate(`document.querySelector('#rl-x').click()`);
  await until(`document.querySelector('#rl').hidden`);
  const s5 = await evaluate(`({ reel: !document.querySelector('#rl').hidden, screen: document.querySelector('#rl-screen').hidden, src: document.querySelector('#rl-frame').getAttribute('src'), rows: document.querySelectorAll('.pev').length })`);
  ok('退出:孩子的屏幕撤了,回到记录清单', !s5.reel && s5.screen && s5.src === 'about:blank' && s5.rows > 0, JSON.stringify(s5));
  ok('页面没抛异常', errors.length === 0, errors.join(' | '));
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  if (!keep) { mock.kill(); await sleep(300); try { rmSync(join(tmp, 'chrome'), { recursive: true, force: true }); } catch {} }
  else { mock.unref(); console.log(`mock 留着:${base}/parent`); }
  console.log(`截图在 ${shots}`);
}
process.exit(bad ? 1 : 0);
