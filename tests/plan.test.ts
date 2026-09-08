/** 计划文件:frontmatter 必需、H2 按显示名分段、行号错误、抽本老师的行。 */
import { parsePlan, planLinesFor } from '../src/lib/plan.ts';
import { check, done } from './_check.ts';

const GOOD = ['---', 'week: 2026-W37', 'status: draft', 'author: planner', '---', '# 下周', '## 数学老师', '- 周三前把两位数退位讲一遍', '- 周五出两道类似题', '', '## 朗读老师', '1. 继续 U3', '', '## 家长', '- 周六一起复述'].join('\n');
{
  const p = parsePlan(GOOD);
  check('解析成功', p.errors.length === 0 && p.plan?.week === '2026-W37' && p.plan.status === 'draft' && p.plan.author === 'planner', JSON.stringify(p));
  check('三段', p.plan?.sections.map((s) => s.title).join(',') === '数学老师,朗读老师,家长');
  check('列表符号去掉', p.plan?.sections[1].lines[0] === '继续 U3');
  check('抽本老师的行并限行数', p.plan && planLinesFor(p.plan, '数学老师', 1).join() === '周三前把两位数退位讲一遍');
  check('对不上的老师是空', p.plan && planLinesFor(p.plan, '语文老师', 5).length === 0);
}
{
  check('没 frontmatter → 第 1 行指南', parsePlan('## 数学老师\n- x').errors[0].startsWith('第 1 行'));
  check('没闭合', parsePlan('---\nweek: 2026-W37\n').errors[0].includes('闭合'));
  const bad = parsePlan('---\nweek: 37\nstatus: maybe\n---\n散行\n## 数学老师\n- ok');
  check('week 格式、status 枚举、无主行都点名', bad.plan === null && bad.errors.some((e) => e.includes('week')) && bad.errors.some((e) => e.includes('draft 或 confirmed')) && bad.errors.some((e) => e.startsWith('第 5 行')), bad.errors.join(' | '));
}
done();
