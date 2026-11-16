/** 一节课的状态(src/board/lesson.ts 的 lessonStep):老师的动作、孩子的事各自怎么改它。做法同 player.test.ts 对 step。 */
import { LESSON_CAPS, lessonActs, lessonInit, lessonPage, lessonStep, lessonStrip } from '../src/board/lesson.ts';
import { LESSON_INK_MAX, LESSON_INK_POINTS, LESSON_MARKS_MAX, LESSON_PAGES_MAX, LESSON_PICK_MAX, LessonSchema, STRIP_ITEMS_MAX, type Box, type Lesson, type LessonAct, type LessonEvent } from '../src/schema/index.ts';
import { check, done } from './_check.ts';

const page = (title: string, extra: Partial<Extract<LessonAct, { k: '翻' }>['page']> = {}): Extract<LessonAct, { k: '翻' }>['page'] => ({ id: `数学.pdf#${title}`, kind: 'book', src: '数学.pdf', title, pages: [50, 51], cut: 40, layout: 'math', pick: false, ...extra });
const A = (act: LessonAct): LessonEvent => ({ t: 'act', act });
const run = (l: Lesson, ...evs: LessonEvent[]): Lesson => evs.reduce(lessonStep, l);
const B1: Box = [80, 300, 900, 420];
const B2: Box = [80, 700, 900, 820];
const valid = (l: Lesson): boolean => LessonSchema.safeParse(l).success;

check('上限和 schema 一样', LESSON_CAPS.PAGES_MAX === LESSON_PAGES_MAX && LESSON_CAPS.INK_MAX === LESSON_INK_MAX && LESSON_CAPS.INK_POINTS === LESSON_INK_POINTS && LESSON_CAPS.PICK_MAX === LESSON_PICK_MAX && LESSON_CAPS.MARKS_MAX === LESSON_MARKS_MAX && LESSON_CAPS.STRIP_ITEMS_MAX === STRIP_ITEMS_MAX);

// ——— 还没有页 ———
{
  const l0 = lessonInit();
  check('还没有页:孩子的事、要页的动作都不改', run(l0, { t: 'stroke', pts: [[1, 1], [2, 2]] }, { t: 'view', box: B1 }, A({ k: '圈', spots: [{ text: '井', box: B1 }] }), A({ k: '写', text: '1', size: '中' }), A({ k: '请', ops: ['圈'] })) === l0);
  check('空的一节课合 schema', valid(l0));
}

// ——— 翻 ———
const toc = run(lessonInit(), A({ k: '翻', page: page('目录', { pages: [3] }) }));
{
  const p = lessonPage(toc);
  check('翻:铺上这一课,老师的、孩子的一层空着,什么都没请', toc.at === '数学.pdf#目录' && p?.teacher.marks.length === 0 && p.kid.ink.length === 0 && p.open.length === 0 && valid(toc), JSON.stringify(toc));
}
const lesson = run(toc, A({ k: '翻', page: page('6的乘法口诀') }));
check('翻到一课:两页都留着,现在是新的', lesson.pages.length === 2 && lesson.at === '数学.pdf#6的乘法口诀' && lesson.look === null && lesson.view === null);

// ——— 看 ———
const look1 = run(lesson, A({ k: '看', label: '例4', box: B1 }));
check('看:记下看的那一处,第一次 n=1', look1.look?.label === '例4' && look1.look.n === 1 && look1.strip === null);
const look2 = run(look1, A({ k: '看', label: '例4', box: B1 }));
check('同一处再看一遍:n 加一(窗再移一次)', look2.look?.n === 2);

