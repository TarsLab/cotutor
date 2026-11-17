/** 讲稿里的动作(src/board/acts.ts 与 parse.ts):每种动作的写法、写错的样子、动作跟着哪一句。 */
import { actParts, actText, readMark, readMarks } from '../src/board/acts.ts';
import { annotateSource, parseBoard } from '../src/board/parse.ts';
import type { LineAct } from '../src/schema/index.ts';
import { readFileSync } from 'node:fs';
import { actsGuide } from '../src/board/cards/docs.ts';
import { check, done } from './_check.ts';

const ok = (raw: string): LineAct | null => { const m = readMark(raw); return m.kind === 'act' ? m.act : null; };
const bad = (raw: string): string | null => { const m = readMark(raw); return m.kind === 'bad' ? m.why : null; };
const parts = (raw: string) => { const a = ok(raw); return a ? actParts(a) : null; };

// ——— 每种动作写对的样子 ———
check('看 第 3 题', JSON.stringify(parts('看 第 3 题')) === '{"name":"看","target":"第 3 题"}', JSON.stringify(parts('看 第 3 题')));
check('看 不空格也认(看例2)', JSON.stringify(parts('看例2')) === '{"name":"看","target":"例2"}', JSON.stringify(parts('看例2')));
check('看 一句原话,引号去掉', (parts('看 「小鸟回答说」') as { target: string } | null)?.target === '小鸟回答说');
check('翻 课名', JSON.stringify(parts('翻 6的乘法口诀')) === '{"name":"翻","lesson":"6的乘法口诀"}');
check('翻 目录', (parts('翻 目录') as { lesson: string } | null)?.lesson === '目录');
check('圈 一处', JSON.stringify(parts('圈 心理辅导室')) === '{"name":"圈","spots":["心理辅导室"]}');
check('圈 几处用顿号', JSON.stringify((parts('圈 井沿、无边无际') as { spots: string[] }).spots) === '["井沿","无边无际"]');
check('遮 几处', (parts('遮 傍晚,晒') as { spots: string[] }).spots.length === 2);
check('盖 算式(带空格的算式不拆开)', JSON.stringify((parts('盖 3 × 5 = 15') as { spots: string[] }).spots) === '["3 × 5 = 15"]');
check('写 一行字,缺省中号', JSON.stringify(parts('写 6×4=24')) === '{"name":"写","text":"6×4=24","size":"中"}', JSON.stringify(parts('写 6×4=24')));
check('写 大 / 写 … 小:档摘出来', (parts('写 大 6×4=24') as { size: string }).size === '大' && (parts('写 6 个 6 个地数 小') as { size: string; text: string }).text === '6 个 6 个地数');
check('写 一个字的「大」不当档', (parts('写 大') as { text: string } | null)?.text === '大');
check('擦:擦上一样', JSON.stringify(parts('擦')) === '{"name":"擦","all":false}');
check('擦 全部 / 擦 白纸条:整条', (parts('擦 全部') as { all: boolean }).all && (parts('擦 白纸条') as { all: boolean }).all);
const dots = parts('摆 点阵 6 行 6 个') as { kit: string; params: Record<string, string>; size: string } | null;
check('摆 点阵 6 行 6 个:简写读成行、每行', dots?.kit === '点阵' && dots.params['行'] === '6' && dots.params['每行'] === '6' && dots.size === '中', JSON.stringify(dots));
const dots2 = parts('摆 点阵 共 17 个 每行 5 个 大') as { params: Record<string, string>; size: string } | null;
check('摆 点阵 共 17 个 每行 5 个 大', dots2?.params['共'] === '17' && dots2.params['每行'] === '5' && dots2.size === '大', JSON.stringify(dots2));
const comp = parts('摆 方向盘 上 东') as { kit: string; params: Record<string, string> } | null;
check('摆 方向盘 上 东', comp?.kit === '方向盘' && comp.params['上'] === '东' && comp.params['小人'] === '有', JSON.stringify(comp));
const comp2 = parts('摆 方向盘 上 南 小人 没有') as { params: Record<string, string> } | null;
check('摆 方向盘 一个键一个值', comp2?.params['上'] === '南' && comp2.params['小人'] === '没有', JSON.stringify(comp2));
check('摆 方向盘 不带参数:缺省', (parts('摆 方向盘') as { params: Record<string, string> } | null)?.params['上'] === '北');
check('请 圈', JSON.stringify(parts('请 圈')) === '{"name":"请","ops":["圈"],"dropped":[]}');
check('请 写、圈', JSON.stringify((parts('请 写、圈') as { ops: string[] }).ops) === '["写","圈"]');
check('请 说 一句:说 后面的是要孩子说的', JSON.stringify(parts('请 说 The ducks are under the bus')) === '{"name":"请","ops":["说"],"dropped":[],"say":"The ducks are under the bus"}', JSON.stringify(parts('请 说 The ducks are under the bus')));
check('请 说 一句:动作的原文留着那一句', ok('请 说 duck')?.arg === '说 duck' && ok('请 说「床前明月光」')?.arg === '说 床前明月光');
check('请 说 不带:只开放说;请 说、写:两样都开', JSON.stringify(parts('请 说')) === '{"name":"请","ops":["说"],"dropped":[]}' && JSON.stringify((parts('请 说、写') as { ops: string[]; say?: string }).ops) === '["说","写"]' && !(parts('请 说、写') as { say?: string }).say);
check('请 圈、说 duck:前面的照开,说 后面的是那一句', JSON.stringify(parts('请 圈、说 duck')) === '{"name":"请","ops":["圈","说"],"dropped":[],"say":"duck"}', JSON.stringify(parts('请 圈、说 duck')));
check('请 说 太长', Boolean(bad('请 说 ' + 'a'.repeat(61))));
{
  const m = readMark('请 圈、飞');
  check('请 里有不认得的:认得的留下、记一句', m.kind === 'act' && m.act.arg === '圈' && Boolean(m.warn?.includes('飞')), JSON.stringify(m));
}

