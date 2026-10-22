/**
 * 工作台 /dev(2026-09-22 之前叫家长端 /parent;现在家长端是 /parent = 家长板书页,给不懂技术的家长日常用,这页给有技术背景的家长与开发者):
 * 四个标签(对话 / 老师团 / 音色 / 设置)+「看原文」抽屉,零依赖内联脚本,只走 /api/*。
 * 首页页(《首页设计.md》§7.3):左边 iframe 是孩子端页面本身的预览(/dev/home-preview),右边是检查、按钮与讲法、发布、点击统计。
 * 2026-09-11 重做:一轮 = 一张卡(问句 → 板书 → 埋点 → 孩子看到 → 通知块),板书按 kind 渲染成卡片而不是把围栏原文倒给家长;
 * 顶栏与输入框各自钉死(grid-rows auto/1fr/auto + min-height:0,不再硬算 100vh - 47px:顶栏一换行就错位,composer 被顶出视口);
 * 老师团一位一行、九项政策折叠、改过的才亮;设置分路径 / 服务 / 配音三块,配音能当场试一句。
 * 看原文 = 把一轮拆成六站(上下文包 / 老师原文 / 解析结果 / 下发给孩子 / 配音 / 转录),数据来自 /api/conversations/<老师>/<日期>/raw/<job>。
 * 放在 .ts 里而不是 .html,是因为 tsc 不拷贝静态文件,dist 里就少一份。
 * 改这里注意:整份是模板字符串——页面脚本里不要用反引号与 ${},换行写 \\n,正则里别写 \\/。
 */
import { faviconLinks } from '../lib/favicon.ts';
import { DEV_CSS } from './dev-theme.ts';
import { BRAND_CSS, BRAND_NAME, BRAND_URL, brandLogo } from './brand.ts';

export const DEV_PAGE = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${faviconLinks()}
<title>cotutor 工作台</title>
<style>
${DEV_CSS}
  body { height:100vh; overflow:hidden; display:grid; grid-template-columns:232px minmax(0,1fr); }

  /* ---------- 侧栏:坐在纸上,当前那项白底浮起 ---------- */
  #side { display:flex; flex-direction:column; gap:14px; padding:18px 12px 16px 14px; overflow:auto; min-height:0; }
