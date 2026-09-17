/**
 * 后期的 HTML 方言(HTML 进、补丁出):卡按 kind 渲染成孩子看到的结构、已画的标注原地、讲稿的 [词] 原地、前文按行包;
 * 补丁解析宽容(围栏 / 单引号 / 无引号 / 自闭合 / 实体)、词落在哪句靠 said 或词本身找、卡号 c1 / 1 都认;骨架按占位符定方言;
 * 解析出的提案与 JSON 方言走同一个校验器;runPost 走假 CLI 的 HTML 分支全流程(顺着起,前文带已定的样子)。
 */
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-post-html-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { parseBoard } = await import('../src/lib/board.ts');
const { beatsOf } = await import('../src/lib/kid-board.ts');
const { POST_TEMPLATE_HTML, boardHtml, cardHtml, lineHtml, markedBlock, markedText, parseBeatPatch } = await import('../src/lib/post-html.ts');
const { POST_TEMPLATE_FALLBACK, beatPrompt, missingSlots, validateBeatPost } = await import('../src/lib/postprocess.ts');
const { ThemeManifestSchema } = await import('../src/schema/index.ts');

const theme = ThemeManifestSchema.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../themes/default/theme.json', import.meta.url)), 'utf8')));
const section = parseBoard(
  '```text\n# 勾股定理\n直角三角形三条边的关系\n```\n\n先认边。\n\n```text\n# 认边\n两条短边叫直角边,最长的一条叫斜边 a < b\n```\n\n两条短边叫[直角边],最长的一条叫斜边。\n\n```text formula\n直角边² + 直角边² = 斜边²\n```\n\n记住这个公式。\n\n```text\n# 小结\n```\n\n```choice\n两条直角边是 3 和 4,斜边是多少?\n- [ ] 6\n- [x] 5\n```\n\n斜边是多少?\n\n```read\napple 苹果\nbanana 香蕉\n```\n\n跟我读 [apple]。\n',
).section;
const beats = beatsOf(section);
const beatOf = (card: number) => beats.find((b) => b.card === card)!;

