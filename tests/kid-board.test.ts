/** 板书纯逻辑:标注锚点、条目 → 节、播放状态机、字幕行、输入条、布局。页面内联的就是这份代码。 */
import {
  advance,
  anchorMarks,
  barNext,
  cardTexts,
  isQuestion,
  layoutFor,
  lineDurationMs,
  marksUpTo,
  markStyle,
  phrasesIn,
  plainLine,
  playerAtEnd,
  sectionTitle,
  sectionsFromMessages,
  startSection,
  subtitleFor,
  type BoardCard,
  type BoardSection,
} from '../src/lib/kid-board.ts';
import { check, done } from './_check.ts';

const cards: BoardCard[] = [
  { type: 'cover', title: '画蛇添足', subtitle: '一个成语' },
  { type: 'oneline', text: '画蛇添足 = 多做一步,反而坏事' },
  { type: 'types', items: [{ name: '出处', note: '《战国策》' }, { name: '用法' }] },
  { type: 'fact', text: '几个人分一壶酒,比赛画蛇。' },
  { type: 'list', items: [{ lead: '画完就停', text: '别再动' }] },
  { type: 'think', question: '酒是谁的?', back: '第二个画完的' },
];

{
  check('卡上的字都能被找到', cardTexts(cards[2]).join('|') === '出处|《战国策》|用法|' && cardTexts(cards[5])[1] === '第二个画完的');
  const marks = anchorMarks(cards, ['画蛇添足 = 多做一步,反而坏事', '出处', '比赛画蛇', '画完就停', '不存在的词', '  ']);
  check('方括号的词落到第一张含它的卡;找不到的丢掉', JSON.stringify(marks.map((m) => m.card)) === '[1,2,3,4]', JSON.stringify(marks));
  check('画蛇添足 落到封面(第一张含它的)', anchorMarks(cards, ['画蛇添足'])[0].card === 0);
  check('讲稿里的 [词] 按顺序取出,念的时候去括号', phrasesIn('它有两个来头:[出处]在《战国策》,[用法]是批评人。').join() === '出处,用法' && plainLine('[画蛇添足]是成语') === '画蛇添足是成语');
  check('笔的样子按卡定', markStyle('oneline') === 'marker' && markStyle('types') === 'circle' && markStyle('list') === 'box' && markStyle('calc') === 'green' && markStyle('fact') === 'wave' && markStyle('quote') === 'wave');
  check('问句', isQuestion('酒是谁的?') && isQuestion('明白吗?') && !isQuestion('明白了。'));
}
{
  const section: BoardSection = { cards, lines: [{ text: '第一句', audio: null, marks: [{ card: 1, phrase: '多做一步' }], ask: false }, { text: '酒是谁的?', audio: null, marks: [], ask: true }] };
  const entries = sectionsFromMessages([
    { job: '1', question: '画蛇添足是什么?', reply: '酒是谁的?', audio: null, pending: false, section },
    { job: '2', question: '不画脚呢?', reply: null, audio: null, pending: true },
    { job: '3', question: '再说一遍', reply: '酒归第二个画完的。', audio: '2026-09-10.1.mp3', pending: false },
    { job: '4', question: '出错的', reply: null, audio: null, pending: false },
    { job: '5', question: '空节', reply: '只有一句', audio: null, pending: false, section: { cards: [{ type: 'text', text: '卡' }], lines: [] } },
  ]);
  check('有 section 用 section;还在跑 / 出错的不出节', entries.length === 3 && entries[0].job === '1' && entries[0].cards.length === 6 && entries[1].job === '3', JSON.stringify(entries.map((e) => e.job)));
  check('只有 reply 的退成一张文字卡 + 一句讲稿(带配音)', entries[1].cards[0].type === 'text' && entries[1].lines[0].audio === '2026-09-10.1.mp3' && entries[1].lines[0].ask === false);
  check('section 没讲稿时把 reply 当一句', entries[2].lines.length === 1 && entries[2].lines[0].text === '只有一句');
  check('孩子的话不上板', !entries.some((e) => e.cards.some((c) => cardTexts(c).some((t) => t.includes('画蛇添足是什么')))));
  check('目录名:封面 > 小节 > 题目 > 第一张有字的卡,截 14 字', sectionTitle(section) === '画蛇添足' && sectionTitle({ cards: [{ type: 'section', title: '酒到底归谁' }], lines: [] }) === '酒到底归谁' && sectionTitle({ cards: [{ type: 'text', text: '一二三四五六七八九十一二三四五六' }], lines: [] }) === '一二三四五六七八九十一二三四…');
}
{
  const s1: BoardSection = { cards: [{ type: 'text', text: 'a' }], lines: [{ text: '一', audio: null, marks: [], ask: false }, { text: '二?', audio: null, marks: [{ card: 0, phrase: 'a' }], ask: true }] };
  const s2: BoardSection = { cards: [{ type: 'text', text: 'b' }], lines: [{ text: '三', audio: null, marks: [], ask: false }] };
  check('空板书:idle', playerAtEnd([]).status === 'idle');
  check('打开页面停在末尾;末句问句 → 等着', JSON.stringify(playerAtEnd([s1])) === '{"section":0,"line":1,"status":"waiting"}' && playerAtEnd([s1, s2]).status === 'done');
  let st = startSection(0, [s1]);
  check('新节从第一句播', st.status === 'playing' && st.line === 0);
  st = advance(st, [s1]);
  check('同节下一句', st.line === 1 && st.status === 'playing');
  check('末句问句且没下一节 → 停下等', advance(st, [s1]).status === 'waiting');
  check('末句问句但已有下一节 → 直接进下一节(孩子答过了)', JSON.stringify(advance(st, [s1, s2])) === '{"section":1,"line":0,"status":"playing"}');
  check('末句不是问句 → 完', advance({ section: 1, line: 0, status: 'playing' }, [s1, s2]).status === 'done');
  check('没讲稿的节直接完', startSection(0, [{ cards: [], lines: [] }]).status === 'done');
  check('播到这句为止的标注', marksUpTo([s1], { section: 0, line: 1, status: 'paused' }).length === 1 && marksUpTo([s1], { section: 0, line: 0, status: 'playing' }).length === 0 && marksUpTo([s1], { section: -1, line: -1, status: 'idle' }).length === 0);
  const base = { sections: [s1], echo: null, pending: false, thinking: '让我想想…', limit: false };
  check('字幕:播放中 → 当前句 + 暂停', JSON.stringify(subtitleFor({ ...base, state: { section: 0, line: 0, status: 'playing' } })) === '{"text":"一","kind":"line","right":"pause"}');
  check('字幕:暂停 → 播放钮', subtitleFor({ ...base, state: { section: 0, line: 0, status: 'paused' } }).right === 'play');
  check('字幕:停下等 → 继续', subtitleFor({ ...base, state: { section: 0, line: 1, status: 'waiting' } }).right === 'continue');
  check('字幕:完 → 留末句、没钮', JSON.stringify(subtitleFor({ ...base, state: { section: 0, line: 1, status: 'done' } })) === '{"text":"二?","kind":"line","right":"none"}');
  check('字幕:回显孩子的话优先于播放', subtitleFor({ ...base, echo: '你:不画脚呢?', state: { section: 0, line: 0, status: 'playing' } }).kind === 'echo');
  check('字幕:等老师', subtitleFor({ ...base, pending: true, state: { section: 0, line: 1, status: 'done' } }).text === '让我想想…');
  check('字幕:上限压过一切', subtitleFor({ ...base, limit: true, pending: true, echo: 'x', state: { section: 0, line: 0, status: 'playing' } }).kind === 'limit');
  check('字幕:什么都没有', subtitleFor({ ...base, sections: [], state: { section: -1, line: -1, status: 'idle' } }).kind === 'empty');
}
{
  check('输入条:点 → 打字;按住 → 说话;松手 / 取消 / 发出 / 失焦 → 闲置', barNext('idle', 'tap') === 'typing' && barNext('idle', 'holdStart') === 'holding' && barNext('holding', 'holdEnd') === 'idle' && barNext('holding', 'holdCancel') === 'idle' && barNext('typing', 'sent') === 'idle' && barNext('typing', 'blur') === 'idle' && barNext('typing', 'tap') === 'typing' && barNext('typing', 'holdEnd') === 'typing');
  check('平板横屏才两列', layoutFor(1180, 820) === 'tablet' && layoutFor(820, 1180) === 'phone' && layoutFor(390, 844) === 'phone' && layoutFor(899, 500) === 'phone');
  check('没声音时按字数计时,至少 1.2 秒', lineDurationMs('短') === 1200 && lineDurationMs('[十个字十个字十个字十]') === 2600);
}
done();