${BRAND_CSS}
  #side .brand { display:flex; align-items:center; gap:9px; padding:2px 8px; color:inherit; text-decoration:none; }
  #side .brand .logo { width:30px; height:30px; border-radius:9px; background:var(--accent); display:grid; place-items:center; flex:none; }
  #side .brand b { font-size:17px; font-weight:700; letter-spacing:-.01em; }
  #side .brand small { font-size:13px; color:var(--muted); }
  #side .ws { display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:var(--r-item); background:var(--surface); box-shadow:0 0 0 1px var(--line); min-width:0; }
  #side .ws .ini { width:28px; height:28px; border-radius:50%; background:var(--sunk); display:grid; place-items:center; font-size:13px; font-weight:600; color:var(--ink-2); flex:none; }
  #side .ws span { display:flex; flex-direction:column; min-width:0; }
  #side .ws b { font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #side .ws small { font:400 11.5px/1.4 var(--mono); color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #side nav { display:flex; flex-direction:column; gap:2px; }
  #side nav a { display:flex; align-items:center; gap:10px; height:38px; padding:0 12px; border-radius:var(--r-ctl); color:var(--ink-2); font-size:14px; white-space:nowrap; }
  #side nav a:hover { background:rgba(255,255,255,.6); color:var(--ink); }
  #side nav a.on { background:var(--surface); color:var(--ink); font-weight:600; box-shadow:var(--lift),0 0 0 1px var(--line); }
  #side nav a svg { flex:none; }
  #side nav a .out { margin-left:auto; color:var(--muted); }
  #side nav a .badge { margin-left:auto; font:600 11.5px/1 var(--mono); color:#fff; background:var(--accent); border-radius:999px; padding:3px 7px; }
  #side nav .grp { font-size:12px; color:var(--muted); padding:12px 12px 4px; letter-spacing:.04em; }
  #side nav hr { border:0; height:1px; background:var(--line); margin:10px 10px; }
  #side .health { margin-top:auto; display:flex; flex-direction:column; gap:4px; padding:11px 12px; border-radius:var(--r-item); background:var(--surface); box-shadow:0 0 0 1px var(--line); }
  #side .health div { display:flex; align-items:center; gap:8px; }
  #side .health b { font-size:13px; font-weight:600; }
  #side .health b.bad { color:var(--err); }
  #side .health b.warn { color:var(--warn); }
  #side .health .dot.warn { box-shadow:0 0 0 3px var(--warn-soft); }
  #side .health .dot { box-shadow:0 0 0 3px var(--ok-soft); }
  #side .health .dot.err { box-shadow:0 0 0 3px var(--err-soft); }
  #side .health small { font:400 11.5px/1.5 var(--mono); color:var(--muted); word-break:break-all; }

  main { display:none; min-height:0; min-width:0; }
  main.on { display:block; overflow:auto; }
  .ph { display:flex; align-items:center; flex-wrap:wrap; gap:10px 14px; min-height:44px; }
  .ph h1 { margin:0; font-size:24px; font-weight:650; letter-spacing:-.01em; }
  .ph .sub { font-size:13px; color:var(--muted); }
  .ph .right { margin-left:auto; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

  /* 头像:家长首页那个缺口环(学科色)+ 白脸;emoji 或图片 */
  .av { position:relative; width:34px; height:34px; flex:none; display:inline-block; vertical-align:middle; color:var(--muted); }
  .av svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
  .av circle { fill:none; stroke:currentColor; stroke-width:8; stroke-linecap:round; stroke-dasharray:221.17 55.29; transform-origin:50px 50px; transform:rotate(36deg); }
  .av .face { position:absolute; left:15%; top:15%; width:70%; height:70%; border-radius:50%; background:var(--surface); display:grid; place-items:center; font-size:15px; line-height:1; overflow:hidden; }
  .av .face img { width:100%; height:100%; object-fit:cover; display:block; }
  .av.lg { width:44px; height:44px; } .av.lg .face { font-size:19px; }
  .av.sm { width:28px; height:28px; } .av.sm .face { font-size:12px; }

  /* ---------- 概览 ---------- */
  #overview .wrap { max-width:1240px; }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:4px; padding:8px; }
  .tiles > * { display:flex; flex-direction:column; align-items:center; gap:7px; padding:16px 8px 14px; border-radius:var(--r-turn); color:var(--ink); border:0; background:none; cursor:pointer; text-align:center; }
  .tiles > *:hover { background:var(--surface-2); color:var(--ink); }
  .tiles .ic { width:40px; height:40px; border-radius:12px; background:var(--sunk); color:var(--ink-2); display:grid; place-items:center; }
  .tiles .ic.hot { background:var(--accent-soft); color:var(--accent); }
  .tiles b { font-size:14px; font-weight:600; }
  .tiles small { font-size:12px; color:var(--muted); }
  .tiles small.num { font-size:11.5px; }
  .cols3 { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px; }
  .cols2 { display:flex; flex-wrap:wrap; gap:16px; align-items:flex-start; }
  .blk { background:var(--surface); border-radius:var(--r-card); padding:20px 22px; display:flex; flex-direction:column; gap:12px; min-width:0; }
  .blk > .hd { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .blk h2 { margin:0; font-size:16px; font-weight:600; }
  .blk h3 { margin:0; font-size:14px; font-weight:600; }
  .blk .hd .sub { font-size:12.5px; color:var(--muted); }
  .blk .hd .right { margin-left:auto; display:flex; gap:8px; align-items:center; }
  .hero { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
  .hero .big { font-size:44px; font-weight:650; line-height:1; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
  .hero .mid { font-size:28px; font-weight:650; line-height:1.1; font-variant-numeric:tabular-nums; }
  .hero span { font-size:13px; color:var(--muted); }
  .rule { height:1px; background:var(--line-soft); }
  .kv { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
  .kv.two { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .kv > div { display:flex; flex-direction:column; gap:3px; min-width:0; }
  .kv span { font-size:12px; color:var(--muted); }
  .kv b { font:600 18px/1.3 var(--mono); font-variant-numeric:tabular-nums; }
  .kv b small { font-size:12px; color:var(--muted); font-weight:400; }
  .kv .st { align-self:flex-start; }
  .bars { display:flex; align-items:flex-end; gap:10px; height:150px; padding-top:16px; border-bottom:1px solid var(--line); }
  .bars .b { flex:1; min-width:0; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:4px; }
  .bars .b i { display:block; width:100%; max-width:30px; background:var(--accent-line); border-radius:4px 4px 0 0; min-height:2px; }
  .bars .b.today i { background:var(--accent); }
  .bars .b span { font:400 11.5px/1 var(--mono); color:var(--ink-2); visibility:hidden; }
  .bars .b.lab span { visibility:visible; }
  .bars .b:hover span { visibility:visible; }
  .axis { display:flex; gap:10px; }
  .axis span { flex:1; min-width:0; text-align:center; font:400 11.5px/1 var(--mono); color:var(--muted); }
  .axis span.today { color:var(--ink); font-weight:600; }
  .meter { display:flex; flex-direction:column; gap:6px; }
  .meter .t { display:flex; align-items:baseline; gap:8px; }
  .meter .t b { font-size:13px; font-weight:600; }
  .meter .t span { margin-left:auto; font:400 12px/1 var(--mono); color:var(--muted); }
  .tbl { overflow-x:auto; margin:0 -22px; }
  .tbl .tr { display:grid; grid-template-columns:minmax(170px,2fr) 104px 52px 84px 64px 84px; gap:12px; align-items:center; padding:9px 22px; border-bottom:1px solid var(--line-soft); min-width:600px; color:var(--ink); }
  .tbl .tr.th { font-size:12px; color:var(--muted); padding-top:4px; }
  .tbl a.tr:hover { background:var(--surface-2); color:var(--ink); }
  .tbl .tr .r { text-align:right; font-family:var(--mono); font-variant-numeric:tabular-nums; }
  .tbl .tr .who { display:flex; align-items:center; gap:11px; min-width:0; }
  .tbl .tr .who span { display:flex; flex-direction:column; min-width:0; }
  .tbl .tr .who b { font-size:14px; font-weight:600; }
  .tbl .tr .who small { font:400 11.5px/1.4 var(--mono); color:var(--muted); }
  .tbl .tr .tag { justify-self:start; }
  .tbl .tr .vis { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; color:var(--ok); }
  .tbl .tr .vis.off { color:var(--muted); }
  .issue { display:flex; gap:12px; align-items:flex-start; padding:11px 12px; border-radius:var(--r-item); background:var(--surface-2); box-shadow:0 0 0 1px var(--line-soft); color:var(--ink); border:0; text-align:left; cursor:pointer; width:100%; }
  .issue:hover { box-shadow:0 0 0 1px var(--accent-line); }
  .issue .st { flex:none; }
  .issue .tx { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; }
  .issue .tx b { font-size:13.5px; font-weight:600; }
  .issue .tx span { font-size:12.5px; color:var(--ink-2); word-break:break-word; }
  .issue .go { flex:none; font-size:12.5px; color:var(--accent); line-height:20px; }
  .jsissue { display:flex; flex-direction:column; gap:6px; }
  .jsmore { padding:4px 12px 8px; display:flex; flex-direction:column; gap:6px; align-items:flex-start; }
  .jsmore[hidden] { display:none; }
  .jsmore pre { margin:0; max-width:100%; overflow-x:auto; font:400 11.5px/1.5 var(--mono); color:var(--ink-2); white-space:pre-wrap; word-break:break-all; }
  .stack { display:flex; flex-direction:column; gap:16px; min-width:0; }
  .devs { overflow-x:auto; margin:0 -22px; }
  .devs .dr { display:grid; grid-template-columns:minmax(120px,1.2fr) minmax(150px,1.5fr) 104px 104px 72px; gap:12px; align-items:center; padding:9px 22px; border-bottom:1px solid var(--line-soft); min-width:600px; font-size:13.5px; }
  .devs .dr.th { font-size:12px; color:var(--muted); padding-top:4px; }
  .devs .dr .r { text-align:right; font-family:var(--mono); font-variant-numeric:tabular-nums; }
  .devs .dr .muted { font:400 12px/1.4 var(--mono); }
  .dname { border:0; background:transparent; padding:0; font:600 14px/1.4 var(--sans); color:var(--ink); cursor:text; text-align:left; }
  .dname.none { font-weight:400; color:var(--muted); }
  .dname:hover { color:var(--accent); }
  .dname-in { width:100%; height:30px; font-size:14px; padding:0 8px; border:0; box-shadow:0 0 0 1.5px var(--accent-line); border-radius:8px; background:var(--surface); }
  .dname-in:focus { outline:0; }
  details.older summary { font-size:12.5px; color:var(--muted); cursor:pointer; }
  .checks { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
  .probs { display:flex; flex-direction:column; gap:8px; }
  .prob { display:flex; gap:10px; align-items:flex-start; }
  .prob .st { flex:none; }
  .prob .tx { display:flex; flex-direction:column; gap:1px; min-width:0; font-size:12.5px; color:var(--ink-2); word-break:break-word; }
  .prob .tx b { font-size:12.5px; color:var(--ink); }
  .prob .tx .fix { color:var(--muted); }
  .allck summary { cursor:pointer; font-size:12.5px; color:var(--muted); }
  .checks .ck { display:inline-flex; align-items:center; gap:6px; font:400 12px/1.4 var(--mono); color:var(--ink); background:var(--ground); border-radius:7px; padding:4px 9px; }
  .checks .ck.bad { background:var(--warn-soft); color:var(--warn); }
  .checks .ck.err { background:var(--err-soft); color:var(--err); }
  .muted { color:var(--muted); }
  .note { font-size:12.5px; color:var(--muted); margin:0; }

  /* ---------- 对话 ---------- */
  #chat.on { display:grid; grid-template-columns:200px minmax(0,1fr); gap:16px; padding:20px 28px 20px 8px; overflow:hidden; height:100vh; }
  #chat > aside { overflow:auto; display:flex; flex-direction:column; gap:3px; min-height:0; }
  #chat > aside .head { font-size:12px; color:var(--muted); padding:8px 10px 6px; letter-spacing:.04em; }
  #chat > aside .tutor { display:flex; gap:10px; align-items:center; padding:7px 10px; border-radius:var(--r-item); cursor:pointer; }
  #chat > aside .tutor:hover { background:rgba(255,255,255,.6); }
  #chat > aside .tutor.on { background:var(--surface); box-shadow:0 0 0 1px var(--line); }
  #chat > aside .tutor.hid { opacity:.6; }
  #chat > aside .tutor .who { min-width:0; flex:1; display:flex; flex-direction:column; }
  #chat > aside .tutor .who b { font-size:14px; font-weight:600; }
  #chat > aside .tutor .who span { font:400 11.5px/1.4 var(--mono); color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #chat > aside .foot { margin:10px 10px 0; font-size:12px; color:var(--muted); line-height:1.6; }

  #thread { display:grid; grid-template-rows:auto minmax(0,1fr) auto; gap:12px; min-height:0; min-width:0; }
  .thread-top { display:flex; align-items:center; gap:10px 14px; flex-wrap:wrap; min-height:44px; }
  .thread-top .who { display:flex; align-items:center; gap:10px; font-weight:650; font-size:22px; }
  .thread-top select, #composer .row select { font:500 12.5px/1 var(--mono); border:0; box-shadow:0 0 0 1px var(--line); border-radius:999px; padding:7px 10px; background:var(--surface); color:var(--ink); }
  .today { margin-left:auto; display:flex; align-items:center; gap:6px 16px; font:500 12.5px/1 var(--mono); color:var(--muted); font-variant-numeric:tabular-nums; flex-wrap:wrap; }
  .today b { color:var(--ink); font-weight:600; }

  #msgs { overflow:auto; padding:16px; background:var(--sunk); border-radius:var(--r-card); min-height:0; }
  .stream { max-width:960px; margin:0 auto; display:flex; flex-direction:column; gap:14px; }
  .sep { text-align:center; font-size:12.5px; color:var(--muted); display:flex; flex-direction:column; align-items:center; gap:4px; margin-top:6px; }
  .sep b { color:var(--ink); font-weight:600; }
  .thread-head { display:flex; align-items:center; justify-content:center; gap:10px; flex-wrap:wrap; font:500 12.5px/1 var(--mono); color:var(--muted); }
  .stars { display:inline-flex; gap:1px; }
  .stars .star { border:0; background:none; font-size:16px; line-height:1; padding:0 1px; color:var(--off); cursor:pointer; }
  .stars .star.on { color:var(--warn-dot); }
  .thread-head .booked { font:500 12px/1 var(--sans); color:var(--ok); background:var(--ok-soft); border-radius:999px; padding:4px 10px; }
  .turn { background:var(--surface); border-radius:var(--r-turn); overflow:hidden; }
  .turn.bad { box-shadow:0 0 0 1px var(--err-line); }
  .ask { display:flex; gap:10px; padding:13px 18px; border-bottom:1px solid var(--line-soft); align-items:flex-start; }
  .ask .tag { font:600 12px/22px var(--sans); padding:0 8px; border-radius:var(--r-tag); flex:none; background:var(--sunk); color:var(--muted); }
  .ask.from-kid .tag { background:var(--kid-soft); color:var(--kid); }
  .ask .q { flex:1; min-width:0; white-space:pre-wrap; word-break:break-word; font-size:15px; }
  .ask .q .did { display:block; margin-top:6px; font-size:13.5px; color:var(--kid); background:var(--kid-soft); border-radius:8px; padding:4px 10px; white-space:normal; }
  .ask .when { font:400 12px/22px var(--mono); color:var(--muted); flex:none; font-variant-numeric:tabular-nums; text-align:right; }

  .board { padding:14px 18px 8px; display:flex; flex-direction:column; gap:9px; }
  .line { display:flex; gap:10px; color:var(--ink-2); }
  .line .n { font:400 11.5px/22px var(--mono); color:var(--faint); width:18px; text-align:right; flex:none; font-variant-numeric:tabular-nums; }
  .line p { margin:0; min-width:0; }
  .line mark { background:none; color:var(--accent); border-bottom:1.5px solid var(--accent-line); }
  .line.ask-line p::after { content:"停下等孩子"; font:400 11.5px/1 var(--mono); color:var(--muted); margin-left:8px; }
  .card { border-radius:var(--r-ctl); box-shadow:0 0 0 1px var(--line); margin-left:28px; overflow:hidden; }
  .card .kindbar { display:flex; align-items:center; gap:8px; padding:5px 12px; background:var(--surface-2); border-bottom:1px solid var(--line-soft); font:400 11.5px/1.6 var(--mono); color:var(--muted); }
  .card .kindbar i { width:7px; height:7px; border-radius:2px; background:var(--accent-line); display:block; }
  .card .kindbar .more { margin-left:auto; }
  .card .body { padding:12px 14px; }
  .card.step .body { display:flex; gap:11px; align-items:flex-start; }
  .card.step .idx { font:600 13px/22px var(--mono); width:22px; height:22px; border-radius:50%; background:var(--accent); color:#fff; text-align:center; flex:none; }
  .card .body b { font-size:14.5px; display:block; }
  .card .body p { margin:2px 0 0; color:var(--ink-2); white-space:pre-wrap; }
  .card.formula .body { text-align:center; font:400 20px/1.5 var(--serif); padding:16px 14px; color:var(--ink); }
  .card.quote .body { font-style:italic; text-align:center; }
  .opt { display:flex; align-items:center; gap:10px; padding:7px 10px; box-shadow:0 0 0 1px var(--line); border-radius:8px; margin-top:6px; background:var(--surface); }
  .opt .k { font:400 12px/1 var(--mono); color:var(--muted); width:14px; flex:none; }
  .opt.right { box-shadow:0 0 0 1.5px var(--ok); }
  .opt .ans { margin-left:auto; font:600 11.5px/1 var(--sans); color:var(--ok); background:var(--ok-soft); padding:3px 7px; border-radius:5px; flex:none; }
  .rseg { display:inline-block; box-shadow:0 0 0 1px var(--line); background:var(--surface); border-radius:var(--r-tag); padding:3px 8px; margin:0 6px 6px 0; font-size:14px; }
  .fillline u { text-decoration:none; border-bottom:1.5px solid var(--accent-line); color:var(--accent); padding:0 10px; }
  .card img { max-width:100%; border-radius:6px; display:block; }
  .card pre { margin:0; font:400 13px/1.7 var(--mono); white-space:pre-wrap; word-break:break-word; color:var(--ink-2); }
  .card .meta2 { font:400 12px/1.6 var(--mono); color:var(--muted); }

  .turn-foot { display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:9px 18px; border-top:1px solid var(--line-soft); background:var(--surface-2); }
  .turn-foot .right { margin-left:auto; display:flex; gap:4px; }
  .linkish { font:500 12.5px/1 var(--sans); color:var(--ink-2); background:none; border:0; cursor:pointer; height:28px; padding:0 10px; border-radius:8px; display:inline-flex; align-items:center; }
  .linkish:hover { color:var(--accent); background:var(--accent-soft); }
  .linkish.on, .linkish.go { color:var(--accent); background:var(--accent-soft); }

  .kidview { border-top:1px solid var(--line-soft); padding:10px 18px; display:flex; gap:10px; align-items:flex-start; }
  .kidview .lab { font:600 12px/22px var(--sans); color:var(--kid); background:var(--kid-soft); border-radius:var(--r-tag); padding:0 8px; flex:none; }
  .kidview p { margin:0; font-size:13.5px; line-height:22px; color:var(--ink-2); min-width:0; }
  .kidview p span { color:var(--muted); }
  .kidview.parent .lab { color:var(--parent); background:var(--parent-soft); }

  .notice { display:flex; gap:12px; padding:12px 18px; border-top:1px solid var(--line-soft); align-items:flex-start; }
  .notice .ico { font:700 12px/20px var(--mono); width:20px; height:20px; border-radius:6px; text-align:center; flex:none; color:#fff; }
  .notice h5 { margin:0 0 2px; font-size:13.5px; font-weight:600; }
  .notice p { margin:0; font-size:13px; color:var(--ink-2); white-space:pre-wrap; }
  .notice.note { background:var(--accent-soft); } .notice.note .ico { background:var(--accent); }
  .notice.err { background:var(--err-soft); border-top-color:var(--err-line); } .notice.err .ico { background:var(--err); }
  .notice.err p { font:400 12px/1.6 var(--mono); color:var(--err); word-break:break-word; }
  .notice.warn { background:var(--info-soft); } .notice.warn .ico { background:var(--info); }
  .running { display:flex; align-items:center; gap:10px; padding:12px 18px; border-top:1px solid var(--line-soft); color:var(--accent); font-size:13.5px; font-weight:500; }
  .running::before { content:""; width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 4px var(--accent-soft); flex:none; }
  .running.dead { color:var(--muted); font-weight:400; } .running.dead::before { background:var(--off); box-shadow:none; }
  .trace { padding:0 18px 12px; }
  .trace .tool, .trace .done { font:400 12.5px/1.6 var(--mono); color:var(--muted); white-space:pre-wrap; word-break:break-word; }
  .trace .tool-error { font:400 12.5px/1.6 var(--mono); color:var(--err); white-space:pre-wrap; }
  .trace .say { white-space:pre-wrap; color:var(--ink-2); margin:4px 0; }
  .trace details { font-size:13px; color:var(--muted); margin:4px 0; }
  .trace summary { cursor:pointer; }
  .trace .sub { border-left:2px dashed var(--line); padding-left:8px; margin:4px 0; }
  .empty { color:var(--muted); text-align:center; margin-top:70px; }

  #composer { background:var(--surface); border-radius:var(--r-card); padding:12px; display:flex; flex-direction:column; gap:10px; box-shadow:var(--lift),0 0 0 1px var(--line); }
  #composer .box { display:flex; gap:10px; align-items:flex-end; }
  #composer textarea { flex:1; min-height:52px; max-height:160px; padding:6px 8px; border:0; outline:0; background:transparent; resize:vertical; font-size:15px; }
  #composer .row { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
  #composer .row select { background:var(--ground); box-shadow:none; max-width:260px; }
  #composer .row .hint { margin-left:auto; font:400 12px/1 var(--mono); color:var(--muted); padding:0; }
  #composer .photo-btn { display:inline-flex; align-items:center; gap:6px; font:500 12.5px/1 var(--sans); border-radius:999px; padding:7px 11px; background:var(--ground); cursor:pointer; color:var(--ink-2); }
  #composer .photo-btn input { display:none; }
  #composer .send { height:38px; padding:0 20px; border-radius:11px; }
  #photos { display:flex; gap:8px; flex-wrap:wrap; }
  #photos:empty { display:none; }
  #photos .p { position:relative; }
  #photos img { height:64px; width:auto; border-radius:8px; box-shadow:0 0 0 1px var(--line); display:block; }
  #photos .x { position:absolute; top:-6px; right:-6px; width:20px; height:20px; border-radius:10px; border:0; background:var(--ink); color:var(--surface); font-size:13px; line-height:20px; padding:0; cursor:pointer; }
  .ask .q .photos { display:flex; gap:8px; flex-wrap:wrap; margin-top:6px; }
  .ask .q .photos img { height:96px; width:auto; border-radius:8px; box-shadow:0 0 0 1px var(--line); display:block; background:var(--surface); }

  /* ---------- 看原文:盖住侧栏右边整块,像一页 ---------- */
  #drawer { position:fixed; top:0; left:232px; right:0; bottom:0; background:var(--ground); display:none; grid-template-rows:auto minmax(0,1fr); gap:16px; padding:20px 28px 24px 8px; z-index:20; }
  #drawer.on { display:grid; }
  .dhead { display:flex; flex-direction:column; gap:6px; }
  .dhead .crumb { display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--muted); flex-wrap:wrap; }
  .dhead .crumb button { border:0; background:none; padding:0; color:var(--muted); cursor:pointer; font-size:12.5px; }
  .dhead .crumb button:hover { color:var(--accent); }
  .dhead .line2 { display:flex; align-items:center; gap:10px 12px; flex-wrap:wrap; }
  .dhead h1 { margin:0; font-size:24px; font-weight:650; }
  .dhead .jobid { font:600 12.5px/1 var(--mono); background:var(--accent-soft); color:var(--accent); padding:5px 9px; border-radius:7px; }
  .dhead .who2 { font:400 12.5px/1.5 var(--mono); color:var(--muted); }
  .dhead .acts { margin-left:auto; display:flex; gap:8px; flex-wrap:wrap; }
  .dbody { display:grid; grid-template-columns:232px minmax(0,1fr); gap:16px; min-height:0; }
  .rail { background:var(--surface); border-radius:var(--r-card); padding:8px; overflow:auto; align-self:start; max-height:100%; }
  .rail button { display:flex; gap:10px; align-items:flex-start; text-align:left; background:none; border:0; border-radius:var(--r-item); padding:9px 11px; cursor:pointer; width:100%; }
  .rail button:hover { background:var(--surface-2); }
  .rail button.on { background:var(--ground); }
  .rail .dot { margin-top:7px; }
  .rail .lab { min-width:0; }
  .rail .lab b { display:block; font-size:14px; font-weight:500; }
  .rail button.on .lab b { font-weight:600; }
  .rail .lab span { display:block; font:400 11.5px/1.5 var(--mono); color:var(--muted); }
  .dcontent { min-width:0; overflow:auto; background:var(--surface); border-radius:var(--r-card); }
  .ctop { display:flex; align-items:center; gap:10px; padding:12px 18px; border-bottom:1px solid var(--line-soft); font:400 12px/1.5 var(--mono); color:var(--muted); flex-wrap:wrap; }
  .ctop .right { margin-left:auto; display:flex; gap:4px; }
  .raw { font:400 13.5px/1.9 var(--mono); padding:10px 0 20px; }
  .rl { display:grid; grid-template-columns:48px minmax(0,1fr) auto; gap:0 14px; padding-right:18px; }
  .rl .n { color:var(--faint); text-align:right; user-select:none; font-variant-numeric:tabular-nums; }
  .rl .t { white-space:pre-wrap; word-break:break-word; color:var(--ink-2); }
  .rl .a { font-size:11.5px; color:var(--muted); white-space:nowrap; align-self:center; }
  .rl.say .t { color:var(--ink); } .rl.say .a { color:var(--ok); }
  .rl.card { background:var(--surface-2); } .rl.card.open .t, .rl.card.open .a { color:var(--accent); }
  .rl.section { background:var(--ground); } .rl.section .t { color:var(--muted); }
  .rl.tail { background:var(--surface-2); } .rl.tail .t { color:var(--muted); } .rl.tail .a { color:var(--warn); }
  .rl.warnline { background:var(--warn-soft); }
  .rawwarn { margin:6px 18px 6px 62px; padding:9px 12px; background:var(--warn-soft); border-radius:var(--r-ctl); font:400 13px/1.6 var(--sans); color:var(--ink-2); }
  .rawwarn b { font:600 12px/1.6 var(--mono); color:var(--warn); margin-right:8px; }
  .dsec { padding:18px; display:flex; flex-direction:column; gap:10px; }
  .dsec h5 { margin:0; font-size:14px; font-weight:600; }
  .dsec pre { margin:0; font:400 13px/1.7 var(--mono); background:var(--surface-2); box-shadow:0 0 0 1px var(--line-soft); border-radius:var(--r-ctl); padding:11px 12px; white-space:pre-wrap; word-break:break-word; color:var(--ink-2); max-height:340px; overflow:auto; }
  .dsec .hintline { font-size:13px; color:var(--muted); margin:0; }
  .gantt { display:grid; grid-template-columns:64px 1fr; row-gap:8px; align-items:center; font-size:12.5px; }
  .gantt .ln { color:var(--ink-2); font-family:var(--mono); font-size:12px; }
  .gantt .tr { position:relative; height:20px; background:var(--ground); border-radius:5px; }
  .gantt .sp { position:absolute; top:4px; height:12px; min-width:3px; border-radius:3px; background:var(--accent); cursor:pointer; }
  .gantt .sp.warn { background:var(--warn-dot); } .gantt .sp.fail { background:var(--err); } .gantt .sp.tick { width:3px; }
  .gantt .sp.on { outline:2px solid var(--ink); }
  .gantt .ax { grid-column:2; display:flex; justify-content:space-between; color:var(--muted); font-family:var(--mono); font-size:11px; }
  .dsec details summary { cursor:pointer; font-size:13px; color:var(--muted); }
  .dline { display:grid; grid-template-columns:16px minmax(0,1fr); gap:8px; font:400 13px/1.8 var(--mono); padding:0 4px; border-radius:4px; }
  .dline .s { text-align:center; font-weight:600; }
  .dline.add { background:var(--ok-soft); } .dline.add .s { color:var(--ok); }
  .dline.del { background:var(--err-soft); } .dline.del .s { color:var(--err); }
  .dline.same .s { color:var(--off); }
  .kline { display:flex; gap:10px; align-items:baseline; padding:6px 0; border-bottom:1px solid var(--line-soft); }
  .kline .n2 { font:400 11.5px/1.6 var(--mono); color:var(--faint); width:18px; flex:none; }
  .kline .cut { color:var(--muted); text-decoration:line-through; text-decoration-color:var(--err); }
  .kline .kidstate { color:var(--kid); }
  .kline .au { margin-left:auto; font:500 12px/1 var(--mono); color:var(--ok); flex:none; }
  .kline .au.bad { color:var(--err); }
  .kline .au.none { color:var(--muted); }

  /* ---------- 老师团 / 音色 / 设置 ---------- */
  .wrap { max-width:1040px; padding:20px 28px 40px 8px; display:flex; flex-direction:column; gap:16px; }
  .panel { background:var(--surface); border-radius:var(--r-card); overflow:hidden; }
  .panel > header { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:16px 20px; border-bottom:1px solid var(--line-soft); }
  .panel > header h4 { margin:0; font-size:16px; font-weight:600; }
  .panel > header .sub { font:400 12.5px/1.4 var(--sans); color:var(--muted); }
  .panel > header .right { margin-left:auto; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .fb { font-size:13px; color:var(--ok); white-space:pre-wrap; }
  .fb.bad { color:var(--err); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px 18px; padding:18px 20px; }
  .field { display:flex; flex-direction:column; gap:6px; min-width:0; }
  .field label { font-size:12.5px; color:var(--muted); }
  .field input, .field select { height:36px; font-size:14px; padding:0 10px; border:0; box-shadow:0 0 0 1px var(--line); border-radius:9px; background:var(--surface); width:100%; }
  .field input:focus, .field select:focus { outline:0; box-shadow:0 0 0 1.5px var(--accent-line); }
  /* 学科色的色块(拍板 26):自动 + 三门主科 + 八种,都是白字压得住的深色;不开放随便填 */
  .swatches { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .swatches .sw { width:28px; height:28px; border-radius:50%; border:0; box-shadow:inset 0 0 0 2px rgba(255,255,255,.35); cursor:pointer; padding:0; }
  .swatches .sw.auto { width:auto; height:28px; padding:0 12px; border-radius:14px; font-size:12.5px; color:#fff; }
  .swatches .sw.on { box-shadow:0 0 0 2px var(--surface),0 0 0 4px var(--ink); }
  .field.changed input, .field.changed select { box-shadow:0 0 0 1.5px var(--accent); }
  .field.changed > label::after { content:" · 改过"; color:var(--accent); font-weight:600; }
  .field .foot { font:400 12px/1.4 var(--mono); color:var(--muted); }
  .field.chk { flex-direction:row; align-items:center; gap:8px; }
  .field.chk input { width:16px; height:16px; box-shadow:none; }
  .field.chk label { font-size:14px; color:var(--ink); }
  .hint { color:var(--muted); font-size:13px; padding:0 20px 16px; margin:0; }
  .roster .row { display:flex; align-items:center; gap:12px 16px; padding:13px 20px; border-top:1px solid var(--line-soft); cursor:pointer; flex-wrap:wrap; }
  .roster .row:first-child { border-top:0; }
  .roster .row:hover { background:var(--surface-2); }
  .roster .row .name { min-width:150px; display:flex; flex-direction:column; }
  .roster .row .name b { font-size:15px; font-weight:600; }
  .roster .row .name span { font:400 12px/1.5 var(--mono); color:var(--muted); }
  .roster .row .tags { display:flex; gap:6px; flex-wrap:wrap; flex:1; }
  .tag.tuned { background:var(--accent-soft); color:var(--accent); }
  .tag.mute { background:none; box-shadow:inset 0 0 0 1px var(--line); color:var(--muted); }
  .roster .row .caret { width:30px; height:30px; border-radius:8px; background:var(--ground); display:grid; place-items:center; color:var(--ink-2); font-size:12px; flex:none; }
  .roster .row .caret.up svg { transform:rotate(180deg); }
  .roster .row.off { opacity:.55; }
  .rowbody { border-top:1px solid var(--line-soft); background:var(--surface-2); padding:18px 20px 20px; display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px 18px; }
  .rowbody .full { grid-column:1/-1; display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
  .rowbody textarea { grid-column:1/-1; width:100%; min-height:280px; font:13.5px/1.6 var(--mono); padding:10px 12px; border:0; box-shadow:0 0 0 1px var(--line); border-radius:var(--r-ctl); resize:vertical; background:var(--surface); }
  .pathrow { display:grid; grid-template-columns:minmax(124px,188px) minmax(0,1fr) minmax(0,1.1fr); gap:12px; align-items:center; padding:10px 20px; border-top:1px solid var(--line-soft); }
  .pathrow:first-of-type { border-top:0; }
  .pathrow .k { font-size:14px; }
  .pathrow .k small { display:block; color:var(--muted); font-size:12.5px; }
  .pathrow input { height:34px; font:400 13px/1 var(--mono); padding:0 10px; border:0; box-shadow:0 0 0 1px var(--line); border-radius:9px; background:var(--surface); width:100%; }
  .pathrow .resolved { font:400 12px/1.4 var(--mono); color:var(--muted); word-break:break-all; }
  .migrate { box-shadow:0 0 0 1.5px var(--warn-dot); }
  .migrate > header { background:var(--warn-soft); }
  .gaps { margin:0; padding:14px 20px; list-style:none; display:flex; flex-direction:column; gap:7px; }
  .gaps li { display:flex; gap:9px; font-size:14px; align-items:baseline; }
  .gaps li .plus { font:600 13px/1 var(--mono); color:var(--ok); }
  .ttsbox { padding:18px 20px; display:flex; flex-direction:column; gap:10px; }
  .ttsbox textarea { width:100%; min-height:56px; font:13.5px/1.6 var(--mono); padding:9px 12px; border:0; box-shadow:0 0 0 1px var(--line); border-radius:var(--r-ctl); background:var(--surface); resize:vertical; }
  .ttsbox .try { display:flex; gap:9px; align-items:center; flex-wrap:wrap; }

  .field .withbtn { display:flex; gap:6px; align-items:center; }
  .field .withbtn input { flex:1; min-width:0; }
  .field .withbtn .btn { flex:none; height:36px; }
  .voices header .for { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--muted); white-space:nowrap; }
  .voices header .for select { font-size:13.5px; height:34px; padding:0 8px; border:0; box-shadow:0 0 0 1px var(--line); border-radius:9px; background:var(--surface); max-width:180px; }
  .voices .now { display:flex; align-items:center; gap:10px; padding:12px 20px; border-bottom:1px solid var(--line-soft); flex-wrap:wrap; }
  .voices .now small { font:400 12px/1.4 var(--mono); color:var(--muted); }
  .voices .now .muted { color:var(--muted); }
  .handrow { display:flex; align-items:center; gap:10px; padding:12px 20px; flex-wrap:wrap; }
  .handrow .muted { color:var(--muted); }
  .voices .filters { display:flex; gap:8px; padding:12px 20px; border-bottom:1px solid var(--line-soft); flex-wrap:wrap; background:var(--surface-2); }
  .voices .filters input, .voices .filters select { height:34px; font-size:13.5px; padding:0 10px; border:0; box-shadow:0 0 0 1px var(--line); border-radius:9px; background:var(--surface); }
  .voices .filters input[type=search] { flex:1 1 220px; min-width:0; }
  .voices .filters .sample { flex:1 1 100%; }
  .voices .vlist { max-height:calc(100vh - 360px); overflow:auto; }
  .vrow { display:grid; grid-template-columns:auto minmax(150px,1.3fr) 76px minmax(90px,1fr) minmax(80px,1fr) auto auto; align-items:center; gap:12px; padding:9px 20px; border-top:1px solid var(--line-soft); }
  .vrow:first-child { border-top:0; }
  .vrow.mine { background:var(--accent-soft); }
  .vrow .play { min-width:78px; font:500 12.5px/1 var(--mono); }
  .vrow .play.on { box-shadow:0 0 0 1px var(--accent); color:var(--accent); background:var(--accent-soft); }
  .vrow .vname { min-width:0; }
  .vrow .vname b { display:block; font-size:14.5px; font-weight:600; }
  .vrow .vname span { display:block; font:400 11.5px/1.5 var(--mono); color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .vrow .vmeta, .vrow .vtrait, .vrow .vscene { font-size:13px; color:var(--muted); }
  .vrow .vtrait { color:var(--ink); }
  .vrow .tags { display:flex; gap:6px; flex-wrap:wrap; }
  .vrow .pick { font-size:12.5px; height:30px; padding:0 10px; }

  /* ---------- activity(《工作台设计.md》拍板 7–11):列表(每位老师先是新话题 = 老师文件)/ 原文 / 检查·预览·和出厂比 ---------- */
  .act-wrap { max-width:none; }
  .act { display:grid; grid-template-columns:212px minmax(0,1fr) minmax(300px,380px); gap:16px; align-items:start; }
  .alist { display:flex; flex-direction:column; gap:10px; position:sticky; top:0; }
  .alist .grp { display:flex; flex-direction:column; gap:2px; }
  .alist .gh { display:flex; align-items:center; gap:8px; padding:4px 10px 6px; font-size:12.5px; color:var(--muted); }
  .alist .note { margin:4px 10px 0; line-height:1.6; }
  .ai { display:flex; align-items:center; gap:8px; width:100%; padding:8px 10px; border:0; border-radius:var(--r-item); background:none; text-align:left; cursor:pointer; color:var(--ink); }
  .ai:hover { background:rgba(255,255,255,.6); }
  .ai.on { background:var(--surface); box-shadow:0 0 0 1px var(--line); }
  .ai .tx { display:flex; flex-direction:column; min-width:0; flex:1; }
  .ai b { font-size:14px; font-weight:500; }
  .ai.on b { font-weight:600; }
  .ai small { font:400 11px/1.5 var(--mono); color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ai .st { flex:none; font-size:11.5px; }
  .ai.tf:not(:last-child) { margin-bottom:2px; box-shadow:inset 0 -1px 0 var(--line-soft); border-radius:var(--r-item) var(--r-item) 0 0; }
  .ai.tf.on { box-shadow:0 0 0 1px var(--line); border-radius:var(--r-item); }
  .aside details summary { cursor:pointer; font-size:12.5px; color:var(--ink-2); padding:4px 0; }
  .aside details[open] summary { margin-bottom:6px; }
  .ed { display:flex; flex-direction:column; min-width:0; overflow:clip; }
  .ed .banner { display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap; padding:12px 18px; background:var(--warn-soft); }
  .ed .banner[hidden] { display:none; }
  .ed .banner .tx { flex:1 1 260px; min-width:0; font-size:13px; color:var(--ink-2); }
  .ed .banner .st { background:var(--surface); color:var(--warn); }
  .ehead { display:flex; flex-direction:column; gap:6px; padding:16px 18px 12px; }
  .ehead .l1 { display:flex; align-items:center; flex-wrap:wrap; gap:8px 10px; }
  .ehead h2 { margin:0; font-size:20px; font-weight:650; }
  .ehead .right { margin-left:auto; display:flex; align-items:center; gap:8px; }
  .ehead .dirty { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; color:var(--accent); }
  .ehead .dirty::before { content:""; width:7px; height:7px; border-radius:50%; background:var(--accent); }
  .ehead .clean { font-size:12.5px; color:var(--muted); }
  .ehead .l2 { font:400 12px/1.5 var(--mono); color:var(--muted); word-break:break-all; }
  .ehead .l3 { font-size:13px; color:var(--ink-2); }
  .secs { display:flex; gap:4px; overflow-x:auto; padding:8px 12px; background:var(--surface-2); border-top:1px solid var(--line-soft); border-bottom:1px solid var(--line-soft); position:sticky; top:0; z-index:2; }
  .secs button { flex:none; display:flex; flex-direction:column; padding:5px 10px; border:0; border-radius:9px; background:none; cursor:pointer; text-align:left; color:var(--ink); }
  .secs button:hover { background:rgba(255,255,255,.7); }
  .secs button.on { background:var(--surface); box-shadow:0 0 0 1px var(--line); }
  .secs button b { font-size:12.5px; font-weight:400; white-space:nowrap; }
  .secs button.on b { font-weight:600; }
  .secs button small { font-size:10.5px; color:var(--muted); white-space:nowrap; }
  /* 原文:透明的 textarea 叠在逐行底色层上,两层同字、同宽、同折行;textarea 跟着内容长高,不自己滚 */
  .code { position:relative; }
  .code .bd, .code .eta { font:13.5px/24px var(--sans); white-space:pre-wrap; overflow-wrap:anywhere; word-break:normal; letter-spacing:0; tab-size:4; }
  .code .bd { position:absolute; inset:0; padding:10px 18px 14px 0; pointer-events:none; color:transparent; }
  .code .eta { display:block; position:relative; z-index:1; width:100%; min-height:240px; margin:0; border:0; outline:0; resize:none; overflow:hidden; background:transparent; padding:10px 18px 14px 58px; color:var(--ink); caret-color:var(--accent); }
  .ln { position:relative; padding-left:58px; min-height:24px; }
  .ln .no { position:absolute; left:0; top:0; width:44px; text-align:right; font:400 11.5px/24px var(--mono); color:var(--faint); }
  .ln .dt { position:absolute; left:48px; top:9px; width:6px; height:6px; border-radius:50%; }
  .ln .tx { color:transparent; }
  .ln.cur { background:#FBFAF7; }
  .ln.head { background:var(--surface-2); }
  .ln.head .no { color:var(--ink-2); }
  .ln.mod { background:#FDF6F1; } .ln.mod .no { color:var(--accent); } .ln.mod .dt { background:var(--accent); }
  .ln.warn { background:var(--warn-soft); } .ln.warn .no { color:var(--warn); } .ln.warn .dt { background:var(--warn-dot); }
  .ln.bad { background:#FDF4F2; } .ln.bad .no { color:var(--err); } .ln.bad .dt { background:var(--err); }
  .ebar { display:flex; align-items:center; flex-wrap:wrap; gap:6px 14px; padding:9px 18px; background:var(--surface-2); border-top:1px solid var(--line-soft); font-size:12px; color:var(--muted); }
  .ebar .bad { color:var(--err); } .ebar .ok { color:var(--ok); }
  .aside { position:sticky; top:0; max-height:calc(100vh - 40px); overflow:auto; }
  .aside .tabs { padding:12px 14px; border-bottom:1px solid var(--line-soft); position:sticky; top:0; background:var(--surface); z-index:1; }
  .aside .tabs .seg { display:flex; width:100%; }
  .aside .tabs .seg > * { flex:1; justify-content:center; }
  .aside .body { padding:16px 18px 18px; display:flex; flex-direction:column; gap:12px; }
  .aside h3 { margin:0; font-size:13.5px; font-weight:600; }
  .aside .srow { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .ilist { display:flex; flex-direction:column; gap:6px; }
  .iss { display:flex; gap:10px; align-items:flex-start; width:100%; text-align:left; padding:9px 11px; border:0; border-radius:11px; background:var(--surface-2); box-shadow:0 0 0 1px var(--line-soft); cursor:pointer; color:var(--ink); }
  .iss:hover { box-shadow:0 0 0 1px var(--accent-line); }
  .iss b { flex:none; width:52px; font-size:11.5px; line-height:20px; color:var(--warn); }
  .iss.fix b { color:var(--err); }
  .iss span { font-size:12.5px; line-height:20px; color:var(--ink-2); word-break:break-word; }
  .kv2 { display:grid; grid-template-columns:72px minmax(0,1fr); gap:7px 10px; font-size:12.5px; }
  .kv2 .k { color:var(--muted); }
  .kv2 .v { font-size:12px; word-break:break-word; }
  .hb { display:flex; gap:10px; align-items:flex-start; padding:9px 11px; border-radius:11px; background:var(--ground); }
  .hb .tx { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; }
  .hb b { font-size:13px; font-weight:600; }
  .hb small { font-size:12px; color:var(--muted); word-break:break-word; }
  .hb .st { flex:none; }
  .cmd { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:10px; background:var(--ground); }
  .cmd code { flex:1; min-width:0; font:400 12px/1.5 var(--mono); word-break:break-all; }
  .pv { margin:0; max-height:52vh; overflow:auto; padding:12px 14px; border-radius:12px; background:var(--surface-2); box-shadow:0 0 0 1px var(--line-soft); font:12.5px/1.75 var(--sans); white-space:pre-wrap; word-break:break-word; color:var(--ink); }
  .pv.tool { font:12px/1.7 var(--mono); }
  .pvf { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
  .pvf .wide { grid-column:1/-1; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .hunk { border-radius:11px; overflow:hidden; box-shadow:0 0 0 1px var(--line-soft); }
  .hunk .hh { display:block; width:100%; text-align:left; border:0; padding:5px 11px; background:var(--surface-2); font:400 11.5px/1.5 var(--mono); color:var(--muted); cursor:pointer; }
  .hunk .hh:hover { color:var(--accent); }
  .hl { display:grid; grid-template-columns:18px minmax(0,1fr); padding:4px 10px; font-size:12.5px; line-height:1.6; }
  .hl b { font-family:var(--mono); }
  .hl span { word-break:break-word; white-space:pre-wrap; }
  .hl.del { background:var(--err-soft); } .hl.del b { color:var(--err); }
  .hl.add { background:var(--ok-soft); } .hl.add b { color:var(--ok); }
  .modal { position:fixed; inset:0; background:rgba(43,43,43,.28); display:grid; place-items:center; padding:16px; z-index:40; }
  .dlg { width:100%; max-width:480px; max-height:80vh; overflow:auto; background:var(--surface); border-radius:var(--r-card); padding:22px 24px 18px; display:flex; flex-direction:column; gap:12px; box-shadow:0 18px 50px -20px rgba(43,43,43,.45); }
  .dlg h3 { margin:0; font-size:17px; font-weight:650; }
  .dlg p { margin:0; font-size:13.5px; line-height:1.7; color:var(--ink-2); }
  .dlg ul { margin:0; padding-left:20px; font-size:13.5px; line-height:1.8; color:var(--ink-2); }
  .dlg .acts { display:flex; justify-content:flex-end; gap:8px; margin-top:4px; }
  .av.xs { width:22px; height:22px; } .av.xs .face { font-size:10px; }
  #side nav a .badge.err { background:var(--err); }
  @media (max-width:1180px) {
    .act { grid-template-columns:200px minmax(0,1fr); }
    .act > .aside { grid-column:1/-1; position:static; max-height:none; }
  }

  @media (max-width:760px) {
    body { grid-template-columns:1fr; grid-template-rows:auto minmax(0,1fr); }
    #side { flex-direction:row; align-items:center; padding:10px 12px; gap:10px; overflow-x:auto; overflow-y:hidden; border-bottom:1px solid var(--line); }
    #side .ws, #side .health, #side nav .grp, #side nav hr, #side .brand small { display:none; }
    #side nav { flex-direction:row; }
    #side nav a { height:34px; padding:0 10px; }
    main.on { height:auto; }
    #chat.on { grid-template-columns:1fr; padding:12px 16px; height:100%; }
    #chat > aside { display:none; }
    .wrap, #overview .wrap { padding:16px; }
    #drawer { left:0; padding:12px 16px; }
    .dbody { grid-template-columns:1fr; grid-template-rows:auto minmax(0,1fr); }
    .rail { display:flex; gap:4px; overflow-x:auto; }
    .rail button { width:auto; white-space:nowrap; }
    .rail .lab span { display:none; }
    .rl { grid-template-columns:34px minmax(0,1fr); }
    .rl .a { display:none; }
    .pathrow { grid-template-columns:1fr; gap:6px; }
    .vrow { grid-template-columns:auto minmax(0,1fr) auto; row-gap:4px; }
    .vrow .vmeta, .vrow .vscene { display:none; }
    .vrow .vtrait { grid-column:2; }
    .vrow .tags { grid-column:2; }
    .voices .vlist { max-height:none; }
    #composer .row .hint { display:none; }
    .act { grid-template-columns:1fr; }
    .alist { position:static; }
    .voices header .sub .cmd { display:none; }
  }
</style>
<aside id="side">
  <a class="brand ct-hover" href="${BRAND_URL}" target="_blank" rel="noopener" data-cotutor-brand><span class="logo ct-draw">${brandLogo({ size: 18, outer: '#fff', innerOpacity: 0.75 })}</span><b>${BRAND_NAME}</b><small>工作台</small></a>
  <div class="ws"><span class="ini" id="ws-ini">·</span><span><b id="title">cotutor</b><small id="ws-root"></small></span></div>
  <nav>
    <a href="#overview" data-tab="overview"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1h-4.5v-6h-6v6H4.5a1 1 0 0 1-1-1z"/></svg>概览</a>
    <a href="#chat" data-tab="chat"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>对话<span class="badge" id="busy" hidden></span></a>
    <span class="grp">老师</span>
    <a href="#team" data-tab="team"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2"/></svg>老师团</a>
    <a href="#activity" data-tab="activity" title="孩子从首页一个按钮进去的一种做法:看、改、检查、看老师收到什么"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5M9.5 12.5h6M9.5 16h4"/></svg>activity<span class="badge err" id="act-bad" hidden></span></a>
    <a href="#voices" data-tab="voices"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h1.5M7 8.5v7M11 5v14M15 8v8M19 10.5v3"/></svg>音色</a>
    <span class="grp">工具</span>
    <a href="/dev/qr" target="_blank" title="iPad / iPhone 用相机扫,不用输地址"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h3v3h-3zM20.5 14v.5M17 20.5h3.5V17"/></svg>扫码打开<span class="out">↗</span></a>
    <a href="/dev/voice-test" target="_blank" title="按住说话的识别试验页"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>按住说话试验<span class="out">↗</span></a>
    <a href="/dev/voice" target="_blank" title="老师页那颗「头像 + 按住说话」的每一种样子(声音是模拟的);调动画时看这一页"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="12" r="4.5"/><path d="M15 9.5a4 4 0 0 1 0 5M18 7a7.5 7.5 0 0 1 0 10"/></svg>按钮样张<span class="out">↗</span></a>
    <span class="grp">去看</span>
    <a href="/" target="_blank" title="孩子端:孩子在 iPad 上看到的"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M10.5 18h3"/></svg>孩子端<span class="out">↗</span></a>
    <a href="/parent" target="_blank" title="家长端:日常看孩子的板书、看录像、打星、删话题、记账;iPad 上扫码进的就是它"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M9 10h6M9 14h4"/></svg>家长端<span class="out">↗</span></a>
    <hr>
    <a href="#settings" data-tab="settings"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>设置</a>
  </nav>
  <div class="health"><div><span class="dot" id="health-dot"></span><b id="health">……</b></div><small id="health-sub"></small></div>
</aside>
<main id="overview"></main>
<main id="chat">
  <aside>
    <div class="head">老师</div>
    <div id="tutors"></div>
    <p class="foot">淡的 = 孩子端不露的老师,这里照常能说话。</p>
  </aside>
  <section id="thread">
    <div class="thread-top" id="top"></div>
    <div id="msgs"><p class="empty">左边选一位老师</p></div>
    <form id="composer">
      <div class="box">
        <textarea id="text" placeholder="对老师说……" aria-label="对老师说"></textarea>
      </div>
      <div id="photos"></div>
      <div class="row">
        <select id="from" title="以谁的身份说"><option value="kid">身份 孩子</option><option value="system">身份 系统</option></select>
        <select id="runtime" title="运行时"></select>
        <select id="thread-pick" title="接着哪个话题说"></select>
        <label class="photo-btn" title="作业照片:落 captures/,老师自己看图认题"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>照片<input id="photo-in" type="file" accept="image/*" multiple></label>
        <span class="hint">⌘/Ctrl + Enter</span>
        <button type="submit" class="btn primary send" id="send">发送</button>
      </div>
    </form>
  </section>
</main>
<main id="team"></main>
<main id="activity"></main>
<main id="voices"></main>
<main id="settings"></main>
<div id="drawer"></div>
<script>
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f);
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  };
  const api = async (method, path, body) => {
    const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && j.message) || (j && j.error) || (r.status + ' ' + r.statusText));
    return j;
  };
  const copy = (text, btn) => {
    const done = () => { const old = btn.textContent; btn.textContent = '复制好了'; setTimeout(() => { btn.textContent = old; }, 1200); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => {});
    else { const ta = h('textarea', { style: 'position:fixed;left:-9999px' }, text); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); }
  };
  const download = (name, text) => {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: name });
    document.body.append(a);
    a.click();
    a.remove();
  };

  const TABS = ['overview', 'chat', 'team', 'activity', 'voices', 'settings'];
  const hashState = () => {
    // #chat?raw=<job> 开某一轮的看原文;#activity?a=<老师>/<名> 开某个 activity
    const parts = location.hash.slice(1).split('?');
    const tab = parts[0] || 'overview';
    const q = new URLSearchParams(parts[1] || '');
    return { tab: TABS.includes(tab) ? tab : 'overview', raw: q.get('raw'), a: q.get('a') };
  };
  const state = { config: null, tutor: null, date: null, today: null, dates: [], view: null, timer: null, tab: hashState().tab, raw: null, rawJob: null, station: 'source' };

  // ---- 顶栏与标签 ----
  const showTab = (tab) => {
    state.tab = tab;
    for (const a of document.querySelectorAll('#side a[data-tab]')) a.classList.toggle('on', a.dataset.tab === tab);
    for (const m of document.querySelectorAll('main')) m.classList.toggle('on', m.id === tab);
    if (tab === 'overview') renderOverview();
    if (tab === 'activity') renderActivities();
    if (tab === 'team') renderTeam();
    if (tab === 'voices') renderVoices();
    if (tab === 'settings') renderSettings();
    if (tab !== 'voices') stopPreview();
  };
  for (const a of document.querySelectorAll('#side a[data-tab]')) a.addEventListener('click', (e) => { e.preventDefault(); location.hash = '#' + a.dataset.tab; showTab(a.dataset.tab); });

  const refreshHealth = async () => {
    const el = $('#health');
    try {
      const hh = await api('GET', '/api/health');
      // 仓里的提交变了:serve 还跑着起来时那份代码(build.ts,《孩子端流水设计.md》7.1)
      const changed = !hh.configError && hh.changed;
      el.textContent = hh.configError ? 'cotutor.json 改坏了' : changed ? '代码更新了,重起 serve 才用上' : '服务正常';
      el.classList.toggle('bad', Boolean(hh.configError));
      el.classList.toggle('warn', Boolean(changed));
      $('#health-dot').className = 'dot' + (hh.configError ? ' err' : changed ? ' warn' : '');
      const ran = (hh.started ? '起了 ' + ago(hh.started) : '') + (hh.version ? ' · v' + hh.version : '') + (hh.commit ? ' · ' + hh.commit + (hh.dirty ? '*' : '') : '');
      $('#health-sub').textContent = hh.configError ? '仍用上一份:' + hh.configError.split('\\n')[0] : changed ? ran + ' · 仓里是 ' + hh.head : ran;
      $('#health-sub').title = hh.dirty ? '* = 起来时仓里有没提交的改动' : '';
    } catch (e) {
      el.textContent = '后端不通';
      el.classList.add('bad');
      $('#health-dot').className = 'dot err';
      $('#health-sub').textContent = '服务停了,或改了 src/ 正在重起';
    }
  };

  const loadConfig = async () => {
    state.config = await api('GET', '/api/config');
    // 孩子端的设备(《孩子端流水设计.md》§五):对话页每轮写设备名
    state.devices = await api('GET', '/api/dev/devices').catch(() => ({}));
    $('#title').textContent = state.config.title;
    $('#ws-ini').textContent = (state.config.title || '·').slice(0, 1);
    $('#ws-root').textContent = state.config.root || '';
    document.title = state.config.title + ' · 工作台';
    $('#runtime').replaceChildren(...state.config.runtimes.map((p) => h('option', { value: p, selected: p === state.config.runtime }, p === state.config.runtime ? p + '(缺省)' : p)));
    renderTutors();
  };

  // ---- 对话:左栏 ----
  /** 头像:和孩子端同一条判定——是图片路径就走 /api/kid/avatar/<老师>(figshot 写的),否则当 emoji 显示 */
  const isAvatarImage = (v) => Boolean(v) && /\.(png|jpe?g|webp|svg)$/i.test(v);
  /** 学科色(拍板 26):「自动」= 不写 color(三门主科固定色,其余按先后分);点一个色块 = 写进 cotutor.json */
  const colorField = (t, c) => {
    const box = h('div', { class: 'swatches', 'data-f': 'color', 'data-v': t.color || '' });
    const pick = (v) => { box.dataset.v = v; for (const b of box.children) b.classList.toggle('on', (b.dataset.c || '') === v); };
    const sw = (hex, label) => h('button', { type: 'button', class: 'sw' + (hex ? '' : ' auto'), 'data-c': hex, title: label, 'aria-label': label, style: 'background:' + (hex || (t.color ? '#9a958c' : c.colors[t.name])), on: { click: () => pick(hex) } }, hex ? '' : '自动');
    box.append(sw('', '自动'), ...Object.entries(c.palette.subject).map(([s, hex]) => sw(hex, s + '的颜色 ' + hex)), ...c.palette.auto.map((hex) => sw(hex, hex)));
    pick(t.color || '');
    return h('div', { class: 'field', style: 'grid-column:span 2' }, h('label', {}, '学科色(头像的环、新话题气泡,白字压在上面;自动 = 主科固定、其余不撞色)'), box);
  };
  /** 头像:家长首页那个缺口环,环是学科色;size = sm / lg / 空 */
  const RING = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"/></svg>';
  const avatarEl = (t, size) => {
    const el = h('span', { class: 'av' + (size ? ' ' + size : ''), style: 'color:' + ((state.config && state.config.colors[t.name]) || 'var(--muted)') });
    el.innerHTML = RING;
    el.append(h('span', { class: 'face' }, ...(isAvatarImage(t.avatar) ? [h('img', { src: '/api/kid/avatar/' + t.name + '?v=' + avatarV, alt: '' })] : [t.avatar || '🙂'])));
    return el;
  };
  const avatarV = Date.now();
  const renderTutors = () => {
    const list = state.config.tutors.filter((t) => t.enabled);
    if (state.tutor && !list.some((t) => t.name === state.tutor)) { state.tutor = null; state.view = null; $('#msgs').replaceChildren(h('p', { class: 'empty' }, '这位老师已关闭')); }
    $('#tutors').replaceChildren(...list.map((t) => h('div', { class: 'tutor' + (t.name === state.tutor ? ' on' : '') + (t.hidden ? ' hid' : ''), on: { click: () => pickTutor(t.name) } },
      avatarEl(t),
      h('span', { class: 'who' }, h('b', {}, t.display), h('span', {}, t.name + (t.hidden ? ' · 不露脸' : t.subject ? ' · ' + t.subject : ''))))));
  };

  const pickTutor = async (name, date) => {
    state.tutor = name;
    renderTutors();
    const d = await api('GET', '/api/conversations/' + name);
    state.dates = d.dates.includes(d.today) ? d.dates : [d.today, ...d.dates];
    state.today = d.today;
    state.date = date || d.today;
    await loadDay();
  };

  const loadDay = async () => {
    if (!state.tutor || !state.date) return;
    const box = $('#msgs');
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    state.view = await api('GET', '/api/conversations/' + state.tutor + '/' + state.date);
    renderTop();
    renderDay();
    renderThreadPick();
    if (stick) box.scrollTop = box.scrollHeight;
    clearTimeout(state.timer);
    if (state.view.running) state.timer = setTimeout(loadDay, 2000);
    $('#send').disabled = Boolean(state.view.running);
    $('#busy').hidden = !state.view.running;
    $('#busy').textContent = state.view.running ? '在跑' : '';
  };

  // 用时:10 秒内带一位小数,两分钟内整秒,再长按分钟
  const secs = (ms) => (ms < 10000 ? (ms / 1000).toFixed(1) + 's' : ms < 120000 ? Math.round(ms / 1000) + 's' : Math.round(ms / 6000) / 10 + 'min');
  const ago = (iso) => { const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 3600 ? Math.round(s / 60) + ' 分' : s < 86400 ? Math.floor(s / 3600) + ' 时 ' + Math.round((s % 3600) / 60) + ' 分' : Math.floor(s / 86400) + ' 天'; };
  const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const tutorOf = (name) => state.config.tutors.find((x) => x.name === name) || { display: name, avatar: '' };

  const renderTop = () => {
    const t = tutorOf(state.tutor);
    const v = state.view;
    const done = v.index.messages.filter((m) => m.result !== 'running');
    const first = median(done.map((m) => m.timing && m.timing.firstCardMs).filter((x) => x !== undefined && x !== null));
    const whole = median(done.map((m) => m.timing && m.timing.doneMs).filter((x) => x !== undefined && x !== null));
    $('#top').replaceChildren(
      h('span', { class: 'who' }, avatarEl(t), h('span', {}, t.display)),
      h('select', { title: '哪一天', on: { change: (e) => { state.date = e.target.value; loadDay(); } } },
        ...state.dates.map((x) => h('option', { value: x, selected: x === state.date }, x === state.today ? x + '(今天)' : x))),
      h('span', { class: 'today' },
        h('span', {}, (state.date === state.today ? '今日 ' : '这天 '), h('b', {}, String(v.index.messages.length)), ' 轮'),
        h('span', {}, '费用 ', h('b', {}, '$' + v.index.costUsd.toFixed(2))),
        first !== null ? h('span', {}, '首卡中位 ', h('b', {}, secs(first))) : null,
        whole !== null ? h('span', {}, '整轮中位 ', h('b', {}, secs(whole))) : null,
        v.index.session ? h('span', {}, '会话 ' + v.index.session.id.slice(0, 8)) : null,
        // 记账(《obsidian仓库设计.md》§4):这天每个还没记过的话题各起一轮,老师回「## 记账」,应用写进 vault 的日记
        v.index.messages.length ? h('button', { class: 'btn ink small', type: 'button', title: '给这天还没记过的话题记账:话题名、孩子问的话、打分够的摘要、观察,写进 Obsidian 的日记', on: { click: bookkeep } }, '记账') : null));
  };

  const bookkeep = async () => {
    try {
      const r = await api('POST', '/api/conversations/' + state.tutor + '/' + state.date + '/bookkeep', {});
      const lines = [];
      if (r.queued.length) lines.push('记账 ' + r.queued.length + ' 个话题:' + r.queued.join('、') + '(老师在写,一会儿刷新看「已记进日记」)');
      for (const s of r.skipped) lines.push('话题 ' + s.thread + ' 跳过:' + s.why);
      alert(lines.join('\\n') || '没有要记的话题');
      await loadDay();
    } catch (e) { alert(e.message); }
  };

  // 话题打星:1–5,再点同一颗清掉;≥ keepScore 的话题记账时摘要与骨架才进日记,低的只记孩子问的话与观察
  const starsEl = (id) => {
    const cur = (state.view.index.ratings || {})[id] || 0;
    const booked = (state.view.index.booked || {})[id];
    const row = h('span', { class: 'stars', title: '这个话题值不值得记进日记:打分够了记账时摘要才进;再点同一颗清掉' });
    for (let i = 1; i <= 5; i++) row.append(h('button', { type: 'button', class: 'star' + (i <= cur ? ' on' : ''), on: { click: async () => {
      try { await api('PUT', '/api/conversations/' + state.tutor + '/' + state.date + '/threads/' + encodeURIComponent(id) + '/rating', { rating: i === cur ? null : i }); await loadDay(); } catch (e) { alert(e.message); }
    } } }, '★'));
    return h('span', { class: 'thread-head' }, row, booked ? h('span', { class: 'booked' }, '已记进日记') : null);
  };

  const renderThreadPick = () => {
    const list = [];
    const seen = new Set();
    for (const m of state.view.index.messages) {
      const id = m.thread || m.job;
      if (!seen.has(id)) { seen.add(id); list.push({ id, text: m.text }); }
    }
    $('#thread-pick').replaceChildren(
      h('option', { value: '' }, list.length ? '接着当前话题' : '新话题'),
      h('option', { value: 'new' }, '＋ 新话题'),
      ...list.map((x) => h('option', { value: x.id }, '话题 ' + x.id + ' ' + x.text.slice(0, 10))));
  };

  // ---- 板书:按 kind 渲染成卡,不把围栏原文倒给家长 ----
  const marked = (line) => {
    const el = h('p', {});
    const phrases = (line.marks || []).map((m) => m.phrase).filter(Boolean);
    let rest = line.text;
    if (!phrases.length) { el.textContent = rest; return el; }
    while (rest) {
      let at = -1;
      let word = '';
      for (const p of phrases) { const i = rest.indexOf(p); if (i >= 0 && (at < 0 || i < at)) { at = i; word = p; } }
      if (at < 0) { el.append(rest); break; }
      if (at > 0) el.append(rest.slice(0, at));
      el.append(h('mark', {}, word));
      rest = rest.slice(at + word.length);
    }
    return el;
  };

  const KIND_LABEL = { text: '文字', read: '点读', choice: '选择', fill: '填空', image: '图片', tianzige: '田字格', word: '单词', lecture: '小课堂', canvas: '画板', code: '原样' };
  const cardEl = (card, n) => {
    const p = card.props || {};
    const style = card.kind === 'text' ? (p.style || 'plain') : '';
    const box = h('div', { class: 'card ' + card.kind + ' ' + style });
    box.append(h('div', { class: 'kindbar' }, h('i', {}), card.kind + (p.style ? ' · ' + p.style : ''), h('span', { class: 'more' }, '卡 ' + (n + 1) + ' · ' + (p.ask === true ? '提问(应用补的)' : KIND_LABEL[card.kind] || card.kind))));
    const body = h('div', { class: 'body' });
    if (card.kind === 'text') body.append(...(p.title ? [h('b', {}, p.title)] : []), h('p', { style: 'margin:0' }, p.text || ''));
    else if (card.kind === 'read') body.append(...(p.segments || []).map((s) => h('span', { class: 'rseg' }, s)));
    else if (card.kind === 'choice') {
      const ans = p.answer || [];
      body.append(h('div', {}, p.question || ''));
      (p.options || []).forEach((o, i) => body.append(h('div', { class: 'opt' + (ans.includes(i) ? ' right' : '') },
        h('span', { class: 'k' }, 'ABCDEFGHIJ'[i] || String(i + 1)), o, ans.includes(i) ? h('span', { class: 'ans' }, '答案') : null)));
      if (p.multi) body.append(h('div', { class: 'meta2' }, '多选'));
    } else if (card.kind === 'fill') {
      const row = h('div', { class: 'fillline' });
      const parts = String(p.text || '').split(/_{2,}/);
      parts.forEach((s, i) => { row.append(s); if (i < parts.length - 1) row.append(h('u', {}, (p.answers || [])[i] || '　')); });
      body.append(row, p.answers ? h('div', { class: 'meta2' }, '答案:' + p.answers.join(' / ')) : null);
    } else if (card.kind === 'image') {
      body.append(h('img', { src: /^https?:/.test(p.src || '') ? p.src : '/api/kid/image?p=' + encodeURIComponent(p.src || ''), alt: p.caption || '' }), p.caption ? h('p', {}, p.caption) : null);
    } else if (card.kind === 'lecture') {
      body.append(h('div', {}, h('b', {}, p.title || p.bundle), p.ready === false ? h('span', { class: 'meta2' }, ' · 课读不出来') : null),
        p.text ? h('p', {}, p.text) : null,
        h('div', { class: 'meta2' }, '课 ' + p.bundle + (typeof p.from === 'number' ? ' · ' + Math.floor(p.from / 60000) + ':' + String(Math.floor(p.from / 1000) % 60).padStart(2, '0') + (typeof p.to === 'number' ? '–' + Math.floor(p.to / 60000) + ':' + String(Math.floor(p.to / 1000) % 60).padStart(2, '0') : '') : '')));
    } else if (card.kind === 'canvas') {
      body.append(h('div', {}, p.prompt || '(没写题目)'),
        h('div', { class: 'meta2' }, p.base && p.base.bundle ? '底图课包 ' + p.base.bundle : p.base && p.base.skeletons ? '行内骨架 ' + p.base.skeletons.length + ' 个' : '空白画板'));
    } else body.append(h('pre', {}, p.text || ''));
    box.append(body);
    return box;
  };

  /** 卡与讲稿按原来的顺序摆回去:句子的 anchor = 它前面最后一张卡 */
  const boardEl = (section) => {
    const box = h('div', { class: 'board' });
    let put = 0;
    const flush = (upto) => { while (put <= upto && put < section.cards.length) { box.append(cardEl(section.cards[put], put)); put++; } };
    section.lines.forEach((l, i) => {
      flush(l.anchor === null || l.anchor === undefined ? -1 : l.anchor);
      // 孩子端只在末句问句停下(kid-board 的 advance);中间的问句念完就接下一句,不缀
      const waits = l.ask && i === section.lines.length - 1;
      box.append(h('div', { class: 'line' + (waits ? ' ask-line' : '') }, h('span', { class: 'n' }, String(i + 1)), marked(l)));
    });
    flush(section.cards.length - 1);
    return box;
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

  const FROM = { kid: '孩子', system: '系统' };
  const SLOW_FIRST = 15000;

  /** 一轮一张卡:问句 → 板书 → 埋点 → 孩子看到 → 通知块,五段各有自己的容器与颜色 */
  const turnEl = (m) => {
    const v = state.view;
    const t = tutorOf(state.tutor);
    const el = h('article', { class: 'turn' + (m.result === 'error' ? ' bad' : '') });
    const q = h('div', { class: 'q' }, m.text);
    if (m.cards && m.cards.length) q.append(h('span', { class: 'did' }, '板书上做的 · ', ...m.cards.map((c) => h('span', {}, c.card + ' ' + c.text + ' '))));
    if (m.focus && m.focus.card) q.append(h('span', { class: 'did' }, '开着 ' + m.focus.card));
    // 作业照片(R5):缩略图,点开看原图(转录里能看到老师 Read 了哪张)
    if (m.photos && m.photos.length) q.append(h('div', { class: 'photos' }, ...m.photos.map((p) => h('a', { href: '/api/kid/image?p=' + encodeURIComponent(p), target: '_blank', title: p }, h('img', { src: '/api/kid/image?p=' + encodeURIComponent(p), alt: p, loading: 'lazy' })))));
    el.append(h('div', { class: 'ask from-' + m.from },
      h('span', { class: 'tag' }, FROM[m.from] || m.from),
      q,
      h('span', { class: 'when' }, m.at.slice(11) + ' · ' + m.job + (m.action === 'continue' ? ' · 继续' : m.action === 'submit' ? ' · 交答案' : '') + (m.via ? ' · 首页「' + m.via.label + '」' : '') + (m.continues ? ' · 接着 ' + m.continues.date + ' ' + m.continues.thread : ''))));

    if (m.section && (m.section.cards.length || m.section.lines.length)) el.append(boardEl(m.section));
    else if (m.result === 'ok' && m.kidText) el.append(h('div', { class: 'board' }, h('div', { class: 'line' }, h('span', { class: 'n' }, '1'), h('p', {}, m.kidText))));

    const foot = h('div', { class: 'turn-foot' }, h('span', { class: 'chip' }, (isAvatarImage(t.avatar) ? '' : (t.avatar || '') + ' ') + t.display));
    if (m.timing) {
      if (m.timing.firstReadyMs !== undefined) foot.append(h('span', { class: 'chip' + (m.timing.firstReadyMs > SLOW_FIRST ? ' slow' : '') }, '首句就绪 ', h('b', {}, secs(m.timing.firstReadyMs))));
      if (m.timing.firstCardMs !== undefined) foot.append(h('span', { class: 'chip' + (m.timing.firstCardMs > SLOW_FIRST ? ' slow' : '') }, '首卡 ', h('b', {}, secs(m.timing.firstCardMs))));
      if (m.timing.doneMs !== undefined) foot.append(h('span', { class: 'chip' }, '整轮 ', h('b', {}, secs(m.timing.doneMs))));
      if (m.timing.dubbedMs !== undefined) foot.append(h('span', { class: 'chip' }, '配音 ', h('b', {}, secs(m.timing.dubbedMs))));
    }
    if (m.costUsd !== undefined) foot.append(h('span', { class: 'chip money' }, '$', h('b', {}, m.costUsd.toFixed(2))));
    else if (m.tokens) foot.append(h('span', { class: 'chip money', title: '这个运行时不报钱数,只报 token(输入 / 输出)' }, h('b', {}, m.tokens.in + ' / ' + m.tokens.out), ' token'));
    if (m.artifacts && m.artifacts.length) foot.append(h('span', { class: 'chip' }, '课包 ' + m.artifacts.join(', ')));
    if (m.deviceId) { const dv = (state.devices || {})[m.deviceId]; foot.append(h('span', { class: 'chip', title: '孩子端开在哪台设备上(概览的设备卡里起名)' }, dv ? dv.name || dv.label : '设备 ' + m.deviceId.slice(0, 4))); }
    const rows = v.runs[m.job] || [];
    const trace = h('div', { class: 'trace', style: 'display:none' }, ...rowsEl(rows));
    const traceBtn = h('button', { class: 'linkish', type: 'button', on: { click: () => {
      const on = trace.style.display === 'none';
      trace.style.display = on ? 'block' : 'none';
      traceBtn.classList.toggle('on', on);
    } } }, '转录 ' + rows.length);
    foot.append(h('span', { class: 'right' },
      h('button', { class: 'linkish go', type: 'button', on: { click: () => openRaw(m.job) } }, '看原文'),
      rows.length ? traceBtn : null));
    el.append(foot, trace);

    if (m.result === 'ok') {
      const kid = h('p', {});
      if (m.kidText) kid.append(m.kidText.replace(/\\n/g, ' '));
      else kid.append(h('span', {}, '(这轮没有给孩子的话)'));
      if (m.section) kid.append(h('span', {}, ' · 板书 ' + m.section.cards.length + ' 张卡 ' + m.section.lines.length + ' 句'));
      el.append(h('div', { class: 'kidview' }, h('span', { class: 'lab' }, '孩子看到'), kid));
    }
    if (m.parentText) el.append(h('div', { class: 'kidview parent' }, h('span', { class: 'lab' }, '给家长'), h('p', {}, m.parentText.replace(/^## 家长\\s*/, ''))));

    if (m.result === 'error') el.append(h('div', { class: 'notice err' }, h('span', { class: 'ico' }, '!'), h('div', {}, h('h5', {}, '本轮出错:' + (m.error || '未知')), h('p', {}, v.errors[m.job] || ''))));
    if (m.remembered && m.remembered.length) el.append(h('div', { class: 'notice note' }, h('span', { class: 'ico' }, '✎'), h('div', {}, h('h5', {}, (m.tidy ? '整理了记忆' : '记住了') + '(vault 里' + t.display + '的记忆文件,在 Obsidian 里可以改、删)'), h('p', {}, m.remembered.join('\\n')))));
    if (m.warnings && m.warnings.length) el.append(h('div', { class: 'notice warn' }, h('span', { class: 'ico' }, 'i'), h('div', {}, h('h5', {}, '提醒'), h('p', {}, m.warnings.join('\\n')))));
    if (m.result === 'running') el.append(h('div', { class: 'running' + (v.running === m.job ? '' : ' dead') }, v.running === m.job ? '老师在想……' : '(没跑完:服务重启过或进程被杀,看原文里的转录)'));
    return el;
  };

  const renderDay = () => {
    const v = state.view;
    const t = tutorOf(state.tutor);
    if (!v.index.messages.length) { $('#msgs').replaceChildren(h('p', { class: 'empty' }, state.date + ' 还没和' + t.display + '说过话')); return; }
    // 话题:每个话题第一条前一行头(几点开的 + 打星 + 记没记进日记);一天多个话题时再写「新话题」
    const multi = new Set(v.index.messages.map((m) => m.thread || m.job)).size > 1;
    const seen = new Set();
    const nodes = [];
    for (const m of v.index.messages) {
      const id = m.thread || m.job;
      if (!seen.has(id)) { seen.add(id); nodes.push(h('div', { class: 'sep' }, h('span', {}, h('b', {}, multi ? (seen.size === 1 ? '第一个话题' : '新话题') : '话题'), ' · ' + m.at.slice(11, 16) + ' 起'), starsEl(id))); }
      nodes.push(turnEl(m));
    }
    $('#msgs').replaceChildren(h('div', { class: 'stream' }, ...nodes));
  };

  // 作业照片(R5):选了先缩到长边 2000 传上去(与孩子端同一条路;数字同 photo-edit.ts 的 PHOTO_MAX_SIDE,页面脚本里不能插值,photo-edit.test 盯着两边一致),path 攒在 state.photos,发消息时一起带上
  state.photos = [];
  const shrink = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); try { const k = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight, 1)); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); resolve(c.toDataURL('image/jpeg', 0.82)); } catch (e) { reject(e); } };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图读不出')); };
    im.src = url;
  });
  const renderPhotos = () => $('#photos').replaceChildren(...state.photos.map((p, i) => h('div', { class: 'p' }, h('img', { src: '/api/kid/image?p=' + encodeURIComponent(p), alt: p, title: p }), h('button', { class: 'x', type: 'button', title: '去掉', on: { click: () => { state.photos.splice(i, 1); renderPhotos(); } } }, '×'))));
  $('#photo-in').addEventListener('change', async (e) => {
    if (!state.tutor) { e.target.value = ''; return alert('先选一位老师'); }
    const files = [...(e.target.files || [])]; e.target.value = '';
    for (const f of files) {
      try { const r = await api('POST', '/api/conversations/' + state.tutor + '/photos', { image: await shrink(f) }); state.photos.push(r.path); renderPhotos(); } catch (err) { alert('照片没传上:' + err.message); }
    }
  });
  const send = async (text, from, extra) => {
    if (!state.tutor) return alert('先选一位老师');
    const pick = $('#thread-pick').value;
    const body = Object.assign({ text, from: from || $('#from').value, runtime: $('#runtime').value }, pick === 'new' ? { newThread: true } : pick ? { thread: pick } : {}, state.photos.length ? { photos: state.photos.slice() } : {}, extra || {});
    try {
      $('#send').disabled = true;
      await api('POST', '/api/conversations/' + state.tutor + '/messages', body);
      $('#text').value = '';
      state.photos = []; renderPhotos();
      if (state.date !== state.today) await pickTutor(state.tutor, state.today);
      else await loadDay();
    } catch (e) {
      alert(e.message);
      $('#send').disabled = false;
    }
  };
  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); const t = $('#text').value.trim(); if (t || state.photos.length) send(t); });
  $('#text').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); $('#composer').requestSubmit(); } });

  // ---- 看原文:一轮拆成六站 ----
  const openRaw = async (job) => {
    state.raw = null;
    state.rawJob = job;
    $('#drawer').classList.add('on');
    $('#drawer').replaceChildren(h('div', { class: 'dsec' }, '读……'));
    if (state.tab === 'chat') location.hash = '#chat?raw=' + job;
    try {
      state.raw = await api('GET', '/api/conversations/' + state.tutor + '/' + state.date + '/raw/' + job);
      if (!state.raw.stations.some((s) => s.id === state.station)) state.station = 'source';
      renderRaw();
    } catch (e) {
      $('#drawer').replaceChildren(h('div', { class: 'dsec' }, h('p', {}, '读不到:' + e.message), h('button', { class: 'btn', on: { click: closeRaw } }, '关')));
    }
  };
  const closeRaw = () => {
    $('#drawer').classList.remove('on');
    state.raw = null;
    state.rawJob = null;
    if (location.hash.includes('?raw=')) location.hash = '#chat';
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.rawJob) closeRaw(); });

  /** 原文一行 + 右边那句「解析器把它当什么了」;这一行有提醒就跟一条黄条 */
  const rawLineEl = (r, warns) => {
    const hit = warns.filter((w) => w.line === r.line);
    const out = [h('div', { class: 'rl ' + r.role + (r.open ? ' open' : '') + (hit.length ? ' warnline' : '') },
      h('span', { class: 'n' }, String(r.line + 1)),
      h('span', { class: 't' }, r.text || ' '),
      h('span', { class: 'a' }, r.label || ''))];
    for (const w of hit) out.push(h('div', { class: 'rawwarn' }, h('b', {}, '第 ' + (r.line + 1) + ' 行'), w.text));
    return out;
  };

  const stationEl = (raw) => {
    const s = state.station;
    if (s === 'pack') {
      if (!raw.pack) return h('div', { class: 'dsec' }, h('p', { class: 'hintline' }, '这一轮没落上下文包(装新版之前跑的)。从现在起每轮都落一份 conversations/<老师>/<日期>.<job>.run.json。'));
      const cmd = raw.pack.argv.map((a) => (/[\\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');
      return h('div', { class: 'dsec' },
        h('h5', {}, '发给老师的(消息正文在最后)'),
        h('pre', {}, raw.pack.prompt),
        h('h5', {}, '命令行 · ' + raw.pack.runtime + (raw.pack.resume ? ' · resume ' + (raw.pack.session || '') : ' · 新开会话') + (raw.pack.agentBody ? ' · 老师正文塞在 {agentBody}' : '')),
        h('pre', {}, cmd),
        raw.pack.sources ? h('p', { class: 'hintline' }, '当时的老师文件 ' + (raw.pack.sources.agent ? raw.pack.sources.agent.file + ' ' + raw.pack.sources.agent.hash.slice(7) : '(读不到)') + ' · 技能 ' + Object.entries(raw.pack.sources.skills).map(([k, v]) => k + ' ' + v.slice(7, 13)).join(' / ') + '(正文在 run.json 的 sources 里;cotutor show --json 吐)') : h('p', { class: 'hintline' }, '这轮没记老师文件与技能的快照(2026-09-15 之前跑的)'),
        h('div', {},
          h('button', { class: 'btn', type: 'button', on: { click: (e) => copy(raw.pack.prompt, e.target) } }, '复制上下文包'),
          ' ',
          h('button', { class: 'btn', type: 'button', on: { click: (e) => copy(cmd, e.target) } }, '复制命令行')));
    }
    if (s === 'timeline') {
      const box = h('div', { class: 'dsec' });
      const ev = raw.events || [];
      if (!ev.length) { box.append(h('p', { class: 'hintline' }, raw.stations.find((x) => x.id === 'timeline')?.note || '这轮没有事件。')); return box; }
      const spans = raw.timeline.spans;
      // 嘴这一道(实时)从老师进程起来之前开始:t 是负的,整条往右挪 lo
      const lo = raw.timeline.from || 0;
      const total = raw.timeline.total - lo;
      const lanes = ['mouth', 'main', 'tts', 'ready', 'index', 'ledger'].filter((l) => spans.some((x) => x.lane === l));
      const detail = h('p', { class: 'hintline' }, '点一段看它是什么');
      const g = h('div', { class: 'gantt' });
      for (const l of lanes) {
        const tr = h('div', { class: 'tr' });
        for (const x of spans.filter((x) => x.lane === l)) {
          const left = ((x.from - lo) / total) * 100, w = Math.max(0.4, ((x.to - x.from) / total) * 100);
          const el = h('div', { class: 'sp ' + x.state + (x.to === x.from ? ' tick' : ''), style: 'left:' + left.toFixed(2) + '%;width:' + w.toFixed(2) + '%', title: (x.from / 1000).toFixed(2) + 's ' + x.label, on: { click: () => { for (const o of g.querySelectorAll('.sp.on')) o.classList.remove('on'); el.classList.add('on'); detail.textContent = (x.from / 1000).toFixed(2) + 's → ' + (x.to / 1000).toFixed(2) + 's · ' + l + ' · ' + x.label; } } });
          tr.append(el);
        }
        g.append(h('div', { class: 'ln' }, l), tr);
      }
      g.append(h('div', { class: 'ax' }, h('span', {}, (lo / 1000).toFixed(1) + 's'), h('span', {}, ((lo + total / 2) / 1000).toFixed(1) + 's'), h('span', {}, ((lo + total) / 1000).toFixed(1) + 's')));
      box.append(h('h5', {}, '时间线:每道工序什么时候起、什么时候回(从老师进程起算;实时的嘴这一道从孩子按下起,负的)'), g, detail);
      if (raw.timing && raw.timing.beats && raw.timing.beats.length) box.append(h('h5', {}, '每拍'), h('pre', {}, raw.timing.beats.map((b, i) => '拍 ' + i + (b.card === null ? '(没有卡)' : '(卡 ' + b.card + ')') + ':关 ' + (b.closedMs !== undefined ? (b.closedMs / 1000).toFixed(2) + 's' : '-') + ' · 配音齐 ' + (b.dubbedMs !== undefined ? (b.dubbedMs / 1000).toFixed(2) + 's' : '-') + ' · 就绪 ' + (b.readyMs !== undefined ? (b.readyMs / 1000).toFixed(2) + 's' : '-')).join('\\n')));
      box.append(h('details', {}, h('summary', {}, '全部事件 ' + ev.length + ' 条'), h('pre', {}, raw.timeline.lines.join('\\n'))));
      return box;
    }
    if (s === 'source') {
      const box = h('div', {});
      box.append(h('div', { class: 'ctop' },
        h('span', {}, raw.files.log),
        h('span', {}, (raw.source.text ? raw.source.text.split('\\n').length : 0) + ' 行'),
        h('span', { class: 'right' },
          h('button', { class: 'linkish', type: 'button', on: { click: (e) => copy(raw.source.text, e.target) } }, '复制原文'),
          h('button', { class: 'linkish', type: 'button', on: { click: () => api('GET', '/api/conversations/' + raw.tutor + '/' + raw.date + '/raw/' + raw.job + '/fixture').then((f) => download(f.name, f.text)) } }, '存成 fixture'))));
      if (!raw.source.text) box.append(h('div', { class: 'dsec' }, h('p', { class: 'hintline' }, '这轮没有正文(出错、还在跑,或老师只用了工具)。看「转录与报错」那一站。')));
      const lines = h('div', { class: 'raw' });
      for (const r of raw.source.rows) lines.append(...rawLineEl(r, raw.source.warnings));
      box.append(lines);
      if (raw.dropped.length) {
        const d = h('details', { class: 'dsec' }, h('summary', {}, '没进板书正文的中间话 · ' + raw.dropped.length + ' 段'));
        for (const b of raw.dropped) d.append(h('pre', {}, b));
        box.append(d);
      }
      return box;
    }
    if (s === 'parse') {
      const box = h('div', { class: 'dsec' });
      box.append(h('h5', {}, raw.fresh.same ? '用当前解析器重解 = 索引里存的' : '用当前解析器重解,与索引里存的不一样'));
      for (const d of raw.fresh.diff) box.append(h('div', { class: 'dline ' + (d.s === '+' ? 'add' : d.s === '-' ? 'del' : 'same') }, h('span', { class: 's' }, d.s), h('span', {}, d.text)));
      if (!raw.fresh.diff.length) box.append(h('p', { class: 'hintline' }, '这轮没有板书。'));
      box.append(h('p', { class: 'hintline' }, '索引是物化的:这一轮存的是当时那版解析器的结果。改完 parseBoard 想知道老样本会不会变,就在这里看差异——确认好了再回上一站「存成 fixture」。'));
      const warns = raw.fresh.warnings.concat((raw.stored.warnings || []).map((x) => ({ text: x })));
      if (warns.length) {
        box.append(h('h5', {}, '提醒 ' + warns.length + ' 条'));
        for (const w of warns) box.append(h('p', { class: 'hintline' }, (w.line !== undefined ? '第 ' + (w.line + 1) + ' 行:' : '') + w.text));
      }
      box.append(h('details', {}, h('summary', {}, '解析出来的 JSON'), h('pre', {}, JSON.stringify(raw.fresh.section, null, 2))));
      return box;
    }
    if (s === 'kid' || s === 'audio') {
      const box = h('div', { class: 'dsec' });
      box.append(h('h5', {}, '讲稿(真发给孩子的那一份)'));
      raw.kid.lines.forEach((l, i) => box.append(h('div', { class: 'kline' },
        h('span', { class: 'n2' }, String(i + 1)),
        h('span', {}, l.text, l.cut ? h('span', { class: 'cut' }, l.cut) : null),
        h('span', { class: 'au' + (l.audio ? (l.audioOk ? '' : ' bad') : ' none') }, l.audio ? (l.audioOk ? 'mp3 ✓' : '文件不在') : '没配音 · 退浏览器合成'))));
      if (!raw.kid.lines.length) box.append(h('p', { class: 'hintline' }, '这轮没有讲稿。'));
      if (raw.kid.lines.some((l) => l.cut)) box.append(h('p', { class: 'hintline' }, '删除线是按 replyMaxChars 截掉的部分:孩子看不到,也不念。'));
      box.append(h('h5', {}, '卡 ' + raw.kid.cards.length + ' 张(答案已剥,孩子拿到的就是这个)'));
      for (const c of raw.kid.cards) {
        box.append(h('div', { class: 'kline' },
          h('span', { class: 'n2' }, String(c.n + 1)),
          h('span', {}, c.kind + '「' + c.label + '」', c.state ? h('span', { class: 'kidstate' }, ' · 孩子:' + c.state) : null),
          h('span', { class: 'au' + (c.assets.length ? '' : ' none') }, c.assets.length ? c.assets.length + ' 个资产' : '无资产')));
        box.append(h('details', {}, h('summary', {}, '下发的 props'), h('pre', {}, JSON.stringify(c.props, null, 2))));
      }
      return box;
    }
    if (s === 'tools') {
      // 读了什么(2026-09-15):一行一次工具调用——名字、路径 / 命令、成没成、结果多少字;答「老师为什么没看见档案那一行」
      const box = h('div', { class: 'dsec' });
      if (!raw.tools.length) { box.append(h('p', { class: 'hintline' }, '这轮没用工具:老师只凭上下文包答的(问答缺省就是这样)。')); return box; }
      const files = [...new Set(raw.tools.filter((t) => t.kind === 'read' && t.arg).map((t) => t.arg))];
      box.append(h('h5', {}, raw.tools.length + ' 次工具调用' + (files.length ? ' · 读了 ' + files.length + ' 个文件' : '')));
      for (const t of raw.tools) box.append(h('div', { class: 'dline ' + (t.ok === false ? 'del' : 'same') },
        h('span', { class: 's' }, t.ok === false ? '✗' : t.ok === null ? '?' : '·'),
        h('span', {}, t.name + (t.sub ? '(子代理)' : '') + '  ' + (t.arg || '') + (t.chars ? '  → ' + t.chars + ' 字' : ''))));
      box.append(h('p', { class: 'hintline' }, '✗ 报错 · ? 没等到结果(被杀或还在跑)。完整的参数与结果在 conversations/ 的 .log 里;cotutor show <老师> <job> --json 一次吐这一轮全部。'));
      return box;
    }
    if (s === 'trace') {
      const box = h('div', { class: 'dsec' });
      box.append(h('h5', {}, '转录 ' + raw.trace.length + ' 条'), h('div', { class: 'trace' }, ...rowsEl(raw.trace)));
      if (raw.error) box.append(h('h5', {}, '收尾:' + raw.error));
      box.append(h('h5', {}, 'stderr' + (raw.err ? '' : '(空)')));
      if (raw.err) box.append(h('pre', {}, raw.err));
      return box;
    }
    return h('div', { class: 'dsec' }, h('h5', {}, '这一轮的产物'), h('pre', {}, JSON.stringify(raw.stations.find((x) => x.id === 'ledger') || {}, null, 2)));
  };

  const renderRaw = () => {
    const raw = state.raw;
    const all = () => [raw.pack ? '# 上下文包\\n' + raw.pack.prompt : '', '# 老师原文\\n' + raw.source.text, raw.pack ? '# 命令行\\n' + raw.pack.argv.join(' ') : ''].filter(Boolean).join('\\n\\n');
    $('#drawer').replaceChildren(
      h('div', { class: 'dhead' },
        h('div', { class: 'crumb' },
          h('button', { type: 'button', on: { click: closeRaw } }, '对话'), h('span', { 'aria-hidden': 'true' }, '/'),
          h('button', { type: 'button', on: { click: closeRaw } }, tutorOf(raw.tutor).display), h('span', { 'aria-hidden': 'true' }, '/'),
          h('span', {}, raw.at)),
        h('div', { class: 'line2' },
          h('h1', {}, '看原文'),
          h('span', { class: 'jobid' }, raw.job),
          raw.runtime ? h('span', { class: 'who2' }, raw.runtime) : null,
          h('span', { class: 'acts' },
            h('button', { class: 'btn', type: 'button', on: { click: (e) => copy(all(), e.target) } }, '复制整轮'),
            h('button', { class: 'btn', type: 'button', on: { click: () => openRaw(raw.job) } }, '重读'),
            h('button', { class: 'btn ink', type: 'button', on: { click: closeRaw } }, '关 Esc')))),
      h('div', { class: 'dbody' },
        h('nav', { class: 'rail' }, ...raw.stations.map((st) => h('button', { class: state.station === st.id ? 'on' : '', type: 'button', on: { click: () => { state.station = st.id; renderRaw(); } } },
          h('span', { class: 'dot' + (st.state === 'ok' ? '' : st.state === 'none' ? ' off' : ' ' + st.state) }),
          h('span', { class: 'lab' }, h('b', {}, st.title), h('span', {}, st.note))))),
        h('div', { class: 'dcontent' }, stationEl(raw))));
  };

  // ---- 老师团:一位一行,政策折叠,改过的才亮 ----
  const POLICY_FIELDS = [['replyMaxChars', '每句字数上限', 'number'], ['effort', '动笔前想多久(low = 开口快;medium = 多想一会儿,算题用;high = 最慢最细)', 'enum', ['low', 'medium', 'high']], ['tools', '孩子的话带不带工具(off = 不带,开口快;on = 能查教材、读 vault,慢)', 'enum', ['off', 'on']], ['board', '板书(auto = 老师判断;off = 只说话)', 'enum', ['auto', 'off']], ['contextPack.recent', '上下文包:最近观察条数', 'number'], ['contextPack.planLines', '上下文包:计划行数', 'number'], ['contextPack.entryChars', '上下文包:档案 / 入口文件 / 记忆各带多少字', 'number']];
  const SHORT = { replyMaxChars: '每句 ', effort: '思考 ', tools: '工具 ', board: '板书 ', 'contextPack.recent': '观察 ', 'contextPack.planLines': '计划 ', 'contextPack.entryChars': '原文 ' };
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const setPath = (o, p, v) => { const ks = p.split('.'); let cur = o; for (const k of ks.slice(0, -1)) cur = cur[k] = cur[k] || {}; cur[ks[ks.length - 1]] = v; };

  const policyFields = (patch, effective, opts) => POLICY_FIELDS.map(([key, label, type, choices]) => {
    const cur = getPath(patch, key);
    const eff = getPath(effective, key);
    const changed = cur !== undefined;
    const box = h('div', { class: 'field' + (changed ? ' changed' : '') }, h('label', {}, label));
    if (type === 'enum') {
      // 空选项 = 不写这一项(老师行上是「继承」,全局是「缺省」),免得一保存就把缺省值写死进文件
      box.append(h('select', { 'data-key': key }, h('option', { value: '', selected: !changed }, (opts.inherit ? '继承(' : '缺省(') + eff + ')'), ...choices.map((o) => h('option', { value: o, selected: cur === o }, o))));
    } else {
      box.append(h('input', { type: 'number', 'data-key': key, value: cur === undefined ? '' : String(cur), placeholder: (opts.inherit ? '继承 ' : '') + eff }));
    }
    if (changed && opts.inherit) box.append(h('span', { class: 'foot' }, '全局 ' + String(eff) + ' · 改过'));
    return box;
  });
  const readPolicy = (card) => {
    const out = {};
    for (const el of card.querySelectorAll('[data-key]')) {
      const key = el.dataset.key;
      const type = POLICY_FIELDS.find((f) => f[0] === key)[2];
      const raw = el.value.trim();
      if (raw === '') { setPath(out, key, null); continue; }
      if (type === 'number') { const n = Number(raw); if (!Number.isInteger(n)) throw new Error(key + ' 要是整数'); setPath(out, key, n); }
      else setPath(out, key, raw);
    }
    return out;
  };
  const feedback = (card, ok, text) => { const m = $('.fb', card); if (!m) return; m.className = 'fb' + (ok ? '' : ' bad'); m.textContent = text; };
  const patchAndReload = async (card, patch, after) => {
    try {
      await api('PATCH', '/api/config', patch);
      await loadConfig();
      feedback(card, true, '已写入 cotutor.json');
      if (after) after();
    } catch (e) { feedback(card, false, e.message); }
  };

  /** 行上只挂「改过的」政策,谁被调过一眼看得出 */
  const tutorTags = (t, patch) => {
    const out = [];
    if (t.hidden) out.push(h('span', { class: 'tag' }, '孩子端不露'));
    let tuned = 0;
    for (const [key] of POLICY_FIELDS) {
      const v = getPath(patch, key);
      if (v === undefined) continue;
      tuned++;
      out.push(h('span', { class: 'tag tuned' }, (SHORT[key] || key + ' ') + (typeof v === 'boolean' ? (v ? '开' : '关') : Array.isArray(v) ? v.join(',') : v)));
    }
    if (!tuned) out.push(h('span', { class: 'tag mute' }, '全部继承'));
    if (!t.enabled) out.push(h('span', { class: 'tag' }, '已关闭'));
    return out;
  };

  /** 老师文件在 activity 页改(拍板 11):和 activity 同一个编辑器,带检查、预览、和出厂比、撞车保护 */
  const fileEditor = (t) => [h('button', { class: 'btn', type: 'button', title: '到 activity 页的「' + (t.name.endsWith('-tutor') ? '新话题' : '老师文件') + '」改:新话题照它带', on: { click: () => {
    act.want = { tutor: t.name, name: t.name.endsWith('-tutor') ? '新话题' : '老师文件', kind: 'tutor' };
    location.hash = '#activity?a=' + encodeURIComponent(t.name);
    showTab('activity');
  } } }, '改老师文件 →')];

  const renderTeam = () => {
    const c = state.config;
    if (!c) return;
    const top = h('div', { class: 'panel' });
    top.append(h('header', {}, h('h4', {}, '全局'), h('span', { class: 'sub' }, 'policyDefaults · 留空 = 出厂缺省'),
      h('span', { class: 'right' }, h('span', { class: 'fb' }), h('button', { class: 'btn primary', type: 'button', on: { click: () => {
        try { patchAndReload(top, { title: $('#g-title').value, runtimes: { default: $('#g-agent').value }, policyDefaults: readPolicy(top) }, renderTeam); }
        catch (e) { feedback(top, false, e.message); }
      } } }, '保存全局'))));
    top.append(h('div', { class: 'grid' },
      h('div', { class: 'field' }, h('label', {}, '孩子端标题'), h('input', { type: 'text', id: 'g-title', value: c.title })),
      h('div', { class: 'field' }, h('label', {}, '缺省运行时'), h('select', { id: 'g-agent' }, ...c.runtimes.map((p) => h('option', { value: p, selected: p === c.runtime }, p)))),
      ...policyFields(c.policyDefaults, c.tutors[0] ? Object.assign({}, c.tutors[0].policy, c.policyDefaults) : {}, { inherit: false })));
    top.append(h('p', { class: 'hint' }, '留空 = 出厂缺省(每句 60 字 / 每天 30 条 / 观察 10 条、计划 10 行、原文 4000 字)。运行时模板在 cotutor.json 里,路径与端口在设置页。'));

    const roster = h('div', { class: 'panel' });
    const addBox = h('div', { class: 'rowbody', style: 'display:none' },
      h('div', { class: 'field' }, h('label', {}, '老师名(英文键)'), h('input', { type: 'text', id: 'n-name', placeholder: 'science-tutor' })),
      h('div', { class: 'field' }, h('label', {}, '显示名'), h('input', { type: 'text', id: 'n-display', placeholder: '科学老师' })),
      h('div', { class: 'field' }, h('label', {}, '学科(可空)'), h('input', { type: 'text', id: 'n-subject', placeholder: '科学' })),
      h('div', { class: 'field' }, h('label', {}, '头像(emoji,或图片路径)'), h('input', { type: 'text', id: 'n-avatar', value: '🔬', list: 'n-avatar-list', placeholder: '🔬 或 avatars/science-tutor.png' }),
        h('datalist', { id: 'n-avatar-list' }, ...['🧮', '📚', '📖', '🔬', '🎨', '🎵', '🌍', '💻', '🏃', '🧩', '📷', '🗓'].map((a) => h('option', { value: a })))),
      h('div', { class: 'field chk' }, h('input', { type: 'checkbox', id: 'n-hidden' }), h('label', { for: 'n-hidden' }, '孩子端不露')),
      h('div', { class: 'full' },
        h('button', { class: 'btn primary', type: 'button', on: { click: async () => {
          const name = $('#n-name').value.trim();
          const display = $('#n-display').value.trim();
          if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return feedback(roster, false, '老师名要小写字母数字连字符');
          if (!display) return feedback(roster, false, '显示名不能空');
          try { await api('POST', '/api/tutors', { name, display, subject: $('#n-subject').value.trim(), avatar: $('#n-avatar').value.trim(), hidden: $('#n-hidden').checked }); await loadConfig(); renderTeam(); }
          catch (e) { feedback(roster, false, e.message); }
        } } }, '加进来'),
        h('span', { class: 'hint', style: 'padding:0' }, '会写一份带全部约定的老师文件、进 cotutor.json、建目录;之后点开这位老师改「老师文件」把性子填上。与终端 cotutor add 同一条路。')));
    roster.append(h('header', {}, h('h4', {}, c.tutors.length + ' 位老师'), h('span', { class: 'sub' }, '点一行展开政策'),
      h('span', { class: 'right' }, h('span', { class: 'fb' }), h('button', { class: 'btn', type: 'button', on: { click: () => { addBox.style.display = addBox.style.display === 'none' ? 'grid' : 'none'; } } }, '＋ 新老师'))));
    roster.append(addBox);

    const list = h('div', { class: 'roster' });
    for (const t of c.tutors) {
      const patch = c.tutorPatches[t.name] || {};
      const card = h('div', {});
      const body = h('div', { class: 'rowbody', style: 'display:none' });
      body.append(
        h('div', { class: 'field' }, h('label', {}, '显示名'), h('input', { type: 'text', 'data-f': 'display', value: t.display })),
        h('div', { class: 'field' }, h('label', {}, '学科'), h('input', { type: 'text', 'data-f': 'subject', value: t.subject || '' })),
        colorField(t, c),
        h('div', { class: 'field' }, h('label', {}, '头像(emoji,或图片路径如 avatars/' + t.name + '.png)'), h('input', { type: 'text', 'data-f': 'avatar', value: t.avatar || '' })),
        h('div', { class: 'field' }, h('label', {}, '音色(voxtell id)'), h('div', { class: 'withbtn' }, h('input', { type: 'text', 'data-f': 'voice', value: t.voice || '' }),
          h('button', { class: 'btn', type: 'button', title: '到音色页听着挑', on: { click: () => { voiceState.for = t.name; voiceState.kind = 'tts'; location.hash = '#voices'; showTab('voices'); } } }, '去挑'))),
        h('div', { class: 'field chk' }, h('input', { type: 'checkbox', 'data-f': 'enabled', checked: t.enabled }), h('label', {}, '开启')),
        h('div', { class: 'field chk' }, h('input', { type: 'checkbox', 'data-f': 'hidden', checked: t.hidden }), h('label', {}, '孩子端不露')),
        ...policyFields(patch, t.policy, { inherit: true }));
      const saveBtn = h('button', { class: 'btn primary', type: 'button' }, '保存');
      const full = h('div', { class: 'full' }, saveBtn, ...fileEditor(t), h('span', { class: 'fb' }));
      if (!c.shipped.includes(t.name)) full.append(h('button', { class: 'btn danger', type: 'button', style: 'margin-left:auto', on: { click: async () => {
        if (!confirm('删掉 ' + t.display + '?老师文件改名保留,会话与记忆不动。')) return;
        try { await api('DELETE', '/api/tutors/' + t.name); await loadConfig(); renderTeam(); }
        catch (e) { feedback(card, false, e.message); }
      } } }, '删掉这位老师'));
      body.append(full);
      card.append(body);
      saveBtn.addEventListener('click', () => {
        try {
          const f = (name) => $('[data-f=' + name + ']', body);
          patchAndReload(card, { tutors: { [t.name]: { display: f('display').value.trim(), subject: f('subject').value.trim() || null, color: f('color').dataset.v || null, avatar: f('avatar').value.trim() || null, voice: f('voice').value.trim() || null, enabled: f('enabled').checked, hidden: f('hidden').checked, policy: readPolicy(body) } } }, renderTeam);
        } catch (e) { feedback(card, false, e.message); }
      });
      const caret = h('span', { class: 'caret', 'aria-hidden': 'true' });
      caret.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
      const row = h('div', { class: 'row' + (t.enabled ? '' : ' off'), on: { click: (e) => {
        if (e.target.closest('input,select,button,textarea,label')) return;
        const on = body.style.display === 'none';
        body.style.display = on ? 'grid' : 'none';
        caret.classList.toggle('up', on);
      } } },
        avatarEl(t, 'lg'),
        h('span', { class: 'name' }, h('b', {}, t.display), h('span', {}, t.name + (t.subject ? ' · ' + t.subject : ''))),
        h('span', { class: 'tags' }, ...tutorTags(t, patch)),
        caret);
      list.append(row, card);
    }
    roster.append(list);
    $('#team').replaceChildren(h('div', { class: 'wrap' }, h('header', { class: 'ph' }, h('h1', {}, '老师团'), h('span', { class: 'sub' }, '按 cotutor.json 里有谁走;键以 -tutor 结尾的是有脸的老师')), top, roster));
  };

  // ---- 音色:两样声音,页头切——板书配音(tts.voices 列出全部音色,挑中的写进 tutors.<名>.voice;讲稿与卡的声音)、
  //      实时的嘴(百炼 realtime 认的 56 个,挑中的写进 live.voices.<名>,见下面 renderLiveVoices)。都是先听再挑 ----
  const AGE_BANDS = [['', '全部年龄'], ['kid', '12 岁以下'], ['young', '13–25 岁'], ['adult', '26–40 岁'], ['senior', '41 岁以上']];
  const inBand = (age, band) => !band || (typeof age === 'number' && (band === 'kid' ? age <= 12 : band === 'young' ? age >= 13 && age <= 25 : band === 'adult' ? age >= 26 && age <= 40 : age >= 41));
  const voiceState = { kind: 'tts', list: null, error: null, sample: '', inUse: {}, q: '', gender: '', band: '', text: '', for: null, playing: null, audio: null, loading: false };
  /** 页头的切换:板书配音 / 实时的嘴 */
  const kindSeg = () => h('span', { class: 'seg', role: 'tablist' }, ...[['tts', '板书配音'], ['live', '实时的嘴']].map(([k, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(voiceState.kind === k), class: voiceState.kind === k ? 'on' : '', on: { click: () => { if (voiceState.kind === k) return; stopPreview(); voiceState.kind = k; renderVoices(); } } }, label)));
  const stopPreview = () => {
    if (voiceState.audio) { voiceState.audio.pause(); voiceState.audio = null; }
    const b = voiceState.playing;
    voiceState.playing = null;
    if (b) { b.textContent = '▶ 试听'; b.classList.remove('on'); b.disabled = false; }
  };
  /** 点一下合成(服务端同句同音色只合成一次)并播;再点停;换一个点就切过去。base = 板书配音 / 实时的嘴各自的试听接口 */
  const preview = async (btn, voice, panel, base = '/api/tts/preview') => {
    if (voiceState.playing === btn) return stopPreview();
    stopPreview();
    voiceState.playing = btn;
    btn.textContent = '合成中…';
    btn.classList.add('on');
    try {
      const r = await fetch(base + '?voice=' + encodeURIComponent(voice) + (voiceState.text ? '&text=' + encodeURIComponent(voiceState.text) : ''));
      if (!r.ok) { const j = await r.json().catch(() => null); throw new Error((j && j.message) || (r.status + ' ' + r.statusText)); }
      const url = URL.createObjectURL(await r.blob());
      if (voiceState.playing !== btn) { URL.revokeObjectURL(url); return; }
      const a = new Audio(url);
      voiceState.audio = a;
      btn.textContent = '■ 停';
      a.addEventListener('ended', () => { URL.revokeObjectURL(url); if (voiceState.audio === a) stopPreview(); });
      await a.play();
      feedback(panel, true, '');
    } catch (e) {
      if (voiceState.playing === btn) stopPreview();
      feedback(panel, false, '没成:' + e.message);
    }
  };
  const loadVoices = async (refresh) => {
    voiceState.loading = true;
    try {
      const r = await api('GET', '/api/tts/voices' + (refresh ? '?refresh=1' : ''));
      voiceState.list = r.voices;
      voiceState.error = r.error;
      voiceState.sample = r.sample;
      voiceState.inUse = r.inUse || {};
    } catch (e) {
      voiceState.list = [];
      voiceState.error = e.message;
    }
    voiceState.loading = false;
  };
  const voiceTutor = () => {
    const c = state.config;
    return c.tutors.find((t) => t.name === voiceState.for) || c.tutors.find((t) => t.enabled && !t.hidden) || c.tutors[0] || null;
  };
  const renderVoices = async () => {
    const c = state.config;
    if (!c) return;
    if (voiceState.kind === 'live') return renderLiveVoices();
    if (!voiceState.list && !voiceState.loading) {
      $('#voices').replaceChildren(h('div', { class: 'wrap' }, h('header', { class: 'ph' }, h('h1', {}, '音色'), kindSeg()), h('div', { class: 'panel' }, h('p', { class: 'hint', style: 'padding:16px 20px' }, '在列音色……'))));
      await loadVoices(false);
      if (state.tab !== 'voices' || voiceState.kind !== 'tts') return;
    }
    if (voiceState.loading) return;
    const who = voiceTutor();
    if (who) voiceState.for = who.name;
    const panel = h('div', { class: 'panel voices' });
    const fb = h('span', { class: 'fb' });
    const forSel = h('select', { id: 'v-for', title: '挑中的音色给谁', on: { change: (e) => { voiceState.for = e.target.value; renderVoices(); } } },
      ...c.tutors.map((t) => h('option', { value: t.name, selected: who && t.name === who.name }, t.display + (t.enabled ? '' : '(已关闭)'))));
    panel.append(h('header', {}, h('h4', {}, '音色'), h('span', { class: 'sub' }, (voiceState.list || []).length + ' 个', h('span', { class: 'cmd' }, ' · ' + (c.tts.voices || []).join(' '))),
      h('span', { class: 'right' }, fb, h('label', { class: 'for' }, '给谁挑', forSel),
        h('button', { class: 'btn', type: 'button', title: '重新跑一遍列音色的命令', on: { click: async () => { stopPreview(); await loadVoices(true); renderVoices(); } } }, '刷新'))));
    if (who) {
      const cur = (voiceState.list || []).find((v) => v.voice === who.voice);
      panel.append(h('div', { class: 'now' }, avatarEl(who), h('b', {}, who.display),
        who.voice ? h('span', {}, '现在用 ', h('b', {}, cur ? cur.name : who.voice), cur ? h('small', {}, ' ' + who.voice) : h('small', {}, '(列表里没有这个 id)')) : h('span', { class: 'muted' }, '还没配音色,孩子端用浏览器自带的声'),
        who.voice ? h('button', { class: 'btn', type: 'button', on: { click: () => patchAndReload(panel, { tutors: { [who.name]: { voice: null } } }, renderVoices) } }, '清掉') : null));
    }
    if (voiceState.error) panel.append(h('p', { class: 'fb bad', style: 'padding:12px 16px 0' }, '列不出音色:' + voiceState.error), h('p', { class: 'hint' }, '设置页里 tts.voices 是列音色的命令(缺省 voxtell voices --json);voxtell 不在 PATH 就把第一项写成完整路径,或者先在终端跑 voxtell doctor。'));

    const genders = [...new Set((voiceState.list || []).map((v) => v.gender).filter(Boolean))];
    const filters = h('div', { class: 'filters' },
      h('input', { type: 'search', placeholder: '搜名字 / 特质 / 场景,比如 少年、温柔、故事', value: voiceState.q, on: { input: (e) => { voiceState.q = e.target.value.trim().toLowerCase(); renderVoiceList(); } } }),
      genders.length ? h('select', { on: { change: (e) => { voiceState.gender = e.target.value; renderVoiceList(); } } }, h('option', { value: '', selected: !voiceState.gender }, '全部性别'), ...genders.map((g) => h('option', { value: g, selected: voiceState.gender === g }, g))) : null,
      h('select', { on: { change: (e) => { voiceState.band = e.target.value; renderVoiceList(); } } }, ...AGE_BANDS.map(([k, label]) => h('option', { value: k, selected: voiceState.band === k }, label))),
      h('input', { type: 'text', class: 'sample', placeholder: '试听句:' + voiceState.sample, value: voiceState.text, title: '空 = 用缺省那句;每句每个音色只合成一次', on: { change: (e) => { voiceState.text = e.target.value.trim().slice(0, 200); stopPreview(); } } }));
    const list = h('div', { class: 'vlist' });
    const renderVoiceList = () => {
      const rows = [];
      const q = voiceState.q;
      for (const v of voiceState.list || []) {
        if (voiceState.gender && v.gender !== voiceState.gender) continue;
        if (!inBand(v.age, voiceState.band)) continue;
        if (q && ![v.name, v.voice, v.trait, v.scene, v.lang].some((x) => x && x.toLowerCase().includes(q))) continue;
        const mine = who && who.voice === v.voice;
        const users = (voiceState.inUse[v.voice] || []).map((n) => (c.tutors.find((t) => t.name === n) || { display: n }).display);
        const play = h('button', { class: 'btn play', type: 'button', on: { click: () => preview(play, v.voice, panel) } }, '▶ 试听');
        rows.push(h('div', { class: 'vrow' + (mine ? ' mine' : '') }, play,
          h('span', { class: 'vname' }, h('b', {}, v.name), h('span', {}, v.voice)),
          h('span', { class: 'vmeta' }, [v.gender, typeof v.age === 'number' ? v.age + ' 岁' : null].filter(Boolean).join(' · ')),
          h('span', { class: 'vtrait' }, v.trait || ''),
          h('span', { class: 'vscene' }, v.scene || ''),
          h('span', { class: 'tags' }, ...users.map((d) => h('span', { class: 'tag' + (mine ? ' tuned' : '') }, d + ' 在用'))),
          who ? (mine ? h('span', { class: 'tag tuned' }, '就是这个') : h('button', { class: 'btn primary pick', type: 'button', on: { click: () => { stopPreview(); patchAndReload(panel, { tutors: { [who.name]: { voice: v.voice } } }, renderVoices); } } }, '给' + who.display + '用')) : null));
      }
      list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'hint', style: 'padding:14px 16px' }, voiceState.list && voiceState.list.length ? '没有匹配的音色,换个词' : '没有音色')]));
    };
    renderVoiceList();
    panel.append(filters, list);
    panel.append(h('p', { class: 'hint' }, '试听是真合成一次(voxtell 有缓存,同一句同一个音色以后不再花钱);挑中就写进 cotutor.json,老师下一句话起用新声音。板书时讲稿与卡的声音都是它;实时的老师只有卡自己的声音(朗读卡、单词卡、录音卡)用它。'));
    $('#voices').replaceChildren(h('div', { class: 'wrap' }, h('header', { class: 'ph' }, h('h1', {}, '音色'), kindSeg(), h('span', { class: 'sub' }, '先听再挑,挑中的写进 cotutor.json')), panel));
  };
  // ---- 实时的嘴(《wip/实时老师设想.md》):百炼 realtime 认的 56 个音色(src/live/voices.ts);试听是真连一次照念这一句(几分钱,存着)。
  //      挑中的写进 live.voices.<老师>:总开关开着、这里有音色的有脸老师,孩子的新话题走实时;清掉 = 回到板书 ----
  const liveVoiceState = { data: null, error: null, q: '', lang: '', loading: false };
  const loadLiveVoices = async () => {
    liveVoiceState.loading = true;
    try { liveVoiceState.data = await api('GET', '/api/tts/realtime'); liveVoiceState.error = null; } catch (e) { liveVoiceState.error = e.message; }
    liveVoiceState.loading = false;
  };
  const renderLiveVoices = async () => {
    const c = state.config;
    const page = (panel) => $('#voices').replaceChildren(h('div', { class: 'wrap' }, h('header', { class: 'ph' }, h('h1', {}, '音色'), kindSeg(), h('span', { class: 'sub' }, '实时的老师开口用的声音,挑中的写进 cotutor.json 的 live.voices')), panel));
    if (!liveVoiceState.data && !liveVoiceState.loading) {
      page(h('div', { class: 'panel' }, h('p', { class: 'hint', style: 'padding:16px 20px' }, '在列音色……')));
      await loadLiveVoices();
      if (state.tab !== 'voices' || voiceState.kind !== 'live') return;
    }
    if (liveVoiceState.loading) return;
    const L = c.live || { enabled: false, voices: {} };
    const list = (liveVoiceState.data && liveVoiceState.data.voices) || [];
    // 实时只给有脸的老师(live.voices 的键要是 -tutor 结尾的老师)
    const faces = c.tutors.filter((t) => t.name.endsWith('-tutor'));
    const who = faces.find((t) => t.name === voiceState.for) || faces.find((t) => L.voices[t.name]) || faces.find((t) => t.enabled && !t.hidden) || faces[0] || null;
    if (who) voiceState.for = who.name;
    const panel = h('div', { class: 'panel voices' });
    const fb = h('span', { class: 'fb' });
    const forSel = h('select', { id: 'v-for', title: '挑中的音色给谁', on: { change: (e) => { voiceState.for = e.target.value; renderVoices(); } } },
      ...faces.map((t) => h('option', { value: t.name, selected: who && t.name === who.name }, t.display + (L.voices[t.name] ? ' · 实时' : '') + (t.enabled ? '' : '(已关闭)'))));
    panel.append(h('header', {}, h('h4', {}, '实时的嘴'), h('span', { class: 'sub' }, list.length + ' 个', h('span', { class: 'cmd' }, ' · ' + (L.model || ''))),
      h('span', { class: 'right' }, fb, h('label', { class: 'for' }, '给谁挑', forSel))));
    if (liveVoiceState.error) panel.append(h('p', { class: 'fb bad', style: 'padding:12px 16px 0' }, '列不出音色:' + liveVoiceState.error));
    // 总开关
    const onOff = (on) => h('button', { type: 'button', class: L.enabled === on ? 'on' : '', 'aria-pressed': String(L.enabled === on), on: { click: () => { if (L.enabled !== on) { stopPreview(); patchAndReload(panel, { live: { enabled: on } }, renderVoices); } } } }, on ? '开' : '关');
    panel.append(h('div', { class: 'now' }, h('b', {}, '实时'), h('span', { class: 'seg' }, onOff(true), onOff(false)),
      h('span', { class: 'muted' }, L.enabled ? '开着:挑了嘴的音色的老师,孩子的新话题走实时(连不上自动回到板书)' : '关着:全走板书;挑好的音色留着,开了就用')));
    if (who) {
      const curV = L.voices[who.name];
      const cur = list.find((x) => x.voice === curV);
      panel.append(h('div', { class: 'now' }, avatarEl(who), h('b', {}, who.display),
        curV ? h('span', {}, '嘴用 ', h('b', {}, cur ? cur.name : curV), h('small', {}, ' ' + curV), cur ? null : h('span', { class: 'fb bad' }, ' 这个模型不认这个音色,嘴会不出声,换一个')) : h('span', { class: 'muted' }, '还没挑:这位老师走板书'),
        curV ? h('button', { class: 'btn', type: 'button', on: { click: () => { stopPreview(); patchAndReload(panel, { live: { voices: { [who.name]: null } } }, renderVoices); } } }, '清掉(回到板书)') : null));
    }
    const langs = [...new Set(list.map((x) => x.lang))];
    const filters = h('div', { class: 'filters' },
      h('input', { type: 'search', placeholder: '搜名字 / 特质,比如 温柔、知性、少年', value: liveVoiceState.q, on: { input: (e) => { liveVoiceState.q = e.target.value.trim().toLowerCase(); renderList(); } } }),
      h('select', { on: { change: (e) => { liveVoiceState.lang = e.target.value; renderList(); } } }, h('option', { value: '', selected: !liveVoiceState.lang }, '普通话与方言都列'), ...langs.map((g) => h('option', { value: g, selected: liveVoiceState.lang === g }, g))),
      h('input', { type: 'text', class: 'sample', placeholder: '试听句:' + ((liveVoiceState.data && liveVoiceState.data.sample) || ''), value: voiceState.text, title: '空 = 用缺省那句;每句每个音色只念一次', on: { change: (e) => { voiceState.text = e.target.value.trim().slice(0, 200); stopPreview(); } } }));
    const box = h('div', { class: 'vlist' });
    const renderList = () => {
      const rows = [];
      const q = liveVoiceState.q;
      for (const x of list) {
        if (liveVoiceState.lang && x.lang !== liveVoiceState.lang) continue;
        if (q && ![x.name, x.voice, x.trait, x.lang].some((y) => y && y.toLowerCase().includes(q))) continue;
        const mine = who && L.voices[who.name] === x.voice;
        const users = Object.entries(L.voices).filter(([, v]) => v === x.voice).map(([n]) => (c.tutors.find((t) => t.name === n) || { display: n }).display);
        const play = h('button', { class: 'btn play', type: 'button', on: { click: () => preview(play, x.voice, panel, '/api/tts/realtime/preview') } }, '▶ 试听');
        rows.push(h('div', { class: 'vrow' + (mine ? ' mine' : '') }, play,
          h('span', { class: 'vname' }, h('b', {}, x.name), h('span', {}, x.voice)),
          h('span', { class: 'vmeta' }, x.lang),
          h('span', { class: 'vtrait' }, x.trait),
          h('span', { class: 'vscene' }, ''),
          h('span', { class: 'tags' }, ...users.map((d) => h('span', { class: 'tag' + (mine ? ' tuned' : '') }, d + ' 在用'))),
          who ? (mine ? h('span', { class: 'tag tuned' }, '就是这个') : h('button', { class: 'btn primary pick', type: 'button', on: { click: () => { stopPreview(); patchAndReload(panel, { live: { voices: { [who.name]: x.voice } } }, renderVoices); } } }, '给' + who.display + '用')) : null));
      }
      box.replaceChildren(...(rows.length ? rows : [h('p', { class: 'hint', style: 'padding:14px 16px' }, '没有匹配的音色,换个词')]));
    };
    renderList();
    panel.append(filters, box);
    panel.append(h('p', { class: 'hint' }, '试听是真连一次百炼的实时模型照念这一句(几分钱;同一句同一个音色只念一次,存在 .cotutor/live-preview/)。挑中就写进 cotutor.json 的 live.voices,孩子下一个新话题起用。这个模型没有童声;方言、外国口音的不适合教课。'));
    page(panel);
  };

  // ---- 设置:路径 / 服务 / 配音;文件仍是真相 ----
  const PATH_ROLES = [['vault', 'vault 根', 'Obsidian 仓库;空 = workspace 根'], ['profile', '新建档案的位置', '相对 vault;老师按 cotutor: profile 属性找档案'], ['timetable', '课程表', '相对 vault'], ['plans', '计划目录', ''], ['diary', '日记目录', '记账写这里'], ['textbooks', '教材目录', '记账列可选的册#节;上下文包按 cotutor: textbook 属性找'], ['reference', '参考目录', '你自己的笔记'], ['captures', '作业照片', '相对 workspace 根(不进 vault)']];

  const migratePanel = () => {
    const gaps = (state.config && state.config.migrate) || [];
    if (!gaps.length) return null;
    const card = h('div', { class: 'panel migrate' });
    card.append(h('header', {}, h('h4', {}, '这份 cotutor.json 缺 ' + gaps.length + ' 项出厂件'),
      h('span', { class: 'right' }, h('span', { class: 'fb' }), h('button', { class: 'btn primary', type: 'button', on: { click: async () => {
        try { await api('POST', '/api/config/migrate', {}); await loadConfig(); renderSettings(); }
        catch (e) { feedback(card, false, e.message); }
      } } }, '补上'))));
    card.append(h('ul', { class: 'gaps' }, ...gaps.map((g) => h('li', {}, h('span', { class: 'plus' }, '+'), h('span', {}, g.detail)))));
    card.append(h('p', { class: 'hint' }, '新版 cotutor 带来的新老师、新运行时、命令模板里的新旗标。cotutor.json 是你的政策文件,机器不会自己改它,所以要你点一下。只加上面这些,你改过的值一个都不动;终端里等同于 cotutor upgrade --config。'));
    return card;
  };

  const renderSettings = () => {
    const c = state.config;
    if (!c) return;
    const paths = h('div', { class: 'panel' });
    paths.append(h('header', {}, h('h4', {}, '路径'), h('span', { class: 'sub' }, '留空用缺省 · 右边是现在解析到的绝对路径'),
      h('span', { class: 'right' }, h('span', { class: 'fb' }), h('button', { class: 'btn primary', type: 'button', on: { click: async () => {
        const patch = {};
        for (const el of paths.querySelectorAll('[data-p]')) patch[el.dataset.p] = el.value.trim() || null;
        try { await api('PATCH', '/api/config', { paths: patch }); await loadConfig(); feedback(paths, true, '已写入 cotutor.json'); }
        catch (e) { feedback(paths, false, e.message); }
      } } }, '保存路径'))));
    for (const [k, label, note] of PATH_ROLES) {
      paths.append(h('div', { class: 'pathrow' },
        h('span', { class: 'k' }, label, note ? h('small', {}, note) : null),
        h('input', { type: 'text', 'data-p': k, value: c.paths[k] || '', placeholder: '缺省' }),
        h('span', { class: 'resolved' }, c.resolvedPaths[k] || '')));
    }

    const server = h('div', { class: 'panel' });
    server.append(h('header', {}, h('h4', {}, '服务'), h('span', { class: 'sub' }, '改端口要重启 serve'),
      h('span', { class: 'right' }, h('span', { class: 'fb' }), h('button', { class: 'btn primary', type: 'button', on: { click: async () => {
        try {
          const port = Number($('#s-port').value);
          if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口要是 1–65535');
          const cert = $('#s-cert').value.trim();
          const key = $('#s-key').value.trim();
          await api('PATCH', '/api/config', { server: { port, https: cert && key ? { cert, key } : null } });
          await loadConfig();
          feedback(server, true, '已写入' + (port !== c.server.port ? ';端口改了,重启 serve 才生效' : ''));
        } catch (e) { feedback(server, false, e.message); }
      } } }, '保存服务'))));
    server.append(h('div', { class: 'grid' },
      h('div', { class: 'field' }, h('label', {}, '端口'), h('input', { type: 'number', id: 's-port', value: c.server.port })),
      h('div', { class: 'field' }, h('label', {}, 'HTTPS 证书(相对 workspace)'), h('input', { type: 'text', id: 's-cert', value: c.https ? c.https.cert : '', placeholder: '空 = 机器级 ~/.config/cotutor/certs/' })),
      h('div', { class: 'field' }, h('label', {}, 'HTTPS 私钥'), h('input', { type: 'text', id: 's-key', value: c.https ? c.https.key : '', placeholder: '空 = 机器级' }))));

    const tts = h('div', { class: 'panel' });
    const say = h('textarea', { id: 's-tts', spellcheck: 'false' }, JSON.stringify(c.tts.say));
    const tryFb = h('span', { class: 'fb' });
    tts.append(h('header', {}, h('h4', {}, '配音'), h('span', { class: 'sub' }, 'voxtell · 占位 {text} {voice} {out}'),
      h('span', { class: 'right' }, h('span', { class: 'fb' }), h('button', { class: 'btn primary', type: 'button', on: { click: async () => {
        try {
          let arr;
          try { arr = JSON.parse(say.value); } catch (bad) { throw new Error('配音命令要是 JSON 数组'); }
          if (!Array.isArray(arr) || !arr.length || !arr.every((x) => typeof x === 'string')) throw new Error('配音命令要是非空字符串数组');
          await api('PATCH', '/api/config', { tts: { say: arr } });
          await loadConfig();
          feedback(tts, true, '已写入 cotutor.json');
        } catch (e) { feedback(tts, false, e.message); }
      } } }, '保存配音'))));
    tts.append(h('div', { class: 'ttsbox' }, say,
      h('div', { class: 'try' },
        h('button', { class: 'btn', type: 'button', on: { click: async (e) => {
          const btn = e.target;
          btn.disabled = true;
          tryFb.className = 'fb';
          tryFb.textContent = '合成中……';
          try {
            const r = await api('POST', '/api/tts/try', { text: '今天我们讲勾股定理' });
            if (!r.ok) { tryFb.className = 'fb bad'; tryFb.textContent = '没成:' + r.error; }
            else {
              tryFb.textContent = r.voice + ' · ' + (r.ms / 1000).toFixed(1) + 's · ' + Math.round(r.bytes / 1024) + 'kB';
              if (r.audio) new Audio(r.audio).play().catch(() => {});
            }
          } catch (err) { tryFb.className = 'fb bad'; tryFb.textContent = err.message; }
          btn.disabled = false;
        } } }, '试一句「今天我们讲勾股定理」'),
        tryFb)));
    tts.append(h('p', { class: 'hint' }, '用第一位配了音色的老师试;voxtell 不在 PATH 就把第一项写成完整路径。kid 的别的字段、version、运行时模板请直接编辑 cotutor.json。'));

    // 孩子端:惯用手(kid.hand,《wip/实时老师设想.md》拍板 22)——左撇子时平板横屏实时老师页的浮层(按住说话)挪到右边;孩子端下次进老师页生效
    const kid = h('div', { class: 'panel' });
    const left = (c.kid && c.kid.hand) === 'left';
    const handBtn = (v, label) => h('button', { type: 'button', class: left === (v === 'left') ? 'on' : '', 'aria-pressed': String(left === (v === 'left')), on: { click: async () => {
      if (left === (v === 'left')) return;
      try { await api('PATCH', '/api/config', { kid: { hand: v === 'left' ? 'left' : null } }); await loadConfig(); renderSettings(); }
      catch (e) { feedback(kid, false, e.message); }
    } } }, label);
    kid.append(h('header', {}, h('h4', {}, '孩子端'), h('span', { class: 'sub' }, 'kid.hand · 孩子下次进老师页生效'), h('span', { class: 'right' }, h('span', { class: 'fb' }))),
      h('div', { class: 'handrow' }, h('b', {}, '惯用手'), h('span', { class: 'seg' }, handBtn('right', '右手'), handBtn('left', '左撇子')),
        h('span', { class: 'muted' }, left ? '平板横屏的实时老师页:按住说话那一栏在右边,左手写字' : '平板横屏的实时老师页:按住说话那一栏在左边,右手写字')));

    const mig = migratePanel();
    $('#settings').replaceChildren(h('div', { class: 'wrap' }, h('header', { class: 'ph' }, h('h1', {}, '设置'), h('span', { class: 'sub' }, '路径、服务、配音;文件仍是真相,这页只是改它的一个口子')), ...(mig ? [mig] : []), paths, server, tts, kid));
  };

  // ---- 概览(《工作台设计.md》):近七天的数字、今天各老师、要看一眼的轮次、体检(doctor 不带 --live) ----
  const ov = { data: null, doctor: null, doctorBusy: false, error: null };
  const icon = (d, cls) => { const s = h('span', { class: 'ic' + (cls ? ' ' + cls : '') }); s.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; return s; };
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const kTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' k' : String(n));
  const goChat = async (tutor, date, job) => {
    location.hash = '#chat';
    showTab('chat');
    await pickTutor(tutor, date);
    if (job) openRaw(job);
  };
  const runDoctor = async () => {
    ov.doctorBusy = true;
    renderOverview();
    try { ov.doctor = await api('POST', '/api/dev/doctor', {}); } catch (e) { ov.doctor = { error: e.message }; }
    ov.doctorBusy = false;
    if (state.tab === 'overview') renderOverview();
  };
  /** 体检:都好只说一句;有毛病的一项一行(说明 + 修法),全部的折起来 */
  const doctorEls = () => {
    const d = ov.doctor;
    if (!d) return [];
    if (d.error) return [h('p', { class: 'fb bad' }, d.error)];
    const bad = d.checks.filter((k) => !k.ok);
    const ck = (k) => h('span', { class: 'ck' + (k.ok ? '' : k.required ? ' err' : ' bad'), title: k.detail + (k.fix ? '\\n→ ' + k.fix : '') }, h('span', { class: 'dot' + (k.ok ? '' : k.required ? ' err' : ' warn') }), k.name);
    return [
      bad.length ? h('div', { class: 'probs' }, ...bad.map((k) => h('div', { class: 'prob' }, h('span', { class: 'st ' + (k.required ? 'err' : 'warn') }, k.required ? '要修' : '提醒'), h('span', { class: 'tx' }, h('b', { class: 'num' }, k.name), h('span', {}, k.detail), k.fix ? h('span', { class: 'fix' }, '→ ' + k.fix) : null))))
        : h('p', { class: 'note' }, h('span', { class: 'st ok' }, '都好'), ' ' + d.checks.length + ' 项'),
      h('details', { class: 'allck' }, h('summary', {}, '全部 ' + d.checks.length + ' 项'), h('div', { class: 'checks' }, ...d.checks.map(ck))),
      h('p', { class: 'note' }, '要真连老师与配音跑一句,在终端跑 cotutor doctor --live(花一分钱)。'),
    ];
  };
  const renderOverview = async (quiet) => {
    if (!quiet || !ov.data) {
      try { ov.data = await api('GET', '/api/dev/overview'); ov.error = null; } catch (e) { ov.error = e.message; }
    }
    if (state.tab !== 'overview') return;
    const d = ov.data;
    const now = new Date();
    const head = h('header', { class: 'ph' }, h('h1', {}, '概览'), h('span', { class: 'sub' }, (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 · 周' + WEEK[now.getDay()]));
    if (!d) { $('#overview').replaceChildren(h('div', { class: 'wrap' }, head, h('p', { class: 'note' }, ov.error ? '读不出来:' + ov.error : '在算……'))); return; }
    const c = state.config;
    const tutorOfName = (n) => (c && c.tutors.find((t) => t.name === n)) || { name: n, display: n };

    const tiles = h('section', { class: 'card-w tiles', 'aria-label': '常用' },
      h('button', { type: 'button', on: { click: () => { location.hash = '#chat'; showTab('chat'); $('#text').focus(); } } }, icon('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z"/><path d="M8 9h8M8 12h5"/>', 'hot'), h('b', {}, '发一句试试'), h('small', {}, '以孩子的身份跑一轮')),
      h('button', { type: 'button', disabled: !d.last, on: { click: () => d.last && goChat(d.last.tutor, d.last.date, d.last.job) } }, icon('<path d="M8 7 3 12l5 5M16 7l5 5-5 5M13.5 4.5l-3 15"/>'), h('b', {}, '看原文'), h('small', { class: 'num' }, d.last ? '最近一轮 ' + (d.last.date === d.today ? '' : d.last.date.slice(5) + ' ') + d.last.at.slice(11, 16) : '七天里没有')),
      h('button', { type: 'button', on: { click: () => { location.hash = '#team'; showTab('team'); } } }, icon('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2"/>'), h('b', {}, '老师团'), h('small', {}, (c ? c.tutors.filter((t) => t.enabled).length : 0) + ' 位开着')),
      h('button', { type: 'button', on: { click: () => { location.hash = '#voices'; showTab('voices'); } } }, icon('<path d="M3 12h1.5M7 8.5v7M11 5v14M15 8v8M19 10.5v3"/>'), h('b', {}, '音色'), h('small', {}, '试听、换声')),
      h('a', { href: '/dev/qr', target: '_blank' }, icon('<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h3v3h-3zM20.5 14v.5M17 20.5h3.5V17"/>'), h('b', {}, '扫码打开'), h('small', {}, 'iPad · iPhone')),
      h('button', { type: 'button', disabled: ov.doctorBusy, on: { click: runDoctor } }, icon('<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>'), h('b', {}, '体检一次'), h('small', { class: 'num' }, ov.doctorBusy ? '在跑……' : 'doctor')));

    const slowEl = d.slow ? h('span', { class: 'st warn' }, d.slow + ' 轮') : h('span', { class: 'st ok' }, '没有');
    // 孩子端开着多久(《孩子端流水设计.md》7.4):前台的时间,不是学了多久
    const dur = (ms) => { const m = Math.round(ms / 60000); return ms < 60000 ? '不到 1 分' : m >= 60 ? Math.floor(m / 60) + ' 时 ' + (m % 60) + ' 分' : m + ' 分'; };
    const kt = d.kidTime.today;
    const todayBox = h('section', { class: 'blk' },
      h('div', { class: 'hd' }, h('h2', {}, '今天')),
      h('div', { class: 'hero' }, h('b', { class: 'big' }, String(d.todayTurns)), h('span', {}, '轮'),
        h('span', {}, d.todayThreads + ' 个话题' + (d.lastAt ? ' · 最近 ' + d.lastAt.slice(11, 16) : '') + (d.todayTasks ? ' · 另有应用的任务 ' + d.todayTasks + ' 轮' : ''))),
      h('div', { class: 'rule' }),
      h('div', { class: 'kv' },
        h('div', {}, h('span', {}, '首句就绪中位'), h('b', {}, d.firstMedianMs === null ? '—' : secs(d.firstMedianMs))),
        h('div', {}, h('span', {}, '整轮中位'), h('b', {}, d.doneMedianMs === null ? '—' : secs(d.doneMedianMs))),
        h('div', {}, h('span', {}, '慢的(> 15s)'), slowEl)),
      h('div', { class: 'kv two', title: '孩子端页面在前台的时间,页面开着、人走开了也算' },
        h('div', {}, h('span', {}, '孩子端开着'), h('b', {}, kt ? dur(kt.ms) : '—')),
        h('div', {}, h('span', {}, '几点到几点'), h('b', {}, kt ? kt.from + '–' + kt.to : '—'))));

    const max = Math.max(1, ...d.days.map((x) => x.turns));
    const top = d.days.reduce((a, x) => (x.turns > a.turns ? x : a), d.days[0]);
    const weekBox = h('section', { class: 'blk' },
      h('div', { class: 'hd' }, h('h2', {}, '近 7 天')),
      h('div', { class: 'hero' }, h('b', { class: 'mid' }, String(d.days.reduce((a, x) => a + x.turns, 0))), h('span', {}, '轮 · 每天孩子说了几轮')),
      h('div', { class: 'bars', role: 'img', 'aria-label': '近 7 天每天的轮数:' + d.days.map((x) => x.date.slice(5) + ' ' + x.turns + ' 轮').join(',') },
        ...d.days.map((x, i) => h('div', { class: 'b' + (x.date === d.today ? ' today' : '') + (x.date === d.today || (x === top && x.turns) ? ' lab' : ''), title: x.date + ' · ' + x.turns + ' 轮' + (d.kidTime.days[i] && d.kidTime.days[i].ms ? ' · 孩子端开着 ' + dur(d.kidTime.days[i].ms) : '') },
          h('span', {}, String(x.turns)), h('i', { style: 'height:' + Math.round((x.turns / max) * 104) + 'px' })))),
      h('div', { class: 'axis' }, ...d.days.map((x) => h('span', { class: x.date === d.today ? 'today' : '' }, x.date === d.today ? '今天' : x.date.slice(5)))));

    const useBox = h('section', { class: 'blk' },
      h('div', { class: 'hd' }, h('h2', {}, '用量'), h('span', { class: 'sub' }, '近 7 天,按运行时')),
      ...(d.usage.length ? d.usage.slice(0, 4).map((u) => h('div', { class: 'meter' }, h('div', { class: 't' }, h('b', { class: 'num' }, u.runtime), h('span', {}, u.turns + ' 轮 · ' + (u.costUsd ? '$' + u.costUsd.toFixed(2) : kTok(u.tokensIn) + ' / ' + kTok(u.tokensOut) + ' token'))))) : [h('p', { class: 'note' }, '七天里没跑过老师')]),
      h('div', { class: 'rule' }),
      h('div', { class: 'meter' }, h('div', { class: 't' }, h('b', {}, '画图 · 今天'), h('span', {}, d.paint.today + ' 张'))));

    const tbl = h('div', { class: 'tbl' }, h('div', { class: 'tr th' }, h('span', {}, '老师'), h('span', {}, '运行时'), h('span', { class: 'r' }, '轮'), h('span', { class: 'r' }, '首句中位'), h('span', { class: 'r' }, '最近'), h('span', {}, '孩子端')),
      ...d.tutors.filter((r) => r.enabled).map((r) => {
        const t = tutorOfName(r.name);
        return h('a', { class: 'tr', href: '#chat', on: { click: (e) => { e.preventDefault(); goChat(r.name); } } },
          h('span', { class: 'who' }, avatarEl(t), h('span', {}, h('b', {}, r.display), h('small', {}, r.name))),
          r.runtime ? h('span', { class: 'tag' }, r.runtime) : h('span', { class: 'muted' }, '—'),
          h('span', { class: 'r' }, h('b', {}, String(r.turns))),
          h('span', { class: 'r' }, r.firstMedianMs === null ? '—' : secs(r.firstMedianMs)),
          h('span', { class: 'r muted' }, r.lastAt ? r.lastAt.slice(11, 16) : '—'),
          h('span', { class: 'vis' + (r.hidden ? ' off' : '') }, h('span', { class: 'dot' + (r.hidden ? ' off' : '') }), r.hidden ? '不露' : '露脸'));
      }));
    const teamBox = h('section', { class: 'blk' },
      h('div', { class: 'hd' }, h('h2', {}, '老师今天'), h('span', { class: 'sub' }, '按 cotutor.json 里有谁走'), h('span', { class: 'right' }, h('a', { href: '#team', on: { click: (e) => { e.preventDefault(); location.hash = '#team'; showTab('team'); } } }, '管理老师团'))),
      tbl);

    // 设备(《孩子端流水设计.md》§五):近 30 天开过的,点名字起名(回车存、Esc 不存,空着 = 去掉名字)
    const when = (iso) => { const t = new Date(iso); const p2 = (n) => String(n).padStart(2, '0'); return (t.toDateString() === now.toDateString() ? '今天 ' : p2(t.getMonth() + 1) + '-' + p2(t.getDate()) + ' ') + p2(t.getHours()) + ':' + p2(t.getMinutes()); };
    const nameEl = (dv) => {
      const b = h('button', { type: 'button', class: 'dname' + (dv.name ? '' : ' none'), title: '起个名字', on: { click: () => {
        const inp = h('input', { type: 'text', class: 'dname-in', value: dv.name || '', maxlength: '30', placeholder: dv.label, 'aria-label': '这台设备的名字' });
        let done = false;
        const finish = async (keep) => {
          if (done) return;
          done = true;
          if (keep && inp.value.trim() !== (dv.name || '')) {
            try { await api('PATCH', '/api/dev/devices/' + dv.id, { name: inp.value }); state.devices = await api('GET', '/api/dev/devices'); } catch (e) {}
          }
          renderOverview();
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
        inp.addEventListener('blur', () => finish(true));
        b.replaceWith(inp);
        inp.focus();
        inp.select();
      } } }, dv.name || '没起名');
      return b;
    };
    const devRow = (dv) => h('div', { class: 'dr' }, h('span', { class: 'nm' }, nameEl(dv)), h('span', { class: 'muted' }, dv.label), h('span', { class: 'r', title: dv.commit ? '那次打开时服务端跑的是 ' + dv.commit : '' }, when(dv.last)), h('span', { class: 'r' }, dv.today ? dv.today + ' 次' + (dv.todayMs >= 60000 ? ' · ' + dur(dv.todayMs) : '') : '—'), h('span', { class: 'r' }, dv.errors ? h('span', { class: 'st err' }, '出错 ' + dv.errors) : ''));
    const devBox = h('section', { class: 'blk' },
      h('div', { class: 'hd' }, h('h2', {}, '设备'), h('span', { class: 'sub' }, '孩子端开在哪 · 近 30 天'), h('span', { class: 'right' }, h('span', { class: 'sub' }, '点名字起名'))),
      d.devices.length ? h('div', { class: 'devs' }, h('div', { class: 'dr th' }, h('span', {}, '名字'), h('span', {}, '浏览器'), h('span', { class: 'r' }, '最近打开'), h('span', { class: 'r' }, '今天'), h('span', { class: 'r' }, '近 7 天')), ...d.devices.map(devRow))
        : h('p', { class: 'note' }, '30 天里孩子端没开过。在 iPad 上打开孩子端,这里就有一行。'),
      d.olderDevices.length ? h('details', { class: 'older' }, h('summary', {}, '更早的 ' + d.olderDevices.length + ' 台'), h('div', { class: 'devs' }, ...d.olderDevices.map(devRow))) : null);

    // 页面出错(孩子端的流水):点开在原地展开调用栈,不是哪一轮,没有看原文
    const jsIssue = (i) => {
      const more = h('div', { class: 'jsmore', hidden: true },
        h('pre', {}, i.js.stack || '(没有调用栈)'),
        h('p', { class: 'note' }, (i.js.count > 1 ? '第一次 ' + i.js.first.slice(5).replace('T', ' ') + ' · ' : '') + '最近 ' + i.at.slice(5).replace('T', ' ')),
        i.tutor ? h('button', { type: 'button', class: 'linkish go', on: { click: () => goChat(i.tutor, i.date, null) } }, '去那天的对话') : null);
      const btn = h('button', { type: 'button', class: 'issue', 'aria-expanded': 'false', on: { click: () => { more.hidden = !more.hidden; btn.setAttribute('aria-expanded', String(!more.hidden)); btn.querySelector('.go').textContent = more.hidden ? '展开' : '收起'; } } },
        h('span', { class: 'st err' }, '页面'),
        h('span', { class: 'tx' }, h('b', {}, (i.tutor ? tutorOfName(i.tutor).display + ' · ' : '') + (i.date === d.today ? '' : i.date.slice(5) + ' ') + i.at.slice(11, 16) + (i.js.count > 1 ? ' · ×' + i.js.count : '')), h('span', {}, i.text), h('span', { class: 'muted' }, i.detail + ' · ' + i.js.devices.join('、'))),
        h('span', { class: 'go' }, '展开'));
      return h('div', { class: 'jsissue' }, btn, more);
    };
    const KIND = { slow: ['warn', '慢'], error: ['err', '出错'], warn: ['info', '提醒'] };
    const issueBox = h('section', { class: 'blk', style: 'flex:2 1 340px' },
      h('div', { class: 'hd' }, h('h2', {}, '要看一眼'), h('span', { class: 'sub num' }, d.issues.length ? String(d.issues.length) : ''), h('span', { class: 'sub' }, '近 7 天')),
      ...(d.issues.length ? d.issues.map((i) => i.kind === 'js' ? jsIssue(i) : h('button', { type: 'button', class: 'issue', on: { click: () => goChat(i.tutor, i.date, i.job) } },
        h('span', { class: 'st ' + KIND[i.kind][0] }, KIND[i.kind][1]),
        h('span', { class: 'tx' }, h('b', {}, tutorOfName(i.tutor).display + ' · ' + (i.date === d.today ? '' : i.date.slice(5) + ' ') + i.at.slice(11, 16)), h('span', {}, i.detail), h('span', { class: 'muted' }, '「' + i.text + '」')),
        h('span', { class: 'go' }, '看原文'))) : [h('p', { class: 'note' }, '七天里没有慢的、出错的、带提醒的轮次,孩子端页面也没出过错。')]),
      h('div', { class: 'rule' }),
      h('div', { class: 'hd' }, h('h3', {}, '体检'), h('span', { class: 'sub num' }, ov.doctor && ov.doctor.at ? 'doctor · ' + ov.doctor.at.slice(11, 16) : 'doctor,不带 --live,不花钱'),
        h('span', { class: 'right' }, h('button', { class: 'btn small', type: 'button', disabled: ov.doctorBusy, on: { click: runDoctor } }, ov.doctorBusy ? '在跑……' : ov.doctor ? '再跑一次' : '跑一次'))),
      ov.doctor && ov.doctor.error ? h('p', { class: 'fb bad' }, ov.doctor.error) : null,
      ...doctorEls());

    // 左边老师今天、下面设备;右边要看一眼与体检
    const left = h('div', { class: 'stack', style: 'flex:3 1 520px' }, teamBox, devBox);
    $('#overview').replaceChildren(h('div', { class: 'wrap' }, head, tiles, h('div', { class: 'cols3' }, todayBox, weekBox, useBox), h('div', { class: 'cols2' }, left, issueBox)));
  };

  // ---- activity(《工作台设计.md》拍板 7–11):看、改、边改边查(不落盘)、老师收到什么、和出厂比、恢复出厂;存要带读进来时的 hash。老师文件(新话题)同一个编辑器 ----
  const FENCE = String.fromCharCode(96, 96, 96);
  // 老师文件(拍板 11):kind 'tutor' 的那份是「新话题」照的提示词,同一个编辑器;act.tfiles 是它们的行,act.want = 别的页点过来要开的那份
  const act = { list: null, tfiles: null, want: null, cur: null, saved: '', hash: '', text: '', diff: [], check: null, tab: 'check', pick: 'auto', params: {}, seq: 0, timer: 0, conflict: false, caret: 1, msg: '', msgBad: false, el: null };
  const STATE_TAG = { latest: ['出厂', ''], upgradable: ['可升级', 'info'], custom: ['改过', 'accent'], untracked: ['自家的', ''], own: ['自家的', ''], missing: ['不在', 'err'], broken: ['读不出', 'err'] };
  const actUrl = (t, n) => '/api/dev/activities/' + t + '/' + encodeURIComponent(n);
  const isTutorFile = (c) => Boolean(c) && c.kind === 'tutor';
  const docUrl = (c) => (isTutorFile(c) ? '/api/dev/tutor-files/' + c.tutor : actUrl(c.tutor, c.name));
  const sameDoc = (a, b) => Boolean(a && b) && a.tutor === b.tutor && isTutorFile(a) === isTutorFile(b) && (isTutorFile(a) || a.name === b.name);
  const rowOf = (c) => (isTutorFile(c) ? act.tfiles || [] : act.list || []).find((r) => sameDoc(r, c)) || null;

  /** 两份原文按行比(LCS),连着改的合成一块:at = 在 b 里的行号(1 起) */
  const diffLines = (a, b) => {
    const A = a.split('\\n'), B = b.split('\\n'), n = A.length, m = B.length;
    if (n * m > 4000000) return a === b ? [] : [{ at: 1, old: A, now: B }];
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let cur = null, i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { if (cur) { out.push(cur); cur = null; } i++; j++; continue; }
      if (!cur) cur = { at: j + 1, old: [], now: [] };
      if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) cur.old.push(A[i++]);
      else cur.now.push(B[j++]);
    }
    if (cur) out.push(cur);
    return out;
  };
  const dirtyCount = () => act.diff.length;
  const changedLines = () => {
    const s = new Set();
    for (const d of act.diff) { if (d.now.length) for (let k = 0; k < d.now.length; k++) s.add(d.at - 1 + k); else s.add(Math.max(0, d.at - 2)); }
    return s;
  };

  /** 确认框:第一行是一句,后面几行列成点;回 true = 点了 ok */
  const ask = (title, lines, okLabel, noLabel) => new Promise((resolve) => {
    const done = (v) => { box.remove(); resolve(v); };
    const ok = h('button', { class: 'btn primary', type: 'button', on: { click: () => done(true) } }, okLabel);
    const box = h('div', { class: 'modal', on: { click: (e) => { if (e.target === box) done(false); } } },
      h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h3', {}, title),
        lines[0] ? h('p', {}, lines[0]) : null,
        lines.length > 1 ? h('ul', {}, ...lines.slice(1).map((l) => h('li', {}, l))) : null,
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', on: { click: () => done(false) } }, noLabel), ok)));
    document.body.append(box);
    ok.focus();
  });
  const showHunks = (title, lead, hunks) => {
    const box = h('div', { class: 'modal', on: { click: (e) => { if (e.target === box) box.remove(); } } },
      h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h3', {}, title), h('p', {}, lead),
        ...(hunks.length ? hunks.map((d) => hunkEl(d, false)) : [h('p', {}, '一样,没有不同的行。')]),
        h('div', { class: 'acts' }, h('button', { class: 'btn primary', type: 'button', on: { click: () => box.remove() } }, '知道了'))));
    document.body.append(box);
  };
  const hunkEl = (d, jump) => h('div', { class: 'hunk' },
    h('button', { type: 'button', class: 'hh', on: { click: () => { if (jump) jumpTo(d.at); } } }, '第 ' + d.at + ' 行'),
    ...d.old.map((l) => h('div', { class: 'hl del' }, h('b', {}, '−'), h('span', {}, l || ' '))),
    ...d.now.map((l) => h('div', { class: 'hl add' }, h('b', {}, '+'), h('span', {}, l || ' '))));

  const loadActivities = async () => {
    const [list, tfiles] = await Promise.all([api('GET', '/api/dev/activities'), api('GET', '/api/dev/tutor-files')]);
    act.list = list;
    act.tfiles = tfiles;
    const bad = list.concat(tfiles).filter((r) => r.fixes).length;
    $('#act-bad').hidden = !bad;
    $('#act-bad').textContent = bad ? String(bad) : '';
  };
  const actHead = () => h('header', { class: 'ph' }, h('h1', {}, 'activity'), h('span', { class: 'sub' }, '孩子从首页一个按钮进去的一种做法;一个 activity 一个文件,在老师的家里;「新话题」照老师文件带'));

  const renderActivities = async () => {
    if (!act.list) {
      $('#activity').replaceChildren(h('div', { class: 'wrap act-wrap' }, actHead(), h('p', { class: 'note' }, '在列……')));
      try { await loadActivities(); } catch (e) { $('#activity').replaceChildren(h('div', { class: 'wrap act-wrap' }, actHead(), h('p', { class: 'fb bad' }, '列不出来:' + e.message))); return; }
    }
    if (state.tab !== 'activity') return;
    if (act.want) {
      const w = act.want;
      act.want = null;
      if (!sameDoc(w, act.cur)) return openActivity(w.tutor, w.name, !act.cur, w.kind);
    }
    if (act.cur) return buildActivity();
    // #activity?a=<老师>/<名> 是 activity,a=<老师> 是这位老师的老师文件;都没有就开列表上的第一行
    const want = hashState().a;
    const rows = listRows();
    const first = (want && rows.find((r) => (isTutorFile(r) ? r.tutor : r.tutor + '/' + r.name) === want)) || rows[0];
    if (first) return openActivity(first.tutor, first.name, true, first.kind);
    $('#activity').replaceChildren(h('div', { class: 'wrap act-wrap' }, actHead(), h('p', { class: 'note' }, '这个 workspace 里还没有 activity(agents/<老师>/activities/<名>.md);cotutor upgrade 会补上出厂的。')));
  };

  const openActivity = async (t, n, force, kind) => {
    if (!force && act.cur && dirtyCount() && !(await ask('「' + act.cur.name + '」还有 ' + dirtyCount() + ' 处没存', ['换过去就丢掉这些改动。'], '丢掉,换过去', '留下'))) return;
    const ref = { tutor: t, name: n, kind };
    let d;
    try { d = await api('GET', docUrl(ref)); } catch (e) { alert('读不出来:' + e.message); return; }
    Object.assign(act, { cur: d, saved: d.text, text: d.text, hash: d.hash, diff: [], check: null, conflict: false, pick: 'auto', params: {}, caret: 1, msg: '', msgBad: false });
    history.replaceState(null, '', '#activity?a=' + encodeURIComponent(isTutorFile(ref) ? t : t + '/' + n));
    if (state.tab !== 'activity') return;
    buildActivity();
    runCheck();
  };

  const buildActivity = () => {
    const c = act.cur;
    const ta = h('textarea', { class: 'eta', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': (isTutorFile(c) ? c.path : c.name + '.md') + ' 原文' });
    ta.value = act.text;
    ta.addEventListener('input', () => {
      act.text = ta.value;
      act.diff = diffLines(act.saved, act.text);
      act.msg = '';
      fit();
      caretLine();
      paintLines();
      paintHead();
      paintBar();
      clearTimeout(act.timer);
      act.timer = setTimeout(runCheck, 300);
    });
    for (const ev of ['keyup', 'click', 'select']) ta.addEventListener(ev, caretMoved);
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveActivity(); }
    });
    act.el = {
      ta,
      bd: h('div', { class: 'bd', 'aria-hidden': 'true' }),
      head: h('div', { class: 'ehead' }),
      secs: h('nav', { class: 'secs', 'aria-label': '节' }),
      bar: h('footer', { class: 'ebar' }),
      side: h('aside', { class: 'aside card-w' }),
      banner: h('div', { class: 'banner', role: 'alert', hidden: true }),
      list: h('nav', { class: 'alist', 'aria-label': 'activity 列表' }),
    };
    const ed = h('section', { class: 'ed card-w' }, act.el.banner, act.el.head, act.el.secs, h('div', { class: 'code' }, act.el.bd, ta), act.el.bar);
    $('#activity').replaceChildren(h('div', { class: 'wrap act-wrap' }, actHead(), h('div', { class: 'act' }, act.el.list, ed, act.el.side)));
    paintList();
    paintAll();
    fit();
  };
  const paintAll = () => { paintHead(); paintLines(); paintSecs(); paintSide(); paintBar(); paintBanner(); };

  /** textarea 跟着内容长高(不自己滚,底色层才对得齐);量的时候页面别跳 */
  const fit = () => {
    const ta = act.el && act.el.ta;
    if (!ta) return;
    const sc = $('#activity');
    const top = sc.scrollTop;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
    sc.scrollTop = top;
  };
  const caretLine = () => { const ta = act.el.ta; act.caret = ta.value.slice(0, ta.selectionStart).split('\\n').length; };
  const caretMoved = () => {
    const before = act.caret;
    caretLine();
    if (before === act.caret) return;
    for (const el of act.el.bd.querySelectorAll('.ln.cur')) el.classList.remove('cur');
    const el = act.el.bd.children[act.caret - 1];
    if (el) el.classList.add('cur');
    paintSecs();
    paintBar();
  };
  const jumpTo = (line) => {
    const lines = act.text.split('\\n');
    let pos = 0;
    for (let k = 0; k < line - 1 && k < lines.length; k++) pos += lines[k].length + 1;
    const ta = act.el.ta;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
    act.caret = line;
    paintLines();
    paintSecs();
    paintBar();
    const el = act.el.bd.children[line - 1];
    if (el) el.scrollIntoView({ block: 'center' });
  };

  /** 列表按老师分组:每组先是这位老师的老师文件(新话题),再是 activity;老师按 cotutor.json 的顺序 */
  const listGroups = () => {
    const groups = [];
    for (const r of (act.tfiles || []).concat(act.list || [])) {
      let g = groups.find((x) => x.tutor === r.tutor);
      if (!g) groups.push((g = { tutor: r.tutor, rows: [] }));
      g.rows.push(r);
    }
    return groups;
  };
  const listRows = () => listGroups().flatMap((g) => g.rows);
  const paintList = () => {
    const groups = listGroups();
    const item = (r) => {
      const on = sameDoc(act.cur, r);
      const tag = r.fixes ? [r.fixes + ' 处要改', 'err'] : STATE_TAG[r.state] || [r.state, ''];
      const sub = isTutorFile(r) ? '老师文件 · 首页 ' + r.buttons : r.page ? '不起老师 · 进' + r.page.split(' ')[0] : ['首页 ' + r.buttons, r.examples ? '例子 ' + r.examples : null].filter(Boolean).join(' · ');
      return h('button', { type: 'button', class: 'ai' + (on ? ' on' : '') + (isTutorFile(r) ? ' tf' : ''), title: r.description, on: { click: () => openActivity(r.tutor, r.name, false, r.kind) } },
        h('span', { class: 'tx' }, h('b', {}, r.name), h('small', {}, sub)), h('span', { class: 'st ' + tag[1] }, tag[0]));
    };
    act.el.list.replaceChildren(
      ...groups.map((g) => { const t = tutorOf(g.tutor); return h('div', { class: 'grp' }, h('div', { class: 'gh' }, avatarEl(Object.assign({ name: g.tutor }, t), 'xs'), h('span', {}, t.display)), ...g.rows.map(item)); }),
      h('p', { class: 'note' }, '「新话题」改的是老师文件:首页的新话题、开场按钮都照它带。新建、改名、删一个 activity,在 workspace 里和 Claude Code 说;这里只改已有的。'));
  };

  const paintHead = () => {
    const c = act.cur;
    const row = rowOf(c);
    const d = dirtyCount();
    const fixes = act.check ? act.check.issues.filter((i) => i.level === 'fix').length : 0;
    const tag = STATE_TAG[c.state] || [c.state, ''];
    act.el.head.replaceChildren(
      h('div', { class: 'l1' },
        h('h2', {}, c.name),
        h('span', { class: 'st ' + tag[1] }, tag[0] + (c.state === 'custom' && c.basedOn ? ' · 基于 v' + c.basedOn : '')),
        fixes ? h('span', { class: 'st err' }, fixes + ' 处要改') : null,
        h('span', { class: 'right' },
          d ? h('span', { class: 'dirty' }, d + ' 处没存') : h('span', { class: 'clean' }, '都存了'),
          h('button', { class: 'btn', type: 'button', disabled: !d, on: { click: undoActivity } }, '撤销'),
          h('button', { class: 'btn primary', type: 'button', disabled: !d || act.conflict, title: '⌘/Ctrl + S', on: { click: saveActivity } }, '保存'))),
      h('div', { class: 'l2' }, c.path + (isTutorFile(c) ? ' · 首页上照它带的按钮 ' + (row ? row.buttons : 0) + ' 个' : ' · 首页 ' + (row ? row.buttons : 0) + ' 个按钮 · ' + c.examples + ' 个例子')),
      row && row.description ? h('div', { class: 'l3' }, row.description) : null);
  };

  const paintLines = () => {
    const changed = changedLines();
    const marks = {};
    for (const i of act.check ? act.check.issues : []) if (i.line) marks[i.line] = marks[i.line] === 'fix' ? 'fix' : i.level;
    let fence = false;
    act.el.bd.replaceChildren(...act.text.split('\\n').map((t, k) => {
      const n = k + 1;
      const isFence = t.startsWith(FENCE);
      const head = !fence && t.startsWith('## ');
      if (isFence) fence = !fence;
      const cls = 'ln' + (n === act.caret ? ' cur' : '') + (head ? ' head' : '') + (marks[n] === 'fix' ? ' bad' : marks[n] === 'note' ? ' warn' : changed.has(k) ? ' mod' : '');
      return h('div', { class: cls }, h('span', { class: 'no' }, String(n)), h('i', { class: 'dt' }), h('span', { class: 'tx' }, t || ' '));
    }));
  };

  const paintSecs = () => {
    const secs = act.check ? act.check.sections : [];
    let on = -1;
    secs.forEach((s, k) => { if (s.line <= act.caret) on = k; });
    act.el.secs.replaceChildren(...secs.map((s, k) => h('button', { type: 'button', class: k === on ? 'on' : '', on: { click: () => jumpTo(s.line) } }, h('b', {}, s.title), h('small', {}, s.reader))));
  };

  const paintBar = () => {
    const here = act.check ? act.check.issues.filter((i) => i.line === act.caret) : [];
    act.el.bar.replaceChildren(
      h('span', { class: 'num' }, '第 ' + act.caret + ' 行 · 共 ' + act.text.split('\\n').length + ' 行'),
      here.length ? h('span', { class: here.some((i) => i.level === 'fix') ? 'bad' : '' }, here.map((i) => i.text).join(';'))
        : act.msg ? h('span', { class: act.msgBad ? 'bad' : 'ok' }, act.msg)
          : h('span', {}, isTutorFile(act.cur) ? '存了就生效:新开的话题照新的带;正在聊的那个,老师可能还照旧的' : '存了就生效:下一轮起照新的带,正在进行的话题也换'));
  };

  const paintBanner = () => {
    const b = act.el.banner;
    b.hidden = !act.conflict;
    if (!act.conflict) return b.replaceChildren();
    const c = act.cur;
    b.replaceChildren(
      h('span', { class: 'st' }, '撞车'),
      h('span', { class: 'tx' }, '这份文件在别处改过了(比如在 workspace 里用 Claude Code 改的)。你还有 ' + dirtyCount() + ' 处没存,直接存会盖掉那边的,所以「保存」先停了。'),
      h('span', { class: 'acts' },
        h('button', { class: 'btn small', type: 'button', on: { click: async () => {
          try { const d = await api('GET', docUrl(c)); showHunks('那边改了什么', '和你读进来的那份比(没算你还没存的改动):', diffLines(act.saved, d.text)); } catch (e) { alert(e.message); }
        } } }, '看那边改了什么'),
        ' ',
        h('button', { class: 'btn ink small', type: 'button', on: { click: () => openActivity(c.tutor, c.name, true, c.kind) } }, '丢掉我的,重读')));
  };

  /** 预览用哪份参数:首页某个按钮的,或自己填的 */
  const previewParams = () => {
    if (act.pick.startsWith('btn:')) { const b = act.check && act.check.buttons[Number(act.pick.slice(4))]; return b ? b.params : {}; }
    return act.pick === 'own' ? act.params : {};
  };
  const runCheck = async () => {
    const c = act.cur;
    if (!c) return;
    const seq = ++act.seq;
    let r;
    try { r = await api('POST', docUrl(c) + '/check', { text: act.text, params: previewParams() }); } catch (e) { act.msg = '检查没跑成:' + e.message; act.msgBad = true; if (act.el) paintBar(); return; }
    if (seq !== act.seq || c !== act.cur) return;
    act.check = r;
    // 预览缺省按首页上参数最多的那个按钮看;没有按钮就自己填(老师文件没有参数)
    if (act.pick === 'auto' && !isTutorFile(c)) {
      if (r.buttons.length) {
        let best = 0;
        r.buttons.forEach((b, k) => { if (Object.keys(b.params).length > Object.keys(r.buttons[best].params).length) best = k; });
        act.pick = 'btn:' + best;
        if (Object.keys(r.buttons[best].params).length) return runCheck();
      } else act.pick = 'own';
    }
    if (state.tab !== 'activity' || !act.el) return;
    paintHead();
    paintLines();
    paintSecs();
    paintSide();
    paintBar();
  };

  const paintSide = () => {
    const r = act.check;
    const tabs = [['check', '检查'], ['preview', '老师收到什么'], ['diff', '和出厂比']];
    const seg = h('div', { class: 'seg', role: 'tablist' }, ...tabs.map(([k, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(act.tab === k), class: act.tab === k ? 'on' : '', on: { click: () => { act.tab = k; paintSide(); } } }, label)));
    const body = h('div', { class: 'body' });
    const tf = isTutorFile(act.cur);
    const parts = !r ? [h('p', { class: 'note' }, '在查……')] : act.tab === 'check' ? (tf ? sideCheckTutor(r) : sideCheck(r)) : act.tab === 'preview' ? (tf ? sidePreviewTutor(r) : sidePreview(r)) : sideDiff(r);
    body.append(...parts.filter(Boolean));
    act.el.side.replaceChildren(h('div', { class: 'tabs' }, seg), body);
  };
  const rule = () => h('div', { class: 'rule' });

  const sideCheck = (r) => {
    const c = act.cur;
    const fx = r.issues.filter((i) => i.level === 'fix');
    const nt = r.issues.filter((i) => i.level === 'note');
    const s = r.summary;
    const kv = (k, v) => [h('span', { class: 'k' }, k), h('span', { class: 'v num' }, v || '无')];
    const param = (p) => p.name + '(' + p.type + (p.optional ? ',可空' : '') + (p.default !== undefined ? ',缺省 ' + p.default : '') + (p.min !== undefined && p.max !== undefined ? ',' + p.min + '–' + p.max : '') + ')';
    return [
      h('div', { class: 'srow' }, fx.length ? h('span', { class: 'st err' }, fx.length + ' 处要改') : h('span', { class: 'st ok' }, '都对得上'), nt.length ? h('span', { class: 'st warn' }, nt.length + ' 条提醒') : null, h('span', { class: 'note' }, r.issues.length ? '点一条跳到那一行' : '边改边查,不落盘')),
      r.issues.length ? h('div', { class: 'ilist' }, ...r.issues.map((i) => h('button', { type: 'button', class: 'iss' + (i.level === 'fix' ? ' fix' : ''), on: { click: () => { if (i.line) jumpTo(i.line); } } }, h('b', { class: 'num' }, i.line ? '第 ' + i.line + ' 行' : '整份'), h('span', {}, i.text)))) : null,
      h('div', { class: 'kv2' }, ...kv('家长填的', s.params.map(param).join(' · ')), ...kv('应用算的', s.state.join(' · ')), ...kv('应用拦的', s.gates.join(' · ')), ...kv('卡', s.cards.join(' ')), ...kv('工具人', s.tools.map((t) => t.tool + (t.slots.length ? '(' + t.slots.join(' ') + ')' : '')).join(' · ')), ...(s.page ? kv('不起老师', '进' + s.page) : [])),
      rule(),
      h('h3', {}, '首页上用到它的'),
      ...(r.buttons.length ? r.buttons.map((b) => h('div', { class: 'hb' }, h('span', { class: 'tx' }, h('b', {}, (b.kind === 'lecture' ? '小课堂 · ' : '') + b.label), h('small', {}, b.detail)), h('span', { class: 'st ' + (b.ok ? 'ok' : 'err') }, b.ok ? '对得上' : '孩子端不出'))) : [h('p', { class: 'note' }, '已发布的首页上没有按钮用它。')]),
      fx.length && r.buttons.length ? h('p', { class: 'note' }, '写坏的 activity,孩子端不出它的按钮;改好就回来。孩子点不进一个写坏的。') : null,
      rule(),
      h('h3', {}, '老师带得好不好'),
      c.examples
        ? h('p', { class: 'note' }, '检查只管写法。要看老师照新的带得怎样,在终端跑回归:' + c.examples + ' 个例子各跑 3 次,花钱。')
        : h('p', { class: 'note' }, '这个 activity 还没有例子文件(' + c.name + '.例子.md),回归跑不了;想看效果在终端真发一条:'),
      h('div', { class: 'cmd' }, h('code', {}, c.examples ? 'cotutor activity eval ' + c.tutor + ' ' + c.name : 'cotutor send ' + c.tutor + ' --activity ' + c.name), h('button', { class: 'btn small', type: 'button', on: { click: (e) => copy(e.target.previousSibling.textContent, e.target) } }, '复制')),
    ];
  };

  const sidePreview = (r) => {
    const s = r.summary;
    const pv = r.preview;
    const out = [];
    if (r.buttons.length || s.params.length) {
      out.push(h('div', { class: 'field' }, h('label', {}, '按哪个按钮看'),
        h('select', { on: { change: (e) => { act.pick = e.target.value; if (act.pick === 'own') act.params = Object.assign({}, previewParams()); runCheck(); } } },
          ...r.buttons.map((b, k) => h('option', { value: 'btn:' + k, selected: act.pick === 'btn:' + k }, '首页 · ' + b.label + (Object.keys(b.params).length ? '(' + Object.keys(b.params).join('、') + ')' : ''))),
          h('option', { value: 'own', selected: act.pick === 'own' }, '自己填参数'))));
      if (s.params.length) {
        const cur = previewParams();
        out.push(h('div', { class: 'pvf' }, ...s.params.map((p) => h('div', { class: 'field' + (p.type === '词表' || p.type === '字' ? ' wide' : '') },
          h('label', {}, p.name + ' · ' + p.type + (p.min !== undefined && p.max !== undefined ? ',' + p.min + '–' + p.max : '')),
          h('input', { type: 'text', value: cur[p.name] || '', placeholder: p.default !== undefined ? '缺省 ' + p.default : p.optional ? '可空' : '要填', on: { change: (e) => { act.params = Object.assign({}, previewParams(), { [p.name]: e.target.value.trim() }); if (!act.params[p.name]) delete act.params[p.name]; act.pick = 'own'; runCheck(); } } })))));
      }
    }
    if (pv.text === null) out.push(h('p', { class: 'note' }, s.page ? '不起老师:孩子点了进' + s.page + '。' : '没有「老师怎么带」这一节,这个 activity 不起老师。'));
    else {
      out.push(h('div', { class: 'chips' },
        h('span', { class: 'tag' }, '老师那节 ' + pv.chars.toLocaleString() + ' 字'),
        h('span', { class: 'tag' }, '+ 板书写法 ' + pv.cards.join(' ')),
        ...Object.entries(pv.values).map(([k, v]) => h('span', { class: 'tag' }, k + ' ' + v)),
        ...pv.paramIssues.map((x) => h('span', { class: 'st err' }, x))));
      out.push(h('pre', { class: 'pv' }, pv.text));
      out.push(h('div', { class: 'srow' }, h('span', { class: 'note', style: 'flex:1;min-width:160px' }, '这就是这个话题老师的系统提示(qwen 的 systemBody、claude 的 --agents):不读老师文件,注释已剥,后面再接这几种卡的板书写法。'), h('button', { class: 'btn small', type: 'button', on: { click: (e) => copy(pv.text, e.target) } }, '复制全文')));
    }
    for (const t of pv.tools) {
      out.push(rule(), h('h3', {}, t.tool + '收到什么'), h('p', { class: 'note' }, '{{插槽}} 由应用在交出去那一刻填。'), h('pre', { class: 'pv tool' }, t.prompt));
      if (t.negative) out.push(h('p', { class: 'note' }, '不要:' + t.negative));
    }
    return out;
  };

  const sideDiff = (r) => {
    const c = act.cur;
    const tf = isTutorFile(c);
    if (!r.diff) return [h('p', { class: 'note' }, tf ? '自家加的老师,没有出厂那份可比。' : '自家加的 activity,没有出厂那份可比。')];
    const out = [h('div', { class: 'srow' }, r.diff.length ? h('span', { class: 'st accent' }, '和出厂不一样 ' + r.diff.length + ' 处') : h('span', { class: 'st ok' }, '和出厂一样'), h('span', { class: 'note' }, '含没存的')),
      ...r.diff.map((d) => hunkEl(d, true))];
    out.push(h('p', { class: 'note' }, c.state === 'upgradable' ? '这份没改过,是旧版出厂的;cotutor upgrade 会换成新的。' : c.state === 'latest' ? '存下以后就算改过的出厂件:cotutor upgrade 不再自动换新版,只报 diff。' : '改过的出厂件,cotutor upgrade 不再自动换新版,只报 diff。'));
    out.push(rule(), h('div', { class: 'srow' },
      h('button', { class: 'btn danger', type: 'button', disabled: !r.diff.length && !dirtyCount(), on: { click: restoreActivityBtn } }, '恢复出厂'),
      h('span', { class: 'note' }, c.state === 'latest' ? '磁盘上那份就是出厂的,恢复只是丢掉没存的改动。' : '换回出厂那份;你这份存成 ' + bakName(c) + '。' + (tf ? '别的老师、这位老师的 activity 都不碰。' : '别的 activity 不碰。'))));
    return out;
  };

  const bakName = (c) => (isTutorFile(c) ? c.path.split('/').pop() : c.name + '.md') + '.bak';

  /** 老师文件的检查:写法、首页上哪些按钮照它带、怎么看效果 */
  const sideCheckTutor = (r) => {
    const c = act.cur;
    const fx = r.issues.filter((i) => i.level === 'fix');
    const nt = r.issues.filter((i) => i.level === 'note');
    const faced = c.name === '新话题';
    return [
      h('div', { class: 'srow' }, fx.length ? h('span', { class: 'st err' }, fx.length + ' 处要改') : h('span', { class: 'st ok' }, '都对得上'), nt.length ? h('span', { class: 'st warn' }, nt.length + ' 条提醒') : null, h('span', { class: 'note' }, r.issues.length ? '点一条跳到那一行' : '边改边查,不落盘')),
      r.issues.length ? h('div', { class: 'ilist' }, ...r.issues.map((i) => h('button', { type: 'button', class: 'iss' + (i.level === 'fix' ? ' fix' : ''), on: { click: () => { if (i.line) jumpTo(i.line); } } }, h('b', { class: 'num' }, i.line ? '第 ' + i.line + ' 行' : '整份'), h('span', {}, i.text)))) : null,
      fx.length ? h('p', { class: 'note' }, '老师文件写坏了这位老师整个起不来,所以改好才能存(activity 写坏了还能先存)。') : null,
      rule(),
      h('h3', {}, '照它带的'),
      faced
        ? h('p', { class: 'note' }, '不走 activity 的话题:首页的「新话题」、开场按钮,隔天「接着」一个不是 activity 的话题。点 activity 按钮进去的话题不读它。')
        : h('p', { class: 'note' }, '工具人:没有新话题按钮,由应用在幕后起;正文就是它每次的系统提示。'),
      ...(faced ? (r.buttons.length ? r.buttons.map((b) => h('div', { class: 'hb' }, h('span', { class: 'tx' }, h('b', {}, b.label), h('small', {}, b.kind === 'new' ? '孩子自己开口,应用放在第一个' : '开场:按钮上的字当孩子的第一句')), h('span', { class: 'st ok' }, '首页上'))) : [h('p', { class: 'note' }, '已发布的首页上没有这位老师的卡,孩子端看不到他的新话题。')]) : []),
      rule(),
      h('h3', {}, '老师带得好不好'),
      h('p', { class: 'note' }, '检查只管写法。要看老师照新的讲得怎样:拿以前的一轮按现在的提示词再跑一遍对照(job 在「对话」页的看原文里),或真发一条;都花钱。'),
      h('div', { class: 'cmd' }, h('code', {}, 'cotutor replay ' + c.tutor + ' <job>'), h('button', { class: 'btn small', type: 'button', on: { click: (e) => copy(e.target.previousSibling.textContent, e.target) } }, '复制')),
      h('div', { class: 'cmd' }, h('code', {}, 'cotutor send ' + c.tutor + ' --new "…"'), h('button', { class: 'btn small', type: 'button', on: { click: (e) => copy(e.target.previousSibling.textContent, e.target) } }, '复制')),
    ];
  };

  /** 老师文件:新话题里老师收到什么——系统提示(正文 + 板书写法)与话题第一条的守则 */
  const sidePreviewTutor = (r) => {
    const c = act.cur;
    const pv = r.preview;
    const out = [h('div', { class: 'chips' },
      h('span', { class: 'tag' }, '正文 ' + pv.chars.toLocaleString() + ' 字'),
      pv.board ? h('span', { class: 'tag', title: pv.board.cards.length ? '这位老师的卡:' + pv.board.cards.join(' ') : '全部的卡' }, '+ 板书写法 ' + pv.board.chars.toLocaleString() + ' 字') : null,
      pv.rules ? h('span', { class: 'tag' }, '+ 守则 ' + pv.rules.chars.toLocaleString() + ' 字') : null)];
    out.push(h('pre', { class: 'pv' }, pv.text || '(空)'));
    out.push(h('div', { class: 'srow' }, h('span', { class: 'note', style: 'flex:1;min-width:160px' }, '这就是新话题里老师的系统提示(qwen 的 systemBody、claude 的 --agent):老师文件去掉 frontmatter' + (pv.board ? ',后面再接板书写法' : '') + '。'), h('button', { class: 'btn small', type: 'button', on: { click: (e) => copy(pv.text, e.target) } }, '复制全文')));
    if (pv.rules) {
      out.push(rule(), h('h3', {}, '话题第一条还带守则'),
        h('p', { class: 'note' }, '有脸的老师共用的 ' + pv.rules.path + ',机器件,cotutor upgrade 每次覆盖,这里不改。这位老师要不一样的做法,写进上面的老师文件,它优先。'),
        h('details', {}, h('summary', {}, '看守则原文'), h('pre', { class: 'pv tool' }, pv.rules.text)));
    }
    out.push(rule(), h('p', { class: 'note' }, '档案、日记、计划这些每轮现拼进上下文包,不在这里;看一轮会拼成什么(不花钱):'),
      h('div', { class: 'cmd' }, h('code', {}, 'cotutor pack ' + c.tutor + ' "…"'), h('button', { class: 'btn small', type: 'button', on: { click: (e) => copy(e.target.previousSibling.textContent, e.target) } }, '复制')));
    return out;
  };

  const undoActivity = () => {
    act.text = act.saved;
    act.el.ta.value = act.text;
    act.diff = [];
    act.msg = '';
    fit();
    paintAll();
    runCheck();
  };

  const saveActivity = async () => {
    const c = act.cur;
    if (!c || !dirtyCount() || act.conflict) return;
    let r;
    try { r = await api('POST', docUrl(c) + '/check', { text: act.text, params: previewParams() }); } catch (e) { alert(e.message); return; }
    act.check = r;
    const fx = r.issues.filter((i) => i.level === 'fix');
    if (fx.length && isTutorFile(c)) { act.msg = '还有 ' + fx.length + ' 处要改,改好才能存:老师文件写坏了,这位老师就起不来'; act.msgBad = true; paintAll(); return; }
    if (fx.length && !(await ask('还有 ' + fx.length + ' 处要改,先存吗?', ['存下就生效。改好之前:', ...(r.buttons.length ? ['首页上用到它的 ' + r.buttons.length + ' 个按钮,孩子端先不出'] : []), '正在进行的「' + c.name + '」话题,下一轮老师照这份带'], '仍然保存', '回去改'))) { paintAll(); return; }
    const res = await fetch(docUrl(c), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: act.text, base: act.hash }) });
    const j = await res.json().catch(() => null);
    if (res.status === 409) { act.conflict = true; paintAll(); return; }
    if (!res.ok) { act.msg = '没存上:' + ((j && j.message) || res.status); act.msgBad = true; paintBar(); return; }
    act.saved = act.text;
    act.hash = j.hash;
    c.state = j.state;
    act.diff = [];
    act.msg = isTutorFile(c) ? '存好了 · 新开的话题照新的带' : '存好了 · 下一轮起照新的带' + (j.fixes ? ';改好之前首页上用它的按钮孩子端不出' : '');
    act.msgBad = Boolean(j.fixes);
    try { await loadActivities(); } catch (e) {}
    paintList();
    paintAll();
  };

  const restoreActivityBtn = async () => {
    const c = act.cur;
    const tf = isTutorFile(c);
    const lead = c.state === 'latest' ? '磁盘上那份就是出厂的;没存的 ' + dirtyCount() + ' 处丢掉。' : '你这份存成 ' + bakName(c) + (dirtyCount() ? ',没存的 ' + dirtyCount() + ' 处一起丢掉' : '') + '。和 cotutor upgrade --force ' + c.tutor + (tf ? '' : '/' + c.name) + ' 同一条路,' + (tf ? '别的老师不碰。' : '别的 activity 不碰。');
    if (!(await ask('换回出厂那份?', [lead], '恢复出厂', '算了'))) return;
    let r;
    try { r = await api('POST', docUrl(c) + '/restore', {}); } catch (e) { alert(e.message); return; }
    try { await loadActivities(); } catch (e) {}
    await openActivity(c.tutor, c.name, true, c.kind);
    act.msg = r.bak ? '换回出厂了 · 你那份在 ' + r.bak : '换回出厂了';
    act.msgBad = false;
    paintBar();
  };

  /** 别处(Claude Code、编辑器)改了这份:没改动就悄悄读进来,有改动就亮撞车条、停住保存 */
  const checkDisk = async () => {
    const c = act.cur;
    if (!c || act.conflict || state.tab !== 'activity') return;
    let d;
    try { d = await api('GET', docUrl(c)); } catch (e) { return; }
    if (c !== act.cur || d.hash === act.hash) return;
    if (dirtyCount()) { act.conflict = true; paintAll(); return; }
    Object.assign(act, { cur: d, saved: d.text, text: d.text, hash: d.hash, diff: [], msg: '别处改过了,已读进新的那份', msgBad: false });
    act.el.ta.value = d.text;
    fit();
    try { await loadActivities(); } catch (e) {}
    paintList();
    paintAll();
    runCheck();
  };
  window.addEventListener('focus', checkDisk);
  window.addEventListener('beforeunload', (e) => { if (act.cur && dirtyCount()) { e.preventDefault(); e.returnValue = ''; } });

  // ---- 启动 ----
  (async () => {
    await refreshHealth();
    await loadConfig();
    showTab(state.tab);
    // ?tutor=math-tutor 直接停在某位老师(调试与贴链接用)
    const want = new URLSearchParams(location.search).get('tutor');
    const first = state.config.tutors.find((t) => t.name === want && t.enabled) || state.config.tutors.find((t) => t.enabled && !t.hidden) || state.config.tutors.find((t) => t.enabled);
    if (first) await pickTutor(first.name);
    const rawWant = hashState().raw;
    if (rawWant) openRaw(rawWant);
    setInterval(refreshHealth, 10000);
    setInterval(async () => {
      const before = JSON.stringify(state.config && state.config.tutors);
      await loadConfig();
      if (JSON.stringify(state.config.tutors) !== before && state.tab === 'team') renderTeam();
      if (state.tab === 'overview') renderOverview();
      if (state.tab === 'activity') checkDisk();
    }, 10000);
  })().catch((e) => { $('#msgs').replaceChildren(h('p', { class: 'empty' }, '加载失败:' + e.message)); });
})();
</script>
</html>
`;
