/**
 * 家长端 /parent:三个标签(对话 / 老师团 / 设置),零依赖内联脚本,只走 /api/*。
 * 对话 = 家长视图:主线说话、工具行折叠、子代理折叠、待裁量按钮、孩子视图预览(kidText)、出错红条。
 * 老师团 = 老师卡片(人设与政策 → PATCH /api/config;老师文件正文 → /api/tutors/<name>/file;新老师 → POST /api/tutors;自家的能删)。
 * 设置 = paths / 端口 / 证书 / 配音命令,同样只写 cotutor.json;kid、version、运行时模板留给编辑器。
 * 放在 .ts 里而不是 .html,是因为 tsc 不拷贝静态文件,dist 里就少一份。
 */
export const PARENT_PAGE = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>cotutor 家长端</title>
<style>
  :root { --bg:#f7f7f5; --panel:#fff; --line:#e3e3df; --ink:#222; --dim:#777; --accent:#2b6cb0; --kid:#e8f3ff; --parent:#fff4e0; --sys:#eee; --err:#c0392b; --ok:#2e7d32; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 -apple-system,"PingFang SC","Helvetica Neue",sans-serif; }
  header { display:flex; align-items:center; gap:16px; padding:10px 16px; background:var(--panel); border-bottom:1px solid var(--line); }
  header h1 { font-size:16px; margin:0; }
  header nav a { margin-right:12px; color:var(--dim); text-decoration:none; padding:4px 0; border-bottom:2px solid transparent; }
  header nav a.on { color:var(--ink); border-color:var(--accent); }
  header .health { margin-left:auto; font-size:12px; color:var(--dim); }
  header .health.bad { color:var(--err); }
  main { display:none; }
  main.on { display:block; }
  /* 对话 */
  /* display 只由 .on 给(下面这条别写 display:grid——#chat 的特指度盖过 main{display:none},对话面板就永远关不掉了) */
  #chat { grid-template-columns:220px 1fr; height:calc(100vh - 47px); }
  #chat.on { display:grid; }
  aside { border-right:1px solid var(--line); background:var(--panel); overflow:auto; }
  aside .tutor { display:flex; gap:8px; align-items:center; padding:10px 12px; cursor:pointer; border-bottom:1px solid var(--line); }
  aside .tutor.on { background:var(--kid); }
  aside .tutor .av { font-size:22px; }
  aside .tutor small { display:block; color:var(--dim); font-size:12px; }
  aside .dates { padding:8px 12px; }
  aside .dates select { width:100%; }
  #thread { display:flex; flex-direction:column; min-width:0; }
  #msgs { flex:1; overflow:auto; padding:16px; }
  .msg { max-width:900px; margin:0 auto 18px; }
  .bubble { padding:8px 12px; border-radius:10px; white-space:pre-wrap; word-break:break-word; }
  .from-kid .bubble.in { background:var(--kid); }
  .from-parent .bubble.in { background:var(--parent); }
  .from-system .bubble.in { background:var(--sys); }
  .meta { font-size:12px; color:var(--dim); margin:2px 4px; }
  .run { margin:8px 0 0 16px; border-left:3px solid var(--line); padding-left:12px; }
  .run .say { white-space:pre-wrap; margin:4px 0 8px; }
  .run .tool, .run .done { font:12px/1.5 ui-monospace,Menlo,monospace; color:var(--dim); white-space:pre-wrap; }
  .run .tool-error { font:12px/1.5 ui-monospace,Menlo,monospace; color:var(--err); white-space:pre-wrap; }
  .run details { margin:4px 0; font-size:12px; color:var(--dim); }
  .run details summary { cursor:pointer; }
  .run .sub { border-left:2px dashed var(--line); padding-left:8px; margin:4px 0; }
  .kid { margin:8px 0 0 16px; font-size:13px; color:var(--dim); }
  .kid b { color:var(--ok); font-weight:500; }
  .kid .none { color:var(--dim); font-style:italic; }
  .holdup { margin:8px 0 0 16px; padding:10px 12px; background:#fffbe6; border:1px solid #f0e0a0; border-radius:8px; }
  .holdup .q { font-weight:600; margin-bottom:6px; }
  .holdup button { margin:2px 6px 2px 0; }
  .holdup small { color:var(--dim); }
  .err { margin:8px 0 0 16px; padding:8px 12px; background:#fdecea; color:var(--err); border-radius:8px; font:12px/1.5 ui-monospace,Menlo,monospace; white-space:pre-wrap; }
  .running { color:var(--accent); font-size:13px; margin-left:16px; }
  #composer { border-top:1px solid var(--line); background:var(--panel); padding:10px 16px; display:flex; gap:8px; align-items:flex-end; }
  #composer textarea { flex:1; min-height:44px; max-height:160px; font:inherit; padding:8px; border:1px solid var(--line); border-radius:8px; resize:vertical; }
  #composer select, #composer button { font:inherit; padding:8px 10px; }
  #composer button { background:var(--accent); color:#fff; border:0; border-radius:8px; cursor:pointer; }
  #composer button:disabled { opacity:.5; cursor:default; }
  .empty { color:var(--dim); text-align:center; margin-top:60px; }
  /* 老师团 */
  #team, #settings { padding:16px; max-width:1000px; margin:0 auto; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin-bottom:14px; }
  .card h2 { font-size:15px; margin:0 0 10px; display:flex; align-items:center; gap:8px; }
  .card h2 .av { font-size:22px; }
  .card h2 .off { color:var(--dim); font-weight:400; font-size:12px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:8px 16px; }
  .grid label { display:flex; flex-direction:column; font-size:12px; color:var(--dim); }
  .grid input[type=text], .grid input[type=number], .grid select { font:inherit; padding:5px 7px; border:1px solid var(--line); border-radius:6px; }
  .grid label.chk { flex-direction:row; align-items:center; gap:6px; font-size:14px; color:var(--ink); }
  .card .actions { margin-top:10px; display:flex; gap:8px; align-items:center; }
  .card .actions button { font:inherit; padding:6px 12px; border-radius:6px; border:1px solid var(--line); background:#fff; cursor:pointer; }
  .card .actions button.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
  .card .actions .msg-ok { color:var(--ok); font-size:13px; }
  .card .actions .msg-err { color:var(--err); font-size:13px; white-space:pre-wrap; }
  .hint { color:var(--dim); font-size:12px; }
  .card ul.gaps { margin:0 0 8px; padding-left:20px; font-size:13px; }
  .card ul.gaps li { margin:2px 0; }
  .card textarea { width:100%; min-height:260px; font:13px/1.5 ui-monospace,Menlo,monospace; padding:8px; border:1px solid var(--line); border-radius:6px; resize:vertical; }
  .card details { margin-top:10px; }
  .card details summary { cursor:pointer; color:var(--dim); font-size:13px; }
  .card .danger { color:var(--err); border-color:#f0c0c0 !important; }
  .card .origin { font-size:12px; color:var(--dim); margin-left:auto; }
  @media (max-width:700px) { #chat { grid-template-columns:1fr; } aside { display:none; } }
</style>
<header>
  <h1 id="title">cotutor</h1>
  <nav><a href="#chat" data-tab="chat" class="on">对话</a><a href="#team" data-tab="team">老师团</a><a href="#settings" data-tab="settings">设置</a></nav>
  <span class="health" id="health"></span>
</header>
<main id="chat" class="on">
  <aside>
    <div id="tutors"></div>
    <div class="dates"><select id="dates"></select></div>
  </aside>
  <section id="thread">
    <div id="msgs"><p class="empty">左边选一位老师</p></div>
    <form id="composer">
      <select id="from" title="以谁的身份说"><option value="parent">家长</option><option value="kid">孩子(模拟)</option><option value="system">系统</option></select>
      <select id="runtime" title="运行时"></select>
      <textarea id="text" placeholder="对老师说……(⌘/Ctrl+Enter 发送)"></textarea>
      <button type="submit" id="send">发送</button>
    </form>
  </section>
</main>
<main id="team"></main>
<main id="settings"></main>
<script>
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v; else if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f); else if (v !== undefined && v !== null) el.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  };
  const api = async (method, path, body) => {
    const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && j.message) || (j && j.error) || (r.status + ' ' + r.statusText));
    return j;
  };

  const state = { config: null, tutor: null, date: null, dates: [], view: null, timer: null, tab: location.hash === '#team' ? 'team' : location.hash === '#settings' ? 'settings' : 'chat' };

  // ---- 顶栏与标签 ----
  const showTab = (tab) => {
    state.tab = tab;
    for (const a of document.querySelectorAll('header nav a')) a.classList.toggle('on', a.dataset.tab === tab);
    for (const m of document.querySelectorAll('main')) m.classList.toggle('on', m.id === tab);
    if (tab === 'team') renderTeam();
    if (tab === 'settings') renderSettings();
  };
  for (const a of document.querySelectorAll('header nav a')) a.addEventListener('click', (e) => { e.preventDefault(); location.hash = '#' + a.dataset.tab; showTab(a.dataset.tab); });

  const refreshHealth = async () => {
    try {
      const hh = await api('GET', '/api/health');
      const el = $('#health');
      el.textContent = hh.configError ? '⚠ cotutor.json 改坏了,仍用上一份:' + hh.configError.split('\\n')[0] : '';
      el.classList.toggle('bad', Boolean(hh.configError));
    } catch (e) { $('#health').textContent = '后端不通'; $('#health').classList.add('bad'); }
  };

  const loadConfig = async () => {
    state.config = await api('GET', '/api/config');
    $('#title').textContent = state.config.title + ' · 家长端';
    document.title = state.config.title + ' · 家长端';
    const ps = $('#runtime');
    ps.replaceChildren(...state.config.runtimes.map((p) => h('option', { value: p, selected: p === state.config.runtime ? '' : undefined }, p === state.config.runtime ? p + '(缺省)' : p)));
    renderTutors();
  };

  // ---- 对话:老师列表(enabled 的才有,关掉即消失;hidden 的家长仍可见)----
  const renderTutors = () => {
    const list = state.config.tutors.filter((t) => t.enabled);
    if (state.tutor && !list.some((t) => t.name === state.tutor)) { state.tutor = null; state.view = null; $('#msgs').replaceChildren(h('p', { class: 'empty' }, '这位老师已关闭')); }
    $('#tutors').replaceChildren(...list.map((t) => h('div', { class: 'tutor' + (t.name === state.tutor ? ' on' : ''), on: { click: () => pickTutor(t.name) } },
      h('span', { class: 'av' }, t.avatar || '🙂'),
      h('div', {}, t.display, h('small', {}, t.name + (t.hidden ? ' · 孩子端不露' : '') + (t.subject ? ' · ' + t.subject : ''))))));
  };

  const pickTutor = async (name, date) => {
    state.tutor = name;
    renderTutors();
    const d = await api('GET', '/api/conversations/' + name);
    state.dates = d.dates.includes(d.today) ? d.dates : [d.today, ...d.dates];
    state.date = date || d.today;
    $('#dates').replaceChildren(...state.dates.map((x) => h('option', { value: x, selected: x === state.date ? '' : undefined }, x === d.today ? x + '(今天)' : x)));
    await loadDay();
  };
  $('#dates').addEventListener('change', () => { state.date = $('#dates').value; loadDay(); });

  const loadDay = async () => {
    if (!state.tutor || !state.date) return;
    const stick = $('#msgs').scrollHeight - $('#msgs').scrollTop - $('#msgs').clientHeight < 40;
    state.view = await api('GET', '/api/conversations/' + state.tutor + '/' + state.date);
    renderDay();
    if (stick) $('#msgs').scrollTop = $('#msgs').scrollHeight;
    clearTimeout(state.timer);
    if (state.view.running) state.timer = setTimeout(loadDay, 2000);
    $('#send').disabled = Boolean(state.view.running);
  };

  const rowsEl = (rows) => {
    const out = [];
    let subs = [];
    const flushSubs = () => { if (subs.length) { out.push(h('details', { class: 'sub' }, h('summary', {}, '子代理 · ' + subs.length + ' 条'), ...subs)); subs = []; } };
    const one = (r) => {
      if (r.kind === 'fold') return h('details', {}, h('summary', {}, '用了 ' + r.tools.length + ' 步工具'), ...r.tools.map((t) => h('div', { class: 'tool' }, t.text)));
      if (r.kind === 'text') return h('div', { class: 'say' }, r.text);
      return h('div', { class: r.kind }, r.text);
    };
    for (const r of rows) {
      if (r.kind !== 'fold' && r.sub) { subs.push(one(r)); continue; }
      flushSubs();
      out.push(one(r));
    }
    flushSubs();
    return out;
  };

  const renderDay = () => {
    const v = state.view;
    const t = state.config.tutors.find((x) => x.name === state.tutor) || { display: state.tutor };
    if (!v.index.messages.length) { $('#msgs').replaceChildren(h('p', { class: 'empty' }, state.date + ' 还没和' + t.display + '说过话')); return; }
    const FROM = { kid: '孩子', parent: '家长', system: '系统' };
    const nodes = v.index.messages.map((m) => {
      const el = h('div', { class: 'msg from-' + m.from });
      el.append(h('div', { class: 'meta' }, FROM[m.from] || m.from, ' · ', m.at, ' · ', m.job, m.runtime ? ' · ' + m.runtime : '', m.focus && m.focus.artifact ? ' · 看着 ' + m.focus.artifact + (m.focus.step !== undefined ? ' 第 ' + m.focus.step + ' 步' : '') : '', m.focus && m.focus.card ? ' · 开着卡 ' + m.focus.card : '', m.action === 'continue' ? ' · 继续' : m.action === 'submit' ? ' · 交给老师' : ''));
      if (m.cards && m.cards.length) el.append(h('div', { class: 'kid' }, '孩子在板书上做的:', ...m.cards.map((c) => h('div', {}, h('b', {}, c.card + ' ' + c.text)))));
      el.append(h('div', { class: 'bubble in' }, m.text));
      const rows = v.runs[m.job] || [];
      const run = h('div', { class: 'run' }, h('div', { class: 'meta' }, (t.avatar || '') + ' ' + t.display), ...rowsEl(rows));
      if (m.result === 'running') run.append(h('div', { class: 'running' }, v.running === m.job ? '老师在想……' : '(没跑完:服务重启过或进程被杀,看 ' + m.job + '.err.log)'));
      el.append(run);
      if (m.result === 'error') el.append(h('div', { class: 'err' }, '本轮出错:' + (m.error || '未知') + (v.errors[m.job] ? '\\n' + v.errors[m.job] : '')));
      if (m.result === 'ok') el.append(h('div', { class: 'kid' }, '孩子看到:', m.kidText ? h('b', {}, m.kidText) : h('span', { class: 'none' }, '(这轮没有给孩子的话)'), m.section && m.section.cards.length ? h('span', { class: 'none' }, ' · 板书 ' + m.section.cards.length + ' 张卡 ' + m.section.lines.length + ' 句') : null));
      if (m.parentText) el.append(h('div', { class: 'kid' }, '给家长:', h('b', {}, m.parentText.replace(/^## 家长\s*/, ''))));
      if (m.warnings && m.warnings.length) el.append(h('div', { class: 'kid' }, h('span', { class: 'none' }, m.warnings.join(';'))));
      if (m.holdup) {
        const card = h('div', { class: 'holdup' }, h('div', { class: 'q' }, '待裁量:' + m.holdup.question));
        for (const o of m.holdup.options) card.append(h('button', { type: 'button', on: { click: () => send('待裁量「' + m.holdup.question + '」:选「' + o.label + '」', 'parent') } }, o.label + (o.recommended ? ' ★' : '')), o.note ? h('small', {}, o.note + ' ') : null);
        if (!m.holdup.options.length) card.append(h('small', {}, '(没给选项,直接在下面回复)'));
        el.append(card);
      }
      if (m.handoff) el.append(h('div', { class: 'kid' }, '转交 → ' + m.handoff.to + (m.handoff.why ? ':' + m.handoff.why : ''), m.handoffJob ? h('span', { class: 'none' }, ' · 已起 ' + m.handoffJob.tutor + ' 的 ' + m.handoffJob.job) : h('span', { class: 'none' }, ' · 没起(见提醒)')));
      return el;
    });
    nodes.push(h('div', { class: 'meta', style: 'text-align:center' }, '今日费用 $' + v.index.costUsd.toFixed(2), v.index.session ? ' · 会话 ' + v.index.session.id.slice(0, 8) + '(' + v.index.session.runtime + ')' : ''));
    $('#msgs').replaceChildren(...nodes);
  };

  const send = async (text, from) => {
    if (!state.tutor) return alert('先选一位老师');
    const today = state.dates[0];
    try {
      $('#send').disabled = true;
      await api('POST', '/api/conversations/' + state.tutor + '/messages', { text, from: from || $('#from').value, runtime: $('#runtime').value });
      $('#text').value = '';
      if (state.date !== today) await pickTutor(state.tutor, today); else await loadDay();
    } catch (e) { alert(e.message); $('#send').disabled = false; }
  };
  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); const t = $('#text').value.trim(); if (t) send(t); });
  $('#text').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); $('#composer').requestSubmit(); } });

  // ---- 老师团:只读写 cotutor.json ----
  const POLICY_FIELDS = [['replyMaxChars', '单条回复字数上限', 'number'], ['dailyMessages', '每日消息上限', 'number'], ['dailyRegen', '每日重生上限', 'number'], ['reviewGate', '验收开关(先经家长)', 'bool'], ['forms', '回复形式(逗号分隔 L0-L4)', 'forms'], ['contextPack.recent', '上下文包:最近观察条数', 'number'], ['contextPack.planLines', '上下文包:计划行数', 'number']];
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const setPath = (o, p, v) => { const ks = p.split('.'); let cur = o; for (const k of ks.slice(0, -1)) cur = cur[k] = cur[k] || {}; cur[ks[ks.length - 1]] = v; };

  const policyInputs = (patch, effective, opts) => POLICY_FIELDS.map(([key, label, type]) => {
    const cur = getPath(patch, key);
    const eff = getPath(effective, key);
    const inherit = opts.inherit && cur === undefined;
    if (type === 'bool') {
      const sel = h('select', { 'data-key': key }, opts.inherit ? h('option', { value: '', selected: inherit ? '' : undefined }, '继承(' + (eff ? '开' : '关') + ')') : null, h('option', { value: 'true', selected: cur === true ? '' : undefined }, '开'), h('option', { value: 'false', selected: cur === false || (!opts.inherit && cur === undefined && eff === false) ? '' : undefined }, '关'));
      return h('label', {}, label, sel);
    }
    const val = cur === undefined ? '' : type === 'forms' ? cur.join(',') : String(cur);
    return h('label', {}, label, h('input', { type: type === 'number' ? 'number' : 'text', 'data-key': key, value: val, placeholder: (inherit ? '继承:' : '') + (type === 'forms' ? (eff || []).join(',') : eff) }));
  });
  const readPolicy = (card) => {
    const out = {};
    for (const el of card.querySelectorAll('[data-key]')) {
      const key = el.dataset.key;
      const type = POLICY_FIELDS.find((f) => f[0] === key)[2];
      const raw = el.value.trim();
      if (raw === '') { setPath(out, key, null); continue; }
      if (type === 'number') { const n = Number(raw); if (!Number.isInteger(n)) throw new Error(key + ' 要是整数'); setPath(out, key, n); }
      else if (type === 'bool') setPath(out, key, raw === 'true');
      else setPath(out, key, raw.split(/[,,\\s]+/).filter(Boolean));
    }
    return out;
  };
  const feedback = (card, ok, text) => { const m = $('.actions .fb', card); m.className = 'fb ' + (ok ? 'msg-ok' : 'msg-err'); m.textContent = text; };
  const patchAndReload = async (card, patch) => {
    try { await api('PATCH', '/api/config', patch); await loadConfig(); feedback(card, true, '已写入 cotutor.json'); if (state.tab === 'team') renderTeam(); }
    catch (e) { feedback(card, false, e.message); }
  };

  const AVATARS = ['🧮', '📚', '📖', '🔬', '🎨', '🎵', '🌍', '💻', '🏃', '🧩', '📷', '🗓'];
  const newTutorCard = () => {
    const card = h('div', { class: 'card' }, h('h2', {}, '➕ 新老师'), h('div', { class: 'grid' },
      h('label', {}, '老师名(英文键,如 science-tutor)', h('input', { type: 'text', id: 'n-name', placeholder: 'science-tutor' })),
      h('label', {}, '显示名', h('input', { type: 'text', id: 'n-display', placeholder: '科学老师' })),
      h('label', {}, '学科(可空)', h('input', { type: 'text', id: 'n-subject', placeholder: '科学' })),
      h('label', {}, '头像', h('select', { id: 'n-avatar' }, ...AVATARS.map((a) => h('option', { value: a }, a)))),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', id: 'n-hidden' }), '孩子端不露')),
      h('p', { class: 'hint' }, '会写一份带全部约定的老师文件、进 cotutor.json、建目录;之后在下面这位老师的卡里改「老师文件」把性子填上。与终端 cotutor add 同一条路。'),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', on: { click: async () => {
        const name = $('#n-name').value.trim(), display = $('#n-display').value.trim();
        if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return feedback(card, false, '老师名要小写字母数字连字符');
        if (!display) return feedback(card, false, '显示名不能空');
        try { await api('POST', '/api/tutors', { name, display, subject: $('#n-subject').value.trim(), avatar: $('#n-avatar').value, hidden: $('#n-hidden').checked }); await loadConfig(); renderTeam(); feedback($('#team .card'), true, '加了 ' + display); }
        catch (e) { feedback(card, false, e.message); }
      } } }, '加进来'), h('span', { class: 'fb' })));
    return card;
  };
  const fileEditor = (t) => {
    const box = h('details', {}, h('summary', {}, '老师文件(系统提示;改了就是你家的,升级不覆盖)'));
    const ta = h('textarea', { spellcheck: 'false' });
    const fb = h('span', { class: 'fb' });
    const origin = h('span', { class: 'origin' });
    const load = async () => { try { const f = await api('GET', '/api/tutors/' + t.name + '/file'); ta.value = f.text; origin.textContent = f.state === 'own' ? '自家加的' : f.state === 'latest' ? '出厂件,最新' : f.state === 'upgradable' ? '出厂件,可升级' : '自定义' + (f.basedOn ? '(基于 ' + f.basedOn + ')' : ''); } catch (e) { ta.value = ''; fb.className = 'fb msg-err'; fb.textContent = e.message; } };
    box.addEventListener('toggle', () => { if (box.open && !ta.value) load(); });
    box.append(ta, h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', on: { click: async () => { try { const f = await api('PUT', '/api/tutors/' + t.name + '/file', { text: ta.value }); fb.className = 'fb msg-ok'; fb.textContent = '已写入'; origin.textContent = f.state === 'own' ? '自家加的' : '自定义'; } catch (e) { fb.className = 'fb msg-err'; fb.textContent = e.message; } } } }, '保存老师文件'), h('button', { type: 'button', on: { click: load } }, '重新读'), origin, fb));
    return box;
  };

  const renderTeam = () => {
    const c = state.config;
    if (!c) return;
    const root = $('#team');
    const top = h('div', { class: 'card' }, h('h2', {}, '全局'), h('div', { class: 'grid' },
      h('label', {}, '孩子端标题', h('input', { type: 'text', id: 'g-title', value: c.title })),
      h('label', {}, '缺省运行时(runtimes.default)', h('select', { id: 'g-agent' }, ...c.runtimes.map((p) => h('option', { value: p, selected: p === c.runtime ? '' : undefined }, p)))),
      ...policyInputs(c.policyDefaults, c.tutors[0] ? Object.assign({}, c.tutors[0].policy, c.policyDefaults) : {}, { inherit: false })),
      h('p', { class: 'hint' }, 'policyDefaults 留空 = 用出厂缺省(60 字 / 30 条 / 3 次 / 验收关 / L0,L1,L3,L4 / 10,10)。运行时模板、paths、端口请直接编辑 cotutor.json。'),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', on: { click: () => { try { patchAndReload(top, { title: $('#g-title').value, runtimes: { default: $('#g-agent').value }, policyDefaults: readPolicy(top) }); } catch (e) { feedback(top, false, e.message); } } } }, '保存全局'), h('span', { class: 'fb' })));
    const cards = c.tutors.map((t) => {
      const patch = c.tutorPatches[t.name] || {};
      const card = h('div', { class: 'card' },
        h('h2', {}, h('span', { class: 'av' }, t.avatar || '🙂'), t.display, h('span', { class: 'off' }, t.name + (t.enabled ? '' : ' · 已关闭') + (t.hidden ? ' · 孩子端不露' : ''))),
        h('div', { class: 'grid' },
          h('label', {}, '显示名', h('input', { type: 'text', 'data-f': 'display', value: t.display })),
          h('label', {}, '学科', h('input', { type: 'text', 'data-f': 'subject', value: t.subject || '' })),
          h('label', {}, '头像(emoji)', h('input', { type: 'text', 'data-f': 'avatar', value: t.avatar || '' })),
          h('label', {}, '音色(voxtell id)', h('input', { type: 'text', 'data-f': 'voice', value: t.voice || '' })),
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', 'data-f': 'enabled', checked: t.enabled ? '' : undefined }), '开启'),
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', 'data-f': 'hidden', checked: t.hidden ? '' : undefined }), '孩子端不露'),
          ...policyInputs(patch, t.policy, { inherit: true })),
        h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button' }, '保存'), h('span', { class: 'fb' }), c.shipped.includes(t.name) ? null : h('button', { type: 'button', class: 'danger', style: 'margin-left:auto', on: { click: async () => { if (!confirm('删掉 ' + t.display + '?老师文件改名保留,会话与记忆不动。')) return; try { await api('DELETE', '/api/tutors/' + t.name); await loadConfig(); renderTeam(); } catch (e) { feedback(card, false, e.message); } } } }, '删掉这位老师')),
        fileEditor(t));
      $('.actions button', card).addEventListener('click', () => {
        try {
          const f = (name) => $('[data-f=' + name + ']', card);
          const entry = { display: f('display').value.trim(), subject: f('subject').value.trim() || null, avatar: f('avatar').value.trim() || null, voice: f('voice').value.trim() || null, enabled: f('enabled').checked, hidden: f('hidden').checked, policy: readPolicy(card) };
          patchAndReload(card, { tutors: { [t.name]: entry } });
        } catch (e) { feedback(card, false, e.message); }
      });
      return card;
    });
    root.replaceChildren(top, newTutorCard(), ...cards);
  };

  // ---- 设置:paths / 端口 / 证书 / 配音命令;文件仍是真相 ----
  const PATH_ROLES = [['vault', 'vault 根(Obsidian 仓库;空 = workspace 根)'], ['timetable', '课程表文件(相对 vault)'], ['plans', '计划目录(相对 vault)'], ['diary', '日记目录'], ['photos', '照片目录'], ['profile', '孩子档案文件']];
  // 政策文件里缺的出厂件(装了新版 cotutor 的老 workspace):cotutor.json 机器不自动改,所以在这里说清楚缺什么、一键补
  const migrateCard = () => {
    const gaps = (state.config && state.config.migrate) || [];
    if (!gaps.length) return null;
    const card = h('div', { class: 'card' }, h('h2', {}, '⬆ 这份 cotutor.json 缺 ' + gaps.length + ' 项出厂件'),
      h('ul', { class: 'gaps' }, ...gaps.map((g) => h('li', {}, g.detail))),
      h('p', { class: 'hint' }, '新版 cotutor 带来的新老师、新运行时、命令模板里的新旗标。cotutor.json 是你的政策文件,机器不会自己改它,所以要你点一下。只加上面这些,你改过的值(预算、缺省运行时、每句字数)一个都不动;终端里等同于 cotutor upgrade --config。'),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', on: { click: async () => {
        try { const r = await api('POST', '/api/config/migrate', {}); await loadConfig(); renderSettings(); feedback($('#settings .card'), true, '补了 ' + r.gaps.length + ' 项' + (r.installed.length ? ',顺带建了 ' + r.installed.length + ' 个文件与目录' : '')); }
        catch (e) { feedback(card, false, e.message); }
      } } }, '补上'), h('span', { class: 'fb' })));
    return card;
  };

  const renderSettings = () => {
    const c = state.config;
    if (!c) return;
    const card = h('div', { class: 'card' }, h('h2', {}, '路径与服务'), h('div', { class: 'grid' },
      ...PATH_ROLES.map(([k, label]) => h('label', {}, label, h('input', { type: 'text', 'data-p': k, value: c.paths[k] || '', placeholder: c.resolvedPaths[k] || '' }))),
      h('label', {}, '端口(改了要重启 serve)', h('input', { type: 'number', id: 's-port', value: c.server.port })),
      h('label', {}, 'HTTPS 证书(相对 workspace;空 = 用机器级 ~/.config/cotutor/certs/)', h('input', { type: 'text', id: 's-cert', value: c.https ? c.https.cert : '', placeholder: '留空即用 cotutor cert 签的' })),
      h('label', {}, 'HTTPS 私钥', h('input', { type: 'text', id: 's-key', value: c.https ? c.https.key : '', placeholder: '留空即用 cotutor cert 签的' }))),
      h('label', { style: 'display:block;margin-top:10px;font-size:12px;color:var(--dim)' }, '配音命令(JSON 数组;占位 {text} {voice} {out};voxtell 不在 PATH 就把第一项写成完整路径)', h('textarea', { id: 's-tts', style: 'min-height:60px' }, JSON.stringify(c.tts.say))),
      h('p', { class: 'hint' }, '写回 cotutor.json;kid、version、agents 的运行时模板请直接编辑文件。留空的路径角色用缺省;右侧灰字是现在解析到的绝对路径。'),
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', on: { click: async () => {
        try {
          const paths = {};
          for (const el of card.querySelectorAll('[data-p]')) paths[el.dataset.p] = el.value.trim() || null;
          const port = Number($('#s-port').value);
          if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口要是 1–65535');
          const cert = $('#s-cert').value.trim(), key = $('#s-key').value.trim();
          let say;
          try { say = JSON.parse($('#s-tts').value); } catch { throw new Error('配音命令要是 JSON 数组'); }
          if (!Array.isArray(say) || !say.length || !say.every((x) => typeof x === 'string')) throw new Error('配音命令要是非空字符串数组');
          await api('PATCH', '/api/config', { paths, server: { port, https: cert && key ? { cert, key } : null }, tts: { say } });
          await loadConfig(); feedback(card, true, '已写入 cotutor.json' + (port !== c.server.port ? ';端口改了,重启 serve 才生效' : ''));
        } catch (e) { feedback(card, false, e.message); }
      } } }, '保存设置'), h('span', { class: 'fb' })));
    const mig = migrateCard();
    $('#settings').replaceChildren(...(mig ? [mig, card] : [card]));
  };

  // ---- 启动 ----
  (async () => {
    await refreshHealth();
    await loadConfig();
    showTab(state.tab);
    const first = state.config.tutors.find((t) => t.enabled && !t.hidden) || state.config.tutors.find((t) => t.enabled);
    if (first) pickTutor(first.name);
    setInterval(refreshHealth, 10000);
    setInterval(async () => { const before = JSON.stringify(state.config && state.config.tutors); await loadConfig(); if (JSON.stringify(state.config.tutors) !== before && state.tab === 'team') renderTeam(); }, 10000);
  })().catch((e) => { $('#msgs').replaceChildren(h('p', { class: 'empty' }, '加载失败:' + e.message)); });
})();
</script>
</html>
`;