// ——— 圈、遮、盖 ———
{
  const l = run(look1, A({ k: '圈', spots: [{ text: '一共有多少', box: B1 }] }), A({ k: '盖', spots: [{ text: '6×4=24', box: B2 }, { text: '4×6=24', box: B1 }] }), A({ k: '圈', spots: [{ text: '一共有多少', box: B1 }] }));
  const m = lessonPage(l)!.teacher.marks;
  check('圈、盖:记号加在这一页上,同一处不重复', m.length === 3 && m[0].k === '圈' && m[1].k === '盖' && m[2].text === '4×6=24', JSON.stringify(m));
  const many = run(look1, ...Array.from({ length: LESSON_MARKS_MAX + 3 }, (_, i) => A({ k: '圈', spots: [{ text: `字${i}`, box: B1 }] })));
  check('记号多了丢最早的', lessonPage(many)!.teacher.marks.length === LESSON_MARKS_MAX && lessonPage(many)!.teacher.marks[0].text === '字3');
  // 擦:没开白纸条擦最后一个记号;擦 全部 都擦
  const e1 = run(l, A({ k: '擦', all: false }));
  check('擦:没开白纸条,擦老师最后一个记号', lessonPage(e1)!.teacher.marks.length === 2 && lessonPage(e1)!.teacher.marks[1].text === '6×4=24');
  check('擦 全部:没开白纸条,记号都擦', lessonPage(run(l, A({ k: '擦', all: true })))!.teacher.marks.length === 0);
  check('没有可擦的:原样', run(look1, A({ k: '擦', all: false })) === look1);
}

// ——— 白纸条:写、摆、擦,一道题一条 ———
{
  check('写:没在看哪道题就不做', run(lesson, A({ k: '写', text: '6×4=24', size: '中' })) === lesson);
  const s1 = run(look1, A({ k: '摆', kit: '点阵', params: { 行: '6', 每行: '6' }, size: '大' }), A({ k: '写', text: '6×6=36', size: '小' }));
  const st = lessonStrip(s1);
  check('摆、写:落进看着的那道题的白纸条(没有就开一条,贴着题)', s1.strip === '例4' && st?.key === '例4' && JSON.stringify(st.box) === JSON.stringify(B1) && st.items.length === 2 && st.items[0].kind === 'shape' && st.items[1].kind === 'write' && valid(s1), JSON.stringify(st));
  const s2 = run(s1, A({ k: '看', label: '练一练第1题', box: B2 }));
  check('看下一道:白纸条收起来,原来的还在', s2.strip === null && lessonStrip(s2) === null && lessonPage(s2)!.teacher.strips.length === 1);
  const s3 = run(s2, A({ k: '看', label: '例4', box: B1 }));
  check('回到这道题:白纸条又打开,原来摆的还在', s3.strip === '例4' && lessonStrip(s3)?.items.length === 2);
  const s4 = run(s3, A({ k: '擦', all: false }));
  check('擦:白纸条开着,擦它的最后一样', lessonStrip(s4)?.items.length === 1 && lessonStrip(s4)!.items[0].kind === 'shape');
  const s5 = run(s4, A({ k: '擦', all: false }));
  check('擦到空:白纸条收掉', s5.strip === null && lessonPage(s5)!.teacher.strips.length === 0);
  check('擦 全部:整条收掉', run(s3, A({ k: '擦', all: true })).strip === null && lessonPage(run(s3, A({ k: '擦', all: true })))!.teacher.strips.length === 0);
  const full = run(look1, ...Array.from({ length: STRIP_ITEMS_MAX + 2 }, (_, i) => A({ k: '写', text: String(i), size: '中' })));
  check('白纸条多了丢最早的一样', lessonStrip(full)!.items.length === STRIP_ITEMS_MAX && (lessonStrip(full)!.items[0] as { text: string }).text === '2');
  // 白纸条开着时圈:还是圈在页上(擦先擦白纸条)
  const ring = run(s1, A({ k: '圈', spots: [{ text: '6', box: B1 }] }), A({ k: '擦', all: false }));
  check('白纸条开着时擦:先擦白纸条,不擦记号', lessonStrip(ring)?.items.length === 1 && lessonPage(ring)!.teacher.marks.length === 1);
}

