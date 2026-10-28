/**
 * 孩子端的拍照,一个相机、一套骨架(设计稿 https://claude.ai/artifact/SPtjRhH9aLoLQoGfCNJaVz)。
 * 相机就是老师页输入条「按住说话」前面那个;哪里拍照都用它,字只用「拍照」「相册」「重拍」。主按钮老师的颜色(--sc),次按钮白底。
 * 分场景靠用途图(田字格「字」、四线格「Aa」、对话气泡「Hi」),不靠换按钮;用途图照首页老师卡上「拍照听写」那个(cards/tutor/card.css 的 .bt-x-photo .pg),两处改要一起改。
 * 字符串里没有反斜杠与反引号:插进各页的模板字符串。
 */

const CAMERA_PATHS = '<path d="M4 8h3l2-3h6l2 3h3v11H4z"></path><circle cx="12" cy="13" r="3.5"></circle>';
const ALBUM_PATHS = '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 15l5-4 4 3 3-2 6 4"></path>';

const svg = (paths: string, size: number, sw = 2): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** 相机图标;size 是 px,不写多大由所在处的样式定 */
export const cameraSvg = (size = 22, sw = 2): string => svg(CAMERA_PATHS, size, sw);
/** 相册图标 */
export const albumSvg = (size = 22, sw = 2): string => svg(ALBUM_PATHS, size, sw);
/** 播放:「接着写」「接着上」,听写页的「开始」同一个(src/dictation/ui.ts) */
export const playSvg = (size = 22, sw = 1.8): string => svg('<path d="M8 5.5v13l10.5-6.5z"></path>', size, sw);

/** 拍照屏的三种场景:语文听写、英语听写、口语课;按钮一样,用途图、标题、一句话不同 */
export type SnapKind = 'zh' | 'en' | 'talk';
const SNAP: Record<SnapKind, { pg: string; title: string; say: string; more: string; resume: string; go: string }> = {
  zh: { pg: '<span class="pg" aria-hidden="true"><i>字</i>', title: '拍照听写', say: '拍语文书上要写的词', more: '词语、写字,或者老师发的听写单。拍正一点,字要清楚。', resume: '刚才的还没写完', go: '接着写' },
  en: { pg: '<span class="pg en" aria-hidden="true"><i>Aa</i>', title: '拍照听写', say: '拍英语书上要写的单词', more: '课本上的单词表,或者老师发的听写单。拍正一点,字母要清楚。', resume: '刚才的还没写完', go: '接着写' },
  talk: { pg: '<span class="pg talk" aria-hidden="true"><i>Hi</i>', title: '口语课', say: '拍今天学的那一页', more: '先跟老师读,再打电话用这些词聊。拍印刷的字,手写的先别拍。', resume: '上次的口语单', go: '接着上' },
};

/** 拍照屏(听写、口语课同一个):中间老师的大头像、用途图与标题、一句话、拍照 / 相册;接着上一回的那块在最上面 */
export const snapHtml = (o: { kind: SnapKind; id: string; cam: string; lib: string }): string => {
  const k = SNAP[o.kind];
  return `<div class="snap" id="${o.id}">
    <div class="resume" id="snap-resume" hidden><div><b>${k.resume}</b><small id="snap-resume-sub"></small></div><button class="main" type="button" id="snap-resume-go">${playSvg()}<span>${k.go}</span></button></div>
    <span class="snap-av" id="snap-av" aria-hidden="true"></span>
    <div class="snap-ttl">${k.pg}<span class="cam">${cameraSvg(17, 2.4)}</span></span><h1>${k.title}</h1></div>
    <div class="snap-sub"><b>${k.say}</b><span>${k.more}</span></div>
    <div class="snap-btns"><label class="shoot" id="snap-cam-btn">${cameraSvg(26)}<span>拍照</span><input type="file" accept="image/*" capture="environment" id="${o.cam}"></label><label class="shoot alt">${albumSvg(26)}<span>相册</span><input type="file" accept="image/*" id="${o.lib}"></label></div>
  </div>`;
};

