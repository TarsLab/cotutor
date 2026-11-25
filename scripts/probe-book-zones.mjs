#!/usr/bin/env node
/**
 * 课本页的分块谁标得准(设计稿 docs/artifact/分块/):同一页课本图,交给几种跑法各标一遍(行框、嵌套的块、孩子要动手的地方),框和 PDF 里量出来的比。不进产品。
 * 起因(2026-11-25):想把课本的识别从规则(src/chalk/kit/book.ts 的 mathBlocks 这些)换成技能 + 脚本 + 大模型标注,
 * 要知道看图的模型给的框准不准、技能该建议家长用哪个编程助手。Claude Code 不比(它不出图,出练习册要出图);
 * Qwen Code 试过一页(数学二上 78 页,2026-11-25):框和 Codex 一样准,可一页 16 分钟(Codex 3–4 分钟),不比了。
 *
 * 跑法(--only 挑,缺省两种都跑;两种并排跑,每种一页一页来):
 *   qwen       百炼 qwen3.8-max 直接看图(src/media/vision.ts,家里那把 key),只回 JSON,不能跑脚本
 *   codex      Codex CLI(codex exec,模型照 ~/.codex/config.toml,--codex-model 改),在一个只有 page.png 的临时目录里,能写脚本量图,写 result.json;
 *              PATH 里没有就用 VS Code 扩展里带的(--codex-bin 指)
 *
 * 标准答案(只能从 PDF 量的那几样,题框、嵌套、答案没有标准答案,看 index.html 上的图):
 *   行框      文字层的行(textbook-index.ts 的 pageLines:字的上下边,不含拼音)
 *   能写的格  田字格的空格与描红(bookCells)、填空(blankCells)、表格里没字的格(下面 tableCells:画图指令里的横竖线段拼成网格)、
 *             小空方框(打勾的 □:描边的近似正方形,6–30pt,里面没字,没填颜色,左右贴着字)
 * 分数:
 *   行   召回(模型的行按字对上标准的行,字的重合 ≥ 0.6)、对上的那些 IoU 均值、四条边最大偏差的中位数(千分点)
 *   格   召回(模型的 write/tick/draw 区的中心落在标准格里,格四边各放宽 25%)、对上的 IoU 均值、中心偏差中位数;模型多标的(对不上任何标准格的)另数,
 *        标准里没有横线、圈画区,多标的不一定错,看图
 *
 * 用法:node scripts/probe-book-zones.mjs --out <目录> [--vault <vault>] [--page 数学:78 …] [--only qwen,codex] [--dry] [--redo]
 *   --page <册名里的一段>:<PDF 页>,可以多个;不给用下面 PAGES
 *   --dry 只出图和标准答案(不花钱);已经跑过的(目录里有 result.json)跳过,--redo 重跑
 *   出:<out>/<册>-<页>/page.png、truth.json、truth.png、<跑法>/{result.json,raw.txt,overlay.png,…}、<out>/index.html、summary.json
 * 花钱:qwen 走百炼按量(一页几分钱到几毛),codex 走 ChatGPT 订阅的额度。图和结果里有课本,out 放仓库外面。
 * 要 pdftoppm(poppler)出页图、magick 画框。
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const { readPdfPages, loadPdfjs } = await import(join(repo, 'src', 'memory', 'textbook-pdf.ts'));
const { pageLines, bookCells, blankCells } = await import(join(repo, 'src', 'memory', 'textbook-index.ts'));
const { lookAt } = await import(join(repo, 'src', 'media', 'vision.ts'));

/** 缺省比的几页(2026-11-25 挑的,人教数学二上、人教统编语文二上、广东版科学二上) */
const PAGES = ['数学:78', '数学:13', '数学:44', '语文:22', '语文:31', '科学:20'];
const RUNNERS = ['qwen', 'codex'];
const QWEN_MODEL = 'qwen3.8-max';
const AGENT_TIMEOUT_MS = 20 * 60_000;

// ——— 参数 ———
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const opts = (k) => argv.flatMap((a, i) => (a === k && argv[i + 1] ? [argv[i + 1]] : []));
const out = opt('--out');
if (!out) { console.error('用法:node scripts/probe-book-zones.mjs --out <目录> [--vault <vault>] [--page 数学:78 …] [--only qwen,codex] [--dry] [--redo]'); process.exit(2); }
const dry = argv.includes('--dry');
const redo = argv.includes('--redo');
const only = (opt('--only') ?? RUNNERS.join(',')).split(',').filter(Boolean);
for (const r of only) if (!RUNNERS.includes(r)) { console.error(`不认的跑法 ${r}(${RUNNERS.join('、')})`); process.exit(2); }
const pageArgs = opts('--page').length ? opts('--page') : PAGES;

