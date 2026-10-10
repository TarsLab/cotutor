/**
 * /dictation/parent:家长看听写的结果(《wip/听写设想.md》)。孩子端没有对错,对错全在这里:
 * 每个词第一遍写的(书上的字淡淡叠着)→ 再写的;逐字一句:少了第几笔、多了几笔、笔顺先后、写反方向、占格、擦过几次;问了才改还是自己改的。
 * 末尾一张「要再练的词」,复制成下一张听写卡。
 * 内联脚本里不写反斜杠、不写反引号、不写美元加花括号(这是模板字符串,见 CLAUDE.md「坑」)。
 */
export const DICTATION_PARENT_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>听写的结果</title>
<style>
  :root { --ink:#2b2b2b; --dim:#66625b; --line:#e2dfd6; --paper:#faf9f4; --card:#fff; --sand:#d8c7a0; --sand2:#e2d4b4; --blue:#4f86d1; }
  * { box-sizing:border-box; }
  html,body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.6 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; }
  main { max-width:760px; margin:0 auto; padding:20px 16px 40px; display:flex; flex-direction:column; gap:14px; }
  h1 { margin:0; font-size:24px; }
  .muted { color:var(--dim); font-size:14px; }
  .dates { display:flex; gap:8px; overflow-x:auto; padding-bottom:4px; }
  .dates button { font:inherit; font-size:14px; flex:none; min-height:40px; padding:0 14px; border-radius:20px; border:1px solid var(--line); background:#fff; cursor:pointer; }
  .dates button.on { background:#2b3a4a; color:#fff; border-color:#2b3a4a; }
  .sum { padding:16px; background:#2b3a4a; color:#fff; border-radius:16px; }
  .sum b { font-size:17px; display:block; }
  .sum span { color:#d9e2ec; font-size:14px; }
  .sec { font-size:13px; color:var(--dim); padding:4px 4px 0; }
  .item { display:flex; flex-direction:column; gap:10px; padding:16px; background:var(--card); border:1px solid var(--line); border-radius:16px; }
  .head { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
  .w { font-size:22px; font-weight:700; letter-spacing:3px; }
  .chips { display:flex; gap:6px; flex-wrap:wrap; }
  .chip { font-size:12px; padding:3px 10px; border-radius:12px; white-space:nowrap; }
  .warm { background:#f9f1de; color:#7a4a0c; }
  .calm { background:#e9f1fb; color:#24508c; }
  .good { background:#e5f4ea; color:#1b6b3c; }
  .thumbs { display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap; }
  .att { display:flex; flex-direction:column; gap:4px; align-items:center; }
  .att .ps { display:flex; gap:4px; }
  .att small { font-size:12px; color:var(--dim); }
  .arrow { align-self:center; color:#8a8781; }
  .tz { width:76px; height:76px; display:block; }
  .grid rect { fill:#fff; stroke:var(--sand); stroke-width:12; }
  .grid line { stroke:var(--sand2); stroke-width:8; stroke-dasharray:30 22; }
  .ink path { fill:none; stroke:var(--ink); stroke-width:38; stroke-linecap:round; stroke-linejoin:round; }
  .std path { fill:var(--blue); fill-opacity:.3; }
  .num circle { fill:#e8743b; }
  .num text { fill:#fff; font:700 64px Helvetica,sans-serif; text-anchor:middle; }
  ul { margin:0; padding-left:20px; font-size:14px; line-height:1.7; color:#3d3b37; }
  .ok { font-size:15px; }
  textarea { width:100%; min-height:120px; font:14px/1.5 ui-monospace,Menlo,monospace; border:1px solid var(--line); border-radius:12px; padding:10px; background:#fff; }
  .empty { padding:40px 0; text-align:center; color:var(--dim); }
  a.reel { display:flex; align-items:center; min-height:48px; padding:0 16px; border-radius:14px; background:#fff; border:1px solid var(--line); color:#24508c; text-decoration:none; font-size:15px; }
  .src { display:flex; align-items:center; gap:12px; font-size:14px; color:var(--dim); }
  .src img { width:72px; height:72px; object-fit:cover; border-radius:10px; border:1px solid var(--line); }
</style></head>
<body><main>
  <div><div class="muted">家长 · 听写</div><h1>听写的结果</h1></div>
  <div class="dates" id="dates"></div>
  <div id="body"></div>
</main>
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
    var add = function (c) { if (Array.isArray(c)) c.forEach(add); else if (c !== null && c !== undefined && c !== false) el.append(c); };
    for (var i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  };
  var api = function (path) { return fetch(path, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }); };
  var GL = {};
  var glyph = function (ch) { if (!GL[ch]) GL[ch] = fetch('/api/kid/tianzige/' + encodeURIComponent(ch)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); return GL[ch]; };
  var pathD = function (pts) { var d = 'M' + pts[0][0] + ' ' + pts[0][1]; if (pts.length === 1) d += ' L' + (pts[0][0] + 1) + ' ' + pts[0][1]; for (var i = 1; i < pts.length; i++) d += ' L' + pts[i][0] + ' ' + pts[i][1]; return d; };

  /** 一个格的小图:田字格、书上的字淡淡叠着(overlay)、孩子的笔;numbers = 在每一笔起笔处标孩子写的先后 */
  var thumb = function (ch, strokes, overlay, numbers) {
    var svg = sv('svg', { viewBox: '0 0 1024 1024', 'class': 'tz' });
    var grid = sv('g', { 'class': 'grid' });
    grid.append(sv('rect', { x: 8, y: 8, width: 1008, height: 1008 }), sv('line', { x1: 512, y1: 8, x2: 512, y2: 1016 }), sv('line', { x1: 8, y1: 512, x2: 1016, y2: 512 }));
    var std = sv('g', { 'class': 'std', transform: HZ_T });
    var ink = sv('g', { 'class': 'ink', transform: HZ_T });
    svg.append(grid, std, ink);
    (strokes || []).forEach(function (s) { if (s.length) ink.append(sv('path', { d: pathD(s) })); });
    if (numbers) {
      var g = sv('g', { 'class': 'num' });
      (strokes || []).forEach(function (s, k) { if (!s.length) return; var x = s[0][0], y = 900 - s[0][1]; var c = sv('g', { transform: 'translate(' + x + ' ' + y + ')' }); c.append(sv('circle', { r: 46 })); var t = sv('text', { y: 22 }); t.textContent = String(k + 1); c.append(t); g.append(c); });
      svg.append(g);
    }
    if (overlay) glyph(ch).then(function (d) { if (d) d.strokes.forEach(function (p) { std.append(sv('path', { d: p })); }); });
    return svg;
  };

  var nums = function (xs) { return xs.map(function (x) { return x + 1; }).join('、'); };
  /** 一个字的一句(或几句) */
  var charNotes = function (ch, j, ink) {
    var out = [];
    if (!j.judged) { out.push('「' + ch + '」没有笔顺数据,没比对'); return out; }
    if (j.empty) { out.push('「' + ch + '」空着'); return out; }
    if (j.missing.length >= Math.ceil(j.std / 2)) out.push('「' + ch + '」和书上的字大半对不上(写了 ' + j.wrote + ' 笔,书上 ' + j.std + ' 笔),可能写成了别的字');
    else {
      if (j.missing.length) out.push('「' + ch + '」少了第 ' + nums(j.missing) + ' 笔' + (j.extra.length ? ',有 ' + j.extra.length + ' 笔对不上' : ''));
      else if (j.extra.length) out.push('「' + ch + '」多了 ' + j.extra.length + ' 笔对不上的');
    }
    if (!j.order) out.push('「' + ch + '」笔顺:写的先后是 ' + j.matched.filter(function (m) { return m !== null; }).map(function (m) { return m + 1; }).join(' ') + '(书上是 1 到 ' + j.std + ' 依次)');
    if (j.backwards.length) out.push('「' + ch + '」第 ' + nums(j.backwards) + ' 笔写反了方向');
    var pl = placeNote(j.place); if (pl) out.push('「' + ch + '」写得' + pl);
    if (ink && ink.undos) out.push('「' + ch + '」擦过 ' + ink.undos + ' 次');
    return out;
  };
  var placeNote = function (p) {
    if (!p) return null; var bits = [];
    if (p.size < 0.7) bits.push('偏小'); else if (p.size > 1.3) bits.push('偏大');
    var v = p.dy > 140 ? '上' : p.dy < -140 ? '下' : ''; var hh = p.dx < -140 ? '左' : p.dx > 140 ? '右' : '';
    if (v || hh) bits.push('偏' + hh + v);
    return bits.length ? bits.join('、') : null;
  };
  var wrong = function (a) { return a && a.judges.some(function (j) { return j.ask; }); };
  /** 写之前点了「不会写,给答案」的字(看了笔顺照着描红写的) */
  var revealedOf = function (a, chars) { return a ? chars.filter(function (ch, ci) { return a.chars[ci] && a.chars[ci].revealed; }) : []; };
  var smallIssues = function (a) { return a && a.judges.some(function (j) { return j.judged && !j.empty && (!j.order || j.backwards.length || placeNote(j.place)); }); };

  var render = function (s) {
    var body = $('#body'); body.replaceChildren();
    var n = s.words.length;
    var firstOk = s.first.filter(function (a) { return a && !wrong(a) && !a.chars.some(function (c) { return c.revealed; }); }).length;
    var revealedN = s.first.filter(function (a) { return a && a.chars.some(function (c) { return c.revealed; }); }).length;
    var fixed = s.asked.filter(function (i) { var r = s.rewrites.filter(function (x) { return x.word === i; }); return r.length && !wrong(r[r.length - 1].attempt); }).length;
    var selfs = s.rewrites.filter(function (r) { return r.self; }).map(function (r) { return r.word; }).filter(function (w, k, all) { return all.indexOf(w) === k; });
    var when = new Date(s.startedAt);
    var head = s.checkedAt
      ? n + ' 个词,' + firstOk + ' 个自己写全' + (revealedN ? ',' + revealedN + ' 个看了答案' : '')
      : '还在写:写了 ' + s.first.filter(Boolean).length + ' / ' + n + ' 个词';
    var line = s.checkedAt
      ? (s.asked.length ? '问了「再写一遍」的 ' + s.asked.length + ' 个,重写后写全的 ' + fixed + ' 个。' : '没有要问「再写一遍」的。') + '孩子自己点重写的 ' + selfs.length + ' 个。' + (s.doneAt ? '' : '还没点「对好了」。')
      : '';
    if (s.photo) body.append(h('div', { 'class': 'src' }, h('img', { src: '/api/dictation/photos/' + s.photo + '/image', alt: '拍的照片' }), h('span', { text: '拍照听写' + (s.lesson ? ' · ' + s.lesson : '') })));
    body.append(h('a', { 'class': 'reel', href: '/dictation/reel?id=' + encodeURIComponent(s.id) }, '看录像:这次是怎么写的 ›'));
    body.append(h('div', { 'class': 'sum' }, h('b', { text: head }), h('span', { text: (when.getMonth() + 1) + ' 月 ' + when.getDate() + ' 日 ' + String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0') + ' 开始。' + line })));

    var rows = s.words.map(function (w, i) {
      var a = s.first[i]; var rs = s.rewrites.filter(function (r) { return r.word === i; });
      var asked = s.asked.indexOf(i) >= 0;
      var orders = s.events.filter(function (e) { return e.kind === 'strokeOrder' && e.word === i; }).length;
      var shown = revealedOf(a, Array.from(w.chars));
      return { w: w, i: i, a: a, rs: rs, asked: asked, orders: orders, shown: shown, rank: !a ? 3 : shown.length || wrong(a) ? 0 : smallIssues(a) ? 1 : rs.length ? 1 : 2 };
    });
    var attention = rows.filter(function (r) { return r.rank < 2; }).sort(function (x, y) { return x.rank - y.rank || x.i - y.i; });
    var fine = rows.filter(function (r) { return r.rank === 2; });
    var waiting = rows.filter(function (r) { return r.rank === 3; });
    if (attention.length) body.append(h('div', { 'class': 'sec', text: '要看一下的' }));
    attention.forEach(function (r) { body.append(item(s, r)); });
    if (fine.length) body.append(h('div', { 'class': 'item' }, h('div', { 'class': 'head' }, h('div', { 'class': 'ok', text: fine.map(function (r) { return r.w.chars; }).join(' · ') }), h('span', { 'class': 'chip good', text: '写全了' }))));
    if (waiting.length) body.append(h('div', { 'class': 'muted', text: '还没写:' + waiting.map(function (r) { return r.w.chars; }).join('、') }));

    var again = rows.filter(function (r) { return r.a && (r.shown.length || wrong(r.a) || r.rs.length); }).map(function (r) { return r.w; });
    if (again.length) {
      body.append(h('div', { 'class': 'sec', text: '要再练的词:复制进 home/draft.md,下次听写' }));
      var fence = String.fromCharCode(96, 96, 96);
      var text = fence + 'dictation' + (s.tutor ? ' ' + s.tutor : '') + String.fromCharCode(10) + again.map(function (w) { return w.chars + (w.say ? ' ' + w.say : ''); }).join(String.fromCharCode(10)) + String.fromCharCode(10) + fence;
      var ta = h('textarea', { readonly: 'readonly' }); ta.value = text;
      ta.addEventListener('focus', function () { ta.select(); });
      body.append(ta);
    }
  };

  var item = function (s, r) {
    var chars = Array.from(r.w.chars);
    var chips = [];
    if (r.shown.length) chips.push(h('span', { 'class': 'chip warm', text: '看了答案:' + r.shown.join('、') }));
    else if (r.a && wrong(r.a)) chips.push(h('span', { 'class': 'chip warm', text: r.rs.length ? (r.asked ? '问了才改' : '自己改的') : '没写全' }));
    else if (r.rs.length) chips.push(h('span', { 'class': 'chip calm', text: '写全了 · 自己又写了' }));
    else chips.push(h('span', { 'class': 'chip calm', text: '写全了' }));
    if (r.orders) chips.push(h('span', { 'class': 'chip calm', text: '逐笔看过 ' + r.orders + ' 次' }));
    var att = function (a, label, overlay) {
      var ps = h('div', { 'class': 'ps' });
      chars.forEach(function (ch, ci) { var j = a.judges[ci]; ps.append(thumb(ch, a.chars[ci] ? a.chars[ci].strokes : [], overlay, j && j.judged && !j.order)); });
      return h('div', { 'class': 'att' }, ps, h('small', { text: label }));
    };
    var thumbs = h('div', { 'class': 'thumbs' }, att(r.a, '第一遍', true));
    r.rs.forEach(function (x, k) { thumbs.append(h('span', { 'class': 'arrow', text: '→' }), att(x.attempt, (x.self ? '自己重写' : '重写') + (r.rs.length > 1 ? ' ' + (k + 1) : ''), false)); });
    var notes = [];
    chars.forEach(function (ch, ci) { notes = notes.concat(charNotes(ch, r.a.judges[ci], r.a.chars[ci])); });
    var last = r.rs.length ? r.rs[r.rs.length - 1].attempt : null;
    if (last) notes.push(wrong(last) ? '重写的那遍还有对不上的:' + chars.map(function (ch, ci) { return charNotes(ch, last.judges[ci], null).join(';'); }).filter(Boolean).join(';') : '重写的那遍写全了');
    return h('div', { 'class': 'item' },
      h('div', { 'class': 'head' }, h('div', { 'class': 'w', text: r.w.chars }), h('div', { 'class': 'chips' }, chips)),
      thumbs,
      notes.length ? h('ul', {}, notes.map(function (t) { return h('li', { text: t }); })) : null);
  };

  var show = function (id) {
    var bs = document.querySelectorAll('#dates button'); for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].dataset.id === id);
    api('/api/dictation/' + id).then(render);
  };
  api('/api/dictation').then(function (j) {
    if (!j.sessions.length) { $('#body').replaceChildren(h('div', { 'class': 'empty', text: '还没有听写过。在首页(home/draft.md)放一张听写卡,孩子点开就能写。' })); return; }
    var box = $('#dates');
    j.sessions.forEach(function (s) {
      var d = new Date(s.startedAt);
      box.append(h('button', { 'data-id': s.id, on: { click: function () { show(s.id); } } }, (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' · ' + s.words.length + ' 词'));
    });
    show(j.sessions[0].id);
  });
})();
</script>
</body></html>`;
