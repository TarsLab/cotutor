/**
 * 家长端「首页」(/parent/home):
 * 左边(手机上是上面)是孩子端首页本身——iframe 装 /preview(孩子端页面的预览模式),按孩子设备的尺寸开、等比缩进来,可切 iPad / 手机;
 * 点牌上的按钮在旁边改它(字、讲法、留多久),改字时牌上跟着变;点后面那张牌换老师;听写、口语课点了去改这周的词、口语课。
 * 预览下面一排是老师的先后(按住左右拖)、孩子看不到的按钮、加一个开场按钮;右边是百炼(没配时在最上面)、改着的那颗、这位老师「每天都在」的、在不在首页。
 * 另一个标签「记录」是 /parent。零依赖内联脚本,只走 /api/parent/*;每次现读,改了马上发到孩子的首页(src/app/http/parent-home.ts)。
 * iframe 一挪地方就会重新加载:它在 #pv 里常驻,重画只动 #pv-under 与 #body。
 * 用 String.raw:脚本里的反斜杠原样留着;脚本里不写反引号和 ${。
 */
import { faviconLinks } from '../shared/favicon.ts';
import { BRAND_CSS, BRAND_FOOTER, BRAND_JS, titleLogo } from '../shared/brand.ts';
import { pageDomJs } from '../shared/page-dom.ts';
import { upgradeSteps } from '../../shared/upgrade.ts';

export const PARENT_HOME_PAGE = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="manifest" href="/parent/manifest.webmanifest">
${faviconLinks()}
<title>家长 · 首页</title>
<style>
  :root { --paper:#f6f5f1; --ink:#2b2b2b; --dim:#6b675f; --mute:#8a8781; --line:#efece5; --card:#fff; --accent:#b4531f; --ok:#2fa36b; --red:#c0392b; }
  * { box-sizing:border-box; }
  html,body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.5 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; -webkit-text-size-adjust:100%; }
  button, input, textarea { font:inherit; color:inherit; }
  .wrap { max-width:640px; margin:0 auto; padding:calc(env(safe-area-inset-top) + 20px) 16px calc(env(safe-area-inset-bottom) + 40px); display:flex; flex-direction:column; gap:16px; }
  .top { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:12px 20px; }
  .top b { font-size:20px; }
  /* 标题前那颗 logo:彩色,打开时画出来、悬停点一下头 */
  .top .ttl { display:inline-flex; align-items:center; gap:10px; align-self:center; }
  #ct-mark { display:flex; }
