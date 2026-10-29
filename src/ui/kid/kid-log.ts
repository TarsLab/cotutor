/**
 * 孩子端的流水,页面这一半:各页共用的那段脚本,把打开、出错、前台时长、权限、连接报给 POST /api/kid/log。
 * 服务端收、存、读(.cotutor/kid-log/<日期>.jsonl 与设备表 .cotutor/devices.json)在 src/runtime/journal/kid-log.ts。
 */
/**
 * 各页共用的那段脚本:装上出错的监听,kidLog.start({page, mode, v, ctx}) 报一次打开(只在 mode 是 kid 时)。
 * 孩子端模式下还在前台计时(7.4):切到后台、离开页面时记一笔 fg,一直开着每 5 分钟也记一笔;不满 1 秒的不记。
 * 打开那行带 caps(7.2):麦克风权限(问 navigator.permissions,问不出 unknown;最多等 1.5 秒)、有没有 getUserMedia;
 * 麦克风权限变了、kidLog.blocked('autoplay')(老师的声音被浏览器拦了,一次打开只记一次)各记一行 perm。
 * 连接(7.3):kidLog.offline(on) 心跳断了 / 又通了,通了那一下记 net offline 与断了多久;kidLog.live(opened, ms) 实时老师的连接不是孩子自己收的、自己关了。
 * 同一次打开里同一条报错只报一次、最多 20 条(防一个死循环写满文件,是护栏不是限额);只收脚本错,图片、声音读不出不收。
 * 用在首页 / 老师页(kid-page.ts,各种模式都带)、听写(中、英)、口语课;tests/kid-log.test.ts 盯着这几页都带它。
 * 脚本是 ES5、没有反斜杠与反引号(插进各页的模板字符串)。
 */
export const KID_LOG_JS = `
  var kidLog = (function () {
    var sent = {}, n = 0, page = '', mode = 'kid', v = '', ctx = null, fgSince = 0, blocked = {}, offSince = 0;
    var cut = function (s, k) { s = String(s == null ? '' : s); return s.length > k ? s.slice(0, k) : s; };
    var post = function (row) { try { fetch('/api/kid/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row), keepalive: true, credentials: 'same-origin' }).catch(function () {}); } catch (e) {} };
    var report = function (msg, where, stack) {
      var key = msg + '@' + where;
      if (sent[key] || n >= 20) return;
      sent[key] = 1; n++;
      var c = null;
      try { c = ctx ? ctx() : null; } catch (e) { c = null; }
      post({ k: 'error', page: page, mode: mode, v: v, msg: cut(msg, 300), where: where, stack: cut(stack, 1500), ua: cut(navigator.userAgent, 400), ctx: c });
    };
    window.addEventListener('error', function (e) {
      if (!e || typeof e.message !== 'string') return;
      report(e.message || 'error', (e.lineno || 0) + ':' + (e.colno || 0), e.error && e.error.stack);
    });
    var flushFg = function () {
      if (!fgSince) return;
      var ms = Date.now() - fgSince;
      if (ms < 1000 && !document.hidden) return;
      fgSince = document.hidden ? 0 : Date.now();
      if (ms >= 1000) post({ k: 'fg', page: page, ms: Math.round(ms) });
    };
    window.addEventListener('unhandledrejection', function (e) {
      var r = e ? e.reason : null;
      report('unhandledrejection: ' + (r && r.message ? r.message : String(r)), '', r && r.stack);
    });
    return {
      offline: function (on) {
        if (mode !== 'kid') return;
        if (on) { if (!offSince) offSince = Date.now(); return; }
        if (!offSince) return;
        var ms = Date.now() - offSince;
        offSince = 0;
        post({ k: 'net', page: page, what: 'offline', ms: Math.round(ms) });
      },
      live: function (opened, ms) {
        if (mode !== 'kid') return;
        post({ k: 'net', page: page, what: 'live', opened: Boolean(opened), ms: Math.round(ms || 0) });
      },
      blocked: function (what) {
        if (mode !== 'kid' || blocked[what]) return;
        blocked[what] = 1;
        post({ k: 'perm', page: page, what: what, state: 'blocked' });
      },
      start: function (o) {
        page = o.page || ''; mode = o.mode || 'kid'; v = o.v || ''; ctx = o.ctx || null;
        if (mode !== 'kid') return;
        var standalone = Boolean(navigator.standalone);
        try { standalone = standalone || matchMedia('(display-mode: standalone)').matches; } catch (e) {}
        var caps = { mic: 'unknown', gum: Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) };
        var opened = false;
        var sendOpen = function (mic) {
          if (opened) return;
          opened = true; caps.mic = mic;
          post({ k: 'open', page: page, v: v, ua: cut(navigator.userAgent, 400), touch: navigator.maxTouchPoints || 0, standalone: standalone, w: screen.width, h: screen.height, vw: innerWidth, vh: innerHeight, dpr: window.devicePixelRatio || 1, lang: cut(navigator.language, 20), caps: caps });
        };
        setTimeout(function () { sendOpen('unknown'); }, 1500);
        try {
          navigator.permissions.query({ name: 'microphone' }).then(function (st) {
            sendOpen(st.state);
            st.onchange = function () { post({ k: 'perm', page: page, what: 'mic', state: st.state }); };
          }, function () { sendOpen('unknown'); });
        } catch (e) { sendOpen('unknown'); }
        fgSince = document.hidden ? 0 : Date.now();
        document.addEventListener('visibilitychange', function () { if (document.hidden) flushFg(); else fgSince = Date.now(); });
        window.addEventListener('pagehide', flushFg);
        setInterval(function () { if (!document.hidden) flushFg(); }, 300000);
      },
    };
  })();
`;
