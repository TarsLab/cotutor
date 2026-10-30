/** 取材(《vault重构方案》§6,2026-10-30):孩子问到的字查生字表、提到的课带口径、日记里查以前讲过的骨架;只做关键词与标题匹配,记来源。 */
import { askedChars, lookup, parseTextbook } from '../src/memory/retrieval.ts';
import { textHash } from '../src/memory/vault-notes.ts';
import { check, done } from './_check.ts';

// ---- 孩子在问哪个字(ray 的真话) ----
check('「X怎么写」:两个字的词也抓;前面的称呼不算', askedChars('老师宇宙怎么写').join() === '宇,宙' && askedChars('海字怎么写').join() === '海');
check('「X字的…」「X字不能…」:抓 X', askedChars('嗯，赵字的古古文的字。').join() === '赵' && askedChars('老师，更字不能加一个赢赢吗？').join() === '更' && askedChars('报告，一字的拼音怎么写？').join() === '一');
check('引号里的:抓', askedChars('一个“一”的组词。').join() === '一' && askedChars('「瀑布」是什么').join() === '瀑,布');
check('不是在问字:拼音、作文、这道题都不算', askedChars('这篇作文怎么写？').length === 0 && askedChars('这道题怎么做？我不会做。').length === 0 && askedChars('画一幅图').length === 0);

// ---- 一册教材:一课一个 H2,识字 / 写字行,### 口径 ----
const BOOK = [
  '---', 'cotutor: textbook', '---', '', '# 语文二上', '', '> [!tip] 想写怎么讲,在那一节下面加 `### 口径`', '',
  '## 课文 1 小蝌蚪找妈妈', '', '识字:塘 脑 袋 极', '写字:两 哪 宽 顶', '', '### 原文', '', '池塘里有一群小蝌蚪。', '',
  '## 课文 2 我是什么', '', '识字:晒 极 傍', '写字:变 极 海 洋', '', '### 口径', '', '先讲「海」的三点水,再讲每一条河流最后都汇入海。', '```', '海 = 氵 + 每', '```', '', '### 原文', '', '我会变。', '',
  '## 语文园地一', '', '识字:套 帽',
].join('\n');
const lessons = parseTextbook('语文二上', BOOK);
check('读教材:三课、行头里的字、口径到下一个标题为止(围栏里的也算口径)', lessons.length === 3 && lessons[0].recognize.join() === '塘,脑,袋,极' && lessons[1].write.join() === '变,极,海,洋' && lessons[1].caliber === '先讲「海」的三点水,再讲每一条河流最后都汇入海。\n```\n海 = 氵 + 每\n```' && lessons[0].caliber === null && lessons[2].write.length === 0, JSON.stringify(lessons));

const textbooks = [{ path: '教材/语文二上.md', text: BOOK }];
const diaries = [
  { path: '日记/2026-10-01.md', date: '2026-10-01', text: '## 语文 · 海\n\n讲了海。 → [[语文二上#课文 2 我是什么]]\n骨架:三点水 → 每 → 河流汇入海\n' },
  { path: '日记/2026-10-05.md', date: '2026-10-05', text: '## 数学 · 凑十\n\n骨架:不是这一课\n\n## 语文 · 又讲海\n\n→ [[语文二上#课文 2 我是什么]]\n骨架:先画海 → 再写字\n' },
];

const sea = lookup({ query: '海字怎么写', textbooks, diaries });
check('问到的字:在哪一课、会认还是会写', sea.lines[0] === '「海」:课文 2 我是什么 会写', JSON.stringify(sea.lines));
check('要会写的那一课:带口径原文(课题、口径标题)、最新那次讲的骨架', sea.caliber?.path === '教材/语文二上.md' && sea.caliber.text.startsWith('## 课文 2 我是什么\n### 口径\n先讲「海」') && sea.lines[1] === '以前讲过「课文 2 我是什么」(2026-10-05):骨架:先画海 → 再写字', JSON.stringify(sea));
check('来源:教材与那篇日记,整篇的 hash,为什么查', sea.retrieved.length === 2 && sea.retrieved[0].path === '教材/语文二上.md' && sea.retrieved[0].hash === textHash(BOOK) && sea.retrieved[0].why === '问到的字:海;口径:课文 2 我是什么' && sea.retrieved[1].path === '日记/2026-10-05.md' && sea.retrieved[1].why === '以前讲过:课文 2 我是什么', JSON.stringify(sea.retrieved));

const two = lookup({ query: '极字怎么读,宇宙怎么写', textbooks, diaries: [] });
check('一个字在两课里:一课会认、一课又会认又会写;表里没有的写明不在这学期的表里', two.lines.join('|') === '「极」:课文 1 小蝌蚪找妈妈 会认;课文 2 我是什么 会认、会写|「宇」:不在这学期的识字、写字表里(语文二上)|「宙」:不在这学期的识字、写字表里(语文二上)', JSON.stringify(two.lines));

const named = lookup({ query: '我们讲小蝌蚪找妈妈吧', textbooks, diaries });
check('提到课题:那一课没有口径、日记里也没讲过 → 什么都不带', named.lines.length === 0 && named.caliber === null && named.retrieved.length === 0, JSON.stringify(named));
check('「第 2 课」:认出那一课,带口径', lookup({ query: '今天学第 2 课', textbooks, diaries: [] }).caliber?.text.includes('三点水') === true);

const math = lookup({ query: '海字怎么写', textbooks: [{ path: '教材/数学.md', text: '## 1 认识图形\n\n### 口径\n用积木讲。\n' }], diaries: [] });
check('教材没有识字、写字行(数学):不报一串「不在表里」', math.lines.length === 0 && math.retrieved.length === 0, JSON.stringify(math));
check('没在问字、也没提到课:全空', JSON.stringify(lookup({ query: '我不会做', textbooks, diaries })) === JSON.stringify({ lines: [], caliber: null, retrieved: [] }));
const long = lookup({ query: '海字怎么写', textbooks: [{ path: '教材/a.md', text: `## 课文 2 我是什么\n写字:海\n### 口径\n${'很长的口径。'.repeat(400)}\n` }], diaries: [], maxCaliber: 100 });
check('口径太长:截到 maxCaliber 并注明', (long.caliber?.text.length ?? 0) < 130 && long.caliber?.text.endsWith('……(后面截掉了)') === true);

done();
