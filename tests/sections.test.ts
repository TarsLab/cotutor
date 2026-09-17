/** 最终文本里的「## 记账」段:剥出来、正文干净;解析不出整段留正文;「## 转交」「## 待裁量」已不是固定段。 */
import { parseSections } from '../src/lib/sections.ts';
import { check, done } from './_check.ts';

const TEXT = [
  '我看了照片,是数学第 3、5 题。',
  '',
  '## 记账',
  '- thread: 1620-1',
  '  name: 退位减法',
  '  observations:',
  '    - 第 5 题看不清',
  '',
  '## 备注',
  '这段保留。',
  '',
  '两道题都是退位没借。',
].join('\n');

{
  const p = parseSections(TEXT);
  check('记账段剥出来', p.bookkeeping?.entries[0].name === '退位减法', JSON.stringify(p.bookkeeping));
  check('正文去掉记账段、保留其它段;固定段后的空行接回正文', p.body.startsWith('我看了照片') && p.body.includes('## 备注') && p.body.endsWith('两道题都是退位没借。') && !p.body.includes('thread:') && !p.body.includes('看不清'), p.body);
}
{
  const p = parseSections('## 转交\nto: scene-maker\nwhy: 画图');
  check('「## 转交」是普通段 → 整段留正文', p.body === '## 转交\nto: scene-maker\nwhy: 画图' && !('handoff' in p), JSON.stringify(p));
  const q = parseSections('## 待裁量\nquestion: 要不要重讲?');
  check('「## 待裁量」是普通段 → 整段留正文', q.body === '## 待裁量\nquestion: 要不要重讲?' && !('holdup' in q), JSON.stringify(q));
  const fence = parseSections('```\n## 记账\nthread: x\nname: y\n```\n好。');
  check('代码块里的 ## 不算标题', fence.bookkeeping === null && fence.body.includes('## 记账'));
  const bk = parseSections('记好了。\n\n## 记账\n- thread: 1620-1\n  name: 找规律填数(递减)\n  textbook: "人教数学一下#4 100以内数的认识"\n  summary: 讲了递减数列,难点在 80 减 2 过十。\n  steps: 抄数列 → 连箭头 → 一格一格减 → 倒着加回去检查\n  observations:\n    - 跨十会停一拍\n    - 两个两个倒着数能过去\n');
  check('记账段:字段与观察列表', bk.bookkeeping?.entries.length === 1 && bk.bookkeeping.entries[0].thread === '1620-1' && bk.bookkeeping.entries[0].textbook === '人教数学一下#4 100以内数的认识' && bk.bookkeeping.entries[0].steps?.startsWith('抄数列') && bk.bookkeeping.entries[0].observations.join('|') === '跨十会停一拍|两个两个倒着数能过去' && bk.body === '记好了。', JSON.stringify(bk));
  const bk2 = parseSections('## 记账\nthread: 1620-1\nname: 退位\nobservations:\n  - 借位忘了\n');
  check('记账段漏写 - thread 也认', bk2.bookkeeping?.entries[0].name === '退位' && bk2.bookkeeping.entries[0].observations.join() === '借位忘了' && bk2.body === '', JSON.stringify(bk2));
  const bk3 = parseSections('## 记账\n- thread: x\n  summary: 没有名字\n');
  check('记账段缺 name → 整段留正文', bk3.bookkeeping === null && bk3.body.includes('## 记账'));
  const plain = parseSections('就一句话。');
  check('没有段', plain.bookkeeping === null && plain.body === '就一句话。');
}
{
  const p = parseSections('三角形有几个角?\n\n## 记忆\n- 讲角用手指比划他马上懂\n* 家长说别出选择题\n\n## 家长\n他会了。');
  check('「## 记忆」段:列表行剥出来,正文与别的段不动', p.memory.join('|') === '讲角用手指比划他马上懂|家长说别出选择题' && p.body === '三角形有几个角?\n\n## 家长\n他会了。', JSON.stringify(p));
  const q = parseSections('好。\n\n## 记忆\n没有列表点的一句话');
  check('记忆段没有列表行 → 整段留正文,memory 空', q.memory.length === 0 && q.body.includes('## 记忆\n没有列表点的一句话'), JSON.stringify(q));
  const r = parseSections('## 记忆\n- 一条\n\n后面给孩子的话。');
  check('记忆段后空行接非列表行 → 回到正文', r.memory.join() === '一条' && r.body === '后面给孩子的话。', JSON.stringify(r));
  check('没有记忆段 → []', parseSections('好。').memory.length === 0);
}
done();
