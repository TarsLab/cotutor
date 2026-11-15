/**
 * 课本做底(语文预习,activity 头上 base: textbook;2026-11-14《语文预习:PDF 课本与镜头交互》)服务端那一半:
 * 课本卡落板之前填书、页、课,看 / 圈 / 遮换成框(src/board/board-page.ts);板此刻的样子里的课本(board-pack 的 bookSlateParts);
 * 全流程:点「预习」方砖(不拍照)→ 底是目录 → 老师翻到一课、看第 1 段再看第 2 段 → 孩子挪窗、点字记进日志 → 下一轮老师看到他在看哪里。
 * 书用 tests/_book.ts 造的那本;PDF 是个假文件,它的指纹对上一份事先写好的索引缓存(读 PDF 的那一层走 scripts/probe-textbook.mjs)。
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

const { boardPageSection, bookLesson } = await import('../src/board/board-page.ts');
const { bookSlateParts, slateOf } = await import('../src/runtime/context/board-pack.ts');
const { renderContextPack } = await import('../src/runtime/context/context-pack.ts');
const { parseActivity, checkActivity } = await import('../src/runtime/activity.ts');
const { readBoard } = await import('../src/runtime/journal/board-log.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
const { bookSpots } = await import('../src/chalk/index.ts');
type BoardSection = import('../src/schema/index.ts').BoardSection;
type BoardCard = import('../src/schema/index.ts').BoardCard;

const ix = bookIndexOf();
const book = (lesson: string | null) => ({ file: '语文一年级下册.pdf', index: ix, lesson });
const kitCard = (params: Record<string, string>, kit = '课本'): BoardCard => ({ kind: 'kit', props: { kit, params, ops: ['点字', '圈', '画'] } } as BoardCard);
const sec = (cards: BoardCard[]): BoardSection => ({ heading: null, lines: cards.map((_, i) => ({ text: `第${i}句`, anchor: i, marks: [], cues: [] })), cards } as unknown as BoardSection);
const P = (c: BoardCard): Record<string, string> => c.props.params as Record<string, string>;

// ---- 落板之前:课本卡怎么填(纯函数) ----
{
  const s = boardPageSection(sec([kitCard({ 课: '小鱼吹泡泡', 看: '第 1 段|' }), { kind: 'text', props: { text: '一张字卡' } } as BoardCard, kitCard({ 看: '第 2 段|', 圈: '井沿|;没有这个词|' })]), { page: true, photo: null, book: book(null) });
  const [a, b] = s.section.cards;
  check('课名照目录换成 PDF 的几页、填上书;一节里两张课本卡都留着(窗一步一步移),别的卡撤掉', s.section.cards.length === 2 && P(a)['课'] === '小鱼吹泡泡' && P(a)['书'] === '语文一年级下册.pdf' && P(a)['页'] === '2-3' && s.dropped.length === 1 && s.dropped[0].kind === 'text', JSON.stringify(s.section.cards.map(P)));
  check('看换成框(名字|框);第二张没写课就是上一张那一课', bookSpots(P(a)['看'])[0].text === '第1段' && Boolean(bookSpots(P(a)['看'])[0].box) && P(b)['课'] === '小鱼吹泡泡' && P(b)['页'] === '2-3' && bookSpots(P(b)['看'])[0].text === '第2段', JSON.stringify([P(a)['看'], P(b)['看']]));
  check('圈的字照课本找到;找不到的那一处不画、记下来', bookSpots(P(b)['圈']).length === 1 && bookSpots(P(b)['圈'])[0].text === '井沿' && Boolean(bookSpots(P(b)['圈'])[0].box) && s.unfound.join() === '没有这个词', JSON.stringify({ q: P(b)['圈'], u: s.unfound }));
  check('讲稿里引用的卡跟着重排:撤掉的那张的锚没了', s.section.lines[1].anchor === null && s.section.lines[2].anchor === 1);
  const toc = boardPageSection(sec([kitCard({ 看: '' })]), { page: true, photo: null, book: book(null) });
  check('没写课、板上还没有课:铺目录', P(toc.section.cards[0])['课'] === '目录' && P(toc.section.cards[0])['页'] === '1');
  const keep = boardPageSection(sec([kitCard({ 看: '第 3 段|' })]), { page: true, photo: null, book: book('小鱼吹泡泡') });
  check('没写课:板上现在那一课', P(keep.section.cards[0])['课'] === '小鱼吹泡泡' && bookSpots(P(keep.section.cards[0])['看'])[0].text === '第3段');
  const lost = boardPageSection(sec([kitCard({ 课: '坐井观天' })]), { page: true, photo: null, book: book('小鱼吹泡泡') });
  check('课本里没有这一课:还是板上那一课,记下来', P(lost.section.cards[0])['课'] === '小鱼吹泡泡' && lost.unfound.join() === '坐井观天');
  const noBook = boardPageSection(sec([kitCard({ 课: '小鱼吹泡泡' }), kitCard({ 图: 'captures/a.jpg' }, '照片')]), { page: true, photo: 'captures/a.jpg' });
  check('底不是课本(拍照的 activity):课本卡画不出来,撤掉', noBook.section.cards.length === 1 && noBook.section.cards[0].props.kit === '照片' && noBook.dropped.length === 1);
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
  const s1 = slateOf({ photo: null, fresh: false, words: null, events: [{ at: at(60), k: 'turn', job: '1000-1' }, { at: at(30), k: 'pick', text: '泡', base: key }, { at: at(20), k: 'view', text: '第 1 页:第 1–2 段', base: key }, { at: at(5), k: 'view', text: '第 2 页:课文后面的部分', base: key }], kit: null, ops: ['点字'], now: T, book: { show: fish.show, key, text: fish.text } });
  check('课本:全文第一次给全、记下 told;孩子在看是上一轮以后最后停下的地方', s1.told === key && s1.slate.text?.[0] === '第1段 小鱼在水里吹泡泡。' && s1.slate.view === '第 2 页:课文后面的部分' && s1.slate.did.join() === '点开看了笔顺:泡', JSON.stringify(s1.slate));
  const s2 = slateOf({ photo: null, fresh: false, words: null, events: [{ at: at(60), k: 'turn', job: '1000-1', told: key }, { at: at(50), k: 'view', text: '第 1 页', base: key }, { at: at(40), k: 'turn', job: '1000-2' }], kit: null, ops: [], now: T, book: { show: fish.show, key, text: fish.text } });
  check('给过的全文写「未变」;上一轮之前挪的不算「孩子在看」', JSON.stringify(s2.slate.text) === '["未变"]' && s2.slate.view === undefined, JSON.stringify(s2.slate));
  const pack = renderContextPack({ at: '2026-11-14T10:00', plan: [], recent: [], slate: s1.slate });
  check('上下文包里多一行「孩子在看」', pack.includes('    孩子在看: "第 2 页:课文后面的部分"'), pack.slice(pack.indexOf('board:')));
}

// ---- activity 头上的 base ----
{
  const file = (head: string): string => `---\nname: 试\ndescription: 试\n${head}\n---\n\n## 老师怎么带\n\n你是老师。\n第一句: 好。\n收: 好。\n`;
  const issues = (head: string): string[] => checkActivity(parseActivity(file(head)).activity).filter((i) => i.level === 'fix').map((i) => i.text);
  check('base: textbook 读得出', parseActivity(file('board: page\nbase: textbook\ncards: kit')).activity.base === 'textbook' && !issues('board: page\nbase: textbook\ncards: kit').length);
  check('base 写了不认得的、没写 board:都要改', issues('board: page\nbase: 课本\ncards: kit').some((t) => t.includes('不认得')) && issues('base: textbook\ncards: kit').some((t) => t.includes('board: page')));
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
  const index = (): { messages: { job: string; board?: string; section?: BoardSection; warnings?: string[] }[] } => JSON.parse(readFileSync(join(root, 'conversations', T, `${date}.json`), 'utf8'));
  const ws = loadWorkspace(root);

  const h = (await route('GET', '/api/kid/home', ctx)).json as { home: string | null; cards: { kind: string; props: { tutor?: string; tiles?: { id: string; board?: string; base?: string }[] } }[] };
  const tile = h.cards.find((c) => c.props.tutor === T)?.props.tiles?.find((x) => x.id === 'preview');
  check('首页的语文「预习」方砖:以板为主、垫课本(孩子端不到拍照屏)', tile?.board === 'page' && tile.base === 'textbook', JSON.stringify(tile));

  // 还没放课本:老师的底说没有,家长端记一行
  const none = await kidSend(ctx, T, { text: '', via: { home: h.home, button: 'preview' } });
  await wait();
  const pr0 = promptOf(String(none.json.job));
  check('教材文件夹里没有课本 PDF:底说没有、请家长放;家长端记一行', pr0.includes('底: "课本:教材文件夹里没有语文的课本 PDF(请家长放进 vault 的教材文件夹)"') && (index().messages.find((m) => m.job === none.json.job)?.warnings ?? []).some((w) => w.includes('没有语文的课本')), pr0.slice(pr0.indexOf('board:'), pr0.indexOf('board:') + 160));

  // 放一本:假 PDF + 对得上指纹的索引缓存
  const pdf = Buffer.from('%PDF-1.4 假的,只为算指纹\n');
  mkdirSync(ws.paths.textbooks, { recursive: true });
  writeFileSync(join(ws.paths.textbooks, '语文一年级下册.pdf'), pdf);
  writeFileSync(join(ws.paths.textbooks, '数学一年级下册.pdf'), pdf);
  const sha = createHash('sha1').update(pdf).digest('hex').slice(0, 16);
  mkdirSync(join(root, '.cotutor', 'textbooks'), { recursive: true });
  writeFileSync(join(root, '.cotutor', 'textbooks', `${sha}.json`), JSON.stringify({ ...ix, sha }));

  now = new Date(2026, 10, 14, 10, 5);
  const first = await kidSend(ctx, T, { text: '', via: { home: h.home, button: 'preview' }, newThread: true });
  await wait();
  const job1 = String(first.json.job);
  const thread = String(first.json.thread);
  const pr1 = promptOf(job1);
  check('点方砖进来(不拍照):话题记 board: page;底是目录,全文是一单元一行', index().messages.find((m) => m.job === job1)?.board === 'page' && pr1.includes('底: "课本《语文一年级下册》:目录(还没翻到哪一课)"') && pr1.includes('第一单元·阅读:1 小鱼吹泡泡(1)'), pr1.slice(pr1.indexOf('board:'), pr1.indexOf('board:') + 200));

  now = new Date(2026, 10, 14, 10, 6);
  const second = await kidSend(ctx, T, { text: '我要预习小鱼', thread });
  await wait();
  const job2 = String(second.json.job);
  const m2 = index().messages.find((m) => m.job === job2);
  const cards2 = m2?.section?.cards ?? [];
  check('老师翻到一课:两张课本卡都上板,填好书、页、看的框', cards2.length === 2 && cards2.every((c) => c.props.kit === '课本' && P(c)['页'] === '2-3' && P(c)['书'] === '语文一年级下册.pdf') && bookSpots(P(cards2[1])['看'])[0].text === '第2段', JSON.stringify(cards2.map(P)));
  check('圈的词课本里没有:家长端记一行', (m2?.warnings ?? []).some((w) => w.includes('课本卡写的「没有这个词」')), JSON.stringify(m2?.warnings));
  check('翻到这一课以前的那一轮:全文是目录(记了 told)', (await readBoard(ws, T, date, thread)).some((e) => e.k === 'turn' && e.told === '语文一年级下册.pdf#目录'));

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
  check('不对的不记:框不是四个数、册子不在、照片的底不能挪窗、越界的册名', bad.every((x) => x === null), JSON.stringify(bad));
  const log = await readBoard(ws, T, date, thread);
  const v = log.find((e) => e.k === 'view');
  check('挪窗记成一句:哪一页、看得见什么', v?.k === 'view' && v.text === '第 2 页:第 2–3 段', JSON.stringify(v));

  now = new Date(2026, 10, 14, 10, 6, 20);
  const third = await kidSend(ctx, T, { text: '这个字怎么读', thread });
  await wait();
  const pr3 = promptOf(String(third.json.job));
  check('下一轮:底是这一课,全文分好段;他点了什么、最近点的、他在看哪里', pr3.includes('底: "课本《语文一年级下册》:《小鱼吹泡泡》第 1–2 页"') && pr3.includes('第1段 小鱼在水里吹泡泡。') && pr3.includes('点开看了笔顺:泡') && pr3.includes('孩子在看: "第 2 页:第 2–3 段"'), pr3.slice(pr3.indexOf('board:'), pr3.indexOf('board:') + 400));
  now = new Date(2026, 10, 14, 10, 8);
  const fourth = await kidSend(ctx, T, { text: '不存在的课', thread });
  await wait();
  const pr4 = promptOf(String(fourth.json.job));
  const m4 = index().messages.find((m) => m.job === fourth.json.job);
  check('再下一轮:全文「未变」;翻不到的课还在这一课,家长端记一行', pr4.includes('全文: "未变"') && P(m4!.section!.cards[0])['课'] === '小鱼吹泡泡' && (m4?.warnings ?? []).some((w) => w.includes('坐井观天')), JSON.stringify(m4?.warnings));

  // 孩子端取课本:PDF(能分段取)、几页的行和字
  const got = await route('GET', `/api/kid/textbook/pdf?b=${encodeURIComponent('语文一年级下册.pdf')}`, ctx);
  const lines = (await route('GET', `/api/kid/textbook/lines?b=${encodeURIComponent('语文一年级下册.pdf')}&p=2-3`, ctx)).json as { pages: { n: number; lines: { text: string }[] }[] };
  check('孩子端取课本:PDF 给文件;几页的行和字只给要的那几页', got.status === 200 && got.contentType === 'application/pdf' && Boolean(got.file?.endsWith('语文一年级下册.pdf')) && lines.pages.map((p) => p.n).join() === '2,3' && lines.pages[0].lines.some((l) => l.text === '小鱼在水里吹泡泡。'));
  const baseCard = (await route('GET', `/api/kid/textbook/base?tutor=${T}`, ctx)).json as { card: { props: { kit: string; params: Record<string, string>; ops: string[] } } | null };
  check('课本话题刚开:孩子端要的目录那张课本卡(这一科这学期那一册、目录那几页)', baseCard.card?.props.kit === '课本' && baseCard.card.props.params['课'] === '目录' && baseCard.card.props.params['页'] === '1' && baseCard.card.props.params['书'] === '语文一年级下册.pdf' && baseCard.card.props.ops.join() === '点字', JSON.stringify(baseCard));
  check('英语老师没有课本:card 是 null;没有这位老师 404', ((await route('GET', '/api/kid/textbook/base?tutor=english-tutor', ctx)).json as { card: unknown }).card === null && (await route('GET', '/api/kid/textbook/base?tutor=nobody', ctx)).status === 404);
  const nf = await Promise.all([route('GET', `/api/kid/textbook/pdf?b=${encodeURIComponent('../cotutor.json')}`, ctx), route('GET', '/api/kid/textbook/pdf?b=x.pdf', ctx), route('GET', `/api/kid/textbook/lines?b=${encodeURIComponent('语文一年级下册.pdf')}&p=x`, ctx)]);
  check('越界、不在、页写错:404', nf.every((r) => r.status === 404));

  // ---- 数学:课本做底、不开点字;窗停下来以后舞台交的图,下一轮附给老师 ----
  const M = 'math-tutor';
  const mpdf = Buffer.from('%PDF-1.4 假的数学课本\n');
  writeFileSync(join(ws.paths.textbooks, '数学一年级下册.pdf'), mpdf);
  const msha = createHash('sha1').update(mpdf).digest('hex').slice(0, 16);
  writeFileSync(join(root, '.cotutor', 'textbooks', `${msha}.json`), JSON.stringify({ ...mathIndexOf(), sha: msha }));
  const mtile = h.cards.find((c) => c.props.tutor === M)?.props.tiles?.find((x) => x.id === 'preview');
  const mcard = (await route('GET', `/api/kid/textbook/base?tutor=${M}`, ctx)).json as { card: { props: { params: Record<string, string>; ops: string[] } } | null };
  check('数学「预习」方砖也垫课本;目录那张卡只看、不开点字', mtile?.board === 'page' && mtile.base === 'textbook' && mcard.card?.props.params['书'] === '数学一年级下册.pdf' && mcard.card.props.ops.join() === '看', JSON.stringify({ mtile, mcard }));
  const mPrompt = (job: string): string => (JSON.parse(readFileSync(join(root, 'conversations', M, `${date}.${job}.run.json`), 'utf8')) as { prompt: string }).prompt;
  const mIndex = (): { messages: { job: string; section?: BoardSection }[] } => JSON.parse(readFileSync(join(root, 'conversations', M, `${date}.json`), 'utf8'));
  const mwait = async (): Promise<void> => { for (let i = 0; i < 200 && ctx.runner.running(M); i++) await new Promise((r) => setTimeout(r, 25)); await ctx.runner.flush(); };
  now = new Date(2026, 10, 14, 11, 0);
  const mt1 = await kidSend(ctx, M, { text: '', via: { home: h.home, button: 'preview' }, newThread: true });
  await mwait();
  const mth = String(mt1.json.thread);
  const mp1 = mPrompt(String(mt1.json.job));
  check('数学的目录:一个单元一行,后面是小节、课题;开放里没有点字', mp1.includes('二 1～6的表内乘法(3):1.乘法的初步认识(4)、·5的乘法口诀(5)、·6的乘法口诀(6)') && mp1.includes('开放: "圈、画"'), mp1.slice(mp1.indexOf('board:'), mp1.indexOf('board:') + 300));
  now = new Date(2026, 10, 14, 11, 1);
  const mt2 = await kidSend(ctx, M, { text: '我要预习乘法口诀', thread: mth });
  await mwait();
  const mc = mIndex().messages.find((m) => m.job === mt2.json.job)?.section?.cards[0];
  check('翻到课题、看例 2:换成框;老师没写操作,数学不开点字', mc?.props.kit === '课本' && P(mc)['课'] === '5的乘法口诀' && bookSpots(P(mc)['看'])[0].text === '例2' && Boolean(bookSpots(P(mc)['看'])[0].box) && (mc.props.ops as string[]).join() === '圈,画', JSON.stringify(mc?.props));
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
  check('不收:不是 jpeg、没有图;目录(字全在 board: 里);语文的课本先不收窗里的图', badShots.every((x) => x === null), JSON.stringify(badShots));
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
  check('下一轮:你画的是这张课本卡(不写应用填的书、页),孩子做的里有揭开了盖住的', mp6.includes('你画的: "课本:课 5的乘法口诀;看 例2;盖 5×1=5"') && mp6.includes('揭开了盖住的:5×1=5') && !mp6.includes('书 数学'), mp6.slice(mp6.indexOf('你画的'), mp6.indexOf('你画的') + 160));
  await teacher.close();
}

done();
