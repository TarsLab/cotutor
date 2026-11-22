/**
 * /dictation:孩子的听写页。三种进来的路:老师卡上常驻的「听写」(?tutor=<老师>,有课本先翻到书后的词语表选一课,没有就拍照)、
 * 首页的听写卡(?home=<首页 id>&n=<第几张>)、在选一课那页点「拍一张」(学校发的单子)。
 * 设计稿 https://claude.ai/artifact/QGvNikUGrMrF9ccav4Gnp1(iPad 横屏四块 + 手机):以书页为主——
 *   选一课:课本书后的词语表 / 写字表照书上的排法铺满屏宽,一课一行,点一行就是这一课,行里点一个词划掉(这次不写);窗停在上次翻到的那一课;
 *   听写:一页听写本,格子照课本「我会写」的青色田字格画,一个词的格子拼成一条;正在写的那格旁边弹一张写字卡(同课本的写字格),「写好了」字缩进那一格;
 *   对一对:还是那一页,书上的字淡淡叠在每一格上,课本那一行别在页顶;点一个字,卡上一笔一笔写;
 *   再写一遍:在页底照课本「我会写」排一行——范字、描红、空格,描红那条和空格那条各交一遍(描红的记 trace)。
 * 田字格是 SVG,坐标同 hanzi-writer:1024 见方、y 向上,组上 scale(1,-1) translate(0,-900) 摆正;孩子的笔、书上的字、逐笔写都在这一个坐标里。
 * 页面上永远没有对错:没有叉、没有分数;比对的结果只变成一句「再写一遍?」,其余给家长(/parent/dictation)。
 * 字幕不出字:念的那句就是答案,只说第几个词、念到第几遍。
 * 内联脚本里不写反斜杠、不写反引号、不写美元加花括号(这是模板字符串,见 AGENTS.md「坑」)。
 */
import { LAYER_X, TUTOR_FACE_CSS, TUTOR_FACE_JS } from '../kid/tutor-face.ts';
import { KID_NAV_JS } from '../kid/kid-nav.ts';
import { KID_LOG_JS } from '../kid/kid-log.ts';
import { UNLOCK_JS } from './unlock.ts';
import { REEL_MODE_JS } from './reel-mode.ts';
import { SNAP_CSS, snapHtml } from '../kid/photo-ui.ts';
import { faviconLinks } from '../shared/favicon.ts';
import { BTN_CSS, BTN_JS, btn } from './ui.ts';

