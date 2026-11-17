/** 模拟接口:不经真实服务把孩子端喂起来——首页、讲稿节、发消息 → 想 → 追加一节、继续、脚本用完、离线、页面。课里的卡 2026-11-17 删了,mock 的老师只写讲稿。 */
import { createMock } from '../src/app/mock/mock.ts';
import type { BoardSection } from '../src/board/presentation.ts';
import { check, done } from './_check.ts';

interface Msg { job: string; question: string | null; reply: string | null; pending: boolean; section: BoardSection | null; action?: string }
interface Day { messages: Msg[]; pending: string | null }

{
  const m = createMock({ delayMs: 0, now: () => new Date('2026-09-10T16:30:00') });
  const get = (p: string) => m.route('GET', p);
  type HomeCard = { kind: string; props: { tutor?: string; buttons?: { id: string | number; kind: string; label: string; date?: string; thread?: string; resume?: { title: string } }[] } };
  const home = (await get('/api/kid/home')).json as { title: string; home: string; tutors: { name: string }[]; cards: HomeCard[] };
  const tc = home.cards.filter((c) => c.kind === 'tutor');
  check('首页:三位老师;老师卡置顶(语文、数学照原文,英语补一张),再是听写卡;听写卡没有字(中文一张、英文单词一张)', home.title === '小明的老师们' && home.tutors.length === 3 && home.tutors.every((t) => !('available' in t) && !('remaining' in t)) && home.home === '2026-09-09-2130' && tc.map((c) => c.props.tutor).join() === 'chinese-tutor,math-tutor,english-tutor' && home.cards.slice(3).map((c) => c.kind).join() === 'dictation,dictation' && !JSON.stringify(home.cards[3]).includes('鼓励') && (home.cards[4].props as { lang?: string }).lang === 'en' && !JSON.stringify(home.cards[4]).includes('yellow'), JSON.stringify(home.cards.map((c) => c.kind)));
  check('老师卡的按钮:原文的 activity 与小课堂(没有新话题;今天聊过的在首页「今天」);没写的没有按钮;讲法不下发', tc[0].props.buttons?.map((b) => `${b.id}:${b.kind}`).join() === '0:start' && tc[1].props.buttons?.map((b) => b.kind).join() === 'lecture,lecture' && tc[2].props.buttons?.length === 0 && !JSON.stringify(home).includes('第 22 课') && !JSON.stringify(home).includes('brief'), JSON.stringify(tc[0].props.buttons));
  const d0 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('语文老师已讲过一节:讲稿 5 句、末句问句(脚本过真解析器),节上没有卡', d0.messages.length === 1 && d0.messages[0].section !== null && d0.messages[0].section.lines.length === 5 && d0.messages[0].section.lines[4].ask === true && !('cards' in d0.messages[0].section), JSON.stringify(d0.messages[0].section));
  check('英语老师还没讲过', ((await get('/api/kid/conversations/english-tutor/today')).json as Day).messages.length === 0);
  const upM = await m.route('POST', '/api/kid/conversations/english-tutor/photos', { image: 'data:image/jpeg;base64,AAAA' });
  const pathM = (upM.json as { path: string }).path;
  const photoMsg = await m.kidSend('english-tutor', { text: '', photos: [pathM] });
  const dM = (await get('/api/kid/conversations/english-tutor/today')).json as { messages: (Msg & { photos?: string[] })[] };
  check('mock 也收照片:传图回假路径、只带照片的消息成「(拍了一张)」、条目带 photos、占位图取得到', upM.status === 201 && pathM.startsWith('captures/2026-09-10/1630-') && photoMsg.status === 202 && dM.messages[0].question === '(拍了一张)' && dM.messages[0].photos?.join() === pathM && (await get('/api/kid/image?p=' + encodeURIComponent(pathM))).status === 200, JSON.stringify({ upM: upM.json, q: dM.messages[0]?.question }));

