/**
 * 课本(src/memory/textbook-index.ts 读 PDF 的文字,src/chalk/kit/book.ts 找位置、画法「课本」)。
 * 用的是照人教统编版排法造的一本小书(字是编的,不放真教材的文字):
 *   PDF 第 1 页是目录;印刷页码 = PDF 页 − 1,页码印在页脚;
 *   《小鱼吹泡泡》1–2 页:正文带拼音(自造编码:jJng = jǐng),第 1 段一行、第 2 段从第 1 页底跨到第 2 页顶,后面是认字栏;
 *   《古诗两首》3–4 页,下面两首各一页;语文园地一 5–7 页,按栏目分(第 7 页空着);识字表在最后。
 * 数学(2026-11-15)用 tests/_math-book.ts 照人教版数学排的那本:目录没有点线、单元下面的小节和课题从页里读、例题、栏目和题。
 * 科学(2026-11-24)用 tests/_science-book.ts 照广东版科学排的那本:Unicode 拼音、目录的「/ 页码」和带页码的单元、栏目下面分段。
 */
import { BOOK_MAX_PAGES, READ_SAY_MAX, bookCut, bookFind, bookFrame, bookPages, bookPick, bookReadParts, bookReadTexts, bookRows, bookSheets, bookTarget, bookView, findLesson, lessonBlocks, lessonName, readSentences } from '../src/chalk/index.ts';
import type { BookLine, BookPage } from '../src/schema/index.ts';
import { bookLesson, fitActs, lessonOpen, tocEntries } from '../src/board/lesson-fit.ts';
import { lessonInit } from '../src/board/lesson.ts';
import { buildBookIndex, decodePinyin, pageLines, printedOf } from '../src/memory/textbook-index.ts';
import { pickBook } from '../src/memory/textbook-pdf.ts';
import { bookSlateParts } from '../src/runtime/context/board-pack.ts';
import { H, W, pages } from './_book.ts';
import { MW, mathIndexOf, mathPages } from './_math-book.ts';
import { scienceIndexOf } from './_science-book.ts';
import { check, done } from './_check.ts';

// ---- 拼音 ----
check('自造编码的拼音:一个大写字母 = 带调的韵母', decodePinyin('jJng') === 'jǐng' && decodePinyin('lC') === 'lǜ' && decodePinyin('lV') === 'lǚ' && decodePinyin('zuH') === 'zuò' && decodePinyin('shuT') === 'shuō');
check('已经是标准带调字母的原样收;表里没有的大写字母不猜', decodePinyin('jǐng') === 'jǐng' && decodePinyin('xZ') === null);
const p2 = pageLines(pages[1]);
const first = p2.find((l) => l.text === '小鱼在水里吹泡泡。');
check('拼音配给下面中心对得上的那个字;标点不配', first?.chars.map((c) => c.py ?? '_').join(' ') === 'xiǎo yú zài shuǐ lǐ chuī pào pao _', JSON.stringify(first?.chars));
check('拼音不单成一行;页眉、标题各是一行', !p2.some((l) => /[a-z]/.test(l.text)) && p2[0].text === '第一单元·阅读' && p2.some((l) => l.text === '小鱼吹泡泡' && l.chars[0].py === 'xiǎo'));
const split = pageLines({ n: 1, w: W, h: H, items: [{ s: '。 小', f: 'body', x: 100, y: 100, z: 18, w: 39 }] });
check('几个字一段的(「。 小」):照字宽拆开,空格占剩下的', split[0]?.text === '。小' && Math.abs(split[0].chars[1].x1 - 121) < 0.5, JSON.stringify(split));

