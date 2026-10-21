/**
 * 孩子端的整页跳转(《产品规划.md》拍板 25):孩子端不往浏览器历史里加东西。首页 ↔ 听写、首页 ↔ 口语课、口语单交给老师页、打完电话回首页都是「替换当前页」,
 * 孩子端在历史里永远只占一条——浏览器的后退、iPad 左边缘右滑在孩子端里不会把孩子带到旧页面,回首页只认左上角那颗胶囊。
 * 起因:10-21 Jack 在 iPad 与 Mac Safari 上按后退没反应或像卡住——做过一次听写,历史成了「首页 → 听写 → 首页」,后退回到旧听写页或一个一样的首页,
 * 孩子端开着麦克风与实时连接,Safari 不能原样存着秒回,只能整页重载、再连老师。
 * 万一页面是从浏览器缓存里原样恢复的(pageshow.persisted),重载一次,不让孩子看到一个停住的旧画面。
 * 用在孩子端首页 / 老师页(kid-page.ts,家长端、录像、预览不用)、听写(中、英)、口语课;tests/kid-nav.test.ts 盯着这几页都带它、没有 location.href 跳转。
 * 脚本是 ES5、没有反斜杠与反引号(插进各页的模板字符串)。
 */

/** kidGo(url):孩子端里跳到另一页,替换当前这条历史;页面里以 / 开头的同站链接点了也走它 */
export const KID_NAV_JS = `
  var kidGo = function (url) { location.replace(url); };
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target) return;
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) !== '/' || href.charAt(1) === '/') return;
    e.preventDefault(); kidGo(href);
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) location.reload(); });
`;
