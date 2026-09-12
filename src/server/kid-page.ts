/**
 * 孩子端 `/`:首页(老师们 + 今天可以问 + 今天)与老师页(= 板书页)。零依赖内联脚本,只走 /api/kid/* 与 /api/audio。
 * 铁律(《产品规划.md》):界面上永远没有错误与评判——后端不通、老师出错、识别失败,都只是「什么都不出现」或头像灰;
 * 文字尽量少,语音优先。孩子设备上没有通往家长端的入口(2026-09-10 拍板)。
 *
 * 老师页照豆包爱学的形态(《豆包录屏分析.md》):板书是一天一份、越讲越长的文档,孩子的话不上板,只在字幕行回显一下;
 * 一轮回复 = 一节:卡整块铺出,讲稿逐句播(有 mp3 放 mp3,没有用浏览器合成,再没有按字数计时),
 * 播到哪句就在卡上画标注、滚到那张卡;末句是问句就停下,暂停钮换成「继续」。
 * 输入条照豆包通用版:相机 | 发消息或按住说话 | 加号(相册)。平板横屏:板书两列(最宽 1040 居中),没有左栏。
 *
 * 交互逻辑在 ../lib/kid-board.ts(纯函数,有测试),这里把它剥掉类型内联进页面,两处一份源码。卡按 kind 渲染(text / read / choice / fill / code),
 * 每种卡的紧凑态只读;点卡开舞台(盖住板书那块,顶栏是卡的名字 + 关闭,讲稿暂停):选择题在舞台里点大按钮,选了就 PUT 状态,
 * 「交给老师」= 发一条 {text:'', action:'submit', focus:{card}};舞台开着时发的消息都带 focus.card。「继续」= {text:'', action:'continue'}。
 * 状态存服务端,重开页面从 section.cards[n].state 读回;卡上永远不画对错。
 * 重卡(scene / canvas)的舞台在 iframe 里装 /stage/?card=<id>(舞台包,src/stage/),postMessage 协议见 src/stage/protocol.ts:
 * 页面发 card(props + state + 课包 URL),包回 phase / state / submit / close;场景在播时字幕行显示场景讲稿、按钮映射到播放器;
 * 讲稿 [[play]] 锚到场景卡 → 念完那句把动画铺满播,done 了关舞台接着念。
 * 点读段:card.assets 里有 <段号>.mp3 的放服务端配的,没有的浏览器合成;填空舞台逐空打字、「交给老师」;图片舞台双指缩放。
 * 流式:老师还在说时 pending 条目带 partial 板书,卡按下标只追加不重画(先出的卡不闪),讲稿不播;整轮跑完那节换成正式的,声音从第一句起。
 * __TITLE__ / __SHORT__(主屏幕图标下的名字)由路由替换。调试:`?step=<节>.<句>` 直接停在某句(标注画齐、不出声),截图与测试用。
 */
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

/** 读 kid-board 的源码(仓库里是 .ts,npm 包里是 dist 的 .js),剥类型、去 export,变成能内联的普通脚本 */
function boardLibSource(): string {
  let src: string;
  try {
    const ts = readFileSync(new URL('../lib/kid-board.ts', import.meta.url), 'utf8');
    // stripTypeScriptTypes 会发一条 ExperimentalWarning;这里只剥自己的文件,警告对用户没有信息量,压掉
    const warn = process.emitWarning;
    process.emitWarning = () => {};
    try {
      src = stripTypeScriptTypes(ts);
    } finally {
      process.emitWarning = warn;
    }
  } catch {
    src = readFileSync(new URL('../lib/kid-board.js', import.meta.url), 'utf8');
  }
  return src
    .replace(/^export (?=(?:async )?(?:function|const|let|class) )/gm, '')
    .replace(/^export \{[^}]*\};?[ \t]*$/gm, '')
    .replace(/^import [^\n]*$/gm, '');
}