// ---- 目录与页码 ----
const ix = buildBookIndex(pages, { file: '语文一年级下册.pdf', sha: 'abc', title: '语文一年级下册' });
check('目录在第 1 页;页脚的页码都读到了', ix.toc.join() === '1' && ix.pages[1].printed === 1 && ix.pages[2].printed === 2 && ix.pages[0].printed === null);
const L = (t: string) => ix.lessons.find((l) => l.title === t);
check('目录:编号、单元、印的页码 → PDF 页;止于下一课的前一页', L('小鱼吹泡泡')?.no === '1' && L('小鱼吹泡泡')?.unit === '第一单元·阅读' && L('小鱼吹泡泡')?.from === 1 && L('小鱼吹泡泡')?.to === 2 && L('小鱼吹泡泡')?.pages.join() === '2,3', JSON.stringify(ix.lessons));
check('点线比字高几个点也认;没编号、缩进的是上一课下面的一首,上一课一直到下一课', L('静夜思')?.parent === '古诗两首' && L('静夜思')?.pages.join() === '4,4' && L('春晓')?.pages.join() === '5,5' && L('古诗两首')?.pages.join() === '4,5');
check('◎ 开头的是语文园地;不缩进、没编号的是附录', L('语文园地一')?.kind === 'garden' && L('语文园地一')?.pages.join() === '6,8' && L('识字表')?.kind === 'other' && L('识字表')?.pages.join() === '9,9');
check('读得好的一册没有问题;文件名不带「数学」是课文的分法', ix.problems.length === 0 && ix.layout === 'prose', JSON.stringify(ix.problems));
const scanned = buildBookIndex([1, 2, 3].map((n) => ({ n, w: W, h: H, items: [] })), { file: 'x.pdf', sha: 'x', title: 'x' });
check('扫描的 PDF(没有文字层):说清读不出字,也没有页码、目录', scanned.problems.some((p) => p.includes('扫描')) && scanned.problems.some((p) => p.includes('页码')) && scanned.problems.some((p) => p.includes('目录')));
check('目录的每一项记下印在哪一行:从编号到页码(点线也算);缩进的那首从它自己的课名起', JSON.stringify(L('小鱼吹泡泡')?.toc) === JSON.stringify({ n: 1, box: [56, 213.68, 235.7, 231.68] }) && L('静夜思')?.toc?.box[0] === 106 && ix.lessons.every((l) => l.toc?.n === 1), JSON.stringify(ix.lessons.map((l) => l.toc)));
{
  // 别的出版社的目录:没有「目录」两个字、没有点线,课名左对齐、页码在右边空开一大截;正文里一行末尾带个数的不算
  const it = (s: string, x: number, y: number, z = 14) => ({ s, f: 't', x, y, z, w: Array.from(s).reduce((a, c) => a + (c.charCodeAt(0) < 0x2000 ? 0.55 : 1), 0) * z });
  const foot = (n: number) => it(String(n), 470, H - 49, 10);
  const other = buildBookIndex([
    { n: 1, w: W, h: H, items: [it('Hello 你好', 80, 200), it('2', 440, 200), it('Colours 颜色', 80, 240), it('5', 440, 240), it('Numbers 数字', 80, 280), it('8', 440, 280)] },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ n: n + 1, w: W, h: H, items: [it(n === 4 ? '一共有几个苹果?' : '正文', 80, 200), ...(n === 4 ? [it('3', 440, 200), it('还剩几个?', 80, 240), it('2', 440, 240)] : []), foot(n)] })),
  ], { file: 'x.pdf', sha: 'x', title: '英语一年级上册' });
  check('没有「目录」两个字、没有点线的目录也认:一行末尾空开一大截是页码;正文里带数的行不当目录', other.toc.join() === '1' && other.lessons.map((l) => `${l.title}@${l.from}:${l.pages.join('-')}`).join() === 'Hello你好@2:3-5,Colours颜色@5:6-8,Numbers数字@8:9-9' && other.lessons.every((l) => l.toc?.n === 1), JSON.stringify(other.lessons));
}
{
  // 统编语文有两个「古诗二首」(第 7 课、第 18 课)
  const twin = (no: string, from: number) => ({ title: '古诗二首', unit: null, no, kind: 'lesson' as const, from, to: from + 1, pages: [from, from + 1] as [number, number] });
  const ls = [twin('7', 39), twin('18', 81)];
  check('一样的课名:写了编号照编号找,没写是第一个;页上的名字带编号', findLesson(ls, '18 古诗二首')?.from === 81 && findLesson(ls, '古诗二首')?.from === 39 && lessonName(ls, ls[1]) === '18 古诗二首' && lessonName(ix.lessons, L('小鱼吹泡泡')!) === '小鱼吹泡泡');
}
check('找一课:课名、带编号、带书名号、只写一半', findLesson(ix.lessons, '小鱼吹泡泡')?.title === '小鱼吹泡泡' && findLesson(ix.lessons, '1 小鱼吹泡泡')?.title === '小鱼吹泡泡' && findLesson(ix.lessons, '《静夜思》')?.title === '静夜思' && findLesson(ix.lessons, '园地一')?.title === '语文园地一' && findLesson(ix.lessons, '坐井观天') === null);

// ---- 一课的结构 ----
const lp = (t: string) => { const l = L(t)!; return ix.pages.filter((p) => p.n >= l.pages[0] && p.n <= l.pages[1]); };
const fish = lp('小鱼吹泡泡');
const blocks = lessonBlocks(fish);
const paras = blocks.filter((b) => b.kind === 'para');
check('课文按缩进分段:第 2 段跨到下一页接着(下一页第一行顶格)', paras.length === 3 && paras[1].text === '小鱼说：“泡泡圆圆的，像一个个小月亮，飞到天上去。泡泡飞呀飞，飞进了井沿边的小花园。”' && paras[1].refs.map((r) => r.n).join() === '2,2,3', JSON.stringify(paras.map((p) => p.text)));
check('页眉不算;标题在前;正文后面隔开一截的认字栏、课后题各是一块(认字栏带读音)', blocks[0].kind === 'title' && blocks[0].text === '小鱼吹泡泡' && blocks.some((b) => b.kind === 'other' && b.text === '泡(pào)圆(yuán)像(xiàng)井(jǐng)沿(yán)') && blocks.some((b) => b.kind === 'other' && b.text.startsWith('读一读')));
const poem = lessonBlocks(lp('静夜思'));
check('诗:一句一段', poem.filter((b) => b.kind === 'para').map((b) => b.text).join('|') === '床前明月光，|疑是地上霜。');
const garden = lessonBlocks(lp('语文园地一'));
check('语文园地:按栏目分(跨页的栏目也认)', garden.filter((b) => b.kind === 'section').map((b) => b.head).join() === '识字加油站,字词句运用,日积月累' && garden[0].kind === 'title' && garden.find((b) => b.head === '识字加油站')!.text.includes('小(xiǎo)鱼(yú)'));

