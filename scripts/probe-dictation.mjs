#!/usr/bin/env node
/**
 * 听写(《wip/听写设想.md》)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 起 cotutor mock,Chrome 开孩子端首页(iPad 横屏 1180×820)→ 点听写卡进 /dictation → 开始 →
 * 照 hanzi-writer-data 的中线用鼠标写:春天写对、鼓励的鼓少写第 7 笔、叶写成页 → 每个词「写好了」→ 对答案:
 * 三张词卡、书上的字叠着、鼓励与叶问「这个再写一遍?」、春天不问;拿开 / 叠上蓝字 → 点鼓逐笔看:13 个方块、写到最后 →
 * 我再写一遍:范字、两个空格,写全了交 → 鼓励不再问 → 对好了回首页 → 家长页 /dictation/parent:少了第 7 笔、可能写成了别的字。
 * 手指走 CDP 的 Input.dispatchMouseEvent(经命中判定),不用 dispatchEvent。
 *
 * 用法:node scripts/probe-dictation.mjs [--out <截图目录>] [--keep](留下 mock)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS, quiet } from './_quiet.mjs';

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

const home = mkdtempSync(join(tmpdir(), 'cotutor-probe-dictation-'));
const browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(home, 'chrome')}`, `${base}/`], { stdio: 'ignore' });
try {
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page' && t.url.startsWith('http'))?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);
  const shot = async (name) => { if (!out) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64')); };
  const waitFor = async (expr, ms = 8000) => { for (let i = 0; i < ms / 100; i++) { if (await evaluate(expr)) return true; await sleep(100); } return false; };
  const rect = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const tap = async (sel) => { const r = await rect(sel); if (!r) throw new Error(`点不到 ${sel}`); const x = r.x + r.w / 2, y = r.y + r.h / 2; await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); await sleep(150); };
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

  // ---- 首页的听写卡 ----
  ok('首页:有听写卡,写着「听写」与几个词,没有字', await waitFor(`!!document.querySelector('.c-dictation')`) && (await evaluate(`(() => { const c = document.querySelector('.c-dictation'); return c.textContent.includes('3 个词') && !c.textContent.includes('鼓') && c.getAttribute('href').startsWith('/dictation?home='); })()`)));
  await shot('01-home');
  await tap('.c-dictation');
  ok('点卡:进 /dictation,开始屏「听写 · 三个词」', await waitFor(`location.pathname === '/dictation' && document.querySelector('#v-start.on') && document.querySelector('#s-big').textContent === '听写 · 三个词'`));
  await shot('02-start');

  // ---- 听写 ----
  await tapText('开始');
  ok('听写中:第一个词两个格、气泡里没有字', await waitFor(`document.querySelectorAll('#l-pads .padbox').length === 2`) && (await evaluate(`document.querySelector('#l-what').textContent === '第一个词,两个字' && !document.body.innerText.includes('春')`)));
  await writeChar('#l-pads .padbox:nth-child(1)', '春');
  await writeChar('#l-pads .padbox:nth-child(2)', '天');
  ok('写:格里出现孩子的笔(春 9 笔、天 4 笔)', (await evaluate(`[...document.querySelectorAll('#l-pads .ink')].map((g) => g.children.length).join()`)) === '9,4');
  await shot('03-listen');
  await tapText('写好了');
  ok('写好了:下一个词', await waitFor(`document.querySelector('#l-what').textContent === '第二个词,两个字'`));
  await writeChar('#l-pads .padbox:nth-child(1)', '鼓', [6]);
  await writeChar('#l-pads .padbox:nth-child(2)', '励');
  // 撤销一笔再补上:撤销只撤最后一笔
  await tapText('撤销');
  const afterUndo = await evaluate(`[...document.querySelectorAll('#l-pads .ink')].map((g) => g.children.length).join()`);
  await writeChar('#l-pads .padbox:nth-child(2)', '励');
  await tapText('擦掉这一格');
  await writeChar('#l-pads .padbox:nth-child(2)', '励');
  ok('撤销撤最后一笔;擦掉这一格清当前格', afterUndo === '12,6' && (await evaluate(`[...document.querySelectorAll('#l-pads .ink')].map((g) => g.children.length).join()`)) === '12,7');
  await tapText('写好了');
  ok('第三个词一个格', await waitFor(`document.querySelector('#l-what').textContent === '第三个词,一个字' && document.querySelectorAll('#l-pads .padbox').length === 1`));
  await writeChar('#l-pads .padbox', '页');
  await tapText('写好了');

  // ---- 对答案 ----
  ok('交卷:进对答案,三张词卡', await waitFor(`document.querySelector('#v-check.on') && document.querySelectorAll('.wc').length === 3`));
  await waitFor(`[...document.querySelectorAll('.wc .std')].every((g) => g.children.length > 0)`);
  const asks = await evaluate(`[...document.querySelectorAll('.wc')].map((c) => c.querySelector('.ask') ? 'ask' : 'self').join()`);
  ok('问「这个再写一遍?」的:鼓励(少一笔)、叶(写成页);春天不问', asks === 'self,ask,ask', asks);
  ok('页面上没有叉、没有分数、没有对错的字', !(await evaluate(`/[✗×]|错|分数|不对/.test(document.querySelector('#v-check').innerText)`)));
  await shot('04-check');
  await tap('#c-toggle');
  ok('拿开蓝字:书上的字藏起来', await evaluate(`getComputedStyle(document.querySelector('.wc .std')).display === 'none'`));
  await shot('05-check-bare');
  await tap('#c-toggle');

  // ---- 逐笔看 ----
  await tap('.wc:nth-child(2) .padbox:nth-child(1)');
  ok('点鼓:逐笔看,13 个方块,一笔一笔往下写', await waitFor(`document.querySelector('#v-order.on') && document.querySelectorAll('#r-sqs i').length === 13`));
  await sleep(4500);
  const k = await evaluate(`document.querySelectorAll('#r-sqs i.d').length`);
  ok('写着写着:前面的笔变蓝', k >= 3, `已写 ${k} 笔`);
  await tap('#r-next');
  await shot('06-stroke-order');
  await tapText('我再写一遍');

  // ---- 再写一遍 ----
  ok('再写一遍:范字两个、空格两个', await waitFor(`document.querySelector('#v-rewrite.on') && document.querySelectorAll('#w-models .padbox').length === 2 && document.querySelectorAll('#w-pads .padbox').length === 2`));
  await tap('#w-models .padbox:nth-child(1)');
  await writeChar('#w-pads .padbox:nth-child(1)', '鼓');
  await writeChar('#w-pads .padbox:nth-child(2)', '励');
  await shot('07-rewrite');
  await tapText('写好了');
  ok('交了:回对答案,鼓励不再问', await waitFor(`document.querySelector('#v-check.on') && [...document.querySelectorAll('.wc')].map((c) => c.querySelector('.ask') ? 'ask' : 'self').join() === 'self,self,ask'`));
  await shot('08-check-after');
  await tapText('对好了');
  ok('对好了:回首页', await waitFor(`location.pathname === '/' && !!document.querySelector('.c-dictation')`));

  // ---- 家长 ----
  await send('Page.navigate', { url: `${base}/dictation/parent` });
  ok('家长页:鼓少了第 7 笔、叶可能写成了别的字、问了才改、要再练的词', await waitFor(`document.body.innerText.includes('少了第 7 笔') && document.body.innerText.includes('可能写成了别的字') && document.body.innerText.includes('问了才改') && (document.querySelector('textarea')?.value ?? '').includes('鼓励 鼓励,老师鼓励我的鼓励')`), (await evaluate(`document.body.innerText.slice(0, 400)`)) ?? '');
  await shot('09-parent');
  // ---- 拍照开始(孩子端,首页固定的「拍照听写」)----
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Page.navigate', { url: `${base}/` });
  ok('首页:固定的「拍照听写」入口在', await waitFor(`!!document.querySelector('.c-snap') && document.querySelector('.c-snap').getAttribute('href') === '/dictation'`));
  await tap('.c-snap');
  ok('点了:拍照屏(拍照 / 从相册选)', await waitFor(`location.pathname === '/dictation' && !!document.querySelector('#v-snap.on')`));
  await shot('11-snap');
  const icon = join(home, 'photo.png');
  writeFileSync(icon, Buffer.from(await (await fetch(`${base}/icon-512.png`)).arrayBuffer()));
  const doc = await send('DOM.getDocument', {});
  const input = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#snap-lib' });
  await send('DOM.setFileInputFiles', { nodeId: input.result.nodeId, files: [icon] });
  ok('选了照片:进认词屏,框一个一个冒出来(假识别 15 项)', await waitFor(`!!document.querySelector('#v-pick.on') && document.querySelectorAll('#p-shot .bx').length === 15`, 10000));
  await waitFor(`document.querySelector('#p-status').textContent.startsWith('认好了')`);
  ok('词语默认选上(6 个)、写字默认不选;没认准的「宽大」在列表里能改字;课名', (await evaluate(`document.querySelectorAll('#p-shot .bx.on').length`)) === 6 && (await evaluate(`document.querySelectorAll('#p-list .wr').length`)) === 6 && (await evaluate(`!!document.querySelector('#p-list input') && document.querySelector('#p-list input').value === '宽大' && document.querySelector('#p-lesson').textContent === '小蝌蚪找妈妈'`)));
  await tap('#p-shot .bx[data-k="13"]');
  ok('点照片上的「皮」:选上,列表多一个', (await evaluate(`document.querySelectorAll('#p-list .wr').length`)) === 7 && (await evaluate(`document.querySelector('#p-shot .bx[data-k="13"]').classList.contains('on')`)));
  await tap('#p-list .wr:nth-child(6) .x');
  ok('列表里点 × 去掉「宽大」', (await evaluate(`[...document.querySelectorAll('#p-list .wr')].map((r) => r.textContent).join('|').includes('宽大')`)) === false && (await evaluate(`document.querySelector('#p-go').textContent`)) === '开始听写 · 六个词');
  await shot('12-pick');
  await tap('#p-go');
  ok('开始听写:进写字屏,第一个词两个格、没有字', await waitFor(`!!document.querySelector('#v-listen.on') && document.querySelectorAll('#l-pads .padbox').length === 2 && document.querySelector('#l-what').textContent === '第一个词,两个字'`));
  await shot('13-photo-listen');

  // 手机宽度看一眼家长页
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1400, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  await shot('10-parent-phone');
  ws.close();
} finally {
  browser.kill();
  if (!keep) mock.kill(); else mock.unref();
}
console.log(fails ? `${fails} 项没过` : '全部通过');
process.exit(fails ? 1 : 0);
