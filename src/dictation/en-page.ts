/**
 * 英文单词听写(/dictation?lang=en):老师念一个单词(念两遍),孩子在四线三格里写整个单词;
 * 不会写点「给答案」,单词灰灰地打底,照着描一遍;全写完交卷,正确的单词淡淡叠在他写的上面,自己对——不逐字母比、不问「再写一遍?」,
 * 想再写自己点。从首页英语老师卡上的「单词听写」进来(?home=&n=),或者「拍照听写」(?tutor=&lang=en,拍课本认单词)。
 * 接口和汉字的一样(src/dictation/route.ts),会话带 lang = en、一个单词一格;笔迹的点记在 2048 × 512 的尺子上(en-box.ts)。
 * 孩子端:没有对错、没有分数、没有报错的字。用 String.raw:脚本里不写反斜杠转义与反引号。
 */
import { LAYER_X, TUTOR_FACE_CSS, TUTOR_FACE_JS } from '../server/tutor-face.ts';
import { KID_NAV_JS } from '../server/kid-nav.ts';
import { KID_LOG_JS } from '../server/kid-log.ts';
import { EN_BOX_CSS, EN_BOX_JS } from './en-box.ts';
import { UNLOCK_JS } from './unlock.ts';
import { REEL_MODE_JS } from './reel-mode.ts';
import { SNAP_CSS, snapHtml } from '../server/photo-ui.ts';
import { faviconLinks } from '../lib/favicon.ts';
import { BTN_CSS, BTN_JS, btn } from './ui.ts';

