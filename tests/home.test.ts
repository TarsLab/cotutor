/** 首页文件的纯函数(《首页设计.md》):解析、两级问题、排卡、孩子端按钮、--force 丢卡、发布 id;上下文包的 home / continue 两段;日记不记按钮字。 */
import { arrangeHome, dropFixes, homeId, homeIssues, homeRefs, homeTutors, kidButtons, parseHome, threadKey, type HomeTutorInfo } from '../src/lib/home.ts';
import { renderContextPack } from '../src/lib/context-pack.ts';
import { kidQuestions } from '../src/lib/diary.ts';
import type { TutorButton } from '../src/cards/index.ts';
import { check, done } from './_check.ts';

const DRAFT = [
  '---',
  'for: 2026-09-18',
  'author: 妈妈',
  '---',
  '',
  '```tutor chinese-tutor',
  '我要预习小蝌蚪找妈妈',
  '讲法: 先读顺 1–3 段',
  '接着 2026-09-16 1930-1 接着写看图写话',
  '```',
  '',
  '随手写的一行',
  '',
  '```tutor math-tutor',
  '再练两道退位减法',
  '```',
  '',
  '```tianzige',
  '塘脑袋',
  '```',
  '',
  '```choice',
  '问?',
  '- [x] a',
  '```',
  '',
  '```tutor math-tutor',
  '又一张',
  '```',
  '',
  '```tutor scene-maker',
  '画一画',
  '```',
  '',
  '## 为什么这么排',
  '- 语文停在第 1 段',
].join('\n');

const tutors: Record<string, HomeTutorInfo> = {
  'chinese-tutor': { display: '语文老师', enabled: true, hidden: false },
  'math-tutor': { display: '数学老师', enabled: true, hidden: false },
  'reading-tutor': { display: '朗读老师', enabled: true, hidden: false },
  'off-tutor': { display: '关着的', enabled: false, hidden: false },
  'scene-maker': { display: '画图老师', enabled: true, hidden: true },
};

{
  const doc = parseHome(DRAFT);
  check('frontmatter:for 认,别的键提醒(带行号)', doc.for === '2026-09-18' && doc.issues.some((i) => i.level === 'note' && i.line === 3 && i.text.includes('author')), JSON.stringify(doc.issues));
  check('卡按文件顺序、开头行号对得上原文', doc.cards.map((c) => c.kind).join() === 'tutor,tutor,tianzige,text,tutor,tutor' && doc.cardLines.join() === '6,14,18,22,27,31', JSON.stringify(doc.cardLines));
  check('家长段 = 第一个 H2 起', doc.note.startsWith('## 为什么这么排') && doc.note.includes('第 1 段'));
  check('围栏外的普通行:提醒,带行号', doc.issues.some((i) => i.level === 'note' && i.line === 12 && i.text.includes('第 12 行')), JSON.stringify(doc.issues));
  check('只板书的卡写在首页:要改,指到那张卡', doc.issues.some((i) => i.level === 'fix' && i.card === 3 && i.line === 22 && i.text.includes('首页放不了 choice')), JSON.stringify(doc.issues));
  check('引用:接着按钮指的话题', JSON.stringify(homeRefs(doc)) === '[{"tutor":"chinese-tutor","date":"2026-09-16","thread":"1930-1"}]');

  const issues = homeIssues(doc, { tutors, threads: new Set(), today: '2026-09-17' });
  const fixes = issues.filter((i) => i.level === 'fix');
  check('接着的话题找不到:要改,指到那个按钮', fixes.some((i) => i.card === 0 && i.button === 1 && i.text.includes('2026-09-16 没有话题 1930-1')), JSON.stringify(fixes));
  check('同一位老师第二张:要改,说第一张在第几行', fixes.some((i) => i.card === 4 && i.text.includes('第 14 行')), JSON.stringify(fixes));
  check('工具人的老师卡:要改', fixes.some((i) => i.card === 5 && i.text.includes('工具人')));
  check('没写卡的老师:提醒(会补新话题);关着的不算缺', issues.some((i) => i.level === 'note' && i.text.startsWith('朗读老师没写老师卡')) && !issues.some((i) => i.text.includes('关着的没写')));
  check('问题按行号排,没行号的在后', issues.map((i) => i.line ?? Infinity).every((l, k, a) => k === 0 || a[k - 1] <= l));
  const ok = homeIssues(doc, { tutors, threads: new Set([threadKey('chinese-tutor', '2026-09-16', '1930-1')]), today: '2026-09-17' });
  check('话题在:接着按钮不再报', !ok.some((i) => i.button !== undefined));
  const late = homeIssues(parseHome('```tutor chinese-tutor\n接着 2026-09-20 1930-1 以后的\n```\n'), { tutors, threads: new Set(), today: '2026-09-17' });
  check('接着的日期还没到:要改;没有家长段:提醒', late.some((i) => i.level === 'fix' && i.text.includes('还没到')) && late.some((i) => i.level === 'note' && i.text.includes('没有家长段')));
  const stale = homeIssues(parseHome('---\nfor: 2026-09-01\n---\n## x\n'), { tutors, threads: new Set(), today: '2026-09-17' });
  check('for 过去了:提醒', stale.some((i) => i.level === 'note' && i.text.includes('已经过去了')));
  const offCard = homeIssues(parseHome('```tutor off-tutor\n```\n```tutor nobody-tutor\n```\n## x'), { tutors, threads: new Set(), today: '2026-09-17' });
  check('关着的、不在的老师:要改', offCard.filter((i) => i.level === 'fix').length === 2 && offCard.some((i) => i.text.includes('关着')) && offCard.some((i) => i.text.includes('没有这位老师')));
  const unclosed = parseHome('---\nfor: 2026-09-18\n```tutor chinese-tutor\n```\n');
  check('frontmatter 没闭合:要改', unclosed.issues.some((i) => i.level === 'fix' && i.line === 1));

  const forced = dropFixes(doc.cards, issues);
  check('--force:坏的卡丢掉,只坏了按钮的卡只丢那个按钮', forced.cards.map((c) => c.kind).join() === 'tutor,tutor,tianzige' && (forced.cards[0].props.buttons as TutorButton[]).map((b) => b.label).join() === '我要预习小蝌蚪找妈妈' && forced.dropped.length === 4, JSON.stringify(forced));

  const face = homeTutors(tutors);
  check('首页的老师:有脸、开着、不藏,cotutor.json 顺序', face.join() === 'chinese-tutor,math-tutor,reading-tutor');
  const arranged = arrangeHome(doc.cards, face);
  check('排法:老师卡置顶(文件顺序),重复与工具人丢掉,没写的补一张空的,其余卡照文件顺序', arranged.map((c) => (c.kind === 'tutor' ? c.props.tutor : c.kind)).join() === 'chinese-tutor,math-tutor,reading-tutor,tianzige,text' && JSON.stringify(arranged[2].props.buttons) === '[]');
  check('缺省首页 = 每位老师一张空卡', arrangeHome([], face).map((c) => c.props.tutor).join() === face.join());
}

