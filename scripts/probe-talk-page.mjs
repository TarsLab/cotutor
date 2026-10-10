#!/usr/bin/env node
/**
 * 口语课页面(/talk)的手动验收,不花钱:真 serve(临时 workspace,talk.enabled)+ 假 realtime(tests/_fake-realtime.ts,COTUTOR_TALK_ENDPOINT 指过去)
 * + 无头 Chrome(假麦克风放 say 念的一句英文)。走一遍:不拍自己填 → 口语单 → 给孩子 → 打电话 → 跟读按住 / 松手 / 下一句 → 聊 → 挂断 → 回看。
 * 逐项:页面连上、第一句 cue、按住时 PCM 到了假百炼、老师的声音排进 AudioContext、下一句、开聊(第二条会话)、聊里孩子出声老师被掐、挂断后回看有字。
 * 用法:node scripts/probe-talk-page.mjs [--keep] [--real]
 *   --real 不起假百炼,真连 realtime(要本机的 key 与业务空间 id,一次几分钱):看不到服务端那头的事,只验页面上看得见的——声音放了、孩子的字回来了、聊起来了、回看有字。
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS, quiet } from './_quiet.mjs';

const keep = process.argv.includes('--keep');
const real = process.argv.includes('--real');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8798;
const cdp = 9341;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const tmp = mkdtempSync(join(tmpdir(), 'cotutor-probe-talk-'));
// 假麦克风:循环放一句英文(前后留白,让 VAD 判得出停)
execFileSync('say', ['-r', '150', '-o', join(tmp, 'say.aiff'), '[[slnc 500]] It is a red car. [[slnc 1500]]']);
execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', join(tmp, 'say.aiff'), join(tmp, 'say.wav')]);

const { startFakeRealtime } = await import(join(repo, 'tests', '_fake-realtime.ts'));
const { initWorkspace } = await import(join(repo, 'src', 'cli', 'init.ts'));
/** 真连时假百炼不起;conns 一直空,靠它的检查项都跳过 */
const fake = real ? { endpoint: '', conns: [], close() {} } : await startFakeRealtime();
const wsRoot = join(tmp, 'ws');
await initWorkspace({ slug: 'probe', name: 'Ray', dir: wsRoot });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.talk = { enabled: true, minutes: 1 };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

try { await fetch(`${base}/api/health`); console.error(`端口 ${port} 上已经有东西,先停掉`); process.exit(2); } catch {}
const serveEnv = real ? { ...process.env, COTUTOR_WORKSPACE: wsRoot } : { ...process.env, COTUTOR_TALK_ENDPOINT: fake.endpoint, DASHSCOPE_API_KEY: 'sk-probe', COTUTOR_WORKSPACE: wsRoot };
const serve = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'serve', '--workspace', wsRoot, '--port', String(port), '--http'], { stdio: process.env.PROBE_LOG ? 'inherit' : 'ignore', env: serveEnv });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