/** vault:--vault,不然照 ~/.config/cotutor/config.json 的 workspace 里 cotutor.json 的 paths.vault */
function vaultDir() {
  const v = opt('--vault');
  if (v) return v;
  try {
    const ws = JSON.parse(readFileSync(join(homedir(), '.config', 'cotutor', 'config.json'), 'utf8')).workspace;
    const p = JSON.parse(readFileSync(join(ws, 'cotutor.json'), 'utf8')).paths?.vault;
    if (p) return p.replace(/^~(?=\/)/, homedir());
  } catch { /* 下面报 */ }
  console.error('找不到 vault,用 --vault 指'); process.exit(2);
}
const books = join(vaultDir(), '教材');

/** codex:PATH 里的,没有就用 VS Code 扩展里带的(最新的那个) */
function codexBin() {
  const b = opt('--codex-bin');
  if (b) return b;
  try { return execFileSync('which', ['codex']).toString().trim(); } catch { /* 往下找 */ }
  const ext = join(homedir(), '.vscode', 'extensions');
  const dirs = existsSync(ext) ? readdirSync(ext).filter((d) => d.startsWith('openai.chatgpt-')).map((d) => join(ext, d)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs) : [];
  for (const d of dirs) for (const arch of ['macos-aarch64', 'macos-x86_64', 'linux-x86_64']) { const f = join(d, 'bin', arch, 'codex'); if (existsSync(f)) return f; }
  return null;
}

// ——— 标准答案:表格(画图指令里的横竖线段拼成网格) ———

const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const at = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** 一页上实线的横线、竖线段(页面坐标,左上角起);细长的填充矩形也当线(有的表格线是填出来的) */
function pageRules(ops, OPS, view) {
  let g = { ctm: [...view], dash: false, fill: '#000000' };
  const stack = [];
  const H = [], V = [], quads = [], painted = [];
  const strokes = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const fills = new Set([OPS.fill, OPS.eoFill]);
  const seg = (a, b) => {
    if (Math.abs(a[1] - b[1]) < 0.6 && Math.abs(a[0] - b[0]) > 6) H.push({ y: (a[1] + b[1]) / 2, a: Math.min(a[0], b[0]), b: Math.max(a[0], b[0]) });
    else if (Math.abs(a[0] - b[0]) < 0.6 && Math.abs(a[1] - b[1]) > 6) V.push({ x: (a[0] + b[0]) / 2, a: Math.min(a[1], b[1]), b: Math.max(a[1], b[1]) });
  };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i], a = ops.argsArray[i] ?? [];
    if (f === OPS.save) stack.push({ ...g });
    else if (f === OPS.restore) g = stack.pop() ?? g;
    else if (f === OPS.transform) g = { ...g, ctm: mul(g.ctm, a) };
    else if (f === OPS.paintFormXObjectBegin) { stack.push({ ...g }); const m = a[0]; if (m && m.length === 6) g = { ...g, ctm: mul(g.ctm, Array.from(m)) }; }
    else if (f === OPS.paintFormXObjectEnd) g = stack.pop() ?? g;
    else if (f === OPS.setDash) g = { ...g, dash: Array.isArray(a[0]) && a[0].length > 0 };
    else if (f === OPS.setFillRGBColor) g = { ...g, fill: typeof a[0] === 'string' ? a[0] : `#${Array.from(a).slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('')}` };
    else if (f === OPS.constructPath) {
      const [op, data] = a;
      const d = Array.isArray(data) ? data[0] : undefined;
      if (!d) continue;
      const isStroke = strokes.has(op), isFill = fills.has(op);
      if (!isStroke && !isFill) continue;
      const pts = [];
      let start = null, prev = null, code = '';
      for (let j = 0; j < d.length;) {
        const c = d[j++];
        code += c;
        if (c === 0) { prev = start = at(g.ctm, d[j], d[j + 1]); j += 2; pts.push(prev); }
        else if (c === 1) { const p = at(g.ctm, d[j], d[j + 1]); j += 2; if (isStroke && !g.dash && prev) seg(prev, p); prev = p; pts.push(p); }
        else if (c === 2) { prev = at(g.ctm, d[j + 4], d[j + 5]); j += 6; pts.push(prev); }
        else if (c === 3) { prev = at(g.ctm, d[j + 2], d[j + 3]); j += 4; pts.push(prev); }
        else if (c === 4) { if (isStroke && !g.dash && prev && start) seg(prev, start); prev = start; }
      }
      if (isStroke && !g.dash && /^0111(1|4|14)?$/.test(code)) {
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        quads.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
      }
      if ((isFill || op === OPS.fillStroke || op === OPS.closeFillStroke) && pts.length >= 3 && !/^#f[0-9a-f]f[0-9a-f]f[0-9a-f]$/i.test(g.fill)) {
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        painted.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
      }
      if (isFill && pts.length >= 4) {
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
        if (y2 - y1 < 1.6 && x2 - x1 > 6) H.push({ y: (y1 + y2) / 2, a: x1, b: x2 });
        else if (x2 - x1 < 1.6 && y2 - y1 > 6) V.push({ x: (x1 + x2) / 2, a: y1, b: y2 });
      }
    }
  }
  // 填了颜色的方块(七巧板)是图,不是让孩子写的框
  return { H: mergeRules(H, 'y'), V: mergeRules(V, 'x'), quads: quads.filter((q) => !painted.some((b) => iou(q, b) > 0.8)) };
}

