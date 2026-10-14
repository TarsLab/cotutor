/**
 * 家长端「首页」(/parent/home,《家长板书页设计.md》拍板 20、33、34):
 * 左边(手机上是上面)是孩子端首页本身——iframe 装 /preview(孩子端页面的预览模式),按孩子设备的尺寸开、等比缩进来,可切 iPad / 手机;
 * 点牌上的按钮在旁边改它(字、讲法、留多久),改字时牌上跟着变;点后面那张牌换老师;听写、口语课点了去改这周的词、口语课。
 * 预览下面一排是老师的先后(按住左右拖)、孩子看不到的按钮、加一个开场按钮;右边是改着的那颗、这位老师「每天都在」的、在不在首页、孩子端常改的两项。
 * 另一个标签「记录」是 /parent。零依赖内联脚本,只走 /api/parent/*;每次现读,改了马上发到孩子的首页(src/server/parent-home.ts)。
 * iframe 一挪地方就会重新加载:它在 #pv 里常驻,重画只动 #pv-under 与 #body。
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
  /* 孩子端首页本身(拍板 33):iframe 按孩子设备的尺寸开,等比缩到这一栏 */
  .pvh { display:flex; align-items:center; gap:10px; padding:0 4px 8px; }
  .pvh > span:first-child { flex:1; font-size:13px; color:var(--mute); }
  .pvh .seg { flex:none; width:150px; }
  .pvh .seg > * { height:30px; font-size:13px; }
  #pvbox { position:relative; margin:0 auto; border-radius:18px; overflow:hidden; background:#faf9f4; box-shadow:0 0 0 1px #e2dfd6, 0 10px 26px #2b2b2b14; }
  #pvf { position:absolute; left:0; top:0; border:0; transform-origin:0 0; background:#faf9f4; }
  #pvoff { position:absolute; left:0; right:0; top:0; padding:10px 14px; background:#2b2b2bdd; color:#fff; font-size:14px; text-align:center; display:none; z-index:2; }
  #pvoff.on { display:block; }
  #pv-under { display:flex; flex-direction:column; gap:14px; padding-top:14px; }
  .addb { height:46px; border:2px dashed #d9d5cc; border-radius:23px; background:transparent; color:var(--dim); font-size:15px; cursor:pointer; }
  /* 老师的先后(拍板 34):一位一个,按住左右拖;点一下看这位老师 */
  .ord { display:flex; gap:6px; overflow-x:auto; padding:2px; }
  .ch { position:relative; flex:0 0 84px; display:flex; flex-direction:column; align-items:center; gap:3px; padding:8px 0; border:2px solid transparent; border-radius:14px; background:transparent; font-size:13px; color:var(--dim); cursor:grab; touch-action:pan-y; user-select:none; -webkit-user-select:none; }
  .ch.on { background:#fff; border-color:var(--ink); color:var(--ink); font-weight:600; }
  .ch.hid .av { opacity:.4; }
  .ch small { font-size:11px; color:var(--mute); font-weight:400; }
  .ch .n { position:absolute; left:8px; top:6px; font-size:11px; color:var(--mute); font-weight:600; }
  .ch.drag { z-index:2; background:#fff; box-shadow:0 8px 20px #2b2b2b26; cursor:grabbing; }
  .ch.slide { transition:transform .15s; }
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
  .main { display:flex; flex-direction:column; gap:18px; }
  #body > div { display:flex; flex-direction:column; gap:18px; }
  @media (min-width:1000px) {
    .wrap { max-width:1180px; padding:calc(env(safe-area-inset-top) + 22px) 28px 40px; gap:20px; }
    .top { align-items:center; justify-content:flex-start; }
    .top .seg { order:0; flex:0 0 260px; }
    .top small { margin-left:auto; }
    .main { display:grid; grid-template-columns:minmax(0,1fr) 380px; gap:22px; align-items:start; }
    .gh { padding:0 6px 6px; }
  }
</style></head><body>
<div class="wrap" id="main">
  <div class="top"><b id="title">家长</b><nav class="seg"><a class="on" href="/parent/home">首页</a><a href="/parent">记录</a></nav><small id="pub"></small></div>
  <div class="main">
    <section id="pv" aria-label="孩子看到的首页">
      <div class="pvh"><span>孩子看到的首页 · 点牌上的按钮改它,点后面那张换老师</span><span class="seg" id="pvdev"><button type="button" data-d="tablet">iPad</button><button type="button" data-d="phone">手机</button></span></div>
      <div id="pvbox"><div id="pvoff"></div><iframe id="pvf" title="孩子看到的首页"></iframe></div>
      <div id="pv-under"></div>
    </section>
    <div id="body"></div>
  </div>
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
  const BUTTONS_MAX = 4;
  const WIDE = window.matchMedia('(min-width:1000px)');

  let D = null; let cur = null;
  /** 在改哪一个按钮(宽屏右栏):下标;-1 = 新加的开场按钮;null = 没选 */
  let sel = null;
  /** 右栏的表单改了还没发:这时别让心跳重画把字抹掉 */
  let dirty = false;
  /** 预览里改着的(只在预览里,发布了才到孩子那边):edit = 改的那颗 {k, kind, label, until},add = 新加那颗的字 */
  let draft = { edit: null, add: null };

  // ---- 孩子端首页本身(拍板 33):iframe 装 /preview,按孩子设备的尺寸开,等比缩进来 ----
  const SIZES = { tablet: [1180, 820], phone: [390, 844] };
  // 缺省跟着这块屏幕(宽屏看 iPad 的样子、手机看手机的);家长点过就记住
  let picked = null; try { picked = localStorage.getItem('parent-home-dev'); } catch (e) {}
  if (picked !== 'tablet' && picked !== 'phone') picked = null;
  let dev = picked || (WIDE.matches ? 'tablet' : 'phone');
  const fit = () => {
    const box = $('#pvbox'), f = $('#pvf'), wh = SIZES[dev], room = $('#pv').clientWidth;
    const k = Math.min(1, room / wh[0], (dev === 'phone' ? 640 : 2000) / wh[1]);
    box.style.width = Math.round(wh[0] * k) + 'px'; box.style.height = Math.round(wh[1] * k) + 'px';
    f.style.width = wh[0] + 'px'; f.style.height = wh[1] + 'px'; f.style.transform = 'scale(' + k + ')';
    for (const b of document.querySelectorAll('#pvdev button')) b.classList.toggle('on', b.dataset.d === dev);
  };
  const pvSet = (o) => { try { const w = $('#pvf').contentWindow; if (w && typeof w.cotutorPreviewSet === 'function') w.cotutorPreviewSet(o); } catch (e) {} };
  /** 告诉预览:最前那张是谁、在改哪颗、改成什么;reload = 发布了,重读孩子的首页 */
  const pvSync = (reload) => pvSet({ front: cur, pv: cur ? { tutor: cur, sel: sel === null ? null : sel === -1 ? 'draft' : sel, edit: draft.edit, add: draft.add } : null, reload: Boolean(reload) });
  // 预览里点了什么(孩子端页面经 window.parent.cotutorPreview 说):换老师、改哪颗、去改这周的词 / 口语课
  window.cotutorPreview = (ev) => {
    if (!ev || !D) return;
    if (ev.act === 'ready') { pvSync(); return; }
    const t = D.tutors.find((x) => x.name === ev.tutor);
    if (!t) return;
    if (t.name !== cur) choose(t.name, true);
    if (ev.act === 'button') { if (ev.id === 'new') toast('「新话题」是应用自己加的,一直在第一个,这里改不了'); else if (typeof ev.id === 'number') pick(ev.id); }
    else if (ev.act === 'extra') { if (ev.kind === 'dictation') editWords(t); else { const el = $('#daily-talk'); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
  };
  for (const b of document.querySelectorAll('#pvdev button')) b.addEventListener('click', () => { dev = picked = b.dataset.d; try { localStorage.setItem('parent-home-dev', dev); } catch (e) {} fit(); });
  window.addEventListener('resize', fit);

  const load = async () => {
    try { D = await api('GET', '/api/parent/home'); } catch (e) { toast('读不到:' + e.message); return; }
    document.title = D.title + ' · 家长';
    $('#title').textContent = D.title;
    $('#pub').textContent = D.home ? md(D.home.publishedAt.slice(0, 10)) + ' ' + new Date(D.home.publishedAt).toTimeString().slice(0, 5) + ' 发布 · 改了马上到孩子的首页' : '还没发布过';
    if (!cur || !D.tutors.some((t) => t.name === cur)) { const first = D.tutors.find((t) => !t.hidden) || D.tutors[0]; cur = first && first.name; sel = null; draft = { edit: null, add: null }; }
    if (!$('#pvf').getAttribute('src')) $('#pvf').setAttribute('src', '/preview?front=' + encodeURIComponent(cur || ''));
    render();
  };
  const save = async (method, path, body, ok) => {
    try { const r = await api(method, path, body); if (ok) toast(ok); draft = { edit: null, add: null }; return r; }
    catch (e) { toast('没改成:' + e.message); return null; }
    finally { await load(); pvSync(true); }
  };
  const tutorOf = () => D.tutors.find((t) => t.name === cur);
  /** 看哪位老师;fromPreview = 预览里换过去的,不用再告诉它 */
  const choose = (name, fromPreview) => { if (name === cur) return; cur = name; sel = null; dirty = false; draft = { edit: null, add: null }; render(); if (!fromPreview) pvSync(); };
  /** 改第 k 颗(-1 = 加一个):宽屏在右栏,窄屏整屏的表单 */
  const pick = (k) => {
    const t = tutorOf(); if (!t) return;
    if (!WIDE.matches) { editButton(t, k); return; }
    sel = k; dirty = false; draft = { edit: null, add: null }; render();
    setTimeout(() => { const el = $('#b-label'); if (el) el.focus(); }, 50);
  };
  const setExtras = (t, kind, on) => {
    const now = t.extras.filter((x) => x !== kind);
    if (on) now.push(kind);
    return save('PATCH', '/api/parent/settings', { tutors: { [t.name]: { extras: now } } });
  };
  const putOrder = (names) => save('PUT', '/api/parent/home/order', { tutors: names });

  // ---- 老师的先后(拍板 34):一位一个,按住左右拖;点一下看这位老师;左右键也能挪 ----
  const orderRow = () => {
    const box = h('div', { class: 'ord' });
    const chips = D.tutors.map((t, i) => {
      const c = h('button', { type: 'button', class: 'ch' + (t.name === cur ? ' on' : '') + (t.hidden ? ' hid' : ''), 'data-tutor': t.name, 'aria-label': t.display + ' 排第 ' + (i + 1) + '(左右键挪)' }, h('span', { class: 'n' }, String(i + 1)), avatar(t), t.display.replace(/老师$/, ''), t.hidden ? h('small', {}, '不在首页') : null);
      // 键盘回车 / 空格(detail 0)是点;手指与鼠标的点在 pointerup 里分辨(没拖才算)
      c.addEventListener('click', (e) => { if (e.detail === 0) choose(t.name); });
      c.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        if (!d || i + d < 0 || i + d >= D.tutors.length) return;
        e.preventDefault();
        const names = D.tutors.map((x) => x.name); [names[i], names[i + d]] = [names[i + d], names[i]];
        putOrder(names).then(() => { const g = document.querySelectorAll('.ord .ch')[i + d]; if (g) g.focus(); });
      });
      c.addEventListener('pointerdown', (e) => startDrag(e, c, i, chips));
      return c;
    });
    box.append(...chips);
    return box;
  };
  const startDrag = (e, el, from, all) => {
    const x0 = e.clientX, step = el.getBoundingClientRect().width + 6;
    let to = from, moved = false;
    const onMove = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 8) return;
      if (!moved) { moved = true; try { el.setPointerCapture(e.pointerId); } catch (x) {} el.classList.add('drag'); for (const r of all) if (r !== el) r.classList.add('slide'); }
      to = Math.max(0, Math.min(all.length - 1, from + Math.round(dx / step)));
      el.style.transform = 'translateX(' + dx + 'px)';
      all.forEach((r, j) => { if (r === el) return; const sh = from < to && j > from && j <= to ? -step : from > to && j < from && j >= to ? step : 0; r.style.transform = sh ? 'translateX(' + sh + 'px)' : ''; });
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
      if (!moved) { choose(D.tutors[from].name); return; }
      if (to === from) { for (const r of all) { r.style.transform = ''; r.classList.remove('drag', 'slide'); } return; }
      const names = D.tutors.map((x) => x.name); const n = names.splice(from, 1)[0]; names.splice(to, 0, n);
      // 拖的是谁就看谁:预览里他抽到最前,能看到排过之后的牌堆
      cur = n; sel = null; dirty = false; draft = { edit: null, add: null };
      putOrder(names);
    };
    el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
  };

  const render = () => {
    fit();
    const t = tutorOf();
    const off = $('#pvoff');
    off.classList.toggle('on', Boolean(t && t.hidden));
    off.textContent = t && t.hidden ? t.display + '现在不在孩子的首页上(「在孩子的首页上」打开)' : '';
    // 预览下面:老师的先后、孩子看不到的按钮、加一个开场按钮
    const under = [h('div', {}, h('div', { class: 'gh' }, h('span', {}, '老师的先后 · 按住左右拖,排第一的在最前')), orderRow())];
    if (t) {
      const gone = t.buttons.map((b, k) => ({ b, k })).filter((x) => x.b.until && x.b.until < D.today);
      if (gone.length) under.push(h('div', {}, h('div', { class: 'gh' }, h('span', {}, '孩子现在看不到的按钮(留到的日子过了)')), h('div', { class: 'grp' }, ...gone.map((x) => h('button', { type: 'button', class: 'it', on: { click: () => pick(x.k) } }, h('span', { class: 'tx' }, h('b', {}, x.b.label), x.b.brief ? h('small', {}, '讲法:' + x.b.brief) : null), h('span', { class: 'tag' }, '过了'), h('span', { class: 'chev', html: CHEV }))))));
      if (t.buttons.length < BUTTONS_MAX) under.push(h('button', { type: 'button', class: 'addb', on: { click: () => pick(-1) } }, '+ 给' + t.display + '加一个开场按钮'));
    }
    $('#pv-under').replaceChildren(...under);
    if (!t) { $('#body').replaceChildren(h('p', { class: 'note' }, '还没有老师(cotutor.json 里 -tutor 结尾、开着的)')); return; }
    const wide = WIDE.matches;
    // 每天都在
    const has = (k) => t.extras.includes(k);
    const daily = [];
    daily.push(h('div', { class: 'it' }, h('span', { class: 'tx' }, h('b', {}, '听写'), h('small', {}, '拍照听写一直在;设了这周的词,孩子点「听写」直接写')), sw(has('dictation'), '听写', () => setExtras(t, 'dictation', !has('dictation')))));
    if (has('dictation') || t.dictation) daily.push(h('button', { type: 'button', class: 'it', on: { click: () => editWords(t) } }, h('span', { class: 'tx' }, h('b', {}, '这周的词'), h('small', {}, t.dictation && t.dictation.length ? t.dictation.length + ' 个词:' + t.dictation.map((w) => w.chars).join('、') : '还没设')), h('span', { class: 'chev', html: CHEV })));
    daily.push(h('div', { class: 'it', id: 'daily-talk' }, h('span', { class: 'tx' }, h('b', {}, '口语课'), h('small', {}, D.talk.enabled ? '用你最近给孩子的口语单' : '口语课没开(cotutor.json 的 talk.enabled)')), sw(has('talk'), '口语课', () => setExtras(t, 'talk', !has('talk')), !D.talk.enabled && !has('talk'))));
    if (has('talk')) {
      const note = h('textarea', { class: 'fld', rows: '3', placeholder: '这周学什么、想让老师多聊什么(孩子看不到)' }); note.value = D.talk.note;
      const mins = h('b', {}, String(D.talk.minutes));
      daily.push(h('div', { class: 'box' },
        h('label', { class: 'note', style: 'padding:0' }, '给老师的话(跟读和聊都带上;所有口语课一份)'), note,
        h('div', { class: 'row2' }, h('span', {}, '聊几分钟'), h('span', { class: 'step' }, h('button', { type: 'button', 'aria-label': '少一分钟', on: { click: () => save('PATCH', '/api/parent/settings', { talk: { minutes: Math.max(1, D.talk.minutes - 1) } }) } }, '−'), mins, h('button', { type: 'button', 'aria-label': '多一分钟', on: { click: () => save('PATCH', '/api/parent/settings', { talk: { minutes: Math.min(20, D.talk.minutes + 1) } }) } }, '+'))),
        h('div', { class: 'row2' }, h('a', { class: 'lnk', href: '/parent/talk' }, '拍口语单、看回放 ›'), h('button', { type: 'button', class: 'step', style: 'border:0;background:transparent;color:var(--accent);cursor:pointer', on: { click: () => save('PATCH', '/api/parent/settings', { talk: { note: note.value } }, '存好了') } }, '存给老师的话'))));
    }
    const extras = h('div', {}, h('div', { class: 'gh' }, h('span', {}, '每天都在 · ' + t.display)), h('div', { class: 'grp' }, ...daily));
    const self = h('div', {}, h('div', { class: 'gh' }, h('span', {}, '这位老师')), h('div', { class: 'grp' },
      h('div', { class: 'it' }, h('span', { class: 'tx' }, h('b', {}, '在孩子的首页上')), sw(!t.hidden, '在首页上', () => save('PATCH', '/api/parent/settings', { tutors: { [t.name]: { hidden: !t.hidden } } })))));
    // 孩子端(所有老师一份)
    const day = h('b', {}, String(D.dailyMessages));
    const kid = h('div', {}, h('div', { class: 'gh' }, h('span', {}, '孩子端(所有老师)')), h('div', { class: 'grp' },
      h('div', { class: 'it' }, h('span', { class: 'tx' }, h('b', {}, '每天能问几条'), h('small', {}, '一位老师一天;到了头像变灰')), h('span', { class: 'step' },
        h('button', { type: 'button', 'aria-label': '少五条', on: { click: () => save('PATCH', '/api/parent/settings', { dailyMessages: Math.max(0, D.dailyMessages - 5) }) } }, '−'), day,
        h('button', { type: 'button', 'aria-label': '多五条', on: { click: () => save('PATCH', '/api/parent/settings', { dailyMessages: D.dailyMessages + 5 }) } }, '+'))),
      h('div', { class: 'box' }, h('div', { class: 'row2' }, h('span', {}, '按住说话怎么听'), h('span', { class: 'seg', style: 'width:180px' },
        ...[['browser', '浏览器'], ['omni', 'omni']].map(([v, l]) => h('button', { type: 'button', class: D.listen === v ? 'on' : '', on: { click: () => { if (D.listen !== v) save('PATCH', '/api/parent/settings', { listen: v }); } } }, l)))),
        h('div', { class: 'note', style: 'padding:0' }, 'omni:松手后原声交给百炼再听一遍,认得更准,要百炼的 key'))));
    const pane = !wide ? null : sel === null || (sel >= 0 && !t.buttons[sel])
      ? h('div', { class: 'grp hint' }, '点左边牌上的按钮,在这里改它的字和讲法;', h('br'), '改的时候牌上跟着变,点「发布」才到孩子那边。')
      : inlineForm(t, sel);
    $('#body').replaceChildren(h('div', {}, pane, extras, self, kid));
  };

  // ---- 改一个按钮的表单(k = -1 是新加的开场按钮):窄屏整屏盖上,宽屏在右栏;预览里那颗跟着变 ----
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
    const drawSeg = () => seg.replaceChildren(...keeps.map(([v, l]) => h('button', { type: 'button', class: v === keep ? 'on' : '', on: { click: () => { keep = v; dirty = true; drawSeg(); tell(); } } }, l)));
    const sync = () => { const n = Array.from(label.value.trim()).length; count.textContent = n + ' / 16'; count.style.color = n > 16 ? 'var(--red)' : ''; go.disabled = !n || n > 16; };
    // 预览里的那颗跟着变(拍板 33):改的换字,新加的排在最后;只在预览里,发布了才到孩子那边
    const tell = () => { const lb = label.value.trim(); draft = k >= 0 ? { edit: { k, kind: b.kind, label: lb || b.label, until: keep || undefined }, add: null } : { edit: null, add: lb || '(按钮上的字)' }; pvSync(); };
    label.addEventListener('input', () => { dirty = true; sync(); tell(); });
    brief.addEventListener('input', () => { dirty = true; });
    drawSeg(); sync(); tell();
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
    const close = h('button', { type: 'button', class: 'x', on: { click: () => { sel = null; dirty = false; draft = { edit: null, add: null }; render(); pvSync(); } } }, '收起');
    return h('div', { class: 'grp box', id: 'pane' }, h('div', { class: 'row2' }, h('b', { style: 'font-size:17px' }, f.title), close), ...f.fields, h('div', { class: 'btns' }, f.del, f.go));
  };
  const openSheet = (...kids) => { $('#sheet-in').replaceChildren(...kids); $('#sheet').classList.add('on'); window.scrollTo(0, 0); };
  const closeSheet = () => $('#sheet').classList.remove('on');
  const editButton = (t, k) => {
    const f = buttonForm(t, k, () => closeSheet());
    openSheet(h('div', { class: 'nav' }, h('button', { type: 'button', on: { click: () => { dirty = false; draft = { edit: null, add: null }; closeSheet(); pvSync(); } } }, '取消'), h('b', {}, f.title), f.go), ...f.fields, f.del ? h('button', { type: 'button', class: 'danger', on: { click: () => f.del.click() } }, '删掉这个按钮') : null);
    setTimeout(() => f.label.focus(), 50);
  };

  // ---- 这周的词:一行一个,念法空一格写在后面 ----
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
  WIDE.addEventListener('change', () => { if (!picked) dev = WIDE.matches ? 'tablet' : 'phone'; if (D) { closeSheet(); sel = null; draft = { edit: null, add: null }; render(); pvSync(); } else fit(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#sheet').classList.contains('on') && !dirty) load(); });
})();
</script>
</body></html>
`;
