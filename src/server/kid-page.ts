/**
 * 孩子端 `/`:首页(老师卡 + 家长发布的首页卡)与老师页(= 板书页)。零依赖内联脚本,只走 /api/kid/* 与 /api/audio。
 * 首页的老师卡上按钮决定进老师页之后的话题:新话题 / 接着某个话题 / 开场(按钮上的字立刻发出去);老师页不再自己猜话题。
 * 家长端「记录」(/parent)2026-10-28 拆成自己的一页(parent-page.ts),这里没有家长的分支了。
 * 录像里孩子的屏幕(/reel)是同一个页面:__MODE__ 里 reel = true——孩子端的样子,数据是 /reel 给的一个话题,
 * S.readonly 照样是真(不开麦克风、不记实录),由录像的时钟驱动。REEL 的分支只准出现在:声音(用家长页那个 Audio)、chrome(输入条露着、点不动)、
 * 答案栏的「等你说…」、启动与重载,以及录像那一块;别处看到 REEL 就是写错了。
 * 家长端「首页」里的预览(/preview)也是同一个页面:__MODE__ 里 preview = true——孩子端首页本身,在家长页的 iframe 里;点牌上的按钮不跳走,
 * 经 window.parent.cotutorPreview 告诉家长页点了哪颗,家长页经 window.cotutorPreviewSet 换最前那张、塞改着的字;不记「看过了」。PREVIEW 的分支只准出现在首页那几处与启动。
 * 铁律:界面上永远没有错误与评判——后端不通、老师出错、识别失败,都只是「什么都不出现」或头像灰;
 * 文字尽量少,语音优先。孩子设备上没有通往家长端的入口。
 *
 * 老师页照豆包爱学的形态:板书是一天一份、越讲越长的文档。一轮回复 = 一节。
 * 今天能说话的话题都走实时(body.live):嘴照念脑的讲稿、声音从 WebSocket 下来,孩子端不念;卡闭合了就铺,落下时标这张卡的标注一起画上;
 * 节头是脑写的那张卡,孩子的话不上板(在左栏);横屏左栏大头像 + 字幕、板在右边一块白板,卡角没有钮;
 * 谁出声谁停走 ../lib/live-board.ts 的 liveStep(同样剥类型内联);连不上、断了回到「正在叫老师」再连,不退回别的样子。
 * 不走实时的(以前的话题只读回放、家长端试发与 cotutor send 的轮):整节铺上、标注画齐、不念;孩子的话进问题卡的答案栏或节开头一行。
 * 输入条照豆包通用版:相机 | 发消息或按住说话 | 加号(相册)。
 *
 * 交互逻辑在 ../lib/kid-board.ts(纯函数,有测试),这里把它剥掉类型内联进页面,两处一份源码。卡按 kind 渲染(text / read / choice / fill / code),
 * 每种卡的紧凑态只读;点卡开舞台(盖住板书那块,顶栏是卡的名字 + 关闭,讲稿暂停):选择题在舞台里点大按钮,选了就 PUT 状态,
 * 「交给老师」= 发一条 {text:'', action:'submit', focus:{card}};舞台开着时发的消息都带 focus.card。「继续」2026-10-08 去掉了。
 * 状态存服务端,重开页面从 section.cards[n].state 读回;卡上永远不画对错。
 * 重卡(小课堂 / 画板)的舞台在 iframe 里装 /stage/?card=<id>(舞台包,src/stage/),postMessage 协议见 src/stage/protocol.ts:
 * 页面发 card(props + state + 课包 URL),包回 phase / state / submit / close;小课堂那一段在放时字幕行显示课里那句、按钮映射到播放器;
 * 讲稿 [[play]] 锚到小课堂卡 → 念完那句铺满放那一段,放完停在末帧、接着念。
 * 点读段:card.assets 里有 <段号>.mp3 的放服务端配的,还没配好的等它到(拉今天会补上);填空舞台逐空打字、「交给老师」;图片舞台双指缩放。
 * 作业照片:相机 / 相册先进发照片屏(裁剪、圈画、转 90°、配一句话,坐标在 src/lib/photo-edit.ts),再一条 {text, photos};节头小图点开看大图。
 * 流式:老师还在写时 pending 条目带 partial 板书,卡按下标只追加不重画(先出的卡不闪);整轮跑完那节换成正式的,不重播。
 * __TITLE__ / __SHORT__(主屏幕图标下的名字)由路由替换。调试参数(只管这一次打开,见文末启动):`?tutor=` 进哪位老师,
 * `&stage=<节>.<卡>` 直接开某张卡的舞台,`&new=1` / `&hist=<日期>.<话题>` / `&panel=1` 见启动那段;`?device=` 一直留着。
 */
import { createHash } from 'node:crypto';
import { wordDrawJs } from './word-draw.ts';
import { NEUTRAL_COLOR } from '../lib/tutor-color.ts';
import { faviconLinks } from '../lib/favicon.ts';
import { REEL_DOCK_CSS, REEL_DOCK_HTML, REEL_DOCK_JS } from './reel-dock.ts';
import { inlineScript } from './inline-lib.ts';
import { BACK_LOGO, BRAND_CSS, BRAND_JS, titleLogo } from './brand.ts';
import { albumSvg, cameraSvg } from './photo-ui.ts';
import { AUDIO_CLIENT_JS } from '../live/audio-client.ts';
import { VOICE_CSS, VOICE_JS } from './voice-ui.ts';
import { KID_NAV_JS } from './kid-nav.ts';
import { pageDomJs } from './page-dom.ts';
import { KID_LOG_JS } from './kid-log.ts';
import { BACK_TINT_CSS, BACK_TINT_JS } from './tutor-face.ts';
import { BOARD_MARK_CSS, BOARD_MARK_HAND_LEFT_CSS, BOARD_MARK_JS } from './board-mark.ts';

/** 读 src/lib/<name> 的源码(仓库里是 .ts,npm 包里是 dist 的 .js),剥类型、去 export,变成能内联的普通脚本 */
function libSource(name: 'kid-board' | 'photo-edit' | 'reel' | 'live-board' | 'voice-view' | 'canvas-chat'): string {
  return inlineScript(new URL(`../lib/${name}.ts`, import.meta.url));
}

