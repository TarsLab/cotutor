/** 一节课的状态(src/board/lesson.ts 的 lessonStep):老师的动作、孩子的事各自怎么改它。做法同 player.test.ts 对 step。 */
import { LESSON_CAPS, lessonActs, lessonSection, markFresh, photoSheetBox, lessonDone, lessonInit, lessonPage, lessonStep, lessonStrip } from '../src/board/lesson.ts';
import { LESSON_CELLS_MAX, LESSON_CELL_STROKES, LINE_MARKS, MARKS_NEW_MAX, MARK_FRESH_LINES, LESSON_JOBS_MAX, LESSON_INK_MAX, LESSON_INK_POINTS, LESSON_MARKS_MAX, LESSON_PAGES_MAX, LESSON_PICK_MAX, LessonSchema, PHOTO_PAGE, STRIP_ITEMS_MAX, WHITE_PAGE, type Box, type Lesson, type LessonAct, type LessonEvent, type PageSource } from '../src/schema/index.ts';
import { check, done } from './_check.ts';

const page = (title: string, extra: Partial<Extract<PageSource, { kind: 'book' }>> = {}): Extract<PageSource, { kind: 'book' }> => ({ id: `数学.pdf#${title}`, kind: 'book', src: '数学.pdf', title, pages: [50, 51], cut: 40, layout: 'math', pick: false, ...extra });
const A = (act: LessonAct): LessonEvent => ({ t: 'act', act });
const run = (l: Lesson, ...evs: LessonEvent[]): Lesson => evs.reduce(lessonStep, l);
const B1: Box = [80, 300, 900, 420];
const B2: Box = [80, 700, 900, 820];
const valid = (l: Lesson): boolean => LessonSchema.safeParse(l).success;

check('上限和 schema 一样', LESSON_CAPS.PAGES_MAX === LESSON_PAGES_MAX && LESSON_CAPS.INK_MAX === LESSON_INK_MAX && LESSON_CAPS.INK_POINTS === LESSON_INK_POINTS && LESSON_CAPS.PICK_MAX === LESSON_PICK_MAX && LESSON_CAPS.MARKS_MAX === LESSON_MARKS_MAX && LESSON_CAPS.STRIP_ITEMS_MAX === STRIP_ITEMS_MAX && LESSON_CAPS.JOBS_MAX === LESSON_JOBS_MAX && LESSON_CAPS.PHOTO_PAGE === PHOTO_PAGE && LESSON_CAPS.WHITE_PAGE === WHITE_PAGE && LESSON_CAPS.LINE_MARKS.join() === LINE_MARKS.join() && LESSON_CAPS.MARKS_NEW_MAX === MARKS_NEW_MAX && LESSON_CAPS.MARK_FRESH_LINES === MARK_FRESH_LINES && LESSON_CAPS.CELLS_MAX === LESSON_CELLS_MAX && LESSON_CAPS.CELL_STROKES === LESSON_CELL_STROKES);

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
  check('圈、盖:记号加在这一页上,同一处不重复;再圈一遍挪到最后', m.length === 3 && m[0].k === '盖' && m[1].text === '4×6=24' && m[2].k === '圈' && m[2].at === 0 && m[0].at === undefined, JSON.stringify(m));
  const many = run(look1, ...Array.from({ length: LESSON_MARKS_MAX + 3 }, (_, i) => A({ k: '圈', spots: [{ text: `字${i}`, box: B1 }] })));
  check('记号多了丢最早的', lessonPage(many)!.teacher.marks.length === LESSON_MARKS_MAX && lessonPage(many)!.teacher.marks[0].text === '字3');
  // 擦:没开白纸条擦最后一个记号;擦 全部 都擦
  const e1 = run(l, A({ k: '擦', all: false }));
  check('擦:没开白纸条,擦老师最后一个记号', lessonPage(e1)!.teacher.marks.length === 2 && lessonPage(e1)!.teacher.marks.every((x) => x.k === '盖'));
  check('擦 全部:没开白纸条,记号都擦', lessonPage(run(l, A({ k: '擦', all: true })))!.teacher.marks.length === 0);
  check('没有可擦的:原样', run(look1, A({ k: '擦', all: false })) === look1);
}

