/** 白纸条(src/board/strip.ts 的 stripLayout、stripRead;状态在 src/board/lesson.ts):排在题的下沿、一样一样往下摆;孩子在上面画的说给老师。 */
import { STRIP_MIN_H, stripLayout, stripRead, toShape } from '../src/board/strip.ts';
import { lessonInit, lessonPage, lessonStep, lessonStrip } from '../src/board/lesson.ts';
import { LessonSchema, type Lesson, type LessonAct, type LessonEvent, type Strip } from '../src/schema/index.ts';
import { check, done } from './_check.ts';

const strip: Strip = { key: '例4', box: [80, 300, 900, 420], items: [{ kind: 'shape', kit: '点阵', params: { 行: '6', 每行: '6' }, size: '大' }, { kind: 'write', text: '6×6=36', size: '中' }] };
const lay = stripLayout(strip);
check('白纸条紧贴题的下沿、页宽、至少一屏高', lay.rect[1] > 420 && lay.rect[1] < 440 && lay.rect[0] === 0 && lay.rect[2] === 1000 && lay.rect[3] - lay.rect[1] >= STRIP_MIN_H, JSON.stringify(lay.rect));
const [dots, text] = lay.slots;
check('一样一样往下摆、居中;大号的点阵宽 760 以内', dots.box[1] > lay.rect[1] && text.box[1] > dots.box[3] && Math.abs((dots.box[0] + dots.box[2]) / 2 - 500) < 1 && dots.box[2] - dots.box[0] <= 760.5 && Math.abs((text.box[0] + text.box[2]) / 2 - 500) < 1, JSON.stringify(lay.slots.map((s) => s.box)));
check('写的字有字号;图形有缩放和原点', (text.font ?? 0) > 40 && (dots.scale ?? 0) > 0 && dots.scene?.skeletons.length === 36);
const many = stripLayout({ ...strip, items: Array.from({ length: 5 }, () => strip.items[0]) });
check('东西多了白纸条跟着长', many.rect[3] > lay.rect[3]);
const huge = stripLayout({ ...strip, items: [{ kind: 'write', text: '一二三四五六七八九十一二三四五六', size: '大' }] });
check('写的字太长:缩小字号,不出页', huge.slots[0].box[0] >= 0 && huge.slots[0].box[2] <= 1000);

// 孩子在点阵上圈一圈:页上的一笔换回点阵的坐标,点阵自己算大概
{
  // 第一行前 6 个点(点阵坐标 x 70..350, y 70)外面绕一圈,换到页上
  const ring: [number, number][] = Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return [210 + Math.cos(a) * 175, 70 + Math.sin(a) * 45] as [number, number]; });
  ring.push(ring[0]);
  const onPage = ring.map(([x, y]) => [dots.ox! + x * dots.scale!, dots.oy! + y * dots.scale!] as [number, number]);
  check('toShape 换得回来', Math.abs(toShape(dots, onPage)[0][0] - ring[0][0]) < 0.01);
  const said = stripRead(strip, [onPage, [[500, text.box[1] + 5], [520, text.box[1] + 20]]], {});
  check('说给老师:点阵上圈了一圈、里面大约 6 个;别处还写了几笔', said.length === 2 && said[0].startsWith('白纸条上的点阵:') && said[0].includes('圈了一圈,里面大约 6 个') && said[1].includes('1 笔'), JSON.stringify(said));
  check('什么都没做:不说', stripRead(strip, [], {}).length === 0);
  const comp: Strip = { key: '东南西北', box: [0, 100, 1000, 200], items: [{ kind: 'shape', kit: '方向盘', params: { 上: '北', 小人: '有' }, size: '中' }] };
  const turned = stripRead(comp, [], { '东南西北#0': 270 });
  check('方向盘转过:说现在前面是什么', turned.length === 1 && turned[0].includes('前面是东'), JSON.stringify(turned));
}

// 状态:白纸条上的笔跟着白纸条,收起来就不在页上;擦 全部 跟着没了
{
  const page: Extract<LessonAct, { k: '翻' }>['page'] = { id: '数学.pdf#6的乘法口诀', kind: 'book', src: '数学.pdf', title: '6的乘法口诀', pages: [50], cut: 0, layout: 'math', pick: false };
  const A = (act: LessonAct): LessonEvent => ({ t: 'act', act });
  const run = (l: Lesson, ...evs: LessonEvent[]): Lesson => evs.reduce(lessonStep, l);
  const l1 = run(lessonInit(), A({ k: '翻', page }), A({ k: '看', label: '例4', box: [80, 300, 900, 420] }), A({ k: '摆', kit: '点阵', params: { 行: '6', 每行: '6' }, size: '大' }));
  const l2 = run(l1, { t: 'stroke', pts: [[400, 600], [420, 640]], strip: '例4' }, { t: 'stroke', pts: [[100, 100], [120, 120]] }, { t: 'stroke', pts: [[1, 1]], strip: '别的' });
  const p2 = lessonPage(l2)!;
  check('落在开着的白纸条上的:记在白纸条下面;别的(写错的键也是)落在页上', p2.kid.stripInk['例4']?.length === 1 && p2.kid.ink.length === 2 && LessonSchema.safeParse(l2).success, JSON.stringify(p2.kid));
  const l3 = run(l2, A({ k: '看', label: '例3', box: [80, 100, 900, 200] }), { t: 'stroke', pts: [[400, 600], [420, 640]], strip: '例4' });
  check('白纸条收着时说是它的:不算(落在页上)', lessonPage(l3)!.kid.stripInk['例4'].length === 1 && lessonPage(l3)!.kid.ink.length === 3);
  const l4 = run(l2, { t: 'wipe' });
  check('擦掉:页上的和开着的白纸条上的都擦', lessonPage(l4)!.kid.ink.length === 0 && !lessonPage(l4)!.kid.stripInk['例4']);
  const l5 = run(l2, { t: 'turn', item: '例4#0', deg: 90 }, A({ k: '擦', all: true }));
  check('擦 全部:白纸条连孩子在上面画的、转的一起没了', lessonStrip(l5) === null && !lessonPage(l5)!.kid.stripInk['例4'] && !('例4#0' in lessonPage(l5)!.kid.turns));
}
done();