// 页面里数:AudioContext 排了几块声音、麦克风开没开
const INJECT = `(() => {
  window.__played = 0; window.__gum = 0; window.__chunks = 0; window.__sentBin = 0; window.__sentText = [];
  const P = (window.AudioContext || window.webkitAudioContext).prototype;
  const orig = P.createBufferSource;
  P.createBufferSource = function () { const s = orig.call(this); const st = s.start; s.start = function () { window.__played++; return st.apply(this, arguments); }; return s; };
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) => { window.__gum++; return gum(c); };
  const d = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
  Object.defineProperty(MessagePort.prototype, 'onmessage', { set(f) { d.set.call(this, (e) => { window.__chunks++; f(e); }); }, get() { return d.get.call(this); } });
  const ws = WebSocket.prototype.send;
  WebSocket.prototype.send = function (x) { if (typeof x === 'string') window.__sentText.push(x); else window.__sentBin++; return ws.call(this, x); };
})();`;
const pageStats = (evaluate) => evaluate(`({ played: window.__played, gum: window.__gum, chunks: window.__chunks, sentBin: window.__sentBin, sentText: window.__sentText.slice(-5), hint: document.querySelector('#k-hint').textContent, held: document.querySelector('#k-hold').classList.contains('held'), sr: (window.__ctxRate || null) })`);

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${join(tmp, 'say.wav')}`, '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') console.log('  页面报错:', m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); if (process.env.PROBE_LOG && m.method === 'Runtime.consoleAPICalled') console.log('  console:', m.params.args.map((a) => a.value).join(' ')); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const until = async (expr, n = 40) => { for (let i = 0; i < n; i++) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
  const untilFn = async (f, n = 40) => { for (let i = 0; i < n; i++) { if (await f()) return true; await sleep(250); } return false; };
  // 先滚到看得见的地方:视口外的坐标 CDP 的鼠标事件派不到
  const center = async (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const mouse = async (type, at) => send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const click = async (sel) => { const at = await center(sel); await mouse('mousePressed', at); await mouse('mouseReleased', at); };
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });

  // ---- 家长:不拍自己填 → 口语单 ----
  await send('Page.navigate', { url: `${base}/talk` });
  ok('首页:开着,有拍照与「不拍,自己填」', await until(`document.querySelector('#home').classList.contains('on') && document.querySelector('#h-off').hidden && document.querySelector('#h-blank')`));
  await click('#h-blank');
  ok('开一次 → 口语单页', await until(`document.querySelector('#list').classList.contains('on') && location.hash.startsWith('#/list/')`));
  await click('#l-addw');
  await evaluate(`(() => { const r = document.querySelector('#l-words .row'); const [en, zh] = r.querySelectorAll('input'); en.value = 'red'; en.dispatchEvent(new Event('input')); zh.value = '红色'; zh.dispatchEvent(new Event('input')); return true; })()`);
  await click('#l-adds');
  await evaluate(`(() => { const r = document.querySelector('#l-sents .row'); const [en, zh] = r.querySelectorAll('input'); en.value = 'It is a red car.'; en.dispatchEvent(new Event('input')); zh.value = '这是一辆红色的车。'; zh.dispatchEvent(new Event('input')); return true; })()`);
  await click('#l-go');
  ok('给孩子 → 孩子页,写着先跟读 2 句', await until(`document.querySelector('#kid').classList.contains('on') && document.querySelector('#k-start-hint').textContent.includes('2 句')`));
  const id = await evaluate(`location.hash.split('/')[2]`);
  const meta = await (await fetch(`${base}/api/talk/${id}`)).json();
  ok('口语单存上了(ready,家长填的)', meta.meta.status === 'ready' && meta.meta.listBy === 'parent' && meta.meta.list.words[0].en === 'red', JSON.stringify(meta.meta.list));

  // ---- 孩子:打电话 → 跟读 ----
  const heardRe = real ? /\S/ : /It's a red car\./;
  const sawKid = (sel) => evaluate(`(() => { const t = document.querySelector(${JSON.stringify(sel)}).textContent; return t.includes('你说的') ? t.replace('你说的:', '') : ''; })()`);
  await click('#k-go');
  ok('打电话:麦克风开了、接上了、第一句 red 在卡上、老师的声音排进去放了', await untilFn(async () => (await evaluate(`window.__gum > 0 && !document.querySelector('#k-read').hidden && document.querySelector('#k-en').textContent === 'red' && window.__played > 0`)) && (real || (fake.conns.length === 1 && fake.conns[0].items.length >= 1)), 60), JSON.stringify(real ? await pageStats(evaluate) : { conns: fake.conns.length, items: fake.conns[0]?.items.map((i) => i.content[0].text) }));
  const c1 = fake.conns[0];
  if (!real) ok('跟读的会话:手动轮次,人设带 Ray 和 red', c1.session?.turn_detection === null && String(c1.session?.instructions).includes('Ray') && String(c1.session?.instructions).includes('red(红色)'));
  await until(`document.querySelector('#k-hint').textContent.includes('按住')`);
  const a0 = real ? 0 : c1.audio;
  const b0 = await evaluate(`window.__sentBin`);
  const at = await center('#k-hold');
  await mouse('mousePressed', at);
  const got = await untilFn(async () => (real ? (await evaluate(`window.__sentBin`)) >= b0 + 8 : c1.audio >= a0 + 3200 * 8), 40);
  ok('按住:麦克风的 PCM(16k)一块块推上去了,按钮亮着', got && (await evaluate(`document.querySelector('#k-hold').classList.contains('held')`)), JSON.stringify(await pageStats(evaluate)));
  await mouse('mouseReleased', at);
  ok('松手:孩子那句的字出在卡下面' + (real ? '(真转写)' : ''), await untilFn(async () => (real || c1.commits === 1) && heardRe.test(await sawKid('#k-heard')), 60), `「${await sawKid('#k-heard')}」`);
  await click('#k-again');
  if (!real) ok('再听一遍 → 再读一遍的 cue', await untilFn(async () => c1.items.some((i) => i.content[0].text.startsWith('再读一遍'))));
  else await sleep(2500);
  await click('#k-next');
  ok('下一句:第 2 句在卡上', await until(`document.querySelector('#k-en').textContent === 'It is a red car.' && document.querySelector('#k-dots i.done')`));

  // ---- 读完开聊 ----
  const played1 = await evaluate(`window.__played`);
  await click('#k-next');
  ok('读完:深色聊天页、倒计时、第二条会话(semantic_vad)、开聊 cue', await untilFn(async () => (real || (fake.conns.length === 2 && fake.conns[1].items.length >= 1)) && (await evaluate(`document.querySelector('#kid').classList.contains('chat') && !document.querySelector('#k-chat').hidden && document.querySelector('#k-chip').textContent.includes('还有')`)), 60), JSON.stringify(real ? {} : { conns: fake.conns.length, td: fake.conns[1]?.session?.turn_detection?.type }));
  const c2 = fake.conns[1];
  ok('老师开聊的声音放了、字在屏上', await untilFn(async () => (await evaluate(`window.__played > ${played1} && /\\S/.test(document.querySelector('#k-tt').textContent)` + (real ? '' : ` && document.querySelector('#k-tt').textContent.includes("It's a red car.")`))), 60), `「${await evaluate(`document.querySelector('#k-tt').textContent`)}」`);
  // 假麦克风一直有声:老师放完,孩子的声音才推(interrupt=false);有声 → speech_started;留白 → 转写、老师接
  ok('聊:孩子的声音推上去了(老师放完才推),转写回来、老师接了', await untilFn(async () => (real || (c2.audio > 0 && c2.creates >= 2)) && heardRe.test(await sawKid('#k-heard2')), 100), JSON.stringify(real ? { kid: await sawKid('#k-heard2'), tutor: await evaluate(`document.querySelector('#k-tt').textContent`) } : { audio: c2.audio, creates: c2.creates, cancels: c2.cancels }));

  // ---- 挂断 → 回看 ----
  await click('#k-hang');
  ok('挂断 → 回看页:聊过、分两段、有老师和孩子的话、有两段声音', await until(`document.querySelector('#review').classList.contains('on') && document.querySelectorAll('#r-lines .ln.tutor').length > 0 && document.querySelectorAll('#r-lines .ln.kid').length > 0 && document.querySelectorAll('#r-lines .ph').length === 2 && document.querySelectorAll('#r-play audio').length === 2`), 40);
  const after = await (await fetch(`${base}/api/talk/${id}`)).json();
  ok('落盘:done、why bye、用到的词', after.meta.status === 'done' && after.transcript.why === 'bye' && after.hasKidAudio && after.hasTutorAudio && (real || after.transcript.used.words[0].kid >= 1), JSON.stringify({ why: after.transcript?.why, used: after.transcript?.used, usage: after.transcript?.usage }));
  if (real) console.log('老师说过的:\n' + after.transcript.lines.filter((l) => l.who === 'tutor').map((l) => '  ' + l.text).join('\n') + '\n孩子转写:\n' + after.transcript.lines.filter((l) => l.who === 'kid').map((l) => '  ' + l.text).join('\n'));
  if (!real) ok('两条 realtime 会话都关了', c1.closed && c2.closed);
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  fake.close();
  if (!keep) { serve.kill(); await sleep(300); try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
  else { serve.unref(); console.log(`serve 留着:${base}/talk  workspace ${wsRoot}`); }
}
process.exit(bad ? 1 : 0);
