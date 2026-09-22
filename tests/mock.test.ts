/** 模拟接口:不经真实服务把孩子端喂起来——首页、板书节、发消息 → 想 → 追加一节、继续、脚本用完、上限、离线、页面。 */
import { createMock } from '../src/server/mock.ts';
import { tintFor, type BoardSection } from '../src/lib/kid-board.ts';
import { check, done } from './_check.ts';

interface Msg { job: string; question: string | null; reply: string | null; pending: boolean; section: BoardSection | null; action?: string }
interface Day { messages: Msg[]; remaining: number; pending: string | null }

{
  const m = createMock({ delayMs: 0, now: () => new Date('2026-09-10T16:30:00') });
  const get = (p: string) => m.route('GET', p);
  type HomeCard = { kind: string; props: { tutor?: string; buttons?: { id: string | number; kind: string; label: string; date?: string; thread?: string }[] } };
  const home = (await get('/api/kid/home')).json as { title: string; home: string; tutors: { name: string; available: boolean; motto: string }[]; cards: HomeCard[] };
  const tc = home.cards.filter((c) => c.kind === 'tutor');
  check('首页:三位老师、口号;老师卡置顶(语文、数学照原文,英语补一张),其余卡照原文顺序', home.title === '小明的老师们' && home.tutors.length === 3 && home.tutors.every((t) => t.available) && home.tutors[0].motto === '故事里都有道理' && home.home === '2026-09-09-2130' && tc.map((c) => c.props.tutor).join() === 'chinese-tutor,math-tutor,english-tutor' && home.cards.slice(3).map((c) => c.kind).join() === 'text,tianzige', JSON.stringify(home.cards.map((c) => c.kind)));
  check('老师卡的按钮:新话题第一、今天聊过的「接着刚才的」第二、然后是原文的开场与接着;没写的只有新话题;讲法不下发', tc[0].props.buttons?.map((b) => b.id).join() === 'new,recent,0,1' && tc[0].props.buttons?.[1].label === '接着刚才的:画蛇添足是什么意思?' && tc[0].props.buttons?.[3].kind === 'continue' && tc[0].props.buttons?.[3].date === '2026-09-09' && tc[2].props.buttons?.map((b) => b.id).join() === 'new' && !JSON.stringify(home).includes('第 22 课') && !JSON.stringify(home).includes('brief'), JSON.stringify(tc[0].props.buttons));
  const d0 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('语文老师已讲过一节:卡 + 讲稿 + 标注 + 末句问句(脚本过真解析器)', d0.messages.length === 1 && d0.messages[0].section !== null && d0.messages[0].section.cards.map((c) => c.kind).join() === 'text,text,read,choice' && d0.messages[0].section.lines.length === 5 && d0.messages[0].section.lines[1].marks[0]?.card === 1 && d0.messages[0].section.lines[4].ask === true, JSON.stringify(d0.messages[0].section?.lines[1]));
  check('讲稿里念的句子不带方括号', !d0.messages[0].section!.lines.some((l) => l.text.includes('[')));
  check('英语老师还没讲过', ((await get('/api/kid/conversations/english-tutor/today')).json as Day).messages.length === 0);
  const upM = await m.route('POST', '/api/kid/conversations/english-tutor/photos', { image: 'data:image/jpeg;base64,AAAA' });
  const pathM = (upM.json as { path: string }).path;
  const photoMsg = await m.route('POST', '/api/kid/conversations/english-tutor/messages', { text: '', photos: [pathM] });
  const dM = (await get('/api/kid/conversations/english-tutor/today')).json as { messages: (Msg & { photos?: string[] })[] };
  check('mock 也收照片:传图回假路径、只带照片的消息成「(拍了一张)」、条目带 photos、占位图取得到', upM.status === 201 && pathM.startsWith('captures/2026-09-10/1630-') && photoMsg.status === 202 && dM.messages[0].question === '(拍了一张)' && dM.messages[0].photos?.join() === pathM && (await get('/api/kid/image?p=' + encodeURIComponent(pathM))).status === 200, JSON.stringify({ upM: upM.json, q: dM.messages[0]?.question }));

