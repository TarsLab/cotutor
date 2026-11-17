/**
 * 板书纯逻辑:条目 → 节、孩子的话、打开页面停在哪、字幕行、输入条、端、拼音调号;点字弹的四线三格的排版。页面内联的就是这份代码。
 * 课里的卡 2026-11-17 删了(标注、排版、提问卡、答案栏那些一起删了):节里只有讲稿与动作。
 */
import {
  barNext,
  deviceFor,
  isQuestion,
  kidSaid,
  lineDurationMs,
  plainLine,
  playerAtEnd,
  sectionsFromMessages,
  toneMark,
  type BoardLine,
  type BoardMessage,
  type BoardSection,
} from '../src/board/presentation.ts';
import { wordLayout } from '../src/ui/kid/word-layout.ts';
import { check, done } from './_check.ts';

const L = (text: string, extra: Partial<BoardLine> = {}): BoardLine => ({ text, ask: isQuestion(text), ...extra });

// ---- 讲稿一句 ----
check('念的时候去掉方括号', plainLine('[画蛇添足]是成语') === '画蛇添足是成语' && plainLine('没有括号') === '没有括号');
// 问句认半角与全角问号(2026-10-04:真老师写「你想问什么呀？」,原来只认半角,孩子端念完不停)
check('isQuestion:半角、全角问号都算;句号不算', isQuestion('每人几块?') && isQuestion('每人几块？') && isQuestion(' 好吗？ ') && !isQuestion('好的。'));
check('拼音调号:标在 a / e 上,ou 标在 o,否则最后一个元音;5 是轻声;认不出的原样', toneMark('shi4') === 'shì' && toneMark('hao3') === 'hǎo' && toneMark('gou3') === 'gǒu' && toneMark('lv4') === 'lǜ' && toneMark('ma5') === 'ma' && toneMark('abc') === 'abc');

// ---- 条目 → 节 ----
{
  const s1: BoardSection = { lines: [L('拿走 8 根。'), L('还剩几根?')] };
  const acts: BoardSection = { lines: [], acts: [{ name: '翻', arg: '白纸' }] };
  const msgs: BoardMessage[] = [
    { job: '1', question: '我要预习', reply: 'x', pending: false, fromHome: true, section: s1 },
    { job: '2', question: '没讲稿', reply: null, pending: false, section: { lines: [] } },
    { job: '3', question: '只有动作', reply: 'x', pending: false, section: acts },
    { job: '4', question: '出错的', reply: null, pending: false, section: null },
    { job: '5', question: '还在写', reply: null, pending: true, section: { lines: [L('先看第一句。')], partial: true } },
    { job: '6', question: '还没出句', reply: null, pending: true, section: { lines: [], partial: true } },
  ];
  const es = sectionsFromMessages(msgs);
  check('有讲稿或动作的出节;没有的、出错的不出;还在跑的有句才出 partial 节', es.map((e) => e.job).join() === '1,3,5' && es[2].partial === true && es[0].partial === undefined, JSON.stringify(es.map((e) => [e.job, e.partial])));
  check('第一句前面的动作跟着节走', JSON.stringify(es[1].acts) === JSON.stringify(acts.acts));
  check('孩子的话挂在它引出的那一节上;首页按钮的不算', es[0].said === undefined && es[1].said?.text === '只有动作' && es[2].said?.text === '还在写');
}

// ---- 孩子的话 ----
{
  const says = kidSaid([
    { job: 'a', question: '分一分', reply: 'x', pending: false, fromHome: true },
    { job: 'b', question: '嗯……每个人两个吧', reply: 'x', pending: false },
    { job: 'c', question: '(给老师看,没说话)', reply: 'x', pending: false, action: 'submit' },
    { job: 'd', question: '4', reply: null, pending: true },
    { job: 'e', question: '(拍了一张)', reply: 'x', pending: false, photos: ['captures/2026-10-18/0900-1.jpg'] },
    { job: 'f', question: '(拍了 2 张)', reply: 'x', pending: false, photos: ['a.jpg', 'b.jpg'] },
    { job: 'g', question: '这是第三幅', reply: 'x', pending: false, photos: ['a.jpg'] },
    { job: 'h', question: '  ', reply: 'x', pending: false },
  ]);
  check('kidSaid:首页按钮、给老师看、空的、只发照片时补的那句不记;刚发出去的也有;配了话的照片记那句话', [...says.keys()].join() === 'b,d,g' && says.get('b')?.text === '嗯……每个人两个吧' && says.get('g')?.full === '这是第三幅', JSON.stringify([...says]));
}

// ---- 打开页面停在哪 ----
{
  const s1: BoardSection = { lines: [L('拿走 8 根。'), L('还剩几根?')] };
  const s2: BoardSection = { lines: [L('对,还剩 5 根。')] };
  check('空板书:idle', playerAtEnd([]).status === 'idle');
  check('打开页面停在末尾;末句问句 → 等着', JSON.stringify(playerAtEnd([s1])) === '{"section":0,"line":1,"status":"waiting"}' && playerAtEnd([s1, s2]).status === 'done');
}

check('输入条:点 → 打字;按住 → 说话;松手 / 取消 / 发出 / 失焦 → 闲置', barNext('idle', 'tap') === 'typing' && barNext('idle', 'holdStart') === 'holding' && barNext('holding', 'holdEnd') === 'idle' && barNext('holding', 'holdCancel') === 'idle' && barNext('typing', 'sent') === 'idle' && barNext('typing', 'blur') === 'idle' && barNext('typing', 'tap') === 'typing');
check('端:宽 ≥ 900 且横 → 平板横屏;短边 ≥ 600 → 平板竖屏;其余手机', deviceFor(1180, 820) === 'tablet-landscape' && deviceFor(820, 1180) === 'tablet-portrait' && deviceFor(390, 844) === 'phone' && deviceFor(899, 500) === 'phone' && deviceFor(1024, 768) === 'tablet-landscape');
check('一句按字数估多久,至少 1.2 秒', lineDurationMs('短') === 1200 && lineDurationMs('[十个字十个字十个字十]') === 2600);

// ---- 点字弹的四线三格:排版按 advance + 字间距,分开写时段与段之间再空开 ----
{
  const G = { a: { advance: 1 }, p: { advance: 1 }, l: { advance: 0.2 }, e: { advance: 0.95 } };
  const lay = wordLayout('apple', G, { gap: 0.2, space: 0.5 });
  const lsp = wordLayout('apple', G, { gap: 0.2, space: 0.5, chunks: ['ap', 'ple'], split: true });
  const two = wordLayout('ice cream', { i: { advance: 0.2 }, c: { advance: 0.8 }, e: { advance: 0.95 }, r: { advance: 0.6 }, a: { advance: 1 }, m: { advance: 1.4 } }, { gap: 0.2, space: 0.5 });
  check('四线三格:排版逐字前进,分开写时第二段整体右移 0.8,空格只前进', lay.slots.map((x) => +x.x.toFixed(2)).join() === '0,1.2,2.4,3.6,4' && +lay.width.toFixed(2) === 4.95 && lsp.slots.map((x) => x.chunk).join() === '0,0,1,1,1' && +(lsp.slots[2].x - lay.slots[2].x).toFixed(2) === 0.8 && +(lsp.slots[4].x - lay.slots[4].x).toFixed(2) === 0.8 && two.slots.length === 8 && +(two.slots[3].x - two.slots[2].x).toFixed(2) === 1.85, JSON.stringify([lay, lsp.slots]));
}

done();
