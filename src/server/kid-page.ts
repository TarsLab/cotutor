/**
 * 孩子端 `/`:首页(老师卡 + 家长发布的首页卡,《首页设计.md》)与老师页(= 板书页)。零依赖内联脚本,只走 /api/kid/* 与 /api/audio。
 * 首页的老师卡上按钮决定进老师页之后的话题:新话题 / 接着某个话题 / 开场(按钮上的字立刻发出去);老师页不再自己猜话题。
 * 家长端(/parent,《家长板书页设计.md》)也是同一个页面:__MODE__ 里 parent = true——数据走家长接口(答案在、家长的话在)、卡锁着、
 * 首页换成今天的清单、节前后插旁注(旁注不是卡)。PARENT 的分支只准出现在四处:数据源、chrome、旁注、readonly;别处看到 PARENT 就是写错了。
 * 铁律(《产品规划.md》):界面上永远没有错误与评判——后端不通、老师出错、识别失败,都只是「什么都不出现」或头像灰;
 * 文字尽量少,语音优先。孩子设备上没有通往家长端的入口(2026-09-10 拍板)。
 *
 * 老师页照豆包爱学的形态(《豆包录屏分析.md》):板书是一天一份、越讲越长的文档,孩子的话不上板,也不在字幕行回显;
 * 一轮回复 = 一节:卡整块铺出,讲稿逐句播(有 mp3 放 mp3,没有用浏览器合成,再没有按字数计时),
 * 播到哪句就在卡上画标注、滚到那张卡;末句是问句就停下,暂停钮换成「继续」。
 * 输入条照豆包通用版:相机 | 发消息或按住说话 | 加号(相册)。平板横屏:板书两列(最宽 1040 居中),没有左栏。
 *
 * 交互逻辑在 ../lib/kid-board.ts(纯函数,有测试),这里把它剥掉类型内联进页面,两处一份源码。卡按 kind 渲染(text / read / choice / fill / code),
 * 每种卡的紧凑态只读;点卡开舞台(盖住板书那块,顶栏是卡的名字 + 关闭,讲稿暂停):选择题在舞台里点大按钮,选了就 PUT 状态,
 * 「交给老师」= 发一条 {text:'', action:'submit', focus:{card}};舞台开着时发的消息都带 focus.card。「继续」= {text:'', action:'continue'}。
 * 状态存服务端,重开页面从 section.cards[n].state 读回;卡上永远不画对错。
 * 重卡(scene / canvas)的舞台在 iframe 里装 /stage/?card=<id>(舞台包,src/stage/),postMessage 协议见 src/stage/protocol.ts:
 * 页面发 card(props + state + 课包 URL),包回 phase / state / submit / close;场景在播时字幕行显示场景讲稿、按钮映射到播放器;
 * 讲稿 [[play]] 锚到场景卡 → 念完那句把动画铺满播,done 了关舞台接着念。
 * 点读段:card.assets 里有 <段号>.mp3 的放服务端配的,没有的浏览器合成;填空舞台逐空打字、「交给老师」;图片舞台双指缩放。
 * 作业照片(《作业照片设计.md》):相机 / 相册先进发照片屏(裁剪、圈画、转 90°、配一句话,坐标在 src/lib/photo-edit.ts),再一条 {text, photos};节头小图点开看大图。
 * 流式:老师还在说时 pending 条目带 partial 板书,卡按下标只追加不重画(先出的卡不闪),讲稿不播;整轮跑完那节换成正式的,声音从第一句起。
 * __TITLE__ / __SHORT__(主屏幕图标下的名字)由路由替换。调试:`?step=<节>.<句>` 直接停在某句(标注画齐、不出声),截图与测试用。
 */
import { readFileSync } from 'node:fs';
import { letterAdvances } from './letters.ts';
import { stripTypeScriptTypes } from 'node:module';

/** 读 src/lib/<name> 的源码(仓库里是 .ts,npm 包里是 dist 的 .js),剥类型、去 export,变成能内联的普通脚本 */
function libSource(name: 'kid-board' | 'photo-edit' | 'reel'): string {
  let src: string;
  try {
    const ts = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
    // stripTypeScriptTypes 会发一条 ExperimentalWarning;这里只剥自己的文件,警告对用户没有信息量,压掉
    const warn = process.emitWarning;
    process.emitWarning = () => {};
    try {
      src = stripTypeScriptTypes(ts);
    } finally {
      process.emitWarning = warn;
    }
  } catch {
    src = readFileSync(new URL(`../lib/${name}.js`, import.meta.url), 'utf8');
  }
  return src
    .replace(/^export (?=(?:async )?(?:function|const|let|class) )/gm, '')
    .replace(/^export \{[^}]*\};?[ \t]*$/gm, '')
    .replace(/^import [^\n]*$/gm, '');
}