// ---- 分段的几种排法(照统编语文二上量的;直接造行,不走 PDF):字体名每页不一样、诗分节、下一页顶上是插图、认字栏那一排同字号 ----
{
  const ln = (text: string, x: number, y: number, z: number, f: string, adv = 1): BookLine => {
    const cs = Array.from(text);
    return { text, x1: x, x2: x + cs.length * z * adv, y1: y, y2: y + z, z, f, chars: cs.map((c, k) => ({ c, x1: x + k * z * adv, x2: x + k * z * adv + z })) };
  };
  const pg = (n: number, lines: BookLine[]): BookPage => ({ n, printed: n, w: 520, h: 736, lines });
  const head = [ln('树叶信', 220, 70, 27.5, 't'), ln('5', 180, 74, 21, 'n')];
  // 第一页的正文字体叫 a,后面两页叫 b(字更多):第一页的正文不能当成标题;第二页顶上是插图,正文从页中间起
  const a = pg(1, [...head, ln('秋天到了，风姑娘给大家送信。', 86, 150, 18, 'a'), ln('她把树叶轻轻地放进小河里。', 42, 190, 18, 'a')]);
  const b = pg(2, [ln('小河把信送到了小鱼家，小鱼读了读', 86, 390, 18, 'b'), ln('树叶上的字，吐了一串泡泡。', 42, 430, 18, 'b'), ln('小松鼠捡到一片红叶，赶紧去找松果，', 86, 470, 18, 'b')]);
  const c = pg(3, [ln('把松果藏进了大树洞里。', 42, 60, 18, 'b'), ln('秋汽越温滴奔海洋', 160, 160, 18, 'b', 1.44)]);
  const bs = lessonBlocks([a, b, c]);
  const ps = bs.filter((x) => x.kind === 'para');
  check('分段:一页上没有正文那种字体名,认这一页同字号里字最多的那种(第一页的正文不当标题)', ps[0]?.text.startsWith('秋天到了') && bs[0].kind === 'title' && bs[0].text === '树叶信 5', JSON.stringify(bs.map((x) => [x.kind, x.text])));
  check('分段:下一页顶上是插图、正文从页中间起,上面没有别的字也算接着', ps.length === 3 && ps[1].text.startsWith('小河') && ps[2].text === '小松鼠捡到一片红叶，赶紧去找松果，把松果藏进了大树洞里。', JSON.stringify(ps.map((x) => x.text)));
  check('分段:认字栏那一排(没标点、全是汉字、字距宽)同字号也不算正文', !ps.some((x) => x.text.includes('汽越')) && bs.some((x) => x.kind === 'other' && x.text === '秋汽越温滴奔海洋'));
  // 分节的诗:行距 40、节间 60;第 2 节从第一页底跨到第二页(翻页处正好换节)
  const verse = (y: number, t: string) => ln(t, 187, y, 18, 'p');
  const s1 = pg(1, [ln('风娃娃', 220, 60, 27.5, 't'), verse(146, '孩子如果已经长大，'), verse(186, '就得告别妈妈出发。'), verse(246, '蒲公英准备了小伞，'), verse(286, '把它送给自己的那些小娃娃。')]);
  const s2 = pg(2, [verse(107, '苍耳妈妈有个好办法，'), verse(147, '给孩子穿上小铠甲。'), verse(207, '植物妈妈的办法多，'), verse(247, '不信你就仔细观察。')]);
  const st = lessonBlocks([s1, s2]).filter((x) => x.kind === 'para');
  check('分段:诗一节一节空开一点就是一段;翻页处正好换节也分开', st.map((x) => x.text).join('|') === '孩子如果已经长大，就得告别妈妈出发。|蒲公英准备了小伞，把它送给自己的那些小娃娃。|苍耳妈妈有个好办法，给孩子穿上小铠甲。|植物妈妈的办法多，不信你就仔细观察。', JSON.stringify(st.map((x) => x.text)));
}