/** 同一条线上挨着、叠着的段并成一条 */
function mergeRules(rs, k) {
  const s = [...rs].sort((p, q) => p[k] - q[k] || p.a - q.a);
  const out = [];
  for (const r of s) {
    const m = out.find((o) => Math.abs(o[k] - r[k]) < 0.8 && r.a <= o.b + 2 && r.b >= o.a - 2);
    if (m) { m.a = Math.min(m.a, r.a); m.b = Math.max(m.b, r.b); } else out.push({ ...r });
  }
  return out;
}

const clusterVals = (vs) => { const s = [...vs].sort((a, b) => a - b), out = []; for (const v of s) if (!out.length || v - out[out.length - 1] > 1.5) out.push(v); return out; };

/** 横竖线互相交着的一团(三条横线以上、三条竖线以上,或两条横线、四条竖线以上的一排)是表格;四边都有线的才算一格,合并的格不认 */
function tableCells(H, V, avoid) {
  const cross = (h, v) => v.x >= h.a - 2 && v.x <= h.b + 2 && h.y >= v.a - 2 && h.y <= v.b + 2;
  const seen = new Set(), tables = [];
  for (let i = 0; i < H.length; i++) {
    if (seen.has(`h${i}`)) continue;
    const hs = new Set(), vs = new Set(), todo = [['h', i]];
    seen.add(`h${i}`);
    while (todo.length) {
      const [t, k] = todo.pop();
      if (t === 'h') { hs.add(k); V.forEach((v, j) => { if (!seen.has(`v${j}`) && cross(H[k], v)) { seen.add(`v${j}`); todo.push(['v', j]); } }); }
      else { vs.add(k); H.forEach((h, j) => { if (!seen.has(`h${j}`) && cross(h, V[k])) { seen.add(`h${j}`); todo.push(['h', j]); } }); }
    }
    const hh = [...hs].map((k) => H[k]), vv = [...vs].map((k) => V[k]);
    if (!((hh.length >= 3 && vv.length >= 3) || (hh.length >= 2 && vv.length >= 4))) continue;
    const ys = clusterVals(hh.map((h) => h.y)), xs = clusterVals(vv.map((v) => v.x));
    const cells = [];
    for (let r = 0; r + 1 < ys.length; r++) for (let c = 0; c + 1 < xs.length; c++) {
      const [x1, x2, y1, y2] = [xs[c], xs[c + 1], ys[r], ys[r + 1]];
      if (x2 - x1 < 8 || y2 - y1 < 8) continue;
      const hEdge = (y) => hh.some((h) => Math.abs(h.y - y) < 1.5 && h.a <= x1 + 2 && h.b >= x2 - 2);
      const vEdge = (x) => vv.some((v) => Math.abs(v.x - x) < 1.5 && v.a <= y1 + 2 && v.b >= y2 - 2);
      if (!(hEdge(y1) && hEdge(y2) && vEdge(x1) && vEdge(x2))) continue;
      if (avoid.some((b) => iou([x1, y1, x2, y2], b) > 0.4)) continue;
      cells.push({ r, c, box: [x1, y1, x2, y2] });
    }
    if (cells.length >= 2) tables.push(cells);
  }
  return tables;
}

// ——— 几何与对分 ———

function iou(a, b) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h, u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
  return u > 0 ? i / u : 0;
}
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (n) => (n === null ? null : Math.round(n * 10) / 10);
const r2 = (n) => (n === null ? null : Math.round(n * 100) / 100);
const bare = (s) => String(s ?? '').replace(/[\s\p{P}\p{S}]/gu, '');
/** 两段字的重合(字的多重集合的 Dice) */
function textSim(a, b) {
  const A = Array.from(bare(a)), B = Array.from(bare(b));
  if (!A.length || !B.length) return 0;
  const m = new Map();
  for (const c of A) m.set(c, (m.get(c) ?? 0) + 1);
  let hit = 0;
  for (const c of B) { const n = m.get(c) ?? 0; if (n > 0) { hit++; m.set(c, n - 1); } }
  return (2 * hit) / (A.length + B.length);
}
const center = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const grow = (b, k) => { const dx = (b[2] - b[0]) * k, dy = (b[3] - b[1]) * k; return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy]; };
const inside = ([x, y], b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/** 模型给的框:四个数、换成左上到右下、夹进 0–1000;超过 1000 的当成给了像素(换回千分比,记一笔) */
function normBox(b, W, H, flags) {
  if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => Number.isFinite(Number(v)))) return null;
  let [x1, y1, x2, y2] = b.map(Number);
  if (Math.max(x1, y1, x2, y2) > 1000.5) { flags.add('给的是像素'); x1 = (x1 / W) * 1000; x2 = (x2 / W) * 1000; y1 = (y1 / H) * 1000; y2 = (y2 / H) * 1000; }
  else if (Math.max(x1, y1, x2, y2) <= 1.0001 && Math.max(x1, y1, x2, y2) > 0) { flags.add('给的是 0–1'); [x1, y1, x2, y2] = [x1, y1, x2, y2].map((v) => v * 1000); }
  const c = (v) => Math.max(0, Math.min(1000, v));
  return [c(Math.min(x1, x2)), c(Math.min(y1, y2)), c(Math.max(x1, x2)), c(Math.max(y1, y2))];
}

