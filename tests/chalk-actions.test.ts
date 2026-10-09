/**
 * 笔顺里的动作(《重新设计.md》第 3 步):erase 擦掉前面画过的几样,board 换一块画板。
 * 谁擦了谁、谁在第几块画板(resolveActions);时钟里被擦的那段、某一刻在第几块画板、正在擦的还剩几成;
 * 圈住了什么不算擦掉的;课讲完时留着的(finalBoard);check 的引用与放置;build 拷每块画板的背景图;
 * 烤好的画面按动作的进度换板、淡出(renderFrameSvg)。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actionState, boardAtSvgTime, circleHits, elementsAtSvgTime, finalBoard, frameAt, lessonClock, renderFrameSvg, resolveActions, sceneBounds, type BakedLesson } from '../src/core/index.ts';
import { checkScene } from '../src/cli/check.ts';
import { buildBundle, readBundle } from '../src/cli/build.ts';
import { sceneSchema } from '../src/schema/scene.ts';
import type { ChalkScene, ChalkSkeleton, ChalkStep } from '../src/player/types.ts';

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}: ${detail}`);
  }
}
const rules = (raw: unknown) => checkScene(raw).findings.map((f) => f.rule);
const errors = (raw: unknown) => checkScene(raw).findings.filter((f) => f.level === 'error');

// 读题(照片上画线、写字)→ 换白板 → 画两个圈、一条线 → 擦掉线 → 再写一个字
const line = (id: string, x: number, y: number, w = 100): ChalkSkeleton => ({ type: 'line', id, x, y, points: [[0, 0], [w, 0]], animateDuration: 400 });
const skeletons: ChalkSkeleton[] = [
  line('under', 10, 50),
  { type: 'text', id: 'note', x: 10, y: 60, text: '八 + 刀', fontSize: 24, animateDuration: 400 },
  { type: 'board', id: 'clean', animateDuration: 1000 },
  { type: 'ellipse', id: 'c1', x: 0, y: 0, width: 40, height: 40, animateDuration: 400 },
  { type: 'ellipse', id: 'c2', x: 60, y: 0, width: 40, height: 40, animateDuration: 400 },
  line('cut', 0, 50, 100),
  { type: 'erase', id: 'rub', targets: ['cut'], animateDuration: 800 },
  { type: 'text', id: 'ans', x: 10, y: 60, text: '6', fontSize: 24, animateDuration: 400 },
];
const steps: ChalkStep[] = [
  { step: 1, elementIds: ['under', 'note'], line: '读题', pauseAfter: true },
  { step: 2, elementIds: ['clean', 'c1', 'c2', 'cut'], line: '换白板,画圈,切一刀', pauseAfter: true },
  { step: 3, elementIds: ['rub', 'ans'], line: '擦掉线,写答案', pauseAfter: true },
];
const scene: ChalkScene = { id: 'acts', title: '动作', problem: '题', model: '点阵', template: 'paper-strict', background: { src: 'photo.png', width: 300, height: 200 }, skeletons, steps };

// ---- 谁擦了谁、谁在第几块画板 ----
{
  const r = resolveActions(skeletons, scene.background);
  check('两块画板:第一块是场景的背景图,第二块白板', r.boards.length === 2 && r.boards[0].background?.src === 'photo.png' && r.boards[1].id === 'clean' && !r.boards[1].background);
  check('board 动作算在旧板上;之后的在新板上', r.boardOf.get('note') === 0 && r.boardOf.get('clean') === 0 && r.boardOf.get('c1') === 1 && r.boardOf.get('ans') === 1);
  check('换画板擦掉旧板上的全部;erase 只擦 targets', JSON.stringify(r.targets.get('clean')) === '["under","note"]' && JSON.stringify(r.targets.get('rub')) === '["cut"]' && r.erasedBy.get('note') === 'clean' && r.erasedBy.get('cut') === 'rub' && !r.erasedBy.has('c1') && !r.problems.length, JSON.stringify(r.problems));
  const bad = resolveActions([line('a', 0, 0), { type: 'erase', id: 'e1', targets: ['b', 'nope', 'a'] }, line('b', 0, 0), { type: 'board', id: 'k' }, { type: 'erase', id: 'e2', targets: ['a', 'e1'] }]);
  const msgs = bad.problems.map((p) => p.message).join('\n');
  check('引用不对的都记下:后画的、不存在的、已经擦掉的(换画板时)、动作', /'b' 在它后面才画/.test(msgs) && /'nope' 不存在/.test(msgs) && /'a' 已经被 'e1' 擦掉了/.test(msgs) && /'e1' 是动作/.test(msgs), msgs);
  check('sceneBounds 不给动作算包围盒', !('clean' in sceneBounds(skeletons)) && 'c1' in sceneBounds(skeletons));
  const fin = finalBoard(skeletons, scene.background);
  check('finalBoard:最后一块板上没擦掉的画的元素,那块板的背景图(白板 = 没有)', JSON.stringify(fin.skeletons.map((e) => e.id)) === '["c1","c2","ans"]' && !fin.background);
  check('finalBoard:没换过画板 = 全部没擦掉的 + 场景背景图', finalBoard([line('a', 0, 0), line('b', 0, 0), { type: 'erase', id: 'e', targets: ['a'] }], scene.background).skeletons.map((e) => e.id).join() === 'b' && finalBoard([line('a', 0, 0)], scene.background).background?.src === 'photo.png');
}

// ---- 时钟 ----
const clock = lessonClock(skeletons, steps);
{
  const w = (id: string) => clock.elements.get(id)!;
  check('被擦的元素记下擦它的那段时间;动作和画一笔一样占时间', JSON.stringify(w('note').erased) === JSON.stringify({ start: w('clean').start, end: w('clean').end }) && w('cut').erased?.end === w('rub').end && w('clean').end - w('clean').start === 1000 && !w('c1').erased);
  check('换完画板的时刻', clock.boardSwitches?.length === 1 && clock.boardSwitches[0] === w('clean').end);
  const mid = w('clean').start + 500;
  const f = elementsAtSvgTime(clock, mid);
  check('换画板做到一半:旧板的还在、各剩一半;动作本身也在(progress 一半)', f.find((e) => e.id === 'note')?.fade === 0.5 && f.find((e) => e.id === 'clean')?.progress === 0.5 && boardAtSvgTime(clock, mid) === 0);
  const after = elementsAtSvgTime(clock, w('c1').start + 1);
  check('换完了:旧板的不在画面上,第二块画板', !after.some((e) => e.id === 'note' || e.id === 'under') && boardAtSvgTime(clock, w('c1').start + 1) === 1);
  const end = frameAt(clock, clock.total);
  check('课的结尾:擦掉的线不在,圈与答案在', end.board === 1 && !end.elements.some((e) => e.id === 'cut') && ['c1', 'c2', 'ans'].every((id) => end.elements.some((e) => e.id === id)));
  // 配音长:动作跟着拉伸
  const long = lessonClock(skeletons, steps.map((s, i) => (i === 1 ? { ...s, audioDurationMs: 4400 } : s)));
  check('配音拉伸时动作一起拉', long.elements.get('clean')!.end - long.elements.get('clean')!.start === 2000);
}

// ---- 圈住了什么:擦掉的不算 ----
{
  const ring = (cx: number, cy: number, r: number): [number, number][] => Array.from({ length: 24 }, (_, k) => [cx + r * Math.cos((k / 24) * Math.PI * 2), cy + r * Math.sin((k / 24) * Math.PI * 2)]);
  const s2 = clock.segments[1];
  const before = circleHits(clock, s2.start + s2.len - 1, ring(50, 50, 30));
  check('擦之前圈中间:圈住那条线', before.ids.includes('cut'), JSON.stringify(before.ids));
  const s3 = clock.segments[2];
  const after = circleHits(clock, s3.start + s3.len - 1, ring(50, 50, 30));
  check('擦掉以后圈同一处:不算那条线,也不算动作', !after.ids.includes('cut') && !after.ids.includes('rub'), JSON.stringify(after.ids));
  const board2 = circleHits(clock, s2.start + s2.len - 1, ring(40, 66, 30));
  check('换了画板:旧板上同一处的字不算', !board2.ids.includes('note'), JSON.stringify(board2.ids));
}

// ---- check ----
{
  const ok = errors(scene);
  check('合法的场景 0 错', ok.length === 0, ok.map((f) => f.message).join('\n'));
  check('新板上与旧板同一处的字、擦掉以后在同一处写的字,不报 text-overlap', !rules(scene).includes('text-overlap'));
  const overlap = { ...scene, skeletons: [...skeletons, { type: 'text', id: 'ans2', x: 12, y: 62, text: '7', fontSize: 24 }], steps: steps.map((s, i) => (i === 2 ? { ...s, elementIds: [...s.elementIds, 'ans2'] } : s)) };
  check('同一块板上同时在的字叠了照样报', rules(overlap).includes('text-overlap'));
  const badTarget = { ...scene, skeletons: skeletons.map((e) => (e.id === 'rub' ? { ...e, targets: ['ans'] } : e)) };
  check('擦后面才画的:erase-target', rules(badTarget).includes('erase-target'));
  check('擦旧板上的(换画板时已经擦掉):erase-target', rules({ ...scene, skeletons: skeletons.map((e) => (e.id === 'rub' ? { ...e, targets: ['note'] } : e)) }).includes('erase-target'));
  const firstBoard = { ...scene, skeletons: [{ type: 'board', id: 'b0' }, ...skeletons], steps: steps.map((s, i) => (i ? s : { ...s, elementIds: ['b0', ...s.elementIds] })) };
  check('第一笔就换画板:board-first', rules(firstBoard).includes('board-first'));
  check('画的元素缺 x / y:xy', rules({ ...scene, skeletons: skeletons.map((e) => (e.id === 'c1' ? { ...e, x: undefined } : e)) }).includes('xy'));
  check('静态场景不能有动作', rules({ ...scene, template: 'static', steps: [] }).includes('static-action'));
  check('动作在 steps 里照样要按笔顺覆盖', rules({ ...scene, steps: steps.map((s, i) => (i === 1 ? { ...s, elementIds: s.elementIds.slice(1) } : s)) }).includes('stroke-cover'));
  check('子场景里不能有动作', rules({ ...scene, blocks: [{ id: 'k', elementIds: ['c1'], text: 'x', subsceneId: 'pop' }], subscenes: [{ id: 'pop', skeletons: [line('p', 0, 0), { type: 'erase', id: 'pe', targets: ['p'] }] }] }).includes('subscene-action'));
  check('erase 的 targets 至少一个(schema)', errors({ ...scene, skeletons: skeletons.map((e) => (e.id === 'rub' ? { ...e, targets: [] } : e)) }).some((f) => f.rule === 'schema'));
  const outside = { ...scene, skeletons: skeletons.map((e) => (e.id === 'c2' ? { ...e, x: 500 } : e)) };
  check('白板上的东西不按旧板的照片查出界', !rules(outside).includes('background-bounds'));
  check('照片板上的照样查', rules({ ...scene, skeletons: skeletons.map((e) => (e.id === 'under' ? { ...e, x: 290 } : e)) }).includes('background-bounds'));
}

// ---- build:每块画板的背景图拷进课包 ----
{
  const dir = mkdtempSync(join(tmpdir(), 'drawtell-actions-'));
  try {
    writeFileSync(join(dir, 'photo.png'), 'a');
    writeFileSync(join(dir, 'page2.JPG'), 'b');
    const two: ChalkScene = sceneSchema.parse({ ...scene, skeletons: skeletons.map((e) => (e.id === 'clean' ? { ...e, background: { src: 'page2.JPG', width: 120, height: 80 } } : e)) });
    await buildBundle(two, join(dir, 'out'), dir);
    const sj = JSON.parse(readFileSync(join(dir, 'out', 'scene.json'), 'utf8')) as { skeletons: ChalkSkeleton[]; bounds: Record<string, unknown> };
    check('第二块画板的背景图拷成 background-<id>.<ext>,scene.json 里改写 src', existsSync(join(dir, 'out', 'background-clean.jpg')) && JSON.stringify(sj.skeletons.find((e) => e.id === 'clean')?.background) === JSON.stringify({ src: 'background-clean.jpg', width: 120, height: 80 }) && existsSync(join(dir, 'out', 'background.png')));
    check('scene.json 的 bounds 不带动作', !('clean' in sj.bounds) && !('rub' in sj.bounds));
    const back = await readBundle(dir, 'out');
    check('课包读回来:动作还在笔顺里', back.skeletons.map((e) => e.type).join() === skeletons.map((e) => e.type).join());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- 烤好的画面:按动作的进度换板、淡出 ----
{
  const g = (id: string, x: number) => ({ id, track: [[x, 0, 0], [x + 10, 0, 1]] as [number, number, number][], node: { tag: 'g', attrs: { transform: `translate(${x} 0)` }, children: [{ tag: 'path', attrs: { stroke: '#000', d: 'M0 0 L10 0' }, len: 10 }] } });
  const baked: BakedLesson = {
    schema: 'drawtell-bake', version: 2, source: { excalidraw: 'x', hash: 'h' },
    viewBox: [0, 0, 300, 200], offset: [0, 0], fonts: '', defs: '',
    background: { src: 'background.png', x: 0, y: 0, width: 300, height: 200 },
    boards: [
      { viewBox: [0, 0, 300, 200], background: { src: 'background.png', x: 0, y: 0, width: 300, height: 200 } },
      { viewBox: [500, 0, 120, 80] },
    ],
    elements: [
      g('a', 1),
      { id: 'k', node: { tag: 'g', attrs: {} }, track: [[0, 0, 0], [300, 0, 1]], eraser: true, action: 'board', targets: ['a'] },
      g('b', 2),
      { id: 'e', node: { tag: 'g', attrs: {} }, track: [[2, 0, 0], [12, 0, 1]], eraser: true, action: 'erase', targets: ['b'] },
    ],
  };
  const assetHref = (src: string) => `/b/${src}`;
  const st = actionState(baked, new Map([['a', 1], ['k', 0.25]]));
  check('actionState:换画板做到 1/4 = 还在旧板,旧板的东西与背景图剩 3/4', st.board === 0 && st.fade.get('a') === 0.75 && st.backgroundOpacity === 0.75);
  const mid = renderFrameSvg(baked, new Map([['a', 1], ['k', 0.25]]), { assetHref, pointer: true });
  check('换画板做着:旧视口、背景图与旧板的东西淡着、橡皮笔尖', mid.includes('viewBox="0 0 300 200"') && mid.includes('opacity="0.75"/>') && mid.includes('<g opacity="0.75"><g transform="translate(1 0)"') && /<image href="data:image\/svg\+xml[^"]*"/.test(mid));
  const next = renderFrameSvg(baked, new Map([['a', 1], ['k', 1], ['b', 1]]), { assetHref });
  check('换完了:新视口、没有背景图、旧板的不画', next.includes('viewBox="500 0 120 80"') && !next.includes('background.png') && !next.includes('translate(1 0)') && next.includes('translate(2 0)'));
  const rubbed = renderFrameSvg(baked, new Map([['a', 1], ['k', 1], ['b', 1], ['e', 1]]), { assetHref });
  check('擦完了:被擦的不画', !rubbed.includes('translate(2 0)'));
  check('没给 assetHref 时 backgroundHref 照旧管第 0 块画板', renderFrameSvg(baked, new Map(), { backgroundHref: '/x.png' }).includes('href="/x.png"'));
}

console.log(`${passed} 通过, ${failed} 失败`);
if (failed) process.exit(1);
