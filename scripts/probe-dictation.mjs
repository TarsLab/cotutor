#!/usr/bin/env node
/**
 * 听写的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱;mock 的语文老师有一册假课本的词语表、写字表):
 * 起 cotutor mock,Chrome 开孩子端首页(iPad 横屏 1180×820)→ 语文老师卡上的「听写」→ 选一课(词语表,识字 1《树叶》,划掉三个)→
 * 听写本上写:照 hanzi-writer-data 的中线用鼠标在写字卡里写,树叶写对、叶子的叶写成页 → 对一对:课本那一行别在页顶、叶子问「再写一遍?」→
 * 点一格看笔顺 → 再写一遍:描红那条、空格那条各写一遍 → 对好了回首页 → 首页听写卡那条路 → 手机宽度 → 家长看录像。没抛异常。
 * 手指走 CDP 的 Input.dispatchMouseEvent(经命中判定),不用 dispatchEvent。
 *
 * 用法:node scripts/probe-dictation.mjs [--out <截图目录>] [--keep](留下 mock)
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS } from './_quiet.mjs';

const keep = process.argv.includes('--keep');
const outAt = process.argv.indexOf('--out');
const out = outAt > 0 ? process.argv[outAt + 1] : null;
if (out) mkdirSync(out, { recursive: true });
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8796;
const cdp = 9338;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, detail = '') => { if (!cond) fails++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };
const medians = (ch) => JSON.parse(readFileSync(join(repo, 'node_modules', 'hanzi-writer-data', `${ch}.json`), 'utf8')).medians;

const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '0'], { stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

const home = probeDir('cotutor-probe-dictation-');
const browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(home, 'chrome')}`, `${base}/`], { stdio: 'ignore' });
try {
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page' && t.url.startsWith('http'))?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  const held = []; // 挡住的 /api/kid/home(Fetch.requestPaused)
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Fetch.requestPaused') held.push(m.params.requestId); };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  await send('Runtime.enable');
  await send('Page.enable');
  const shot = async (name) => { if (!out) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64')); };
  const waitFor = async (expr, ms = 8000) => { for (let i = 0; i < ms / 100; i++) { if (await evaluate(expr)) return true; await sleep(100); } return false; };
  const rect = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const tap = async (sel) => { await waitFor(`!document.querySelector('.main.arm')`, 1500); /* 主按钮换了意思后的半秒保护:等它亮了再点 */ const r = await rect(sel); if (!r) throw new Error(`点不到 ${sel}`); const x = r.x + r.w / 2, y = r.y + r.h / 2; await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); await sleep(150); };
  const tapText = async (text) => { const sel = await evaluate(`(() => { document.querySelectorAll('[data-probe]').forEach((x) => x.removeAttribute('data-probe')); const b = [...document.querySelectorAll('.view.on button, .view.on a')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return null; b.setAttribute('data-probe', ${JSON.stringify(text)}); return '[data-probe=' + JSON.stringify(${JSON.stringify(text)}) + ']'; })()`); if (!sel) throw new Error(`找不到按钮 ${text}`); await tap(sel); };
  /** 在第 k 个格里照中线写一个字(skip:不写的笔);鼠标按下、沿中线移动、松开 */
  const writeChar = async (padSel, ch, skip = []) => {
    const r = await rect(padSel);
    const toScreen = ([x, y]) => ({ x: r.x + (x / 1024) * r.w, y: r.y + ((900 - y) / 1024) * r.h });
    for (const [i, m] of medians(ch).entries()) {
      if (skip.includes(i)) continue;
      const pts = [];
      for (let k = 0; k < m.length - 1; k++) for (let q = 0; q < 6; q++) pts.push([m[k][0] + ((m[k + 1][0] - m[k][0]) * q) / 6, m[k][1] + ((m[k + 1][1] - m[k][1]) * q) / 6]);
      pts.push(m[m.length - 1]);
      const s = pts.map(toScreen);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s[0].x, y: s[0].y, button: 'left', buttons: 1, clickCount: 1 });
      for (const p of s.slice(1)) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s[s.length - 1].x, y: s[s.length - 1].y, button: 'left', buttons: 0, clickCount: 1 });
    }
  };
  const view = () => evaluate(`document.querySelector('.view.on')?.id ?? null`);
  /** 胶囊打开就是念的老师:挡住 /api/kid/home 再打开 url,这时胶囊已经是他的颜色和首字(服务端出页面时插进来的,不等老师名单) */
  const capsuleBeforeHome = async (url) => {
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/kid/home*' }] });
    await send('Page.navigate', { url });
    await waitFor(`!!document.querySelector('#back') && document.readyState !== 'loading'`);
    await sleep(600);
    const b = await evaluate(`(() => { const b = document.querySelector('#back'); return { tinted: b.classList.contains('tinted'), bg: getComputedStyle(b).backgroundColor, ini: b.querySelector('.bk-ini')?.textContent ?? '' }; })()`);
    const n = held.length;
    for (const id of held.splice(0)) await send('Fetch.continueRequest', { requestId: id });
    await send('Fetch.disable');
    return { ...b, held: n };
  };

  const errors = [];
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
  const inkOf = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.querySelector('.ink')?.children.length ?? -1`);
  const CARD = '#n-nb .card .pd .padbox';
  const next = () => tap('#n-nb .card [data-next]');

  // ---- 首页:语文老师卡上常驻的「听写」(没有相机角标;英语的还是拍照) ----
  ok('首页:语文老师卡上「听写」,照课本的词语表,没有相机角标', await waitFor(`!!document.querySelector('#deck .pc.front[data-tutor="chinese-tutor"] .bt-x-photo')`) && await evaluate(`(() => { const b = document.querySelector('#deck .pc.front .bt-x-photo'); return b.getAttribute('href') === '/dictation?tutor=chinese-tutor' && b.querySelector('.btx').textContent === '听写' && !b.querySelector('.cam'); })()`));
  await tap('#deck .pc.front .bt-x-photo');

  // ---- 选一课 ----
  ok('进来是课本的词语表:一课一行,栏名(阅读、识字);没选时底下是老师的字幕', await waitFor(`!!document.querySelector('#v-book.on') && document.querySelectorAll('#b-pg .bk-row').length === 5`) && await evaluate(`[...document.querySelectorAll('#b-pg .bk-sec')].map((x) => x.textContent).join() === '阅读,识字' && !document.querySelector('#b-say').hidden && document.querySelector('#b-go').hidden && document.querySelector('#b-title').textContent === '词语表'`));
  ok('平时什么都不画(没有选中的、没有按下的)', await evaluate(`!document.querySelector('.bk-row.on, .bk-row.press')`));
  await shot('01-book');
  await tap('#b-pg .bk-row[data-key="识字1"]');
  ok('点一行:那一行铺学科色,底下「1《树叶》· 5 个词」和开始听写', await waitFor(`!!document.querySelector('.bk-row.on[data-key="识字1"]') && document.querySelector('#b-go-t').textContent === '1《树叶》' && document.querySelector('#b-go-s').textContent === '5 个词'`));
  for (const k of [1, 2, 4]) await tap(`.bk-row.on .w:nth-child(${k + 1})`);
  ok('行里点词:划掉(这次不写),数跟着变', await waitFor(`document.querySelectorAll('.bk-row.on .w.off').length === 3 && document.querySelector('#b-go-s').textContent === '2 个词'`));
  await shot('02-book-pick');
  await tap('#v-book [data-tab="zi"]');
  ok('切到写字表:一个字一项,园地一行;选的那一课还选着', await waitFor(`document.querySelector('#b-title').textContent === '写字表' && !!document.querySelector('.bk-row.gd') && !!document.querySelector('.bk-row.on[data-key="识字1"]') && document.querySelector('#b-go-s').textContent.includes('个字')`));
  await shot('03-book-zi');
  await tap('#v-book [data-tab="ci"]');
  ok('切回词语表:划掉的还划着', await waitFor(`document.querySelectorAll('.bk-row.on .w.off').length === 3`));
  await tap('#b-start');

  // ---- 听写本 ----
  ok('开始:一页听写本,两个词(2、2 格),写字卡贴着第一格;字幕只说第几个词,页上没有字', await waitFor(`!!document.querySelector('#v-page.on') && document.querySelectorAll('#n-nb .wd').length === 2 && !!document.querySelector('${CARD}')`) && await evaluate(`[...document.querySelectorAll('#n-nb .wd')].map((w) => w.querySelectorAll('.padbox').length).join() === '2,2' && document.querySelector('#l-status').textContent.startsWith('第一个词') && !document.body.innerText.includes('叶子')`));
  const pos = await evaluate(`(() => { const c = document.querySelector('#n-nb .card').getBoundingClientRect(), a = document.querySelector('#n-nb .wd.cur .padbox.here').getBoundingClientRect(); return { below: Math.round(c.top - a.bottom), pad: Math.round(document.querySelector('${CARD}').getBoundingClientRect().width), inView: c.bottom <= innerHeight }; })()`);
  ok('写字卡在那一格下面、整个看得见、大格够大(≥ 300)', pos.below > 0 && pos.below < 30 && pos.inView && pos.pad >= 300, JSON.stringify(pos));
  const tools = await evaluate(`[...document.querySelectorAll('#v-page button.tool, #v-page button.main')].filter((b) => b.getClientRects().length).map((b) => b.textContent.trim())`);
  ok('按钮:再念、撤销、擦掉、不会写,给答案、写好了', ['再念', '撤销', '擦掉', '不会写,给答案', '写好了'].every((t) => tools.includes(t)), tools.join(' '));
  await writeChar(CARD, '树');
  ok('写:卡上 9 笔,页上这一格跟着画', (await inkOf(CARD)) === 9 && (await inkOf('#n-nb .wd.cur .padbox.here')) === 9);
  await shot('04-listen');
  await next();
  ok('写好了:卡挪到同一个词的第二格', await waitFor(`document.querySelector('#n-nb .wd.cur .padbox.here') === document.querySelectorAll('#n-nb .wd.cur .padbox')[1]`) && (await inkOf(CARD)) === 0);
  await writeChar(CARD, '叶');
  await next();
  ok('一个词写完:下一个词,页上第一个词留着写的字', await waitFor(`document.querySelector('#l-status').textContent.startsWith('第二个词')`) && await evaluate(`[...document.querySelectorAll('#n-nb .wd')[0].querySelectorAll('.ink')].map((g) => g.children.length).join() === '9,5'`));
  await writeChar(CARD, '页');
  await tapText('撤销');
  const u = await inkOf(CARD);
  await writeChar(CARD, '页', [0, 1, 2, 3, 4]);
  await next();
  await writeChar(CARD, '子');
  await next();

  // ---- 对一对 ----
  ok('对一对:同一页,课本那一行别在页顶(两个词),叶子问「再写一遍?」,书上的字叠着;对好了在右下', await waitFor(`!!document.querySelector('#v-page.on .nb-book') && !document.querySelector('#c-done').hidden`) && await evaluate(`document.querySelector('.nb-book .ws').textContent === '树叶叶子' && document.querySelectorAll('#n-nb .wd .ask').length === 1 && !!document.querySelectorAll('#n-nb .wd')[1].querySelector('.ask') && document.querySelectorAll('#n-nb .nb-ws .std path').length > 0`), `撤销后 ${u}`);
  await shot('05-check');
  await tap('#n-nb .wd:nth-child(1) .padbox:nth-child(1)');
  ok('点一格:卡上一笔一笔写「树」(一共 9 笔)', await waitFor(`!!document.querySelector('#n-nb .card.order') && document.querySelector('#n-nb .card [data-cnt]').textContent.includes('一共 9 笔')`));
  await shot('06-order');
  await tap('#n-nb .card [data-x]');
  ok('× 收起', await waitFor(`!document.querySelector('#n-nb .card')`));
  await tap('#n-nb .wd .ask');
  ok('再写一遍:页底一排——范字、描红、空格;卡在描红那条第一格', await waitFor(`document.querySelectorAll('#n-nb .nb-redo .rr .strip').length === 3 && !!document.querySelector('#n-nb .nb-redo .strip.cur .padbox.here') && document.querySelector('#n-nb .card [data-cnt]').textContent === '照着描一遍'`));
  await writeChar(CARD, '叶'); await next();
  await writeChar(CARD, '子'); await next();
  ok('描红那条交了:卡挪到空格那条', await waitFor(`document.querySelector('#n-nb .card [data-cnt]')?.textContent === '自己写一遍'`));
  await writeChar(CARD, '叶'); await next();
  await writeChar(CARD, '子'); await next();
  ok('空格那条也交了:卡收起,「再写一遍?」没了,那一排三条都留着', await waitFor(`!document.querySelector('#n-nb .card') && !document.querySelector('#n-nb .wd .ask') && document.querySelectorAll('#n-nb .nb-redo .rr .strip').length === 3`));
  await shot('07-redo');
  await tap('#c-done');
  ok('对好了:回首页', await waitFor(`location.pathname === '/'`));

  // ---- 首页的听写卡:开始屏 → 听写本 ----
  await waitFor(`!!document.querySelector('#deck .pc.front .bt-x-dictation')`);
  await tap('#deck .pc.front .bt-x-dictation');
  ok('首页听写卡:开始屏「听写 · 三个词」', await waitFor(`!!document.querySelector('#v-start.on') && document.querySelector('#s-big').textContent === '听写 · 三个词'`));
  await tapText('开始');
  ok('开始:听写本三个词(2、2、1 格),页头没有课名', await waitFor(`[...document.querySelectorAll('#n-nb .wd')].map((w) => w.querySelectorAll('.padbox').length).join() === '2,2,1' && document.querySelector('.nb-hd b').textContent === '听写 · 听写本'`));
  await tapText('不会写,给答案');
  ok('不会写,给答案:卡上一笔一笔写,放完换成照着写', await waitFor(`document.querySelector('#n-nb .card [data-cnt]').textContent.includes('笔')`) && await waitFor(`document.querySelector('#n-nb .card [data-cnt]').textContent === '照着灰色的写一遍'`, 15000));
  await shot('08-reveal');

  // ---- 拍一张 / 翻课本 ----
  await send('Page.navigate', { url: `${base}/dictation?tutor=chinese-tutor` });
  await waitFor(`!!document.querySelector('#v-book.on')`);
  await tap('#b-snap');
  ok('拍一张:拍照屏,右上角「翻课本」回来', await waitFor(`!!document.querySelector('#v-snap.on') && !document.querySelector('#snap-book').hidden`));
  await tap('#snap-book');
  ok('翻课本:回到表上', await waitFor(`!!document.querySelector('#v-book.on')`));

  // ---- 手机 ----
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `${base}/dictation?tutor=chinese-tutor` });
  await waitFor(`!!document.querySelector('#v-book.on')`);
  await sleep(300);
  ok('手机:表不横着出屏', await evaluate(`document.documentElement.scrollWidth <= innerWidth && document.querySelector('#b-pg').scrollWidth <= document.querySelector('#b-pg').clientWidth + 1`));
  await shot('09-phone-book');
  await tap('#b-pg .bk-row[data-key="阅读1"]');
  await tap('#b-start');
  await waitFor(`!!document.querySelector('${CARD}')`);
  await sleep(300);
  const ph = await evaluate(`(() => { const c = document.querySelector('#n-nb .card').getBoundingClientRect(), a = document.querySelector('#n-nb .wd.cur .padbox.here').getBoundingClientRect(); return { bottom: Math.round(innerHeight - c.bottom), w: Math.round(c.width), cellAbove: a.bottom <= c.top }; })()`);
  ok('手机:写字卡是底下一张抽屉,正在写的那格露在它上面', ph.bottom === 0 && ph.w === 390 && ph.cellAbove, JSON.stringify(ph));
  await shot('10-phone-write');
  // iPad 竖放
  await send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/dictation?tutor=chinese-tutor` });
  await waitFor(`!!document.querySelector('#v-book.on')`);
  await tap('#b-pg .bk-row[data-key="阅读3"]');
  await tap('#b-start');
  await waitFor(`!!document.querySelector('${CARD}')`);
  await sleep(300);
  const pt = await evaluate(`(() => { const c = document.querySelector('#n-nb .card').getBoundingClientRect(); return { left: Math.round(c.left), right: Math.round(innerWidth - c.right), bottom: c.bottom <= innerHeight, pad: Math.round(document.querySelector('${CARD}').getBoundingClientRect().width) }; })()`);
  ok('iPad 竖放:写字卡整个在屏里,大格够大(≥ 300)', pt.left >= 0 && pt.right >= 0 && pt.bottom && pt.pad >= 300, JSON.stringify(pt));
  await shot('10b-ipad-portrait');
  await send('Emulation.clearDeviceMetricsOverride');

  // ---- 家长看录像 ----
  // 树叶那一次(手机上开的那次一笔没写)
  const reelId = (await (await fetch(`${base}/api/dictation`)).json()).sessions.find((x) => x.words.join() === '树叶,叶子').id;
  await send('Page.navigate', { url: `${base}/parent/dictation/reel?id=${reelId}` });
  const K = `document.querySelector('#rl-frame').contentDocument`;
  ok('录像:孩子的屏幕是听写本那一页,停在最后一帧', await waitFor(`!!${K}?.querySelector('#v-page.on') && ${K}.body.classList.contains('rlk')`, 10000));
  await evaluate(`(() => { const r = document.querySelector('#rl-seek'); r.value = '0'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
  await tap('#rl-play');
  await sleep(2500);
  ok('播放:听写本上写字卡里一笔一笔出来', await evaluate(`${K}.querySelectorAll('#n-nb .card .ink path').length > 0 || ${K}.querySelectorAll('#n-nb .ink path').length > 0`));
  await shot('11-reel');
  ok('一路没抛异常', errors.length === 0, errors.slice(0, 3).join(' | '));
  ws.close();
} finally {
  browser.kill();
  if (!keep) mock.kill(); else mock.unref();
}
console.log(fails ? `${fails} 项没过` : '全部通过');
process.exit(fails ? 1 : 0);
