/**
 * 英文单词听写(/dictation?lang=en,《wip/听写设想.md》拍板 15):老师念一个单词(念两遍),孩子在四线三格里写整个单词;
 * 不会写点「给答案」,单词灰灰地打底,照着描一遍;全写完交卷,正确的单词淡淡叠在他写的上面,自己对——不逐字母比、不问「再写一遍?」,
 * 想再写自己点。从首页英语老师卡上的「单词听写」进来(?home=&n=),或者「拍照听写」(?tutor=&lang=en,拍课本认单词)。
 * 接口和汉字的一样(src/dictation/route.ts),会话带 lang = en、一个单词一格;笔迹的点记在 2048 × 512 的尺子上(en-box.ts)。
 * 孩子端:没有对错、没有分数、没有报错的字。用 String.raw:脚本里不写反斜杠转义与反引号。
 */
import { LAYER_X, TUTOR_FACE_CSS, TUTOR_FACE_JS } from '../server/tutor-face.ts';
import { EN_BOX_CSS, EN_BOX_JS } from './en-box.ts';
import { UNLOCK_JS } from './unlock.ts';

export const DICTATION_EN_PAGE = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>单词听写</title>
<style>
  :root { --ink:#2b2b2b; --dim:#66625b; --line:#e2dfd6; --paper:#faf9f4; --card:#ffffff; --tutor:#fff3d6; --tutor-ink:#5a3a08; --green:#1f8a4c; --accent:#e8743b; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  [hidden] { display:none !important; }
  html,body { margin:0; min-height:100%; background:var(--paper); color:var(--ink); font:17px/1.5 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; overscroll-behavior:none; -webkit-user-select:none; user-select:none; }
  button, input { font:inherit; color:inherit; }
  button { cursor:pointer; }
  .view { display:none; flex-direction:column; gap:18px; max-width:1000px; margin:0 auto; padding:calc(env(safe-area-inset-top) + 10px) 20px calc(env(safe-area-inset-bottom) + 28px); }
  .view.on { display:flex; }
  .bar { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .tool { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:52px; padding:0 18px; border-radius:26px; border:1px solid var(--line); background:#fff; font-size:17px; }
  .tool:disabled { opacity:.4; }
  .main { display:inline-flex; align-items:center; justify-content:center; min-height:60px; padding:0 40px; border-radius:30px; border:0; background:var(--green); color:#fff; font-size:20px; font-weight:600; }
  .main:disabled { opacity:.45; }
  .ttl { font-size:22px; font-weight:700; }
  .dots { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .dots i { width:14px; height:14px; border-radius:7px; background:var(--line); }
  .dots i.d { background:#8fd0aa; }
  .dots i.c { width:30px; background:var(--green); }
  .bubble { display:flex; align-items:center; gap:14px; padding:14px 22px; background:var(--tutor); border-radius:22px; border-top-left-radius:6px; align-self:flex-start; }
  .bubble b { display:block; font-size:22px; color:var(--tutor-ink); }
  .bubble small { display:block; font-size:15px; color:#7a5212; min-height:22px; }
  .pad { width:100%; aspect-ratio:4 / 1; background:#fff; border:2px solid var(--line); border-radius:18px; touch-action:none; display:block; }
  .tools { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
  .center { display:flex; flex-direction:column; align-items:center; gap:18px; padding-top:40px; text-align:center; }
  .center b { font-size:28px; }
  .center span { color:var(--dim); }
  .model { font-size:44px; font-family:"Chalkboard SE","Comic Sans MS","Marker Felt",sans-serif; color:#2f6fd6; text-align:center; }
  .rows { display:flex; flex-direction:column; gap:14px; }
  .row { background:#fff; border:1.5px solid var(--line); border-radius:18px; padding:12px; display:flex; flex-direction:column; gap:8px; }
  .row svg { width:100%; aspect-ratio:4 / 1; display:block; }
  .row .ft { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .row .ft small { color:var(--dim); font-size:14px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { min-height:44px; padding:0 16px; border-radius:22px; border:1.5px solid var(--line); background:#fff; font-size:18px; }
  .chip.on { background:#e6f5ed; border-color:#8fd0aa; color:#14532d; font-weight:600; }
  .add { display:flex; gap:8px; }
  .add input { flex:1; min-width:0; min-height:48px; padding:0 14px; border-radius:14px; border:1.5px solid var(--line); font-size:18px; -webkit-user-select:text; user-select:text; }
  .snapbtns { display:flex; gap:12px; flex-wrap:wrap; justify-content:center; }
  .snapbtns label { min-height:64px; padding:0 28px; border-radius:32px; background:var(--green); color:#fff; font-size:20px; font-weight:600; display:inline-flex; align-items:center; cursor:pointer; }
  .snapbtns label.alt { background:#fff; color:var(--ink); border:1px solid var(--line); }
  .snapbtns input { display:none; }
  .muted { color:var(--dim); font-size:15px; }
  #toast { position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom) + 24px); transform:translateX(-50%); padding:12px 18px; border-radius:16px; background:#2b2b2bee; color:#fff; font-size:16px; display:none; z-index:9; }
  #toast.on { display:block; }
  ${EN_BOX_CSS}
  ${TUTOR_FACE_CSS}
</style></head><body>
<div class="view" id="v-start">
  <div class="bar"><span class="bk-slot"></span></div>
  <div class="center"><b id="s-title">单词听写</b><span id="s-sub">老师念,你来写</span><button class="main" type="button" id="s-go">开始</button></div>
</div>
<div class="view" id="v-snap">
  <div class="bar"><span class="bk-slot"></span><span class="ttl">拍照听写</span><span></span></div>
  <div class="center" id="p-pick"><b>拍一下要写的单词</b><span>课本上的单词表,或者老师发的听写单</span>
    <div class="snapbtns"><label>拍照<input type="file" accept="image/*" capture="environment" id="p-cam"></label><label class="alt">从相册选<input type="file" accept="image/*" id="p-lib"></label></div></div>
  <div id="p-list" hidden style="display:flex;flex-direction:column;gap:14px">
    <div class="muted" id="p-status">正在看照片…</div>
    <div class="chips" id="p-chips"></div>
    <div class="muted">照片上还有这些,点一下加进来:</div>
    <div class="chips" id="p-more"></div>
    <div class="add"><input id="p-add" placeholder="自己加单词,空格分开" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="tool" type="button" id="p-add-go">加</button></div>
    <div style="display:flex;justify-content:center"><button class="main" type="button" id="p-go" disabled>开始听写</button></div>
  </div>
</div>
<div class="view" id="v-write">
  <div class="bar"><span class="bk-slot"></span><div class="dots" id="w-dots"></div><button class="layer-x" type="button" id="w-x" aria-label="回到对一对" hidden>${LAYER_X}</button></div>
  <div class="bubble"><div><b id="w-who">老师在念</b><small id="w-status"></small></div></div>
  <div class="model" id="w-model" hidden></div>
  <svg class="pad" id="w-pad" viewBox="0 0 2048 512"></svg>
  <div class="tools">
    <button class="tool" type="button" id="w-again">再念</button>
    <button class="tool" type="button" id="w-undo">撤销</button>
    <button class="tool" type="button" id="w-clear">擦掉</button>
    <button class="tool" type="button" id="w-reveal">不会写,给答案</button>
    <button class="main" type="button" id="w-done">写好了</button>
  </div>
</div>
<div class="view" id="v-check">
  <div class="bar"><span class="bk-slot"></span><span class="ttl">对一对</span><button class="tool" type="button" id="c-hide">拿开蓝字</button></div>
  <div class="muted">蓝色的是书上的单词,看看你写的一样不一样。想再写哪个就点「再写一遍」。</div>
  <div class="rows" id="c-rows"></div>
  <div style="display:flex;justify-content:center"><button class="main" type="button" id="c-done">对好了</button></div>
</div>
<div class="view" id="v-submit">
  <div class="bar"><span class="bk-slot"></span></div>
  <div class="center"><b>都写完了</b><span>交上去,看看书上的单词</span><button class="main" type="button" id="u-go">交上去</button></div>
</div>
<div id="toast"></div>
<script>
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var NS = 'http://www.w3.org/2000/svg';
  var sv = function (tag, attrs) { var el = document.createElementNS(NS, tag); for (var k in (attrs || {})) el.setAttribute(k, String(attrs[k])); return el; };
  var h = function (tag, attrs) { var el = document.createElement(tag); attrs = attrs || {}; for (var k in attrs) { if (k === 'on') { for (var ev in attrs.on) el.addEventListener(ev, attrs.on[ev]); } else if (k === 'text') el.textContent = attrs[k]; else if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]); } for (var i = 2; i < arguments.length; i++) if (arguments[i]) el.append(arguments[i]); return el; };
  var api = function (method, path, body) { return fetch(path, { method: method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }); };
  var toastTimer = 0;
  var toast = function (t) { var el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2600); };
  ${EN_BOX_JS}
  var pathD = function (pts) { var d = 'M' + pts[0][0] + ' ' + pts[0][1]; if (pts.length === 1) d += ' L' + (pts[0][0] + 1) + ' ' + pts[0][1]; for (var i = 1; i < pts.length; i++) d += ' L' + pts[i][0] + ' ' + pts[i][1]; return d; };

  var q = new URLSearchParams(location.search);
  var HOME = q.get('home'); var N = Number(q.get('n') || 0); var TUTOR = q.get('tutor');
  var S = { v: null, base: Date.now(), i: 0, strokes: [], undos: 0, revealed: false, word: null, sawPen: false, mode: 'first', hide: false, noAudio: false, tok: 0, timer: 0 };
  var now = function () { return Math.max(0, Date.now() - S.base); };
  var setView = function (v) { S.v = v; S.base = Date.parse(v.startedAt) || S.base; showFace(); };
  var show = function (name) { var vs = document.querySelectorAll('.view'); for (var i = 0; i < vs.length; i++) vs[i].classList.toggle('on', vs[i].id === 'v-' + name); BACK.el.hidden = name === 'write' && S.mode === 'rewrite'; window.scrollTo(0, 0); };
  var event = function (kind, word, n) { var b = { kind: kind, word: word, t: now() }; if (n) b.n = n; if (kind !== 'show' && kind !== 'say' && kind !== 'again' && kind !== 'self' && kind !== 'rewrite') b.char = 0; api('POST', '/api/dictation/' + S.v.id + '/events', b).catch(function () {}); };
  var goHome = function () { stopSay(); location.href = '/'; };
  // ---- 左上角「‹ 头像」胶囊,同老师页(《wip/听写设想.md》拍板 16);再写一遍是叠在对一对上的一层,右上角 × 回去 ----
  ${TUTOR_FACE_JS}
  var BACK = backCapsule(goHome); document.body.append(BACK.el);
  var TUTORS = null;
  var showFace = function () { var name = (S.v && S.v.tutorName) || TUTOR; if (TUTORS && name) BACK.set(TUTORS.filter(function (t) { return t.name === name; })[0] || null); };

  // ---------- 念:配了音色放音频,没有退浏览器的英文合成声 ----------
  var audio = new Audio(); audio.preload = 'auto';
  ${UNLOCK_JS}
  var stopSay = function () { clearTimeout(S.timer); S.tok++; try { audio.pause(); } catch (e) {} try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {} };
  var status = function (t) { $('#w-status').textContent = t; };
  var sayWord = function (i, times) {
    stopSay();
    var tok = S.tok; var left = times; var nth = 0;
    var next = function () { if (tok !== S.tok) return; if (left <= 0) { status('听完了就写'); return; } left--; nth++; status('正在念 · 第 ' + nth + ' 遍'); event('say', i, nth); play(); };
    var gap = function () { if (tok !== S.tok) return; status(left > 0 ? '再听一遍' : '听完了就写'); if (left > 0) S.timer = setTimeout(next, 1600); };
    var synth = function () {
      api('GET', '/api/dictation/' + S.v.id + '/say/' + i + '?text=1').then(function (j) {
        if (tok !== S.tok || !window.speechSynthesis) return gap();
        var u = new SpeechSynthesisUtterance(j.text); u.lang = 'en-US'; u.rate = 0.75;
        u.onend = gap; u.onerror = gap; speechSynthesis.speak(u);
      }, gap);
    };
    var play = function () {
      if (S.noAudio) return synth();
      audio.onended = gap;
      audio.onerror = function () { S.noAudio = true; synth(); };
      audio.src = '/api/dictation/' + S.v.id + '/say/' + i;
      var pr = audio.play(); if (pr && pr.catch) pr.catch(function (e) { if (tok !== S.tok) return; if (audio.error) { S.noAudio = true; synth(); } else if (blocked(e)) status('点「再念」听老师念'); });
    };
    next();
  };

  // ---------- 写:一个单词一格,四线三格 ----------
  var pad = $('#w-pad');
  var trace = sv('g', {}); var ink = sv('g', { 'class': 'eni' });
  pad.append(enLines(sv), trace, ink);
  var drawInk = function () { ink.replaceChildren.apply(ink, S.strokes.map(function (s) { return sv('path', { d: pathD(s) }); })); };
  var cur = null;
  var at = function (e) { var b = pad.getBoundingClientRect(); return [Math.round((e.clientX - b.left) / b.width * EN_W), Math.round((e.clientY - b.top) / b.height * EN_H), now()]; };
  pad.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'pen') S.sawPen = true; else if (e.pointerType === 'touch' && S.sawPen) return; // 用过笔就不认手掌
    e.preventDefault(); try { pad.setPointerCapture(e.pointerId); } catch (x) {}
    cur = { id: e.pointerId, pts: [at(e)] }; S.strokes.push(cur.pts); drawInk();
  });
  pad.addEventListener('pointermove', function (e) { if (!cur || e.pointerId !== cur.id) return; e.preventDefault(); cur.pts.push(at(e)); var p = ink.lastChild; if (p) p.setAttribute('d', pathD(cur.pts)); });
  var up = function (e) { if (cur && e.pointerId === cur.id) cur = null; };
  pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
  $('#w-undo').addEventListener('click', function () { if (S.strokes.length) { S.strokes.pop(); S.undos++; drawInk(); } });
  $('#w-clear').addEventListener('click', function () { if (S.strokes.length) { S.strokes = []; S.undos++; drawInk(); } });
  $('#w-again').addEventListener('click', function () { event('again', S.i); sayWord(S.i, 1); });
  $('#w-reveal').addEventListener('click', function () {
    var i = S.i; var b = $('#w-reveal'); b.disabled = true;
    api('POST', '/api/dictation/' + S.v.id + '/reveal/' + i, { char: 0, t: now() }).then(function (j) {
      if (S.i !== i) return;
      S.revealed = true; S.strokes = []; drawInk();
      trace.replaceChildren(enWord(sv, j.ch, 'enw trace'));
      status('照着灰色的单词写一遍');
    }, function () { b.disabled = false; toast('没连上,再点一次'); });
  });
  var dots = function () { var box = $('#w-dots'); box.replaceChildren(); for (var k = 0; k < S.v.sizes.length; k++) box.append(h('i', { 'class': k === S.i ? 'c' : S.v.written[k] ? 'd' : '' })); };
  var openWord = function (i) {
    S.i = i; S.strokes = []; S.undos = 0; S.revealed = false; S.mode = 'first';
    trace.replaceChildren(); drawInk(); $('#w-model').hidden = true;
    $('#w-who').textContent = (S.v.tutor || '老师') + '念第 ' + (i + 1) + ' 个';
    $('#w-reveal').disabled = false; $('#w-reveal').hidden = false; $('#w-done').disabled = false; $('#w-x').hidden = true;
    dots(); show('write'); event('show', i); sayWord(i, 2);
  };
  var nextWord = function () { for (var k = 0; k < S.v.written.length; k++) if (!S.v.written[k]) return openWord(k); stopSay(); show('submit'); };
  $('#w-done').addEventListener('click', function () {
    if (S.revealed && !S.strokes.length) { status('照着灰色的单词写一遍'); return; }
    var i = S.i; var b = $('#w-done'); b.disabled = true;
    var chars = [{ strokes: S.strokes, undos: S.undos, revealed: S.revealed || undefined }];
    if (S.mode === 'rewrite') {
      api('POST', '/api/dictation/' + S.v.id + '/rewrites/' + i, { chars: chars, self: true }).then(function (v) { setView(v); stopSay(); openCheck(); }, function () { b.disabled = false; toast('没连上,再点一次'); });
      return;
    }
    api('PUT', '/api/dictation/' + S.v.id + '/first/' + i, { chars: chars }).then(function () { event('done', i); S.v.written[i] = true; nextWord(); }, function () { b.disabled = false; toast('没连上,再点一次'); });
  });

  // ---------- 交卷、对一对 ----------
  $('#u-go').addEventListener('click', function () { var b = $('#u-go'); b.disabled = true; api('POST', '/api/dictation/' + S.v.id + '/check').then(function (v) { setView(v); openCheck(); }, function () { b.disabled = false; toast('没连上,再点一次'); }); });
  var openCheck = function () {
    var rows = $('#c-rows'); rows.replaceChildren();
    S.v.answers.forEach(function (a, i) {
      var svg = sv('svg', { viewBox: '0 0 2048 512' }); var g = sv('g', { 'class': 'eni' });
      (a.ink[0] || []).forEach(function (s) { if (s.length) g.append(sv('path', { d: pathD(s) })); });
      svg.append(enLines(sv), g); if (!S.hide) svg.append(enWord(sv, a.chars));
      var again = h('button', { 'class': 'tool', type: 'button', on: { click: function () { rewrite(i); } } }, '再写一遍');
      rows.append(h('div', { 'class': 'row' }, svg, h('div', { 'class': 'ft' }, h('small', { text: (i + 1) + (a.revealed ? ' · 看了答案,照着写的' : a.rewrote ? ' · 又写了一遍' : '') }), again)));
    });
    show('check');
  };
  $('#c-hide').addEventListener('click', function () { S.hide = !S.hide; $('#c-hide').textContent = S.hide ? '放回蓝字' : '拿开蓝字'; openCheck(); });
  var rewrite = function (i) {
    event('self', i);
    S.i = i; S.strokes = []; S.undos = 0; S.revealed = false; S.mode = 'rewrite';
    trace.replaceChildren(); drawInk();
    var m = $('#w-model'); m.textContent = S.v.answers[i].chars; m.hidden = false;
    $('#w-who').textContent = '再写一遍'; status('看着上面的单词写'); $('#w-reveal').hidden = true; $('#w-done').disabled = false;
    $('#w-dots').replaceChildren(); $('#w-x').hidden = false; show('write'); sayWord(i, 1);
  };
  $('#w-x').addEventListener('click', function () { stopSay(); S.mode = 'first'; openCheck(); });
  $('#c-done').addEventListener('click', function () { api('POST', '/api/dictation/' + S.v.id + '/done').then(goHome, goHome); });

  // ---------- 开始 ----------
  var begin = function (v) {
    setView(v);
    if (v.checked) return openCheck();
    $('#s-title').textContent = '单词听写 · ' + v.sizes.length + ' 个单词';
    $('#s-sub').textContent = (v.tutor || '老师') + '念,你来写';
    show('start');
  };
  $('#s-go').addEventListener('click', function () { nextWord(); });

  // ---------- 拍照开始:拍 → 一项一项认出来 → 点选 → 开始 ----------
  var P = { id: null, items: [], on: {}, extra: [], timer: 0 };
  var shrink = function (file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file); var im = new Image();
      im.onload = function () { var k = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight)); var c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85)); };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('x')); };
      im.src = url;
    });
  };
  var WORD = /^[A-Za-z][A-Za-z'-]*$/;
  var chosen = function () { var out = []; P.items.forEach(function (it) { if (P.on[it.text]) out.push({ chars: it.text, say: it.say || undefined }); }); P.extra.forEach(function (w) { if (P.on[w] && !out.some(function (x) { return x.chars === w; })) out.push({ chars: w }); }); return out.slice(0, 20); };
  var drawChips = function (rec) {
    var mk = function (w) { return h('button', { 'class': 'chip' + (P.on[w] ? ' on' : ''), type: 'button', on: { click: function () { P.on[w] = !P.on[w]; drawChips(rec); } } }, w); };
    $('#p-chips').replaceChildren.apply($('#p-chips'), P.items.map(function (it) { return mk(it.text); }).concat(P.extra.map(mk)));
    var seen = {}; P.items.forEach(function (it) { seen[it.text.toLowerCase()] = 1; }); P.extra.forEach(function (w) { seen[w.toLowerCase()] = 1; });
    var more = []; (rec && rec.full || []).forEach(function (l) { l.split(' ').forEach(function (w) { if (WORD.test(w) && w.length > 1 && !seen[w.toLowerCase()]) { seen[w.toLowerCase()] = 1; more.push(w); } }); });
    $('#p-more').replaceChildren.apply($('#p-more'), more.slice(0, 40).map(function (w) { return h('button', { 'class': 'chip', type: 'button', on: { click: function () { P.extra.push(w); P.on[w] = true; drawChips(rec); } } }, w); }));
    $('#p-go').disabled = !chosen().length;
  };
  var poll = function () {
    api('GET', '/api/dictation/photos/' + P.id).then(function (rec) {
      rec.items.forEach(function (it) { if (!P.items.some(function (x) { return x.text === it.text; })) { P.items.push(it); P.on[it.text] = it.pick; } });
      $('#p-status').textContent = rec.state === 'running' ? '正在看照片…' : P.items.length ? (rec.lesson ? rec.lesson + ' · ' : '') + '点一下选上或去掉' : '没认出单词,自己打上也行';
      drawChips(rec);
      if (rec.state === 'running') P.timer = setTimeout(poll, 700);
    }, function () { P.timer = setTimeout(poll, 1500); });
  };
  var onFile = function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    $('#p-pick').hidden = true; $('#p-list').hidden = false; $('#p-status').textContent = '正在看照片…';
    shrink(f).then(function (data) { return api('POST', '/api/dictation/photos', { image: data, lang: 'en' }); }).then(function (j) { P.id = j.id; poll(); }, function () { $('#p-status').textContent = '没看成,自己打上单词也行'; });
  };
  $('#p-cam').addEventListener('change', onFile); $('#p-lib').addEventListener('change', onFile);
  $('#p-add-go').addEventListener('click', function () { var inp = $('#p-add'); inp.value.split(/ +/).forEach(function (w) { w = w.trim(); if (WORD.test(w) && w.length <= 20 && P.extra.indexOf(w) < 0) { P.extra.push(w); P.on[w] = true; } }); inp.value = ''; drawChips(null); });
  $('#p-go').addEventListener('click', function () {
    var b = $('#p-go'); b.disabled = true; clearTimeout(P.timer);
    var body = { photo: P.id, words: chosen(), lang: 'en' }; if (TUTOR) body.tutor = TUTOR;
    if (!P.id) { toast('先拍一张'); b.disabled = false; return; }
    api('POST', '/api/dictation', body).then(begin, function () { b.disabled = false; toast('没连上,再点一次'); });
  });

  api('GET', '/api/kid/home').then(function (j) { TUTORS = j.tutors || []; showFace(); }, function () {});
  if (HOME) api('POST', '/api/dictation', { home: HOME, n: N }).then(begin, goHome);
  else { show('snap'); $('#p-list').hidden = true; }
})();
</script>
</body></html>
`;
