/** 最终文本里的「## 待裁量」「## 转交」段:剥出来、正文干净;解析不出整段留正文。 */
import { parseSections } from '../src/lib/sections.ts';
import { check, done } from './_check.ts';

const TEXT = [
  '我看了照片,是数学第 3、5 题。',
  '',
  '## 转交',
  'to: math-teacher',
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
  check('转交解析', p.handoff?.to === 'math-teacher' && p.handoff.refs.length === 2 && p.handoff.why?.includes('退位'), JSON.stringify(p.handoff));
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
  const plain = parseSections('就一句话。');
  check('没有段', plain.holdup === null && plain.handoff === null && plain.body === '就一句话。');
}
done();
