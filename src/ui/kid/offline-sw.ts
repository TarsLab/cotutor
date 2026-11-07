/**
 * 孩子端的离线页(Service Worker,GET /sw.js):电脑关了、睡着了、服务没在跑时,平板上打开孩子端看到的不是浏览器的报错,是「老师们休息中」。
 * 和页面开着时断线的样子(kid-page 的 #rest)同一句:都是「电脑那边连不上」;「老师们还没到」是百炼没配好,另一回事。
 * 孩子端永远没有错误:这一页只说老师们休息、叫爸爸妈妈,不说连接、不说服务器。
 * 页面开着时断线由页面自己管(灰掉、「老师们休息中」);这一页只在重新打开(iPad 把网页 App 清出内存后再点开、刷新)时出现。
 *
 * 只接管孩子端那几页的打开(导航);接口、静态文件、别的页面一律不碰。不缓存任何东西:平时原样走网络,孩子看不到旧页面;
 * 连不上或 12 秒没回应才给离线页,它每 5 秒问一次 /api/health,通了就自己刷新回去。
 * Service Worker 只在安全上下文里有(https 且平板信任了根证书,或 localhost);http 时孩子端照旧,什么都不变。
 * 改了这个文件就改 VERSION:平板上的旧 worker 靠脚本内容变了才换。
 */
const VERSION = '2';

/** 离线页本身:没有网可取,样式、脚本都内联 */
const OFFLINE_HTML = [
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  '<meta name="apple-mobile-web-app-capable" content="yes"><title>老师们休息中</title>',
  '<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#f7f3ea;color:#3a352c;',
  'font:22px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;text-align:center;-webkit-user-select:none;user-select:none}',
  'p{margin:0 24px}small{display:block;margin-top:12px;font-size:17px;color:#8a8273}</style></head>',
  '<body><p id="off">老师们休息中<small>叫爸爸妈妈来看一下:家里那台电脑是不是关了、睡着了</small></p>',
  '<script>setInterval(function(){fetch("/api/health",{cache:"no-store"}).then(function(r){if(r.ok)location.reload()}).catch(function(){})},5000)</script>',
  '</body></html>',
].join('');

export const KID_SW_JS = `// cotutor 孩子端的离线页 v${VERSION}(src/ui/kid/offline-sw.ts)
const KID = new Set(['/', '/dictation', '/dictation/', '/talk', '/talk/']);
const WAIT_MS = 12000;
const OFFLINE = ${JSON.stringify(OFFLINE_HTML)};
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.mode !== 'navigate' || r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin || !KID.has(u.pathname)) return;
  const offline = () => new Response(OFFLINE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  e.respondWith(Promise.race([
    fetch(r).catch(() => null),
    new Promise((resolve) => { setTimeout(() => resolve(null), WAIT_MS); }),
  ]).then((res) => res || offline()));
});
`;
