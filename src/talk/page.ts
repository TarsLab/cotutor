/**
 * /talk(孩子端)与 /parent/talk(家长端):口语课的页面(《wip/口语课设想.md》;原型 https://claude.ai/artifact/9cC72r5d8Jyhayikz3rYaP)。
 * 家长与孩子同一份页面,按 hash 切;/talk 只认孩子那一屏,别的 hash 回孩子端首页:#/ 拍照与讲过的(家长)、#/list/<id> 改口语单(家长)、#/kid/<id> 跟读与聊(孩子,家长递过去)、#/review/<id> 回看(家长)。
 * 孩子那一屏的样子和老师页一样(《wip/口语课设想.md》§8.2):装孩子端的 /kid/theme.css,今天的词用单词卡(cards/word,画法 word-draw.ts)、句子用点读卡的行(cards/read);
 * 自己的类名别撞主题的(.rd 是点读卡的行,自己的状态胶囊叫 .tk-rd)。
 * 声音:getUserMedia → AudioWorklet 降到 16k PCM16,100 毫秒一块走 WebSocket 二进制帧上去;下来的 24k PCM16 一块块排进 AudioContext 放。
 * 内联脚本里不写反斜杠、不写反引号、不写美元加花括号(这是模板字符串,见 CLAUDE.md「坑」)。
 */
import { inlineScript } from '../server/inline-lib.ts';
import { wordDrawJs } from '../server/word-draw.ts';

/** 录像的轨道(lib/reel.ts),内联进录像模式 */
const TALK_REEL_JS = inlineScript(new URL('./lib/reel.ts', import.meta.url));

