/**
 * 打出课本 PDF 一页的操作表:每条路径(页面坐标,y 向下;描边色、线宽、虚线)和每段字(填充色)。
 * 用:node docs/artifact/页上记号/核实/walk.mjs <课本.pdf> <页> [json]
 * 页上记号规范 R3 核实用(2026-11-22,语文二上第 16 页):田字格是描边正方形 + 两条虚线中线,范字和描红只差填充色。
 */
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const [, , file, pageNo, mode] = process.argv;
const doc = await pdfjs.getDocument({ url: file, verbosity: 0 }).promise;
const p = await doc.getPage(Number(pageNo));
const vp = p.getViewport({ scale: 1 });
const ol = await p.getOperatorList({ annotationMode: 0 });
const O = pdfjs.OPS, NAME = Object.fromEntries(Object.entries(O).map(([k, v]) => [v, k]));
const mul = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
let g = { ctm: vp.transform.slice(), stroke: '#000', fill: '#000', lw: 1, dash: [] }; const st = [];
const pt = (m, x, y) => [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]];
const hex = (a) => '#' + a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const out = [];
let tm = null, fontSize = 0;
ol.fnArray.forEach((f, i) => {
  const a = ol.argsArray[i];
  switch (f) {
    case O.save: st.push(structuredClone(g)); break;
    case O.restore: g = st.pop() ?? g; break;
    case O.transform: g.ctm = mul(g.ctm, a); break;
    case O.paintFormXObjectBegin: st.push(structuredClone(g)); if (a[0]) g.ctm = mul(g.ctm, a[0]); break;
    case O.paintFormXObjectEnd: g = st.pop() ?? g; break;
    case O.setStrokeRGBColor: g.stroke = typeof a[0] === 'string' ? a[0] : hex(a); break;
    case O.setFillRGBColor: g.fill = typeof a[0] === 'string' ? a[0] : hex(a); break;
    case O.setLineWidth: g.lw = a[0]; break;
    case O.setDash: g.dash = a[0]; break;
    case O.setFont: fontSize = a[1]; break;
    case O.setTextMatrix: tm = a; break;
    case O.showText: {
      const s = a[0].map((c) => (c && c.unicode) || '').join('');
      if (tm && s.trim()) { const [x, y] = pt(mul(g.ctm, tm), 0, 0); out.push({ k: 'text', s, x: +x.toFixed(1), y: +y.toFixed(1), size: +(fontSize * Math.hypot(tm[0], tm[1]) * Math.hypot(g.ctm[0], g.ctm[1])).toFixed(1), fill: g.fill }); }
      break;
    }
    case O.constructPath: {
      const [op, [data], mm] = a;
      const pts = []; const segs = [];
      for (let j = 0; j < data.length;) {
        const c = data[j++];
        if (c === 0 || c === 1) { const q = pt(g.ctm, data[j], data[j+1]); pts.push(q); segs.push(c === 0 ? 'M' : 'L'); j += 2; }
        else if (c === 2) { pts.push(pt(g.ctm, data[j+4], data[j+5])); segs.push('C'); j += 6; }
        else if (c === 3) { pts.push(pt(g.ctm, data[j+2], data[j+3])); segs.push('Q'); j += 4; }
        else segs.push('Z');
      }
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => +v.toFixed(1));
      out.push({ k: 'path', paint: NAME[op], segs: segs.join(''), box, stroke: g.stroke, fill: g.fill, lw: +(g.lw * Math.hypot(g.ctm[0], g.ctm[1])).toFixed(2), dash: g.dash?.length ? g.dash.map((v) => +v.toFixed(2)) : undefined, n: pts.length });
      break;
    }
  }
});
if (mode === 'json') console.log(JSON.stringify(out));
else for (const o of out) console.log(o.k === 'text' ? `T ${o.x},${o.y} ${o.size} ${o.fill} ${o.s}` : `P ${o.paint} ${o.box.join(',')} st=${o.stroke} fi=${o.fill} lw=${o.lw} dash=${o.dash ?? ''} ${o.segs.slice(0, 40)}${o.segs.length > 40 ? '…(' + o.segs.length + ')' : ''}`);
