/** 模拟接口:不经真实服务把孩子端喂起来——首页、板书节、发消息 → 想 → 追加一节、继续、脚本用完、上限、离线、页面。 */
import { createMock } from '../src/server/mock.ts';
import type { BoardSection } from '../src/lib/kid-board.ts';
import { check, done } from './_check.ts';

interface Msg { job: string; question: string | null; reply: string | null; pending: boolean; section: BoardSection | null; action?: string }
interface Day { messages: Msg[]; remaining: number; pending: string | null }

{
  const m = createMock({ delayMs: 0, now: () => new Date('2026-09-10T16:30:00') });
  const get = (p: string) => m.route('GET', p);
  const home = (await get('/api/kid/home')).json as { title: string; day: number; tutors: { name: string; available: boolean; motto: string }[]; suggestions: { tutor: string; text: string }[] };
  check('首页:三位老师、口号、今天可以问', home.title === '小明的老师们' && home.day === 4 && home.tutors.length === 3 && home.tutors.every((t) => t.available) && home.tutors[0].motto === '故事里都有道理' && home.suggestions.length === 3, JSON.stringify(home.tutors));
  const d0 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('语文老师已讲过一节:卡 + 讲稿 + 标注 + 末句问句(脚本过真解析器)', d0.messages.length === 1 && d0.messages[0].section !== null && d0.messages[0].section.cards.map((c) => c.kind).join() === 'text,text,read,choice' && d0.messages[0].section.lines.length === 5 && d0.messages[0].section.lines[1].marks[0]?.card === 1 && d0.messages[0].section.lines[4].ask === true, JSON.stringify(d0.messages[0].section?.lines[1]));
  check('讲稿里念的句子不带方括号', !d0.messages[0].section!.lines.some((l) => l.text.includes('[')));
  check('朗读老师还没讲过', ((await get('/api/kid/conversations/reading-tutor/today')).json as Day).messages.length === 0);