export const DICTATION_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
${faviconLinks()}
<title>听写</title>
<style>
  :root { --ink:#2b2b2b; --dim:#66625b; --line:#e2dfd6; --paper:#fffdf8; --card:#ffffff; --sand:#d8c7a0; --sand2:#e2d4b4;
    --accent:#e8743b; --blue:#4f86d1; --pencil:#34405a;
    /* 课本「我会写」的田字格:青色细线、虚中线 */
    --grid:#7cc4e4; --grid2:#bfe0ef;
    /* 书后的表:词语表淡绿、写字表淡黄(同书上) */
    --bk-bg:#f2f8ec; --bk-line:#9fd39a; --bk-ink:#3f7a45;
    /* 学科色:这次听写那位老师的颜色,页面读到老师后换(缺省语文);按钮、正在写的那条都跟它。橙色只留给「正在写的那一笔」 */
    --sc:#c43c74; --clay:var(--sc); --tutor:color-mix(in srgb, var(--sc) 10%, #fff); --tutor-line:color-mix(in srgb, var(--sc) 32%, #fff); --tutor-ink:color-mix(in srgb, var(--sc) 62%, #000); --tutor-ink2:color-mix(in srgb, var(--sc) 78%, #000);
    --cell:80px; --kai:'Kaiti SC', STKaiti, KaiTi, serif; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { margin:0; height:100%; background:var(--paper); color:var(--ink); font:17px/1.5 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; overscroll-behavior:none; -webkit-user-select:none; user-select:none; }
  button { font:inherit; color:inherit; cursor:pointer; }
  .view { display:none; min-height:100%; flex-direction:column; padding:calc(env(safe-area-inset-top) + 10px) max(24px, env(safe-area-inset-right)) 24px max(24px, env(safe-area-inset-left)); gap:18px; }
  .view.on { display:flex; }
  .bar { display:flex; align-items:center; justify-content:space-between; gap:12px; }
${BTN_CSS}
  .hint { color:var(--dim); font-size:17px; }
  .ttl { font-size:22px; font-weight:700; }
  .row { display:flex; gap:12px; flex-wrap:wrap; }
  [hidden] { display:none !important; }
  /* 开始(首页听写卡进来的) */
  .grow { flex:1; display:flex; flex-direction:column; justify-content:center; gap:28px; }
  #v-start .grow { align-items:center; text-align:center; }
  #v-start .hd { font-size:30px; font-weight:700; }
  #v-start .sub { color:var(--dim); font-size:18px; }
  #v-start .acts { display:flex; flex-direction:column; gap:14px; align-items:center; }
  .av { width:64px; height:64px; border-radius:32px; background:var(--tutor); border:2px solid var(--tutor-line); display:grid; place-items:center; font-size:26px; color:var(--tutor-ink); flex:none; }

  /* ---- 书页那两屏共用:顶栏(左边让出胶囊)、滚的那一块、底下的字幕 ---- */
  .bv { height:100vh; height:100dvh; padding:0; gap:0; }
  .tb { flex:none; position:relative; display:flex; align-items:center; justify-content:flex-end; gap:10px; min-height:64px; padding:calc(env(safe-area-inset-top) + 8px) max(16px, env(safe-area-inset-right)) 8px 128px; background:var(--paper); border-bottom:1px solid #ece3cf; }
  .tb .tt { position:absolute; left:50%; bottom:18px; transform:translateX(-50%); font-family:var(--kai); font-size:21px; color:#3a352c; white-space:nowrap; max-width:46%; overflow:hidden; text-overflow:ellipsis; }
  .scr { flex:1; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; position:relative; }
  .sub-bar { position:fixed; z-index:5; left:50%; bottom:calc(env(safe-area-inset-bottom) + 22px); transform:translateX(-50%); display:flex; align-items:center; gap:14px; max-width:calc(100vw - 32px); padding:8px 8px 8px 24px; border-radius:34px; background:rgba(43,43,43,.86); color:#fff; white-space:nowrap; }
  .sub-bar .st { font-size:19px; overflow:hidden; text-overflow:ellipsis; }
  .sub-bar .tool { min-height:48px; border:0; color:var(--ink); }
  .sub-bar .tool svg { color:var(--sc); }
  .sub-bar.say-only { padding:12px 24px; }
  .tb .say { position:absolute; left:50%; bottom:8px; transform:translateX(-50%); display:flex; align-items:center; gap:12px; white-space:nowrap; }
  .tb .say .st { font-size:18px; color:#3a352c; }
  .tb .say .tool svg { color:var(--sc); }
  /* 卡开着时「对好了」让开(卡可能落在右下角) */
  #v-page.carded #c-done { visibility:hidden; }
  /* 外面这层不接点(卡落在右下角时点得到卡上的「写好了」) */
  .done-w { position:fixed; z-index:5; right:max(28px, env(safe-area-inset-right)); bottom:calc(env(safe-area-inset-bottom) + 20px); pointer-events:none; }
  .done-w .main { pointer-events:auto; }
  .seg2 { display:flex; padding:3px; border-radius:24px; background:#f1ece0; }
  .seg2 button { min-height:42px; padding:0 18px; border:0; border-radius:21px; background:transparent; font-size:16px; color:#3a352c; }
  .seg2 button[aria-pressed="true"] { background:#fff; box-shadow:0 1px 3px rgba(70,55,30,.18); }

  /* ---- 选一课:书后的表,照书上的排法(栏名带框、行首编号、词空一格) ---- */
  #v-book.zi { --bk-bg:#fbf7ee; --bk-line:#e3c98f; --bk-ink:#9a6a16; }
  .bk-pg { position:relative; max-width:1000px; margin:22px auto 160px; padding:34px 56px 40px; background:var(--bk-bg); border:3px solid var(--bk-line); border-radius:4px; }
  .bk-pg h2 { margin:0 0 18px; text-align:center; font:400 38px/1.3 var(--kai); letter-spacing:18px; text-indent:18px; color:var(--bk-ink); }
  .bk-sec { display:inline-block; margin:14px 0 8px -12px; padding:2px 12px; border:1.5px solid #b9a3d6; border-radius:4px; background:#fff; color:#6d4fa0; font:22px/1.4 var(--kai); box-shadow:-3px 3px 0 #e6dcf2; }
  .bk-row { display:grid; grid-template-columns:52px minmax(0, 1fr); align-items:baseline; width:100%; padding:6px 16px; margin:2px 0; border:0; border-radius:10px; background:transparent; text-align:left; font:inherit; color:inherit; }
  .bk-row .no { font:26px/1.4 'Songti SC', STSong, serif; }
  .bk-row .ws { display:flex; flex-wrap:wrap; gap:4px 32px; font:31px/1.45 var(--kai); }
  #v-book.zi .bk-row .ws { gap:4px 16px; letter-spacing:4px; }
  .bk-row.gd { grid-template-columns:auto minmax(0, 1fr); gap:18px; }
  .bk-row.gd .no { font:22px/1.4 var(--kai); color:#7a7468; }
  /* 平时什么都不画:按住 80ms 还没滚、鼠标移上去才铺一层学科色(同课本目录,no-attention-hints) */
  .bk-row.press, .bk-row:not(.on):hover { background:color-mix(in srgb, var(--sc) 6%, transparent); }
  @media (hover:none) { .bk-row:not(.on):hover { background:transparent; } .bk-row.press { background:color-mix(in srgb, var(--sc) 7%, transparent); } }
  .bk-row.on { background:color-mix(in srgb, var(--sc) 8.5%, transparent); box-shadow:inset 0 0 0 1.5px color-mix(in srgb, var(--sc) 38%, transparent); }
  .bk-row.on .no { color:var(--tutor-ink); font-weight:700; }
  .bk-row .w { padding:0 6px; margin:0 -6px; min-height:44px; border:0; border-radius:8px; background:transparent; font:inherit; letter-spacing:inherit; }
  .bk-row .w.off { color:#b3ab9c; text-decoration:line-through; text-decoration-color:rgba(120,110,95,.7); text-decoration-thickness:2px; }
  .bk-go { position:fixed; z-index:5; left:50%; bottom:calc(env(safe-area-inset-bottom) + 20px); transform:translateX(-50%); display:flex; align-items:center; gap:22px; max-width:calc(100vw - 24px); padding:10px 10px 10px 28px; border-radius:40px; background:#fff; box-shadow:0 10px 30px rgba(70,55,30,.18), 0 0 0 1px #eee6d4; white-space:nowrap; }
  .bk-go .t { display:flex; flex-direction:column; line-height:1.25; min-width:0; }
  .bk-go b { font:700 22px/1.3 var(--kai); overflow:hidden; text-overflow:ellipsis; }
  .bk-go small { font-size:15px; color:var(--dim); }
  .bk-go .main { min-height:56px; padding:0 30px; font-size:19px; }

  /* ---- 听写本:一页纸,词挨着排、排满换行 ---- */
  .nb { position:relative; max-width:1060px; margin:0 auto; padding:18px 40px 180px 40px; }
  .nb-hd { display:flex; justify-content:space-between; align-items:baseline; padding-bottom:8px; margin-bottom:22px; border-bottom:1px solid #ece3cf; font-family:var(--kai); color:#8a8170; }
  .nb-hd b { font-weight:400; font-size:20px; color:#3a352c; }
  .nb-hd span { font-size:17px; letter-spacing:1px; }
  .nb-ws { display:flex; flex-wrap:wrap; gap:22px 34px; align-items:flex-start; }
  .wd { display:flex; flex-direction:column; align-items:flex-start; gap:4px; }
  .wd .n { font-size:13px; line-height:16px; color:#8a8170; }
  .wd.cur .n { color:var(--tutor-ink); font-weight:700; }
  .wd.ahead { opacity:.45; }
  .strip { display:flex; border:1.5px solid var(--grid); background:#fff; }
  .wd.cur .strip, .strip.cur { border-color:var(--sc); box-shadow:0 0 0 1.5px var(--sc); }
  .strip .padbox { width:var(--cell); height:var(--cell); }
  .strip .padbox + .padbox { border-left:1.5px solid var(--grid); }
  .strip .grid rect { stroke:none; }
  .strip .padbox.here .grid rect { fill:var(--tutor); }
  .strip.tap .padbox { cursor:pointer; }
  .wd .ask { margin-top:6px; }
  .ask { display:inline-flex; align-items:center; gap:6px; min-height:44px; padding:0 14px; border:1px solid var(--tutor-line); border-radius:22px; background:var(--tutor); color:var(--tutor-ink); font-size:16px; font-weight:600; white-space:nowrap; }
  .ask svg { width:17px; height:17px; flex:none; }
  /* 课本那一行:从表上剪下来的一条,别在页顶 */
  .nb-book { position:relative; display:grid; grid-template-columns:auto minmax(0, 1fr) auto; align-items:center; gap:0 14px; margin:6px 0 26px; padding:12px 22px 12px 18px; border-top:2px solid var(--bk-line); border-bottom:2px solid var(--bk-line); background:var(--bk-bg); box-shadow:0 3px 8px rgba(70,90,50,.08); }
  .nb-book.zi { --bk-bg:#fbf7ee; --bk-line:#e3c98f; --bk-ink:#9a6a16; }
  .nb-book .no { font:24px/1.3 'Songti SC', STSong, serif; }
  .nb-book .ws { display:flex; flex-wrap:wrap; gap:4px 26px; font:26px/1.4 var(--kai); }
  .nb-book small { font-size:14px; color:var(--bk-ink); white-space:nowrap; }
  .nb-book .clip { position:absolute; left:26px; top:-16px; width:15px; height:34px; }
  /* 再写一遍:照课本「我会写」排 —— 范字、描红、空格 */
  .nb-redo { margin-top:40px; }
  .nb-redo .rh { display:flex; align-items:center; gap:14px; margin-bottom:18px; font:22px/1.4 var(--kai); color:#3a352c; }
  .nb-redo .rh i { flex:1; height:1px; background:#ece3cf; }
  .rr { display:flex; flex-wrap:wrap; gap:16px 28px; margin-bottom:30px; }
  /* 对一对:书上的字淡蓝叠在上面;拿开蓝字只看自己的 */
  .std path { fill:var(--blue); fill-opacity:.34; }
  #v-page.bare .nb-ws .std { display:none; }
  .std.model path { fill:#3a3a3a; fill-opacity:1; }
  .std.trace path { fill:#e25460; fill-opacity:.3; }
  .std path.sd { fill:var(--blue); fill-opacity:.55; }
  .std path.sc { fill:var(--accent); fill-opacity:1; }
  .std path.sf { fill:#d9d5cc; fill-opacity:.6; }
  .card .std.trace path { fill:#d9d5cc; fill-opacity:1; }

  /* ---- 田字格(SVG,1024 见方) ---- */
  .padbox { position:relative; width:var(--pad, 300px); height:var(--pad, 300px); flex:none; }
  .padbox svg { display:block; width:100%; height:100%; touch-action:none; }
  .grid rect { fill:#fff; stroke:var(--grid); stroke-width:14; }
  .grid line { stroke:var(--grid2); stroke-width:8; stroke-dasharray:30 22; }
  .ink path { fill:none; stroke:var(--pencil); stroke-width:34; stroke-linecap:round; stroke-linejoin:round; }
  .card .ink path { stroke:var(--ink); }
  .card.order .ink path { stroke:#cfd6e2; }
  .top path { fill:none; stroke-width:200; stroke-linecap:round; stroke-linejoin:round; }
  .top path.o { stroke:var(--accent); }
  .top path.k { stroke:#3a3a3a; }

  /* ---- 写字卡:贴着那一格(下面放不下放上面),跟着页滚;手机上是底下一张抽屉 ---- */
  .card { position:absolute; z-index:4; display:flex; gap:18px; padding:18px; background:#fff; border-radius:22px; box-shadow:0 14px 40px rgba(70,55,30,.22), 0 0 0 1px #eee6d4; }
  .card .caret { position:absolute; left:var(--cx, 60px); width:22px; height:22px; margin-left:-11px; background:#fff; transform:rotate(45deg); }
  .card.below .caret { top:-11px; box-shadow:-1px -1px 0 #eee6d4; }
  .card .pd { position:relative; flex:none; }
  .card .pd .padbox { width:var(--pad); height:var(--pad); }
  .card .pd .grid line.x { stroke:#e3f1f8; }
  .card .mdl { position:absolute; left:8px; top:2px; font:34px/1 var(--kai); color:rgba(43,43,43,.45); pointer-events:none; }
  .card .sd2 { flex:1; min-width:150px; display:flex; flex-direction:column; justify-content:space-between; gap:10px; }
  .card .sd2 .tools { display:flex; flex-direction:column; gap:10px; }
  .card .sd2 .tool { min-height:50px; font-size:16px; padding:0 14px; }
  .card .sd2 .main { min-height:58px; padding:0 18px; font-size:19px; }
  .card .cnt { font-size:18px; line-height:1.4; color:#3a352c; }
  .card .cnt b { color:#b9531c; }
  .card .layer-x { align-self:flex-end; }
  @media (max-width: 640px) {
    :root { --cell:44px; }
    .nb { padding:14px 16px 520px; }
    .nb-ws { gap:12px 16px; }
    .nb-book .ws { font-size:20px; gap:2px 14px; }
    .card { position:fixed; left:0 !important; right:0; top:auto !important; bottom:0; flex-direction:column; align-items:center; gap:12px; padding:14px 16px calc(env(safe-area-inset-bottom) + 18px); border-radius:24px 24px 0 0; box-shadow:0 -10px 30px rgba(70,55,30,.16); }
    .card .caret { display:none; }
    .card .sd2 { width:100%; }
    .card .sd2 .tools { flex-direction:row; flex-wrap:wrap; }
    .card .sd2 .tools .tool { flex:1; white-space:nowrap; }
    .card .sd2 .tools .reveal { flex-basis:100%; }
    .card .sd2 .main { width:100%; }
    .tb .say { position:static; transform:none; flex:1; min-width:0; justify-content:flex-end; }
    .tb .say .st { font-size:15px; overflow:hidden; text-overflow:ellipsis; }
    .bk-pg { margin:12px 8px 150px; padding:22px 12px 26px; }
    .bk-pg h2 { font-size:28px; }
    .bk-row { grid-template-columns:34px minmax(0, 1fr); padding:6px 8px; }
    .bk-row .ws { font-size:23px; gap:2px 18px; }
    .tb .tt { display:none; }
    .tb { padding-left:136px; gap:8px; }
    .seg2 button { padding:0 10px; font-size:14px; white-space:nowrap; }
    #b-snap span, #b-resume span { display:none; }
    #b-snap, #b-resume { padding:0 12px; }
    .bk-go { gap:12px; padding-left:18px; }
    .bk-go b { font-size:18px; }
  }

  /* 拍照开始:拍(拍照屏同英语页,photo-ui.ts)→ 照片上一项一项冒出框,点着选 → 右边是这次写的词 */
${SNAP_CSS}
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
  #snap-book { position:fixed; z-index:6; top:calc(env(safe-area-inset-top) + 10px); right:max(16px, env(safe-area-inset-right)); }
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

<div class="view bv" id="v-book">
  <div class="tb">
    <span class="tt" id="b-title">词语表</span>
    ${btn('tool sm', 'start', '接着写', 'id="b-resume" hidden aria-label="接着写"')}
    <div class="seg2" role="group" aria-label="哪一张表"><button type="button" data-tab="zi" aria-pressed="false">写字表</button><button type="button" data-tab="ci" aria-pressed="true">词语表</button></div>
    ${btn('tool sm', 'camera', '拍一张', 'id="b-snap" aria-label="拍一张"')}
  </div>
  <div class="scr" id="b-scr"><div class="bk-pg" id="b-pg"></div></div>
  <div class="sub-bar say-only" id="b-say"><span class="st">今天听写哪一课?点那一行。</span></div>
  <div class="bk-go" id="b-go" hidden><span class="t"><b id="b-go-t"></b><small id="b-go-s"></small></span>${btn('main', 'start', '开始听写', 'id="b-start"')}</div>
</div>

<div class="view" id="v-snap">
  ${snapHtml({ kind: 'zh', id: 'snap-hero', cam: 'snap-cam', lib: 'snap-lib' })}
  ${btn('tool sm', 'look', '翻课本', 'id="snap-book" hidden')}
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

<!-- 听写本:听写、对一对、再写一遍都在这一页 -->
<div class="view bv" id="v-page">
  <div class="tb">
    <span class="tt" id="n-title">听写本</span>
    <!-- 念到哪:在顶栏正中(不压在写字卡上);只说第几个词、第几遍,不出字 -->
    <div class="say" id="n-say" hidden><span class="st" id="l-status"></span>${btn('tool sm', 'again', '再念', 'id="l-again"')}</div>
    ${btn('tool sm', 'overlay', '拿开蓝字', 'id="c-toggle" hidden')}
  </div>
  <div class="scr" id="n-scr"><div class="nb" id="n-nb"></div></div>
  <div class="done-w">${btn('main', 'done', '对好了', 'id="c-done" hidden')}</div>
</div>

<!-- 写字卡(一张,挪着用):写一个字、看笔顺、再写一遍 -->
<template id="t-card">
  <div class="card below">
    <span class="caret"></span>
    <div class="pd"></div>
    <div class="sd2">
      <button class="layer-x" type="button" data-x="1" aria-label="收起" hidden>${LAYER_X}</button>
      <div class="cnt" data-cnt="1"></div>
      <div class="tools" data-w="1">
        ${btn('tool', 'undo', '撤销', 'data-undo="1"')}
        ${btn('tool', 'clear', '擦掉', 'data-clear="1"')}
        ${btn('tool reveal', 'reveal', '不会写,给答案', 'data-reveal="1"')}
        ${btn('tool', 'order', '再看笔顺', 'data-reorder="1" hidden')}
      </div>
      <div class="tools" data-o="1" hidden>
        ${btn('tool', 'replay', '再看一遍', 'data-replay="1"')}
      </div>
      ${btn('main', 'done', '写好了', 'data-next="1"')}
      ${btn('main', 'write', '我再写一遍', 'data-rewrite="1" hidden')}
    </div>
  </div>
</template>

<script>
// 孩子端的流水(kid-log.ts):最先装上出错的监听
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
  /** 家长看录像时,这一页开在录像外壳的 iframe 里:只照记录画,不发事件、不念、点不动 */
  var REEL_ID = q.get('reel');
  // 录像里只记出错,不报打开
  kidLog.start({ page: 'dictation', mode: REEL_ID ? 'reel' : 'kid', ctx: function () { return { tutor: TUTOR || null }; } });
  var S = { v: null, base: Date.now(), i: 0, w: null, pads: [], stack: [], active: null, sawPen: false, sayTimer: 0, order: null, rw: null, mode: 'listen', redo: [], card: null };
  /** 点与事件的时刻:离这次听写开始(startedAt)多少毫秒;孩子端的钟,录像只看先后与间隔 */
  var now = function () { return Math.max(0, Date.now() - S.base); };
  var setView = function (v) { var fresh = !S.v || S.v.id !== v.id; S.v = v; S.base = Date.parse(v.startedAt) || S.base; showFace(); if (fresh) { S.vw = 0; S.redo = []; sendView(); } };

  var show = function (name) { var vs = document.querySelectorAll('.view'); for (var i = 0; i < vs.length; i++) vs[i].classList.toggle('on', vs[i].id === 'v-' + name); window.scrollTo(0, 0); if (!REEL_ID) guard(); };
  // 孩子端不往浏览器历史里加东西(kid-nav.ts):回首页是替换当前页
  ${KID_NAV_JS}
  var goHome = function () { stopSay(); kidGo('/'); };
  // ---- 左上角「‹ logo」胶囊,同老师页;拍照屏的大头像是听写这次的老师,没开始时是从哪位老师卡上进来的 ----
  ${TUTOR_FACE_JS}
  // 胶囊带上念的老师:服务端出页面时就按 ?tutor= 或首页那张卡的 reader 插进来(BACK_TUTOR),打开就是他的颜色和首字,不先浅底再变色;一位能念的老师都没有才是 null
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
    var b = { kind: kind, word: word, t: now() }; if (ch !== undefined) b.char = ch; if (n !== undefined) b.n = n; if (more) { b.w = more.w; b.h = more.h; }
    try { fetch('/api/dictation/' + S.v.id + '/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b), keepalive: true }).catch(function () {}); } catch (e) {}
  };
  /** 录像要的:屏幕多大(进来、转屏停手 300 毫秒,变了才记)、切到别处 / 回来 */
  var viewTimer = 0;
  var sendView = function () { if (!S.v || S.v.done) return; var w = window.innerWidth, hh = window.innerHeight; if (w === S.vw && hh === S.vh) return; S.vw = w; S.vh = hh; event('view', S.i || 0, undefined, undefined, { w: w, h: hh }); };
  window.addEventListener('resize', function () { clearTimeout(viewTimer); viewTimer = setTimeout(function () { sendView(); placeCard(); }, 300); });
  document.addEventListener('visibilitychange', function () { if (S.v && !S.v.done) event(document.hidden ? 'away' : 'back', S.i || 0); });

  // ---------- 字形(书上的字):/api/kid/tianzige/<字>,strokes 轮廓 + medians 中线 ----------
  var GL = {};
  var glyph = function (ch) { if (!GL[ch]) GL[ch] = fetch('/api/kid/tianzige/' + encodeURIComponent(ch)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); return GL[ch]; };
  var polyLen = function (pts) { var n = 0; for (var i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return n; };

  // ---------- 田字格 ----------
  var pathD = function (pts) { var d = 'M' + pts[0][0] + ' ' + pts[0][1]; if (pts.length === 1) d += ' L' + (pts[0][0] + 1) + ' ' + pts[0][1]; for (var i = 1; i < pts.length; i++) d += ' L' + pts[i][0] + ' ' + pts[i][1]; return d; };
  /** 一格:big = 卡上那一大格(多画两条斜的米字线,同课本的写字格) */
  var makePad = function (opts) {
    var svg = sv('svg', { viewBox: '0 0 1024 1024' });
    var grid = sv('g', { 'class': 'grid' });
    grid.append(sv('rect', { x: 8, y: 8, width: 1008, height: 1008 }));
    if (opts.big) grid.append(sv('line', { x1: 8, y1: 8, x2: 1016, y2: 1016, 'class': 'x' }), sv('line', { x1: 1016, y1: 8, x2: 8, y2: 1016, 'class': 'x' }));
    grid.append(sv('line', { x1: 512, y1: 8, x2: 512, y2: 1016 }), sv('line', { x1: 8, y1: 512, x2: 1016, y2: 512 }));
    var std = sv('g', { 'class': 'std', transform: HZ_T });
    var ink = sv('g', { 'class': 'ink', transform: HZ_T });
    var top = sv('g', { 'class': 'top', transform: HZ_T });
    svg.append(grid, std, ink, top);
    var pad = { el: h('div', { 'class': 'padbox' }, svg), svg: svg, std: std, ink: ink, top: top, strokes: [], undos: 0, gone: [] };
    setInk(pad, opts.ink || []);
    if (opts.write) bindPen(pad);
    if (opts.onTap) pad.el.addEventListener('click', opts.onTap);
    return pad;
  };
  var setInk = function (pad, strokes) { pad.ink.replaceChildren.apply(pad.ink, (strokes || []).filter(function (s) { return s.length; }).map(function (s) { return sv('path', { d: pathD(s) }); })); };
  var fillStd = function (pad, d, cls) { pad.std.replaceChildren(); pad.std.setAttribute('class', 'std' + (cls ? ' ' + cls : '')); if (!d) return; d.strokes.forEach(function (st) { pad.std.append(sv('path', { d: st })); }); };
  /** 记一笔:点 = [x, y, t],x / y 是字的坐标(1024 见方、y 向上),t 是离开始多少毫秒 */
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
      pad.ink.append(cur.path); pad.strokes.push(pts); S.stack.push(pad);
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
  /** 擦掉的笔留着,记上擦的时刻(录像里在那一刻消失) */
  var drop = function (pad, pts) { if (pad.gone.length < 200) pad.gone.push({ t: now(), pts: pts }); };
  var undo = function () { var pad = S.stack.pop(); if (!pad || !pad.strokes.length) return; drop(pad, pad.strokes.pop()); if (pad.ink.lastChild) pad.ink.lastChild.remove(); pad.undos++; if (pad.onUp) pad.onUp(); };
  var clearPad = function () { var pad = S.card && S.card.pad; if (!pad || !pad.strokes.length) return; pad.strokes.forEach(function (st) { drop(pad, st); }); pad.strokes = []; pad.ink.replaceChildren(); pad.undos++; S.stack = []; if (pad.onUp) pad.onUp(); };

  // ---------- 念 ----------
  var audio = new Audio(); audio.preload = 'auto';
  ${UNLOCK_JS}
  var stopSay = function () { clearTimeout(S.sayTimer); S.sayTok = (S.sayTok || 0) + 1; try { audio.pause(); } catch (e) {} };
  /** 念不出来(老师没配音色、合成失败)就直接说,不念浏览器合成声 */
  var NO_VOICE = '老师的声音还没配好 · 叫爸爸妈妈来看一下';
  /** 字幕:第几个词、念到第几遍(念的那句是答案,不出字) */
  var status = function (t) { $('#l-status').textContent = (S.v && S.mode === 'listen' ? '第' + cn(S.i + 1) + '个词' + (t ? ' · ' : '') : '') + t; };
  /** 看笔顺放到第几笔,一行字(不画一排数字方块,字本身的蓝、橙、淡就是进度) */
  var strokeAt = function (k, n) { return k < n ? '第 <b>' + (k + 1) + '</b> 笔<br><small>一共 ' + n + ' 笔</small>' : '写完了<br><small>一共 ' + n + ' 笔</small>'; };
  /** 念第 i 个词,念 times 遍,两遍之间停一下;没有音频(没配音色、合成失败)字幕直接提示 */
  var sayWord = function (i, times) {
    stopSay();
    if (S.v.voice === false) { $('#l-status').textContent = NO_VOICE; return; }
    var tok = S.sayTok; var left = times; var nth = 0;
    var next = function () { if (tok !== S.sayTok) return; if (left <= 0) { status('听完了就写'); return; } left--; nth++; status('正在念第 ' + nth + ' 遍'); event('say', i, undefined, nth); play(); };
    var gap = function () { if (tok !== S.sayTok) return; status(left > 0 ? '再听一遍' : '听完了就写'); if (left > 0) S.sayTimer = setTimeout(next, 1800); };
    var mute = function () { if (tok === S.sayTok) $('#l-status').textContent = NO_VOICE; };
    var play = function () {
      audio.onended = gap;
      audio.onerror = mute;
      audio.src = '/api/dictation/' + S.v.id + '/say/' + i;
      var pr = audio.play(); if (pr && pr.catch) pr.catch(function (e) { if (tok !== S.sayTok) return; if (audio.error) mute(); else if (blocked(e)) status('点「再念」听老师念'); });
    };
    next();
  };

  // ---------- 开始(首页的听写卡进来) ----------
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

  // ---------- 选一课:课本书后的词语表 / 写字表 ----------
  /** B.data = /api/dictation/book 回的;tab = ci 词语表 / zi 写字表;pick = 选中那一行的 key;off = 划掉的词(第几个) */
  var B = { data: null, tab: 'ci', pick: null, off: {}, resume: null };
  var bkTable = function () { return B.data ? B.data[B.tab] : null; };
  var bkRow = function () { var t = bkTable(); return t && B.pick ? t.rows.filter(function (r) { return r.key === B.pick; })[0] || null : null; };
  var bkLabel = function (r) { return r.garden ? r.lesson : r.no + '《' + r.lesson + '》'; };
  var bkKept = function (r) { return r.words.filter(function (w, k) { return !B.off[B.tab + r.key + ':' + k]; }); };
  var renderBook = function () {
    var t = bkTable();
    $('#v-book').classList.toggle('zi', B.tab === 'zi');
    $('#b-title').textContent = t ? t.title : '';
    var segs = document.querySelectorAll('#v-book [data-tab]'); for (var i = 0; i < segs.length; i++) { segs[i].setAttribute('aria-pressed', String(segs[i].getAttribute('data-tab') === B.tab)); segs[i].hidden = !B.data[segs[i].getAttribute('data-tab')]; }
    var pg = $('#b-pg'); var out = [h('h2', { text: t ? t.title : '' })]; var sec = null;
    (t ? t.rows : []).forEach(function (r) {
      if (r.sec && r.sec !== sec) out.push(h('div', {}, h('span', { 'class': 'bk-sec', text: r.sec })));
      if (r.sec) sec = r.sec;
      var on = r.key === B.pick;
      var ws = h('span', { 'class': 'ws' }, r.words.map(function (w, k) {
        if (!on) return h('span', { text: w });
        var key = B.tab + r.key + ':' + k;
        return h('button', { 'class': 'w' + (B.off[key] ? ' off' : ''), type: 'button', 'aria-pressed': String(!B.off[key]), on: { click: function (e) { e.stopPropagation(); if (B.off[key]) delete B.off[key]; else B.off[key] = 1; renderBook(); } } }, w);
      }));
      var el = h(on ? 'div' : 'button', { 'class': 'bk-row' + (on ? ' on' : '') + (r.garden ? ' gd' : ''), 'data-key': r.key }, h('span', { 'class': 'no', text: r.no }), ws);
      if (!on) { el.setAttribute('type', 'button'); el.setAttribute('aria-label', '听写' + bkLabel(r)); bkPress(el, r); }
      out.push(el);
    });
    pg.replaceChildren.apply(pg, out);
    var r = bkRow();
    $('#b-say').hidden = Boolean(r); $('#b-go').hidden = !r;
    if (r) {
      var n = bkKept(r).length;
      $('#b-go-t').textContent = bkLabel(r);
      $('#b-go-s').textContent = n > 20 ? '一次最多 20 个,划掉几个' : n + (B.tab === 'zi' ? ' 个字 · 老师念的时候带上词' : ' 个词');
      $('#b-start').disabled = n === 0 || n > 20;
    }
  };
  /** 点一行:手指按住 80ms 还没滚才铺底色,松手停一下再选(滚的时候不选);鼠标直接点 */
  var bkPress = function (el, r) {
    var t0 = 0, y0 = 0, tm = 0;
    el.addEventListener('pointerdown', function (e) { t0 = Date.now(); y0 = e.clientY; clearTimeout(tm); tm = setTimeout(function () { el.classList.add('press'); }, 80); });
    var off = function () { clearTimeout(tm); el.classList.remove('press'); };
    el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    el.addEventListener('pointermove', function (e) { if (Math.abs(e.clientY - y0) > 8) off(); });
    el.addEventListener('click', function () { off(); B.pick = r.key; renderBook(); });
  };
  var segBtns = document.querySelectorAll('#v-book [data-tab]');
  for (var sb = 0; sb < segBtns.length; sb++) segBtns[sb].addEventListener('click', function (e) { var tab = e.currentTarget.getAttribute('data-tab'); if (tab === B.tab) return; var keep = B.pick; B.tab = tab; B.pick = keep && bkTable().rows.some(function (r) { return r.key === keep; }) ? keep : null; renderBook(); bkScrollTo(B.pick); });
  /** 窗停在那一行(上次翻到的那一课);不画任何提示 */
  var bkScrollTo = function (key) { var scr = $('#b-scr'); var el = key ? scr.querySelector('[data-key="' + key + '"]') : null; scr.scrollTop = el ? Math.max(0, el.offsetTop - scr.clientHeight * 0.3) : 0; };
  var openBook = function () {
    show('book');
    renderBook();
    bkScrollTo(B.pick || B.data.last);
    findBookResume();
  };
  /** 今天这位老师没对好(没点「对好了」)的书上听写:顶栏给「接着写」 */
  var findBookResume = function () {
    var today = ymdOf(new Date());
    api('GET', '/api/dictation').then(function (j) {
      var x = (j.sessions || []).filter(function (s) { return s.book && !s.done && (!TUTOR || s.tutor === TUTOR) && ymdOf(new Date(s.startedAt)) === today; })[0];
      if (!x) return;
      return api('GET', '/api/dictation/' + x.id + '/kid').then(function (v) { B.resume = v; $('#b-resume').hidden = false; });
    }).catch(function () {});
  };
  $('#b-resume').addEventListener('click', function () { var v = B.resume; if (!v) return; setView(v); if (v.checked) openCheck(); else openListen(); });
  $('#b-snap').addEventListener('click', function () { openSnap(); });
  $('#snap-book').addEventListener('click', function () { if (B.data) openBook(); });
  $('#b-start').addEventListener('click', function () {
    var r = bkRow(); if (!r) return;
    var skip = []; r.words.forEach(function (w, k) { if (B.off[B.tab + r.key + ':' + k]) skip.push(k); });
    persist('POST', '/api/dictation', { book: { table: B.tab, key: r.key, skip: skip }, tutor: TUTOR }, $('#b-start')).then(function (v) { setView(v); openListen(); }, function () { renderBook(); });
  });
  /** 进来:老师卡上的「听写」先看有没有课本,有就翻到表上,没有就拍照 */
  var bootTutor = function () {
    api('GET', '/api/dictation/book?tutor=' + encodeURIComponent(TUTOR || '')).then(function (j) {
      if (!j || !j.book || (!j.ci && !j.zi)) { openSnap(); return; }
      B.data = j; B.tab = j.ci ? 'ci' : 'zi';
      $('#snap-book').hidden = false;
      openBook();
    }, function () { openSnap(); });
  };

  // ---------- 拍照开始:拍 → 传 → 一项一项认出来 → 点选 → 开始 ----------
  var P = { id: null, items: [], full: [], extra: [], on: {}, edits: {}, timer: 0, img: null, url: null };
  /** 今天这位老师没写完(没点「对好了」)的拍照听写,拍照屏最上面给「接着写」;会话先读好,点下去在手势里直接念 */
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
  /** 默认选不选:模型说了算(老师家里听写.md 的认词要求里写怎么挑) */
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

  // ---------- 听写本:一页纸,词挨着排;写字卡贴着正在写的那一格 ----------
  /** 一个词的格子拼成一条;inks[ci] 是这一格的笔,std 给了叠书上的字(对一对) */
  var strip = function (chars, inks, opts) {
    var el = h('div', { 'class': 'strip' + (opts.cur ? ' cur' : '') + (opts.tap ? ' tap' : '') });
    var pads = [];
    for (var c = 0; c < chars.length; c++) {
      (function (c) {
        var pad = makePad({ ink: inks[c] || [], onTap: opts.tap ? function () { opts.tap(c, pad); } : null });
        if (opts.here === c) pad.el.classList.add('here');
        if (opts.std && chars[c]) glyph(chars[c]).then(function (d) { fillStd(pad, d, opts.std === true ? '' : opts.std); });
        pads.push(pad); el.append(pad.el);
      })(c);
    }
    return { el: el, pads: pads };
  };
  var ymd = function (iso) { var d = new Date(iso); return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日'; };
  var pageTitle = function () { var b = S.v.book, l = S.v.lesson; return b ? (b.key.indexOf('语文园地') === 0 ? l : b.no + '《' + l + '》') : l ? '《' + l + '》' : '听写本'; };
  /** 整页重画:listen = 一个一个写;check = 叠书上的字、页顶别着课本那一行、页底再写一遍 */
  var renderPage = function () {
    var v = S.v, nb = $('#n-nb'); var out = [];
    $('#n-title').textContent = S.mode === 'check' ? '书上的字叠在上面了,自己对一对' : '听写本';
    $('#n-title').hidden = S.mode === 'listen'; $('#n-say').hidden = S.mode !== 'listen'; $('#c-done').hidden = S.mode !== 'check'; $('#c-toggle').hidden = S.mode !== 'check';
    out.push(h('div', { 'class': 'nb-hd' }, h('b', { text: '听写 · ' + pageTitle() }), h('span', { text: ymd(v.startedAt) })));
    S.cells = [];
    if (S.mode === 'check' && v.answers) {
      var bk = h('div', { 'class': 'nb-book' + (v.book && v.book.table === 'zi' ? ' zi' : '') },
        h('span', { 'class': 'no', text: v.book && v.book.key.indexOf('语文园地') !== 0 ? v.book.no : '' }),
        h('span', { 'class': 'ws' }, v.answers.map(function (w) { return h('span', { text: w.chars }); })),
        h('small', { text: v.book && v.book.printed ? '课本 ' + v.book.printed + ' 页' : v.lesson ? '《' + v.lesson + '》' : '这次的词' }));
      bk.insertAdjacentHTML('beforeend', '<svg class="clip" viewBox="0 0 20 44" aria-hidden="true"><path d="M6 30 V8 A4 4 0 0 1 14 8 V34 A6 6 0 0 1 2 34 V14" fill="none" stroke="#9c968a" stroke-width="2.4" stroke-linecap="round"></path></svg>');
      out.push(bk);
    }
    var ws = h('div', { 'class': 'nb-ws' });
    v.sizes.forEach(function (size, wi) {
      var chars = S.mode === 'check' && v.answers ? Array.from(v.answers[wi].chars) : new Array(size).fill('');
      var cur = S.mode === 'listen' && wi === S.i, ahead = S.mode === 'listen' && wi > S.i;
      var inks;
      if (S.mode === 'check' && v.answers) inks = (v.answers[wi].first && v.answers[wi].first.length ? v.answers[wi].first : v.answers[wi].ink) || [];
      else if (cur) inks = S.w.inks.map(function (x, c) { return c === S.w.c && S.card && S.card.pad ? S.card.pad.strokes : x ? x.strokes : []; });
      else inks = v.mine[wi] ? v.mine[wi].map(function (x) { return x.strokes; }) : [];
      var st = strip(chars, inks, {
        cur: false, here: cur && S.card && S.card.kind === 'write' ? S.w.c : -1, std: S.mode === 'check',
        tap: S.mode === 'check' ? function (c, pad) { event('strokeOrder', wi, c); openOrder(wi, c, pad.el); } : cur ? function (c) { if (S.w.mode !== 'order' && c !== S.w.c) { event('open', S.i, c); openChar(c); } } : null,
      });
      S.cells[wi] = st.pads;
      var wd = h('div', { 'class': 'wd' + (cur ? ' cur' : '') + (ahead ? ' ahead' : '') }, h('span', { 'class': 'n', text: String(wi + 1) }), st.el);
      if (S.mode === 'check' && v.answers && v.answers[wi].ask && S.redo.indexOf(wi) < 0) wd.append(h('button', { type: 'button', 'class': 'ask', on: { click: function () { event('rewrite', wi); openRedo(wi, false); } } }, ico('write'), lbl('再写一遍?')));
      ws.append(wd);
    });
    out.push(ws);
    // 再写一遍:这次点开的、以前写过的,一词一排
    S.rcells = {};
    var redo = S.mode === 'check' && v.answers ? v.answers.map(function (w, wi) { return S.redo.indexOf(wi) >= 0 || w.rewrote || w.traced ? wi : -1; }).filter(function (x) { return x >= 0; }) : [];
    if (redo.length) {
      var sec = h('div', { 'class': 'nb-redo' }, h('div', { 'class': 'rh' }, h('span', { text: '再写一遍' }), h('i')));
      redo.forEach(function (wi) {
        var w = v.answers[wi], chars = Array.from(w.chars);
        var rw = S.rw && S.rw.wi === wi ? S.rw : null;
        var model = strip(chars, [], { std: 'model', tap: function (c, pad) { event('strokeOrder', wi, c); openOrder(wi, c, pad.el); } });
        var trInk = rw && rw.strip === 'trace' ? rw.inks.map(function (x, c) { return c === rw.c && S.card && S.card.pad ? S.card.pad.strokes : x ? x.strokes : []; }) : w.traced || [];
        var frInk = rw && rw.strip === 'free' ? rw.inks.map(function (x, c) { return c === rw.c && S.card && S.card.pad ? S.card.pad.strokes : x ? x.strokes : []; }) : w.rewrote ? w.ink : [];
        var tr = strip(chars, trInk, { std: 'trace', cur: rw && rw.strip === 'trace', here: rw && rw.strip === 'trace' ? rw.c : -1, tap: function (c) { openRedoAt(wi, 'trace', c); } });
        var fr = strip(chars, frInk, { cur: rw && rw.strip === 'free', here: rw && rw.strip === 'free' ? rw.c : -1, tap: function (c) { openRedoAt(wi, 'free', c); } });
        S.rcells[wi] = { trace: tr.pads, free: fr.pads };
        sec.append(h('div', { 'class': 'rr' }, model.el, tr.el, fr.el));
      });
      out.push(sec);
    }
    nb.replaceChildren.apply(nb, out);
    if (S.card) { S.card.anchor = cellOf(S.card); nb.append(S.card.el); placeCard(); }
  };
  /** 卡贴着的那一格(重画以后照位置重新找) */
  var cellOf = function (c) {
    if (c.kind === 'write') return S.cells[S.i] && S.cells[S.i][S.w.c] ? S.cells[S.i][S.w.c].el : null;
    if (c.kind === 'redo') { var r = S.rcells[c.wi]; return r ? r[c.strip][c.c].el : null; }
    if (c.kind === 'order') return S.cells[c.wi] && S.cells[c.wi][c.ci] ? S.cells[c.wi][c.ci].el : null;
    return null;
  };
  /** 卡多大:横着放得下就大一点,竖着、手机上小一点 */
  var cardPad = function () { var W = window.innerWidth, H = window.innerHeight; return W <= 640 ? Math.max(200, Math.min(W - 80, Math.floor(H * 0.32))) : Math.max(240, Math.min(380, H - 290, Math.floor(W * 0.4))); };
  /** 摆卡:那一格下面,放不下放上面;横着照那一格居中、不出页;手机上是底下的抽屉(CSS) */
  var placeCard = function () {
    var c = S.card; if (!c || !c.anchor || !c.el.isConnected) return;
    var nb = $('#n-nb'), el = c.el, a = c.anchor;
    var ar = a.getBoundingClientRect(), nr = nb.getBoundingClientRect();
    el.style.setProperty('--pad', cardPad() + 'px');
    if (window.innerWidth <= 640) { var scr0 = $('#n-scr'); var bottom = ar.bottom - scr0.getBoundingClientRect().top; var room = scr0.clientHeight - el.offsetHeight - 16; if (bottom > room) scr0.scrollTop += bottom - room; return; }
    // 页底留了一截空(.nb 的下边距),卡总放得在那一格下面;放不下的只会是页很短又在最底下,往下滚就是
    var cw = el.offsetWidth;
    var x = ar.left - nr.left + ar.width / 2;
    var left = Math.max(8, Math.min(nb.clientWidth - cw - 8, x - 80));
    var scr = $('#n-scr');
    el.style.left = left + 'px'; el.style.top = (ar.bottom - nr.top + 14) + 'px';
    el.style.setProperty('--cx', (x - left) + 'px');
    // 卡整个露出来:往下滚到它的下沿
    var sr = scr.getBoundingClientRect(), er = el.getBoundingClientRect();
    if (er.bottom > sr.bottom - 16) scr.scrollTop += er.bottom - sr.bottom + 16;
    else if (ar.top < sr.top + 8) scr.scrollTop -= sr.top + 8 - ar.top;
  };
  /** 开一张卡:kind = write(听写写一个字)/ order(看笔顺)/ redo(再写一遍);pad 是卡上那一大格 */
  var openCard = function (kind, more) {
    closeCard(true);
    var el = $('#t-card').content.firstElementChild.cloneNode(true);
    var c = { kind: kind, el: el, pad: null, otok: 0 };
    for (var k in more) c[k] = more[k];
    el.classList.toggle('order', kind === 'order');
    el.querySelector('[data-w]').hidden = kind === 'order';
    el.querySelector('[data-o]').hidden = kind !== 'order';
    el.querySelector('[data-next]').hidden = kind === 'order';
    el.querySelector('[data-rewrite]').hidden = kind !== 'order';
    el.querySelector('[data-reveal]').hidden = kind !== 'write';
    el.querySelector('[data-undo]').addEventListener('click', undo);
    el.querySelector('[data-clear]').addEventListener('click', clearPad);
    el.querySelector('[data-reveal]').addEventListener('click', reveal);
    el.querySelector('[data-reorder]').addEventListener('click', reorder);
    el.querySelector('[data-replay]').addEventListener('click', function () { if (S.card === c) playOrderCard(c, 0); });
    el.querySelector('[data-next]').addEventListener('click', function () { if (S.card !== c) return; if (kind === 'write') nextChar(); else nextRedo(); });
    el.querySelector('[data-rewrite]').addEventListener('click', function () { var w = S.v.answers[c.wi]; event(w.ask ? 'rewrite' : 'self', c.wi); openRedo(c.wi, !w.ask); });
    el.querySelector('[data-x]').hidden = kind !== 'order';
    el.querySelector('[data-x]').addEventListener('click', function () { event('close', c.wi, c.ci); closeCard(); });
    S.card = c;
    $('#v-page').classList.add('carded');
    return c;
  };
  var closeCard = function (keep) { var c = S.card; if (!c) return; c.otok++; if (c.pad) c.pad.top.replaceChildren(); c.el.remove(); S.card = null; $('#v-page').classList.remove('carded'); if (!keep) renderPage(); };
  var cardPadIn = function (c, pad, model) {
    var pd = c.el.querySelector('.pd'); pd.replaceChildren(pad.el);
    if (model) pd.append(h('span', { 'class': 'mdl', text: model }));
    c.pad = pad; S.pads = [pad]; S.stack = pad.strokes.map(function () { return pad; });
  };
  var cardCount = function (c, html) { c.el.querySelector('[data-cnt]').innerHTML = html || ''; };

  // ---------- 听写:一个字一个字写;不会写就给答案:看笔顺,再照着描红写一遍 ----------
  var updateHere = function () { if (!S.w || !S.card) return; var p = S.cells[S.i] && S.cells[S.i][S.w.c]; if (p) setInk(p, S.card.pad.strokes); };
  /** 手上这个字收进这个词的格子里(换字、写好了之前) */
  var stash = function () {
    if (!S.w || !S.card || S.card.kind !== 'write' || !S.card.pad) return;
    var pad = S.card.pad, prev = S.w.inks[S.w.c];
    S.w.inks[S.w.c] = { strokes: pad.strokes, undos: pad.undos, gone: pad.gone, revealed: S.w.mode === 'trace' || Boolean(prev && prev.revealed) };
  };
  var footFor = function () {
    var c = S.card; if (!c || c.kind !== 'write') return;
    var m = S.w.mode;
    c.el.querySelector('[data-w]').hidden = m === 'order';
    c.el.querySelector('[data-o]').hidden = m !== 'order';
    c.el.querySelector('[data-next]').hidden = m === 'order';
    c.el.querySelector('[data-reveal]').hidden = m !== 'write';
    c.el.querySelector('[data-reorder]').hidden = m !== 'trace';
    if (m !== 'order') cardCount(c, m === 'trace' ? '照着灰色的写一遍' : S.v.sizes[S.i] > 1 ? '第' + cn(S.w.c + 1) + '个字' : '');
  };
  var openChar = function (c) {
    stash();
    S.w.c = c;
    var prev = S.w.inks[c];
    S.w.mode = prev && prev.revealed ? 'trace' : 'write';
    var card = openCard('write', {});
    var pad = makePad({ write: true, big: true, ink: prev ? prev.strokes : [] });
    pad.strokes = prev ? prev.strokes.slice() : []; pad.undos = prev ? prev.undos : 0; pad.gone = prev && prev.gone ? prev.gone.slice() : [];
    pad.onUp = updateHere;
    pad.onDown = function () { if (S.card === card && S.w.mode === 'order') toTrace(); };
    cardPadIn(card, pad);
    if (S.w.mode === 'trace') glyph(S.w.chars[c]).then(function (d) { if (S.card === card) fillStd(pad, d, 'trace'); });
    footFor(); renderPage(); guard();
  };
  var openListen = function () {
    var k = S.v.written.indexOf(false);
    if (k < 0) return submitAll();
    S.mode = 'listen'; S.i = k;
    var inks = []; for (var c = 0; c < S.v.sizes[k]; c++) inks.push(null);
    S.w = { i: k, c: 0, inks: inks, done: [], chars: {}, mode: 'write' };
    show('page');
    event('show', k);
    openChar(0);
    sayWord(k, 2);
  };
  $('#l-again').addEventListener('click', function () { event('again', S.i); sayWord(S.i, 1); });
  /** 写好了(这个字):下一个没写的字;这个词都写了就交这个词,念下一个 */
  var nextChar = function () {
    var w = S.w; if (!w || !S.card) return;
    if (w.mode === 'trace' && !S.card.pad.strokes.length) { cardCount(S.card, '照着灰色的写一遍,再点写好了'); return; }
    event('done', S.i, w.c);
    stash(); w.done[w.c] = true;
    var size = S.v.sizes[S.i];
    for (var c = 1; c <= size; c++) { var n = (w.c + c) % size; if (!w.done[n]) return openChar(n); }
    stopSay();
    var k = S.i;
    var chars = w.inks.map(function (x) { return x ? { strokes: x.strokes, undos: x.undos, gone: x.gone && x.gone.length ? x.gone : undefined, revealed: x.revealed || undefined } : { strokes: [], undos: 0 }; });
    persist('PUT', '/api/dictation/' + S.v.id + '/first/' + k, { chars: chars }, S.card.el.querySelector('[data-next]')).then(function () {
      S.v.written[k] = true; S.v.mine[k] = chars;
      closeCard(true);
      openListen();
    }, function () { start(false); });
  };
  /** 不会写,给答案:服务端回这一个字(并记下),写了一半的清掉,书上的字一笔一笔写 */
  var reveal = function () {
    var w = S.w, card = S.card; if (!w || !card || card.kind !== 'write') return;
    stopSay(); status('');
    persist('POST', '/api/dictation/' + S.v.id + '/reveal/' + S.i, { char: w.c, t: now() }, card.el.querySelector('[data-reveal]')).then(function (j) {
      if (S.card !== card) return;
      w.chars[w.c] = j.ch; w.mode = 'order';
      card.pad.strokes.forEach(function (st) { drop(card.pad, st); }); card.pad.strokes = []; card.pad.ink.replaceChildren(); S.stack = []; updateHere();
      footFor();
      glyph(j.ch).then(function (d) { card.d = d; if (w.mode === 'order') { fillStd(card.pad, d, ''); event('order', S.i, w.c); playOrderCard(card, 0, function () { if (S.card === card && w.mode === 'order') setTimeout(function () { if (S.card === card && w.mode === 'order') toTrace(); }, 900); }); } else fillStd(card.pad, d, 'trace'); });
    });
  };
  var reorder = function () {
    var card = S.card, w = S.w; if (!card || card.kind !== 'write') return;
    var go = function (d) { card.d = d; w.mode = 'order'; fillStd(card.pad, d, ''); footFor(); event('order', S.i, w.c); playOrderCard(card, 0, function () { setTimeout(function () { if (S.card === card && w.mode === 'order') toTrace(); }, 900); }); };
    if (card.d) go(card.d); else glyph(w.chars[w.c]).then(function (d) { if (d && S.card === card) go(d); });
  };
  /**
   * 换成照着写:描红打底,必须照着写一遍才能写好了。看笔顺放完、或看的时候一落笔就换(不要「我来写」那一下:
   * 10-18 孩子看着淡字直接写完了,还得点一下再在同一个位置点「写好了」);动画停下,写的这一笔照常留着
   */
  var toTrace = function () {
    var card = S.card, w = S.w; card.otok++; card.pad.top.replaceChildren();
    event('trace', S.i, w.c);
    w.mode = 'trace'; if (card.d) fillStd(card.pad, card.d, 'trace');
    footFor(); status(''); guard();
  };
  var submitAll = function () {
    closeCard(true);
    persist('POST', '/api/dictation/' + S.v.id + '/check', null, null).then(function (v) { setView(v); openCheck(); });
  };

  // ---------- 逐笔看(卡上):书上的字在孩子写的上面一笔一笔写(写过的蓝、这一笔橙、没写的淡);done 放完了 ----------
  /** 在 pad 的最上层把第 i 笔写出来:中线粗线沿着描、外面套这一笔的轮廓做 clipPath(同点字弹的田字格) */
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
  var paintOrder = function (pad, k, anim) { var ps = pad.std.children; for (var i = 0; i < ps.length; i++) ps[i].setAttribute('class', i < k ? 'sd' : i === k && !anim ? 'sc' : 'sf'); };
  var playOrderCard = function (c, from, done) {
    var d = c.d; if (!d) return;
    var tok = ++c.otok, n = d.strokes.length, k = from;
    c.pad.top.replaceChildren();
    var step = function () {
      if (tok !== c.otok || S.card !== c) return;
      if (k >= n) { paintOrder(c.pad, n, false); cardCount(c, strokeAt(n, n)); if (done) done(); return; }
      paintOrder(c.pad, k, true); cardCount(c, strokeAt(k, n));
      animStroke(c.pad, d, k, 'o', function () { if (tok !== c.otok) return; paintOrder(c.pad, k, false); k++; setTimeout(step, 380); });
    };
    step();
  };
  var openOrder = function (wi, ci, anchor) {
    var w = S.v.answers[wi], ch = Array.from(w.chars)[ci];
    var c = openCard('order', { wi: wi, ci: ci });
    var first = (w.first && w.first.length ? w.first : w.ink) || [];
    var pad = makePad({ big: true, ink: first[ci] || [] });
    pad.svg.insertBefore(pad.ink, pad.std); // 书上的字在上:孩子的字垫在下面(浅灰)
    cardPadIn(c, pad);
    c.anchor = anchor; $('#n-nb').append(c.el); placeCard();
    glyph(ch).then(function (d) { if (S.card !== c || !d) return; c.d = d; fillStd(pad, d, ''); playOrderCard(c, 0); });
  };

  // ---------- 对一对 ----------
  var openCheck = function () {
    if (!S.v.answers) { api('GET', '/api/dictation/' + S.v.id + '/kid').then(function (v) { setView(v); if (v.answers) openCheck(); }); return; }
    stopSay(); closeCard(true);
    S.mode = 'check'; S.rw = null;
    show('page');
    renderPage();
    $('#n-scr').scrollTop = 0;
  };
  $('#c-toggle').addEventListener('click', function () {
    var bare = $('#v-page').classList.toggle('bare');
    setLbl($('#c-toggle'), bare ? '叠上蓝字' : '拿开蓝字', 'overlay');
  });
  $('#c-done').addEventListener('click', function () {
    persist('POST', '/api/dictation/' + S.v.id + '/done', null, $('#c-done')).then(goHome, goHome);
  });

  // ---------- 再写一遍:页底一排,范字、描红、空格;描红那条、空格那条各写完交一遍 ----------
  var openRedo = function (wi, self) {
    if (S.redo.indexOf(wi) < 0) S.redo.push(wi);
    var w = S.v.answers[wi];
    openRedoAt(wi, w.traced ? 'free' : 'trace', 0, self);
  };
  var openRedoAt = function (wi, which, ci, self) {
    var chars = Array.from(S.v.answers[wi].chars);
    if (!S.rw || S.rw.wi !== wi || S.rw.strip !== which) {
      var w = S.v.answers[wi];
      S.rw = { wi: wi, strip: which, c: ci, self: self === undefined ? !w.ask : self, inks: chars.map(function () { return null; }), done: [] };
    }
    stashRedo();
    S.rw.c = ci;
    var prev = S.rw.inks[ci];
    var card = openCard('redo', { wi: wi, strip: which, c: ci });
    var pad = makePad({ write: true, big: true, ink: prev ? prev.strokes : [] });
    pad.strokes = prev ? prev.strokes.slice() : []; pad.undos = prev ? prev.undos : 0; pad.gone = prev && prev.gone ? prev.gone.slice() : [];
    pad.onUp = function () { var r = S.rcells[wi]; if (r && r[which][S.rw.c]) setInk(r[which][S.rw.c], pad.strokes); };
    cardPadIn(card, pad, chars[ci]);
    if (which === 'trace') glyph(chars[ci]).then(function (d) { if (S.card === card) fillStd(pad, d, 'trace'); });
    cardCount(card, which === 'trace' ? '照着描一遍' : '自己写一遍');
    renderPage(); guard();
  };
  /** 手上这一格收进这一条(换格、交之前);卡是别的那条的(描红交了换到空格那条)不收 */
  var stashRedo = function () { var c = S.card; if (!S.rw || !c || c.kind !== 'redo' || !c.pad || c.wi !== S.rw.wi || c.strip !== S.rw.strip) return; S.rw.inks[S.rw.c] = { strokes: c.pad.strokes, undos: c.pad.undos, gone: c.pad.gone }; };
  var nextRedo = function () {
    var rw = S.rw, card = S.card; if (!rw || !card) return;
    stashRedo(); rw.done[rw.c] = true;
    var n = rw.inks.length;
    for (var k = 1; k <= n; k++) { var c = (rw.c + k) % n; if (!rw.done[c]) return openRedoAt(rw.wi, rw.strip, c); }
    var body = { chars: rw.inks.map(function (x) { return x ? { strokes: x.strokes, undos: x.undos, gone: x.gone && x.gone.length ? x.gone : undefined } : { strokes: [], undos: 0 }; }), self: rw.self };
    if (rw.strip === 'trace') body.trace = true;
    var which = rw.strip, wi = rw.wi, self = rw.self;
    persist('POST', '/api/dictation/' + S.v.id + '/rewrites/' + wi, body, card.el.querySelector('[data-next]')).then(function (v) {
      setView(v);
      S.rw = null;
      if (which === 'trace') { openRedoAt(wi, 'free', 0, self); return; }
      event('close', wi);
      closeCard();
    }, function () { S.rw = null; closeCard(); });
  };

  // ---------- 录像(?reel=<id>):开在录像外壳的 iframe 里,照记录用这一页的画法画;钟、把手、启动在 reel-mode.ts ----------
  /** 字形要同步拿:还没到就先不画,到了整屏重画一次 */
  var RG = {};
  var reelGlyph = function (ch) {
    if (RG[ch] !== undefined) return RG[ch] || null;
    RG[ch] = null;
    glyph(ch).then(function (d) { RG[ch] = d || false; if (RL) { RL.gl++; reelTick(); } });
    return null;
  };
  /** 看笔顺放到第几笔:照 animStroke 与 playOrderCard 的节奏(一笔画 max(260, (中线长 + 200) × 0.9) 毫秒,再停 120 + 380) */
  var orderStep = function (d, ms) {
    var t = 0;
    for (var i = 0; i < d.strokes.length; i++) {
      var len = Math.max(260, Math.round((polyLen(d.medians[i] || []) + 200) * 0.9));
      if (ms < t + len + 500) return i;
      t += len + 500;
    }
    return d.strokes.length;
  };
  /** 一个格这一刻的笔:点数变了才重画 */
  var reelInk = function (pad, strokes) {
    var n = 0; strokes.forEach(function (x) { n += x.length; });
    var sig = strokes.length + ':' + n;
    if (pad.sig === sig) return;
    pad.sig = sig;
    setInk(pad, strokes);
  };
  /** 录像里的孩子端样子:用 kid 那份的答案,笔照这一刻 */
  var reelPage = function (f, rebuild) {
    var R = RL.r;
    if (rebuild) {
      var listen = f.view === 'listen';
      S.mode = listen ? 'listen' : 'check'; S.i = f.word;
      S.v.sizes = R.chars.map(function (cs) { return cs.length; });
      S.v.mine = R.chars.map(function () { return null; });
      S.w = { c: f.char, inks: R.chars[f.word].map(function () { return null; }), mode: f.mode };
      S.redo = []; S.rw = null; S.card = null;
      if (!listen && S.v.answers) S.v.answers.forEach(function (w, wi) { w.first = f.ink[wi]; w.ink = f.latest[wi]; w.traced = null; w.rewrote = R.rewrites.some(function (x) { return x.word === wi && x.to <= RL.t; }); w.ask = RL.s.asked.indexOf(wi) >= 0 && !w.rewrote; });
      if (f.view === 'rewrite' && f.open) S.redo.push(f.open.word);
      show('page');
      renderPage();
      if (listen) {
        RL.big = makePad({ big: true }); var c = openCard('write', {}); cardPadIn(c, RL.big); c.anchor = S.cells[f.word][f.char].el; $('#n-nb').append(c.el); placeCard();
      } else if (f.view === 'order' && f.open) {
        RL.big = makePad({ big: true }); RL.big.svg.insertBefore(RL.big.ink, RL.big.std);
        var o = openCard('order', { wi: f.open.word, ci: f.open.char }); cardPadIn(o, RL.big); o.anchor = S.cells[f.open.word][f.open.char].el; $('#n-nb').append(o.el); placeCard();
      } else RL.big = null;
      RL.std = '';
    }
    if (f.view === 'listen') {
      S.cells.forEach(function (pads, wi) { pads.forEach(function (p, ci) { reelInk(p, f.ink[wi][ci]); }); });
      reelInk(RL.big, f.ink[f.word][f.char]);
      var ch = R.chars[f.word][f.char];
      var d = f.mode === 'write' ? null : reelGlyph(ch);
      var k = d && f.mode === 'order' ? orderStep(d, RL.t - f.orderAt) : -1;
      var sk = f.mode + ':' + (d ? 1 : 0) + ':' + k;
      if (sk !== RL.std) { RL.std = sk; fillStd(RL.big, d, f.mode === 'trace' ? 'trace' : ''); if (d && f.mode === 'order') { paintOrder(RL.big, k, false); cardCount(S.card, strokeAt(k, d.strokes.length)); } }
      S.w.mode = f.mode; footFor();
      $('#l-status').textContent = '第' + cn(f.word + 1) + '个词' + (f.mode !== 'write' ? '' : f.say ? ' · 正在念第 ' + f.say.n + ' 遍' : f.said === 1 ? ' · 再听一遍' : f.said > 1 ? ' · 听完了就写' : '');
    } else {
      S.cells.forEach(function (pads, wi) { pads.forEach(function (p, ci) { reelInk(p, f.ink[wi][ci] || []); }); });
      if (f.view === 'rewrite' && f.open && S.rcells[f.open.word]) S.rcells[f.open.word].free.forEach(function (p, ci) { reelInk(p, (f.rewrite && f.rewrite[ci]) || []); });
      if (f.view === 'order' && f.open && RL.big) {
        reelInk(RL.big, f.ink[f.open.word][f.open.char] || []);
        var od = reelGlyph(R.chars[f.open.word][f.open.char]);
        if (od) { var ok = orderStep(od, RL.t - f.orderAt); if (RL.std !== 'r' + ok) { if (!RL.big.std.children.length) fillStd(RL.big, od, ''); RL.std = 'r' + ok; paintOrder(RL.big, ok, false); cardCount(S.card, strokeAt(ok, od.strokes.length)); } }
      }
    }
  };
  /** 这一刻的屏幕:哪一屏、哪个词哪一格、什么样子变了就整屏重画,笔每次对一下 */
  var reelDraw = function (f) {
    var done = RL.r.rewrites.filter(function (x) { return x.to <= RL.t; }).length;
    var key = [f.view, f.word, f.char, f.view === 'listen' ? '' : f.mode, f.open ? f.open.word + ':' + f.open.char : '', f.view === 'check' ? done : 0, RL.gl, window.innerWidth, window.innerHeight].join('|');
    var rebuild = key !== RL.key; RL.key = key;
    reelPage(f, rebuild);
  };
${REEL_MODE_JS}
  api('GET', '/api/kid/home').then(function (j) { TUTORS = j.tutors || []; showFace(); }, function () {});
  if (REEL_ID) reelBoot(); else if (HOME) start(false); else bootTutor();
})();
</script>
</body></html>`;
