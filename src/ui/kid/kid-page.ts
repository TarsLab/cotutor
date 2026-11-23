/**
 * 孩子端 `/`:首页(老师牌 + 家长发布的牌)与老师页。零依赖内联脚本,只走 /api/kid/* 与 /api/audio。
 * 首页老师牌上的按钮、方砖都开一个新话题(从一个 activity 开始,按钮上的字立刻发出去);「今天」那一行回到开了头的话题。
 * 家长端「记录」(/parent)是自己的一页(parent-page.ts),这里没有家长的分支。
 * 录像里孩子的屏幕(/reel)是同一个页面:__MODE__ 里 reel = true——孩子端的样子,数据是 /reel 给的一个话题,
 * S.readonly 照样是真(不开麦克风、不记实录),由录像的时钟驱动。REEL 的分支只准出现在:声音(用家长页那个 Audio)、chrome(输入条露着、点不动)、
 * 一节课的舞台(只读)、启动与重载,以及录像那一块;别处看到 REEL 就是写错了。
 * 家长端「首页」里的预览(/preview)也是同一个页面:__MODE__ 里 preview = true——孩子端首页本身,在家长页的 iframe 里;点牌上的按钮不跳走,
 * 经 window.parent.cotutorPreview 告诉家长页点了哪颗,家长页经 window.cotutorPreviewSet 换最前那张、塞改着的字;不记「看过了」。PREVIEW 的分支只准出现在首页那几处与启动。
 * 试用(sandbox 与 mock,__MODE__ 里 trial = true):家长、开发者在电脑上试,吵的地方打字比说快。老师页上直接敲键盘就开输入条(敲的那个字进框,回车也开),
 * Esc 收起;舞台铺满时(课本页、白纸)右下角露一颗「打字」。打出去的字配成孩子的声音(/api/kid/trial/voice,只有 sandbox 有)当麦克风推给嘴,
 * 走的就是孩子说话那条路(转写、请他说、嘴先答、一直听的 VAD),见「试用:打的字当孩子说的」那段;没有这个口子(mock)照打字发。
 * 电脑上也没有 Apple Pencil:课本页上、别的页老师请了写、圈…时鼠标就是笔(发给舞台的 mousePen,book.tsx)。
 * 铁律:界面上永远没有错误与评判——后端不通、老师出错、识别失败,都只是「什么都不出现」或头像灰;
 * 文字尽量少,语音优先。孩子设备上没有通往家长端的入口。
 *
 * 老师页是一节课:页铺满在舞台上(课本、作业照片、白纸、小课堂;
 * 舞台包 src/ui/stage/ 在 iframe 里画,postMessage 协议见 src/ui/stage/protocol.ts),一节课的状态照 src/board/lesson.ts 的 lessonStep 变(LS);
 * 老师对页做什么是讲稿里的动作,嘴念到哪句落哪句的。今天能说话的话题都走实时(body.live):嘴照念脑的讲稿、声音从 WebSocket 下来,孩子端不念;
 * 孩子的话不上板(在左栏);谁出声谁停走 ../../runtime/delivery/player.ts 的 liveStep(同样剥类型内联);连不上、断了回到「正在叫老师」再连。
 * 板上的节只剩骨架(一个话题一节、挂时间),位置的事走 ../../board/presentation.ts 的 step(纯函数,有测试,剥类型内联)。
 * 「给老师看」= 舞台先交窗里的图,再发一条 {text:'', action:'submit'};按住说 = 图和这句话一起给老师。
 * 页上点字:汉字弹田字格、英文单词弹四线三格,写一遍(#st-pick)。卡贴着那个字(放在那一行上面或下面空大的一边、小尖角指着它),页滚了跟着走;
 * 收卡:×、点页上别处、那个字出了窗、孩子落笔(舞台报 pickAt null)、老师「看」别处或翻页;不按时间收(docs/dev/课本.md)。
 * 作业照片:相机 / 相册先进发照片屏(裁剪、圈画、转 90°,坐标在 src/ui/kid/photo-edit.ts),再一条 {text, photos}。
 * 流式:老师还在写时 pending 条目带 partial 讲稿;整轮跑完那节换成正式的,不重播。
 * __TITLE__ / __SHORT__(主屏幕图标下的名字)由路由替换。调试参数(只管这一次打开,见文末启动):`?tutor=` 进哪位老师,
 * `&new=1` / `&hist=<日期>.<话题>` / `&panel=1` 见启动那段;`?device=` 一直留着。
 */
import { createHash } from 'node:crypto';
import { wordDrawJs } from './word-draw.ts';
import { NEUTRAL_COLOR } from '../shared/tutor-color.ts';
import { faviconLinks } from '../shared/favicon.ts';
import { REEL_DOCK_CSS, REEL_DOCK_HTML, REEL_DOCK_JS } from '../shared/reel-dock.ts';
import { inlineScript } from '../shared/inline-lib.ts';
import { BACK_LOGO, BRAND_CSS, BRAND_JS, titleLogo } from '../shared/brand.ts';
import { albumSvg, cameraSvg } from './photo-ui.ts';
import { AUDIO_CLIENT_JS } from './audio-client.ts';
import { VOICE_CSS, VOICE_JS } from './voice-ui.ts';
import { KID_NAV_JS } from './kid-nav.ts';
import { pageDomJs } from '../shared/page-dom.ts';
import { KID_LOG_JS } from './kid-log.ts';
import { BACK_TINT_CSS, BACK_TINT_JS } from './tutor-face.ts';
import { BOARD_MARK_CSS, BOARD_MARK_HAND_LEFT_CSS, BOARD_MARK_JS } from './board-mark.ts';
import { HOME_TILES_JS } from './home-tiles.ts';

/** 内联进页面的那几份纯文件(仓库里是 .ts,npm 包里是 dist 的 .js;inline-lib 剥类型、去 export,变成能内联的普通脚本) */
const INLINE = {
  'kid-board': new URL('../../board/presentation.ts', import.meta.url),
  lesson: new URL('../../board/lesson.ts', import.meta.url),
  'photo-edit': new URL('./photo-edit.ts', import.meta.url),
  reel: new URL('./reel.ts', import.meta.url),
  'live-board': new URL('../../runtime/delivery/player.ts', import.meta.url),
  'voice-view': new URL('./voice-view.ts', import.meta.url),
} as const;

function libSource(name: keyof typeof INLINE): string {
  return inlineScript(INLINE[name]);
}

