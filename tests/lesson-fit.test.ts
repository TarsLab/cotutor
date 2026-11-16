/** 讲稿里的动作落到课本上(src/board/lesson-fit.ts):照索引找框、先翻再看、落不了的记一句;过渡期的课本卡说成动作。书是 tests/_math-book.ts 造的。 */
import { bookCardActs, bookPageOf, fitActs, fitSection, lessonOpen, sectionActs } from '../src/board/lesson-fit.ts';
import { lessonInit, lessonPage, lessonStep, lessonStrip } from '../src/board/lesson.ts';
import { parseBoard } from '../src/board/parse.ts';
import type { BoardCard, Lesson, LineAct } from '../src/schema/index.ts';
import { mathIndexOf } from './_math-book.ts';
import { check, done } from './_check.ts';

const book = { file: '数学二年级上册.pdf', index: mathIndexOf() };
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
  const r = fitActs(opened, [A('翻', '5的乘法口诀'), A('看', '例 2'), A('盖', '5×1=5'), A('圈', '没有的字、5×1=5'), A('请', '圈、写')], book);
  const [fan, look, cover, ring, ask] = r.acts;
  check('翻:换成这一课的页', fan.do?.k === '翻' && fan.do.page.title === '5的乘法口诀');
  check('先翻再看:看的是新的那一课,换成框', look.do?.k === '看' && look.do.label === '例2' && look.do.box.length === 4, JSON.stringify(look));
  check('盖:照课本找到框', cover.do?.k === '盖' && cover.do.spots[0].text === '5×1=5');
  check('圈:找得到的那一处落,找不到的记一句', ring.do?.k === '圈' && ring.do.spots.length === 1 && r.why.length === 1 && r.why[0].includes('做了一部分') && r.why[0].includes('没有的字'), JSON.stringify([ring, r.why]));
  check('请:照写的', ask.do?.k === '请' && ask.do.ops.join() === '圈,写');
  check('落完的样子:这一课、看着例 2、盖着、请了圈和写', r.lesson.at === '数学二年级上册.pdf#5的乘法口诀' && r.lesson.look?.label === '例2' && lessonPage(r.lesson)!.teacher.marks.length === 2 && lessonPage(r.lesson)!.open.join() === '圈,写');
}
{
  const r = fitActs(opened, [A('翻', '没有这一课'), A('看', '例 9'), A('写', '5×2=10'), A('圈', '没有的字')], book);
  check('落不了的:不带 do,一处记一句(说清动作和原因)', r.acts.every((a) => !a.do) && r.why.length === 4 && r.why[0].includes('[[翻 没有这一课]]') && r.why[2].includes('看'), JSON.stringify(r.why));
  check('落不了的不改这节课', r.lesson === opened);
  const none = fitActs(lessonInit(), [A('看', '例 2')], null);
  check('没有课本:翻、看都落不了', !none.acts[0].do && none.why.length === 1);
}
{
  // 白纸条:先看一道题,再摆、写
  const at = fitActs(opened, [A('翻', '6的乘法口诀'), A('看', '例 4'), A('摆', '点阵 6 行 6 个'), A('写', '大 6×6=36'), A('擦')], book);
  const strip = lessonStrip(fitActs(opened, at.acts.slice(0, 4).map(({ name, arg }) => ({ name, arg })), book).lesson);
  check('摆、写落进看着的那道题的白纸条', at.acts[2].do?.k === '摆' && at.acts[3].do?.k === '写' && strip?.key === '例4' && strip.items.length === 2 && at.why.length === 0, JSON.stringify([at.acts, at.why]));
  check('擦:落成擦上一样', at.acts[4].do?.k === '擦' && at.acts[4].do.all === false && lessonStrip(at.lesson)?.items.length === 1);
}

// ——— 一节里的动作 ———
{
  const parsed = parseBoard('[[翻 5的乘法口诀]]\n我们看例 2。[[看 例 2]]\n先别看答案。[[盖 5×1=5]] [[请 圈]]\n这里没有。[[圈 没有的字]]\n');
  const f = fitSection(parsed.section, opened, book);
  check('fitSection:第一句前面的先落,再一句一句', f.section.acts?.[0].do?.k === '翻' && f.section.lines[0].acts?.[0].do?.k === '看' && f.section.lines[1].acts?.every((a) => a.do) === true && !f.section.lines[2].acts?.[0].do && f.why.length === 1, JSON.stringify([f.section, f.why]));
  const acts = sectionActs(f.section, opened, book);
  check('sectionActs:落好的照先后排', acts.map((a) => a.k).join() === '翻,看,盖,请');
  const after = acts.reduce((s: Lesson, a) => lessonStep(s, { t: 'act', act: a }), opened);
  check('照它落进状态', after.look?.label === '例2' && lessonPage(after)!.open.join() === '圈');
  check('没有动作的一节原样', fitSection(parseBoard('你好。\n').section, opened, book).section.lines[0].acts === undefined);
}

// ——— 过渡:课本卡说成动作 ———
{
  const card = (params: Record<string, string>, ops = ['圈', '画']): BoardCard => ({ kind: 'kit', props: { kit: '课本', params, ops } });
  const box = '80 300 900 420';
  const acts = bookCardActs(card({ 课: '5的乘法口诀', 书: '数学二年级上册.pdf', 页: '6', 看: `例2|${box}`, 盖: `5×1=5|${box}`, 圈: '' }), opened, book);
  check('课本卡:课 → 翻、看 / 盖照卡上的框、操作 → 请(画 = 写)', acts.map((a) => a.k).join() === '翻,看,盖,请' && (acts[3] as { ops: string[] }).ops.join() === '圈,写', JSON.stringify(acts));
  const same = bookCardActs(card({ 课: '目录', 书: '数学二年级上册.pdf', 页: '1' }, ['看']), opened, book);
  check('和现在这一页一样:不翻;只开放看:不请', same.length === 0, JSON.stringify(same));
  check('不是课本卡:没有动作', bookCardActs({ kind: 'kit', props: { kit: '点阵', params: {} } }, opened, book).length === 0);
  const sec = { cards: [card({ 课: '5的乘法口诀', 书: '数学二年级上册.pdf', 页: '6', 看: `例2|${box}` })], lines: [{ text: '看例 2。', audio: null, marks: [], ask: false, anchor: 0, cues: [], acts: [{ name: '请', arg: '圈', do: { k: '请', ops: ['圈'] } }] as LineAct[] }] };
  check('sectionActs:锚着的课本卡在那一句的动作前面', sectionActs(sec, opened, book).map((a) => a.k).join() === '翻,看,请,请');
}
done();
