#!/usr/bin/env node
/**
 * 画板的手动验收(不进 pnpm test,要本机 Chrome 与一个跑着的 mock;不花钱):
 * 一、画板卡铺满:盖住左栏、题目在顶栏(点开看全)、工具一列、底下老师的小头像;画三笔、撤销一笔 → 清空(清空前那一版存图)→ 再画 →
 *     按住小头像说(边画边聊:松手带 chat 与一张 jpeg,假嘴接住一句、画布顶上浮字幕,不起老师)→ 点「给老师看」交了、紧凑态出缩略图。
 * 二、左栏的纸:左栏四个钮(画板 · 拍照 · 相册 · 打字);点「画板」铺满、空白;画三笔、关掉再开还在(存在服务端);
 *     按住「给老师看」说一句 = 画和这句话一起给老师(消息带 drawing),板上节前一张孩子的画卡(真图)、「接着画」又打开那张纸;
 *     再画到换色、停笔,点开 20 秒后嘴主动说一句(孩子端发 chat、假嘴说、字幕浮上来)。
 * iPad 横屏各截一张(Page.captureScreenshot,AGENTS.md:无头 --screenshot 会挂)。
 * 用法:node scripts/probe-paper.mjs [mock 根地址] [--out <截图目录>]
 *   缺省 http://127.0.0.1:8790(先 cotutor mock --http;探针会交掉 mock 里那张画板卡,再跑要重起 mock)
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUIET_ARGS } from './_quiet.mjs';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const base = (args.find((a, i) => !a.startsWith('--') && (outAt < 0 || i !== outAt + 1)) ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9347;
const tmp = probeDir('cotutor-probe-paper-');
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
/** 页面经 WebSocket 发出去的(实时那条连接):边画边聊的 release 带不带 chat、给老师看带不带 drawing */
const sent = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Network.webSocketFrameSent' && m.params.response.opcode === 1) { try { sent.push(JSON.parse(m.params.response.payloadData)); } catch {} }
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
const until = async (expr, ms = 8000) => { for (let t = 0; t < ms; t += 200) { const v = await evaluate(expr); if (v) return v; await sleep(200); } return null; };
const center = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
/** 手指按住 ms 再松(CDP 鼠标事件走命中判定;AGENTS.md「坑」) */
const press = async (sel, ms) => {
  const p = await center(sel);
  if (!p) return false;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(ms);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  return true;
};
/** 在舞台 iframe 的画布上画几笔(iframe 里派 PointerEvent;顶层鼠标画不上 excalidraw) */
const draw = (strokes, color) => evaluate(`(async () => {
  const d = document.querySelector('#st-frame').contentDocument;
  ${color !== undefined ? `d.querySelectorAll('.ct-btn.dot')[${color}]?.click(); await new Promise((r) => setTimeout(r, 100));` : ''}
  const cv = d.querySelector('.canvas-board .excalidraw__canvas.interactive') || d.querySelector('.canvas-board canvas');
  const r = cv.getBoundingClientRect();
  const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: type === 'pointerup' ? 0 : 1, button: 0, pressure: 0.5 }));
  for (const pts of ${JSON.stringify(strokes)}) { ev('pointerdown', ...pts[0]); for (const p of pts.slice(1)) { ev('pointermove', ...p); await new Promise((r) => setTimeout(r, 12)); } ev('pointerup', ...pts[pts.length - 1]); await new Promise((r) => setTimeout(r, 80)); }
  await new Promise((r) => setTimeout(r, 900));
  return document.querySelector('#st-note')?.textContent ?? '';
})()`);
/** 舞台的三个颜色钮:黑红蓝 */
const RED = 1, BLUE = 2;
const THREE = [[[120, 120], [160, 140], [200, 170], [240, 190], [280, 220]], [[300, 100], [300, 140], [302, 180], [301, 220], [300, 260]], [[120, 300], [180, 300], [240, 302], [300, 300]]];
const TWO = [[[400, 120], [460, 160], [520, 200]], [[420, 300], [480, 280], [540, 300]]];
const canvasUp = () => until(`Boolean(document.querySelector('#st-frame')?.contentDocument?.querySelector('.canvas-board canvas'))`, 15000);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  // ---- 一、画板卡铺满 ----
  // mock 的语文老师第三轮回复里有画板卡:先经接口发到第三轮(每条等老师写完)
  const day = async () => (await (await fetch(`${base}/api/kid/conversations/chinese-tutor/today`)).json());
  for (let i = (await day()).messages.length; i < 3; i++) {
    for (let k = 0; k < 60; k++) { const r = await fetch(`${base}/api/kid/conversations/chinese-tutor/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `问第 ${i + 1} 句`, live: true }) }); if (r.status === 202) break; await sleep(300); }
    for (let k = 0; k < 100 && (await day()).pending; k++) await sleep(300);
  }
  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor&stage=2.1` });
  ok('画板卡开了(iframe 里有画布)', Boolean(await canvasUp()));
  await until(`Boolean(window.__cv_ready = document.body.classList.contains('live'))`, 8000);
  const lay = await evaluate(`(() => {
    const st = document.querySelector('#stage').getBoundingClientRect();
    const d = document.querySelector('#st-frame').contentDocument;
    const tools = d.querySelector('.canvas-tools');
    const hold = document.querySelector('#cv-hold'), hr = hold.getBoundingClientRect();
    return { cv: document.querySelector('#stage').classList.contains('cv'), st: [Math.round(st.left), Math.round(st.top), Math.round(st.width), Math.round(st.height)], vw: innerWidth, vh: innerHeight,
      ttl: document.querySelector('#st-ttl').textContent, promptInStage: Boolean(d.querySelector('.canvas-prompt')), full: Boolean(d.querySelector('.canvas-wrap.full')),
      toolsDir: tools ? getComputedStyle(tools).flexDirection : '', hold: getComputedStyle(hold).display !== 'none' && hr.width > 40, holdAt: [Math.round(hr.left), Math.round(hr.bottom)],
      board: (() => { const b = d.querySelector('.canvas-board').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })(),
      hint: (() => { const h = d.querySelector('.HintViewer'); return h ? getComputedStyle(h).display : 'none'; })() };
  })()`);
  ok('铺满:盖住整屏(左栏也盖了)', lay.cv && lay.st[0] === 0 && lay.st[1] === 0 && lay.st[2] >= lay.vw - 2 && lay.st[3] >= lay.vh - 2, JSON.stringify([...lay.st, lay.vw, lay.vh]));
  ok('题目一行在顶栏,舞台里不画题目条', lay.ttl.length > 2 && lay.ttl !== '画一画' && !lay.promptInStage && lay.full, lay.ttl);
  ok('工具一列,底下老师的小头像', lay.toolsDir === 'column' && lay.hold, JSON.stringify({ dir: lay.toolsDir, at: lay.holdAt }));
  ok('能画的地方比原来大(原来横屏 668×468)', lay.board[0] * lay.board[1] > 668 * 468 * 1.6, JSON.stringify(lay.board));
  ok('excalidraw 那句「点击并拖动」藏了', lay.hint === 'none', lay.hint);
  const ttlOpen = await evaluate(`(() => { document.querySelector('#st-ttl').click(); return document.querySelector('#st-ttl').classList.contains('open'); })()`);
  ok('点题目展开看全', ttlOpen);
  await evaluate(`document.querySelector('#st-ttl').click()`);

  ok('画三笔', /画了 3 笔/.test(await draw(THREE, RED)));
  const undone = await evaluate(`(async () => { const d = document.querySelector('#st-frame').contentDocument; [...d.querySelectorAll('.ct-btn')].find((b) => b.title === '撤销上一笔').click(); await new Promise((r) => setTimeout(r, 900)); return document.querySelector('#st-note').textContent; })()`);
  ok('撤销一笔 → 画了 2 笔', /画了 2 笔/.test(undone), undone);
  ok('再画一笔', /画了 3 笔/.test(await draw([THREE[0]], RED)));
  // 清空(点两下):清空前那一版导出一张图存起来
  const cleared = await evaluate(`(async () => { const d = document.querySelector('#st-frame').contentDocument; const b = [...d.querySelectorAll('.ct-btn')].find((x) => x.title === '清空'); b.click(); await new Promise((r) => setTimeout(r, 200)); [...d.querySelectorAll('.ct-btn')].find((x) => x.title === '再点一下就清空').click(); await new Promise((r) => setTimeout(r, 2000)); return document.querySelector('#st-note').textContent; })()`);
  const today = await evaluate(`fetch('/api/kid/conversations/chinese-tutor/today').then((r) => r.json())`);
  const cvCard = today.messages.flatMap((m) => (m.section?.cards ?? []).map((c) => c)).find((c) => c.kind === 'canvas' && c.state);
  ok('清空前那一版存了(状态里 cleared 带图,3 笔)', Boolean(cvCard?.state?.cleared?.[0]?.image) && cvCard.state.cleared[0].strokes === 3, JSON.stringify(cvCard?.state?.cleared ?? null) + ' ' + cleared);
  ok('再画两笔(蓝)', /画了 2 笔/.test(await draw(TWO, BLUE)));
  await shot('canvas-card-full.png');

  // 边画边聊:按住小头像说 1.2 秒 → release 带 chat(画板卡的 id、一张 jpeg、题目);假嘴接住一句,字幕浮在画布顶上;不起老师
  sent.length = 0;
  await until(`!document.body.classList.contains('pending')`, 15000);
  await press('#cv-hold', 1200);
  const rel = await (async () => { for (let i = 0; i < 20; i++) { const r = sent.find((x) => x.t === 'release'); if (r) return r; await sleep(150); } return null; })();
  if (!rel) console.log('  发出去的:', JSON.stringify(sent.map((x) => x.t)));
  ok('按住小头像说 → release 带 chat(画板卡、jpeg、题目)', Boolean(rel?.chat) && /^\d{4}-\d+\/\d+$/.test(rel.chat.canvas) && String(rel.chat.image).startsWith('data:image/jpeg') && Boolean(rel.chat.ask?.prompt), rel ? JSON.stringify({ ...rel, chat: rel.chat ? { ...rel.chat, image: String(rel.chat.image).slice(0, 24) } : null }) : '没发');
  ok('给嘴的题里有各颜色几笔(蓝 2)、清空过 1 次', rel?.chat?.ask?.colors?.[0]?.name === '蓝' && rel.chat.ask.colors[0].strokes === 2 && rel.chat.ask.cleared === 1, JSON.stringify(rel?.chat?.ask ?? null));
  const cap = await until(`(() => { const c = document.querySelector('#cv-cap'); return c.classList.contains('on') && c.textContent; })()`, 6000);
  ok('嘴接住的那句浮在画布顶上', Boolean(cap), String(cap));
  await shot('canvas-chat-caption.png');
  ok('边画边聊不起老师(板上没有在等老师)', !(await evaluate(`document.body.classList.contains('pending')`)));
  ok('嘴说完几秒字幕淡掉', Boolean(await until(`!document.querySelector('#cv-cap').classList.contains('on')`, 15000)));

  // 点「给老师看」:交了,舞台关、紧凑态出缩略图
  sent.length = 0;
  await press('#st-go', 80);
  const gone = await until(`!document.querySelector('#stage').classList.contains('on')`, 8000);
  const sub = sent.find((x) => x.t === 'send');
  ok('点「给老师看」= 只交画(send 带 action submit 与 focus)', Boolean(gone) && sub?.body?.action === 'submit' && Boolean(sub.body.focus?.card), JSON.stringify(sub?.body ?? null));
  ok('交过的画板卡有缩略图', Boolean(await until(`Boolean(document.querySelector('#board .c-canvas img'))`, 6000)));

  // ---- 二、左栏的纸 ----
  await send('Page.navigate', { url: `${base}/?tutor=math-tutor` });
  await until(`document.body.classList.contains('live') && Boolean(document.querySelector('#lv-paper'))`, 10000);
  await until(`!document.body.classList.contains('pending')`, 15000);
  const row = await evaluate(`(() => { const bs = [...document.querySelectorAll('#lv-tools button')]; return { names: bs.map((b) => b.textContent.trim()), gaps: bs.slice(1).map((b, i) => Math.round(b.querySelector('.ic').getBoundingClientRect().left - bs[i].querySelector('.ic').getBoundingClientRect().right)), right: Math.round(bs[bs.length - 1].getBoundingClientRect().right), lv: Math.round(document.querySelector('#lv').getBoundingClientRect().right) }; })()`);
  ok('左栏四个一排:画板 · 拍照 · 相册 · 打字,间距 24,不出白纸', row.names.join() === '画板,拍照,相册,打字' && row.gaps.every((g) => g === 24) && row.right <= row.lv, JSON.stringify(row));
  await shot('left-column.png');
  await press('#lv-paper', 80);
  ok('点「画板」→ 铺满的空白纸', Boolean(await canvasUp()) && (await evaluate(`document.querySelector('#stage').classList.contains('cv') && document.querySelector('#st-ttl').textContent === '画板' && document.querySelector('#st-go').disabled`)));
  ok('纸上画三笔', /画了 3 笔/.test(await draw(THREE, RED)));
  await sleep(600);
  await press('#st-x', 80);
  await until(`!document.querySelector('#stage').classList.contains('on')`, 4000);
  await press('#lv-paper', 80);
  await canvasUp();
  ok('关掉再开,纸还在(存在服务端)', /画了 3 笔/.test(String(await until(`(() => { const t = document.querySelector('#st-note').textContent; return /画了/.test(t) && t; })()`, 6000))));
  await shot('paper-open.png');

  // 按住「给老师看」说一句:画和这句话一起给老师(release 带 drawing,不带 chat)
  sent.length = 0;
  await press('#st-go', 1400);
  const give = await (async () => { for (let i = 0; i < 40; i++) { const r = sent.find((x) => x.t === 'release'); if (r) return r; await sleep(200); } return null; })();
  ok('按住「给老师看」说 → release 带 drawing(纸、captures/ 里的图),不带 chat', Boolean(give?.body?.drawing) && give.body.drawing.key && /^captures\//.test(give.body.drawing.image) && !give.chat, JSON.stringify(give ?? null));
  const card = await until(`(() => { const im = document.querySelector('#board .c-draw img'); return im && im.complete && im.naturalWidth > 0 && { w: im.naturalWidth, t: document.querySelector('#board .c-draw b').textContent }; })()`, 15000);
  ok('板上节前一张孩子的画卡(真图、几笔)', Boolean(card) && /画了 3 笔/.test(card.t), JSON.stringify(card));
  await until(`!document.body.classList.contains('pending')`, 20000);
  await shot('paper-drawing-card.png');
  await press('#board .c-draw .dw-go', 80);
  await canvasUp();
  ok('「接着画」又打开那张纸(还是 3 笔,没锁)', /画了 3 笔/.test(String(await until(`(() => { const t = document.querySelector('#st-note').textContent; return /画了/.test(t) && t; })()`, 6000))) && !(await evaluate(`document.querySelector('#st-go').hidden`)));

  // 嘴主动说一句:红的再画到 ≥ 5 笔、换蓝画一笔、停笔;点开 20 秒后孩子端发 chat(说红色),假嘴说一句、回 said
  sent.length = 0;
  const opened = Date.now();
  await draw(TWO, RED);
  await draw([[[600, 400], [640, 420]]], BLUE);
  const look = await (async () => { for (let i = 0; i < 160; i++) { const r = sent.find((x) => x.t === 'chat'); if (r) return r; await sleep(250); } return null; })();
  ok('换了颜色、停笔:点开 20 秒后孩子端让嘴主动说一句(说红色、带一张 jpeg)', Boolean(look) && look.ask?.color === '红' && String(look.image).startsWith('data:image/jpeg') && Date.now() - opened >= 20_000, look ? JSON.stringify({ ...look, image: String(look.image).slice(0, 24) }) : '没发');
  const said = await until(`(() => { const c = document.querySelector('#cv-cap'); return c.classList.contains('on') && c.textContent; })()`, 6000);
  ok('嘴说的那句浮在画布顶上', /红色/.test(String(said)), String(said));
  await shot('paper-chat-look.png');
} catch (err) {
  bad++;
  console.error('✗ 探针出错:', err instanceof Error ? err.stack : err);
} finally {
  console.log(`截图在 ${shots}`);
  ws.close();
  proc.kill();
  process.exitCode = bad ? 1 : 0;
}
