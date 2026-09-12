/** 卡的注册表:每种卡的解析 / 剥秘密 / 语法表;不认识的标签;解析失败的退路。 */
import { CARD_KINDS, boardSyntaxDoc, cardAssets, cardKind, cardLabel, describeCard, parseCard, parseCardState, stripSecrets } from '../src/cards/index.ts';
import { parseBoard } from '../src/lib/board.ts';
import { check, done } from './_check.ts';

{
  check('有状态的卡:choice / fill / scene / canvas;text / read / image / code 没有', CARD_KINDS.filter((k) => k.state).map((k) => k.name).join() === 'choice,fill,scene,canvas');
  check('八种卡登记在册', CARD_KINDS.map((k) => k.name).join() === 'text,read,choice,fill,image,scene,canvas,code' && cardKind('choice')?.name === 'choice' && cardKind('widget') === undefined);
  const cv = parseCard('canvas', '画一个三角形,标出它的一条高。');
  check('canvas:只有题目 → 空白画板', cv.card.kind === 'canvas' && cv.card.props.base === null && cv.card.props.prompt === '画一个三角形,标出它的一条高。');
  check('canvas:课包 id 做底 + 后面的题目;标签后的词也是题目', JSON.stringify(parseCard('canvas', '2026-09-04-guilv5\n把第二个空圈出来').card.props) === '{"base":{"bundle":"2026-09-04-guilv5"},"prompt":"把第二个空圈出来"}' && parseCard('canvas 画蛇', '').card.props.prompt === '画蛇');
  const cvj = parseCard('canvas', '{"skeletons":[{"type":"rectangle","x":0,"y":0,"width":10,"height":10}]}');
  check('canvas:行内骨架 JSON 做底;坏 JSON / 没 skeletons / 全空 → 文字卡', (cvj.card.props.base as { skeletons: unknown[] }).skeletons.length === 1 && parseCard('canvas', '{bad').card.kind === 'text' && parseCard('canvas', '{"a":1}').card.kind === 'text' && parseCard('canvas', '').card.kind === 'text');
  check('canvas 状态与 describe:笔数 + 图的路径;没画', parseCardState(cv.card, { ink: [{ id: 'a' }] }).ok && !parseCardState(cv.card, { ink: 'x' }).ok && describeCard(cv.card, { ink: [{ id: 'a' }, { id: 'b' }], image: 'conversations/math-tutor/2026-09-10.1.cards/0.png' }) === 'canvas「画一个三角形,标出它的一条高。」 画了 2 笔,图:conversations/math-tutor/2026-09-10.1.cards/0.png(用 Read 看)' && describeCard(cv.card, { ink: [] }) === 'canvas「画一个三角形,标出它的一条高。」 还没画');
  const sc = parseCard('scene', '2026-09-04-guilv5\n我去把这道题画出来。');
  check('scene:第一行课包 id,后面一句给孩子的话', sc.card.kind === 'scene' && sc.card.props.bundle === '2026-09-04-guilv5' && sc.card.props.text === '我去把这道题画出来。' && !sc.warning, JSON.stringify(sc));
  check('scene:坏 id / 行内 JSON(未接)/ 空 → 文字卡 + warning', parseCard('scene', 'Bad_ID').card.kind === 'text' && parseCard('scene', '{ "title": "x" }').warning?.includes('行内') === true && parseCard('scene', '').card.kind === 'text');
  check('scene 状态与 describe:没到 / 没开始 / 停在第 n 步 / 看完', parseCardState(sc.card, { step: 2, done: false }).ok && !parseCardState(sc.card, { step: -1 }).ok && describeCard(sc.card, { step: 2, done: false }) === 'scene「我去把这道题画出来。」 课包还没做好,孩子看不了' && describeCard({ kind: 'scene', props: { bundle: 'x', title: '找规律', ready: true, steps: ['a', 'b', 'c'] } }, { step: 0, done: false }) === 'scene「找规律」 还没开始看' && describeCard({ kind: 'scene', props: { bundle: 'x', title: '找规律', ready: true, steps: ['a', 'b', 'c'] } }, { step: 2, done: false }) === 'scene「找规律」 看到第 2 步(共 3 步)停在气口' && describeCard({ kind: 'scene', props: { bundle: 'x', title: '找规律', ready: true, steps: ['a', 'b', 'c'] } }, { step: 3, done: true }) === 'scene「找规律」 看完了(共 3 步)');
  const br = parseCard('text step', '认边\n两条短边叫[直角边],最长的一条叫[斜边]');
  check('卡里写了讲稿的 [词] 语法:括号剥掉 + warning(孩子端不显示括号)', br.card.props.text === '两条短边叫直角边,最长的一条叫斜边' && br.card.props.title === '认边' && br.warning?.includes('方括号') === true, JSON.stringify(br));
  const brc = parseCard('choice', '[斜边]是多少?\n- [ ] 6\n- [x] 5');
  check('choice 的 - [ ] / - [x] 不被当成标注剥掉;问题里的括号剥', brc.card.props.question === '斜边是多少?' && JSON.stringify(brc.card.props.answer) === '[1]' && (brc.card.props.options as string[]).join() === '6,5', JSON.stringify(brc));
  check('code / canvas 的正文不动方括号(JSON 里有 [ ])', parseCard('python', 'a = [1, 2]').card.props.text === 'a = [1, 2]' && !parseCard('canvas', '{"skeletons":[{"type":"rectangle","x":0,"y":0,"width":10,"height":10}]}').warning && parseCard('text', '一段没有括号的话').warning === undefined);
  check('要预生成资产的只有点读', CARD_KINDS.filter((k) => k.assets).map((k) => k.name).join() === 'read');
  const rd = parseCard('read', 'apple 苹果\nbanana 香蕉');
  check('read 资产:一段一个 <k>.mp3', JSON.stringify(cardAssets(rd.card)) === '[{"file":"1.mp3","text":"apple 苹果"},{"file":"2.mp3","text":"banana 香蕉"}]' && cardAssets({ kind: 'text', props: { text: 'x' } }).length === 0 && cardAssets({ kind: 'read', props: {} }).length === 0);
  const im = parseCard('image', 'vault/照片/a.jpg\n看第二行\n那里错了');
  check('image:第一行路径,后面图注', im.card.kind === 'image' && im.card.props.src === 'vault/照片/a.jpg' && im.card.props.caption === '看第二行\n那里错了' && !im.warning, JSON.stringify(im));
  check('image:http 地址也行;没图注就没有 caption', parseCard('image', 'https://x.test/a').card.props.src === 'https://x.test/a' && !('caption' in parseCard('image', 'a.png').card.props));
  check('image:不是图片文件 / 空 → 文字卡 + warning', parseCard('image', 'vault/笔记.md').card.kind === 'text' && parseCard('image', '').warning?.includes('image') === true);
  check('image 的标题是图注,没图注是「图」', cardLabel(im.card) === '看第二行 那里错了' && cardLabel(parseCard('image', 'a.png').card) === '');
  const t = parseCard('text', '就一段话。\n第二行。');
  check('text:普通一段,保留换行', t.card.kind === 'text' && t.card.props.text === '就一段话。\n第二行。' && t.card.props.style === undefined && !t.warning);
  const th = parseCard('text', '# 认边\n两条短边叫直角边');
  check('text:第一行 # 是标题,不用修饰词', th.card.props.title === '认边' && th.card.props.text === '两条短边叫直角边' && th.card.props.style === undefined && th.card.props.heading === undefined && !th.warning, JSON.stringify(th));
  const hd = parseCard('text', '# 两大类型');
  check('text:只有一行 # 标题 → 小节标题(heading),不算卡', hd.card.props.heading === true && hd.card.props.title === '两大类型' && hd.card.props.text === '' && !hd.warning, JSON.stringify(hd));
  check('text:带修饰词时第一行照旧(cover 的标题不用 #);# 只在没修饰词时认', parseCard('text cover', '# 勾股定理\n副标题').card.props.title === '# 勾股定理' && parseCard('text note', '# 记住').card.props.text === '# 记住');
  const cover = parseCard('text cover', '\n三角形的面积\n两个一样的三角形\n');
  check('text cover:第一行标题,其余副标题', cover.card.props.style === 'cover' && cover.card.props.title === '三角形的面积' && cover.card.props.text === '两个一样的三角形');
  const step = parseCard('TEXT Step', '拼\n把两个拼起来');
  check('text step:大小写不敏感;第一行是这步的名字', step.card.props.style === 'step' && step.card.props.title === '拼' && step.card.props.text === '把两个拼起来');
  const formula = parseCard('text formula', 'S = a × h ÷ 2');
  check('text formula', formula.card.props.style === 'formula' && formula.card.props.text === 'S = a × h ÷ 2');
  const odd = parseCard('text fancy', '一段');
  check('text 不认识的修饰词当没有', odd.card.props.style === undefined && odd.card.props.text === '一段');
  const empty = parseCard('text', '  \n ');
  check('text 空正文 → 退成文字卡(显示标签名)+ warning', empty.card.kind === 'text' && empty.card.props.text === 'text' && empty.warning?.includes('空') === true, JSON.stringify(empty));
}
{
  const c = parseCard('choice', '酒是谁的?\n- [ ] 大家平分\n- [x] 他自己的\n* [X] 也算对\n- 没标的\n散话不要');
  const p = c.card.props as { question: string; options: string[]; answer?: number[]; multi?: boolean };
  check('choice:问题 + 选项(- / * 都行)+ 答案下标(x / X 都认,可多个)', p.question === '酒是谁的?' && p.options.join('|') === '大家平分|他自己的|也算对|没标的' && JSON.stringify(p.answer) === '[1,2]', JSON.stringify(p));
  const s = stripSecrets({ cards: [c.card], lines: [] });
  check('choice 剥秘密:答案不下发', !('answer' in s.cards[0].props) && (s.cards[0].props.options as string[]).length === 4, JSON.stringify(s));
  const noKey = parseCard('choice', '问?\n- [ ] 甲\n- [ ] 乙');
  check('choice 没标答案就没有 answer 字段', !('answer' in noKey.card.props));
  const noOpt = parseCard('choice', '只有问题');
  check('choice 没选项 → 文字卡 + warning', noOpt.card.kind === 'text' && noOpt.warning?.includes('选项') === true);
  check('choice 多个 [x] → multi,剥答案后还在;单个没有 multi', p.multi === true && (s.cards[0].props as { multi?: boolean }).multi === true && parseCard('choice', '问?\n- [x] 甲\n- [ ] 乙').card.props.multi === undefined);
  // 状态:孩子选了哪几项 → 过契约 → 给老师的一句(带答案);紧凑态 / 舞台的画法在页面
  const ok = parseCardState(c.card, { picked: [1] });
  check('choice 状态过契约', ok.ok && JSON.stringify(ok.state) === '{"picked":[1]}');
  check('choice 坏状态不收;text 卡没有状态', !parseCardState(c.card, { picked: ['a'] }).ok && !parseCardState(c.card, 'x').ok && !parseCardState({ kind: 'text', props: { text: 'x' } }, {}).ok && !parseCardState({ kind: 'scene', props: {} }, {}).ok);
  check('choice describe:选了「B …」(答案:「…」)', describeCard(c.card, { picked: [0] }) === 'choice「酒是谁的?」 选了「A 大家平分」(答案:「B 他自己的」「C 也算对」)', describeCard(c.card, { picked: [0] }));
  check('choice describe:没标答案就不写答案;没选;越界的下标丢掉', describeCard(noKey.card, { picked: [1] }) === 'choice「问?」 选了「B 乙」' && describeCard(noKey.card, { picked: [] }) === 'choice「问?」 没选' && describeCard(noKey.card, { picked: [9] }) === 'choice「问?」 没选');
  check('不认识的 kind / 坏状态 → 状态原样 JSON', describeCard({ kind: 'scene', props: { title: '场景' } }, { step: 2 }) === 'scene「场景」 {"step":2}' && describeCard(c.card, 'junk') === 'choice「酒是谁的?」 "junk"');
  check('卡的标题:title > question > text > 第一段;截 40 字', cardLabel({ kind: 'text', props: { style: 'cover', title: '画蛇添足', text: '副' } }) === '画蛇添足' && cardLabel({ kind: 'read', props: { segments: ['楚有祠者', 'x'] } }) === '楚有祠者' && cardLabel({ kind: 'text', props: { text: '一'.repeat(50) } }).length === 41);
  const noQ = parseCard('choice', '- [ ] 甲\n- [ ] 乙');
  check('choice 没问题 → 文字卡 + warning', noQ.card.kind === 'text' && noQ.warning?.includes('问题') === true);
}
{
  const f = parseCard('fill', '底 × 高 ÷ ____ = 面积,单位是___。\n= 2\n= 平方厘米');
  check('fill:空统一成 ___、数空、答案按顺序', f.card.props.text === '底 × 高 ÷ ___ = 面积,单位是___。' && f.card.props.blanks === 2 && JSON.stringify(f.card.props.answers) === '["2","平方厘米"]', JSON.stringify(f));
  check('fill 剥秘密:answers 不下发', !('answers' in stripSecrets({ cards: [f.card], lines: [] }).cards[0].props));
  check('fill 没留空 → 文字卡 + warning', parseCard('fill', '没有空\n= 1').card.kind === 'text');
  const r = parseCard('read', '\napple 苹果\n\nbanana 香蕉\n');
  check('read:非空行成段', JSON.stringify(r.card.props.segments) === '["apple 苹果","banana 香蕉"]');
  check('read 空 → 文字卡', parseCard('read', '\n').card.kind === 'text');
  check('fill 状态与 describe:第 n 空填「…」(答案「…」),没填的写没填', parseCardState(f.card, { answers: ['2'] }).ok && describeCard(f.card, { answers: ['2', ''] }).startsWith('fill「') && describeCard(f.card, { answers: ['2'] }).includes('第 1 空填「2」'), describeCard(f.card, { answers: ['2'] }));
}
{
  const py = parseCard('python', 'print(1)\n');
  check('不认识的标签 → 代码卡,lang = 标签,尾空白去掉', py.card.kind === 'code' && py.card.props.lang === 'python' && py.card.props.text === 'print(1)');
  const bare = parseCard('', 'x');
  check('没标签 → 代码卡 lang null', bare.card.kind === 'code' && bare.card.props.lang === null);
  const widget = parseCard('widget', '画一个三角形');
  check('还没做的种类(widget)也只是代码卡,不报错', widget.card.kind === 'code' && widget.card.props.lang === 'widget' && !widget.warning);
  check('不认识的 kind 剥秘密时原样', stripSecrets({ cards: [{ kind: 'widget', props: { a: 1 } }], lines: [] }).cards[0].props.a === 1);
}
{
  const doc = boardSyntaxDoc();
  check('语法表:两种东西 + 每种卡一段 + 家长段', doc.includes('普通段落 = 你说的话') && doc.includes('围栏 = 板上的卡') && CARD_KINDS.every((k) => doc.includes(`### ${k.name}`)) && doc.includes('## 家长'), doc.slice(0, 200));
  check('语法表里的例子自己能解析', parseBoard_ok(doc));
}
function parseBoard_ok(doc: string): boolean {
  // 语法表里 ```` 包着的例子块:取出来过一遍解析器,不该有 warning
  const blocks = [...doc.matchAll(/````\n([\s\S]*?)\n````/g)].map((m) => m[1]);
  if (!blocks.length) return false;
  return blocks.every((b) => {
    const r = parseBoardSync(b);
    return r.warnings.length === 0 && r.cards > 0;
  });
}
function parseBoardSync(b: string): { warnings: string[]; cards: number } {
  const r = parseBoard(`${b}\n`);
  return { warnings: r.warnings.map((w) => w.text), cards: r.section.cards.length };
}
done();