const PAGE = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="__SHORT__">
<meta name="theme-color" content="#f6f4ee">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="icon" href="/icon-192.png">
<link rel="stylesheet" href="/kid/theme.css">
<title>__TITLE__</title>
<style>
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html, body { height:100%; }
  body { margin:0; background:var(--paper); color:var(--ink); font:18px/1.5 -apple-system,"PingFang SC","Helvetica Neue",sans-serif; -webkit-user-select:none; user-select:none; overscroll-behavior:none; }
  button { font:inherit; color:inherit; background:none; border:0; padding:0; cursor:pointer; }
  .ic svg { display:block; }
  /* ---- 首页 ---- */
  #home { min-height:100%; padding:calc(env(safe-area-inset-top) + 16px) 20px calc(env(safe-area-inset-bottom) + 40px); max-width:960px; margin:0 auto; display:flex; flex-direction:column; gap:18px; }
  h1 { font-size:20px; font-weight:600; margin:0; color:var(--dim); }
  .tutors { display:flex; gap:16px; flex-wrap:wrap; justify-content:center; }
  .tutor { display:flex; flex-direction:column; align-items:center; gap:8px; padding:4px; width:104px; }
  .av { border-radius:50%; background:var(--card); border:3px solid var(--line); display:grid; place-items:center; font-weight:700; box-shadow:0 4px 12px #0000000f; flex:0 0 auto; overflow:hidden; }
  .av img { width:100%; height:100%; object-fit:cover; }
  .tutor .av { width:104px; height:104px; font-size:48px; transition:transform .15s; }
  .tutor:active .av { transform:scale(.94); }
  .tutor .nm { font-size:16px; font-weight:600; }
  .tutor.off { pointer-events:none; }
  .tutor.off .av { filter:grayscale(1); opacity:.4; box-shadow:none; }
  .tutor.off .nm { color:var(--dim); }
  .lbl { font-size:14px; color:var(--dim); }
  .sug, .today { display:flex; flex-direction:column; gap:8px; }
  .chip { display:inline-flex; align-items:center; gap:10px; align-self:flex-start; padding:10px 16px; border-radius:22px; background:var(--card); border:1px solid var(--line); font-size:17px; text-align:left; }
  .chip .dot, .slot .dot { width:10px; height:10px; border-radius:50%; flex:0 0 auto; }
  .slots { display:flex; gap:8px; flex-wrap:wrap; }
  .slot { display:inline-flex; align-items:center; gap:8px; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:6px 14px; font-size:15px; }
  .slot.now { border-color:var(--accent); box-shadow:0 0 0 3px #e8743b33; }
  .path { display:flex; align-items:flex-end; gap:10px; padding:6px 0 0; }
  .station { display:flex; flex-direction:column; align-items:center; gap:4px; flex:1; }
  .station .ring { width:30px; height:30px; border-radius:50%; border:4px solid var(--line); background:var(--card); }
  .station.now .ring { width:44px; height:44px; border-width:6px; }
  .station .d { font-size:12px; color:var(--dim); }
  .station.now .d { color:var(--ink); font-weight:600; }
  .station.past { opacity:.45; } .station.later { opacity:.7; }
  .stacks { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; }
  .stack { background:var(--card); border:2px solid var(--line); border-radius:18px; padding:14px 16px; }
  .stack .name { font-weight:600; } .stack .item { font-size:15px; color:var(--dim); margin-top:4px; }
  #rest { display:none; text-align:center; color:var(--dim); font-size:16px; padding:12px 0; }
  body.offline #rest { display:block; }
  body.offline .tutor { pointer-events:none; }
  body.offline .tutor .av { filter:grayscale(1); opacity:.4; box-shadow:none; }
  /* ---- 老师页 = 板书页 ---- */
  #tutor { position:fixed; inset:0; background:var(--paper); display:none; z-index:10; }
  #tutor.on { display:flex; }
  #main { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; }
  #main header { display:flex; align-items:center; gap:12px; padding:calc(env(safe-area-inset-top) + 10px) 16px 10px; background:var(--card); border-bottom:1px solid var(--line); }
  #main header .av { width:44px; height:44px; font-size:20px; }
  .who { flex:1; display:flex; flex-direction:column; min-width:0; }
  .who .nm { font-size:18px; font-weight:600; } .who .mo { font-size:13px; color:var(--dim); }
  .hb { width:40px; height:40px; display:grid; place-items:center; color:var(--dim); }
  .hb.on { color:var(--accent); }
  .hb.dim { opacity:.3; pointer-events:none; }
  .hb[hidden] { display:none; }
  .blank { flex:1; grid-column:1 / -1; min-height:50vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; text-align:center; padding:40px 20px; color:var(--dim); }
  .blank b { font-size:22px; font-weight:600; color:var(--ink); }
  .blank small { font-size:15px; }
  #hist { position:absolute; inset:0; display:none; z-index:30; }
  #hist.on { display:block; }
  #hist .dimmer { position:absolute; inset:0; background:#00000033; }
  #hist .panel { position:absolute; top:0; right:0; bottom:0; width:100%; max-width:380px; background:var(--card); display:flex; flex-direction:column; box-shadow:-4px 0 20px #00000018; }
  #hist .hd { display:flex; align-items:center; justify-content:space-between; padding:calc(env(safe-area-inset-top) + 12px) 12px 12px 20px; font-size:18px; font-weight:600; border-bottom:1px solid var(--line); }
  #hist .ls { flex:1; overflow:auto; padding:8px 12px calc(env(safe-area-inset-bottom) + 24px); }
  #hist .dt { font-size:13px; color:var(--dim); padding:14px 6px 6px; }
  #hist .tr { display:flex; flex-direction:column; gap:4px; padding:12px 14px; border-radius:14px; background:var(--paper); margin-bottom:8px; cursor:pointer; border:2px solid transparent; }
  #hist .tr.on { border-color:var(--accent); }
  #hist .tr b { font-size:16px; font-weight:600; }
  #hist .tr small { font-size:13px; color:var(--dim); }
  #hist .empty { padding:40px 16px; text-align:center; color:var(--dim); }
  #pill[hidden] { display:none; }
  #back-today { width:100%; height:56px; border-radius:28px; background:#fff; border:1px solid var(--line); box-shadow:0 2px 10px #00000010; font-size:17px; font-weight:600; color:var(--ink); }
  #back-today[hidden] { display:none; }
  #wrap { position:relative; flex:1; min-height:0; display:flex; flex-direction:column; }
  #board { flex:1; min-height:0; overflow:auto; padding:14px 16px 24px; display:flex; flex-direction:column; gap:12px; -webkit-overflow-scrolling:touch; scroll-behavior:smooth; }
  /* 字幕行 */
  #sub { display:flex; align-items:center; gap:12px; padding:8px 16px 4px; min-height:52px; }
  #sub-text { flex:1; font-size:15px; line-height:1.45; color:#5a5650; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  #sub-text.echo, #sub-text.thinking { color:var(--dim); }
  #sub-btn { flex:0 0 auto; height:36px; min-width:36px; border-radius:18px; background:#fff; display:inline-flex; align-items:center; justify-content:center; gap:4px; padding:0; font-size:15px; font-weight:600; }
  #sub-btn.cont { padding:0 14px; border:1px solid var(--line); }
  #sub-btn[hidden] { display:none; }
  /* 输入条 */
  #bar { padding:8px 16px calc(env(safe-area-inset-bottom) + 12px); }
  #pill { display:flex; align-items:center; gap:12px; height:56px; padding:0 14px; border-radius:28px; background:#fff; border:1px solid var(--line); box-shadow:0 2px 10px #00000010; }
  #pill .ic { color:var(--ink); display:grid; place-items:center; width:32px; height:44px; }
  #mid { flex:1; min-width:0; min-height:44px; display:flex; align-items:center; font-size:17px; color:var(--dim); touch-action:none; }
  #typed { flex:1; min-width:0; font:inherit; font-size:18px; color:var(--ink); border:0; outline:0; background:none; -webkit-user-select:text; user-select:text; }
  #typed[hidden] { display:none; }
  #go { width:36px; height:36px; border-radius:50%; background:var(--ink); color:#fff; display:grid; place-items:center; }
  #go[hidden] { display:none; }
  body.limit #pill, body.pending #pill { opacity:.45; pointer-events:none; }
  #hold { position:absolute; left:0; right:0; bottom:0; height:300px; background:linear-gradient(180deg,#3b82e800 0%,#3b82e8cc 45%,#2f6fd6 100%); display:none; flex-direction:column; align-items:center; justify-content:flex-end; gap:22px; padding-bottom:calc(env(safe-area-inset-bottom) + 70px); color:#fff; pointer-events:none; z-index:20; }
  #hold.on { display:flex; }
  #hold .w { display:flex; align-items:center; gap:3px; height:28px; }
  #hold .w i { width:3px; border-radius:2px; background:#ffffffdd; animation:wave .8s ease-in-out infinite alternate; }
  @keyframes wave { from { transform:scaleY(.4); } to { transform:scaleY(1); } }
  #sheet { position:absolute; inset:0; display:none; z-index:30; }
  #sheet.on { display:block; }
  #sheet .dimmer { position:absolute; inset:0; background:#00000033; }
  #sheet .panel { position:absolute; left:0; right:0; bottom:0; background:var(--card); border-radius:22px 22px 0 0; padding:18px 20px calc(env(safe-area-inset-bottom) + 24px); display:flex; flex-direction:column; gap:14px; }
  #sheet .grab { width:40px; height:4px; border-radius:2px; background:var(--line); align-self:center; }
  #sheet .opts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
  #sheet label { display:flex; flex-direction:column; align-items:center; gap:8px; padding:18px 0; border-radius:16px; background:var(--paper); font-size:15px; font-weight:600; }
  input[type=file] { display:none; }
  /* ---- 平板横屏 ---- */
  @media (min-width:900px) and (orientation:landscape) {
    #home { max-width:none; display:grid; grid-template-columns:1fr 380px; gap:40px; padding:calc(env(safe-area-inset-top) + 40px) 48px 40px; align-content:start; }
    #home h1 { grid-column:1 / -1; font-size:22px; }
    #home .tutors { gap:40px; } #home .tutor { width:140px; } #home .tutor .av { width:120px; height:120px; font-size:56px; }
    #home .sug { grid-column:1; } #home .side { grid-column:2; grid-row:2 / span 3; display:flex; flex-direction:column; gap:14px; }
    #main header { padding-left:32px; padding-right:32px; }
    #board { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; align-content:start; width:100%; max-width:1040px; margin:0 auto; padding:16px 32px 24px; }
    #sub, #bar { width:100%; max-width:760px; margin:0 auto; }
  }
</style>
<div id="home">
  <h1 id="title">__TITLE__</h1>
  <div class="tutors" id="tutors"></div>
  <p id="rest">老师们休息中</p>
  <div class="sug" id="sug"></div>
  <div class="side" id="side"></div>
</div>
<section id="tutor">
  <div id="main">
    <header>
      <button class="hb" id="back" type="button"></button>
      <span class="av" id="c-av"></span>
      <div class="who"><span class="nm" id="c-nm"></span><span class="mo" id="c-mo"></span></div>
      <button class="hb" id="hist-btn" type="button" title="以前的"></button>
      <button class="hb" id="new-btn" type="button" title="新话题" hidden></button>
      <button class="hb on" id="spk" type="button"></button>
    </header>
    <div id="wrap">
      <div id="board"></div>
      <div id="stage"><div class="top"><span class="ttl" id="st-ttl"></span><span class="kd" id="st-kd"></span><button id="st-x" type="button"></button></div><div id="st-body"></div><iframe id="st-frame" hidden title="stage"></iframe><div id="st-act" hidden><button id="st-go" type="button">交给老师</button></div></div>
    </div>
    <div id="sub"><span id="sub-text"></span><button id="sub-btn" type="button" hidden></button></div>
    <div id="bar">
      <div id="pill">
        <label class="ic" id="cam"><input type="file" accept="image/*" capture="environment"></label>
        <div id="mid"><span id="ph">发消息或按住说话…</span><input id="typed" type="text" autocomplete="off" hidden></div>
        <button id="go" type="button" hidden></button>
        <button class="ic" id="plus" type="button"></button>
      </div>
      <button id="back-today" type="button" hidden>回到今天</button>
    </div>
    <div id="hold"><span>松手发送,上移取消</span><div class="w"></div></div>
  </div>
  <div id="hist"><div class="dimmer"></div><div class="panel"><div class="hd"><span>以前的</span><button class="hb" id="hist-x" type="button"></button></div><div class="ls"></div></div></div>
  <div id="sheet"><div class="dimmer"></div><div class="panel"><div class="grab"></div><div class="opts">
    <label><span class="ic" id="ic-album"></span>相册<input type="file" accept="image/*"></label>
    <label><span class="ic" id="ic-cam2"></span>拍照<input type="file" accept="image/*" capture="environment"></label>
  </div></div></div>
</section>
<script>
(() => {
__BOARD_JS__

  const $ = (s) => document.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f);
      else if (v !== undefined && v !== null) el.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  };
  const SVG = (paths, size, sw) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  const ICON = {
    back: SVG('<path d="M15 5l-7 7 7 7"></path>', 28, 2.2),
    camera: SVG('<path d="M4 8h3l2-3h6l2 3h3v11H4z"></path><circle cx="12" cy="13" r="3.5"></circle>', 22),
    plus: SVG('<path d="M12 5v14M5 12h14"></path>', 22, 2.2),
    play: SVG('<path d="M8 5l11 7-11 7z" fill="currentColor"></path>', 16, 1.5),
    pause: SVG('<path d="M8 5v14M16 5v14"></path>', 16, 2.6),
    speaker: SVG('<path d="M4 10v4h4l5 4V6L8 10z"></path><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"></path>', 24),
    mute: SVG('<path d="M4 10v4h4l5 4V6L8 10z"></path><path d="M17 9l4 6M21 9l-4 6"></path>', 24),
    send: SVG('<path d="M12 19V5M5 12l7-7 7 7"></path>', 20, 2.4),
    image: SVG('<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 16l5-5 4 4 3-3 6 6"></path><circle cx="16" cy="9" r="1.5"></circle>', 36, 1.6),
    album: SVG('<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 15l5-4 4 3 3-2 6 4"></path>', 28),
    close: SVG('<path d="M6 6l12 12M18 6L6 18"></path>', 24, 2.2),
    check: SVG('<path d="M5 12l5 5 9-10"></path>', 16, 3),
    history: SVG('<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path>', 24),
    spark: SVG('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"></path><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"></path>', 24, 1.8),
  };
  const api = async (method, path, body) => {
    const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    if (!r.ok) { const e = new Error('http ' + r.status); e.status = r.status; throw e; }
    return r.json();
  };
  const PALETTE = ['#e8743b', '#3b82e8', '#2fa36b', '#b45fd1', '#d9a520', '#e0508a'];
  const FIXED = { '语文': '#e0508a', '数学': '#3b82e8', '英语': '#2fa36b' };
  const color = (s) => { if (FIXED[s]) return FIXED[s]; let x = 0; for (const ch of s || '') x = (x * 31 + ch.codePointAt(0)) >>> 0; return PALETTE[x % PALETTE.length]; };
  const DAYS = ['', '一', '二', '三', '四', '五', '六', '日'];
  const avatarEl = (t, cls) => {
    const el = h('span', { class: 'av ' + (cls || ''), style: 'border-color:' + color(t.subject || t.display) + ';color:' + color(t.subject || t.display) });
    if (t.avatar && /\.(png|jpe?g|webp|svg)$/i.test(t.avatar)) el.append(h('img', { src: '/api/kid/avatar/' + t.name, alt: '' }));
    else el.textContent = t.avatar || (t.subject || t.display || '?').slice(0, 1);
    return el;
  };
  const debug = new URLSearchParams(location.search);

  // ---- 状态 ----
  const S = { home: null, tutor: null, day: null, sections: [], played: new Set(), state: { section: -1, line: -1, status: 'idle' }, echo: null, echoTimer: null, pending: false, limit: false, offline: false, autoplay: true, bar: 'idle', pollTimer: null, stage: null, partial: null, thread: null, threadAt: null, hist: null, readonly: false, newThread: false };
  try { S.autoplay = localStorage.getItem('kid-autoplay') !== '0'; } catch {}

  // ---- 声音:共享 Audio,首个手势解锁(iOS);没配音退回浏览器合成;都没有按字数计时 ----
  const audioEl = new Audio();
  let unlocked = false;
  const unlock = () => { if (unlocked) return; try { audioEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='; audioEl.play().then(() => { unlocked = true; }).catch(() => {}); } catch {} };
  let voiceToken = 0;
  const stopVoice = () => { voiceToken++; try { audioEl.pause(); } catch {} try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch {} };
  /** 念一句;念完调 onEnd(被打断不调) */
  const say = (line, onEnd) => {
    const token = ++voiceToken;
    const finish = () => { if (token === voiceToken) onEnd(); };
    const fallback = () => { const ms = lineDurationMs(line.text); setTimeout(finish, ms); };
    if (line.audio && S.tutor) {
      try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch {}
      audioEl.onended = finish; audioEl.onerror = () => speak(plainLine(line.text), finish, fallback);
      audioEl.src = '/api/audio/' + S.tutor.name + '/' + line.audio.split('/').map(encodeURIComponent).join('/');
      audioEl.play().catch(() => speak(plainLine(line.text), finish, fallback));
    } else speak(plainLine(line.text), finish, fallback);
  };
  const speak = (text, onEnd, onFail) => {
    try {
      if (!('speechSynthesis' in window)) return onFail();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = 0.95;
      let ended = false;
      u.onend = () => { if (!ended) { ended = true; onEnd(); } };
      u.onerror = () => { if (!ended) { ended = true; onFail(); } };
      speechSynthesis.speak(u);
      // 有的浏览器不发 onend:兜一个按字数的上限
      setTimeout(() => { if (!ended) { ended = true; onEnd(); } }, lineDurationMs(text) * 2 + 1500);
    } catch { onFail(); }
  };

  // ---- 首页 ----
  const renderHome = () => {
    const H = S.home;
    document.title = H.title; $('#title').textContent = H.title;
    $('#tutors').replaceChildren(...H.tutors.map((t) => h('button', { type: 'button', class: 'tutor' + (t.available ? '' : ' off'), on: { click: () => openTutor(t) } }, avatarEl(t), h('span', { class: 'nm' }, t.display))));
    const sug = Array.isArray(H.suggestions) ? H.suggestions.filter((s) => s && s.text && H.tutors.some((t) => t.name === s.tutor && t.available)) : [];
    $('#sug').replaceChildren(...(sug.length ? [h('span', { class: 'lbl' }, '今天可以问'), ...sug.map((s) => { const t = H.tutors.find((x) => x.name === s.tutor); return h('button', { type: 'button', class: 'chip', on: { click: () => openTutor(t, s.text) } }, h('span', { class: 'dot', style: 'background:' + color(t.subject || t.display) }), s.text); })] : []));
    const days = [...new Set([...H.timetable.map((e) => e.day), H.day])].sort((a, b) => a - b);
    const slots = H.timetable.filter((e) => e.day === H.day).map((e) => h('span', { class: 'slot' + (H.slot === e.subject + ' ' + e.start + '-' + e.end ? ' now' : '') }, h('span', { class: 'dot', style: 'background:' + color(e.subject) }), e.subject + ' ' + e.start + '–' + e.end));
    const path = h('div', { class: 'path' }, ...days.map((d) => {
      const subjects = [...new Set(H.timetable.filter((e) => e.day === d).map((e) => e.subject))];
      const when = d === H.day ? 'now' : d < H.day ? 'past' : 'later';
      return h('div', { class: 'station ' + when }, h('span', { class: 'ring', style: 'border-color:' + (subjects.length ? color(subjects[0]) : 'var(--line)') }), h('span', { class: 'd' }, d === H.day ? '今天' : '周' + DAYS[d]));
    }));
    const stacks = (H.stacks || []).map((s) => h('div', { class: 'stack', style: 'border-color:' + color(s.subject) }, h('div', { class: 'name' }, s.subject), ...s.items.map((a) => h('div', { class: 'item' }, a.id))));
    $('#side').replaceChildren(...[h('div', { class: 'today' }, h('span', { class: 'lbl' }, '今天'), slots.length ? h('div', { class: 'slots' }, ...slots) : null, path), stacks.length ? h('div', { class: 'stacks' }, ...stacks) : null].filter(Boolean));
  };
  const loadHome = async () => {
    try { S.home = await api('GET', '/api/kid/home'); setOffline(false); renderHome(); }
    catch { setOffline(true); }
  };
  const setOffline = (off) => {
    if (S.offline === off) return;
    S.offline = off;
    document.body.classList.toggle('offline', off);
    if (off && S.tutor) closeTutor();
  };

  // ---- 老师页 ----
  const openTutor = (t, sendText) => {
    unlock();
    S.tutor = t; S.sections = []; S.played = new Set(); S.state = { section: -1, line: -1, status: 'idle' }; S.echo = null; S.pending = false; S.limit = false; S.stage = null; S.partial = null; $('#stage').classList.remove('on');
    S.thread = null; S.threadAt = null; S.hist = null; S.readonly = false; S.newThread = false; $('#hist').classList.remove('on'); renderBar(); renderHeader();
    $('#c-av').replaceWith(Object.assign(avatarEl(t), { id: 'c-av' }));
    $('#c-nm').textContent = t.display;
    $('#c-mo').textContent = t.motto || '';
    $('#board').replaceChildren();
    $('#tutor').classList.add('on');
    setBar('idle');
    loadDay(true).then(() => { if (sendText) send(sendText); });
  };
  const closeTutor = () => { clearTimeout(S.pollTimer); stopVoice(); S.tutor = null; $('#tutor').classList.remove('on'); document.body.classList.remove('pending', 'limit'); loadHome(); };
  $('#back').addEventListener('click', closeTutor);
  $('#back').innerHTML = ICON.back;

  // 卡片:按 kind 分支(轻插件内联;不认识的 kind 把 props 里的字都显示出来)。紧凑态只读,点了开舞台;stage=true 是舞台里的画法
  const renderCard = (c, idx, secIdx, stage) => {
    const p = c.props || {};
    const box = (cls, ...kids) => h('div', { class: 'c c-' + cls, 'data-card': idx, on: stage ? {} : { click: () => openStage(secIdx, idx) } }, ...kids);
    switch (c.kind) {
      case 'text': {
        const st = p.style;
        if (st === 'cover') return box('cover', h('span', { class: 't' }, p.title || ''), p.text ? h('span', { class: 's' }, p.text) : null);
        if (st === 'note') return box('note', p.text || '');
        if (st === 'quote') return box('quote', '「' + (p.text || '') + '」');
        if (st === 'formula') return box('formula', p.text || '');
        if (st === 'step') return box('step', h('div', { class: 'st-t' }, p.title || ''), h('div', {}, p.text || ''));
        return box('text', p.text || '');
      }
      case 'read':
        return box('read', ...(p.segments || []).map((seg, k) => h('div', { class: 'rd', on: { click: (e) => { e.stopPropagation(); readSegment(e.currentTarget, c, k, seg); } } }, seg)));
      case 'image': {
        const src = /^https?:\\/\\//.test(p.src || '') ? p.src : '/api/kid/image?p=' + encodeURIComponent(p.src || '');
        if (stage) { const el = box('image'); el.className = 'zoom'; el.append(h('img', { src, alt: p.caption || '' })); pinch(el); return el; }
        return box('image', h('img', { src, alt: '', loading: 'lazy' }), p.caption ? h('div', { class: 'cap' }, p.caption) : null);
      }
      case 'choice': {
        const picked = (c.state && Array.isArray(c.state.picked)) ? c.state.picked : [];
        if (stage) return box('choice', h('div', { class: 'sq' }, p.question || ''), ...(p.options || []).map((o, i) => h('button', { type: 'button', class: 'so' + (picked.includes(i) ? ' on' : ''), on: { click: () => pick(secIdx, idx, i) } }, h('i', {}, picked.includes(i) ? h('span', { html: ICON.check }) : 'ABCDEFGH'[i] || ''), o)));
        // 选项都短(≤ 4 个字)就横排成一行胶囊,不然三个一位数的答案各占一整行(2026-09-11 截图)
        const short = (p.options || []).length > 0 && (p.options || []).every((o) => Array.from(String(o)).length <= 4);
        return box('choice', h('div', { class: 'ch-q' }, p.question || ''), h('div', { class: 'ch-os' + (short ? ' short' : '') }, ...(p.options || []).map((o, i) => h('div', { class: 'ch-o' + (picked.includes(i) ? ' on' : '') }, h('i', {}, 'ABCDEFGH'[i] || ''), o))));
      }
      case 'fill': {
        const el = box('fill');
        const parts = String(p.text || '').split(/_{2,}/);
        const got = filledAnswers(c);
        if (stage) {
          el.classList.add('fq');
          parts.forEach((t, i) => { el.append(t); if (i < parts.length - 1) el.append(h('input', { class: 'fi', type: 'text', value: got[i] || '', autocomplete: 'off', enterkeyhint: 'done', on: { input: (e) => fillIn(secIdx, idx, i, e.target.value), keydown: (e) => { if (e.key === 'Enter') e.target.blur(); }, click: (e) => e.stopPropagation() } })); });
          return el;
        }
        parts.forEach((t, i) => { el.append(t); if (i < parts.length - 1) el.append(h('span', { class: 'bl' + (got[i] ? ' f' : '') }, got[i] || '\\u200b')); });
        return el;
      }
      case 'scene': {
        const ready = sceneReady(c);
        const n = Array.isArray(p.steps) ? p.steps.length : 0;
        const thumb = ready && p.thumb ? h('img', { src: '/api/kid/image?p=' + encodeURIComponent(p.thumb), alt: '' }) : null;
        return box('scene', p.problem ? h('div', { class: 'sp' }, p.problem) : (p.title ? h('div', { class: 'sp' }, p.title) : null), h('div', { class: 'th' }, thumb || (ready ? '' : '图还在路上'), ready ? h('span', { class: 'pl' }, (n ? n + ' 步 ' : '') + '▷') : null), p.text ? h('div', { class: 'tx' }, p.text) : null);
      }
      case 'canvas': {
        const n = inkCount(c);
        return box('canvas', h('div', { class: 'cp' }, p.prompt || '画一画'), h('div', { class: 'cb' }, n ? '已经画了 ' + n + ' 笔,点开接着画' : '点开画一画 ✎'));
      }
      case 'code':
        return box('code', p.lang ? h('span', { class: 'lg' }, p.lang) : null, p.text || '');
      default:
        return box('text', cardTexts(c).filter(Boolean).join('\\n'));
    }
  };
  /** 点读:点哪段念哪段——服务端配好的段(card.assets 里有 <段号>.mp3)放 mp3,没好的用浏览器合成声;讲稿在播就先停下 */
  const readSegment = (el, card, k, seg) => {
    stopVoice();
    if (S.state.status === 'playing') { S.state = { ...S.state, status: 'paused' }; renderSubtitle(); }
    for (const x of document.querySelectorAll('.rd.on')) x.classList.remove('on');
    el.classList.add('on');
    const off = () => el.classList.remove('on');
    say({ text: seg, audio: segmentAudio(card, k) }, off);
  };
  /** 填空:改一个空 → 本地状态、紧凑态重画、400ms 后 PUT(打字中不刷舞台,免得输入框失焦) */
  let fillTimer = null;
  const fillIn = (secIdx, idx, i, value) => {
    const card = S.sections[secIdx].cards[idx];
    const answers = filledAnswers(card); answers[i] = value;
    card.state = { answers };
    $('#st-go').disabled = !stateSummary(card).length;
    repaintCard(secIdx, idx);
    clearTimeout(fillTimer);
    fillTimer = setTimeout(() => saveState(S.sections[secIdx].job, idx, card.state), 400);
  };
  /** 图片舞台:双指缩放 + 单指拖,双击复位 */
  const pinch = (el) => {
    const img = el.querySelector('img');
    const pts = new Map(); let scale = 1, tx = 0, ty = 0, start = null, lastTap = 0;
    const apply = () => { img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; };
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    el.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { el.setPointerCapture(e.pointerId); } catch {} start = { scale, tx, ty, d: pts.size === 2 ? dist() : 0, x: e.clientX, y: e.clientY }; if (pts.size === 1) { const now = Date.now(); if (now - lastTap < 300) { scale = 1; tx = 0; ty = 0; apply(); } lastTap = now; } });
    el.addEventListener('pointermove', (e) => { if (!pts.has(e.pointerId) || !start) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2 && start.d) scale = Math.min(6, Math.max(1, start.scale * dist() / start.d)); else if (pts.size === 1 && scale > 1) { tx = start.tx + (e.clientX - start.x); ty = start.ty + (e.clientY - start.y); } apply(); });
    const up = (e) => { pts.delete(e.pointerId); start = pts.size ? { scale, tx, ty, d: pts.size === 2 ? dist() : 0, x: [...pts.values()][0].x, y: [...pts.values()][0].y } : null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  const renderSection = (s, i) => h('div', { class: 'sec', 'data-sec': i }, ...s.cards.map((c, idx) => renderCard(c, idx, i, false)));
  /** 老师还在说:这节的卡按下标只追加(下标 = 它跑完后会得到的节号,总是最后一节);讲稿不播,声音整轮跑完再从头起 */
  const renderPartial = (e) => {
    const idx = S.sections.length;
    if (!S.partial || S.partial.job !== e.job) { if (S.partial) S.partial.el.remove(); S.partial = { job: e.job, el: h('div', { class: 'sec', 'data-sec': idx }) }; $('#board').append(S.partial.el); }
    const el = S.partial.el;
    for (let i = el.children.length; i < e.cards.length; i++) { const c = renderCard(e.cards[i], i, idx, false); el.append(c); c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  };
  /** 一张卡的状态变了:紧凑态原地重画(标注会掉,重画本节已播到的) */
  const repaintCard = (secIdx, idx) => {
    const sec = $('#board').querySelector('[data-sec="' + secIdx + '"]');
    const old = sec && sec.querySelector('[data-card="' + idx + '"]');
    if (!old) return;
    old.replaceWith(renderCard(S.sections[secIdx].cards[idx], idx, secIdx, false));
    const upTo = S.state.section === secIdx ? S.state.line : S.state.section > secIdx ? undefined : -1;
    if (upTo !== -1) for (const l of S.sections[secIdx].lines.slice(0, upTo === undefined ? undefined : upTo + 1)) for (const m of l.marks) if (m.card === idx) applyMark(secIdx, m);
  };

  // ---- 舞台:点卡放大,交互都在这里;开着时讲稿暂停,关了字幕行出「播放」 ----
  const KIND_NAME = { text: '', read: '点读', choice: '选一选', fill: '填一填', image: '看图', scene: '讲解动画', canvas: '画一画', code: '' };
  const GO_LABEL = { canvas: '给老师看' };
  const openStage = (secIdx, idx, opts = {}) => {
    const card = S.sections[secIdx] && S.sections[secIdx].cards[idx];
    if (!card) return;
    if (isHeavy(card) && !sceneReady(card) && card.kind === 'scene') return; // 课包还没到:紧凑态写着「图还在路上」,不开
    if (S.readonly && hasState(card) && !opts.delegate) return; // 以前的只能看:选择 / 填空 / 画板不开,免得改了当时的答案
    if (S.state.status === 'playing' && !opts.delegate) { stopVoice(); S.state = { ...S.state, status: 'paused' }; renderSubtitle(); }
    S.stage = { section: secIdx, card: idx, id: S.sections[secIdx].job + '/' + idx, scene: null, delegate: Boolean(opts.delegate), autoplay: Boolean(opts.autoplay) };
    $('#st-ttl').textContent = cardTitle(card);
    $('#st-kd').textContent = KIND_NAME[card.kind] || card.kind;
    $('#st-kd').hidden = !(KIND_NAME[card.kind] || card.kind);
    renderStage();
    $('#stage').classList.add('on');
  };
  const STAGE_SOURCE = 'cotutor-stage';
  const frame = $('#st-frame');
  const postStage = (m) => { try { frame.contentWindow.postMessage({ source: STAGE_SOURCE, ...m }, '*'); } catch {} };
  const renderStage = () => {
    if (!S.stage) return;
    const card = S.sections[S.stage.section].cards[S.stage.card];
    const heavy = isHeavy(card);
    $('#st-body').hidden = heavy;
    frame.hidden = !heavy;
    if (heavy) { $('#st-body').replaceChildren(); frame.src = '/stage/?card=' + encodeURIComponent(S.stage.id); }
    else { frame.src = 'about:blank'; $('#st-body').replaceChildren(renderCard(card, S.stage.card, S.stage.section, true)); }
    const act = $('#st-act'); act.hidden = !hasState(card);
    $('#st-go').textContent = GO_LABEL[card.kind] || '交给老师';
    $('#st-go').disabled = !stateSummary(card).length;
  };
  /** 舞台包说话:ready → 把卡发过去;phase → 字幕行;state → 存;done 且是讲稿委托的 → 关舞台接着念 */
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.source !== STAGE_SOURCE || !S.stage) return;
    const card = S.sections[S.stage.section].cards[S.stage.card];
    if (m.type === 'ready') { const b = card.kind === 'scene' ? card.props.bundle : card.kind === 'canvas' && card.props.base && card.props.base.bundle ? card.props.base.bundle : null; postStage({ type: 'card', id: S.stage.id, kind: card.kind, props: card.props, state: card.state === undefined ? null : card.state, bundleUrl: b ? '/api/bundles/' + encodeURIComponent(b) + '/' : undefined, autoplay: S.stage.autoplay }); }
    else if (m.type === 'phase') { S.stage.scene = { phase: m.phase, line: m.line, step: m.step, total: m.total }; renderSubtitle(); if (m.phase === 'done' && S.stage.delegate) { const d = S.stage; closeStage(); resumeAfter(d); } }
    else if (m.type === 'state') { card.state = m.state; $('#st-go').disabled = !stateSummary(card).length; repaintCard(S.stage.section, S.stage.card); saveState(S.sections[S.stage.section].job, S.stage.card, m.state); }
    else if (m.type === 'submit') { card.state = m.state; const id = S.stage.id; const job = S.sections[S.stage.section].job; const idx = S.stage.card; closeStage(); api('PUT', '/api/kid/conversations/' + S.tutor.name + '/cards/' + job + '/' + idx, m.image ? { ...m.state, image: m.image } : m.state).catch(() => {}).then(() => send('', { action: 'submit', focus: { card: id }, echoText: '你:' + (stateSummary(card).join('、') || '给老师看') })); }
    else if (m.type === 'close' || m.type === 'error') { const d = S.stage; closeStage(); if (d.delegate) resumeAfter(d); }
  });
  /** 讲稿委托给场景播完(或孩子关了)→ 接着念下一句 */
  const resumeAfter = (d) => { if (S.state.status !== 'stage') return; S.state = advance({ ...S.state, status: 'playing' }, S.sections); if (S.state.status === 'playing') playLine(); else renderSubtitle(); };
  const closeStage = () => { S.stage = null; frame.src = 'about:blank'; $('#stage').classList.remove('on'); renderSubtitle(); };
  $('#st-x').innerHTML = ICON.close;
  $('#st-x').addEventListener('click', closeStage);
  /** 选择题:点一项 → 本地改状态、重画、PUT 到服务端(失败不响,下次再点再存) */
  const pick = (secIdx, idx, i) => {
    const card = S.sections[secIdx].cards[idx];
    const cur = (card.state && Array.isArray(card.state.picked)) ? card.state.picked : [];
    card.state = { picked: togglePick(cur, i, Boolean(card.props.multi)) };
    renderStage(); repaintCard(secIdx, idx);
    saveState(S.sections[secIdx].job, idx, card.state);
  };
  const saveState = (job, idx, state) => { if (!S.tutor || S.readonly) return; api('PUT', '/api/kid/conversations/' + S.tutor.name + '/cards/' + job + '/' + idx, state).catch(() => {}); };
  $('#st-go').addEventListener('click', () => {
    if (!S.stage) return;
    const card = S.sections[S.stage.section].cards[S.stage.card];
    if (isHeavy(card)) { postStage({ type: 'control', action: 'submit' }); return; } // 画板:让舞台包导出 png 再交
    const labels = stateSummary(card);
    if (!labels.length) return;
    const id = S.stage.id;
    clearTimeout(fillTimer); if (card.kind === 'fill') saveState(S.sections[S.stage.section].job, S.stage.card, card.state);
    closeStage();
    send('', { action: 'submit', focus: { card: id }, echoText: '你:' + labels.join('、') });
  });
  const applyMark = (secIdx, mark) => {
    const sec = $('#board').querySelector('[data-sec="' + secIdx + '"]');
    const card = sec && sec.querySelector('[data-card="' + mark.card + '"]');
    if (!card) return null;
    const cardData = S.sections[secIdx].cards[mark.card];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = findPhrase(n.nodeValue, mark.phrase);
      if (i < 0 || n.parentElement.classList.contains('mk')) continue;
      const range = document.createRange(); range.setStart(n, i); range.setEnd(n, i + mark.phrase.length);
      const span = document.createElement('span'); span.className = 'mk mk-' + markStyle(cardData);
      range.surroundContents(span);
      return card;
    }
    return card;
  };
  const renderSubtitle = () => {
    let v = subtitleFor({ state: S.state, sections: S.sections, echo: S.echo, pending: S.pending, thinking: (S.tutor && S.tutor.thinking) || '让我想想…', limit: S.limit });
    if (S.stage && S.stage.scene && !S.echo && !S.limit) v = sceneSubtitle(S.stage.scene.phase, S.stage.scene.line, S.stage.scene.step, S.stage.scene.total);
    const t = $('#sub-text'); t.textContent = v.text; t.className = v.kind;
    const b = $('#sub-btn');
    if (S.readonly && v.right === 'continue') v.right = 'none';
    b.hidden = v.right === 'none';
    b.className = v.right === 'continue' ? 'cont' : '';
    b.innerHTML = v.right === 'pause' ? ICON.pause : v.right === 'play' ? ICON.play : v.right === 'continue' ? ICON.play + '<span>继续</span>' : '';
    document.body.classList.toggle('pending', S.pending);
    document.body.classList.toggle('limit', S.limit);
  };
  $('#sub-btn').addEventListener('click', () => {
    if (S.stage && S.stage.scene) { postStage({ type: 'control', action: 'toggle' }); return; }
    if (S.state.status === 'playing') { stopVoice(); S.state = { ...S.state, status: 'paused' }; renderSubtitle(); }
    else if (S.state.status === 'paused') { S.state = { ...S.state, status: 'playing' }; playLine(); }
    else if (S.state.status === 'waiting') send('', { action: 'continue', echo: false });
  });

  // 播放:一句 = 字幕 + 标注 + 滚到那张卡 + 声音;播完往下走
  const playLine = () => {
    const s = S.sections[S.state.section]; const line = s && s.lines[S.state.line];
    if (!line) { S.state = { ...S.state, status: 'done' }; renderSubtitle(); return; }
    renderSubtitle();
    let target = null;
    for (const m of line.marks) target = applyMark(S.state.section, m) || target;
    if (!target) { const at = lineTarget(line); target = $('#board').querySelector('[data-sec="' + S.state.section + '"] ' + (at === null ? '.c' : '[data-card="' + at + '"]')); }
    if (target) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    say(line, () => {
      if (S.state.status !== 'playing') return;
      // [[play]]:念完这句把场景铺满播,播完(done)再接着念
      const play = line.cues.find((c) => c.name === 'play');
      const target = play && S.sections[S.state.section].cards[play.card];
      if (target && target.kind === 'scene' && sceneReady(target)) { S.state = { ...S.state, status: 'stage' }; openStage(S.state.section, play.card, { delegate: true, autoplay: true }); return; }
      S.state = advance(S.state, S.sections);
      if (S.readonly && S.state.status === 'waiting') S.state = { ...S.state, status: 'done' };
      if (S.state.status === 'playing') playLine();
      else { renderSubtitle(); if (S.state.status === 'waiting') openAskCard(S.state.section, line); }
    });
  };
  /** 末句问句停下时,锚点卡有交互(选择题)就把它推到舞台等答 */
  const openAskCard = (secIdx, line) => {
    const at = lineTarget(line);
    const card = at !== null && S.sections[secIdx] && S.sections[secIdx].cards[at];
    if (card && hasState(card) && !S.stage) openStage(secIdx, at);
  };
  /** 把一节的标注一次画齐(打开页面、不出声时) */
  const paintAll = (secIdx, upTo) => { const s = S.sections[secIdx]; if (!s) return; for (const l of s.lines.slice(0, upTo === undefined ? s.lines.length : upTo + 1)) for (const m of l.marks) applyMark(secIdx, m); };

  const loadDay = async (silent) => {
    if (!S.tutor) return;
    try {
      const d = await api('GET', '/api/kid/conversations/' + S.tutor.name + '/' + (S.hist || 'today'));
      setOffline(false);
      S.day = d;
      S.limit = d.remaining <= 0;
      // 话题:没选过就是当前(末条所在)的;板书只铺这个话题的节。新话题空白态什么都不铺,发出第一句才有话题
      if (!S.thread && !S.newThread) S.thread = d.thread;
      const mine = S.newThread ? [] : d.messages.filter((m) => m.thread === S.thread);
      const first = mine.find((m) => m.question !== null) || mine[0];
      S.threadAt = first ? first.at : null;
      const entries = sectionsFromMessages(mine);
      const fresh = [];
      for (const e of entries) {
        if (S.played.has(e.job)) continue;
        if (e.partial) { renderPartial(e); continue; }
        S.played.add(e.job); S.sections.push(e); fresh.push(S.sections.length - 1);
        const idx = S.sections.length - 1;
        if (S.partial && S.partial.job === e.job) {
          // 流式时先铺的卡留着,只补后面的;节的编号就是它现在的位置
          const el = S.partial.el; S.partial = null;
          for (let i = el.children.length; i < e.cards.length; i++) el.append(renderCard(e.cards[i], i, idx, false));
          el.setAttribute('data-sec', idx);
        } else $('#board').append(renderSection(e, idx));
      }
      if (S.partial && !entries.some((e) => e.partial && e.job === S.partial.job)) { S.partial.el.remove(); S.partial = null; }
      // 服务端的状态是真相(别的设备上选的、重开页面):没在舞台里改着的卡照它画
      entries.forEach((e) => { const i = S.sections.findIndex((x) => x.job === e.job); if (i < 0 || fresh.includes(i)) return; e.cards.forEach((c, idx) => { const mine = S.sections[i].cards[idx]; if (JSON.stringify(mine.state) !== JSON.stringify(c.state) && !(S.stage && S.stage.section === i && S.stage.card === idx)) { mine.state = c.state; repaintCard(i, idx); } }); });
      if (fresh.length && S.stage) closeStage();
      const stillPending = Boolean(d.pending) || d.messages.some((m) => m.pending);
      S.pending = stillPending;
      if (fresh.length) {
        if (silent || !S.autoplay) { for (const i of fresh) paintAll(i); S.state = playerAtEnd(S.sections); renderSubtitle(); const last = $('#board').querySelector('[data-sec="' + (S.sections.length - 1) + '"] .c'); if (last) last.scrollIntoView({ block: 'start', behavior: 'instant' }); }
        else { stopVoice(); S.state = startSection(fresh[0], S.sections); if (S.state.status === 'playing') playLine(); else renderSubtitle(); }
      } else renderSubtitle();
      renderHeader();
      clearTimeout(S.pollTimer);
      if (stillPending) S.pollTimer = setTimeout(() => loadDay(false), 1000);
    } catch (e) {
      if (e && e.status === 404) return closeTutor();
      setOffline(true);
    }
  };
  // ---- 话题:头部「以前的」「新话题」、空白态、只读回放 ----
  const dateLabel = (date, today) => {
    if (date === today) return '今天';
    const [y, mo, da] = date.split('-').map(Number);
    const t = today.split('-').map(Number);
    const diff = Math.round((new Date(t[0], t[1] - 1, t[2]) - new Date(y, mo - 1, da)) / 86400000);
    return diff === 1 ? '昨天' : mo + ' 月 ' + da + ' 日';
  };
  const clock = (at) => (at && at.length >= 16 ? at.slice(11, 16) : '');
  const renderHeader = () => {
    if (!S.tutor) return;
    const today = S.day ? S.day.date : null;
    let mo = S.tutor.motto || '';
    if (S.hist && today) mo = '以前的 · ' + dateLabel(S.hist, S.hist === today ? '' : today) + ' ' + clock(S.threadAt);
    else if (S.newThread) mo = '新话题';
    else if (S.thread && S.day && S.thread !== S.day.thread) mo = '今天的话题 · ' + clock(S.threadAt);
    $('#c-mo').textContent = mo;
    const nb = $('#new-btn');
    nb.hidden = S.newThread || S.readonly || (!S.sections.length && !S.pending && !S.partial);
    nb.classList.toggle('dim', S.pending);
  };
  const renderBar = () => { $('#pill').hidden = S.readonly; $('#back-today').hidden = !S.readonly; };
  const resetBoard = () => { stopVoice(); if (S.stage) closeStage(); clearTimeout(S.pollTimer); S.sections = []; S.played = new Set(); S.state = { section: -1, line: -1, status: 'idle' }; S.partial = null; S.echo = null; $('#board').replaceChildren(); };
  /** 换到某天的某个话题:今天的能接着聊;以前的只读回放(从第一句播) */
  const switchThread = (date, thread) => {
    resetBoard();
    S.hist = date; S.readonly = Boolean(date); S.thread = thread; S.newThread = false; S.threadAt = null;
    renderBar(); renderSubtitle(); renderHeader();
    loadDay(!S.readonly);
  };
  $('#back-today').addEventListener('click', () => switchThread(null, null));
  $('#new-btn').innerHTML = ICON.spark;
  $('#new-btn').addEventListener('click', () => {
    if (S.pending || S.readonly) return;
    resetBoard();
    S.newThread = true; S.thread = null; S.threadAt = null;
    $('#board').append(h('div', { class: 'blank' }, h('b', {}, '换个话题吧,想问什么?'), S.tutor && S.tutor.firstQuestion ? h('small', {}, '比如:' + S.tutor.firstQuestion) : null));
    setBar('idle'); renderSubtitle(); renderHeader();
  });
  $('#hist-btn').innerHTML = ICON.history;
  $('#hist-x').innerHTML = ICON.close;
  const closeHist = () => $('#hist').classList.remove('on');
  $('#hist-x').addEventListener('click', closeHist);
  $('#hist .dimmer').addEventListener('click', closeHist);
  $('#hist-btn').addEventListener('click', async () => {
    if (!S.tutor) return;
    const ls = $('#hist .ls'); ls.replaceChildren();
    $('#hist').classList.add('on');
    try {
      const hst = await api('GET', '/api/kid/conversations/' + S.tutor.name + '/history?days=30');
      const nodes = [];
      for (const dd of hst.days) {
        nodes.push(h('div', { class: 'dt' }, dateLabel(dd.date, hst.today)));
        for (const t of dd.threads) {
          const open = t.thread === S.thread && (dd.date === hst.today ? !S.hist : S.hist === dd.date);
          nodes.push(h('div', { class: 'tr' + (open ? ' on' : ''), on: { click: () => { closeHist(); if (!open) switchThread(dd.date === hst.today ? null : dd.date, t.thread); } } }, h('b', {}, t.title), h('small', {}, clock(t.at) + ' · ' + t.sections + ' 节 · ' + t.cards + ' 张卡' + (open ? ' · 正在看' : ''))));
        }
      }
      ls.replaceChildren(...(nodes.length ? nodes : [h('div', { class: 'empty' }, '还没有以前的')]));
    } catch { ls.replaceChildren(); }
  });
  const showEcho = (text) => { clearTimeout(S.echoTimer); S.echo = text; renderSubtitle(); S.echoTimer = setTimeout(() => { S.echo = null; renderSubtitle(); }, 2500); };
  const send = async (text, opts = {}) => {
    text = (text || '').trim();
    if ((!text && !opts.action) || !S.tutor || S.readonly || (S.limit && opts.action !== 'continue')) return;
    unlock();
    stopVoice();
    if (S.state.status === 'playing' || S.state.status === 'paused' || S.state.status === 'stage') S.state = { ...S.state, status: 'done' };
    if (opts.echo !== false) showEcho(opts.echoText || ('你:' + text));
    S.pending = true; renderSubtitle();
    const body = { text };
    if (opts.action) body.action = opts.action;
    const focus = opts.focus || (S.stage ? { card: S.stage.id } : null);
    if (focus) body.focus = focus;
    if (S.newThread) body.newThread = true; else if (S.thread) body.thread = S.thread;
    try {
      const r = await api('POST', '/api/kid/conversations/' + S.tutor.name + '/messages', body);
      if (r && r.thread) S.thread = r.thread;
      if (S.newThread) { S.newThread = false; const blank = $('#board .blank'); if (blank) blank.remove(); }
      renderHeader();
      clearTimeout(S.pollTimer); S.pollTimer = setTimeout(() => loadDay(false), 1200);
    } catch (e) {
      // 忙 / 上限 / 不通:什么都不报;刷新一下让状态说话
      S.pending = false;
      if (e && e.status === 429) { S.limit = true; renderSubtitle(); } else if (e && e.status === 409) loadDay(true); else setOffline(true);
    }
  };

  // ---- 喇叭:自动朗读开关 ----
  const spk = $('#spk');
  const renderSpk = () => { spk.innerHTML = S.autoplay ? ICON.speaker : ICON.mute; spk.classList.toggle('on', S.autoplay); };
  spk.addEventListener('click', () => { S.autoplay = !S.autoplay; try { localStorage.setItem('kid-autoplay', S.autoplay ? '1' : '0'); } catch {} renderSpk(); if (!S.autoplay && S.state.status === 'playing') { stopVoice(); paintAll(S.state.section); S.state = playerAtEnd(S.sections); renderSubtitle(); } });
  renderSpk();

  // ---- 输入条:相机 | 发消息或按住说话 | 加号 ----
  $('#cam').insertAdjacentHTML('afterbegin', ICON.camera);
  $('#plus').innerHTML = ICON.plus;
  $('#go').innerHTML = ICON.send;
  $('#ic-album').innerHTML = ICON.album; $('#ic-cam2').innerHTML = ICON.camera;
  const setBar = (mode) => {
    S.bar = mode;
    $('#ph').hidden = mode === 'typing'; $('#typed').hidden = mode !== 'typing'; $('#go').hidden = mode !== 'typing';
    $('#hold').classList.toggle('on', mode === 'holding');
    if (mode === 'typing') $('#typed').focus();
  };
  const mid = $('#mid'), typed = $('#typed');
  $('#go').addEventListener('click', () => { const t = typed.value; typed.value = ''; setBar(barNext(S.bar, 'sent')); send(t); });
  typed.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#go').click(); } });
  typed.addEventListener('blur', () => { if (!typed.value.trim()) setBar(barNext(S.bar, 'blur')); });
  $('#plus').addEventListener('click', () => $('#sheet').classList.add('on'));
  $('#sheet .dimmer').addEventListener('click', () => $('#sheet').classList.remove('on'));
  for (const f of document.querySelectorAll('input[type=file]')) f.addEventListener('change', () => { $('#sheet').classList.remove('on'); f.value = ''; /* 照片走 R5 作业线,现在只收下不发 */ });
  $('#hold .w').replaceChildren(...[6, 10, 16, 22, 12, 26, 18, 8, 14, 24, 20, 10, 16, 28, 12, 8, 18, 22, 10, 14, 6, 12, 20, 16, 8].map((v, i) => h('i', { style: 'height:' + v + 'px;animation-delay:' + (i * 37 % 400) + 'ms' })));

  // 中间那段:点 = 打字;按住 150ms = 说话(浏览器识别),松手发,上滑 60px 取消;没有识别就只有打字
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let press = null, rec = null, finalText = '';
  const startRec = () => {
    finalText = '';
    try {
      rec = new SR(); rec.lang = 'zh-CN'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      rec.onresult = (ev) => { let s = ''; for (const r of ev.results) s += r[0].transcript; finalText = s; };
      rec.onerror = () => {};
      rec.onend = () => { const cancelled = press && press.cancelled; const t = finalText; rec = null; if (!cancelled && t.trim()) send(t); };
      rec.start();
    } catch { rec = null; }
  };
  mid.addEventListener('pointerdown', (e) => {
    if (S.bar === 'typing') return;
    e.preventDefault(); unlock();
    press = { y: e.clientY, cancelled: false, held: false, timer: setTimeout(() => { if (!press || !SR) return; press.held = true; setBar(barNext(S.bar, 'holdStart')); stopVoice(); startRec(); }, 150) };
    try { mid.setPointerCapture(e.pointerId); } catch {}
  });
  mid.addEventListener('pointermove', (e) => { if (press && press.held) { const up = press.y - e.clientY > 60; if (up !== press.cancelled) { press.cancelled = up; $('#hold span').textContent = up ? '松手取消' : '松手发送,上移取消'; } } });
  const release = () => {
    if (!press) return;
    clearTimeout(press.timer);
    if (press.held) { setBar(barNext(S.bar, press.cancelled ? 'holdCancel' : 'holdEnd')); if (rec) { try { rec.stop(); } catch {} } }
    else setBar(barNext(S.bar, 'tap'));
    const p = press; press = null;
    if (rec && p.cancelled) { const r = rec; rec = null; try { r.onend = null; r.abort(); } catch {} }
  };
  mid.addEventListener('pointerup', release);
  mid.addEventListener('pointercancel', release);
  mid.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- 调试:?step=<节>.<句> 停在某句(截图 / 测试用,不出声) ----
  const jumpTo = () => {
    const step = debug.get('step');
    if ((!step && !debug.get('stage')) || !S.sections.length) return;
    const [a, b] = (step || '0.0').split('.').map(Number);
    stopVoice();
    const sec = Math.min(Math.max(a || 0, 0), S.sections.length - 1);
    const line = Math.min(Math.max(b || 0, 0), Math.max(S.sections[sec].lines.length - 1, 0));
    S.state = { section: sec, line, status: 'paused' };
    for (let i = 0; i < sec; i++) paintAll(i);
    paintAll(sec, line);
    if (S.sections[sec].lines[line] && S.sections[sec].lines[line].ask && line === S.sections[sec].lines.length - 1 && sec === S.sections.length - 1) S.state.status = 'waiting';
    renderSubtitle();
    const tgt = S.sections[sec].lines[line] ? lineTarget(S.sections[sec].lines[line]) : null;
    const at = $('#board').querySelector('[data-sec="' + sec + '"] ' + (tgt === null ? '.c' : '[data-card="' + tgt + '"]'));
    if (at) at.scrollIntoView({ block: 'center', behavior: 'instant' });
    const st = debug.get('stage');
    if (st) { const [x, y] = st.split('.').map(Number); openStage(x || 0, y || 0); }
  };

  // ---- 启动与心跳:不通就头像灰,什么都不报 ----
  loadHome().then(() => {
    const open = debug.get('tutor');
    if (open && S.home) {
      const t = S.home.tutors.find((x) => x.name === open);
      if (t) {
        openTutor(t);
        // 调试:&new=1 新话题空白态;&hist=<日期>.<话题> 只读回放以前的;&panel=1 打开「以前的」面板
        setTimeout(() => {
          if (debug.get('new')) $('#new-btn').click();
          const hv = debug.get('hist');
          if (hv) { const [d, th] = hv.split('.'); switchThread(d, th); }
          if (debug.get('panel')) $('#hist-btn').click();
          jumpTo();
        }, 400);
      }
    }
  });
  setInterval(() => { if (S.tutor) { if (!S.pending) loadDay(true); } else loadHome(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) (S.tutor ? loadDay(true) : loadHome()); });
})();
</script>
</html>
`;

export const KID_PAGE = PAGE.replace('__BOARD_JS__', boardLibSource());
