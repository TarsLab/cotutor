/** 板书纯逻辑:标注锚点、条目 → 节、播放状态机、字幕行、输入条、布局。页面内联的就是这份代码。 */
import {
  advance,
  anchorMarks,
  barNext,
  cardTexts,
  cardTitle,
  filledAnswers,
  findPhrase,
  hasState,
  isHeavy,
  lectureReady,
  stageSubtitle,
  segmentAudio,
  stateSummary,
  pickedLabels,
  togglePick,
  isHeading,
  isQuestion,
  deviceFor,
  lineDurationMs,
  markTiming,
  beatsOf,
  readyBeats,
  playableLines,
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
  replayQuiet,
  replayLines,
  spokenLines,
  startReplay,
  sectionTitle,
  sectionsFromMessages,
  askCard,
  kidSaid,
  tidySpoken,
  startSection,
  subtitleFor,
  type BoardCard,
  type BoardLine,
  type PlayerState,
  type BoardSection,
  wordLayout,
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
  check('底色槽:# 标题 sky、素文 sand、formula paper、后期定的优先、做题的紫、点读米、图 / 小课堂 / 代码白', tintFor(cards[0]) === 'sky' && tintFor(def) === 'sky' && tintFor(plain) === 'sand' && tintFor(cards[1]) === 'sand' && tintFor(formula) === 'paper' && tintFor({ kind: 'text', props: { text: 'x' }, look: { tint: 'night' } }) === 'night' && tintFor(cards[3]) === 'plum' && tintFor(cards[4]) === 'plum' && tintFor({ kind: 'canvas', props: {} }) === 'plum' && tintFor(cards[2]) === 'sand' && tintFor(lectureCard) === 'paper' && tintFor({ kind: 'image', props: {} }) === 'paper');
  check('后期定的 look 优先', tintFor({ ...plain, look: { tint: 'moss' } }) === 'moss' && lookFor({ ...plain, look: { look: 'quote' } }) === 'quote');
  check('字形槽:formula → formula、后期定的优先,其余 plain', lookFor(cards[1]) === 'plain' && lookFor(formula) === 'formula' && lookFor({ kind: 'text', props: { text: 'x' }, look: { look: 'title' } }) === 'title' && lookFor(def) === 'plain' && lookFor(cards[3]) === 'plain');
  check('笔:选项 box、问题里的词 underline、填空 underline、点读 marker、公式 / 大字 marker、标题位 circle、数字 underline、正文里的词 tint;后期定的 pen 页面直接用', penFor(cards[3], '他自己的') === 'box' && penFor(cards[3], '酒') === 'underline' && penFor(cards[4], '做到了') === 'underline' && penFor(cards[2], '楚有祠者') === 'marker' && penFor(formula, '斜边') === 'marker' && penFor({ kind: 'text', props: { text: '多做一步' }, look: { look: 'title' } }, '多做一步') === 'marker' && penFor(cards[1], '多做一步') === 'tint' && penFor(cards[0], '画蛇添足') === 'circle' && penFor(def, '认边') === 'circle' && penFor(def, '直角边') === 'tint' && penFor({ kind: 'text', props: { title: '验证', text: '9 加 16 等于 25' } }, '25') === 'underline' && penFor(lectureCard, '找规律') === 'underline');
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
    check('能半宽的种类:文字、点读、代码、田字格、单词卡、选择题、填空题;标题行、提问卡、画板、录音卡、小课堂、图不行;大字的照量', canHalf(def) && canHalf(cards[2]) && canHalf(code) && canHalf(cards[3]) && canHalf(cards[4]) && !canHalf({ kind: 'canvas', props: {} }) && !canHalf({ kind: 'record', props: { text: '山' } }) && canHalf({ kind: 'tianzige', props: { chars: '鼓' } }) && canHalf({ kind: 'word', props: { word: 'apple' } }) && !canHalf(hd) && !canHalf({ kind: 'text', props: { text: '?', ask: true } }) && !canHalf(lectureCard) && !canHalf({ kind: 'image', props: { src: 'a.png' } }) && canHalf({ ...def, look: { look: 'title' } }) && canHalf({ kind: 'word', props: { word: 'yellow' }, look: { look: 'title' } }));
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
  check('有舞台交互的是选择题与填空', hasState(cards[3]) && hasState(cards[4]) && !hasState(cards[0]) && !hasState(cards[2]) && !hasState(cards[5]) && !hasState({ kind: 'image', props: { src: 'a.png' } }));
  check('点读段的配音:assets 里有 <段号>.mp3 才有', segmentAudio({ ...cards[2], assets: ['2026-09-10.1620-1.cards/2/2.mp3'] }, 1) === '2026-09-10.1620-1.cards/2/2.mp3' && segmentAudio({ ...cards[2], assets: ['2026-09-10.1620-1.cards/2/2.mp3'] }, 0) === null && segmentAudio(cards[2], 0) === null);
  check('填空填了什么:按空数补齐,没填是空串;坏状态当没填', JSON.stringify(filledAnswers({ ...cards[4], state: { answers: [' 多做一步 '] } })) === '["多做一步"]' && JSON.stringify(filledAnswers({ kind: 'fill', props: { text: '_ _', blanks: 2 }, state: { answers: ['a'] } })) === '["a",""]' && JSON.stringify(filledAnswers({ ...cards[4], state: 'x' })) === '[""]');
  check('做了什么(交给老师能不能按):选择题是选项、填空是填的字、别的卡永远空', stateSummary({ ...cards[3], state: { picked: [0] } }).join() === 'A 他自己的' && stateSummary({ ...cards[4], state: { answers: ['多做一步'] } }).join() === '多做一步' && stateSummary(cards[4]).length === 0 && stateSummary({ ...cards[0], state: { x: 1 } }).length === 0);
  const cv: BoardCard = { kind: 'canvas', props: { base: null, prompt: '画一条蛇' } };
  check('画板卡:有交互(给老师看)、重卡;做了什么 = 画了 N 笔;标题是题目', hasState(cv) && isHeavy(cv) && stateSummary(cv).length === 0 && stateSummary({ ...cv, state: { ink: [{}, {}, {}] } }).join() === '画了 3 笔' && cardTitle(cv) === '画一条蛇' && cardTitle({ kind: 'canvas', props: { base: null } }) === '画一画' && cardTexts(cv).join() === '画一条蛇');
  check('重卡:小课堂 / canvas 在舞台包里开;小课堂卡读得出、有起止才 ready', isHeavy(lectureCard) && isHeavy({ kind: 'canvas', props: {} }) && !isHeavy(cards[3]) && lectureReady(lectureCard) && !lectureReady({ kind: 'lecture', props: { bundle: 'x' } }) && !lectureReady(cards[0]) && !isHeavy({ kind: 'scene', props: { bundle: 'x', ready: true } }));
  check('小课堂卡:能标注标题 / 那句话;标题是 title;没有「交给老师」', cardTexts(lectureCard).join('|') === '找规律|再看一遍' && cardTitle(lectureCard) === '找规律' && !hasState(lectureCard));
  check('小课堂那一段在放时的字幕行:drawing 暂停、paused 播放、done 没钮', stageSubtitle('drawing', '一').right === 'pause' && stageSubtitle('paused', '一').right === 'play' && JSON.stringify(stageSubtitle('done', '三')) === '{"text":"三","kind":"line","right":"none"}');
  check('讲稿交给小课堂时(stage)字幕留那句、没钮', subtitleFor({ state: { section: 0, line: 0, status: 'stage' }, sections: [{ cards: [], lines: [L('看我画')] }], pending: false, waitedMs: 0, limit: false }).right === 'none');
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
    { job: '9', question: '没卡但第一句配好了', reply: null, pending: true, section: { cards: [], lines: [L('先开口')], partial: true, voiced: 1 } },
  ]);
  check('流式还没卡、但第一句配好了:出 partial 节、带 voiced(先出声、后出卡,《工作流程.md》拍板 15)', entries.at(-1)?.job === '9' && entries.at(-1)?.partial === true && entries.at(-1)?.voiced === 1 && entries.at(-1)?.cards.length === 0);
  entries.pop();
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
  let st = startSection(0, [s1]);
  check('新节从第一句播', st.status === 'playing' && st.line === 0);
  st = advance(st, [s1]);
  check('同节下一句', st.line === 1 && st.status === 'playing');
  check('末句问句且没下一节 → 停下等', advance(st, [s1]).status === 'waiting');
  // 拍:卡前的句是没有卡的一拍;每张卡一拍,后面的句跟它;就绪 = 关了(后面有卡 / 写完了)且每句配音齐
  const ln = (anchor: number | null, audio: string | null = null): BoardLine => ({ text: '句', audio, marks: [], ask: false, anchor, cues: [] });
  const cd: BoardCard = { kind: 'text', props: {} };
  const bsec = { cards: [cd, cd, cd], lines: [ln(null, 'z'), ln(0, 'a'), ln(0, 'b'), ln(1), ln(2, 'c')] };
  check('拍:按锚点分组、顺序对', JSON.stringify(beatsOf(bsec)) === '[{"card":null,"lines":[0]},{"card":0,"lines":[1,2]},{"card":1,"lines":[3]},{"card":2,"lines":[4]}]', JSON.stringify(beatsOf(bsec)));
  check('就绪:前两拍配音齐 → 2;第三拍缺配音卡住;末拍没写完不算;写完了才算;没配音色不等配音', readyBeats(bsec, { voiced: true, done: false }) === 2 && readyBeats({ ...bsec, lines: [ln(null, 'z'), ln(0, 'a'), ln(0, 'b'), ln(1, 'x'), ln(2, 'c')] }, { voiced: true, done: false }) === 3 && readyBeats({ ...bsec, lines: [ln(null, 'z'), ln(0, 'a'), ln(0, 'b'), ln(1, 'x'), ln(2, 'c')] }, { voiced: true, done: true }) === 4 && readyBeats(bsec, { voiced: false, done: false }) === 3);
  const lv = { ...bsec, partial: true, ready: 2 };
  check('流式的节:能播的句 = 前 ready 拍的;播到头 → thinking;定稿后照常', playableLines(lv) === 3 && playableLines({ ...bsec }) === 5 && advance({ section: 0, line: 2, status: 'playing' }, [lv]).status === 'thinking' && advance({ section: 0, line: 1, status: 'playing' }, [lv]).line === 2 && advance({ section: 0, line: 2, status: 'thinking' }, [{ ...bsec }]).line === 3 && startSection(0, [{ ...bsec, partial: true, ready: 0 }]).status === 'thinking');
  const subOf = (state: PlayerState, pending: boolean, waitedMs = 0) => subtitleFor({ state, sections: [lv], pending, waitedMs, limit: false });
  check('字幕:念过几句再等下一拍 → gap 留着刚念那句;一句没念 → wait;pending 时正在播照常出字幕', JSON.stringify(subOf({ section: 0, line: 0, status: 'thinking' }, true)) === '{"text":"句","kind":"gap","right":"none"}' && subOf({ section: 0, line: -1, status: 'thinking' }, true).kind === 'wait' && subOf({ section: 0, line: 0, status: 'playing' }, true).kind === 'line' && subOf({ section: 0, line: 0, status: 'done' }, true).kind === 'wait' && subOf({ section: 0, line: 0, status: 'playing' }, true).right === 'pause');
  check('字幕:第一拍前等过 8 秒换一句', subOf({ section: 0, line: -1, status: 'thinking' }, true, 7999).text === '我写给你看' && subOf({ section: 0, line: -1, status: 'thinking' }, true, 8000).text === '再等我一下下');
  check('末句问句但已有下一节 → 直接进下一节(孩子答过了)', JSON.stringify(advance(st, [s1, s2])) === '{"section":1,"line":0,"status":"playing"}');
  check('末句不是问句 → 完', advance({ section: 1, line: 0, status: 'playing' }, [s1, s2]).status === 'done');
  check('没讲稿的节直接完', startSection(0, [{ cards: [], lines: [] }]).status === 'done');
  const base = { sections: [s1], pending: false, waitedMs: 0, limit: false };
  check('字幕:播放中 → 当前句 + 暂停', JSON.stringify(subtitleFor({ ...base, state: { section: 0, line: 0, status: 'playing' } })) === '{"text":"一","kind":"line","right":"pause"}');
  check('字幕:暂停 → 播放钮', subtitleFor({ ...base, state: { section: 0, line: 0, status: 'paused' } }).right === 'play');
  check('字幕:停下等 → 留着问句、没钮(「继续」去掉了)', JSON.stringify(subtitleFor({ ...base, state: { section: 0, line: 1, status: 'waiting' } })) === '{"text":"二?","kind":"line","right":"none"}');
  check('字幕:完 → 留末句、没钮', JSON.stringify(subtitleFor({ ...base, state: { section: 0, line: 1, status: 'done' } })) === '{"text":"二?","kind":"line","right":"none"}');
  check('字幕:等老师', subtitleFor({ ...base, pending: true, state: { section: 0, line: 1, status: 'done' } }).text === '我写给你看');
  check('字幕:上限压过一切', subtitleFor({ ...base, limit: true, pending: true, state: { section: 0, line: 0, status: 'playing' } }).kind === 'limit');
  check('字幕:什么都没有', subtitleFor({ ...base, sections: [], state: { section: -1, line: -1, status: 'idle' } }).kind === 'empty');
}
{
  // 再听(2026-09-18):后期改过锚点,卡 1 的句在最后(一张卡的句不连着);卡前那句亮的是第一张卡,算它的
  const cd: BoardCard = { kind: 'text', props: { text: 'x' } };
  const ln = (anchor: number | null): BoardLine => ({ text: '句', audio: null, marks: [], ask: false, anchor, cues: [] });
  const sec: BoardSection = { cards: [cd, cd, cd], lines: [ln(null), ln(0), ln(0), ln(2), ln(1)] };
  const secs = [sec];
  const playing3: PlayerState = { section: 0, line: 3, status: 'playing' };
  const done: PlayerState = { section: 0, line: 4, status: 'done' };
  check('念完几句:在念的那句不算,等下一拍 / 交给小课堂的算,等答 / 完 = 全部;前面的节全念完,后面的一句没念', spokenLines(playing3, secs, 0) === 3 && spokenLines({ ...playing3, status: 'paused' }, secs, 0) === 3 && spokenLines({ ...playing3, status: 'thinking' }, secs, 0) === 4 && spokenLines({ ...playing3, status: 'stage' }, secs, 0) === 4 && spokenLines(done, secs, 0) === 5 && spokenLines({ section: 1, line: 0, status: 'playing' }, [sec, sec], 0) === 5 && spokenLines(playing3, [sec, sec], 1) === 0 && spokenLines({ section: -1, line: -1, status: 'idle' }, secs, 0) === 0);
  check('再听哪几句不看念到哪(2026-09-21):暂停在第一张卡的第一句,每张卡照样有自己的句、整节是全部句;后面还没念到的节也一样', JSON.stringify(replayLines(secs, 0, 0)) === '[0,1,2]' && JSON.stringify(replayLines(secs, 0, 2)) === '[3]' && JSON.stringify(replayLines(secs, 0, 1)) === '[4]' && JSON.stringify(replayLines(secs, 0, 'all')) === '[0,1,2,3,4]' && JSON.stringify(replayLines([sec, sec], 1, 'all')) === '[0,1,2,3,4]');
  check('再听:念完之后卡 1 是它那一句(不连着);整节是全部句;老师还在写的节、没讲稿的节、没有的卡都不行', JSON.stringify(replayLines(secs, 0, 1)) === '[4]' && JSON.stringify(replayLines(secs, 0, 'all')) === '[0,1,2,3,4]' && replayLines([{ ...sec, partial: true, ready: 3 }], 0, 0).length === 0 && replayLines([{ cards: [cd], lines: [] }], 0, 0).length === 0 && replayLines(secs, 0, 7).length === 0);
  const marked: BoardSection = { cards: [cd, { kind: 'text', props: { text: '多做一步' } }], lines: [{ ...ln(0), marks: [{ card: 1, phrase: '多做一步' }] }, ln(1)] };
  check('再听按亮哪张分:锚在卡 0、标注在卡 1 的那句归卡 1;卡 0 一句不剩就没喇叭', JSON.stringify(replayLines([marked], 0, 1)) === '[0,1]' && replayLines([marked], 0, 0).length === 0);
  {
    // 提问卡(2026-09-21):解析器补在节尾,自己一拍、没有讲稿;末句还锚在它讲的那张卡上
    const askSec: BoardSection = { cards: [cd, { kind: 'text', props: { text: '这是要堆什么?', ask: true } }], lines: [ln(0), { ...ln(0), text: '这是要堆什么?', ask: true }], layout: { for: 'tablet-landscape', rows: [[0]] } };
    check('提问卡:念末句时亮的还是它讲的那张卡;停下等答亮提问卡;再听时不抢', nowCard([askSec], { section: 0, line: 1, status: 'playing' }) === 0 && nowCard([askSec], { section: 0, line: 1, status: 'waiting' }) === 1 && nowCard([askSec], { section: 0, line: 0, status: 'playing', replay: { lines: [0], back: { section: 0, line: 1, status: 'waiting' } } }) === 0);
    check('提问卡:喇叭 = 再听末句那一问;末句也还算在它讲的那张卡里', JSON.stringify(replayLines([askSec], 0, 1)) === '[1]' && JSON.stringify(replayLines([askSec], 0, 0)) === '[0,1]');
    check('提问卡:不过后期,layout 没盖到它也不作废——前面照排,它独占节尾一行;底色紫', JSON.stringify(rowsFor(askSec, 'tablet-landscape')) === '[[0],[1]]' && tintFor(askSec.cards[1]) === 'plum' && isAskCard(askSec.cards[1]) && !isAskCard(cd));
  }
  const r = startReplay(playing3, 0, [1, 4]);
  check('开始再听:从第一句念,在念的回来变暂停', r.line === 1 && r.status === 'playing' && JSON.stringify(r.replay?.back) === '{"section":0,"line":3,"status":"paused"}');
  const r2 = advance(r, secs);
  check('再听往下走:按下标跳(1 → 4),念完回到原来的位置,不串到下一节', r2.line === 4 && r2.status === 'playing' && Boolean(r2.replay) && JSON.stringify(advance(r2, [sec, sec])) === '{"section":0,"line":3,"status":"paused"}');
  const w: PlayerState = { section: 0, line: 4, status: 'waiting' };
  check('等答时再听,念完还等着;重念中再点别的,回的还是最初的位置;没句子不动', JSON.stringify(advance(startReplay(w, 0, [4]), secs)) === JSON.stringify(w) && JSON.stringify(startReplay(startReplay(w, 0, [1]), 0, [2]).replay?.back) === JSON.stringify(w) && startReplay(w, 0, []) === w);
  check('能不能再听:等答 / 念完 / 暂停且老师没在想才行;在念、等下一拍、交给小课堂、老师在想都不行;再听中看回放前的位置', replayQuiet(w, false) && replayQuiet(done, false) && replayQuiet({ ...playing3, status: 'paused' }, false) && !replayQuiet(playing3, false) && !replayQuiet({ ...playing3, status: 'thinking' }, false) && !replayQuiet({ ...playing3, status: 'stage' }, false) && !replayQuiet(done, true) && replayQuiet(startReplay(w, 0, [1]), false));
  const rs = subtitleFor({ state: startReplay(w, 0, [1]), sections: secs, pending: false, waitedMs: 0, limit: false });
  check('再听时字幕:kind replay、钮是停(不是暂停,停了变「继续」的那个位置不再是同一个样子)', rs.kind === 'replay' && rs.right === 'stop' && rs.text === '句');
  check('再听不改「念到哪」:重念前面的,后面的卡照样算讲过', spokenLines(startReplay(done, 0, [1]), secs, 0) === 5);
}
{
  check('输入条:点 → 打字;按住 → 说话;松手 / 取消 / 发出 / 失焦 → 闲置', barNext('idle', 'tap') === 'typing' && barNext('idle', 'holdStart') === 'holding' && barNext('holding', 'holdEnd') === 'idle' && barNext('holding', 'holdCancel') === 'idle' && barNext('typing', 'sent') === 'idle' && barNext('typing', 'blur') === 'idle' && barNext('typing', 'tap') === 'typing' && barNext('typing', 'holdEnd') === 'typing');
  check('端:宽 ≥ 900 且横 → 平板横屏;短边 ≥ 600 → 平板竖屏;其余手机', deviceFor(1180, 820) === 'tablet-landscape' && deviceFor(820, 1180) === 'tablet-portrait' && deviceFor(390, 844) === 'phone' && deviceFor(899, 500) === 'phone' && deviceFor(1024, 768) === 'tablet-landscape');
  check('没声音时按字数计时,至少 1.2 秒', lineDurationMs('短') === 1200 && lineDurationMs('[十个字十个字十个字十]') === 2600);
  // 标注定时:按字数比例估——10 字一句 5 秒,「三角形」在第 3 字起 → 1.5s 起、描 1.5s;said 优先;讲稿里没这个词 → null;方括号不算字
  const ln = { text: '先看这[三角形]有几个角', audio: null, marks: [], ask: false, anchor: 0, cues: [] };
  const t1 = markTiming(ln, { card: 0, phrase: '三角形' }, 5000);
  const t2 = markTiming(ln, { card: 0, phrase: '三个角', said: '几个角' }, 5000);
  check('标注定时:按字数比例,方括号不算,said 优先,找不到 → null,短词至少 350ms', t1 !== null && t1.at === 1500 && t1.dur === 1500 && t2 !== null && t2.at === 3500 && t2.dur === 1500 && markTiming(ln, { card: 0, phrase: '三个角' }, 5000) === null && markTiming(ln, { card: 0, phrase: '角' }, 1000)?.dur === 350 && markTiming(ln, { card: 0, phrase: '角' }, 0) === null, JSON.stringify([t1, t2]));
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

// ---- 一个话题一节:孩子的话进问题卡(《工作流程.md》§二、拍板 17) ----
{
  check('tidySpoken:去口头禅、省略号、句末标点后的逗号;句中的「就是 4」留着;去完是空的留原话', tidySpoken('嗯……那个,要是有七个小朋友呢?就是,呃,还是十八个贴纸') === '要是有七个小朋友呢?还是十八个贴纸' && tidySpoken('嗯……每个人两个吧,呃,两个') === '每个人两个吧,两个' && tidySpoken('答案就是 4') === '答案就是 4' && tidySpoken('那个那个我不知道') === '我不知道' && tidySpoken('嗯') === '嗯' && tidySpoken('4') === '4', tidySpoken('嗯……那个,要是有七个小朋友呢?就是,呃,还是十八个贴纸'));
  const q = (t: string, extra: Partial<BoardCard['props']> = {}): BoardCard => ({ kind: 'text', props: { text: t, ...extra } });
  const asks: BoardSection = { cards: [q('想一想')], lines: [L('分完了吗?', { anchor: 0 })] };
  const askAdded: BoardSection = { cards: [{ kind: 'code', props: { code: 'x' } }, q('还剩几个?', { ask: true })], lines: [L('还剩几个?', { anchor: 0 })] };
  const onFill: BoardSection = { cards: [{ kind: 'fill', props: { text: '一共 ___ 个' } }], lines: [L('一共几个?', { anchor: 0 })] };
  const told: BoardSection = { cards: [q('一捆 10 根')], lines: [L('这就是一捆。', { anchor: 0 })] };
  check('askCard:末句问句锚着文字卡 → 它;解析器补的提问卡 → 它;锚着填空 / 没问 / 还在写 → 没有', askCard(asks) === 0 && askCard(askAdded) === 1 && askCard(onFill) === null && askCard(told) === null && askCard({ ...asks, partial: true }) === null);
  const msgs = [
    { job: 'a', question: '分一分', reply: 'x', pending: false, fromHome: true, section: asks },
    { job: 'b', question: '嗯……每个人两个吧', reply: 'x', pending: false, spoken: true, section: onFill },
    { job: 'c', question: '', reply: 'x', pending: false, action: 'submit' as const, section: asks },
    { job: 'd', question: '4', reply: null, pending: true },
  ];
  const says = kidSaid(msgs);
  check('kidSaid:首页按钮、交卡的不放;答问题卡的挂那张卡(语音去口头禅、原话留着);上一节问在填空上 → 单独一行;刚发出去的也有', !says.has('a') && !says.has('c') && says.get('b')?.on?.job === 'a' && says.get('b')?.on?.card === 0 && says.get('b')?.said.text === '每个人两个吧' && says.get('b')?.said.full === '嗯……每个人两个吧' && says.get('b')?.said.voice === true && says.get('d')?.on?.job === 'c' && says.get('d')?.said.text === '4', JSON.stringify([...says]));
  const lone = kidSaid([{ job: 'x', question: '有7个小朋友呢?', reply: 'x', pending: false, section: onFill }, { job: 'y', question: '我不会', reply: 'x', pending: false, section: asks }]);
  check('kidSaid:话题第一句、上一节问在填空上 → 单独一行(on = null)', lone.get('x')?.on === null && lone.get('y')?.on === null);
  const es = sectionsFromMessages(msgs);
  check('sectionsFromMessages:节带上 said / saidOn', es.find((e) => e.job === 'b')?.saidOn?.job === 'a' && es.find((e) => e.job === 'b')?.said?.text === '每个人两个吧' && es.find((e) => e.job === 'a')?.said === undefined);
}

done();