const WRITE_KINDS = new Set(['write', 'tick', 'draw']);
/** 模型的 JSON 摊平:行、块(带深度)、要动手的地方 */
function flatten(res, W, H) {
  const flags = new Set();
  const lines = (Array.isArray(res?.lines) ? res.lines : []).map((l) => ({ text: String(l?.text ?? ''), box: normBox(l?.box, W, H, flags) })).filter((l) => l.box);
  const zones = [], regions = [];
  const walk = (zs, depth) => {
    for (const z of Array.isArray(zs) ? zs : []) {
      const box = normBox(z?.box, W, H, flags);
      if (box) zones.push({ kind: String(z?.kind ?? ''), label: String(z?.label ?? ''), box, depth });
      for (const r of Array.isArray(z?.regions) ? z.regions : []) {
        const rb = normBox(r?.box, W, H, flags);
        if (rb) regions.push({ kind: String(r?.kind ?? ''), label: String(r?.label ?? ''), box: rb, answer: r?.answer ?? null });
      }
      walk(z?.children, depth + 1);
    }
  };
  walk(res?.zones, 0);
  return { lines, zones, regions, flags: [...flags] };
}

function score(truth, got) {
  // 行:字对得上(重合 ≥ 0.6)的配对里,框最重合的先配(同一页上好几行都是「1」「×7=」,只按字配会配到别处那一行);一条只用一次
  const pairs = [];
  truth.lines.forEach((t, ti) => got.lines.forEach((g, gi) => { const s = textSim(t.text, g.text); if (s >= 0.6) pairs.push({ ti, gi, s, o: iou(t.box, g.box) }); }));
  pairs.sort((a, b) => b.o - a.o || b.s - a.s);
  const usedT = new Set(), used = new Set(), lineHits = [];
  for (const p of pairs) {
    if (usedT.has(p.ti) || used.has(p.gi)) continue;
    usedT.add(p.ti); used.add(p.gi);
    const t = truth.lines[p.ti].box, g = got.lines[p.gi].box;
    lineHits.push({ iou: p.o, edge: Math.max(...t.map((v, k) => Math.abs(v - g[k]))) });
  }
  // 格:模型的 write/tick/draw 区中心落进(放宽 25% 的)标准格
  const writes = got.regions.filter((r) => WRITE_KINDS.has(r.kind));
  const usedW = new Set(), cellHits = [];
  for (const t of truth.cells) {
    const i = writes.findIndex((w, k) => !usedW.has(k) && inside(center(w.box), grow(t.box, 0.25)));
    if (i < 0) continue;
    usedW.add(i);
    const [cx, cy] = center(writes[i].box), [tx, ty] = center(t.box);
    cellHits.push({ iou: iou(t.box, writes[i].box), off: Math.hypot(cx - tx, cy - ty) });
  }
  return {
    lines: { truth: truth.lines.length, got: got.lines.length, hit: lineHits.length, iou: r2(mean(lineHits.map((h) => h.iou))), edge: r1(median(lineHits.map((h) => h.edge))) },
    cells: { truth: truth.cells.length, got: writes.length, hit: cellHits.length, iou: r2(mean(cellHits.map((h) => h.iou))), off: r1(median(cellHits.map((h) => h.off))), extra: writes.length - usedW.size },
    zones: { n: got.zones.length, depth: got.zones.length ? Math.max(...got.zones.map((z) => z.depth)) + 1 : 0, tables: got.zones.filter((z) => z.kind === 'table').length },
    flags: got.flags,
  };
}

// ——— 画框 ———

