/**
 * 实时老师页那颗「头像 + 按住说话」按钮的画法,动画只写这一处。
 * 页面只做两件事:把状态凑好交给 src/lib/voice-view.ts 的 voiceView,拿到样子交给这里的按钮(set);把音量喂进来(老师的给一个取音量的口子,孩子的随时 level)。
 * 孩子端老师页(平板横屏左栏、手机字幕行那颗头像、板书模式字幕行那颗头像的动作)和工作台 /dev/voice 样张都引用这里。
 *
 * 两种声音:
 * - 老师的:头像旁紧挨着三道小弧「)))」,老师的颜色,不走、不放大,只有深浅跟老师的音量(平滑、三道依次错开一点);没声音淡到最低。
 *   10-21 Jack:有字幕在变、有声音,老师这边动画太强会把孩子的注意力从内容上拉走——所以只留这么一点,头像也不再一圈圈放大。
 * - 孩子的:竖条从按钮另一头往头像里走,高低跟麦克风音量,走到头像收进去、头像外圈亮一下;按着没声音是小点慢慢走。
 * 插话(一直听时孩子开口而老师还在说)两样都在,老师的淡到三成。镜像(左撇子)时方向反过来。系统「减弱动态效果」时竖条不走,只按音量变高低。
 *
 * 要改动画:先改下面的 VOICE_TUNE(快慢、深浅、大小、颜色都在这里);样子的种类在 voice-view.ts;打开 /dev/voice 一页看全部。
 * VOICE_JS 插进页面的模板字符串:不写反斜杠、反引号、美元加花括号(CLAUDE.md「坑」)。
 */

/** 调参表:以后要再弱、再强、再快、再慢,只改这里 */
export const VOICE_TUNE = {
  // —— 老师的声音:头像旁三道小弧 ——
  /** 三道弧的半径(像素,从头像边量起;最外一道离头像边不超过 ~36) */
  arcR: [9, 17, 25],
  /** 线宽(像素) */
  arcW: 2.75,
  /** 弧张开多少度 */
  arcSpan: 96,
  /** 不透明度:最低(有声音也最轻)/ 最高(最响) */
  arcMin: 0.12,
  arcMax: 0.45,
  /** 没声音时:'min' 淡到最低还留着 / 'hide' 消失 */
  arcQuiet: 'min' as 'min' | 'hide',
  /** 平滑后的音量低于这个算没声音 */
  arcFloor: 0.04,
  /** 音量平滑(毫秒) */
  arcSmooth: 200,
  /** 三道依次错开(毫秒):里面那道先亮 */
  arcLag: 80,
  /** 老师的音量(放出去那条链上的 RMS)乘这个到 0–1 */
  arcGain: 5,
  /** 嘴停、孩子按下时三道弧收掉的时长;往上滑取消时路上的竖条原地淡掉也是这么久(毫秒) */
  arcFade: 150,
  /** 插话时老师的弧淡到几成 */
  duck: 0.3,
  /** 老师在说时头像外圈:'static' 一道淡淡的静止外圈 / 'breath' 很慢地明暗 / 'none' 什么都不加 */
  talkHalo: 'static' as 'static' | 'breath' | 'none',
  talkHaloOpacity: 0.16,
  /** 'breath' 时一明一暗多久(毫秒) */
  talkHaloBreathMs: 2600,
  // —— 孩子的声音:竖条往头像里走 ——
  /** 多久出一根竖条(毫秒;一根 6 像素宽,100 毫秒一根走 1.5 秒,一条上约 15 根) */
  barEvery: 100,
  /** 一根竖条从另一头走到头像要多久(毫秒) */
  barTravel: 1500,
  /** 竖条宽、最矮、最高(像素) */
  barW: 6,
  barMin: 4,
  barMax: 44,
  /** 孩子的音量(0–1)低于这个算没声音,画小点 */
  kidQuiet: 0.08,
  /** 音量多久没更新就当没声音(毫秒) */
  kidStale: 300,
  /** 小点:多久一个、走多久、多大(像素) */
  dotEvery: 400,
  dotTravel: 2400,
  dotH: 5,
  /** 松手时路上剩下的竖条走进头像要多久(毫秒) */
  rush: 400,
  /** 竖条走到头像时头像外圈亮一下多久(毫秒) */
  recvMs: 260,
  /** 竖条的颜色:蓝底上白的,别的底上蓝的 */
  kidOnBlue: '#ffffff',
  kidColor: '#3d7fd9',
};

