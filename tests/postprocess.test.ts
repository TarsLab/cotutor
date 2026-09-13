/** 板书后期的纯函数:提示词从主题清单现拼、输出解析(带围栏 / 多话也能取出 JSON)、校验的每条规则各一正一反、回退。 */
import { parseBoard } from '../src/lib/board.ts';
import { MAX_CARDS_PER_ROW, MAX_MARKS_PER_CARD, MAX_MARKS_PER_LINE, POST_TEMPLATE_FALLBACK, beatPrompt, fallbackPost, missingSlots, parsePost, validateBeatPost, validatePost } from '../src/lib/postprocess.ts';
import { beatsOf } from '../src/lib/kid-board.ts';
import { readFileSync } from 'node:fs';
import { unwrapJsonOutput } from '../src/server/post.ts';
import { ThemeManifestSchema } from '../src/schema/index.ts';
import { check, done } from './_check.ts';

const theme = ThemeManifestSchema.parse({ name: 't', default: 'paper', tints: { paper: { use: '公式、图' }, sky: { use: '结论、定义' }, moss: { use: '方法' } }, looks: { plain: { use: '缺省' }, title: { use: '大字' } }, pens: { marker: { use: '荧光' }, circle: { use: '圈' } } });
const section = parseBoard('```text cover\n勾股定理\n直角三角形三条边的关系\n```\n\n先认边。\n\n```text\n# 认边\n两条短边叫直角边,最长的一条叫斜边\n```\n\n两条短边叫[直角边],最长的一条叫斜边。\n\n```text formula\n直角边² + 直角边² = 斜边²\n```\n\n记住这个公式。\n\n```text\n# 小结\n```\n\n```choice\n两条直角边是 3 和 4,斜边是多少?\n- [ ] 6\n- [x] 5\n```\n\n斜边是多少?\n').section;