{
  const buttons: TutorButton[] = [
    { kind: 'start', label: '我要预习', brief: '先读' },
    { kind: 'continue', label: '接着写', date: '2026-09-16', thread: '1930-1', brief: '念给他听' },
    { kind: 'continue', label: '找不到的', date: '2026-09-15', thread: '0900-1' },
  ];
  const alive = (date: string, thread: string): boolean => date === '2026-09-16' && thread === '1930-1';
  const kb = kidButtons(buttons, { recent: { date: '2026-09-17', thread: '1900-2', title: '画蛇添足是什么意思呢老师' }, alive });
  check('孩子端按钮:新话题、接着刚才的(标题截 10 字)、文件里的;找不到的接着不出现;讲法不下发', kb.map((b) => b.id).join() === 'new,recent,0,1' && kb[1].label === '接着刚才的:画蛇添足是什么意思呢…' && !JSON.stringify(kb).includes('brief'), JSON.stringify(kb));
  const pv = kidButtons(buttons, { recent: null, alive, keepBriefs: true });
  check('家长预览留讲法;今天没聊过就没有接着刚才的', pv.map((b) => b.id).join() === 'new,0,1' && JSON.stringify(pv).includes('念给他听'));
  const dup = kidButtons(buttons, { recent: { date: '2026-09-16', thread: '1930-1', title: '上次' }, alive });
  check('文件里已经有接着今天那个话题的按钮:不再加「接着刚才的」', dup.map((b) => b.id).join() === 'new,0,1');
  const taken = new Set(['2026-09-17-2130', '2026-09-17-2130-2']);
  check('发布 id:时分,同一分钟加序号', homeId(new Date(2026, 8, 17, 21, 30), (x) => taken.has(x)) === '2026-09-17-2130-3' && homeId(new Date(2026, 8, 17, 8, 5), () => false) === '2026-09-17-0805');
}

{
  const yaml = renderContextPack({ from: 'kid', at: '2026-09-17T19:30', plan: [], recent: [], home: { button: '我要预习小蝌蚪找妈妈', brief: '先读顺 1–3 段:重点字' }, continue: { from: '2026-09-16 1930-1', title: '看图写话', said: ['我们写到第二句了。'], cards: ['1930-2/0 canvas「画一画」 画了 3 笔'], index: '/w/conversations/chinese-tutor/2026-09-16.json' } });
  check('上下文包:home 与 continue 两段', yaml.includes('  home:\n    button: "我要预习小蝌蚪找妈妈"\n    brief: "先读顺 1–3 段:重点字"') && yaml.includes('  continue:\n    from: "2026-09-16 1930-1"\n    title: "看图写话"\n    said:\n      - "我们写到第二句了。"\n    cards:\n      - "1930-2/0 canvas「画一画」 画了 3 笔"\n    index: "/w/conversations/chinese-tutor/2026-09-16.json"'), yaml);
  const bare = renderContextPack({ from: 'kid', at: '2026-09-17T19:30', plan: [], recent: [] });
  check('没有就不写', !bare.includes('home:') && !bare.includes('continue:'));
}

{
  const msgs = [
    { job: '1900-1', thread: '1900-1', from: 'kid' as const, text: '我要预习小蝌蚪找妈妈', via: { home: '2026-09-16-2130', button: 0, label: '我要预习小蝌蚪找妈妈' } },
    { job: '1901-2', thread: '1900-1', from: 'kid' as const, text: '蝌蚪是什么' },
    { job: '1902-3', thread: '1902-3', from: 'kid' as const, text: '新话题里第一句', via: { home: null, button: 'new' as const, label: '新话题' } },
  ];
  check('日记的孩子问:开场按钮发的字不算,新话题按钮后孩子自己说的算', kidQuestions(msgs, '1900-1').join() === '蝌蚪是什么' && kidQuestions(msgs, '1902-3').join() === '新话题里第一句');
}
done();
