/**
 * 讲稿解析器(src/board/parse.ts):讲稿一句一行、动作、请他说、尾巴、流式、工具调用、看原文;首页文件的牌(parseHomeBody)。
 * 课里的卡 2026-11-17 删了:老师写了围栏,整块不上页、不念,记一行 warning。fixtures/board/ 是那以前真跑的回复(满是卡),留着当「旧写法照样读得下」的样本。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { annotateSource, cleanSpeech, parseBoard, parseHomeBody } from '../src/board/parse.ts';
import { check, done } from './_check.ts';

const dir = fileURLToPath(new URL('./fixtures/board/', import.meta.url));
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
check('有真跑样本', fixtures.length >= 6, String(fixtures.length));
for (const f of fixtures) {
  const text = readFileSync(dir + f, 'utf8');
  const r = parseBoard(text);
  const { lines } = r.section;
  const fences = (text.match(/^ {0,3}(`{3,}|~{3,})/gm) ?? []).length / 2;
  check(`${f}:围栏一块记一行 warning,别的不报`, r.warnings.length === r.spans.fences.length && r.spans.fences.length === fences && r.warnings.every((w) => w.text.includes('不上页')), r.warnings.map((w) => w.text).join(';'));
  check(`${f}:有讲稿、末句问句`, lines.length >= 1 && lines[lines.length - 1].ask, JSON.stringify(lines.map((l) => l.text)));
  check(`${f}:念的句子没有方括号、没有注释、没有空句,也没有围栏里的字`, lines.every((l) => l.text && !/[\[\]]/.test(l.text) && !l.text.includes('<!--') && !l.text.startsWith('- [')), JSON.stringify(lines.map((l) => l.text)));
  check(`${f}:没有 partial 标记、没有尾巴`, r.section.partial === undefined && r.tail === '');
}
{
  const r = parseBoard(readFileSync(`${dir}chinese-tutor-2.md`, 'utf8'));
  check('静夜思:5 句照念,四块围栏不上页', r.section.lines.length === 5 && r.spans.fences.length === 4, JSON.stringify(r.section.lines.map((l) => l.text)));
}
{
  const r = parseBoard('开场一句。\n\n```text\n# 三角形\n拼一拼\n```\n\n讲[三角形]这张卡。\n\n看代码吧。\n');
  const { lines } = r.section;
  check('普通行 = 讲稿:三句;念的时候去方括号;不是问句不停', lines.length === 3 && lines[0].text === '开场一句。' && lines[1].text === '讲三角形这张卡。' && !lines.some((l) => l.ask), JSON.stringify(lines.map((l) => l.text)));
  check('围栏:不上页、不念,记一行 warning(带标签与行号)', r.spans.fences.length === 1 && JSON.stringify(r.spans.fences[0]) === '[2,5]' && r.warnings.length === 1 && r.warnings[0].text.includes('text') && r.warnings[0].line === 2, JSON.stringify(r.warnings));
  check('节上没有卡', !('cards' in r.section));
}
{
  // 动作:记在句子上(念完生效);只有动作的一行跟着上一句;第一句前面的记在这一节上
  const r = parseBoard('[[翻 白纸]]\n\n我们看例 4。[[看 例 4]]\n[[圈 一共有多少]]\n你先别看算式。[[盖 6×4=24]]\n');
  const { lines, acts } = r.section;
  check('第一句前面的动作记在节上', acts?.map((a) => a.name).join() === '翻', JSON.stringify(acts));
  check('动作记在句子上,只有动作的一行跟着上一句;句子里不留痕', lines.length === 2 && lines[0].text === '我们看例 4。' && lines[0].acts?.map((a) => a.name).join() === '看,圈' && lines[1].acts?.map((a) => a.name).join() === '盖', JSON.stringify(lines));
  const bad = parseBoard('看这里。[[飞 天上]]\n');
  check('不认得的动作丢掉,给家长记一行', !bad.section.lines[0].acts && bad.warnings.some((w) => w.text.includes('飞 天上')), JSON.stringify(bad));
}
{
  // 请孩子说([[请 说 词]]):动作照记,另外记成句子的 echo
  const r = parseBoard('好,我们先热热身!\n\n我说一个英文,你学一个。我先来:duck! [[请 说 duck]]\n\n搭积木:under the bus. [[请 说 under the bus]]\n\n你先说:鸭子,英文怎么说? [[请 说 duck]]\n\n热身好啦!接下来老师用英文问你。\n');
  const { lines } = r.section;
  check('[[请 说 词]] → 句子的 echo(跟我说),动作记着请 说,句子里不留痕', lines[1].echo?.word === 'duck' && !lines[1].echo?.say && lines[1].acts?.[0]?.arg === '说 duck' && lines[1].text === '我说一个英文,你学一个。我先来:duck!', JSON.stringify(lines[1]));
  check('要说的是几个词:原样留着', lines[2].echo?.word === 'under the bus' && !lines[2].echo?.say, JSON.stringify(lines[2].echo));
  check('老师这句没说那个词 → 你先说', lines[3].echo?.word === 'duck' && lines[3].echo?.say === true && lines[3].ask, JSON.stringify(lines[3]));
  const open = parseBoard('你想说什么都行。[[请 说]]\n');
  check('[[请 说]] 没写要说的:只开放说,不等', !open.section.lines[0].echo && open.section.lines[0].acts?.[0]?.arg === '说', JSON.stringify(open.section.lines[0]));
  const old = parseBoard('我先来:duck! [[echo duck]]\n');
  check('以前的 [[echo]] 不认了:丢掉、记一行', !old.section.lines[0].echo && old.warnings.some((w) => w.text.includes('echo duck')), JSON.stringify(old));
  const play = parseBoard('看这段 [[play]]。\n');
  check('[[play]] 不认了(2026-11-17 并进 [[看 0:19–0:30]]):丢掉、记一行', !play.section.lines[0].acts && play.warnings.some((w) => w.text.includes('[[看 0:19–0:30]]')), JSON.stringify(play.warnings));
}
{
  const p1 = parseBoard('一句。\n```text\n还没闭合', { partial: true });
  check('partial:没闭合的围栏压着,前面的句子先出', p1.section.lines.length === 1 && p1.section.partial === true && p1.warnings.length === 0, JSON.stringify(p1));
  const p2 = parseBoard('第一句。\n第二句还在写', { partial: true });
  check('partial:没换行结束的最后一行压着', p2.section.lines.length === 1 && p2.section.lines[0].text === '第一句。');
  const p3 = parseBoard('第一句。\n第二句写完了。\n', { partial: true });
  check('partial:有换行就算完整', p3.section.lines.length === 2);
  const shut = parseBoard('一句。\n```text\n没闭合\n');
  check('定稿时围栏没闭合:当到文末,照样不上页', shut.section.lines.length === 1 && shut.spans.fences.length === 1, JSON.stringify(shut));
}
{
  const r = parseBoard('给孩子的话。\n\n## 家长\n他其实已经会了。\n\n## 备注\n再说。\n');
  check('第一个 H2 起是给家长的尾巴,不进讲稿', r.section.lines.length === 1 && r.tail === '## 家长\n他其实已经会了。\n\n## 备注\n再说。', JSON.stringify(r));
  const inFence = parseBoard('```text\n## 不是标题\n```\n一句?\n');
  check('围栏里的 ## 不算 H2', inFence.section.lines.length === 1 && inFence.tail === '');
  check('spans:句是自己那行,尾巴从第一个 H2 到文末', JSON.stringify(parseBoard('第一句。\n\n第二句?\n').spans.lines) === '[[0,0],[2,2]]' && JSON.stringify(parseBoard('一句。\n## 家长\n悄悄话。\n').spans.tail) === '[1,2]');
}
check('讲稿清洗:标题号、列表号、引用号、粗体号去掉;整行注释不算话', cleanSpeech('# 标题一句') === '标题一句' && cleanSpeech('- 列表一句') === '列表一句' && cleanSpeech('1. 编号一句') === '编号一句' && cleanSpeech('> 引用一句') === '引用一句' && cleanSpeech('**粗体**的话') === '粗体的话' && cleanSpeech('<!-- 注释 -->') === '' && cleanSpeech('   ') === '');
{
  // annotateSource:每一行标上解析器怎么读的;行号是原文的(固定段剥掉之后也不错位)
  const src = ['先看这一块。[[看 例 4]]', '', '```text formula', 'a² + b² = c²', '```', '', '会了吗?', '[[请 圈]]', '', '## 记账', 'thread: 1620-1', 'name: 认边', '', '## 家长', '他今天卡在斜边。'].join('\n');
  const a = annotateSource(src);
  const role = (n: number): string => a.rows[n].role;
  check('annotate:讲稿 / 围栏 / 空行各归各位', role(0) === 'say' && role(1) === 'blank' && role(2) === 'fence' && role(3) === 'fence' && role(4) === 'fence' && role(6) === 'say', JSON.stringify(a.rows.map((x) => x.role)));
  check('annotate:围栏开头行写课里不上页', a.rows[2].label === '围栏 · 课里不上页', JSON.stringify(a.rows[2]));
  check('annotate:讲稿标出念完做什么;末句问句标出来', a.rows[0].label === '讲稿 1 · 播 · 念完看' && a.rows[6].label === '讲稿 2 · 问句,停下等 · 念完请', JSON.stringify([a.rows[0], a.rows[6]]));
  check('annotate:只有动作的一行标出来', a.rows[7].label?.startsWith('动作') === true, JSON.stringify(a.rows[7]));
  check('annotate:记账段不进讲稿,标出段名', role(9) === 'section' && role(10) === 'section' && role(11) === 'section' && a.rows[10].label?.includes('记账') === true, JSON.stringify(a.rows.slice(9, 12)));
  check('annotate:家长尾巴标出来,行号没错位', role(13) === 'tail' && role(14) === 'tail', JSON.stringify(a.rows.slice(13)));
}
{
  // 写成正文的工具调用(10-21 Ray 交画那轮,原文一字不差):不念、不上页,报一句;回复停在它上面 = 没写完
  const leak = '<tool_call>\n<function=Read>\n<parameter=file_path>\nconversations/chinese-tutor/2026-10-21.2059-10.cards/0.png\n</parameter>\n</function>\n</tool_call>';
  const r = parseBoard(leak);
  check('工具调用:整块不进讲稿,报一句点名工具', r.section.lines.length === 0 && r.warnings.length === 1 && r.warnings[0].text.includes('Read') && r.warnings[0].line === 0 && JSON.stringify(r.spans.toolCalls) === '[[0,6]]', JSON.stringify(r));
  const json = parseBoard('我先看看你的画。\n<tool_call>\n{"name": "read_file", "arguments": {"absolute_path": "/x/0.png"}}\n</tool_call>\n');
  check('工具调用:JSON 那种也认,前面的话照念', json.section.lines.map((l) => l.text).join() === '我先看看你的画。' && json.warnings[0]?.text.includes('read_file') === true, JSON.stringify([json.section.lines, json.warnings]));
  const mid = '先看这句。\n<function=Grep>\n<parameter=pattern>\n瀑\n</parameter>\n</function>\n再讲这句。\n';
  check('工具调用:不带外层的 <function=…> 也认,后面的话照念', parseBoard(mid).section.lines.map((l) => l.text).join('|') === '先看这句。|再讲这句。', JSON.stringify(parseBoard(mid).section.lines));
  const open = parseBoard('好的。\n<tool_call>\n<function=Read>\n<parameter=file_path>\n', { partial: true });
  check('工具调用:流式时没收尾的块压着,前面的照出', open.section.lines.map((l) => l.text).join() === '好的。' && open.warnings.length === 0, JSON.stringify([open.section.lines, open.warnings]));
  const cut = parseBoard('<function=Read>\n<parameter=file_path>\nx.png\n');
  check('工具调用:定稿时没收尾,当到文末', cut.section.lines.length === 0 && cut.warnings.length === 1, JSON.stringify([cut.section.lines, cut.warnings]));
  const fenced = parseBoard('```text\n<tool_call>\n```\n');
  check('工具调用:围栏里的不管(围栏整块不上页)', fenced.spans.toolCalls.length === 0 && fenced.spans.fences.length === 1, JSON.stringify(fenced.spans));
  const rows = annotateSource(leak).rows;
  check('看原文:整块是 drop,开头那行点名', rows.every((x) => x.role === 'drop') && rows[0].label === '写成正文的工具调用 · 不念、不上页', JSON.stringify(rows.slice(0, 2)));
}
{
  // 首页文件:围栏还是牌(老师牌、听写牌)
  const h = parseHomeBody('```tutor math-tutor\n小课堂 2026-09-18-po13-jian-8 13 减 8 怎么拆\n```\n\n```dictation chinese-tutor\n春天\n```\n\n```choice\n问?\n- [x] 对\n```\n\n## 为什么这么排\n- 样例\n');
  check('首页:老师牌、听写牌照解析;课里的卡放不了 → 退成文字、记一句(fallback)', h.cards.map((c) => c.kind).join() === 'tutor,dictation,text' && h.warnings.length === 1 && h.warnings[0].fallback === true && h.warnings[0].text.includes('choice'), JSON.stringify(h.warnings));
  check('首页:第一个 H2 起是给家长的「为什么这么排」', h.tail.startsWith('## 为什么这么排'));
}
done();
