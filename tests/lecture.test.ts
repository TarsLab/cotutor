/**
 * 小课堂的纯函数(src/lib/lecture.ts):时钟用 drawtell/core(它自己的测试对过 timeline 与拉伸,这里只看接得对)、
 * 时间显示、上下文包的每句、一处圈说成一段话(时刻 + 那时在讲的那句 + drawtell 说圈住了什么;课包有分组就说组名)。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { computeStepWindows, frameAt } from 'drawtell/core';
import { DRAW_START_MS, clockLabel, describeMark, lectureAt, lectureClock, lectureLines, lectureRange, parseClock, parseLectureDoc, videoClock, type LectureSkeleton, type LectureStep } from '../src/lib/lecture.ts';
import { check, done } from './_check.ts';

const dir = fileURLToPath(new URL('./fixtures/bundles/2026-09-18-po13-jian-8/', import.meta.url));
const scene = JSON.parse(readFileSync(join(dir, 'scene.json'), 'utf8')) as { skeletons: LectureSkeleton[] };
const steps = (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { steps: LectureStep[] }).steps;
const clock = lectureClock(scene.skeletons, steps);

const wins = computeStepWindows(clock.skeletons, steps);
check('时钟是 drawtell 的:每段的笔画窗 = timeline 的窗;课的 0 对着 START_MS', clock.segments.every((s, i) => s.drawStart === wins[i].startMs && s.drawEnd === wins[i].endMs) && clock.segments[0].drawStart === DRAW_START_MS && clock.total > 40_000);
const s2 = clock.segments[1];
check('lectureAt:落在第二段、段内 500 毫秒、SVG 停在那步窗起点 + 500', JSON.stringify(lectureAt(clock, s2.start + 500)) === JSON.stringify({ index: 1, offset: 500, svgMs: s2.drawStart + 500 }));
check('某一刻的画面(frameAt):开头什么都还没画,结尾全在', frameAt(clock, 0).elements.length === 0 && frameAt(clock, clock.total).elements.length === scene.skeletons.length);

check('时间显示:分:秒,一小时以上带时', clockLabel(0) === '0:00' && clockLabel(65_400) === '1:05' && clockLabel(3_725_000) === '1:02:05');
const lines = lectureLines(clock);
check('上下文包的每句起点', lines.length === 6 && lines[0].startsWith('0:00 先看 13 减 8') && lines[1].startsWith(`${clockLabel(s2.start)} `), JSON.stringify(lines));

// ---- 圈(describeMark):时刻 + 那时在讲的那句 + drawtell 说圈住了什么 ----
const ring = (cx: number, cy: number, rx: number, ry: number): [number, number][] => Array.from({ length: 24 }, (_, k) => [Math.round(cx + rx * Math.cos((k / 24) * 2 * Math.PI)), Math.round(cy + ry * Math.sin((k / 24) * 2 * Math.PI))] as [number, number]);
const s3 = clock.segments[2];
{
  // 第 3 段(拆开一捆)中间,圈右边散的 3 根小棒(s-1..s-3,x 312–356,y 84–156)
  const d = describeMark(clock, { atMs: s3.start + 2000, path: ring(334, 120, 45, 50) });
  check('没有分组:「0:2x 圈的,那时在讲『…』;圈住了:第 1 步画的 3 条线(旁边写着『3』)」', d.text === `${clockLabel(s3.start + 2000)} 圈的,那时在讲『${steps[2].line}』;圈住了:第 1 步画的 3 条线(旁边写着『3』)` && JSON.stringify(d.ids) === JSON.stringify(['s-1', 's-2', 's-3']), d.text);
  const named = describeMark(clock, { atMs: s3.start + 2000, path: ring(334, 70, 52, 110) }, { groups: [{ id: 'loose', label: '散的 3 根小棒', elementIds: ['s-1', 's-2', 's-3'] }] });
  check('课包有分组:说组名,连上面的『3』', named.text.endsWith(';圈住了:散的 3 根小棒;文字『3』'), named.text);
  check('那一刻还没画到 / 太小:照实说', describeMark(clock, { atMs: 500, path: ring(130, 115, 85, 30) }).text.endsWith(';圈的地方那时还没画东西') && describeMark(clock, { atMs: 0, path: [[1, 1], [2, 2]] }).text.endsWith('圈得太小,看不出圈的是什么'));
}
{
  // 服务端读课包:分组与 bounds 从 scene.json、命中块从 manifest.json(drawtell build 就这么放)
  const { mkdtempSync, cpSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { readLecture } = await import('../src/server/lecture.ts');
  const tmp = mkdtempSync(join(tmpdir(), 'cotutor-lecture-pic-'));
  try {
    cpSync(dir, join(tmp, 'po'), { recursive: true });
    const sj = JSON.parse(readFileSync(join(dir, 'scene.json'), 'utf8')) as Record<string, unknown>;
    // 第一个元素挪 1 像素:画面改过、没重烤,bake.json 就不算数
    writeFileSync(join(tmp, 'po', 'scene.json'), JSON.stringify({ ...sj, skeletons: (sj.skeletons as { x: number }[]).map((e, i) => (i ? e : { ...e, x: e.x + 1 })), groups: [{ id: 'loose', label: '散的 3 根小棒', elementIds: ['s-1', 's-2', 's-3'] }, { bad: true }], bounds: { q: [0, 0, 1, 1] } }));
    const mj = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(tmp, 'po', 'manifest.json'), JSON.stringify({ ...mj, blocks: [{ id: 'k', elementIds: ['q'], text: '十三减八', audioSrc: 'a.mp3' }] }));
    const l = await readLecture({ dirs: { bundles: tmp } }, 'po');
    check('readLecture:groups(形状不对的丢掉)、bounds 从 scene.json,blocks 从 manifest.json;画面改过 → 烤的那份不算数', l?.picture.groups?.length === 1 && l.picture.blocks?.[0]?.text === '十三减八' && JSON.stringify(l.picture.bounds?.q) === '[0,0,1,1]' && l.baked === false, JSON.stringify(l?.picture));
    // 服务端出缩略图(frame.svg):烤过且画面对得上才出
    const { lectureFrameSvg, parseRing } = await import('../src/server/lecture.ts');
    const fresh = await readLecture({ dirs: { bundles: fileURLToPath(new URL('./fixtures/bundles/', import.meta.url)) } }, '2026-09-18-po13-jian-8');
    check('样本课包烤过:baked', fresh?.baked === true);
    const s3mid = clock.segments[2].drawStart + 2000;
    const svg = await lectureFrameSvg({ dirs: { bundles: fileURLToPath(new URL('./fixtures/bundles/', import.meta.url)) } }, '2026-09-18-po13-jian-8', s3mid, [[300, 80], [360, 80], [360, 160]]) ?? '';
    check('frame.svg:那一刻画到第 3 步一半(橙色斜线有、第 4 步的红圈没有),叠着蓝圈(加了平移),字体内嵌', svg.startsWith('<svg') && svg.includes('#e8590c') && !svg.includes('#e03131') && svg.includes('stroke="#2f6fd6"') && svg.includes('M284 94 L344 94') && svg.includes('@font-face'), svg.slice(0, 200));
    check('frame.svg:画面改过没重烤、id 不对 → null(页面退回自己克隆)', (await lectureFrameSvg({ dirs: { bundles: tmp } }, 'po', 2000)) === null && (await lectureFrameSvg({ dirs: { bundles: tmp } }, '../x', 2000)) === null);
    check('ring 参数:「x,y;x,y」,认不出来就当没有', JSON.stringify(parseRing('1,2;3,4')) === '[[1,2],[3,4]]' && parseRing('1,2;x').length === 0 && parseRing(null).length === 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
// ---- 老师放课里的一段:时间怎么认、起止怎么对齐 ----
check('时间:分:秒、时:分:秒;秒过 59、乱写的不认', parseClock('0:19') === 19_000 && parseClock('12:05') === 725_000 && parseClock('1:02:05') === 3_725_000 && parseClock('0:60') === null && parseClock('19') === null && parseClock('1:60:00') === null);
{
  const [s1, s2, s3, s4] = clock.segments;
  const r = lectureRange(clock, Math.floor(s3.start / 1000) * 1000, Math.floor(s4.start / 1000) * 1000);
  check('照 lines 抄的起止(取整到秒)对齐到段界:正好是第 3 段', r?.start === s3.start && r.end === s4.start, JSON.stringify({ r, s3: s3.start, s4: s4.start }));
  const only = lectureRange(clock, Math.floor(s2.start / 1000) * 1000, undefined);
  check('只写起点:放起点那一段', only?.start === s2.start && only.end === s3.start, JSON.stringify(only));
  const mid = lectureRange(clock, s1.start + 3000, s1.start + 5000);
  check('离段界远的照写的放(段中间也行)', mid?.start === 3000 && mid.end === 5000);
  check('都不写 = 整堂课;越界夹到课里;止不在起后 = null', JSON.stringify(lectureRange(clock, undefined, undefined)) === JSON.stringify({ start: 0, end: clock.total }) && lectureRange(clock, 0, 999_000)?.end === clock.total && lectureRange(clock, 20_000, 20_000) === null && lectureRange(lectureClock([], []), 0, 1000) === null);
}
{
  const { enrichLectures } = await import('../src/server/lecture.ts');
  const bundles = fileURLToPath(new URL('./fixtures/bundles/', import.meta.url));
  const sec = await enrichLectures({ dirs: { bundles } }, { cards: [{ kind: 'lecture', props: { bundle: '2026-09-18-po13-jian-8', from: 19_000, to: 30_000 } }, { kind: 'lecture', props: { bundle: '2026-01-01-gone', from: 0 } }, { kind: 'text', props: { text: 'x' } }], lines: [] });
  const [a, b, c] = sec.cards.map((x) => x.props as Record<string, unknown>);
  check('下发时补快照:课名、对齐后的起止、末帧停在 SVG 的哪一刻、ready;课包不在 ready: false;别的卡不动', a.title === '13 − 8 破十法' && a.start === clock.segments[2].start && a.end === clock.segments[3].start && (a.still as number) > clock.segments[2].drawStart && (a.still as number) <= clock.segments[2].drawEnd && a.ready === true && b.ready === false && !('start' in b) && c.text === 'x' && !('ready' in c), JSON.stringify({ a, b }));
}
// ---- 视频来源(第 4 步):lecture.md、视频的时钟、mp4 的时长、读盘 ----
{
  const doc = parseLectureDoc('---\nsubject: 数学\n---\n# 平均分\n\n<!-- 给人看 -->\n0:00 第一句\n0:05 第二句\n随手一行\n0:11 第三句\n');
  check('lecture.md:标题、科目、一行一句(起点与原话);认不出的行提醒、不算错', doc.title === '平均分' && doc.subject === '数学' && JSON.stringify(doc.chapters.map((c) => [c.start, c.line])) === JSON.stringify([[0, '第一句'], [5000, '第二句'], [11000, '第三句']]) && doc.issues.length === 1 && doc.issues[0].level === 'note' && doc.issues[0].line === 9, JSON.stringify(doc));
  const bad = parseLectureDoc('0:05 先说\n0:03 倒回去了\n');
  check('lecture.md:没标题要改、时间倒回去要改、第一句不从 0:00 起提醒', bad.issues.some((x) => x.level === 'fix' && x.text.includes('# 标题')) && bad.issues.some((x) => x.level === 'fix' && x.line === 2) && bad.issues.some((x) => x.level === 'note' && x.text.includes('0:05')), JSON.stringify(bad.issues));
  check('lecture.md:一句都没有要改', parseLectureDoc('# 只有标题\n').issues.some((x) => x.level === 'fix' && x.text.includes('一句都没有')));
  const vc = videoClock(doc.chapters, 18_000);
  check('视频的时钟:一句一段,最后一句到视频末尾;落在第几段照算', vc.total === 18_000 && JSON.stringify(vc.segments.map((x) => [x.start, x.len])) === JSON.stringify([[0, 5000], [5000, 6000], [11000, 7000]]) && lectureAt(vc, 12_000).index === 2 && lectureRange(vc, 5000, 11_000)?.end === 11_000);
  const late = videoClock([{ start: 3000, line: 'a' }, { start: 30_000, line: '超了' }], 18_000);
  check('第一句不从 0 起:前面补一段没话的;超过视频长度的那句不算', late.segments.length === 2 && late.segments[0].line === '' && late.segments[1].start === 3000 && late.segments[1].len === 15_000);
}
{
  const { mp4DurationMs } = await import('../src/server/mp4.ts');
  const { inspectLecture } = await import('../src/server/lecture.ts');
  const lectures = fileURLToPath(new URL('./fixtures/lectures/', import.meta.url));
  const bundles = fileURLToPath(new URL('./fixtures/bundles/', import.meta.url));
  check('mp4 的时长:读 moov/mvhd;不是 mp4 回 null', (await mp4DurationMs(join(lectures, '2026-10-06-pingjunfen', 'video.mp4'))) === 18_000 && (await mp4DurationMs(join(dir, 'scene.json'))) === null && (await mp4DurationMs('/nope.mp4')) === null);
  const v = await inspectLecture({ dirs: { bundles, lectures } }, '2026-10-06-pingjunfen');
  check('读视频小课堂:课名、科目、课长从 mp4、三句;视频', v.lecture?.video === true && v.lecture.title === '平均分:一个一个轮着分' && v.lecture.subject === '数学' && v.lecture.clock.total === 18_000 && v.lecture.clock.segments.length === 3 && !v.problems.length, JSON.stringify(v.problems));
  const b = await inspectLecture({ dirs: { bundles, lectures } }, '2026-09-18-po13-jian-8');
  const none = await inspectLecture({ dirs: { bundles, lectures } }, '2026-01-01-gone');
  check('同一个读法认课包(不是视频);两边都没有说清楚要什么', b.lecture?.video === false && none.lecture === null && none.problems[0].includes('bundles/2026-01-01-gone/ 与 lectures/2026-01-01-gone/ 都没有'), JSON.stringify(none.problems));
}
check('没有步的课包:空时钟', lectureClock(scene.skeletons, []).total === 0 && lectureAt(lectureClock([], []), 100).index === -1);
done();
