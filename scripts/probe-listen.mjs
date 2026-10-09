#!/usr/bin/env node
/**
 * 按住说话交给 omni 听写(kid.listen: omni,2026-10-09)的手动验收:要本机 Chrome 与百炼 key(真问 qwen omni,一次不到一分钱)。
 * mock 带 --listen omni 起;Chrome 的假麦克风放一段中文录音(缺省用 macOS say 现念一句「鸡腿的英语怎么说」,--audio 换成别的 wav),
 * 语音识别换成页面加载前注入的假识别器(认出「嗯,腿的英语」)。逐项:
 *   有识别 → 发的是 omni 听的字,listened 两份都带;omni 没成 → 发浏览器的字、记 error;
 *   没有识别 → 照样能按住,只录不认,发 omni 的字;识别一起就断 → 这一下接着录,发 omni 的字;
 *   omni 没听出字、也没有识别 → 「没听清」,不发。
 * 用法:node scripts/probe-listen.mjs [--audio x.wav] [--keep]
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS, quiet } from './_quiet.mjs';

const keep = process.argv.includes('--keep');
const ai = process.argv.indexOf('--audio');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8797;
const cdp = 9339;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const tmp = mkdtempSync(join(tmpdir(), 'cotutor-probe-listen-'));
let wav = ai > 0 ? process.argv[ai + 1] : null;
if (!wav) {
  // 句子前后留白:假麦克风循环放,按住的那几秒里要有一整句
  execFileSync('say', ['-v', 'Tingting', '-o', join(tmp, 'say.aiff'), '[[slnc 600]] 鸡腿的英语怎么说 [[slnc 900]]']);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', join(tmp, 'say.aiff'), join(tmp, 'say.wav')]);
  wav = join(tmp, 'say.wav');
}

// 识别器按 sessionStorage 的 probe-sr 换:ok = start 后 300ms 认出「嗯,腿的英语」、stop 了才 end;dead = 一起就 aborted;none = 浏览器没有识别
// fetch 记下发出去的消息与听写;probe-listen-fail = 1 时 /api/kid/listen 回 502
const INJECT = `(() => {
  const mode = sessionStorage.getItem('probe-sr') || 'ok';
  class FakeSR {
    constructor() { this.ls = {}; }
    addEventListener(k, f) { (this.ls[k] ||= []).push(f); }
    fire(k) { for (const f of this.ls[k] || []) f({}); }
    start() {
      if (mode === 'dead') { setTimeout(() => { if (this.onerror) this.onerror({ error: 'aborted' }); if (this.onend) this.onend(); }, 15); return; }
      setTimeout(() => { this.fire('start'); this.fire('audiostart'); if (this.onresult) this.onresult({ results: [[{ transcript: '嗯,腿的英语' }]] }); }, 300);
    }
    stop() { setTimeout(() => { if (this.onend) this.onend(); }, 50); }
    abort() { setTimeout(() => { if (this.onend) this.onend(); }, 10); }
  }
  if (mode === 'none') { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; }
  else { window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR; }
  window.__sent = []; window.__listen = [];
  const f = window.fetch;
  window.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/messages') && init && init.body) window.__sent.push(JSON.parse(init.body));
    if (u.endsWith('/api/kid/listen')) {
      if (sessionStorage.getItem('probe-listen-fail') === '1') { window.__listen.push({ status: 502 }); return new Response(JSON.stringify({ error: 'http_401' }), { status: 502, headers: { 'content-type': 'application/json' } }); }
      const t0 = Date.now(); const r = await f(url, init); window.__listen.push({ status: r.status, ms: Date.now() - t0 }); return r;
    }
    return f(url, init);
  };
})();`;

try { await fetch(`${base}/api/health`); console.error(`端口 ${port} 上已经有东西(上次 --keep 留下的 mock?),先停掉`); process.exit(2); } catch {}
const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '0', '--listen', 'omni'], { stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
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
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
  let where = null;
  /** 换一种识别器 / 听写会不会失败,重开孩子端进语文老师 */
  const open = async (sr, fail = false) => {
    await send('Page.navigate', { url: `${base}/` });
    await sleep(300);
    await evaluate(`sessionStorage.clear(); sessionStorage.setItem('probe-sr', ${JSON.stringify(sr)}); sessionStorage.setItem('probe-listen-fail', ${fail ? "'1'" : "'0'"}); true`);
    await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor` });
    await until(`document.querySelector('#tutor') && document.querySelector('#tutor').classList.contains('on') && document.querySelectorAll('#board .sec').length > 0`);
    await sleep(600);
    where = await evaluate(`(() => { const r = document.querySelector('#mid').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  };
  const mouse = (type) => send('Input.dispatchMouseEvent', { type, x: where.x, y: where.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  /** 按住 ms 松手,等发出去(或等够 n 拍) */
  const hold = async (ms) => {
    await until(`!document.body.classList.contains('pending')`, 40);
    await sleep(800);
    const before = await evaluate(`window.__sent.length`);
    await mouse('mousePressed'); await sleep(ms); await mouse('mouseReleased');
    await until(`window.__sent.length > ${before}`, 48);
    return evaluate(`(() => { const x = window.__sent[${before}]; return x ? { text: x.text, listened: x.listened || null, voice: Boolean(x.voice), seconds: x.voice && x.voice.seconds, calls: window.__listen.slice() } : { calls: window.__listen.slice(), ph: document.querySelector('#ph').textContent }; })()`);
  };

  // ---- 有识别:发 omni 的字,两份都带 ----
  await open('ok');
  ok('首页接口给 listen: omni,输入条写着能按住说话', await evaluate(`document.querySelector('#ph').textContent.includes('按住说话')`));
  await hold(1500); // 第一次麦克风冷开,先热一下;这一句照样发
  const a = await hold(3500);
  ok('有识别:发出去的是 omni 听的字(不是浏览器的「嗯,腿的英语」),带原声', a.text && a.text !== '嗯,腿的英语' && a.listened && a.text === a.listened.omni && a.voice, JSON.stringify(a));
  ok('listened 两份:浏览器的、omni 的,模型与毫秒', a.listened && a.listened.browser === '嗯,腿的英语' && a.listened.model === 'qwen3.5-omni-flash' && a.listened.ms > 0, JSON.stringify(a.listened));
  ok('松手到发出去:听写一来一回在 3 秒内', a.calls.length && a.calls[a.calls.length - 1].ms < 3000, JSON.stringify(a.calls));

  // ---- omni 没成:退回浏览器的字 ----
  await open('ok', true);
  await hold(1500);
  const b = await hold(2500);
  ok('omni 没成:发浏览器认的字,listened 记 error', b.text === '嗯,腿的英语' && b.listened && b.listened.error && b.listened.omni === undefined, JSON.stringify(b));

  // ---- 没有识别:只录不认,照样发 ----
  await open('none');
  ok('没有识别也能按住说话(输入条照写)', await evaluate(`document.querySelector('#ph').textContent.includes('按住说话')`));
  await hold(1500);
  const c = await hold(3500);
  ok('没有识别:发 omni 的字,listened 没有浏览器那份', c.text && c.listened && c.listened.browser === undefined && c.text === c.listened.omni, JSON.stringify(c));

  // ---- 识别一起就断(iPad 主屏幕图标):这一下接着录 ----
  await open('dead');
  await hold(1500);
  const d = await hold(3500);
  ok('识别一起就断:不当成点了一下,接着录,发 omni 的字', d.text && d.listened && d.text === d.listened.omni, JSON.stringify(d));

  // ---- 没有识别、omni 也没成:没听清,不发 ----
  await open('none', true);
  await sleep(800);
  const before = await evaluate(`window.__sent.length`);
  await mouse('mousePressed'); await sleep(2000); await mouse('mouseReleased');
  await sleep(2500);
  const e = await evaluate(`({ n: window.__sent.length, ph: document.querySelector('#ph').textContent, calls: window.__listen.length })`);
  ok('没有识别、omni 没成:不发,输入条写「没听清」', e.n === before && e.calls > 0 && e.ph.includes('没听清'), JSON.stringify(e));
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  if (!keep) { mock.kill(); await sleep(300); try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
  else { mock.unref(); console.log(`mock 留着:${base}/`); }
}
process.exit(bad ? 1 : 0);
