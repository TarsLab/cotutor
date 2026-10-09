#!/usr/bin/env node
/**
 * 录像里的输入条(《家长录像设计.md》拍板 6、7、10)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 孩子端(假麦克风 + 注入的假识别器):按住三次都没认出字(没听清)、一次上滑取消、点输入框打「他们在看大象」删两个字改成「大熊猫」发出去、
 * 再按住一次认出「Apple苹」发出去 → 拦下发出去的实录(view / hold / type)看形状;mock 把实录攒在内存里给录像用。
 * 再补一条键盘弹起来的 view(无头 Chrome 没有软键盘)→ 家长端看录像:进度条上四个淡点 + 一串;跳到第一次按住:孩子的屏幕上蓝色浮层「等一下…」、
 * 录像栏「⚠ 按住说话连着 4 次没发出去 · 第 1 次」;收尾后输入条「没听清,再按住说一次」;上滑那会儿「松手取消」;打字那段输入框里的字一步步变、
 * 键盘垫在底下;认出字那次浮层上是字、波形照记下的音量;版本对不上标「画法已更新」。iPad 横屏截两张。
 *
 * 用法:node scripts/probe-reel-input.mjs [--out <截图目录>] [--keep](留下 mock)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS, quiet } from './_quiet.mjs';

const keep = process.argv.includes('--keep');
const outAt = process.argv.indexOf('--out');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8798;
const cdp = 9339;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

// 假识别器:window.__srText 为空就什么都认不出(没听清);stop 了才 end(同 Safari)。拦下孩子端发出去的实录
const FAKE = `(() => {
  window.__srText = '';
  class FakeSR {
    constructor() { this.ls = {}; }
    addEventListener(k, f) { (this.ls[k] ||= []).push(f); }
    fire(k) { for (const f of this.ls[k] || []) f({}); }
    start() { setTimeout(() => { this.fire('start'); this.fire('audiostart'); const t = window.__srText; if (t && this.onresult) { this.onresult({ results: [[{ transcript: t.slice(0, 3) }]] }); setTimeout(() => this.onresult && this.onresult({ results: [[{ transcript: t }]] }), 500); } }, 300); }
    stop() { setTimeout(() => { if (this.onend) this.onend(); }, 50); }
    abort() { setTimeout(() => { if (this.onend) this.onend(); }, 10); }
  }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  window.__play = [];
  const f = window.fetch;
  window.fetch = (url, init) => { if (String(url).endsWith('/play') && init && init.body) { try { window.__play.push(...JSON.parse(init.body).records); } catch {} } return f(url, init); };
})();`;

const tmp = mkdtempSync(join(tmpdir(), 'cotutor-probe-reel-input-'));
const shots = outAt > 0 ? process.argv[outAt + 1] : join(tmp, 'shots');
mkdirSync(shots, { recursive: true });
const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '0'], { stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const until = async (expr, n = 40) => { for (let i = 0; i < n; i++) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor` });
  await until(`document.querySelector('#tutor')?.classList.contains('on') && document.querySelectorAll('#board .sec').length > 0`);
  await sleep(800);
  const where = await evaluate(`(() => { const r = document.querySelector('#mid').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const mouse = (type, y = where.y) => send('Input.dispatchMouseEvent', { type, x: where.x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const holdFor = async (ms, slide = false) => { await mouse('mousePressed'); await sleep(ms); if (slide) { await mouse('mouseMoved', where.y - 120); await sleep(300); } await mouse('mouseReleased', slide ? where.y - 120 : where.y); };

  // ---- 孩子端:三次没听清、一次上滑取消、打字改了一回发出去、一次认出字发出去 ----
  for (let i = 0; i < 3; i++) { await holdFor(1500); await sleep(3200); }
  await holdFor(1200, true);
  await sleep(1500);
  await mouse('mousePressed'); await sleep(60); await mouse('mouseReleased');
  await until(`!document.querySelector('#typed').hidden`, 20);
  for (const piece of ['他们', '在看', '大象']) { await send('Input.insertText', { text: piece }); await sleep(700); }
  for (let i = 0; i < 2; i++) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await sleep(200); }
  await sleep(600);
  await send('Input.insertText', { text: '大熊猫' });
  await sleep(700);
  await evaluate(`document.querySelector('#go').click()`);
  await until(`!document.body.classList.contains('pending')`, 60);
  await sleep(1500);
  await evaluate(`window.__srText = 'Apple苹'`);
  await holdFor(2000);
  await until(`window.__play.some((r) => r.k === 'hold' && r.e === 'end' && r.r === 'sent')`, 60);

  const recs = await evaluate(`window.__play`);
  const holds = recs.filter((r) => r.k === 'hold');
  const ends = holds.filter((r) => r.e === 'end').map((r) => r.r);
  ok('孩子端记了屏幕尺寸与页面版本', recs.some((r) => r.k === 'view' && r.w === 1180 && r.h === 820 && /^[0-9a-f]{8}$/.test(r.v)), JSON.stringify(recs.filter((r) => r.k === 'view')));
  ok('按住:每次按下 / 话筒开 / 收尾;结果依次是没听清 ×3、取消、发了', ends.join() === 'unclear,unclear,unclear,cancel,sent' && holds.filter((r) => r.e === 'down').length === 5 && holds.filter((r) => r.e === 'audio').length >= 4, JSON.stringify(ends));
  ok('上滑那次记了进取消区;发了那次记了认出的字、松手、音量', holds.some((r) => r.e === 'slide' && r.on) && holds.some((r) => r.e === 'text' && r.text === 'Apple苹') && holds.some((r) => r.e === 'up') && holds.some((r) => r.e === 'end' && r.r === 'sent' && /^[0-9]{10,}$/.test(r.lv || '')), JSON.stringify(holds.filter((r) => r.e === 'end').map((r) => [r.r, (r.lv || '').length])));
  const types = recs.filter((r) => r.k === 'type');
  ok('打字:点进输入框、值一步步(大象删掉也在)、发了', types[0]?.e === 'focus' && types.some((r) => r.e === 'v' && r.v === '他们在看大象') && types.some((r) => r.e === 'v' && r.v === '他们在看') && types.some((r) => r.e === 'v' && r.v === '他们在看大熊猫') && types.some((r) => r.e === 'send'), JSON.stringify(types.map((r) => r.e + ':' + (r.v ?? ''))));

  // 无头 Chrome 没有软键盘:打字那段补一条键盘弹起来的 view(页面版本故意不同 → 录像标「画法已更新」)
  const thread = await evaluate(`(async () => (await (await fetch('/api/kid/conversations/chinese-tutor/today')).json()).thread)()`);
  const focusAt = types[0].at, sendAt = types.find((r) => r.e === 'send').at;
  await fetch(`${base}/api/kid/conversations/chinese-tutor/play`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ thread, sentAt: Date.now(), records: [{ at: focusAt + 50, k: 'view', w: 1180, h: 820, kb: 330, v: 'old00000' }, { at: sendAt + 50, k: 'view', w: 1180, h: 820, kb: 0, v: 'old00000' }] }) });

  // ---- 家长端清单:这个话题上露「连着没发出去」 ----
  await send('Page.navigate', { url: `${base}/parent` });
  await until(`document.querySelectorAll('.pt').length > 0`);
  const flag = await evaluate(`(document.querySelector('.pt[data-tutor="chinese-tutor"] .tr small .miss') || {}).textContent || ''`);
  ok('家长端清单:这个话题上写「⚠ 按住说话连着 4 次没发出去」', flag.includes('⚠ 按住说话连着 4 次没发出去'), JSON.stringify(flag));

  // ---- 家长端看录像 ----
  await send('Page.navigate', { url: `${base}/parent?tutor=chinese-tutor` });
  await until(`document.querySelector('#tutor')?.classList.contains('on') && !document.querySelector('#reel-btn').hidden`, 40);
  await evaluate(`document.querySelector('#reel-btn').click()`);
  await until(`document.body.classList.contains('reel') && !document.querySelector('#reel').hidden`, 40);
  await evaluate(`document.querySelector('#rl-play').click()`);
  await sleep(300);
  const kid = (expr) => evaluate(`(() => { const document = window.document.querySelector('#rl-frame').contentDocument; return (${expr}); })()`);
  const seekAt = async (w) => { await evaluate(`document.querySelector('#rl-frame').contentWindow.cotutorReel.seekAt(${w})`); await sleep(350); };
  const look = () => kid(`({ hold: document.querySelector('#hold').classList.contains('on'), ht: document.querySelector('#hold .t').textContent, hint: document.querySelector('#hold span').textContent, real: document.querySelector('#hold').classList.contains('real'), bars: [...document.querySelectorAll('#hold .w i')].map((i) => parseInt(i.style.height)).join(','), ph: document.querySelector('#ph').hidden ? null : document.querySelector('#ph').textContent, typed: document.querySelector('#typed').hidden ? null : document.querySelector('#typed').value, kbd: document.body.classList.contains('kbd'), kbh: getComputedStyle(document.querySelector('#rl-kbd')).height })`).then(async (k) => ({ ...k, cap: await evaluate(`document.querySelector('#rl-cap').textContent`) }));

  const m = await evaluate(`({ miss: document.querySelectorAll('#rl-marks i.miss').length, band: document.querySelectorAll('#rl-marks i.misses').length, w: (document.querySelector('#rl-marks i.misses') || { style: {} }).style.width || '', ver: !document.querySelector('#rl-ver').hidden })`);
  ok('录像栏:四个淡点(没发出去的每一次)+ 一串(连着 4 次);版本对不上标「画法已更新」', m.miss === 4 && m.band === 1 && /calc/.test(m.w) && m.ver, JSON.stringify(m));
  const downs = holds.filter((r) => r.e === 'down').map((r) => r.at);
  const endsAt = holds.filter((r) => r.e === 'end').map((r) => r.at);
  await seekAt(downs[0] + 100);
  const h0 = await look();
  ok('第一次按下、话筒还没开:蓝色浮层「等一下…」;录像栏「⚠ 按住说话连着 4 次没发出去 · 第 1 次」', h0.hold && h0.hint === '等一下…' && h0.cap.startsWith('⚠ 按住说话连着 4 次没发出去 · 第 1 次'), JSON.stringify(h0));
  const audio0 = holds.find((r) => r.e === 'audio' && r.at > downs[0]).at;
  await seekAt(audio0 + 300);
  const h1 = await look();
  ok('话筒开了:「松手发送,上移取消」,波形照记下的音量画(假麦克风有声)', h1.hold && h1.hint === '松手发送,上移取消' && h1.real, JSON.stringify(h1));
  console.log('  ', await shot('reel-hold-miss.png'));
  await seekAt(endsAt[0] + 500);
  const h2 = await look();
  ok('收尾了没认出字:浮层收了,输入条「没听清,再按住说一次」;还在那一串里', !h2.hold && h2.ph === '没听清,再按住说一次' && h2.cap.startsWith('⚠ 按住说话连着 4 次'), JSON.stringify(h2));
  const slideAt = holds.find((r) => r.e === 'slide' && r.on).at;
  await seekAt(slideAt + 100);
  const h3 = await look();
  ok('上滑进了取消区:「松手取消」', h3.hold && h3.hint === '松手取消', JSON.stringify(h3));
  const v = (s) => types.find((r) => r.e === 'v' && r.v === s).at;
  await seekAt(v('他们在看大象') + 50);
  const t1 = await look();
  ok('打字:输入框里是「他们在看大象」,键盘垫在底下(330 高);录像栏「⌨ 孩子在打字」', t1.typed === '他们在看大象' && t1.kbd && t1.kbh === '330px' && t1.cap === '⌨ 孩子在打字', JSON.stringify(t1));
  console.log('  ', await shot('reel-typing.png'));
  await seekAt(v('他们在看') + 50);
  const t2 = await look();
  await seekAt(v('他们在看大熊猫') + 50);
  const t3 = await look();
  ok('删掉「大象」那一刻、改成「大熊猫」那一刻都看得到', t2.typed === '他们在看' && t3.typed === '他们在看大熊猫', JSON.stringify([t2.typed, t3.typed]));
  await seekAt(sendAt + 400);
  const t4 = await look();
  ok('发出去了:输入框收了、键盘没了', t4.typed === null && !t4.kbd, JSON.stringify(t4));
  const sentText = holds.find((r) => r.e === 'text' && r.text === 'Apple苹').at;
  await seekAt(sentText + 100);
  const h4 = await look();
  ok('认出字的那次:浮层上是「Apple苹」,不在那一串里', h4.hold && h4.ht === 'Apple苹' && !h4.cap.startsWith('⚠'), JSON.stringify(h4));
  // ---- 录像栏展开成经过(C):一条一行,点一条跳过去 ----
  await evaluate(`document.querySelector('#rl-more').click()`);
  await sleep(300);
  const lg = await evaluate(`({ open: !document.querySelector('#rl-log').hidden, rows: [...document.querySelectorAll('#rl-log li')].map((li) => li.querySelector('.rl-k').textContent + '|' + li.querySelector('.rl-t').textContent), cur: document.querySelectorAll('#rl-log li.cur').length, fut: document.querySelectorAll('#rl-log li.fut').length })`);
  ok('展开「经过」:有连着没发出去那一串、四次没发出去、打字(最后的字)、孩子开口;当前一条亮着、后面的淡着', lg.open && lg.rows.some((r) => r.startsWith('⚠ 连着|按住说话连着 4 次')) && lg.rows.filter((r) => r.startsWith('没发出去|')).length === 4 && lg.rows.includes('打字|他们在看大熊猫') && lg.rows.some((r) => r.startsWith('孩子|')) && lg.cur === 1, JSON.stringify(lg));
  const i0 = await evaluate(`[...document.querySelectorAll('#rl-log li')].findIndex((li) => li.querySelector('.rl-k').textContent === '打字')`);
  await evaluate(`document.querySelectorAll('#rl-log li')[${i0}].click()`);
  await sleep(500);
  const jumped = await evaluate(`({ cur: [...document.querySelectorAll('#rl-log li')].findIndex((li) => li.classList.contains('cur')), cap: document.querySelector('#rl-cap').textContent })`);
  ok('点「打字」那一条:跳到那一刻,那条亮着,录像栏「⌨ 孩子在打字」', jumped.cur === i0 && jumped.cap === '⌨ 孩子在打字', JSON.stringify({ i0, jumped }));
  console.log('  ', await shot('reel-log.png'));
  ok('页面没抛异常', errors.length === 0, errors.join(' | '));
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  if (!keep) { mock.kill(); await sleep(300); try { rmSync(join(tmp, 'chrome'), { recursive: true, force: true }); } catch {} }
  else { mock.unref(); console.log(`mock 留着:${base}/parent`); }
  console.log(`截图在 ${shots}`);
}
process.exit(bad ? 1 : 0);
