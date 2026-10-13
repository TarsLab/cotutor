/**
 * 录像栏与孩子的屏幕(《家长录像设计.md》拍板 6、8、13–15):录像 = 上半孩子的屏幕(iframe 里孩子端页面的录像模式)+ 下半这一条录像栏。
 * 录像栏不认场景,只经 iframe 交过来的把手说话;话题(kid-page.ts 的 /reel)、听写(dictation/ 的 /dictation?reel=)都用这一份。
 *
 * 把手(iframe 起来后 parent.cotutorReelReady(把手, {size}),同源直接调):
 *   get()        → {p, total, wall, playing, speed, real, precise, cap: {text, cls}, size?, stale?};p、total 是录像里的毫秒(跳过空白开着时是压过的),wall 是这一刻的墙钟
 *   marks()      → [{kind, label, p, pTo?}] 进度条上的点(kind 当类名)
 *   events()     → [{p, kind, chip, text}] 经过,一条一行
 *   chapters?()  → [{p, title}] 章(话题一轮、听写一个词);进度条上断开一点,说明那行左边写在哪一章
 *   speeds?      → 倍速轮哪几档,缺省 1 / 1.5 / 2
 *   play(on) / seek(p) / drag(p) / real(on) / speed(x) / stop()
 *
 * 时间和视频一样(拍板 14):左下角是放到哪 / 一共要放多久,下面一行小字是当时几点;经过里每条写录像里的位置。
 * 上半占满宽度(拍板 15):按孩子屏幕的尺寸等比缩到铺满,窗口不够高才按高度缩;录像栏能收成一行(播放、细进度条、时间),顶上的小横条点或上下拉。
 * 下面三段插进页面:CSS 进 <style>,HTML 进页面,JS 进内联脚本(页面要先有 --paper --ink --dim --line --accent --grey --purple --purple-ink --ok --ok-ink;
 * 脚本里没有反斜杠与反引号,插进模板字符串也照样)。
 */

