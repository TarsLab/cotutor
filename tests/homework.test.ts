/**
 * 作业本(检查作业,activity 头上 base: homework;src/runtime/homework.ts):
 * 拍来的照片照原名抄进 vault 的 作业本/<学科>/<日期>/;今天拍过的,新开的检查作业先铺今天这一章、新拍的接在后面;
 * 进门能直接看以前那一天;孩子翻到一天({k:'day'})照 vault 铺、记进板的日志和翻到哪;老师 [[翻 11月20日]] 翻得过去;
 * 一张照片上以前的话题留下的记号换成这张照片自己的坐标;家长端列出几天、导出 PDF(一张一页)。老师与看图都是假的,不花钱、不联网。
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import { kidSend } from './_kid-send.ts';
import { FAKE_RUNTIMES, startFakeTeacher } from './_fake-teacher.ts';
import { writeKeys } from './_keys.ts';
import { pinPhotoPreview } from './_photo-preview.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-homework-')));
process.env.HOME = home;
writeKeys(home, { payg: 'sk-t' });
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
const { lessonInit, lessonPage, lessonStep } = await import('../src/board/lesson.ts');
const { fitAct } = await import('../src/board/lesson-fit.ts');
const { readBoard } = await import('../src/runtime/journal/board-log.ts');
const { lastSpot } = await import('../src/runtime/journal/book-last.ts');
const { jpegPdf } = await import('../src/shared/pdf.ts');
type Lesson = import('../src/schema/index.ts').Lesson;
type PageSource = import('../src/schema/index.ts').PageSource;

/** 一张最小的 jpeg:只有文件头和 SOF0(宽高、3 个分量);h × w */
const jpeg = (w: number, h: number): Buffer => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

/** PDF 的交叉引用表对不对:每个对象的偏移上真是「n 0 obj」;回页数 */
function pdfPages(buf: Buffer): number | null {
  const text = buf.toString('latin1');
  const at = Number(/startxref\n(\d+)/.exec(text)?.[1]);
  if (!text.startsWith('%PDF-') || !text.slice(at).startsWith('xref')) return null;
  const rows = text.slice(at).split('\n').slice(3).filter((l) => / n $/.test(l));
  if (!rows.every((l, i) => text.slice(Number(l.slice(0, 10))).startsWith(`${i + 1} 0 obj`))) return null;
  return Number(/\/Count (\d+)/.exec(text)?.[1]);
}
{
  const one = jpegPdf([jpeg(2000, 1500), Buffer.from('不是图')]);
  check('jpeg 拼 PDF:一张一页,交叉引用的偏移对得上;不是 jpeg 的不收;一张都没有也是一份一页的 PDF', pdfPages(one) === 1 && one.includes(Buffer.from('/DCTDecode')) && pdfPages(jpegPdf([])) === 1);
}

