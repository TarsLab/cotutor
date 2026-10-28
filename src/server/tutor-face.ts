/**
 * 老师的脸:学科色 + C 形开口环 + 白底圆里的图或字。学科色服务端定好随老师下发(t.color,src/lib/tutor-color.ts)。
 * 听写页、口语课用这里的「‹ logo」胶囊回首页(放 logo、不放老师头像),
 * 样子照 kid-page.ts 的 #back,两处改要一起改(logo 是 brand.ts 的 BACK_LOGO,两处同一份)。
 * 脚本是 ES5、没有反斜杠与反引号(插进各页的模板字符串)。
 */

import { BACK_LOGO } from './brand.ts';
import { tutorColors } from '../lib/tutor-color.ts';

/**
 * 回首页胶囊带上老师:整颗填这位老师的颜色(同首页牌上那块首字小牌),logo 后面接名字的首字,箭头、logo、首字白色;
 * 还不知道是哪位老师时浅底只放 logo。老师页(kid-page.ts)、听写中英文与口语课(下面的 backCapsule)用这一份;小课堂舞台在 React 里照它画(src/stage/lecture.tsx)。
 * 首字的取法同首页牌上的 .fc:名字(display)的第一个字。tests/brand.test.ts 盯着几处一个样子。
 */
export const BACK_TINT_JS = `
  var tutorInitial = function (t) { return t ? (Array.from(t.display || '')[0] || '') : ''; };
  var backTint = function (el, t) {
    if (!el) return;
    var c = (t && t.color) || '';
    var ini = el.querySelector('.bk-ini');
    if (!ini) { ini = document.createElement('span'); ini.className = 'bk-ini'; ini.setAttribute('aria-hidden', 'true'); el.appendChild(ini); }
    var ch = c ? (t.initial || tutorInitial(t)) : '';
    ini.textContent = ch;
    el.classList.toggle('tinted', Boolean(c && ch));
    if (c && ch) el.style.setProperty('--bk', c); else el.style.removeProperty('--bk');
    el.setAttribute('aria-label', c && ch && t.display ? '回首页(' + t.display + ')' : '回首页');
  };
`;

/** 着色的胶囊(#back 上加 .tinted、--bk 是老师的颜色);两处的箭头类名不同(老师页 #back-ic、听写与口语课 .bk-ic) */
export const BACK_TINT_CSS = `
  #back.tinted { background:var(--bk); border-color:var(--bk); color:#fff; }
  #back.tinted .ct-logo { color:#fff; }
  #back.tinted #back-ic, #back.tinted .bk-ic { color:#ffffffd9; }
  #back .bk-ini { display:none; }
  #back.tinted .bk-ini { display:block; flex:none; margin:0 12px 0 -2px; font-size:23px; font-weight:800; line-height:1; color:#fff; }
`;

/** 服务端出页面时就知道是哪位老师(听写的念的老师、口语课链接带的 ?tutor=):把颜色、首字、名字插进页面,胶囊打开就是对的颜色;不知道 → null(浅底只放 logo) */
export function backTutorOf(tutors: Readonly<Record<string, { display?: string; subject?: string; color?: string }>>, name: string | null | undefined): { color: string; initial: string; display: string } | null {
  if (!name || !tutors[name]) return null;
  const color = tutorColors(tutors)[name];
  const display = tutors[name].display ?? name;
  const initial = Array.from(display)[0] ?? '';
  return color && initial ? { color, initial, display } : null;
}

/** 插进页面脚本的那一段 JSON(< 换掉,免得关掉 script) */
export const backTutorJson = (b: { color: string; initial: string; display: string } | null): string => JSON.stringify(b).replace(/</g, '\\u003c');

/** 听写页、口语课用:tutorAvatar(t) → 一个 .tfav(大小由所在处的样式定);backCapsule(onClick) → { el, set(t) }(「‹ logo 首字」,set(t) 填这位老师的颜色,t 为空浅底只放 logo);t = /api/kid/home 里 tutors 的一项(name、display、avatar、color) */
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
  ${BACK_TINT_JS}
  var backCapsule = function (onClick) {
    var el = document.createElement('button'); el.type = 'button'; el.id = 'back'; el.setAttribute('aria-label', '回首页');
    el.innerHTML = '<i class="bk-ic"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg></i>${BACK_LOGO}';
    el.addEventListener('click', onClick);
    return { el: el, set: function (t) { backTint(el, t); } };
  };
`;

export const TUTOR_FACE_CSS = `
  #back { position:fixed; top:calc(env(safe-area-inset-top) + 10px); left:calc(env(safe-area-inset-left) + 12px); z-index:20; display:flex; align-items:center; gap:2px; height:48px; min-width:48px; padding:0 4px 0 8px; border-radius:24px; background:#fffffff0; border:1px solid var(--line); box-shadow:0 2px 10px #00000018; color:inherit; cursor:pointer; transition:transform .12s; }
  #back[hidden] { display:none; }
  #back:active { transform:scale(.94); filter:brightness(.92); transition-duration:.06s; }
  #back .bk-ic { width:24px; height:24px; color:var(--dim); display:grid; place-items:center; }
  #back .ct-logo { display:block; flex:none; overflow:visible; color:var(--ink); margin:0 8px 0 4px; }
  @media (hover:hover) { #back:hover { filter:brightness(.97); } }
  ${BACK_TINT_CSS}
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