// ——— 写错的样子 ———
check('看 没写哪里', Boolean(bad('看')));
check('翻 没写课', Boolean(bad('翻')));
check('圈 没写字', Boolean(bad('圈')));
check('圈 超过 4 处', Boolean(bad('圈 一、二、三、四、五')));
check('遮 一处太长', Boolean(bad('遮 一二三四五六七八九十一二三')));
check('写 没写字', Boolean(bad('写')));
check('写 太长', Boolean(bad('写 一二三四五六七八九十一二三四五六七八九十一二三四五')));
check('擦 带了认不出的参数', Boolean(bad('擦 第3题')));
check('摆 不认得的图形', Boolean(bad('摆 数轴 0 到 10')));
check('摆 没写图形', Boolean(bad('摆')));
check('摆 点阵 行数超了', Boolean(bad('摆 点阵 10 行 6 个')));
check('摆 点阵 认不出的参数', Boolean(bad('摆 点阵 一堆')));
check('摆 方向盘 上 写错', Boolean(bad('摆 方向盘 上 中')));
check('请 一个都不认得', Boolean(bad('请 飞')));
check('请 没写', Boolean(bad('请')));
check('不认得的名字(英文)', Boolean(bad('open')));
check('不认得的名字(中文)', Boolean(bad('跳 第 3 题')));
check('play 不认了(并进 看 0:19–0:30);echo / say 不认了(并进 请 说),call 不认了(打电话删了)', readMark('play').kind === 'bad' && (readMark('play') as { why: string }).why.includes('[[看 0:19–0:30]]') && readMark('call').kind === 'bad' && readMark('echo duck').kind === 'bad' && readMark('say duck').kind === 'bad');
check('一行里的几处都读出来,句子里拿掉', JSON.stringify(readMarks('你先圈出来。[[圈 心理辅导室]] [[请 圈]]')) === JSON.stringify({ text: '你先圈出来。', marks: [{ kind: 'act', act: { name: '圈', arg: '心理辅导室' } }, { kind: 'act', act: { name: '请', arg: '圈' } }] }), JSON.stringify(readMarks('你先圈出来。[[圈 心理辅导室]] [[请 圈]]')));
check('actText 说回原文', actText({ name: '看', arg: '第 3 题' }) === '[[看 第 3 题]]' && actText({ name: '擦', arg: '' }) === '[[擦]]');

