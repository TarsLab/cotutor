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
    focus: { card: '1620-1/2' },
    semester: '二年级上',
    profile: 'profile.md',
    entry: '课程/二年级上/数学.md(未变,原文在本话题前面)',
    refs: ['/v/教材/数学二年级上册.md'],
    notes: [{ role: 'profile', path: 'profile.md', text: '---\ncotutor: profile\n---\n\n有阅读困难。\n\n' }],
    plan: ['a', 'b', 'c'],
    recent: [
      { date: '2026-09-01', claim: '一' },
      { date: '2026-09-06', claim: '二' },
      { date: '2026-09-07', claim: '三' },
    ],
  },
  '妈妈我不懂这一步',
  { recent: 2, planLines: 2 },
);
const lines = text.split('\n');
check('头部固定', lines[0] === 'cotutor:' && lines[1] === '  from: kid' && lines[2] === '  at: 2026-09-08T16:20', text);
check('focus 只有 card', text.includes('  focus:\n    card: "1620-1/2"\n'), text);
check('学期、档案、入口、参考在 plan 前', text.includes('  semester: "二年级上"\n  profile: profile.md\n  entry: "课程/二年级上/数学.md(未变,原文在本话题前面)"\n  refs:\n    - "/v/教材/数学二年级上册.md"\n  plan:'), text);
check('笔记原文接在 YAML 块后、--- 前,尾部空白去掉', text.includes('    - "2026-09-07 三"\n<vault-note role="profile" path="profile.md">\n---\ncotutor: profile\n---\n\n有阅读困难。\n</vault-note>\n---\n妈妈我不懂这一步\n'), text);
check('plan 截到 2 行', text.includes('    - a\n    - b\n') && !text.includes('- c'), text);
check('recent 取最近 2 条', text.includes('"2026-09-06 二"') && text.includes('"2026-09-07 三"') && !text.includes('一"'), text);
check('分隔与消息', text.endsWith('---\n妈妈我不懂这一步\n'), text);

const minimal = renderContextPack({ from: 'system', at: '2026-09-08T20:00', plan: [], recent: [] });
check('空项不写', minimal === 'cotutor:\n  from: system\n  at: 2026-09-08T20:00', minimal);
const withVault = renderContextPack({ from: 'kid', at: '2026-09-08T20:00', plan: [], recent: [], vault: { root: '/Users/x/Library/Mobile Documents/iCloud~md~obsidian/Documents/Ray', diary: '日记', timetable: '/elsewhere/课程表.md' } });
check('vault 段:root 绝对路径含空格加引号,角色相对 root,在外面的是绝对路径,没配的不写', withVault.endsWith('  vault:\n    root: "/Users/x/Library/Mobile Documents/iCloud~md~obsidian/Documents/Ray"\n    diary: "日记"\n    timetable: "/elsewhere/课程表.md"') && !withVault.includes('plans'), withVault);
check('board: off 才写进包,auto 不写', buildContextPack({ from: 'kid', at: '2026-09-10T16:00', plan: [], recent: [], board: 'off' }, 'x', { recent: 10, planLines: 10 }).includes('  board: off') && !buildContextPack({ from: 'kid', at: '2026-09-10T16:00', plan: [], recent: [], board: 'auto' }, 'x', { recent: 10, planLines: 10 }).includes('board'));
const withCards = buildContextPack({ from: 'kid', at: '2026-09-10T16:00', focus: { card: '1620-1/1' }, plan: [], recent: [], cards: ['1620-1/1 choice「三角形有几个角?」 选了「A 三个」(答案:「A 三个」)'] }, '(交了答案,没说话)', { recent: 10, planLines: 10 });
check('focus.card 与 cards 段:一张卡一行,引号包住', withCards.includes('  focus:\n    card: "1620-1/1"\n') && withCards.includes('  cards:\n    - "1620-1/1 choice「三角形有几个角?」 选了「A 三个」(答案:「A 三个」)"\n---\n(交了答案,没说话)'), withCards);
check('没有改过的卡就没有 cards 段', !buildContextPack({ from: 'kid', at: '2026-09-10T16:00', plan: [], recent: [], cards: [] }, 'x', { recent: 10, planLines: 10 }).includes('cards'));
const withPhotos = buildContextPack({ from: 'kid', at: '2026-09-14T16:20', plan: [], recent: [], photos: ['captures/2026-09-14/1620-1.jpg', 'captures/2026-09-14/1620-2.jpg'] }, '(拍了 2 张)', { recent: 10, planLines: 10 });
check('photos 段:一行一张(带斜杠所以引号包住),在 cards 后', withPhotos.endsWith('  photos:\n    - "captures/2026-09-14/1620-1.jpg"\n    - "captures/2026-09-14/1620-2.jpg"\n---\n(拍了 2 张)\n') && !buildContextPack({ from: 'kid', at: '2026-09-14T16:20', plan: [], recent: [], photos: [] }, 'x', { recent: 10, planLines: 10 }).includes('photos'), withPhotos);
const withFiles = buildContextPack({ from: 'kid', at: '2026-09-14T16:20', plan: [], recent: [], photos: ['captures/2026-09-14/1620-1.jpg'], photoFiles: ['/ws/captures/2026-09-14/1620-1.jpg'] }, '(拍了一张)', { recent: 10, planLines: 10 });
check('photoFiles 段:紧跟 photos,同一张的绝对路径;没有就不写', withFiles.endsWith('  photos:\n    - "captures/2026-09-14/1620-1.jpg"\n  photoFiles:\n    - "/ws/captures/2026-09-14/1620-1.jpg"\n---\n(拍了一张)\n') && !withPhotos.includes('photoFiles'), withFiles);
done();