// ——— 圈、划、加点跟着话走(docs/dev/一节课.md) ———
{
  const ring = (text: string, box: Box = B1): LessonEvent => A({ k: '圈', spots: [{ text, box }] });
  const said: LessonEvent = { t: 'said' };
  const fr = (l: Lesson): string => lessonPage(l)!.teacher.marks.map((m, i) => `${m.text}:${markFresh(l, lessonPage(l)!)[i] ? '新' : '旧'}`).join(' ');
  // 第 1 句圈甲,第 2 句圈乙,第 3 句圈丙、丁
  const s1 = run(look1, ring('甲'), said);
  const s2 = run(s1, ring('乙'), said);
  const s3 = run(s2, ring('丙'), ring('丁'), said);
  check('记下画它时念完几句(at),念完一句 said 加一', lessonPage(s1)!.teacher.marks[0].at === 0 && s1.said === 1 && s3.said === 3 && valid(s3));
  check('画它那一句和下一句是新的', fr(s2) === '甲:新 乙:新');
  check('再往后是旧的', fr(s3) === '甲:旧 乙:新 丙:新 丁:新', fr(s3));
  const s4 = run(s3, ring('戊'));
  check('新的最多 3 处:多的最早那几处算旧的', fr(s4) === '甲:旧 乙:旧 丙:新 丁:新 戊:新', fr(s4));
  const hua = run(look1, A({ k: '划', spots: [{ text: '长句', box: B1 }, { text: '长句', box: B2 }] }), ring('一'), ring('二'));
  check('划一句跨行的几截算一处', fr(hua) === '长句:新 长句:新 一:新 二:新', fr(hua));
  const again = run(s3, said, said, ring('甲'));
  check('再圈一遍:挪到最后、算新的', fr(again).endsWith('甲:新'), fr(again));
  const cov = run(s3, A({ k: '盖', spots: [{ text: '答案', box: B2 }] }), said, said, said);
  const round = run(cov, { t: 'round' });
  check('新的一轮:上一轮的圈、划、加点都收,遮、盖留着', lessonPage(round)!.teacher.marks.map((m) => m.k).join() === '盖' && markFresh(round, lessonPage(round)!)[0]);
  check('没有圈的时候新的一轮:原样', run(lesson, { t: 'round' }) === lesson);
  const away = run(cov, A({ k: '看', label: '练一练第1题', box: B2 }));
  check('看别处:这一页上老师的圈、划、加点收掉,遮、盖留着', lessonPage(away)!.teacher.marks.map((m) => m.k).join() === '盖');
  check('看同一处:不收', lessonPage(run(cov, A({ k: '看', label: '例4', box: B1 })))!.teacher.marks.length === 5);
  const turned = run(cov, A({ k: '翻', page: page('5的乘法口诀') }));
  const back = run(turned, A({ k: '翻', page: page('6的乘法口诀') }));
  check('翻走:离开的那一页上的圈收掉,翻回来不重画', lessonPage(back)!.teacher.marks.map((m) => m.k).join() === '盖');
  // 服务端整节落(lessonSection)和孩子端一句一句落,结果一样
  const sec = { acts: [{ do: { k: '看', label: '例4', box: B1 } as LessonAct }], lines: [{ acts: [{ do: { k: '圈', spots: [{ text: '甲', box: B1 }] } as LessonAct }] }, {}, { acts: [{ do: { k: '划', spots: [{ text: '乙', box: B2 }] } as LessonAct }] }] };
  const whole = lessonSection(s3, sec);
  const byLine = run(lessonActs(run(s3, { t: 'round' }), sec.acts), ...sec.lines.flatMap((x) => [...(x.acts ?? []).map((a) => A(a.do)), said]));
  check('整节落和一句一句落一样', JSON.stringify(whole) === JSON.stringify(byLine) && whole.said === 6 && fr(whole) === '甲:旧 乙:新', fr(whole));
  check('没带动作的一节:只收上一轮的', JSON.stringify(lessonSection(s3, { lines: [{}, {}] })) === JSON.stringify(run(s3, { t: 'round' })));
}