/** 千分比的框画回页图;layers: [{boxes, color, width}] */
function overlay(png, dest, W, H, layers) {
  const px = (b) => [b[0] * W / 1000, b[1] * H / 1000, b[2] * W / 1000, b[3] * H / 1000].map((v) => Math.round(v)).join(',');
  const draw = layers.flatMap((l) => l.boxes.flatMap((b) => ['-stroke', l.color, '-strokewidth', String(l.width), '-fill', 'none', '-draw', `rectangle ${px(b)}`]));
  execFileSync('magick', [png, ...draw, '-resize', '1000x', dest]);
}
const ZONE_COLORS = ['#d62728', '#9467bd', '#e377c2', '#8c564b'];
function overlayGot(png, dest, W, H, got) {
  overlay(png, dest, W, H, [
    { boxes: got.lines.map((l) => l.box), color: '#1f77b4', width: 2 },
    ...[0, 1, 2, 3].map((d) => ({ boxes: got.zones.filter((z) => Math.min(z.depth, 3) === d).map((z) => z.box), color: ZONE_COLORS[d], width: Math.max(2, 7 - 2 * d) })),
    { boxes: got.regions.map((r) => r.box), color: '#ff7f0e', width: 4 },
  ]);
}

// ——— 提示词 ———

function prompt(subject, W, H, agent) {
  return `这是一页小学二年级${subject}课本(PDF 渲染的图,${W}×${H} 像素)。孩子在 iPad 上看这一页,AI 老师要指着页上的东西讲,孩子要在能写的地方用笔写。请把这一页标出来,给一份 JSON:

{
  "lines": [{"text": "印着的一行字,照原样", "box": [左, 上, 右, 下]}],
  "zones": [{"kind": "…", "label": "…", "box": [左, 上, 右, 下], "say": "…", "regions": […], "children": […]}]
}

坐标:整页的千分比,x 按图宽、y 按图高(都是 0–1000),框写 [左, 上, 右, 下]。框要贴着东西,不要估个大概。

lines:页上印的每一行字(同一条基线上连着的字),页码也列。字头上的拼音不算字,不进这一行的框,也不单列。图里的字(插图上的标签)也列。

zones:页上的块,能嵌套(大块的 children 里放它里面的小块):
- kind:title 课题、标题;column 栏目(做一做、练一练、思考与练习、课后题……);example 例题;problem 一道题;sub 题里的小题;para 课文的自然段;table 表格;figure 插图;other 别的
- label:老师会怎么叫它,如「例 1」「练一练第 3 题」「第 2 题第(1)小题」「第 3 自然段」「拼图的表格」
- say:点读这一块时念什么(题面、表头);没得念的不写
- regions:这一块里孩子要动手的地方,一处一个 {"kind": "…", "label": "…", "box": […], "answer": "答案,有就写"}
  - kind:write 填字、填数、写算式(括号、方框、横线、表格的空格、田字格);circle 圈;tick 打勾;link 连线;draw 画;underline 画线;read 朗读
  - 表格里每个要孩子填的空格各算一个 write;一排括号每个括号各算一个
  - label 给老师看,如「表格第 2 行第 3 格」「二七（）的括号」
- children:这一块里面的小块,同样的写法

没有的项写空数组。${agent
    ? `

图是当前目录的 page.png。把这份 JSON 写进当前目录的 result.json(只写这一份 JSON,不要别的字)。可以写脚本量图(python3 和 Pillow 都装着),脚本放当前目录;不要联网,不要动当前目录以外的文件。`
    : '\n\n只回这一份 JSON,不要别的字。'}`;
}

/** 从一段回复里抠出 JSON(去掉围栏,取第一个 { 到最后一个 }) */
function parseJson(text) {
  const s = String(text ?? '').replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

// ——— 跑法 ———

function run(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => p.kill('SIGTERM'), timeoutMs);
    p.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: Date.now() - t0 }); });
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, signal: null, stdout, stderr: String(e), ms: Date.now() - t0 }); });
  });
}

/** 一种跑法标一页:回 { ok, res, ms, error?, extra? } 并把原样的回复存进 dir */
async function annotate(runner, page, dir) {
  mkdirSync(dir, { recursive: true });
  const png = join(page.dir, 'page.png');
  if (runner === 'qwen') {
    const r = await lookAt({ image: { data: readFileSync(png), mime: 'image/png' }, prompt: prompt(page.subject, page.W, page.H, false), model: QWEN_MODEL, timeoutMs: AGENT_TIMEOUT_MS });
    writeFileSync(join(dir, 'raw.txt'), r.ok ? r.text : `没成 ${r.error}`);
    const res = r.ok ? parseJson(r.text) : null;
    return { ok: !!res, res, ms: r.ms, model: QWEN_MODEL, ...(res ? {} : { error: r.ok ? '回的不是 JSON' : r.error }) };
  }
  writeFileSync(join(dir, 'page.png'), readFileSync(png));
  const p = prompt(page.subject, page.W, page.H, true);
  const bin = codexBin();
  if (!bin) return { ok: false, ms: 0, error: '找不到 codex' };
  const model = opt('--codex-model') ?? 'config.toml 里的';
  const r = await run(bin, ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'workspace-write', '-C', dir, '-i', join(dir, 'page.png'), '-o', join(dir, 'last.txt'), ...(opt('--codex-model') ? ['-m', opt('--codex-model')] : []), p], dir, AGENT_TIMEOUT_MS);
  writeFileSync(join(dir, 'raw.txt'), `exit ${r.code}${r.signal ? ` ${r.signal}` : ''}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`);
  let res = null;
  try { res = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')); } catch { res = parseJson(existsSync(join(dir, 'last.txt')) ? readFileSync(join(dir, 'last.txt'), 'utf8') : r.stdout); }
  const extra = readdirSync(dir).filter((f) => !['page.png', 'result.json', 'raw.txt', 'last.txt', 'overlay.png', 'score.json'].includes(f));
  return { ok: !!res, res, ms: r.ms, model, extra, ...(res ? {} : { error: r.signal ? `超时(${r.signal})` : `没写出 JSON(exit ${r.code})` }) };
}