// ---- 点读:一课分成标题和一段一段,一段切成句;诗按节;舞台的钮在段首的空白里 ----
check('点读切句:句号、问号、叹号收一句,紧跟的引号跟着;空白去掉', readSentences('小鱼说：“泡泡圆圆的！”小鸟 听了。真的吗？').join('|') === '小鱼说：“泡泡圆圆的！”|小鸟听了。|真的吗？');
const longSay = readSentences('一'.repeat(70) + '，' + '二'.repeat(70) + '。');
check('点读切句:太长的一句在逗号处切开', longSay.length === 2 && longSay.every((x) => Array.from(x).length <= READ_SAY_MAX) && longSay.join('') === '一'.repeat(70) + '，' + '二'.repeat(70) + '。', JSON.stringify(longSay));
const reads = bookReadTexts(fish, blocks);
check('点读:标题(只读课名)在前,接着一段一块,句照段切', reads.map((x) => `${x.no}:${x.sents.join('/')}`).join('|') === '0:小鱼吹泡泡|1:小鱼在水里吹泡泡。|2:小鱼说：“泡泡圆圆的，像一个个小月亮，飞到天上去。/泡泡飞呀飞，飞进了井沿边的小花园。”|3:小鸟听了，也来吹泡泡。', JSON.stringify(reads));
const poemReads = bookReadTexts(lp('静夜思'), poem);
check('点读:诗一节一块(一行一段的并起来);标题读课名,再读标题下面的诗题', poemReads.map((x) => `${x.no}:${x.sents.join('/')}`).join('|') === '0:古诗两首/静夜思|1:床前明月光，/疑是地上霜。', JSON.stringify(poemReads));
check('点读:语文园地(按栏目分)不点读', bookReadTexts(lp('语文园地一'), garden).length === 0);
{
  const sh = bookSheets(fish, undefined, bookCut(ix.pages));
  const parts = bookReadParts(fish, sh, blocks);
  const p1 = parts.find((x) => x.no === 1)!, line1 = fish[0].lines.find((l) => l.text === '小鱼在水里吹泡泡。')!;
  const x1 = line1.x1 * sh[0].s;
  check('点读的钮:能点的是段首缩进的那两格(宽两个字,到第一个字为止);钮在正中;高连着头上的拼音', parts.length === 4 && Math.abs(p1.hit[2] - p1.hit[0] - 2 * 18 * sh[0].s) < 2 && Math.abs((p1.hit[0] + p1.hit[2]) / 2 - p1.dot[0]) < 1 && Math.abs(p1.hit[2] - x1) < 3 && p1.dot[0] < x1 && p1.dot[0] > x1 - 40 && p1.hit[1] < line1.y1 * sh[0].s - (line1.y2 - line1.y1) * sh[0].s * 0.9, JSON.stringify(p1));
  const t = parts.find((x) => x.no === 0)!;
  check('点读的钮:标题的钮在课名左边', t.dot[0] < fish[0].lines.find((l) => l.text === '小鱼吹泡泡')!.x1 * sh[0].s, JSON.stringify(t));
  // 正在读的那一句铺在哪:一句一行一个框,从这句第一个字到最后一个字,连着头上的拼音
  const p2 = parts.find((x) => x.no === 2)!;
  const fly = fish.flatMap((pg) => pg.lines.map((l) => ({ pg, l }))).find((x) => x.l.text.endsWith('泡泡飞呀'))!;
  const flyAt = Array.from(fly.l.text).indexOf('泡'), flySh = sh.find((x) => x.n === fly.pg.n)!;
  const says2 = p2.says[1] ?? [];
  check('点读的句框:第 2 段第 2 句从「泡泡飞呀」的第一个字起,跨页的段照行分框', p2.says.length === 2 && says2.length === 2 && says2[1][1] > flySh.top + flySh.height && Math.abs(says2[0][0] - fly.l.chars[flyAt].x1 * flySh.s) < 1 && says2[0][1] < (flySh.top + fly.l.y1 * flySh.s), JSON.stringify(p2.says));
  check('点读的句框:标题那一句只框课名(不框课号),每块每句都有框', Math.abs(t.says[0][0][0] - fish[0].lines.find((l) => l.text === '小鱼吹泡泡')!.x1 * sh[0].s) < 1 && parts.every((x) => x.says.length === x.sents.length && x.says.every((b) => b.length > 0)), JSON.stringify(parts.map((x) => x.says)));
}

