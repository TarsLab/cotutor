/** vault 笔记按属性定位(2026-09-17):frontmatter、学期推算、链接解析、挑档案 / 入口 / 参考。 */
import { appendMemory, applyMemoryOps, clipNote, findMemoryLine, frontmatter, memoryCount, parseMemoryOp, tidyMemoryPrompt, memoryPath, memoryTemplate, missingEntry, pickNotes, resolveLink, semesterAt, textHash, wikilinks, type VaultNote } from '../src/lib/vault-notes.ts';
import { check, done } from './_check.ts';

check('frontmatter:平铺键值,引号去掉,中文键也收', JSON.stringify(frontmatter('---\ncotutor: textbook\n原书: "[[a.pdf]]"\n单元: 8\n---\n# x\n')) === JSON.stringify({ cotutor: 'textbook', 原书: '[[a.pdf]]', 单元: '8' }));
check('frontmatter:没有 / 没闭合 → {}', Object.keys(frontmatter('# x\ncotutor: profile\n')).length === 0 && Object.keys(frontmatter('---\ncotutor: profile\n')).length === 0);
check('frontmatter:BOM 与 CRLF', frontmatter('﻿---\r\ncotutor: profile\r\n---\r\n').cotutor === 'profile');

check('学期:9–1 月上、2 月寒假、3–6 月下、7–8 月暑假', ['2026-09-17', '2027-01-20', '2027-02-10', '2027-03-01', '2027-06-30', '2027-07-15', '2027-08-31'].map((d) => semesterAt('2025-09', d)).join() === '二年级上,二年级上,二年级寒假,二年级下,二年级下,二年级暑假,二年级暑假');
check('学期:入学那年、写别的月份按所在学年、入学前与十二年级后 → null', semesterAt('2025-09', '2025-09-01') === '一年级上' && semesterAt('2026-03', '2026-09-01') === '二年级上' && semesterAt('2025-09', '2025-08-31') === null && semesterAt('2025-09', '2037-09-01') === null && semesterAt('2025', '2026-09-01') === null);

check('链接:去 #节 与 |别名,去重,嵌入也算', wikilinks('[[教材/语文#课文 7]] [[跨十|慢]] ![[图.png]] [[跨十]]').join() === '教材/语文,跨十,图.png');
const files = ['参考/跨十.md', '旧/跨十.md.bak', '深/层/跨十.md', '教材/语文.md', '图.png'];
check('解析:完整路径、省 .md、按文件名取最短、找不到 null', resolveLink('教材/语文', files) === '教材/语文.md' && resolveLink('跨十', files) === '参考/跨十.md' && resolveLink('图.png', files) === '图.png' && resolveLink('没有', files) === null && resolveLink('别处/语文', files) === null);

