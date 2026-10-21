#!/usr/bin/env node
/**
 * 实时老师页在 Safari(WebKit)上的音频路径(《wip/实时老师开发计划.md》P2.6):常开那路麦克风接到 AudioWorklet 采 16k(makeAudio().use,不再开第二路)、
 * 推上去;嘴的 24k PCM 排进 AudioContext 放。本进程起服务(临时 workspace,语文老师开实时,老师是假 CLI,嘴是 tests/_fake-realtime.ts);
 * WebKit 没有假麦克风,页面加载前把 getUserMedia 换成一路振荡器的流,顺手数它被调了几次、worklet 出了几块、发了几块、排了几块声音。
 * 本仓不装 playwright:借一份 playwright-core 和它配套的 WebKit(见 probe-lecture-webkit.mjs)。
 * 用法:PLAYWRIGHT_CORE=<含 node_modules/playwright-core 的目录> node scripts/probe-live-webkit.mjs
 */
import { probeDir } from './_guard.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
if (!process.env.PLAYWRIGHT_CORE) { console.error('要 PLAYWRIGHT_CORE=<含 node_modules/playwright-core 的目录>'); process.exit(2); }
const { webkit } = require(process.env.PLAYWRIGHT_CORE + '/node_modules/playwright-core');
const repo = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import(join(repo, 'src', 'cli', 'init.ts'));
const { loadWorkspace } = await import(join(repo, 'src', 'cli', 'workspace.ts'));
const { createContext, createHandler } = await import(join(repo, 'src', 'server', 'app.ts'));
const { makeLiveUpgrade } = await import(join(repo, 'src', 'live', 'route.ts'));
const { startFakeRealtime } = await import(join(repo, 'tests', '_fake-realtime.ts'));