const ICONS: Record<string, string> = {
  mic: '<svg width="24" height="24" viewBox="0 0 22 22" aria-hidden="true"><rect x="8" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 10.5 a6 6 0 0 0 12 0 M11 16.5 v3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  micOff: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="8" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 10.5 a6 6 0 0 0 12 0 M11 16.5 v3 M4 3 L18 19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  photo: '<svg width="22" height="22" viewBox="0 0 26 26" aria-hidden="true"><rect x="4" y="5" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 17 l5-5 4 4 3-3 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  up: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M11 18 V5 M5 10.5 L11 4.5 L17 10.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  phone: '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5 l3 3 -2 2.5 a12 12 0 0 0 7.5 7.5 l2.5 -2 3 3 -2.5 3 a15 15 0 0 1 -14.5 -14.5 z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
};

export const VOICE_CSS = `
  /* ---- 按住说话那颗按钮(头像 + 声音,src/server/voice-ui.ts):底色在 data-tone,哪种样子在 data-voice,头像的动作是 .vb-face 上的 .vb-<face> ---- */
  .vb { position:relative; display:flex; align-items:center; gap:10px; width:312px; height:120px; box-sizing:border-box; padding:0 18px 0 12px; border-radius:32px; border:1.5px solid #e2dfd6; background:#fff; box-shadow:0 4px 16px #00000012; color:#2b2b2b; font:inherit; text-align:left; touch-action:none; -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; transition:background-color .15s, border-color .15s, box-shadow .15s, color .15s, opacity .15s, transform .2s ease-out, filter .2s ease-out; }
  .vb.vb-right { flex-direction:row-reverse; padding:0 12px 0 18px; text-align:right; }
  .vb[data-tone=blue] { background:#3d7fd9; border-color:#3d7fd9; color:#fff; box-shadow:0 8px 22px #3d7fd961; }
  .vb[data-tone=grey] { background:#f7f6f2; border-color:#ebe8df; color:#8a8781; box-shadow:none; }
  .vb[data-tone=cancel] { background:#e9ecf1; border-color:#d5dbe4; color:#4d5563; box-shadow:none; }
  .vb[data-tone=light] { background:#eaf2fd; border-color:#bcd6f5; color:#2a5ea8; box-shadow:none; }
  /* 按下反馈,同孩子端大块面那一档(缩到 98.5% + 暗一点):按上去马上有手感;满 150 毫秒才算按住说话、变蓝(轻碰不打断老师) */
  .vb:active { transform:scale(.985); filter:brightness(.97); transition-duration:.06s; }
  @media (hover:hover) { .vb:hover { filter:brightness(.98); } }
  .vb-av { position:relative; flex:none; width:96px; height:96px; display:grid; place-items:center; border-radius:50%; --vb-h1:6px; --vb-h2:-2px; transition:box-shadow .2s; }
  .vb-av > .av { width:72px; height:72px; font-size:34px; }
  .vb-side { position:relative; z-index:1; flex:1; align-self:stretch; min-width:0; }
  .vb-big { position:absolute; left:0; right:0; top:50%; transform:translateY(-50%); display:flex; align-items:center; gap:8px; font-size:20px; font-weight:600; line-height:1.3; }
  .vb-big[hidden], .vb-small[hidden] { display:none; }
  .vb-right .vb-big { justify-content:flex-end; }
  .vb-ic { display:inline-flex; flex:none; }
  .vb-ic:empty { display:none; }
  .vb-ic svg { display:block; }
  .vb-dots { display:none; gap:3px; align-items:center; }
  .vb-wait .vb-dots { display:inline-flex; }
  .vb-dots i { width:5px; height:5px; border-radius:50%; background:currentColor; animation:vb-dot 1.2s ease-in-out infinite; }
  .vb-dots i:nth-child(2) { animation-delay:.2s; }
  .vb-dots i:nth-child(3) { animation-delay:.4s; }
  .vb-small { position:absolute; left:0; right:0; bottom:12px; font-size:14px; line-height:1.3; color:#8a8781; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .vb[data-tone=blue] .vb-small { color:#ffffffe6; }
  .vb[data-tone=light] .vb-small { color:#4d74a8; }
  .vb[data-tone=cancel] .vb-small { color:#4d5563; }
  .vb-track { position:absolute; z-index:0; left:96px; right:18px; top:50%; height:56px; margin-top:-28px; pointer-events:none; }
  .vb-right .vb-track { left:18px; right:96px; }
  /* 画板铺满时工具列最底下那颗:只有头像;底色、头像的动作同大的那颗(两颗一起变),声音的弧和竖条不画 */
  .vb.vb-mini { width:64px; height:64px; padding:0; border-radius:50%; justify-content:center; gap:0; }
  .vb.vb-mini .vb-side, .vb.vb-mini .vb-track { display:none; }
  .vb.vb-mini .vb-av { width:56px; height:56px; --vb-h1:-3px; --vb-h2:-9px; }
  .vb.vb-mini .vb-av > .av { width:46px; height:46px; font-size:22px; }
  .vb.vb-shake { animation:vb-shake .5s ease-in-out; }
  .vb.vb-breathe { animation:vb-glow 2.4s ease-in-out infinite; }
  /* 头像的动作(按钮里那颗、手机字幕行那颗、板书模式字幕行那颗都用这一套) */
  .vb-halo::before, .vb-halo::after { content:""; position:absolute; border-radius:50%; border:3px solid var(--tc, currentColor); opacity:0; pointer-events:none; transition:opacity .3s, border-color .2s; }
  .vb-halo::before { inset:var(--vb-h1, -12%); }
  .vb-halo::after { inset:var(--vb-h2, -26%); }
  .vb-halo-static .vb-talk.vb-halo::before { opacity:var(--vb-halo-op, .16); }
  .vb-halo-breath .vb-talk.vb-halo::before { opacity:var(--vb-halo-op, .16); animation:vb-halo var(--vb-halo-ms, 2.6s) ease-in-out infinite; }
  .vb-listen.vb-halo::before, .vb-listen.vb-halo::after { border-color:#3d7fd9; }
  .vb-listen.vb-halo::before { opacity:.36; }
  .vb-listen.vb-halo::after { opacity:.16; }
  .vb[data-tone=blue] .vb-listen.vb-halo::before, .vb[data-tone=blue] .vb-listen.vb-halo::after { border-color:#fff; }
  .vb[data-tone=blue] .vb-listen.vb-halo::before { opacity:.6; }
  .vb[data-tone=blue] .vb-listen.vb-halo::after { opacity:.3; }
  .vb-av.vb-recv { box-shadow:0 0 0 7px #3d7fd940; }
  .vb[data-tone=blue] .vb-av.vb-recv { box-shadow:0 0 0 7px #ffffff66; }
  .vb-think .ring circle { animation:vb-spin 2.4s linear infinite, vb-breathe 1.2s ease-in-out infinite; }
  .vb-mouth .ring circle { animation:vb-mouth 1.6s ease-in-out infinite; }
  .vb-listen:not(.vb-av) .ring circle { animation:vb-turn .35s ease-out both, vb-listen 1.6s ease-in-out .35s infinite; }
  .vb-nod .ring circle { animation:vb-nod .9s ease-in-out; }
  .vb-ring { animation:vb-phone 1.2s ease-in-out infinite; }
  .vb-dim { opacity:.6; }
  @keyframes vb-mouth { 0%,46%,100% { stroke-dasharray:221.17 55.29; transform:rotate(36deg); } 12% { stroke-dasharray:187.99 88.47; transform:rotate(57.6deg); } 22% { stroke-dasharray:226.7 49.76; transform:rotate(32.4deg); } 34% { stroke-dasharray:193.52 82.94; transform:rotate(54deg); } 58% { stroke-dasharray:182.46 94; transform:rotate(61.2deg); } 70% { stroke-dasharray:215.64 60.82; transform:rotate(39.6deg); } 82% { stroke-dasharray:199.05 77.41; transform:rotate(50.4deg); } }
  @keyframes vb-spin { from { transform:rotate(36deg); } to { transform:rotate(396deg); } }
  @keyframes vb-breathe { 0%,100% { stroke-dasharray:221.17 55.29; } 50% { stroke-dasharray:204.58 71.88; } }
  @keyframes vb-turn { to { transform:rotate(126deg); } }
  @keyframes vb-listen { 0%,100% { stroke-dasharray:221.17 55.29; transform:rotate(126deg); } 50% { stroke-dasharray:204.58 71.88; transform:rotate(136.8deg); } }
  @keyframes vb-nod { 0%,100% { transform:rotate(36deg); } 30% { transform:rotate(60deg); } 60% { transform:rotate(26deg); } 80% { transform:rotate(41deg); } }
  @keyframes vb-phone { 0%,70%,100% { transform:rotate(0); } 10% { transform:rotate(-10deg); } 25% { transform:rotate(9deg); } 40% { transform:rotate(-6deg); } 55% { transform:rotate(3deg); } }
  @keyframes vb-halo { 0%,100% { opacity:var(--vb-halo-op, .16); } 50% { opacity:calc(var(--vb-halo-op, .16) * .45); } }
  @keyframes vb-shake { 0%,100% { transform:translateX(0); } 18% { transform:translateX(-6px); } 36% { transform:translateX(6px); } 54% { transform:translateX(-4px); } 72% { transform:translateX(4px); } }
  @keyframes vb-glow { 0%,100% { box-shadow:0 0 0 3px #3d7fd940, 0 0 0 10px #3d7fd90f; } 50% { box-shadow:0 0 0 6px #3d7fd973, 0 0 0 18px #3d7fd914; } }
  @keyframes vb-dot { 0%,100% { opacity:.25; } 50% { opacity:1; } }
  @media (prefers-reduced-motion:reduce) { .vb, .vb *, .vb-face, .vb-face *, .vb-face::before, .vb-face::after { animation:none !important; transition:none !important; } }
`;

