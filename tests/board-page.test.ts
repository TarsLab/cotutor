/**
 * 以板为主的 activity(头上 board: page;《画板为主设计》)服务端那一半:
 * 话题第一条记 board: page;板的日志(点字一件一行、哪一轮交给了老师);每一轮上下文包的 board: 段(底、全文只给一次、孩子做的合并、最近点的);
 * 板书落到板上之前替老师把住的(照片板不写图就是这块底、一节只上一张板卡)。看图与老师都是假的,不花钱、不联网。
 */
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import { kidSend } from './_kid-send.ts';
import { FAKE_RUNTIMES, startFakeTeacher } from './_fake-teacher.ts';
import { writeKeys } from './_keys.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-board-page-')));
process.env.HOME = home;
writeKeys(home, { payg: 'sk-t' });
delete process.env.COTUTOR_WORKSPACE;

const { slateOf, drawnLine, SLATE_MAX } = await import('../src/runtime/context/board-pack.ts');
const { renderContextPack } = await import('../src/runtime/context/context-pack.ts');
const { boardPageSection } = await import('../src/board/board-page.ts');
const { parseActivity, checkActivity } = await import('../src/runtime/activity.ts');
const { readBoard } = await import('../src/runtime/journal/board-log.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
type BoardEvent = import('../src/schema/index.ts').BoardEvent;
type BoardSection = import('../src/schema/index.ts').BoardSection;
type Look = import('../src/scenes/look.ts').Look;

// ---- board: 段怎么算(纯函数) ----
{
  const T = Date.parse('2026-11-13T11:05:30Z');
  const at = (s: number): string => new Date(T - s * 1000).toISOString();
  const words = { state: 'done' as const, lesson: '我是什么', full: ['我会变。太阳一晒,我就变成汽。', '我在池子里睡觉。'] };
  const ev: BoardEvent[] = [
    { at: at(60), k: 'turn', job: '1905-1' },
    { at: at(20), k: 'pick', text: '傍', base: 'captures/a.jpg' },
    { at: at(15), k: 'pick', text: '晒', base: 'captures/a.jpg' },
    { at: at(4), k: 'pick', text: '傍', base: 'captures/a.jpg' },
    { at: at(3), k: 'pick', text: '旧', base: 'captures/old.jpg' },
  ];
  const s1 = slateOf({ photo: 'captures/a.jpg', fresh: false, words, events: ev, kit: null, ops: ['点字'], now: T });
  check('底带上认出的课名;全文第一次给全、记下 told', s1.slate.base === 'captures/a.jpg(《我是什么》)' && s1.slate.text?.length === 2 && s1.told === 'captures/a.jpg', JSON.stringify(s1));
  check('孩子做的:上一轮以后点的,合并成一句(几次写上),别的底上的不算', JSON.stringify(s1.slate.did) === '["点开看了笔顺:傍(2 次)、晒"]', JSON.stringify(s1.slate.did));
  check('最近点的:这块底上最后点的那一项,几秒前', s1.slate.recent === '傍(4 秒前)', s1.slate.recent);
  check('老师还没画:开放的是应用给的(点字),没有「你画的」', s1.slate.ops.join() === '点字' && s1.slate.drawn === undefined);
  const s2 = slateOf({ photo: 'captures/a.jpg', fresh: false, words, events: [...ev, { at: at(2), k: 'turn', job: '1905-3', told: 'captures/a.jpg' }], kit: { kit: '照片', params: { 图: 'captures/a.jpg', 圈: '412 300 470 330', 写: '' }, ops: ['点字', '圈'] }, ops: ['点字'], now: T + 40_000 });
  check('给过全文的底:写「未变」;上一轮以后没做事就没有「孩子做的」;30 秒前的不算最近', JSON.stringify(s2.slate.text) === '["未变"]' && !s2.told && s2.slate.did.length === 0 && s2.slate.recent === undefined, JSON.stringify(s2));
  check('你画的:画法加写了的参数(图就是底,不重复);开放的照那张板卡', s2.slate.drawn === '照片:圈 412 300 470 330' && s2.slate.ops.join() === '点字,圈');
  check('这一轮刚发的照片:全文不写(图随这一轮附上);还在认写「还在认」', slateOf({ photo: 'captures/a.jpg', fresh: true, words, events: [], kit: null, ops: [], now: T }).slate.text === undefined && JSON.stringify(slateOf({ photo: 'captures/a.jpg', fresh: false, words: { ...words, state: 'running' }, events: [], kit: null, ops: [], now: T }).slate.text) === '["还在认"]');
  check('白板:底写「白板」', slateOf({ photo: null, fresh: false, words: null, events: [], kit: null, ops: [], now: T }).slate.base === '白板');
  const long = slateOf({ photo: 'captures/a.jpg', fresh: false, words: { ...words, full: Array.from({ length: 40 }, (_, i) => `第${i}行课文课文课文课文课文课文`) }, events: [], kit: null, ops: [], now: T });
  check(`全文太长先截:整段不过 ${SLATE_MAX} 字,截掉的说一句`, JSON.stringify(long.slate).length <= SLATE_MAX + 40 && /后面还有 \d+ 行/.test(long.slate.text!.slice(-1)[0]), String(JSON.stringify(long.slate).length));
  check('写在照片下面的字说成那一行', drawnLine({ kit: '照片', params: { 图: 'a.jpg', 写: '傍晚|' }, ops: [] }) === '照片:写 傍晚' && drawnLine({ kit: '白板', params: { 写: '' }, ops: [] }) === '白板');
  const pack = renderContextPack({ at: '2026-11-13T19:05', plan: [], recent: [], slate: s1.slate });
  check('上下文包里是 board: 一段,中文的键,全文一行一项', pack.includes('\n  board:\n    底: "captures/a.jpg(《我是什么》)"\n    全文:\n      - "我会变。') && pack.includes('\n    开放: "点字"\n    孩子做的:\n      - "点开看了笔顺:傍(2 次)、晒"\n    最近点的: "傍(4 秒前)"'), pack);
  check('board: off 的老师不带', !renderContextPack({ at: 'x', plan: [], recent: [], board: 'off', slate: s1.slate }).includes('底:'));
}

// ---- 板书落到板上之前:照片板补上底、一节只上一张板卡 ----
{
  const line = (text: string, anchor: number | null, card?: number): BoardSection['lines'][number] => ({ text, audio: null, marks: card === undefined ? [] : [{ card, phrase: 'x' }], ask: false, anchor, cues: [] });
  const sec: BoardSection = {
    cards: [
      { kind: 'text', props: { text: '傍晚' } },
      { kind: 'kit', props: { kit: '照片', params: { 图: '' }, ops: ['点字'] } },
      { kind: 'kit', props: { kit: '白板', params: { 写: '傍晚' }, ops: ['圈'] } },
    ],
    lines: [line('a', 0, 0), line('b', 1), line('c', 2, 2)],
  };
  const page = boardPageSection(sec, { page: true, photo: 'captures/a.jpg' });
  check('以板为主:一节只认最后一张板卡,别的撤掉;讲稿里的锚与敲黑板跟着重排', page.section.cards.length === 1 && page.section.cards[0].props.kit === '白板' && page.dropped.length === 2 && JSON.stringify(page.section.lines.map((l) => [l.anchor, l.marks.map((m) => m.card)])) === '[[null,[]],[null,[]],[0,[0]]]', JSON.stringify(page.section.lines));
  const free = boardPageSection(sec, { page: false, photo: 'captures/a.jpg' });
  check('不是以板为主:卡都在;照片板没写图,补上这块底', free.section.cards.length === 3 && (free.section.cards[1].props.params as Record<string, string>)['图'] === 'captures/a.jpg' && free.dropped.length === 0);
  const none = boardPageSection(sec, { page: false, photo: null });
  check('还没有底的照片板画不出来:撤掉', none.section.cards.length === 2 && none.dropped[0].props.kit === '照片');
  check('没什么要改的:原样回', boardPageSection({ cards: [sec.cards[0]], lines: [] }, { page: false, photo: null }).section.cards[0] === sec.cards[0]);
}

// ---- activity 头上的 board ----
{
  const file = (head: string): string => `---\nname: 试\ndescription: 试\n${head}\n---\n\n## 老师怎么带\n\n你是老师。\n第一句: 好。\n收: 好。\n`;
  const issues = (head: string): string[] => checkActivity(parseActivity(file(head)).activity).filter((i) => i.level === 'fix').map((i) => i.text);
  check('board: page 读得出', parseActivity(file('board: page\ncards: kit')).activity.board === 'page' && !issues('board: page\ncards: kit').length, JSON.stringify(issues('board: page\ncards: kit')));
  check('board 写了不认得的、没有 kit、和 page 一起写:都要改', issues('board: 板\ncards: kit').some((t) => t.includes('不认得')) && issues('board: page\ncards: text').some((t) => t.includes('要有 kit')) && issues('board: page\npage: dictation\ncards: kit').some((t) => t.includes('只能写一个')));
}

// ---- 全流程:点「预习」拍了照 → 话题以板为主、board: 段 → 点字记进日志、嘴要念的 → 下一轮老师看到他点了什么 ----
{
  const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
  const LINES = [
    '{"lesson": "我是什么"}',
    '{"text": "变", "kind": "char", "pick": true, "box": [237, 233, 281, 267], "sure": true, "say": "变,变化的变"}',
    '{"text": "晒", "kind": "read", "pick": false, "box": [323, 102, 360, 125], "sure": true, "say": "晒,晒太阳"}',
    '{"full": "我会变。太阳一晒,我就变成汽。", "box": [216, 202, 912, 228]}',
  ];
  const look: Look = async (o) => { o.onDelta?.(`${LINES.join('\n')}\n`); return { ok: true, text: LINES.join('\n'), ms: 5 }; };
  const teacher = await startFakeTeacher();
  process.env.COTUTOR_BRAIN_ENDPOINT = teacher.baseURL;
  const { root } = await initWorkspace({ slug: 'slate', name: '小板', dir: join(home, 'ws-slate') });
  const cfgFile = join(root, 'cotutor.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as { runtimes: unknown; tutors: Record<string, { runtime?: string }> };
  cfg.runtimes = { ...FAKE_RUNTIMES };
  for (const t of Object.values(cfg.tutors)) delete t.runtime;
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  let now = new Date(2026, 10, 13, 19, 5);
  const ctx = createContext(loadWorkspace(root), { now: () => now, look });
  const T = 'chinese-tutor';
  const date = '2026-11-13';
  const wait = async (): Promise<void> => { for (let i = 0; i < 200 && ctx.runner.running(T); i++) await new Promise((r) => setTimeout(r, 25)); await ctx.runner.flush(); };
  const promptOf = (job: string): string => (JSON.parse(readFileSync(join(root, 'conversations', T, `${date}.${job}.run.json`), 'utf8')) as { prompt: string }).prompt;
  const index = (): { messages: { job: string; board?: string; section?: BoardSection; warnings?: string[] }[] } => JSON.parse(readFileSync(join(root, 'conversations', T, `${date}.json`), 'utf8'));

  const h = (await route('GET', '/api/kid/home', ctx)).json as { home: string | null; cards: { kind: string; props: { tutor?: string; tiles?: { id: string; board?: string }[] } }[] };
  const tile = h.cards.find((c) => c.props.tutor === T)?.props.tiles?.find((x) => x.id === 'preview');
  check('首页的「预习」方砖说它以板为主(孩子端点了先到拍照屏)', tile?.board === 'page', JSON.stringify(tile));
  const p1 = ((await route('POST', `/api/kid/conversations/${T}/photos`, ctx, { image: `data:image/jpeg;base64,${JPG.toString('base64')}` })).json as { path: string }).path;
  const first = await kidSend(ctx, T, { text: '', via: { home: h.home, button: 'preview' }, photos: [p1] });
  await wait();
  const job1 = String(first.json.job);
  const thread = String(first.json.thread);
  const m1 = index().messages.find((m) => m.job === job1);
  check('点方砖带着照片进来:话题第一条记 board: page', first.status === 202 && m1?.board === 'page', JSON.stringify(first));
  const pr1 = promptOf(job1);
  check('第一轮的 board::底是这张、点字开着;全文还没认(照片随这一轮附上)', pr1.includes(`\n  board:\n    底: "${p1}"\n    开放: "点字"\n`) && !pr1.includes('全文'), pr1.slice(pr1.indexOf('board:'), pr1.indexOf('board:') + 120));
  check("假老师看图回了 image、canvas 卡:以板为主不给孩子看,家长端记一行", (m1?.section?.cards.length ?? 0) === 0 && (m1?.warnings ?? []).some((w) => w.includes("以板为主")), JSON.stringify(m1));

  // 点字:记进日志,回嘴要念的
  now = new Date(2026, 10, 13, 19, 6);
  const say1 = await ctx.runner.boardEvent(T, date, { k: 'pick', thread, text: '晒', base: p1 });
  const say2 = await ctx.runner.boardEvent(T, date, { k: 'pick', thread, text: '晒', base: p1 });
  const say3 = await ctx.runner.boardEvent(T, date, { k: 'pick', thread, text: '我', base: p1 });
  check('点字:嘴念认字时写好的念法;正文里没挑出来的字念它自己', say1?.say === '晒,晒太阳' && say2?.thread === thread && say3?.say === '我', JSON.stringify([say1, say3]));
  const bad = [
    await ctx.runner.boardEvent(T, date, { k: 'pick', thread: '1111-1', text: '晒', base: p1 }),
    await ctx.runner.boardEvent(T, date, { k: 'pick', thread, text: 'abc', base: p1 }),
    await ctx.runner.boardEvent(T, date, { k: 'pick', thread, text: '晒', base: 'cotutor.json' }),
    await ctx.runner.boardEvent(T, date, { k: 'drag', thread }),
  ];
  check('不对的不记:不是今天的话题、不是汉字、底不在 captures/、不认得的事', bad.every((x) => x === null));
  const log1 = await readBoard(loadWorkspace(root), T, date, thread);
  check('板的日志:第一轮交给老师一行,三下点字各一行', log1.map((e) => e.k).join() === 'turn,pick,pick,pick', JSON.stringify(log1));

  // 第二轮:孩子说「这个是什么意思」
  now = new Date(2026, 10, 13, 19, 6, 5);
  const second = await kidSend(ctx, T, { text: '这个是什么意思', thread });
  await wait();
  const pr2 = promptOf(String(second.json.job));
  check('第二轮的 board::课名、全文给全、他点了什么(合并)、最近点的', pr2.includes('底: "' + p1 + '(《我是什么》)"') && pr2.includes('全文: "我会变。太阳一晒,我就变成汽。"') && pr2.includes('点开看了笔顺:晒(2 次)、我') && pr2.includes('最近点的: "我(5 秒前)"'), pr2.slice(pr2.indexOf('board:'), pr2.indexOf('board:') + 260));
  // 第三轮:全文未变;没点就没有「孩子做的」
  now = new Date(2026, 10, 13, 19, 8);
  const third = await kidSend(ctx, T, { text: '好的', thread });
  await wait();
  const pr3 = promptOf(String(third.json.job));
  check('第三轮:全文写「未变」,上一轮以后没点就不写孩子做的、最近点的', pr3.includes('全文: "未变"') && !pr3.includes('孩子做的') && !pr3.includes('最近点的'), pr3.slice(pr3.indexOf('board:'), pr3.indexOf('board:') + 200));
  const log3 = await readBoard(loadWorkspace(root), T, date, thread);
  check('给过全文的那一轮在日志里记了 told', log3.filter((e) => e.k === 'turn').length === 3 && log3.some((e) => e.k === 'turn' && e.told === p1));

  // 别的话题:没有 board
  const free = await kidSend(ctx, T, { text: '你好', newThread: true });
  await wait();
  check('不从以板为主的 activity 进来的话题:不记 board、上下文包没有 board:', !index().messages.find((m) => m.job === free.json.job)?.board && !promptOf(String(free.json.job)).includes('\n  board:'));
  check('点字只认以板为主的话题', (await ctx.runner.boardEvent(T, date, { k: 'pick', thread: String(free.json.thread), text: '晒', base: p1 })) === null);
  await teacher.close();
}

done();
