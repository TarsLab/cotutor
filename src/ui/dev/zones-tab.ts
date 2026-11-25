/**
 * 工作台「分块」那一页的样式与脚本(docs/dev/课本.md,画布 https://claude.ai/artifact/Xvt6t4pp1xkLJ6VA6GBnkR):
 * 样式在这里,脚本是 ./zones-editor.ts(剥类型内联进 dev-page 的脚本里,用那边的 $ / h / api / ask / copy / state)。接口在 src/app/http/dev-zones.ts。
 * 颜色只用 dev-theme.ts 的变量;块蓝(--info)、作答区橙(--accent)、没人认领的候选红(--err)、字行灰,同 cotutor textbook preview 的意思。
 */
import { inlineScript } from '../shared/inline-lib.ts';

export const ZONES_CSS = `
  #zones .zn-wrap { max-width:none; }
  .zn { display:grid; grid-template-columns:220px minmax(0,1fr) 340px; gap:14px; align-items:start; }
  .zn-left { display:flex; flex-direction:column; gap:12px; position:sticky; top:0; max-height:calc(100vh - 40px); overflow:auto; padding-bottom:8px; }
  .zn-card { background:var(--surface); border-radius:14px; box-shadow:0 0 0 1px var(--line); padding:12px; display:flex; flex-direction:column; gap:6px; }
  .zn-card select { width:100%; height:34px; border:0; border-radius:var(--r-ctl); background:var(--surface-2); box-shadow:0 0 0 1px var(--line); padding:0 8px; }
  .zn-lab { font-size:12px; color:var(--muted); }
  .zn-warn { font-size:12px; line-height:1.5; color:var(--warn); background:var(--warn-soft); border-radius:8px; padding:6px 8px; display:flex; flex-direction:column; gap:4px; align-items:flex-start; }
  .zn-tree-l { padding:6px; gap:0; }
  .zn-uh { display:flex; align-items:center; gap:4px; width:100%; border:0; background:none; text-align:left; padding:4px 8px; font-size:12.5px; color:var(--muted); cursor:pointer; border-radius:8px; }
  .zn-uh:hover { color:var(--ink); }
  .zn-uh.in { color:var(--ink); font-weight:600; }
  .zn-ls { display:flex; flex-direction:column; gap:2px; width:100%; border:0; background:none; text-align:left; padding:6px 8px; border-radius:9px; cursor:pointer; }
  .zn-ls:hover { background:var(--surface-2); }
  .zn-ls.on { background:var(--surface-2); box-shadow:0 0 0 1.5px var(--info); }
  .zn-ls b { font-size:13.5px; font-weight:400; }
  .zn-ls.on b { font-weight:600; }
  .zn-ls span { display:flex; align-items:center; gap:6px; }
  .zn-ls .num { font-size:11px; color:var(--faint); }
  .zn-thumbs { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:8px; }
  .zn-th { position:relative; display:flex; flex-direction:column; align-items:center; gap:2px; border:0; background:none; padding:0; cursor:pointer; }
  .zn-th canvas, .zn-th i, .zn-th img { width:36px; height:50px; object-fit:cover; border-radius:3px; background:var(--surface); box-shadow:0 0 0 1px var(--line); display:block; }
  .zn-th.on canvas, .zn-th.on i, .zn-th.on img { box-shadow:0 0 0 2px var(--info); }
  .zn-th small { font:11px var(--mono); color:var(--muted); }
  .zn-th .dot { position:absolute; right:2px; top:-3px; background:var(--warn-dot); box-shadow:0 0 0 2px var(--surface); }

  .zn-bar { display:flex; align-items:center; flex-wrap:wrap; gap:8px 14px; padding:10px 14px; border-radius:12px; background:var(--warn-soft); color:var(--warn); font-size:13px; }
  .zn-bar[hidden] { display:none; }
  .zn-bar b { font-size:13.5px; }
  .zn-bar .acts { margin-left:auto; display:flex; gap:8px; }

  .zn-mid { display:flex; flex-direction:column; gap:10px; min-width:0; }
  .zn-tool { display:flex; align-items:center; flex-wrap:wrap; gap:8px 10px; }
  .zn-tool .right { margin-left:auto; display:flex; align-items:center; gap:4px; }
  .zn-tg { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 10px 0 7px; border:0; border-radius:8px; background:transparent; color:var(--muted); font-size:12.5px; cursor:pointer; }
  .zn-tg i { width:14px; height:14px; border-radius:4px; border:1.5px solid var(--off); background:var(--surface); }
  .zn-tg.on i { border-color:currentColor; background:currentColor; box-shadow:inset 0 0 0 2.5px var(--surface); }
  .zn-tg.on.z { color:var(--info); } .zn-tg.on.r { color:var(--accent); } .zn-tg.on.c { color:var(--err); } .zn-tg.on.w { color:var(--ink-2); }
  .zn-tg:disabled { opacity:.4; cursor:default; }
  .zn-stage { display:flex; justify-content:center; padding:14px 0 10px; border-radius:14px; background:var(--sunk); overflow:auto; }
  .zn-page { position:relative; flex:none; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.12); }
  .zn-page canvas, .zn-page img { position:absolute; inset:0; width:100%; height:100%; }
  .zn-page .zn-msg { position:absolute; left:16px; right:16px; top:16px; font-size:12.5px; color:var(--muted); }
  .zn-ov { position:absolute; inset:0; touch-action:none; cursor:default; }
  .zn-ov.add { cursor:crosshair; }
  .zn-ov > * { position:absolute; pointer-events:none; box-sizing:border-box; }
  .zn-tag { position:absolute; left:-1px; top:-19px; padding:0 6px; border-radius:4px; font:600 11px/17px var(--sans); white-space:nowrap; background:var(--surface); color:var(--info); box-shadow:0 0 0 1px var(--info); }
  .zn-tag.in { top:1px; left:1px; }
  .zn-tag.on { background:var(--info); color:#fff; }
  .zn-hd { width:9px; height:9px; margin:-4.5px 0 0 -4.5px; background:#fff; border:1.5px solid var(--info); border-radius:2px; }
  .zn-guide { border-left:1.5px dashed var(--accent); }
  .zn-guide.y { border-left:0; border-top:1.5px dashed var(--accent); }
  .zn-gl { padding:0 7px; border-radius:5px; background:var(--accent); color:#fff; font:600 11px/19px var(--sans); white-space:nowrap; }
  .zn-pop { pointer-events:auto !important; z-index:2; width:210px; padding:10px 12px; border-radius:12px; background:var(--surface); box-shadow:0 6px 22px rgba(0,0,0,.18); display:flex; flex-direction:column; gap:8px; font-size:12.5px; line-height:1.45; }
  .zn-pop .acts { display:flex; gap:6px; flex-wrap:wrap; }
  .zn-finger { width:40px; height:40px; margin:-20px 0 0 -20px; border-radius:20px; background:rgba(60,60,60,.16); border:2px solid rgba(60,60,60,.38); }

  .zn-side { background:var(--surface); border-radius:16px; box-shadow:0 0 0 1px var(--line); overflow:auto; position:sticky; top:0; max-height:calc(100vh - 40px); }
  .zn-sec { padding:14px 16px; border-top:1px solid var(--line-soft); display:flex; flex-direction:column; gap:10px; }
  .zn-sec:first-child { border-top:0; }
  .zn-sec h3 { margin:0; font-size:14px; font-weight:600; display:flex; align-items:baseline; gap:8px; }
  .zn-sec h3 small { font-size:12px; color:var(--muted); font-weight:400; }
  .zn-dl { margin:0; display:grid; grid-template-columns:56px minmax(0,1fr); gap:6px 10px; font-size:13px; }
  .zn-dl dt { color:var(--muted); }
  .zn-dl dd { margin:0; min-width:0; overflow-wrap:anywhere; }
  .zn-ask { background:var(--surface-2); }
  .zn-quote { padding:9px 11px; border-radius:10px; background:var(--surface); box-shadow:0 0 0 1px var(--line); font-size:13px; line-height:1.55; }
  .zn-ls[aria-disabled="true"] { cursor:default; }
  .zn-crumb { display:flex; align-items:center; flex-wrap:wrap; gap:4px; font-size:13px; }
  .zn-crumb button { border:0; background:none; padding:0; color:var(--accent); cursor:pointer; font-size:13px; }
  .zn-crumb i { font-style:normal; color:var(--faint); }
  .zn-f { display:flex; flex-direction:column; gap:4px; min-width:0; }
  .zn-f label, .zn-f .zn-lab { font-size:12px; color:var(--muted); }
  .zn-f label small { color:var(--faint); }
  .zn-f input, .zn-f select { width:100%; height:34px; border:0; border-radius:var(--r-ctl); background:var(--surface-2); box-shadow:0 0 0 1px var(--line); padding:0 10px; font-size:13.5px; min-width:0; }
  .zn-f input:focus, .zn-f select:focus { outline:none; box-shadow:0 0 0 1.5px var(--accent-line); }
  .zn-row2 { display:grid; grid-template-columns:110px minmax(0,1fr); gap:10px; }
  .zn-inl { display:flex; gap:6px; }
  .zn-ids { display:flex; flex-wrap:wrap; gap:4px 14px; font-size:12px; color:var(--muted); }
  .zn-ids .num { color:var(--ink); }
  .zn-reg { display:flex; align-items:center; gap:8px; width:100%; padding:7px 10px; border:0; border-radius:10px; background:var(--surface-2); box-shadow:0 0 0 1px var(--line-soft); font-size:13px; text-align:left; cursor:pointer; }
  .zn-reg i { width:14px; height:10px; border:1.5px solid var(--accent); border-radius:2px; flex:none; }
  .zn-reg .num { margin-left:auto; font-size:11px; color:var(--muted); }
  .zn-reg .ok { color:var(--ok); }
  .zn-tr { display:flex; align-items:center; gap:7px; min-height:28px; padding:0 8px; border-radius:8px; font-size:13px; white-space:nowrap; cursor:pointer; user-select:none; }
  .zn-tr:hover, .zn-tr.hov { background:var(--surface-2); }
  .zn-tr.on { background:var(--info-soft); font-weight:600; }
  .zn-tr.into { box-shadow:inset 0 0 0 1.5px var(--info); background:var(--info-soft); }
  .zn-tr.before { box-shadow:inset 0 2px 0 var(--info); }
  .zn-tr.after { box-shadow:inset 0 -2px 0 var(--info); }
  .zn-tr span.l { overflow:hidden; text-overflow:ellipsis; }
  .zn-k { flex:none; width:36px; font-size:11px; color:var(--muted); text-align:center; background:var(--sunk); border-radius:5px; line-height:18px; font-weight:400; }
  .zn-tr .m { margin-left:auto; font:11.5px var(--mono); color:var(--faint); font-weight:400; }
  .zn-prob { padding:8px 10px; border-radius:10px; background:var(--err-soft); color:var(--err); font-size:12.5px; line-height:1.5; }
  .zn-note { padding:8px 10px; border-radius:10px; background:var(--surface-2); color:var(--muted); font-size:12.5px; line-height:1.5; }
  .zn-legend { display:flex; align-items:center; gap:8px; font-size:12.5px; }
  .zn-legend i { width:18px; height:11px; border-radius:3px; flex:none; }
  .zn-hit { display:flex; gap:10px; padding:10px 12px; border-radius:12px; background:var(--surface-2); font-size:13px; }
  .zn-hit.win { background:var(--info-soft); box-shadow:0 0 0 1.5px var(--info); }
  .zn-hit .num { font-weight:700; color:var(--faint); }
  .zn-hit.win .num { color:var(--info); }
  .zn-hit div { display:flex; flex-direction:column; gap:2px; }
  .zn-hit small { color:var(--muted); }

  @media (max-width: 1180px) {
    .zn { grid-template-columns:200px minmax(0,1fr); }
    .zn > .zn-side { grid-column:1/-1; position:static; max-height:none; }
  }
  @media (max-width: 760px) {
    .zn { grid-template-columns:1fr; }
    .zn-left { position:static; max-height:none; }
  }`;

/** 分块页的脚本(剥类型):插在 dev-page 的脚本里 */
export function zonesTabJs(): string {
  return inlineScript(new URL('./zones-editor.ts', import.meta.url));
}