  const post = await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '不画脚呢?' });
  check('发消息 202', post.status === 202, JSON.stringify(post));
  const d1 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('老师在想:条目 pending,today.pending 有 job', d1.messages.length === 2 && d1.messages[1].pending && d1.pending === d1.messages[1].job);
  check('想的时候再发 → 409', (await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '再问' })).status === 409);
  await m.settle();
  const d2 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('想完 → 追加下一节(脚本第二节),孩子的话在 question 里不在卡上', d2.pending === null && d2.messages[1].section?.cards[0].kind === 'text' && d2.messages[1].section?.cards[0].props.style === 'note' && d2.messages[1].section?.cards[2].kind === 'fill' && d2.messages[1].question === '不画脚呢?' && d2.messages[1].reply === '你来填一填:画蛇添足,就是做到了还要什么?', JSON.stringify(d2.messages[1].section?.cards[0]));
  await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '继续' });
  await m.settle();
  await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '还有吗' });
  await m.settle();
  const d3 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('脚本用完 → 只有一句收尾话,没有 section', d3.messages.length === 4 && d3.messages[2].section?.cards[0].props.style === 'note' && d3.messages[3].section === null && d3.messages[3].reply === '这个我们明天接着说,好不好?');
  check('剩余次数只数孩子发的', d3.remaining === 30 - 4);
  // 卡的状态:数学老师首节有选择题 → PUT 状态假存、today 里并回卡上、答案仍剥;交给老师 → 下一节;「继续」不计次数
  const md = (await get('/api/kid/conversations/math-tutor/today')).json as Day;
  const mj = md.messages[0].job;
  const ci = md.messages[0].section!.cards.findIndex((c) => c.kind === 'choice');
  check('数学老师首节没有选择题?', ci < 0, String(ci));
  await m.route('POST', '/api/kid/conversations/math-tutor/messages', { text: '一样的' });
  await m.settle();
  const md2 = (await get('/api/kid/conversations/math-tutor/today')).json as Day;
  const mj2 = md2.messages[1].job;
  const ci2 = md2.messages[1].section!.cards.findIndex((c) => c.kind === 'choice');
  check('第二节有选择题,答案剥掉,还没有状态', ci2 >= 0 && !('answer' in md2.messages[1].section!.cards[ci2].props) && !('state' in md2.messages[1].section!.cards[ci2]));
  check('PUT 坏状态 400、没这张卡 404、text 卡 400', (await m.route('PUT', `/api/kid/conversations/math-tutor/cards/${mj2}/${ci2}`, { picked: 'x' })).status === 400 && (await m.route('PUT', `/api/kid/conversations/math-tutor/cards/${mj2}/99`, { picked: [0] })).status === 404 && (await m.route('PUT', `/api/kid/conversations/math-tutor/cards/${mj}/0`, { picked: [0] })).status === 400);
  const put = await m.route('PUT', `/api/kid/conversations/math-tutor/cards/${mj2}/${ci2}`, { picked: [1] });
  const md3 = (await get('/api/kid/conversations/math-tutor/today')).json as Day;
  check('PUT 状态 → today 里卡上有 state,答案还是没有', put.status === 200 && JSON.stringify(md3.messages[1].section!.cards[ci2].state) === '{"picked":[1]}' && !('answer' in md3.messages[1].section!.cards[ci2].props), JSON.stringify(md3.messages[1].section!.cards[ci2]));
  const sub = await m.route('POST', '/api/kid/conversations/math-tutor/messages', { text: '', action: 'submit', focus: { card: `${mj2}/${ci2}` } });
  await m.settle();
  const md4 = (await get('/api/kid/conversations/math-tutor/today')).json as Day;
  check('交给老师:空文本 + action 也 202,问句是「(交了答案,没说话)」,下一节追加(脚本用完就收尾话)', sub.status === 202 && md4.messages[2].question === '(交了答案,没说话)' && md4.messages[2].reply !== null && !('action' in md4.messages[2]), JSON.stringify(md4.messages[2]));
  const before = md4.remaining;
  await m.route('POST', '/api/kid/conversations/math-tutor/messages', { text: '', action: 'continue' });
  await m.settle();
  const md5 = (await get('/api/kid/conversations/math-tutor/today')).json as Day;
  check('「继续」不计次数,空文本没 action 400', md5.remaining === before && md5.messages[3].question === '继续' && (await m.route('POST', '/api/kid/conversations/math-tutor/messages', { text: '  ' })).status === 400, `${before} ${md5.remaining}`);
  await m.route('POST', '/api/kid/conversations/reading-tutor/messages', { text: 'apple' });
  await m.settle();
  const rd = ((await get('/api/kid/conversations/reading-tutor/today')).json as Day).messages[0];
  check('朗读老师:点读卡 + 图片卡 + 末句问句', rd.section?.cards[1].kind === 'read' && rd.section?.cards[2].kind === 'image' && rd.section?.cards[2].props.src === 'vault/照片/fruits.png' && rd.reply?.includes('apple') === true && rd.section?.lines[1].marks.length === 3, JSON.stringify(rd.section?.lines));
  const img = await get('/api/kid/image?p=vault%2F%E7%85%A7%E7%89%87%2Ffruits.png');
  check('图片卡的图:mock 给占位 svg', img.status === 200 && img.contentType === 'image/svg+xml' && img.html?.includes('<svg') === true && img.html.includes('fruits.png'));
  const fillJob = d2.messages[1].job;
  const fi = d2.messages[1].section!.cards.findIndex((c) => c.kind === 'fill');
  const putFill = await m.route('PUT', `/api/kid/conversations/chinese-tutor/cards/${fillJob}/${fi}`, { answers: ['多做一步'] });
  const dF = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('填空状态 PUT 假存、读回,答案仍剥', putFill.status === 200 && JSON.stringify(dF.messages[1].section!.cards[fi].state) === '{"answers":["多做一步"]}' && !('answers' in dF.messages[1].section!.cards[fi].props) && (await m.route('PUT', `/api/kid/conversations/chinese-tutor/cards/${fillJob}/${fi}`, { answers: 'x' })).status === 400);
  check('空消息 400;没这位老师 404;配音 404', (await m.route('POST', '/api/kid/conversations/math-tutor/messages', { text: '  ' })).status === 400 && (await get('/api/kid/conversations/nobody/today')).status === 404 && (await get('/api/audio/math-tutor/x.mp3')).status === 404);
  const page = await get('/');
  check('页面:标题、按住说话、内联了板书逻辑、舞台、没有家长入口、没有「错误」', page.html?.includes('小明的老师们') === true && page.html?.includes('发消息或按住说话') === true && page.html?.includes('function subtitleFor(') === true && page.html?.includes('id="stage"') === true && page.html?.includes('交给老师') === true && !page.html?.includes('export ') && !page.html?.includes('/parent') && !page.html?.includes('错误'), String(page.html?.length));
  check('内联的逻辑没有残留类型标注', !/function anchorMarks\(cards: /.test(page.html ?? ''));
  const html = page.html ?? '';
  const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  let parses = true;
  try { new Function(js); } catch (e) { parses = false; console.error(String(e)); }
  check('内联脚本本身能解析(模板里的转义没把 JS 字符串写断)', parses);
  const css = await m.route('GET', '/kid/theme.css');
  check('mock 也给主题 css(包里的出厂 default)', css.status === 200 && css.html?.includes('.mk-marker') === true && (await m.route('GET', '/kid/theme.json')).status === 200);
  // 场景卡:数学老师第三节;课包样本在仓库里,下发时补快照(ready / steps / problem);舞台包与课包路由
  const md6 = (await get('/api/kid/conversations/math-tutor/today')).json as Day;
  const sc = md6.messages.map((x) => x.section).find((x) => x && x.cards.some((c) => c.kind === 'scene'))!;
  const si = sc ? sc.cards.findIndex((c) => c.kind === 'scene') : -1;
  check('场景卡下发时带课包快照:ready、6 步、题面;讲稿 [[play]] 锚到它', si >= 0 && sc.cards[si].props.ready === true && (sc.cards[si].props.steps as string[]).length === 6 && String(sc.cards[si].props.problem).includes('75') && sc.lines.some((l) => l.cues.some((c) => c.name === 'play' && c.card === si)), JSON.stringify(sc.cards[si]));
  check('课包文件能取;没有的 404', (await get('/api/bundles/2026-09-04-guilv5/manifest.json')).status === 200 && (await get('/api/bundles/nope/scene.json')).status === 404);
  const { stageBuilt } = await import('../src/server/stage.ts');
  if (stageBuilt()) check('舞台包能取', (await get('/stage/')).status === 200 && (await get('/stage/stage.js')).file !== undefined);
  check('模板里的正则斜杠没被吃掉(\\/ 变 / 会把整行变成注释)', js.includes('/^https?:\\/\\//') && !js.includes('/^https?:///'), js.slice(js.indexOf('https?:') - 20, js.indexOf('https?:') + 20));
}
{
  // 流式模拟:想的期间 pending 条目带 partial 板书,卡一张张增,答案照剥;想完换成正式的一节
  const m = createMock({ delayMs: 600, now: () => new Date('2026-09-10T16:30:00') });
  await m.route('POST', '/api/kid/conversations/math-tutor/messages', { text: '一样的' });
  const seen: number[] = [];
  let partialOk = true;
  for (let i = 0; i < 100; i++) {
    const d = (await m.route('GET', '/api/kid/conversations/math-tutor/today')).json as Day;
    const p = d.messages[1];
    if (!p.pending) break;
    if (p.section) { seen.push(p.section.cards.length); if (!p.section.partial || p.section.cards.some((c) => 'answer' in c.props)) partialOk = false; }
    await new Promise((r) => setTimeout(r, 15));
  }
  await m.settle();
  const fin = ((await m.route('GET', '/api/kid/conversations/math-tutor/today')).json as Day).messages[1];
  check('想的期间见到过 partial 板书,卡数只增不减;想完 partial 没了、卡齐了', seen.length > 0 && seen.every((n, i) => i === 0 || n >= seen[i - 1]) && seen[0] < 3 && partialOk && !fin.pending && fin.section?.partial === undefined && fin.section?.cards.length === 3, JSON.stringify(seen));
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
{
  // 话题:today 带 thread;newThread 开新话题、缺省接当前、指定旧话题;history 今天 + 昨天;昨天的日期路由只读;坏话题 400
  const m = createMock({ delayMs: 0, now: () => new Date('2026-09-10T16:30:00') });
  type TDay = Omit<Day, 'messages'> & { thread: string | null; messages: (Msg & { thread: string })[] };
  const d0 = (await m.route('GET', '/api/kid/conversations/chinese-tutor/today')).json as TDay;
  check('today 带当前话题,消息带 thread', d0.thread === d0.messages[0].job && d0.messages[0].thread === d0.thread);
  const r1 = await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '换个', newThread: true });
  await m.settle();
  const j1 = (r1.json as { job: string; thread: string });
  const r2 = await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '接着' });
  await m.settle();
  const r3 = await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '回旧的', thread: d0.thread });
  await m.settle();
  const d1 = (await m.route('GET', '/api/kid/conversations/chinese-tutor/today')).json as TDay;
  check('新话题 = 自己的 job;缺省接当前(新)话题;指定旧话题回旧话题;today.thread = 末条的', j1.thread === j1.job && (r2.json as { thread: string }).thread === j1.thread && (r3.json as { thread: string }).thread === d0.thread && d1.thread === d0.thread && d1.messages.map((x) => x.thread).join() === [d0.thread, j1.thread, j1.thread, d0.thread].join(), JSON.stringify(d1.messages.map((x) => x.thread)));
  check('不存在的话题 400', (await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: 'x', thread: 'nope' })).status === 400);
  const hist = (await m.route('GET', '/api/kid/conversations/chinese-tutor/history')).json as { today: string; days: { date: string; threads: { thread: string; title: string; sections: number }[] }[] };
  check('history:今天两个话题(新的在前)+ 昨天一个', hist.today === '2026-09-10' && hist.days.length === 2 && hist.days[0].date === '2026-09-10' && hist.days[0].threads.map((t) => t.thread).join() === [j1.thread, d0.thread].join() && hist.days[0].threads[0].title === '换个' && hist.days[1].date === '2026-09-09' && hist.days[1].threads.length === 1 && hist.days[1].threads[0].title.startsWith('昨天问的'), JSON.stringify(hist));
  const yd = (await m.route('GET', '/api/kid/conversations/chinese-tutor/2026-09-09')).json as TDay;
  check('昨天的日期路由:一节板书、thread 在;未来日期 400;别的日期空', yd.messages.length === 1 && yd.messages[0].section !== null && yd.thread === yd.messages[0].thread && (await m.route('GET', '/api/kid/conversations/chinese-tutor/2026-09-11')).status === 400 && ((await m.route('GET', '/api/kid/conversations/chinese-tutor/2026-09-01')).json as TDay).messages.length === 0);
}
done();
