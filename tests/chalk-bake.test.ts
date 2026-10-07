/**
 * 烤好的画面(core/bake.ts):样本是 13 − 8 那份课包用 drawtell bake 烤出来的 bake.json(浏览器里烤,这里不开浏览器)。
 * 某一刻的 SVG 字符串:没开始的不出、画到一半的按描边揭示、字按裁剪框露、全画完不带揭示的属性;笔尖只在真画着时出现;
 * 一个元素的画法(paintElement):描边按长度首尾相接、实心填充最后淡入、虚线轮到它才出现;画面指纹变了要重烤。
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameAt, lessonClock, paintElement, renderFrameSvg, type BakedElement, type BakedLesson } from '../src/core/index.ts';
import { bakeIsFresh, pictureHash } from '../src/cli/bake.ts';
import type { ChalkSkeleton, ChalkStep } from '../src/player/types.ts';

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}: ${detail}`);
  }
}

const dir = fileURLToPath(new URL('./fixtures/po13-jian-8/', import.meta.url));
const scene = JSON.parse(readFileSync(join(dir, 'scene.json'), 'utf8')) as { skeletons: ChalkSkeleton[] };
const steps = (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { steps: ChalkStep[] }).steps;
const baked = JSON.parse(readFileSync(join(dir, 'bake.json'), 'utf8')) as BakedLesson;
const clock = lessonClock(scene.skeletons, steps);
const at = (ms: number) => renderFrameSvg(baked, frameAt(clock, ms), { pointer: true });
const count = (s: string, sub: string) => s.split(sub).length - 1;

check('样本:41 个元素与场景一一对应、id 对得上;字体内嵌;平移与 viewBox', baked.elements.length === scene.skeletons.length && baked.elements.every((e, i) => e.id === scene.skeletons[i].id) && baked.fonts.includes('@font-face') && JSON.stringify(baked.offset) === '[-16,14]' && baked.viewBox[2] > 600);
check('字有揭示框(宽是浏览器量的),线有轨迹', baked.elements[0].reveal?.width === 111.2 && baked.elements.every((e) => e.track.length >= 2));

const blank = at(0);
const ending = at(clock.total + 1);
const full = renderFrameSvg(baked, new Map(baked.elements.map((e) => [e.id, 1])), { pointer: true });
check('开头:一个元素都没有', !blank.includes('translate(434 36)') && count(blank, '<path') === 0);
check('课的结尾(最后一笔停在画完前半毫秒)全部元素都在;全画完(都是 1)没有揭示的属性、没有笔尖、没有裁剪', baked.elements.every((e) => ending.includes(e.node.attrs.transform ?? e.node.children?.[0]?.attrs.transform ?? '¶')) && !ending.includes('<image') && baked.elements.every((e) => full.includes(e.node.attrs.transform ?? e.node.children?.[0]?.attrs.transform ?? '¶')) && !full.includes('stroke-dashoffset') && !full.includes('clip-path') && !full.includes('<image'));
const s3 = clock.segments[2];
const mid3 = at(s3.start + s3.len * 0.45);
check('第 3 段中间:正在画的那一笔带 dashoffset、笔尖在;后面的斜线还没出', count(mid3, 'stroke-dashoffset') >= 1 && count(mid3, 'stroke-dashoffset') <= 2 && mid3.includes('<image') && !mid3.includes('translate(171 '), String(count(mid3, 'stroke-dashoffset')));
const textMid = renderFrameSvg(baked, new Map([['q', 0.25]]), { pointer: true });
check('字轮到了就整段出现:不套裁剪、不露一半、没有笔尖', textMid.includes('13 − 8 =') && !textMid.includes('clip-path') && !textMid.includes('<image') && !renderFrameSvg(baked, new Map([['q', 0]])).includes('13 − 8 ='), textMid.slice(-300));
check('笔尖:画着时有,步尾定格(画完前半毫秒)时收起', renderFrameSvg(baked, new Map([['box', 0.5]]), { pointer: true }).includes('<image') && !renderFrameSvg(baked, new Map([['box', 0.999]]), { pointer: true }).includes('<image') && !renderFrameSvg(baked, new Map([['box', 0.5]])).includes('<image'));
check('背景图:给了 URL 才画', !full.includes('background') && renderFrameSvg({ ...baked, background: { src: 'background.png', x: 1, y: 2, width: 3, height: 4 } }, new Map(), { backgroundHref: '/b/background.png' }).includes('<image href="/b/background.png" x="1" y="2" width="3" height="4"'));

// ---- 一个元素的画法 ----
const el: BakedElement = {
  id: 'e',
  track: [[0, 0, 0], [10, 0, 0.5], [10, 10, 1]],
  node: { tag: 'g', attrs: {}, children: [
    { tag: 'path', attrs: { fill: '#ffd43b', stroke: 'none' }, len: 40 },
    { tag: 'path', attrs: { stroke: '#000' }, len: 10 },
    { tag: 'g', attrs: { stroke: '#e03131' }, children: [{ tag: 'path', attrs: { fill: 'none' }, len: 30 }] },
    { tag: 'path', attrs: { stroke: '#000', 'stroke-dasharray': '8 8' }, len: 20 },
  ] },
};
const p0 = paintElement(el, 0);
const half = paintElement(el, 0.5);
const done = paintElement(el, 1);
check('p = 0 不出;p = 1 全画完、没有揭示', !p0.visible && done.visible && done.done && done.paths.every((x) => !x.dash && x.opacity === undefined));
check('描边按长度首尾相接(10 + 30 + 虚线 20,画了一半 = 第一条画完、第二条画了 2/3);stroke 继承父节点', !half.paths[1].dash && half.paths[1].opacity === undefined && Math.abs(half.paths[2].dash!.offset - 10) < 1e-9, JSON.stringify(half.paths));
check('实心填充最后淡入;虚线轮到它才整条出现;没轮到的整条藏起来(不露 round 线帽的点)', half.paths[0].opacity === 0 && Math.abs(paintElement(el, 0.85).paths[0].opacity! - 0.5) < 1e-9 && half.paths[3].opacity === 0 && paintElement(el, 0.8).paths[3].opacity === undefined && paintElement(el, 0.1).paths[2].opacity === 0, JSON.stringify(half.paths));
{
  // 手绘一笔描两遍:bake 拆成两条 path、pass 相同,一起画;下一笔(另一个 pass)等这一拨画完
  const twice: BakedElement = { id: 't', track: [], node: { tag: 'g', attrs: { stroke: '#000' }, children: [
    { tag: 'path', attrs: {}, len: 100, pass: 0 }, { tag: 'path', attrs: {}, len: 90, pass: 0 },
    { tag: 'path', attrs: {}, len: 100, pass: 1 }, { tag: 'path', attrs: {}, len: 110, pass: 1 },
  ] } };
  const h = paintElement(twice, 50 / 210); // 两拨长 100 + 110,画到 50 = 第一拨一半
  check('同一笔的两遍一起画(按各自长度画同样的几分之几),下一笔等着;一拨的长度取最长的', Math.abs(h.paths[0].dash!.offset - 50) < 1e-9 && Math.abs(h.paths[1].dash!.offset - 45) < 1e-9 && h.paths[2].opacity === 0 && h.paths[3].opacity === 0, JSON.stringify(h.paths));
}
check('笔尖沿轨迹插值', JSON.stringify(paintElement(el, 0.25).pointer) === '[5,0]' && JSON.stringify(paintElement(el, 0.75).pointer) === '[10,5]');

// ---- 画面指纹 ----
{
  const tmp = mkdtempSync(join(tmpdir(), 'drawtell-bake-'));
  try {
    cpSync(dir, join(tmp, 'po'), { recursive: true });
    check('样本是新鲜的:指纹 = scene.json 的画面', baked.source.hash === pictureHash(scene) && (await bakeIsFresh(join(tmp, 'po'))));
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { steps: ChalkStep[] };
    writeFileSync(join(tmp, 'po', 'manifest.json'), JSON.stringify({ ...m, steps: m.steps.map((s) => ({ ...s, audioDurationMs: 99 })) }));
    check('配音时长变了不用重烤', await bakeIsFresh(join(tmp, 'po')));
    const sj = JSON.parse(readFileSync(join(dir, 'scene.json'), 'utf8')) as { skeletons: ChalkSkeleton[] };
    writeFileSync(join(tmp, 'po', 'scene.json'), JSON.stringify({ ...sj, skeletons: sj.skeletons.map((e, i) => (i ? e : { ...e, x: e.x + 1 })) }));
    check('画面变了(挪了一个元素)要重烤;没有 bake.json 也算不新鲜', !(await bakeIsFresh(join(tmp, 'po'))) && !(await bakeIsFresh(join(tmp, 'nope'))));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`${passed} 通过, ${failed} 失败`);
if (failed) process.exit(1);