export const DICTATION_EN_PAGE = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
${faviconLinks()}
<title>单词听写</title>
<style>
  :root { --ink:#2b2b2b; --dim:#66625b; --line:#e2dfd6; --paper:#faf9f4; --card:#ffffff; --accent:#e8743b;
    /* 学科色:这次听写那位老师的颜色,页面读到老师后换(缺省英语绿);按钮、气泡、当前那格都跟它 */
    --sc:#1f8a4c; --green:var(--sc); --tutor:color-mix(in srgb, var(--sc) 10%, #fff); --tutor-line:color-mix(in srgb, var(--sc) 32%, #fff); --tutor-ink:color-mix(in srgb, var(--sc) 62%, #000); --tutor-ink2:color-mix(in srgb, var(--sc) 78%, #000); }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  [hidden] { display:none !important; }
  html,body { margin:0; min-height:100%; background:var(--paper); color:var(--ink); font:17px/1.5 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; overscroll-behavior:none; -webkit-user-select:none; user-select:none; }
  button, input { font:inherit; color:inherit; }
  button { cursor:pointer; }
  .view { display:none; flex-direction:column; gap:18px; max-width:1000px; margin:0 auto; padding:calc(env(safe-area-inset-top) + 10px) 20px calc(env(safe-area-inset-bottom) + 28px); }
  .view.on { display:flex; }
  .bar { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  /* 按钮两页同一份(ui.ts) */
${BTN_CSS}
  .ttl { font-size:22px; font-weight:700; }
  /* 写字屏:不限 1000 宽,四线格占满宽度(高度不够时按 16 : 7 收窄);听写本横排,一个单词一小条 */
  #v-write { max-width:none; gap:12px; height:100vh; height:100dvh; padding-bottom:calc(env(safe-area-inset-bottom) + 16px); }
  .wtop { flex-wrap:wrap; row-gap:8px; }
  .wbook { flex:1; min-width:0; height:56px; box-sizing:border-box; display:flex; align-items:center; gap:8px; padding:0 10px; background:#fff; border:1px solid var(--line); border-radius:18px; overflow-x:auto; }
  .wbook > b { flex:none; font-size:16px; padding-right:4px; }
  .wbook .bk { flex:none; display:flex; flex-direction:column; align-items:center; gap:2px; }
  .wbook .bk svg { width:92px; height:auto; aspect-ratio:16 / 7; display:block; background:#fff; border:1.5px solid var(--line); border-radius:6px; }
  .wbook .bk .enl line { stroke-width:12; }
  .wbook .bk .eni path { stroke-width:40; }
  .wbook .bk.c svg { border-color:var(--tutor-line); box-shadow:0 0 0 3px var(--tutor-line); }
  .wbook .bk.a { opacity:.55; }
  .wbook .bk small { display:none; }
  .wsay { flex:none; height:56px; box-sizing:border-box; padding:0 6px 0 14px; gap:10px; border-radius:28px; align-self:auto; }
  .wsay svg { width:22px; height:22px; flex:none; color:var(--tutor-ink); }
  .wsay b { font-size:16px; } .wsay small { font-size:13px; min-height:0; }
  .wsay .tool { min-height:44px; padding:0 16px; border-color:var(--tutor-line); }
  #v-write .model { flex:1; min-width:0; height:56px; display:flex; align-items:center; padding-left:6px; }
  #v-write .model .enm { height:56px; width:auto; max-width:100%; display:block; }
  /* 格子铺满剩下的高;看得到尺子的哪一段由 fitPad 按格子大小定 */
  #v-write .pad { flex:1 1 0; min-height:0; width:100%; height:auto; aspect-ratio:auto; margin:auto 0; }
  .wtools { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .wtools .tools { justify-content:flex-start; }
  .wtools .main { margin-left:auto; }
  .bubble { display:flex; align-items:center; gap:14px; padding:14px 22px; background:var(--tutor); border-radius:22px; border-top-left-radius:6px; align-self:flex-start; }
  .bubble b { display:block; font-size:22px; color:var(--tutor-ink); }
  .bubble small { display:block; font-size:15px; color:var(--tutor-ink2); min-height:22px; }
  .pad { width:100%; aspect-ratio:16 / 7; background:#fff; border:2px solid var(--line); border-radius:18px; touch-action:none; display:block; }
  .tools { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
  .center { display:flex; flex-direction:column; align-items:center; gap:18px; padding-top:40px; text-align:center; }
  .center b { font-size:28px; }
  .center span { color:var(--dim); }
  /* 对一对:不限 1000 宽,一行两格(窄了一格);格子上下留白后变高,一列只看得到一个半 */
  #v-check { max-width:none; }
  .rows { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 460px), 1fr)); gap:14px; }
  .row { background:#fff; border:1.5px solid var(--line); border-radius:18px; padding:12px; display:flex; flex-direction:column; gap:8px; }
  .row svg { width:100%; aspect-ratio:16 / 7; display:block; }
  .row .ft { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .row .ft small { color:var(--dim); font-size:14px; margin-right:auto; }
  .row .ft .em { font-size:30px; line-height:1; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { min-height:44px; padding:0 16px; border-radius:22px; border:1.5px solid var(--line); background:#fff; font-size:18px; }
  .chip.on { background:var(--tutor); border-color:var(--tutor-line); color:var(--tutor-ink); font-weight:600; }
  .add { display:flex; gap:8px; }
  .add input { flex:1; min-width:0; min-height:48px; padding:0 14px; border-radius:14px; border:1.5px solid var(--line); font-size:18px; -webkit-user-select:text; user-select:text; }
  .tool svg { width:22px; height:22px; flex:none; }
  /* 拍照屏同语文页(photo-ui.ts):中间老师的大头像、用途图、拍照 / 相册 */
  #v-snap { max-width:none; height:100vh; height:100dvh; padding-bottom:calc(env(safe-area-inset-bottom) + 16px); }
  ${SNAP_CSS}
  /* 选词屏同语文页:照片在左(框画在照片上,点框同点词),要写的单词在右,按钮在右下;竖着照片在上 */
  #p-list { flex:1; min-height:0; display:flex; gap:20px; }
  .shotwrap { flex:1; min-width:0; min-height:0; display:flex; align-items:center; justify-content:center; padding-top:48px; }
  .shotin { position:relative; display:inline-block; max-width:100%; border-radius:12px; overflow:hidden; background:#2b2b2b; }
  .shotin img { display:block; max-width:100%; max-height:calc(100vh - 100px); max-height:calc(100dvh - 100px); }
  .pside { width:340px; flex:none; min-height:0; display:flex; flex-direction:column; gap:12px; }
  .pscroll { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:12px; }
  .pgo { display:flex; gap:10px; }
  .pgo .main { flex:1; padding:0 16px; }
  @media (orientation: portrait) {
    #p-list { flex-direction:column; }
    .shotwrap { flex:none; }
    .shotin img { max-height:40vh; }
    .pside { width:auto; flex:1; }
  }
  .ebx { position:absolute; border-radius:6px; border:3px dashed rgba(120,115,105,.85); background:transparent; padding:0; cursor:pointer; }
  .ebx.on { border-style:solid; border-color:var(--green); background:color-mix(in srgb, var(--sc) 16%, transparent); }
  .ebx.unsure.on { border-color:var(--accent); background:rgba(232,116,59,.18); }
  .pgo { display:flex; justify-content:center; gap:12px; }
  .muted { color:var(--dim); font-size:15px; }
  #toast { position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom) + 24px); transform:translateX(-50%); padding:12px 18px; border-radius:16px; background:#2b2b2bee; color:#fff; font-size:16px; display:none; z-index:9; }
  #toast.on { display:block; }
  ${EN_BOX_CSS}
  ${TUTOR_FACE_CSS}
</style></head><body>
<div class="view" id="v-start">
  <div class="bar"><span class="bk-slot"></span></div>
  <div class="center"><b id="s-title">单词听写</b><span id="s-sub">老师念,你来写</span>${btn('main', 'start', '开始', 'id="s-go"')}</div>
</div>
<div class="view" id="v-snap">
  ${snapHtml({ kind: 'en', id: 'p-pick', cam: 'p-cam', lib: 'p-lib' })}
  <div id="p-list" hidden>
    <div class="shotwrap"><div class="shotin"><img id="p-img" alt="拍的照片"><div id="p-boxes"></div></div></div>
    <div class="pside">
      <div><div class="ttl" id="p-lesson">认一认</div><div class="muted" id="p-status">正在看照片…</div></div>
      <div class="pscroll">
        <div class="chips" id="p-chips"></div>
        <div class="muted">照片上还有这些,点一下加进来:</div>
        <div class="chips" id="p-more"></div>
        <div class="add"><input id="p-add" placeholder="自己加单词,空格分开" autocomplete="off" autocapitalize="off" spellcheck="false">${btn('tool', 'add', '加', 'id="p-add-go"')}</div>
      </div>
      <div class="pgo">${btn('tool', 'camera', '重拍', 'id="p-again"')}${btn('main', 'start', '开始听写', 'id="p-go" disabled')}</div>
    </div>
  </div>
</div>
<div class="view" id="v-write">
  <!-- 写字(iPad 实拍后放大):胶囊、听写本、气泡与再念并成一行,格子铺满中间,按钮一行 -->
  <div class="bar wtop"><span class="bk-slot"></span><div class="wbook" id="w-book"></div><div class="model" id="w-model" hidden></div>
    <div class="bubble wsay"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path></svg><div><b id="w-who">老师在念</b><small id="w-status"></small></div>${btn('tool', 'again', '再念', 'id="w-again"')}</div>
    <button class="layer-x" type="button" id="w-x" aria-label="回到对一对" hidden>${LAYER_X}</button></div>
  <svg class="pad" id="w-pad" viewBox="0 -192 2048 896"></svg>
  <div class="wtools">
    <div class="tools">
      ${btn('tool', 'undo', '撤销', 'id="w-undo"')}
      ${btn('tool', 'clear', '擦掉', 'id="w-clear"')}
      ${btn('tool reveal', 'reveal', '不会写,给答案', 'id="w-reveal"')}
    </div>
    ${btn('main', 'done', '写好了', 'id="w-done"')}
  </div>
</div>
<div class="view" id="v-check">
  <div class="bar"><span class="bk-slot"></span><span class="ttl">对一对</span>${btn('tool', 'overlay', '拿开蓝字', 'id="c-hide"')}</div>
  <div class="muted">蓝色的是书上的单词,看看你写的一样不一样。想再写哪个就点「再写一遍」。</div>
  <div class="rows" id="c-rows"></div>
  <div style="display:flex;justify-content:center">${btn('main', 'done', '对好了', 'id="c-done"')}</div>
</div>
<div class="view" id="v-submit">
  <div class="bar"><span class="bk-slot"></span></div>
  <div class="center"><b>都写完了</b><span>交上去,看看书上的单词</span>${btn('main', 'send', '交上去', 'id="u-go"')}</div>
</div>
<div id="toast"></div>
<script>
// 孩子端的流水(kid-log.ts):最先装上出错的监听
${KID_LOG_JS}
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var NS = 'http://www.w3.org/2000/svg';
  var sv = function (tag, attrs) { var el = document.createElementNS(NS, tag); for (var k in (attrs || {})) el.setAttribute(k, String(attrs[k])); return el; };
  var h = function (tag, attrs) { var el = document.createElement(tag); attrs = attrs || {}; for (var k in attrs) { if (k === 'on') { for (var ev in attrs.on) el.addEventListener(ev, attrs.on[ev]); } else if (k === 'text') el.textContent = attrs[k]; else if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]); } for (var i = 2; i < arguments.length; i++) if (arguments[i]) el.append(arguments[i]); return el; };
${BTN_JS}
  var api = function (method, path, body) { return fetch(path, { method: method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }); };
  var toastTimer = 0;
  var toast = function (t) { var el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2600); };
  ${EN_BOX_JS}
  var pathD = function (pts) { var d = 'M' + pts[0][0] + ' ' + pts[0][1]; if (pts.length === 1) d += ' L' + (pts[0][0] + 1) + ' ' + pts[0][1]; for (var i = 1; i < pts.length; i++) d += ' L' + pts[i][0] + ' ' + pts[i][1]; return d; };

  var q = new URLSearchParams(location.search);
  var HOME = q.get('home'); var N = Number(q.get('n') || 0); var TUTOR = q.get('tutor');
  /** 家长看录像时,这一页开在录像外壳的 iframe 里:只照记录画,不发事件、不念、点不动 */
  var REEL_ID = q.get('reel');
  // 录像里只记出错,不报打开
  kidLog.start({ page: 'dictation-en', mode: REEL_ID ? 'reel' : 'kid', ctx: function () { return { tutor: TUTOR || null }; } });
  var S = { v: null, base: Date.now(), i: 0, strokes: [], undos: 0, gone: [], revealed: false, word: null, sawPen: false, mode: 'first', hide: false, tok: 0, timer: 0 };
  var now = function () { return Math.max(0, Date.now() - S.base); };
  var setView = function (v) { var fresh = !S.v || S.v.id !== v.id; S.v = v; S.base = Date.parse(v.startedAt) || S.base; showFace(); if (fresh) { S.vw = 0; sendView(); } };
  var show = function (name) { var vs = document.querySelectorAll('.view'); for (var i = 0; i < vs.length; i++) vs[i].classList.toggle('on', vs[i].id === 'v-' + name); BACK.el.hidden = name === 'write' && S.mode === 'rewrite'; if (name === 'write') fitPad(); window.scrollTo(0, 0); if (!REEL_ID) guard(); };
  var event = function (kind, word, n, more) {
    if (!S.v || REEL_ID) return;
    var b = { kind: kind, word: word, t: now() }; if (n) b.n = n; if (more) { b.w = more.w; b.h = more.h; }
    if (kind !== 'show' && kind !== 'say' && kind !== 'again' && kind !== 'self' && kind !== 'rewrite' && kind !== 'view' && kind !== 'away' && kind !== 'back') b.char = 0;
    try { fetch('/api/dictation/' + S.v.id + '/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b), keepalive: true }).catch(function () {}); } catch (e) {}
  };
  /** 录像要的:屏幕多大(进来、转屏,停手 300 毫秒,变了才记)、切到别处 / 回来;擦掉的笔连同擦的时刻 */
  var viewTimer = 0;
  var sendView = function () { if (!S.v || S.v.done) return; var w = window.innerWidth, hh = window.innerHeight; if (w === S.vw && hh === S.vh) return; S.vw = w; S.vh = hh; event('view', S.i || 0, 0, { w: w, h: hh }); };
  window.addEventListener('resize', function () { clearTimeout(viewTimer); viewTimer = setTimeout(sendView, 300); });
  document.addEventListener('visibilitychange', function () { if (S.v && !S.v.done) event(document.hidden ? 'away' : 'back', S.i || 0); });
  var drop = function (pts) { if (S.gone.length < 200) S.gone.push({ t: now(), pts: pts }); };
  // 孩子端不往浏览器历史里加东西(kid-nav.ts):回首页是替换当前页
  ${KID_NAV_JS}
  var goHome = function () { stopSay(); kidGo('/'); };
  // ---- 左上角「‹ logo」胶囊,同老师页;再写一遍是叠在对一对上的一层,右上角 × 回去 ----
  ${TUTOR_FACE_JS}
  // 胶囊带上念的老师:服务端出页面时就按 ?tutor= 或首页那张卡的 reader 插进来(BACK_TUTOR),打开就是他的颜色和首字,不先浅底再变色;一位能念的老师都没有才是 null
  var BACK_TUTOR = __BACK_TUTOR__;
  var BACK = backCapsule(goHome); BACK.set(BACK_TUTOR); document.body.append(BACK.el);
  var TUTORS = null;
  var showFace = function () { var name = (S.v && S.v.tutorName) || TUTOR; if (!TUTORS || !name) return; var t = TUTORS.filter(function (x) { return x.name === name; })[0] || null; if (t) BACK.set(t); $('#snap-av').replaceChildren(t ? tutorAvatar(t) : ''); if (t && t.color) document.documentElement.style.setProperty('--sc', t.color); };

  // ---------- 念:配了音色放音频;没有音色、合成失败直接提示叫家长,不念浏览器合成声 ----------
  var audio = new Audio(); audio.preload = 'auto';
  ${UNLOCK_JS}
  var stopSay = function () { clearTimeout(S.timer); S.tok++; try { audio.pause(); } catch (e) {} };
  var NO_VOICE = '老师的声音还没配好 · 叫爸爸妈妈来看一下';
  var status = function (t) { $('#w-status').textContent = t; };
  var sayWord = function (i, times) {
    stopSay();
    if (S.v.voice === false) { status(NO_VOICE); return; }
    var tok = S.tok; var left = times; var nth = 0;
    var next = function () { if (tok !== S.tok) return; if (left <= 0) { status('听完了就写'); return; } left--; nth++; status('正在念 · 第 ' + nth + ' 遍'); event('say', i, nth); play(); };
    var gap = function () { if (tok !== S.tok) return; status(left > 0 ? '再听一遍' : '听完了就写'); if (left > 0) S.timer = setTimeout(next, 1600); };
    var mute = function () { if (tok === S.tok) status(NO_VOICE); };
    var play = function () {
      audio.onended = gap;
      audio.onerror = mute;
      audio.src = '/api/dictation/' + S.v.id + '/say/' + i;
      var pr = audio.play(); if (pr && pr.catch) pr.catch(function (e) { if (tok !== S.tok) return; if (audio.error) mute(); else if (blocked(e)) status('点「再念」听老师念'); });
    };
    next();
  };

  // ---------- 写:一个单词一格,四线三格 ----------
  var pad = $('#w-pad');
  var trace = sv('g', {}); var ink = sv('g', { 'class': 'eni' });
  pad.append(enLines(sv), trace, ink);
  var drawInk = function () { ink.replaceChildren.apply(ink, S.strokes.map(function (s) { return sv('path', { d: pathD(s) }); })); };
  var cur = null;
  /**
   * 格子铺满:四条线占格子高的 62%,横着起码看得到尺子上 1300 宽(grandmother 写得下),以单词中间(x 1024)、四条线中间(y 260)为准。
   * 只改看得到哪一段,尺子不变:存的点、对一对叠的字照旧对得上。PV = 现在的 viewBox
   */
  var PV = { x: 0, y: EN_TOP, w: EN_W, h: EN_VH };
  var fitPad = function () {
    pad.style.maxHeight = '';
    var b = pad.getBoundingClientRect(); if (!b.width || !b.height) return;
    // 竖着(iPad 竖放、手机)宽度先不够:格子只要四条线占 62% 的那么高,居中,别空出一大片
    if (b.width / 1300 < b.height * 0.62 / 360) { pad.style.maxHeight = Math.round(b.width / 1300 * 360 / 0.62) + 'px'; b = pad.getBoundingClientRect(); }
    var s = Math.min(b.height * 0.62 / 360, b.width / 1300);
    var w = Math.round(b.width / s), hh = Math.round(b.height / s);
    PV = { x: Math.round(1024 - w / 2), y: Math.round(260 - hh / 2), w: w, h: hh };
    pad.setAttribute('viewBox', [PV.x, PV.y, PV.w, PV.h].join(' '));
  };
  window.addEventListener('resize', function () { if ($('#v-write').classList.contains('on')) fitPad(); });
  var at = function (e) { var b = pad.getBoundingClientRect(); return [Math.round(PV.x + (e.clientX - b.left) / b.width * PV.w), Math.round(PV.y + (e.clientY - b.top) / b.height * PV.h), now()]; };
  pad.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'pen') S.sawPen = true; else if (e.pointerType === 'touch' && S.sawPen) return; // 用过笔就不认手掌
    e.preventDefault(); try { pad.setPointerCapture(e.pointerId); } catch (x) {}
    cur = { id: e.pointerId, pts: [at(e)] }; S.strokes.push(cur.pts); drawInk();
  });
  pad.addEventListener('pointermove', function (e) { if (!cur || e.pointerId !== cur.id) return; e.preventDefault(); cur.pts.push(at(e)); var p = ink.lastChild; if (p) p.setAttribute('d', pathD(cur.pts)); });
  var up = function (e) { if (cur && e.pointerId === cur.id) cur = null; };
  pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
  $('#w-undo').addEventListener('click', function () { if (S.strokes.length) { drop(S.strokes.pop()); S.undos++; drawInk(); } });
  $('#w-clear').addEventListener('click', function () { if (S.strokes.length) { S.strokes.forEach(drop); S.strokes = []; S.undos++; drawInk(); } });
  $('#w-again').addEventListener('click', function () { event('again', S.i); sayWord(S.i, 1); });
  $('#w-reveal').addEventListener('click', function () {
    var i = S.i; var b = $('#w-reveal'); b.disabled = true;
    api('POST', '/api/dictation/' + S.v.id + '/reveal/' + i, { char: 0, t: now() }).then(function (j) {
      if (S.i !== i) return;
      S.revealed = true; S.strokes.forEach(drop); S.strokes = []; drawInk();
      trace.replaceChildren(enWord(sv, j.ch, 'enw trace', PV.w - 120));
      status('照着灰色的单词写一遍');
    }, function () { b.disabled = false; toast('没连上,再点一次'); });
  });
  /** 横排的听写本:一个单词一小条四线格,写过的画上孩子的笔,当前那条学科色描边;inkOf(k) 回写过的笔(没写回 null) */
  var renderBook = function (cur, inkOf) {
    var box = $('#w-book'); box.replaceChildren(h('b', {}, '听写本'));
    var here = null;
    for (var k = 0; k < S.v.sizes.length; k++) {
      var ink = inkOf(k), svg = sv('svg', { viewBox: EN_VIEW }), g = sv('g', { 'class': 'eni' });
      (ink || []).forEach(function (st) { if (st.length) g.append(sv('path', { d: pathD(st) })); });
      svg.append(enLines(sv), g);
      var el = h('div', { 'class': 'bk ' + (k === cur ? 'c' : ink ? 'd' : 'a') }, svg, h('small', {}, String(k + 1)));
      if (k === cur) here = el;
      box.append(el);
    }
    if (here && here.scrollIntoView) here.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  var mineOf = function (k) { var m = S.v.mine && S.v.mine[k]; return m && m[0] ? m[0].strokes : null; };
  var openWord = function (i) {
    S.i = i; S.strokes = []; S.undos = 0; S.gone = []; S.revealed = false; S.mode = 'first';
    trace.replaceChildren(); drawInk(); $('#w-model').hidden = true;
    $('#w-who').textContent = (S.v.tutor || '老师') + '念第 ' + (i + 1) + ' 个';
    $('#w-reveal').disabled = false; $('#w-reveal').hidden = false; $('#w-done').disabled = false; $('#w-x').hidden = true;
    $('#w-book').hidden = false; renderBook(i, mineOf); show('write'); event('show', i); sayWord(i, 2);
  };
  var nextWord = function () { for (var k = 0; k < S.v.written.length; k++) if (!S.v.written[k]) return openWord(k); stopSay(); show('submit'); };
  $('#w-done').addEventListener('click', function () {
    if (S.revealed && !S.strokes.length) { status('照着灰色的单词写一遍'); return; }
    var i = S.i; var b = $('#w-done'); b.disabled = true;
    var chars = [{ strokes: S.strokes, undos: S.undos, gone: S.gone.length ? S.gone : undefined, revealed: S.revealed || undefined }];
    if (S.mode === 'rewrite') {
      api('POST', '/api/dictation/' + S.v.id + '/rewrites/' + i, { chars: chars, self: true }).then(function (v) { setView(v); stopSay(); openCheck(); }, function () { b.disabled = false; toast('没连上,再点一次'); });
      return;
    }
    api('PUT', '/api/dictation/' + S.v.id + '/first/' + i, { chars: chars }).then(function () { event('done', i); S.v.written[i] = true; S.v.mine = S.v.mine || []; S.v.mine[i] = [{ strokes: S.strokes }]; nextWord(); }, function () { b.disabled = false; toast('没连上,再点一次'); });
  });

  // ---------- 交卷、对一对 ----------
  $('#u-go').addEventListener('click', function () { var b = $('#u-go'); b.disabled = true; api('POST', '/api/dictation/' + S.v.id + '/check').then(function (v) { setView(v); openCheck(); }, function () { b.disabled = false; toast('没连上,再点一次'); }); });
  var openCheck = function () {
    var rows = $('#c-rows'); rows.replaceChildren();
    S.v.answers.forEach(function (a, i) {
      var svg = sv('svg', { viewBox: EN_VIEW }); var g = sv('g', { 'class': 'eni' });
      (a.ink[0] || []).forEach(function (s) { if (s.length) g.append(sv('path', { d: pathD(s) })); });
      svg.append(enLines(sv), g); if (!S.hide) svg.append(enWord(sv, a.chars));
      var again = h('button', { 'class': 'tool', type: 'button', on: { click: function () { rewrite(i); } } }, ico('write'), lbl('再写一遍'));
      // emoji 只在对一对出:写的时候看不到,写完了当个提示放在这一行的左下
      rows.append(h('div', { 'class': 'row' }, svg, h('div', { 'class': 'ft' }, a.emoji ? h('span', { 'class': 'em', text: a.emoji }) : null, h('small', { text: (i + 1) + (a.revealed ? ' · 看了答案,照着写的' : a.rewrote ? ' · 又写了一遍' : '') }), again)));
    });
    show('check');
  };
  $('#c-hide').addEventListener('click', function () { S.hide = !S.hide; $('#c-hide span').textContent = S.hide ? '叠上蓝字' : '拿开蓝字'; openCheck(); });
  var rewrite = function (i) {
    event('self', i);
    S.i = i; S.strokes = []; S.undos = 0; S.gone = []; S.revealed = false; S.mode = 'rewrite';
    trace.replaceChildren(); drawInk();
    var m = $('#w-model'); m.replaceChildren(enModel(sv, S.v.answers[i].chars)); m.hidden = false;
    $('#w-who').textContent = '再写一遍'; status('看着上面的单词写'); $('#w-reveal').hidden = true; $('#w-done').disabled = false;
    $('#w-book').hidden = true; $('#w-x').hidden = false; show('write'); sayWord(i, 1);
  };
  $('#w-x').addEventListener('click', function () { event('close', S.i); stopSay(); S.mode = 'first'; openCheck(); });
  $('#c-done').addEventListener('click', function () { api('POST', '/api/dictation/' + S.v.id + '/done').then(goHome, goHome); });

  // ---------- 开始 ----------
  var begin = function (v) {
    setView(v);
    if (v.checked) return openCheck();
    $('#s-title').textContent = '单词听写 · ' + v.sizes.length + ' 个单词';
    var wrote = v.written.filter(Boolean).length;
    $('#s-sub').textContent = v.voice === false ? NO_VOICE : wrote ? '写到第 ' + (wrote + 1) + ' 个了' : (v.tutor || '老师') + '念,你来写';
    $('#s-go span').textContent = wrote ? '接着写' : '开始';
    $('#s-go').hidden = v.voice === false;
    show('start');
  };
  $('#s-go').addEventListener('click', function () { nextWord(); });

  // ---------- 拍照开始:拍 → 一项一项认出来 → 点选 → 开始 ----------
  var P = { id: null, items: [], on: {}, extra: [], timer: 0, rec: null, url: null };
  var shrink = function (file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file); var im = new Image();
      im.onload = function () { var k = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight)); var c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85)); };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('x')); };
      im.src = url;
    });
  };
  var WORD = /^[A-Za-z][A-Za-z'-]*$/;
  var chosen = function () { var out = []; P.items.forEach(function (it) { if (P.on[it.text]) out.push({ chars: it.text, say: it.say || undefined, emoji: it.emoji || undefined }); }); P.extra.forEach(function (w) { if (P.on[w] && !out.some(function (x) { return x.chars === w; })) out.push({ chars: w }); }); return out.slice(0, 20); };
  var drawChips = function (rec) {
    if (rec) P.rec = rec; else rec = P.rec;
    drawBoxes();
    var mk = function (w) { return h('button', { 'class': 'chip' + (P.on[w] ? ' on' : ''), type: 'button', on: { click: function () { P.on[w] = !P.on[w]; drawChips(rec); } } }, w); };
    $('#p-chips').replaceChildren.apply($('#p-chips'), P.items.map(function (it) { return mk(it.text); }).concat(P.extra.map(mk)));
    var seen = {}; P.items.forEach(function (it) { seen[it.text.toLowerCase()] = 1; }); P.extra.forEach(function (w) { seen[w.toLowerCase()] = 1; });
    var more = []; (rec && rec.full || []).forEach(function (l) { l.split(' ').forEach(function (w) { if (WORD.test(w) && w.length > 1 && !seen[w.toLowerCase()]) { seen[w.toLowerCase()] = 1; more.push(w); } }); });
    $('#p-more').replaceChildren.apply($('#p-more'), more.slice(0, 40).map(function (w) { return h('button', { 'class': 'chip', type: 'button', on: { click: function () { P.extra.push(w); P.on[w] = true; drawChips(rec); } } }, w); }));
    var n = chosen().length; $('#p-go').disabled = !n; $('#p-go').textContent = n ? '开始听写 · ' + n + ' 个' : '开始听写';
  };
  var drawBoxes = function () {
    var box = $('#p-boxes');
    box.replaceChildren.apply(box, P.items.filter(function (it) { return it.box; }).map(function (it) {
      var b = h('button', { 'class': 'ebx' + (P.on[it.text] ? ' on' : '') + (it.sure === false ? ' unsure' : ''), type: 'button', 'aria-label': it.text, on: { click: function () { P.on[it.text] = !P.on[it.text]; drawChips(null); } } });
      b.style.left = it.box[0] / 10 + '%'; b.style.top = it.box[1] / 10 + '%'; b.style.width = (it.box[2] - it.box[0]) / 10 + '%'; b.style.height = (it.box[3] - it.box[1]) / 10 + '%';
      return b;
    }));
  };
  var poll = function () {
    var id = P.id;
    api('GET', '/api/dictation/photos/' + id).then(function (rec) {
      if (P.id !== id) return;
      rec.items.forEach(function (it) { if (!P.items.some(function (x) { return x.text === it.text; })) { P.items.push(it); P.on[it.text] = it.pick; } });
      if (rec.lesson) $('#p-lesson').textContent = rec.lesson;
      $('#p-status').textContent = rec.state === 'running' ? '正在看照片…' : P.items.length ? '点照片上的框或单词,选上或去掉' : '没认出单词,自己打上也行';
      drawChips(rec);
      if (rec.state === 'running') P.timer = setTimeout(poll, 700);
    }, function () { if (P.id === id) P.timer = setTimeout(poll, 1500); });
  };
  var onFile = function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    $('#p-pick').hidden = true; $('#p-list').hidden = false; showResume(null);
    P.url = URL.createObjectURL(f); $('#p-img').src = P.url; $('#p-lesson').textContent = '认一认'; $('#p-status').textContent = '正在看照片…';
    shrink(f).then(function (data) { return api('POST', '/api/dictation/photos', { image: data, lang: 'en' }); }).then(function (j) { P.id = j.id; poll(); }, function () { $('#p-status').textContent = '没看成,自己打上单词也行'; });
  };
  $('#p-cam').addEventListener('change', onFile); $('#p-lib').addEventListener('change', onFile);
  $('#p-again').addEventListener('click', function () {
    clearTimeout(P.timer); if (P.url) URL.revokeObjectURL(P.url);
    P = { id: null, items: [], on: {}, extra: [], timer: 0, rec: null, url: null };
    $('#p-cam').value = ''; $('#p-lib').value = ''; $('#p-img').removeAttribute('src'); $('#p-boxes').replaceChildren(); $('#p-chips').replaceChildren(); $('#p-more').replaceChildren();
    $('#p-list').hidden = true; $('#p-pick').hidden = false; $('#p-go').disabled = true; $('#p-go').textContent = '开始听写'; findResume();
  });
  $('#p-add-go').addEventListener('click', function () { var inp = $('#p-add'); inp.value.split(/ +/).forEach(function (w) { w = w.trim(); if (WORD.test(w) && w.length <= 20 && P.extra.indexOf(w) < 0) { P.extra.push(w); P.on[w] = true; } }); inp.value = ''; drawChips(null); });
  $('#p-go').addEventListener('click', function () {
    var b = $('#p-go'); b.disabled = true; clearTimeout(P.timer);
    var body = { photo: P.id, words: chosen(), lang: 'en' }; if (TUTOR) body.tutor = TUTOR;
    if (!P.id) { toast('先拍一张'); b.disabled = false; return; }
    api('POST', '/api/dictation', body).then(begin, function () { b.disabled = false; toast('没连上,再点一次'); });
  });

  api('GET', '/api/kid/home').then(function (j) { TUTORS = j.tutors || []; showFace(); }, function () {});
  /** 今天这位老师没写完(没点「对好了」)的拍照听写,拍照屏最上面给「接着写」;会话先读好,点下去在手势里直接念 */
  var ymdOf = function (d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  var R = { v: null };
  var showResume = function (v) {
    R.v = v;
    $('#snap-resume').hidden = !v;
    $('#snap-cam-btn').classList.toggle('alt', Boolean(v));
    if (!v) return;
    var wrote = v.written.filter(Boolean).length;
    $('#snap-resume-sub').textContent = v.checked || wrote === v.sizes.length ? '写完了,还没对一对' : '写到第 ' + (wrote + 1) + ' 个了 · 一共 ' + v.sizes.length + ' 个';
  };
  var findResume = function () {
    var today = ymdOf(new Date());
    api('GET', '/api/dictation').then(function (j) {
      var x = (j.sessions || []).filter(function (s) { return s.photo && !s.done && s.lang === 'en' && (!TUTOR || s.tutor === TUTOR) && ymdOf(new Date(s.startedAt)) === today; })[0];
      if (!x) return;
      return api('GET', '/api/dictation/' + x.id + '/kid').then(function (v) { if ($('#v-snap').classList.contains('on') && !$('#p-pick').hidden) showResume(v); });
    }).catch(function () {});
  };
  $('#snap-resume-go').addEventListener('click', function () { var v = R.v; if (!v) return; showResume(null); setView(v); if (v.checked) openCheck(); else nextWord(); });

  // ---------- 录像(?reel=<id>):照记录用这一页的画法画;钟、把手、启动在 reel-mode.ts ----------
  ${REEL_MODE_JS}
  /** 一组笔这一刻的样子:点数变了才重画 */
  var reelPaths = function (o, g, strokes) {
    var n = 0; strokes.forEach(function (x) { n += x.length; });
    var sig = strokes.length + ':' + n;
    if (o.sig === sig) return;
    o.sig = sig;
    g.replaceChildren.apply(g, strokes.filter(function (x) { return x.length; }).map(function (x) { return sv('path', { d: pathD(x) }); }));
  };
  var reelDraw = function (f) {
    var R = RL.r;
    var view = f.view === 'check' || f.view === 'order' ? 'check' : f.view === 'rewrite' && f.open ? 'rewrite' : f.allDone ? 'submit' : 'write';
    var done = R.rewrites.filter(function (x) { return x.to <= RL.t; }).length;
    var wi = view === 'rewrite' ? f.open.word : f.word;
    var key = [view, wi, view === 'write' && f.mode !== 'write' ? 't' : '', view === 'check' ? done : 0, window.innerWidth, window.innerHeight].join('|');
    var rebuild = key !== RL.key; RL.key = key;
    if (view === 'submit') { if (rebuild) show('submit'); return; }
    if (view === 'check') {
      if (rebuild) {
        var rows = $('#c-rows'); rows.replaceChildren();
        RL.rows = R.chars.map(function (cs, i) {
          var svg = sv('svg', { viewBox: EN_VIEW }); var g = sv('g', { 'class': 'eni' });
          svg.append(enLines(sv), g, enWord(sv, cs[0]));
          var a = RL.s.first[i]; var rv = Boolean(a && a.chars[0] && a.chars[0].revealed);
          var rw = R.rewrites.some(function (x) { return x.word === i && x.to <= RL.t; });
          rows.append(h('div', { 'class': 'row' }, svg, h('div', { 'class': 'ft' }, h('small', { text: (i + 1) + (rv ? ' · 看了答案,照着写的' : rw ? ' · 又写了一遍' : '') }), h('button', { 'class': 'tool', type: 'button' }, ico('write'), lbl('再写一遍')))));
          return { g: g, sig: '' };
        });
        S.mode = 'first'; show('check');
      }
      RL.rows.forEach(function (o, i) { reelPaths(o, o.g, f.latest[i][0] || []); });
      return;
    }
    if (rebuild) {
      S.mode = view === 'rewrite' ? 'rewrite' : 'first'; S.i = wi;
      show('write');
      trace.replaceChildren(); if (view === 'write' && f.mode !== 'write') trace.append(enWord(sv, R.chars[wi][0], 'enw trace', PV.w - 120));
      var m = $('#w-model'); m.hidden = view !== 'rewrite'; if (view === 'rewrite') m.replaceChildren(enModel(sv, R.chars[wi][0])); else m.replaceChildren();
      $('#w-who').textContent = view === 'rewrite' ? '再写一遍' : (S.v.tutor || '老师') + '念第 ' + (wi + 1) + ' 个';
      $('#w-reveal').hidden = view === 'rewrite'; $('#w-reveal').disabled = view === 'write' && f.mode !== 'write';
      $('#w-x').hidden = view !== 'rewrite';
      $('#w-book').hidden = view !== 'write';
      if (view === 'write') renderBook(wi, function (k) { var x = k < wi && f.ink[k] && f.ink[k][0]; return x && x.length ? x : null; });
      RL.inkO = { sig: '' };
    }
    reelPaths(RL.inkO, ink, view === 'rewrite' ? (f.rewrite && f.rewrite[0]) || [] : f.ink[wi][0]);
    status(view === 'rewrite' ? '看着上面的单词写' : f.mode !== 'write' ? '照着灰色的单词写一遍' : f.say ? '正在念 · 第 ' + f.say.n + ' 遍' : f.said === 1 ? '再听一遍' : f.said > 1 ? '听完了就写' : '');
  };

  if (REEL_ID) reelBoot();
  else if (HOME) api('POST', '/api/dictation', { home: HOME, n: N }).then(begin, goHome);
  else { show('snap'); $('#p-list').hidden = true; findResume(); }
})();
</script>
</body></html>
`;