{
  const beats = beatsOf(section);
  const p = beatPrompt(section, beats.find((x) => x.card === 4)!, 'tablet-landscape', theme);
  check('提示词(一拍):槽表从清单现拼(名字 + 给什么用)、端的说明、前文列出已定的卡、这拍的卡标出有交互、规则与输出形状、只要 JSON', p.includes('- sky:结论、定义') && p.includes('- circle:圈') && p.includes('平板横屏') && p.includes('- 0. text:标题「勾股定理」;') && p.includes('- 3. text(小节标题行') && p.includes('卡 4. choice(有交互,独占一行)') && p.includes('0. 斜边是多少?') && p.includes(`一句最多 ${MAX_MARKS_PER_LINE} 处`) && p.includes('"row":"same"|"new"') && p.includes('只输出一个 JSON'), p.slice(0, 400));
  const p1 = beatPrompt(section, beats.find((x) => x.card === 1)!, 'phone', theme);
  check('换端提示词跟着变;老师已标的带 ★;第一张卡的前文写「前面没有」', p1.includes('手机竖屏') && !p1.includes('平板横屏') && p1.includes('★老师已标:「直角边」(卡 1)') && beatPrompt(section, beats.find((x) => x.card === 0)!, 'phone', theme).includes('前面没有'));
  check('提示词讲了 said(讲稿里念到的词)', p.includes('- said:') && p.includes('"said":"…"'));
  // 骨架:主题的 post.md 与代码里的兜底同文;缺必需占位符就退兜底;不认识的占位符原样留
  const shipped = readFileSync(new URL('../themes/default/post.md', import.meta.url), 'utf8');
  check('出厂 post.md 与 POST_TEMPLATE_FALLBACK 同文;必需占位符齐', shipped === POST_TEMPLATE_FALLBACK && missingSlots(shipped).length === 0 && JSON.stringify(missingSlots('只有 {cards} 和 {lines}')) === '["rules","output"]');
  check('主题骨架可改:自己的一句话进了提示词;缺必需占位符 → 退出厂骨架', beatPrompt(section, beats[1], 'phone', theme, '我的口味:圈少一点。\n{rules}\n{cards}\n{lines}\n{output}\n{nope}').startsWith('我的口味:圈少一点。') && beatPrompt(section, beats[1], 'phone', theme, '我的口味\n{cards}\n{lines}\n{output}\n{nope}').includes('{nope}') === false && beatPrompt(section, beats[1], 'phone', theme, '坏骨架').startsWith('你是一节板书的后期'));
}
{
  // 按拍校验:行二选一——same 接上一行要上一行还有位、两边都不是独占的卡;标注只能标这拍或前面的卡;look 进这拍的卡
  const beats = beatsOf(section);
  const b1 = beats.find((x) => x.card === 1)!, b2 = beats.find((x) => x.card === 2)!, b3 = beats.find((x) => x.card === 3)!, b4 = beats.find((x) => x.card === 4)!;
  let cur = validateBeatPost(section, beats.find((x) => x.card === 0)!, theme, 'tablet-landscape', { row: 'same', marks: [], anchors: [] }).section;
  check('第一张卡写 same 也另起一行(前面没有行)', JSON.stringify(cur.layout?.rows) === '[[0]]');
  const v1 = validateBeatPost(cur, b1, theme, 'tablet-landscape', { row: 'new', look: { tint: 'sky' }, marks: [{ line: 0, phrase: '斜边', pen: 'circle' }, { line: 0, card: 2, phrase: '斜边²', pen: 'marker' }], anchors: [] });
  cur = v1.section;
  check('拍 1:另起一行、样子进卡 1、标这拍的卡收下、标后面的卡丢掉(只能前面已定的)', JSON.stringify(cur.layout?.rows) === '[[0],[1]]' && cur.cards[1].look?.tint === 'sky' && v1.kept.marks === 1 && cur.lines[1].marks.length === 2 && v1.dropped.length === 1 && v1.dropped[0].includes('只能标这拍的卡或前面已定的卡'), JSON.stringify(v1.dropped));
  const v2 = validateBeatPost(cur, b2, theme, 'tablet-landscape', { row: 'same', marks: [{ line: 0, card: 1, phrase: '斜边', pen: 'marker' }], anchors: [{ line: 0, card: 1 }] });
  cur = v2.section;
  check('拍 2:接上一行(与卡 1 并排);标前面的卡但这个词那张卡上已标过 → 丢;锚点指前面的卡收下', JSON.stringify(cur.layout?.rows) === '[[0],[1,2]]' && v2.kept.row === 'same' && v2.kept.marks === 0 && v2.dropped[0].includes('已经标过') && cur.lines[2].anchor === 1 && v2.kept.anchors === 1, JSON.stringify(v2.dropped));
  const v3 = validateBeatPost(cur, b3, theme, 'tablet-landscape', { row: 'same', look: { tint: 'sky' }, marks: [], anchors: [] });
  cur = v3.section;
  check('拍 3(标题行):same 改成 new(独占)、样子丢掉', JSON.stringify(cur.layout?.rows) === '[[0],[1,2],[3]]' && v3.kept.row === 'new' && v3.dropped.some((d) => d.includes('有独占一行的卡')) && v3.dropped.some((d) => d.includes('标题行没有样子')), JSON.stringify(v3.dropped));
  const v4 = validateBeatPost(cur, b4, theme, 'phone', { row: 'same', marks: [{ line: 0, phrase: '5', pen: 'box', said: '多少' }], anchors: [] });
  check('拍 4(选择题):独占;标注带 said;行为哪个端排的记在 layout.for', JSON.stringify(v4.section.layout?.rows) === '[[0],[1,2],[3],[4]]' && v4.section.layout?.for === 'phone' && v4.section.lines[3].marks[0].said === '多少' && v4.kept.marks === 1, JSON.stringify(v4.dropped));
}
{
  // said:讲稿第 3 句「记住这个公式。」——卡 2 上的「斜边²」讲稿没说,said 填「公式」能定时;said 不在讲稿里只丢 said,标注留下
  const v = validatePost(section, theme, 'phone', { marks: [{ line: 2, card: 2, phrase: '斜边²', pen: 'marker', said: '公式' }, { line: 2, card: 2, phrase: '直角边²', pen: 'circle', said: '没说过' }], anchors: [], look: {} });
  const ms = v.section.lines[2].marks;
  check('said:在讲稿里 → 存进标注;不在 → 只丢 said、标注照收', v.kept.marks === 2 && ms.length === 2 && ms[0].said === '公式' && ms[1].said === undefined && v.dropped.length === 1 && v.dropped[0].includes('只丢 said'), JSON.stringify({ ms, dropped: v.dropped }));
}
{
  const ok = parsePost('好的,提案如下:\n```json\n{"marks":[{"line":0,"card":0,"phrase":"勾股定理","pen":"marker"}],"layout":{"rows":[[0],[1,2],[3],[4]]}}\n```\n以上。');
  check('解析:围栏与多话里取出 JSON,缺的字段补缺省', ok.ok && ok.out.marks.length === 1 && ok.out.anchors.length === 0 && Object.keys(ok.out.look).length === 0 && ok.out.layout?.rows.length === 4, JSON.stringify(ok));
  check('解析:没有 JSON / 坏 JSON / 形状不对 → 不过,带原因', !parsePost('我觉得挺好').ok && !parsePost('{"marks": [').ok && !parsePost('{"marks":[{"line":"a"}]}').ok);
  check('claude --output-format json 的壳:正文在 result、费用在 total_cost_usd;别的原样', unwrapJsonOutput('{"type":"result","result":"{\\"marks\\":[]}","total_cost_usd":0.002}').text === '{"marks":[]}' && unwrapJsonOutput('{"type":"result","result":"x","total_cost_usd":0.002}').costUsd === 0.002 && unwrapJsonOutput('{"marks":[]}').text === '{"marks":[]}' && unwrapJsonOutput('纯文字').costUsd === undefined);
}
{
  const good = parsePost(JSON.stringify({ marks: [{ line: 2, card: 2, phrase: '斜边²', pen: 'marker' }, { line: 1, card: 1, phrase: '斜边', pen: 'circle' }], anchors: [{ line: 2, card: 2 }], layout: { rows: [[0], [1, 2], [3], [4]] }, look: { '1': { tint: 'sky', emoji: '📐' }, '2': { look: 'title' } } }));
  const v = validatePost(section, theme, 'tablet-landscape', good.ok ? good.out : { marks: [], anchors: [], look: {} });
  check('校验通过:模型的标注带 pen 加在老师的后面,老师的没 pen;锚点改了;行收下(for = 端);样子进卡', v.dropped.length === 0 && v.kept.marks === 2 && v.section.lines[1].marks.length === 2 && v.section.lines[1].marks[0].pen === undefined && v.section.lines[1].marks[1].pen === 'circle' && v.section.lines[2].anchor === 2 && v.kept.anchors === 0 && v.section.layout?.for === 'tablet-landscape' && v.section.layout.rows.length === 4 && v.section.cards[1].look?.tint === 'sky' && v.section.cards[1].look?.emoji === '📐' && v.section.cards[2].look?.look === 'title' && v.kept.looks === 2, JSON.stringify([v.dropped, v.kept, v.section.lines[1].marks]));
  check('老师那句原来的锚点就是 2 → 锚点没算改动;输入的 section 没被改(纯函数)', section.lines[1].marks.length === 1 && section.cards[1].look === undefined && section.layout === undefined);
  const bad = validatePost(section, theme, 'phone', {
    marks: [
      { line: 9, card: 0, phrase: '勾股定理', pen: 'marker' },
      { line: 0, card: 9, phrase: '勾股定理', pen: 'marker' },
      { line: 0, card: 3, phrase: '小结', pen: 'marker' },
      { line: 0, card: 0, phrase: '不在卡上', pen: 'marker' },
      { line: 0, card: 0, phrase: '勾股定理', pen: 'crayon' },
      { line: 1, card: 1, phrase: '直角边', pen: 'circle' },
      { line: 0, card: 0, phrase: '勾股定理', pen: 'marker' },
      { line: 0, card: 0, phrase: '三条边', pen: 'marker' },
      { line: 0, card: 0, phrase: '关系', pen: 'marker' },
      { line: 2, card: 0, phrase: '直角三角形', pen: 'marker' },
      { line: 3, card: 0, phrase: '三条边的关系', pen: 'marker' },
      { line: 3, card: 4, phrase: '5', pen: 'marker' },
    ],
    anchors: [{ line: 0, card: 3 }, { line: 7, card: 0 }],
    layout: { rows: [[0, 1, 2, 3], [4]] },
    look: { '3': { tint: 'sky' }, '1': { tint: 'nope', look: 'huge', emoji: 'abc' }, x: { tint: 'sky' } },
  });
  const why = bad.dropped.join('\n');
  check('校验丢:没这句、没这张卡、标题行、词不在卡上、不认识的笔、老师已标、一句超 2、一张卡超 3', why.includes('没有这句') && why.includes('没有这张卡') && why.includes('这个词不在卡上') && why.includes('不认识的笔 crayon') && why.includes('老师已经标过') && why.includes(`这句已有 ${MAX_MARKS_PER_LINE} 处`) && why.includes(`这张卡已有 ${MAX_MARKS_PER_CARD} 处`), why);
  check('校验丢:锚到标题行 / 没这句;一行超 3 张整个排版不要;槽名不在清单、字形不在、emoji 不像;标题行与坏卡号的样子', why.includes('锚点') && why.includes(`超过 ${MAX_CARDS_PER_ROW} 张`) && JSON.stringify(bad.section.layout?.rows) === '[[0],[1],[2],[3],[4]]' && why.includes('底色槽 nope 不在主题里') && why.includes('字形槽 huge') && why.includes('emoji 不像') && why.includes('样子 卡 3') && why.includes('样子 卡 x'), why);
  check('校验丢完剩下的照用:封面两处 + 第三句一处 + 选项 5(整词)', bad.kept.marks === 4 && bad.section.lines[3].marks.some((m) => m.phrase === '5' && m.pen === 'marker') && bad.section.lines[0].marks.length === 2, JSON.stringify(bad.kept));
  const cover = validatePost(section, theme, 'phone', { marks: [], anchors: [], layout: { rows: [[0], [2, 1], [3], [4]] }, look: {} });
  check('行的顺序变了 / 没盖住全部 → 整个不要,一行一张', JSON.stringify(cover.section.layout?.rows) === '[[0],[1],[2],[3],[4]]' && cover.dropped[0].includes('恰好盖住') && validatePost(section, theme, 'phone', { marks: [], anchors: [], layout: { rows: [[0, 1]] }, look: {} }).dropped[0].includes('恰好盖住'));
  check('回退 = 原样', fallbackPost(section) === section);
}
done();