const PAGE = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="__SHORT__">
<meta name="theme-color" content="#ebe4d4">
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
  /* 标题前那颗 logo(src/ui/shared/brand.ts titleLogo):不在标题里面(#title 的字会整段换掉);孩子端跟标题同色(家长端各页是彩色的) */
  #ttl { display:flex; align-items:center; gap:10px; }
  #ct-mark { display:flex; color:var(--dim); -webkit-tap-highlight-color:transparent; }
  #ct-mark .ct-go, #ct-mark .ct-gi { transition:transform .45s cubic-bezier(.3,1.6,.5,1); }
  /* 老师头像 = C 形开口环(Cotutor 的 C,开口朝右、朝着老师说出来的话):环是 r=44 的圆(周长 276.46),
     描 80% 留 20%,转 36° 让缺口居中在右;环是学科色(currentColor),里面一个白底圆放图或字。会动的只改 dasharray 与转角 */
  .av { position:relative; display:grid; place-items:center; font-weight:700; flex:0 0 auto; }
  .av .ring { position:absolute; left:0; top:0; width:100%; height:100%; overflow:visible; pointer-events:none; }
  .av .ring circle { fill:none; stroke:currentColor; stroke-width:7; stroke-linecap:round; stroke-dasharray:221.17 55.29; transform-origin:50px 50px; transform:rotate(36deg); transition:transform .45s cubic-bezier(.3,1.6,.5,1); }
  .av .face { position:absolute; left:15%; top:15%; width:70%; height:70%; border-radius:50%; background:var(--card); overflow:hidden; display:grid; place-items:center; font-size:.76em; line-height:1; }
  /* 头像是按住说话的钮:iPad 的 Safari 长按图片会把图「拎起来」拖、弹存图的菜单——图不收触摸(落在钮上)、不许拖、不弹菜单 */
  /* 图铺满白底圆:绝对定位,不靠 grid 里的百分比高(Safari 在 grid 里算不出 height:100%,图按原尺寸铺开,圆里只露出左上角,底是白的就像没有头像) */
  .av img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; pointer-events:none; -webkit-user-drag:none; -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; }
  /* 画出来:从右上起笔逆时针一笔写出 C,写完头像冒出来(首页打开、回到首页、空白板;--d 是首页几位老师错开的那一下) */
  .av.draw .ring circle { animation:av-draw .9s cubic-bezier(.6,0,.3,1) var(--d, 0s) backwards; }
  .av.draw .face { animation:av-pop .5s ease-out calc(var(--d, 0s) + .35s) backwards; }
  @keyframes av-draw { from { stroke-dasharray:0 276.46; stroke-dashoffset:-221.17; } to { stroke-dasharray:221.17 276.46; stroke-dashoffset:0; } }
  @keyframes av-pop { from { opacity:0; transform:scale(.7); } to { opacity:1; transform:scale(1); } }
  @media (prefers-reduced-motion:reduce) { .av .ring circle, .av .face { animation:none !important; transition:none; } }
  .hcards { display:grid; grid-template-columns:minmax(0,1fr); gap:12px; align-items:start; }
  .hcards:empty { display:none; }
  .lbl { font-size:14px; color:var(--dim); }
  #toast { position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom) + 24px); transform:translateX(-50%); max-width:min(560px,calc(100% - 32px)); padding:12px 18px; border-radius:16px; background:#2b2b2bee; color:#fff; font-size:15px; line-height:1.5; white-space:pre-line; z-index:50; display:none; }
  #toast.on { display:block; }
  #rest { display:none; text-align:center; color:var(--dim); font-size:16px; padding:12px 0; }
  /* 百炼没配:老师们灰着、点不进去,下面一行叫爸爸妈妈;不说为什么 */
  #gate { display:none; text-align:center; color:var(--dim); font-size:18px; padding:16px 0; line-height:1.6; }
  #gate small { display:block; font-size:15px; }
  body.gated #gate { display:block; }
  body.gated #rest { display:none; }
  /* 首页是桌上的一本书(#deck,设计稿 https://claude.ai/artifact/KJFiRZD6E45YEKGQBbw98Q),几乎铺满屏:一位老师一章,只摊开最前那位的(.pc.front)。
     左页(.lp)整页是入口的图画框(一行三格,格宽跟着页宽走,cards/tutor/card.css;.lp 是尺寸容器);
     右页(.rp)页眉「今天」,下面是今天在这位老师这儿开了头的话题,一样一张别在页上,一开始空着、越学越满;底纹是课本页同一份学科字,在右页右下。两页本来就是两样东西,样子不统一。
     「XX的老师们」(#ttl)是桌上的名牌:印在书下面那条桌面上,不在书里;平板在屏幕底部正中,手机上小旗占了左半边,靠右。
     老师是钉在屏幕下沿的便利贴小旗(#tabs .tab,position:fixed、浮在首页最上面,不跟着滚;z 5 在老师页 #tutor 的 z 10 下面,开着老师页就被盖住):头像下面写学科,不画 C 环;摊开这章的那张高一截、颜色足。
     横屏从书的中线往右 90px 起排、压在右页左下角(让开正中的名牌,左页整页给入口);竖屏和手机在左下角,压在下页。压着的那一页底下留出小旗伸进书里的那截(.rp 的 padding-bottom)。
     点小旗翻到那一章,左右划翻到相邻的一章。平板横屏左右两页,竖屏和手机上下两页;#home 的 data-dev 是 JS 照 deviceFor 定的(landscape / portrait / phone) */
  #home { --kai:"Kaiti SC","STKaiti","KaiTi","Songti SC",serif; --sheet:#fffdf8; --desk:#ebe4d4; --rule:#e6dcc6; position:relative; max-width:none; gap:18px; padding:calc(env(safe-area-inset-top) + 20px) calc(env(safe-area-inset-right) + 22px) calc(env(safe-area-inset-bottom) + 50px) calc(env(safe-area-inset-left) + 22px); }
  /* 桌面色也是页面最底下的底色和浏览器的主题色(theme-color,iPhone Safari 拿它染状态栏、工具栏后面和下拉刷新露出来的那块):首页是桌面色,进老师页换成纸色(pageTheme)。
     书高按工具栏都露着时的屏高算(100svh;100vh 是工具栏收起来的高,iPhone Safari 上书会比看得到的高、整页能往上滚)。书的投影只有贴着桌面的一小道,大投影会在书下那条桌面上晕出一道深色 */
  body:has(#home) { background:#ebe4d4; }
  #home[data-dev="phone"] { padding:calc(env(safe-area-inset-top) + 12px) 8px calc(env(safe-area-inset-bottom) + 38px); }
  #ttl { position:absolute; left:0; right:0; bottom:calc(env(safe-area-inset-bottom) + 15px); justify-content:center; gap:7px; color:#8f856f; white-space:nowrap; }
  #ttl h1 { font-family:var(--kai); font-size:17px; font-weight:400; letter-spacing:1px; color:inherit; }
  #ttl #ct-mark { color:inherit; }
  #ttl .ct-logo { width:18px; height:18px; }
  #home[data-dev="phone"] #ttl { justify-content:flex-end; padding-right:18px; bottom:calc(env(safe-area-inset-bottom) + 10px); gap:6px; }
  #home[data-dev="phone"] #ttl h1 { font-size:14px; }
  #home[data-dev="phone"] #ttl .ct-logo { width:15px; height:15px; }
  #deck { position:relative; flex:1 0 auto; display:flex; min-height:calc(100vh - 70px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); min-height:calc(100svh - 70px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); }
  #home[data-dev="phone"] #deck { min-height:calc(100vh - 50px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); min-height:calc(100svh - 50px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); }
  #deck[hidden] { display:none; }
  #pages { position:relative; flex:1; min-width:0; display:flex; overflow:hidden; background:var(--sheet); border-radius:6px; box-shadow:0 1px 0 #ddd3bd, 0 3px 0 #f4ecda, 0 4px 0 #ddd3bd, 0 6px 0 #f4ecda, 0 7px 0 #ddd3bd, 0 9px 6px -2px #46371e1f; touch-action:pan-y; }
  #deck .pc { display:none; flex:1; min-width:0; padding:0; gap:0; border:0; border-radius:0; background:none; -webkit-user-select:none; user-select:none; }
  #deck .pc.front { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); }
  #home:not([data-dev="landscape"]) #deck .pc.front { grid-template-columns:minmax(0, 1fr); grid-template-rows:auto 1fr; }
  #deck .pc > .lp { container-type:inline-size; padding:44px 44px 32px 46px; }
  #deck .pc > .rp { position:relative; min-height:280px; padding:26px 46px 104px 52px; }
  #home[data-dev="portrait"] #deck .pc > .lp { padding:40px 40px 40px; }
  #home[data-dev="portrait"] #deck .pc > .rp { padding:26px 40px 104px; }
  #home[data-dev="phone"] #deck .pc > .lp { padding:22px 16px 26px; }
  #home[data-dev="phone"] #deck .pc > .rp { min-height:240px; padding:22px 16px 72px; }
  /* 书缝:横屏竖着一道在两页中间,上下两页时横着一道 */
  #deck .pc > .rp::before { content:""; position:absolute; z-index:2; left:-28px; top:0; bottom:0; width:56px; background:linear-gradient(90deg, #785f3700 0%, #785f3712 42%, #785f3729 50%, #785f3712 58%, #785f3700 100%); pointer-events:none; }
  #home:not([data-dev="landscape"]) #deck .pc > .rp::before { left:0; right:0; top:-15px; bottom:auto; width:auto; height:30px; background:linear-gradient(180deg, #785f3700 0%, #785f3712 42%, #785f3729 50%, #785f3712 58%, #785f3700 100%); }
  /* 右页的底纹:同一份学科字(markArt),竖在右下、很淡;一边出纸边多少照课本页的 --bm-right。
     两个方块字比一行字母重得多,同样高时汉字看着大好几倍:按字缩(--bm-k,board-mark.ts 的 home),ENGLISH 是 1 */
  #deck .rp .hmark { position:absolute; inset:0; overflow:hidden; color:#4a3f2e; pointer-events:none; }
  #deck .rp .hmark svg { position:absolute; display:block; bottom:30px; height:calc(min(640px, 100% - 96px) * var(--bm-k, 1)); width:auto; aspect-ratio:var(--bm-w) / var(--bm-h); right:calc(330px * var(--bm-right)); opacity:var(--bm-o); }
  #home[data-dev="portrait"] #deck .rp .hmark svg { height:calc(min(560px, 100% - 96px) * var(--bm-k, 1)); }
  #home[data-dev="phone"] #deck .rp .hmark svg { bottom:18px; height:calc(min(380px, 100% - 56px) * var(--bm-k, 1)); right:calc(200px * var(--bm-right)); }
  #deck .rp .rh { position:relative; z-index:1; display:flex; justify-content:flex-end; padding-bottom:9px; border-bottom:1px solid var(--rule); font-family:var(--kai); font-size:17px; color:var(--dim); letter-spacing:2px; }
  #home[data-dev="phone"] #deck .rp .rh { padding-bottom:7px; font-size:14px; }
  #deck .rp .tds { position:relative; z-index:1; display:grid; grid-template-columns:repeat(2, 196px); gap:26px 32px; margin-top:40px; }
  #deck .rp .tds.many { grid-template-columns:repeat(3, 128px); gap:18px 20px; }
  #home[data-dev="portrait"] #deck .rp .tds { grid-template-columns:repeat(3, 196px); }
  #home[data-dev="phone"] #deck .rp .tds { grid-template-columns:repeat(3, minmax(0, 100px)); gap:20px 12px; margin-top:22px; }
  #deck .rp .tds:empty { display:none; }
  /* 小旗:从屏幕下沿伸上来,底下垫着安全区;横屏从中线往右 90px 起 */
  #tabs { position:fixed; z-index:5; left:calc(50% + 90px); bottom:0; display:flex; align-items:flex-end; gap:10px; }
  #tabs[hidden] { display:none; }
  #tabs .tab { position:relative; flex:none; width:74px; height:calc(98px + env(safe-area-inset-bottom)); border-radius:6px 6px 0 0; background:color-mix(in srgb, var(--sc) 78%, transparent); box-shadow:0 -1px 6px #281e1e24; transition:height .2s; }
  #tabs .tab.front { height:calc(118px + env(safe-area-inset-bottom)); background:var(--sc); box-shadow:0 -2px 12px #281e1e3d; }
  #tabs .tab .av { position:absolute; left:11px; top:10px; width:52px; height:52px; font-size:22px; }
  #tabs .tab .av .ring { display:none; }
  #tabs .tab .av .face { left:0; top:0; width:100%; height:100%; box-shadow:0 0 0 3px #fff; }
  #tabs .tab .sub { position:absolute; left:0; right:0; top:72px; text-align:center; color:#fff; font-size:16px; font-weight:700; letter-spacing:3px; text-indent:3px; line-height:1; white-space:nowrap; overflow:hidden; text-shadow:0 1px 1px #0000001f; }
  #tabs .tab:not(.front) .av, #tabs .tab:not(.front) .sub { opacity:.85; }
  #tabs .tab .dot { position:absolute; top:-6px; right:-6px; width:16px; height:16px; border-radius:50%; background:var(--accent); border:3px solid var(--desk); }
  #home:not([data-dev="landscape"]) #tabs { left:calc(env(safe-area-inset-left) + 30px); }
  #home[data-dev="phone"] #tabs { left:20px; gap:8px; }
  #home[data-dev="phone"] #tabs .tab { width:58px; height:calc(76px + env(safe-area-inset-bottom)); border-radius:5px 5px 0 0; }
  #home[data-dev="phone"] #tabs .tab.front { height:calc(90px + env(safe-area-inset-bottom)); }
  #home[data-dev="phone"] #tabs .tab .av { left:9px; top:8px; width:40px; height:40px; font-size:18px; }
  #home[data-dev="phone"] #tabs .tab .av .face { box-shadow:0 0 0 2px #fff; }
  #home[data-dev="phone"] #tabs .tab .sub { top:55px; font-size:13px; letter-spacing:2px; text-indent:2px; }
  /* 家长端预览里正在改的那颗 */
  #deck .pc .bt.pv-sel { outline:4px solid var(--ink); outline-offset:3px; }
  body.offline #deck .pc, body.gated #deck .pc, body.offline #tabs, body.gated #tabs { pointer-events:none; }
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
  /* 右页上的一张:今天开了头的话题,板停下来时的样子(带着孩子的笔;还没有就是孩子拍的照片),回形针别着;点一张回到那个话题接着写 */
  .td { position:relative; min-width:0; display:flex; flex-direction:column; gap:8px; text-align:left; -webkit-tap-highlight-color:transparent; }
  .td .pic { position:relative; display:block; width:100%; aspect-ratio:196 / 118; border-radius:3px; overflow:hidden; background:color-mix(in srgb, var(--sc) 12%, #fff); box-shadow:0 1px 0 #e9e1cd, 0 6px 14px #50391a1f; transition:transform .2s ease-out, filter .2s ease-out; }
  .td .pic img { width:100%; height:100%; object-fit:cover; object-position:50% 0; display:block; }
  .td .clip { position:absolute; z-index:1; left:14px; top:-12px; width:15px; height:34px; color:#9c968a; pointer-events:none; }
  .td .clip svg { display:block; width:100%; height:100%; }
  .td .lb { display:flex; align-items:baseline; gap:8px; min-width:0; }
  .td .lb b { font-size:15px; font-weight:600; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
  .td .lb small { flex:none; font-size:13px; color:var(--dim); }
  #home[data-dev="phone"] .td { gap:6px; }
  #home[data-dev="phone"] .td .clip { left:9px; top:-9px; width:11px; height:25px; }
  #home[data-dev="phone"] .td .lb { flex-direction:column; gap:0; }
  #home[data-dev="phone"] .td .lb b { font-size:12px; }
  #home[data-dev="phone"] .td .lb small { font-size:11px; }
  .td:active .pic { transform:scale(.97); filter:brightness(.95); transition:transform .06s, filter .06s; }
  body.offline .td, body.gated .td { pointer-events:none; opacity:.45; filter:grayscale(1); }
  /* 断了、叫爸爸妈妈:小旗上的老师灰着 */
  body.offline #tabs .tab, body.gated #tabs .tab { filter:grayscale(1); }
  body.offline #tabs .av, body.gated #tabs .av { filter:grayscale(1); opacity:.4; }
  body.offline #ct-mark, body.gated #ct-mark { filter:grayscale(1); opacity:.4; }
  body.offline #ct-mark .ct-go, body.offline #ct-mark .ct-gi, body.gated #ct-mark .ct-go, body.gated #ct-mark .ct-gi { transform:rotate(90deg); }
  body.offline .c-tutor .nm, body.offline .c-tutor .bt, body.gated .c-tutor .nm, body.gated .c-tutor .bt { color:var(--dim); }
  /* ---- 老师页 ---- */
  #tutor { position:fixed; inset:0; background:var(--paper); display:none; z-index:10; }
  #tutor.on { display:flex; }
  /* 三门主科在板右边竖着写一个很淡的学科名(board-mark.ts) */
${BOARD_MARK_CSS}
  #main { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; }
  /* 没有顶栏:左上角一颗胶囊「‹ logo」(整颗点了回首页,放 logo,老师的脸在实时的左栏 / 手机的字幕行),右上角「更多」;浮在板上面、舞台遮罩(z 4)下面,舞台开了就被压暗盖住 */
  .tb { position:absolute; top:calc(env(safe-area-inset-top) + 10px); z-index:3; display:flex; align-items:center; gap:10px; }
  .tb.l { left:calc(env(safe-area-inset-left) + 12px); }
  #back { display:flex; align-items:center; gap:2px; height:48px; padding:0 4px 0 8px; border-radius:24px; background:#fffffff0; border:1px solid var(--line); box-shadow:0 2px 10px #00000018; }
  #back .ct-logo { color:var(--ink); margin:0 8px 0 4px; }
  /* 胶囊带上老师:填这位老师的颜色、logo 后面接首字(同听写页一份,tutor-face.ts) */
${BACK_TINT_CSS}
  #back-ic { width:24px; height:24px; color:var(--dim); display:grid; place-items:center; }
  #c-mo { font-size:13px; color:var(--dim); background:#fffffff0; border:1px solid var(--line); border-radius:14px; padding:4px 12px; box-shadow:0 2px 10px #00000010; white-space:nowrap; }
  #c-mo[hidden] { display:none; }
  .hb { width:40px; height:40px; display:grid; place-items:center; color:var(--dim); }
  .hb.on { color:var(--accent); }
  .hb.dim { opacity:.35; pointer-events:none; }
  .hb[hidden] { display:none; }
  .blank { flex:1; grid-column:1 / -1; min-height:50vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; text-align:center; padding:40px 20px; color:var(--dim); }
  .blank .av { width:96px; height:96px; font-size:44px; margin-bottom:4px; }
  .blank .nm { font-size:26px; font-weight:700; color:var(--ink); }
  .blank b { font-size:22px; font-weight:600; color:var(--ink); }
  .blank.ask b { margin-top:14px; }
  .ask-row { display:flex; flex-wrap:wrap; justify-content:center; gap:16px; margin-top:20px; width:100%; }
  .ask-go { flex:0 1 300px; min-height:120px; border-radius:24px; padding:18px 22px; display:flex; flex-direction:column; align-items:flex-start; gap:6px; text-align:left; font:inherit; cursor:pointer; box-shadow:0 4px 16px #0000000f; }
  .ask-go.back { background:#fff; border:2px solid; } .ask-go.fresh { border:0; color:#fff; }
  .ask-go .t { display:flex; align-items:center; gap:8px; font-size:18px; font-weight:700; } .ask-go .ic { display:grid; }
  .ask-go .s { font-size:17px; color:var(--ink); } .ask-go.fresh .s { color:#fff; } .ask-go small { font-size:14px; color:var(--dim); }
  .blank small { font-size:15px; }
  #pill[hidden] { display:none; }
  #pill .ic[hidden] { display:none; }
  #wrap { position:relative; flex:1; min-height:0; display:flex; flex-direction:column; }
  /* 板顶上一条渐隐:滚上去的内容在两角按钮那一带淡成纸色,不和胶囊、话题标签叠字。只是盖一层颜色,不占位置、不收触摸;
     夹在板(z 1)与两角按钮(z 3)之间。滚到顶时第一节在 68px 以下,基本碰不到它 */
  #wrap::before { content:""; position:absolute; left:0; right:0; top:0; height:calc(env(safe-area-inset-top) + 72px); z-index:2; pointer-events:none; background:linear-gradient(var(--paper) calc(env(safe-area-inset-top) + 16px), transparent); }
  /* 舞台的遮罩:板与顶栏压暗,点一下 = 点 ×;字幕行与输入条不盖(舞台开着孩子照样能说话) */
  #st-dim { position:absolute; left:0; right:0; bottom:0; top:-100vh; z-index:4; background:#00000073; display:none; }
  #stage.on ~ #st-dim { display:block; }
  /* ---- 板铺满:铺满整屏、盖住左栏;顶栏 × · 题目一行(点开看全)· 给老师看(轻点只交板,按住说 = 板和这句话一起给老师);
     工具一列在舞台里,最底下浮着老师的小头像(按住说话);嘴说的话在板顶上浮一条,说完几秒淡掉 ---- */
  #stage.cv, body.live #stage.cv, body.live.hand-left #stage.cv { position:fixed; inset:0; width:auto; transform:none; border-radius:0; box-shadow:none; z-index:20; }
  #stage.cv .top { min-height:56px; box-sizing:border-box; padding:calc(env(safe-area-inset-top) + 6px) calc(env(safe-area-inset-right) + 220px) 6px calc(env(safe-area-inset-left) + 12px); gap:12px; }
  #stage.cv #st-x { order:-1; }
  #stage.cv .top .ttl { cursor:pointer; font-size:18px; }
  #stage.cv .top .ttl.open { white-space:normal; }
  #stage.cv #st-act { position:absolute; top:env(safe-area-inset-top); right:env(safe-area-inset-right); height:56px; box-sizing:border-box; padding:0 12px; border-top:0; gap:10px; }
  #stage.cv #st-note { font-size:14px; }
  /* 页上点字:孩子点中的字词,田字格浮在页上面(右手时在右上,左手时在左上) */
  #st-pick { position:absolute; z-index:3; top:calc(env(safe-area-inset-top) + 72px); right:calc(env(safe-area-inset-right) + 16px); padding:54px 14px 12px; background:#fff; border-radius:24px; box-shadow:0 10px 36px rgba(60,50,30,.22), 0 0 0 1px rgba(60,50,30,.06); animation:st-pick-in .22s cubic-bezier(.2,.8,.2,1); }
  #st-pick[hidden] { display:none; }
  body.hand-left #st-pick { right:auto; left:calc(env(safe-area-inset-left) + 16px); }
  /* 贴着字(舞台给了那个字在哪):left / top 由 pickPlace 摆;小尖角指着字,--ax 是它离卡左边多远 */
  #st-pick.anch, body.hand-left #st-pick.anch { right:auto; }
  #st-pick.anch::before { content:''; position:absolute; left:calc(var(--ax, 50%) - 12px); width:24px; height:12px; background:#fff; }
  #st-pick.anch.below::before { top:-11px; clip-path:polygon(50% 0, 100% 100%, 0 100%); }
  #st-pick.anch.above::before { bottom:-11px; clip-path:polygon(0 0, 100% 0, 50% 100%); }
  /* 点字弹的田字格:每字一个格,一笔一笔写,点格子再写一遍 */
  #st-pick .pk-hz { display:flex; flex-wrap:nowrap; gap:10px; justify-content:center; align-items:flex-start; }
  .hz { position:relative; width:168px; height:168px; cursor:pointer; -webkit-tap-highlight-color:transparent; }
  .hz svg { display:block; width:100%; height:100%; }
  .hz .grid { stroke:var(--tint-sand-line); stroke-width:6; fill:none; }
  .hz .grid .mid { stroke-dasharray:24 18; }
  .hz .ghost { fill:#d9d5cc; }
  .hz .ghost.done { fill:var(--ink); }
  .hz .ink { stroke:var(--ink); stroke-width:200; fill:none; stroke-linecap:round; stroke-linejoin:round; }
  .hz .n { position:absolute; right:6px; bottom:2px; font-size:13px; color:#8a857c; line-height:1; }
  /* 点字弹的四线三格:英文单词写一遍 */
  #st-pick .pk-wd { padding:4px 8px; max-width:min(520px, 60vw); overflow:hidden; }
  .wg svg { display:block; max-width:100%; height:auto; overflow:visible; }
  .wg .grid line { stroke:var(--tint-sand-line); stroke-width:1.2; vector-effect:non-scaling-stroke; }
  .wg .grid .base { stroke:#b0a89a; }
  .wg .hit { fill:transparent; }
  .wg .gh, .wg .ink { fill:none; stroke-width:21; stroke-linecap:round; stroke-linejoin:round; }
  .wg .gh { stroke:#d9d5cc; }
  .wg .lt.done .gh, .wg .ink { stroke:var(--ink); }
  .wg .ft { fill:var(--ink); font-family:"Helvetica Neue",Arial,sans-serif; }
  #st-pick-x { position:absolute; top:6px; right:6px; width:44px; height:44px; border-radius:50%; border:0; background:var(--grey, #eeece6); color:var(--ink); display:grid; place-items:center; cursor:pointer; }
  body.hand-left #st-pick-x { right:auto; left:6px; }
  @keyframes st-pick-in { from { opacity:0; scale:.9; } to { opacity:1; scale:1; } }
  @media (max-width: 760px) { .hz { width:112px; height:112px; } }
  #st-go.holding { background:#3d7fd9; border-color:#3d7fd9; color:#fff; }
  #cv-hold, #cv-cap { display:none !important; }
  body.live #stage.cv #cv-hold { display:flex !important; position:absolute; z-index:2; left:calc(env(safe-area-inset-left) + 4px); bottom:calc(env(safe-area-inset-bottom) + 20px); }
  body.live.hand-left #stage.cv #cv-hold { left:auto; right:calc(env(safe-area-inset-right) + 4px); }
  /* 试用(TRIAL):舞台铺满时的「打字」,在按住说话的另一头;在打字、只能看时不露 */
  #cv-type { display:none; }
  body.trial.live:not(.nosend):not(.typing) #stage.cv #cv-type { display:flex; position:absolute; z-index:2; right:calc(env(safe-area-inset-right) + 16px); bottom:calc(env(safe-area-inset-bottom) + 20px); align-items:center; gap:6px; padding:8px 16px 8px 12px; border-radius:22px; background:#fffffff2; box-shadow:0 4px 18px #0000001f; font-size:15px; font-weight:600; color:var(--ink); }
  body.trial.live.hand-left #stage.cv #cv-type { right:auto; left:calc(env(safe-area-inset-left) + 16px); }
  #cv-type .ic { display:grid; color:var(--dim); }
  /* 竖屏、手机:输入条平时在板下面,舞台铺满会盖住它;试用里打字时它浮到舞台上面(平板横屏本来就这样,见「平板横屏」) */
  body.trial.live.typing #bar { position:fixed; left:0; right:0; bottom:var(--kb, 0px); z-index:25; background:#faf9f4f5; }
  /* 老师是左边中间浮着的一张卡——大头像,底下一行跟着左栏那颗变(按住说话 / 在听…);左手的在右边。原来是左下 64px 的小圆,孩子按不准 */
  body.live #stage.cv.bp #cv-hold { left:calc(env(safe-area-inset-left) + 16px); right:auto; top:50%; bottom:auto; translate:0 -50%; width:136px; height:auto; padding:14px 8px 12px; flex-direction:column; gap:8px; border-radius:30px; box-shadow:0 8px 28px #46371e33; }
  body.live.hand-left #stage.cv.bp #cv-hold { left:auto; right:calc(env(safe-area-inset-right) + 16px); }
  #stage.bp #cv-hold .vb-av { width:104px; height:104px; --vb-h1:-4px; --vb-h2:-12px; }
  #stage.bp #cv-hold .vb-av > .av { width:88px; height:88px; font-size:40px; }
  #stage.bp #cv-hold .vb-side { display:block; align-self:stretch; height:24px; }
  #stage.bp #cv-hold .vb-big { justify-content:center; gap:4px; font-size:16px; font-weight:700; white-space:nowrap; }
  #stage.bp #cv-hold .vb-big .vb-ic svg { width:18px; height:18px; }
  #stage.bp #cv-hold .vb-small { display:none; }
  #stage.cv #cv-cap { display:block !important; position:absolute; z-index:2; top:calc(env(safe-area-inset-top) + 68px); left:50%; translate:-50% 0; width:max-content; max-width:min(720px, calc(100% - 200px)); box-sizing:border-box; padding:10px 18px; border-radius:16px; background:#fffffff2; box-shadow:0 4px 18px #0000001f; font-size:20px; line-height:1.45; font-weight:600; color:var(--ink); opacity:0; pointer-events:none; transition:opacity .3s; }
  #stage.cv #cv-cap.on { opacity:1; }
  /* 板是页面;顶栏多两颗换底的钮(拍照、相册),左上的 × 是回首页 */
  #st-bp { display:none; }
  #stage.bp #st-bp { display:flex; gap:8px; flex:none; }
  #stage.bp.bk:not(.ph) #st-bp { display:none; }
  #st-bp button { display:flex; align-items:center; gap:6px; height:40px; padding:0 14px; border:1.5px solid var(--line, #e5e1d8); border-radius:20px; background:#fff; font:inherit; font-size:16px; font-weight:600; color:var(--ink); cursor:pointer; }
  #st-bp button svg { width:20px; height:20px; }
  /* 板铺到顶,顶栏是浮在板上的一层(只有按钮收触摸;顶上不垫纸色渐隐:它会把课本头两行和「给老师看」罩虚,几颗钮各自垫实底);
     左上的 × 换成和老师页一样的「‹ 语」胶囊(回首页,stageBackSync);老师板卡的题目有字才露,垫白底 */
  #stage.bp .top { position:absolute; left:0; right:0; top:0; z-index:4; min-height:0; border:0; background:none; padding:calc(env(safe-area-inset-top) + 12px) calc(env(safe-area-inset-right) + 220px) 24px calc(env(safe-area-inset-left) + 16px); pointer-events:none; }
  #stage.bp .top > * { pointer-events:auto; }
  #stage.bp .top .ttl { flex:0 1 auto; }
  #stage.bp .top .ttl:empty { display:none; }
  #stage.bp .top .ttl:not(:empty) { padding:10px 16px; border-radius:20px; background:#fffffff0; box-shadow:0 2px 10px #00000014; }
  #stage.bp #st-bp { margin-left:auto; }
  /* 课本的一课里:课名旁边一颗「目录」,点了翻回目录(窗停在这一课那一行);目录页上、照片、白纸上没有 */
  #st-toc { display:none; }
  #stage.bp.bk #st-toc:not([hidden]) { display:flex; align-items:center; gap:6px; flex:none; height:40px; padding:0 16px 0 12px; border:0; border-radius:20px; background:#fffffff0; box-shadow:0 2px 10px #00000014; font:inherit; font-size:16px; font-weight:600; color:var(--ink); cursor:pointer; }
  #st-toc svg { width:20px; height:20px; }
  /* 课本的一课里:课名两边一对箭头(上一课、下一课,照目录的先后;到头的那颗不出),和课名合成一颗胶囊;别处 #st-nav 不占地方 */
  #st-nav { display:contents; }
  #st-prev, #st-next { display:none; }
  #stage.bp.bk #st-nav.on { display:flex; align-items:center; flex:0 1 auto; min-width:0; height:40px; border-radius:20px; background:#fffffff0; box-shadow:0 2px 10px #00000014; }
  #stage.bp.bk #st-nav.on .ttl:not(:empty) { padding:0 16px; background:none; box-shadow:none; border-radius:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #stage.bp.bk #st-nav.on #st-prev:not([hidden]) + .ttl { padding-left:2px; }
  #stage.bp.bk #st-nav.on .ttl:has(+ #st-next:not([hidden])) { padding-right:2px; }
  #stage.bp.bk #st-nav.on #st-prev:not([hidden]), #stage.bp.bk #st-nav.on #st-next:not([hidden]) { display:flex; align-items:center; justify-content:center; flex:none; width:46px; height:40px; padding:0; border:0; border-radius:20px; background:none; color:var(--ink); cursor:pointer; }
  #st-nav button:active { background:#0000000d; }
  #st-nav button svg { width:22px; height:22px; }
  #stage.bp #st-frame { position:absolute; inset:0; height:100%; }
  /* 「给老师看」:没东西可交就不出现(原来是半透明的一颗,像是坏了);能交了是实心的学科色。旁边那行小字垫白底 */
  #stage.bp #st-act { top:calc(env(safe-area-inset-top) + 10px); right:calc(env(safe-area-inset-right) + 4px); }
  #stage.bp #st-go { height:52px; border-radius:26px; background:var(--bk, var(--accent)); font-size:18px; font-weight:700; box-shadow:0 6px 20px #46371e40; }
  #stage.bp #st-go:disabled { display:none; }
  /* 小课堂那一页:播放器有自己的课名、画一画、进度条;「给老师看」不出,老师说的话浮在进度条上面 */
  #stage.bp.lcp #st-act { display:none; }
  #stage.cv.bp.bk.lcp #cv-cap { bottom:calc(env(safe-area-inset-bottom) + 132px); }
  #stage.bp #st-go.holding { background:#3d7fd9; }
  #stage.bp #st-note:not(:empty) { flex:none; padding:6px 12px; border-radius:14px; background:#fffffff0; }
  /* 课本做底:课本铺满屏宽,老师贴着屏幕边(一张只有外侧圆角的签),落在课本自己的页边里、不压正文;「擦掉」在舞台里、贴在它正下方(stage.css 的 .bk-wipe)。
     老师说的话是底下一条字幕,不压在正文头上 */
  body.live #stage.cv.bp.bk #cv-hold { left:0; width:88px; padding:12px 0 22px; gap:12px; border-left:0; border-radius:0 24px 24px 0; }
  body.live.hand-left #stage.cv.bp.bk #cv-hold { left:auto; right:0; border-left:1.5px solid #e2dfd6; border-right:0; border-radius:24px 0 0 24px; }
  #stage.bp.bk #cv-hold .vb-av { width:68px; height:68px; --vb-h1:-3px; --vb-h2:-8px; }
  #stage.bp.bk #cv-hold .vb-av > .av { width:60px; height:60px; font-size:28px; }
  #stage.bp.bk #cv-hold .vb-side { height:22px; }
  #stage.bp.bk #cv-hold .vb-big { gap:3px; font-size:13px; }
  #stage.bp.bk #cv-hold .vb-big .vb-ic svg { width:14px; height:14px; }
  #stage.cv.bp.bk #cv-cap { top:auto; bottom:calc(env(safe-area-inset-bottom) + 20px); padding:12px 22px; border-radius:18px; background:#2b2b2beb; color:#fff; }
  #st-x.st-back { display:flex; align-items:center; gap:2px; width:auto; height:48px; padding:0 4px 0 8px; border-radius:24px; background:#fffffff0; border:1px solid var(--line); box-shadow:0 4px 16px #46371e2e; color:var(--ink); }
  #st-x.st-back .bk-ic { width:24px; height:24px; color:var(--dim); display:grid; place-items:center; }
  #st-x.st-back .ct-logo { color:var(--ink); margin:0 8px 0 4px; }
  #st-x.st-back .bk-ini { display:none; }
  #st-x.st-back.tinted { background:var(--bk); border-color:var(--bk); color:#fff; }
  #st-x.st-back.tinted .ct-logo { color:#fff; }
  #st-x.st-back.tinted .bk-ic { color:#ffffffd9; }
  #st-x.st-back.tinted .bk-ini { display:block; flex:none; margin:0 12px 0 -2px; font-size:23px; font-weight:800; line-height:1; color:#fff; }
  .bp-start .ask-row { flex-wrap:wrap; }
  /* 选课本页:铺满一层,册名一行,下面一页一格(缩略图 + 页码) */
  #tbk { position:fixed; inset:0; z-index:40; background:var(--paper); display:none; flex-direction:column; }
  #tbk.on { display:flex; }
  #tbk .hd { display:flex; align-items:center; justify-content:space-between; padding:calc(env(safe-area-inset-top) + 12px) 16px 12px; font-size:20px; border-bottom:1px solid #0000000f; }
  #tbk-x { width:44px; height:44px; border:0; border-radius:50%; background:#0000000a; display:grid; place-items:center; cursor:pointer; }
  #tbk .ls { flex:1; overflow:auto; padding:12px 16px calc(env(safe-area-inset-bottom) + 24px); }
  #tbk h3 { margin:16px 0 10px; font-size:17px; color:var(--dim); }
  #tbk .pgs { display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:12px; }
  #tbk .pg { border:0; padding:0; background:#fff; border-radius:12px; box-shadow:0 2px 10px #0000001a; overflow:hidden; cursor:pointer; display:flex; flex-direction:column; }
  #tbk .pg img { width:100%; aspect-ratio:3 / 4; object-fit:cover; background:#f3efe6; }
  #tbk .pg span { padding:6px; font-size:15px; font-weight:600; color:var(--ink); }
  #tbk .pg.busy { opacity:.5; }
  /* 孩子从纸上交的画:节前一张——图(点开看大图)、几笔、接着画 */
  #board { flex:1; min-height:0; overflow:auto; padding:calc(env(safe-area-inset-top) + 68px) 16px 24px; display:flex; flex-direction:column; gap:12px; -webkit-overflow-scrolling:touch; scroll-behavior:smooth; }
  /* 输入条 */
  #bar { padding:8px 16px calc(env(safe-area-inset-bottom) + 12px); }
  #pill { display:flex; align-items:center; gap:12px; height:56px; padding:0 14px; border-radius:28px; background:#fff; border:1px solid var(--line); box-shadow:0 2px 10px #00000010; }
  #pill .ic { color:var(--ink); display:grid; place-items:center; width:32px; height:44px; }
  /* 一直听(activity 头上 listen: open 与 live.listen):输入条里的麦克风(点它关麦 / 开麦,外圈跟着音量) */
  #pill #lv-mic { display:none; }
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
  /* 孩子的屏幕(iframe 里):孩子端原样,只是点不动;板能上下翻(点在 reelBoot 里挡掉) */
  body.rlk #tutor .tb, body.rlk #bar { pointer-events:none; }
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
  #sheet label, #sheet .opts button { display:flex; flex-direction:column; align-items:center; gap:8px; padding:18px 0; border-radius:16px; background:var(--paper); font-size:15px; font-weight:600; }
  #sheet .opts button { border:0; color:inherit; font-family:inherit; line-height:inherit; }
  input[type=file] { display:none; }
  /* 发照片屏:看一眼、裁剪 / 圈画 / 转 90°、配一句话,再发 */
  #ps { position:absolute; inset:0; z-index:40; background:#1d1c1a; color:#fff; display:none; flex-direction:column; }
  #ps.on { display:flex; }
  /* 发给谁:头像和名字;「发给」按钮用这位老师的颜色,和拍照听写拍完的「开始听写」分得开 */
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
  /* ---- 按压反馈(全局关了系统的点击高亮,这里统一补):三种手感,按下快(60ms)、松开慢(200ms)。
     圆钮与胶囊:缩到 94% + 暗一档;深色屏上的钮:缩 + 变淡;大块面:缩到 98.5% + 暗一点;行内文字:变淡。
     板书里的卡在滚动容器里,按下延迟 80ms 才显(不然一滑整屏都在闪);卡里的小钮按着时卡自己不动。交互不是皮肤,写在页面里,主题不用跟 ---- */
  #back, #st-x, #st-go, #pill .ic, #go, .c-tutor .bt,
  #ps .tools button, #ps .foot button, #ps-strip .x,
  #sheet label, .hz, .c-tutor .tt, #ps-strip .t,
  #lv-tools button, #lv-tools .ic, #lv-replay, .lv-go { transition:transform .2s ease-out, filter .2s ease-out, opacity .2s ease-out, background-color .2s ease-out; }
  /* ---- 弹层进出场:遮罩淡入,面板按来的方向动(菜单从右上角放大、相册面板从底下滑上来、以前的从右边滑进、卡的弹窗与看大图轻轻放大、发照片屏上浮)。
     进场靠 @starting-style,退场靠 display 的 allow-discrete 过渡(Safari 18 起);不认的浏览器就是瞬间出现 / 消失,和以前一样。
     用 scale / translate 独立属性,不碰 transform(横屏的舞台已经用 transform 居中了)。关着的时候不收触摸,退场那 200ms 里点得到后面 ---- */
  #sheet, #ps, #stage, #st-dim { transition:opacity .2s ease-out, scale .24s cubic-bezier(.2,.8,.2,1), translate .24s cubic-bezier(.2,.8,.2,1), display .24s allow-discrete; }
  #sheet:not(.on), #ps:not(.on), #stage:not(.on), #stage:not(.on) ~ #st-dim { pointer-events:none; }
  #sheet .dimmer { opacity:0; transition:opacity .2s ease-out; }
  #sheet.on .dimmer { opacity:1; }
  #sheet .panel { translate:0 100%; transition:translate .28s cubic-bezier(.2,.8,.2,1); }
  #sheet.on .panel { translate:0 0; }
  #stage { opacity:0; scale:.96; }
  #stage.on { opacity:1; scale:1; }
  #ps { opacity:0; translate:0 24px; }
  #ps.on { opacity:1; translate:0 0; }
  #st-dim { opacity:0; }
  #stage.on ~ #st-dim { opacity:1; }
  @starting-style {
    #sheet.on .dimmer, #stage.on ~ #st-dim { opacity:0; }
    #sheet.on .panel { translate:0 100%; }
    #stage.on { opacity:0; scale:.96; }
    #ps.on { opacity:0; translate:0 24px; }
  }
  @media (prefers-reduced-motion:reduce) { #sheet, #ps, #stage, #st-dim, #sheet .dimmer, #sheet .panel { transition:none; } }
  @media (hover:hover) {
    #back:hover, #st-x:hover, #pill .ic:hover, #sheet label:hover, .c-tutor .bt:hover, #lv-tools button:hover .ic, #lv-replay:hover, .lv-go:hover { filter:brightness(.97); }
  }
  #back:active, #st-x:active, #st-go:active, #pill .ic:active, #go:active, .c-tutor .bt:active, .ask-go:active { transform:scale(.94); filter:brightness(.92); transition-duration:.06s; }
  #ps .tools button:active, #ps .foot button:active, #ps-strip .x:active { transform:scale(.94); opacity:.65; transition-duration:.06s; }
  /* 左栏(实时老师页白纸)最底下那排:圆钮同输入条上的圆钮(缩到 94% + 暗一档),字跟着深一档;「再听一遍」是行内文字,变淡。合成的那颗按钮在 voice-ui.ts */
  #lv-tools button:active .ic { transform:scale(.94); filter:brightness(.92); transition-duration:.06s; }
  #lv-tools button:active { color:var(--ink); transition-duration:.06s; }
  #lv-replay:active { opacity:.55; transition-duration:.06s; }
  #sheet label:active, .hz:active, .c-tutor .tt:active, #ps-strip .t:active, .lv-go:active { transform:scale(.985); filter:brightness(.95); transition-duration:.06s; }
  button:disabled, .hb.dim { opacity:.35; }
  button:disabled:active { transform:none; filter:none; }
  @media (prefers-reduced-motion:reduce) { #back, .hz, #sheet label, #ps .tools button, #ps .foot button, .c-tutor .bt, .c-tutor .tt { transition:none; } *:active { transform:none !important; } }
__VOICE_CSS__
  /* ---- 实时的老师:
     字幕行换成 #lv(类名带 lv-:卡是 .c,撞名会套上卡的边框)——竖屏、手机在输入条上方一行(小头像 + 在说的那句),横屏是左栏(大头像 + 字幕,在说的大、上一句淡),板是右边一块白板;
     平板横屏是左栏一整张白纸 + 头像和按住说话合成的一颗按钮(src/ui/kid/voice-ui.ts);卡角没有再听的喇叭,也没有别的钮(想问某张卡,点开它再按住说) ---- */
  #lv { display:none; }
  body.live #lv { display:flex; align-items:center; gap:14px; padding:8px 20px 4px; min-height:60px; }
  #lv-av { position:relative; flex:0 0 auto; width:44px; height:44px; }
  /* 请他说([[请 说 …]])的那句念完,那句锚着的卡一圈慢慢呼吸的光 = 轮到你;孩子开口光变实 */
  #lv-av .av { width:100%; height:100%; font-size:20px; }
  /* 手机字幕行那颗头像的动作(在说 / 在听 / 在想)同按钮里那颗,走 voice-ui.ts 的 voiceFace(.vb-halo 是外圈) */
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
  /* 空板(原型 F 排):老师对孩子说的话都在左栏(手机是字幕行),板只放节——板上的 .blank 收着,
     开场那句(+「比如」)在 #lv-ask、拍照屏的那几颗(拍一页、从相册选、不拍用白纸)在 #lv-acts;这时字幕、孩子那句、再听一遍让开。
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
  /* 实时的板是脑写的:节头是脑写的那张「# 标题」文字卡(一行摘要 —— 线 —— 板上第一节带时间);没写节头的一轮接着上一节画,不留节间空 */
  .sh.lh { gap:12px; padding:14px 4px 2px; white-space:normal; }
  .sh.lh::after { display:none; }
  /* 不出卡、没写节头的一轮:板上什么都不留(节是空的,不占节间空) */
  .sec.cont:empty { display:none; }
  .sh.lh .ln { flex:1 1 12px; min-width:12px; height:1px; background:var(--line); }
  .sh.lh .tm { flex:none; font-size:13px; color:var(--dim); }
  .sec + .sec.cont { margin-top:0; }
  /* ---- 平板横屏 ---- */
  @media (min-width:900px) and (orientation:landscape) {
    #home .hcards { grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); }
    .tb.l { left:calc(env(safe-area-inset-left) + 20px); }
    #board { width:100%; max-width:1040px; margin:0 auto; padding:calc(env(safe-area-inset-top) + 68px) 32px 24px; }
    #bar, #reel { width:100%; max-width:1040px; margin:0 auto; padding-left:32px; padding-right:32px; }
    /* 实时的老师:
       板是主体——占满整屏、纸色,内容从左栏右边排起,往下翻时从浮着的「更多」底下过去;
       左栏是贴边的一整张白纸(上、左、下不留边,右边一道细线加很淡的影子),宽 360:顶上回首页,字幕占回首页下面到按钮上面
       (孩子刚说的那句、上一句、在说那句、再听一遍;跟着视口高走——iPad Safari 有地址栏时只有 ~760 高,10-21 真机上按 820 写死的把字幕挤没了);
       头像和按住说话是一颗按钮(src/ui/kid/voice-ui.ts),中心约在屏高三分之二、离底边约 200(平板横放在桌上,底边太贴桌、手指往下会碰 iPadOS 底部手势);
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
    body.live.nosend #lv-hold, body.live.nosend #lv-tools { display:none; }
    /* 看以前的话题(只能看):按钮灰着、按了晃一下(voice-view 的 readonly),底下一行「回到今天 ›」;底下那排不露 */
    body.live.nosend.ro #lv-hold { display:flex; }
    body.live #bar { display:none; }
    body.live.typing #bar { display:block; position:fixed; left:0; right:0; bottom:var(--kb, 0px); z-index:25; max-width:none; padding:10px calc(env(safe-area-inset-right) + 40px) 10px calc(env(safe-area-inset-left) + 40px); background:#faf9f4f5; }
    body.live #cam, body.live #plus, body.live #lv-mic { display:none !important; }
    /* 按着时按钮自己变蓝(voice-view 的 hold),不再盖一块 #hold 上去 */
    body.live #hold { display:none !important; }
    /* 按住说话在右边(cotutor.json 的 kid.hand: left,家长端设置页切):白纸挪到右边、板在左边、按钮里头像在右头;回首页、「更多」的位置同右手(回首页浮在板的左上) */
    body.live.hand-left #board { padding-left:calc(env(safe-area-inset-left) + 48px); padding-right:calc(env(safe-area-inset-right) + 400px); }
    body.live.hand-left #stage { left:calc(env(safe-area-inset-left) + 16px); right:calc(env(safe-area-inset-right) + 376px); }
    body.live.hand-left #lv { left:auto; right:0; width:calc(env(safe-area-inset-right) + 360px); padding-top:calc(env(safe-area-inset-top) + 80px); padding-left:24px; padding-right:calc(env(safe-area-inset-right) + 24px); box-shadow:-1px 0 0 #efece4, -6px 0 24px #46371e0d; }
    body.live.hand-left #back { box-shadow:0 2px 10px #46371e2e; } body.live.hand-left #back:not(.tinted) { background:#fffffff0; }
    ${BOARD_MARK_HAND_LEFT_CSS}
  }
</style>
<div id="home">
  <div id="ttl"><span id="ct-mark" class="ct-draw">${titleLogo(false)}</span><h1 id="title">__TITLE__</h1></div>
  <div class="hcards" id="hcards"></div>
  <div class="deck" id="deck" hidden><div id="pages"></div></div>
  <nav id="tabs" aria-label="老师" hidden></nav>
  <p id="rest">老师们休息中</p>
  <p id="gate">老师们还没到<small>叫爸爸妈妈来看一下</small></p>
  <a class="c c-figshot" id="figshot" hidden><span class="avs"></span><span class="tx"><b>给老师们换个样子</b><span>帽子、脸、衣服,都由你来挑</span></span><span class="go">去搭</span></a>
</div>
<div id="toast"></div>
<section id="tutor">
  <div id="main">
    <div class="tb l"><button id="back" type="button" aria-label="回首页"><i id="back-ic"></i>__BACK_LOGO__</button><span id="c-mo" hidden></span></div>
    <div id="wrap">
      <div id="bmark" hidden></div>
      <div id="board"></div>
      <div id="stage"><div class="top"><span id="st-nav"><button type="button" id="st-prev" hidden></button><span class="ttl" id="st-ttl"></span><button type="button" id="st-next" hidden></button></span><button type="button" id="st-toc" hidden></button><span id="st-bp"><button type="button" id="st-tb" hidden></button><button type="button" id="st-cam"></button><button type="button" id="st-alb"></button></span><button id="st-x" type="button"></button></div><iframe id="st-frame" hidden title="stage"></iframe><div id="st-pick" hidden></div><div id="st-act" hidden><span class="note" id="st-note"></span><button id="st-go" type="button">给老师看</button></div><button id="cv-hold" class="vb-mini" type="button"></button><button id="cv-type" type="button"><span class="ic"></span>打字</button><div id="cv-cap"></div></div>
      <div id="st-dim"></div>
    </div>
    <div id="lv"><div id="lv-av"></div><div id="lv-kid"></div><div id="lv-cap"><div class="lv-prev"></div><div class="lv-cur"></div></div><div id="lv-ask"><b></b><small></small></div><div id="lv-acts"></div><button id="lv-replay" type="button" hidden><span class="ic"></span><span class="tx"></span></button><button id="lv-hold" type="button"></button><div id="lv-tools"><button type="button" id="lv-cam"><span class="ic"></span>拍照</button><button type="button" id="lv-album"><span class="ic"></span>相册</button><button type="button" id="lv-type"><span class="ic"></span>打字</button></div></div>
    <div id="bar">
      <div id="pill">
        <label class="ic" id="cam"><input type="file" accept="image/*" capture="environment"></label>
        <div id="mid"><span id="ph">发消息或按住说话…</span><input id="typed" type="text" autocomplete="off" hidden></div>
        <button class="ic" id="lv-mic" type="button" aria-label="关麦"></button>
        <button id="go" type="button" hidden></button>
        <button class="ic" id="plus" type="button"></button>
      </div>
    </div>
    __REEL_DOCK_HTML__
    <div id="hold"><div class="t"></div><span>松手发送,上移取消</span><div class="w"></div></div>
  </div>
  <div id="sheet"><div class="dimmer"></div><div class="panel"><div class="grab"></div><div class="opts">
    <label><span class="ic" id="ic-album"></span>相册<input type="file" accept="image/*" multiple></label>
    <label><span class="ic" id="ic-cam2"></span>拍照<input type="file" accept="image/*" capture="environment"></label>
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
  <div id="tbk"><div class="hd"><b>选课本页</b><button type="button" id="tbk-x" aria-label="关上"></button></div><div class="ls"></div></div>
</section>
<script>
// 孩子端的流水(kid-log.ts):最先装上出错的监听;打开那一下在下面 kidLog.start
${KID_LOG_JS}
(() => {
__BOARD_JS__
__LESSON_JS__
__PHOTO_JS__
__REEL_JS__
__LIVE_JS__
__AUDIO_JS__
__VOICE_VIEW_JS__
__VOICE_JS__
__BRAND_JS__

  /** 页面的模式:{} = 孩子端;reel = 录像里孩子的屏幕;preview = 家长端「首页」里的预览 */
  const MODE = __MODE__;
  /** 舞台包的版本(src/app/http/stage.ts stageVersion):iframe 的地址带上它,打包过一次就换一个地址,不用浏览器缓存里的旧舞台 */
  const STAGE_V = '__STAGE_V__';
  /** 这份页面的版本(源码的 hash):孩子端记进实录,录像对不上时标「画法已更新」 */
  const PAGE_V = '__PAGE_V__';
  const stageUrl = (card) => '/stage/?v=' + STAGE_V + '&card=' + encodeURIComponent(card);
  /** 录像里孩子的屏幕(/reel):孩子端的样子,数据是 /reel 给的一个话题;只读、不记、点不动,由录像的时钟驱动 */
  const REEL = MODE.reel === true;
  const PREVIEW = MODE.preview === true;
  /** 试用(sandbox、mock):键盘直接打字、舞台上露「打字」;见文件头 */
  const TRIAL = MODE.trial === true;
  // 孩子端不往浏览器历史里加东西(kid-nav.ts):去听写的链接都是替换当前页;家长端、录像、预览照常
  if (!REEL && !PREVIEW) { ${KID_NAV_JS} }
  // 只有孩子端报「打开」、登记设备;家长端、录像、预览开在家长自己的设备上,只记出错。ctx 出错时才取(S、LV 在下面)
  kidLog.start({ page: 'kid', mode: REEL ? 'reel' : PREVIEW ? 'preview' : 'kid', v: PAGE_V, ctx: () => ({ tutor: S.tutor ? S.tutor.name : null, thread: S.thread || null, live: Boolean(LV.on) }) });
  /** 孩子端对话接口的前缀(messages / photos / history);家长端只看,一天的记录走自己的路 */
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
    micOff: SVG('<rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"></path>', 22, 2),
    album: __ALBUM_28__,
    toc: SVG('<path d="M9 6h11M9 12h11M9 18h11"></path><circle cx="4.5" cy="6" r="1.2" fill="currentColor"></circle><circle cx="4.5" cy="12" r="1.2" fill="currentColor"></circle><circle cx="4.5" cy="18" r="1.2" fill="currentColor"></circle>', 20, 2.2),
    close: SVG('<path d="M6 6l12 12M18 6L6 18"></path>', 24, 2.2),
    prev: SVG('<path d="M15 5l-7 7 7 7"></path>', 22, 2.4),
    next: SVG('<path d="M9 5l7 7-7 7"></path>', 22, 2.4),
    closeSm: SVG('<path d="M7 7l10 10M17 7L7 17"></path>', 14, 2.8),
    check: SVG('<path d="M5 12l5 5 9-10"></path>', 16, 3),
    lock: SVG('<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>', 14, 2.2),
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
  // 学科色:服务端定好随老师下发(t.color,src/ui/shared/tutor-color.ts);不归哪位老师的块用中性的灰
  const colorOf = (t) => (t && t.color) || __NEUTRAL_COLOR__;
  // 回首页胶囊带上老师(tutorInitial 同首页牌上的首字,backTint 填颜色)
${BACK_TINT_JS}
  const tintBack = (t) => backTint($('#back'), t ? { color: colorOf(t), display: t.display } : null);
  // 板的底纹的学科字(三门主科):老师换了跟着换,别的老师不写字
${BOARD_MARK_JS}
  /** 老师头像:学科色的 C 形开口环 + 白底圆里的图或字(样子见 .av 的样式);cls 'draw' = 一笔画出来,delay 是错开的秒数 */
  const AV_RING = '<svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"></circle></svg>';
  const avatarEl = (t, cls, delay) => {
    const el = h('span', { class: 'av ' + (cls || ''), style: 'color:' + colorOf(t) + (delay ? ';--d:' + delay + 's' : '') });
    el.innerHTML = AV_RING;
    const face = h('span', { class: 'face' });
    if (t.avatar && /\.(png|jpe?g|webp|svg)$/i.test(t.avatar)) face.append(h('img', { src: '/api/kid/avatar/' + t.name, alt: '', draggable: 'false' }));
    else face.textContent = t.avatar || (t.subject || t.display || '?').slice(0, 1);
    el.append(face);
    return el;
  };
  const debug = new URLSearchParams(location.search);

  // ---- 状态 ----
  /** 铺页的话题:on = 这个话题的页面是板;base = 现在的底(照片路径,null 白板,undefined 还没定);label = 方砖上的字(不拍照直接开始时发它);workbook = 首页按钮挂的那一册练习册 */
  const BP = { on: false, base: null, label: '', books: [], toc: null, workbook: null, start: null, nb: null };
  const S = { home: null, tutor: null, day: null, sections: [], played: new Set(), state: { section: -1, line: -1, status: 'idle' }, pending: false, waitSince: null, offline: false, bar: 'idle', pollTimer: null, stage: null, partial: null, thread: null, threadAt: null, hist: null, readonly: false, newThread: false, device: 'phone', via: null, door: null, cont: null, ask: null, reel: null, pendSaid: null, homeDraw: true, autoOpened: new Set() };
  // 实时的老师这一次(连、发、收、画在下面「实时的老师」那一块):on = 这位老师这一次走实时(左栏的样子);ready = 嘴连上了;
  // model = liveStep 的状态(只在 liveDispatch 里写);cap = 字幕(上一句、在说的、被打断的那句);heard = 每一轮(job)念到第几句
  /** 试用:打的字配成声音正推着(feeding:麦克风那路不推);wait = 推的这会儿等服务端的哪条消息(liveMsg 先给它看) */
  const TV = { feeding: false, wait: null };
  const LV = { on: false, ready: false, ws: null, audio: null, model: initialLive(), cap: { prev: '', cur: '', cut: '', catching: false }, heard: new Map(), jobs: new Set(), drain: 0, was: 'quiet', holdAt: 0, diag: null, queued: null, playLine: null, endLine: null, gateOn: false, retries: 0, retryTimer: 0 };
  /** 按住说话那颗按钮(平板横屏左栏;头像 + 声音):样子是 voice-view.ts 的 voiceView 给的、画法在 voice-ui.ts,
   *  这里只在一处(voiceSync)把状态凑好交过去、把音量喂进去。hint = 刚才那一下的提示(留 2 秒);photo = 这一轮发的是照片;loudAt = 按着时最近一次有声音;
   *  reelHold / reelSpeak = 录像里孩子的屏幕这一刻(按着没有、嘴在不在出声) */
  /** 两颗按住说话的按钮一起变:左栏那颗、板铺满时工具列底下那颗小的;探针、录像读的是大的那颗 */
  const vbPair = (a, b) => ({ el: a.el, set: (v) => { a.set(v); b.set(v); }, shake: () => { a.shake(); b.shake(); }, nod: () => { a.nod(); b.nod(); }, avatar: (n) => { a.avatar(n); b.avatar(n.cloneNode(true)); }, side: (x) => { a.side(x); b.side(x); }, color: (c) => { a.color(c); b.color(c); }, level: (w, v) => { a.level(w, v); b.level(w, v); }, tutorSource: (fn) => { a.tutorSource(fn); b.tutorSource(fn); }, drawn: a.drawn });
  const VB = { btn: vbPair(voiceButton($('#lv-hold'), { side: 'left' }), voiceButton($('#cv-hold'), { side: 'left' })), hint: '', hintT: 0, loudAt: 0, photo: false, silentT: 0, side: 'left', reelHold: null, reelSpeak: false };
  VB.btn.tutorSource(() => (LV.audio && LV.audio.outLevel ? LV.audio.outLevel() : 0));
  $('#lv-av').classList.add('vb-halo');

  // ---- 声音:共享 Audio,首个手势解锁(iOS);不用浏览器合成声(老师配了音色,机械声孩子不习惯) ----
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
  /** 只停声音。播放状态不在这里改——那走 dispatch(见下面「播放器」) */
  const silence = () => { voiceToken++; try { audioEl.pause(); } catch {} };

  // ---- 首页:老师卡在上,其余卡照发布的顺序;按钮决定进老师页之后的话题 ----
  const pickButton = (t, b) => {
    const via = { home: S.home.home, button: b.id };
    // activity 头上写了 listen: open:进去就一直听
    const look = b.listen === 'open' ? { listen: 'open' } : {};
    // 每个按钮进去都是新话题;今天聊过的在首页「今天」那一行接。按钮只有 activity(含方砖,start)和小课堂
    // 孩子先说:进门(enter)只铺页、不叫老师,孩子开口才是第一轮;activity 头上写了 start: tutor 的老师先说,照旧把按钮上的字发出去
    const first = b.start === 'tutor' ? { send: b.label } : { enter: true };
    // 铺课本的 activity:不拍照,进门铺课本(范围那一课、上次翻到的那一课或目录);铺练习册的:同样不拍照,先铺按钮挂的那一册
    if (b.kind === 'start' && (b.base === 'textbook' || b.base === 'workbook')) openTutor(t, { kind: 'new', via, base: b.base, label: b.label, ...first, ...(b.workbook ? { workbook: b.workbook } : {}), ...look });
    // 铺作业照片的 activity(检查作业、英语的预习复习):先到拍照屏,带着照片开话题(拍照交上来就是开口);用白纸也是进门
    else if (b.kind === 'start' && b.base === 'photo') openTutor(t, { kind: 'new', via, base: 'photo', label: b.label, ...(b.start === 'tutor' ? { start: 'tutor' } : {}), ...look });
    else if (b.kind === 'start') openTutor(t, { kind: 'new', via, ...first, ...look });
    // 小课堂:新话题,页上先铺那堂课;看完才能开口,开口那条带上 via 与看的情况。看完照着聊的 activity 是铺作业照片的(看图说话),顶栏有拍照
    else if (b.kind === 'lecture') openTutor(t, { kind: 'new', via, base: b.base || 'lecture', label: b.label, lecture: { bundle: b.bundle, title: b.title || b.label, ms: b.ms || 0, ...(b.video ? { video: true } : {}) }, ...look });
  };
  /** 小课堂的课长:「1 分 40 秒」 */
  const lcLen = (ms) => { const s = Math.floor(ms / 1000); return s >= 60 ? Math.floor(s / 60) + ' 分' + (s % 60 ? ' ' + (s % 60) + ' 秒' : '') : s + ' 秒'; };
  // ---- 常驻入口:听写、拍照听写一直在那位老师的卡上,不经首页发布(口语课是方砖) ----
  const EXTRA_ICON = { dictation: SVG('<path d="M4 20l4-1 11-11-3-3L5 16z"></path><path d="M14 7l3 3"></path>', 20), photo: __CAMERA_20__ };
  /** 听写:一整条,上面一排空格子,几个词几格(最多 6,英文是四线三格),下面「听写 · 几个词」和「去写」 */
  const dictationBtn = (label, sub, n, en, href) => h('a', { class: 'bt bt-extra bt-x-dictation' + (en ? ' en' : ''), href },
    h('span', { class: 'dg', 'aria-hidden': 'true' }, ...Array.from({ length: Math.max(1, Math.min(n, en ? 4 : 6)) }, () => h('i'))),
    h('span', { class: 'dr' }, h('span', { class: 'lb' }, h('span', { class: 'btx' }, label), h('small', { class: 'ln' }, sub)), h('span', { class: 'go' }, '去写')));
  /**
   * 常驻的听写:图标是一小格——语文的田字格写个「字」、英语的四线格写个「Aa」;孩子看格子就分得出是写汉字还是写英文。
   * 语文先翻到课本书后的词语表选一课(没有课本才拍照);英语的书读不出字,还是拍照,右下角带学科色的相机
   */
  const photoBtn = (t) => {
    const en = t.lang === 'en';
    return h('a', { class: 'bt bt-extra bt-x-photo' + (en ? ' en' : ''), href: '/dictation?tutor=' + encodeURIComponent(t.name) + (en ? '&lang=en' : ''), style: '--sc:' + colorOf(t) },
      h('span', { class: 'pg', 'aria-hidden': 'true' }, h('i', {}, en ? 'Aa' : '字'), en ? h('span', { class: 'cam', html: EXTRA_ICON.photo }) : null),
      h('span', { class: 'lb' }, h('span', { class: 'btx' }, en ? '拍照听写' : '听写'), h('small', { class: 'ln' }, en ? '拍英语书上要写的单词' : '照课本的词语表')));
  };
  /** 这位老师卡上「每天都在」那栏:归他的听写卡、常驻的拍照听写 */
  const extrasFor = (t, H) => {
    const out = [];
    const extras = t.extras || [];
    const all = (Array.isArray(H.cards) ? H.cards : []).filter((x) => x.kind === 'dictation');
    // 英文单词听写:卡上的词是英文单词,或者英语老师卡上的拍照听写 → /dictation?lang=en
    for (const c of all) if (c.owner === t.name) { const en = c.props.lang === 'en', n = c.props.count || 0; out.push(dictationBtn(en ? '单词听写' : '听写', n + (en ? ' 个单词' : ' 个词') + ' · 老师念,你来写', n, en, '/dictation?home=' + encodeURIComponent(H.home || '') + '&n=' + all.indexOf(c) + (en ? '&lang=en' : ''))); }
    if (extras.includes('dictation')) out.push(photoBtn(t));
    return out;
  };
  // 牌上的按钮:小课堂是胶带贴着的截图(占两格);activity 是一张卡,图照它往页上铺什么挑(actArt)。孩子看到的字都在 .btx 里(探针按它读)
  const tutorButton = (t, b) => {
    const on = { click: () => pickButton(t, b) };
    if (b.kind === 'lecture') return h('button', { type: 'button', class: 'bt bt-lecture', 'data-bid': String(b.id), on }, lecturePic(b),
      h('span', { class: 'lm' }, h('small', { class: 'tg' }, '小课堂'), h('span', { class: 'btx' }, b.label), b.ms ? h('small', { class: 'ln' }, lcLen(b.ms)) : null));
    return h('button', { type: 'button', class: 'bt bt-' + b.kind + ' bt-act', 'data-bid': String(b.id), on }, h('span', { class: 'ta', html: actArt(b.base) }), h('span', { class: 'btx' }, b.label));
  };
  // ---- 常驻的方砖(课本、预习、检查作业、复习、口语课;服务端照老师家里的 activity 文件给,src/ui/kid/home-tiles.ts):牌上第一行;点了和 activity 按钮一样 ----
${HOME_TILES_JS}
  const tileButton = (t, x) => h('button', { type: 'button', class: 'bt bt-tile', 'data-tile': x.id, style: '--sc:' + colorOf(t), on: { click: () => pickButton(t, { id: x.id, kind: 'start', label: x.label, base: x.base, listen: x.listen, start: x.start }) } },
    h('span', { class: 'ta', html: tileArt(t.mark, x.id) }), h('span', { class: 'btx' }, x.label));
  /** 牌上的卡排成一张网格:方砖、家长排的(照他排的先后)、常驻的听写与拍照听写 */
  const cardGrid = (t, tiles, buttons, extras) => h('div', { class: 'tls' }, ...(Array.isArray(tiles) ? tiles : []).map((x) => tileButton(t, x)), ...buttons.map((b) => tutorButton(t, b)), ...extras);
  /** 小课堂海报的图:课包画最后一帧(frame.svg,没烤好时 404 就只留底色和播放键),视频停在末尾前一点 */
  const lecturePic = (b) => {
    const box = h('span', { class: 'lp' });
    if (b.video) { if (b.ms) box.append(lcVideoStill(b.bundle, b.ms)); }
    else box.append(h('img', { alt: '', src: lcBundleUrl(b.bundle) + 'frame.svg?svg=end', on: { error: () => box.classList.add('nopic') } }));
    box.append(h('span', { class: 'pl', html: ICON.play }));
    return box;
  };

  // ---- 首页:桌上一本书(#deck),一位老师一章(#pages 里一位一张 .pc,只有 .front 摊开);老师是屏幕左下角的便利贴小旗(#tabs) ----
  // 小旗的先后照家长排的,进首页时排第一的那章摊开;点小旗翻到那一章,左右划翻到相邻的一章,小旗不挪;从老师页回来不变,刷新页面回到排第一的。
  // 牌与小旗的元素常驻,5 秒一轮的刷新只在内容变了时重画、不放动画
  const K = { front: null, names: [], els: new Map(), tabs: new Map(), busy: false };
  // 从牌上去了别的页(听写、拍照听写),回来是整页重开、K.front 没了:走之前记下是哪位的牌,下一次进首页读一次就删(「回来停在刚才那位」;刷新照旧回家长排的)
  const FRONT_KEY = 'kid-home-front';
  const stashFront = (el) => { if (PREVIEW) return; const pc = el && el.closest && el.closest('[data-tutor]'); try { if (pc) sessionStorage.setItem(FRONT_KEY, pc.dataset.tutor); } catch {} };
  const takeFront = () => { if (PREVIEW) return null; let f = null; try { f = sessionStorage.getItem(FRONT_KEY); sessionStorage.removeItem(FRONT_KEY); } catch {} return f; };
  const reduced = () => Boolean(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  // 橙点「看过了」记在这台设备上(换了一份首页就清):家长排了东西、孩子还没翻过这一章时亮在他的小旗上,翻到就灭
  const SEEN_KEY = 'kid-home-seen';
  const seenOf = (home) => { try { const j = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); return j.home === home && Array.isArray(j.tutors) ? j.tutors : []; } catch { return []; } };
  const markSeen = (home, name) => { if (PREVIEW) return; try { const t = seenOf(home); if (!t.includes(name)) localStorage.setItem(SEEN_KEY, JSON.stringify({ home, tutors: [...t, name] })); } catch {} };
  const homeTutorsOf = (H) => {
    const byName = new Map(H.tutors.map((t) => [t.name, t]));
    return (Array.isArray(H.cards) ? H.cards : []).filter((c) => c.kind === 'tutor' && byName.has(c.props.tutor)).map((c) => ({ t: byName.get(c.props.tutor), card: c }));
  };
  /** 首页怎么摆:横屏左右两页,竖屏和手机上下两页(和老师页同一个 deviceFor) */
  const homeDev = () => { const d = debug.get('device') || deviceFor(innerWidth, innerHeight); $('#home').dataset.dev = d === 'phone' ? 'phone' : d === 'tablet-portrait' ? 'portrait' : 'landscape'; };
  // ---- 家长端「首页」里的预览:S.pv = {tutor, sel, edit: {k, kind, label, until} | null},家长页塞进来的,只在预览里 ----
  const pvHost = () => { try { return window.parent !== window && typeof window.parent.cotutorPreview === 'function' ? window.parent : null; } catch { return null; } };
  const pvTell = (ev) => { const host = pvHost(); if (host) host.cotutorPreview(ev); };
  /** 牌上的按钮换上家长正改着的那颗(字、留到);没在改就是孩子此刻拿到的 */
  const pvButtons = (n, list) => {
    const P = PREVIEW && S.pv && S.pv.tutor === n ? S.pv : null;
    if (!P || !P.edit) return list;
    const today = S.home && S.home.date;
    const E = P.edit, gone = E && E.until && today && E.until < today;
    let out = list.map((b) => (E && b.id === E.k ? { ...b, label: E.label } : b)).filter((b) => !(gone && E && b.id === E.k));
    if (E && !gone && !out.some((b) => b.id === E.k)) out.push({ kind: 'start', label: E.label, id: E.k });
    return out;
  };
  if (PREVIEW) {
    window.cotutorPreviewSet = (o) => {
      if (!o) return;
      if ('pv' in o) S.pv = o.pv;
      // 发布了(按钮、先后、开关):重读孩子的首页;在看的那位还在就停在他
      if (o.reload) { loadHome().then(() => { if (o.front && K.names.includes(o.front)) K.front = o.front; if (S.home && !S.tutor) renderHome(); }); return; }
      if (o.front && K.names.includes(o.front)) K.front = o.front;
      if (S.home && !S.tutor) renderHome();
    };
    // 点牌上的按钮不跳走,告诉家长页点了哪颗;小旗照孩子端翻章(翻完 pickTutor 里告诉家长页);别的点了什么都不做
    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('#tabs .tab')) return;
      const pc = e.target.closest ? e.target.closest('#deck .pc') : null;
      e.preventDefault(); e.stopPropagation();
      const bt = pc ? e.target.closest('.bt') : null;
      if (!bt) return;
      const bid = bt.dataset.bid;
      if (bt.dataset.tile) pvTell({ act: 'tile', tutor: pc.dataset.tutor, id: bt.dataset.tile });
      else if (bid !== undefined) pvTell({ act: 'button', tutor: pc.dataset.tutor, id: Number(bid) });
      else pvTell({ act: 'extra', tutor: pc.dataset.tutor, kind: 'dictation' });
    }, true);
  }
  const TD_CLIP = '<svg viewBox="0 0 20 44" aria-hidden="true"><path d="M6 30 V8 A4 4 0 0 1 14 8 V34 A6 6 0 0 1 2 34 V14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path></svg>';
  /** 右页:今天在这位老师这儿开了头的话题(服务端给的 today,新的在前),一样一张;超过六张换小一号、一行三张。预览里不放(那是孩子的东西) */
  const todayOf = (H, t) => (PREVIEW || !Array.isArray(H.today) ? [] : H.today.filter((x) => x.tutor === t.name));
  const todayCard = (t, x) => h('button', { type: 'button', class: 'td', 'data-thread': x.thread, on: { click: () => openTutor(t, { kind: 'thread', thread: x.thread }) } },
    h('span', { class: 'clip', html: TD_CLIP }),
    h('span', { class: 'pic' }, x.image ? h('img', { src: x.image, alt: '', loading: 'lazy', decoding: 'async' }) : null),
    h('span', { class: 'lb' }, h('b', {}, x.lesson ? x.label + ' · ' + x.lesson : x.label), h('small', {}, clock(x.at))));
  /** 每位老师一章(左页入口的图画框、右页今天的和底纹)、一张小旗(头像和学科) */
  const renderDeck = (H, list) => {
    const pages = $('#pages'), tabs = $('#tabs');
    const front = K.front;
    const seen = seenOf(H.home);
    for (const [n, el] of K.els) if (!K.names.includes(n)) { el.remove(); K.els.delete(n); }
    for (const [n, el] of K.tabs) if (!K.names.includes(n)) { el.remove(); K.tabs.delete(n); }
    for (const { t, card } of list) {
      const n = t.name;
      const buttons = pvButtons(n, Array.isArray(card.props.buttons) ? card.props.buttons : []);
      const tiles = Array.isArray(card.props.tiles) ? card.props.tiles : [];
      const owned = (Array.isArray(H.cards) ? H.cards : []).filter((c) => c.kind !== 'tutor' && c.owner === n);
      const done = todayOf(H, t);
      const sig = JSON.stringify([t.subject, t.display, t.color, t.mark, buttons, tiles, owned, t.extras, H.home, done.map((x) => [x.thread, x.image, x.label, x.lesson || '', x.at])]);
      let el = K.els.get(n);
      if (!el) {
        el = h('div', { class: 'c c-tutor pc', 'data-tutor': n, on: { click: (e) => { if (e.target.closest && e.target.closest('a[href]')) stashFront(el); } } });
        K.els.set(n, el);
      }
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        el.style.setProperty('--sc', colorOf(t));
        el.replaceChildren(
          h('div', { class: 'lp' }, h('div', { class: 'kc' }, cardGrid(t, tiles, buttons, extrasFor(t, H)))),
          h('div', { class: 'rp' }, h('span', { class: 'hmark', html: markArt(t) }), h('div', { class: 'rh' }, '今天'), h('div', { class: 'tds' + (done.length > 6 ? ' many' : '') }, ...done.map((x) => todayCard(t, x)))),
        );
      }
      el.classList.toggle('front', n === front);
      if (PREVIEW) for (const b of el.querySelectorAll('.bt')) b.classList.toggle('pv-sel', Boolean(S.pv && S.pv.tutor === n && S.pv.sel !== null && S.pv.sel !== undefined && String(S.pv.sel) === b.dataset.bid));
      // 小旗:头像(不画 C 环),下面写学科
      let tb = K.tabs.get(n);
      if (!tb) { tb = h('button', { type: 'button', class: 'tab', 'data-tutor': n, on: { click: () => pickTutor(n) } }); K.tabs.set(n, tb); }
      const tsig = JSON.stringify([t.avatar, t.subject, t.display, t.color]);
      if (tb.dataset.sig !== tsig) {
        tb.dataset.sig = tsig;
        tb.style.setProperty('--sc', colorOf(t));
        tb.setAttribute('aria-label', t.display);
        tb.replaceChildren(avatarEl(t), h('span', { class: 'sub' }, t.subject || t.display));
      }
      tb.classList.toggle('front', n === front);
      const dot = Boolean(card.props.news) && n !== front && !seen.includes(n), had = tb.querySelector('.dot');
      if (dot && !had) tb.append(h('span', { class: 'dot' })); else if (!dot && had) had.remove();
    }
    // 照家长排的先后摆;先后没变就不动:append 已在页上的元素是摘下来再放回去,图和视频会重新加载(5 秒一轮的刷新时一直闪)
    const place = (parent, els) => { if (parent.children.length !== els.length || els.some((el, i) => parent.children[i] !== el)) parent.append(...els); };
    place(tabs, K.names.map((n) => K.tabs.get(n)));
    place(pages, K.names.map((n) => K.els.get(n)));
  };
  /** 翻到 n 那一章:这章的书页顺着翻的方向滑走,那一章从另一边进来;dir 不给就照小旗的先后定(往后翻 = 往左滑) */
  const pickTutor = (n, dir) => {
    const H = S.home;
    if (!H || K.busy || n === K.front || !K.names.includes(n)) return;
    const from = K.els.get(K.front);
    dir = dir || (K.names.indexOf(n) > K.names.indexOf(K.front) ? 1 : -1);
    const land = () => {
      K.front = n; markSeen(H.home, n); renderHome();
      if (PREVIEW) pvTell({ act: 'front', tutor: n });
      const to = K.els.get(n);
      if (to && !reduced()) to.animate([{ translate: dir * 120 + 'px 0', opacity: 0 }, { translate: '0 0', opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.2,.8,.3,1)' });
    };
    if (!from || reduced()) { land(); return; }
    K.busy = true;
    const dx = parseFloat(from.style.translate) || 0;
    from.animate([{ translate: dx + 'px 0', opacity: Math.max(0.4, 1 - Math.abs(dx) / 900) }, { translate: -dir * 700 + 'px 0', opacity: 0 }], { duration: 180, easing: 'ease-in' }).finished.then(() => { from.style.translate = ''; from.style.opacity = ''; K.busy = false; land(); }, () => { K.busy = false; });
  };
  // ---- 左右划翻章:横着走过 8px 且横向多于竖向才算划(竖着的交给滚动);书页跟着手指走,过 60px 松手就翻;到头了只跟三成再弹回。笔不翻(pointerType pen) ----
  const SW = { p: null };
  $('#pages').addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen' || K.busy || PREVIEW || !K.front || (e.button !== undefined && e.button !== 0)) return;
    SW.p = { id: e.pointerId, x: e.clientX, y: e.clientY, horiz: null, dx: 0 };
  });
  $('#pages').addEventListener('pointermove', (e) => {
    const p = SW.p;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (p.horiz === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) { p.horiz = Math.abs(dx) > Math.abs(dy); if (p.horiz) { try { $('#pages').setPointerCapture(e.pointerId); } catch {} } else { SW.p = null; return; } }
    if (!p.horiz) return;
    const i = K.names.indexOf(K.front), edge = (dx > 0 && i === 0) || (dx < 0 && i === K.names.length - 1);
    p.dx = edge ? dx * 0.3 : dx;
    const el = K.els.get(K.front);
    if (el) { el.style.translate = p.dx + 'px 0'; el.style.opacity = String(Math.max(0.4, 1 - Math.abs(p.dx) / 900)); }
  });
  const swipeEnd = (e) => {
    const p = SW.p;
    if (!p || p.id !== e.pointerId) return;
    SW.p = null;
    if (!p.horiz) return;
    // 划过的这一下不算点(手指起落在同一张卡上时浏览器还会发 click)
    const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', eat, { capture: true }), 300);
    const dir = p.dx < 0 ? 1 : -1, next = K.names[K.names.indexOf(K.front) + dir];
    if (Math.abs(p.dx) > 60 && next) { pickTutor(next, dir); return; }
    const el = K.els.get(K.front);
    if (!el) return;
    el.animate([{ translate: p.dx + 'px 0', opacity: el.style.opacity || 1 }, { translate: '0 0', opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.2,.8,.3,1)' });
    el.style.translate = ''; el.style.opacity = '';
  };
  $('#pages').addEventListener('pointerup', swipeEnd);
  $('#pages').addEventListener('pointercancel', swipeEnd);
  window.addEventListener('resize', () => { clearTimeout(S.homeResize); S.homeResize = setTimeout(homeDev, 150); });
  const renderHome = () => {
    const H = S.home;
    document.title = H.title; $('#title').textContent = H.title;
    homeDev();
    const cards = Array.isArray(H.cards) ? H.cards : [];
    const list = homeTutorsOf(H);
    const names = list.map((x) => x.t.name);
    $('#deck').hidden = !names.length; $('#tabs').hidden = !names.length;
    if (names.length) {
      const deal = S.homeDraw; S.homeDraw = false;
      if (deal) ctReplay(ctMark, 'ct-draw'); // 打开首页、从老师页回来:logo 一笔写出来
      // 老师变了(开了、关了、换了先后)照家长排的重来,排第一的那章摊开;刚从牌上去了别的页回来的停在那位
      if (names.join() !== K.names.join()) {
        const f = K.front && names.includes(K.front) ? K.front : takeFront();
        K.names = names;
        K.front = f && names.includes(f) ? f : names[0];
      }
      renderDeck(H, list);
      if (deal) markSeen(H.home, K.front);
    }
    // 公共的听写卡(写在第一张老师卡前面、没写念的老师)在书上面;归了老师的在那位老师的牌里(听写按钮)
    $('#hcards').replaceChildren(...cards.filter((c) => c.kind !== 'tutor' && !c.owner).map(homeCard));
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
  /** 嘴连不上时:要家长动手的(欠费、key 失效,服务端的 ready 变 false)回首页说「叫爸爸妈妈」,别的(网络抖)留在原地接着重连 */
  const gateCheck = async () => {
    if (REEL) return;
    try { const d = await api('GET', '/api/kid/home'); if (d.ready === false) { S.home = d; setGated(true); renderHome(); } } catch {}
  };
  /** 百炼没配、欠费、key 失效:首页的老师灰着点不进去;在老师页上就回首页。家长弄好了下一次读首页自己就好 */
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
   * intent(首页的按钮定的):new = 按钮开的新话题(activity、方砖、小课堂);thread = 今天的那个话题(首页「今天」);today = 今天的当前话题(调试入口 ?tutor=)。
   * via = 哪个按钮(下一条消息带上);send = 打开就发出去的字(老师先说的 activity:按钮上的字);enter = 孩子先说:进门(服务端记下、铺好页,不叫老师)
   */
  const openTutor = (t, intent) => {
    unlock();
    intent = intent || { kind: 'today' };
    S.tutor = t; S.sections = []; S.played = new Set(); dispatch({ type: 'reset' }); S.pending = false; S.stage = null; S.partial = null; $('#stage').classList.remove('on', 'cv');
    S.thread = intent.kind === 'thread' ? intent.thread : null; S.threadAt = null; S.hist = null; S.readonly = false; S.newThread = intent.kind === 'new';
    S.via = intent.via || null; S.lecture = intent.lecture ? { ...intent.lecture, watch: null, sent: false, marks: [], done: [], log: [] } : null;
    BP.on = Boolean(intent.base); BP.base = intent.base || null; BP.label = intent.label || ''; BP.toc = null; BP.workbook = intent.workbook || null; BP.start = intent.start || null; S.door = null; lsReset();
    if (BP.base === 'photo') bpBooks();
    // 先定走不走实时,再热麦克风:实时时麦克风的自检要开在实时那个 AudioContext 里(liveOpen)
    if (liveWanted(t)) liveOpen(intent); else liveClose();
    renderBar(); renderHeader();
    liveFace(t); tintBack(t); markBoard($('#bmark'), t);
    $('#board').replaceChildren();
    // 小课堂:页上先铺那堂课(服务端收到第一条时照同样的规矩铺)
    if (S.lecture) lsStart(lessonStep(lessonInit(), { t: 'act', act: { k: '翻', page: lcPage(S.lecture) } }));
    // 进门:舞台先铺上(不露空的老师页),服务端记下、铺好页再照它铺
    else if ((BP.base === 'textbook' || BP.base === 'workbook') && intent.enter) lsOpenStage();
    else if (BP.base === 'textbook' || BP.base === 'workbook') bpOpenLesson();
    else if (BP.base === 'photo') $('#board').append(bpStartBoard());
    $('#tutor').classList.add('on'); pageTheme(false);
    setBar('idle');
    loadDay(true).then(() => { if (intent.send) send(intent.send); else if (intent.enter) bpEnter(0); });
    viewKey = ''; viewNote();
  };
  /** 空板挂上老师要说的(开场那句 big、下面一行 small、选择 acts:{cls, icon, k 上面的小字, s 大字, sub 下面的小字, tm 时刻, id, go}) */
  const withOpen = (el, o) => { el._open = o; return el; };
  const tutorColor = () => colorOf(S.tutor);
  // ---- 一节课铺的页:base: textbook 进来铺课本的目录;base: photo 进来先拍照(或不拍用白纸),照片一发就铺上照片页、不等老师;页一直在,点回首页才结束 ----
  /** 拍照屏:拍一页、从相册选、不拍用白纸(左栏照 _open 画同样三颗) */
  const bpStartBoard = () => {
    const go = (cls, icon, label, f) => h('button', { type: 'button', class: 'ask-go ' + cls, style: cls === 'fresh' ? 'background:' + tutorColor() : 'color:' + tutorColor() + ';border-color:' + tutorColor(), on: { click: f } }, h('span', { class: 't' }, h('span', { class: 'ic', html: ICON[icon] }), label));
    return withOpen(h('div', { class: 'blank ask bp-start' }, avatarEl(S.tutor, 'draw'), h('span', { class: 'nm' }, S.tutor.display), h('b', {}, '先拍一页给老师看'), h('small', {}, '拍正一点,整页都拍进来;没有要拍的,就用白纸'),
      h('div', { class: 'ask-row' }, go('fresh', 'camera', '拍照', () => bpPick(true)), go('back', 'album', '从相册选', () => bpPick(false)), go('back', 'spark', '不拍,用白纸', bpWhite))),
      { kind: 'board', big: '先拍一页给老师看', small: '拍正一点,整页都拍进来;没有要拍的,就用白纸', acts: [
        { cls: 'fresh', icon: 'camera', s: '拍照', go: () => bpPick(true) },
        { cls: 'back', icon: 'album', s: '从相册选', go: () => bpPick(false) },
        { cls: 'back', icon: 'spark', s: '不拍,用白纸', go: bpWhite }] });
  };
  /** 这位老师学科的课本页(vault 里教材旁边的图):有就在拍照屏和页的顶栏多一颗「选课本页」 */
  const bpBooks = () => {
    const name = S.tutor && S.tutor.name;
    BP.books = [];
    $('#st-tb').hidden = true;
    if (!name) return;
    api('GET', '/api/kid/textbook-pages?tutor=' + encodeURIComponent(name)).then((j) => {
      if (!S.tutor || S.tutor.name !== name || !j || !Array.isArray(j.books) || !j.books.length) return;
      BP.books = j.books;
      $('#st-tb').hidden = false;
      const blank = $('#board .bp-start');
      if (!blank) return;
      const row = blank.querySelector('.ask-row');
      if (row && !row.querySelector('.tb-go')) row.insertBefore(h('button', { type: 'button', class: 'ask-go back tb-go', style: 'color:' + tutorColor() + ';border-color:' + tutorColor(), on: { click: tbkOpen } }, h('span', { class: 't' }, h('span', { class: 'ic', html: ICON.album }), '选课本页')), row.children[1] || null);
      if (blank._open && !blank._open.acts.some((a) => a.s === '选课本页')) { blank._open.acts.splice(1, 0, { cls: 'back', icon: 'album', s: '选课本页', go: tbkOpen }); LO.el = undefined; openSync(); }
    }, () => {});
  };
  /** 选课本页:一册一段,一页一格;点一页 → 拷进 captures/ → 当孩子拍的照片发、铺上照片页 */
  const tbkOpen = () => {
    if (!S.tutor || S.pending || S.readonly || !BP.books.length) return;
    unlock();
    const pick = async (book, page, el) => {
      if (el.classList.contains('busy') || !S.tutor || S.pending || !canSend()) return;
      el.classList.add('busy');
      try {
        const r = await api('POST', '/api/kid/textbook-page', { book, file: page.file });
        $('#tbk').classList.remove('on');
        const b = $('#board .blank'); if (b) b.remove();
        send('', { photos: [r.path] });
        bpPhotos([r]);
      } catch { el.classList.remove('busy'); }
    };
    $('#tbk .ls').replaceChildren(...BP.books.flatMap((bk) => [h('h3', {}, bk.book), h('div', { class: 'pgs' }, ...bk.pages.map((pg) => { const el = h('button', { type: 'button', class: 'pg' }, h('img', { src: '/api/kid/textbook-page?b=' + encodeURIComponent(bk.book) + '&f=' + encodeURIComponent(pg.file), alt: '', loading: 'lazy' }), h('span', {}, pg.n != null ? '第 ' + pg.n + ' 页' : pg.file)); el.addEventListener('click', () => pick(bk.book, pg, el)); return el; }))]));
    $('#tbk').classList.add('on');
  };
  $('#tbk-x').innerHTML = ICON.close;
  $('#tbk-x').addEventListener('click', () => $('#tbk').classList.remove('on'));
  $('#st-tb').innerHTML = ICON.album + '<span>课本</span>';
  $('#st-tb').addEventListener('click', tbkOpen);
  /**
   * 进门(孩子先说):服务端记一条「进门」、铺好页,回话题 id;之后孩子说的、拍的、按「给老师看」都接着这个话题,第一条才叫老师。
   * 老师还在回上一条(409)隔一会儿再进;进门回来之前孩子已经开口开了话题的,就用那个(进门那个没开口,下次进门扫掉)
   */
  const bpEnter = (tries) => {
    const t = S.tutor;
    if (!t || !S.newThread || !S.via) return;
    api('POST', '/api/kid/enter?tutor=' + encodeURIComponent(t.name), { via: S.via, device: S.device }).then((j) => {
      if (S.tutor !== t || !S.newThread || !j || !j.thread) return;
      S.thread = j.thread; S.door = j.thread; S.newThread = false; S.via = null;
      if (BP.on && BP.base !== 'photo') bpOpenLesson(true);
      loadDay(false);
    }, (e) => { if (S.tutor === t && e && e.status === 409 && tries < 30) setTimeout(() => bpEnter(tries + 1), 1000); });
  };
  /** 点回首页:这次进的门孩子没开口,就不存(服务端只删只进了门的话题) */
  const bpLeave = () => {
    const t = S.tutor, th = S.door;
    S.door = null;
    if (t && th) api('POST', '/api/kid/leave?tutor=' + encodeURIComponent(t.name), { thread: th }).catch(() => {});
  };
  /** 拍照 / 相册:一个现做的 file input(和输入条的相机同一套 wireFile),拍完进发照片屏;发出去时铺上照片页(ps-go) */
  const bpPick = (camera) => {
    if (!S.tutor || S.pending || S.readonly) return;
    unlock();
    const f = h('input', camera ? { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' } : { type: 'file', accept: 'image/*', style: 'display:none' });
    wireFile(f);
    f.addEventListener('change', () => setTimeout(() => f.remove(), 0));
    document.body.append(f);
    f.click();
  };
  /** 不拍:铺一张白纸页,进门等孩子先说(服务端进门时也铺白纸,两边一样);老师先说的(start: tutor)照旧发方砖上的字开话题 */
  const bpWhite = () => {
    if (!S.tutor || S.pending || !canSend()) return;
    const b = $('#board .blank'); if (b) b.remove();
    if (BP.start === 'tutor') send(BP.label || '开始'); else bpEnter(0);
    lsStart(lessonStep(lessonInit(), { t: 'act', act: { k: '翻', page: { id: '白纸', kind: 'white', title: '白纸', pick: false } } }));
  };
  /** 孩子拍来了几张(上传时服务端回了宽高):先落在自己这一份上,接在照片页后面——不等老师(服务端收到这一条时照同样的规矩铺) */
  const bpPhotos = (list) => {
    if (BP.base !== 'photo') return;
    const photos = list.filter((x) => x && x.path && x.w > 0 && x.h > 0).map((x) => ({ src: x.path, w: x.w, h: x.h }));
    if (!photos.length) return;
    // 数学的照片上点的是数和算式,不弹田字格(同服务端)
    const ev = { t: 'photo', photos, pick: !(S.tutor && S.tutor.subject === '数学') };
    if (LS.on && LS.l) { LS.l = lessonStep(LS.l, ev); lsShow(); return; }
    lsStart(lessonStep(lessonInit(), ev));
  };
  /** 进一节课:回到的(有话题)照服务端记的;新开的课本铺目录,作业照片等孩子拍(拍照屏)。
   *  课本、回到的课:舞台先铺上再去要(不先露一下空的老师页;iframe 和这一问一起装),要回来没有课再收起。
   *  课本做底的(回到的也是)一起要目录上能点的那几项(BP.toc:点了铺哪一页、印在哪一行),拿到了再铺;
   *  练习册:新开的照按钮挂的那一册(BP.workbook)先铺上,不等老师。opened = 舞台是进门时先铺开的(要回来没有课一样收起) */
  const bpOpenLesson = (opened) => {
    const name = S.tutor && S.tutor.name;
    if (!name || LS.asking) return;
    LS.asking = true;
    const q = S.thread && S.day && S.day.date ? '/api/kid/lesson?tutor=' + encodeURIComponent(name) + '&date=' + encodeURIComponent(S.day.date) + '&thread=' + encodeURIComponent(S.thread) : null;
    const early = Boolean(opened) || ((q || BP.base === 'textbook' || (BP.base === 'workbook' && BP.workbook)) && !S.stage);
    if (early && !S.stage) lsOpenStage();
    const open = (l) => {
      LS.asking = false;
      if (!S.tutor || S.tutor.name !== name || !BP.on) return;
      if (l) { lcAdopt(l); lsStart(l); } else if (early && S.stage && S.stage.lesson && !LS.on) closeStage();
    };
    const base = BP.base === 'textbook' ? api('GET', '/api/kid/textbook/base?tutor=' + encodeURIComponent(name)).then((j) => { if (S.tutor && S.tutor.name === name) BP.toc = (j && j.toc) || null; return j; }, () => null)
      : BP.base === 'workbook' && BP.workbook ? api('GET', '/api/kid/workbook/base?tutor=' + encodeURIComponent(name) + '&w=' + encodeURIComponent(BP.workbook)).catch(() => null)
      : Promise.resolve(null);
    const toc = () => base.then((j) => open(j && j.lesson));
    if (q) api('GET', q).then((j) => (j && j.lesson ? base.then(() => open(j.lesson)) : toc()), toc); else toc();
  };
  /** 拉了今天的话题以后:这节课一直听(第一条记着 listen,activity 头上写的)而这会儿是按住说,换过去(回到这节课、刷新页面) */
  const listenSync = (mine) => {
    if (S.readonly || REEL || !LV.on || LV.model.open) return;
    if (mine.some((m) => m.listen === 'open')) liveDispatch({ type: 'listen', open: true });
  };
  /** 拉了今天的话题以后:这个话题是一节课(第一条记着 base)就把页摆出来(回到这个话题、刷新页面) */
  const bpSync = (mine) => {
    if (S.newThread || S.readonly || REEL) return;
    const first = mine.find((m) => m.base);
    if (!first) { BP.on = false; return; }
    if (!BP.on && first.base === 'photo') bpBooks();
    BP.on = true; BP.base = first.base;
    if (!LS.on) bpOpenLesson(); else lsFeed();
  };
  // ---- 一节课(课本、作业照片、白纸都是):服务端记着一节课的状态(<date>.<话题>.lesson.json);这里照 lessonStep(src/board/lesson.ts,内联)把老师念过的那几句的动作落上,
  //      孩子在页上做的事也落上、报给服务端,变了就整份发给舞台画(舞台 book.tsx 只照状态画)。
  //      老师一节的动作:第一句前面的马上落;每一句的等它念完(下一句开始放、或嘴放完了)才落,落完记一句念完(said,圈、划、加点照它变旧);孩子打断、老师开了下一轮、不在实时里,没落的一下子都落上。
  //      新的一轮一来先收上一轮的圈、划、加点(round;同服务端定稿时的 lessonSection)。
  //      回到这节课、刷新:照服务端的(lesson.jobs 是已经落进去的那几轮,不再落) ----
  const LS = { on: false, l: null, seen: new Set(), job: null, lead: 0, lines: 0, key: '', inkAt: 0, recT: 0, recKey: '', idleT: 0, asking: false, playN: 0, lookKey: '' };
  /** 这一节此刻(流式的也算):板上的、还在写的 */
  const lsSection = (job) => (S.partial && S.partial.job === job && S.sections[S.partial.idx] ? S.sections[S.partial.idx] : S.sections.find((x) => x.job === job)) || null;
  const lsActs = (acts) => (acts || []).filter((a) => a && a.do);
  /**
   * 这一节的动作落到第 upTo 句为止(第一句前面的总是落);upTo = Infinity 全落。
   * unsaid:剩下的句子没念到(声音被掐了,孩子打断):圈、划、加点跟着话走,没说的不画;别的照落、句数照记(同服务端的 said)
   */
  const lsApply = (upTo, unsaid) => {
    if (!LS.l || !LS.job) return;
    const sec = lsSection(LS.job);
    if (!sec) return;
    const lead = lsActs(sec.acts);
    if (lead.length > LS.lead) { LS.l = lessonActs(LS.l, lead.slice(LS.lead)); LS.lead = lead.length; }
    const to = Math.min(upTo, sec.lines.length);
    for (; LS.lines < to; LS.lines++) {
      const acts = lsActs(sec.lines[LS.lines].acts);
      LS.l = lessonStep(lessonActs(LS.l, unsaid ? acts.filter((a) => !LESSON_CAPS.LINE_MARKS.includes(a.do.k)) : acts), { t: 'said' });
    }
  };
  /** 这一节都落完了:记下来,不再看它;unsaid = true 是声音被掐了,没念到的句子不画圈、划、加点 */
  const lsFinish = (unsaid) => {
    if (!LS.job) return;
    lsApply(Infinity, unsaid === true);
    LS.seen.add(LS.job); LS.l = lessonDone(LS.l, LS.job); LS.job = null; LS.lead = 0; LS.lines = 0;
    clearTimeout(LS.idleT); LS.idleT = 0;
    lsShow();
  };
  /** 写完了还没落完的一节:5 秒后嘴静着就都落上,还在说再等一回。已经在等就不重来(每次派发都会经过 lsTick) */
  const lsIdle = () => { if (LS.idleT) return; LS.idleT = setTimeout(() => { LS.idleT = 0; if (!LS.job) return; if (LV.model.status === 'mouth') lsIdle(); else lsFinish(); }, 5000); };
  /** 新的一节(还没落进来的):上一节没落完的先都落上,从这一节第一句前面的动作起 */
  const lsFeed = () => {
    if (!LS.on || !LS.l) return;
    for (const sec of S.sections) {
      if (!sec || LS.seen.has(sec.job) || sec.job === LS.job) continue;
      if (!(sec.acts && sec.acts.some((a) => a && a.do)) && !sec.lines.some((x) => x.acts && x.acts.some((a) => a && a.do))) {
        if (LS.job) lsFinish();
        LS.l = lessonStep(LS.l, { t: 'round' });
        if (!sec.partial) LS.seen.add(sec.job);
        continue;
      }
      if (LS.job) lsFinish();
      LS.l = lessonStep(LS.l, { t: 'round' });
      LS.job = sec.job; LS.lead = 0; LS.lines = 0;
    }
    if (LS.job) lsApply(0);
    lsTick();
  };
  /** 这一句开始放了:它前面那几句念完了,落它们的动作 */
  const lsRead = (job, line) => { if (LS.on && LS.job === job) { lsApply(line); lsShow(); } };
  /** 嘴不在说了:这一节写完了、最后一句也放过了,就都落上;不在实时里、只读的马上落;嘴静下来久了也落(念不出来的那几句) */
  const lsTick = () => {
    if (!LS.on || !LS.job) { lsShow(); return; }
    const sec = lsSection(LS.job);
    const done = sec && !sec.partial && !(S.partial && S.partial.job === LS.job);
    if (!LV.on || S.readonly || REEL) { lsFinish(); return; }
    if (done && LV.model.status !== 'mouth' && (LS.lines >= sec.lines.length - 1 || !sec.lines.length)) { lsFinish(); return; }
    // 写完了还没落完:嘴静下来 5 秒就都落上;那时嘴还在说就再等一回(嘴说完不一定再经过这里)
    if (done) lsIdle();
    lsShow();
  };
  /** 这节课此刻的样子发给舞台(变了才发);录像记一份(停一下再记,只记变了的) */
  const lsShow = () => {
    if (!LS.on || !LS.l || !S.stage || !S.stage.lesson) return;
    const p = lessonPage(LS.l);
    // 老师「看」了别处、翻了页:点字的卡收起来
    const lookKey = (LS.l.look ? LS.l.look.n : 0) + '|' + LS.l.at;
    if (LS.lookKey !== lookKey) { if (LS.lookKey) pickHide(); LS.lookKey = lookKey; }
    $('#st-ttl').textContent = p && p.kind === 'book' && p.title !== '目录' ? p.title : '';
    // 课本的目录:能点的那几项交给舞台;一课里顶栏有「目录」回去(这本书读出了目录才有)
    const tocOf = p && p.kind === 'book' && BP.toc && BP.toc.page && BP.toc.page.src === p.src && !S.readonly && !REEL;
    const tocOn = tocOf && p.title === '目录';
    $('#st-toc').hidden = !tocOf || p.title === '目录';
    // 上一课、下一课:一课里才有(目录上没有);下一课也交给舞台,在这一课最后一页下面摆一行
    const nb = tocOf && p.title !== '目录' && S.thread ? bpNeighbors(p) : { prev: null, next: null };
    BP.nb = nb;
    $('#st-nav').classList.toggle('on', Boolean(tocOf && p.title !== '目录'));
    $('#st-prev').hidden = !nb.prev; $('#st-next').hidden = !nb.next;
    if (nb.prev) $('#st-prev').setAttribute('aria-label', '上一课:' + nb.prev.title);
    if (nb.next) $('#st-next').setAttribute('aria-label', '下一课:' + nb.next.title);
    // 小课堂那一页:播放器有自己的课名、进度条、画一画,页面的「给老师看」不出
    $('#stage').classList.toggle('lcp', Boolean(p && p.kind === 'lecture'));
    // 翻走了:这一页的点读作废
    if (RD.at && RD.at !== LS.l.at) readForget();
    const read = readView();
    const key = JSON.stringify(LS.l) + (tocOn ? '|toc' : '') + '|' + JSON.stringify(read) + '|' + (nb.next ? nb.next.title : '');
    renderGo();
    if (key === LS.key) return;
    LS.key = key;
    postStage({ type: 'lesson', id: S.stage.id, lesson: LS.l, readonly: S.readonly || REEL, hand: document.body.classList.contains('hand-left') ? 'left' : 'right', color: tutorColor(), ...(TRIAL ? { mousePen: true } : {}), ...(tocOn ? { toc: { color: tutorColor(), entries: BP.toc.entries.map((e) => ({ title: e.title, box: e.box })) } } : {}), ...(nb.next ? { next: { title: nb.next.title } } : {}), ...(read ? { read } : {}), ...(p && p.kind === 'lecture' ? { lecture: { url: lcBundleUrl(p.bundle, p.video), marks: S.lecture && S.lecture.bundle === p.bundle ? S.lecture.marks : [], follow: REEL, ...(LS.playN ? { play: LS.playN } : {}) } } : {}) });
    if (!REEL && !S.readonly) { clearTimeout(LS.recT); LS.recT = setTimeout(() => { const k = JSON.stringify(LS.l); if (k !== LS.recKey && S.thread) { LS.recKey = k; playRec({ k: 'lesson', l: LS.l }); } }, 1500); }
  };
  /** 页铺满:舞台开一次,之后只换状态 */
  const lsOpenStage = () => {
    if (S.stage && S.stage.lesson) { lsShow(); return; }
    if (S.stage) closeStage();
    S.stage = { section: -1, card: -1, id: 'lesson:' + (S.thread || 'new'), lesson: true, playing: null, delegate: false, autoplay: false };
    $('#st-ttl').classList.remove('open');
    $('#stage').classList.add('cv', 'bp', 'bk', 'on');
    $('#stage').classList.toggle('ph', BP.base === 'photo');
    frame.hidden = false; frame.src = stageUrl(S.stage.id);
    LS.key = '';
    renderGo();
  };
  /** 进一节课:回到的(有话题)照服务端记的,新开的铺目录(课本)、照片页或白纸(作业);没有课本就空着,老师会说 */
  const lsStart = (l, jobs) => {
    LS.on = true; LS.l = l; LS.seen = new Set(jobs || (l && l.jobs) || []); LS.job = null; LS.lead = 0; LS.lines = 0; LS.key = '';
    LS.inkAt = l && lessonPage(l) ? lessonPage(l).kid.ink.length : 0;
    if (!l) return;
    lsOpenStage();
    lsFeed();
  };
  const lsReset = () => { readForget(); clearTimeout(LS.recT); clearTimeout(LS.idleT); LS.idleT = 0; LS.on = false; LS.l = null; LS.job = null; LS.key = ''; LS.recKey = ''; LS.asking = false; LS.playN = 0; };
  /** 孩子在页上做的事:先落在自己这一份上,再经实时那条连接报给服务端(它照样落进 lesson.json;base 不是它现在那一页就不落) */
  const lsKid = (ev, report) => {
    if (!LS.on || !LS.l || S.readonly || REEL) return;
    const base = LS.l.at;
    LS.l = lessonStep(LS.l, ev);
    lsShow();
    if (report && S.thread && base) lvSend({ t: 'board', body: { ...report, thread: S.thread, base } });
  };
  /** 「给老师看」能不能按:这一轮以后落了新的笔(课本上的、白纸条上的) */
  const lsInk = () => { const p = LS.l && lessonPage(LS.l); return p ? p.kid.ink.length + Object.values(p.kid.stripInk || {}).reduce((n, x) => n + x.length, 0) + Object.values(p.kid.cells || {}).reduce((n, x) => n + x.length, 0) : 0; };
  /** 舞台说话(一节课):落笔、擦掉、点字、揭开、挪窗、窗里的图、给老师看 */
  const lsStageMsg = (m) => {
    if (m.type === 'ready') { LS.key = ''; lsShow(); if (REEL && S.reel && S.reel.lcMsg) postStage(S.reel.lcMsg); return; }
    // 小课堂那一页:画了 / 擦了(整张单子)、看的过程、放完了、老师放的那一段放完了
    if (m.type === 'marks') { if (S.lecture && !S.readonly && !REEL && Array.isArray(m.marks)) { S.lecture.marks = m.marks; previewSoon(PV_HAND_MS); } return; }
    if (m.type === 'watch') { if (S.lecture && !S.readonly && !REEL && S.lecture.log.length < 500) S.lecture.log.push({ at: m.at, pos: m.pos, play: m.play }); return; }
    if (m.type === 'lecture') { lcWatched(m); return; }
    if (m.type === 'phase') { if (m.phase === 'done' && LS.playN) { LS.playN = 0; if (LV.model.status === 'lecture') liveDispatch({ type: 'lectureDone' }); } return; }
    // 课放不出来:还没看完的(刚从首页点进来)回首页;看过了的留着,老师会说
    if (m.type === 'error' && S.lecture && !S.lecture.watch && !S.readonly && !REEL) { closeTutor(); return; }
    if (m.type === 'peek') { previewGot(m.image); return; }
    if (m.type === 'stroke' && Array.isArray(m.pts)) { const strip = typeof m.strip === 'string' ? m.strip : undefined; lsKid({ t: 'stroke', pts: m.pts, ...(strip ? { strip } : {}) }, { k: 'stroke', pts: m.pts, ...(strip ? { strip } : {}) }); previewSoon(PV_HAND_MS); return; }
    if (m.type === 'turn' && typeof m.item === 'string' && typeof m.deg === 'number') { lsKid({ t: 'turn', item: m.item, deg: m.deg }, { k: 'turn', item: m.item, deg: m.deg }); previewSoon(PV_HAND_MS); return; }
    if (m.type === 'wipe') { lsKid({ t: 'wipe' }, { k: 'wipe' }); previewSoon(PV_HAND_MS); return; }
    // 课本的田字格里写好了一个字(放好):落进孩子的一层、报给服务端(请着写的时候它替他交)
    if (m.type === 'cell' && typeof m.id === 'string' && Array.isArray(m.strokes)) { const model = typeof m.model === 'string' ? m.model : ''; lsKid({ t: 'cell', id: m.id, strokes: m.strokes }, { k: 'cell', id: m.id, strokes: m.strokes, ...(model ? { text: model } : {}), ...(m.blank === true ? { blank: true } : {}) }); previewSoon(PV_HAND_MS); return; }
    if (m.type === 'pickAt') { if (!$('#st-pick').hidden) { if (Array.isArray(m.at)) pickPlace(m.at); else pickHide(true); } return; }
    if (m.type === 'pick') { pickShow(m.text, Array.isArray(m.at) ? m.at : null); lsKid({ t: 'pick', text: String(m.text || '') }, { k: 'pick', text: m.text }); return; }
    // 目录上点了一项:自己先翻过去,再报给服务端(它照样翻、记下,不叫老师);还没进门(话题还没有)的不翻
    if (m.type === 'open') { const e = BP.toc && S.thread ? BP.toc.entries.find((x) => x.title === m.title) : null; if (e) { pickHide(); lsKid({ t: 'act', act: { k: '翻', page: e.page } }, { k: 'open', title: e.title }); } return; }
    // 点了标题、段首的钮:点读
    if (m.type === 'read') { pickHide(); readTap(m); return; }
    if (m.type === 'reveal') { lsKid({ t: 'reveal', text: String(m.text || '') }, { k: 'reveal', text: m.text }); previewSoon(PV_HAND_MS); return; }
    if (m.type === 'view' && Array.isArray(m.box) && m.box.length === 4) { lsKid({ t: 'view', box: m.box }, { k: 'view', box: m.box }); previewSoon(PV_HAND_MS); return; }
    if (m.type === 'shot' && Array.isArray(m.box) && typeof m.image === 'string' && S.thread && LS.l && LS.l.at && !S.readonly && !REEL) { lvSend({ t: 'board', body: { k: 'shot', thread: S.thread, base: LS.l.at, box: m.box, image: m.image } }); return; }
    if (m.type === 'submit') {
      // 「给老师看」:窗里的图舞台已经先交了;轻点的直接发这一条,按住说的(CV.give)等松手那一下一起发
      const done = CV.give; CV.give = null;
      const patch = { action: 'submit' };
      LS.inkAt = lsInk(); renderGo();
      if (done) done(patch); else send('', patch);
      return;
    }
    if (m.type === 'pen' && S.thread && LS.l && LS.l.at && !S.readonly && !REEL) { lvSend({ t: 'board', body: { k: 'pen', thread: S.thread, base: LS.l.at } }); return; }
    if (m.type === 'close' || m.type === 'error') { /* 页铺不出来:舞台留着,老师会说 */ }
  };

  /**
   * 课本一课的上一课、下一课(目录上能点的那几项,照先后):下一课 = 后面第一项、它的页在这一课最后一页之后(诗嵌在课下面、页码重叠的跳过);
   * 上一课 = 前面那一项里「下一课」正好是这一课的第一个(没有就是紧挨着的前一项)。这一课不在目录上(老师翻到的小节):上一课是它落在的那一项,下一课照它的页往后找
   */
  const bpNeighbors = (p) => {
    const es = (BP.toc && BP.toc.entries) || [];
    const first = (e) => e.page.pages[0], last = (pages) => Math.max(...pages);
    const nextOf = (i, end) => { for (let k = i + 1; k < es.length; k++) if (first(es[k]) > end) return k; return -1; };
    let i = es.findIndex((e) => e.title === p.title);
    if (i < 0) {
      for (let k = 0; k < es.length; k++) if (first(es[k]) <= p.pages[0]) i = k;
      const n = nextOf(i, last(p.pages));
      return { prev: i >= 0 ? es[i] : null, next: n >= 0 ? es[n] : null };
    }
    const n = nextOf(i, last(p.pages));
    let pv = -1;
    for (let k = 0; k < i; k++) if (nextOf(k, last(es[k].page.pages)) === i) { pv = k; break; }
    if (pv < 0) pv = i - 1;
    return { prev: pv >= 0 ? es[pv] : null, next: n >= 0 ? es[n] : null };
  };
  /** 翻到目录上的另一项(上一课、下一课、一课最后那一行):自己先翻过去,再报给服务端(它照样翻、记下,不叫老师) */
  const bpGo = (e) => {
    if (!e || !LS.on || !LS.l || S.readonly || REEL || !S.thread) return;
    pickHide();
    lsKid({ t: 'act', act: { k: '翻', page: e.page } }, { k: 'open', title: e.title });
  };
  $('#st-prev').innerHTML = ICON.prev; $('#st-next').innerHTML = ICON.next;
  $('#st-prev').addEventListener('click', () => bpGo(BP.nb && BP.nb.prev));
  $('#st-next').addEventListener('click', () => bpGo(BP.nb && BP.nb.next));
  /** 课本的一课里按「目录」:翻回目录,窗停在这一课那一行;报给服务端(它照样翻,不叫老师) */
  $('#st-toc').innerHTML = ICON.toc + '<span>目录</span>';
  $('#st-toc').addEventListener('click', () => {
    if (!LS.on || !LS.l || !BP.toc || S.readonly || REEL || !S.thread) return;
    const p = lessonPage(LS.l), base = LS.l.at;
    if (!p || p.kind !== 'book' || p.title === '目录' || !base) return;
    const back = BP.toc.entries.find((x) => x.title === p.title);
    pickHide();
    LS.l = lessonStep(LS.l, { t: 'act', act: { k: '翻', page: BP.toc.page } });
    if (back) LS.l = lessonStep(LS.l, { t: 'view', box: back.box });
    lsShow();
    lvSend({ t: 'board', body: { k: 'open', title: '目录', thread: S.thread, base } });
  });
  /** 板上的拍照、相册:换一页 */
  $('#st-cam').innerHTML = ICON.camera + '<span>拍照</span>';
  $('#st-alb').innerHTML = ICON.album + '<span>相册</span>';
  $('#st-cam').addEventListener('click', () => bpPick(true));
  $('#st-alb').addEventListener('click', () => bpPick(false));
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
  /** 浏览器的主题色跟着这一页的底色:首页桌面色,老师页纸色 */
  const pageTheme = (home) => { const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = home ? '#ebe4d4' : '#faf9f4'; };
  const closeTutor = () => { bpLeave(); clearTimeout(PV.timer); liveDispatch({ type: 'reset' }); liveClose(); S.lecture = null; reelStop(); clearTimeout(S.pollTimer); dispatch({ type: 'halt' }); psClose(); S.tutor = null; S.via = null;  S.ask = null; BP.on = false; BP.base = null; BP.toc = null; lsReset(); $('#tutor').classList.remove('on'); pageTheme(true); document.body.classList.remove('pending', 'speaking'); S.homeDraw = true; loadHome(); };
  $('#back').addEventListener('click', closeTutor);
  $('#back-ic').innerHTML = ICON.back;

  // 首页公共的牌(写在第一张老师牌前面的听写牌):点了去 /dictation 听写页;不认得的(首页写错了)只显示原文
  const homeCard = (c) => {
    const p = c.props || {};
    if (c.kind !== 'dictation') return h('div', { class: 'c c-text' }, h('div', { class: 'cb' }, String(p.text || '')));
    // 卡上没有字,只有几个词。n = 首页里第几张听写卡
    const all = (S.home && Array.isArray(S.home.cards) ? S.home.cards : []).filter((x) => x.kind === 'dictation');
    const en = p.lang === 'en';
    const href = '/dictation?home=' + encodeURIComponent((S.home && S.home.home) || '') + '&n=' + Math.max(0, all.indexOf(c)) + (en ? '&lang=en' : '');
    return h('a', { class: 'c c-dictation', href }, h('span', { class: 'tg' }, h('i', {}), h('i', {})), h('span', { class: 'tx' }, h('b', {}, en ? '单词听写' : '听写'), h('span', {}, (p.count || 0) + (en ? ' 个单词' : ' 个词') + ' · 老师念,你来写')), h('span', { class: 'go' }, '去写'));
  };
  // ---- 点字弹的田字格:每字一个格,笔顺数据 /api/kid/tianzige/<字>(1024 见方、y 向上,组上 scale(1,-1) translate(0,-900) 摆正);
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
    const el = h('div', { class: 'hz', 'data-ch': ch, on: { click: (e) => { e.stopPropagation(); tianzigePlay(el.closest('.pk-hz'), el); } } }, svg);
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
  /** 写一格一格:按顺序一个字接一个字(鼓写完再写励);给了 only 就只写那个字,别的字回到写完的样子 */
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
  // ---- 点字弹的四线三格(wordGrid / wordWrite / wordMerge、wordLayout)在 word-draw.ts,和听写页共用 ----
__WORD_DRAW_JS__
  // ---- 小课堂:一节课里的一页(页集里的「小课堂」),舞台照一节课的状态在页上放(stage/lecture.tsx)。
  //      首页小课堂按钮进来先铺它,孩子从头看完才能开口(canSend);停住了能画,停在同一刻画的几笔算一处,整张单子发回来(S.lecture.marks,带截图);
  //      开口那条带上看的情况与还没带过的画(body.lecture);老师 [[看 0:19–0:30]] 就是在这页上放那一段(放完回 phase done,嘴接着念) ----
  /** 小课堂在哪:课包 /api/bundles/<id>/;视频 /api/kid/lectures/<id>/(lecture.json + video.mp4) */
  const lcBundleUrl = (bundle, video) => (video ? '/api/kid/lectures/' : '/api/bundles/') + encodeURIComponent(bundle) + '/';
  /** 「分:秒」(同 src/board/lecture.ts 的 clockLabel) */
  const lcClock = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = String(t % 60).padStart(2, '0'); return hh ? hh + ':' + String(mm).padStart(2, '0') + ':' + ss : mm + ':' + ss; };
  /** 视频那一段末尾的一帧(首页海报):<video> 停在 end 前一点,不出声 */
  const lcVideoStill = (bundle, end) => {
    const v = h('video', { class: 'lc-still', src: lcBundleUrl(bundle, true) + 'video.mp4#t=' + Math.max(0, (end - 200) / 1000).toFixed(2), playsinline: '', preload: 'metadata' });
    v.muted = true;
    return v;
  };
  /** 页上铺的那堂课(src/schema/lesson.ts 的 lecture 页;同服务端的 lecturePage) */
  const lcPage = (L) => ({ id: '小课堂', kind: 'lecture', title: L.title || L.bundle, bundle: L.bundle, video: Boolean(L.video), ms: L.ms || 0, pick: false });
  /** 一处画的键:同一刻又添了笔算新的,要再带 */
  const lcKey = (k) => k.atMs + ':' + k.strokes.length;
  /** 回到一节铺着小课堂的课(刷新、从首页「今天」回来):手上没有 S.lecture 就照页上那堂课补一份(看过了,接着画的下一条带上) */
  const lcAdopt = (l) => {
    const p = l && l.pages ? l.pages.find((x) => x.kind === 'lecture') : null;
    if (!p || S.readonly || REEL || (S.lecture && S.lecture.bundle === p.bundle)) return;
    S.lecture = { bundle: p.bundle, title: p.title, ms: p.ms, ...(p.video ? { video: true } : {}), watch: { watchedMs: 0, finished: true, pauses: 0 }, sent: true, marks: [], done: [], log: [] };
    renderBar();
  };
  /** 播放器说看完了一遍:第一遍看完 → 能开口了;问过以后又看完、看了一段 → 下一条带上 */
  const lcWatched = (m) => {
    const L = S.lecture;
    if (!L || S.readonly || REEL) return;
    if (m.event === 'finished' && !L.watch) { L.watch = { watchedMs: m.watchedMs, finished: true, pauses: m.pauses }; renderBar(); renderSubtitle(); }
    else if (L.watch) L.rewatch = { watchedMs: m.watchedMs, finished: m.finished, pauses: m.pauses };
  };
  // ---- 一个话题一节(板上只有实时一种画法,2026-11-04;以前的话题也这样画)。课里没有卡:节里只有讲稿,板上一节只挂时间,
  //      页铺在舞台上;孩子的话在左栏 #lv-kid ----
  const headEls = (s, i) => [i === 0 && s.at ? h('div', { class: 'sh lh' }, h('span', { class: 'ln' }), h('span', { class: 'tm' }, clock(s.at))) : null];
  /** 拿起相机老师就停;拍完 / 选完进发照片屏。相册最多 4 张,多的只取前 4 张。输入条、加号面板、拍照屏都走这里 */
  const wireFile = (f) => {
    f.addEventListener('change', () => { $('#sheet').classList.remove('on'); const files = Array.from(f.files || []).slice(0, f.multiple ? PHOTO_ALBUM_MAX : 1); f.value = ''; psOpen(files); });
  };
  /** 一个话题一节:第一节挂时间,后面的接着它(cont,空的不占地方) */
  const renderSection = (s, i) => h('div', { class: 'sec' + (i > 0 ? ' cont' : ''), 'data-sec': i, 'data-job': s.job }, ...headEls(s, i));
  /** 老师还在写:有句就出节(讲稿嘴在念),转成 S.sections 里的一节(partial),之后每次 poll 把 lines 换成最新的;写完了 finalizeLive 换成正式的一节 */
  const avListen = () => document.body.classList.toggle('listening', S.bar === 'holding' || (LV.on && LV.model.open && LV.model.hearing));
  /** 实时:老师说完这一轮点一下头——按钮里那颗、手机那颗(动作在 voice-ui.ts) */
  const liveNod = () => { VB.btn.nod(); const a = $('#lv-av'); a.classList.remove('vb-nod'); void a.offsetWidth; a.classList.add('vb-nod'); setTimeout(() => a.classList.remove('vb-nod'), 950); };
  const renderLive = (e) => {
    if (!S.partial || S.partial.job !== e.job) { if (S.partial) S.partial.el.remove(); const idx = S.sections.length; S.partial = { job: e.job, idx, live: false, el: renderSection(e, idx) }; $('#board').append(S.partial.el); }
    const P = S.partial, idx = P.idx;
    // 有句(或第一句前面的动作)就出节:讲稿嘴在念,动作照 lsFeed 落到页上
    if (!(e.lines.length || (e.acts && e.acts.length))) return;
    const sec = { ...e, partial: true };
    if (!P.live) { P.live = true; S.played.add(e.job); S.sections.push(sec); dispatch({ type: 'liveStart', section: idx }); }
    else S.sections[idx] = sec;
    lsFeed();
  };
  /** 老师写完了:live 的那节换成正式的,不重播 */
  const finalizeLive = (e) => {
    const P = S.partial; S.partial = null;
    const idx = P.idx;
    S.sections[idx] = { ...e };
    dispatch({ type: 'liveFinal', section: idx });
    lsFeed();
    if (S.stage) renderGo();
  };
  /** 换端(转屏)或窗口变了:记下端;录像里孩子的屏幕整块重画 */
  const relayout = () => {
    const d = debug.get('device') || deviceFor(innerWidth, innerHeight);
    // 录像:孩子的屏幕转屏 / 换端整块重画;家长页这头只是 iframe 换个缩放(reelDock 自己跟着窗口)
    if (S.reel) { if (REEL) { S.device = d; S.reel.key = ''; reelTick(); } return; }
    S.device = d;
  };
  let relayoutTimer = null;
  window.addEventListener('resize', () => { clearTimeout(relayoutTimer); relayoutTimer = setTimeout(relayout, 150); });
  S.device = debug.get('device') || deviceFor(innerWidth, innerHeight);

  // ---- 舞台:一节课的页(舞台包画),点字弹的格子浮在页上 ----
  // ---- 铺满的舞台(一节课的页):「给老师看」轻点只交窗里的图、按住说 = 图和这句话一起给脑;嘴说的话浮在页底 ----
  const CV = { capT: 0, give: null };
  /** 舞台关了:等着的交图作废,浮着的字幕收起 */
  const stageClosed = () => {
    if (CV.give) { const g = CV.give; CV.give = null; g(null); }
    clearTimeout(CV.capT); CV.capT = 0; $('#cv-cap').classList.remove('on');
    $('#stage').classList.remove('cv'); $('#st-go').classList.remove('holding');
  };
  /** 铺满的舞台上嘴说的话:页底浮一条,说完 4 秒淡掉 */
  const cvCap = () => {
    const el = $('#cv-cap');
    if (!$('#stage').classList.contains('cv')) { el.classList.remove('on'); return; }
    if (LV.model.status === 'mouth' && LV.cap.cur) { if (el.textContent !== LV.cap.cur) el.textContent = LV.cap.cur; el.classList.add('on'); clearTimeout(CV.capT); CV.capT = 0; return; }
    if (el.classList.contains('on') && !CV.capT) CV.capT = setTimeout(() => { CV.capT = 0; el.classList.remove('on'); }, 4000);
  };
  /** 页上有孩子这一轮以后新落的笔(还没交给老师):他这时开口,这一句连窗里的图一起交 */
  const penInk = () => Boolean(S.stage && S.stage.lesson && LS.on && !S.readonly && !REEL && lsInk() > LS.inkAt);
  /** 「给老师看」:让舞台先交窗里的图;回这一条要带的(交了的 action)。8 秒没回来算了 */
  const stageGive = () => new Promise((resolve) => {
    if (CV.give) { const g = CV.give; CV.give = null; g(null); }
    CV.give = resolve;
    postStage({ type: 'control', action: 'submit' });
    setTimeout(() => { if (CV.give === resolve) { CV.give = null; resolve(null); } }, 8000);
  });
  /** 舞台顶栏右边那一块:这一轮以后落了新的笔才能「给老师看」 */
  const renderGo = () => {
    if (!S.stage || !S.stage.lesson) return;
    const p = LS.l && lessonPage(LS.l);
    $('#st-act').hidden = S.readonly || REEL || !p;
    $('#st-go').textContent = '给老师看';
    $('#st-go').disabled = !p || lsInk() <= LS.inkAt;
    $('#st-go').hidden = false; $('#st-note').textContent = ''; $('#st-go').classList.remove('holding');
  };
  /** 页上点字:孩子点中了一个字词 → 田字格浮在页上,一笔一笔写一遍(点格子再写一遍);再点别的字换成那个,× 收起来。老师不开口 */
  /** 收卡;fromStage = 舞台叫收的(它已经不标那个字了),页面自己收的要告诉舞台 */
  const pickHide = (fromStage) => {
    const box = $('#st-pick');
    const was = !box.hidden;
    for (const b of box.querySelectorAll('.hz')) tianzigeReset(b);
    box.replaceChildren(); box.hidden = true; box.classList.remove('anch', 'above', 'below'); box.style.left = ''; box.style.top = '';
    if (was && fromStage !== true) postStage({ type: 'control', action: 'unpick' });
  };
  /** 卡贴着那个字(at:舞台 iframe 里的屏幕框):放在那一行下面,下面放不下、上面空大就放上面;左右照字居中、不出边 */
  const pickPlace = (at) => {
    const box = $('#st-pick'), st = $('#stage').getBoundingClientRect(), fr = frame.getBoundingClientRect();
    const x1 = at[0] + fr.left - st.left, y1 = at[1] + fr.top - st.top, x2 = at[2] + fr.left - st.left, y2 = at[3] + fr.top - st.top;
    const w = box.offsetWidth, hgt = box.offsetHeight, gap = 16, edge = 12;
    const below = st.height - y2 - gap - edge, above = y1 - gap - edge;
    const down = below >= hgt || below >= above;
    const left = Math.max(edge, Math.min(st.width - w - edge, (x1 + x2) / 2 - w / 2));
    const top = down ? Math.min(y2 + gap, st.height - hgt - edge) : Math.max(edge, y1 - gap - hgt);
    box.classList.add('anch'); box.classList.toggle('below', down); box.classList.toggle('above', !down);
    box.style.left = left + 'px'; box.style.top = top + 'px';
    box.style.setProperty('--ax', Math.max(24, Math.min(w - 24, (x1 + x2) / 2 - left)) + 'px');
  };
  /**
   * 浮层(板的一角,右手在右上):应用自己弹的,不等老师。点的是什么就弹哪种:
   * 汉字 → 田字格(一笔一笔写,点格子再写一遍);英文单词 → 四线三格写一遍。点别的换成那个,× 收起
   */
  const FLOATS = [
    { kind: 'word', fits: (t) => /^[A-Za-z][A-Za-z'-]*$/.test(t), make: (t) => { const grid = wordGrid(t, null, { stage: true }); return { el: h('div', { class: 'pk-wd', 'data-w': t }, grid), play: () => wordWrite(grid, false, null, () => {}) }; } },
    { kind: 'tianzige', fits: (t) => /^[\u3400-\u9fff]{1,4}$/.test(t), make: (t) => { const el = h('div', { class: 'pk-hz', 'data-ch': t }); for (const ch of Array.from(t)) el.append(tianzigeBox(ch)); return { el, play: () => tianzigePlay(el) }; } },
  ];
  const floatShow = (card) => {
    // 换一张卡:舞台已经在跟着新点的字了,不叫它 unpick
    pickHide(true);
    $('#st-pick').dataset.kind = card.kind;
    $('#st-pick').append(h('button', { id: 'st-pick-x', type: 'button', 'aria-label': '收起来', html: ICON.close, on: { click: pickHide } }), card.el);
    $('#st-pick').hidden = false;
    card.play();
  };
  const pickShow = (text, at) => {
    const t = String(text || '').trim();
    const f = FLOATS.find((x) => x.fits(t));
    if (!f) return;
    floatShow({ kind: f.kind, ...f.make(t) });
    if (at) pickPlace(at);
  };
  const STAGE_SOURCE = 'cotutor-stage';
  const frame = $('#st-frame');
  const postStage = (m) => { try { frame.contentWindow.postMessage({ source: STAGE_SOURCE, ...m }, '*'); } catch {} };
  // ---- 话题的预览图(首页「今天」那一格):板停下来一会儿问舞台要一张小图(peek)交给服务端,只留最新一张。
  //      页刚铺上等它画完再要;孩子动了手停下来就要。录像、只读、家长预览不交;话题还没有 id(第一条还没回)先等 ----
  const PV = { timer: 0, last: '', tries: 0 };
  const PV_HAND_MS = 1500;
  const previewSoon = (ms) => {
    if (REEL || PREVIEW || S.readonly || !S.stage) return;
    clearTimeout(PV.timer);
    PV.tries = 0;
    PV.timer = setTimeout(previewTake, ms || PV_HAND_MS);
  };
  const previewTake = () => {
    if (!S.stage || !S.tutor || S.readonly) return;
    if (!S.thread) { if (PV.tries++ < 6) PV.timer = setTimeout(previewTake, 2000); return; }
    postStage({ type: 'control', action: 'peek' });
  };
  const previewGot = (image) => {
    if (!image || image === PV.last || !S.tutor || !S.thread || S.readonly || REEL || PREVIEW) return;
    PV.last = image;
    api('PUT', CONV + S.tutor.name + '/preview', { thread: S.thread, image }).catch(() => {});
  };
  /** 舞台包说话(只有一节课的页):lsStageMsg 管 */
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.source !== STAGE_SOURCE || !S.stage || !S.stage.lesson) return;
    lsStageMsg(m);
  });
  const closeStage = () => { S.stage = null; pickHide(); frame.src = 'about:blank'; stageClosed(); $('#stage').classList.remove('on', 'bp'); renderSubtitle(); };
  $('#st-x').innerHTML = ICON.close;
  // 孩子关:一节课里是回首页
  const closeByKid = () => { if (BP.on && !S.readonly) { closeTutor(); return; } closeStage(); };
  $('#st-x').addEventListener('click', closeByKid);
  /** 一节课的页(舞台带 bp):板是整页,左上的 × 换成老师页那颗「‹ 语」胶囊(照抄 #back,颜色跟着老师);别的舞台还是 × */
  const stageBackSync = () => {
    const bp = $('#stage').classList.contains('bp'), x = $('#st-x');
    const b = $('#back');
    // 换了老师 #back 换了颜色和字:照抄的也要换(以前只看 bp 变没变,从数学的课回首页再进英语的课,胶囊还是「数」)
    const key = bp ? b.innerHTML + '|' + b.className + '|' + b.style.getPropertyValue('--bk') : '';
    if (x.dataset.k === key) return;
    x.dataset.k = key;
    x.classList.toggle('st-back', bp);
    if (bp) { x.innerHTML = b.innerHTML.replace('id="back-ic"', 'class="bk-ic"'); x.classList.toggle('tinted', b.classList.contains('tinted')); x.style.setProperty('--bk', b.style.getPropertyValue('--bk')); $('#stage').style.setProperty('--bk', b.classList.contains('tinted') ? b.style.getPropertyValue('--bk') : ''); x.setAttribute('aria-label', '回首页'); }
    else { x.innerHTML = ICON.close; x.classList.remove('tinted'); x.style.removeProperty('--bk'); $('#stage').style.removeProperty('--bk'); x.removeAttribute('aria-label'); }
  };
  new MutationObserver(stageBackSync).observe($('#stage'), { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(stageBackSync).observe($('#back'), { attributes: true, childList: true, subtree: true });
  $('#st-dim').addEventListener('click', closeByKid);
  /** 「给老师看」点一下:舞台先交窗里的图,再说交了(lsStageMsg 的 submit);按住说在 bindGive(按住说话那几颗旁边) */
  const giveTap = () => { if (S.stage && S.stage.lesson && penInk()) postStage({ type: 'control', action: 'submit' }); };
  $('#st-ttl').addEventListener('click', () => { if ($('#stage').classList.contains('cv')) $('#st-ttl').classList.toggle('open'); });
  /** 状态照的播放位置:平时是播放器的 S.state;录像里孩子的屏幕是录像这一刻的(reelKidSub 算的),不写进 S.state */
  const playView = () => (REEL && S.reel && S.reel.view) || S.state;
  /** 页面跟着播放与嘴走:body 上的类(pending 在想 · waiting 等孩子答 · speaking 在说)、头像点头、左栏字幕、按钮的样子。
   *  录像里孩子的屏幕:状态是录像这一刻的(playView),字幕由 reelLiveCap 画 */
  const renderSubtitle = () => {
    if (!S.pending) S.waitSince = null;
    const ps = playView();
    // 实时:脑还在写时嘴在说,头像是「说」不是「想」
    document.body.classList.toggle('pending', S.pending && !(LV.on && LV.model.status === 'mouth'));
    // 老师等着孩子答
    document.body.classList.toggle('waiting', ps.status === 'waiting' && !S.pending);
    // 头像跟着嘴(实时是 liveStep 的状态,录像是这一刻在不在念);嘴停了、脑也写完了点一下头
    const status = LV.on ? LV.model.status : ps.status === 'playing' && !S.pending ? 'mouth' : ps.status;
    document.body.classList.toggle('speaking', status === 'mouth');
    if (LV.was === 'mouth' && (LV.on ? status !== 'mouth' : status === 'waiting' || status === 'done') && !S.pending) liveNod();
    LV.was = status;
    // 录像里孩子的屏幕:老师的字幕由 reelLiveCap 照那一刻画,孩子刚说的那句照孩子端一样写在左栏(板上不挂孩子的话)
    if (!REEL) liveCaption(); else lvKid();
    voiceSync();
  };


  // ---- 板上的节:改位置的事都走 dispatch → step(board/presentation.ts,纯函数,见 tests/player.test.ts),这里只照单执行它回的事。
  // 页面里不许再直接改 S.state(tests/player.test.ts 数着);讲稿不念了,嘴念的走 liveDispatch ----
  const runEffect = (f) => {
    switch (f.kind) {
      case 'stop': silence(); break;
      case 'render': renderSubtitle(); break;
    }
  };
  // ---- 录像的实录(只在孩子端):孩子看到、听到、做了什么,攒着每 10 秒一批发给服务端(页面退到后台时 sendBeacon)。
  //      只记今天、能发消息的话题(以前的只读回放不记)。发不出去就丢,不重试 ----
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
      const d = await api('GET', CONV + S.tutor.name + '/' + (S.hist || 'today'));
      setOffline(false);
      S.day = d;
      // 话题:没选过就是当前(末条所在)的;板上只铺这个话题的节。新话题空白态什么都不铺,发出第一句才有话题
      if (!S.thread && !S.newThread) S.thread = d.thread;
      const mine = S.newThread ? [] : d.messages.filter((m) => m.thread === S.thread);
      const first = mine.find((m) => m.question !== null) || mine[0];
      S.threadAt = first ? first.at : null;
      const entries = sectionsFromMessages(mine);
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
      }
      // 这条既不 pending 也没定稿(运行出错了):撤掉;live 的那节也撤(孩子端出错的运行不出现)
      if (S.partial && !entries.some((e) => e.job === S.partial.job)) { const P = S.partial; S.partial = null; P.el.remove(); if (P.live) { S.sections.splice(P.idx, 1); dispatch({ type: 'liveDropped' }); } }
      // 孩子的话:刚发出去、这一节还没出来的记着(左栏照它写)
      {
        const lastM = mine[mine.length - 1];
        const sd = lastM && lastM.pending ? kidSaid(mine).get(lastM.job) : null;
        const shown = lastM && (S.sections.some((s) => s.job === lastM.job) || (S.partial && S.partial.job === lastM.job));
        S.pendSaid = sd && !shown ? { job: lastM.job, said: sd } : null;
      }
      const stillPending = Boolean(d.pending) || d.messages.some((m) => m.pending);
      S.pending = stillPending;
      if (stillPending && !S.waitSince) S.waitSince = Date.now();
      if (fresh.length) dispatch({ type: 'fresh', sections: fresh });
      else renderSubtitle();
      bpSync(mine);
      listenSync(mine);
      lsFeed();
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
    if (S.hist && today) mo = '以前的 · ' + dateLabel(S.hist, S.hist === today ? '' : today) + ' ' + clock(S.threadAt);
    // 新话题不挂小标签(空板本身就说明了);小课堂照旧
    else if (S.newThread && S.lecture) mo = '小课堂';
    else if (S.thread && S.day && S.thread !== S.day.thread) mo = '今天的话题 · ' + clock(S.threadAt);
    $('#c-mo').textContent = mo; $('#c-mo').hidden = !mo;
  };
  // 只看(S.readonly:录像、家长预览):选择 / 板不开、没有输入条。
  // 家长要试老师,到孩子端当一回孩子,用完回清单删那个话题(写进记忆、日记的一起撤)
  /** 能不能发消息:孩子端 = 不只读;家长端不发 */
  const canSend = () => !S.readonly && !(S.lecture && !S.lecture.watch);
  const renderBar = () => { $('#pill').hidden = !canSend() && !REEL; document.body.classList.toggle('nosend', !canSend() && !REEL); document.body.classList.toggle('ro', S.readonly && !REEL); voiceSync(); };
  const resetBoard = () => { dispatch({ type: 'halt' }); if (S.stage) closeStage(); clearTimeout(S.pollTimer); S.sections = []; S.played = new Set(); dispatch({ type: 'reset' }); S.partial = null; $('#board').replaceChildren(); };
  /** 换到某天的某个话题:今天的能接着聊;以前的只读回放(从第一句播) */
  const switchThread = (date, thread) => {
    resetBoard();
    S.hist = date; S.readonly = Boolean(date); S.thread = thread; S.newThread = false; S.threadAt = null; S.via = null;  S.lecture = null;
    if (S.readonly) liveClose(); else if (!LV.on && liveWanted(S.tutor)) liveOpen();
    renderBar(); renderSubtitle(); renderHeader();
    loadDay(!S.readonly);
  };
  /**
   * 小课堂:看完后的第一条带看的情况与画的;问过以后再看一遍又画了,下一条带新画的。
   * 画的一处带截图:先传成 captures/ 里的文件(同照片),换成路径;传不上就不带这张图。时刻换成离发出去多少毫秒(孩子端自己的钟,不用对钟)
   */
  const lectureBody = async () => {
    const L = S.lecture;
    if (!L || !L.watch) return null;
    // 只带还没带过的画(播放器里画的一直在,整张单子发来;带过的记在 done)
    const fresh = L.marks.filter((k) => !L.done.includes(lcKey(k)));
    for (const k of fresh) if (k.image && k.image.startsWith('data:')) { try { const r = await api('POST', CONV + S.tutor.name + '/photos', { image: k.image }); k.image = r.path; } catch { delete k.image; } }
    const sentAt = Date.now();
    if (L.sent && !fresh.length && !L.log.length) return null;
    L.sending = fresh.map(lcKey);
    return { bundle: L.bundle, ...(L.sent ? (L.rewatch || { watchedMs: 0, finished: false, pauses: 0 }) : L.watch), ...(fresh.length ? { marks: fresh.map((k) => ({ atMs: k.atMs, strokes: k.strokes, ...(k.image ? { image: k.image } : {}), ...(k.at ? { t: Math.min(0, k.at - sentAt) } : {}) })) } : {}), ...(L.log.length ? { log: L.log.map((e) => ({ t: Math.min(0, e.at - sentAt), pos: e.pos, play: e.play })) } : {}) };
  };
  /** 带着小课堂的那条发出去了:带过的画记下(下一条不再带),看的过程清掉 */
  const lectureSent = () => {
    const L = S.lecture;
    if (!L) return;
    L.done = [...L.done, ...(L.sending || [])]; L.sending = null; L.log = []; L.sent = true; L.rewatch = null;
  };
  /** 孩子发一条(打字、拍照、给老师看、首页按钮的开场):都走实时那条连接,嘴先接住;嘴还没连上(刚进来就发开场)先排着,连上就发。
   *  不走实时的页面(以前的话题、家长端、录像、预览)发不了 */
  const send = (text, opts = {}) => {
    text = (text || '').trim();
    if (!text && !opts.action && !(opts.photos && opts.photos.length)) return;
    if (!S.tutor || !canSend() || !LV.on) return;
    unlock();
    if (LV.ready) liveSendNow(text, opts); else LV.queued = [text, opts];
  };

  // ---- 看录像:录像 = 孩子的屏幕 + 录像栏。
  //      孩子的屏幕:这个页面以 MODE.reel 开在 iframe 里(/reel?tutor=&date=&thread=),按孩子那台设备的尺寸开,家长页等比缩。
  //      轨道是服务端排好的(ui/kid/reel.ts,已内联),每 100 毫秒算一次 reelFrameAt:板上的节用 renderSection 现画(孩子端条目:孩子的话当节头、进答案栏)、
  //      哪几节、一节课的样子照它、放那次通话的声音(从这句起);头像、「等你说…」照孩子端自己的逻辑(这一刻的位置放进 S.reel.view 再 renderSubtitle)。
  //      不经过 step、不 dispatch;轮询停着(loadDay 见 S.reel 就回)。
  //      录像栏(进度条、这一刻的说明、播放、跳过空白、倍速、退出)在家长页上,只经 iframe 的 window.cotutorReel 说话:同源直接调,家长点「播放」的那一下调进去;
  //      iframe 放声音用的是家长页那个 Audio(家长点「看录像」时已解锁)。直接打开 iframe 的地址(调试)时,录像栏在它自己身上 ----
  const REEL_SPEEDS = [1, 1.5, 2];
  /** 孩子那台设备的 CSS 尺寸:孩子端还没记屏幕尺寸之前,按消息里的 device 取常见的;没记 device 的按 iPad 横屏 */
  const REEL_SIZES = { 'tablet-landscape': [1180, 820], 'tablet-portrait': [820, 1180], phone: [390, 844] };

  // ---- 录像的引擎:只在孩子的屏幕里(REEL)跑 ----
  const reelSetClock = () => {
    const R = S.reel;
    const w = R.clock ? R.clock.toWall(R.p) : R.d.reel.startAt;
    R.clock = reelClock(R.d.reel, R.real);
    R.p = R.clock.toPlay(w);
  };
  /** 一节课(铺着页的 activity)照孩子端记下的这一刻的样子画(f.lesson;只读,孩子的窗跟着他停下的地方);不是这种话题就关着 */
  const reelStage = (f) => {
    const R = S.reel;
    if (f.lesson) {
      BP.on = true;
      const key = JSON.stringify(f.lesson);
      if (R.lessonKey === key && S.stage && S.stage.lesson) return;
      R.lessonKey = key; R.now = '';
      LS.on = true; LS.l = f.lesson; LS.job = null;
      lsOpenStage(); lsShow();
      return;
    }
    if (S.stage) { closeStage(); R.now = ''; }
  };
  /** 板上的节:哪几节变了就整块重画(往回拖也是);孩子刚发出去的话每次对一下 */
  const reelDraw = (f) => {
    const R = S.reel;
    const shown = f.sections.filter((fs) => R.entries.some((e) => e.job === fs.job));
    const key = JSON.stringify(shown.map((fs) => fs.job));
    if (key !== R.key) {
      R.key = key; R.now = '';
      S.sections = shown.map((fs) => R.entries.find((x) => x.job === fs.job));
      const board = $('#board'); const top = board.scrollTop;
      board.replaceChildren(...S.sections.map((sec, i) => renderSection(sec, i)));
      board.scrollTop = top;
      R.rebuilt = true;
    }
    // 孩子刚发出去、它引出的那一节还没出来:那句话先挂着(孩子端 loadDay 的 pendSaid)
    const lastN = f.notes[f.notes.length - 1];
    const sd = lastN && !shown.some((fs) => fs.job === lastN.job) ? R.said.get(lastN.job) : null;
    const pk = sd ? lastN.job : '';
    if (pk !== R.pend || R.rebuilt) { R.pend = pk; S.pendSaid = sd ? { job: lastN.job, said: sd } : null; }
    // 跟着最新的走:多了一节或刚拖过进度条,就滚到最底下那节
    const board = $('#board');
    const seen = board.querySelectorAll(':scope > .sec').length;
    if (seen > R.seen || R.follow) {
      const tail = [...board.querySelectorAll(':scope > .sec')].reverse().find((el) => el.getClientRects().length);
      if (tail) tail.scrollIntoView({ block: 'end', behavior: R.follow ? 'instant' : 'smooth' });
    }
    R.seen = seen; R.follow = false;
    reelStage(f); R.rebuilt = false;
  };
  /** 头像、「等你说…」、输入条压淡:孩子端自己的 renderSubtitle 照这一刻画。播放位置放在 S.reel.view(playView 读它),不碰 S.state、不 dispatch;
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
    if (f.gap) return { text: (f.gap.cont ? '⏩ 又过了 ' : '⏩ 孩子想了 ') + reelDuration(f.gap.ms), cls: 'gap' };
    if (f.asking) return { text: '⏸ 停下等孩子', cls: 'gap' };
    return { text: '', cls: '' };
  };
  /** 看小课堂的那一段:页上那堂课(reelStage 照 f.lesson 铺好了)跟着录像的时钟(follow);舞台刚装好时再发一次最近那条(lsStageMsg 的 ready) */
  const reelLecture = (f) => {
    const R = S.reel, x = f.lecture;
    if (!x) { R.lcMsg = null; return; }
    const msg = { type: 'follow', ms: x.pos, playing: x.playing && R.playing && !R.seeking, rate: R.speed, marks: x.marks.map((k) => ({ atMs: k.atMs, svgMs: k.svgMs, strokes: k.strokes, ...(k.image ? { image: k.image } : {}) })) };
    R.lcMsg = msg;
    postStage(msg);
  };
  const reelTick = () => {
    const R = S.reel; if (!R) return;
    const now = performance.now();
    if (R.playing && !R.seeking) R.p = Math.min(R.clock.total, R.p + (now - R.last) * R.speed);
    R.last = now;
    const t = R.clock.toWall(R.p);
    const f = reelFrameAt(R.d.reel, t);
    R.f = f; R.t = t;
    reelDraw(f); reelKidSub(f, t); reelLiveCap(f, t); reelHold(f); reelInput(f); reelKbd(f); reelPs(f); reelVoice(f); reelLecture(f);
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
  const reelSeek = (p) => { const R = S.reel; if (!R) return; R.seeking = false; R.p = Math.max(0, Math.min(R.clock.total, p)); R.last = performance.now(); R.voice = null; R.follow = true; reelTick(); };
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
    /** 跳到当时的墙钟那一刻(cotutor reel --shots 照时间线截图用) */
    seekWall: (w) => { const R = S.reel; if (R && R.clock) reelSeek(R.clock.toPlay(w)); },
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
      for (const m of rl.marks) {
        if (m.kind === 'said') { const pm = msgOf(m.job); add(m.at, 'said', pm && pm.via ? '首页' : pm && pm.from === 'system' ? '系统' : '孩子', m.label); }
        else if (m.kind === 'ask') add(m.at, 'wait', '等孩子', m.label);
        else if (m.kind === 'error') add(m.at, 'err', '没成', m.label);
        else if (m.kind === 'lecture' || m.kind === 'ink') add(m.at, 'card', '小课堂', m.label);
        else if (m.kind === 'miss') add(m.at, 'miss', '没发出去', m.label.replace('按住说话没发出去 · ', '按住说话 · '));
        else if (m.kind === 'misses') add(m.at - 1, 'miss', '⚠ 连着', m.label);
      }
      for (const w of rl.waits) if (w.to - w.from >= 3000) add(w.from + 1, 'wait', '等老师', reelDuration(w.to - w.from));
      for (const g of rl.gaps) if (g.kind === 'think') add(g.from, 'wait', g.cont ? '又过了' : '孩子想了', reelDuration(g.ms));
      for (const x of rl.types) add(x.from, 'said', '打字', (x.vals.length ? x.vals[x.vals.length - 1].v : '') + (x.sent ? '' : ' · 没发'));
      for (const x of rl.photoScreens) add(x.from, 'said', '拍照', x.sent ? '发了照片' : '打开又取消了');
      // 节尾的旁注(给家长的、记住了):不插在板上,在这里
      for (const n of rl.notes) {
        const pm = msgOf(n.job); if (!pm) continue;
        if (pm.parentText) add(n.postAt, 'tail', '给家长', pm.parentText.replace('## 家长', '').trim());
        if (pm.remembered && pm.remembered.length) add(n.postAt, 'tail', '记住了', pm.remembered.join(';'));
      }
      // 家长端「记录」别的旁注:小课堂里画的那段话、提醒;记账与整理记忆那两轮不进录像,记在最后
      for (const pm of R.d.messages) {
        const tr = rl.tracks.find((x) => x.job === pm.job), nt = rl.notes.find((x) => x.job === pm.job);
        const own = reelParse(pm.timing && pm.timing.startedAt), at0 = nt ? nt.at : tr ? tr.at : Math.min(rl.endAt, Number.isNaN(own) ? rl.endAt : own);
        const post = nt ? nt.postAt : tr ? tr.doneAt : at0;
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
    drag: (p) => { const R = S.reel; if (!R) return; R.seeking = true; R.p = Math.max(0, Math.min(R.clock.total, p)); R.voice = null; R.follow = true; reelTick(); },
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
    // 孩子的屏幕照实时老师页的样子(左栏大头像 + 字幕);有实时轮的话题字幕照这一刻(reelLiveCap),不是实时的轮左栏不写字幕
    liveFace(S.tutor); tintBack(S.tutor); markBoard($('#bmark'), S.tutor);
    $('#tutor').classList.add('on'); pageTheme(false);
    renderBar(); setBar('idle');
    const v0 = d.reel.views[0];
    // 示意的键盘(打字时垫在底下):三排字母一排空格,不画真键盘
    document.body.append(h('div', { id: 'rl-kbd' }, ...['qwertyuiop', 'asdfghjkl', 'zxcvbnm', ' '].map((r) => h('div', { class: 'r' }, ...[...r].map((k) => h('span', { class: k === ' ' ? 'sp' : '' }, k === ' ' ? '拼音' : k))))));
    S.reel = { d, entries: sectionsFromMessages(d.kid), said: kidSaid(d.kid), size: v0 ? [v0.w, v0.h] : REEL_SIZES[d.device] || REEL_SIZES['tablet-landscape'], barsH: holdBars.map((b) => b.style.height), kb: 0, inKey: '', psKey: '', real: false, speed: 1, p: 0, playing: false, seeking: false, last: 0, key: '', now: '', voice: null, timer: null, clock: null, seen: 0, follow: false, pend: null, subKey: '', hold: null, f: null, t: 0, realtime: Boolean(d.realtime), cap: null, capOf: null, capKey: '' };
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
    // ?bare=1:只要孩子的屏幕、不要录像栏(cotutor reel --shots 截图)
    else if (!new URLSearchParams(location.search).has('bare')) reelDock.open(reelApi, { toast });
  };

__REEL_DOCK_JS__
  /** 只收拾录像自己的东西(关老师页时也调);不重开话题 */
  const reelStop = () => {
    if (!S.reel) return;
    const R = S.reel; clearInterval(R.timer); clearInterval(R.liveTimer); S.reel = null; silence(); if (S.stage) closeStage();
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
  // 试用:打的字当孩子说的(trialSay,在下面)
  $('#go').addEventListener('click', () => { const t = typed.value; typeHeard.put(t); typeRec('send'); typed.value = ''; setBar(barNext(S.bar, 'sent')); if (TRIAL && LV.on) trialSay(t); else send(t); });
  typed.addEventListener('input', () => typeHeard.put(typed.value));
  // 输入法选字的那下回车不算发(Safari 先 compositionend 再 keydown,isComposing 已是假,只剩 keyCode 229 认得出)
  typed.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); $('#go').click(); } });
  typed.addEventListener('blur', () => { if (!typed.value.trim()) setBar(barNext(S.bar, 'blur')); });
  $('#plus').addEventListener('click', () => $('#sheet').classList.add('on'));
  $('#sheet .dimmer').addEventListener('click', () => $('#sheet').classList.remove('on'));
  $('#hold .w').replaceChildren(...[6, 10, 16, 22, 12, 26, 18, 8, 14, 24, 20, 10, 16, 28, 12, 8, 18, 22, 10, 14, 6, 12, 20, 16, 8].map((v, i) => h('i', { style: 'height:' + v + 'px;animation-delay:' + (i * 37 % 400) + 'ms' })));

  // 中间那段:点 = 打字;实时老师页上按住 150ms = 说话(推给嘴),松手发,上滑 60px 取消
  const PH_IDLE = () => (LV.on && LV.model.open ? (LV.model.muted ? '麦关了,点右边的麦克风再听' : '我在听,直接说就行…') : '发消息或按住说话…');
  /** 输入条上是空闲那句就按现在的重写(实时连上、一直听开关),「没听清」那几秒不动 */
  const phIdle = () => { const ph = $('#ph'); if (ph && /^(发消息|我在听|麦关了)/.test(ph.textContent)) ph.textContent = PH_IDLE(); };
  $('#ph').textContent = PH_IDLE();
  let press = null;
  // 麦克风常开(真机诊断 2026-09-19)。这台 iPad 上的两条事实:
  // ① 麦克风关了再开,也常开到哑的 → 开了就不关(只有页面退到后台才放,那时系统本来也会掐);开完自检 600ms,纯 0 就拆掉重开,最多 3 回
  // ② 冷开要 1 秒多,这段时间说的字进不去 → 给过权限之后,进老师页就先开好(micWarm)
  // 这一路画音量条。每次开麦克风也记一行诊断(where: 'mic')
  const mic = { stream: null, ac: null, an: null, buf: null, opening: null, ok: true };
  const micLive = () => { const t = mic.stream && mic.stream.getAudioTracks()[0]; return Boolean(t && t.readyState === 'live' && !t.muted && mic.ok); };
  /** 实时开着时,麦克风的自检(分析器)也开在实时那个 AudioContext 里,页面上只有一个 AudioContext(一直听也只用一个)。
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
  //      孩子端不念讲稿(板上的节的 step 照旧收事件);讲稿和动作照旧从「今天」拉。谁出声、谁停走 liveDispatch → liveStep(runtime/delivery/player.ts),
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
        case 'release': lvSend({ t: 'release', body: data }); break;
        case 'hush': lvSend({ t: 'hush' }); break;
        case 'send': lvSend({ t: 'send', body: data }); break;
        case 'enqueue': if (LV.audio) LV.audio.play(data); liveDrainWatch(); break;
        case 'flush': LV.playLine = null; LV.endLine = null; if (LV.audio) LV.audio.flush(); lsFinish(true); break;
        case 'openLecture': liveLecture(); break;
        // 老师放的小课堂那一段停下(孩子打断了):舞台停在那一帧,放完也不再回 phase done
        case 'stopLecture': if (LS.playN) { LS.playN = 0; LS.key = ''; postStage({ type: 'control', action: 'pause' }); lsShow(); } break;
        case 'staged': lvSend({ t: 'staged' }); break;
        // 连不上、断了:回到「正在叫老师」,过一会儿再连;排着的那条(开场、打字)连上再发
        case 'retry': liveRetry(); break;
        case 'render': renderSubtitle(); break;
        case 'listen': lvSend({ t: 'listen', open: LV.model.open }); break;
        case 'gate': liveGateSync(); break;
        case 'duck': case 'unduck': if (LV.audio) LV.audio.duck(f.kind === 'duck' ? 0.3 : 1); break;
        case 'playReplay': replayPlay(); break;
        case 'stopReplay': replayStop(); break;
        case 'playRead': readPlay(); break;
        case 'stopRead': readStop(); break;
      }
    }
    // 课本做底:嘴说完了,这一节没落的动作落上
    if (LS.on && LS.job) lsTick();
    return r.effects;
  };
  /** 嘴在说时每 150 毫秒看一眼孩子端的队列放完没有 */
  const liveDrainWatch = () => {
    if (LV.drain) return;
    LV.drain = setInterval(() => {
      if (LV.model.status === 'mouth' && LV.audio && LV.audio.playing()) return;
      clearInterval(LV.drain); LV.drain = 0;
      if (LV.model.status === 'mouth') liveDispatch({ type: 'drained', ...(LV.playLine ? { play: lcPlayable() ? 'open' : 'skip' } : LV.endLine && LV.endLine.echo ? { echo: true } : {}) });
    }, 150);
  };
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
      if (S.readonly && !REEL) return voiceIn({ readonly: true });
      const rh = VB.reelHold;
      return voiceIn({ status: rh ? 'holding' : VB.reelSpeak ? 'mouth' : 'quiet', pending: S.pending, holdAudio: Boolean(rh && rh.phase !== 'wait'), cancel: Boolean(rh && rh.slide) });
    }
    const m = LV.model, holding = m.status === 'holding';
    return voiceIn({ status: m.status, open: m.open, hearing: m.hearing, ducked: m.ducked, muted: m.muted, turn: m.turn, pending: S.pending, photo: VB.photo, ready: LV.ready, holdAudio: holding && hold.audio, cancel: holding && Boolean(press && press.cancelled), silentMs: holding && hold.audio ? Date.now() - Math.max(VB.loudAt, LV.holdAt) : 0, hint: VB.hint });
  };
  /** 按钮换成这一刻的样子;手机那颗小头像(#lv-av)的动作跟同一份。按着没声音满 3 秒要换小字:到点再来一次 */
  function voiceSync() {
    if (!S.pending) VB.photo = false;
    const side = document.body.classList.contains('hand-left') ? 'right' : 'left';
    if (VB.side !== side) { VB.side = side; VB.btn.side(side); }
    const v = voiceView(voiceNow());
    VB.btn.set(v);
    voiceFace($('#lv-av'), v.face);
    clearTimeout(VB.silentT);
    if (v.key === 'hold') { const left = VOICE_SILENT_MS - (Date.now() - Math.max(VB.loudAt, LV.holdAt)); if (left > 0) VB.silentT = setTimeout(voiceSync, left + 30); }
  }
  /** 刚才那一下的提示:按钮晃一下(每按一次都晃)、字留 2 秒;ph = 手机输入条上那行字 */
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
  /** 老师在想(脑在写、嘴没在说)时按了按住说话:不接,但要让孩子知道——10-20 晚孩子几次想打断按不动,那时这块关着 pointer-events,按了什么都不发生 */
  const busyHint = () => { voiceHint('busy', '老师在想,等一下再说'); busyDiag(LV.model.status); };
  /** 嘴还没连上(刚进老师页、换连接、断了在重连)时按了:不接,说一声 */
  const connectingHint = () => { voiceHint('connecting', '正在叫老师,等一下'); busyDiag('connecting'); };
  /** 孩子刚说的那句(平板横屏左栏,字幕上面):节头不再是孩子的话,他说了什么在这里看;老师开口了(或这一轮写完了)变淡,下次说话换掉 */
  const lvKid = () => {
    const el = $('#lv-kid');
    const last = S.sections[S.sections.length - 1];
    const p = S.pendSaid ? { job: S.pendSaid.job, sd: S.pendSaid.said } : last && last.said ? { job: last.job, sd: last.said } : null;
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
  const replaySec = () => { for (let i = S.sections.length - 1; i >= 0; i--) { const s = S.sections[i]; if (s.lines.length) return s; } return null; };
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
  // ---- 点读课文(语文课本的一课,docs/dev/课本.md):孩子点标题、段首的钮(舞台报 read,带这一课分好的几块:每块是标题还是第几段、几句),
  //      孩子端用共享的 Audio 一句一句放这位老师「点读的声音」(/api/kid/textbook/say:服务端照课本现取字,合成过的有缓存)。
  //      一块读完停 READ_GAP_MS,钮挪到下一块接着读,读到课文最后停;暂停停在那一秒,再点那一块的钮接着读;停下 READ_FADE_MS 钮淡掉(再点还是接着读)。
  //      读到哪停的报给服务端记一笔(下一轮老师在「孩子做的」里看到)。谁让谁在 liveStep(reading);这里只取、放,告诉舞台钮在哪一块、什么样(lsShow 的 read) ----
  const READ_GAP_MS = 1200, READ_FADE_MS = 5000, READ_WAIT_MS = 350;
  /** at = 这几块属于哪一页;k / s = 第几块第几句;mode = 钮的样子(playing 暂停钮、loading 转圈、between 挪到下一块转一圈、paused 播放钮、rest 淡掉了);from = 这一回从哪一块读起 */
  const RD = { at: '', nos: [], parts: [], k: -1, s: 0, mode: '', from: -1, gapT: 0, fadeT: 0, waitT: 0 };
  /** 这一页能不能点读:实时老师页、这位老师有点读的声音、语文课本的一课(不是目录) */
  const readOk = () => { const p = LS.on && LS.l ? lessonPage(LS.l) : null; return Boolean(LV.on && !S.readonly && !REEL && S.tutor && S.tutor.hasVoice && p && p.kind === 'book' && p.layout !== 'math' && p.title !== '目录'); };
  const readUrl = (k, s) => { const p = lessonPage(LS.l); return '/api/kid/textbook/say?tutor=' + encodeURIComponent(S.tutor.name) + '&b=' + encodeURIComponent(p.src) + '&p=' + p.pages[0] + '-' + p.pages[p.pages.length - 1] + '&k=' + k + '&s=' + s; };
  const readMode = (m) => { if (RD.mode === m) return; RD.mode = m; lsShow(); };
  /** 读到哪停的报给服务端(一回一条);done = 读到了课文最后 */
  const readReport = (done) => {
    const from = RD.nos[RD.from], to = RD.nos[Math.max(0, Math.min(RD.k, RD.nos.length - 1))];
    const ok = RD.from >= 0 && S.thread && LS.l && RD.at === LS.l.at && from !== undefined && to !== undefined;
    RD.from = -1;
    if (ok) lvSend({ t: 'board', body: { k: 'read', thread: S.thread, base: RD.at, from, to, ...(done ? { done: true } : {}) } });
  };
  /** 放第 k 块第 s 句;下一句先叫服务端合成着(合成过的直接给文件) */
  const readSay = () => {
    clearTimeout(RD.gapT); clearTimeout(RD.waitT);
    const a = audioEl, k = RD.k, s = RD.s;
    a.onended = () => readNext();
    a.onerror = () => readFail();
    a.onplaying = () => { if (RD.k === k && RD.s === s) { clearTimeout(RD.waitT); readMode('playing'); } };
    a.src = readUrl(k, s);
    a.dataset.read = k + '.' + s;
    const pr = a.play(); if (pr && pr.catch) pr.catch((e) => { if (!(e && e.name === 'AbortError')) readFail(); });
    // 一会儿还没出声(第一次读这一段,在合成):钮里转一个小圈
    RD.waitT = setTimeout(() => { if (RD.k === k && RD.s === s && LV.model.status === 'reading' && !(a.currentTime > 0)) readMode('loading'); }, READ_WAIT_MS);
    const nx = s + 1 < RD.parts[k] ? [k, s + 1] : k + 1 < RD.parts.length ? [k + 1, 0] : null;
    if (nx) fetch(readUrl(nx[0], nx[1])).catch(() => {});
  };
  const readNext = () => {
    if (LV.model.status !== 'reading' || RD.k < 0) return;
    if (RD.s + 1 < RD.parts[RD.k]) { RD.s++; readSay(); return; }
    if (RD.k + 1 < RD.parts.length) {
      RD.k++; RD.s = 0;
      readMode('between');
      RD.gapT = setTimeout(() => { if (LV.model.status === 'reading' && RD.mode === 'between') readSay(); }, READ_GAP_MS);
      return;
    }
    readReport(true);
    RD.k = -1; RD.s = 0; readMode('');
    liveDispatch({ type: 'readEnded' });
  };
  /** 读不下去了(没配声音、合成失败、放不出来):停下,钮收起,不出错 */
  const readFail = () => {
    if (LV.model.status !== 'reading') return;
    readReport(false);
    RD.k = -1; RD.s = 0; readMode('');
    liveDispatch({ type: 'readEnded' });
  };
  /** playRead:暂停在这一句的就从那一秒接着读,不然从 RD.k、RD.s 起读 */
  const readPlay = () => {
    clearTimeout(RD.fadeT); clearTimeout(RD.gapT);
    if (RD.k < 0) { setTimeout(() => liveDispatch({ type: 'readEnded' }), 0); return; }
    if (RD.from < 0) RD.from = RD.k;
    const a = audioEl;
    if ((RD.mode === 'paused' || RD.mode === 'rest') && a.dataset.read === RD.k + '.' + RD.s && a.currentTime > 0 && !a.ended) {
      readMode('playing');
      a.onended = () => readNext(); a.onerror = () => readFail(); a.onplaying = null;
      const pr = a.play(); if (pr && pr.catch) pr.catch(() => readFail());
      return;
    }
    readMode('playing');
    readSay();
  };
  /** stopRead:停在这一秒;钮留着(播放的样子),过一会儿淡掉 */
  const readStop = () => {
    clearTimeout(RD.gapT); clearTimeout(RD.waitT);
    try { audioEl.onended = audioEl.onerror = audioEl.onplaying = null; audioEl.pause(); } catch {}
    if (RD.k < 0) return;
    readReport(false);
    readMode('paused');
    clearTimeout(RD.fadeT); RD.fadeT = setTimeout(() => { if (RD.mode === 'paused') readMode('rest'); }, READ_FADE_MS);
  };
  /** 舞台报的:点了第 k 块的钮。在读的那一块 = 暂停;停着的那一块 = 接着读;别的块 = 从那一块读起 */
  const readTap = (m) => {
    if (!readOk() || !Array.isArray(m.parts) || !Array.isArray(m.nos) || m.parts.length !== m.nos.length || typeof m.k !== 'number' || !(m.k >= 0 && m.k < m.parts.length)) return;
    unlock();
    if (RD.at !== LS.l.at || RD.parts.join() !== m.parts.join()) { RD.at = LS.l.at; RD.parts = m.parts.slice(); RD.nos = m.nos.slice(); RD.k = -1; RD.s = 0; RD.mode = ''; RD.from = -1; }
    const reading = LV.model.status === 'reading';
    if (reading && m.k === RD.k) { liveDispatch({ type: 'readStop' }); return; }
    if (reading) readReport(false);
    if (m.k !== RD.k || !(RD.mode === 'paused' || RD.mode === 'rest')) { RD.k = m.k; RD.s = 0; RD.mode = ''; }
    RD.from = -1;
    liveDispatch({ type: 'read' });
  };
  /** 翻走了、关了老师页:这一页的点读作废(在读的停下) */
  const readForget = () => {
    const was = LV.model.status === 'reading';
    clearTimeout(RD.fadeT); RD.at = ''; RD.k = -1; RD.s = 0; RD.mode = ''; RD.from = -1;
    if (was) setTimeout(() => { if (LV.model.status === 'reading') liveDispatch({ type: 'readStop' }); }, 0);
  };
  /** 发给舞台的点读:null = 这一页不点读;k = -1 没在读 */
  const readView = () => (readOk() ? (RD.at === LS.l.at && RD.k >= 0 && RD.mode && RD.mode !== 'rest' ? { k: RD.k, mode: RD.mode } : { k: -1, mode: '' }) : null);
  const liveCaption = () => {
    liveListenUi();
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
  /** 服务端说:这一句开始放了(按孩子端的排法算好的时刻)。字幕换成它 */
  /** 放得了老师那一段吗:这节课的页集里有小课堂 */
  const lcPlayable = () => Boolean(LS.on && LS.l && LS.l.pages.some((p) => p.kind === 'lecture'));
  /**
   * 放老师那一段(讲稿 [[看 0:19–0:30]] 落在小课堂上的那句念完了):那一句的动作落上(翻回小课堂、看那一段),舞台照 look 放,放完回 phase done → lectureDone 接着念。
   * 落不上(那一节还没拉到、不是这一页了)就算放完了
   */
  const liveLecture = () => {
    const pl = LV.playLine; LV.playLine = null;
    if (LS.on && pl && LS.job === pl.job) lsApply(pl.line + 1);
    const p = LS.on && LS.l ? lessonPage(LS.l) : null;
    if (!p || p.kind !== 'lecture' || !(LS.l.look && LS.l.look.at)) { lsShow(); liveDispatch({ type: 'lectureDone' }); return; }
    // 舞台照 look 放那一段(play = 这一次的 n),放完回 phase done
    LS.playN = LS.l.look.n; LS.key = ''; lsShow();
  };
  const liveRead = (job, line, text, play, echo) => {
    LV.playLine = play ? { job, line } : null;
    // 请他说的那句([[请 说 …]]):放完了轮到他(按钮呼吸)
    LV.endLine = echo ? { job, line, echo } : null;
    if (!LV.heard.has(job) || line > LV.heard.get(job)) LV.heard.set(job, line);
    lsRead(job, line);
    // 字幕换成这句(这句的动作由 lsTick 落到页上)
    liveSay(text);
  };
  /** 脑开始写这一轮:话题定下来,拉今天(讲稿与动作从那里来) */
  const liveTurn = (m) => {
    if (m.job) LV.jobs.add(m.job);
    if (m.thread) S.thread = m.thread;
    S.newThread = false; S.via = null;
    // 课本做底:老师开了新的一轮,上一节没落完的都落上;从这一轮起数新落的笔
    if (LS.on) { lsFinish(); LS.inkAt = lsInk(); renderGo(); }
    { const b = $('#board .blank'); if (b) b.remove(); }
    S.pending = true; if (!S.waitSince) S.waitSince = Date.now();
    renderHeader(); renderSubtitle();
    clearTimeout(S.pollTimer); S.pollTimer = setTimeout(() => loadDay(false), 300);
  };
  const liveMsg = (m) => {
    if (TV.wait) TV.wait(m);
    switch (m.t) {
      case 'ready': { LV.ready = true; LV.retries = 0; phIdle(); voiceSync(); liveMicOn(); const q = LV.queued; LV.queued = null; if (q) liveSendNow(q[0], q[1]); break; }
      // 一直听:服务端说孩子开口 / 说完;开口时报一次这一轮的上下文(话题),收下时当松手的 body
      case 'vad': if (m.on) lvSend({ t: 'ctx', body: liveBody() }); liveDispatch({ type: 'vad', on: Boolean(m.on) }); break;
      case 'duck': liveDispatch({ type: 'duck' }); break;
      case 'unduck': liveDispatch({ type: 'unduck' }); break;
      case 'down': liveDispatch({ type: 'drop' }); gateCheck(); break;
      case 'end': liveDispatch({ type: 'drop' }); break;
      case 'tutor':
        // 嘴接住的字一到就上字幕;照念的字幕跟 read 走(到点才亮)
        if (m.of !== 'catch') break;
        if (typeof m.done === 'string') { LV.cap.catching = false; if (m.done) LV.cap.cur = m.done; renderSubtitle(); break; }
        if (!m.delta) break;
        // 接住开始:上一句念的请他说那句不再算(放完的是接住,不轮到他)
        if (!LV.cap.catching) { LV.cap.catching = true; LV.endLine = null; LV.playLine = null; if (LV.cap.cur) LV.cap.prev = LV.cap.cur; LV.cap.cur = ''; }
        LV.cap.cur += m.delta; renderSubtitle();
        break;
      case 'read': liveRead(String(m.job || ''), Number(m.line), String(m.text || ''), m.play === true, m.echo === true); break;
      // 转写是空的(按了没说清):嘴说没听清,不会有这一轮
      case 'kid': if (!String(m.text || '').trim()) { S.pending = false; renderSubtitle(); } else if (LV.model.open) { S.pending = true; if (!S.waitSince) S.waitSince = Date.now(); renderSubtitle(); } break;
      case 'turn': liveTurn(m); break;
      case 'flush': liveDispatch({ type: 'flush' }); break;
      case 'err': S.pending = false; renderSubtitle(); break;
      default: break;
    }
  };
  /** 一直听时推不推:liveStep 的(关麦、小课堂那一段、重放)再加页面的——这会儿能不能发(小课堂还没看完、只读)、到了每天的上限;
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
  /** 孩子这一句的上下文(话题、设备、首页按钮):按住说松手时带上,一直听开口时报一次 */
  const liveBody = () => {
    const body = { device: S.device };
    // 新话题只由按钮开(via,服务端定);别的接着这个话题
    if (!S.newThread && S.thread) body.thread = S.thread;
    if (S.via) body.via = S.via;
    return body;
  };
  /**
   * 一直听还是按住说:activity 头上写了 listen: open 的一直听(口语课这种一问一答多的);别的照 cotutor.json 的 live.listen,缺省按住说。
   * 孩子端没有开关:10-20 真跑,孩子想一下停住、「老师。」「那。」、旁边的话都成了一句
   */
  /** 老师页一律是实时老师页的样子(左栏 + 白板),连不连嘴都一样:以前的话题、不是实时的录像也照它 */
  const liveFace = (t) => {
    document.body.classList.add('live');
    $('#tutor').style.setProperty('--tc', colorOf(t));
    $('#lv-av').replaceChildren(avatarEl(t));
    VB.btn.avatar(avatarEl(t)); VB.btn.color(colorOf(t));
  };
  const liveOpen = (intent) => {
    if (LV.ws) liveClose();
    liveDispatch({ type: 'reset' });
    LV.gateOn = false;
    liveDispatch({ type: 'listen', open: Boolean(intent && intent.listen === 'open') || Boolean(S.tutor && S.tutor.listen === 'open') });
    LV.on = true; LV.ready = false; LV.cap = { prev: '', cur: '', cut: '', catching: false }; LV.heard = new Map(); LV.jobs = new Set();
    liveFace(S.tutor);
    if (!LV.audio) {
      LV.audio = makeAudio();
      LV.audio.muted = false;
      // 按着才推;一直听时推不推看 liveGate(关麦、小课堂、重放时不推)
      // 松了手、还在等板(给老师看在导出上传):状态还是按着,声音不再推
      // 试用推着配音时麦克风那路不推(按住说、一直听都是)
      LV.audio.onChunk = (ab) => { if (TV.feeding) return; if (((LV.model.status === 'holding' && !LV.letGo) || liveGateSync()) && LV.ws && LV.ws.readyState === 1) LV.ws.send(ab); };
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
    // 麦克风之前开在别的 AudioContext 里:放掉,下面 micWarm 重开在实时这个里
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
  /** 收:告诉服务端挂了、关连接、清嘴的声音、关实时那个 AudioContext;页面回到没连嘴的样子(按着的那一下作废) */
  const liveClose = () => {
    const ws = LV.ws; LV.ws = null; LV.ready = false; LV.queued = null; clearTimeout(LV.retryTimer);
    if (ws) { ws.onclose = null; try { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'bye' })); ws.close(); } catch {} }
    liveAudioDrop();
    clearInterval(LV.drain); LV.drain = 0;
    if (!LV.on) return;
    LV.on = false;
    document.body.classList.remove('speaking', 'lv-open');
    if (press && press.live) { clearTimeout(press.timer); press = null; holdEnd('cancel'); setBar(barNext(S.bar, 'holdCancel')); }
    phIdle();
    if (S.tutor) renderSubtitle();
  };
  /** 实时的一次按住记一行诊断(/api/kid/voice-diag,where: live):麦克风怎么开的、多久能推声音、推上去的音量峰值、松手时怎么收的;真机上出错是静默的,只有这份能说清 */
  const liveDiagOf = () => { const t0 = Date.now(); const d = { where: 'live', tutor: S.tutor ? S.tutor.name : null, ua: navigator.userAgent, peak: 0, ev: [] }; d.mark = (k, v) => d.ev.push(v === undefined ? [k, Date.now() - t0] : [k, Date.now() - t0, v]); return d; };
  const liveDiagSend = (d) => { if (!d) return; const { mark: _m, ...row } = d; row.peak = Math.round(row.peak * 100) / 100; try { fetch('/api/kid/voice-diag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row), keepalive: true }).catch(() => {}); } catch {} };
  /** 按满 150 毫秒:嘴、小课堂那一段停(liveStep),告诉服务端 hold,开始推声音(常开那路麦克风接到采音节点上,第一次要等它开好);
   *  fed = 试用推的是配音,不开麦克风 */
  const liveHold = (fed) => {
    // 按的是「给老师看」= 板和这句话给脑
    LV.holdKind = press && press.give ? 'give' : null;
    LV.letGo = false;
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
    if (fed) { d.mark('fed'); hold.audio = true; renderHold(); holdRec('audio'); return; }
    micOpen().then((how) => { d.mark('mic', how); return mic.stream && LV.audio ? LV.audio.use(mic.stream) : Promise.reject(new Error('no mic')); }).then(() => { d.mark('audio', LV.audio.ctx ? LV.audio.ctx.state : ''); if (press && press.live) { hold.audio = true; renderHold(); holdRec('audio'); } }, (e) => d.mark('fail', String(e && (e.name || e.message))));
  };
  /** 松手:告诉服务端 release(嘴马上接住);上滑、太短(不到 0.4 秒)、麦克风没开上 = 作废(hush)——麦克风没开上时输入条上说「没听清」,不能什么都不出(2026-10-19 真机:按了几次都没反应)。
   *  sys = 不是孩子松的手,是系统抢走了这次触摸(pointercancel:iPadOS 底部手势等);行为照旧发出去,voice-diag 记 cancel 不记 up,好分清 */
  const liveRelease = (cancelled, sys) => {
    const long = Date.now() - LV.holdAt >= 400;
    const keep = !cancelled && hold.audio && long;
    const kind = LV.holdKind; LV.holdKind = null;
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
    // 「给老师看」按住说:舞台导出、存好那张板,这一句带着它交给脑(没说清服务端照交板);板没交成这一下作废
    // 板上有他新画的(没交):按头像说话也一样,话连板此刻的图一起交;只点字、没画就不附图
    if (penInk()) {
      // 等板导出的这一会儿(LV.letGo):声音不推、别的按钮不接,发出去才放开
      LV.letGo = true;
      stageGive().then((patch) => {
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
      if (lb) { body.lecture = lb; lectureSent(); }
      liveDispatch({ type: 'release' }, body);
      S.pending = true; S.waitSince = Date.now(); renderSubtitle();
    };
    if (S.lecture) lectureBody().then(go, () => go(null)); else go(null);
  };
  /** 打字、拍照、给老师看:同说了一句,脑写(liveStep 的 send) */
  const liveSendNow = (text, opts) => {
    dispatch({ type: 'halt' });
    const body = { text, device: S.device };
    if (opts.action) body.action = opts.action;
    if (opts.photos && opts.photos.length) { body.photos = opts.photos; VB.photo = true; }
    // 新话题只由按钮开(via,服务端定);别的接着这个话题
    if (!S.newThread && S.thread) body.thread = S.thread;
    if (S.via) body.via = S.via;
    const go = (lb) => {
      if (lb) { body.lecture = lb; lectureSent(); }
      liveDispatch({ type: 'send' }, body);
      if (LV.model.cut) LV.cap.cut = LV.cap.cur;
      S.pending = true; S.waitSince = Date.now(); renderSubtitle();
    };
    if (S.lecture) lectureBody().then(go, () => go(null)); else go(null);
  };
  // ---- 试用:打的字当孩子说的。配成孩子的声音(/api/kid/trial/voice,一个固定的童声),当麦克风推给嘴,服务端分不出是打的:
  //      按住说的,装成按住(liveHold),声音照真的快慢 100 毫秒一块推,推完松手(liveRelease),打断、按住多久、给老师看都同真的;
  //      一直听的,推的这会儿麦克风不推、gate 开着,推完接着推静音直到服务端说说完了(vad off),再等这句判完(kid 收下 / skip 放过)才把 gate 交回麦克风
  //      (判完前关 gate,服务端会把那句作废)。没有这个口子(mock:假嘴不认字)照打字发;配音没成(没 key、网络)提示一句再照打字发 ----
  const tvSleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tvPush = (ab) => { if (LV.ws && LV.ws.readyState === 1) LV.ws.send(ab); };
  /** 按钮跟着推的这块的音量动(同麦克风那路的 onLevel) */
  const tvLevel = (ab) => { const a = new Int16Array(ab); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] / 32768) ** 2; VB.btn.level('kid', Math.min(1, Math.sqrt(s / a.length) * 4)); };
  /** 配音 → 16k 单声道 PCM16,100 毫秒一块(同 audio-client 推的),不到半秒的后面补静音(松手太短算没说);{ error: null } = 没有这个口子 */
  const trialPcm = async (text) => {
    let r;
    try { r = await fetch('/api/kid/trial/voice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }); } catch { return { error: '连不上服务' }; }
    if (r.status === 404) return { error: null };
    if (!r.ok) { let msg = ''; try { msg = (await r.json()).message || ''; } catch {} return { error: msg || 'HTTP ' + r.status }; }
    try {
      // 解到 16k 的上下文里,浏览器顺手重采样
      const buf = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await r.arrayBuffer());
      const ch = buf.getChannelData(0);
      const chunks = [];
      for (let i = 0; i < ch.length || chunks.length < 5; i += 1600) {
        const pcm = new Int16Array(1600);
        for (let j = 0; j < 1600 && i + j < ch.length; j++) { const v = Math.max(-1, Math.min(1, ch[i + j])); pcm[j] = v < 0 ? v * 32768 : v * 32767; }
        chunks.push(pcm.buffer);
      }
      return { chunks };
    } catch (e) { return { error: '配音解不开(' + String(e && (e.name || e.message)) + ')' }; }
  };
  /** 发不了(没连上、老师在想、上一句还在推):字放回输入条 */
  const typedBack = (t) => { setBar(barNext(S.bar, 'tap')); typed.value = t; };
  /** 按住说的:装成按住满 150 毫秒,推完松手;中途被收了(换老师、断了、孩子真按了一下)就不松 */
  const trialHold = async (chunks) => {
    press = { y: 0, cancelled: false, held: true, live: true, cancelPx: 0, onTap: () => {}, timer: 0, fed: true };
    liveHold(true);
    for (const c of chunks) {
      if (!press || !press.fed || LV.model.status !== 'holding') return;
      tvPush(c); tvLevel(c);
      await tvSleep(100);
    }
    if (!press || !press.fed) return;
    press = null;
    liveRelease(false, false);
  };
  /** 一直听的:见上 */
  const trialOpen = async (chunks) => {
    const seen = { stopped: false, judged: false };
    TV.wait = (m) => { if (m.t === 'vad' && m.on === false) seen.stopped = true; if (m.t === 'kid' || m.t === 'skip') seen.judged = true; };
    try {
      if (!LV.gateOn) { LV.gateOn = true; lvSend({ t: 'gate', on: true }); }
      for (const c of chunks) { if (!LV.on) return; tvPush(c); tvLevel(c); await tvSleep(100); }
      const quiet = new Int16Array(1600);
      for (const until = Date.now() + 6000; !seen.stopped && Date.now() < until && LV.on; ) { tvPush(quiet.slice().buffer); await tvSleep(100); }
      for (const until = Date.now() + 8000; seen.stopped && !seen.judged && Date.now() < until && LV.on; ) await tvSleep(100);
    } finally {
      TV.wait = null;
      // gate 交回麦克风:关着麦的这里告诉服务端关
      if (LV.on) liveGateSync();
    }
  };
  const trialSay = async (text) => {
    const t = (text || '').trim();
    if (!t) return;
    if (TV.feeding) { typedBack(t); return; }
    if (!LV.ready) { connectingHint(); typedBack(t); return; }
    if (!LV.model.open && document.body.classList.contains('pending')) { busyHint(); typedBack(t); return; }
    unlock();
    if (LV.audio) LV.audio.wake().catch(() => {});
    TV.feeding = true;
    try {
      const v = await trialPcm(t);
      if (!v.chunks) { if (v.error) toast('配音没成,按打字发了:' + v.error); send(t); return; }
      if (!LV.on || !LV.ready) { typedBack(t); return; }
      if (LV.model.open) await trialOpen(v.chunks); else await trialHold(v.chunks);
    } finally { TV.feeding = false; }
  };
  /** 按住说话的那块:输入条中间那段(点一下 = 打字)、平板横屏实时左栏浮层里那块(点一下 = 一直听时关麦 / 开麦,别的时候提示要按住);
   *  上滑过 cancelPx 松手取消(浮层那块大,门限放宽到它的高) */
  const bindHold = (el, cancelPx, onTap) => {
  el.addEventListener('pointerdown', (e) => {
    if (S.bar === 'typing' || LV.letGo) return;
    e.preventDefault(); unlock();
    // 看以前的话题:不接,晃一下
    if (S.readonly && !REEL) { VB.btn.shake(); return; }
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
  /** 点了一下没按住:一直听时关麦 / 开麦(按钮上写着「点一下关麦」);别的时候晃一下提示,不打字(打字是下面那颗) */
  const holdTap = () => {
    if (LV.on && LV.model.open) { liveDispatch({ type: LV.model.muted ? 'unmute' : 'mute' }); return; }
    voiceHint('tap');
  };
  bindHold($('#lv-hold'), 120, holdTap);
  // 板铺满时那颗小头像:同左栏那颗(同一组按钮,字一样;口语课、看图说话铺着照片时只露这颗,关麦也在这)
  bindHold($('#cv-hold'), 80, holdTap);
  /**
   * 「给老师看」(板):轻点 = 只交板;按住说(满 300 毫秒,比头像长一点,免得点一下成了按住)= 板和这句话一起给老师。
   * 嘴没连上、一直听、老师在想、板上没画:只能点(点了照旧交)
   */
  const bindGive = (el) => {
    let tapAt = 0;
    el.addEventListener('pointerdown', (e) => {
      if (el.disabled || press || LV.letGo || !penInk() || !LV.on || !LV.ready || LV.model.open || S.bar === 'typing' || document.body.classList.contains('pending')) return;
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
  // 左栏最底下那排:拍照、相册走输入条与加号面板的那两个 file input(wireFile),打字同点输入条中间那段
  $('#lv-cam .ic').innerHTML = ICON.cameraLg; $('#lv-album .ic').innerHTML = ICON.album; $('#lv-type .ic').innerHTML = ICON.keyboard;
  $('#lv-cam').addEventListener('click', () => $('#cam input').click());
  $('#lv-album').addEventListener('click', () => $('#sheet input[multiple]').click());
  $('#lv-type').addEventListener('click', () => setBar(barNext(S.bar, 'tap')));
  // 试用:舞台上那颗「打字」;老师页上直接敲键盘(没按着、没在别的输入框里、能发的时候)= 点了打字,敲的那个字照常落进刚 focus 的框;Esc 收起
  if (TRIAL) {
    document.body.classList.add('trial');
    $('#cv-type .ic').innerHTML = ICON.keyboard;
    $('#cv-type').addEventListener('click', () => setBar(barNext(S.bar, 'tap')));
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (S.bar === 'typing') { if (e.key === 'Escape') { e.preventDefault(); typed.value = ''; typed.blur(); setBar(barNext(S.bar, 'blur')); } return; }
      if (e.key !== 'Enter' && e.key.length !== 1) return;
      const t = e.target;
      if (t && t !== document.body && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
      if (!S.tutor || !canSend() || press || S.bar !== 'idle' || psEl.classList.contains('on')) return;
      if (e.key === 'Enter') e.preventDefault();
      setBar(barNext(S.bar, 'tap'));
    });
  }

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
      for (const it of PS.items) if (!it.path) { const data = await psExport(it); const r = await api('POST', CONV + name + '/photos', { image: data }); it.path = r.path; it.w = r.w; it.h = r.h; }
    } catch (e) {
      PS.busy = false; psUi();
      if (e && e.status === 404) { psClose(); closeTutor(); }
      return;
    }
    const photos = PS.items.map((it) => it.path);
    const sized = PS.items.map((it) => ({ path: it.path, w: it.w, h: it.h }));
    playRec({ k: 'ps', e: 'send' });
    psClose();
    // 只发照片(2026-10-21 撤了配一句话:孩子一次都没用过;实时老师先说「我看一看图片」,孩子接着说就行)
    if (S.tutor && S.tutor.name === name) { const b = BP.on ? $('#board .blank') : null; if (b) b.remove(); send('', { photos }); bpPhotos(sized); }
  });

  // ---- 启动与心跳:不通就头像灰,什么都不报 ----
  if (REEL) reelBoot();
  else if (PREVIEW) loadHome().then(() => { const f = debug.get('front'); if (f) window.cotutorPreviewSet({ front: f }); pvTell({ act: 'ready', order: [...K.names] }); });
  else loadHome().then(() => {
    let resume = null; try { resume = sessionStorage.getItem('kid-resume'); sessionStorage.removeItem('kid-resume'); } catch {}
    const open = debug.get('tutor') || resume;
    // 地址栏里定落在哪的调试参数(tutor / new / hist / step / stage)只管这一次打开:读完就去掉,只留 device。孩子之后从首页换了老师地址栏不跟着变,
    // 留着的话刷新(或 Safari 自己重载、服务重启后的自动重载)永远回到地址栏里那位(2026-10-08 真机:在数学小课堂刷新跳到语文老师)
    try { const q = new URLSearchParams(); if (debug.get('device')) q.set('device', debug.get('device')); const rest = q.toString(); if (location.search !== (rest ? '?' + rest : '')) history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '')); } catch {}
    if (open && S.home) {
      const t = S.home.tutors.find((x) => x.name === open);
      if (t) {
        // 调试:&new=1 新话题空白态;&hist=<日期>.<话题> 只读回放以前的
        openTutor(t, { kind: 'today' });
        setTimeout(() => {
          const hv = debug.get('hist');
          if (hv) { const [d, th] = hv.split('.'); switchThread(d, th); }
        }, 400);
      }
    }
  });
  /** 服务换了新代码:孩子手上没事时重载,回到原来那位老师。正按着、在打字、在等老师、老师正在念、舞台或发照片屏开着,都先不动 */
  const staleReload = () => {
    if (!stale || document.hidden || REEL) return;
    if (press || S.pending || S.stage || S.bar !== 'idle' || psEl.classList.contains('on')) return;
    try { if (S.tutor && !S.readonly) sessionStorage.setItem('kid-resume', S.tutor.name); } catch {}
    location.reload();
  };
  setInterval(() => { staleReload(); if (S.tutor) { if (!S.pending) loadDay(true); } else loadHome(); }, 5000);
  // 离线页(offline-sw.ts):电脑关了、睡着了时,点开主屏幕图标看到「老师们还没到」,不是浏览器的报错。只在 https(或 localhost)上有;回放、预览里不装
  if (!REEL && !PREVIEW && window.isSecureContext && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  document.addEventListener('visibilitychange', () => { if (!document.hidden) (S.tutor ? loadDay(true) : loadHome()); });
  // 孩子端刷新(手动的、Safari 自己重载的)回到手上这位老师;在首页刷新就回首页。只读回放不记(重载回来是今天的)
  if (!REEL && !PREVIEW) window.addEventListener('pagehide', () => { try { if (S.tutor && !S.readonly) sessionStorage.setItem('kid-resume', S.tutor.name); else sessionStorage.removeItem('kid-resume'); } catch {} });
})();
</script>
</html>
`;

const KID_PAGE_SRC = PAGE.replace('__BOARD_JS__', () => libSource('kid-board')).replace('__LESSON_JS__', () => libSource('lesson')).replace('__WORD_DRAW_JS__', () => wordDrawJs()).replace('__PHOTO_JS__', () => libSource('photo-edit')).replace('__REEL_JS__', () => libSource('reel')).replace('__LIVE_JS__', () => libSource('live-board')).replace('__AUDIO_JS__', () => AUDIO_CLIENT_JS).replace('__VOICE_VIEW_JS__', () => libSource('voice-view')).replace('__VOICE_JS__', () => VOICE_JS).replace('__VOICE_CSS__', () => VOICE_CSS).replace('__REEL_DOCK_CSS__', () => REEL_DOCK_CSS).replace('__REEL_DOCK_HTML__', () => REEL_DOCK_HTML).replace('__REEL_DOCK_JS__', () => REEL_DOCK_JS).replace('__NEUTRAL_COLOR__', () => JSON.stringify(NEUTRAL_COLOR)).replace('__BRAND_CSS__', () => BRAND_CSS).replace('__BACK_LOGO__', () => BACK_LOGO).replace('__BRAND_JS__', () => BRAND_JS)
  .replace('__CAMERA_22__', () => JSON.stringify(cameraSvg(22))).replace('__CAMERA_28__', () => JSON.stringify(cameraSvg(28))).replace('__CAMERA_20__', () => JSON.stringify(cameraSvg(20))).replace('__ALBUM_28__', () => JSON.stringify(albumSvg(28)));
export const KID_PAGE = KID_PAGE_SRC.replace('__PAGE_V__', createHash('sha1').update(KID_PAGE_SRC).digest('hex').slice(0, 8));

export interface KidPageMode {
  /** 录像里孩子的屏幕(/reel):孩子端的样子,数据是 /reel 给的一个话题,只读、不记、点不动 */
  reel?: boolean;
  /** 家长端「首页」里的预览(/preview):孩子端首页本身,点了告诉家长页,不跳走、不记看过了 */
  preview?: boolean;
  /** 试用(sandbox 的 serve、mock):家长、开发者在电脑上试,键盘直接打字、舞台上露「打字」 */
  trial?: boolean;
}

/** 孩子端页面(录像、预览也是它):标题(已转义)填进去;mode 见 KidPageMode,不给 = 孩子端 */
export function kidPage(title: string, mode: KidPageMode = {}, stageV = '0'): string {
  return KID_PAGE.replaceAll('__TITLE__', title).replace('__SHORT__', title).replace('__MODE__', JSON.stringify(mode)).replace('__STAGE_V__', stageV);
}
