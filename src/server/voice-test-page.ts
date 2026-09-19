/**
 * `/voice-test`:按住说话的试验页(给家长 / 开发者在真机上试,不是孩子端)。
 * 同一个浏览器识别,换着策略按:松手怎么停、continuous、要不要旁边再开一路麦克风画真波形;
 * 每次按住的事件时间线当场列出来,也发到 /api/kid/voice-diag(where: 'test',带 cfg;照旧不带字与声音)。
 * 内联脚本里不写反斜杠、不写模板字符串(见 CLAUDE.md「坑」)。
 */
export const VOICE_TEST_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>按住说话 · 试验</title>
<style>
  :root { --ink:#1d2433; --dim:#6b7488; --line:#e3e7ef; --bg:#f6f7fa; --blue:#3b82e8; --ok:#2fa36b; --bad:#d9534f; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { margin:0; height:100%; background:var(--bg); color:var(--ink); font:16px/1.5 -apple-system,"PingFang SC",sans-serif; }
  body { display:flex; flex-direction:column; -webkit-user-select:none; user-select:none; }
  header { padding:14px 16px 6px; }
  h1 { margin:0; font-size:19px; }
  header small { color:var(--dim); }
  #cfg { display:flex; flex-wrap:wrap; gap:8px 18px; padding:8px 16px 12px; border-bottom:1px solid var(--line); }
  #cfg .g { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
  #cfg .g > b { font-size:13px; color:var(--dim); font-weight:500; margin-right:2px; }
  #cfg button { font:inherit; font-size:14px; padding:6px 12px; border-radius:16px; border:1px solid var(--line); background:#fff; color:var(--ink); }
  #cfg button.on { background:var(--blue); border-color:var(--blue); color:#fff; }
  #sum { padding:8px 16px; font-size:14px; color:var(--dim); border-bottom:1px solid var(--line); display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  #sum b { color:var(--ink); }
  #sum button { margin-left:auto; font:inherit; font-size:13px; padding:4px 10px; border-radius:12px; border:1px solid var(--line); background:#fff; color:var(--dim); }
  #log { flex:1; min-height:0; overflow:auto; padding:10px 16px; display:flex; flex-direction:column; gap:8px; -webkit-overflow-scrolling:touch; }
  .row { background:#fff; border:1px solid var(--line); border-left:4px solid var(--dim); border-radius:10px; padding:8px 12px; font-size:13px; }
  .row.ok { border-left-color:var(--ok); } .row.bad { border-left-color:var(--bad); }
  .row .hd { display:flex; gap:8px; align-items:baseline; font-size:14px; }
  .row .hd b { font-size:15px; } .row .hd small { color:var(--dim); margin-left:auto; }
  .row .tx { font-size:16px; margin:2px 0; }
  .row .ev { color:var(--dim); font-family:ui-monospace,Menlo,monospace; font-size:12px; word-break:break-word; }
  .row .ev em { font-style:normal; color:var(--bad); }
  #live { padding:10px 16px 0; min-height:64px; text-align:center; }
  #state { font-size:15px; color:var(--dim); }
  #text { font-size:20px; min-height:30px; }
  #wave { display:flex; align-items:center; justify-content:center; gap:3px; height:44px; }
  #wave i { width:4px; height:4px; border-radius:2px; background:var(--blue); opacity:.35; }
  #wave.on i { opacity:1; }
  #btn { margin:8px 16px calc(env(safe-area-inset-bottom) + 16px); height:72px; border-radius:36px; background:var(--blue); color:#fff; font-size:19px; display:flex; align-items:center; justify-content:center; touch-action:none; }
  #btn.down { background:#2f6fd6; transform:scale(.98); }
  #btn.tail { background:var(--dim); }
  #btn.off { background:var(--line); color:var(--dim); }
</style></head><body>
<header><h1>按住说话 · 试验</h1><small id="env"></small></header>
<div id="cfg">
  <div class="g" data-k="stop"><b>松手后</b><button data-v="now">立刻停</button><button data-v="settle">收尾再停</button><button data-v="natural">等它自己停</button></div>
  <div class="g" data-k="cont"><b>continuous</b><button data-v="0">关</button><button data-v="1">开</button></div>
  <div class="g" data-k="wave"><b>真波形(再开一路麦克风)</b><button data-v="0">关</button><button data-v="1">开</button></div>
  <div class="g" data-k="sr"><b>识别</b><button data-v="1">开</button><button data-v="0">关(只开麦克风)</button></div>
  <div class="g" data-k="hot"><b>麦克风常开</b><button data-v="0">关</button><button data-v="1">开</button></div>
  <div class="g" data-k="retry"><b>哑了自动重开</b><button data-v="0">关</button><button data-v="1">开</button></div>
  <div class="g" data-k="lang"><b>语言</b><button data-v="zh-CN">zh-CN</button><button data-v="cmn-Hans-CN">cmn-Hans-CN</button></div>
</div>
<div id="sum"></div>
<div id="log"></div>
<div id="live"><div id="wave"></div><div id="text"></div><div id="state">按住下面的按钮说一句,松手</div></div>
<div id="btn">按住说话</div>
<script>
(() => {
  const $ = (s) => document.querySelector(s);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const cfg = { stop: 'settle', cont: '0', wave: '1', lang: 'zh-CN', sr: '1', hot: '1', retry: '0' };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem('voice-test-cfg3') || '{}')); } catch {}
  const LABEL = { now: '立刻停', settle: '收尾', natural: '自己停' };
  const cfgName = (c) => (c.sr === '1' ? LABEL[c.stop] : '只开麦克风') + (c.hot === '1' ? ' · 常开' : '') + (c.retry === '1' ? ' · 重开' : '') + (c.cont === '1' ? ' · cont' : '') + (c.wave === '1' ? ' · 波形' : '') + (c.lang === 'zh-CN' ? '' : ' · ' + c.lang);
  const renderCfg = () => { for (const g of document.querySelectorAll('#cfg .g')) for (const b of g.querySelectorAll('button')) b.classList.toggle('on', cfg[g.dataset.k] === b.dataset.v); };
  $('#cfg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || cur) return; cfg[b.parentElement.dataset.k] = b.dataset.v; try { localStorage.setItem('voice-test-cfg3', JSON.stringify(cfg)); } catch {} renderCfg(); renderSum(); });
  renderCfg();
  $('#env').textContent = (SR ? '有识别' : '这个浏览器没有语音识别') + ' · ' + (navigator.standalone ? '主屏幕图标' : '浏览器里') + ' · ' + (location.protocol === 'https:' ? 'https' : '不是 https');

  // 波形:25 根条。真波形读 AnalyserNode;没开就只按状态亮暗
  const bars = []; for (let i = 0; i < 25; i++) { const b = document.createElement('i'); $('#wave').append(b); bars.push(b); }
  const levels = new Array(25).fill(0);
  const paint = () => { for (let i = 0; i < 25; i++) bars[i].style.height = Math.round(4 + levels[i] * 40) + 'px'; };

  const tally = {};
  const renderSum = () => {
    const parts = Object.keys(tally).map((k) => k + ' <b>' + tally[k].ok + '/' + tally[k].n + '</b>');
    $('#sum').innerHTML = (parts.length ? parts.join(' · ') : '还没试。现在的策略:<b>' + cfgName(cfg) + '</b>') + '<button id="clr">清空</button>';
    $('#clr').onclick = () => { for (const k of Object.keys(tally)) delete tally[k]; $('#log').replaceChildren(); renderSum(); };
  };
  renderSum();

  let cur = null; // 进行中的一次
  const setState = (s) => { $('#state').textContent = s; };

  const finish = (a) => {
    if (a.finished) return; a.finished = true;
    clearInterval(a.clock);
    if (a.cfg.hot === '1' && a.stream) a.stream = null; // 常开:这一路留着
    dropStream(a);
    levels.fill(0); paint(); $('#wave').classList.remove('on');
    const ok = a.cfg.sr === '1' ? a.text.trim().length > 0 : a.peak > 0.02, name = cfgName(a.cfg);
    tally[name] = tally[name] || { ok: 0, n: 0 }; tally[name].n++; if (ok) tally[name].ok++;
    const row = document.createElement('div'); row.className = 'row ' + (ok ? 'ok' : 'bad');
    const hd = document.createElement('div'); hd.className = 'hd';
    const b = document.createElement('b'); b.textContent = a.cfg.sr === '1' ? (ok ? '认出来了' : '空的') : (ok ? '有声音' : '没声音'); hd.append(b, document.createTextNode(name));
    const sm = document.createElement('small'); sm.textContent = '按了 ' + (a.heldMs / 1000).toFixed(1) + ' 秒' + (a.peak >= 0 ? ' · 音量峰值 ' + Math.round(a.peak * 100) : ''); hd.append(sm);
    const tx = document.createElement('div'); tx.className = 'tx'; tx.textContent = a.text;
    const ev = document.createElement('div'); ev.className = 'ev';
    for (const e of a.ev) { const s = document.createElement(e[0] === 'error' || e[0] === 'throw' || e[0] === 'gum-mute' || e[0] === 'gum-fail' || e[0] === 'dead' || e[0] === 'retry' ? 'em' : 'span'); s.textContent = e[0] + '@' + e[1] + (e[2] !== undefined ? '(' + e[2] + ')' : '') + ' '; ev.append(s); }
    row.append(hd); if (ok) row.append(tx); row.append(ev);
    $('#log').prepend(row); renderSum();
    $('#btn').className = ''; $('#btn').textContent = '按住说话';
    setState(ok ? '这次成了。再来一句' : '这次是空的。再来一句');
    try { fetch('/api/kid/voice-diag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ where: 'test', cfg: a.cfg, heldMs: a.heldMs, peak: a.peak, standalone: Boolean(navigator.standalone), ua: navigator.userAgent, ev: a.ev }), keepalive: true }).catch(() => {}); } catch {}
    cur = null;
  };

  // 「麦克风常开」时留着的那一路:不 stop,下次按住直接用
  let hotStream = null;
  const dropStream = (a) => {
    cancelAnimationFrame(a.raf);
    if (a.stream) { for (const t of a.stream.getTracks()) t.stop(); if (a.stream === hotStream) hotStream = null; a.stream = null; }
    if (a.ac) { try { a.ac.close(); } catch {} a.ac = null; }
  };
  /** then:麦克风到手(或拿不到)之后再做的事——「常开」时识别排在它后面起 */
  const startWave = (a, then) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { a.mark('gum-fail', 'no-api'); if (then) then(); return; }
    const round = a.round;
    const hot = a.cfg.hot === '1' && hotStream && hotStream.getAudioTracks()[0] && hotStream.getAudioTracks()[0].readyState === 'live' && !hotStream.getAudioTracks()[0].muted;
    (hot ? Promise.resolve(hotStream) : navigator.mediaDevices.getUserMedia({ audio: true })).then((stream) => {
      if (a.finished || round !== a.round) { if (stream !== hotStream) for (const t of stream.getTracks()) t.stop(); return; }
      a.stream = stream; a.mark(hot ? 'gum-hot' : 'gum'); if (a.cfg.hot === '1') hotStream = stream;
      const tr = stream.getAudioTracks()[0];
      if (tr && !hot) { tr.addEventListener('mute', () => { if (cur) cur.mark('gum-mute'); }); tr.addEventListener('unmute', () => { if (cur) cur.mark('gum-unmute'); }); tr.addEventListener('ended', () => { if (cur) cur.mark('gum-ended'); }); }
      if (tr && tr.muted) a.mark('gum-muted-at-start');
      const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC(); a.ac = ac;
      const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize); if (a.peak < 0) a.peak = 0;
      const t1 = Date.now(); let maxAbs = 0, checked = false;
      const loop = () => {
        an.getFloatTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) { const v = buf[i]; sum += v * v; if (v > maxAbs) maxAbs = v; else if (-v > maxAbs) maxAbs = -v; }
        const rms = Math.min(1, Math.sqrt(sum / buf.length) * 4);
        if (rms > a.peak) a.peak = rms;
        levels.shift(); levels.push(rms); paint();
        // 开了 600ms 采样还是纯 0:这一路是哑的(不是安静——安静也有底噪)
        if (!checked && Date.now() - t1 > 600) {
          checked = true; a.mark(maxAbs === 0 ? 'dead' : 'alive', ac.state);
          if (maxAbs === 0 && a.cfg.retry === '1' && !a.released && a.round < 3) { restart(a); return; }
        }
        a.raf = requestAnimationFrame(loop);
      };
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      loop();
      if (then) then();
    }).catch((e) => { a.mark('gum-fail', String(e && e.name)); if (then) then(); });
  };

  const startSR = (a) => {
    const round = a.round;
    try {
      const r = a.r = new SR(); r.lang = a.cfg.lang; r.interimResults = true; r.continuous = a.cfg.cont === '1'; r.maxAlternatives = 1;
      for (const k of ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend', 'nomatch']) r.addEventListener(k, () => a.mark(k));
      r.addEventListener('audiostart', () => { if (!a.released) setState('话筒开了,说吧'); $('#wave').classList.add('on'); });
      r.onresult = (e) => { let s = ''; for (const x of e.results) s += x[0].transcript; a.text = s; a.lastAt = Date.now(); a.mark('result', s.length); $('#text').textContent = s; };
      r.onerror = (e) => a.mark('error', String(e && e.error));
      r.onend = () => { if (round !== a.round) return; a.mark('end', a.text.length); finish(a); };
      r.start(); a.mark('start()');
      return true;
    } catch (e) { a.mark('throw', String(e && e.name)); finish(a); return false; }
  };
  /** 哑了:两路都拆掉,歇 300ms 整个重来(最多 3 回) */
  const restart = (a) => {
    a.round++; a.mark('retry', a.round);
    setState('话筒是哑的,重开第 ' + a.round + ' 次…');
    if (a.r) { try { a.r.onend = null; a.r.abort(); } catch {} a.r = null; }
    dropStream(a);
    setTimeout(() => { if (a.finished || a.released) { if (a.released) finish(a); return; } if (a.cfg.sr === '1' && !startSR(a)) return; startWave(a); }, 300);
  };

  const begin = () => {
    if (cur || (!SR && cfg.sr === '1')) return;
    const t0 = Date.now();
    const a = cur = { cfg: Object.assign({}, cfg), ev: [], text: '', lastAt: 0, peak: -1, heldMs: 0, round: 0, released: false, finished: false, stream: null, ac: null, raf: 0, clock: 0, r: null };
    a.mark = (k, v) => a.ev.push(v === undefined ? [k, Date.now() - t0] : [k, Date.now() - t0, v]);
    $('#text').textContent = ''; $('#btn').className = 'down'; $('#btn').textContent = '松手'; setState(a.cfg.sr === '1' ? '等一下…话筒还没开' : '只开麦克风,说吧');
    a.clock = setInterval(() => { if (!a.released) $('#btn').textContent = '松手 · ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒'; }, 100);
    // 常开:先麦克风、后识别(第一次按也是)
    if (a.cfg.sr === '1' && a.cfg.hot === '1') { startWave(a, () => { if (!a.finished && !a.released) startSR(a); else if (!a.finished) finish(a); }); return; }
    if (a.cfg.sr === '1' && !startSR(a)) return;
    if (a.cfg.wave === '1' || a.cfg.sr === '0') startWave(a);
  };

  const stopNow = (a) => { try { a.mark('stop()'); a.r.stop(); } catch {} };
  const btn = $('#btn');
  
  let downAt = 0;
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); if (cur) return; downAt = Date.now(); try { btn.setPointerCapture(e.pointerId); } catch {} begin(); });
  const up = () => {
    const a = cur; if (!a || a.released) return;
    a.released = true; a.heldMs = Date.now() - downAt; a.mark('release');
    btn.className = 'tail'; btn.textContent = '正在听清…'; setState('松手了,等识别停下');
    if (a.cfg.sr === '0' || !a.r) { finish(a); return; }
    if (a.cfg.stop === 'now') { stopNow(a); return; }
    const t1 = Date.now(), cap = a.cfg.stop === 'natural' ? 8000 : 2500;
    const tick = () => {
      if (a.finished) return;
      if ((a.cfg.stop === 'settle' && a.text && Date.now() - a.lastAt > 500) || Date.now() - t1 > cap) { stopNow(a); return; }
      setTimeout(tick, 100);
    };
    tick();
  };
  btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  // 预热:「常开」时一进页面就把麦克风开好(冷开要 1 秒多,第一句的第一个字就丢在这里)
  const prewarm = () => { if (hotStream && (hotStream.getAudioTracks()[0].readyState !== 'live' || hotStream.getAudioTracks()[0].muted)) { for (const t of hotStream.getTracks()) t.stop(); hotStream = null; }
    if (cfg.hot !== '1' || hotStream || cur || !navigator.mediaDevices) return; navigator.mediaDevices.getUserMedia({ audio: true }).then((st) => { if (hotStream || cfg.hot !== '1') { for (const t of st.getTracks()) t.stop(); return; } hotStream = st; setState('麦克风已经开好了,按住说'); }).catch(() => {}); };
  prewarm();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) prewarm(); });
  // 服务重起过 → 没在按的时候自己重载
  let bootId = null;
  setInterval(() => { fetch('/api/health', { cache: 'no-store' }).then((r) => { const b = r.headers.get('x-cotutor-boot'); if (!b) return; if (!bootId) bootId = b; else if (b !== bootId && !cur) location.reload(); }).catch(() => {}); }, 3000);
})();
</script></body></html>`;