// ——— 准备页:页图、标准答案 ———

async function preparePages() {
  const files = readdirSync(books).filter((f) => f.toLowerCase().endsWith('.pdf'));
  const want = pageArgs.map((s) => { const m = /^(.+):(\d+)$/.exec(s); if (!m) { console.error(`--page 写成 <册名里的一段>:<PDF 页>:${s}`); process.exit(2); } return { key: m[1], n: Number(m[2]) }; });
  const lib = await loadPdfjs();
  const pages = [];
  for (const key of [...new Set(want.map((w) => w.key))]) {
    const file = files.find((f) => f.includes(key));
    if (!file) { console.error(`教材/ 里没有名字带「${key}」的 PDF`); process.exit(2); }
    const data = readFileSync(join(books, file));
    const subject = ['语文', '数学', '科学', '英语'].find((s) => file.includes(s)) ?? key;
    const ns = want.filter((w) => w.key === key).map((w) => w.n);
    const raw = await readPdfPages(new Uint8Array(data), { cells: subject !== '科学' });
    const task = lib.getDocument({ data: new Uint8Array(data), disableFontFace: true, verbosity: 0 });
    const doc = await task.promise;
    for (const n of ns) {
      const rp = raw.find((p) => p.n === n);
      if (!rp) { console.error(`${file} 没有第 ${n} 页`); process.exit(2); }
      const dir = join(out, `${subject}-${n}`);
      mkdirSync(dir, { recursive: true });
      const png = join(dir, 'page.png');
      if (!existsSync(png)) execFileSync('pdftoppm', ['-png', '-r', '200', '-cropbox', '-f', String(n), '-l', String(n), '-singlefile', join(books, file), join(dir, 'page')]);
      const [W, H] = execFileSync('magick', ['identify', '-format', '%w %h', png]).toString().split(' ').map(Number);
      const pm = (b) => [b[0] / rp.w * 1000, b[1] / rp.h * 1000, b[2] / rp.w * 1000, b[3] / rp.h * 1000].map((v) => Math.round(v * 10) / 10);
      // 行
      const lines = pageLines(rp).map((l) => ({ text: l.text, box: pm([l.x1, l.y1, l.x2, l.y2]) }));
      // 田字格的空格、描红,填空
      const tian = bookCells(rp.cells ?? []).filter((c) => c.kind !== 'model');
      const blanks = blankCells(rp);
      // 表格里没字的格
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const { H: hr, V: vr, quads } = pageRules(await page.getOperatorList({ annotationMode: 0 }), lib.OPS, vp.transform);
      const avoid = (rp.cells ?? []).map((c) => [c.x1, c.y1, c.x2, c.y2]);
      const textIn = (b) => rp.items.filter((it) => inside([it.x + it.w / 2, it.y - it.z * 0.35], b)).map((it) => it.s).join('');
      const onPage = (b) => b[0] >= -1 && b[1] >= -1 && b[2] <= rp.w + 1 && b[3] <= rp.h + 1;
      const tables = tableCells(hr, vr, avoid).filter((cs) => cs.every((c) => onPage(c.box))).map((cells) => cells.map((c) => ({ ...c, text: textIn(c.box) })));
      // 小空方框(打勾的 □、算式里的空):6–30pt、近似方的、里面没字;和田字格、填空、表格的格重了的不算
      const known = [...avoid, ...blanks.map((c) => [c.x1, c.y1, c.x2, c.y2]), ...tables.flat().map((c) => c.box)];
      const ticks = [];
      for (const q of quads) {
        const w = q[2] - q[0], h = q[3] - q[1];
        if (w < 6 || w > 30 || h < 6 || h > 30 || Math.abs(w - h) > 0.35 * Math.max(w, h) || !onPage(q) || bare(textIn(q))) continue;
        // 旁边贴着字(□能、□×7=):左右一个框宽以内、和框同一高度有字;一排牙刷头旁边没有
        const beside = rp.items.some((it) => { const cy = it.y - it.z * 0.35; return cy > q[1] && cy < q[3] && ((it.x >= q[2] - 1 && it.x <= q[2] + w) || (it.x + it.w <= q[0] + 1 && it.x + it.w >= q[0] - w)); });
        if (!beside) continue;
        if ([...known, ...ticks].some((b) => iou(q, b) > 0.3)) continue;
        ticks.push(q);
      }
      page.cleanup();
      const cells = [
        ...tian.map((c) => ({ kind: c.kind === 'trace' ? '描红' : '田字格', box: pm([c.x1, c.y1, c.x2, c.y2]) })),
        ...blanks.map((c) => ({ kind: '填空', box: pm([c.x1, c.y1, c.x2, c.y2]) })),
        ...tables.flat().filter((c) => !bare(c.text)).map((c) => ({ kind: '表格空格', box: pm(c.box) })),
        ...ticks.map((b) => ({ kind: '小方框', box: pm(b) })),
      ];
      const truth = { book: file, n, printed: null, W, H, lines, cells, tables: tables.map((t) => t.map((c) => ({ r: c.r, c: c.c, text: c.text, box: pm(c.box) }))) };
      writeFileSync(join(dir, 'truth.json'), JSON.stringify(truth, null, 1));
      overlay(png, join(dir, 'truth.png'), W, H, [
        { boxes: lines.map((l) => l.box), color: '#1f77b4', width: 2 },
        { boxes: truth.tables.flat().map((c) => c.box), color: '#7f7f7f', width: 2 },
        { boxes: cells.map((c) => c.box), color: '#2ca02c', width: 5 },
      ]);
      pages.push({ id: `${subject}-${n}`, subject, n, dir, W, H, truth });
      console.log(`${subject} 第 ${n} 页:${lines.length} 行,能写的格 ${cells.length}(田字格 ${tian.length}、填空 ${blanks.length}、表格空格 ${cells.length - tian.length - blanks.length - ticks.length}、小方框 ${ticks.length},表 ${tables.length} 张)`);
    }
    await task.destroy();
  }
  return pages;
}