const TALK_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>口语课</title>
<link rel="stylesheet" href="/kid/theme.css">
<style>
  :root { --paper:#faf9f4; --ink:#2b2b2b; --dim:#8a8781; --line:#e2dfd6; --card:#ffffff; --kid:#dbeeff; --tutor:#fff3d6; --tutor-line:#f0dca8; --tutor-ink:#8a5a12; --accent:#e8743b; --blue:#eef4ff; --blue-ink:#2f5e9e; --plum:#efe9fb; --plum-ink:#7a4fc9; --grey:#eeece6; --night:#2b3a4a; --red:#b3412a; }
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

  /* 家长:拍照与讲过的 */
  #home .shoot { margin-top:16px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; min-height:260px; border-radius:20px; background:var(--ink); color:rgba(255,255,255,.85); text-align:center; padding:28px; position:relative; }
  #home .shoot .frame { position:absolute; left:20px; right:20px; top:20px; bottom:20px; border:2px dashed rgba(255,255,255,.5); border-radius:14px; pointer-events:none; }
  #home .shoot label { display:inline-flex; align-items:center; gap:10px; height:52px; padding:0 22px; border-radius:26px; background:#fff; color:var(--ink); font-weight:700; cursor:pointer; }
  #home .shoot input { display:none; }
  #home .past { margin-top:22px; display:flex; flex-direction:column; gap:10px; }
  #home .past .row { display:flex; align-items:center; gap:12px; padding:14px 16px; cursor:pointer; }
  #home .past .row .t { flex:1; min-width:0; }
  #home .past .row b { display:block; }
  #home .off { margin-top:16px; padding:16px 18px; }
  #home .off code { background:var(--grey); padding:2px 6px; border-radius:6px; font-size:15px; }

  /* 家长:口语单 */
  #list .sec { margin-top:14px; font-size:13px; font-weight:700; color:var(--dim); padding-left:4px; }
  #list .row { display:flex; align-items:center; gap:10px; min-height:54px; padding:6px 6px 6px 14px; margin-top:8px; }
  #list .row.sent { flex-wrap:wrap; }
  #list .row input { flex:1; min-width:0; border:0; outline:0; background:none; padding:4px 0; }
  #list .row input.en { font-size:19px; font-weight:600; }
  #list .row input.zh { color:var(--dim); font-size:15px; flex:1; }
  #list .row.sent input.en { flex-basis:100%; }
  #list .row .x { width:40px; height:40px; display:grid; place-items:center; color:var(--dim); }
  #list .add { margin-top:10px; display:inline-flex; align-items:center; gap:8px; height:44px; padding:0 12px; color:var(--blue-ink); font-weight:600; }
  #list .foot { margin-top:auto; padding-top:16px; display:flex; flex-direction:column; gap:10px; }
  #list .foot .meta { display:flex; justify-content:space-between; color:var(--dim); font-size:14px; }
  #list .go { height:56px; border-radius:28px; background:var(--ink); color:#fff; font-size:18px; font-weight:700; display:flex; align-items:center; justify-content:center; gap:10px; }
  #list .warn { margin-top:10px; padding:12px 14px; background:var(--tutor); border:1px solid var(--tutor-line); border-radius:12px; color:var(--tutor-ink); font-size:15px; }

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
  /* 跟我读不用按(《wip/口语课设想.md》§8.1):现在轮到谁,一颗胶囊 */
  #kid .tk-rd { display:inline-flex; align-items:center; gap:12px; min-height:64px; padding:0 26px 0 22px; border-radius:32px; font-size:20px; font-weight:600; }
  #kid .tk-rd.tutor { background:#e5f4ea; color:#1f6b3f; }
  #kid .tk-rd.listen, #kid .tk-rd.speech, #kid .tk-rd.wait { background:#fff; color:var(--blue-ink); padding-left:8px; box-shadow:0 0 0 3px #9cc3ef, 0 2px 8px rgba(0,0,0,.08); }
  #kid .tk-rd.heard { background:var(--grey); color:var(--dim); }
  #kid .tk-rd .ring { position:relative; width:48px; height:48px; display:grid; place-items:center; flex:none; }
  #kid .tk-rd .ring svg.r { position:absolute; inset:0; transform:rotate(-90deg); }
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
  #kid .tk-av.talk i.o1 { background:rgba(31,138,76,.08); } #kid .tk-av.talk i.o2 { background:rgba(31,138,76,.15); }
  #kid .tk-av.listen i.o1 { background:rgba(47,94,158,.08); } #kid .tk-av.listen i.o2 { background:rgba(47,94,158,.15); }
  #kid .tk-av .face { position:relative; width:116px; height:116px; border-radius:50%; background:#fff; display:grid; place-items:center; box-shadow:0 2px 10px rgba(0,0,0,.08); }
  #kid .tk-tt { width:100%; max-width:976px; padding:18px 28px; border-radius:22px; background:#fff; border:1px solid var(--line); font-size:30px; font-weight:700; line-height:1.3; min-height:84px; }
  #kid .tk-tt .zh { display:block; font-size:17px; font-weight:400; color:var(--dim); margin-top:4px; }
  #kid #k-heard2 { align-self:flex-end; max-width:80%; margin-right:max(0px, calc((100% - 976px) / 2)); }
  #kid .tk-words { width:100%; max-width:976px; display:flex; gap:10px; overflow-x:auto; padding:4px 2px 8px; margin-top:auto; scrollbar-width:none; }
  #kid .tk-words::-webkit-scrollbar { display:none; }
  #kid .tk-words .c.c-word { flex:none; flex-wrap:nowrap; gap:8px; padding:8px 10px 8px 14px; transition:border-color .2s, box-shadow .2s; }
  #kid .tk-words .c-word .we { font-size:30px; }
  #kid .tk-words .c-word .wd-row { margin-left:4px; }
  #kid .c-word.now { border-color:var(--sel); box-shadow:0 0 0 1px var(--sel), 0 4px 14px var(--sel-halo); }
  #kid .tk-call { width:100%; max-width:976px; height:60px; border-radius:30px; background:#fff; box-shadow:0 1px 6px rgba(0,0,0,.12); display:flex; align-items:center; gap:14px; padding:0 8px 0 22px; color:#1f8a4c; }
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

  /* 家长:回看 */
  #review .lines { display:flex; flex-direction:column; gap:10px; margin-top:14px; }
  #review .ln { max-width:80%; padding:10px 16px; border-radius:18px; font-size:17px; }
  #review .ln.tutor { align-self:flex-start; background:var(--tutor); border:1px solid var(--tutor-line); }
  #review .ln.kid { align-self:flex-end; background:var(--kid); }
  #review .ln small { display:block; color:var(--dim); font-size:12px; }
  #review .ph { margin:12px 0 0; display:flex; gap:6px; flex-wrap:wrap; }
  #review .used { margin-top:16px; display:flex; flex-wrap:wrap; gap:8px; }
  #review .used span { padding:4px 12px; border-radius:12px; background:var(--grey); color:var(--dim); font-size:15px; }
  #review .used span.y { background:#e5f4ea; color:#1f8a4c; }
  #review .play { display:flex; gap:10px; margin-top:16px; flex-wrap:wrap; }
  #review audio { width:100%; max-width:420px; }

  @media (max-width:600px) {
    #kid .rc { padding:26px 20px 22px; }
    #kid .rc .en { font-size:40px; }
    #kid .rc .en.long { font-size:26px; }
    #kid .big { height:64px; font-size:20px; padding:0 22px; }
    #kid .tk-tt { font-size:22px; padding:14px 18px; }
    #kid .tk-av { width:136px; height:136px; } #kid .tk-av .face { width:88px; height:88px; }
    #kid #k-card .we { font-size:52px; } #kid #k-card .rd { font-size:28px; }
  }
</style></head>
<body>
<div id="home" class="view"><div class="wrap">
  <div class="top"><b style="font-size:22px">口语课</b><span class="muted small" id="h-date"></span></div>
  <div class="muted">拍今天学的那页,老师读出单词和句子;孩子先跟读,再用这些词和老师聊</div>
  <div class="card off" id="h-off" hidden></div>
  <div class="shoot" id="h-shoot">
    <div class="frame"></div>
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
    <div>对准课本的单词表或今天学的句子<br><span class="small" style="color:rgba(255,255,255,.6)">印刷的字读得准,手写的先别拍</span></div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">
      <label><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/></svg>拍照<input type="file" accept="image/*" capture="environment" id="h-cam"></label>
      <label><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/></svg>相册<input type="file" accept="image/*" id="h-pick"></label>
      <button class="pill" id="h-blank" type="button">不拍,自己填</button>
    </div>
  </div>
  <div class="past" id="h-past"></div>
</div></div>

<div id="list" class="view"><div class="wrap">
  <div class="top"><a class="pill" href="#/" id="l-back">‹ 重拍</a><b style="font-size:18px">今天的口语单</b><span style="width:80px"></span></div>
  <div class="muted small" style="text-align:center">老师从照片里读出来的,不对就改;孩子只看到你改好的</div>
  <div class="warn" id="l-warn" hidden></div>
  <div class="sec">单词 · <span id="l-nw">0</span></div>
  <div id="l-words"></div>
  <button class="add" type="button" id="l-addw"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>补一个单词</button>
  <div class="sec">句子 · <span id="l-ns">0</span></div>
  <div id="l-sents"></div>
  <button class="add" type="button" id="l-adds"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>补一句</button>
  <div class="foot">
    <div class="meta"><span id="l-meta"></span><a href="#/" class="muted">看照片</a></div>
    <button class="go" type="button" id="l-go">给孩子<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
    <div class="muted small" style="text-align:center">他先跟读这几句,再和老师用它们聊</div>
  </div>
</div></div>

<div id="kid" class="view"><div class="wrap">
  <div class="top">
    <a class="back" href="#/" id="k-back" aria-label="回去"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><svg width="38" height="38" viewBox="0 0 48 48" aria-hidden="true"><path d="M40.4 12.5A20 20 0 1 0 40.4 35.5" fill="none" stroke="#1f8a4c" stroke-width="3.5" stroke-linecap="round"/><text x="24" y="30" text-anchor="middle" font-size="16" font-weight="700" fill="#1f8a4c">英</text></svg></a>
    <div style="display:flex;align-items:center;gap:12px"><div class="dots" id="k-dots"></div><span class="chip plum" id="k-chip">跟我读</span></div>
  </div>
  <div class="start" id="k-start">
    <div class="av">E</div>
    <b style="font-size:26px">英语老师</b>
    <div class="muted" id="k-start-hint">先跟老师读几句,再用这些词聊一聊</div>
    <button class="big" type="button" id="k-go" style="background:#1f8a4c"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4l14 8-14 8z"/></svg>开始</button>
    <div class="muted small">老师读一句,你读一句;读完自己往下走,不用按</div>
  </div>
  <div class="mid" id="k-read" hidden>
    <div class="say" id="k-say"><span class="en">Listen first, then you try.</span><span class="zh">先听,再你来。</span></div>
    <div class="rc now" id="k-card"></div>
    <div class="tk-rd tutor" id="k-rd"></div>
    <div class="heard" id="k-heard"></div>
  </div>
  <div class="mid" id="k-chat" hidden>
    <div class="tk-av" id="k-av"><i class="o1"></i><i class="o2"></i><span class="face"><svg width="84" height="84" viewBox="0 0 48 48" aria-hidden="true"><path d="M40.4 12.5A20 20 0 1 0 40.4 35.5" fill="none" stroke="#1f8a4c" stroke-width="3" stroke-linecap="round"/><text x="24" y="30" text-anchor="middle" font-size="15" font-weight="700" fill="#1f8a4c">英</text></svg></span></div>
    <div class="tk-tt" id="k-tt"></div>
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

<div id="review" class="view"><div class="wrap">
  <div class="top"><a class="pill" href="#/">‹ 口语课</a><b style="font-size:18px" id="r-title">回看</b><button class="pill red" type="button" id="r-del">删掉</button></div>
  <div class="muted small" id="r-meta"></div>
  <div class="play" id="r-play"></div>
  <div class="used" id="r-used"></div>
  <div class="lines" id="r-lines"></div>
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
  const fmtDate = (iso) => { const d = new Date(iso); return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const STATUS = { draft: '还在改', ready: '等孩子', done: '聊过了' };
  let info = null;

  // ---- 路由 ----
  const views = ['home', 'list', 'kid', 'review'];
  const show = (name) => { for (const v of views) $('#' + v).classList.toggle('on', v === name); };
  const go = (hash) => { location.hash = hash; };
  /** 孩子从首页英语老师卡上的「口语课」进来(《首页设计.md》拍板 18):「回去」与打完都回首页,不进家长的那几屏 */
  const KID_ONLY = __TALK_KID_ONLY__;
  /** 录像模式(?reel=<id>,《wip/口语课设想.md》§8.3):开在家长端录像外壳的 iframe 里,照录下的消息画孩子那一屏 */
  const REEL_ID = new URLSearchParams(location.search).get('reel');
  /** 回看页「看录像」去哪(只在家长端那份里有;孩子端是空的) */
  const REEL_HREF = '__TALK_REEL_HREF__';
  let RL = null;
  /** 现在几毫秒:平时是钟;录像里是录像放到的那一刻(离通话开始) */
  const nowMs = () => (RL ? RL.t : Date.now());
  const FROM_HOME = KID_ONLY || new URLSearchParams(location.search).get('home') === '1';
  if (FROM_HOME) $('#k-back').setAttribute('href', '/');
  const route = () => {
    const m = /^#\\/(list|kid|review)\\/([^/]+)/.exec(location.hash);
    if (KID_ONLY && (!m || m[1] !== 'kid')) { location.replace('/'); return; }
    if (!m) { show('home'); void home(); return; }
    if (m[1] === 'list') { show('list'); void list(m[2]); }
    else if (m[1] === 'kid') { show('kid'); void kid(m[2]); }
    else { show('review'); void review(m[2]); }
  };
  window.addEventListener('hashchange', () => { if (REEL_ID) return; if (call && !location.hash.startsWith('#/kid/')) call.hangup('left'); route(); });

  // ---- 家长:拍照与讲过的 ----
  async function home() {
    const d = new Date(); $('#h-date').textContent = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
    try { info = await api('GET', '/api/talk'); } catch (e) { toast('读不到:' + e.message); return; }
    const off = $('#h-off');
    if (!info.enabled) { off.hidden = false; off.innerHTML = '口语课还关着。在 cotutor.json 里加 <code>"talk": { "enabled": true }</code>(存了就生效)。'; }
    else if (!info.auth) { off.hidden = false; off.innerHTML = '没有百炼的 key 或业务空间 id:设环境变量 <code>DASHSCOPE_API_KEY</code> 与 <code>DASHSCOPE_WORKSPACE_ID</code>(或在 voxtell 的配置里),重起 serve。'; }
    else off.hidden = true;
    $('#h-shoot').style.display = info.enabled ? '' : 'none';
    const past = $('#h-past'); past.replaceChildren();
    for (const t of info.talks) {
      const n = t.list.words.length + t.list.sentences.length;
      past.append(h('div', { class: 'card row', on: { click: () => go(t.status === 'done' ? '#/review/' + t.id : '#/list/' + t.id) } },
        h('div', { class: 't' }, h('b', {}, fmtDate(t.createdAt)), h('span', { class: 'muted small' }, n + ' 条' + (t.listError ? ' · 照片没读出来' : '') + (t.call ? ' · 聊了 ' + Math.round(t.call.ms / 60000) + ' 分钟' : ''))),
        h('span', { class: 'chip' + (t.status === 'ready' ? ' blue' : '') }, STATUS[t.status] || t.status)));
    }
  }
  const shrink = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { const max = 1600; const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85)); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('这张图打不开')); };
    img.src = url;
  });
  async function shoot(file) {
    if (!file) return;
    toast('老师在读这一页…');
    try { const photo = await shrink(file); const t = await api('POST', '/api/talk', { photo }); go('#/list/' + t.id); }
    catch (e) { toast('没成:' + e.message); }
  }
  $('#h-cam').addEventListener('change', (e) => { shoot(e.target.files[0]); e.target.value = ''; });
  $('#h-pick').addEventListener('change', (e) => { shoot(e.target.files[0]); e.target.value = ''; });
  $('#h-blank').addEventListener('click', async () => { try { const t = await api('POST', '/api/talk', {}); go('#/list/' + t.id); } catch (e) { toast('没成:' + e.message); } });

  // ---- 家长:口语单 ----
  let L = null;
  const ICON_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  function rowOf(kind, it, idx) {
    const en = h('input', { class: 'en', value: it.en, placeholder: kind === 'words' ? '单词' : '英文句子', autocapitalize: 'off', autocorrect: 'off' });
    const zh = h('input', { class: 'zh', value: it.zh, placeholder: '中文' });
    en.addEventListener('input', () => { it.en = en.value; });
    zh.addEventListener('input', () => { it.zh = zh.value; });
    return h('div', { class: 'card row' + (kind === 'sentences' ? ' sent' : '') }, en, zh, h('button', { class: 'x', type: 'button', 'aria-label': '删掉', html: ICON_X, on: { click: () => { L.list[kind].splice(idx, 1); renderList(); } } }));
  }
  function renderList() {
    $('#l-nw').textContent = L.list.words.length; $('#l-ns').textContent = L.list.sentences.length;
    $('#l-words').replaceChildren(...L.list.words.map((it, i) => rowOf('words', it, i)));
    $('#l-sents').replaceChildren(...L.list.sentences.map((it, i) => rowOf('sentences', it, i)));
    const w = $('#l-warn');
    if (L.listError) { w.hidden = false; w.textContent = '照片没读出来(' + L.listError + '),自己填几条也行'; }
    else if (!L.photo) { w.hidden = false; w.textContent = '没拍照片,自己填'; }
    else w.hidden = true;
    $('#l-meta').textContent = '聊 ' + (info ? info.minutes : 5) + ' 分钟 · 音色 ' + (info ? info.voice : '') + (L.listBy === 'omni' ? ' · 老师读了 ' + Math.round((L.listMs || 0) / 100) / 10 + ' 秒' : '');
  }
  async function list(id) {
    if (!info) { try { info = await api('GET', '/api/talk'); } catch (e) {} }
    try { L = (await api('GET', '/api/talk/' + id)).meta; } catch (e) { toast('没有这一次'); go('#/'); return; }
    renderList();
  }
  const addRow = (kind) => { L.list[kind].push({ en: '', zh: '' }); renderList(); const rows = $('#l-' + (kind === 'words' ? 'words' : 'sents')).querySelectorAll('.row'); const last = rows[rows.length - 1]; if (last) last.querySelector('input').focus(); };
  $('#l-addw').addEventListener('click', () => addRow('words'));
  $('#l-adds').addEventListener('click', () => addRow('sentences'));
  $('#l-go').addEventListener('click', async () => {
    const words = L.list.words.filter((x) => x.en.trim()), sentences = L.list.sentences.filter((x) => x.en.trim());
    if (!words.length && !sentences.length) { toast('先填一条'); return; }
    try { L = await api('PUT', '/api/talk/' + L.id + '/list', { words, sentences, ready: true }); go('#/kid/' + L.id); } catch (e) { toast('没存上:' + e.message); }
  });

  // ---- 声音:采集(16k PCM16 上去)与播放(24k PCM16 下来) ----
  const WORKLET = 'class P extends AudioWorkletProcessor { constructor() { super(); this.buf = []; this.n = 0; this.acc = 0; } process(inputs) { const ch = inputs[0] && inputs[0][0]; if (!ch) return true; const ratio = sampleRate / 16000; const out = []; for (let i = 0; i < ch.length; i++) { this.acc += 1; if (this.acc >= ratio) { this.acc -= ratio; out.push(ch[i]); } } for (const v of out) { this.buf.push(v); } if (this.buf.length >= 1600) { const n = 1600; const pcm = new Int16Array(n); let s = 0; for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, this.buf[i])); pcm[i] = v < 0 ? v * 32768 : v * 32767; s += v * v; } this.buf = this.buf.slice(n); this.port.postMessage({ pcm: pcm.buffer, rms: Math.sqrt(s / n) }, [pcm.buffer]); } return true; } } registerProcessor("cotutor-pcm16", P);';
  function makeAudio() {
    const A = { ctx: null, stream: null, node: null, playAt: 0, sources: [], onChunk: null, onLevel: null, muted: true };
    A.open = async () => {
      A.ctx = new (window.AudioContext || window.webkitAudioContext)();
      await A.ctx.resume();
      A.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const src = A.ctx.createMediaStreamSource(A.stream);
      if (A.ctx.audioWorklet) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await A.ctx.audioWorklet.addModule(url);
        A.node = new AudioWorkletNode(A.ctx, 'cotutor-pcm16', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        A.node.port.onmessage = (e) => { if (A.onLevel) A.onLevel(e.data.rms); if (!A.muted && A.onChunk) A.onChunk(e.data.pcm); };
        src.connect(A.node);
        const sink = A.ctx.createGain(); sink.gain.value = 0; A.node.connect(sink); sink.connect(A.ctx.destination);
      } else {
        const sp = A.ctx.createScriptProcessor(4096, 1, 1);
        let buf = [], acc = 0;
        sp.onaudioprocess = (e) => {
          const ch = e.inputBuffer.getChannelData(0); const ratio = A.ctx.sampleRate / 16000;
          for (let i = 0; i < ch.length; i++) { acc += 1; if (acc >= ratio) { acc -= ratio; buf.push(ch[i]); } }
          while (buf.length >= 1600) { const pcm = new Int16Array(1600); let s = 0; for (let i = 0; i < 1600; i++) { const v = Math.max(-1, Math.min(1, buf[i])); pcm[i] = v < 0 ? v * 32768 : v * 32767; s += v * v; } buf = buf.slice(1600); if (A.onLevel) A.onLevel(Math.sqrt(s / 1600)); if (!A.muted && A.onChunk) A.onChunk(pcm.buffer); }
        };
        src.connect(sp); const sink = A.ctx.createGain(); sink.gain.value = 0; sp.connect(sink); sink.connect(A.ctx.destination);
        A.node = sp;
      }
    };
    A.play = (ab) => {
      if (!A.ctx) return;
      const i16 = new Int16Array(ab); const n = i16.length; if (!n) return;
      const buf = A.ctx.createBuffer(1, n, 24000); const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = i16[i] / 32768;
      const s = A.ctx.createBufferSource(); s.buffer = buf; s.connect(A.ctx.destination);
      const now = A.ctx.currentTime; if (A.playAt < now + 0.06) A.playAt = now + 0.06;
      s.start(A.playAt); A.playAt += buf.duration; A.sources.push(s);
      s.onended = () => { const k = A.sources.indexOf(s); if (k >= 0) A.sources.splice(k, 1); };
    };
    A.playing = () => Boolean(A.ctx) && A.playAt > A.ctx.currentTime + 0.02;
    A.flush = () => { for (const s of A.sources) { try { s.stop(); } catch (e) {} } A.sources = []; A.playAt = 0; };
    A.close = () => { A.flush(); if (A.stream) for (const t of A.stream.getTracks()) t.stop(); if (A.ctx) A.ctx.close().catch(() => {}); A.ctx = null; A.stream = null; };
    return A;
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
  const RING_C = 131.9;
  const ringHtml = '<svg class="r" width="48" height="48" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="none" stroke="#dbe6f5" stroke-width="4"/><circle id="k-ring" cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + RING_C + '" stroke-dashoffset="0"/></svg><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  let rdUntil = null, rdWait = 5000;
  function renderRd(st) {
    const rd = st.rd, el = $('#k-rd');
    if (!rd) { el.hidden = true; return; }
    el.hidden = false;
    const mode = rd.mode;
    el.className = 'tk-rd ' + mode;
    rdUntil = rd.left === null || rd.left === undefined ? null : nowMs() + rd.left;
    rdWait = rd.wait || 5000;
    if (mode === 'tutor') el.replaceChildren(h('span', { html: ICON_SPK }), rd.again ? '老师再读一遍,听完跟着读' : '先听老师读');
    else if (mode === 'heard') el.replaceChildren('听到了…');
    else {
      if (mode === 'speech') $('#k-heard').textContent = '';
      const lv = h('span', { class: 'lv2' }, h('i'), h('i'), h('i'), h('i'), h('i'));
      el.replaceChildren(h('span', { class: 'ring', html: ringHtml }), mode === 'speech' ? '在听你读…' : mode === 'wait' ? '想读就读' : '轮到你,跟着读一遍', lv);
      if (mode !== 'listen') { const r = $('#k-ring'); if (r) r.style.opacity = mode === 'speech' ? '1' : '0'; }
    }
    drawRing();
  }
  /** 等孩子时外圈一点点走完:走完老师再读一遍 */
  function drawRing() {
    const r = $('#k-ring');
    if (!r || rdUntil === null) return;
    const left = Math.max(0, rdUntil - nowMs());
    r.setAttribute('stroke-dashoffset', String(RING_C * (1 - left / rdWait)));
  }
  setInterval(drawRing, 100);
  /** reel = 录像模式:不开麦、不连,声音是替身(老师在不在出声照录像的时段),消息由录像喂进 C.handle */
  function makeCall(id, reel) {
    const A = reel ? { play() {}, flush() {}, close() {}, open: async () => {}, playing: () => Boolean(RL) && tkIn(RL.r.playing, RL.t), muted: true, onChunk: null, onLevel: null } : makeAudio();
    const C = { id, ws: null, st: null, deadline: null, saying: false, tutorLine: '', tutorDone: true, interrupt: false, timer: null, ended: false, startedAt: 0 };
    const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/talk/' + id + '/ws';
    C.send = (o) => { if (C.ws && C.ws.readyState === 1) C.ws.send(JSON.stringify(o)); };
    C.start = async () => {
      setHint('打开麦克风…');
      try { await A.open(); } catch (e) { setHint('麦克风打不开:' + (e && e.message ? e.message : e)); return; }
      A.onChunk = (ab) => {
        if (!C.st || C.saying) return;
        // 跟读段不用按:老师放声时不推(没有回声),其余时间都推,开口 / 停由服务端判
        if (C.st.phase === 'read') { if (!A.playing()) C.ws.send(ab); return; }
        if (C.st.phase === 'chat') { if (C.interrupt || !A.playing()) C.ws.send(ab); }
      };
      A.onLevel = (v) => { const rb = document.querySelectorAll('#k-rd .lv2 i'); for (let i = 0; i < rb.length; i++) { const w = 1 - Math.abs(i - 2) / 3; rb[i].style.height = Math.round(6 + 22 * Math.min(1, v * 6) * w) + 'px'; } const bars = $('#k-lv').children; const k = Math.min(1, v * 6); for (let i = 0; i < bars.length; i++) { const w = 1 - Math.abs(i - 2) / 3; bars[i].style.height = Math.round(6 + 22 * k * w) + 'px'; } if (C.st && C.st.phase === 'chat') { const you = !A.playing() && !C.saying; $('#k-av').classList.toggle('listen', k > 0.12 && you); $('#k-call').classList.toggle('you', you); $('#k-callst').textContent = you ? '轮到你说' : C.saying ? '在念这个词…' : (C.interrupt ? '老师在说,想插嘴就直接说' : '老师在说,等她说完你再说'); } };
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
        if (m.done !== undefined) { C.tutorLine = m.done; C.tutorDone = true; } else { if (C.tutorDone) { C.tutorLine = ''; C.tutorDone = false; } C.tutorLine += m.delta; }
        const en = C.tutorLine.replace(/[\\u4e00-\\u9fff].*$/, '').trim() || C.tutorLine;
        const zh = C.tutorLine.slice(en.length).trim();
        if (C.st && C.st.phase === 'chat') $('#k-tt').replaceChildren(en, ...(zh && zh !== C.tutorLine ? [h('span', { class: 'zh' }, zh)] : []));
        else $('#k-say').replaceChildren(h('span', { class: 'en' }, C.tutorLine));
      }
      else if (m.t === 'kid') { const chat = C.st && C.st.phase === 'chat'; (chat ? $('#k-heard2') : $('#k-heard')).replaceChildren(h('span', { class: 'muted' }, chat ? '你说的:' : '你读的'), h('span', {}, m.text)); }
      else if (m.t === 'card') lightCard(m.i);
      else if (m.t === 'flush') A.flush();
      else if (m.t === 'err') setHint(m.msg);
      else if (m.t === 'end') { if (!reel) C.finish(m.why); }
    };
    C.tick = () => {
      if (!C.st) return;
      if (C.st.phase === 'chat' && C.deadline !== null) { const left = Math.max(0, C.deadline - (nowMs() - C.startedAt)); $('#k-chip').textContent = '打电话 · 还有 ' + Math.floor(left / 60000) + ':' + String(Math.floor((left % 60000) / 1000)).padStart(2, '0'); }
      if (C.st.phase === 'read') setHint(C.st.rd && C.st.rd.mode === 'wait' ? '想读就读,或者点「下一句」' : C.st.rd && C.st.rd.mode === 'listen' ? '读完停一下就好' : '');
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
        const off = () => { C.saying = false; btn.classList.remove('on'); clearTimeout(guard); };
        const guard = setTimeout(off, 4000);
        u.onend = off; u.onerror = off;
        C.saying = true; btn.classList.add('on'); C.send({ t: 'say', w });
        ss.cancel(); ss.speak(u);
      };
      go();
    };
    C.hangup = (why) => { C.send({ t: 'bye' }); C.finish(why || 'bye'); };
    C.finish = (why) => {
      if (C.ended) return; C.ended = true;
      clearInterval(C.timer); A.close(); window.removeEventListener('resize', C.onResize);
      try { if (C.ws && C.ws.readyState <= 1) C.ws.close(1000, why); } catch (e) {}
      call = null;
      // 孩子从首页进来的(?home=1):打完回首页;家长递过去的:打完到回看
      if (location.hash.startsWith('#/kid/')) { if (FROM_HOME) location.href = '/'; else { justEnded = C.id; go('#/review/' + C.id); } }
    };
    return C;
  }
  /** 孩子那一屏回到开头的样子(开一次、录像往回拖都用) */
  function kidReset() {
    kidEl.className = 'view on';
    $('#k-start').hidden = false; $('#k-read').hidden = true; $('#k-chat').hidden = true; $('#k-bar').hidden = true; $('#k-bar2').hidden = true; setHint('');
    cardI = -1; cardGrid = null; lastMode = ''; wordsBuilt = false; $('#k-words').replaceChildren(); $('#k-card').replaceChildren();
    $('#k-chip').textContent = '跟我读'; $('#k-chip').className = 'chip plum'; $('#k-dots').replaceChildren(); $('#k-heard').textContent = ''; $('#k-heard2').textContent = '';
    $('#k-tt').textContent = ''; $('#k-say').textContent = ''; $('#k-av').className = 'tk-av'; $('#k-call').className = 'tk-call';
  }
  async function kid(id) {
    kidReset();
    try { K = await api('GET', '/api/talk/' + id); } catch (e) { toast('没有这一次'); go('#/'); return; }
    const n = K.meta.list.words.length + K.meta.list.sentences.length;
    $('#k-start-hint').textContent = n ? '先跟我读 ' + n + ' 句,再打个电话聊一聊' : '口语单是空的,直接打电话聊';
    if (K.meta.status === 'done') $('#k-start-hint').textContent = '这一次已经聊过了;再打一次会盖掉上次的记录';
  }
  $('#k-go').addEventListener('click', async () => { if (call) return; try { window.speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch (e) {} call = makeCall(K.meta.id); $('#k-go').disabled = true; await call.start(); $('#k-go').disabled = false; });
  $('#k-again').addEventListener('click', () => { if (call) call.send({ t: 'again' }); });
  $('#k-next').addEventListener('click', () => { if (call) { $('#k-next').disabled = true; $('#k-heard').textContent = ''; call.send({ t: 'next' }); } });
  $('#k-skip').addEventListener('click', () => { if (call) call.send({ t: 'chat' }); });
  $('#k-hang').addEventListener('click', () => { if (call) call.hangup('bye'); });
  $('#k-back').addEventListener('click', () => { if (call) call.hangup('left'); });

  // ---- 家长:回看 ----
  /** 刚挂的那一次:服务端还在落盘(混录像的声音要一会儿),字没好就隔 0.4 秒再拿,最多 6 秒 */
  let justEnded = null;
  async function review(id, tries = 0) {
    let d; try { d = await api('GET', '/api/talk/' + id); } catch (e) { toast('没有这一次'); go('#/'); return; }
    if (!d.transcript && justEnded === id && tries < 15) { setTimeout(() => { if (location.hash === '#/review/' + id) void review(id, tries + 1); }, 400); return; }
    const t = d.transcript;
    $('#r-title').textContent = fmtDate(d.meta.createdAt);
    $('#r-meta').textContent = t ? '聊了 ' + Math.round(t.ms / 1000) + ' 秒 · ' + ({ bye: '孩子挂的', time: '到点了', idle: '半天没说话', left: '离开了页面' }[t.why] || t.why) + ' · token 进 ' + t.usage.input + ' 出 ' + t.usage.output : '还没聊';
    const play = $('#r-play'); play.replaceChildren();
    if (d.hasReel && REEL_HREF) play.append(h('a', { class: 'pill dark', href: REEL_HREF + encodeURIComponent(id), id: 'r-reel' }, '▶ 看录像'));
    if (d.hasTutorAudio) play.append(h('div', {}, h('div', { class: 'muted small' }, '老师'), h('audio', { controls: '', preload: 'none', src: '/api/talk/' + id + '/audio/tutor' })));
    if (d.hasKidAudio) play.append(h('div', {}, h('div', { class: 'muted small' }, '孩子'), h('audio', { controls: '', preload: 'none', src: '/api/talk/' + id + '/audio/kid' })));
    const used = $('#r-used'); used.replaceChildren();
    if (t) for (const u of [].concat(t.used.words, t.used.sentences)) used.append(h('span', { class: u.kid ? 'y' : '' }, u.en + (u.kid ? ' · 孩子说了 ' + u.kid + ' 次' : u.tutor ? ' · 老师提了' : '')));
    const lines = $('#r-lines'); lines.replaceChildren();
    if (!t) { lines.append(h('a', { class: 'pill', href: '#/kid/' + id }, '让孩子打这个电话'), h('a', { class: 'pill', href: '#/list/' + id }, '改口语单')); return; }
    let phase = '';
    for (const l of t.lines) {
      if (l.phase !== phase) { phase = l.phase; lines.append(h('div', { class: 'ph' }, h('span', { class: 'chip ' + (phase === 'read' ? 'plum' : 'blue') }, phase === 'read' ? '跟读' : '聊'))); }
      lines.append(h('div', { class: 'ln ' + l.who }, l.text, h('small', {}, (l.who === 'tutor' ? '老师' : '孩子') + ' · ' + Math.round(l.at / 1000) + ' 秒')));
    }
  }
  $('#r-del').addEventListener('click', async () => { const id = location.hash.split('/')[2]; if (!id || !confirm('删掉这一次?声音和字都没了')) return; try { await api('DELETE', '/api/talk/' + id); go('#/'); } catch (e) { toast('没删掉:' + e.message); } });

  // ---- 录像模式:轨道是 lib/reel.ts(tkBuild / tkClock / tkCaption,内联在下面);把手照《家长录像设计.md》的录像栏(reel-dock.ts) ----
__TALK_REEL_JS__
  const reelAudio = () => { try { if (window.parent !== window && window.parent.__cotutorAudio) return window.parent.__cotutorAudio; } catch (e) {} return null; };
  /** 把 ≤ t 的消息喂进孩子那一屏;往回拖就从头再喂 */
  const reelApply = (t) => {
    if (t < RL.at) { kidReset(); RL.C = makeCall(REEL_ID, true); RL.C.startedAt = 0; RL.k = 0; }
    const msgs = RL.r.msgs;
    while (RL.k < msgs.length && msgs[RL.k][0] <= t) { const x = msgs[RL.k++]; RL.t = x[0]; if (x[1] === 'o') RL.C.handle(x[2]); }
    RL.t = t; RL.at = t;
    const C = RL.C;
    if (C.st) C.tick();
    drawRing();
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
    }, () => host.cotutorReelFail());
  };

  if (REEL_ID) reelBoot(); else route();
})();
</script>
</body></html>`;

/** kidOnly = 孩子端 /talk:只有跟读与聊那一屏;家长端 /parent/talk 全有 */
export function talkPage(kidOnly: boolean): string {
  return TALK_PAGE.replace('__TALK_KID_ONLY__', kidOnly ? 'true' : 'false').replace('__WORD_DRAW_JS__', () => wordDrawJs()).replace('__TALK_REEL_JS__', () => TALK_REEL_JS)
    // 回看页的「看录像」只在家长端那份里有地址(孩子端页面的源码里不出现 /parent)
    .replace('__TALK_REEL_HREF__', kidOnly ? '' : '/parent/talk/reel?id=');
}
