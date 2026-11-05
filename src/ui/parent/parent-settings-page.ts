/**
 * 家长端「设置」(/parent/settings):设一次就不常动的。现在只有一项——孩子的平板上,按住说话那一栏放哪边(cotutor.json 的 kid.hand)。
 * 两张示意图(不是截图,页面现画的 SVG):横着的平板,窄的一栏是老师头像 + 按住说话,宽的一边是写字的白纸;点一张就存。
 * 孩子端首页的接口带着它(/api/kid/home 的 hand),孩子下次进老师页就换过来;画板那一列工具跟着一起挪。
 * 零依赖内联脚本,只走 /api/parent/settings(GET 读,PATCH {kid: {hand}} 改)。
 * 用 String.raw:脚本里的反斜杠原样留着;脚本里不写反引号和 ${。
 */
import { faviconLinks } from '../shared/favicon.ts';
import { BRAND_CSS, BRAND_FOOTER, BRAND_JS, titleLogo } from '../shared/brand.ts';
import { pageDomJs } from '../shared/page-dom.ts';

export const PARENT_SETTINGS_PAGE = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="manifest" href="/parent/manifest.webmanifest">
${faviconLinks()}
<title>家长 · 设置</title>
<style>
  :root { --paper:#f6f5f1; --ink:#2b2b2b; --dim:#6b675f; --mute:#8a8781; --line:#efece5; --card:#fff; --accent:#b4531f; }
  * { box-sizing:border-box; }
  html,body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.5 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; -webkit-text-size-adjust:100%; }
  button { font:inherit; color:inherit; }
  .wrap { max-width:640px; margin:0 auto; padding:calc(env(safe-area-inset-top) + 20px) 16px calc(env(safe-area-inset-bottom) + 40px); display:flex; flex-direction:column; gap:16px; }
  .top { display:flex; flex-wrap:wrap; align-items:center; gap:12px 20px; }
  .top b { font-size:20px; }
  .top .ttl { display:inline-flex; align-items:center; gap:10px; }
  #ct-mark { display:flex; }
