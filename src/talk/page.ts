/**
 * /talk:口语课的页面,孩子端(设计稿 https://claude.ai/artifact/6uL5XfzhFEfX74cmeWbF9c)。家长端没有这一页。
 * 按 hash 切两屏:#/ 拍照(同拍照听写的骨架,photo-ui.ts;上次的口语单给「接着上」)、#/list/<id> 照片在左、口语单在右(孩子能改、能补、能删)。
 * 改好了交给英语老师的实时页上课(先热身、再打电话);这一页自己不打电话了。
 * 内联脚本里不写反斜杠、不写反引号、不写美元加花括号(这是模板字符串,见 CLAUDE.md「坑」)。
 */
import { TUTOR_FACE_CSS, TUTOR_FACE_JS, backTutorJson } from '../server/tutor-face.ts';
import { KID_NAV_JS } from '../server/kid-nav.ts';
import { KID_LOG_JS } from '../server/kid-log.ts';
import { SNAP_CSS, cameraSvg, snapHtml } from '../server/photo-ui.ts';
import { faviconLinks } from '../lib/favicon.ts';

const TALK_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
${faviconLinks()}
<title>口语课</title>
<link rel="stylesheet" href="/kid/theme.css">
<style>
  :root { --paper:#faf9f4; --ink:#2b2b2b; --dim:#8a8781; --line:#e2dfd6; --card:#ffffff; --kid:#dbeeff; --tutor:#fff3d6; --tutor-line:#f0dca8; --tutor-ink:#8a5a12; --accent:#e8743b; --blue:#eef4ff; --blue-ink:#2f5e9e; --plum:#efe9fb; --plum-ink:#7a4fc9; --grey:#eeece6; --night:#2b3a4a; --red:#b3412a; }
  /* 孩子那几屏跟口语课挂的那位老师走:他的学科色(读到老师后换,缺省英语绿)、头像、名字 */
  :root { --sc:#1f8a4c; --sc-soft:color-mix(in srgb, var(--sc) 12%, #fff); --sc-ink:color-mix(in srgb, var(--sc) 62%, #000); }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  /* 自己写了 display:flex 的块会盖掉浏览器自带的 [hidden](2026-10-10 Safari 上看到的) */
  [hidden] { display:none !important; }
  html,body { margin:0; height:100%; background:var(--paper); color:var(--ink); font:17px/1.5 -apple-system,"PingFang SC","Helvetica Neue",sans-serif; overscroll-behavior:none; }
  body { -webkit-user-select:none; user-select:none; }
  input,button { font:inherit; color:inherit; }
  button { cursor:pointer; border:0; background:none; padding:0; }
  button:disabled { opacity:.4; cursor:default; }
  input { -webkit-user-select:text; user-select:text; }
  .view { display:none; min-height:100%; flex-direction:column; }
  .view.on { display:flex; }
  .pill { display:inline-flex; align-items:center; gap:8px; height:48px; padding:0 18px; border-radius:24px; background:#fff; border:1px solid var(--line); font-size:17px; font-weight:600; white-space:nowrap; }
  .pill.dark { background:var(--ink); color:#fff; border-color:var(--ink); }
  .pill.red { color:var(--red); }
  .pill:active { transform:scale(.96); }
  .muted { color:var(--dim); }
  .small { font-size:14px; }
  .toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%); background:var(--ink); color:#fff; border-radius:20px; padding:10px 18px; font-size:15px; z-index:50; display:none; max-width:90vw; }
  .toast.on { display:block; }
  svg { flex:none; }

  /* 孩子:拍照(photo-ui.ts,同拍照听写)。.main 是主按钮:老师的颜色 */
  .main { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:60px; padding:0 30px; border-radius:30px; background:var(--sc); color:#fff; font-size:20px; font-weight:600; }
  .main:disabled { opacity:.45; }
  #snap { padding:calc(env(safe-area-inset-top) + 10px) 24px calc(env(safe-area-inset-bottom) + 24px); }
${SNAP_CSS}
  /* 孩子:照片在左、口语单在右(竖着照片在上);读的时候照片上一道扫过的光,右边先用浅灰占好位置 */
  #pick { height:100vh; height:100dvh; }
  #pick .pwrap { flex:1; min-height:0; display:flex; gap:20px; padding:calc(env(safe-area-inset-top) + 10px) 20px calc(env(safe-area-inset-bottom) + 16px) 24px; }
  .tk-shot { flex:1; min-width:0; min-height:0; display:flex; align-items:center; justify-content:center; padding-top:48px; }
  .tk-shotin { position:relative; display:inline-block; max-width:100%; border-radius:12px; overflow:hidden; background:#2b2b2b; }
  .tk-shotin img { display:block; max-width:100%; max-height:calc(100vh - 100px); max-height:calc(100dvh - 100px); min-width:160px; min-height:160px; }
  .tk-scan { position:absolute; left:0; right:0; top:0; height:30%; background:linear-gradient(180deg, transparent, color-mix(in srgb, var(--sc) 28%, transparent), transparent); animation:tk-scan 1.6s ease-in-out infinite alternate; pointer-events:none; }
  @keyframes tk-scan { from { transform:translateY(-40%); } to { transform:translateY(270%); } }
  .tk-side { width:420px; flex:none; min-height:0; display:flex; flex-direction:column; gap:10px; }
  .tk-hd { display:flex; align-items:center; gap:14px; }
  .tk-hd .tfav { width:52px; height:52px; font-size:24px; }
  .tk-hd b { display:block; font-size:22px; } .tk-hd small { display:block; font-size:15px; color:var(--dim); }
  .tk-scroll { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:8px; padding:2px; }
  .tk-sec { font-size:14px; font-weight:700; color:var(--dim); margin-top:6px; }
  .tk-ws { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; }
  .tk-it { display:flex; align-items:center; gap:8px; min-height:62px; padding:6px 4px 6px 12px; background:#fff; border:1.5px solid var(--line); border-radius:16px; }
  .tk-it .tx { flex:1; min-width:0; text-align:left; display:flex; align-items:center; gap:10px; min-height:48px; }
  .tk-it .tx > span { min-width:0; }
  .tk-it .en { display:block; font-size:21px; font-weight:600; line-height:1.2; overflow-wrap:anywhere; }
  .tk-it.w .en { font-family:"Chalkboard SE","Comic Sans MS","Marker Felt",sans-serif; font-weight:400; font-size:23px; }
  .tk-it .zh { display:block; font-size:13px; color:var(--dim); }
  .tk-it .em { font-size:26px; line-height:1; flex:none; }
  .tk-it .x { flex:none; width:44px; height:44px; border-radius:22px; display:grid; place-items:center; color:var(--dim); }
  .tk-it.ed { border:2px solid var(--sc); box-shadow:0 0 0 4px color-mix(in srgb, var(--sc) 15%, transparent); }
  .tk-it.ed .x { color:var(--sc); }
  .tk-it input { display:block; width:100%; border:0; border-bottom:2px solid var(--sc); background:transparent; padding:2px 0; outline:0; font-size:20px; }
  .tk-it input.zh { border-bottom:1px solid var(--line); font-size:14px; color:var(--dim); margin-top:4px; }
  .tk-sk { background:#ebe8e0; border-radius:16px; min-height:62px; }
  .tk-add { align-self:flex-start; display:inline-flex; align-items:center; gap:6px; min-height:44px; padding:0 6px; color:var(--sc-ink); font-weight:600; }
  .tk-go { display:flex; gap:10px; }
  .tk-go .pill { height:60px; border-radius:30px; }
  .tk-go .main { flex:1; padding:0 16px; }
  @media (orientation: portrait) {
    #pick .pwrap { flex-direction:column; }
    .tk-shot { flex:none; padding-top:52px; }
    .tk-shotin img { max-height:36vh; }
    .tk-side { width:auto; flex:1; }
  }

  __TUTOR_FACE_CSS__
</style></head>
<body>
<div id="snap" class="view">
  ${snapHtml({ kind: 'talk', id: 'snap-hero', cam: 'p-cam', lib: 'p-lib' })}
</div>

<div id="pick" class="view"><div class="pwrap">
  <div class="tk-shot"><div class="tk-shotin"><img id="p-img" alt="拍的那一页"><div class="tk-scan" id="p-scan" hidden></div></div></div>
  <div class="tk-side">
    <div class="tk-hd"><span id="p-av"></span><div><b id="p-title">老师在看这一页…</b><small id="p-sub">找出单词和句子,一会儿就好</small></div></div>
    <div class="tk-scroll">
      <div class="tk-sec">单词 · <span id="p-nw">0</span></div>
      <div class="tk-ws" id="p-words"></div>
      <button class="tk-add" type="button" id="p-addw"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>补一个单词</button>
      <div class="tk-sec">句子 · <span id="p-ns">0</span></div>
      <div id="p-sents" style="display:flex;flex-direction:column;gap:8px"></div>
      <button class="tk-add" type="button" id="p-adds"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>补一句</button>
    </div>
    <div class="tk-go"><button class="pill" type="button" id="p-again">${cameraSvg()}重拍</button><button class="main" type="button" id="p-go" disabled>先热身,再打电话</button></div>
  </div>
</div></div>

<div class="toast" id="toast"></div>

<script>
// 孩子端的流水(kid-log.ts):最先装上出错的监听
__KID_LOG_JS__
(() => {
  const $ = (s) => document.querySelector(s);
  const h = (tag, attrs, ...kids) => { const el = document.createElement(tag); for (const k in attrs || {}) { if (k === 'class') el.className = attrs[k]; else if (k === 'on') { for (const e in attrs[k]) el.addEventListener(e, attrs[k][e]); } else if (k === 'html') el.innerHTML = attrs[k]; else if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]); } for (const c of kids.flat()) if (c !== null && c !== undefined) el.append(c); return el; };
  const api = async (method, path, body) => { const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => null); if (!r.ok) throw new Error((j && (j.message || j.error)) || ('HTTP ' + r.status)); return j; };
  let toastTimer = null;
  const toast = (s) => { const t = $('#toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400); };
  let info = null;

  // ---- 路由:#/ 拍照、#/list/<id> 看口语单 ----
  const views = ['snap', 'pick'];
  const show = (name) => { for (const v of views) $('#' + v).classList.toggle('on', v === name); BACK.el.hidden = false; };
  // 左上角「‹ logo」胶囊同老师页:点了回首页
  __TUTOR_FACE_JS__
  // 孩子端不往浏览器历史里加东西(kid-nav.ts):回首页、交给老师页都是替换当前页
  __KID_NAV_JS__
  const BACK = backCapsule(() => kidGo('/'));
  // 胶囊带上口语课挂的老师:链接带 ?tutor= 时服务端出页面就插进来(BACK_TUTOR),打开就是他的颜色和首字;没带的等 wearOwner 找到老师再填
  const BACK_TUTOR = __BACK_TUTOR__;
  BACK.set(BACK_TUTOR);
  BACK.el.hidden = true; document.body.append(BACK.el);
  let OWNER = null;
  /** 口语课挂的那位老师:首页链接带 ?tutor=,没带就找卡上有口语课的,再没有找英语老师;换上他的颜色、头像、名字 */
  const wearOwner = async () => {
    let ts = [];
    try { ts = (await api('GET', '/api/kid/home')).tutors || []; } catch { return; }
    const want = new URLSearchParams(location.search).get('tutor');
    const t = ts.find((x) => x.name === want) || ts.find((x) => (x.extras || []).includes('talk')) || ts.find((x) => x.lang === 'en');
    if (!t) return;
    OWNER = t;
    BACK.set(t);
    document.documentElement.style.setProperty('--sc', t.color);
    $('#snap-av').replaceChildren(tutorAvatar(t));
    $('#p-av').replaceChildren(tutorAvatar(t));
  };
  const go = (hash) => { location.hash = hash; };
  kidLog.start({ page: 'talk', mode: 'kid' });
  const route = () => {
    const m = /^#\\/list\\/([^/]+)/.exec(location.hash);
    if (!m) { show('snap'); void snap(); return; }
    show('pick'); void pick(m[1]);
  };
  window.addEventListener('hashchange', route);

  // ---- 拍照:同拍照听写的骨架;上次的口语单在最上面给「接着上」 ----
  const lastList = () => (info && info.enabled ? (info.talks || []).find((x) => x.status === 'ready' && x.list.words.length + x.list.sentences.length > 0) : null) || null;
  async function snap() {
    try { info = await api('GET', '/api/talk'); } catch (e) { info = null; }
    if (info && !info.enabled) { location.replace('/'); return; }
    const last = lastList();
    $('#snap-resume').hidden = !last;
    $('#snap-cam-btn').classList.toggle('alt', Boolean(last));
    if (!last) return;
    const d = new Date(last.createdAt), nw = last.list.words.length, ns = last.list.sentences.length;
    $('#snap-resume-sub').textContent = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日拍的 · ' + [nw ? nw + ' 个单词' : '', ns ? ns + ' 句' : ''].filter(Boolean).join('、');
  }
  $('#snap-resume-go').addEventListener('click', (e) => { handoff(async () => (await api('POST', '/api/talk', { from: 'latest' })).id, e.currentTarget); });
  const shrink = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { const max = 1600; const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85)); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('这张图打不开')); };
    img.src = url;
  });

  // ---- 看口语单:照片在左;读的时候「老师在看这一页…」,读完原地填上;点一项改字、× 去掉、能补 ----
  const MAX = { words: 12, sentences: 8 };
  let P = { id: null, meta: null, waiting: false, failed: false, edit: null };
  async function shoot(file) {
    if (!file) return;
    if (P.url) URL.revokeObjectURL(P.url);
    P = { id: null, meta: null, waiting: true, failed: false, edit: null, url: URL.createObjectURL(file) };
    $('#p-img').src = P.url;
    history.replaceState(null, '', location.pathname + location.search + '#/list/');
    show('pick'); renderPick();
    try {
      const photo = await shrink(file);
      const m = await api('POST', '/api/talk', { photo });
      P.id = m.id; P.meta = m;
      history.replaceState(null, '', location.pathname + location.search + '#/list/' + m.id);
    } catch (e) { P.failed = true; }
    P.waiting = false; renderPick();
  }
  $('#p-cam').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; shoot(f); });
  $('#p-lib').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; shoot(f); });
  async function pick(id) {
    if (P.id === id && P.meta) { renderPick(); return; }
    P = { id: null, meta: null, waiting: true, failed: false, edit: null };
    renderPick();
    try { P.meta = (await api('GET', '/api/talk/' + id)).meta; P.id = id; } catch (e) { go('#/'); return; }
    if (P.meta.photo) $('#p-img').src = '/api/talk/' + id + '/photo'; else $('#p-img').removeAttribute('src');
    P.waiting = false; renderPick();
  }
  const ICON_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const ICON_OK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
  /** 改完一项:英文空了就去掉 */
  const doneEdit = () => {
    const e = P.edit; P.edit = null;
    if (!e || !P.meta) return;
    const arr = P.meta.list[e.kind], it = arr[e.i];
    if (it) { it.en = it.en.replace(/\\s+/g, ' ').trim(); it.zh = (it.zh || '').trim(); if (!it.en) arr.splice(e.i, 1); }
  };
  function itemEl(kind, it, i) {
    const word = kind === 'words';
    const editing = P.edit && P.edit.kind === kind && P.edit.i === i;
    if (editing) {
      const en = h('input', { class: 'en', value: it.en, placeholder: word ? '单词' : '英文句子', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': '英文' });
      const zh = h('input', { class: 'zh', value: it.zh || '', placeholder: '中文意思(可以不写)', 'aria-label': '中文' });
      en.addEventListener('input', () => { it.en = en.value; renderGo(); });
      zh.addEventListener('input', () => { it.zh = zh.value; });
      for (const x of [en, zh]) x.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { doneEdit(); renderPick(); } });
      const el = h('div', { class: 'tk-it ed' + (word ? ' w' : '') }, h('div', { class: 'tx', style: 'display:block' }, en, zh), h('button', { class: 'x', type: 'button', 'aria-label': '改好了', html: ICON_OK, on: { click: () => { doneEdit(); renderPick(); } } }));
      setTimeout(() => { if (!en.value) en.focus(); }, 0);
      return el;
    }
    return h('div', { class: 'tk-it' + (word ? ' w' : '') },
      h('button', { class: 'tx', type: 'button', 'aria-label': '改 ' + it.en, on: { click: () => { doneEdit(); P.edit = { kind, i: P.meta.list[kind].indexOf(it) }; renderPick(); } } },
        word && it.emoji ? h('span', { class: 'em' }, it.emoji) : null, h('span', {}, h('span', { class: 'en' }, it.en), it.zh ? h('span', { class: 'zh' }, it.zh) : null)),
      h('button', { class: 'x', type: 'button', 'aria-label': '不要 ' + it.en, html: ICON_X, on: { click: () => { doneEdit(); const k = P.meta.list[kind].indexOf(it); if (k >= 0) P.meta.list[kind].splice(k, 1); renderPick(); } } }));
  }
  const filled = () => (P.meta ? P.meta.list.words.filter((x) => x.en.trim()).length + P.meta.list.sentences.filter((x) => x.en.trim()).length : 0);
  function renderGo() {
    const n = filled();
    $('#p-go').disabled = !P.id || !n || P.waiting;
    const label = '先热身,再打电话';
    $('#p-go').textContent = n ? label + ' · ' + n + ' 个' : label;
  }
  function renderPick() {
    $('#p-scan').hidden = !P.waiting;
    const L = P.meta ? P.meta.list : null;
    const n = L ? L.words.length + L.sentences.length : 0;
    $('#p-title').textContent = P.waiting ? '老师在看这一页…' : '今天的口语单';
    $('#p-sub').textContent = P.waiting ? '找出单词和句子,一会儿就好' : P.failed ? '这张没传上去,再拍一张试试' : n ? '点一项改字,不要的点 ×' : '这一页没看到英文,换一页拍,或者自己补几个';
    if (P.waiting || !L) {
      $('#p-nw').textContent = '…'; $('#p-ns').textContent = '…';
      $('#p-words').replaceChildren(...[0, 1, 2, 3].map(() => h('div', { class: 'tk-sk' })));
      $('#p-sents').replaceChildren(h('div', { class: 'tk-sk' }), h('div', { class: 'tk-sk' }));
      $('#p-addw').hidden = true; $('#p-adds').hidden = true;
    } else {
      $('#p-nw').textContent = L.words.length; $('#p-ns').textContent = L.sentences.length;
      $('#p-words').replaceChildren(...L.words.map((it, i) => itemEl('words', it, i)));
      $('#p-sents').replaceChildren(...L.sentences.map((it, i) => itemEl('sentences', it, i)));
      $('#p-addw').hidden = !P.id || L.words.length >= MAX.words; $('#p-adds').hidden = !P.id || L.sentences.length >= MAX.sentences;
    }
    renderGo();
  }
  const addItem = (kind) => { if (!P.meta) return; doneEdit(); const arr = P.meta.list[kind]; arr.push({ en: '', zh: '' }); P.edit = { kind, i: arr.length - 1 }; renderPick(); };
  $('#p-addw').addEventListener('click', () => addItem('words'));
  $('#p-adds').addEventListener('click', () => addItem('sentences'));
  $('#p-again').addEventListener('click', () => {
    // 这张不要了:还没开始的那份删掉,不留在 talk/ 里
    if (P.id && P.meta && P.meta.status === 'draft') api('DELETE', '/api/talk/' + P.id).catch(() => {});
    P = { id: null, meta: null, waiting: false, failed: false, edit: null };
    go('#/');
  });
  $('#p-go').addEventListener('click', (e) => {
    doneEdit();
    const words = P.meta.list.words.filter((x) => x.en.trim()), sentences = P.meta.list.sentences.filter((x) => x.en.trim());
    if (!words.length && !sentences.length) return;
    const id = P.id;
    handoff(async () => { P.meta = await api('PUT', '/api/talk/' + id + '/list', { words, sentences, ready: true }); return id; }, e.currentTarget);
  });

  // ---- 交给英语老师的实时页(这页只准备口语单):存好口语单(或接着上),换到老师页;那边点「先热身,再打电话」那一下才起声音 ----
  async function handoff(getId, btn) {
    if (btn) btn.disabled = true;
    if (!OWNER) await wearOwner();
    if (!OWNER) { if (btn) btn.disabled = false; toast('没找到英语老师'); return; }
    let id;
    try { id = await getId(); } catch (e) { if (btn) btn.disabled = false; toast('没连上,再点一次'); return; }
    kidGo('/?tutor=' + encodeURIComponent(OWNER.name) + '&talk=' + encodeURIComponent(id));
  }

  void wearOwner();
  route();
})();
</script>
</body></html>`;

/** back:链接带的 ?tutor= 那位老师(胶囊上的颜色、首字);不知道 null */
export function talkPage(back: { color: string; initial: string; display: string } | null = null): string {
  return TALK_PAGE.replace('__TUTOR_FACE_JS__', () => TUTOR_FACE_JS).replace('__KID_LOG_JS__', () => KID_LOG_JS).replace('__KID_NAV_JS__', () => KID_NAV_JS).replace('__BACK_TUTOR__', () => backTutorJson(back)).replace('__TUTOR_FACE_CSS__', () => TUTOR_FACE_CSS);
}