// ---- 找位置 ----
const sheets = bookSheets(fish);
check('几页从上往下排:一页宽 1000,页间空一截', sheets.length === 2 && sheets[0].top === 0 && Math.abs(sheets[1].top - (1000 * H / W + 30)) < 0.01);
const t2 = bookTarget(fish, sheets, blocks, '第 2 段');
check('看第 2 段:框从第 1 页底跨到第 2 页顶', t2?.label === '第2段' && t2.box[1] < sheets[1].top && t2.box[3] > sheets[1].top, JSON.stringify(t2));
const t13 = bookTarget(fish, sheets, blocks, '第1-3段');
check('看第 1–3 段;第 2 页(整页);一句原话(不管标点)', t13?.label === '第1–3段' && Math.abs(bookTarget(fish, sheets, blocks, '第 2 页')!.box[1] - sheets[1].top) < 0.1 && bookTarget(fish, sheets, blocks, '泡泡飞呀飞，飞进了')?.box[3]! > sheets[1].top && bookTarget(fish, sheets, blocks, '开头')?.label === '开头');
check('看栏目名;认不出 = null', bookTarget(lp('语文园地一'), bookSheets(lp('语文园地一')), garden, '日积月累')?.label === '日积月累' && bookTarget(fish, sheets, blocks, '第 9 段') === null && bookTarget(fish, sheets, blocks, '没有这句话') === null);
const well = bookFind(fish, sheets, '井沿');
const hitWell = well ? bookPick(fish, sheets, (well[0] + well[2]) / 2, (well[1] + well[3]) / 2) : null;
check('圈字找到的框,点它中间就是那个字(带拼音)', Boolean(well) && hitWell?.c === '井' && hitWell.py === 'jǐng', JSON.stringify({ well, hitWell }));
const twice = bookFind(fish, sheets, '井沿', [0, sheets[1].top + 150, 1000, sheets[1].top + 450]);
check('同一个词出现两处:先找挨着窗的那一处(认字栏里的)', Boolean(twice && well && twice[1] > well[1] + 100), JSON.stringify({ twice, well }));
check('点在空白处、点到标点:不算', bookPick(fish, sheets, 5, 5) === null);
const rows13 = bookRows(fish, sheets, t13!.box);
check('没带 rows 的「看」照框挑字行:块里一行一段、从上到下,都在块里', rows13.length >= 3 && rows13.every((r, i) => r[1] >= t13!.box[1] - 0.5 && r[3] <= t13!.box[3] + 0.5 && r[0] < r[2] && (i === 0 || r[1] > rows13[i - 1][1])), JSON.stringify({ box: t13!.box, rows13 }));
const rowWell = well ? bookRows(fish, sheets, well) : [];
check('看一个词:只刷那几个字,不刷整行', rowWell.length === 1 && Math.abs(rowWell[0][0] - well![0]) < 1 && Math.abs(rowWell[0][2] - well![2]) < 1, JSON.stringify({ rowWell, well }));
check('没有文字层(白纸、照片没认完):没有字行,舞台整块铺', bookRows([], sheets, t13!.box).length === 0);
const lines13 = paras.flatMap((b) => b.refs).length;
check('「看」带上字行(舞台照它刷荧光):几段就是这几段的行,从上到下;跨页的段不把两页中间的东西带进来', t13!.rows.length === lines13 && t13!.rows.every((r, i) => i === 0 || r[1] > t13!.rows[i - 1][1]) && t2!.rows.length === paras[1].refs.length, JSON.stringify({ lines13, rows: t13!.rows.length }));
const pg2 = bookTarget(fish, sheets, blocks, '第 2 页')!;
check('看整页:字行不带页眉', pg2.rows.length > 0 && pg2.rows.length < fish[1].lines.length && pg2.rows.every((r) => r[1] > sheets[1].top), JSON.stringify({ rows: pg2.rows.length, lines: fish[1].lines.map((l) => l.text) }));
const span = bookTarget(fish, sheets, blocks, '泡泡飞呀飞，飞进了')!;
check('看跨行的一句原话:每行只刷那一截', span.rows.length === 2 && span.rows[0][1] < sheets[1].top && span.rows[1][1] > sheets[1].top && span.rows.every((r) => r[3] - r[1] < 40), JSON.stringify(span.rows));
check('窗里看得见什么:哪几页、哪几段', bookView(fish, sheets, blocks, [0, 0, 1000, sheets[1].top + 300]) === '第 1–2 页:第 1–3 段' && bookView(fish, sheets, blocks, [0, sheets[1].top + 350, 1000, sheets[1].top + 700]).startsWith('第 2 页:课文后面'), bookView(fish, sheets, blocks, [0, 0, 1000, sheets[1].top + 300]));

// ---- 课本的几何(画法「课本」那张卡 2026-11-16 删了,老师写动作;几何还在) ----
check('窗:要看的那一块留边;没给就是第一页上面;太小就放大到页宽的三分之一为止', bookFrame(t2!.box, sheets)[1] < t2!.box[1] && bookFrame(null, sheets)[1] === 0 && bookFrame([500, 500, 520, 520], sheets)[2] >= 333);
// 页底没有字的那一条不铺、页和页直接连着;没裁的照原来整页排、中间空一条
const cut = bookCut(ix.pages);
const joined = bookSheets(fish, undefined, cut);
const lowest = Math.max(...ix.pages.flatMap((p) => p.lines.map((l) => (l.y2 * 1000) / p.w)));
check('裁页底:整册一个数,印得最低的那行字还在;裁了的页直接连着,字的位置在页里不变', cut > 0 && cut === bookCut(ix.pages) && (H * 1000) / W - cut > lowest && joined[1].top === joined[0].height && joined[0].height === sheets[0].height - cut && bookFind(fish, joined, '井沿')?.[0] === bookFind(fish, sheets, '井沿')?.[0]);
check('没裁的页之间空着', sheets[1].top === sheets[0].height + 30);
check('页的存法读回来', bookPages('59-60').join() === '59,60' && bookPages('x').length === 0);

