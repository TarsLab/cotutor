/** 小课堂的时钟(src/lib/lecture.ts):照 drawtell 的时间线算,和 drawtell 的原函数对;段长 = max(画, 配音);拖到任意一刻。 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { DRAW_START_MS, clockLabel, colorWord, describeMark, drawnAt, lectureAt, lectureClock, lectureLines, lectureRange, parseClock, parseLectureDoc, textBox, videoClock, type LectureSkeleton, type LectureStep } from '../src/lib/lecture.ts';
import { check, done } from './_check.ts';

const dir = fileURLToPath(new URL('./fixtures/bundles/2026-09-18-po13-jian-8/', import.meta.url));
const scene = JSON.parse(readFileSync(join(dir, 'scene.json'), 'utf8')) as { skeletons: LectureSkeleton[] };
const steps = (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { steps: LectureStep[] }).steps;
const clock = lectureClock(scene.skeletons, steps);

// drawtell 的原函数:包只导出整个播放器(带 React),按文件路径直接取时间线那个模块(它没有 import)
const tlFile = join(fileURLToPath(new URL('../node_modules/drawtell/', import.meta.url)), 'dist/player/timeline.js');
const tl = (await import(pathToFileURL(tlFile).href)) as {
  START_MS: number;
  computeStepWindows: (s: readonly LectureSkeleton[], st: readonly LectureStep[]) => { startMs: number; endMs: number }[];
  stretchToAudio: (s: readonly LectureSkeleton[], st: readonly LectureStep[]) => { skeletons: LectureSkeleton[] };
};
const theirs = tl.stretchToAudio(scene.skeletons, steps).skeletons;
const wins = tl.computeStepWindows(theirs, steps);
check('起点常量和 drawtell 一致', DRAW_START_MS === tl.START_MS);
check('拉伸后的笔画时长和 drawtell 一字不差', JSON.stringify(clock.skeletons.map((e) => e.animateDuration ?? null)) === JSON.stringify(theirs.map((e) => e.animateDuration ?? null)));
check('每步的笔画窗和 drawtell 一致', clock.segments.every((s, i) => s.drawStart === wins[i].startMs && s.drawEnd === wins[i].endMs), JSON.stringify({ ours: clock.segments.map((s) => [s.drawStart, s.drawEnd]), wins }));

check('六段,首尾相接', clock.segments.length === 6 && clock.segments.every((s, i) => s.start === (i ? clock.segments[i - 1].start + clock.segments[i - 1].len : 0)));
check('段长 = max(画, 配音):这份课包每步配音都比画长(拉伸封顶 5 倍也盖不住的才不等长)', clock.segments.every((s) => s.len === Math.max(s.drawEnd - s.drawStart, s.audioMs ?? 0)), JSON.stringify(clock.segments.map((s) => [s.len, s.drawEnd - s.drawStart, s.audioMs])));
check('课长 = 各段相加', clock.total === clock.segments.reduce((a, s) => a + s.len, 0) && clock.total > 40_000, String(clock.total));

const s2 = clock.segments[1];
const a = lectureAt(clock, s2.start + 500);
check('落在第二段、段内 500 毫秒、SVG 停在那步窗起点 + 500', a.index === 1 && a.offset === 500 && a.svgMs === s2.drawStart + 500, JSON.stringify(a));
const late = lectureAt(clock, s2.start + s2.len - 1);
check('段尾:SVG 不越过那步窗终点', late.index === 1 && late.svgMs <= s2.drawEnd - 0.5 && late.svgMs > s2.drawEnd - 3, JSON.stringify({ late, end: s2.drawEnd }));
{
  // 一笔 500 毫秒、配音 8 秒:拉到 5 倍封顶(2.5 秒)画完,剩下 5.5 秒画面定格、声音接着讲
  const c = lectureClock([{ id: 'a' }], [{ step: 1, elementIds: ['a'], line: '讲很久', audioDurationMs: 8000 }]);
  const s = c.segments[0];
  check('封顶 5 倍:画 2.5 秒、段长 8 秒', s.drawEnd - s.drawStart === 2500 && s.len === 8000, JSON.stringify(s));
  check('画完以后定格在窗终点前半毫秒', lectureAt(c, 6000).svgMs === s.drawEnd - 0.5 && lectureAt(c, 1000).svgMs === s.drawStart + 1000);
}
check('越界夹到两头', lectureAt(clock, -5).index === 0 && lectureAt(clock, clock.total + 9999).index === 5);

const at0 = drawnAt(clock, 0);
const atEnd = drawnAt(clock, clock.total);
check('开头只开始画第一笔;结尾全部画出', at0.length === 1 && at0[0] === scene.skeletons[0].id && atEnd.length === scene.skeletons.length, JSON.stringify({ at0, n: atEnd.length }));
const mid = drawnAt(clock, s2.start);
check('第二段开头:第一步的元素全在,第二步的还没(第一笔正要开始)', steps[0].elementIds.every((id) => mid.includes(id)) && steps[1].elementIds.filter((id) => mid.includes(id)).length <= 1, JSON.stringify(mid.length));

check('时间显示:分:秒,一小时以上带时', clockLabel(0) === '0:00' && clockLabel(65_400) === '1:05' && clockLabel(3_725_000) === '1:02:05');
const lines = lectureLines(clock);
check('上下文包的每句起点', lines.length === 6 && lines[0].startsWith('0:00 先看 13 减 8') && lines[1].startsWith(`${clockLabel(s2.start)} `), JSON.stringify(lines));
// ---- 圈(describeMark):课包坐标里的一圈 → 那一刻在讲哪句、圈住了什么 ----
const ring = (cx: number, cy: number, rx: number, ry: number): [number, number][] => Array.from({ length: 24 }, (_, k) => [Math.round(cx + rx * Math.cos((k / 24) * 2 * Math.PI)), Math.round(cy + ry * Math.sin((k / 24) * 2 * Math.PI))] as [number, number]);
const s3 = clock.segments[2];
{
  // 第 3 段(拆开一捆)中间,圈右边散的 3 根小棒(s-1..s-3,x 312–356,y 84–156)
  const d = describeMark(clock, { atMs: s3.start + 2000, path: ring(334, 120, 45, 50) });
  check('圈住散的 3 根:说那时在讲的那句、第 1 步画的 3 条线、旁边写着『3』', d.text.startsWith(`${clockLabel(s3.start + 2000)} 圈的,那时在讲『${steps[2].line}』;圈住了:`) && d.text.includes('第 1 步画的 3 条线(旁边写着『3』)') && JSON.stringify(d.ids) === JSON.stringify(['s-1', 's-2', 's-3']), d.text);
  const both = describeMark(clock, { atMs: s3.start + 2000, path: ring(334, 70, 52, 110) });
  check('连上面的『3』一起圈:文字在前、线在后,旁边的字已经算进去了就不再说', both.text.includes('圈住了:文字『3』;第 1 步画的 3 条线') && !both.text.includes('旁边写着'), both.text);
}
{
  // 第 4 段之后,圈那一捆里被划掉的几根:橙色的斜线按颜色说;框住它们的大框(只圈住了里面)不算
  const d = describeMark(clock, { atMs: clock.segments[3].start + 100, path: ring(130, 115, 85, 30) });
  check('一捆里的几根:第 1 步的黑线、第 3 步的橙色斜线分开说;外面的框没被圈住', d.text.includes('第 1 步画的 6 条线') && d.text.includes('第 3 步画的 8 条橙色的线') && !d.text.includes('框'), d.text);
}
{
  const early = describeMark(clock, { atMs: 1000, path: ring(130, 115, 85, 30) });
  check('那一刻还没画到的不算:开头一秒圈小棒那块,照实说还没画东西', early.text.endsWith(';圈的地方那时还没画东西') && !early.ids.length, early.text);
  const near = describeMark(clock, { atMs: clock.total, path: ring(300, 250, 12, 12) });
  check('圈在空白处:说离它最近的那样东西', near.text.includes(';没圈住东西,圈在') && near.text.endsWith('旁边'), near.text);
  const word = describeMark(clock, { atMs: clock.total, path: ring(515, 38, 22, 14) });
  check('一行字里圈了几个字:说整行字', word.text.includes('圈住了:文字『13 − 8 =』'), word.text);
  const blk = describeMark(clock, { atMs: clock.total, path: ring(515, 38, 22, 14) }, [{ id: 'b1', elementIds: ['q'], text: '十三减八' }]);
  check('有词级命中块:说块的字', blk.text.includes('文字『十三减八』'), blk.text);
  check('太小的圈:不猜', describeMark(clock, { atMs: 0, path: [[1, 1], [2, 2]] }).text.endsWith('圈得太小,看不出圈的是什么'));
}
check('颜色:红橙黄绿蓝紫说出来,黑灰不说', colorWord('#e03131') === '红' && colorWord('#e8590c') === '橙' && colorWord('#f08c00') === '橙' && colorWord('#fab005') === '黄' && colorWord('#2f9e44') === '绿' && colorWord('#1971c2') === '蓝' && colorWord('#6741d9') === '紫' && colorWord('#1e1e1e') === '' && colorWord('#868e96') === '' && colorWord('red') === '');
{
  const b = textBox({ id: 't', type: 'text', x: 450, y: 22, text: '13 − 8 =', fontSize: 28 });
  check('文字的宽是估的:和 drawtell 在浏览器里量的(111)差不多', Math.abs(b.maxX - b.minX - 111) < 12 && b.maxY - b.minY === 35, JSON.stringify(b));
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
