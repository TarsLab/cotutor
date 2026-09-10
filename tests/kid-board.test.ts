/** 板书纯逻辑:标注锚点、条目 → 节、播放状态机、字幕行、输入条、布局。页面内联的就是这份代码。 */
import {
  advance,
  anchorMarks,
  barNext,
  cardTexts,
  cardTitle,
  filledAnswers,
  hasState,
  isHeavy,
  sceneReady,
  sceneSubtitle,
  segmentAudio,
  stateSummary,
  pickedLabels,
  togglePick,
  isQuestion,
  layoutFor,
  lineDurationMs,
  lineTarget,
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
  type BoardLine,
  type BoardSection,
} from '../src/lib/kid-board.ts';
import { check, done } from './_check.ts';

const L = (text: string, extra: Partial<BoardLine> = {}): BoardLine => ({ text, audio: null, marks: [], ask: isQuestion(text), anchor: null, cues: [], ...extra });
const cards: BoardCard[] = [
  { kind: 'text', props: { style: 'cover', title: '画蛇添足', text: '一个成语' } },
  { kind: 'text', props: { style: 'note', text: '画蛇添足 = 多做一步,反而坏事' } },
  { kind: 'read', props: { segments: ['楚有祠者', '先成者饮酒'] } },
  { kind: 'choice', props: { question: '酒是谁的?', options: ['他自己的', '第二个画完的'] } },
  { kind: 'fill', props: { text: '做到了还要___', blanks: 1 } },
  { kind: 'gizmo', props: { bundle: 'x', title: '场景' } },
];
const sceneCard: BoardCard = { kind: 'scene', props: { bundle: '2026-09-04-guilv5', text: '我去画', title: '找规律', problem: '75、70、65 后面填什么?', steps: ['一', '二', '三'], ready: true } };

