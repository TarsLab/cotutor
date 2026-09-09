/**
 * 孩子端 `/`:今天(一周小路 + 时段 + 产物叠)+ 一排老师头像 + 聊天窗。零依赖内联脚本,只走 /api/kid/* 与 /api/audio。
 * 铁律(《产品规划.md》):界面上永远没有错误与评判——后端不通、老师出错、识别失败,都只是「什么都不出现」或头像灰;
 * 文字尽量少(UI 文字要求先识读),语音优先:按住说话走浏览器识别(webkitSpeechRecognition),没有就只留打字;
 * 回复自动播配音(服务端合成),没有配音退回浏览器自带的合成声。纸色 #f6f4ee 沿 kid-canvas。
 * 家长入口是长按门(儿童类目惯例)。__TITLE__ 由路由替换。
 */
export const KID_PAGE = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>__TITLE__</title>
<style>
  :root { --paper:#f6f4ee; --ink:#2b2b2b; --dim:#8a8781; --line:#e2dfd6; --card:#fffdf8; --kid:#dbeeff; --teacher:#fff3d6; --accent:#e8743b; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html, body { height:100%; }
  body { margin:0; background:var(--paper); color:var(--ink); font:18px/1.5 -apple-system,"PingFang SC","Helvetica Neue",sans-serif; -webkit-user-select:none; user-select:none; overscroll-behavior:none; }
  #home { min-height:100%; padding:calc(env(safe-area-inset-top) + 16px) 20px calc(env(safe-area-inset-bottom) + 90px); max-width:960px; margin:0 auto; }
  h1 { font-size:20px; font-weight:600; margin:0 0 12px; color:var(--dim); }
  /* 一周小路 */
  .path { display:flex; align-items:flex-end; gap:6px; overflow-x:auto; padding:6px 0 10px; position:relative; }
  .path::before { content:""; position:absolute; left:20px; right:20px; bottom:38px; border-top:3px dashed var(--line); z-index:0; }
  .station { flex:0 0 auto; display:flex; flex-direction:column; align-items:center; gap:4px; min-width:72px; position:relative; z-index:1; }
  .station .ring { position:relative; display:grid; place-items:center; }
  .station .ring span { position:absolute; font-size:14px; font-weight:600; }
  .station.past { opacity:.45; }
  .station.later { opacity:.7; }
  .station .lbl { font-size:12px; color:var(--dim); white-space:nowrap; }
  .station.now .lbl { color:var(--ink); font-weight:600; font-size:14px; }
  /* 今天 */
  .today { margin:8px 0 18px; }
  .slot { display:inline-flex; align-items:center; gap:8px; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:8px 14px; margin:0 8px 8px 0; font-size:16px; }
  .slot.now { border-color:var(--accent); box-shadow:0 0 0 3px #e8743b33; }
  .slot .dot { width:12px; height:12px; border-radius:50%; }
  .stacks { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; margin-top:8px; }
  .stack { background:var(--card); border:2px solid var(--line); border-radius:18px; padding:14px 16px; }
  .stack .name { font-weight:600; font-size:18px; }
  .stack .item { font-size:15px; color:var(--dim); margin-top:4px; }
  /* 老师 */
  .teachers { display:flex; gap:22px; flex-wrap:wrap; justify-content:center; margin-top:10px; }
  .teacher { display:flex; flex-direction:column; align-items:center; gap:8px; background:none; border:0; padding:8px; font:inherit; color:var(--ink); cursor:pointer; }
  .teacher .av { width:104px; height:104px; border-radius:50%; background:var(--card); border:3px solid var(--line); display:grid; place-items:center; font-size:56px; box-shadow:0 4px 12px #0000000f; transition:transform .15s; }
  .teacher:active .av { transform:scale(.94); }
  .teacher .nm { font-size:16px; font-weight:600; }
  .teacher.off { pointer-events:none; }
  .teacher.off .av { filter:grayscale(1); opacity:.4; box-shadow:none; }
  .teacher.off .nm { color:var(--dim); }
  /* 聊天窗 */
  #chat { position:fixed; inset:0; background:var(--paper); display:none; flex-direction:column; z-index:10; }
  #chat.on { display:flex; }
  #chat header { display:flex; align-items:center; gap:12px; padding:calc(env(safe-area-inset-top) + 10px) 16px 10px; border-bottom:1px solid var(--line); background:var(--card); }
  #chat header .av { width:48px; height:48px; border-radius:50%; background:var(--paper); display:grid; place-items:center; font-size:28px; border:2px solid var(--line); }
  #chat header .nm { font-size:18px; font-weight:600; flex:1; }
  #back { background:none; border:0; font-size:28px; padding:4px 8px; color:var(--dim); }
  #log { flex:1; overflow:auto; padding:16px; display:flex; flex-direction:column; gap:12px; -webkit-overflow-scrolling:touch; }
  .b { max-width:78%; padding:12px 16px; border-radius:20px; font-size:20px; line-height:1.5; word-break:break-word; -webkit-user-select:text; user-select:text; }
  .b.q { align-self:flex-end; background:var(--kid); border-bottom-right-radius:6px; }
  .b.r { align-self:flex-start; background:var(--teacher); border-bottom-left-radius:6px; display:flex; gap:10px; align-items:flex-start; }
  .b.r .play { flex:0 0 auto; width:36px; height:36px; border-radius:50%; border:0; background:#fff; font-size:18px; display:grid; place-items:center; cursor:pointer; }
  .b.thinking { align-self:flex-start; background:var(--teacher); color:var(--dim); }
  .b.thinking i { display:inline-block; width:8px; height:8px; margin:0 3px; border-radius:50%; background:var(--dim); animation:blink 1.2s infinite; }
  .b.thinking i:nth-child(2) { animation-delay:.2s; } .b.thinking i:nth-child(3) { animation-delay:.4s; }
  @keyframes blink { 0%,80%,100% { opacity:.2; } 40% { opacity:1; } }
  #bar { display:flex; align-items:center; gap:10px; padding:10px 16px calc(env(safe-area-inset-bottom) + 12px); background:var(--card); border-top:1px solid var(--line); }
  #mic { flex:0 0 auto; width:76px; height:76px; border-radius:50%; border:0; background:var(--accent); color:#fff; font-size:34px; display:grid; place-items:center; box-shadow:0 6px 16px #e8743b55; touch-action:none; }
  #mic.rec { transform:scale(1.1); background:#d0492b; box-shadow:0 0 0 12px #e8743b33; }
  #mic[hidden] { display:none; }
  #typed { flex:1; font:inherit; font-size:20px; padding:12px 16px; border:2px solid var(--line); border-radius:24px; background:#fff; -webkit-user-select:text; user-select:text; }
  #go { flex:0 0 auto; width:56px; height:56px; border-radius:50%; border:0; background:var(--ink); color:#fff; font-size:22px; }
  #bar.full { justify-content:center; color:var(--dim); font-size:16px; }
  #hint { position:fixed; left:0; right:0; bottom:calc(env(safe-area-inset-bottom) + 110px); text-align:center; color:var(--accent); font-size:18px; pointer-events:none; opacity:0; transition:opacity .2s; }
  #hint.on { opacity:1; }
  /* 家长门 */
  #gate { position:fixed; right:16px; bottom:calc(env(safe-area-inset-bottom) + 16px); background:none; border:1px solid var(--line); border-radius:20px; padding:8px 14px; color:var(--dim); font-size:13px; opacity:.6; }
  #gate.hold { background:var(--line); }
  #rest { display:none; text-align:center; color:var(--dim); margin:40px 0; font-size:16px; }
  body.offline #rest { display:block; }
  body.offline .teacher { pointer-events:none; }
  body.offline .teacher .av { filter:grayscale(1); opacity:.4; box-shadow:none; }
</style>
<div id="home">
  <h1 id="title">__TITLE__</h1>
  <div class="path" id="path"></div>
  <div class="today" id="today"></div>
  <div class="teachers" id="teachers"></div>
  <p id="rest">老师们休息中</p>
</div>
<button id="gate" type="button">家长 · 长按</button>
<section id="chat">
  <header><button id="back" type="button">‹</button><span class="av" id="c-av"></span><span class="nm" id="c-nm"></span></header>
  <div id="log"></div>
  <div id="bar">
    <button id="mic" type="button">🎤</button>
    <input id="typed" type="text" placeholder="打字也可以" autocomplete="off">
    <button id="go" type="button">↑</button>
  </div>
</section>
<div id="hint">在听……</div>
<script>
(() => {
  const $ = (s) => document.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v; else if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f); else if (v !== undefined && v !== null) el.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  };
  const api = async (method, path, body) => {
    const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    if (!r.ok) { const e = new Error('http ' + r.status); e.status = r.status; throw e; }
    return r.json();
  };
  const PALETTE = ['#e8743b', '#3b82e8', '#2fa36b', '#b45fd1', '#d9a520', '#e0508a'];
  const FIXED = { '语文': '#e0508a', '数学': '#3b82e8', '英语': '#2fa36b' };
  const color = (s) => { if (FIXED[s]) return FIXED[s]; let x = 0; for (const ch of s) x = (x * 31 + ch.codePointAt(0)) >>> 0; return PALETTE[x % PALETTE.length]; };
  const DAYS = ['', '一', '二', '三', '四', '五', '六', '日'];

  const state = { home: null, teacher: null, day: null, timer: null, offline: false, played: new Set(), sentJob: null };

  // ---- 声音:共享 Audio,首个手势解锁(iOS);没配音退回浏览器合成 ----
  const audioEl = new Audio();
  let unlocked = false;
  const unlock = () => { if (unlocked) return; try { audioEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='; audioEl.play().then(() => { unlocked = true; }).catch(() => {}); } catch {} };
  const speak = (text) => { try { if (!('speechSynthesis' in window)) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = 0.95; speechSynthesis.speak(u); } catch {} };
  const play = (m) => {
    try {
      if (m.audio) { try { speechSynthesis && speechSynthesis.cancel(); } catch {} audioEl.pause(); audioEl.src = '/api/audio/' + state.teacher.name + '/' + encodeURIComponent(m.audio); audioEl.play().catch(() => speak(m.reply)); }
      else speak(m.reply);
    } catch {}
  };

  // ---- 首页 ----
  const ring = (subjects, big) => {
    const size = big ? 92 : 64, mid = size / 2, r = big ? 38 : 27, circ = 2 * Math.PI * r, n = Math.max(subjects.length, 1);
    const gap = n > 1 ? (big ? 14 : 10) : 0, seg = n > 1 ? Math.max(circ / n - gap, 6) : circ;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    const bg = document.createElementNS(NS, 'circle'); bg.setAttribute('cx', mid); bg.setAttribute('cy', mid); bg.setAttribute('r', r + 3); bg.setAttribute('fill', '#fffdf8'); bg.setAttribute('stroke', '#e2dfd6'); svg.append(bg);
    const g = document.createElementNS(NS, 'g'); g.setAttribute('transform', 'rotate(-90 ' + mid + ' ' + mid + ')'); g.setAttribute('fill', 'none'); g.setAttribute('stroke-width', big ? 8 : 6); g.setAttribute('stroke-linecap', 'round');
    subjects.forEach((s, i) => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', mid); c.setAttribute('cy', mid); c.setAttribute('r', r); c.setAttribute('stroke', color(s)); c.setAttribute('stroke-dasharray', seg + ' ' + (circ - seg)); c.setAttribute('stroke-dashoffset', -(i * (circ / n))); g.append(c); });
    if (!subjects.length) { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', mid); c.setAttribute('cy', mid); c.setAttribute('r', r); c.setAttribute('stroke', '#e2dfd6'); g.append(c); }
    svg.append(g);
    return svg;
  };
  const renderHome = () => {
    const H = state.home;
    document.title = H.title; $('#title').textContent = H.title;
    const days = [...new Set([...H.timetable.map((e) => e.day), H.day])].sort((a, b) => a - b);
    $('#path').replaceChildren(...days.map((d) => {
      const subjects = [...new Set(H.timetable.filter((e) => e.day === d).map((e) => e.subject))];
      const when = d === H.day ? 'now' : d < H.day ? 'past' : 'later';
      return h('div', { class: 'station ' + when }, h('span', { class: 'ring' }, ring(subjects, d === H.day), d === H.day ? h('span', {}, '今天') : null), h('span', { class: 'lbl' }, (d === H.day ? '' : '周' + DAYS[d] + ' ') + subjects.join(' · ')));
    }));
    const slots = H.timetable.filter((e) => e.day === H.day).map((e) => h('span', { class: 'slot' + (H.slot === e.subject + ' ' + e.start + '-' + e.end ? ' now' : '') }, h('span', { class: 'dot', style: 'background:' + color(e.subject) }), e.subject + ' ' + e.start + '–' + e.end));
    const stacks = H.stacks.map((s) => h('div', { class: 'stack', style: 'border-color:' + color(s.subject) }, h('div', { class: 'name' }, s.subject), ...s.items.map((a) => h('div', { class: 'item' }, a.id))));
    $('#today').replaceChildren(...slots, stacks.length ? h('div', { class: 'stacks' }, ...stacks) : null);
    $('#teachers').replaceChildren(...H.teachers.map((t) => h('button', { type: 'button', class: 'teacher' + (t.available ? '' : ' off'), on: { click: () => openChat(t) } }, h('span', { class: 'av' }, t.avatar || '🙂'), h('span', { class: 'nm' }, t.display))));
  };
  const loadHome = async () => {
    try { state.home = await api('GET', '/api/kid/home'); setOffline(false); renderHome(); }
    catch { setOffline(true); }
  };
  const setOffline = (off) => {
    if (state.offline === off) return;
    state.offline = off;
    document.body.classList.toggle('offline', off);
    if (off && state.teacher) closeChat();
  };

  // ---- 聊天窗 ----
  const openChat = (t) => {
    unlock();
    state.teacher = t; state.played = new Set(); state.sentJob = null;
    $('#c-av').textContent = t.avatar || '🙂'; $('#c-nm').textContent = t.display;
    $('#log').replaceChildren(); $('#chat').classList.add('on');
    // 已经在页面上的旧回复不重播:第一次加载先把它们记为已播
    loadDay(true);
  };
  const closeChat = () => { clearTimeout(state.timer); state.teacher = null; $('#chat').classList.remove('on'); try { audioEl.pause(); speechSynthesis && speechSynthesis.cancel(); } catch {} loadHome(); };
  $('#back').addEventListener('click', closeChat);

  const renderDay = () => {
    const d = state.day;
    const items = d.messages.map((m) => {
      const kids = [];
      if (m.question) kids.push(h('div', { class: 'b q' }, m.question));
      if (m.reply) kids.push(h('div', { class: 'b r' }, h('button', { class: 'play', type: 'button', on: { click: () => play(m) } }, '▶'), h('span', {}, m.reply)));
      else if (m.pending) kids.push(h('div', { class: 'b thinking' }, h('i'), h('i'), h('i')));
      return kids;
    }).flat();
    $('#log').replaceChildren(...items);
    $('#log').scrollTop = $('#log').scrollHeight;
    const bar = $('#bar');
    if (d.remaining <= 0) { bar.classList.add('full'); bar.replaceChildren('今天聊够啦,明天再来 🌙'); }
  };
  const loadDay = async (silent) => {
    if (!state.teacher) return;
    try {
      state.day = await api('GET', '/api/kid/conversations/' + state.teacher.name + '/today');
      setOffline(false);
      renderDay();
      for (const m of state.day.messages) {
        if (!m.reply || state.played.has(m.job)) continue;
        state.played.add(m.job);
        if (!silent) play(m);
      }
      clearTimeout(state.timer);
      if (state.day.pending) state.timer = setTimeout(() => loadDay(false), 1500);
    } catch (e) {
      if (e && e.status === 404) return closeChat();
      setOffline(true);
    }
  };
  const send = async (text) => {
    text = (text || '').trim();
    if (!text || !state.teacher) return;
    unlock();
    $('#typed').value = '';
    try {
      await api('POST', '/api/kid/conversations/' + state.teacher.name + '/messages', { text });
      loadDay(false);
    } catch (e) {
      // 忙 / 上限 / 不通:什么都不报;刷新一下让状态说话
      if (e && e.status === 429) loadDay(true); else if (!e || e.status !== 409) setOffline(true);
    }
  };
  $('#go').addEventListener('click', () => send($('#typed').value));
  $('#typed').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send($('#typed').value); } });

  // ---- 按住说话:浏览器识别;没有就藏起话筒 ----
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('#mic');
  if (!SR) mic.hidden = true;
  else {
    let rec = null, finalText = '', holding = false;
    const start = (e) => {
      e.preventDefault(); unlock();
      if (rec) return;
      holding = true; finalText = '';
      try {
        rec = new SR(); rec.lang = 'zh-CN'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
        rec.onresult = (ev) => { let s = ''; for (const r of ev.results) s += r[0].transcript; $('#typed').value = s; if (ev.results[ev.results.length - 1].isFinal) finalText = s; };
        rec.onerror = () => {};
        rec.onend = () => { rec = null; mic.classList.remove('rec'); $('#hint').classList.remove('on'); const t = finalText || $('#typed').value; if (!holding && t.trim()) send(t); };
        rec.start();
        mic.classList.add('rec'); $('#hint').classList.add('on');
      } catch { rec = null; }
    };
    const stop = (e) => { if (e) e.preventDefault(); holding = false; if (rec) { try { rec.stop(); } catch {} } };
    mic.addEventListener('pointerdown', start);
    mic.addEventListener('pointerup', stop);
    mic.addEventListener('pointercancel', stop);
    mic.addEventListener('pointerleave', stop);
    mic.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- 家长门:长按 800ms ----
  const gate = $('#gate');
  let gateTimer = null;
  const gateStop = () => { clearTimeout(gateTimer); gateTimer = null; gate.classList.remove('hold'); };
  gate.addEventListener('pointerdown', (e) => { e.preventDefault(); gate.classList.add('hold'); gateTimer = setTimeout(() => { location.href = '/parent'; }, 800); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) gate.addEventListener(ev, gateStop);
  gate.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- 启动与心跳:不通就头像灰,什么都不报 ----
  loadHome();
  setInterval(() => { if (state.teacher) { if (!state.day || !state.day.pending) loadDay(true); } else loadHome(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) (state.teacher ? loadDay(true) : loadHome()); });
})();
</script>
</html>
`;
