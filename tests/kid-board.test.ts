/** 板书纯逻辑:标注锚点、条目 → 节、播放状态机、字幕行、输入条、布局。页面内联的就是这份代码。 */
import {
  anchorMarks,
  barNext,
  cardTexts,
  cardTitle,
  findPhrase,
  hasState,
  isHeavy,
  lectureReady,
  segmentAudio,
  stateSummary,
  pickedLabels,
  togglePick,
  isHeading,
  isQuestion,
  deviceFor,
  lineDurationMs,
  beatsOf,
  readyBeats,
  lineTarget,
  lookFor,
  isAskCard,
  nowCard,
  penBox,
  penFor,
  penPath,
  rowsFor,
  rowCols,
  canHalf,
  fitsHalf,
  type CardFit,
  tintFor,
  phrasesIn,
  plainLine,
  playerAtEnd,
  sectionTitle,
  sectionsFromMessages,
  liveHead,
  askCard,
  kidSaid,
  type BoardCard,
  type BoardLine,
  type BoardSection,
} from '../src/board/presentation.ts';
import { wordLayout } from '../src/ui/kid/word-layout.ts';
import { check, done } from './_check.ts';

const L = (text: string, extra: Partial<BoardLine> = {}): BoardLine => ({ text, audio: null, marks: [], ask: isQuestion(text), anchor: null, cues: [], ...extra });
const cards: BoardCard[] = [
  { kind: 'text', props: { style: 'cover', title: '画蛇添足', text: '一个成语' } },
  { kind: 'text', props: { style: 'note', text: '画蛇添足 = 多做一步,反而坏事' } },
  { kind: 'read', props: { segments: ['楚有祠者', '先成者饮酒'] } },
  { kind: 'choice', props: { question: '酒是谁的?', options: ['他自己的', '第二个画完的'] } },
  { kind: 'text', props: { text: '做到了还要多做一步' } },
  { kind: 'gizmo', props: { bundle: 'x', title: '场景' } },
];
const lectureCard: BoardCard = { kind: 'lecture', props: { bundle: '2026-09-04-guilv5', text: '再看一遍', title: '找规律', ready: true, start: 0, end: 8000 } };

