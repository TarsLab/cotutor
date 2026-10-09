/**
 * drawtell/core:时钟(和 timeline 同一份时间)、几何(文字按真播放器量的字宽)、圈住了什么(分组、label、块、文字、归堆)、
 * build 落 bounds 与 groups、check 查 groups。样本是一份真课包(13 − 8 破十法,6 步,有配音时长)。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleBundle, BundleError, circleHits, clockAt, describeCircle, elementBounds, frameAt, lessonClock, measureText, parseBundle, prepareSkeletons } from '../src/core/index.ts';
import { seedFromId } from '../src/player/seed.ts';
import { PAPER_COLOR } from '../src/player/pointer.ts';
import { computeStepWindows, START_MS } from '../src/player/timeline.ts';
import { buildBundle, readBundle } from '../src/cli/build.ts';
import { checkScene } from '../src/cli/check.ts';
import type { ChalkGroup, ChalkScene, ChalkSkeleton, ChalkStep } from '../src/player/types.ts';

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
const { schema: _s, version: _v, ...sceneJson } = JSON.parse(readFileSync(join(dir, 'scene.json'), 'utf8')) as Omit<ChalkScene, 'steps'> & { schema: string; version: number };
const steps = (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { steps: ChalkStep[] }).steps;
const clock = lessonClock(sceneJson.skeletons, steps);

// ---- 时钟 ----
const wins = computeStepWindows(clock.skeletons, steps);
check('每段的笔画窗 = timeline 的 computeStepWindows(拉伸后)', clock.segments.every((s, i) => s.drawStart === wins[i].startMs && s.drawEnd === wins[i].endMs), JSON.stringify({ segs: clock.segments.map((s) => [s.drawStart, s.drawEnd]), wins }));
check('六段首尾相接,段长 = max(画, 配音),课长 = 各段相加', clock.segments.length === 6 && clock.segments.every((s, i) => s.start === (i ? clock.segments[i - 1].start + clock.segments[i - 1].len : 0) && s.len === Math.max(s.drawEnd - s.drawStart, s.audioMs ?? 0)) && clock.total === clock.segments.reduce((a, s) => a + s.len, 0));
const s2 = clock.segments[1];
const a = clockAt(clock, s2.start + 500);
check('clockAt:落在第二段、段内 500、SVG 在窗起点 + 500', a.index === 1 && a.offset === 500 && a.svgMs === s2.drawStart + 500, JSON.stringify(a));
check('clockAt:段尾定格在窗终点前半毫秒;越界夹到两头;没有步 index -1', clockAt(clock, s2.start + s2.len - 1).svgMs <= s2.drawEnd - 0.5 && clockAt(clock, s2.start + s2.len - 1).svgMs > s2.drawEnd - 3 && clockAt(clock, -9).index === 0 && clockAt(clock, 1e9).index === 5 && clockAt(lessonClock([], []), 5).index === -1 && clockAt(lessonClock([], []), 5).svgMs === START_MS);
{
  const c = lessonClock([{ type: 'line', id: 'a', x: 0, y: 0 }], [{ step: 1, elementIds: ['a'], line: '讲很久', pauseAfter: true, audioDurationMs: 8000 }]);
  check('封顶 5 倍:一笔 500 毫秒、配音 8 秒 → 画 2.5 秒、段长 8 秒', c.segments[0].drawEnd - c.segments[0].drawStart === 2500 && c.segments[0].len === 8000);
  const d = lessonClock([{ type: 'line', id: 'a', x: 0, y: 0 }], [{ step: 1, elementIds: ['a'], line: '探到的', pauseAfter: true }], { durations: [3000] });
  check('durations 覆盖配音时长(播放器探测到的)', d.segments[0].audioMs === 3000 && d.segments[0].len === 3000);
}
const f0 = frameAt(clock, 0);
const fEnd = frameAt(clock, clock.total);
const fMid = frameAt(clock, s2.start + 300);
check('frameAt:开头什么都还没画;结尾全有(最后一笔停在画完前半毫秒)', f0.elements.length === 0 && fEnd.elements.length === sceneJson.skeletons.length && fEnd.elements.slice(0, -1).every((e) => e.progress === 1) && fEnd.elements[fEnd.elements.length - 1].progress > 0.99, JSON.stringify(f0));
check('frameAt:第二段开头 300 毫秒,第一步全画完、第二步第一笔画到一半,讲稿是第二句', steps[0].elementIds.every((id) => fMid.elements.find((e) => e.id === id)?.progress === 1) && fMid.elements.filter((e) => steps[1].elementIds.includes(e.id)).length === 1 && fMid.elements.find((e) => e.id === steps[1].elementIds[0])!.progress < 1 && fMid.line === steps[1].line);

// ---- 几何:文字宽对真播放器量出来的(这份课包在 Chrome 里导出的 SVG) ----
const w = (text: string, fs: number) => measureText(text, fs).width;
check('文字宽:「13 − 8 =」28 号 ≈ 111.2、「10」24 号 ≈ 26.2、「(」≈ 12.4;行高 1.25', Math.abs(w('13 − 8 =', 28) - 111.2) < 3 && Math.abs(w('10', 24) - 26.19) < 1 && Math.abs(w('(', 28) - 12.36) < 0.5 && measureText('一\n二', 20).height === 50, JSON.stringify([w('13 − 8 =', 28), w('10', 24), w('(', 28)]));
check('汉字一个字号宽;多行取最宽的那行', w('一捆 10 根', 20) > 20 * 2 && w('甲乙\n甲乙丙', 10) === 30);
check('包围盒:线按点、框按宽高、元素带更宽的 width 以它为准', JSON.stringify(elementBounds({ type: 'line', id: 'l', x: 10, y: 20, points: [[0, 0], [-18, 28]] })) === JSON.stringify({ minX: -8, minY: 20, maxX: 10, maxY: 48 }) && elementBounds({ type: 'rectangle', id: 'r', x: 1, y: 2, width: 3, height: 4 }).maxY === 6 && elementBounds({ type: 'text', id: 't', x: 0, y: 0, text: 'a', fontSize: 20, width: 99 }).maxX === 99);

// ---- 圈住了什么 ----
const ring = (cx: number, cy: number, rx: number, ry: number): [number, number][] => Array.from({ length: 24 }, (_, k) => [Math.round(cx + rx * Math.cos((k / 24) * 2 * Math.PI)), Math.round(cy + ry * Math.sin((k / 24) * 2 * Math.PI))] as [number, number]);
const ids = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}-${i + 1}`);
const groups: ChalkGroup[] = [
  { id: 'all', label: '13 根小棒', elementIds: [...ids('b', 10), ...ids('s', 3)] },
  { id: 'bundle', label: '一捆 10 根小棒', elementIds: ids('b', 10) },
  { id: 'loose', label: '散的 3 根小棒', elementIds: ids('s', 3) },
];
const s3 = clock.segments[2];
const after4 = clock.segments[3].start + 100;
{
  const bare = circleHits(clock, s3.start + 2000, ring(334, 120, 45, 50));
  check('没有分组:散的 3 根说成「第 1 步画的 3 条线(旁边写着『3』)」', describeCircle(bare) === '圈住了:第 1 步画的 3 条线(旁边写着『3』)' && bare.index === 2 && bare.line === steps[2].line && JSON.stringify(bare.ids) === JSON.stringify(ids('s', 3)), describeCircle(bare));
  const named = circleHits(clock, s3.start + 2000, ring(334, 120, 45, 50), { groups });
  check('有分组:说组名;小组圈满了先认小组,不被「13 根小棒」吞掉', describeCircle(named) === '圈住了:散的 3 根小棒', describeCircle(named));
  const withLabel = circleHits(clock, s3.start + 2000, ring(334, 70, 52, 110), { groups });
  check('连上面的「3」一起圈:组名 + 文字', describeCircle(withLabel) === '圈住了:散的 3 根小棒;文字『3』', describeCircle(withLabel));
  const part = circleHits(clock, after4, ring(130, 115, 85, 30), { groups });
  check('一捆里圈了 6 根:组圈住大半说「(圈住了其中 6 个)」;划掉的橙色斜线归一堆;外框不算', describeCircle(part).startsWith('圈住了:一捆 10 根小棒(圈住了其中 6 个);第 3 步画的 8 条橙色的线') && !describeCircle(part).includes('框'), describeCircle(part));
  const labeled = lessonClock(sceneJson.skeletons.map((e) => (e.id.startsWith('x-') ? { ...e, label: '划掉的小棒' } : e)), steps);
  check('元素带 label:说 label(同一个 label 归一样)', describeCircle(circleHits(labeled, after4, ring(130, 115, 85, 30), { groups })) === '圈住了:一捆 10 根小棒(圈住了其中 6 个);划掉的小棒', describeCircle(circleHits(labeled, after4, ring(130, 115, 85, 30), { groups })));
  check('那一刻还没画到的不算;空白处说最近的;太小不猜', circleHits(clock, 500, ring(130, 115, 85, 30)).kind === 'empty' && describeCircle(circleHits(clock, clock.total, ring(300, 250, 12, 12), { groups })).startsWith('没圈住东西,圈在') && circleHits(clock, 0, [[1, 1], [2, 2]]).kind === 'tiny');
  check('长的一行字里圈几个字:说整行;有命中块说块的字', describeCircle(circleHits(clock, clock.total, ring(515, 38, 22, 14))) === '圈住了:文字『13 − 8 =』' && describeCircle(circleHits(clock, clock.total, ring(515, 38, 22, 14), { blocks: [{ id: 'k', elementIds: ['q'], text: '十三减八', audioSrc: 'a.mp3' }] })) === '圈住了:『十三减八』');
  // 横线画了、擦了、又画回来
  const wipe = lessonClock(
    [
      { type: 'line', id: 'h', x: 0, y: 50, points: [[0, 0], [200, 0]], strokeColor: '#e03131' },
      { type: 'line', id: 'x', x: -10, y: 50, points: [[0, 0], [220, 0]], strokeWidth: 12, customData: { tool: 'eraser' } },
      { type: 'line', id: 'h2', x: 0, y: 50, points: [[0, 0], [200, 0]], strokeColor: '#1971c2' },
    ],
    [
      { step: 1, elementIds: ['h'], line: '切一刀', pauseAfter: true },
      { step: 2, elementIds: ['x'], line: '擦掉', pauseAfter: true },
      { step: 3, elementIds: ['h2'], line: '再切', pauseAfter: true },
    ],
  );
  const band = ring(100, 50, 120, 20);
  check('橡皮擦掉的不算:擦之前圈得住,擦完了说那一带没东西,画回来的照样算', describeCircle(circleHits(wipe, wipe.segments[1].start, band)) === '圈住了:第 1 步画的红色的线' && circleHits(wipe, wipe.segments[2].start, band).kind === 'empty' && describeCircle(circleHits(wipe, wipe.total, band)) === '圈住了:第 3 步画的蓝色的线', describeCircle(circleHits(wipe, wipe.segments[2].start, band)));
  const stored = circleHits(clock, s3.start + 2000, ring(334, 70, 52, 110), { groups, bounds: { lab3: [-999, -999, -998, -998] } });
  check('课包带 bounds:文字按存的算(「3」存在别处就不算圈住)', describeCircle(stored) === '圈住了:散的 3 根小棒', describeCircle(stored));
}

// ---- build 落 bounds 与 groups;check 查 groups ----
{
  const scene: ChalkScene = { ...sceneJson, groups, steps } as ChalkScene;
  const tmp = mkdtempSync(join(tmpdir(), 'drawtell-core-'));
  try {
    await buildBundle(scene, join(tmp, 'po'));
    const built = JSON.parse(readFileSync(join(tmp, 'po', 'scene.json'), 'utf8')) as { bounds: Record<string, number[]>; groups: ChalkGroup[] };
    const q = built.bounds.q;
    check('build:scene.json 带每个元素的 bounds(文字按字宽表)与 groups', Object.keys(built.bounds).length === sceneJson.skeletons.length && q[0] === 450 && q[1] === 22 && Math.abs(q[2] - 450 - 111.2) < 3 && q[3] === 57 && built.groups.length === 3, JSON.stringify(q));
    const back = await readBundle(tmp, 'po');
    check('readBundle:groups 往返', JSON.stringify(back.groups) === JSON.stringify(groups));
    const sj = JSON.parse(readFileSync(join(tmp, 'po', 'scene.json'), 'utf8')) as Record<string, unknown>;
    const mj = JSON.parse(readFileSync(join(tmp, 'po', 'manifest.json'), 'utf8')) as Record<string, unknown>;
    const parsed = parseBundle(sj, mj);
    check('parseBundle:场景、bounds、给 circleHits 的画面语义', parsed.scene.steps.length === steps.length && JSON.stringify(parsed.picture.groups) === JSON.stringify(groups) && parsed.picture.bounds === parsed.bounds && Object.keys(parsed.bounds ?? {}).length === sceneJson.skeletons.length);
    const err = (f: () => unknown): string => { try { f(); return ''; } catch (e) { return e instanceof BundleError ? e.message : `不是 BundleError:${String(e)}`; } };
    check('parseBundle:不合契约抛 BundleError,说哪里不对', /不符合场景契约:steps/.test(err(() => parseBundle(sj, { steps: 'x' }))), err(() => parseBundle(sj, { steps: 'x' })));
    check('parseBundle:bounds 形状不对也报', /bounds/.test(err(() => parseBundle({ ...sj, bounds: { q: [1, 2] } }, mj))));
    check('assembleBundle:只拼不校验,拼出来和 parseBundle 一样', JSON.stringify(assembleBundle(sj, mj)) === JSON.stringify(parsed));
    check('parseBundle:不是对象就报', /scene\.json/.test(err(() => parseBundle(null, mj))));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const bad = checkScene({ ...scene, groups: [...groups, { id: 'loose', label: '重了', elementIds: ['nope'] }] }).findings.map((f) => f.rule);
  check('check:group id 重复、引用不存在的元素都报', bad.includes('group-id') && bad.includes('group-ref'), JSON.stringify(bad));
  check('check:分组写对了没有 group 的报', !checkScene(scene).findings.some((f) => f.rule.startsWith('group')));
  check('schema:label 要有字', checkScene({ ...scene, skeletons: scene.skeletons.map((e, i) => (i ? e : { ...e, label: '' })) }).findings.some((f) => f.level === 'error'));
}

// ---- 交给 excalidraw 前的预处理 ----
{
  const els: ChalkSkeleton[] = [
    { type: 'line', id: 'a', x: 0, y: 0 },
    { type: 'line', id: 'b', x: 0, y: 0, seed: 7 },
    { type: 'line', id: 'e', x: 0, y: 0, strokeWidth: 30, customData: { tool: 'eraser' } },
    { type: 'line', id: 'e2', x: 0, y: 0, strokeColor: '#123456', customData: { tool: 'eraser' } },
  ];
  const [a, b, e, e2] = prepareSkeletons(els);
  check('prepareSkeletons:没 seed 的按 id 派生,给了的不动', a.seed === seedFromId('a') && b.seed === 7);
  check('prepareSkeletons:橡皮补纸色、不抖,作者给的颜色优先', e.strokeColor === PAPER_COLOR && e.roughness === 0 && e2.strokeColor === '#123456' && a.strokeColor === undefined);
  check('prepareSkeletons:不改原数组', els[0].seed === undefined);
}

console.log(`${passed} 通过, ${failed} 失败`);
if (failed) process.exit(1);