{
  // 卡 → HTML
  const c0 = cardHtml(section, 0);
  check('带标题的文字卡:c-text、机械底色 sky(字形 plain 不写)、标题 h3 + 正文 p', c0 === '<div class="c c-text" id="c0" data-tint="sky"><h3>勾股定理</h3><p>直角三角形三条边的关系</p></div>', c0);
  const c1 = cardHtml(section, 1, { now: true });
  check('老师标过的词不画在卡上(在 {marked} 里);< 转义;now 进 class', c1.includes('class="c c-text now"') && c1.includes('<h3>认边</h3>') && c1.includes('两条短边叫直角边,最长的一条叫斜边 a &lt; b') && !c1.includes('<mark') && c1.includes(' data-marked="「直角边」"'), c1);
  check('标题行是 h2.heading,不是卡', cardHtml(section, 3) === '<h2 class="heading" id="c3">小结</h2>', cardHtml(section, 3));
  const c4 = cardHtml(section, 4);
  check('选择题:alone、问题 p + 选项 ul li、不带答案', c4.startsWith('<div class="c c-choice alone" id="c4" data-tint="plum">') && c4.includes('<ul><li>6</li><li>5</li></ul>') && !c4.includes('[x]'), c4);
  check('点读卡:一段一个 p', cardHtml(section, 5).includes('<p>apple 苹果</p><p>banana 香蕉</p>'), cardHtml(section, 5));
  check('前文截长:每段最多 max 字,末尾 …', cardHtml(section, 1, { max: 5 }).includes('<p>两条短边叫…</p>'), cardHtml(section, 1, { max: 5 }));
  check('markedText:同一个词只包第一次、重叠的丢、其余转义', markedText('a<b 直角边 直角边', [{ phrase: '直角边', attrs: 'data-pen="tint"' }, { phrase: '角边 直', attrs: '' }]) === 'a&lt;b <mark data-pen="tint">直角边</mark> 直角边');
  // 讲稿一句
  const l1 = lineHtml(section, 1, 0, 1);
  check('讲稿:不念括号、标注写在 data-marked 不画', l1 === '<p class="line" data-n="0" data-marked="c1「直角边」">两条短边叫直角边,最长的一条叫斜边。</p>', l1);
  check('已标过的词:按卡列,前文窗口 + now 卡 + 这拍讲稿里老师标的;没有就说没有', markedBlock(section, beatOf(1)) === '- c1:「直角边」' && markedBlock(section, beatOf(5)) === '- c1:「直角边」\n- c5:「apple」' && markedBlock(section, beatOf(0)) === '(还没有)', markedBlock(section, beatOf(1)));
  check('讲稿默认讲别的卡 → for=', lineHtml(section, 1, 0, 2).includes(' data-for="c1"'));
  // 板书段
  const b0 = boardHtml(section, beatOf(0));
  check('第一张卡:注释「前面没有」+ now 卡 + 这拍的讲稿;没有讲稿的拍写注释', b0.startsWith('<!-- 这是第一张卡,前面没有 -->\n<div class="c c-text now"') && b0.endsWith('<p class="line" data-n="0">先认边。</p>') && boardHtml(section, { card: 0, lines: [] }).endsWith('<!-- 这拍没有讲稿 -->'), b0);
  const laid = { ...section, layout: { for: 'tablet-landscape' as const, rows: [[0], [1, 2]] }, cards: section.cards.map((c, i) => (i === 1 ? { ...c, look: { tint: 'sky', emoji: '📐' } } : c)) };
  const b4 = boardHtml(laid, beatOf(4));
  check('前文按已定的行包 <div class="row">,并排的两张在一个 row 里;已定的样子进 data-tint / data-emoji;没排到行的卡不包;now 卡不包行', b4.includes('<div class="row"><div class="c c-text" id="c0"') && b4.includes('<div class="row"><div class="c c-text" id="c1" data-tint="sky" data-emoji="📐" data-marked="「直角边」"><h3>认边</h3>') && /<\/div><div class="c c-text" id="c2" data-style="formula"[^>]*><p>直角边² \+ 直角边² = 斜边²<\/p><\/div><\/div>\n<h2 class="heading" id="c3">/.test(b4) && b4.includes('\n<div class="c c-choice alone now" id="c4"'), b4);
  check('前文只带最近 5 张:更前面的写注释', boardHtml({ ...section, cards: [...section.cards, ...section.cards] }, { card: 8, lines: [] }).startsWith('<!-- 更前面还有 3 张'));
}
{
  // 补丁 → 提案
  const b = beatOf(4);
  const p1 = parseBeatPatch('```html\n<div class="c" id="c4" data-row="same" data-tint="plum" data-look=\'plain\' data-emoji=🧮>\n  <mark data-pen="box" data-said="多少">5</mark>\n  <mark data-pen="underline" data-card="c2" data-line="0">斜边²</mark>\n  <p class="line" data-n="0" data-for="c1"></p>\n</div>\n```\n好了。', section, b);
  check('补丁(div 壳,data-*):围栏 / 双引号 / 单引号 / 无引号都认;mark 的词落到 said 所在的句;card c2 → 2;line 显式给了就用;p.line data-n data-for → 锚点', p1.ok && JSON.stringify(p1.out) === JSON.stringify({ row: 'same', look: { tint: 'plum', look: 'plain', emoji: '🧮' }, marks: [{ line: 0, phrase: '5', pen: 'box', said: '多少' }, { line: 0, card: 2, phrase: '斜边²', pen: 'underline' }], anchors: [{ line: 0, card: 1 }] }), JSON.stringify(p1));
  const p2 = parseBeatPatch('<div class="c" id="c4"></div>', section, b);
  check('空壳:什么都不标,row 缺省 new', p2.ok && JSON.stringify(p2.out) === '{"row":"new","marks":[],"anchors":[]}', JSON.stringify(p2));
  const legacy = parseBeatPatch('<c row="same" tint="plum"><mark pen="box" said="多少">5</mark><line n="0" for="c1"/></c>', section, b);
  check('老写法 <c row><mark pen><line n for/> 照认', legacy.ok && JSON.stringify(legacy.out) === JSON.stringify({ row: 'same', look: { tint: 'plum' }, marks: [{ line: 0, phrase: '5', pen: 'box', said: '多少' }], anchors: [{ line: 0, card: 1 }] }), JSON.stringify(legacy));
  const echo = parseBeatPatch('<div class="row"><div class="c c-text" id="c0" data-tint="night"><h3>勾股定理</h3></div></div>\n<div class="c c-choice alone now" id="c4"><p>x</p></div>\n<div class="c" id="c4" data-row="new" data-tint="plum"><mark data-pen="box">6</mark></div>', section, b);
  check('模型把板书抄了一遍再给补丁:带 now 的输入卡不算壳,取最后那个补丁', echo.ok && echo.out.look?.tint === 'plum' && echo.out.marks.length === 1 && echo.out.marks[0].phrase === '6', JSON.stringify(echo));
  const p3 = parseBeatPatch('我觉得挺好,不用改。', section, b);
  check('没有壳 → 解析失败,原因说清', !p3.ok && p3.why.includes('壳'));
  const p4 = parseBeatPatch('<div class="c" data-row=new><mark>a &lt; b</mark><mark data-pen="tint" data-card="x">斜边</mark><mark data-pen="tint" data-done>直角边</mark><p class="line" data-n="1"></p></div>', section, beatOf(1));
  check('实体还原;pen 没写记「(没写)」让校验器丢;card 不像卡号当没写;抄回来的 done 不算;line 缺 for 跳过', p4.ok && p4.out.marks.length === 2 && p4.out.marks[0].phrase === 'a < b' && p4.out.marks[0].pen === '(没写)' && p4.out.marks[1].card === undefined && p4.out.anchors.length === 0, JSON.stringify(p4));
  // 补丁走同一个校验器
  const v = validateBeatPost(section, b, theme, 'tablet-landscape', p1.ok ? p1.out : { row: 'new', marks: [], anchors: [] });
  check('校验:5 在选项上收下(box, said 多少);斜边² 标到前面的卡 2 收下;锚点句 0 → 卡 1;same 接不上(选择题独占)→ new', v.kept.marks === 2 && v.kept.anchors === 1 && v.kept.row === 'new' && v.section.lines[b.lines[0]].marks.some((m) => m.phrase === '5' && m.pen === 'box' && m.said === '多少') && v.section.cards[4].look?.tint === 'plum', JSON.stringify([v.kept, v.dropped]));
}
{
  // 骨架
  check('出厂兜底就是 HTML 骨架', POST_TEMPLATE_FALLBACK === POST_TEMPLATE_HTML);
  check('missingSlots:要 board / rules / patch', JSON.stringify(missingSlots('{board}')) === '["rules","patch"]' && missingSlots(POST_TEMPLATE_HTML).length === 0);
  const p = beatPrompt(section, beatOf(4), 'phone', theme, POST_TEMPLATE_HTML);
  check('HTML 方言的提示词:板书段是 HTML、规则说 <c> / <mark> / <line>、输出段是补丁、只回 <c>、槽表照给', p.includes('<div class="c c-choice alone now" id="c4"') && p.includes('<p class="line" data-n="0">斜边是多少?</p>') && p.includes('data-row="same" 接在上一张卡那一行') && p.includes('<mark data-pen="…">词</mark>') && p.includes('<p class="line" data-n="1" data-for="c0"></p>') && p.includes('<div class="c" id="c4" data-row="same|new"') && p.includes('回一个补丁') && p.includes('已标过的词(老师标的或前面定的,已经画在卡上了,不要再标):\n- c1:「直角边」') && p.includes('- sky:') && p.includes('手机竖屏') && !p.includes('{board}') && !p.includes('{patch}'), p.slice(0, 300));
}
{
  // runPost 全流程:假 CLI 见「## 板书」就回补丁;顺着起,第二拍的前文带第一拍定的样子
  const { initWorkspace } = await import('../src/cli/init.ts');
  const { loadWorkspace } = await import('../src/cli/workspace.ts');
  const { runPost } = await import('../src/server/post.ts');
  const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const cfgFile = join(root, 'cotutor.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
  cfg.runtimes = { default: 'fast', fast: { run: [process.execPath, '--experimental-strip-types', '--no-warnings', FAKE, '--output-format', 'json', '--agent', '{agent}', '{prompt}'], resume: [process.execPath, FAKE, '{prompt}'] } };
  cfg.policyDefaults = { post: { runtime: 'fast', timeoutMs: 5000 } };
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  const ws = loadWorkspace(root);
  const sec = parseBoard('```text\n# 三角形\n三条边\n```\n\n先看。\n\n```text\n# 边\n三条边围起来\n```\n\n三条边。\n\n```text\n# 角\n三个角\n```\n\n三个角。\n').section;
  const r = await runPost(ws, 'math-tutor', sec, { template: POST_TEMPLATE_HTML, serial: true, env: process.env });
  const files = r.file.beats;
  check('三拍都收到;每拍的 prompt 是 HTML、raw 是补丁', r.file.ok && files.length === 3 && files.every((f) => f.ok && f.prompt.includes('```html') && f.raw.includes('data-row=')), JSON.stringify(files.map((f) => [f.ok, f.error])));
  check('卡 0 的 sky + emoji 套上;卡 1 的 nope 槽丢了;越界的卡 99 每拍都丢;第一个词的圈收下', r.section.cards[0].look?.tint === 'sky' && r.section.cards[0].look?.emoji === '📐' && r.section.cards[1].look === undefined && r.file.dropped.filter((d) => d.includes('越界')).length === 3 && r.file.kept.marks === 3 && r.section.lines.every((l) => l.marks.some((m) => m.pen === 'circle')), JSON.stringify([r.file.dropped, r.file.kept, r.section.lines.map((l) => l.marks)]));
  check('顺着起:第二拍的前文里卡 0 带第一拍定的 data-tint="sky" data-emoji;第三拍的前文两张都在 row 里', files[1].prompt.includes('id="c0" data-tint="sky" data-emoji="📐" data-marked="「三角形」"><h3>三角形</h3>') && files[2].prompt.includes('<div class="row"><div class="c c-text" id="c0"') && files[2].prompt.includes('<div class="row"><div class="c c-text" id="c1"'), files[2].prompt.split('## 板书')[1]?.slice(0, 600));
  check('卡 2 写 same 接上一行成功(两张都不独占)', JSON.stringify(r.section.layout?.rows) === '[[0],[1,2]]' && files[2].kept?.row === 'same', JSON.stringify(r.section.layout));
}
done();
