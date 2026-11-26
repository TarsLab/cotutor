#!/usr/bin/env node
/**
 * 点读课文(语文课本的一课,docs/dev/课本.md)的孩子端整条线手动验收:不进 pnpm test,要本机 Chrome 和一本语文课本 PDF;假百炼 + 假老师 + 假配音,不花钱。
 * 搭法同 scripts/probe-book-page.mjs(本进程起服务,临时 workspace 的 教材/ 里链着给的 PDF):
 *  一、首页点语文的「课本」,孩子说「我要预习坐井观天」:翻到这一课。
 *  一之二、还没点过读:标题前的钮先摆着(描边播放形,invite)。
 *  二、鼠标移到第 6 段段首的空白:浅浅出一个描边的播放钮;移开就收。
 *  三、点它:钮变成暂停的样子(合成慢时先转圈),假配音收到整篇(一次,SSE 带字的时间);标题前的钮收起;正在读的那一截(停顿处切)铺一层学科色(.bk-say),页上不刷黄;换到第二截框跟着挪。
 *  四、第 6 段读完:同一份声音接着放,钮挪到第 7 段。
 *  三之二、读的时候左下角露倍速钮(1×);点开淡出一层,选 0.75×:声音立刻放慢、钮写 0.75×、层收起。
 *  五、点第 7 段的钮:暂停(钮变回播放的样子);报 {k:'read', from: 6, to: 7, rate: 0.75};服务端记进板的日志。
 *  六、孩子再说一句:那一轮的上下文包「孩子做的」里有「自己点了课文听(点读的配音,0.75 倍速)」。
 *  老师的签:按过一次(孩子说话)就淡成只剩头像(底、字透明)。
 * iPad 横屏各截一张。
 * 用法:node scripts/probe-book-read.mjs --pdf <语文课本 PDF> [--out <截图目录>]
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS } from './_quiet.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const pdf = opt('--pdf');
if (!pdf) { console.error('要 --pdf <课本 PDF>'); process.exit(2); }
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cdp = 9361;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };
const tmp = probeDir('cotutor-probe-book-read-');
const shots = opt('--out') ?? join(tmp, 'shots');
mkdirSync(shots, { recursive: true });
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import(join(repo, 'src', 'app', 'cli', 'init.ts'));
const { loadWorkspace } = await import(join(repo, 'src', 'app', 'workspace.ts'));
const { createContext, createHandler } = await import(join(repo, 'src', 'app', 'http', 'app.ts'));
const { makeLiveUpgrade } = await import(join(repo, 'src', 'app', 'ws', 'route.ts'));
const { startFakeRealtime } = await import(join(repo, 'tests', '_fake-realtime.ts'));
const { startFakeTeacher } = await import(join(repo, 'tests', '_fake-teacher.ts'));
const { readBoard } = await import(join(repo, 'src', 'runtime', 'journal', 'board-log.ts'));
const { bookIndex } = await import(join(repo, 'src', 'memory', 'textbook-pdf.ts'));
const { bookLesson } = await import(join(repo, 'src', 'board', 'lesson-fit.ts'));
const { bookCut, bookReadParts, bookSheets, zoneBlocks } = await import(join(repo, 'src', 'chalk', 'index.ts'));
const { bookZones } = await import(join(repo, 'src', 'memory', 'textbook-zones.ts'));
const { pickZones } = await import(join(repo, 'src', 'schema', 'index.ts'));
const { startFakeTts } = await import(join(repo, 'tests', '_fake-tts.ts'));

const fake = await startFakeRealtime();
fake.audioMs = 300;
const teacher = await startFakeTeacher();
// 点读的声音:假配音给一段解得开的 WAV(字越多越长,最长 4 秒),浏览器真放、放完真有 ended
const tts = await startFakeTts({ tone: true });
process.env.COTUTOR_TTS_ENDPOINT = tts.url;
process.env.COTUTOR_BRAIN_ENDPOINT = teacher.baseURL;
const wsRoot = join(tmp, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.runtimes = { default: 'stream', stream: { api: 'bailian', model: 'fake-stream' } };
for (const t of Object.values(cfg.tutors)) delete t.runtime;
cfg.live = { voices: { 'chinese-tutor': 'Serena' } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const wsx = loadWorkspace(wsRoot);
mkdirSync(wsx.paths.textbooks, { recursive: true });
const name = basename(pdf);
symlinkSync(resolve(pdf), join(wsx.paths.textbooks, name));
const ctx = createContext(wsx);
await ctx.reload();
const upgrade = makeLiveUpgrade({ endpoint: fake.endpoint });
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void upgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const T = 'chinese-tutor';

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--no-sandbox', '--hide-scrollbars', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${cdp}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  const errors = [];
  /** 页面经实时那条连接发出去的 */
  const frames = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Network.webSocketFrameSent' && m.params.response.opcode === 1) { try { frames.push(JSON.parse(m.params.response.payloadData)); } catch {} }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, n), Buffer.from(r.result.data, 'base64')); return join(shots, n); };
  const until = async (expr, ms = 15000) => { for (let t = 0; t < ms; t += 200) { const v = await evaluate(expr); if (v) return v; await sleep(200); } return null; };
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' || type === 'mouseMoved' ? 0 : 1, clickCount: 1 });
  const tapAt = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await sleep(50); await mouse('mouseReleased', x, y); };
  /** 舞台里的板(iframe 里) */
  const STAGE = `document.querySelector('#st-frame')?.contentDocument`;
  const stageEval = (js) => evaluate(`(() => { const d = ${STAGE}; if (!d) return null; return (${js})(d, document.querySelector('#st-frame').getBoundingClientRect()); })()`);
  const camera = () => stageEval(`(d, fr) => { const p = d.querySelector('.bk-paper'), v = d.querySelector('.bk-view'); if (!p || !v) return null; const m = /translate\\(([-\\d.e]+)px, ([-\\d.e]+)px\\) scale\\(([-\\d.e]+)\\)/.exec(p.style.transform); const r = v.getBoundingClientRect(); return m ? { tx: +m[1], ty: +m[2], s: +m[3], left: fr.left + r.left, top: fr.top + r.top, w: r.width, h: r.height } : null; }`);
  const center = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  /** 孩子按住头像说一句(假嘴把这一次听成 text;走页面自己那条实时连接,老师这一轮页面自己放)。新开的浏览器第一次按麦克风还在热,没收下就再按 */
  const say = async (text) => {
    const n0 = (await (await fetch(`${base}/api/kid/conversations/${T}/today`)).json()).messages?.length ?? 0;
    for (let k = 0; k < 3; k++) {
      fake.kidTexts.push(text);
      // 板开着:按住说话是板角上那颗老师小头像(左栏那颗被舞台盖着)
      const h = (await center('#cv-hold')) ?? (await center('#lv-hold'));
      await mouse('mouseMoved', h.x, h.y);
      await mouse('mousePressed', h.x, h.y);
      await sleep(1200);
      await mouse('mouseReleased', h.x, h.y);
      for (let i = 0; i < 20; i++) { if (((await (await fetch(`${base}/api/kid/conversations/${T}/today`)).json()).messages?.length ?? 0) > n0) return true; await sleep(250); }
      fake.kidTexts.length = 0;
    }
    return false;
  };
  const bookState = () => stageEval(`(d) => ({ phase: d.querySelector('.bk-board')?.dataset.phase ?? null, pages: d.querySelectorAll('.bk-page').length, rings: d.querySelectorAll('.bk-ring').length, inks: d.querySelectorAll('.bk-ink path').length })`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
  const day = async () => (await (await fetch(`${base}/api/kid/conversations/${T}/today`)).json());
  const idle = async () => { for (let i = 0; i < 80 && (await day()).messages?.some((m) => m.result === 'running'); i++) await sleep(250); };
  const btn = () => stageEval(`(d) => [...d.querySelectorAll('.bk-read-btn:not(.bk-gone)')].map((g) => { const c = g.querySelector('circle'); return { mode: g.dataset.mode, cy: +c.getAttribute('cy') }; })`);
  const lit = () => stageEval(`(d) => [...d.querySelectorAll('.bk-say g:not(.bk-gone)')].map((g) => ({ say: g.dataset.say, soft: g.classList.contains('bk-soft'), ys: [...g.querySelectorAll('rect')].map((r) => +r.getAttribute('y')) }))`);
  const yellow = () => stageEval(`(d) => d.querySelectorAll('.bk-look rect').length`);

  // 一、进课本,翻到坐井观天
  await send('Page.navigate', { url: `${base}/` });
  // 首页是桌上一本书:先点下沿语文老师的小旗翻到那一章,再点「课本」
  const flag = await until(`(() => { const b = document.querySelector('#tabs .tab[data-tutor="${T}"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 30 }; })()`);
  if (flag) { await tapAt(flag.x, flag.y); await sleep(900); }
  const tile = await until(`(() => { const b = document.querySelector('.pc.front[data-tutor="${T}"] .bt-tile[data-tile="textbook"]') ?? document.querySelector('[data-tutor="${T}"] .bt-tile[data-tile="textbook"]'); if (!b) return null; const r = b.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  ok('首页有语文的「课本」方砖', Boolean(tile));
  await tapAt(tile.x, tile.y);
  await until(`(() => { const d = ${STAGE}; return d && d.querySelector('.bk-board')?.dataset.phase === 'ready'; })()`, 20000);
  await idle();
  ok('孩子说「我要预习坐井观天」:收下了', await say('我要预习坐井观天'));
  const landed = await until(`(() => { const d = ${STAGE}; return d && document.querySelector('#st-ttl').textContent === '坐井观天' && d.querySelector('.bk-board')?.dataset.phase === 'ready'; })()`, 25000);
  ok('翻到《坐井观天》', Boolean(landed));
  await sleep(800);
  const ghost = await evaluate(`(() => { const b = document.querySelector('#cv-hold'); const side = b.querySelector('.vb-side'); return { ghost: b.classList.contains('ghost'), lit: b.classList.contains('lit'), bg: getComputedStyle(b).backgroundColor, side: side ? +getComputedStyle(side).opacity : null, w: b.getBoundingClientRect().width }; })()`);
  ok('按过一次签:淡成只剩头像(底透明、字透明),能按的宽度不变', ghost.ghost && !ghost.lit && ghost.bg === 'rgba(0, 0, 0, 0)' && ghost.side === 0 && ghost.w > 80, JSON.stringify(ghost));
  await idle();
  await sleep(2500);
  const ix = await bookIndex(wsx.paths.textbooks, join(tmp, 'cache'), name);
  const at = bookLesson(ix, '坐井观天');
  const sheets = bookSheets(at.pages, undefined, bookCut(ix.pages));
  const zones = await bookZones(wsx.paths.textbooks, join(tmp, 'cache'), ix);
  const parts = bookReadParts(at.pages, sheets, zoneBlocks(at.pages, pickZones(zones, at.pages.map((p) => p.n)).pages, ix.layout));
  const k6 = parts.findIndex((p) => p.no === 6), k7 = parts.findIndex((p) => p.no === 7);
  const cam = await camera();
  const scr = (p) => ({ x: cam.left + cam.tx + (p.hit[0] + p.hit[2]) / 2 * cam.s, y: cam.top + cam.ty + p.dot[1] * cam.s });
  const z6 = scr(parts[k6]);
  ok('第 6 段段首的空白在窗里', z6.y > cam.top + 20 && z6.y < cam.top + cam.h - 60, JSON.stringify({ z6, cam }));

  const tk = parts.findIndex((p) => p.no === 0);
  const inv = await btn();
  ok('还没点过读:标题前的钮先摆着(描边播放形)', inv.length === 1 && inv[0].mode === 'invite' && Math.abs(inv[0].cy - parts[tk].dot[1]) < 1, JSON.stringify(inv));
  console.log('  ', await shot('0-进来.png'));

  // 二、悬停
  await mouse('mouseMoved', z6.x, z6.y);
  await sleep(300);
  const hv = await btn();
  ok('鼠标移到第 6 段段首:浅浅出一个描边的播放钮(标题前那颗还在)', hv.length === 2 && hv.some((b) => b.mode === 'hover' && Math.abs(b.cy - parts[k6].dot[1]) < 1) && hv.some((b) => b.mode === 'invite'), JSON.stringify(hv));
  console.log('  ', await shot('1-悬停.png'));
  await mouse('mouseMoved', cam.left + cam.w / 2, cam.top + 40);
  await sleep(600);
  ok('移开:只剩标题前那颗', (await btn()).map((b) => b.mode).join() === 'invite', JSON.stringify(await btn()));

  // 三、点它:读第 6 段
  const n0 = tts.requests.length;
  await tapAt(z6.x, z6.y);
  const playing = await until(`(() => { const d = ${STAGE}; const g = d && d.querySelector('.bk-read-btn:not(.bk-gone)'); return g && g.dataset.mode === 'playing'; })()`, 15000);
  const sent = tts.requests.slice(n0);
  ok('点第 6 段:钮变成暂停的样子,假配音收到整篇一次(SSE,里面有第 6 段)', Boolean(playing) && sent.length === 1 && sent[0].sse && sent[0].text.split('\n').includes(parts[k6].sents.join('')), JSON.stringify({ sent, want: parts[k6].sents }));
  ok('读的时候页上不刷黄', (await yellow()) === 0);
  ok('点过了:标题前的钮收起', (await btn()).every((b) => b.mode !== 'invite'), JSON.stringify(await btn()));
  const l0 = await lit();
  ok('正在读的那一截铺一层(第 6 段第 1 截,框在这一段的第一行)', l0.length === 1 && l0[0].say === `${k6}.0` && Math.abs(l0[0].ys[0] - (parts[k6].says[0][0][1] - 3)) < 1, JSON.stringify({ l0, want: parts[k6].says[0] }));
  if (parts[k6].sents.length > 1) {
    const l1 = await until(`(() => { const d = ${STAGE}; const g = d && d.querySelector('.bk-say g:not(.bk-gone)'); return g && g.dataset.say === '${k6}.1' ? g.dataset.say : null; })()`, 20000);
    ok('读到第二截:框挪到第二截', Boolean(l1));
  }
  console.log('  ', await shot('2-在读.png'));

  // 三之二、倍速:左下角的钮,点开选 0.75×
  const rb = await center('#cv-rate.on');
  ok('读的时候左下角露倍速钮,写 1×', Boolean(rb) && rb.x < 120 && (await evaluate(`document.querySelector('#cv-rate').textContent`)) === '1×', JSON.stringify(rb));
  await tapAt(rb.x, rb.y);
  await sleep(300);
  const opts = await evaluate(`[...document.querySelectorAll('#cv-rates:not([hidden]) button')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : ''))`);
  ok('点开:四档,1× 是现在这档', opts.join() === '1.25×,1×*,0.75×,0.5×', JSON.stringify(opts));
  console.log('  ', await shot('2b-倍速.png'));
  const o75 = await center('#cv-rates button[data-r="0.75"]');
  await tapAt(o75.x, o75.y);
  await sleep(300);
  const r75 = await evaluate(`(() => ({ tx: document.querySelector('#cv-rate').textContent, odd: document.querySelector('#cv-rate').classList.contains('odd'), closed: document.querySelector('#cv-rates').hidden }))()`);
  ok('选 0.75×:钮写 0.75×、学科色,层收起', r75.tx === '0.75×' && r75.odd && r75.closed, JSON.stringify(r75));
  const still = await btn();
  ok('换档不停:还在读', still.some((b) => b.mode === 'playing'), JSON.stringify(still));

  // 四、读完第 6 段:同一份声音接着放,钮挪到第 7 段
  const moved = await until(`(() => { const d = ${STAGE}; const g = d && d.querySelector('.bk-read-btn:not(.bk-gone)'); const c = g && g.querySelector('circle'); return g && g.dataset.mode === 'playing' && Math.abs(+c.getAttribute('cy') - ${parts[k7].dot[1]}) < 1 ? true : null; })()`, 30000);
  ok('第 6 段读完:接着读第 7 段,钮挪过去;不再合成', Boolean(moved) && tts.requests.length === n0 + 1);
  console.log('  ', await shot('3-下一段.png'));

  // 五、点第 7 段的钮:暂停,报 read
  const nf = frames.length;
  // 读到窗外挪了窗:等它停稳再量(慢放时挪窗正好落在这一会儿)
  let c2 = await camera();
  for (let i = 0; i < 20; i++) { await sleep(300); const c = await camera(); if (c.ty === c2.ty && c.tx === c2.tx) break; c2 = c; }
  const z7 = { x: c2.left + c2.tx + (parts[k7].hit[0] + parts[k7].hit[2]) / 2 * c2.s, y: c2.top + c2.ty + parts[k7].dot[1] * c2.s };
  await tapAt(z7.x, z7.y);
  await sleep(700);
  const ps = await btn();
  const rf = frames.slice(nf).find((f) => f.t === 'board' && f.body?.k === 'read');
  ok('点在读的那段:暂停,钮变回播放的样子;报 read 从第 6 段到第 7 段、0.75 倍速', ps.length === 1 && ps[0].mode === 'paused' && rf?.body?.from === 6 && rf.body.to === 7 && !rf.body.done && rf.body.rate === 0.75, JSON.stringify({ ps, rf }));
  const lp = await lit();
  ok('暂停:那一截的底色淡一半、留着', lp.length === 1 && lp[0].soft && lp[0].say.startsWith(`${k7}.`), JSON.stringify(lp));
  console.log('  ', await shot('4-暂停.png'));
  await sleep(500);
  const log = await readBoard(wsx, T, (await day()).date, (await day()).messages.slice(-1)[0].thread);
  ok('服务端记进板的日志', log.some((e) => e.k === 'read' && e.from === 6 && e.to === 7), JSON.stringify(log.slice(-3)));

  // 六、再说一句:老师看到
  await idle();
  await say('我读完了');
  await sleep(800);
  await idle();
  const last = (await day()).messages.slice(-1)[0];
  const run = JSON.parse(readFileSync(join(wsRoot, 'conversations', T, `${(await day()).date}.${last.job}.run.json`), 'utf8'));
  const pr = run.prompt.slice(run.prompt.indexOf('  board:'), run.prompt.indexOf('  board:') + 2500);
  ok('下一轮的上下文包:孩子做的里有点读', pr.includes('自己点了课文听(点读的配音,0.75 倍速):从第 6 段读到第 7 段,在第 7 段停了'), pr);
  ok('页面没有脚本报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`\n截图在 ${shots}`);
  ws.close();
} finally {
  browser?.kill();
  server.close();
  await teacher.close();
  await tts.close();
  await fake.close?.();
}
process.exit(bad ? 1 : 0);
