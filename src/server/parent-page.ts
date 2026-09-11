/**
 * 家长端 /parent:三个标签(对话 / 老师团 / 设置)+「看原文」抽屉,零依赖内联脚本,只走 /api/*。
 * 2026-09-11 重做:一轮 = 一张卡(问句 → 板书 → 埋点 → 孩子看到 → 通知块),板书按 kind 渲染成卡片而不是把围栏原文倒给家长;
 * 顶栏与输入框各自钉死(grid-rows auto/1fr/auto + min-height:0,不再硬算 100vh - 47px:顶栏一换行就错位,composer 被顶出视口);
 * 老师团一位一行、九项政策折叠、改过的才亮;设置分路径 / 服务 / 配音三块,配音能当场试一句。
 * 看原文 = 把一轮拆成六站(上下文包 / 老师原文 / 解析结果 / 下发给孩子 / 配音 / 转录),数据来自 /api/conversations/<老师>/<日期>/raw/<job>。
 * 放在 .ts 里而不是 .html,是因为 tsc 不拷贝静态文件,dist 里就少一份。
 * 改这里注意:整份是模板字符串——页面脚本里不要用反引号与 ${},换行写 \\n,正则里别写 \\/。
 */
export const PARENT_PAGE = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>cotutor 家长端</title>
<style>
  :root {
    --ground:#F1F4F0; --surface:#fff; --surface-2:#F7F9F5; --sunk:#EAEEE7;
    --line:#DCE2D9; --line-soft:#E9EDE6;
    --ink:#18201B; --ink-2:#3D4A42; --muted:#6C786F;
    --accent:#2F5D50; --accent-2:#4B8674; --accent-soft:#DCE8E2;
    --kid:#2B6B9C; --kid-soft:#DEEBF5;
    --parent:#8A5A1E; --parent-soft:#F6EBD8;
    --warn:#9E6A14; --warn-soft:#FAEFD6;
    --err:#AC382B; --err-soft:#F8E3E0;
    --ok:#3A7A4A;
    --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--ground); color:var(--ink); font:16px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif; height:100vh; overflow:hidden; display:flex; flex-direction:column; }
  button, input, select, textarea { font:inherit; color:inherit; }
  header { display:flex; align-items:center; gap:16px; padding:0 16px; height:56px; background:var(--surface); border-bottom:1px solid var(--line); flex:none; }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  header h1 small { color:var(--muted); font-weight:400; font-size:13.5px; margin-left:6px; }
  header nav { display:flex; gap:2px; margin-left:auto; }
  header nav a { font-size:15px; color:var(--muted); text-decoration:none; padding:6px 13px; border-radius:8px; }
  header nav a:hover { color:var(--ink); background:var(--surface-2); }
  header nav a.on { color:var(--ink); background:var(--accent-soft); font-weight:500; }
  header .health { font:500 13px/1 var(--mono); color:var(--ok); display:flex; align-items:center; gap:6px; }
  header .health::before { content:""; width:7px; height:7px; border-radius:50%; background:var(--ok); }
  header .health.bad { color:var(--err); }
  header .health.bad::before { background:var(--err); }
  main { display:none; min-height:0; flex:1; }
  main.on { display:block; }

  /* ---------- 对话 ---------- */
  #chat.on { display:grid; grid-template-columns:236px minmax(0,1fr); min-height:0; }
  aside { border-right:1px solid var(--line); background:var(--surface-2); overflow:auto; display:flex; flex-direction:column; }
  aside .head { font:500 12.5px/1 var(--mono); letter-spacing:.12em; color:var(--muted); padding:14px 16px 8px; }
  aside .list { padding:0 8px 12px; }
  aside .tutor { display:flex; gap:9px; align-items:center; padding:7px 8px; border-radius:8px; cursor:pointer; }
  aside .tutor:hover { background:var(--sunk); }
  aside .tutor.on { background:var(--surface); box-shadow:inset 0 0 0 1px var(--line); }
  aside .tutor .av { font-size:21px; line-height:1; }
  aside .tutor .who { min-width:0; flex:1; }
  aside .tutor .who b { display:block; font-size:15px; font-weight:500; }
  aside .tutor .who span { display:block; font:400 12.5px/1.4 var(--mono); color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  aside .tutor .bead { width:6px; height:6px; border-radius:50%; background:var(--accent-2); flex:none; }
  aside .tutor .bead.off { background:var(--line); }
  aside .foot { margin-top:auto; padding:12px 16px; font-size:13px; color:var(--muted); line-height:1.5; }

  #thread { display:grid; grid-template-rows:auto minmax(0,1fr) auto; min-height:0; min-width:0; }
  .thread-top { display:flex; align-items:center; gap:12px; padding:10px 18px; background:var(--surface); border-bottom:1px solid var(--line); flex-wrap:wrap; }
  .thread-top .who { display:flex; align-items:center; gap:8px; font-weight:600; font-size:16px; }
  .thread-top .who .av { font-size:21px; }
  .thread-top select { font:500 13px/1 var(--mono); border:1px solid var(--line); border-radius:999px; padding:5px 9px; background:var(--surface); }
  .today { margin-left:auto; display:flex; align-items:center; gap:13px; font:500 13px/1 var(--mono); color:var(--muted); font-variant-numeric:tabular-nums; flex-wrap:wrap; }
  .today b { color:var(--ink); font-weight:600; }

  #msgs { overflow:auto; padding:18px; background:var(--sunk); }
  .stream { max-width:940px; margin:0 auto; display:flex; flex-direction:column; gap:22px; }
  .sep { text-align:center; font:500 13px/1 var(--mono); color:var(--muted); }
  .turn { background:var(--surface); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  .turn.bad { border-color:#e9c2bc; }
  .ask { display:flex; gap:10px; padding:12px 16px; border-bottom:1px solid var(--line-soft); align-items:flex-start; }
  .ask .tag { font:500 12.5px/1.7 var(--mono); letter-spacing:.06em; padding:1px 7px; border-radius:5px; flex:none; background:var(--sunk); color:var(--muted); }
  .ask.from-kid .tag { background:var(--kid-soft); color:var(--kid); }
  .ask.from-parent .tag { background:var(--parent-soft); color:var(--parent); }
  .ask .q { flex:1; min-width:0; white-space:pre-wrap; word-break:break-word; }
  .ask .q .did { display:block; margin-top:6px; font-size:14px; color:var(--kid); border-left:2px solid var(--kid); padding-left:9px; white-space:normal; }
  .ask .when { font:400 13px/1.9 var(--mono); color:var(--muted); flex:none; font-variant-numeric:tabular-nums; }

  .board { padding:14px 16px 6px; display:flex; flex-direction:column; gap:10px; }
  .line { display:flex; gap:9px; font-size:16px; color:var(--ink-2); }
  .line .n { font:400 12.5px/1.9 var(--mono); color:var(--muted); width:17px; text-align:right; flex:none; font-variant-numeric:tabular-nums; }
  .line p { margin:0; min-width:0; }
  .line mark { background:none; color:var(--accent); border-bottom:1.5px solid var(--accent-2); }
  .line.ask-line p::after { content:" ⏸ 停下等孩子"; font:400 12.5px/1 var(--mono); color:var(--muted); }
  .card { border:1px solid var(--line); border-radius:10px; background:var(--surface-2); margin-left:23px; overflow:hidden; }
  .card .kindbar { display:flex; align-items:center; gap:7px; padding:5px 11px; border-bottom:1px solid var(--line-soft); font:500 12px/1.6 var(--mono); letter-spacing:.08em; color:var(--muted); }
  .card .kindbar i { width:6px; height:6px; border-radius:2px; background:var(--accent-2); display:block; }
  .card .kindbar .more { margin-left:auto; }
  .card .body { padding:12px 14px; }
  .card.cover .body { text-align:center; padding:18px 14px; background:linear-gradient(180deg,var(--accent-soft),transparent); }
  .card.cover h4 { margin:0; font-size:22px; font-weight:600; }
  .card.cover p { margin:5px 0 0; color:var(--muted); font-size:14.5px; }
  .card.step .body { display:flex; gap:11px; align-items:flex-start; }
  .card.step .idx { font:600 13px/22px var(--mono); width:22px; height:22px; border-radius:50%; background:var(--accent); color:#fff; text-align:center; flex:none; }
  .card.step b { font-size:15.5px; display:block; }
  .card .body p { margin:2px 0 0; font-size:15px; color:var(--ink-2); white-space:pre-wrap; }
  .card.formula .body { text-align:center; font:500 19px/1.5 var(--mono); padding:16px 14px; }
  .card.quote .body { border-left:3px solid var(--accent-2); font-style:italic; }
  .opt { display:flex; align-items:center; gap:9px; padding:6px 9px; border:1px solid var(--line); border-radius:7px; margin-top:6px; font-size:15px; background:var(--surface); }
  .opt .k { font:500 13px/1 var(--mono); color:var(--muted); width:14px; flex:none; }
  .opt.right { border-color:var(--ok); }
  .opt .ans { margin-left:auto; font:500 12px/1 var(--mono); color:var(--ok); background:#e6f0e6; padding:3px 6px; border-radius:4px; flex:none; }
  .seg { display:inline-block; border:1px solid var(--line); background:var(--surface); border-radius:6px; padding:3px 8px; margin:0 6px 6px 0; font-size:14.5px; }
  .fillline { font-size:15.5px; }
  .fillline u { text-decoration:none; border-bottom:1.5px solid var(--accent-2); color:var(--accent); padding:0 10px; }
  .card img { max-width:100%; border-radius:6px; display:block; }
  .card pre { margin:0; font:400 14px/1.7 var(--mono); white-space:pre-wrap; word-break:break-word; color:var(--ink-2); }
  .card .meta2 { font:400 13px/1.6 var(--mono); color:var(--muted); }

  .turn-foot { display:flex; align-items:center; gap:7px; flex-wrap:wrap; padding:9px 16px; border-top:1px solid var(--line-soft); background:var(--surface-2); }
  .chip { font:500 13px/1 var(--mono); color:var(--muted); background:var(--surface); border:1px solid var(--line); border-radius:6px; padding:5px 8px; font-variant-numeric:tabular-nums; }
  .chip b { color:var(--ink); font-weight:600; }
  .chip.slow { border-color:var(--warn); color:var(--warn); }
  .chip.slow b { color:var(--warn); }
  .chip.money b { color:var(--accent); }
  .turn-foot .right { margin-left:auto; display:flex; gap:6px; }
  .linkish { font:500 13px/1 var(--mono); color:var(--muted); background:none; border:0; cursor:pointer; padding:5px 6px; border-radius:6px; text-decoration:none; }
  .linkish:hover { color:var(--accent); background:var(--accent-soft); }
  .linkish.on { color:var(--accent); background:var(--accent-soft); }

  .kidview { border-top:1px solid var(--line-soft); padding:10px 16px; display:flex; gap:10px; align-items:flex-start; }
  .kidview .lab { font:500 12.5px/1.7 var(--mono); color:var(--kid); background:var(--kid-soft); border-radius:5px; padding:1px 7px; flex:none; }
  .kidview p { margin:0; font-size:15px; color:var(--ink-2); min-width:0; }
  .kidview p span { color:var(--muted); }
  .kidview.parent .lab { color:var(--parent); background:var(--parent-soft); }

  .notice { display:flex; gap:11px; padding:12px 16px; border-top:1px solid var(--line-soft); align-items:flex-start; }
  .notice .ico { font:600 13px/20px var(--mono); width:20px; height:20px; border-radius:5px; text-align:center; flex:none; color:#fff; }
  .notice h5 { margin:0 0 3px; font-size:15px; font-weight:600; }
  .notice p { margin:0; font-size:14px; color:var(--ink-2); white-space:pre-wrap; }
  .notice.hold { background:var(--warn-soft); } .notice.hold .ico { background:var(--warn); }
  .notice.hand { background:var(--accent-soft); } .notice.hand .ico { background:var(--accent); }
  .notice.err { background:var(--err-soft); } .notice.err .ico { background:var(--err); }
  .notice.err p { font:400 13.5px/1.6 var(--mono); color:var(--err); }
  .notice.warn { background:var(--surface-2); } .notice.warn .ico { background:var(--muted); }
  .notice .btns { display:flex; gap:7px; margin-top:9px; flex-wrap:wrap; }
  .notice .btns button { font-size:14px; padding:5px 11px; border-radius:7px; border:1px solid var(--line); background:var(--surface); cursor:pointer; }
  .notice .btns button.rec { border-color:var(--accent); background:var(--accent); color:#fff; }
  .running { padding:10px 16px; border-top:1px solid var(--line-soft); color:var(--accent); font-size:14.5px; }
  .trace { padding:0 16px 12px; }
  .trace .tool, .trace .done { font:400 13px/1.6 var(--mono); color:var(--muted); white-space:pre-wrap; word-break:break-word; }
  .trace .tool-error { font:400 13px/1.6 var(--mono); color:var(--err); white-space:pre-wrap; }
  .trace .say { white-space:pre-wrap; font-size:15px; color:var(--ink-2); margin:4px 0; }
  .trace details { font-size:13.5px; color:var(--muted); margin:4px 0; }
  .trace summary { cursor:pointer; }
  .trace .sub { border-left:2px dashed var(--line); padding-left:8px; margin:4px 0; }
  .empty { color:var(--muted); text-align:center; margin-top:70px; }

  #composer { border-top:1px solid var(--line); background:var(--surface); padding:10px 16px 12px; display:flex; flex-direction:column; gap:8px; }
  #composer .box { display:flex; gap:10px; align-items:flex-end; max-width:940px; margin:0 auto; width:100%; }
  #composer textarea { flex:1; min-height:46px; max-height:160px; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--surface-2); resize:vertical; }
  #composer textarea:focus { outline:2px solid var(--accent-2); outline-offset:-1px; background:var(--surface); }
  #composer .send { padding:12px 20px; border:0; border-radius:10px; background:var(--accent); color:#fff; cursor:pointer; font-weight:500; }
  #composer .send:disabled { opacity:.45; cursor:default; }
  #composer .row { display:flex; gap:7px; align-items:center; max-width:940px; margin:0 auto; width:100%; flex-wrap:wrap; }
  #composer .row select { font:500 13px/1 var(--mono); border:1px solid var(--line); border-radius:999px; padding:5px 9px; background:var(--sunk); max-width:250px; }
  #composer .row .hint { margin-left:auto; font:400 13px/1 var(--mono); color:var(--muted); }

  /* ---------- 看原文抽屉 ---------- */
  #drawer { position:fixed; top:0; right:0; bottom:0; width:min(760px,100vw); background:var(--surface); border-left:1px solid var(--line); box-shadow:-12px 0 40px -24px rgba(24,32,27,.5); display:none; grid-template-rows:auto minmax(0,1fr); z-index:20; }
  #drawer.on { display:grid; }
  .dhead { display:flex; align-items:center; gap:9px; padding:10px 14px; background:var(--surface-2); border-bottom:1px solid var(--line); flex-wrap:wrap; }
  .dhead b { font-size:15.5px; }
  .dhead .jobid { font:500 13.5px/1 var(--mono); background:var(--accent-soft); color:var(--accent); padding:4px 8px; border-radius:6px; }
  .dhead .who2 { font:400 13px/1.5 var(--mono); color:var(--muted); }
  .dhead .acts { margin-left:auto; display:flex; gap:6px; flex-wrap:wrap; }
  .dbody { display:grid; grid-template-columns:212px minmax(0,1fr); min-height:0; }
  .rail { border-right:1px solid var(--line); background:var(--surface-2); padding:8px; overflow:auto; }
  .rail button { display:flex; gap:9px; align-items:flex-start; text-align:left; background:none; border:0; border-radius:8px; padding:8px 9px; cursor:pointer; width:100%; }
  .rail button:hover { background:var(--sunk); }
  .rail button.on { background:var(--surface); box-shadow:inset 0 0 0 1px var(--line); }
  .rail .st { width:7px; height:7px; border-radius:50%; background:var(--ok); margin-top:7px; flex:none; }
  .rail .st.warn { background:var(--warn); }
  .rail .st.none { background:var(--line); }
  .rail .lab b { display:block; font-size:14.5px; font-weight:500; }
  .rail .lab span { display:block; font:400 12.5px/1.5 var(--mono); color:var(--muted); }
  .dcontent { min-width:0; overflow:auto; }
  .ctop { display:flex; align-items:center; gap:9px; padding:9px 14px; border-bottom:1px solid var(--line-soft); font:400 13px/1.5 var(--mono); color:var(--muted); flex-wrap:wrap; }
  .ctop .right { margin-left:auto; display:flex; gap:6px; }
  .raw { font:400 14px/1.85 var(--mono); padding:10px 0 20px; }
  .rl { display:grid; grid-template-columns:42px minmax(0,1fr) auto; gap:0 10px; padding-right:12px; }
  .rl .n { color:var(--muted); text-align:right; opacity:.7; user-select:none; font-variant-numeric:tabular-nums; }
  .rl .t { white-space:pre-wrap; word-break:break-word; color:var(--ink-2); }
  .rl .a { font-size:12.5px; color:var(--muted); white-space:nowrap; align-self:center; }
  .rl.say .t { color:var(--ink); } .rl.say .a { color:var(--accent); }
  .rl.card { background:var(--surface-2); } .rl.card.open .t, .rl.card.open .a { color:var(--accent); }
  .rl.section { background:var(--sunk); } .rl.section .t { color:var(--muted); }
  .rl.tail .t { color:var(--muted); }
  .rl.warnline { background:var(--warn-soft); }
  .rawwarn { margin:6px 12px 6px 46px; padding:8px 11px; border-left:3px solid var(--warn); background:var(--warn-soft); border-radius:0 8px 8px 0; font:400 13.5px/1.6 -apple-system,"PingFang SC",sans-serif; color:var(--ink-2); }
  .rawwarn b { font:600 13px/1.6 var(--mono); color:var(--warn); margin-right:6px; }
  .dsec { padding:14px; display:flex; flex-direction:column; gap:10px; }
  .dsec h5 { margin:0; font-size:14px; font-weight:600; color:var(--ink-2); }
  .dsec pre { margin:0; font:400 13.5px/1.7 var(--mono); background:var(--sunk); border:1px solid var(--line-soft); border-radius:8px; padding:11px 12px; white-space:pre-wrap; word-break:break-word; color:var(--ink-2); max-height:340px; overflow:auto; }
  .dsec .hintline { font-size:13.5px; color:var(--muted); margin:0; }
  .dsec details summary { cursor:pointer; font-size:13.5px; color:var(--muted); }
  .dline { display:grid; grid-template-columns:16px minmax(0,1fr); gap:8px; font:400 14px/1.8 var(--mono); }
  .dline .s { text-align:center; font-weight:600; }
  .dline.add { background:#e9f2e9; } .dline.add .s { color:var(--ok); }
  .dline.del { background:#fbeae7; } .dline.del .s { color:var(--err); }
  .dline.same .s { color:var(--line); }
  .kline { display:flex; gap:9px; align-items:baseline; font-size:15px; padding:5px 0; border-bottom:1px solid var(--line-soft); }
  .kline .n2 { font:400 12.5px/1.6 var(--mono); color:var(--muted); width:17px; flex:none; }
  .kline .cut { color:var(--muted); text-decoration:line-through; text-decoration-color:var(--err); }
  .kline .kidstate { color:var(--kid); }
  .kline .au { margin-left:auto; font:500 12px/1 var(--mono); color:var(--ok); flex:none; }
  .kline .au.bad { color:var(--err); }
  .kline .au.none { color:var(--muted); }

  /* ---------- 老师团 / 设置 ---------- */
  #team, #settings { overflow:auto; background:var(--sunk); }
  .wrap { max-width:1000px; margin:0 auto; padding:18px; display:flex; flex-direction:column; gap:14px; }
  .panel { background:var(--surface); border:1px solid var(--line); border-radius:12px; }
  .panel > header { display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid var(--line-soft); height:auto; background:none; }
  .panel > header h4 { margin:0; font-size:15.5px; font-weight:600; }
  .panel > header .sub { font:400 13px/1.4 var(--mono); color:var(--muted); }
  .panel > header .right { margin-left:auto; display:flex; gap:8px; align-items:center; }
  .btn { font-size:14px; padding:6px 12px; border-radius:8px; border:1px solid var(--line); background:var(--surface); cursor:pointer; }
  .btn:hover { border-color:var(--accent-2); }
  .btn.primary { border-color:var(--accent); background:var(--accent); color:#fff; }
  .btn.danger { border-color:#e3bdb7; color:var(--err); }
  .fb { font-size:14px; color:var(--ok); white-space:pre-wrap; }
  .fb.bad { color:var(--err); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(184px,1fr)); gap:12px 18px; padding:15px 16px; }
  .field { display:flex; flex-direction:column; gap:5px; min-width:0; }
  .field label { font-size:13px; color:var(--muted); }
  .field input, .field select { font-size:15px; padding:7px 9px; border:1px solid var(--line); border-radius:8px; background:var(--surface); width:100%; }
  .field.changed input, .field.changed select { border-left:3px solid var(--accent); background:var(--accent-soft); }
  .field .foot { font:400 12.5px/1.4 var(--mono); color:var(--muted); }
  .field.chk { flex-direction:row; align-items:center; gap:7px; }
  .field.chk input { width:auto; }
  .field.chk label { font-size:15px; color:var(--ink); }
  .hint { color:var(--muted); font-size:13.5px; padding:0 16px 14px; margin:0; }
  .roster .row { display:flex; align-items:center; gap:12px; padding:11px 16px; border-top:1px solid var(--line-soft); cursor:pointer; }
  .roster .row:first-child { border-top:0; }
  .roster .row .av { font-size:22px; }
  .roster .row .name { min-width:162px; }
  .roster .row .name b { display:block; font-size:15.5px; font-weight:600; }
  .roster .row .name span { font:400 13px/1.5 var(--mono); color:var(--muted); }
  .roster .row .tags { display:flex; gap:6px; flex-wrap:wrap; flex:1; }
  .tag { font:500 13px/1 var(--mono); padding:4px 8px; border-radius:6px; background:var(--sunk); color:var(--muted); }
  .tag.tuned { background:var(--accent-soft); color:var(--accent); }
  .tag.mute { background:none; border:1px dashed var(--line); }
  .roster .row .caret { color:var(--muted); font:400 13px/1 var(--mono); flex:none; }
  .roster .row.off { opacity:.55; }
  .rowbody { border-top:1px solid var(--line-soft); background:var(--surface-2); padding:14px 16px 16px; display:grid; grid-template-columns:repeat(auto-fit,minmax(184px,1fr)); gap:12px 18px; }
  .rowbody .full { grid-column:1/-1; display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
  .rowbody textarea { grid-column:1/-1; width:100%; min-height:280px; font:14.5px/1.6 var(--mono); padding:10px; border:1px solid var(--line); border-radius:8px; resize:vertical; background:var(--surface); }
  .pathrow { display:grid; grid-template-columns:minmax(124px,188px) minmax(0,1fr) minmax(0,1.1fr); gap:12px; align-items:center; padding:9px 16px; border-top:1px solid var(--line-soft); }
  .pathrow:first-of-type { border-top:0; }
  .pathrow .k { font-size:14.5px; }
  .pathrow .k small { display:block; color:var(--muted); font-size:13px; }
  .pathrow input { font:400 14px/1 var(--mono); padding:8px 9px; border:1px solid var(--line); border-radius:8px; background:var(--surface); width:100%; }
  .pathrow .resolved { font:400 13px/1.4 var(--mono); color:var(--muted); word-break:break-all; }
  .migrate { border-color:var(--warn); }
  .migrate > header { background:var(--warn-soft); border-radius:11px 11px 0 0; }
  .gaps { margin:0; padding:12px 16px; list-style:none; display:flex; flex-direction:column; gap:7px; }
  .gaps li { display:flex; gap:9px; font-size:14.5px; align-items:baseline; }
  .gaps li .plus { font:600 13.5px/1 var(--mono); color:var(--ok); }
  .ttsbox { padding:14px 16px; display:flex; flex-direction:column; gap:10px; }
  .ttsbox textarea { width:100%; min-height:56px; font:14px/1.6 var(--mono); padding:9px; border:1px solid var(--line); border-radius:8px; background:var(--surface); resize:vertical; }
  .ttsbox .try { display:flex; gap:9px; align-items:center; flex-wrap:wrap; }

  @media (max-width:760px) {
    #chat.on { grid-template-columns:1fr; }
    aside { display:none; }
    #drawer { width:100vw; }
    .dbody { grid-template-columns:1fr; grid-template-rows:auto minmax(0,1fr); }
    .rail { border-right:0; border-bottom:1px solid var(--line); display:flex; gap:4px; overflow-x:auto; }
    .rail button { width:auto; white-space:nowrap; }
    .rail .lab span { display:none; }
    .rl { grid-template-columns:34px minmax(0,1fr); }
    .rl .a { display:none; }
    .pathrow { grid-template-columns:1fr; gap:6px; }
  }
</style>
<header>
  <h1 id="title">cotutor<small>家长端</small></h1>
  <nav><a href="#chat" data-tab="chat" class="on">对话</a><a href="#team" data-tab="team">老师团</a><a href="#settings" data-tab="settings">设置</a></nav>
  <span class="health" id="health"></span>
</header>
<main id="chat" class="on">
  <aside>
    <div class="head">老师</div>
    <div class="list" id="tutors"></div>
    <p class="foot">灰点 = 孩子端不露的老师,家长这边照常能说话。</p>
  </aside>
  <section id="thread">
    <div class="thread-top" id="top"></div>
    <div id="msgs"><p class="empty">左边选一位老师</p></div>
    <form id="composer">
      <div class="box">
        <textarea id="text" placeholder="对老师说……"></textarea>
        <button type="submit" class="send" id="send">发送</button>
      </div>
      <div class="row">
        <select id="from" title="以谁的身份说"><option value="parent">身份 家长</option><option value="kid">身份 孩子(模拟)</option><option value="system">身份 系统</option></select>
        <select id="runtime" title="运行时"></select>
        <select id="thread-pick" title="接着哪个话题说"></select>
        <span class="hint">⌘/Ctrl + Enter 发送</span>
      </div>
    </form>
  </section>
</main>
<main id="team"></main>
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

  const hashState = () => {
    const parts = location.hash.split('?raw=');
    const tab = (parts[0] || '#chat').slice(1) || 'chat';
    return { tab: ['chat', 'team', 'settings'].includes(tab) ? tab : 'chat', raw: parts[1] || null };
  };
  const state = { config: null, tutor: null, date: null, today: null, dates: [], view: null, timer: null, tab: hashState().tab, raw: null, rawJob: null, station: 'source' };

  // ---- 顶栏与标签 ----
  const showTab = (tab) => {
    state.tab = tab;
    for (const a of document.querySelectorAll('header nav a')) a.classList.toggle('on', a.dataset.tab === tab);
    for (const m of document.querySelectorAll('main')) m.classList.toggle('on', m.id === tab);
    if (tab === 'team') renderTeam();
    if (tab === 'settings') renderSettings();
  };
  for (const a of document.querySelectorAll('header nav a')) a.addEventListener('click', (e) => { e.preventDefault(); location.hash = '#' + a.dataset.tab; showTab(a.dataset.tab); });

  const refreshHealth = async () => {
    const el = $('#health');
    try {
      const hh = await api('GET', '/api/health');
      el.textContent = hh.configError ? 'cotutor.json 改坏了,仍用上一份:' + hh.configError.split('\\n')[0] : '在线';
      el.classList.toggle('bad', Boolean(hh.configError));
    } catch (e) {
      el.textContent = '后端不通';
      el.classList.add('bad');
    }
  };

  const loadConfig = async () => {
    state.config = await api('GET', '/api/config');
    $('#title').replaceChildren(state.config.title, h('small', {}, '家长端'));
    document.title = state.config.title + ' · 家长端';
    $('#runtime').replaceChildren(...state.config.runtimes.map((p) => h('option', { value: p, selected: p === state.config.runtime }, p === state.config.runtime ? p + '(缺省)' : p)));
    renderTutors();
  };

  // ---- 对话:左栏 ----
  const renderTutors = () => {
    const list = state.config.tutors.filter((t) => t.enabled);
    if (state.tutor && !list.some((t) => t.name === state.tutor)) { state.tutor = null; state.view = null; $('#msgs').replaceChildren(h('p', { class: 'empty' }, '这位老师已关闭')); }
    $('#tutors').replaceChildren(...list.map((t) => h('div', { class: 'tutor' + (t.name === state.tutor ? ' on' : ''), on: { click: () => pickTutor(t.name) } },
      h('span', { class: 'av' }, t.avatar || '🙂'),
      h('span', { class: 'who' }, h('b', {}, t.display), h('span', {}, t.name + (t.subject ? ' · ' + t.subject : ''))),
      h('span', { class: 'bead' + (t.hidden ? ' off' : '') }))));
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
  };

  // 用时:10 秒内带一位小数,两分钟内整秒,再长按分钟
  const secs = (ms) => (ms < 10000 ? (ms / 1000).toFixed(1) + 's' : ms < 120000 ? Math.round(ms / 1000) + 's' : Math.round(ms / 6000) / 10 + 'min');
  const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const tutorOf = (name) => state.config.tutors.find((x) => x.name === name) || { display: name, avatar: '' };

  const renderTop = () => {
    const t = tutorOf(state.tutor);
    const v = state.view;
    const done = v.index.messages.filter((m) => m.result !== 'running');
    const first = median(done.map((m) => m.timing && m.timing.firstCardMs).filter((x) => x !== undefined && x !== null));
    const whole = median(done.map((m) => m.timing && m.timing.doneMs).filter((x) => x !== undefined && x !== null));
    $('#top').replaceChildren(
      h('span', { class: 'who' }, h('span', { class: 'av' }, t.avatar || '🙂'), t.display),
      h('select', { title: '哪一天', on: { change: (e) => { state.date = e.target.value; loadDay(); } } },
        ...state.dates.map((x) => h('option', { value: x, selected: x === state.date }, x === state.today ? x + '(今天)' : x))),
      h('span', { class: 'today' },
        h('span', {}, '今日 ', h('b', {}, String(v.index.messages.length)), ' 轮'),
        h('span', {}, '费用 ', h('b', {}, '$' + v.index.costUsd.toFixed(2))),
        first !== null ? h('span', {}, '首卡中位 ', h('b', {}, secs(first))) : null,
        whole !== null ? h('span', {}, '整轮中位 ', h('b', {}, secs(whole))) : null,
        v.index.session ? h('span', {}, '会话 ' + v.index.session.id.slice(0, 8)) : null));
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

  const KIND_LABEL = { text: '文字', read: '点读', choice: '选择', fill: '填空', image: '图片', scene: '讲解动画', canvas: '画板', code: '原样' };
  const cardEl = (card, n) => {
    const p = card.props || {};
    const style = card.kind === 'text' ? (p.style || 'plain') : '';
    const box = h('div', { class: 'card ' + card.kind + ' ' + style });
    box.append(h('div', { class: 'kindbar' }, h('i', {}), card.kind + (p.style ? ' · ' + p.style : ''), h('span', { class: 'more' }, '卡 ' + (n + 1) + ' · ' + (KIND_LABEL[card.kind] || card.kind))));
    const body = h('div', { class: 'body' });
    if (card.kind === 'text' && p.style === 'cover') body.append(h('h4', {}, p.title || ''), p.text ? h('p', {}, p.text) : null);
    else if (card.kind === 'text' && p.style === 'step') body.append(h('span', { class: 'idx' }, String(n + 1)), h('div', {}, h('b', {}, p.title || ''), p.text ? h('p', {}, p.text) : null));
    else if (card.kind === 'text') body.append(h('p', { style: 'margin:0' }, p.text || ''));
    else if (card.kind === 'read') body.append(...(p.segments || []).map((s) => h('span', { class: 'seg' }, s)));
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
    } else if (card.kind === 'scene') {
      body.append(h('div', {}, h('b', {}, p.title || p.text || p.bundle), p.ready === false ? h('span', { class: 'meta2' }, ' · 课包还没到') : null),
        p.problem ? h('p', {}, p.problem) : null,
        h('div', { class: 'meta2' }, '课包 ' + p.bundle + (p.steps ? ' · ' + p.steps + ' 步' : '')),
        p.ready ? h('a', { class: 'linkish', href: '/stage/?bundle=' + encodeURIComponent('/api/bundles/' + p.bundle + '/') + '&autoplay=1', target: '_blank' }, '打开看看') : null);
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
      box.append(h('div', { class: 'line' + (l.ask ? ' ask-line' : '') }, h('span', { class: 'n' }, String(i + 1)), marked(l)));
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

  const FROM = { kid: '孩子', parent: '家长', system: '系统' };
  const SLOW_FIRST = 15000;

  /** 一轮一张卡:问句 → 板书 → 埋点 → 孩子看到 → 通知块,五段各有自己的容器与颜色 */
  const turnEl = (m) => {
    const v = state.view;
    const t = tutorOf(state.tutor);
    const el = h('article', { class: 'turn' + (m.result === 'error' ? ' bad' : '') });
    const q = h('div', { class: 'q' }, m.text);
    if (m.cards && m.cards.length) q.append(h('span', { class: 'did' }, '板书上做的 · ', ...m.cards.map((c) => h('span', {}, c.card + ' ' + c.text + ' '))));
    if (m.focus && (m.focus.card || m.focus.artifact)) q.append(h('span', { class: 'did' }, '开着 ' + (m.focus.card || m.focus.artifact)));
    el.append(h('div', { class: 'ask from-' + m.from },
      h('span', { class: 'tag' }, FROM[m.from] || m.from),
      q,
      h('span', { class: 'when' }, m.at.slice(11) + ' · ' + m.job + (m.action === 'continue' ? ' · 继续' : m.action === 'submit' ? ' · 交答案' : ''))));

    if (m.section && (m.section.cards.length || m.section.lines.length)) el.append(boardEl(m.section));
    else if (m.result === 'ok' && m.kidText) el.append(h('div', { class: 'board' }, h('div', { class: 'line' }, h('span', { class: 'n' }, '1'), h('p', {}, m.kidText))));

    const foot = h('div', { class: 'turn-foot' }, h('span', { class: 'chip' }, (t.avatar || '') + ' ' + t.display));
    if (m.timing) {
      if (m.timing.firstCardMs !== undefined) foot.append(h('span', { class: 'chip' + (m.timing.firstCardMs > SLOW_FIRST ? ' slow' : '') }, '首卡 ', h('b', {}, secs(m.timing.firstCardMs))));
      if (m.timing.doneMs !== undefined) foot.append(h('span', { class: 'chip' }, '整轮 ', h('b', {}, secs(m.timing.doneMs))));
      if (m.timing.dubbedMs !== undefined) foot.append(h('span', { class: 'chip' }, '配音 ', h('b', {}, secs(m.timing.dubbedMs))));
    }
    if (m.costUsd !== undefined) foot.append(h('span', { class: 'chip money' }, '$', h('b', {}, m.costUsd.toFixed(2))));
    if (m.artifacts && m.artifacts.length) foot.append(h('span', { class: 'chip' }, '课包 ' + m.artifacts.join(', ')));
    const rows = v.runs[m.job] || [];
    const trace = h('div', { class: 'trace', style: 'display:none' }, ...rowsEl(rows));
    const traceBtn = h('button', { class: 'linkish', type: 'button', on: { click: () => {
      const on = trace.style.display === 'none';
      trace.style.display = on ? 'block' : 'none';
      traceBtn.classList.toggle('on', on);
    } } }, '转录 ' + rows.length);
    foot.append(h('span', { class: 'right' },
      h('button', { class: 'linkish', type: 'button', on: { click: () => openRaw(m.job) } }, '看原文'),
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

    if (m.holdup) {
      const btns = h('div', { class: 'btns' });
      for (const o of m.holdup.options) btns.append(h('button', { type: 'button', class: o.recommended ? 'rec' : '', title: o.note || '', on: { click: () => send('待裁量「' + m.holdup.question + '」:选「' + o.label + '」', 'parent') } }, o.label + (o.recommended ? ' ★' : '')));
      if (!m.holdup.options.length) btns.append(h('span', { class: 'hint', style: 'padding:0' }, '(没给选项,直接在下面回复)'));
      el.append(h('div', { class: 'notice hold' }, h('span', { class: 'ico' }, '?'), h('div', {}, h('h5', {}, '待裁量:' + m.holdup.question), btns)));
    }
    if (m.handoff) {
      el.append(h('div', { class: 'notice hand' }, h('span', { class: 'ico' }, '→'), h('div', {},
        h('h5', {}, '转交 ' + (tutorOf(m.handoff.to).display || m.handoff.to) + (m.handoff.refs && m.handoff.refs.length ? ' · ' + m.handoff.refs.join(', ') : '')),
        h('p', {}, (m.handoff.why || '') + (m.handoffJob ? ' · 已起 ' + m.handoffJob.tutor + ' 的 ' + m.handoffJob.job : ' · 没起(见下面的提醒)')))));
    }
    if (m.result === 'error') el.append(h('div', { class: 'notice err' }, h('span', { class: 'ico' }, '!'), h('div', {}, h('h5', {}, '本轮出错:' + (m.error || '未知')), h('p', {}, v.errors[m.job] || ''))));
    if (m.warnings && m.warnings.length) el.append(h('div', { class: 'notice warn' }, h('span', { class: 'ico' }, 'i'), h('div', {}, h('h5', {}, '提醒'), h('p', {}, m.warnings.join('\\n')))));
    if (m.result === 'running') el.append(h('div', { class: 'running' }, v.running === m.job ? '老师在想……' : '(没跑完:服务重启过或进程被杀,看原文里的转录)'));
    return el;
  };

  const renderDay = () => {
    const v = state.view;
    const t = tutorOf(state.tutor);
    if (!v.index.messages.length) { $('#msgs').replaceChildren(h('p', { class: 'empty' }, state.date + ' 还没和' + t.display + '说过话')); return; }
    // 话题:一天多个话题时在每个话题第一条前插一条分隔
    const multi = new Set(v.index.messages.map((m) => m.thread || m.job)).size > 1;
    const seen = new Set();
    const nodes = [];
    for (const m of v.index.messages) {
      const id = m.thread || m.job;
      if (multi && !seen.has(id)) { seen.add(id); nodes.push(h('div', { class: 'sep' }, '—— ' + (seen.size === 1 ? '第一个话题' : '新话题') + ' ' + m.at.slice(11, 16) + ' ——')); }
      nodes.push(turnEl(m));
    }
    $('#msgs').replaceChildren(h('div', { class: 'stream' }, ...nodes));
  };

  const send = async (text, from, extra) => {
    if (!state.tutor) return alert('先选一位老师');
    const pick = $('#thread-pick').value;
    const body = Object.assign({ text, from: from || $('#from').value, runtime: $('#runtime').value }, pick === 'new' ? { newThread: true } : pick ? { thread: pick } : {}, extra || {});
    try {
      $('#send').disabled = true;
      await api('POST', '/api/conversations/' + state.tutor + '/messages', body);
      $('#text').value = '';
      if (state.date !== state.today) await pickTutor(state.tutor, state.today);
      else await loadDay();
    } catch (e) {
      alert(e.message);
      $('#send').disabled = false;
    }
  };
  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); const t = $('#text').value.trim(); if (t) send(t); });
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
        h('div', {},
          h('button', { class: 'btn', type: 'button', on: { click: (e) => copy(raw.pack.prompt, e.target) } }, '复制上下文包'),
          ' ',
          h('button', { class: 'btn', type: 'button', on: { click: (e) => copy(cmd, e.target) } }, '复制命令行')));
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
        h('b', {}, '原文'),
        h('span', { class: 'jobid' }, raw.job),
        h('span', { class: 'who2' }, tutorOf(raw.tutor).display + ' · ' + raw.at + (raw.runtime ? ' · ' + raw.runtime : '')),
        h('span', { class: 'acts' },
          h('button', { class: 'btn', type: 'button', on: { click: (e) => copy(all(), e.target) } }, '复制整轮'),
          h('button', { class: 'btn', type: 'button', on: { click: () => openRaw(raw.job) } }, '重读'),
          h('button', { class: 'btn', type: 'button', on: { click: closeRaw } }, '关 Esc'))),
      h('div', { class: 'dbody' },
        h('nav', { class: 'rail' }, ...raw.stations.map((st) => h('button', { class: state.station === st.id ? 'on' : '', type: 'button', on: { click: () => { state.station = st.id; renderRaw(); } } },
          h('span', { class: 'st ' + (st.state === 'ok' ? '' : st.state) }),
          h('span', { class: 'lab' }, h('b', {}, st.title), h('span', {}, st.note))))),
        h('div', { class: 'dcontent' }, stationEl(raw))));
  };

  // ---- 老师团:一位一行,九项政策折叠,改过的才亮 ----
  const POLICY_FIELDS = [['replyMaxChars', '每句字数上限', 'number'], ['dailyMessages', '每日消息上限', 'number'], ['board', '板书(auto = 老师判断;off = 只说话)', 'enum', ['auto', 'off']], ['scenes.dailyMax', '每天讲解动画上限', 'number'], ['dailyRegen', '每日重生上限(还没接上)', 'number'], ['reviewGate', '验收开关(先经家长)', 'bool'], ['forms', '回复形式(逗号分隔 L0-L4)', 'forms'], ['contextPack.recent', '上下文包:最近观察条数', 'number'], ['contextPack.planLines', '上下文包:计划行数', 'number']];
  const SHORT = { replyMaxChars: '每句 ', dailyMessages: '每日 ', board: '板书 ', 'scenes.dailyMax': '动画 ', dailyRegen: '重生 ', reviewGate: '验收 ', forms: '形式 ', 'contextPack.recent': '观察 ', 'contextPack.planLines': '计划 ' };
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
    } else if (type === 'bool') {
      box.append(h('select', { 'data-key': key },
        opts.inherit ? h('option', { value: '', selected: !changed }, '继承(' + (eff ? '开' : '关') + ')') : null,
        h('option', { value: 'true', selected: cur === true }, '开'),
        h('option', { value: 'false', selected: cur === false || (!opts.inherit && !changed && eff === false) }, '关')));
    } else {
      const val = cur === undefined ? '' : type === 'forms' ? cur.join(',') : String(cur);
      box.append(h('input', { type: type === 'number' ? 'number' : 'text', 'data-key': key, value: val, placeholder: (opts.inherit ? '继承 ' : '') + (type === 'forms' ? (eff || []).join(',') : eff) }));
    }
    if (changed && opts.inherit) box.append(h('span', { class: 'foot' }, '全局 ' + (type === 'forms' ? (eff || []).join(',') : String(eff)) + ' · 改过'));
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
      else if (type === 'bool') setPath(out, key, raw === 'true');
      else if (type === 'enum') setPath(out, key, raw);
      else setPath(out, key, raw.split(/[,,\\s]+/).filter(Boolean));
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

  const fileEditor = (t, card) => {
    const ta = h('textarea', { spellcheck: 'false', style: 'display:none' });
    const origin = h('span', { class: 'foot' });
    const save = h('button', { class: 'btn', type: 'button', style: 'display:none', on: { click: async () => {
      try {
        const f = await api('PUT', '/api/tutors/' + t.name + '/file', { text: ta.value });
        feedback(card, true, '老师文件已写入');
        origin.textContent = f.state === 'own' ? '自家加的老师' : '自定义';
      } catch (e) { feedback(card, false, e.message); }
    } } }, '保存老师文件');
    const btn = h('button', { class: 'btn', type: 'button', on: { click: async () => {
      const on = ta.style.display === 'none';
      ta.style.display = on ? 'block' : 'none';
      save.style.display = on ? 'inline-block' : 'none';
      if (on && !ta.value) {
        try {
          const f = await api('GET', '/api/tutors/' + t.name + '/file');
          ta.value = f.text;
          origin.textContent = f.state === 'own' ? '自家加的老师' : f.state === 'latest' ? '出厂件,最新' : f.state === 'upgradable' ? '出厂件,可升级' : '自定义' + (f.basedOn ? '(基于 ' + f.basedOn + ')' : '');
        } catch (e) { feedback(card, false, e.message); }
      }
    } } }, '老师文件');
    return [btn, save, origin, ta];
  };

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
    top.append(h('p', { class: 'hint' }, '留空 = 出厂缺省(60 字 / 30 条 / 3 次 / 验收关 / L0,L1,L3,L4 / 10,10)。运行时模板在 cotutor.json 里,路径与端口在设置页。'));

    const roster = h('div', { class: 'panel' });
    const addBox = h('div', { class: 'rowbody', style: 'display:none' },
      h('div', { class: 'field' }, h('label', {}, '老师名(英文键)'), h('input', { type: 'text', id: 'n-name', placeholder: 'science-tutor' })),
      h('div', { class: 'field' }, h('label', {}, '显示名'), h('input', { type: 'text', id: 'n-display', placeholder: '科学老师' })),
      h('div', { class: 'field' }, h('label', {}, '学科(可空)'), h('input', { type: 'text', id: 'n-subject', placeholder: '科学' })),
      h('div', { class: 'field' }, h('label', {}, '头像'), h('select', { id: 'n-avatar' }, ...['🧮', '📚', '📖', '🔬', '🎨', '🎵', '🌍', '💻', '🏃', '🧩', '📷', '🗓'].map((a) => h('option', { value: a }, a)))),
      h('div', { class: 'field chk' }, h('input', { type: 'checkbox', id: 'n-hidden' }), h('label', { for: 'n-hidden' }, '孩子端不露')),
      h('div', { class: 'full' },
        h('button', { class: 'btn primary', type: 'button', on: { click: async () => {
          const name = $('#n-name').value.trim();
          const display = $('#n-display').value.trim();
          if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return feedback(roster, false, '老师名要小写字母数字连字符');
          if (!display) return feedback(roster, false, '显示名不能空');
          try { await api('POST', '/api/tutors', { name, display, subject: $('#n-subject').value.trim(), avatar: $('#n-avatar').value, hidden: $('#n-hidden').checked }); await loadConfig(); renderTeam(); }
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
        h('div', { class: 'field' }, h('label', {}, '头像(emoji)'), h('input', { type: 'text', 'data-f': 'avatar', value: t.avatar || '' })),
        h('div', { class: 'field' }, h('label', {}, '音色(voxtell id)'), h('input', { type: 'text', 'data-f': 'voice', value: t.voice || '' })),
        h('div', { class: 'field chk' }, h('input', { type: 'checkbox', 'data-f': 'enabled', checked: t.enabled }), h('label', {}, '开启')),
        h('div', { class: 'field chk' }, h('input', { type: 'checkbox', 'data-f': 'hidden', checked: t.hidden }), h('label', {}, '孩子端不露')),
        ...policyFields(patch, t.policy, { inherit: true }));
      const saveBtn = h('button', { class: 'btn primary', type: 'button' }, '保存');
      const full = h('div', { class: 'full' }, saveBtn, ...fileEditor(t, card), h('span', { class: 'fb' }));
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
          patchAndReload(card, { tutors: { [t.name]: { display: f('display').value.trim(), subject: f('subject').value.trim() || null, avatar: f('avatar').value.trim() || null, voice: f('voice').value.trim() || null, enabled: f('enabled').checked, hidden: f('hidden').checked, policy: readPolicy(body) } } }, renderTeam);
        } catch (e) { feedback(card, false, e.message); }
      });
      const caret = h('span', { class: 'caret' }, '▾');
      const row = h('div', { class: 'row' + (t.enabled ? '' : ' off'), on: { click: (e) => {
        if (e.target.closest('input,select,button,textarea,label')) return;
        const on = body.style.display === 'none';
        body.style.display = on ? 'grid' : 'none';
        caret.textContent = on ? '收起 ▴' : '▾';
      } } },
        h('span', { class: 'av' }, t.avatar || '🙂'),
        h('span', { class: 'name' }, h('b', {}, t.display), h('span', {}, t.name + (t.subject ? ' · ' + t.subject : ''))),
        h('span', { class: 'tags' }, ...tutorTags(t, patch)),
        caret);
      list.append(row, card);
    }
    roster.append(list);
    $('#team').replaceChildren(h('div', { class: 'wrap' }, top, roster));
  };

  // ---- 设置:路径 / 服务 / 配音;文件仍是真相 ----
  const PATH_ROLES = [['vault', 'vault 根', 'Obsidian 仓库;空 = workspace 根'], ['timetable', '课程表', '相对 vault'], ['plans', '计划目录', ''], ['diary', '日记目录', ''], ['photos', '照片目录', ''], ['profile', '孩子档案', '']];

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
    tts.append(h('p', { class: 'hint' }, '用第一位配了音色的老师试;voxtell 不在 PATH 就把第一项写成完整路径。kid、version、运行时模板请直接编辑 cotutor.json。'));

    const mig = migratePanel();
    $('#settings').replaceChildren(h('div', { class: 'wrap' }, ...(mig ? [mig] : []), paths, server, tts));
  };

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
    }, 10000);
  })().catch((e) => { $('#msgs').replaceChildren(h('p', { class: 'empty' }, '加载失败:' + e.message)); });
})();
</script>
</html>
`;