export const VOICE_JS = `
  /* ---- 按住说话那颗按钮的画法(src/server/voice-ui.ts;样子是 voice-view.ts 的 voiceView 给的)---- */
  var VOICE_TUNE = ${JSON.stringify(VOICE_TUNE)};
  var VOICE_ICONS = ${JSON.stringify(ICONS)};
  var VOICE_FACES = ['still', 'talk', 'listen', 'think', 'ring', 'dim', 'mouth'];
  try {
    var vbRoot = document.documentElement;
    vbRoot.classList.add('vb-halo-' + VOICE_TUNE.talkHalo);
    vbRoot.style.setProperty('--vb-halo-op', String(VOICE_TUNE.talkHaloOpacity));
    vbRoot.style.setProperty('--vb-halo-ms', VOICE_TUNE.talkHaloBreathMs + 'ms');
  } catch (e) {}
  /** 头像的动作:el 是装着 .av 的那一格(或 .av 本身);face 是 voiceView 的 face,板书模式多一种 mouth(开口一张一合) */
  function voiceFace(el, face) {
    if (!el) return;
    for (var i = 0; i < VOICE_FACES.length; i++) el.classList.remove('vb-' + VOICE_FACES[i]);
    el.classList.add('vb-face', 'vb-' + (face || 'still'));
  }
  /** 一颗按钮:el 是空的 button;opts.side = 'left'(头像在左)/ 'right'(镜像);回一个把手 */
  function voiceButton(el, opts) {
    var T = VOICE_TUNE;
    opts = opts || {};
    el.classList.add('vb');
    el.innerHTML = '<span class="vb-av vb-halo"></span><span class="vb-side"><span class="vb-big"><i class="vb-ic"></i><b></b><span class="vb-dots"><i></i><i></i><i></i></span></span><span class="vb-small"></span></span><canvas class="vb-track" aria-hidden="true"></canvas>';
    var av = el.querySelector('.vb-av'), cv = el.querySelector('.vb-track'), bigEl = el.querySelector('.vb-big'), bEl = el.querySelector('.vb-big b'), icEl = el.querySelector('.vb-ic'), smEl = el.querySelector('.vb-small');
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    var S = { view: null, side: 'left', color: opts.color || '#c43c74', src: null, tl: 0, hist: [], arcVis: 0, kid: 0, kidAt: -1e9, bars: [], lastBar: 0, lastDot: 0, raf: 0, last: 0, recvAt: 0, meter: [], drawn: { arcs: [], bars: 0 } };
    var kick = function () { if (!S.raf) { S.last = 0; S.raf = requestAnimationFrame(frame); } };
    var travelOf = function () { return Math.max(1, cv.clientWidth - 4); };
    var barX = function (b, now) {
      if (b.fade) return b.fade[0];
      if (b.rush) return b.rush[0] * (1 - Math.min(1, (now - b.rush[1]) / T.rush));
      return travelOf() * (1 - Math.min(1, (now - b.t0) / b.dur));
    };
    var shake = function () { el.classList.remove('vb-shake'); void el.offsetWidth; el.classList.add('vb-shake'); };
    var recv = function (now) {
      if (now - S.recvAt < T.recvMs) return;
      S.recvAt = now;
      av.classList.add('vb-recv');
      setTimeout(function () { av.classList.remove('vb-recv'); }, T.recvMs);
    };
    /** 老师的音量在 t 那一刻(平滑后的;三道弧依次往回看一点) */
    var tlAt = function (t) {
      var h = S.hist, v = h.length ? h[0][1] : 0;
      for (var i = 0; i < h.length; i++) { if (h[i][0] <= t) v = h[i][1]; else break; }
      return v;
    };
    var bar = function (g, x, cy, hh) {
      var w = T.barW, r = w / 2, y = cy - hh / 2;
      g.beginPath(); g.moveTo(x - r, y + r); g.arc(x, y + r, r, Math.PI, 0); g.lineTo(x + r, y + hh - r); g.arc(x, y + hh - r, r, 0, Math.PI); g.closePath(); g.fill();
    };
    var frame = function (now) {
      S.raf = 0;
      var v = S.view;
      if (!v) return;
      var dt = S.last ? Math.min(100, now - S.last) : 16;
      S.last = now;
      var dpr = window.devicePixelRatio || 1, w = cv.clientWidth, hh = cv.clientHeight;
      if (!w || !hh) { S.last = 0; return; }
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
      var g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, hh);
      if (S.side === 'right') { g.translate(w, 0); g.scale(-1, 1); }
      var cy = hh / 2, out = v.flow === 'out' || v.flow === 'both', inn = v.flow === 'in' || v.flow === 'both';
      // 老师:三道小弧,不走、不放大,深浅跟平滑后的音量
      var raw = out && S.src ? Math.max(0, Math.min(1, S.src() * T.arcGain)) : 0;
      S.tl += (raw - S.tl) * (1 - Math.exp(-dt / T.arcSmooth));
      S.hist.push([now, S.tl]);
      while (S.hist.length > 2 && now - S.hist[1][0] > T.arcLag * T.arcR.length + 120) S.hist.shift();
      S.arcVis = out ? Math.min(1, S.arcVis + dt / T.arcFade) : Math.max(0, S.arcVis - dt / T.arcFade);
      S.drawn.arcs = [];
      if (S.arcVis > 0) {
        var span = T.arcSpan * Math.PI / 360;
        g.lineWidth = T.arcW; g.lineCap = 'round'; g.strokeStyle = S.color;
        for (var i = 0; i < T.arcR.length; i++) {
          var l = tlAt(now - i * T.arcLag);
          var a = l < T.arcFloor ? (T.arcQuiet === 'hide' ? 0 : T.arcMin) : T.arcMin + (T.arcMax - T.arcMin) * Math.min(1, l);
          if (v.flow === 'both') a *= T.duck;
          a *= S.arcVis;
          S.drawn.arcs.push({ r: T.arcR[i], a: Math.round(a * 1000) / 1000 });
          if (a <= 0.003) continue;
          g.globalAlpha = a;
          g.beginPath(); g.arc(0, cy, T.arcR[i], -span, span); g.stroke();
        }
        g.globalAlpha = 1;
      }
      // 孩子:竖条往头像里走(减弱动态效果时不走,按最近的音量排一排)
      var fresh = now - S.kidAt < T.kidStale ? S.kid : 0;
      var dot = v.dots || fresh < T.kidQuiet;
      g.fillStyle = v.tone === 'blue' ? T.kidOnBlue : T.kidColor;
      if (reduce) {
        if (inn && now - S.lastBar >= T.barEvery) { S.lastBar = now; S.meter.unshift(dot ? T.dotH : T.barMin + (T.barMax - T.barMin) * Math.min(1, fresh)); if (S.meter.length > 18) S.meter.pop(); }
        if (!inn) S.meter = [];
        for (var m = 0; m < S.meter.length; m++) { g.globalAlpha = 1 - m / 22; bar(g, 8 + m * 10, cy, S.meter[m]); }
        g.globalAlpha = 1;
        S.drawn.bars = S.meter.length;
      } else {
        if (inn && !dot && now - S.lastBar >= T.barEvery) { S.lastBar = now; S.bars.push({ t0: now, dur: T.barTravel, h: T.barMin + (T.barMax - T.barMin) * Math.min(1, fresh), dot: false }); }
        if (inn && dot && now - S.lastDot >= T.dotEvery) { S.lastDot = now; S.bars.push({ t0: now, dur: T.dotTravel, h: T.dotH, dot: true }); }
        var trav = travelOf(), keep = [];
        for (var j = 0; j < S.bars.length; j++) {
          var b = S.bars[j], x = barX(b, now), p = 1 - x / trav;
          var fx = b.fade ? (now - b.fade[1]) / T.arcFade : 0;
          if (fx >= 1) continue;
          if (x <= 0.5) { if (!b.dot) recv(now); continue; }
          keep.push(b);
          var al = (p < 0.12 ? p / 0.12 : p < 0.8 ? 1 : Math.max(0, 1 - (p - 0.8) / 0.2)) * (1 - fx);
          var sy = p > 0.8 ? 1 - (p - 0.8) / 0.2 * 0.8 : 1;
          g.globalAlpha = Math.max(0, Math.min(1, al));
          bar(g, x, cy, Math.max(b.dot ? T.dotH : 3, b.h * sy));
        }
        g.globalAlpha = 1;
        S.bars = keep;
        S.drawn.bars = keep.length;
      }
      if (out || inn || S.bars.length || S.arcVis > 0 || S.meter.length) S.raf = requestAnimationFrame(frame);
      else S.last = 0;
    };
    var api = {
      el: el,
      /** 换样子(voiceView 给的) */
      set: function (v) {
        var prev = S.view;
        S.view = v;
        if (!prev || prev.key !== v.key) {
          el.dataset.voice = v.key;
          el.dataset.tone = v.tone;
          bEl.textContent = v.big;
          icEl.innerHTML = VOICE_ICONS[v.icon] || '';
          bigEl.hidden = !v.big && !v.icon;
          smEl.textContent = v.small;
          smEl.hidden = !v.small;
          el.classList.toggle('vb-wait', v.wait);
          el.classList.toggle('vb-breathe', v.breathe);
          el.setAttribute('aria-label', v.big || v.small || '按住说话');
          voiceFace(av, v.face);
          if (v.shake) shake();
          var hadIn = prev && (prev.flow === 'in' || prev.flow === 'both'), hasIn = v.flow === 'in' || v.flow === 'both';
          // 松手:路上剩下的竖条加快走进头像;往上滑要取消:原地淡掉(没交给老师,不进头像)
          if (hadIn && !hasIn) {
            var now = performance.now(), drop = v.key === 'cancel';
            for (var i = 0; i < S.bars.length; i++) { var bb = S.bars[i]; if (bb.rush || bb.fade) continue; if (drop) bb.fade = [barX(bb, now), now]; else bb.rush = [barX(bb, now), now]; }
          }
        }
        kick();
      },
      /** 再晃一下(同一种提示又按了一次) */
      shake: shake,
      /** 点一下头(老师说完这一轮) */
      nod: function () { av.classList.remove('vb-nod'); void av.offsetWidth; av.classList.add('vb-nod'); setTimeout(function () { av.classList.remove('vb-nod'); }, 950); },
      /** 头像那一格放什么(页面的 .av) */
      avatar: function (node) { av.replaceChildren(node); },
      /** 镜像:'right' = 头像在右头,声音方向反过来 */
      side: function (s) { S.side = s === 'right' ? 'right' : 'left'; el.classList.toggle('vb-right', S.side === 'right'); kick(); },
      /** 老师的颜色(三道小弧、外圈) */
      color: function (c) { S.color = c; el.style.setProperty('--tc', c); },
      /** 孩子的音量(0–1),随时喂 */
      level: function (who, v) { if (who === 'kid') { S.kid = v; S.kidAt = performance.now(); kick(); } },
      /** 老师的音量从哪取:一个回 0–1 的函数(放嘴的那条链上的 RMS);每一帧问一次 */
      tutorSource: function (fn) { S.src = fn; },
      /** 探针、样张看:这一帧画了几道弧(各自的半径与深浅)、几根竖条 */
      drawn: function () { return { arcs: S.drawn.arcs.slice(), bars: S.drawn.bars, key: S.view ? S.view.key : '' }; },
    };
    el.vb = api;
    api.side(opts.side);
    api.color(S.color);
    return api;
  }
`;