// ——— 报告 ———

function report(pages, rows) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
  const cell = (r) => {
    if (!r) return '<td>没跑</td>';
    if (!r.ok) return `<td class=bad>${esc(r.error)}<br>${(r.ms / 1000).toFixed(0)} 秒</td>`;
    const s = r.score;
    return `<td><b>${(r.ms / 1000).toFixed(0)} 秒</b><br>行 ${s.lines.hit}/${s.lines.truth}(${pct(s.lines.hit, s.lines.truth)}),IoU ${s.lines.iou ?? '—'},偏 ${s.lines.edge ?? '—'}‰<br>格 ${s.cells.hit}/${s.cells.truth}(${pct(s.cells.hit, s.cells.truth)}),IoU ${s.cells.iou ?? '—'},中心偏 ${s.cells.off ?? '—'}‰,多标 ${s.cells.extra}<br>块 ${s.zones.n},${s.zones.depth} 层,表 ${s.zones.tables}${s.flags.length ? `<br><i>${esc(s.flags.join('、'))}</i>` : ''}${r.extra?.length ? `<br><small>留下:${esc(r.extra.join(' '))}</small>` : ''}</td>`;
  };
  const sum = (runner) => {
    const rs = rows.filter((r) => r.runner === runner && r.ok);
    const all = rows.filter((r) => r.runner === runner);
    const add = (f) => rs.reduce((a, r) => a + f(r.score), 0);
    const lt = add((s) => s.lines.truth), lh = add((s) => s.lines.hit), ct = add((s) => s.cells.truth), ch = add((s) => s.cells.hit);
    return { runner, ok: `${rs.length}/${all.length}`, sec: r1(mean(all.map((r) => r.ms / 1000))), lines: pct(lh, lt), lineIou: r2(mean(rs.map((r) => r.score.lines.iou).filter((v) => v !== null))), lineEdge: r1(median(rs.map((r) => r.score.lines.edge).filter((v) => v !== null))), cells: pct(ch, ct), cellIou: r2(mean(rs.map((r) => r.score.cells.iou).filter((v) => v !== null))), cellOff: r1(median(rs.map((r) => r.score.cells.off).filter((v) => v !== null))), extra: add((s) => s.cells.extra) };
  };
  const sums = only.map(sum);
  const html = `<!doctype html><meta charset=utf-8><title>课本分块对比</title>
<style>body{font:14px/1.5 -apple-system,"PingFang SC",sans-serif;margin:16px;color:#222;background:#fff}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px;vertical-align:top}img{width:420px;display:block}.bad{color:#b00}small{color:#666}</style>
<h1>课本分块对比</h1>
<p>蓝 = 行框;红紫粉棕 = 块(外到里);橙 = 要动手的地方。标准答案图:蓝 = 文字层的行,灰 = 表格的格,绿 = 能写的格。偏 = 行框四条边最大偏差的中位数,千分点。</p>
<table><tr><th>跑法</th><th>成了</th><th>平均秒</th><th>行召回</th><th>行 IoU</th><th>行偏‰</th><th>格召回</th><th>格 IoU</th><th>格中心偏‰</th><th>多标</th></tr>
${sums.map((s) => `<tr><td>${s.runner}</td><td>${s.ok}</td><td>${s.sec ?? '—'}</td><td>${s.lines}</td><td>${s.lineIou ?? '—'}</td><td>${s.lineEdge ?? '—'}</td><td>${s.cells}</td><td>${s.cellIou ?? '—'}</td><td>${s.cellOff ?? '—'}</td><td>${s.extra}</td></tr>`).join('\n')}</table>
<table style="margin-top:16px"><tr><th>页</th><th>标准答案</th>${only.map((r) => `<th>${r}</th>`).join('')}</tr>
${pages.map((p) => `<tr><td>${p.id}<br>${p.truth.lines.length} 行<br>${p.truth.cells.length} 格</td><td><img src="${p.id}/truth.png"></td>${only.map((r) => { const row = rows.find((x) => x.page === p.id && x.runner === r); return row?.ok ? `<td><img src="${p.id}/${r}/overlay.png"></td>` : '<td></td>'; }).join('')}</tr>
<tr><td></td><td></td>${only.map((r) => cell(rows.find((x) => x.page === p.id && x.runner === r))).join('')}</tr>`).join('\n')}</table>`;
  writeFileSync(join(out, 'index.html'), html);
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ sums, rows: rows.map(({ res, ...r }) => r) }, null, 1));
  return sums;
}

