/**
 * 第一声在点击里放开(《听写设计.md》拍板 18):iPad 的 Safari 只让手势里起的声音响,听写的第一声却常在请求回来之后才念
 *(拍照的「开始听写」、接着写),就被拦了,连浏览器的声也不退。所以孩子第一次点页面上任何地方,就在这一下里把 audio 元素
 * 放一段静音、浏览器的声念一个空句,两样都算解锁;同 kid-page.ts 的 unlock。插进中英两页的内联脚本,要求页面先有 audio。
 * 脚本是 ES5、没有反斜杠与反引号。
 */
export const UNLOCK_JS = `
  var unlocked = false;
  var unlock = function () {
    if (unlocked) return; unlocked = true;
    try { if (!audio.src || audio.src.indexOf('data:') === 0) { audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='; var pr = audio.play(); if (pr && pr.catch) pr.catch(function () {}); } } catch (e) {}
    try { if (window.speechSynthesis) { var u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) {}
  };
  document.addEventListener('pointerdown', unlock, true); document.addEventListener('click', unlock, true);
  /** 还是被拦了(NotAllowedError 不是音频坏了,不退浏览器的声):叫孩子点「再念」 */
  var blocked = function (e) { return Boolean(e && e.name === 'NotAllowedError'); };
`;
