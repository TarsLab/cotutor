/**
 * /talk:口语课的页面,孩子端(《口语课设计.md》拍板 12;设计稿 https://claude.ai/artifact/6uL5XfzhFEfX74cmeWbF9c)。家长端没有这一页(拍板 13),回放从记录进录像。
 * 按 hash 切三屏:#/ 拍照(同拍照听写的骨架,photo-ui.ts;上次的口语单给「接着上」)、#/list/<id> 照片在左、口语单在右(孩子能改、能补、能删)、#/kid/<id> 跟读与聊。
 * 「开始跟读」「接着上」点下去就开麦开始(这一下就是开麦要的那次点击),不再过开始屏;开始屏只在刷新了跟读那一屏时出来。
 * 孩子那一屏的样子和老师页一样(《口语课设计.md》§8.2):装孩子端的 /kid/theme.css,今天的词用单词卡(cards/word,画法 word-draw.ts)、句子用点读卡的行(cards/read);
 * 自己的类名别撞主题的(.rd 是点读卡的行,自己的状态胶囊叫 .tk-rd)。
 * 声音(src/live/audio-client.ts):getUserMedia → AudioWorklet 降到 16k PCM16,100 毫秒一块走 WebSocket 二进制帧上去;下来的 24k PCM16 一块块排进 AudioContext 放。
 * 内联脚本里不写反斜杠、不写反引号、不写美元加花括号(这是模板字符串,见 CLAUDE.md「坑」)。
 */
import { inlineScript } from '../server/inline-lib.ts';
import { wordDrawJs } from '../server/word-draw.ts';
import { AUDIO_CLIENT_JS } from '../live/audio-client.ts';
import { TUTOR_FACE_CSS, TUTOR_FACE_JS } from '../server/tutor-face.ts';
import { SNAP_CSS, cameraSvg, snapHtml } from '../server/photo-ui.ts';
import { faviconLinks } from '../lib/favicon.ts';

/** 录像的轨道(lib/reel.ts),内联进录像模式 */
const TALK_REEL_JS = inlineScript(new URL('./lib/reel.ts', import.meta.url));

