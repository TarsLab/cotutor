/**
 * /xlaoshi:小老师的页面(家长用,孩子端没有入口;原型 https://claude.ai/artifact/RyBTC8csepmjP4GVCMzcag)。
 * 五屏同一页,按 hash 切:#/ 出题与讲过的、#/talk/<id> 边画边讲、#/review/<id> 回看与改转写、#/notes/<id> 初步理解、#/ask/<id>/<k> 当面追问。
 * 画板自己一张 canvas(不进舞台包);一笔 = 颜色 + 粗细 + [x, y, 离开始讲的毫秒];原声 MediaRecorder,同时浏览器一句一句地认。
 * 内联脚本里不写反斜杠、不写反引号、不写美元加花括号(这是模板字符串,见 CLAUDE.md「坑」)。
 */
export const XLAOSHI_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>小老师</title>
<style>
  :root { --ink:#2b2b2b; --dim:#66625b; --line:#e2dfd6; --line2:#d8d4c9; --bg:#f6f4ef; --paper:#fffdf8; --card:#ffffff;
    --clay:#c95a22; --clay-ink:#8f3c14; --clay-bg:#fbeee6; --blue:#2f6fd6; --blue-ink:#1f56b3; --blue-bg:#e6eefb; --red:#d23f1f; --red-ink:#a3301a; --red-bg:#fbe9e3; --chip:#ebe7de; --chip-ink:#4f4b45; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { margin:0; height:100%; background:var(--bg); color:var(--ink); font:16px/1.5 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; overscroll-behavior:none; }
  button,input,textarea { font:inherit; color:inherit; }
  button { cursor:pointer; }
  button:disabled { opacity:.4; cursor:default; }
  a { color:var(--clay-ink); }
  .view { display:none; height:100%; }
  .view.on { display:flex; }
  .pill { height:48px; border-radius:24px; border:1.5px solid var(--line2); background:#fff; padding:0 18px; display:inline-flex; align-items:center; gap:8px; font-size:16px; }
  .pill.main { background:var(--clay); border-color:var(--clay); color:#fff; font-weight:700; font-size:18px; height:52px; border-radius:26px; padding:0 24px; }
  .pill.blue { background:var(--blue); border-color:var(--blue); color:#fff; font-weight:700; }
  .round { width:44px; height:44px; border-radius:22px; background:#fff; border:1px solid var(--line); display:grid; place-items:center; color:var(--dim); flex:none; padding:0; }
  .chip { font-size:13px; color:var(--chip-ink); background:var(--chip); border-radius:10px; padding:3px 9px; white-space:nowrap; }
  .chip.b { color:var(--blue-ink); background:var(--blue-bg); }
  .chip.c { color:var(--clay-ink); background:var(--clay-bg); }
  .chip.r { color:var(--red-ink); background:var(--red-bg); }
  .muted { color:var(--dim); }
  .small { font-size:13px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; }
  .head { display:flex; align-items:center; gap:12px; }
  .head .t { display:flex; flex-direction:column; line-height:1.3; min-width:0; }
  .head .t b { font-size:20px; }
  .toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%); background:#2b2b2b; color:#fff; border-radius:20px; padding:10px 18px; font-size:15px; z-index:50; display:none; }
  .toast.on { display:block; }

  /* 出题 */
  #v-list { flex-direction:column; gap:20px; padding:24px 32px; overflow:auto; }
  #v-list h1 { margin:0; font-size:28px; }
  #list-grid { display:grid; grid-template-columns:minmax(0,480px) minmax(0,1fr); gap:24px; align-items:start; }
  #new { padding:24px; display:flex; flex-direction:column; gap:14px; }
  #topic { font-size:21px; line-height:1.45; border:1.5px solid var(--line2); border-radius:12px; padding:12px 14px; resize:none; background:var(--paper); min-height:110px; }
  #sessions { display:flex; flex-direction:column; gap:12px; min-width:0; }
  .sess { display:flex; gap:14px; padding:14px 16px; text-align:left; border:1px solid var(--line); background:#fff; border-radius:14px; width:100%; }
  .sess img { width:120px; height:70px; object-fit:contain; border-radius:8px; background:#fff; border:1px solid var(--line); flex:none; }
  .sess .bd { display:flex; flex-direction:column; gap:6px; min-width:0; }
  .sess .tp { font-size:18px; font-weight:600; }
  .sess .cs { display:flex; gap:6px; flex-wrap:wrap; }
  @media (max-width: 820px) { #list-grid { grid-template-columns:minmax(0,1fr); } #v-list { padding:16px; } }

  /* 边画边讲(孩子看) */
  #v-talk { display:none; background:var(--paper); padding:12px; gap:12px; }
  #v-talk.on { display:grid; grid-template-columns:88px minmax(0,1fr); grid-template-rows:56px minmax(0,1fr) 56px; }
  #tools { grid-column:1; grid-row:1 / 3; display:flex; flex-direction:column; align-items:center; gap:10px; }
  .tool { width:72px; height:72px; border-radius:20px; border:1.5px solid var(--line); background:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; padding:0; font-size:14px; }
  .tool.on { background:var(--ink); border-color:var(--ink); color:#fff; font-weight:700; }
  .dot { width:44px; height:44px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 0 1.5px var(--line2); padding:0; }
  .dot.on { box-shadow:0 0 0 3px var(--ink); }
  #talk-top { grid-column:2; grid-row:1; display:flex; align-items:center; gap:16px; min-width:0; }
  #talk-topic { font-size:23px; font-weight:600; line-height:1.3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #rec { flex:none; height:40px; border-radius:20px; background:var(--red-bg); color:var(--red-ink); font-weight:600; display:none; align-items:center; gap:10px; padding:0 16px 0 14px; font-variant-numeric:tabular-nums; }
  #rec.on { display:inline-flex; }
  #rec i { width:12px; height:12px; border-radius:50%; background:var(--red); }
  #rec .lv { display:flex; gap:3px; align-items:center; height:18px; }
  #rec .lv span { width:4px; border-radius:2px; background:var(--red); height:4px; }
  #board-wrap { grid-column:2; grid-row:2; position:relative; border-radius:12px; background:#fff; box-shadow:0 0 0 1px #e9e5db; overflow:hidden; min-height:0; }
  #board { position:absolute; inset:0; width:100%; height:100%; touch-action:none; display:block; }
  #start { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; background:rgba(255,253,248,.92); }
  #start[hidden] { display:none; }
  #talk-bot { grid-column:2; grid-row:3; display:flex; align-items:center; gap:16px; }

  /* 回看 */
  #v-review { padding:20px 24px; gap:20px; }
  #rv-left { flex:1; min-width:0; display:flex; flex-direction:column; gap:12px; }
  .stage { position:relative; border-radius:12px; background:#fff; box-shadow:0 0 0 1px var(--line); overflow:hidden; }
  .stage canvas { display:block; width:100%; height:100%; }
  .ctl { display:flex; align-items:center; gap:14px; }
  .play { width:52px; height:52px; border-radius:26px; border:none; background:var(--clay); color:#fff; display:grid; place-items:center; padding:0; flex:none; }
  .track { flex:1; min-width:0; height:48px; display:flex; align-items:center; gap:3px; cursor:pointer; touch-action:none; }
  .track i { height:6px; border-radius:3px; background:#ddd8cc; position:relative; overflow:hidden; display:block; }
  .track i b { position:absolute; left:0; top:0; bottom:0; background:var(--clay); width:0; }
  .tm { flex:none; font-size:17px; font-variant-numeric:tabular-nums; }
  #rv-right { width:380px; flex:none; padding:16px; display:flex; flex-direction:column; gap:6px; min-height:0; }
  #rv-lines { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:2px; }
  .ln { display:flex; gap:10px; align-items:baseline; padding:7px 8px; border-radius:10px; }
  .ln.on { background:var(--clay-bg); }
  .ln .at { flex:none; width:40px; font-size:13px; color:var(--dim); font-variant-numeric:tabular-nums; border:none; background:none; padding:0; text-align:left; }
  .ln .tx { font-size:17px; line-height:1.5; flex:1; min-width:0; border:none; background:none; padding:0; text-align:left; }
  .ln input { flex:1; min-width:0; font-size:17px; border:1.5px solid var(--clay); border-radius:8px; padding:2px 6px; }
  #cc { background:var(--bg); border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:8px; }
  #cc code { flex:1; min-width:0; font-size:13px; background:#fff; border:1px solid var(--line); border-radius:8px; padding:8px 10px; word-break:break-all; -webkit-user-select:all; user-select:all; }
  @media (max-width: 900px) { #v-review.on { flex-direction:column; overflow:auto; } #rv-right { width:auto; } }

  /* 初步理解 */
  #v-notes { flex-direction:column; gap:16px; padding:20px 24px; overflow:auto; }
  #nt-grid { display:grid; grid-template-columns:minmax(0,1fr) 440px; gap:20px; align-items:start; }
  #nt-left { padding:20px 22px; display:flex; flex-direction:column; gap:18px; }
  #nt-left h3 { margin:0 0 6px; font-size:15px; }
  #nt-left ul { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:8px; }
  #nt-left li { font-size:17px; line-height:1.6; }
  .tchip { border:1px solid #c9d8f3; background:#f2f6fd; color:var(--blue-ink); border-radius:14px; font-size:14px; padding:2px 10px; margin-left:6px; font-variant-numeric:tabular-nums; }
  #nt-right { padding:20px; display:flex; flex-direction:column; gap:10px; }
  .q { display:flex; gap:12px; align-items:flex-start; padding:12px; border-radius:12px; background:#fbf8f2; }
  .q input { width:24px; height:24px; margin:3px 0 0; accent-color:var(--clay); flex:none; }
  .q label { display:flex; flex-direction:column; gap:4px; }
  @media (max-width: 900px) { #nt-grid { grid-template-columns:minmax(0,1fr); } }

  /* 当面追问 */
  #v-ask { flex-direction:column; gap:16px; padding:20px 24px; background:var(--paper); }
  #ak-grid { flex:1; min-height:0; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:24px; }
  #ak-left { display:flex; flex-direction:column; gap:10px; min-height:0; }
  #ak-left .stage { flex:1; min-height:0; }
  #ak-board { position:absolute; inset:0; width:100%; height:100%; touch-action:none; display:none; }
  #ak-q { margin:0; font-size:28px; line-height:1.5; font-weight:600; }
  #ak-right { display:flex; flex-direction:column; gap:14px; min-width:0; }
  #ak-heard { background:#fff; border:1px solid #e9e5db; border-radius:14px; padding:12px 14px; min-height:72px; font-size:17px; }
  #ak-note { font-size:16px; height:44px; border:1.5px solid var(--line2); border-radius:10px; padding:0 12px; background:#fff; }
  @media (max-width: 900px) { #ak-grid { grid-template-columns:minmax(0,1fr); } #v-ask { overflow:auto; } #ak-left .stage { min-height:260px; } }
</style></head><body>

<section class="view" id="v-list">
  <div class="head"><h1>小老师</h1><span class="chip">家长用 · 孩子端看不到这一页</span><div style="flex:1"></div><span class="muted small" id="keyline"></span></div>
  <div id="list-grid">
    <div class="card" id="new">
      <label for="topic" style="font-size:15px;font-weight:600;color:var(--dim)">出一道题</label>
      <textarea id="topic" rows="3" placeholder="18 张贴纸平均分给 3 个人,每人几张?讲给我听。"></textarea>
      <p class="muted" style="margin:0;font-size:15px">把 iPad 递给他。他点「开始讲」才录,讲完点「讲完了」。</p>
      <div><button class="pill main" id="go">交给他 ›</button></div>
      <p class="muted small" style="margin:0">存在 workspace 的 xlaoshi/ 下。不进对话、不算条数、录像里没有。</p>
    </div>
    <div id="sessions"></div>
  </div>
</section>

<section class="view" id="v-talk">
  <div id="tools">
    <button class="tool on" data-tool="pen" type="button">笔</button>
    <button class="tool" data-tool="erase" type="button">橡皮</button>
    <div style="display:flex;flex-direction:column;gap:8px;padding:6px 0">
      <button class="dot on" data-color="#2b2b2b" aria-label="黑笔" style="background:#2b2b2b" type="button"></button>
      <button class="dot" data-color="#d23f1f" aria-label="红笔" style="background:#d23f1f" type="button"></button>
      <button class="dot" data-color="#2f6fd6" aria-label="蓝笔" style="background:#2f6fd6" type="button"></button>
    </div>
    <button class="tool" id="undo" type="button">撤销</button>
  </div>
  <div id="talk-top"><button class="round" id="talk-back" aria-label="回去" type="button">‹</button><span id="talk-topic"></span><div style="flex:1"></div><span id="rec"><i></i><span id="rec-t">0:00</span><span class="lv"></span></span></div>
  <div id="board-wrap"><canvas id="board"></canvas>
    <div id="start"><button class="pill main" id="start-btn" style="height:64px;font-size:22px;padding:0 36px">开始讲</button><span class="muted" id="start-tip">边画边讲,讲给我听</span></div>
  </div>
  <div id="talk-bot"><span class="muted" style="font-size:17px">边画边讲,讲给我听</span><div style="flex:1"></div><button class="pill main" id="done-btn" disabled>讲完了</button></div>
</section>

<section class="view" id="v-review">
  <div id="rv-left">
    <div class="head"><button class="round" id="rv-back" aria-label="回到小老师" type="button">‹</button><div class="t"><b id="rv-topic"></b><span class="muted small" id="rv-meta"></span></div></div>
    <div class="stage" id="rv-stage"><canvas id="rv-canvas"></canvas></div>
    <div class="ctl"><button class="play" id="rv-play" aria-label="放" type="button">▶</button><div class="track" id="rv-track"></div><span class="tm" id="rv-tm">0:00 / 0:00</span></div>
    <p class="muted small" style="margin:0">画面按记下的每一笔现画,声音是他的原声。一句一段;点哪就从哪放。</p>
    <audio id="rv-audio" preload="auto"></audio>
  </div>
  <div class="card" id="rv-right">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap"><b style="font-size:17px">他说的</b><span class="muted small">点时刻跳过去,点字就能改</span></div>
    <div class="small" id="rv-src"></div>
    <div id="rv-lines"></div>
    <div id="cc">
      <span class="small" style="color:var(--chip-ink)">改好了,在 workspace 根目录开 Claude Code,说:</span>
      <div style="display:flex;gap:8px;align-items:center"><code id="cc-text"></code><button class="pill" id="cc-copy" style="height:40px;font-size:14px" type="button">复制</button></div>
      <div id="cc-next" class="small"></div>
    </div>
  </div>
</section>

<section class="view" id="v-notes">
  <div class="head"><button class="round" id="nt-back" aria-label="回到回看" type="button">‹</button><div class="t"><b id="nt-topic"></b><span class="muted small" id="nt-meta"></span></div></div>
  <div id="nt-grid"><div class="card" id="nt-left"></div><div class="card" id="nt-right"></div></div>
</section>

<section class="view" id="v-ask">
  <div class="head"><span class="muted" id="ak-topic"></span><b id="ak-k"></b><div style="flex:1"></div><button class="pill" id="ak-stop" type="button">先到这里</button></div>
  <div id="ak-grid">
    <div id="ak-left">
      <div class="stage" id="ak-stage"><canvas id="ak-canvas"></canvas><canvas id="ak-board"></canvas></div>
      <div class="ctl"><button class="pill" id="ak-play" type="button">▶ 放你讲的这段</button><span class="muted" id="ak-range"></span></div>
    </div>
    <div id="ak-right">
      <p id="ak-q"></p>
      <p class="muted small" id="ak-detail" style="margin:-6px 0 0"></p>
      <div style="display:flex;gap:12px;flex-wrap:wrap"><button class="pill blue" id="ak-rec" type="button" style="height:56px;border-radius:28px">● 录他说的</button><button class="pill" id="ak-draw" type="button" style="height:56px;border-radius:28px">画一画</button></div>
      <div id="ak-heard"><span class="muted small">听到的</span><div id="ak-heard-t"></div></div>
      <label class="muted small" for="ak-note">家长记一笔</label>
      <input id="ak-note" type="text" autocomplete="off">
      <div style="flex:1"></div>
      <div style="display:flex;justify-content:flex-end"><button class="pill main" id="ak-next" type="button">下一个 ›</button></div>
    </div>
  </div>
</section>

<div class="toast" id="toast"></div>

<script>
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var NL = String.fromCharCode(10);
  var clock = function (ms) { var s = Math.max(0, Math.floor(ms / 1000)); var m = Math.floor(s / 60); var r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; };
  var esc = function (s) { return String(s).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;'); };
  var toastT = 0;
  var toast = function (t) { var el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('on'); }, 2600); };
  var api = function (method, path, body) {
    return fetch(path, { method: method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.message || j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; } return j; }); });
  };
  var blobToDataUrl = function (b) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result)); }; fr.onerror = rej; fr.readAsDataURL(b); }); };
  var dateOf = function (iso) { var d = new Date(iso); var p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };

  // ---------- 画:按时刻 t 把笔迹画到一张 canvas 上(回放、追问时放那段)----------
  var fitCanvas = function (cv) { var r = cv.getBoundingClientRect(); var dpr = window.devicePixelRatio || 1; cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr)); return { w: r.width, h: r.height, dpr: dpr }; };
  var strokePath = function (g, st, k, upto) {
    var pts = st.pts; var n = 0;
    g.strokeStyle = st.c === 'erase' ? '#ffffff' : st.c; g.fillStyle = g.strokeStyle; g.lineWidth = st.w * k;
    g.beginPath();
    for (var i = 0; i < pts.length; i++) { if (pts[i][2] > upto) break; if (i === 0) g.moveTo(pts[i][0] * k, pts[i][1] * k); else g.lineTo(pts[i][0] * k, pts[i][1] * k); n++; }
    if (n === 1) { g.beginPath(); g.arc(pts[0][0] * k, pts[0][1] * k, st.w * k / 2, 0, Math.PI * 2); g.fill(); } else if (n > 1) g.stroke();
  };
  /** 把 data(size + strokes)画进 canvas,画板按比例居中放 */
  var drawAt = function (cv, data, t) {
    var g = cv.getContext('2d'); var dpr = window.devicePixelRatio || 1;
    var W = cv.width / dpr, H = cv.height / dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    if (!data) return;
    var k = Math.min(W / data.size.w, H / data.size.h); var ox = (W - data.size.w * k) / 2, oy = (H - data.size.h * k) / 2;
    g.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr); g.lineCap = 'round'; g.lineJoin = 'round';
    for (var i = 0; i < data.strokes.length; i++) { var st = data.strokes[i]; if (st.pts[0][2] > t) continue; if (st.gone !== undefined && st.gone <= t) continue; strokePath(g, st, k, t); }
  };

  // ---------- 画板:记每一笔(点带时刻)----------
  /** 换一张新的 canvas(旧的连同它身上的监听一起扔掉;同一页里进几次画板不串) */
  var freshCanvas = function (sel) { var old = $(sel); var cv = old.cloneNode(false); old.parentNode.replaceChild(cv, old); return cv; };
  var makeBoard = function (cv, now) {
    var size = fitCanvas(cv); var data = { size: { w: Math.round(size.w), h: Math.round(size.h) }, strokes: [] };
    var tool = { c: '#2b2b2b', erase: false }; var cur = null; var sawPen = false; var on = false;
    var g = cv.getContext('2d');
    var redraw = function () { drawAt(cv, data, Number.MAX_SAFE_INTEGER); };
    redraw();
    var pos = function (e) { var r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10]; };
    cv.addEventListener('pointerdown', function (e) {
      if (!on) return;
      if (e.pointerType === 'pen') sawPen = true; else if (e.pointerType === 'touch' && sawPen) return; // 用过笔就不认手掌
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      var p = pos(e); cur = { id: e.pointerId, s: { c: tool.erase ? 'erase' : tool.c, w: tool.erase ? 28 : 4, pts: [[p[0], p[1], now()]] } };
      data.strokes.push(cur.s);
      var dpr = window.devicePixelRatio || 1; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.lineCap = 'round'; g.lineJoin = 'round';
      g.fillStyle = cur.s.c === 'erase' ? '#ffffff' : cur.s.c; g.beginPath(); g.arc(p[0], p[1], cur.s.w / 2, 0, Math.PI * 2); g.fill();
      e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      if (!cur || e.pointerId !== cur.id) return;
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; if (!evs.length) evs = [e];
      var dpr = window.devicePixelRatio || 1; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.strokeStyle = cur.s.c === 'erase' ? '#ffffff' : cur.s.c; g.lineWidth = cur.s.w; g.lineCap = 'round';
      for (var i = 0; i < evs.length; i++) {
        var p = pos(evs[i]); var last = cur.s.pts[cur.s.pts.length - 1];
        if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 1.5) continue;
        g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(p[0], p[1]); g.stroke();
        cur.s.pts.push([p[0], p[1], now()]);
      }
      e.preventDefault();
    });
    var up = function (e) { if (cur && e.pointerId === cur.id) cur = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    return {
      data: data,
      enable: function (v) { on = v; },
      color: function (c) { tool.c = c; tool.erase = false; },
      eraser: function () { tool.erase = true; },
      undo: function () { var t = now(); for (var i = data.strokes.length - 1; i >= 0; i--) { if (data.strokes[i].gone === undefined) { data.strokes[i].gone = t; break; } } redraw(); },
      clear: function () { var t = now(); for (var i = 0; i < data.strokes.length; i++) if (data.strokes[i].gone === undefined) data.strokes[i].gone = t; redraw(); },
      drew: function () { return data.strokes.length; }
    };
  };

  // ---------- 录:原声 + 浏览器一句一句地认 + 每 100 毫秒的音量 ----------
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recMime = function () { var ts = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg']; for (var i = 0; i < ts.length; i++) { try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(ts[i])) return ts[i]; } catch (e) {} } return ''; };
  /** 开始录;t0 是共同的零点(performance.now());返回 stop() → Promise<{blob, segs, levels, sr}> */
  var startRecording = function (t0, hooks) {
    var st = { stream: null, mr: null, chunks: [], ac: null, an: null, buf: null, timer: 0, levels: [], segs: [], live: true, r: null, cur: null, broke: 0, srOn: Boolean(SR) };
    var now = function () { return Math.round(performance.now() - t0); };
    var listenOnce = function () {
      if (!st.live || !st.srOn) return;
      var r; try { r = new SR(); } catch (e) { st.srOn = false; return; }
      r.lang = 'zh-CN'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
      var seg = { at: -1, end: 0, text: '', began: now() };
      var mark = function () { if (seg.at < 0) seg.at = now(); };
      r.addEventListener('soundstart', mark); r.addEventListener('speechstart', mark);
      r.onresult = function (e) { var s = ''; for (var i = 0; i < e.results.length; i++) s += e.results[i][0].transcript; if (seg.at < 0) seg.at = Math.max(seg.began, now() - 800); seg.text = s; seg.end = now(); if (hooks.onText) hooks.onText(st.segs.map(function (x) { return x.text; }).concat([s]).join('，')); };
      r.onerror = function (e) { seg.err = String(e && e.error); if (seg.err === 'not-allowed' || seg.err === 'service-not-allowed') st.srOn = false; };
      r.onend = function () {
        st.r = null;
        if (seg.text.trim()) { st.segs.push({ at: seg.at, end: seg.end, text: seg.text.trim() }); st.broke = 0; }
        else if (now() - seg.began < 500 && seg.err && seg.err !== 'no-speech') st.broke++;
        if (st.broke >= 5) st.srOn = false; // 一起就断,连着五回:这台的识别不行,只录原声
        if (st.ending) { st.ending(); return; }
        if (st.live) setTimeout(listenOnce, 60);
      };
      st.r = r;
      try { r.start(); } catch (e) { st.r = null; st.broke++; if (st.broke < 5 && st.live) setTimeout(listenOnce, 300); else st.srOn = false; }
    };
    var ready = navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      st.stream = stream;
      try {
        var AC = window.AudioContext || window.webkitAudioContext; st.ac = new AC(); st.an = st.ac.createAnalyser(); st.an.fftSize = 512; st.buf = new Float32Array(512);
        st.ac.createMediaStreamSource(stream).connect(st.an); if (st.ac.state === 'suspended') st.ac.resume();
      } catch (e) { st.an = null; }
      var mime = recMime();
      try { st.mr = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 }) : new MediaRecorder(stream); } catch (e) { st.mr = null; }
      if (st.mr) { st.mr.ondataavailable = function (e) { if (e.data && e.data.size) st.chunks.push(e.data); }; st.mr.start(1000); }
      t0 = performance.now(); // 零点 = 录音真开始的那一刻
      st.timer = setInterval(function () {
        var v = 0;
        if (st.an) { st.an.getFloatTimeDomainData(st.buf); var sum = 0; for (var i = 0; i < st.buf.length; i++) sum += st.buf[i] * st.buf[i]; v = Math.min(100, Math.round(Math.sqrt(sum / st.buf.length) * 4 * 100)); }
        st.levels.push(v); if (hooks.onLevel) hooks.onLevel(v);
      }, 100);
      listenOnce();
      return t0;
    });
    return {
      ready: ready,
      now: now,
      srOn: function () { return st.srOn; },
      stop: function () {
        st.live = false; clearInterval(st.timer);
        var srDone = new Promise(function (res) {
          if (!st.r) { res(); return; }
          var t = setTimeout(res, 2000); st.ending = function () { clearTimeout(t); res(); };
          try { st.r.stop(); } catch (e) { res(); }
        });
        var mrDone = new Promise(function (res) {
          if (!st.mr || st.mr.state === 'inactive') { res(); return; }
          st.mr.onstop = function () { res(); }; try { st.mr.stop(); } catch (e) { res(); }
        });
        var ms = now();
        return Promise.all([srDone, mrDone]).then(function () {
          if (st.stream) st.stream.getTracks().forEach(function (t) { t.stop(); });
          if (st.ac) { try { st.ac.close(); } catch (e) {} }
          var type = (st.mr && st.mr.mimeType) || 'audio/webm';
          return { ms: ms, blob: st.chunks.length ? new Blob(st.chunks, { type: type.split(';')[0] }) : null, segs: st.segs, levels: st.levels, sr: Boolean(SR) && st.srOn };
        });
      }
    };
  };

  // ---------- 切屏 ----------
  var S = { view: '', data: null, poll: 0 };
  var show = function (name) { document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('on', v.id === 'v-' + name); }); S.view = name; };
  var go = function (h) { if (location.hash === h) route(); else location.hash = h; };
  var stopPoll = function () { clearInterval(S.poll); S.poll = 0; };

  // ---------- 1 出题与讲过的 ----------
  var renderList = function () {
    show('list'); stopPoll();
    api('GET', '/api/xlaoshi').then(function (j) {
      $('#keyline').textContent = j.hasKey ? '' : '拿不到百炼 key:浏览器认不好时没法叫 paraformer 补转';
      var box = $('#sessions'); box.innerHTML = '<span style="font-size:15px;font-weight:600;color:var(--dim)">讲过的</span>';
      if (!j.sessions.length) box.insertAdjacentHTML('beforeend', '<p class="muted">还没有。左边出一道题。</p>');
      j.sessions.forEach(function (s) {
        var chips = [];
        if (s.ms === null) chips.push('<span class="chip">开始了,没讲</span>');
        else {
          if (s.asr && s.asr.state === 'running') chips.push('<span class="chip c">paraformer 在转</span>');
          if (s.asr && s.asr.state === 'failed') chips.push('<span class="chip r">补转没成</span>');
          if (s.transcript) chips.push('<span class="chip b">' + (s.transcript.source === 'paraformer' ? 'paraformer 转的' : '浏览器转的') + (s.transcript.edited ? ' · 改了 ' + s.transcript.edited + ' 处' : '') + '</span>');
          else chips.push('<span class="chip">没有转写</span>');
          chips.push(s.notes ? '<span class="chip b">Claude Code 看过</span>' : '<span class="chip">还没给 Claude Code 看</span>');
          if (s.notes) chips.push(s.asks ? '<span class="chip b">问了 ' + s.asks + ' 个</span>' : '<span class="chip c">追问 ' + s.questions + ' 个,还没问</span>');
        }
        if (s.memo) chips.push('<span class="chip">家长记:' + esc(s.memo) + '</span>');
        var meta = dateOf(s.createdAt) + (s.ms !== null ? ' · 讲了 ' + clock(s.ms) + ' · 画了 ' + s.strokes + ' 笔' : '');
        var img = s.strokes ? '<img alt="" src="/api/xlaoshi/' + s.id + '/frame.png?w=240">' : '';
        var b = document.createElement('button'); b.type = 'button'; b.className = 'sess';
        b.innerHTML = img + '<span class="bd"><span class="muted small">' + meta + '</span><span class="tp">' + esc(s.topic) + '</span><span class="cs">' + chips.join('') + '</span></span>';
        b.onclick = function () {
          if (s.ms !== null) { go(s.notes ? '#/notes/' + s.id : '#/review/' + s.id); return; }
          var m = prompt('这道题他还没讲。记一句(比如「他说不想录」),或者留空直接去讲:', s.memo || '');
          if (m === null) return;
          if (m.trim()) api('PUT', '/api/xlaoshi/' + s.id + '/memo', { memo: m }).then(renderList);
          else go('#/talk/' + s.id);
        };
        box.appendChild(b);
      });
    }).catch(function (e) { toast('读不到:' + e.message); });
  };
  $('#go').onclick = function () {
    var t = $('#topic').value.trim(); if (!t) { $('#topic').focus(); return; }
    api('POST', '/api/xlaoshi', { topic: t }).then(function (j) { $('#topic').value = ''; go('#/talk/' + j.id); }).catch(function (e) { toast(e.message); });
  };

  // ---------- 2 边画边讲 ----------
  var T = null;
  var renderTalk = function (id) {
    show('talk'); stopPoll();
    api('GET', '/api/xlaoshi/' + id).then(function (d) {
      if (d.ms !== null) { go('#/review/' + id); return; }
      $('#talk-topic').textContent = d.topic;
      $('#start').hidden = false; $('#done-btn').disabled = true; $('#rec').classList.remove('on');
      $('#start-tip').textContent = window.MediaRecorder ? '边画边讲,讲给我听' : '这个浏览器录不了音,只记笔迹';
      var t = { id: id, board: null, rec: null, tick: 0, t0: performance.now(), lv: [] };
      t.board = makeBoard(freshCanvas('#board'), function () { return Math.round(performance.now() - t.t0); });
      T = t;
      $('#rec .lv').innerHTML = '<span></span><span></span><span></span><span></span><span></span>';
    }).catch(function (e) { toast(e.message); go('#/'); });
  };
  document.querySelectorAll('#tools .tool[data-tool]').forEach(function (b) {
    b.onclick = function () { if (!T) return; document.querySelectorAll('#tools .tool[data-tool]').forEach(function (x) { x.classList.toggle('on', x === b); }); if (b.dataset.tool === 'erase') T.board.eraser(); else { var c = document.querySelector('#tools .dot.on'); T.board.color(c ? c.dataset.color : '#2b2b2b'); } };
  });
  document.querySelectorAll('#tools .dot').forEach(function (b) {
    b.onclick = function () { if (!T) return; document.querySelectorAll('#tools .dot').forEach(function (x) { x.classList.toggle('on', x === b); }); document.querySelectorAll('#tools .tool[data-tool]').forEach(function (x) { x.classList.toggle('on', x.dataset.tool === 'pen'); }); T.board.color(b.dataset.color); };
  });
  $('#undo').onclick = function () { if (T) T.board.undo(); };
  $('#talk-back').onclick = function () {
    if (T && T.rec && !confirm('还在录。不要这一次了?')) return;
    if (T && T.rec) T.rec.stop(); clearInterval(T && T.tick); T = null; go('#/');
  };
  $('#start-btn').onclick = function () {
    if (!T) return;
    var t = T;
    var bars = document.querySelectorAll('#rec .lv span');
    var go2 = function (zero) {
      t.t0 = zero; t.board.enable(true); $('#start').hidden = true; $('#done-btn').disabled = false; $('#rec').classList.add('on');
      t.tick = setInterval(function () { var ms = performance.now() - t.t0; $('#rec-t').textContent = '在录 ' + clock(ms); if (ms > 10 * 60000) $('#done-btn').click(); }, 250);
    };
    if (!window.MediaRecorder || !navigator.mediaDevices) { go2(performance.now()); return; }
    $('#start-btn').disabled = true;
    t.rec = startRecording(performance.now(), { onLevel: function (v) { t.lv.push(v); if (t.lv.length > 5) t.lv.shift(); for (var i = 0; i < bars.length; i++) bars[i].style.height = (4 + Math.round((t.lv[i] || 0) / 100 * 14)) + 'px'; } });
    t.rec.ready.then(function (zero) { $('#start-btn').disabled = false; go2(zero); }, function (e) { $('#start-btn').disabled = false; t.rec = null; toast('开不了麦克风:' + (e && (e.name || e.message))); });
  };
  // 画板的零点跟着录音走:makeBoard 用的 now() 读的是 T.t0
  $('#done-btn').onclick = function () {
    if (!T) return;
    var t = T; T = null; clearInterval(t.tick); t.board.enable(false);
    $('#done-btn').disabled = true; $('#rec-t').textContent = '正在存…';
    var strokes = t.board.data;
    var finish = t.rec ? t.rec.stop() : Promise.resolve({ ms: Math.round(performance.now() - t.t0), blob: null, segs: [], levels: [], sr: false });
    finish.then(function (r) {
      var up = r.blob ? blobToDataUrl(r.blob).then(function (u) { return api('PUT', '/api/xlaoshi/' + t.id + '/audio', { data: u }).then(function (j) { return j.audio; }); }) : Promise.resolve(null);
      return up.then(function (audio) { return api('PUT', '/api/xlaoshi/' + t.id + '/talk', { ms: r.ms, sr: r.sr, levels: r.levels, segs: r.segs, strokes: strokes, audio: audio }); });
    }).then(function (j) { if (j.need) toast('浏览器那份不够(' + j.why + '),' + (j.asr === 'started' ? '叫 paraformer 补转了' : j.asr === 'nokey' ? '可拿不到百炼 key' : '没法补转')); go('#/review/' + t.id); })
      .catch(function (e) { toast('没存上:' + e.message); $('#done-btn').disabled = false; });
  };

  // ---------- 回放器:一个时钟,原声当钟,画面跟着 ----------
  var makePlayer = function (cv, audio, data, total, onTime) {
    var P = { t: 0, playing: false, raf: 0, from: 0, to: total, wall: 0, hasAudio: false };
    var paint = function () { drawAt(cv, data, P.t); if (onTime) onTime(P.t); };
    var loop = function () {
      if (!P.playing) return;
      P.t = P.hasAudio && !audio.paused ? audio.currentTime * 1000 : performance.now() - P.wall;
      if (P.t >= P.to) { P.t = P.to; P.pause(); paint(); return; }
      paint(); P.raf = requestAnimationFrame(loop);
    };
    P.seek = function (ms) { P.t = Math.max(0, Math.min(total, ms)); if (P.hasAudio) { try { audio.currentTime = P.t / 1000; } catch (e) {} } P.wall = performance.now() - P.t; paint(); };
    P.play = function (from, to) {
      if (from !== undefined) P.seek(from); P.to = to !== undefined ? to : total;
      if (P.t >= P.to - 50) P.seek(from !== undefined ? from : 0);
      P.playing = true; P.wall = performance.now() - P.t;
      if (P.hasAudio) audio.play().catch(function () { P.pause(); }); // 不在手势里放会被拦:停下,等人点
      cancelAnimationFrame(P.raf); loop(); if (P.onState) P.onState(true);
    };
    P.pause = function () { P.playing = false; cancelAnimationFrame(P.raf); if (P.hasAudio) audio.pause(); if (P.onState) P.onState(false); };
    P.setAudio = function (src) { P.hasAudio = Boolean(src); if (src) { audio.src = src; audio.load(); } else audio.removeAttribute('src'); };
    P.paint = paint;
    return P;
  };

  // ---------- 3 回看与改转写 ----------
  var R = null;
  var renderReview = function (id, at) {
    show('review'); stopPoll();
    api('GET', '/api/xlaoshi/' + id).then(function (d) {
      if (d.ms === null) { go('#/talk/' + id); return; }
      S.data = d;
      $('#rv-topic').textContent = d.topic;
      $('#rv-meta').textContent = dateOf(d.createdAt) + ' · 讲了 ' + clock(d.ms) + ' · 画了 ' + d.strokes + ' 笔';
      var stage = $('#rv-stage'); var sz = d.strokesData ? d.strokesData.size : { w: 16, h: 9 };
      stage.style.aspectRatio = sz.w + ' / ' + sz.h; stage.style.maxHeight = 'calc(100vh - 220px)';
      requestAnimationFrame(function () {
        fitCanvas($('#rv-canvas'));
        if (R && R.player) R.player.pause();
        var player = makePlayer($('#rv-canvas'), $('#rv-audio'), d.strokesData, d.ms, function (t) { reviewTime(t); });
        player.onState = function (p) { $('#rv-play').textContent = p ? '❚❚' : '▶'; };
        player.setAudio(d.talk && d.talk.audio ? '/api/xlaoshi/' + id + '/audio?v=' + encodeURIComponent(d.talk.audio) : null);
        R = { id: id, d: d, player: player, editing: -1 };
        renderLines(); renderTrack(); renderAsr(); renderCC();
        player.seek(at !== undefined ? at : d.ms);
      });
      S.poll = setInterval(function () { refreshReview(id); }, 4000);
    }).catch(function (e) { toast(e.message); go('#/'); });
  };
  var refreshReview = function (id) {
    if (S.view !== 'review' || !R || R.id !== id || R.editing >= 0) return;
    api('GET', '/api/xlaoshi/' + id).then(function (d) {
      var changed = JSON.stringify(d.lines) !== JSON.stringify(R.d.lines);
      var asrChanged = JSON.stringify(d.asr) !== JSON.stringify(R.d.asr) || d.notes !== R.d.notes;
      R.d = d; if (changed) { renderLines(); renderTrack(); } if (asrChanged || changed) { renderAsr(); renderCC(); }
    }).catch(function () {});
  };
  var spans = function () {
    var L = R.d.lines, total = R.d.ms, out = [];
    if (!L.length) return [{ from: 0, to: total }];
    if (L[0].at > 0) out.push({ from: 0, to: L[0].at });
    for (var i = 0; i < L.length; i++) out.push({ from: L[i].at, to: i + 1 < L.length ? L[i + 1].at : Math.max(total, L[i].at) });
    return out;
  };
  var renderTrack = function () {
    var tr = $('#rv-track'); tr.innerHTML = '';
    spans().forEach(function (s) { var i = document.createElement('i'); i.style.flex = Math.max(1, s.to - s.from) + ' 1 0'; i.innerHTML = '<b></b>'; i.dataset.from = s.from; i.dataset.to = s.to; tr.appendChild(i); });
  };
  var reviewTime = function (t) {
    if (!R) return;
    $('#rv-tm').textContent = clock(t) + ' / ' + clock(R.d.ms);
    document.querySelectorAll('#rv-track i').forEach(function (i) { var a = Number(i.dataset.from), b = Number(i.dataset.to); i.firstChild.style.width = (t >= b ? 100 : t <= a ? 0 : (t - a) / Math.max(1, b - a) * 100) + '%'; });
    var L = R.d.lines, on = -1; for (var k = 0; k < L.length; k++) if (L[k].at <= t) on = k;
    document.querySelectorAll('#rv-lines .ln').forEach(function (el, k) { el.classList.toggle('on', k === on); });
  };
  $('#rv-play').onclick = function () { if (!R) return; if (R.player.playing) R.player.pause(); else R.player.play(); };
  var trackSeek = function (e) { if (!R) return; var kids = $('#rv-track').children; var x = e.clientX; for (var i = 0; i < kids.length; i++) { var b = kids[i].getBoundingClientRect(); if (x <= b.right + 1.5 || i === kids.length - 1) { var a = Number(kids[i].dataset.from), z = Number(kids[i].dataset.to); var f = Math.max(0, Math.min(1, (x - b.left) / Math.max(1, b.width))); var was = R.player.playing; R.player.seek(a + (z - a) * f); if (was) R.player.play(); return; } } };
  $('#rv-track').addEventListener('pointerdown', trackSeek);
  var renderLines = function () {
    var box = $('#rv-lines'); box.innerHTML = '';
    if (!R.d.lines.length) { box.innerHTML = '<p class="muted">没有转写。' + (R.d.talk && R.d.talk.audio ? '可以叫 paraformer 转一次。' : '') + '</p>'; return; }
    R.d.lines.forEach(function (l, k) {
      var row = document.createElement('div'); row.className = 'ln';
      var at = document.createElement('button'); at.type = 'button'; at.className = 'at'; at.textContent = clock(l.at); at.onclick = function () { R.player.play(l.at); };
      row.appendChild(at);
      if (R.editing === k) {
        var inp = document.createElement('input'); inp.value = l.text; row.appendChild(inp);
        var save = function () { if (R.editing !== k) return; R.editing = -1; var next = R.d.lines.map(function (x, i) { return i === k ? inp.value : x.text; }); if (inp.value.trim() === l.text) { renderLines(); return; } api('PUT', '/api/xlaoshi/' + R.id + '/transcript', { lines: next }).then(function (j) { R.d.lines = j.lines; renderLines(); renderAsr(); }).catch(function (e) { toast(e.message); renderLines(); }); };
        inp.onblur = save; inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { R.editing = -1; renderLines(); } };
        setTimeout(function () { inp.focus(); }, 0);
      } else {
        var tx = document.createElement('button'); tx.type = 'button'; tx.className = 'tx'; tx.innerHTML = esc(l.text) + (l.edited ? ' <span class="chip b">改过</span>' : '');
        tx.onclick = function () { R.editing = k; renderLines(); };
        row.appendChild(tx);
      }
      box.appendChild(row);
    });
    reviewTime(R.player.t);
  };
  var renderAsr = function () {
    var d = R.d, a = d.asr || { state: 'none' }, src = d.transcript ? d.transcript.source : null, t = '';
    if (a.state === 'running') t = '<span class="chip c">paraformer 在转(' + esc(a.why || '') + ')…</span>';
    else if (src === 'paraformer') t = '<span class="chip b">paraformer 转的</span> <span class="muted">' + esc(d.why || '') + '</span>';
    else if (src === 'browser') t = '<span class="chip b">浏览器认的</span>';
    if (a.state === 'failed') t += ' <span class="chip r">补转没成:' + esc(a.error || '') + '</span>';
    if (a.state === 'nokey') t += ' <span class="chip r">该补转(' + esc(a.why || '') + '),拿不到百炼 key</span>';
    if (a.state === 'done' && a.error) t += ' <span class="muted">' + esc(a.error) + '</span>';
    var can = d.talk && d.talk.audio && d.hasKey && a.state !== 'running';
    t += can ? ' <button type="button" class="pill" id="rv-asr" style="height:32px;font-size:13px;padding:0 12px">用 paraformer 重转</button>' : '';
    $('#rv-src').innerHTML = t;
    var b = $('#rv-asr'); if (b) b.onclick = function () { if (!confirm('把原声交给 paraformer 重转一遍?你改过的行会留着。')) return; api('POST', '/api/xlaoshi/' + R.id + '/transcribe').then(function () { R.d.asr = { state: 'running', why: '家长重转' }; renderAsr(); }).catch(function (e) { toast(e.message); }); };
  };
  var renderCC = function () {
    var say = '读 xlaoshi/怎么看.md,看看 xlaoshi/' + R.id;
    if (R.d.asks) say = '读 xlaoshi/怎么看.md,看看 xlaoshi/' + R.id + ' 的追问的回答';
    $('#cc-text').textContent = say;
    $('#cc-next').innerHTML = R.d.notes ? '<a href="#/notes/' + R.id + '">看初步理解 ›</a>' : '<span class="muted">它写好 notes.md,这里会亮。</span>';
  };
  $('#cc-copy').onclick = function () {
    var t = $('#cc-text').textContent;
    var ok = function () { toast('复制了'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { selectCC(); });
    else selectCC();
  };
  var selectCC = function () { var r = document.createRange(); r.selectNodeContents($('#cc-text')); var s = getSelection(); s.removeAllRanges(); s.addRange(r); try { document.execCommand('copy'); toast('复制了'); } catch (e) { toast('长按选中复制'); } };
  $('#rv-back').onclick = function () { if (R && R.player) R.player.pause(); go('#/'); };

  // ---------- 4 初步理解 ----------
  var renderNotes = function (id) {
    show('notes'); stopPoll();
    api('GET', '/api/xlaoshi/' + id).then(function (d) {
      S.data = d;
      $('#nt-topic').textContent = d.topic + ' · 初步理解';
      $('#nt-meta').textContent = 'xlaoshi/' + id + '/notes.md · Claude Code 写的' + (d.asks ? ' · 问了 ' + d.asks + ' 个' : '');
      var L = $('#nt-left'), Rt = $('#nt-right'); L.innerHTML = ''; Rt.innerHTML = '';
      if (!d.notesParsed) { L.innerHTML = '<p class="muted">还没有 notes.md。回到回看页,把那句话交给 Claude Code。</p>'; return; }
      var chip = function (it) { if (it.from === undefined) return ''; return '<button type="button" class="tchip" data-at="' + it.from + '">' + clock(it.from) + (it.to !== undefined ? '–' + clock(it.to) : '') + '</button>'; };
      var color = function (t) { return t.indexOf('讲到') >= 0 ? 'var(--blue-ink)' : (t.indexOf('对不上') >= 0 ? 'var(--clay-ink)' : 'var(--chip-ink)'); };
      var asks = [];
      d.notesParsed.sections.forEach(function (sec) {
        if (sec.ask) { asks = asks.concat(sec.items.filter(function (it) { return it.checked !== undefined; })); return; }
        var h = '<div><h3 style="color:' + color(sec.title) + '">' + esc(sec.title) + '</h3><ul>';
        sec.items.forEach(function (it) { h += '<li>' + esc(it.text) + chip(it) + (it.detail ? '<div class="muted small">' + esc(it.detail) + '</div>' : '') + '</li>'; });
        L.insertAdjacentHTML('beforeend', h + '</ul></div>');
      });
      Rt.insertAdjacentHTML('beforeend', '<div style="display:flex;align-items:baseline;gap:8px"><b style="font-size:17px">追问</b><span class="muted small">勾掉的不问;他看得到问题</span></div>');
      asks.forEach(function (it, k) {
        var q = document.createElement('div'); q.className = 'q';
        q.innerHTML = '<input type="checkbox" id="q' + k + '"' + (it.checked ? ' checked' : '') + '><label for="q' + k + '"><span style="font-size:17px;line-height:1.55">' + esc(it.text) + '</span><span class="muted small">' + (it.from !== undefined ? '放他 ' + clock(it.from) + (it.to !== undefined ? '–' + clock(it.to) : '') + ' 那段' + (it.detail ? ' · ' : '') : '') + esc(it.detail || '') + '</span></label>';
        q.querySelector('input').onchange = function (e) { api('PUT', '/api/xlaoshi/' + id + '/check', { line: it.line, on: e.target.checked }).then(function () { renderNotes(id); }).catch(function (x) { toast(x.message); }); };
        Rt.appendChild(q);
      });
      var n = asks.filter(function (it) { return it.checked; }).length;
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'pill main'; btn.style.marginTop = '8px'; btn.style.justifyContent = 'center';
      btn.textContent = n ? '开始追问 · ' + n + ' 个' : '先勾一个要问的'; btn.disabled = !n; btn.onclick = function () { go('#/ask/' + id + '/1'); };
      Rt.appendChild(btn);
      if (d.asks) Rt.insertAdjacentHTML('beforeend', '<p class="muted small" style="margin:4px 0 0">问过了。再交给 Claude Code:读 xlaoshi/怎么看.md,看看 xlaoshi/' + id + ' 的追问的回答</p>');
      L.querySelectorAll('.tchip').forEach(function (b) { b.onclick = function () { go('#/review/' + id + '/' + b.dataset.at); }; });
    }).catch(function (e) { toast(e.message); go('#/'); });
  };
  $('#nt-back').onclick = function () { if (S.data) go('#/review/' + S.data.id); else go('#/'); };

  // ---------- 5 当面追问 ----------
  var A = null;
  var askList = function (d) { var out = []; if (!d.notesParsed) return out; d.notesParsed.sections.forEach(function (s) { if (s.ask) s.items.forEach(function (it) { if (it.checked) out.push(it); }); }); return out; };
  var renderAsk = function (id, k) {
    show('ask'); stopPoll();
    api('GET', '/api/xlaoshi/' + id).then(function (d) {
      var qs = askList(d); if (!qs.length) { go('#/notes/' + id); return; }
      k = Math.max(1, Math.min(qs.length, k)); var it = qs[k - 1];
      if (A && A.rec) A.rec.stop();
      $('#ak-topic').textContent = d.topic; $('#ak-k').textContent = '· 第 ' + k + ' 个,共 ' + qs.length + ' 个';
      $('#ak-q').textContent = it.text; $('#ak-detail').textContent = it.detail || '';
      $('#ak-next').textContent = k < qs.length ? '下一个 ›' : '问完了';
      $('#ak-heard-t').textContent = ''; $('#ak-note').value = ''; $('#ak-rec').textContent = '● 录他说的'; $('#ak-rec').disabled = !window.MediaRecorder;
      var sz = d.strokesData ? d.strokesData.size : { w: 16, h: 9 };
      $('#ak-stage').style.aspectRatio = sz.w + ' / ' + sz.h;
      $('#ak-board').style.display = 'none'; $('#ak-canvas').style.display = 'block'; $('#ak-draw').textContent = '画一画';
      var from = it.from !== undefined ? it.from : 0, to = it.to !== undefined ? it.to : (it.from !== undefined ? Math.min(d.ms, it.from + 20000) : d.ms);
      $('#ak-range').textContent = it.from !== undefined ? clock(from) + ' – ' + clock(to) + ' · 他的声音' : '整段';
      requestAnimationFrame(function () {
        fitCanvas($('#ak-canvas'));
        var player = makePlayer($('#ak-canvas'), new Audio(), d.strokesData, d.ms, null);
        player.setAudio(d.talk && d.talk.audio ? '/api/xlaoshi/' + id + '/audio?v=' + encodeURIComponent(d.talk.audio) : null);
        player.onState = function (p) { $('#ak-play').textContent = p ? '❚❚ 停' : '▶ 放你讲的这段'; };
        player.seek(to);
        A = { id: id, k: k, n: qs.length, q: it.text, player: player, from: from, to: to, rec: null, result: null, board: null, t0: performance.now() };
      });
    }).catch(function (e) { toast(e.message); go('#/'); });
  };
  $('#ak-play').onclick = function () {
    if (!A) return;
    if ($('#ak-board').style.display !== 'none') $('#ak-draw').click(); // 在画板上:先切回他讲的那段
    if (A.player.playing) A.player.pause(); else A.player.play(A.from, A.to);
  };
  $('#ak-draw').onclick = function () {
    if (!A) return;
    var bd = $('#ak-board'), showing = bd.style.display !== 'none';
    if (showing) { bd.style.display = 'none'; $('#ak-canvas').style.display = 'block'; $('#ak-draw').textContent = '画一画'; return; }
    A.player.pause(); bd.style.display = 'block'; $('#ak-canvas').style.display = 'none'; $('#ak-draw').textContent = '看他讲的那段';
    if (!A.board) { var a = A; A.board = makeBoard(freshCanvas('#ak-board'), function () { return Math.round(performance.now() - a.t0); }); A.board.enable(true); }
  };
  $('#ak-rec').onclick = function () {
    if (!A) return;
    var a = A;
    if (a.rec) {
      $('#ak-rec').disabled = true;
      a.rec.stop().then(function (r) { a.rec = null; a.result = r; $('#ak-rec').disabled = false; $('#ak-rec').textContent = '● 再录一遍'; if (!$('#ak-heard-t').textContent) $('#ak-heard-t').textContent = r.segs.map(function (s) { return s.text; }).join('，'); });
      clearInterval(a.tick); return;
    }
    a.player.pause(); a.result = null;
    a.rec = startRecording(performance.now(), { onText: function (t) { $('#ak-heard-t').textContent = t; } });
    a.rec.ready.then(function (zero) { a.recT0 = zero; $('#ak-rec').textContent = '■ 在录 0:00 · 点一下停'; a.tick = setInterval(function () { $('#ak-rec').textContent = '■ 在录 ' + clock(performance.now() - a.recT0) + ' · 点一下停'; }, 250); }, function (e) { a.rec = null; toast('开不了麦克风:' + (e && (e.name || e.message))); });
  };
  var saveAsk = function () {
    var a = A; if (!a) return Promise.resolve();
    var stop = a.rec ? a.rec.stop().then(function (r) { clearInterval(a.tick); a.rec = null; a.result = r; }) : Promise.resolve();
    return stop.then(function () {
      var r = a.result, heard = $('#ak-heard-t').textContent || '', note = $('#ak-note').value || '';
      var drew = a.board && a.board.drew() ? a.board.data : null;
      if (!r && !note.trim() && !drew && !heard.trim()) return null;
      var audio = r && r.blob ? blobToDataUrl(r.blob) : Promise.resolve(null);
      return audio.then(function (u) { return api('POST', '/api/xlaoshi/' + a.id + '/asks', { q: a.q, heard: heard, note: note, ms: r ? r.ms : 0, strokes: drew, audio: u }); });
    });
  };
  $('#ak-next').onclick = function () {
    if (!A) return; var a = A; $('#ak-next').disabled = true;
    a.player.pause();
    saveAsk().then(function () { $('#ak-next').disabled = false; A = null; if (a.k < a.n) go('#/ask/' + a.id + '/' + (a.k + 1)); else { toast('问完了,回答存在 timeline.md 末尾'); go('#/notes/' + a.id); } })
      .catch(function (e) { $('#ak-next').disabled = false; toast('没存上:' + e.message); });
  };
  $('#ak-stop').onclick = function () {
    if (!A) return; var a = A; a.player.pause();
    saveAsk().then(function () { A = null; go('#/notes/' + a.id); }).catch(function (e) { toast('没存上:' + e.message); });
  };

  // ---------- 路由 ----------
  var route = function () {
    var h = location.hash.replace('#', '').split('/').filter(Boolean);
    if (h[0] === 'talk' && h[1]) renderTalk(h[1]);
    else if (h[0] === 'review' && h[1]) renderReview(h[1], h[2] !== undefined ? Number(h[2]) : undefined);
    else if (h[0] === 'notes' && h[1]) renderNotes(h[1]);
    else if (h[0] === 'ask' && h[1]) renderAsk(h[1], Number(h[2] || 1));
    else renderList();
  };
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', function () { if (S.view === 'review' && R) { fitCanvas($('#rv-canvas')); R.player.paint(); } });
  route();
})();
</script>
</body></html>
`;