// ---- 数学课本 ----
const mx = mathIndexOf();
check('数学:文件名带「数学」照数学分;页脚是页码挨着单元名(拆成几段)的,页码取最靠页边的那个', mx.layout === 'math' && mx.problems.length === 0 && mx.pages.map((p) => p.printed ?? '-').join(' ') === '- 1 2 3 4 5 6 7 8' && printedOf(mathPages[4]) === 4, JSON.stringify(mx.pages.map((p) => p.printed)));
const ML = (t: string) => mx.lessons.find((l) => l.title === t);
check('没有点线的目录:序号、单元名、页码各一段也认;没序号的是综合实践', mx.toc.join() === '1' && ML('分类与整理')?.no === '一' && ML('分类与整理')?.pages.join() === '2,3' && ML('1～6的表内乘法')?.no === '二' && ML('1～6的表内乘法')?.pages.join() === '4,7' && ML('校园小导游')?.kind === 'garden' && ML('校园小导游')?.no === null, JSON.stringify(mx.lessons));
check('没点线的目录:一项的范围从左边的大号序号到页码;页里读出来的小节、课题不在目录上', ML('1～6的表内乘法')?.toc?.box[0] === 79 && (ML('1～6的表内乘法')?.toc?.box[2] ?? 0) > 455 && !ML('5的乘法口诀')?.toc, JSON.stringify(ML('1～6的表内乘法')?.toc));
{
  const t = tocEntries({ file: '数学.pdf', index: mx })!;
  check('目录上能点的几项:场景坐标、点了铺那个单元(铺不下的照最多几页)', t.page.title === '目录' && t.entries.map((e) => `${e.title}:${e.page.pages.join(',')}`).join(' ') === '分类与整理:2,3 1～6的表内乘法:4,5,6,7 校园小导游:8,9' && t.entries.every((e) => e.box[0] > 100 && e.box[2] > e.box[0]), JSON.stringify(t.entries));
  const mb = { file: '数学.pdf', index: mx };
  const back = lessonOpen(lessonInit(), mb, '校园小导游');
  const want = lessonOpen(lessonInit(), mb, '校园小导游', '5的乘法口诀');
  check('进门铺哪:家长填的范围那一课 → 上次翻到的那一课 → 目录(没记过、找不到的从页顶看)', back.at === '数学.pdf#校园小导游' && want.at === '数学.pdf#5的乘法口诀' && lessonOpen(lessonInit(), mb, '校园小导游', '没有这课').at === '数学.pdf#校园小导游' && lessonOpen(lessonInit(), mb).view === null && lessonOpen(lessonInit(), mb, '没有这课').at === '数学.pdf#目录' && lessonOpen(lessonInit(), mb, '没有这课').view === null, JSON.stringify([back.at, want.at]));
}
check('单元下面的小节、课题从页里的标题读出来:上一层是 parent;课题止于下一个课题', ML('1.乘法的初步认识')?.parent === '1～6的表内乘法' && ML('1.乘法的初步认识')?.pages.join() === '5,7' && ML('5的乘法口诀')?.parent === '1.乘法的初步认识' && ML('5的乘法口诀')?.pages.join() === '6,6' && ML('6的乘法口诀')?.pages.join() === '7,7' && ML('认识东、南、西、北')?.parent === '校园小导游', JSON.stringify(mx.lessons));
check('图里的大字(便利店)、栏目名(练一练、你知道吗)、翻页后再印一次的综合实践名不算一课', mx.lessons.length === 7 && !mx.lessons.some((l) => ['便利店', '练一练', '你知道吗？'].includes(l.title)) && mx.lessons.filter((l) => l.title === '校园小导游').length === 1, mx.lessons.map((l) => l.title).join());
check('找一课:课名里的数不当编号去掉(6的乘法口诀 ≠ 5的乘法口诀);小节的「1.」可写可不写', findLesson(mx.lessons, '6的乘法口诀')?.title === '6的乘法口诀' && findLesson(mx.lessons, '5的乘法口诀')?.title === '5的乘法口诀' && findLesson(mx.lessons, '乘法的初步认识')?.title === '1.乘法的初步认识' && findLesson(mx.lessons, '1.乘法的初步认识')?.title === '1.乘法的初步认识');
const unit = bookLesson(mx, '1～6的表内乘法')!.pages;
const mb = lessonBlocks(unit, 'math');
const kinds = mb.map((b) => (b.kind === 'example' ? `例${b.no}` : b.kind === 'problem' ? `${b.head}${b.no}` : b.kind === 'section' ? `【${b.head}】` : b.kind === 'title' ? `#${b.text}` : b.kind)).join(' ');
check('数学一课的块:标题(单元页的序号和单元名合成一个)、例题、栏目、栏目下面的题,按页的先后', kinds === '#二 1～6的表内乘法 other #1.乘法的初步认识 例1 【你知道吗？】 #5的乘法口诀 例2 【练一练】 练一练1 练一练2 练一练3 练一练4 #6的乘法口诀 例3 例4', kinds);
const B = (k: string, no?: number) => mb.find((b) => b.kind === k && (no === undefined || b.no === no))!;
check('例题号和题目同一行(空开一截)、单独一行都认;题目数字起头的(4 + 18袋饼干)也分得开;「17世纪」挨着字的不是例题', B('example', 4).text === '18袋饼干，每2袋一份。' && B('example', 1).text.startsWith('（1）小飞机里共有多少人？') && B('example', 2).text.startsWith('5×1=5') && B('section').text === '17世纪开始使用的乘号。', JSON.stringify(mb.map((b) => b.text)));
check('题号比题目低一点也算这道题的;页顶的题号不当页码;并排的两道题各管各的那一栏', B('problem', 1).text === '算一算，说一说口诀。' && B('problem', 3).text === '填一填。 5×2=' && B('problem', 4).text === '连一连。 3×5=', JSON.stringify(mb.filter((b) => b.kind === 'problem').map((b) => b.text)));
check('页脚(页码、挨着的单元名)不进任何一块;单元页上的引导语、图里的字另成一块,不并进标题', !mb.some((b) => b.text.includes('的表内乘法') && b.kind !== 'title') && mb[1].kind === 'other' && mb[1].text === '便利店 请提出用加法解决的问题，写出算式。', JSON.stringify(mb.slice(0, 2)));
const ms = bookSheets(unit);
const look = (q: string) => bookTarget(unit, ms, mb, q);
check('看:例 2、练一练第 4 题、只写第 3 题(这一课第一个第 3 题)', look('例 2')?.label === '例2' && look('练一练第 4 题')?.label === '练一练第4题' && look('第3题')?.label === '练一练第3题' && look('做一做第 1 题') === null && look('例 7') === null);
const lx = look('练一练')!, p4 = look('练一练第4题')!;
check('看栏目名:连着下面的题(跨页也连上)', lx.label === '练一练' && lx.box[3] >= p4.box[3] && lx.box[1] < ms[3].top, JSON.stringify({ lx, p4 }));
check('窗里看得见什么:例几、栏目;栏目名没露出来的说哪个栏目第几题', bookView(unit, ms, mb, [0, ms[2].top, 1000, ms[2].top + ms[2].height]) === '第 5 页:例2、练一练' && bookView(unit, ms, mb, [0, ms[3].top, 1000, ms[3].top + 300]) === '第 6 页:练一练第 3–4 题', bookView(unit, ms, mb, [0, ms[3].top, 1000, ms[3].top + 300]));
const toc2 = bookSlateParts(mx, bookLesson(mx, null)!);
check('给老师的目录:一个单元一行,后面是小节、课题(课题带点);综合实践也一行', toc2.text.join('|') === '一 分类与整理(1)|二 1～6的表内乘法(3):1.乘法的初步认识(4)、·5的乘法口诀(5)、·6的乘法口诀(6)|校园小导游(7):认识东、南、西、北(7)', JSON.stringify(toc2.text));
const five = bookSlateParts(mx, bookLesson(mx, '5的乘法口诀')!);
check('给老师的一课:标题、例题、栏目、第几题', five.show === '课本《数学二年级上册》:《5的乘法口诀》第 5 页' && five.text.join('|') === '标题:5的乘法口诀|例2 5×1=5 一五得五|【练一练】|第1题 算一算，说一说口诀。|第2题 照样子连一连，再说一说。', JSON.stringify(five));
const mbook = { file: '数学二年级上册.pdf', index: mx };
const opened = lessonOpen(lessonInit(), mbook);
const f1 = fitActs(opened, [{ name: '翻', arg: '5的乘法口诀' }, { name: '看', arg: '例 2' }], { book: mbook });
const look1 = f1.acts[1].do as { k: string; label: string; box: number[]; rows?: number[][] } | undefined;
check('落到页上:数学课的「看 例 2」照数学的分法换成框', (f1.acts[0].do as { page: { pages: number[] } }).page.pages.join() === '6' && look1?.label === '例2' && look1.box.length === 4 && Boolean(look1.rows?.length) && f1.lesson.look?.rows?.length === look1.rows!.length, JSON.stringify(f1.acts));
const guide = bookLesson(mx, '校园小导游')!.pages;
const gs = bookSheets(guide);
const twelve = bookFind(guide, gs, '12');
check('找字:在一行里的那一处优先(表头末尾的 1 接下一格的 2 凑出的「12」不算)', Boolean(twelve) && twelve![1] > gs[1].top + (310 * 1000) / MW, JSON.stringify(twelve));
const fit2 = fitActs(f1.lesson, [{ name: '盖', arg: '5×1=5、没有的式子' }], { book: mbook });
const cov = fit2.acts[0].do as { k: string; spots: { text: string; box: number[] }[] } | undefined;
check('盖:写课本上印的算式,落到页上换成框;找不到的不画、记下来', cov?.spots.length === 1 && cov.spots[0].text === '5×1=5' && cov.spots[0].box.length === 4 && fit2.why.length === 1 && fit2.why[0].includes('没有的式子'), JSON.stringify(fit2));
const long = { ...mx, lessons: [{ title: '长', unit: null, no: null, kind: 'lesson' as const, from: 1, to: 30, pages: [1, 30] as [number, number] }], pages: Array.from({ length: 30 }, (_, k) => ({ n: k + 1, printed: k, w: 500, h: 700, lines: [] })) };
check(`一课太长(数学一个小节十几页)只铺前 ${BOOK_MAX_PAGES} 页;「页」也最多这么多`, bookLesson(long, '长')?.pages.length === BOOK_MAX_PAGES && bookPages(`1-${BOOK_MAX_PAGES}`).length === BOOK_MAX_PAGES && bookPages(`1-${BOOK_MAX_PAGES + 1}`).length === 0);

