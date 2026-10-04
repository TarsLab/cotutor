#!/usr/bin/env node
/**
 * 试用时只听得到老师的声(《备课设计.md》§十二;2026-10-04 真机三次听到浏览器的声)的手动验收(不进 pnpm test,要本机 Chrome 与 ffmpeg;老师是假 CLI,不花钱):
 * Chrome 开 --autoplay-policy=user-gesture-required(同 iPad Safari:页面上没点过就不让放声音),配音是 ffmpeg 现出的正弦 mp3(放得出来),
 * 页面里换掉 speechSynthesis 记下浏览器每次开口、记下播放器每次换的音源与被拒的 play()。
 * 对照:不点「开始试用」就念 → 浏览器开口(这套环境复现得出旧问题);正经一趟:点「开始试用」→ 课文件那节念完(中间点两次输入框)→
 * 交选择题、老师回的话在念时点输入框 → 打字发出去、再点输入框:浏览器一次都不开口,正在念的那句不被换成静音。
 *
 * 用法:node scripts/probe-tryout-voice.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8800, cdp = 9342, base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const home = mkdtempSync(join(tmpdir(), 'cotutor-voice-'));
const root = join(home, 'ws');
// 配音替身:ffmpeg 出一段 3 秒的正弦 mp3(假配音写的是几个字节,浏览器放不出来)
const sine = join(home, 'tts-sine.mjs');
writeFileSync(sine, [
  "import { execFileSync } from 'node:child_process';",
  'const a = process.argv.slice(2);',
  "if (a[0] === 'voices') { console.log(JSON.stringify({ command: 'voices', total: 1, matched: 1, voices: [{ voice: 'v-math', name: '假', gender: '女', age: 26, trait: 't', scene: 's', lang: '中文' }] })); process.exit(0); }",
  "const out = a[a.indexOf('-o') + 1];",
  "execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-q:a', '9', out]);",
  'console.log(JSON.stringify({ ok: true, file: out }));',
].join('\n'));
const run = (args) => new Promise((res, rej) => { const p = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), ...args], { env: { ...process.env, HOME: home, COTUTOR_WORKSPACE: '' }, stdio: 'pipe' }); p.on('exit', (c) => (c === 0 ? res() : rej(new Error('exit ' + c)))); });
await run(['init', 'probe', '--dir', root, '--name', '小探']);
const cfg = JSON.parse(readFileSync(join(root, 'cotutor.json'), 'utf8'));
const fake = join(repo, 'tests', '_fake-cli.ts');
cfg.runtimes.default = 'fake';
cfg.runtimes.fake = { run: [process.execPath, '--experimental-strip-types', '--no-warnings', fake, '--stream', '--agent', '{agent}', '{prompt}'], resume: [process.execPath, '--experimental-strip-types', '--no-warnings', fake, '--stream', '--agent', '{agent}', '--resume', '{session}', '{prompt}'] };
cfg.policyDefaults = { post: { mode: 'off' } };
cfg.server.port = port;
cfg.tts = { say: [process.execPath, sine, '{text}', '--voice', '{voice}', '--json', '-o', '{out}'], voices: [process.execPath, sine, 'voices', '--json'] };
cfg.tutors['math-tutor'].voice = 'v-math';
writeFileSync(join(root, 'cotutor.json'), JSON.stringify(cfg, null, 2));
mkdirSync(join(root, 'lessons'), { recursive: true });
writeFileSync(join(root, 'lessons', '试.md'), '---\ntutor: math-tutor\n---\n\n我们来分贴纸。\n\n```choice\n每人几张?\n- [ ] 3 张\n- [x] 6 张\n```\n\n平均分就是一样多。\n\n每人几张？你是怎么分的？\n');
const serve = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'serve', '--workspace', root, '--http'], { env: { ...process.env, HOME: home }, stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }
const tryOnce = async () => (await (await fetch(`${base}/api/lessons/${encodeURIComponent('试')}/try`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json());
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--autoplay-policy=user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(home, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`); };
try {
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const l = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = l.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  const ws = new WebSocket(wsUrl); await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const until = async (x, n = 80) => { for (let i = 0; i < n; i++) { if (await ev(x)) return true; await sleep(250); } return false; };
  const tap = async (sel) => { const b = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 }); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__srcs = []; window.__spoken = []; window.__rejects = [];
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { get() { return d.get.call(this); }, set(v) { window.__srcs.push(String(v).replace(/^.*\\/api\\/audio\\/[^/]+\\//, 'mp3:').slice(0, 40)); d.set.call(this, v); } });
    const p = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { const r = p.call(this); r.catch((e) => window.__rejects.push(e.name)); return r; };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak: (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 50); }, cancel() {} } });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, writable: true, value: function (t) { this.text = t; } });
  ` });
  const report = async (label) => { const r = await ev('({ srcs: window.__srcs, spoken: window.__spoken, rejects: window.__rejects })'); const after = r.srcs.slice(r.srcs.findIndex((x) => x.startsWith('mp3:'))); return { ...r, swapped: after.some((x) => x.startsWith('data:')) }; };

  // ---- 对照:不点「开始试用」直接让它念(旧的做法)——这套环境要能复现「退成浏览器的声」
  const t0 = await tryOnce();
  await send('Page.navigate', { url: base + t0.url });
  await until(`Boolean(document.querySelector('#trygo button'))`);
  await ev(`document.querySelector('#trygo button').click()`); // 脚本点,不算手势(同从家长端跳过来没人点过)
  await sleep(4000);
  const r0 = await report();
  ok('对照:没有真手势就念 → 浏览器开口了(这套环境复现得出旧问题)', r0.spoken.length > 0 && r0.rejects.includes('NotAllowedError'), JSON.stringify({ spoken: r0.spoken.slice(0, 2), rejects: r0.rejects }));

  // ---- 正经走一趟
  const t1 = await tryOnce();
  ok('试用接口:配完音才回', t1.dubbed === true);
  await send('Page.navigate', { url: base + t1.url });
  await until(`Boolean(document.querySelector('#trygo button'))`);
  await tap('#trygo button');
  await sleep(1500); await tap('#mid'); await sleep(2500); await tap('#mid');
  const waited = await until(`document.querySelector('#sub-btn') && !document.querySelector('#sub-btn').hidden`, 80);
  const r1 = await report();
  ok('一、课文件那节念完(中间点了两次输入框):浏览器没开口、没被换成静音、没有被拒', waited && !r1.spoken.length && !r1.swapped && !r1.rejects.some((x) => x !== 'AbortError'), JSON.stringify(r1));
  // 二、选一个交给老师,老师回的时候点输入框
  const opened = await until(`document.querySelector('#stage').classList.contains('on')`, 20);
  if (!opened) { await tap('#board .c-choice'); await until(`document.querySelector('#stage').classList.contains('on')`, 20); }
  await tap('#st-body .so:nth-of-type(2)');
  await sleep(300);
  await tap('#st-go');
  const replied = await until(`document.querySelectorAll('#board .sec').length >= 2`, 120);
  await sleep(1500); await tap('#mid'); await sleep(5000);
  const r2 = await report();
  ok('二、交了答案,老师回的话在念时点输入框:浏览器没开口、没被换成静音', replied && !r2.spoken.length && !r2.swapped && r2.srcs.filter((x) => x.startsWith('mp3:')).length >= 4, JSON.stringify({ n: r2.srcs.length, spoken: r2.spoken, rejects: r2.rejects }));
  // 三、打一句发出去,老师回的时候再点输入框
  await ev(`(() => { const t = document.querySelector('#typed'); t.value = '一张一张分'; document.querySelector('#go').click(); return true; })()`);
  const replied2 = await until(`document.querySelectorAll('#board .sec').length >= 3`, 120);
  await sleep(1500); await tap('#mid'); await sleep(6000);
  const r3 = await report();
  ok('三、打字发出去,老师回的话在念时点输入框:浏览器没开口、没被换成静音', replied2 && !r3.spoken.length && !r3.swapped, JSON.stringify({ srcs: r3.srcs, spoken: r3.spoken, rejects: r3.rejects }));
  ws.close();
} finally { browser.kill(); serve.kill(); await sleep(800); rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
console.log(bad ? `✗ ${bad} 项不过` : '全过');
if (bad) process.exitCode = 1;
