/**
 * 工作台 /dev/voice:按钮样张。孩子端老师页那颗「头像 + 按住说话」按钮的每一种样子摆在一页上,
 * 用的是真的按钮(src/server/voice-ui.ts)和真的状态 → 样子(src/lib/voice-view.ts),场景表是 src/lib/voice-scenes.ts;声音是模拟的
 *(老师一段一段说、孩子说说停停、按着没声音)。孩子用几天要改动画:改 voice-ui.ts 开头的调参表,开这一页看全部。
 * 最上面一颗自己循环「打断的那一下」:老师在说 → 孩子按下 → 孩子在说 → 松手(老师在想)。有镜像开关。样子用工作台的色板(dev-theme.ts),按钮自己的颜色是孩子端的。
 */
import { inlineScript } from './inline-lib.ts';
import { DEV_CSS } from './dev-theme.ts';
import { VOICE_CSS, VOICE_JS } from './voice-ui.ts';
import { faviconLinks } from '../lib/favicon.ts';

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${faviconLinks()}
<title>按钮样张 · 工作台</title>
<style>
__DEV_CSS__
  body { padding:28px 32px 48px; }
  header { display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:8px; }
  h1 { margin:0; font-size:22px; font-weight:650; }
  header p { margin:0; color:var(--muted); font-size:13px; flex:1 1 360px; }
  label.sw { display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--ink-2); }
  h2 { margin:28px 0 12px; font-size:15px; font-weight:650; color:var(--ink-2); }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(340px, 1fr)); gap:16px; }
  .cell { background:var(--surface); border-radius:var(--r-card); box-shadow:var(--lift),0 0 0 1px var(--line); padding:14px 14px 12px; display:flex; flex-direction:column; gap:10px; }
  .cell b { font-size:14px; }
  .cell .k { font:500 11.5px/1 var(--mono); color:var(--faint); margin-left:6px; }
  .cell small { font-size:12.5px; color:var(--muted); line-height:1.5; }
  .stage { background:var(--surface-2); border-radius:var(--r-item); padding:14px 0; display:flex; justify-content:center; }
  .demo .stage { padding:22px 0; }
  .demo small b { font-weight:600; color:var(--ink); }
  /* 孩子端头像的样子(同 kid-page.ts 的 .av):学科色的 C 形开口环 + 白底圆里的字 */
  .av { position:relative; display:grid; place-items:center; font-weight:700; flex:0 0 auto; }
  .av .ring { position:absolute; left:0; top:0; width:100%; height:100%; overflow:visible; pointer-events:none; }
  .av .ring circle { fill:none; stroke:currentColor; stroke-width:7; stroke-linecap:round; stroke-dasharray:221.17 55.29; transform-origin:50px 50px; transform:rotate(36deg); }
  .av .face { position:absolute; left:15%; top:15%; width:70%; height:70%; border-radius:50%; background:#fff; display:grid; place-items:center; font-size:.76em; line-height:1; }
__VOICE_CSS__
</style>
</head>
<body>
<header>
  <h1>按钮样张</h1>
  <p>孩子端老师页那颗「头像 + 按住说话」的每一种样子,声音是模拟的。要改动画:改 src/server/voice-ui.ts 开头的调参表;样子的种类在 src/lib/voice-view.ts,场景表在 src/lib/voice-scenes.ts。</p>
  <label class="sw"><input type="checkbox" id="mirror">左撇子镜像</label>
</header>
<main id="main"></main>
<script>
(() => {
__VOICE_VIEW_JS__
__VOICE_SCENES_JS__
__VOICE_JS__
  const TUTORS = { chinese: { color: '#c43c74', text: '语' }, english: { color: '#2f8a7a', text: '英' } };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const avatar = (t) => { const a = el('span', 'av'); a.style.color = t.color; a.innerHTML = '<svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"></circle></svg><span class="face">' + t.text + '</span>'; return a; };
  const t0 = performance.now();
  /** 模拟的老师:一句 2.5 秒、停 0.6 秒,一个字 180 毫秒一起一落(放出去那条链上的 RMS 大约这么大) */
  const tutorLv = () => { const t = performance.now() - t0; if (t % 3100 > 2500) return 0; return 0.03 + 0.09 * Math.sin((t % 180) / 180 * Math.PI) * (0.6 + 0.4 * Math.sin(t / 700)); };
  /** 模拟的孩子:说 3 秒、停 1.2 秒,高高低低 */
  const kidLv = () => { const t = performance.now() - t0; if (t % 4200 > 3000) return 0; return Math.max(0, 0.2 + 0.6 * Math.abs(Math.sin(t / 130)) * (0.5 + 0.5 * Math.sin(t / 900))); };
  const all = [];
  const mount = (stage, tutor, sound) => {
    const b = el('button'); b.type = 'button';
    stage.append(b);
    const vb = voiceButton(b, { side: 'left', color: TUTORS[tutor].color });
    vb.avatar(avatar(TUTORS[tutor]));
    if (sound === 'tutor' || sound === 'both') vb.tutorSource(tutorLv);
    all.push({ vb, sound });
    return vb;
  };
  // 打断的那一下:自己循环
  const demo = el('section', 'cell demo');
  demo.append(el('b', '', '打断的那一下(自己循环)'));
  const ds = el('div', 'stage'); demo.append(ds);
  const dnote = el('small'); demo.append(dnote);
  const dvb = mount(ds, 'chinese', 'none');
  dvb.tutorSource(tutorLv);
  const steps = [
    { ms: 3200, input: { status: 'mouth' }, kid: false, say: '老师在说:头像旁三道小弧,深浅跟老师的音量' },
    { ms: 3600, input: { status: 'holding', holdAudio: true }, kid: true, say: '孩子按满 150 毫秒:老师的弧 0.15 秒收掉,整块变蓝,竖条往头像里走' },
    { ms: 2600, input: { pending: true }, kid: false, say: '松手:路上剩下的竖条 0.4 秒走进头像,按钮回灰白,头像转圈(老师在想)' },
  ];
  let si = 0;
  const step = () => { const s = steps[si % steps.length]; si++; dvb.set(voiceView(voiceIn(s.input))); dnote.replaceChildren(el('b', '', (si - 1) % steps.length + 1 + ' / ' + steps.length + ' '), document.createTextNode(s.say)); demo.dataset.kid = s.kid ? '1' : ''; setTimeout(step, s.ms); };
  step();
  const main = document.getElementById('main');
  main.append(demo);
  const groups = [];
  for (const s of VOICE_SCENES) if (!groups.includes(s.group)) groups.push(s.group);
  for (const g of groups) {
    main.append(el('h2', '', g));
    const grid = el('div', 'grid'); main.append(grid);
    for (const s of VOICE_SCENES.filter((x) => x.group === g)) {
      const c = el('section', 'cell');
      const t = el('b', '', s.name); t.append(el('span', 'k', s.expect));
      const st = el('div', 'stage');
      c.append(t, st, el('small', '', s.note));
      grid.append(c);
      const vb = mount(st, s.tutor, s.sound);
      vb.set(voiceView(voiceIn(s.input)));
      // 提示类的样子只晃一下;样张上每 3 秒再晃一次,看得见
      if (s.input.hint) setInterval(() => vb.shake(), 3000);
    }
  }
  setInterval(() => {
    for (const x of all) if (x.sound === 'kid' || x.sound === 'both') x.vb.level('kid', kidLv()); else if (x.sound === 'kidQuiet') x.vb.level('kid', 0);
    if (demo.dataset.kid) dvb.level('kid', kidLv());
  }, 60);
  document.getElementById('mirror').addEventListener('change', (e) => { for (const x of all) x.vb.side(e.target.checked ? 'right' : 'left'); });
})();
</script>
</body>
</html>
`;

export const VOICE_GALLERY_PAGE = PAGE
  .replace('__DEV_CSS__', () => DEV_CSS)
  .replace('__VOICE_CSS__', () => VOICE_CSS)
  .replace('__VOICE_VIEW_JS__', () => inlineScript(new URL('../lib/voice-view.ts', import.meta.url)))
  .replace('__VOICE_SCENES_JS__', () => inlineScript(new URL('../lib/voice-scenes.ts', import.meta.url)))
  .replace('__VOICE_JS__', () => VOICE_JS);