export const REEL_DOCK_CSS = `
  /* 录像:上半孩子的屏幕(占满宽度,不画设备框),下半录像栏 */
  #rl-screen { position:relative; flex:1; min-height:0; overflow:hidden; background:var(--paper); }
  #rl-screen[hidden] { display:none; }
  #rl-frame { position:absolute; left:0; top:0; width:1180px; height:820px; border:0; transform-origin:0 0; background:var(--paper); }
  #reel { position:relative; padding:14px 16px calc(env(safe-area-inset-bottom) + 12px); display:flex; flex-direction:column; gap:4px; border-top:1px solid var(--line); background:var(--paper); }
  #reel[hidden] { display:none; }
  #rl-grab { position:absolute; left:50%; top:0; width:72px; height:16px; margin-left:-36px; padding:0; border:0; background:transparent; touch-action:none; cursor:pointer; }
  #rl-grab i { display:block; width:40px; height:5px; margin:5px auto 0; border-radius:3px; background:var(--line); }
  .rl-caprow { display:flex; align-items:center; gap:8px; min-height:24px; touch-action:none; }
  #rl-chap { flex:none; max-width:40%; font-size:12px; color:var(--dim); border:1px solid var(--line); border-radius:6px; padding:0 7px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #rl-chap[hidden] { display:none; }
  #rl-cap { flex:1; min-width:0; min-height:22px; font-size:15px; font-weight:600; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #rl-cap.gap { color:var(--dim); font-weight:500; }
  #rl-cap.kid { color:var(--accent); }
  #rl-cap.miss { color:#b3541e; }
  #rl-more { flex:none; font-size:13px; color:var(--dim); border:1px solid var(--line); border-radius:12px; padding:2px 10px; background:#fff; }
  #rl-log { max-height:min(30vh, 260px); overflow-y:auto; border:1px solid var(--line); border-radius:12px; background:#fff; overscroll-behavior:contain; position:relative; }
  #rl-log[hidden] { display:none; }
  #rl-log ol { list-style:none; margin:0; padding:4px 0; }
  #rl-log li { display:grid; grid-template-columns:62px 68px minmax(0,1fr); gap:8px; align-items:baseline; padding:5px 12px; font-size:14px; line-height:1.45; cursor:pointer; }
  #rl-log li .rl-c { font-variant-numeric:tabular-nums; color:var(--dim); font-size:12px; }
  #rl-log li .rl-k { font-size:12px; border-radius:6px; padding:0 6px; text-align:center; white-space:nowrap; background:var(--grey); color:var(--dim); }
  #rl-log li .rl-k.said { background:#fde3d2; color:#9a4318; }
  #rl-log li .rl-k.card { background:var(--purple); color:var(--purple-ink); }
  #rl-log li .rl-k.miss, #rl-log li .rl-k.err { background:#fbe0d6; color:#b3541e; }
  #rl-log li .rl-k.tail { background:var(--ok); color:var(--ok-ink); }
  #rl-log li .rl-t { min-width:0; overflow-wrap:anywhere; }
  #rl-log li.fut { opacity:.45; }
  #rl-log li.cur { background:#fdeee4; }
  @media (max-width:600px) { #rl-log li { grid-template-columns:52px minmax(0,1fr); } #rl-log li .rl-k { display:none; } }
  /* 进度条:上面一排点,章与章之间断开一点 */
  .rl-trow { display:flex; align-items:center; gap:10px; }
  .rl-track { position:relative; flex:1; min-width:0; height:34px; }
  #rl-seek { position:absolute; left:0; right:0; bottom:0; width:100%; height:24px; margin:0; accent-color:var(--accent); background:none; }
  #rl-marks, #rl-chaps { position:absolute; left:8px; right:8px; top:0; height:10px; }
  #rl-chaps { top:auto; bottom:7px; height:10px; pointer-events:none; z-index:1; }
  #rl-chaps i { position:absolute; top:0; width:3px; height:10px; margin-left:-1.5px; background:var(--paper); }
  #rl-marks i { position:absolute; top:0; width:9px; height:9px; margin-left:-4.5px; border-radius:50%; cursor:pointer; background:var(--accent); }
  #rl-marks i::before { content:""; position:absolute; inset:-8px; }
  #rl-marks i.said { background:var(--accent); }
  #rl-marks i.card { background:#2fa36b; }
  #rl-marks i.ask { background:#5b3d86; border-radius:2px; transform:scale(.8); }
  #rl-marks i.error, #rl-marks i.rv { background:#b3541e; border-radius:2px; }
  #rl-marks i.lecture { background:#c95a22; border-radius:2px; }
  #rl-marks i.circle { background:#2f6fd6; }
  #rl-marks i.erase { background:#b9b4a8; width:7px; height:7px; margin-left:-3.5px; top:1px; }
  /* 按住说话没发出去:每次一个淡点;连着几次的一串是一条橙色的带(拍板 10) */
  #rl-marks i.miss { background:#b9b4a8; width:7px; height:7px; margin-left:-3.5px; top:1px; }
  #rl-marks i.misses { background:#e8743b40; border:1px solid #e8743b; border-radius:5px; height:9px; margin-left:-3px; box-sizing:border-box; }
  .rl-row { display:flex; align-items:center; gap:8px; font-size:14px; color:var(--dim); }
  .rl-when { flex:none; display:flex; flex-direction:column; align-items:flex-start; gap:1px; line-height:1.2; }
  #rl-play, #rl-mplay { flex:none; width:44px; height:44px; border-radius:50%; background:var(--ink); color:#fff; display:grid; place-items:center; border:0; }
  #rl-clock, #rl-mclock { font-variant-numeric:tabular-nums; color:var(--ink); font-size:15px; white-space:nowrap; }
  .rl-subrow { display:flex; align-items:center; gap:4px; }
  #rl-sub { font-size:11px; color:var(--dim); font-variant-numeric:tabular-nums; white-space:nowrap; }
  #rl-tag, #rl-ver { font-size:11px; border:1px solid var(--line); border-radius:7px; padding:0 6px; background:#fff; white-space:nowrap; color:var(--dim); }
  #rl-tag[hidden], #rl-ver[hidden], #rl-x[hidden] { display:none; }
  .rl-sp { flex:1; }
  /* 手机上控制行放不下一行:开关、倍速、收起、退出折到第二行,靠右 */
  @media (max-width:600px) { .rl-row { flex-wrap:wrap; row-gap:6px; } .rl-row .rl-sp { flex:1 0 100%; height:0; } .rl-row .rl-sw { margin-left:auto; } }
  .rl-row .tx, .rl-trow .tx { flex:none; height:34px; padding:0 11px; border-radius:17px; white-space:nowrap; border:1px solid var(--line); background:#fff; font-size:14px; color:var(--ink); }
  .rl-row .ic, .rl-trow .ic { flex:none; width:34px; height:34px; border-radius:17px; border:1px solid var(--line); background:#fff; color:var(--dim); display:grid; place-items:center; padding:0; }
  /* 「跳过空白」是个开关(主流播放器的「跳过静音」都这样):滑块在右、底色填满 = 开着 */
  .rl-sw { flex:none; display:inline-flex; align-items:center; gap:6px; height:34px; font-size:14px; color:var(--ink); cursor:pointer; white-space:nowrap; }
  .rl-sw input { position:absolute; opacity:0; width:1px; height:1px; pointer-events:none; }
  .rl-sw i { position:relative; flex:none; width:36px; height:22px; border-radius:11px; background:var(--line); transition:background .15s; }
  .rl-sw i::after { content:""; position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#fff; box-shadow:0 1px 3px #00000033; transition:transform .15s; }
  .rl-sw input:checked + i { background:var(--accent); }
  .rl-sw input:checked + i::after { transform:translateX(14px); }
  .rl-sw input:focus-visible + i { outline:2px solid var(--accent); outline-offset:2px; }
  /* 收起:只剩一行(播放、细进度条、时间、展开) */
  .rl-mini { display:none !important; }
  #reel.min { padding-top:12px; gap:0; }
  #reel.min .rl-caprow, #reel.min #rl-log, #reel.min .rl-row { display:none; }
  #reel.min .rl-mini { display:grid !important; }
  #reel.min #rl-mclock.rl-mini { display:block !important; font-size:14px; }
  #reel.min #rl-mplay { width:34px; height:34px; }
  #reel.min #rl-marks i { width:6px; height:6px; margin-left:-3px; }
`;

