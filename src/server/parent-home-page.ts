/**
 * 家长端「首页」(/parent/home,《家长板书页设计.md》拍板 20、27、28,原型 https://claude.ai/artifact/RDefXR1vYYWQTEwMoQpZLk 第二排):
 * 一位一位老师看孩子看到的那张牌(新话题气泡、开场按钮、常驻入口),点牌上的按钮改它(字、讲法、留多久);常驻入口(听写这周的词、口语课给老师的话)、
 * 这位老师在不在首页、排第几;再加孩子端常改的两项。宽屏(≥ 1000)三栏:左边老师(按住拖着排先后)与孩子端设置、中间那张牌、右边就地改;
 * 窄屏一栏,改按钮是整屏的表单。牌是这一页自己画的近似,不搬孩子端的代码。另一个标签「记录」是 /parent(孩子端页面的家长模式)。
 * 零依赖内联脚本,只走 /api/parent/*;每次现读,改了马上发到孩子的首页(src/server/parent-home.ts)。
 * 用 String.raw:脚本里的反斜杠原样留着;脚本里不写反引号和 ${。
 */
export const PARENT_HOME_PAGE = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="manifest" href="/parent/manifest.webmanifest">
<title>家长 · 首页</title>
<style>
  :root { --paper:#f6f5f1; --ink:#2b2b2b; --dim:#6b675f; --mute:#8a8781; --line:#efece5; --card:#fff; --accent:#b4531f; --ok:#2fa36b; --red:#c0392b; }
  * { box-sizing:border-box; }
  html,body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.5 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; -webkit-text-size-adjust:100%; }
  button, input, textarea { font:inherit; color:inherit; }
  .wrap { max-width:640px; margin:0 auto; padding:calc(env(safe-area-inset-top) + 20px) 16px calc(env(safe-area-inset-bottom) + 40px); display:flex; flex-direction:column; gap:16px; }
  .top { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:12px 20px; }
  .top b { font-size:20px; }
  .top small { color:var(--mute); font-size:13px; }
  .top .seg { order:3; flex:1 0 100%; }
  .seg { display:flex; padding:3px; border-radius:12px; background:#e9e6de; }
  .seg > * { flex:1; height:36px; border:0; border-radius:9px; background:transparent; font-size:15px; color:var(--dim); display:flex; align-items:center; justify-content:center; text-decoration:none; cursor:pointer; }
  .seg > .on { background:#fff; color:var(--ink); font-weight:600; box-shadow:0 1px 2px rgba(0,0,0,.08); }
  .who { display:flex; gap:4px; overflow-x:auto; }
  .mini { flex:none; width:76px; display:flex; flex-direction:column; align-items:center; gap:3px; border:0; border-radius:12px; background:transparent; font-size:13px; color:var(--mute); padding:4px 0; cursor:pointer; }
  .mini.on { color:var(--ink); font-weight:600; background:#fff; }
  .mini.hid .av { opacity:.4; }
  .av { position:relative; flex:none; width:48px; height:48px; display:grid; place-items:center; }
  .av svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
  .av circle { fill:none; stroke:currentColor; stroke-width:8; stroke-linecap:round; stroke-dasharray:221.17 55.29; transform-origin:50px 50px; transform:rotate(36deg); }
  .av .face { position:absolute; left:15%; top:15%; width:70%; height:70%; border-radius:50%; background:#fff; display:grid; place-items:center; font-size:17px; font-weight:700; overflow:hidden; }
  .av img { width:100%; height:100%; object-fit:cover; }
  .gh { font-size:13px; color:var(--mute); padding:0 16px 6px; display:flex; justify-content:space-between; align-items:center; }
  .grp { background:var(--card); border-radius:14px; overflow:hidden; }
  .it { display:flex; align-items:center; gap:10px; min-height:50px; padding:10px 14px; border:0; border-top:1px solid var(--line); background:var(--card); width:100%; text-align:left; }
  .it:first-child { border-top:0; }
  button.it { cursor:pointer; }
  .it .tx { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
  .it .tx b { font-size:16px; font-weight:500; }
  .it .tx small { font-size:13px; color:var(--dim); line-height:1.45; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; white-space:pre-line; }
  .tag { flex:none; font-size:12px; padding:2px 7px; border-radius:6px; background:#f3efe6; color:var(--dim); font-weight:500; }
  .chev { flex:none; color:#b9b5ac; }
  .sw { flex:none; width:50px; height:30px; border:0; border-radius:15px; background:#d9d5cc; position:relative; padding:0; cursor:pointer; transition:background .2s; }
  .sw::after { content:""; position:absolute; top:3px; left:3px; width:24px; height:24px; border-radius:50%; background:#fff; transition:left .2s; box-shadow:0 1px 2px rgba(0,0,0,.15); }
  .sw[aria-checked="true"] { background:var(--ok); }
  .sw[aria-checked="true"]::after { left:23px; }
  .sw:disabled { opacity:.4; }
  .step { display:flex; align-items:center; gap:8px; }
  .step button { width:40px; height:36px; border:1.5px solid #e2dfd6; border-radius:10px; background:#fff; cursor:pointer; }
  .step b { min-width:28px; text-align:center; }
  .fld { display:block; width:100%; border:1.5px solid #e2dfd6; border-radius:12px; background:#faf9f4; padding:10px 12px; font-size:16px; line-height:1.5; outline:none; resize:vertical; }
  .fld:focus { border-color:#e8743b; }
  .note { font-size:13px; color:var(--mute); padding:6px 16px 0; line-height:1.5; }
  .box { padding:12px 14px; display:flex; flex-direction:column; gap:10px; }
  .row2 { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .lnk { color:var(--accent); text-decoration:none; font-size:15px; }
  /* 孩子看到的那张牌(拍板 27):学科色的新话题气泡打头印名字的首字,按钮是大胶囊,听写是一条格子;点按钮改它 */
  .kc { position:relative; border-radius:24px; background:#fff; box-shadow:0 2px 0 #e9e6de, 0 10px 26px #2b2b2b12; padding:18px 18px 20px; display:flex; flex-direction:column; gap:12px; }
  .kc.off > :not(.kc-off) { opacity:.45; }
  .kc-hd { display:flex; align-items:center; gap:12px; }
  .kc-hd .av { width:56px; height:56px; }
  .kc-hd .av .face { font-size:21px; }
  .kc-hd b { font-size:20px; }
  .kc-new { display:flex; align-items:center; gap:14px; height:64px; padding:0 18px; border-radius:20px; background:var(--c); color:#fff; font-size:20px; font-weight:700; }
  .kc-new .ch { font-size:26px; padding-right:14px; border-right:2px solid #ffffff66; }
  .kc-new small { margin-left:auto; font-size:12px; font-weight:500; background:#ffffff33; padding:3px 8px; border-radius:6px; }
  .kc-b { display:flex; align-items:center; gap:10px; width:100%; min-height:52px; padding:6px 18px; border-radius:26px; border:2px solid #e9e6de; background:#fff; font-size:17px; font-weight:600; text-align:left; cursor:pointer; }
  .kc-b .ic { flex:none; color:var(--c); display:grid; place-items:center; }
  .kc-b .l { flex:1; min-width:0; }
  .kc-b.on, .kc-add.on { border-color:var(--ink); box-shadow:0 0 0 4px #2b2b2b1a; }
  .kc-add { height:46px; border:2px dashed #d9d5cc; border-radius:23px; background:transparent; color:var(--mute); font-size:15px; cursor:pointer; }
  .kc-x { display:flex; align-items:center; gap:10px; padding:10px 14px; border-radius:16px; background:#f6f5f1; font-size:15px; font-weight:600; }
  .kc-x .bx { flex:1; display:flex; gap:4px; }
  .kc-x .bx i { width:20px; height:20px; border-radius:4px; background:#fff; border:1px solid #e2dfd6; }
  .kc-x .go { height:32px; padding:0 14px; border-radius:16px; background:var(--c); color:#fff; font-size:14px; display:flex; align-items:center; }
  .kc-off { font-size:13px; color:var(--dim); text-align:center; }
  /* 宽屏左栏的老师:按住左边的点拖着排先后(拍板 28) */
  .tl { display:flex; flex-direction:column; gap:4px; }
  .tr { display:flex; align-items:center; gap:4px; height:62px; border:2px solid transparent; border-radius:12px; background:transparent; position:relative; }
  .tr.on { background:#fff; border-color:var(--ink); }
  .tr.hid .pick { opacity:.45; }
  .tr.drag { z-index:2; background:#fff; box-shadow:0 8px 20px #2b2b2b26; transition:none; }
  .tr.slide { transition:transform .15s; }
  .grip { flex:none; width:32px; height:52px; border:0; background:transparent; color:#b9b5ac; display:grid; place-items:center; cursor:grab; touch-action:none; }
  .pick { flex:1; min-width:0; display:flex; align-items:center; gap:10px; height:100%; border:0; background:transparent; text-align:left; cursor:pointer; padding:0 8px 0 0; }
  .pick .av { width:40px; height:40px; }
  .pick .av .face { font-size:15px; }
  .pick span { display:flex; flex-direction:column; gap:1px; min-width:0; }
  .pick b { font-size:15px; }
  .pick small { font-size:12px; color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .hint { padding:28px 20px; text-align:center; color:var(--dim); font-size:15px; line-height:1.6; }
  .btns { display:flex; gap:10px; align-items:center; }
  .btns .del { height:44px; padding:0 12px; border:0; background:transparent; color:var(--red); font-size:15px; cursor:pointer; }
  .btns .go { margin-left:auto; height:44px; padding:0 22px; border:0; border-radius:12px; background:var(--ink); color:#fff; font-size:15px; font-weight:600; cursor:pointer; }
  .btns .go:disabled { opacity:.35; }
  .x { height:44px; padding:0 10px; border:0; background:transparent; color:var(--accent); font-size:15px; cursor:pointer; }
  /* 改一个按钮 / 这周的词(窄屏):整屏盖上 */
  .sheet { position:fixed; inset:0; background:var(--paper); overflow:auto; z-index:10; display:none; }
  .sheet.on { display:block; }
  .nav { display:flex; align-items:center; justify-content:space-between; }
  .nav button { border:0; background:transparent; color:var(--accent); font-size:17px; min-height:44px; padding:0 4px; cursor:pointer; }
  .nav button:disabled { color:#c9c5bc; }
  .nav b { font-size:17px; }
  .danger { height:50px; border:0; border-radius:14px; background:#fff; color:var(--red); font-size:17px; cursor:pointer; }
  #toast { position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom) + 24px); transform:translateX(-50%); max-width:min(560px,calc(100% - 32px)); padding:12px 18px; border-radius:16px; background:#2b2b2bee; color:#fff; font-size:15px; display:none; z-index:20; white-space:pre-line; }
  #toast.on { display:block; }
  @media (min-width:1000px) {
    .wrap { max-width:1180px; padding:calc(env(safe-area-inset-top) + 22px) 28px 40px; gap:20px; }
    .top { align-items:center; justify-content:flex-start; }
    .top .seg { order:0; flex:0 0 260px; }
    .top small { margin-left:auto; }
    .who { display:none; }
    .cols { display:grid; grid-template-columns:270px minmax(0,400px) minmax(0,1fr); gap:22px; align-items:start; }
    .cols > div { display:flex; flex-direction:column; gap:18px; min-width:0; }
    .gh { padding:0 6px 6px; }
  }
</style></head><body>
<div class="wrap" id="main">
  <div class="top"><b id="title">家长</b><nav class="seg"><a class="on" href="/parent/home">首页</a><a href="/parent">记录</a></nav><small id="pub"></small></div>
  <div class="who" id="who"></div>
  <div id="body"></div>
</div>
<div class="sheet" id="sheet"><div class="wrap" id="sheet-in"></div></div>
<div id="toast"></div>
<script>
(() => {
  const $ = (s) => document.querySelector(s);
  const h = (tag, attrs, ...kids) => { const el = document.createElement(tag); for (const k in attrs || {}) { const v = attrs[k]; if (k === 'class') el.className = v; else if (k === 'on') { for (const e in v) el.addEventListener(e, v[e]); } else if (k === 'html') el.innerHTML = v; else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v); } for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c); return el; };
  const api = async (method, path, body) => { const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => null); if (!r.ok) throw new Error((j && (j.message || j.error)) || ('HTTP ' + r.status)); return j; };
  let toastTimer = 0;
  const toast = (s) => { const t = $('#toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3200); };
  const CHEV = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>';
  const GRIP = '<svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true"><g fill="currentColor"><circle cx="4" cy="4" r="1.6"></circle><circle cx="10" cy="4" r="1.6"></circle><circle cx="4" cy="9" r="1.6"></circle><circle cx="10" cy="9" r="1.6"></circle><circle cx="4" cy="14" r="1.6"></circle><circle cx="10" cy="14" r="1.6"></circle></g></svg>';
  const PLAY = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="currentColor"></path></svg>';
  const AGAIN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7"></path><path d="M20 4v5h-5"></path></svg>';
  // 学科色服务端定好随老师下发(src/lib/tutor-color.ts)
  const avatar = (t) => { const el = h('span', { class: 'av', style: 'color:' + t.color }); el.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"></circle></svg>'; const f = h('span', { class: 'face' }); if (t.avatar && /\.(png|jpe?g|webp|svg)$/i.test(t.avatar)) f.append(h('img', { src: '/api/kid/avatar/' + t.name, alt: '' })); else f.textContent = t.avatar || (t.subject || t.display || '?').slice(0, 1); el.append(f); return el; };
  const sw = (on, label, click, disabled) => h('button', { type: 'button', class: 'sw', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label, disabled: disabled || null, on: { click } });
  const md = (d) => Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10));
  // 留多久:只今天 = 今天;到周日 = 这周日(今天是周日就是今天);一直 = 不写
  const sunday = (today) => { const [y, m, d] = today.split('-').map(Number); const t = new Date(y, m - 1, d); t.setDate(t.getDate() + ((7 - t.getDay()) % 7)); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
  const keepTag = (b) => (!b.until ? '' : b.until === D.today ? '只今天' : b.until < D.today ? '过了' : '到 ' + md(b.until));
  const KIND = { start: '', continue: '接着', lecture: '小课堂', activity: '' };
  const BUTTONS_MAX = 4;
  const WIDE = window.matchMedia('(min-width:1000px)');

  let D = null; let cur = null;
  /** 宽屏右栏在改哪一个按钮:下标;-1 = 新加的开场按钮;null = 没选 */
  let sel = null;
  /** 右栏的表单改了还没发:这时别让心跳重画把字抹掉 */
  let dirty = false;
  const load = async () => {
    try { D = await api('GET', '/api/parent/home'); } catch (e) { toast('读不到:' + e.message); return; }
    document.title = D.title + ' · 家长';
    $('#title').textContent = D.title;
    $('#pub').textContent = D.home ? md(D.home.publishedAt.slice(0, 10)) + ' ' + new Date(D.home.publishedAt).toTimeString().slice(0, 5) + ' 发布 · 改了马上到孩子的首页' : '还没发布过';
    if (!cur || !D.tutors.some((t) => t.name === cur)) { cur = D.tutors[0] && D.tutors[0].name; sel = null; }
    render();
  };
  const save = async (method, path, body, ok) => {
    try { const r = await api(method, path, body); if (ok) toast(ok); return r; }
    catch (e) { toast('没改成:' + e.message); return null; }
    finally { await load(); }
  };
  const tutorOf = () => D.tutors.find((t) => t.name === cur);
  const choose = (name) => { if (name === cur) return; cur = name; sel = null; dirty = false; render(); };
  const setExtras = (t, kind, on) => {
    const now = t.extras.filter((x) => x !== kind);
    if (on) now.push(kind);
    return save('PATCH', '/api/parent/settings', { tutors: { [t.name]: { extras: now } } });
  };
  const putOrder = (names) => save('PUT', '/api/parent/home/order', { tutors: names });
  const summary = (t) => (t.hidden ? '不在首页上' : [t.buttons.length ? t.buttons.length + ' 个按钮' : '', ...t.extras.map((x) => (x === 'dictation' ? (t.lang === 'en' ? '单词听写' : '听写') : x === 'talk' ? '口语课' : '')).filter(Boolean)].filter(Boolean).join(' · ') || '只有新话题');

  // ---- 孩子看到的那张牌(拍板 27):点一个按钮改它 ----
  const kidCard = (t, onPick) => {
    const has = (k) => t.extras.includes(k);
    const words = (t.dictation || []).length;
    return h('div', { class: 'kc' + (t.hidden ? ' off' : ''), style: '--c:' + t.color, 'aria-label': '孩子看到的' },
      h('div', { class: 'kc-hd' }, avatar(t), h('b', {}, t.display)),
      h('div', { class: 'kc-new' }, h('span', { class: 'ch', 'aria-hidden': 'true' }, Array.from(t.display)[0] || ''), '新话题', h('small', {}, '总在')),
      ...t.buttons.map((b, k) => h('button', { type: 'button', class: 'kc-b' + (WIDE.matches && sel === k ? ' on' : ''), on: { click: () => onPick(k) } },
        h('span', { class: 'ic', html: b.kind === 'continue' ? AGAIN : PLAY }), h('span', { class: 'l' }, (KIND[b.kind] ? KIND[b.kind] + ' · ' : '') + b.label), keepTag(b) ? h('span', { class: 'tag' }, keepTag(b)) : null)),
      t.buttons.length < BUTTONS_MAX ? h('button', { type: 'button', class: 'kc-add' + (WIDE.matches && sel === -1 ? ' on' : ''), on: { click: () => onPick(-1) } }, '+ 加一个开场按钮') : null,
      has('dictation') ? h('div', { class: 'kc-x' }, h('span', {}, t.lang === 'en' ? '单词听写' : '听写'), h('span', { class: 'bx', 'aria-hidden': 'true' }, ...Array.from({ length: Math.min(words, 6) }, () => h('i'))), h('span', { class: 'go' }, words ? '去写' : '拍照听写')) : null,
      has('talk') ? h('div', { class: 'kc-x' }, h('span', { style: 'flex:1' }, '口语课'), h('span', { class: 'go' }, '开始')) : null,
      t.hidden ? h('div', { class: 'kc-off' }, '不在孩子的首页上') : null);
  };

  const render = () => {
    $('#who').replaceChildren(...D.tutors.map((t) => h('button', { type: 'button', class: 'mini' + (t.name === cur ? ' on' : '') + (t.hidden ? ' hid' : ''), on: { click: () => choose(t.name) } }, avatar(t), t.display.replace(/老师$/, ''))));
    const t = tutorOf();
    if (!t) { $('#body').replaceChildren(h('p', { class: 'note' }, '还没有老师(cotutor.json 里 -tutor 结尾、开着的)')); return; }
    const idx = D.tutors.indexOf(t);
    const wide = WIDE.matches;
    const pick = (k) => { if (!wide) { editButton(t, k); return; } sel = k; dirty = false; render(); setTimeout(() => { const el = $('#b-label'); if (el) el.focus(); }, 50); };
    const card = h('div', {}, h('div', { class: 'gh' }, h('span', {}, '孩子看到的 · 点一个按钮改它')), kidCard(t, pick),
      h('div', { class: 'note' }, '孩子一点,按钮上的字就当他说的第一句发给老师;老师照讲法开场。今天聊过的,孩子进老师页后在空白板上接,不占按钮。'));
    // 每天都在
    const has = (k) => t.extras.includes(k);
    const daily = [];
    daily.push(h('div', { class: 'it' }, h('span', { class: 'tx' }, h('b', {}, '听写'), h('small', {}, '拍照听写一直在;设了这周的词,孩子点「听写」直接写')), sw(has('dictation'), '听写', () => setExtras(t, 'dictation', !has('dictation')))));
    if (has('dictation') || t.dictation) daily.push(h('button', { type: 'button', class: 'it', on: { click: () => editWords(t) } }, h('span', { class: 'tx' }, h('b', {}, '这周的词'), h('small', {}, t.dictation && t.dictation.length ? t.dictation.length + ' 个词:' + t.dictation.map((w) => w.chars).join('、') : '还没设')), h('span', { class: 'chev', html: CHEV })));
    daily.push(h('div', { class: 'it' }, h('span', { class: 'tx' }, h('b', {}, '口语课'), h('small', {}, D.talk.enabled ? '用你最近给孩子的口语单' : '口语课没开(cotutor.json 的 talk.enabled)')), sw(has('talk'), '口语课', () => setExtras(t, 'talk', !has('talk')), !D.talk.enabled && !has('talk'))));
    if (has('talk')) {
      const note = h('textarea', { class: 'fld', rows: '3', placeholder: '这周学什么、想让老师多聊什么(孩子看不到)' }); note.value = D.talk.note;
      const mins = h('b', {}, String(D.talk.minutes));
      daily.push(h('div', { class: 'box' },
        h('label', { class: 'note', style: 'padding:0' }, '给老师的话(跟读和聊都带上;所有口语课一份)'), note,
        h('div', { class: 'row2' }, h('span', {}, '聊几分钟'), h('span', { class: 'step' }, h('button', { type: 'button', 'aria-label': '少一分钟', on: { click: () => save('PATCH', '/api/parent/settings', { talk: { minutes: Math.max(1, D.talk.minutes - 1) } }) } }, '−'), mins, h('button', { type: 'button', 'aria-label': '多一分钟', on: { click: () => save('PATCH', '/api/parent/settings', { talk: { minutes: Math.min(20, D.talk.minutes + 1) } }) } }, '+'))),
        h('div', { class: 'row2' }, h('a', { class: 'lnk', href: '/parent/talk' }, '拍口语单、看回放 ›'), h('button', { type: 'button', class: 'step', style: 'border:0;background:transparent;color:var(--accent);cursor:pointer', on: { click: () => save('PATCH', '/api/parent/settings', { talk: { note: note.value } }, '存好了') } }, '存给老师的话'))));
    }
    const extras = h('div', {}, h('div', { class: 'gh' }, h('span', {}, '每天都在' + (wide ? ' · ' + t.display : ''))), h('div', { class: 'grp' }, ...daily));
    // 这位老师:在不在首页;窄屏还有排第几(宽屏在左栏拖)
    const move = (d) => { const names = D.tutors.map((x) => x.name); const j = idx + d; [names[idx], names[j]] = [names[j], names[idx]]; return putOrder(names); };
    const self = h('div', {}, h('div', { class: 'gh' }, h('span', {}, '这位老师')), h('div', { class: 'grp' },
      h('div', { class: 'it' }, h('span', { class: 'tx' }, h('b', {}, '在孩子的首页上')), sw(!t.hidden, '在首页上', () => save('PATCH', '/api/parent/settings', { tutors: { [t.name]: { hidden: !t.hidden } } }))),
      wide ? null : h('div', { class: 'it' }, h('span', { class: 'tx' }, h('b', {}, '排在第 ' + (idx + 1)), h('small', {}, '首页一进来,排第一的在最前')), h('span', { class: 'step' },
        h('button', { type: 'button', 'aria-label': '往前', disabled: idx === 0 || null, on: { click: () => move(-1) } }, '↑'),
        h('button', { type: 'button', 'aria-label': '往后', disabled: idx === D.tutors.length - 1 || null, on: { click: () => move(1) } }, '↓')))));
    // 孩子端(所有老师一份)
    const day = h('b', {}, String(D.dailyMessages));
    const kid = h('div', {}, h('div', { class: 'gh' }, h('span', {}, '孩子端(所有老师)')), h('div', { class: 'grp' },
      h('div', { class: 'it' }, h('span', { class: 'tx' }, h('b', {}, '每天能问几条'), h('small', {}, '一位老师一天;到了头像变灰')), h('span', { class: 'step' },
        h('button', { type: 'button', 'aria-label': '少五条', on: { click: () => save('PATCH', '/api/parent/settings', { dailyMessages: Math.max(0, D.dailyMessages - 5) }) } }, '−'), day,
        h('button', { type: 'button', 'aria-label': '多五条', on: { click: () => save('PATCH', '/api/parent/settings', { dailyMessages: D.dailyMessages + 5 }) } }, '+'))),
      h('div', { class: 'box' }, h('div', { class: 'row2' }, h('span', {}, '按住说话怎么听'), h('span', { class: 'seg', style: 'width:180px' },
        ...[['browser', '浏览器'], ['omni', 'omni']].map(([v, l]) => h('button', { type: 'button', class: D.listen === v ? 'on' : '', on: { click: () => { if (D.listen !== v) save('PATCH', '/api/parent/settings', { listen: v }); } } }, l)))),
        h('div', { class: 'note', style: 'padding:0' }, 'omni:松手后原声交给百炼再听一遍,认得更准,要百炼的 key'))));
    if (!wide) { $('#body').replaceChildren(h('div', { style: 'display:flex;flex-direction:column;gap:18px' }, card, extras, self, kid)); return; }
    // 宽屏三栏:左老师与孩子端、中间那张牌、右边就地改
    const list = h('div', {}, h('div', { class: 'gh' }, h('span', {}, '老师 · 按住左边的点拖着排先后')), tutorList());
    const pane = sel === null || (sel >= 0 && !t.buttons[sel])
      ? h('div', { class: 'grp hint' }, '点中间牌上的按钮改它的字和讲法,', h('br'), '或者加一个开场按钮。')
      : inlineForm(t, sel);
    $('#body').replaceChildren(h('div', { class: 'cols' }, h('div', {}, list, kid), h('div', {}, card), h('div', {}, pane, extras, self)));
  };

  // ---- 宽屏左栏:老师一行一个,按住左边的点拖着排先后(拍板 28);点名字看这位老师 ----
  const tutorList = () => {
    const box = h('div', { class: 'tl' });
    const rows = D.tutors.map((t, i) => {
      const grip = h('button', { type: 'button', class: 'grip', html: GRIP, 'aria-label': '拖着排 ' + t.display + ' 的先后(上下键也能挪)' });
      const row = h('div', { class: 'tr' + (t.name === cur ? ' on' : '') + (t.hidden ? ' hid' : ''), 'data-tutor': t.name }, grip,
        h('button', { type: 'button', class: 'pick', on: { click: () => choose(t.name) } }, avatar(t), h('span', {}, h('b', {}, t.display), h('small', {}, summary(t)))));
      grip.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        if (!d || i + d < 0 || i + d >= D.tutors.length) return;
        e.preventDefault();
        const names = D.tutors.map((x) => x.name); [names[i], names[i + d]] = [names[i + d], names[i]];
        putOrder(names).then(() => { const g = document.querySelectorAll('.tl .grip')[i + d]; if (g) g.focus(); });
      });
      grip.addEventListener('pointerdown', (e) => startDrag(e, row, i, rows));
      return row;
    });
    box.append(...rows);
    return box;
  };
  const startDrag = (e, row, from, rows) => {
    e.preventDefault();
    const step = row.getBoundingClientRect().height + 4;
    const y0 = e.clientY; let to = from;
    row.classList.add('drag');
    for (const r of rows) if (r !== row) r.classList.add('slide');
    const grip = e.currentTarget; grip.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const dy = ev.clientY - y0;
      to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / step)));
      row.style.transform = 'translateY(' + dy + 'px)';
      rows.forEach((r, j) => { if (r === row) return; const shift = from < to && j > from && j <= to ? -step : from > to && j < from && j >= to ? step : 0; r.style.transform = shift ? 'translateY(' + shift + 'px)' : ''; });
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove); grip.removeEventListener('pointerup', onUp); grip.removeEventListener('pointercancel', onUp);
      if (to === from) { for (const r of rows) { r.style.transform = ''; r.classList.remove('drag', 'slide'); } return; }
      const names = D.tutors.map((x) => x.name); const [n] = names.splice(from, 1); names.splice(to, 0, n);
      putOrder(names);
    };
    grip.addEventListener('pointermove', onMove); grip.addEventListener('pointerup', onUp); grip.addEventListener('pointercancel', onUp);
  };

  // ---- 改一个按钮的表单(k = -1 是新加的开场按钮):窄屏整屏盖上,宽屏在右栏 ----
  const buttonForm = (t, k, done) => {
    const b = k >= 0 ? Object.assign({}, t.buttons[k]) : { kind: 'start', label: '', until: D.today };
    const label = h('input', { class: 'fld', id: 'b-label', maxlength: '40', placeholder: '孩子的口吻,如「我要预习小蝌蚪找妈妈」' }); label.value = b.label;
    const brief = h('textarea', { class: 'fld', id: 'b-brief', rows: '5', placeholder: '写给老师的:从哪开始、重点是什么、讲到哪收' }); brief.value = b.brief || '';
    const count = h('span', {});
    const go = h('button', { type: 'button', class: 'go' }, '发布');
    const keeps = [['', '一直留着'], [D.today, '只今天'], [sunday(D.today), '到周日']];
    let keep = !b.until ? '' : b.until === D.today ? D.today : sunday(D.today);
    if (b.until && b.until !== D.today && b.until !== sunday(D.today)) keeps.push([b.until, '到 ' + md(b.until)]), keep = b.until;
    const seg = h('div', { class: 'seg' });
    const drawSeg = () => seg.replaceChildren(...keeps.map(([v, l]) => h('button', { type: 'button', class: v === keep ? 'on' : '', on: { click: () => { keep = v; dirty = true; drawSeg(); } } }, l)));
    const sync = () => { const n = Array.from(label.value.trim()).length; count.textContent = n + ' / 16'; count.style.color = n > 16 ? 'var(--red)' : ''; go.disabled = !n || n > 16; };
    label.addEventListener('input', () => { dirty = true; sync(); });
    brief.addEventListener('input', () => { dirty = true; });
    drawSeg(); sync();
    go.addEventListener('click', async () => {
      const nb = Object.assign({}, b, { label: label.value.trim(), brief: brief.value.trim() || undefined, until: keep || undefined });
      const list = k >= 0 ? t.buttons.map((x, j) => (j === k ? nb : x)) : t.buttons.concat([nb]);
      go.disabled = true; dirty = false;
      const r = await save('PUT', '/api/parent/home/tutors/' + encodeURIComponent(t.name) + '/buttons', { buttons: list }, '发布了');
      if (r) done(k >= 0 ? k : list.length - 1); else go.disabled = false;
    });
    const del = k >= 0 ? h('button', { type: 'button', class: 'del', on: { click: async () => { dirty = false; const r = await save('PUT', '/api/parent/home/tutors/' + encodeURIComponent(t.name) + '/buttons', { buttons: t.buttons.filter((_x, j) => j !== k) }, '删掉了'); if (r) done(null); } } }, '删掉这个按钮') : null;
    const what = b.kind === 'continue' ? '接着 ' + md(b.date) + ' 的话题 ' + b.thread : b.kind === 'lecture' ? '小课堂 ' + b.bundle : b.kind === 'activity' ? 'activity ' + b.activity : '';
    return {
      title: t.display + ' · ' + (k >= 0 ? '改按钮' : '开场按钮'), go, del, label,
      fields: [
        what ? h('div', { class: 'note' }, what + '(从 Claude Code 排的,这里只改字和讲法)') : null,
        h('div', {}, h('div', { class: 'gh' }, h('label', { for: 'b-label' }, '按钮上的字(孩子的口吻)'), count), label),
        h('div', {}, h('div', { class: 'gh' }, h('label', { for: 'b-brief' }, '讲法(写给老师,孩子看不到)')), brief),
        h('div', {}, h('div', { class: 'gh' }, h('span', {}, '留多久')), seg),
      ],
    };
  };
  const inlineForm = (t, k) => {
    const f = buttonForm(t, k, (next) => { sel = next; render(); });
    const close = h('button', { type: 'button', class: 'x', on: { click: () => { sel = null; dirty = false; render(); } } }, '收起');
    return h('div', { class: 'grp box', id: 'pane' }, h('div', { class: 'row2' }, h('b', { style: 'font-size:17px' }, f.title), close), ...f.fields, h('div', { class: 'btns' }, f.del, f.go));
  };
  const openSheet = (...kids) => { $('#sheet-in').replaceChildren(...kids); $('#sheet').classList.add('on'); window.scrollTo(0, 0); };
  const closeSheet = () => $('#sheet').classList.remove('on');
  const editButton = (t, k) => {
    const f = buttonForm(t, k, () => closeSheet());
    openSheet(h('div', { class: 'nav' }, h('button', { type: 'button', on: { click: () => { dirty = false; closeSheet(); } } }, '取消'), h('b', {}, f.title), f.go), ...f.fields, f.del ? h('button', { type: 'button', class: 'danger', on: { click: () => f.del.click() } }, '删掉这个按钮') : null);
    setTimeout(() => f.label.focus(), 50);
  };

  // ---- 这周的词:一行一个,念法空一格写在后面 ----
  const editWords = (t) => {
    const en = t.lang === 'en';
    const ta = h('textarea', { class: 'fld', id: 'w-text', rows: '10', placeholder: en ? 'red\nyellow yellow, a yellow bus\nice-cream' : '春天\n鼓励 鼓励,老师鼓励我的鼓励\n叶 树叶的叶' });
    ta.value = (t.dictation || []).map((w) => (w.say ? w.chars + ' ' + w.say : w.chars)).join('\n');
    const go = h('button', { type: 'button' }, '发布');
    const parse = () => ta.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = /^(\S+)(?:\s+(.+))?$/.exec(l); return m[2] ? { chars: m[1], say: m[2] } : { chars: m[1] }; });
    go.addEventListener('click', async () => { go.disabled = true; const r = await save('PUT', '/api/parent/home/tutors/' + encodeURIComponent(t.name) + '/dictation', { words: parse() }, '发布了'); if (r) closeSheet(); else go.disabled = false; });
    openSheet(
      h('div', { class: 'nav' }, h('button', { type: 'button', on: { click: closeSheet } }, '取消'), h('b', {}, t.display + ' · 这周的词'), go),
      h('div', {}, h('div', { class: 'gh' }, h('label', { for: 'w-text' }, '一行一个词,念法空一格写在后面')), ta),
      // 英语老师:一键用最近给孩子的口语单上的单词(口语课拍的那页)
      en ? h('button', { type: 'button', class: 'it', style: 'border-radius:14px', on: { click: async () => { try { const j = await api('GET', '/api/talk'); const last = (j.talks || []).find((x) => (x.status === 'ready' || x.status === 'done') && x.list.words.length); const ws = last ? last.list.words.map((w) => String(w.en || '').trim()).filter((w) => /^[A-Za-z][A-Za-z'-]*$/.test(w)) : []; if (!ws.length) return toast('口语单上没有单词'); ta.value = ws.slice(0, 20).join('\n'); } catch (e) { toast('读不到口语单'); } } } }, h('span', { class: 'tx' }, h('b', { style: 'color:var(--accent)' }, '用口语单上的单词'), h('small', {}, '最近给孩子的那份口语单')))  : null,
      h('div', { class: 'note' }, en ? '一行一个英文单词,念法空一格写在后面,最多 20 个。孩子点「单词听写」,老师一个一个念,每个念两遍;他在四线三格里写整个单词,写完自己对。清空 = 不要这周的词。' : '一个词一到四个汉字,最多 20 个。孩子点「听写」,老师一个一个念,每个念两遍。清空 = 不要这周的词。想从课本上挑,在孩子的 iPad 上点「拍照听写」。'));
  };

  load();
  WIDE.addEventListener('change', () => { if (D) { closeSheet(); render(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#sheet').classList.contains('on') && !dirty) load(); });
})();
</script>
</body></html>
`;
