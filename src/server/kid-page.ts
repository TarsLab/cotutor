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
 * 交互逻辑在 ../lib/kid-board.ts(纯函数,有测试),这里把它剥掉类型内联进页面,两处一份源码。
 * __TITLE__ 由路由替换。调试:`?step=<节>.<句>` 直接停在某句(标注画齐、不出声),截图与测试用。
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
<title>__TITLE__</title>
<style>
  :root { --paper:#f6f4ee; --ink:#2b2b2b; --dim:#8a8781; --line:#e2dfd6; --card:#fffdf8; --kid:#dbeeff; --tutor:#fff3d6; --accent:#e8743b; --hi:#ffe3a8; --blue:#eef4ff; --cream:#f7f1e3; --ok:#e8f6ee; --ok-ink:#1f8a4c; --purple:#efe9fb; --purple-ink:#7a4fc9; --grey:#eeece6; }
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
  #board { flex:1; min-height:0; overflow:auto; padding:14px 16px 24px; display:flex; flex-direction:column; gap:12px; -webkit-overflow-scrolling:touch; scroll-behavior:smooth; }
  .sec { display:contents; }
  .c { border-radius:16px; padding:14px 16px; background:var(--card); font-size:16px; line-height:1.55; -webkit-user-select:text; user-select:text; }
  .c-cover { position:relative; min-height:150px; background:linear-gradient(135deg,#d9cfb8,#8e9c8a); color:#fff; display:flex; flex-direction:column; justify-content:flex-end; gap:2px; text-shadow:0 1px 6px #00000066; }
  .c-cover .t { font-size:24px; font-weight:700; } .c-cover .s { font-size:13px; opacity:.9; }
  .c-oneline { background:var(--blue); display:flex; flex-direction:column; gap:8px; align-items:center; }
  .tag { display:inline-flex; align-items:center; gap:5px; padding:2px 10px; border-radius:12px; background:var(--tutor); font-size:12px; font-weight:600; }
  .c-oneline .big { font-size:20px; font-weight:600; text-align:center; line-height:1.5; }
  .c-section { background:none; padding:4px 0 0; font-size:18px; font-weight:700; }
  .c-types { background:none; padding:0; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
  .tp { display:flex; flex-direction:column; align-items:center; gap:4px; padding:14px 10px; border-radius:14px; background:var(--blue); text-align:center; }
  .tp-n { font-size:15px; font-weight:700; color:#2f5aa8; } .tp-s { font-size:12px; color:var(--dim); }
  .c-fact { background:var(--blue); font-size:15px; }
  .c-list { background:var(--cream); display:flex; flex-direction:column; gap:8px; font-size:15px; }
  .c-image, .c-figure { background:none; padding:0; display:flex; flex-direction:column; align-items:center; gap:6px; }
  .ph { width:100%; height:120px; border-radius:12px; background:var(--blue); display:grid; place-items:center; color:#8fa7cc; }
  .cap { font-size:12px; color:var(--dim); }
  .c-quote { background:var(--cream); font-style:italic; text-align:center; color:#5a5650; }
  .c-check { background:none; padding:0; display:flex; flex-direction:column; gap:8px; }
  .ck { display:flex; gap:10px; align-items:center; padding:10px 14px; border-radius:12px; background:var(--blue); font-size:15px; }
  .ck-b { flex:0 0 auto; width:20px; height:20px; border-radius:5px; background:var(--ok-ink); color:#fff; display:grid; place-items:center; font-size:13px; font-weight:700; }
  .c-think { background:var(--blue); display:flex; flex-direction:column; align-items:center; gap:8px; text-align:center; cursor:pointer; }
  .th-l { font-size:13px; font-weight:700; color:#2f5aa8; } .th-q { font-size:17px; font-weight:600; padding:6px 4px; }
  .th-b { display:none; font-size:16px; padding:6px 4px; }
  .th-h { border-top:1px solid var(--line); width:100%; padding-top:8px; font-size:13px; color:var(--dim); }
  .c-think.flip .th-q { display:none; } .c-think.flip .th-b { display:block; }
  .c-problem { background:var(--grey); } .c-problem .pb-l { font-size:15px; font-weight:700; }
  .c-core { background:var(--ok); } .co-t { font-size:15px; font-weight:700; color:var(--ok-ink); }
  .c-formula { background:none; text-align:center; font-family:"Times New Roman","Songti SC",serif; font-size:18px; }
  .c-calc { background:var(--purple); } .ca-t { font-size:15px; font-weight:700; color:var(--purple-ink); } .ca-f { text-align:center; font-family:"Times New Roman","Songti SC",serif; font-size:18px; }
  .c-text { background:var(--tutor); font-size:18px; }
  /* 笔 */
  .mk-marker { background:var(--hi); padding:0 3px; border-radius:3px; }
  .mk-wave { text-decoration:underline wavy var(--accent); text-underline-offset:4px; }
  .mk-box { border:2px solid var(--purple-ink); border-radius:4px; padding:0 3px; }
  .mk-green { background:#cdeed9; padding:0 3px; border-radius:3px; }
  .mk-circle { position:relative; display:inline-block; padding:0 2px; }
  .mk-circle::after { content:""; position:absolute; left:-6px; right:-6px; top:-4px; bottom:-4px; border:2.5px solid var(--ok-ink); border-radius:50%; transform:rotate(-3deg); }
  .mk { animation:pen .35s ease-out; }
  @keyframes pen { from { opacity:0; } to { opacity:1; } }
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
    .c-cover, .c-section, .c-problem, .c-oneline, .c-types { grid-column:1 / -1; }
    .c-figure { grid-row:span 3; }
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
      <button class="hb on" id="spk" type="button"></button>
    </header>
    <div id="board"></div>
    <div id="sub"><span id="sub-text"></span><button id="sub-btn" type="button" hidden></button></div>
    <div id="bar">
      <div id="pill">
        <label class="ic" id="cam"><input type="file" accept="image/*" capture="environment"></label>
        <div id="mid"><span id="ph">发消息或按住说话…</span><input id="typed" type="text" autocomplete="off" hidden></div>
        <button id="go" type="button" hidden></button>
        <button class="ic" id="plus" type="button"></button>
      </div>
    </div>
    <div id="hold"><span>松手发送,上移取消</span><div class="w"></div></div>
  </div>
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
  const S = { home: null, tutor: null, day: null, sections: [], played: new Set(), state: { section: -1, line: -1, status: 'idle' }, echo: null, echoTimer: null, pending: false, limit: false, offline: false, autoplay: true, bar: 'idle', pollTimer: null };
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
      audioEl.src = '/api/audio/' + S.tutor.name + '/' + encodeURIComponent(line.audio);
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
    S.tutor = t; S.sections = []; S.played = new Set(); S.state = { section: -1, line: -1, status: 'idle' }; S.echo = null; S.pending = false; S.limit = false;
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

  // 卡片
  const renderCard = (c, idx) => {
    const box = (cls, ...kids) => h('div', { class: 'c c-' + cls, 'data-card': idx }, ...kids);
    switch (c.type) {
      case 'cover': return box('cover', h('span', { class: 't' }, c.title), c.subtitle ? h('span', { class: 's' }, c.subtitle) : null);
      case 'oneline': return box('oneline', h('span', { class: 'tag' }, '一句话看懂'), h('div', { class: 'big' }, c.text));
      case 'section': return box('section', c.title);
      case 'types': return box('types', ...c.items.map((i) => h('div', { class: 'tp' }, h('span', { class: 'tp-n' }, i.name), i.note ? h('span', { class: 'tp-s' }, i.note) : null)));
      case 'fact': return box('fact', c.text);
      case 'list': return box('list', ...c.items.map((i) => h('div', { class: 'li' }, h('b', {}, i.lead), i.text ? ':' + i.text : '')));
      case 'image': return box('image', h('div', { class: 'ph', html: ICON.image }), h('span', { class: 'cap' }, c.caption));
      case 'figure': return box('figure', h('div', { class: 'ph', style: 'height:220px', html: ICON.image }), c.caption ? h('span', { class: 'cap' }, c.caption) : null);
      case 'quote': return box('quote', '「' + c.text + '」');
      case 'checklist': return box('check', ...c.items.map((t) => h('div', { class: 'ck' }, h('span', { class: 'ck-b' }, '✓'), t)));
      case 'think': { const el = box('think', h('span', { class: 'th-l' }, '想一想'), h('div', { class: 'th-q' }, c.question), h('div', { class: 'th-b' }, c.back || ''), h('div', { class: 'th-h' }, c.back ? '点一下翻面看' : '')); if (c.back) el.addEventListener('click', () => el.classList.toggle('flip')); return el; }
      case 'problem': return box('problem', h('div', { class: 'pb-l' }, '题目:'), h('div', {}, c.text));
      case 'core': return box('core', h('div', { class: 'co-t' }, c.title || '核心操作'), h('div', {}, c.text));
      case 'formula': return box('formula', c.text);
      case 'calc': return box('calc', h('div', { class: 'ca-t' }, c.title), h('div', { class: 'ca-f' }, c.text));
      default: return box('text', c.text || '');
    }
  };
  const renderSection = (s, i) => h('div', { class: 'sec', 'data-sec': i }, ...s.cards.map(renderCard));
  const applyMark = (secIdx, mark) => {
    const sec = $('#board').querySelector('[data-sec="' + secIdx + '"]');
    const card = sec && sec.querySelector('[data-card="' + mark.card + '"]');
    if (!card) return null;
    const type = S.sections[secIdx].cards[mark.card].type;
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = n.nodeValue.indexOf(mark.phrase);
      if (i < 0 || n.parentElement.classList.contains('mk')) continue;
      const range = document.createRange(); range.setStart(n, i); range.setEnd(n, i + mark.phrase.length);
      const span = document.createElement('span'); span.className = 'mk mk-' + markStyle(type);
      range.surroundContents(span);
      return card;
    }
    return card;
  };
  const renderSubtitle = () => {
    const v = subtitleFor({ state: S.state, sections: S.sections, echo: S.echo, pending: S.pending, thinking: (S.tutor && S.tutor.thinking) || '让我想想…', limit: S.limit });
    const t = $('#sub-text'); t.textContent = v.text; t.className = v.kind;
    const b = $('#sub-btn');
    b.hidden = v.right === 'none';
    b.className = v.right === 'continue' ? 'cont' : '';
    b.innerHTML = v.right === 'pause' ? ICON.pause : v.right === 'play' ? ICON.play : v.right === 'continue' ? ICON.play + '<span>继续</span>' : '';
    document.body.classList.toggle('pending', S.pending);
    document.body.classList.toggle('limit', S.limit);
  };
  $('#sub-btn').addEventListener('click', () => {
    if (S.state.status === 'playing') { stopVoice(); S.state = { ...S.state, status: 'paused' }; renderSubtitle(); }
    else if (S.state.status === 'paused') { S.state = { ...S.state, status: 'playing' }; playLine(); }
    else if (S.state.status === 'waiting') send('继续', { echo: false });
  });

  // 播放:一句 = 字幕 + 标注 + 滚到那张卡 + 声音;播完往下走
  const playLine = () => {
    const s = S.sections[S.state.section]; const line = s && s.lines[S.state.line];
    if (!line) { S.state = { ...S.state, status: 'done' }; renderSubtitle(); return; }
    renderSubtitle();
    let target = null;
    for (const m of line.marks) target = applyMark(S.state.section, m) || target;
    if (!target) target = $('#board').querySelector('[data-sec="' + S.state.section + '"] .c');
    if (target) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    say(line, () => { if (S.state.status !== 'playing') return; S.state = advance(S.state, S.sections); if (S.state.status === 'playing') playLine(); else renderSubtitle(); });
  };
  /** 把一节的标注一次画齐(打开页面、不出声时) */
  const paintAll = (secIdx, upTo) => { const s = S.sections[secIdx]; if (!s) return; for (const l of s.lines.slice(0, upTo === undefined ? s.lines.length : upTo + 1)) for (const m of l.marks) applyMark(secIdx, m); };

  const loadDay = async (silent) => {
    if (!S.tutor) return;
    try {
      const d = await api('GET', '/api/kid/conversations/' + S.tutor.name + '/today');
      setOffline(false);
      S.day = d;
      S.limit = d.remaining <= 0;
      const entries = sectionsFromMessages(d.messages);
      const fresh = [];
      for (const e of entries) if (!S.played.has(e.job)) { S.played.add(e.job); S.sections.push(e); fresh.push(S.sections.length - 1); $('#board').append(renderSection(e, S.sections.length - 1)); }
      const stillPending = Boolean(d.pending) || d.messages.some((m) => m.pending);
      S.pending = stillPending;
      if (fresh.length) {
        if (silent || !S.autoplay) { for (const i of fresh) paintAll(i); S.state = playerAtEnd(S.sections); renderSubtitle(); const last = $('#board').querySelector('[data-sec="' + (S.sections.length - 1) + '"] .c'); if (last) last.scrollIntoView({ block: 'start' }); }
        else { stopVoice(); S.state = startSection(fresh[0], S.sections); if (S.state.status === 'playing') playLine(); else renderSubtitle(); }
      } else renderSubtitle();
      clearTimeout(S.pollTimer);
      if (stillPending) S.pollTimer = setTimeout(() => loadDay(false), 1500);
    } catch (e) {
      if (e && e.status === 404) return closeTutor();
      setOffline(true);
    }
  };
  const showEcho = (text) => { clearTimeout(S.echoTimer); S.echo = text; renderSubtitle(); S.echoTimer = setTimeout(() => { S.echo = null; renderSubtitle(); }, 2500); };
  const send = async (text, opts = {}) => {
    text = (text || '').trim();
    if (!text || !S.tutor || S.limit) return;
    unlock();
    stopVoice();
    if (S.state.status === 'playing' || S.state.status === 'paused') S.state = { ...S.state, status: 'done' };
    if (opts.echo !== false) showEcho('你:' + text);
    S.pending = true; renderSubtitle();
    try {
      await api('POST', '/api/kid/conversations/' + S.tutor.name + '/messages', { text });
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
    if (!step || !S.sections.length) return;
    const [a, b] = step.split('.').map(Number);
    stopVoice();
    const sec = Math.min(Math.max(a || 0, 0), S.sections.length - 1);
    const line = Math.min(Math.max(b || 0, 0), Math.max(S.sections[sec].lines.length - 1, 0));
    S.state = { section: sec, line, status: 'paused' };
    for (let i = 0; i < sec; i++) paintAll(i);
    paintAll(sec, line);
    if (S.sections[sec].lines[line] && S.sections[sec].lines[line].ask && line === S.sections[sec].lines.length - 1 && sec === S.sections.length - 1) S.state.status = 'waiting';
    renderSubtitle();
    const marks = (S.sections[sec].lines[line] || {}).marks || [];
    const at = marks.length ? $('#board').querySelector('[data-sec="' + sec + '"] [data-card="' + marks[marks.length - 1].card + '"]') : $('#board').querySelector('[data-sec="' + sec + '"] .c');
    if (at) at.scrollIntoView({ block: 'center' });
  };

  // ---- 启动与心跳:不通就头像灰,什么都不报 ----
  loadHome().then(() => {
    const open = debug.get('tutor');
    if (open && S.home) { const t = S.home.tutors.find((x) => x.name === open); if (t) { openTutor(t); setTimeout(jumpTo, 400); } }
  });
  setInterval(() => { if (S.tutor) { if (!S.pending) loadDay(true); } else loadHome(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) (S.tutor ? loadDay(true) : loadHome()); });
})();
</script>
</html>
`;

export const KID_PAGE = PAGE.replace('__BOARD_JS__', boardLibSource());