const TALK_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
${faviconLinks()}
<title>口语课</title>
<link rel="stylesheet" href="/kid/theme.css">
<style>
  :root { --paper:#faf9f4; --ink:#2b2b2b; --dim:#8a8781; --line:#e2dfd6; --card:#ffffff; --kid:#dbeeff; --tutor:#fff3d6; --tutor-line:#f0dca8; --tutor-ink:#8a5a12; --accent:#e8743b; --blue:#eef4ff; --blue-ink:#2f5e9e; --plum:#efe9fb; --plum-ink:#7a4fc9; --grey:#eeece6; --night:#2b3a4a; --red:#b3412a; }
  /* 孩子那几屏跟口语课挂的那位老师走(《首页设计.md》拍板 27):他的学科色(读到老师后换,缺省英语绿)、头像、名字 */
  :root { --sc:#1f8a4c; --sc-soft:color-mix(in srgb, var(--sc) 12%, #fff); --sc-ink:color-mix(in srgb, var(--sc) 62%, #000); }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  /* 下面给 .mid / .start / .bar 写了 display:flex,会盖掉浏览器自带的 [hidden];不加这条,孩子页五块一起全露出来(2026-10-10 Safari 上看到的) */
  [hidden] { display:none !important; }
  html,body { margin:0; height:100%; background:var(--paper); color:var(--ink); font:17px/1.5 -apple-system,"PingFang SC","Helvetica Neue",sans-serif; overscroll-behavior:none; }
  body { -webkit-user-select:none; user-select:none; }
  input,button { font:inherit; color:inherit; }
  button { cursor:pointer; border:0; background:none; padding:0; }
  button:disabled { opacity:.4; cursor:default; }
  input { -webkit-user-select:text; user-select:text; }
  .view { display:none; min-height:100%; flex-direction:column; }
  .view.on { display:flex; }
  .wrap { width:100%; max-width:1180px; margin:0 auto; padding:18px 16px calc(env(safe-area-inset-bottom) + 18px); display:flex; flex-direction:column; flex:1; }
  .top { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:48px; }
  .pill { display:inline-flex; align-items:center; gap:8px; height:48px; padding:0 18px; border-radius:24px; background:#fff; border:1px solid var(--line); font-size:17px; font-weight:600; white-space:nowrap; }
  .pill.dark { background:var(--ink); color:#fff; border-color:var(--ink); }
  .pill.red { color:var(--red); }
  .pill:active { transform:scale(.96); }
  .chip { display:inline-flex; align-items:center; gap:8px; height:36px; padding:0 14px; border-radius:18px; font-size:15px; font-weight:600; background:var(--grey); color:var(--dim); }
  .chip.blue { background:var(--blue); color:var(--blue-ink); }
  .chip.plum { background:var(--plum); color:var(--plum-ink); }
  .dot { width:10px; height:10px; border-radius:50%; background:#1f8a4c; }
  .muted { color:var(--dim); }
  .small { font-size:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:18px; }
  .big { display:flex; align-items:center; justify-content:center; gap:12px; height:76px; padding:0 28px; border-radius:38px; background:var(--ink); color:#fff; font-size:24px; font-weight:700; box-shadow:0 6px 18px rgba(0,0,0,.18); touch-action:none; }
  .big.held { background:var(--accent); }
  .big.off { background:#9a978f; box-shadow:none; }
  .toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%); background:var(--ink); color:#fff; border-radius:20px; padding:10px 18px; font-size:15px; z-index:50; display:none; max-width:90vw; }
  .toast.on { display:block; }
  svg { flex:none; }

  /* 孩子:拍照(photo-ui.ts,同拍照听写)。.main 是主按钮:老师的颜色 */
  .main { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:60px; padding:0 30px; border-radius:30px; background:var(--sc); color:#fff; font-size:20px; font-weight:600; }
  .main:disabled { opacity:.45; }
  #snap { padding:calc(env(safe-area-inset-top) + 10px) 24px calc(env(safe-area-inset-bottom) + 24px); }
${SNAP_CSS}
  /* 孩子:照片在左、口语单在右(竖着照片在上);读的时候照片上一道扫过的光,右边先用浅灰占好位置 */
  #pick { height:100vh; height:100dvh; }
  #pick .pwrap { flex:1; min-height:0; display:flex; gap:20px; padding:calc(env(safe-area-inset-top) + 10px) 20px calc(env(safe-area-inset-bottom) + 16px) 24px; }
  .tk-shot { flex:1; min-width:0; min-height:0; display:flex; align-items:center; justify-content:center; padding-top:48px; }
  .tk-shotin { position:relative; display:inline-block; max-width:100%; border-radius:12px; overflow:hidden; background:#2b2b2b; }
  .tk-shotin img { display:block; max-width:100%; max-height:calc(100vh - 100px); max-height:calc(100dvh - 100px); min-width:160px; min-height:160px; }
  .tk-scan { position:absolute; left:0; right:0; top:0; height:30%; background:linear-gradient(180deg, transparent, color-mix(in srgb, var(--sc) 28%, transparent), transparent); animation:tk-scan 1.6s ease-in-out infinite alternate; pointer-events:none; }
  @keyframes tk-scan { from { transform:translateY(-40%); } to { transform:translateY(270%); } }
  .tk-side { width:420px; flex:none; min-height:0; display:flex; flex-direction:column; gap:10px; }
  .tk-hd { display:flex; align-items:center; gap:14px; }
  .tk-hd .tfav { width:52px; height:52px; font-size:24px; }
  .tk-hd b { display:block; font-size:22px; } .tk-hd small { display:block; font-size:15px; color:var(--dim); }
  .tk-scroll { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:8px; padding:2px; }
  .tk-sec { font-size:14px; font-weight:700; color:var(--dim); margin-top:6px; }
  .tk-ws { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; }
  .tk-it { display:flex; align-items:center; gap:8px; min-height:62px; padding:6px 4px 6px 12px; background:#fff; border:1.5px solid var(--line); border-radius:16px; }
  .tk-it .tx { flex:1; min-width:0; text-align:left; display:flex; align-items:center; gap:10px; min-height:48px; }
  .tk-it .tx > span { min-width:0; }
  .tk-it .en { display:block; font-size:21px; font-weight:600; line-height:1.2; overflow-wrap:anywhere; }
  .tk-it.w .en { font-family:"Chalkboard SE","Comic Sans MS","Marker Felt",sans-serif; font-weight:400; font-size:23px; }
  .tk-it .zh { display:block; font-size:13px; color:var(--dim); }
  .tk-it .em { font-size:26px; line-height:1; flex:none; }
  .tk-it .x { flex:none; width:44px; height:44px; border-radius:22px; display:grid; place-items:center; color:var(--dim); }
  .tk-it.ed { border:2px solid var(--sc); box-shadow:0 0 0 4px color-mix(in srgb, var(--sc) 15%, transparent); }
  .tk-it.ed .x { color:var(--sc); }
  .tk-it input { display:block; width:100%; border:0; border-bottom:2px solid var(--sc); background:transparent; padding:2px 0; outline:0; font-size:20px; }
  .tk-it input.zh { border-bottom:1px solid var(--line); font-size:14px; color:var(--dim); margin-top:4px; }
  .tk-sk { background:#ebe8e0; border-radius:16px; min-height:62px; }
  .tk-add { align-self:flex-start; display:inline-flex; align-items:center; gap:6px; min-height:44px; padding:0 6px; color:var(--sc-ink); font-weight:600; }
  .tk-go { display:flex; gap:10px; }
  .tk-go .pill { height:60px; border-radius:30px; }
  .tk-go .main { flex:1; padding:0 16px; }
  @media (orientation: portrait) {
    #pick .pwrap { flex-direction:column; }
    .tk-shot { flex:none; padding-top:52px; }
    .tk-shotin img { max-height:36vh; }
    .tk-side { width:auto; flex:1; }
  }

  /* 孩子:跟读 */
  #kid { background:var(--paper); }
  #kid .wrap { min-height:100vh; height:100vh; height:100dvh; overflow:hidden; }
  #kid .mid { flex:1; min-height:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:8px 0; text-align:center; }
  #kid .list { display:flex; flex-wrap:wrap; justify-content:center; gap:6px 10px; padding:8px 16px; border-radius:16px; background:var(--grey); font-size:15px; color:var(--dim); max-width:900px; }
  #kid .list b { color:var(--ink); font-weight:600; }
  #kid .list b.now { background:linear-gradient(transparent 55%, #ffd66b 55%); }
  #kid .say { display:flex; align-items:center; gap:10px; font-size:20px; min-height:30px; }
  #kid .say .zh { color:var(--dim); font-size:16px; }
  #kid .rc { width:100%; max-width:760px; padding:26px 36px 22px; border-radius:26px; background:#fff; border:1px solid var(--line); box-shadow:0 4px 18px rgba(0,0,0,.05); display:flex; flex-direction:column; align-items:center; gap:10px; }
  #kid .rc .en { font-size:52px; font-weight:700; line-height:1.15; }
  #kid .rc .en.long { font-size:34px; }
  #kid .rc .zh { font-size:20px; color:var(--dim); }
  #kid .rc .again { display:inline-flex; align-items:center; gap:10px; height:52px; padding:0 22px; border-radius:26px; background:var(--blue); color:var(--blue-ink); font-weight:600; font-size:18px; }
  #kid .heard { display:inline-flex; align-items:center; gap:10px; padding:10px 18px; border-radius:18px; background:var(--kid); font-size:17px; min-height:46px; }
  #kid .heard:empty { visibility:hidden; }
  #kid .dots { display:flex; gap:8px; }
  #kid .dots i { width:12px; height:12px; border-radius:50%; background:var(--line); }
  #kid .dots i.done { background:var(--blue-ink); }
  #kid .dots i.now { background:var(--accent); }
  #kid .bar { display:flex; align-items:center; justify-content:center; gap:24px; padding:8px 0 10px; flex-wrap:wrap; }
  #kid .bar.small { gap:12px; }
  #kid .rc.now { border:2px solid var(--accent); box-shadow:0 6px 22px rgba(232,116,59,.16); }
  /* 跟我读不用按(《口语课设计.md》§8.1):现在轮到谁,一颗胶囊 */
  #kid .tk-rd { display:inline-flex; align-items:center; gap:12px; min-height:64px; padding:0 26px 0 22px; border-radius:32px; font-size:20px; font-weight:600; }
  #kid .tk-rd.tutor { background:var(--sc-soft); color:var(--sc-ink); }
  #kid .tk-rd.listen, #kid .tk-rd.speech, #kid .tk-rd.wait { background:#fff; color:var(--blue-ink); padding-left:8px; box-shadow:0 0 0 3px #9cc3ef, 0 2px 8px rgba(0,0,0,.08); }
  #kid .tk-rd.heard { background:var(--grey); color:var(--dim); }
  #kid .tk-rd .mic { width:40px; height:48px; display:grid; place-items:center; flex:none; }
  /* 5 秒没出声(拍板 15):老师不再读,「再听一遍」描上老师的颜色、轻轻跳一下 */
  #kid #k-again.nudge { border:2px solid var(--sc); color:var(--sc-ink); box-shadow:0 0 0 6px color-mix(in srgb, var(--sc) 15%, transparent); animation:tk-nudge .9s ease-out 1; }
  @keyframes tk-nudge { 0% { transform:scale(1); } 30% { transform:scale(1.08); } 100% { transform:scale(1); } }
  @media (prefers-reduced-motion: reduce) { #kid #k-again.nudge { animation:none; } }
  #kid .tk-rd .lv2 { display:flex; align-items:center; gap:4px; height:28px; }
  #kid .tk-rd .lv2 i { width:5px; height:6px; border-radius:3px; background:currentColor; opacity:.85; transition:height .08s; }
  #kid .back { display:inline-flex; align-items:center; gap:6px; height:48px; padding:0 8px 0 12px; border-radius:24px; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.12); color:var(--dim); text-decoration:none; }
  #kid .hint { text-align:center; font-size:14px; color:var(--dim); min-height:20px; }
  #kid .start { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; text-align:center; }
  #kid .start .av { width:140px; height:140px; border-radius:50%; background:var(--blue); color:var(--blue-ink); display:grid; place-items:center; font-size:64px; font-weight:700; }

  /* 孩子:聊 */
  /* 孩子:打电话(§8.2):老师的头像(说话绿圈、听孩子蓝圈)、一张字幕卡、孩子那句、今天的单词卡一排、底部条 */
  #kid .tk-av { position:relative; width:180px; height:180px; display:grid; place-items:center; flex:none; }
  #kid .tk-av i { position:absolute; border-radius:50%; transition:background .3s; }
  #kid .tk-av i.o1 { inset:0; } #kid .tk-av i.o2 { inset:16px; }
  #kid .tk-av.talk i.o1 { background:color-mix(in srgb, var(--sc) 8%, transparent); } #kid .tk-av.talk i.o2 { background:color-mix(in srgb, var(--sc) 15%, transparent); }
  #kid .tk-av.listen i.o1 { background:rgba(47,94,158,.08); } #kid .tk-av.listen i.o2 { background:rgba(47,94,158,.15); }
  #kid .tk-av > .face { position:relative; width:116px; height:116px; border-radius:50%; background:#fff; display:grid; place-items:center; box-shadow:0 2px 10px rgba(0,0,0,.08); }
  #kid .tk-tt { width:100%; max-width:976px; padding:18px 28px; border-radius:22px; background:#fff; border:1px solid var(--line); font-size:30px; font-weight:700; line-height:1.3; min-height:84px; }
  #kid .tk-tt .zh { display:block; font-size:17px; font-weight:400; color:var(--dim); margin-top:4px; }
  /* 提示卡(《口语课设计.md》拍板 16):字幕卡角上的小灯泡;卡正面中文,翻过来英文句型带空,点词填进去;不出声 */
  #kid .tk-ttw { position:relative; width:100%; max-width:976px; }
  #kid .tk-bulb { position:absolute; right:14px; bottom:-20px; display:inline-flex; align-items:center; gap:6px; height:42px; padding:0 16px; border-radius:21px; background:#fff8e6; border:1.5px solid #efcf7a; color:#7a5b12; font-size:15px; font-weight:600; box-shadow:0 2px 8px rgba(0,0,0,.08); }
  #kid .tk-hc { width:100%; max-width:640px; margin-top:22px; padding:16px 20px; border-radius:22px; background:#fff8e6; border:2px solid #efcf7a; box-shadow:0 6px 18px rgba(201,154,42,.15); text-align:left; animation:tk-up .25s ease-out; }
  @keyframes tk-up { from { transform:translateY(8px); opacity:0; } to { transform:none; opacity:1; } }
  #kid .tk-hc .fr { display:flex; align-items:center; gap:16px; width:100%; text-align:left; }
  #kid .tk-hc .ic { width:52px; height:52px; border-radius:26px; background:#fde9b0; color:#9a6b00; display:grid; place-items:center; flex:none; }
  #kid .tk-hc .fr b { display:block; font-size:22px; line-height:1.3; }
  #kid .tk-hc .fr small { display:block; font-size:15px; color:#7a5b12; margin-top:2px; }
  #kid .tk-hc .bh { display:flex; align-items:center; gap:8px; }
  #kid .tk-hc .bh span { flex:1; font-size:15px; color:#7a5b12; }
  #kid .tk-hc .flip { width:44px; height:44px; border-radius:22px; display:grid; place-items:center; color:#9a6b00; flex:none; }
  #kid .tk-hc .pat { display:flex; justify-content:center; align-items:baseline; flex-wrap:wrap; gap:4px 10px; font-family:"Chalkboard SE","Comic Sans MS","Marker Felt",sans-serif; font-size:38px; line-height:1.3; margin:2px 0 12px; }
  #kid .tk-hc .bl { min-width:120px; text-align:center; border-bottom:3px dashed #c99a2a; color:var(--sc-ink); }
  #kid .tk-hc .ops { display:flex; justify-content:center; gap:10px; flex-wrap:wrap; }
  #kid .tk-hc .op { display:inline-flex; align-items:center; gap:8px; min-height:48px; padding:0 18px; border-radius:24px; background:#fff; border:1.5px solid var(--line); font-family:"Chalkboard SE","Comic Sans MS","Marker Felt",sans-serif; font-size:24px; }
  #kid .tk-hc .op.on { border-color:#c99a2a; box-shadow:0 0 0 3px #efcf7a66; }
  /* 卡出来时头像缩小,iPad 横着一屏放得下(字幕、卡、孩子那句、单词卡、底部条) */
  #kid.hinting .tk-av { width:76px; height:76px; } #kid.hinting .tk-av > .face { width:60px; height:60px; } #kid.hinting .tk-av > .face > .tfav { font-size:24px; }
  #kid.hinting .mid { gap:10px; }
  @media (max-height:760px) { #kid.hinting .tk-av { display:none; } #kid.hinting .tk-hc { margin-top:20px; padding:12px 18px; } #kid.hinting .tk-hc .pat { font-size:32px; margin-bottom:8px; } }
  @media (prefers-reduced-motion: reduce) { #kid .tk-hc { animation:none; } }
  #kid #k-heard2 { align-self:flex-end; max-width:80%; margin-right:max(0px, calc((100% - 976px) / 2)); }
  #kid .tk-words { width:100%; max-width:976px; display:flex; gap:10px; overflow-x:auto; padding:4px 2px 8px; margin-top:auto; scrollbar-width:none; }
  #kid .tk-words::-webkit-scrollbar { display:none; }
  #kid .tk-words .c.c-word { flex:none; flex-wrap:nowrap; gap:8px; padding:8px 10px 8px 14px; transition:border-color .2s, box-shadow .2s; }
  #kid .tk-words .c-word .we { font-size:30px; }
  #kid .tk-words .c-word .wd-row { margin-left:4px; }
  #kid .c-word.now { border-color:var(--sel); box-shadow:0 0 0 1px var(--sel), 0 4px 14px var(--sel-halo); }
  #kid .tk-call { width:100%; max-width:976px; height:60px; border-radius:30px; background:#fff; box-shadow:0 1px 6px rgba(0,0,0,.12); display:flex; align-items:center; gap:14px; padding:0 8px 0 22px; color:var(--sc); }
  #kid .tk-call.you { box-shadow:0 0 0 3px #9cc3ef, 0 1px 6px rgba(0,0,0,.12); color:var(--blue-ink); }
  #kid .tk-call .st { flex:1; font-size:17px; color:var(--dim); }
  #kid .tk-call.you .st { color:var(--blue-ink); font-weight:600; }
  #kid .tk-call .lv { display:flex; align-items:center; gap:4px; height:28px; }
  #kid .tk-call .lv i { width:4px; height:6px; border-radius:2px; background:currentColor; transition:height .08s; }
  #kid .tk-call .hang { display:inline-flex; align-items:center; gap:8px; height:46px; padding:0 20px; border-radius:23px; background:var(--ink); color:#fff; font-size:16px; font-weight:600; }
  /* 跟我读的大卡:单词是单词卡的四线三格(舞台那么大),句子是点读卡的一行 */
  #kid #k-card { min-height:240px; justify-content:center; }
  #kid #k-card .we { font-size:72px; line-height:1; }
  #kid #k-card .c-read { width:100%; background:none; border:0; padding:0; }
  #kid #k-card .rd { font-size:40px; font-weight:700; line-height:1.3; cursor:default; }
  #kid #k-card .rd .zh { display:block; font-size:20px; font-weight:400; color:var(--dim); }

  @media (max-width:600px) {
    #kid .rc { padding:26px 20px 22px; }
    #kid .rc .en { font-size:40px; }
    #kid .rc .en.long { font-size:26px; }
    #kid .big { height:64px; font-size:20px; padding:0 22px; }
    #kid .tk-tt { font-size:22px; padding:14px 18px; }
    #kid .tk-av { width:136px; height:136px; } #kid .tk-av > .face { width:88px; height:88px; } #kid .tk-av > .face > .tfav { font-size:32px; }
    #kid #k-card .we { font-size:52px; } #kid #k-card .rd { font-size:28px; }
  }
  #kid .start .tfav { width:140px; height:140px; font-size:64px; }
  #kid .tk-av > .face > .tfav { width:86%; height:86%; font-size:44px; }
  __TUTOR_FACE_CSS__
</style></head>
<body>
<div id="snap" class="view">
  ${snapHtml({ kind: 'talk', id: 'snap-hero', cam: 'p-cam', lib: 'p-lib' })}
</div>

<div id="pick" class="view"><div class="pwrap">
  <div class="tk-shot"><div class="tk-shotin"><img id="p-img" alt="拍的那一页"><div class="tk-scan" id="p-scan" hidden></div></div></div>
  <div class="tk-side">
    <div class="tk-hd"><span id="p-av"></span><div><b id="p-title">老师在看这一页…</b><small id="p-sub">找出单词和句子,一会儿就好</small></div></div>
    <div class="tk-scroll">
      <div class="tk-sec">单词 · <span id="p-nw">0</span></div>
      <div class="tk-ws" id="p-words"></div>
      <button class="tk-add" type="button" id="p-addw"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>补一个单词</button>
      <div class="tk-sec">句子 · <span id="p-ns">0</span></div>
      <div id="p-sents" style="display:flex;flex-direction:column;gap:8px"></div>
      <button class="tk-add" type="button" id="p-adds"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>补一句</button>
    </div>
    <div class="tk-go"><button class="pill" type="button" id="p-again">${cameraSvg()}重拍</button><button class="main" type="button" id="p-go" disabled>开始跟读</button></div>
  </div>
</div></div>

<div id="kid" class="view"><div class="wrap">
  <div class="top">
    <span class="bk-slot"></span>
    <div style="display:flex;align-items:center;gap:12px"><div class="dots" id="k-dots"></div><span class="chip plum" id="k-chip">跟我读</span></div>
  </div>
  <div class="start" id="k-start">
    <div class="av" id="k-sav">E</div>
    <b style="font-size:26px" id="k-sname">英语老师</b>
    <div class="muted" id="k-start-hint">先跟老师读几句,再用这些词聊一聊</div>
    <button class="big" type="button" id="k-go" style="background:var(--sc)"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4l14 8-14 8z"/></svg>开始</button>
    <div class="muted small">老师读一句,你读一句;读完自己往下走,不用按</div>
  </div>
  <div class="mid" id="k-read" hidden>
    <div class="say" id="k-say"><span class="en">Listen first, then you try.</span><span class="zh">先听,再你来。</span></div>
    <div class="rc now" id="k-card"></div>
    <div class="tk-rd tutor" id="k-rd"></div>
    <div class="heard" id="k-heard"></div>
  </div>
  <div class="mid" id="k-chat" hidden>
    <div class="tk-av" id="k-av"><i class="o1"></i><i class="o2"></i><span class="face"><svg style="color:var(--sc)" width="84" height="84" viewBox="0 0 48 48" aria-hidden="true"><path d="M40.4 12.5A20 20 0 1 0 40.4 35.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><text x="24" y="30" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor">英</text></svg></span></div>
    <div class="tk-ttw"><div class="tk-tt" id="k-tt"></div><button class="tk-bulb" type="button" id="k-bulb" hidden><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/></svg>不知道怎么说?</button></div>
    <div class="tk-hc" id="k-hc" hidden></div>
    <div class="heard" id="k-heard2"></div>
    <div class="tk-words" id="k-words"></div>
  </div>
  <div class="bar small" id="k-bar" hidden>
    <button class="pill" type="button" id="k-again"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>再听一遍</button>
    <button class="pill" type="button" id="k-next">下一句 ›</button>
    <button class="pill" type="button" id="k-skip" style="color:var(--dim)">直接打电话</button>
  </div>
  <div class="bar" id="k-bar2" hidden>
    <div class="tk-call" id="k-call"><span class="lv" id="k-lv"><i></i><i></i><i></i><i></i><i></i></span><span class="st" id="k-callst">老师在说,等她说完你再说</span><button class="hang" type="button" id="k-hang"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 15c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5a10 10 0 0 0-7 0V16l-3 1.5z"/></svg>挂断</button></div>
  </div>
  <div class="hint" id="k-hint"></div>
</div></div>

<div class="toast" id="toast"></div>

<script>
(() => {
  const $ = (s) => document.querySelector(s);
  const h = (tag, attrs, ...kids) => { const el = document.createElement(tag); for (const k in attrs || {}) { if (k === 'class') el.className = attrs[k]; else if (k === 'on') { for (const e in attrs[k]) el.addEventListener(e, attrs[k][e]); } else if (k === 'html') el.innerHTML = attrs[k]; else if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]); } for (const c of kids.flat()) if (c !== null && c !== undefined) el.append(c); return el; };
  const api = async (method, path, body) => { const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => null); if (!r.ok) throw new Error((j && (j.message || j.error)) || ('HTTP ' + r.status)); return j; };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => { const el = document.createElementNS(SVG_NS, tag); for (const k in attrs || {}) el.setAttribute(k, String(attrs[k])); return el; };
  // ---- 单词卡的画法(src/server/word-draw.ts,和老师页同一份):wordGrid / wordWrite / wordMerge ----
__WORD_DRAW_JS__
  let toastTimer = null;
  const toast = (s) => { const t = $('#toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400); };
  let info = null;

  // ---- 路由:#/ 拍照、#/list/<id> 看口语单、#/kid/<id> 跟读与聊 ----
  const views = ['snap', 'pick', 'kid'];
  const show = (name) => { for (const v of views) $('#' + v).classList.toggle('on', v === name); BACK.el.hidden = Boolean(REEL_ID); };
  // 左上角「‹ logo」胶囊同老师页(《首页设计.md》拍板 27,《产品规划.md》拍板 24):点了挂断、回首页
  __TUTOR_FACE_JS__
  const BACK = backCapsule(() => { if (call) call.hangup('left'); location.href = '/'; });
  BACK.el.hidden = true; document.body.append(BACK.el);
  let OWNER = null;
  /** 口语课挂的那位老师:首页链接带 ?tutor=,没带就找卡上有口语课的,再没有找英语老师;换上他的颜色、头像、名字 */
  const wearOwner = async () => {
    let ts = [];
    try { ts = (await api('GET', '/api/kid/home')).tutors || []; } catch { return; }
    const want = new URLSearchParams(location.search).get('tutor');
    const t = ts.find((x) => x.name === want) || ts.find((x) => (x.extras || []).includes('talk')) || ts.find((x) => x.lang === 'en');
    if (!t) return;
    OWNER = t;
    document.documentElement.style.setProperty('--sc', t.color);
    $('#snap-av').replaceChildren(tutorAvatar(t));
    $('#p-av').replaceChildren(tutorAvatar(t));
    $('#k-sav').replaceWith(Object.assign(tutorAvatar(t), { id: 'k-sav' }));
    $('#k-sname').textContent = t.display;
    $('#k-av .face').replaceChildren(tutorAvatar(t));
    // 老师开没开实时定了按钮上的字
    if (P.meta) renderGo();
  };
  const go = (hash) => { location.hash = hash; };
  /** 录像模式(?reel=<id>,《口语课设计.md》§8.3):开在家长端录像外壳的 iframe 里,照录下的消息画孩子那一屏 */
  const REEL_ID = new URLSearchParams(location.search).get('reel');
  let RL = null;
  /** 现在几毫秒:平时是钟;录像里是录像放到的那一刻(离通话开始) */
  const nowMs = () => (RL ? RL.t : Date.now());
  const route = () => {
    const m = /^#\\/(list|kid)\\/([^/]+)/.exec(location.hash);
    if (!m) { show('snap'); void snap(); return; }
    if (m[1] === 'list') { show('pick'); void pick(m[2]); }
    else { show('kid'); void kid(m[2]); }
  };
  window.addEventListener('hashchange', () => { if (REEL_ID) return; if (call) call.hangup('left'); route(); });

  // ---- 拍照(《口语课设计.md》拍板 12、14):同拍照听写的骨架;上次的口语单在最上面给「接着上」 ----
  const lastList = () => (info && info.enabled ? (info.talks || []).find((x) => (x.status === 'ready' || x.status === 'done') && x.list.words.length + x.list.sentences.length > 0) : null) || null;
  async function snap() {
    try { info = await api('GET', '/api/talk'); } catch (e) { info = null; }
    if (info && !info.enabled) { location.replace('/'); return; }
    const last = lastList();
    $('#snap-resume').hidden = !last;
    $('#snap-cam-btn').classList.toggle('alt', Boolean(last));
    if (!last) return;
    const d = new Date(last.createdAt), nw = last.list.words.length, ns = last.list.sentences.length;
    $('#snap-resume-sub').textContent = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日拍的 · ' + [nw ? nw + ' 个单词' : '', ns ? ns + ' 句' : ''].filter(Boolean).join('、');
  }
  $('#snap-resume-go').addEventListener('click', (e) => { (toLive() ? handoff : startWith)(async () => (await api('POST', '/api/talk', { from: 'latest' })).id, e.currentTarget); });
  const shrink = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { const max = 1600; const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85)); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('这张图打不开')); };
    img.src = url;
  });

  // ---- 看口语单(拍板 12):照片在左;读的时候「老师在看这一页…」,读完原地填上;点一项改字、× 去掉、能补 ----
  const MAX = { words: 12, sentences: 8 };
  let P = { id: null, meta: null, waiting: false, failed: false, edit: null };
  async function shoot(file) {
    if (!file) return;
    if (P.url) URL.revokeObjectURL(P.url);
    P = { id: null, meta: null, waiting: true, failed: false, edit: null, url: URL.createObjectURL(file) };
    $('#p-img').src = P.url;
    history.replaceState(null, '', location.pathname + location.search + '#/list/');
    show('pick'); renderPick();
    try {
      const photo = await shrink(file);
      const m = await api('POST', '/api/talk', { photo });
      P.id = m.id; P.meta = m;
      history.replaceState(null, '', location.pathname + location.search + '#/list/' + m.id);
    } catch (e) { P.failed = true; }
    P.waiting = false; renderPick();
  }
  $('#p-cam').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; shoot(f); });
  $('#p-lib').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; shoot(f); });
  async function pick(id) {
    if (P.id === id && P.meta) { renderPick(); return; }
    P = { id: null, meta: null, waiting: true, failed: false, edit: null };
    renderPick();
    try { P.meta = (await api('GET', '/api/talk/' + id)).meta; P.id = id; } catch (e) { go('#/'); return; }
    if (P.meta.photo) $('#p-img').src = '/api/talk/' + id + '/photo'; else $('#p-img').removeAttribute('src');
    P.waiting = false; renderPick();
  }
  const ICON_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const ICON_OK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
  /** 改完一项:英文空了就去掉 */
  const doneEdit = () => {
    const e = P.edit; P.edit = null;
    if (!e || !P.meta) return;
    const arr = P.meta.list[e.kind], it = arr[e.i];
    if (it) { it.en = it.en.replace(/\\s+/g, ' ').trim(); it.zh = (it.zh || '').trim(); if (!it.en) arr.splice(e.i, 1); }
  };
  function itemEl(kind, it, i) {
    const word = kind === 'words';
    const editing = P.edit && P.edit.kind === kind && P.edit.i === i;
    if (editing) {
      const en = h('input', { class: 'en', value: it.en, placeholder: word ? '单词' : '英文句子', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': '英文' });
      const zh = h('input', { class: 'zh', value: it.zh || '', placeholder: '中文意思(可以不写)', 'aria-label': '中文' });
      en.addEventListener('input', () => { it.en = en.value; renderGo(); });
      zh.addEventListener('input', () => { it.zh = zh.value; });
      for (const x of [en, zh]) x.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { doneEdit(); renderPick(); } });
      const el = h('div', { class: 'tk-it ed' + (word ? ' w' : '') }, h('div', { class: 'tx', style: 'display:block' }, en, zh), h('button', { class: 'x', type: 'button', 'aria-label': '改好了', html: ICON_OK, on: { click: () => { doneEdit(); renderPick(); } } }));
      setTimeout(() => { if (!en.value) en.focus(); }, 0);
      return el;
    }
    return h('div', { class: 'tk-it' + (word ? ' w' : '') },
      h('button', { class: 'tx', type: 'button', 'aria-label': '改 ' + it.en, on: { click: () => { doneEdit(); P.edit = { kind, i: P.meta.list[kind].indexOf(it) }; renderPick(); } } },
        word && it.emoji ? h('span', { class: 'em' }, it.emoji) : null, h('span', {}, h('span', { class: 'en' }, it.en), it.zh ? h('span', { class: 'zh' }, it.zh) : null)),
      h('button', { class: 'x', type: 'button', 'aria-label': '不要 ' + it.en, html: ICON_X, on: { click: () => { doneEdit(); const k = P.meta.list[kind].indexOf(it); if (k >= 0) P.meta.list[kind].splice(k, 1); renderPick(); } } }));
  }
  const filled = () => (P.meta ? P.meta.list.words.filter((x) => x.en.trim()).length + P.meta.list.sentences.filter((x) => x.en.trim()).length : 0);
  function renderGo() {
    const n = filled();
    $('#p-go').disabled = !P.id || !n || P.waiting;
    const label = toLive() ? '先热身,再打电话' : '开始跟读';
    $('#p-go').textContent = n ? label + ' · ' + n + ' 个' : label;
  }
  function renderPick() {
    $('#p-scan').hidden = !P.waiting;
    const L = P.meta ? P.meta.list : null;
    const n = L ? L.words.length + L.sentences.length : 0;
    $('#p-title').textContent = P.waiting ? '老师在看这一页…' : '今天的口语单';
    $('#p-sub').textContent = P.waiting ? '找出单词和句子,一会儿就好' : P.failed ? '这张没传上去,再拍一张试试' : n ? '点一项改字,不要的点 ×' : '这一页没看到英文,换一页拍,或者自己补几个';
    if (P.waiting || !L) {
      $('#p-nw').textContent = '…'; $('#p-ns').textContent = '…';
      $('#p-words').replaceChildren(...[0, 1, 2, 3].map(() => h('div', { class: 'tk-sk' })));
      $('#p-sents').replaceChildren(h('div', { class: 'tk-sk' }), h('div', { class: 'tk-sk' }));
      $('#p-addw').hidden = true; $('#p-adds').hidden = true;
    } else {
      $('#p-nw').textContent = L.words.length; $('#p-ns').textContent = L.sentences.length;
      $('#p-words').replaceChildren(...L.words.map((it, i) => itemEl('words', it, i)));
      $('#p-sents').replaceChildren(...L.sentences.map((it, i) => itemEl('sentences', it, i)));
      $('#p-addw').hidden = !P.id || L.words.length >= MAX.words; $('#p-adds').hidden = !P.id || L.sentences.length >= MAX.sentences;
    }
    renderGo();
  }
  const addItem = (kind) => { if (!P.meta) return; doneEdit(); const arr = P.meta.list[kind]; arr.push({ en: '', zh: '' }); P.edit = { kind, i: arr.length - 1 }; renderPick(); };
  $('#p-addw').addEventListener('click', () => addItem('words'));
  $('#p-adds').addEventListener('click', () => addItem('sentences'));
  $('#p-again').addEventListener('click', () => {
    // 这张不要了:还没开始的那份删掉,不留在 talk/ 里
    if (P.id && P.meta && P.meta.status === 'draft') api('DELETE', '/api/talk/' + P.id).catch(() => {});
    P = { id: null, meta: null, waiting: false, failed: false, edit: null };
    go('#/');
  });
  $('#p-go').addEventListener('click', (e) => {
    doneEdit();
    const words = P.meta.list.words.filter((x) => x.en.trim()), sentences = P.meta.list.sentences.filter((x) => x.en.trim());
    if (!words.length && !sentences.length) return;
    const id = P.id;
    (toLive() ? handoff : startWith)(async () => { P.meta = await api('PUT', '/api/talk/' + id + '/list', { words, sentences, ready: true }); return id; }, e.currentTarget);
  });

  // ---- 声音:采集(16k PCM16 上去)与播放(24k PCM16 下来),src/live/audio-client.ts ----
  __AUDIO_CLIENT_JS__

  // ---- 英语老师开了实时(《wip/口语课改实时老师设计.md》拍板 1、2):口语单拍好就去他的实时页上课,先热身、再打电话;没开照旧在这一页跟读 + 打电话 ----
  const toLive = () => Boolean(OWNER && OWNER.live);
  /** 存好口语单(或接着上),换到老师页;那边点「先热身,再打电话」那一下才起声音 */
  async function handoff(getId, btn) {
    if (btn) btn.disabled = true;
    let id;
    try { id = await getId(); } catch (e) { if (btn) btn.disabled = false; toast('没连上,再点一次'); return; }
    location.href = '/?tutor=' + encodeURIComponent(OWNER.name) + '&talk=' + encodeURIComponent(id);
  }

  // ---- 孩子:跟读与聊 ----
  let K = null, call = null;
  const kidEl = $('#kid');
  const setHint = (s) => { $('#k-hint').textContent = s || ''; };
  function renderState(st) {
    const read = st.phase === 'read';
    kidEl.classList.toggle('chat', st.phase === 'chat');
    $('#k-start').hidden = true; $('#k-read').hidden = !read; $('#k-chat').hidden = st.phase !== 'chat';
    $('#k-bar').hidden = !read; $('#k-bar2').hidden = st.phase !== 'chat';
    $('#k-chip').textContent = read ? '跟我读 · 第 ' + (st.i + 1) + ' 句' : st.phase === 'chat' ? '打电话' : '结束了';
    $('#k-chip').className = 'chip ' + (read ? 'plum' : 'blue');
    $('#k-dots').replaceChildren(...Array.from({ length: st.n }, (_, i) => h('i', { class: i < st.i ? 'done' : i === st.i ? 'now' : '' })));
    if (read && st.item) renderCard(st);
    if (read) renderRd(st);
    if (st.phase === 'chat') { if (!wordsBuilt) { buildWords(); wordsBuilt = true; } $('#k-av').classList.toggle('talk', Boolean(st.speaking)); }
    $('#k-next').disabled = false;
  }
  // ---- 跟我读的大卡:词是单词卡(emoji + 舞台那么大的四线三格),句子是点读卡的一行;换了一句、老师再读时写一遍 ----
  let cardI = -1, cardGrid = null, lastMode = '';
  function renderCard(st) {
    const el = $('#k-card'), it = st.item;
    const isWord = Boolean(K) && st.i < K.meta.list.words.length;
    if (st.i !== cardI) {
      cardI = st.i; cardGrid = null; el.dataset.en = it.en;
      if (isWord) {
        cardGrid = wordGrid(it.en, null, { stage: true, fresh: true });
        el.className = 'rc now c-word';
        el.replaceChildren(...(it.emoji ? [h('span', { class: 'we' }, it.emoji)] : []), cardGrid);
        wordWrite(cardGrid, false);
      } else {
        el.className = 'rc now';
        el.replaceChildren(h('div', { class: 'c c-read' }, h('div', { class: 'rd' }, it.en, it.zh ? h('span', { class: 'zh' }, it.zh) : null)));
      }
    } else if (cardGrid && st.rd && st.rd.mode === 'tutor' && lastMode && lastMode !== 'tutor') wordWrite(cardGrid, false);
    lastMode = st.rd ? st.rd.mode : '';
  }
  // ---- 打电话:今天的词一排单词卡(cards/word);老师讲到哪个服务端发 {t:'card', i},那张亮、写一遍;「听」念一遍 ----
  let wordsBuilt = false;
  const ICON_SPK_S = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>';
  function buildWords() {
    const ws = K ? K.meta.list.words : [];
    $('#k-words').replaceChildren(...ws.map((w, i) => {
      const g = wordGrid(w.en, null, {});
      const pl = h('button', { type: 'button', class: 'rc-pl', html: ICON_SPK_S, on: { click: (e) => { e.stopPropagation(); if (call) call.say(w.en, pl); } } }, '听');
      const c = h('div', { class: 'c c-word', 'data-i': i }, w.emoji ? h('span', { class: 'we' }, w.emoji) : null, g, h('div', { class: 'wd-row' }, pl));
      c._grid = g;
      return c;
    }));
  }
  function lightCard(i) {
    const box = $('#k-words');
    for (const c of box.children) c.classList.toggle('now', Number(c.dataset.i) === i);
    const c = box.querySelector('[data-i="' + i + '"]');
    if (!c) return;
    c.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    wordWrite(c._grid, false);
  }
  // ---- 跟我读:现在轮到谁(服务端的 rd 说了算,lib/read-flow.ts) ----
  const ICON_SPK = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
  const ICON_BULB = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/></svg>';
  const ICON_FLIP = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/></svg>';
  const ICON_MIC = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  /** 只读一遍(拍板 15):老师读完轮到孩子;5 秒没出声转成 wait,老师不再读,「再听一遍」亮一下;没有倒计时的圈 */
  function renderRd(st) {
    const rd = st.rd, el = $('#k-rd');
    $('#k-again').classList.toggle('nudge', Boolean(rd) && rd.mode === 'wait');
    if (!rd) { el.hidden = true; return; }
    el.hidden = false;
    const mode = rd.mode;
    el.className = 'tk-rd ' + mode;
    if (mode === 'tutor') el.replaceChildren(h('span', { html: ICON_SPK }), '先听老师读');
    else if (mode === 'heard') el.replaceChildren('听到了…');
    else {
      if (mode === 'speech') $('#k-heard').textContent = '';
      const lv = h('span', { class: 'lv2' }, h('i'), h('i'), h('i'), h('i'), h('i'));
      el.replaceChildren(h('span', { class: 'mic', html: ICON_MIC }), mode === 'speech' ? '在听你读…' : mode === 'wait' ? '想读就读,想再听就点「再听一遍」' : '轮到你,跟着读一遍', lv);
    }
  }
  /** reel = 录像模式:不开麦、不连,声音是替身(老师在不在出声照录像的时段),消息由录像喂进 C.handle */
  function makeCall(id, reel, A0, opened) {
    const A = reel ? { play() {}, flush() {}, close() {}, open: async () => {}, playing: () => Boolean(RL) && tkIn(RL.r.playing, RL.t), muted: true, onChunk: null, onLevel: null } : (A0 || makeAudio());
    const C = { id, ws: null, st: null, deadline: null, saying: false, tutorLine: '', tutorDone: true, interrupt: false, timer: null, ended: false, startedAt: 0, hint: null, hs: null, hintAt: 0, lastPlayAt: 0, lastKidAt: 0 };
    const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/talk/' + id + '/ws';
    C.send = (o) => { if (C.ws && C.ws.readyState === 1) C.ws.send(JSON.stringify(o)); };
    C.start = async () => {
      setHint('打开麦克风…');
      try { await (opened || A.open()); } catch (e) { setHint('麦克风打不开:' + (e && e.message ? e.message : e)); return; }
      A.onChunk = (ab) => {
        if (!C.st || C.saying) return;
        // 跟读段不用按:老师放声时不推(没有回声),其余时间都推,开口 / 停由服务端判
        if (C.st.phase === 'read') { if (!A.playing()) C.ws.send(ab); return; }
        if (C.st.phase === 'chat') { if (C.interrupt || !A.playing()) C.ws.send(ab); }
      };
      A.onLevel = (v) => { const rb = document.querySelectorAll('#k-rd .lv2 i'); for (let i = 0; i < rb.length; i++) { const w = 1 - Math.abs(i - 2) / 3; rb[i].style.height = Math.round(6 + 22 * Math.min(1, v * 6) * w) + 'px'; } const bars = $('#k-lv').children; const k = Math.min(1, v * 6); for (let i = 0; i < bars.length; i++) { const w = 1 - Math.abs(i - 2) / 3; bars[i].style.height = Math.round(6 + 22 * k * w) + 'px'; } if (C.st && C.st.phase === 'chat') { const you = !A.playing() && !C.saying; if (you && k > 0.12) C.lastKidAt = Date.now(); $('#k-av').classList.toggle('listen', k > 0.12 && you); $('#k-call').classList.toggle('you', you); $('#k-callst').textContent = you ? '轮到你说' : C.saying ? '在念这个词…' : (C.interrupt ? '老师在说,想插嘴就直接说' : '老师在说,等她说完你再说'); } };
      setHint('接通中…');
      const ws = new WebSocket(wsUrl); ws.binaryType = 'arraybuffer'; C.ws = ws;
      ws.onopen = () => { A.muted = false; C.startedAt = Date.now(); setHint(''); C.timer = setInterval(C.tick, 500); C.view(); };
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') { A.play(e.data); return; }
        let m; try { m = JSON.parse(e.data); } catch (x) { return; }
        C.handle(m);
      };
      ws.onclose = () => { if (!C.ended) C.finish('closed'); };
      ws.onerror = () => setHint('接不上');
    };
    /** 服务端的一条消息 → 屏幕(录像模式也走这里:把录下的消息原样喂进来) */
    C.handle = (m) => {
      if (m.t === 'state') { const was = C.st && C.st.phase; C.st = m; if (m.phase === 'chat' && m.deadline !== null) C.deadline = m.deadline; C.interrupt = Boolean(m.interrupt); if (m.phase === 'chat' && was !== 'chat') { A.flush(); C.tutorLine = ''; C.tutorDone = true; $('#k-tt').textContent = ''; $('#k-heard2').textContent = ''; } if (m.phase !== 'ended') renderState(m); }
      else if (m.t === 'tutor') {
        // 一次回答一行:上一句 done 了,下一句的第一截来时从头记
        // 老师说下一句了:上一句的提示卡收起(孩子照着卡读的时候不收,老师接话才收)
        if (m.done !== undefined) { C.tutorLine = m.done; C.tutorDone = true; } else { if (C.tutorDone) { C.tutorLine = ''; C.tutorDone = false; C.hintClear(); } C.tutorLine += m.delta; }
        const en = C.tutorLine.replace(/[\\u4e00-\\u9fff].*$/, '').trim() || C.tutorLine;
        const zh = C.tutorLine.slice(en.length).trim();
        if (C.st && C.st.phase === 'chat') $('#k-tt').replaceChildren(en, ...(zh && zh !== C.tutorLine ? [h('span', { class: 'zh' }, zh)] : []));
        else $('#k-say').replaceChildren(h('span', { class: 'en' }, C.tutorLine));
      }
      else if (m.t === 'kid') { const chat = C.st && C.st.phase === 'chat'; (chat ? $('#k-heard2') : $('#k-heard')).replaceChildren(h('span', { class: 'muted' }, chat ? '你说的:' : '你读的'), h('span', {}, m.text)); }
      else if (m.t === 'card') lightCard(m.i);
      else if (m.t === 'hint') { C.hint = m; C.hs = { shown: false, flipped: false, fill: null, auto: false }; C.hintAt = nowMs(); $('#k-bulb').hidden = false; C.hintRender(); }
      else if (m.t === 'flush') A.flush();
      else if (m.t === 'err') setHint(m.msg);
      else if (m.t === 'end') { if (!reel) C.finish(m.why); }
    };
    C.tick = () => {
      if (!C.st) return;
      // 提示卡(拍板 16):老师说完、孩子 4 秒没出声,自己浮出来一次(录像里照记下的放)
      if (!reel && C.st.phase === 'chat') {
        const now = Date.now();
        if (A.playing() || C.saying) C.lastPlayAt = now;
        if (C.hint && C.hs && !C.hs.shown && !C.hs.auto && now - Math.max(C.lastPlayAt, C.lastKidAt, C.hintAt) >= 4000) { C.hs.auto = true; C.hintAct({ e: 'show', why: 'auto' }); }
      }
      // 打电话不显示剩下几分钟(拍板 18):右上角只写「打电话」,计时在服务端
      if (C.st.phase === 'read') setHint(C.st.rd && C.st.rd.mode === 'listen' ? '读完停一下就好' : '');
      else if (C.st.phase === 'chat') setHint(A.playing() ? '' : '说完停一下老师就接');
    };
    /** 屏幕多大(录像按它开 iframe);转屏、键盘起落后停手 300 毫秒再报,变了才报 */
    let viewKey = '', viewTimer = 0;
    C.view = () => { const k = innerWidth + 'x' + innerHeight; if (k === viewKey) return; viewKey = k; C.send({ t: 'view', w: innerWidth, h: innerHeight }); };
    C.onResize = () => { clearTimeout(viewTimer); viewTimer = setTimeout(C.view, 300); };
    window.addEventListener('resize', C.onResize);
    /** 单词卡上的「听」:浏览器的英文声按正常速度念;老师在说就等她说完;念的时候麦不推(不当孩子说的) */
    C.say = (w, btn) => {
      const ss = window.speechSynthesis;
      if (!ss) return;
      let tries = 0;
      const go = () => {
        if (C.ended) return;
        if (A.playing() && tries++ < 75) { setTimeout(go, 200); return; }
        const u = new SpeechSynthesisUtterance(w); u.lang = 'en-US'; u.rate = 0.9;
        // 念完多等 300 毫秒再推麦(外放的尾音、Safari 的念完来得早);念完一直不来,按字数给个上限(拍板 17)
        // 连着点:前一个被 cancel 掉也会报念完,只认最后一次
        let done = false; const tok = C.sayTok = (C.sayTok || 0) + 1;
        const off = () => { if (done) return; done = true; clearTimeout(guard); btn.classList.remove('on'); setTimeout(() => { if (tok === C.sayTok) C.saying = false; }, 300); };
        const guard = setTimeout(off, 2500 + w.length * 120);
        u.onend = off; u.onerror = off;
        C.saying = true; btn.classList.add('on'); C.send({ t: 'say', w });
        ss.cancel(); ss.speak(u);
      };
      go();
    };
    /** 提示卡:正面中文,点一下翻过来是英文句型带空,点词填进去;出来、翻面、填词都记进录像(孩子端发 {t:'hint'}) */
    C.hintRender = () => {
      const el = $('#k-hc'), m = C.hint, st = C.hs;
      const on = Boolean(m && st && st.shown);
      el.hidden = !on; kidEl.classList.toggle('hinting', on);
      if (!on) return;
      if (!st.flipped) {
        el.replaceChildren(h('button', { class: 'fr', type: 'button', on: { click: () => C.hintAct({ e: 'flip', v: true }) } }, h('span', { class: 'ic', html: ICON_BULB }), h('span', { style: 'flex:1' }, h('b', {}, m.zh), h('small', {}, '点一下,看英文怎么说')), h('span', { class: 'flip', html: ICON_FLIP })));
        return;
      }
      const parts = m.en.split('___');
      const pat = h('div', { class: 'pat' }, ...(parts.length === 2 ? [parts[0].trim() ? h('span', {}, parts[0].trim()) : null, h('span', { class: 'bl' }, st.fill || ' '), parts[1].trim() ? h('span', { style: /^[.?!,]/.test(parts[1].trim()) ? 'margin-left:-8px' : null }, parts[1].trim()) : null] : [h('span', {}, m.en)]));
      const words = K ? K.meta.list.words : [];
      const ops = parts.length === 2 && m.opts.length ? h('div', { class: 'ops' }, ...m.opts.map((w) => { const it = words.find((x) => x.en === w); return h('button', { class: 'op' + (st.fill === w ? ' on' : ''), type: 'button', on: { click: () => C.hintAct({ e: 'fill', w }) } }, it && it.emoji ? h('span', {}, it.emoji) : null, w); })) : null;
      el.replaceChildren(h('div', { class: 'bh' }, h('span', {}, '你可以这样说'), h('button', { class: 'flip', type: 'button', 'aria-label': '翻回中文', html: ICON_FLIP, on: { click: () => C.hintAct({ e: 'flip', v: false }) } })), pat, ops);
    };
    /** 一下动作 → 屏上(录像模式只走这个) */
    C.hintUi = (e) => {
      if (!C.hint || !C.hs || (e.n && e.n !== C.hint.n)) return;
      if (e.e === 'show') C.hs.shown = true; else if (e.e === 'hide') C.hs.shown = false; else if (e.e === 'flip') C.hs.flipped = Boolean(e.v); else if (e.e === 'fill') C.hs.fill = e.w;
      C.hintRender();
    };
    C.hintAct = (e) => { if (!C.hint) return; const x = Object.assign({ t: 'hint', n: C.hint.n }, e, e.e === 'show' || e.e === 'flip' ? { zh: C.hint.zh, en: C.hint.en } : {}); C.hintUi(x); C.send(x); };
    C.hintClear = () => { C.hint = null; C.hs = null; $('#k-bulb').hidden = true; C.hintRender(); };
    C.hangup = (why) => { C.send({ t: 'bye' }); C.finish(why || 'bye'); };
    C.finish = (why) => {
      if (C.ended) return; C.ended = true;
      clearInterval(C.timer); A.close(); window.removeEventListener('resize', C.onResize);
      try { if (C.ws && C.ws.readyState <= 1) C.ws.close(1000, why); } catch (e) {}
      call = null;
      // 打完回首页(回放在家长端的记录里)
      if (!reel) location.href = '/';
    };
    return C;
  }
  /** 孩子那一屏回到开头的样子(开一次、录像往回拖都用) */
  function kidReset() {
    kidEl.className = 'view on';
    $('#k-start').hidden = false; $('#k-read').hidden = true; $('#k-chat').hidden = true; $('#k-bar').hidden = true; $('#k-bar2').hidden = true; setHint('');
    cardI = -1; cardGrid = null; lastMode = ''; wordsBuilt = false; $('#k-words').replaceChildren(); $('#k-card').replaceChildren();
    $('#k-chip').textContent = '跟我读'; $('#k-chip').className = 'chip plum'; $('#k-dots').replaceChildren(); $('#k-heard').textContent = ''; $('#k-heard2').textContent = '';
    $('#k-tt').textContent = ''; $('#k-say').textContent = ''; $('#k-hc').hidden = true; $('#k-bulb').hidden = true; $('#k-av').className = 'tk-av'; $('#k-call').className = 'tk-call';
  }
  async function kid(id) {
    kidReset();
    try { K = await api('GET', '/api/talk/' + id); } catch (e) { go('#/'); return; }
    const n = K.meta.list.words.length + K.meta.list.sentences.length;
    $('#k-start-hint').textContent = n ? '先跟我读 ' + n + ' 句,再打个电话聊一聊' : '直接打个电话聊一聊';
  }
  /**
   * 开始一次(拍板 12):这一下点击里先把声音与麦打开(AudioContext、getUserMedia 要在点击里起),再拿 id(存口语单 / 接着上),
   * 换到跟读那一屏(replaceState,不走 hashchange)接上
   */
  async function startWith(getId, btn) {
    if (call) return;
    try { window.speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch (e) {}
    const A = makeAudio(); const opened = A.open(); opened.catch(() => {});
    if (btn) btn.disabled = true;
    let id;
    try { id = await getId(); } catch (e) { if (btn) btn.disabled = false; A.close(); toast('没连上,再点一次'); return; }
    history.replaceState(null, '', location.pathname + location.search + '#/kid/' + id);
    show('kid'); await kid(id); $('#k-start').hidden = true;
    call = makeCall(id, false, A, opened);
    await call.start();
    if (btn) btn.disabled = false;
  }
  $('#k-go').addEventListener('click', (e) => { if (K) startWith(async () => K.meta.id, e.currentTarget); });
  $('#k-again').addEventListener('click', () => { if (call) call.send({ t: 'again' }); });
  $('#k-next').addEventListener('click', () => { if (call) { $('#k-next').disabled = true; $('#k-heard').textContent = ''; call.send({ t: 'next' }); } });
  $('#k-skip').addEventListener('click', () => { if (call) call.send({ t: 'chat' }); });
  $('#k-hang').addEventListener('click', () => { if (call) call.hangup('bye'); });
  $('#k-bulb').addEventListener('click', () => { if (call && call.hint) call.hintAct({ e: 'show', why: 'tap' }); });

  // ---- 录像模式:轨道是 lib/reel.ts(tkBuild / tkClock / tkCaption,内联在下面);把手照《家长录像设计.md》的录像栏(reel-dock.ts) ----
__TALK_REEL_JS__
  const reelAudio = () => { try { if (window.parent !== window && window.parent.__cotutorAudio) return window.parent.__cotutorAudio; } catch (e) {} return null; };
  /** 把 ≤ t 的消息喂进孩子那一屏;往回拖就从头再喂 */
  const reelApply = (t) => {
    if (t < RL.at) { kidReset(); RL.C = makeCall(REEL_ID, true); RL.C.startedAt = 0; RL.k = 0; }
    const msgs = RL.r.msgs;
    while (RL.k < msgs.length && msgs[RL.k][0] <= t) { const x = msgs[RL.k++]; RL.t = x[0]; if (x[1] === 'o') RL.C.handle(x[2]); else if (x[2] && x[2].t === 'hint') RL.C.hintUi(x[2]); }
    RL.t = t; RL.at = t;
    const C = RL.C;
    if (C.st) C.tick();
    // 底部条与头像照录像的时段:老师在出声 / 孩子在出声
    const tutor = tkIn(RL.r.playing, t), kidOn = tkIn(RL.r.kidVoice, t);
    $('#k-av').classList.toggle('talk', tutor); $('#k-av').classList.toggle('listen', kidOn && !tutor);
    $('#k-call').classList.toggle('you', !tutor);
    $('#k-callst').textContent = tutor ? '老师在说,等她说完你再说' : '轮到你说';
  };
  const reelSound = () => {
    const a = reelAudio();
    if (!a) return;
    if (!RL.playing) { try { a.pause(); } catch (e) {} return; }
    if (!a.src || a.src.indexOf('/api/talk/' + REEL_ID + '/audio/call') < 0) a.src = '/api/talk/' + encodeURIComponent(REEL_ID) + '/audio/call';
    a.defaultPlaybackRate = RL.speed; a.playbackRate = RL.speed;
    // 跳过空白时录像的钟跳一下,声音跟上
    if (Math.abs(a.currentTime * 1000 - RL.t) > 350) { try { a.currentTime = RL.t / 1000; } catch (e) {} }
    if (a.paused) { const pr = a.play(); if (pr && pr.catch) pr.catch(() => {}); }
  };
  const reelTick = () => {
    if (!RL) return;
    const now = performance.now();
    if (RL.playing && !RL.seeking) RL.p = Math.min(RL.clock.total, RL.p + (now - RL.last) * RL.speed);
    RL.last = now;
    reelApply(RL.clock.toWall(RL.p));
    reelSound();
    if (RL.playing && RL.p >= RL.clock.total) reelPlay(false);
  };
  const reelPlay = (on) => {
    if (on && RL.p >= RL.clock.total) RL.p = 0;
    RL.playing = on; RL.last = performance.now();
    clearInterval(RL.timer); RL.timer = on ? setInterval(reelTick, 100) : 0;
    reelTick();
  };
  const reelTo = (p, seeking) => { RL.seeking = seeking; RL.p = Math.max(0, Math.min(RL.clock.total, p)); RL.last = performance.now(); const a = reelAudio(); if (a) { try { a.currentTime = RL.clock.toWall(RL.p) / 1000; } catch (e) {} } reelTick(); };
  const reelApi = {
    speeds: [1, 1.5, 2],
    get: () => (RL ? { p: RL.p, total: RL.clock.total, wall: RL.r.startAt + RL.t, playing: RL.playing, speed: RL.speed, real: RL.real, precise: true, cap: tkCaption(RL.r, RL.t), size: RL.r.size } : null),
    marks: () => (RL ? RL.r.marks.map((m) => ({ kind: m.kind, label: m.label, p: RL.clock.toPlay(m.t) })) : []),
    events: () => (RL ? RL.r.notes.map((n) => ({ p: RL.clock.toPlay(n.t), kind: n.kind, chip: n.chip, text: n.text })) : []),
    chapters: () => (RL ? RL.r.chapters.map((c) => ({ p: RL.clock.toPlay(c.t), title: c.title })) : []),
    play: (on) => { if (RL) reelPlay(on); },
    seek: (p) => { if (RL) reelTo(p, false); },
    drag: (p) => { if (RL) reelTo(p, true); },
    real: (on) => { if (!RL) return; RL.real = on; RL.clock = tkClock(RL.r, on); RL.p = RL.clock.toPlay(RL.t); reelTick(); },
    speed: (x) => { if (!RL) return; RL.speed = x; const a = reelAudio(); if (a) { a.defaultPlaybackRate = x; a.playbackRate = x; } },
    stop: () => { if (!RL) return; clearInterval(RL.timer); const a = reelAudio(); if (a) { try { a.pause(); } catch (e) {} } RL = null; },
    /** 跳到离通话开始 t 毫秒那一刻(探针) */
    seekAt: (t) => { if (RL) reelTo(RL.clock.toPlay(t), false); },
  };
  const reelBoot = () => {
    let host = null; try { if (window.parent !== window && typeof window.parent.cotutorReelReady === 'function') host = window.parent; } catch (e) {}
    // 只在家长端的录像外壳里开;直接打开什么都不放(孩子端页面里不写家长端的路径)
    if (!host) { document.body.textContent = '录像要从家长端打开'; return; }
    show('kid');
    // 点不动,只能上下翻:点、按在捕获阶段挡掉
    for (const k of ['click', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu']) document.addEventListener(k, (e) => { e.stopPropagation(); if (k !== 'pointerdown' && k !== 'pointerup') e.preventDefault(); }, true);
    api('GET', '/api/talk/' + encodeURIComponent(REEL_ID) + '/reel').then((d) => {
      K = { meta: d.meta };
      const r = tkBuild(d.reel, d.meta.list.words);
      kidReset();
      RL = { r, p: 0, t: 0, at: 0, k: 0, playing: false, seeking: false, speed: 1, real: false, last: 0, timer: 0, C: makeCall(REEL_ID, true) };
      RL.C.startedAt = 0;
      RL.clock = tkClock(r, false);
      // 停在最后一帧(同话题与听写的录像:最后一帧信息最多,要看过程往前拖)
      RL.p = RL.clock.total;
      reelTick();
      window.cotutorReel = reelApi;
      host.cotutorReelReady(reelApi, { size: r.size });
      // 焦点在孩子的屏幕里时按键也认(《家长录像设计.md》拍板 22):交给外面的录像栏,它认了就不让这一页再处理
      document.addEventListener('keydown', function (e) { try { if (host.cotutorReelKey && host.cotutorReelKey({ key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey })) e.preventDefault(); } catch (x) {} });
    }, () => host.cotutorReelFail());
  };

  void wearOwner();
  if (REEL_ID) reelBoot(); else route();
})();
</script>
</body></html>`;

export function talkPage(): string {
  return TALK_PAGE.replace('__AUDIO_CLIENT_JS__', () => AUDIO_CLIENT_JS).replace('__TUTOR_FACE_JS__', () => TUTOR_FACE_JS).replace('__TUTOR_FACE_CSS__', () => TUTOR_FACE_CSS).replace('__WORD_DRAW_JS__', () => wordDrawJs()).replace('__TALK_REEL_JS__', () => TALK_REEL_JS);
}
