/**
 * 口语课热身(src/live/lib/warm.ts,《wip/口语课改实时老师设计.md》§三之三、§三之四):孩子说的是跟读还是对老师说的;每拍的摸底一行。纯函数。
 * 例子用 Ray 10-17 跟读的真转写(duck、under under 在下面、Boss.、The dog.、他不等人的、那我们直接打电话吧)。
 */
import { check, done } from './_check.ts';

const { echoKind, warmLines } = await import('../src/live/lib/warm.ts');
const { catchCue } = await import('../src/live/lib/cue.ts');

check('说出了记号里的词:跟读(带中文的也算)', echoKind('duck,鸭子。', 'duck') === 'said' && echoKind('under under 在下面。', 'under') === 'said' && echoKind('The dog.', 'The ducks are under the bus') === 'said');
check('四个英文词以内、没中文:跟读(念偏了的「Boss.」)', echoKind('Boss.', 'bus') === 'said' && echoKind('I am driving car', 'No, you are walking') === 'said');
check('三个汉字以内、没英文:跟读(你先说答中文、学鸭子叫)', echoKind('鸭子', 'duck') === 'said' && echoKind('嘎嘎嘎', 'duck') === 'said');
check('对老师说的:长一点的中文、没有那个词', echoKind('那我们直接打电话吧。', 'duck') === 'talk' && echoKind('他不等人的。', 'bus') === 'talk' && echoKind('我不想读', 'duck') === 'talk');
check('对老师说的:五个英文词以上、没有那个词', echoKind('can I play with my toy car now', 'duck') === 'talk');

const lines = warmLines([
  { word: 'duck', say: false, outcome: 'said', text: 'duck', startMs: 800, hit: 1 },
  { word: 'bus', say: false, outcome: 'said', text: 'Boss.', startMs: 1100, hit: 0 },
  { word: 'under', say: false, outcome: 'said', text: 'under under 在下面', hit: 1 },
  { word: 'The ducks are under the bus', say: false, outcome: 'said', text: 'The ducks… under the bus', startMs: 1800, hit: 4 / 5 },
  { word: 'bus', say: true, outcome: 'silent' },
  { word: 'duck', say: false, outcome: 'talk', text: '那我们直接打电话吧' },
]);
check('摸底:说了什么、开口几秒', lines[0] === '跟 duck:说了「duck」,开口 0.8 秒', lines[0]);
check('摸底:单词没说出来写明(不说念错)', lines[1] === '跟 bus:说了「Boss.」(转写里没有 bus),开口 1.1 秒', lines[1]);
check('摸底:带中文', lines[2] === '跟 under:说了「under under 在下面」,带中文', lines[2]);
check('摸底:句子说出几个词(按去重的词数)', lines[3] === '跟 The ducks are under the bus:说了「The ducks… under the bus」,说出 4/5 个词,开口 1.8 秒', lines[3]);
check('摸底:你先说没开口', lines[4] === '自己说 bus:没开口', lines[4]);
check('摸底:没跟、对老师说的', lines[5] === '跟 duck:没跟,对你说「那我们直接打电话吧」', lines[5]);

check('嘴先说的:缺省中文;打电话那段英文;说话不出声', catchCue('photo')!.includes('看一看图片') && catchCue('photo', 'en')!.includes('picture') && catchCue('empty', 'en')!.includes('Say it again') && catchCue('voice', 'en') === null && catchCue('warm')!.includes('热热身'));

done();
