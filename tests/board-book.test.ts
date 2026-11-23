/**
 * 课本做底(语文、数学的「课本」,activity 头上 base: textbook)服务端那一半:
 * 讲稿里的动作落到页上(src/board/lesson-fit.ts,翻、看、圈换成框);板此刻的样子里的课本(board-pack 的 bookSlateParts);
 * 全流程:还没放课本时不出方砖 → 放了以后点「课本」方砖(不拍照)→ 底是目录 → 老师翻到一课、看第 1 段再看第 2 段 → 孩子挪窗、点字记进日志 → 下一轮老师看到他在看哪里。
 * 书用 tests/_book.ts 造的那本;PDF 是个假文件,它的指纹对上一份事先写好的索引缓存(读 PDF 的那一层走 scripts/probe-book.mjs)。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bookIndexOf } from './_book.ts';
import { mathIndexOf } from './_math-book.ts';
import { check, done } from './_check.ts';
import { kidSend } from './_kid-send.ts';
import { FAKE_RUNTIMES, startFakeTeacher } from './_fake-teacher.ts';
import { writeKeys } from './_keys.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-board-book-')));
process.env.HOME = home;
writeKeys(home, { payg: 'sk-t' });
delete process.env.COTUTOR_WORKSPACE;

const { bookLesson, fitSection, lessonOpen } = await import('../src/board/lesson-fit.ts');
const { bookSlateParts, lessonSlateBits, slateOf } = await import('../src/runtime/context/board-pack.ts');
const { renderContextPack } = await import('../src/runtime/context/context-pack.ts');
const { parseActivity, checkActivity } = await import('../src/runtime/activity.ts');
const { readBoard } = await import('../src/runtime/journal/board-log.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
const { lessonInit, lessonPage } = await import('../src/board/lesson.ts');
type Lesson = import('../src/schema/index.ts').Lesson;
type BoardSection = import('../src/schema/index.ts').BoardSection;

const ix = bookIndexOf();

// ---- 铺着页的一节:讲稿里的动作落到页上(纯函数) ----
{
  const b = { file: '语文一年级下册.pdf', index: ix };
  const raw = { section: { lines: [{ text: '我们来预习。', ask: false, acts: [{ name: '翻', arg: '小鱼吹泡泡' }, { name: '看', arg: '第 1 段' }] }, { text: '再看第二段。', ask: false, acts: [{ name: '看', arg: '第 2 段' }, { name: '圈', arg: '井沿、没有这个词' }] }] } as BoardSection };
  const fit = fitSection(raw.section, lessonOpen(lessonInit(), b), { book: b });
  check('落到页上:翻到这一课、看换成框;圈找得到的那一处,找不到的记一句', fit.section.lines[0].acts?.[0].do?.k === '翻' && (fit.section.lines[0].acts[1].do as { label: string }).label === '第1段' && (fit.section.lines[1].acts?.[1].do as { spots: unknown[] }).spots.length === 1 && fit.why.length === 1 && fit.why[0].includes('没有这个词'), JSON.stringify([fit.section, fit.why]));
  check('一课、目录铺哪几页', bookLesson(ix, '古诗两首')?.pages.map((p) => p.n).join() === '4,5' && bookLesson(ix, null)?.title === '目录' && bookLesson(ix, '没有') === null);
}

// ---- board: 里的课本 ----
{
  const fish = bookSlateParts(ix, bookLesson(ix, '小鱼吹泡泡')!);
  check('一课:底是册名、课名、印的页码;全文一段一行,换页插一行,认字栏带读音', fish.show === '课本《语文一年级下册》:《小鱼吹泡泡》第 1–2 页' && fish.text[0] === '第1段 小鱼在水里吹泡泡。' && fish.text.includes('—— 第 2 页 ——') && fish.text.some((t) => t.startsWith('泡(pào)')), JSON.stringify(fish));
  const toc = bookSlateParts(ix, bookLesson(ix, null)!);
  check('目录:一单元一行,课名后面是印的页码;下面的一首带点', toc.show.includes('目录') && toc.text[0] === '第一单元·阅读:1 小鱼吹泡泡(1)、2 古诗两首(3)、·静夜思(3)、·春晓(4)、语文园地一(5)' && toc.text[1] === '附录:识字表(8)', JSON.stringify(toc.text));
  const garden = bookSlateParts(ix, bookLesson(ix, '语文园地一')!);
  check('语文园地:一个栏目一行', garden.text.filter((t) => t.startsWith('【')).length === 3 && garden.text.some((t) => t.startsWith('【日积月累】')), JSON.stringify(garden.text));
  const T = Date.parse('2026-11-14T10:00:00Z');
  const at = (s: number): string => new Date(T - s * 1000).toISOString();
  const key = '语文一年级下册.pdf#小鱼吹泡泡';
  const bits = lessonSlateBits(lessonInit());
  {
    // 你画的不说圈、划、加点:页上还有的都是上一轮的,老师这一轮一开口就收;遮、盖留到揭开,照说
    const { lessonStep } = await import('../src/board/lesson.ts');
    const { whitePage } = await import('../src/board/lesson-fit.ts');
    const spot = (text: string) => [{ text, box: [10, 10, 60, 40] as [number, number, number, number] }];
    let l = lessonStep(lessonInit(), { t: 'act', act: { k: '翻', page: whitePage() } });
    for (const k of ['圈', '划', '加点', '盖'] as const) l = lessonStep(l, { t: 'act', act: { k, spots: spot(`${k}的字`) } });
    const drawn = lessonSlateBits(l).drawn ?? '';
    check('你画的:不说圈、划、加点,盖照说', drawn.includes('盖 盖的字') && !/圈|划|加点/.test(drawn), drawn);
  }
  const s1 = slateOf({ page: { id: key, show: fish.show }, others: ['作业照片(1 张)'], events: [{ at: at(60), k: 'turn', job: '1000-1' }, { at: at(30), k: 'pick', text: '泡', base: key }, { at: at(20), k: 'view', text: '第 1 页:第 1–2 段', base: key }, { at: at(5), k: 'view', text: '第 2 页:课文后面的部分', base: key }], lesson: bits, now: T });
  check('board::底是这一页;页集说还铺过哪些;孩子在看是上一轮以后最后停下的地方;页上的字不在这里', s1.base === fish.show && s1.pages === '还铺过:作业照片(1 张)(翻回去写 [[翻 …]])' && s1.view === '第 2 页:课文后面的部分' && s1.did.join() === '点开看了笔顺:泡' && !('text' in s1), JSON.stringify(s1));
  const s2 = slateOf({ page: { id: key, show: fish.show }, others: [], events: [{ at: at(60), k: 'turn', job: '1000-1', told: [key] }, { at: at(50), k: 'view', text: '第 1 页', base: key }, { at: at(40), k: 'turn', job: '1000-2' }], lesson: bits, now: T });
  check('上一轮之前挪的不算「孩子在看」;只铺过这一页不写页集', s2.view === undefined && s2.pages === undefined, JSON.stringify(s2));
  const pack = renderContextPack({ at: '2026-11-14T10:00', plan: [], recent: [], slate: s1, pageNotes: [{ id: key, name: '《小鱼吹泡泡》', text: fish.text }] });
  check('上下文包里多一行「孩子在看」;页上的字是一条 <page> 笔记', pack.includes('    孩子在看: "第 2 页:课文后面的部分"') && pack.includes(`<page id="${key}" name="《小鱼吹泡泡》">\n第1段 小鱼在水里吹泡泡。`), pack.slice(pack.indexOf('board:')));
}

// ---- activity 头上的 base ----
{
  const file = (head: string): string => `---\nname: 试\ndescription: 试\n${head}\n---\n\n## 老师怎么带\n\n你是老师。\n第一句: 好。\n收: 好。\n`;
  const issues = (head: string, level = 'fix'): string[] => checkActivity(parseActivity(file(head)).activity).filter((i) => i.level === level).map((i) => i.text);
  check('base: textbook、base: photo 读得出', parseActivity(file('base: textbook')).activity.base === 'textbook' && parseActivity(file('base: photo')).activity.base === 'photo' && !issues('base: textbook').length && !issues('base: photo').length);
  check('base 写了不认得的:要改', issues('base: 课本').some((t) => t.includes('不认得')));
  const old = parseActivity(file('board: page\ncards: kit')).activity;
  check('旧的头还认:board: page 没写 base 的当 base: photo,cards 读进来就丢;check 提一句(不算要改)', old.base === 'photo' && !('cards' in old) && !issues('board: page\ncards: kit').length && issues('board: page\ncards: kit', 'note').some((t) => t.includes('不用再写了') && t.includes('base: photo')), JSON.stringify(old));
  check('旧的 board: page + base: textbook:照 base: textbook', parseActivity(file('board: page\nbase: textbook')).activity.base === 'textbook');
  check('reply: mouth 读得出;写错要改', parseActivity(file('base: photo\nreply: mouth')).activity.reply === 'mouth' && !issues('reply: mouth').length && issues('reply: 嘴').some((t) => t.includes('不认得')));
  check('listen: open 读得出;写错要改', parseActivity(file('base: photo\nlisten: open')).activity.listen === 'open' && !issues('listen: open').length && issues('listen: 一直').some((t) => t.includes('不认得')));
}

// ---- 全流程 ----
{
  const teacher = await startFakeTeacher();
  process.env.COTUTOR_BRAIN_ENDPOINT = teacher.baseURL;
  const { root } = await initWorkspace({ slug: 'book', name: '小书', dir: join(home, 'ws-book') });
  const cfgFile = join(root, 'cotutor.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as { runtimes: unknown; tutors: Record<string, { runtime?: string }> };
  cfg.runtimes = { ...FAKE_RUNTIMES };
  for (const t of Object.values(cfg.tutors)) delete t.runtime;
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  let now = new Date(2026, 10, 14, 10, 0);
  const ctx = createContext(loadWorkspace(root), { now: () => now });
  const T = 'chinese-tutor';
  const date = '2026-11-14';
  const wait = async (): Promise<void> => { for (let i = 0; i < 200 && ctx.runner.running(T); i++) await new Promise((r) => setTimeout(r, 25)); await ctx.runner.flush(); };
  const promptOf = (job: string): string => (JSON.parse(readFileSync(join(root, 'conversations', T, `${date}.${job}.run.json`), 'utf8')) as { prompt: string }).prompt;
  const index = (): { messages: { job: string; base?: string; section?: BoardSection; warnings?: string[] }[] } => JSON.parse(readFileSync(join(root, 'conversations', T, `${date}.json`), 'utf8'));
  const ws = loadWorkspace(root);

  const h = (await route('GET', '/api/kid/home', ctx)).json as { home: string | null; cards: { kind: string; props: { tutor?: string; tiles?: { id: string; base?: string }[] } }[] };
  check('还没放课本:语文、数学的牌上都不出「课本」,点了 400', h.cards.every((c) => !c.props.tiles?.some((x) => x.id === 'textbook')) && (await kidSend(ctx, T, { text: '', via: { home: h.home, button: 'textbook' } })).status === 400, JSON.stringify(h.cards.map((c) => c.props.tiles)));
  const parentTile = ((await route('GET', '/api/parent/home', ctx)).json as { tutors: { name: string; tiles: { id: string; noBook?: string }[] }[] }).tutors.find((t) => t.name === T)?.tiles.find((x) => x.id === 'textbook');
  check('家长端那块说去哪下载、放哪', Boolean(parentTile?.noBook?.includes('教材/') && parentTile.noBook.includes('语文')), JSON.stringify(parentTile));

  // 话题里课本不在了(终端 send、进来以后家长挪走了):老师的底说没有,家长端记一行
  const none = await ctx.runner.send(T, { from: 'kid', text: '我想看课本', newThread: true, activity: { name: '课本', params: {} } });
  await wait();
  const pr0 = promptOf(String(none.job));
  check('教材文件夹里没有课本 PDF:底说没有、请家长放;家长端记一行', pr0.includes('底: "课本:教材文件夹里没有语文的课本 PDF(请家长放进 vault 的教材文件夹)"') && (index().messages.find((m) => m.job === none.job)?.warnings ?? []).some((w) => w.includes('没有语文的课本')), pr0.slice(pr0.indexOf('board:'), pr0.indexOf('board:') + 160));

  // 放一本:假 PDF + 对得上指纹的索引缓存
  const pdf = Buffer.from('%PDF-1.4 假的,只为算指纹\n');
  mkdirSync(ws.paths.textbooks, { recursive: true });
  writeFileSync(join(ws.paths.textbooks, '语文一年级下册.pdf'), pdf);
  writeFileSync(join(ws.paths.textbooks, '数学一年级下册.pdf'), pdf);
  const sha = createHash('sha1').update(pdf).digest('hex').slice(0, 16);
  mkdirSync(join(root, '.cotutor', 'textbooks'), { recursive: true });
  writeFileSync(join(root, '.cotutor', 'textbooks', `${sha}.json`), JSON.stringify({ ...ix, sha }));

  now = new Date(2026, 10, 14, 10, 5);
  const tile = ((await route('GET', '/api/kid/home', ctx)).json as typeof h).cards.find((c) => c.props.tutor === T)?.props.tiles?.find((x) => x.id === 'textbook');
  check('放了课本:首页的语文「课本」方砖出来,铺课本(孩子端不到拍照屏)', tile?.base === 'textbook', JSON.stringify(tile));
  const first = await kidSend(ctx, T, { text: '', via: { home: h.home, button: 'textbook' } });
  await wait();
  const job1 = String(first.json.job);
  const thread = String(first.json.thread);
  const pr1 = promptOf(job1);
  check('点方砖进来(不拍照):话题记 base: textbook;底是目录,目录的字是一条 <page>(一单元一行)', index().messages.find((m) => m.job === job1)?.base === 'textbook' && pr1.includes('底: "课本《语文一年级下册》:目录(还没翻到哪一课)"') && pr1.includes('<page id="语文一年级下册.pdf#目录" name="目录">\n第一单元·阅读:1 小鱼吹泡泡(1)'), pr1.slice(pr1.indexOf('board:'), pr1.indexOf('board:') + 200));

  now = new Date(2026, 10, 14, 10, 6);
  const second = await kidSend(ctx, T, { text: '我要预习小鱼', thread });
  await wait();
  const job2 = String(second.json.job);
  const m2 = index().messages.find((m) => m.job === job2);
  const s2 = m2?.section;
  const l2 = ((await route('GET', `/api/kid/lesson?tutor=${T}&date=${date}&thread=${thread}`, ctx)).json as { lesson: Lesson }).lesson;
  check('老师写的动作落到页上:第一句念完翻、看第 1 段;第二句念完看第 2 段、圈、请圈', s2 !== undefined && s2.lines[0].acts?.map((a) => a.do?.k).join() === '翻,看' && s2.lines[1].acts?.map((a) => a.do?.k).join() === '看,圈,请', JSON.stringify(s2));
  check('一节课的状态:这一课、看着第 2 段、圈着井沿', l2.at === '语文一年级下册.pdf#小鱼吹泡泡' && l2.look?.label === '第2段' && lessonPage(l2)!.teacher.marks.map((m) => m.text).join() === '井沿', JSON.stringify(l2));
  check('圈的词课本里没有:家长端记一行', (m2?.warnings ?? []).some((w) => w.includes('没有这个词')), JSON.stringify(m2?.warnings));
  check('翻到这一课以前的那一轮:给了目录的字(记了 told)', (await readBoard(ws, T, date, thread)).some((e) => e.k === 'turn' && [e.told].flat().includes('语文一年级下册.pdf#目录')));

  // 孩子在板上:点字(嘴念这个字)、挪窗(记成一句、不念、不催)
  const base = '语文一年级下册.pdf#小鱼吹泡泡';
  const pick = await ctx.runner.boardEvent(T, date, { k: 'pick', thread, text: '泡', base });
  const view = await ctx.runner.boardEvent(T, date, { k: 'view', thread, base, box: [0, 1385, 1000, 1985] });
  check('点字:嘴念这个字;挪窗:不念、不起「替他叫老师」', pick?.say === '泡' && view?.say === null && view?.still === false, JSON.stringify([pick, view]));
  const bad = await Promise.all([
    ctx.runner.boardEvent(T, date, { k: 'view', thread, base, box: [0, 1] }),
    ctx.runner.boardEvent(T, date, { k: 'view', thread, base: '没有.pdf#小鱼吹泡泡', box: [0, 0, 1, 1] }),
    ctx.runner.boardEvent(T, date, { k: 'view', thread, base: 'captures/a.jpg', box: [0, 0, 1, 1] }),
    ctx.runner.boardEvent(T, date, { k: 'pick', thread, text: '泡', base: '../x.pdf#小鱼吹泡泡' }),
  ]);
  check('不对的不记:框不是四个数、不是现在这一页(别的册子、照片、越界的册名)', bad.every((x) => x === null), JSON.stringify(bad));
  const log = await readBoard(ws, T, date, thread);
  const v = log.find((e) => e.k === 'view');
  check('挪窗记成一句:哪一页、看得见什么', v?.k === 'view' && v.text === '第 2 页:第 2–3 段', JSON.stringify(v));

  // 课本的田字格里写好了一个字(放好):落进孩子的一层、记进板的日志;不对的不收
  const cell = await ctx.runner.boardEvent(T, date, { k: 'cell', thread, base, id: '2.0', strokes: [[[100, 120], [880, 900]], [[500, 80], [500, 950]]], text: '泡' });
  const badCells = await Promise.all([
    ctx.runner.boardEvent(T, date, { k: 'cell', thread, base, id: '../2', strokes: [] }),
    ctx.runner.boardEvent(T, date, { k: 'cell', thread, base, id: '2.1', strokes: [[[100, 5000]]] }),
    ctx.runner.boardEvent(T, date, { k: 'cell', thread, base, id: '2.1', strokes: 'x' }),
  ]);
  const lCell = ((await route('GET', `/api/kid/lesson?tutor=${T}&date=${date}&thread=${thread}`, ctx)).json as { lesson: Lesson }).lesson;
  const cellLog = (await readBoard(ws, T, date, thread)).filter((e) => e.k === 'cell');
  check('田字格里写好了:状态里这一格两笔,日志记照着哪个字写的;老师请着用笔(上一轮请了圈)就替他交', cell?.say === null && cell.asked === true && lessonPage(lCell)!.kid.cells?.['2.0']?.length === 2 && cellLog.length === 1 && cellLog[0].k === 'cell' && cellLog[0].text === '泡', JSON.stringify([cell, lessonPage(lCell)!.kid.cells, cellLog]));
  check('田字格:id 不对、坐标出格、笔画不是数组都不收', badCells.every((x) => x === null), JSON.stringify(badCells));
  // 点读了两回:从标题读到第 2 段停了;第 3 段读到了最后。不叫老师,下一轮老师在「孩子做的」里看到
  const read1 = await ctx.runner.boardEvent(T, date, { k: 'read', thread, base, from: 0, to: 2 });
  const read2 = await ctx.runner.boardEvent(T, date, { k: 'read', thread, base, from: 3, to: 3, done: true });
  const badReads = await Promise.all([
    ctx.runner.boardEvent(T, date, { k: 'read', thread, base, from: -1, to: 2 }),
    ctx.runner.boardEvent(T, date, { k: 'read', thread, base, from: 0, to: 1.5 }),
    ctx.runner.boardEvent(T, date, { k: 'read', thread, base: '语文一年级下册.pdf#目录', from: 0, to: 1 }),
  ]);
  check('点读了一回:记一笔,不念、不叫老师;号不对、不是现在这一页的不收', read1?.say === null && read1.still === false && read2?.still === false && badReads.every((x) => x === null) && (await readBoard(ws, T, date, thread)).filter((e) => e.k === 'read').length === 2, JSON.stringify([read1, read2, badReads]));
  now = new Date(2026, 10, 14, 10, 6, 20);
  const third = await kidSend(ctx, T, { text: '这个字怎么读', thread });
  await wait();
  const pr3 = promptOf(String(third.json.job));
  check('下一轮:孩子做的里说他点读了哪几段、在哪停的', pr3.includes('自己点了课文听(点读的配音):从标题读到第 2 段,在第 2 段停了') && pr3.includes('自己点了课文听(点读的配音):读了第 3 段,读完了全文'), pr3.slice(pr3.indexOf('board:'), pr3.indexOf('board:') + 700));
  check('下一轮:孩子做的里说他在田字格里写了几个、照着哪个字', pr3.includes('在田字格里写了 1 个字(照着「泡」写的),写成什么样看图'), pr3.slice(pr3.indexOf('board:'), pr3.indexOf('board:') + 500));
  check('下一轮:底是这一课,这一课的字分好段(第一次看到,给一条 <page>);他点了什么、最近点的、他在看哪里', pr3.includes('底: "课本《语文一年级下册》:《小鱼吹泡泡》第 1–2 页"') && pr3.includes('第1段 小鱼在水里吹泡泡。') && pr3.includes('点开看了笔顺:泡') && pr3.includes('孩子在看: "第 2 页:第 2–3 段"'), pr3.slice(pr3.indexOf('board:'), pr3.indexOf('board:') + 400));
  now = new Date(2026, 10, 14, 10, 8);
  const fourth = await kidSend(ctx, T, { text: '不存在的课', thread });
  await wait();
  const pr4 = promptOf(String(fourth.json.job));
  const m4 = index().messages.find((m) => m.job === fourth.json.job);
  const l4 = ((await route('GET', `/api/kid/lesson?tutor=${T}&date=${date}&thread=${thread}`, ctx)).json as { lesson: Lesson }).lesson;
  check('再下一轮:这一课的字不重给;翻不到的课还在这一课,家长端记一行', !pr4.includes('<page ') && l4.at === '语文一年级下册.pdf#小鱼吹泡泡' && (m4?.warnings ?? []).some((w) => w.includes('坐井观天')), JSON.stringify(m4?.warnings));
  // 孩子在课本上点了、揭了、挪了:一节课的状态里也有
  check('点字、挪窗也落进一节课的状态', lessonPage(l4)!.kid.picked.join() === '泡' && JSON.stringify(l4.view) === '[0,1385,1000,1985]', JSON.stringify(l4));

  // 孩子端取课本:PDF(能分段取)、几页的行和字
  const got = await route('GET', `/api/kid/textbook/pdf?b=${encodeURIComponent('语文一年级下册.pdf')}`, ctx);
  const lines = (await route('GET', `/api/kid/textbook/lines?b=${encodeURIComponent('语文一年级下册.pdf')}&p=2-3`, ctx)).json as { pages: { n: number; lines: { text: string }[] }[] };
  check('孩子端取课本:PDF 给文件;几页的行和字只给要的那几页', got.status === 200 && got.contentType === 'application/pdf' && Boolean(got.file?.endsWith('语文一年级下册.pdf')) && lines.pages.map((p) => p.n).join() === '2,3' && lines.pages[0].lines.some((l) => l.text === '小鱼在水里吹泡泡。'));
  const base0 = (await route('GET', `/api/kid/textbook/base?tutor=${T}`, ctx)).json as { lesson: Lesson | null; toc: { page: { kind: string; title: string; pages: number[]; src: string; pick: boolean } } | null };
  const at0 = base0.lesson ? lessonPage(base0.lesson) : null;
  const toc0 = base0.toc?.page;
  check('课本话题刚开:老师翻到过《小鱼吹泡泡》,孩子端要来的就是那一课;目录也一起给(这一科这学期那一册、目录那几页、能点字)', at0?.title === '小鱼吹泡泡' && toc0?.kind === 'book' && toc0.title === '目录' && toc0.pages.join() === '1' && toc0.src === '语文一年级下册.pdf' && toc0.pick === true, JSON.stringify(base0));
  check('英语老师没有课本:lesson 是 null;没有这位老师 404', ((await route('GET', '/api/kid/textbook/base?tutor=english-tutor', ctx)).json as { lesson: unknown }).lesson === null && (await route('GET', '/api/kid/textbook/base?tutor=nobody', ctx)).status === 404);
  check('一节课的状态:老师、日期、话题不对的 404;没有的 lesson 是 null', (await route('GET', `/api/kid/lesson?tutor=nobody&date=${date}&thread=${thread}`, ctx)).status === 404 && (await route('GET', `/api/kid/lesson?tutor=${T}&date=x&thread=${thread}`, ctx)).status === 404 && ((await route('GET', `/api/kid/lesson?tutor=${T}&date=${date}&thread=0000-9`, ctx)).json as { lesson: unknown }).lesson === null);
  const nf = await Promise.all([route('GET', `/api/kid/textbook/pdf?b=${encodeURIComponent('../cotutor.json')}`, ctx), route('GET', '/api/kid/textbook/pdf?b=x.pdf', ctx), route('GET', `/api/kid/textbook/lines?b=${encodeURIComponent('语文一年级下册.pdf')}&p=x`, ctx)]);
  check('越界、不在、页写错:404', nf.every((r) => r.status === 404));
  // 点读:第 k 块第 s 句的声音,字由服务端照课本取,用这位老师点读的声音合成(假配音)
  const { startFakeTts } = await import('./_fake-tts.ts');
  const tts = await startFakeTts();
  process.env.COTUTOR_TTS_ENDPOINT = tts.url;
  const say = (q: string) => route('GET', `/api/kid/textbook/say?tutor=${T}&b=${encodeURIComponent('语文一年级下册.pdf')}&${q}`, ctx);
  const s0 = await say('p=2-3&k=2&s=1'), sAgain = await say('p=2-3&k=2&s=1');
  check('点读:第 2 段第 2 句照课本合成(语文老师出厂的点读声音);同一句再要不再合成', s0.status === 200 && s0.contentType === 'audio/mpeg' && readFileSync(s0.file!, 'utf8').endsWith(':泡泡飞呀飞，飞进了井沿边的小花园。”') && sAgain.file === s0.file && tts.requests.length === 1, JSON.stringify([s0, tts.requests]));
  const sBad = await Promise.all([say('p=2-3&k=9&s=0'), say('p=2-3&k=1&s=5'), say('p=x&k=0&s=0'), say('p=2-3&k=-1&s=0'), route('GET', `/api/kid/textbook/say?tutor=nobody&b=${encodeURIComponent('语文一年级下册.pdf')}&p=2-3&k=0&s=0`, ctx)]);
  check('点读:块、句越界,页写错,没有这位老师:404', sBad.every((r) => r.status === 404), JSON.stringify(sBad.map((r) => r.status)));
  delete process.env.COTUTOR_TTS_ENDPOINT;
  await tts.close();

  // ---- 目录能点:孩子端要目录时一起要能点的那几项;一课里按「目录」回去、在目录上点一课翻过去,都不叫老师,下一轮「孩子做的」带上 ----
  type Toc = { page: { id: string; title: string }; entries: { title: string; box: number[]; page: { id: string; title: string; pages: number[] } }[] };
  const base1 = (await route('GET', `/api/kid/textbook/base?tutor=${T}`, ctx)).json as { lesson: Lesson; toc: Toc };
  const fish = base1.toc.entries.find((e) => e.title === '小鱼吹泡泡');
  check('目录上能点的几项:印在哪一行(场景坐标)、点了铺哪一页;缩进的那首也能点', base1.toc.page.title === '目录' && base1.toc.entries.map((e) => e.title).join() === '小鱼吹泡泡,古诗两首,静夜思,春晓,语文园地一,识字表' && fish?.page.pages.join() === '2,3' && base1.toc.entries.find((e) => e.title === '静夜思')?.page.pages.join() === '4', JSON.stringify(base1.toc));
  const tocAt = lessonOpen(lessonInit(), { file: '语文一年级下册.pdf', index: ix }, '没有这一课');
  check('老师翻到过《小鱼吹泡泡》:这本书记着上次到这(直接铺它);记着的那一课找不到才铺目录,窗停在它那一行', lessonPage(base1.lesson)?.title === '小鱼吹泡泡' && lessonPage(tocAt)?.title === '目录' && JSON.parse(readFileSync(join(root, '.cotutor', 'book-last.json'), 'utf8'))['语文一年级下册.pdf']?.title === '小鱼吹泡泡', JSON.stringify(base1.lesson.view));
  const toBack = await ctx.runner.boardEvent(T, date, { k: 'open', thread, base, title: '目录' });
  const lBack = ((await route('GET', `/api/kid/lesson?tutor=${T}&date=${date}&thread=${thread}`, ctx)).json as { lesson: Lesson }).lesson;
  check('一课里按「目录」:翻回目录,窗停在刚才那一课那一行;不叫老师', toBack?.still === false && lBack.at === '语文一年级下册.pdf#目录' && JSON.stringify(lBack.view) === JSON.stringify(fish?.box), JSON.stringify([toBack, lBack.at, lBack.view]));
  const tocId = '语文一年级下册.pdf#目录';
  const wrong = await Promise.all([
    ctx.runner.boardEvent(T, date, { k: 'open', thread, base: tocId, title: '目录' }),
    ctx.runner.boardEvent(T, date, { k: 'open', thread, base: tocId, title: '坐井观天' }),
    ctx.runner.boardEvent(T, date, { k: 'open', thread, base, title: '古诗两首' }),
    ctx.runner.boardEvent(T, date, { k: 'open', thread, base: tocId, title: 3 }),
  ]);
  check('不翻:目录上点「目录」、目录上没有的课、不是现在这一页、课名不是字', wrong.every((x) => x === null), JSON.stringify(wrong));
  const opened = await ctx.runner.boardEvent(T, date, { k: 'open', thread, base: tocId, title: '古诗两首' });
  const lOpen = ((await route('GET', `/api/kid/lesson?tutor=${T}&date=${date}&thread=${thread}`, ctx)).json as { lesson: Lesson }).lesson;
  const opens = (await readBoard(ws, T, date, thread)).filter((e) => e.k === 'open');
  check('目录上点了一课:翻过去、记进板的日志、记下这本书翻到哪了;不叫老师', opened?.still === false && opened.say === null && lOpen.at === '语文一年级下册.pdf#古诗两首' && lOpen.view === null && opens.map((e) => `${e.text}@${e.base}`).join() === `目录@${tocId},古诗两首@语文一年级下册.pdf#古诗两首` && JSON.parse(readFileSync(join(root, '.cotutor', 'book-last.json'), 'utf8'))['语文一年级下册.pdf']?.title === '古诗两首', JSON.stringify([opened, lOpen.at, opens]));
  // 挪窗停下:这一册记下窗停在哪,下次进门(孩子端先要的那份也一样)摆回来
  const gushiBase = '语文一年级下册.pdf#古诗两首';
  await ctx.runner.boardEvent(T, date, { k: 'view', thread, base: gushiBase, box: [0, 300, 1000, 900] });
  const spot1 = JSON.parse(readFileSync(join(root, '.cotutor', 'book-last.json'), 'utf8'))['语文一年级下册.pdf'];
  const back1 = ((await route('GET', `/api/kid/textbook/base?tutor=${T}`, ctx)).json as { lesson: Lesson }).lesson;
  check('挪窗停下:记下这一课和窗;再进门直接铺这一课,窗摆回那里', spot1?.title === '古诗两首' && JSON.stringify(spot1.view) === '[0,300,1000,900]' && lessonPage(back1)?.title === '古诗两首' && JSON.stringify(back1.view) === '[0,300,1000,900]', JSON.stringify([spot1, back1.view]));
  // 一课里翻到别的课(上一课、下一课):翻过去、不叫老师;换了一课,记的窗清掉
  const prev = await ctx.runner.boardEvent(T, date, { k: 'open', thread, base: gushiBase, title: '小鱼吹泡泡' });
  const lPrev = ((await route('GET', `/api/kid/lesson?tutor=${T}&date=${date}&thread=${thread}`, ctx)).json as { lesson: Lesson }).lesson;
  const spot2 = JSON.parse(readFileSync(join(root, '.cotutor', 'book-last.json'), 'utf8'))['语文一年级下册.pdf'];
  const same = await ctx.runner.boardEvent(T, date, { k: 'open', thread, base: '语文一年级下册.pdf#小鱼吹泡泡', title: '小鱼吹泡泡' });
  check('一课里翻到上一课:翻过去、不叫老师,记下的换成这一课(窗清掉);翻到自己这一课不理', prev?.still === false && lPrev.at === '语文一年级下册.pdf#小鱼吹泡泡' && spot2?.title === '小鱼吹泡泡' && spot2.view === undefined && same === null, JSON.stringify([prev, lPrev.at, spot2, same]));
  await ctx.runner.boardEvent(T, date, { k: 'open', thread, base: '语文一年级下册.pdf#小鱼吹泡泡', title: '古诗两首' });
  const today1 = ((await route('GET', '/api/kid/home', ctx)).json as { today: { thread: string; lesson?: string }[] }).today.find((x) => x.thread === thread);
  check('首页「今天」的课名:孩子自己翻到的那一课也算', today1?.lesson === '古诗两首', JSON.stringify(today1));
  now = new Date(2026, 10, 14, 10, 9);
  const fifth = await kidSend(ctx, T, { text: '这一课讲什么', thread });
  await wait();
  const pr5 = promptOf(String(fifth.json.job));
  check('他下一次开口:老师看到底是这一课、孩子做的是自己点过来的', pr5.includes('底: "课本《语文一年级下册》:《古诗两首》') && pr5.includes('自己在目录上点了《古诗两首》,翻到了这一课'), pr5.slice(pr5.indexOf('board:'), pr5.indexOf('board:') + 400));
  check('给老师的目录:说一句上次翻到哪一课', bookSlateParts(ix, bookLesson(ix, null)!, '古诗两首').show === '课本《语文一年级下册》:目录(还没翻到哪一课;上次翻到《古诗两首》)');
  const backSlate = slateOf({ page: { id: tocId, show: '目录' }, others: [], events: [{ at: '2026-11-14T02:00:00.000Z', k: 'open', text: '目录', base: tocId }], lesson: { ops: [], covers: { 遮: [], 盖: [] }, revealed: [] }, now: Date.parse('2026-11-14T02:00:05.000Z') });
  check('孩子自己按「目录」回去的:孩子做的里说一句', backSlate.did.includes('自己按「目录」翻回了目录'), JSON.stringify(backSlate.did));
  check('课名不是字的 open:收不下', (await kidSend(ctx, T, { text: '', open: 5, thread })).status === 400);

  // ---- 数学:课本做底、不开点字;窗停下来以后舞台交的图,下一轮附给老师 ----
  const M = 'math-tutor';
  const mpdf = Buffer.from('%PDF-1.4 假的数学课本\n');
  writeFileSync(join(ws.paths.textbooks, '数学一年级下册.pdf'), mpdf);
  const msha = createHash('sha1').update(mpdf).digest('hex').slice(0, 16);
  writeFileSync(join(root, '.cotutor', 'textbooks', `${msha}.json`), JSON.stringify({ ...mathIndexOf(), sha: msha }));
  const mtile = ((await route('GET', '/api/kid/home', ctx)).json as typeof h).cards.find((c) => c.props.tutor === M)?.props.tiles?.find((x) => x.id === 'textbook');
  const mbase0 = (await route('GET', `/api/kid/textbook/base?tutor=${M}`, ctx)).json as { lesson: Lesson | null };
  const mtoc = mbase0.lesson ? lessonPage(mbase0.lesson) : null;
  check('数学「课本」方砖也铺课本;目录当一页,不开点字、什么都没请', mtile?.base === 'textbook' && mtoc?.kind === 'book' && mtoc.src === '数学一年级下册.pdf' && mtoc.title === '目录' && mtoc.pick === false && mtoc.open.length === 0, JSON.stringify({ mtile, mbase0 }));
  const mPrompt = (job: string): string => (JSON.parse(readFileSync(join(root, 'conversations', M, `${date}.${job}.run.json`), 'utf8')) as { prompt: string }).prompt;
  const mIndex = (): { messages: { job: string; section?: BoardSection }[] } => JSON.parse(readFileSync(join(root, 'conversations', M, `${date}.json`), 'utf8'));
  const mwait = async (): Promise<void> => { for (let i = 0; i < 200 && ctx.runner.running(M); i++) await new Promise((r) => setTimeout(r, 25)); await ctx.runner.flush(); };
  now = new Date(2026, 10, 14, 11, 0);
  const mt1 = await kidSend(ctx, M, { text: '', via: { home: h.home, button: 'textbook' } });
  await mwait();
  const mth = String(mt1.json.thread);
  const mp1 = mPrompt(String(mt1.json.job));
  check('数学的目录:一个单元一行,后面是小节、课题;没请就什么都不开放(数学课本不开点字)', mp1.includes('二 1～6的表内乘法(3):1.乘法的初步认识(4)、·5的乘法口诀(5)、·6的乘法口诀(6)') && mp1.includes('开放: "无"'), mp1.slice(mp1.indexOf('board:'), mp1.indexOf('board:') + 300));
  now = new Date(2026, 10, 14, 11, 1);
  const mt2 = await kidSend(ctx, M, { text: '我要预习乘法口诀', thread: mth });
  await mwait();
  const ms2 = mIndex().messages.find((m) => m.job === mt2.json.job)?.section;
  const ml2 = (await route('GET', `/api/kid/lesson?tutor=${M}&date=${date}&thread=${mth}`, ctx)).json as { lesson: Lesson | null };
  check('讲稿里的动作落到页上:翻(第一句前面)、看例 2 换成框', ms2?.acts?.[0]?.do?.k === '翻' && ms2.lines[0].acts?.[0]?.do?.k === '看' && (ms2.lines[0].acts![0].do as { label: string }).label === '例2', JSON.stringify(ms2));
  check('一节课的状态:翻到这一课、看着例 2、记下这一节;没请就什么都不开放', ml2.lesson?.at === '数学一年级下册.pdf#5的乘法口诀' && ml2.lesson.look?.label === '例2' && ml2.lesson.jobs.includes(String(mt2.json.job)) && lessonPage(ml2.lesson)!.open.length === 0, JSON.stringify(ml2.lesson));
  const JPG = `data:image/jpeg;base64,${Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex').toString('base64')}`;
  const mbase = '数学一年级下册.pdf#5的乘法口诀';
  const shotFile = join(root, 'conversations', M, `${date}.${mth}.shot.jpg`);
  const shot = await ctx.runner.boardEvent(M, date, { k: 'shot', thread: mth, base: mbase, box: [0, 0, 1000, 800], image: JPG });
  check('窗里的图:存成这个话题最新的一张,记进板的日志(不念、不算孩子动了手)', shot?.shot === true && shot.say === null && existsSync(shotFile) && (await readBoard(ws, M, date, mth)).some((e) => e.k === 'shot' && e.base === mbase && e.text.includes('例2')), JSON.stringify(shot));
  const badShots = await Promise.all([
    ctx.runner.boardEvent(M, date, { k: 'shot', thread: mth, base: mbase, box: [0, 0, 1000, 800], image: 'data:image/png;base64,iVBORw0KGgo=' }),
    ctx.runner.boardEvent(M, date, { k: 'shot', thread: mth, base: mbase, box: [0, 0, 1000, 800] }),
    ctx.runner.boardEvent(T, date, { k: 'shot', thread, base, box: [0, 0, 1000, 800], image: JPG }),
    ctx.runner.boardEvent(M, date, { k: 'shot', thread: mth, base: '数学一年级下册.pdf#目录', box: [0, 0, 1000, 800], image: JPG }),
  ]);
  check('不收:不是 jpeg、没有图;不是现在这一页(目录);语文的课本先不收窗里的图', badShots.every((x) => x === null), JSON.stringify(badShots));
  now = new Date(2026, 10, 14, 11, 2);
  const mt3 = await kidSend(ctx, M, { text: '这是几个', thread: mth });
  await mwait();
  const mj3 = String(mt3.json.job);
  const mp3 = mPrompt(mj3);
  const hist = readFileSync(join(root, 'conversations', M, `${date}.${mth}.brain.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { user: { boards?: string[] } });
  check('下一轮:图挪成这一轮的、附给老师;孩子在看注一句图附上了', !existsSync(shotFile) && existsSync(join(root, 'conversations', M, `${date}.${mj3}.shot.jpg`)) && (hist[hist.length - 1].user.boards ?? []).some((b) => b.endsWith(`${mj3}.shot.jpg`)) && mp3.includes('(这一块的图附在这一轮)'), JSON.stringify({ hist: hist.map((x) => x.user.boards), view: mp3.slice(mp3.indexOf('孩子在看'), mp3.indexOf('孩子在看') + 60) }));
  now = new Date(2026, 10, 14, 11, 3);
  const mt4 = await kidSend(ctx, M, { text: '还有呢', thread: mth });
  await mwait();
  const hist4 = readFileSync(join(root, 'conversations', M, `${date}.${mth}.brain.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { user: { boards?: string[] } });
  check('再下一轮没有新的图:不附、不注', !(hist4[hist4.length - 1].user.boards ?? []).length && !mPrompt(String(mt4.json.job)).includes('图附在这一轮'));
  // 孩子在课本上落笔、擦掉:落进一节课的状态,下一轮「孩子做的」数笔
  const st1 = await ctx.runner.boardEvent(M, date, { k: 'stroke', thread: mth, base: mbase, pts: [[100, 200], [140, 260]] });
  const st2 = await ctx.runner.boardEvent(M, date, { k: 'stroke', thread: mth, base: mbase, pts: [[300, 200], [320, 220]] });
  const stBad = await Promise.all([
    ctx.runner.boardEvent(M, date, { k: 'stroke', thread: mth, base: mbase, pts: [] }),
    ctx.runner.boardEvent(M, date, { k: 'stroke', thread: mth, base: mbase, pts: [['a', 1]] }),
    ctx.runner.boardEvent(M, date, { k: 'stroke', thread: mth, base: '数学一年级下册.pdf#目录', pts: [[1, 1]] }),
  ]);
  check('落笔:记进一节课的状态,不念、不催;空的、坏的、不是现在这一页的不收', st1?.say === null && st1.still === false && st2 !== null && stBad.every((x) => x === null) && lessonPage(((await route('GET', `/api/kid/lesson?tutor=${M}&date=${date}&thread=${mth}`, ctx)).json as { lesson: Lesson }).lesson)!.kid.ink.length === 2, JSON.stringify([st1, stBad]));
  now = new Date(2026, 10, 14, 11, 3, 30);
  const mt35 = await kidSend(ctx, M, { text: '我写好了', thread: mth });
  await mwait();
  check('下一轮:孩子做的里有写画了几笔', mPrompt(String(mt35.json.job)).includes('在页上写画了 2 笔'), mPrompt(String(mt35.json.job)).slice(mPrompt(String(mt35.json.job)).indexOf('孩子做的'), mPrompt(String(mt35.json.job)).indexOf('孩子做的') + 80));
  // 动手:例 4 下面摆一个点阵(白纸条),请他圈
  now = new Date(2026, 10, 14, 11, 3, 40);
  await kidSend(ctx, M, { text: '我想摆一摆', thread: mth });
  await mwait();
  const ml36 = (await route('GET', `/api/kid/lesson?tutor=${M}&date=${date}&thread=${mth}`, ctx)).json as { lesson: Lesson };
  check('摆:看着的那道题下面开一条白纸条,点阵摆在上面;请了圈', ml36.lesson.strip !== null && lessonPage(ml36.lesson)!.teacher.strips[0]?.items[0]?.kind === 'shape' && lessonPage(ml36.lesson)!.open.join() === '圈', JSON.stringify(ml36.lesson));
  await ctx.runner.boardEvent(M, date, { k: 'wipe', thread: mth, base: mbase });
  now = new Date(2026, 10, 14, 11, 3, 50);
  const mt37 = await kidSend(ctx, M, { text: '回课本吧', thread: mth });
  await mwait();
  const mp37 = mPrompt(String(mt37.json.job));
  check('下一轮:你画的有白纸条里的点阵;孩子做的里有擦掉了', mp37.includes('白纸条:点阵 6 行 6 个') && mp37.includes('擦掉了自己画的') && mp37.includes('开放: "圈"'), mp37.slice(mp37.indexOf('board:'), mp37.indexOf('board:') + 600));
  const ml37 = (await route('GET', `/api/kid/lesson?tutor=${M}&date=${date}&thread=${mth}`, ctx)).json as { lesson: Lesson };
  check('擦 全部:白纸条收掉', ml37.lesson.strip === null && lessonPage(ml37.lesson)!.teacher.strips.length === 0, JSON.stringify(lessonPage(ml37.lesson)!.teacher));
  // 盖住印好的算式,孩子点开
  now = new Date(2026, 10, 14, 11, 4);
  await kidSend(ctx, M, { text: '我先想一想', thread: mth });
  await mwait();
  const rv = await ctx.runner.boardEvent(M, date, { k: 'reveal', thread: mth, text: '5×1=5', base: mbase });
  const rvBad = await ctx.runner.boardEvent(M, date, { k: 'reveal', thread: mth, text: '一二三四五六七八九十一二三', base: mbase });
  check('揭开盖住的算式:课本上收下(不念);太长的不收', rv?.say === null && rvBad === null, JSON.stringify([rv, rvBad]));
  now = new Date(2026, 10, 14, 11, 5);
  const mt6 = await kidSend(ctx, M, { text: '是5', thread: mth });
  await mwait();
  const mp6 = mPrompt(String(mt6.json.job));
  check('下一轮:你画的照这节课的状态(看哪里、盖了什么;课在底里,不写应用填的书、页),孩子做的里有揭开了盖住的', mp6.includes('你画的: "看 例2;盖 5×1=5"') && mp6.includes('揭开了盖住的:5×1=5') && !mp6.includes('书 数学'), mp6.slice(mp6.indexOf('你画的'), mp6.indexOf('你画的') + 160));
  await teacher.close();
}

done();