// ——— 主流程 ———

mkdirSync(out, { recursive: true });
const pages = await preparePages();
const rows = [];
if (!dry) {
  await Promise.all(only.map(async (runner) => {
    for (const p of pages) {
      const dir = join(p.dir, runner);
      const done = join(dir, 'score.json');
      let row;
      if (!redo && existsSync(done)) {
        // 跑过的不重跑;分数照现在的规矩从 result.json 重算
        row = JSON.parse(readFileSync(done, 'utf8'));
        if (row.ok) { row.score = score(p.truth, flatten(JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')), p.W, p.H)); writeFileSync(done, JSON.stringify(row, null, 1)); }
      } else {
        console.log(`${runner} 开始 ${p.id}`);
        const a = await annotate(runner, p, dir);
        row = { page: p.id, runner, ok: a.ok, ms: a.ms, model: a.model, extra: a.extra, error: a.error };
        if (a.ok) {
          writeFileSync(join(dir, 'result.json'), JSON.stringify(a.res, null, 1));
          const got = flatten(a.res, p.W, p.H);
          row.score = score(p.truth, got);
          overlayGot(join(p.dir, 'page.png'), join(dir, 'overlay.png'), p.W, p.H, got);
        }
        writeFileSync(done, JSON.stringify(row, null, 1));
      }
      rows.push(row);
      console.log(`${runner} ${p.id}: ${row.ok ? `${(row.ms / 1000).toFixed(0)} 秒,行 ${row.score.lines.hit}/${row.score.lines.truth},格 ${row.score.cells.hit}/${row.score.cells.truth},多标 ${row.score.cells.extra}` : `没成 ${row.error}`}`);
    }
  }));
}
const sums = report(pages, rows);
if (!dry) console.table(sums);
console.log(`报告:${join(out, 'index.html')}`);

/*
 * 结论(2026-11-25;人教数学二上 PDF 第 13、44、78 页,人教统编语文二上第 22、31 页,广东版科学二上第 20 页;pdftoppm 200dpi,1449×2048):
 * - Codex(gpt-6.2-sol,reasoning high;每页都自己写 Python 量图):能写的格 131/131 全中,对上的 IoU 0.92、中心偏 0.3‰;
 *   行框四条边最大偏差的中位数 4‰;多标 4 处。一页 152–255 秒,平均 214。块分得细,嵌套 2–6 层(数学一页 40–60 块,每个算式一块)。
 * - qwen3.8-max 直接看图(不能跑脚本):能写的格 104/131(79%),对上的 IoU 0.58、中心偏 8‰;多标 30 处。
 *   语文第 22 页整页的坐标缩进了上半页(行框偏 293‰,格只中 3/27);别的 5 页格都中,但框松,数学第 78 页的填空越往下越往上偏。
 *   一页 243–376 秒,平均 311。块分得粗(7–14 块),嵌套 2–4 层。
 * - Qwen Code(qwen3.8-max,能写脚本)只跑了第 78 页:格 27/27、IoU 0.87,和 Codex 一样准,但一页 950 秒,不再比。
 * - 数学第 44 页两家的行都只对上 13/25:文字层把「□÷□=□」的 ÷、= 各算一行,模型写成一整行,是量法对不上,不是模型错。
 * - 两家都把页顶的社标和页底「仅供个人学习使用」当成了行。
 * 所以:框从 PDF 量,或者让能跑脚本的编程助手(Codex)量图;不要让模型直接估框。qwen 直接看图一页里可能整页坐标都错,而且看不出来。
 */