export const REEL_DOCK_HTML = `<div id="reel" hidden>
      <button id="rl-grab" type="button" aria-label="收起录像栏" aria-expanded="true"><i></i></button>
      <div id="rl-log" hidden><ol></ol></div>
      <div class="rl-caprow" id="rl-caprow"><span id="rl-chap" hidden></span><div id="rl-cap"></div><button id="rl-more" type="button" aria-expanded="false">经过 ▴</button></div>
      <div class="rl-trow"><button class="rl-mini" id="rl-mplay" type="button" aria-label="播放"></button><div class="rl-track"><div id="rl-marks"></div><div id="rl-chaps"></div><input id="rl-seek" type="range" min="0" max="1000" step="100" value="0" aria-label="录像进度"></div><span class="rl-mini" id="rl-mclock"></span><button class="rl-mini ic" id="rl-unfold" type="button" aria-label="展开录像栏"></button></div>
      <div class="rl-row"><button id="rl-play" type="button" aria-label="播放"></button><span class="rl-when"><span id="rl-clock"></span><span class="rl-subrow"><span id="rl-sub"></span><button id="rl-tag" type="button" hidden>推算</button><button id="rl-ver" type="button" hidden>画法已更新</button></span></span><span class="rl-sp"></span><label class="rl-sw" title="孩子想了很久、等老师很久的地方各压成 1.5 秒;关掉就是完整版,按真实时间放"><input type="checkbox" id="rl-skip" role="switch" checked><i></i>跳过空白</label><button class="tx" id="rl-speed" type="button">1×</button><button class="ic" id="rl-fold" type="button" aria-label="收起录像栏"></button><button class="tx" id="rl-x" type="button" hidden>退出</button></div>
    </div>`;

