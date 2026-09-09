/** 课程表解析(抄 growth-apps 的回归):好表、星期/时间各种写法、错误带行号、多表、忽略无关表、孩子列可选、时段命中。 */
import { currentSlot, dayOf, parseTimetable, slotLabel, weekDate } from '../src/lib/timetable.ts';
import { check, done } from './_check.ts';

const GOOD = `---
schema: timetable
---

# 课程表

| 星期 | 时间 | 学科 | 孩子 |
| ---- | ---- | ---- | ---- |
| 一 | 19:00–19:40 | 语文 | Ray |
| 周三 | 19:00-19:40 | 数学 | Ray |
| 6 | 9:30~10:10 | 英语 | Ray |
`;
{
  const p = parseTimetable(GOOD);
  check('好表 0 错', p.errors.length === 0 && p.found, p.errors.join('\n'));
  check('三条时段', p.entries.length === 3);
  const [a, b, c] = p.entries;
  check('星期各种写法', a.day === 1 && b.day === 3 && c.day === 6);
  check('时间补零规范化', c.start === '09:30' && c.end === '10:10');
  check('按日+时间排序、孩子列进字段', a.subject === '语文' && b.subject === '数学' && c.subject === '英语' && a.kid === 'Ray');
}
{
  const p = parseTimetable(`| 星期 | 时间 | 学科 | 孩子 |\n|---|---|---|---|\n| 八 | 19:00–19:40 | 语文 | Ray |\n| 一 | 19 点 | 语文 | Ray |\n| 一 | 19:00–19:40 |  | Ray |\n| 一 | 19:00–19:40 | 语文 |  |`);
  check('三类错误各带行号,孩子空不算错', p.errors.length === 3 && p.errors.every((e) => /^第 \d+ 行/.test(e)) && p.entries.length === 1 && p.entries[0].kid === undefined, p.errors.join('\n'));
  check('错误行说明修法', p.errors[1].includes('19:00–19:40'));
}
{
  const p = parseTimetable('| 星期 | 时间 | 学科 |\n|---|---|---|\n| 二 | 16:00–17:00 | 数学 |');
  check('没有孩子列也认', p.found && p.entries.length === 1 && p.entries[0].subject === '数学', p.errors.join());
  check('无表给整体修复指南', !parseTimetable('没有表,只有一段话。').found && parseTimetable('x').errors[0].includes('星期/时间/学科'));
  const multi = parseTimetable(`| 词 | 次数 |\n|---|---|\n| ram | 3 |\n\n| 星期 | 时间 | 学科 | 孩子 |\n|---|---|---|---|\n| 一 | 19:00–19:30 | 语文 | Ray |\n\n| 星期 | 时间 | 学科 | 孩子 |\n|---|---|---|---|\n| 一 | 19:30–20:00 | 英语 | Kay |`);
  check('忽略无关表,多张课程表都收', multi.errors.length === 0 && multi.entries.length === 2);
}
{
  const entries = parseTimetable(GOOD).entries;
  const mon = new Date('2026-08-24T19:10:00');
  check('dayOf 周一=1/周日=7', dayOf(mon) === 1 && dayOf(new Date('2026-08-23T10:00:00')) === 7);
  const slot = currentSlot(entries, mon);
  check('当前时段命中', slot?.subject === '语文' && slot && slotLabel(slot) === '语文 19:00-19:40');
  check('时段外为 null', currentSlot(entries, new Date('2026-08-24T20:00:00')) === null);
  const wed = new Date(2026, 7, 26, 12, 0);
  check('weekDate', weekDate(wed, 3) === '2026-08-26' && weekDate(wed, 1) === '2026-08-24' && weekDate(new Date(2026, 8, 1, 12), 1) === '2026-08-31');
}
done();
