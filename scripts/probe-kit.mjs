#!/usr/bin/env node
/**
 * 教具卡的手动验收(不进 pnpm test,要本机 Chrome 与一个跑着的 mock;不花钱)。
 * mock 的数学老师从第四轮起:点阵三张(分一分:切 2 份、切 3 份、板上留两道竖线再切再涂),方向盘两张(转、圈),最后一轮没有教具。
 * 一、孩子在页面里打字发一句 → 点阵卡落下就自己铺满打开(不用点);量从发出去到舞台开了、烤好、画完各多久。
 * 二、只开放「切」:工具列没有转的钮;手指横着画一道(故意画歪)→ 笔画原样留着;「给老师看」→ 交上去的有一张板的图(png)、状态里一笔。
 * 三、交了不关:板留着、写「老师在看」;老师的下一张还是点阵 → 同一块板(舞台没重装),孩子上一步的笔画清掉。
 * 四、切 3 份(两道竖线)再交;第三张板上多出老师的两道红线,圈圈没挪地方;加一道横线、涂一块再交。
 * 五、老师换成方向盘:同一个舞台换了画法;只开放「转」→ 有转的钮、拿不起笔;转一格(有动画、字是正的)交了;下一张只开放「圈」→ 没有转的钮,圈住「西」。
 * 六、老师只说话、没有卡:板留着;再下一轮老师换了别的卡:板收起来,板书上那几张卡都锁着。
 * 每一步照服务端的说法说成给老师的那句(describeKit)。iPad 横屏各截一张(Page.captureScreenshot,AGENTS.md:无头 --screenshot 会挂)。
 * 用法:node scripts/probe-kit.mjs [mock 根地址] [--out <截图目录>]
 *   缺省 http://127.0.0.1:8790(先 cotutor mock --http;探针会交掉 mock 里那几张教具卡,再跑要重起 mock)
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUIET_ARGS } from './_quiet.mjs';
import { liveSend } from './_live-send.mjs';
import { describeKit, kitOf, kitOps, kitParams } from '../src/chalk/index.ts';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const base = (args.find((a, i) => !a.startsWith('--') && (outAt < 0 || i !== outAt + 1)) ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9351;
const tmp = probeDir('cotutor-probe-kit-');
const shots = outAt >= 0 ? args[outAt + 1] : join(tmp, 'shots');
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const proc = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome 没起来');
}

const ws = new WebSocket(await target());
await new Promise((r) => { ws.onopen = r; });
let seq = 0;
const pending = new Map();
/** 页面经 WebSocket 发出去的(实时那条连接) */
const sent = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Network.webSocketFrameSent' && m.params.response.opcode === 1) { try { sent.push(JSON.parse(m.params.response.payloadData)); } catch {} }
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
const until = async (expr, ms = 8000, every = 100) => { for (let t = 0; t < ms; t += every) { const v = await evaluate(expr); if (v) return v; await sleep(every); } return null; };
const center = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
/** 手指点一下(CDP 鼠标事件走命中判定;AGENTS.md「坑」) */
const tap = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const press = async (sel) => { const p = await center(sel); if (!p) return false; await tap(p.x, p.y); return true; };
/** 舞台 iframe 里一个元素在整页上的中心(iframe 的位置 + 元素在 iframe 里的位置) */
const inStage = (js) => evaluate(`(() => { const f = document.querySelector('#st-frame'); const d = f.contentDocument; if (!d) return null; const el = (${js})(d); if (!el) return null; const fr = f.getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: fr.left + r.left + r.width / 2, y: fr.top + r.top + r.height / 2, w: r.width, h: r.height }; })()`);
/** 图上写着这个字的那一处在整页上的位置 */
const wordAt = (ch) => inStage(`(d) => [...d.querySelectorAll('.kt-svg text')].find((t) => t.textContent.trim() === ${JSON.stringify(ch)})`);
const phase = () => evaluate(`document.querySelector('#st-frame')?.contentDocument?.querySelector('.kt-board')?.dataset.phase ?? null`);
const day = async () => (await (await fetch(`${base}/api/kid/conversations/math-tutor/today`)).json());
const kitCards = async () => (await day()).messages.flatMap((m) => (m.section?.cards ?? []).map((c, n) => ({ ...c, id: `${m.job}/${n}` }))).filter((c) => c.kind === 'kit');
/** 孩子在页面里打字发一句(左栏「打字」→ 输入 → 发) */
const type = async (text) => {
  await press('#lv-type');
  await until(`!document.querySelector('#typed').hidden`, 3000);
  await evaluate(`document.querySelector('#typed').focus()`);
  await send('Input.insertText', { text });
  await until(`!document.querySelector('#go').hidden`, 3000);
  await press('#go');
};

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  // mock 的数学老师:第四轮才是教具。先经实时那条连接发到第三轮(每条等老师写完),页面再打开
  for (let i = (await day()).messages.length; i < 3; i++) {
    for (let k = 0; k < 60; k++) { const r = await liveSend(base, 'math-tutor', { text: `问第 ${i + 1} 句` }); if (r.status === 202) break; await sleep(300); }
    for (let k = 0; k < 100 && (await day()).pending; k++) await sleep(300);
  }
  await send('Page.navigate', { url: `${base}/?tutor=math-tutor` });
  await until(`document.body.classList.contains('live') && Boolean(document.querySelector('#lv-type'))`, 10000);
  await until(`!document.body.classList.contains('pending')`, 15000);
  ok('回来看(以前的节):舞台不自己开', !(await evaluate(`document.querySelector('#stage').classList.contains('on')`)));

  const board = () => inStage(`(d) => d.querySelector('.kt-box')`);
  const ready = (ms = 15000) => until(`document.querySelector('#st-frame')?.contentDocument?.querySelector('.kt-board')?.dataset.phase === 'ready'`, ms, 50);
  const tools = () => evaluate(`[...(document.querySelector('#st-frame')?.contentDocument?.querySelectorAll('.kt-btn') ?? [])].map((b) => b.textContent.trim()).join()`);
  const inkCount = () => evaluate(`document.querySelector('#st-frame')?.contentDocument?.querySelectorAll('.kt-ink > *').length ?? -1`);
  /** 手指在板上走一串点(整页坐标) */
  const stroke = async (pts) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0][0], y: pts[0][1] });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], button: 'left', buttons: 1, clickCount: 1 });
    for (const [x, y] of pts.slice(1)) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }); await sleep(10); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], button: 'left', buttons: 0, clickCount: 1 });
    await sleep(250);
  };
  /** 点阵里第 r 行第 c 个圈在整页上的中心(老师画的圈是 SVG 里的 path,按位置排出来) */
  const dotAt = (r, c) => evaluate(`(() => { const f = document.querySelector('#st-frame'); const d = f.contentDocument; const fr = f.getBoundingClientRect(); const svg = d.querySelector('.kt-svg'); const gs = [...svg.children].filter((g) => g.tagName === 'g' && !g.classList.contains('kt-ink')); const bs = gs.map((g) => g.getBoundingClientRect()).filter((b) => b.width > 8 && b.width < 80 && Math.abs(b.width - b.height) < 12).map((b) => ({ x: fr.left + b.left + b.width / 2, y: fr.top + b.top + b.height / 2 })); const ys = [...new Set(bs.map((b) => Math.round(b.y / 10)))].sort((a, b) => a - b); const row = bs.filter((b) => Math.round(b.y / 10) === ys[${r} - 1]).sort((a, b) => a.x - b.x); return row[${c} - 1] ?? null; })()`);
  /** 这张卡现在的状态(从服务端取)与给老师的那句 */
  const cardNow = async (n) => (await kitCards())[n];
  const saidOf = (c) => { const k = kitOf(c.props.kit); return describeKit(k, kitParams(k, c.props.params), c.state ?? {}, kitOps(k, c.props.ops)); };
  const give = async () => { sent.length = 0; await until(`!document.querySelector('#st-go').disabled && !document.querySelector('#st-go').hidden`, 15000); await press('#st-go'); for (let i = 0; i < 30; i++) { const r = sent.find((x) => x.t === 'send'); if (r) return r; await sleep(150); } return null; };
  const waitCard = async (n, test) => { for (let i = 0; i < 30; i++) { const c = await cardNow(n); if (c && test(c)) return c; await sleep(200); } return cardNow(n); };

  // ---- 一、发一句,点阵卡落下就自己打开 ----
  const t0 = Date.now();
  await type('18 个贴纸平均分给 2 个小朋友,每人几个?');
  const opened = await until(`document.querySelector('#stage').classList.contains('on') && document.querySelector('#stage').classList.contains('cv')`, 20000);
  const tOpen = Date.now() - t0;
  ok('点阵卡落下就自己铺满打开(没点)', Boolean(opened), `${tOpen} 毫秒`);
  await until(`(() => { const p = document.querySelector('#st-frame')?.contentDocument?.querySelector('.kt-board')?.dataset.phase; return p && p !== 'loading'; })()`, 20000, 50);
  ok('画面烤好、开始一笔一笔画', true, `发出去后 ${Date.now() - t0} 毫秒(舞台开了以后 ${Date.now() - t0 - tOpen} 毫秒)`);
  ok('画完了,能动手', Boolean(await ready()), `发出去后 ${Date.now() - t0} 毫秒`);
  await until(`(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return r.left === 0 && r.top === 0; })()`, 3000);
  ok('题目在顶栏;还没动手「给老师看」按不了', (await evaluate(`document.querySelector('#st-ttl').textContent`)).includes('分成 2 份') && (await evaluate(`document.querySelector('#st-go').disabled`)));

  // ---- 二、只开放「切」;横着画一道(故意歪) ----
  ok('只开放「切」:工具列只有「擦掉」,没有转的钮', (await tools()) === '擦掉', await tools());
  const a1 = await dotAt(1, 1), a2 = await dotAt(2, 9), b1 = await dotAt(2, 1);
  ok('板上 2 行 9 个圈', Boolean(a1 && a2 && b1) && b1.y > a1.y && a2.x > a1.x, JSON.stringify([a1, a2]));
  const midY = (a1.y + b1.y) / 2;
  await stroke([[a1.x - 30, midY + 6], [a1.x + 80, midY - 5], [(a1.x + a2.x) / 2, midY + 4], [a2.x - 60, midY - 6], [a2.x + 30, midY + 2]]);
  ok('画了一笔:原样留着(没重画成直线),顶栏写「画了 1 笔」', (await inkCount()) === 1 && /画了 1 笔/.test(await evaluate(`document.querySelector('#st-note').textContent`)), await evaluate(`document.querySelector('#st-frame').contentDocument.querySelector('.kt-ink path')?.getAttribute('d')?.slice(0, 60)`));
  await shot('dots-cut-1.png');
  const sub1 = await give();
  const c1 = await waitCard(0, (c) => Boolean(c.state?.image));
  ok('「给老师看」:交了(send 带 action submit 与 focus)', sub1?.body?.action === 'submit' && sub1.body.focus?.card === c1?.id, JSON.stringify(sub1?.body ?? null));
  ok('交上去的有一张板的图(png)和那一笔', String(c1?.state?.image ?? '').startsWith('data:image/png') && c1.state.marks?.length === 1, String(c1?.state?.image ?? '').slice(0, 30) + ' ' + String(c1?.state?.image ?? '').length);
  ok('给老师的那句:请他切;画了 1 道横线,大致 2 份每份 9 个', saidOf(c1) === '请他做的:切;大概:画了 1 道横线;大致分成 2 份:每份 9 个', saidOf(c1));
  writeFileSync(join(shots, 'board-to-teacher-1.png'), Buffer.from(String(c1.state.image).split(',')[1], 'base64'));

  // ---- 三、交了不关;下一张还是点阵,同一块板 ----
  ok('交了不关:板还开着,写「老师在看」,没有「给老师看」', (await evaluate(`document.querySelector('#stage').classList.contains('on') && document.querySelector('#st-go').hidden && /老师在看/.test(document.querySelector('#st-note').textContent)`)) === true);
  await evaluate(`window.__frameWin = document.querySelector('#st-frame').contentWindow; window.__frameSrc = document.querySelector('#st-frame').src; 1`);
  const next2 = await until(`document.querySelector('#st-ttl').textContent.includes('3 个小朋友')`, 20000);
  ok('老师的下一张落在同一块板上(题目换了,舞台没重装)', Boolean(next2) && (await evaluate(`document.querySelector('#st-frame').src === window.__frameSrc && document.querySelector('#stage').classList.contains('on')`)) === true);
  await ready();
  ok('孩子上一步的笔画清掉了;又能动手', (await inkCount()) === 0 && (await evaluate(`document.querySelector('#st-go').hidden`)) === false && (await tools()) === '擦掉');
  const a1b = await dotAt(1, 1);
  ok('圈圈没挪地方', Math.abs(a1b.x - a1.x) < 1.5 && Math.abs(a1b.y - a1.y) < 1.5, JSON.stringify([a1, a1b]));

  // ---- 四、切 3 份;第三张多出老师的两道线,再切再涂 ----
  const col = async (c) => ((await dotAt(1, c)).x + (await dotAt(1, c + 1)).x) / 2;
  const vcut = (x) => [[x + 3, a1.y - 34], [x - 4, a1.y + 10], [x + 4, b1.y - 8], [x - 2, b1.y + 34]];
  await stroke(vcut(await col(3)));
  await stroke(vcut(await col(6)));
  await shot('dots-cut-3.png');
  await give();
  const c2 = await waitCard(1, (c) => c.state?.marks?.length === 2 && Boolean(c.state.image));
  ok('给老师的那句:2 道竖线,大致 3 份每份 6 个', saidOf(c2) === '请他做的:切;大概:画了 2 道竖线;大致分成 3 份:每份 6 个', saidOf(c2));
  ok('第三张落在同一块板上', Boolean(await until(`document.querySelector('#st-ttl').textContent.includes('6 份')`, 20000)));
  await ready();
  const reds = await evaluate(`[...document.querySelector('#st-frame').contentDocument.querySelectorAll('.kt-svg path')].filter((p) => (p.getAttribute('stroke') || '').toLowerCase() === '#e03131' && p.closest('g').style.display !== 'none').length`);
  const a1c = await dotAt(1, 1);
  ok('板上多了老师的两道红线,圈圈还在原地,孩子的笔画清掉了', reds >= 2 && Math.abs(a1c.x - a1.x) < 1.5 && (await inkCount()) === 0, JSON.stringify({ reds, a1c }));
  ok('这一张开放「切、涂」', (await tools()) === '擦掉');
  await stroke([[a1.x - 30, midY - 4], [(a1.x + a2.x) / 2, midY + 5], [a2.x + 30, midY - 3]]);
  // 在左上那一份里来回涂
  const d13 = await dotAt(1, 3);
  const zig = []; for (let k = 0; k < 12; k++) zig.push([k % 2 ? d13.x + 12 : a1.x - 12, a1.y - 16 + k * 3]);
  await stroke(zig);
  await shot('dots-cut-6.png');
  await give();
  const c3 = await waitCard(2, (c) => c.state?.marks?.length === 2 && Boolean(c.state.image));
  ok('给老师的那句:连同原来的线共 6 份每份 3 个;涂了一块大约 3 个', saidOf(c3) === '请他做的:切、涂;大概:画了 1 道横线;连同板上原来的线,大致分成 6 份:每份 3 个;涂了一块,盖住大约 3 个', saidOf(c3));
  writeFileSync(join(shots, 'board-to-teacher-3.png'), Buffer.from(String(c3.state.image).split(',')[1], 'base64'));

  // ---- 五、换成方向盘:只转;再一张只圈 ----
  const toCompass = await until(`document.querySelector('#st-ttl').textContent.includes('转到小人的前面')`, 20000);
  ok('老师换成方向盘:还是这个舞台,换了画法', Boolean(toCompass) && (await evaluate(`document.querySelector('#st-frame').src === window.__frameSrc`)) === true, JSON.stringify([toCompass, await evaluate(`document.querySelector('#st-ttl').textContent`)]));
  await ready();
  ok('只开放「转」:有向左转、向右转,没有擦掉(拿不起笔)', (await tools()) === '向左转,向右转', await tools());
  const before = { e: await wordAt('东'), n: await wordAt('北') };
  await tap(before.e.x + 40, before.e.y + 40);
  ok('拿不起笔:在板上画不出东西', (await inkCount()) === 0);
  const left = await inStage(`(d) => d.querySelector('.kt-btn.kt-left')`);
  await tap(left.x, left.y);
  const mids = [];
  for (let k = 0; k < 12; k++) { const m = await wordAt('东'); if (m) mids.push(m); await sleep(40); }
  await sleep(500);
  const after = { e: await wordAt('东'), w: await wordAt('西') };
  ok('转一格有动画(中途东在右上方),转完东在上、西在下,字是正的', mids.some((m) => Math.abs(m.x - before.e.x) > 8 && Math.abs(m.x - before.n.x) > 8) && Math.abs(after.e.x - before.n.x) < 3 && Math.abs(after.e.y - before.n.y) < 3 && after.w.y > after.e.y && Math.abs(after.e.w - before.e.w) < 2, JSON.stringify(mids.map((m) => [Math.round(m.x), Math.round(m.y)])));
  await shot('compass-turned.png');
  await give();
  const c4 = await waitCard(3, (c) => c.state?.moves === 1 && Boolean(c.state.image));
  ok('给老师的那句:请他转;逆时针 90°,现在谁在哪', saidOf(c4) === '请他做的:转;大概:把方向盘逆时针转了 90°(按了 1 次);现在前面是东、右面是南、后面是西、左面是北;没有圈', saidOf(c4));
  ok('下一张方向盘落在同一块板上', Boolean(await until(`document.querySelector('#st-ttl').textContent.includes('圈出来')`, 20000)));
  await ready();
  ok('只开放「圈」:没有转的钮,只有擦掉', (await tools()) === '擦掉', await tools());
  const w2 = await wordAt('西');
  const ringPts = []; for (let k = 0; k <= 26; k++) { const a = (k / 24) * Math.PI * 2; ringPts.push([w2.x + w2.w * 0.95 * Math.cos(a), w2.y + w2.w * 0.95 * Math.sin(a)]); }
  await stroke(ringPts);
  await shot('compass-circled.png');
  await give();
  const c5 = await waitCard(4, (c) => c.state?.marks?.length === 1 && Boolean(c.state.image));
  ok('给老师的那句:请他圈;圈住了西(在后面)', saidOf(c5) === '请他做的:圈;大概:没转(前面是东、右面是南、后面是西、左面是北);圈住了:西(在后面)', saidOf(c5));
  writeFileSync(join(shots, 'board-to-teacher-5.png'), Buffer.from(String(c5.state.image).split(',')[1], 'base64'));

  // ---- 五半、换成照片做底:裁出平面图,孩子圈;下一张老师添圈和方位十字 ----
  ok('老师换成照片:题目换了', Boolean(await until(`document.querySelector('#st-ttl').textContent.includes('心理辅导室')`, 20000)));
  await ready();
  const hasPhoto = () => evaluate(`Boolean(document.querySelector('#st-frame')?.contentDocument?.querySelector('.kt-svg image'))`);
  ok('照片垫在板上;只开放「圈」', (await hasPhoto()) === true && (await tools()) === '擦掉', await tools());
  /** 照片上的千分比 → 整页坐标(照片 800 × 500) */
  const onPhoto = (px, py) => evaluate(`(() => { const f = document.querySelector('#st-frame'); const im = f.contentDocument.querySelector('.kt-svg image'); const fr = f.getBoundingClientRect(), r = im.getBoundingClientRect(); return [fr.left + r.left + r.width * ${px} / 1000, fr.top + r.top + r.height * ${py} / 1000]; })()`);
  const ringOn = async (px, py, rx, ry) => { const [cx, cy] = await onPhoto(px, py); const [ex, ey] = await onPhoto(px + rx, py + ry); const pts = []; for (let k = 0; k <= 26; k++) { const a = (k / 24) * Math.PI * 2; pts.push([cx + (ex - cx) * Math.cos(a), cy + (ey - cy) * Math.sin(a)]); } await stroke(pts); };
  await ringOn(562, 360, 70, 130);
  await shot('photo-circled.png');
  await give();
  const c6 = await waitCard(5, (c) => c.state?.marks?.length === 1 && Boolean(c.state.image));
  ok('给老师的那句:圈的中间说成照片的千分比(差不出 15)', (() => { const m = /中间在 \((\d+), (\d+)\)/.exec(saidOf(c6)); return Boolean(m) && Math.abs(Number(m[1]) - 562) < 15 && Math.abs(Number(m[2]) - 360) < 15; })(), saidOf(c6));
  writeFileSync(join(shots, 'board-to-teacher-6.png'), Buffer.from(String(c6.state.image).split(',')[1], 'base64'));
  ok('下一张照片落在同一块板上', Boolean(await until(`document.querySelector('#st-ttl').textContent.includes('东面')`, 20000)));
  await ready();
  ok('老师的圈和方位十字画上了(四个字)', (await evaluate(`[...document.querySelector('#st-frame').contentDocument.querySelectorAll('.kt-svg text')].map((t) => t.textContent.trim()).join('')`)) === '北东南西' && (await inkCount()) === 0);
  await shot('photo-rose.png');
  await ringOn(750, 360, 135, 140);
  await give();
  const c7 = await waitCard(6, (c) => c.state?.marks?.length === 1 && Boolean(c.state.image));
  ok('给老师的那句:圈在东面那两间上', /中间在 \(7[3-6]\d, 3[4-7]\d\)/.test(saidOf(c7)), saidOf(c7));
  writeFileSync(join(shots, 'board-to-teacher-7.png'), Buffer.from(String(c7.state.image).split(',')[1], 'base64'));

  // ---- 六、老师只说话:板留着;再下一轮换了别的卡:板收起来 ----
  await until(`document.querySelector('#st-note').textContent.includes('交给老师了')`, 20000);
  ok('老师这一轮只说话、没有卡:板留着,不再写「老师在看」', (await evaluate(`document.querySelector('#stage').classList.contains('on') && document.querySelector('#st-note').textContent.includes('交给老师了')`)) === true, String(await evaluate(`document.querySelector('#st-note').textContent`)));
  await until(`!document.body.classList.contains('pending')`, 20000);
  await sleep(1500);
  ok('过一会儿板还开着', (await evaluate(`document.querySelector('#stage').classList.contains('on')`)) === true);
  for (let k = 0; k < 60; k++) { const r = await liveSend(base, 'math-tutor', { text: '好的' }); if (r.status === 202) break; await sleep(300); }
  ok('老师下一轮换了别的卡:板收起来', Boolean(await until(`!document.querySelector('#stage').classList.contains('on')`, 20000)));
  await until(`!document.body.classList.contains('pending')`, 20000);
  // ---- 七、只看的板:老师把答案写在照片上 ----
  // 从页面里发(孩子自己说的那一轮,新落下的板才自己打开;别处发来的不抢屏幕)
  await until(`!document.body.classList.contains('pending')`, 20000);
  await type('怎么填');
  ok('只看的板自己打开', Boolean(await until(`document.querySelector('#stage').classList.contains('on') && document.querySelector('#st-ttl').textContent.includes('这样填')`, 20000)), JSON.stringify(await evaluate(`[document.querySelector('#stage').className, document.querySelector('#st-ttl').textContent, document.body.className, [...document.querySelectorAll('#board .c-kit')].length]`)));
  await ready();
  ok('老师的字写上了;没有笔、没有「给老师看」', (await evaluate(`[...document.querySelector('#st-frame').contentDocument.querySelectorAll('.kt-svg text')].map((t) => t.textContent.trim()).join('')`)) === '东面有(卫生保健室)和(教室一)' && (await tools()) === '' && (await evaluate(`document.querySelector('#st-act').hidden`)) === true, JSON.stringify([await tools(), await evaluate(`document.querySelector('#st-act').hidden`)]));
  const [lx, ly] = await onPhoto(300, 500);
  await stroke([[lx, ly], [lx + 60, ly + 10], [lx + 120, ly]]);
  ok('画不上东西', (await inkCount()) === 0);
  await shot('photo-written.png');
  await press('#st-x');
  await until(`!document.querySelector('#stage').classList.contains('on')`, 5000);
  ok('板书上七张教具卡都锁着', (await evaluate(`[...document.querySelectorAll('#board .c-kit')].filter((c) => c.querySelector('.lk')).length`)) === 7, String(await evaluate(`document.querySelectorAll('#board .c-kit').length`)));
  await shot('board-after.png');
} catch (err) {
  bad++;
  console.error('✗ 探针出错:', err instanceof Error ? err.stack : err);
} finally {
  console.log(`截图在 ${shots}`);
  ws.close();
  proc.kill();
  process.exitCode = bad ? 1 : 0;
}
