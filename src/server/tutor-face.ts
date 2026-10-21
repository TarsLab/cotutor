/**
 * 老师的脸:学科色 + C 形开口环 + 白底圆里的图或字。学科色服务端定好随老师下发(t.color,src/lib/tutor-color.ts)。
 * 听写页、口语课用这里的「‹ logo」胶囊回首页(《wip/听写设想.md》拍板 16,《首页设计.md》拍板 27;《产品规划.md》拍板 24 起放 logo、不放老师头像),
 * 样子照 kid-page.ts 的 #back,两处改要一起改(logo 是 brand.ts 的 BACK_LOGO,两处同一份)。
 * 脚本是 ES5、没有反斜杠与反引号(插进各页的模板字符串)。
 */

import { BACK_LOGO } from './brand.ts';

/** 听写页、口语课用:tutorAvatar(t) → 一个 .tfav(大小由所在处的样式定);backCapsule(onClick) → { el }(「‹ logo」,不带老师);t = /api/kid/home 里 tutors 的一项(name、display、avatar、color) */
export const TUTOR_FACE_JS = `
  var tutorAvatar = function (t) {
    var av = document.createElement('span'); av.className = 'tfav'; av.style.color = t.color;
    av.innerHTML = '<svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"></circle></svg>';
    var face = document.createElement('span'); face.className = 'face';
    if (t.avatar && /[.](png|jpe?g|webp|svg)$/i.test(t.avatar)) { var img = document.createElement('img'); img.src = '/api/kid/avatar/' + encodeURIComponent(t.name); img.alt = ''; face.append(img); }
    else face.textContent = t.avatar || (t.subject || t.display || '?').slice(0, 1);
    av.append(face);
    return av;
  };
  var backCapsule = function (onClick) {
    var el = document.createElement('button'); el.type = 'button'; el.id = 'back'; el.setAttribute('aria-label', '回首页');
    el.innerHTML = '<i class="bk-ic"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg></i>${BACK_LOGO}';
    el.addEventListener('click', onClick);
    return { el: el };
  };
`;

export const TUTOR_FACE_CSS = `
  #back { position:fixed; top:calc(env(safe-area-inset-top) + 10px); left:calc(env(safe-area-inset-left) + 12px); z-index:20; display:flex; align-items:center; gap:2px; height:48px; min-width:48px; padding:0 4px 0 8px; border-radius:24px; background:#fffffff0; border:1px solid var(--line); box-shadow:0 2px 10px #00000018; color:inherit; cursor:pointer; transition:transform .12s; }
  #back[hidden] { display:none; }
  #back:active { transform:scale(.94); filter:brightness(.92); transition-duration:.06s; }
  #back .bk-ic { width:24px; height:24px; color:var(--dim); display:grid; place-items:center; }
  #back .ct-logo { display:block; flex:none; overflow:visible; color:var(--ink); margin:0 8px 0 4px; }
  .tfav { position:relative; font-weight:700; display:grid; place-items:center; flex:none; }
  .tfav .ring { position:absolute; left:0; top:0; width:100%; height:100%; overflow:visible; pointer-events:none; }
  .tfav .ring circle { fill:none; stroke:currentColor; stroke-width:8; stroke-linecap:round; stroke-dasharray:221.17 55.29; transform-origin:50px 50px; transform:rotate(36deg); }
  .tfav .face { position:absolute; left:15%; top:15%; width:70%; height:70%; border-radius:50%; background:#fff; overflow:hidden; display:grid; place-items:center; font-size:.76em; line-height:1; color:inherit; }
  .tfav img { width:100%; height:100%; object-fit:cover; }
  .bk-slot { width:100px; height:48px; flex:none; }
  .layer-x { width:48px; height:48px; border-radius:50%; background:#fffffff0; border:1px solid var(--line); box-shadow:0 2px 10px #00000018; display:grid; place-items:center; color:var(--dim); flex:none; cursor:pointer; }
  .layer-x svg { width:24px; height:24px; }
`;

/** 叠上来的一层(逐笔看、再写一遍)右上角的 ×,照老师页舞台的关 */
export const LAYER_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
