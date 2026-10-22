/**
 * 听写页的录像模式(《家长录像设计.md》拍板 13):中文页(page.ts)与英文页(en-page.ts)共用的那一段——钟、把手、念的那一刻放声音、启动。
 * 页面开在录像外壳(reel-page.ts)的 iframe 里,带 ?reel=<id>;轨道与任一刻的样子是纯函数 lib/reel.ts(一起内联进来)。
 * 页面自己要有:REEL_ID、S(S.v 放孩子端的样子,画左上角胶囊)、showFace、api、audio,和照这一刻画屏幕的 reelDraw(f)。
 * 脚本是 ES5(内联的纯函数除外),没有反斜杠与反引号,插进模板字符串也照样。
 */
import { inlineScript } from '../server/inline-lib.ts';

/** 录像的纯函数(lib/reel.ts) */
const DICT_REEL_JS = inlineScript(new URL('./lib/reel.ts', import.meta.url));

export const REEL_MODE_JS = `
  // ---------- 录像(?reel=<id>):照记录画,不经过页面的流程,不发事件、不自己念;画法在页面的 reelDraw ----------
${DICT_REEL_JS}
  var RL = null;
  /** 放声音用录像外壳那个 Audio(家长点播放时解锁过);念的那一刻放孩子当时听到的那一句 */
  var reelAudio = function () { try { if (window.parent !== window && window.parent.__cotutorAudio) return window.parent.__cotutorAudio; } catch (e) {} return audio; };
  var reelHush = function () { try { reelAudio().pause(); } catch (e) {} };
  var reelSay = function (t0, t1) {
    if (!RL.playing || RL.seeking || t1 <= t0) return;
    RL.r.says_.forEach(function (x) {
      if (x.t <= t0 || x.t > t1 || t1 - x.t > 1500) return;
      var a = reelAudio();
      a.src = '/api/dictation/' + RL.s.id + '/say/' + x.word;
      a.defaultPlaybackRate = RL.speed; a.playbackRate = RL.speed;
      var pr = a.play(); if (pr && pr.catch) pr.catch(function () {});
    });
  };
  var reelTick = function () {
    if (!RL) return;
    var t = performance.now();
    if (RL.playing && !RL.seeking) RL.p = Math.min(RL.clock.total, RL.p + (t - RL.last) * RL.speed);
    RL.last = t;
    var t0 = RL.t;
    RL.t = RL.clock.toWall(RL.p);
    RL.f = drFrameAt(RL.r, RL.t);
    reelDraw(RL.f);
    reelSay(t0, RL.t);
    if (RL.playing && RL.p >= RL.clock.total) reelPlay(false);
  };
  var reelPlay = function (on) {
    if (on && RL.p >= RL.clock.total) RL.p = 0;
    RL.playing = on; RL.last = performance.now();
    clearInterval(RL.timer); RL.timer = on ? setInterval(reelTick, 100) : 0;
    if (!on) reelHush();
    reelTick();
  };
  var reelTo = function (p, seeking) { RL.seeking = seeking; RL.p = Math.max(0, Math.min(RL.clock.total, p)); RL.last = performance.now(); reelHush(); reelTick(); };
  /** 把手:录像栏(reel-dock.ts)只经它说话 */
  var reelApi = {
    speeds: [1, 2, 4],
    get: function () { if (!RL) return null; return { p: RL.p, total: RL.clock.total, wall: RL.r.startAt + RL.t, playing: RL.playing, speed: RL.speed, real: RL.real, cap: drCaption(RL.r, RL.f), size: RL.f.size || [1180, 820] }; },
    marks: function () { return RL ? RL.r.marks.map(function (m) { return { kind: m.kind, label: m.label, p: RL.clock.toPlay(m.t) }; }) : []; },
    events: function () { return RL ? RL.r.notes.map(function (n) { return { p: RL.clock.toPlay(n.t), kind: n.kind, chip: n.chip, text: n.text }; }) : []; },
    chapters: function () { return RL ? RL.r.chapters.map(function (c) { return { p: RL.clock.toPlay(c.t), title: c.title }; }) : []; },
    play: function (on) { if (RL) reelPlay(on); },
    seek: function (p) { if (RL) reelTo(p, false); },
    drag: function (p) { if (RL) reelTo(p, true); },
    real: function (on) { if (!RL) return; RL.real = on; RL.clock = drClock(RL.r, on); RL.p = RL.clock.toPlay(RL.t); reelTick(); },
    speed: function (x) { if (!RL) return; RL.speed = x; var a = reelAudio(); a.defaultPlaybackRate = x; a.playbackRate = x; },
    stop: function () { if (RL) { clearInterval(RL.timer); reelHush(); RL = null; } },
    /** 跳到离开始 t 毫秒那一刻(探针) */
    seekAt: function (t) { if (RL) reelTo(RL.clock.toPlay(t), false); },
  };
  var reelBoot = function () {
    var host = null; try { if (window.parent !== window && typeof window.parent.cotutorReelReady === 'function') host = window.parent; } catch (e) {}
    // 只在家长端的录像外壳里开;直接打开什么都不放(孩子端页面里不写家长端的路径)
    if (!host) { document.body.textContent = '录像要从家长端打开'; return; }
    document.body.classList.add('rlk');
    // 点不动,只能上下翻:点、按在捕获阶段挡掉(滚动不受影响)
    ['click', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu'].forEach(function (k) { document.addEventListener(k, function (e) { e.stopPropagation(); if (k !== 'pointerdown' && k !== 'pointerup') e.preventDefault(); }, true); });
    var path = '/api/dictation/' + encodeURIComponent(REEL_ID);
    Promise.all([api('GET', path), api('GET', path + '/kid')]).then(function (x) {
      S.v = x[1]; showFace();
      var r = drBuild(x[0]);
      if (!r.first.length && !r.says_.length) { host.cotutorReelFail(); return; }
      RL = { s: x[0], r: r, p: 0, t: 0, playing: false, seeking: false, speed: 1, real: false, last: 0, timer: 0, key: '', gl: 0, f: null, std: '' };
      RL.clock = drClock(r, false);
      // 停在最后一帧(拍板 16:家长从记录点进来,最后一帧信息最多;要看过程往前拖)
      RL.p = RL.clock.total;
      reelTick();
      window.cotutorReel = reelApi;
      host.cotutorReelReady(reelApi, { size: RL.f.size || [1180, 820] });
      // 焦点在孩子的屏幕里时按键也认(《家长录像设计.md》拍板 22):交给外面的录像栏,它认了就不让这一页再处理
      document.addEventListener('keydown', function (e) { try { if (host.cotutorReelKey && host.cotutorReelKey({ key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey })) e.preventDefault(); } catch (x) {} });
    }, function () { host.cotutorReelFail(); });
  };

`;
