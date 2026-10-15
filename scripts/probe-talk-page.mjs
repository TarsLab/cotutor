#!/usr/bin/env node
/**
 * 口语课页面(孩子端 /talk,《口语课设计.md》拍板 12)的手动验收,不花钱:真 serve(临时 workspace,talk.enabled)+ 假 realtime(tests/_fake-realtime.ts,COTUTOR_TALK_ENDPOINT 指过去)
 * + 假的读口语单(COTUTOR_TALK_FAKE_LIST)+ 无头 Chrome(假麦克风放 say 念的一句英文)。走一遍:拍照屏 → 相册选一张 → 老师在看 → 口语单(改字、补、删)→ 开始跟读 → 跟我读(什么都不按)→ 聊 → 挂断回首页 → 家长看录像 → 接着上。
 * 逐项:页面连上、第一句 cue、跟我读不用按(老师放完就听、静了算读完、自己往下走)、老师的声音排进 AudioContext、再听一遍、开聊(第二条会话)、聊里孩子出声老师被掐、挂断后回看有字。
 * 用法:node scripts/probe-talk-page.mjs [--keep] [--real] [--out <截图目录>]
 *   --real 不起假百炼、不用假的读口语单与提示卡,全真连(要本机的 key 与业务空间 id,一次几毛钱):照片是现画的一页印刷体课本(Unit 3 Colours:red、It is a red car.),
 *          omni 真读;读出来的多余项在页面上 × 掉,剩 red 和那一句再往下走;看不到服务端那头的事,只验页面上看得见的与落盘的(老师说的、孩子转写、提示卡)。
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
const serveEnv = real ? { ...process.env, COTUTOR_WORKSPACE: wsRoot } : { ...process.env, COTUTOR_TALK_ENDPOINT: fake.endpoint, DASHSCOPE_API_KEY: 'sk-probe', COTUTOR_WORKSPACE: wsRoot, COTUTOR_TALK_FAKE_LIST: '1' };
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

  // ---- 孩子:拍照屏(同拍照听写的骨架)→ 相册选一张 → 老师在看 → 口语单 ----
  await send('Page.navigate', { url: `${base}/talk?tutor=english-tutor` });
  ok('拍照屏:英语老师的大头像、对话气泡「Hi」与「口语课」、拍照 / 相册,没有上次的就没有「接着上」', await until(`document.querySelector('#snap').classList.contains('on') && !!document.querySelector('#snap-av .tfav') && document.querySelector('.pg.talk i')?.textContent === 'Hi' && document.querySelector('.snap-ttl h1').textContent === '口语课' && !!document.querySelector('#p-cam') && !!document.querySelector('#p-lib') && document.querySelector('#snap-resume').hidden`));
  await shot('talk-00-snap');
  const doc = await send('DOM.getDocument', {});
  const pngAt = join(tmp, 'page.png');
  if (real) {
    // 真读:现画一页印刷体课本,截下来当照片(另开一个标签页画,不动这一页)
    const tab = await (await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
    const tws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => { tws.onopen = r; });
    let tseq = 0; const tp = new Map(); tws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && tp.has(m.id)) { tp.get(m.id)(m); tp.delete(m.id); } };
    const tsend = (method, params = {}) => new Promise((r) => { const i = ++tseq; tp.set(i, r); tws.send(JSON.stringify({ id: i, method, params })); });
    const page = '<body style="margin:0;background:#fdfcf7;font-family:Helvetica,Arial,sans-serif;color:#222"><div style="width:900px;height:1200px;padding:70px;box-sizing:border-box"><div style="font-size:30px;color:#c0392b;font-weight:bold">Unit 3</div><div style="font-size:64px;font-weight:bold;margin:10px 0 60px">Colours</div><div style="display:flex;align-items:center;gap:40px;margin-bottom:70px"><div style="width:180px;height:180px;border-radius:90px;background:#d9443a"></div><div style="font-size:80px;font-weight:bold">red</div></div><div style="font-size:52px">It is a red car.</div><div style="margin-top:420px;text-align:center;font-size:24px;color:#999">18</div></div></body>';
    await tsend('Emulation.setDeviceMetricsOverride', { width: 900, height: 1200, deviceScaleFactor: 1, mobile: false });
    await tsend('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(page) }); await sleep(800);
    writeFileSync(pngAt, Buffer.from((await tsend('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
    tws.close(); await fetch(`http://127.0.0.1:${cdp}/json/close/${tab.id}`);
  } else writeFileSync(pngAt, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const lib = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#p-lib' });
  await send('DOM.setFileInputFiles', { nodeId: lib.result.nodeId, files: [pngAt] });
  ok('选了照片:照片放左边,右边「老师在看这一页…」、浅灰占位、开始跟读点不了', await until(`document.querySelector('#pick').classList.contains('on') && document.querySelector('#p-title').textContent.includes('老师在看') && document.querySelectorAll('#p-words .tk-sk').length === 4 && document.querySelector('#p-go').disabled`, 20));
  if (real) {
    // 真读:等 omni 读完(最长 40 秒),读出来的照印出来;red 与那一句要在,多余的 × 掉
    const readOk = await until(`document.querySelector('#p-title').textContent === '今天的口语单'`, 200);
    const got = await evaluate(`JSON.stringify({ words: [...document.querySelectorAll('#p-words .tk-it')].map((x) => x.textContent), sents: [...document.querySelectorAll('#p-sents .tk-it')].map((x) => x.textContent), sub: document.querySelector('#p-sub').textContent, hash: location.hash })`);
    const lm = (await (await fetch(`${base}/api/talk/${(JSON.parse(got).hash.split('/')[2] || '')}`)).json()).meta || {};
    console.log('  omni 读出来的:' + JSON.stringify(lm.list) + '  用了 ' + lm.listMs + ' 毫秒' + (lm.listError ? '  错:' + lm.listError : ''));
    ok('真读:omni 读完了,有 red、有 It is a red car.', readOk && (lm.list?.words || []).some((w) => w.en.toLowerCase() === 'red') && (lm.list?.sentences || []).some((x) => /red car/i.test(x.en)), got);
    for (let i = 0; i < 12; i++) {
      const sel = await evaluate(`(() => { const ws = [...document.querySelectorAll('#p-words .tk-it')]; const w = ws.findIndex((x) => x.querySelector('.en').textContent.toLowerCase() !== 'red'); if (w >= 0) return '#p-words .tk-it:nth-child(' + (w + 1) + ') .x'; const ss = [...document.querySelectorAll('#p-sents .tk-it')]; const k = ss.findIndex((x, j) => !/red car/i.test(x.querySelector('.en').textContent) || j > ss.findIndex((y) => /red car/i.test(y.querySelector('.en').textContent))); return k >= 0 ? '#p-sents .tk-it:nth-child(' + (k + 1) + ') .x' : null; })()`);
      if (!sel) break;
      await click(sel); await sleep(150);
    }
  }
  ok('读完原地填上:red(带 emoji、中文)与一句,地址换成 #/list/<id>', await until(`document.querySelector('#p-title').textContent === '今天的口语单' && document.querySelectorAll('#p-words .tk-it').length === 1 && document.querySelector('#p-words .tk-it .en').textContent === 'red' && document.querySelectorAll('#p-sents .tk-it').length === 1 && /^#\\/list\\/[^/]+$/.test(location.hash)`, 40));
  ok('开始跟读 · 2 个', await evaluate(`!document.querySelector('#p-go').disabled && document.querySelector('#p-go').textContent === '开始跟读 · 2 个'`));
  await shot('talk-01-list');
  // 孩子能改字(拍板 12):补一个 blue,再 × 掉;点 red 改中文
  await click('#p-addw');
  ok('补一个单词:新的一格是输入框,光标在里面', await until(`document.querySelectorAll('#p-words .tk-it').length === 2 && document.activeElement && document.activeElement.classList.contains('en')`));
  await evaluate(`(() => { const i = document.activeElement; i.value = 'blue'; i.dispatchEvent(new Event('input')); return true; })()`);
  await click('#p-words .tk-it.ed .x');
  ok('改好了:blue 进来,开始跟读 · 3 个', await until(`[...document.querySelectorAll('#p-words .tk-it .en')].map((x) => x.textContent).join() === 'red,blue' && document.querySelector('#p-go').textContent === '开始跟读 · 3 个'`));
  await click('#p-words .tk-it:nth-child(2) .x');
  ok('× 去掉 blue:又是 2 个', await until(`document.querySelectorAll('#p-words .tk-it').length === 1 && document.querySelector('#p-go').textContent === '开始跟读 · 2 个'`));
  await click('#p-words .tk-it .tx');
  await evaluate(`(() => { const z = document.querySelector('#p-words .tk-it.ed input.zh'); z.value = '红'; z.dispatchEvent(new Event('input')); return true; })()`);
  await click('#p-words .tk-it.ed .x');
  ok('点 red 改中文成「红」', await until(`document.querySelector('#p-words .tk-it .zh').textContent === '红'`));
  await click('#p-go');
  ok('开始跟读:不过开始屏,直接到跟读那一屏;胶囊挂英语老师、头像是他', await until(`document.querySelector('#kid').classList.contains('on') && document.querySelector('#k-start').hidden && /^#\\/kid\\//.test(location.hash) && (() => { const b = document.querySelector('#back'); return !!b && !b.hidden && !!b.querySelector('.tfav .face'); })()`, 40));
  const id = await evaluate(`location.hash.split('/')[2]`);
  const meta = await (await fetch(`${base}/api/talk/${id}`)).json();
  ok('口语单存上了(ready,孩子改过的:red 的中文是「红」,没有 blue;emoji 留着)', meta.meta.listBy === 'parent' && meta.meta.list.words.length === 1 && meta.meta.list.words[0].zh === '红' && (real ? Boolean(meta.meta.list.words[0].emoji) : meta.meta.list.words[0].emoji === '🔴'), JSON.stringify(meta.meta.list));
  const sent = meta.meta.list.sentences[0];

  // ---- 孩子:跟我读(开始跟读那一下就开麦接上;不用按,《口语课设计.md》§8.1):假麦克风一直在念,老师放完就听、静了算读完、自己往下走 ----
  const heardRe = real ? /\S/ : /It's a red car\./;
  const sawKid = (sel) => evaluate(`(() => { const t = document.querySelector(${JSON.stringify(sel)}).textContent; return t.includes('你说的') ? t.replace('你说的:', '') : ''; })()`);
  ok('开始:麦克风开了、接上了、第一句 red 在卡上、老师的声音排进去放了', await untilFn(async () => (await evaluate(`window.__gum > 0 && !document.querySelector('#k-read').hidden && document.querySelector('#k-card').dataset.en === 'red' && window.__played > 0`)) && (real || (fake.conns.length === 1 && fake.conns[0].items.length >= 1)), 60), JSON.stringify(real ? await pageStats(evaluate) : { conns: fake.conns.length, items: fake.conns[0]?.items.map((i) => i.content[0].text) }));
  const c1 = fake.conns[0];
  if (!real) ok('跟读的会话:手动轮次(开口 / 停由服务端按响度判),人设带 Ray 和 red', c1.session?.turn_detection === null && String(c1.session?.instructions).includes('Ray') && String(c1.session?.instructions).includes('red(红)'));
  ok('第 1 句是词:单词卡的四线三格(舞台那么大),没有中文', await evaluate(`!!document.querySelector('#k-card.c-word .wg svg .grid') && !document.querySelector('#k-card').textContent.includes('红色')`));
  ok('页面上没有「按住」', await evaluate(`!document.querySelector('#k-hold') && !document.querySelector('#kid').textContent.includes('按住')`));
  ok('老师放完:状态条轮到孩子', await until(`/listen|speech|heard/.test(document.querySelector('#k-rd').className)`, 60), await evaluate(`document.querySelector('#k-rd').className + ' ' + document.querySelector('#k-rd').textContent`));
  ok('什么都不按:孩子读的推上去、静了 commit、转写回来、自动到第 2 句', await untilFn(async () => (real || c1.commits >= 1) && (await evaluate(`document.querySelector('#k-card').dataset.en === ${JSON.stringify(sent.en)} && !!document.querySelector('#k-dots i.done')`)), 120), JSON.stringify(real ? await pageStats(evaluate) : { commits: c1.commits, audio: c1.audio, items: c1.items.map((i) => i.content[0].text) }));
  ok('第 2 句是句子:点读卡的一行,带中文', await evaluate(`!!document.querySelector('#k-card .c-read .rd') && document.querySelector('#k-card').textContent.includes(${JSON.stringify(sent.zh)})`));
  if (!real) ok('读到了 → 老师接一两个词 + 下一句,一次回答', c1.items.some((i) => i.content[0].text === "孩子读了「It's a red car.」。先用一两个词接,再读下一个,这句:It is a red car."));
  await click('#k-again');
  if (!real) ok('点「再听一遍」→ 再读一遍的 cue', await untilFn(async () => c1.items.some((i) => i.content[0].text === '再读一遍这句:It is a red car.')));

  // ---- 读完开聊 ----
  const played1 = await evaluate(`window.__played`);
  ok('第 2 句也自己读完 → 老师说要聊了 → 打电话页、右上角只写「打电话」(不显示剩下几分钟)、第二条会话(semantic_vad)、开聊 cue', await untilFn(async () => (real || (fake.conns.length === 2 && fake.conns[1].items.length >= 1)) && (await evaluate(`document.querySelector('#kid').classList.contains('chat') && !document.querySelector('#k-chat').hidden && document.querySelector('#k-chip').textContent === '打电话'`)), 120), JSON.stringify(real ? {} : { conns: fake.conns.length, td: fake.conns[1]?.session?.turn_detection?.type, items: c1.items.map((i) => i.content[0].text) }));
  const c2 = fake.conns[1];
  ok('打电话:不是深色屏;底下一排单词卡(口语单上的词,四线三格 + 「听」);老师讲到 red → 那张亮', await until(`getComputedStyle(document.querySelector('#kid')).backgroundColor !== 'rgb(43, 58, 74)' && document.querySelectorAll('#k-words .c-word').length === 1 && !!document.querySelector('#k-words .c-word .wg svg') && !!document.querySelector('#k-words .c-word .rc-pl') && !!document.querySelector('#k-words .c-word.now')`, 60), await evaluate(`document.querySelector('#k-words').outerHTML.slice(0, 200)`));
  await shot('talk-02-call');
  ok('老师开聊的声音放了、字在屏上', await untilFn(async () => (await evaluate(`window.__played > ${played1} && /\\S/.test(document.querySelector('#k-tt').textContent)` + (real ? '' : ` && document.querySelector('#k-tt').textContent.includes("It's a red car.")`))), 60), `「${await evaluate(`document.querySelector('#k-tt').textContent`)}」`);
  // 假麦克风一直有声:老师放完,孩子的声音才推(interrupt=false);有声 → speech_started;留白 → 转写、老师接
  ok('聊:孩子的声音推上去了(老师放完才推),转写回来、老师接了', await untilFn(async () => (real || (c2.audio > 0 && c2.creates >= 2)) && heardRe.test(await sawKid('#k-heard2')), 100), JSON.stringify(real ? { kid: await sawKid('#k-heard2'), tutor: await evaluate(`document.querySelector('#k-tt').textContent`) } : { audio: c2.audio, creates: c2.creates, cancels: c2.cancels }));

  // ---- 挂断 → 回看 ----
  // ---- 提示卡(拍板 16):老师说完一句,小灯泡「不知道怎么说?」出来;点了是正面中文,点一下翻过来英文句型带空,点词填进去 ----
  // 真连时假麦克风一直念同一句,老师多半只回「Nice!」不再提问(不是问话不出卡,对的);等不到小灯泡就以落盘里发过的卡为准
  const bulb = await until(`!document.querySelector('#k-bulb').hidden`, real ? 120 : 60);
  if (real && !bulb) console.log('  (这一段老师没再提问,小灯泡没出来;提示卡看下面落盘的)');
  else {
    ok('老师说完一句:小灯泡出来了', bulb);
    // 老师接下一句时卡会收起(拍板 16),点到一半收了就等下一张再来,最多三次
    const tap = async (sel) => { const at = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); if (!at) return false; await mouse('mousePressed', at); await mouse('mouseReleased', at); return true; };
    let front = null, back = null, filled = null;
    for (let k = 0; k < 3; k++) {
      if (!(await until(`!document.querySelector('#k-bulb').hidden`, 60))) break;
      if (!(await tap('#k-bulb'))) continue;
      front = await evaluate(`(() => { const c = document.querySelector('#k-hc'); return !c.hidden && c.querySelector('.fr b') ? c.querySelector('.fr b').textContent : null; })()`);
      if (!front || !(await tap('#k-hc .fr'))) continue;
      back = await evaluate(`(() => { const c = document.querySelector('#k-hc'); return c.hidden || !c.querySelector('.pat') ? null : { pat: c.querySelector('.pat').textContent, ops: [...c.querySelectorAll('.op')].map((x) => x.textContent) }; })()`);
      if (!back) continue;
      if (back.ops.length && !(await tap('#k-hc .op'))) continue;
      filled = await evaluate(`(() => { const b = document.querySelector('#k-hc .bl'); return b ? b.textContent : null; })()`);
      if (!back.ops.length || filled) break;
    }
    await sleep(400); await shot('talk-02b-hint');
    const fits = await evaluate(`(() => { const top = document.querySelector('#k-tt').getBoundingClientRect().top, bot = document.querySelector('#k-call').getBoundingClientRect().bottom; return { ok: top >= 0 && bot <= innerHeight, top, bot, h: innerHeight }; })()`);
    ok('卡出来了一屏放得下:字幕没被顶出去、底部条在屏里(矮屏头像收起)', fits.ok, JSON.stringify(fits));
    if (real) ok('真的提示卡:点小灯泡 → 正面中文;翻过来是英文;有空就能填词', Boolean(front) && back && /[a-z]/i.test(back.pat) && (!back.ops.length || Boolean(filled && filled.trim())), JSON.stringify({ front, back, filled }));
    else ok('点小灯泡 → 正面中文;点一下 → 英文句型带空、能填 red;点 red 填进空里', front === '说一说:它是什么颜色的?' && back && back.pat.startsWith("It's") && back.ops.join() === '🔴red' && filled === 'red', JSON.stringify({ front, back, filled }));
  }
  await click('#k-hang');
  ok('挂断 → 回首页(回放在家长端的记录里)', await until(`location.pathname === '/'`, 40), await evaluate(`location.href`));
  for (let i = 0; i < 30 && !(await (await fetch(`${base}/api/talk/${id}`)).json()).transcript; i++) await sleep(300);
  const after = await (await fetch(`${base}/api/talk/${id}`)).json();
  ok('落盘:done、why bye、用到的词', after.meta.status === 'done' && after.transcript.why === 'bye' && after.hasKidAudio && after.hasTutorAudio && (real || after.transcript.used.words[0].kid >= 1), JSON.stringify({ why: after.transcript?.why, used: after.transcript?.used, usage: after.transcript?.usage }));
  if (real) console.log('老师说过的:\n' + after.transcript.lines.filter((l) => l.who === 'tutor').map((l) => '  [' + l.phase + '] ' + l.text).join('\n') + '\n孩子转写:\n' + after.transcript.lines.filter((l) => l.who === 'kid').map((l) => '  [' + l.phase + '] ' + l.text).join('\n'));
  if (real) {
    const reel = JSON.parse(readFileSync(join(wsRoot, 'talk', id, 'reel.json'), 'utf8'));
    const hs = reel.msgs.filter((m) => m[1] === 'o' && m[2].t === 'hint').map((m) => m[2]);
    console.log('提示卡(真的):\n' + hs.map((x) => '  [' + x.by + '] ' + x.zh + '  ' + x.en + (x.opts.length ? '  [' + x.opts.join(', ') + ']' : '')).join('\n'));
    ok('真的提示卡:聊那段发过,至少一张是模型现出的', hs.length > 0 && hs.some((x) => x.by === 'model'), JSON.stringify(hs.map((x) => x.by)));
  }
  if (!real) ok('两条 realtime 会话都关了', c1.closed && c2.closed);

  // ---- 家长:看录像(《口语课设计.md》§8.3:录下的消息喂回孩子那一屏,声音是 call.wav) ----
  await send('Page.navigate', { url: `${base}/parent/talk/reel?id=${id}` });
  ok('录像外壳:上半是孩子那一屏(/talk?reel=)、下半录像栏', await until(`location.pathname === '/parent/talk/reel' && !!document.querySelector('#rl-frame') && document.querySelector('#rl-frame').src.includes('/talk?reel=') && !!(document.querySelector('#rl-frame').contentWindow || {}).cotutorReel`, 60));
  const inF = (expr) => evaluate(`(() => { const w = document.querySelector('#rl-frame').contentWindow; const d = w.document; return (${expr}); })()`);
  ok('一进来停在最后一帧:打电话那一屏、单词卡在、章 3 个(跟我读两句 + 打电话)、不放', await inF(`!d.querySelector('#k-chat').hidden && d.querySelectorAll('#k-words .c-word').length === 1 && w.cotutorReel.chapters().length === 3 && !w.cotutorReel.get().playing`), await inF(`JSON.stringify({ chat: !d.querySelector('#k-chat').hidden, words: d.querySelectorAll('#k-words .c-word').length, ch: w.cotutorReel.chapters().map((c) => c.title) })`));
  const ev = await inF(`JSON.stringify(w.cotutorReel.events().map((e) => e.chip + ':' + e.text))`);
  const want = real ? ['读:', '点:点了「再听一遍」', '打电话:跟我读完了', '挂断:'].concat(bulb ? ['提示:他点了「不知道怎么说?」'] : []) : ['读:', '点:点了「再听一遍」', '卡:讲到 red', '打电话:跟我读完了', '提示:他点了「不知道怎么说?」', '提示:翻过来看英文', '提示:填了 red', '挂断:'];
  ok('经过:老师说的、孩子读的、点的「再听一遍」、讲到 red、换到打电话、提示卡(点的、翻过来、填了 red)、挂断', want.every((x) => ev.includes(x)), ev.slice(0, 300));
  const t1 = await inF(`w.cotutorReel.chapters()[0].p + 300`);
  ok('拖回开头:跟我读第一句,单词卡 red', await inF(`(w.cotutorReel.seekAt(${t1}), !d.querySelector('#k-read').hidden && d.querySelector('#k-card').dataset.en === 'red' && d.querySelector('#k-chat').hidden)`), await inF(`JSON.stringify({ read: !d.querySelector('#k-read').hidden, en: d.querySelector('#k-card').dataset.en })`));
  await click('#rl-play');
  ok('点播放:声音是 call.wav、在走,进度往前', await untilFn(async () => evaluate(`!!window.__cotutorAudio && window.__cotutorAudio.src.includes('/audio/call') && document.querySelector('#rl-frame').contentWindow.cotutorReel.get().playing`), 20), await evaluate(`JSON.stringify({ src: window.__cotutorAudio && window.__cotutorAudio.src, paused: window.__cotutorAudio && window.__cotutorAudio.paused })`));
  const callWav = await fetch(`${base}/api/talk/${id}/audio/call`);
  ok('call.wav 拿得到', callWav.ok && (callWav.headers.get('content-type') || '').includes('audio/wav'));
  // 家长端记录:口语课那一行点进去就是录像(《家长录像设计.md》拍板 19)
  await send('Page.navigate', { url: `${base}/parent` });
  const row = `a.kid[href="/parent/talk/reel?id=${id}"]`;
  ok('记录里口语课那一行连到录像', await until(`!!document.querySelector(${JSON.stringify(row)})`, 60), await evaluate(`[...document.querySelectorAll('a.kid')].map((a) => a.getAttribute('href')).join(' ')`));
  await click(row);
  ok('点进去是录像,停在最后一帧', await until(`location.pathname === '/parent/talk/reel' && !!(document.querySelector('#rl-frame') || {}).contentWindow?.cotutorReel?.get()`, 60));
  // 没有录像的老记录(10 月 14 日以前打的):回看页随 /parent/talk 删了,外壳只说没有录像
  rmSync(join(wsRoot, 'talk', id, 'reel.json'));
  await send('Page.navigate', { url: `${base}/parent/talk/reel?id=${id}` });
  ok('没有录像的老记录:外壳说「这一次没有录像」', await until(`document.body.textContent.includes('这一次没有录像')`, 40), await evaluate(`location.href`));
  ok('/parent/talk 删了', (await fetch(`${base}/parent/talk`)).status === 404);

  // ---- 接着上(拍板 14):再进口语课,最上面是上次的口语单,点了直接开始 ----
  await send('Page.navigate', { url: `${base}/talk?tutor=english-tutor` });
  ok('再进口语课:「上次的口语单 · 几月几日拍的 · 1 个单词、1 句」,拍照让成白底', await until(`!document.querySelector('#snap-resume').hidden && /日拍的 · 1 个单词、1 句$/.test(document.querySelector('#snap-resume-sub').textContent) && document.querySelector('#snap-cam-btn').classList.contains('alt')`), await evaluate(`document.querySelector('#snap-resume-sub').textContent`));
  await shot('talk-03-resume');
  const conns0 = fake.conns.length;
  await click('#snap-resume-go');
  ok('点「接着上」:直接到跟读那一屏、接上了、第一句 red', await until(`document.querySelector('#kid').classList.contains('on') && !document.querySelector('#k-read').hidden && document.querySelector('#k-card').dataset.en === 'red'`, 60) && (real || fake.conns.length > conns0));
  await click('#k-hang');
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  fake.close();
  if (!keep) { serve.kill(); await sleep(300); try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
  else { serve.unref(); console.log(`serve 留着:${base}/talk  workspace ${wsRoot}`); }
}
process.exit(bad ? 1 : 0);
