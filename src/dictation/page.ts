/**
 * /dictation:孩子的听写页(从首页的听写卡点进来,?home=<首页 id>&n=<第几张听写卡>;原型 https://claude.ai/artifact/WfKtooajFintau63RUHXqJ)。
 * 五屏同一页:开始、听写(老师念、孩子在田字格里写)、对答案(书上的字淡淡叠在上面)、逐笔看(书上的字在孩子写的上面一笔一笔写)、再写一遍。
 * 田字格是 SVG,坐标同 hanzi-writer:1024 见方、y 向上,组上 scale(1,-1) translate(0,-900) 摆正;孩子的笔、书上的字、逐笔写都在这一个坐标里。
 * 页面上永远没有对错:没有叉、没有分数;比对的结果只变成一句「这个再写一遍?」,其余给家长(/dictation/parent)。
 * 内联脚本里不写反斜杠、不写反引号、不写美元加花括号(这是模板字符串,见 CLAUDE.md「坑」)。
 */
export const DICTATION_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>听写</title>
<style>
  :root { --ink:#2b2b2b; --dim:#66625b; --line:#e2dfd6; --paper:#faf9f4; --card:#ffffff; --sand:#d8c7a0; --sand2:#e2d4b4;
    --tutor:#fff3d6; --tutor-ink:#5a3a08; --clay:#c4561f; --accent:#e8743b; --blue:#4f86d1; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { margin:0; height:100%; background:var(--paper); color:var(--ink); font:17px/1.5 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; overscroll-behavior:none; -webkit-user-select:none; user-select:none; }
  button { font:inherit; color:inherit; cursor:pointer; }
  .view { display:none; min-height:100%; flex-direction:column; padding:20px max(24px, env(safe-area-inset-right)) 24px max(24px, env(safe-area-inset-left)); gap:18px; }
  .view.on { display:flex; }
  .bar { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .bar .l { display:flex; align-items:center; gap:14px; min-width:0; }
  .tool { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:56px; padding:0 20px; border-radius:28px; border:1px solid var(--line); background:#fff; font-size:17px; }
  .tool.sm { min-height:48px; font-size:15px; padding:0 16px; }
  .tool svg { width:22px; height:22px; }
  .main { display:inline-flex; align-items:center; justify-content:center; min-height:64px; padding:0 44px; border-radius:32px; border:0; background:var(--clay); color:#fff; font-size:20px; font-weight:600; }
  .main:disabled { opacity:.5; }
  .ttl { font-size:22px; font-weight:700; }
  .dots { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .dots i { width:14px; height:14px; border-radius:7px; background:var(--line); }
  .dots i.d { background:#8fb4e3; }
  .dots i.c { width:30px; background:var(--accent); }
  .av { width:64px; height:64px; border-radius:32px; background:var(--tutor); border:2px solid #f0d9a0; display:grid; place-items:center; font-size:26px; color:#8a5a12; flex:none; }
  .bubble { display:flex; align-items:center; gap:16px; padding:16px 24px; background:var(--tutor); border-radius:24px; border-top-left-radius:6px; }
  .bubble b { display:block; font-size:24px; color:var(--tutor-ink); }
  .bubble small { display:block; font-size:15px; color:#7a5212; min-height:22px; }
  .bubble svg { width:32px; height:32px; flex:none; }
  .say { display:flex; align-items:center; gap:16px; align-self:center; flex-wrap:wrap; justify-content:center; }
  .pads { display:flex; gap:24px; justify-content:center; align-items:center; flex-wrap:wrap; }
  .padbox { position:relative; width:var(--pad, 300px); height:var(--pad, 300px); flex:none; }
  .padbox svg { display:block; width:100%; height:100%; touch-action:none; }
  .padbox.act { box-shadow:0 0 0 4px rgba(232,116,59,.28); border-radius:6px; }
  .grid rect { fill:#fff; stroke:var(--sand); stroke-width:10; }
  .grid line { stroke:var(--sand2); stroke-width:6; stroke-dasharray:28 20; }
  .ink path { fill:none; stroke:var(--ink); stroke-width:34; stroke-linecap:round; stroke-linejoin:round; }
  .std path { fill:var(--blue); fill-opacity:.34; }
  /* 逐笔看:孩子的字退成浅灰,书上的笔(蓝、橙)在上面看得清 */
  #v-order .ink path { stroke:#c9c4ba; }
  .bare .std { display:none; }
  .std.model path { fill:#3a3a3a; fill-opacity:1; }
  .std.model.writing path { fill:#d9d5cc; }
  .std path.sd { fill-opacity:.55; }
  .std path.sc { fill:var(--accent); fill-opacity:1; }
  .std path.sf { fill-opacity:.12; }
  .top path { fill:none; stroke-width:200; stroke-linecap:round; stroke-linejoin:round; }
  .top path.o { stroke:var(--accent); }
  .top path.k { stroke:#3a3a3a; }
  .grow { flex:1; display:flex; flex-direction:column; justify-content:center; gap:28px; }
  .foot { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .foot .tools { display:flex; gap:12px; flex-wrap:wrap; }
  [hidden] { display:none !important; }
  /* 写字(原型 v2 的 C):左边听写本,右边放大写一个字 */
  #v-listen { flex-direction:row; gap:20px; padding:16px 20px 20px; height:100vh; height:100dvh; }
  .book { width:300px; flex:none; min-height:0; display:flex; flex-direction:column; gap:4px; padding:14px 10px; background:#fff; border:1px solid var(--line); border-radius:22px; overflow:auto; }
  .book .bh { display:flex; align-items:baseline; justify-content:space-between; padding:0 8px 6px; }
  .book .bh b { font-size:20px; }
  .book .bh span { font-size:14px; color:var(--dim); }
  .brow { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:14px; }
  .brow.cur { background:#fff3e8; }
  .brow .no { width:24px; text-align:right; color:var(--dim); font-size:15px; flex:none; }
  .brow.cur .no { color:#b9531c; font-weight:700; }
  .brow .padbox { width:58px; height:58px; }
  .brow .padbox.ahead { opacity:.45; }
  .brow .padbox.here { box-shadow:0 0 0 4px rgba(232,116,59,.45); border-radius:4px; }
  .desk { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; gap:12px; }
  .bar2 { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .chip { display:flex; align-items:center; gap:12px; padding:6px 16px 6px 6px; background:var(--tutor); border-radius:28px; min-width:0; }
  .chip .av { width:44px; height:44px; font-size:18px; }
  .chip svg { width:26px; height:26px; flex:none; }
  .chip b { display:block; font-size:18px; color:var(--tutor-ink); white-space:nowrap; }
  .chip small { display:block; font-size:14px; color:#7a5212; white-space:nowrap; min-height:20px; }
  .big { flex:1; min-height:0; display:flex; align-items:center; justify-content:center; }
  .tool.reveal { border:2px solid #e8a26f; background:#fff8f2; color:#8f3c14; font-weight:600; }
  .std.trace path { fill:#d9d5cc; fill-opacity:1; }
  @media (orientation: portrait) { #v-listen { flex-direction:column; } .book { width:auto; max-height:210px; flex:none; } }
  /* 开始 */
  #v-start .grow { align-items:center; text-align:center; }
  #v-start .big { font-size:30px; font-weight:700; }
  #v-start .sub { color:var(--dim); font-size:18px; }
  #v-start .acts { display:flex; flex-direction:column; gap:14px; align-items:center; }
  /* 对答案 */
  .cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(var(--card, 320px), 1fr)); gap:18px; align-content:start; }
  .wc { display:flex; flex-direction:column; align-items:center; gap:12px; padding:16px; background:var(--card); border:1px solid var(--line); border-radius:20px; }
  .wc .pads { gap:10px; flex-wrap:nowrap; }
  .wc .padbox { cursor:pointer; }
  .ask { display:flex; align-items:center; gap:12px; padding:6px 6px 6px 16px; background:var(--tutor); border-radius:24px; font-size:17px; color:var(--tutor-ink); }
  .ask button { min-height:44px; padding:0 20px; border-radius:22px; border:0; background:var(--clay); color:#fff; font-weight:600; }
  .self { min-height:44px; padding:0 16px; border-radius:22px; border:1px solid var(--line); background:#fff; font-size:15px; color:var(--dim); }
  .hint { color:var(--dim); font-size:17px; }
  /* 逐笔看 */
  #v-order .grow { flex-direction:row; align-items:center; justify-content:center; gap:48px; flex-wrap:wrap; }
  .side { display:flex; flex-direction:column; gap:24px; max-width:420px; }
  .side .ttl { font-size:28px; }
  .count { font-size:20px; }
  .count b { color:#b9531c; }
  .sqs { display:flex; flex-wrap:wrap; gap:8px; }
  .sqs i { width:30px; height:30px; border-radius:8px; display:grid; place-items:center; font-size:13px; font-style:normal; background:#fff; color:var(--dim); border:1px solid #d8d4ca; }
  .sqs i.d { background:#9dbde6; color:#173b6b; border-color:#9dbde6; }
  .sqs i.c { background:var(--accent); color:#fff; font-weight:700; border-color:var(--accent); }
  .row { display:flex; gap:12px; flex-wrap:wrap; }
  /* 再写一遍 */
  #v-rewrite .grow { flex-direction:row; align-items:center; justify-content:center; gap:56px; flex-wrap:wrap; }
  .models { display:flex; flex-direction:column; align-items:center; gap:12px; padding:20px; background:var(--card); border:1px solid var(--line); border-radius:20px; }
  .models .pads { gap:10px; flex-wrap:nowrap; }
  .models .padbox { cursor:pointer; }
  /* 拍照开始:拍 → 照片上一项一项冒出框,点着选 → 右边是这次写的词 */
  #v-snap .grow { align-items:center; text-align:center; }
  #v-snap .big { font-size:30px; font-weight:700; }
  #v-snap .sub { color:var(--dim); font-size:18px; max-width:520px; }
  .pick-btn { position:relative; overflow:hidden; }
  .pick-btn input { position:absolute; inset:0; opacity:0; font-size:200px; cursor:pointer; }
  #v-pick { flex-direction:row; gap:20px; align-items:stretch; height:100vh; height:100dvh; }
  #v-pick.on { display:flex; }
  .shot { flex:1; min-width:0; min-height:0; display:flex; align-items:center; justify-content:center; }
  .shot .frame { position:relative; overflow:hidden; border-radius:12px; background:#2b2b2b; }
  .shot .full { position:absolute; left:0; top:0; transform-origin:0 0; transition:transform .5s ease; --z:1; }
  .shot img { display:block; width:100%; height:100%; }
  .bx { position:absolute; border-radius:calc(6px / var(--z)); border:calc(3px / var(--z)) dashed rgba(120,115,105,.85); background:transparent; padding:0; cursor:pointer; }
  .bx.on { border-style:solid; border-color:#2f6fd6; background:rgba(47,111,214,.16); }
  .bx.unsure.on { border-color:#e8743b; background:rgba(232,116,59,.18); }
  .bx.read { border-color:rgba(160,155,145,.55); }
  .bx.pop { animation:pop .35s ease-out; }
  @keyframes pop { from { transform:scale(1.35); opacity:0; } to { transform:scale(1); opacity:1; } }
  .side2 { width:340px; flex:none; min-height:0; display:flex; flex-direction:column; gap:12px; }
  .side2 .ttl { font-size:22px; }
  .side2 .st { font-size:15px; color:var(--dim); min-height:22px; }
  .wl { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:8px; }
  .wr { display:flex; align-items:center; gap:10px; padding:10px 12px; background:#fff; border:1px solid var(--line); border-radius:14px; }
  .wr .t { flex:1; min-width:0; display:flex; flex-direction:column; }
  .wr b { font-size:22px; letter-spacing:2px; }
  .wr input { font:inherit; font-size:22px; letter-spacing:2px; width:100%; border:0; border-bottom:2px solid #e8a26f; background:transparent; padding:0; }
  .wr small { font-size:13px; color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .wr .x { flex:none; width:44px; height:44px; border-radius:22px; border:1px solid var(--line); background:#fff; font-size:18px; color:var(--dim); }
  @media (orientation: portrait) { #v-pick { flex-direction:column; } .side2 { width:auto; flex:0 0 42%; } }
  @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
</style></head>
<body>
<div class="view" id="v-start">
  <div class="bar"><div class="l"><button class="tool sm" data-home="1">回首页</button></div></div>
  <div class="grow">
    <div class="av" id="s-av"></div>
    <div class="big" id="s-big">听写</div>
    <div class="sub" id="s-sub"></div>
    <div class="acts" id="s-acts"></div>
  </div>
</div>

<div class="view" id="v-snap">
  <div class="bar"><div class="l"><button class="tool sm" data-home="1">回首页</button></div></div>
  <div class="grow">
    <div class="big">拍今天要听写的</div>
    <div class="sub">拍课本上的词语、写字,或者老师发的听写单。拍正一点,字要清楚。</div>
    <div class="row" style="justify-content:center">
      <label class="main pick-btn">拍照<input type="file" accept="image/*" capture="environment" id="snap-cam"></label>
      <label class="tool pick-btn" style="min-height:64px">从相册选<input type="file" accept="image/*" id="snap-lib"></label>
    </div>
  </div>
</div>

<div class="view" id="v-pick">
  <div class="shot" id="p-shot"></div>
  <div class="side2">
    <div><div class="ttl" id="p-lesson">认一认</div><div class="st" id="p-status"></div></div>
    <div class="hint" style="font-size:15px">点照片上的框:蓝的会念,虚线的不念。橙的没认准,改一下字。</div>
    <div class="wl" id="p-list"></div>
    <div class="row">
      <button class="tool" id="p-again">重拍</button>
      <button class="main" id="p-go" style="flex:1">开始听写</button>
    </div>
  </div>
</div>

<div class="view" id="v-listen">
  <div class="book" id="l-book"></div>
  <div class="desk">
    <div class="bar2">
      <div class="chip">
        <div class="av" id="l-av"></div>
        <svg viewBox="0 0 24 24" fill="none" stroke="#8a5a12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path></svg>
        <div style="min-width:0"><b id="l-what"></b><small id="l-status"></small></div>
      </div>
      <div class="row" style="flex:none">
        <button class="tool sm" id="l-again"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path></svg>再念</button>
        <button class="tool sm" data-home="1">先停一下</button>
      </div>
    </div>
    <div class="big" id="l-big"></div>
    <div class="foot" id="l-foot-write">
      <div class="tools">
        <button class="tool" data-undo="1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"></path><path d="M4 9h11a5 5 0 0 1 0 10h-3"></path></svg>撤销</button>
        <button class="tool" data-clear="1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20H8l-4-4 10-10 6 6-6 6"></path></svg>擦掉重写</button>
        <button class="tool reveal" id="l-reveal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"></path><path d="M10 21h4"></path><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"></path></svg>不会写,给答案</button>
        <button class="tool" id="l-reorder" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path></svg>再看笔顺</button>
      </div>
      <button class="main" id="l-next">这个字写好了</button>
    </div>
    <div class="foot" id="l-foot-order" hidden>
      <div class="tools" style="align-items:center"><div class="sqs" id="l-sqs"></div><button class="tool" id="l-again-order">再看一遍</button></div>
      <button class="main" id="l-trace">我来写</button>
    </div>
  </div>
</div>

<div class="view" id="v-check">
  <div class="bar">
    <div class="l" style="flex-direction:column;align-items:flex-start;gap:2px"><span class="ttl">写完啦,自己对一对</span><span class="hint">淡蓝的是书上的字,叠在你写的上面。点一个字,看它一笔一笔怎么写。</span></div>
    <button class="tool" id="c-toggle"><svg viewBox="0 0 24 24" fill="none" stroke="#4f86d1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="13" height="13" rx="2"></rect><rect x="8" y="8" width="13" height="13" rx="2"></rect></svg><span>拿开蓝字</span></button>
  </div>
  <div class="cards" id="c-cards"></div>
  <div class="foot"><span></span><button class="main" id="c-done">对好了</button></div>
</div>

<div class="view" id="v-order">
  <div class="bar"><button class="tool sm" id="r-back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>回到对答案</button></div>
  <div class="grow">
    <div class="pads" id="r-pad"></div>
    <div class="side">
      <div><div class="ttl">看它一笔一笔写</div><div class="hint">蓝笔在你写的字上面写一遍,正在写的那一笔是橙色的。</div></div>
      <div class="count" id="r-count"></div>
      <div class="sqs" id="r-sqs"></div>
      <div class="row">
        <button class="tool" id="r-prev" aria-label="上一笔"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg></button>
        <button class="tool" id="r-play" style="flex:1">接着写</button>
        <button class="tool" id="r-next" aria-label="下一笔"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"></path></svg></button>
        <button class="tool" id="r-zero">从头写</button>
      </div>
      <button class="main" id="r-rewrite">我再写一遍</button>
    </div>
  </div>
</div>

<div class="view" id="v-rewrite">
  <div class="bar"><span class="ttl" id="w-title">再写一遍</span><button class="tool sm" id="w-skip">先不写了</button></div>
  <div class="grow">
    <div class="models"><span class="hint">照着看 · 点一下看笔顺</span><div class="pads" id="w-models"></div></div>
    <div class="pads" id="w-pads"></div>
  </div>
  <div class="foot">
    <div class="tools">
      <button class="tool" data-undo="1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"></path><path d="M4 9h11a5 5 0 0 1 0 10h-3"></path></svg>撤销</button>
      <button class="tool" data-clear="1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20H8l-4-4 10-10 6 6-6 6"></path></svg>擦掉这一格</button>
    </div>
    <button class="main" id="w-done">写好了</button>
  </div>
</div>

<script>
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var NS = 'http://www.w3.org/2000/svg';
  var HZ_T = 'scale(1,-1) translate(0,-900)';
  var sv = function (tag, attrs) { var el = document.createElementNS(NS, tag); for (var k in (attrs || {})) el.setAttribute(k, String(attrs[k])); return el; };
  var h = function (tag, attrs) {
    var el = document.createElement(tag); attrs = attrs || {};
    for (var k in attrs) { if (k === 'on') { for (var ev in attrs.on) el.addEventListener(ev, attrs.on[ev]); } else if (k === 'text') el.textContent = attrs[k]; else el.setAttribute(k, attrs[k]); }
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c !== null && c !== undefined && c !== false) el.append(c); }
    return el;
  };
  var CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  var cn = function (n) { return n <= 10 ? CN[n] : n < 20 ? '十' + CN[n - 10] : CN[Math.floor(n / 10)] + '十' + (n % 10 ? CN[n % 10] : ''); };

  var q = new URLSearchParams(location.search);
  var HOME = q.get('home'); var N = Number(q.get('n') || 0);
  var S = { v: null, base: Date.now(), i: 0, w: null, pads: [], stack: [], active: null, sawPen: false, noAudio: false, sayTimer: 0, order: null, rw: null };
  /** 点与事件的时刻:离这次听写开始(startedAt)多少毫秒;孩子端的钟,录像只看先后与间隔 */
  var now = function () { return Math.max(0, Date.now() - S.base); };
  var setView = function (v) { S.v = v; S.base = Date.parse(v.startedAt) || S.base; };

  var show = function (name) { var vs = document.querySelectorAll('.view'); for (var i = 0; i < vs.length; i++) vs[i].classList.toggle('on', vs[i].id === 'v-' + name); window.scrollTo(0, 0); };
  var goHome = function () { stopSay(); location.href = '/'; };
  var hs = document.querySelectorAll('[data-home]'); for (var i0 = 0; i0 < hs.length; i0++) hs[i0].addEventListener('click', goHome);

  var api = function (method, path, body) {
    return fetch(path, { method: method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(String(r.status)); e.status = r.status; e.body = j; throw e; } return j; }); });
  };
  /** 交东西:连不上就一直等着重试,按钮上写「等一下…」,孩子那边不报错 */
  var persist = function (method, path, body, btn) {
    var label = btn ? btn.textContent : '';
    if (btn) btn.disabled = true;
    return new Promise(function (resolve, reject) {
      var go = function () {
        api(method, path, body).then(function (j) { if (btn) { btn.disabled = false; btn.textContent = label; } resolve(j); }, function (e) {
          if (e.status && e.status < 500) { if (btn) { btn.disabled = false; btn.textContent = label; } reject(e); return; }
          if (btn) btn.textContent = '等一下…';
          setTimeout(go, 2000);
        });
      };
      go();
    });
  };

  /** 记一件事(录像按它排);发不出去就算了 */
  var event = function (kind, word, ch, n) { var b = { kind: kind, word: word, t: now() }; if (ch !== undefined) b.char = ch; if (n !== undefined) b.n = n; api('POST', '/api/dictation/' + S.v.id + '/events', b).catch(function () {}); };

  // ---------- 字形(书上的字):/api/kid/tianzige/<字>,strokes 轮廓 + medians 中线 ----------
  var GL = {};
  var glyph = function (ch) { if (!GL[ch]) GL[ch] = fetch('/api/kid/tianzige/' + encodeURIComponent(ch)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); return GL[ch]; };
  var polyLen = function (pts) { var n = 0; for (var i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return n; };

  // ---------- 田字格 ----------
  var pathD = function (pts) { var d = 'M' + pts[0][0] + ' ' + pts[0][1]; if (pts.length === 1) d += ' L' + (pts[0][0] + 1) + ' ' + pts[0][1]; for (var i = 1; i < pts.length; i++) d += ' L' + pts[i][0] + ' ' + pts[i][1]; return d; };
  var makePad = function (opts) {
    var svg = sv('svg', { viewBox: '0 0 1024 1024' });
    var grid = sv('g', { 'class': 'grid' });
    grid.append(sv('rect', { x: 8, y: 8, width: 1008, height: 1008, rx: 20 }), sv('line', { x1: 512, y1: 8, x2: 512, y2: 1016 }), sv('line', { x1: 8, y1: 512, x2: 1016, y2: 512 }));
    var std = sv('g', { 'class': 'std', transform: HZ_T });
    var ink = sv('g', { 'class': 'ink', transform: HZ_T });
    var top = sv('g', { 'class': 'top', transform: HZ_T });
    svg.append(grid, std, ink, top);
    var pad = { el: h('div', { 'class': 'padbox' }, svg), svg: svg, std: std, ink: ink, top: top, strokes: [], undos: 0 };
    (opts.ink || []).forEach(function (s) { if (s.length) ink.append(sv('path', { d: pathD(s) })); });
    if (opts.write) bindPen(pad);
    if (opts.onTap) pad.el.addEventListener('click', opts.onTap);
    return pad;
  };
  var fillStd = function (pad, d, cls) { pad.std.replaceChildren(); if (cls) pad.std.setAttribute('class', 'std ' + cls); if (!d) return; d.strokes.forEach(function (st) { pad.std.append(sv('path', { d: st })); }); };
  var setActive = function (pad) { if (S.active) S.active.el.classList.remove('act'); S.active = pad; if (pad) pad.el.classList.add('act'); };
  /** 记一笔:点 = [x, y, t],x / y 是字的坐标(1024 见方、y 向上),t 是离进页面多少毫秒 */
  var bindPen = function (pad) {
    var cur = null;
    var pos = function (e) { var r = pad.svg.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * 1024), Math.round(900 - (e.clientY - r.top) / r.height * 1024), now()]; };
    pad.svg.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'pen') S.sawPen = true; else if (e.pointerType === 'touch' && S.sawPen) return; // 用过笔就不认手掌
      if (cur) return;
      try { pad.svg.setPointerCapture(e.pointerId); } catch (x) {}
      var pts = [pos(e)];
      cur = { id: e.pointerId, pts: pts, path: sv('path', { d: pathD(pts) }) };
      pad.ink.append(cur.path); pad.strokes.push(pts); S.stack.push(pad); setActive(pad);
      e.preventDefault();
    });
    pad.svg.addEventListener('pointermove', function (e) {
      if (!cur || e.pointerId !== cur.id) return;
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; if (!evs.length) evs = [e];
      for (var i = 0; i < evs.length; i++) { var p = pos(evs[i]); var l = cur.pts[cur.pts.length - 1]; if (Math.abs(p[0] - l[0]) + Math.abs(p[1] - l[1]) < 4) continue; cur.pts.push(p); }
      cur.path.setAttribute('d', pathD(cur.pts));
      e.preventDefault();
    });
    var up = function (e) { if (cur && e.pointerId === cur.id) { cur = null; if (pad.onUp) pad.onUp(); } };
    pad.svg.addEventListener('pointerup', up); pad.svg.addEventListener('pointercancel', up);
  };
  var undo = function () { var pad = S.stack.pop(); if (!pad || !pad.strokes.length) return; pad.strokes.pop(); if (pad.ink.lastChild) pad.ink.lastChild.remove(); pad.undos++; if (pad.onUp) pad.onUp(); };
  var clearActive = function () { var pad = S.active; if (!pad || !pad.strokes.length) return; pad.strokes = []; pad.ink.replaceChildren(); pad.undos++; S.stack = S.stack.filter(function (x) { return x !== pad; }); if (pad.onUp) pad.onUp(); };
  var us = document.querySelectorAll('[data-undo]'); for (var i1 = 0; i1 < us.length; i1++) us[i1].addEventListener('click', undo);
  var cs = document.querySelectorAll('[data-clear]'); for (var i2 = 0; i2 < cs.length; i2++) cs[i2].addEventListener('click', clearActive);
  var padsOut = function () { return { chars: S.pads.map(function (p) { return { strokes: p.strokes, undos: p.undos }; }) }; };
  /** 一排写字的格多大:屏幕放得下、不超过 340 */
  var padSize = function (count, wFrac, hRoom) { var w = Math.floor((window.innerWidth * wFrac - 48 - (count - 1) * 24) / count); return Math.max(120, Math.min(340, w, window.innerHeight - hRoom)); };
  var writePads = function (box, count, hRoom, wFrac) {
    S.pads = []; S.stack = []; setActive(null);
    var size = padSize(count, wFrac || 1, hRoom);
    box.style.setProperty('--pad', size + 'px');
    for (var k = 0; k < count; k++) S.pads.push(makePad({ write: true }));
    box.replaceChildren.apply(box, S.pads.map(function (p) { return p.el; }));
    setActive(S.pads[0]);
  };

  // ---------- 念 ----------
  var audio = new Audio(); audio.preload = 'auto';
  var stopSay = function () { clearTimeout(S.sayTimer); S.sayTok = (S.sayTok || 0) + 1; try { audio.pause(); } catch (e) {} try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {} };
  var status = function (t) { $('#l-status').textContent = t; };
  /** 念第 i 个词,念 times 遍,两遍之间停一下;没有音频(没配音色、合成失败)退浏览器合成声 */
  var sayWord = function (i, times) {
    stopSay();
    var tok = S.sayTok; var left = times; var nth = 0;
    var next = function () { if (tok !== S.sayTok) return; if (left <= 0) { status('听完了就写'); return; } left--; nth++; status('正在念 · 第 ' + nth + ' 遍'); event('say', i, undefined, nth); play(); };
    var gap = function () { if (tok !== S.sayTok) return; status(left > 0 ? '再听一遍' : '听完了就写'); if (left > 0) S.sayTimer = setTimeout(next, 1800); };
    var synth = function () {
      api('GET', '/api/dictation/' + S.v.id + '/say/' + i + '?text=1').then(function (j) {
        if (tok !== S.sayTok || !window.speechSynthesis) return;
        var u = new SpeechSynthesisUtterance(j.text); u.lang = 'zh-CN'; u.rate = 0.8;
        u.onend = gap; u.onerror = gap; speechSynthesis.speak(u);
      }, function () { status(''); });
    };
    var play = function () {
      if (S.noAudio) return synth();
      audio.onended = gap;
      audio.onerror = function () { S.noAudio = true; synth(); };
      audio.src = '/api/dictation/' + S.v.id + '/say/' + i;
      var pr = audio.play(); if (pr && pr.catch) pr.catch(function () { if (tok === S.sayTok && audio.error) { S.noAudio = true; synth(); } });
    };
    next();
  };

  // ---------- 开始 ----------
  var avatarText = function () { return (S.v.tutor || '老师').slice(0, 1); };
  var renderStart = function () {
    var v = S.v; var total = v.sizes.length; var wrote = v.written.filter(Boolean).length;
    $('#s-av').textContent = avatarText();
    $('#s-big').textContent = '听写 · ' + cn(total) + '个词';
    var acts = $('#s-acts');
    if (v.done) {
      $('#s-sub').textContent = '今天写过了';
      acts.replaceChildren(h('button', { 'class': 'main', on: { click: function () { start(true); } } }, '再听写一次'), h('button', { 'class': 'tool', on: { click: openCheck } }, '看看写的'));
    } else if (wrote > 0) {
      $('#s-sub').textContent = '写到第' + cn(wrote + 1) + '个了';
      acts.replaceChildren(h('button', { 'class': 'main', on: { click: function () { openListen(); } } }, '接着写'));
    } else {
      $('#s-sub').textContent = v.tutor + '念,你在田字格里写';
      acts.replaceChildren(h('button', { 'class': 'main', on: { click: function () { openListen(); } } }, '开始'));
    }
    show('start');
  };
  var start = function (fresh) {
    api('POST', '/api/dictation', { home: HOME, n: N, fresh: Boolean(fresh) }).then(function (v) {
      setView(v);
      if (v.checked && !v.done) openCheck(); else renderStart();
    }, function () {
      $('#s-big').textContent = '首页换过了';
      $('#s-sub').textContent = '回首页看看';
      $('#s-acts').replaceChildren(h('button', { 'class': 'main', on: { click: goHome } }, '回首页'));
      show('start');
    });
  };

  // ---------- 拍照开始:拍 → 传 → 一项一项认出来 → 点选 → 开始 ----------
  var P = { id: null, items: [], on: {}, edits: {}, timer: 0, img: null, url: null };
  var openSnap = function () { clearTimeout(P.timer); show('snap'); };
  /** 照片缩到长边 2000 的 jpeg(iPad 拍的十几 MB,传不动也不必) */
  var shrink = function (file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file); var im = new Image();
      im.onload = function () {
        var k = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight));
        var c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        resolve({ data: c.toDataURL('image/jpeg', 0.85), url: url, w: c.width, h: c.height });
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('读不了这张')); };
      im.src = url;
    });
  };
  var onPicked = function (e) {
    var f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    P = { id: null, items: [], on: {}, edits: {}, timer: 0, img: null, url: null };
    $('#p-lesson').textContent = '认一认'; $('#p-status').textContent = '传照片…'; $('#p-list').replaceChildren(); $('#p-shot').replaceChildren();
    show('pick'); renderPickBtn();
    shrink(f).then(function (sh) {
      P.url = sh.url; P.w = sh.w; P.h = sh.h; layoutShot();
      return persist('POST', '/api/dictation/photos', { image: sh.data }, null);
    }).then(function (j) { P.id = j.id; $('#p-status').textContent = '正在认…'; poll(); }, function () { $('#p-status').textContent = '这张传不上去,再拍一张试试'; });
  };
  $('#snap-cam').addEventListener('change', onPicked);
  $('#snap-lib').addEventListener('change', onPicked);
  /**
   * 照片铺满左边;框是 0–1000 的千分比,画在照片同一层(.full)上。
   * 认出字以后放大到「所有框 + 一圈边」:课本常常只占照片一小块,不放大框太小点不着。框的线宽、留边按放大倍数缩回去。
   */
  var layoutShot = function () {
    var box = $('#p-shot'); if (!P.url) return;
    var r = box.getBoundingClientRect();
    var fw = Math.round(r.width || window.innerWidth - 400), fh = Math.round(r.height || window.innerHeight - 60);
    var k = Math.min(fw / P.w, fh / P.h);
    var full = h('div', { 'class': 'full' }); full.style.width = Math.round(P.w * k) + 'px'; full.style.height = Math.round(P.h * k) + 'px';
    full.append(h('img', { src: P.url, alt: '拍的照片' }));
    var frame = h('div', { 'class': 'frame' }, full); frame.style.width = fw + 'px'; frame.style.height = fh + 'px';
    box.replaceChildren(frame); P.frame = full; P.fw = fw; P.fh = fh; P.k = k; P.drawn = 0;
    drawBoxes();
  };
  var zoomShot = function () {
    if (!P.frame) return;
    var bs = P.items.filter(function (it) { return it.box; }).map(function (it) { return it.box; });
    var iw = P.w * P.k, ih = P.h * P.k;
    var x0 = 0, y0 = 0, x1 = iw, y1 = ih;
    if (bs.length >= 3) {
      var m = 40;
      x0 = Math.max(0, Math.min.apply(null, bs.map(function (b) { return b[0]; })) - m) / 1000 * iw; y0 = Math.max(0, Math.min.apply(null, bs.map(function (b) { return b[1]; })) - m) / 1000 * ih;
      x1 = Math.min(1000, Math.max.apply(null, bs.map(function (b) { return b[2]; })) + m) / 1000 * iw; y1 = Math.min(1000, Math.max.apply(null, bs.map(function (b) { return b[3]; })) + m) / 1000 * ih;
    }
    var z = Math.max(1, Math.min(3.5, P.fw / (x1 - x0), P.fh / (y1 - y0)));
    var tx = P.fw / 2 - z * (x0 + x1) / 2, ty = P.fh / 2 - z * (y0 + y1) / 2;
    tx = Math.min(0, Math.max(P.fw - iw * z, tx)); ty = Math.min(0, Math.max(P.fh - ih * z, ty));
    if (iw * z < P.fw) tx = (P.fw - iw * z) / 2; if (ih * z < P.fh) ty = (P.fh - ih * z) / 2;
    P.frame.style.transform = 'translate(' + Math.round(tx) + 'px,' + Math.round(ty) + 'px) scale(' + z.toFixed(3) + ')';
    P.frame.style.setProperty('--z', z.toFixed(3));
  };
  var defaultOn = function (it) { return it.kind === 'word' || it.kind === 'list'; };
  var keyOf = function (k) { return 'i' + k; };
  var drawBoxes = function () {
    if (!P.frame) return;
    for (var k = P.drawn || 0; k < P.items.length; k++) {
      (function (k) {
        var it = P.items[k]; if (!it.box) return;
        if (!(keyOf(k) in P.on)) P.on[keyOf(k)] = defaultOn(it);
        var b = h('button', { 'class': 'bx pop' + (it.sure ? '' : ' unsure') + (it.kind === 'read' ? ' read' : ''), 'aria-label': it.text, 'data-k': String(k) });
        b.style.left = 'calc(' + it.box[0] / 10 + '% - 6px / var(--z))'; b.style.top = 'calc(' + it.box[1] / 10 + '% - 6px / var(--z))';
        b.style.width = 'calc(' + (it.box[2] - it.box[0]) / 10 + '% + 12px / var(--z))'; b.style.height = 'calc(' + (it.box[3] - it.box[1]) / 10 + '% + 12px / var(--z))';
        b.addEventListener('click', function () { P.on[keyOf(k)] = !P.on[keyOf(k)]; paintBoxes(); renderList(); });
        P.frame.append(b);
      })(k);
    }
    P.drawn = P.items.length;
    paintBoxes();
    zoomShot();
  };
  var paintBoxes = function () { if (!P.frame) return; var bs = P.frame.querySelectorAll('.bx'); for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', Boolean(P.on[keyOf(Number(bs[i].dataset.k))])); };
  var textOf = function (k) { return keyOf(k) in P.edits ? P.edits[keyOf(k)] : P.items[k].text; };
  var picked = function () { var out = []; P.items.forEach(function (it, k) { if (!it.box && !(keyOf(k) in P.on)) P.on[keyOf(k)] = defaultOn(it); if (P.on[keyOf(k)]) out.push(k); }); return out; };
  var renderList = function () {
    var ks = picked(); var list = $('#p-list'); list.replaceChildren();
    ks.forEach(function (k) {
      var it = P.items[k];
      var head = it.sure ? h('b', {}, textOf(k)) : h('input', { value: textOf(k), 'aria-label': '改一下这个词', on: { input: function (e) { P.edits[keyOf(k)] = e.target.value.replace(/ /g, ''); } } });
      list.append(h('div', { 'class': 'wr' }, h('div', { 'class': 't' }, head, it.say ? h('small', {}, it.say) : null), h('button', { 'class': 'x', 'aria-label': '不要这个', on: { click: function () { P.on[keyOf(k)] = false; paintBoxes(); renderList(); } } }, '×')));
    });
    renderPickBtn();
  };
  var renderPickBtn = function () { var n = picked().length; if (P.done) $('#p-status').textContent = '认好了 · 选了 ' + n + ' 个'; $('#p-go').disabled = !P.id || n === 0; $('#p-go').textContent = n ? '开始听写 · ' + cn(Math.min(n, 20)) + '个词' : '开始听写'; };
  var poll = function () {
    clearTimeout(P.timer);
    api('GET', '/api/dictation/photos/' + P.id).then(function (r) {
      if (r.lesson) $('#p-lesson').textContent = r.lesson;
      if (r.items.length > P.items.length) { P.items = r.items; drawBoxes(); renderList(); }
      if (r.state === 'running') { $('#p-status').textContent = '正在认… 认出 ' + r.items.length + ' 个'; P.timer = setTimeout(poll, 700); return; }
      if (!r.items.length) { $('#p-status').textContent = '没认出字来,再拍一张试试'; return; }
      P.done = true; renderPickBtn();
    }, function () { P.timer = setTimeout(poll, 1500); });
  };
  $('#p-again').addEventListener('click', function () { clearTimeout(P.timer); openSnap(); });
  $('#p-go').addEventListener('click', function () {
    var words = picked().slice(0, 20).map(function (k) { var it = P.items[k]; var t = textOf(k); return t === it.text ? { chars: t, say: it.say || undefined } : { chars: t }; }).filter(function (w) { return w.chars; });
    if (!words.length) return;
    clearTimeout(P.timer);
    persist('POST', '/api/dictation', { photo: P.id, words: words }, $('#p-go')).then(function (v) { setView(v); openListen(); }, function () { $('#p-status').textContent = '有的词不是一到四个汉字,改一下再开始'; });
  });
  window.addEventListener('resize', function () { if ($('#v-pick').classList.contains('on')) layoutShot(); });

  // ---------- 听写(左边听写本,右边一次写一个字;不会写就给答案:看笔顺,再照着描红写一遍)----------
  var updateHere = function () {
    var el = $('#l-book .here .ink'); if (!el || !S.w) return;
    el.replaceChildren.apply(el, S.w.pad.strokes.filter(function (x) { return x.length; }).map(function (x) { return sv('path', { d: pathD(x) }); }));
  };
  var renderBook = function () {
    var b = $('#l-book');
    var rows = [h('div', { 'class': 'bh' }, h('b', {}, '听写本'), h('span', {}, cn(S.v.sizes.length) + '个词'))];
    S.v.sizes.forEach(function (size, wi) {
      var row = h('div', { 'class': 'brow' + (wi === S.i ? ' cur' : '') }, h('div', { 'class': 'no' }, String(wi + 1)));
      for (var c = 0; c < size; c++) {
        (function (c) {
          var mine = wi === S.i ? (c === S.w.c ? { strokes: S.w.pad.strokes } : S.w.inks[c]) : S.v.mine[wi] ? S.v.mine[wi][c] : null;
          var cell = makePad({ ink: mine ? mine.strokes : [], onTap: wi === S.i ? function () { if (S.w.mode !== 'order' && c !== S.w.c) openChar(c); } : null });
          if (wi > S.i) cell.el.classList.add('ahead');
          if (wi === S.i && c === S.w.c) cell.el.classList.add('here');
          row.append(cell.el);
        })(c);
      }
      rows.push(row);
    });
    b.replaceChildren.apply(b, rows);
    var cur = b.querySelector('.brow.cur'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  };
  var whatText = function () { return S.v.sizes[S.i] === 1 ? '第' + cn(S.i + 1) + '个词 · 一个字' : '第' + cn(S.i + 1) + '个词的第' + cn(S.w.c + 1) + '个字'; };
  var renderFoot = function () {
    var m = S.w.mode;
    $('#l-foot-write').hidden = m === 'order'; $('#l-foot-order').hidden = m !== 'order';
    $('#l-reveal').hidden = m === 'trace'; $('#l-reorder').hidden = m !== 'trace';
    $('#l-what').textContent = m === 'order' ? '看「' + S.w.chars[S.w.c] + '」一笔一笔写' : m === 'trace' ? '照着灰色的「' + S.w.chars[S.w.c] + '」写一遍' : whatText();
  };
  /** 手上这个字收进这个词的格子里(换字、写好了之前) */
  var stash = function () {
    if (!S.w || !S.w.pad) return;
    var prev = S.w.inks[S.w.c];
    S.w.inks[S.w.c] = { strokes: S.w.pad.strokes, undos: S.w.pad.undos, revealed: S.w.mode === 'trace' || Boolean(prev && prev.revealed) };
  };
  var openChar = function (c) {
    stash(); S.w.otok = (S.w.otok || 0) + 1;
    S.w.c = c;
    var prev = S.w.inks[c];
    S.w.mode = prev && prev.revealed ? 'trace' : 'write';
    var pad = makePad({ write: true, ink: prev ? prev.strokes : [] });
    pad.strokes = prev ? prev.strokes.slice() : []; pad.undos = prev ? prev.undos : 0;
    pad.onUp = updateHere;
    S.w.pad = pad; S.pads = [pad]; S.stack = pad.strokes.map(function () { return pad; });
    var big = $('#l-big'); big.replaceChildren(pad.el);
    var r = big.getBoundingClientRect();
    pad.el.style.width = pad.el.style.height = Math.max(240, Math.min(640, Math.floor(Math.min(r.width, r.height)) - 10)) + 'px';
    setActive(pad);
    if (S.w.mode === 'trace') glyph(S.w.chars[c]).then(function (d) { if (S.w && S.w.pad === pad) fillStd(pad, d, 'trace'); });
    renderFoot(); renderBook();
  };
  var openListen = function () {
    var k = S.v.written.indexOf(false);
    if (k < 0) return submitAll();
    S.i = k;
    var inks = []; for (var c = 0; c < S.v.sizes[k]; c++) inks.push(null);
    S.w = { i: k, c: 0, inks: inks, done: [], chars: {}, mode: 'write', pad: null };
    $('#l-av').textContent = avatarText();
    show('listen');
    event('show', k);
    openChar(0);
    sayWord(k, 2);
  };
  $('#l-again').addEventListener('click', function () { event('again', S.i); sayWord(S.i, 1); });
  /** 这个字写好了:下一个没写的字;这个词都写了就交这个词,念下一个 */
  $('#l-next').addEventListener('click', function () {
    var w = S.w; if (!w) return;
    if (w.mode === 'trace' && !w.pad.strokes.length) { status('照着灰色的写一遍,再点写好了'); return; }
    event('done', S.i, w.c);
    stash(); w.done[w.c] = true;
    var size = S.v.sizes[S.i];
    for (var c = 1; c <= size; c++) { var n = (w.c + c) % size; if (!w.done[n]) return openChar(n); }
    stopSay();
    var k = S.i;
    var chars = w.inks.map(function (x) { return x ? { strokes: x.strokes, undos: x.undos, revealed: x.revealed || undefined } : { strokes: [], undos: 0 }; });
    persist('PUT', '/api/dictation/' + S.v.id + '/first/' + k, { chars: chars }, $('#l-next')).then(function () {
      S.v.written[k] = true; S.v.mine[k] = chars;
      openListen();
    }, function () { start(false); });
  });
  /** 不会写,给答案:服务端回这一个字(并记下),写了一半的清掉,书上的字一笔一笔写 */
  $('#l-reveal').addEventListener('click', function () {
    var w = S.w; if (!w) return;
    stopSay(); status('');
    persist('POST', '/api/dictation/' + S.v.id + '/reveal/' + S.i, { char: w.c, t: now() }, $('#l-reveal')).then(function (j) {
      w.chars[w.c] = j.ch; w.mode = 'order';
      w.pad.strokes = []; w.pad.ink.replaceChildren(); S.stack = []; updateHere();
      renderFoot();
      glyph(j.ch).then(function (d) { w.d = d; fillStd(w.pad, d, ''); playOrder(); });
    });
  });
  var playOrder = function () {
    var w = S.w, pad = w.pad, d = w.d; if (!d) return;
    event('order', S.i, w.c);
    var tok = (w.otok = (w.otok || 0) + 1);
    pad.top.replaceChildren();
    var paths = pad.std.children, n = d.strokes.length, k = 0, sq = $('#l-sqs');
    var paint = function (cur, anim) {
      for (var i = 0; i < paths.length; i++) paths[i].setAttribute('class', i < cur ? 'sd' : i === cur && !anim ? 'sc' : 'sf');
      sq.replaceChildren(); for (var j = 0; j < n; j++) sq.append(h('i', { 'class': j < cur ? 'd' : j === cur ? 'c' : '' }, String(j + 1)));
    };
    var step = function () {
      if (tok !== w.otok) return;
      if (k >= n) { paint(n, false); return; }
      paint(k, true);
      animStroke(pad, d, k, 'o', function () { if (tok !== w.otok) return; paint(k, false); k++; setTimeout(step, 380); });
    };
    step();
  };
  $('#l-again-order').addEventListener('click', playOrder);
  /** 我来写:描红打底,必须照着写一遍才能写好了(拍板 8) */
  $('#l-trace').addEventListener('click', function () {
    var w = S.w; w.otok++; w.pad.top.replaceChildren();
    w.mode = 'trace'; fillStd(w.pad, w.d, 'trace');
    var ps = w.pad.std.children; for (var i = 0; i < ps.length; i++) ps[i].removeAttribute('class');
    renderFoot(); status('');
  });
  $('#l-reorder').addEventListener('click', function () { var w = S.w; if (!w.d) return glyph(w.chars[w.c]).then(function (d) { w.d = d; $('#l-reorder').click(); }); w.mode = 'order'; fillStd(w.pad, w.d, ''); renderFoot(); playOrder(); });
  var submitAll = function () {
    persist('POST', '/api/dictation/' + S.v.id + '/check', null, $('#l-next')).then(function (v) { setView(v); openCheck(); });
  };

  // ---------- 对答案 ----------
  var openCheck = function () {
    if (!S.v.answers) { api('GET', '/api/dictation/' + S.v.id + '/kid').then(function (v) { setView(v); if (v.answers) openCheck(); }); return; }
    var box = $('#c-cards');
    var size = window.innerWidth < 700 ? 110 : 130;
    var most = Math.max.apply(null, S.v.answers.map(function (w) { return Array.from(w.chars).length; }));
    box.style.setProperty('--card', Math.min(window.innerWidth - 48, most * (size + 10) + 40) + 'px');
    box.replaceChildren();
    S.v.answers.forEach(function (w, wi) {
      var chars = Array.from(w.chars);
      var row = h('div', { 'class': 'pads' });
      row.style.setProperty('--pad', size + 'px');
      chars.forEach(function (ch, ci) {
        var pad = makePad({ ink: w.ink[ci] || [], onTap: function () { event('strokeOrder', wi, ci); openStrokeOrder(wi, ci); } });
        glyph(ch).then(function (d) { fillStd(pad, d, ''); });
        row.append(pad.el);
      });
      var tail = w.ask
        ? h('div', { 'class': 'ask' }, '这个再写一遍?', h('button', { on: { click: function () { event('rewrite', wi); openRewrite(wi, false); } } }, '好'))
        : h('button', { 'class': 'self', on: { click: function () { event('self', wi); openRewrite(wi, true); } } }, w.rewrote ? '再写一次' : '我想再写');
      box.append(h('div', { 'class': 'wc' }, row, tail));
    });
    show('check');
  };
  $('#c-toggle').addEventListener('click', function () {
    var bare = $('#v-check').classList.toggle('bare');
    $('#c-toggle span').textContent = bare ? '叠上蓝字' : '拿开蓝字';
  });
  $('#c-done').addEventListener('click', function () {
    persist('POST', '/api/dictation/' + S.v.id + '/done', null, $('#c-done')).then(goHome, goHome);
  });

  // ---------- 逐笔看 ----------
  /** 在 pad 的最上层把第 i 笔写出来:中线粗线沿着描、外面套这一笔的轮廓做 clipPath(同首页田字格卡的写法) */
  var animStroke = function (pad, d, i, cls, then) {
    var id = 'c' + Math.random().toString(36).slice(2, 9);
    var cp = sv('clipPath', { id: id }); cp.append(sv('path', { d: d.strokes[i] }));
    var defs = sv('defs', {}); defs.append(cp);
    var pts = d.medians[i] || [];
    var len = Math.round(polyLen(pts)) + 200;
    var path = sv('path', { d: 'M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join(' L'), 'clip-path': 'url(#' + id + ')', 'class': cls });
    path.style.strokeDasharray = String(len); path.style.strokeDashoffset = String(len);
    pad.top.append(defs, path);
    var ms = Math.max(260, Math.round(len * 0.9));
    void path.getBoundingClientRect();
    path.style.transition = 'stroke-dashoffset ' + ms + 'ms linear';
    path.style.strokeDashoffset = '0';
    return setTimeout(function () { pad.top.replaceChildren(); if (then) then(); }, ms + 120);
  };
  var openStrokeOrder = function (wi, ci) {
    var w = S.v.answers[wi]; var ch = Array.from(w.chars)[ci];
    stopStrokeOrder();
    var box = $('#r-pad');
    var size = Math.max(240, Math.min(560, window.innerHeight - 140, Math.floor(window.innerWidth * (window.innerWidth > window.innerHeight ? 0.5 : 0.9))));
    box.style.setProperty('--pad', size + 'px');
    var pad = makePad({ ink: w.ink[ci] || [] });
    pad.svg.insertBefore(pad.ink, pad.std); // 这一屏书上的字在上:孩子的字垫在下面(浅灰)
    box.replaceChildren(pad.el);
    S.order = { wi: wi, ci: ci, pad: pad, d: null, k: 0, playing: false, timer: 0 };
    show('order');
    glyph(ch).then(function (d) { if (!S.order || S.order.pad !== pad || !d) return; S.order.d = d; fillStd(pad, d, ''); stepTo(0, true); });
  };
  var stopStrokeOrder = function () { if (S.order) { clearTimeout(S.order.timer); S.order.playing = false; S.order.pad.top.replaceChildren(); } };
  /** 停在第 k 笔:前面的蓝、这一笔橙、后面的淡;play = 从这一笔起一笔接一笔写下去 */
  var stepTo = function (k, play) {
    var R = S.order; if (!R || !R.d) return;
    clearTimeout(R.timer); R.pad.top.replaceChildren();
    var n = R.d.strokes.length; R.k = Math.max(0, Math.min(k, n)); R.playing = Boolean(play);
    var paths = R.pad.std.children;
    var paint = function (cur, animating) { for (var i = 0; i < paths.length; i++) paths[i].setAttribute('class', i < cur ? 'sd' : i === cur && !animating ? 'sc' : 'sf'); };
    var sq = $('#r-sqs'); sq.replaceChildren();
    for (var i = 0; i < n; i++) sq.append(h('i', { 'class': i < R.k ? 'd' : i === R.k ? 'c' : '' }, String(i + 1)));
    $('#r-count').innerHTML = R.k < n ? '<b>第 ' + (R.k + 1) + ' 笔</b> · 一共 ' + n + ' 笔' : '写完了 · 一共 ' + n + ' 笔';
    $('#r-play').textContent = R.k >= n ? '再写一遍' : '接着写';
    if (R.k >= n) { paint(n, false); R.playing = false; return; }
    if (!play) { paint(R.k, false); return; }
    paint(R.k, true);
    R.timer = animStroke(R.pad, R.d, R.k, 'o', function () { if (S.order !== R || !R.playing) return; paint(R.k, false); R.timer = setTimeout(function () { stepTo(R.k + 1, true); }, 420); });
  };
  $('#r-prev').addEventListener('click', function () { if (S.order) stepTo(S.order.k - 1, false); });
  $('#r-next').addEventListener('click', function () { if (S.order) stepTo(S.order.k + 1, false); });
  $('#r-play').addEventListener('click', function () { if (!S.order || !S.order.d) return; stepTo(S.order.k >= S.order.d.strokes.length ? 0 : S.order.k, true); });
  $('#r-zero').addEventListener('click', function () { if (S.order) stepTo(0, true); });
  $('#r-back').addEventListener('click', function () { stopStrokeOrder(); S.order = null; openCheck(); });
  $('#r-rewrite').addEventListener('click', function () { var wi = S.order ? S.order.wi : 0; var w = S.v.answers[wi]; stopStrokeOrder(); S.order = null; event(w.ask ? 'rewrite' : 'self', wi); openRewrite(wi, !w.ask); });

  // ---------- 再写一遍 ----------
  var openRewrite = function (wi, self) {
    var w = S.v.answers[wi]; var chars = Array.from(w.chars);
    S.rw = { wi: wi, self: self };
    $('#w-title').textContent = '再写一遍:' + w.chars;
    var mbox = $('#w-models'); mbox.style.setProperty('--pad', (window.innerWidth < 700 ? 90 : 140) + 'px'); mbox.replaceChildren();
    chars.forEach(function (ch) {
      var pad = makePad({ onTap: function () { writeModel(pad); } });
      glyph(ch).then(function (d) { pad.d = d; fillStd(pad, d, 'model'); });
      mbox.append(pad.el);
    });
    show('rewrite');
    var land = window.innerWidth > window.innerHeight;
    writePads($('#w-pads'), chars.length, land ? 260 : 520, land ? 0.62 : 1);
  };
  /** 范字点一下:淡下去,一笔一笔重新写出来 */
  var writeModel = function (pad) {
    if (!pad.d || pad.busy) return;
    pad.busy = true; pad.std.setAttribute('class', 'std model writing');
    var paths = pad.std.children; var k = 0;
    var next = function () {
      if (k >= pad.d.strokes.length) { pad.std.setAttribute('class', 'std model'); for (var i = 0; i < paths.length; i++) paths[i].removeAttribute('style'); pad.busy = false; return; }
      animStroke(pad, pad.d, k, 'k', function () { paths[k].style.fill = '#3a3a3a'; k++; next(); });
    };
    next();
  };
  $('#w-skip').addEventListener('click', function () { S.rw = null; openCheck(); });
  $('#w-done').addEventListener('click', function () {
    if (!S.rw) return;
    var body = padsOut(); body.self = S.rw.self;
    persist('POST', '/api/dictation/' + S.v.id + '/rewrites/' + S.rw.wi, body, $('#w-done')).then(function (v) { setView(v); S.rw = null; openCheck(); }, function () { openCheck(); });
  });

  if (HOME) start(false); else openSnap();
})();
</script>
</body></html>`;
