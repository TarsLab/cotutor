/**
 * 铺孩子拍的照片的一节课(activity 头上 base: photo;2026-11-16 阶段 3)服务端那一半:
 * 上传回照片的宽高;话题第一条记 base: photo;照片接在照片页后面(没拍就是白纸页);认出的字一张一条 <page>(第一次给,之后不重给);
 * 讲稿里的动作照认出的题、字落到页上;孩子点字、落笔经实时那条连接落进这节课的状态和板的日志;board: 每轮只说会变的。看图与老师都是假的,不花钱、不联网。
 */
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import { kidSend } from './_kid-send.ts';
import { FAKE_RUNTIMES, startFakeTeacher } from './_fake-teacher.ts';
import { writeKeys } from './_keys.ts';
import { pinPhotoPreview } from './_photo-preview.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-board-page-')));
process.env.HOME = home;
writeKeys(home, { payg: 'sk-t' });
delete process.env.COTUTOR_WORKSPACE;

const { imageSize } = await import('../src/shared/jpeg.ts');
const { readBoard } = await import('../src/runtime/journal/board-log.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
const { lessonPage, lessonStrip } = await import('../src/board/lesson.ts');
type BoardSection = import('../src/schema/index.ts').BoardSection;
type Lesson = import('../src/schema/index.ts').Lesson;
type Look = import('../src/scenes/look.ts').Look;

/** 一张最小的 jpeg:只有文件头和 SOF0(宽高),够认出大小;h × w */
const jpeg = (w: number, h: number): Buffer => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
check('照片的宽高只读文件头:jpeg 的 SOF、png 的 IHDR;不是图回 null', JSON.stringify(imageSize(jpeg(2000, 1500))) === '{"w":2000,"h":1500}' && JSON.stringify(imageSize(Buffer.from('89504e470d0a1a0a0000000d4948445200000320000002580806000000', 'hex'))) === '{"w":800,"h":600}' && imageSize(Buffer.from('hello')) === null && imageSize(Buffer.from('ffd8ffd9', 'hex')) === null);

// ---- 全流程:点「预习」(base: photo)拍了照 → 照片页、board:、<page> → 动作落到认出的题 → 点字、落笔 → 下一轮 ----
{
  const LINES = [
    '{"lesson": "安全疏散示意图"}',
    '{"text": "变", "kind": "char", "pick": true, "box": [237, 233, 281, 267], "sure": true, "say": "变,变化的变"}',
    '{"full": "3.心理辅导室的东面有(  )和(  )。", "box": [100, 600, 700, 640]}',
    '{"question": "3", "box": [80, 560, 920, 900]}',
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
  pinPhotoPreview(root);
  let now = new Date(2026, 10, 16, 19, 5);
  const ctx = createContext(loadWorkspace(root), { now: () => now, look });
  const T = 'chinese-tutor';
  const date = '2026-11-16';
  const wait = async (): Promise<void> => { for (let i = 0; i < 200 && ctx.runner.running(T); i++) await new Promise((r) => setTimeout(r, 25)); await ctx.runner.flush(); };
  const promptOf = (job: string): string => (JSON.parse(readFileSync(join(root, 'conversations', T, `${date}.${job}.run.json`), 'utf8')) as { prompt: string }).prompt;
  const index = (): { messages: { job: string; base?: string; section?: BoardSection; warnings?: string[] }[] } => JSON.parse(readFileSync(join(root, 'conversations', T, `${date}.json`), 'utf8'));
  const lesson = async (thread: string): Promise<Lesson | null> => ((await route('GET', `/api/kid/lesson?tutor=${T}&date=${date}&thread=${thread}`, ctx)).json as { lesson: Lesson | null }).lesson;
  const history = (thread: string): { user: { images: string[]; boards?: string[] } }[] => readFileSync(join(root, 'conversations', T, `${date}.${thread}.brain.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

  const h = (await route('GET', '/api/kid/home', ctx)).json as { home: string | null; cards: { kind: string; props: { tutor?: string; tiles?: { id: string; base?: string }[] } }[] };
  const tile = h.cards.find((c) => c.props.tutor === T)?.props.tiles?.find((x) => x.id === 'preview');
  check('首页的「预习」方砖说它铺孩子拍的照片(孩子端点了先到拍照屏)', tile?.base === 'photo', JSON.stringify(tile));
  const up = (await route('POST', `/api/kid/conversations/${T}/photos`, ctx, { image: `data:image/jpeg;base64,${jpeg(2000, 1500).toString('base64')}` })).json as { path: string; w: number; h: number };
  check('上传照片:回路径和宽高(孩子端照它先铺上照片页)', up.path.startsWith('captures/') && up.w === 2000 && up.h === 1500, JSON.stringify(up));
  const p1 = up.path;
  const first = await kidSend(ctx, T, { text: '', via: { home: h.home, button: 'preview' }, photos: [p1] });
  await wait();
  const job1 = String(first.json.job);
  const thread = String(first.json.thread);
  const m1 = index().messages.find((m) => m.job === job1);
  const l1 = await lesson(thread);
  const pg1 = l1 ? lessonPage(l1) : null;
  check('点方砖带着照片进来:话题第一条记 base: photo;照片铺上照片页(宽高照文件)、窗移到它', first.status === 202 && m1?.base === 'photo' && l1?.at === '作业' && pg1?.kind === 'photo' && pg1.photos[0].src === p1 && pg1.photos[0].w === 2000 && pg1.pick === true && l1.look?.label === '第1张', JSON.stringify(l1));
  const pr1 = promptOf(job1);
  check('第一轮的 board::底是作业照片、字还在认(图附在这一轮);点字开着;照片不进 photos:', pr1.includes('底: "孩子拍的作业照片 1 张(从上往下连着);第 1 张刚拍来、图附在这一轮,字还在认"') && pr1.includes('开放: "点字"') && !pr1.includes('\n  photos:') && !pr1.includes('<page '), pr1.slice(pr1.indexOf('board:'), pr1.indexOf('board:') + 200));
  check('第一轮:整张照片随这一轮附给老师(一条路)', history(thread)[0].user.images.some((x) => x.endsWith(p1.split('/').pop()!)), JSON.stringify(history(thread)[0].user));

  // 点字、落笔:实时那条连接报来,base 是页的 id
  now = new Date(2026, 10, 16, 19, 6);
  const say1 = await ctx.runner.boardEvent(T, date, { k: 'pick', thread, text: '变', base: '作业' });
  const say2 = await ctx.runner.boardEvent(T, date, { k: 'pick', thread, text: '我', base: '作业' });
  const ink = await ctx.runner.boardEvent(T, date, { k: 'stroke', thread, base: '作业', pts: [[300, 480], [340, 470]] });
  check('点字:嘴念认字时写好的念法;正文里没挑出来的字念它自己;落笔不念不催', say1?.say === '变,变化的变' && say2?.say === '我' && ink?.say === null && ink.still === false, JSON.stringify([say1, say2, ink]));
  const bad = [
    await ctx.runner.boardEvent(T, date, { k: 'pick', thread: '1111-1', text: '变', base: '作业' }),
    await ctx.runner.boardEvent(T, date, { k: 'pick', thread, text: '123', base: '作业' }),
    await ctx.runner.boardEvent(T, date, { k: 'pick', thread, text: '变', base: p1 }),
    await ctx.runner.boardEvent(T, date, { k: 'drag', thread, base: '作业' }),
  ];
  check('不对的不记:不是今天的话题、不能弹的字、不是现在这一页、不认得的事', bad.every((x) => x === null));
  const log1 = await readBoard(loadWorkspace(root), T, date, thread);
  check('板的日志:第一轮一行,两下点字、一笔各一行', log1.map((e) => e.k).join() === 'turn,pick,pick,ink', JSON.stringify(log1));

  // 第二轮:字认完了,这一张的字给一条 <page>;老师写动作,照认出的题、字落到页上
  now = new Date(2026, 10, 16, 19, 6, 5);
  const second = await kidSend(ctx, T, { text: '讲题吧', thread });
  await wait();
  const job2 = String(second.json.job);
  const pr2 = promptOf(job2);
  check('第二轮:这一张认出的字给一条 <page>(有题号的行带题号);他点了什么、写画了几笔、最近点的', pr2.includes(`<page id="作业#${p1}" name="第1张">\n第3题 3.心理辅导室的东面有()和()。\n</page>`) && pr2.includes('点开看了笔顺:变、我') && pr2.includes('在页上写画了 1 笔') && pr2.includes('最近点的: "我(5 秒前)"'), pr2);
  const s2 = index().messages.find((m) => m.job === job2)?.section;
  const l2 = await lesson(thread);
  check('动作落到页上:看第 3 题是认出的题框、圈照认出的行找到、请圈', s2?.lines[0].acts?.map((a) => a.do?.k).join() === '看,圈' && s2.lines[1].acts?.[0].do?.k === '请' && l2?.look?.label === '第3题' && JSON.stringify(l2.look.box) === '[80,420,920,675]' && lessonPage(l2!)!.teacher.marks[0]?.text === '心理辅导室' && lessonPage(l2!)!.open.join() === '圈', JSON.stringify(l2));
  // 第三轮:字不重给;再拍一张接在后面
  now = new Date(2026, 10, 16, 19, 8);
  const p2 = ((await route('POST', `/api/kid/conversations/${T}/photos`, ctx, { image: `data:image/jpeg;base64,${jpeg(1000, 1000).toString('base64')}` })).json as { path: string }).path;
  const third = await kidSend(ctx, T, { text: '还有一张', thread, photos: [p2] });
  await wait();
  const pr3 = promptOf(String(third.json.job));
  const l3 = await lesson(thread);
  check('第三轮:给过的那一张不重给;新拍的接在后面(两张),窗移到第 2 张', !pr3.includes(`<page id="作业#${p1}"`) && pr3.includes('孩子拍的作业照片 2 张(从上往下连着,第 1–2 张)') && (lessonPage(l3!) as { photos: unknown[] }).photos.length === 2 && l3?.look?.label === '第2张', pr3.slice(pr3.indexOf('board:'), pr3.indexOf('board:') + 200));
  const told = (await readBoard(loadWorkspace(root), T, date, thread)).filter((e) => e.k === 'turn').map((e) => (e.k === 'turn' ? [e.told].flat().filter(Boolean).join() : ''));
  check('给过哪一张的字记在那一轮的 told 里', told[1] === `作业#${p1}` && told[0] === '' && told[2] === '', JSON.stringify(told));

  // 没拍:白纸页
  now = new Date(2026, 10, 16, 19, 20);
  const blank = await kidSend(ctx, T, { text: '预习', via: { home: h.home, button: 'preview' } });
  await wait();
  const lb = await lesson(String(blank.json.thread));
  check('不拍就开始:铺一张白纸页;底说白纸', lb?.at === '白纸' && lessonPage(lb!)?.kind === 'white' && promptOf(String(blank.json.job)).includes('底: "白纸(老师摆、写的都在上面)"') && !lessonStrip(lb!), JSON.stringify(lb));

  const JPG = jpeg(10, 10);
  // 课本页:vault 里教材旁边同名文件夹里的图;只列这位老师学科的册子;选了拷进 captures/
  {
    const wsx = loadWorkspace(root);
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(wsx.paths.textbooks, '语文二年级上册'), { recursive: true });
    mkdirSync(join(wsx.paths.textbooks, '数学二年级上册'), { recursive: true });
    writeFileSync(join(wsx.paths.textbooks, '语文二年级上册', '023.jpg'), JPG);
    writeFileSync(join(wsx.paths.textbooks, '语文二年级上册', '5.png'), JPG);
    writeFileSync(join(wsx.paths.textbooks, '语文二年级上册', '说明.txt'), 'x');
    const list = (await route('GET', `/api/kid/textbook-pages?tutor=${T}`, ctx)).json as { books: { book: string; pages: { file: string; n: number }[] }[] };
    check('课本页:只列这位老师学科的册子、只要图,照页码排', JSON.stringify(list) === '{"books":[{"book":"语文二年级上册","pages":[{"file":"5.png","n":5},{"file":"023.jpg","n":23}]}]}', JSON.stringify(list));
    check('数学老师:没有放图的册子不列', ((await route('GET', '/api/kid/textbook-pages?tutor=math-tutor', ctx)).json as { books: unknown[] }).books.length === 0);
    const got = await route('GET', `/api/kid/textbook-page?b=${encodeURIComponent('语文二年级上册')}&f=023.jpg`, ctx);
    const copy = await route('POST', '/api/kid/textbook-page', ctx, { book: '语文二年级上册', file: '023.jpg' });
    const path = (copy.json as { path: string }).path;
    check('看一页给图;选了拷进 captures/(同孩子拍的照片),回路径', got.status === 200 && Boolean(got.file?.endsWith('023.jpg')) && copy.status === 200 && path.startsWith('captures/') && readFileSync(join(root, path)).equals(JPG), JSON.stringify(copy.json));
    const bad = await Promise.all([route('GET', `/api/kid/textbook-page?b=..&f=023.jpg`, ctx), route('GET', `/api/kid/textbook-page?b=${encodeURIComponent('语文二年级上册')}&f=${encodeURIComponent('../x.jpg')}`, ctx), route('POST', '/api/kid/textbook-page', ctx, { book: '语文二年级上册', file: '说明.txt' }), route('GET', '/api/kid/textbook-pages?tutor=nobody', ctx)]);
    check('越界的路径、不是图、没这位老师:404', bad.every((r) => r.status === 404));
  }

  // 头上没写 base 的 activity(2026-11-17 起课里没有卡):当 base: photo,没拍照就是白纸
  const { chatStart, writeChat } = await import('./_chat.ts');
  writeChat(root, [T]);
  const free = await chatStart(ctx, T, { text: '你好' });
  await wait();
  check('头上没写 base 的 activity:记 base: photo,没拍照铺白纸,上下文包有 board:', index().messages.find((m) => m.job === free.json.job)?.base === 'photo' && promptOf(String(free.json.job)).includes('\n  board:') && promptOf(String(free.json.job)).includes('白纸'));
  check('点字只认一节课的话题', (await ctx.runner.boardEvent(T, date, { k: 'pick', thread: String(free.json.thread), text: '变', base: '作业' })) === null);
  await teacher.close();
}

done();
