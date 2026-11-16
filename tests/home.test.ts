/** 首页文件的纯函数:解析、两级问题、排卡、孩子端按钮、--force 丢卡、发布 id;上下文包的 home 段;日记不记按钮字。 */
import { arrangeHome, dropFixes, homeId, homeIssues, homeTutors, kidButtons, parseHome, type HomeTutorInfo } from '../src/runtime/home/home.ts';
import { renderContextPack } from '../src/runtime/context/context-pack.ts';
import { kidQuestions } from '../src/memory/diary.ts';
import type { TutorButton } from '../src/board/cards/index.ts';
import { check, done } from './_check.ts';

const DRAFT = [
  '---',
  'for: 2026-09-18',
  'author: 妈妈',
  '---',
  '',
  '```tutor chinese-tutor',
  'activity 预习 我要预习小蝌蚪找妈妈',
  '讲法: 先读顺 1–3 段',
  '小课堂 2026-09-16-kantu 看图说话怎么说',
  '```',
  '',
  '随手写的一行',
  '',
  '```tutor math-tutor',
  'activity 复习 再练两道退位减法',
  '```',
  '',
  '```dictation',
  '春天',
  '```',
  '',
  '```choice',
  '问?',
  '- [x] a',
  '```',
  '',
  '```tutor math-tutor',
  'activity 复习',
  '```',
  '',
  '```tutor helper',
  'activity 复习',
  '```',
  '',
  '## 为什么这么排',
  '- 语文停在第 1 段',
].join('\n');

const tutors: Record<string, HomeTutorInfo> = {
  'chinese-tutor': { display: '语文老师', enabled: true, hidden: false },
  'math-tutor': { display: '数学老师', enabled: true, hidden: false },
  'english-tutor': { display: '英语老师', enabled: true, hidden: false },
  'off-tutor': { display: '关着的', enabled: false, hidden: false },
  'helper': { display: '小帮手', enabled: true, hidden: true },
};

{
  const doc = parseHome(DRAFT);
  check('frontmatter:for 认,别的键提醒(带行号)', doc.for === '2026-09-18' && doc.issues.some((i) => i.level === 'note' && i.line === 3 && i.text.includes('author')), JSON.stringify(doc.issues));
  check('卡按文件顺序、开头行号对得上原文', doc.cards.map((c) => c.kind).join() === 'tutor,tutor,dictation,text,tutor,tutor' && doc.cardLines.join() === '6,14,18,22,27,31', JSON.stringify(doc.cardLines));
  check('家长段 = 第一个 H2 起', doc.note.startsWith('## 为什么这么排') && doc.note.includes('第 1 段'));
  check('围栏外的普通行:提醒,带行号', doc.issues.some((i) => i.level === 'note' && i.line === 12 && i.text.includes('第 12 行')), JSON.stringify(doc.issues));
  check('不是老师卡、听写卡的写在首页:要改,指到那张卡', doc.issues.some((i) => i.level === 'fix' && i.card === 3 && i.line === 22 && i.text.includes('choice 卡放不了')), JSON.stringify(doc.issues));

  const issues = homeIssues(doc, { tutors, lectures: new Map(), today: '2026-09-17' });
  const fixes = issues.filter((i) => i.level === 'fix');
  check('小课堂的课包读不出来:要改,指到那个按钮', fixes.some((i) => i.card === 0 && i.button === 1 && i.text.includes('2026-09-16-kantu')), JSON.stringify(fixes));
  check('同一位老师第二张:要改,说第一张在第几行', fixes.some((i) => i.card === 4 && i.text.includes('第 14 行')), JSON.stringify(fixes));
  check('工具人的老师卡:要改', fixes.some((i) => i.card === 5 && i.text.includes('工具人')));
  check('没写卡的老师:提醒(会补一张);关着的不算缺', issues.some((i) => i.level === 'note' && i.text.startsWith('英语老师没写老师卡')) && !issues.some((i) => i.text.includes('关着的没写')));
  check('问题按行号排,没行号的在后', issues.map((i) => i.line ?? Infinity).every((l, k, a) => k === 0 || a[k - 1] <= l));
  const ok = homeIssues(doc, { tutors, lectures: new Map([['2026-09-16-kantu', '语文']]), today: '2026-09-17' });
  check('课包在:小课堂按钮不再报', !ok.some((i) => i.button !== undefined));
  const bare = homeIssues(parseHome('```tutor chinese-tutor\nactivity 预习\n```\n'), { tutors, lectures: new Map(), today: '2026-09-17' });
  check('没有家长段:提醒', bare.some((i) => i.level === 'note' && i.text.includes('没有家长段')));
  const stale = homeIssues(parseHome('---\nfor: 2026-09-01\n---\n## x\n'), { tutors, lectures: new Map(), today: '2026-09-17' });
  check('for 过去了:提醒', stale.some((i) => i.level === 'note' && i.text.includes('已经过去了')));
  const offCard = homeIssues(parseHome('```tutor off-tutor\n```\n```tutor nobody-tutor\n```\n## x'), { tutors, lectures: new Map(), today: '2026-09-17' });
  check('关着的、不在的老师:要改', offCard.filter((i) => i.level === 'fix').length === 2 && offCard.some((i) => i.text.includes('关着')) && offCard.some((i) => i.text.includes('没有这位老师')));
  const unclosed = parseHome('---\nfor: 2026-09-18\n```tutor chinese-tutor\n```\n');
  check('frontmatter 没闭合:要改', unclosed.issues.some((i) => i.level === 'fix' && i.line === 1));

  const forced = dropFixes(doc.cards, issues);
  check('--force:坏的卡丢掉,只坏了按钮的卡只丢那个按钮', forced.cards.map((c) => c.kind).join() === 'tutor,tutor,dictation' && (forced.cards[0].props.buttons as TutorButton[]).map((b) => b.label).join() === '我要预习小蝌蚪找妈妈' && forced.dropped.length === 4, JSON.stringify(forced));

  const face = homeTutors(tutors);
  check('首页的老师:有脸、开着、不藏,cotutor.json 顺序', face.join() === 'chinese-tutor,math-tutor,english-tutor');
  const arranged = arrangeHome(doc.cards, face);
  check('排法:老师卡置顶(文件顺序),重复与工具人丢掉,没写的补一张空的,其余卡照文件顺序', arranged.map((c) => (c.kind === 'tutor' ? c.props.tutor : c.kind)).join() === 'chinese-tutor,math-tutor,english-tutor,dictation,text' && JSON.stringify(arranged[2].props.buttons) === '[]');
  check('缺省首页 = 每位老师一张空卡', arrangeHome([], face).map((c) => c.props.tutor).join() === face.join());
}