{
  const teacher = await startFakeTeacher();
  process.env.COTUTOR_BRAIN_ENDPOINT = teacher.baseURL;
  const { root } = await initWorkspace({ slug: 'hw', name: '小本', dir: join(home, 'ws-hw') });
  const cfgFile = join(root, 'cotutor.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as { runtimes: unknown; tutors: Record<string, { runtime?: string }> };
  cfg.runtimes = { ...FAKE_RUNTIMES };
  for (const t of Object.values(cfg.tutors)) delete t.runtime;
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  pinPhotoPreview(root);
  let now = new Date(2026, 10, 20, 19, 5);
  const ws = loadWorkspace(root);
  const ctx = createContext(ws, { now: () => now });
  const T = 'math-tutor';
  const wait = async (): Promise<void> => { for (let i = 0; i < 200 && ctx.runner.running(T); i++) await new Promise((r) => setTimeout(r, 25)); await ctx.runner.flush(); };
  const lesson = async (date: string, thread: string): Promise<Lesson | null> => ((await route('GET', `/api/kid/lesson?tutor=${T}&date=${date}&thread=${thread}`, ctx)).json as { lesson: Lesson | null }).lesson;
  const index = (date: string): { messages: { job: string; base?: string }[] } => JSON.parse(readFileSync(join(root, 'conversations', T, `${date}.json`), 'utf8'));
  const promptOf = (date: string, job: string): string => (JSON.parse(readFileSync(join(root, 'conversations', T, `${date}.${job}.run.json`), 'utf8')) as { prompt: string }).prompt;
  const upload = async (w: number, h: number): Promise<string> => ((await route('POST', `/api/kid/conversations/${T}/photos`, ctx, { image: `data:image/jpeg;base64,${jpeg(w, h).toString('base64')}` })).json as { path: string }).path;
  const hw = (day: string, name: string): string => join(ws.paths.homework, '数学', day, name);
  const homePage = (await route('GET', '/api/kid/home', ctx)).json as { home: string | null; cards: { props: { tutor?: string; tiles?: { id: string; base?: string }[] } }[] };
  const tile = homePage.cards.find((c) => c.props.tutor === T)?.props.tiles?.find((x) => x.id === 'check');
  check('首页「检查作业」方砖铺作业本(base: homework)', tile?.base === 'homework', JSON.stringify(tile));
  const via = { home: homePage.home, button: 'check' };

  // ---- 11 月 20 日:拍了一张检查作业,孩子在上面画了一笔、老师圈了一处 ----
  const p1 = await upload(1000, 1400);
  const s1 = await kidSend(ctx, T, { text: '', via, photos: [p1] });
  await wait();
  const th1 = String(s1.json.thread);
  const l1 = await lesson('2026-11-20', th1);
  const pg1 = l1 ? lessonPage(l1) : null;
  check('第一张:话题记 base: homework;照片页就是作业本今天这一章(带 day,章名「11月20日」)', index('2026-11-20').messages[0]?.base === 'homework' && pg1?.kind === 'photo' && pg1.id === '作业' && pg1.day === '2026-11-20' && pg1.title === '11月20日', JSON.stringify(pg1));
  check('照片照原名抄进 vault 的 作业本/数学/2026-11-20/', existsSync(hw('2026-11-20', p1.split('/').pop()!)), p1);
  await ctx.runner.boardEvent(T, '2026-11-20', { k: 'stroke', thread: th1, base: '作业', pts: [[100, 300], [200, 310]] });
  check('第一轮的 board: 说这是作业本今天这一章', promptOf('2026-11-20', String(s1.json.job)).includes('底: "作业本今天这一章《11月20日》'), promptOf('2026-11-20', String(s1.json.job)).slice(promptOf('2026-11-20', String(s1.json.job)).indexOf('board:'), promptOf('2026-11-20', String(s1.json.job)).indexOf('board:') + 160));

  // ---- 11 月 23 日:今天还没拍,作业本里有 20 日;进门直接看 20 日那一天 ----
  now = new Date(2026, 10, 23, 19, 0);
  const base0 = (await route('GET', `/api/kid/homework/base?tutor=${T}`, ctx)).json as { today: string; days: { day: string; n: number; title: string }[]; page: PageSource | null };
  check('作业本有哪几天:20 日 1 张;今天还没拍(page 空,孩子端先到拍照屏)', base0.today === '2026-11-23' && JSON.stringify(base0.days) === '[{"day":"2026-11-20","n":1,"title":"11月20日"}]' && base0.page === null, JSON.stringify(base0));
  const ent = (await route('POST', `/api/kid/enter?tutor=${T}`, ctx, { via, day: '2026-11-20' })).json as { thread: string };
  const th2 = ent.thread;
  const l2 = await lesson('2026-11-23', th2);
  const pg2 = l2 ? lessonPage(l2) : null;
  check('「翻作业本」进门:铺 20 日那一天(id 作业#2026-11-20),照片还是 captures 里那张', pg2?.kind === 'photo' && pg2.id === '作业#2026-11-20' && pg2.day === '2026-11-20' && pg2.photos[0]?.src === p1, JSON.stringify(pg2));
  const past = (await route('GET', `/api/kid/homework/past?tutor=${T}&p=${encodeURIComponent(p1)}&date=2026-11-23&thread=${th2}`, ctx)).json as { marks: unknown[]; ink: [number, number][][] };
  check('以前的记号:20 日那个话题在这张上画的一笔,照这张照片自己的坐标', past.ink.length === 1 && past.ink[0][0][0] === 100 && past.ink[0][0][1] === 300, JSON.stringify(past));
  const pastBefore = (await route('GET', `/api/kid/homework/past?tutor=${T}&p=${encodeURIComponent(p1)}&date=2026-11-20&thread=${th1}`, ctx)).json as { ink: unknown[] };
  check('以前的记号不算这个话题自己的(也不算它之后的)', pastBefore.ink.length === 0, JSON.stringify(pastBefore));

  // 今天拍一张:今天这一章新开(带 day),窗移过去;照片抄进 23 日
  const p2 = await upload(1000, 1300);
  const s2 = await kidSend(ctx, T, { text: '', thread: th2, photos: [p2] });
  await wait();
  const l3 = await lesson('2026-11-23', th2);
  const pg3 = l3 ? lessonPage(l3) : null;
  check('在以前那天上拍了一张:换到今天这一章(作业,11月23日),20 日那一页还在', pg3?.id === '作业' && pg3.kind === 'photo' && pg3.day === '2026-11-23' && pg3.photos.length === 1 && Boolean(l3?.pages.some((p) => p.id === '作业#2026-11-20')) && existsSync(hw('2026-11-23', p2.split('/').pop()!)), JSON.stringify(l3?.pages.map((p) => p.id)));
  check('board: 说作业本还有哪几天、怎么翻', promptOf('2026-11-23', String(s2.json.job)).includes('作业本里还有 11月20日(翻到那一天写 [[翻 11月20日]]'), promptOf('2026-11-23', String(s2.json.job)).slice(promptOf('2026-11-23', String(s2.json.job)).indexOf('board:'), promptOf('2026-11-23', String(s2.json.job)).indexOf('board:') + 300));

  // 孩子自己翻到 20 日:照 vault 铺(铺过的翻回去)、记进板的日志、记下翻到哪;不叫老师
  const day = await ctx.runner.boardEvent(T, '2026-11-23', { k: 'day', thread: th2, base: '作业', day: '2026-11-20' });
  const l4 = await lesson('2026-11-23', th2);
  const turned = (await readBoard(ws, T, '2026-11-23', th2)).filter((e) => e.k === 'open');
  check('孩子翻到 20 日:页换过去、板的日志记一笔、不叫老师;作业本记下翻到 20 日', day?.say === null && l4?.at === '作业#2026-11-20' && turned.at(-1)?.text === '11月20日' && (await lastSpot(ws, '作业本#数学'))?.title === '2026-11-20', JSON.stringify({ day, at: l4?.at, turned }));
  check('翻到不是作业本的、日子不对的不理', (await ctx.runner.boardEvent(T, '2026-11-23', { k: 'day', thread: th2, base: '作业#2026-11-20', day: '2026-11-2' })) === null && (await ctx.runner.boardEvent(T, '2026-11-23', { k: 'day', thread: th2, base: '作业#2026-11-20', day: '2026-11-20' })) === null);
  await ctx.runner.boardEvent(T, '2026-11-23', { k: 'day', thread: th2, base: '作业#2026-11-20', day: '2026-11-23' });
  const s3 = await kidSend(ctx, T, { text: '翻那天的看看', thread: th2 });
  await wait();
  const pr3 = promptOf('2026-11-23', String(s3.json.job));
  const l5 = await lesson('2026-11-23', th2);
  check('下一轮「孩子做的」说他自己翻到了作业本的哪一天', pr3.includes('自己翻到了作业本的《11月23日》'), pr3.slice(pr3.indexOf('board:'), pr3.indexOf('board:') + 400));
  check('老师 [[翻 11月20日]]:翻回那一天(铺过的,原来的在)', l5?.at === '作业#2026-11-20', JSON.stringify(l5?.at));

  // ---- 23 日第二个检查作业:今天拍过,先铺今天这一章(早些时候拍的在上面),新拍的接在后面 ----
  now = new Date(2026, 10, 23, 20, 0);
  const base1 = (await route('GET', `/api/kid/homework/base?tutor=${T}`, ctx)).json as { page: PageSource | null; days: { day: string }[] };
  check('今天拍过:base 给今天这一章(孩子端直接进门铺开)', base1.page?.kind === 'photo' && base1.page.id === '作业' && base1.page.photos[0]?.src === p2 && base1.days.length === 2, JSON.stringify(base1));
  const p3 = await upload(1000, 1200);
  const s4 = await kidSend(ctx, T, { text: '', via, photos: [p3] });
  await wait();
  const l6 = await lesson('2026-11-23', String(s4.json.thread));
  const pg6 = l6 ? lessonPage(l6) : null;
  check('新话题拍了一张:今天这一章先铺早些时候拍的,新拍的接在后面,窗移到新的', pg6?.kind === 'photo' && pg6.photos.map((x) => x.src).join() === [p2, p3].join() && l6?.look?.label === '第2张', JSON.stringify(pg6 && pg6.kind === 'photo' ? pg6.photos : null));

  // ---- 老师翻作业本的一天(lesson-fit):铺过的翻回去,没铺过的照给的那几天 ----
  const dayPage: PageSource = { id: '作业#2026-11-20', kind: 'photo', title: '11月20日', photos: [{ src: p1, w: 1000, h: 1400 }], pick: false, day: '2026-11-20' };
  const fit = fitAct(lessonInit(), { name: '翻', arg: '11月20日' }, { book: null, homework: { pages: [dayPage] } });
  const miss = fitAct(lessonInit(), { name: '翻', arg: '11月19日' }, { book: null, homework: { pages: [dayPage] } });
  check('老师 [[翻 11月20日]] 落成翻到那一页;没有的那天落不了', fit.do?.k === '翻' && fit.do.page.id === '作业#2026-11-20' && !miss.do, JSON.stringify({ fit, miss }));
  check('lessonStep:翻到以前那天再拍照,照片进今天这一章(不进那一天)', (() => {
    const s = lessonStep(lessonStep(lessonInit(), { t: 'act', act: { k: '翻', page: dayPage } }), { t: 'photo', photos: [{ src: 'captures/2026-11-23/x.jpg', w: 10, h: 10 }], pick: false, day: '2026-11-23' });
    const p = lessonPage(s);
    return p?.id === '作业' && p.kind === 'photo' && p.photos.length === 1 && s.pages.find((x) => x.id === '作业#2026-11-20')?.kind === 'photo';
  })());

  // ---- 家长端:列几天、导出 ----
  const parent = (await route('GET', '/api/parent/home', ctx)).json as { tutors: { name: string; homework?: { day: string; n: number }[] }[] };
  const ph = parent.tutors.find((x) => x.name === T)?.homework;
  check('家长端首页:这位老师的作业本有几天、每天几张', JSON.stringify(ph?.map((d) => [d.day, d.n])) === '[["2026-11-20",1],["2026-11-23",2]]', JSON.stringify(ph));
  const pdf = await route('GET', `/api/parent/homework/pdf?tutor=${T}&days=2026-11-20,2026-11-23`, ctx);
  check('导出 PDF:选的两天三张,一张一页;下载的文件名带学科和日子', pdf.status === 200 && pdf.contentType === 'application/pdf' && pdfPages(Buffer.from(pdf.body!)) === 3 && pdf.download === '作业本-数学-11月20日至11月23日.pdf', JSON.stringify({ status: pdf.status, download: pdf.download }));
  check('导出不给日子回 400', (await route('GET', `/api/parent/homework/pdf?tutor=${T}&days=`, ctx)).status === 400);

  // ---- 家长删了 vault 里的一天:作业本不再列;captures 里没有的照 vault 抄回去 ----
  const { rmSync } = await import('node:fs');
  rmSync(join(root, p2));
  const back = (await route('GET', `/api/kid/homework/day?tutor=${T}&day=2026-11-23`, ctx)).json as { page: PageSource };
  check('captures 里没了的(sandbox、家长自己放的)从作业本抄回去,页照旧铺', back.page.kind === 'photo' && back.page.photos.length === 2 && existsSync(join(root, p2)), JSON.stringify(back));
  rmSync(join(ws.paths.homework, '数学', '2026-11-20'), { recursive: true });
  const base2 = (await route('GET', `/api/kid/homework/base?tutor=${T}`, ctx)).json as { days: { day: string }[] };
  check('家长在 vault 里删了 20 日:作业本不再列它', base2.days.map((d) => d.day).join() === '2026-11-23', JSON.stringify(base2.days));
  await teacher.close();
}

done();
