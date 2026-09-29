#!/usr/bin/env node
/**
 * 看录像(《家长录像设计.md》)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 起 cotutor mock,孩子端再发一条「继续」(话题里两轮)→ Chrome 开 /parent,点语文老师的话题 → 顶上「看录像」→
 * 控制条在、输入条不在;一开始是「等老师」、板上空的;播着进度往前走;拖到头两节都在、节尾旁注出来;拖回开头板上又空了;
 * 关掉「跳过空白」变长;倍速;点进度条上的点跳过去;退出后原样重开这个话题。iPad 横屏与手机各截一张。
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
  await until(`document.body.classList.contains('reel')`);
  await sleep(250);
  const s0 = await evaluate(`({ bar: getComputedStyle(document.querySelector('#bar')).display, reel: !document.querySelector('#reel').hidden, btn: document.querySelector('#reel-btn').hidden, max: Number(document.querySelector('#rl-seek').max), marks: [...document.querySelectorAll('#rl-marks i')].map((i) => i.className), sub: document.querySelector('#sub-text').textContent, secs: document.querySelectorAll('#board .sec').length, mo: document.querySelector('#c-mo').textContent, clock: document.querySelector('#rl-clock').textContent, tag: !document.querySelector('#rl-tag').hidden })`);
  ok('进录像:控制条在、输入条不在、按钮藏起来;标签「录像 · 今天 · 时间」;标「推算」', s0.bar === 'none' && s0.reel && s0.btn && s0.mo.startsWith('录像 · 今天') && s0.tag && /^\d\d:\d\d:\d\d$/.test(s0.clock), JSON.stringify(s0));
  ok('进度条上的点:两次开口、停下等孩子', s0.marks.filter((c) => c === 'said').length === 2 && s0.marks.includes('ask') && s0.max > 0, JSON.stringify(s0.marks));
  ok('一开始:孩子刚开口,板上空的,字幕「等老师」', s0.secs === 0 && s0.sub.startsWith('⏳ 等老师'), JSON.stringify(s0));
  await until(`document.querySelectorAll('#board .sec .c:not(.pend)').length > 0`, 60);
  const s1 = await evaluate(`({ v: Number(document.querySelector('#rl-seek').value), secs: document.querySelectorAll('#board .sec').length, shown: document.querySelectorAll('#board .sec .c:not(.pend)').length, now: document.querySelectorAll('#board .c.now').length, sub: document.querySelector('#sub-text').textContent })`);
  ok('播着:进度往前走、第一节出来了、念到的卡露出来亮着、字幕是讲稿', s1.v > 3500 && s1.secs === 1 && s1.shown >= 1 && s1.now === 1 && !s1.sub.startsWith('⏳'), JSON.stringify(s1));
  console.log('  ', await shot('reel-ipad.png'));

  // ---- 拖到头 / 拖回开头 ----
  const seek = (v) => evaluate(`(() => { const r = document.querySelector('#rl-seek'); r.value = String(${v}); r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
  await seek('Number(document.querySelector("#rl-seek").max)');
  await sleep(400);
  const s2 = await evaluate(`({ secs: document.querySelectorAll('#board .sec').length, pend: document.querySelectorAll('#board .sec .c.pend').length, post: [...document.querySelectorAll('#board .notes.post .note .tg')].map((n) => n.textContent), pre: document.querySelectorAll('#board .notes.pre .note').length, playing: document.querySelector('#rl-play').getAttribute('aria-label'), sub: document.querySelector('#sub-text').textContent })`);
  ok('拖到头:两节都在、卡都露着、节尾旁注出来了、停了(按钮回到「播放」)', s2.secs === 2 && s2.pend === 0 && s2.post.includes('给家长') && s2.pre >= 2 && s2.playing === '播放', JSON.stringify(s2));
  await seek(0);
  await sleep(300);
  const s3 = await evaluate(`({ secs: document.querySelectorAll('#board .sec').length, notes: document.querySelectorAll('#board .notes .note').length })`);
  ok('拖回开头:板上又空了,只剩第一句的旁注', s3.secs === 0 && s3.notes === 1, JSON.stringify(s3));

  // ---- 跳过空白、倍速、点标记 ----
  const m0 = await evaluate(`({ max: Number(document.querySelector('#rl-seek').max), on: document.querySelector('#rl-skip').checked, label: document.querySelector('#rl-skip').closest('label').textContent, sw: document.querySelector('#rl-skip').getAttribute('role') })`);
  await evaluate(`document.querySelector('#rl-skip').click()`);
  const m1 = await evaluate(`({ max: Number(document.querySelector('#rl-seek').max), on: document.querySelector('#rl-skip').checked })`);
  ok('「跳过空白」是个开关(role=switch),缺省开着;关掉变长(按真实时间放)', m0.on && m0.label === '跳过空白' && m0.sw === 'switch' && !m1.on && m1.max > m0.max + 10000, `${JSON.stringify(m0)} → ${JSON.stringify(m1)}`);
  await evaluate(`document.querySelector('#rl-skip').click()`);
  await evaluate(`document.querySelector('#rl-speed').click()`);
  ok('倍速 1× → 1.5×', (await evaluate(`document.querySelector('#rl-speed').textContent`)) === '1.5×');
  await evaluate(`[...document.querySelectorAll('#rl-marks i.said')][1].click()`);
  await sleep(300);
  const s4 = await evaluate(`({ secs: document.querySelectorAll('#board .sec').length, notes: document.querySelectorAll('#board .notes.pre .note').length })`);
  ok('点第二次开口的点:跳到那儿,第一节在、第二句旁注出来了', s4.secs === 1 && s4.notes === 2, JSON.stringify(s4));

  await device(390, 844, 2, true);
  // 跟着最新的走:新冒出来的是旁注(不是卡)也要滚到——停在第二次开口前 1 秒,滚回顶上,放 2.5 秒,第二次开口的旁注应该在屏幕里
  const inView = `(() => { const b = document.querySelector('#board').getBoundingClientRect(); const ns = [...document.querySelectorAll('#board > .notes > .note')]; const n = ns[ns.length - 1]; if (!n) return null; const r = n.getBoundingClientRect(); return { notes: ns.length, top: Math.round(r.top), bottom: Math.round(r.bottom), bTop: Math.round(b.top), bBottom: Math.round(b.bottom), ok: r.top >= b.top - 1 && r.bottom <= b.bottom + 1 }; })()`;
  const said2 = await evaluate(`(() => { const i = [...document.querySelectorAll('#rl-marks i.said')][1]; return parseFloat(i.style.left) / 100 * Number(document.querySelector('#rl-seek').max); })()`);
  if (await evaluate(`document.querySelector('#rl-play').getAttribute('aria-label') === '暂停'`)) await evaluate(`document.querySelector('#rl-play').click()`);
  await seek(Math.round(said2 - 1000));
  await sleep(300);
  await evaluate(`document.querySelector('#board').scrollTop = 0`);
  await sleep(300);
  const n0 = await evaluate(`document.querySelectorAll('#board > .notes > .note').length`);
  await evaluate(`document.querySelector('#rl-play').click()`);
  await sleep(2500);
  const grew = await evaluate(inView);
  ok('放着放着冒出旁注(孩子第二次开口):滚到它', grew && grew.notes > n0 && grew.ok, JSON.stringify({ n0, grew }));
  await evaluate(`document.querySelector('#rl-play').click()`);
  await evaluate(`document.querySelector('#board').scrollTop = 0`);
  await seek('Number(document.querySelector("#rl-seek").max)');
  await sleep(500);
  const jumped = await evaluate(inView);
  ok('拖到头:滚到最底下那条旁注', jumped && jumped.ok, JSON.stringify(jumped));
  await seek(Math.round(said2 - 1000));
  await evaluate(`document.querySelector('#rl-play').click()`);
  await sleep(2500);
  console.log('  ', await shot('reel-phone.png'));
  const narrow = await evaluate(`({ w: document.documentElement.scrollWidth, vw: innerWidth, row: document.querySelector('.rl-row').scrollWidth <= document.querySelector('.rl-row').clientWidth + 1 })`);
  ok('手机宽度:控制条不撑出横向滚动', narrow.w <= narrow.vw && narrow.row, JSON.stringify(narrow));

  // ---- 录像里的弹窗(实录,《家长录像设计.md》§4.7):mock 的录像是推算的,这里在页面上把 /reel 的回包加一段实录——
  //      第一节念完 0.5 秒后孩子打开选择题的弹窗,4 秒时选 B、6 秒时改成 A、8 秒关上。关掉「跳过空白」按真实时间逐个时刻拖过去看 ----
  await device(1180, 820, 1, false);
  await evaluate(`document.querySelector('#rl-x').click()`);
  await until(`!document.body.classList.contains('reel') && document.querySelectorAll('#board .sec').length === 2`);
  await evaluate(`(() => { const f0 = window.fetch; window.fetch = async (url, init) => { const r = await f0(url, init); if (!String(url).endsWith('/reel')) return r; const d = await r.json(); const R = d.reel; const tr = R.tracks[0]; const e = d.messages.find((m) => m.job === tr.job); const k = e.section.cards.findIndex((c) => c.kind === 'choice'); const X = tr.doneAt + 500; R.stages = [{ job: tr.job, card: k, from: X, to: X + 8000 }]; R.cards = [{ job: tr.job, card: k, at: X + 4000, state: { picked: [1] } }, { job: tr.job, card: k, at: X + 6000, state: { picked: [0] } }]; window.__X = X - R.startAt; return new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } }); }; })()`);
  await evaluate(`document.querySelector('#reel-btn').click()`);
  await until(`document.body.classList.contains('reel') && window.__X !== undefined`);
  await evaluate(`document.querySelector('#rl-play').click()`);
  await evaluate(`document.querySelector('#rl-skip').click()`);
  const X = await evaluate(`window.__X`);
  const at = async (ms) => { await seek(X + ms); await sleep(350); return evaluate(`({ on: document.querySelector('#stage').classList.contains('on'), picked: [...document.querySelectorAll('#st-body .so')].map((b) => b.classList.contains('on') ? 1 : 0).join(''), sub: document.querySelector('#sub-text').textContent, x: getComputedStyle(document.querySelector('#st-x')).display, pe: getComputedStyle(document.querySelector('#st-body')).pointerEvents, board: [...document.querySelectorAll('#board .c-choice .ch-o')].map((o) => o.classList.contains('on') ? 1 : 0).join('') })`); };
  const b0 = await at(-300);
  ok('弹窗打开之前:没开', !b0.on, JSON.stringify(b0));
  const b1 = await at(2000);
  ok('打开了、孩子还没动:弹窗是那张选择题、一项都没选、字幕「⏱ 想了 2 秒」;没有关闭钮、点不动', b1.on && b1.picked === '000' && b1.sub === '⏱ 想了 2 秒' && b1.x === 'none' && b1.pe === 'none', JSON.stringify(b1));
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
  const s5 = await evaluate(`({ reel: document.body.classList.contains('reel'), bar: getComputedStyle(document.querySelector('#bar')).display, secs: document.querySelectorAll('#board .sec').length, btn: !document.querySelector('#reel-btn').hidden, mo: document.querySelector('#c-mo').textContent })`);
  ok('退出:原样重开这个话题(两节、按钮回来、标签没有「录像」)', !s5.reel && s5.bar !== 'none' && s5.secs === 2 && s5.btn && !s5.mo.includes('录像'), JSON.stringify(s5));
  ok('页面没抛异常', errors.length === 0, errors.join(' | '));
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  if (!keep) { mock.kill(); await sleep(300); try { rmSync(join(tmp, 'chrome'), { recursive: true, force: true }); } catch {} }
  else { mock.unref(); console.log(`mock 留着:${base}/parent`); }
  console.log(`截图在 ${shots}`);
}
process.exit(bad ? 1 : 0);
