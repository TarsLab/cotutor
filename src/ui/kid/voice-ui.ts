/** 老师签的外观和状态更新，孩子端和 /dev/voice 共用。只有 C 环参与等待动画，头像与状态字留在原位。 */
import { inlineScript } from '../shared/inline-lib.ts';

export const VOICE_CSS = `
  /* WebKit 在独立合成层中以纸面左上角为位移图原点；页在屏幕中段时，上下坡才与头像对齐。 */
  .paper-folded { transform:translateZ(0); }
  .paper-light { position:absolute; z-index:1; pointer-events:none; max-width:none; user-select:none; }
  .vb { position:relative; display:flex; align-items:center; justify-content:center; gap:12px; box-sizing:border-box; width:312px; height:120px; padding:8px 12px; background:transparent; border:0; color:#3e3932; font:inherit; touch-action:none; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
  .vb-right { flex-direction:row-reverse; }
  .vb:not(.vb-sign):active .vb-av { opacity:.7; }
  .vb-av { position:relative; display:grid; place-items:center; width:66px; height:66px; flex:none; }
  .vb-av > .av { width:100%; height:100%; font-size:30px; }
  .vb-av .face { opacity:.55; }
  .vb-side { display:grid; gap:3px; text-align:center; line-height:1.3; pointer-events:none; }
  .vb-big { font-size:18px; }
  .vb-small { font-size:13px; }
  .vb .vb-flag { position:absolute; right:0; bottom:1px; background:#fff; color:#435747; border:1px solid #8b998a; border-radius:5px; padding:0 3px; font:700 11px/1.4 sans-serif; }
  .vb [hidden] { display:none; }
  .vb-sign { width:88px; height:124px; flex-flow:column; gap:4px; padding:0 4px; border-radius:18px; }
  .vb-sign .vb-av { position:absolute; top:14px; left:50%; translate:-50% 0; }
  .vb-sign .vb-side { position:absolute; top:84px; left:4px; right:4px; }
  .vb-sign .vb-big { font-size:13px; }
  .vb-sign .vb-small { font-size:11px; }
  .vb-sign .vb-av, .vb-sign .vb-side { transition:opacity .6s; }
  .vb-sign:where(.ghost:not(.lit):not(.vb-invite):not(:active)) .vb-side, .vb-sign:has(.vb-talk) .vb-side { opacity:0; }
  .vb-sign:where(.ghost:not(.lit):not(.vb-invite):not(:active)) .vb-av, .vb-sign .vb-talk { opacity:.3; }
  .vb-sign:has(.vb-flag:not([hidden])) .vb-av { opacity:.75; }
  .vb .vb-listen .ring circle { stroke:#257c91; stroke-width:8; }
  .vb-dim .face { filter:grayscale(.85); }
  .vb-think .ring { color:#8b522a; scale:1.16; filter:drop-shadow(0 0 1px #fff9e7); transform-origin:center; animation:vb-wait-turn 2.4s linear 2s infinite; }
  .vb-think .ring circle { stroke-width:8; }
  .vb-wait .vb-big { font-size:19px; line-height:1.25; color:#643816; text-shadow:0 0 3px white,0 0 5px white,1px 1px 1px white; }
  .vb-sign.vb-wait .vb-big b { display:block; width:2em; margin:auto; }
  .vb-photo .vb-av::after { content:""; position:absolute; right:-1px; bottom:0; width:19px; height:13px; background:#fff8eb; border:2px solid #744622; border-radius:75% 20%; transform:rotate(35deg); }
  .vb-photo .vb-av::before { content:""; position:absolute; z-index:1; right:6px; bottom:5px; width:6px; height:6px; background:#744622; border-radius:50%; }
  .vb-photo .vb-flag { left:0; right:auto; }
  .vb-invite .ring { animation:vb-invite 1.2s ease-in-out 2; }
  .vb-shake .vb-side { animation:vb-shake .35s ease-in-out; }
  @keyframes vb-wait-turn { to { transform:rotate(1turn); } }
  @keyframes vb-invite { 0%,100% { opacity:.45; } 50% { opacity:1; } }
  @keyframes vb-shake { 25% { transform:translateX(-3px); } 75% { transform:translateX(3px); } }
  @media (prefers-reduced-motion:reduce) {
    .vb-think .ring,.vb-invite .ring,.vb-shake .vb-side { animation:none; }
    .vb-sign .vb-av,.vb-sign .vb-side { transition:none; }
  }`;

export const VOICE_JS = inlineScript(new URL('./voice-button.ts', import.meta.url)) + '\n' + inlineScript(new URL('./paper-raster.ts', import.meta.url)) + '\n' + inlineScript(new URL('./paper-press.ts', import.meta.url));
