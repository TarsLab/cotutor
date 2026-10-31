/**
 * 家长端「记录」(/parent):七天日期条、一天一条时间线(话题、听写,最新的在上)、「这一天老师跟你说的」与记账;点一件就是它的录像。
 * 2026-10-28 之前是孩子端页面(kid-page.ts)的家长模式,10-14 改成录像以后只剩清单与开录像,拆成这一页:孩子端页面里不再有家长的分支。
 * 时间线上那颗是孩子端首页那颗按钮原样(cards/tutor/card.css 的 .c-tutor .bt,页面装 /kid/theme.css),只画不点,点的是外面那一整块。
 * 录像:整页盖一层(#rl),上半是孩子的屏幕——孩子端页面以 /reel 开在 iframe 里,下半是录像栏(reel-dock.ts),同听写的录像外壳;
 * iframe 里放的声音用这一页的 Audio(window.__cotutorAudio),家长点那一件时在手势里解锁。退出回清单。
 * 心跳 5 秒读一次清单(录像开着时不读);服务换了代码空下来自己重载,开着录像就带 ?tutor=&date=&thread= 回到那一件。
 * 铁律照孩子端:后端不通只是 logo 灰、「老师们休息中」,不报错。
 * 用 String.raw:脚本里的反斜杠照原样;不写反引号与美元加花括号。
 */
import { faviconLinks } from '../shared/favicon.ts';
import { NEUTRAL_COLOR } from '../shared/tutor-color.ts';
import { BRAND_CSS, BRAND_FOOTER, BRAND_JS, titleLogo } from '../shared/brand.ts';
import { KID_LOG_JS } from '../kid/kid-log.ts';
import { pageDomJs } from '../shared/page-dom.ts';
import { REEL_DOCK_CSS, REEL_DOCK_HTML, REEL_DOCK_JS } from '../shared/reel-dock.ts';
import { BACK_TINT_JS } from '../kid/tutor-face.ts';

