/** 例子即测试:每种卡的 card.md 里的围栏喂 parseCard,`<!-- expect {…} -->` 是期望;八个栏目齐;README 索引每种一行;css 拼得起来。 */
import { CARD_KINDS, kindsFor, parseCard, usableIn } from '../src/cards/index.ts';
import { PACKAGE_CARDS_DIR, boardSyntaxDoc, cardDocs, cardsCss, cardsIndexDoc, docExamples, readCardDoc, splitSections } from '../src/cards/docs.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const SECTIONS = ['是什么', '什么时候用 / 别用', '写法', '例子', '反例', '孩子看到什么', '你会收回什么', '状态的形状'];
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

check('板书的协议按注册表顺序,只有板书能用的', cardDocs().map((d) => d.kind).join() === kindsFor('board').map((k) => k.name).join());
check('首页的协议:首页能用的', cardDocs(PACKAGE_CARDS_DIR, 'home').map((d) => d.kind).join() === kindsFor('home').map((k) => k.name).join());
// 每种登记的卡都有 card.md;例子按它能用的地方解析(只首页的卡按 home)
const docs = CARD_KINDS.map((k) => readCardDoc(k.name));
const placeOf = (kind: string): 'board' | 'home' => (usableIn(CARD_KINDS.find((k) => k.name === kind)!, 'board') ? 'board' : 'home');
for (const d of docs) {
  check(`${d.kind}:八个栏目齐、标题行「${d.kind} — …」`, SECTIONS.every((s) => s in d.sections) && d.headline.startsWith(`${d.kind} — `), Object.keys(d.sections).join());
  check(`${d.kind}:何时用 / 别用 各至少一条`, d.sections['什么时候用 / 别用'].includes('- 用:') && d.sections['什么时候用 / 别用'].includes('- 别用:'));
  const examples = docExamples(d.sections['例子']);
  check(`${d.kind}:至少一个例子,每个都带 expect`, examples.length >= 1 && examples.every((e) => e.expect), JSON.stringify(examples.map((e) => e.tag)));
  for (const e of examples) {
    const r = parseCard(e.tag, e.body, placeOf(d.kind));
    const ex = e.expect as { kind: string; props?: Record<string, unknown>; warning?: boolean };
    const propsOk = !ex.props || Object.entries(ex.props).every(([k, v]) => eq(r.card.props[k], v));
    check(`${d.kind} 例子「${e.tag}」解析成 ${ex.kind}${ex.props ? ' 且 ' + Object.keys(ex.props).join('/') + ' 对' : ''}${ex.warning ? '(带 warning)' : '(没 warning)'}`, r.card.kind === ex.kind && propsOk && Boolean(r.warning) === Boolean(ex.warning), JSON.stringify(r));
  }
  const counter = docExamples(d.sections['反例']);
  for (const e of counter) {
    if (!e.expect) continue;
    const r = parseCard(e.tag, e.body, placeOf(d.kind));
    const ex = e.expect as { kind: string; props?: Record<string, unknown>; warning?: boolean };
    const propsOk = !ex.props || Object.entries(ex.props).every(([k, v]) => eq(r.card.props[k], v));
    check(`${d.kind} 反例「${e.tag}」→ ${ex.kind}${ex.warning ? ' + warning' : ''}`, r.card.kind === ex.kind && propsOk && Boolean(r.warning) === Boolean(ex.warning), JSON.stringify(r));
  }
  check(`${d.kind}:card.css 在`, existsSync(join(PACKAGE_CARDS_DIR, d.kind, 'card.css')));
}
{
  const idx = cardsIndexDoc();
  check('README 索引:板书的每种一行,带文件名与「是什么」', kindsFor('board').every((k) => idx.includes(`**${k.name}**(${k.name}.md)`)) && idx.includes('用在:'));
  const syn = boardSyntaxDoc();
  check('语法表从 md 拼:板书每种卡的写法与例子都在、没有 expect 注释、没有「反例」栏', kindsFor('board').every((k) => syn.includes(`### ${k.name} — `)) && syn.includes('- [x] 12 平方厘米') && !syn.includes('<!-- expect') && !syn.includes('## 反例'));
  {
    const { applyCardGuards } = await import('../src/lib/card-guards.ts');
    const { boardGuideFor, boardSkillDoc: skillDoc } = await import('../src/cards/docs.ts');
    const { boardGuideBody } = await import('../src/lib/tutor-rules.ts');
    const g = 'a\n{{有 x}}\nb\n{{有 y}}\nc\n{{/有}}\n{{/有}}\n\n\n\nd';
    check('守卫:{{有 x}} 里的行 x 在才留,能套,守卫行不留,删出来的连续空行并掉', applyCardGuards(g, ['x']) === 'a\nb\n\nd' && applyCardGuards(g, ['x', 'y']) === 'a\nb\nc\n\nd' && applyCardGuards(g, []) === 'a\n\nd' && applyCardGuards('{{有 x y}}\nq\n{{/有}}', ['x']) === '');
    let threw = 0;
    for (const bad of ['{{有 x}}\na', 'a\n{{/有}}']) { try { applyCardGuards(bad, ['x']); } catch { threw++; } }
    check('守卫不配对就抛(gen:skills 先红)', threw === 2);
    check('全部卡的递法 = 出厂 SKILL.md 去掉 frontmatter(没写 cards 的老师拿的那份)', boardGuideFor(kindsFor('board').map((k) => k.name)) === boardGuideBody(skillDoc()));
    const k = boardGuideFor(['text', 'read', 'record']);
    check('按老师裁:只有清单里的卡,没给 choice / fill 那句与作业照片,没有守卫行', k.includes('### record') && k.includes('### read') && !k.includes('### choice') && !k.includes('能选,就配一张') && !k.includes('## 作业照片') && !k.includes('{{') && k.includes('## 一节长什么样'));
    const noCanvas = boardGuideFor(['text', 'choice', 'fill', 'image']);
    check('有图片没画板:作业照片在,「用 canvas 卡」那段不在', noCanvas.includes('## 作业照片') && !noCanvas.includes('用 `canvas` 卡'));
  }
  const css = cardsCss();
  check('各卡的 css 拼成一段,每种一个标头,选项行与空都在', CARD_KINDS.every((k) => css.includes(`cards/${k.name}/card.css`)) && css.includes('.ch-o {') && css.includes('.bl {') && css.includes('.c-lecture .th') && !css.includes('c-scene'));
  const sp = splitSections('# x — y\n\n## 甲\na\n\n## 乙\nb\nc\n');
  check('splitSections:标题行与栏目', sp.headline === 'x — y' && sp.sections['甲'] === 'a' && sp.sections['乙'] === 'b\nc');
}
done();