  const post = await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '不画脚呢?' });
  check('发消息 202', post.status === 202, JSON.stringify(post));
  const d1 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('老师在想:条目 pending,today.pending 有 job', d1.messages.length === 2 && d1.messages[1].pending && d1.pending === d1.messages[1].job);
  check('想的时候再发 → 409', (await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '再问' })).status === 409);
  await m.settle();
  const d2 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('想完 → 追加下一节(脚本第二节),孩子的话在 question 里不在卡上', d2.pending === null && d2.messages[1].section?.cards[0].kind === 'text' && d2.messages[1].section?.cards[0].props.text === '先画完的人本来就赢了' && d2.messages[1].section?.cards[2].kind === 'fill' && d2.messages[1].question === '不画脚呢?' && d2.messages[1].reply === '你来填一填:画蛇添足,就是做到了还要什么?', JSON.stringify(d2.messages[1].section?.cards[0]));
  await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '继续' });
  await m.settle();
  await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '鼓励怎么写' });
  await m.settle();
  const dh = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('田字格卡:第四节第一张是 tianzige「鼓励」,没有状态、不剥东西', dh.messages[3].section?.cards[0].kind === 'tianzige' && dh.messages[3].section?.cards[0].props.chars === '鼓励' && dh.messages[3].section?.cards[1].kind === 'text', JSON.stringify(dh.messages[3].section?.cards));
  const hzOk = await get('/api/kid/tianzige/' + encodeURIComponent('鼓'));
  const hzNo = await get('/api/kid/tianzige/' + encodeURIComponent('ab'));
  check('笔顺数据:鼓 13 笔、每笔轮廓与中线成对;不是汉字 404', hzOk.status === 200 && (hzOk.json as { strokes: string[]; medians: number[][][] }).strokes.length === 13 && (hzOk.json as { medians: number[][][] }).medians.length === 13 && hzNo.status === 404, JSON.stringify(hzNo));
  await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '还有吗' });
  await m.settle();
  const d3 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('脚本用完 → 只有一句收尾话(一节只有讲稿;末句是问句,补了提问卡)', d3.messages.length === 5 && d3.messages[2].section?.cards[0].kind === 'text' && d3.messages[4].section?.cards.length === 1 && d3.messages[4].section?.cards[0].props.ask === true && d3.messages[4].section?.lines.length === 1 && d3.messages[4].reply === '这个我们明天接着说,好不好?');
  check('剩余次数只数孩子发的', d3.remaining === 30 - 5);
  // 卡的状态:数学老师首节有选择题 → PUT 状态假存、today 里并回卡上、答案仍剥;交给老师 → 下一节;「继续」不计次数
  const md = (await get('/api/kid/conversations/math-tutor/today')).json as Day;
  const mj = md.messages[0].job;
  const mc = md.messages[0].section!.cards;
  const ci = mc.findIndex((c) => c.kind === 'choice');
  check('数学老师首节(勾股定理,原型样张):首张带标题、# 标题的 text 是 sky、公式 paper、选择题在末尾且答案剥掉、没有状态', ci === mc.length - 1 && mc[0].props.title === '勾股定理' && tintFor(mc[0]) === 'sky' && mc[1].props.title === '认边' && tintFor(mc[1]) === 'sky' && tintFor(mc[2]) === 'paper' && tintFor(mc[ci]) === 'plum' && !('answer' in mc[ci].props) && !('state' in mc[ci]), JSON.stringify(mc.map((c) => [c.kind, tintFor(c)])));
  const lay = md.messages[0].section as BoardSection & { layout?: { for: string; rows: number[][] } };
  check('假后期套上了:平板横屏四行(认边 + 公式并排、验证 + 一句话并排、选择题独占)、验证成 moss、一句话带 emoji、三条边画圈(带 pen)', lay.layout?.for === 'tablet-landscape' && JSON.stringify(lay.layout.rows) === '[[0],[1,2],[3,4],[5]]' && lay.cards[3].look?.tint === 'moss' && lay.cards[4].look?.emoji === '💡' && lay.lines[0].marks.some((mk) => mk.phrase === '三条边' && mk.pen === 'circle') && lay.lines[1].marks.some((mk) => mk.phrase === '斜边' && mk.pen === undefined) && lay.cards[1].look === undefined, JSON.stringify([lay.layout, lay.cards.map((c) => c.look)]));
  {
    const plain = createMock({ delayMs: 0, scenario: 'nopost', now: () => new Date('2026-09-10T16:30:00') });
    const pd = (await plain.route('GET', '/api/kid/conversations/math-tutor/today')).json as Day;
    check('nopost 场景:素版,没有 layout、没有 look、标注没 pen', pd.messages[0].section?.layout === undefined && pd.messages[0].section?.cards.every((c) => c.look === undefined) === true && pd.messages[0].section?.lines.every((l) => l.marks.every((mk) => mk.pen === undefined)) === true);
  }
  check('末句问句锚到选择题;[25] 落在「验证」卡不落在别处', md.messages[0].section!.lines[md.messages[0].section!.lines.length - 1].anchor === ci && md.messages[0].section!.lines.some((l) => l.marks.some((mk) => mk.phrase === '25' && mc[mk.card].props.title === '验证')));
  check('PUT 坏状态 400、没这张卡 404、text 卡 400', (await m.route('PUT', `/api/kid/conversations/math-tutor/cards/${mj}/${ci}`, { picked: 'x' })).status === 400 && (await m.route('PUT', `/api/kid/conversations/math-tutor/cards/${mj}/99`, { picked: [0] })).status === 404 && (await m.route('PUT', `/api/kid/conversations/math-tutor/cards/${mj}/1`, { picked: [0] })).status === 400);
  const put = await m.route('PUT', `/api/kid/conversations/math-tutor/cards/${mj}/${ci}`, { picked: [0] });
  const md3 = (await get('/api/kid/conversations/math-tutor/today')).json as Day;
  check('PUT 状态 → today 里卡上有 state,答案还是没有', put.status === 200 && JSON.stringify(md3.messages[0].section!.cards[ci].state) === '{"picked":[0]}' && !('answer' in md3.messages[0].section!.cards[ci].props), JSON.stringify(md3.messages[0].section!.cards[ci]));
  const sub = await m.route('POST', '/api/kid/conversations/math-tutor/messages', { text: '', action: 'submit', focus: { card: `${mj}/${ci}` } });
  await m.settle();
  const md4 = (await get('/api/kid/conversations/math-tutor/today')).json as Day;
  check('交给老师:空文本 + action 也 202,问句是「(交了答案,没说话)」,下一节追加(反过来想 + 填空)', sub.status === 202 && md4.messages[1].question === '(交了答案,没说话)' && md4.messages[1].reply !== null && !('action' in md4.messages[1]) && md4.messages[1].section?.cards.some((c) => c.kind === 'fill') === true, JSON.stringify(md4.messages[1]));
  const before = md4.remaining;
  await m.route('POST', '/api/kid/conversations/math-tutor/messages', { text: '', action: 'continue' });
  await m.settle();
  const md5 = (await get('/api/kid/conversations/math-tutor/today')).json as Day;
  check('「继续」不计次数,空文本没 action 400;第三节有场景卡', md5.remaining === before && md5.messages[2].question === '继续' && md5.messages[2].section?.cards.some((c) => c.kind === 'scene') === true && (await m.route('POST', '/api/kid/conversations/math-tutor/messages', { text: '  ' })).status === 400, `${before} ${md5.remaining}`);
  await m.route('POST', '/api/kid/conversations/english-tutor/messages', { text: 'apple' });
  await m.settle();
  const rd = ((await get('/api/kid/conversations/english-tutor/today')).json as Day).messages[0];
  check('英语老师:点读卡 + 图片卡 + 末句问句', rd.section?.cards[1].kind === 'read' && rd.section?.cards[2].kind === 'image' && rd.section?.cards[2].props.src === 'captures/2026-09-10/fruits.png' && rd.reply?.includes('apple') === true && rd.section?.lines[1].marks.length === 3, JSON.stringify(rd.section?.lines));
  const img = await get('/api/kid/image?p=' + encodeURIComponent('captures/2026-09-10/fruits.png'));
  check('图片卡的图:mock 给占位 svg', img.status === 200 && img.contentType === 'image/svg+xml' && img.html?.includes('<svg') === true && img.html.includes('fruits.png'));
  const fillJob = d2.messages[1].job;
  const fi = d2.messages[1].section!.cards.findIndex((c) => c.kind === 'fill');
  const putFill = await m.route('PUT', `/api/kid/conversations/chinese-tutor/cards/${fillJob}/${fi}`, { answers: ['多做一步'] });
  const dF = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('填空状态 PUT 假存、读回,答案仍剥', putFill.status === 200 && JSON.stringify(dF.messages[1].section!.cards[fi].state) === '{"answers":["多做一步"]}' && !('answers' in dF.messages[1].section!.cards[fi].props) && (await m.route('PUT', `/api/kid/conversations/chinese-tutor/cards/${fillJob}/${fi}`, { answers: 'x' })).status === 400);
  check('空消息 400;没这位老师 404;配音 404', (await m.route('POST', '/api/kid/conversations/math-tutor/messages', { text: '  ' })).status === 400 && (await get('/api/kid/conversations/nobody/today')).status === 404 && (await get('/api/audio/math-tutor/x.mp3')).status === 404);
  const page = await get('/');
  check('页面:标题、按住说话、内联了板书逻辑、舞台、没有家长入口、没有「错误」', page.html?.includes('小明的老师们') === true && page.html?.includes('发消息或按住说话') === true && page.html?.includes('function subtitleFor(') === true && page.html?.includes('id="stage"') === true && page.html?.includes('交给老师') === true && !page.html?.includes('export ') && !page.html?.includes('/parent') && !page.html?.includes('错误'), String(page.html?.length));
  check('舞台有遮罩:紧跟在舞台后面(靠 #stage.on ~ #st-dim 显示),点它走 closeStage', /id="st-act"[^\n]*<\/div><\/div>\s*<div id="st-dim"><\/div>/.test(page.html ?? '') && page.html?.includes("$('#st-dim').addEventListener('click', closeStage)") === true);
  check('内联的逻辑没有残留类型标注', !/function anchorMarks\(cards: /.test(page.html ?? ''));
  const html = page.html ?? '';
  const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  let parses = true;
  try { new Function(js); } catch (e) { parses = false; console.error(String(e)); }
  check('内联脚本本身能解析(模板里的转义没把 JS 字符串写断)', parses);
  const css = await m.route('GET', '/kid/theme.css');
  check('mock 也给主题 css(包里的出厂 default)', css.status === 200 && css.html?.includes('.mk-marker') === true && (await m.route('GET', '/kid/theme.json')).status === 200);
  // 主题里改定位 / 关触摸的裸类名(.pen { pointer-events:none } 是板书笔迹的)会打到页面任何同名元素上:页面自己挂的状态类不能与它们撞名(发照片屏圈画曾挂 pen,整屏不收触摸)
  const bare = new Set([...(css.html ?? '').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|})\s*([^{}]+)\{([^}]*)\}/g)].filter((x) => /pointer-events\s*:\s*none|position\s*:\s*(?:absolute|fixed)/.test(x[2])).flatMap((x) => x[1].split(',').map((t) => t.trim())).filter((t) => /^\.[\w-]+$/.test(t)).map((t) => t.slice(1)));
  const toggled = [...js.matchAll(/classList\.(?:add|toggle|remove)\('([\w-]+)'/g)].map((x) => x[1]);
  const clash = [...new Set(toggled.filter((c) => bare.has(c)))];
  check('页面挂的状态类不与主题的裸类名撞(主题认得 .pen)', bare.has('pen') && toggled.length > 10 && clash.length === 0, clash.join());
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
    if (p.section) { seen.push(p.section.cards.length); if (!p.section.partial || typeof (p.section as { ready?: number }).ready !== 'number' || p.section.cards.some((c) => 'answer' in c.props)) partialOk = false; }
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
// 首页按钮发来的 via(《首页设计.md》§5.2):对不上 400;开场 = 按钮上的字 + 新话题;接着昨天的 = 新话题;接着刚才的 / 新话题照孩子的话
{
  const m = createMock({ delayMs: 0, now: () => new Date('2026-09-10T16:30:00') });
  const home = ((await m.route('GET', '/api/kid/home')).json as { home: string }).home;
  const send = (tutor: string, body: unknown) => m.route('POST', `/api/kid/conversations/${tutor}/messages`, body);
  type D = { messages: { job: string; thread: string; question: string | null }[] };
  const last = async (tutor: string) => { await m.settle(); const d = (await m.route('GET', `/api/kid/conversations/${tutor}/today`)).json as D; return d.messages[d.messages.length - 1]; };
  check('via:不是发布的那份 / 按钮越界 → 400', (await send('chinese-tutor', { text: '', via: { home: '2020-01-01-0000', button: 0 } })).status === 400 && (await send('chinese-tutor', { text: '', via: { home, button: 9 } })).status === 400);
  const s0 = await send('chinese-tutor', { text: '', via: { home, button: 0 } });
  const l0 = await last('chinese-tutor');
  check('开场按钮:发的是按钮上的字,新开一个话题', s0.status === 202 && l0.question === '我要预习小蝌蚪找妈妈' && l0.thread === l0.job, JSON.stringify(l0));
  const s1 = await send('chinese-tutor', { text: '', thread: l0.thread, via: { home, button: 1 } });
  const l1 = await last('chinese-tutor');
  check('接着昨天的话题:按钮上的字、新话题(不接今天的)', s1.status === 202 && l1.question === '接着讲画蛇添足' && l1.thread === l1.job, JSON.stringify(l1));
  const s2 = await send('math-tutor', { text: '再讲一遍', newThread: true, via: { home, button: 'new' } });
  const l2 = await last('math-tutor');
  check('新话题按钮:孩子自己的话,新话题', s2.status === 202 && l2.question === '再讲一遍' && l2.thread === l2.job);
}

// 家长板书页(《家长板书页设计.md》):mock 也起——页面能解析、板书接口答案在、第一节带给家长的尾巴、清单今天与昨天
{
  const m = createMock({ delayMs: 0, now: () => new Date('2026-09-10T16:30:00') });
  const get = (p: string) => m.route('GET', p);
  const page = (await get('/parent')).html ?? '';
  const js = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
  let parses = true;
  try { new Function(js); } catch (e) { parses = false; console.error(String(e)); }
  check('家长端 /parent:带家长标记、自己的 manifest、内联脚本能解析', page.includes('const MODE = {"parent":true};') && page.includes('/parent/manifest.webmanifest') && parses && ((await get('/parent/manifest.webmanifest')).json as { start_url: string }).start_url === '/parent');
  type PMsg = Msg & { from: string; parentText?: string; remembered?: string[] };
  const pb = (await get('/api/conversations/chinese-tutor/today/board')).json as { messages: PMsg[] };
  const ch = pb.messages[0].section!.cards.find((c) => c.kind === 'choice');
  check('板书接口:答案不剥、from、第一节带给家长的尾巴与记忆', pb.messages.length === 1 && pb.messages[0].from === 'kid' && Array.isArray(ch?.props.answer) && pb.messages[0].parentText?.startsWith('## 家长') === true && pb.messages[0].remembered?.length === 1, JSON.stringify(pb.messages[0].parentText));
  check('孩子接口照旧剥答案', !('answer' in ((await get('/api/kid/conversations/chinese-tutor/today')).json as Day).messages[0].section!.cards.find((c) => c.kind === 'choice')!.props));
  type Ov = { date: string; today: string; tutors: { name: string; threads: { title: string; sections: number; stoppedAt: string | null }[] }[] };
  const ov = (await get('/api/overview/today')).json as Ov;
  const oy = (await get('/api/overview/2026-09-09')).json as Ov;
  check('清单:今天三位老师,语文老师一个话题停在末句问句,英语老师没聊;昨天有以前的话题;未来 400', ov.tutors.length === 3 && ov.tutors[0].threads.length === 1 && ov.tutors[0].threads[0].stoppedAt === 'ask' && ov.tutors[0].threads[0].title.length > 0 && ov.tutors[2].threads.length === 0 && oy.date === '2026-09-09' && oy.tutors[0].threads[0].title.startsWith('昨天问的') && (await get('/api/overview/2027-01-01')).status === 400, JSON.stringify(ov.tutors[0]));

  // 试用(§5):/api/tryouts/<老师>/… 形状同孩子端的;另一份列表,孩子端那份不变;下发带 from / tryout / 费用 / 本来会记住的、答案不剥;清单里「试过的」
  const t0 = await m.route('POST', '/api/tryouts/english-tutor/messages', { text: '试试新讲法', newThread: true });
  await m.settle();
  type TMsg = Msg & { from: string; tryout?: boolean; costUsd?: number; memoryDraft?: string[]; thread: string };
  const td = (await get('/api/tryouts/english-tutor/today')).json as { messages: TMsg[]; thread: string | null };
  const kd = (await get('/api/kid/conversations/english-tutor/today')).json as Day;
  const ov2 = (await get('/api/overview/today')).json as { tutors: { name: string; tryouts: { title: string; sections: number }[] }[] };
  check('试用:202、一轮从脚本第一节起;from parent、tryout、费用、本来会记住的;英语老师孩子端那份还是空的;清单「试过的」一条', t0.status === 202 && td.messages.length === 1 && td.messages[0].from === 'parent' && td.messages[0].tryout === true && td.messages[0].costUsd === 0.03 && td.messages[0].memoryDraft?.length === 1 && td.messages[0].section !== null && td.messages[0].question === '试试新讲法' && kd.messages.length === 0 && ov2.tutors[2].tryouts.length === 1 && ov2.tutors[2].tryouts[0].title === '试试新讲法' && ov2.tutors[2].tryouts[0].sections === 1, JSON.stringify({ t0: t0.json, td: td.messages[0]?.question, kd: kd.messages.length, tr: ov2.tutors[2].tryouts }));
  const t1 = await m.route('POST', '/api/tryouts/english-tutor/messages', { text: '再来', thread: td.thread });
  await m.settle();
  const td2 = (await get('/api/tryouts/english-tutor/today')).json as { messages: TMsg[] };
  const th = (await get('/api/tryouts/english-tutor/history')).json as { days: { date: string; threads: { sections: number }[] }[] };
  check('试用:接着同一话题;以前试过的列出今天一个话题两节;没这位老师 404;配音 404', t1.status === 202 && td2.messages.length === 2 && td2.messages[1].thread === td.thread && th.days.length === 1 && th.days[0].threads[0].sections === 2 && (await get('/api/tryouts/nobody/today')).status === 404 && (await get('/api/tryouts/audio/english-tutor/x.mp3')).status === 404, JSON.stringify(th));

  // 家长真发(第六节 3):进孩子那份列表,from parent;孩子端 today 里问句为 null、不算上限;打星在清单上
  const before = ((await get('/api/kid/conversations/chinese-tutor/today')).json as Day).remaining;
  const p0 = await m.route('POST', '/api/conversations/chinese-tutor/messages', { text: '家长补一句', device: 'phone' });
  await m.settle();
  const kd2 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  const pb2 = (await get('/api/conversations/chinese-tutor/today/board')).json as { messages: (Msg & { from: string })[] };
  const last2 = pb2.messages[pb2.messages.length - 1];
  check('家长真发:202,接当前话题;孩子端那条问句 null、剩余条数不变;板书接口 from parent', p0.status === 202 && kd2.messages[kd2.messages.length - 1].question === null && kd2.remaining === before && last2.from === 'parent' && last2.question === '家长补一句' && last2.section !== null, JSON.stringify({ p0: p0.json, q: kd2.messages[kd2.messages.length - 1]?.question, from: last2.from }));
  const th0 = (pb2.messages[0] as unknown as { thread: string }).thread;
  const r1 = await m.route('PUT', `/api/conversations/chinese-tutor/2026-09-10/threads/${th0}/rating`, { rating: 4 });
  const ov3 = (await get('/api/overview/today')).json as { tutors: { threads: { thread: string; rating: number | null }[] }[] };
  check('打星:PUT 后清单上那个话题 4 星;坏值 400;null 取消', r1.status === 200 && ov3.tutors[0].threads.find((t) => t.thread === th0)?.rating === 4 && (await m.route('PUT', `/api/conversations/chinese-tutor/2026-09-10/threads/${th0}/rating`, { rating: 9 })).status === 400 && (await m.route('PUT', `/api/conversations/chinese-tutor/2026-09-10/threads/${th0}/rating`, { rating: null })).status === 200 && ((await get('/api/overview/today')).json as typeof ov3).tutors[0].threads[0].rating === null, JSON.stringify(ov3.tutors[0].threads));
  // 记账(家长端清单上):mock 立刻把这天讲过的话题记上;再记没有要记的
  const b1 = await m.route('POST', '/api/conversations/chinese-tutor/2026-09-10/bookkeep', {});
  const ovb = (await get('/api/overview/today')).json as { tutors: { threads: { booked: boolean }[]; booking: boolean }[] };
  check('记账:202、queued 一个话题;清单上那行 booked;再记 queued 空', b1.status === 202 && (b1.json as { queued: string[] }).queued.length === 1 && ovb.tutors[0].threads.every((t) => t.booked) && ovb.tutors[0].booking === false && ((await m.route('POST', '/api/conversations/chinese-tutor/2026-09-10/bookkeep', {})).json as { queued: string[] }).queued.length === 0, JSON.stringify(b1.json));
  // 删话题(打完星之后删,清单上那个话题就没了)
  const dl = await m.route('DELETE', `/api/conversations/chinese-tutor/2026-09-10/threads/${th0}`);
  const dt = await m.route('DELETE', `/api/tryouts/english-tutor/2026-09-10/threads/${td.thread}`);
  check('删话题:孩子的删了清单上没了、孩子端 today 空;试用的删了「试过的」空;再删 404', dl.status === 200 && ((await get('/api/overview/today')).json as { tutors: { threads: unknown[]; tryouts: unknown[] }[] }).tutors[0].threads.length === 0 && ((await get('/api/kid/conversations/chinese-tutor/today')).json as Day).messages.length === 0 && dt.status === 200 && ((await get('/api/overview/today')).json as { tutors: { tryouts: unknown[] }[] }).tutors[2].tryouts.length === 0 && (await m.route('DELETE', `/api/conversations/chinese-tutor/2026-09-10/threads/${th0}`)).status === 404, JSON.stringify({ dl: dl.json, dt: dt.json }));
}
done();