{
  const buttons = [
    { kind: 'activity', label: '我要预习', activity: '预习', params: {}, brief: '先读' },
    { kind: 'lecture', label: '分一分', bundle: 'b1', brief: '念给他听' },
    // 以前发布的那份里的开场、接着按钮(2026-11-16 删了):孩子端不出
    { kind: 'start', label: '旧的开场' },
    { kind: 'continue', label: '旧的接着', date: '2026-09-16', thread: '1930-1' },
  ] as unknown as TutorButton[];
  const kb = kidButtons(buttons, {});
  check('孩子端按钮:只有文件里的 activity 与小课堂(没有新话题;以前的开场、接着不出);讲法不下发', kb.map((b) => b.id).join() === '0,1' && !JSON.stringify(kb).includes('brief') && !JSON.stringify(kb).includes('旧的'), JSON.stringify(kb));
  const pv = kidButtons(buttons, { keepBriefs: true });
  check('家长预览留讲法', pv.map((b) => b.id).join() === '0,1' && JSON.stringify(pv).includes('念给他听'));
  const acts = [{ kind: 'lecture', label: '分一分', bundle: 'b1' }, { kind: 'lecture', label: '看图', bundle: 'b1', activity: '看图说话' }, { kind: 'activity', label: '预', activity: '预习', params: {} }] as never[];
  const only = (names: string[]) => kidButtons(acts, { activity: (n) => names.includes(n) }).map((b) => b.label).join();
  check('activity 文件不在的按钮不出:小课堂看完照「小课堂」,挂了的照挂的', only(['小课堂', '看图说话', '预习']) === '分一分,看图,预' && only(['看图说话']) === '看图' && only(['小课堂']) === '分一分');
  const seen: string[] = [];
  kidButtons([{ kind: 'activity', label: '出题', activity: '预习', params: { 范围: '春风' } }, { kind: 'lecture', label: '课', bundle: 'b1' }] as never[], { activity: (n, p) => { seen.push(n + JSON.stringify(p)); return true; } });
  check('判断用不用得了时带上按钮的参数(小课堂挂的不带)', seen.join(' ') === '预习{"范围":"春风"} 小课堂{}', seen.join(' '));
  const taken = new Set(['2026-09-17-2130', '2026-09-17-2130-2']);
  check('发布 id:时分,同一分钟加序号', homeId(new Date(2026, 8, 17, 21, 30), (x) => taken.has(x)) === '2026-09-17-2130-3' && homeId(new Date(2026, 8, 17, 8, 5), () => false) === '2026-09-17-0805');
}

{
  const yaml = renderContextPack({ at: '2026-09-17T19:30', plan: [], recent: [], home: { button: '我要预习小蝌蚪找妈妈', brief: '先读顺 1–3 段:重点字' } });
  check('上下文包:home 段', yaml.includes('  home:\n    button: "我要预习小蝌蚪找妈妈"\n    brief: "先读顺 1–3 段:重点字"'), yaml);
  const bare = renderContextPack({ at: '2026-09-17T19:30', plan: [], recent: [] });
  check('没有就不写', !bare.includes('home:'));
}

{
  const msgs = [
    { job: '1900-1', thread: '1900-1', from: 'kid' as const, text: '我要预习小蝌蚪找妈妈', via: { home: '2026-09-16-2130', button: 0, label: '我要预习小蝌蚪找妈妈' } },
    { job: '1901-2', thread: '1900-1', from: 'kid' as const, text: '蝌蚪是什么' },
    { job: '1902-3', thread: '1902-3', from: 'kid' as const, text: '新话题里第一句', via: { home: null, button: 'new' as const, label: '新话题' } },
  ];
  check('日记的孩子问:按钮发的字不算,以前新话题按钮后孩子自己说的算', kidQuestions(msgs, '1900-1').join() === '蝌蚪是什么' && kidQuestions(msgs, '1902-3').join() === '新话题里第一句');
}
done();