${BRAND_CSS}
  .top small { color:var(--mute); font-size:13px; }
  /* 去工作台:次要的小链接,不和首页 / 记录并列 */
  .devl { flex:none; display:inline-flex; align-items:center; gap:4px; height:32px; padding:0 10px; border:1px solid #e2dfd6; border-radius:10px; background:#fff; color:var(--dim); font-size:13px; text-decoration:none; }
  .top .devl { margin-left:auto; }
  .top .seg { order:3; flex:1 0 100%; }
  .seg { display:flex; padding:3px; border-radius:12px; background:#e9e6de; }
  .seg > * { flex:1; height:36px; border:0; border-radius:9px; background:transparent; font-size:15px; color:var(--dim); display:flex; align-items:center; justify-content:center; text-decoration:none; cursor:pointer; }
  .seg > .on { background:#fff; color:var(--ink); font-weight:600; box-shadow:0 1px 2px rgba(0,0,0,.08); }
  .who { display:flex; gap:4px; overflow-x:auto; }
  .mini { flex:none; width:76px; display:flex; flex-direction:column; align-items:center; gap:3px; border:0; border-radius:12px; background:transparent; font-size:13px; color:var(--mute); padding:4px 0; cursor:pointer; }
  .mini.on { color:var(--ink); font-weight:600; background:#fff; }
  .mini.hid .av { opacity:.4; }
  .av { position:relative; flex:none; width:48px; height:48px; display:grid; place-items:center; }
  .av svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
  .av circle { fill:none; stroke:currentColor; stroke-width:8; stroke-linecap:round; stroke-dasharray:221.17 55.29; transform-origin:50px 50px; transform:rotate(36deg); }
  .av .face { position:absolute; left:15%; top:15%; width:70%; height:70%; border-radius:50%; background:#fff; display:grid; place-items:center; font-size:17px; font-weight:700; overflow:hidden; }
  .av img { width:100%; height:100%; object-fit:cover; }
  .gh { font-size:13px; color:var(--mute); padding:0 16px 6px; display:flex; justify-content:space-between; align-items:center; }
  .grp { background:var(--card); border-radius:14px; overflow:hidden; }
  .it { display:flex; align-items:center; gap:10px; min-height:50px; padding:10px 14px; border:0; border-top:1px solid var(--line); background:var(--card); width:100%; text-align:left; }
  .it:first-child { border-top:0; }
  button.it { cursor:pointer; }
  .it .tx { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
  .it .tx b { font-size:16px; font-weight:500; }
  .it .tx small { font-size:13px; color:var(--dim); line-height:1.45; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; white-space:pre-line; }
  .tag { flex:none; font-size:12px; padding:2px 7px; border-radius:6px; background:#f3efe6; color:var(--dim); font-weight:500; }
  .chev { flex:none; color:#b9b5ac; }
  .sw { flex:none; width:50px; height:30px; border:0; border-radius:15px; background:#d9d5cc; position:relative; padding:0; cursor:pointer; transition:background .2s; }
  .sw::after { content:""; position:absolute; top:3px; left:3px; width:24px; height:24px; border-radius:50%; background:#fff; transition:left .2s; box-shadow:0 1px 2px rgba(0,0,0,.15); }
  .sw[aria-checked="true"] { background:var(--ok); }
  .sw[aria-checked="true"]::after { left:23px; }
  .sw:disabled { opacity:.4; }
  .step { display:flex; align-items:center; gap:8px; }
  .step button { width:40px; height:36px; border:1.5px solid #e2dfd6; border-radius:10px; background:#fff; cursor:pointer; }
  .step b { min-width:28px; text-align:center; }
  .fld { display:block; width:100%; border:1.5px solid #e2dfd6; border-radius:12px; background:#faf9f4; padding:10px 12px; font-size:16px; line-height:1.5; outline:none; resize:vertical; }
  .fld:focus { border-color:#e8743b; }
  .note { font-size:13px; color:var(--mute); padding:6px 16px 0; line-height:1.5; }
  .box { padding:12px 14px; display:flex; flex-direction:column; gap:10px; }
  .row2 { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .lnk { color:var(--accent); text-decoration:none; font-size:15px; }
  /* 孩子端首页本身:iframe 按孩子设备的尺寸开,等比缩到这一栏 */
  .pvh { display:flex; align-items:center; gap:10px; padding:0 4px 8px; }
  .pvh > span:first-child { flex:1; font-size:13px; color:var(--mute); }
  .pvh .seg { flex:none; width:150px; }
  .pvh .seg > * { height:30px; font-size:13px; }
  #pvbox { position:relative; margin:0 auto; border-radius:18px; overflow:hidden; background:#faf9f4; box-shadow:0 0 0 1px #e2dfd6, 0 10px 26px #2b2b2b14; }
  #pvf { position:absolute; left:0; top:0; border:0; transform-origin:0 0; background:#faf9f4; }
  #pvoff { position:absolute; left:0; right:0; top:0; padding:10px 14px; background:#2b2b2bdd; color:#fff; font-size:14px; text-align:center; display:none; z-index:2; }
  #pvoff.on { display:block; }
  #pv-under { display:flex; flex-direction:column; gap:14px; padding-top:14px; }
  .addb { height:46px; border:2px dashed #d9d5cc; border-radius:23px; background:transparent; color:var(--dim); font-size:15px; cursor:pointer; }
  /* 老师的先后:一位一个,按住左右拖;点一下看这位老师 */
  .ord { display:flex; gap:6px; overflow-x:auto; padding:2px; }
  .ch { position:relative; flex:0 0 84px; display:flex; flex-direction:column; align-items:center; gap:3px; padding:8px 0; border:2px solid transparent; border-radius:14px; background:transparent; font-size:13px; color:var(--dim); cursor:grab; touch-action:pan-y; user-select:none; -webkit-user-select:none; }
  .ch.on { background:#fff; border-color:var(--ink); color:var(--ink); font-weight:600; }
  .ch.hid .av { opacity:.4; }
  .ch small { font-size:11px; color:var(--mute); font-weight:400; }
  .ch .n { position:absolute; left:8px; top:6px; font-size:11px; color:var(--mute); font-weight:600; }
  .ch.drag { z-index:2; background:#fff; box-shadow:0 8px 20px #2b2b2b26; cursor:grabbing; }
  .ch.slide { transition:transform .15s; }
  .hint { padding:28px 20px; text-align:center; color:var(--dim); font-size:15px; line-height:1.6; }
  .btns { display:flex; gap:10px; align-items:center; }
  .btns .del { height:44px; padding:0 12px; border:0; background:transparent; color:var(--red); font-size:15px; cursor:pointer; }
  .btns .go { margin-left:auto; height:44px; padding:0 22px; border:0; border-radius:12px; background:var(--ink); color:#fff; font-size:15px; font-weight:600; cursor:pointer; }
  .btns .go:disabled { opacity:.35; }
  .x { height:44px; padding:0 10px; border:0; background:transparent; color:var(--accent); font-size:15px; cursor:pointer; }
  /* 改一个按钮 / 这周的词(窄屏):整屏盖上 */
  .sheet { position:fixed; inset:0; background:var(--paper); overflow:auto; z-index:10; display:none; }
  .sheet.on { display:block; }
  .nav { display:flex; align-items:center; justify-content:space-between; }
  .nav button { border:0; background:transparent; color:var(--accent); font-size:17px; min-height:44px; padding:0 4px; cursor:pointer; }
  .nav button:disabled { color:#c9c5bc; }
  .nav b { font-size:17px; }
  .danger { height:50px; border:0; border-radius:14px; background:#fff; color:var(--red); font-size:17px; cursor:pointer; }
  #toast { position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom) + 24px); transform:translateX(-50%); max-width:min(560px,calc(100% - 32px)); padding:12px 18px; border-radius:16px; background:#2b2b2bee; color:#fff; font-size:15px; display:none; z-index:20; white-space:pre-line; }
  #toast.on { display:block; }
  .main { display:flex; flex-direction:column; gap:18px; }
  /* 孩子的平板怎么打开:二维码(服务端现画);宽屏在右栏最上面,窄屏在预览上面 */
  #qrtop:empty { display:none; }
  .qrrow { display:flex; flex-direction:column; gap:10px; align-items:center; text-align:center; }
  .qrimg { flex:none; width:220px; height:220px; max-width:100%; border-radius:8px; box-shadow:0 0 0 1px var(--line); overflow:hidden; background:#fff; }
  .qrimg svg { display:block; width:100%; height:100%; }
  .qrurl { font:13px/1.4 ui-monospace,Menlo,monospace; background:#faf9f4; border-radius:8px; padding:8px 10px; overflow-wrap:anywhere; }
  .qrwarn { font-size:13px; color:var(--accent); line-height:1.5; }
  .gh .x { height:auto; padding:2px 0; font-size:13px; }
  /* 样子与声音:头像一格格点;两种声音各一行(现在用的),「换一个」开弹窗;宽屏在右栏,窄屏整屏 */
  .lk { display:flex; flex-direction:column; gap:16px; }
  .lk .nav b { font-size:16px; text-align:center; }
  .lksaved { min-width:56px; text-align:right; font-size:13px; color:var(--ok); }
  .lkbig { align-self:center; width:104px; height:104px; border-radius:50%; overflow:hidden; background:#fff3e8; box-shadow:0 0 0 4px #fff, 0 6px 18px #2b2b2b1f; display:grid; place-items:center; font-size:44px; font-weight:700; color:var(--accent); }
  .lkbig img { width:100%; height:100%; object-fit:cover; }
  .lkgrid { background:var(--card); border-radius:14px; padding:12px; display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:8px; }
  .lkopt { display:flex; flex-direction:column; align-items:center; gap:3px; min-height:44px; padding:8px 0 6px; border:2px solid transparent; border-radius:14px; background:transparent; cursor:pointer; }
  .lkopt.on { border-color:var(--ink); background:#fff; }
  .lkf { width:52px; height:52px; border-radius:50%; overflow:hidden; background:#faf9f4; display:grid; place-items:center; font-size:26px; font-weight:700; color:var(--dim); }
  .lkf img { width:100%; height:100%; object-fit:cover; }
  .lkopt small { font-size:11px; color:var(--mute); line-height:1.3; }
  /* 一个声音:圆里「女 / 男」,底色也分(不只靠颜色);标签:普通话 / 中文灰,方言橙,英文青,童声紫,场景描边 */
  .vface { flex:none; width:44px; height:44px; border-radius:50%; display:grid; place-items:center; font-size:16px; font-weight:700; background:#efece5; color:#5f5b54; }
  .vface.g-f { background:#fbe4e8; color:#9e2f4a; }
  .vface.g-m { background:#dfe9f6; color:#285a96; }
  .vtx { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; text-align:left; }
  .vnm { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
  .vnm b { font-size:16px; font-weight:600; }
  .vnm small, .vtr { font-size:13px; color:#5f5b54; }
  .vtags { display:flex; gap:5px; flex-wrap:wrap; }
  .vt { font-size:12px; line-height:20px; padding:0 7px; border-radius:6px; border:1px solid transparent; }
  .t-lang { background:#f1eee7; color:#5f5b54; }
  .t-dia { background:#fdecd3; color:#8a4b0b; }
  .t-en { background:#dcefee; color:#0f5f5c; }
  .t-kid { background:#ece6f8; color:#5b3fa0; }
  .t-line { background:#fff; color:#5f5b54; border-color:#e3dfd6; }
  .t-warn { background:#fff; color:#8a4b0b; border-color:#e2b877; }
  .vplay { flex:none; width:44px; height:44px; border-radius:50%; border:0; background:#f3efe6; color:var(--ink); display:grid; place-items:center; cursor:pointer; }
  .vplay.on { background:var(--accent); color:#fff; }
  .vcur { padding:12px 12px 12px 14px; display:flex; flex-direction:column; gap:8px; }
  .vcur + .vcur { border-top:1px solid var(--line); }
  .vcur > .lbl { font-size:13px; color:#5f5b54; }
  .vrow2 { display:flex; align-items:center; gap:12px; }
  .vchg { align-self:flex-end; display:inline-flex; align-items:center; gap:2px; min-height:44px; padding:0 10px 0 16px; border:0; border-radius:22px; background:#f3efe6; color:var(--ink); font-size:15px; cursor:pointer; }
  .vchg span { display:flex; }
  .vchg svg { width:16px; height:16px; }
  /* 选声音的弹窗:宽屏居中,窄屏从底下升起占满 */
  .vp { position:fixed; inset:0; z-index:30; background:rgba(30,28,25,.46); display:flex; align-items:center; justify-content:center; padding:24px; }
  .vpbox { width:100%; max-width:840px; height:min(788px, 100%); background:#fff; border-radius:20px; box-shadow:0 24px 60px rgba(20,18,15,.28); display:flex; flex-direction:column; overflow:hidden; outline:none; }
  .vphd { padding:18px 16px 0 24px; display:flex; align-items:flex-start; gap:12px; }
  .vphd .tx { flex:1; min-width:0; display:flex; flex-direction:column; }
  .vphd b { font-size:20px; font-weight:600; }
  .vphd small { font-size:13px; color:#5f5b54; }
  .vpx { flex:none; width:44px; height:44px; border-radius:50%; border:0; background:#f3efe6; color:var(--ink); display:grid; place-items:center; cursor:pointer; }
  .vpctl { padding:14px 24px 12px; display:flex; flex-direction:column; gap:10px; border-bottom:1px solid var(--line); }
  .vpctl .fld { padding:10px 14px; }
  #vp-f { display:flex; flex-direction:column; gap:8px; }
  .vpg { display:flex; align-items:flex-start; gap:10px; }
  .vpg .lbl { flex:none; width:36px; padding-top:6px; font-size:13px; color:#5f5b54; }
  .vpg .chips { flex:1; min-width:0; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { display:inline-flex; align-items:center; gap:4px; min-height:34px; padding:0 12px; border:1px solid #e3dfd6; border-radius:17px; background:#fff; color:var(--ink); font-size:14px; cursor:pointer; }
  .chip small { font-size:12px; color:#6b675f; }
  .chip.on { background:var(--ink); border-color:var(--ink); color:#fff; }
  .chip.on small { color:#e8e4dc; }
  .chip.more { color:var(--accent); border-style:dashed; }
  .vplist { flex:1; min-height:0; overflow-y:auto; padding:12px 24px 16px; background:#faf9f6; -webkit-overflow-scrolling:touch; }
  .vpgrid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; }
  .vcard { display:flex; align-items:flex-start; gap:8px; padding:12px 10px 12px 12px; border-radius:14px; background:#fff; border:2px solid #ece8df; }
  .vcard.on { background:#fffaf3; border-color:var(--accent); }
  .vcard .vpick { flex:1; min-width:0; display:flex; align-items:flex-start; gap:12px; border:0; background:transparent; padding:0; font:inherit; color:inherit; cursor:pointer; }
  .vpnone { padding:60px 0; display:flex; flex-direction:column; align-items:center; gap:10px; color:#5f5b54; }
  .vpft { padding:12px 16px 12px 24px; border-top:1px solid var(--line); display:flex; align-items:center; gap:10px; }
  #vp-st { flex:1; min-width:0; font-size:13px; color:#5f5b54; }
  .vpno { min-height:44px; padding:0 18px; border:0; border-radius:22px; background:#f3efe6; color:var(--ink); font-size:15px; cursor:pointer; }
  .vpgo { min-height:44px; padding:0 22px; border:0; border-radius:22px; background:var(--accent); color:#fff; font-size:15px; font-weight:600; cursor:pointer; }
  .vpgo:disabled { background:#ece8df; color:#6b675f; cursor:default; }
  @media (max-width:700px) {
    .vp { padding:40px 0 0; align-items:stretch; }
    .vpbox { max-width:none; height:100%; border-radius:20px 20px 0 0; }
    .vphd { padding:14px 8px 0 16px; }
    .vphd b { font-size:18px; }
    .vpctl { padding:10px 16px; }
    #vp-f { gap:6px; }
    .vpg { align-items:center; gap:8px; }
    .vpg .lbl { padding-top:0; width:28px; }
    .vpg .chips { flex-wrap:nowrap; overflow-x:auto; margin-right:-16px; padding:0 16px 2px 0; }
    .chip { flex:none; }
    .vplist { padding:10px 12px 14px; }
    .vpgrid { grid-template-columns:minmax(0, 1fr); gap:8px; }
    .vpft { flex-wrap:wrap; padding:10px 16px calc(14px + env(safe-area-inset-bottom)); }
    #vp-st { flex:1 0 100%; text-align:center; font-size:12px; }
    .vpno { flex:1; }
    .vpgo { flex:2; min-height:48px; }
  }
  /* 百炼没配:孩子那边打不开,这块放在右栏最上面 */
  .grp.warn { background:#fff3e8; }
  .grp.warn .it, .grp.warn .box { background:transparent; }
  .lbl { font-size:13px; color:var(--dim); }
  .err { font-size:14px; color:var(--red); }
  #body > div { display:flex; flex-direction:column; gap:18px; }
  @media (min-width:1000px) {
    .wrap { max-width:1180px; padding:calc(env(safe-area-inset-top) + 22px) 28px 40px; gap:20px; }
    .top { align-items:center; justify-content:flex-start; }
    .top .seg { order:0; flex:0 0 260px; }
    .top small { margin-left:auto; }
    .top .devl { margin-left:0; height:34px; padding:0 12px; font-size:14px; }
    .main { display:grid; grid-template-columns:minmax(0,1fr) 380px; gap:22px; align-items:start; }
    .gh { padding:0 6px 6px; }
  }
  .upd { position:relative; display:flex; flex-direction:column; gap:6px; margin:0 0 12px; padding:12px 14px; border-radius:14px; background:var(--card); box-shadow:0 0 0 1px var(--line); font-size:15px; }
  .upd.bad { box-shadow:0 0 0 1px var(--accent); }
  .setup { position:relative; display:flex; flex-direction:column; gap:2px; margin:0 0 12px; padding:12px 14px; border-radius:14px; background:var(--card); box-shadow:0 0 0 1px var(--line); font-size:15px; }
  .setup > b { padding-right:64px; }
  .setup .sp { display:flex; gap:10px; padding:8px 0; border-top:1px solid var(--line); }
  .setup .sp:first-of-type { border-top:0; }
  .setup .mk { flex:none; width:20px; text-align:center; color:var(--dim); }
  .setup .sp.on .mk { color:var(--accent); }
  .setup .sp.on b { font-weight:500; color:var(--dim); }
  .setup .tx { display:flex; flex-direction:column; gap:4px; min-width:0; flex:1; }
  .setup small { color:var(--dim); font-size:14px; line-height:1.5; }
  .setup pre { margin:2px 0 0; padding:10px 12px; border-radius:10px; background:var(--paper); font:13px/1.6 ui-monospace,Menlo,Consolas,monospace; white-space:pre-wrap; overflow-wrap:anywhere; user-select:all; -webkit-user-select:all; }
  .setup .gr { display:flex; flex-wrap:wrap; gap:6px; margin-top:2px; }
  .setup .gr button { min-height:44px; padding:0 12px; border:0; border-radius:10px; background:var(--paper); box-shadow:0 0 0 1px var(--line); color:inherit; font-size:15px; cursor:pointer; }
  .setup .hide { position:absolute; top:6px; right:6px; min-height:44px; padding:0 10px; border:0; background:transparent; color:var(--accent); font-size:15px; cursor:pointer; }
  .upd ul { margin:0; padding-left:18px; font-size:14px; }
  .upd .sub { color:var(--dim); font-size:14px; padding-right:64px; }
  .upd pre { margin:2px 0 0; padding:10px 12px; border-radius:10px; background:var(--paper); font:13px/1.6 ui-monospace,Menlo,Consolas,monospace; white-space:pre-wrap; overflow-wrap:anywhere; user-select:all; -webkit-user-select:all; }
  .upd button { position:absolute; top:6px; right:6px; min-height:44px; padding:0 10px; border:0; background:transparent; color:var(--accent); font-size:15px; cursor:pointer; }
</style></head><body>
<div class="wrap" id="main">
  <div class="top"><span class="ttl"><span id="ct-mark" class="ct-draw ct-hover">${titleLogo(true)}</span><b id="title">家长</b></span><nav class="seg"><a class="on" href="/parent/home">首页</a><a href="/parent">记录</a><a href="/parent/settings">设置</a></nav><small id="pub"></small><a class="devl" href="/dev" target="_blank" title="工作台:细调老师文件、activity(新窗口)">工作台<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 2h6v6"/><path d="M10 2 3 9"/></svg></a></div>
  <div id="troublebar"></div>
  <div id="setupbar"></div>
  <div id="updatebar"></div>
  <div id="qrtop"></div>
  <div class="main">
    <section id="pv" aria-label="孩子看到的首页">
      <div class="pvh"><span>孩子看到的首页 · 点牌上的按钮改它,点后面那张换老师</span><span class="seg" id="pvdev"><button type="button" data-d="tablet">iPad</button><button type="button" data-d="phone">手机</button></span></div>
      <div id="pvbox"><div id="pvoff"></div><iframe id="pvf" title="孩子看到的首页"></iframe></div>
      <div id="pv-under"></div>
    </section>
    <div id="body"></div>
  </div>
  ${BRAND_FOOTER}
</div>
<div class="sheet" id="sheet"><div class="wrap" id="sheet-in"></div></div>
<div id="toast"></div>
<script>
(() => {
${BRAND_JS}
  // $ / h / toast / api(page-dom.ts,几页共用)
${pageDomJs(3200)}
  const CHEV = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>';
  const GRIP = '<svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true"><g fill="currentColor"><circle cx="4" cy="4" r="1.6"></circle><circle cx="10" cy="4" r="1.6"></circle><circle cx="4" cy="9" r="1.6"></circle><circle cx="10" cy="9" r="1.6"></circle><circle cx="4" cy="14" r="1.6"></circle><circle cx="10" cy="14" r="1.6"></circle></g></svg>';
  const PLAY = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="currentColor"></path></svg>';
  const AGAIN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7"></path><path d="M20 4v5h-5"></path></svg>';
  // 学科色服务端定好随老师下发(src/ui/shared/tutor-color.ts)
  const avatar = (t) => { const el = h('span', { class: 'av', style: 'color:' + t.color }); el.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"></circle></svg>'; const f = h('span', { class: 'face' }); if (t.avatar && /\.(png|jpe?g|webp|svg)$/i.test(t.avatar)) f.append(h('img', { src: '/api/kid/avatar/' + t.name, alt: '' })); else f.textContent = t.avatar || (t.subject || t.display || '?').slice(0, 1); el.append(f); return el; };
  // 方砖在「每天都在」里的那句:点进去老师怎么带(参数都空着,老师先请孩子拍材料)
  const TILE_NOTE = { preview: '孩子拍新课的那页,老师带着先读一读、问一问', check: '作业写完拍给老师,一次看一处、改一处', review: '学过的拿出来,挑一点再练一练' };
  const sw = (on, label, click, disabled) => h('button', { type: 'button', class: 'sw', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label, disabled: disabled || null, on: { click } });
  const md = (d) => Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10));
  // 留多久:只今天 = 今天;到周日 = 这周日(今天是周日就是今天);一直 = 不写
  const sunday = (today) => { const [y, m, d] = today.split('-').map(Number); const t = new Date(y, m - 1, d); t.setDate(t.getDate() + ((7 - t.getDay()) % 7)); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
  const BUTTONS_MAX = 4;
  const WIDE = window.matchMedia('(min-width:1000px)');

  let D = null; let cur = null;
  /** 在改哪一个按钮(宽屏右栏):下标;-1 = 新加的开场按钮;null = 没选 */
  let sel = null;
  /** 右栏的表单改了还没发:这时别让心跳重画把字抹掉 */
  let dirty = false;
  /** 预览里改着的(只在预览里,发布了才到孩子那边):edit = 改的那颗 {k, kind, label, until},add = 新加那颗的字 */
  let draft = { edit: null, add: null };

  // ---- 孩子端首页本身:iframe 装 /preview,按孩子设备的尺寸开,等比缩进来 ----
  const SIZES = { tablet: [1180, 820], phone: [390, 844] };
  // 缺省跟着这块屏幕(宽屏看 iPad 的样子、手机看手机的);家长点过就记住
  let picked = null; try { picked = localStorage.getItem('parent-home-dev'); } catch (e) {}
  if (picked !== 'tablet' && picked !== 'phone') picked = null;
  let dev = picked || (WIDE.matches ? 'tablet' : 'phone');
  const fit = () => {
    const box = $('#pvbox'), f = $('#pvf'), wh = SIZES[dev], room = $('#pv').clientWidth;
    const k = Math.min(1, room / wh[0], (dev === 'phone' ? 640 : 2000) / wh[1]);
    box.style.width = Math.round(wh[0] * k) + 'px'; box.style.height = Math.round(wh[1] * k) + 'px';
    f.style.width = wh[0] + 'px'; f.style.height = wh[1] + 'px'; f.style.transform = 'scale(' + k + ')';
    for (const b of document.querySelectorAll('#pvdev button')) b.classList.toggle('on', b.dataset.d === dev);
  };
  const pvSet = (o) => { try { const w = $('#pvf').contentWindow; if (w && typeof w.cotutorPreviewSet === 'function') w.cotutorPreviewSet(o); } catch (e) {} };
  /** 告诉预览:最前那张是谁、在改哪颗、改成什么;reload = 发布了,重读孩子的首页 */
  const pvSync = (reload) => pvSet({ front: cur, pv: cur ? { tutor: cur, sel: sel === null ? null : sel === -1 ? 'draft' : sel, edit: draft.edit, add: draft.add } : null, reload: Boolean(reload) });
  // 预览里点了什么(孩子端页面经 window.parent.cotutorPreview 说):换老师、改哪颗、去改这周的词 / 口语课
  window.cotutorPreview = (ev) => {
    if (!ev || !D) return;
    if (ev.act === 'ready') { pvSync(); return; }
    const t = D.tutors.find((x) => x.name === ev.tutor);
    if (!t) return;
    if (t.name !== cur) choose(t.name, true);
    if (ev.act === 'button') { if (ev.id === 'new') toast('「新话题」是应用自己加的,一直在第一个,这里改不了'); else if (typeof ev.id === 'number') pick(ev.id); }
    else if (ev.act === 'tile') { const el = $('#daily-tile-' + ev.id); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    else if (ev.act === 'extra') { if (ev.kind === 'dictation') editWords(t); else { const el = $('#daily-talk'); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
  };
  for (const b of document.querySelectorAll('#pvdev button')) b.addEventListener('click', () => { dev = picked = b.dataset.d; try { localStorage.setItem('parent-home-dev', dev); } catch (e) {} fit(); });
  window.addEventListener('resize', fit);

  // ---- 百炼:老师开口靠它,没配孩子那边打不开。一块常驻的元素,重画只挪它的位置,输着的 key 不会被抹掉 ----
  const BL = { st: null, open: false, opened: false, busy: false, msg: '' };
  const blEl = h('div', { id: 'bailian' });
  const blKey = h('input', { class: 'fld', id: 'bl-key', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk- 开头' });
  const blWs = h('input', { class: 'fld', id: 'bl-ws', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', placeholder: '如 llm-xxxxxxxx' });
  const blSave = async () => {
    BL.busy = true; BL.msg = ''; blDraw();
    try { BL.st = await api('PUT', '/api/parent/bailian', { key: blKey.value, workspaceId: blWs.value }); blKey.value = ''; BL.open = false; toast('连上了,存好了。孩子那边几秒内就能用'); BL.busy = false; await load(); pvSync(true); return; }
    catch (e) { BL.msg = e.message; }
    BL.busy = false; blDraw();
  };
  const blTest = async () => {
    BL.busy = true; blDraw();
    try { const r = await api('POST', '/api/parent/bailian/test'); toast(r.ok ? '通的(' + (r.ms / 1000).toFixed(1) + ' 秒)' : '没通:' + r.message); }
    catch (e) { toast('没试成:' + e.message); }
    BL.busy = false; blDraw();
  };
  const blDraw = () => {
    const st = BL.st;
    if (!st) { blEl.replaceChildren(); return; }
    const rows = [];
    if (st.ready) rows.push(h('div', { class: 'it' }, h('span', { class: 'tx' }, h('b', {}, '配好了'), h('small', {}, (st.keyTail ? 'key …' + st.keyTail + ' · 业务空间 ' + st.workspaceId : '测试用的假百炼'))),
      h('button', { type: 'button', class: 'x', disabled: BL.busy || null, on: { click: blTest } }, BL.busy && !BL.open ? '在试…' : '试连'),
      st.canEdit ? h('button', { type: 'button', class: 'x', on: { click: () => { BL.open = !BL.open; BL.msg = ''; blDraw(); } } }, BL.open ? '收起' : '换一把') : null));
    else rows.push(h('div', { class: 'box' }, h('b', {}, '还没配,孩子那边打不开'), h('div', { class: 'note', style: 'padding:0' }, '老师开口和想讲稿都走百炼,要百炼「按量付费」的 API key(控制台「密钥管理」里创建)和业务空间 id(控制台的业务空间详情里看);Token Plan 的 sk-sp- 不行。存在这台电脑上,不进孩子的 cotutor 文件夹。')));
    if (!st.ready || BL.open) {
      if (!st.canEdit) rows.push(h('div', { class: 'box' }, h('div', { class: 'note', style: 'padding:0' }, '先设家长密码:在电脑上跑 cotutor pin;或者在这台电脑上打开家长端来配。')));
      else rows.push(h('div', { class: 'box' }, h('label', { class: 'lbl', for: 'bl-key' }, 'API key'), blKey, h('label', { class: 'lbl', for: 'bl-ws' }, '业务空间 id'), blWs,
        BL.msg ? h('div', { class: 'err' }, BL.msg) : null,
        h('div', { class: 'btns' }, h('button', { type: 'button', class: 'go', disabled: BL.busy || null, on: { click: blSave } }, BL.busy ? '在试连…' : '试连,通了就存'))));
    }
    blEl.replaceChildren(h('div', { class: 'gh' }, h('span', {}, '百炼 · 老师开口用的')), h('div', { class: 'grp' + (st.ready ? '' : ' warn') }, ...rows));
  };

  // ---- 扫码打开:孩子的平板一张(孩子端)、家长自己的手机一张(家长端);服务端现画,地址同 /parent/qr。还没有孩子的设备连过就开着,连过收起;家长开合过就记住 ----
  const QR = { d: null, ip: false, open: null, to: 'kid' };
  try { const v = localStorage.getItem('parent-home-qr'); if (v === 'open' || v === 'closed') QR.open = v === 'open'; } catch (e) {}
  const qrEl = h('div', { id: 'kidqr' });
  const qrToggle = (open) => { QR.open = open; try { localStorage.setItem('parent-home-qr', open ? 'open' : 'closed'); } catch (e) {} qrDraw(); };
  const qrWhen = (iso) => { const t = new Date(iso); if (Number.isNaN(t.getTime())) return ''; const day = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); return (D && day === D.today ? '今天 ' : md(day) + ' ') + t.toTimeString().slice(0, 5); };
  const QR_ICON = '<svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="9" height="9" rx="1.5"></rect><rect x="18" y="3" width="9" height="9" rx="1.5"></rect><rect x="3" y="18" width="9" height="9" rx="1.5"></rect><path d="M18 18h3v3h-3zM24 24h3v3h-3zM24 18h3M18 24v3" stroke-linecap="round"></path></svg>';
  const host = (u) => u.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const qrDraw = () => {
    const d = QR.d;
    if (!d || !d.ready) { qrEl.replaceChildren(); return; }
    const open = QR.open === null ? d.devices === 0 : QR.open;
    const seen = d.devices ? '孩子的平板 ' + d.devices + ' 台连过 · 上次' + qrWhen(d.last) : '还没有平板连过';
    if (!open) {
      qrEl.replaceChildren(h('div', { class: 'grp' }, h('button', { type: 'button', class: 'it', 'aria-expanded': 'false', on: { click: () => qrToggle(true) } },
        h('span', { style: 'flex:none;display:flex', html: QR_ICON }), h('span', { class: 'tx' }, h('b', {}, '扫码打开'), h('small', {}, seen)), h('span', { class: 'lnk', style: 'font-size:14px' }, '展开'))));
      return;
    }
    if (QR.to === 'ca' && !d.ca) QR.to = 'kid';
    const kid = QR.to === 'kid', ca = QR.to === 'ca', c = kid ? d : ca ? d.ca : (d.parent || d);
    const useIp = QR.ip && c.ip;
    // 装证书(serve.ts 的 http 那一面给根证书):平板第一次用之前扫一次;有证书、找得到根证书才有这一格
    const tabs = [['kid', '孩子的平板'], ['parent', '我的手机']].concat(d.ca ? [['ca', '装证书']] : []);
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '给谁扫' }, ...tabs.map(([k, l]) =>
      h('button', { type: 'button', class: QR.to === k ? 'on' : '', 'aria-pressed': QR.to === k ? 'true' : 'false', on: { click: () => { QR.to = k; qrDraw(); } } }, l)));
    const print = '/parent/qr?' + new URLSearchParams(Object.assign({}, useIp ? { via: 'ip' } : {}, kid ? {} : { to: 'parent' })).toString();
    qrEl.replaceChildren(
      h('div', { class: 'gh' }, h('span', {}, '扫码打开'), h('button', { type: 'button', class: 'x', 'aria-expanded': 'true', on: { click: () => qrToggle(false) } }, '收起')),
      h('div', { class: 'grp' }, h('div', { class: 'box' }, seg,
        h('div', { class: 'qrrow' }, h('div', { class: 'qrimg', html: (useIp ? c.svgIp : c.svg) || '' }),
          h('b', { style: 'font-weight:600' }, kid ? '用孩子平板的相机扫一下' : ca ? '平板第一次用:先扫这张装证书' : '用你自己的手机扫一下'),
          h('span', { class: 'lbl', style: 'line-height:1.5' }, kid ? '打开的就是孩子的首页。在 Safari 里「添加到主屏幕」,以后点图标就进来。' : ca ? '扫了点「允许」下载描述文件;到「设置」最上面点「已下载描述文件」装上;再到「设置 › 通用 › 关于本机 › 证书信任设置」把开关打开。装好再扫「孩子的平板」那张。每台平板做一次。' : '打开的是家长端:看记录、排首页。也可以添加到主屏幕。')),
        h('div', { class: 'qrurl' }, useIp ? c.ip : c.url),
        d.https ? null : h('div', { class: 'qrwarn' }, d.notes[0] || ''),
        h('div', { class: 'row2', style: 'font-size:14px' },
          c.ip ? h('button', { type: 'button', class: 'x', style: 'height:auto;padding:0;font-size:14px;text-align:left', on: { click: () => { QR.ip = !QR.ip; qrDraw(); } } }, useIp ? '换回 ' + host(c.url) : '扫了打不开?换成 ' + host(c.ip)) : h('span'),
          h('span', { style: 'display:flex;gap:14px;flex:none' },
            h('a', { class: 'lnk kidl', style: 'font-size:14px', href: '/', target: '_blank' }, '孩子端 ↗'),
            ca ? null : h('a', { class: 'lnk', style: 'font-size:14px', href: print, target: '_blank' }, '打印 ›'))))),
      h('div', { class: 'note' }, d.https ? (d.notes[0] || '') : '', d.devices ? '' : (d.https ? ' ' : '') + '还没有平板连进来过,所以这块先开着;连过以后自动收起。'));
  };

  // 有新版本(服务每天问一次 npm,machine/update.ts):只在家长端说,孩子端不说;点「知道了」这个版本不再提,读不了 localStorage 就每次都说
  const UPGRADE_STEPS = ${JSON.stringify(upgradeSteps())};
  // 还差几步(parent-setup.ts):第一次打开家长端,告诉家长接下来做什么。必需的都好了就只剩建议,「知道了」以后不再提
  const showSetup = async () => {
    const box = $('#setupbar');
    const d = await api('GET', '/api/parent/setup').catch(() => null);
    if (!d) { box.replaceChildren(); return; }
    let hidden = false;
    try { hidden = localStorage.getItem('cotutor.setupHidden') === '1'; } catch {}
    const must = d.steps.filter((s) => s.required);
    const left = must.filter((s) => !s.done);
    const extra = d.steps.filter((s) => !s.required && !s.done);
    if (!left.length && (hidden || !extra.length)) { box.replaceChildren(); return; }
    const pickGrade = async (g) => {
      try { await api('POST', '/api/parent/setup/grade', { grade: g }); toast('记下了:' + g + ' 年级'); } catch (e) { toast(e.message); }
      showSetup();
    };
    const row = (s) => h('div', { class: 'sp' + (s.done ? ' on' : '') },
      h('span', { class: 'mk' }, s.done ? '✓' : '○'),
      h('span', { class: 'tx' }, h('b', {}, s.title),
        s.done ? null : h('small', {}, s.detail, s.link ? ' ' : null, s.link ? h('a', { class: 'lnk', href: s.link.href, target: '_blank', rel: 'noopener' }, s.link.text) : null),
        !s.done && s.commands ? h('pre', {}, s.commands.map((c) => h('div', {}, c))) : null,
        !s.done && s.grades ? h('span', { class: 'gr' }, [1, 2, 3, 4, 5, 6].map((g) => h('button', { type: 'button', on: { click: () => pickGrade(g) } }, g + ' 年级'))) : null));
    box.replaceChildren(h('div', { class: 'setup' },
      h('b', {}, left.length ? '还差 ' + left.length + ' 步,孩子就能用了' : '都好了,还有几件可以做的'),
      ...(left.length ? must.concat(extra) : extra).map(row),
      left.length ? null : h('button', { type: 'button', class: 'hide', on: { click: () => { try { localStorage.setItem('cotutor.setupHidden', '1'); } catch {} box.replaceChildren(); } } }, '知道了')));
  };
  // 跑起来以后百炼出的问题(欠费、key 失效、连不上,machine/bailian.ts):配好了不等于用得了。试连通了就没了
  const showTrouble = (hh) => {
    const box = $('#troublebar');
    const t = hh && hh.bailianTrouble;
    if (!t) { box.replaceChildren(); return; }
    box.replaceChildren(h('div', { class: 'upd bad' },
      h('b', {}, t.message),
      h('span', { class: 'sub' }, t.fix + (t.blocked ? ' 现在孩子那边显示「老师们还没到」。' : '')),
      t.why ? h('small', { class: 'sub' }, '百炼说:' + t.why) : null,
      h('button', { type: 'button', on: { click: async () => {
        try { const r = await api('POST', '/api/parent/bailian/test'); toast(r.ok ? '通了' : '还是没通:' + r.message); } catch (e) { toast('没试成:' + e.message); }
        load();
      } } }, '试连')));
  };
  const showUpdate = async () => {
    const box = $('#updatebar');
    const hh = await api('GET', '/api/health').catch(() => null);
    showTrouble(hh);
    const latest = hh && hh.latest;
    let seen = null;
    try { seen = localStorage.getItem('cotutor.updateSeen'); } catch {}
    if (!latest || seen === latest) { box.replaceChildren(); return; }
    box.replaceChildren(h('div', { class: 'upd' },
      h('b', {}, '有新版本 ' + latest),
      h('span', { class: 'sub' }, '现在是 ' + hh.version + (hh.latestNotes && hh.latestNotes.length ? '。这次改了:' : '。')),
      hh.latestNotes && hh.latestNotes.length ? h('ul', {}, hh.latestNotes.map((n) => h('li', {}, n))) : null,
      h('span', { class: 'sub' }, '挑孩子不用的时候,在这台电脑的终端里运行(服务会重起,孩子在通话时不会动):'),
      h('pre', {}, UPGRADE_STEPS.map((s) => h('div', {}, s))),
      h('button', { type: 'button', on: { click: () => { try { localStorage.setItem('cotutor.updateSeen', latest); } catch {} box.replaceChildren(); } } }, '知道了')));
  };
  const load = async () => {
    showUpdate();
    showSetup();
    try { D = await api('GET', '/api/parent/home'); } catch (e) { toast('读不到:' + e.message); return; }
    BL.st = await api('GET', '/api/parent/bailian').catch(() => null);
    QR.d = await api('GET', '/api/parent/qr').catch(() => null);
    document.title = D.title + ' · 家长';
    $('#title').textContent = D.title;
    $('#pub').textContent = D.home ? md(D.home.publishedAt.slice(0, 10)) + ' ' + new Date(D.home.publishedAt).toTimeString().slice(0, 5) + ' 发布 · 改了马上到孩子的首页' : '还没发布过';
    if (!cur || !D.tutors.some((t) => t.name === cur)) { const first = D.tutors.find((t) => !t.hidden) || D.tutors[0]; cur = first && first.name; sel = null; draft = { edit: null, add: null }; }
    if (!$('#pvf').getAttribute('src')) $('#pvf').setAttribute('src', '/preview?front=' + encodeURIComponent(cur || ''));
    render();
  };
  const save = async (method, path, body, ok) => {
    try { const r = await api(method, path, body); if (ok) toast(ok); draft = { edit: null, add: null }; return r; }
    catch (e) { toast('没改成:' + e.message); return null; }
    finally { await load(); pvSync(true); }
  };
  const tutorOf = () => D.tutors.find((t) => t.name === cur);
  /** 看哪位老师;fromPreview = 预览里换过去的,不用再告诉它 */
  const choose = (name, fromPreview) => { if (name === cur) return; cur = name; sel = null; lookStop(); LOOK.open = null; dirty = false; draft = { edit: null, add: null }; render(); if (!fromPreview) pvSync(); };
  /** 改第 k 颗(-1 = 加一个):宽屏在右栏,窄屏整屏的表单 */
  const pick = (k) => {
    const t = tutorOf(); if (!t) return;
    if (!WIDE.matches) { editButton(t, k); return; }
    sel = k; lookStop(); LOOK.open = null; dirty = false; draft = { edit: null, add: null }; render();
    setTimeout(() => { const el = $('#b-label'); if (el) el.focus(); }, 50);
  };
  const setExtras = (t, kind, on) => {
    const now = t.extras.filter((x) => x !== kind);
    if (on) now.push(kind);
    return save('PATCH', '/api/parent/settings', { tutors: { [t.name]: { extras: now } } });
  };
  const putOrder = (names) => save('PUT', '/api/parent/home/order', { tutors: names });

  // ---- 老师的先后:一位一个,按住左右拖;点一下看这位老师;左右键也能挪 ----
  const orderRow = () => {
    const box = h('div', { class: 'ord' });
    const chips = D.tutors.map((t, i) => {
      const c = h('button', { type: 'button', class: 'ch' + (t.name === cur ? ' on' : '') + (t.hidden ? ' hid' : ''), 'data-tutor': t.name, 'aria-label': t.display + ' 排第 ' + (i + 1) + '(左右键挪)' }, h('span', { class: 'n' }, String(i + 1)), avatar(t), t.display.replace(/老师$/, ''), t.hidden ? h('small', {}, '不在首页') : null);
      // 键盘回车 / 空格(detail 0)是点;手指与鼠标的点在 pointerup 里分辨(没拖才算)
      c.addEventListener('click', (e) => { if (e.detail === 0) choose(t.name); });
      c.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        if (!d || i + d < 0 || i + d >= D.tutors.length) return;
        e.preventDefault();
        const names = D.tutors.map((x) => x.name); [names[i], names[i + d]] = [names[i + d], names[i]];
        putOrder(names).then(() => { const g = document.querySelectorAll('.ord .ch')[i + d]; if (g) g.focus(); });
      });
      c.addEventListener('pointerdown', (e) => startDrag(e, c, i, chips));
      return c;
    });
    box.append(...chips);
    return box;
  };
  const startDrag = (e, el, from, all) => {
    const x0 = e.clientX, step = el.getBoundingClientRect().width + 6;
    let to = from, moved = false;
    const onMove = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 8) return;
      if (!moved) { moved = true; try { el.setPointerCapture(e.pointerId); } catch (x) {} el.classList.add('drag'); for (const r of all) if (r !== el) r.classList.add('slide'); }
      to = Math.max(0, Math.min(all.length - 1, from + Math.round(dx / step)));
      el.style.transform = 'translateX(' + dx + 'px)';
      all.forEach((r, j) => { if (r === el) return; const sh = from < to && j > from && j <= to ? -step : from > to && j < from && j >= to ? step : 0; r.style.transform = sh ? 'translateX(' + sh + 'px)' : ''; });
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
      if (!moved) { choose(D.tutors[from].name); return; }
      if (to === from) { for (const r of all) { r.style.transform = ''; r.classList.remove('drag', 'slide'); } return; }
      const names = D.tutors.map((x) => x.name); const n = names.splice(from, 1)[0]; names.splice(to, 0, n);
      // 拖的是谁就看谁:预览里他抽到最前,能看到排过之后的牌堆
      cur = n; sel = null; dirty = false; draft = { edit: null, add: null };
      putOrder(names);
    };
    el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
  };

  const render = () => {
    fit();
    const t = tutorOf();
    const off = $('#pvoff');
    off.classList.toggle('on', Boolean(t && t.hidden));
    off.textContent = t && t.hidden ? t.display + '现在不在孩子的首页上(「在孩子的首页上」打开)' : '';
    // 预览下面:老师的先后、孩子看不到的按钮、加一个开场按钮
    const under = [h('div', {}, h('div', { class: 'gh' }, h('span', {}, '老师的先后 · 按住左右拖,排第一的在最前')), orderRow())];
    if (t) {
      const gone = t.buttons.map((b, k) => ({ b, k })).filter((x) => x.b.until && x.b.until < D.today);
      if (gone.length) under.push(h('div', {}, h('div', { class: 'gh' }, h('span', {}, '孩子现在看不到的按钮(留到的日子过了)')), h('div', { class: 'grp' }, ...gone.map((x) => h('button', { type: 'button', class: 'it', on: { click: () => pick(x.k) } }, h('span', { class: 'tx' }, h('b', {}, x.b.label), x.b.brief ? h('small', {}, '讲法:' + x.b.brief) : null), h('span', { class: 'tag' }, '过了'), h('span', { class: 'chev', html: CHEV }))))));
      if (t.buttons.length < BUTTONS_MAX) under.push(h('button', { type: 'button', class: 'addb', on: { click: () => pick(-1) } }, '+ 给' + t.display + '加一个开场按钮'));
    }
    $('#pv-under').replaceChildren(...under);
    if (!t) { blDraw(); $('#body').replaceChildren(h('div', {}, blEl, h('p', { class: 'note' }, '还没有老师(cotutor.json 里 -tutor 结尾、开着的)'))); return; }
    const wide = WIDE.matches;
    // 每天都在
    const has = (k) => t.extras.includes(k);
    const daily = [];
    // 方砖:预习、检查作业、复习,老师家里有那个 activity 文件的才列;关掉就是孩子牌上不出那一块
    for (const x of t.tiles || []) daily.push(h('div', { class: 'it', id: 'daily-tile-' + x.id }, h('span', { class: 'tx' }, h('b', {}, x.label), h('small', {}, x.usable ? TILE_NOTE[x.id] : '「' + x.label + '」那份 activity 文件写坏了,孩子那边先不出(工作台看)')), sw(x.on, x.label, () => save('PATCH', '/api/parent/settings', { tutors: { [t.name]: { tiles: { [x.id]: !x.on } } } }))));
    daily.push(h('div', { class: 'it' }, h('span', { class: 'tx' }, h('b', {}, '听写'), h('small', {}, '拍照听写一直在;设了这周的词,孩子点「听写」直接写')), sw(has('dictation'), '听写', () => setExtras(t, 'dictation', !has('dictation')))));
    if (has('dictation') || t.dictation) daily.push(h('button', { type: 'button', class: 'it', on: { click: () => editWords(t) } }, h('span', { class: 'tx' }, h('b', {}, '这周的词'), h('small', {}, t.dictation && t.dictation.length ? t.dictation.length + ' 个词:' + t.dictation.map((w) => w.chars).join('、') : '还没设')), h('span', { class: 'chev', html: CHEV })));
    daily.push(h('div', { class: 'it', id: 'daily-talk' }, h('span', { class: 'tx' }, h('b', {}, '口语课'), h('small', {}, D.talk.enabled ? '孩子自己拍今天学的那页,先跟读再打电话' : '口语课没开(cotutor.json 的 talk.enabled)')), sw(has('talk'), '口语课', () => setExtras(t, 'talk', !has('talk')), !D.talk.enabled && !has('talk'))));
    if (has('talk')) {
      const note = h('textarea', { class: 'fld', rows: '3', placeholder: '这周学什么、想让老师多聊什么(孩子看不到)' }); note.value = D.talk.note;
      const mins = h('b', {}, String(D.talk.minutes));
      daily.push(h('div', { class: 'box' },
        h('label', { class: 'note', style: 'padding:0' }, '给老师的话(跟读和聊都带上;所有口语课一份)'), note,
        h('div', { class: 'row2' }, h('span', {}, '聊几分钟'), h('span', { class: 'step' }, h('button', { type: 'button', 'aria-label': '少一分钟', on: { click: () => save('PATCH', '/api/parent/settings', { talk: { minutes: Math.max(1, D.talk.minutes - 1) } }) } }, '−'), mins, h('button', { type: 'button', 'aria-label': '多一分钟', on: { click: () => save('PATCH', '/api/parent/settings', { talk: { minutes: Math.min(20, D.talk.minutes + 1) } }) } }, '+'))),
        h('div', { class: 'row2' }, h('a', { class: 'lnk', href: '/parent' }, '看回放 ›'), h('button', { type: 'button', class: 'step', style: 'border:0;background:transparent;color:var(--accent);cursor:pointer', on: { click: () => save('PATCH', '/api/parent/settings', { talk: { note: note.value } }, '存好了') } }, '存给老师的话'))));
    }
    const extras = h('div', {}, h('div', { class: 'gh' }, h('span', {}, '每天都在 · ' + t.display)), h('div', { class: 'grp' }, ...daily));
    const self = h('div', {}, h('div', { class: 'gh' }, h('span', {}, '这位老师 · ' + t.display)), h('div', { class: 'grp' },
      h('button', { type: 'button', class: 'it', on: { click: () => openLook(t) } }, avatar(t), h('span', { class: 'tx' }, h('b', {}, '样子与声音'), h('small', {}, '说话:' + t.voices.mouth + ' · 点读:' + (t.voices.card || '没配'))), h('span', { class: 'chev', html: CHEV })),
      h('div', { class: 'it' }, h('span', { class: 'tx' }, h('b', {}, '在孩子的首页上')), sw(!t.hidden, '在首页上', () => save('PATCH', '/api/parent/settings', { tutors: { [t.name]: { hidden: !t.hidden } } })))));
    const pane = !wide ? null : LOOK.open === t.name ? lookPanel() : sel === null || (sel >= 0 && !t.buttons[sel])
      ? h('div', { class: 'grp hint' }, '点左边牌上的按钮,在这里改它的字和讲法;', h('br'), '改的时候牌上跟着变,点「发布」才到孩子那边。')
      : inlineForm(t, sel);
    blDraw();
    qrDraw();
    // 没配、key 或业务空间不对:要改的就是这一块,放最上面、展开,别让家长往下翻
    const blFix = BL.st && BL.st.trouble && (BL.st.trouble.kind === 'key' || BL.st.trouble.kind === 'space');
    if (blFix && BL.st.canEdit && !BL.opened) { BL.opened = true; BL.open = true; }
    const blTop = BL.st && (!BL.st.ready || blFix);
    if (wide) $('#qrtop').replaceChildren(); else $('#qrtop').replaceChildren(qrEl);
    $('#body').replaceChildren(h('div', {}, blTop ? blEl : null, wide ? qrEl : null, pane, extras, self, blTop ? null : blEl));
  };

  // ---- 改一个按钮的表单(k = -1 是新加的开场按钮):窄屏整屏盖上,宽屏在右栏;预览里那颗跟着变 ----
  const buttonForm = (t, k, done) => {
    const b = k >= 0 ? Object.assign({}, t.buttons[k]) : { kind: 'start', label: '', until: D.today };
    const label = h('input', { class: 'fld', id: 'b-label', maxlength: '40', placeholder: '孩子的口吻,如「我要预习小蝌蚪找妈妈」' }); label.value = b.label;
    const brief = h('textarea', { class: 'fld', id: 'b-brief', rows: '5', placeholder: '写给老师的:从哪开始、重点是什么、讲到哪收' }); brief.value = b.brief || '';
    const count = h('span', {});
    const go = h('button', { type: 'button', class: 'go' }, '发布');
    const keeps = [['', '一直留着'], [D.today, '只今天'], [sunday(D.today), '到周日']];
    let keep = !b.until ? '' : b.until === D.today ? D.today : sunday(D.today);
    if (b.until && b.until !== D.today && b.until !== sunday(D.today)) keeps.push([b.until, '到 ' + md(b.until)]), keep = b.until;
    const seg = h('div', { class: 'seg' });
    const drawSeg = () => seg.replaceChildren(...keeps.map(([v, l]) => h('button', { type: 'button', class: v === keep ? 'on' : '', on: { click: () => { keep = v; dirty = true; drawSeg(); tell(); } } }, l)));
    const sync = () => { const n = Array.from(label.value.trim()).length; count.textContent = n + ' / 16'; count.style.color = n > 16 ? 'var(--red)' : ''; go.disabled = !n || n > 16; };
    // 预览里的那颗跟着变:改的换字,新加的排在最后;只在预览里,发布了才到孩子那边
    const tell = () => { const lb = label.value.trim(); draft = k >= 0 ? { edit: { k, kind: b.kind, label: lb || b.label, until: keep || undefined }, add: null } : { edit: null, add: lb || '(按钮上的字)' }; pvSync(); };
    label.addEventListener('input', () => { dirty = true; sync(); tell(); });
    brief.addEventListener('input', () => { dirty = true; });
    drawSeg(); sync(); tell();
    go.addEventListener('click', async () => {
      const nb = Object.assign({}, b, { label: label.value.trim(), brief: brief.value.trim() || undefined, until: keep || undefined });
      const list = k >= 0 ? t.buttons.map((x, j) => (j === k ? nb : x)) : t.buttons.concat([nb]);
      go.disabled = true; dirty = false;
      const r = await save('PUT', '/api/parent/home/tutors/' + encodeURIComponent(t.name) + '/buttons', { buttons: list }, '发布了');
      if (r) done(k >= 0 ? k : list.length - 1); else go.disabled = false;
    });
    const del = k >= 0 ? h('button', { type: 'button', class: 'del', on: { click: async () => { dirty = false; const r = await save('PUT', '/api/parent/home/tutors/' + encodeURIComponent(t.name) + '/buttons', { buttons: t.buttons.filter((_x, j) => j !== k) }, '删掉了'); if (r) done(null); } } }, '删掉这个按钮') : null;
    const what = b.kind === 'continue' ? '接着 ' + md(b.date) + ' 的话题 ' + b.thread : b.kind === 'lecture' ? '小课堂 ' + b.bundle : b.kind === 'activity' ? 'activity ' + b.activity : '';
    return {
      title: t.display + ' · ' + (k >= 0 ? '改按钮' : '开场按钮'), go, del, label,
      fields: [
        what ? h('div', { class: 'note' }, what + '(从编程助手排的,这里只改字和讲法)') : null,
        h('div', {}, h('div', { class: 'gh' }, h('label', { for: 'b-label' }, '按钮上的字(孩子的口吻)'), count), label),
        h('div', {}, h('div', { class: 'gh' }, h('label', { for: 'b-brief' }, '讲法(写给老师,孩子看不到)')), brief),
        h('div', {}, h('div', { class: 'gh' }, h('span', {}, '留多久')), seg),
      ],
    };
  };
  const inlineForm = (t, k) => {
    const f = buttonForm(t, k, (next) => { sel = next; render(); });
    const close = h('button', { type: 'button', class: 'x', on: { click: () => { sel = null; dirty = false; draft = { edit: null, add: null }; render(); pvSync(); } } }, '收起');
    return h('div', { class: 'grp box', id: 'pane' }, h('div', { class: 'row2' }, h('b', { style: 'font-size:17px' }, f.title), close), ...f.fields, h('div', { class: 'btns' }, f.del, f.go));
  };
  const openSheet = (...kids) => { $('#sheet-in').replaceChildren(...kids); $('#sheet').classList.add('on'); window.scrollTo(0, 0); };
  const closeSheet = () => $('#sheet').classList.remove('on');

  // ---- 样子与声音:头像点了就存;两种声音各一行(现在用的那个、试听),「换一个」开弹窗挑(src/app/http/parent-look.ts)。宽屏在右栏,窄屏整屏 ----
  const LOOK = { open: null, d: null, playing: null, audio: null, saved: false };
  const lookUrl = (name) => '/api/parent/tutors/' + encodeURIComponent(name) + '/look';
  const LK_PLAY = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M4 2.5v9l7.5-4.5z" fill="currentColor"></path></svg>';
  const LK_PAUSE = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="2.5" width="3" height="9" rx="1" fill="currentColor"></rect><rect x="8" y="2.5" width="3" height="9" rx="1" fill="currentColor"></rect></svg>';
  const LK_X = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"></path></svg>';
  function lookStop() { if (LOOK.audio) { LOOK.audio.pause(); URL.revokeObjectURL(LOOK.audio.src); } LOOK.audio = null; LOOK.playing = null; }
  const lookDraw = () => { const el = $('#look'); if (el) el.replaceWith(lookPanel()); if (VP.kind) vpPaint(); };
  const openLook = async (t) => {
    lookStop(); vpClose(); LOOK.open = t.name; LOOK.d = null; LOOK.saved = false;
    if (WIDE.matches) { sel = null; render(); } else openSheet(lookPanel());
    try { LOOK.d = await api('GET', lookUrl(t.name)); } catch (e) { toast('读不到:' + e.message); }
    lookDraw();
  };
  const closeLook = () => { lookStop(); vpClose(); LOOK.open = null; if (WIDE.matches) render(); else closeSheet(); };
  let savedTimer = 0;
  const lookSave = async (patch) => {
    try { LOOK.d = await api('PUT', lookUrl(LOOK.open), patch); } catch (e) { toast('没存上:' + e.message); return false; }
    LOOK.saved = true; lookDraw(); clearTimeout(savedTimer); savedTimer = setTimeout(() => { LOOK.saved = false; lookDraw(); }, 1600);
    // 头像变了预览里的牌、先后那排跟着变
    await load(); pvSync(true);
    return true;
  };
  // 试听:服务端念它定的那句(有缓存);同时只放一个,再点一下停
  const lookPlay = async (kind, voice) => {
    const key = kind + ' ' + voice;
    if (LOOK.playing === key) { lookStop(); lookDraw(); return; }
    lookStop(); LOOK.playing = key; lookDraw();
    try {
      const r = await fetch(lookUrl(LOOK.open) + '/preview?kind=' + kind + '&voice=' + encodeURIComponent(voice), { cache: 'no-store' });
      if (!r.ok) { const j = await r.json().catch(() => null); throw new Error((j && j.message) || 'HTTP ' + r.status); }
      const blob = await r.blob();
      if (LOOK.playing !== key) return;
      const a = new Audio(URL.createObjectURL(blob)); LOOK.audio = a;
      a.onended = () => { if (LOOK.playing === key) { lookStop(); lookDraw(); } };
      await a.play();
    } catch (e) { if (LOOK.playing === key) { lookStop(); lookDraw(); } toast('试听不了:' + e.message); }
  };
  const lookFace = (o) => o.img ? h('img', { src: o.img, alt: '' }) : (o.text || '?');

  // 一个声音长什么样:圆里一个「女 / 男」(底色也分),名字、年纪,标签(语言口音、童声、场景、提醒、现在用的 / 出厂),特点
  const ageOf = (a) => (a <= 12 ? '童声' : a <= 19 ? '少年' : a <= 35 ? '青年' : '成熟');
  const vFace = (v) => h('span', { class: 'vface' + (v.gender === '女' ? ' g-f' : v.gender === '男' ? ' g-m' : '') }, v.gender || '?');
  const vTags = (kind, v, current) => {
    const out = [];
    const plain = kind === 'mouth' ? v.lang === '普通话' : v.lang === '中文';
    out.push(h('span', { class: 'vt ' + (plain ? 't-lang' : kind === 'mouth' ? 't-dia' : 't-en') }, v.lang));
    if (v.age && v.age <= 12) out.push(h('span', { class: 'vt t-kid' }, '童声'));
    if (v.scene) out.push(h('span', { class: 'vt t-line' }, v.scene));
    if (v.warn) out.push(h('span', { class: 'vt t-warn' }, v.warn));
    if (v.voice === current) out.push(h('span', { class: 'vt t-line' }, '现在用的'));
    else if (v.shipped) out.push(h('span', { class: 'vt t-line' }, '出厂'));
    return out;
  };
  const vPlayBtn = (kind, v) => { const playing = LOOK.playing === kind + ' ' + v.voice; return h('button', { type: 'button', class: 'vplay' + (playing ? ' on' : ''), 'aria-label': (playing ? '停 ' : '试听 ') + v.name, html: playing ? LK_PAUSE : LK_PLAY, on: { click: (e) => { e.stopPropagation(); if (VP.kind) { VP.sel = v.voice; } lookPlay(kind, v.voice); } } }); };
  const vBody = (kind, v, current) => h('span', { class: 'vtx' },
    h('span', { class: 'vnm' }, h('b', {}, v.name), v.age ? h('small', {}, v.age + ' 岁') : null),
    h('span', { class: 'vtags' }, ...vTags(kind, v, current)),
    v.trait ? h('small', { class: 'vtr' }, v.trait) : null);

  // ---- 选声音的弹窗:宽屏居中,窄屏从底下升起;搜、筛(每个选项后面是筛出来几个,跟着别的条件变)、试听、选中,按「用」才存 ----
  const VP_STEP = 60;
  const VP = { kind: null, sel: null, q: '', f: {}, n: VP_STEP, more: false };
  const VP_DIMS = {
    mouth: [['g', '性别', (v) => v.gender], ['lang', '口音', (v) => v.lang]],
    card: [['g', '性别', (v) => v.gender], ['lang', '语言', (v) => v.lang], ['age', '年纪', (v) => (v.age ? ageOf(v.age) : '')], ['scene', '场景', (v) => v.scene || '']],
  };
  const VP_ORDER = { g: ['女', '男'], age: ['童声', '少年', '青年', '成熟'] };
  const SCENE_SHOWN = 7;
  const vpPass = (v, skip) => {
    const q = VP.q.trim().toLowerCase();
    if (q && ![v.name, v.trait, v.scene || '', v.lang, v.voice].some((x) => x.toLowerCase().includes(q))) return false;
    return VP_DIMS[VP.kind].every(([k, , of]) => k === skip || !VP.f[k] || of(v) === VP.f[k]);
  };
  const vpOpen = (kind) => {
    if (!LOOK.d) return;
    VP.kind = kind; VP.sel = LOOK.d[kind].current; VP.q = ''; VP.f = {}; VP.n = VP_STEP; VP.more = false;
    const t = D && D.tutors.find((x) => x.name === LOOK.open);
    const q = h('input', { class: 'fld', type: 'search', placeholder: kind === 'mouth' ? '搜名字或特点,比如 温柔、沉稳' : '搜名字或特点,比如 温柔、沉稳、播音', 'aria-label': '搜声音', on: { input: (e) => { VP.q = e.target.value; VP.n = VP_STEP; vpPaint(); } } });
    const box = h('div', { class: 'vpbox', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vp-t', tabindex: '-1' },
      h('div', { class: 'vphd' },
        h('div', { class: 'tx' }, h('b', { id: 'vp-t' }, (t ? t.display : '') + ' · ' + (kind === 'mouth' ? '说话的声音' : '点读的声音')),
          h('small', {}, (kind === 'mouth' ? '孩子听到老师开口就是它' : '点读卡、单词卡、听写念词都用它') + ' · 一共 ' + LOOK.d[kind].options.length + ' 个')),
        h('button', { type: 'button', class: 'vpx', 'aria-label': '关掉', html: LK_X, on: { click: vpClose } })),
      h('div', { class: 'vpctl' }, q, h('div', { id: 'vp-f' })),
      h('div', { class: 'vplist', id: 'vp-list' }),
      h('div', { class: 'vpft' }, h('span', { id: 'vp-st' }), h('button', { type: 'button', class: 'vpno', on: { click: vpClose } }, '取消'), h('button', { type: 'button', id: 'vp-use', class: 'vpgo', on: { click: vpUse } })));
    const el = h('div', { id: 'vp', class: 'vp', on: { click: (e) => { if (e.target === el) vpClose(); }, keydown: (e) => { if (e.key === 'Escape') vpClose(); } } }, box);
    document.body.append(el); document.body.style.overflow = 'hidden';
    vpPaint(); box.focus();
  };
  function vpClose() {
    if (!VP.kind) return;
    if (LOOK.playing && LOOK.playing.startsWith(VP.kind + ' ')) lookStop();
    VP.kind = null; const el = $('#vp'); if (el) el.remove(); document.body.style.overflow = '';
    const p = $('#look'); if (p) lookDraw();
  }
  async function vpUse() {
    const kind = VP.kind, voice = VP.sel;
    if (!kind || !voice || voice === LOOK.d[kind].current) return;
    if (await lookSave(kind === 'mouth' ? { mouth: voice } : { voice })) { vpClose(); toast(kind === 'mouth' ? '存好了,下次开口就换' : '存好了,配过音的卡下次点开才换'); }
  }
  function vpPaint() {
    const kind = VP.kind; if (!kind || !LOOK.d) return;
    const block = LOOK.d[kind], all = block.options;
    // 筛选:一组一排,选项后面是「别的条件不变、换成它」筛出来几个
    const groups = VP_DIMS[kind].map(([k, label, of]) => {
      const vals = [];
      all.forEach((v) => { const x = of(v); if (x && !vals.includes(x)) vals.push(x); });
      const n = (x) => all.filter((v) => vpPass(v, k) && (!x || of(v) === x)).length;
      let list = VP_ORDER[k] ? VP_ORDER[k].filter((x) => vals.includes(x)) : vals.slice().sort((a, b) => all.filter((v) => of(v) === b).length - all.filter((v) => of(v) === a).length);
      if (k === 'lang' && kind === 'mouth') list = ['普通话'].concat(list.filter((x) => x !== '普通话'));
      const cut = k === 'scene' && !VP.more && list.length > SCENE_SHOWN + 1;
      const shown = cut ? list.slice(0, SCENE_SHOWN).concat(VP.f.scene && list.indexOf(VP.f.scene) >= SCENE_SHOWN ? [VP.f.scene] : []) : list;
      const chips = [''].concat(shown).map((x) => { const on = (VP.f[k] || '') === x; return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', on: { click: () => { VP.f[k] = x; VP.n = VP_STEP; vpPaint(); } } }, x || '全部', h('small', {}, String(n(x)))); });
      if (cut) chips.push(h('button', { type: 'button', class: 'chip more', on: { click: () => { VP.more = true; vpPaint(); } } }, '更多 ' + (list.length - SCENE_SHOWN) + ' 种'));
      return h('div', { class: 'vpg' }, h('span', { class: 'lbl' }, label), h('div', { class: 'chips' }, ...chips));
    });
    $('#vp-f').replaceChildren(...groups);
    const hits = all.filter((v) => vpPass(v, ''));
    const shown = hits.slice(0, VP.n);
    const cards = shown.map((v) => {
      const on = v.voice === VP.sel;
      return h('div', { class: 'vcard' + (on ? ' on' : '') },
        h('button', { type: 'button', class: 'vpick', role: 'radio', 'aria-checked': on ? 'true' : 'false', on: { click: () => { VP.sel = v.voice; vpPaint(); } } }, vFace(v), vBody(kind, v, block.current)),
        vPlayBtn(kind, v));
    });
    const left = hits.length - shown.length;
    const list = $('#vp-list'), top = list.scrollTop;
    list.replaceChildren(
      hits.length ? h('div', { class: 'vpgrid', role: 'radiogroup', 'aria-label': kind === 'mouth' ? '说话的声音' : '点读的声音' }, ...cards)
        : h('div', { class: 'vpnone' }, '没有这样的声音', h('button', { type: 'button', class: 'vpno', on: { click: () => { VP.q = ''; VP.f = {}; const i = $('#vp .vpctl input'); if (i) i.value = ''; vpPaint(); } } }, '清掉筛选')),
      left > 0 ? h('button', { type: 'button', class: 'addb', style: 'width:100%;margin-top:12px', on: { click: () => { VP.n += VP_STEP; vpPaint(); } } }, '再看 ' + Math.min(VP_STEP, left) + ' 个(还有 ' + left + ' 个)') : null);
    list.scrollTop = top;
    const picked = all.find((v) => v.voice === VP.sel), same = VP.sel === block.current;
    $('#vp-st').textContent = '筛出 ' + hits.length + ' 个 · 试听念服务端定的一句';
    const go = $('#vp-use'); go.textContent = same ? '现在就是它' : '用「' + (picked ? picked.name : '') + '」'; go.disabled = same;
  }

  function lookPanel() {
    const t = D && D.tutors.find((x) => x.name === LOOK.open), d = LOOK.d;
    const head = h('div', { class: 'nav' }, h('button', { type: 'button', on: { click: closeLook } }, '‹ 返回'), h('b', {}, (t ? t.display : '') + ' · 样子与声音'), h('span', { class: 'lksaved', 'aria-live': 'polite' }, LOOK.saved ? '存好了' : ''));
    if (!t || !d) return h('div', { id: 'look', class: 'lk' }, head, h('div', { class: 'grp hint' }, '在读…'));
    const curA = d.avatar.options.find((o) => o.value === d.avatar.current);
    const big = h('div', { class: 'lkbig' }, curA ? lookFace(curA) : avatar(t));
    const grid = h('div', { class: 'lkgrid' }, ...d.avatar.options.map((o) => h('button', { type: 'button', class: 'lkopt' + (o.value === d.avatar.current ? ' on' : ''), 'aria-pressed': o.value === d.avatar.current ? 'true' : 'false', 'aria-label': o.label || o.text, on: { click: () => { if (o.value !== d.avatar.current) lookSave({ avatar: o.value }); } } },
      h('span', { class: 'lkf' }, lookFace(o)), o.label ? h('small', {}, o.label) : null)));
    const cur = (kind, label) => {
      const block = d[kind], v = block.options.find((o) => o.voice === block.current);
      return h('div', { class: 'vcur', id: 'lk-' + kind },
        h('div', { class: 'lbl' }, label),
        v ? h('div', { class: 'vrow2' }, vFace(v), vBody(kind, v, null), vPlayBtn(kind, v)) : h('div', { class: 'lbl' }, '还没配'),
        h('button', { type: 'button', class: 'vchg', on: { click: () => vpOpen(kind) } }, '换一个 · ' + block.options.length + ' 个可选', h('span', { html: CHEV })));
    };
    return h('div', { id: 'look', class: 'lk' }, head, big,
      h('div', {}, h('div', { class: 'gh' }, h('span', {}, '头像 · 孩子的首页、老师页上都是这张')), grid),
      h('div', {}, h('div', { class: 'gh' }, h('span', {}, '声音')),
        h('div', { class: 'grp' }, cur('mouth', '说话的声音 · 老师开口说话'), cur('card', '点读的声音 · 点读卡、单词卡、听写念词')),
        h('div', { class: 'note' }, '改了说话的声音,下次开口就换;已经配好音的卡,下次点开才换。')));
  }
  const editButton = (t, k) => {
    const f = buttonForm(t, k, () => closeSheet());
    openSheet(h('div', { class: 'nav' }, h('button', { type: 'button', on: { click: () => { dirty = false; draft = { edit: null, add: null }; closeSheet(); pvSync(); } } }, '取消'), h('b', {}, f.title), f.go), ...f.fields, f.del ? h('button', { type: 'button', class: 'danger', on: { click: () => f.del.click() } }, '删掉这个按钮') : null);
    setTimeout(() => f.label.focus(), 50);
  };

  // ---- 这周的词:一行一个,念法空一格写在后面 ----
  // ---- 这周的词:一行一个,念法空一格写在后面 ----
  const editWords = (t) => {
    const en = t.lang === 'en';
    const ta = h('textarea', { class: 'fld', id: 'w-text', rows: '10', placeholder: en ? 'red\nyellow yellow, a yellow bus\nice-cream' : '春天\n鼓励 鼓励,老师鼓励我的鼓励\n叶 树叶的叶' });
    ta.value = (t.dictation || []).map((w) => (w.say ? w.chars + ' ' + w.say : w.chars)).join('\n');
    const go = h('button', { type: 'button' }, '发布');
    const parse = () => ta.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = /^(\S+)(?:\s+(.+))?$/.exec(l); return m[2] ? { chars: m[1], say: m[2] } : { chars: m[1] }; });
    go.addEventListener('click', async () => { go.disabled = true; const r = await save('PUT', '/api/parent/home/tutors/' + encodeURIComponent(t.name) + '/dictation', { words: parse() }, '发布了'); if (r) closeSheet(); else go.disabled = false; });
    openSheet(
      h('div', { class: 'nav' }, h('button', { type: 'button', on: { click: closeSheet } }, '取消'), h('b', {}, t.display + ' · 这周的词'), go),
      h('div', {}, h('div', { class: 'gh' }, h('label', { for: 'w-text' }, '一行一个词,念法空一格写在后面')), ta),
      // 英语老师:一键用最近给孩子的口语单上的单词(口语课拍的那页)
      en ? h('button', { type: 'button', class: 'it', style: 'border-radius:14px', on: { click: async () => { try { const j = await api('GET', '/api/talk'); const last = (j.talks || []).find((x) => (x.status === 'ready' || x.status === 'done') && x.list.words.length); const ws = last ? last.list.words.map((w) => String(w.en || '').trim()).filter((w) => /^[A-Za-z][A-Za-z'-]*$/.test(w)) : []; if (!ws.length) return toast('口语单上没有单词'); ta.value = ws.slice(0, 20).join('\n'); } catch (e) { toast('读不到口语单'); } } } }, h('span', { class: 'tx' }, h('b', { style: 'color:var(--accent)' }, '用口语单上的单词'), h('small', {}, '最近给孩子的那份口语单')))  : null,
      h('div', { class: 'note' }, en ? '一行一个英文单词,念法空一格写在后面,最多 20 个。孩子点「单词听写」,老师一个一个念,每个念两遍;他在四线三格里写整个单词,写完自己对。清空 = 不要这周的词。' : '一个词一到四个汉字,最多 20 个。孩子点「听写」,老师一个一个念,每个念两遍。清空 = 不要这周的词。想从课本上挑,在孩子的 iPad 上点「拍照听写」。'));
  };

  load();
  WIDE.addEventListener('change', () => { if (!picked) dev = WIDE.matches ? 'tablet' : 'phone'; if (D) { closeSheet(); sel = null; draft = { edit: null, add: null }; render(); pvSync(); } else fit(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#sheet').classList.contains('on') && !dirty) load(); });
})();
</script>
</body></html>
`;
