/** 上下文包:固定 YAML 块、按政策截、空项不写、需要引号的引号。 */
import { buildContextPack, renderContextPack, yamlScalar } from '../src/lib/context-pack.ts';
import { check, done } from './_check.ts';

check('裸标量', yamlScalar('2026-09-08T16:20') === '2026-09-08T16:20' && yamlScalar(3) === '3');
check('含空格冒号 → 引号', yamlScalar('数学 16:00-17:00') === '"数学 16:00-17:00"');
check('yes/no 之类不裸写', yamlScalar('no') === '"no"');

const text = buildContextPack(
  {
    from: 'kid',
    at: '2026-09-08T16:20',
    slot: '数学 16:00-17:00',
    focus: { artifact: '2026-09-08-两位数退位', step: 3, circled: ['借位那一步'] },
    profile: ['数学:人教数学一下 第 4 单元 在学', '会用的说法:凑十、破十', '还没学、别用:竖式'],
    plan: ['a', 'b', 'c'],
    recent: [
      { date: '2026-09-01', claim: '一' },
      { date: '2026-09-06', claim: '二' },
      { date: '2026-09-07', claim: '三' },
    ],
  },
  '妈妈我不懂这一步',
  { recent: 2, planLines: 2, profileLines: 2 },
);
const lines = text.split('\n');
check('头部固定', lines[0] === 'cotutor:' && lines[1] === '  from: kid' && lines[2] === '  at: 2026-09-08T16:20', text);
check('focus 三项', text.includes('    artifact: "2026-09-08-两位数退位"') && text.includes('    step: 3') && text.includes('    circled: ["借位那一步"]'), text);
check('profile 在 plan 前、按 profileLines 截', text.includes('  profile:\n    - "数学:人教数学一下 第 4 单元 在学"\n    - "会用的说法:凑十、破十"\n  plan:') && !text.includes('竖式'), text);
check('plan 截到 2 行', text.includes('    - a\n    - b\n') && !text.includes('- c'), text);
check('recent 取最近 2 条', text.includes('"2026-09-06 二"') && text.includes('"2026-09-07 三"') && !text.includes('一"'), text);
check('分隔与消息', text.endsWith('---\n妈妈我不懂这一步\n'), text);

const minimal = renderContextPack({ from: 'system', at: '2026-09-08T20:00', profile: [], plan: [], recent: [] });
check('空项不写', minimal === 'cotutor:\n  from: system\n  at: 2026-09-08T20:00', minimal);
check('board: off 才写进包,auto 不写', buildContextPack({ from: 'kid', at: '2026-09-10T16:00', profile: [], plan: [], recent: [], board: 'off' }, 'x', { recent: 10, planLines: 10 }).includes('  board: off') && !buildContextPack({ from: 'kid', at: '2026-09-10T16:00', profile: [], plan: [], recent: [], board: 'auto' }, 'x', { recent: 10, planLines: 10 }).includes('board'));
const withCards = buildContextPack({ from: 'kid', at: '2026-09-10T16:00', focus: { card: '1620-1/1' }, profile: [], plan: [], recent: [], cards: ['1620-1/1 choice「三角形有几个角?」 选了「A 三个」(答案:「A 三个」)'] }, '(交了答案,没说话)', { recent: 10, planLines: 10 });
check('focus.card 与 cards 段:一张卡一行,引号包住', withCards.includes('  focus:\n    card: "1620-1/1"\n') && withCards.includes('  cards:\n    - "1620-1/1 choice「三角形有几个角?」 选了「A 三个」(答案:「A 三个」)"\n---\n(交了答案,没说话)'), withCards);
check('没有改过的卡就没有 cards 段', !buildContextPack({ from: 'kid', at: '2026-09-10T16:00', profile: [], plan: [], recent: [], cards: [] }, 'x', { recent: 10, planLines: 10 }).includes('cards'));
const withPhotos = buildContextPack({ from: 'kid', at: '2026-09-14T16:20', profile: [], plan: [], recent: [], photos: ['captures/2026-09-14/1620-1.jpg', 'captures/2026-09-14/1620-2.jpg'] }, '(拍了 2 张)', { recent: 10, planLines: 10 });
check('photos 段:一行一张(带斜杠所以引号包住),在 cards 后', withPhotos.endsWith('  photos:\n    - "captures/2026-09-14/1620-1.jpg"\n    - "captures/2026-09-14/1620-2.jpg"\n---\n(拍了 2 张)\n') && !buildContextPack({ from: 'kid', at: '2026-09-14T16:20', profile: [], plan: [], recent: [], photos: [] }, 'x', { recent: 10, planLines: 10 }).includes('photos'), withPhotos);
done();