// ---- 科学课本 ----
const sx = scienceIndexOf();
const SL = (t: string) => sx.lessons.find((l) => l.title === t);
check('科学:文件名带「科学」是 science 的分法;读得好的没有问题', sx.layout === 'science' && sx.problems.length === 0, JSON.stringify(sx.problems));
const sq = sx.pages[3].lines.find((l) => l.text.startsWith('从上述'));
check('Unicode 拼音(ɡ 当 g、ɑ 当 a)配到字上,不单成一行', sq?.chars.map((c) => c.py ?? '_').join(' ') === 'cóng shàng shù xiàn xiàng zhōng _ nǐ fā xiàn le shén ma _' && !sx.pages[3].lines.some((l) => /[a-zɡɑ]/.test(l.text)), JSON.stringify(sq?.chars));
check('目录:「/ 页码」也认;带页码的单元自己是一项、只管单元页;「第1课」是课号', SL('空气和水')?.unit === '第1单元 空气和水' && SL('空气和水')?.no === null && SL('空气和水')?.pages.join() === '2,2' && SL('认识空气')?.no === '1' && SL('认识空气')?.unit === '第1单元 空气和水' && SL('认识空气')?.pages.join() === '3,4' && SL('观察水')?.pages.join() === '5,5' && JSON.stringify(SL('认识空气')?.toc?.box.slice(0, 1)) === '[82]', JSON.stringify(sx.lessons));
const air = bookLesson(sx, '认识空气')!.pages;
const sb = lessonBlocks(air, 'science');
check('科学的一课:栏目带序号;段号整课连着数;段记着在哪个栏目下', sb.filter((b) => b.kind === 'section').map((b) => b.head).join() === '问题与想法 1,探索与实践 1,讨论与发现 1,思考与练习' && sb.filter((b) => b.kind === 'para').map((b) => `${b.no}${b.head ?? ''}`).join() === '1,2问题与想法 1,3探索与实践 1,4探索与实践 1,5讨论与发现 1,6思考与练习', JSON.stringify(sb));
check('科学:和正文并排的安全提示不打断这一段;跨页的栏目接着', sb.find((b) => b.no === 3)?.text === '准备一个保鲜袋，观察袋内是否有东西。' && sb.some((b) => b.kind === 'other' && b.text === '不要被牙签扎到。' && b.head === '探索与实践 1') && sb.find((b) => b.no === 5)?.refs[0].n === 4);
const ss = bookSheets(air);
const ex1 = bookTarget(air, ss, sb, '探索与实践1');
check('看栏目(空格可有可无):连着这个栏目下的段、提示、表,到下一个栏目为止', ex1?.label === '探索与实践 1' && ex1.rows.length === 7 && bookTarget(air, ss, sb, '探索与实践 1')?.rows.length === 7, JSON.stringify(ex1));
check('科学点读:标题读课名(去掉「第1课」),一段一块', bookReadTexts(air, sb).map((x) => `${x.no}:${x.sents.join('/')}`).slice(0, 2).join('|') === '0:认识空气|1:雨后的公园里，他们在说什么？', JSON.stringify(bookReadTexts(air, sb)));
const sp = bookSlateParts(sx, bookLesson(sx, '认识空气')!);
check('给老师的科学课:栏目、段、图里的字', sp.text.includes('【探索与实践 1】') && sp.text.includes('第3段 准备一个保鲜袋，观察袋内是否有东西。') && sp.text.includes('空气在哪里？'), JSON.stringify(sp));
check('给老师的科学目录:一个单元一行,单元页也是一项', bookSlateParts(sx, bookLesson(sx, null)!).text.join('|') === '第1单元 空气和水:空气和水(1)、1 认识空气(2)、2 观察水(4)', JSON.stringify(bookSlateParts(sx, bookLesson(sx, null)!).text));

// ---- 挑这学期的那一册 ----
const names = ['语文二年级上册.pdf', '语文二年级下册.pdf'];
check('挑这学期的那一册:2–7 月下册,其余上册;只有一册就是它', pickBook(names, new Date(2026, 2, 1)) === '语文二年级下册.pdf' && pickBook(names, new Date(2026, 10, 14)) === '语文二年级上册.pdf' && pickBook(['语文.pdf'], new Date()) === '语文.pdf' && pickBook([], new Date()) === null);

done();
