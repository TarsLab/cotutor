/** 工作台的交互样张。场景只提供通话状态；工作台和孩子端用同一颗老师签和同一张纸的位移场。 */
import { readFileSync } from 'node:fs';
import { inlineScript } from '../shared/inline-lib.ts';
import { DEV_CSS } from './dev-theme.ts';
import { VOICE_CSS, VOICE_JS } from '../kid/voice-ui.ts';
import { faviconLinks } from '../shared/favicon.ts';

const portraits = Object.fromEntries(['chinese', 'english'].map(subject => [
  subject, 'data:image/webp;base64,' + readFileSync(new URL(`../../../avatars/${subject}.webp`, import.meta.url)).toString('base64'),
]));

export const VOICE_GALLERY_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${faviconLinks()}<title>老师签 · 工作台</title><style>
${DEV_CSS}
* { box-sizing:border-box; }
body { max-width:1000px; margin:auto; padding:clamp(12px,4vw,42px); }
h1 { font-size:24px; }
form { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin:16px 0; }
select,form button { font:inherit; padding:6px; }
#sample { position:relative; height:clamp(370px,65vh,720px); overflow:hidden; border:1px solid #cec7ba; border-radius:12px; background:#fbf8ef; }
#paper { position:absolute; inset:0; overflow:hidden; padding:7% 10%; color:#473e31; background:repeating-linear-gradient(transparent 0 35px,#c8baa633 35px 36px),#fbf8ef; font:clamp(16px,2vw,24px)/1.95 "Songti SC",serif; }
#paper h2 { margin:8px 0 22px; font-size:1.6em; }
#paper p:last-child { margin-top:clamp(1em,9vh,5em); }
#sample button { position:absolute; z-index:2; left:0; top:50%; translate:0 -50%; }
#sample button.vb-right { left:auto; right:0; }
.av { position:relative; display:grid; place-items:center; }
.av .ring { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
.av .ring circle { fill:none; stroke:currentColor; stroke-width:7; stroke-linecap:round; stroke-dasharray:221.17 55.29; transform-origin:50px 50px; transform:rotate(36deg); }
.av img { width:100%; height:100%; border-radius:50%; pointer-events:none; }
.av .face { position:absolute; inset:15%; display:grid; place-items:center; background:#fff; border-radius:50%; }
#caption { position:absolute; bottom:5%; left:50%; translate:-50% 0; width:max-content; max-width:90%; background:#fffdf3ef; padding:4px 12px; border-radius:8px; }
${VOICE_CSS}
</style></head><body><h1>老师签</h1>
<form onsubmit="return false"><label>通话状态 <select id="scene"></select></label><label><input type="checkbox" id="mirror">头像在右侧</label><button type="button" id="again">重看此状态</button></form>
<div id="sample"><article id="paper"><small>语文　／　读一读</small><h2>溪边的柳树</h2><p>风从水面走过，柳条低下了头。<br>柳梢点着水，溪水画了一个圆。</p><p>读一读，找出写柳条动作的词。</p></article><button type="button" class="vb-sign" id="teacher"></button><div id="caption" hidden>柳条碰到水时，你看见了什么？</div></div>
<p id="note"></p><p>按住头像试试压纸。</p><script>
(() => {
${inlineScript(new URL('../kid/voice-view.ts', import.meta.url))}
${inlineScript(new URL('./voice-scenes.ts', import.meta.url))}
${VOICE_JS}
const byId = id => document.getElementById(id);
const teacher = byId('teacher'), scene = byId('scene');
const button = voiceButton(teacher), paper = paperPress(byId('paper'));
const portraits = ${JSON.stringify(portraits)};
const av = document.createElement('span');
av.className = 'av';
av.innerHTML = '<svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"/></svg><span class="face"><img alt="" draggable="false"></span>';
button.avatar(av);
for (const [index, s] of VOICE_SCENES.entries()) scene.add(new Option(s.group + ' · ' + s.name, index));
let finger = null, ghostTimer = 0, timer = 0, shown = {};
function display(input) {
  shown = input;
  const view = voiceView(voiceIn(input));
  button.set(view);
  byId('caption').hidden = input.status !== 'mouth';
}
function preview() {
  finger = null;
  clearTimeout(ghostTimer); clearTimeout(timer);
  const s = VOICE_SCENES[Number(scene.value)];
  byId('note').textContent = s.note;
  button.side(byId('mirror').checked ? 'right' : 'left');
  av.style.color = s.tutor === 'english' ? '#367969' : '#a84d69';
  av.querySelector('img').src = portraits[s.tutor];
  teacher.classList.remove('ghost');
  ghostTimer = setTimeout(() => teacher.classList.add('ghost'), 5000);
  display(s.input);
  if (s.input.status === 'holding' && !s.input.cancel) {
    paper.start(av);
  } else paper.set(false);
}
teacher.onpointerdown = e => {
  if (!e.isPrimary || e.button !== 0 || finger) return;
  const input = shown, view = voiceView(voiceIn(input));
  if (view.press === 'hint') { button.shake(); return; }
  clearTimeout(timer);
  teacher.setPointerCapture(e.pointerId);
  finger = { id:e.pointerId, y:e.clientY, input, started:0, cancel:false };
  paper.start(av);
  teacher.classList.add('ghost');
  if (!input.open) timer = setTimeout(() => {
    finger.started = performance.now(); display({status:'holding', holdAudio:true});
  },150);
};
teacher.onpointermove = e => {
  if (!finger?.started || e.pointerId !== finger.id) return;
  finger.cancel = finger.y - e.clientY > 80;
  paper.set(!finger.cancel); display({status:'holding',holdAudio:true,cancel:finger.cancel});
};
function finish(cancelled) {
  if (!finger) return;
  const { input, started, cancel } = finger;
  finger = null; clearTimeout(timer); paper.set(false);
  if (cancelled || cancel) { display(input.open ? input : {}); return; }
  if (input.open) { display({...input,muted:!input.muted}); return; }
  if (!started || performance.now()-started < 400) {
    display({hint:started?'unclear':'tap'}); button.shake();
    timer=setTimeout(()=>display({}),2000); return;
  }
  display({pending:true});
  timer=setTimeout(()=>{
    display({status:'mouth'});
    timer=setTimeout(()=>display({}),1900);
  },4000);
}
teacher.onpointerup = () => finish(false);
teacher.onlostpointercapture = teacher.onpointercancel = () => finish(true);
teacher.oncontextmenu = e => e.preventDefault();
scene.onchange = byId('mirror').onchange = preview;
byId('again').onclick = () => {
  preview();
  for (const animation of av.getAnimations({subtree:true})) animation.currentTime = 0;
};
preview();
})();
</script></body></html>`;
