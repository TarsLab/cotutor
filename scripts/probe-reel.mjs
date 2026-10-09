#!/usr/bin/env node
/**
 * 看录像(《家长录像设计.md》,拍板 6:录像 = 孩子的屏幕 + 录像栏)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 起 cotutor mock,孩子端再发一条「继续」(话题里两轮)→ Chrome 开 /parent,点语文老师的话题 → 顶上「看录像」→
 * 上半是 iframe 里的孩子端(/reel,按 iPad 横屏开、等比缩)、下半是录像栏;孩子屏幕上是孩子端的样子(孩子的话当节头、输入条在、没有旁注);
 * 一开始孩子刚开口:话挂在板尾、占位卡、录像栏写「等老师」;播着往前走;拖到头两节都在;拖回开头又空了;
 * 关掉「跳过空白」变长;倍速;点进度条上的点跳过去;录像里的弹窗(注入一段实录);退出后原样重开这个话题。iPad 横屏与手机各截一张。
 *
 * 用法:node scripts/probe-reel.mjs [--out <截图目录>] [--keep](留下 mock)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const tmp = mkdtempSync(join(tmpdir(), 'cotutor-probe-reel-'));
const shots = outAt > 0 ? process.argv[outAt + 1] : join(tmp, 'shots');
mkdirSync(shots, { recursive: true });

const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '0'], { stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  // 孩子再说一句,话题里两轮
  await fetch(`${base}/api/kid/conversations/chinese-tutor/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '', action: 'continue' }) });
  for (let i = 0; i < 40; i++) { const d = await (await fetch(`${base}/api/kid/conversations/chinese-tutor/today`)).json(); if (!d.pending && d.messages.length >= 2) break; await sleep(250); }

  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, `${base}/parent`], { stdio: 'ignore' });
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

  // 弹窗那段要一段实录:mock 的录像是推算的,孩子屏幕(iframe)一起来就要 /reel,只能在每个文档最早处换掉 fetch;window.top.__patchStage 打开时才换
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.pathname === '/reel') { const f0 = window.fetch; window.fetch = async (url, init) => { const r = await f0(url, init); if (!window.top.__patchStage || !String(url).endsWith('/reel')) return r; const d = await r.json(); const R = d.reel; const tr = R.tracks[0]; const e = d.kid.find((m) => m.job === tr.job); const k = e.section.cards.findIndex((c) => c.kind === 'choice'); const X = tr.doneAt + 500; R.stages = [{ job: tr.job, card: k, from: X, to: X + 8000 }]; R.cards = [{ job: tr.job, card: k, at: X + 4000, state: { picked: [1] } }, { job: tr.job, card: k, at: X + 6000, state: { picked: [0] } }]; window.top.__X = X - R.startAt; return new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } }); }; }` });
  /** 在孩子的屏幕(iframe)里求值:表达式里的 document 是 iframe 的 */
  const kid = (expr) => evaluate(`(() => { const document = window.document.querySelector('#rl-frame').contentDocument; return (${expr}); })()`);

  await device(1180, 820, 1, false);
  await send('Page.navigate', { url: `${base}/parent` });
  await until(`document.querySelectorAll('.pt').length > 0`);
  await evaluate(`document.querySelector('.pt[data-tutor="chinese-tutor"] .tr').click()`);
  await until(`document.querySelectorAll('#board .sec').length >= 2`);
  await sleep(300);
  const before = await evaluate(`({ btn: !document.querySelector('#reel-btn').hidden, secs: document.querySelectorAll('#board .sec').length })`);
  ok('孩子的话题:顶上有「看录像」', before.btn && before.secs === 2, JSON.stringify(before));

  // ---- 进录像 ----
  await evaluate(`document.querySelector('#reel-btn').click()`);
  await until(`document.body.classList.contains('reel') && !document.querySelector('#reel').hidden`);
  await sleep(300);
  const s0 = await evaluate(`({ board: getComputedStyle(document.querySelector('#wrap')).display, screen: !document.querySelector('#rl-screen').hidden, src: document.querySelector('#rl-frame').getAttribute('src'), fw: document.querySelector('#rl-frame').style.width, scale: document.querySelector('#rl-frame').style.transform, max: Number(document.querySelector('#rl-seek').max), marks: [...document.querySelectorAll('#rl-marks i')].map((i) => i.className), cap: document.querySelector('#rl-cap').textContent, clock: document.querySelector('#rl-clock').textContent, tag: !document.querySelector('#rl-tag').hidden })`);
  ok('进录像:家长页的板书收起来,上半是孩子的屏幕(/reel,按 iPad 横屏 1180 宽开、缩小),下半录像栏;标「推算」', s0.board === 'none' && s0.screen && s0.src.startsWith('/reel?') && s0.fw === '1180px' && /scale\(0\.\d+\)/.test(s0.scale) && s0.tag && /^\d\d:\d\d:\d\d$/.test(s0.clock), JSON.stringify(s0));
  ok('进度条上的点:两次开口、停下等孩子', s0.marks.filter((c) => c === 'said').length === 2 && s0.marks.includes('ask') && s0.max > 0, JSON.stringify(s0.marks));
  const k0 = await kid(`({ rlk: document.body.classList.contains('rlk'), pill: !document.querySelector('#pill').hidden, bar: getComputedStyle(document.querySelector('#bar')).pointerEvents, secs: document.querySelectorAll('#board .sec').length, pend: document.querySelectorAll('#board > .sh.said.pend').length, wait: document.querySelectorAll('#board > .wait-card').length, notes: document.querySelectorAll('.notes').length, reelUi: !document.querySelector('#reel').hidden, mo: document.querySelector('#c-mo').hidden, back: document.querySelector('#back-today').hidden })`);
  ok('孩子的屏幕:孩子端的样子——输入条露着(点不动)、没有旁注、没有录像栏、没有「以前的」「回到今天」', k0.rlk && k0.pill && k0.bar === 'none' && k0.notes === 0 && !k0.reelUi && k0.mo && k0.back, JSON.stringify(k0));
  ok('一开始:孩子刚开口——话挂在板尾、占位卡在、板上没有节;录像栏写「等老师」', k0.secs === 0 && k0.pend === 1 && k0.wait === 1 && s0.cap.startsWith('⏳ 等老师'), JSON.stringify({ k0, cap: s0.cap }));
  await until(`(() => { const d = document.querySelector('#rl-frame').contentDocument; return d.querySelectorAll('#board .sec .c:not(.pend)').length > 0; })()`, 60);
  const s1 = await evaluate(`({ v: Number(document.querySelector('#rl-seek').value), cap: document.querySelector('#rl-cap').textContent })`);
  const k1 = await kid(`({ secs: document.querySelectorAll('#board .sec').length, head: (document.querySelector('#board .sec .sh.said .ka-t') || {}).textContent || '', pend: document.querySelectorAll('#board > .sh.said.pend').length, shown: document.querySelectorAll('#board .sec .c:not(.pend)').length, now: document.querySelectorAll('#board .c.now').length, sub: document.querySelector('#sub-text').textContent })`);
  ok('播着:进度往前走;第一节出来了,节头是孩子的话(挂在板尾的那句收了);念到的卡露出来亮着;字幕是讲稿', s1.v > 3500 && k1.secs === 1 && k1.head.length > 0 && k1.pend === 0 && k1.shown >= 1 && k1.now === 1 && k1.sub.length > 0 && s1.cap === '🔊 老师在念', JSON.stringify({ s1, k1 }));
  console.log('  ', await shot('reel-ipad.png'));

  // ---- 拖到头 / 拖回开头 ----
  const seek = (v) => evaluate(`(() => { const r = document.querySelector('#rl-seek'); r.value = String(${v}); r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
  await seek('Number(document.querySelector("#rl-seek").max)');
  await sleep(400);
  const s2 = await kid(`({ secs: document.querySelectorAll('#board .sec').length, pend: document.querySelectorAll('#board .sec .c.pend').length, notes: document.querySelectorAll('.notes').length })`);
  const p2 = await evaluate(`document.querySelector('#rl-play').getAttribute('aria-label')`);
  ok('拖到头:两节都在、卡都露着、没有旁注、停了(按钮回到「播放」)', s2.secs === 2 && s2.pend === 0 && s2.notes === 0 && p2 === '播放', JSON.stringify({ s2, p2 }));
  await seek(0);
  await sleep(300);
  const s3 = await kid(`({ secs: document.querySelectorAll('#board .sec').length, pend: document.querySelectorAll('#board > .sh.said.pend').length })`);
  ok('拖回开头:板上又空了,只有孩子刚说的那句', s3.secs === 0 && s3.pend === 1, JSON.stringify(s3));

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

  // ---- 手机:家长在手机上看 iPad 的录像,孩子的屏幕缩进上半;录像栏不撑出横向滚动 ----
  await device(390, 844, 2, true);
  await sleep(300);
  const narrow = await evaluate(`({ w: document.documentElement.scrollWidth, vw: innerWidth, row: document.querySelector('.rl-row').scrollWidth <= document.querySelector('.rl-row').clientWidth + 1, fr: document.querySelector('#rl-frame').getBoundingClientRect().width })`);
  ok('手机宽度:孩子的屏幕缩进去(不超宽)、录像栏不撑出横向滚动', narrow.w <= narrow.vw && narrow.row && narrow.fr <= narrow.vw, JSON.stringify(narrow));
  console.log('  ', await shot('reel-phone.png'));

  // ---- 录像里的弹窗(实录,§4.7):注入的实录——第一节念完 0.5 秒后打开选择题的弹窗,4 秒选 B、6 秒改 A、8 秒关上。关掉「跳过空白」按真实时间逐个时刻拖 ----
  await device(1180, 820, 1, false);
  await evaluate(`document.querySelector('#rl-x').click()`);
  await until(`!document.body.classList.contains('reel') && document.querySelectorAll('#board .sec').length === 2`);
  await evaluate(`window.__patchStage = true`);
  await evaluate(`document.querySelector('#reel-btn').click()`);
  await until(`document.body.classList.contains('reel') && window.__X !== undefined && !document.querySelector('#reel').hidden`);
  await evaluate(`document.querySelector('#rl-play').click()`);
  await evaluate(`document.querySelector('#rl-skip').click()`);
  const X = await evaluate(`window.__X`);
  const at = async (ms) => { await seek(X + ms); await sleep(350); const k = await kid(`({ on: document.querySelector('#stage').classList.contains('on'), picked: [...document.querySelectorAll('#st-body .so')].map((b) => b.classList.contains('on') ? 1 : 0).join(''), pe: getComputedStyle(document.querySelector('#st-body')).pointerEvents, board: [...document.querySelectorAll('#board .c-choice .ch-o')].map((o) => o.classList.contains('on') ? 1 : 0).join('') })`); return { ...k, cap: await evaluate(`document.querySelector('#rl-cap').textContent`) }; };
  const b0 = await at(-300);
  ok('弹窗打开之前:没开', !b0.on, JSON.stringify(b0));
  const b1 = await at(2000);
  ok('打开了、孩子还没动:弹窗是那张选择题、一项都没选、点不动;录像栏「⏱ 弹窗开着还没动 · 想了 2 秒」', b1.on && b1.picked === '000' && b1.pe === 'none' && b1.cap === '⏱ 弹窗开着还没动 · 想了 2 秒', JSON.stringify(b1));
  console.log('  ', await shot('reel-stage.png'));
  const b2 = await at(4500);
  ok('4 秒时选了 B:弹窗里 B 亮,板上那张卡也是', b2.on && b2.picked === '010' && b2.board === '010', JSON.stringify(b2));
  const b3 = await at(6500);
  ok('6 秒时改成 A', b3.on && b3.picked === '100', JSON.stringify(b3));
  const b4 = await at(8500);
  ok('8 秒关上了', !b4.on && b4.board === '100', JSON.stringify(b4));
  const back = await at(4500);
  ok('往回拖:弹窗重新开、回到选 B 的样子', back.on && back.picked === '010', JSON.stringify(back));

  // ---- 退出 ----
  await evaluate(`document.querySelector('#rl-x').click()`);
  await until(`!document.body.classList.contains('reel') && document.querySelectorAll('#board .sec').length === 2`);
  const s5 = await evaluate(`({ reel: document.body.classList.contains('reel'), screen: document.querySelector('#rl-screen').hidden, src: document.querySelector('#rl-frame').getAttribute('src'), secs: document.querySelectorAll('#board .sec').length, btn: !document.querySelector('#reel-btn').hidden, mo: document.querySelector('#c-mo').textContent })`);
  ok('退出:孩子的屏幕撤了,原样重开这个话题(两节、按钮回来、标签没有「录像」)', !s5.reel && s5.screen && s5.src === 'about:blank' && s5.secs === 2 && s5.btn && !s5.mo.includes('录像'), JSON.stringify(s5));
  ok('页面没抛异常', errors.length === 0, errors.join(' | '));
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  if (!keep) { mock.kill(); await sleep(300); try { rmSync(join(tmp, 'chrome'), { recursive: true, force: true }); } catch {} }
  else { mock.unref(); console.log(`mock 留着:${base}/parent`); }
  console.log(`截图在 ${shots}`);
}
process.exit(bad ? 1 : 0);
