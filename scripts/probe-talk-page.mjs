#!/usr/bin/env node
/**
 * 口语课页面(家长端 /parent/talk,孩子那一屏 /talk)的手动验收,不花钱:真 serve(临时 workspace,talk.enabled)+ 假 realtime(tests/_fake-realtime.ts,COTUTOR_TALK_ENDPOINT 指过去)
 * + 无头 Chrome(假麦克风放 say 念的一句英文)。走一遍:不拍自己填 → 口语单 → 给孩子 → 开始 → 跟我读(什么都不按)→ 聊 → 挂断 → 回看。
 * 逐项:页面连上、第一句 cue、跟我读不用按(老师放完就听、静了算读完、自己往下走)、老师的声音排进 AudioContext、再听一遍、开聊(第二条会话)、聊里孩子出声老师被掐、挂断后回看有字。
 * 用法:node scripts/probe-talk-page.mjs [--keep] [--real] [--out <截图目录>]
 *   --real 不起假百炼,真连 realtime(要本机的 key 与业务空间 id,一次几分钱):看不到服务端那头的事,只验页面上看得见的——声音放了、孩子的字回来了、聊起来了、回看有字。
 */
import { execFileSync } from 'node:child_process';
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS, quiet } from './_quiet.mjs';

const keep = process.argv.includes('--keep');
const outAt = process.argv.indexOf('--out');
const out = outAt > 0 ? process.argv[outAt + 1] : null;
if (out) mkdirSync(out, { recursive: true });
const real = process.argv.includes('--real');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8798;
const cdp = 9341;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const tmp = probeDir('cotutor-probe-talk-');
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
const pageStats = (evaluate) => evaluate(`({ played: window.__played, gum: window.__gum, chunks: window.__chunks, sentBin: window.__sentBin, sentText: window.__sentText.slice(-5), hint: document.querySelector('#k-hint').textContent, rd: document.querySelector('#k-rd').className, sr: (window.__ctxRate || null) })`);

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
  const shot = async (name) => { if (!out) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64')); };
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
  await send('Page.navigate', { url: `${base}/parent/talk` });
  ok('首页:开着,有拍照与「不拍,自己填」', await until(`document.querySelector('#home').classList.contains('on') && document.querySelector('#h-off').hidden && document.querySelector('#h-blank')`));
  await click('#h-blank');
  ok('开一次 → 口语单页', await until(`document.querySelector('#list').classList.contains('on') && location.hash.startsWith('#/list/')`));
  await click('#l-addw');
  await evaluate(`(() => { const r = document.querySelector('#l-words .row'); const [en, zh] = r.querySelectorAll('input'); en.value = 'red'; en.dispatchEvent(new Event('input')); zh.value = '红色'; zh.dispatchEvent(new Event('input')); return true; })()`);
  await click('#l-adds');
  await evaluate(`(() => { const r = document.querySelector('#l-sents .row'); const [en, zh] = r.querySelectorAll('input'); en.value = 'It is a red car.'; en.dispatchEvent(new Event('input')); zh.value = '这是一辆红色的车。'; zh.dispatchEvent(new Event('input')); return true; })()`);
  await click('#l-go');
  ok('给孩子 → 孩子页,写着先跟读 2 句', await until(`document.querySelector('#kid').classList.contains('on') && document.querySelector('#k-start-hint').textContent.includes('2 句')`));
  ok('孩子页挂在英语老师下(《首页设计.md》拍板 27):左上角「‹ 头像」胶囊、开始屏是他的头像和名字、开始键是他的学科色', await until(`(() => { const b = document.querySelector('#back'); return !!b && !b.hidden && !!b.querySelector('.tfav .face') && b.getBoundingClientRect().left < 30 && !!document.querySelector('#k-sav.tfav') && document.querySelector('#k-sname').textContent === '英语老师' && getComputedStyle(document.querySelector('#k-go')).backgroundColor === 'rgb(31, 138, 76)' && !document.querySelector('#k-back'); })()`));
  await shot('talk-01-start');
  const id = await evaluate(`location.hash.split('/')[2]`);
  const meta = await (await fetch(`${base}/api/talk/${id}`)).json();
  ok('口语单存上了(ready,家长填的)', meta.meta.status === 'ready' && meta.meta.listBy === 'parent' && meta.meta.list.words[0].en === 'red', JSON.stringify(meta.meta.list));

  // ---- 孩子:开始 → 跟我读(不用按,《口语课设计.md》§8.1):假麦克风一直在念,老师放完就听、静了算读完、自己往下走 ----
  const heardRe = real ? /\S/ : /It's a red car\./;
  const sawKid = (sel) => evaluate(`(() => { const t = document.querySelector(${JSON.stringify(sel)}).textContent; return t.includes('你说的') ? t.replace('你说的:', '') : ''; })()`);
  await click('#k-go');
  ok('开始:麦克风开了、接上了、第一句 red 在卡上、老师的声音排进去放了', await untilFn(async () => (await evaluate(`window.__gum > 0 && !document.querySelector('#k-read').hidden && document.querySelector('#k-card').dataset.en === 'red' && window.__played > 0`)) && (real || (fake.conns.length === 1 && fake.conns[0].items.length >= 1)), 60), JSON.stringify(real ? await pageStats(evaluate) : { conns: fake.conns.length, items: fake.conns[0]?.items.map((i) => i.content[0].text) }));
  const c1 = fake.conns[0];
  if (!real) ok('跟读的会话:手动轮次(开口 / 停由服务端按响度判),人设带 Ray 和 red', c1.session?.turn_detection === null && String(c1.session?.instructions).includes('Ray') && String(c1.session?.instructions).includes('red(红色)'));
  ok('第 1 句是词:单词卡的四线三格(舞台那么大),没有中文', await evaluate(`!!document.querySelector('#k-card.c-word .wg svg .grid') && !document.querySelector('#k-card').textContent.includes('红色')`));
  ok('页面上没有「按住」', await evaluate(`!document.querySelector('#k-hold') && !document.querySelector('#kid').textContent.includes('按住')`));
  ok('老师放完:状态条轮到孩子', await until(`/listen|speech|heard/.test(document.querySelector('#k-rd').className)`, 60), await evaluate(`document.querySelector('#k-rd').className + ' ' + document.querySelector('#k-rd').textContent`));
  ok('什么都不按:孩子读的推上去、静了 commit、转写回来、自动到第 2 句', await untilFn(async () => (real || c1.commits >= 1) && (await evaluate(`document.querySelector('#k-card').dataset.en === 'It is a red car.' && !!document.querySelector('#k-dots i.done')`)), 120), JSON.stringify(real ? await pageStats(evaluate) : { commits: c1.commits, audio: c1.audio, items: c1.items.map((i) => i.content[0].text) }));
  ok('第 2 句是句子:点读卡的一行,带中文', await evaluate(`!!document.querySelector('#k-card .c-read .rd') && document.querySelector('#k-card').textContent.includes('这是一辆红色的车')`));
  if (!real) ok('读到了 → 老师接一两个词 + 下一句,一次回答', c1.items.some((i) => i.content[0].text === "孩子读了「It's a red car.」。先用一两个词接,再读下一句:It is a red car."));
  await click('#k-again');
  if (!real) ok('点「再听一遍」→ 再读一遍的 cue', await untilFn(async () => c1.items.some((i) => i.content[0].text === '再读一遍这句:It is a red car.')));

  // ---- 读完开聊 ----
  const played1 = await evaluate(`window.__played`);
  ok('第 2 句也自己读完 → 老师说要聊了 → 深色聊天页、倒计时、第二条会话(semantic_vad)、开聊 cue', await untilFn(async () => (real || (fake.conns.length === 2 && fake.conns[1].items.length >= 1)) && (await evaluate(`document.querySelector('#kid').classList.contains('chat') && !document.querySelector('#k-chat').hidden && document.querySelector('#k-chip').textContent.includes('还有')`)), 120), JSON.stringify(real ? {} : { conns: fake.conns.length, td: fake.conns[1]?.session?.turn_detection?.type, items: c1.items.map((i) => i.content[0].text) }));
  const c2 = fake.conns[1];
  ok('打电话:不是深色屏;底下一排单词卡(口语单上的词,四线三格 + 「听」);老师讲到 red → 那张亮', await until(`getComputedStyle(document.querySelector('#kid')).backgroundColor !== 'rgb(43, 58, 74)' && document.querySelectorAll('#k-words .c-word').length === 1 && !!document.querySelector('#k-words .c-word .wg svg') && !!document.querySelector('#k-words .c-word .rc-pl') && !!document.querySelector('#k-words .c-word.now')`, 60), await evaluate(`document.querySelector('#k-words').outerHTML.slice(0, 200)`));
  await shot('talk-02-call');
  ok('老师开聊的声音放了、字在屏上', await untilFn(async () => (await evaluate(`window.__played > ${played1} && /\\S/.test(document.querySelector('#k-tt').textContent)` + (real ? '' : ` && document.querySelector('#k-tt').textContent.includes("It's a red car.")`))), 60), `「${await evaluate(`document.querySelector('#k-tt').textContent`)}」`);
  // 假麦克风一直有声:老师放完,孩子的声音才推(interrupt=false);有声 → speech_started;留白 → 转写、老师接
  ok('聊:孩子的声音推上去了(老师放完才推),转写回来、老师接了', await untilFn(async () => (real || (c2.audio > 0 && c2.creates >= 2)) && heardRe.test(await sawKid('#k-heard2')), 100), JSON.stringify(real ? { kid: await sawKid('#k-heard2'), tutor: await evaluate(`document.querySelector('#k-tt').textContent`) } : { audio: c2.audio, creates: c2.creates, cancels: c2.cancels }));

  // ---- 挂断 → 回看 ----
  await click('#k-hang');
  ok('挂断 → 回看页:聊过、分两段、有老师和孩子的话、有两段声音', await until(`document.querySelector('#review').classList.contains('on') && document.querySelectorAll('#r-lines .ln.tutor').length > 0 && document.querySelectorAll('#r-lines .ln.kid').length > 0 && document.querySelectorAll('#r-lines .ph').length === 2 && document.querySelectorAll('#r-play audio').length === 2`), 40);
  ok('回看页是家长的:胶囊收起', await evaluate(`document.querySelector('#back').hidden`));
  const after = await (await fetch(`${base}/api/talk/${id}`)).json();
  ok('落盘:done、why bye、用到的词', after.meta.status === 'done' && after.transcript.why === 'bye' && after.hasKidAudio && after.hasTutorAudio && (real || after.transcript.used.words[0].kid >= 1), JSON.stringify({ why: after.transcript?.why, used: after.transcript?.used, usage: after.transcript?.usage }));
  if (real) console.log('老师说过的:\n' + after.transcript.lines.filter((l) => l.who === 'tutor').map((l) => '  ' + l.text).join('\n') + '\n孩子转写:\n' + after.transcript.lines.filter((l) => l.who === 'kid').map((l) => '  ' + l.text).join('\n'));
  if (!real) ok('两条 realtime 会话都关了', c1.closed && c2.closed);

  // ---- 家长:看录像(《口语课设计.md》§8.3:录下的消息喂回孩子那一屏,声音是 call.wav) ----
  ok('回看页有「看录像」', await until(`!!document.querySelector('#r-reel')`));
  await click('#r-reel');
  ok('录像外壳:上半是孩子那一屏(/talk?reel=)、下半录像栏', await until(`location.pathname === '/parent/talk/reel' && !!document.querySelector('#rl-frame') && document.querySelector('#rl-frame').src.includes('/talk?reel=') && !!(document.querySelector('#rl-frame').contentWindow || {}).cotutorReel`, 60));
  const inF = (expr) => evaluate(`(() => { const w = document.querySelector('#rl-frame').contentWindow; const d = w.document; return (${expr}); })()`);
  ok('一进来停在最后一帧:打电话那一屏、单词卡在、章 3 个(跟我读两句 + 打电话)、不放', await inF(`!d.querySelector('#k-chat').hidden && d.querySelectorAll('#k-words .c-word').length === 1 && w.cotutorReel.chapters().length === 3 && !w.cotutorReel.get().playing`), await inF(`JSON.stringify({ chat: !d.querySelector('#k-chat').hidden, words: d.querySelectorAll('#k-words .c-word').length, ch: w.cotutorReel.chapters().map((c) => c.title) })`));
  const ev = await inF(`JSON.stringify(w.cotutorReel.events().map((e) => e.chip + ':' + e.text))`);
  ok('经过:老师说的、孩子读的、点的「再听一遍」、讲到 red、换到打电话、挂断', ['读:', '点:点了「再听一遍」', '卡:讲到 red', '打电话:跟我读完了', '挂断:'].every((x) => ev.includes(x)), ev.slice(0, 300));
  const t1 = await inF(`w.cotutorReel.chapters()[0].p + 300`);
  ok('拖回开头:跟我读第一句,单词卡 red', await inF(`(w.cotutorReel.seekAt(${t1}), !d.querySelector('#k-read').hidden && d.querySelector('#k-card').dataset.en === 'red' && d.querySelector('#k-chat').hidden)`), await inF(`JSON.stringify({ read: !d.querySelector('#k-read').hidden, en: d.querySelector('#k-card').dataset.en })`));
  await click('#rl-play');
  ok('点播放:声音是 call.wav、在走,进度往前', await untilFn(async () => evaluate(`!!window.__cotutorAudio && window.__cotutorAudio.src.includes('/audio/call') && document.querySelector('#rl-frame').contentWindow.cotutorReel.get().playing`), 20), await evaluate(`JSON.stringify({ src: window.__cotutorAudio && window.__cotutorAudio.src, paused: window.__cotutorAudio && window.__cotutorAudio.paused })`));
  const callWav = await fetch(`${base}/api/talk/${id}/audio/call`);
  ok('call.wav 拿得到', callWav.ok && (callWav.headers.get('content-type') || '').includes('audio/wav'));
  // 家长端记录:口语课那一行点进去就是录像(《家长录像设计.md》拍板 19)
  await send('Page.navigate', { url: `${base}/parent` });
  const row = `a.tr-x[href="/parent/talk/reel?id=${id}"]`;
  ok('记录里口语课那一行连到录像', await until(`!!document.querySelector(${JSON.stringify(row)})`, 60), await evaluate(`[...document.querySelectorAll('a.tr-x')].map((a) => a.getAttribute('href')).join(' ')`));
  await click(row);
  ok('点进去是录像,停在最后一帧', await until(`location.pathname === '/parent/talk/reel' && !!(document.querySelector('#rl-frame') || {}).contentWindow?.cotutorReel?.get()`, 60));
  // 没有录像的老记录(10 月 14 日以前打的):换到回看页
  rmSync(join(wsRoot, 'talk', id, 'reel.json'));
  await send('Page.navigate', { url: `${base}/parent/talk/reel?id=${id}` });
  ok('没有录像的老记录:换到回看页', await until(`location.pathname === '/parent/talk' && location.hash === '#/review/${id}' && document.querySelector('#review').classList.contains('on') && !document.querySelector('#r-reel')`, 40), await evaluate(`location.href`));
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  fake.close();
  if (!keep) { serve.kill(); await sleep(300); try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
  else { serve.unref(); console.log(`serve 留着:${base}/parent/talk  workspace ${wsRoot}`); }
}
process.exit(bad ? 1 : 0);