  const post = await m.kidSend('chinese-tutor', { text: '不画脚呢?' });
  check('发消息 202', post.status === 202, JSON.stringify(post));
  check('HTTP 上不收孩子发的(同真服务:只走实时那条连接)', (await m.route('POST', '/api/kid/conversations/chinese-tutor/messages', { text: '走 HTTP' })).status === 405);
  const d1 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('老师在想:条目 pending,today.pending 有 job', d1.messages.length === 2 && d1.messages[1].pending && d1.pending === d1.messages[1].job);
  check('想的时候再发 → 409', (await m.kidSend('chinese-tutor', { text: '再问' })).status === 409);
  await m.settle();
  const d2 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('想完 → 追加下一节(脚本第二节),孩子的话在 question 里', d2.pending === null && d2.messages[1].section?.lines.length === 4 && d2.messages[1].question === '不画脚呢?' && d2.messages[1].reply === '你说说:画蛇添足,就是做到了还要怎样?', JSON.stringify(d2.messages[1]));
  await m.kidSend('chinese-tutor', { text: '继续' });
  await m.settle();
  await m.kidSend('chinese-tutor', { text: '鼓励怎么写' });
  await m.settle();
  const hzOk = await get('/api/kid/tianzige/' + encodeURIComponent('鼓'));
  const hzNo = await get('/api/kid/tianzige/' + encodeURIComponent('ab'));
  check('点字弹的田字格的笔顺数据:鼓 13 笔、每笔轮廓与中线成对;不是汉字 404', hzOk.status === 200 && (hzOk.json as { strokes: string[]; medians: number[][][] }).strokes.length === 13 && (hzOk.json as { medians: number[][][] }).medians.length === 13 && hzNo.status === 404, JSON.stringify(hzNo));
  await m.kidSend('chinese-tutor', { text: '还有吗' });
  await m.settle();
  const d3 = (await get('/api/kid/conversations/chinese-tutor/today')).json as Day;
  check('脚本用完 → 只有一句收尾话(末句是问句)', d3.messages.length === 5 && d3.messages[4].section?.lines.length === 1 && d3.messages[4].section?.lines[0].ask === true && d3.messages[4].reply === '这个我们明天接着说,好不好?', JSON.stringify(d3.messages[4]));
  check('不限每天几条:今天没有剩几条', !('remaining' in d3));
  // 给老师看:空文本 + action 也 202,问句是「(给老师看,没说话)」;「继续」不计次数
  const md = (await get('/api/kid/conversations/math-tutor/today')).json as Day;
  check('数学老师首节:讲稿 5 句,末句问句', md.messages[0].section?.lines.length === 5 && md.messages[0].section.lines[4].ask === true, JSON.stringify(md.messages[0].section));
  const sub = await m.kidSend('math-tutor', { text: '', action: 'submit' });
  await m.settle();
  const md4 = (await get('/api/kid/conversations/math-tutor/today')).json as Day;
  check('给老师看:空文本 + action 也 202,问句是「(给老师看,没说话)」,下一节追加', sub.status === 202 && md4.messages[1].question === '(给老师看,没说话)' && md4.messages[1].reply !== null && !('action' in md4.messages[1]) && (md4.messages[1].section?.lines.length ?? 0) > 0, JSON.stringify(md4.messages[1]));
  await m.kidSend('math-tutor', { text: '继续' });
  await m.settle();
  const md5 = (await get('/api/kid/conversations/math-tutor/today')).json as Day;
  check('「继续」也行,空文本没 action 400;第三节有讲稿', md5.messages[2].question === '继续' && (md5.messages[2].section?.lines.length ?? 0) > 0 && (await m.kidSend('math-tutor', { text: '  ' })).status === 400);
  await m.kidSend('english-tutor', { text: 'apple' });
  await m.settle();
  const rd = ((await get('/api/kid/conversations/english-tutor/today')).json as Day).messages[1];
  check('英语老师:接着照片那条讲下一节(脚本第二节),末句不是问句', rd.question === 'apple' && rd.section?.lines.length === 2 && rd.section.lines[1].ask === false, JSON.stringify(rd));
  const ltOk = await get('/api/kid/letters/' + encodeURIComponent('apple'));
  const ltNo = await get('/api/kid/letters/' + encodeURIComponent('ab1'));
  type Lt = { glyphs: Record<string, { advance: number; strokes: number[][][] }>; gap: number; space: number };
  const lj = ltOk.json as Lt;
  check('点字弹的四线三格的字母笔顺:apple 用到 a p l e 四个字形,a 两笔(圈 + 竖)、点在四线三格里;写不出的词 404', ltOk.status === 200 && Object.keys(lj.glyphs).join() === 'a,p,l,e' && lj.glyphs.a.strokes.length === 2 && lj.glyphs.a.strokes.flat().every(([x, y]) => x >= -0.1 && x <= 1.1 && y >= -2 && y <= 1) && ltNo.status === 404, JSON.stringify(ltNo));
  const pg = (await get('/')).html ?? '';
  const adv = /const WORD_ADV = (\{.*?\});/.exec(pg);
  const advJ = adv ? (JSON.parse(adv[1]) as { adv: Record<string, number>; gap: number; space: number }) : null;
  check('孩子端页面拼进了字母宽表(52 个字母 + 连字符、撇号)、字间距与接口一致:四线三格同步排得出大小', !pg.includes('__WORD_ADV__') && advJ !== null && Object.keys(advJ.adv).length === 54 && advJ.adv.a === lj.glyphs.a.advance && advJ.gap === lj.gap && advJ.space === lj.space, adv?.[1].slice(0, 120));
  check('空消息 400;没这位老师 404;配音一律是静音(不用浏览器合成声)', (await m.kidSend('math-tutor', { text: '  ' })).status === 400 && (await get('/api/kid/conversations/nobody/today')).status === 404 && (await get('/api/audio/math-tutor/x.mp3')).contentType === 'audio/wav');
  const page = await get('/');
  check('孩子端页面(录像、预览也是它)不念浏览器合成声', !/speechSynthesis|SpeechSynthesisUtterance|synth/.test(page.html ?? '') && !/speechSynthesis/.test((await get('/reel')).html ?? ''));
  check('页面:标题、按住说话、内联了板书逻辑、舞台、没有家长入口、没有「错误」', page.html?.includes('小明的老师们') === true && page.html?.includes('发消息或按住说话') === true && page.html?.includes('function sectionsFromMessages(') === true && page.html?.includes('id="stage"') === true && page.html?.includes('给老师看') === true && !page.html?.includes('export ') && !page.html?.includes('/parent') && !page.html?.includes('错误'), String(page.html?.length));
  check('舞台有遮罩:紧跟在舞台后面(靠 #stage.on ~ #st-dim 显示),点它走 closeStage(经 closeByKid)', /id="st-act"[^\n]*<\/div><\/div>\s*<div id="st-dim"><\/div>/.test(page.html ?? '') && page.html?.includes("$('#st-dim').addEventListener('click', closeByKid)") === true && /const closeByKid = \(\) => \{[^\n]*closeStage\(\)/.test(page.html ?? ''));
  check('内联的逻辑没有残留类型标注', !/function kidSaid\(messages: /.test(page.html ?? ''));
  const html = page.html ?? '';
  const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  let parses = true;
  try { new Function(js); } catch (e) { parses = false; console.error(String(e)); }
  check('内联脚本本身能解析(模板里的转义没把 JS 字符串写断)', parses);
  const css = await m.route('GET', '/kid/theme.css');
  check('mock 也给主题 css(包里的出厂 default)', css.status === 200 && css.html?.includes('--tint-sky-bg') === true && (await m.route('GET', '/kid/theme.json')).status === 200);
  // 规则按「前一条的 } 之后」切(后行断言,不吃掉 },否则只认得隔一条的规则)
  // 主题里改定位 / 关触摸的裸类名会打到页面任何同名元素上:页面自己挂的状态类不能与它们撞名(发照片屏圈画曾挂 pen,撞上当时主题里板书笔迹的 .pen,整屏不收触摸)
  const bare = new Set([...(css.html ?? '').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|(?<=\}))\s*([^{}]+)\{([^}]*)\}/g)].filter((x) => /pointer-events\s*:\s*none|position\s*:\s*(?:absolute|fixed)/.test(x[2])).flatMap((x) => x[1].split(',').map((t) => t.trim())).filter((t) => /^\.[\w-]+$/.test(t)).map((t) => t.slice(1)));
  const toggled = [...js.matchAll(/classList\.(?:add|toggle|remove)\('([\w-]+)'/g)].map((x) => x[1]);
  const clash = [...new Set(toggled.filter((c) => bare.has(c)))];
  check('页面挂的状态类不与主题的裸类名撞', toggled.length > 10 && clash.length === 0, clash.join());
  // 课包样本在仓库里(小课堂是一节课里的一页,舞台照课包画);舞台包与课包路由
  check('课包文件能取;没有的 404', (await get('/api/bundles/2026-09-04-guilv5/manifest.json')).status === 200 && (await get('/api/bundles/nope/scene.json')).status === 404);
  const { stageBuilt } = await import('../src/app/http/stage.ts');
  if (stageBuilt()) check('舞台包能取', (await get('/stage/')).status === 200 && (await get('/stage/stage.js')).file !== undefined);
  check('模板里正则的反斜杠没被吃掉(\\d 变 d,正则照样能解析,只是认不出了)', js.includes('/^(\\d{1,2}):(\\d{2})') && !js.includes('/^(d{1,2})'), js.slice(js.indexOf('{1,2}') - 20, js.indexOf('{1,2}') + 20));
}
{
  // 流式模拟:想的期间 pending 条目带 partial 讲稿,句子一句句增;想完换成正式的一节
  const m = createMock({ delayMs: 600, now: () => new Date('2026-09-10T16:30:00') });
  await m.kidSend('math-tutor', { text: '一样的' });
  const seen: number[] = [];
  let partialOk = true;
  for (let i = 0; i < 100; i++) {
    const d = (await m.route('GET', '/api/kid/conversations/math-tutor/today')).json as Day;
    const p = d.messages[1];
    if (!p.pending) break;
    if (p.section) { seen.push(p.section.lines.length); if (!p.section.partial) partialOk = false; }
    await new Promise((r) => setTimeout(r, 15));
  }
  await m.settle();
  const fin = ((await m.route('GET', '/api/kid/conversations/math-tutor/today')).json as Day).messages[1];
  check('想的期间见到过 partial 讲稿,句数只增不减;想完 partial 没了、句子齐了', seen.length > 0 && seen.every((n, i) => i === 0 || n >= seen[i - 1]) && seen[0] < 3 && partialOk && !fin.pending && fin.section?.partial === undefined && fin.section?.lines.length === 3, JSON.stringify(seen));
}
{
  // 话题:today 带 thread;newThread 开新话题、缺省接当前、指定旧话题;昨天的日期路由只读;坏话题 400
  const m = createMock({ delayMs: 0, now: () => new Date('2026-09-10T16:30:00') });
  type TDay = Omit<Day, 'messages'> & { thread: string | null; messages: (Msg & { thread: string })[] };
  const d0 = (await m.route('GET', '/api/kid/conversations/chinese-tutor/today')).json as TDay;
  check('today 带当前话题,消息带 thread', d0.thread === d0.messages[0].job && d0.messages[0].thread === d0.thread);
  const r1 = await m.kidSend('chinese-tutor', { text: '', via: { home: null, button: 'review' } });
  await m.settle();
  const j1 = (r1.json as { job: string; thread: string });
  const r2 = await m.kidSend('chinese-tutor', { text: '接着' });
  await m.settle();
  const r3 = await m.kidSend('chinese-tutor', { text: '回旧的', thread: d0.thread });
  await m.settle();
  const d1 = (await m.route('GET', '/api/kid/conversations/chinese-tutor/today')).json as TDay;
  check('点方砖开的新话题 = 自己的 job;缺省接当前(新)话题;指定旧话题回旧话题;today.thread = 末条的', j1.thread === j1.job && (r2.json as { thread: string }).thread === j1.thread && (r3.json as { thread: string }).thread === d0.thread && d1.thread === d0.thread && d1.messages.map((x) => x.thread).join() === [d0.thread, j1.thread, j1.thread, d0.thread].join(), JSON.stringify(d1.messages.map((x) => x.thread)));
  check('不存在的话题 400', (await m.kidSend('chinese-tutor', { text: 'x', thread: 'nope' })).status === 400);
  check('「以前的」没有了(孩子端今天的话题在首页「今天」接)', (await m.route('GET', '/api/kid/conversations/chinese-tutor/history')).status >= 400);
  const yd = (await m.route('GET', '/api/kid/conversations/chinese-tutor/2026-09-09')).json as TDay;
  check('昨天的日期路由:一节板书、thread 在;未来日期 400;别的日期空', yd.messages.length === 1 && yd.messages[0].section !== null && yd.thread === yd.messages[0].thread && (await m.route('GET', '/api/kid/conversations/chinese-tutor/2026-09-11')).status === 400 && ((await m.route('GET', '/api/kid/conversations/chinese-tutor/2026-09-01')).json as TDay).messages.length === 0);
}
// 首页按钮发来的 via:对不上 400;activity 按钮 = 按钮上的字 + 新话题;以前的 new 不认
{
  const m = createMock({ delayMs: 0, now: () => new Date('2026-09-10T16:30:00') });
  const home = ((await m.route('GET', '/api/kid/home')).json as { home: string }).home;
  const send = (tutor: string, body: unknown) => m.kidSend(tutor, body);
  type D = { messages: { job: string; thread: string; question: string | null }[] };
  const last = async (tutor: string) => { await m.settle(); const d = (await m.route('GET', `/api/kid/conversations/${tutor}/today`)).json as D; return d.messages[d.messages.length - 1]; };
  check('via:不是发布的那份 / 按钮越界 → 400', (await send('chinese-tutor', { text: '', via: { home: '2020-01-01-0000', button: 0 } })).status === 400 && (await send('chinese-tutor', { text: '', via: { home, button: 9 } })).status === 400);
  const s0 = await send('chinese-tutor', { text: '', via: { home, button: 0 } });
  const l0 = await last('chinese-tutor');
  check('activity 按钮:发的是按钮上的字,新开一个话题', s0.status === 202 && l0.question === '我要看图说话' && l0.thread === l0.job, JSON.stringify(l0));
  const s2 = await send('math-tutor', { text: '再讲一遍', via: { home, button: 'new' } });
  check('以前的新话题按钮(via new)不认', s2.status === 400);
}

