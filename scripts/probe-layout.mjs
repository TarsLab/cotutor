#!/usr/bin/env node
/**
 * 排版(《工作流程.md》§二「排版」,2026-10-01 归代码)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 起 cotutor mock,Chrome 开孩子端数学老师。iPad 横屏、竖屏、手机各看一遍预载的那节(勾股定理):
 * 字少的卡半宽、相邻两张半宽并一行、落单的半宽卡占左半、选择题占满、页面不横滚、半宽卡里的字不溢出;
 * 再从输入条发一句,老师一张张出卡时,已经出来的卡不挪(位置、宽度都不变)。每种尺寸截一张。
 *
 * 用法:node scripts/probe-layout.mjs [--out <截图目录>] [--keep](留下 mock)
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
const port = 8797;
const cdp = 9339;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const tmp = mkdtempSync(join(tmpdir(), 'cotutor-probe-layout-'));
const shots = outAt > 0 ? process.argv[outAt + 1] : join(tmp, 'shots');
mkdirSync(shots, { recursive: true });

// 出卡慢一点(整节 4 秒),好看清一张张来时前面的卡动没动
const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '4000'], { stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

// 一节的行:每行几列、每张卡的种类、左边、宽、溢出没有
const READ_ROWS = `(() => {
  const b = document.querySelector('#board'), cs = getComputedStyle(b);
  const W = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const secs = [...b.querySelectorAll(':scope > .sec')].map((sec) => [...sec.querySelectorAll(':scope > .row')].map((row) => ({
    cols: getComputedStyle(row).gridTemplateColumns.split(' ').length,
    cards: [...row.querySelectorAll(':scope > [data-card]')].map((c) => { const r = c.getBoundingClientRect(); return { k: +c.dataset.card, kind: [...c.classList].find((x) => x.startsWith('c-')) || c.className, x: Math.round(r.left), w: Math.round(r.width), over: [...c.children].some((x) => !x.classList.contains('again') && (x.scrollWidth > x.clientWidth + 1 || x.getBoundingClientRect().right > r.right + 1)) }; }),
  })));
  return { W: Math.round(W), half: Math.floor((W - 12) / 2), secs, pageOver: document.scrollingElement.scrollWidth > innerWidth, boardOver: b.scrollWidth > b.clientWidth };
})()`;

let browser = null;
try {
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
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
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
  const device = async (w, h, dsf, mobile) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile }); await sleep(400); };
  const until = async (expr, n = 40) => { for (let i = 0; i < n; i++) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
  await send('Runtime.enable');
  await send('Page.enable');
  // 浏览器合成声念得很快就算念完;流式时记下每张卡第一次出来的位置,之后每次板上有变化都对一遍
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.speechSynthesis && (speechSynthesis.speak = (u) => { setTimeout(() => u.onend && u.onend(), 150); });
    window.__track = null; window.__moved = [];
    new MutationObserver(() => { const t = window.__track; if (!t) return; const sec = document.querySelector('#board > .sec[data-sec="' + t.sec + '"]'); if (!sec) return;
      for (const c of sec.querySelectorAll('.row > [data-card]')) { const r = c.getBoundingClientRect(); const now = Math.round(r.left) + ',' + Math.round(r.width) + ',' + Math.round(r.top - sec.querySelector(':scope > .row').getBoundingClientRect().top); const k = c.dataset.card;
        if (!(k in t.first)) t.first[k] = now; else if (t.first[k] !== now && !c.classList.contains('pend')) window.__moved.push(k + ': ' + t.first[k] + ' → ' + now); } }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });` });

  const near = (a, b) => Math.abs(a - b) <= 2;
  /** 一种尺寸看预载的那节 */
  const look = async (label, w, h, dsf, mobile, file) => {
    await device(w, h, dsf, mobile);
    await send('Page.navigate', { url: `${base}/?tutor=math-tutor` });
    await until(`document.querySelectorAll('#board .sec .row').length > 0`, 60);
    await sleep(600);
    const L = await evaluate(READ_ROWS);
    const rows = L.secs[0];
    const pairs = rows.filter((r) => r.cards.length === 2);
    const halves = rows.flatMap((r) => (r.cols === 2 ? r.cards : []));
    const lone = rows.filter((r) => r.cards.length === 1 && r.cols === 2);
    const choice = rows.flatMap((r) => r.cards).find((c) => c.kind === 'c-choice');
    console.log(`  ${label}:板宽 ${L.W},半宽 ${L.half};行 ${rows.map((r) => `[${r.cards.map((c) => c.k).join(',')}]${r.cols === 2 && r.cards.length === 1 ? '½' : ''}`).join(' ')}`);
    ok(`${label}:半宽的卡都是半宽(两张并一行的、落单占左半的)`, halves.every((c) => near(c.w, L.half)), JSON.stringify(halves));
    ok(`${label}:选择题占满一行`, choice !== undefined && near(choice.w, L.W), JSON.stringify(choice));
    ok(`${label}:不横滚、半宽卡里不溢出`, !L.pageOver && !L.boardOver && rows.every((r) => r.cards.every((c) => !c.over)), JSON.stringify({ pageOver: L.pageOver, boardOver: L.boardOver }));
    console.log('  ', await shot(file));
    return { L, rows, pairs, lone };
  };

  const ipad = await look('iPad 横屏', 1180, 820, 1, false, 'layout-ipad.png');
  ok('iPad 横屏:有两张并一行的(字少的兄弟卡)', ipad.pairs.length >= 1, JSON.stringify(ipad.pairs.map((r) => r.cards.map((c) => c.k))));
  const portrait = await look('iPad 竖屏', 820, 1180, 1, false, 'layout-portrait.png');
  ok('iPad 竖屏:有两张并一行的', portrait.pairs.length >= 1);
  const phone = await look('手机', 390, 844, 2, true, 'layout-phone.png');
  ok('手机:并排的比横屏少(半宽只放得下标题加一行)', phone.rows.filter((r) => r.cols === 2).length <= ipad.rows.filter((r) => r.cols === 2).length);

  // 流式:老师一张张出卡,已经出来的卡不挪
  await device(1180, 820, 1, false);
  await send('Page.navigate', { url: `${base}/?tutor=math-tutor` });
  await until(`document.querySelectorAll('#board .sec .row').length > 0`, 60);
  await sleep(600);
  const n0 = await evaluate(`document.querySelectorAll('#board > .sec').length`);
  await evaluate(`window.__track = { sec: ${n0}, first: {} }; window.__moved = []; (() => { const t = document.querySelector('#typed'); t.value = '反过来呢?'; document.querySelector('#go').click(); return true; })()`);
  // 前两张出来就拍一张(第三张是填空题,出来后会自己弹舞台)
  if (await until(`document.querySelectorAll('#board > .sec[data-sec="${n0}"] .row > [data-card]').length >= 2`, 80)) {
    await evaluate(`document.querySelector('#board > .sec[data-sec="${n0}"]').scrollIntoView({ block: 'start', behavior: 'instant' })`);
    console.log('  ', await shot('layout-live.png'));
  }
  const got = await until(`document.querySelectorAll('#board > .sec[data-sec="${n0}"] .row > [data-card]').length >= 3`, 80);
  await sleep(1500);
  const live = await evaluate(READ_ROWS);
  const lr = live.secs[n0] || [];
  console.log(`  流式那节:行 ${lr.map((r) => `[${r.cards.map((c) => c.k).join(',')}]${r.cols === 2 && r.cards.length === 1 ? '½' : ''}`).join(' ')}`);
  ok('流式:三张卡都出来了', got);
  const moved = await evaluate(`window.__moved.slice()`);
  ok('流式:已经出来的卡不挪(位置、宽度)', moved.length === 0, moved.slice(0, 4).join(' | '));
  ok('流式:前两张字少的并一行', lr.some((r) => r.cards.length === 2), JSON.stringify(lr.map((r) => r.cards.map((c) => c.k))));

  ok('页面没抛异常', errors.length === 0, errors.join(' | '));
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  if (!keep) { mock.kill(); await sleep(300); try { rmSync(join(tmp, 'chrome'), { recursive: true, force: true }); } catch {} }
  else { mock.unref(); console.log(`mock 留着:${base}/?tutor=math-tutor`); }
  console.log(`截图在 ${shots}`);
}
process.exit(bad ? 1 : 0);
