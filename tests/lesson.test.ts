/** 课文件(《备课设计.md》§十):排版修饰词 → layout / look;`---` 分节;frontmatter 与讲法;check 两级;后期提案回写(围栏行、[词]);手写的当已定。 */
import { parseBoard, splitMods, withMods } from '../src/lib/board.ts';
import { applyLayoutReply, applyPostToLesson, lessonIssues, modsOf, parseLesson, stripLayout } from '../src/lib/lesson.ts';
import type { BoardSection } from '../src/lib/kid-board.ts';
import { check, done } from './_check.ts';

// ---- 修饰词
{
  const r = splitMods('text formula tint=sky look=big emoji=🍕 same');
  check('splitMods:排版词摘掉,卡自己的留下', r.rest === 'text formula' && r.mods.same === true && r.mods.tint === 'sky' && r.mods.look === 'big' && r.mods.emoji === '🍕' && r.warnings.length === 0, JSON.stringify(r));
  const bad = splitMods('text emoji=abc');
  check('emoji 不像 emoji 就丢、提醒', bad.mods.emoji === undefined && bad.warnings.length === 1);
  check('withMods:换掉原有排版词、种类与卡的修饰词照旧、缩进照旧', withMods('  ```text formula tint=old', { same: true, tint: 'sky' }) === '  ```text formula same tint=sky' && withMods('```choice', {}) === '```choice');
}
{
  const md = ['开场。', '```text tint=sky', '# 甲', '一', '```', '说甲。', '```text same look=big', '# 乙', '二', '```', '说乙。', '```text same', '# 丙', '三', '```', '```choice same', '问?', '- [x] a', '- [ ] b', '```', '你选?'].join('\n');
  const r = parseBoard(md, { device: 'phone' });
  const s = r.section;
  check('same 排行:甲乙丙一行,答题卡独占(接不上有提醒);layout.for 是传进来的端', JSON.stringify(s.layout) === JSON.stringify({ for: 'phone', rows: [[0, 1, 2], [3]] }) && r.warnings.some((w) => w.text.includes('接不上')), JSON.stringify({ layout: s.layout, w: r.warnings }));
  check('tint / look 进 card.look;没写的没有 look', s.cards[0].look?.tint === 'sky' && s.cards[1].look?.look === 'big' && s.cards[2].look === undefined && s.cards[0].kind === 'text');
  const four = parseBoard(['```text', 'a', '```', '```text same', 'b', '```', '```text same', 'c', '```', '```text same', 'd', '```'].join('\n'));
  check('一行最多 3 张,第 4 张另起一行', JSON.stringify(four.section.layout?.rows) === '[[0,1,2],[3]]' && four.warnings.length === 1);
  check('没写 same 就没有 layout(一行一张是缺省)', parseBoard('```text tint=sky\na\n```\n').section.layout === undefined);
}

