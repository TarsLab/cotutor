/** 板书解析器:真跑样本逐个过 + 围栏 / 段落 / cue / 锚点 / 未知标签 / 解析失败 / partial / H2 尾巴。 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { annotateSource, cleanSpeech, endsWithToolCall, parseBoard } from '../src/lib/board.ts';
import { check, done } from './_check.ts';

const KNOWN = ['text', 'read', 'choice'];
const dir = fileURLToPath(new URL('./fixtures/board/', import.meta.url));
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
check('有真跑样本', fixtures.length >= 6, String(fixtures.length));
for (const f of fixtures) {
  const r = parseBoard(readFileSync(dir + f, 'utf8'));
  const { cards, lines } = r.section;
  check(`${f}:没有 warning`, r.warnings.length === 0, r.warnings.map((w) => w.text).join(';'));
  check(`${f}:卡都是认识的种类`, cards.every((c) => KNOWN.includes(c.kind)), JSON.stringify(cards.map((c) => c.kind)));
  check(`${f}:有讲稿、末句问句`, lines.length >= 1 && lines[lines.length - 1].ask, JSON.stringify(lines.map((l) => l.text)));
  check(`${f}:念的句子没有方括号、没有注释、没有空句`, lines.every((l) => l.text && !/[\[\]]/.test(l.text) && !l.text.includes('<!--')), JSON.stringify(lines.map((l) => l.text)));
  check(`${f}:没有 partial 标记、没有尾巴`, r.section.partial === undefined && r.tail === '');
}
{
  const r = parseBoard(readFileSync(`${dir}chinese-tutor-2.md`, 'utf8'));
  check('静夜思:4 卡 5 句,带标题的 text / read / text / choice', r.section.cards.map((c) => c.kind + (c.props.title ? ':' + c.props.title : '')).join() === 'text:静夜思,read,text,choice' && r.section.lines.length === 5, JSON.stringify([r.section.cards.map((c) => c.kind + ':' + c.props.style), r.section.lines.length]));
  check('静夜思:[李白] 落到封面,[霜] 落到点读卡', r.section.lines[1].marks[0]?.card === 0 && r.section.lines[1].marks[0]?.phrase === '李白' && r.section.lines[2].marks[0]?.card === 1, JSON.stringify(r.section.lines.map((l) => l.marks)));
  check('静夜思:锚点 = 上一张卡,开场句没有锚点', JSON.stringify(r.section.lines.map((l) => l.anchor)) === '[null,0,1,2,3]', JSON.stringify(r.section.lines.map((l) => l.anchor)));
  const c = r.section.cards[3].props as { question: string; options: string[]; answer?: number[] };
  check('静夜思:选择题问题 + 三项 + 答案第二项', c.question.startsWith('"疑是地上霜"') && c.options.length === 3 && JSON.stringify(c.answer) === '[1]', JSON.stringify(c));
  const m = parseBoard(readFileSync(`${dir}math-tutor-3.md`, 'utf8'));
  check('问答:两句话;末句是问句,只补一张提问卡', m.section.cards.length === 1 && m.section.cards[0].props.ask === true && m.section.lines.length === 2 && m.section.lines[0].text === '7乘8等于56。', JSON.stringify(m.section.cards));
}
{
  const r = parseBoard('开场一句。\n\n```text\n# 三角形\n拼一拼\n```\n\n讲[三角形]这张卡[[open]]。\n\n```python\nprint(1)\n```\n\n```\n原样\n```\n\n看代码 [[step 3]] 吧?\n');
  const { cards, lines } = r.section;
  check('围栏 = 卡:text 的 # 行是标题;不认识的标签当代码卡(lang = 标签);没标签的围栏也是代码卡', cards.length === 3 && cards[0].kind === 'text' && cards[0].props.title === '三角形' && cards[0].props.text === '拼一拼' && cards[1].kind === 'code' && cards[1].props.lang === 'python' && cards[1].props.text === 'print(1)' && cards[2].kind === 'code' && cards[2].props.lang === null, JSON.stringify(cards));
  check('段落 = 讲稿:三句,末句问句', lines.length === 3 && lines[0].text === '开场一句。' && lines[2].ask && !lines[1].ask, JSON.stringify(lines.map((l) => l.text)));
  const hb = parseBoard('```text\n# 两大类型\n```\n\n```text\n# 认边\n两条短边叫直角边\n```\n\n讲[直角边]。\n\n```text\n# 小结\n```\n\n再讲一句。\n');
  check('小节标题行是 heading 卡:句子锚到它前面 / 后面的真卡,标注不落在它上面', hb.section.cards[0].props.heading === true && hb.section.cards[2].props.heading === true && hb.section.lines[0].anchor === 1 && hb.section.lines[1].anchor === 1 && hb.section.lines[0].marks[0]?.card === 1 && hb.warnings.length === 0, JSON.stringify(hb.section.lines));
  check('[词] → 标注落到含它的卡;念的时候去括号', lines[1].marks[0]?.card === 0 && lines[1].marks[0]?.phrase === '三角形' && lines[1].text === '讲三角形这张卡。');
  check('[[cue]] → 对上一张卡的动作,句子里不留痕', lines[1].cues[0]?.name === 'open' && lines[1].cues[0]?.card === 0 && lines[2].cues[0]?.name === 'step' && lines[2].cues[0]?.arg === '3' && lines[2].cues[0]?.card === 2 && lines[2].text === '看代码 吧?'.replace(' ', ' '), JSON.stringify(lines.map((l) => [l.text, l.cues])));
  check('锚点:开场句 null,之后是上一张卡', lines[0].anchor === null && lines[1].anchor === 0 && lines[2].anchor === 2);
  check('没有 warning', r.warnings.length === 0, r.warnings.map((w) => w.text).join());
}
{
  // 热身的记号(《口语课实时设计.md》§三之四):不是卡的动作,记在句子上;不锚卡也认
  const r = parseBoard('好,我们先热热身!\n\n```word\n🦆 duck\nd-u-ck\n```\n\n我说一个英文,你学一个。我先来:duck! [[echo duck]]\n\n小声一点,像小老鼠:duck… [[echo]]\n\n你先说:鸭子,英文怎么说? [[say duck]]\n\n热身好啦!老师给你打个电话。 [[call]]\n');
  const { lines, cards } = r.section;
  check('[[echo 词]] → 句子的 echo,不进 cues,句子里不留痕', lines[1].echo?.word === 'duck' && !lines[1].echo?.say && lines[1].cues.length === 0 && lines[1].text === '我说一个英文,你学一个。我先来:duck!', JSON.stringify(lines[1]));
  check('[[echo]] 没写词:取这句里的英文', lines[2].echo?.word === 'duck', JSON.stringify(lines[2].echo));
  check('[[say 词]] → echo 带 say;问句末尾也不补提问卡', lines[3].echo?.word === 'duck' && lines[3].echo?.say === true && lines[3].ask && cards.every((c) => c.props.ask !== true), JSON.stringify([lines[3], cards.map((c) => c.kind)]));
  check('[[call]] → 句子的 call', lines[4].call === true && lines[4].text === '热身好啦!老师给你打个电话。' && !lines[4].echo, JSON.stringify(lines[4]));
  const bare = parseBoard('好,那我们现在就打电话! [[call]]\n');
  check('[[call]] 前面没有卡也认(收掉热身那一轮常常没卡)', bare.section.lines[0].call === true && bare.section.cards.length === 0, JSON.stringify(bare.section));
  const last = parseBoard('```word\n🚌 bus\nb-u-s\n```\n\n公共汽车呢? [[say bus]]\n');
  check('末句是 [[say]] 的问句:不补提问卡', last.section.cards.length === 1 && last.section.lines[0].echo?.say === true, JSON.stringify(last.section.cards));
  check('[[play]] 照旧是卡的动作', parseBoard('```text\n课\n```\n\n看这段 [[play]]。\n').section.lines[0].cues[0]?.name === 'play');
}
{
  const r = parseBoard('先说这个词:[平行四边形]。\n\n```text\n平行四边形\n```\n');
  check('卡写在句子后面,标注也认(整节找)', r.section.lines[0].marks[0]?.card === 0 && r.section.lines[0].anchor === null);
  const bad = parseBoard('```choice\n只有问题没有选项?\n```\n\n```text\n\n```\n\n一句。\n');
  check('解析不出的卡退成文字卡显示原文 + warning;孩子端什么都不报', bad.section.cards.length === 2 && bad.section.cards[0].kind === 'text' && bad.section.cards[0].props.text === '只有问题没有选项?' && bad.section.cards[1].kind === 'text' && bad.warnings.length === 2 && bad.warnings[0].text.includes('choice') && bad.warnings[1].text.includes('text'), JSON.stringify(bad));
  const hz = parseBoard('```tianzige\n长大\nzhǎng dà\n```\n\n```tianzige\n鼓励\ngu li4 zz\n```\n\n「长」在这里读 zhǎng。\n');
  check('田字格带拼音:对得上的进 props;对不上的卡照常只写字,记一句 warning(不是 fallback)', JSON.stringify(hz.section.cards.map((c) => c.props)) === '[{"chars":"长大","pinyin":["zhǎng","dà"]},{"chars":"鼓励"}]' && hz.warnings.length === 1 && hz.warnings[0].text.includes('拼音') && !hz.warnings[0].fallback, JSON.stringify(hz));
  const open = parseBoard('一句。\n```choice\n问?\n- [x] 对\n');
  check('围栏没闭合(最终文本):当到文末成卡,记一句 warning', open.section.cards.length === 1 && open.section.cards[0].kind === 'choice' && open.warnings[0].text.includes('没闭合'), JSON.stringify(open));
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
  check('围栏里的 ## 不算 H2', inFence.section.cards.length === 2 && inFence.section.cards[1].props.ask === true && inFence.section.lines.length === 1 && inFence.tail === '');
}
{
  check('讲稿清洗:标题号、列表号、引用号、粗体号去掉;整行注释不算话', cleanSpeech('# 标题一句') === '标题一句' && cleanSpeech('- 列表一句') === '列表一句' && cleanSpeech('1. 编号一句') === '编号一句' && cleanSpeech('> 引用一句') === '引用一句' && cleanSpeech('**粗体**的话') === '粗体的话' && cleanSpeech('<!-- 注释 -->') === '' && cleanSpeech('   ') === '');
  const r = parseBoard('~~~read\napple 苹果\nbanana 香蕉\n~~~\n\n~~~fill\n一共 ___ 个\n~~~\n');
  check('~~~ 围栏也认;read 一行一段;fill 10-22 删了 → 不认识的标签,当代码卡', r.section.cards[0].kind === 'read' && (r.section.cards[0].props.segments as string[]).length === 2 && r.section.cards[1].kind === 'code', JSON.stringify(r.section.cards));
}
{
  // spans:卡与句在原文里的行号(家长端「看原文」靠它在原文旁边标解析结果)
  const r = parseBoard('第一句。\n\n```text\n记住\n```\n\n第二句?\n');
  check(
    'spans:卡是围栏起止行,句是自己那行(补的提问卡记在末句那行)',
    JSON.stringify(r.spans.cards) === '[[2,4],[6,6]]' && JSON.stringify(r.spans.lines) === '[[0,0],[6,6]]' && r.spans.tail === null,
    JSON.stringify(r.spans),
  );
  const t = parseBoard('一句。\n## 家长\n悄悄话。\n');
  check('spans:尾巴从第一个 H2 到文末', JSON.stringify(t.spans.tail) === '[1,2]', JSON.stringify(t.spans));
}
{
  // annotateSource:每一行标上解析器怎么读的;行号是原文的(固定段剥掉之后也不错位)
  const src = [
    '先看这张卡。',
    '',
    '```text formula',
    'a² + b² = c²',
    '```',
    '',
    '会了吗?',
    '',
    '## 记账',
    'thread: 1620-1',
    'name: 认边',
    '',
    '## 家长',
    '他今天卡在斜边。',
  ].join('\n');
  const a = annotateSource(src);
  const role = (n: number): string => a.rows[n].role;
  check('annotate:讲稿 / 卡 / 空行各归各位', role(0) === 'say' && role(1) === 'blank' && role(2) === 'card' && role(3) === 'card' && role(4) === 'card' && role(6) === 'say', JSON.stringify(a.rows.map((x) => x.role)));
  check('annotate:围栏开头行标卡号、kind 与修饰', a.rows[2].open === true && a.rows[2].label === '卡 1 · text formula', JSON.stringify(a.rows[2]));
  check('annotate:末句问句标出来', a.rows[6].label === '讲稿 2 · 问句,停下等(补提问卡)' && a.rows[6].role === 'say' && a.rows[6].open === undefined, JSON.stringify(a.rows[6]));
  check('annotate:记账段不进板书,标出段名', role(8) === 'section' && role(9) === 'section' && role(10) === 'section' && a.rows[9].label?.includes('记账') === true, JSON.stringify(a.rows.slice(8, 11)));
  check('annotate:家长尾巴标出来,行号没错位', role(12) === 'tail' && role(13) === 'tail' && a.rows[12].label === '家长尾巴 · 孩子看不到', JSON.stringify(a.rows.slice(12)));
  check('annotate:板书照常(围栏一张 + 补的提问卡)', a.section.cards.length === 2 && a.section.lines.length === 2);
  const bad = annotateSource('一句。\n\n```choice\n只有问题没有选项?\n```\n');
  check('annotate:warning 的行号是原文的那一行', bad.warnings.length === 1 && bad.warnings[0].line === 2, JSON.stringify(bad.warnings));
}
{
  // 提问卡(2026-09-21):末句问句没配能答的卡 → 节尾补一张文字卡,字就是那句;锚点不动
  const r = parseBoard('```text\n# 四样东西\n时间 + 谁\n```\n\n他们在干什么呢?\n\n这是要堆[什么]?\n');
  const ask = r.section.cards[1];
  check('提问卡:末句问句没有能答的卡 → 补一张,字是念的那句(去括号),中间的问句不补', r.section.cards.length === 2 && ask.kind === 'text' && ask.props.ask === true && ask.props.text === '这是要堆什么?', JSON.stringify(r.section.cards));
  check('提问卡:末句的锚点不动、没有 warning', r.section.lines.length === 2 && r.section.lines[0].anchor === 0 && r.section.lines[1].anchor === 0 && r.warnings.length === 0, JSON.stringify(r.section.lines.map((l) => l.anchor)));
  const withChoice = parseBoard('讲一句。\n\n```choice\n几个?\n- [x] 3\n- [ ] 4\n```\n\n几个?\n');
  check('提问卡:末句锚着选择题 → 不补', withChoice.section.cards.length === 1, JSON.stringify(withChoice.section.cards));
  const before = parseBoard('几个?\n\n```choice\n有几个?\n- [x] 3\n- [ ] 4\n```\n');
  check('提问卡:问句写在能答的卡前面 → 不补', before.section.cards.length === 1, JSON.stringify(before.section.cards));
  const notLast = parseBoard('```text\n记住\n```\n\n对不对?\n\n对的。\n');
  check('提问卡:末句不是问句 → 不补', notLast.section.cards.length === 1);
  const streaming = parseBoard('```text\n记住\n```\n\n对不对?\n', { partial: true });
  check('提问卡:老师还在写(partial)不补', streaming.section.cards.length === 1);
  const home = parseBoard('```text\n今天读什么?\n```\n\n读什么?\n', { place: 'home' });
  check('提问卡:首页不补', home.section.cards.length === 1);
  // 拍给我看卡(cards/photo/card.md):孩子拍来的照片进它的答案栏,末句问不问都不再补提问卡(原来补了,孩子端写「等你说…」)
  const snap = parseBoard('今天来看图说话。\n\n```photo\n看图说话的那幅图\n```\n\n把那幅图拍下来,好吗?\n');
  check('提问卡:有拍给我看卡 → 不补;卡解析成 photo', snap.section.cards.length === 1 && snap.section.cards[0].kind === 'photo' && snap.section.cards[0].props.text === '看图说话的那幅图' && snap.warnings.length === 0, JSON.stringify(snap.section.cards));
  const snapFirst = parseBoard('```photo\n写好的那一页\n```\n\n```text\n写一句\n```\n\n写好了拍给我看,好吗?\n');
  check('提问卡:拍给我看卡不在最后、末句锚着文字卡 → 也不补', snapFirst.section.cards.length === 2, JSON.stringify(snapFirst.section.cards));
  // 实时的一轮(《实时老师设计.md》拍板 20):板上放什么由脑定,末句问话不补成提问卡;只有一行 # 标题的文字卡是节头,解析成 heading
  const live = parseBoard('```text\n# 补读音:瀑、布、穷、尽\n```\n\n先看「瀑」。\n你读读看,「瀑」怎么念?\n', { live: true });
  check('实时:末句问句不补提问卡', live.section.cards.length === 1 && live.section.cards.every((c) => c.props.ask !== true) && live.section.lines[1].ask, JSON.stringify(live.section.cards));
  check('实时:节头是 heading 文字卡,标题照写', live.section.cards[0].kind === 'text' && live.section.cards[0].props.heading === true && live.section.cards[0].props.title === '补读音:瀑、布、穷、尽', JSON.stringify(live.section.cards[0]));
  check('实时:annotate 也不标补提问卡', !annotateSource('先看「瀑」。\n你读读看?\n', { live: true }).rows.some((r) => (r.label ?? '').includes('补提问卡')));
}
{
  // 文字卡里的「= 答案」(10-20 21:24):正文有空才算答案——家长那份留着、报一句,孩子那份剥掉;没有空的算式照旧
  const { stripSecrets } = await import('../src/cards/index.ts');
  const r = parseBoard('```text\n( )穷( )尽,填两个字。\n= 山\n= 水\n```\n\n你试试填上。\n', { live: true });
  const card = r.section.cards[0];
  check('答案行:家长那份原样、报一句', card.kind === 'text' && String(card.props.text).includes('= 山') && r.warnings.some((w) => w.text.includes('像答案')), JSON.stringify([card, r.warnings]));
  const kid = stripSecrets(r.section).cards[0];
  check('答案行:孩子那份剥掉「= 」行', kid.props.text === '( )穷( )尽,填两个字。', JSON.stringify(kid.props));
  const blank = stripSecrets(parseBoard('```text\n遥读 y___\n= áo\n```\n').section).cards[0];
  check('答案行:___ 也算空', blank.props.text === '遥读 y___', JSON.stringify(blank.props));
  const math = parseBoard('```text formula\n6 × 4 ÷ 2\n= 24 ÷ 2\n= 12\n```\n');
  check('答案行:没有空的算式照旧,不报', String(stripSecrets(math.section).cards[0].props.text).includes('= 12') && math.warnings.length === 0, JSON.stringify([math.section.cards[0], math.warnings]));
}
{
  // 写成正文的工具调用(10-21 Ray 交画那轮,原文一字不差;《工作流程.md》拍板 21):板上不出、嘴不念,报一句;回复停在它上面 = 没写完
  const leak = '<tool_call>\n<function=Read>\n<parameter=file_path>\nconversations/chinese-tutor/2026-10-21.2059-10.cards/0.png\n</parameter>\n</function>\n</tool_call>';
  const r = parseBoard(leak, { live: true });
  check('工具调用:整块不进板书,报一句点名工具', r.section.lines.length === 0 && r.section.cards.length === 0 && r.warnings.length === 1 && r.warnings[0].text.includes('Read') && r.warnings[0].line === 0 && JSON.stringify(r.spans.toolCalls) === '[[0,6]]', JSON.stringify([r.section, r.warnings, r.spans]));
  check('工具调用:回复停在它上面', endsWithToolCall(leak) && endsWithToolCall(leak + '\n\n'));
  const json = parseBoard('我先看看你的画。\n<tool_call>\n{"name": "read_file", "arguments": {"absolute_path": "/x/0.png"}}\n</tool_call>\n');
  check('工具调用:JSON 那种也认,前面的话照念', json.section.lines.map((l) => l.text).join() === '我先看看你的画。' && json.warnings[0]?.text.includes('read_file') === true && endsWithToolCall('我先看看你的画。\n<tool_call>\n{"name": "read_file"}\n</tool_call>\n'), JSON.stringify([json.section.lines, json.warnings]));
  const mid = '先看这句。\n<function=Grep>\n<parameter=pattern>\n瀑\n</parameter>\n</function>\n再讲这句。\n';
  check('工具调用:不带外层的 <function=…> 也认;后面还有话就不算停在上面', parseBoard(mid).section.lines.map((l) => l.text).join('|') === '先看这句。|再讲这句。' && !endsWithToolCall(mid), JSON.stringify(parseBoard(mid).section.lines));
  const open = parseBoard('好的。\n<tool_call>\n<function=Read>\n<parameter=file_path>\n', { partial: true });
  check('工具调用:流式时没收尾的块压着,前面的照出', open.section.lines.map((l) => l.text).join() === '好的。' && open.warnings.length === 0, JSON.stringify([open.section.lines, open.warnings]));
  const cut = parseBoard('<function=Read>\n<parameter=file_path>\nx.png\n');
  check('工具调用:定稿时没收尾,当到文末', cut.section.lines.length === 0 && cut.warnings.length === 1 && endsWithToolCall('<function=Read>\n<parameter=file_path>\nx.png\n'), JSON.stringify([cut.section.lines, cut.warnings]));
  const fenced = parseBoard('```text\n<tool_call>\n```\n');
  check('工具调用:围栏里的不管,是卡的字', fenced.section.cards[0]?.props.text === '<tool_call>' && fenced.spans.toolCalls.length === 0, JSON.stringify(fenced.section.cards));
  const rows = annotateSource(leak).rows;
  check('看原文:整块是 drop,开头那行点名', rows.every((x) => x.role === 'drop') && rows[0].label === '写成正文的工具调用 · 不进板书', JSON.stringify(rows.slice(0, 2)));
}
done();