const note = (path: string, props: Record<string, string>, body = ''): VaultNote => ({ path, props, text: `---\n${Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body}` });
const notes = [
  note('z档案.md', { cotutor: 'profile' }),
  note('档案.md', { cotutor: 'profile', school_start: '2025-09' }, '[[参考/跨十]] [[没有这篇]]'),
  note('课程/二年级上/语文.md', { cotutor: 'subject', subject: '语文', semester: '二年级上' }, '[[跨十]] [[档案]]'),
  note('课程/一年级下/语文.md', { cotutor: 'subject', subject: '语文', semester: '一年级下' }),
  note('教材/语文二上.md', { cotutor: 'textbook', subject: '语文', semester: '二年级上' }),
  note('教材/数学二上.md', { cotutor: 'textbook', subject: '数学', semester: '二年级上' }),
];
const all = [...notes.map((n) => n.path), '参考/跨十.md'];
const zh = pickNotes(notes, all, { date: '2026-09-17', subject: '语文' });
check('挑:多篇档案先取写了学期信息的,其余报出来', zh.profile?.path === '档案.md' && zh.extraProfiles.join() === 'z档案.md');
check('挑:入口文件对上学科与学期,不沿用上学期', zh.semester === '二年级上' && zh.entry?.path === '课程/二年级上/语文.md' && !zh.extraEntries.length);
check('挑:参考 = 本科本学期教材 + 档案与入口里的链接,去重、不含它俩自己', zh.refs.join() === '教材/语文二上.md,参考/跨十.md', zh.refs.join());
const winter = pickNotes(notes, all, { date: '2027-02-01', subject: '语文' });
check('寒假没有入口文件 → null,缺的原因写清', winter.entry === null && missingEntry('语文', winter) === '缺:vault 里没有 cotutor: subject、subject: 语文、semester: 二年级寒假 的文件');
check('semester 覆盖 school_start', pickNotes([note('p.md', { cotutor: 'profile', school_start: '2025-09', semester: '二年级上' })], [], { date: '2027-05-01' }).semester === '二年级上');
check('没配 subject / 没档案 → 没有入口', pickNotes(notes, all, { date: '2026-09-17' }).entry === null && missingEntry(undefined, zh).includes('subject') && pickNotes(notes.slice(2), all, { date: '2026-09-17', subject: '语文' }).entry === null);
{
  const mem = [note('记忆/数学老师.md', { cotutor: 'memory', agent: 'math-tutor' }), note('记忆/别人.md', { cotutor: 'memory', agent: 'chinese-tutor' })];
  const p = pickNotes([...notes, ...mem], all, { date: '2026-09-17', subject: '语文', agent: 'math-tutor' });
  check('记忆:按 agent 属性挑,不进 refs', p.memory?.path === '记忆/数学老师.md' && !p.refs.includes('记忆/数学老师.md') && pickNotes(mem, [], { date: '2026-09-17' }).memory === null);
}
{
  const tpl = memoryTemplate('math-tutor', '数学老师');
  check('记忆模板:属性对、路径按显示名、斜杠换掉', frontmatter(tpl).cotutor === 'memory' && frontmatter(tpl).agent === 'math-tutor' && memoryPath('数学老师') === '记忆/数学老师.md' && memoryPath('a/b') === '记忆/a-b.md');
  const a = appendMemory(tpl, ['凑十他懂', '  凑十他懂 ', '2026-09-01 家长说周末复习'], '2026-09-17');
  check('追加:加日期、同一轮重复去掉、自带日期不再加、和说明段隔一空行', a.added.join('|') === '- 2026-09-17 凑十他懂|- 2026-09-01 家长说周末复习' && a.text.endsWith('(记账后整理一次)。\n\n- 2026-09-17 凑十他懂\n- 2026-09-01 家长说周末复习\n'), JSON.stringify(a.text));
  const b = appendMemory(`${a.text}\n## 家长整理的\n- 别用借一\n`, ['凑十他懂', '别用借一', '新的一条'], '2026-09-18');
  check('追加:文里已有(不管哪天记的、家长手写的)跳过;列表后面直接接', b.added.join() === '- 2026-09-18 新的一条' && b.text.endsWith('- 别用借一\n- 2026-09-18 新的一条\n'), JSON.stringify(b.text));
  check('一条都没加 → 原文不动', appendMemory(tpl, ['', '  '], '2026-09-17').text === tpl);
}
check('hash:稳定、8 位、内容变就变', textHash('a') === textHash('a') && /^[0-9a-f]{8}$/.test(textHash('a')) && textHash('a') !== textHash('b'));
{
  const mem = '---\ncotutor: memory\n---\n\n- 2026-09-01 旧的一条很长很长\n- 2026-09-17 最新的一条\n';
  const short = clipNote(mem, 1000, 'tail');
  check('clipNote:没超不截', !short.cut && short.text === mem);
  const tail = clipNote(mem, 30, 'tail');
  check('clipNote tail:留末尾、从整行起、注明前面截了', tail.cut && tail.text.endsWith('- 2026-09-17 最新的一条\n') && !tail.text.includes('旧的一条') && tail.text.startsWith('……(前面旧的截掉了'), tail.text);
  const exact = clipNote('aaaa\nbb\n', 3, 'tail');
  check('clipNote tail:切点正好在行首不再丢一行', exact.text.endsWith('\nbb\n'), exact.text);
  const head = clipNote(mem, 10, 'head');
  check('clipNote head:留开头(档案、入口文件)', head.cut && head.text.startsWith('---\ncotu') && head.text.endsWith('后面截掉了,要看全文自己 Read)'));
}
{
  check('parseMemoryOp:缺省新增、改(全角半角冒号、→ 与 ->)、删', JSON.stringify([parseMemoryOp('凑十他懂'), parseMemoryOp('改:还没学竖式 → 会竖式了'), parseMemoryOp('改: a b -> c'), parseMemoryOp('删:别出选择题')]) === JSON.stringify([{ op: 'add', text: '凑十他懂' }, { op: 'change', from: '还没学竖式', to: '会竖式了' }, { op: 'change', from: 'a b', to: 'c' }, { op: 'delete', from: '别出选择题' }]));
  const mem = '---\ncotutor: memory\nagent: math-tutor\n---\n\n说明段\n\n- 2026-09-10 还没学竖式\n- 2026-09-11 讲角用手指比划管用\n## 家长整理的\n别出选择题\n- 2026-09-12 凑十他懂\n';
  const lines = mem.split('\n');
  check('findMemoryLine:原话一字不差(不管日期)、唯一包含、frontmatter 里不找、太短或多处不认', findMemoryLine(lines, '还没学竖式', 4) === 7 && findMemoryLine(lines, '2026-09-10 还没学竖式', 4) === 7 && findMemoryLine(lines, '手指比划', 4) === 8 && findMemoryLine(lines, 'math-tutor', 4) === -1 && findMemoryLine(lines, '懂', 4) === -1 && findMemoryLine(lines, '2026-09', 4) === -1);
  const r = applyMemoryOps(mem, [parseMemoryOp('改:还没学竖式 → 9 月中学会了两位数竖式'), parseMemoryOp('删:别出选择题'), parseMemoryOp('删:没有这句话呀'), parseMemoryOp('新的一条'), parseMemoryOp('凑十他懂')], '2026-09-18');
  check('applyMemoryOps:改列表行换今天日期、删家长手写的行、找不到进 misses、新增追加且去重', r.text === '---\ncotutor: memory\nagent: math-tutor\n---\n\n说明段\n\n- 2026-09-18 9 月中学会了两位数竖式\n- 2026-09-11 讲角用手指比划管用\n## 家长整理的\n- 2026-09-12 凑十他懂\n- 2026-09-18 新的一条\n' && r.changes.join('|') === '改:还没学竖式 → 9 月中学会了两位数竖式|删:别出选择题|- 2026-09-18 新的一条' && r.misses.join() === '删:没有这句话呀', JSON.stringify(r));
  check('applyMemoryOps:不是列表的行整行换', applyMemoryOps('说明段\n', [parseMemoryOp('改:说明段 → 新说明')], '2026-09-18').text === '新说明\n');
  check('applyMemoryOps:同一行删两次,第二次算没找到', applyMemoryOps('- a 行一二三\n', [parseMemoryOp('删:a 行一二三'), parseMemoryOp('删:a 行一二三')], '2026-09-18').misses.length === 1);
  check('memoryCount:只数 frontmatter 之后的列表行', memoryCount(mem) === 3 && memoryCount('') === 0);
  const tp = tidyMemoryPrompt({ date: '2026-09-18', count: 3, cap: 30, diaryFile: '/v/日记/2026-09-18.md' });
  check('tidyMemoryPrompt:带条数、上限、日记路径与三种写法', tp.includes('现在 3 条') && tp.includes('不超过 30 条') && tp.includes('/v/日记/2026-09-18.md') && tp.includes('- 删:') && tp.includes('- 改:') && tp.includes('记忆不用整理'));
}
done();