const PAGE = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="__SHORT__">
<meta name="theme-color" content="#faf9f4">
<link rel="manifest" href="/manifest.webmanifest">
${faviconLinks()}
<link rel="stylesheet" href="/kid/theme.css">
<title>__TITLE__</title>
<style>
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html, body { height:100%; }
  body { margin:0; background:var(--paper); color:var(--ink); font:18px/1.5 -apple-system,"PingFang SC","Helvetica Neue",sans-serif; -webkit-user-select:none; user-select:none; overscroll-behavior:none; }
  button { font:inherit; color:inherit; background:none; border:0; padding:0; cursor:pointer; }
  .ic svg { display:block; }
  /* ---- 首页 ---- */
  #home { min-height:100%; padding:calc(env(safe-area-inset-top) + 16px) 20px calc(env(safe-area-inset-bottom) + 40px); max-width:960px; margin:0 auto; display:flex; flex-direction:column; gap:18px; overflow-x:clip; }
  h1 { font-size:20px; font-weight:600; margin:0; color:var(--dim); }
  /* 标题前那颗 logo(src/server/brand.ts titleLogo):不在标题里面(#title 的字会整段换掉);孩子端跟标题同色(家长端各页是彩色的) */
  #ttl { display:flex; align-items:center; gap:10px; }
  #ct-mark { display:flex; color:var(--dim); -webkit-tap-highlight-color:transparent; }
  #ct-mark .ct-go, #ct-mark .ct-gi { transition:transform .45s cubic-bezier(.3,1.6,.5,1); }
  /* 老师头像 = C 形开口环(Cotutor 的 C,开口朝右、朝着老师说出来的话):环是 r=44 的圆(周长 276.46),
     描 80% 留 20%,转 36° 让缺口居中在右;环是学科色(currentColor),里面一个白底圆放图或字。会动的只改 dasharray 与转角 */
  .av { position:relative; display:grid; place-items:center; font-weight:700; flex:0 0 auto; }
  .av .ring { position:absolute; left:0; top:0; width:100%; height:100%; overflow:visible; pointer-events:none; }
  .av .ring circle { fill:none; stroke:currentColor; stroke-width:7; stroke-linecap:round; stroke-dasharray:221.17 55.29; transform-origin:50px 50px; transform:rotate(36deg); transition:transform .45s cubic-bezier(.3,1.6,.5,1); }
  .av .face { position:absolute; left:15%; top:15%; width:70%; height:70%; border-radius:50%; background:var(--card); overflow:hidden; display:grid; place-items:center; font-size:.76em; line-height:1; }
  .av img { width:100%; height:100%; object-fit:cover; }
  /* 画出来:从右上起笔逆时针一笔写出 C,写完头像冒出来(首页打开、回到首页、空白板;--d 是首页几位老师错开的那一下) */
  .av.draw .ring circle { animation:av-draw .9s cubic-bezier(.6,0,.3,1) var(--d, 0s) backwards; }
  .av.draw .face { animation:av-pop .5s ease-out calc(var(--d, 0s) + .35s) backwards; }
  @keyframes av-draw { from { stroke-dasharray:0 276.46; stroke-dashoffset:-221.17; } to { stroke-dasharray:221.17 276.46; stroke-dashoffset:0; } }
  @keyframes av-pop { from { opacity:0; transform:scale(.7); } to { opacity:1; transform:scale(1); } }
  /* 板书模式字幕行开头那颗(#sub-av:原来是左上返回胶囊里那颗,胶囊换了 logo)跟着播放走(body 上的类,renderSubtitle / setBar 记):
     该你了 = 点一下头,说 = 开口一张一合,想 = 慢慢转圈、开口一呼一吸,听 = 开口转向下面的输入条;同时有几样时后写的赢(听 > 想 > 说 > 该你了)。
     一页只有一张会动的脸:实时的字幕行藏着,脸在 #lv-av;空板时板中间的大头像就是那张脸(字幕行这颗不露),跟着一起动(第一句问出去、等老师那几秒板还空着);等待卡不再带头像 */
  /* 关键帧(vb-nod / vb-mouth / vb-spin / vb-breathe / vb-turn / vb-listen)在 src/server/voice-ui.ts 的 VOICE_CSS(头像的动作只写那一处) */
  body.nod #sub-av .ring circle, body.nod:not(.live) #board > .blank > .av .ring circle { animation:vb-nod .9s ease-in-out; }
  body.speaking #sub-av .ring circle, body.speaking:not(.live) #board > .blank > .av .ring circle { animation:vb-mouth 1.6s ease-in-out infinite; }
  body.pending #sub-av .ring circle, body.pending:not(.live) #board > .blank > .av .ring circle { animation:vb-spin 2.4s linear infinite, vb-breathe 1.2s ease-in-out infinite; }
  body.listening #sub-av .ring circle, body.listening:not(.live) #board > .blank > .av .ring circle { animation:vb-turn .35s ease-out both, vb-listen 1.6s ease-in-out .35s infinite; }
  @media (prefers-reduced-motion:reduce) { .av .ring circle, .av .face { animation:none !important; transition:none; } }
  .hcards { display:grid; grid-template-columns:minmax(0,1fr); gap:12px; align-items:start; }
  .hcards:empty { display:none; }
  .lbl { font-size:14px; color:var(--dim); }
  #toast { position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom) + 24px); transform:translateX(-50%); max-width:min(560px,calc(100% - 32px)); padding:12px 18px; border-radius:16px; background:#2b2b2bee; color:#fff; font-size:15px; line-height:1.5; white-space:pre-line; z-index:50; display:none; }
  #toast.on { display:block; }
  /* 小课堂:首页按钮点进来,舞台包铺满整页放;看完关掉,板书顶上一张小课堂卡,输入条才亮 */
  #lc-frame { position:fixed; inset:0; width:100%; height:100%; border:0; z-index:90; background:#faf9f4; }
  #lc-frame[hidden] { display:none; }
  .c.c-lc { flex-direction:row; align-items:center; gap:14px; background:var(--tint-sand-bg); border-color:var(--tint-sand-line); }
  .c-lc .lt { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
  .c-lc .lt small { font-size:13px; font-weight:700; color:var(--tint-sand-head); letter-spacing:1px; }
  .c-lc .lt b { font-size:20px; }
  .c-lc .lt span { font-size:14px; color:var(--dim); }
  .c-lc .lc-th { width:168px; height:100px; flex:none; padding:0; border:1px solid var(--tint-sand-line); border-radius:10px; overflow:hidden; display:grid; place-items:center; background:#fff; }
  .c-lc .lc-th .th, .c-lc .lc-th .mk-svg, .c-lc .lc-th video { width:100%; height:100%; display:block; object-fit:contain; }
  @media (max-width:560px) { .c-lc .lc-th { width:112px; height:68px; } }
  .c-lc .re { flex:none; height:44px; padding:0 16px; border-radius:22px; border:1.5px solid var(--tint-sand-line); background:#fff; font-size:16px; }
  .lc-ask { display:flex; flex-direction:column; align-items:center; gap:8px; padding:36px 0 12px; text-align:center; }
  .lc-ask b { font-size:26px; }
  .lc-ask span { font-size:16px; color:var(--dim); }
  .lc-ask.sm { padding:8px 0 4px; }
  /* 画的卡:孩子做的卡;缩略图是那张截图(画面叠上孩子画的几笔;没截图的课包现画那一刻再叠上) */
  .mk-row { display:flex; flex-wrap:wrap; gap:12px; margin:10px 0; }
  .c.c-mark { position:relative; flex-direction:column; gap:8px; padding:10px 12px; border:2px solid #2f6fd6; border-radius:16px; background:#fff; max-width:100%; }
  .c-mark .mk-main { display:flex; align-items:center; gap:12px; cursor:pointer; padding-right:34px; }
  .c-mark .mk-th { width:156px; height:80px; flex:none; border:1px solid var(--line); border-radius:10px; overflow:hidden; display:grid; place-items:center; background:#fff; }
  .c-mark .mk-svg { width:100%; height:100%; display:block; }
  .c-mark img.mk-svg { object-fit:contain; }
  .c-mark .mk-t { display:flex; flex-direction:column; gap:2px; }
  .c-mark .mk-t small { font-size:13px; font-weight:700; color:#2f6fd6; }
  .c-mark .mk-t b { font-size:22px; font-variant-numeric:tabular-nums; }
  .c-mark .x { position:absolute; right:4px; top:4px; width:40px; height:40px; border-radius:50%; border:none; background:transparent; font-size:22px; line-height:1; color:var(--dim); }
  /* 孩子的话:答问题卡的进卡下沿的答案栏,其余的就是那一节的节头(.sh.said);语音前面一个蓝底小话筒,一行截断,点字看原话 */
  .kid-ans { margin:8px -16px -14px; padding:10px 16px 12px; border:0; border-top:1.5px dashed var(--tint-paper-line); border-radius:0 0 14px 14px; background:transparent; display:flex; align-items:center; gap:9px; font:inherit; font-size:18px; font-weight:500; line-height:1.5; color:var(--ink); text-align:left; cursor:pointer; }
  .kid-ans.wait { display:none; font-weight:400; color:var(--dim); cursor:default; }
  body.waiting .kid-ans.wait { display:flex; }
  .sh.said { gap:10px; padding-top:14px; }
  .sh.said::after { display:none; }
  .sh.said .ln { flex:1 1 12px; min-width:12px; height:1px; margin-left:6px; background:var(--line); }
  .sh.said .ka-t { font-size:22px; font-weight:600; letter-spacing:.5px; line-height:1.4; color:var(--ink); cursor:pointer; }
  .kid-ans .ka-t, .sh.said .ka-t { flex:0 1 auto; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .kid-ans .ka-t { flex-grow:1; }
  .kid-ans.open .ka-t, .sh.said.open .ka-t { white-space:normal; }
  .lc-still { width:100%; height:100%; }
  .lc-still img { width:100%; height:100%; display:block; object-fit:contain; }
  #rest { display:none; text-align:center; color:var(--dim); font-size:16px; padding:12px 0; }
  /* 百炼没配:老师们灰着、点不进去,下面一行叫爸爸妈妈;不说为什么 */
  #gate { display:none; text-align:center; color:var(--dim); font-size:18px; padding:16px 0; line-height:1.6; }
  #gate small { display:block; font-size:15px; }
  body.gated #gate { display:block; }
  body.gated #rest { display:none; }
  /* 首页牌堆:一位老师一张牌(老师卡),平着叠,最前那张在最上层。手机竖着叠:后面的牌在上面,每张往上露出头那一行;
     平板横着叠:后面的牌在左边,每张往左露出一格(左上角的头像)。位置全在 transform 里(JS 按层算,换牌用 Web Animations);--tf 是同一个值,
     给「减弱动态效果」下的 *:active { transform:none !important } 兜底。牌堆往上伸进上面的空当(换牌时抽出、浮起要地方),空的地方不收触摸 */
  #deck { position:relative; z-index:1; flex:none; pointer-events:none; margin-top:calc(6px - var(--head, 0px)); }
  #deck[hidden] { display:none; }
  #deck .pc { position:absolute; left:0; top:var(--head); width:var(--w); height:var(--h); transform-origin:var(--org); pointer-events:auto; padding:14px 14px 44px; gap:12px; border-width:2px; }
  #deck .pc:not(.front) { cursor:pointer; }
  #deck .pc:not(.front) * { pointer-events:none; }
  #deck .pc .veil { position:absolute; inset:0; border-radius:inherit; background:var(--paper); pointer-events:none; z-index:2; }
  #deck .pc-hd { position:relative; display:flex; align-items:center; gap:10px; min-width:0; }
  #deck .pc-hd .av { position:relative; z-index:3; width:var(--av); height:var(--av); font-size:calc(var(--av) * .4); }
  #deck .pc-hd .nm { font-size:var(--nmz); font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
  #deck .pc-hd .dot { position:absolute; z-index:4; top:0; left:calc(var(--av) * .12); width:14px; height:14px; border-radius:50%; background:var(--accent); border:3px solid var(--card); }
  #deck .pc-ix { position:absolute; right:12px; bottom:10px; width:28px; height:28px; transform:rotate(180deg); }
  #deck .pc-ix .av { width:100%; height:100%; font-size:11px; }
  #deck .pc .kc { display:grid; grid-template-columns:minmax(0,1fr); gap:12px; align-items:start; }
  #deck .pc .kcards { margin-top:4px; }
  /* 家长端预览里正在改的那颗 */
  #deck .pc .bt.pv-sel { outline:4px solid var(--ink); outline-offset:3px; }
  body.offline #deck .pc, body.gated #deck .pc { pointer-events:none; }
  @media (prefers-reduced-motion:reduce) { #deck .pc:active { transform:var(--tf) !important; } }
  /* 给老师换样子(figshot):不是首页发布的卡,是 cotutor.json 配了 figshot 就有的固定入口;figshot 没开着就不出现 */
  .c.c-figshot { flex-direction:row; align-items:center; gap:16px; text-decoration:none; color:var(--ink); background:#fff3e8; border-color:var(--accent); }
  .c-figshot[hidden] { display:none; }
  .c-figshot .avs { display:flex; flex:none; }
  .c-figshot .avs .av { width:52px; height:52px; font-size:24px; }
  .c-figshot .avs .av + .av { margin-left:-14px; }
  .c-figshot .tx { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
  .c-figshot .tx b { font-size:19px; }
  .c-figshot .tx span { font-size:15px; color:var(--dim); }
  .c-figshot .go { flex:none; height:48px; padding:0 22px; border-radius:24px; background:#c95a22; color:#fff; font-size:17px; font-weight:600; display:flex; align-items:center; }
  body.offline #rest { display:block; }
  body.offline .c-tutor, body.gated .c-tutor, body.gated .c, body.gated .hcards { pointer-events:none; }
  body.offline .c-tutor .av, body.gated .c-tutor .av { filter:grayscale(1); opacity:.4; }
  body.offline .c-tutor .av .ring circle, body.gated .c-tutor .av .ring circle { transform:rotate(126deg); }
  body.offline #ct-mark, body.gated #ct-mark { filter:grayscale(1); opacity:.4; }
  body.offline #ct-mark .ct-go, body.offline #ct-mark .ct-gi, body.gated #ct-mark .ct-go, body.gated #ct-mark .ct-gi { transform:rotate(90deg); }
  body.offline .c-tutor .nm, body.offline .c-tutor .bt, body.gated .c-tutor .nm, body.gated .c-tutor .bt { color:var(--dim); }
  body.offline .c-tutor .bt-new, body.gated .c-tutor .bt-new { background:var(--grey); }
  /* ---- 老师页 = 板书页 ---- */
  #tutor { position:fixed; inset:0; background:var(--paper); display:none; z-index:10; }
  #tutor.on { display:flex; }
  /* 三门主科在板右边竖着写一个很淡的学科名(board-mark.ts) */
${BOARD_MARK_CSS}
  #main { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; }
  /* 没有顶栏:左上角一颗胶囊「‹ logo」(整颗点了回首页,放 logo,老师的脸在实时的左栏 / 手机的字幕行),右上角「更多」;浮在板书上面、舞台遮罩(z 4)下面,舞台开了就被压暗盖住 */
  .tb { position:absolute; top:calc(env(safe-area-inset-top) + 10px); z-index:3; display:flex; align-items:center; gap:10px; }
  .tb.l { left:calc(env(safe-area-inset-left) + 12px); } .tb.r { right:calc(env(safe-area-inset-right) + 12px); }
  #back { display:flex; align-items:center; gap:2px; height:48px; padding:0 4px 0 8px; border-radius:24px; background:#fffffff0; border:1px solid var(--line); box-shadow:0 2px 10px #00000018; }
  #back .ct-logo { color:var(--ink); margin:0 8px 0 4px; }
  /* 胶囊带上老师:填这位老师的颜色、logo 后面接首字(同听写、口语课一份,tutor-face.ts) */
${BACK_TINT_CSS}
  #sub-av .ring circle { stroke-width:8; }
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
  .blank b { font-size:22px; font-weight:600; color:var(--ink); }
  .blank .resume { margin-top:24px; min-height:48px; padding:0 20px; border-radius:24px; border:1.5px solid; background:#fff; display:inline-flex; align-items:center; gap:10px; font:inherit; font-size:17px; font-weight:500; box-shadow:0 2px 10px #0000000f; cursor:pointer; max-width:100%; }
  .blank .resume .ic { display:grid; } .blank .resume small { font-size:14px; color:var(--dim); }
  .blank.ask b { margin-top:14px; }
  .ask-row { display:flex; flex-wrap:wrap; justify-content:center; gap:16px; margin-top:20px; width:100%; }
  .ask-go { flex:0 1 300px; min-height:120px; border-radius:24px; padding:18px 22px; display:flex; flex-direction:column; align-items:flex-start; gap:6px; text-align:left; font:inherit; cursor:pointer; box-shadow:0 4px 16px #0000000f; }
  .ask-go.back { background:#fff; border:2px solid; } .ask-go.fresh { border:0; color:#fff; }
  .ask-go .t { display:flex; align-items:center; gap:8px; font-size:18px; font-weight:700; } .ask-go .ic { display:grid; }
  .ask-go .s { font-size:17px; color:var(--ink); } .ask-go.fresh .s { color:#fff; } .ask-go small { font-size:14px; color:var(--dim); }
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
  #pill .ic[hidden] { display:none; }
  #wrap { position:relative; flex:1; min-height:0; display:flex; flex-direction:column; }
  /* 板书顶上一条渐隐:滚上去的内容在两角按钮那一带淡成纸色,不和胶囊、话题标签叠字。只是盖一层颜色,不占位置、不收触摸;
     夹在板书(卡上的「再听」z 1)与两角按钮(z 3)之间。滚到顶时第一节在 68px 以下,基本碰不到它 */
  #wrap::before { content:""; position:absolute; left:0; right:0; top:0; height:calc(env(safe-area-inset-top) + 72px); z-index:2; pointer-events:none; background:linear-gradient(var(--paper) calc(env(safe-area-inset-top) + 16px), transparent); }
  /* 舞台的遮罩:板书与顶栏压暗,点一下 = 点 ×;字幕行与输入条不盖(舞台开着孩子照样能说话) */
  #st-dim { position:absolute; left:0; right:0; bottom:0; top:-100vh; z-index:4; background:#00000073; display:none; }
  #stage.on ~ #st-dim { display:block; }
  /* ---- 画板铺满:画板卡与左栏的纸都铺满整屏、盖住左栏;顶栏 × · 题目一行(点开看全)· 给老师看(轻点只交画,按住说 = 画和这句话一起给老师);
     工具一列在舞台里,最底下浮着老师的小头像(按住说话 = 边画边聊,给嘴);嘴说的话在画布顶上浮一条,说完几秒淡掉 ---- */
  #stage.cv, body.live #stage.cv, body.live.hand-left #stage.cv { position:fixed; inset:0; width:auto; transform:none; border-radius:0; box-shadow:none; z-index:20; }
  #stage.cv .top { min-height:56px; box-sizing:border-box; padding:calc(env(safe-area-inset-top) + 6px) calc(env(safe-area-inset-right) + 220px) 6px calc(env(safe-area-inset-left) + 12px); gap:12px; }
  #stage.cv #st-x { order:-1; }
  #stage.cv .top .ttl { cursor:pointer; font-size:18px; }
  #stage.cv .top .ttl.open { white-space:normal; }
  #stage.cv #st-act { position:absolute; top:env(safe-area-inset-top); right:env(safe-area-inset-right); height:56px; box-sizing:border-box; padding:0 12px; border-top:0; gap:10px; }
  #stage.cv #st-note { font-size:14px; }
  #st-go.holding { background:#3d7fd9; border-color:#3d7fd9; color:#fff; }
  #cv-hold, #cv-cap { display:none !important; }
  body.live #stage.cv #cv-hold { display:flex !important; position:absolute; z-index:2; left:calc(env(safe-area-inset-left) + 4px); bottom:calc(env(safe-area-inset-bottom) + 20px); }
  body.live.hand-left #stage.cv #cv-hold { left:auto; right:calc(env(safe-area-inset-right) + 4px); }
  #stage.cv #cv-cap { display:block !important; position:absolute; z-index:2; top:calc(env(safe-area-inset-top) + 68px); left:50%; translate:-50% 0; width:max-content; max-width:min(720px, calc(100% - 200px)); box-sizing:border-box; padding:10px 18px; border-radius:16px; background:#fffffff2; box-shadow:0 4px 18px #0000001f; font-size:20px; line-height:1.45; font-weight:600; color:var(--ink); opacity:0; pointer-events:none; transition:opacity .3s; }
  #stage.cv #cv-cap.on { opacity:1; }
  /* 孩子从纸上交的画:节前一张——图(点开看大图)、几笔、接着画 */
  .c.c-draw { flex-direction:row; align-items:center; gap:14px; padding:10px 12px; border:2px solid #7a4fc9; border-radius:16px; background:#fff; max-width:100%; align-self:flex-start; }
  .c-draw .dw-th { width:156px; height:104px; flex:none; border:1px solid var(--line); border-radius:10px; object-fit:contain; background:#fffdf8; cursor:zoom-in; }
  .c-draw .dw-t { display:flex; flex-direction:column; gap:2px; }
  .c-draw .dw-t small { font-size:13px; font-weight:700; color:#7a4fc9; }
  .c-draw .dw-t b { font-size:20px; }
  .c-draw .dw-go { margin-left:8px; height:44px; padding:0 16px; border-radius:22px; border:1.5px solid #7a4fc9; background:#fff; color:#7a4fc9; font:inherit; font-size:16px; font-weight:600; }
  #board { flex:1; min-height:0; overflow:auto; padding:calc(env(safe-area-inset-top) + 68px) 16px 24px; display:flex; flex-direction:column; gap:12px; -webkit-overflow-scrolling:touch; scroll-behavior:smooth; }
  /* 字幕行 */
  .sh .ph { display:inline-block; height:34px; width:auto; max-width:120px; border-radius:6px; object-fit:cover; border:1px solid var(--line); background:#fff; vertical-align:middle; }
  #sub { display:flex; align-items:center; gap:12px; padding:8px 16px 4px; min-height:52px; }
  #sub-text { flex:1; font-size:15px; line-height:1.45; color:#5a5650; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  #sub-text.wait, #sub-text.gap { color:var(--dim); }
  #sub-av { width:36px; height:36px; font-size:17px; }
  #main:has(#board > .blank) #sub-av { display:none; }
  .dots { display:inline-flex; gap:4px; margin-left:6px; vertical-align:middle; }
  .dots i { width:5px; height:5px; border-radius:50%; background:var(--accent); opacity:.3; animation:dot 1.2s ease-in-out infinite; }
  .dots i:nth-child(2) { animation-delay:.2s; } .dots i:nth-child(3) { animation-delay:.4s; }
  @keyframes dot { 0%,100% { opacity:.25; transform:translateY(0); } 40% { opacity:1; transform:translateY(-3px); } }
  /* 第一拍前板上的占位卡:一支笔慢慢地写(老师在想看字幕行开头那颗);第一拍就绪就撤,真卡落在同一个位置 */
  .wait-card { flex:0 0 auto; height:118px; border-radius:16px; border:1.5px dashed var(--line); background:var(--card); display:flex; align-items:center; justify-content:center; gap:14px; }
  .wait-card svg { width:120px; height:34px; overflow:visible; }
  .wait-card path { fill:none; stroke:var(--accent); stroke-width:3; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:260; stroke-dashoffset:260; animation:write 5s ease-in-out infinite; }
  .wait-card path + path { stroke-width:2.5; opacity:.55; animation-delay:.6s; }
  .blank ~ .wait-card { display:none; }
  @keyframes write { 0% { stroke-dashoffset:260; opacity:1; } 65% { stroke-dashoffset:0; opacity:1; } 88% { stroke-dashoffset:0; opacity:0; } 100% { stroke-dashoffset:260; opacity:0; } }
  @media (prefers-reduced-motion:reduce) { .wait-card path { animation:none; stroke-dashoffset:0; } .dots i { animation:none; opacity:.6; } }
  /* 字幕行:右边那颗只剩舞台里小课堂的暂停 / 播放 */
  #sub-text.line { cursor:pointer; }
  #sub-text .rp { display:inline-flex; vertical-align:-2px; margin-right:6px; color:var(--accent); }
  #sub-btn:disabled { opacity:.35; }
  #sub-btn { flex:0 0 auto; height:36px; min-width:36px; border-radius:18px; background:#fff; display:inline-flex; align-items:center; justify-content:center; gap:4px; padding:0; font-size:15px; font-weight:600; }
  #sub-btn[hidden] { display:none; }
  /* 输入条 */
  #bar { padding:8px 16px calc(env(safe-area-inset-bottom) + 12px); }
  #pill { display:flex; align-items:center; gap:12px; height:56px; padding:0 14px; border-radius:28px; background:#fff; border:1px solid var(--line); box-shadow:0 2px 10px #00000010; }
  #pill .ic { color:var(--ink); display:grid; place-items:center; width:32px; height:44px; }
  /* 一直听(口语课与 live.listen):输入条里的麦克风(点它关麦 / 开麦,外圈跟着音量) */
  #pill #lv-mic { display:none; }
  /* 交给老师了(选择、画板):锁住,不能改、不能再交 */
  .c > .lk { display:inline-flex; align-items:center; gap:4px; align-self:flex-end; font-size:14px; color:var(--dim); }
  body.live.lv-open #pill #lv-mic { display:grid; width:44px; border-radius:50%; color:#2a5ea8; box-shadow:0 0 0 calc(var(--lv, 0) * 10px) #3d7fd933; transition:box-shadow .1s; }
  body.live.lv-open #pill #lv-mic.hear { background:#3d7fd9; color:#fff; }
  body.live.lv-open #pill #lv-mic.off { color:var(--dim); box-shadow:none; }
  #mid { flex:1; min-width:0; min-height:44px; display:flex; align-items:center; font-size:17px; color:var(--dim); touch-action:none; }
  #typed { flex:1; min-width:0; font:inherit; font-size:18px; color:var(--ink); border:0; outline:0; background:none; -webkit-user-select:text; user-select:text; }
  #typed[hidden] { display:none; }
  #go { width:36px; height:36px; border-radius:50%; background:var(--ink); color:#fff; display:grid; place-items:center; }
  #go[hidden] { display:none; }
  /* 录像栏(reel-dock.ts,话题与听写共用):直接打开 /reel(不在家长页的 iframe 里)时在孩子的屏幕底下 */
__REEL_DOCK_CSS__
__BRAND_CSS__
  /* 孩子的屏幕(iframe 里):孩子端原样,只是点不动;板书能上下翻(点在 reelBoot 里挡掉) */
  body.rlk #tutor .tb, body.rlk #sub, body.rlk #bar, body.rlk #lc-frame { pointer-events:none; }
  /* 直接打开孩子的屏幕(调试)时录像栏在它自己底下:压在按住浮层、小课堂上面 */
  body.rlk #reel { position:relative; z-index:25; background:var(--paper); }
  /* 录像里孩子在打字:底下垫一块示意的键盘,老师页挪到它上面 */
  #rl-kbd { position:fixed; left:0; right:0; bottom:0; height:var(--rl-kb, 0); background:#d1d4db; display:none; flex-direction:column; justify-content:center; gap:8px; padding:8px; box-sizing:border-box; z-index:30; }
  body.rlk.kbd #rl-kbd { display:flex; }
  body.rlk.kbd #tutor { bottom:var(--rl-kb, 0); }
  #rl-kbd .r { display:flex; gap:6px; justify-content:center; flex:1; max-height:56px; }
  #rl-kbd .r span { flex:0 1 72px; border-radius:7px; background:#fdfdfd; box-shadow:0 1px 0 #8e9196; display:grid; place-items:center; font-size:18px; color:#333; }
  #rl-kbd .r span.sp { flex:0 1 420px; font-size:14px; color:#777; }
  #rl-ps-img { position:absolute; inset:0; margin:auto; max-width:100%; max-height:100%; object-fit:contain; }
  body.rlk #ps-cv { visibility:hidden; }
  body.rlk #ps { pointer-events:none; }
  body.pending #pill { opacity:.45; }
  /* 老师在想时中间那段照旧接按(按了说「老师在想,等一下再说」,busyHint),相机、加号不接 */
  body.pending #pill > :not(#mid) { pointer-events:none; }
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
  #sheet .opts { display:grid; grid-auto-flow:column; grid-auto-columns:minmax(0,1fr); gap:12px; }
  #sheet .opts > [hidden] { display:none; }
  body:not(.live) #sheet-paper { display:none; }
  #sheet label, #sheet .opts button { display:flex; flex-direction:column; align-items:center; gap:8px; padding:18px 0; border-radius:16px; background:var(--paper); font-size:15px; font-weight:600; }
  #sheet .opts button { border:0; color:inherit; font-family:inherit; line-height:inherit; }
  input[type=file] { display:none; }
  /* 发照片屏:看一眼、裁剪 / 圈画 / 转 90°、配一句话,再发 */
  #ps { position:absolute; inset:0; z-index:40; background:#1d1c1a; color:#fff; display:none; flex-direction:column; }
  #ps.on { display:flex; }
  /* 发给谁(设计稿 https://claude.ai/artifact/SPtjRhH9aLoLQoGfCNJaVz):头像和名字;「发给」按钮用这位老师的颜色,和拍照听写拍完的「开始听写」分得开 */
  #ps-top { display:flex; align-items:center; padding:calc(env(safe-area-inset-top) + 12px) 16px 0; }
  #ps-to { display:inline-flex; align-items:center; gap:10px; height:50px; padding:0 18px 0 6px; border-radius:25px; background:#ffffff14; border:1px solid #ffffff26; font-size:17px; }
  #ps-to:empty { display:none; }
  #ps-to small { font-size:17px; color:#ffffffb3; }
  #ps-to .av { width:38px; height:38px; font-size:18px; }
  #ps-to .av .ring circle { stroke-width:8; }
  #ps .view { position:relative; flex:1; min-height:0; display:flex; align-items:center; justify-content:center; padding:8px 16px; }
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
  #back, .tb .hb, #hist-x, #st-x, #st-go, #sub-btn, #pill .ic, #go, #back-today, .c-tutor .bt,
  #ps .tools button, #ps .foot button, #ps-strip .x, #lb .x, #lb .nav,
  #menu .panel button, #sheet label, #hist .tr, .so, .rd, .hz, .c-tutor .tt, #ps-strip .t,
  #sub-text.line, #lv-tools button, #lv-tools .ic, #lv-replay, .lv-go { transition:transform .2s ease-out, filter .2s ease-out, opacity .2s ease-out, background-color .2s ease-out; }
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
    #back:hover, .tb .hb:hover, #hist-x:hover, #st-x:hover, #sub-btn:hover, #pill .ic:hover, #back-today:hover, #menu .panel button:hover, #sheet label:hover, #hist .tr:hover, .so:hover, .rd:hover, .c-tutor .bt:hover, #board .c:not(.c-tianzige):hover, #lv-tools button:hover .ic, #lv-replay:hover, .lv-go:hover { filter:brightness(.97); }
  }
  #back:active, .tb .hb:active, #hist-x:active, #st-x:active, #st-go:active, #sub-btn:active, #pill .ic:active, #go:active, #back-today:active, .c-tutor .bt:active, .blank .resume:active, .ask-go:active { transform:scale(.94); filter:brightness(.92); transition-duration:.06s; }
  #ps .tools button:active, #ps .foot button:active, #ps-strip .x:active, #lb .x:active, #lb .nav:active { transform:scale(.94); opacity:.65; transition-duration:.06s; }
  /* 左栏(实时老师页白纸)最底下那排:圆钮同输入条上的圆钮(缩到 94% + 暗一档),字跟着深一档;「再听一遍」是行内文字,变淡。合成的那颗按钮在 voice-ui.ts */
  #lv-tools button:active .ic { transform:scale(.94); filter:brightness(.92); transition-duration:.06s; }
  #lv-tools button:active { color:var(--ink); transition-duration:.06s; }
  #lv-replay:active { opacity:.55; transition-duration:.06s; }
  #menu .panel button:active, #sheet label:active, #hist .tr:active, .so:active, .rd:active, .hz:active, .c-tutor .tt:active, #ps-strip .t:active, .lv-go:active { transform:scale(.985); filter:brightness(.95); transition-duration:.06s; }
  #board .c:not(.c-tianzige):active:not(:has(button:active, .hz:active)) { transform:scale(.985); filter:brightness(.96); transition-duration:.06s; transition-delay:.08s; }
  #sub-text.line:active { opacity:.55; transition-duration:.06s; }
  button:disabled, .hb.dim { opacity:.35; }
  button:disabled:active { transform:none; filter:none; }
  @media (prefers-reduced-motion:reduce) { #back, .tb .hb, .so, .rd, .hz, #board .c, #hist .tr, #sheet label, #menu .panel button, #ps .tools button, #ps .foot button, .c-tutor .bt, .c-tutor .tt { transition:none; } *:active { transform:none !important; } }
__VOICE_CSS__
  /* ---- 实时的老师:
     字幕行换成 #lv(类名带 lv-:卡是 .c,撞名会套上卡的边框)——竖屏、手机在输入条上方一行(小头像 + 在说的那句),横屏是左栏(大头像 + 字幕,在说的大、上一句淡),板是右边一块白板;
     平板横屏是左栏一整张白纸 + 头像和按住说话合成的一颗按钮(src/server/voice-ui.ts);卡角没有再听的喇叭,也没有别的钮(想问某张卡,点开它再按住说) ---- */
  #lv { display:none; }
  body.live #sub { display:none; }
  body.live #lv { display:flex; align-items:center; gap:14px; padding:8px 20px 4px; min-height:60px; }
  #lv-av { position:relative; flex:0 0 auto; width:44px; height:44px; }
  /* 口语课:热身那拍念完,那张卡一圈慢慢呼吸的光 = 轮到你;孩子开口光变实。打电话前头像晃着响铃 */
  #board .c.lv-turn { animation:lv-turn 2.4s ease-in-out infinite; }
  #board .c.lv-turn.hear { animation:none; box-shadow:0 0 0 4px #3d7fd9, 0 0 0 10px #3d7fd933; }
  @keyframes lv-turn { 0%,100% { box-shadow:0 0 0 3px #3d7fd966, 0 0 0 10px #3d7fd914; } 50% { box-shadow:0 0 0 6px #3d7fd999, 0 0 0 20px #3d7fd90f; } }
  @media (prefers-reduced-motion: reduce) { #board .c.lv-turn { animation:none; box-shadow:0 0 0 4px #3d7fd966; } }
  #lv-av .av { width:100%; height:100%; font-size:20px; }
  /* 手机字幕行那颗头像的动作(在说 / 在听 / 在想 / 响铃)同按钮里那颗,走 voice-ui.ts 的 voiceFace(.vb-halo 是外圈) */
  #lv-cap { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
  #lv-cap .lv-prev { display:none; }
  #lv-cap .lv-cur { font-size:18px; line-height:1.45; font-weight:600; color:var(--ink); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  #lv-cap .lv-cur.nm { font-weight:500; color:var(--dim); }
  #lv-cap.done .lv-cur, #lv-cap .lv-cur.cut { color:#a39f96; font-weight:500; }
  /* 孩子刚说的那句、按住说话那颗按钮、拍照 / 相册 / 打字:只在平板横屏的左栏里(见下面「平板横屏」);竖屏、手机照旧输入条。
     一页一张脸:实时的脸是按钮里那颗(手机是 #lv-av),空板中间那颗不露 */
  #lv-kid, #lv-hold, #lv-tools { display:none; }
  /* 字幕重放:家长提醒着用的,不做大按钮——手机是字幕行右边一颗小钮,平板横屏是字幕下面一行小字「↺ 再听一遍」;放着时是「■ 停」 */
  #lv-replay { flex:none; width:40px; height:40px; border-radius:50%; display:grid; place-items:center; color:var(--dim); }
  #lv-replay[hidden] { display:none !important; }
  #lv-replay .tx { display:none; }
  #lv-cap .lv-cur .rp { display:inline-flex; vertical-align:-2px; margin-right:6px; color:var(--dim); }
  #lv-cap.rp .lv-cur { color:#4d4a44; font-weight:600; }
  /* 空板(原型 F 排):老师对孩子说的话都在左栏(手机是字幕行),板只放板书——板上的 .blank 收着,
     开场那句(+「比如」)在 #lv-ask、老师给的选择(接着刚才的、接着那个 / 重新开始、先热身)在 #lv-acts;这时字幕、孩子那句、再听一遍让开。
     手机(F5):开场那句在小头像旁(大一点、粗),选择在它上面一条 */
  #lv-ask, #lv-acts { display:none; }
  body.live #board > .blank { display:none; }
  body.live.lv-opening #lv-cap, body.live.lv-opening #lv-kid, body.live.lv-opening #lv-replay { display:none; }
  body.live.lv-opening #lv { flex-wrap:wrap; }
  body.live.lv-opening #lv-ask { display:flex; flex:1; min-width:0; flex-direction:column; gap:2px; }
  #lv-ask b { font-size:20px; line-height:1.4; font-weight:700; color:var(--ink); }
  #lv-ask small { display:none; font-size:16px; line-height:1.5; color:#8a8781; }
  body.live.lv-opening #lv-acts:not(:empty) { display:flex; order:-1; flex:0 0 100%; gap:10px; }
  .lv-go { flex:1 1 0; min-width:0; display:flex; align-items:center; gap:12px; padding:12px 16px; border-radius:20px; border:1.5px solid var(--tc, var(--line)); background:#fff; color:var(--ink); font:inherit; text-align:left; }
  .lv-go .ic { flex:none; display:grid; color:var(--tc, var(--dim)); }
  .lv-go .ic svg { width:22px; height:22px; }
  .lv-go .tx { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
  .lv-go .k { font-size:13px; color:var(--tc, var(--dim)); }
  .lv-go .s { font-size:18px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lv-go .tm { flex:none; font-size:14px; color:#8a8781; }
  .lv-go.fresh { border-color:transparent; background:var(--tc, var(--ink)); color:#fff; }
  .lv-go.fresh .ic, .lv-go.fresh .k { color:#ffffffd9; }
  .lv-go.talk { padding-top:14px; padding-bottom:14px; }
  /* 实时的板是脑写的:节头是脑写的那张「# 标题」文字卡(一行摘要 —— 线 —— 板上第一节带时间);没写节头的一轮接着上一节画,不留节间空 */
  .sh.lh { gap:12px; padding:14px 4px 2px; white-space:normal; }
  .sh.lh::after { display:none; }
  /* 不出卡、没写节头的一轮:板上什么都不留(节是空的,不占节间空) */
  .sec.cont:empty { display:none; }
  .sh.lh .t { flex:0 1 auto; min-width:0; font-size:22px; font-weight:700; line-height:1.4; color:var(--ink); }
  .sh.lh .ln { flex:1 1 12px; min-width:12px; height:1px; background:var(--line); }
  .sh.lh .tm { flex:none; font-size:13px; color:var(--dim); }
  .sec + .sec.cont { margin-top:0; }
  /* ---- 平板横屏 ---- */
  @media (min-width:900px) and (orientation:landscape) {
    #home { max-width:1040px; padding:calc(env(safe-area-inset-top) + 40px) 48px 40px; gap:24px; }
    #home h1 { font-size:22px; }
    #home .hcards { grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); }
    .tb.l { left:calc(env(safe-area-inset-left) + 20px); } .tb.r { right:calc(env(safe-area-inset-right) + 20px); }
    #menu .panel { right:calc(env(safe-area-inset-right) + 20px); }
    #board { width:100%; max-width:1040px; margin:0 auto; padding:calc(env(safe-area-inset-top) + 68px) 32px 24px; }
    #sub, #bar, #reel { width:100%; max-width:1040px; margin:0 auto; padding-left:32px; padding-right:32px; }
    /* 实时的老师(原型 https://claude.ai/artifact/RNjBdhuvRmnsBjKn521fkE 的 D 排):
       板是主体——占满整屏、纸色,内容从左栏右边排起,往下翻时从浮着的「更多」底下过去;
       左栏是贴边的一整张白纸(上、左、下不留边,右边一道细线加很淡的影子),宽 360:顶上回首页,字幕占回首页下面到按钮上面
       (孩子刚说的那句、上一句、在说那句、再听一遍;跟着视口高走——iPad Safari 有地址栏时只有 ~760 高,10-21 真机上按 820 写死的把字幕挤没了);
       头像和按住说话是一颗按钮(src/server/voice-ui.ts),中心约在屏高三分之二、离底边约 200(平板横放在桌上,底边太贴桌、手指往下会碰 iPadOS 底部手势);
       拍照、相册、打字在最底下。左栏在舞台遮罩(z 4)上面:舞台开着孩子照样能说话 */
    body.live #board { max-width:none; padding:calc(env(safe-area-inset-top) + 68px) calc(env(safe-area-inset-right) + 48px) 28px calc(env(safe-area-inset-left) + 400px); }
    body.live #stage { left:calc(env(safe-area-inset-left) + 376px); right:calc(env(safe-area-inset-right) + 16px); width:auto; transform:none; }
    body.live .tb.l { left:calc(env(safe-area-inset-left) + 24px); top:calc(env(safe-area-inset-top) + 16px); z-index:6; }
    body.live #back { box-shadow:none; } body.live #back:not(.tinted) { background:#f4f2ec; }
    body.live #lv { position:absolute; z-index:5; left:0; top:0; bottom:0; width:calc(env(safe-area-inset-left) + 360px); box-sizing:border-box; flex-direction:column; justify-content:flex-start; align-items:stretch; gap:12px; padding:calc(env(safe-area-inset-top) + 96px) 24px calc(env(safe-area-inset-bottom) + 20px) calc(env(safe-area-inset-left) + 24px); min-height:0; overflow:hidden; background:#fff; box-shadow:1px 0 0 #efece4, 6px 0 24px #46371e0d; }
    body.live #lv-av { display:none; }
    body.live #lv-kid { display:flex; flex:none; align-items:flex-start; gap:8px; font-size:20px; line-height:1.4; font-weight:600; color:#2a5ea8; }
    body.live #lv-kid:empty { display:none; }
    #lv-kid .tx { min-width:0; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    body.live #lv-kid.old { font-size:17px; font-weight:400; color:#6f93c4; }
    body.live #lv-cap { flex:0 1 auto; min-height:0; overflow:hidden; gap:12px; text-align:left; }
    body.live #lv-cap .lv-prev { font-size:18px; line-height:1.55; color:#a39f96; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    body.live #lv-cap .lv-prev:empty { display:none; }
    body.live #lv-cap .lv-cur { font-size:26px; line-height:1.5; -webkit-line-clamp:8; }
    body.live #lv-cap.rp .lv-prev { font-size:15px; color:#8a8781; }
    body.live #lv-replay { display:flex; flex:none; align-self:flex-start; width:auto; height:44px; padding:0 12px 0 0; border-radius:22px; align-items:center; gap:6px; font-size:15px; color:#6f6b63; }
    body.live #lv-replay .tx { display:inline; }
    body.live #lv-replay.stop { height:40px; padding:0 14px; border:1px solid var(--line); background:#fff; color:var(--ink); }
    /* 空板:开场那句是左栏字幕位的第一句,选择一个个跟在下面、占满白纸宽 */
    body.live.lv-opening #lv-ask { flex:none; margin-top:8px; gap:10px; }
    body.live #lv-ask b { font-size:30px; }
    body.live #lv-ask[data-kind=ask] b { font-size:27px; }
    body.live #lv-ask small:not(:empty) { display:block; }
    body.live.lv-opening #lv-acts:not(:empty) { order:0; flex:none; flex-direction:column; margin-top:12px; }
    body.live .lv-go { flex:none; }
    body.live .lv-go .s { font-size:19px; }
    /* 按住说话那颗按钮(头像 + 声音,样子在 voice-ui.ts):挨着字幕往下顶到底下那排上面;下沿离屏底 = 底下那排 + 13vh 的空 */
    body.live #lv-hold { display:flex; flex:none; align-self:center; margin-top:auto; }
    body.live #lv-tools { display:flex; flex:none; justify-content:center; gap:24px; margin-top:clamp(36px, 13vh, 150px); }
    #lv-tools button { display:flex; flex-direction:column; align-items:center; gap:6px; font-size:13px; color:#6f6b63; }
    #lv-tools .ic { width:56px; height:56px; box-sizing:border-box; border-radius:50%; border:1px solid var(--line); background:#fff; display:grid; place-items:center; color:#6f6b63; }
    /* 老师在想:按钮自己画灰(voice-view 的 think),照样接按(按了晃一下说为什么);底下那排不接 */
    body.live.pending #lv-tools { opacity:.45; pointer-events:none; }
    body.live.nosend:not(.choose) #lv-hold, body.live.nosend:not(.choose) #lv-tools { display:none; }
    /* 先点上面一个(口语单拍好、今天点过同一个按钮):按钮灰着写「点上面开始」(voice-view 的 choose),底下那排淡着不接 */
    body.live.choose #lv-tools { opacity:.45; pointer-events:none; }
    body.live #bar { display:none; }
    body.live.typing #bar { display:block; position:fixed; left:0; right:0; bottom:var(--kb, 0px); z-index:25; max-width:none; padding:10px calc(env(safe-area-inset-right) + 40px) 10px calc(env(safe-area-inset-left) + 40px); background:#faf9f4f5; }
    body.live #cam, body.live #plus, body.live #lv-mic { display:none !important; }
    /* 按着时按钮自己变蓝(voice-view 的 hold),不再盖一块 #hold 上去 */
    body.live #hold { display:none !important; }
    /* 左撇子镜像(cotutor.json 的 kid.hand: left,工作台切):白纸挪到右边、板在左边、按钮里头像在右头;回首页、「更多」的位置同右手(回首页浮在板的左上) */
    body.live.hand-left #board { padding-left:calc(env(safe-area-inset-left) + 48px); padding-right:calc(env(safe-area-inset-right) + 400px); }
    body.live.hand-left #stage { left:calc(env(safe-area-inset-left) + 16px); right:calc(env(safe-area-inset-right) + 376px); }
    body.live.hand-left #lv { left:auto; right:0; width:calc(env(safe-area-inset-right) + 360px); padding-top:calc(env(safe-area-inset-top) + 80px); padding-left:24px; padding-right:calc(env(safe-area-inset-right) + 24px); box-shadow:-1px 0 0 #efece4, -6px 0 24px #46371e0d; }
    body.live.hand-left #back { box-shadow:0 2px 10px #46371e2e; } body.live.hand-left #back:not(.tinted) { background:#fffffff0; }
    body.live.hand-left .tb.r { z-index:6; }
    ${BOARD_MARK_HAND_LEFT_CSS}
  }
</style>
<div id="home">
  <div id="ttl"><span id="ct-mark" class="ct-draw">${titleLogo(false)}</span><h1 id="title">__TITLE__</h1></div>
  <div class="hcards" id="hcards"></div>
  <div class="deck" id="deck" hidden></div>
  <p id="rest">老师们休息中</p>
  <p id="gate">老师们还没到<small>叫爸爸妈妈来看一下</small></p>
  <a class="c c-figshot" id="figshot" hidden><span class="avs"></span><span class="tx"><b>给老师们换个样子</b><span>帽子、脸、衣服,都由你来挑</span></span><span class="go">去搭</span></a>
</div>
<div id="toast"></div>
<iframe id="lc-frame" hidden title="小课堂"></iframe>
<section id="tutor">
  <div id="main">
    <div class="tb l"><button id="back" type="button" aria-label="回首页"><i id="back-ic"></i>__BACK_LOGO__</button><span id="c-mo" hidden></span></div>
    <div class="tb r"><button class="hb" id="more-btn" type="button" aria-label="更多"></button></div>
    <div id="wrap">
      <div id="bmark" hidden></div>
      <div id="board"></div>
      <div id="stage"><div class="top"><span class="ttl" id="st-ttl"></span><span class="kd" id="st-kd"></span><button id="st-x" type="button"></button></div><div id="st-body"></div><iframe id="st-frame" hidden title="stage"></iframe><div id="st-act" hidden><span class="note" id="st-note"></span><button id="st-go" type="button">交给老师</button></div><button id="cv-hold" class="vb-mini" type="button"></button><div id="cv-cap"></div></div>
      <div id="st-dim"></div>
    </div>
    <div id="lv"><div id="lv-av"></div><div id="lv-kid"></div><div id="lv-cap"><div class="lv-prev"></div><div class="lv-cur"></div></div><div id="lv-ask"><b></b><small></small></div><div id="lv-acts"></div><button id="lv-replay" type="button" hidden><span class="ic"></span><span class="tx"></span></button><button id="lv-hold" type="button"></button><div id="lv-tools"><button type="button" id="lv-paper"><span class="ic"></span>画板</button><button type="button" id="lv-cam"><span class="ic"></span>拍照</button><button type="button" id="lv-album"><span class="ic"></span>相册</button><button type="button" id="lv-type"><span class="ic"></span>打字</button></div></div>
    <div id="sub"><span class="av" id="sub-av"></span><span id="sub-text"></span><button id="sub-btn" type="button" hidden></button></div>
    <div id="bar">
      <div id="pill">
        <label class="ic" id="cam"><input type="file" accept="image/*" capture="environment"></label>
        <div id="mid"><span id="ph">发消息或按住说话…</span><input id="typed" type="text" autocomplete="off" hidden></div>
        <button class="ic" id="lv-mic" type="button" aria-label="关麦"></button>
        <button id="go" type="button" hidden></button>
        <button class="ic" id="plus" type="button"></button>
      </div>
      <button id="back-today" type="button" hidden>回到今天</button>
    </div>
    __REEL_DOCK_HTML__
    <div id="hold"><div class="t"></div><span>松手发送,上移取消</span><div class="w"></div></div>
  </div>
  <div id="hist"><div class="dimmer"></div><div class="panel"><div class="hd"><span>以前的</span><button class="hb" id="hist-x" type="button"></button></div><div class="ls"></div></div></div>
  <div id="menu"><div class="dimmer"></div><div class="panel">
    <button type="button" id="hist-btn"><span class="ic"></span><span class="tx"><b>以前的</b><small>看看以前聊过的话题</small></span></button>
    <button type="button" id="new-btn" hidden><span class="ic"></span><span class="tx"><b>新话题</b><small>这个聊完了,换一个问</small></span></button>
  </div></div>
  <div id="sheet"><div class="dimmer"></div><div class="panel"><div class="grab"></div><div class="opts">
    <label><span class="ic" id="ic-album"></span>相册<input type="file" accept="image/*" multiple></label>
    <label><span class="ic" id="ic-cam2"></span>拍照<input type="file" accept="image/*" capture="environment"></label>
    <button type="button" id="sheet-paper"><span class="ic" id="ic-paper"></span>画板</button>
  </div></div></div>
  <div id="ps">
    <div id="ps-top"><span id="ps-to"></span></div>
    <div class="view"><div class="cv"><canvas id="ps-cv"></canvas><div id="ps-crop" hidden><div class="dim"></div><div class="dim"></div><div class="dim"></div><div class="dim"></div><div class="fr" data-g="move"><span class="g nw" data-g="nw"></span><span class="g ne" data-g="ne"></span><span class="g sw" data-g="sw"></span><span class="g se" data-g="se"></span></div></div></div></div>
    <div id="ps-strip"></div>
    <div class="tools" id="ps-tools"><button type="button" id="ps-t-crop">裁剪</button><button type="button" id="ps-t-pen">圈画</button><button type="button" id="ps-t-rot">转 90°</button></div>
    <div class="tools" id="ps-crop-bar" hidden><button type="button" id="ps-c-full">整张</button><button type="button" class="ok" id="ps-c-ok">好了</button></div>
    <div class="tools" id="ps-pen-bar" hidden><button type="button" id="ps-p-undo">撤销</button><button type="button" id="ps-p-clear">清空</button><button type="button" class="ok" id="ps-p-ok">好了</button></div>
    <div class="foot" id="ps-foot"><button type="button" id="ps-cancel">取消</button><button type="button" id="ps-go">发给老师</button></div>
  </div>
  <div id="lb"><div class="zoom"><img alt=""></div><button type="button" class="x" id="lb-x"></button><button type="button" class="nav l" id="lb-l">‹</button><button type="button" class="nav r" id="lb-r">›</button><div class="n" id="lb-n"></div></div>
</section>
<script>
// 孩子端的流水(kid-log.ts):最先装上出错的监听;打开那一下在下面 kidLog.start
${KID_LOG_JS}
(() => {
__BOARD_JS__
__PHOTO_JS__
__REEL_JS__
__LIVE_JS__
__CANVAS_CHAT_JS__
__AUDIO_JS__
__VOICE_VIEW_JS__
__VOICE_JS__
__BRAND_JS__

  /** 页面的模式:{} = 孩子端;reel = 录像里孩子的屏幕;preview = 家长端「首页」里的预览 */
  const MODE = __MODE__;
  /** 舞台包的版本(src/server/stage.ts stageVersion):iframe 的地址带上它,打包过一次就换一个地址,不用浏览器缓存里的旧舞台 */
  const STAGE_V = '__STAGE_V__';
  /** 这份页面的版本(源码的 hash):孩子端记进实录,录像对不上时标「画法已更新」 */
  const PAGE_V = '__PAGE_V__';
  const stageUrl = (card) => '/stage/?v=' + STAGE_V + '&card=' + encodeURIComponent(card);
  /** 录像里孩子的屏幕(/reel):孩子端的样子,数据是 /reel 给的一个话题;只读、不记、点不动,由录像的时钟驱动 */
  const REEL = MODE.reel === true;
  const PREVIEW = MODE.preview === true;
  // 孩子端不往浏览器历史里加东西(kid-nav.ts):去听写、口语课的链接都是替换当前页;家长端、录像、预览照常
  if (!REEL && !PREVIEW) { ${KID_NAV_JS} }
  // 只有孩子端报「打开」、登记设备;家长端、录像、预览开在家长自己的设备上,只记出错。ctx 出错时才取(S、LV 在下面)
  kidLog.start({ page: 'kid', mode: REEL ? 'reel' : PREVIEW ? 'preview' : 'kid', v: PAGE_V, ctx: () => ({ tutor: S.tutor ? S.tutor.name : null, thread: S.thread || null, live: Boolean(LV.on) }) });
  /** 孩子端对话接口的前缀(messages / photos / cards / history);家长端只看,一天的板书走自己的路 */
  const CONV = '/api/kid/conversations/';
  const AUDIO = '/api/audio/';
  // $ / h / toast / api(page-dom.ts,几页共用)
${pageDomJs(4000)}
  const SVG =(paths, size, sw) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  const ICON = {
    back: SVG('<path d="M15 5l-7 7 7 7"></path>', 28, 2.2),
    // 相机、相册同拍照听写那几屏(photo-ui.ts);加号面板里两个一样大
    camera: __CAMERA_22__,
    cameraLg: __CAMERA_28__,
    plus: SVG('<path d="M12 5v14M5 12h14"></path>', 22, 2.2),
    play: SVG('<path d="M8 5l11 7-11 7z" fill="currentColor"></path>', 16, 1.5),
    pause: SVG('<path d="M8 5v14M16 5v14"></path>', 16, 2.6),
    speaker: SVG('<path d="M4 10v4h4l5 4V6L8 10z"></path><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"></path>', 24),
    replay: SVG('<path d="M4 10v4h4l5 4V6L8 10z"></path><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"></path>', 16, 2),
    stop: SVG('<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"></rect>', 16, 1.5),
    send: SVG('<path d="M12 19V5M5 12l7-7 7 7"></path>', 20, 2.4),
    micMd: SVG('<rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path>', 22, 2),
    keyboard: SVG('<rect x="3" y="6" width="18" height="13" rx="2"></rect><path d="M7 10h1M11 10h1M15 10h1M8 15h8"></path>', 26, 1.8),
    paper: SVG('<path d="M15 4l5 5-9 9H6v-5z"></path><path d="M13 6l5 5"></path><path d="M3 21c2-1.5 4-1.5 6 0s4 1.5 6 0"></path>', 26, 1.8),
    micOff: SVG('<rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"></path>', 22, 2),
    album: __ALBUM_28__,
    close: SVG('<path d="M6 6l12 12M18 6L6 18"></path>', 24, 2.2),
    closeSm: SVG('<path d="M7 7l10 10M17 7L7 17"></path>', 14, 2.8),
    check: SVG('<path d="M5 12l5 5 9-10"></path>', 16, 3),
    lock: SVG('<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>', 14, 2.2),
    more: SVG('<circle cx="5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="19" cy="12" r="1.6"></circle>', 24),
    history: SVG('<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path>', 24),
    again: SVG('<path d="M4 12a8 8 0 1 0 2.4-5.7"></path><path d="M4 4v4.5h4.5"></path>', 20, 2),
    start: SVG('<path d="M8 5l11 7-11 7z" fill="currentColor"></path>', 18, 1.5),
    spark: SVG('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"></path><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"></path>', 24, 1.8),
  };
  // 服务重起过(启动号变了)→ 记下,空下来自己重载(见 staleReload)
  apiSeen = (r) => {
    const boot = r.headers.get('x-cotutor-boot');
    if (boot) { if (!bootId) bootId = boot; else if (boot !== bootId) stale = true; }
  };
  let bootId = null, stale = false;
  // 学科色:服务端定好随老师下发(t.color,src/lib/tutor-color.ts);不归哪位老师的块用中性的灰
  const colorOf = (t) => (t && t.color) || __NEUTRAL_COLOR__;
  // 回首页胶囊带上老师(tutorInitial 同首页牌上的首字,backTint 填颜色)
${BACK_TINT_JS}
  const tintBack = (t) => backTint($('#back'), t ? { color: colorOf(t), display: t.display } : null);
  // 板书底纹的学科字(三门主科):老师换了跟着换,别的老师不写字
${BOARD_MARK_JS}
  /** 老师头像:学科色的 C 形开口环 + 白底圆里的图或字(样子见 .av 的样式);cls 'draw' = 一笔画出来,delay 是错开的秒数 */
  const AV_RING = '<svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"></circle></svg>';
  const avatarEl = (t, cls, delay) => {
    const el = h('span', { class: 'av ' + (cls || ''), style: 'color:' + colorOf(t) + (delay ? ';--d:' + delay + 's' : '') });
    el.innerHTML = AV_RING;
    const face = h('span', { class: 'face' });
    if (t.avatar && /\.(png|jpe?g|webp|svg)$/i.test(t.avatar)) face.append(h('img', { src: '/api/kid/avatar/' + t.name, alt: '' }));
    else face.textContent = t.avatar || (t.subject || t.display || '?').slice(0, 1);
    el.append(face);
    return el;
  };
  const debug = new URLSearchParams(location.search);

  // ---- 状态 ----
  const S = { home: null, tutor: null, day: null, sections: [], played: new Set(), state: { section: -1, line: -1, status: 'idle' }, pending: false, waitSince: null, waitTimer: null, offline: false, bar: 'idle', pollTimer: null, stage: null, partial: null, thread: null, threadAt: null, hist: null, readonly: false, newThread: false, device: 'phone', via: null, cont: null, ask: null, talk: null, talkWait: false, reel: null, pendSaid: null, homeDraw: true };
  // 实时的老师这一次(连、发、收、画在下面「实时的老师」那一块):on = 这位老师这一次走实时(左栏的样子);ready = 嘴连上了;
  // model = liveStep 的状态(只在 liveDispatch 里写);cap = 字幕(上一句、在说的、被打断的那句);heard = 每一轮(job)念到第几句
  const LV = { on: false, ready: false, ws: null, audio: null, model: initialLive(), cap: { prev: '', cur: '', cut: '', catching: false }, heard: new Map(), jobs: new Set(), drain: 0, was: 'quiet', holdAt: 0, diag: null, queued: null, playLine: null, endLine: null, ring: null, ringEnd: 0, lcPending: false, gateOn: false, retries: 0, retryTimer: 0 };
  /** 页面是实时老师的样子:正连着嘴,或录像里放的是有实时轮的话题(卡角没有钮、没有再听) */
  const liveLook = () => LV.on || Boolean(S.reel && S.reel.realtime);
  /** 按住说话那颗按钮(平板横屏左栏;头像 + 声音):样子是 voice-view.ts 的 voiceView 给的、画法在 voice-ui.ts,
   *  这里只在一处(voiceSync)把状态凑好交过去、把音量喂进去。hint = 刚才那一下的提示(留 2 秒);photo = 这一轮发的是照片;loudAt = 按着时最近一次有声音;
   *  reelHold / reelSpeak = 录像里孩子的屏幕这一刻(按着没有、嘴在不在出声) */
  /** 两颗按住说话的按钮一起变:左栏那颗、画板铺满时工具列底下那颗小的;探针、录像读的是大的那颗 */
  const vbPair = (a, b) => ({ el: a.el, set: (v) => { a.set(v); b.set(v); }, shake: () => { a.shake(); b.shake(); }, nod: () => { a.nod(); b.nod(); }, avatar: (n) => { a.avatar(n); b.avatar(n.cloneNode(true)); }, side: (x) => { a.side(x); b.side(x); }, color: (c) => { a.color(c); b.color(c); }, level: (w, v) => { a.level(w, v); b.level(w, v); }, tutorSource: (fn) => { a.tutorSource(fn); b.tutorSource(fn); }, drawn: a.drawn });
  const VB = { btn: vbPair(voiceButton($('#lv-hold'), { side: 'left' }), voiceButton($('#cv-hold'), { side: 'left' })), hint: '', hintT: 0, loudAt: 0, photo: false, silentT: 0, side: 'left', reelHold: null, reelSpeak: false };
  VB.btn.tutorSource(() => (LV.audio && LV.audio.outLevel ? LV.audio.outLevel() : 0));
  $('#lv-av').classList.add('vb-halo');

  // ---- 声音:共享 Audio,首个手势解锁(iOS);卡没配好音就不出声(不用浏览器合成声:老师配了音色,机械声孩子不习惯) ----
  // 录像里孩子的屏幕在家长页的 iframe 里:用家长页那个 Audio(家长点「看录像」时在手势里解锁过),声音才放得出来
  const audioEl = (() => { if (REEL) { try { if (window.parent !== window && window.parent.__cotutorAudio) return window.parent.__cotutorAudio; } catch {} } return new Audio(); })();
  let unlocked = false;
  // 老师的声已经放过(元素早解锁了)就不再放静音:换 src 会抢走正在念的那句,触发它的 onerror 退成浏览器的声重念(2026-10-04 真机:点输入框,当前那句被浏览器重念一遍)。
  // 静音这一下被下一句的 src 打断(AbortError)也算解锁:手势里调过 play() 就够了;原来不算,之后每点一下输入框都会再抢一次
  const unlock = () => {
    if (unlocked) return;
    if (audioEl.src && !audioEl.src.startsWith('data:')) { unlocked = true; return; }
    try { audioEl.onended = audioEl.onerror = audioEl.onplaying = null; audioEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='; audioEl.play().then(() => { unlocked = true; }, (e) => { if (e && e.name === 'AbortError') unlocked = true; }); } catch {}
  };
  let voiceToken = 0;
  /** 配音文件(相对 conversations/<老师>/)的地址 */
  const audioUrl = (rel) => AUDIO + S.tutor.name + '/' + rel.split('/').map(encodeURIComponent).join('/');
  /** 卡上第 k 段的配音(点读段、单词):这一轮跑完才在后台配,孩子刚看到卡就点时可能还没好。
   *  好了就 play(相对路径);没好就每秒拉一次今天(会把 card.assets 补上),到了再放,最多 CARD_CLIP_WAIT_MS;等的时候被别的声音打断(token 变了)就算了。
   *  等不到就 miss()(不出声)。2026-10-08 之前直接退合成声:刚出来的单词卡「听」是机械声,iPad 上开着麦克风时还可能把话筒弄哑;10-28 合成声整个去掉(mock 也配静音的段) */
  const CARD_CLIP_WAIT_MS = 12000;
  const cardClip = (card, k, token, play, miss) => {
    const a = S.tutor ? segmentAudio(card, k) : null;
    if (a) return play(a);
    if (!S.tutor) return miss();
    const until = Date.now() + CARD_CLIP_WAIT_MS;
    const tick = async () => {
      try { await loadDay(true); } catch {}
      if (token !== voiceToken || !S.tutor) return miss(); // miss 里的收尾自己查 token:这里只是把按钮的「在念」撤掉
      const b = segmentAudio(card, k);
      if (b) play(b);
      else if (Date.now() < until) setTimeout(tick, 1000);
      else miss();
    };
    setTimeout(tick, 300);
  };
  /** 换了音源后定倍速(单词卡舞台慢放;看录像另有倍速):换 src 会把 playbackRate 重置成 defaultPlaybackRate,两个一起设;音高不变 */
  const audioRate = (r) => { audioEl.defaultPlaybackRate = r; audioEl.playbackRate = r; try { audioEl.preservesPitch = true; audioEl.webkitPreservesPitch = true; } catch {} };
  /** 只停声音。播放状态不在这里改——那走 dispatch(见下面「播放器」) */
  const silence = () => { voiceToken++; try { audioEl.pause(); } catch {} };

  // ---- 首页:老师卡在上,其余卡照发布的顺序;按钮决定进老师页之后的话题 ----
  const BUTTON_ICON = { new: 'spark', start: 'start', continue: 'again', lecture: 'play' };
  const pickButton = (t, b) => {
    const via = { home: S.home.home, button: b.id };
    // 今天同一个入口聊过的(b.resume):新话题在空白板上放一个胶囊;activity、小课堂先问接着那个还是重新开始
    if (b.kind === 'new') openTutor(t, { kind: 'new', via, resume: b.resume });
    else if (b.kind === 'start') openTutor(t, b.resume ? { kind: 'new', via, ask: { label: b.label, resume: b.resume, send: b.label } } : { kind: 'new', via, send: b.label });
    // 小课堂:新话题,先铺满放课;看完才能开口,开口那条带上 via 与看的情况
    else if (b.kind === 'lecture') { const lecture = { bundle: b.bundle, title: b.title || b.label, ...(b.video ? { video: true } : {}) }; openTutor(t, b.resume ? { kind: 'new', via, ask: { label: b.label, resume: b.resume, lecture } } : { kind: 'new', via, lecture }); }
    else if (b.date === S.home.date) openTutor(t, { kind: 'thread', thread: b.thread, via, send: b.label });
    else openTutor(t, { kind: 'new', via, send: b.label, cont: b.date });
  };
  /** 小课堂的课长:「1 分 40 秒」 */
  const lcLen = (ms) => { const s = Math.floor(ms / 1000); return s >= 60 ? Math.floor(s / 60) + ' 分' + (s % 60 ? ' ' + (s % 60) + ' 秒' : '') : s + ' 秒'; };
  // ---- 常驻入口:听写、拍照听写、口语课一直在那位老师的卡上,不经首页发布 ----
  const EXTRA_ICON = { dictation: SVG('<path d="M4 20l4-1 11-11-3-3L5 16z"></path><path d="M14 7l3 3"></path>', 20), photo: __CAMERA_20__ };
  /** 听写(原型 B,https://claude.ai/artifact/HhpuLJXvNr94E9PqSNv6tj):一整条,上面一排空格子,几个词几格(最多 6,英文是四线三格),下面「听写 · 几个词」和「去写」 */
  const dictationBtn = (label, sub, n, en, href) => h('a', { class: 'bt bt-extra bt-x-dictation' + (en ? ' en' : ''), href },
    h('span', { class: 'dg', 'aria-hidden': 'true' }, ...Array.from({ length: Math.max(1, Math.min(n, en ? 4 : 6)) }, () => h('i'))),
    h('span', { class: 'dr' }, h('span', { class: 'lb' }, h('span', { class: 'btx' }, label), h('small', { class: 'ln' }, sub)), h('span', { class: 'go' }, '去写')));
  /** 拍照听写:图标是一小格——语文的田字格写个「字」、英语的四线格写个「Aa」,右下角学科色的相机;孩子看格子就分得出是写汉字还是写英文 */
  const photoBtn = (t) => {
    const en = t.lang === 'en';
    return h('a', { class: 'bt bt-extra bt-x-photo' + (en ? ' en' : ''), href: '/dictation?tutor=' + encodeURIComponent(t.name) + (en ? '&lang=en' : ''), style: '--sc:' + colorOf(t) },
      h('span', { class: 'pg', 'aria-hidden': 'true' }, h('i', {}, en ? 'Aa' : '字'), h('span', { class: 'cam', html: EXTRA_ICON.photo })),
      h('span', { class: 'lb' }, h('span', { class: 'btx' }, '拍照听写'), h('small', { class: 'ln' }, en ? '拍英语书上要写的单词' : '拍语文书上要写的词')));
  };
  /** 口语课:开着就一直在,点进去先拍照;有上次的口语单,小字写「接着上 · 几月几日的」。/api/talk 30 秒读一次 */
  const talkInfo = () => {
    if (S.talkAt && Date.now() - S.talkAt < 30000) return S.talkLast;
    S.talkAt = Date.now();
    api('GET', '/api/talk').then((j) => {
      const last = j && j.enabled ? (j.talks || []).find((x) => (x.status === 'ready' || x.status === 'done') && x.list.words.length + x.list.sentences.length > 0) : null;
      const next = j && j.enabled ? { last: last || null } : null;
      const sig = (x) => (x ? 'on:' + (x.last ? x.last.id : '') : '');
      const was = sig(S.talkLast); S.talkLast = next;
      if (was !== sig(next) && S.home && !S.tutor) renderHome();
    }, () => {});
    return S.talkLast;
  };
  /** 口语课的按钮:用途图是对话气泡「Hi」带相机角标,和拍照听写的四线格「Aa」挨着、分得开 */
  const talkBtn = (t, info) => {
    const d = info.last ? new Date(info.last.createdAt) : null;
    return h('a', { class: 'bt bt-extra bt-x-talk', href: '/talk?tutor=' + encodeURIComponent(t.name), style: '--sc:' + colorOf(t) },
      h('span', { class: 'pg', 'aria-hidden': 'true' }, h('i', {}, 'Hi'), h('span', { class: 'cam', html: EXTRA_ICON.photo })),
      h('span', { class: 'lb' }, h('span', { class: 'btx' }, '口语课'), h('small', { class: 'ln' }, d ? '接着上 · ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日的,或者拍新的' : '拍今天学的那页,先跟读再聊')));
  };
  /** 这位老师卡上「每天都在」那栏:归他的听写卡、常驻的拍照听写与口语课 */
  const extrasFor = (t, H) => {
    const out = [];
    const extras = t.extras || [];
    const all = (Array.isArray(H.cards) ? H.cards : []).filter((x) => x.kind === 'dictation');
    // 英文单词听写:卡上的词是英文单词,或者英语老师卡上的拍照听写 → /dictation?lang=en
    for (const c of all) if (c.owner === t.name) { const en = c.props.lang === 'en', n = c.props.count || 0; out.push(dictationBtn(en ? '单词听写' : '听写', n + (en ? ' 个单词' : ' 个词') + ' · 老师念,你来写', n, en, '/dictation?home=' + encodeURIComponent(H.home || '') + '&n=' + all.indexOf(c) + (en ? '&lang=en' : ''))); }
    if (extras.includes('dictation')) out.push(photoBtn(t));
    if (extras.includes('talk')) { const info = talkInfo(); if (info) out.push(talkBtn(t, info)); }
    return out;
  };
  // 牌上的按钮(原型 B,https://claude.ai/artifact/HhpuLJXvNr94E9PqSNv6tj):新话题是头像下面一个学科色大气泡(不带尖角);小课堂是带预览图的海报;其余是大胶囊。
  // 孩子看到的字都在 .btx 里(探针按它读)。新话题打头印名字的首字(.fc):平板横着叠时后面的牌只露左边一格,露出来的那截气泡就是这个字;手机也印,两处一样
  const tutorButton = (t, b) => {
    const on = { click: () => pickButton(t, b) };
    const fc = tutorInitial(t);
    if (b.kind === 'new') return h('button', { type: 'button', class: 'bt bt-new', 'data-bid': String(b.id), style: '--sc:' + colorOf(t), on }, fc ? h('span', { class: 'fc', 'aria-hidden': 'true' }, fc) : null, h('span', { class: 'lb' }, h('span', { class: 'btx' }, b.label), h('small', { class: 'ln' }, '想问我什么?')), h('span', { class: 'bi', html: ICON.spark }));
    if (b.kind === 'lecture') return h('button', { type: 'button', class: 'bt bt-lecture', 'data-bid': String(b.id), on }, lecturePic(b),
      h('span', { class: 'lm' }, h('small', { class: 'tg' }, '小课堂'), h('span', { class: 'btx' }, b.label), b.ms ? h('small', { class: 'ln' }, lcLen(b.ms)) : null));
    return h('button', { type: 'button', class: 'bt bt-' + b.kind, 'data-bid': String(b.id), on }, h('span', { class: 'bi', html: ICON[BUTTON_ICON[b.kind]] || ICON.start }), h('span', { class: 'btx' }, b.label));
  };
  /** 挨着的几个小课堂收进一格(平板上两张海报并排,手机上一张一行) */
  const buttonRuns = (t, buttons) => {
    const out = [];
    for (const b of buttons) {
      const el = tutorButton(t, b), last = out[out.length - 1];
      if (b.kind !== 'lecture') out.push(el);
      else if (last && last.classList.contains('lcs')) last.append(el);
      else out.push(h('div', { class: 'lcs' }, el));
    }
    return out;
  };
  /** 小课堂海报的图:课包画最后一帧(frame.svg,没烤好时 404 就只留底色和播放键),视频停在末尾前一点 */
  const lecturePic = (b) => {
    const box = h('span', { class: 'lp' });
    if (b.video) { if (b.ms) box.append(lcVideoStill(b.bundle, b.ms)); }
    else box.append(h('img', { alt: '', src: lcBundleUrl(b.bundle) + 'frame.svg?svg=end', on: { error: () => box.classList.add('nopic') } }));
    box.append(h('span', { class: 'pl', html: ICON.play }));
    return box;
  };

  // ---- 首页牌堆(原型 https://claude.ai/artifact/BAUVUj9TgCKpiQkRyZtvLy):一位老师一张牌,平着叠,最前那张在最上层 ----
  // 手机竖着叠:后面的牌在上面,每张往上露出头那一行(头像 + 名字);平板横着叠:后面的牌在左边,每张往左露出一格(左上角的头像)。
  // 叠的顺序 K.order:最后一个在最前。进首页时家长排第一的在最前、排第二的紧挨在后面;点过谁谁到最前(最近点过的在前);
  // 从老师页回来不变,刷新页面回到家长排的。牌一样高(取最高那张)。牌元素常驻,5 秒一轮的刷新只在这张牌的内容变了时重画它、不放动画
  const K = { order: null, els: new Map(), busy: false, geo: null };
  // 从牌上去了别的页(听写、拍照听写、口语课),回来是整页重开、K.order 没了:走之前记下是哪位的牌,下一次进首页读一次就删(「回来停在刚才那位」;刷新照旧回家长排的)
  const FRONT_KEY = 'kid-home-front';
  const stashFront = (el) => { if (PREVIEW) return; const pc = el && el.closest && el.closest('[data-tutor]'); try { if (pc) sessionStorage.setItem(FRONT_KEY, pc.dataset.tutor); } catch {} };
  const takeFront = () => { if (PREVIEW) return null; let f = null; try { f = sessionStorage.getItem(FRONT_KEY); sessionStorage.removeItem(FRONT_KEY); } catch {} return f; };
  const reduced = () => Boolean(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  // 橙点「看过了」记在这台设备上(换了一份首页就清):家长排了东西、孩子还没找过这位老师时亮,换到最前就灭
  const SEEN_KEY = 'kid-home-seen';
  const seenOf = (home) => { try { const j = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); return j.home === home && Array.isArray(j.tutors) ? j.tutors : []; } catch { return []; } };
  const markSeen = (home, name) => { if (PREVIEW) return; try { const t = seenOf(home); if (!t.includes(name)) localStorage.setItem(SEEN_KEY, JSON.stringify({ home, tutors: [...t, name] })); } catch {} };
  const homeTutorsOf = (H) => {
    const byName = new Map(H.tutors.map((t) => [t.name, t]));
    return (Array.isArray(H.cards) ? H.cards : []).filter((c) => c.kind === 'tutor' && byName.has(c.props.tutor)).map((c) => ({ t: byName.get(c.props.tutor), card: c }));
  };
  // 平板的牌最宽 640(原型 B):两张小课堂海报并排要这么宽
  const DECK = { V: { av: 56, nm: 21, pull: 44, head: 48 }, H: { av: 64, nm: 24, pull: 120, head: 40, wMax: 640, wMin: 320, step: 84, stepMin: 48 } };
  const DECK_SCALE = [1, 0.97, 0.94, 0.91, 0.88], DECK_VEIL = [0, 0.16, 0.26, 0.34, 0.4];
  // 影子:竖着叠往上投、横着叠往左投,落在后面那张上;第二个是拿起来时的
  const DECK_SHADOW = { V: ['0 -4px 14px rgba(70,50,30,.14)', '0 24px 34px rgba(70,50,30,.24)'], H: ['-6px 4px 14px rgba(70,50,30,.16)', '-18px 26px 34px rgba(70,50,30,.26)'] };
  // 换一张的时间表(ms):按下 → 往盖着它的牌的反方向抽出(还在原层)→ 230 换到最上层、浮起 → 飘到最前、略冲过 → 落下回弹、张嘴;
  // 其余几张 230 起各退一层,挨着缺口的先走
  const DT = { press: 70, pull: 230, lift: 320, glide: 580, land: 700, shift: [230, 580], stagger: 30, bite: 580, lock: 900 };
  const deckAxis = () => ((debug.get('device') || deviceFor(innerWidth, innerHeight)) === 'phone' ? 'V' : 'H');
  const deckBase = (slot, n) => { const g = K.geo, d = Math.min(n - 1 - slot, 4); return { x: g.axis === 'H' ? slot * g.step : 0, y: g.axis === 'V' ? slot * g.strip : 0, r: 0, s: DECK_SCALE[d], v: DECK_VEIL[d] }; };
  const deckTf = (b) => 'translate(' + b.x.toFixed(1) + 'px,' + b.y.toFixed(1) + 'px) rotate(' + b.r + 'deg) scale(' + b.s + ')';
  const deckPlace = (el, slot, n) => {
    const b = deckBase(slot, n), tf = deckTf(b);
    el.style.transform = tf; el.style.setProperty('--tf', tf); el.style.boxShadow = DECK_SHADOW[K.geo.axis][0]; el.style.zIndex = String(slot + 1);
    el.querySelector('.veil').style.opacity = String(b.v);
  };
  /** 量牌宽、牌高、竖着叠露出的那条,摆好每张;换牌时不动 */
  const layoutDeck = () => {
    const box = $('#deck'), n = K.order ? K.order.length : 0;
    if (K.busy || !n || box.hidden) return;
    const axis = deckAxis(), d = DECK[axis], home = box.parentElement, cs = getComputedStyle(home);
    const avail = home.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const g = { axis, ...d, step: d.step || 0 };
    if (axis === 'V') g.w = avail;
    else {
      g.w = Math.min(d.wMax, avail - (n - 1) * d.step);
      if (g.w < d.wMin) { g.step = Math.max(d.stepMin, (avail - d.wMin) / Math.max(1, n - 1)); g.w = Math.max(240, avail - (n - 1) * g.step); }
    }
    box.style.setProperty('--w', g.w + 'px'); box.style.setProperty('--av', d.av + 'px'); box.style.setProperty('--nmz', d.nm + 'px');
    box.style.setProperty('--org', axis === 'V' ? '50% 0%' : '0% 100%'); box.style.setProperty('--head', d.head + 'px');
    // 一样高:取最高那张;竖着叠时露出的那条 = 头那一行实际的高度 + 8
    const cards = [...K.els.values()];
    let tall = 0, strip = 0;
    for (const el of cards) { el.style.height = 'auto'; tall = Math.max(tall, el.offsetHeight); const hd = el.querySelector('.pc-hd'); strip = Math.max(strip, hd.offsetTop + hd.offsetHeight + 8); }
    for (const el of cards) el.style.height = '';
    g.strip = strip; K.geo = g;
    box.style.setProperty('--h', tall + 'px');
    box.style.width = (axis === 'H' ? g.w + (n - 1) * g.step : g.w) + 'px';
    box.style.height = (d.head + (axis === 'V' ? (n - 1) * strip : 0) + tall + 12) + 'px';
    box.style.marginLeft = box.style.marginRight = axis === 'H' ? 'auto' : '';
    K.order.forEach((name, slot) => deckPlace(K.els.get(name), slot, n));
  };
  // ---- 家长端「首页」里的预览:S.pv = {tutor, sel, edit: {k, kind, label, until} | null, add: 字 | null},家长页塞进来的,只在预览里 ----
  const pvHost = () => { try { return window.parent !== window && typeof window.parent.cotutorPreview === 'function' ? window.parent : null; } catch { return null; } };
  const pvTell = (ev) => { const host = pvHost(); if (host) host.cotutorPreview(ev); };
  /** 牌上的按钮换上家长正改着的那颗(字、留到),新加的那颗(id draft)排在最后;没在改就是孩子此刻拿到的 */
  const pvButtons = (n, list) => {
    const P = PREVIEW && S.pv && S.pv.tutor === n ? S.pv : null;
    if (!P || (!P.edit && !P.add)) return list;
    const today = S.home && S.home.date;
    const E = P.edit, gone = E && E.until && today && E.until < today;
    let out = list.map((b) => (E && b.id === E.k ? { ...b, label: E.label } : b)).filter((b) => !(gone && E && b.id === E.k));
    if (E && !gone && !out.some((b) => b.id === E.k)) out.push({ kind: E.kind === 'continue' ? 'continue' : 'start', label: E.label, id: E.k });
    if (P.add) out.push({ kind: 'start', label: P.add, id: 'draft' });
    return out;
  };
  if (PREVIEW) {
    window.cotutorPreviewSet = (o) => {
      if (!o) return;
      if ('pv' in o) S.pv = o.pv;
      const toFront = () => { if (o.front && K.order && !K.busy && K.order.includes(o.front) && K.order[K.order.length - 1] !== o.front) K.order = K.order.filter((x) => x !== o.front).concat([o.front]); };
      // 发布了(按钮、先后、开关):重读孩子的首页,牌堆照家长新排的先后重叠一遍(孩子端只在老师换了人时才重叠),再把在看的那位抽到最前
      if (o.reload) { K.order = null; loadHome().then(() => { toFront(); if (S.home && !S.tutor) renderHome(); }); return; }
      toFront();
      if (S.home && !S.tutor) renderHome();
    };
    // 点牌上的按钮不跳走,告诉家长页点了哪颗;后面那张照孩子端换到最前(换完 pickTutor 里告诉家长页);牌外的东西点了什么都不做
    document.addEventListener('click', (e) => {
      const pc = e.target.closest ? e.target.closest('#deck .pc') : null;
      if (pc && !pc.classList.contains('front')) return;
      e.preventDefault(); e.stopPropagation();
      const bt = pc ? e.target.closest('.bt') : null;
      if (!bt) return;
      const bid = bt.dataset.bid;
      if (bid !== undefined) pvTell({ act: 'button', tutor: pc.dataset.tutor, id: bid === 'new' || bid === 'draft' ? bid : Number(bid) });
      else pvTell({ act: 'extra', tutor: pc.dataset.tutor, kind: bt.classList.contains('bt-x-talk') ? 'talk' : 'dictation' });
    }, true);
  }
  /** 每位老师一张牌:头像 + 名字、按钮、「每天都在」、归他的卡,右下角倒着一个小头像;deal = 打开首页、从老师页回来,发牌 */
  const renderDeck = (H, list, deal) => {
    const box = $('#deck');
    const front = K.order[K.order.length - 1];
    const seen = seenOf(H.home);
    for (const [n, el] of K.els) if (!K.order.includes(n)) { el.remove(); K.els.delete(n); }
    K.order.forEach((n, slot) => {
      const { t, card } = list.find((x) => x.t.name === n);
      const buttons = pvButtons(n, Array.isArray(card.props.buttons) ? card.props.buttons : []);
      const owned = (Array.isArray(H.cards) ? H.cards : []).filter((c) => c.kind !== 'tutor' && c.owner === n);
      const sig = JSON.stringify([t.avatar, t.subject, t.display, buttons, owned, t.extras, S.talkLast && (S.talkLast.last ? S.talkLast.last.id : 'on'), H.home]);
      let el = K.els.get(n);
      if (!el) {
        const pc = h('div', { class: 'c c-tutor pc', 'data-tutor': n, on: { click: (e) => { if (e.target.closest && e.target.closest('a[href]')) stashFront(pc); if (!pc.classList.contains('front')) pickTutor(n); } } });
        box.append(pc); K.els.set(n, pc); el = pc;
      }
      if (deal || el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        el.style.borderColor = colorOf(t);
        const extras = extrasFor(t, H);
        const others = owned.filter((c) => c.kind !== 'dictation');
        el.replaceChildren(...[
          h('div', { class: 'pc-hd' }, deal ? avatarEl(t, 'draw', 0.1 + slot * 0.12) : avatarEl(t), h('span', { class: 'nm' }, t.display)),
          h('div', { class: 'kc' }, h('div', { class: 'bts' }, ...buttonRuns(t, buttons)), extras.length ? h('div', { class: 'bts extras' }, ...extras) : null),
          others.length ? h('div', { class: 'hcards kcards' }, ...others.map((c, i) => renderCard(c, i, null, false))) : null,
          h('span', { class: 'pc-ix' }, avatarEl(t)),
          h('span', { class: 'veil' }),
        ].filter(Boolean));
        // 归他的卡里有图:图到了牌会变高,重量一次
        for (const img of el.querySelectorAll('img')) if (!img.complete) img.addEventListener('load', layoutDeck, { once: true });
      } else el.querySelector('.pc-hd .av').classList.remove('draw'); // 之后的刷新摘掉(动画早放完了,摘了也不会重放)
      el.classList.toggle('front', n === front);
      if (PREVIEW) for (const b of el.querySelectorAll('.bt')) b.classList.toggle('pv-sel', Boolean(S.pv && S.pv.tutor === n && S.pv.sel !== null && S.pv.sel !== undefined && String(S.pv.sel) === b.dataset.bid));
      const dot = Boolean(card.props.news) && n !== front && !seen.includes(n);
      const hd = el.querySelector('.pc-hd'), had = hd.querySelector('.dot');
      if (dot && !had) hd.append(h('span', { class: 'dot' })); else if (!dot && had) had.remove();
    });
    layoutDeck();
    // 发牌:从最底下那张起,一张张从下面滑上来,最前那张最后
    if (deal && !reduced()) K.order.forEach((n, slot) => { const b = deckBase(slot, K.order.length); K.els.get(n).animate([{ transform: deckTf({ ...b, y: b.y + 60 }), opacity: 0 }, { transform: deckTf(b), opacity: 1 }], { duration: 420, delay: slot * 120, easing: 'cubic-bezier(.2,.9,.3,1.15)', fill: 'backwards' }); });
  };
  /** 一段动画:跑完把末帧写进 style 再取消,不留 fill */
  const deckRun = (el, kf, dur, delay, easing) => {
    const a = el.animate(kf, { duration: dur, delay: delay || 0, easing: easing || 'linear', fill: 'both' });
    a.finished.then(() => { const last = kf[kf.length - 1]; for (const k in last) if (k !== 'offset' && k !== 'easing') el.style[k] = last[k]; a.cancel(); }, () => {});
  };
  /** 点后面那张:先往盖着它的牌的反方向抽出(平板往左、手机往上),230 ms 换到最上层、浮起,再飘到最前(平板往右、手机往下)、落下、张嘴;
   *  其余几张各退一层。牌太大抽不干净,换层那一下会盖过前面那张,靠它同时放大、影子拉长、前面几张同时变暗读成「拿起来了」。点最前那张不换 */
  const pickTutor = (n) => {
    const H = S.home, N = K.order ? K.order.length : 0, i = N ? K.order.indexOf(n) : -1;
    if (!H || K.busy || !K.geo || i < 0 || i === N - 1) return;
    const next = K.order.filter((x) => x !== n).concat([n]);
    const el = K.els.get(n);
    const done = () => { K.busy = false; K.order = next; markSeen(H.home, n); renderHome(); if (PREVIEW) pvTell({ act: 'front', tutor: n }); };
    if (reduced()) { done(); el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' }); return; }
    K.busy = true;
    const g = K.geo, b = deckBase(i, N), f = deckBase(N - 1, N), [SH, UP] = DECK_SHADOW[g.axis];
    let way;
    if (g.axis === 'H') { const ax = b.x - g.pull, mid = (ax + 10 + f.x + 8) / 2; way = [{ x: ax, y: -14, r: -2, s: b.s }, { x: ax + 10, y: -30, r: -1, s: 1.03 }, { x: mid, y: -34, r: 0, s: 1.03 }, { x: f.x + 8, y: -8, r: 1, s: 1.01 }]; }
    else { const ay = b.y - g.pull, mid = (ay - 10 + f.y + 8) / 2; way = [{ x: -6, y: ay, r: 0, s: b.s }, { x: -12, y: ay - 10, r: 0, s: 1.03 }, { x: -18, y: mid, r: 0, s: 1.03 }, { x: -4, y: f.y + 8, r: 0, s: 1.01 }]; }
    const o = (x) => x / DT.land;
    for (const x of K.els.values()) x.classList.remove('front');
    deckRun(el, [
      { offset: 0, transform: deckTf(b), boxShadow: SH, easing: 'ease-out' },
      { offset: o(DT.press), transform: deckTf({ ...b, s: b.s * 0.97 }), boxShadow: SH, easing: 'cubic-bezier(.3,0,.2,1)' },
      { offset: o(DT.pull), transform: deckTf(way[0]), boxShadow: SH, easing: 'ease-out' },
      { offset: o(DT.lift), transform: deckTf(way[1]), boxShadow: UP, easing: 'ease-in' },
      { offset: o((DT.lift + DT.glide) / 2), transform: deckTf(way[2]), boxShadow: UP, easing: 'ease-out' },
      { offset: o(DT.glide), transform: deckTf(way[3]), boxShadow: UP, easing: 'cubic-bezier(.3,1.5,.6,1)' },
      { offset: 1, transform: deckTf(f), boxShadow: SH },
    ], DT.land);
    deckRun(el.querySelector('.veil'), [{ opacity: String(b.v) }, { opacity: '0' }], DT.lift - DT.press, DT.press, 'ease-out');
    setTimeout(() => { el.style.zIndex = '50'; K.order.forEach((x) => { if (x !== n) K.els.get(x).style.zIndex = String(next.indexOf(x) + 1); }); }, DT.pull);
    K.order.forEach((x, s) => {
      if (x === n) return;
      const from = deckBase(s, N), to = deckBase(next.indexOf(x), N), q = K.els.get(x);
      const delay = DT.shift[0] + (s > i ? (s - i - 1) * DT.stagger : 0);
      deckRun(q, [{ transform: deckTf(from) }, { transform: deckTf(to) }], DT.shift[1] - DT.shift[0], delay, 'cubic-bezier(.3,1.2,.5,1)');
      deckRun(q.querySelector('.veil'), [{ opacity: String(from.v) }, { opacity: String(to.v) }], 200, delay, 'ease-out');
    });
    // 张嘴:开口一张一合一次(和老师页「说」同一套 dasharray)
    const ring = el.querySelector('.pc-hd .ring circle');
    if (ring) ring.animate([{ strokeDasharray: '221.17 55.29', transform: 'rotate(36deg)' }, { offset: 0.45, strokeDasharray: '193.52 82.94', transform: 'rotate(54deg)' }, { strokeDasharray: '221.17 55.29', transform: 'rotate(36deg)' }], { duration: 300, delay: DT.bite, easing: 'ease-in-out' });
    setTimeout(done, DT.lock);
  };
  let deckResize = 0;
  window.addEventListener('resize', () => { clearTimeout(deckResize); deckResize = setTimeout(() => { if (!S.tutor && S.home) layoutDeck(); }, 150); });
  const renderHome = () => {
    const H = S.home;
    document.title = H.title; $('#title').textContent = H.title;
    const cards = Array.isArray(H.cards) ? H.cards : [];
    const list = homeTutorsOf(H);
    const names = list.map((x) => x.t.name);
    $('#deck').hidden = !names.length;
    // 换牌的那 900 ms 里不动牌堆(下一轮刷新补上);发牌只在打开首页、从老师页回来时发一次
    if (names.length && !K.busy) {
      const deal = S.homeDraw; S.homeDraw = false;
      if (deal) ctReplay(ctMark, 'ct-draw'); // 发牌之前先把 logo 画出来
      // 老师变了(开了、关了、换了一份首页的排法)就按家长排的重来:排第一的在最前
      if (!K.order || K.order.length !== names.length || names.some((x) => !K.order.includes(x))) {
        const f = K.order ? null : takeFront();
        K.order = [...names].reverse();
        if (f && K.order.includes(f)) K.order = K.order.filter((x) => x !== f).concat([f]);
      }
      renderDeck(H, list, deal);
      if (deal) markSeen(H.home, K.order[K.order.length - 1]);
    }
    // 公共的卡(写在第一张老师卡前面的)在牌堆上面;归了老师的在那位老师的牌里
    $('#hcards').replaceChildren(...cards.filter((c) => c.kind !== 'tutor' && !c.owner).map((c, i) => renderCard(c, i, null, false)));
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
    try { S.home = await api('GET', '/api/kid/home'); setOffline(false); document.body.classList.toggle('hand-left', S.home.hand === 'left'); setGated(!REEL && S.home.ready === false); renderHome(); phIdle(); }
    catch { setOffline(true); }
  };
  /** 百炼没配:首页的老师灰着点不进去;在老师页上就回首页。家长配好了下一次读首页自己就好 */
  const setGated = (on) => {
    if (S.gated === on) return;
    S.gated = on;
    document.body.classList.toggle('gated', on);
    if (on && S.tutor) closeTutor();
  };
  const setOffline = (off) => {
    if (S.offline === off) return;
    S.offline = off;
    // 断了多久记一笔流水(kid-log.ts):断着发不出去,通了再报
    kidLog.offline(off);
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
    S.tutor = t; S.sections = []; S.played = new Set(); dispatch({ type: 'reset' }); S.pending = false; S.stage = null; S.paper = null; S.partial = null; $('#stage').classList.remove('on', 'cv');
    S.thread = intent.kind === 'thread' ? intent.thread : null; S.threadAt = null; S.hist = null; S.readonly = false; S.newThread = intent.kind === 'new';
    S.via = intent.via || null; S.cont = intent.cont || null; S.lecture = intent.lecture ? { ...intent.lecture, watch: null, sent: false, marks: [], flying: [], log: [] } : null; S.ask = intent.ask || null;
    // 口语课页拍好了口语单:先等孩子点「先热身,再打电话」(那一下起声音),发出去的第一条带 talk
    S.talk = intent.talk || null; S.talkWait = Boolean(intent.talk);
    // 先定走不走实时,再热麦克风:实时时麦克风的自检要开在实时那个 AudioContext 里(liveOpen)
    if (liveWanted(t)) liveOpen(intent); else liveClose();
    $('#hist').classList.remove('on'); $('#menu').classList.remove('on'); renderBar(); renderHeader();
    $('#sub-av').replaceWith(Object.assign(avatarEl(t), { id: 'sub-av' })); tintBack(t); markBoard($('#bmark'), t);
    $('#board').replaceChildren(); pin.on = false;
    if (S.ask) $('#board').append(askBoard(S.ask));
    else if (S.talkWait) $('#board').append(talkBoard());
    else if (S.newThread && !intent.send && !S.lecture) $('#board').append(blankBoard('想问什么?', intent.resume));
    $('#tutor').classList.add('on');
    setBar('idle');
    loadDay(true).then(() => { if (intent.send) send(intent.send); });
    if (S.lecture) openLecture();
    viewKey = ''; viewNote();
  };
  /** 空板:没有顶栏了,老师是谁写在这里(头像、名字、口头禅),下面才是「想问什么」。
   *  三种空板(这个、askBoard、talkBoard)都把老师要说的挂在 _open 上:实时时板上这块收着,左栏照它画(openSync) */
  const blankBoard = (title, resume) => withOpen(h('div', { class: 'blank' }, S.tutor ? avatarEl(S.tutor, 'draw') : null, S.tutor ? h('span', { class: 'nm' }, S.tutor.display) : null, h('b', {}, title), S.tutor && S.tutor.firstQuestion ? h('small', {}, '比如:' + S.tutor.firstQuestion) : null, resume && S.tutor ? resumeChip(resume) : null),
    { kind: 'new', big: title, small: S.tutor && S.tutor.firstQuestion ? '比如:' + S.tutor.firstQuestion : '', acts: resume && S.tutor ? [{ cls: 'back', icon: 'again', k: resume.title ? '接着刚才的' : '', s: resume.title || '接着刚才的', tm: clock(resume.at), go: () => resumeThread(resume.thread) }] : [] });
  /** 空板挂上老师要说的(开场那句 big、下面一行 small、选择 acts:{cls, icon, k 上面的小字, s 大字, sub 下面的小字, tm 时刻, id, go}) */
  const withOpen = (el, o) => { el._open = o; return el; };
  // ---- 接着今天的(设计稿 https://claude.ai/artifact/QkJBzLVbL7tgfEGKcDjaRm):首页不再有「接着刚才的」,进来都是新话题 ----
  const tutorColor = () => colorOf(S.tutor);
  /** 回到今天的那个话题:照旧铺开、不重播(同「以前的」里点今天的一行) */
  const resumeThread = (thread) => { S.ask = null; switchThread(null, thread); };
  /** 新话题空白板上的胶囊:今天最后一个自由话题;孩子一开口(发出去)空白板连它一起收起 */
  const resumeChip = (r) => h('button', { type: 'button', class: 'resume', style: 'color:' + tutorColor() + ';border-color:' + tutorColor(), on: { click: () => resumeThread(r.thread) } }, h('span', { class: 'ic', html: ICON.again }), h('span', {}, r.title ? '接着刚才的:' + r.title : '接着刚才的'), h('small', {}, clock(r.at)));
  /** activity、小课堂今天点过同一个:先问接着那个,还是重新开始(不点就不开讲、不算一条) */
  const askBoard = (ask) => withOpen(h('div', { class: 'blank ask' }, avatarEl(S.tutor, 'draw'), h('span', { class: 'nm' }, S.tutor.display), h('b', {}, '今天点过「' + ask.label + '」啦'),
    h('div', { class: 'ask-row' },
      h('button', { type: 'button', class: 'ask-go back', style: 'color:' + tutorColor() + ';border-color:' + tutorColor(), on: { click: () => resumeThread(ask.resume.thread) } },
        h('span', { class: 't' }, h('span', { class: 'ic', html: ICON.again }), '接着刚才那个'), h('span', { class: 's' }, ask.resume.title || '刚开了个头'), h('small', {}, clock(ask.resume.at))),
      h('button', { type: 'button', class: 'ask-go fresh', style: 'background:' + tutorColor(), on: { click: () => startFresh(ask) } },
        h('span', { class: 't' }, h('span', { class: 'ic', html: ICON.spark }), ask.lecture ? '从头看一遍' : '重新开始'), h('span', { class: 's' }, ask.lecture ? ask.lecture.title : ask.label)))),
    { kind: 'ask', big: '今天点过「' + ask.label + '」啦', small: '', acts: [
      { cls: 'back', icon: 'again', k: '接着刚才那个', s: ask.resume.title || '刚开了个头', tm: clock(ask.resume.at), go: () => resumeThread(ask.resume.thread) },
      { cls: 'fresh', icon: 'spark', k: ask.lecture ? '从头看一遍' : '重新开始', s: ask.lecture ? ask.lecture.title : ask.label, go: () => startFresh(ask) }] });
  /** 口语课页过来的:口语单拍好了,点一下开始(这一下点击起声音、开麦;不点不开讲) */
  const talkGo = () => {
    unlock(); if (LV.audio) LV.audio.wake().catch(() => {}); liveMicOn();
    S.talkWait = false; renderBar();
    const b = $('#board .blank'); if (b) b.remove();
    send('口语课');
  };
  const talkBoard = () => {
    const el = withOpen(h('div', { class: 'blank ask' }, avatarEl(S.tutor, 'draw'), h('span', { class: 'nm' }, S.tutor.display), h('b', {}, '口语单拍好啦'),
      h('div', { class: 'ask-row' },
        h('button', { type: 'button', class: 'ask-go fresh', style: 'background:' + tutorColor(), on: { click: talkGo } },
          h('span', { class: 't' }, h('span', { class: 'ic', html: ICON.spark }), '先热身,再打电话'), h('span', { class: 's' }, '先跟老师热热身,再打个电话聊一聊')))),
      { kind: 'talk', big: '口语单拍好啦', small: '', acts: [{ cls: 'fresh talk', icon: 'play', s: '先热身,再打电话', sub: '点一下开始', id: 'talk-go', go: talkGo }] });
    // 左栏那句下面写几个单词、几个句子(读不到就不写)
    if (S.talk) api('GET', '/api/talk/' + encodeURIComponent(S.talk)).then((j) => {
      const l = j && j.meta && j.meta.list; if (!l) return;
      el._open.small = [l.words.length ? l.words.length + ' 个单词' : '', l.sentences.length ? l.sentences.length + ' 个句子' : ''].filter(Boolean).join('、');
      if (LO.el === el) { LO.el = undefined; openSync(); }
    }, () => {});
    return el;
  };
  const startFresh = (ask) => {
    S.ask = null;
    const b = $('#board .blank'); if (b) b.remove();
    if (ask.lecture) { S.lecture = { ...ask.lecture, watch: null, sent: false, marks: [], flying: [], log: [] }; renderBar(); renderHeader(); openLecture(); }
    else { renderBar(); send(ask.send); }
  };
  /** 空板上老师对孩子说的话挪进左栏(实时,原型 F 排):照板上那块 .blank 的 _open 画 #lv-ask、#lv-acts。
   *  板上那块一换、一收(进老师页、换话题、孩子开口、点了选择……十来处)都是 #board 的子节点在变:盯着它,一处跟上 */
  const LO = { el: undefined };
  const lvGo = (a) => h('button', { type: 'button', class: 'lv-go ' + a.cls, id: a.id || null, on: { click: a.go } }, h('span', { class: 'ic', html: ICON[a.icon] }),
    h('span', { class: 'tx' }, a.k ? h('span', { class: 'k' }, a.k) : null, h('span', { class: 's' }, a.s), a.sub ? h('span', { class: 'k' }, a.sub) : null), a.tm ? h('span', { class: 'tm' }, a.tm) : null);
  function openSync() {
    const b = $('#board > .blank'), o = b && b._open ? b._open : null;
    if (LO.el === b) return;
    LO.el = b;
    document.body.classList.toggle('lv-opening', Boolean(o));
    const ask = $('#lv-ask');
    ask.dataset.kind = o ? o.kind : '';
    ask.querySelector('b').textContent = o ? o.big : '';
    ask.querySelector('small').textContent = o ? o.small : '';
    $('#lv-acts').replaceChildren(...(o ? o.acts.map(lvGo) : []));
  }
  new MutationObserver(openSync).observe($('#board'), { childList: true });
  const closeTutor = () => { liveDispatch({ type: 'reset' }); liveClose(); hideLecture(); S.lecture = null; reelStop(); clearTimeout(S.pollTimer); dispatch({ type: 'halt' }); psClose(); $('#menu').classList.remove('on'); $('#lb').classList.remove('on'); S.tutor = null; S.via = null; S.cont = null; S.ask = null; $('#tutor').classList.remove('on'); document.body.classList.remove('pending', 'speaking', 'nod'); S.homeDraw = true; loadHome(); };
  $('#back').addEventListener('click', closeTutor);
  $('#back-ic').innerHTML = ICON.back;

  // 卡片:按 kind 分支(轻插件内联;不认识的 kind 把 props 里的字都显示出来)。紧凑态只读,点了开舞台;stage=true 是舞台里的画法
  const renderCard = (c, idx, secIdx, stage) => {
    const p = c.props || {};
    // 每张卡带底色槽与字形槽(围栏行上写的 look,没有就机械规则);名字对不上主题的,CSS 落回 paper / plain
    const board = !stage && secIdx !== null;
    const lk = board && c.submitted ? h('span', { class: 'lk', html: ICON.lock + '交给老师了' }) : null;
    const box = (cls, ...kids) => h('div', { class: 'c c-' + cls, 'data-card': idx, 'data-tint': tintFor(c), 'data-look': lookFor(c), on: board ? { click: () => openStage(secIdx, idx) } : {} }, ...kids, lk);
    switch (c.kind) {
      case 'text': {
        if (isHeading(c)) return board && liveSec(secIdx) ? liveHeadEl(p.title || '', secIdx, idx) : h('div', { class: 'heading', 'data-card': idx }, p.title || '');
        const emoji = c.look && c.look.emoji ? c.look.emoji + ' ' : '';
        const title = p.title ? h('div', { class: 'ct' }, emoji + p.title) : null;
        const body = p.text ? h('div', { class: 'cb' }, p.text) : null;
        // 提问卡:末句那一问(解析器补的),和选择题的问题一个字重;问题卡下沿是孩子的答案栏
        const a = board ? ansFor(secIdx, idx) : null;
        const el = box(isAskCard(c) ? 'text c-ask' : 'text', title, body, a ? ansEl(a) : null);
        if (a) el.dataset.ans = ansKey(a);
        return el;
      }
      case 'read':
        return box('read', ...(p.segments || []).map((seg, k) => h('div', { class: 'rd', on: { click: (e) => { e.stopPropagation(); readSegment(e.currentTarget, c, k); } } }, seg)));
      case 'image': {
        const src = /^https?:\\/\\//.test(p.src || '') ? p.src : '/api/kid/image?p=' + encodeURIComponent(p.src || '');
        if (stage) { const el = box('image'); el.className = 'zoom'; el.append(h('img', { src, alt: p.caption || '' })); pinch(el); return el; }
        return box('image', h('img', { src, alt: '', loading: 'lazy' }), p.caption ? h('div', { class: 'cap' }, p.caption) : null);
      }
      case 'paint': {
        // 画图卡(你说我画):题干、画好的图(没画好是分好的几幅)、词语宝库;舞台里放大看图。没画成也不说,停在分好的几幅;角色不显示
        const pic = p.pic ? '/api/kid/image?p=' + encodeURIComponent(p.pic) : null;
        if (stage && pic) { const el = box('paint'); el.className = 'zoom'; el.append(h('img', { src: pic, alt: '画家画的' })); pinch(el); return el; }
        const panels = Array.isArray(p.panels) ? p.panels : [];
        const grid = h('div', { class: 'pt-grid' + (panels.length === 1 ? ' one' : '') }, ...panels.map((t, i) => h('div', { class: 'pt-cell' }, h('span', { class: 'pt-n' }, String(i + 1)), h('div', {}, t))));
        const words = Array.isArray(p.words) && p.words.length ? h('div', { class: 'pt-words' }, h('b', {}, '词语宝库'), h('span', {}, p.words.join('、'))) : null;
        const art = h('div', { class: 'pt-art' }, pic ? h('img', { src: pic, alt: '画家画的' }) : grid, !pic && p.drawn === 'drawing' ? h('div', { class: 'pt-wait' }, '画家在画') : null);
        const el = box('paint', p.ask ? h('div', { class: 'pt-ask' }, p.ask) : null, h('div', { class: 'pt-body' }, art, words));
        el.dataset.drawn = p.drawn || '';
        return el;
      }
      case 'choice': {
        const picked = (c.state && Array.isArray(c.state.picked)) ? c.state.picked : [];
        if (stage) return box('choice', h('div', { class: 'sq' }, p.question || ''), ...(p.options || []).map((o, i) => h('button', { type: 'button', class: 'so' + (picked.includes(i) ? ' on' : ''), on: { click: () => pick(secIdx, idx, i) } }, h('i', {}, picked.includes(i) ? h('span', { html: ICON.check }) : 'ABCDEFGH'[i] || ''), o)));
        // 选项都短(≤ 4 个字)就横排成一行胶囊,不然三个一位数的答案各占一整行(2026-09-11 截图)
        const short = (p.options || []).length > 0 && (p.options || []).every((o) => Array.from(String(o)).length <= 4);
        return box('choice', h('div', { class: 'ch-q' }, p.question || ''), h('div', { class: 'ch-os' + (short ? ' short' : '') }, ...(p.options || []).map((o, i) => h('div', { class: 'ch-o' + (picked.includes(i) ? ' on' : '') }, h('i', {}, 'ABCDEFGH'[i] || ''), o))));
      }
      case 'lecture': {
        // 小课堂卡:老师放课里的一段;紧凑态是那一段末帧的画面、「0:19–0:30 ▷」;舞台是舞台包里的小课堂播放器
        const ready = lectureReady(c);
        return box('lecture', h('div', { class: 'sp' }, p.title || p.bundle || ''), p.text ? h('div', { class: 'tx' }, p.text) : null, h('div', { class: 'th' }, ready ? (p.video ? lcVideoStill(p.bundle, p.end) : lcStill(p.bundle, p.still || 0, null, 'lc-still')) : '课还没放进来', ready ? h('span', { class: 'pl' }, lcClock(p.start) + '–' + lcClock(p.end) + ' ▷') : null));
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
      case 'photo': {
        // 拍给我看(cards/photo/card.md):相机 + 要拍什么;下沿是答案栏:等你拍(拍照、相册)或拍来的照片。点卡不开舞台,点下沿的按钮拍
        const a = board ? ansFor(secIdx, idx) : null;
        const el = h('div', { class: 'c c-photo', 'data-card': idx, 'data-tint': tintFor(c), 'data-look': lookFor(c) },
          h('div', { class: 'pc-row' }, h('span', { class: 'pc-ic', html: ICON.camera }), h('div', { class: 'pc-t' }, p.text || '')), a ? ansEl(a) : null);
        if (a) el.dataset.ans = ansKey(a);
        return el;
      }
      case 'code':
        return box('code', p.lang ? h('span', { class: 'lg' }, p.lang) : null, h('div', { class: 'cb' }, p.text || ''));
      case 'tianzige': {
        // 轻卡,没有舞台:点字就写,不开舞台;讲到它时 setNow 写一遍
        const el = h('div', { class: 'c c-tianzige', 'data-card': idx, 'data-tint': tintFor(c), 'data-look': lookFor(c), 'data-ch': String(p.chars || '') });
        // 带拼音的:每个字一列,拼音在格子上方(像课本);老师写的是一字一个,对不上解析时就没要
        const chs = Array.from(String(p.chars || ''));
        const py = Array.isArray(p.pinyin) && p.pinyin.length === chs.length ? p.pinyin : null;
        for (const [i, ch] of chs.entries()) el.append(py ? h('div', { class: 'hzc' }, h('span', { class: 'py' }, String(py[i])), tianzigeBox(ch)) : tianzigeBox(ch));
        return el;
      }
      case 'dictation': {
        // 听写卡(只在首页,cards/dictation):点了去 /dictation 听写页;卡上没有字,只有几个词。n = 首页里第几张听写卡
        const all = (S.home && Array.isArray(S.home.cards) ? S.home.cards : []).filter((x) => x.kind === 'dictation');
        const en = p.lang === 'en';
        const href = '/dictation?home=' + encodeURIComponent((S.home && S.home.home) || '') + '&n=' + Math.max(0, all.indexOf(c)) + (en ? '&lang=en' : '');
        return h('a', { class: 'c c-dictation', 'data-card': idx, href }, h('span', { class: 'tg' }, h('i', {}), h('i', {})), h('span', { class: 'tx' }, h('b', {}, en ? '单词听写' : '听写'), h('span', {}, (p.count || 0) + (en ? ' 个单词' : ' 个词') + ' · 老师念,你来写')), h('span', { class: 'go' }, '去写'));
      }
      case 'word': {
        // 单词卡:四线三格里写这个词,卡上没有中文;点卡开舞台(慢念、分段慢写),「听」按正常速度念;讲到它时 setNow 写一遍
        if (stage) return wordStage(c, idx);
        const em = p.emoji || (c.look && c.look.emoji) || '';
        const el = box('word', em ? h('span', { class: 'we' }, em) : null, wordGrid(String(p.word || ''), null), h('div', { class: 'wd-row' }, soundPill(ICON.speaker, '听', (e) => wordSay(c, e.currentTarget, 1))));
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
  // ---- 单词卡的画法(wordGrid / wordWrite / wordMerge、wordLayout)在 word-draw.ts,两页共用 ----
__WORD_DRAW_JS__
  /** 念这个词:服务端配好的 1.mp3(老师的音色)按 rate 倍速放(音高不变),没好就等它到(cardClip);念完调 then(被打断不调) */
  const wordSay = (card, btn, rate, then) => {
    if (!cardSoundOk()) return;
    const token = ++voiceToken;
    for (const x of document.querySelectorAll('.c-word .wd-pl.on')) x.classList.remove('on');
    if (btn) btn.classList.add('on');
    const done = () => { if (btn) btn.classList.remove('on'); if (token === voiceToken && then) then(); };
    const miss = () => { if (token === voiceToken) done(); };
    cardClip(card, 0, token, (a) => {
      audioEl.onplaying = null;
      audioEl.onended = miss;
      audioEl.onerror = miss;
      audioEl.src = audioUrl(a);
      audioRate(rate);
      audioEl.play().catch(miss);
    }, done);
  };
  /** 舞台里的单词卡:emoji、分段两色的四线三格、「再听一遍」(慢);打开就走一遍:慢念与一段一段慢写同时开始 → 写完合拢 → 再慢念。点一段,那段慢写一遍 */
  let wordRun = 0;
  const wordStage = (card, idx) => {
    const p = card.props || {};
    const em = p.emoji || (card.look && card.look.emoji) || '';
    const chunks = Array.isArray(p.chunks) && p.chunks.join('') === p.word ? p.chunks : null;
    const grid = wordGrid(String(p.word || ''), chunks, { stage: true, fresh: !S.reel });
    // 再听只念、不打断写;点一段打断自动那一遍,写完那段照样合拢(不然字母一直分开摆着)
    const btn = soundPill(ICON.speaker, '再听一遍', (e) => wordSay(card, e.currentTarget, WORD_SLOW.rate));
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
      // 实时时卡的声音不自己响:只写,点「再听一遍」才念
      if (!LV.on) wordSay(card, btn, WORD_SLOW.rate);
      wordWrite(grid, true, null, () => {
        if (!live()) return;
        const again = () => { if (live() && !LV.on) wordSay(card, btn, WORD_SLOW.rate); };
        if (chunks) { wordMerge(grid, true); setTimeout(again, 600); } else setTimeout(again, 300);
      });
    }
    return el;
  };
  /** 点读:点哪段念哪段——服务端配好的段(card.assets 里有 <段号>.mp3)放 mp3,没好的等它到(cardClip) */
  const readSegment = (el, card, k) => {
    if (!cardSoundOk()) return;
    for (const x of document.querySelectorAll('.rd.on')) x.classList.remove('on');
    el.classList.add('on');
    const off = () => el.classList.remove('on');
    cardClip(card, k, ++voiceToken, (a) => playClip(audioUrl(a), el), off);
  };
  // ---- 卡上的声音钮(单词卡的「听」「再听一遍」)与放一段 ----
  const soundPill = (icon, label, onClick) => h('button', { type: 'button', class: 'wd-pl', html: icon, on: { click: (e) => { e.stopPropagation(); onClick(e); } } }, label);
  /** 放卡上的一段声音(点读段、单词);被别的声音打断不回调 */
  const playClip = (src, btn) => {
    if (!cardSoundOk()) return;
    const token = ++voiceToken;
    const off = () => { if (btn) btn.classList.remove('on'); };
    if (btn) btn.classList.add('on');
    if (!src) { off(); return; }
    audioEl.onplaying = null;
    audioEl.onended = () => { if (token === voiceToken) off(); };
    audioEl.onerror = () => { if (token === voiceToken) off(); };
    audioEl.src = src;
    audioRate(1);
    audioEl.play().catch(() => { if (token === voiceToken) off(); });
  };
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
  const headPhotos = (s) => (s.photos || []).map((p, k) => h('img', { class: 'ph', src: '/api/kid/image?p=' + encodeURIComponent(p), alt: '', loading: 'lazy', on: { click: (e) => { e.stopPropagation(); openLb(s.photos, k); } } }));
  const sectionHead = (s) => h('div', { class: 'sh' }, (s.at ? clock(s.at) + ' · ' : '') + sectionTitle(s), ...headPhotos(s));
  const rowEl = (n, ...kids) => h('div', { class: 'row', style: 'grid-template-columns:repeat(' + n + ',minmax(0,1fr))' }, ...kids);
  // ---- 排版:每张卡放进量具量一次,半宽放得下(fitsHalf)就半宽,相邻两张半宽的并一行(rowsFor) ----
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
  // ---- 小课堂:首页按钮 → 舞台包铺满整页放(#lc-frame);看完 → 板书顶上一张小课堂卡 + 「看完了!有什么想问老师的?」,输入条亮;
  //      孩子第一句带上看的情况(body.lecture),那条的节前画小课堂卡;「再看一遍」再铺开,关了回板书 ----
  //      画:播放器里停住了能画,停在同一刻画的几笔算一处,整张单子发回来(S.lecture.marks,页面是画的主人,带着截图);
  //      看完那排画的卡能删,孩子开口时一起带上;问过以后「再看一遍」又画了,下一条带上(again)。画的卡的缩略图是截图 ----
  const lcFrame = $('#lc-frame');
  const lcPost = (m) => { try { lcFrame.contentWindow.postMessage({ source: STAGE_SOURCE, ...m }, '*'); } catch {} };
  /** 小课堂在哪:课包 /api/bundles/<id>/;视频 /api/kid/lectures/<id>/(lecture.json + video.mp4) */
  const lcBundleUrl = (bundle, video) => (video ? '/api/kid/lectures/' : '/api/bundles/') + encodeURIComponent(bundle) + '/';
  let lcShowing = null;
  /** 正在放的就是孩子手上这一课(画记到 S.lecture) */
  const lcMine = () => Boolean(S.lecture && lcShowing && lcShowing.bundle === S.lecture.bundle && !S.readonly);
  const openLecture = (l) => {
    const L = l || S.lecture; if (!L) return;
    // 问过以后(刷新过、或从别处回来,手上没有 S.lecture)从节前的小课堂卡再看一遍:这个话题接着收画的,下一条带上
    if (l && !S.readonly && !S.newThread && (!S.lecture || S.lecture.bundle !== l.bundle)) {
      const own = S.sections.find((x) => x.lecture && !x.lecture.again && x.lecture.bundle === l.bundle);
      if (own) S.lecture = { bundle: l.bundle, title: l.title, ...(own.lecture.video ? { video: true } : {}), watch: { watchedMs: 0, finished: true, pauses: 0 }, sent: true, firstJob: own.job, job: own.job, marks: [], flying: [], log: [] };
    }
    lcShowing = L; dispatch({ type: 'halt' });
    lcFrame.hidden = false; lcFrame.src = stageUrl('lecture');
  };
  const hideLecture = () => { lcShowing = null; lcFrame.hidden = true; lcFrame.src = 'about:blank'; };
  /** 「分:秒」(同 src/lib/lecture.ts 的 clockLabel) */
  const lcClock = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = String(t % 60).padStart(2, '0'); return hh ? hh + ':' + String(mm).padStart(2, '0') + ':' + ss : mm + ':' + ss; };
  /** 课包那一刻的画面(没截图的画的卡、小课堂卡的缩略图):服务端用烤好的画面现画(frame.svg,SVG 时刻 + 几笔;没烤过的服务端先烤),一张 <img>。
   *  几笔写进地址(笔间「~」),缩略图用不着那么细:一共抽到 400 个点以内,地址不会太长 */
  const lcStill = (bundle, svgMs, strokes, cls) => {
    const box = h('div', { class: cls });
    const all = (strokes || []).filter((st) => st && st.length >= 2), n = all.reduce((a, st) => a + st.length, 0), step = Math.max(1, Math.ceil(n / 400));
    const ring = all.length ? '&ring=' + all.map((st) => st.filter((_, i) => i % step === 0 || i === st.length - 1).map((p) => Math.round(p[0]) + ',' + Math.round(p[1])).join(';')).join('~') : '';
    const img = h('img', { class: 'mk-svg', alt: '', src: lcBundleUrl(bundle) + 'frame.svg?svg=' + (svgMs === 'end' ? 'end' : Math.round((svgMs || 0) * 10) / 10) + ring });
    box.append(img);
    return box;
  };
  /** 画的卡的缩略图:截下来的那张(还没发的是 data URL,发了是 captures/ 路径);没截图的课包现画 */
  /** 视频那一段末尾的一帧(小课堂卡的缩略图):<video> 停在 end 前一点,不出声 */
  const lcVideoStill = (bundle, end) => {
    const v = h('video', { class: 'lc-still', src: lcBundleUrl(bundle, true) + 'video.mp4#t=' + Math.max(0, (end - 200) / 1000).toFixed(2), playsinline: '', preload: 'metadata' });
    v.muted = true;
    return v;
  };
  const markThumb = (l, mk) => mk.image ? h('div', { class: 'mk-th' }, h('img', { class: 'mk-svg', alt: '', src: mk.image.startsWith('data:') ? mk.image : '/api/kid/image?p=' + encodeURIComponent(mk.image) })) : lcStill(l.bundle, mk.svgMs, mk.strokes, 'mk-th');
  /** 一张画的卡:缩略图 + 「你画的」+ 时刻;点了从那一刻停着打开小课堂;del = 看完还没交出去的能删 */
  const markCard = (l, mk, del) => h('div', { class: 'c c-mark', 'data-at': String(mk.atMs) },
    h('div', { class: 'mk-main', on: { click: (e) => { e.stopPropagation(); openLecture({ bundle: l.bundle, title: l.title, at: mk.atMs, ...(l.video ? { video: true } : {}) }); } } }, markThumb(l, mk), h('div', { class: 'mk-t' }, h('small', {}, '你画的'), h('b', {}, lcClock(mk.atMs)))),
    del ? h('button', { type: 'button', class: 'x', 'aria-label': '删掉这一处', on: { click: (e) => { e.stopPropagation(); del(); } } }, '×') : null);
  const markRow = (l, marks, del) => h('div', { class: 'mk-row' }, ...marks.map((k) => markCard(l, k, del ? () => del(k) : null)));
  /** 板书顶上的小课堂卡:最后一帧的缩略图、课名、看完了、画了几处、「再看一遍」(done = 孩子已经问过,卡画在那一节前面);缩略图点了也是再看一遍 */
  const lectureCard = (l, done) => {
    const n = (l.marks || []).length;
    const again = (e) => { e.stopPropagation(); openLecture({ bundle: l.bundle, title: l.title, ...(l.video ? { video: true } : {}) }); };
    // 课包画最后一帧(frame.svg?svg=end);视频停在看到的最后一刻,不知道就不画
    const still = l.video ? (l.endMs ? lcVideoStill(l.bundle, l.endMs) : null) : lcStill(l.bundle, 'end', null, 'th');
    return h('div', { class: 'c c-lc', 'data-lecture': l.bundle },
      still ? h('button', { type: 'button', class: 'lc-th', 'aria-label': '再看一遍', on: { click: again } }, still) : null,
      h('div', { class: 'lt' }, h('small', {}, '小课堂'), h('b', {}, l.title || ''), h('span', {}, '看完了' + (n ? ' · 画了 ' + n + ' 处' : done ? '' : ' · 有不懂的就问老师'))),
      h('button', { type: 'button', class: 're', on: { click: again } }, '再看一遍'));
  };
  /** 一节前面的小课堂:第一问那节是小课堂卡 + 画的卡;再看一遍又画的那节只有画的卡 */
  const lectureHead = (s) => !s.lecture ? [] : [s.lecture.again ? null : lectureCard(s.lecture, true), s.lecture.marks && s.lecture.marks.length ? markRow(s.lecture, s.lecture.marks, null) : null];
  /**
   * 板书上还没落进哪一节的小课堂(S.lecture):看完、还没开口 → 顶上小课堂卡 + 一排画的卡(能删)+「看完了!有什么想问老师的?」;
   * 问了、那一节还没回来 → 卡与发出去的画留着(不能删了),提示撤掉;那一节回来了(节前画着)→ 撤掉。
   * 问过以后再看一遍又画了 → 板书末尾一排画的卡(能删)+ 一句「下次说话会一起带给老师」
   */
  const renderLecturePending = () => {
    const old = $('#board .lc-pending');
    const L = S.lecture;
    const waiting = Boolean(L && L.job && !$('#board .sec[data-job="' + L.job + '"]'));
    const showCard = Boolean(L && L.watch && (!L.sent || (waiting && L.job === L.firstJob)));
    const flying = L && waiting ? (L.flying || []) : [];
    const marks = L && L.watch ? (L.marks || []) : [];
    if (!L || (!showCard && !flying.length && !marks.length)) { if (old) old.remove(); return; }
    const key = JSON.stringify([showCard, L.sent, flying.map((k) => k.atMs), marks.map((k) => k.atMs + ':' + k.strokes.length + (k.image ? ':i' : ''))]);
    if (old && old.getAttribute('data-key') === key) return;
    const del = (k) => { L.marks = L.marks.filter((x) => x !== k); renderLecturePending(); };
    const ask = !L.sent ? h('div', { class: 'lc-ask' }, h('b', {}, '看完了!有什么想问老师的?'), h('span', {}, marks.length ? '画的 ' + marks.length + ' 处,问的时候会一起带给老师;不想带的点 × 去掉' : '按住说话,或者打字'))
      : marks.length ? h('div', { class: 'lc-ask sm' }, h('span', {}, '又画了 ' + marks.length + ' 处,下次说话会一起带给老师;不想带的点 × 去掉')) : null;
    const el = h('div', { class: 'lc-pending', 'data-key': key }, showCard ? lectureCard({ bundle: L.bundle, title: L.title, video: L.video, endMs: L.watch && L.watch.watchedMs, marks: L.sent ? flying : marks }, false) : null,
      flying.length || marks.length ? h('div', { class: 'mk-row' }, ...flying.map((k) => markCard(L, k, null)), ...marks.map((k) => markCard(L, k, () => del(k)))) : null, ask);
    if (old) old.remove();
    if (showCard) $('#board').prepend(el); else $('#board').append(el);
  };
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.source !== STAGE_SOURCE || e.source !== lcFrame.contentWindow || !lcShowing) return;
    if (m.type === 'ready') {
      lcPost({ type: 'card', id: 'lecture', kind: 'lecture', props: { title: lcShowing.title, back: S.tutor ? { color: colorOf(S.tutor), initial: tutorInitial(S.tutor) } : null, marks: lcMine() ? S.lecture.marks : [], ...(lcShowing.at !== undefined ? { at: lcShowing.at } : {}), ...(lcMine() ? {} : { view: true }), ...(lcShowing.video ? { video: true } : {}), ...(lcShowing.follow ? { follow: true } : {}) }, state: null, bundleUrl: lcBundleUrl(lcShowing.bundle, lcShowing.video) });
      // 录像(follow):播放器这时才在听,录像停着不会再发,把最近那条 follow 再发一次(之前那条它没收到;2026-10-19 停着点「圈了一处」(现在叫「画了一处」)一直停在 0:00)
      if (lcShowing.follow && lcShowing.followMsg) lcPost(lcShowing.followMsg);
    }
    else if (m.type === 'marks') { if (lcMine()) S.lecture.marks = m.marks; }
    // 看的过程(录像用):孩子开口时一起带上(没开口之前哪里都不记)
    else if (m.type === 'watch') { if (lcMine() && S.lecture.log.length < 500) S.lecture.log.push({ at: m.at, pos: m.pos, play: m.play }); }
    else if (m.type === 'lecture') {
      const first = lcMine() && !S.lecture.watch;
      if (m.event === 'finished' && first) S.lecture.watch = { watchedMs: m.watchedMs, finished: true, pauses: m.pauses };
      else if (lcMine()) S.lecture.rewatch = { watchedMs: m.watchedMs, finished: m.finished, pauses: m.pauses };
      // 第一遍没看完就回去 = 回首页(这一课不记);看完了点「去问老师」或回去、「再看一遍」关掉 = 回板书。
      // 放完(finished)只记下来,停在最后一帧,孩子点了才回板书
      if (m.event === 'close' && first) { closeTutor(); return; }
      if (m.event === 'finished') return;
      hideLecture(); renderLecturePending(); renderBar(); renderSubtitle();
    } else if (m.type === 'error') { const first = S.lecture && !S.lecture.watch; hideLecture(); if (first) closeTutor(); }
  });
  // ---- 一个话题一节:孩子端节头只留板上第一节、带照片的节与孩子单独说了话的节(他的话就是节头);孩子的话答问题卡的进卡的答案栏 ----
  const headOf = (s, i) => (i === 0 || (s.photos && s.photos.length) ? sectionHead(s) : null);
  const saidBody = (sd, on = {}) => [
    // 答拍给我看卡拍来的照片(kidSaid 的 photos):缩在答案栏里,点开看大图;只发了照片没说话就没有字
    ...(sd.photos || []).map((p, k) => h('img', { class: 'kp', src: '/api/kid/image?p=' + encodeURIComponent(p), alt: '', loading: 'lazy', on: { click: (e) => { e.stopPropagation(); openLb(sd.photos, k); } } })),
    sd.text ? h('span', { class: 'ka-t', on }, sd.text) : null];
  /** 点开看原话(语音的显示是去了口头禅的),再点收起 */
  const toggleSaid = (sd) => (e) => { e.stopPropagation(); const el = e.currentTarget.closest('.kid-ans, .sh'); const t = el.querySelector('.ka-t'); if (!t) return; const open = el.classList.toggle('open'); t.textContent = open ? sd.full : sd.text; };
  /** 孩子单独说的那句当节头:话 —— 线 —— [时间] [照片] 再听;meta = false 只要话和线(刚发出去挂在板尾的、小课堂卡下面的) */
  const saidHead = (s, sd, meta, first) => h('div', { class: 'sh said' }, ...saidBody(sd, { click: toggleSaid(sd) }), h('span', { class: 'ln' }), ...(meta ? [first && s.at ? clock(s.at) : null, ...headPhotos(s)] : []));
  /** 一节开头:孩子没单独说话 → 原来的节头(只留第一节与带照片的);说了 → 他的话就是节头;看完小课堂后的第一问写在小课堂卡下面 */
  /** 孩子从纸上交的画:节前一张——图(点开看大图)、几笔、「接着画」打开这个话题的纸(只读、家长端、录像里不出) */
  const drawHead = (s) => !s.drawing ? null : h('div', { class: 'c c-draw' },
    h('img', { class: 'dw-th', src: '/api/kid/image?p=' + encodeURIComponent(s.drawing.image), alt: '', loading: 'lazy', on: { click: (e) => { e.stopPropagation(); openLb([s.drawing.image], 0); } } }),
    h('div', { class: 'dw-t' }, h('small', {}, '我画的'), h('b', {}, '画了 ' + s.drawing.strokes + ' 笔')),
    !S.readonly && !REEL ? h('button', { class: 'dw-go', type: 'button', on: { click: (e) => { e.stopPropagation(); openPaper(); } } }, '接着画') : null);
  const headEls = (s, i) => [...headEls0(s, i), drawHead(s)];
  const headEls0 = (s, i) => {
    // 实时:节头是脑写的那张卡(liveHeadEl,随卡画);板上第一节没写节头,只挂时间。孩子的话不当节头(在左栏 #lv-kid)
    if (s.live) return [i === 0 && !s.head && s.at ? h('div', { class: 'sh lh' }, h('span', { class: 'ln' }), h('span', { class: 'tm' }, clock(s.at))) : null, ...lectureHead(s)];
    const sd = s.said && !s.saidOn ? s.said : null;
    const lec = lectureHead(s);
    if (!sd) return [headOf(s, i), ...lec];
    if (!lec.some(Boolean)) return [saidHead(s, sd, true, i === 0)];
    return [headOf(s, i), ...lec, saidHead(s, sd, false)];
  };
  /** 实时的一节:节头脑写、孩子的话不进答案栏、卡和讲稿不同步 */
  const liveSec = (i) => Boolean(i !== null && S.sections[i] && S.sections[i].live);
  /** 脑写的节头(只有一行「# 标题」的文字卡):一行摘要 —— 线 —— 板上第一节带时间;一轮中间的也照这样断成新一节 */
  const liveHeadEl = (title, i, k) => { const s = S.sections[i]; return h('div', { class: 'sh lh', 'data-card': k }, h('span', { class: 't' }, title), h('span', { class: 'ln' }), i === 0 && k === 0 && s && s.at ? h('span', { class: 'tm' }, clock(s.at)) : null); };
  /** 实时的卡落下:讲稿里标这张卡的 [词] 都画上(不等念到),田字格、单词卡写一遍(这一页只写一次);animate = false 是重画、回来看,只画不写 */
  const liveLand = (i, k, animate) => {
    const s = S.sections[i]; if (!s || !s.live) return;
    for (const l of s.lines) for (const m of l.marks) if (m.card === k) applyMark(i, m, animate);
    const el = animate ? $('#board').querySelector('[data-sec="' + i + '"] [data-card="' + k + '"]') : null;
    if (el && (el.classList.contains('c-tianzige') || el.classList.contains('c-word')) && !el.dataset.wrote) { el.dataset.wrote = '1'; if (el.classList.contains('c-word')) wordWrite(el.querySelector('.wg'), false, null); else tianzigePlay(el); }
  };
  /** 第 j 节第 k 张卡的答案栏:孩子答了就是他的话;最后一节的问题卡还没人答、老师在等,写「等你说…」(body.waiting 时才露) */
  const ansFor = (j, k) => {
    const sec = S.sections[j];
    if (!sec || sec.live) return null;
    for (const s of S.sections) if (s.said && s.saidOn && s.saidOn.job === sec.job && s.saidOn.card === k) return s.said;
    if (S.pendSaid && S.pendSaid.on && S.pendSaid.on.job === sec.job && S.pendSaid.on.card === k) return S.pendSaid.said;
    if ((!S.readonly || REEL) && !S.pendSaid && j === S.sections.length - 1 && askCard(sec) === k) return sec.cards[k].kind === 'photo' ? { wait: true, snap: true } : { wait: true };
    return null;
  };
  /** 答案栏画的是什么(data-ans):变了才重画那张卡 */
  const ansKey = (a) => (a.snap ? 'snap' : a.wait ? 'wait' : (a.text || '') + '|' + (a.photos || []).join(','));
  /** 拍给我看卡上的拍照 / 相册:一个藏起来的 file input,和输入条的相机同一套(wireFile) */
  const snapBtn = (camera) => {
    const f = h('input', camera ? { type: 'file', accept: 'image/*', capture: 'environment' } : { type: 'file', accept: 'image/*', multiple: '' });
    wireFile(f);
    return h('label', { class: 'pc-go' + (camera ? '' : ' alt'), on: { click: (e) => e.stopPropagation() } }, h('span', { html: camera ? ICON.camera : ICON.album }), camera ? '拍照' : '相册', f);
  };
  const ansEl = (a) => (a.snap ? h('div', { class: 'kid-ans snap' }, h('span', { class: 'ka-w' }, '等你拍…'), snapBtn(true), snapBtn(false))
    : a.wait ? h('div', { class: 'kid-ans wait' }, '等你说…') : h('button', { type: 'button', class: 'kid-ans', on: { click: toggleSaid(a) } }, ...saidBody(a)));
  /** 拿起相机老师就停(同点卡开舞台);拍完 / 选完进发照片屏。相册最多 4 张,多的只取前 4 张。输入条、加号面板、拍给我看卡都走这里 */
  const wireFile = (f) => {
    f.addEventListener('change', () => { $('#sheet').classList.remove('on'); const files = Array.from(f.files || []).slice(0, f.multiple ? PHOTO_ALBUM_MAX : 1); f.value = ''; psOpen(files); });
  };
  /** 答案栏跟着数据走:哪张卡该有的和画着的(data-ans)不一样就重画那张卡 */
  const syncAnswers = () => {
    const want = new Set();
    const at = (job, k) => { const j = S.sections.findIndex((s) => s.job === job); if (j >= 0) want.add(j + ':' + k); };
    for (const s of S.sections) if (s.said && s.saidOn) at(s.saidOn.job, s.saidOn.card);
    if (S.pendSaid && S.pendSaid.on) at(S.pendSaid.on.job, S.pendSaid.on.card);
    const li = S.sections.length - 1;
    if (li >= 0) { const lk = askCard(S.sections[li]); if (lk !== null) want.add(li + ':' + lk); }
    for (const el of document.querySelectorAll('#board .c[data-ans]')) { const sec = el.closest('.sec'); if (sec) want.add(sec.dataset.sec + ':' + el.dataset.card); }
    for (const key of want) {
      const [j, k] = key.split(':').map(Number);
      const el = $('#board').querySelector('[data-sec="' + j + '"] .c[data-card="' + k + '"]');
      if (!el) continue;
      const a = ansFor(j, k);
      if ((el.dataset.ans || '') !== (a ? ansKey(a) : '')) repaintCard(j, k);
    }
  };
  /** 刚发出去、老师还没写出这一节:不答卡的那句先挂在板尾(占位卡前) */
  const syncPendSay = () => {
    const old = $('#board > .sh.said.pend');
    const p = S.pendSaid && !S.pendSaid.on && !S.pendSaid.live && !LV.on ? S.pendSaid : null;
    if (old && (!p || old.dataset.said !== p.job)) old.remove();
    if (!p || (old && old.dataset.said === p.job)) return;
    const el = saidHead(null, p.said, false); el.classList.add('pend'); el.dataset.said = p.job;
    const g = $('#board > .wait-card');
    if (g) g.before(el); else $('#board').append(el);
  };
  const renderSection = (s, i) => h('div', { class: 'sec' + (s.live && s.cont ? ' cont' : ''), 'data-sec': i, 'data-job': s.job }, ...headEls(s, i), ...rowEls(s, s.cards.map((c, k) => renderCard(c, k, i, false))).map((r) => r.el));
  /**
   * 老师还在说(2026-09-13,一拍一就绪):第一拍就绪前板上只有占位卡(字幕行「我写给你看」,见 renderSubtitle);就绪了就把这条转成 S.sections 里的一节(live)开播,
   * 之后每次 poll 只铺新就绪的拍的卡(一行一张,没有排版)、把 lines 换成最新的(配音名填进来),播到头等着(thinking)的就接上。
   * 铺卡在拍就绪时而不是围栏闭合时:铺的时候声音已齐,不会先素后彩地闪
   */
  const liveCardsOf = (e) => { if (e.live) return e.cards.length; const bs = beatsOf(e).slice(0, e.ready || 0); let n = 0; for (const b of bs) if (b.card !== null) n = Math.max(n, b.card + 1); return n; };
  /** 一张卡落到行里:和前面的卡并一行(半宽 + 半宽,或明写的并排)就进那一行,否则新起一行;只看这张和前面的,后面的卡不影响前面的行 */
  // ---- 跟到底:新露出来的卡在板的最后 → 板滚到底(连底下留的空一起露);之后这一节再长高(问题卡的「等你说…」、图片载完、排版量完),
  //      只要孩子没自己往上翻,就再滚到底。原来是 scrollIntoView nearest:只把卡的下沿贴到可视区下沿,之后长高的那截就在屏幕外
  //      (2026-10-08 真机:新卡要手动往上滑才看全;mock 量出来每轮停下等答时最后一张卡被截 45px,其余 4–7px) ----
  const pin = { on: false, touched: 0 };
  /** 老师页左上的头像跟着谁在说走(.av 的样式):孩子按住说话 = 听;刚念完停下等孩子 = 点一下头(body.nod 一秒后摘掉,下回再加才会再点) */
  const avListen = () => document.body.classList.toggle('listening', S.bar === 'holding' || (LV.on && LV.model.open && LV.model.hearing));
  let avWas = 'idle', nodTimer = 0;
  const avNod = () => { const b = document.body; b.classList.remove('nod'); void b.offsetWidth; b.classList.add('nod'); clearTimeout(nodTimer); nodTimer = setTimeout(() => b.classList.remove('nod'), 1000); };
  /** 实时:老师说完这一轮点一下头——按钮里那颗、手机那颗(动作在 voice-ui.ts) */
  const liveNod = () => { VB.btn.nod(); const a = $('#lv-av'); a.classList.remove('vb-nod'); void a.offsetWidth; a.classList.add('vb-nod'); setTimeout(() => a.classList.remove('vb-nod'), 950); };
  /** 让孩子看到 el:它是板上最后看得见的东西就滚到底并跟着(pin);不是(念到上面另一张卡)就照旧 nearest,不跟;比可视区还高的露上沿 */
  const follow = (el) => {
    const b = $('#board'); if (!el || !b.contains(el)) return;
    const er = el.getBoundingClientRect();
    const padB = parseFloat(getComputedStyle(b).paddingBottom) || 0;
    // 板上最后看得见的东西的下沿(不用 scrollHeight:内容还没板高时它就是板高,短板上的卡永远「不是最后」,之后上面的卡长高把它挤出去也不跟)
    let tail = b.lastElementChild; while (tail && !tail.getClientRects().length) tail = tail.previousElementSibling;
    const gap = tail ? tail.getBoundingClientRect().bottom - er.bottom : 0;
    if (er.height > b.clientHeight - padB) { pin.on = false; el.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (gap > 32) {
      // 已经整张看得见就不动:再滚一次 nearest 会打断正在往底下滚的那一下(新卡刚铺、这句又念到上面那张时,新卡停在半截)
      const br = b.getBoundingClientRect();
      if (er.top >= br.top && er.bottom <= br.bottom) return;
      pin.on = false; el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return;
    }
    pin.on = true;
    b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' });
  };
  {
    const b = $('#board');
    // 孩子自己翻了就不跟(点一下不算:只有拖动、滚轮)
    for (const ev of ['touchmove', 'wheel']) b.addEventListener(ev, () => { pin.on = false; pin.touched = Date.now(); }, { passive: true });
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => { if (pin.on && b.scrollHeight - b.scrollTop - b.clientHeight > 1) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); });
      new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) ro.observe(n); }).observe(b, { childList: true });
    }
  }
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
    if (!S.partial || S.partial.job !== e.job) { if (S.partial) S.partial.el.remove(); const idx = S.sections.length; S.partial = { job: e.job, idx, live: false, shown: 0, el: h('div', { class: 'sec', 'data-sec': idx, 'data-job': e.job }, ...headEls(e, idx)) }; $('#board').append(S.partial.el); }
    const P = S.partial, idx = P.idx;
    P.el.classList.toggle('cont', Boolean(e.live && e.cont));
    // 不是实时的一轮:一拍就绪才铺;实时的一轮:卡闭合了就铺、有句就出节(讲稿嘴在念,不等拍)
    if (!(e.ready > 0) && !(e.live && (e.cards.length || e.lines.length))) return;
    const sec = { ...e, partial: true };
    const wasLive = P.live;
    if (!wasLive) { P.live = true; S.played.add(e.job); S.sections.push(sec); }
    else S.sections[idx] = sec;
    const n = liveCardsOf(sec);
    if (n > P.shown) { const g = $('#board > .wait-card'); if (g) g.remove(); }
    const placed = n > P.shown;
    for (; P.shown < n; P.shown++) { follow(placeCard(P, sec, P.shown, idx)); liveLand(idx, P.shown, true); }
    dispatch({ type: wasLive ? 'liveBeat' : 'liveStart', section: idx });
    if (LV.on && placed) liveDispatch({ type: 'cards' });
  };
  /** 老师写完了:live 的那节换成正式的(带标注 / 样子),不重播——没铺的卡补上,铺过的换样子并把标注补画 */
  const finalizeLive = (e) => {
    const P = S.partial; S.partial = null;
    const idx = P.idx;
    const sec = { ...e };
    S.sections[idx] = sec;
    const el = P.el;
    el.classList.toggle('cont', Boolean(sec.live && sec.cont));
    for (let k = 0; k < sec.cards.length; k++) {
      const old = k < P.shown ? el.querySelector('[data-card="' + k + '"]') : null;
      if (old) swapCard(old, renderCard(sec.cards[k], k, idx, false));
      else placeCard(P, sec, k, idx);
      // 实时:换了样子的卡标注补画,新铺的照落下画、写
      liveLand(idx, k, !old);
    }
    dispatch({ type: 'liveFinal', section: idx });
    if (LV.on) liveDispatch({ type: 'cards' });
  };
  /** 一张卡的状态变了:紧凑态原地重画(标注会掉,重画这张卡的;选中态照旧) */
  const repaintCard = (secIdx, idx) => {
    const sec = $('#board').querySelector('[data-sec="' + secIdx + '"]');
    const old = sec && sec.querySelector('[data-card="' + idx + '"]');
    if (!old) return;
    swapCard(old, renderCard(S.sections[secIdx].cards[idx], idx, secIdx, false));
    for (const l of S.sections[secIdx].lines) for (const m of l.marks) if (m.card === idx) applyMark(secIdx, m, false);
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
  /** 选中态:一节里同一时刻只有一张(舞台开着时是舞台那张;停下等答停在末句的卡) */
  const setNow = (secIdx, idx) => {
    for (const x of document.querySelectorAll('#board .c.now')) x.classList.remove('now');
    if (secIdx === null || idx === null) return;
    const el = $('#board').querySelector('[data-sec="' + secIdx + '"] [data-card="' + idx + '"]');
    if (!el) return;
    el.classList.add('now');
  };
  const showNow = () => setNow(S.state.section, nowCard(S.sections, S.state));
  /** 换端(转屏)或窗口变了:端或半宽变了就整节重排(卡重新量),标注画齐,选中态照旧 */
  const relayout = () => {
    const d = debug.get('device') || deviceFor(innerWidth, innerHeight);
    // 录像:孩子的屏幕转屏 / 换端整块重画;家长页这头只是 iframe 换个缩放(reelDock 自己跟着窗口)
    if (S.reel) { if (REEL) { S.device = d; S.reel.key = ''; reelTick(); } return; }
    const hw = halfWidth();
    if (d !== S.device || hw !== S.layHalf) {
      S.device = d; S.layHalf = hw;
      S.sections.forEach((s, i) => { const old = $('#board').querySelector('[data-sec="' + i + '"]'); if (old && !(S.partial && S.partial.el === old)) { old.replaceWith(renderSection(s, i)); paintAll(i); } });
      if (S.stage) setNow(S.stage.section, S.stage.card); else if (!LV.on) showNow();
    } else for (const span of document.querySelectorAll('#board .mk[data-pen]')) { const card = span.closest('.c'); if (card && LINE_PENS.includes(span.dataset.pen)) drawPen(span, card, span.dataset.pen, false); }
  };
  let relayoutTimer = null;
  window.addEventListener('resize', () => { clearTimeout(relayoutTimer); relayoutTimer = setTimeout(relayout, 150); });
  S.device = debug.get('device') || deviceFor(innerWidth, innerHeight);
  S.layHalf = halfWidth();

  // ---- 舞台:点卡放大,交互都在这里;开着时讲稿暂停,关了字幕行出「播放」 ----
  const KIND_NAME = { text: '', read: '点读', choice: '选一选', image: '看图', tianzige: '田字格', dictation: '听写', word: '单词', lecture: '小课堂', canvas: '画一画', code: '' };
  const GO_LABEL = { canvas: '给老师看' };
  // ---- 画板:画板卡与左栏的纸都铺满;纸一个话题一张、一直能改;边画边聊:画板开着时按头像说的给嘴(看得见画),
  //      「给老师看」轻点只交画、按住说 = 画和这句话一起给脑;嘴什么时候主动说一句照 canvas-chat.ts 的规矩(已内联),孩子端定、服务端再看一眼安不安静 ----
  const CV = { chat: null, strokes: [], timer: 0, snapWait: null, snapP: null, capT: 0, give: null, asking: null };
  /** 舞台上那张卡:板上的卡,或者左栏的纸(纸不在板上,S.paper.card 是一张只在这里的画板卡) */
  const stageCardNow = () => (!S.stage ? null : S.stage.paper ? (S.paper ? S.paper.card : null) : S.sections[S.stage.section] ? S.sections[S.stage.section].cards[S.stage.card] : null);
  /** 画板开着、还能画(画板卡没交,或者纸);只读、家长端、录像里不算 */
  const canvasNow = () => { const c = stageCardNow(); return c && c.kind === 'canvas' && !c.submitted && !S.readonly && !REEL ? c : null; };
  /** 舞台存回来的只有笔迹;清空前存的那几版(cleared)在页面这份状态里,并上 */
  const withCleared = (prev, next) => (prev && Array.isArray(prev.cleared) && prev.cleared.length ? { ...next, cleared: prev.cleared } : next);
  /** 纸的名字:这个话题;话题还没有(新话题、空板)叫 new,第一条发出去服务端改名 */
  const paperKey = () => (S.newThread || !S.thread ? 'new' : S.thread);
  const paperOk = () => LV.on && !S.readonly && !REEL && !PREVIEW && Boolean(S.tutor);
  const savePaper = () => (S.paper && S.tutor && S.paper.tutor === S.tutor.name ? api('PUT', CONV + S.tutor.name + '/paper', { key: S.paper.key, state: S.paper.card.state }).catch(() => {}) : Promise.resolve());
  /** 左栏「画板」、加号单子里的「画板」、板上画卡的「接着画」:打开这个话题的那张纸(关了不丢,状态在服务端) */
  const openPaper = () => {
    if (!paperOk() || S.stage) return;
    const key = paperKey();
    const show = (st) => {
      if (S.stage || !paperOk()) return;
      S.paper = { tutor: S.tutor.name, key, card: { kind: 'canvas', props: { base: null }, state: st && Array.isArray(st.ink) ? st : { ink: [] } } };
      S.stage = { paper: true, section: null, card: null, id: 'paper', playing: null, delegate: false, autoplay: false };
      $('#st-ttl').textContent = '画板'; $('#st-ttl').classList.remove('open');
      $('#st-kd').hidden = true;
      $('#stage').classList.add('cv');
      renderStage();
      $('#stage').classList.add('on');
      canvasOpened();
    };
    api('GET', CONV + S.tutor.name + '/paper?key=' + encodeURIComponent(key)).then((r) => show(r && r.state), () => show(null));
  };
  /** 画板开了:边画边聊从这一刻算(点开 20 秒内不说) */
  const canvasOpened = () => {
    const c = stageCardNow();
    CV.chat = canvasChatInit(Date.now());
    CV.strokes = c && c.state && Array.isArray(c.state.ink) ? canvasStrokes(c.state.ink) : [];
    clearInterval(CV.timer); CV.timer = 0;
    if (LV.on && canvasNow()) CV.timer = setInterval(canvasTick, 1000);
  };
  const canvasClosed = () => {
    clearInterval(CV.timer); CV.timer = 0; CV.chat = null; CV.strokes = [];
    if (CV.asking) { clearTimeout(CV.asking.timer); CV.asking = null; }
    if (CV.snapWait) { const w = CV.snapWait; CV.snapWait = null; w(null); }
    if (CV.give) { const g = CV.give; CV.give = null; g(null); }
    clearTimeout(CV.capT); CV.capT = 0; $('#cv-cap').classList.remove('on');
    $('#stage').classList.remove('cv'); $('#st-go').classList.remove('holding');
  };
  /** 这一刻的画(长边 768 的 jpeg data URL):问舞台要,1.5 秒没回就算没有 */
  const canvasSnap = () => new Promise((resolve) => {
    if (!canvasNow()) { resolve(null); return; }
    if (CV.snapWait) { const w = CV.snapWait; CV.snapWait = null; w(null); }
    let t = 0;
    const done = (img) => { clearTimeout(t); resolve(img || null); };
    t = setTimeout(() => { if (CV.snapWait === done) CV.snapWait = null; resolve(null); }, 1500);
    CV.snapWait = done;
    postStage({ type: 'control', action: 'snap' });
  });
  /** 给嘴的题(cue.ts 的 ChatAsk):题目、说哪个颜色、问不问、画了多久、各颜色几笔在哪、清空过几次 */
  const canvasAsk = (due) => {
    const c = canvasNow();
    const sum = canvasSummary(CV.strokes);
    const cleared = c && c.state && Array.isArray(c.state.cleared) ? c.state.cleared : [];
    const starts = cleared.map((x) => x.from || x.at).concat(sum.firstAt ? [sum.firstAt] : []).filter((x) => x > 0);
    const ms = starts.length && sum.lastAt ? sum.lastAt - Math.min(...starts) : 0;
    return { ...(c && c.props && c.props.prompt ? { prompt: c.props.prompt } : {}), ...(due ? { color: due.color, ask: due.ask } : {}), minutes: canvasMinutesText(ms), colors: sum.colors, cleared: cleared.length };
  };
  /**
   * 每秒看一眼该不该主动说一句(canvasChatDue);该说就要一张图交给嘴。这一句先挂着(CV.asking),服务端回 {t:'chat', said} 才记成说过,
   * 回 skipped(不安静)或 6 秒没回就作废——不然没说出去的也占了一句、算成没回
   */
  const canvasTick = () => {
    if (!canvasNow() || !CV.chat || !LV.on || !LV.ready || LV.model.open) return;
    const busy = LV.model.status !== 'quiet' || S.pending || Boolean(press) || LV.letGo || Boolean(CV.snapWait) || Boolean(CV.give) || Boolean(CV.asking);
    const now = Date.now();
    const due = canvasChatDue(CV.chat, now, CV.strokes, busy);
    if (!due.say) return;
    const id = S.stage.id;
    const asking = { id, due, at: now, strokes: CV.strokes.slice(), timer: 0 };
    CV.asking = asking;
    asking.timer = setTimeout(() => { if (CV.asking === asking) CV.asking = null; }, 6000);
    canvasSnap().then((img) => {
      if (CV.asking !== asking) return;
      if (img && canvasNow() && S.stage && S.stage.id === id && LV.model.status === 'quiet' && !press && !LV.letGo) lvSend({ t: 'chat', canvas: id, image: img, ask: canvasAsk(due) });
      else { clearTimeout(asking.timer); CV.asking = null; }
    });
  };
  /** 服务端回了主动说的那一句:said = 嘴说了,记下;skipped = 不安静没说,作废 */
  const canvasChatAck = (m) => {
    const a = CV.asking;
    if (!a || m.canvas !== a.id) return;
    clearTimeout(a.timer); CV.asking = null;
    if (m.said && CV.chat && S.stage && S.stage.id === a.id) CV.chat = canvasChatSaid(CV.chat, a.at, a.due, a.strokes);
  };
  /** 画板铺满时嘴说的话:画布顶上浮一条,说完 4 秒淡掉 */
  const cvCap = () => {
    const el = $('#cv-cap');
    if (!$('#stage').classList.contains('cv')) { el.classList.remove('on'); return; }
    if (LV.model.status === 'mouth' && LV.cap.cur) { if (el.textContent !== LV.cap.cur) el.textContent = LV.cap.cur; el.classList.add('on'); clearTimeout(CV.capT); CV.capT = 0; return; }
    if (el.classList.contains('on') && !CV.capT) CV.capT = setTimeout(() => { CV.capT = 0; el.classList.remove('on'); }, 4000);
  };
  /** 「给老师看」:让舞台导出 png;画板卡存状态(连图)、纸把图传进 captures/,回这一条要带的(交卡的 action + focus / 纸的 drawing);舞台关掉。8 秒没导出来算了 */
  const canvasGive = () => new Promise((resolve) => {
    if (CV.give) { const g = CV.give; CV.give = null; g(null); }
    CV.give = resolve;
    postStage({ type: 'control', action: 'submit' });
    setTimeout(() => { if (CV.give === resolve) { CV.give = null; resolve(null); } }, 8000);
  });
  /** 纸上的画交出去:先存纸(服务端按它算摘要),再传图;纸不锁,接着能画 */
  const paperSubmit = (m) => {
    const P = S.paper;
    if (!P || !m.image) return Promise.resolve(null);
    P.card.state = withCleared(P.card.state, m.state);
    closeStage();
    return savePaper().then(() => api('POST', CONV + S.tutor.name + '/photos', { image: m.image })).then((r) => (r && r.path ? { drawing: { key: P.key, image: r.path } } : null), () => null);
  };
  /** 清空了(舞台先导出了那一版):图传进 captures/,记进这张的 cleared;边画边聊重新算 */
  const canvasCleared = (card, m) => {
    if (CV.chat) CV.chat = canvasChatCleared(CV.chat, m.at || Date.now());
    const entry = { at: m.at || Date.now(), strokes: m.strokes || 0, ...(m.from ? { from: m.from } : {}) };
    // 先记下是哪一张:图传上去要一会儿,这时舞台可能关了、换了一张;存回清空的那张(画板卡按 job 与第几张,纸按那个对象)
    const tutor = S.tutor ? S.tutor.name : null;
    const P = S.stage && S.stage.paper ? S.paper : null;
    const where = P ? null : { job: S.sections[S.stage.section].job, idx: S.stage.card };
    const put = (image) => {
      if (!S.tutor || S.tutor.name !== tutor) return;
      const add = (st) => ({ ...(st || { ink: [] }), cleared: [...(st && Array.isArray(st.cleared) ? st.cleared : []), { ...entry, ...(image ? { image } : {}) }].slice(-50) });
      if (P) { if (S.paper !== P) return; P.card.state = add(P.card.state); savePaper(); return; }
      const sec = S.sections.find((x) => x.job === where.job);
      const c = sec ? sec.cards[where.idx] : card;
      if (!c || c.submitted) return;
      c.state = add(c.state);
      if (c !== card) card.state = c.state;
      saveState(where.job, where.idx, c.state);
    };
    if (!m.image || !S.tutor) { put(null); return; }
    api('POST', CONV + S.tutor.name + '/photos', { image: m.image }).then((r) => put(r && r.path), () => put(null));
  };
  const openStage = (secIdx, idx, opts = {}) => {
    const card = S.sections[secIdx] && S.sections[secIdx].cards[idx];
    if (!card) return;
    if (card.kind === 'lecture' && !lectureReady(card)) return; // 课包读不出来:紧凑态写着「课还没放进来」,不开
    if (S.readonly && hasState(card) && !opts.delegate) return; // 以前的只能看:选择 / 填空 / 画板不开,免得改了当时的答案
    S.stage = { section: secIdx, card: idx, id: S.sections[secIdx].job + '/' + idx, playing: null, delegate: Boolean(opts.delegate), autoplay: Boolean(opts.autoplay) };
    playRec({ k: 'stage', job: S.sections[secIdx].job, card: idx, open: true });
    // 画板铺满:题目一行写在顶栏,点开看全
    $('#st-ttl').textContent = card.kind === 'canvas' ? (card.props.prompt || '画一画') : cardTitle(card);
    $('#st-ttl').classList.remove('open');
    $('#st-kd').textContent = KIND_NAME[card.kind] || card.kind;
    $('#st-kd').hidden = card.kind === 'canvas' || !(KIND_NAME[card.kind] || card.kind);
    $('#stage').classList.toggle('cv', card.kind === 'canvas');
    renderStage();
    $('#stage').classList.add('on');
    setNow(secIdx, idx);
    if (card.kind === 'canvas') canvasOpened();
  };
  const STAGE_SOURCE = 'cotutor-stage';
  const frame = $('#st-frame');
  const postStage = (m) => { try { frame.contentWindow.postMessage({ source: STAGE_SOURCE, ...m }, '*'); } catch {} };
  const renderStage = () => {
    if (!S.stage) return;
    const card = stageCardNow();
    if (!card) return;
    const heavy = isHeavy(card);
    $('#st-body').hidden = heavy;
    frame.hidden = !heavy;
    if (heavy) { $('#st-body').replaceChildren(); frame.src = stageUrl(S.stage.id); }
    else { frame.src = 'about:blank'; $('#st-body').replaceChildren(renderCard(card, S.stage.card, S.stage.section, true)); }
    const act = $('#st-act'); act.hidden = !hasState(card);
    $('#st-go').textContent = GO_LABEL[card.kind] || '交给老师';
    $('#st-go').disabled = !stateSummary(card).length;
    $('#st-go').hidden = false;
    $('#st-note').textContent = card.kind === 'canvas' ? stateSummary(card).join('、') : '';
    $('#st-go').classList.remove('holding');
    // 交过的卡锁住:只看,没有「交给老师」
    if (card.submitted) { act.hidden = S.readonly; $('#st-go').hidden = true; $('#st-note').innerHTML = ICON.lock + ' 交给老师了'; }
  };
  /** 发给舞台包的这张卡(ready 时发;看录像时孩子改了卡再发一次,包按新状态重画) */
  const stageCard = (card) => {
    const b = card.kind === 'lecture' ? card.props.bundle : card.kind === 'canvas' && card.props.base && card.props.base.bundle ? card.props.base.bundle : null;
    const im = card.kind === 'canvas' && card.props.base && typeof card.props.base.image === 'string' ? card.props.base.image : null;
    return { type: 'card', id: S.stage.id, kind: card.kind, props: card.props, state: card.state === undefined ? null : card.state, readonly: Boolean(card.submitted), ...(card.kind === 'canvas' ? { full: true, hand: document.body.classList.contains('hand-left') ? 'left' : 'right' } : {}), bundleUrl: b ? lcBundleUrl(b, card.kind === 'lecture' && card.props.video === true) : undefined, imageUrl: im ? '/api/kid/image?p=' + encodeURIComponent(im) : undefined, autoplay: S.stage.autoplay };
  };
  /** 舞台包说话:ready → 把卡发过去;phase → 字幕行;state → 存;done 且是讲稿委托的 → 关舞台接着念 */
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.source !== STAGE_SOURCE || !S.stage) return;
    const card = stageCardNow();
    if (!card) return;
    if (m.type === 'ready') postStage(stageCard(card));
    else if (m.type === 'snap') { const w = CV.snapWait; CV.snapWait = null; if (w) w(m.image); }
    else if (m.type === 'cleared') { if (!card.submitted) canvasCleared(card, m); }
    else if (m.type === 'phase') {
      S.stage.playing = { phase: m.phase, line: m.line };
      // 小课堂卡(仲裁表「交给小课堂」):那一段放完,舞台不关、停在末帧,字幕行还给老师,接着念
      if (m.phase === 'done' && card.kind === 'lecture') { S.stage.playing = null; if (S.stage.delegate) { S.stage.delegate = false; resumeAfter(); } }
      renderSubtitle();
    }
    else if (m.type === 'state') {
      if (card.submitted) return;
      card.state = withCleared(card.state, m.state);
      if (card.kind === 'canvas') CV.strokes = canvasStrokes(Array.isArray(m.state && m.state.ink) ? m.state.ink : []);
      $('#st-go').disabled = !stateSummary(card).length; $('#st-note').textContent = stateSummary(card).join('、');
      if (S.stage.paper) { savePaper(); return; }
      repaintCard(S.stage.section, S.stage.card); saveState(S.sections[S.stage.section].job, S.stage.card, card.state);
    }
    else if (m.type === 'submit') {
      // 「给老师看」:轻点的直接发这一条;按住说的(CV.give)把要带的交回去,等松手那一下发
      const done = CV.give; CV.give = null;
      const finish = (patch) => { if (done) done(patch); else if (patch) send('', patch); };
      if (S.stage.paper) { paperSubmit(m).then(finish, () => finish(null)); return; }
      if (card.submitted) { finish(null); return; }
      card.state = withCleared(card.state, m.state); card.submitted = true;
      const id = S.stage.id; const secI = S.stage.section, job = S.sections[secI].job; const idx = S.stage.card;
      closeStage(); repaintCard(secI, idx);
      api('PUT', CONV + S.tutor.name + '/cards/' + job + '/' + idx, m.image ? { ...card.state, image: m.image } : card.state).catch(() => {}).then(() => finish({ action: 'submit', focus: { card: id } }));
    }
    else if (m.type === 'close' || m.type === 'error') { const d = S.stage; closeStage(); if (d.delegate) resumeAfter(d); }
  });
  const resumeAfter = () => { if (LV.on) liveDispatch({ type: 'lectureDone' }); };
  const closeStage = () => { if (S.stage && S.sections[S.stage.section]) playRec({ k: 'stage', job: S.sections[S.stage.section].job, card: S.stage.card, open: false });
    // 单词卡舞台:自动那一遍停下,慢念也停
    for (const v of document.querySelectorAll('#st-body video')) { try { v.pause(); } catch {} }
    wordRun++; if (S.stage && !S.reel && S.sections[S.stage.section] && (S.sections[S.stage.section].cards[S.stage.card] || {}).kind === 'word') silence(); S.stage = null; frame.src = 'about:blank'; canvasClosed(); $('#stage').classList.remove('on'); renderSubtitle(); if (LV.on) setNow(null, null); else showNow(); };
  $('#st-x').innerHTML = ICON.close;
  // 孩子关:讲稿交给小课堂卡、还没放完的,关了接着念
  const closeByKid = () => { const d = S.stage; const card = d && S.sections[d.section] ? S.sections[d.section].cards[d.card] : null; closeStage(); if (d && d.delegate && card && (!isHeavy(card) || card.kind === 'lecture')) resumeAfter(); };
  $('#st-x').addEventListener('click', closeByKid);
  $('#st-dim').addEventListener('click', closeByKid);
  /** 选择题:点一项 → 本地改状态、重画、PUT 到服务端(失败不响,下次再点再存) */
  const pick = (secIdx, idx, i) => {
    const card = S.sections[secIdx].cards[idx];
    if (card.submitted) return;
    const cur = (card.state && Array.isArray(card.state.picked)) ? card.state.picked : [];
    card.state = { picked: togglePick(cur, i, Boolean(card.props.multi)) };
    renderStage(); repaintCard(secIdx, idx);
    saveState(S.sections[secIdx].job, idx, card.state);
  };
  const saveState = (job, idx, state) => { if (!S.tutor || S.readonly) return; api('PUT', CONV + S.tutor.name + '/cards/' + job + '/' + idx, state).catch(() => {}); };
  /** 「交给老师」/「给老师看」点一下;画板的按住说在 bindGive(按住说话那几颗旁边) */
  const giveTap = () => {
    if (!S.stage) return;
    const card = stageCardNow();
    if (!card || card.submitted) return;
    if (isHeavy(card)) { if (card.kind === 'canvas' && !stateSummary(card).length) return; postStage({ type: 'control', action: 'submit' }); return; } // 画板:让舞台包导出 png 再交
    if (!stateSummary(card).length) return;
    if (card.submitted) return;
    const id = S.stage.id, secI = S.stage.section, idx = S.stage.card;
    card.submitted = true;
    closeStage();
    repaintCard(secI, idx);
    send('', { action: 'submit', focus: { card: id } });
  };
  $('#st-ttl').addEventListener('click', () => { if ($('#stage').classList.contains('cv')) $('#st-ttl').classList.toggle('open'); });
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
    const g = h('div', { class: 'wait-card' });
    g.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 120 34"><path d="M4 22 C 14 6, 22 30, 32 16 S 48 6, 56 20 S 72 30, 80 14 S 98 8, 112 18"/><path d="M10 30 L 70 30"/></svg>');
    return g;
  };
  /** 字幕行与「再听」照的播放位置:平时是播放器的 S.state;录像里孩子的屏幕是录像这一刻的(reelKidSub 算的),不写进 S.state */
  const playView = () => (REEL && S.reel && S.reel.view) || S.state;
  const renderSubtitle = () => {
    if (!S.pending) S.waitSince = null;
    const waited = S.waitSince ? Date.now() - S.waitSince : 0;
    const ps = playView();
    let v = subtitleFor({ state: ps, sections: S.sections, pending: S.pending, waitedMs: waited });
    if (S.stage && S.stage.playing) v = stageSubtitle(S.stage.playing.phase, S.stage.playing.line);
    const t = $('#sub-text'); t.className = v.kind;
    const dots = () => h('span', { class: 'dots' }, h('i'), h('i'), h('i'));
    if (v.kind === 'wait') t.replaceChildren(v.text, dots());
    else if (v.kind === 'gap') t.replaceChildren(v.text, dots());
    else t.textContent = v.text;
    clearTimeout(S.waitTimer);
    if (v.kind === 'wait' && waited < WAIT_LONG_MS) S.waitTimer = setTimeout(renderSubtitle, WAIT_LONG_MS - waited);
    // 占位卡:第一拍前、以及念着没卡的开头句时都在(第一张卡落下才撤),总在板的最后。
    // 实时没有占位卡:卡不一定有,等脑时看左栏头像在想(body.pending)
    const board = $('#board'); let g = board.querySelector(':scope > .wait-card');
    if (!liveLook() && (v.kind === 'wait' || (S.partial && S.partial.live && !S.partial.shown))) { if (!g) { g = waitCardEl(); board.append(g); follow(g); } else if (g !== board.lastElementChild) board.append(g); }
    else if (g) g.remove();
    const b = $('#sub-btn');
    b.hidden = v.right === 'none';
    b.innerHTML = v.right === 'pause' ? ICON.pause : v.right === 'play' ? ICON.play : '';
    // 实时:脑还在写时嘴在说,头像是「说」不是「想」
    document.body.classList.toggle('pending', S.pending && !(LV.on && LV.model.status === 'mouth'));
    // 老师等着孩子答:最后那张问题卡的答案栏露「等你说…」
    document.body.classList.toggle('waiting', ps.status === 'waiting' && !S.pending);
    if (LV.on) {
      // 实时:头像跟着嘴(liveStep 的状态,按钮的样子在 voiceSync);嘴停了、脑也写完了点一下头;字幕在左栏
      document.body.classList.toggle('speaking', LV.model.status === 'mouth');
      if (LV.was === 'mouth' && LV.model.status !== 'mouth' && !S.pending) liveNod();
      LV.was = LV.model.status;
      liveCaption();
    } else {
      document.body.classList.toggle('speaking', ps.status === 'playing' && !S.pending);
      if ((ps.status === 'waiting' || ps.status === 'done') && avWas === 'playing' && !S.pending) avNod();
    }
    avWas = ps.status;
    voiceSync();
  };
  // 字幕行右边的钮只剩舞台里小课堂的暂停 / 播放
  $('#sub-btn').addEventListener('click', () => { if (S.stage && S.stage.playing) postStage({ type: 'control', action: 'toggle' }); });

  /** 把一节的标注一次画齐:不描,直接在 */
  const paintAll = (secIdx) => { const s = S.sections[secIdx]; if (!s) return; for (const l of s.lines) for (const m of l.marks) applyMark(secIdx, m, false); };

  // ---- 板上的节:改位置的事都走 dispatch → step(kid-board.ts,纯函数,见 tests/player.test.ts),这里只照单执行它回的事。
  // 页面里不许再直接改 S.state(tests/player.test.ts 数着);讲稿不念了,嘴念的走 liveDispatch ----
  const runEffect = (f) => {
    switch (f.kind) {
      case 'stop': silence(); break;
      case 'render': renderSubtitle(); break;
      case 'showNow': if (!LV.on) showNow(); break;
      case 'paint': paintAll(f.section); break;
      case 'scrollLast': { pin.on = false; const last = $('#board').querySelector('[data-sec="' + (S.sections.length - 1) + '"] .c'); if (last) last.scrollIntoView({ block: 'start', behavior: 'instant' }); break; }
    }
  };
  // ---- 录像的实录(只在孩子端):孩子看到、听到、做了什么,攒着每 10 秒一批发给服务端(页面退到后台时 sendBeacon)。
  //      只记今天、能发消息的话题(以前的只读回放不记);卡的每次改动服务端在存卡时自己记。发不出去就丢,不重试 ----
  const PLAY = { buf: [], last: '' };
  const playRec = (r) => {
    if (!S.tutor || S.readonly || S.hist) return;
    PLAY.buf.push({ tutor: S.tutor.name, thread: S.newThread ? null : S.thread, rec: { at: Date.now(), ...r } });
    if (PLAY.buf.length > 600) PLAY.buf.splice(0, PLAY.buf.length - 600);
  };
  // ---- 实录补记:孩子看到什么记什么——屏幕多大(键盘弹起来多高)、按住说话的每一步、输入框里的字、发照片屏、自己翻到哪 ----
  /** 屏幕尺寸、键盘高(iOS 键盘弹起来只缩 visualViewport)、页面版本;变了才记,转屏、键盘起落停手 300 毫秒记一次 */
  let viewKey = '', viewTimer = 0;
  const viewNote = () => {
    const vv = window.visualViewport;
    const kb0 = vv ? Math.round(innerHeight - vv.height - (vv.offsetTop || 0)) : 0;
    const kb = kb0 > 80 ? Math.min(2000, kb0) : 0;
    const key = innerWidth + 'x' + innerHeight + '/' + kb;
    if (key === viewKey) return;
    viewKey = key;
    playRec({ k: 'view', w: Math.max(100, Math.min(4000, innerWidth)), h: Math.max(100, Math.min(4000, innerHeight)), kb, v: PAGE_V });
  };
  const viewSoon = () => { clearTimeout(viewTimer); viewTimer = setTimeout(viewNote, 300); };
  window.addEventListener('resize', viewSoon);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', viewSoon);
  /** 两次之间不到 gap 毫秒的值先攒着,到点再记最新的那个(按住时认出的字、输入框里的字一秒能变好几次) */
  const throttled = (gap, rec) => {
    const T0 = { last: '', at: 0, timer: 0, pend: null };
    const flush = () => { clearTimeout(T0.timer); if (T0.pend !== null && T0.pend !== T0.last) { T0.last = T0.pend; T0.at = Date.now(); rec(T0.pend); } T0.pend = null; };
    return { put: (v) => { if (v === T0.last && T0.pend === null) return; T0.pend = v; const wait = gap - (Date.now() - T0.at); if (wait <= 0) flush(); else { clearTimeout(T0.timer); T0.timer = setTimeout(flush, wait); } }, flush, reset: () => { clearTimeout(T0.timer); T0.last = ''; T0.at = 0; T0.pend = null; } };
  };
  /** 按住说话:按下 / 话筒开了 / 上滑进出取消区 / 松手 / 收尾(结果 + 每 100 毫秒一位的音量) */
  const HR = { on: false, t0: 0, lv: [] };
  const holdRec = (e, extra) => { if (e === 'down') { HR.on = true; HR.t0 = Date.now(); HR.lv = []; } else if (!HR.on) return; playRec({ k: 'hold', e, ...(extra || {}) }); };
  const holdLvRec = (v) => { if (!HR.on) return; const i = Math.floor((Date.now() - HR.t0) / 100); if (i >= 0 && i < 600) HR.lv[i] = Math.max(HR.lv[i] || 0, v); };
  const holdEnd = (r) => {
    if (!HR.on) return;
    const lv = Array.from({ length: HR.lv.length }, (_, i) => String(Math.min(9, Math.round((HR.lv[i] || 0) * 9)))).join('');
    holdRec('end', { r, ...(lv ? { lv } : {}) });
    HR.on = false;
  };
  /** 打字:点进输入框 / 值变了(300 毫秒一次)/ 发了 / 收起 */
  const typeHeard = throttled(300, (v) => playRec({ k: 'type', e: 'v', v: v.slice(0, 400) }));
  const typeRec = (e) => { if (e === 'focus') typeHeard.reset(); else typeHeard.flush(); playRec({ k: 'type', e }); };
  /** 孩子自己翻板书(拖、滚轮;程序滚的不算):停手 400 毫秒记一次,锚在最上面露出来的那张卡上 */
  const scrollNote = () => {
    const b = $('#board'), top = b.getBoundingClientRect().top;
    const c = [...b.querySelectorAll(':scope > .sec[data-job] .c[data-card]')].find((el) => el.getBoundingClientRect().bottom > top + 8);
    if (!c) return;
    playRec({ k: 'scroll', job: c.closest('.sec').dataset.job, card: Number(c.dataset.card), dy: Math.max(-20000, Math.min(20000, Math.round(c.getBoundingClientRect().top - top))) });
  };
  let scrollTimer = 0;
  $('#board').addEventListener('scroll', () => { if (Date.now() - pin.touched > 1500) return; clearTimeout(scrollTimer); scrollTimer = setTimeout(scrollNote, 400); }, { passive: true });
  /** 播放器的位置变了才记(哪一节 · 第几句 · 在念 / 暂停 / 等答 …) */
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
    const r = step({ state: S.state }, ev, { sections: S.sections });
    S.state = r.model.state;
    for (const f of r.effects) runEffect(f);
  };

  const loadDay = async (silent) => {
    if (!S.tutor || S.reel) return;
    try {
      // 今天、选了话题:带上它,服务端把 resume 那个预热进程换成这个话题的
      const warmHint = !S.hist && S.thread ? '?thread=' + encodeURIComponent(S.thread) : '';
      const d = await api('GET', CONV + S.tutor.name + '/' + (S.hist || 'today') + warmHint);
      setOffline(false);
      S.day = d;
      // 话题:没选过就是当前(末条所在)的;板书只铺这个话题的节。新话题空白态什么都不铺,发出第一句才有话题
      if (!S.thread && !S.newThread) S.thread = d.thread;
      const mine = S.newThread ? [] : d.messages.filter((m) => m.thread === S.thread);
      const first = mine.find((m) => m.question !== null) || mine[0];
      S.threadAt = first ? first.at : null;
      const entries = sectionsFromMessages(mine);
      // 卡上的配音(点读段、单词、示范音)这一轮跑完才在后台配,比节晚一两秒:已经铺上的节把 card.assets 补上,不重画,点的时候才看(cardClip)。原来不补,不重进老师页就一直没有
      for (const e of entries) { const s = S.sections.find((x) => x.job === e.job); if (s && s !== e) e.cards.forEach((c, i) => { const t = s.cards[i]; if (t && Array.isArray(c.assets) && c.assets.length > (t.assets || []).length) t.assets = c.assets; }); }
      const fresh = [];
      for (const e of entries) {
        if (S.partial && S.partial.job === e.job && S.partial.live) { if (e.partial) renderLive(e); else finalizeLive(e); continue; }
        if (S.played.has(e.job)) continue;
        if (e.partial) { renderLive(e); continue; }
        S.played.add(e.job); S.sections.push(e); fresh.push(S.sections.length - 1);
        const idx = S.sections.length - 1;
        if (S.partial && S.partial.job === e.job) {
          // 流式时一行一张先铺着;跑完了按定稿的行整节重画,节的编号就是它现在的位置
          const el = S.partial.el; S.partial = null;
          el.replaceWith(renderSection(e, idx));
        } else $('#board').append(renderSection(e, idx));
        // 实时的一节整节到了(没流过):标注都画上;不是回来看(silent)就当刚落下,田字格写一遍
        if (e.live) e.cards.forEach((_, k) => liveLand(idx, k, !silent));
      }
      // 这条既不 pending 也没定稿(运行出错了):撤掉;live 的那节也撤(孩子端出错的运行不出现)
      if (S.partial && !entries.some((e) => e.job === S.partial.job)) { const P = S.partial; S.partial = null; P.el.remove(); if (P.live) { S.sections.splice(P.idx, 1); dispatch({ type: 'liveDropped' }); } }
      // 服务端的状态是真相(别的设备上选的、重开页面):没在舞台里改着的卡照它画;props 也跟(小课堂卡的 ready、起止是服务端下发时现读的)
      entries.forEach((e) => { const i = S.sections.findIndex((x) => x.job === e.job); if (i < 0 || fresh.includes(i)) return; e.cards.forEach((c, idx) => { const mine = S.sections[i].cards[idx]; if (!mine || (S.stage && S.stage.section === i && S.stage.card === idx)) return; const ds = JSON.stringify(mine.state) !== JSON.stringify(c.state), dp = JSON.stringify(mine.props) !== JSON.stringify(c.props); if (ds || dp) { mine.state = c.state; mine.props = c.props; repaintCard(i, idx); } }); });
      if (fresh.length && S.stage && !S.stage.paper) closeStage();
      // 孩子的话:刚发出去、这一节还没出来的先挂上;答案栏对一遍
      {
        const lastM = mine[mine.length - 1];
        const sd = lastM && lastM.pending ? kidSaid(mine).get(lastM.job) : null;
        const shown = lastM && (S.sections.some((s) => s.job === lastM.job) || (S.partial && S.partial.job === lastM.job));
        S.pendSaid = sd && !shown ? { job: lastM.job, said: sd.said, on: sd.on, live: Boolean(lastM.live) } : null;
        syncPendSay(); syncAnswers();
      }
      const stillPending = Boolean(d.pending) || d.messages.some((m) => m.pending);
      S.pending = stillPending;
      if (stillPending && !S.waitSince) S.waitSince = Date.now();
      if (fresh.length) dispatch({ type: 'fresh', sections: fresh });
      else renderSubtitle();
      if (S.lecture) renderLecturePending();
      if (!S.sections.length && !S.partial && !stillPending && !S.readonly && !S.lecture && !$('#board .blank')) $('#board').append(blankBoard('想问什么?'));
      renderHeader();
      clearTimeout(S.pollTimer);
      // 画图卡还在画(老师已经说完了):隔 3 秒拉一次,图到了 props 变了就重画那张卡
      const painting = S.sections.some((sec) => sec.cards.some((c) => c.kind === 'paint' && c.props && c.props.drawn === 'drawing'));
      if (stillPending) S.pollTimer = setTimeout(() => loadDay(false), 1000);
      else if (painting && !S.hist) S.pollTimer = setTimeout(() => loadDay(true), 3000);
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
    if (S.hist && today) mo = '以前的 · ' + dateLabel(S.hist, S.hist === today ? '' : today) + ' ' + clock(S.threadAt);
    else if (S.cont && today) { const d = dateLabel(S.cont, today); mo = '接着' + (d === '昨天' ? d : ' ' + d + ' ') + '的话题'; }
    // 新话题不挂小标签(空板本身就说明了);小课堂照旧
    else if (S.newThread && S.lecture) mo = '小课堂';
    else if (S.thread && S.day && S.thread !== S.day.thread) mo = '今天的话题 · ' + clock(S.threadAt);
    $('#c-mo').textContent = mo; $('#c-mo').hidden = !mo;
    const nb = $('#new-btn');
    nb.hidden = S.newThread || S.readonly || (!S.sections.length && !S.pending && !S.partial);
    nb.classList.toggle('dim', S.pending);
  };
  // 家长端的 chrome:只看(S.readonly:选择 / 填空 / 画板不开)、没有输入条、没有「回到今天」(回清单走左上角)、没有「更多」。
  // 家长要试老师,到孩子端当一回孩子,用完回清单删那个话题(写进记忆、日记的一起撤)
  /** 能不能发消息:孩子端 = 不只读;家长端不发 */
  const canSend = () => !S.readonly && !S.ask && !S.talkWait && !(S.lecture && !S.lecture.watch);
  /** 空板上等孩子先点上面一个(今天点过同一个按钮、口语单拍好):点之前不发;实时左栏那颗灰着写「点上面开始」 */
  const choosing = () => Boolean(S.ask || S.talkWait) && !S.readonly && !REEL;
  const renderBar = () => { $('#pill').hidden = !canSend() && !REEL; document.body.classList.toggle('nosend', !canSend() && !REEL); document.body.classList.toggle('choose', choosing()); $('#back-today').hidden = !S.readonly || REEL; voiceSync(); };
  const resetBoard = () => { dispatch({ type: 'halt' }); if (S.stage) closeStage(); clearTimeout(S.pollTimer); S.sections = []; S.played = new Set(); dispatch({ type: 'reset' }); S.partial = null; pin.on = false; $('#board').replaceChildren(); };
  /** 换到某天的某个话题:今天的能接着聊;以前的只读回放(从第一句播) */
  const switchThread = (date, thread) => {
    resetBoard();
    S.hist = date; S.readonly = Boolean(date); S.thread = thread; S.newThread = false; S.threadAt = null; S.via = null; S.cont = null; S.lecture = null; S.ask = null;
    if (S.readonly) liveClose(); else if (!LV.on && liveWanted(S.tutor)) liveOpen();
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
    S.newThread = true; S.thread = null; S.threadAt = null; S.lecture = null;
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
  /**
   * 小课堂:看完后的第一条带看的情况与画的;问过以后再看一遍又画了,下一条带新画的(板书、实时都走这里)。
   * 画的一处带截图:先传成 captures/ 里的文件(同照片),换成路径;传不上就不带这张图。时刻换成离发出去多少毫秒(孩子端自己的钟,不用对钟)
   */
  const lectureBody = async () => {
    const L = S.lecture;
    if (!L || !L.watch) return null;
    if (L.marks && L.marks.some((k) => k.image && k.image.startsWith('data:'))) {
      for (const k of L.marks) if (k.image && k.image.startsWith('data:')) { try { const r = await api('POST', CONV + S.tutor.name + '/photos', { image: k.image }); k.image = r.path; } catch { delete k.image; } }
    }
    const sentAt = Date.now();
    if (L.sent && !L.marks.length && !L.log.length) return null;
    return { bundle: L.bundle, ...(L.sent ? (L.rewatch || { watchedMs: 0, finished: false, pauses: 0 }) : L.watch), ...(L.marks.length ? { marks: L.marks.map((k) => ({ atMs: k.atMs, strokes: k.strokes, ...(k.image ? { image: k.image } : {}), ...(k.at ? { t: Math.min(0, k.at - sentAt) } : {}) })) } : {}), ...(L.log.length ? { log: L.log.map((e) => ({ t: Math.min(0, e.at - sentAt), pos: e.pos, play: e.play })) } : {}) };
  };
  /** 带着小课堂的那条发出去了:画的挪到「飞着的」(画在回答它的那节前面),job 是那一轮(实时的到 turn 才知道,先 null) */
  const lectureSent = (job) => {
    const L = S.lecture;
    if (!L) return;
    L.flying = L.marks; L.marks = []; L.log = []; if (!L.sent) L.firstJob = job; L.sent = true; L.job = job; L.rewatch = null; renderLecturePending();
  };
  /** 孩子发一条(打字、拍照、交卡、首页按钮的开场):都走实时那条连接,嘴先接住;嘴还没连上(刚进来就发开场)先排着,连上就发。
   *  不走实时的页面(以前的话题、家长端、录像、预览)发不了 */
  const send = (text, opts = {}) => {
    text = (text || '').trim();
    if (!text && !opts.action && !(opts.photos && opts.photos.length) && !opts.drawing) return;
    if (!S.tutor || !canSend() || !LV.on) return;
    unlock();
    if (LV.ready) liveSendNow(text, opts); else LV.queued = [text, opts];
  };

  // ---- 看录像:录像 = 孩子的屏幕 + 录像栏。
  //      孩子的屏幕:这个页面以 MODE.reel 开在 iframe 里(/reel?tutor=&date=&thread=),按孩子那台设备的尺寸开,家长页等比缩。
  //      轨道是服务端排好的(lib/reel.ts,已内联),每 100 毫秒算一次 reelFrameAt:板书用 renderSection 现画(孩子端条目:孩子的话当节头、进答案栏)、
  //      露几张卡与卡的状态照它、卡露出来时画上它的标注、放那次通话的声音(从这句起);字幕行、占位卡、「等你说…」照孩子端自己的逻辑(这一刻的位置放进 S.reel.view 再 renderSubtitle)。
  //      不经过 step、不 dispatch;轮询停着(loadDay 见 S.reel 就回)。
  //      录像栏(进度条、这一刻的说明、播放、跳过空白、倍速、退出)在家长页上,只经 iframe 的 window.cotutorReel 说话:同源直接调,家长点「播放」的那一下调进去;
  //      iframe 放声音用的是家长页那个 Audio(家长点「看录像」时已解锁)。直接打开 iframe 的地址(调试)时,录像栏在它自己身上 ----
  const REEL_SPEEDS = [1, 1.5, 2];
  /** 一张卡的答案(家长接口不剥):选择题写选项,填空写各空 */
  const reelAnswer = (c) => {
    const p = c.props || {};
    if (c.kind === 'choice' && Array.isArray(p.answer) && p.answer.length) return p.answer.map((i) => ('ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i] || String(i + 1)) + (p.options && p.options[i] ? ' ' + p.options[i] : '')).join('、');
    return '';
  };
  /** 孩子那台设备的 CSS 尺寸:孩子端还没记屏幕尺寸之前,按消息里的 device 取常见的;没记 device 的按 iPad 横屏 */
  const REEL_SIZES = { 'tablet-landscape': [1180, 820], 'tablet-portrait': [820, 1180], phone: [390, 844] };

  // ---- 录像的引擎:只在孩子的屏幕里(REEL)跑 ----
  const reelSetClock = () => {
    const R = S.reel;
    const w = R.clock ? R.clock.toWall(R.p) : R.d.reel.startAt;
    R.clock = reelClock(R.d.reel, R.real);
    R.p = R.clock.toPlay(w);
  };
  /** 弹窗(实录):孩子开着哪张就只读地开哪张,改了就重画(重卡重发一次 card);关了就关。点不动(body.rlk) */
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
  /** 板书:哪几节、卡的状态变了就整块重画(往回拖也是);露几张卡、露出来的卡的标注、孩子刚发出去的话每次对一下 */
  const reelDraw = (f) => {
    const R = S.reel;
    const shown = f.sections.filter((fs) => R.entries.some((e) => e.job === fs.job));
    const key = JSON.stringify([shown.map((fs) => fs.job), f.cards]);
    if (key !== R.key) {
      R.key = key; R.painted = {}; R.now = '';
      S.sections = shown.map((fs) => { const e = R.entries.find((x) => x.job === fs.job); return { ...e, cards: e.cards.map((c, k) => { const o = { ...c }; const st = f.cards[fs.job + '/' + k]; if (st === undefined) delete o.state; else o.state = st; return o; }) }; });
      const board = $('#board'); const top = board.scrollTop;
      board.replaceChildren(...S.sections.map((sec, i) => renderSection(sec, i)));
      board.scrollTop = top;
      R.rebuilt = true;
    }
    // 孩子刚发出去、它引出的那一节还没出来:那句话先挂在板尾,或进上一张问题卡的答案栏(孩子端 loadDay 的 pendSaid)
    const lastN = f.notes[f.notes.length - 1];
    const sd = lastN && !shown.some((fs) => fs.job === lastN.job) ? R.said.get(lastN.job) : null;
    const pk = sd ? lastN.job : '';
    if (pk !== R.pend || R.rebuilt) { R.pend = pk; S.pendSaid = sd ? { job: lastN.job, said: sd.said, on: sd.on } : null; syncPendSay(); syncAnswers(); }
    let fresh = null;
    shown.forEach((fs, i) => {
      const el = $('#board').querySelector(':scope > .sec[data-sec="' + i + '"]'); if (!el) return;
      for (const row of el.querySelectorAll(':scope > .row')) {
        let any = false;
        for (const c of row.querySelectorAll(':scope > [data-card]')) { const hide = Number(c.dataset.card) >= fs.cards; if (!hide && c.classList.contains('pend')) fresh = c; c.classList.toggle('pend', hide); any = any || !hide; }
        row.classList.toggle('pend', !any);
      }
      // 标注不跟句子:卡露出来就画上这张卡的(同孩子端 liveLand;藏着的卡量不出位置,画线的笔要等它露出来),实时与不是实时的轮一样
      const sec = S.sections[i];
      for (let k = 0; k < Math.min(fs.cards, sec.cards.length); k++) {
        const id = fs.job + '/' + k;
        if (R.painted[id]) continue;
        R.painted[id] = true;
        for (const l of sec.lines) for (const m of l.marks) if (m.card === k) applyMark(i, m, false);
      }
    });
    // 念到哪张亮哪张
    const at = f.saying || f.last;
    const i = at ? S.sections.findIndex((x) => x.job === at.job) : -1;
    const nk = i >= 0 ? i + '/' + at.line : '';
    if (nk !== R.now) { R.now = nk; if (i >= 0 && !S.sections[i].live) { setNow(i, nowCard(S.sections, { section: i, line: at.line, status: 'playing' })); const el = $('#board .c.now'); if (el) fresh = el; } }
    // 跟着最新的走:板上看得见的多了(新的一节、刚发出去的话、露出来的卡)或刚拖过进度条,就滚到最底下那个;只是念到了上面另一张卡,滚到那张
    const board = $('#board');
    const seen = board.querySelectorAll(':scope > .sec, :scope > .sh.said.pend, :scope > .sec .c:not(.pend)').length;
    if (seen > R.seen || R.follow) {
      const tail = [...board.querySelectorAll(':scope > .sec, :scope > .sh.said.pend')].reverse().find((el) => el.getClientRects().length);
      if (tail) tail.scrollIntoView({ block: 'end', behavior: R.follow ? 'instant' : 'smooth' });
    } else if (fresh) fresh.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    R.seen = seen; R.follow = false;
    reelStage(f, R.rebuilt); R.rebuilt = false;
  };
  /** 字幕行、占位卡、「等你说…」、输入条压淡:孩子端自己的 renderSubtitle 照这一刻画。播放位置放在 S.reel.view(playView 读它),不碰 S.state、不 dispatch;
   *  句与句之间那 200 毫秒还算在念上一句,不然字幕一闪一闪 */
  const reelKidSub = (f, t) => {
    const R = S.reel;
    const at = f.saying || f.last;
    const i = at ? S.sections.findIndex((x) => x.job === at.job) : -1;
    let lastTo = 0; for (const x of R.d.reel.says) { if (x.from > t) break; lastTo = x.to; }
    const tr = at ? R.d.reel.tracks.find((x) => x.job === at.job) : null;
    const going = Boolean(tr && tr.doneAt > t);
    const status = i < 0 ? 'idle' : f.saying || (going && t - lastTo < 600) ? 'playing' : going ? 'thinking' : f.asking ? 'waiting' : 'done';
    const st = i < 0 ? { section: -1, line: -1, status } : { section: i, line: at.line, status };
    const waitMs = f.wait ? f.wait.ms : 0;
    const key = JSON.stringify([st, Boolean(f.wait), Math.floor(waitMs / 1000), R.key, R.pend]);
    if (key === R.subKey) return;
    R.subKey = key;
    R.view = st; S.pending = Boolean(f.wait);
    S.waitSince = f.wait ? Date.now() - waitMs : null;
    renderSubtitle();
  };
  /** 有实时轮的话题:左栏字幕照这一刻——最近开始的一句讲稿或嘴接住的那句在说、它前一句淡;嘴在出声(念句、接住)头像外的圈亮 */
  const reelLiveCap = (f, t) => {
    const R = S.reel;
    if (!R.realtime) return;
    if (R.capOf !== R.d) {
      R.capOf = R.d;
      const text = (job, line) => { const e = R.entries.find((x) => x.job === job); return e && e.lines[line] ? plainLine(e.lines[line].text) : ''; };
      R.cap = [...R.d.reel.says.map((x) => ({ at: x.from, text: text(x.job, x.line) })), ...R.d.reel.clips.filter((c) => c.kind === 'mouth').map((c) => ({ at: c.from, text: c.text || '' }))].filter((x) => x.text).sort((a, b) => a.at - b.at);
    }
    let i = -1; while (i + 1 < R.cap.length && R.cap[i + 1].at <= t) i++;
    const speaking = Boolean(f.saying || (f.clip && f.clip.kind === 'mouth'));
    const key = i + '/' + speaking;
    document.body.classList.toggle('speaking', speaking);
    if (VB.reelSpeak !== speaking) { VB.reelSpeak = speaking; voiceSync(); }
    if (key === R.capKey) return;
    R.capKey = key;
    $('#lv-cap .lv-prev').textContent = i > 0 ? R.cap[i - 1].text : '';
    const c = $('#lv-cap .lv-cur'); c.textContent = i >= 0 ? R.cap[i].text : ''; c.classList.toggle('nm', i < 0);
    $('#lv-cap').classList.toggle('done', !speaking);
  };
  /** 按住说话:有实录(hold)照它画——话筒没开「等一下…」、在听、上滑「松手取消」、松手「正在听清…」,波形照记下的音量(声音流式推给嘴,按着的时候没有字);
   *  没有实录的话题:原声那一段就是孩子按着的时候,嘴认成的字按原声的进度一点点露、波形是浮层的假波形 */
  const reelHold = (f) => {
    const R = S.reel;
    const recorded = R.d.reel.holds.length > 0;
    const c = !f.hold && !recorded && f.clip && f.clip.kind === 'voice' ? f.clip : null;
    const on = Boolean(f.hold || c);
    // 平板横屏的按钮照这一刻画(按着、话筒开没开、上滑);孩子的竖条照录下的音量(最新那一格)。嘴的音量录像里没有,老师的弧只按最低深浅画
    const rh = f.hold ? { phase: f.hold.phase, slide: Boolean(f.hold.slide) } : c ? { phase: c.offset < 900 ? 'wait' : 'live', slide: false } : null;
    if (JSON.stringify(rh) !== JSON.stringify(VB.reelHold)) { VB.reelHold = rh; voiceSync(); }
    if (f.hold && f.hold.lv) VB.btn.level('kid', Number(f.hold.lv[f.hold.lv.length - 1] || 0) / 9);
    $('#hold').classList.toggle('on', on);
    if (!on) { if (R.hold) { R.hold = false; $('#hold .t').textContent = ''; $('#hold').classList.remove('real'); holdBars.forEach((b, i) => { b.style.height = R.barsH[i]; }); } return; }
    R.hold = true;
    let text = '', phase = 'live', slide = false, lv = null;
    if (f.hold) ({ phase, slide, lv } = f.hold);
    else {
      const clip = R.d.reel.clips.find((x) => x.kind === 'voice' && x.job === c.job);
      const dur = clip ? clip.to - clip.from : 1;
      const all = c.text || '';
      text = all.slice(0, Math.max(0, Math.min(all.length, Math.ceil(all.length * (c.offset - 900) / Math.max(1, dur - 1200)))));
      phase = c.offset < 900 ? 'wait' : 'live';
    }
    $('#hold .t').textContent = text.length > 60 ? '…' + text.slice(-60) : text;
    $('#hold').classList.toggle('wait', phase !== 'live');
    $('#hold span').textContent = phase === 'tail' ? '正在听清…' : slide ? '松手取消' : phase === 'wait' ? '等一下…' : '松手发送,上移取消';
    $('#hold').classList.toggle('real', lv !== null);
    if (lv !== null) holdBars.forEach((b, i) => { b.style.height = Math.round(4 + Number(lv[i] || 0) / 9 * 24) + 'px'; });
  };
  /** 输入条:在打字就是输入框里那一刻的字;没听清那 2.5 秒是「没听清,再按住说一次」;别的时候是占位字 */
  const reelInput = (f) => {
    const R = S.reel, ty = f.typing;
    const key = JSON.stringify([ty, f.unclear]);
    if (key === R.inKey) return;
    R.inKey = key;
    $('#ph').hidden = Boolean(ty); $('#typed').hidden = !ty; $('#go').hidden = !ty;
    $('#typed').value = ty ? ty.v : '';
    $('#ph').textContent = f.unclear ? '没听清,再按住说一次' : '发消息或按住说话…';
  };
  /** 键盘:在打字、记下的屏幕尺寸里有键盘高,就在底下垫一块示意的键盘,输入条挪到它上面(iPad 上键盘弹起来只缩可见的那块) */
  const reelKbd = (f) => {
    const R = S.reel, kb = f.typing && f.view ? f.view.kb : 0;
    if (kb === R.kb) return;
    R.kb = kb;
    document.body.classList.toggle('kbd', kb > 0);
    document.body.style.setProperty('--rl-kb', kb + 'px');
  };
  /** 发照片屏:开着就盖上,照片用发出去的那张(裁过、圈过的成品;取消了的没有照片),亮着最近用的工具 */
  const reelPs = (f) => {
    const R = S.reel, p = f.photoScreen;
    const key = p ? p.tool + '|' + (p.photo || '') : '';
    if (key === R.psKey) return;
    R.psKey = key;
    psEl.classList.toggle('on', Boolean(p));
    if (!p) return;
    let im = $('#rl-ps-img');
    if (!im) { im = h('img', { id: 'rl-ps-img', alt: '' }); $('#ps .view').append(im); }
    if (p.photo) im.src = '/api/kid/image?p=' + encodeURIComponent(p.photo); else im.removeAttribute('src');
    im.hidden = !p.photo;
    for (const [id, t] of [['#ps-t-crop', 'crop'], ['#ps-t-pen', 'pen'], ['#ps-t-rot', 'rot']]) $(id).classList.toggle('on', p.tool === t);
  };
  /** 孩子自己翻板书:翻到那张卡离板书上沿那么远。拖过进度条时,只认最后一次翻之后板上没再出新东西的(出了新东西孩子端会跟过去) */
  const reelScroll = (f, t) => {
    const R = S.reel, x = f.scroll;
    if (!x || x.at === R.scrollAt) return;
    if (R.scrollAt === undefined) {
      let shownAt = -Infinity;
      for (const tr of R.d.reel.tracks) { if (tr.at <= t) shownAt = Math.max(shownAt, tr.at); for (const c of tr.cards) if (c.at <= t) shownAt = Math.max(shownAt, c.at); }
      if (x.at < shownAt) { R.scrollAt = x.at; return; }
    }
    R.scrollAt = x.at;
    const b = $('#board'), el = b.querySelector(':scope > .sec[data-job="' + x.job + '"] .c[data-card="' + x.card + '"]');
    if (el) b.scrollTop += el.getBoundingClientRect().top - b.getBoundingClientRect().top - x.dy;
  };
  /** 声音:换了一句(或孩子按住说的那一段)就从这一刻的偏移放那个文件 */
  const reelVoice = (f) => {
    const R = S.reel;
    const cur = f.saying ? 's:' + f.saying.job + '/' + f.saying.line : f.clip ? 'c:' + f.clip.kind + ':' + f.clip.job + '/' + f.clip.seek : '';
    if (cur === R.voice) return;
    R.voice = cur;
    silence();
    const x = f.saying || f.clip;
    if (!R.playing || R.seeking || !x || !x.audio) return;
    audioEl.onended = null; audioEl.onerror = null; audioEl.onplaying = null;
    // seek:实时的轮整次通话是一条声音,这句 / 这段在里面从哪开始
    const off = (x.seek || 0) + x.offset;
    audioEl.src = AUDIO + S.tutor.name + '/' + x.audio.split('/').map(encodeURIComponent).join('/') + (off > 300 ? '#t=' + (off / 1000).toFixed(2) : '');
    audioEl.defaultPlaybackRate = R.speed; audioEl.playbackRate = R.speed;
    audioEl.play().catch(() => {});
  };
  /** 录像栏上这一刻的说明(孩子屏幕上没有的):孩子的原声认成了什么、等老师多久、孩子想了多久(只露这两种时长)、切到别处、小课堂停在哪 */
  const reelCaption = (f) => {
    const streak = f.miss ? '⚠ 按住说话连着 ' + f.miss.n + ' 次没发出去' : '';
    if (f.hold) {
      const how = f.hold.phase === 'wait' ? ' · 话筒没开' : f.hold.lv && /^0+$/.test(f.hold.lv) ? ' · 话筒没声音' : '';
      return streak ? { text: streak + ' · 第 ' + f.miss.k + ' 次' + how, cls: 'miss' } : { text: '🎙 孩子按住说话' + how, cls: 'kid' };
    }
    if (streak) return { text: streak, cls: 'miss' };
    if (f.unclear) return { text: '🎙 没发出去:没认出字', cls: 'miss' };
    if (f.typing) return { text: '⌨ 孩子在打字', cls: 'kid' };
    if (f.photoScreen) return { text: '📷 发照片屏' + ({ crop: ' · 在裁剪', pen: ' · 在圈画', rot: ' · 转了一下' }[f.photoScreen.tool] || ''), cls: 'kid' };
    if (f.lecture) return { text: (f.lecture.playing ? '▷ 在看小课堂 ' : '⏸ 小课堂停在 ') + lcClock(f.lecture.pos) + (f.gap ? ' · 停了 ' + reelDuration(f.gap.ms) : ''), cls: f.lecture.playing ? 'line' : 'gap' };
    if (f.clip && f.clip.kind === 'voice') return { text: '🎙 孩子按住说话 · 认成「' + (f.clip.text || '') + '」', cls: 'kid' };
    if (f.clip && f.clip.kind === 'mouth') return { text: '🔊 老师接住:「' + (f.clip.text || '') + '」', cls: 'line' };
    if (f.saying) return { text: '🔊 老师在念', cls: 'line' };
    if (f.wait) return { text: '⏳ 等老师 ' + reelDuration(f.wait.ms), cls: 'gap' };
    if (f.away) return { text: '📴 孩子切到别处了', cls: 'gap' };
    if (f.thinking) return { text: '⏱ 弹窗开着还没动 · 想了 ' + reelDuration(f.thinking.ms), cls: 'gap' };
    if (f.gap) return { text: (f.gap.cont ? '⏩ 又过了 ' : '⏩ 孩子想了 ') + reelDuration(f.gap.ms), cls: 'gap' };
    if (f.stage) return { text: '弹窗开着', cls: 'gap' };
    if (f.asking) return { text: '⏸ 停下等孩子', cls: 'gap' };
    return { text: '', cls: '' };
  };
  /** 看小课堂的那一段(第 5 步):舞台包的播放器跟着录像的时钟(follow) */
  const reelLecture = (f) => {
    const R = S.reel, x = f.lecture;
    if (!x) { if (R.lc) { R.lc = null; hideLecture(); } return; }
    if (!R.lc || R.lc !== x.job) { R.lc = x.job; openLecture({ bundle: x.bundle, title: x.title, follow: true, ...(x.video ? { video: true } : {}) }); }
    const msg = { type: 'follow', ms: x.pos, playing: x.playing && R.playing && !R.seeking, rate: R.speed, marks: x.marks.map((k) => ({ atMs: k.atMs, svgMs: k.svgMs, strokes: k.strokes, ...(k.image ? { image: k.image } : {}) })) };
    if (lcShowing) lcShowing.followMsg = msg;
    lcPost(msg);
  };
  const reelTick = () => {
    const R = S.reel; if (!R) return;
    const now = performance.now();
    if (R.playing && !R.seeking) R.p = Math.min(R.clock.total, R.p + (now - R.last) * R.speed);
    R.last = now;
    const t = R.clock.toWall(R.p);
    const f = reelFrameAt(R.d.reel, t);
    R.f = f; R.t = t;
    reelDraw(f); reelScroll(f, t); reelKidSub(f, t); reelLiveCap(f, t); reelHold(f); reelInput(f); reelKbd(f); reelPs(f); reelVoice(f); reelLecture(f);
    if (R.playing && R.p >= R.clock.total) reelPlay(false);
  };
  const reelPlay = (on) => {
    const R = S.reel; if (!R) return;
    if (on && R.p >= R.clock.total) R.p = 0;
    if (on) R.follow = true;
    R.playing = on; R.last = performance.now(); R.voice = null;
    clearInterval(R.timer); R.timer = on ? setInterval(reelTick, 100) : null;
    reelTick();
  };
  const reelSeek = (p) => { const R = S.reel; if (!R) return; R.seeking = false; R.p = Math.max(0, Math.min(R.clock.total, p)); R.last = performance.now(); R.voice = null; R.follow = true; R.scrollAt = undefined; reelTick(); };
  /** 今天的话题:停在最后、或放到了最后时,隔 5 秒重拿一次轨道;老师写了新的、孩子又说了,接上并停在新的最后 */
  const reelGrow = async () => {
    const R = S.reel; if (!R || R.seeking || document.hidden) return;
    const atEnd = R.p >= R.clock.total - 300;
    if (!atEnd) return;
    let d = null;
    try { d = await api('GET', '/api/conversations/' + encodeURIComponent(S.tutor.name) + '/' + encodeURIComponent(R.d.date) + '/threads/' + encodeURIComponent(R.d.thread) + '/reel'); } catch {}
    if (!d || S.reel !== R || R.seeking || R.p < R.clock.total - 300) return;
    const grew = d.reel.endAt !== R.d.reel.endAt || d.kid.length !== R.d.kid.length || JSON.stringify(d.kid.map((m) => [m.job, m.result])) !== JSON.stringify(R.d.kid.map((m) => [m.job, m.result]));
    if (!grew) return;
    R.d = d; R.entries = sectionsFromMessages(d.kid); R.said = kidSaid(d.kid); R.key = '';
    R.clock = reelClock(d.reel, R.real); R.p = R.clock.total; R.follow = true;
    if (!d.live) { clearInterval(R.liveTimer); R.liveTimer = 0; }
    reelTick();
  };
  /** 孩子屏幕的把手:录像栏只经它说话(家长页上隔着 iframe 直接调) */
  const reelApi = {
    get: () => { const R = S.reel; if (!R) return null; return { p: R.p, total: R.clock.total, wall: R.t || R.clock.toWall(R.p), playing: R.playing, speed: R.speed, real: R.real, cap: R.f ? reelCaption(R.f) : { text: '', cls: '' }, size: R.f && R.f.view ? [R.f.view.w, R.f.view.h] : R.size, stale: R.d.reel.views.some((v) => v.v && v.v !== PAGE_V) }; },
    marks: () => { const R = S.reel; return R ? R.d.reel.marks.map((m) => ({ kind: m.kind, label: m.label, at: m.at, p: R.clock.toPlay(m.at), ...(m.to ? { pTo: R.clock.toPlay(m.to) } : {}) })) : []; },
    play: (on) => reelPlay(on),
    seek: (p) => reelSeek(p),
    speeds: REEL_SPEEDS,
    /** 章:孩子每开口一次是一轮 */
    chapters: () => {
      const R = S.reel; if (!R) return [];
      const rl = R.d.reel, said = rl.marks.filter((m) => m.kind === 'said');
      // 章尾:下一章的前奏(按住说话、打字、发照片屏)开始之前;上一章 / 下一章落在这里
      const ends = reelChapterEnds(said.map((m) => m.at), [...rl.holds, ...rl.types, ...rl.photoScreens], rl.endAt);
      return said.map((m, i) => ({ p: R.clock.toPlay(m.at), end: R.clock.toPlay(ends[i]), title: '第 ' + (i + 1) + ' 轮' }));
    },
    /** 这个话题的经过(录像栏展开后的列表):孩子做的每件事、等了多久、给家长的,一条一行,按时间排 */
    events: () => {
      const R = S.reel; if (!R) return [];
      const rl = R.d.reel, out = [];
      const add = (at, kind, chip, text) => { if (Number.isFinite(at)) out.push({ at, p: R.clock.toPlay(at), kind, chip, text }); };
      const msgOf = (job) => R.d.messages.find((m) => m.job === job);
      const took = (t) => (!t ? '' : [t.think !== null ? '想了 ' + reelDuration(t.think) : '', t.changes > 1 ? '改过 ' + (t.changes - 1) + ' 次' : ''].filter(Boolean).map((x) => ' · ' + x).join(''));
      for (const m of rl.marks) {
        if (m.kind === 'said') { const pm = msgOf(m.job); add(m.at, 'said', pm && pm.via ? '首页' : pm && pm.from === 'system' ? '系统' : '孩子', m.label); if (pm && pm.cards && pm.cards.length) add(m.at + 1, 'card', '做了', pm.cards.map((c) => c.text + took(c.took)).join(';')); }
        else if (m.kind === 'ask') add(m.at, 'wait', '等孩子', m.label);
        else if (m.kind === 'error') add(m.at, 'err', '没成', m.label);
        else if (m.kind === 'lecture' || m.kind === 'ink') add(m.at, 'card', '小课堂', m.label);
        else if (m.kind === 'miss') add(m.at, 'miss', '没发出去', m.label.replace('按住说话没发出去 · ', '按住说话 · '));
        else if (m.kind === 'misses') add(m.at - 1, 'miss', '⚠ 连着', m.label);
      }
      for (const w of rl.waits) if (w.to - w.from >= 3000) add(w.from + 1, 'wait', '等老师', reelDuration(w.to - w.from));
      for (const g of rl.gaps) if (g.kind === 'think') add(g.from, 'wait', g.cont ? '又过了' : '孩子想了', reelDuration(g.ms));
      for (const x of rl.stages) { const e = R.entries.find((y) => y.job === x.job); const c = e && e.cards[x.card]; add(x.from, 'card', '弹窗', (c ? cardTitle(c) : '一张卡') + ' · 开了 ' + reelDuration(x.to - x.from)); }
      for (const x of rl.types) add(x.from, 'said', '打字', (x.vals.length ? x.vals[x.vals.length - 1].v : '') + (x.sent ? '' : ' · 没发'));
      for (const x of rl.photoScreens) add(x.from, 'said', '拍照', x.sent ? '发了照片' : '打开又取消了');
      // 节尾的旁注(给家长的、记住了):原来插在板书里,现在在这里
      for (const n of rl.notes) {
        const pm = msgOf(n.job); if (!pm) continue;
        if (pm.parentText) add(n.postAt, 'tail', '给家长', pm.parentText.replace('## 家长', '').trim());
        if (pm.remembered && pm.remembered.length) add(n.postAt, 'tail', '记住了', pm.remembered.join(';'));
      }
      // 家长板书页别的旁注:答案、画图给家长的、小课堂里画的那段话、提醒;记账与整理记忆那两轮不进录像,记在最后
      for (const pm of R.d.messages) {
        const tr = rl.tracks.find((x) => x.job === pm.job), nt = rl.notes.find((x) => x.job === pm.job);
        const own = reelParse(pm.timing && pm.timing.startedAt), at0 = nt ? nt.at : tr ? tr.at : Math.min(rl.endAt, Number.isNaN(own) ? rl.endAt : own);
        const post = nt ? nt.postAt : tr ? tr.doneAt : at0;
        const cards = (pm.section && pm.section.cards) || [];
        const ans = cards.map((c) => { const a = reelAnswer(c); return a ? cardTitle(c) + ':' + a : ''; }).filter(Boolean);
        if (ans.length && tr) add(tr.at + 1, 'card', '答案', ans.join(';'));
        for (const c of cards) {
          if (c.kind === 'paint' && c.props && c.props.note) add(tr ? tr.at + 2 : at0, 'tail', '画图', c.props.note);
        }
        const lec = rl.lectures.find((x) => x.job === pm.job);
        ((pm.lecture && pm.lecture.marks) || []).forEach((mk, k) => add(lec && lec.marks[k] ? lec.marks[k].at + 1 : at0, 'card', '画的', lcClock(mk.atMs) + ' · ' + (mk.text || '(课读不出来,没给老师那段话)')));
        if (pm.warnings && pm.warnings.length) add(post + 2, 'err', '提醒', pm.warnings.join(';'));
        if (pm.bookkeep) add(Math.min(rl.endAt, at0), 'tail', '记账', pm.pending ? '记账中' : pm.error ? '记账没成:' + pm.error : '已记进日记');
        if ((pm.bookkeep || pm.tidy) && pm.remembered && pm.remembered.length) add(Math.min(rl.endAt, at0) + 1, 'tail', pm.tidy ? '整理了记忆' : '记住了', pm.remembered.join(';'));
      }
      return out.sort((a, b) => a.at - b.at);
    },
    /** 跳到墙钟的某一刻(调试、探针) */
    seekAt: (w) => { const R = S.reel; if (R) reelSeek(R.clock.toPlay(w)); },
    /** 拖着进度条:不出声,画面跟着;松手走 seek */
    drag: (p) => { const R = S.reel; if (!R) return; R.seeking = true; R.p = Math.max(0, Math.min(R.clock.total, p)); R.voice = null; R.follow = true; R.scrollAt = undefined; reelTick(); },
    real: (on) => { const R = S.reel; if (!R) return; R.real = on; reelSetClock(); R.voice = null; reelTick(); },
    speed: (x) => { const R = S.reel; if (!R) return; R.speed = x; audioEl.defaultPlaybackRate = x; audioEl.playbackRate = x; },
    stop: () => reelStop(),
  };
  /** 孩子的屏幕开起来:要 /reel 的数据,孩子端的样子铺好(只读、点不动),停在开头;家长页在等就把把手交过去 */
  const reelBoot = async () => {
    const tutor = debug.get('tutor') || '', date = debug.get('date') || 'today', thread = debug.get('thread') || '';
    let host = null; try { if (window.parent !== window && typeof window.parent.cotutorReelReady === 'function') host = window.parent; } catch {}
    let d = null;
    try { d = await api('GET', '/api/conversations/' + encodeURIComponent(tutor) + '/' + encodeURIComponent(date) + '/threads/' + encodeURIComponent(thread) + '/reel'); } catch {}
    if (!d) { if (host) { try { host.cotutorReelFail(); } catch {} } else document.body.append(h('div', { class: 'blank' }, h('b', {}, '这个话题没有录像'))); return; }
    document.body.classList.add('rlk');
    S.tutor = d.face; S.thread = d.thread; S.hist = d.date; S.readonly = true;
    $('#sub-av').replaceWith(Object.assign(avatarEl(S.tutor), { id: 'sub-av' })); tintBack(S.tutor); markBoard($('#bmark'), S.tutor);
    // 有实时轮的话题:孩子当时看到的是实时老师页(左栏大头像 + 字幕、卡角没有钮),字幕照这一刻(reelLiveCap)
    if (d.realtime) { document.body.classList.add('live'); $('#tutor').style.setProperty('--tc', colorOf(d.face)); $('#lv-av').replaceChildren(avatarEl(S.tutor)); VB.btn.avatar(avatarEl(S.tutor)); VB.btn.color(colorOf(d.face)); }
    $('#tutor').classList.add('on');
    renderBar(); setBar('idle');
    const v0 = d.reel.views[0];
    // 示意的键盘(打字时垫在底下):三排字母一排空格,不画真键盘
    document.body.append(h('div', { id: 'rl-kbd' }, ...['qwertyuiop', 'asdfghjkl', 'zxcvbnm', ' '].map((r) => h('div', { class: 'r' }, ...[...r].map((k) => h('span', { class: k === ' ' ? 'sp' : '' }, k === ' ' ? '拼音' : k))))));
    S.reel = { d, entries: sectionsFromMessages(d.kid), said: kidSaid(d.kid), size: v0 ? [v0.w, v0.h] : REEL_SIZES[d.device] || REEL_SIZES['tablet-landscape'], barsH: holdBars.map((b) => b.style.height), kb: 0, inKey: '', psKey: '', scrollAt: undefined, real: false, speed: 1, p: 0, playing: false, seeking: false, last: 0, key: '', painted: {}, now: '', voice: null, timer: null, clock: null, seen: 0, follow: false, pend: null, subKey: '', hold: null, f: null, t: 0, realtime: Boolean(d.realtime), cap: null, capOf: null, capKey: '' };
    reelSetClock();
    // ?at=时:分:秒 停在那一刻(调试、截图);那天的日期从录像起点取
    const at = /^(\\d{1,2}):(\\d{2})(?::(\\d{2}))?$/.exec(debug.get('at') || '');
    if (at) { const d0 = new Date(d.reel.startAt); d0.setHours(Number(at[1]), Number(at[2]), Number(at[3] || 0), 0); S.reel.p = Math.max(0, Math.min(S.reel.clock.total, S.reel.clock.toPlay(d0.getTime()))); S.reel.follow = true; }
    // ?end=1 停在最后一帧(家长从记录点进来:最后一帧信息最多,要看过程往前拖)
    else if (debug.get('end')) { S.reel.p = S.reel.clock.total; S.reel.follow = true; }
    // 孩子的屏幕点不动,只能上下翻:点、按在捕获阶段挡掉(滚动不受影响)
    for (const k of ['click', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu']) document.addEventListener(k, (e) => { if (e.target.closest && e.target.closest('#reel')) return; e.stopPropagation(); if (k !== 'pointerdown' && k !== 'pointerup') e.preventDefault(); }, true);
    if (d.live) S.reel.liveTimer = setInterval(reelGrow, 5000);
    renderHeader();
    reelTick();
    window.cotutorReel = reelApi;
    if (host) host.cotutorReelReady(reelApi, { size: S.reel.size });
    // 焦点在孩子的屏幕里时按键也认:交给外面的录像栏,它认了就不让这一页再处理
    if (host) document.addEventListener('keydown', (e) => { try { if (host.cotutorReelKey && host.cotutorReelKey({ key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey })) e.preventDefault(); } catch {} });
    else reelDock.open(reelApi, { toast });
  };

__REEL_DOCK_JS__
  /** 只收拾录像自己的东西(关老师页时也调);不重开话题 */
  const reelStop = () => {
    if (!S.reel) return;
    const R = S.reel; clearInterval(R.timer); clearInterval(R.liveTimer); S.reel = null; silence(); if (S.stage) closeStage(); if (R.lc) hideLecture();
  };

  // ---- 输入条:相机 | 发消息或按住说话 | 加号 ----
  $('#cam').insertAdjacentHTML('afterbegin', ICON.camera);
  $('#plus').innerHTML = ICON.plus;
  $('#go').innerHTML = ICON.send;
  $('#ic-album').innerHTML = ICON.album; $('#ic-cam2').innerHTML = ICON.cameraLg;
  const setBar = (mode) => {
    if (mode === 'typing' && S.bar !== 'typing') typeRec('focus');
    else if (mode !== 'typing' && S.bar === 'typing') typeRec('blur');
    S.bar = mode; avListen();
    $('#ph').hidden = mode === 'typing'; $('#typed').hidden = mode !== 'typing'; $('#go').hidden = mode !== 'typing';
    $('#hold').classList.toggle('on', mode === 'holding');
    // 平板横屏实时:输入条平时收着,打字时贴着软键盘上沿出来(先露出来才 focus 得上)
    document.body.classList.toggle('typing', mode === 'typing');
    if (mode === 'typing') $('#typed').focus();
  };
  /** 软键盘的高(--kb):打字时输入条贴着它上沿;visualViewport 没有就当 0 */
  const kbSync = () => { const vv = window.visualViewport; const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0; document.documentElement.style.setProperty('--kb', kb + 'px'); };
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', kbSync); window.visualViewport.addEventListener('scroll', kbSync); }
  const mid = $('#mid'), typed = $('#typed');
  $('#go').addEventListener('click', () => { const t = typed.value; typeHeard.put(t); typeRec('send'); typed.value = ''; setBar(barNext(S.bar, 'sent')); send(t); });
  typed.addEventListener('input', () => typeHeard.put(typed.value));
  typed.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#go').click(); } });
  typed.addEventListener('blur', () => { if (!typed.value.trim()) setBar(barNext(S.bar, 'blur')); });
  $('#plus').addEventListener('click', () => $('#sheet').classList.add('on'));
  $('#sheet .dimmer').addEventListener('click', () => $('#sheet').classList.remove('on'));
  $('#hold .w').replaceChildren(...[6, 10, 16, 22, 12, 26, 18, 8, 14, 24, 20, 10, 16, 28, 12, 8, 18, 22, 10, 14, 6, 12, 20, 16, 8].map((v, i) => h('i', { style: 'height:' + v + 'px;animation-delay:' + (i * 37 % 400) + 'ms' })));

  // 中间那段:点 = 打字;实时老师页上按住 150ms = 说话(推给嘴),松手发,上滑 60px 取消。浏览器识别 2026-10-22 删了(经验归档在本机 docs/archive/浏览器识别@2026-10-22/)
  const PH_IDLE = () => (LV.on && LV.model.open ? (LV.model.muted ? '麦关了,点右边的麦克风再听' : '我在听,直接说就行…') : '发消息或按住说话…');
  /** 输入条上是空闲那句就按现在的重写(实时连上、一直听开关),「没听清」那几秒不动 */
  const phIdle = () => { const ph = $('#ph'); if (ph && /^(发消息|我在听|麦关了)/.test(ph.textContent)) ph.textContent = PH_IDLE(); };
  $('#ph').textContent = PH_IDLE();
  let press = null;
  // 麦克风常开(真机诊断 2026-09-19)。这台 iPad 上的三条事实:
  // ① Safari 的识别每次自己开关话筒,常交来一路纯静音,一个字不出、一停就 aborted;页面自己先 getUserMedia 留一路,识别再起就有声(先麦克风、后识别)
  // ② 麦克风关了再开,也常开到哑的 → 开了就不关(只有页面退到后台才放,那时系统本来也会掐);开完自检 600ms,纯 0 就拆掉重开,最多 3 回
  // ③ 冷开要 1 秒多,这段时间说的字进不去 → 给过权限之后,进老师页就先开好(micWarm)
  // 这一路画音量条。每次开麦克风也记一行诊断(where: 'mic')
  const mic = { stream: null, ac: null, an: null, buf: null, opening: null, ok: true };
  const micLive = () => { const t = mic.stream && mic.stream.getAudioTracks()[0]; return Boolean(t && t.readyState === 'live' && !t.muted && mic.ok); };
  /** 实时开着时,麦克风的自检(分析器)也开在实时那个 AudioContext 里,页面上只有一个 AudioContext(口语课一直只用一个)。
   *  2026-10-19 真机:实时页切到后台再回来,实时那个 AudioContext 还留着,之后每次开麦克风自检都读到 0(dead),按住说的话发不出去。
   *  所以实时那个切后台、离开实时就关(liveAudioDrop),回来先起一个新的再开麦克风(liveCtxEnsure) */
  const liveCtx = () => (LV.on && LV.audio && LV.audio.ctx) || null;
  const liveCtxEnsure = () => { if (!LV.on || !LV.audio) return null; if (!LV.audio.ctx) LV.audio.wake().catch(() => {}); return LV.audio.ctx; };
  const micDrop = () => { if (mic.stream) { for (const t of mic.stream.getTracks()) t.stop(); } if (mic.ac && mic.ac !== liveCtx()) { try { mic.ac.close(); } catch {} } mic.stream = mic.ac = mic.an = mic.buf = null; };
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
    // 一直听靠设备的回声消除:开没开记进诊断(getUserMedia 要的是缺省,两家浏览器缺省都开,真开了没有看这里)
    try { const s0 = st.getAudioTracks()[0].getSettings(); mic.aec = s0.echoCancellation; } catch { mic.aec = undefined; }
    try { localStorage.setItem('kid-mic-ok', '1'); } catch {}
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      mic.ac = liveCtxEnsure() || new AC(); mic.an = mic.ac.createAnalyser(); mic.an.fftSize = 512; mic.buf = new Float32Array(512);
      mic.ac.createMediaStreamSource(st).connect(mic.an);
      // 实时那个可能是不在点击里起的(切后台回来):Safari 的 resume() 要等到下一次点击才回,这里等它麦克风就一直「在开」,按住说的全发不出去。
      // 不等:没跑起来时自检本来就跳过(micProbe),下一次点击 wake() 会让它跑起来
      if (mic.ac.state === 'suspended') { const r = mic.ac.resume().catch(() => {}); if (mic.ac !== liveCtx()) await r; }
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
        await micOpenOnce(); mark('open'); mark('aec', String(mic.aec));
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
    if (!ok || !LV.on || !S.tutor || !canSend() || document.hidden || micLive()) return;
    micOpen().catch(() => {});
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (!mic.opening) micDrop(); } else micWarm(); });
  document.addEventListener('pointerdown', micWarm, true);
  document.addEventListener('touchstart', () => {}, { passive: true }); // iOS Safari:没有触摸监听时 :active 不一定触发,按压反馈靠它
  // 按住时那行字:话筒还没开 → 等一下(这时说的话进不去);开了 → 松手发送
  const hold = { audio: false };
  const renderHold = () => {
    $('#hold').classList.toggle('wait', !hold.audio);
    $('#hold span').textContent = press && press.cancelled ? '松手取消' : hold.audio ? '松手发送,上移取消' : '等一下…';
    voiceSync();
  };
  let phTimer = 0;
  // 真音量:25 根条往左滚;没有麦克风那一路(老浏览器、没授权)就还是原来的假波形
  const holdBars = [...document.querySelectorAll('#hold .w i')], holdLv = new Array(25).fill(0);
  const holdLevel = (v) => { holdLvRec(v); $('#hold').classList.add('real'); holdLv.shift(); holdLv.push(v); for (let i = 0; i < 25; i++) holdBars[i].style.height = Math.round(4 + holdLv[i] * 24) + 'px'; };
  // ---- 实时的老师:嘴是 realtime,讲稿由它照念,声音从 WebSocket /api/live/<老师>/ws 下来,
  //      孩子端不念讲稿(板书的 step 照旧收事件、只是不自动念);卡照旧从「今天」拉,闭合了就铺。谁出声、谁停走 liveDispatch → liveStep(live-board.ts),
  //      这里只照单执行。按住说话推 PCM(常开那路麦克风,makeAudio().use);连不上、断了 → 回到「正在叫老师」,过一会儿再连 ----
  /** 这次进老师页走不走实时:孩子端今天能说话的话题都走;以前的、家长端、录像、预览不走(只看) */
  const liveWanted = (t) => Boolean(t) && !REEL && !PREVIEW && !S.readonly;
  const lvSend = (o) => { if (LV.ws && LV.ws.readyState === 1) LV.ws.send(JSON.stringify(o)); };
  /** 实时时改「谁出声」的事都走这里,页面里不许再直接改 LV.model(tests/live-player.test.ts 数着)。data = release / send 的 body、audio 的那块声音 */
  const liveDispatch = (ev, data) => {
    const r = liveStep(LV.model, ev);
    LV.model = r.model;
    for (const f of r.effects) {
      switch (f.kind) {
        case 'hold': LV.playLine = null; LV.endLine = null; lvSend({ t: 'hold' }); break;
        case 'release': lvSend({ t: 'release', body: data, ...(LV.chatNext ? { chat: LV.chatNext } : {}) }); break;
        case 'hush': lvSend({ t: 'hush' }); break;
        case 'send': lvSend({ t: 'send', body: data }); break;
        case 'enqueue': if (LV.audio) LV.audio.play(data); liveDrainWatch(); break;
        case 'flush': LV.playLine = null; LV.endLine = null; if (LV.audio) LV.audio.flush(); break;
        case 'stopCard': silence(); break;
        case 'openLecture': liveLecture(); break;
        // 小课堂那一段停下:舞台停在那一帧,不再算讲稿委托的(放完 / 关了不再回 staged)
        case 'stopLecture': if (S.stage && S.stage.delegate) { S.stage.delegate = false; postStage({ type: 'control', action: 'pause' }); } break;
        case 'staged': lvSend({ t: 'staged' }); break;
        // 连不上、断了:不回板书,回到「正在叫老师」,过一会儿再连;排着的那条(开场、打字)连上再发
        case 'retry': liveRetry(); break;
        case 'render': renderSubtitle(); break;
        case 'listen': lvSend({ t: 'listen', open: LV.model.open }); break;
        case 'gate': liveGateSync(); break;
        case 'duck': case 'unduck': if (LV.audio) LV.audio.duck(f.kind === 'duck' ? 0.3 : 1); break;
        case 'ring': liveRing(); break;
        case 'stopRing': liveRingStop(); break;
        case 'playReplay': replayPlay(); break;
        case 'stopReplay': replayStop(); break;
      }
    }
    return r.effects;
  };
  /** 口语课 [[call]] 那句放完:孩子端自己响铃(440 + 480 赫兹,响两下停两秒,最多 15 秒),头像晃;嘴一出声铃停(liveStep) */
  const RING_MAX_MS = 15000;
  const liveRing = () => {
    liveRingStop();
    LV.ringEnd = setTimeout(() => { liveRingStop(); if (LV.model.status === 'ring') liveDispatch({ type: 'ringEnd' }); }, RING_MAX_MS);
    const ac = LV.audio && LV.audio.ctx;
    if (!ac) return;
    try {
      const g = ac.createGain(); g.gain.value = 0; g.connect(ac.destination);
      const o1 = ac.createOscillator(), o2 = ac.createOscillator();
      o1.frequency.value = 440; o2.frequency.value = 480; o1.connect(g); o2.connect(g);
      const t0 = ac.currentTime + 0.05;
      for (let b = t0; b < t0 + RING_MAX_MS / 1000; b += 3) for (const [a, d] of [[0, 0.4], [0.6, 0.4]]) { g.gain.setValueAtTime(0.06, b + a); g.gain.setValueAtTime(0, b + a + d); }
      o1.start(t0); o2.start(t0);
      LV.ring = { o1, o2, g };
    } catch {}
  };
  const liveRingStop = () => {
    clearTimeout(LV.ringEnd);
    const r = LV.ring; LV.ring = null;
    if (r) { try { r.o1.stop(); r.o2.stop(); r.g.disconnect(); } catch {} }
  };
  /** 热身那拍(讲稿 [[echo]] / [[say]])锚的卡:板上的那个元素;节还没拉到 → null */
  const liveLineCard = (l) => {
    const i = S.sections.findIndex((x) => x.job === l.job);
    const ln = i >= 0 ? S.sections[i].lines[l.line] : null;
    const k = ln ? lineTarget(ln) : null;
    return k === null ? null : $('#board').querySelector('[data-sec="' + i + '"] [data-card="' + k + '"]');
  };
  /** 轮到孩子跟:那张卡亮着(liveStep 的 turn);在听你说时光变实 */
  const liveTurnUi = () => {
    const el = LV.on && LV.model.turn && LV.endLine && LV.endLine.echo ? liveLineCard(LV.endLine) : null;
    for (const x of document.querySelectorAll('#board .c.lv-turn')) if (x !== el) x.classList.remove('lv-turn', 'hear');
    if (el) { el.classList.add('lv-turn'); el.classList.toggle('hear', LV.model.hearing); }
  };
  /** 嘴在说时每 150 毫秒看一眼孩子端的队列放完没有 */
  const liveDrainWatch = () => {
    if (LV.drain) return;
    LV.drain = setInterval(() => {
      if (LV.model.status === 'mouth' && LV.audio && LV.audio.playing()) return;
      clearInterval(LV.drain); LV.drain = 0;
      if (LV.model.status === 'mouth') liveDispatch({ type: 'drained', ...(LV.playLine ? { play: livePlayable(LV.playLine) ? 'open' : 'skip' } : LV.endLine && LV.endLine.echo ? { echo: true } : LV.endLine && LV.endLine.call ? { call: true } : {}) });
    }, 150);
  };
  /** 卡上的声音(点读、单词、示范、回放)要响:实时时问 liveStep(嘴在说、孩子按着、在录都不响);不是实时(家长端、只读)先停别的声音 */
  const cardSoundOk = () => {
    if (LV.on) return liveDispatch({ type: 'cardTap' }).some((f) => f.kind === 'playCard');
    dispatch({ type: 'halt' });
    return true;
  };
  for (const k of ['ended', 'error']) audioEl.addEventListener(k, () => { if (LV.on && LV.model.status === 'card') liveDispatch({ type: 'cardEnded' }); });
  /** 字幕:在说的那句、上一句;被打断的那句淡、加省略号;什么都还没说写老师的名字;到了上限写上限那句 */
  /** 一直听的样子:输入条里的麦克风(关着 / 在听你说)、左栏「在听你说」、输入条上那句 */
  const liveListenUi = () => {
    const open = LV.on && LV.model.open;
    document.body.classList.toggle('lv-open', open);
    const m = $('#lv-mic'); m.innerHTML = LV.model.muted ? ICON.micOff : ICON.micMd; m.classList.toggle('off', LV.model.muted); m.classList.toggle('hear', open && LV.model.hearing); m.setAttribute('aria-label', LV.model.muted ? '开麦' : '关麦');
    voiceSync();
    avListen();
    phIdle();
  };
  /** 这一刻的状态凑成 VoiceIn(voice-view.ts);录像里孩子的屏幕照录像这一刻(没有一直听、嘴的音量取不到——老师的弧只按最低深浅画) */
  const voiceNow = () => {
    if (!LV.on) {
      const rh = VB.reelHold;
      return voiceIn({ status: rh ? 'holding' : VB.reelSpeak ? 'mouth' : 'quiet', pending: S.pending, holdAudio: Boolean(rh && rh.phase !== 'wait'), cancel: Boolean(rh && rh.slide) });
    }
    const m = LV.model, holding = m.status === 'holding';
    return voiceIn({ status: m.status, open: m.open, hearing: m.hearing, ducked: m.ducked, muted: m.muted, turn: m.turn, pending: S.pending, photo: VB.photo, ready: LV.ready, choose: choosing(), holdAudio: holding && hold.audio, cancel: holding && Boolean(press && press.cancelled), silentMs: holding && hold.audio ? Date.now() - Math.max(VB.loudAt, LV.holdAt) : 0, hint: VB.hint });
  };
  /** 按钮换成这一刻的样子;手机那颗小头像(#lv-av)的动作跟同一份。按着没声音满 3 秒要换小字:到点再来一次 */
  function voiceSync() {
    if (!liveLook()) return;
    if (!S.pending) VB.photo = false;
    const side = document.body.classList.contains('hand-left') ? 'right' : 'left';
    if (VB.side !== side) { VB.side = side; VB.btn.side(side); }
    const v = voiceView(voiceNow());
    VB.btn.set(v);
    voiceFace($('#lv-av'), v.face);
    clearTimeout(VB.silentT);
    if (v.key === 'hold') { const left = VOICE_SILENT_MS - (Date.now() - Math.max(VB.loudAt, LV.holdAt)); if (left > 0) VB.silentT = setTimeout(voiceSync, left + 30); }
  }
  /** 刚才那一下的提示:按钮晃一下(每按一次都晃)、字留 2 秒;ph = 手机、板书模式输入条上那行字 */
  const voiceHint = (k, ph) => {
    VB.hint = k; clearTimeout(VB.hintT); VB.hintT = setTimeout(() => { VB.hint = ''; voiceSync(); }, 2000);
    voiceSync();
    VB.btn.shake();
    if (ph) { $('#ph').textContent = ph; clearTimeout(phTimer); phTimer = setTimeout(() => { $('#ph').textContent = PH_IDLE(); }, 2000); }
  };
  /** 实时老师页按了按住说话却不接的那几下记一笔 voice-diag(where: busy):看一晚碰到几次、等了多久;st = 嘴那时的状态,还没连上记 connecting */
  const busyDiag = (st) => {
    const row = { where: 'busy', tutor: S.tutor ? S.tutor.name : null, live: LV.on, st, waited: S.waitSince ? Date.now() - S.waitSince : null, ua: navigator.userAgent };
    try { fetch('/api/kid/voice-diag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row), keepalive: true }).catch(() => {}); } catch {}
  };
  /** 老师在想(脑在写、嘴没在说;板书模式是老师在想)时按了按住说话:不接,但要让孩子知道——10-20 晚孩子几次想打断按不动,那时这块关着 pointer-events,按了什么都不发生 */
  const busyHint = () => { voiceHint('busy', '老师在想,等一下再说'); busyDiag(LV.model.status); };
  /** 嘴还没连上(刚进老师页、换连接、断了在重连)时按了:不接,说一声 */
  const connectingHint = () => { voiceHint('connecting', '正在叫老师,等一下'); busyDiag('connecting'); };
  /** 孩子刚说的那句(平板横屏左栏,字幕上面):节头不再是孩子的话,他说了什么在这里看;老师开口了(或这一轮写完了)变淡,下次说话换掉 */
  const lvKid = () => {
    const el = $('#lv-kid');
    const last = S.sections[S.sections.length - 1];
    const p = S.pendSaid ? { job: S.pendSaid.job, sd: S.pendSaid.said } : last && last.live && last.said ? { job: last.job, sd: last.said } : null;
    if (!p || !p.sd || !p.sd.text) { if (el.firstChild) el.replaceChildren(); delete el.dataset.k; return; }
    const old = LV.heard.has(p.job) || !S.pending;
    const key = p.job + '|' + p.sd.text;
    if (el.dataset.k !== key) { el.dataset.k = key; el.replaceChildren(h('span', { class: 'tx' }, p.sd.text)); }
    el.classList.toggle('old', old);
  };
  // ---- 字幕重放:这一轮老师说的,从第一句放(家长的用法是「老师刚讲过了」);声音是服务端留的那份嘴的声音
  //      (孩子按下时清掉、没放出来的也在),没有(以前的轮、mock 以外没念过)就不露。谁让谁在 liveStep;这里只取、放、让字幕跟着走 ----
  const RP = { job: null, data: null, miss: false, loading: false, el: null, timer: 0, line: -1 };
  /** 这一轮:板上最后一节实时的、有讲稿的 */
  const replaySec = () => { for (let i = S.sections.length - 1; i >= 0; i--) { const s = S.sections[i]; if (s.live && s.lines.length) return s; } return null; };
  const replayUi = () => {
    const b = $('#lv-replay');
    const s = LV.on ? replaySec() : null;
    if (s && RP.job !== s.job && LV.model.status !== 'replay') { RP.job = s.job; RP.data = null; RP.miss = false; }
    const playing = LV.on && LV.model.status === 'replay';
    const quiet = LV.on && LV.model.status === 'quiet' && !S.pending && !S.readonly;
    if (quiet && s && !RP.data && !RP.miss && !RP.loading && S.day && S.tutor) {
      RP.loading = true;
      const job = s.job;
      api('GET', '/api/kid/conversations/' + S.tutor.name + '/mouth/' + S.day.date + '/' + job).then((d) => { RP.loading = false; if (RP.job === job && d && d.audio && Array.isArray(d.lines) && d.lines.length) { RP.data = d; renderSubtitle(); } else if (RP.job === job) RP.miss = true; }, () => { RP.loading = false; if (RP.job === job) RP.miss = true; });
    }
    const show = playing || (quiet && Boolean(RP.data));
    b.hidden = !show;
    if (!show) return;
    const key = playing ? 'stop' : 'again';
    if (b.dataset.k !== key) { b.dataset.k = key; b.querySelector('.ic').innerHTML = playing ? ICON.stop : ICON.again; b.querySelector('.tx').textContent = playing ? '停' : '再听一遍'; b.setAttribute('aria-label', playing ? '停,不听了' : '再听一遍老师这一轮说的'); }
    b.classList.toggle('stop', playing);
  };
  /** 放:从第一句的起点往前让 200 毫秒(段里的起点按字数摊,差一点);字幕跟着 lines[].ms 走;放完告诉 liveStep */
  const replayPlay = () => {
    const d = RP.data;
    if (!d) { setTimeout(() => liveDispatch({ type: 'replayEnded' }), 0); return; }
    const a = RP.el || (RP.el = new Audio());
    const from = Math.max(0, d.lines[0].ms - 200);
    a.onended = () => { clearInterval(RP.timer); RP.line = -1; if (LV.model.status === 'replay') liveDispatch({ type: 'replayEnded' }); };
    a.src = d.audio + (from ? '#t=' + (from / 1000).toFixed(2) : '');
    RP.line = 0;
    const p = a.play(); if (p && p.catch) p.catch(() => { if (LV.model.status === 'replay') liveDispatch({ type: 'replayEnded' }); });
    clearInterval(RP.timer);
    RP.timer = setInterval(() => { const t = a.currentTime * 1000; let k = 0; for (let j = 0; j < d.lines.length; j++) if (d.lines[j].ms <= t + 150) k = j; if (k !== RP.line) { RP.line = k; renderSubtitle(); } }, 120);
    renderSubtitle();
  };
  const replayStop = () => { clearInterval(RP.timer); RP.line = -1; if (RP.el) { RP.el.onended = null; RP.el.pause(); } renderSubtitle(); };
  $('#lv-replay').addEventListener('click', () => { if (!LV.on) return; unlock(); liveDispatch(LV.model.status === 'replay' ? { type: 'replayStop' } : { type: 'replay', pending: S.pending }); });
  const liveCaption = () => {
    liveListenUi();
    liveTurnUi();
    lvKid();
    replayUi();
    // 在重放:上面一行「再听一遍 · 第 n 句,共 m 句」,在说那句前面一个小喇叭;头像不动(不是嘴在说)
    if (LV.model.status === 'replay' && RP.data && RP.line >= 0) {
      const sec = S.sections.find((x) => x.job === RP.job), ln = RP.data.lines[RP.line], line = sec && ln ? sec.lines[ln.line] : null;
      const cap = $('#lv-cap');
      cap.classList.add('rp'); cap.classList.remove('done');
      cap.querySelector('.lv-prev').textContent = '再听一遍 · 第 ' + (RP.line + 1) + ' 句,共 ' + RP.data.lines.length + ' 句';
      const c = cap.querySelector('.lv-cur'); c.classList.remove('cut', 'nm');
      c.replaceChildren(h('span', { class: 'rp', html: ICON.replay }), line ? plainLine(line.text) : '');
      return;
    }
    $('#lv-cap').classList.remove('rp');
    const cap = $('#lv-cap'), c = cap.querySelector('.lv-cur');
    cap.querySelector('.lv-prev').textContent = LV.cap.prev;
    const cut = Boolean(LV.cap.cut) && LV.cap.cut === LV.cap.cur;
    c.textContent = LV.cap.cur ? LV.cap.cur + (cut ? '……' : '') : '';
    c.classList.toggle('cut', cut);
    c.classList.toggle('nm', !LV.cap.cur);
    cap.classList.toggle('done', LV.model.status !== 'mouth');
    cvCap();
  };
  /** 字幕换一句:上一句挪上去 */
  const liveSay = (text) => { if (!text) return; if (LV.cap.cur && LV.cap.cur !== text) LV.cap.prev = LV.cap.cur; LV.cap.cur = text; renderSubtitle(); };
  /** 服务端说:这一句开始放了(按孩子端的排法算好的时刻)。字幕换成它;那一节露到它、画它的标注、它锚的卡描边 */
  /** 讲稿 [[play]] 那句锚的小课堂卡:板上的第几节、第几张;节还没拉到 → null */
  const livePlayAt = (pl) => {
    const i = S.sections.findIndex((x) => x.job === pl.job);
    const ln = i >= 0 ? S.sections[i].lines[pl.line] : null;
    const cue = ln ? ln.cues.find((c) => c.name === 'play') : null;
    const card = cue ? S.sections[i].cards[cue.card] : null;
    return card && card.kind === 'lecture' ? { section: i, card: cue.card, ready: lectureReady(card) } : null;
  };
  /** 放得了吗:节还没拉到也先当放得了(liveLecture 再拉一次);课包读不出来就不放 */
  const livePlayable = (pl) => { const at = livePlayAt(pl); return !at || at.ready; };
  /** 铺满放 [[play]] 那一段(同板书的「交给小课堂」:舞台不关、停在末帧);节还没拉到先拉一次,还没有就算放完了 */
  const liveLecture = () => {
    const pl = LV.playLine; LV.playLine = null;
    const open = () => { const at = pl && livePlayAt(pl); if (at && at.ready) { openStage(at.section, at.card, { delegate: true, autoplay: true }); return true; } return false; };
    if (open()) return;
    loadDay(false).then(() => { if (LV.model.status === 'lecture' && !open()) liveDispatch({ type: 'lectureDone' }); }, () => { if (LV.model.status === 'lecture') liveDispatch({ type: 'lectureDone' }); });
  };
  const liveRead = (job, line, text, play, echo, call) => {
    LV.playLine = play ? { job, line } : null;
    // 热身那拍([[echo]] / [[say]])、打电话那句([[call]]):放完了亮卡 / 响铃
    LV.endLine = echo || call ? { job, line, echo, call } : null;
    if (!LV.heard.has(job) || line > LV.heard.get(job)) LV.heard.set(job, line);
    // 板不跟句子:讲到某句不描边、不画标注,卡落下时就画好了(liveLand);字幕换成这句
    liveSay(text);
  };
  /** 脑开始写这一轮:话题定下来,拉今天(卡、讲稿从那里来) */
  const liveTurn = (m) => {
    if (m.job) LV.jobs.add(m.job);
    // 带着小课堂的那条:这时才知道是哪一轮
    if (LV.lcPending && S.lecture && m.job) { LV.lcPending = false; const L = S.lecture; if (!L.firstJob) L.firstJob = m.job; L.job = m.job; renderLecturePending(); }
    if (m.thread) S.thread = m.thread;
    // 纸是话题还没有时打开的(new):这个话题有了,归它(服务端第一条也改了名;这里再存一份,new 那张删掉)
    if (m.thread && S.paper && S.paper.key === 'new' && S.tutor && S.paper.tutor === S.tutor.name) { S.paper.key = m.thread; api('PUT', CONV + S.tutor.name + '/paper', { key: m.thread, from: 'new', state: S.paper.card.state }).catch(() => {}); }
    S.newThread = false; S.via = null;
    { const b = $('#board .blank'); if (b) b.remove(); }
    S.pending = true; if (!S.waitSince) S.waitSince = Date.now();
    renderHeader(); renderSubtitle();
    clearTimeout(S.pollTimer); S.pollTimer = setTimeout(() => loadDay(false), 300);
  };
  const liveMsg = (m) => {
    switch (m.t) {
      case 'ready': { LV.ready = true; LV.retries = 0; phIdle(); voiceSync(); liveMicOn(); const q = LV.queued; LV.queued = null; if (q) liveSendNow(q[0], q[1]); break; }
      // 一直听:服务端说孩子开口 / 说完;开口时报一次这一轮的上下文(话题、舞台上的卡),收下时当松手的 body
      case 'vad': if (m.on) lvSend({ t: 'ctx', body: liveBody() }); liveDispatch({ type: 'vad', on: Boolean(m.on) }); break;
      case 'duck': liveDispatch({ type: 'duck' }); break;
      case 'unduck': liveDispatch({ type: 'unduck' }); break;
      case 'down': case 'end': liveDispatch({ type: 'drop' }); break;
      case 'tutor':
        // 嘴接住的字一到就上字幕;照念的字幕跟 read 走(到点才亮)
        if (m.of !== 'catch') break;
        if (typeof m.done === 'string') { LV.cap.catching = false; if (m.done) LV.cap.cur = m.done; renderSubtitle(); break; }
        if (!m.delta) break;
        // 接住开始:上一句念的热身那拍、打电话那句不再算(放完的是接住,不亮卡、不响铃)
        if (!LV.cap.catching) { LV.cap.catching = true; LV.endLine = null; LV.playLine = null; if (LV.cap.cur) LV.cap.prev = LV.cap.cur; LV.cap.cur = ''; }
        LV.cap.cur += m.delta; renderSubtitle();
        break;
      case 'read': liveRead(String(m.job || ''), Number(m.line), String(m.text || ''), m.play === true, m.echo === true, m.call === true); break;
      // 转写是空的(按了没说清):嘴说没听清,不会有这一轮
      case 'kid': if (!String(m.text || '').trim()) { S.pending = false; renderSubtitle(); } else if (LV.model.open) { S.pending = true; if (!S.waitSince) S.waitSince = Date.now(); renderSubtitle(); } break;
      case 'turn': liveTurn(m); break;
      case 'chat': canvasChatAck(m); break;
      case 'flush': liveDispatch({ type: 'flush' }); break;
      case 'err': S.pending = false; renderSubtitle(); break;
      default: break;
    }
  };
  /** 一直听时推不推:liveStep 的(关麦、卡的声音、小课堂那一段)再加页面的——这会儿能不能发(小课堂还没看完、「接着那个还是重新开始」、只读)、到了每天的上限;
   *  变了才告诉服务端 gate(关的时候孩子说到一半的那句作废)。每块声音来时看一眼,能不能发变了不用另外通知 */
  const liveGateSync = () => {
    const on = liveGate(LV.model) && canSend();
    if (on !== LV.gateOn) { LV.gateOn = on; lvSend({ t: 'gate', on }); }
    return on;
  };
  /** 一直听要那路常开的麦克风接到采音节点上(按住说是按下时才接) */
  const liveMicOn = () => {
    if (!LV.on || !LV.model.open || !LV.audio) return;
    micOpen().then(() => (mic.stream && LV.audio ? LV.audio.use(mic.stream) : null)).catch(() => {});
  };
  /** 孩子这一句的上下文(话题、设备、首页按钮、舞台上的卡):按住说松手时带上,一直听开口时报一次 */
  const liveBody = () => {
    const body = { device: S.device };
    if (S.newThread) body.newThread = true; else if (S.thread) body.thread = S.thread;
    if (S.via) body.via = S.via;
    if (S.stage && !S.stage.paper) body.focus = { card: S.stage.id };
    return body;
  };
  /**
   * 一直听还是按住说:口语课页过来的一直听(热身、打电话一问一答);别的照 cotutor.json 的 live.listen,缺省按住说。
   * 孩子端没有开关:10-20 真跑,孩子想一下停住、「老师。」「那。」、旁边的话都成了一句
   */
  const liveOpen = (intent) => {
    if (LV.ws) liveClose();
    liveDispatch({ type: 'reset' });
    LV.gateOn = false;
    liveDispatch({ type: 'listen', open: Boolean(intent && intent.talk) || Boolean(S.tutor && S.tutor.listen === 'open') });
    LV.on = true; LV.ready = false; LV.cap = { prev: '', cur: '', cut: '', catching: false }; LV.heard = new Map(); LV.jobs = new Set();
    document.body.classList.add('live');
    $('#tutor').style.setProperty('--tc', tutorColor());
    $('#lv-av').replaceChildren(avatarEl(S.tutor));
    VB.btn.avatar(avatarEl(S.tutor)); VB.btn.color(tutorColor());
    if (!LV.audio) {
      LV.audio = makeAudio();
      LV.audio.muted = false;
      // 按着才推;一直听时推不推看 liveGate(关麦、卡的声音、小课堂时不推)
      // 松了手、还在等画(边画边聊要那张图、给老师看在导出上传):状态还是按着,声音不再推
      LV.audio.onChunk = (ab) => { if (((LV.model.status === 'holding' && !LV.letGo) || liveGateSync()) && LV.ws && LV.ws.readyState === 1) LV.ws.send(ab); };
      LV.audio.onLevel = (v) => {
        if (LV.model.status === 'holding') {
          const lv = Math.min(1, v * 4);
          holdLevel(lv); VB.btn.level('kid', lv);
          // 有声音了:3 秒没声音那句小字收回
          if (lv > 0.12) { VB.loudAt = Date.now(); if (VB.btn.el.dataset.voice === 'hold-silent') voiceSync(); }
          if (LV.diag && v > LV.diag.peak) LV.diag.peak = v;
          return;
        }
        if (LV.gateOn) { const lv = Math.min(1, v * 6); $('#lv-mic').style.setProperty('--lv', String(lv)); VB.btn.level('kid', lv); }
      };
    }
    LV.audio.wake().catch(() => {});
    // 麦克风之前开在别的 AudioContext 里(板书页开的):放掉,下面 micWarm 重开在实时这个里
    if (mic.ac && mic.ac !== LV.audio.ctx) micDrop();
    LV.retries = 0;
    liveConnect();
  };
  /** 连嘴:开 WebSocket(进老师页、断了以后重连都走这里);连上(ready)之前按住说话不接,打字排着 */
  const liveConnect = () => {
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/live/' + encodeURIComponent(S.tutor.name) + '/ws' + (LV.model.open ? '?listen=open' : ''));
    ws.binaryType = 'arraybuffer';
    LV.ws = ws;
    let wsOpenAt = 0;
    ws.onopen = () => { wsOpenAt = Date.now(); if (LV.ws === ws) lvSend({ t: 'view', w: innerWidth, h: innerHeight }); };
    ws.onmessage = (e) => {
      if (LV.ws !== ws) return;
      if (typeof e.data !== 'string') { liveDispatch({ type: 'audio' }, e.data); return; }
      let m; try { m = JSON.parse(e.data); } catch { return; }
      liveMsg(m);
    };
    // 不是孩子自己收的(liveClose 先摘了 onclose):记一笔流水,没连上还是连上又断(7.3)
    ws.onclose = () => { if (LV.ws === ws) { kidLog.live(wsOpenAt > 0, wsOpenAt ? Date.now() - wsOpenAt : 0); liveDispatch({ type: 'drop' }); } };
    micWarm();
  };
  /** 连不上、断了(liveStep 的 retry):收掉这条连接,回到「正在叫老师」,2、4、8… 秒后再连,最长 30 秒;一直连不上就一直等(原因在家长端的流水里) */
  const liveRetry = () => {
    const ws = LV.ws; LV.ws = null; LV.ready = false;
    if (ws) { ws.onclose = null; try { ws.close(); } catch {} }
    clearTimeout(LV.retryTimer);
    if (!LV.on || !S.tutor) return;
    LV.retries = (LV.retries || 0) + 1;
    phIdle(); voiceSync(); renderSubtitle();
    LV.retryTimer = setTimeout(() => { if (LV.on && S.tutor && !LV.ws) liveConnect(); }, Math.min(30000, 1000 * 2 ** Math.min(LV.retries, 5)));
  };
  /** 实时那个 AudioContext 关掉(连着它的麦克风也放掉);下次要用(进实时、开麦克风、按住)再起新的 */
  const liveAudioDrop = () => {
    if (!LV.audio || !LV.audio.ctx) return;
    if (mic.ac === LV.audio.ctx) micDrop();
    LV.audio.close();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) liveAudioDrop(); else liveMicOn(); });
  // 输入条里的麦克风(一直听时):关麦 / 开麦
  $('#lv-mic').addEventListener('click', (e) => { e.stopPropagation(); if (LV.on) liveDispatch({ type: LV.model.muted ? 'unmute' : 'mute' }); });
  /** 收:告诉服务端挂了、关连接、清嘴的声音、关实时那个 AudioContext;页面回到板书的样子(按着的那一下作废) */
  const liveClose = () => {
    const ws = LV.ws; LV.ws = null; LV.ready = false; LV.queued = null; clearTimeout(LV.retryTimer);
    if (ws) { ws.onclose = null; try { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'bye' })); ws.close(); } catch {} }
    liveAudioDrop();
    clearInterval(LV.drain); LV.drain = 0;
    if (!LV.on) return;
    LV.on = false;
    document.body.classList.remove('live', 'speaking', 'lv-open');
    if (press && press.live) { clearTimeout(press.timer); press = null; holdEnd('cancel'); setBar(barNext(S.bar, 'holdCancel')); }
    phIdle();
    if (S.tutor) renderSubtitle();
  };
  /** 实时的一次按住记一行诊断(/api/kid/voice-diag,where: live):麦克风怎么开的、多久能推声音、推上去的音量峰值、松手时怎么收的;真机上出错是静默的,只有这份能说清 */
  const liveDiagOf = () => { const t0 = Date.now(); const d = { where: 'live', tutor: S.tutor ? S.tutor.name : null, ua: navigator.userAgent, peak: 0, ev: [] }; d.mark = (k, v) => d.ev.push(v === undefined ? [k, Date.now() - t0] : [k, Date.now() - t0, v]); return d; };
  const liveDiagSend = (d) => { if (!d) return; const { mark: _m, ...row } = d; row.peak = Math.round(row.peak * 100) / 100; try { fetch('/api/kid/voice-diag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row), keepalive: true }).catch(() => {}); } catch {} };
  /** 按满 150 毫秒:嘴、卡的声音停(liveStep),告诉服务端 hold,开始推声音(常开那路麦克风接到采音节点上,第一次要等它开好) */
  const liveHold = () => {
    // 画板开着:按的是「给老师看」= 画和这句话给脑;按头像 = 边画边聊,给嘴,先要一张这一刻的画
    LV.holdKind = press && press.give ? 'give' : canvasNow() && !LV.model.open ? 'chat' : null;
    LV.letGo = false;
    CV.snapP = LV.holdKind === 'chat' ? canvasSnap() : null;
    $('#st-go').classList.toggle('holding', LV.holdKind === 'give');
    setBar(barNext(S.bar, 'holdStart'));
    dispatch({ type: 'halt' });
    hold.audio = false; renderHold();
    holdRec('down');
    LV.holdAt = Date.now();
    const d = LV.diag = liveDiagOf();
    liveDispatch({ type: 'press' });
    if (LV.model.cut) LV.cap.cut = LV.cap.cur;
    renderSubtitle();
    micOpen().then((how) => { d.mark('mic', how); return mic.stream && LV.audio ? LV.audio.use(mic.stream) : Promise.reject(new Error('no mic')); }).then(() => { d.mark('audio', LV.audio.ctx ? LV.audio.ctx.state : ''); if (press && press.live) { hold.audio = true; renderHold(); holdRec('audio'); } }, (e) => d.mark('fail', String(e && (e.name || e.message))));
  };
  /** 松手:告诉服务端 release(嘴马上接住);上滑、太短(不到 0.4 秒)、麦克风没开上 = 作废(hush)——麦克风没开上时输入条上说「没听清」,不能什么都不出(2026-10-19 真机:按了几次都没反应)。
   *  sys = 不是孩子松的手,是系统抢走了这次触摸(pointercancel:iPadOS 底部手势等);行为照旧发出去,voice-diag 记 cancel 不记 up,好分清 */
  const liveRelease = (cancelled, sys) => {
    const long = Date.now() - LV.holdAt >= 400;
    const keep = !cancelled && hold.audio && long;
    const kind = LV.holdKind; LV.holdKind = null;
    const snapP = CV.snapP; CV.snapP = null;
    $('#st-go').classList.remove('holding');
    const d = LV.diag; LV.diag = null;
    if (d) { d.mark(sys ? 'cancel' : 'up', keep ? 'sent' : cancelled ? 'slide' : !long ? 'short' : 'nomic'); liveDiagSend(d); }
    holdEnd(keep ? 'sent' : cancelled ? 'cancel' : 'unclear');
    setBar(barNext(S.bar, keep ? 'holdEnd' : 'holdCancel'));
    if (LV.audio) LV.audio.wake().catch(() => {});
    if (!LV.on) return;
    if (!keep) {
      liveDispatch({ type: 'cancel' });
      // 按住「给老师看」没说出话(太短、麦克风没开上):照轻点交画;上滑取消的不交
      if (kind === 'give' && !cancelled) { giveTap(); renderSubtitle(); return; }
      if (!cancelled) voiceHint('unclear', long ? '没听清,再按住说一次' : '');
      renderSubtitle();
      return;
    }
    // 边画边聊:等那张画(最多 1.5 秒),松手带 chat;嘴接住,不起脑(板上不等老师)
    // 等画的这一会儿(LV.letGo):声音不推、别的按钮不接,发出去才放开
    if (kind === 'chat' && canvasNow() && S.stage) {
      const canvas = S.stage.id;
      LV.letGo = true;
      Promise.resolve(snapP).then((img) => {
        LV.letGo = false;
        LV.chatNext = { canvas, ...(img ? { image: img } : {}), ask: canvasAsk(null) };
        liveDispatch({ type: 'release' }, liveBody());
        LV.chatNext = null;
        if (CV.chat) CV.chat = canvasChatAnswered(CV.chat, Date.now());
      });
      return;
    }
    // 「给老师看」按住说:舞台导出、存好 / 传好那张画,这一句带着它交给脑(没说清服务端照交画);画没交成这一下作废
    if (kind === 'give' && canvasNow()) {
      LV.letGo = true;
      canvasGive().then((patch) => {
        LV.letGo = false;
        if (!patch) { liveDispatch({ type: 'cancel' }); renderSubtitle(); return; }
        liveDispatch({ type: 'release' }, { ...liveBody(), ...patch });
        S.pending = true; S.waitSince = Date.now(); renderSubtitle();
      });
      return;
    }
    const body = liveBody();
    // 小课堂看完问的:带上看的情况与画的(截图先传上去)
    const go = (lb) => {
      if (lb) { body.lecture = lb; lectureSent(null); LV.lcPending = true; }
      liveDispatch({ type: 'release' }, body);
      S.pending = true; S.waitSince = Date.now(); renderSubtitle();
    };
    if (S.lecture) lectureBody().then(go, () => go(null)); else go(null);
  };
  /** 打字、拍照、交卡:同说了一句,脑写(liveStep 的 send);舞台开着带 focus 那张卡 */
  const liveSendNow = (text, opts) => {
    dispatch({ type: 'halt' });
    const body = { text, device: S.device };
    if (opts.action) body.action = opts.action;
    if (opts.photos && opts.photos.length) { body.photos = opts.photos; VB.photo = true; }
    if (opts.drawing) body.drawing = opts.drawing;
    const focus = opts.focus || (S.stage && !S.stage.paper ? { card: S.stage.id } : null);
    if (focus) body.focus = focus;
    if (S.newThread) body.newThread = true; else if (S.thread) body.thread = S.thread;
    if (S.via) body.via = S.via;
    if (S.talk) { body.talk = { id: S.talk }; S.talk = null; }
    const go = (lb) => {
      if (lb) { body.lecture = lb; lectureSent(null); LV.lcPending = true; }
      liveDispatch({ type: 'send' }, body);
      if (LV.model.cut) LV.cap.cut = LV.cap.cur;
      S.pending = true; S.waitSince = Date.now(); renderSubtitle();
    };
    if (S.lecture) lectureBody().then(go, () => go(null)); else go(null);
  };
  /** 按住说话的那块:输入条中间那段(点一下 = 打字)、平板横屏实时左栏浮层里那块(点一下 = 一直听时关麦 / 开麦,别的时候提示要按住);
   *  上滑过 cancelPx 松手取消(浮层那块大,门限放宽到它的高) */
  const bindHold = (el, cancelPx, onTap) => {
  el.addEventListener('pointerdown', (e) => {
    if (S.bar === 'typing' || LV.letGo) return;
    e.preventDefault(); unlock();
    // 先点上面一个(按钮写着「点上面开始」):不接,晃一下
    if (choosing()) { VB.btn.shake(); return; }
    // 嘴还没连上:不接,说一声
    if (LV.on && !LV.ready) { connectingHint(); return; }
    // 老师在想:不接,说一声(busyHint);嘴一出声 body.pending 就摘掉,能按。一直听时这颗是开关麦,照旧接
    if (document.body.classList.contains('pending') && !(LV.on && LV.model.open)) { busyHint(); return; }
    if (LV.audio && LV.on) LV.audio.wake().catch(() => {});
    press = { y: e.clientY, cancelled: false, held: false, live: false, cancelPx, onTap, timer: setTimeout(() => {
      if (!press) return;
      // 实时:按住推声音给嘴;一直听时这颗是开关麦,不是按住说话
      // 一直听:那条不是按住说话,按久了也当点了一下(打字)
      if (LV.on && LV.ready && !LV.model.open) { press.held = true; press.live = true; liveHold(); }
    }, 150) };
    try { el.setPointerCapture(e.pointerId); } catch {}
  });
  el.addEventListener('pointermove', (e) => { if (press && press.held) { const up = press.y - e.clientY > press.cancelPx; if (up !== press.cancelled) { press.cancelled = up; renderHold(); holdRec('slide', { on: up }); } } });
  /** pointerup = 孩子松手;pointercancel = 系统抢走了触摸(iPadOS 底部手势),照旧当松手,实录与 voice-diag 分开记 */
  const release = (e) => {
    if (!press) return;
    const sys = Boolean(e && e.type === 'pointercancel');
    clearTimeout(press.timer);
    const p = press; press = null;
    if (!p.held) { p.onTap(); return; }
    if (p.live) liveRelease(p.cancelled, sys);
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  bindHold(mid, 60, () => setBar(barNext(S.bar, 'tap')));
  bindHold($('#lv-hold'), 120, () => {
    if (LV.on && LV.model.open) { liveDispatch({ type: LV.model.muted ? 'unmute' : 'mute' }); return; }
    // 点了一下没按住:晃一下提示,不打字(打字是下面那颗)
    voiceHint('tap');
  });
  // 画板铺满时工具列底下那颗小头像:同左栏那颗;画板开着按住说 = 边画边聊,给嘴
  bindHold($('#cv-hold'), 80, () => voiceHint('tap'));
  /**
   * 「给老师看」(画板):轻点 = 只交画;按住说(满 300 毫秒,比头像长一点,免得点一下成了按住)= 画和这句话一起给老师。
   * 嘴没连上、一直听、老师在想、不是画板:只能点(点了照旧交)
   */
  const bindGive = (el) => {
    let tapAt = 0;
    el.addEventListener('pointerdown', (e) => {
      if (el.disabled || press || LV.letGo || !canvasNow() || !LV.on || !LV.ready || LV.model.open || S.bar === 'typing' || document.body.classList.contains('pending')) return;
      e.preventDefault(); unlock();
      if (LV.audio) LV.audio.wake().catch(() => {});
      press = { y: e.clientY, cancelled: false, held: false, live: false, give: true, cancelPx: 80, onTap: giveTap, timer: setTimeout(() => { if (!press || !press.give) return; press.held = true; press.live = true; liveHold(); }, 300) };
      try { el.setPointerCapture(e.pointerId); } catch {}
    });
    el.addEventListener('pointermove', (e) => { if (press && press.give && press.held) { const up = press.y - e.clientY > press.cancelPx; if (up !== press.cancelled) { press.cancelled = up; renderHold(); holdRec('slide', { on: up }); } } });
    const up = (e) => {
      if (!press || !press.give) return;
      const sys = Boolean(e && e.type === 'pointercancel');
      clearTimeout(press.timer);
      const p = press; press = null;
      tapAt = Date.now();
      if (!p.held) { p.onTap(); return; }
      if (p.live) liveRelease(p.cancelled, sys);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // 没走按住的那几种(嘴没连上、不是画板、键盘):照点
    el.addEventListener('click', () => { if (Date.now() - tapAt < 800 || LV.letGo) return; giveTap(); });
  };
  bindGive($('#st-go'));
  // 画板:左栏第一颗;手机、竖屏在加号那张单子里
  $('#lv-paper .ic').innerHTML = ICON.paper; $('#ic-paper').innerHTML = ICON.paper;
  $('#lv-paper').addEventListener('click', () => openPaper());
  $('#sheet-paper').addEventListener('click', () => { $('#sheet').classList.remove('on'); openPaper(); });
  // 左栏最底下那排:拍照、相册走输入条与加号面板的那两个 file input(wireFile),打字同点输入条中间那段
  $('#lv-cam .ic').innerHTML = ICON.cameraLg; $('#lv-album .ic').innerHTML = ICON.album; $('#lv-type .ic').innerHTML = ICON.keyboard;
  $('#lv-cam').addEventListener('click', () => $('#cam input').click());
  $('#lv-album').addEventListener('click', () => $('#sheet input[multiple]').click());
  $('#lv-type').addEventListener('click', () => setBar(barNext(S.bar, 'tap')));

  // ---- 发照片屏:拍 / 选了先到这里——看一眼、裁剪 / 圈画 / 转 90°、配一句话,再一条消息发出去 ----
  // 坐标都在 photo-edit(内联在上面),这里只管画和点。原图只留 objectURL,导出时再解一次(几张 12MP 常驻内存 iPad 吃不消)
  const PS = { items: [], at: 0, mode: 'view', busy: false, work: null, drag: null, pen: null, sc: 1, R: null, raf: 0 };
  const psEl = $('#ps'), cv = $('#ps-cv'), cropEl = $('#ps-crop');
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
    $('#ps-foot').hidden = mode !== 'view';
    psUi(); psRender();
  };
  /** 改了这张:之前传上去的不作数 */
  const psEdit = (e) => { const it = psCur(); it.edit = e; it.path = null; };
  const psReset = () => {
    for (const it of PS.items) URL.revokeObjectURL(it.url);
    Object.assign(PS, { items: [], at: 0, mode: 'view', busy: false, work: null, drag: null, pen: null });
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
    if (!files.length || !S.tutor || !canSend() || S.pending) return;
    const items = (await Promise.all(files.map(psItem))).filter(Boolean);
    if (!items.length || !S.tutor) return;
    psReset(); PS.items = items;
    psEl.classList.add('on');
    $('#ps-to').replaceChildren(avatarEl(S.tutor), h('span', {}, h('small', {}, '发给 '), h('b', {}, S.tutor.display)));
    $('#ps-go').textContent = '发给' + S.tutor.display; $('#ps-go').style.background = colorOf(S.tutor);
    playRec({ k: 'ps', e: 'open' });
    psMode('view');
  };
  for (const f of document.querySelectorAll('input[type=file]')) wireFile(f);
  $('#ps-t-crop').addEventListener('click', () => { playRec({ k: 'ps', e: 'tool', tool: 'crop' }); psMode('crop'); });
  $('#ps-t-pen').addEventListener('click', () => { playRec({ k: 'ps', e: 'tool', tool: 'pen' }); psMode('pen'); });
  $('#ps-t-rot').addEventListener('click', () => { playRec({ k: 'ps', e: 'tool', tool: 'rot' }); psEdit(rotateEdit(psCur().edit)); psRender(); });
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
  $('#ps-cancel').addEventListener('click', () => { if (!PS.busy) { playRec({ k: 'ps', e: 'cancel' }); psClose(); } });
  // 发:逐张导出(转 → 裁 → 画 → 缩到长边 PHOTO_MAX_SIDE)上传拿 path,全拿到再发一条 {text, photos};传不上去屏不关、编辑留着,再点一次只传没传上的
  $('#ps-go').addEventListener('click', async () => {
    if (PS.busy || !PS.items.length) return;
    if (!S.tutor || !canSend() || S.pending) return;
    PS.busy = true; psUi();
    const name = S.tutor.name;
    try {
      for (const it of PS.items) if (!it.path) { const data = await psExport(it); const r = await api('POST', CONV + name + '/photos', { image: data }); it.path = r.path; }
    } catch (e) {
      PS.busy = false; psUi();
      if (e && e.status === 404) { psClose(); closeTutor(); }
      return;
    }
    const photos = PS.items.map((it) => it.path);
    playRec({ k: 'ps', e: 'send' });
    psClose();
    // 只发照片(2026-10-21 撤了配一句话:孩子一次都没用过;实时老师先说「我看一看图片」,孩子接着说就行)
    if (S.tutor && S.tutor.name === name) send('', { photos });
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
  $('#lb-x').innerHTML = ICON.close;
  $('#lb-x').addEventListener('click', () => $('#lb').classList.remove('on'));
  $('#lb-l').addEventListener('click', () => { if (LB.at > 0) { LB.at--; lbShow(); } });
  $('#lb-r').addEventListener('click', () => { if (LB.at < LB.list.length - 1) { LB.at++; lbShow(); } });

  // ---- 调试:?stage=<节>.<卡> 直接开某张卡的舞台(截图 / 测试用) ----
  const jumpTo = () => {
    const st = debug.get('stage');
    if (!st || !S.sections.length) return;
    const [x, y] = st.split('.').map(Number);
    const at = $('#board').querySelector('[data-sec="' + (x || 0) + '"] [data-card="' + (y || 0) + '"]');
    if (at) at.scrollIntoView({ block: 'center', behavior: 'instant' });
    openStage(x || 0, y || 0);
  };

  // ---- 启动与心跳:不通就头像灰,什么都不报 ----
  if (REEL) reelBoot();
  else if (PREVIEW) loadHome().then(() => { const f = debug.get('front'); if (f) window.cotutorPreviewSet({ front: f }); pvTell({ act: 'ready', order: K.order ? [...K.order] : [] }); });
  else loadHome().then(() => {
    let resume = null; try { resume = sessionStorage.getItem('kid-resume'); sessionStorage.removeItem('kid-resume'); } catch {}
    const open = debug.get('tutor') || resume;
    // 地址栏里定落在哪的调试参数(tutor / new / hist / panel / step / stage)只管这一次打开:读完就去掉,只留 device。孩子之后从首页换了老师地址栏不跟着变,
    // 留着的话刷新(或 Safari 自己重载、服务重启后的自动重载)永远回到地址栏里那位(2026-10-08 真机:在数学小课堂刷新跳到语文老师)
    try { const q = new URLSearchParams(); if (debug.get('device')) q.set('device', debug.get('device')); const rest = q.toString(); if (location.search !== (rest ? '?' + rest : '')) history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '')); } catch {}
    if (open && S.home) {
      const t = S.home.tutors.find((x) => x.name === open);
      const talk = debug.get('talk');
      if (t && talk) openTutor(t, { kind: 'new', talk });
      else if (t) {
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
    if (!stale || document.hidden || REEL) return;
    if (press || S.pending || S.stage || lcShowing || S.bar !== 'idle' || psEl.classList.contains('on')) return;
    try { if (S.tutor && !S.readonly) sessionStorage.setItem('kid-resume', S.tutor.name); } catch {}
    location.reload();
  };
  setInterval(() => { staleReload(); if (S.tutor) { if (!S.pending) loadDay(true); } else loadHome(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) (S.tutor ? loadDay(true) : loadHome()); });
  // 孩子端刷新(手动的、Safari 自己重载的)回到手上这位老师;在首页刷新就回首页。只读回放不记(重载回来是今天的)
  if (!REEL && !PREVIEW) window.addEventListener('pagehide', () => { try { if (S.tutor && !S.readonly) sessionStorage.setItem('kid-resume', S.tutor.name); else sessionStorage.removeItem('kid-resume'); } catch {} });
})();
</script>
</html>
`;

const KID_PAGE_SRC = PAGE.replace('__BOARD_JS__', () => libSource('kid-board')).replace('__WORD_DRAW_JS__', () => wordDrawJs()).replace('__PHOTO_JS__', () => libSource('photo-edit')).replace('__REEL_JS__', () => libSource('reel')).replace('__LIVE_JS__', () => libSource('live-board')).replace('__CANVAS_CHAT_JS__', () => libSource('canvas-chat')).replace('__AUDIO_JS__', () => AUDIO_CLIENT_JS).replace('__VOICE_VIEW_JS__', () => libSource('voice-view')).replace('__VOICE_JS__', () => VOICE_JS).replace('__VOICE_CSS__', () => VOICE_CSS).replace('__REEL_DOCK_CSS__', () => REEL_DOCK_CSS).replace('__REEL_DOCK_HTML__', () => REEL_DOCK_HTML).replace('__REEL_DOCK_JS__', () => REEL_DOCK_JS).replace('__NEUTRAL_COLOR__', () => JSON.stringify(NEUTRAL_COLOR)).replace('__BRAND_CSS__', () => BRAND_CSS).replace('__BACK_LOGO__', () => BACK_LOGO).replace('__BRAND_JS__', () => BRAND_JS)
  .replace('__CAMERA_22__', () => JSON.stringify(cameraSvg(22))).replace('__CAMERA_28__', () => JSON.stringify(cameraSvg(28))).replace('__CAMERA_20__', () => JSON.stringify(cameraSvg(20))).replace('__ALBUM_28__', () => JSON.stringify(albumSvg(28)));
export const KID_PAGE = KID_PAGE_SRC.replace('__PAGE_V__', createHash('sha1').update(KID_PAGE_SRC).digest('hex').slice(0, 8));

export interface KidPageMode {
  /** 录像里孩子的屏幕(/reel):孩子端的样子,数据是 /reel 给的一个话题,只读、不记、点不动 */
  reel?: boolean;
  /** 家长端「首页」里的预览(/preview):孩子端首页本身,点了告诉家长页,不跳走、不记看过了 */
  preview?: boolean;
}

/** 孩子端页面(录像、预览也是它):标题(已转义)填进去;mode 见 KidPageMode,不给 = 孩子端 */
export function kidPage(title: string, mode: KidPageMode = {}, stageV = '0'): string {
  return KID_PAGE.replaceAll('__TITLE__', title).replace('__SHORT__', title).replace('__MODE__', JSON.stringify(mode)).replace('__STAGE_V__', stageV);
}