const PAGE = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="__SHORT__">
<meta name="theme-color" content="#faf9f4">
<link rel="manifest" href="__MANIFEST__">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="icon" href="/icon-192.png">
<link rel="stylesheet" href="/kid/theme.css">
<title>__TITLE__</title>
<style>
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html, body { height:100%; }
  body { margin:0; background:var(--paper); color:var(--ink); font:18px/1.5 -apple-system,"PingFang SC","Helvetica Neue",sans-serif; -webkit-user-select:none; user-select:none; overscroll-behavior:none; }
  button { font:inherit; color:inherit; background:none; border:0; padding:0; cursor:pointer; }
  .ic svg { display:block; }
  /* ---- 首页 ---- */
  #home { min-height:100%; padding:calc(env(safe-area-inset-top) + 16px) 20px calc(env(safe-area-inset-bottom) + 40px); max-width:960px; margin:0 auto; display:flex; flex-direction:column; gap:18px; }
  h1 { font-size:20px; font-weight:600; margin:0; color:var(--dim); }
  .tutors { display:grid; grid-template-columns:minmax(0,1fr); gap:14px; }
  .av { border-radius:50%; background:var(--card); border:3px solid var(--line); display:grid; place-items:center; font-weight:700; box-shadow:0 4px 12px #0000000f; flex:0 0 auto; overflow:hidden; }
  .av img { width:100%; height:100%; object-fit:cover; }
  .hcards { display:grid; grid-template-columns:minmax(0,1fr); gap:12px; align-items:start; }
  .hcards:empty { display:none; }
  .lbl { font-size:14px; color:var(--dim); }
  #toast { position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom) + 24px); transform:translateX(-50%); max-width:min(560px,calc(100% - 32px)); padding:12px 18px; border-radius:16px; background:#2b2b2bee; color:#fff; font-size:15px; line-height:1.5; white-space:pre-line; z-index:50; display:none; }
  #toast.on { display:block; }
  #rest { display:none; text-align:center; color:var(--dim); font-size:16px; padding:12px 0; }
  /* 给老师换样子(figshot):不是首页发布的卡,是 cotutor.json 配了 figshot 就有的固定入口;figshot 没开着就不出现 */
  .c.c-figshot { flex-direction:row; align-items:center; gap:16px; text-decoration:none; color:var(--ink); background:#fff3e8; border-color:var(--accent); }
  .c-figshot[hidden] { display:none; }
  .c-figshot .avs { display:flex; flex:none; }
  .c-figshot .avs .av { width:52px; height:52px; font-size:24px; border-color:#fff3e8; }
  .c-figshot .avs .av + .av { margin-left:-14px; }
  .c-figshot .tx { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
  .c-figshot .tx b { font-size:19px; }
  .c-figshot .tx span { font-size:15px; color:var(--dim); }
  .c-figshot .go { flex:none; height:48px; padding:0 22px; border-radius:24px; background:#c95a22; color:#fff; font-size:17px; font-weight:600; display:flex; align-items:center; }
  body.offline #rest { display:block; }
  body.offline .c-tutor { pointer-events:none; }
  body.offline .c-tutor .av { filter:grayscale(1); opacity:.4; box-shadow:none; }
  body.offline .c-tutor .nm, body.offline .c-tutor .bt { color:var(--dim); }
  /* ---- 老师页 = 板书页 ---- */
  #tutor { position:fixed; inset:0; background:var(--paper); display:none; z-index:10; }
  #tutor.on { display:flex; }
  #main { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; }
  /* 没有顶栏:左上角一颗胶囊「‹ 头像」(整颗点了回首页),右上角喇叭 + 更多;浮在板书上面、舞台遮罩(z 4)下面,舞台开了就被压暗盖住 */
  .tb { position:absolute; top:calc(env(safe-area-inset-top) + 10px); z-index:3; display:flex; align-items:center; gap:10px; }
  .tb.l { left:calc(env(safe-area-inset-left) + 12px); } .tb.r { right:calc(env(safe-area-inset-right) + 12px); }
  #back { display:flex; align-items:center; gap:2px; height:48px; padding:0 4px 0 8px; border-radius:24px; background:#fffffff0; border:1px solid var(--line); box-shadow:0 2px 10px #00000018; }
  #back .av { width:40px; height:40px; font-size:19px; box-shadow:none; }
  #back-ic { width:24px; height:24px; color:var(--dim); display:grid; place-items:center; }
  #c-mo { font-size:13px; color:var(--dim); background:#fffffff0; border:1px solid var(--line); border-radius:14px; padding:4px 12px; box-shadow:0 2px 10px #00000010; white-space:nowrap; }
  #c-mo[hidden] { display:none; }
  .tb .hb { width:44px; height:44px; border-radius:50%; background:#fffffff0; border:1px solid var(--line); box-shadow:0 2px 10px #00000018; }
  #menu { position:absolute; inset:0; display:none; z-index:30; }
  #menu.on { display:block; }
  #menu .dimmer { position:absolute; inset:0; background:#00000073; }
  #menu .panel { position:absolute; top:calc(env(safe-area-inset-top) + 62px); right:calc(env(safe-area-inset-right) + 12px); width:min(320px, calc(100% - 24px)); background:var(--card); border-radius:20px; padding:8px; display:flex; flex-direction:column; gap:4px; box-shadow:0 8px 30px #00000033; }
  #menu .panel button { display:flex; align-items:center; gap:14px; padding:14px; border-radius:14px; text-align:left; width:100%; }
  #menu .panel button[hidden] { display:none; }
  #menu .panel button.dim { opacity:.35; pointer-events:none; }
  #menu .ic { flex:0 0 auto; width:44px; height:44px; border-radius:50%; background:var(--paper); color:var(--dim); display:grid; place-items:center; }
  #menu .tx { display:flex; flex-direction:column; gap:2px; min-width:0; }
  #menu .tx b { font-size:17px; font-weight:600; color:var(--ink); } #menu .tx small { font-size:13px; color:var(--dim); }
  .hb { width:40px; height:40px; display:grid; place-items:center; color:var(--dim); }
  .hb.on { color:var(--accent); }
  .hb.dim { opacity:.35; pointer-events:none; }
  .hb[hidden] { display:none; }
  .blank { flex:1; grid-column:1 / -1; min-height:50vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; text-align:center; padding:40px 20px; color:var(--dim); }
  .blank .av { width:96px; height:96px; font-size:44px; margin-bottom:4px; }
  .blank .nm { font-size:26px; font-weight:700; color:var(--ink); }
  .blank .mo { font-size:15px; margin-bottom:14px; }
  .blank b { font-size:22px; font-weight:600; color:var(--ink); }
  .blank small { font-size:15px; }
  #hist { position:absolute; inset:0; display:none; z-index:30; }
  #hist.on { display:block; }
  #hist .dimmer { position:absolute; inset:0; background:#00000033; }
  #hist .panel { position:absolute; top:0; right:0; bottom:0; width:100%; max-width:380px; background:var(--card); display:flex; flex-direction:column; box-shadow:-4px 0 20px #00000018; }
  #hist .hd { display:flex; align-items:center; justify-content:space-between; padding:calc(env(safe-area-inset-top) + 12px) 12px 12px 20px; font-size:18px; font-weight:600; border-bottom:1px solid var(--line); }
  #hist .ls { flex:1; overflow:auto; padding:8px 12px calc(env(safe-area-inset-bottom) + 24px); }
  #hist .dt { font-size:13px; color:var(--dim); padding:14px 6px 6px; }
  #hist .tr { display:flex; flex-direction:column; gap:4px; padding:12px 14px; border-radius:14px; background:var(--paper); margin-bottom:8px; cursor:pointer; border:2px solid transparent; }
  #hist .tr.on { border-color:var(--accent); }
  #hist .tr b { font-size:16px; font-weight:600; }
  #hist .tr small { font-size:13px; color:var(--dim); }
  #hist .empty { padding:40px 16px; text-align:center; color:var(--dim); }
  #pill[hidden] { display:none; }
  #back-today { width:100%; height:56px; border-radius:28px; background:#fff; border:1px solid var(--line); box-shadow:0 2px 10px #00000010; font-size:17px; font-weight:600; color:var(--ink); }
  #back-today[hidden] { display:none; }
  /* ---- 家长板书页(《家长板书页设计.md》):清单(每位老师一块、一行一个话题)与旁注。旁注不是卡:只读块,插在节前后;卡下面一行灰字是答案 ---- */
  #pdate { display:flex; align-items:center; gap:12px; font-size:15px; color:var(--dim); }
  #pdate b { font-weight:600; color:var(--ink); min-width:5em; text-align:center; }
  #pdate button { width:36px; height:36px; border-radius:50%; background:var(--card); border:1px solid var(--line); font-size:18px; display:grid; place-items:center; }
  #pdate button:disabled { opacity:.3; }
  #pdate .book { width:auto; margin-left:auto; padding:0 14px; border-radius:18px; font-size:14px; font-weight:600; color:var(--ink); }
  #pdate .book.arm { background:#b3541e; color:#fff; border-color:#b3541e; }
  .pt { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:14px 16px; display:flex; flex-direction:column; gap:8px; }
  .pt .hd { display:flex; align-items:center; gap:12px; }
  .pt .hd .av { width:44px; height:44px; font-size:20px; }
  .pt .hd .who { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
  .pt .hd .nm { font-size:18px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .pt .hd small { color:var(--dim); font-size:13px; line-height:1.45; }
  .pt .hd small span { white-space:nowrap; }
  .pt .tr { position:relative; display:flex; flex-direction:column; gap:3px; padding:10px 12px; border-radius:12px; background:var(--paper); cursor:pointer; }
  .pt .tr b { font-size:16px; font-weight:600; padding-right:56px; }
  .pt .tr .del { position:absolute; right:8px; top:8px; font-size:13px; color:var(--dim); padding:5px 9px; border-radius:8px; }
  .pt .tr .del.arm { color:#fff; background:#b3541e; }
  .pt .tr .del:disabled { opacity:.35; }
  .pt .tr small { font-size:13px; color:var(--dim); }
  .pt .none { color:var(--dim); font-size:14px; padding:2px 0; }
  .pt .hd .try { flex:none; font-size:14px; font-weight:600; color:var(--accent); border:1.5px solid var(--accent); border-radius:999px; padding:5px 12px; }
  /* 老师块的「试用」是次要的:不带框、灰字,别把老师的名字挤没 */
  .pt .hd .try.lite { border-color:transparent; color:var(--dim); padding:5px 4px; margin-right:2px; }
  .pt .tt { font-size:13px; color:var(--dim); padding:6px 2px 0; }
  .pt .tr.tried { background:transparent; border:1px dashed var(--line); }
  .pt .stars { display:flex; gap:2px; margin-top:2px; }
  .pt .stars .st { font-size:20px; line-height:1; padding:4px 3px; color:var(--line); cursor:pointer; }
  .pt .stars .st.on { color:#e0a520; }
  #pill .ic[hidden] { display:none; }
  .notes { display:flex; flex-direction:column; gap:6px; }
  .notes:empty, .notes[hidden] { display:none; }
  .note { font-size:14px; line-height:1.55; color:var(--dim); padding:2px 4px; display:flex; gap:8px; align-items:flex-start; }
  .note .tg { flex:none; font-size:12px; line-height:1.6; padding:1px 7px; border-radius:6px; background:var(--card); border:1px solid var(--line); color:var(--dim); white-space:nowrap; }
  .note .tx { min-width:0; white-space:pre-wrap; word-break:break-word; }
  .note.said .tx { color:var(--ink); font-size:16px; }
  .note.said.kid .tg { color:var(--accent); border-color:var(--accent); }
  .note.err .tg { color:#b3541e; border-color:#b3541e; }
  .pt .tr .pin { white-space:nowrap; font-size:12px; font-weight:500; color:var(--accent); border:1px solid var(--accent); border-radius:6px; padding:0 6px; margin-left:6px; vertical-align:middle; }
  /* 课文件(《备课设计.md》§10.6):清单里老师块下面一栏,点进去整份铺开——讲稿是「说」旁注、要改的钉在卡下、末尾是讲法 */
  .pt .tr.lsn { border:1px solid var(--line); background:var(--card); }
  .pt .tr .pin.bad { color:#b3541e; border-color:#b3541e; }
  .pt .tr .pin.ok { color:#2f6b3a; border-color:#2f6b3a; }
  .sec.lsn > .note { margin:0 6px; }
  .note.brief { background:#fffbef; border:1px dashed #d9c98f; border-radius:14px; padding:10px 12px; }
  .note.brief .tg { color:#8a6d1a; border-color:#c9b56a; }
  .note.brief .tx { color:var(--ink); }
  .note.fix .tg, .note.fix .tx { color:#b3541e; } .note.fix .tg { border-color:#b3541e; }
  .note.warn .tg { color:#8a6d1a; border-color:#c9b56a; }
  .note .pin.voice { flex:none; align-self:center; font-size:12px; color:var(--accent); border:1px solid var(--accent); border-radius:10px; padding:1px 8px; background:#fff; white-space:nowrap; }
  .note .pin.voice.on { background:var(--accent); color:#fff; }
  .note .pin.ask { flex:none; align-self:center; font-size:12px; color:#5b3d86; border:1px solid #5b3d86; border-radius:6px; padding:0 6px; white-space:nowrap; }
  .note mark { background:#fff0a3; color:inherit; border-radius:4px; padding:0 2px; box-shadow:inset 0 -2px 0 #e6c93b; }
  /* 这节课(《备课设计.md》§十):底部「这节课」条——交给孩子(先写成课文件再交);交了写着课文件在哪 */
  #lesson { display:flex; align-items:center; gap:12px; margin:4px 16px 0; padding:10px 12px 10px 14px; border-radius:18px; background:var(--card); border:1.5px solid var(--accent); }
  #lesson[hidden] { display:none; }
  #lesson.empty { border-color:var(--line); }
  #lesson .tx2 { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
  #lesson .tx2 b { font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #lesson .tx2 small { font-size:12px; color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #lesson button { flex:none; height:38px; padding:0 14px; border-radius:19px; background:var(--paper); border:1px solid var(--line); font-size:14px; font-weight:600; }
  #lesson #ls-hand { background:var(--accent); border-color:var(--accent); color:#fff; }
  /* 试用(《备课设计.md》§十二):孩子端页面带 ?try=,家长扮孩子;顶上一行小字,「以前的」「新话题」不出 */
  #trytag { display:none; position:fixed; top:calc(env(safe-area-inset-top) + 6px); left:50%; transform:translateX(-50%); z-index:60; font-size:12px; color:#5b3d86; background:#f3edfb; border:1px solid #5b3d86; border-radius:10px; padding:1px 10px; pointer-events:none; white-space:nowrap; }
  body.tryout #trytag { display:block; }
  body.tryout #hist-btn, body.tryout #new-btn { display:none; }
  #trygo { position:fixed; inset:0; z-index:70; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; background:var(--paper); }
  #trygo button { height:56px; padding:0 32px; border-radius:28px; border:none; background:var(--accent); color:#fff; font-size:20px; font-weight:700; }
  #trygo small { font-size:14px; color:var(--dim); }
  #lesson button:disabled, #lesson button[hidden] { opacity:.4; }
  #lesson button[hidden] { display:none; }
  #hand { position:absolute; inset:0; display:none; z-index:31; }
  #hand.on { display:block; }
  #hand .dimmer { position:absolute; inset:0; background:#00000073; }
  #hand .panel { position:absolute; left:50%; top:calc(env(safe-area-inset-top) + 72px); translate:-50% 0; width:min(440px, calc(100% - 32px)); background:var(--card); border-radius:20px; padding:18px; display:flex; flex-direction:column; gap:10px; box-shadow:0 8px 30px #00000033; }
  #hand .panel > b { font-size:18px; color:var(--ink); }
  #hand .panel > small { font-size:13px; color:var(--dim); line-height:1.5; }
  #hand label { display:flex; flex-direction:column; gap:4px; font-size:13px; color:var(--dim); }
  #hand input { font:inherit; font-size:16px; padding:10px 12px; border:1px solid var(--line); border-radius:12px; background:var(--paper); color:var(--ink); }
  #hand .row { display:flex; gap:8px; justify-content:flex-end; }
  #hand .row button { padding:10px 18px; border-radius:12px; background:var(--paper); color:var(--ink); font-size:16px; }
  #hand #hd-go { background:var(--accent); color:#fff; }
  #hand #hd-go:disabled { opacity:.5; }
  #hd-msg { font-size:13px; color:var(--dim); white-space:pre-wrap; min-height:1em; }
  #hd-msg.err { color:#b3541e; }
  #board .c .note-ans { font-size:13px; color:var(--dim); margin-top:6px; }
  #wrap { position:relative; flex:1; min-height:0; display:flex; flex-direction:column; }
  /* 板书顶上一条渐隐:滚上去的内容在两角按钮那一带淡成纸色,不和胶囊、话题标签叠字。只是盖一层颜色,不占位置、不收触摸;
     夹在板书(卡上的「再听」z 1)与两角按钮(z 3)之间。滚到顶时第一节在 68px 以下,基本碰不到它 */
  #wrap::before { content:""; position:absolute; left:0; right:0; top:0; height:calc(env(safe-area-inset-top) + 72px); z-index:2; pointer-events:none; background:linear-gradient(var(--paper) calc(env(safe-area-inset-top) + 16px), transparent); }
  /* 舞台的遮罩:板书与顶栏压暗,点一下 = 点 ×;字幕行与输入条不盖(舞台开着孩子照样能说话) */
  #st-dim { position:absolute; left:0; right:0; bottom:0; top:-100vh; z-index:4; background:#00000073; display:none; }
  #stage.on ~ #st-dim { display:block; }
  #board { flex:1; min-height:0; overflow:auto; padding:calc(env(safe-area-inset-top) + 68px) 16px 24px; display:flex; flex-direction:column; gap:12px; -webkit-overflow-scrolling:touch; scroll-behavior:smooth; }
  /* 字幕行 */
  .sh .ph { display:inline-block; height:34px; width:auto; max-width:120px; border-radius:6px; object-fit:cover; border:1px solid var(--line); background:#fff; vertical-align:middle; }
  #sub { display:flex; align-items:center; gap:12px; padding:8px 16px 4px; min-height:52px; }
  #sub-text { flex:1; font-size:15px; line-height:1.45; color:#5a5650; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  #sub-text.wait, #sub-text.gap { color:var(--dim); }
  #sub-text .av { display:inline-grid; width:22px; height:22px; font-size:12px; border-width:2px; box-shadow:none; vertical-align:middle; margin-right:8px; }
  .dots { display:inline-flex; gap:4px; margin-left:6px; vertical-align:middle; }
  .dots i { width:5px; height:5px; border-radius:50%; background:var(--accent); opacity:.3; animation:dot 1.2s ease-in-out infinite; }
  .dots i:nth-child(2) { animation-delay:.2s; } .dots i:nth-child(3) { animation-delay:.4s; }
  @keyframes dot { 0%,100% { opacity:.25; transform:translateY(0); } 40% { opacity:1; transform:translateY(-3px); } }
  /* 第一拍前板上的占位卡:老师头像轻轻浮,一支笔慢慢地写;第一拍就绪就撤,真卡落在同一个位置 */
  .wait-card { flex:0 0 auto; height:118px; border-radius:16px; border:1.5px dashed var(--line); background:var(--card); display:flex; align-items:center; justify-content:center; gap:14px; }
  .wait-card .av { width:36px; height:36px; font-size:18px; border-width:2px; box-shadow:none; animation:float 3s ease-in-out infinite; }
  .wait-card svg { width:120px; height:34px; overflow:visible; }
  .wait-card path { fill:none; stroke:var(--accent); stroke-width:3; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:260; stroke-dashoffset:260; animation:write 5s ease-in-out infinite; }
  .wait-card path + path { stroke-width:2.5; opacity:.55; animation-delay:.6s; }
  .blank ~ .wait-card { display:none; }
  @keyframes write { 0% { stroke-dashoffset:260; opacity:1; } 65% { stroke-dashoffset:0; opacity:1; } 88% { stroke-dashoffset:0; opacity:0; } 100% { stroke-dashoffset:260; opacity:0; } }
  @keyframes float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-3px); } }
  @media (prefers-reduced-motion:reduce) { .wait-card path { animation:none; stroke-dashoffset:0; } .wait-card .av, .dots i { animation:none; opacity:.6; } }
  /* 再听(2026-09-18):讲完的卡右上角一个小喇叭,节头念完也有;点了重念,念着的那张喇叭变橙、轻轻跳 */
  .c > .again { position:absolute; top:-9px; right:-9px; z-index:1; width:30px; height:30px; padding:0; border-radius:50%; border:1px solid var(--line); background:#fff; color:var(--dim); display:none; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,.08); }
  .c > .again::before { content:""; position:absolute; inset:-7px; }
  .c.heard > .again { display:inline-flex; }
  .c.replaying > .again, .sec.replaying > .sh .again { color:var(--accent); border-color:var(--accent); animation:again 1s ease-in-out infinite; }
  .sh .again { flex:0 0 auto; width:26px; height:26px; padding:0; border-radius:50%; border:1px solid var(--line); background:#fff; color:var(--dim); display:none; align-items:center; justify-content:center; }
  .sec.heard > .sh { cursor:pointer; }
  .sec.heard > .sh .again { display:inline-flex; }
  #sub-text.line { cursor:pointer; }
  #sub-text.replay { color:var(--dim); }
  #sub-text .rp { display:inline-flex; vertical-align:-2px; margin-right:6px; color:var(--accent); }
  #sub-btn:disabled { opacity:.35; }
  @keyframes again { 0%,100% { transform:scale(1); } 50% { transform:scale(1.12); } }
  @media (prefers-reduced-motion:reduce) { .c.replaying > .again, .sec.replaying > .sh .again { animation:none; } }
  #sub-btn { flex:0 0 auto; height:36px; min-width:36px; border-radius:18px; background:#fff; display:inline-flex; align-items:center; justify-content:center; gap:4px; padding:0; font-size:15px; font-weight:600; }
  #sub-btn.cont { padding:0 14px; border:1px solid var(--line); }
  #sub-btn[hidden] { display:none; }
  /* 输入条 */
  #bar { padding:8px 16px calc(env(safe-area-inset-bottom) + 12px); }
  #pill { display:flex; align-items:center; gap:12px; height:56px; padding:0 14px; border-radius:28px; background:#fff; border:1px solid var(--line); box-shadow:0 2px 10px #00000010; }
  #pill .ic { color:var(--ink); display:grid; place-items:center; width:32px; height:44px; }
  #mid { flex:1; min-width:0; min-height:44px; display:flex; align-items:center; font-size:17px; color:var(--dim); touch-action:none; }
  #typed { flex:1; min-width:0; font:inherit; font-size:18px; color:var(--ink); border:0; outline:0; background:none; -webkit-user-select:text; user-select:text; }
  #typed[hidden] { display:none; }
  #go { width:36px; height:36px; border-radius:50%; background:var(--ink); color:#fff; display:grid; place-items:center; }
  #go[hidden] { display:none; }
  /* 看录像(《家长录像设计.md》,只在家长端):底部换成控制条——进度条上一排点(开口 / 改卡 / 停下等孩子 / 没成),下面播放、钟点、推算、跳过空白、倍速、退出 */
  #reel { padding:2px 16px calc(env(safe-area-inset-bottom) + 12px); display:flex; flex-direction:column; gap:4px; }
  #reel[hidden] { display:none; }
  body.reel #bar, body.reel #lesson, body.reel #sub-btn { display:none; }
  /* 录像里的弹窗是孩子当时的样子:只看,点不动,没有关闭钮,跟着实录关 */
  body.reel #st-x, body.reel #st-act { display:none; }
  body.reel #st-body, body.reel #st-frame, body.reel #st-dim { pointer-events:none; }
  .rl-track { position:relative; height:34px; }
  #rl-seek { position:absolute; left:0; right:0; bottom:0; width:100%; height:24px; margin:0; accent-color:var(--accent); background:none; }
  #rl-marks { position:absolute; left:8px; right:8px; top:0; height:10px; }
  #rl-marks i { position:absolute; top:0; width:9px; height:9px; margin-left:-4.5px; border-radius:50%; cursor:pointer; }
  #rl-marks i::before { content:""; position:absolute; inset:-8px; }
  #rl-marks i.said { background:var(--accent); }
  #rl-marks i.card { background:#2fa36b; }
  #rl-marks i.ask { background:#5b3d86; border-radius:2px; transform:scale(.8); }
  #rl-marks i.error { background:#b3541e; border-radius:2px; }
  .rl-row { display:flex; align-items:center; gap:8px; font-size:14px; color:var(--dim); }
  .rl-when { flex:none; display:flex; flex-direction:column; align-items:flex-start; gap:1px; line-height:1.2; }
  #rl-play { flex:none; width:44px; height:44px; border-radius:50%; background:var(--ink); color:#fff; display:grid; place-items:center; }
  #rl-clock { font-variant-numeric:tabular-nums; color:var(--ink); font-size:15px; }
  #rl-tag { font-size:11px; border:1px solid var(--line); border-radius:7px; padding:0 6px; background:#fff; white-space:nowrap; }
  #rl-tag[hidden] { display:none; }
  .rl-sp { flex:1; }
  .rl-row .tx { flex:none; height:34px; padding:0 11px; border-radius:17px; white-space:nowrap; border:1px solid var(--line); background:#fff; font-size:14px; color:var(--ink); }
  /* 「跳过空白」是个开关(主流播放器的「跳过静音」都这样):滑块在右、底色填满 = 开着 */
  .rl-sw { flex:none; display:inline-flex; align-items:center; gap:6px; height:34px; font-size:14px; color:var(--ink); cursor:pointer; white-space:nowrap; }
  .rl-sw input { position:absolute; opacity:0; width:1px; height:1px; pointer-events:none; }
  .rl-sw i { position:relative; flex:none; width:36px; height:22px; border-radius:11px; background:var(--line); transition:background .15s; }
  .rl-sw i::after { content:""; position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#fff; box-shadow:0 1px 3px #00000033; transition:transform .15s; }
  .rl-sw input:checked + i { background:var(--accent); }
  .rl-sw input:checked + i::after { transform:translateX(14px); }
  .rl-sw input:focus-visible + i { outline:2px solid var(--accent); outline-offset:2px; }
  body.limit #pill, body.pending #pill { opacity:.45; pointer-events:none; }
  #hold { position:absolute; left:0; right:0; bottom:0; height:300px; background:linear-gradient(180deg,#3b82e800 0%,#3b82e8cc 45%,#2f6fd6 100%); display:none; flex-direction:column; align-items:center; justify-content:flex-end; gap:22px; padding-bottom:calc(env(safe-area-inset-bottom) + 70px); color:#fff; pointer-events:none; z-index:20; }
  #hold.on { display:flex; }
  #hold .w { display:flex; align-items:center; gap:3px; height:28px; }
  #hold .t { max-width:min(640px, 88%); font-size:20px; line-height:1.45; text-align:center; text-shadow:0 1px 2px #0003; }
  #hold .t:empty { display:none; }
  #hold.real .w i { animation:none; }
  #hold.wait .w { opacity:.3; }
  #hold.wait .w i { animation-play-state:paused; }
  #hold .w i { width:3px; border-radius:2px; background:#ffffffdd; animation:wave .8s ease-in-out infinite alternate; }
  @keyframes wave { from { transform:scaleY(.4); } to { transform:scaleY(1); } }
  #sheet { position:absolute; inset:0; display:none; z-index:30; }
  #sheet.on { display:block; }
  #sheet .dimmer { position:absolute; inset:0; background:#00000033; }
  #sheet .panel { position:absolute; left:0; right:0; bottom:0; background:var(--card); border-radius:22px 22px 0 0; padding:18px 20px calc(env(safe-area-inset-bottom) + 24px); display:flex; flex-direction:column; gap:14px; }
  #sheet .grab { width:40px; height:4px; border-radius:2px; background:var(--line); align-self:center; }
  #sheet .opts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
  #sheet label { display:flex; flex-direction:column; align-items:center; gap:8px; padding:18px 0; border-radius:16px; background:var(--paper); font-size:15px; font-weight:600; }
  input[type=file] { display:none; }
  /* 发照片屏(《作业照片设计.md》):看一眼、裁剪 / 圈画 / 转 90°、配一句话,再发 */
  #ps { position:absolute; inset:0; z-index:40; background:#1d1c1a; color:#fff; display:none; flex-direction:column; }
  #ps.on { display:flex; }
  #ps .view { position:relative; flex:1; min-height:0; display:flex; align-items:center; justify-content:center; padding:calc(env(safe-area-inset-top) + 12px) 16px 8px; }
  #ps .cv { position:relative; }
  #ps canvas { display:block; touch-action:none; }
  #ps.ps-drawing canvas { cursor:crosshair; }
  #ps-crop { position:absolute; inset:0; touch-action:none; }
  #ps-crop[hidden] { display:none; }
  #ps-crop .dim { position:absolute; background:#000000a0; pointer-events:none; }
  #ps-crop .fr { position:absolute; border:2px solid #fff; box-shadow:0 0 0 1px #0006; }
  #ps-crop .g { position:absolute; width:44px; height:44px; margin:-22px 0 0 -22px; }
  #ps-crop .g::after { content:""; position:absolute; left:13px; top:13px; width:18px; height:18px; border:0 solid #fff; }
  #ps-crop .nw { left:0; top:0; } #ps-crop .nw::after { border-width:4px 0 0 4px; left:20px; top:20px; }
  #ps-crop .ne { left:100%; top:0; } #ps-crop .ne::after { border-width:4px 4px 0 0; left:6px; top:20px; }
  #ps-crop .sw { left:0; top:100%; } #ps-crop .sw::after { border-width:0 0 4px 4px; left:20px; top:6px; }
  #ps-crop .se { left:100%; top:100%; } #ps-crop .se::after { border-width:0 4px 4px 0; left:6px; top:6px; }
  #ps-strip { display:flex; gap:10px; justify-content:center; padding:6px 16px; }
  #ps-strip:empty { display:none; }
  #ps-strip .t { position:relative; width:56px; height:56px; border-radius:10px; border:2px solid transparent; }
  #ps-strip .t.on { border-color:#fff; }
  #ps-strip .t img { width:100%; height:100%; object-fit:cover; border-radius:8px; display:block; }
  #ps-strip .x { position:absolute; top:-8px; right:-8px; width:24px; height:24px; border-radius:12px; background:#fff; color:#1d1c1a; display:grid; place-items:center; }
  #ps-strip .x::before { content:""; position:absolute; inset:-8px; }
  #ps .tools { display:flex; gap:10px; justify-content:center; padding:8px 16px; }
  #ps .tools[hidden] { display:none; }
  #ps .tools button { min-width:76px; height:48px; padding:0 14px; border-radius:24px; background:#ffffff1f; color:#fff; font-size:16px; font-weight:600; display:inline-flex; align-items:center; justify-content:center; gap:6px; }
  #ps .tools button.ok { background:#fff; color:#1d1c1a; }
  #ps .tools button:disabled { opacity:.35; }
  #ps-say { display:flex; align-items:center; gap:10px; margin:6px 16px 0; min-height:52px; padding:0 8px 0 18px; border-radius:26px; background:#fff; color:var(--ink); touch-action:none; }
  #ps-say[hidden] { display:none; }
  #ps-say.rec { background:#3b82e8; color:#fff; }
  #ps-said { flex:1; min-width:0; font-size:17px; line-height:1.4; padding:12px 0; }
  #ps-said.ph { color:var(--dim); }
  #ps-say.rec #ps-said { color:#fff; }
  #ps-typed { flex:1; min-width:0; font:inherit; font-size:18px; color:var(--ink); border:0; outline:0; background:none; -webkit-user-select:text; user-select:text; }
  #ps-typed[hidden], #ps-clear[hidden] { display:none; }
  #ps-clear { width:36px; height:36px; display:grid; place-items:center; color:var(--dim); }
  #ps .foot { display:flex; gap:12px; padding:12px 16px calc(env(safe-area-inset-bottom) + 14px); }
  #ps .foot[hidden] { display:none; }
  #ps .foot button { flex:1; height:54px; border-radius:27px; font-size:17px; font-weight:600; }
  #ps-cancel { background:#ffffff1f; color:#fff; }
  #ps-go { background:var(--accent); color:#fff; }
  #ps-go:disabled { opacity:.35; }
  /* 看大图:节头的小图点开;双指缩放、双击复位 */
  #lb { position:absolute; inset:0; z-index:40; background:#111; display:none; }
  #lb.on { display:block; }
  #lb .zoom { position:absolute; inset:0; overflow:hidden; display:flex; align-items:center; justify-content:center; touch-action:none; }
  #lb .zoom img { max-width:100%; max-height:100%; transform-origin:center; }
  #lb .x, #lb .nav { position:absolute; width:48px; height:48px; border-radius:24px; background:#ffffff26; color:#fff; display:grid; place-items:center; z-index:2; }
  #lb .x { top:calc(env(safe-area-inset-top) + 12px); right:16px; }
  #lb .nav { top:50%; margin-top:-24px; font-size:26px; line-height:1; }
  #lb .nav.l { left:12px; } #lb .nav.r { right:12px; }
  #lb .nav[hidden] { display:none; }
  #lb .n { position:absolute; left:0; right:0; bottom:calc(env(safe-area-inset-bottom) + 18px); text-align:center; color:#fffc; font-size:15px; z-index:2; pointer-events:none; }
  .sh .ph { cursor:zoom-in; }
  /* ---- 按压反馈(全局关了系统的点击高亮,这里统一补):三种手感,按下快(60ms)、松开慢(200ms)。
     圆钮与胶囊:缩到 94% + 暗一档;深色屏上的钮:缩 + 变淡;大块面:缩到 98.5% + 暗一点;行内文字:变淡。
     板书里的卡在滚动容器里,按下延迟 80ms 才显(不然一滑整屏都在闪);卡里的小钮按着时卡自己不动。交互不是皮肤,写在页面里,主题不用跟 ---- */
  #back, .tb .hb, #hist-x, #st-x, #st-go, #sub-btn, #pill .ic, #go, #back-today, .again, #ps-clear, .c-tutor .bt,
  #ps .tools button, #ps .foot button, #ps-strip .x, #lb .x, #lb .nav,
  #menu .panel button, #sheet label, #hist .tr, .so, .rd, .hz, .c-tutor .tt, #ps-strip .t,
  .sec.heard > .sh, #sub-text.line { transition:transform .2s ease-out, filter .2s ease-out, opacity .2s ease-out, background-color .2s ease-out; }
  #board .pend { display:none; }
  #lay-probe { position:fixed; left:-10000px; top:0; visibility:hidden; pointer-events:none; }
  #board .c { transition:transform .2s ease-out, filter .2s ease-out, border-color .2s, box-shadow .2s; }
  /* ---- 弹层进出场:遮罩淡入,面板按来的方向动(菜单从右上角放大、相册面板从底下滑上来、以前的从右边滑进、卡的弹窗与看大图轻轻放大、发照片屏上浮)。
     进场靠 @starting-style,退场靠 display 的 allow-discrete 过渡(Safari 18 起);不认的浏览器就是瞬间出现 / 消失,和以前一样。
     用 scale / translate 独立属性,不碰 transform(横屏的舞台已经用 transform 居中了)。关着的时候不收触摸,退场那 200ms 里点得到后面 ---- */
  #menu, #sheet, #hist, #ps, #lb, #stage, #st-dim { transition:opacity .2s ease-out, scale .24s cubic-bezier(.2,.8,.2,1), translate .24s cubic-bezier(.2,.8,.2,1), display .24s allow-discrete; }
  #menu:not(.on), #sheet:not(.on), #hist:not(.on), #ps:not(.on), #lb:not(.on), #stage:not(.on), #stage:not(.on) ~ #st-dim { pointer-events:none; }
  #menu .dimmer, #sheet .dimmer, #hist .dimmer { opacity:0; transition:opacity .2s ease-out; }
  #menu.on .dimmer, #sheet.on .dimmer, #hist.on .dimmer { opacity:1; }
  #menu .panel { opacity:0; scale:.9; transform-origin:top right; transition:opacity .16s ease-out, scale .24s cubic-bezier(.2,.8,.2,1); }
  #menu.on .panel { opacity:1; scale:1; }
  #sheet .panel { translate:0 100%; transition:translate .28s cubic-bezier(.2,.8,.2,1); }
  #sheet.on .panel { translate:0 0; }
  #hist .panel { translate:100% 0; transition:translate .28s cubic-bezier(.2,.8,.2,1); }
  #hist.on .panel { translate:0 0; }
  #stage, #lb { opacity:0; scale:.96; }
  #stage.on, #lb.on { opacity:1; scale:1; }
  #ps { opacity:0; translate:0 24px; }
  #ps.on { opacity:1; translate:0 0; }
  #st-dim { opacity:0; }
  #stage.on ~ #st-dim { opacity:1; }
  @starting-style {
    #menu.on .dimmer, #sheet.on .dimmer, #hist.on .dimmer, #stage.on ~ #st-dim { opacity:0; }
    #menu.on .panel { opacity:0; scale:.9; }
    #sheet.on .panel { translate:0 100%; }
    #hist.on .panel { translate:100% 0; }
    #stage.on, #lb.on { opacity:0; scale:.96; }
    #ps.on { opacity:0; translate:0 24px; }
  }
  @media (prefers-reduced-motion:reduce) { #menu, #sheet, #hist, #ps, #lb, #stage, #st-dim, #menu .dimmer, #sheet .dimmer, #hist .dimmer, #menu .panel, #sheet .panel, #hist .panel { transition:none; } }
  @media (hover:hover) {
    #back:hover, .tb .hb:hover, #hist-x:hover, #st-x:hover, #sub-btn:hover, #pill .ic:hover, #back-today:hover, .again:hover, #menu .panel button:hover, #sheet label:hover, #hist .tr:hover, .so:hover, .rd:hover, .c-tutor .bt:hover, #board .c:not(.c-tianzige):hover { filter:brightness(.97); }
  }
  #back:active, .tb .hb:active, #hist-x:active, #st-x:active, #st-go:active, #sub-btn:active, #pill .ic:active, #go:active, #back-today:active, .again:active, #ps-clear:active, .c-tutor .bt:active { transform:scale(.94); filter:brightness(.92); transition-duration:.06s; }
  #ps .tools button:active, #ps .foot button:active, #ps-strip .x:active, #lb .x:active, #lb .nav:active { transform:scale(.94); opacity:.65; transition-duration:.06s; }
  #menu .panel button:active, #sheet label:active, #hist .tr:active, .so:active, .rd:active, .hz:active, .c-tutor .tt:active, #ps-strip .t:active { transform:scale(.985); filter:brightness(.95); transition-duration:.06s; }
  #board .c:not(.c-tianzige):active:not(:has(button:active, .hz:active)) { transform:scale(.985); filter:brightness(.96); transition-duration:.06s; transition-delay:.08s; }
  .sec.heard > .sh:active:not(:has(button:active, .ph:active)), #sub-text.line:active { opacity:.55; transition-duration:.06s; }
  button:disabled, .hb.dim { opacity:.35; }
  button:disabled:active { transform:none; filter:none; }
  @media (prefers-reduced-motion:reduce) { #back, .tb .hb, .again, .so, .rd, .hz, #board .c, #hist .tr, #sheet label, #menu .panel button, #ps .tools button, #ps .foot button, .c-tutor .bt, .c-tutor .tt { transition:none; } *:active { transform:none !important; } }
  /* ---- 平板横屏 ---- */
  @media (min-width:900px) and (orientation:landscape) {
    #home { max-width:1040px; padding:calc(env(safe-area-inset-top) + 40px) 48px 40px; gap:24px; }
    #home h1 { font-size:22px; }
    #home .tutors { grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:18px; align-items:start; }
    #home .hcards { grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); }
    .tb.l { left:calc(env(safe-area-inset-left) + 20px); } .tb.r { right:calc(env(safe-area-inset-right) + 20px); }
    #menu .panel { right:calc(env(safe-area-inset-right) + 20px); }
    #board { width:100%; max-width:1040px; margin:0 auto; padding:calc(env(safe-area-inset-top) + 68px) 32px 24px; }
    #sub, #bar, #reel { width:100%; max-width:1040px; margin:0 auto; padding-left:32px; padding-right:32px; }
  }
</style>
<div id="home">
  <h1 id="title">__TITLE__</h1>
  <div class="tutors" id="tutors"></div>
  <p id="rest">老师们休息中</p>
  <a class="c c-figshot" id="figshot" hidden><span class="avs"></span><span class="tx"><b>给老师们换个样子</b><span>帽子、脸、衣服,都由你来挑</span></span><span class="go">去搭</span></a>
  <div class="hcards" id="hcards"></div>
</div>
<div id="toast"></div>
<section id="tutor">
  <div id="main">
    <div class="tb l"><button id="back" type="button" aria-label="回首页"><i id="back-ic"></i><span class="av" id="c-av"></span></button><span id="c-mo" hidden></span></div>
    <div class="tb r"><button class="hb" id="reel-btn" type="button" aria-label="看录像" title="看录像" hidden></button><button class="hb on" id="spk" type="button" aria-label="老师念不念"></button><button class="hb" id="more-btn" type="button" aria-label="更多"></button></div>
    <div id="wrap">
      <div id="board"></div>
      <div id="stage"><div class="top"><span class="ttl" id="st-ttl"></span><span class="kd" id="st-kd"></span><button id="st-x" type="button"></button></div><div id="st-body"></div><iframe id="st-frame" hidden title="stage"></iframe><div id="st-act" hidden><span class="note" id="st-note"></span><button id="st-go" type="button">交给老师</button></div></div>
      <div id="st-dim"></div>
    </div>
    <div id="lesson" hidden><div class="tx2"><b id="ls-n"></b><small id="ls-names"></small></div><button type="button" id="ls-try" hidden>试用</button><button type="button" id="ls-hand">交给孩子</button></div>
    <div id="sub"><span id="sub-text"></span><button id="sub-btn" type="button" hidden></button></div>
    <div id="bar">
      <div id="pill">
        <label class="ic" id="cam"><input type="file" accept="image/*" capture="environment"></label>
        <div id="mid"><span id="ph">发消息或按住说话…</span><input id="typed" type="text" autocomplete="off" hidden></div>
        <button id="go" type="button" hidden></button>
        <button class="ic" id="plus" type="button"></button>
      </div>
      <button id="back-today" type="button" hidden>回到今天</button>
    </div>
    <div id="reel" hidden>
      <div class="rl-track"><div id="rl-marks"></div><input id="rl-seek" type="range" min="0" max="1000" step="100" value="0" aria-label="录像进度"></div>
      <div class="rl-row"><button id="rl-play" type="button" aria-label="播放"></button><span class="rl-when"><span id="rl-clock"></span><button id="rl-tag" type="button">推算</button></span><span class="rl-sp"></span><label class="rl-sw" title="孩子想了很久、等老师很久的地方各压成 1.5 秒;关掉就按真实时间放"><input type="checkbox" id="rl-skip" role="switch" checked><i></i>跳过空白</label><button class="tx" id="rl-speed" type="button">1×</button><button class="tx" id="rl-x" type="button">退出</button></div>
    </div>
    <div id="hold"><div class="t"></div><span>松手发送,上移取消</span><div class="w"></div></div>
  </div>
  <div id="hist"><div class="dimmer"></div><div class="panel"><div class="hd"><span>以前的</span><button class="hb" id="hist-x" type="button"></button></div><div class="ls"></div></div></div>
  <div id="menu"><div class="dimmer"></div><div class="panel">
    <button type="button" id="hist-btn"><span class="ic"></span><span class="tx"><b>以前的</b><small>看看以前聊过的话题</small></span></button>
    <button type="button" id="new-btn" hidden><span class="ic"></span><span class="tx"><b>新话题</b><small>这个聊完了,换一个问</small></span></button>
  </div></div>
  <div id="trytag">试用 · 明天删</div>
  <div id="hand"><div class="dimmer"></div><div class="panel">
    <b id="hd-ttl">交给孩子</b>
    <small>老师写的这几节先写成一份课文件(lessons/ 里),再交给孩子:首页上这位老师多一个按钮,按下去看到的就是这几节,原样、不花钱。要挑卡、改字,去课文件里改,再交一次就覆盖</small>
    <label>按钮上的字(孩子看的,最多 16 个字)<input id="hd-label" maxlength="16" autocomplete="off"></label>
    <div id="hd-msg"></div>
    <div class="row"><button type="button" id="hd-cancel">算了</button><button type="button" id="hd-go">交给孩子</button></div>
  </div></div>
  <div id="sheet"><div class="dimmer"></div><div class="panel"><div class="grab"></div><div class="opts">
    <label><span class="ic" id="ic-album"></span>相册<input type="file" accept="image/*" multiple></label>
    <label><span class="ic" id="ic-cam2"></span>拍照<input type="file" accept="image/*" capture="environment"></label>
  </div></div></div>
  <div id="ps">
    <div class="view"><div class="cv"><canvas id="ps-cv"></canvas><div id="ps-crop" hidden><div class="dim"></div><div class="dim"></div><div class="dim"></div><div class="dim"></div><div class="fr" data-g="move"><span class="g nw" data-g="nw"></span><span class="g ne" data-g="ne"></span><span class="g sw" data-g="sw"></span><span class="g se" data-g="se"></span></div></div></div></div>
    <div id="ps-strip"></div>
    <div class="tools" id="ps-tools"><button type="button" id="ps-t-crop">裁剪</button><button type="button" id="ps-t-pen">圈画</button><button type="button" id="ps-t-rot">转 90°</button></div>
    <div class="tools" id="ps-crop-bar" hidden><button type="button" id="ps-c-full">整张</button><button type="button" class="ok" id="ps-c-ok">好了</button></div>
    <div class="tools" id="ps-pen-bar" hidden><button type="button" id="ps-p-undo">撤销</button><button type="button" id="ps-p-clear">清空</button><button type="button" class="ok" id="ps-p-ok">好了</button></div>
    <div id="ps-say"><span id="ps-said"></span><input id="ps-typed" type="text" autocomplete="off" enterkeyhint="done" hidden><button type="button" id="ps-clear" hidden></button></div>
    <div class="foot" id="ps-foot"><button type="button" id="ps-cancel">取消</button><button type="button" id="ps-go">发给老师</button></div>
  </div>
  <div id="lb"><div class="zoom"><img alt=""></div><button type="button" class="x" id="lb-x"></button><button type="button" class="nav l" id="lb-l">‹</button><button type="button" class="nav r" id="lb-r">›</button><div class="n" id="lb-n"></div></div>
</section>
<script>
(() => {
__BOARD_JS__
__PHOTO_JS__
__REEL_JS__

  /** 页面的模式:{} = 孩子端;parent = 家长板书页(数据走家长接口,只读,节间插旁注) */
  const MODE = __MODE__;
  const PARENT = MODE.parent === true;
  /** 对话接口的前缀(messages / photos / cards / history):家长端发的走家长接口(from: parent),一天的板书另有自己的路 */
  const CONV = PARENT ? '/api/conversations/' : '/api/kid/conversations/';
  const AUDIO = '/api/audio/';
  const AUTOPLAY_KEY = PARENT ? 'parent-autoplay' : 'kid-autoplay';
  const $ = (s) => document.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f);
      else if (v !== undefined && v !== null) el.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  };
  const SVG = (paths, size, sw) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  const ICON = {
    back: SVG('<path d="M15 5l-7 7 7 7"></path>', 28, 2.2),
    camera: SVG('<path d="M4 8h3l2-3h6l2 3h3v11H4z"></path><circle cx="12" cy="13" r="3.5"></circle>', 22),
    plus: SVG('<path d="M12 5v14M5 12h14"></path>', 22, 2.2),
    play: SVG('<path d="M8 5l11 7-11 7z" fill="currentColor"></path>', 16, 1.5),
    pause: SVG('<path d="M8 5v14M16 5v14"></path>', 16, 2.6),
    speaker: SVG('<path d="M4 10v4h4l5 4V6L8 10z"></path><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"></path>', 24),
    replay: SVG('<path d="M4 10v4h4l5 4V6L8 10z"></path><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"></path>', 16, 2),
    stop: SVG('<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"></rect>', 16, 1.5),
    mute: SVG('<path d="M4 10v4h4l5 4V6L8 10z"></path><path d="M17 9l4 6M21 9l-4 6"></path>', 24),
    send: SVG('<path d="M12 19V5M5 12l7-7 7 7"></path>', 20, 2.4),
    image: SVG('<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 16l5-5 4 4 3-3 6 6"></path><circle cx="16" cy="9" r="1.5"></circle>', 36, 1.6),
    album: SVG('<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 15l5-4 4 3 3-2 6 4"></path>', 28),
    close: SVG('<path d="M6 6l12 12M18 6L6 18"></path>', 24, 2.2),
    closeSm: SVG('<path d="M7 7l10 10M17 7L7 17"></path>', 14, 2.8),
    check: SVG('<path d="M5 12l5 5 9-10"></path>', 16, 3),
    mic: SVG('<rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"></path>', 44),
    lock: SVG('<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>', 14, 2.2),
    up: SVG('<path d="M12 19V5M6 11l6-6 6 6"></path>', 18, 2.4),
    more: SVG('<circle cx="5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="19" cy="12" r="1.6"></circle>', 24),
    history: SVG('<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path>', 24),
    again: SVG('<path d="M4 12a8 8 0 1 0 2.4-5.7"></path><path d="M4 4v4.5h4.5"></path>', 20, 2),
    start: SVG('<path d="M8 5l11 7-11 7z" fill="currentColor"></path>', 18, 1.5),
    reel: SVG('<rect x="3" y="5" width="18" height="14" rx="2.5"></rect><path d="M10 9.2l5 2.8-5 2.8z" fill="currentColor"></path>', 24, 1.8),
    spark: SVG('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"></path><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"></path>', 24, 1.8),
  };
  const api = async (method, path, body) => {
    const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    // 服务重起过(启动号变了)→ 记下,空下来自己重载(见 staleReload)
    const boot = r.headers.get('x-cotutor-boot');
    if (boot) { if (!bootId) bootId = boot; else if (boot !== bootId) stale = true; }
    if (!r.ok) { const e = new Error('http ' + r.status); e.status = r.status; try { e.body = await r.json(); } catch { e.body = null; } throw e; }
    return r.json();
  };
  let bootId = null, stale = false;
  const PALETTE = ['#e8743b', '#3b82e8', '#2fa36b', '#b45fd1', '#d9a520', '#e0508a'];
  const FIXED = { '语文': '#e0508a', '数学': '#3b82e8', '英语': '#2fa36b' };
  const color = (s) => { if (FIXED[s]) return FIXED[s]; let x = 0; for (const ch of s || '') x = (x * 31 + ch.codePointAt(0)) >>> 0; return PALETTE[x % PALETTE.length]; };
  const avatarEl = (t, cls) => {
    const el = h('span', { class: 'av ' + (cls || ''), style: 'border-color:' + color(t.subject || t.display) + ';color:' + color(t.subject || t.display) });
    if (t.avatar && /\.(png|jpe?g|webp|svg)$/i.test(t.avatar)) el.append(h('img', { src: '/api/kid/avatar/' + t.name, alt: '' }));
    else el.textContent = t.avatar || (t.subject || t.display || '?').slice(0, 1);
    return el;
  };
  const debug = new URLSearchParams(location.search);
  /** 试用页(《备课设计.md》§十二):?try=<老师>/<话题>,家长在孩子端扮孩子跑一遍家长端建的试用话题;只开这一个话题,发的都进它 */
  const TRY = (() => { const v = !PARENT && debug.get('try'); const i = v ? v.indexOf('/') : -1; return i > 0 ? { tutor: v.slice(0, i), thread: v.slice(i + 1) } : null; })();
  if (TRY) document.body.classList.add('tryout');

  // ---- 状态 ----
  const S = { home: null, tutor: null, day: null, sections: [], played: new Set(), unfold: new Set(), lq: null, state: { section: -1, line: -1, status: 'idle' }, replayOf: null, contGuard: 0, held: false, rec: null, submitted: new Set(), pending: false, waitSince: null, waitTimer: null, limit: false, offline: false, autoplay: true, bar: 'idle', pollTimer: null, stage: null, partial: null, thread: null, threadAt: null, hist: null, readonly: false, newThread: false, device: 'phone', via: null, cont: null, reel: null };
  // 家长板书页看的模式缺省不念(家长想听哪句点哪句);试用缺省念(要听效果);开关各记一个键,不和孩子的搅
  try { S.autoplay = PARENT ? localStorage.getItem(AUTOPLAY_KEY) === '1' : localStorage.getItem(AUTOPLAY_KEY) !== '0'; } catch { S.autoplay = !PARENT; }
  /** 家长板书页:清单的日期(null = 今天) */
  S.pdate = null;

  // ---- 声音:共享 Audio,首个手势解锁(iOS);没配音退回浏览器合成;都没有按字数计时 ----
  const audioEl = new Audio();
  let unlocked = false;
  // 老师的声已经放过(元素早解锁了)就不再放静音:换 src 会抢走正在念的那句,触发它的 onerror 退成浏览器的声重念(2026-10-04 真机:试用时点输入框,当前那句被浏览器重念一遍)。
  // 静音这一下被下一句的 src 打断(AbortError)也算解锁:手势里调过 play() 就够了;原来不算,之后每点一下输入框都会再抢一次
  const unlock = () => {
    if (unlocked) return;
    if (audioEl.src && !audioEl.src.startsWith('data:')) { unlocked = true; return; }
    try { audioEl.onended = audioEl.onerror = audioEl.onplaying = null; audioEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='; audioEl.play().then(() => { unlocked = true; }, (e) => { if (e && e.name === 'AbortError') unlocked = true; }); } catch {}
  };
  let voiceToken = 0;
  let guardTimer = null;
  /** 换了音源后定倍速(单词卡舞台慢放;看录像另有倍速):换 src 会把 playbackRate 重置成 defaultPlaybackRate,两个一起设;音高不变 */
  const audioRate = (r) => { audioEl.defaultPlaybackRate = r; audioEl.playbackRate = r; try { audioEl.preservesPitch = true; audioEl.webkitPreservesPitch = true; } catch {} };
  /** 只停声音。播放状态不在这里改——那走 dispatch(见下面「播放器」) */
  const silence = () => { voiceToken++; try { audioEl.pause(); } catch {} try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch {} };
  /** 念一句;念完调 onEnd(被打断不调);声音真开始时调 onStart(总时长毫秒:mp3 取 duration,合成声与没声音按字数估),给标注定时用 */
  const say = (line, onEnd, onStart) => {
    const token = ++voiceToken;
    const finish = () => { if (token === voiceToken) onEnd(); };
    let started = false;
    const start = (ms) => { if (!started && token === voiceToken) { started = true; if (onStart) onStart(ms); } };
    const fallback = () => { const ms = lineDurationMs(line.text); start(ms); setTimeout(finish, ms); };
    if (line.audio && S.tutor) {
      try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch {}
      // 退回合成声前先查 token:silence 的 pause 会让还没 resolve 的 play() 以 AbortError 拒掉,那不是「配音放不出来」,是被打断了(2026-09-12 真机复现:点「新话题」后合成声念旧话题那句)
      const fallbackVoice = () => { if (token === voiceToken) speak(plainLine(line.text), finish, fallback, start); };
      audioEl.onended = finish; audioEl.onerror = fallbackVoice;
      audioEl.onplaying = () => start(isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration * 1000 : lineDurationMs(line.text));
      audioEl.src = AUDIO + S.tutor.name + '/' + line.audio.split('/').map(encodeURIComponent).join('/');
      audioRate(1);
      audioEl.play().catch(fallbackVoice);
    } else speak(plainLine(line.text), finish, fallback, start);
  };
  const speak = (text, onEnd, onFail, onStart, opts) => {
    try {
      if (!('speechSynthesis' in window)) return onFail();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text); u.lang = (opts && opts.lang) || 'zh-CN'; u.rate = (opts && opts.rate) || 0.95;
      let ended = false;
      u.onstart = () => { if (onStart) onStart(lineDurationMs(text)); };
      u.onend = () => { if (!ended) { ended = true; onEnd(); } };
      u.onerror = () => { if (!ended) { ended = true; onFail(); } };
      speechSynthesis.speak(u);
      // 有的浏览器不发 onend:兜一个按字数的上限
      setTimeout(() => { if (!ended) { ended = true; onEnd(); } }, lineDurationMs(text) * 2 + 1500);
    } catch { onFail(); }
  };

  // ---- 首页(《首页设计.md》):老师卡在上,其余卡照发布的顺序;按钮决定进老师页之后的话题 ----
  const BUTTON_ICON = { new: 'spark', start: 'start', continue: 'again' };
  let toastTimer = null;
  const toast = (text) => { const t = $('#toast'); t.textContent = text; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 4000); };
  const pickButton = (t, b) => {
    const via = { home: S.home.home, button: b.id };
    if (b.kind === 'new') openTutor(t, { kind: 'new', via });
    else if (b.id === 'recent') openTutor(t, { kind: 'thread', thread: b.thread, via });
    else if (b.kind === 'start') openTutor(t, { kind: 'new', via, send: b.label });
    // 家长交给孩子的备课话题(《备课设计.md》§4.2):只打开、不发字,从开场第一句播,末句问句停;孩子自己说的才是第一句
    else if (b.open) openTutor(t, { kind: 'thread', thread: b.thread, via, play: true });
    else if (b.date === S.home.date) openTutor(t, { kind: 'thread', thread: b.thread, via, send: b.label });
    else openTutor(t, { kind: 'new', via, send: b.label, cont: b.date });
  };
  const tutorCard = (t, buttons) => {
    const first = buttons.find((b) => b.kind === 'new');
    return h('div', { class: 'c c-tutor' + (t.available ? '' : ' off'), 'data-tutor': t.name, style: 'border-color:' + color(t.subject || t.display) },
      h('div', { class: 'tt', on: { click: () => { if (first) pickButton(t, first); } } }, avatarEl(t), h('span', { class: 'nm' }, t.display)),
      h('div', { class: 'bts' }, ...buttons.map((b) => h('button', { type: 'button', class: 'bt bt-' + b.kind, on: { click: () => pickButton(t, b) } }, h('span', { class: 'bi', html: ICON[BUTTON_ICON[b.kind]] }), h('span', {}, b.label)))));
  };
  const renderHome = () => {
    const H = S.home;
    document.title = H.title; $('#title').textContent = H.title;
    const byName = new Map(H.tutors.map((t) => [t.name, t]));
    const cards = Array.isArray(H.cards) ? H.cards : [];
    const tcards = cards.filter((c) => c.kind === 'tutor' && byName.has(c.props.tutor));
    $('#tutors').replaceChildren(...tcards.map((c) => tutorCard(byName.get(c.props.tutor), Array.isArray(c.props.buttons) ? c.props.buttons : [])));
    $('#hcards').replaceChildren(...cards.filter((c) => c.kind !== 'tutor').map((c, i) => renderCard(c, i, null, false)));
    renderFigshot(H);
  };
  // 给老师换样子(figshot pick):同一台电脑、同一张证书,所以协议和主机跟着本页走,只换端口。
  // 先探一下它开没开 —— 没开时点进去是 Safari 的「无法连接」,孩子不该看到;no-cors 只看连不连得上
  const renderFigshot = (H) => {
    const el = $('#figshot');
    if (!H.figshot) { el.hidden = true; return; }
    const url = location.protocol + '//' + location.hostname + ':' + H.figshot.port + '/';
    el.href = url;
    el.querySelector('.avs').replaceChildren(...H.tutors.slice(0, 3).map((t) => avatarEl(t)));
    fetch(url + 'api/health', { mode: 'no-cors', cache: 'no-store' }).then(() => { el.hidden = false; }, () => { el.hidden = true; });
  };
  const loadHome = async () => {
    try { S.home = await api('GET', PARENT ? '/api/overview/' + (S.pdate || 'today') : '/api/kid/home'); setOffline(false); if (PARENT) renderOverview(); else renderHome(); }
    catch { setOffline(true); }
  };
  // ---- 家长板书页的清单(《家长板书页设计.md》§2.2):日期、每位老师一块、一行一个话题,点了进板书 ----
  const shiftDate = (date, n) => { const [y, m, d] = date.split('-').map(Number); const t = new Date(y, m - 1, d + n); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
  const renderOverview = () => {
    const H = S.home;
    document.title = H.title + ' · 家长'; $('#title').textContent = H.title;
    // 有按钮正在「确定?」那一下(删、记账),这一轮心跳先不重画,免得把它抹掉
    if ($('#home .arm')) return;
    let bar = $('#pdate');
    if (!bar) { bar = h('div', { id: 'pdate' }); $('#title').after(bar); }
    const go = (n) => { S.pdate = shiftDate(H.date, n); if (S.pdate === H.today) S.pdate = null; loadHome(); };
    // 记账(《obsidian仓库设计.md》§4,原来只在工作台):这天每位老师还没记过的话题各起一轮,老师回「## 记账」段,应用写日记。花钱,所以两下确认;老师在写或在记就灰
    const booking = H.tutors.some((t) => t.booking);
    const writing = H.tutors.some((t) => t.threads.some((th) => th.stoppedAt === 'writing'));
    const bookable = H.tutors.some((t) => t.threads.some((th) => !th.booked && th.sections > 0));
    const bookBtn = h('button', { type: 'button', class: 'book', disabled: booking || writing || !bookable ? '' : null }, booking ? '记账中…' : '记账');
    let bookTimer = null;
    bookBtn.addEventListener('click', async () => {
      if (!bookBtn.classList.contains('arm')) { bookBtn.classList.add('arm'); bookBtn.textContent = '确定记?要花钱'; bookTimer = setTimeout(() => { bookBtn.classList.remove('arm'); bookBtn.textContent = '记账'; }, 4000); return; }
      clearTimeout(bookTimer); bookBtn.classList.remove('arm'); bookBtn.disabled = true; bookBtn.textContent = '记账中…';
      let n = 0;
      for (const t of H.tutors) {
        if (!t.threads.some((th) => !th.booked && th.sections > 0)) continue;
        try { const r = await api('POST', '/api/conversations/' + encodeURIComponent(t.name) + '/' + H.date + '/bookkeep', {}); n += (r.queued || []).length; } catch {}
      }
      toast(n ? '记 ' + n + ' 个话题,老师在写;记好了行上会亮「已记账」' : '没有要记的话题');
      loadHome();
    });
    bar.replaceChildren(h('button', { type: 'button', 'aria-label': '前一天', on: { click: () => go(-1) } }, '‹'), h('b', {}, dateLabel(H.date, H.today) + (H.date === H.today ? '' : ' ' + H.date.slice(5).replace('-', '/'))), h('button', { type: 'button', 'aria-label': '后一天', disabled: H.date >= H.today ? '' : null, on: { click: () => go(1) } }, '›'), bookBtn);
    const stopped = (t) => (t.stoppedAt === 'writing' ? ' · 老师在写' : t.stoppedAt === 'ask' ? ' · 停下等孩子' : '');
    // 打星(《obsidian仓库设计.md》§4:单位是话题,够 keepScore 记账时才沉淀摘要):行尾五颗,点同一颗取消;记账仍在家长端(这段注释也在孩子端的 html 里,别写家长端的路径)
    const rate = async (t, th, i) => { try { await api('PUT', '/api/conversations/' + encodeURIComponent(t.name) + '/' + H.date + '/threads/' + encodeURIComponent(th.thread) + '/rating', { rating: th.rating === i ? null : i }); } catch {} loadHome(); };
    const stars = (t, th) => h('div', { class: 'stars', 'aria-label': '打星' }, ...[1, 2, 3, 4, 5].map((i) => h('span', { class: 'st' + (th.rating && i <= th.rating ? ' on' : ''), on: { click: (e) => { e.stopPropagation(); rate(t, th, i); } } }, '★')));
    // 删掉一个话题:行角上一个「删」,点一下变「确定删?」(3 秒内再点才真删,没有弹窗);老师还在写的服务端会 409,行留着。已记进日记和记忆的不会跟着没
    const delBtn = (kind, t, th) => {
      const b = h('button', { type: 'button', class: 'del', 'aria-label': '删掉这个话题' }, '删');
      let timer = null;
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = '确定删?'; timer = setTimeout(() => { b.classList.remove('arm'); b.textContent = '删'; }, 3000); return; }
        clearTimeout(timer); b.classList.remove('arm'); b.disabled = true; // 先摘掉 arm:renderOverview 见到 .arm 会跳过重画
        try { await api('DELETE', '/api/' + kind + '/' + encodeURIComponent(t.name) + '/' + H.date + '/threads/' + encodeURIComponent(th.thread)); } catch {}
        loadHome();
      });
      return b;
    };
    // 家长自己开的话题(备课,《备课设计.md》):孩子开口前标「备课」,交了标「已交给孩子」
    const prepTag = (th) => (th.tryout ? h('span', { class: 'pin', title: '家长在孩子端试的,明天删' }, '试用') : !th.prep ? null : h('span', { class: 'pin' }, th.handedAs !== null ? '已交给孩子' + (th.handedAs ? ':' + th.handedAs : '') : '备课 · 孩子看不到'));
    const row = (t, th) => h('div', { class: 'tr', on: { click: () => openTutor(t, { kind: 'thread', thread: th.thread, date: H.date }) } },
      h('b', {}, th.title || '(没有话)', prepTag(th)),
      h('small', {}, clock(th.at) + ' · ' + th.sections + ' 节 · ' + th.cards + ' 张卡' + stopped(th) + (th.booked ? ' · 已记账' : t.booking && th.sections > 0 ? ' · 记账中' : '')),
      th.tryout ? null : stars(t, th), th.stoppedAt === 'writing' ? null : delBtn('conversations', t, th));
    // 新话题(《备课设计.md》§3.1):家长自己和老师聊——试改过的老师文件与 vault、备今天的课;孩子开口前孩子看不到、不写记忆
    // 试用(《备课设计.md》§十二):没备课,家长到孩子端当一回孩子直接问;孩子看不到,明天删。课文件的试用在课文件页
    const tryBtn = (t) => (H.date !== H.today ? null : h('button', { type: 'button', class: 'try lite', title: '当一回孩子:没备课直接问,看老师怎么接;孩子看不到,明天删', on: { click: () => { location.href = '/?try=' + encodeURIComponent(t.name) + '/new'; } } }, '试用'));
    const newBtn = (t) => (H.date !== H.today ? null : h('button', { type: 'button', class: 'try', title: '和老师备课、试试改过的老师文件;孩子看不到,满意了在某一节尾点「从这里给孩子」', on: { click: () => openTutor(t, { kind: 'new' }) } }, '新话题'));
    // 课文件(《备课设计.md》§10.6):今天这位老师的每一份一行,点了整份铺开看
    const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return !isFinite(m) ? '' : m < 1 ? '刚改的' : m < 60 ? m + ' 分钟前改的' : m < 1440 ? Math.round(m / 60) + ' 小时前改的' : Math.round(m / 1440) + ' 天前改的'; };
    const lsnRow = (t, l) => h('div', { class: 'tr lsn', on: { click: () => openLesson(t, l.name) } },
      h('b', {}, l.name, h('span', { class: 'pin' + (l.fixes ? ' bad' : l.handedAs !== null ? ' ok' : '') }, l.fixes ? l.fixes + ' 条要改' : l.handedAs !== null ? '已交给孩子' + (l.handedAs ? ':' + l.handedAs : '') : '还没交')),
      h('small', {}, l.sections + ' 节 · ' + l.cards + ' 张卡' + (l.fromThread ? ' · 从备课话题写出来的' : '') + (l.mtime ? ' · ' + ago(l.mtime) : '')));
    $('#tutors').replaceChildren(...H.tutors.map((t) => h('div', { class: 'pt', 'data-tutor': t.name },
      h('div', { class: 'hd' }, avatarEl(t), h('div', { class: 'who' }, h('span', { class: 'nm' }, t.display), t.turns ? h('small', {}, h('span', {}, t.turns + ' 轮'), ...(t.kouboYuan ? [' ', h('span', {}, '· koubo ¥' + t.kouboYuan.toFixed(2))] : [])) : null), tryBtn(t), newBtn(t)),
      ...(t.threads.length ? t.threads.map((th) => row(t, th)) : [h('div', { class: 'none' }, H.date === H.today ? '今天没聊' : '这天没聊')]),
      ...(t.lessons && t.lessons.length ? [h('div', { class: 'tt' }, '课文件 · lessons/'), ...t.lessons.map((l) => lsnRow(t, l))] : []))));
    $('#hcards').replaceChildren();
  };
  const setOffline = (off) => {
    if (S.offline === off) return;
    S.offline = off;
    document.body.classList.toggle('offline', off);
    if (off && S.tutor) closeTutor();
  };

  // ---- 老师页 ----
  /**
   * intent(首页的按钮定的):new = 空白新话题;thread = 今天的那个话题;today = 今天的当前话题(调试入口 ?tutor=)。
   * via = 哪个按钮(下一条消息带上);send = 打开就发出去的字(开场 / 接着按钮);cont = 接着的是哪天(头部写「接着 9 月 16 日」)
   */
  const openTutor = (t, intent) => {
    unlock();
    intent = intent || { kind: 'new' };
    S.lsn = null; stopListen();
    S.tutor = t; if (!PARENT || intent.kind === 'new') micWarm(); S.sections = []; S.played = new Set(); S.unfold = new Set(); S.lq = null; dispatch({ type: 'reset' }); S.pending = false; S.limit = false; S.stage = null; S.partial = null; $('#stage').classList.remove('on');
    S.thread = intent.kind === 'thread' ? intent.thread : null; S.threadAt = null; S.hist = null; S.readonly = false; S.newThread = intent.kind === 'new';
    S.via = intent.via || null; S.cont = intent.cont || null;
    // 家长端:孩子的话题卡锁着(选择 / 填空 / 画板不开、没有「继续」),看的是清单上那天的;
    // 家长自己开的备课话题(新话题、或孩子还没开口的)像孩子端一样能做卡、按继续——哪个话题是,loadDay 按接口的 prep 定
    if (PARENT) {
      if (intent.kind === 'new') { S.readonly = false; S.hist = null; }
      else { S.readonly = true; S.newThread = false; S.hist = intent.date || S.pdate || null; }
      S.prep = null; S.lesson = null; S.tryout = false;
    }
    $('#hist').classList.remove('on'); $('#menu').classList.remove('on'); renderBar(); renderHeader();
    $('#c-av').replaceWith(Object.assign(avatarEl(t), { id: 'c-av' }));
    $('#board').replaceChildren();
    if (S.newThread && !intent.send) $('#board').append(blankBoard('想问什么?'));
    $('#tutor').classList.add('on');
    setBar('idle');
    loadDay(!intent.play).then(() => { if (intent.send) send(intent.send); });
  };
  /** 空板:没有顶栏了,老师是谁写在这里(头像、名字、口头禅),下面才是「想问什么」 */
  const blankBoard = (title) => h('div', { class: 'blank' }, S.tutor ? avatarEl(S.tutor) : null, S.tutor ? h('span', { class: 'nm' }, S.tutor.display) : null, S.tutor && S.tutor.motto ? h('span', { class: 'mo' }, S.tutor.motto) : null, h('b', {}, title), S.tutor && S.tutor.firstQuestion ? h('small', {}, '比如:' + S.tutor.firstQuestion) : null);
  const closeTutor = () => { reelStop(); clearTimeout(S.pollTimer); dispatch({ type: 'halt' }); psClose(); S.lsn = null; stopListen(); $('#menu').classList.remove('on'); $('#lb').classList.remove('on'); S.tutor = null; S.via = null; S.cont = null; $('#tutor').classList.remove('on'); document.body.classList.remove('pending', 'limit'); loadHome(); };
  // 试用页是从家长端课文件页跳来的:退回去(孩子端页面里不写家长端的路径);直接打开的没处退,回首页
  $('#back').addEventListener('click', () => { if (!TRY) closeTutor(); else if (history.length > 1) history.back(); else location.replace('/'); });
  $('#back-ic').innerHTML = ICON.back;

  // 卡片:按 kind 分支(轻插件内联;不认识的 kind 把 props 里的字都显示出来)。紧凑态只读,点了开舞台;stage=true 是舞台里的画法
  const renderCard = (c, idx, secIdx, stage) => {
    const p = c.props || {};
    // 每张卡带底色槽与字形槽(围栏行上写的 look,没有就机械规则);名字对不上主题的,CSS 落回 paper / plain
    const board = !stage && secIdx !== null;
    const box = (cls, ...kids) => h('div', { class: 'c c-' + cls, 'data-card': idx, 'data-tint': tintFor(c), 'data-look': lookFor(c), on: board ? { click: () => openStage(secIdx, idx) } : {} }, ...kids, board ? againBtn() : null);
    switch (c.kind) {
      case 'text': {
        if (isHeading(c)) return h('div', { class: 'heading', 'data-card': idx }, p.title || '');
        const emoji = c.look && c.look.emoji ? c.look.emoji + ' ' : '';
        const title = p.title ? h('div', { class: 'ct' }, emoji + p.title) : null;
        const body = p.text ? h('div', { class: 'cb' }, p.text) : null;
        // 提问卡:末句那一问(解析器补的),和选择题的问题一个字重
        return box(isAskCard(c) ? 'text c-ask' : 'text', title, body);
      }
      case 'read':
        return box('read', ...(p.segments || []).map((seg, k) => h('div', { class: 'rd', on: { click: (e) => { e.stopPropagation(); readSegment(e.currentTarget, c, k, seg); } } }, seg)));
      case 'image': {
        const src = /^https?:\\/\\//.test(p.src || '') ? p.src : '/api/kid/image?p=' + encodeURIComponent(p.src || '');
        if (stage) { const el = box('image'); el.className = 'zoom'; el.append(h('img', { src, alt: p.caption || '' })); pinch(el); return el; }
        return box('image', h('img', { src, alt: '', loading: 'lazy' }), p.caption ? h('div', { class: 'cap' }, p.caption) : null);
      }
      case 'choice': {
        const picked = (c.state && Array.isArray(c.state.picked)) ? c.state.picked : [];
        if (stage) return box('choice', h('div', { class: 'sq' }, p.question || ''), ...(p.options || []).map((o, i) => h('button', { type: 'button', class: 'so' + (picked.includes(i) ? ' on' : ''), on: { click: () => pick(secIdx, idx, i) } }, h('i', {}, picked.includes(i) ? h('span', { html: ICON.check }) : 'ABCDEFGH'[i] || ''), o)));
        // 选项都短(≤ 4 个字)就横排成一行胶囊,不然三个一位数的答案各占一整行(2026-09-11 截图)
        const short = (p.options || []).length > 0 && (p.options || []).every((o) => Array.from(String(o)).length <= 4);
        return box('choice', h('div', { class: 'ch-q' }, p.question || ''), h('div', { class: 'ch-os' + (short ? ' short' : '') }, ...(p.options || []).map((o, i) => h('div', { class: 'ch-o' + (picked.includes(i) ? ' on' : '') }, h('i', {}, 'ABCDEFGH'[i] || ''), o))));
      }
      case 'fill': {
        // 句子与空放在一个 .cb 里(卡本身是 flex 列,直接塞文字节点会一段一行)
        const body = h('div', { class: 'cb' });
        const el = box('fill', body);
        const parts = String(p.text || '').split(/_{2,}/);
        const got = filledAnswers(c);
        if (stage) {
          body.classList.add('fq');
          parts.forEach((t, i) => { body.append(t); if (i < parts.length - 1) body.append(h('input', { class: 'fi', type: 'text', value: got[i] || '', autocomplete: 'off', enterkeyhint: 'done', on: { input: (e) => fillIn(secIdx, idx, i, e.target.value), keydown: (e) => { if (e.key === 'Enter') e.target.blur(); }, click: (e) => e.stopPropagation() } })); });
          return el;
        }
        parts.forEach((t, i) => { body.append(t); if (i < parts.length - 1) body.append(h('span', { class: 'bl' + (got[i] ? ' f' : '') }, got[i] || '\\u200b')); });
        return el;
      }
      case 'scene': {
        const ready = sceneReady(c);
        const n = Array.isArray(p.steps) ? p.steps.length : 0;
        const thumb = ready && p.thumb ? h('img', { src: '/api/kid/image?p=' + encodeURIComponent(p.thumb), alt: '' }) : null;
        return box('scene', p.problem ? h('div', { class: 'sp' }, p.problem) : (p.title ? h('div', { class: 'sp' }, p.title) : null), h('div', { class: 'th' }, thumb || (ready ? '' : '图还在路上'), ready ? h('span', { class: 'pl' }, (n ? n + ' 步 ' : '') + '▷') : null), p.text ? h('div', { class: 'tx' }, p.text) : null);
      }
      case 'material': {
        // 素材卡(《备课设计.md》§11.3):家长备好的现成动画,一段一个 mp4、不出声;舞台里播完停在末帧,下面一排段号
        const ready = materialReady(c);
        const n = ready ? p.segments : 0;
        if (stage) {
          if (!ready) return h('div', { class: 'c c-material mt-stage', 'data-card': idx }, h('div', { class: 'th' }, '动画还没放进来'));
          const v = h('video', { playsinline: '', 'webkit-playsinline': '', preload: 'auto' });
          v.muted = true;
          v.addEventListener('ended', materialEnded);
          const segs = n > 1 ? h('div', { class: 'segs' }, ...Array.from({ length: n }, (_, k) => h('button', { type: 'button', 'data-seg': String(k + 1), on: { click: () => playMaterial(k + 1, true) } }, String(k + 1)))) : null;
          return h('div', { class: 'c c-material mt-stage', 'data-card': idx }, v, segs, p.text ? h('div', { class: 'tx' }, p.text) : null);
        }
        const thumb = ready ? h('video', { src: materialSrc(p.id, 1) + '#t=0.1', playsinline: '', preload: 'metadata' }) : null;
        if (thumb) thumb.muted = true;
        return box('material', h('div', { class: 'sp' }, p.title || p.id || ''), p.text ? h('div', { class: 'tx' }, p.text) : null, h('div', { class: 'th' }, thumb || '动画还没放进来', ready ? h('span', { class: 'pl' }, n + ' 段 ▷') : null));
      }
      case 'canvas': {
        const n = inkCount(c);
        // 交过了:紧凑态是孩子画的那张图(真服务给 png 的相对路径,mock 存的是 data URL)
        const img = c.state && typeof c.state.image === 'string' ? c.state.image : null;
        // 照片做底、还没交过:卡上先是那张照片(淡一档)
        const base = !img && p.base && typeof p.base.image === 'string' ? p.base.image : null;
        const src = img ? (img.startsWith('data:') ? img : '/api/kid/image?p=' + encodeURIComponent(img)) : base ? '/api/kid/image?p=' + encodeURIComponent(base) : null;
        return box('canvas', h('div', { class: 'cp' }, p.prompt || '画一画'), src ? h('div', { class: 'th' + (base ? ' base' : '') }, h('img', { src, alt: '', loading: 'lazy' }), h('span', { class: 'pl' }, n ? '画了 ' + n + ' 笔' : '点开画一画 ✎')) : h('div', { class: 'cb' }, n ? '已经画了 ' + n + ' 笔,点开接着画' : '点开画一画 ✎'));
      }
      case 'record': {
        // 录音卡(《口播老师设计.md》§2–3):紧凑态只读(句子、风险字、听、录没录);舞台里按住录。卡上永远没有分数、没有判
        const pinyin = p.mode === 'pinyin';
        const shown = p.show || (pinyin ? toneMarks(p.text || '') : p.text || '');
        const risk = new Set(p.risk || []);
        const t = h('div', { class: 'rc-t' + (Array.from(shown).length > 10 ? ' long' : '') }, ...Array.from(shown).map((ch, i) => (risk.has(i) ? h('span', { class: 'rk' }, ch) : ch)));
        const py = pinyin && p.show ? h('div', { class: 'rc-py' }, toneMarks(p.text || '')) : null;
        const sec = recordSeconds(c);
        // 锁住 = 交了或后面又有一节(压淡、不能再录);只读(以前的、家长端)只是不能录,不画成锁住
        const locked = secIdx !== null && recordLocked(S.sections, secIdx, S.submitted);
        if (stage) return recordStage(c, idx, secIdx, t, py, sec, locked || S.readonly);
        const demo = locked ? null : recPill(ICON.speaker, '听', (e) => playDemo(c, e.currentTarget));
        const mine = sec ? recPill(ICON.play, '我的 · ' + sec.toFixed(1) + ' 秒', (e) => playMine(c, e.currentTarget)) : h('span', { class: 'rc-no' }, S.readonly ? '没录' : '没录 · 点开来录');
        const el = box('record', t, py, h('div', { class: 'rc-row' }, demo, mine, locked && sec ? h('span', { class: 'rc-lk', html: ICON.lock + '交给老师了' }) : null));
        if (locked && !PARENT) el.classList.add('locked');
        // 家长端:评测全量挂在卡里(只读的虚线框);孩子端拿不到 heard,永远画不出来
        if (PARENT && c.heard) el.append(heardBox(c.heard));
        return el;
      }
      case 'code':
        return box('code', p.lang ? h('span', { class: 'lg' }, p.lang) : null, h('div', { class: 'cb' }, p.text || ''));
      case 'tianzige': {
        // 轻卡,没有舞台:点字就写,不开舞台;讲到它时 setNow 写一遍
        const el = h('div', { class: 'c c-tianzige', 'data-card': idx, 'data-tint': tintFor(c), 'data-look': lookFor(c), 'data-ch': String(p.chars || '') });
        for (const ch of Array.from(String(p.chars || ''))) el.append(tianzigeBox(ch));
        if (board) el.append(againBtn());
        return el;
      }
      case 'word': {
        // 单词卡:四线三格里写这个词,卡上没有中文;点卡开舞台(慢念、分段慢写),「听」按正常速度念;讲到它时 setNow 写一遍
        if (stage) return wordStage(c, idx);
        const em = p.emoji || (c.look && c.look.emoji) || '';
        const el = box('word', em ? h('span', { class: 'we' }, em) : null, wordGrid(String(p.word || ''), null), h('div', { class: 'wd-row' }, recPill(ICON.speaker, '听', (e) => wordSay(c, e.currentTarget, 1))));
        el.dataset.w = String(p.word || '');
        return el;
      }
      default:
        return box('text', h('div', { class: 'cb' }, cardTexts(c).filter(Boolean).join('\\n')));
    }
  };
  // ---- 田字格卡:每字一个格,笔顺数据 /api/kid/tianzige/<字>(1024 见方、y 向上,组上 scale(1,-1) translate(0,-900) 摆正);
  // 写 = 每一笔的中线用粗线沿着描、外面套这一笔的轮廓做 clipPath,stroke-dashoffset 从头长到尾,和线条笔一个手法;数据没有的字只显示字形不动 ----
  const HZ = new Map();
  const tianzigeData = (ch) => { if (!HZ.has(ch)) HZ.set(ch, fetch('/api/kid/tianzige/' + encodeURIComponent(ch)).then((r) => (r.ok ? r.json() : null)).catch(() => null)); return HZ.get(ch); };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => { const el = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v)); return el; };
  const polyLen = (pts) => { let n = 0; for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return n; };
  const HZ_T = 'scale(1,-1) translate(0,-900)';
  /** 一个格:田字格 + 字形(数据到了是淡灰的轮廓,写完变墨色;没数据是字体的字,不动)+ 右下角几画 */
  const tianzigeBox = (ch) => {
    const svg = sv('svg', { viewBox: '0 0 1024 1024' });
    const grid = sv('g', { class: 'grid' });
    grid.append(sv('rect', { x: 8, y: 8, width: 1008, height: 1008, rx: 36 }), sv('line', { class: 'mid', x1: 512, y1: 8, x2: 512, y2: 1016 }), sv('line', { class: 'mid', x1: 8, y1: 512, x2: 1016, y2: 512 }));
    svg.append(grid);
    const el = h('div', { class: 'hz', 'data-ch': ch, on: { click: (e) => { e.stopPropagation(); tianzigePlay(el.closest('.c'), el); } } }, svg);
    tianzigeData(ch).then((d) => {
      if (!d) { const t = sv('text', { x: 512, y: 512, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 720, class: 'ghost done' }); t.textContent = ch; svg.append(t); return; }
      const g = sv('g', { class: 'ghost' + (el._want || el._queued ? '' : ' done'), transform: HZ_T }); // 排着队等写的,数据到了也先淡着
      for (const st of d.strokes) g.append(sv('path', { d: st }));
      svg.append(g);
      el.append(h('span', { class: 'n' }, d.strokes.length + ' 画'));
      el._hz = d;
      if (el._want) tianzigeWrite(el);
    });
    return el;
  };
  /** 回到写完的样子(打断正在写的) */
  const tianzigeReset = (el) => {
    if (el._run) el._run.stop();
    el._run = null; el._then = null; el._want = false; el._queued = false;
    for (const x of el.querySelectorAll('.ink, .clip')) x.remove();
    const ghost = el.querySelector('.ghost'); if (ghost) ghost.classList.add('done');
  };
  /** 写一个字:一笔接一笔,写完调 el._then;数据还没到就记着,到了再写 */
  const tianzigeWrite = (el) => {
    const d = el._hz;
    if (!d) { el._want = true; return; }
    const then = el._then; tianzigeReset(el); el._then = then;
    const svg = el.querySelector('svg');
    const ghost = svg.querySelector('.ghost'); ghost.classList.remove('done');
    const id = 'hz' + Math.random().toString(36).slice(2, 8);
    const defs = sv('defs', { class: 'clip' });
    const ink = sv('g', { class: 'ink', transform: HZ_T });
    const strokes = d.strokes.map((st, i) => {
      const cp = sv('clipPath', { id: id + '-' + i }); cp.append(sv('path', { d: st })); defs.append(cp);
      const pts = d.medians[i] || [];
      const len = Math.round(polyLen(pts)) + 200; // 圆头两端各多出半个笔宽
      const path = sv('path', { d: 'M' + pts.map((q) => q[0] + ' ' + q[1]).join(' L'), 'clip-path': 'url(#' + id + '-' + i + ')' });
      path.style.strokeDasharray = String(len); path.style.strokeDashoffset = String(len);
      ink.append(path);
      return { path, len };
    });
    svg.append(defs, ink);
    let i = 0, timer = null, alive = true;
    el._run = { stop: () => { alive = false; clearTimeout(timer); } };
    const step = () => {
      if (!alive) return;
      if (i >= strokes.length) { ghost.classList.add('done'); ink.remove(); defs.remove(); el._run = null; el._queued = false; const f = el._then; el._then = null; if (f) f(); return; }
      const { path, len } = strokes[i++];
      const ms = Math.max(240, Math.round(len * 0.8)); // 一横约 600 单位 → 半秒多
      void path.getBoundingClientRect();
      path.style.transition = 'stroke-dashoffset ' + ms + 'ms linear';
      path.style.strokeDashoffset = '0';
      timer = setTimeout(step, ms + 200);
    };
    step();
  };
  /** 写一张卡:按顺序一个字接一个字(鼓写完再写励);给了 only 就只写那个字,别的字回到写完的样子 */
  const tianzigePlay = (cardEl, only) => {
    if (!cardEl) return;
    const all = [...cardEl.querySelectorAll('.hz')];
    for (const b of all) tianzigeReset(b);
    const boxes = only ? [only] : all;
    // 排队要写的字先退成淡灰(鼓在写的时候励不该已经是墨色),轮到谁谁再写出来
    for (const b of boxes) { b._queued = true; const g = b.querySelector('.ghost'); if (g && b._hz) g.classList.remove('done'); }
    const go = (k) => { if (k >= boxes.length) return; const b = boxes[k]; b._then = () => setTimeout(() => go(k + 1), 320); tianzigeWrite(b); };
    go(0);
  };
  // ---- 单词卡:四线三格(x 高为 1:升部 / 大写顶 -2、x 高顶 -1、基线 0、降部 +1),笔顺 /api/kid/letters/<词>(drawtell/glyphs 采好的中线点);
  // 写 = 每一笔一条粗线,stroke-dashoffset 从头长到尾,和田字格一个手法;数据没有(写不出的词)退成字体的字、不动 ----
  const WL = new Map();
  const lettersFor = (w) => { if (!WL.has(w)) WL.set(w, fetch('/api/kid/letters/' + encodeURIComponent(w)).then((r) => (r.ok ? r.json() : null)).catch(() => null)); return WL.get(w); };
  /** 一个 x 高 = 100 个 viewBox 单位;紧凑态一个 x 高 22px、舞台 50px */
  const WU = 100;
  /** 正常:讲到时、紧凑态;慢:舞台里(写字每 x 高毫秒数、笔间停顿、段间停顿、念的倍速) */
  const WORD_SPEED = { ms: 120, pause: 50, chunk: 0 };
  const WORD_SLOW = { ms: 190, pause: 110, chunk: 320, rate: 0.7 };
  /** 一个词的四线三格:chunks 给了(舞台)就按段上两色、先分开摆,wordMerge 合拢;fresh = 先淡着等写 */
  /** 每个字母的宽、字间距、空格宽(服务端从 drawtell/glyphs 拼进来):格子同步就排好、画出准确大小,排版量的是终态;笔画晚到只往里填 */
  const WORD_ADV = __WORD_ADV__;
  const WORD_G = Object.fromEntries(Object.entries(WORD_ADV.adv).map(([ch, a]) => [ch, { advance: a }]));
  const wordGrid = (w, chunks, opts = {}) => {
    const xh = opts.stage ? 50 : 22;
    const base = { gap: WORD_ADV.gap, space: WORD_ADV.space, chunks: chunks || undefined };
    const merged = wordLayout(w, WORD_G, base);
    const split = chunks ? wordLayout(w, WORD_G, { ...base, split: true }) : merged;
    const pad = 0.5, W = split.width + pad * 2, off = (split.width - merged.width) / 2;
    const svg = sv('svg', { viewBox: [-pad * WU, -2.5 * WU, W * WU, 4 * WU].join(' '), width: Math.round(W * xh) });
    svg.style.aspectRatio = W + ' / 4';
    const grid = sv('g', { class: 'grid' });
    for (const [k, y] of [['top', -2], ['mid', -1], ['base', 0], ['bot', 1]]) grid.append(sv('line', { class: k, x1: -pad * WU, x2: (split.width + pad) * WU, y1: y * WU, y2: y * WU }));
    svg.append(grid);
    const lts = merged.slots.map((slot, i) => {
      const lt = sv('g', { class: 'lt k' + (chunks ? slot.chunk % 2 : 0) + (opts.fresh ? '' : ' done'), 'data-k': slot.chunk });
      lt._x = [(slot.x + off) * WU, split.slots[i].x * WU];
      lt.style.transform = 'translate(' + lt._x[chunks ? 1 : 0] + 'px, 0px)';
      lt.append(sv('rect', { class: 'hit', x: -0.1 * WU, y: -2.3 * WU, width: ((WORD_G[slot.ch] ? WORD_G[slot.ch].advance : 0.8) + 0.2) * WU, height: 3.6 * WU }));
      svg.append(lt);
      return lt;
    });
    const el = h('div', { class: 'wg' }, svg);
    el._split = Boolean(chunks);
    // 笔画到了:每个字母填进淡淡的字形;数据里没有的字母(或整个没拿到)退成字体的字,不动
    lettersFor(w).then((d) => {
      merged.slots.forEach((slot, i) => {
        const g = d && d.glyphs[slot.ch], lt = lts[i];
        if (g) for (const st of g.strokes) lt.append(sv('path', { class: 'gh', d: 'M' + st.map((q) => q[0] * WU + ' ' + q[1] * WU).join(' L') }));
        else { const t = sv('text', { class: 'ft', x: 0, y: 0, 'font-size': 190 }); t.textContent = slot.ch; lt.append(t); lt.classList.add('done'); }
      });
      el._ready = true;
      const want = el._want; el._want = null;
      if (want) wordWrite(el, want.slow, want.only, want.then);
    });
    return el;
  };
  /** 回到写完的样子(打断正在写的) */
  const wordReset = (grid) => {
    if (grid._run) grid._run.stop();
    grid._run = null;
    for (const x of grid.querySelectorAll('.ink')) x.remove();
    for (const l of grid.querySelectorAll('.lt')) l.classList.add('done');
  };
  /** 写这个词(only = 只写第几段):一笔接一笔,段与段之间多停一会儿;写完调 then。数据还没到就记着,到了再写 */
  const wordWrite = (grid, slow, only, then) => {
    if (!grid) return;
    if (!grid._ready) { grid._want = { slow, only, then }; return; }
    wordReset(grid);
    const sp = slow ? WORD_SLOW : WORD_SPEED;
    const lts = [...grid.querySelectorAll('.lt')].filter((l) => only == null || Number(l.dataset.k) === only);
    const jobs = [];
    let prevK = null;
    for (const l of lts) {
      const k = Number(l.dataset.k);
      const gs = [...l.querySelectorAll('.gh')];
      if (gs.length) l.classList.remove('done');
      gs.forEach((g, n) => { jobs.push({ g, wait: n === 0 && prevK !== null && k !== prevK ? sp.chunk : 0 }); });
      if (gs.length) prevK = k;
    }
    let i = 0, timer = null, alive = true;
    grid._run = { stop: () => { alive = false; clearTimeout(timer); } };
    const step = () => {
      if (!alive) return;
      if (i >= jobs.length) { grid._run = null; for (const x of grid.querySelectorAll('.ink')) x.remove(); for (const l of lts) l.classList.add('done'); if (then) then(); return; }
      const g = jobs[i++].g;
      const len = Math.max(1, g.getTotalLength());
      const ink = sv('path', { class: 'ink', d: g.getAttribute('d') });
      ink.style.strokeDasharray = String(len + 40); ink.style.strokeDashoffset = String(len + 40);
      g.parentNode.append(ink);
      const ms = Math.max(90, Math.round(len / WU * sp.ms));
      void ink.getBoundingClientRect();
      ink.style.transition = 'stroke-dashoffset ' + ms + 'ms linear';
      ink.style.strokeDashoffset = '0';
      timer = setTimeout(step, ms + sp.pause + (i < jobs.length ? jobs[i].wait : 0));
    };
    step();
  };
  /** 舞台里分开写的段合拢成整词(merged = true)或再分开;合拢时分段的两色一起退掉(颜色只为分开时看出哪里是一段,不表示什么) */
  const wordMerge = (grid, merged) => {
    if (!grid._split) return;
    grid.classList.toggle('merged', merged);
    for (const l of grid.querySelectorAll('.lt')) l.style.transform = 'translate(' + l._x[merged ? 0 : 1] + 'px, 0px)';
  };
  /** 念这个词:服务端配好的 1.mp3(老师的音色)按 rate 倍速放(音高不变),没好就浏览器的英文合成声;念完调 then(被打断不调) */
  const wordSay = (card, btn, rate, then) => {
    if (S.rec) return;
    dispatch({ type: 'segment' });
    const token = ++voiceToken;
    for (const x of document.querySelectorAll('.c-word .rc-pl.on')) x.classList.remove('on');
    if (btn) btn.classList.add('on');
    const done = () => { if (btn) btn.classList.remove('on'); if (token === voiceToken && then) then(); };
    const w = String((card.props || {}).word || '');
    const synth = () => { if (token === voiceToken) speak(w, done, done, null, { lang: 'en-US', rate: 0.9 * rate }); };
    const a = segmentAudio(card, 0);
    if (!a || !S.tutor) { synth(); return; }
    audioEl.onplaying = null;
    audioEl.onended = () => { if (token === voiceToken) done(); };
    audioEl.onerror = synth;
    audioEl.src = AUDIO + S.tutor.name + '/' + a.split('/').map(encodeURIComponent).join('/');
    audioRate(rate);
    audioEl.play().catch(synth);
  };
  /** 舞台里的单词卡:emoji、分段两色的四线三格、「再听一遍」(慢);打开就走一遍:慢念与一段一段慢写同时开始 → 写完合拢 → 再慢念。点一段,那段慢写一遍 */
  let wordRun = 0;
  const wordStage = (card, idx) => {
    const p = card.props || {};
    const em = p.emoji || (card.look && card.look.emoji) || '';
    const chunks = Array.isArray(p.chunks) && p.chunks.join('') === p.word ? p.chunks : null;
    const grid = wordGrid(String(p.word || ''), chunks, { stage: true, fresh: !S.reel });
    // 再听只念、不打断写;点一段打断自动那一遍,写完那段照样合拢(不然字母一直分开摆着)
    const btn = recPill(ICON.speaker, '再听一遍', (e) => wordSay(card, e.currentTarget, WORD_SLOW.rate));
    grid.addEventListener('click', (e) => {
      const l = e.target.closest && e.target.closest('.lt');
      if (!l || S.reel) return;
      e.stopPropagation(); wordRun++;
      wordWrite(grid, true, chunks ? Number(l.dataset.k) : null, () => wordMerge(grid, true));
    });
    const el = h('div', { class: 'c c-word', 'data-card': idx, 'data-tint': tintFor(card), 'data-look': lookFor(card) }, em ? h('span', { class: 'we' }, em) : null, grid, h('div', { class: 'wd-row' }, btn));
    // 看录像时只读地开:不出声、不写,停在写完的样子
    if (!S.reel) {
      const run = ++wordRun;
      const live = () => run === wordRun && S.stage;
      // 念和写同时开始(2026-10-01:念完再写,孩子听的时候格子是空的,对不上)
      wordSay(card, btn, WORD_SLOW.rate);
      wordWrite(grid, true, null, () => {
        if (!live()) return;
        const again = () => { if (live()) wordSay(card, btn, WORD_SLOW.rate); };
        if (chunks) { wordMerge(grid, true); setTimeout(again, 600); } else setTimeout(again, 300);
      });
    }
    return el;
  };
  /** 点读:点哪段念哪段——服务端配好的段(card.assets 里有 <段号>.mp3)放 mp3,没好的用浏览器合成声;讲稿在播就先停下 */
  const readSegment = (el, card, k, seg) => {
    dispatch({ type: 'segment' });
    for (const x of document.querySelectorAll('.rd.on')) x.classList.remove('on');
    el.classList.add('on');
    const off = () => el.classList.remove('on');
    say({ text: seg, audio: segmentAudio(card, k) }, off);
  };
  /** 填空:改一个空 → 本地状态、紧凑态重画、400ms 后 PUT(打字中不刷舞台,免得输入框失焦) */
  let fillTimer = null;
  const fillIn = (secIdx, idx, i, value) => {
    const card = S.sections[secIdx].cards[idx];
    const answers = filledAnswers(card); answers[i] = value;
    card.state = { answers };
    $('#st-go').disabled = !stateSummary(card).length;
    repaintCard(secIdx, idx);
    clearTimeout(fillTimer);
    fillTimer = setTimeout(() => saveState(S.sections[secIdx].job, idx, card.state), 400);
  };
  // ---- 录音卡:示范音、回放、舞台里按住录(《口播老师设计.md》§3;仲裁走 dispatch 的 recStart / recEnd) ----
  const REC_MAX_MS = 60000, REC_MIN_MS = 500, REC_CANCEL_PX = 60;
  const recPill = (icon, label, onClick) => h('button', { type: 'button', class: 'rc-pl', html: icon, on: { click: (e) => { e.stopPropagation(); onClick(e); } } }, label);
  /** 放一段声音(示范音的 mp3、自己的录音);被别的声音打断不回调 */
  const playClip = (src, btn, fallbackText) => {
    if (S.rec) return;
    dispatch({ type: 'segment' });
    const token = ++voiceToken;
    const off = () => { if (btn) btn.classList.remove('on'); };
    if (btn) btn.classList.add('on');
    if (!src) { if (fallbackText) speak(fallbackText, off, off); else off(); return; }
    audioEl.onplaying = null;
    audioEl.onended = () => { if (token === voiceToken) off(); };
    audioEl.onerror = () => { if (token === voiceToken) { if (fallbackText) speak(fallbackText, off, off); else off(); } };
    audioEl.src = src;
    audioRate(1);
    audioEl.play().catch(() => { if (token === voiceToken) off(); });
  };
  /** 示范音:服务端配好的 1.mp3(老师的音色),没好就浏览器合成声念给人看的字 */
  const playDemo = (card, btn) => {
    const a = segmentAudio(card, 0);
    const say = card.props.show || (card.props.mode === 'pinyin' ? '' : card.props.text || '');
    playClip(a && S.tutor ? AUDIO + S.tutor.name + '/' + a.split('/').map(encodeURIComponent).join('/') : '', btn, say);
  };
  /** 自己的录音:刚录的放本地那份,刷新后从服务端取 */
  const playMine = (card, btn) => {
    const st = card.state || {};
    const rel = typeof st.audio === 'string' && S.tutor ? st.audio.replace(/^conversations\\/[^\\/]+\\//, '') : '';
    playClip(card._blob || (rel ? AUDIO + S.tutor.name + '/' + rel.split('/').map(encodeURIComponent).join('/') : ''), btn, '');
  };
  /** 舞台里的录音卡:句子、上排(先听 / 听我的 + 示范 / 计时)、中间的大圆键(按住录,往上滑松手取消) */
  const recordStage = (card, idx, secIdx, t, py, sec, locked) => {
    const top = h('div', { class: 'rc-top' });
    if (sec) top.append(recPill(ICON.play, '听我的 · ' + sec.toFixed(1) + ' 秒', (e) => playMine(card, e.currentTarget)), recPill(ICON.speaker, '示范', (e) => playDemo(card, e.currentTarget)));
    else top.append(recPill(ICON.speaker, '先听我念', (e) => playDemo(card, e.currentTarget)));
    const tm = h('div', { class: 'rc-tm' }, '0:00');
    const hint = h('div', { class: 'rc-hint', html: ICON.up }, h('span', {}, '往上滑,松手就取消'));
    const btn = h('button', { type: 'button', class: 'rc-mic' + (sec ? ' again' : ''), 'aria-label': sec ? '按住再录' : '按住录', html: ICON.mic });
    const lb = h('div', { class: 'rc-lb' }, sec ? '按住再录' : '按住录');
    const mid = h('div', { class: 'rc-mid' + (locked ? ' locked' : '') }, hint, btn, lb);
    const el = h('div', { class: 'c c-record', 'data-card': idx, 'data-tint': tintFor(card), 'data-look': lookFor(card) }, t, py, top, tm, mid);
    let y0 = 0;
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (locked || S.rec) return;
      try { btn.setPointerCapture(e.pointerId); } catch {}
      y0 = e.clientY;
      recStart({ secIdx, idx, el, tm, lb, hint });
    });
    btn.addEventListener('pointermove', (e) => {
      const r = S.rec;
      if (!r || r.el !== el) return;
      const c = e.clientY < y0 - REC_CANCEL_PX;
      if (c === r.cancel) return;
      r.cancel = c; el.classList.toggle('cancel', c);
      hint.lastChild.textContent = c ? '松手就取消' : '往上滑,松手就取消';
      hint.classList.toggle('cancel', c);
    });
    btn.addEventListener('pointerup', () => recStop(true));
    btn.addEventListener('pointercancel', () => recStop(false));
    return el;
  };
  /** 家长端的评测旁注:档 · 句分 · 语速;逐字分(不过的红,读成什么带问号);take、评了多久、花了多少 */
  const heardBox = (hd) => {
    const head = (v, cls, stats) => h('div', { class: 'rc-hh' }, h('span', { class: 'k' }, 'koubo'), h('span', { class: 'v ' + cls }, v), h('span', { class: 's' }, stats));
    if (!hd.ok) return h('div', { class: 'rc-hd' }, head('没评上', 'none', hd.error || ''));
    const stats = ['句 ' + Math.round(hd.accuracy || 0)].concat(hd.charsPerMin ? [hd.charsPerMin + ' 字/分'] : []).join(' · ');
    const chips = h('div', { class: 'rc-chs' }, ...(hd.chars || []).map((x) => h('span', { class: 'rc-ch' + (x.ok ? '' : ' bad') }, x.ch + ' ' + (x.risk && x.risk.length ? x.phone + ' ' : '') + Math.round(x.score) + (x.readAs ? ' · 读成 ' + x.readAs + '?' : ''))));
    const meta = ['take ' + hd.take].concat(hd.ms ? ['评 ' + (hd.ms / 1000).toFixed(1) + ' 秒'] : [], hd.cached ? ['缓存'] : hd.costYuan ? ['¥' + hd.costYuan.toFixed(3)] : []).join(' · ');
    return h('div', { class: 'rc-hd' }, head(hd.verdict, { '过': 'ok', '可救': 'mid', '重录': 'bad' }[hd.verdict] || '', stats), chips, h('div', { class: 'rc-mt' }, meta));
  };
  const recMime = () => {
    for (const t of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg']) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {} }
    return '';
  };
  const recClock = (ms) => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  /** 按下:停声音(dispatch recStart),要一路麦克风(常开的那路),起 MediaRecorder;60 秒到了自己停 */
  const recStart = async (r) => {
    if (!window.MediaRecorder) return;
    Object.assign(r, { chunks: [], t0: Date.now(), cancel: false, mr: null, timer: 0, stopped: false, keep: false, ms: 0 });
    S.rec = r;
    dispatch({ type: 'recStart' });
    r.el.classList.add('rec'); r.lb.textContent = '松手就停'; r.tm.textContent = '0:00';
    r.timer = setInterval(() => { const ms = Date.now() - r.t0; r.tm.textContent = recClock(ms); if (ms >= REC_MAX_MS) recStop(true); }, 200);
    let ok = true;
    try { ok = ['hot', 'open'].includes(await micOpen()); } catch { ok = false; }
    if (r.stopped) return;
    if (!ok || !mic.stream) { recStop(false); return; }
    try {
      const mime = recMime();
      const mr = mime ? new MediaRecorder(mic.stream, { mimeType: mime }) : new MediaRecorder(mic.stream);
      r.mr = mr;
      mr.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
      mr.onstop = () => recDone(r);
      r.t0 = Date.now();
      mr.start();
    } catch { recStop(false); }
  };
  /** 松手(keep)/ 上滑松手、关舞台、切后台(不 keep):停录;真停在 MediaRecorder 的 onstop 里收尾 */
  const recStop = (keep) => {
    const r = S.rec;
    if (!r || r.stopped) return;
    r.stopped = true; r.keep = keep && !r.cancel; r.ms = Date.now() - r.t0;
    clearInterval(r.timer);
    if (r.mr && r.mr.state !== 'inactive') { try { r.mr.stop(); return; } catch {} }
    recDone(r);
  };
  /** 收尾:dispatch recEnd(压住的接着念);够长就存——本地先有回放,PUT 上去服务端落盘、换成路径、起评测 */
  const recDone = (r) => {
    if (S.rec === r) { S.rec = null; dispatch({ type: 'recEnd' }); }
    const sec = S.sections[r.secIdx];
    const card = sec && sec.cards[r.idx];
    if (card && r.keep && r.ms >= REC_MIN_MS && r.chunks.length) {
      const blob = new Blob(r.chunks, { type: (r.mr && r.mr.mimeType) || 'audio/webm' });
      const seconds = Math.round(Math.min(r.ms, REC_MAX_MS) / 100) / 10;
      if (card._blob) URL.revokeObjectURL(card._blob);
      card._blob = URL.createObjectURL(blob);
      card.state = { audio: '', seconds };
      const job = sec.job;
      const fr = new FileReader();
      fr.onload = () => {
        if (!S.tutor || S.readonly) return;
        api('PUT', CONV + S.tutor.name + '/cards/' + job + '/' + r.idx, { audio: fr.result, seconds }).then((res) => { if (res && res.state) { card.state = res.state; repaintCard(r.secIdx, r.idx); } }).catch(() => {});
      };
      fr.readAsDataURL(blob);
      repaintCard(r.secIdx, r.idx);
    }
    if (S.stage && S.stage.section === r.secIdx && S.stage.card === r.idx) renderStage();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) recStop(false); });
  /** 图片舞台:双指缩放 + 单指拖,双击复位 */
  const pinch = (el) => {
    const img = el.querySelector('img');
    const pts = new Map(); let scale = 1, tx = 0, ty = 0, start = null, lastTap = 0;
    const apply = () => { img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; };
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    el.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { el.setPointerCapture(e.pointerId); } catch {} start = { scale, tx, ty, d: pts.size === 2 ? dist() : 0, x: e.clientX, y: e.clientY }; if (pts.size === 1) { const now = Date.now(); if (now - lastTap < 300) { scale = 1; tx = 0; ty = 0; apply(); } lastTap = now; } });
    el.addEventListener('pointermove', (e) => { if (!pts.has(e.pointerId) || !start) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2 && start.d) scale = Math.min(6, Math.max(1, start.scale * dist() / start.d)); else if (pts.size === 1 && scale > 1) { tx = start.tx + (e.clientX - start.x); ty = start.ty + (e.clientY - start.y); } apply(); });
    const up = (e) => { pts.delete(e.pointerId); start = pts.size ? { scale, tx, ty, d: pts.size === 2 ? dist() : 0, x: [...pts.values()][0].x, y: [...pts.values()][0].y } : null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  // 节头:时间 · 节名;孩子问这节时拍的照片(R5)缩略图跟在后面,点小图看大图(不是再听)
  const sectionHead = (s) => h('div', { class: 'sh', on: { click: (e) => againAt(e.currentTarget, 'all') } }, (s.at ? clock(s.at) + ' · ' : '') + sectionTitle(s), ...((s.photos || []).map((p, k) => h('img', { class: 'ph', src: '/api/kid/image?p=' + encodeURIComponent(p), alt: '', loading: 'lazy', on: { click: (e) => { e.stopPropagation(); openLb(s.photos, k); } } }))), h('button', { type: 'button', class: 'again', 'aria-label': '再听这一节', html: ICON.replay }));
  const rowEl = (n, ...kids) => h('div', { class: 'row', style: 'grid-template-columns:repeat(' + n + ',minmax(0,1fr))' }, ...kids);
  // ---- 排版(2026-10-01,《工作流程.md》§二「排版」):每张卡放进量具量一次,半宽放得下(fitsHalf)就半宽,相邻两张半宽的并一行(rowsFor) ----
  // 量具在 body 下、屏幕外:板书藏着(首页开着)时也量得出;按 端 + 半宽像素 + 卡的内容缓存,看录像每次重画不再量
  const fitCache = new Map();
  const ROW_GAP = 12;
  const boardWidth = () => {
    const b = $('#board');
    if (b && b.clientWidth > 0) { const cs = getComputedStyle(b); return b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); }
    return S.device === 'tablet-landscape' ? Math.min(innerWidth, 1040) - 64 : innerWidth - 32;
  };
  const halfWidth = () => Math.floor((boardWidth() - ROW_GAP) / 2);
  const linesOf = (el) => {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    return Math.round((el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lh);
  };
  /** 这张卡能不能半宽;el 是画好的卡(没给就现画一张不带交互的) */
  const halfOf = (card, el) => {
    if (!card || !canHalf(card)) return false;
    const W = boardWidth(), hw = Math.floor((W - ROW_GAP) / 2);
    if (!(hw > 80)) return isShortCard(card);
    const key = S.device + '|' + hw + '|' + card.kind + '|' + JSON.stringify(card.props || {}) + '|' + JSON.stringify(card.look || null);
    if (fitCache.has(key)) return fitCache.get(key);
    let probe = document.getElementById('lay-probe');
    if (!probe) { probe = h('div', { id: 'lay-probe', 'aria-hidden': 'true' }); document.body.append(probe); }
    const c = el || renderCard(card, 0, null, false);
    const home = c.parentNode, next = c.nextSibling;
    probe.style.width = hw + 'px'; probe.append(c);
    const half = c.offsetHeight, box = c.getBoundingClientRect();
    // 横着溢出:卡里哪块内容伸出卡外(右上角的「再听」钮本来就伸出去,不算)
    const overflow = [...c.children].some((x) => !x.classList.contains('again') && (x.scrollWidth > x.clientWidth + 1 || x.getBoundingClientRect().right > box.right + 1));
    const lines = [...c.querySelectorAll(':scope > .ct, :scope > .cb, :scope > .rd')].reduce((n, x) => n + linesOf(x), 0);
    probe.style.width = W + 'px';
    const full = c.offsetHeight;
    if (home) home.insertBefore(c, next); else c.remove();
    const ok = fitsHalf(card, S.device, { half, full, lines, overflow });
    fitCache.set(key, ok);
    return ok;
  };
  /** 一节的行元素:els[k] 是画好的第 k 张卡 */
  const rowEls = (s, els) => {
    const half = (k) => halfOf(s.cards[k], els[k]);
    return rowsFor(s, S.device, half).map((row) => ({ row, el: rowEl(rowCols(s, row, half), ...row.map((k) => els[k])) }));
  };
  /** 一节 = 头一行(时间 · 节名)+ 若干行;行按卡量出来的宽度排(rowsFor) */
  const renderSection = (s, i) => h('div', { class: 'sec', 'data-sec': i, 'data-job': s.job }, sectionHead(s), ...rowEls(s, s.cards.map((c, k) => renderCard(c, k, i, false))).map((r) => r.el));
  /**
   * 老师还在说(2026-09-13,一拍一就绪):第一拍就绪前板上只有占位卡(字幕行「我写给你看」,见 renderSubtitle);就绪了就把这条转成 S.sections 里的一节(live)开播,
   * 之后每次 poll 只铺新就绪的拍的卡(一行一张,没有排版)、把 lines 换成最新的(配音名填进来),播到头等着(thinking)的就接上。
   * 铺卡在拍就绪时而不是围栏闭合时:铺的时候声音已齐,不会先素后彩地闪
   */
  const liveCardsOf = (e) => { const bs = beatsOf(e).slice(0, e.ready || 0); let n = 0; for (const b of bs) if (b.card !== null) n = Math.max(n, b.card + 1); return n; };
  /** 一张卡落到行里:和前面的卡并一行(半宽 + 半宽,或明写的并排)就进那一行,否则新起一行;只看这张和前面的,后面的卡不影响前面的行 */
  const placeCard = (P, sec, k, idx) => {
    const c = renderCard(sec.cards[k], k, idx, false);
    const half = (j) => j <= k && halfOf(sec.cards[j], j === k ? c : null);
    const row = rowsFor(sec, S.device, half).find((r) => r.includes(k)) || [k];
    const first = row[0] !== k ? P.el.querySelector('[data-card="' + row[0] + '"]') : null;
    const el = first && first.parentNode && first.parentNode.classList.contains('row') ? first.parentNode : null;
    if (el) { el.style.gridTemplateColumns = 'repeat(' + rowCols(sec, row, half) + ',minmax(0,1fr))'; el.append(c); }
    else P.el.append(rowEl(rowCols(sec, row, half), c));
    return c;
  };
  const renderLive = (e) => {
    if (!S.partial || S.partial.job !== e.job) { if (S.partial) S.partial.el.remove(); const idx = S.sections.length; S.partial = { job: e.job, idx, live: false, shown: 0, el: h('div', { class: 'sec', 'data-sec': idx, 'data-job': e.job }, sectionHead(e)) }; $('#board').append(S.partial.el); }
    const P = S.partial, idx = P.idx;
    if (!(e.ready > 0)) return;
    const sec = { ...e, partial: true };
    const wasLive = P.live;
    if (!wasLive) { P.live = true; S.played.add(e.job); S.sections.push(sec); }
    else S.sections[idx] = sec;
    const n = liveCardsOf(sec);
    if (n > P.shown) { const g = $('#board > .wait-card'); if (g) g.remove(); }
    for (; P.shown < n; P.shown++) { const c = placeCard(P, sec, P.shown, idx); c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    dispatch({ type: wasLive ? 'liveBeat' : 'liveStart', section: idx });
  };
  /** 老师写完了:live 的那节换成正式的(带标注 / 样子、每句配音),不重播——没铺的卡补上,铺过的换样子并把已播过的标注补画;等着的接上 */
  const finalizeLive = (e) => {
    const P = S.partial; S.partial = null;
    const idx = P.idx;
    const prevLines = S.sections[idx].lines.map((l) => l.text);
    const sec = { ...e };
    S.sections[idx] = sec;
    const el = P.el;
    for (let k = 0; k < sec.cards.length; k++) {
      const old = k < P.shown ? el.querySelector('[data-card="' + k + '"]') : null;
      if (old) swapCard(old, renderCard(sec.cards[k], k, idx, false));
      else placeCard(P, sec, k, idx);
    }
    // 定稿的句下标对不上时按文字找回位置、再听让路、等着的接上:都在 step 的 liveFinal
    dispatch({ type: 'liveFinal', section: idx, prevLines });
  };
  /** 一张卡的状态变了:紧凑态原地重画(标注会掉,重画本节已播到的;选中态照旧) */
  const repaintCard = (secIdx, idx) => {
    const sec = $('#board').querySelector('[data-sec="' + secIdx + '"]');
    const old = sec && sec.querySelector('[data-card="' + idx + '"]');
    if (!old) return;
    swapCard(old, renderCard(S.sections[secIdx].cards[idx], idx, secIdx, false));
    const upTo = S.state.section === secIdx ? S.state.line : S.state.section > secIdx ? undefined : -1;
    if (upTo !== -1) for (const l of S.sections[secIdx].lines.slice(0, upTo === undefined ? undefined : upTo + 1)) for (const m of l.marks) if (m.card === idx) applyMark(secIdx, m, false);
    markHeard();
  };
  /** 一张卡换成新画的:选中态与「田字格写过了」跟着搬 */
  const swapCard = (old, fresh) => {
    // 田字格不换元素:老师写完那一刻它可能正在写,换了动画就断(mock 里 1.5 秒必现);同一个词只把定稿的样子搬过去
    if (old.classList.contains('c-tianzige') && fresh.classList.contains('c-tianzige') && old.dataset.ch === fresh.dataset.ch) { old.dataset.tint = fresh.dataset.tint; old.dataset.look = fresh.dataset.look; old.dataset.card = fresh.dataset.card; return; }
    // 单词卡同理;定稿才有的 emoji 搬过去
    if (old.classList.contains('c-word') && fresh.classList.contains('c-word') && old.dataset.w === fresh.dataset.w) {
      old.dataset.tint = fresh.dataset.tint; old.dataset.look = fresh.dataset.look; old.dataset.card = fresh.dataset.card;
      const fe = fresh.querySelector('.we'), oe = old.querySelector('.we');
      if (fe && oe) oe.textContent = fe.textContent; else if (fe) old.prepend(fe);
      return;
    }
    if (old.classList.contains('now')) fresh.classList.add('now'); if (old.classList.contains('pend')) fresh.classList.add('pend'); if (old.dataset.wrote) fresh.dataset.wrote = old.dataset.wrote; old.replaceWith(fresh);
  };
  /** 选中态:一节里同一时刻只有一张(讲到哪张亮哪张;舞台开着时是舞台那张;停下等答停在末句的卡) */
  const setNow = (secIdx, idx) => {
    for (const x of document.querySelectorAll('#board .c.now')) x.classList.remove('now');
    if (secIdx === null || idx === null) return;
    const el = $('#board').querySelector('[data-sec="' + secIdx + '"] [data-card="' + idx + '"]');
    if (!el) return;
    el.classList.add('now');
    // 田字格卡:讲到它那一刻写一遍(这一页只写一次;换新元素时 wrote 跟着搬),之后孩子点了再写
    // 再听时再写一遍(这一趟再听只写一次)
    // 单词卡同样:讲到它时在四线三格里按正常速度写一遍
    if ((el.classList.contains('c-tianzige') || el.classList.contains('c-word')) && S.state.status === 'playing' && (S.state.replay ? !replayWrote.has(el) : !el.dataset.wrote)) { el.dataset.wrote = '1'; if (S.state.replay) replayWrote.add(el); if (el.classList.contains('c-word')) wordWrite(el.querySelector('.wg'), false, null); else tianzigePlay(el); }
  };
  const showNow = () => setNow(S.state.section, nowCard(S.sections, S.state));
  /** 换端(转屏)或窗口变了:端或半宽变了就整节重排(卡重新量),标注按已播到的画齐,选中态照旧 */
  const relayout = () => {
    const d = debug.get('device') || deviceFor(innerWidth, innerHeight);
    // 看录像时板书是录像画的:换了端让它按新端整块重画
    if (S.reel) { S.device = d; S.reel.key = ''; reelTick(); return; }
    const hw = halfWidth();
    if (d !== S.device || hw !== S.layHalf) {
      S.device = d; S.layHalf = hw;
      S.sections.forEach((s, i) => { const old = $('#board').querySelector('[data-sec="' + i + '"]'); if (old && !(S.partial && S.partial.el === old)) { old.replaceWith(renderSection(s, i)); const upTo = S.state.section === i ? S.state.line : S.state.section > i ? undefined : -1; if (upTo !== -1) paintAll(i, upTo); } });
      if (S.stage) setNow(S.stage.section, S.stage.card); else showNow();
      markHeard();
    } else for (const span of document.querySelectorAll('#board .mk[data-pen]')) { const card = span.closest('.c'); if (card && LINE_PENS.includes(span.dataset.pen)) drawPen(span, card, span.dataset.pen, false); }
  };
  let relayoutTimer = null;
  window.addEventListener('resize', () => { clearTimeout(relayoutTimer); relayoutTimer = setTimeout(relayout, 150); });
  S.device = debug.get('device') || deviceFor(innerWidth, innerHeight);
  S.layHalf = halfWidth();

  // ---- 舞台:点卡放大,交互都在这里;开着时讲稿暂停,关了字幕行出「播放」 ----
  const KIND_NAME = { text: '', read: '点读', choice: '选一选', fill: '填一填', image: '看图', tianzige: '田字格', word: '单词', scene: '讲解动画', material: '动画', canvas: '画一画', record: '录音', code: '' };
  const GO_LABEL = { canvas: '给老师看' };
  const openStage = (secIdx, idx, opts = {}) => {
    const card = S.sections[secIdx] && S.sections[secIdx].cards[idx];
    if (!card) return;
    if (isHeavy(card) && !sceneReady(card) && card.kind === 'scene') return; // 课包还没到:紧凑态写着「图还在路上」,不开
    if (S.readonly && hasState(card) && !opts.delegate) return; // 以前的只能看:选择 / 填空 / 画板不开,免得改了当时的答案
    if (!opts.delegate) dispatch({ type: 'stageOpen' });
    S.stage = { section: secIdx, card: idx, id: S.sections[secIdx].job + '/' + idx, scene: null, delegate: Boolean(opts.delegate), autoplay: Boolean(opts.autoplay) };
    playRec({ k: 'stage', job: S.sections[secIdx].job, card: idx, open: true });
    // 画板:题目在工作台自己的题目条上(可收起),顶栏只写「画一画」
    $('#st-ttl').textContent = card.kind === 'canvas' ? '画一画' : cardTitle(card);
    $('#st-kd').textContent = KIND_NAME[card.kind] || card.kind;
    $('#st-kd').hidden = card.kind === 'canvas' || !(KIND_NAME[card.kind] || card.kind);
    renderStage();
    $('#stage').classList.add('on');
    setNow(secIdx, idx);
    // 素材卡:讲稿 [[play N]] 只播第 N 段;[[play]] 从头播完;孩子点开的从第 1 段起、一段一停
    if (card.kind === 'material' && materialReady(card)) playMaterial(opts.segment || 1, Boolean(opts.segment) || !opts.delegate);
  };
  // ---- 素材卡的舞台(《备课设计.md》§11.3;仲裁表「交给素材」):一段播完停在末帧;讲稿交来的,播完 stageDone 接着念、舞台不关 ----
  const materialSrc = (id, k) => '/api/kid/material/' + encodeURIComponent(id || '') + '/' + k + '.mp4';
  const playMaterial = (k, only) => {
    if (!S.stage) return;
    const card = S.sections[S.stage.section].cards[S.stage.card];
    const v = $('#st-body video');
    if (!card || card.kind !== 'material' || !v) return;
    S.stage.mat = { seg: k, only };
    for (const b of document.querySelectorAll('#st-body .segs button')) b.classList.toggle('on', b.dataset.seg === String(k));
    v.src = materialSrc(card.props.id, k);
    v.play().catch(() => {});
  };
  const materialEnded = () => {
    const st = S.stage;
    if (!st || !st.mat) return;
    const card = S.sections[st.section].cards[st.card];
    const n = card.props.segments || 0;
    const prev = card.state || { segment: 0, done: false };
    card.state = { segment: Math.max(prev.segment || 0, st.mat.seg), done: Boolean(prev.done) || st.mat.seg >= n };
    saveState(S.sections[st.section].job, st.card, card.state);
    repaintCard(st.section, st.card);
    if (!st.mat.only && st.mat.seg < n) { playMaterial(st.mat.seg + 1, false); return; }
    // 讲稿交来的:播完接着念,舞台留着停在末帧(老师对着这一帧往下说)
    if (st.delegate) { st.delegate = false; resumeAfter(); }
  };
  const STAGE_SOURCE = 'cotutor-stage';
  const frame = $('#st-frame');
  const postStage = (m) => { try { frame.contentWindow.postMessage({ source: STAGE_SOURCE, ...m }, '*'); } catch {} };
  const renderStage = () => {
    if (!S.stage) return;
    const card = S.sections[S.stage.section].cards[S.stage.card];
    const heavy = isHeavy(card);
    $('#st-body').hidden = heavy;
    frame.hidden = !heavy;
    if (heavy) { $('#st-body').replaceChildren(); frame.src = '/stage/?card=' + encodeURIComponent(S.stage.id); }
    else { frame.src = 'about:blank'; $('#st-body').replaceChildren(renderCard(card, S.stage.card, S.stage.section, true)); }
    const act = $('#st-act'); act.hidden = !hasState(card);
    $('#st-go').textContent = GO_LABEL[card.kind] || '交给老师';
    $('#st-go').disabled = !stateSummary(card).length;
    $('#st-note').textContent = card.kind === 'canvas' ? stateSummary(card).join('、') : '';
    if (card.kind === 'record') {
      // 这一节还有没录的:「下一句」;都录了:「交给老师」;交了就锁住,只剩回放
      const sec = S.sections[S.stage.section];
      const left = sec.cards.filter((c) => c.kind === 'record' && !recordSeconds(c)).length;
      const done = recordSeconds(card) > 0;
      const others = left - (done ? 0 : 1);
      act.hidden = S.readonly || recordLocked(S.sections, S.stage.section, S.submitted);
      $('#st-go').textContent = others > 0 ? '下一句' : '交给老师';
      $('#st-go').disabled = !done || Boolean(S.rec);
      $('#st-note').textContent = !done ? '先听,再按住录。' : left ? '录好了。还有 ' + left + ' 句没录。' : '都录好了。';
    }
  };
  /** 发给舞台包的这张卡(ready 时发;看录像时孩子改了卡再发一次,包按新状态重画) */
  const stageCard = (card) => {
    const b = card.kind === 'scene' ? card.props.bundle : card.kind === 'canvas' && card.props.base && card.props.base.bundle ? card.props.base.bundle : null;
    const im = card.kind === 'canvas' && card.props.base && typeof card.props.base.image === 'string' ? card.props.base.image : null;
    return { type: 'card', id: S.stage.id, kind: card.kind, props: card.props, state: card.state === undefined ? null : card.state, bundleUrl: b ? '/api/bundles/' + encodeURIComponent(b) + '/' : undefined, imageUrl: im ? '/api/kid/image?p=' + encodeURIComponent(im) : undefined, autoplay: S.stage.autoplay };
  };
  /** 舞台包说话:ready → 把卡发过去;phase → 字幕行;state → 存;done 且是讲稿委托的 → 关舞台接着念 */
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.source !== STAGE_SOURCE || !S.stage) return;
    const card = S.sections[S.stage.section].cards[S.stage.card];
    if (m.type === 'ready') postStage(stageCard(card));
    else if (m.type === 'phase') { S.stage.scene = { phase: m.phase, line: m.line, step: m.step, total: m.total }; renderSubtitle(); if (m.phase === 'done' && S.stage.delegate) { const d = S.stage; closeStage(); resumeAfter(d); } }
    else if (m.type === 'state') { card.state = m.state; $('#st-go').disabled = !stateSummary(card).length; $('#st-note').textContent = stateSummary(card).join('、'); repaintCard(S.stage.section, S.stage.card); saveState(S.sections[S.stage.section].job, S.stage.card, m.state); }
    else if (m.type === 'submit') { card.state = m.state; const id = S.stage.id; const job = S.sections[S.stage.section].job; const idx = S.stage.card; closeStage(); api('PUT', CONV + S.tutor.name + '/cards/' + job + '/' + idx, m.image ? { ...m.state, image: m.image } : m.state).catch(() => {}).then(() => send('', { action: 'submit', focus: { card: id } })); }
    else if (m.type === 'close' || m.type === 'error') { const d = S.stage; closeStage(); if (d.delegate) resumeAfter(d); }
  });
  /** 讲稿委托给场景播完(或孩子关了)→ 接着念下一句 */
  const resumeAfter = () => dispatch({ type: 'stageDone' });
  const closeStage = () => { if (S.stage && S.sections[S.stage.section]) playRec({ k: 'stage', job: S.sections[S.stage.section].job, card: S.stage.card, open: false }); recStop(false);
    // 单词卡舞台:自动那一遍停下,慢念也停
    for (const v of document.querySelectorAll('#st-body video')) { try { v.pause(); } catch {} }
    wordRun++; if (S.stage && !S.reel && S.sections[S.stage.section] && (S.sections[S.stage.section].cards[S.stage.card] || {}).kind === 'word') silence(); S.stage = null; frame.src = 'about:blank'; $('#stage').classList.remove('on'); renderSubtitle(); showNow(); };
  $('#st-x').innerHTML = ICON.close;
  // 孩子关:讲稿交给素材、还没播完的,关了接着念(场景卡的关在舞台包里,走上面的 close 消息)
  const closeByKid = () => { const d = S.stage; const card = d && S.sections[d.section] ? S.sections[d.section].cards[d.card] : null; closeStage(); if (d && d.delegate && card && !isHeavy(card)) resumeAfter(); };
  $('#st-x').addEventListener('click', closeByKid);
  $('#st-dim').addEventListener('click', closeByKid);
  /** 选择题:点一项 → 本地改状态、重画、PUT 到服务端(失败不响,下次再点再存) */
  const pick = (secIdx, idx, i) => {
    const card = S.sections[secIdx].cards[idx];
    const cur = (card.state && Array.isArray(card.state.picked)) ? card.state.picked : [];
    card.state = { picked: togglePick(cur, i, Boolean(card.props.multi)) };
    renderStage(); repaintCard(secIdx, idx);
    saveState(S.sections[secIdx].job, idx, card.state);
  };
  const saveState = (job, idx, state) => { if (!S.tutor || S.readonly) return; api('PUT', CONV + S.tutor.name + '/cards/' + job + '/' + idx, state).catch(() => {}); };
  $('#st-go').addEventListener('click', () => {
    if (!S.stage) return;
    const card = S.sections[S.stage.section].cards[S.stage.card];
    if (isHeavy(card)) { postStage({ type: 'control', action: 'submit' }); return; } // 画板:让舞台包导出 png 再交
    if (!stateSummary(card).length) return;
    if (card.kind === 'record') {
      const secIdx = S.stage.section, sec = S.sections[secIdx];
      const next = nextUnrecorded(sec, S.stage.card);
      if (next >= 0) { openStage(secIdx, next); return; }
      // 交了:这一节的录音卡都锁住(老师回来之前也锁),焦点给最后录的这张
      S.submitted.add(sec.job);
      const id = S.stage.id;
      closeStage();
      sec.cards.forEach((c, i) => { if (c.kind === 'record') repaintCard(secIdx, i); });
      send('', { action: 'submit', focus: { card: id } });
      return;
    }
    const id = S.stage.id;
    clearTimeout(fillTimer); if (card.kind === 'fill') saveState(S.sections[S.stage.section].job, S.stage.card, card.state);
    closeStage();
    send('', { action: 'submit', focus: { card: id } });
  });
  const NS = 'http://www.w3.org/2000/svg';
  /** 线条类的笔:被标注的字每一行一段 SVG 路径,贴在卡上(卡是 position:relative);animate = 描出来(dashoffset 从全长到 0) */
  const drawPen = (span, card, pen, animate) => {
    for (const old of span._pens || []) old.remove();
    span._pens = [];
    const cr = card.getBoundingClientRect();
    const rects = [...span.getClientRects()].filter((r) => r.width > 0);
    rects.forEach((r, k) => {
      const b = penBox(pen, r.width, r.height);
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'pen pen-' + pen);
      svg.setAttribute('viewBox', '0 0 ' + b.w + ' ' + b.h);
      svg.style.left = (r.left - cr.left - card.clientLeft + b.x) + 'px';
      svg.style.top = (r.top - cr.top - card.clientTop + b.y) + 'px';
      svg.style.width = b.w + 'px'; svg.style.height = b.h + 'px';
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', penPath(pen, b.w, b.h, span.dataset.phrase + ':' + k));
      svg.append(path); card.append(svg); span._pens.push(svg);
      if (animate) { const L = path.getTotalLength(); path.style.strokeDasharray = L; path.style.strokeDashoffset = L; if (typeof animate === 'number') path.style.transitionDuration = animate + 'ms'; requestAnimationFrame(() => { svg.classList.add('draw'); path.style.strokeDashoffset = 0; }); }
    });
  };
  /** 一处标注落到卡上:找到词、包一个 span、按笔画;animate 缺省 true(播到这句时;给数字 = 描线用这么多毫秒),画齐 / 重画时 false */
  const applyMark = (secIdx, mark, animate) => {
    const sec = $('#board').querySelector('[data-sec="' + secIdx + '"]');
    const card = sec && sec.querySelector('[data-card="' + mark.card + '"]');
    if (!card || !card.classList.contains('c')) return null;
    // 单词卡格里是笔顺不是文字、卡上只有这一个词:标注只管讲到哪张亮哪张,不画(涂荧光盖住字形,2026-10-01 真机看着难看)
    if (card.classList.contains('c-word')) return card;
    const cardData = S.sections[secIdx].cards[mark.card];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = findPhrase(n.nodeValue, mark.phrase);
      if (i < 0 || n.parentElement.closest('.mk')) continue;
      const pen = mark.pen || penFor(cardData, mark.phrase);
      const range = document.createRange(); range.setStart(n, i); range.setEnd(n, i + mark.phrase.length);
      const span = document.createElement('span'); span.className = 'mk mk-' + pen; span.dataset.pen = pen; span.dataset.phrase = mark.phrase;
      range.surroundContents(span);
      if (LINE_PENS.includes(pen)) drawPen(span, card, pen, animate !== false);
      return card;
    }
    return card;
  };
  const waitCardEl = () => {
    const g = h('div', { class: 'wait-card' }, avatarEl(S.tutor));
    g.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 120 34"><path d="M4 22 C 14 6, 22 30, 32 16 S 48 6, 56 20 S 72 30, 80 14 S 98 8, 112 18"/><path d="M10 30 L 70 30"/></svg>');
    return g;
  };
  const renderSubtitle = () => {
    if (!S.pending) S.waitSince = null;
    const waited = S.waitSince ? Date.now() - S.waitSince : 0;
    let v = subtitleFor({ state: S.state, sections: S.sections, pending: S.pending, waitedMs: waited, limit: S.limit });
    if (S.stage && S.stage.scene && !S.limit) v = sceneSubtitle(S.stage.scene.phase, S.stage.scene.line, S.stage.scene.step, S.stage.scene.total);
    const t = $('#sub-text'); t.className = v.kind;
    const dots = () => h('span', { class: 'dots' }, h('i'), h('i'), h('i'));
    if (v.kind === 'wait') t.replaceChildren(avatarEl(S.tutor), v.text, dots());
    else if (v.kind === 'gap') t.replaceChildren(v.text, dots());
    else if (v.kind === 'replay') t.replaceChildren(h('span', { class: 'rp', html: ICON.replay }), v.text);
    else t.textContent = v.text;
    clearTimeout(S.waitTimer);
    if (v.kind === 'wait' && waited < WAIT_LONG_MS) S.waitTimer = setTimeout(renderSubtitle, WAIT_LONG_MS - waited);
    // 占位卡:第一拍前、以及念着没卡的开头句时都在(第一张卡落下才撤),总在板的最后
    const board = $('#board'); let g = board.querySelector(':scope > .wait-card');
    if (v.kind === 'wait' || (S.partial && S.partial.live && !S.partial.shown)) { if (!g) { g = waitCardEl(); board.append(g); g.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } else if (g !== board.lastElementChild) board.append(g); }
    else if (g) g.remove();
    const b = $('#sub-btn');
    if (S.readonly && v.right === 'continue') v.right = 'none';
    b.hidden = v.right === 'none';
    b.className = v.right === 'continue' ? 'cont' : '';
    b.innerHTML = v.right === 'pause' ? ICON.pause : v.right === 'play' ? ICON.play : v.right === 'stop' ? ICON.stop : v.right === 'continue' ? ICON.play + '<span>继续</span>' : '';
    // 再听刚停,「继续」晚一会儿才能点:停钮与继续钮在同一个位置,想停再听的那一下别变成「继续」发给老师
    const guard = v.right === 'continue' ? S.contGuard - Date.now() : 0;
    b.disabled = guard > 0;
    clearTimeout(guardTimer);
    if (guard > 0) guardTimer = setTimeout(renderSubtitle, guard);
    document.body.classList.toggle('pending', S.pending);
    document.body.classList.toggle('limit', S.limit);
    markHeard();
  };
  $('#sub-btn').addEventListener('click', () => {
    if (S.stage && S.stage.scene) { postStage({ type: 'control', action: 'toggle' }); return; }
    dispatch({ type: 'tapButton' });
  });

  // 播放:一句 = 字幕 + 标注 + 滚到那张卡 + 声音;播完往下走
  const playLine = () => {
    const s = S.sections[S.state.section]; const line = s && s.lines[S.state.line];
    if (!line) { dispatch({ type: 'lineMissing' }); return; }
    renderSubtitle();
    showNow();
    let target = null;
    // 标注:讲稿里找得到那个词的,等念到它再画(按声音总时长比例估,markTiming);找不到的句首就画
    const secIdx = S.state.section, lineIdx = S.state.line;
    const timed = [];
    for (const m of line.marks) { if (markTiming(line, m, 1000)) timed.push(m); else target = applyMark(secIdx, m, true) || target; }
    if (!target) { const at = nowCard(S.sections, S.state); target = $('#board').querySelector('[data-sec="' + secIdx + '"] ' + (at === null ? '.c' : '[data-card="' + at + '"]')); }
    if (target) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const done = new Set();
    const onStart = (totalMs) => {
      const tok = voiceToken;
      const live = () => tok === voiceToken && S.state.status === 'playing' && S.state.section === secIdx && S.state.line === lineIdx;
      for (const m of timed) { const t = markTiming(line, m, totalMs); setTimeout(() => { if (live() && !done.has(m)) { done.add(m); applyMark(secIdx, m, t.dur); } }, t.at); }
    };
    say(line, () => {
      if (S.state.status !== 'playing') return;
      // 句尾的标注可能还没轮到(声音比估的短一点):念完先把没画的补上,再往下走
      for (const m of timed) if (!done.has(m)) { done.add(m); applyMark(secIdx, m, false); }
      // 往下走(再听 / [[play]] 交给场景 / 下一句 / 停下等答)都在 step 的 lineEnded
      dispatch({ type: 'lineEnded' });
    }, onStart);
  };
  /** 末句问句停下时,锚点卡有交互(选择题)就把它推到舞台等答 */
  const openAskCard = (secIdx, line) => {
    const at = lineTarget(line);
    const card = at !== null && S.sections[secIdx] && S.sections[secIdx].cards[at];
    if (card && hasState(card) && !S.stage) openStage(secIdx, at);
  };
  /** 把一节的标注一次画齐(打开页面、不出声时):不描,直接在 */
  const paintAll = (secIdx, upTo) => { const s = S.sections[secIdx]; if (!s) return; for (const l of s.lines.slice(0, upTo === undefined ? s.lines.length : upTo + 1)) for (const m of l.marks) applyMark(secIdx, m, false); };

  // ---- 再听(2026-09-18):卡角喇叭 = 这张卡那几句,节头 = 整节,点字幕 = 这一句;板上安静、讲完之后才有;声音就是当时的配音,不花钱 ----
  const replayWrote = new Set();
  const againBtn = () => h('button', { type: 'button', class: 'again', 'aria-label': '再听', html: ICON.replay, on: { click: (e) => { e.stopPropagation(); const c = e.currentTarget.closest('.c'); if (c) againAt(c, Number(c.dataset.card)); } } });
  const againAt = (el, target) => {
    const secEl = el.closest('.sec');
    if (!secEl || !(target === 'all' ? secEl : el).classList.contains('heard')) return;
    dispatch({ type: 'tapAgain', section: Number(secEl.dataset.sec), target });
  };
  /** 撤掉这几句画过的标注,重念时跟着声音再描一遍(applyMark 不碰已经包过的字) */
  const unpaintLines = (secIdx, lines) => {
    const sec = $('#board').querySelector('[data-sec="' + secIdx + '"]');
    if (!sec) return;
    for (const i of lines) for (const m of S.sections[secIdx].lines[i].marks) {
      const card = sec.querySelector('[data-card="' + m.card + '"]');
      if (!card) continue;
      for (const span of [...card.querySelectorAll('.mk')]) {
        if (span.dataset.phrase !== m.phrase) continue;
        for (const pen of span._pens || []) pen.remove();
        const parent = span.parentNode; span.replaceWith(...span.childNodes); parent.normalize();
      }
    }
  };
  /** 板上安静时,有讲稿的卡与节都挂上 heard(喇叭露出来,不看念没念过);念着的挂 replaying。老师还在写的节不挂;板上不安静(老师在想、正在念)全都不挂 */
  const markHeard = () => {
    const quiet = replayQuiet(S.state, S.pending);
    const R = S.state.replay ? S.replayOf : null;
    for (const secEl of $('#board').querySelectorAll(':scope > .sec[data-sec]')) {
      const i = Number(secEl.dataset.sec);
      secEl.classList.toggle('heard', quiet && replayLines(S.sections, i, 'all').length > 0);
      secEl.classList.toggle('replaying', Boolean(R && R.section === i && R.card === 'all'));
      for (const c of secEl.querySelectorAll('.c[data-card]')) {
        const k = Number(c.dataset.card);
        c.classList.toggle('heard', quiet && replayLines(S.sections, i, k).length > 0);
        c.classList.toggle('replaying', Boolean(R && R.section === i && R.card === k));
      }
    }
  };
  // 点字幕上的字 = 再听这一句(能不能在 step 的 tapSubtitle 里判)
  $('#sub-text').addEventListener('click', () => dispatch({ type: 'tapSubtitle' }));

  // ---- 播放器:改播放状态的事都走 dispatch → step(kid-board.ts,纯函数,仲裁表见《工作流程.md》),这里只照单执行它回的事。
  // 页面里不许再直接改 S.state / S.replayOf / S.contGuard / S.held(tests/player.test.ts 数着) ----
  const runEffect = (f) => {
    switch (f.kind) {
      case 'stop': silence(); break;
      case 'play': playLine(); break;
      case 'render': renderSubtitle(); break;
      case 'showNow': showNow(); break;
      case 'paint': paintAll(f.section, f.upTo); break;
      case 'unpaint': unpaintLines(f.section, f.lines); break;
      case 'replayStart': unlock(); replayWrote.clear(); break;
      case 'openStage': openStage(f.section, f.card, { delegate: true, autoplay: true, segment: f.segment }); break;
      case 'openAsk': { const s = S.sections[f.section]; if (s && s.lines[f.line]) openAskCard(f.section, s.lines[f.line]); break; }
      case 'send': send('', { action: f.action }); break;
      case 'scrollLast': { const last = $('#board').querySelector('[data-sec="' + (S.sections.length - 1) + '"] .c'); if (last) last.scrollIntoView({ block: 'start', behavior: 'instant' }); break; }
    }
  };
  // ---- 第一遍念的整节(《备课设计.md》拍板 34):念到哪露到哪,卡一张一张出来,和老师现讲时一样;停下等答、念完、孩子开口就整节在(shownCards) ----
  const syncUnfold = () => {
    let fresh = null;
    for (const i of [...S.unfold]) {
      const el = $('#board').querySelector(':scope > .sec[data-sec="' + i + '"]');
      if (!el || !S.sections[i]) { S.unfold.delete(i); continue; }
      const n = shownCards(S.state, S.sections, i);
      el.classList.toggle('pend', n < 0);
      for (const row of el.querySelectorAll(':scope > .row')) {
        let any = false;
        for (const c of row.querySelectorAll(':scope > [data-card]')) {
          const hide = n < 0 || Number(c.dataset.card) >= n;
          if (!hide && c.classList.contains('pend')) fresh = c;
          c.classList.toggle('pend', hide); any = any || !hide;
        }
        row.classList.toggle('pend', !any);
      }
      if (n === S.sections[i].cards.length) S.unfold.delete(i);
    }
    if (fresh) fresh.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  /**
   * 课文件交出去的话题、孩子还没开口(拍板 34):后面的节攒在 S.lq.queue,一节一节念。这时孩子说的、打的、拍的、交的卡都不发给老师——
   * 话攒在 said(第几节后说的)、照片攒在 photos,接着念下一节;最后一节之后孩子再开口才真发,攒着的一起带上(lessonSaid)
   */
  const nextLesson = (text, photos) => {
    const L = S.lq;
    if (text) L.said.push({ section: S.sections.length, text });
    if (photos && photos.length) L.photos.push(...photos);
    unlock();
    dispatch({ type: 'send' });
    if (S.stage) closeStage();
    const e = L.queue.shift();
    S.sections.push(e);
    const idx = S.sections.length - 1;
    $('#board').append(renderSection(e, idx));
    if (S.autoplay) S.unfold.add(idx);
    dispatch({ type: 'fresh', sections: [idx], silent: false });
    renderHeader();
  };
  // ---- 录像的实录(《家长录像设计.md》§4,只在孩子端):孩子看到、听到、做了什么,攒着每 10 秒一批发给服务端(页面退到后台时 sendBeacon)。
  //      只记今天、能发消息的话题(以前的只读回放不记);卡的每次改动服务端在存卡时自己记。发不出去就丢,不重试 ----
  const PLAY = { buf: [], last: '' };
  const playRec = (r) => {
    if (PARENT || !S.tutor || S.readonly || S.hist) return;
    PLAY.buf.push({ tutor: S.tutor.name, thread: S.newThread ? null : S.thread, rec: { at: Date.now(), ...r } });
    if (PLAY.buf.length > 600) PLAY.buf.splice(0, PLAY.buf.length - 600);
  };
  /** 播放器的位置变了才记(哪一节 · 第几句 · 在念 / 暂停 / 等答 …) */
  const playNote = () => {
    const st = S.state, sec = S.sections[st.section];
    const key = [sec ? sec.job : '', st.line, st.status, st.replay ? 1 : 0].join('|');
    if (key === PLAY.last) return;
    PLAY.last = key;
    playRec({ k: 'play', job: sec ? sec.job : null, line: st.line, status: st.status, ...(st.replay ? { replay: true } : {}) });
  };
  const playFlush = (beacon) => {
    if (!PLAY.buf.length) return;
    const groups = new Map(), keep = [];
    for (const x of PLAY.buf) {
      // 新话题发出第一句之前还没有话题 id:等有了再发
      const th = x.thread || (S.tutor && S.tutor.name === x.tutor && !S.newThread ? S.thread : null);
      if (!th) { keep.push(x); continue; }
      const k = x.tutor + ' ' + th;
      if (!groups.has(k)) groups.set(k, { tutor: x.tutor, thread: th, records: [] });
      groups.get(k).records.push(x.rec);
    }
    PLAY.buf = keep.slice(-200);
    for (const g of groups.values()) {
      const url = '/api/kid/conversations/' + g.tutor + '/play';
      for (let i = 0; i < g.records.length; i += 400) {
        const body = JSON.stringify({ thread: g.thread, sentAt: Date.now(), records: g.records.slice(i, i + 400) });
        if (beacon && navigator.sendBeacon) { try { if (navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) continue; } catch {} }
        try { fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {}); } catch {}
      }
    }
  };
  setInterval(() => playFlush(false), 10000);
  window.addEventListener('pagehide', () => playFlush(true));
  document.addEventListener('visibilitychange', () => { playRec({ k: 'visible', on: !document.hidden }); if (document.hidden) playFlush(true); });
  const dispatch = (ev) => {
    const r = step({ state: S.state, replayOf: S.replayOf, contGuardUntil: S.contGuard, held: S.held }, ev, { sections: S.sections, pending: S.pending, autoplay: S.autoplay, readonly: S.readonly, stage: Boolean(S.stage), recording: Boolean(S.rec), limit: S.limit, now: Date.now() });
    S.state = r.model.state; S.replayOf = r.model.replayOf; S.contGuard = r.model.contGuardUntil; S.held = r.model.held;
    playNote();
    syncUnfold();
    for (const f of r.effects) runEffect(f);
  };

  const loadDay = async (silent) => {
    if (!S.tutor || S.reel) return;
    if (S.lsn) return loadLesson();
    try {
      // 今天、选了话题:带上它,服务端把 resume 那个预热进程换成这个话题的(《工作流程.md》§四「预热」)
      const warmHint = (!S.hist && S.thread ? '?thread=' + encodeURIComponent(S.thread) : '') + (TRY && TRY.thread !== 'new' ? (S.thread ? '&' : '?') + 'try=' + encodeURIComponent(TRY.thread) : '');
      const d = await api('GET', (PARENT ? '/api/conversations/' + S.tutor.name + '/' + (S.hist || 'today') + '/board' : CONV + S.tutor.name + '/' + (S.hist || 'today')) + warmHint);
      setOffline(false);
      S.day = d;
      S.limit = typeof d.remaining === 'number' && d.remaining <= 0;
      // 话题:没选过就是当前(末条所在)的;板书只铺这个话题的节。新话题空白态什么都不铺,发出第一句才有话题
      if (!S.thread && !S.newThread) S.thread = d.thread;
      const mine = S.newThread ? [] : d.messages.filter((m) => m.thread === S.thread);
      if (PARENT) syncPrep(mine);
      const first = mine.find((m) => m.question !== null) || mine[0];
      S.threadAt = first ? first.at : null;
      const entries = sectionsFromMessages(mine);
      // 配音晚到(课文件交出去后配音在后台):已经拿到手的节(铺上的、课文件排着队的),句子的 mp3 到了就补上,还没念到的句用老师的声
      const held = [...S.sections, ...(S.lq ? S.lq.queue : [])];
      for (const e of entries) { const s = held.find((x) => x.job === e.job); if (s && s !== e) e.lines.forEach((l, i) => { const t = s.lines[i]; if (l.audio && t && !t.audio && t.text === l.text) t.audio = l.audio; }); }
      // 课文件交出去、孩子还没开口的话题,第一次铺:从第一节念起,后面的节攒着(拍板 34;家长端照孩子会看到的样子播)
      if (!S.sections.length && !S.played.size && !S.partial && canSend() && entries.length && entries.every((e) => typeof e.lessonSection === 'number') && !mine.some((m) => (PARENT ? m.from === 'kid' : m.question !== null))) {
        silent = false;
        if (entries.length > 1) { S.lq = { queue: entries.slice(1), said: [], photos: [] }; for (const e of S.lq.queue) S.played.add(e.job); }
      }
      const fresh = [];
      for (const e of entries) {
        if (S.partial && S.partial.job === e.job && S.partial.live) { if (e.partial) renderLive(e); else finalizeLive(e); continue; }
        if (S.played.has(e.job)) continue;
        if (e.partial) { renderLive(e); continue; }
        S.played.add(e.job); S.sections.push(e); fresh.push(S.sections.length - 1);
        const idx = S.sections.length - 1;
        if (!silent && S.autoplay) S.unfold.add(idx);
        if (S.partial && S.partial.job === e.job) {
          // 流式时一行一张先铺着;跑完了按定稿的行整节重画,节的编号就是它现在的位置
          const el = S.partial.el; S.partial = null;
          el.replaceWith(renderSection(e, idx));
        } else $('#board').append(renderSection(e, idx));
      }
      // 这条既不 pending 也没定稿(运行出错了):撤掉;live 的那节也撤(孩子端出错的运行不出现)
      if (S.partial && !entries.some((e) => e.job === S.partial.job)) { const P = S.partial; S.partial = null; P.el.remove(); if (P.live) { S.sections.splice(P.idx, 1); dispatch({ type: 'liveDropped' }); } }
      // 服务端的状态是真相(别的设备上选的、重开页面):没在舞台里改着的卡照它画;props 也跟(场景卡的课包晚到,ready / 缩略图是服务端现读的)
      entries.forEach((e) => { const i = S.sections.findIndex((x) => x.job === e.job); if (i < 0 || fresh.includes(i)) return; e.cards.forEach((c, idx) => { const mine = S.sections[i].cards[idx]; if (!mine || (S.stage && S.stage.section === i && S.stage.card === idx)) return; const ds = JSON.stringify(mine.state) !== JSON.stringify(c.state), dp = JSON.stringify(mine.props) !== JSON.stringify(c.props); if (ds || dp) { mine.state = c.state; mine.props = c.props; repaintCard(i, idx); } }); });
      if (fresh.length && S.stage) closeStage();
      // 录音卡:后面又来了一节,前面各节的录音卡就锁住(一节一节铺的时候前面那节还不知道后面有)
      if (fresh.length) S.sections.forEach((sec, i) => { if (i < S.sections.length - 1) sec.cards.forEach((c, k) => { if (c.kind === 'record') repaintCard(i, k); }); });
      const stillPending = Boolean(d.pending) || d.messages.some((m) => m.pending);
      S.pending = stillPending;
      if (stillPending && !S.waitSince) S.waitSince = Date.now();
      if (fresh.length) dispatch({ type: 'fresh', sections: fresh, silent: Boolean(silent) });
      else renderSubtitle();
      if (PARENT) { S.msgs = mine; syncNotes(mine); renderLesson(); }
      if (!S.sections.length && !S.partial && !stillPending && !S.readonly && !$('#board .blank')) $('#board').append(blankBoard('想问什么?'));
      renderHeader();
      clearTimeout(S.pollTimer);
      if (stillPending) S.pollTimer = setTimeout(() => loadDay(false), 1000);
    } catch (e) {
      if (e && e.status === 404) return closeTutor();
      setOffline(true);
    }
  };
  // ---- 话题:右上角「更多」里的「以前的」「新话题」、空白态、只读回放;话题状态是头像旁的小标签 ----
  const dateLabel = (date, today) => {
    if (date === today) return '今天';
    const [y, mo, da] = date.split('-').map(Number);
    const t = today.split('-').map(Number);
    const diff = Math.round((new Date(t[0], t[1] - 1, t[2]) - new Date(y, mo - 1, da)) / 86400000);
    return diff === 1 ? '昨天' : mo + ' 月 ' + da + ' 日';
  };
  const clock = (at) => (at && at.length >= 16 ? at.slice(11, 16) : '');
  const renderHeader = () => {
    if (!S.tutor) return;
    const today = S.day ? S.day.date : null;
    let mo = '';
    // 家长的备课话题一直亮着「孩子看不到」,交了就是「已交给孩子」(节头有时间,这里不带,手机宽度下带了就顶到右上角的喇叭底下)
    if (PARENT && S.lsn) mo = '课文件「' + S.lsn.name + '」 · ' + (S.lsn.page && S.lsn.page.handed ? '已交给孩子' : '孩子看不到');
    else if (PARENT && S.tryout) mo = '试用 · 明天删';
    else if (PARENT && (S.newThread || S.prep)) mo = S.prep === 'handed' ? '备课 · 已交给孩子' : '备课 · 孩子看不到';
    else if (PARENT) mo = [S.reel ? '录像' : '', S.hist && S.home ? dateLabel(S.hist, S.home.today) : '', clock(S.threadAt)].filter(Boolean).join(' · ');
    else if (S.hist && today) mo = '以前的 · ' + dateLabel(S.hist, S.hist === today ? '' : today) + ' ' + clock(S.threadAt);
    else if (S.cont && today) { const d = dateLabel(S.cont, today); mo = '接着' + (d === '昨天' ? d : ' ' + d + ' ') + '的话题'; }
    else if (S.newThread) mo = '新话题';
    else if (S.thread && S.day && S.thread !== S.day.thread) mo = '今天的话题 · ' + clock(S.threadAt);
    $('#c-mo').textContent = mo; $('#c-mo').hidden = !mo;
    $('#reel-btn').hidden = !reelCanOpen();
    const nb = $('#new-btn');
    nb.hidden = S.newThread || S.readonly || (!S.sections.length && !S.pending && !S.partial);
    nb.classList.toggle('dim', S.pending);
  };
  // 家长端的 chrome:孩子的话题卡锁着(S.readonly:选择 / 填空 / 画板不开、没有「继续」)、没有「回到今天」(回清单走左上角)、没有「更多」;
  // 今天的那页输入条在——家长真发(《家长板书页设计.md》第六节 3):打字 / 按住说话 / 拍作业照片,from: parent。家长自己开的备课话题卡与「继续」也开着
  /** 能不能发消息:孩子端 = 不只读;家长端 = 今天 */
  const canSend = () => (PARENT ? !S.lsn && (!S.hist || Boolean(S.home && S.hist === S.home.today)) : !S.readonly);
  const renderBar = () => { $('#pill').hidden = !canSend(); $('#back-today').hidden = !S.readonly || PARENT; };
  $('#more-btn').hidden = PARENT;
  const resetBoard = () => { dispatch({ type: 'halt' }); if (S.stage) closeStage(); clearTimeout(S.pollTimer); S.sections = []; S.played = new Set(); S.unfold = new Set(); S.lq = null; dispatch({ type: 'reset' }); S.partial = null; $('#board').replaceChildren(); };
  /** 换到某天的某个话题:今天的能接着聊;以前的只读回放(从第一句播) */
  const switchThread = (date, thread) => {
    resetBoard();
    S.hist = date; S.readonly = Boolean(date); S.thread = thread; S.newThread = false; S.threadAt = null; S.via = null; S.cont = null;
    renderBar(); renderSubtitle(); renderHeader();
    loadDay(!S.readonly);
  };
  $('#back-today').addEventListener('click', () => switchThread(null, null));
  $('#more-btn').innerHTML = ICON.more;
  const closeMenu = () => $('#menu').classList.remove('on');
  $('#more-btn').addEventListener('click', () => $('#menu').classList.add('on'));
  $('#menu .dimmer').addEventListener('click', closeMenu);
  $('#new-btn .ic').innerHTML = ICON.spark;
  $('#new-btn').addEventListener('click', () => {
    closeMenu();
    if (S.pending || S.readonly) return;
    resetBoard();
    S.newThread = true; S.thread = null; S.threadAt = null;
    S.via = null; S.cont = null;
    $('#board').append(blankBoard('换个话题吧,想问什么?'));
    setBar('idle'); renderSubtitle(); renderHeader();
  });
  $('#hist-btn .ic').innerHTML = ICON.history;
  $('#hist-x').innerHTML = ICON.close;
  const closeHist = () => $('#hist').classList.remove('on');
  $('#hist-x').addEventListener('click', closeHist);
  $('#hist .dimmer').addEventListener('click', closeHist);
  $('#hist-btn').addEventListener('click', async () => {
    closeMenu();
    if (!S.tutor) return;
    const ls = $('#hist .ls'); ls.replaceChildren();
    $('#hist').classList.add('on');
    try {
      const hst = await api('GET', CONV + S.tutor.name + '/history?days=30');
      const nodes = [];
      for (const dd of hst.days) {
        nodes.push(h('div', { class: 'dt' }, dateLabel(dd.date, hst.today)));
        for (const t of dd.threads) {
          const open = t.thread === S.thread && (dd.date === hst.today ? !S.hist : S.hist === dd.date);
          nodes.push(h('div', { class: 'tr' + (open ? ' on' : ''), on: { click: () => { closeHist(); if (!open) switchThread(dd.date === hst.today ? null : dd.date, t.thread); } } }, h('b', {}, t.title), h('small', {}, clock(t.at) + ' · ' + t.sections + ' 节 · ' + t.cards + ' 张卡' + (open ? ' · 正在看' : ''))));
        }
      }
      ls.replaceChildren(...(nodes.length ? nodes : [h('div', { class: 'empty' }, '还没有以前的')]));
    } catch { ls.replaceChildren(); }
  });
  const blobDataUrl = (blob) => new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => reject(fr.error); fr.readAsDataURL(blob); });
  const send = async (text, opts = {}) => {
    text = (text || '').trim();
    if (!text && !opts.action && !(opts.photos && opts.photos.length)) return;
    if (S.lq && S.lq.queue.length && S.tutor) return nextLesson(text, opts.photos);
    if (!S.tutor || !canSend() || (S.limit && opts.action !== 'continue')) return;
    unlock();
    dispatch({ type: 'send' });
    S.pending = true; S.waitSince = Date.now(); renderSubtitle();
    const body = { text, device: S.device };
    if (opts.voice) { try { body.voice = { audio: await blobDataUrl(opts.voice.blob), seconds: Math.round(opts.voice.seconds * 10) / 10 }; } catch {} }
    if (opts.action) body.action = opts.action;
    if (opts.photos && opts.photos.length) body.photos = opts.photos;
    // 课文件念完了,孩子这才开口:前面几节后攒着的话与照片一起带上
    const L = S.lq;
    if (L && L.said.length) body.lessonSaid = L.said;
    if (L && L.photos.length) body.photos = [...L.photos, ...(body.photos || [])].slice(0, 9);
    const focus = opts.focus || (S.stage ? { card: S.stage.id } : null);
    if (focus) body.focus = focus;
    if (S.newThread) body.newThread = true; else if (S.thread) body.thread = S.thread;
    if (PARENT && S.newThread) body.prep = true;
    if (TRY) body.try = TRY.thread;
    if (S.via) body.via = S.via;
    try {
      const r = await api('POST', CONV + S.tutor.name + '/messages', body);
      S.via = null; if (L && S.lq === L) S.lq = null;
      if (r && r.thread) S.thread = r.thread;
      // 老师块的试用:第一句开了试用话题,之后都进它;地址换成真的话题,刷新还回这里
      if (TRY && TRY.thread === 'new' && r && r.thread) { TRY.thread = r.thread; try { history.replaceState(null, '', '?try=' + encodeURIComponent(TRY.tutor) + '/' + encodeURIComponent(r.thread)); } catch {} }
      S.newThread = false; { const blank = $('#board .blank'); if (blank) blank.remove(); }
      renderHeader();
      clearTimeout(S.pollTimer); S.pollTimer = setTimeout(() => loadDay(false), 1200);
    } catch (e) {
      // 忙 / 上限 / 不通:什么都不报;刷新一下让状态说话
      S.pending = false;
      if (e && e.status === 429) { S.limit = true; renderSubtitle(); } else if (e && e.status === 409) loadDay(true); else if (e && e.status === 400 && S.via) { S.via = null; closeTutor(); } else setOffline(true);
    }
  };

  // ---- 喇叭:自动朗读开关 ----
  const spk = $('#spk');
  const renderSpk = () => { spk.innerHTML = S.autoplay ? ICON.speaker : ICON.mute; spk.classList.toggle('on', S.autoplay); };
  spk.addEventListener('click', () => { S.autoplay = !S.autoplay; try { localStorage.setItem(AUTOPLAY_KEY, S.autoplay ? '1' : '0'); } catch {} renderSpk(); playRec({ k: 'autoplay', on: S.autoplay }); if (!S.autoplay) dispatch({ type: 'autoplayOff' }); });
  renderSpk();

  // ---- 旁注(《家长板书页设计.md》§3,只在家长板书页):不是卡,只读块。节前是谁说的(首页按钮字不算孩子说的)、孩子在板书上做的;
  //      节尾是没成 / 给家长的 / 记住了 / 已记进日记 / 提醒;卡下面一行灰字是答案(家长接口不剥)。节的元素靠 data-job 找;没有节的轮(出错、整理记忆)只有旁注 ----
  const NOTE_FROM = { kid: '孩子', parent: '家长', system: '系统' };
  /** 孩子按住说的那句:听原声,对一对识别认得对不对(《家长录像设计.md》拍板 4);再点一下停 */
  const voiceBtn = (v) => h('button', { type: 'button', class: 'pin voice', 'aria-label': '听原声', on: { click: (e) => {
    e.stopPropagation(); const b = e.currentTarget; const on = b.classList.contains('on');
    for (const x of document.querySelectorAll('.pin.voice.on')) x.classList.remove('on');
    dispatch({ type: 'halt' }); if (on) return;
    b.classList.add('on'); const tok = voiceToken;
    audioEl.onended = audioEl.onerror = () => { if (tok === voiceToken) b.classList.remove('on'); }; audioEl.onplaying = null;
    audioEl.src = AUDIO + S.tutor.name + '/' + v.audio.split('/').map(encodeURIComponent).join('/'); audioRate(1); audioEl.play().catch(() => b.classList.remove('on'));
  } } }, '▶ 原声 ' + (Math.round(v.seconds * 10) / 10) + ' 秒');
  const noteEl = (cls, tag, text) => h('div', { class: 'note ' + cls }, h('span', { class: 'tg' }, tag), h('span', { class: 'tx' }, text));
  const preNotes = (m) => {
    const out = [];
    if (m.bookkeep) out.push(noteEl('sys', '记账', '给这个话题记账'));
    else if (m.tidy) out.push(noteEl('sys', '整理', '记账后整理记忆'));
    // 从课文件建的轮(《备课设计.md》§10.5):不是谁说的话——第一节前一条「课文件 <名> · N 节」,后面的节前不出
    else if (typeof m.lessonSection === 'number') { if (m.lessonSection === 0) out.push(noteEl('sys', '课文件', (m.question || '').replace(/^课文件\\s*/, '') + ' · ' + (S.msgs || []).filter((x) => x.thread === m.thread && typeof x.lessonSection === 'number').length + ' 节' + (S.lesson && S.lesson.source ? ' · ' + S.lesson.source : ''))); }
    else {
      // 念课文件时孩子在各节后说的(当时没发,这一条带来)
      if (m.lessonSaid && m.lessonSaid.length) out.push(noteEl('said kid', '课上说的', m.lessonSaid.map((x) => '第 ' + x.section + ' 节后:' + x.text).join('\\n')));
      const said = m.via ? m.via.label : m.action === 'continue' ? '继续' : m.action === 'submit' ? '交给老师' : (m.question || '');
      if (said || m.from === 'kid') { const n = noteEl('said ' + (m.from || ''), m.via ? '首页' : (NOTE_FROM[m.from] || m.from || ''), said); if (m.voice) n.append(voiceBtn(m.voice)); out.push(n); }
    }
    // 在弹窗里想了多久、改过几次(《家长录像设计.md》§4.7,有实录才有)
    const took = (t) => !t ? '' : [t.think !== null ? '想了 ' + reelDuration(t.think) : '', t.changes > 1 ? '改过 ' + (t.changes - 1) + ' 次' : ''].filter(Boolean).map((x) => ' · ' + x).join('');
    if (m.cards && m.cards.length) out.push(noteEl('did', '做了', m.cards.map((c) => c.text + took(c.took)).join('\\n')));
    // 备课话题交给了孩子:开场那一节前标出来,之前的几节孩子看不到
    return out;
  };
  const postNotes = (m) => {
    const out = [];
    if (m.error) out.push(noteEl('err', '没成', m.error));
    if (m.parentText) out.push(noteEl('tail', '给家长', m.parentText.replace(/^## 家长\\s*/, '')));
    if (m.remembered && m.remembered.length) out.push(noteEl('mem', m.tidy ? '整理了记忆' : '记住了', m.remembered.join('\\n')));
    if (m.bookkeep && !m.pending && !m.error) out.push(noteEl('sys', '记账', '已记进日记'));
    if (m.warnings && m.warnings.length) out.push(noteEl('warn', '提醒', m.warnings.join('\\n')));
    // 备课轮:记忆段没写进 vault,给家长看老师想记什么;费用只在备课轮上(家长在花钱)
    if (m.memoryDraft && m.memoryDraft.length) out.push(noteEl('mem', '本来会记住的', m.memoryDraft.join('\\n')));
    return out;
  };
  // ---- 这节课(《备课设计.md》§十):备课话题里老师写的几节,「交给孩子」先写成课文件(lessons/<日期>-<话题>.md)再从文件建给孩子的话题;
  //      挑卡、改字在文件里做(工作台「备课」页或 Claude Code),底部「这节课」条只有张数与「交给孩子」 ----
  /** 这个话题是不是家长的备课话题、交了没有(S.prep = null / 'prep' / 'handed');S.lesson = 接口的这节课;卡与「继续」只在备课话题里开 */
  const syncPrep = (mine) => {
    const last = mine[mine.length - 1];
    S.lesson = (S.day && S.day.lessons && S.thread && S.day.lessons[S.thread]) || null;
    // 试用话题(《备课设计.md》§十二)不是这节课:底部条不出、卡锁着,在孩子端试
    S.tryout = mine.some((m) => m.tryout);
    S.prep = S.tryout ? null : S.newThread && !mine.length ? 'prep' : last && last.prep ? (S.lesson && S.lesson.handed ? 'handed' : 'prep') : null;
    const ro = !(S.prep && canSend());
    if (S.readonly !== ro) { S.readonly = ro; renderBar(); }
  };
  /** 能不能交:今天的、孩子还没开口的备课话题 */
  const lessonEditable = () => Boolean(S.prep && canSend() && !S.pending);
  const lessonApi = (body) => api('POST', '/api/conversations/' + S.tutor.name + '/' + S.home.today + '/threads/' + encodeURIComponent(S.thread) + '/lesson/hand', body);
  const renderLesson = () => {
    const bar = $('#lesson');
    if (PARENT && S.lsn) {
      const P = S.lsn.page;
      bar.hidden = !P; if (!P) return;
      const hd = P.handed;
      bar.classList.toggle('empty', !P.cards);
      $('#ls-n').textContent = '这节课 · ' + P.cards + ' 张卡' + (hd ? ' · 已交给孩子' + (hd.kidSpoke ? ' · 孩子答过了' : '') : P.fixes ? ' · ' + P.fixes + ' 条要改' : ' · 还没交');
      $('#ls-names').textContent = hd ? '首页上是「' + (hd.label || '…') + '」' + (hd.kidSpoke ? ';再交是新话题' : ';改了文件再交就覆盖') : P.fixes ? '改好文件再交;这页几秒后跟上' : '要挑卡、改字、排版,在电脑上改 ' + P.source + ',或在 Claude Code 里说「把这节课改改」';
      $('#ls-hand').hidden = false; $('#ls-hand').disabled = !P.cards || P.fixes > 0;
      $('#ls-try').hidden = false; $('#ls-try').disabled = !P.cards || P.fixes > 0;
      return;
    }
    $('#ls-try').hidden = true;
    if (!PARENT || !S.prep) { bar.hidden = true; return; }
    bar.hidden = false;
    const ids = (S.lesson && S.lesson.cards) || [];
    const names = ids.map((id) => { const [j, n] = id.split('/'); const m = (S.msgs || []).find((x) => x.job === j); const c = m && m.section && m.section.cards[Number(n)]; return c ? cardTitle(c) : ''; }).filter(Boolean);
    bar.classList.toggle('empty', !ids.length);
    const handed = S.prep === 'handed';
    const src = S.lesson && S.lesson.source;
    const dub = S.lesson && S.lesson.dubbing;
    $('#ls-n').textContent = !ids.length ? '这节课 · 还没有卡' : '这节课 · ' + ids.length + ' 张卡' + (handed ? ' · 已交给孩子' + (dub ? ' · 配音 ' + dub.done + ' / ' + dub.total + ' 句' : '') : src ? ' · 已写成课文件' : '');
    $('#ls-names').textContent = handed ? '首页上是「' + ((S.lesson && S.lesson.label) || '…') + '」' + (dub ? ' · 孩子这时按按钮,没配到的句先用浏览器的声' : '') + (src ? ' · 改 ' + src + ' 再交就覆盖' : '') : src ? src + ' · 要挑卡、改字去文件里改,再交一次就覆盖' : ids.length ? names.join(' · ') : '和老师聊出几节,满意了交给孩子';
    $('#ls-hand').disabled = !ids.length || !lessonEditable();
    $('#ls-hand').hidden = handed;
  };
  // 交给孩子:只填按钮字(预填这节课第一张卡上的第一句)
  $('#ls-hand').addEventListener('click', () => {
    if (S.lsn) {
      const P = S.lsn.page; if (!P || P.fixes || !P.cards) return;
      const line = P.sections[0] && P.sections[0].section.lines[0];
      $('#hd-ttl').textContent = '交给孩子 · ' + P.cards + ' 张卡';
      $('#hd-label').value = (P.handed && P.handed.label) || (line ? Array.from(line.text.replace(/[。!?!?,,、:;\\s]+$/, '')).slice(0, 16).join('') : '');
      const msg = $('#hd-msg'); msg.textContent = ''; msg.classList.remove('err');
      $('#hd-go').disabled = false;
      $('#hand').classList.add('on');
      setTimeout(() => $('#hd-label').focus(), 50);
      return;
    }
    if (!S.thread || !lessonEditable()) return;
    const first = (S.lesson && S.lesson.cards[0]) || '';
    const m = (S.msgs || []).find((x) => x.job === first.split('/')[0]);
    const line = m && m.section && m.section.lines.find((l) => l.anchor === null || l.anchor === Number(first.split('/')[1]));
    $('#hd-ttl').textContent = '交给孩子 · ' + ((S.lesson && S.lesson.cards.length) || 0) + ' 张卡';
    $('#hd-label').value = (S.lesson && S.lesson.label) || (line ? Array.from(line.text.replace(/[。!?!?,,、:;\\s]+$/, '')).slice(0, 16).join('') : '');
    const msg = $('#hd-msg'); msg.textContent = ''; msg.classList.remove('err');
    $('#hd-go').disabled = false;
    $('#hand').classList.add('on');
    setTimeout(() => $('#hd-label').focus(), 50);
  });
  // 试用(《备课设计.md》§十二):从这份课文件建一个试用话题(配音在后台),跳到孩子端扮孩子跑一遍;老师拿到的是孩子的上下文包,明天删
  $('#ls-try').addEventListener('click', async () => {
    const P = S.lsn && S.lsn.page; if (!P || P.fixes || !P.cards) return;
    const b = $('#ls-try'); b.disabled = true; b.textContent = '配音中…';
    try {
      // 服务端配完音才回(最多半分钟):试用时听到的就是老师的声,不是浏览器的
      const r = await api('POST', lsnUrl('/try'), {});
      if (r.url) { location.href = r.url; return; }
      toast('没试成:' + (r.issues || []).join(';')); b.disabled = false; b.textContent = '试用';
    } catch (e) { b.disabled = false; b.textContent = '试用'; toast(e && e.body && e.body.issues && e.body.issues.length ? '没试成:' + e.body.issues.join(';') : '没试成,再点一次'); }
  });
  const closeHand = () => $('#hand').classList.remove('on');
  $('#hd-cancel').addEventListener('click', closeHand);
  $('#hand .dimmer').addEventListener('click', closeHand);
  $('#hd-go').addEventListener('click', async () => {
    const label = $('#hd-label').value.trim(); const msg = $('#hd-msg');
    if (!label) { msg.textContent = '按钮上要有字'; msg.classList.add('err'); return; }
    $('#hd-go').disabled = true; msg.classList.remove('err'); msg.textContent = '交着…';
    try {
      if (S.lsn) {
        // 交给孩子(《备课设计.md》拍板 32):不到一秒就回(配音在后台),直接跳到交出去的那个话题——孩子会看到的样子,底部条上看配音进度
        const r = await api('POST', lsnUrl('/hand'), { label });
        if (!r.handed) { msg.classList.add('err'); msg.textContent = '没交成:\\n' + r.issues.join('\\n'); $('#hd-go').disabled = false; return; }
        closeHand();
        const t = S.tutor;
        openTutor(t, { kind: 'thread', thread: r.thread, date: r.date });
        toast(r.homeOk ? '交给孩子了,首页上是「' + r.label + '」' + (r.lines ? ';正在配音' : '') : '交了,但首页那行没发出去:' + r.issues.join(';'));
      } else {
        const r = await lessonApi('hand', { label });
        if (r.ok) { msg.textContent = '写成了 ' + r.source + ',首页上有了:' + r.label; setTimeout(closeHand, 2000); }
        else { msg.classList.add('err'); msg.textContent = '课文件写了(' + r.source + '),但没交成:\\n' + r.issues.join('\\n') + '\\n改好文件再交'; }
        loadDay(true);
      }
    } catch (e) {
      msg.classList.add('err'); $('#hd-go').disabled = false;
      msg.textContent = e && e.status === 409 && e.body && e.body.issues ? '没交成:\\n' + e.body.issues.join('\\n') : e && e.status === 409 ? '孩子已经开口了,或者老师还在写' : e && e.body && e.body.message ? e.body.message : '没交上,再试一次';
    }
  });
  // ---- 课文件页(《备课设计.md》§10.6):清单里点一份课文件进来,整份铺开——节头、卡按行(和孩子端同一套画法)、讲稿以「说」旁注插在它讲的那张卡后面、
  //      要改的钉在那张卡下面、末尾是讲法;不走播放器,每节一个喇叭想听才听(浏览器的声);文件一改一两秒后重铺(节的 job 带内容 hash) ----
  const lsnUrl = (tail) => '/api/lessons/' + encodeURIComponent(S.lsn.name) + tail;
  const openLesson = (t, name) => {
    unlock();
    S.tutor = t; S.sections = []; S.played = new Set(); S.unfold = new Set(); S.lq = null; dispatch({ type: 'reset' }); S.pending = false; S.limit = false; S.stage = null; S.partial = null; $('#stage').classList.remove('on');
    S.thread = null; S.threadAt = null; S.hist = null; S.readonly = true; S.newThread = false; S.via = null; S.cont = null; S.prep = null; S.lesson = null;
    S.lsn = { name, key: null, page: null };
    $('#hist').classList.remove('on'); $('#menu').classList.remove('on'); renderBar(); renderHeader(); renderLesson();
    $('#c-av').replaceWith(Object.assign(avatarEl(t), { id: 'c-av' }));
    $('#board').replaceChildren();
    $('#tutor').classList.add('on');
    setBar('idle');
    loadLesson();
  };
  /** 讲稿一句:标过的词(老师的 [词])高亮 */
  const markedText = (l) => {
    const text = l.text; const parts = [];
    const spots = (l.marks || []).map((m) => { const w = m.said || m.phrase; const i = w ? text.indexOf(w) : -1; return i < 0 ? null : { i, w }; }).filter(Boolean).sort((a, b) => a.i - b.i);
    let pos = 0;
    for (const sp of spots) { if (sp.i < pos) continue; parts.push(text.slice(pos, sp.i), h('mark', {}, sp.w)); pos = sp.i + sp.w.length; }
    parts.push(text.slice(pos));
    return parts;
  };
  const saidNote = (lines, ask) => { const tx = h('span', { class: 'tx' }); lines.forEach((l, i) => { if (i) tx.append('\\n'); tx.append(...markedText(l)); }); return h('div', { class: 'note said' }, h('span', { class: 'tg' }, '说'), tx, ask ? h('span', { class: 'pin ask' }, '停下等答') : null); };
  const issueNote = (x) => noteEl(x.level === 'fix' ? 'fix' : 'warn', x.level === 'fix' ? '要改' : '提醒', (x.line ? '第 ' + x.line + ' 行:' : '') + x.text);
  const renderLessonSection = (e, i, page) => {
    const s = e.section;
    const mine = (page.issues || []).filter((x) => x.section === i);
    const sec = h('div', { class: 'sec lsn heard', 'data-sec': i, 'data-job': e.job });
    sec.append(h('div', { class: 'sh' }, '第 ' + (i + 1) + ' 节 · ' + s.cards.length + ' 张卡 · ' + s.lines.length + ' 句' + (e.from ? ' · 第 ' + e.from + ' 行起' : ''), h('button', { type: 'button', class: 'again', 'aria-label': '听这节', html: ICON.replay, on: { click: (ev) => { ev.stopPropagation(); listenSection(i); } } })));
    const last = s.lines[s.lines.length - 1];
    const opening = s.lines.filter((l) => l.anchor === null);
    if (opening.length) sec.append(saidNote(opening, opening[opening.length - 1] === last && last.ask));
    rowEls(s, s.cards.map((c, k) => renderCard(c, k, i, false))).forEach(({ row, el }) => {
      sec.append(el);
      for (const x of mine) if (x.card !== undefined && row.includes(x.card)) sec.append(issueNote(x));
      const said = s.lines.filter((l) => l.anchor !== null && row.includes(l.anchor));
      if (said.length) sec.append(saidNote(said, said[said.length - 1] === last && last.ask));
    });
    for (const x of mine) if (x.card === undefined) sec.append(issueNote(x));
    answerNotes(sec, { section: s });
    return sec;
  };
  const renderLessonBoard = (page) => {
    const board = $('#board'); board.replaceChildren();
    S.sections = page.sections.map((e) => ({ job: e.job, at: e.at, cards: e.section.cards, lines: e.section.lines, layout: e.section.layout }));
    const global = (page.issues || []).filter((x) => x.section === undefined);
    if (global.length) board.append(h('div', { class: 'notes' }, ...global.map(issueNote)));
    page.sections.forEach((e, i) => board.append(renderLessonSection(e, i, page)));
    // 「## 素材」(《备课设计.md》§11.4):不铺在板上,孩子开口后老师拿;一行一份,带标题
    if (page.materials && page.materials.length) board.append(h('div', { class: 'notes' }, noteEl('brief', '素材', page.materials.map((m) => m.id + (m.title ? ' · ' + m.title : '') + (m.ok ? '' : '(放不出来:' + m.why + ')')).join('\\n') + '\\n\\n不铺在板上;孩子开口后老师需要时拿出来放')));
    if (page.brief) board.append(h('div', { class: 'notes' }, noteEl('brief', '讲法', page.brief.replace(/^##\\s+\\S.*\\n?/, '').trim() + '\\n\\n给老师的,孩子看不到;孩子答第一句时老师照它接')));
    if (!page.sections.length) board.append(blankBoard('这份课文件还是空的'));
  };
  const loadLesson = async () => {
    if (!S.lsn || !S.tutor) return;
    const L = S.lsn;
    try {
      const page = await api('GET', lsnUrl('/page'));
      if (S.lsn !== L) return;
      setOffline(false);
      const key = (page.mtime || '') + '|' + page.sections.map((e) => e.job).join() + '|' + page.fixes + '|' + JSON.stringify(page.handed) + '|' + page.issues.length;
      if (L.key !== key) { L.key = key; L.page = page; if (S.stage) closeStage(); stopListen(); renderLessonBoard(page); renderHeader(); renderLesson(); }
    } catch (e) { if (e && e.status === 404) return closeTutor(); setOffline(true); }
  };
  let lsnSpeak = null;
  const stopListen = () => { if (lsnSpeak === null) return; lsnSpeak = null; voiceToken++; try { audioEl.pause(); } catch {} try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch {} };
  /** 课文件的一句用老师的音色念(服务端现合成、有缓存);老师没配音色或合成失败退回浏览器的声。token 同 say:停了就不接着 */
  const sayLesson = (sec, k, text, onEnd) => {
    const token = ++voiceToken;
    const finish = () => { if (token === voiceToken) onEnd(); };
    const fallback = () => { if (token === voiceToken) speak(plainLine(text), finish, () => setTimeout(finish, lineDurationMs(text))); };
    try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch {}
    audioEl.onended = finish; audioEl.onerror = fallback; audioEl.onplaying = null;
    audioEl.src = lsnUrl('/say?s=' + sec + '&i=' + k);
    audioRate(1);
    audioEl.play().catch(fallback);
  };
  const listenSection = (i) => {
    const s = S.sections[i]; if (!s) return;
    if (lsnSpeak === i) return stopListen();
    stopListen(); lsnSpeak = i;
    let k = 0;
    const next = () => { if (lsnSpeak !== i) return; if (k >= s.lines.length) { lsnSpeak = null; return; } const n = k++; sayLesson(i, n, s.lines[n].text, next); };
    next();
  };
  const answerOf = (c) => {
    const p = c.props || {};
    if (c.kind === 'choice' && Array.isArray(p.answer) && p.answer.length) return p.answer.map((i) => ('ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i] || String(i + 1)) + (p.options && p.options[i] ? ' ' + p.options[i] : '')).join('、');
    if (c.kind === 'fill' && Array.isArray(p.answers) && p.answers.length) return p.answers.join(' / ');
    return '';
  };
  const answerNotes = (secEl, m) => {
    (m.section && m.section.cards || []).forEach((c, k) => {
      const a = answerOf(c);
      const el = a ? secEl.querySelector('.c[data-card="' + k + '"]') : null;
      if (el && !el.querySelector('.note-ans')) el.append(h('div', { class: 'note-ans' }, '答案:' + a));
    });
  };
  /** 每次 loadDay 之后:每条消息一前一后两个旁注块,位置永远贴着它的节(节晚到就挪过去);内容每次重写(文字很少) */
  const syncNotes = (mine) => {
    const board = $('#board');
    let prev = null;
    for (const m of mine) {
      const sec = board.querySelector(':scope > .sec[data-job="' + m.job + '"]');
      let pre = board.querySelector(':scope > .notes.pre[data-job="' + m.job + '"]');
      if (!pre) { pre = h('div', { class: 'notes pre', 'data-job': m.job }); if (sec) sec.before(pre); else if (prev) prev.after(pre); else board.prepend(pre); }
      else if (sec && sec.previousElementSibling !== pre) sec.before(pre);
      pre.replaceChildren(...preNotes(m));
      let post = board.querySelector(':scope > .notes.post[data-job="' + m.job + '"]');
      if (!post) { post = h('div', { class: 'notes post', 'data-job': m.job }); (sec || pre).after(post); }
      else if ((sec || pre).nextElementSibling !== post) (sec || pre).after(post);
      post.replaceChildren(...postNotes(m));
      if (sec) answerNotes(sec, m);
      prev = post;
    }
  };

  // ---- 看录像(《家长录像设计.md》,只在家长端):一个话题按时间重看。轨道是服务端推算好的(lib/reel.ts,已内联),
  //      这里只有一个时钟:每 100 毫秒算一次 reelFrameAt,板书用 renderSection 现画、露几张卡与卡的状态照它、标注画到念到的句、放当时那句的 mp3。
  //      不经过 step,S.state 不动(进来先 reset,板上不出「再听」);轮询停着(loadDay 见 S.reel 就回);退出时照原样重开这个话题 ----
  const REEL_SPEEDS = [1, 1.5, 2];
  const REEL_HINT = '孩子端还没上报之前的话题:念句的时刻是按「一拍就绪就顺着念」推的;课文件那几节从孩子第一次开口往前倒推。暂停、再听、选了又改都看不到';
  /** 孩子的话题、孩子开过口才有录像;备课话题(孩子还没开口)、课文件页没有 */
  const reelCanOpen = () => Boolean(PARENT && S.tutor && S.thread && !S.newThread && !S.lsn && !S.reel && (S.msgs || []).some((m) => m.from === 'kid'));
  const reelHms = (t) => { const d = new Date(t); const p2 = (n) => String(n).padStart(2, '0'); return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()); };
  /** 这一刻该出的旁注:节尾的(给家长的、记住了、没成、提醒)等这节念完 */
  const reelMsgs = (f) => f.notes.map((n) => { const m = S.reel.d.messages.find((x) => x.job === n.job); if (!m) return null; return n.post ? m : { ...m, error: undefined, parentText: undefined, remembered: undefined, warnings: undefined, memoryDraft: undefined }; }).filter(Boolean);
  const reelSetClock = () => {
    const R = S.reel;
    const w = R.clock ? R.clock.toWall(R.p) : R.d.reel.startAt;
    R.clock = reelClock(R.d.reel, R.real);
    R.p = R.clock.toPlay(w);
    $('#rl-seek').max = String(Math.max(1, Math.round(R.clock.total)));
    $('#rl-marks').replaceChildren(...R.d.reel.marks.map((m) => h('i', { class: m.kind, title: reelHms(m.at) + ' ' + m.label, style: 'left:' + (100 * R.clock.toPlay(m.at) / Math.max(1, R.clock.total)).toFixed(2) + '%', on: { click: () => reelSeek(R.clock.toPlay(m.at)) } })));
    // 「跳过空白」缺省开着(压缩);关掉 = 按真实时间放
    $('#rl-skip').checked = !R.real;
  };
  /** 板书:哪几节、卡的状态、旁注变了就整块重画(往回拖也是);露几张卡、标注画到哪每次对一下 */
  /** 弹窗(实录):孩子开着哪张就只读地开哪张,改了就重画(重卡重发一次 card);关了就关。弹窗里点不动、没有关闭钮(见 CSS body.reel) */
  const reelStage = (f, rebuilt) => {
    const R = S.reel;
    const i = f.stage ? S.sections.findIndex((x) => x.job === f.stage.job) : -1;
    const want = i >= 0 && S.sections[i].cards[f.stage.card] ? f.stage.job + '/' + f.stage.card : '';
    if (!want) { if (S.stage) { closeStage(); R.now = ''; } R.stageKey = ''; return; }
    const card = S.sections[i].cards[f.stage.card];
    const sk = JSON.stringify(card.state === undefined ? null : card.state);
    if (R.stageKey !== want || !S.stage) { if (S.stage) closeStage(); openStage(i, f.stage.card, { delegate: true }); R.stageKey = want; R.stageState = sk; return; }
    S.stage.section = i;
    if (sk === R.stageState && !rebuilt) return;
    R.stageState = sk;
    if (isHeavy(card)) postStage(stageCard(card)); else renderStage();
  };
  const reelDraw = (f) => {
    const R = S.reel;
    const shown = f.sections.filter((fs) => R.entries.some((e) => e.job === fs.job));
    const key = JSON.stringify([shown.map((fs) => fs.job), f.cards, f.notes]);
    if (key !== R.key || shown.some((fs) => (R.painted[fs.job] || 0) > fs.spoken)) {
      R.key = key; R.painted = {}; R.now = '';
      S.sections = shown.map((fs) => { const e = R.entries.find((x) => x.job === fs.job); return { ...e, cards: e.cards.map((c, k) => { const o = { ...c }; const st = f.cards[fs.job + '/' + k]; if (st === undefined) delete o.state; else o.state = st; return o; }) }; });
      const board = $('#board'); const top = board.scrollTop;
      board.replaceChildren(...S.sections.map((sec, i) => renderSection(sec, i)));
      syncNotes(reelMsgs(f));
      board.scrollTop = top;
      R.rebuilt = true;
    }
    let fresh = null;
    shown.forEach((fs, i) => {
      const el = $('#board').querySelector(':scope > .sec[data-sec="' + i + '"]'); if (!el) return;
      for (const row of el.querySelectorAll(':scope > .row')) {
        let any = false;
        for (const c of row.querySelectorAll(':scope > [data-card]')) { const hide = Number(c.dataset.card) >= fs.cards; if (!hide && c.classList.contains('pend')) fresh = c; c.classList.toggle('pend', hide); any = any || !hide; }
        row.classList.toggle('pend', !any);
      }
      if (fs.spoken > (R.painted[fs.job] || 0)) { paintAll(i, fs.spoken - 1); R.painted[fs.job] = fs.spoken; }
    });
    // 念到哪张亮哪张
    const at = f.saying || f.last;
    const i = at ? S.sections.findIndex((x) => x.job === at.job) : -1;
    const nk = i >= 0 ? i + '/' + at.line : '';
    if (nk !== R.now) { R.now = nk; if (i >= 0) { setNow(i, nowCard(S.sections, { section: i, line: at.line, status: 'playing' })); const el = $('#board .c.now'); if (el) fresh = el; } }
    // 跟着最新的走:板上看得见的多了(新的一节、旁注、露出来的卡——不只是卡)或刚拖过进度条,就滚到最底下那个;
    // 只是念到了上面另一张卡,滚到那张。重画时 scrollTop 原样留着,不滚的话新加在底下的旁注就在屏幕外
    const board = $('#board');
    const seen = board.querySelectorAll(':scope > .sec, :scope > .notes > .note, :scope > .sec .c:not(.pend)').length;
    if (seen > R.seen || R.follow) {
      const tail = [...board.querySelectorAll(':scope > .sec, :scope > .notes > .note')].reverse().find((el) => el.getClientRects().length);
      if (tail) tail.scrollIntoView({ block: 'end', behavior: R.follow ? 'instant' : 'smooth' });
    } else if (fresh) fresh.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    R.seen = seen; R.follow = false;
    reelStage(f, R.rebuilt); R.rebuilt = false;
  };
  /** 声音:换了一句(或孩子的一段录音、原声)就从这一刻的偏移放那个文件;没配音的句不出声(字幕照出) */
  const reelVoice = (f) => {
    const R = S.reel;
    const cur = f.saying ? 's:' + f.saying.job + '/' + f.saying.line : f.clip ? 'c:' + f.clip.kind + ':' + f.clip.job + '/' + f.clip.card : '';
    if (cur === R.voice) return;
    R.voice = cur;
    silence();
    const x = f.saying || f.clip;
    if (!R.playing || R.seeking || !x || !x.audio) return;
    audioEl.onended = null; audioEl.onerror = null; audioEl.onplaying = null;
    audioEl.src = AUDIO + S.tutor.name + '/' + x.audio.split('/').map(encodeURIComponent).join('/') + (x.offset > 300 ? '#t=' + (x.offset / 1000).toFixed(2) : '');
    audioEl.defaultPlaybackRate = R.speed; audioEl.playbackRate = R.speed;
    audioEl.play().catch(() => {});
  };
  /** 字幕行:念着的句;孩子的录音;等老师(拍板 1:只露等老师多久、孩子想了多久);老师停下等孩子;别的时候留着上一句 */
  const reelSub = (f) => {
    const R = S.reel, el = $('#sub-text');
    const lineOf = (x) => { const sec = x && R.entries.find((e) => e.job === x.job); return sec && sec.lines[x.line] ? plainLine(sec.lines[x.line].text) : ''; };
    let text = '', cls = 'line';
    if (f.saying) text = lineOf(f.saying);
    else if (f.clip && f.clip.kind === 'voice') { text = '🎙 孩子的原声 · 认成「' + (f.clip.text || '') + '」'; cls = 'replay'; }
    else if (f.clip) { text = '🎙 孩子的录音'; cls = 'replay'; }
    else if (f.gap && f.gap.kind === 'wait') { text = '⏳ 等老师 ' + reelDuration(f.gap.ms); cls = 'gap'; }
    else if (f.wait) { text = '⏳ 等老师 ' + reelDuration(f.wait.ms); cls = 'gap'; }
    else if (f.away) { text = '📴 孩子切到别处了'; cls = 'gap'; }
    else if (f.thinking) { text = '⏱ 想了 ' + reelDuration(f.thinking.ms); cls = 'gap'; }
    else if (f.gap) { text = (f.gap.cont ? '⏩ 又过了 ' : '⏩ 孩子想了 ') + reelDuration(f.gap.ms); cls = 'gap'; }
    else if (f.last) { text = lineOf(f.last) + (f.asking ? '  ⏸ 等孩子' : ''); cls = 'gap'; }
    el.className = cls; el.textContent = text;
  };
  const reelTick = () => {
    const R = S.reel; if (!R) return;
    const now = performance.now();
    if (R.playing && !R.seeking) R.p = Math.min(R.clock.total, R.p + (now - R.last) * R.speed);
    R.last = now;
    const t = R.clock.toWall(R.p);
    const f = reelFrameAt(R.d.reel, t);
    reelDraw(f); reelVoice(f); reelSub(f);
    if (!R.seeking) $('#rl-seek').value = String(Math.round(R.p));
    $('#rl-clock').textContent = reelHms(t);
    if (R.playing && R.p >= R.clock.total) reelPlay(false);
  };
  const reelPlay = (on) => {
    const R = S.reel; if (!R) return;
    if (on && R.p >= R.clock.total) R.p = 0;
    R.playing = on; R.last = performance.now(); R.voice = null;
    clearInterval(R.timer); R.timer = on ? setInterval(reelTick, 100) : null;
    $('#rl-play').innerHTML = on ? ICON.pause : ICON.play;
    $('#rl-play').setAttribute('aria-label', on ? '暂停' : '播放');
    reelTick();
  };
  const reelSeek = (p) => { const R = S.reel; if (!R) return; R.p = Math.max(0, Math.min(R.clock.total, p)); R.last = performance.now(); R.voice = null; R.follow = true; reelTick(); };
  /** 只收拾录像自己的东西(关老师页时也调);不重开话题 */
  const reelStop = () => {
    const R = S.reel; if (!R) return;
    clearInterval(R.timer); S.reel = null; silence(); if (S.stage) closeStage();
    document.body.classList.remove('reel'); $('#reel').hidden = true;
  };
  const reelOpen = async () => {
    if (!reelCanOpen()) return;
    unlock();
    let d;
    try { d = await api('GET', '/api/conversations/' + S.tutor.name + '/' + (S.hist || 'today') + '/threads/' + encodeURIComponent(S.thread) + '/reel'); }
    catch { toast('这个话题没有录像'); return; }
    if (!S.tutor || S.reel) return;
    clearTimeout(S.pollTimer); psClose(); stopListen();
    if (S.stage) closeStage();
    dispatch({ type: 'reset' });
    S.partial = null;
    S.reel = { d, entries: sectionsFromMessages(d.messages), real: false, speed: 1, p: 0, playing: false, seeking: false, last: 0, key: '', painted: {}, now: '', voice: null, timer: null, clock: null, seen: 0, follow: false };
    reelSetClock();
    $('#rl-speed').textContent = '1×';
    $('#rl-tag').hidden = d.reel.precise;
    document.body.classList.add('reel'); $('#reel').hidden = false;
    $('#board').replaceChildren();
    renderHeader();
    reelPlay(true);
  };
  const reelClose = () => { if (!S.reel) return; const t = S.tutor, th = S.thread, date = S.hist; reelStop(); openTutor(t, { kind: 'thread', thread: th, date }); };
  $('#reel-btn').innerHTML = ICON.reel;
  $('#reel-btn').addEventListener('click', reelOpen);
  $('#rl-play').addEventListener('click', () => { if (S.reel) reelPlay(!S.reel.playing); });
  $('#rl-x').addEventListener('click', reelClose);
  $('#rl-tag').addEventListener('click', () => toast(REEL_HINT));
  $('#rl-skip').addEventListener('change', (e) => { const R = S.reel; if (!R) return; R.real = !e.target.checked; reelSetClock(); R.voice = null; reelTick(); });
  $('#rl-speed').addEventListener('click', (e) => { const R = S.reel; if (!R) return; R.speed = REEL_SPEEDS[(REEL_SPEEDS.indexOf(R.speed) + 1) % REEL_SPEEDS.length]; e.currentTarget.textContent = R.speed + '×'; audioEl.defaultPlaybackRate = R.speed; audioEl.playbackRate = R.speed; });
  // 拖的时候不出声,松手从那一刻接着放
  $('#rl-seek').addEventListener('input', (e) => { const R = S.reel; if (!R) return; R.seeking = true; R.p = Number(e.target.value); R.voice = null; R.follow = true; reelTick(); });
  $('#rl-seek').addEventListener('change', () => { const R = S.reel; if (!R) return; R.seeking = false; reelSeek(R.p); });

  // ---- 输入条:相机 | 发消息或按住说话 | 加号 ----
  $('#cam').insertAdjacentHTML('afterbegin', ICON.camera);
  $('#plus').innerHTML = ICON.plus;
  $('#go').innerHTML = ICON.send;
  $('#ic-album').innerHTML = ICON.album; $('#ic-cam2').innerHTML = ICON.camera;
  const setBar = (mode) => {
    S.bar = mode;
    $('#ph').hidden = mode === 'typing'; $('#typed').hidden = mode !== 'typing'; $('#go').hidden = mode !== 'typing';
    $('#hold').classList.toggle('on', mode === 'holding');
    if (mode === 'typing') $('#typed').focus();
  };
  const mid = $('#mid'), typed = $('#typed');
  $('#go').addEventListener('click', () => { const t = typed.value; typed.value = ''; setBar(barNext(S.bar, 'sent')); send(t); });
  typed.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#go').click(); } });
  typed.addEventListener('blur', () => { if (!typed.value.trim()) setBar(barNext(S.bar, 'blur')); });
  $('#plus').addEventListener('click', () => $('#sheet').classList.add('on'));
  $('#sheet .dimmer').addEventListener('click', () => $('#sheet').classList.remove('on'));
  $('#hold .w').replaceChildren(...[6, 10, 16, 22, 12, 26, 18, 8, 14, 24, 20, 10, 16, 28, 12, 8, 18, 22, 10, 14, 6, 12, 20, 16, 8].map((v, i) => h('i', { style: 'height:' + v + 'px;animation-delay:' + (i * 37 % 400) + 'ms' })));

  // 中间那段:点 = 打字;按住 150ms = 说话(浏览器识别),松手发,上滑 60px 取消;没有识别就只有打字
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // 识别一起就断(2026-09-21 真机:iPad 从主屏幕图标打开时 SR 在、麦克风也有声,但 start 后 15ms 必回 aborted,26 次 25 次;Safari 里 50 次 0 次):
  // 认出来一次,这次打开就当没有识别——按住 = 点一下打字(键盘上的听写照样能说),不再闪一下浮层。不看 navigator.standalone:哪天系统修了自然就好
  let srDead = false; try { srDead = sessionStorage.getItem('kid-sr-dead') === '1'; } catch {}
  const srOk = () => Boolean(SR) && !srDead;
  const srDied = () => { srDead = true; try { sessionStorage.setItem('kid-sr-dead', '1'); } catch {} const ph = $('#ph'); if (ph) ph.textContent = PH_IDLE(); };
  const PH_IDLE = () => (srOk() ? '发消息或按住说话…' : '发消息…');
  $('#ph').textContent = PH_IDLE();
  let press = null, rec = null, finalText = '';
  // 麦克风常开(真机诊断 2026-09-19,/voice-test)。这台 iPad 上的三条事实:
  // ① Safari 的识别每次自己开关话筒,常交来一路纯静音,一个字不出、一停就 aborted;页面自己先 getUserMedia 留一路,识别再起就有声(先麦克风、后识别)
  // ② 麦克风关了再开,也常开到哑的 → 开了就不关(只有页面退到后台才放,那时系统本来也会掐);开完自检 600ms,纯 0 就拆掉重开,最多 3 回
  // ③ 冷开要 1 秒多,这段时间说的字进不去 → 给过权限之后,进老师页就先开好(micWarm)
  // 这一路画音量条;按住说话时也在它上面录下原声,随那句话发给服务端,只给家长端(《家长录像设计.md》拍板 4)。每次开麦克风也记一行诊断(where: 'mic')
  const mic = { stream: null, ac: null, an: null, buf: null, opening: null, ok: true };
  const micLive = () => { const t = mic.stream && mic.stream.getAudioTracks()[0]; return Boolean(t && t.readyState === 'live' && !t.muted && mic.ok); };
  const micDrop = () => { if (mic.stream) { for (const t of mic.stream.getTracks()) t.stop(); } if (mic.ac) { try { mic.ac.close(); } catch {} } mic.stream = mic.ac = mic.an = mic.buf = null; };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** 这一路有没有声:600ms 里采样全是 0 = 哑的(安静也有底噪);没有分析器就当它有 */
  const micProbe = async () => {
    if (!mic.an || mic.ac.state !== 'running') return true; // 分析器没在跑(没有手势时会被挂起)读出来也全是 0,不能当哑的
    const an = mic.an, buf = mic.buf, t1 = Date.now();
    while (Date.now() - t1 < 600) {
      an.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) if (buf[i] !== 0) return true;
      await wait(50);
    }
    return false;
  };
  const micOpenOnce = async () => {
    const st = await new Promise((resolve, reject) => {
      let late = false; const timer = setTimeout(() => { late = true; reject(new Error('timeout')); }, 6000);
      navigator.mediaDevices.getUserMedia({ audio: true }).then((x) => { clearTimeout(timer); if (late) { for (const t of x.getTracks()) t.stop(); } else resolve(x); }, (e) => { clearTimeout(timer); reject(e); });
    });
    mic.stream = st;
    try { localStorage.setItem('kid-mic-ok', '1'); } catch {}
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      mic.ac = new AC(); mic.an = mic.ac.createAnalyser(); mic.an.fftSize = 512; mic.buf = new Float32Array(512);
      mic.ac.createMediaStreamSource(st).connect(mic.an);
      if (mic.ac.state === 'suspended') await mic.ac.resume().catch(() => {});
    } catch { mic.an = null; }
  };
  /** 要一路有声的麦克风:hot(本来就开着)/ open(新开的,自检过)/ dead(重开 3 回还是哑的)/ none(浏览器没有);同时只开一次 */
  const micOpen = () => {
    if (micLive()) return Promise.resolve('hot');
    if (mic.opening) return mic.opening;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve('none');
    const t0 = Date.now(), ev = [], mark = (k, v) => ev.push(v === undefined ? [k, Date.now() - t0] : [k, Date.now() - t0, v]);
    const job = (async () => {
      for (let i = 0; i < 4; i++) {
        micDrop(); if (i) { mark('retry', i); await wait(400 * i); }
        await micOpenOnce(); mark('open');
        mic.ok = await micProbe(); mark(mic.ok ? 'alive' : 'dead');
        if (mic.ok) return 'open';
      }
      return 'dead';
    })();
    mic.opening = job;
    const fin = (tail) => { if (mic.opening === job) mic.opening = null; if (tail) mark(tail[0], tail[1]); try { fetch('/api/kid/voice-diag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ where: 'mic', ua: navigator.userAgent, ev }), keepalive: true }).catch(() => {}); } catch {} };
    job.then(() => fin(null), (e) => fin(['fail', String(e && (e.name || e.message))]));
    return job;
  };
  const micWarm = () => {
    let ok = false; try { ok = localStorage.getItem('kid-mic-ok') === '1'; } catch {}
    if (!ok || !srOk() || !S.tutor || !canSend() || document.hidden || micLive()) return;
    micOpen().catch(() => {});
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (!mic.opening) micDrop(); } else micWarm(); });
  document.addEventListener('pointerdown', micWarm, true);
  document.addEventListener('touchstart', () => {}, { passive: true }); // iOS Safari:没有触摸监听时 :active 不一定触发,按压反馈靠它
  /** 起一次浏览器识别:onText(到目前认出的整句),onEnd(停了),onAudio(话筒真的开了),onLevel(这一帧的音量 0–1);没有识别 → null。
   *  回来的是个把手(识别要等麦克风开了才起):live / held / diagMark / stop() / abort()(不回 onEnd)。
   *  识别是单句的(continuous 关):Safari 听到停顿 1.5 秒左右就自己停(2026-09-28 真机:孩子说到 12 秒想了一下,话被截走发了)。
   *  所以手还按着(held)它自己停了,就再起一段接着认、字拼在后面;松手(settle 把 held 置假)之后停了才算完。
   *  段与段之间补一个逗号:Safari 认中文不带标点,停顿是唯一的断句,不补老师收到的是一口气连着的一串(2026-10-01 真机) */
  const listen = (onText, onEnd, where, onAudio, onLevel) => {
    if (!srOk()) return null;
    // 诊断:每次按住记一行事件码 + 距按下的毫秒(不记字、不记声音),停了发给 /api/kid/voice-diag;真机上出错是静默的,只有这份能说清哪一步断了
    const t0 = Date.now(), ev = [], mark = (k, v) => ev.push(v === undefined ? [k, Date.now() - t0] : [k, Date.now() - t0, v]);
    const diag = { where, standalone: Boolean(navigator.standalone), wasPlaying: !audioEl.paused, ua: navigator.userAgent, peak: -1, ev };
    const report = () => { try { fetch('/api/kid/voice-diag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(diag), keepalive: true }).catch(() => {}); } catch {} };
    const hd = { live: { len: 0, lastAt: 0, done: false }, held: true, diagMark: mark, r: null, voice: null };
    // 原声(《家长录像设计.md》拍板 4):识别的同时在常开的那一路上录;收尾(close)时停,hd.voice 给 {blob, seconds} 或 null(没录上、放弃了)
    let vr = null, vchunks = [], vt0 = 0, vdone = null;
    hd.voice = new Promise((resolve) => { vdone = resolve; });
    const voiceStart = () => {
      if (vr) { try { vr.ondataavailable = null; vr.stop(); } catch {} vr = null; }
      vchunks = [];
      if (!window.MediaRecorder || !mic.stream) return;
      try {
        const mime = recMime();
        vr = mime ? new MediaRecorder(mic.stream, { mimeType: mime }) : new MediaRecorder(mic.stream);
        vr.ondataavailable = (e) => { if (e.data && e.data.size) vchunks.push(e.data); };
        vt0 = Date.now(); vr.start();
      } catch { vr = null; }
    };
    const voiceEnd = (keep) => {
      const r = vr; vr = null;
      if (!r) { vdone(null); return; }
      const seconds = (Date.now() - vt0) / 1000;
      r.onstop = () => vdone(keep && vchunks.length ? { blob: new Blob(vchunks, { type: r.mimeType || 'audio/webm' }), seconds } : null);
      try { r.stop(); } catch { vdone(null); }
    };
    // again:手按着接着认了几段;prev:前几段认出的字(带着断句的逗号);cur:这一段的;active:这一段还在认(停了、下一段还没起时 stop 直接收尾)
    let raf = 0, round = 0, again = 0, startedAt = 0, errored = '', prev = '', cur = '', active = false;
    const joined = (s) => (prev && s && !/[，。！？、,.!?…]$/.test(prev) ? prev + '，' + s : prev + s);
    const close = (keep) => { hd.live.done = true; cancelAnimationFrame(raf); voiceEnd(keep); report(); };
    const done = () => { if (hd.live.done) return; mark('end', hd.live.len); close(true); const dead = !again && Boolean(errored) && errored !== 'no-speech' && !hd.live.len && Date.now() - startedAt < 500; if (dead) { mark('sr-dead'); srDied(); } onEnd(dead); };
    // 这一段停了:手还按着就接着认,除非这段一起就断(不是没听到声音、没出字、不到 500ms)、页面退到了后台或已经接了 40 段
    const ended = () => {
      active = false;
      if (hd.live.done) return;
      const broke = Boolean(errored) && errored !== 'no-speech' && !cur && Date.now() - startedAt < 500;
      if (!hd.held || broke || document.hidden || again >= 40) { done(); return; }
      prev = joined(cur); cur = ''; again++; mark('again', again);
      listenOnce();
    };
    hd.stop = () => { hd.held = false; if (hd.r && active) { try { hd.r.stop(); } catch {} } else done(); };
    hd.abort = () => { if (hd.live.done) return; mark('abort()'); if (hd.r) { try { hd.r.onend = null; hd.r.abort(); } catch {} } close(false); };
    const meter = () => {
      const t1 = Date.now(), an = mic.an, buf = mic.buf; let maxAbs = 0, checked = false;
      const loop = () => {
        if (hd.live.done || mic.an !== an) return;
        an.getFloatTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) { const v = buf[i]; sum += v * v; if (v > maxAbs) maxAbs = v; else if (-v > maxAbs) maxAbs = -v; }
        const rms = Math.min(1, Math.sqrt(sum / buf.length) * 4);
        if (rms > diag.peak) diag.peak = rms;
        if (onLevel) onLevel(rms);
        // 按住 600ms 采样还是纯 0:开着的这一路半道哑了 → 识别和麦克风都拆掉重来(还没出字才重来,最多 2 回)
        if (!checked && Date.now() - t1 > 600) {
          checked = true; mark(maxAbs === 0 ? 'dead' : 'alive', mic.ac.state);
          if (maxAbs === 0 && mic.ac.state === 'running' && !hd.live.len && round < 2) { round++; mark('retry', round); mic.ok = false; if (hd.r) { try { hd.r.onend = null; hd.r.abort(); } catch {} hd.r = null; } active = false; start(); return; }
        }
        raf = requestAnimationFrame(loop);
      };
      loop();
    };
    /** 起一段识别(麦克风已经要过了) */
    const listenOnce = () => {
      try {
        const r = new SR(); r.lang = 'zh-CN'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
        for (const k of ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend', 'nomatch']) r.addEventListener(k, () => mark(k));
        if (!again) r.addEventListener('audiostart', () => { if (onAudio) onAudio(); });
        r.onresult = (e) => { let s = ''; for (const x of e.results) s += x[0].transcript; cur = s; const t = joined(s); hd.live.len = t.length; hd.live.lastAt = Date.now(); mark('result', hd.live.len); onText(t); };
        r.onerror = (e) => { errored = String(e && e.error) || 'error'; mark('error', errored); };
        r.onend = ended;
        errored = ''; startedAt = Date.now(); hd.r = r; r.start(); active = true; mark('start()');
      } catch (e) { mark('throw', String(e && e.name)); active = false; done(); }
    };
    const start = () => micOpen().then((how) => mark('mic', how), (e) => mark('mic-fail', String(e && (e.name || e.message)))).then(() => {
      if (hd.live.done) return;
      voiceStart();
      listenOnce();
      if (!hd.live.done && mic.an) meter();
    });
    start();
    return hd;
  };
  /** 松手后的收尾:不立刻 stop。iPad 上第一段字要按下 1 秒多才出来,字还没出就 stop,Safari 回 aborted、整句作废(真机诊断 2026-09-19);
   *  等到「有字且 500ms 没再变」或满 2.5 秒再 stop,它自己先停了就不管(松了手,停了就不再接着认) */
  const settle = (r) => {
    const t1 = Date.now();
    r.held = false;
    if (!r.r) { r.stop(); return; } // 麦克风还没开就松手了:什么也没听到
    const tick = () => {
      if (r.live.done) return;
      if ((r.live.len && Date.now() - r.live.lastAt > 500) || Date.now() - t1 > 2500) { try { r.diagMark('stop()'); r.stop(); } catch {} return; }
      setTimeout(tick, 100);
    };
    tick();
  };
  // 按住时那行字:话筒还没开 → 等一下(这时说的话进不去);开了 → 松手发送;松手后收尾 → 正在听清
  const hold = { audio: false, tail: false };
  const renderHold = () => {
    $('#hold').classList.toggle('wait', !hold.audio || hold.tail);
    $('#hold span').textContent = hold.tail ? '正在听清…' : press && press.cancelled ? '松手取消' : hold.audio ? '松手发送,上移取消' : '等一下…';
  };
  let phTimer = 0;
  // 真音量:25 根条往左滚;没有麦克风那一路(老浏览器、没授权)就还是原来的假波形
  const holdBars = [...document.querySelectorAll('#hold .w i')], holdLv = new Array(25).fill(0);
  const holdLevel = (v) => { $('#hold').classList.add('real'); holdLv.shift(); holdLv.push(v); for (let i = 0; i < 25; i++) holdBars[i].style.height = Math.round(4 + holdLv[i] * 24) + 'px'; };
  // 按住时认出的字:浮层上跟着出,太长只留最后 60 个字
  const holdText = (t) => { $('#hold .t').textContent = t.length > 60 ? '…' + t.slice(-60) : t; };
  const startRec = () => {
    finalText = ''; hold.audio = false; hold.tail = false; renderHold(); holdText('');
    rec = listen((t) => { finalText = t; holdText(t); }, (dead) => {
      const t = finalText; const voice = rec ? rec.voice : null; rec = null; hold.tail = false; holdText('');
      setBar(barNext(S.bar, 'holdEnd'));
      // 识别一起就断:这一下当成点了一下,直接打字
      if (dead) { if (press) { clearTimeout(press.timer); press = null; } setBar(barNext(S.bar, 'tap')); return; }
      // 原声停录是异步的(onstop):等它最多 1.5 秒,没等到就只发字
      if (t.trim()) Promise.race([voice || Promise.resolve(null), new Promise((r) => setTimeout(() => r(null), 1500))]).then((v) => send(t, v ? { voice: v } : {}));
      else { $('#ph').textContent = '没听清,再按住说一次'; clearTimeout(phTimer); phTimer = setTimeout(() => { $('#ph').textContent = PH_IDLE(); }, 2500); }
    }, 'bar', () => { hold.audio = true; renderHold(); }, holdLevel);
    if (!rec) setBar(barNext(S.bar, 'holdEnd'));
  };
  mid.addEventListener('pointerdown', (e) => {
    if (S.bar === 'typing') return;
    e.preventDefault(); unlock();
    if (rec) return; // 上一句还在收尾
    press = { y: e.clientY, cancelled: false, held: false, timer: setTimeout(() => { if (!press || !srOk()) return; press.held = true; setBar(barNext(S.bar, 'holdStart')); dispatch({ type: 'halt' }); startRec(); }, 150) };
    try { mid.setPointerCapture(e.pointerId); } catch {}
  });
  mid.addEventListener('pointermove', (e) => { if (press && press.held) { const up = press.y - e.clientY > 60; if (up !== press.cancelled) { press.cancelled = up; renderHold(); } } });
  const release = () => {
    if (!press) return;
    clearTimeout(press.timer);
    const p = press; press = null;
    if (!p.held) { setBar(barNext(S.bar, 'tap')); return; }
    if (p.cancelled || !rec) { setBar(barNext(S.bar, 'holdCancel')); if (rec) { const r = rec; rec = null; r.abort(); } return; }
    // 松手发送:浮层留到识别停下(onEnd 里收),这段时间在收尾
    hold.tail = true; renderHold(); settle(rec);
  };
  mid.addEventListener('pointerup', release);
  mid.addEventListener('pointercancel', release);
  mid.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- 发照片屏(《作业照片设计.md》):拍 / 选了先到这里——看一眼、裁剪 / 圈画 / 转 90°、配一句话,再一条消息发出去 ----
  // 坐标都在 photo-edit(内联在上面),这里只管画和点。原图只留 objectURL,导出时再解一次(几张 12MP 常驻内存 iPad 吃不消)
  const PS = { items: [], at: 0, mode: 'view', text: '', busy: false, work: null, drag: null, pen: null, sc: 1, R: null, raf: 0 };
  const psEl = $('#ps'), cv = $('#ps-cv'), cropEl = $('#ps-crop'), sayEl = $('#ps-say'), psTyped = $('#ps-typed');
  const loadImg = (url) => new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('图读不出')); im.src = url; });
  /** 一张:解一次拿宽高,留一张长边 ≤ 2048 的显示用底图;解不出 → null(不进缩略图条,不当成不通) */
  const psItem = async (file) => {
    const url = URL.createObjectURL(file);
    try {
      const im = await loadImg(url);
      const w = im.naturalWidth, hh = im.naturalHeight;
      if (!w || !hh) throw new Error('空图');
      const k = Math.min(1, 2048 / Math.max(w, hh));
      const disp = document.createElement('canvas'); disp.width = Math.max(1, Math.round(w * k)); disp.height = Math.max(1, Math.round(hh * k));
      disp.getContext('2d').drawImage(im, 0, 0, disp.width, disp.height);
      return { url, disp, edit: newEdit(w, hh), path: null };
    } catch { URL.revokeObjectURL(url); return null; }
  };
  const drawStrokes = (ctx, strokes) => {
    ctx.strokeStyle = PEN_COLOR; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const st of strokes) {
      ctx.lineWidth = st.width; ctx.beginPath(); ctx.moveTo(st.pts[0].x, st.pts[0].y);
      for (const p of st.pts.slice(1)) ctx.lineTo(p.x, p.y);
      if (st.pts.length === 1) ctx.lineTo(st.pts[0].x + 0.01, st.pts[0].y);
      ctx.stroke();
    }
  };
  /** 把编辑后的图里 R 那块画上去:图坐标 × sc = 画布 px;src 是原图或显示底图(都按原图宽高铺) */
  const paintEdit = (ctx, src, e, R, sc) => {
    ctx.setTransform(sc, 0, 0, sc, -R.x * sc, -R.y * sc);
    const m = rotMatrix(e); ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(src, 0, 0, e.w, e.h);
    ctx.setTransform(sc, 0, 0, sc, -R.x * sc, -R.y * sc);
    drawStrokes(ctx, e.strokes);
  };
  const psExport = async (it) => {
    const im = await loadImg(it.url);
    const plan = exportPlan(it.edit);
    const c = document.createElement('canvas'); c.width = plan.w; c.height = plan.h;
    paintEdit(c.getContext('2d'), im, it.edit, plan.src, plan.scale);
    return c.toDataURL('image/jpeg', 0.82);
  };
  const psCur = () => PS.items[PS.at];
  const psCropFrame = () => {
    const r = PS.work, sc = PS.sc, W = PS.R.w * sc, H = PS.R.h * sc;
    const x = r.x * sc, y = r.y * sc, w = r.w * sc, hh = r.h * sc;
    const put = (el, l, t, ww, h2) => { el.style.left = l + 'px'; el.style.top = t + 'px'; el.style.width = Math.max(0, ww) + 'px'; el.style.height = Math.max(0, h2) + 'px'; };
    const d = cropEl.querySelectorAll('.dim');
    put(d[0], 0, 0, W, y); put(d[1], 0, y + hh, W, H - y - hh); put(d[2], 0, y, x, hh); put(d[3], x + w, y, W - x - w, hh);
    put(cropEl.querySelector('.fr'), x, y, w, hh);
  };
  /** 画当前那张:裁剪时看整张 + 框,其余时候看裁好的那块 + 笔画 */
  const psRender = () => {
    const it = psCur(); if (!it) return;
    const e = it.edit, full = rotatedSize(e);
    const R = PS.mode === 'crop' ? { x: 0, y: 0, w: full.w, h: full.h } : region(e);
    const box = $('#ps .view'), cs = getComputedStyle(box);
    const bw = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), bh = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const sc = fitScale(R.w, R.h, Math.max(bw, 40), Math.max(bh, 40));
    PS.sc = sc; PS.R = R;
    const dw = Math.round(R.w * sc), dh = Math.round(R.h * sc), dpr = window.devicePixelRatio || 1;
    cv.style.width = dw + 'px'; cv.style.height = dh + 'px';
    const pw = Math.round(dw * dpr), ph = Math.round(dh * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    const ctx = cv.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, pw, ph);
    paintEdit(ctx, it.disp, e, R, sc * dpr);
    if (PS.mode === 'crop') psCropFrame();
  };
  const psDraw = () => { if (!PS.raf) PS.raf = requestAnimationFrame(() => { PS.raf = 0; psRender(); }); };
  const psUi = () => {
    const strip = $('#ps-strip');
    strip.replaceChildren(...(PS.items.length > 1 ? PS.items.map((it, i) => h('div', { class: 't' + (i === PS.at ? ' on' : ''), on: { click: () => { if (PS.busy || i === PS.at) return; PS.at = i; psUi(); psRender(); } } }, h('img', { src: it.url, alt: '' }), h('button', { type: 'button', class: 'x', 'aria-label': '去掉这张', html: ICON.closeSm, on: { click: (e) => { e.stopPropagation(); psDrop(i); } } }))) : []));
    strip.style.display = PS.mode === 'view' && PS.items.length > 1 ? '' : 'none';
    const said = $('#ps-said');
    said.textContent = PS.text || (srOk() ? '按住说一句,或点一下打字' : '点这里打一句');
    said.classList.toggle('ph', !PS.text);
    said.hidden = !psTyped.hidden;
    $('#ps-clear').hidden = !PS.text || !psTyped.hidden;
    $('#ps-go').disabled = PS.busy;
    const n = psCur() ? psCur().edit.strokes.length : 0;
    $('#ps-p-undo').disabled = !n; $('#ps-p-clear').disabled = !n;
  };
  const psMode = (mode) => {
    const it = psCur(); if (!it) return;
    if (mode === 'crop') { const f = rotatedSize(it.edit); PS.work = it.edit.crop || { x: 0, y: 0, w: f.w, h: f.h }; }
    PS.mode = mode; PS.drag = null; PS.pen = null;
    psEl.classList.toggle('ps-drawing', mode === 'pen');
    cropEl.hidden = mode !== 'crop';
    $('#ps-tools').hidden = mode !== 'view'; $('#ps-crop-bar').hidden = mode !== 'crop'; $('#ps-pen-bar').hidden = mode !== 'pen';
    sayEl.hidden = mode !== 'view'; $('#ps-foot').hidden = mode !== 'view';
    psUi(); psRender();
  };
  /** 改了这张:之前传上去的不作数 */
  const psEdit = (e) => { const it = psCur(); it.edit = e; it.path = null; };
  const psReset = () => {
    for (const it of PS.items) URL.revokeObjectURL(it.url);
    if (psRec) { try { psRec.onend = null; psRec.abort(); } catch {} psRec = null; }
    Object.assign(PS, { items: [], at: 0, mode: 'view', text: '', busy: false, work: null, drag: null, pen: null });
    psTyped.value = ''; psTyped.hidden = true; sayEl.classList.remove('rec');
  };
  const psClose = () => { psReset(); psEl.classList.remove('on'); };
  const psDrop = (i) => {
    if (PS.busy) return;
    URL.revokeObjectURL(PS.items[i].url);
    PS.items.splice(i, 1);
    if (!PS.items.length) { psClose(); return; }
    PS.at = Math.min(PS.at > i ? PS.at - 1 : PS.at, PS.items.length - 1);
    psUi(); psRender();
  };
  const psOpen = async (files) => {
    if (!files.length || !S.tutor || !canSend() || S.limit || S.pending) return;
    dispatch({ type: 'stageOpen' });
    const items = (await Promise.all(files.map(psItem))).filter(Boolean);
    if (!items.length || !S.tutor) return;
    psReset(); PS.items = items;
    psEl.classList.add('on');
    psMode('view');
  };
  // 拿起相机老师就停(同点卡开舞台);拍完 / 选完进发照片屏。相册最多 4 张,多的只取前 4 张
  for (const f of document.querySelectorAll('input[type=file]')) {
    f.addEventListener('click', () => dispatch({ type: 'stageOpen' }));
    f.addEventListener('change', () => { $('#sheet').classList.remove('on'); const files = Array.from(f.files || []).slice(0, f.multiple ? PHOTO_ALBUM_MAX : 1); f.value = ''; psOpen(files); });
  }
  $('#ps-t-crop').addEventListener('click', () => psMode('crop'));
  $('#ps-t-pen').addEventListener('click', () => psMode('pen'));
  $('#ps-t-rot').addEventListener('click', () => { psEdit(rotateEdit(psCur().edit)); psRender(); });
  $('#ps-c-full').addEventListener('click', () => { PS.work = { x: 0, y: 0, w: PS.R.w, h: PS.R.h }; psCropFrame(); });
  $('#ps-c-ok').addEventListener('click', () => { const e = setCrop(psCur().edit, PS.work); if (JSON.stringify(e.crop) !== JSON.stringify(psCur().edit.crop)) psEdit(e); psMode('view'); });
  $('#ps-p-undo').addEventListener('click', () => { const e = psCur().edit; psEdit({ ...e, strokes: e.strokes.slice(0, -1) }); psUi(); psRender(); });
  $('#ps-p-clear').addEventListener('click', () => { psEdit({ ...psCur().edit, strokes: [] }); psUi(); psRender(); });
  $('#ps-p-ok').addEventListener('click', () => psMode('view'));
  // 裁剪框:四角改大小、框里平移;显示 px 换成图坐标交给 dragCrop
  cropEl.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('[data-g]'); if (!g || PS.drag) return;
    e.preventDefault(); try { cropEl.setPointerCapture(e.pointerId); } catch {}
    PS.drag = { id: e.pointerId, g: g.dataset.g, x: e.clientX, y: e.clientY, from: PS.work };
  });
  cropEl.addEventListener('pointermove', (e) => {
    const d = PS.drag; if (!d || d.id !== e.pointerId) return;
    PS.work = dragCrop(d.from, d.g, (e.clientX - d.x) / PS.sc, (e.clientY - d.y) / PS.sc, PS.R.w, PS.R.h, CROP_MIN_PX / PS.sc);
    psCropFrame();
  });
  const cropUp = (e) => { if (PS.drag && PS.drag.id === e.pointerId) PS.drag = null; };
  cropEl.addEventListener('pointerup', cropUp); cropEl.addEventListener('pointercancel', cropUp);
  // 红笔:一次只认一根手指(手掌压着屏不算第二笔)
  const toImg = (e) => { const b = cv.getBoundingClientRect(); return { x: PS.R.x + (e.clientX - b.left) / PS.sc, y: PS.R.y + (e.clientY - b.top) / PS.sc }; };
  cv.addEventListener('pointerdown', (e) => {
    if (PS.mode !== 'pen' || PS.pen) return;
    e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch {}
    const st = newStroke(psCur().edit, toImg(e));
    psEdit({ ...psCur().edit, strokes: [...psCur().edit.strokes, st] });
    PS.pen = { id: e.pointerId, st }; psUi(); psDraw();
  });
  cv.addEventListener('pointermove', (e) => { if (!PS.pen || PS.pen.id !== e.pointerId) return; PS.pen.st.pts.push(toImg(e)); psDraw(); });
  const penUp = (e) => { if (PS.pen && PS.pen.id === e.pointerId) PS.pen = null; };
  cv.addEventListener('pointerup', penUp); cv.addEventListener('pointercancel', penUp);
  window.addEventListener('resize', () => { if (psEl.classList.contains('on')) psRender(); });
  // 配一句话:按住说(认出的字替换原来的),点一下打字,× 清掉
  let psPress = null, psRec = null;
  sayEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#ps-clear') || !psTyped.hidden || PS.busy || psRec) return;
    e.preventDefault(); unlock();
    psPress = { held: false, timer: setTimeout(() => {
      if (!psPress || !srOk()) return;
      psPress.held = true; sayEl.classList.add('rec');
      psRec = listen((t) => { PS.text = t.trim(); psUi(); }, () => { psRec = null; sayEl.classList.remove('rec'); psUi(); }, 'photo');
      if (!psRec) sayEl.classList.remove('rec');
    }, 150) };
    try { sayEl.setPointerCapture(e.pointerId); } catch {}
  });
  const psRelease = () => {
    if (!psPress) return;
    clearTimeout(psPress.timer);
    const held = psPress.held; psPress = null;
    if (held) { if (psRec) settle(psRec); return; }
    psTyped.value = PS.text; psTyped.hidden = false; psUi(); psTyped.focus();
  };
  sayEl.addEventListener('pointerup', psRelease);
  sayEl.addEventListener('pointercancel', psRelease);
  sayEl.addEventListener('contextmenu', (e) => e.preventDefault());
  psTyped.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); psTyped.blur(); } });
  psTyped.addEventListener('blur', () => { PS.text = psTyped.value.trim(); psTyped.hidden = true; psUi(); });
  $('#ps-clear').addEventListener('click', () => { PS.text = ''; psUi(); });
  $('#ps-cancel').addEventListener('click', () => { if (!PS.busy) psClose(); });
  // 发:逐张导出(转 → 裁 → 画 → 缩到长边 PHOTO_MAX_SIDE)上传拿 path,全拿到再发一条 {text, photos};传不上去屏不关、编辑留着,再点一次只传没传上的
  $('#ps-go').addEventListener('click', async () => {
    if (PS.busy || !PS.items.length) return;
    if (!psTyped.hidden) psTyped.blur();
    if (!S.tutor || !canSend() || S.limit || S.pending) return;
    PS.busy = true; psUi();
    const name = S.tutor.name;
    try {
      for (const it of PS.items) if (!it.path) { const data = await psExport(it); const r = await api('POST', CONV + name + '/photos', { image: data }); it.path = r.path; }
    } catch (e) {
      PS.busy = false; psUi();
      if (e && e.status === 404) { psClose(); closeTutor(); }
      return;
    }
    const photos = PS.items.map((it) => it.path), text = PS.text;
    psClose();
    if (S.tutor && S.tutor.name === name) send(text, { photos });
  });

  // ---- 看大图:节头的小图点开;双指缩放、双击复位;几张就左右翻。不碰播放 ----
  const LB = { list: [], at: 0 };
  const lbShow = () => {
    const z = h('div', { class: 'zoom' }, h('img', { src: '/api/kid/image?p=' + encodeURIComponent(LB.list[LB.at]), alt: '' }));
    $('#lb .zoom').replaceWith(z); pinch(z);
    $('#lb-l').hidden = LB.at <= 0; $('#lb-r').hidden = LB.at >= LB.list.length - 1;
    $('#lb-n').textContent = LB.list.length > 1 ? (LB.at + 1) + ' / ' + LB.list.length : '';
  };
  const openLb = (list, at) => { LB.list = list; LB.at = at; $('#lb').classList.add('on'); lbShow(); };
  $('#lb-x').innerHTML = ICON.close; $('#ps-clear').innerHTML = ICON.closeSm;
  $('#lb-x').addEventListener('click', () => $('#lb').classList.remove('on'));
  $('#lb-l').addEventListener('click', () => { if (LB.at > 0) { LB.at--; lbShow(); } });
  $('#lb-r').addEventListener('click', () => { if (LB.at < LB.list.length - 1) { LB.at++; lbShow(); } });

  // ---- 调试:?step=<节>.<句> 停在某句(截图 / 测试用,不出声) ----
  const jumpTo = () => {
    const at0 = debug.get('step');
    if ((!at0 && !debug.get('stage')) || !S.sections.length) return;
    const [a, b] = (at0 || '0.0').split('.').map(Number);
    const sec = Math.min(Math.max(a || 0, 0), S.sections.length - 1);
    const line = Math.min(Math.max(b || 0, 0), Math.max(S.sections[sec].lines.length - 1, 0));
    dispatch({ type: 'jump', section: sec, line });
    const tgt = nowCard(S.sections, S.state);
    const at = $('#board').querySelector('[data-sec="' + sec + '"] ' + (tgt === null ? '.c' : '[data-card="' + tgt + '"]'));
    if (at) at.scrollIntoView({ block: 'center', behavior: 'instant' });
    const st = debug.get('stage');
    if (st) { const [x, y] = st.split('.').map(Number); openStage(x || 0, y || 0); }
  };

  // ---- 启动与心跳:不通就头像灰,什么都不报 ----
  if (PARENT && debug.get('date')) S.pdate = debug.get('date');
  loadHome().then(() => {
    let resume = null; try { resume = sessionStorage.getItem('kid-resume'); sessionStorage.removeItem('kid-resume'); } catch {}
    // 试用页:先点「开始试用」再开那个试用话题、从第一节念起。真孩子是点首页的按钮进来的,那一下解锁了声音;
    // 试用是从家长端跳过来的,没人点过,iPad Safari 不让放老师的 mp3,会退成浏览器的声(2026-10-04 真机)
    if (TRY) {
      const t = S.home ? S.home.tutors.find((x) => x.name === TRY.tutor) : null;
      if (!t) return;
      const gate = h('div', { id: 'trygo' }, h('button', { type: 'button', on: { click: () => { unlock(); gate.remove(); openTutor(t, TRY.thread === 'new' ? { kind: 'new' } : { kind: 'thread', thread: TRY.thread, play: true }); } } }, '开始试用'), h('small', {}, '像孩子点首页的按钮:点了才开始念'));
      document.body.append(gate);
      return;
    }
    const open = debug.get('tutor') || resume;
    // 家长板书页:?tutor=&date=&thread= 直接开在那个话题上(服务换了代码重载回来也靠它);没有 thread 就是那天的当前话题
    if (PARENT) {
      const t = open && S.home ? S.home.tutors.find((x) => x.name === open) : null;
      if (t) { const th = debug.get('thread'); openTutor(t, th ? { kind: 'thread', thread: th, date: S.home.date } : { kind: 'today', date: S.home.date }); setTimeout(jumpTo, 400); }
      return;
    }
    if (open && S.home) {
      const t = S.home.tutors.find((x) => x.name === open);
      if (t) {
        openTutor(t, { kind: 'today' });
        // 调试:&new=1 新话题空白态;&hist=<日期>.<话题> 只读回放以前的;&panel=1 打开「以前的」面板
        setTimeout(() => {
          if (debug.get('new')) $('#new-btn').click();
          const hv = debug.get('hist');
          if (hv) { const [d, th] = hv.split('.'); switchThread(d, th); }
          if (debug.get('panel')) $('#hist-btn').click();
          jumpTo();
        }, 400);
      }
    }
  });
  /** 服务换了新代码:孩子手上没事时重载,回到原来那位老师。正按着、在打字、在等老师、老师正在念、舞台或发照片屏开着,都先不动 */
  const staleReload = () => {
    if (!stale || document.hidden) return;
    if (press || rec || psRec || S.pending || S.stage || S.bar !== 'idle' || S.state.status === 'playing' || psEl.classList.contains('on')) return;
    if (PARENT) { if (S.tutor) { const q = new URLSearchParams({ tutor: S.tutor.name }); if (S.hist) q.set('date', S.hist); if (S.thread) q.set('thread', S.thread); location.replace(location.pathname + '?' + q); } else location.reload(); return; }
    try { if (S.tutor && !S.readonly) sessionStorage.setItem('kid-resume', S.tutor.name); } catch {}
    location.reload();
  };
  setInterval(() => { staleReload(); if (S.tutor) { if (!S.pending) loadDay(true); } else loadHome(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) (S.tutor ? loadDay(true) : loadHome()); });
})();
</script>
</html>
`;

export const KID_PAGE = PAGE.replace('__BOARD_JS__', () => libSource('kid-board')).replace('__WORD_ADV__', () => JSON.stringify(letterAdvances())).replace('__PHOTO_JS__', () => libSource('photo-edit')).replace('__REEL_JS__', () => libSource('reel'));

export interface KidPageMode {
  /** 家长板书页(《家长板书页设计.md》):数据走家长接口、只读、旁注;自己的 manifest */
  parent?: boolean;
}

/** 孩子端页面:标题(已转义)填进去;mode 见 KidPageMode,不给 = 孩子端 */
export function kidPage(title: string, mode: KidPageMode = {}): string {
  const shown = mode.parent ? `${title} · 家长` : title;
  return KID_PAGE.replaceAll('__TITLE__', shown).replace('__SHORT__', shown).replace('__MODE__', JSON.stringify(mode)).replace('__MANIFEST__', mode.parent ? '/parent/manifest.webmanifest' : '/manifest.webmanifest');
}