const fake = await startFakeRealtime();
fake.kidText = '老师板书怎么写';
const FAKE = join(repo, 'tests', '_fake-cli.ts');
const rt = { run: [process.execPath, '--experimental-strip-types', '--no-warnings', FAKE, '--stream', '--tools', '{tools}', '--agent', '{agent}', '{prompt}'], resume: [process.execPath, '--experimental-strip-types', '--no-warnings', FAKE, '--stream', '--tools', '{tools}', '--agent', '{agent}', '--resume', '{session}', '{prompt}'] };
const tmp = probeDir('cotutor-probe-live-webkit-');
const wsRoot = join(tmp, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot, proxy: false });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.runtimes = { default: 'stream', stream: rt };
for (const t of Object.values(cfg.tutors)) delete t.runtime;
cfg.live = { enabled: true, voices: { 'chinese-tutor': 'Serena' } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const ctx = createContext(loadWorkspace(wsRoot), { warm: false });
await ctx.reload();
const upgrade = makeLiveUpgrade({ endpoint: fake.endpoint, env: { DASHSCOPE_API_KEY: 'sk-probe' } });
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void upgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// 假麦克风:一路 440Hz 的振荡器(resume 不等:不在点击里时 WebKit 的 resume() 一直不回,真 getUserMedia 不会这样);数 getUserMedia 调了几次、AudioContext 排了几块声音、worklet 出了几块、WebSocket 发了几块二进制
const INJECT = `(() => {
  window.__played = 0; window.__gum = 0; window.__chunks = 0; window.__sentBin = 0; window.__err = [];
  window.addEventListener('error', (e) => window.__err.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__err.push(String(e.reason && e.reason.message || e.reason)));
  const AC = window.AudioContext || window.webkitAudioContext;
  // 页面自己起了几个 AudioContext(假麦克风用的不算):实时时只该一个——iPad 上同一路麦克风接进两个,先接的那个就只读到 0
  window.__ctx = 0;
  const Counted = class extends AC { constructor(...a) { super(...a); window.__ctx++; } };
  window.AudioContext = Counted; if (window.webkitAudioContext) window.webkitAudioContext = Counted;
  const orig = AC.prototype.createBufferSource;
  AC.prototype.createBufferSource = function () { const s = orig.call(this); const st = s.start; s.start = function () { window.__played++; return st.apply(this, arguments); }; return s; };
  // 老师在说时按钮旁三道小弧的深浅取自放嘴那条链上的 AnalyserNode(voice-ui.ts):数建了几个、读了几次
  window.__an = 0; window.__anRead = 0;
  const origAn = AC.prototype.createAnalyser;
  AC.prototype.createAnalyser = function () { const a = origAn.call(this); window.__an++; const rd = a.getByteTimeDomainData; a.getByteTimeDomainData = function () { window.__anRead++; return rd.apply(this, arguments); }; return a; };
  // 盖在原型上:只盖实例的话,页面切过后台再回来 WebKit 会走原型上真的那个(无头 WebKit 没有麦克风,一直不回)
  MediaDevices.prototype.getUserMedia = async () => { window.__gum++; const ctx = new AC(); const osc = ctx.createOscillator(); osc.frequency.value = 440; const dst = ctx.createMediaStreamDestination(); osc.connect(dst); osc.start(); ctx.resume().catch(() => {}); return dst.stream; };
  const d = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
  Object.defineProperty(MessagePort.prototype, 'onmessage', { set(f) { d.set.call(this, (e) => { window.__chunks++; f(e); }); }, get() { return d.get.call(this); } });
  const ws = WebSocket.prototype.send;
  WebSocket.prototype.send = function (x) { if (typeof x !== 'string') window.__sentBin++; return ws.call(this, x); };
})();`;

const browser = await webkit.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  await page.addInitScript(INJECT);
  if (process.env.PROBE_DEBUG) { page.on('console', (m) => console.log('  [page]', m.type(), m.text())); page.on('pageerror', (e) => console.log('  [pageerror]', e.message)); }
  // 先到首页记下给过麦克风权限(进老师页就先把常开那路开好,micWarm),再用 ?tutor= 进老师页的新话题
  await page.goto(`${base}/`);
  await page.waitForSelector('#tutors .c-tutor, #deck .c-tutor', { timeout: 10000 });
  await page.evaluate(() => { try { localStorage.setItem('kid-mic-ok', '1'); } catch {} });
  await page.goto(`${base}/?tutor=chinese-tutor&new=1`);
  await page.waitForFunction(() => document.body.classList.contains('live'), null, { timeout: 10000 });
  const t0 = Date.now(); while (!fake.conns.at(-1)?.session && Date.now() - t0 < 8000) await sleep(50);
  await sleep(500);
  ok('进老师页:body.live、连上了嘴', Boolean(fake.conns.at(-1)?.session));

  const box = await page.locator('#lv-hold').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(1500);
  const held = await page.evaluate(() => ({ gum: window.__gum, ctx: window.__ctx, chunks: window.__chunks, sent: window.__sentBin, listening: document.body.classList.contains('listening'), voice: document.querySelector('#lv-hold').dataset.voice, bars: document.querySelector('#lv-hold').vb.drawn().bars }));
  await page.mouse.up();
  ok('按住时按钮(canvas)在画孩子的竖条:整块变蓝、竖条往头像走(WebKit 的 canvas 与振荡器假麦克风的音量)', held.voice === 'hold' && held.bars > 0, JSON.stringify({ voice: held.voice, bars: held.bars }));
  ok('按住:常开那路麦克风接到采音节点(只 getUserMedia 一次、页面只一个 AudioContext:自检与采音同一个)、worklet 出块、推上去了', held.gum === 1 && held.ctx === 1 && held.chunks > 0 && held.sent > 0 && held.listening && fake.conns.at(-1).audio > 0, JSON.stringify({ ...held, server: fake.conns.at(-1).audio }));
  await sleep(500);
  const diag = (() => { try { return readFileSync(join(wsRoot, '.cotutor', 'voice-diag.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.where === 'live'); } catch { return []; } })();
  const dl = diag.at(-1);
  ok('诊断:这一次按住记一行(麦克风怎么开的、能推声音、音量峰值、松手发了)', Boolean(dl) && dl.tutor === 'chinese-tutor' && dl.ev.some((e) => e[0] === 'mic') && dl.ev.some((e) => e[0] === 'audio') && dl.ev.some((e) => e[0] === 'up' && e[2] === 'sent') && dl.peak > 0, JSON.stringify(dl));
  const firstLine = await page.waitForFunction(() => document.querySelector('#lv-cap .lv-cur').textContent === '先看三角形。', null, { timeout: 15000 }).then(() => true, () => false);
  const played = await page.waitForFunction(() => window.__played >= 2, null, { timeout: 15000 }).then(() => true, () => false);
  const st = await page.evaluate(() => ({ played: window.__played, cap: document.querySelector('#lv-cap .lv-cur').textContent, err: window.__err, cards: document.querySelectorAll('#board .sec .c').length }));
  ok('松手:嘴不先说,讲稿第一句上字幕;嘴的声音排进 AudioContext 放(照念)', firstLine && played && st.played >= 2, JSON.stringify(st));
  const sp = await page.evaluate(() => ({ voice: document.querySelector('#lv-hold').dataset.voice, arcs: document.querySelector('#lv-hold').vb.drawn().arcs, an: window.__an, anRead: window.__anRead }));
  ok('嘴在说:按钮旁三道小弧(canvas),深浅从放嘴那条链上的 AnalyserNode 读(WebKit 建得出、读得到)', sp.voice === 'tutor' && sp.arcs.length === 3 && sp.an >= 1 && sp.anRead > 0, JSON.stringify(sp));
  await page.waitForFunction(() => document.querySelector('#lv-cap .lv-cur').textContent.startsWith('第一次说'), null, { timeout: 20000 }).catch(() => {});
  const end = await page.evaluate(() => ({ cap: document.querySelector('#lv-cap .lv-cur').textContent, gum: window.__gum, err: window.__err }));
  ok('讲稿念到最后一句;从头到尾只 getUserMedia 一次;页面没报错', end.cap.startsWith('第一次说') && end.gum === 1 && end.err.length === 0, JSON.stringify(end));

  // 切到后台再回来(2026-10-19 真机:回来以后麦克风自检一直 dead、按住说的发不出去):实时那个 AudioContext 关掉、回来起新的,麦克风重开在新的里;再按住照样推得上去
  await sleep(1500);
  const vis = (hidden) => page.evaluate((hd) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => hd }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hd ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
  await vis(true); await sleep(300); await vis(false); await sleep(800);
  const a0 = fake.conns.at(-1).audio, s0 = await page.evaluate(() => window.__sentBin);
  await page.mouse.down(); await sleep(1500);
  const back = await page.evaluate(() => ({ gum: window.__gum, ctx: window.__ctx, listening: document.body.classList.contains('listening') }));
  await page.mouse.up(); await sleep(600);
  const sent2 = (await page.evaluate(() => window.__sentBin)) - s0;
  const dl2 = (() => { try { return readFileSync(join(wsRoot, '.cotutor', 'voice-diag.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.where === 'live').at(-1); } catch { return null; } })();
  if (process.env.PROBE_DEBUG) console.log(readFileSync(join(wsRoot, '.cotutor', 'voice-diag.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.at.slice(11, 23)} ${r.where} ${JSON.stringify(r.ev)}`; }).join('\n'));
  ok('切后台再回来:麦克风重开(第二次 getUserMedia)、实时那个 AudioContext 换了一个新的,再按住照样推得上去、诊断记「发了」', back.gum === 2 && back.ctx === 2 && back.listening && sent2 > 0 && fake.conns.at(-1).audio > a0 && dl2?.ev.some((e) => e[0] === 'up' && e[2] === 'sent') && dl2.peak > 0, JSON.stringify({ ...back, sent2, server: fake.conns.at(-1).audio - a0, diag: dl2 }));

  // 一直听(《wip/实时老师常开麦设计.md》;孩子端没有开关,家长在 live.listen 开,口语课总是一直听):进页面就连开 VAD 的连接,不按也推
  cfg.live.listen = 'open';
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  await ctx.reload();
  const nc = fake.conns.length;
  await page.goto(`${base}/?tutor=chinese-tutor&new=1`);
  await sleep(2500);
  const open = await page.evaluate(() => ({ gum: window.__gum, sent: window.__sentBin, lvOpen: document.body.classList.contains('lv-open'), err: window.__err }));
  ok('一直听:连开 VAD 的连接;不按也推;页面没报错', open.lvOpen && fake.conns.length > nc && fake.conns.at(-1).session?.turn_detection?.type === 'server_vad' && open.sent > 0 && open.err.length === 0, JSON.stringify({ ...open, conns: fake.conns.length }));
} finally {
  await browser.close();
  server.close();
  fake.close();
}
console.log(bad ? `\n${bad} 项没过` : '\n全过');
process.exit(bad ? 1 : 0);