{
  check('卡上的字都能被找到;不认识的 kind 拿 props 里的字符串', cardTexts(cards[2]).join('|') === '楚有祠者|先成者饮酒' && cardTexts(cards[3]).join('|') === '酒是谁的?|他自己的|第二个画完的' && cardTexts(cards[5]).join('|') === 'x|场景' && cardTexts(cards[0])[0] === '画蛇添足');
  const marks = anchorMarks(cards, ['多做一步,反而坏事', '先成者饮酒', '第二个画完的', '不存在的词', '  ']);
  check('方括号的词落到第一张含它的卡;找不到的丢掉', JSON.stringify(marks.map((m) => m.card)) === '[1,2,3]', JSON.stringify(marks));
  check('画蛇添足 落到封面(第一张含它的)', anchorMarks(cards, ['画蛇添足'])[0].card === 0);
  check('讲稿里的 [词] 按顺序取出,念的时候去括号', phrasesIn('它有两个来头:[出处]在《战国策》,[用法]是批评人。').join() === '出处,用法' && plainLine('[画蛇添足]是成语') === '画蛇添足是成语');
  check('笔的样子按卡定', markStyle(cards[0]) === 'marker' && markStyle(cards[1]) === 'marker' && markStyle(cards[2]) === 'marker' && markStyle(cards[3]) === 'box' && markStyle(cards[4]) === 'box' && markStyle({ kind: 'text', props: { style: 'formula', text: 'x' } }) === 'green' && markStyle({ kind: 'text', props: { text: 'x' } }) === 'wave' && markStyle(cards[5]) === 'wave');
  check('问句', isQuestion('酒是谁的?') && isQuestion('明白吗?') && !isQuestion('明白了。'));
  check('有舞台交互的是选择题与填空', hasState(cards[3]) && hasState(cards[4]) && !hasState(cards[0]) && !hasState(cards[2]) && !hasState(cards[5]) && !hasState({ kind: 'image', props: { src: 'a.png' } }));
  check('点读段的配音:assets 里有 <段号>.mp3 才有', segmentAudio({ ...cards[2], assets: ['2026-09-10.1620-1.cards/2/2.mp3'] }, 1) === '2026-09-10.1620-1.cards/2/2.mp3' && segmentAudio({ ...cards[2], assets: ['2026-09-10.1620-1.cards/2/2.mp3'] }, 0) === null && segmentAudio(cards[2], 0) === null);
  check('填空填了什么:按空数补齐,没填是空串;坏状态当没填', JSON.stringify(filledAnswers({ ...cards[4], state: { answers: [' 多做一步 '] } })) === '["多做一步"]' && JSON.stringify(filledAnswers({ kind: 'fill', props: { text: '_ _', blanks: 2 }, state: { answers: ['a'] } })) === '["a",""]' && JSON.stringify(filledAnswers({ ...cards[4], state: 'x' })) === '[""]');
  check('做了什么(交给老师能不能按):选择题是选项、填空是填的字、别的卡永远空', stateSummary({ ...cards[3], state: { picked: [0] } }).join() === 'A 他自己的' && stateSummary({ ...cards[4], state: { answers: ['多做一步'] } }).join() === '多做一步' && stateSummary(cards[4]).length === 0 && stateSummary({ ...cards[0], state: { x: 1 } }).length === 0);
  const cv: BoardCard = { kind: 'canvas', props: { base: null, prompt: '画一条蛇' } };
  check('画板卡:有交互(给老师看)、重卡;做了什么 = 画了 N 笔;标题是题目', hasState(cv) && isHeavy(cv) && stateSummary(cv).length === 0 && stateSummary({ ...cv, state: { ink: [{}, {}, {}] } }).join() === '画了 3 笔' && cardTitle(cv) === '画一条蛇' && cardTitle({ kind: 'canvas', props: { base: null } }) === '画一画' && cardTexts(cv).join() === '画一条蛇');
  check('重卡:scene / canvas 在舞台包里开;场景卡课包到了才 ready', isHeavy(sceneCard) && isHeavy({ kind: 'canvas', props: {} }) && !isHeavy(cards[3]) && sceneReady(sceneCard) && !sceneReady({ kind: 'scene', props: { bundle: 'x' } }) && !sceneReady(cards[0]));
  check('场景卡:能标注题面 / 标题 / 那句话;标题是 title;没有「交给老师」', cardTexts(sceneCard).join('|') === '找规律|75、70、65 后面填什么?|我去画' && cardTitle(sceneCard) === '找规律' && !hasState(sceneCard) && stateSummary({ ...sceneCard, state: { step: 2, done: false } }).length === 0);
  check('场景在播时的字幕行:drawing 暂停、gap 继续(末步没钮)、ready / paused 播放、done 没钮、loading 空', sceneSubtitle('drawing', '一', 1, 3).right === 'pause' && sceneSubtitle('gap', '一', 1, 3).right === 'continue' && sceneSubtitle('gap', '三', 3, 3).right === 'none' && sceneSubtitle('ready', '题', 0, 3).right === 'play' && sceneSubtitle('paused', '一', 1, 3).right === 'play' && JSON.stringify(sceneSubtitle('done', '三', 3, 3)) === '{"text":"三","kind":"line","right":"none"}' && sceneSubtitle('loading', '', 0, 3).kind === 'empty');
  check('讲稿交给场景时(stage)字幕留那句、没钮', subtitleFor({ state: { section: 0, line: 0, status: 'stage' }, sections: [{ cards: [], lines: [L('看我画')] }], echo: null, pending: false, thinking: 'x', limit: false }).right === 'none');
  check('图片卡:能标注的是图注,标题是图注 / 「图」', cardTexts({ kind: 'image', props: { src: 'a.png', caption: '看这里' } }).join() === '看这里' && cardTitle({ kind: 'image', props: { src: 'a.png', caption: '看这里' } }) === '看这里' && cardTitle({ kind: 'image', props: { src: 'a.png' } }) === '图');
  check('舞台顶栏的名字:标题 > 问题 > 正文 > 第一段;截 24 字', cardTitle(cards[0]) === '画蛇添足' && cardTitle(cards[3]) === '酒是谁的?' && cardTitle(cards[2]) === '楚有祠者' && cardTitle(cards[1]) === '画蛇添足 = 多做一步,反而坏事' && cardTitle({ kind: 'text', props: { text: '字'.repeat(30) } }).length === 25 && cardTitle({ kind: 'gizmo', props: { bundle: 'x' } }) === 'x');
  check('单选:点了换成它,再点取消;多选:切换', JSON.stringify(togglePick([], 1, false)) === '[1]' && JSON.stringify(togglePick([1], 2, false)) === '[2]' && JSON.stringify(togglePick([1], 1, false)) === '[]' && JSON.stringify(togglePick([0], 2, true)) === '[0,2]' && JSON.stringify(togglePick([0, 2], 0, true)) === '[2]');
  check('选了什么(回显用):「B 第二个画完的」;没状态 / 越界 → 空', pickedLabels({ ...cards[3], state: { picked: [1] } }).join() === 'B 第二个画完的' && pickedLabels(cards[3]).length === 0 && pickedLabels({ ...cards[3], state: { picked: [7] } }).length === 0 && pickedLabels({ ...cards[3], state: 'junk' }).length === 0);
  check('滚到哪张卡:标注的卡 > 锚点卡 > null', lineTarget(L('a', { marks: [{ card: 2, phrase: 'x' }], anchor: 0 })) === 2 && lineTarget(L('a', { anchor: 1 })) === 1 && lineTarget(L('a')) === null);
}
{
  const section: BoardSection = { cards, lines: [L('第一句', { marks: [{ card: 1, phrase: '多做一步' }], anchor: 0 }), L('酒是谁的?', { anchor: 3 })] };
  const entries = sectionsFromMessages([
    { job: '1', question: '画蛇添足是什么?', reply: '酒是谁的?', audio: null, pending: false, section },
    { job: '2', question: '不画脚呢?', reply: null, audio: null, pending: true },
    { job: '3', question: '再说一遍', reply: '酒归第二个画完的。', audio: '2026-09-10.1.mp3', pending: false },
    { job: '4', question: '出错的', reply: null, audio: null, pending: false },
    { job: '5', question: '空节', reply: '只有一句', audio: null, pending: false, section: { cards: [{ kind: 'text', props: { text: '卡' } }], lines: [] } },
    { job: '6', question: '只有讲稿', reply: '一句话', audio: null, pending: false, section: { cards: [], lines: [L('一句话')] } },
    { job: '7', question: '还在说', reply: null, audio: null, pending: true, section: { cards: [{ kind: 'text', props: { text: '先出的卡' } }], lines: [L('第一句')], partial: true } },
    { job: '8', question: '还在说但没卡', reply: null, audio: null, pending: true, section: { cards: [], lines: [L('只有句')], partial: true } },
  ]);
  check('有 section 用 section;还在跑 / 出错的不出节;流式已出卡的出 partial 节', entries.length === 5 && entries[0].job === '1' && entries[0].cards.length === 6 && entries[1].job === '3' && entries[4].job === '7' && entries[4].partial === true && entries[4].cards.length === 1 && !entries.slice(0, 4).some((e) => e.partial), JSON.stringify(entries.map((e) => e.job)));
  check('只有 reply 的退成一张文字卡 + 一句讲稿(带配音)', entries[1].cards[0].kind === 'text' && entries[1].cards[0].props.text === '酒归第二个画完的。' && entries[1].lines[0].audio === '2026-09-10.1.mp3' && entries[1].lines[0].ask === false);
  check('section 没讲稿时把 reply 当一句;只有讲稿没卡也成节', entries[2].lines.length === 1 && entries[2].lines[0].text === '只有一句' && entries[3].cards.length === 0 && entries[3].lines.length === 1);
  check('孩子的话不上板', !entries.some((e) => e.cards.some((c) => cardTexts(c).some((t) => t.includes('画蛇添足是什么')))));
  check('目录名:封面 > 有名字的文字卡 > 第一张有字的卡 > 第一句,截 14 字', sectionTitle(section) === '画蛇添足' && sectionTitle({ cards: [{ kind: 'text', props: { style: 'step', title: '拼', text: 'x' } }], lines: [] }) === '拼' && sectionTitle({ cards: [{ kind: 'text', props: { text: '一二三四五六七八九十一二三四五六' } }], lines: [] }) === '一二三四五六七八九十一二三四…' && sectionTitle({ cards: [], lines: [L('只有一句')] }) === '只有一句');
}
{
  const s1: BoardSection = { cards: [{ kind: 'text', props: { text: 'a' } }], lines: [L('一'), L('二?', { marks: [{ card: 0, phrase: 'a' }] })] };
  const s2: BoardSection = { cards: [{ kind: 'text', props: { text: 'b' } }], lines: [L('三')] };
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