// ---- 课文件
const FILE = `---
tutor: math-tutor
device: tablet-landscape
for: 2026-09-28
---

我们拿两个一样的三角形拼一拼。

\`\`\`text tint=sky
# 拼
把两个一样的三角形倒过来拼在一起
\`\`\`

两个一样的三角形一拼,就是一个[平行四边形]。

\`\`\`text formula same
三角形面积 = 底 × 高 ÷ 2
\`\`\`

所以三角形的面积就是底乘高,再除以 2。

---

\`\`\`choice
底 6、高 4 的三角形,面积是多少?
- [ ] 24
- [x] 12
\`\`\`

你来算算,面积是多少?

## 讲法

他上周把「底」认成斜边,第一张卡多指两遍。
`;
{
  const doc = parseLesson(FILE);
  check('frontmatter:tutor / device / for', doc.tutor === 'math-tutor' && doc.device === 'tablet-landscape' && doc.for === '2026-09-28');
  check('--- 分两节;第一节两张卡一行、三句;第二节答题卡加末句问句(不补提问卡:choice 能答)', doc.sections.length === 2 && JSON.stringify(doc.sections[0].section.layout?.rows) === '[[0,1]]' && doc.sections[0].section.lines.length === 3 && doc.sections[1].section.cards.length === 1 && doc.sections[1].section.lines[0].ask, JSON.stringify(doc.sections.map((s) => [s.section.cards.length, s.section.lines.length, s.section.layout])));
  check('行号:第一张卡在第 9 行、第二节的卡在第 24 行;讲稿行号', doc.sections[0].cardLines[0] === 9 && doc.sections[0].cardLines[1] === 16 && doc.sections[1].cardLines[0] === 24 && doc.sections[0].lineLines[0] === 7, JSON.stringify([doc.sections.map((s) => s.cardLines), doc.sections.map((s) => s.lineLines)]));
  check('讲法 = 第一个 H2 起', doc.brief.startsWith('## 讲法') && doc.brief.includes('斜边'));
  check('第一节末句不是问句:提醒', doc.issues.some((i) => i.level === 'note' && i.text.includes('末句不是问句') && i.line === 20), JSON.stringify(doc.issues));
  const ctx = { tutors: { 'math-tutor': { display: '数学老师', enabled: true, hidden: false }, 'scene-maker': { display: '画图', enabled: true, hidden: true } }, tints: ['paper', 'sky'], looks: ['big'], today: '2026-09-27' };
  check('check:老师在、槽名对 → 没有要改', lessonIssues(doc, ctx).filter((i) => i.level === 'fix').length === 0, JSON.stringify(lessonIssues(doc, ctx)));
  const bad = parseLesson(FILE.replace('tutor: math-tutor', 'tutor: scene-maker').replace('tint=sky', 'tint=mud'));
  const bi = lessonIssues(bad, ctx);
  check('check:工具人、槽名不在主题 → 要改(带行号)', bi.some((i) => i.level === 'fix' && i.text.includes('工具人')) && bi.some((i) => i.level === 'fix' && i.line === 9 && i.text.includes('tint=mud')), JSON.stringify(bi));
  const none = parseLesson('---\nfor: x\n---\n');
  check('没 tutor、正文空、for 坏:要改两条、提醒一条', none.issues.filter((i) => i.level === 'fix').length === 2 && none.issues.some((i) => i.level === 'note'), JSON.stringify(none.issues));
  const inFence = parseLesson('---\ntutor: a-tutor\n---\n```text\n---\n不是分节\n```\n说。\n');
  check('围栏里的 --- 不分节;讲法没有', inFence.sections.length === 1 && inFence.sections[0].section.cards.length === 1 && inFence.brief === '');
}

// ---- 备课话题导出时把后期的决定写进文件(applyPostToLesson)
{
  const doc = parseLesson(FILE);
  const s0 = doc.sections[0].section;
  const posted: BoardSection = { ...s0, layout: { for: 'tablet-landscape', rows: [[0, 1]] }, cards: s0.cards.map((c, n) => (n === 1 ? { ...c, look: { tint: 'mint', emoji: '📐' } } : { ...c, look: { ...(c.look ?? {}), look: 'big' } })), lines: s0.lines.map((l, i) => (i === 2 ? { ...l, marks: [...l.marks, { card: 1, phrase: '底', pen: 'marker' as const, said: '底' }, { card: 1, phrase: '不在这句', pen: 'marker' as const }] } : l)) };
  check('modsOf:第二张 same、样子齐', JSON.stringify(modsOf(posted, 1)) === JSON.stringify({ same: true, tint: 'mint', emoji: '📐' }));
  const r = applyPostToLesson(FILE, doc, [posted, doc.sections[1].section]);
  const lines = r.md.split('\n');
  check('回写围栏行:两处;讲稿里多了 [底],已标的、不在这句的不写', r.fences === 2 && lines[8] === '```text tint=sky look=big' && lines[15] === '```text formula same tint=mint emoji=📐' && r.marks === 1 && lines[19] === '所以三角形的面积就是[底]乘高,再除以 2。', JSON.stringify({ r: [r.fences, r.marks], l8: lines[8], l15: lines[15], l19: lines[19] }));
  const again = parseLesson(r.md);
  check('回写后的文件再解析:行与样子都在', JSON.stringify(again.sections[0].section.layout?.rows) === '[[0,1]]' && again.sections[0].section.cards[1].look?.emoji === '📐' && again.sections[0].section.lines[2].marks.some((m) => m.phrase === '底'));
}