// ——— 动作跟着哪一句 ———
{
  const r = parseBoard('我们看第 3 题。[[看 第 3 题]]\n你先把「心理辅导室」圈出来。[[圈 心理辅导室]] [[请 圈]]\n6 个一串,我们摆出来。\n[[摆 点阵 6 行 6 个]]\n你把它们 6 个 6 个圈起来?[[请 圈]]\n');
  const { lines } = r.section;
  check('写在句子后面:这一句的动作', JSON.stringify(lines[0].acts) === '[{"name":"看","arg":"第 3 题"}]' && lines[0].text === '我们看第 3 题。', JSON.stringify(lines[0]));
  check('一句后面几个:都在这一句上,照写的先后', JSON.stringify(lines[1].acts?.map((a) => a.name)) === '["圈","请"]');
  check('只有动作的一行:跟着上一句', lines.length === 4 && JSON.stringify(lines[2].acts) === '[{"name":"摆","arg":"点阵 6 行 6 个"}]', JSON.stringify(lines.map((l) => [l.text, l.acts])));
  check('没有写错的', r.warnings.length === 0, JSON.stringify(r.warnings));
  check('这一节没有第一句前面的动作', r.section.acts === undefined);
}
{
  const r = parseBoard('[[翻 6的乘法口诀]]\n[[看 例 4]]\n明天学6的乘法口诀。\n');
  check('第一句前面的动作:记在这一节上(马上生效)', JSON.stringify(r.section.acts?.map((a) => a.name)) === '["翻","看"]' && !r.section.lines[0].acts, JSON.stringify(r.section));
  const only = parseBoard('[[看 第 3 题]]\n');
  check('只有动作没有话:都在这一节上', only.section.lines.length === 0 && only.section.acts?.[0]?.name === '看');
  const same = parseBoard('[[看 例 4]] 这一题我们一起看。\n');
  check('动作写在句子前面、同一行:还是这一句的(念完生效)', same.section.lines[0].acts?.[0]?.name === '看' && same.section.lines[0].text === '这一题我们一起看。');
}
{
  const r = parseBoard('看这里。[[跳 第 3 题]] [[看]]\n[[open]]\n好。[[请 圈、飞]]\n');
  check('不认得的、写错的丢掉,一处记一行 warning(带行号)', r.warnings.length === 4 && r.warnings[0].line === 0 && r.warnings[2].line === 1 && r.warnings[3].line === 2 && r.warnings.every((w) => w.text.includes('[[') || w.text.includes('请')), JSON.stringify(r.warnings));
  check('丢掉的不留在句子里、不进动作', r.section.lines[0].text === '看这里。' && !r.section.lines[0].acts && JSON.stringify(r.section.lines[1].acts) === '[{"name":"请","arg":"圈"}]', JSON.stringify(r.section.lines));
}
{
  // 流式:没换行结束的最后一行压着,动作也不出
  const p = parseBoard('我们看第 3 题。[[看 第 3 题]]\n你圈出来。[[圈 心', { partial: true });
  check('流式:最后半行压着', p.section.lines.length === 1 && p.section.lines[0].acts?.[0]?.name === '看' && p.warnings.length === 0, JSON.stringify(p));
}
{
  // 家长端看原文:讲稿一行标上念完做什么;只有动作的一行另标
  const a = annotateSource('[[翻 6的乘法口诀]]\n我们看例 4。[[看 例 4]]\n[[请 圈]]\n');
  check('看原文:讲稿标「念完看」,只有动作的行标「动作」', a.rows[1].label?.includes('念完看') === true && a.rows[0].label?.startsWith('动作') === true && a.rows[2].label?.startsWith('动作') === true, JSON.stringify(a.rows));
}
// ——— 给老师的那一页(cards/动作怎么写.md):里面写的每个动作都读得成 ———
{
  const all = [...actsGuide().matchAll(/\[\[([^\[\]]+)\]\]/g)].map((m) => m[1]);
  const wrong = all.filter((x) => readMark(x).kind !== 'act');
  check('动作怎么写.md:每个 [[ ]] 都是读得成的动作', all.length >= 15 && !wrong.length, wrong.join(' / '));
  const g = actsGuide();
  check('递给老师的那一页剥掉了给人看的注释', g.startsWith('# 讲稿与动作怎么写') && !g.includes('给人看'), g.slice(0, 80));
  const math = readFileSync(new URL('../grades/grade-2/agents/math-tutor/activities/预习.md', import.meta.url), 'utf8');
  const mwrong = [...math.matchAll(/\[\[([^\[\]]+)\]\]/g)].map((m) => m[1]).filter((x) => readMark(x).kind !== 'act');
  check('数学「预习」里写的动作都读得成', !mwrong.length, mwrong.join(' / '));
}
done();
