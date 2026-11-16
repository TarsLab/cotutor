/** 讲稿里的动作落到页上(src/board/lesson-fit.ts):照页的文字层找框、先翻再看、落不了的记一句;铺着页的一节卡都不上页。书是 tests/_math-book.ts 造的,照片认出的字写在这里。 */
import { bookPageOf, fitActs, fitSection, lessonOpen, pageSection, sectionActs, whitePage } from '../src/board/lesson-fit.ts';
import { lessonInit, lessonPage, lessonStep, lessonStrip } from '../src/board/lesson.ts';
import { parseBoard } from '../src/board/parse.ts';
import type { Lesson, LineAct } from '../src/schema/index.ts';
import { mathIndexOf } from './_math-book.ts';
import { check, done } from './_check.ts';

const book = { file: '数学二年级上册.pdf', index: mathIndexOf() };
const src = { book };
const A = (name: LineAct['name'], arg = ''): LineAct => ({ name, arg });

// ——— 一课当一页 ———
const toc = bookPageOf(book, null);
check('目录当一页:id 是「册子#目录」,数学不开点字', toc?.id === '数学二年级上册.pdf#目录' && toc.title === '目录' && toc.layout === 'math' && toc.pick === false && toc.pages.join() === '1', JSON.stringify(toc));
const five = bookPageOf(book, '5的乘法口诀');
check('一课:照目录找到铺哪几页', five?.title === '5的乘法口诀' && five.pages.length >= 1 && five.cut >= 0, JSON.stringify(five));
check('没有这一课:null', bookPageOf(book, '没有这一课') === null);
const opened = lessonOpen(lessonInit(), book);
check('还没有页:先铺目录;有页就不动', opened.at === '数学二年级上册.pdf#目录' && lessonOpen(opened, book) === opened);

// ——— 动作照先后落 ———
{
  const r = fitActs(opened, [A('翻', '5的乘法口诀'), A('看', '例 2'), A('盖', '5×1=5'), A('圈', '没有的字、5×1=5'), A('请', '圈、写')], src);
  const [fan, look, cover, ring, ask] = r.acts;
  check('翻:换成这一课的页', fan.do?.k === '翻' && fan.do.page.title === '5的乘法口诀');
  check('先翻再看:看的是新的那一课,换成框', look.do?.k === '看' && look.do.label === '例2' && look.do.box.length === 4, JSON.stringify(look));
  check('盖:照课本找到框', cover.do?.k === '盖' && cover.do.spots[0].text === '5×1=5');
  check('圈:找得到的那一处落,找不到的记一句', ring.do?.k === '圈' && ring.do.spots.length === 1 && r.why.length === 1 && r.why[0].includes('做了一部分') && r.why[0].includes('没有的字'), JSON.stringify([ring, r.why]));
  check('请:照写的', ask.do?.k === '请' && ask.do.ops.join() === '圈,写');
  check('落完的样子:这一课、看着例 2、盖着、请了圈和写', r.lesson.at === '数学二年级上册.pdf#5的乘法口诀' && r.lesson.look?.label === '例2' && lessonPage(r.lesson)!.teacher.marks.length === 2 && lessonPage(r.lesson)!.open.join() === '圈,写');
}
{
  const r = fitActs(opened, [A('翻', '没有这一课'), A('看', '例 9'), A('写', '5×2=10'), A('圈', '没有的字')], src);
  check('落不了的:不带 do,一处记一句(说清动作和原因)', r.acts.every((a) => !a.do) && r.why.length === 4 && r.why[0].includes('[[翻 没有这一课]]') && r.why[2].includes('看'), JSON.stringify(r.why));
  check('落不了的不改这节课', r.lesson === opened);
  const none = fitActs(lessonInit(), [A('看', '例 2'), A('翻', '6的乘法口诀')], { book: null });
  check('没有课本:看、翻课都落不了', none.acts.every((a) => !a.do) && none.why.length === 2 && none.why[1].includes('能翻的:白纸、作业'), JSON.stringify(none.why));
}
{
  // 白纸条:先看一道题,再摆、写
  const at = fitActs(opened, [A('翻', '6的乘法口诀'), A('看', '例 4'), A('摆', '点阵 6 行 6 个'), A('写', '大 6×6=36'), A('擦')], src);
  const strip = lessonStrip(fitActs(opened, at.acts.slice(0, 4).map(({ name, arg }) => ({ name, arg })), src).lesson);
  check('摆、写落进看着的那道题的白纸条', at.acts[2].do?.k === '摆' && at.acts[3].do?.k === '写' && strip?.key === '例4' && strip.items.length === 2 && at.why.length === 0, JSON.stringify([at.acts, at.why]));
  check('擦:落成擦上一样', at.acts[4].do?.k === '擦' && at.acts[4].do.all === false && lessonStrip(at.lesson)?.items.length === 1);
}