// ——— 请 ———
{
  const r1 = run(look1, A({ k: '请', ops: ['圈', '写'] }));
  check('请:这一步开放什么', JSON.stringify(lessonPage(r1)!.open) === '["圈","写"]');
  const r2 = run(r1, A({ k: '请', ops: ['转'] }));
  check('再请:换掉上一次请的', JSON.stringify(lessonPage(r2)!.open) === '["转"]');
  const r3 = run(r1, A({ k: '翻', page: page('7的乘法口诀') }));
  check('翻到新的一课:什么都没请', lessonPage(r3)!.open.length === 0);
}

// ——— 孩子的事 ———
{
  const k1 = run(look1, { t: 'stroke', pts: [[100, 320], [140, 360]] }, { t: 'stroke', pts: [[200, 320]] }, { t: 'stroke', pts: [] });
  check('一笔:落在这一页上(空的不算)', lessonPage(k1)!.kid.ink.length === 2);
  check('擦掉自己画的', lessonPage(run(k1, { t: 'wipe' }))!.kid.ink.length === 0);
  const long = run(look1, { t: 'stroke', pts: Array.from({ length: LESSON_INK_POINTS + 50 }, (_, i) => [i, i] as [number, number]) });
  check('一笔的点多了截掉', lessonPage(long)!.kid.ink[0].length === LESSON_INK_POINTS);
  const lots = run(look1, ...Array.from({ length: LESSON_INK_MAX + 5 }, (_, i): LessonEvent => ({ t: 'stroke', pts: [[i, i]] })));
  check('笔多了丢最早的', lessonPage(lots)!.kid.ink.length === LESSON_INK_MAX && lessonPage(lots)!.kid.ink[0][0][0] === 5 && valid(lots));
  const r = run(look1, { t: 'reveal', text: '6×4=24' }, { t: 'reveal', text: '6×4=24' }, { t: 'pick', text: '傍' }, { t: 'pick', text: '傍' });
  check('揭开记一次;点字照先后都记', JSON.stringify(lessonPage(r)!.kid.revealed) === '["6×4=24"]' && lessonPage(r)!.kid.picked.length === 2);
  check('窗停在哪', JSON.stringify(run(look1, { t: 'view', box: B2 }).view) === JSON.stringify(B2));
  const t = run(look1, { t: 'turn', item: '例4#0', deg: -90 }, { t: 'turn', item: '例4#1', deg: 450 });
  check('白纸条里的图形转到多少度(0–359)', lessonPage(t)!.kid.turns['例4#0'] === 270 && lessonPage(t)!.kid.turns['例4#1'] === 90);
  const back = run(k1, A({ k: '翻', page: page('7的乘法口诀') }), A({ k: '翻', page: page('6的乘法口诀') }));
  check('翻走再翻回来:原来画的都在;窗回到页顶', lessonPage(back)!.kid.ink.length === 2 && back.look === null);
  check('孩子的事改的都合 schema', valid(k1) && valid(r) && valid(t));
}

// ——— 页多了丢最早的(不是现在这一页) ———
{
  const many = run(lessonInit(), ...Array.from({ length: LESSON_PAGES_MAX + 2 }, (_, i) => A({ k: '翻', page: page(`第${i}课`) })));
  check('页多了丢最早的', many.pages.length === LESSON_PAGES_MAX && many.at === `数学.pdf#第${LESSON_PAGES_MAX + 1}课` && many.pages[0].title === '第2课');
}

// ——— 一节的动作照先后落 ———
{
  const l = lessonActs(lesson, [{ do: { k: '看', label: '例4', box: B1 } }, {}, { do: { k: '摆', kit: '点阵', params: { 行: '6', 每行: '6' }, size: '中' } }]);
  check('lessonActs:带 do 的照先后落,没落上的跳过', l.look?.label === '例4' && lessonStrip(l)?.items.length === 1);
}
done();