/** 家长端「记录」页:标题(已转义)填进去 */
export function parentPage(title: string): string {
  const shown = `${title} · 家长`;
  return String.raw`<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="${shown}">
<meta name="theme-color" content="#faf9f4">
<link rel="manifest" href="/parent/manifest.webmanifest">
${faviconLinks()}
<link rel="stylesheet" href="/kid/theme.css">
<title>${shown}</title>
<style>
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html, body { height:100%; }
  body { margin:0; background:var(--paper); color:var(--ink); font:18px/1.5 -apple-system,"PingFang SC","Helvetica Neue",sans-serif; -webkit-user-select:none; user-select:none; overscroll-behavior:none; }
  button { font:inherit; color:inherit; background:none; border:0; padding:0; cursor:pointer; }
  button:disabled { opacity:.35; }
  button:disabled:active { transform:none; filter:none; }
  #home { min-height:100%; padding:calc(env(safe-area-inset-top) + 16px) 20px calc(env(safe-area-inset-bottom) + 40px); max-width:960px; margin:0 auto; display:flex; flex-direction:column; gap:18px; overflow-x:clip; }
  h1 { font-size:20px; font-weight:600; margin:0; color:var(--dim); }
  /* 标题前那颗 logo(brand.ts titleLogo):彩色,打开时画出来、悬停点一下头 */
  #ttl { display:flex; align-items:center; gap:10px; }
  #ct-mark { display:flex; color:var(--dim); -webkit-tap-highlight-color:transparent; }
  #ct-mark .ct-go, #ct-mark .ct-gi { transition:transform .45s cubic-bezier(.3,1.6,.5,1); }
${BRAND_CSS}
  /* 老师头像(同孩子端):学科色的 C 形开口环,里面一个白底圆放图或字 */
  .av { position:relative; display:grid; place-items:center; font-weight:700; flex:0 0 auto; }
  .av .ring { position:absolute; left:0; top:0; width:100%; height:100%; overflow:visible; pointer-events:none; }
  .av .ring circle { fill:none; stroke:currentColor; stroke-width:7; stroke-linecap:round; stroke-dasharray:221.17 55.29; transform-origin:50px 50px; transform:rotate(36deg); transition:transform .45s cubic-bezier(.3,1.6,.5,1); }
  .av .face { position:absolute; left:15%; top:15%; width:70%; height:70%; border-radius:50%; background:var(--card); overflow:hidden; display:grid; place-items:center; font-size:.76em; line-height:1; }
  .av img { width:100%; height:100%; object-fit:cover; }
  @media (prefers-reduced-motion:reduce) { .av .ring circle, .av .face { animation:none !important; transition:none; } }
  #toast { position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom) + 24px); transform:translateX(-50%); max-width:min(560px,calc(100% - 32px)); padding:12px 18px; border-radius:16px; background:#2b2b2bee; color:#fff; font-size:15px; line-height:1.5; white-space:pre-line; z-index:50; display:none; }
  #toast.on { display:block; }
  /* 小课堂那颗按钮上的视频截帧 */
  .lc-still { width:100%; height:100%; }
  .lc-still img { width:100%; height:100%; display:block; object-fit:contain; }
  /* 后端不通:logo 与时间线上的头像灰着,下面一行「老师们休息中」 */
  #rest { display:none; text-align:center; color:var(--dim); font-size:16px; padding:12px 0; }
  body.offline #rest { display:block; }
  body.offline .c-tutor { pointer-events:none; }
  body.offline .c-tutor .av { filter:grayscale(1); opacity:.4; }
  body.offline .c-tutor .av .ring circle { transform:rotate(126deg); }
  body.offline #ct-mark { filter:grayscale(1); opacity:.4; }
  body.offline #ct-mark .ct-go, body.offline #ct-mark .ct-gi { transform:rotate(90deg); }
  body.offline .c-tutor .bt { color:var(--dim); }
  body.offline .c-tutor .bt-new { background:var(--grey); }
  .ptabs { display:flex; padding:3px; border-radius:12px; background:#e9e6de; }
  .ptabs a { flex:1; height:36px; border-radius:9px; font-size:15px; color:var(--dim); display:flex; align-items:center; justify-content:center; text-decoration:none; }
  .ptabs a.on { background:#fff; color:var(--ink); font-weight:600; box-shadow:0 1px 2px rgba(0,0,0,.08); }
  /* 顶上:名字与两个标签(窄屏各一行,宽屏并成一行);记账在「这一天」那块 */
  #phead { display:flex; flex-wrap:wrap; align-items:center; gap:12px 20px; }
  #pnokey { display:block; padding:12px 16px; border-radius:14px; background:#fff3e8; color:#b4531f; font-size:15px; text-decoration:none; }
  #pnokey[hidden] { display:none; }
  #phead #ttl { flex:1 0 100%; }
  #phead .ptabs { flex:1 0 100%; }
  /* 七天日期条:每天下面学科色的点 = 那天有动静的老师 */
  #pweek { display:flex; align-items:center; gap:2px; padding:4px; border-radius:16px; background:var(--card); border:1px solid var(--line); }
  #pweek .nv { flex:none; width:32px; height:54px; font-size:20px; color:var(--dim); }
  #pweek .dy { flex:1; min-width:0; height:54px; border-radius:11px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; }
  #pweek .dy small { font-size:11px; line-height:1.2; color:var(--dim); }
  #pweek .dy b { font-size:15px; line-height:1.2; font-weight:600; }
  #pweek .dy.on { background:var(--ink); color:#fff; }
  #pweek .dy.on small { color:#d9d5cc; }
  #pweek .wd { display:flex; gap:2px; height:5px; }
  #pweek .wd i { width:5px; height:5px; border-radius:50%; }
  #pweek .dy.on .wd i { box-shadow:0 0 0 1px #fff; }
  .chip { font-size:12px; line-height:1.5; padding:2px 8px; border-radius:999px; background:#f3efe6; color:var(--dim); display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
  .chip.live { background:#fff4e8; color:#a0480f; }
  .chip.live i { width:6px; height:6px; border-radius:50%; background:#e8743b; }
  .chip.ask { background:#eef3fb; color:#2f5ba8; }
  .stars { display:flex; gap:0; }
  .stars .st { font-size:20px; line-height:1; padding:6px 3px; color:var(--line); cursor:pointer; }
  .stars .st.on { color:#e0a520; }
  /* 一天一条时间线:左边几点、用了多久,竖线上的点是老师的学科色,两件事之间写隔了多久 */
  #ptl { display:flex; flex-direction:column; min-width:0; }
  #ptl .hd { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; padding:0 0 12px 76px; }
  #ptl .hd b { font-size:17px; }
  #ptl .hd small { font-size:13px; color:var(--dim); }
  #ptl .none { padding:40px 0 40px 76px; color:var(--dim); font-size:15px; }
  .pev { display:grid; grid-template-columns:62px minmax(0,1fr); column-gap:14px; }
  .pev .pv-tm { display:flex; flex-direction:column; align-items:flex-end; padding-top:2px; font-size:15px; font-weight:600; font-variant-numeric:tabular-nums; line-height:1.3; }
  .pev .pv-tm small { font-size:12px; font-weight:400; color:var(--dim); }
  .pev .pv-rail { position:relative; min-width:0; padding:0 0 18px 22px; border-left:2px solid var(--line); }
  .pev:last-child .pv-rail { border-left-color:transparent; }
  .pev .pv-rail::before { content:""; position:absolute; left:-8px; top:4px; width:14px; height:14px; border-radius:50%; background:var(--c); border:3px solid var(--paper); }
  .pev .pv-who { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--dim); margin-bottom:8px; }
  .pev .pv-who .av { width:22px; height:22px; font-size:10px; }
  .pev .pv-at { display:none; }
  /* 手机:左边不留时刻那一栏(卡会挤窄、气泡里的字折行),时刻写进老师那一行,竖线靠左 */
  @media (max-width:600px) {
    .pev { grid-template-columns:minmax(0,1fr); }
    .pev .pv-tm { display:none; }
    .pev .pv-at { display:inline; font-weight:600; color:var(--ink); font-variant-numeric:tabular-nums; }
    .pev .pv-at small { font-weight:400; color:var(--dim); margin-left:4px; }
    .pev .pv-rail { margin-left:6px; padding-left:16px; }
    .pgap { margin-left:6px !important; padding-left:16px !important; }
    #ptl .hd, #ptl .none { padding-left:0; }
  }
  .pgap { font-size:12px; color:var(--dim); padding:0 0 14px 22px; margin-left:76px; border-left:2px dashed var(--line); }
  /* 一件事:上半是孩子端那颗(.c-tutor .bt,cards/tutor/card.css,原样),整块点了进录像;下半一条家长才有的 */
  .pent { border-radius:22px; background:var(--card); border:1px solid var(--line); overflow:hidden; }
  .pent > .kid { display:block; width:100%; padding:10px 10px 0; text-align:left; text-decoration:none; color:var(--ink); }
  .pent > .kid .bt { pointer-events:none; }
  .pent .pf { display:flex; align-items:center; gap:8px 10px; flex-wrap:wrap; padding:6px 14px 8px; font-size:13px; color:var(--dim); min-height:44px; }
  .pent .pf .sp { flex:1; }
  .pent .pf .miss { color:#b3541e; }
  .pent .pf .del { font-size:13px; color:var(--dim); padding:8px 6px; border-radius:8px; }
  .pent .pf .del.arm { color:#fff; background:#b3541e; padding:6px 10px; }
  .pent .pf .del:disabled { opacity:.35; }
  /* 听写的格子画孩子写的:一字一格,看了答案的是橙色;词与词之间空一点 */
  .pent .bt-x-dictation .dg { flex-wrap:wrap; }
  .pent .bt-x-dictation .dg i { position:relative; flex:0 0 52px; }
  .pent .bt-x-dictation.en .dg i { flex-basis:104px; }
  .pent .bt-x-dictation .dg i.ws { margin-left:8px; }
  .pent .bt-x-dictation .dg svg { position:absolute; inset:0; width:100%; height:100%; }
  .pent .bt-x-dictation .dg path { fill:none; stroke:var(--ink); stroke-width:44; stroke-linecap:round; stroke-linejoin:round; }
  .pent .bt-x-dictation.en .dg path { stroke-width:30; }
  .pent .bt-x-dictation .dg i.rv path { stroke:#c95a22; }
  .pent .bt-x-dictation .dg .more { flex:none; align-self:center; font-style:normal; color:var(--dim); font-size:15px; }
  /* 这一天老师跟你说的:只放卡上没有的;宽屏在右栏,窄屏接在时间线后面 */
  #pday { display:flex; flex-direction:column; gap:20px; padding:20px 22px; border-radius:18px; background:var(--card); border:1px solid var(--line); }
  #pday > b { font-size:18px; }
  #pday .rs { display:flex; flex-direction:column; gap:10px; }
  #pday .rs h3 { margin:0; font-size:13px; font-weight:500; color:var(--dim); }
  #pday .nt { display:grid; grid-template-columns:22px minmax(0,1fr); column-gap:10px; row-gap:2px; }
  #pday .nt .av { width:22px; height:22px; font-size:10px; }
  #pday .nt small { grid-column:2; font-size:12px; color:var(--dim); }
  #pday .nt p { grid-column:2; margin:0; font-size:15px; line-height:1.6; white-space:pre-line; }
  #pday .mem { display:flex; gap:8px; align-items:flex-start; font-size:14px; line-height:1.55; background:#eef6ef; color:#33402f; border-radius:10px; padding:8px 12px; }
  #pday .mem small { flex:none; color:#6b7a66; font-size:12px; padding-top:2px; }
  #pday .mem > span { flex:1; min-width:0; }
  #pday .mem .qt { display:block; padding-top:2px; }
  #pday .mem .undo { flex:none; font-size:12px; color:#6b7a66; padding:2px 8px; border-radius:6px; }
  #pday .mem .undo.arm { color:#fff; background:#b3541e; }
  #pday .mem .undo:disabled { opacity:.35; }
  #pday .rw { display:flex; gap:8px; flex-wrap:wrap; }
  #pday .rw span { display:inline-flex; align-items:center; height:40px; padding:0 12px; border-radius:12px; background:var(--tint-sand-bg); border:1px solid var(--tint-sand-line); font-size:18px; font-family:"Kaiti SC","STKaiti",serif; }
  #pday .dia { border-top:1px solid var(--line); padding-top:16px; }
  #pday .dia > div { display:flex; align-items:center; gap:12px; }
  #pday .dia span { flex:1; font-size:14px; line-height:1.5; }
  #pday .book { flex:none; height:40px; padding:0 18px; border-radius:12px; background:var(--ink); color:#fff; font-size:15px; font-weight:600; }
  #pday .book.arm { background:#b3541e; }
  #pday .quiet { color:var(--dim); font-size:14px; }
  #pcols { display:flex; flex-direction:column; gap:20px; }
  @media (min-width:900px) and (orientation:landscape) {
    #home { max-width:1040px; padding:calc(env(safe-area-inset-top) + 40px) 48px 40px; gap:24px; }
    #home h1 { font-size:22px; }
  }
  @media (min-width:1000px) {
    #home { max-width:1180px; }
    #phead #ttl { flex:0 0 auto; }
    #phead .ptabs { flex:0 0 260px; }
    #pcols { display:grid; grid-template-columns:minmax(0,640px) minmax(0,1fr); gap:20px; align-items:start; }
    #pday { position:sticky; top:16px; max-height:calc(100vh - 32px); overflow:auto; }
  }
  /* 录像:整页盖一层,上半孩子的屏幕、下半录像栏(样式在 reel-dock.ts,话题与听写共用);开着时整页深底 */
  #rl { position:fixed; inset:0; z-index:10; display:flex; flex-direction:column; background:var(--paper); }
  #rl[hidden] { display:none; }
  html.rl-dark #rl { background:#1c1c1c; }
${REEL_DOCK_CSS}
  /* 平板横屏:录像栏不铺满,和孩子端老师页的输入条一样宽(写在录像栏的样式后面才压得住它的内边距) */
  @media (min-width:900px) and (orientation:landscape) { #reel { width:100%; max-width:1040px; margin:0 auto; padding-left:32px; padding-right:32px; } }
</style>
<div id="home">
  <div id="phead">
    <div id="ttl"><span id="ct-mark" class="ct-draw ct-hover">${titleLogo(true)}</span><h1 id="title">${title}</h1></div>
    <nav id="ptabs" class="ptabs"><a href="/parent/home">首页</a><a class="on" href="/parent">记录</a></nav>
  </div>
  <a id="pnokey" href="/parent/home" hidden>孩子那边现在打不开:还没配百炼的 key。去「首页」配好就能用 ›</a>
  <div id="pweek"></div>
  <div id="pcols"><div id="ptl"></div><aside id="pday" aria-label="这一天老师跟你说的"></aside></div>
  <p id="rest">老师们休息中</p>
  ${BRAND_FOOTER}
</div>
<div id="toast"></div>
<section id="rl" hidden>
  <div id="rl-screen" hidden><iframe id="rl-frame" title="孩子的屏幕" allow="autoplay"></iframe></div>
  ${REEL_DOCK_HTML}
</section>
<script>
// 出错记进孩子端的流水(kid-log.ts):mode 不是 kid,只记出错,不报打开、不登记设备
${KID_LOG_JS}
(() => {
${BRAND_JS}
${BACK_TINT_JS}
  /** reel = 开着的录像 {tutor, thread, date};pdate = 清单的日期(null = 今天);mods = 听写的记录 */
  const S = { home: null, pdate: null, mods: null, modAt: 0, offline: false, reel: null };
  kidLog.start({ page: 'parent', mode: 'parent', ctx: () => ({ tutor: S.reel ? S.reel.tutor.name : null, thread: S.reel ? S.reel.thread : null }) });
  // $ / h / toast / api(page-dom.ts,几页共用)
${pageDomJs(4000)}
  // 服务重起过(启动号变了)→ 记下,空下来自己重载(见 staleReload)
  let bootId = null, stale = false;
  apiSeen = (r) => {
    const boot = r.headers.get('x-cotutor-boot');
    if (boot) { if (!bootId) bootId = boot; else if (boot !== bootId) stale = true; }
  };
  const debug = new URLSearchParams(location.search);
  const SVG = (paths, size, sw) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  /** 孩子端那颗按钮上的图标(同 kid-page 的 ICON) */
  const ICON = {
    play: SVG('<path d="M8 5l11 7-11 7z" fill="currentColor"></path>', 16, 1.5),
    again: SVG('<path d="M4 12a8 8 0 1 0 2.4-5.7"></path><path d="M4 4v4.5h4.5"></path>', 20, 2),
    start: SVG('<path d="M8 5l11 7-11 7z" fill="currentColor"></path>', 18, 1.5),
    spark: SVG('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"></path><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"></path>', 24, 1.8),
  };
  // 学科色:服务端定好随老师下发(t.color,src/ui/shared/tutor-color.ts);不归哪位老师的块用中性的灰
  const colorOf = (t) => (t && t.color) || ${JSON.stringify(NEUTRAL_COLOR)};
  const AV_RING = '<svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"></circle></svg>';
  const avatarEl = (t) => {
    const el = h('span', { class: 'av', style: 'color:' + colorOf(t) });
    el.innerHTML = AV_RING;
    const face = h('span', { class: 'face' });
    if (t.avatar && /\.(png|jpe?g|webp|svg)$/i.test(t.avatar)) face.append(h('img', { src: '/api/kid/avatar/' + t.name, alt: '' }));
    else face.textContent = t.avatar || (t.subject || t.display || '?').slice(0, 1);
    el.append(face);
    return el;
  };
  // 小课堂那颗按钮:课的末帧(视频课是看到的那一刻)+ 一颗播放
  const lcLen = (ms) => { const s = Math.floor(ms / 1000); return s >= 60 ? Math.floor(s / 60) + ' 分' + (s % 60 ? ' ' + (s % 60) + ' 秒' : '') : s + ' 秒'; };
  const lcBundleUrl = (bundle, video) => (video ? '/api/kid/lectures/' : '/api/bundles/') + encodeURIComponent(bundle) + '/';
  const lcVideoStill = (bundle, end) => {
    const v = h('video', { class: 'lc-still', src: lcBundleUrl(bundle, true) + 'video.mp4#t=' + Math.max(0, (end - 200) / 1000).toFixed(2), playsinline: '', preload: 'metadata' });
    v.muted = true;
    return v;
  };
  const lecturePic = (b) => {
    const box = h('span', { class: 'lp' });
    if (b.video) { if (b.ms) box.append(lcVideoStill(b.bundle, b.ms)); }
    else box.append(h('img', { alt: '', src: lcBundleUrl(b.bundle) + 'frame.svg?svg=end', on: { error: () => box.classList.add('nopic') } }));
    box.append(h('span', { class: 'pl', html: ICON.play }));
    return box;
  };
  const dateLabel = (date, today) => {
    if (date === today) return '今天';
    const [y, mo, da] = date.split('-').map(Number);
    const t = today.split('-').map(Number);
    const diff = Math.round((new Date(t[0], t[1] - 1, t[2]) - new Date(y, mo - 1, da)) / 86400000);
    return diff === 1 ? '昨天' : mo + ' 月 ' + da + ' 日';
  };

  // ---- 清单 ----
  const loadHome = async () => {
    try { S.home = await api('GET', '/api/overview/' + (S.pdate || 'today')); setOffline(false); renderOverview(); }
    catch { setOffline(true); }
  };
  const setOffline = (off) => {
    if (S.offline === off) return;
    S.offline = off;
    // 断了多久记一笔流水(kid-log.ts):断着发不出去,通了再报
    kidLog.offline(off);
    document.body.classList.toggle('offline', off);
    if (off && S.reel) closeReel();
  };
  const shiftDate = (date, n) => { const [y, m, d] = date.split('-').map(Number); const t = new Date(y, m - 1, d + n); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
  // 听写(/api/dictation)的记录:模块自己的接口,15 秒读一次;读回来重画清单。口语课不单列:那一课是英语老师的一个话题
  const modFetch = () => {
    if (S.modAt && Date.now() - S.modAt < 15000) return;
    S.modAt = Date.now();
    api('GET', '/api/dictation').catch(() => null).then((d) => {
      S.mods = { dictation: (d && d.sessions) || [] };
      if (S.home && !S.reel) renderOverview();
    });
  };
  const hhmm = (iso) => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const ymd = (iso) => { const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  /** 听写挂在哪位老师下:记了老师的照记的,没记的给常驻它的老师,都没有单列一块(':听写') */
  const modOwner = (H, kind, tutor) => (tutor && H.tutors.some((t) => t.name === tutor) ? tutor : (H.tutors.find((t) => (t.extras || []).includes(kind)) || {}).name || ':听写');
  const WEEKDAY = '日一二三四五六';
  /** 话题的 at → 毫秒:索引里是本地时间到分钟(YYYY-MM-DDTHH:MM,不带时区);带时区的(mock)照 ISO 读 */
  const atMs = (at) => { const x = String(at || ''); if (/(Z|[+-][0-9]{2}:?[0-9]{2})$/.test(x)) return Date.parse(x); const p = x.slice(0, 16).split(/[-T:]/).map(Number); return p.length === 5 && p.every((v) => Number.isFinite(v)) ? new Date(p[0], p[1] - 1, p[2], p[3], p[4]).getTime() : NaN; };
  const mins = (ms) => Math.max(1, Math.round(ms / 60000)) + ' 分钟';
  /** 听写一格的笔迹:汉字 1024 尺 y 朝上,英文 2048 × 512 y 朝下 */
  const inkSvg = (d, en) => '<svg viewBox="' + (en ? '0 -192 2048 896' : '0 0 1024 1024') + '" aria-hidden="true">' + (d ? (en ? '<path d="' + d + '"></path>' : '<g transform="scale(1,-1) translate(0,-900)"><path d="' + d + '"></path></g>') : '') + '</svg>';
  /** 孩子端那颗按钮(cards/tutor/card.css 的 .bt,原样),这里只画不点:点的是外面那一整块 */
  const kidLook = (t, th) => {
    const k = th.start ? th.start.kind : 'new';
    if (k === 'new') return h('span', { class: 'bt bt-new', style: '--sc:' + colorOf(t) }, h('span', { class: 'fc', 'aria-hidden': 'true' }, tutorInitial(t)), h('span', { class: 'lb' }, h('span', { class: 'btx' }, '新话题'), h('small', { class: 'ln' }, th.said ? '「' + th.said + '」' : '想问我什么?')), h('span', { class: 'bi', html: ICON.spark }));
    if (k === 'lecture' && th.lecture) { const L = th.lecture; return h('span', { class: 'bt bt-lecture' }, lecturePic({ bundle: L.bundle, video: L.video, ms: L.watchedMs }), h('span', { class: 'lm' }, h('small', { class: 'tg' }, '小课堂'), h('span', { class: 'btx' }, L.title || th.start.label), h('small', { class: 'ln' }, lcLen(L.watchedMs)))); }
    if (k === 'system') return h('span', { class: 'bt bt-start' }, h('span', { class: 'btx' }, th.title));
    return h('span', { class: 'bt bt-' + (k === 'continue' ? 'continue' : 'start') }, h('span', { class: 'bi', html: ICON[k === 'continue' ? 'again' : 'start'] }), h('span', { class: 'btx' }, th.start.label || th.title));
  };
  /** 宽屏:时间线与「这一天」并排;窄屏「这一天」接在后面 */
  const WIDE = window.matchMedia('(min-width:1000px)');
  WIDE.addEventListener('change', () => { if (S.home && !S.reel) renderOverview(); });
  const renderOverview = () => {
    const H = S.home;
    document.title = H.title + ' · 家长'; $('#title').textContent = H.title;
    $('#pnokey').hidden = H.ready !== false;
    // 有按钮正在「确定?」那一下(删、记账),这一轮心跳先不重画,免得把它抹掉
    if ($('#home .arm')) return;
    modFetch();
    const goTo = (d) => { if (d > H.today) d = H.today; S.pdate = d === H.today ? null : d; loadHome(); };
    const M = S.mods || { dictation: [] };
    const tutorOf = (name) => H.tutors.find((t) => t.name === name) || { name, display: name.slice(1), subject: name.slice(1) };
    // 七天日期条:接口给每天有话题的老师,听写从模块的记录补
    const days = new Map((H.week || []).map((w) => [w.date, new Set(w.tutors)]));
    for (const x of M.dictation) { const set = days.get(ymd(x.startedAt)); if (set) set.add(modOwner(H, 'dictation', x.tutor)); }
    const week = H.week || [];
    $('#pweek').replaceChildren(
      h('button', { type: 'button', class: 'nv', 'aria-label': '往前七天', on: { click: () => goTo(shiftDate(H.date, -7)) } }, '‹'),
      ...week.map((w) => {
        const [y, mo, da] = w.date.split('-').map(Number);
        const set = days.get(w.date);
        const dots = [...H.tutors.filter((t) => set.has(t.name)).map((t) => colorOf(t)), ...[...set].filter((n) => n.startsWith(':')).map(() => colorOf(null))];
        return h('button', { type: 'button', class: 'dy' + (w.date === H.date ? ' on' : ''), 'aria-pressed': w.date === H.date ? 'true' : 'false', 'aria-label': mo + ' 月 ' + da + ' 日', on: { click: () => goTo(w.date) } },
          h('small', {}, w.date === H.today ? '今天' : '周' + WEEKDAY[new Date(y, mo - 1, da).getDay()]), h('b', {}, String(da)), h('span', { class: 'wd' }, ...dots.map((c) => h('i', { style: 'background:' + c }))));
      }),
      h('button', { type: 'button', class: 'nv', 'aria-label': '往后七天', disabled: !week.length || week[week.length - 1].date >= H.today ? '' : null, on: { click: () => goTo(shiftDate(H.date, 7)) } }, '›'));
    // 打星(《obsidian仓库设计.md》§4:单位是话题,够 keepScore 记账时才沉淀摘要):五颗,点同一颗取消
    const rate = async (t, th, i) => { try { await api('PUT', '/api/conversations/' + encodeURIComponent(t.name) + '/' + H.date + '/threads/' + encodeURIComponent(th.thread) + '/rating', { rating: th.rating === i ? null : i }); } catch {} loadHome(); };
    const stars = (t, th) => h('div', { class: 'stars', 'aria-label': '打星' }, ...[1, 2, 3, 4, 5].map((i) => h('span', { class: 'st' + (th.rating && i <= th.rating ? ' on' : ''), on: { click: (e) => { e.stopPropagation(); rate(t, th, i); } } }, '★')));
    // 删掉一个话题:点一下变「确定删?」(3 秒内再点才真删,没有弹窗);老师还在写的服务端会 409,行留着。
    // 这个话题写进记忆、日记的一起撤(家长在孩子端试过再来删),撤了多少、哪条没撤成弹一句
    const delBtn = (t, th) => {
      const b = h('button', { type: 'button', class: 'del', 'aria-label': '删掉这个话题' }, '删');
      let timer = null;
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = '确定删?'; timer = setTimeout(() => { b.classList.remove('arm'); b.textContent = '删'; }, 3000); return; }
        clearTimeout(timer); b.classList.remove('arm'); b.disabled = true; // 先摘掉 arm:renderOverview 见到 .arm 会跳过重画
        try {
          const r = await api('DELETE', '/api/conversations/' + encodeURIComponent(t.name) + '/' + H.date + '/threads/' + encodeURIComponent(th.thread));
          const u = r && r.undo;
          if (u && (u.memory || u.diary || u.misses.length)) toast([u.memory ? '撤了 ' + u.memory + ' 条记忆' : '', u.diary ? '日记里摘掉了这个话题' : '', ...u.misses].filter(Boolean).join(';'));
        } catch {}
        loadHome();
      });
      return b;
    };
    // 撤回写进 vault 的一笔(「记住了」那几行,2026-10-30):点一下变「确定撤?」,3 秒内再点才撤;家长后来在 Obsidian 改过那行就撤不了,弹服务端说的那句
    const undoBtn = (t, th, w) => {
      const b = h('button', { type: 'button', class: 'undo', 'aria-label': '撤回这一笔' }, '撤回');
      let timer = null;
      b.addEventListener('click', async () => {
        if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = '确定撤?'; timer = setTimeout(() => { b.classList.remove('arm'); b.textContent = '撤回'; }, 3000); return; }
        clearTimeout(timer); b.classList.remove('arm'); b.disabled = true;
        try {
          await api('POST', '/api/conversations/' + encodeURIComponent(t.name) + '/' + H.date + '/threads/' + encodeURIComponent(th.thread) + '/vault/undo', { job: w.job, kind: w.kind, n: w.n });
          toast(w.kind === 'diary' ? '日记里摘掉了这一段' : '撤回了');
        } catch (err) { toast(err && err.message ? err.message : '没撤成'); }
        loadHome();
      });
      return b;
    };
    // ---- 这一天的事,最新的在上:话题、听写、口语课 ----
    const evs = [];
    for (const t of H.tutors) for (const th of t.threads) {
      const at = atMs(th.at), end = Date.parse(th.endAt || '');
      const L = th.lecture;
      const what = [L ? (L.finished ? '看完了' : '看了 ' + lcLen(L.watchedMs)) + (L.marks ? ' · 画了 ' + L.marks + ' 处' : '') : '', th.sections + ' 节 · ' + th.cards + ' 张卡'].filter(Boolean).join(' · ');
      const pf = [h('span', {}, what), th.misses ? h('span', { class: 'miss' }, '⚠ 按住说话连着 ' + th.misses + ' 次没发出去') : null,
        th.stoppedAt === 'writing' ? h('span', { class: 'chip live' }, h('i'), '老师在写') : th.stoppedAt === 'ask' ? h('span', { class: 'chip ask' }, '停下等孩子') : null,
        th.booked ? h('span', { class: 'chip' }, '已记账') : th.oldRuntime ? h('span', { class: 'chip', title: '这个话题是在「' + th.oldRuntime + '」下聊的,老师现在换了,接不上那时的对话' }, '换过运行时 · 不记账') : t.booking && th.sections > 0 ? h('span', { class: 'chip' }, '记账中') : null,
        h('span', { class: 'sp' }), stars(t, th), th.stoppedAt === 'writing' ? null : delBtn(t, th)];
      evs.push({ at, end: Number.isFinite(end) ? end : null, t, th, kid: h('button', { type: 'button', class: 'kid c-tutor', 'aria-label': '看录像', on: { click: () => openReel(t, th.thread, H.date) } }, kidLook(t, th)), pf });
    }
    for (const x of M.dictation.filter((x) => ymd(x.startedAt) === H.date)) {
      const en = x.lang === 'en';
      const cells = []; let n = 0;
      x.words.forEach((w, i) => {
        const ink = (x.ink || [])[i];
        const units = en ? [w] : Array.from(w);
        units.forEach((_u, k) => { if (n++ < 8) cells.push(h('i', { class: (k === 0 && i > 0 ? 'ws' : '') + (ink && ink.shown ? ' rv' : ''), html: inkSvg(ink && ink.d[k], en) })); });
      });
      if (n > 8) cells.push(h('em', { class: 'more' }, '…'));
      const look = h('span', { class: 'bt bt-extra bt-x-dictation' + (en ? ' en' : '') }, h('span', { class: 'dg', 'aria-hidden': 'true' }, ...cells),
        h('span', { class: 'dr' }, h('span', { class: 'lb' }, h('span', { class: 'btx' }, en ? '单词听写' : '听写'), h('small', { class: 'ln' }, (x.lesson ? x.lesson + ' · ' : '') + x.words.length + (en ? ' 个单词' : ' 个词')))));
      const sub = [x.revealed ? '看了答案 ' + x.revealed + ' 个' : '', x.asked ? '再写 ' + x.asked + ' 个' : '', x.done ? '对好了' : x.checked ? '交了' : '还在写'].filter(Boolean).join(' · ');
      const end = Date.parse(x.doneAt || '');
      evs.push({ at: Date.parse(x.startedAt), end: Number.isFinite(end) ? end : null, t: tutorOf(modOwner(H, 'dictation', x.tutor)), kid: h('a', { class: 'kid c-tutor', href: '/parent/dictation/reel?id=' + encodeURIComponent(x.id), 'aria-label': '看录像' }, look), pf: [h('span', {}, sub)], practice: x.practice || [] });
    }
    evs.sort((p, q) => (q.at || 0) - (p.at || 0));
    const [y0, m0, d0] = H.date.split('-').map(Number);
    const tl = [];
    if (evs.length) {
      const first = evs[evs.length - 1], last = evs[0];
      tl.push(h('div', { class: 'hd' }, h('b', {}, m0 + ' 月 ' + d0 + ' 日 周' + WEEKDAY[new Date(y0, m0 - 1, d0).getDay()]), h('small', {}, hhmm(first.at) + ' – ' + hhmm(last.end || last.at) + ' · ' + evs.length + ' 件事 · 点一件看录像')));
    } else tl.push(h('div', { class: 'none' }, H.date === H.today ? '今天还没开始' : '这天没聊'));
    evs.forEach((e, i) => {
      // 上面那件(更晚的)开始之前,这件结束之后,隔得久写一行
      const later = evs[i - 1];
      const gap = later ? later.at - (e.end || e.at) : 0;
      if (later && gap >= 5 * 60000) tl.push(h('div', { class: 'pgap' }, '隔了 ' + mins(gap)));
      tl.push(h('div', { class: 'pev', style: '--c:' + colorOf(e.t) },
        h('div', { class: 'pv-tm' }, hhmm(e.at), e.end && e.end > e.at ? h('small', {}, mins(e.end - e.at)) : null),
        h('div', { class: 'pv-rail' }, h('div', { class: 'pv-who' }, h('span', { class: 'pv-at' }, hhmm(e.at), e.end && e.end > e.at ? h('small', {}, mins(e.end - e.at)) : null), avatarEl(e.t), e.t.display), h('div', { class: 'pent' }, e.kid, h('div', { class: 'pf' }, ...e.pf)))));
    });
    $('#ptl').replaceChildren(...tl);
    // ---- 这一天老师跟你说的:卡上没有的才放这里;记账只在这里 ----
    const what = (th) => (th.start && th.start.kind === 'new' ? '新话题' + (th.said ? '「' + th.said + '」' : '') : th.start && th.start.kind === 'lecture' && th.lecture ? '小课堂「' + th.lecture.title + '」' : th.start ? th.start.label || th.title : th.title);
    const notes = evs.filter((e) => e.th && e.th.notes && e.th.notes.length);
    // 记住了:这一天写进 vault 的每一笔(记忆、孩子的记忆、日记那段),对上了孩子原话的带一句「孩子说」,每笔能撤回
    const mem = evs.filter((e) => e.th && e.th.writes && e.th.writes.length);
    const practice = [...new Set(evs.flatMap((e) => e.practice || []))];
    const booking = H.tutors.some((t) => t.booking);
    const writing = H.tutors.some((t) => t.threads.some((th) => th.stoppedAt === 'writing'));
    const done = H.tutors.reduce((n, t) => n + t.threads.filter((th) => th.booked).length, 0);
    // 换过运行时的话题不记账(卡上写着),不算还没记的
    const left = H.tutors.reduce((n, t) => n + t.threads.filter((th) => !th.booked && !th.oldRuntime && th.sections > 0).length, 0);
    // 记账(《obsidian仓库设计.md》§4):这天每位老师还没记过的话题各起一轮,老师回「## 记账」段,应用写日记。花钱,所以两下确认;老师在写或在记就灰
    const bookBtn = h('button', { type: 'button', class: 'book', disabled: booking || writing || !left ? '' : null }, booking ? '记账中…' : '记账');
    let bookTimer = null;
    bookBtn.addEventListener('click', async () => {
      if (!bookBtn.classList.contains('arm')) { bookBtn.classList.add('arm'); bookBtn.textContent = '确定记?要花钱'; bookTimer = setTimeout(() => { bookBtn.classList.remove('arm'); bookBtn.textContent = '记账'; }, 4000); return; }
      clearTimeout(bookTimer); bookBtn.classList.remove('arm'); bookBtn.disabled = true; bookBtn.textContent = '记账中…';
      let n = 0, old = 0;
      for (const t of H.tutors) {
        if (!t.threads.some((th) => !th.booked && !th.oldRuntime && th.sections > 0)) continue;
        try { const r = await api('POST', '/api/conversations/' + encodeURIComponent(t.name) + '/' + H.date + '/bookkeep', {}); n += (r.queued || []).length; old += (r.skipped || []).filter((x) => x.oldRuntime).length; } catch {}
      }
      toast((n ? '记 ' + n + ' 个话题,老师在写;记好了卡上会亮「已记账」' : '没有要记的话题') + (old ? ';另有 ' + old + ' 个是换运行时之前聊的,接不上那时的对话,不记账' : ''));
      loadHome();
    });
    const anyThread = done + left > 0;
    // replaceChildren 不跳过 null(会当成字「null」插进去),没有的块先滤掉
    $('#pday').replaceChildren(...[
      h('b', {}, (H.date === H.today ? '今天' : '这一天') + '老师跟你说的'),
      notes.length ? h('div', { class: 'rs' }, h('h3', {}, '给家长的'), ...notes.flatMap((e) => e.th.notes.map((x) => h('div', { class: 'nt' }, avatarEl(e.t), h('small', {}, hhmm(e.at) + ' · ' + what(e.th)), h('p', {}, x))))) : null,
      mem.length ? h('div', { class: 'rs' }, h('h3', {}, '记住了 · 写进了 vault'), ...mem.flatMap((e) => e.th.writes.map((w) => h('div', { class: 'mem' }, h('small', {}, (e.t.subject || e.t.display).replace(/老师$/, '')), h('span', {}, w.text, w.quote ? h('small', { class: 'qt' }, '孩子说「' + w.quote + '」') : null), undoBtn(e.t, e.th, w))))) : null,
      practice.length ? h('div', { class: 'rs' }, h('h3', {}, '要再练的 · 听写里看了答案、重写过、被问了再写的'), h('div', { class: 'rw' }, ...practice.map((w) => h('span', {}, w)))) : null,
      !notes.length && !mem.length && !practice.length ? h('div', { class: 'quiet' }, evs.length ? '老师这天没留话给你。' : '这天没聊。') : null,
      anyThread ? h('div', { class: 'rs dia' }, h('h3', {}, '日记'), h('div', {}, h('span', {}, booking ? '老师在记账' : left ? (done ? done + ' 个话题已记进日记,还有 ' : '还有 ') + left + ' 个没记' : '话题都记进日记了'), bookBtn)) : null,
    ].filter(Boolean));
  };

  // ---- 录像:点一件就是它的录像,停在最后一帧不放,要看过程往前拖;退出回清单 ----
${REEL_DOCK_JS}
  // 孩子的屏幕放的声音用这一个 Audio(iframe 里经 window.__cotutorAudio 拿):家长点那一件时在手势里放一段静音解锁
  const audio = new Audio();
  window.__cotutorAudio = audio;
  let unlocked = false;
  const unlock = () => {
    if (unlocked) return;
    try { audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='; audio.play().then(() => { unlocked = true; }, (e) => { if (e && e.name === 'AbortError') unlocked = true; }); } catch {}
  };
  /** 录像左上角「退出录像」旁边写的:哪位老师 · 哪件事 · 哪天几点 */
  const reelTitle = (t, thread, date) => {
    const H = S.home, tu = H && H.tutors ? H.tutors.find((x) => x.name === t.name) : null;
    const th = tu && tu.threads ? tu.threads.find((x) => x.thread === thread) : null;
    const what = !th ? '' : th.start && th.start.kind === 'new' ? '新话题' + (th.said ? '「' + th.said + '」' : '') : th.start && th.start.kind === 'lecture' && th.lecture ? '小课堂「' + th.lecture.title + '」' : (th.start && th.start.label) || th.title;
    const when = H && H.today ? dateLabel(date || H.today, H.today) : '';
    return [t.display, what, when + (th ? ' ' + hhmm(atMs(th.at)) : '')].filter((x) => x && x.trim()).join(' · ');
  };
  const openReel = (t, thread, date) => {
    unlock();
    S.reel = { tutor: t, thread, date: date || S.pdate || null };
    window.cotutorReelReady = (api, info) => {
      if (!S.reel) return;
      reelDock.open(api, { exit: closeReel, toast, title: reelTitle(t, thread, S.reel.date) });
      reelDock.frame(info && info.size ? info.size : [1180, 820]);
    };
    window.cotutorReelFail = () => { closeReel(); toast('这个话题没有录像'); };
    $('#rl').hidden = false; $('#rl-screen').hidden = false;
    $('#rl-frame').src = '/reel?' + new URLSearchParams({ tutor: t.name, date: S.reel.date || 'today', thread, end: '1' });
  };
  const closeReel = () => {
    if (!S.reel) return;
    S.reel = null; reelDock.close();
    window.cotutorReelReady = null; window.cotutorReelFail = null;
    const fr = $('#rl-frame'); try { if (fr.contentWindow && fr.contentWindow.cotutorReel) fr.contentWindow.cotutorReel.stop(); } catch {}
    fr.src = 'about:blank';
    try { audio.pause(); } catch {}
    $('#rl').hidden = true; $('#rl-screen').hidden = true;
    loadHome();
  };

  // ---- 启动与心跳:不通就 logo 灰,什么都不报 ----
  // ?date= 停在那天;?tutor=&date=&thread= 直接开那个话题的录像(服务换了代码重载回来也靠它)
  if (debug.get('date')) S.pdate = debug.get('date');
  loadHome().then(() => {
    const open = debug.get('tutor'), th = debug.get('thread');
    const t = open && S.home ? S.home.tutors.find((x) => x.name === open) : null;
    if (t && th) openReel(t, th, S.home.date);
  });
  /** 服务换了新代码:重载;开着录像就带上是哪一件,回来还开着 */
  const staleReload = () => {
    if (!stale || document.hidden) return;
    if (S.reel) { const q = new URLSearchParams({ tutor: S.reel.tutor.name }); if (S.reel.date) q.set('date', S.reel.date); q.set('thread', S.reel.thread); location.replace(location.pathname + '?' + q); return; }
    location.reload();
  };
  setInterval(() => { staleReload(); if (!S.reel) loadHome(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !S.reel) loadHome(); });
})();
</script>`;
}