// ——— 一节里的动作 ———
{
  const parsed = parseBoard('[[翻 5的乘法口诀]]\n我们看例 2。[[看 例 2]]\n先别看答案。[[盖 5×1=5]] [[请 圈]]\n这里没有。[[圈 没有的字]]\n');
  const f = fitSection(parsed.section, opened, src);
  check('fitSection:第一句前面的先落,再一句一句', f.section.acts?.[0].do?.k === '翻' && f.section.lines[0].acts?.[0].do?.k === '看' && f.section.lines[1].acts?.every((a) => a.do) === true && !f.section.lines[2].acts?.[0].do && f.why.length === 1, JSON.stringify([f.section, f.why]));
  const acts = sectionActs(f.section);
  check('sectionActs:落好的照先后排', acts.map((a) => a.k).join() === '翻,看,盖,请');
  const after = acts.reduce((s: Lesson, a) => lessonStep(s, { t: 'act', act: a }), opened);
  check('照它落进状态', after.look?.label === '例2' && lessonPage(after)!.open.join() === '圈');
  check('没有动作的一节原样', fitSection(parseBoard('你好。\n').section, opened, src).section.lines[0].acts === undefined);
}

// ——— 铺着页的一节:卡都不上页;数学课本上请点字不开 ———
{
  const raw = pageSection({ cards: [{ kind: 'image', props: { src: 'a.png' } }], lines: [{ text: '看例 2。', audio: null, marks: [], ask: false, anchor: 0, cues: [] }] });
  check('卡都撤掉,讲稿的锚跟着没了', raw.dropped.length === 1 && raw.section.cards.length === 0 && raw.section.lines[0].anchor === null);
  const f = fitActs(fitActs(opened, [A('翻', '5的乘法口诀')], src).lesson, [A('请', '点、圈')], src);
  check('数学课本上请点字:点字不开,圈照开,记一句', (f.acts[0].do as { ops: string[] }).ops.join() === '圈' && f.why.some((w) => w.includes('不能点字')), JSON.stringify(f));
}
// ——— 照片页:认出的题、字;白纸页 ———
{
  const ph = { src: 'captures/2026-11-16/1900-1.jpg', w: 2000, h: 1500 };
  const photos = { [ph.src]: { items: [], lines: [{ text: '3.心理辅导室的东面有(  )。', box: [100, 300, 700, 340] as const }], questions: [{ no: '3', box: [80, 280, 920, 600] as const }] } };
  const withPhoto = lessonStep(lessonInit(), { t: 'photo', photos: [ph], pick: false });
  const r = fitActs(withPhoto, [A('看', '第 3 题'), A('圈', '心理辅导室'), A('摆', '方向盘 上 东'), A('看', '第 9 题'), A('看', '第 1 张')], { book: null, photos });
  check('照片页:看第 3 题是题框;圈照认出的行找到;摆进那道题的白纸条', r.acts[0].do?.k === '看' && JSON.stringify((r.acts[0].do as { box: number[] }).box) === '[80,210,920,450]' && r.acts[1].do?.k === '圈' && r.acts[2].do?.k === '摆', JSON.stringify(r.acts.slice(0, 3)));
  check('照片页:认不出的题落不了,说一句;整张写「第 1 张」', !r.acts[3].do && r.why.some((w) => w.includes('第 9 题') && w.includes('认出的题')) && r.acts[4].do?.k === '看' && (r.acts[4].do as { label: string }).label === '第1张', JSON.stringify(r.why));
  const two = lessonStep(withPhoto, { t: 'photo', photos: [{ src: 'captures/2026-11-16/1900-2.jpg', w: 1000, h: 1000 }], pick: false });
  const t2 = fitActs(two, [A('看', '第 2 张第 3 题'), A('看', '第 1 张第 3 题')], { book: null, photos });
  check('两张都可能有第 3 题:写「第 2 张第 3 题」只在那一张里找', !t2.acts[0].do && t2.acts[1].do?.k === '看' && (t2.acts[1].do as { label: string }).label === '第1张第3题', JSON.stringify(t2.acts));
  const w = fitActs(withPhoto, [A('翻', '白纸'), A('写', '23 + 18 ='), A('看', '第 3 题'), A('翻', '作业')], { book: null, photos });
  check('翻 白纸:加一张白纸页;白纸上不用先看就能写;白纸上没有可看的;翻 作业 回到照片', w.acts[0].do?.k === '翻' && w.acts[1].do?.k === '写' && !w.acts[2].do && w.acts[3].do?.k === '翻' && w.lesson.at === '作业' && w.lesson.pages.length === 2, JSON.stringify(w.why));
  check('白纸页上写的落在白纸条上', lessonStrip(fitActs(withPhoto, [A('翻', '白纸'), A('写', '23 + 18 =')], { book: null }).lesson)?.items[0].kind === 'write' && whitePage().kind === 'white');
  check('还没拍照片:翻 作业 落不了', !fitActs(lessonInit(), [A('翻', '作业')], { book: null }).acts[0].do);
}
done();
