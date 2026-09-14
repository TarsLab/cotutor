/** 最终文本里的「## 待裁量」「## 转交」段:剥出来、正文干净;解析不出整段留正文。 */
import { parseSections } from '../src/lib/sections.ts';
import { check, done } from './_check.ts';

const TEXT = [
  '我看了照片,是数学第 3、5 题。',
  '',
  '## 转交',
  'to: math-tutor',
  'why: 两位数退位减法错了两道',
  'refs: [captures/2026-09-08-abcd, photos/1.jpg]',
  '',
  '## 待裁量',
  'question: 第 5 题看不清,重拍还是先讲第 3 题?',
  'options:',
  '  - label: 重拍第 5 题',
  '    recommended: true',
  '  - label: 先讲第 3 题',
  '    note: 第 5 题晚点补',
  '',
  '## 备注',
  '这段保留。',
  '',
  '两道题都是退位没借。',
].join('\n');

{
  const p = parseSections(TEXT);
  check('转交解析', p.handoff?.to === 'math-tutor' && p.handoff.refs.length === 2 && p.handoff.why?.includes('退位'), JSON.stringify(p.handoff));
  check('待裁量解析', p.holdup?.question.includes('第 5 题') && p.holdup.options.length === 2 && p.holdup.options[0].recommended === true && p.holdup.options[1].note === '第 5 题晚点补', JSON.stringify(p.holdup));
  check('正文去掉两段、保留其它段', p.body.startsWith('我看了照片') && p.body.includes('## 备注') && p.body.endsWith('两道题都是退位没借。') && !p.body.includes('to:') && !p.body.includes('question:'), p.body);
}
{
  const p = parseSections('## 转交\nto: Not Valid\n\n最后一句。');
  check('转交 to 不合法 → 整段留正文', p.handoff === null && p.body.includes('## 转交') && p.body.includes('to: Not Valid'));
  const q = parseSections('## 待裁量\noptions:\n  - 甲\n\n最后一句。');
  check('待裁量缺 question → 整段留正文', q.holdup === null && q.body.includes('## 待裁量'));
  const r = parseSections('## 转交\nto: planner\nrefs:\n  - a.md\n  - b.md\n');
  check('refs 列表写法', r.handoff?.refs.join(',') === 'a.md,b.md' && r.body === '', JSON.stringify(r));
  const fence = parseSections('```\n## 转交\nto: x\n```\n好。');
  check('代码块里的 ## 不算标题', fence.handoff === null && fence.body.includes('## 转交'));
  const bk = parseSections('记好了。\n\n## 记账\n- thread: 1620-1\n  name: 找规律填数(递减)\n  textbook: "人教数学一下#4 100以内数的认识"\n  summary: 讲了递减数列,难点在 80 减 2 过十。\n  steps: 抄数列 → 连箭头 → 一格一格减 → 倒着加回去检查\n  observations:\n    - 跨十会停一拍\n    - 两个两个倒着数能过去\n');
  check('记账段:字段与观察列表', bk.bookkeeping?.entries.length === 1 && bk.bookkeeping.entries[0].thread === '1620-1' && bk.bookkeeping.entries[0].textbook === '人教数学一下#4 100以内数的认识' && bk.bookkeeping.entries[0].steps?.startsWith('抄数列') && bk.bookkeeping.entries[0].observations.join('|') === '跨十会停一拍|两个两个倒着数能过去' && bk.body === '记好了。', JSON.stringify(bk));
  const bk2 = parseSections('## 记账\nthread: 1620-1\nname: 退位\nobservations:\n  - 借位忘了\n');
  check('记账段漏写 - thread 也认', bk2.bookkeeping?.entries[0].name === '退位' && bk2.bookkeeping.entries[0].observations.join() === '借位忘了' && bk2.body === '', JSON.stringify(bk2));
  const bk3 = parseSections('## 记账\n- thread: x\n  summary: 没有名字\n');
  check('记账段缺 name → 整段留正文', bk3.bookkeeping === null && bk3.body.includes('## 记账'));
  const plain = parseSections('就一句话。');
  check('没有段', plain.holdup === null && plain.handoff === null && plain.body === '就一句话。');
}
done();
