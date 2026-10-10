/**
 * /dictation/reel?id=<id>:家长看听写的录像(《wip/听写设想.md》拍板 9:录数据不录屏幕,不录声音)。
 * 录的是孩子端本来就有的数据:每一笔的点带时刻(离这次听写开始多少毫秒),加上事件(出词、念第几遍、再念、给答案、看笔顺、写好了)。
 * 放的时候一个词一章:格里按时刻一笔一笔重画,看过答案的字到点了显出浅灰的描红;时间轴上标念、给答案、停着没写的段;下面是这一章的经过,点一行跳过去。
 * 「放老师念的声音」勾着、1 倍速时,走到念的那一刻放那一句(和孩子当时听到的同一个音频)。
 * 内联脚本里不写反斜杠、不写反引号、不写美元加花括号(这是模板字符串,见 CLAUDE.md「坑」)。
 */
export const DICTATION_REEL_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>听写录像</title>
<style>
  :root { --ink:#2b2b2b; --dim:#66625b; --line:#e2dfd6; --paper:#faf9f4; --sand:#d8c7a0; --sand2:#e2d4b4; --accent:#e8743b; --gold:#c9a24a; }
  * { box-sizing:border-box; }
  html,body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.6 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; }
  main { max-width:760px; margin:0 auto; padding:18px 16px 40px; display:flex; flex-direction:column; gap:14px; }
  h1 { margin:0; font-size:22px; }
  .muted { color:var(--dim); font-size:13px; }
  .chs { display:flex; gap:8px; overflow-x:auto; padding-bottom:2px; }
  .ch { font:inherit; flex:none; min-height:40px; padding:0 14px; border-radius:20px; border:1px solid var(--line); background:#fff; font-size:14px; cursor:pointer; }
  .ch.on { background:#2b3a4a; border-color:#2b3a4a; color:#fff; }
  .ch.rv { border-color:#e8a26f; }
  .ch.rv.on { background:#8f3c14; border-color:#8f3c14; }
  .cells { display:flex; gap:8px; position:relative; width:fit-content; max-width:100%; }
  .cells svg { display:block; width:var(--cell,160px); height:var(--cell,160px); }
  .grid rect { fill:#fff; stroke:var(--sand); stroke-width:10; }
  .grid line { stroke:var(--sand2); stroke-width:6; stroke-dasharray:28 20; }
  .ink path { fill:none; stroke:var(--ink); stroke-width:34; stroke-linecap:round; stroke-linejoin:round; }
  .trace path { fill:#d9d5cc; }
  .clock { position:absolute; right:6px; bottom:6px; padding:1px 8px; border-radius:8px; background:rgba(43,58,74,.85); color:#fff; font-size:12px; font-variant-numeric:tabular-nums; }
  .now { font-size:15px; color:#3d3b37; min-height:24px; }
  .bar { position:relative; height:10px; border-radius:5px; background:var(--line); cursor:pointer; }
  .bar .done { position:absolute; left:0; top:0; bottom:0; border-radius:5px; background:#8fb4e3; }
  .bar .gap { position:absolute; top:0; bottom:0; background:repeating-linear-gradient(45deg,#d8d4ca 0 4px,#eeece6 4px 8px); }
  .bar .mk { position:absolute; top:-5px; width:3px; height:20px; border-radius:2px; }
  .bar .sep { position:absolute; top:-2px; width:1px; height:14px; background:#a7a29a; }
  .bar .head { position:absolute; top:-4px; width:18px; height:18px; margin-left:-9px; border-radius:9px; background:#2b3a4a; }
  .legend { display:flex; gap:14px; flex-wrap:wrap; font-size:12px; color:var(--dim); }
  .legend i { display:inline-block; vertical-align:middle; margin-right:5px; }
  .ctl { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .play { width:52px; height:52px; border-radius:26px; border:0; background:#2b3a4a; color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; }
  .pill { font:inherit; min-height:40px; padding:0 14px; border-radius:20px; border:1px solid var(--line); background:#fff; font-size:14px; cursor:pointer; }
  .pill.on { background:#2b3a4a; border-color:#2b3a4a; color:#fff; }
  label.ck { display:flex; align-items:center; gap:6px; font-size:14px; min-height:40px; }
  .log { display:flex; flex-direction:column; gap:2px; padding:12px 14px; background:#fff; border:1px solid var(--line); border-radius:16px; }
  .ev { font:inherit; display:flex; gap:12px; align-items:baseline; text-align:left; padding:4px 0; border:0; background:transparent; font-size:14px; line-height:1.5; cursor:pointer; color:var(--ink); }
  .ev time { flex:none; width:40px; color:var(--dim); font-variant-numeric:tabular-nums; }
  .ev.past time { color:#2b3a4a; font-weight:600; }
  .ev.rv { color:#a8501f; font-weight:600; }
  .ev.gap { color:#6f6150; }
  .empty { padding:40px 0; text-align:center; color:var(--dim); }
</style></head>
<body><main>
  <div><div class="muted" id="sub"></div><h1>听写录像</h1></div>
  <div class="chs" id="chs"></div>
  <div class="cells" id="cells"><span class="clock" id="clock">0:00</span></div>
  <div class="now" id="now"></div>
  <div class="bar" id="bar"></div>
  <div class="legend"><span><i style="width:3px;height:12px;background:var(--gold)"></i>老师念</span><span><i style="width:3px;height:12px;background:var(--accent)"></i>给答案</span><span><i style="width:14px;height:8px;background:repeating-linear-gradient(45deg,#d8d4ca 0 4px,#eeece6 4px 8px)"></i>停着没写</span></div>
  <div class="ctl">
    <button class="play" id="play" aria-label="播放"></button>
    <button class="pill" data-speed="1">1 倍</button><button class="pill" data-speed="2">2 倍</button><button class="pill" data-speed="4">4 倍</button>
    <button class="pill on" id="skip">跳过停顿</button>
    <label class="ck"><input type="checkbox" id="voice" checked style="width:20px;height:20px">放老师念的声音</label>
  </div>
  <div class="log" id="log"></div>
</main>
<script>
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var NS = 'http://www.w3.org/2000/svg';
  var HZ_T = 'scale(1,-1) translate(0,-900)';
  var GAP = 4000;
  var sv = function (tag, attrs) { var el = document.createElementNS(NS, tag); for (var k in (attrs || {})) el.setAttribute(k, String(attrs[k])); return el; };
  var h = function (tag, attrs) {
    var el = document.createElement(tag); attrs = attrs || {};
    for (var k in attrs) { if (k === 'on') { for (var ev in attrs.on) el.addEventListener(ev, attrs.on[ev]); } else if (k === 'text') el.textContent = attrs[k]; else el.setAttribute(k, attrs[k]); }
    var add = function (c) { if (Array.isArray(c)) c.forEach(add); else if (c !== null && c !== undefined && c !== false) el.append(c); };
    for (var i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  };
  var clock = function (ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  var secs = function (ms) { return ms < 10000 ? (Math.round(ms / 100) / 10) + ' 秒' : Math.round(ms / 1000) + ' 秒'; };
  var GL = {};
  var glyph = function (ch) { if (!GL[ch]) GL[ch] = fetch('/api/kid/tianzige/' + encodeURIComponent(ch)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); return GL[ch]; };
  var ICON_PLAY = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>';
  var ICON_PAUSE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

  var R = { s: null, chapters: [], ch: 0, t: 0, end: 0, playing: false, speed: 1, skip: true, last: 0, gaps: [], cells: [], audio: new Audio(), said: {} };

  /** 一次听写 → 一章一个词:每个字的笔(点带 t)、这一章的事件、从哪到哪 */
  var build = function (s) {
    var evs = (s.events || []).filter(function (e) { return typeof e.t === 'number'; });
    var shows = {}; evs.forEach(function (e) { if (e.kind === 'show' && !(e.word in shows)) shows[e.word] = e.t; });
    var chs = s.words.map(function (w, i) {
      var a = s.first[i];
      var chars = Array.from(w.chars).map(function (ch, ci) { var ink = a && a.chars[ci] ? a.chars[ci] : { strokes: [] }; return { ch: ch, strokes: ink.strokes.filter(function (x) { return x.length; }), revealed: Boolean(ink.revealed) }; });
      var ts = []; chars.forEach(function (c) { c.strokes.forEach(function (st) { ts.push(st[0][2], st[st.length - 1][2]); }); });
      var from = i in shows ? shows[i] : ts.length ? Math.min.apply(null, ts) - 500 : 0;
      return { i: i, w: w, chars: chars, from: Math.max(0, from), last: ts.length ? Math.max.apply(null, ts) : from, revealed: chars.some(function (c) { return c.revealed; }) };
    });
    chs.forEach(function (c, k) {
      var mine = evs.filter(function (e) { return e.word === c.i && ['show', 'say', 'again', 'reveal', 'order', 'done'].indexOf(e.kind) >= 0; });
      c.events = mine;
      var lastEv = mine.length ? Math.max.apply(null, mine.map(function (e) { return e.t; })) : c.from;
      var nextFrom = k + 1 < chs.length ? chs[k + 1].from : Infinity;
      c.to = Math.min(nextFrom, Math.max(c.last, lastEv) + 1200);
    });
    return chs;
  };
  /** 一章里的停顿:前后两件事(一笔的起止、事件)隔了超过 4 秒 */
  var gapsOf = function (c) {
    var ts = [c.from, c.to];
    c.chars.forEach(function (x) { x.strokes.forEach(function (st) { ts.push(st[0][2], st[st.length - 1][2]); }); });
    c.events.forEach(function (e) { ts.push(e.t); });
    ts.sort(function (a, b) { return a - b; });
    var out = [];
    for (var k = 1; k < ts.length; k++) if (ts[k] - ts[k - 1] > GAP) out.push([ts[k - 1], ts[k]]);
    return out;
  };

  var cellSvg = function () {
    var svg = sv('svg', { viewBox: '0 0 1024 1024' });
    var grid = sv('g', { 'class': 'grid' });
    grid.append(sv('rect', { x: 8, y: 8, width: 1008, height: 1008, rx: 20 }), sv('line', { x1: 512, y1: 8, x2: 512, y2: 1016 }), sv('line', { x1: 8, y1: 512, x2: 1016, y2: 512 }));
    var trace = sv('g', { 'class': 'trace', transform: HZ_T }); var ink = sv('g', { 'class': 'ink', transform: HZ_T });
    svg.append(grid, trace, ink);
    return { svg: svg, trace: trace, ink: ink, shown: false };
  };
  var pathUpTo = function (st, t) {
    var pts = st.filter(function (p) { return p[2] <= t; });
    if (!pts.length) return null;
    var d = 'M' + pts[0][0] + ' ' + pts[0][1]; if (pts.length === 1) d += ' L' + (pts[0][0] + 1) + ' ' + pts[0][1];
    for (var i = 1; i < pts.length; i++) d += ' L' + pts[i][0] + ' ' + pts[i][1];
    return d;
  };

  var openChapter = function (k, seek) {
    R.ch = k; var c = R.chapters[k];
    R.gaps = gapsOf(c);
    var box = $('#cells'); var cl = $('#clock');
    var size = Math.min(180, Math.floor((Math.min(window.innerWidth, 760) - 32 - (c.chars.length - 1) * 8) / c.chars.length));
    box.style.setProperty('--cell', size + 'px');
    R.cells = c.chars.map(function () { return cellSvg(); });
    box.replaceChildren.apply(box, R.cells.map(function (x) { return x.svg; }).concat([cl]));
    var bs = document.querySelectorAll('#chs .ch'); for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', i === k);
    if (bs[k] && bs[k].scrollIntoView) bs[k].scrollIntoView({ block: 'nearest', inline: 'center' });
    renderBar(); renderLog();
    R.t = seek === undefined ? c.from : seek;
    paint();
  };
  var revealAt = function (c, ci) { var e = c.events.filter(function (x) { return x.kind === 'reveal' && x.char === ci; })[0]; return e ? e.t : null; };
  var paint = function () {
    var c = R.chapters[R.ch]; var t = R.t;
    c.chars.forEach(function (x, ci) {
      var cell = R.cells[ci];
      var paths = []; x.strokes.forEach(function (st) { var d = pathUpTo(st, t); if (d) paths.push(sv('path', { d: d })); });
      cell.ink.replaceChildren.apply(cell.ink, paths);
      var rt = revealAt(c, ci);
      var show = rt !== null && t >= rt;
      if (show !== cell.shown) {
        cell.shown = show;
        if (show) glyph(x.ch).then(function (d) { if (d && cell.shown) cell.trace.replaceChildren.apply(cell.trace, d.strokes.map(function (p) { return sv('path', { d: p }); })); });
        else cell.trace.replaceChildren();
      }
    });
    $('#clock').textContent = clock(t);
    $('#now').textContent = nowText(c, t);
    var span = R.end || 1;
    $('#bar .done').style.width = Math.min(100, t / span * 100) + '%';
    $('#bar .head').style.left = Math.min(100, t / span * 100) + '%';
    var evs = document.querySelectorAll('#log .ev'); for (var i = 0; i < evs.length; i++) evs[i].classList.toggle('past', Number(evs[i].dataset.t) <= t);
  };
  /** 这一刻在干什么(放到的那一刻最近的一件事) */
  var nowText = function (c, t) {
    if (R.gaps.some(function (g) { return t > g[0] && t < g[1]; })) return '停着没写';
    var writing = null;
    c.chars.forEach(function (x) { x.strokes.forEach(function (st) { if (st[0][2] <= t && t <= st[st.length - 1][2] + 300) writing = x; }); });
    var past = c.events.filter(function (e) { return e.t <= t; });
    var e = past[past.length - 1];
    if (writing) return (revealAt(c, c.chars.indexOf(writing)) !== null && t >= revealAt(c, c.chars.indexOf(writing)) ? '照着写「' : '正在写「') + writing.ch + '」';
    if (!e) return '';
    if (e.kind === 'say') return '老师念第 ' + (e.n || 1) + ' 遍';
    if (e.kind === 'reveal' || e.kind === 'order') return '看「' + c.chars[e.char].ch + '」的笔顺';
    if (e.kind === 'done') return '「' + c.chars[e.char].ch + '」写好了';
    if (e.kind === 'again') return '点了再念';
    return '';
  };
  var renderBar = function () {
    var bar = $('#bar'); var span = R.end || 1; var kids = [h('div', { 'class': 'done' })];
    R.chapters.forEach(function (c) {
      kids.push(h('div', { 'class': 'sep', style: 'left:' + (c.from / span * 100) + '%' }));
      gapsOf(c).forEach(function (g) { kids.push(h('div', { 'class': 'gap', style: 'left:' + (g[0] / span * 100) + '%;width:' + ((g[1] - g[0]) / span * 100) + '%' })); });
      c.events.forEach(function (e) { if (e.kind === 'say') kids.push(h('div', { 'class': 'mk', style: 'left:' + (e.t / span * 100) + '%;background:var(--gold)' })); if (e.kind === 'reveal') kids.push(h('div', { 'class': 'mk', style: 'left:' + (e.t / span * 100) + '%;background:var(--accent)' })); });
    });
    kids.push(h('div', { 'class': 'head' }));
    bar.replaceChildren.apply(bar, kids);
  };
  /** 这一章的经过,一行一件事;点一行跳到那一刻 */
  var renderLog = function () {
    var c = R.chapters[R.ch]; var rows = [];
    c.events.forEach(function (e) {
      if (e.kind === 'show') rows.push({ t: e.t, text: '出第 ' + (c.i + 1) + ' 个词' });
      if (e.kind === 'say') rows.push({ t: e.t, text: '老师念「' + (c.w.say || c.w.chars) + '」' + (e.n > 1 ? '第 ' + e.n + ' 遍' : '') });
      if (e.kind === 'again') rows.push({ t: e.t, text: '点了「再念」' });
      if (e.kind === 'reveal') rows.push({ t: e.t, text: '点了「不会写,给答案」:' + c.chars[e.char].ch, cls: 'rv' });
      if (e.kind === 'done') rows.push({ t: e.t, text: '「' + c.chars[e.char].ch + '」写好了' });
    });
    c.chars.forEach(function (x, ci) {
      if (!x.strokes.length) { rows.push({ t: c.to, text: '「' + x.ch + '」一笔没写' }); return; }
      var a = x.strokes[0][0][2], b = x.strokes[x.strokes.length - 1].slice(-1)[0][2];
      var rt = revealAt(c, ci);
      rows.push({ t: a, text: (rt !== null && a >= rt ? '照着写「' : '写「') + x.ch + '」· ' + x.strokes.length + ' 笔 · 用了 ' + secs(b - a) });
    });
    R.gaps.forEach(function (g) { rows.push({ t: g[0], text: '停了 ' + secs(g[1] - g[0]) + ',一笔没写', cls: 'gap' }); });
    rows.sort(function (p, q) { return p.t - q.t; });
    var log = $('#log');
    log.replaceChildren.apply(log, [h('div', { 'class': 'muted', text: '「' + c.w.chars + '」这一段' })].concat(rows.map(function (r) {
      return h('button', { 'class': 'ev' + (r.cls ? ' ' + r.cls : ''), 'data-t': String(r.t), on: { click: function () { R.t = r.t; paint(); } } }, h('time', { text: clock(r.t) }), h('span', { text: r.text }));
    })));
  };

  // ---- 放 ----
  var setPlaying = function (on) { R.playing = on; $('#play').innerHTML = on ? ICON_PAUSE : ICON_PLAY; $('#play').setAttribute('aria-label', on ? '暂停' : '播放'); if (on) { R.last = performance.now(); requestAnimationFrame(tick); } else { try { R.audio.pause(); } catch (e) {} } };
  var tick = function (now) {
    if (!R.playing) return;
    var dt = (now - R.last) * R.speed; R.last = now;
    var c = R.chapters[R.ch]; var t0 = R.t; var t = R.t + dt;
    if (R.skip) R.gaps.forEach(function (g) { if (t > g[0] + 800 && t < g[1] - 400) t = g[1] - 400; });
    // 走过念的那一刻:放那一句(1 倍速、勾着才放)
    c.events.forEach(function (e) { if (e.kind === 'say' && e.t > t0 && e.t <= t && R.speed === 1 && $('#voice').checked) { R.audio.src = '/api/dictation/' + R.s.id + '/say/' + c.i; R.audio.play().catch(function () {}); } });
    R.t = t;
    if (t >= c.to) {
      if (R.ch + 1 < R.chapters.length) { openChapter(R.ch + 1); }
      else { R.t = c.to; paint(); setPlaying(false); return; }
    }
    paint();
    requestAnimationFrame(tick);
  };
  $('#play').addEventListener('click', function () { setPlaying(!R.playing); });
  var sp = document.querySelectorAll('[data-speed]');
  var setSpeed = function (v) { R.speed = v; for (var i = 0; i < sp.length; i++) sp[i].classList.toggle('on', Number(sp[i].dataset.speed) === v); };
  for (var i0 = 0; i0 < sp.length; i0++) sp[i0].addEventListener('click', function (e) { setSpeed(Number(e.currentTarget.dataset.speed)); });
  $('#skip').addEventListener('click', function () { R.skip = !R.skip; $('#skip').classList.toggle('on', R.skip); });
  $('#bar').addEventListener('click', function (e) {
    var r = e.currentTarget.getBoundingClientRect(); var t = (e.clientX - r.left) / r.width * R.end;
    var k = 0; R.chapters.forEach(function (c, i) { if (c.from <= t) k = i; });
    if (k !== R.ch) openChapter(k, t); else { R.t = t; paint(); }
  });

  var id = new URLSearchParams(location.search).get('id');
  fetch('/api/dictation/' + encodeURIComponent(id || ''), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(function (s) {
    R.s = s;
    R.chapters = build(s).filter(function (c) { return c.chars.some(function (x) { return x.strokes.length; }) || c.events.length; });
    if (!R.chapters.length) { $('main').replaceChildren(h('div', { 'class': 'empty', text: '这次还没写,没有录像。' })); return; }
    R.end = R.chapters[R.chapters.length - 1].to;
    var d = new Date(s.startedAt);
    $('#sub').textContent = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' · ' + s.words.length + ' 个词 · ' + clock(R.end) + (s.lesson ? ' · ' + s.lesson : '');
    var chs = $('#chs');
    chs.replaceChildren.apply(chs, R.chapters.map(function (c, k) { return h('button', { 'class': 'ch' + (c.revealed ? ' rv' : ''), on: { click: function () { openChapter(k); } } }, (c.i + 1) + ' ' + c.w.chars); }));
    setSpeed(1); setPlaying(false);
    openChapter(0);
  }, function () { $('main').replaceChildren(h('div', { 'class': 'empty', text: '找不到这次听写。' })); });
})();
</script>
</body></html>`;
