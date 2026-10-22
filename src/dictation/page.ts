/**
 * /dictation:孩子的听写页(从首页的听写卡点进来,?home=<首页 id>&n=<第几张听写卡>;原型 https://claude.ai/artifact/WfKtooajFintau63RUHXqJ)。
 * 五屏同一页:开始、听写(老师念、孩子在田字格里写)、对答案(书上的字淡淡叠在上面)、逐笔看(书上的字在孩子写的上面一笔一笔写)、再写一遍。
 * 田字格是 SVG,坐标同 hanzi-writer:1024 见方、y 向上,组上 scale(1,-1) translate(0,-900) 摆正;孩子的笔、书上的字、逐笔写都在这一个坐标里。
 * 页面上永远没有对错:没有叉、没有分数;比对的结果只变成一句「这个再写一遍?」,其余给家长(/dictation/parent)。
 * 内联脚本里不写反斜杠、不写反引号、不写美元加花括号(这是模板字符串,见 CLAUDE.md「坑」)。
 */
import { LAYER_X, TUTOR_FACE_CSS, TUTOR_FACE_JS } from '../server/tutor-face.ts';
import { KID_NAV_JS } from '../server/kid-nav.ts';
import { KID_LOG_JS } from '../server/kid-log.ts';
import { UNLOCK_JS } from './unlock.ts';
import { REEL_MODE_JS } from './reel-mode.ts';
import { SNAP_CSS, snapHtml } from '../server/photo-ui.ts';
import { faviconLinks } from '../lib/favicon.ts';
import { BTN_CSS, BTN_JS, btn } from './ui.ts';

/** 写字格三档的按钮(拍板 30):档、图标边长、读屏的名字;越下越大 */
const PAD_SIZES: [string, number, string][] = [['s', 14, '小'], ['m', 20, '中'], ['l', 28, '大']];