/** 拍照屏的样式;页面要有 --sc(老师的颜色)、--line、--dim。#snap-cam-btn 加 .alt 让成次要(有「接着写」时) */
export const SNAP_CSS = `
  .snap { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:20px; padding:58px 0 24px; text-align:center; }
  .snap-av { width:120px; height:120px; flex:none; }
  .snap-av .tfav { width:120px; height:120px; font-size:56px; }
  .snap-ttl { display:flex; align-items:center; gap:20px; }
  .snap-ttl h1 { margin:0; font-size:32px; font-weight:700; }
  .snap-sub { display:flex; flex-direction:column; gap:6px; max-width:560px; }
  .snap-sub b { font-size:20px; font-weight:400; }
  .snap-sub span { font-size:16px; color:var(--dim); }
  .snap-btns { display:flex; gap:14px; flex-wrap:wrap; justify-content:center; margin-top:8px; }
  .shoot { position:relative; overflow:hidden; display:inline-flex; align-items:center; justify-content:center; gap:10px; min-height:64px; padding:0 34px; border-radius:32px; background:var(--sc); color:#fff; border:1px solid var(--sc); font-size:20px; font-weight:600; cursor:pointer; }
  .shoot.alt { background:#fff; color:var(--ink); border-color:var(--line); }
  .shoot svg { flex:none; }
  .shoot input { position:absolute; inset:0; opacity:0; font-size:200px; cursor:pointer; }
  .shoot:active { transform:scale(.96); filter:brightness(.94); }
  .pg { position:relative; flex:none; width:60px; height:60px; }
  .pg i { position:absolute; inset:0; display:grid; place-items:center; font-style:normal; font-size:36px; line-height:1; color:#c9b48a; border:1.5px solid #c9a660; background:repeating-linear-gradient(to bottom,#e3cc9a 0 3px,transparent 3px 6px) center/1.5px 100% no-repeat,repeating-linear-gradient(to right,#e3cc9a 0 3px,transparent 3px 6px) center/100% 1.5px no-repeat,#fff; }
  .pg.en { width:84px; height:52px; }
  .pg.en i { font-size:31px; font-family:"Chalkboard SE","Comic Sans MS","Marker Felt",sans-serif; color:#8fa0b2; border-color:#c9d2de; background:linear-gradient(#cdd6e2,#cdd6e2) 0 16%/100% 1.5px no-repeat,linear-gradient(#cdd6e2,#cdd6e2) 0 40%/100% 1.5px no-repeat,linear-gradient(#e39a9a,#e39a9a) 0 66%/100% 2px no-repeat,linear-gradient(#cdd6e2,#cdd6e2) 0 90%/100% 1.5px no-repeat,#fff; }
  /* 口语课:对话气泡「Hi」(首页老师卡上同一个,cards/tutor/card.css 的 .bt-x-talk) */
  .pg.talk { width:72px; height:56px; }
  .pg.talk i { font-size:28px; font-weight:700; font-family:"Chalkboard SE","Comic Sans MS","Marker Felt",sans-serif; color:var(--sc); border:1.5px solid color-mix(in srgb, var(--sc) 40%, #fff); border-radius:18px 18px 18px 5px; background:#fff; }
  .pg .cam { position:absolute; right:-11px; bottom:-10px; width:32px; height:32px; border-radius:50%; background:var(--sc); color:#fff; display:grid; place-items:center; box-shadow:0 0 0 2px var(--paper); }
  /* 今天没写完的拍照听写:拍照屏最上面一块,点了接着写 */
  .resume { display:flex; align-items:center; gap:24px; padding:12px 12px 12px 26px; background:#fff; border:1px solid var(--line); border-radius:32px; text-align:left; box-shadow:0 2px 10px #00000010; }
  .resume b { display:block; font-size:20px; } .resume small { display:block; color:var(--dim); font-size:15px; }
  @media (max-height:600px) { .snap { gap:14px; } .snap-av, .snap-av .tfav { width:84px; height:84px; font-size:40px; } }
`;