// ---- 整份排版的回复套回原文(applyLayoutReply;cotutor lesson post 用)
{
  check('stripLayout:围栏行去排版词、讲稿去方括号、围栏里不动', stripLayout('```text same tint=sky\n# 甲\n[一]\n```\n说[甲]。') === '```text\n# 甲\n[一]\n```\n说甲。');
  // 模型回的:第一张改了底色(手写的 sky 要赢)、第二张去掉 same 加 look(same 手写的要赢、look 收下)、讲稿多标一个词
  const reply = FILE.replace('```text tint=sky', '```text tint=mint emoji=📐').replace('```text formula same', '```text formula look=formula').replace('所以三角形的面积就是底乘高', '所以三角形的面积就是[底]乘高');
  const r = applyLayoutReply(FILE, reply);
  const lines = r.ok ? r.md.split('\n') : [];
  check('正文没动就收:手写的 tint=sky 与 same 盖回去,模型给的 emoji / look 收下,方括号收下', r.ok && lines[8] === '```text tint=sky emoji=📐' && lines[15] === '```text formula same look=formula' && lines[19] === '所以三角形的面积就是[底]乘高,再除以 2。' && r.fences === 2 && r.marks === 1, JSON.stringify(r.ok ? { l8: lines[8], l15: lines[15], l19: lines[19], f: r.fences, m: r.marks } : r));
  const wrapped = applyLayoutReply(FILE, '```markdown\n' + reply + '\n```');
  check('用围栏包起来的回复也认', wrapped.ok);
  const bad = applyLayoutReply(FILE, reply.replace('把两个一样的三角形倒过来拼在一起', '把两个三角形拼起来'));
  check('改了正文的整份不要', !bad.ok && !('md' in bad));
  const same = applyLayoutReply(FILE, FILE);
  check('原样回来:零改动', same.ok && same.fences === 0 && same.marks === 0);
}

// ---- 尾巴「## 素材」(《备课设计.md》§11.4):摘出来不进讲法,id 带行号;查在不在、是不是这位老师的、有没有要改的;超过两节提醒
{
  const md = '---\ntutor: math-tutor\n---\n\n```choice\n18 个分给 3 人?\n- [x] 6\n- [ ] 9\n```\n\n每人几个?\n\n## 素材\n\n- pingjunfen · 平均分\n- xiangyu\n这行不是\n\n## 讲法\n\n先让他说。\n';
  const d = parseLesson(md);
  check('「## 素材」:两份 id 带行号;不认的行提醒;讲法里没有素材那段', JSON.stringify(d.materials) === JSON.stringify([{ id: 'pingjunfen', line: 15 }, { id: 'xiangyu', line: 16 }]) && d.issues.some((i) => i.level === 'note' && i.line === 17) && d.brief.startsWith('## 讲法') && !d.brief.includes('pingjunfen'), JSON.stringify({ m: d.materials, brief: d.brief, issues: d.issues }));
  const tutors = { 'math-tutor': { display: '数学老师', enabled: true, hidden: false } };
  const base = { tutors, tints: ['paper', 'sky', 'sand', 'plum'], looks: [], today: '2026-10-02' };
  const ok = lessonIssues(d, { ...base, materials: { pingjunfen: { tutor: 'math-tutor', fixes: 0 }, xiangyu: { tutor: 'math-tutor', fixes: 0 } } });
  check('素材都在、都是这位老师的、没要改的:不报要改', !ok.some((i) => i.level === 'fix'), JSON.stringify(ok));
  const bad = lessonIssues(d, { ...base, materials: { pingjunfen: { tutor: 'english-tutor', fixes: 0 } } }).filter((i) => i.level === 'fix');
  check('不在、别的老师的:各一条要改,带行号', bad.length === 2 && bad.some((i) => i.line === 15 && i.text.includes('english-tutor')) && bad.some((i) => i.line === 16 && i.text.includes('不在')), JSON.stringify(bad));
  check('有要改的素材:要改;不给 materials 就不查', lessonIssues(d, { ...base, materials: { pingjunfen: { tutor: 'math-tutor', fixes: 2 }, xiangyu: { tutor: 'math-tutor', fixes: 0 } } }).some((i) => i.level === 'fix' && i.text.includes('2 条要改')) && !lessonIssues(d, base).some((i) => i.level === 'fix'));
  const three = parseLesson('---\ntutor: math-tutor\n---\n说一。\n\n---\n\n说二。\n\n---\n\n说三。\n');
  check('超过两节提醒(孩子要听完才能打断);两节不提醒', three.issues.some((i) => i.level === 'note' && i.text.includes('3 节')) && !parseLesson('---\ntutor: math-tutor\n---\n说一。\n\n---\n\n说二。\n').issues.some((i) => i.text.includes('节:孩子要听完')));
  check('没有「## 素材」:materials 空', parseLesson(md.replace(/## 素材[\s\S]*?## 讲法/, '## 讲法')).materials.length === 0);
}

done();