export const DICTATION_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
${faviconLinks()}
<title>听写</title>
<style>
  :root { --ink:#2b2b2b; --dim:#66625b; --line:#e2dfd6; --paper:#faf9f4; --card:#ffffff; --sand:#d8c7a0; --sand2:#e2d4b4;
    --accent:#e8743b; --blue:#4f86d1;
    /* 学科色(《wip/听写设想.md》拍板 20):这次听写那位老师的颜色,页面读到老师后换(缺省语文);按钮、气泡、当前那格都跟它。橙色只留给「正在写的那一笔」 */
    --sc:#c43c74; --clay:var(--sc); --tutor:color-mix(in srgb, var(--sc) 10%, #fff); --tutor-line:color-mix(in srgb, var(--sc) 32%, #fff); --tutor-ink:color-mix(in srgb, var(--sc) 62%, #000); --tutor-ink2:color-mix(in srgb, var(--sc) 78%, #000); }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { margin:0; height:100%; background:var(--paper); color:var(--ink); font:17px/1.5 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; overscroll-behavior:none; -webkit-user-select:none; user-select:none; }
  button { font:inherit; color:inherit; cursor:pointer; }
  .view { display:none; min-height:100%; flex-direction:column; padding:calc(env(safe-area-inset-top) + 10px) max(24px, env(safe-area-inset-right)) 24px max(24px, env(safe-area-inset-left)); gap:18px; }
  .view.on { display:flex; }
  .bar { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .bar .l { display:flex; align-items:center; gap:14px; min-width:0; }
  /* 按钮两页同一份(拍板 28,ui.ts) */
${BTN_CSS}
  .ttl { font-size:22px; font-weight:700; }
  .dots { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .dots i { width:14px; height:14px; border-radius:7px; background:var(--line); }
  .dots i.d { background:#8fb4e3; }
  .dots i.c { width:30px; background:var(--accent); }
  .av { width:64px; height:64px; border-radius:32px; background:var(--tutor); border:2px solid var(--tutor-line); display:grid; place-items:center; font-size:26px; color:var(--tutor-ink); flex:none; }
  .bubble { display:flex; align-items:center; gap:16px; padding:16px 24px; background:var(--tutor); border-radius:24px; border-top-left-radius:6px; }
  .bubble b { display:block; font-size:24px; color:var(--tutor-ink); }
  .bubble small { display:block; font-size:15px; color:var(--tutor-ink2); min-height:22px; }
  .bubble svg { width:32px; height:32px; flex:none; }
  .say { display:flex; align-items:center; gap:16px; align-self:center; flex-wrap:wrap; justify-content:center; }
  .pads { display:flex; gap:24px; justify-content:center; align-items:center; flex-wrap:wrap; }
  .padbox { position:relative; width:var(--pad, 300px); height:var(--pad, 300px); flex:none; }
  .padbox svg { display:block; width:100%; height:100%; touch-action:none; }
  .padbox.act { box-shadow:0 0 0 4px var(--tutor-line); border-radius:6px; }
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
  #v-listen { flex-direction:row; gap:24px; padding:calc(env(safe-area-inset-top) + 10px) 20px 20px; height:100vh; height:100dvh; }
  /* 左上角的胶囊(回首页)浮在左边一栏、照片上面:它们从胶囊下面开始 */
  #v-pick .shot { margin-top:58px; }
  /* 听写本(拍板 30):一个词的格子拼成一条(字与字共用一条线),词挨着排、排满换行 */
  .book { width:300px; flex:none; min-height:0; display:flex; flex-flow:row wrap; align-content:flex-start; gap:8px 6px; padding:14px 8px; background:#fff; border:1px solid var(--line); border-radius:22px; overflow:auto; }
  .book .bh { flex:0 0 100%; display:flex; align-items:baseline; justify-content:space-between; padding:0 8px 2px; }
  .book .bh b { font-size:20px; }
  .book .bh span { font-size:14px; color:var(--dim); }
  .brow { display:flex; align-items:flex-start; gap:3px; }
  .brow.ahead { opacity:.45; }
  .brow .no { width:14px; text-align:right; color:var(--dim); font-size:12px; line-height:1; padding-top:3px; flex:none; }
  .brow.cur .no { color:#b9531c; font-weight:700; }
  .brow .strip { display:flex; border:1px solid var(--sand); background:#fff; }
  .brow.cur .strip { border-color:var(--sc); box-shadow:0 0 0 1px var(--sc); }
  .brow .padbox { width:58px; height:58px; }
  .brow .padbox + .padbox { border-left:1px solid var(--sand); }
  .brow .grid rect { stroke:none; }
  .brow .padbox.here .grid rect { fill:var(--tutor); }
  .chip { display:flex; align-items:center; gap:12px; padding:6px 16px 6px 6px; background:var(--tutor); border-radius:28px; min-width:0; }
  .chip svg { width:26px; height:26px; flex:none; }
  .chip b { display:block; font-size:18px; color:var(--tutor-ink); white-space:nowrap; }
  .chip small { display:block; font-size:14px; color:var(--tutor-ink2); white-space:nowrap; min-height:20px; }
  .big { flex:1; min-height:0; display:flex; align-items:center; justify-content:center; }
  /* 写字格三档(拍板 30):写字区右上角一竖排,越下越大;选的记在 cookie(cotutor_dict_pad) */
  .bigw { flex:1; min-height:0; min-width:0; position:relative; display:flex; }
  .padsz { position:absolute; right:0; top:0; display:flex; flex-direction:column; gap:4px; padding:6px 4px; background:#fff; border:1px solid var(--line); border-radius:16px; }
  .padsz button { width:44px; height:44px; border:0; border-radius:12px; background:none; display:grid; place-items:center; padding:0; }
  .padsz svg { display:block; }
  .padsz rect { fill:#fff; stroke:var(--sand); stroke-width:1.5; }
  .padsz line { stroke:var(--sand2); stroke-width:1; }
  .padsz button[aria-pressed="true"] { background:var(--tutor); }
  .padsz button[aria-pressed="true"] rect { stroke:var(--sc); }
  .std.trace path { fill:#d9d5cc; fill-opacity:1; }
  /* 写字的左边一栏(拍板 20):气泡与再念、听写本、按钮都在这;右边 .big 整块高度只放田字格 */
  #v-listen .side3 { width:300px; flex:none; min-height:0; display:flex; flex-direction:column; gap:12px; padding-top:58px; }
  #v-listen .side3 .book { width:auto; flex:1 1 auto; }
  #v-listen .chip { padding:8px 8px 8px 14px; border-radius:22px; }
  #v-listen .chip .ct { flex:1; min-width:0; }
  #v-listen .chip .ct b { white-space:normal; line-height:1.3; }
  #v-listen .chip .tool { flex:none; min-height:44px; padding:0 14px; }
  #v-listen .foot { flex-direction:column; align-items:stretch; gap:8px; flex-wrap:nowrap; }
  #v-listen .foot .tools { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; }
  #v-listen .foot .tool { min-height:52px; padding:0 12px; font-size:16px; }
  #v-listen .foot .tool.reveal, #v-listen #l-reorder { grid-column:span 2; }
  #v-listen .foot .main { width:100%; padding:0 16px; }
  #v-listen #l-foot-order .tools { display:flex; flex-direction:column; gap:10px; }
  /* 竖着(iPad 竖放、手机):一栏拆开,从上到下是气泡、听写本、田字格、按钮 */
  @media (orientation: portrait) {
    #v-listen { flex-direction:column; gap:12px; }
    #v-listen .side3 { display:contents; }
    #v-listen .chip { order:1; margin-left:100px; }
    #v-listen .side3 .book { order:2; flex:none; max-height:180px; }
    #v-listen .bigw { order:3; }
    #v-listen .foot { order:4; flex-direction:row; align-items:center; flex-wrap:wrap; }
    #v-listen .foot .tools { display:flex; flex-wrap:wrap; }
    #v-listen .foot .main { width:auto; margin-left:auto; padding:0 32px; }
  }
  /* 开始 */
  #v-start .grow { align-items:center; text-align:center; }
  #v-start .hd { font-size:30px; font-weight:700; }
  #v-start .sub { color:var(--dim); font-size:18px; }
  #v-start .acts { display:flex; flex-direction:column; gap:14px; align-items:center; }
  /* 对答案 */
  .cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(var(--card, 320px), 1fr)); gap:18px; align-content:start; }
  .wc { display:flex; flex-direction:column; align-items:center; gap:12px; padding:16px; background:var(--card); border:1px solid var(--line); border-radius:20px; }
  .wc .pads { gap:10px; flex-wrap:nowrap; }
  .wc .padbox { cursor:pointer; }
  .ask { display:flex; align-items:center; gap:12px; padding:6px 6px 6px 16px; background:var(--tutor); border-radius:24px; font-size:17px; color:var(--tutor-ink); }
  .ask button { display:inline-flex; align-items:center; gap:6px; min-height:44px; padding:0 20px; border-radius:22px; border:0; background:var(--clay); color:#fff; font-weight:600; }
  .self { display:inline-flex; align-items:center; gap:6px; min-height:44px; padding:0 16px; border-radius:22px; border:1px solid var(--line); background:#fff; font-size:15px; color:var(--dim); }
  .ask button svg, .self svg { width:18px; height:18px; flex:none; }
  .hint { color:var(--dim); font-size:17px; }
  /* 逐笔看 */
  #v-order .grow { flex-direction:row; align-items:center; justify-content:center; gap:48px; flex-wrap:wrap; }
  .side { display:flex; flex-direction:column; gap:24px; max-width:420px; }
  .side .ttl { font-size:28px; }
  .count { font-size:20px; }
  .count b { color:#b9531c; }
  .row { display:flex; gap:12px; flex-wrap:wrap; }
  /* 再写一遍 */
  /* 整词并排,格子按范字旁边(竖着是下面)剩的地方放到最大(《wip/听写设想.md》拍板 27,rowFit) */
  #v-rewrite { height:100vh; height:100dvh; }
  #v-rewrite .grow { flex-direction:row; align-items:center; justify-content:center; gap:40px; flex-wrap:nowrap; min-height:0; }
  #v-rewrite #w-pads { flex-wrap:nowrap; }
  /* 横着:范字竖着排成左边窄窄一栏,宽度都给写字的格子;竖着:范字一排在上 */
  @media (orientation: landscape) { #v-rewrite .models { padding:16px 14px; } #v-rewrite .models .pads { flex-direction:column; } #v-rewrite .models .hint { text-align:center; font-size:15px; line-height:1.4; } #v-rewrite .models .hint i { display:none; } #v-rewrite .models .hint span { display:block; white-space:nowrap; } }
  @media (orientation: portrait) { #v-rewrite .grow { flex-direction:column; gap:24px; } }
  .models { display:flex; flex-direction:column; align-items:center; gap:12px; padding:20px; background:var(--card); border:1px solid var(--line); border-radius:20px; }
  .models .pads { gap:10px; flex-wrap:nowrap; }
  .models .padbox { cursor:pointer; }
  /* 拍照开始:拍(拍照屏同英语页,photo-ui.ts)→ 照片上一项一项冒出框,点着选 → 右边是这次写的词 */
${SNAP_CSS}
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
  .wr.extra { border-style:dashed; }
  .add { display:flex; gap:8px; align-items:center; }
  .add input { flex:1; min-width:0; font:inherit; font-size:18px; min-height:48px; padding:0 14px; border:1px solid var(--line); border-radius:14px; background:#fff; }
  .fulltxt { display:flex; flex-direction:column; gap:6px; padding:12px; background:#fff; border:1px solid var(--line); border-radius:14px; }
  .fulltxt .fh { font-size:14px; color:var(--dim); }
  .fulltxt .ln { line-height:2.1; font-size:19px; }
  .seg { font:inherit; font-size:19px; padding:2px 4px; margin:0 1px; border:0; border-radius:6px; background:transparent; color:var(--ink); cursor:pointer; }
  .seg.on { background:rgba(47,111,214,.18); box-shadow:inset 0 0 0 2px #2f6fd6; }
  .seg.no { cursor:default; color:var(--dim); padding:2px 1px; }
  @media (orientation: portrait) { #v-pick { flex-direction:column; } .side2 { width:auto; flex:0 0 42%; } }
  @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
${TUTOR_FACE_CSS}
</style></head>
<body>
<div class="view" id="v-start">
  <div class="bar"><span class="bk-slot"></span></div>
  <div class="grow">
    <div class="av" id="s-av"></div>
    <div class="hd" id="s-big">听写</div>
    <div class="sub" id="s-sub"></div>
    <div class="acts" id="s-acts"></div>
  </div>
</div>

<div class="view" id="v-snap">
  ${snapHtml({ kind: 'zh', id: 'snap-hero', cam: 'snap-cam', lib: 'snap-lib' })}
</div>

<div class="view" id="v-pick">
  <div class="shot" id="p-shot"></div>
  <div class="side2">
    <div><div class="ttl" id="p-lesson">认一认</div><div class="st" id="p-status"></div></div>
    <div class="hint" style="font-size:15px">点照片上的框:蓝的会念,虚线的不念。橙的没认准,改一下字。</div>
    <div class="wl">
      <div id="p-list" style="display:flex;flex-direction:column;gap:8px"></div>
      <div class="add"><input id="p-add" placeholder="自己加词,空格分开" aria-label="自己加词">${btn('tool sm', 'add', '加', 'id="p-add-go"')}</div>
      <div class="fulltxt" id="p-full" hidden><div class="fh">照片上的字 · 点一个词加进来</div><div id="p-lines"></div></div>
    </div>
    <div class="row">
      ${btn('tool', 'camera', '重拍', 'id="p-again"')}
      ${btn('main', 'start', '开始听写', 'id="p-go" style="flex:1"')}
    </div>
  </div>
</div>

<div class="view" id="v-listen">
  <!-- 写字(拍板 20):左边一栏是气泡与再念、听写本、按钮;右边整块高度只放田字格 -->
  <div class="side3">
    <div class="chip">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="color:var(--tutor-ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path></svg>
      <div class="ct"><b id="l-what"></b><small id="l-status"></small></div>
      ${btn('tool sm', 'again', '再念', 'id="l-again"')}
    </div>
    <div class="book" id="l-book"></div>
    <div class="foot" id="l-foot-write">
      <div class="tools">
        ${btn('tool', 'undo', '撤销', 'data-undo="1"')}
        ${btn('tool', 'clear', '擦掉', 'data-clear="1"')}
        ${btn('tool reveal', 'reveal', '不会写,给答案', 'id="l-reveal"')}
        ${btn('tool', 'order', '再看笔顺', 'id="l-reorder" hidden')}
      </div>
      ${btn('main', 'done', '写好了', 'id="l-next"')}
    </div>
    <!-- 看笔顺(拍板 31):没有「我来写」;放完或一落笔就换成照着写 -->
    <div class="foot" id="l-foot-order" hidden>
      <div class="tools">${btn('tool', 'replay', '再看一遍', 'id="l-again-order"')}</div>
    </div>
  </div>
  <div class="bigw">
    <div class="big" id="l-big"></div>
    <div class="padsz" id="l-size" role="group" aria-label="写字格大小">${PAD_SIZES.map(([k, px, name]) => `<button type="button" data-pad="${k}" aria-label="${name}" aria-pressed="false"><svg width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" aria-hidden="true"><rect x="0.75" y="0.75" width="${px - 1.5}" height="${px - 1.5}" rx="2"></rect><line x1="${px / 2}" y1="1.5" x2="${px / 2}" y2="${px - 1.5}"></line><line x1="1.5" y1="${px / 2}" x2="${px - 1.5}" y2="${px / 2}"></line></svg></button>`).join('')}</div>
  </div>
</div>

<div class="view" id="v-check">
  <div class="bar">
    <div class="l"><span class="bk-slot"></span><div style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="ttl">写完啦,自己对一对</span><span class="hint">淡蓝的是书上的字,叠在你写的上面。点一个字,看它一笔一笔怎么写。</span></div></div>
    ${btn('tool sm', 'overlay', '拿开蓝字', 'id="c-toggle"')}
  </div>
  <div class="cards" id="c-cards"></div>
  <div class="foot"><span></span>${btn('main', 'done', '对好了', 'id="c-done"')}</div>
</div>

<div class="view" id="v-order">
  <div class="bar"><span></span><button class="layer-x" type="button" id="r-back" aria-label="回到对一对">${LAYER_X}</button></div>
  <div class="grow">
    <div class="pads" id="r-pad"></div>
    <div class="side">
      <div><div class="ttl">看它一笔一笔写</div><div class="hint">蓝笔在你写的字上面写一遍,正在写的那一笔是橙色的。</div></div>
      <div class="count" id="r-count"></div>
      <div class="row">
        ${btn('tool', 'prev', '', 'id="r-prev" aria-label="上一笔"')}
        ${btn('tool', 'start', '接着写', 'id="r-play" style="flex:1"')}
        ${btn('tool', 'next', '', 'id="r-next" aria-label="下一笔"')}
        ${btn('tool', 'replay', '从头写', 'id="r-zero"')}
      </div>
      ${btn('main', 'write', '我再写一遍', 'id="r-rewrite"')}
    </div>
  </div>
</div>

<div class="view" id="v-rewrite">
  <div class="bar"><span class="ttl" id="w-title">再写一遍</span><button class="layer-x" type="button" id="w-skip" aria-label="回到对一对">${LAYER_X}</button></div>
  <div class="grow">
    <div class="models"><span class="hint"><span>照着看</span><i> · </i><span>点一下看笔顺</span></span><div class="pads" id="w-models"></div></div>
    <div class="pads" id="w-pads"></div>
  </div>
  <div class="foot">
    <div class="tools">
      ${btn('tool', 'undo', '撤销', 'data-undo="1"')}
      ${btn('tool', 'clear', '擦掉', 'data-clear="1"')}
    </div>
    ${btn('main', 'done', '写好了', 'id="w-done"')}
  </div>
</div>

<script>
// 孩子端的流水(kid-log.ts,《孩子端流水设计.md》):最先装上出错的监听
${KID_LOG_JS}
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var NS = 'http://www.w3.org/2000/svg';
  var HZ_T = 'scale(1,-1) translate(0,-900)';
  var sv = function (tag, attrs) { var el = document.createElementNS(NS, tag); for (var k in (attrs || {})) el.setAttribute(k, String(attrs[k])); return el; };
  var h = function (tag, attrs) {
    var el = document.createElement(tag); attrs = attrs || {};
    for (var k in attrs) { if (k === 'on') { for (var ev in attrs.on) el.addEventListener(ev, attrs.on[ev]); } else if (k === 'text') el.textContent = attrs[k]; else el.setAttribute(k, attrs[k]); }
    var add = function (c) { if (Array.isArray(c)) c.forEach(add); else if (c !== null && c !== undefined && c !== false) el.append(c); };
    for (var i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  };
${BTN_JS}
  var CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  var cn = function (n) { return n <= 10 ? CN[n] : n < 20 ? '十' + CN[n - 10] : CN[Math.floor(n / 10)] + '十' + (n % 10 ? CN[n % 10] : ''); };

  var q = new URLSearchParams(location.search);
  var HOME = q.get('home'); var N = Number(q.get('n') || 0); var TUTOR = q.get('tutor');
  /** 家长看录像时,这一页开在录像外壳的 iframe 里:只照记录画,不发事件、不念、点不动(《家长录像设计.md》拍板 13) */
  var REEL_ID = q.get('reel');
  // 录像里只记出错,不报打开
  kidLog.start({ page: 'dictation', mode: REEL_ID ? 'reel' : 'kid', ctx: function () { return { tutor: TUTOR || null }; } });
  var S = { v: null, base: Date.now(), i: 0, w: null, pads: [], stack: [], active: null, sawPen: false, sayTimer: 0, order: null, rw: null };
  /** 写字格多大(拍板 30):l 铺满写字区(上限 900)、m 500、s 380;再写一遍也照它封顶。孩子选的记在 cookie,录像照记录 */
  var PAD_CAP = { l: 900, m: 500, s: 380 };
  var readPad = function () { var m = /(?:^|; )cotutor_dict_pad=([lms])/.exec(document.cookie); return m ? m[1] : 'l'; };
  S.padl = REEL_ID ? 'l' : readPad();
  /** 点与事件的时刻:离这次听写开始(startedAt)多少毫秒;孩子端的钟,录像只看先后与间隔 */
  var now = function () { return Math.max(0, Date.now() - S.base); };
  var setView = function (v) { var fresh = !S.v || S.v.id !== v.id; S.v = v; S.base = Date.parse(v.startedAt) || S.base; showFace(); if (fresh) { S.vw = 0; sendView(); } };

  var show = function (name) { var vs = document.querySelectorAll('.view'); for (var i = 0; i < vs.length; i++) vs[i].classList.toggle('on', vs[i].id === 'v-' + name); BACK.el.hidden = name === 'order' || name === 'rewrite'; window.scrollTo(0, 0); if (!REEL_ID) guard(); };
  // 孩子端不往浏览器历史里加东西(kid-nav.ts,《产品规划.md》拍板 25):回首页是替换当前页
  ${KID_NAV_JS}
  var goHome = function () { stopSay(); kidGo('/'); };
  // ---- 左上角「‹ logo」胶囊,同老师页(《wip/听写设想.md》拍板 16,《产品规划.md》拍板 24);拍照屏的大头像是听写这次的老师,没开始时是从哪位老师卡上进来的 ----
  ${TUTOR_FACE_JS}
  // 胶囊带上念的老师(《产品规划.md》拍板 26):服务端出页面时就按 ?tutor= 或首页那张卡的 reader 插进来(BACK_TUTOR),打开就是他的颜色和首字,不先浅底再变色;一位能念的老师都没有才是 null
  var BACK_TUTOR = __BACK_TUTOR__;
  var BACK = backCapsule(goHome); BACK.set(BACK_TUTOR); document.body.append(BACK.el);
  var TUTORS = null;
  var showFace = function () { var name = (S.v && S.v.tutorName) || TUTOR; if (!TUTORS || !name) return; var t = TUTORS.filter(function (x) { return x.name === name; })[0] || null; if (t) BACK.set(t); $('#snap-av').replaceChildren(t ? tutorAvatar(t) : ''); if (t && t.color) document.documentElement.style.setProperty('--sc', t.color); };

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
  var event = function (kind, word, ch, n, more) {
    if (!S.v || REEL_ID) return;
    var b = { kind: kind, word: word, t: now() }; if (ch !== undefined) b.char = ch; if (n !== undefined) b.n = n; if (more) { b.w = more.w; b.h = more.h; b.pad = more.pad; }
    try { fetch('/api/dictation/' + S.v.id + '/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b), keepalive: true }).catch(function () {}); } catch (e) {}
  };
  /** 录像要的:屏幕多大与写字格的档(进来、转屏停手 300 毫秒、换档,变了才记)、切到别处 / 回来 */
  var viewTimer = 0;
  var sendView = function () { if (!S.v || S.v.done) return; var w = window.innerWidth, hh = window.innerHeight; if (w === S.vw && hh === S.vh && S.padl === S.vp) return; S.vw = w; S.vh = hh; S.vp = S.padl; event('view', S.i || 0, undefined, undefined, { w: w, h: hh, pad: S.padl }); };
  window.addEventListener('resize', function () { clearTimeout(viewTimer); viewTimer = setTimeout(sendView, 300); });
  document.addEventListener('visibilitychange', function () { if (S.v && !S.v.done) event(document.hidden ? 'away' : 'back', S.i || 0); });

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
    var pad = { el: h('div', { 'class': 'padbox' }, svg), svg: svg, std: std, ink: ink, top: top, strokes: [], undos: 0, gone: [] };
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
      if (pad.onDown) pad.onDown();
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
  /** 擦掉的笔留着,记上擦的时刻(录像里在那一刻消失,《家长录像设计.md》拍板 13) */
  var drop = function (pad, pts) { if (pad.gone.length < 200) pad.gone.push({ t: now(), pts: pts }); };
  var undo = function () { var pad = S.stack.pop(); if (!pad || !pad.strokes.length) return; drop(pad, pad.strokes.pop()); if (pad.ink.lastChild) pad.ink.lastChild.remove(); pad.undos++; if (pad.onUp) pad.onUp(); };
  var clearActive = function () { var pad = S.active; if (!pad || !pad.strokes.length) return; pad.strokes.forEach(function (st) { drop(pad, st); }); pad.strokes = []; pad.ink.replaceChildren(); pad.undos++; S.stack = S.stack.filter(function (x) { return x !== pad; }); if (pad.onUp) pad.onUp(); };
  var us = document.querySelectorAll('[data-undo]'); for (var i1 = 0; i1 < us.length; i1++) us[i1].addEventListener('click', undo);
  var cs = document.querySelectorAll('[data-clear]'); for (var i2 = 0; i2 < cs.length; i2++) cs[i2].addEventListener('click', clearActive);
  var padsOut = function () { return { chars: S.pads.map(function (p) { return { strokes: p.strokes, undos: p.undos, gone: p.gone }; }) }; };
  /**
   * 再写一遍那一排格子多大(《wip/听写设想.md》拍板 27):先把格子缩成 0,量范字旁边(竖着是下面)剩多少,整词并排放得下的最大;
   * 上限同写字屏(选的档,拍板 30)。原来按屏幕估、封顶 340,iPad 横放只有写字屏格子的一半大
   */
  var rowFit = function (box, count) {
    box.style.setProperty('--pad', '0px');
    var grow = box.parentNode, cs = getComputedStyle(grow), models = grow.querySelector('.models'), mbox = models.querySelector('.pads');
    var row = cs.flexDirection === 'row';
    // 范字:横着竖排在左边一栏,一栏放不下就缩(最小 64)
    var mp = window.innerWidth < 700 ? 90 : 140;
    if (row) { mbox.style.setProperty('--pad', '0px'); mp = Math.max(64, Math.min(mp, Math.floor((grow.getBoundingClientRect().height - models.getBoundingClientRect().height) / count))); }
    mbox.style.setProperty('--pad', mp + 'px');
    var g = grow.getBoundingClientRect(), m = models.getBoundingClientRect();
    var w = row ? g.width - m.width - (parseFloat(cs.columnGap) || 0) : g.width;
    var hh = row ? g.height : g.height - m.height - (parseFloat(cs.rowGap) || 0);
    var size = Math.max(120, Math.min(PAD_CAP[S.padl], Math.floor(Math.min((w - (count - 1) * 24) / count, hh)) - 10));
    box.style.setProperty('--pad', size + 'px');
  };
  window.addEventListener('resize', function () { if ($('#v-rewrite').classList.contains('on')) rowFit($('#w-pads'), $('#w-pads').children.length); });
  var writePads = function (box, count) {
    S.pads = []; S.stack = []; setActive(null);
    for (var k = 0; k < count; k++) S.pads.push(makePad({ write: true }));
    box.replaceChildren.apply(box, S.pads.map(function (p) { return p.el; }));
    rowFit(box, count);
    setActive(S.pads[0]);
  };

  // ---------- 念 ----------
  var audio = new Audio(); audio.preload = 'auto';
  ${UNLOCK_JS}
  var stopSay = function () { clearTimeout(S.sayTimer); S.sayTok = (S.sayTok || 0) + 1; try { audio.pause(); } catch (e) {} };
  /** 念不出来(老师没配音色、合成失败)就直接说,不念浏览器合成声 */
  var NO_VOICE = '老师的声音还没配好 · 叫爸爸妈妈来看一下';
  var status = function (t) { $('#l-status').textContent = t; };
  /** 看笔顺放到第几笔,一行字(拍板 24:不画一排数字方块,字本身的蓝、橙、淡就是进度) */
  var strokeAt = function (k, n) { return k < n ? '第 ' + (k + 1) + ' 笔 · 一共 ' + n + ' 笔' : '写完了 · 一共 ' + n + ' 笔'; };
  /** 念第 i 个词,念 times 遍,两遍之间停一下;没有音频(没配音色、合成失败)状态行直接提示 */
  var sayWord = function (i, times) {
    stopSay();
    if (S.v.voice === false) { status(NO_VOICE); return; }
    var tok = S.sayTok; var left = times; var nth = 0;
    var next = function () { if (tok !== S.sayTok) return; if (left <= 0) { status('听完了就写'); return; } left--; nth++; status('正在念 · 第 ' + nth + ' 遍'); event('say', i, undefined, nth); play(); };
    var gap = function () { if (tok !== S.sayTok) return; status(left > 0 ? '再听一遍' : '听完了就写'); if (left > 0) S.sayTimer = setTimeout(next, 1800); };
    var mute = function () { if (tok === S.sayTok) status(NO_VOICE); };
    var play = function () {
      audio.onended = gap;
      audio.onerror = mute;
      audio.src = '/api/dictation/' + S.v.id + '/say/' + i;
      var pr = audio.play(); if (pr && pr.catch) pr.catch(function (e) { if (tok !== S.sayTok) return; if (audio.error) mute(); else if (blocked(e)) status('点「再念」听老师念'); });
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
      acts.replaceChildren(h('button', { 'class': 'main', on: { click: function () { start(true); } } }, ico('start'), lbl('再听写一次')), h('button', { 'class': 'tool', on: { click: openCheck } }, ico('look'), lbl('看看写的')));
    } else if (v.voice === false) {
      $('#s-sub').textContent = NO_VOICE;
      acts.replaceChildren(h('button', { 'class': 'main', on: { click: goHome } }, ico('home'), lbl('回首页')));
    } else if (wrote > 0) {
      $('#s-sub').textContent = '写到第' + cn(wrote + 1) + '个了';
      acts.replaceChildren(h('button', { 'class': 'main', on: { click: function () { openListen(); } } }, ico('start'), lbl('接着写')));
    } else {
      $('#s-sub').textContent = v.tutor + '念,你在田字格里写';
      acts.replaceChildren(h('button', { 'class': 'main', on: { click: function () { openListen(); } } }, ico('start'), lbl('开始')));
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
      $('#s-acts').replaceChildren(h('button', { 'class': 'main', on: { click: goHome } }, ico('home'), lbl('回首页')));
      show('start');
    });
  };

  // ---------- 拍照开始:拍 → 传 → 一项一项认出来 → 点选 → 开始 ----------
  var P = { id: null, items: [], full: [], extra: [], on: {}, edits: {}, timer: 0, img: null, url: null };
  /** 今天这位老师没写完(没点「对好了」)的拍照听写,拍照屏最上面给「接着写」(《wip/听写设想.md》拍板 17);会话先读好,点下去在手势里直接念 */
  var ymdOf = function (d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  var R = { v: null };
  var showResume = function (v) {
    R.v = v;
    $('#snap-resume').hidden = !v;
    $('#snap-cam-btn').classList.toggle('alt', Boolean(v));
    if (!v) return;
    var wrote = v.written.filter(Boolean).length;
    $('#snap-resume-sub').textContent = v.checked || wrote === v.sizes.length ? '写完了,还没对一对' : '写到第' + cn(wrote + 1) + '个了 · 一共' + cn(v.sizes.length) + '个';
  };
  var findResume = function () {
    var today = ymdOf(new Date());
    api('GET', '/api/dictation').then(function (j) {
      var x = (j.sessions || []).filter(function (s) { return s.photo && !s.done && !s.lang && (!TUTOR || s.tutor === TUTOR) && ymdOf(new Date(s.startedAt)) === today; })[0];
      if (!x) return;
      return api('GET', '/api/dictation/' + x.id + '/kid').then(function (v) { if ($('#v-snap').classList.contains('on')) showResume(v); });
    }).catch(function () {});
  };
  $('#snap-resume-go').addEventListener('click', function () { var v = R.v; if (!v) return; showResume(null); setView(v); if (v.checked) openCheck(); else openListen(); });
  var openSnap = function () { clearTimeout(P.timer); showResume(null); show('snap'); findResume(); };
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
    P = { id: null, items: [], full: [], extra: [], on: {}, edits: {}, timer: 0, img: null, url: null };
    $('#p-lesson').textContent = '认一认'; $('#p-status').textContent = '传照片…'; $('#p-list').replaceChildren(); $('#p-shot').replaceChildren(); $('#p-lines').replaceChildren(); $('#p-full').hidden = true;
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
  /** 默认选不选:模型说了算(cotutor.json 的 dictation.prompt 里写怎么挑) */
  var defaultOn = function (it) { return typeof it.pick === 'boolean' ? it.pick : it.kind !== 'read' && it.kind !== 'other'; };
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
  /** 选上的总数:照片上的 + 自己加的 */
  var pickedN = function () { return picked().length + P.extra.length; };
  var renderList = function () {
    var ks = picked(); var list = $('#p-list'); list.replaceChildren();
    ks.forEach(function (k) {
      var it = P.items[k];
      var head = it.sure ? h('b', {}, textOf(k)) : h('input', { value: textOf(k), 'aria-label': '改一下这个词', on: { input: function (e) { P.edits[keyOf(k)] = e.target.value.replace(/ /g, ''); renderFull(); } } });
      list.append(h('div', { 'class': 'wr' }, h('div', { 'class': 't' }, head, it.say ? h('small', {}, it.say) : null), h('button', { 'class': 'x', 'aria-label': '不要这个', on: { click: function () { P.on[keyOf(k)] = false; paintBoxes(); renderList(); } } }, '×')));
    });
    P.extra.forEach(function (t, j) {
      list.append(h('div', { 'class': 'wr extra' }, h('div', { 'class': 't' }, h('b', {}, t), h('small', {}, '自己加的')), h('button', { 'class': 'x', 'aria-label': '不要这个', on: { click: function () { P.extra.splice(j, 1); renderList(); } } }, '×')));
    });
    renderFull(); renderPickBtn();
  };
  /** 一到四个汉字(不用正则:这段脚本里不写反斜杠) */
  var isHan = function (c) { var n = c.charCodeAt(0); return (n >= 0x3400 && n <= 0x9fff) || (n >= 0xf900 && n <= 0xfaff); };
  var hanWords = function (text) { var out = []; var cur = ''; Array.from(text + ' ').forEach(function (c) { if (isHan(c)) cur += c; else { if (cur) out.push(cur); cur = ''; } }); return out; };
  /** 加一个词 / 去掉一个词:照片上认出过(按现在的字)就点那一项,不然进自己加的 */
  var toggleWord = function (t) {
    var k = -1; P.items.forEach(function (it, i) { if (k < 0 && textOf(i) === t) k = i; });
    if (k >= 0) { P.on[keyOf(k)] = !P.on[keyOf(k)]; paintBoxes(); renderList(); return; }
    var j = P.extra.indexOf(t);
    if (j >= 0) P.extra.splice(j, 1); else if (pickedN() >= 20) { $('#p-status').textContent = '一次最多 20 个词'; return; } else P.extra.push(t);
    renderList();
  };
  var addTyped = function () {
    var raw = $('#p-add').value; var ws = hanWords(raw);
    var bad = ws.filter(function (w) { return Array.from(w).length > 4; });
    ws.filter(function (w) { return Array.from(w).length <= 4; }).forEach(function (w) { var on = picked().some(function (k) { return textOf(k) === w; }) || P.extra.indexOf(w) >= 0; if (!on) toggleWord(w); });
    $('#p-add').value = bad.join(' ');
    if (bad.length) $('#p-status').textContent = '一个词最多四个字,分开写';
  };
  $('#p-add-go').addEventListener('click', addTyped);
  $('#p-add').addEventListener('keydown', function (e) { if (e.key === 'Enter') addTyped(); });
  /** 全文:一行一行,词能点(一到四个汉字的),选上的标蓝 */
  var renderFull = function () {
    var box = $('#p-lines'); $('#p-full').hidden = !P.full.length; if (!P.full.length) return;
    var on = {}; picked().forEach(function (k) { on[textOf(k)] = true; }); P.extra.forEach(function (t) { on[t] = true; });
    box.replaceChildren.apply(box, P.full.map(function (line) {
      return h('div', { 'class': 'ln' }, line.split(' ').filter(Boolean).map(function (seg) {
        var n = Array.from(seg).length;
        var ok = n >= 1 && n <= 4 && Array.from(seg).every(isHan);
        return ok ? h('button', { 'class': 'seg' + (on[seg] ? ' on' : ''), on: { click: function () { toggleWord(seg); } } }, seg) : h('span', { 'class': 'seg no' }, seg);
      }));
    }));
  };
  var renderPickBtn = function () { var n = pickedN(); if (P.done) $('#p-status').textContent = '认好了 · 选了 ' + n + ' 个'; $('#p-go').disabled = !P.id || n === 0; $('#p-go').textContent = n ? '开始听写 · ' + Math.min(n, 20) + ' 个' : '开始听写'; };
  var poll = function () {
    clearTimeout(P.timer);
    api('GET', '/api/dictation/photos/' + P.id).then(function (r) {
      if (r.lesson) $('#p-lesson').textContent = r.lesson;
      var grew = r.items.length > P.items.length || (r.full || []).length > P.full.length;
      if (r.items.length > P.items.length) { P.items = r.items; drawBoxes(); }
      P.full = r.full || [];
      if (grew) renderList();
      if (r.state === 'running') { $('#p-status').textContent = '正在认… 认出 ' + r.items.length + ' 个'; P.timer = setTimeout(poll, 700); return; }
      if (!r.items.length && !P.full.length) { $('#p-status').textContent = '没认出字来,再拍一张试试'; return; }
      P.done = true; renderPickBtn();
    }, function () { P.timer = setTimeout(poll, 1500); });
  };
  $('#p-again').addEventListener('click', function () { clearTimeout(P.timer); openSnap(); });
  $('#p-go').addEventListener('click', function () {
    var words = picked().map(function (k) { var it = P.items[k]; var t = textOf(k); return t === it.text ? { chars: t, say: it.say || undefined } : { chars: t }; }).concat(P.extra.map(function (t) { return { chars: t }; })).filter(function (w) { return w.chars; }).slice(0, 20);
    if (!words.length) return;
    clearTimeout(P.timer);
    persist('POST', '/api/dictation', TUTOR ? { photo: P.id, words: words, tutor: TUTOR } : { photo: P.id, words: words }, $('#p-go')).then(function (v) { setView(v); openListen(); }, function () { $('#p-status').textContent = '有的词不是一到四个汉字,改一下再开始'; });
  });
  window.addEventListener('resize', function () { if ($('#v-pick').classList.contains('on')) layoutShot(); });

  // ---------- 听写(左边听写本,右边一次写一个字;不会写就给答案:看笔顺,再照着描红写一遍)----------
  var updateHere = function () {
    var el = $('#l-book .here .ink'); if (!el || !S.w) return;
    el.replaceChildren.apply(el, S.w.pad.strokes.filter(function (x) { return x.length; }).map(function (x) { return sv('path', { d: pathD(x) }); }));
  };
  /** 听写本上一个词:编号 + 拼成一条的格子(.strip,格子往里放) */
  var bookRow = function (wi, cur) { return h('div', { 'class': 'brow' + (wi === cur ? ' cur' : wi > cur ? ' ahead' : '') }, h('div', { 'class': 'no' }, String(wi + 1)), h('div', { 'class': 'strip' })); };
  var renderBook = function () {
    var b = $('#l-book');
    var rows = [h('div', { 'class': 'bh' }, h('b', {}, '听写本'), h('span', {}, cn(S.v.sizes.length) + '个词'))];
    S.v.sizes.forEach(function (size, wi) {
      var row = bookRow(wi, S.i), strip = row.lastChild;
      for (var c = 0; c < size; c++) {
        (function (c) {
          var mine = wi === S.i ? (c === S.w.c ? { strokes: S.w.pad.strokes } : S.w.inks[c]) : S.v.mine[wi] ? S.v.mine[wi][c] : null;
          var cell = makePad({ ink: mine ? mine.strokes : [], onTap: wi === S.i ? function () { if (S.w.mode !== 'order' && c !== S.w.c) { event('open', S.i, c); openChar(c); } } : null });
          if (wi === S.i && c === S.w.c) cell.el.classList.add('here');
          strip.append(cell.el);
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
    S.w.inks[S.w.c] = { strokes: S.w.pad.strokes, undos: S.w.pad.undos, gone: S.w.pad.gone, revealed: S.w.mode === 'trace' || Boolean(prev && prev.revealed) };
  };
  /** 右边的田字格占满 .big(拍板 20:纵向尽量大),再按选的档封顶(拍板 30);两边让出右上角那排档位按钮;转屏时跟着改 */
  var fitPad = function (el) { var r = $('#l-big').getBoundingClientRect(); el.style.width = el.style.height = Math.max(240, Math.min(PAD_CAP[S.padl], Math.floor(Math.min(r.width - 112, r.height)) - 10)) + 'px'; };
  var refit = function () { var el = $('#l-big').firstElementChild; if (el) { el.style.width = el.style.height = '0px'; fitPad(el); } };
  window.addEventListener('resize', function () { if ($('#v-listen').classList.contains('on')) refit(); });
  var paintSize = function () { var bs = document.querySelectorAll('#l-size button'); for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', String(bs[i].getAttribute('data-pad') === S.padl)); };
  paintSize();
  $('#l-size').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || REEL_ID) return;
    S.padl = b.getAttribute('data-pad');
    try { document.cookie = 'cotutor_dict_pad=' + S.padl + '; Max-Age=31536000; Path=/; SameSite=Lax'; } catch (err) {}
    paintSize(); refit(); sendView();
  });
  var openChar = function (c) {
    stash(); S.w.otok = (S.w.otok || 0) + 1;
    S.w.c = c;
    var prev = S.w.inks[c];
    S.w.mode = prev && prev.revealed ? 'trace' : 'write';
    var pad = makePad({ write: true, ink: prev ? prev.strokes : [] });
    pad.strokes = prev ? prev.strokes.slice() : []; pad.undos = prev ? prev.undos : 0; pad.gone = prev && prev.gone ? prev.gone.slice() : [];
    pad.onUp = updateHere;
    pad.onDown = function () { if (S.w && S.w.pad === pad && S.w.mode === 'order') toTrace(); };
    S.w.pad = pad; S.pads = [pad]; S.stack = pad.strokes.map(function () { return pad; });
    var big = $('#l-big'); big.replaceChildren(pad.el);
    fitPad(pad.el);
    setActive(pad);
    if (S.w.mode === 'trace') glyph(S.w.chars[c]).then(function (d) { if (S.w && S.w.pad === pad) fillStd(pad, d, 'trace'); });
    renderFoot(); renderBook(); guard();
  };
  var openListen = function () {
    var k = S.v.written.indexOf(false);
    if (k < 0) return submitAll();
    S.i = k;
    var inks = []; for (var c = 0; c < S.v.sizes[k]; c++) inks.push(null);
    S.w = { i: k, c: 0, inks: inks, done: [], chars: {}, mode: 'write', pad: null };
    show('listen');
    event('show', k);
    openChar(0);
    sayWord(k, 2);
  };
  $('#l-again').addEventListener('click', function () { event('again', S.i); sayWord(S.i, 1); });
  /** 写好了(这个字):下一个没写的字;这个词都写了就交这个词,念下一个 */
  $('#l-next').addEventListener('click', function () {
    var w = S.w; if (!w) return;
    if (w.mode === 'trace' && !w.pad.strokes.length) { status('照着灰色的写一遍,再点写好了'); return; }
    event('done', S.i, w.c);
    stash(); w.done[w.c] = true;
    var size = S.v.sizes[S.i];
    for (var c = 1; c <= size; c++) { var n = (w.c + c) % size; if (!w.done[n]) return openChar(n); }
    stopSay();
    var k = S.i;
    var chars = w.inks.map(function (x) { return x ? { strokes: x.strokes, undos: x.undos, gone: x.gone && x.gone.length ? x.gone : undefined, revealed: x.revealed || undefined } : { strokes: [], undos: 0 }; });
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
      w.pad.strokes.forEach(function (st) { drop(w.pad, st); }); w.pad.strokes = []; w.pad.ink.replaceChildren(); S.stack = []; updateHere();
      renderFoot();
      glyph(j.ch).then(function (d) { w.d = d; if (w.mode === 'order') { fillStd(w.pad, d, ''); playOrder(); } else fillStd(w.pad, d, 'trace'); });
    });
  });
  var playOrder = function () {
    var w = S.w, pad = w.pad, d = w.d; if (!d) return;
    event('order', S.i, w.c);
    var tok = (w.otok = (w.otok || 0) + 1);
    pad.top.replaceChildren();
    var paths = pad.std.children, n = d.strokes.length, k = 0;
    var paint = function (cur, anim) {
      for (var i = 0; i < paths.length; i++) paths[i].setAttribute('class', i < cur ? 'sd' : i === cur && !anim ? 'sc' : 'sf');
      status(strokeAt(cur, n));
    };
    var step = function () {
      if (tok !== w.otok) return;
      if (k >= n) { paint(n, false); setTimeout(function () { if (tok === w.otok && w.mode === 'order') toTrace(); }, 900); return; }
      paint(k, true);
      animStroke(pad, d, k, 'o', function () { if (tok !== w.otok) return; paint(k, false); k++; setTimeout(step, 380); });
    };
    step();
  };
  $('#l-again-order').addEventListener('click', playOrder);
  /**
   * 换成照着写:描红打底,必须照着写一遍才能写好了(拍板 8)。看笔顺放完、或看的时候一落笔就换(拍板 31:原来要点「我来写」,
   * 10-18 孩子看着淡字直接写完了,还得点「我来写」,再在同一个位置点「写好了」);动画停下,写的这一笔照常留着
   */
  var toTrace = function () {
    var w = S.w; w.otok++; w.pad.top.replaceChildren();
    event('trace', S.i, w.c);
    w.mode = 'trace'; if (w.d) fillStd(w.pad, w.d, 'trace');
    var ps = w.pad.std.children; for (var i = 0; i < ps.length; i++) ps[i].removeAttribute('class');
    renderFoot(); status(''); guard();
  };
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
        ? h('div', { 'class': 'ask' }, '这个再写一遍?', h('button', { on: { click: function () { event('rewrite', wi); openRewrite(wi, false); } } }, ico('write'), lbl('好')))
        : h('button', { 'class': 'self', on: { click: function () { event('self', wi); openRewrite(wi, true); } } }, ico('write'), lbl(w.rewrote ? '再写一次' : '我想再写'));
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
    $('#r-count').innerHTML = R.k < n ? '<b>第 ' + (R.k + 1) + ' 笔</b> · 一共 ' + n + ' 笔' : '写完了 · 一共 ' + n + ' 笔';
    setLbl($('#r-play'), R.k >= n ? '再写一遍' : '接着写', R.k >= n ? 'replay' : 'start');
    if (R.k >= n) { paint(n, false); R.playing = false; return; }
    if (!play) { paint(R.k, false); return; }
    paint(R.k, true);
    R.timer = animStroke(R.pad, R.d, R.k, 'o', function () { if (S.order !== R || !R.playing) return; paint(R.k, false); R.timer = setTimeout(function () { stepTo(R.k + 1, true); }, 420); });
  };
  $('#r-prev').addEventListener('click', function () { if (S.order) stepTo(S.order.k - 1, false); });
  $('#r-next').addEventListener('click', function () { if (S.order) stepTo(S.order.k + 1, false); });
  $('#r-play').addEventListener('click', function () { if (!S.order || !S.order.d) return; stepTo(S.order.k >= S.order.d.strokes.length ? 0 : S.order.k, true); });
  $('#r-zero').addEventListener('click', function () { if (S.order) stepTo(0, true); });
  $('#r-back').addEventListener('click', function () { if (S.order) event('close', S.order.wi, S.order.ci); stopStrokeOrder(); S.order = null; openCheck(); });
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
    writePads($('#w-pads'), chars.length);
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
  $('#w-skip').addEventListener('click', function () { if (S.rw) event('close', S.rw.wi); S.rw = null; openCheck(); });
  $('#w-done').addEventListener('click', function () {
    if (!S.rw) return;
    var body = padsOut(); body.self = S.rw.self;
    persist('POST', '/api/dictation/' + S.v.id + '/rewrites/' + S.rw.wi, body, $('#w-done')).then(function (v) { setView(v); S.rw = null; openCheck(); }, function () { openCheck(); });
  });

  // ---------- 录像(?reel=<id>,《家长录像设计.md》拍板 13):开在录像外壳的 iframe 里,照记录用这一页的画法画;钟、把手、启动在 reel-mode.ts ----------
  /** 字形要同步拿:还没到就先不画,到了整屏重画一次 */
  var RG = {};
  var reelGlyph = function (ch) {
    if (RG[ch] !== undefined) return RG[ch] || null;
    RG[ch] = null;
    glyph(ch).then(function (d) { RG[ch] = d || false; if (RL) { RL.gl++; reelTick(); } });
    return null;
  };
  /** 看笔顺放到第几笔:照 animStroke 与 playOrder 的节奏(一笔画 max(260, (中线长 + 200) × 0.9) 毫秒,再停 120 + 380) */
  var orderStep = function (d, ms) {
    var t = 0;
    for (var i = 0; i < d.strokes.length; i++) {
      var len = Math.max(260, Math.round((polyLen(d.medians[i] || []) + 200) * 0.9));
      if (ms < t + len + 500) return i;
      t += len + 500;
    }
    return d.strokes.length;
  };
  var paintOrder = function (pad, d, k) {
    var ps = pad.std.children; for (var i = 0; i < ps.length; i++) ps[i].setAttribute('class', i < k ? 'sd' : i === k ? 'sc' : 'sf');
  };
  /** 一个格这一刻的笔:点数变了才重画 */
  var reelInk = function (pad, strokes) {
    var n = 0; strokes.forEach(function (x) { n += x.length; });
    var sig = strokes.length + ':' + n;
    if (pad.sig === sig) return;
    pad.sig = sig;
    pad.ink.replaceChildren.apply(pad.ink, strokes.filter(function (x) { return x.length; }).map(function (x) { return sv('path', { d: pathD(x) }); }));
  };
  var reelListen = function (f, rebuild) {
    var R = RL.r, ch = R.chars[f.word][f.char];
    if (rebuild) {
      show('listen');
      var rows = [h('div', { 'class': 'bh' }, h('b', {}, '听写本'), h('span', {}, cn(R.chars.length) + '个词'))];
      RL.cells = R.chars.map(function (cs, wi) {
        var row = bookRow(wi, f.word), strip = row.lastChild;
        rows.push(row);
        return cs.map(function (x, ci) { var p = makePad({}); if (wi === f.word && ci === f.char) p.el.classList.add('here'); strip.append(p.el); return p; });
      });
      var b = $('#l-book'); b.replaceChildren.apply(b, rows);
      var cur = b.querySelector('.brow.cur'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
      var big = $('#l-big'); RL.big = makePad({}); big.replaceChildren(RL.big.el);
      S.padl = f.pad; paintSize();
      fitPad(RL.big.el);
      setActive(RL.big);
      RL.std = '';
    }
    RL.cells.forEach(function (pads, wi) { pads.forEach(function (p, ci) { reelInk(p, f.ink[wi][ci]); }); });
    reelInk(RL.big, f.ink[f.word][f.char]);
    var d = f.mode === 'write' ? null : reelGlyph(ch);
    var k = d && f.mode === 'order' ? orderStep(d, RL.t - f.orderAt) : -1;
    var sk = f.mode + ':' + (d ? 1 : 0) + ':' + k;
    if (sk !== RL.std) {
      RL.std = sk;
      RL.big.std.setAttribute('class', 'std' + (f.mode === 'trace' ? ' trace' : ''));
      RL.big.std.replaceChildren();
      if (d) { fillStd(RL.big, d, f.mode === 'trace' ? 'trace' : ''); if (f.mode === 'order') paintOrder(RL.big, d, k); }
    }
    $('#l-foot-write').hidden = f.mode === 'order'; $('#l-foot-order').hidden = f.mode !== 'order';
    $('#l-reveal').hidden = f.mode === 'trace'; $('#l-reorder').hidden = f.mode !== 'trace';
    $('#l-what').textContent = f.mode === 'order' ? '看「' + ch + '」一笔一笔写' : f.mode === 'trace' ? '照着灰色的「' + ch + '」写一遍' : R.chars[f.word].length === 1 ? '第' + cn(f.word + 1) + '个词 · 一个字' : '第' + cn(f.word + 1) + '个词的第' + cn(f.char + 1) + '个字';
    status(f.mode === 'order' ? (d ? strokeAt(k, d.strokes.length) : '') : f.mode !== 'write' ? '' : f.say ? '正在念 · 第 ' + f.say.n + ' 遍' : f.said === 1 ? '再听一遍' : f.said > 1 ? '听完了就写' : '');
  };
  var reelCheck = function (f, rebuild) {
    var R = RL.r;
    if (rebuild) {
      show('check');
      var box = $('#c-cards'), size = window.innerWidth < 700 ? 110 : 130;
      var most = Math.max.apply(null, R.chars.map(function (cs) { return cs.length; }));
      box.style.setProperty('--card', Math.min(window.innerWidth - 48, most * (size + 10) + 40) + 'px');
      RL.cards = R.chars.map(function (cs, wi) {
        var row = h('div', { 'class': 'pads' }); row.style.setProperty('--pad', size + 'px');
        var pads = cs.map(function (ch) { var p = makePad({}); var d = reelGlyph(ch); if (d) fillStd(p, d, ''); row.append(p.el); return p; });
        var rewrote = R.rewrites.some(function (x) { return x.word === wi && x.to <= RL.t; });
        var tail = RL.s.asked.indexOf(wi) >= 0 && !rewrote ? h('div', { 'class': 'ask' }, '这个再写一遍?', h('button', {}, ico('write'), lbl('好'))) : h('button', { 'class': 'self' }, ico('write'), lbl(rewrote ? '再写一次' : '我想再写'));
        return { pads: pads, el: h('div', { 'class': 'wc' }, row, tail) };
      });
      box.replaceChildren.apply(box, RL.cards.map(function (c) { return c.el; }));
    }
    RL.cards.forEach(function (c, wi) { c.pads.forEach(function (p, ci) { reelInk(p, f.latest[wi][ci] || []); }); });
  };
  var reelOrder = function (f, rebuild) {
    var o = f.open, d = reelGlyph(RL.r.chars[o.word][o.char]);
    if (rebuild) {
      show('order');
      var box = $('#r-pad');
      box.style.setProperty('--pad', Math.max(240, Math.min(560, window.innerHeight - 140, Math.floor(window.innerWidth * (window.innerWidth > window.innerHeight ? 0.5 : 0.9)))) + 'px');
      RL.opad = makePad({}); RL.opad.svg.insertBefore(RL.opad.ink, RL.opad.std);
      box.replaceChildren(RL.opad.el);
      if (d) fillStd(RL.opad, d, '');
      RL.std = '';
    }
    reelInk(RL.opad, f.latest[o.word][o.char] || []);
    if (!d) return;
    var k = orderStep(d, RL.t - f.orderAt), n = d.strokes.length;
    if (RL.std === 'r' + k) return;
    RL.std = 'r' + k;
    paintOrder(RL.opad, d, k);
    $('#r-count').innerHTML = k < n ? '<b>第 ' + (k + 1) + ' 笔</b> · 一共 ' + n + ' 笔' : '写完了 · 一共 ' + n + ' 笔';
    setLbl($('#r-play'), k >= n ? '再写一遍' : '接着写', k >= n ? 'replay' : 'start');
  };
  var reelRewrite = function (f, rebuild) {
    var cs = RL.r.chars[f.open.word];
    if (rebuild) {
      show('rewrite');
      $('#w-title').textContent = '再写一遍:' + cs.join('');
      var mbox = $('#w-models'); mbox.style.setProperty('--pad', (window.innerWidth < 700 ? 90 : 140) + 'px');
      mbox.replaceChildren.apply(mbox, cs.map(function (ch) { var p = makePad({}); var d = reelGlyph(ch); if (d) fillStd(p, d, 'model'); return p.el; }));
      var box = $('#w-pads');
      RL.rpads = cs.map(function () { return makePad({}); });
      box.replaceChildren.apply(box, RL.rpads.map(function (p) { return p.el; }));
      S.padl = f.pad; rowFit(box, cs.length);
    }
    RL.rpads.forEach(function (p, ci) { reelInk(p, (f.rewrite && f.rewrite[ci]) || []); });
  };
  /** 这一刻的屏幕:哪一屏、哪个词哪一格、什么样子变了就整屏重画,笔每次对一下 */
  var reelDraw = function (f) {
    var done = RL.r.rewrites.filter(function (x) { return x.to <= RL.t; }).length;
    var key = [f.view, f.word, f.char, f.view === 'listen' ? '' : f.mode, f.open ? f.open.word + ':' + f.open.char : '', f.view === 'check' ? done : 0, f.pad, RL.gl, window.innerWidth, window.innerHeight].join('|');
    var rebuild = key !== RL.key; RL.key = key;
    if (f.view === 'check') reelCheck(f, rebuild);
    else if (f.view === 'order' && f.open) reelOrder(f, rebuild);
    else if (f.view === 'rewrite' && f.open) reelRewrite(f, rebuild);
    else reelListen(f, rebuild);
  };
${REEL_MODE_JS}
  api('GET', '/api/kid/home').then(function (j) { TUTORS = j.tutors || []; showFace(); }, function () {});
  if (REEL_ID) reelBoot(); else if (HOME) start(false); else openSnap();
})();
</script>
</body></html>`;
