/**
 * 扫课本里的填空:矢量小方框(去重、去掉连成表格的)是不是空的、左右挨不挨着运算符;文字层里的空括号;横线;四线格。
 * 用:node docs/artifact/页上记号/核实/blanks.mjs <课本.pdf> [dump.json]  给了 dump 就把每页认出的框写进去(画叠图用)
 * 实测(2026-11-22,数学二上):空方框 805,挨着运算符 286(样页上全是算式里的空),表格 166,分不清 353;空括号 240;四线格 0。
 */
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const [, , file, dumpTo] = process.argv;
const doc = await pdfjs.getDocument({ url: file, verbosity: 0 }).promise;
const O = pdfjs.OPS;
const mul = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
const pt = (m, x, y) => [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]];
const DUMP = {}; const R = { box: 0, boxEmpty: 0, boxMath: 0, line: 0, lineAfterText: 0, fourLine: 0 }; const fourPages = new Set(); const odd = [];
for (let n = 1; n <= doc.numPages; n++) {
  const p = await doc.getPage(n), vp = p.getViewport({ scale: 1 });
  const ol = await p.getOperatorList({ annotationMode: 0 });
  let g = { ctm: vp.transform.slice() }; const st = []; const boxes = [], lines = [];
  ol.fnArray.forEach((f, i) => {
    const a = ol.argsArray[i];
    if (f === O.save) st.push(structuredClone(g)); else if (f === O.restore) g = st.pop() ?? g;
    else if (f === O.transform) g.ctm = mul(g.ctm, a);
    else if (f === O.paintFormXObjectBegin) { st.push(structuredClone(g)); if (a[0]) g.ctm = mul(g.ctm, Array.from(a[0])); }
    else if (f === O.paintFormXObjectEnd) g = st.pop() ?? g;
    else if (f === O.constructPath) {
      const [op, [data]] = a; if (op !== O.stroke && op !== O.closeStroke) return;
      const pts = []; const cs = [];
      for (let j = 0; j < data.length;) { const c = data[j++]; cs.push(c); if (c === 0 || c === 1) { pts.push(pt(g.ctm, data[j], data[j+1])); j += 2; } else if (c === 2) j += 6; else if (c === 3) j += 4; }
      const code = cs.join(''); const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], w = b[2]-b[0], h = b[3]-b[1];
      if (/^0111(1|4|14)?$/.test(code) && h > 10 && h < 30 && w > 10 && w < 60) boxes.push(b);
      else if (code === '01' && h < 0.3 && w > 20) lines.push(b);
    }
  });
  const tc = await p.getTextContent();
  const items = tc.items.filter((t) => t.str.trim()).map((t) => { const [x, y] = pt(vp.transform, t.transform[4], t.transform[5]); return { s: t.str, x, y, x2: x + t.width, h: t.height }; });
  // 去重:同一个框描两遍
  const uniq = []; for (const b of boxes) if (!uniq.some((u) => u.every((v, k) => Math.abs(v - b[k]) < 1.5))) uniq.push(b);
  // 表格:和别的框共用一条边的(上下左右挨着)算表格的格
  const touch = (a, b) => (Math.abs(a[2] - b[0]) < 1.5 || Math.abs(a[0] - b[2]) < 1.5) && Math.abs(a[1] - b[1]) < 1.5 || (Math.abs(a[3] - b[1]) < 1.5 || Math.abs(a[1] - b[3]) < 1.5) && Math.abs(a[0] - b[0]) < 1.5;
  for (const b of uniq) {
    R.box++;
    const inside = items.some((t) => t.x < b[2] - 2 && t.x2 > b[0] + 2 && t.y > b[1] + 2 && t.y - t.h * 0.7 < b[3] - 2);
    if (inside) continue; R.boxEmpty++;
    if (uniq.some((o) => o !== b && touch(b, o))) { (DUMP[n] ??= []).push({ b, m: 'table' }); continue; }
    const cy = (b[1] + b[3]) / 2;
    const row = items.filter((t) => Math.abs(t.y - t.h * 0.35 - cy) < 8);
    const left = row.filter((t) => t.x2 <= b[0] + 3 && t.x2 > b[0] - 30), right = row.filter((t) => t.x >= b[2] - 3 && t.x < b[2] + 30);
    const m = left.some((t) => /[=＝×+\-－÷→]\s*$/.test(t.s)) || right.some((t) => /^\s*[=＝×+\-－÷]/.test(t.s));
    if (m) R.boxMath++;
    (DUMP[n] ??= []).push({ b, m: m ? 'math' : 'other' });
  }
  for (const l of lines) { R.line++; if (items.some((t) => Math.abs(t.y - l[1]) < 6 && t.x2 <= l[0] + 3 && t.x2 > l[0] - 20)) R.lineAfterText++; }
  // 四线格:x 范围重叠的 4 条水平线,间距相等(±0.6)、间距 3–15pt
  const ls = lines.slice().sort((a, b) => a[1] - b[1]);
  for (let i = 0; i + 3 < ls.length; i++) {
    const q = ls.slice(i, i + 4); const d = [q[1][1]-q[0][1], q[2][1]-q[1][1], q[3][1]-q[2][1]];
    if (d.every((v) => v > 3 && v < 15 && Math.abs(v - d[0]) < 0.6) && q.every((l) => Math.abs(l[0] - q[0][0]) < 3)) { R.fourLine++; fourPages.add(n); i += 3; }
  }
}
if (dumpTo) (await import('node:fs')).writeFileSync(dumpTo, JSON.stringify(DUMP));
console.log(R, '四线格页', [...fourPages].join(','));
