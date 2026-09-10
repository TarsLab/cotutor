/** 模拟接口:不经真实服务把孩子端喂起来——首页、板书节、发消息 → 想 → 追加一节、继续、脚本用完、上限、离线、页面。 */
import { createMock } from '../src/server/mock.ts';
import type { BoardSection } from '../src/lib/kid-board.ts';
import { check, done } from './_check.ts';

interface Msg { job: string; question: string | null; reply: string | null; pending: boolean; section: BoardSection | null }
interface Day { messages: Msg[]; remaining: number; pending: string | null }

{
  const m = createMock({ delayMs: 0, now: () => new Date('2026-09-10T16:30:00') });
  const get = (p: string) => m.route('GET', p);
  const home = (await get('/api/kid/home')).json as { title: string; day: number; tutors: { name: string; available: boolean; motto: string }[]; suggestions: { tutor: string; text: string }[] };
  check('首页:三位老师、口号、今天可以问', home.title === '小明的老师们' && home.day === 4 && home.tutors.length === 3 && home.tutors.every((t) => t.available) && home.tutors[0].motto === '故事里都有道理' && home.suggestions.length === 3, JSON.stringify(home.tutors));
  const d0 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('语文老师已讲过一节:卡 + 讲稿 + 标注 + 末句问句', d0.messages.length === 1 && d0.messages[0].section !== null && d0.messages[0].section.cards.length === 9 && d0.messages[0].section.lines.length === 7 && d0.messages[0].section.lines[1].marks[0]?.card === 1 && d0.messages[0].section.lines[6].ask === true, JSON.stringify(d0.messages[0].section?.lines[1]));
  check('讲稿里念的句子不带方括号', !d0.messages[0].section!.lines.some((l) => l.text.includes('[')));
  check('朗读老师还没讲过', ((await get('/api/kid/conversations/reading-tutor/today')).json as Day).messages.length === 0);

  const post = await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '不画脚呢?' });
  check('发消息 202', post.status === 202, JSON.stringify(post));
  const d1 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('老师在想:条目 pending,today.pending 有 job', d1.messages.length === 2 && d1.messages[1].pending && d1.pending === d1.messages[1].job);
  check('想的时候再发 → 409', (await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '再问' })).status === 409);
  await m.settle();
  const d2 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('想完 → 追加下一节(脚本第二节),孩子的话在 question 里不在卡上', d2.pending === null && d2.messages[1].section?.cards[0].type === 'section' && d2.messages[1].question === '不画脚呢?' && d2.messages[1].reply === '想一件自己的小事说说看?', JSON.stringify(d2.messages[1].section?.cards[0]));
  await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '继续' });
  await m.settle();
  await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '还有吗' });
  await m.settle();
  const d3 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('脚本用完 → 只有一句收尾话,没有 section', d3.messages.length === 4 && d3.messages[2].section?.cards[0].type === 'oneline' && d3.messages[3].section === null && d3.messages[3].reply === '这个我们明天接着说,好不好?');
  check('剩余次数只数孩子发的', d3.remaining === 30 - 4);
  await m.route('POST', '/api/kid/conversations/reading-tutor/messages', { text: 'apple' });
  await m.settle();
  check('没脚本的老师回一句带原话的话', ((await get('/api/kid/conversations/reading-tutor/today')).json as Day).messages[0].reply?.includes('apple') === true);
  check('空消息 400;没这位老师 404;配音 404', (await m.route('POST', '/api/kid/conversations/math-tutor/messages', { text: '  ' })).status === 400 && (await get('/api/kid/conversations/nobody/today')).status === 404 && (await get('/api/audio/math-tutor/x.mp3')).status === 404);
  const page = await get('/');
  check('页面:标题、按住说话、内联了板书逻辑、没有家长入口、没有「错误」', page.html?.includes('小明的老师们') === true && page.html?.includes('发消息或按住说话') === true && page.html?.includes('function subtitleFor(') === true && !page.html?.includes('export ') && !page.html?.includes('/parent') && !page.html?.includes('错误'), String(page.html?.length));
  check('内联的逻辑没有残留类型标注', !/function anchorMarks\(cards: /.test(page.html ?? ''));
}
{
  const m = createMock({ scenario: 'limit', delayMs: 0 });
  const home = (await m.route('GET', '/api/kid/home')).json as { tutors: { available: boolean; remaining: number }[] };
  check('上限场景:头像全灰,remaining 0', home.tutors.every((t) => !t.available && t.remaining === 0));
  check('上限场景:发消息 429', (await m.route('POST', '/api/kid/conversations/math-tutor/messages', { text: '1+1' })).status === 429);
}
{
  const m = createMock({ scenario: 'offline', delayMs: 0 });
  check('离线场景:接口 500、健康报不 ok、页面照给', (await m.route('GET', '/api/kid/home')).status === 500 && ((await m.route('GET', '/api/health')).json as { ok: boolean }).ok === false && (await m.route('GET', '/')).status === 200);
}
done();