// ——— 田字格里写的字(孩子的一层;「擦掉」不擦它) ———
{
  const st: [number, number][][] = [[[100, 100], [900, 900]]];
  const c1 = run(look1, { t: 'cell', id: '50.2', strokes: st }, { t: 'cell', id: '50.3', strokes: [...st, ...st] });
  check('写好一格:这一格的笔画记下', lessonPage(c1)!.kid.cells?.['50.2']?.length === 1 && lessonPage(c1)!.kid.cells?.['50.3']?.length === 2 && valid(c1));
  const c2 = run(c1, { t: 'cell', id: '50.2', strokes: [...st, ...st, ...st] });
  check('同一格再放好:整个换掉', lessonPage(c2)!.kid.cells?.['50.2']?.length === 3);
  const c3 = run(c2, { t: 'cell', id: '50.3', strokes: [] });
  check('放好空的:这一格擦干净(键拿掉)', !('50.3' in (lessonPage(c3)!.kid.cells ?? {})) && valid(c3));
  check('「擦掉」不擦田字格里的字', lessonPage(run(c3, { t: 'stroke', pts: [[1, 1], [2, 2]] }, { t: 'wipe' }))!.kid.cells?.['50.2']?.length === 3);
  check('没写过的格放好空的:原样', run(look1, { t: 'cell', id: '9.9', strokes: [] }) === look1);
  const many = run(look1, ...Array.from({ length: LESSON_CAPS.CELLS_MAX + 2 }, (_, i): LessonEvent => ({ t: 'cell', id: `1.${i}`, strokes: st })));
  check('写满了丢最早写的那一格', Object.keys(lessonPage(many)!.kid.cells ?? {}).length === LESSON_CAPS.CELLS_MAX && !('1.0' in (lessonPage(many)!.kid.cells ?? {})));
  check('一格最多几笔', lessonPage(run(look1, { t: 'cell', id: '1.1', strokes: Array.from({ length: LESSON_CELL_STROKES + 5 }, () => st[0]) }))!.kid.cells?.['1.1']?.length === LESSON_CELL_STROKES);
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

// ——— 落进来过的那几轮 ———
{
  const d = lessonDone(lessonDone(lessonInit(), 'j1'), 'j1');
  check('lessonDone:记下这一节,同一节不重记', JSON.stringify(d.jobs) === '["j1"]' && valid(d));
  const many = Array.from({ length: LESSON_JOBS_MAX + 3 }, (_, i) => `j${i}`).reduce(lessonDone, lessonInit());
  check('几轮多了丢最早的', many.jobs.length === LESSON_JOBS_MAX && many.jobs[0] === 'j3');
}

// ——— 一节的动作照先后落 ———
{
  const l = lessonActs(lesson, [{ do: { k: '看', label: '例4', box: B1 } }, {}, { do: { k: '摆', kit: '点阵', params: { 行: '6', 每行: '6' }, size: '中' } }]);
  check('lessonActs:带 do 的照先后落,没落上的跳过', l.look?.label === '例4' && lessonStrip(l)?.items.length === 1);
}
// ——— 照片页、白纸页(阶段 3) ———
{
  const p1 = { src: 'captures/a.jpg', w: 2000, h: 1500 }, p2 = { src: 'captures/b.jpg', w: 1000, h: 1000 };
  const one = run(lessonInit(), { t: 'photo', photos: [p1], pick: true });
  const op = lessonPage(one);
  check('拍来一张:开一页照片页,铺上、窗移到它的顶上(当老师看了它)', one.at === PHOTO_PAGE && op?.kind === 'photo' && op.photos.length === 1 && op.pick && one.look?.label === '第1张' && one.look.n === 1 && valid(one), JSON.stringify(one));
  const both = run(one, { t: 'photo', photos: [p2, p1], pick: true });
  const bp = lessonPage(both);
  check('再拍一张:接在后面(拍过的不重复),窗移到新的那张', bp?.kind === 'photo' && bp.photos.map((x) => x.src).join() === 'captures/a.jpg,captures/b.jpg' && both.look?.label === '第2张' && both.look.box[1] === 780, JSON.stringify(both.look));
  check('照片一张一张从上往下连着:一张宽 1000,中间空 30', JSON.stringify(photoSheetBox([p1, p2], 1)) === '[0,780,1000,1780]');
  const full = run(lessonInit(), { t: 'photo', photos: Array.from({ length: 20 }, (_, i) => ({ src: `captures/${i}.jpg`, w: 10, h: 10 })), pick: true });
  check('张数不限;宽高不对的不收', (lessonPage(full) as { photos: unknown[] }).photos.length === 20 && LessonSchema.safeParse(full).success && run(lessonInit(), { t: 'photo', photos: [{ src: 'x', w: 0, h: 10 }], pick: true }).at === null);
  const day = run(lessonInit(), { t: 'photo', photos: [{ src: 'captures/a.jpg', w: 10, h: 10 }], pick: true, day: '2026-11-23' });
  const dp = lessonPage(day) as { title: string; day?: string };
  check('带 day 新开的照片页是作业本今天这一章:章名「11月23日」', dp.title === '11月23日' && dp.day === '2026-11-23' && LessonSchema.safeParse(day).success);
  const white = run(both, A({ k: '翻', page: { id: WHITE_PAGE, kind: 'white', title: WHITE_PAGE, pick: false } }), A({ k: '写', text: '23 + 18 =', size: '大' }), A({ k: '摆', kit: '点阵', params: { 行: '2', 每行: '9' }, size: '中' }));
  check('白纸页:不用先看,写、摆都落在整页那一条白纸条上', white.at === WHITE_PAGE && lessonStrip(white)?.key === WHITE_PAGE && lessonStrip(white)?.items.length === 2 && valid(white), JSON.stringify(white.pages.map((p) => p.id)));
  const back = run(white, { t: 'photo', photos: [], pick: true });
  check('没拍新的:回到照片页', back.at === PHOTO_PAGE);
  const again = run(back, A({ k: '翻', page: { id: WHITE_PAGE, kind: 'white', title: WHITE_PAGE, pick: false } }));
  check('翻回白纸页:原来写的都在,白纸条开着', again.strip === WHITE_PAGE && lessonStrip(again)?.items.length === 2);
}
done();