${BRAND_CSS}
  .devl { flex:none; display:inline-flex; align-items:center; gap:4px; height:32px; padding:0 10px; border:1px solid #e2dfd6; border-radius:10px; background:#fff; color:var(--dim); font-size:13px; text-decoration:none; margin-left:auto; }
  .top .seg { order:3; flex:1 0 100%; }
  .seg { display:flex; padding:3px; border-radius:12px; background:#e9e6de; }
  .seg > * { flex:1; height:36px; border-radius:9px; font-size:15px; color:var(--dim); display:flex; align-items:center; justify-content:center; text-decoration:none; }
  .seg > .on { background:#fff; color:var(--ink); font-weight:600; box-shadow:0 1px 2px rgba(0,0,0,.08); }
  .gh { font-size:13px; color:var(--mute); padding:8px 16px 6px; }
  .grp { background:var(--card); border-radius:14px; padding:14px; display:flex; flex-direction:column; gap:12px; }
  .q { font-size:16px; font-weight:500; padding:0 2px; }
  .hands { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .hand { position:relative; display:flex; flex-direction:column; align-items:center; gap:8px; padding:10px 10px 12px; border:2px solid var(--line); border-radius:14px; background:#fff; cursor:pointer; -webkit-tap-highlight-color:transparent; }
  .hand svg { display:block; width:100%; height:auto; }
  .hand .lb { font-size:15px; color:var(--dim); }
  .hand .lb small { display:block; font-size:12px; color:var(--mute); text-align:center; }
  .hand.on { border-color:var(--accent); }
  .hand.on .lb { color:var(--ink); font-weight:600; }
  .hand .ck { position:absolute; top:-9px; right:-9px; width:22px; height:22px; border-radius:50%; background:var(--accent); color:#fff; display:none; place-items:center; }
  .hand.on .ck { display:grid; }
  .hand:disabled { cursor:default; opacity:.6; }
  .note { font-size:13px; color:var(--mute); line-height:1.55; padding:0 2px; }
  #toast { position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom) + 24px); transform:translateX(-50%); max-width:min(560px,calc(100% - 32px)); padding:12px 18px; border-radius:16px; background:#2b2b2bee; color:#fff; font-size:15px; display:none; z-index:20; white-space:pre-line; }
  #toast.on { display:block; }
  @media (min-width:1000px) {
    .wrap { padding-top:calc(env(safe-area-inset-top) + 22px); gap:20px; }
    .top .seg { order:0; flex:0 0 260px; }
    .gh { padding:8px 6px 6px; }
  }
</style></head><body>
<div class="wrap">
  <div class="top"><span class="ttl"><span id="ct-mark" class="ct-draw ct-hover">${titleLogo(true)}</span><b id="title">家长</b></span><nav class="seg"><a href="/parent/home">首页</a><a href="/parent">记录</a><a class="on" href="/parent/settings">设置</a></nav><a class="devl" href="/dev" target="_blank" title="工作台:细调老师文件、activity(新窗口)">工作台<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 2h6v6"/><path d="M10 2 3 9"/></svg></a></div>
  <div>
    <div class="gh">孩子的平板</div>
    <div class="grp">
      <div class="q" id="hand-q">按住说话那一栏放哪边</div>
      <div class="hands" id="hands" role="radiogroup" aria-labelledby="hand-q"></div>
      <div class="note">平板横着用的时候,老师页上那一栏(老师的头像、按住说话)放在这边,另一边留给写字;画板上那一列工具也跟着放这边。孩子下次进老师页就换过来。</div>
    </div>
  </div>
  ${BRAND_FOOTER}
</div>
<div id="toast"></div>
<script>
(() => {
${BRAND_JS}
  // $ / h / toast / api(page-dom.ts,几页共用)
${pageDomJs(3200)}
  const CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>';
  /** 示意图:横着的平板;col = 窄的那一栏在哪边('left' / 'right')。窄栏里是老师的头像与按住说话的胶囊,宽的一边是白纸上写着几行字 */
  const sketch = (col) => {
    const W = 240, H = 168, sx = 10, sy = 10, sw = 220, sh = 148, cw = 66;
    const cx = col === 'left' ? sx : sx + sw - cw;
    const px = col === 'left' ? sx + cw + 12 : sx + 12;
    const pw = sw - cw - 24;
    const mid = cx + cw / 2;
    const id = 'scr-' + col;
    const lines = [0.78, 0.6, 0.7].map((k, i) => '<path d="M' + (px + 12) + ' ' + (sy + 30 + i * 15) + 'h' + Math.round((pw - 24) * k) + '" stroke="#ddd8cc" stroke-width="4" stroke-linecap="round"></path>').join('');
    const wx = px + 14, wy = sy + 104;
    const ink = '<path d="M' + wx + ' ' + wy + 'c6-14 12-14 14 0s8 14 14 0 8-14 14 0 8 14 14 0" fill="none" stroke="#7a4fc9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">'
      + '<defs><clipPath id="' + id + '"><rect x="' + sx + '" y="' + sy + '" width="' + sw + '" height="' + sh + '" rx="9"></rect></clipPath></defs>'
      + '<rect x="2" y="2" width="' + (W - 4) + '" height="' + (H - 4) + '" rx="16" fill="#34312c"></rect>'
      + '<g clip-path="url(#' + id + ')">'
      + '<rect x="' + sx + '" y="' + sy + '" width="' + sw + '" height="' + sh + '" fill="#f4f1ea"></rect>'
      + '<rect x="' + cx + '" y="' + sy + '" width="' + cw + '" height="' + sh + '" fill="#fffdf8"></rect>'
      + '<path d="M' + (col === 'left' ? cx + cw : cx) + ' ' + sy + 'v' + sh + '" stroke="#e6e1d6" stroke-width="1.5"></path>'
      + '</g>'
      + '<rect x="' + px + '" y="' + (sy + 12) + '" width="' + pw + '" height="' + (sh - 24) + '" rx="6" fill="#fff" stroke="#e6e1d6"></rect>'
      + lines + ink
      + '<circle cx="' + mid + '" cy="' + (sy + 62) + '" r="18" fill="#f6e6da" stroke="#b4531f" stroke-width="3"></circle>'
      + '<circle cx="' + (mid - 6) + '" cy="' + (sy + 59) + '" r="2.2" fill="#6b4a36"></circle><circle cx="' + (mid + 6) + '" cy="' + (sy + 59) + '" r="2.2" fill="#6b4a36"></circle>'
      + '<path d="M' + (mid - 6) + ' ' + (sy + 67) + 'q6 5 12 0" fill="none" stroke="#6b4a36" stroke-width="2" stroke-linecap="round"></path>'
      + '<rect x="' + (mid - 24) + '" y="' + (sy + 96) + '" width="48" height="20" rx="10" fill="#b4531f"></rect>'
      + '<rect x="' + (mid - 3) + '" y="' + (sy + 100) + '" width="6" height="9" rx="3" fill="#fff"></rect>'
      + '<path d="M' + (mid - 6) + ' ' + (sy + 106) + 'a6 6 0 0 0 12 0M' + mid + ' ' + (sy + 112) + 'v2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"></path>'
      + '</svg>';
  };
  // hand(cotutor.json 的键)→ 那一栏在哪边:right(缺省)= 栏在左边;left = 栏在右边
  const CHOICES = [{ hand: 'right', col: 'left', label: '在左边', sub: '缺省' }, { hand: 'left', col: 'right', label: '在右边', sub: '' }];
  let S = null; let busy = false;
  const draw = () => {
    const box = $('#hands');
    box.replaceChildren(...CHOICES.map((c) => {
      const on = S && S.hand === c.hand;
      return h('button', { type: 'button', class: 'hand' + (on ? ' on' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false', 'aria-label': '按住说话' + c.label, disabled: busy || !S, on: { click: () => pick(c) } },
        h('span', { class: 'ck', html: CHECK }), h('span', { style: 'display:block;width:100%', html: sketch(c.col) }),
        h('span', { class: 'lb' }, '按住说话' + c.label, c.sub ? h('small', {}, c.sub) : null));
    }));
  };
  const pick = async (c) => {
    if (!S || busy || S.hand === c.hand) return;
    busy = true; draw();
    try { await api('PATCH', '/api/parent/settings', { kid: { hand: c.hand } }); S.hand = c.hand; toast('存好了:按住说话' + c.label + '。孩子下次进老师页就换过来'); }
    catch (e) { toast('没改成:' + e.message); }
    busy = false; draw();
  };
  const load = async () => {
    try { S = await api('GET', '/api/parent/settings'); } catch (e) { toast('读不到:' + e.message); }
    if (S) { document.title = S.title + ' · 家长 · 设置'; $('#title').textContent = S.title; }
    draw();
  };
  draw();
  load();
})();
</script>
</body></html>
`;
