#!/usr/bin/env node
/**
 * 再听(2026-09-18)的手动验收(不进 pnpm test,要本机 Chrome;走 cotutor mock,不花钱,配音退回合成声 / 按字数计时):
 * 停在第一节第二句 → 只有讲完的卡露喇叭、节头没有;点喇叭 → 字幕念那张卡的句、喇叭变橙,念完回到原来那句(暂停);
 * 整页念完 → 节头露喇叭,点节头从第一句念;点字幕上的字重念这句;手机尺寸截一张。
 *
 * 用法:node scripts/probe-replay.mjs [--out <截图目录>]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outAt = process.argv.indexOf('--out');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8794;
const cdp = 9336;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, detail = '') => { if (!cond) failed++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const home = mkdtempSync(join(tmpdir(), 'cotutor-probe-replay-'));
const shots = outAt > 0 ? process.argv[outAt + 1] : join(home, 'shots');
mkdirSync(shots, { recursive: true });
const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--force-device-scale-factor=2', '--window-size=780,1688', `--user-data-dir=${join(home, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const waiting = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
  const until = async (expr, ms = 20000) => { for (let t = 0; t < ms; t += 200) { if (await evaluate(expr)) return true; await sleep(200); } return false; };
  const open = async (q) => { await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor${q}` }); await until(`document.querySelectorAll('#board .sec .c').length > 0`); await sleep(600); };
  await send('Page.enable');

  // ---- 停在第一节第二句:讲完的卡才有喇叭 ----
  await open('&step=0.1&device=phone');
  const early = await evaluate(`(() => { const s = document.querySelector('#board .sec[data-sec="0"]'); const cards = [...s.querySelectorAll('.c[data-card]')]; return { heard: cards.filter((c) => c.classList.contains('heard')).map((c) => c.dataset.card), total: cards.length, head: s.classList.contains('heard'), shown: cards.filter((c) => getComputedStyle(c.querySelector(':scope > .again')).display !== 'none').length }; })()`);
  ok('停在第二句:节头没喇叭,不是每张卡都有', !early.head && early.heard.length < early.total, JSON.stringify(early));
  ok('喇叭只在讲完的卡上露', early.shown === early.heard.length);

  // ---- 整页念完(不出声打开):全部讲过 ----
  await open('&device=phone');
  const all = await evaluate(`(() => { const s = document.querySelector('#board .sec[data-sec="0"]'); return { head: s.classList.contains('heard'), heard: s.querySelectorAll('.c.heard').length, total: s.querySelectorAll('.c[data-card]').length, sub: document.querySelector('#sub-text').textContent }; })()`);
  ok('念完了:节头与有讲稿的卡都露喇叭', all.head && all.heard > 0, JSON.stringify(all));
  await shot('replay-heard-phone.png');

  // ---- 点一张卡的喇叭 ----
  const before = all.sub;
  const clicked = await evaluate(`(() => { const c = document.querySelector('#board .sec[data-sec="0"] .c.heard'); c.querySelector(':scope > .again').click(); return c.dataset.card; })()`);
  await sleep(300);
  const during = await evaluate(`(() => ({ replaying: [...document.querySelectorAll('#board .c.replaying')].map((c) => c.dataset.card), sub: document.querySelector('#sub-text').textContent, btn: !document.querySelector('#sub-btn').hidden, stage: document.querySelector('#stage').classList.contains('on') }))()`);
  ok('点喇叭:那张卡在重念、字幕换成它的句、有暂停钮、没开舞台', during.replaying.join() === clicked && during.sub !== '' && during.btn && !during.stage, JSON.stringify(during));
  await shot('replay-card-phone.png');
  // 亮的那张就是点的那张:每张讲过的卡点一遍,念的每句都亮它(按亮哪张分组)
  const lit = await evaluate(`(async () => { document.querySelector('#sub-btn').click(); await new Promise((r) => setTimeout(r, 200)); const bad = []; for (const c of [...document.querySelectorAll('#board .sec[data-sec="0"] .c.heard')]) { c.querySelector(':scope > .again').click(); for (let t = 0; t < 60 && c.classList.contains('replaying'); t++) { const now = document.querySelector('#board .c.now'); if (now && now !== c) bad.push(c.dataset.card + '→' + now.dataset.card); await new Promise((r) => setTimeout(r, 250)); } } return bad; })()`);
  ok('再听时亮的就是点的那张', lit.length === 0, lit.join(' '));
  ok('念完回到原来的位置', await until(`!document.querySelector('#board .c.replaying') && document.querySelector('#sub-text').textContent === ${JSON.stringify(before)}`), before);

  // ---- 重念中再点一下 = 停 ----
  await evaluate(`document.querySelector('#board .sec[data-sec="0"] .c.heard > .again').click()`);
  await sleep(300);
  await evaluate(`document.querySelector('#board .sec[data-sec="0"] .c.replaying > .again').click()`);
  await sleep(200);
  ok('重念中再点一下就停', await evaluate(`!document.querySelector('#board .replaying') && document.querySelector('#sub-text').textContent === ${JSON.stringify(before)}`));

  // ---- 节头:整节从第一句 ----
  await evaluate(`document.querySelector('#board .sec[data-sec="0"] > .sh').click()`);
  await sleep(300);
  const sec = await evaluate(`({ on: document.querySelector('#board .sec[data-sec="0"]').classList.contains('replaying'), sub: document.querySelector('#sub-text').textContent })`);
  ok('点节头:整节重念', sec.on && sec.sub !== before, JSON.stringify(sec));
  await evaluate(`document.querySelector('#sub-btn').click()`);
  await sleep(200);
  ok('重念时点暂停 = 不听了,回到原来的位置', await evaluate(`!document.querySelector('#board .replaying') && document.querySelector('#sub-text').textContent === ${JSON.stringify(before)}`));

  // ---- 点字幕:重念这一句 ----
  await evaluate(`document.querySelector('#sub-text').click()`);
  await sleep(200);
  const line = await evaluate(`({ btn: document.querySelector('#sub-btn').innerHTML.includes('path'), sub: document.querySelector('#sub-text').textContent })`);
  ok('点字幕上的字:重念这句(出暂停钮)', line.btn && line.sub === before, JSON.stringify(line));
  ok('这句念完回到原来的位置', await until(`document.querySelector('#sub-btn').hidden || document.querySelector('#sub-btn').classList.contains('cont')`));
  console.log(`截图在 ${shots}`);
} finally {
  browser?.kill();
  mock.kill();
}
process.exit(failed ? 1 : 0);