{
  check('卡上的字都能被找到;不认识的 kind 拿 props 里的字符串', cardTexts(cards[2]).join('|') === '楚有祠者|先成者饮酒' && cardTexts(cards[3]).join('|') === '酒是谁的?|他自己的|第二个画完的' && cardTexts(cards[5]).join('|') === 'x|场景' && cardTexts(cards[0])[0] === '画蛇添足');
  const marks = anchorMarks(cards, ['多做一步,反而坏事', '先成者饮酒', '第二个画完的', '不存在的词', '  ']);
  check('方括号的词落到第一张含它的卡;找不到的丢掉', JSON.stringify(marks.map((m) => m.card)) === '[1,2,3]', JSON.stringify(marks));
  check('整词匹配:数字 / 拉丁词不落在别的数字 / 词里,中文照子串', findPhrase('9 加 16 等于 25', '5') === -1 && findPhrase('选 5 个', '5') === 2 && findPhrase('25 和 5', '5') === 5 && findPhrase('and an', 'an') === 4 && findPhrase('三角形的面积', '面积') === 4 && findPhrase('x', '') === -1 && findPhrase('5', '5') === 0);
  const numCards: BoardCard[] = [{ kind: 'text', props: { text: '9 加 16 等于 25' } }, { kind: 'choice', props: { question: '斜边是多少?', options: ['6', '7', '5'] } }];
  check('讲稿 [5] 落到选项 5 的卡,不落在「25」里', anchorMarks(numCards, ['5'])[0].card === 1 && anchorMarks(numCards, ['25'])[0].card === 0);
  check('画蛇添足 落到封面(第一张含它的)', anchorMarks(cards, ['画蛇添足'])[0].card === 0);
  check('讲稿里的 [词] 按顺序取出,念的时候去括号', phrasesIn('它有两个来头:[出处]在《战国策》,[用法]是批评人。').join() === '出处,用法' && plainLine('[画蛇添足]是成语') === '画蛇添足是成语');
  // ---- 素版的机械规则:底色槽、字形槽、笔;后期定了 look / pen 就用它 ----
  const def: BoardCard = { kind: 'text', props: { title: '认边', text: '两条短边叫直角边,最长的一条叫斜边' } };
  const plain: BoardCard = { kind: 'text', props: { text: '一个直角三角形,斜边是 13' } };
  const formula: BoardCard = { kind: 'text', props: { style: 'formula', text: '直角边² + 直角边² = 斜边²' } };
  check('底色槽:# 标题 sky、素文 sand、formula paper、后期定的优先、做题的紫、点读米、图 / 小课堂 / 代码白', tintFor(cards[0]) === 'sky' && tintFor(def) === 'sky' && tintFor(plain) === 'sand' && tintFor(cards[1]) === 'sand' && tintFor(formula) === 'paper' && tintFor({ kind: 'text', props: { text: 'x' }, look: { tint: 'night' } }) === 'night' && tintFor(cards[3]) === 'plum' && tintFor(cards[4]) === 'sand' && tintFor({ kind: 'canvas', props: {} }) === 'plum' && tintFor(cards[2]) === 'sand' && tintFor(lectureCard) === 'paper' && tintFor({ kind: 'image', props: {} }) === 'paper');
  check('后期定的 look 优先', tintFor({ ...plain, look: { tint: 'moss' } }) === 'moss' && lookFor({ ...plain, look: { look: 'quote' } }) === 'quote');
  check('字形槽:formula → formula、后期定的优先,其余 plain', lookFor(cards[1]) === 'plain' && lookFor(formula) === 'formula' && lookFor({ kind: 'text', props: { text: 'x' }, look: { look: 'title' } }) === 'title' && lookFor(def) === 'plain' && lookFor(cards[3]) === 'plain');
  check('笔:选项 box、问题里的词 underline、点读 marker、公式 / 大字 marker、标题位 circle、数字 underline、正文里的词 tint;后期定的 pen 页面直接用', penFor(cards[3], '他自己的') === 'box' && penFor(cards[3], '酒') === 'underline' && penFor(cards[2], '楚有祠者') === 'marker' && penFor(formula, '斜边') === 'marker' && penFor({ kind: 'text', props: { text: '多做一步' }, look: { look: 'title' } }, '多做一步') === 'marker' && penFor(cards[1], '多做一步') === 'tint' && penFor(cards[0], '画蛇添足') === 'circle' && penFor(def, '认边') === 'circle' && penFor(def, '直角边') === 'tint' && penFor({ kind: 'text', props: { title: '验证', text: '9 加 16 等于 25' } }, '25') === 'underline' && penFor(lectureCard, '找规律') === 'underline');
  const hd: BoardCard = { kind: 'text', props: { title: '两大类型', text: '', heading: true } };
  check('小节标题不是卡:没有能标注的字,sectionTitle 优先拿它', isHeading(hd) && !isHeading(def) && cardTexts(hd).length === 0 && sectionTitle({ cards: [hd, def], lines: [] }) === '两大类型');
  // ---- 行(2026-10-01 排版归代码):每张卡半宽或全宽,相邻两张半宽并一行;明写的并排照办;手机上折;标题行与有状态的卡独占 ----
  const sec: BoardSection = { cards: [cards[0], def, formula, cards[3], plain, hd, cards[1]], lines: [] };
  check('没量过就按字数估:字少的文字卡半宽,两两并一行;别的种类(选择题)估不了算全宽,标题行独占', JSON.stringify(rowsFor(sec, 'tablet-landscape')) === '[[0,1],[2],[3],[4],[5],[6]]');
  check('一行几列:两张并排两列;落单的半宽卡两列(占左半);全宽一列', rowCols(sec, [0, 1]) === 2 && rowCols(sec, [2]) === 2 && rowCols(sec, [3]) === 1 && rowCols(sec, [5]) === 1);
  const measured = (i: number): boolean => i === 1 || i === 2 || i === 3 || i === 4;
  const canvasCard: BoardCard = { kind: 'canvas', props: { prompt: '画一画' } };
  check('量出来的优先:选择题量得下也半宽,和后面半宽的并一行;画板量成半宽也不算', JSON.stringify(rowsFor(sec, 'tablet-landscape', measured)) === '[[0],[1,2],[3,4],[5],[6]]' && rowCols(sec, [0], measured) === 1 && rowCols({ cards: [canvasCard], lines: [] }, [0], () => true) === 1 && JSON.stringify(rowsFor({ cards: [def, canvasCard, plain], lines: [] }, 'tablet-landscape', () => true)) === '[[0],[1],[2]]');
  const laid: BoardSection = { ...sec, layout: { for: 'tablet-landscape', rows: [[0], [1, 2], [3, 4], [5, 6]] } };
  check('明写的并排同端照办(量成全宽也并,选择题也能并);碰上标题行拆开,拆出来的按宽度排', JSON.stringify(rowsFor(laid, 'tablet-landscape', () => false)) === '[[0],[1,2],[3,4],[5],[6]]' && JSON.stringify(rowsFor(laid, 'tablet-landscape')) === '[[0],[1,2],[3,4],[5],[6]]');
  const three: BoardSection = { ...sec, layout: { for: 'tablet-landscape', rows: [[0, 1, 2], [3], [4], [5], [6]] } };
  check('明写 3 张一行:同端照办;到手机上拆开再按宽度排;明写的两张有长卡,手机上也拆', JSON.stringify(rowsFor(three, 'tablet-landscape')) === '[[0,1,2],[3],[4],[5],[6]]' && JSON.stringify(rowsFor(three, 'phone')) === '[[0,1],[2],[3],[4],[5],[6]]' && JSON.stringify(rowsFor({ cards: [def, { kind: 'text', props: { text: '这一张卡的正文超过二十个字所以在手机上不能和别人并排' } }], lines: [], layout: { for: 'tablet-landscape', rows: [[0, 1]] } }, 'phone')) === '[[0],[1]]');
  check('layout 没盖住全部卡 / 顺序乱了 → 不用它,全按宽度排', JSON.stringify(rowsFor({ ...sec, layout: { for: 'phone', rows: [[0, 1]] } }, 'phone', () => false)) === '[[0],[1],[2],[3],[4],[5],[6]]' && JSON.stringify(rowsFor({ cards: [def, plain], lines: [], layout: { for: 'phone', rows: [[1, 0]] } }, 'phone')) === '[[0,1]]');
  {
    // 流式一张张来:第 k 张来时前面的行不变(只看前面的卡)
    const full = rowsFor(sec, 'tablet-landscape', measured);
    const stable = sec.cards.every((_c, k) => {
      const part = rowsFor({ ...sec, cards: sec.cards.slice(0, k + 1), partial: true }, 'tablet-landscape', measured);
      return JSON.stringify(part.slice(0, -1)) === JSON.stringify(full.filter((r) => r[r.length - 1] < k).slice(0, part.length - 1)) && part[part.length - 1].includes(k);
    });
    check('流式:每来一张,前面的行和整节排出来的一样', stable);
  }
  {
    const fit = (lines: number, extra: Partial<CardFit> = {}): CardFit => ({ half: 100, full: 80, lines, overflow: false, ...extra });
    const code: BoardCard = { kind: 'code', props: { text: '🟧🟧🟧' } };
    check('能半宽的种类:文字、点读、代码、田字格、单词卡、选择题;标题行、提问卡、画板、小课堂、图不行;大字的照量', canHalf(def) && canHalf(cards[2]) && canHalf(code) && canHalf(cards[3]) && canHalf(cards[4]) && !canHalf({ kind: 'canvas', props: {} }) && canHalf({ kind: 'tianzige', props: { chars: '鼓' } }) && canHalf({ kind: 'word', props: { word: 'apple' } }) && !canHalf(hd) && !canHalf({ kind: 'text', props: { text: '?', ask: true } }) && !canHalf(lectureCard) && !canHalf({ kind: 'image', props: { src: 'a.png' } }) && canHalf({ ...def, look: { look: 'title' } }) && canHalf({ kind: 'word', props: { word: 'yellow' }, look: { look: 'title' } }));
    check('文字卡看半宽时几行:平板 ≤ 4、手机 ≤ 2;横着溢出不行', fitsHalf(def, 'tablet-landscape', fit(4)) && !fitsHalf(def, 'tablet-landscape', fit(5)) && fitsHalf(def, 'phone', fit(2)) && !fitsHalf(def, 'phone', fit(3)) && !fitsHalf(def, 'tablet-portrait', fit(1, { overflow: true })));
    check('公式 / 代码 / 田字格 / 单词卡 / 选择题:半宽时不比全宽高(没折行)才行;画板量成什么都不行', fitsHalf(formula, 'tablet-landscape', fit(1, { half: 60, full: 60 })) && !fitsHalf(formula, 'phone', fit(2, { half: 90, full: 60 })) && fitsHalf(code, 'tablet-landscape', fit(0, { half: 80 })) && fitsHalf(code, 'tablet-landscape', fit(0, { half: 81 })) && !fitsHalf(code, 'tablet-landscape', fit(0, { half: 120 })) && fitsHalf(cards[3], 'tablet-landscape', fit(1, { half: 80 })) && !fitsHalf(cards[3], 'tablet-landscape', fit(1, { half: 130 })) && !fitsHalf({ kind: 'canvas', props: {} }, 'tablet-landscape', fit(1, { half: 80 })));
  }
  // ---- 选中态:播到这句该在的卡;句子锚到标题行时退到本节第一张真卡 ----
  const secL: BoardSection = { cards: [hd, def, formula], lines: [L('一', { anchor: 0 }), L('二', { anchor: 1, marks: [{ card: 2, phrase: '斜边' }] })] };
  check('nowCard:标注卡优先、锚点其次、锚到标题行就退到第一张真卡;没在播 null', nowCard([secL], { section: 0, line: 1, status: 'playing' }) === 2 && nowCard([secL], { section: 0, line: 0, status: 'playing' }) === 1 && nowCard([secL], { section: 0, line: -1, status: 'idle' }) === null && nowCard([secL], { section: 3, line: 0, status: 'playing' }) === null);
  // ---- 线条类的笔:框与路径,同一个种子每次一样 ----
  check('笔画的框:下划线在字底下、方框包一圈、圈伸出去更多', penBox('underline', 50, 20).y === 16 && penBox('box', 50, 20).w === 58 && penBox('circle', 50, 20).x === -10 && penBox('marker', 50, 20).w === 50);
  const p1 = penPath('circle', 70, 34, '斜边:0');
  check('路径:圈是折线一圈多一点、方框四段曲线、下划线一笔;同种子同路径,换种子不同', p1.startsWith('M') && p1.split(' L ').length === 40 && p1 === penPath('circle', 70, 34, '斜边:0') && p1 !== penPath('circle', 70, 34, '斜边:1') && penPath('box', 60, 30, 'x').split(' C ').length === 5 && penPath('underline', 60, 10, 'x').includes(' S ') && penPath('marker', 10, 10, 'x') === '');
  check('问句', isQuestion('酒是谁的?') && isQuestion('明白吗?') && !isQuestion('明白了。'));
  check('有舞台交互的是选择题(填空 10-22 删了,《卡片协议.md》)', cards[3].kind === 'choice' && hasState(cards[3]) && !hasState(cards[4]) && !hasState(cards[0]) && !hasState(cards[2]) && !hasState(cards[5]) && !hasState({ kind: 'image', props: { src: 'a.png' } }));
  check('点读段的配音:assets 里有 <段号>.mp3 才有', segmentAudio({ ...cards[2], assets: ['2026-09-10.1620-1.cards/2/2.mp3'] }, 1) === '2026-09-10.1620-1.cards/2/2.mp3' && segmentAudio({ ...cards[2], assets: ['2026-09-10.1620-1.cards/2/2.mp3'] }, 0) === null && segmentAudio(cards[2], 0) === null);
  check('做了什么(交给老师能不能按):选择题是选项、别的卡永远空', stateSummary({ ...cards[3], state: { picked: [0] } }).join() === 'A 他自己的' && stateSummary({ ...cards[4], state: { answers: ['多做一步'] } }).length === 0 && stateSummary({ ...cards[0], state: { x: 1 } }).length === 0);
  const cv: BoardCard = { kind: 'canvas', props: { base: null, prompt: '画一条蛇' } };
  check('画板卡:有交互(给老师看)、重卡;做了什么 = 画了 N 笔;标题是题目', hasState(cv) && isHeavy(cv) && stateSummary(cv).length === 0 && stateSummary({ ...cv, state: { ink: [{}, {}, {}] } }).join() === '画了 3 笔' && cardTitle(cv) === '画一条蛇' && cardTitle({ kind: 'canvas', props: { base: null } }) === '画一画' && cardTexts(cv).join() === '画一条蛇');
  check('重卡:小课堂 / canvas 在舞台包里开;小课堂卡读得出、有起止才 ready', isHeavy(lectureCard) && isHeavy({ kind: 'canvas', props: {} }) && !isHeavy(cards[3]) && lectureReady(lectureCard) && !lectureReady({ kind: 'lecture', props: { bundle: 'x' } }) && !lectureReady(cards[0]) && !isHeavy({ kind: 'scene', props: { bundle: 'x', ready: true } }));
  check('小课堂卡:能标注标题 / 那句话;标题是 title;没有「交给老师」', cardTexts(lectureCard).join('|') === '找规律|再看一遍' && cardTitle(lectureCard) === '找规律' && !hasState(lectureCard));
  check('图片卡:能标注的是图注,标题是图注 / 「图」', cardTexts({ kind: 'image', props: { src: 'a.png', caption: '看这里' } }).join() === '看这里' && cardTitle({ kind: 'image', props: { src: 'a.png', caption: '看这里' } }) === '看这里' && cardTitle({ kind: 'image', props: { src: 'a.png' } }) === '图');
  check('舞台顶栏的名字:标题 > 问题 > 正文 > 第一段;截 24 字', cardTitle(cards[0]) === '画蛇添足' && cardTitle(cards[3]) === '酒是谁的?' && cardTitle(cards[2]) === '楚有祠者' && cardTitle(cards[1]) === '画蛇添足 = 多做一步,反而坏事' && cardTitle({ kind: 'text', props: { text: '字'.repeat(30) } }).length === 25 && cardTitle({ kind: 'gizmo', props: { bundle: 'x' } }) === 'x');
  check('单选:点了换成它,再点取消;多选:切换', JSON.stringify(togglePick([], 1, false)) === '[1]' && JSON.stringify(togglePick([1], 2, false)) === '[2]' && JSON.stringify(togglePick([1], 1, false)) === '[]' && JSON.stringify(togglePick([0], 2, true)) === '[0,2]' && JSON.stringify(togglePick([0, 2], 0, true)) === '[2]');
  check('选了什么(回显用):「B 第二个画完的」;没状态 / 越界 → 空', pickedLabels({ ...cards[3], state: { picked: [1] } }).join() === 'B 第二个画完的' && pickedLabels(cards[3]).length === 0 && pickedLabels({ ...cards[3], state: { picked: [7] } }).length === 0 && pickedLabels({ ...cards[3], state: 'junk' }).length === 0);
  check('滚到哪张卡:标注的卡 > 锚点卡 > null', lineTarget(L('a', { marks: [{ card: 2, phrase: 'x' }], anchor: 0 })) === 2 && lineTarget(L('a', { anchor: 1 })) === 1 && lineTarget(L('a')) === null);
}
{
  const section: BoardSection = { cards, lines: [L('第一句', { marks: [{ card: 1, phrase: '多做一步' }], anchor: 0 }), L('酒是谁的?', { anchor: 3 })] };
  const entries = sectionsFromMessages([
    { job: '1', question: '画蛇添足是什么?', reply: '酒是谁的?', pending: false, section },
    { job: '2', question: '不画脚呢?', reply: null, pending: true },
    { job: '3', question: '没有 section 的', reply: '酒归第二个画完的。', pending: false },
    { job: '4', question: '出错的', reply: null, pending: false },
    { job: '5', question: '空节', reply: '只有一句', pending: false, section: { cards: [{ kind: 'text', props: { text: '卡' } }], lines: [] } },
    { job: '6', question: '只有讲稿', reply: '一句话', pending: false, section: { cards: [], lines: [L('一句话')] } },
    { job: '7', question: '还在说', reply: null, pending: true, section: { cards: [{ kind: 'text', props: { text: '先出的卡' } }], lines: [L('第一句')], partial: true } },
    { job: '8', question: '还在说但没卡', reply: null, pending: true, section: { cards: [], lines: [L('只有句')], partial: true } },
  ]);
  check('有 section 用 section;没有 section / 还在跑 / 出错的不出节;流式已出卡的出 partial 节', entries.map((e) => e.job).join() === '1,5,6,7' && entries[0].cards.length === 6 && entries[3].partial === true && entries[3].cards.length === 1 && !entries.slice(0, 3).some((e) => e.partial), JSON.stringify(entries.map((e) => e.job)));
  check('只有卡没讲稿、只有讲稿没卡都成节', entries[1].lines.length === 0 && entries[1].cards.length === 1 && entries[2].cards.length === 0 && entries[2].lines.length === 1);
  check('孩子的话不上板', !entries.some((e) => e.cards.some((c) => cardTexts(c).some((t) => t.includes('画蛇添足是什么')))));
  check('目录名:封面 > 有名字的文字卡 > 第一张有字的卡 > 第一句,截 14 字', sectionTitle(section) === '画蛇添足' && sectionTitle({ cards: [{ kind: 'text', props: { style: 'step', title: '拼', text: 'x' } }], lines: [] }) === '拼' && sectionTitle({ cards: [{ kind: 'text', props: { text: '一二三四五六七八九十一二三四五六' } }], lines: [] }) === '一二三四五六七八九十一二三四…' && sectionTitle({ cards: [], lines: [L('只有一句')] }) === '只有一句');
}
{
  const s1: BoardSection = { cards: [{ kind: 'text', props: { text: 'a' } }], lines: [L('一'), L('二?', { marks: [{ card: 0, phrase: 'a' }] })] };
  const s2: BoardSection = { cards: [{ kind: 'text', props: { text: 'b' } }], lines: [L('三')] };
  check('空板书:idle', playerAtEnd([]).status === 'idle');
  check('打开页面停在末尾;末句问句 → 等着', JSON.stringify(playerAtEnd([s1])) === '{"section":0,"line":1,"status":"waiting"}' && playerAtEnd([s1, s2]).status === 'done');
  // 拍:卡前的句是没有卡的一拍;每张卡一拍,后面的句跟它;就绪 = 关了(后面有卡 / 写完了),讲稿不配音不等配音
  const ln = (anchor: number | null, audio: string | null = null): BoardLine => ({ text: '句', audio, marks: [], ask: false, anchor, cues: [] });
  const cd: BoardCard = { kind: 'text', props: {} };
  const bsec = { cards: [cd, cd, cd], lines: [ln(null, 'z'), ln(0, 'a'), ln(0, 'b'), ln(1), ln(2, 'c')] };
  check('拍:按锚点分组、顺序对', JSON.stringify(beatsOf(bsec)) === '[{"card":null,"lines":[0]},{"card":0,"lines":[1,2]},{"card":1,"lines":[3]},{"card":2,"lines":[4]}]', JSON.stringify(beatsOf(bsec)));
  check('就绪:末拍没写完不算,写完了才算;没有拍就是 0', readyBeats(bsec, { done: false }) === 3 && readyBeats(bsec, { done: true }) === 4 && readyBeats({ cards: [], lines: [] }, { done: false }) === 0);
}
{
  const cd: BoardCard = { kind: 'text', props: { text: 'x' } };
  const ln = (anchor: number | null): BoardLine => ({ text: '句', audio: null, marks: [], ask: false, anchor, cues: [] });
  // 提问卡(2026-09-21):解析器补在节尾,自己一拍、没有讲稿;末句还锚在它讲的那张卡上
  const askSec: BoardSection = { cards: [cd, { kind: 'text', props: { text: '这是要堆什么?', ask: true } }], lines: [ln(0), { ...ln(0), text: '这是要堆什么?', ask: true }], layout: { for: 'tablet-landscape', rows: [[0]] } };
  check('提问卡:停下等答亮提问卡', nowCard([askSec], { section: 0, line: 1, status: 'waiting' }) === 1);
  check('提问卡:不过后期,layout 没盖到它也不作废——前面照排,它独占节尾一行;底色紫', JSON.stringify(rowsFor(askSec, 'tablet-landscape')) === '[[0],[1]]' && tintFor(askSec.cards[1]) === 'plum' && isAskCard(askSec.cards[1]) && !isAskCard(cd));
}
{
  check('输入条:点 → 打字;按住 → 说话;松手 / 取消 / 发出 / 失焦 → 闲置', barNext('idle', 'tap') === 'typing' && barNext('idle', 'holdStart') === 'holding' && barNext('holding', 'holdEnd') === 'idle' && barNext('holding', 'holdCancel') === 'idle' && barNext('typing', 'sent') === 'idle' && barNext('typing', 'blur') === 'idle' && barNext('typing', 'tap') === 'typing' && barNext('typing', 'holdEnd') === 'typing');
  check('端:宽 ≥ 900 且横 → 平板横屏;短边 ≥ 600 → 平板竖屏;其余手机', deviceFor(1180, 820) === 'tablet-landscape' && deviceFor(820, 1180) === 'tablet-portrait' && deviceFor(390, 844) === 'phone' && deviceFor(899, 500) === 'phone' && deviceFor(1024, 768) === 'tablet-landscape');
  check('一句按字数估多久,至少 1.2 秒', lineDurationMs('短') === 1200 && lineDurationMs('[十个字十个字十个字十]') === 2600);
  // 单词卡:格里是笔顺,标注只让整个词亮;排版按 advance + 字间距,舞台里段与段之间再空开
  const wcard: BoardCard = { kind: 'word', props: { word: 'apple', chunks: ['ap', 'ple'] } };
  const G = { a: { advance: 1 }, p: { advance: 1 }, l: { advance: 0.2 }, e: { advance: 0.95 } };
  const lay = wordLayout('apple', G, { gap: 0.2, space: 0.5 });
  const lsp = wordLayout('apple', G, { gap: 0.2, space: 0.5, chunks: ['ap', 'ple'], split: true });
  const two = wordLayout('ice cream', { i: { advance: 0.2 }, c: { advance: 0.8 }, e: { advance: 0.95 }, r: { advance: 0.6 }, a: { advance: 1 }, m: { advance: 1.4 } }, { gap: 0.2, space: 0.5 });
  check('单词卡:[apple] 落到这张卡、标题是词;排版逐字前进,分开写时第二段整体右移 0.8,空格只前进', anchorMarks([wcard], ['apple'])[0]?.card === 0 && cardTitle(wcard) === 'apple' && lay.slots.map((x) => +x.x.toFixed(2)).join() === '0,1.2,2.4,3.6,4' && +lay.width.toFixed(2) === 4.95 && lsp.slots.map((x) => x.chunk).join() === '0,0,1,1,1' && +(lsp.slots[2].x - lay.slots[2].x).toFixed(2) === 0.8 && +(lsp.slots[4].x - lay.slots[4].x).toFixed(2) === 0.8 && two.slots.length === 8 && +(two.slots[3].x - two.slots[2].x).toFixed(2) === 1.85, JSON.stringify([lay, lsp.slots]));
}
// 问句认半角与全角问号(2026-10-04:真老师写「你想问什么呀？」,原来只认半角,孩子端念完不停)
check('isQuestion:半角、全角问号都算;句号不算', isQuestion('每人几块?') && isQuestion('每人几块？') && isQuestion(' 好吗？ ') && !isQuestion('好的。'));

