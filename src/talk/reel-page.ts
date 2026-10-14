/**
 * /parent/talk/reel?id=<id>:家长看口语课的录像(《wip/口语课设想.md》§8.3;播放器同《家长录像设计.md》拍板 13–15,录数据不录屏幕)。
 * 上半是孩子的屏幕——口语课孩子那一屏以录像模式开在 iframe 里(/talk?reel=<id>),把录下的消息原样喂回它自己的处理函数;
 * 下半是录像栏(src/server/reel-dock.ts),只经 iframe 交过来的把手说话。家长端记录里口语课那一行点进来就是这里(同话题、听写,《家长录像设计.md》拍板 16;没有录像的老记录换到回看页)。声音是 call.wav(两边按时刻混好),用这一页的 Audio(家长第一次点就解锁)。
 * 内联脚本里不写反斜杠、不写反引号(这是模板字符串,见 CLAUDE.md「坑」)。
 */
import { REEL_DOCK_CSS, REEL_DOCK_HTML, REEL_DOCK_JS } from '../server/reel-dock.ts';

export const TALK_REEL_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>口语课录像</title>
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
  const $ = (s) => document.querySelector(s);
${REEL_DOCK_JS}
  let toastTimer = 0;
  const toast = (text) => { const t = $('#toast'); t.textContent = text; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 4000); };
  const blank = (text) => { $('#rl-screen').hidden = true; reelDock.close(); const b = document.createElement('div'); b.className = 'blank'; b.textContent = text; document.body.prepend(b); };
  const id = new URLSearchParams(location.search).get('id') || '';
  const exit = () => { if (history.length > 1) history.back(); else location.href = '/parent/talk#/review/' + encodeURIComponent(id); };
  // 孩子的屏幕放的声音用这一个 Audio:家长第一次点这一页时放一段静音解锁
  const audio = new Audio(); audio.preload = 'auto';
  window.__cotutorAudio = audio;
  let unlocked = false;
  const unlock = () => { if (unlocked) return; unlocked = true; try { if (!audio.src) { audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='; const pr = audio.play(); if (pr && pr.catch) pr.catch(() => {}); } } catch (e) {} };
  document.addEventListener('pointerdown', unlock, true);
  window.cotutorReelReady = (api, info) => {
    reelDock.open(api, { exit, toast });
    reelDock.frame(info && info.size ? info.size : [1180, 820]);
  };
  window.cotutorReelFail = () => blank('这一次还没打,没有录像。');
  fetch('/api/talk/' + encodeURIComponent(id) + '/reel', { cache: 'no-store' }).then((r) => {
    // 10 月 14 日以前打的没有录像:记录点进来的就换到回看页(字与两边的原声),不留一页空的
    if (r.status === 404) { location.replace('/parent/talk#/review/' + encodeURIComponent(id)); return; }
    if (!r.ok) { blank('读不到这一次。'); return; }
    $('#rl-screen').hidden = false;
    $('#rl-frame').src = '/talk?' + new URLSearchParams({ reel: id });
  }, () => blank('读不到这一次。'));
})();
</script>
</body></html>`;
