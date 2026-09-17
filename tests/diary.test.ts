/** 日记与档案的纯函数(《obsidian仓库设计.md》):记账段 → 日记一段的形状、打分门槛、观察与档案的抽取、记账提示词。 */
import { appendDiary, bookkeepingPrompt, diaryTopic, entryFor, extractObservations, kidQuestions, recentDiaryDates, renderDiaryBlock, textbookHeadings, threadBundles } from '../src/lib/diary.ts';
import { check, done } from './_check.ts';

const msgs = [
  { job: '1', thread: '1', from: 'kid' as const, text: '80 再少 2 为什么是 78?', artifacts: [] },
  { job: '2', thread: '1', from: 'kid' as const, text: '', action: 'continue' as const, artifacts: ['2026-09-05-guilv1'] },
  { job: '3', thread: '1', from: 'kid' as const, text: '继续', artifacts: [] },
  { job: '4', thread: '1', from: 'parent' as const, text: '讲慢点', artifacts: [] },
  { job: '5', thread: '1', from: 'kid' as const, text: '那 90、80、70\n也是吗?', artifacts: [] },
  { job: '6', thread: '6', from: 'kid' as const, text: '别的话题', artifacts: [] },
];
check('孩子问:只要 kid 的、非动作、非「继续」,多行并一行', kidQuestions(msgs, '1').join('|') === '80 再少 2 为什么是 78?|那 90、80、70 也是吗?');
check('话题里的课包', threadBundles(msgs, '1').join() === '2026-09-05-guilv1' && threadBundles(msgs, '6').length === 0);

const entry = { thread: '1', name: '找规律填数(递减)', textbook: '[[人教数学一下#4 100以内数的认识]]', summary: '讲了递减数列,难点在过十。', steps: '抄数列 → 连箭头 → 减着填 → 倒着加回去', observations: ['跨十会停一拍', ' 两个两个倒着数能过去 '] };
{
  const t = diaryTopic({ messages: msgs, ratings: { '1': 4 } }, entry, { subject: '数学', keepScore: 4 });
  const block = renderDiaryBlock(t)!;
  check('打分够:摘要 + 星 + 教材链接(去掉多余的方括号)+ 课包 + 骨架 + 观察', block === [
    '## 数学 · 找规律填数(递减)',
    '',
    '> [!question] 孩子问',
    '> 80 再少 2 为什么是 78?',
    '> 那 90、80、70 也是吗?',
    '',
    '讲了递减数列,难点在过十。 ★★★★ → [[人教数学一下#4 100以内数的认识]] 课包 2026-09-05-guilv1',
    '骨架:抄数列 → 连箭头 → 减着填 → 倒着加回去',
    '',
    '- 观察:跨十会停一拍',
    '- 观察:两个两个倒着数能过去',
    '',
  ].join('\n'), block);
  const low = renderDiaryBlock(diaryTopic({ messages: msgs, ratings: { '1': 2 } }, entry, { subject: '数学', keepScore: 4 }))!;
  check('打分不够:只有孩子问与观察,没有摘要 / 星 / 骨架 / 课包', low.includes('孩子问') && low.includes('- 观察:') && !low.includes('★') && !low.includes('骨架') && !low.includes('讲了') && !low.includes('课包'), low);
  const none = renderDiaryBlock(diaryTopic({ messages: msgs, ratings: {} }, entry, { subject: '数学', keepScore: 4 }))!;
  check('没打分同不够', !none.includes('★') && none.includes('> 80 再少 2'));
  check('什么都没有 → null', renderDiaryBlock(diaryTopic({ messages: msgs, ratings: {} }, { thread: '9', name: 'x', observations: [] }, { subject: '数学', keepScore: 4 })) === null);
  check('只有观察也成一段', renderDiaryBlock({ subject: '作业老师', name: '周三作业', questions: [], bundles: [], observations: ['错了两道'] }) === '## 作业老师 · 周三作业\n\n- 观察:错了两道\n');
}
check('追加:空文件就是这一段;有内容空一行接上,尾巴的空白收掉', appendDiary(null, 'A\n') === 'A\n' && appendDiary('', 'A\n') === 'A\n' && appendDiary('旧\n\n\n', 'A\n') === '旧\n\nA\n');

{
  const diaries = [
    { date: '2026-09-07', text: '- 观察:文件头的一条\n\n## 语文 · 生字\n\n- 观察:错别字\n- 家长:他自己改了\n\n## 数学 · 退位\n\n```\n- 观察:围栏里的不算\n```\n- 观察: 借位忘了\n' },
    { date: '2026-09-06', text: '## 数学 · 凑十\n- 观察:凑十会了\n' },
  ];
  const math = extractObservations(diaries, { subject: '数学', n: 10 });
  check('按学科过滤、按日期升序、文件头的总算、围栏里的不算、中英文冒号都认', math.map((o) => `${o.date} ${o.claim}`).join('|') === '2026-09-06 凑十会了|2026-09-07 文件头的一条|2026-09-07 借位忘了', JSON.stringify(math));
  check('没配学科 → 全量;n 取最后几条', extractObservations(diaries, { n: 10 }).length === 4 && extractObservations(diaries, { subject: '数学', n: 1 })[0].claim === '借位忘了');
}
check('教材目录:册#节', textbookHeadings([{ name: '人教数学一下.md', text: '# 册\n## 1 认识图形\n```\n## 围栏\n```\n## 2 退位\n' }, { name: 'opw2', text: '## Unit 2\n' }]).join('|') === '人教数学一下#1 认识图形|人教数学一下#2 退位|opw2#Unit 2');
check('最近几天(含今天,跨月)', recentDiaryDates('2026-09-02', 3).join() === '2026-09-02,2026-09-01,2026-08-31');
{
  const keep = bookkeepingPrompt({ thread: '1620-1', rating: 4, keepScore: 4, headings: ['人教数学一下#4 100以内数的认识'] });
  const low = bookkeepingPrompt({ thread: '1620-1', rating: 2, keepScore: 4, headings: [] });
  check('记账提示词:打分够要 summary / steps,教材目录列在后面', keep.includes('- thread: 1620-1') && keep.includes('summary:') && keep.includes('steps:') && keep.includes('- 人教数学一下#4 100以内数的认识') && keep.includes('家长打了 4 星'), keep);
  check('打分不够:不要 summary / steps,说明不到几星', !low.includes('summary:') && low.includes('不到 4 星') && !low.includes('教材目录'), low);
  check('没打分', bookkeepingPrompt({ thread: 'x', keepScore: 4, headings: [] }).includes('还没打分'));
  check('有照片:打分够时 summary 那行要求把册子 / 页 / 题号 / 题面写成文字、不写路径;打分不够没有 summary 也就不提', bookkeepingPrompt({ thread: 'x', rating: 5, keepScore: 4, headings: [], photos: 2 }).includes('有 2 张作业照片') && !bookkeepingPrompt({ thread: 'x', rating: 2, keepScore: 4, headings: [], photos: 2 }).includes('作业照片') && !keep.includes('作业照片'));
}
check('记账段里挑话题:对上的;只有一条且 thread 写错也认;多条都不对 → null', entryFor({ entries: [{ ...entry, thread: 'a' }, { ...entry, thread: 'b' }] }, 'b')?.thread === 'b' && entryFor({ entries: [{ ...entry, thread: 'wrong' }] }, 'b')?.thread === 'b' && entryFor({ entries: [{ ...entry, thread: 'a' }, { ...entry, thread: 'c' }] }, 'b') === null);
done();