// ---- 一个话题一节:孩子的话进问题卡 ----
{
  const q = (t: string, extra: Partial<BoardCard['props']> = {}): BoardCard => ({ kind: 'text', props: { text: t, ...extra } });
  const asks: BoardSection = { cards: [q('想一想')], lines: [L('分完了吗?', { anchor: 0 })] };
  const askAdded: BoardSection = { cards: [{ kind: 'code', props: { code: 'x' } }, q('还剩几个?', { ask: true })], lines: [L('还剩几个?', { anchor: 0 })] };
  const onCanvas: BoardSection = { cards: [{ kind: 'canvas', props: { prompt: '画出一共几个' } }], lines: [L('一共几个?', { anchor: 0 })] };
  const told: BoardSection = { cards: [q('一捆 10 根')], lines: [L('这就是一捆。', { anchor: 0 })] };
  check('askCard:末句问句锚着文字卡 → 它;解析器补的提问卡 → 它;锚着画板 / 没问 / 还在写 → 没有', askCard(asks) === 0 && askCard(askAdded) === 1 && askCard(onCanvas) === null && askCard(told) === null && askCard({ ...asks, partial: true }) === null);
  const msgs = [
    { job: 'a', question: '分一分', reply: 'x', pending: false, fromHome: true, section: asks },
    { job: 'b', question: '嗯……每个人两个吧', reply: 'x', pending: false, section: onCanvas },
    { job: 'c', question: '', reply: 'x', pending: false, action: 'submit' as const, section: asks },
    { job: 'd', question: '4', reply: null, pending: true },
  ];
  const says = kidSaid(msgs);
  check('kidSaid:首页按钮、交卡的不放;答问题卡的挂那张卡;上一节问在填空上 → 单独一行;刚发出去的也有', !says.has('a') && !says.has('c') && says.get('b')?.on?.job === 'a' && says.get('b')?.on?.card === 0 && says.get('b')?.said.text === '嗯……每个人两个吧' && says.get('d')?.on?.job === 'c' && says.get('d')?.said.text === '4', JSON.stringify([...says]));
  const lone = kidSaid([{ job: 'x', question: '有7个小朋友呢?', reply: 'x', pending: false, section: onCanvas }, { job: 'y', question: '我不会', reply: 'x', pending: false, section: asks }]);
  check('kidSaid:话题第一句、上一节问在填空上 → 单独一行(on = null)', lone.get('x')?.on === null && lone.get('y')?.on === null);
  const es = sectionsFromMessages(msgs);
  check('sectionsFromMessages:节带上 said / saidOn', es.find((e) => e.job === 'b')?.saidOn?.job === 'a' && es.find((e) => e.job === 'b')?.said?.text === '嗯……每个人两个吧' && es.find((e) => e.job === 'a')?.said === undefined);
  // 拍给我看卡(cards/photo/card.md):末句问不问都是它;拍来的照片进它的答案栏,节头不再回显;只发照片时补的「(拍了一张)」不写
  const snap: BoardSection = { cards: [q('看图说话'), { kind: 'photo', props: { text: '看图说话的那幅图' } }], lines: [L('把那幅图拍下来,发给我。', { anchor: 1 })] };
  const snapAsk: BoardSection = { ...snap, lines: [L('把那幅图拍下来,好吗?', { anchor: 0 })] };
  check('askCard:有拍给我看卡就是它(末句不是问句、问句锚着别的卡都算);还在写 → 没有', askCard(snap) === 1 && askCard(snapAsk) === 1 && askCard({ ...snap, partial: true }) === null);
  const pm = [
    { job: 'p', question: '我要看图说话', reply: 'x', pending: false, fromHome: true, section: snap },
    { job: 'r', question: '(拍了一张)', reply: 'x', pending: false, photos: ['captures/2026-10-18/0900-1.jpg'], section: told },
  ];
  const ps = kidSaid(pm);
  check('kidSaid:答拍给我看卡的照片进那张卡,补的「(拍了一张)」不写', ps.get('r')?.on?.job === 'p' && ps.get('r')?.on?.card === 1 && ps.get('r')?.said.photos?.join() === 'captures/2026-10-18/0900-1.jpg' && ps.get('r')?.said.text === '', JSON.stringify([...ps]));
  const withWords = kidSaid([pm[0], { ...pm[1], question: '这是第三幅' }]);
  check('kidSaid:配了话的,话和照片一起进', withWords.get('r')?.said.text === '这是第三幅' && withWords.get('r')?.said.photos?.length === 1);
  const talkBack = kidSaid([pm[0], { job: 'r', question: '我找不到那幅图', reply: 'x', pending: false, section: told }]);
  check('kidSaid:没拍、直接说话,那句也进拍给我看卡的答案栏', talkBack.get('r')?.on?.card === 1 && talkBack.get('r')?.said.text === '我找不到那幅图' && !talkBack.get('r')?.said.photos);
  const pe = sectionsFromMessages(pm).find((e) => e.job === 'r');
  check('sectionsFromMessages:照片进了答案栏,节头不再带 photos', pe?.saidOn?.card === 1 && pe.photos === undefined);
  const notSnap = sectionsFromMessages([{ ...pm[0], section: asks }, pm[1]]).find((e) => e.job === 'r');
  check('sectionsFromMessages:答的不是拍给我看卡,照片照旧在节头', notSnap?.photos?.length === 1 && !notSnap.said?.photos);
  // 实时:节头是脑写的那张 # 标题卡,没写就接着上一节;孩子的话照旧挂在 said 上(给左栏),不是节头
  const head: BoardSection = { cards: [{ kind: 'text', props: { title: '补读音:瀑、布、穷、尽', text: '', heading: true } }, q('瀑 pù')], lines: [L('先看「瀑」。')] };
  const plain: BoardSection = { cards: [q('布 bù')], lines: [L('对,pù。')] };
  const talkOnly: BoardSection = { cards: [], lines: [L('嗯,我在。')] };
  const lm = [
    { job: 'h', question: '(拍了一张)', reply: 'x', pending: false, live: true, photos: ['captures/x.jpg'], section: head },
    { job: 'i', question: '没见过', reply: 'x', pending: false, live: true, section: plain },
    { job: 'j', question: '老师。', reply: 'x', pending: false, live: true, section: talkOnly },
    { job: 'k', question: '写好了', reply: null, pending: true, live: true, section: { cards: [head.cards[0]], lines: [], partial: true } },
    { job: 'l', question: '为什么', reply: 'x', pending: false, section: head },
  ];
  const le = sectionsFromMessages(lm);
  const by = (j: string) => le.find((e) => e.job === j);
  check('实时:开头是节头卡 → head 是它的标题,不 cont', by('h')?.head === '补读音:瀑、布、穷、尽' && by('h')?.cont === undefined, JSON.stringify(by('h')));
  check('实时:没写节头 → cont,没有 head;孩子那句照旧在 said(给左栏)', by('i')?.cont === true && by('i')?.head === undefined && by('i')?.said?.text === '没见过', JSON.stringify(by('i')));
  check('实时:只有讲稿的一轮也是 cont', by('j')?.cont === true);
  check('实时:还在写的一轮,节头卡先到了就有 head', by('k')?.partial === true && by('k')?.head === '补读音:瀑、布、穷、尽');
  check('板书模式:不带 head / cont', by('l')?.head === undefined && by('l')?.cont === undefined);
  check('liveHead:节头标题是空的不算', 'cont' in liveHead({ cards: [{ kind: 'text', props: { title: ' ', text: '', heading: true } }] }));
}

done();