// 家长板书页:mock 也起——页面能解析、板书接口答案在、第一节带给家长的尾巴、清单今天与昨天
{
  const m = createMock({ delayMs: 0, now: () => new Date('2026-09-10T16:30:00') });
  const get = (p: string) => m.route('GET', p);
  const page = (await get('/parent')).html ?? '';
  const js = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
  let parses = true;
  try { new Function(js); } catch (e) { parses = false; console.error(String(e)); }
  {
    // 家长端「首页」里的预览:孩子端页面本身,带预览标记;页面里照旧没有家长端的路径
    const pv = (await get('/preview')).html ?? '';
    let ok = true;
    try { new Function(pv.slice(pv.indexOf('<script>') + 8, pv.lastIndexOf('</script>'))); } catch (e) { ok = false; console.error(String(e)); }
    check('预览 /preview:孩子端页面带预览标记、内联脚本能解析、没有家长端的路径', pv.includes('const MODE = {"preview":true') && ok && !pv.includes('/parent'));
  }
  check('家长端 /parent:自己的一页(不是孩子端页面)、自己的 manifest、内联脚本能解析', page.includes('id="ptl"') && !page.includes('const MODE') && page.includes('/parent/manifest.webmanifest') && parses && ((await get('/parent/manifest.webmanifest')).json as { start_url: string }).start_url === '/parent');
  type PMsg = Msg & { from: string; parentText?: string; remembered?: string[] };
  const pb = (await get('/api/conversations/chinese-tutor/today/board')).json as { messages: PMsg[] };
  check('板书接口:from、第一节带给家长的尾巴与记忆', pb.messages.length === 1 && pb.messages[0].from === 'kid' && pb.messages[0].parentText?.startsWith('## 家长') === true && pb.messages[0].remembered?.length === 1, JSON.stringify(pb.messages[0].parentText));
  // 看录像:录像的纯函数内联在孩子的屏幕(/reel,孩子端页面)里;家长页只开 iframe、放录像栏;mock 按固定节奏排时刻
  const reelPage = (await get('/reel')).html ?? '';
  check('家长端:底部有录像栏、开 /reel 停在最后一帧,录像引擎(reelFrameAt / reelClock)在孩子的屏幕里不在家长页;没有板书页的「看录像」钮与旁注', reelPage.includes('function reelFrameAt(') && reelPage.includes('function reelClock(') && !page.includes('function reelFrameAt(') && !page.includes('id="reel-btn"') && !page.includes('syncNotes') && page.includes('id="rl-seek"') && page.includes("end: '1'") && !/^import /m.test(js));
  const rl = await get(`/api/conversations/chinese-tutor/today/threads/${(pb.messages[0] as PMsg & { thread: string }).thread}/reel`);
  const rj = rl.json as { reel: { tracks: unknown[]; says: unknown[]; marks: { kind: string }[]; startAt: number; endAt: number }; messages: unknown[] };
  check('mock 的录像:一节(不是实时的轮写完就铺上、不念)、有开口的点、条目一条', rl.status === 200 && rj.reel.tracks.length === 1 && rj.reel.says.length === 0 && rj.reel.marks[0].kind === 'said' && rj.messages.length === 1 && rj.reel.endAt > rj.reel.startAt, JSON.stringify(rj.reel.marks));
  check('mock 的录像:没这个话题 404', (await get('/api/conversations/chinese-tutor/today/threads/nope/reel')).status === 404);
  type Ov = { date: string; today: string; tutors: { name: string; threads: { title: string; sections: number; stoppedAt: string | null }[] }[] };
  const ov = (await get('/api/overview/today')).json as Ov;
  const oy = (await get('/api/overview/2026-09-09')).json as Ov;
  check('清单:今天三位老师,语文老师一个话题停在末句问句,英语老师没聊;昨天有以前的话题;未来 400', ov.tutors.length === 3 && ov.tutors[0].threads.length === 1 && ov.tutors[0].threads[0].stoppedAt === 'ask' && ov.tutors[0].threads[0].title.length > 0 && ov.tutors[2].threads.length === 0 && oy.date === '2026-09-09' && oy.tutors[0].threads[0].title.startsWith('昨天问的') && (await get('/api/overview/2027-01-01')).status === 400, JSON.stringify(ov.tutors[0]));

  const mw = (ov as unknown as { week: { date: string; tutors: string[] }[] }).week;
  check('清单:七天日期条,今天语文老师有话题、昨天也有', mw.length === 7 && mw[6].date === ov.today && mw[6].tutors.includes('chinese-tutor') && mw[5].tutors.includes('chinese-tutor'), JSON.stringify(mw));

  // 家长端只看(2026-10-05 删了备课与试用):没有家长发消息、交给孩子的接口;要试老师到孩子端当一回孩子,用完删话题
  check('家长端不能发消息、没有交给孩子', (await m.route('POST', '/api/conversations/chinese-tutor/messages', { text: '家长补一句' })).status === 404 && (await m.route('POST', '/api/conversations/chinese-tutor/2026-09-10/threads/x/lesson/hand', { label: 'x' })).status === 404);
  const pb2 = (await get('/api/conversations/chinese-tutor/today/board')).json as { messages: (Msg & { from: string })[] };
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
  check('删话题:删了清单上没了、孩子端 today 空;回撤销了多少(mock 没有 vault,0);再删 404', dl.status === 200 && ((await get('/api/overview/today')).json as { tutors: { threads: unknown[] }[] }).tutors[0].threads.length === 0 && ((await get('/api/kid/conversations/chinese-tutor/today')).json as Day).messages.length === 0 && (dl.json as { undo?: { memory: number } }).undo?.memory === 0 && (await m.route('DELETE', `/api/conversations/chinese-tutor/2026-09-10/threads/${th0}`)).status === 404, JSON.stringify({ dl: dl.json }));
}

done();
