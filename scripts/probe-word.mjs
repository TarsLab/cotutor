#!/usr/bin/env node
/**
 * 单词卡(cards/word/card.md)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 起 cotutor mock,Chrome 开孩子端英语老师,孩子说 apple → 老师那节里有单词卡:四线三格、五个字母、卡上没有中文、右边「听」;
 * 念到它那句时一笔一笔写;点「听」按正常速度念(mock 没配音,走浏览器英文合成声);点卡开舞台:慢念(0.7 倍)与分段两色分开慢写同时开始 → 合拢、颜色退掉 → 再慢念;
 * 点第二段只写那一段;关舞台慢念停。iPad 横屏、手机各截一张。
 *
 * 用法:node scripts/probe-word.mjs [--out <截图目录>] [--keep](留下 mock)
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
const port = 8796;
const cdp = 9338;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const tmp = mkdtempSync(join(tmpdir(), 'cotutor-probe-word-'));
const shots = outAt > 0 ? process.argv[outAt + 1] : join(tmp, 'shots');
mkdirSync(shots, { recursive: true });

const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '0'], { stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

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
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
  const device = async (w, h, dsf, mobile) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile }); await sleep(400); };
  const until = async (expr, n = 40) => { for (let i = 0; i < n; i++) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
  await send('Runtime.enable');
  await send('Page.enable');
  // 浏览器合成声记下来(念了什么、什么语言、多快),1.2 秒算念完(免得等兜底计时;也够看出念的同时在写)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__said = []; window.speechSynthesis && (speechSynthesis.speak = (u) => { __said.push({ text: u.text, lang: u.lang, rate: +u.rate.toFixed(2) }); setTimeout(() => { __ended++; u.onend && u.onend(); }, 1200); }); window.__ended = 0;
    // 讲到单词卡时写没写:看板上有没有长出过 .ink(元素可能被重画换掉,只看出现过)
    window.__inked = 0; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('ink') && n.closest('#board')) window.__inked++; }).observe(document, { subtree: true, childList: true });` });

  await device(1180, 820, 1, false);
  await send('Page.navigate', { url: `${base}/?tutor=english-tutor` });
  await until(`Boolean(document.querySelector('#input, #bar'))`);
  await sleep(800);
  // 从页面的输入条发(页面外调接口发的,页面当成念过了、直接停在等答)
  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = 'apple'; document.querySelector('#go').click(); return true; })()`);
  await until(`Boolean(document.querySelector('#board .c-word .wg svg'))`, 60);
  const c0 = await evaluate(`(() => { const c = document.querySelector('#board .c-word'); return { letters: c.querySelectorAll('.lt').length, lines: c.querySelectorAll('.grid line').length, emoji: c.querySelector('.we')?.textContent, text: c.innerText, pill: c.querySelector('.rc-pl')?.textContent, han: /\\p{Script=Han}/u.test([...c.querySelectorAll('.wg, .we')].map((x) => x.textContent).join('')) }; })()`);
  ok('紧凑态:四线三格四条线、apple 五个字母、🍎、右边「听」、格里和图上没有中文', c0.letters === 5 && c0.lines === 4 && c0.emoji === '🍎' && c0.pill === '听' && !c0.han, JSON.stringify(c0));
  const wrote = await until(`window.__inked > 0`, 80);
  ok('念到它那句:按笔顺写一遍', wrote, String(await evaluate(`window.__inked`)));
  await until(`!document.querySelector('#board .c-word .ink') && document.querySelectorAll('#board .c-word .lt.done').length === 5`, 60);
  await evaluate(`document.querySelector('#board .c-word').scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await sleep(300);
  console.log('  ', await shot('word-ipad.png'));
  // 刚画出来、笔画还没到时格子就是终态的大小:现画一张,同步量 svg 的宽
  const sync = await evaluate(`(() => { const c = document.querySelector('#board .c-word'); const svg = c.querySelector('.wg svg'); return { attr: Number(svg.getAttribute('width')), w: Math.round(svg.getBoundingClientRect().width), paths: c.querySelectorAll('.gh').length }; })()`);
  ok('格子按字母宽排好:svg 的宽就是它画出来的宽(没被压缩)', sync.attr > 100 && Math.abs(sync.attr - sync.w) <= 1 && sync.paths === 8, JSON.stringify(sync));

  // 「听」:正常速度,英文
  await evaluate(`__said.length = 0; document.querySelector('#board .c-word .rc-pl').click()`);
  await sleep(200);
  const s1 = await evaluate(`__said.slice()`);
  ok('点「听」:念 apple,英文、正常速度', s1.length === 1 && s1[0].text === 'apple' && s1[0].lang === 'en-US' && s1[0].rate === 0.9, JSON.stringify(s1));
  const stayed = await evaluate(`!document.querySelector('#stage').classList.contains('on')`);
  ok('点「听」不开舞台', stayed);

  // 点卡开舞台:自动慢念 → 分开慢写 → 合拢 → 再慢念
  await sleep(1300);
  await evaluate(`__said.length = 0; __ended = 0; document.querySelector('#board .c-word').click()`);
  await until(`document.querySelector('#stage').classList.contains('on') && Boolean(document.querySelector('#st-body .c-word .wg svg'))`);
  const st0 = await evaluate(`(() => { const ls = [...document.querySelectorAll('#st-body .lt')]; return { kd: document.querySelector('#st-kd').textContent, ttl: document.querySelector('#st-ttl').textContent, k: ls.map((l) => l.dataset.k).join(''), faint: ls.filter((l) => !l.classList.contains('done')).length, x: ls.map((l) => l.style.transform), said: __said.slice() }; })()`);
  ok('舞台:顶栏「apple · 单词」;分段 ap|ple;字先淡着;一打开就慢念(0.7 倍)', st0.kd === '单词' && st0.ttl === 'apple' && st0.k === '00111' && st0.faint === 5 && st0.said.length === 1 && st0.said[0].rate === 0.63, JSON.stringify(st0));
  const both = await evaluate(`({ ink: Boolean(document.querySelector('#st-body .ink')), said: __said.length, ended: __ended })`);
  ok('念和写同时开始:第一遍慢念还没念完就已经在写', both.ink && both.said === 1 && both.ended === 0, JSON.stringify(both));
  await until(`Boolean(document.querySelector('#st-body .ink'))`, 200);
  const t0 = Date.now();
  await until(`Boolean(document.querySelector('#st-body .lt.k1 .ink'))`, 200);
  const split = await evaluate(`(() => { const ls = [...document.querySelectorAll('#st-body .lt')]; return { k0: getComputedStyle(ls[0].querySelector('.ink')).stroke, k1: getComputedStyle(document.querySelector('#st-body .lt.k1 .ink')).stroke }; })()`);
  ok('分开写时两段两个颜色', split.k0 !== split.k1, JSON.stringify(split));
  console.log('  ', await shot('word-stage-writing.png'));
  await until(`document.querySelectorAll('#st-body .lt.done').length === 5 && !document.querySelector('#st-body .ink')`, 200);
  const writeMs = Date.now() - t0;
  await sleep(1000);
  const st1 = await evaluate(`(() => { const ls = [...document.querySelectorAll('#st-body .lt')]; return { x: ls.map((l) => l.style.transform), said: __said.slice(), k1: getComputedStyle(ls[4].querySelector('.gh')).stroke, k0: getComputedStyle(ls[0].querySelector('.gh')).stroke }; })()`);
  ok('写完合拢(第三个字母往回挪了)、颜色退成一色、再慢念一遍', st1.x[2] !== st0.x[2] && st1.said.length === 2 && st1.said[1].rate === 0.63 && st1.k0 === st1.k1, JSON.stringify({ ...st1, writeMs }));
  ok(`慢写:整词写了 ${(writeMs / 1000).toFixed(1)} 秒(比讲到时的正常速度慢、又不拖)`, writeMs > 2500 && writeMs < 7000, String(writeMs));
  console.log('  ', await shot('word-stage-done.png'));

  // 点第二段:只写那一段
  await evaluate(`document.querySelectorAll('#st-body .lt')[3].dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(150);
  const st2 = await evaluate(`[...document.querySelectorAll('#st-body .lt')].map((l) => l.classList.contains('done') ? 1 : 0).join('')`);
  ok('点 ple:只重写第二段(前两个字母不动)', st2.startsWith('11') && st2.slice(2).includes('0'), st2);

  // 关舞台
  await evaluate(`document.querySelector('#st-x').click()`);
  await sleep(300);
  ok('关舞台', !(await evaluate(`document.querySelector('#stage').classList.contains('on')`)));

  // 手机
  await device(390, 844, 2, true);
  await evaluate(`document.querySelector('#board .c-word').scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await sleep(400);
  const ph = await evaluate(`(() => { const c = document.querySelector('#board .c-word'); const r = c.getBoundingClientRect(), s = c.querySelector('.wg svg').getBoundingClientRect(); return { cw: Math.round(r.width), sw: Math.round(s.width), sh: Math.round(s.height), over: document.documentElement.scrollWidth > innerWidth }; })()`);
  ok('手机:格子放得下、不横向滚', ph.sw <= ph.cw && !ph.over && ph.sh > 60, JSON.stringify(ph));
  // 格子同步就有准确的大小(字母宽表在页面里),量具量的是终态:手机半宽放不下 emoji + 格子 +「听」一行 → 全宽
  const pw = await evaluate(`(() => { const b = document.querySelector('#board'), cs = getComputedStyle(b); return Math.round(b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); })()`);
  ok('手机:单词卡占整行(不再按空壳量成半宽)', Math.abs(ph.cw - pw) <= 2, JSON.stringify({ ...ph, board: pw }));
  console.log('  ', await shot('word-phone.png'));
  await evaluate(`document.querySelector('#board .c-word').click()`);
  await sleep(2500);
  console.log('  ', await shot('word-phone-stage.png'));

  ok('页面没抛异常', errors.length === 0, errors.join(' | '));
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  if (!keep) { mock.kill(); await sleep(300); try { rmSync(join(tmp, 'chrome'), { recursive: true, force: true }); } catch {} }
  else { mock.unref(); console.log(`mock 留着:${base}/?tutor=english-tutor`); }
  console.log(`截图在 ${shots}`);
}
process.exit(bad ? 1 : 0);
