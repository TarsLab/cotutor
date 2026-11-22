/**
 * 扫整本课本的田字格:描边的闭合四点正方形(20–70pt),里面有横竖两条虚线中线;格里的字按填充色分范字 / 描红,没字是空格。
 * 用:node docs/artifact/页上记号/核实/grids.mjs <课本.pdf> [页]
 * 实测(2026-11-22,语文二上):37 页 1056 格,边长都是 39pt;深灰 #2c2e35 262、红 #ff8281 262、空 532。整本 5.8 秒。
 */
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const [, , file, only] = process.argv;
const doc = await pdfjs.getDocument({ url: file, verbosity: 0 }).promise;
const O = pdfjs.OPS;
const mul = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
const pt = (m, x, y) => [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]];
const hex = (a) => typeof a[0] === 'string' ? a[0] : '#' + a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
async function scan(n) {
  const p = await doc.getPage(n), vp = p.getViewport({ scale: 1 });
  const ol = await p.getOperatorList({ annotationMode: 0 });
  let g = { ctm: vp.transform.slice(), stroke: '#000', fill: '#000', dash: [] }; const st = [];
  let tlm = [1,0,0,1,0,0], tm = tlm, fs = 0;
  const squares = [], dashed = [], texts = [], hlines = [];
  ol.fnArray.forEach((f, i) => {
    const a = ol.argsArray[i];
    if (f === O.save) st.push(structuredClone(g));
    else if (f === O.restore) g = st.pop() ?? g;
    else if (f === O.transform) g.ctm = mul(g.ctm, a);
    else if (f === O.paintFormXObjectBegin) { st.push(structuredClone(g)); if (a[0]) g.ctm = mul(g.ctm, Array.from(a[0])); }
    else if (f === O.paintFormXObjectEnd) g = st.pop() ?? g;
    else if (f === O.setStrokeRGBColor) g.stroke = hex(a);
    else if (f === O.setFillRGBColor) g.fill = hex(a);
    else if (f === O.setDash) g.dash = a[0] || [];
    else if (f === O.setFont) fs = a[1];
    else if (f === O.beginText) { tlm = [1,0,0,1,0,0]; tm = tlm; }
    else if (f === O.setTextMatrix) { tlm = Array.from(a[0]?.length === 6 ? a[0] : a); tm = tlm; }
    else if (f === O.moveText || f === O.setLeadingMoveText) { tlm = mul(tlm, [1,0,0,1,a[0],a[1]]); tm = tlm; }
    else if (f === O.showText) {
      const s = a[0].map((c) => (c && c.unicode) || '').join('');
      const m = mul(g.ctm, tm); const [x, y] = pt(m, 0, 0); const size = fs * Math.hypot(m[2], m[3]);
      if (s.trim()) texts.push({ s, x, y, size, fill: g.fill });
    }
    else if (f === O.constructPath) {
      const [op, [data]] = a; if (op !== O.stroke && op !== O.closeStroke) return;
      const pts = []; const cs = [];
      for (let j = 0; j < data.length;) { const c = data[j++]; cs.push(c); if (c === 0 || c === 1) { pts.push(pt(g.ctm, data[j], data[j+1])); j += 2; } else if (c === 2) j += 6; else if (c === 3) j += 4; }
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], w = b[2]-b[0], h = b[3]-b[1];
      const code = cs.join('');
      if ((code === '01114' || code === '0111' || code === '01111') && Math.abs(w-h) < 1.5 && w > 18 && w < 75) squares.push({ b, stroke: g.stroke });
      else if (code === '01' && g.dash?.length) dashed.push({ b, stroke: g.stroke });
      else if (code === '01' && h < 0.5 && w > 30) hlines.push({ b, stroke: g.stroke });
    }
  });
  const cells = squares.filter((s) => {
    const [x1, y1, x2, y2] = s.b, cx = (x1+x2)/2, cy = (y1+y2)/2;
    const v = dashed.some((d) => Math.abs(d.b[0]-cx) < 1.5 && d.b[2]-d.b[0] < 0.5 && d.b[1] < y1+3 && d.b[3] > y2-3);
    const hz = dashed.some((d) => Math.abs(d.b[1]-cy) < 1.5 && d.b[3]-d.b[1] < 0.5 && d.b[0] < x1+3 && d.b[2] > x2-3);
    return v && hz;
  }).map((s) => {
    const [x1, y1, x2, y2] = s.b;
    const t = texts.find((t) => { const cx = t.x + t.size/2, cy = t.y - t.size*0.4; return [...t.s].length === 1 && cx > x1 && cx < x2 && cy > y1 && cy < y2; });
    return { b: s.b.map((v) => +v.toFixed(1)), ch: t?.s ?? '', fill: t?.fill ?? '', size: +(x2-x1).toFixed(1), stroke: s.stroke };
  });
  return { cells, squares: squares.length, hlines };
}
const pages = only ? [Number(only)] : Array.from({ length: doc.numPages }, (_, i) => i + 1);
let total = 0; const colors = {}, sizes = {};
for (const n of pages) {
  const { cells, squares } = await scan(n);
  if (!cells.length && !squares) continue;
  total += cells.length;
  for (const c of cells) { const k = c.ch ? c.fill : '空'; colors[k] = (colors[k] || 0) + 1; sizes[Math.round(c.size)] = (sizes[Math.round(c.size)] || 0) + 1; }
  const row = cells.map((c) => c.ch ? (c.fill === '#ff8281' ? `(${c.ch})` : c.ch) : '□').join('');
  console.log(`p${n} 正方形${squares} 田字格${cells.length} ${row}`);
}
console.log('合计', total, '格里', colors, '边长', sizes);
