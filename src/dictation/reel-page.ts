/**
 * /parent/dictation/reel?id=<id>:家长看听写的录像(录数据不录屏幕,不录孩子的声音)。
 * 和话题的录像同一个样子:上半是孩子的屏幕——听写页本身以录像模式开在 iframe 里(/dictation?reel=<id>,英文 &lang=en),
 * 照记录用写字屏自己的画法画;下半是录像栏(src/server/reel-dock.ts),只经 iframe 交过来的把手说话。
 * 声音:iframe 用这一页的 Audio(window.__cotutorAudio),家长第一次点这一页就解锁(Safari 只让手势里起的声音响)。
 * 内联脚本里不写反斜杠、不写反引号(这是模板字符串,见 CLAUDE.md「坑」)。
 */
import { REEL_DOCK_CSS, REEL_DOCK_HTML, REEL_DOCK_JS } from '../server/reel-dock.ts';
import { pageDomJs } from '../server/page-dom.ts';
import { faviconLinks } from '../lib/favicon.ts';

export const DICTATION_REEL_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
${faviconLinks()}
<title>听写录像</title>
<style>
  :root { --paper:#faf9f4; --ink:#2b2b2b; --dim:#8a8781; --line:#e2dfd6; --accent:#e8743b; --grey:#eeece6; --purple:#efe9fb; --purple-ink:#7a4fc9; --ok:#e8f6ee; --ok-ink:#1f8a4c; }
  * { box-sizing:border-box; }
  html, body { margin:0; height:100%; background:var(--paper); color:var(--ink); font:16px/1.5 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; }
  body { display:flex; flex-direction:column; height:100vh; height:100dvh; overflow:hidden; }
  button { font:inherit; cursor:pointer; }
  .blank { flex:1; display:grid; place-items:center; color:var(--dim); font-size:17px; padding:24px; text-align:center; }
  #toast { position:fixed; left:50%; bottom:120px; transform:translateX(-50%); max-width:min(560px, 90vw); padding:10px 16px; border-radius:12px; background:#2b2b2bee; color:#fff; font-size:14px; display:none; z-index:40; }
  #toast.on { display:block; }
${REEL_DOCK_CSS}
</style></head>
<body>
<div id="rl-screen" hidden><iframe id="rl-frame" title="孩子的屏幕" allow="autoplay"></iframe></div>
${REEL_DOCK_HTML}
<div id="toast"></div>
<script>
(() => {
  'use strict';
  // $ / h / toast / api(../server/page-dom.ts,几页共用)
${pageDomJs(4000)}
${REEL_DOCK_JS}
  const blank = (text) => { $('#rl-screen').hidden = true; reelDock.close(); const b = document.createElement('div'); b.className = 'blank'; b.textContent = text; document.body.prepend(b); };
  const exit = () => { if (history.length > 1) history.back(); else location.href = '/parent/dictation'; };
  // 孩子的屏幕放的声音用这一个 Audio:家长第一次点这一页时放一段静音解锁
  const audio = new Audio(); audio.preload = 'auto';
  window.__cotutorAudio = audio;
  let unlocked = false;
  const unlock = () => { if (unlocked) return; unlocked = true; try { if (!audio.src) { audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='; const pr = audio.play(); if (pr && pr.catch) pr.catch(() => {}); } } catch (e) {} };
  document.addEventListener('pointerdown', unlock, true);
  const id = new URLSearchParams(location.search).get('id') || '';
  // 左上角「退出录像」旁边写的:哪位老师 · 听写 · 几点;听写读回来再填
  let title = '听写';
  window.cotutorReelReady = (api, info) => {
    reelDock.open(api, { exit, toast, title });
    reelDock.frame(info && info.size ? info.size : [1180, 820]);
  };
  window.cotutorReelFail = () => blank('这次还没写,没有录像。');
  fetch('/api/dictation/' + encodeURIComponent(id) + '/kid', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((v) => {
    if (!v) { blank('找不到这次听写。'); return; }
    const at = new Date(v.startedAt);
    title = [v.tutor, v.lang === 'en' ? '单词听写' : '听写', (at.getMonth() + 1) + ' 月 ' + at.getDate() + ' 日 ' + String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0')].filter(Boolean).join(' · ');
    $('#rl-screen').hidden = false;
    $('#rl-frame').src = '/dictation?' + new URLSearchParams(v.lang === 'en' ? { lang: 'en', reel: id } : { reel: id });
  }, () => blank('找不到这次听写。'));
})();
</script>
</body></html>`;
