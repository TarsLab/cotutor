/**
 * 字形包几何回归:笔画连续、升降部到位、墨迹不越界、采样健康。
 *
 * 字形数值是手写的(含一堆 cos/sin 手算的弧起点),最容易出的错是
 * "弧的 a0 算出来的点和上一段终点对不上"——肉眼看图未必发现,
 * 动画却会在接缝处跳一下。这里逐段核对。
 */
import { LOWERCASE } from '../src/glyphs/letters.ts';
import { UPPERCASE } from '../src/glyphs/capitals.ts';
import { GLYPHS } from '../src/glyphs/registry.ts';
import { GUIDES, CAP } from '../src/glyphs/metrics.ts';
import { sampleStroke, segEnd, glyphBBox, strokeLength } from '../src/glyphs/sample.ts';
import { wordSkeletons, wordAdvance, UnknownGlyphError } from '../src/glyphs/skeleton.ts';
import type { Pt } from '../src/glyphs/sample.ts';

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail: string): void {
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${name}: ${detail}`);
  }
}

const ALPHABET = [...'abcdefghijklmnopqrstuvwxyz'];
const CAPS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const ALL = [...ALPHABET, ...CAPS];
const EPS = 1e-9;

// ---- 收录完整 ----
check('26 个小写齐全', LOWERCASE.size === 26, `实际 ${LOWERCASE.size}`);
check('26 个大写齐全', UPPERCASE.size === 26, `实际 ${UPPERCASE.size}`);
check('registry 收 52 个', GLYPHS.size === 52, `实际 ${GLYPHS.size}`);
for (const ch of ALL) check(`收录 ${ch}`, GLYPHS.has(ch), '缺失');

// ---- 笔画连续:每段的起点必须落在前一段的终点上 ----
for (const ch of ALL) {
  const g = GLYPHS.get(ch)!;
  g.strokes.forEach((st, si) => {
    let cur: Pt = [st.start[0], st.start[1]];
    st.segs.forEach((seg, gi) => {
      if (seg.k === 'A') {
        const a = (seg.a0 * Math.PI) / 180;
        const from: Pt = [seg.cx + seg.rx * Math.cos(a), seg.cy + seg.ry * Math.sin(a)];
        const d = Math.hypot(from[0] - cur[0], from[1] - cur[1]);
        check(`${ch} 笔${si + 1} 段${gi + 1} 弧起点接缝`, d < 1e-6,
          `弧 a0=${seg.a0}° 起于 (${from[0].toFixed(4)}, ${from[1].toFixed(4)}),上一段终于 (${cur[0].toFixed(4)}, ${cur[1].toFixed(4)}),差 ${d.toFixed(6)}`);
      }
      cur = segEnd(seg);
    });
  });
}

// ---- 升部 / 降部 / x 高:字形必须落在四线三格该在的位置 ----
const ASCENDERS = new Set(['b', 'd', 'f', 'h', 'k', 'l', 't']);
const DESCENDERS = new Set(['g', 'j', 'p', 'q', 'y']);
/** i j 的点在 x 高之上但不到升部顶,单独归类 */
const DOTTED = new Set(['i', 'j']);

for (const ch of ALPHABET) {
  const g = LOWERCASE.get(ch)!;
  const bb = glyphBBox(g);
  if (ASCENDERS.has(ch)) {
    // t 的竖按惯例略低于升部顶,其余顶到 top 线
    const want = ch === 't' ? -1.7 : GUIDES.top;
    check(`${ch} 升部到位`, Math.abs(bb.y0 - want) < 0.02, `顶 ${bb.y0.toFixed(3)},期望 ${want}`);
  } else if (DOTTED.has(ch)) {
    check(`${ch} 点不越升部顶`, bb.y0 > GUIDES.top && bb.y0 < GUIDES.xTop, `顶 ${bb.y0.toFixed(3)}`);
  } else {
    check(`${ch} 不越 x 高顶`, bb.y0 >= GUIDES.xTop - 0.02, `顶 ${bb.y0.toFixed(3)},期望 ≥ ${GUIDES.xTop}`);
  }

  if (DESCENDERS.has(ch)) {
    check(`${ch} 有降部`, bb.y1 > GUIDES.base + 0.3, `底 ${bb.y1.toFixed(3)},应探入降部区`);
    check(`${ch} 降部不越底线`, bb.y1 <= GUIDES.bottom + 0.02, `底 ${bb.y1.toFixed(3)},期望 ≤ ${GUIDES.bottom}`);
  } else {
    check(`${ch} 坐在基线上`, Math.abs(bb.y1 - GUIDES.base) < 0.02, `底 ${bb.y1.toFixed(3)},期望 ${GUIDES.base}`);
  }
}

// ---- 大写:顶到 CAP、坐基线(只有 Q 的尾巴探出) ----
for (const ch of CAPS) {
  const g = UPPERCASE.get(ch)!;
  const bb = glyphBBox(g);
  check(`${ch} 顶到大写线`, Math.abs(bb.y0 - CAP) < 0.03, `顶 ${bb.y0.toFixed(3)},期望 ${CAP}`);
  if (ch === 'Q') {
    check('Q 的尾巴探出基线', bb.y1 > GUIDES.base + 0.1, `底 ${bb.y1.toFixed(3)}`);
    check('Q 的尾巴不进降部区', bb.y1 < GUIDES.bottom * 0.5, `底 ${bb.y1.toFixed(3)},不该垂到小写降部那么深`);
  } else {
    check(`${ch} 坐在基线上`, Math.abs(bb.y1 - GUIDES.base) < 0.03, `底 ${bb.y1.toFixed(3)},期望 ${GUIDES.base}`);
  }
  // 大写比同名小写宽,是这套度量的应有之义
  const lower = LOWERCASE.get(ch.toLowerCase())!;
  check(`${ch} 比 ${ch.toLowerCase()} 宽`, g.advance > lower.advance,
    `${ch} advance ${g.advance} 应大于 ${ch.toLowerCase()} 的 ${lower.advance}`);
}

// ---- 墨迹横向不越出 advance ----
for (const ch of ALL) {
  const g = GLYPHS.get(ch)!;
  const bb = glyphBBox(g);
  check(`${ch} 墨迹不左越`, bb.x0 >= -0.02, `最左 ${bb.x0.toFixed(3)}`);
  check(`${ch} 墨迹不超 advance`, bb.x1 <= g.advance + 0.02, `最右 ${bb.x1.toFixed(3)},advance ${g.advance}`);
  // i/l 这类竖线字母墨迹宽度近 0,advance 本就该给出两侧留白,只挡"离谱地宽"
  check(`${ch} advance 不离谱`, g.advance - (bb.x1 - bb.x0) <= 0.35,
    `advance ${g.advance},墨迹宽 ${(bb.x1 - bb.x0).toFixed(3)},留白过多会让字间距看起来不匀`);
}

// ---- 采样健康:点够多、不重复、首点即起点 ----
for (const ch of ALL) {
  const g = GLYPHS.get(ch)!;
  g.strokes.forEach((st, si) => {
    const pts = sampleStroke(st);
    check(`${ch} 笔${si + 1} 点数够`, pts.length >= 3, `只有 ${pts.length} 点`);
    check(`${ch} 笔${si + 1} 首点即起点`,
      Math.abs(pts[0][0] - st.start[0]) < EPS && Math.abs(pts[0][1] - st.start[1]) < EPS,
      `首点 ${JSON.stringify(pts[0])} ≠ start ${JSON.stringify(st.start)}`);
    const dup = pts.findIndex((p, i) => i > 0 && Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) < 1e-9);
    check(`${ch} 笔${si + 1} 无重复点`, dup === -1, `第 ${dup} 点与前一点重合`);
    check(`${ch} 笔${si + 1} 有长度`, strokeLength(st) > 0.05, `长度 ${strokeLength(st).toFixed(4)}`);
  });
}

// ---- 笔顺:先竖后拱 / 点最后落 ----
check('i 的点是最后一笔', LOWERCASE.get('i')!.strokes.length === 2 && strokeLength(LOWERCASE.get('i')!.strokes[1]) < 0.2, '点应为第 2 笔且极短');
check('j 的点是最后一笔', LOWERCASE.get('j')!.strokes.length === 2 && strokeLength(LOWERCASE.get('j')!.strokes[1]) < 0.2, '点应为第 2 笔且极短');
check('m 是 3 笔', LOWERCASE.get('m')!.strokes.length === 3, `实际 ${LOWERCASE.get('m')!.strokes.length}`);
check('l 是 1 笔', LOWERCASE.get('l')!.strokes.length === 1, `实际 ${LOWERCASE.get('l')!.strokes.length}`);
check('o 是 1 笔', LOWERCASE.get('o')!.strokes.length === 1, `实际 ${LOWERCASE.get('o')!.strokes.length}`);
// b/p 的碗与 a/d/g/o/q 的圈同尺寸:字母表放一起不能一个圆一个方
const bowlW = (ch: string) => { const bb = glyphBBox(LOWERCASE.get(ch)!); return bb.x1 - bb.x0; };
for (const ch of ['b', 'd', 'g', 'p', 'q']) {
  check(`${ch} 的碗与 o 同宽`, Math.abs(bowlW(ch) - bowlW('o')) < 0.03, `${ch} 宽 ${bowlW(ch).toFixed(3)},o 宽 ${bowlW('o').toFixed(3)}`);
}

// ---- skeleton 面 ----
const XH = 100;
const ram = wordSkeletons('ram', { xHeight: XH, x: 0, y: 0 });
check('ram = 7 笔', ram.length === 7, `实际 ${ram.length}`);
check('ram id 唯一', new Set(ram.map((e) => e.id)).size === ram.length, ram.map((e) => e.id).join(' '));
check('全是 freedraw', ram.every((e) => e.type === 'freedraw'), ram.map((e) => e.type).join(' '));
// freedraw 走 convertToExcalidrawElements 是原样透传,少一个字段 animateSvg 就炸
for (const f of ['groupIds', 'roundness', 'boundElements', 'pressures', 'simulatePressure', 'isDeleted', 'frameId']) {
  check(`freedraw 带 ${f}`, ram.every((e) => f in e), `缺 ${f} 会让 animateSvg 的 createGroups 抛 undefined`);
}
check('points 首点为原点', ram.every((e) => {
  const p = (e.points as [number, number][])[0];
  return Math.abs(p[0]) < EPS && Math.abs(p[1]) < EPS;
}), 'freedraw 的 points 必须相对元素 x/y,首点 [0,0]');
check('每笔都有时长', ram.every((e) => typeof e.animateDuration === 'number' && e.animateDuration! >= 90), ram.map((e) => e.animateDuration).join(' '));
const rightEdge = (els: typeof ram): number =>
  Math.max(...els.map((e) => e.x + Math.max(...(e.points as [number, number][]).map((p) => p[0]))));
check('宽度 = wordAdvance', Math.abs(rightEdge(ram) - wordAdvance('ram', { xHeight: XH })) < 3,
  `墨迹右界 ${rightEdge(ram).toFixed(1)} vs wordAdvance ${wordAdvance('ram', { xHeight: XH }).toFixed(1)}`);
// 空格只前进不落笔:'ram man' 与 'rammanb' 的笔数关系可核
const spaced = wordSkeletons('ram man', { xHeight: XH, x: 0, y: 0 });
const joined = wordSkeletons('ramman', { xHeight: XH, x: 0, y: 0 });
check('空格不产生笔画', spaced.length === joined.length, `${spaced.length} vs ${joined.length}`);
check('空格让后半右移', spaced[spaced.length - 1].x > joined[joined.length - 1].x,
  `空格版末笔 x=${spaced[spaced.length - 1].x} 应大于无空格版 ${joined[joined.length - 1].x}`);
check('wordAdvance 计入空格',
  Math.abs(wordAdvance('ram man', { xHeight: XH }) - (wordAdvance('ramman', { xHeight: XH }) + (0.55 + 0.22) * XH)) < 1,
  `${wordAdvance('ram man', { xHeight: XH })} vs ${wordAdvance('ramman', { xHeight: XH })}`);

// 同字母重复出现不能撞 id
const mama = wordSkeletons('mama', { xHeight: XH, x: 0, y: 0 });
check('重复字母 id 不撞', new Set(mama.map((e) => e.id)).size === mama.length, mama.map((e) => e.id).join(' '));
// 未收录字符要报得清楚
let threw2: unknown = null;
try { wordAdvance('7', { xHeight: XH }); } catch (e) { threw2 = e; }
check('数字明确报错', threw2 instanceof UnknownGlyphError, `拿到 ${threw2}`);

// ---- 大小写混排 ----
const mixed = wordSkeletons('Apple', { xHeight: XH, x: 0, y: 0 });
check('Apple 出得来', mixed.length > 0 && mixed.every((e) => e.type === 'freedraw'), `${mixed.length} 笔`);
check('Apple id 唯一', new Set(mixed.map((e) => e.id)).size === mixed.length, mixed.map((e) => e.id).join(' '));
// A 顶到大写线、pple 的 p 探入降部:混排后的纵向跨度应覆盖 CAP..DESC
const ys = mixed.flatMap((e) => (e.points as [number, number][]).map((p) => e.y + p[1]));
check('混排纵向跨度对', Math.abs(Math.min(...ys) - CAP * XH) < 3 && Math.max(...ys) > GUIDES.base * XH + 0.5 * XH,
  `顶 ${Math.min(...ys).toFixed(1)} 底 ${Math.max(...ys).toFixed(1)},期望顶≈${CAP * XH}、底探入降部`);
let threwDigit: unknown = null;
try { wordSkeletons('A1', { xHeight: XH, x: 0, y: 0 }); } catch (e) { threwDigit = e; }
check('数字仍明确报错', threwDigit instanceof UnknownGlyphError, `拿到 ${threwDigit}`);

// ---- 缩放不变性:x 高翻倍,一切按比例 ----
const big = wordSkeletons('ram', { xHeight: XH * 2, x: 0, y: 0 });
check('缩放后笔数不变', big.length === ram.length, `${big.length} vs ${ram.length}`);
check('缩放后宽度翻倍', Math.abs((big[2].width as number) - (ram[2].width as number) * 2) < 1e-6,
  `${big[2].width} vs ${(ram[2].width as number) * 2}`);
check('缩放不改时长', big.every((e, i) => e.animateDuration === ram[i].animateDuration), '时长应只由笔画长度决定,与字号无关');

console.log(`${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
