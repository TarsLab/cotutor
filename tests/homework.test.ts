/**
 * 作业本(检查作业,activity 头上 base: homework;src/runtime/homework.ts):
 * 拍来的照片照原名抄进 vault 的 作业本/<学科>/<日期>/;检查作业进门铺一整本(老的在上,每张记着哪天拍的),新拍的接在后面;
 * 孩子滚到以前那天照挪窗记(「11月20日第1张」);老师 [[翻 11月20日]] 是窗移到那一天,「第 1 张」是今天的;
 * 一整本照片上以前的话题留下的记号一次给、换成每张照片自己的坐标;家长端列出几天、导出 PDF(一张一页)。老师与看图都是假的,不花钱、不联网。
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
const { lessonInit, lessonPage, lessonStep, photoSheetBox } = await import('../src/board/lesson.ts');
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

  // ---- 11 月 20 日:拍了一张检查作业,孩子在上面画了一笔 ----
  const p1 = await upload(1000, 1400);
  const s1 = await kidSend(ctx, T, { text: '', via, photos: [p1] });
  await wait();
  const th1 = String(s1.json.thread);
  const l1 = await lesson('2026-11-20', th1);
  const pg1 = l1 ? lessonPage(l1) : null;
  check('第一张:话题记 base: homework;照片页就是作业本(id 作业,名字「作业本」,day 今天),照片记着哪天拍的', index('2026-11-20').messages[0]?.base === 'homework' && pg1?.kind === 'photo' && pg1.id === '作业' && pg1.day === '2026-11-20' && pg1.title === '作业本' && pg1.photos[0]?.day === '2026-11-20', JSON.stringify(pg1));
  check('照片照原名抄进 vault 的 作业本/数学/2026-11-20/', existsSync(hw('2026-11-20', p1.split('/').pop()!)), p1);
  const top1 = pg1?.kind === 'photo' ? photoSheetBox(pg1.photos, 0, pg1.day)[1] : NaN;
  await ctx.runner.boardEvent(T, '2026-11-20', { k: 'stroke', thread: th1, base: '作业', pts: [[100, top1 + 110], [200, top1 + 120]] });
  const pr1 = promptOf('2026-11-20', String(s1.json.job));
  check('第一轮的 board: 说这是作业本、今天拍了 1 张', pr1.includes('底: "作业本(') && pr1.includes('今天拍了 1 张'), pr1.slice(pr1.indexOf('board:'), pr1.indexOf('board:') + 200));

  // ---- 11 月 23 日:进门铺整本(20 日那张在上面,今天还没拍,最后是白纸) ----
  now = new Date(2026, 10, 23, 19, 0);
  const ent = (await route('POST', `/api/kid/enter?tutor=${T}`, ctx, { via })).json as { thread: string };
  const th2 = ent.thread;
  const l2 = await lesson('2026-11-23', th2);
  const pg2 = l2 ? lessonPage(l2) : null;
  check('进门:铺作业本一整本(20 日那张还是 captures 里那张,记着 20 日),不铺白纸页', pg2?.kind === 'photo' && pg2.id === '作业' && pg2.day === '2026-11-23' && pg2.photos.length === 1 && pg2.photos[0].src === p1 && pg2.photos[0].day === '2026-11-20' && l2?.pages.length === 1, JSON.stringify(l2?.pages));
  const past = (await route('GET', `/api/kid/homework/past?tutor=${T}&date=2026-11-23&thread=${th2}`, ctx)).json as { past: Record<string, { marks: unknown[]; ink: [number, number][][] }> };
  check('以前的记号:一整本要一次;20 日那个话题在这张上画的一笔,照这张照片自己的坐标', past.past[p1]?.ink.length === 1 && past.past[p1].ink[0][0][0] === 100 && past.past[p1].ink[0][0][1] === 110, JSON.stringify(past));
  const pastBefore = (await route('GET', `/api/kid/homework/past?tutor=${T}&date=2026-11-20&thread=${th1}`, ctx)).json as { past: Record<string, unknown> };
  check('以前的记号不算这个话题自己的(也不算它之后的);话题不对回 400', !pastBefore.past[p1] && (await route('GET', `/api/kid/homework/past?tutor=${T}&date=x&thread=${th1}`, ctx)).status === 400, JSON.stringify(pastBefore));

  // 今天拍一张:接在整本后面(记着 23 日),窗移过去;照片抄进 23 日
  const p2 = await upload(1000, 1300);
  const s2 = await kidSend(ctx, T, { text: '', thread: th2, photos: [p2] });
  await wait();
  const l3 = await lesson('2026-11-23', th2);
  const pg3 = l3 ? lessonPage(l3) : null;
  check('今天拍了一张:接在 20 日那张后面,记着 23 日;窗看的是今天的第 1 张', pg3?.kind === 'photo' && pg3.photos.map((x) => `${x.src}@${x.day}`).join() === `${p1}@2026-11-20,${p2}@2026-11-23` && l3?.look?.label === '第1张' && existsSync(hw('2026-11-23', p2.split('/').pop()!)), JSON.stringify(pg3));
  const pr2 = promptOf('2026-11-23', String(s2.json.job));
  check('board: 说今天拍了几张、往前还有哪几天、怎么翻', pr2.includes('今天拍了 1 张') && pr2.includes('往前还有 11月20日(1 张)') && pr2.includes('[[翻 11月20日]]'), pr2.slice(pr2.indexOf('board:'), pr2.indexOf('board:') + 400));

  // 孩子滚到 20 日那张停下:照挪窗记,说成「11月20日第1张」;不叫老师
  const box20 = pg3?.kind === 'photo' ? photoSheetBox(pg3.photos, 0, pg3.day) : ([0, 0, 0, 0] as const);
  const view = await ctx.runner.boardEvent(T, '2026-11-23', { k: 'view', thread: th2, base: '作业', box: [0, box20[1], 1000, box20[1] + 700] });
  const views = (await readBoard(ws, T, '2026-11-23', th2)).filter((e) => e.k === 'view');
  check('孩子滚到 20 日:窗停下记一笔「11月20日第1张」,不叫老师;作业本不另记翻到哪', view?.say === null && views.at(-1)?.text === '11月20日第1张' && (await lastSpot(ws, '作业本#数学')) === null, JSON.stringify({ view, views }));
  check('翻到别处的事不认了({k:\'day\'})', (await ctx.runner.boardEvent(T, '2026-11-23', { k: 'day', thread: th2, base: '作业', day: '2026-11-20' })) === null);
  const s3 = await kidSend(ctx, T, { text: '翻那天的看看', thread: th2 });
  await wait();
  const pr3 = promptOf('2026-11-23', String(s3.json.job));
  const l5 = await lesson('2026-11-23', th2);
  check('下一轮「孩子在看」说他停在 20 日那张', pr3.includes('11月20日第1张'), pr3.slice(pr3.indexOf('board:'), pr3.indexOf('board:') + 500));
  check('老师 [[翻 11月20日]]:窗移到那一天(还是作业本这一页)', l5?.at === '作业' && l5.look?.label === '11月20日' && l5.look.box[1] === box20[1], JSON.stringify(l5?.look));

  // ---- 23 日第二个检查作业:整本里早些时候拍的在上面,新拍的接在后面 ----
  now = new Date(2026, 10, 23, 20, 0);
  const p3 = await upload(1000, 1200);
  const s4 = await kidSend(ctx, T, { text: '', via, photos: [p3] });
  await wait();
  const l6 = await lesson('2026-11-23', String(s4.json.thread));
  const pg6 = l6 ? lessonPage(l6) : null;
  check('新话题拍了一张:整本(20 日、23 日早些时候的)接上新拍的,窗看的是今天的第 2 张', pg6?.kind === 'photo' && pg6.photos.map((x) => x.src).join() === [p1, p2, p3].join() && l6?.look?.label === '第2张', JSON.stringify(pg6 && pg6.kind === 'photo' ? pg6.photos : null));

  // ---- 老师在作业本上翻一天、看一张(lesson-fit) ----
  const bookPage: PageSource = { id: '作业', kind: 'photo', title: '作业本', photos: [{ src: p1, w: 1000, h: 1400, day: '2026-11-20' }, { src: p2, w: 1000, h: 1300, day: '2026-11-23' }], pick: false, day: '2026-11-23' };
  const onBook = lessonStep(lessonInit(), { t: 'act', act: { k: '翻', page: bookPage } });
  const fit = fitAct(onBook, { name: '翻', arg: '11月20日' }, { book: null });
  const look1 = fitAct(onBook, { name: '看', arg: '第 1 张' }, { book: null });
  const look20 = fitAct(onBook, { name: '看', arg: '11月20日第1张' }, { book: null });
  const miss = fitAct(onBook, { name: '翻', arg: '11月19日' }, { book: null });
  check('作业本上 [[翻 11月20日]] 落成看那一天;「第 1 张」是今天的,以前的写日子;没有的那天落不了', fit.do?.k === '看' && fit.do.label === '11月20日' && look1.do?.k === '看' && look1.do.box[1] === photoSheetBox(bookPage.photos, 1, bookPage.day)[1] && look20.do?.k === '看' && look20.do.label === '11月20日第1张' && !miss.do, JSON.stringify({ fit, look1, look20, miss }));
  check('在白纸页上 [[翻 11月20日]] 回到作业本', (() => { const w = lessonStep(onBook, { t: 'act', act: { k: '翻', page: { id: '白纸', kind: 'white', title: '白纸', pick: false } } }); const r = fitAct(w, { name: '翻', arg: '11月20日' }, { book: null }); return r.do?.k === '翻' && r.do.page.id === '作业'; })());

  // ---- 家长端:列几天、导出 ----
  const parent = (await route('GET', '/api/parent/home', ctx)).json as { tutors: { name: string; homework?: { day: string; n: number }[] }[] };
  const ph = parent.tutors.find((x) => x.name === T)?.homework;
  check('家长端首页:这位老师的作业本有几天、每天几张', JSON.stringify(ph?.map((d) => [d.day, d.n])) === '[["2026-11-20",1],["2026-11-23",2]]', JSON.stringify(ph));
  const pdf = await route('GET', `/api/parent/homework/pdf?tutor=${T}&days=2026-11-20,2026-11-23`, ctx);
  check('导出 PDF:选的两天三张,一张一页;下载的文件名带学科和日子', pdf.status === 200 && pdf.contentType === 'application/pdf' && pdfPages(Buffer.from(pdf.body!)) === 3 && pdf.download === '作业本-数学-11月20日至11月23日.pdf', JSON.stringify({ status: pdf.status, download: pdf.download }));
  check('导出不给日子回 400', (await route('GET', `/api/parent/homework/pdf?tutor=${T}&days=`, ctx)).status === 400);

  // ---- 家长删了 vault 里的一天:作业本不再铺它;captures 里没有的照 vault 抄回去 ----
  const { rmSync } = await import('node:fs');
  rmSync(join(root, p2));
  rmSync(join(ws.paths.homework, '数学', '2026-11-20'), { recursive: true });
  now = new Date(2026, 10, 24, 19, 0);
  const ent3 = (await route('POST', `/api/kid/enter?tutor=${T}`, ctx, { via })).json as { thread: string };
  const l7 = await lesson('2026-11-24', ent3.thread);
  const pg7 = l7 ? lessonPage(l7) : null;
  check('家长在 vault 里删了 20 日:作业本不再铺它;captures 里没了的(sandbox、家长自己放的)从作业本抄回去', pg7?.kind === 'photo' && pg7.photos.map((x) => x.src).join() === [p2, p3].join() && existsSync(join(root, p2)), JSON.stringify(pg7));
  await teacher.close();
}

done();
