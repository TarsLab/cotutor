/**
 * 例子即测试:首页两种牌的 card.md 里的围栏喂 parseCard,`<!-- expect {…} -->` 是期望;八个栏目齐;css 拼得起来。
 * 还有给老师的那篇 cards/动作怎么写.md:注释剥掉才进系统提示(actsGuide)。
 */
import { CARD_KINDS, parseCard } from '../src/board/cards/index.ts';
import { PACKAGE_CARDS_DIR, actsGuide, cardsCss, docExamples, readCardDoc, splitSections } from '../src/board/cards/docs.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const SECTIONS = ['是什么', '什么时候用 / 别用', '写法', '例子', '反例', '孩子看到什么', '你会收回什么', '状态的形状'];
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

for (const d of CARD_KINDS.map((k) => readCardDoc(k.name))) {
  check(`${d.kind}:八个栏目齐、标题行「${d.kind} — …」`, SECTIONS.every((s) => s in d.sections) && d.headline.startsWith(`${d.kind} — `), Object.keys(d.sections).join());
  check(`${d.kind}:何时用 / 别用 各至少一条`, d.sections['什么时候用 / 别用'].includes('- 用:') && d.sections['什么时候用 / 别用'].includes('- 别用:'));
  const examples = docExamples(d.sections['例子']);
  check(`${d.kind}:至少一个例子,每个都带 expect`, examples.length >= 1 && examples.every((e) => e.expect), JSON.stringify(examples.map((e) => e.tag)));
  for (const e of [...examples, ...docExamples(d.sections['反例']).filter((x) => x.expect)]) {
    const r = parseCard(e.tag, e.body);
    const ex = e.expect as { kind: string; props?: Record<string, unknown>; warning?: boolean };
    const propsOk = !ex.props || Object.entries(ex.props).every(([k, v]) => eq(r.card.props[k], v));
    check(`${d.kind}「${e.tag}」解析成 ${ex.kind}${ex.props ? ' 且 ' + Object.keys(ex.props).join('/') + ' 对' : ''}${ex.warning ? '(带 warning)' : '(没 warning)'}`, r.card.kind === ex.kind && propsOk && Boolean(r.warning) === Boolean(ex.warning), JSON.stringify(r));
  }
  check(`${d.kind}:card.css 在`, existsSync(join(PACKAGE_CARDS_DIR, d.kind, 'card.css')));
}
{
  const css = cardsCss();
  check('两种牌的 css 拼成一段,每种一个标头;课里的卡的样式不在', CARD_KINDS.every((k) => css.includes(`cards/${k.name}/card.css`)) && !css.includes('.ch-o {') && !css.includes('c-tianzige'));
  const sp = splitSections('# x — y\n\n## 甲\na\n\n## 乙\nb\nc\n');
  check('splitSections:标题行与栏目', sp.headline === 'x — y' && sp.sections['甲'] === 'a' && sp.sections['乙'] === 'b\nc');
  const raw = readFileSync(join(PACKAGE_CARDS_DIR, '动作怎么写.md'), 'utf8');
  const guide = actsGuide();
  check('给老师的讲稿与动作写法:注释剥掉;讲稿、动作、作业照片都在;不讲卡', raw.includes('<!--') && !guide.includes('<!--') && guide.startsWith('# 讲稿与动作怎么写') && guide.includes('## 讲稿') && guide.includes('## 动作') && guide.includes('## 作业照片') && !/```(text|choice|read)/.test(guide), guide.slice(0, 120));
  check('板书怎么写.md 不在了(并进了动作怎么写.md)', !existsSync(join(PACKAGE_CARDS_DIR, '板书怎么写.md')));
}
done();
