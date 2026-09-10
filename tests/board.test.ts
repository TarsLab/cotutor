/** 板书解析器:真跑样本逐个过 + 围栏 / 段落 / cue / 锚点 / 未知标签 / 解析失败 / partial / H2 尾巴。 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cleanSpeech, parseBoard } from '../src/lib/board.ts';
import { check, done } from './_check.ts';

const KNOWN = ['text', 'read', 'choice', 'fill'];
const dir = fileURLToPath(new URL('./fixtures/board/', import.meta.url));
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
check('有真跑样本', fixtures.length >= 6, String(fixtures.length));
for (const f of fixtures) {
  const r = parseBoard(readFileSync(dir + f, 'utf8'));
  const { cards, lines } = r.section;
  check(`${f}:没有 warning`, r.warnings.length === 0, r.warnings.join(';'));
  check(`${f}:卡都是认识的种类`, cards.every((c) => KNOWN.includes(c.kind)), JSON.stringify(cards.map((c) => c.kind)));
  check(`${f}:有讲稿、末句问句`, lines.length >= 1 && lines[lines.length - 1].ask, JSON.stringify(lines.map((l) => l.text)));
  check(`${f}:念的句子没有方括号、没有注释、没有空句`, lines.every((l) => l.text && !/[\[\]]/.test(l.text) && !l.text.includes('<!--')), JSON.stringify(lines.map((l) => l.text)));
  check(`${f}:没有 partial 标记、没有尾巴`, r.section.partial === undefined && r.tail === '');
}
{
  const r = parseBoard(readFileSync(`${dir}chinese-tutor-2.md`, 'utf8'));
  check('静夜思:4 卡 5 句,cover / read / note / choice', r.section.cards.map((c) => c.kind + (c.props.style ? ':' + c.props.style : '')).join() === 'text:cover,read,text:note,choice' && r.section.lines.length === 5, JSON.stringify([r.section.cards.map((c) => c.kind + ':' + c.props.style), r.section.lines.length]));
  check('静夜思:[李白] 落到封面,[霜] 落到点读卡', r.section.lines[1].marks[0]?.card === 0 && r.section.lines[1].marks[0]?.phrase === '李白' && r.section.lines[2].marks[0]?.card === 1, JSON.stringify(r.section.lines.map((l) => l.marks)));
  check('静夜思:锚点 = 上一张卡,开场句没有锚点', JSON.stringify(r.section.lines.map((l) => l.anchor)) === '[null,0,1,2,3]', JSON.stringify(r.section.lines.map((l) => l.anchor)));
  const c = r.section.cards[3].props as { question: string; options: string[]; answer?: number[] };
  check('静夜思:选择题问题 + 三项 + 答案第二项', c.question.startsWith('"疑是地上霜"') && c.options.length === 3 && JSON.stringify(c.answer) === '[1]', JSON.stringify(c));
  const m = parseBoard(readFileSync(`${dir}math-tutor-3.md`, 'utf8'));
  check('问答:没有卡,两句话', m.section.cards.length === 0 && m.section.lines.length === 2 && m.section.lines[0].text === '7乘8等于56。');
}
{
  const r = parseBoard('开场一句。\n\n```text cover\n三角形\n拼一拼\n```\n\n讲[三角形]这张卡[[open]]。\n\n```python\nprint(1)\n```\n\n```\n原样\n```\n\n看代码 [[step 3]] 吧?\n');
  const { cards, lines } = r.section;
  check('围栏 = 卡:text cover 拆标题副标题;不认识的标签当代码卡(lang = 标签);没标签的围栏也是代码卡', cards.length === 3 && cards[0].kind === 'text' && cards[0].props.style === 'cover' && cards[0].props.title === '三角形' && cards[0].props.text === '拼一拼' && cards[1].kind === 'code' && cards[1].props.lang === 'python' && cards[1].props.text === 'print(1)' && cards[2].kind === 'code' && cards[2].props.lang === null, JSON.stringify(cards));
  check('段落 = 讲稿:三句,末句问句', lines.length === 3 && lines[0].text === '开场一句。' && lines[2].ask && !lines[1].ask, JSON.stringify(lines.map((l) => l.text)));
  check('[词] → 标注落到含它的卡;念的时候去括号', lines[1].marks[0]?.card === 0 && lines[1].marks[0]?.phrase === '三角形' && lines[1].text === '讲三角形这张卡。');
  check('[[cue]] → 对上一张卡的动作,句子里不留痕', lines[1].cues[0]?.name === 'open' && lines[1].cues[0]?.card === 0 && lines[2].cues[0]?.name === 'step' && lines[2].cues[0]?.arg === '3' && lines[2].cues[0]?.card === 2 && lines[2].text === '看代码 吧?'.replace(' ', ' '), JSON.stringify(lines.map((l) => [l.text, l.cues])));
  check('锚点:开场句 null,之后是上一张卡', lines[0].anchor === null && lines[1].anchor === 0 && lines[2].anchor === 2);
  check('没有 warning', r.warnings.length === 0, r.warnings.join());
}
{
  const r = parseBoard('先说这个词:[平行四边形]。\n\n```text note\n平行四边形\n```\n');
  check('卡写在句子后面,标注也认(整节找)', r.section.lines[0].marks[0]?.card === 0 && r.section.lines[0].anchor === null);
  const bad = parseBoard('```choice\n只有问题没有选项?\n```\n\n```text\n\n```\n\n一句。\n');
  check('解析不出的卡退成文字卡显示原文 + warning;孩子端什么都不报', bad.section.cards.length === 2 && bad.section.cards[0].kind === 'text' && bad.section.cards[0].props.text === '只有问题没有选项?' && bad.section.cards[1].kind === 'text' && bad.warnings.length === 2 && bad.warnings[0].includes('choice') && bad.warnings[1].includes('text'), JSON.stringify(bad));
  const open = parseBoard('一句。\n```choice\n问?\n- [x] 对\n');
  check('围栏没闭合(最终文本):当到文末成卡,记一句 warning', open.section.cards.length === 1 && open.section.cards[0].kind === 'choice' && open.warnings[0].includes('没闭合'), JSON.stringify(open));
}
{
  const p1 = parseBoard('一句。\n```choice\n问?\n- [x] 对', { partial: true });
  check('partial:没闭合的围栏压着,前面的句子先出', p1.section.cards.length === 0 && p1.section.lines.length === 1 && p1.section.partial === true, JSON.stringify(p1.section));
  const p2 = parseBoard('第一句。\n第二句还在写', { partial: true });
  check('partial:没换行结束的最后一行压着', p2.section.lines.length === 1 && p2.section.lines[0].text === '第一句。');
  const p3 = parseBoard('第一句。\n第二句写完了。\n', { partial: true });
  check('partial:有换行就算完整', p3.section.lines.length === 2);
  const p4 = parseBoard('```text\n卡\n```\n', { partial: true });
  check('partial:闭合的围栏就出卡', p4.section.cards.length === 1);
}
{
  const r = parseBoard('给孩子的话。\n\n## 家长\n他其实已经会了。\n\n## 备注\n再说。\n');
  check('第一个 H2 起是给家长的尾巴,不进板书', r.section.lines.length === 1 && r.section.cards.length === 0 && r.tail === '## 家长\n他其实已经会了。\n\n## 备注\n再说。', JSON.stringify(r));
  const inFence = parseBoard('```text\n## 不是标题\n```\n一句?\n');
  check('围栏里的 ## 不算 H2', inFence.section.cards.length === 1 && inFence.section.lines.length === 1 && inFence.tail === '');
}
{
  check('讲稿清洗:标题号、列表号、引用号、粗体号去掉;整行注释不算话', cleanSpeech('# 标题一句') === '标题一句' && cleanSpeech('- 列表一句') === '列表一句' && cleanSpeech('1. 编号一句') === '编号一句' && cleanSpeech('> 引用一句') === '引用一句' && cleanSpeech('**粗体**的话') === '粗体的话' && cleanSpeech('<!-- 注释 -->') === '' && cleanSpeech('   ') === '');
  const r = parseBoard('~~~read\napple 苹果\nbanana 香蕉\n~~~\n\n~~~fill\n三角形面积 = 底 × 高 ÷ ___,记住了___?\n= 2\n= 记住了\n~~~\n');
  check('~~~ 围栏也认;read 一行一段;fill 数空、收答案', r.section.cards[0].kind === 'read' && (r.section.cards[0].props.segments as string[]).length === 2 && r.section.cards[1].kind === 'fill' && r.section.cards[1].props.blanks === 2 && JSON.stringify(r.section.cards[1].props.answers) === '["2","记住了"]', JSON.stringify(r.section.cards));
}
done();
