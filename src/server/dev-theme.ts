/**
 * 工作台的设计语言「纸面控制台」(2026-10-16,《工作台设计.md》):/dev、/dev/qr 共用的一份色板与几样基本件。
 * 纸、墨、橙与家长端同源;状态色取自孩子端主题的 tints(moss / sand / sky)外加一个砖红;数字一律等宽。
 * 各页把 DEV_CSS 放进自己 <style> 的最前面,页面自己的样式只用这里的变量,不再写死颜色。
 */

/** 色板、字、圆角:名字是给页面样式用的,值改这里一处 */
const TOKENS = `
  :root {
    --ground:#F5F3EE; --surface:#FFFFFF; --surface-2:#FAF9F6; --sunk:#EDEAE3;
    --line:#E5E1D8; --line-soft:#EFECE6;
    --ink:#2B2B2B; --ink-2:#4A4740; --muted:#6B675F; --faint:#8A8781; --off:#C9C3B6;
    --accent:#B4531F; --accent-hover:#9A4519; --accent-soft:#F7E8DE; --accent-line:#D7A386;
    --ok:#1F7A44; --ok-soft:#E5F4EA;
    --warn:#8A5A12; --warn-soft:#F9F1DE; --warn-dot:#C08A2E;
    --info:#2F5E9E; --info-soft:#E9F1FB;
    --err:#B03A2E; --err-soft:#FBEAE6; --err-line:#F0C9C1;
    --kid:var(--info); --kid-soft:var(--info-soft);
    --parent:var(--warn); --parent-soft:var(--warn-soft);
    --sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;
    --mono:"SF Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
    --serif:"Songti SC","Times New Roman",serif;
    --r-card:18px; --r-turn:14px; --r-item:12px; --r-ctl:10px; --r-tag:6px;
    --lift:0 1px 2px rgba(43,43,43,.06);
  }`;

/** 基本件:按钮、数据片、状态签、输入、白卡、分段、开关 */
const BASE = `
  * { box-sizing:border-box; }
  body { margin:0; background:var(--ground); color:var(--ink); font:14px/1.55 var(--sans); }
  button, input, select, textarea { font:inherit; color:inherit; }
  a { color:var(--accent); text-decoration:none; }
  a:hover { color:var(--accent-hover); }
  .num { font-family:var(--mono); font-variant-numeric:tabular-nums; }

  .btn { display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 14px; border:0; border-radius:var(--r-ctl); background:var(--surface); box-shadow:0 0 0 1px var(--line); color:var(--ink); font-size:13.5px; cursor:pointer; white-space:nowrap; text-decoration:none; }
  .btn:hover { box-shadow:0 0 0 1px var(--accent-line); color:var(--ink); }
  .btn:disabled { opacity:.45; cursor:default; }
  .btn.primary { background:var(--accent); color:#fff; box-shadow:none; font-weight:600; }
  .btn.primary:hover { background:var(--accent-hover); color:#fff; }
  .btn.ink { background:var(--ink); color:#fff; box-shadow:none; font-weight:500; }
  .btn.ink:hover { background:#000; color:#fff; }
  .btn.soft { background:var(--accent-soft); color:var(--accent); box-shadow:none; font-weight:500; }
  .btn.soft:hover { color:var(--accent-hover); }
  .btn.danger { background:none; box-shadow:none; color:var(--err); }
  .btn.danger:hover { background:var(--err-soft); color:var(--err); }
  .btn.small { height:28px; padding:0 10px; font-size:12.5px; border-radius:8px; }

  .chip { display:inline-flex; align-items:center; gap:4px; font:500 12px/1 var(--mono); color:var(--muted); background:var(--surface); box-shadow:0 0 0 1px var(--line); border-radius:var(--r-tag); padding:5px 8px; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .chip b { color:var(--ink); font-weight:600; }
  .chip.slow { background:var(--warn-soft); box-shadow:none; color:var(--warn); }
  .chip.slow b { color:var(--warn); }
  .tag { display:inline-flex; align-items:center; font:500 12px/1 var(--mono); color:var(--ink-2); background:var(--sunk); border-radius:var(--r-tag); padding:4px 8px; white-space:nowrap; }
  .st { display:inline-flex; align-items:center; font:600 12px/20px var(--sans); border-radius:var(--r-tag); padding:0 8px; white-space:nowrap; background:var(--sunk); color:var(--muted); }
  .st.ok { background:var(--ok-soft); color:var(--ok); }
  .st.warn { background:var(--warn-soft); color:var(--warn); }
  .st.info { background:var(--info-soft); color:var(--info); }
  .st.err { background:var(--err-soft); color:var(--err); }
  .st.accent { background:var(--accent-soft); color:var(--accent); }
  .dot { width:7px; height:7px; border-radius:50%; background:var(--ok); flex:none; display:inline-block; }
  .dot.warn { background:var(--warn-dot); } .dot.err { background:var(--err); } .dot.off { background:var(--off); }

  .card-w { background:var(--surface); border-radius:var(--r-card); }
  .seg { display:inline-flex; padding:3px; border-radius:var(--r-ctl); background:var(--sunk); gap:2px; }
  .seg > * { height:28px; padding:0 12px; border:0; border-radius:8px; background:transparent; color:var(--ink-2); font-size:12.5px; cursor:pointer; display:inline-flex; align-items:center; text-decoration:none; }
  .seg > .on { background:var(--surface); color:var(--ink); font-weight:600; box-shadow:0 1px 2px rgba(43,43,43,.08); }
  input[type=checkbox] { accent-color:var(--accent); width:16px; height:16px; }
  :focus-visible { outline:2px solid var(--accent-line); outline-offset:1px; }`;

export const DEV_CSS = TOKENS + BASE;
