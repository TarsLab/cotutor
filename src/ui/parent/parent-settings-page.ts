/**
 * 家长端「设置」(/parent/settings):设一次就不常动的。备份和诊断信息也放这(parent-setup.ts)。孩子的平板上,按住说话那一栏放哪边(cotutor.json 的 kid.hand)。
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
  .acts { display:flex; flex-wrap:wrap; gap:8px; padding:0 3px 12px; }
  .act { display:inline-flex; align-items:center; min-height:44px; padding:0 14px; border:0; border-radius:10px; background:var(--paper, transparent); box-shadow:0 0 0 1px var(--line); color:inherit; font-size:15px; text-decoration:none; cursor:pointer; }
  .act[disabled] { opacity:.5; }
  #rep-text { margin:0 3px 12px; padding:10px 12px; max-height:320px; overflow:auto; border-radius:10px; box-shadow:0 0 0 1px var(--line); font:12px/1.55 ui-monospace,Menlo,Consolas,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
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
  <div>
    <div class="gh">备份</div>
    <div class="grp">
      <div class="note" id="bk-note">读取中……</div>
      <div class="acts"><button type="button" class="act" id="bk-go">现在备份一份</button></div>
    </div>
  </div>
  <div>
    <div class="gh">遇到问题</div>
    <div class="grp">
      <div class="note">生成一份诊断信息,发给开发者或帮你的 AI 助手,不用来回问。里面没有孩子的对话、照片、录音、档案和 key,名字和 IP 已经抹掉。不会自动发出去,你可以先看一遍。</div>
      <div class="acts"><button type="button" class="act" id="rep-go">生成诊断信息</button></div>
      <pre id="rep-text" hidden></pre>
      <div class="acts" id="rep-acts" hidden><button type="button" class="act" id="rep-copy">复制</button><a class="act" href="https://github.com/TarsLab/cotutor/issues/new?template=bug.yml" target="_blank" rel="noopener">到 GitHub 反馈</a></div>
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
  // 备份:只读和「现在备一份」;恢复要停服务,在终端里做,这里说怎么做
  const bkLoad = async () => {
    const d = await api('GET', '/api/parent/backups').catch(() => null);
    const note = $('#bk-note');
    if (!d) { note.textContent = '读不到备份的情况'; return; }
    const last = d.list[0];
    const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
    note.textContent = (last ? '最近一份 ' + new Date(last.at).toLocaleString() + ',' + last.files + ' 个文件,' + mb(last.bytes) + ';一共留着 ' + d.list.length + ' 份。' : '还没有备份。') + '放在 ' + d.dir + '。服务开着时每天自动备一份,升级前也备一份;录音占地方,不在备份里。要恢复:在这台电脑的终端里跑 ' + d.commands.list + ' 看有哪些,再 ' + d.commands.restore + '。';
  };
  $('#bk-go').addEventListener('click', async () => {
    const b = $('#bk-go');
    b.disabled = true;
    try { await api('POST', '/api/parent/backups', {}); toast('备份好了'); } catch (e) { toast('没备份成:' + e.message); }
    b.disabled = false;
    bkLoad();
  });
  // 诊断信息:先给人看,复制是人点的;不自动发
  $('#rep-go').addEventListener('click', async () => {
    const b = $('#rep-go');
    b.disabled = true;
    try {
      const r = await api('GET', '/api/parent/report');
      $('#rep-text').textContent = r.text;
      $('#rep-text').hidden = false;
      $('#rep-acts').hidden = false;
    } catch (e) { toast('没生成成:' + e.message); }
    b.disabled = false;
  });
  $('#rep-copy').addEventListener('click', async () => {
    const text = $('#rep-text').textContent;
    try {
      await navigator.clipboard.writeText(text);
      toast('复制好了');
    } catch {
      // 不是 https 的地址没有剪贴板接口:选中,让人自己复制
      const range = document.createRange();
      range.selectNodeContents($('#rep-text'));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast('已选中,按复制');
    }
  });
  draw();
  load();
  bkLoad();
})();
</script>
</body></html>
`;
