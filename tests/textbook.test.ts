/**
 * 课本(src/memory/textbook-index.ts 读 PDF 的文字,src/chalk/kit/book.ts 找位置、画法「课本」)。
 * 用的是照人教统编版排法造的一本小书(字是编的,不放真教材的文字):
 *   PDF 第 1 页是目录;印刷页码 = PDF 页 − 1,页码印在页脚;
 *   《小鱼吹泡泡》1–2 页:正文带拼音(自造编码:jJng = jǐng),第 1 段一行、第 2 段从第 1 页底跨到第 2 页顶,后面是认字栏;
 *   《古诗两首》3–4 页,下面两首各一页;语文园地一 5–7 页,按栏目分(第 7 页空着);识字表在最后。
 */
import { BOOK_KIT, bookFind, bookFrame, bookPages, bookPick, bookSheets, bookSpots, bookTarget, bookView, findLesson, kitOf, lessonBlocks, readKitLines } from '../src/chalk/index.ts';
import { buildBookIndex, decodePinyin, pageLines } from '../src/memory/textbook-index.ts';
import { pickBook } from '../src/memory/textbook-pdf.ts';
import { H, W, pages } from './_book.ts';
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
check('读得好的一册没有问题', ix.problems.length === 0, JSON.stringify(ix.problems));
const scanned = buildBookIndex([1, 2, 3].map((n) => ({ n, w: W, h: H, items: [] })), { file: 'x.pdf', sha: 'x', title: 'x' });
check('扫描的 PDF(没有文字层):说清读不出字,也没有页码、目录', scanned.problems.some((p) => p.includes('扫描')) && scanned.problems.some((p) => p.includes('页码')) && scanned.problems.some((p) => p.includes('目录')));
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
check('窗里看得见什么:哪几页、哪几段', bookView(fish, sheets, blocks, [0, 0, 1000, sheets[1].top + 300]) === '第 1–2 页:第 1–3 段' && bookView(fish, sheets, blocks, [0, sheets[1].top + 350, 1000, sheets[1].top + 700]).startsWith('第 2 页:课文后面'), bookView(fish, sheets, blocks, [0, 0, 1000, sheets[1].top + 300]));

// ---- 画法「课本」 ----
const kit = kitOf(BOOK_KIT)!;
const r = readKitLines(kit, ['课: 小鱼吹泡泡', '看: 第 2 段', '圈: 井沿、泡泡', '遮: 圆', '读一读这一段。']);
check('老师写课、看、圈、遮;书和页由应用填;不写操作 = 点字、圈、画都开(不用认图)', r.params['课'] === '小鱼吹泡泡' && r.params['看'] === '第 2 段|' && r.params['圈'] === '井沿|;泡泡|' && r.params['遮'] === '圆|' && r.ops.join() === '点字,圈,画' && r.prompt === '读一读这一段。', JSON.stringify(r));
const errOf = (f: () => unknown): string => { try { f(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); } };
check('写错了抛,说清怎么写', errOf(() => readKitLines(kit, ['圈: 一二三四五六七八九十一二三'])).includes('12 个字以内') && errOf(() => readKitLines(kit, ['书: /etc/passwd.pdf'])).includes('应用填') && errOf(() => readKitLines(kit, ['页: 九'])).includes('59-60'));
const filled = { ...r.params, 书: '语文一年级下册.pdf', 页: '2-3', 看: `第2段|${t2!.box.join(' ')}`, 圈: `井沿|${well!.join(' ')}`, 遮: `圆|${bookFind(fish, sheets, '圆')!.join(' ')}` };
const scene = kit.build(filled, { aspect: H / W });
check('画面:底是那两页、窗对着第 2 段、圈和盖拼音的块(id 以 cover- 起头)', scene.book?.src === '语文一年级下册.pdf' && scene.book.pages.join() === '2,3' && scene.frame![1] < t2!.box[1] && scene.frame![1] + scene.frame![3] > t2!.box[3] && scene.skeletons.some((s) => s.type === 'ellipse' && s.label === '老师圈的:井沿') && scene.skeletons.some((s) => s.id === 'cover-圆'), JSON.stringify(scene.frame));
check('没写看:窗在第一页上面;要看的太小就放大到页宽的三分之一为止', bookFrame(null, sheets)[1] === 0 && bookFrame([500, 500, 520, 520], sheets)[2] >= 333);
check('页、圈的存法读回来', bookPages('59-60').join() === '59,60' && bookPages('x').length === 0 && bookSpots('井沿|1 2 3 4;泡泡|')[1].box === null && bookSpots('井沿|1 2 3 4')[0].box?.join() === '1,2,3,4');
check('孩子画了:说在第几页哪一截,圈住什么看图', kit.read(filled, { marks: [[[100, 1200], [200, 1250]]], aspect: H / W }, scene).includes('PDF 第 2 页下面'));

// ---- 挑这学期的那一册 ----
const names = ['语文二年级上册.pdf', '语文二年级下册.pdf'];
check('挑这学期的那一册:2–7 月下册,其余上册;只有一册就是它', pickBook(names, new Date(2026, 2, 1)) === '语文二年级下册.pdf' && pickBook(names, new Date(2026, 10, 14)) === '语文二年级上册.pdf' && pickBook(['语文.pdf'], new Date()) === '语文.pdf' && pickBook([], new Date()) === null);

done();