export const REEL_DOCK_JS = `
  // ---- 录像栏(src/server/reel-dock.ts):不认场景,只经把手说话;家长页(隔着 iframe)或直接打开孩子屏幕时在它自己身上 ----
  const reelDock = (() => {
    const q = (s) => document.querySelector(s);
    const SV = (p, sw) => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
    const PLAY = SV('<path d="M8 5l11 7-11 7z" fill="currentColor"></path>', 1.5), PAUSE = SV('<path d="M8 5v14M16 5v14"></path>', 2.6);
    const p2 = (n) => String(n).padStart(2, '0');
    /** 录像里的位置(拍板 14:和视频一样):m:ss,一小时以上 h:mm:ss */
    const pos = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? h + ':' + p2(m) + ':' + p2(x) : m + ':' + p2(x); };
    const hms = (t) => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()); };
    const kept = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const keep = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
    const pct = (p, total) => (100 * p / Math.max(1, total)).toFixed(2) + '%';
    const li = (cls, text) => { const e = document.createElement('span'); e.className = cls; e.textContent = text; return e; };
    let RE = null, O = {}, timer = 0, real = null, playing = null, dragging = false, ev = [], cur = -2, chaps = [], size = null, speeds = [1, 1.5, 2];
    /** 上半:孩子的屏幕按它的尺寸等比缩到铺满(拍板 15),窗口不够高才按高度缩 */
    const fit = () => {
      const sc = q('#rl-screen'), fr = q('#rl-frame');
      if (!sc || !fr || sc.hidden || !size) return;
      const w = size[0], h = size[1], k = Math.min(sc.clientWidth / w, sc.clientHeight / h);
      fr.style.width = w + 'px'; fr.style.height = h + 'px';
      fr.style.transform = 'translate(' + Math.round((sc.clientWidth - w * k) / 2) + 'px,' + Math.round((sc.clientHeight - h * k) / 2) + 'px) scale(' + k + ')';
    };
    /** 经过:跟着录像的钟亮当前那条;展开着才滚 */
    const log = (st) => {
      if (st.real !== real || !ev.length) {
        ev = RE.events(); cur = -2;
        q('#rl-log ol').replaceChildren(...ev.map((e) => { const x = document.createElement('li'); x.append(li('rl-c', pos(e.p)), li('rl-k ' + e.kind, e.chip), li('rl-t', e.text)); x.addEventListener('click', () => { if (RE) RE.seek(e.p + 1); }); return x; }));
      }
      let c = -1; ev.forEach((e, i) => { if (e.p <= st.p + 1) c = i; });
      if (c === cur) return;
      cur = c;
      const lis = q('#rl-log ol').children;
      for (let i = 0; i < lis.length; i++) { lis[i].classList.toggle('cur', i === c); lis[i].classList.toggle('fut', i > c); }
      const box = q('#rl-log'), x = lis[Math.max(0, c)];
      if (!box.hidden && x) box.scrollTo({ top: Math.max(0, x.offsetTop - box.clientHeight / 2 + x.offsetHeight / 2), behavior: 'smooth' });
    };
    const more = (open) => {
      q('#rl-log').hidden = !open; q('#rl-more').setAttribute('aria-expanded', String(open)); q('#rl-more').textContent = open ? '经过 ▾' : '经过 ▴';
      keep('parent-reel-log', open ? '1' : '0');
      cur = -2; const st = RE && RE.get(); if (st) log(st);
    };
    /** 收起成一行 / 展开(拍板 15),这台设备记住 */
    const fold = (min) => {
      q('#reel').classList.toggle('min', min);
      q('#rl-grab').setAttribute('aria-expanded', String(!min)); q('#rl-grab').setAttribute('aria-label', min ? '展开录像栏' : '收起录像栏');
      keep('parent-reel-min', min ? '1' : '0');
      cur = -2; fit();
    };
    const render = () => {
      const st = RE && RE.get(); if (!st) return;
      log(st);
      if (st.real !== real) {
        real = st.real;
        q('#rl-seek').max = String(Math.max(1, Math.round(st.total)));
        q('#rl-marks').replaceChildren(...RE.marks().map((m) => {
          const i = document.createElement('i'); i.className = m.kind; i.title = pos(m.p) + ' ' + m.label;
          i.style.left = pct(m.p, st.total); if (m.pTo !== undefined) i.style.width = 'calc(' + pct(m.pTo - m.p, st.total) + ' + 6px)';
          i.addEventListener('click', () => { if (RE) RE.seek(m.p); });
          return i;
        }));
        chaps = RE.chapters ? RE.chapters() : [];
        q('#rl-chaps').replaceChildren(...chaps.slice(1).map((c) => { const i = document.createElement('i'); i.style.left = pct(c.p, st.total); return i; }));
        q('#rl-skip').checked = !st.real;
      }
      if (!dragging) q('#rl-seek').value = String(Math.round(st.p));
      const t = pos(st.p) + ' / ' + pos(st.total);
      q('#rl-clock').textContent = t; q('#rl-mclock').textContent = t;
      q('#rl-sub').textContent = '当时 ' + hms(st.wall);
      let ch = null; chaps.forEach((c) => { if (c.p <= st.p + 1) ch = c; });
      q('#rl-chap').hidden = !ch; if (ch && q('#rl-chap').textContent !== ch.title) q('#rl-chap').textContent = ch.title;
      if (st.playing !== playing) {
        playing = st.playing;
        for (const b of [q('#rl-play'), q('#rl-mplay')]) { b.innerHTML = st.playing ? PAUSE : PLAY; b.setAttribute('aria-label', st.playing ? '暂停' : '播放'); }
      }
      const cap = q('#rl-cap'); if (cap.textContent !== st.cap.text) { cap.textContent = st.cap.text; cap.className = st.cap.cls; }
      q('#rl-ver').hidden = !st.stale;
      // 孩子转了屏、换了尺寸:上半照这一刻的尺寸重缩(家长页那头;直接打开孩子屏幕时没有 size)
      if (st.size && size && (st.size[0] !== size[0] || st.size[1] !== size[1])) { size = st.size; fit(); }
    };
    if (window.ResizeObserver && q('#rl-screen')) new ResizeObserver(fit).observe(q('#rl-screen')); else window.addEventListener('resize', fit);
    q('#rl-fold').innerHTML = SV('<path d="M6 9l6 6 6-6"></path>', 2.2);
    q('#rl-unfold').innerHTML = SV('<path d="M6 15l6-6 6 6"></path>', 2.2);
    const toggle = () => { if (RE) { const st = RE.get(); if (st) RE.play(!st.playing); } };
    q('#rl-play').addEventListener('click', toggle);
    q('#rl-mplay').addEventListener('click', toggle);
    q('#rl-x').addEventListener('click', () => { if (O.exit) O.exit(); });
    q('#rl-tag').addEventListener('click', () => { if (O.toast && O.tagHint) O.toast(O.tagHint); });
    q('#rl-ver').addEventListener('click', () => { if (O.toast) O.toast('这段是旧版孩子端录的,现在用新版的样子画:孩子做了什么照旧,样子可能和孩子当时看到的不一样'); });
    q('#rl-more').addEventListener('click', () => more(q('#rl-log').hidden));
    q('#rl-fold').addEventListener('click', () => fold(true));
    q('#rl-unfold').addEventListener('click', () => fold(false));
    // 小横条:点一下切换;往下拉收起、往上拉展开
    { let y0 = null, moved = false; const g = q('#rl-grab');
      g.addEventListener('pointerdown', (e) => { y0 = e.clientY; moved = false; try { g.setPointerCapture(e.pointerId); } catch (x) {} });
      g.addEventListener('pointermove', (e) => { if (y0 === null) return; const dy = e.clientY - y0, min = q('#reel').classList.contains('min'); if (dy > 20 && !min) { fold(true); moved = true; y0 = e.clientY; } else if (dy < -20 && min) { fold(false); moved = true; y0 = e.clientY; } });
      g.addEventListener('pointerup', () => { if (y0 !== null && !moved) fold(!q('#reel').classList.contains('min')); y0 = null; });
      g.addEventListener('pointercancel', () => { y0 = null; }); }
    // 在说明那一行上往上拉展开经过、往下拉收起
    { let y0 = null; const row = q('#rl-caprow');
      row.addEventListener('pointerdown', (e) => { if (e.target.closest('#rl-more')) return; y0 = e.clientY; });
      row.addEventListener('pointerup', (e) => { if (y0 === null) return; const dy = e.clientY - y0; y0 = null; if (dy < -24) more(true); else if (dy > 24) more(false); });
      row.addEventListener('pointercancel', () => { y0 = null; }); }
    q('#rl-skip').addEventListener('change', (e) => { if (RE) RE.real(!e.target.checked); });
    q('#rl-speed').addEventListener('click', (e) => { if (!RE) return; const st = RE.get(); const x = speeds[(speeds.indexOf(st.speed) + 1) % speeds.length]; RE.speed(x); e.currentTarget.textContent = x + '×'; });
    // 拖的时候不出声,松手从那一刻接着放
    q('#rl-seek').addEventListener('input', (e) => { if (!RE) return; dragging = true; RE.drag(Number(e.target.value)); });
    q('#rl-seek').addEventListener('change', (e) => { if (!RE) return; dragging = false; RE.seek(Number(e.target.value)); });
    return {
      /** 接上一个把手:o.exit(有就出「退出」)、o.toast、o.tagHint(「推算」点了说什么) */
      open: (api, o) => {
        RE = api; O = o || {}; real = null; playing = null; dragging = false; ev = []; chaps = [];
        speeds = api.speeds && api.speeds.length ? api.speeds : [1, 1.5, 2];
        const st = api.get();
        q('#rl-speed').textContent = st.speed + '×';
        q('#rl-tag').hidden = st.precise; q('#rl-x').hidden = !O.exit;
        q('#reel').hidden = false;
        more(kept('parent-reel-log') === '1'); fold(kept('parent-reel-min') === '1');
        clearInterval(timer); timer = setInterval(render, 100);
        render();
      },
      close: () => { clearInterval(timer); RE = null; size = null; q('#reel').hidden = true; },
      /** 孩子屏幕的尺寸(CSS 像素):上半照它缩 */
      frame: (sz) => { size = sz; fit(); },
    };
  })();
`;
