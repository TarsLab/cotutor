/**
 * 练习册做底(activity 头上 base: workbook;src/memory/workbook.ts 读、src/chalk/kit/workbook.ts 换成课本的样子,往下和课本走同一套):
 * 读 vault 练习册/ 下的一册(写错的各种都回一句)→ 几页换成行、块、能写的格子;给老师的 <page> 列块,练什么和答案照窗给;笔照作答区说 →
 * 讲稿里看第几题、第几页、圈字、翻回练习册 → 首页按钮挂练习册(读不出来的报给家长、孩子端不出)→
 * 孩子端的接口(铺一节课的开头、页图、行和块,作答区的名字和答案不下发;点读一块)→
 * 全流程:点按钮铺上那一册,老师的上下文包里有题和窗里那道题的答案,做题时看、圈、请写落到页上,在格子里写了、圈了下一轮说一句。
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import { kidSend } from './_kid-send.ts';
import { FAKE_RUNTIMES, startFakeTeacher } from './_fake-teacher.ts';
import type { BookPage, Lesson, Workbook, ZonePage } from '../src/schema/index.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-workbook-page-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
const teacher = await startFakeTeacher();
process.env.COTUTOR_BRAIN_ENDPOINT = teacher.baseURL;

const { readWorkbook, workbookImageFile, listWorkbooks } = await import('../src/memory/workbook.ts');
const { bookCellsOf, bookRegions, bookSheets, bookTeacherLines, bookZoneInk, workbookLayer, workbookPage, workbookText } = await import('../src/chalk/index.ts');
const { fitSection } = await import('../src/board/lesson-fit.ts');
const { lessonInit, lessonPage, lessonStep } = await import('../src/board/lesson.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
const { checkHome, publishHome } = await import('../src/runtime/home/store.ts');
const { readIndex, readRunFile } = await import('../src/runtime/journal/store.ts');

/** 两页的一册:第 1 题在第 1 页(圈积木、写组数),第 2 题在第 2 页(圈一盘、写乘法算式,两个乘数能交换;田字格写「乘」是个小题) */
const WB = (): Workbook => ({
  version: 2, id: '表内乘法一', title: '表内乘法（一）练习册', subject: '数学', grade: 2, term: '上',
  source: { edition: '人教版小学数学二年级上册', unit: '表内乘法（一）', printed: [48, 53] },
  pages: [
    {
      image: { file: '01.png', w: 2000, h: 2800, sha256: 'a'.repeat(64) },
      lines: [{ text: '每 4 个积木圈成一组。', box: [80, 100, 600, 140] }, { text: '一共  组', box: [80, 400, 300, 440] }],
      terms: [{ text: '每 4 个', box: [80, 100, 200, 140], kind: 'other' }],
      zones: [{
        id: 'q1', kind: 'problem', label: '第 1 题', box: [60, 80, 940, 480], say: '每 4 个积木圈成一组。一共几组?',
        regions: [
          { id: 'q1-blocks', kind: 'circle', label: '积木区', box: [80, 160, 920, 380] },
          { id: 'q1-groups', kind: 'write', label: '组数', box: [160, 395, 220, 450] },
        ],
        objects: [{ id: 'q1-b1', label: '积木', box: [100, 180, 160, 240], center: [130, 210], region: 'q1-blocks' }],
        teacher: { goal: '12 个积木分成 3 组', hint: '先圈一组,数一数有几个', answers: [{ at: ['q1-blocks'], note: '每组 4 个,圈法可以不同' }, { at: ['q1-groups'], ok: ['3'] }] },
      }],
    },
    {
      image: { file: '02.png', w: 2000, h: 2800, sha256: 'b'.repeat(64) },
      lines: [{ text: '圈出一盘草莓,再写乘法算式。', box: [80, 100, 700, 140] }, { text: '乘法算式 □ × □', box: [80, 400, 500, 440] }],
      terms: [{ text: '一盘', box: [200, 100, 280, 140], kind: 'other' }],
      zones: [{
        id: 'q2', kind: 'problem', label: '第 2 题', box: [60, 80, 940, 480],
        regions: [
          { id: 'q2-a', kind: 'write', label: '乘号左边', box: [260, 395, 320, 450] },
          { id: 'q2-b', kind: 'write', label: '乘号右边', box: [380, 395, 440, 450] },
        ],
        teacher: { goal: '读出几个几', answers: [{ at: ['q2-a', 'q2-b'], ok: ['3×4', '4×3'] }] },
        children: [{
          id: 'q2-写', kind: 'sub', label: '写「乘」', box: [590, 390, 670, 460],
          regions: [{ id: 'q2-tian', kind: 'write', label: '田字格', box: [600, 395, 660, 450], tian: true, model: { glyph: '乘', strokes: [[[1, 1], [2, 2]]] } }],
          teacher: { answers: [{ at: ['q2-tian'], ok: ['乘'] }] },
        }],
      }],
    },
  ],
});
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000000', 'hex');

// ---- 读一册 ----
const dir = join(home, 'books');
const put = (name: string, json: unknown, images = true): void => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, 'workbook.json'), typeof json === 'string' ? json : JSON.stringify(json));
  if (images) { writeFileSync(join(dir, name, '01.png'), PNG); writeFileSync(join(dir, name, '02.png'), PNG); }
};
put('表内乘法', WB());
put('坏的', '{不是 json');
put('形状不对', { ...WB(), version: 1 });
const dup = WB(); dup.pages[1]!.zones[0]!.label = '第 1 题';
put('题号重了', dup);
{
  const ok = await readWorkbook(dir, '表内乘法');
  check('读得出来:过形状与检查', 'wb' in ok && ok.wb.pages.length === 2, JSON.stringify(ok).slice(0, 200));
  const whys = await Promise.all(['../表内乘法', '没有这一册', '坏的', '形状不对', '题号重了'].map(async (n) => { const r = await readWorkbook(dir, n); return 'why' in r ? r.why : ''; }));
  check('读不出来的各回一句:名字不对、不在、不是 JSON、形状不对、检查有问题', whys[0].includes('名字') && whys[1].includes('不在') && whys[2].includes('不是 JSON') && whys[3].includes('形状不对') && whys[4].includes('都叫「第 1 题」'), JSON.stringify(whys));
  const wb = (ok as { wb: Workbook }).wb;
  check('页图:第几页的文件;页不在、名字越界的没有', (await workbookImageFile(dir, '表内乘法', wb, 2))?.endsWith('02.png') === true && (await workbookImageFile(dir, '表内乘法', wb, 3)) === null && (await workbookImageFile(dir, '../表内乘法', wb, 1)) === null);
  check('列出有哪几册(有 workbook.json 的文件夹)', (await listWorkbooks(dir)).join() === ['坏的', '形状不对', '表内乘法', '题号重了'].sort().join(), JSON.stringify(await listWorkbooks(dir)));
}

// ---- 几页换成课本的样子:行、块、能写的格子;给老师的 <page> 与窗里的「给老师的」 ----
{
  const wb = WB();
  const src = workbookPage('表内乘法', wb, false);
  check('铺成一页:id、每页宽 1000、高照图的高宽比', src.id === '练习册#表内乘法' && src.kind === 'workbook' && src.sheets.map((s) => `${s.w}x${s.h}`).join() === '1000x1400,1000x1400', JSON.stringify(src));
  const layer = workbookLayer(wb);
  const sheets = bookSheets(layer.pages);
  const cells = bookCellsOf(layer.pages, sheets, layer.zones);
  check('能写的作答区是格子(id 是 <页>.<作答区 id>):田字格是空格(照着范字写),别的是填空;第 2 页从 1430 起,竖的乘高宽比', cells.map((c) => `${c.id}:${c.kind}${c.m ?? ''}`).join() === '1.q1-groups:blank,2.q2-a:blank,2.q2-b:blank,2.q2-tian:empty乘' && cells[1]!.box[1] === 1430 + 553, JSON.stringify(cells));
  const q2 = layer.blocks.find((b) => b.label === '第 2 题');
  check('块读回来:第 2 题是题(no 2),框住的行、带自己的框;小题跟在后面', q2?.kind === 'problem' && q2.no === 2 && q2.text.includes('乘法算式') && q2.area?.n === 2 && q2.kids === 1 && layer.blocks[layer.blocks.indexOf(q2) + 1]?.label === '写「乘」', JSON.stringify(layer.blocks));
  check('挑出的字词那几行不归给块(不重说)', !layer.blocks.some((b) => b.text.includes('一盘 ') || b.text.startsWith('一盘')), JSON.stringify(layer.blocks.map((b) => b.text)));
  const text = workbookText(layer.blocks, 2).join('\n');
  check('给老师的 <page>:这一页的块,叫法和印着的字,小题缩进;没有答案、练什么', text === '第 2 题 圈出一盘草莓,再写乘法算式。 乘法算式 □ × □\n  〔写「乘」〕', text);
  const t2 = bookTeacherLines(layer.pages, sheets, layer.blocks, [[0, 1430, 1000, 2830]]).join('\n');
  check('窗在第 2 页:给老师的是第 2 题的练什么、答案(格换成名字),小题一行说完;第 1 题的不给', t2.includes('第 2 题:练 读出几个几') && t2.includes('答案 乘号左边、乘号右边:3×4 或 4×3') && t2.includes('写「乘」:答案 田字格:乘') && !t2.includes('积木'), t2);
  // 连线的答案:两头换成东西的名字(不说 id)
  const linked = WB();
  const q2z = linked.pages[1]!.zones[0]!;
  q2z.regions!.push({ id: 'q2-link', kind: 'link', label: '连线区', box: [100, 300, 900, 380] });
  q2z.objects = [
    { id: 'q2-l', label: '3 个 4', box: [110, 310, 160, 330], center: [135, 320], region: 'q2-link', side: 'left' },
    { id: 'q2-r', label: '4×3', box: [800, 310, 850, 330], center: [825, 320], region: 'q2-link', side: 'right' },
  ];
  q2z.teacher!.answers!.push({ at: ['q2-link'], links: [['q2-l', 'q2-r']] });
  const ll = workbookLayer(linked);
  const tl = bookTeacherLines(ll.pages, bookSheets(ll.pages), ll.blocks, [[0, 1430, 1000, 2830]]).join('\n');
  check('连线的答案照东西的名字说', tl.includes('答案 连线区:3 个 4—4×3'), tl);
  const names = bookRegions(layer.pages, sheets, layer.zones).map((r) => r.label);
  check('作答区的名字接上它在哪一块', names.join() === '第 1 题的积木区,第 1 题的组数,第 2 题的乘号左边,第 2 题的乘号右边,第 2 题的写「乘」的田字格', names.join());
}

// ---- 孩子用笔圈、画、写的,照作答区说成几句 ----
/** 一个椭圆(场景坐标),open = 只画一半(没合拢) */
const ring = (cx: number, cy: number, rx: number, ry: number, open = false): [number, number][] =>
  Array.from({ length: open ? 17 : 33 }, (_, i) => [Math.round(cx + rx * Math.cos((Math.PI * i) / 16)), Math.round(cy + ry * Math.sin((Math.PI * i) / 16))] as [number, number]);
{
  const layer = workbookLayer(WB());
  const regions = bookRegions(layer.pages, bookSheets(layer.pages), layer.zones);
  // 第 1 页高宽比 1.4:积木 q1-b1 的中心在场景 (130, 294)
  const lines = bookZoneInk(regions, [
    ring(130, 294, 50, 60),
    ring(130 + 40, 294, 50, 60),
    ring(500, 400, 60, 40, true),
    [[180, 580], [200, 610]],
    [[900, 1300], [920, 1320]],
  ]);
  check('圈:一圈围住了几个、压着圈线的另说、没合拢的说一句', lines[0] === '在「第 1 题的积木区」圈了 2 圈,各围住 1、0 个积木(另有 1 个压着圈线),还有 1 笔没合拢(写成什么样看图)', JSON.stringify(lines));
  check('写在格子上的笔:哪一格几笔;不在作答区的数一句', lines.includes('在「第 1 题的组数」写了 1 笔(写成什么样看图)') && lines.includes('还有 1 笔不在作答区里(写成什么样看图)'), JSON.stringify(lines));
  check('没有笔:不说', bookZoneInk(regions, []).length === 0);
}

// ---- 讲稿里的动作落到练习册上 ----
{
  const wb = WB();
  const l0 = lessonStep(lessonInit(), { t: 'act', act: { k: '翻', page: workbookPage('表内乘法', wb, false) } });
  const src = { book: null, workbooks: { 表内乘法: wb } };
  const fit = fitSection({ lines: [
    { text: '看第 2 题。', ask: false, acts: [{ name: '看', arg: '第 2 题' }, { name: '圈', arg: '一盘' }] },
    { text: '再看第 1 页。', ask: false, acts: [{ name: '看', arg: '第 1 页' }] },
    { text: '翻到白纸再回来。', ask: false, acts: [{ name: '翻', arg: '白纸' }, { name: '翻', arg: '练习册' }] },
  ] }, l0, src);
  const [a, b, c] = fit.section.lines;
  const look = a!.acts?.[0]?.do as { k: string; label: string; box: number[] } | undefined;
  check('看第 2 题:第 2 页上那一道的框(场景里第 2 页从 1430 起)', look?.label === '第2题' && look.box[1] > 1400, JSON.stringify(look));
  check('圈:照第 2 页的字词找到', a!.acts?.[1]?.do?.k === '圈', JSON.stringify(a!.acts?.[1]));
  check('看第 1 页:整页', (b!.acts?.[0]?.do as { label?: string } | undefined)?.label === '第1页', JSON.stringify(b!.acts));
  check('翻白纸、再翻回练习册', c!.acts?.[0]?.do?.k === '翻' && (c!.acts?.[1]?.do as { page?: { id: string } } | undefined)?.page?.id === '练习册#表内乘法' && fit.why.length === 0, JSON.stringify([c!.acts, fit.why]));
}

// ---- 首页挂练习册、孩子端的接口、全流程 ----
const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as { runtimes: unknown; tutors: Record<string, { runtime?: string }>; paths?: Record<string, string> };
cfg.runtimes = { ...FAKE_RUNTIMES };
for (const t of Object.values(cfg.tutors)) delete t.runtime;
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const now = new Date(2026, 10, 23, 16, 0);
const DATE = '2026-11-23';
const ctx = createContext(loadWorkspace(root), { now: () => now });
const ws = ctx.ws;
mkdirSync(ws.paths.workbooks, { recursive: true });
const books = ws.paths.workbooks;
mkdirSync(join(books, '表内乘法'), { recursive: true });
writeFileSync(join(books, '表内乘法', 'workbook.json'), JSON.stringify(WB()));
writeFileSync(join(books, '表内乘法', '01.png'), PNG);
writeFileSync(join(books, '表内乘法', '02.png'), PNG);
const M = 'math-tutor';
const HOME = (buttons: string): string => `\`\`\`tutor ${M}\n${buttons}\n\`\`\`\n\n## 为什么这么排\n\n做练习册\n`;
const wait = async (): Promise<void> => { for (let i = 0; i < 200 && ctx.runner.running(M); i++) await new Promise((r) => setTimeout(r, 25)); await ctx.runner.flush(); };
const prompt = async (job: string): Promise<string> => (await readRunFile(ws, M, DATE, job))!.prompt;
try {
  check('出厂的数学老师家里有「做练习册」(练习册 vault 角色缺省是 练习册/)', readFileSync(join(root, 'agents', M, 'activities', '做练习册.md'), 'utf8').includes('base: workbook') && ws.paths.workbooks.endsWith('练习册'));
  const bad = await checkHome(ws, HOME('activity 做练习册\n练习册: 没有这一册'), now);
  check('首页检查:挂的练习册读不出来,要改', bad.issues.some((i) => i.level === 'fix' && i.text.includes('没有这一册') && i.text.includes('不在')), JSON.stringify(bad.issues));
  const noParam = await checkHome(ws, HOME('activity 做练习册'), now);
  check('首页检查:没填练习册,要改', noParam.issues.some((i) => i.level === 'fix' && i.text.includes('要填「练习册」')), JSON.stringify(noParam.issues));
  mkdirSync(join(root, 'home'), { recursive: true });
  writeFileSync(join(root, 'home', 'draft.md'), HOME('activity 做练习册 做乘法练习\n练习册: 表内乘法\nactivity 做练习册 做坏的\n练习册: 没有这一册'));
  const pub = await publishHome(ws, { now, force: true });
  check('发布了(带一颗挂了读不出来的)', pub.ok, JSON.stringify(pub.check.issues));
  const kid = (await route('GET', '/api/kid/home', ctx)).json as { home: string; cards: { props: { tutor?: string; buttons?: { id: number; kind: string; label: string; base?: string; workbook?: string; cover?: { kind: string; image: string } }[] } }[] };
  const btns = kid.cards.find((c) => c.props.tutor === M)?.props.buttons ?? [];
  check('孩子端:挂着读得出来的那一册的按钮带上册名与 base;读不出来的那颗不出', btns.length === 1 && btns[0]!.label === '做乘法练习' && btns[0]!.base === 'workbook' && btns[0]!.workbook === '表内乘法', JSON.stringify(btns));

  const cv = btns[0]?.cover;
  const cvImg = cv ? await route('GET', cv.image, ctx) : null;
  check('首页那颗是竖版卡,封面是这一册的第一页', cv?.kind === 'workbook' && cvImg?.status === 200 && String(cvImg.file).endsWith('01.png'), JSON.stringify({ cv, s: cvImg?.status, f: cvImg?.file }));

  // 孩子端的接口
  const base = (await route('GET', `/api/kid/workbook/base?tutor=${M}&w=${encodeURIComponent('表内乘法')}`, ctx)).json as { lesson: Lesson };
  const bp = lessonPage(base.lesson);
  check('铺一节课的开头:练习册那一页,数学不开点字', bp?.kind === 'workbook' && bp.src === '表内乘法' && bp.pick === false && bp.open.length === 0, JSON.stringify(bp));
  const img = await route('GET', `/api/kid/workbook/image?w=${encodeURIComponent('表内乘法')}&p=2`, ctx);
  check('页图:第 2 页的 png', img.status === 200 && String(img.file).endsWith('02.png') && img.contentType === 'image/png', JSON.stringify({ s: img.status, f: img.file }));
  const lines = (await route('GET', `/api/kid/workbook/lines?w=${encodeURIComponent('表内乘法')}`, ctx)).json as { pages: BookPage[]; zones: ZonePage[] };
  check('行和块:两页,块带框和念法、作答区都在;答案、作答区的名字、给老师的提示、物件都不下发', lines.pages.length === 2 && lines.zones.length === 2 && lines.zones[0]!.zones[0]!.say === '每 4 个积木圈成一组。一共几组?' && lines.zones[1]!.zones[0]!.regions?.length === 2 && !/3×4|乘号左边|先圈一组|读出几个几|积木区|q1-b1/.test(JSON.stringify(lines)), JSON.stringify(lines).slice(0, 300));
  // 点读一块:用这位老师点读的声音合成那一块的念法
  {
    const { startFakeTts } = await import('./_fake-tts.ts');
    const tts = await startFakeTts();
    process.env.COTUTOR_TTS_ENDPOINT = tts.url;
    const sy = (z: string) => route('GET', `/api/kid/workbook/say?tutor=${M}&w=${encodeURIComponent('表内乘法')}&z=${encodeURIComponent(z)}`, ctx);
    const [s1, s2, sNo] = [await sy('q1'), await sy('q1'), await sy('q2')];
    check('点读一块:照块的念法合成、回声音,再要不再合成;没写念法的块 404', s1.status === 200 && s1.contentType === 'audio/mpeg' && readFileSync(s1.file!, 'utf8').endsWith(':每 4 个积木圈成一组。一共几组?') && s2.status === 200 && tts.requests.length === 1 && sNo.status === 404, JSON.stringify([s1.status, s1.file, sNo.status, tts.requests]));
    delete process.env.COTUTOR_TTS_ENDPOINT;
    await tts.close();
  }
  const nf = await Promise.all([`/api/kid/workbook/base?w=${encodeURIComponent('../表内乘法')}`, '/api/kid/workbook/lines?w=nope', `/api/kid/workbook/image?w=${encodeURIComponent('表内乘法')}&p=9`].map((u) => route('GET', u, ctx)));
  check('越界、不在、页不在:404', nf.every((r) => r.status === 404), JSON.stringify(nf.map((r) => r.status)));

  // 全流程:点按钮 → 铺上那一册;老师的上下文包里有题和答案
  const t1 = await kidSend(ctx, M, { text: '', via: { home: kid.home, button: 0 } });
  check('点按钮:202', t1.status === 202, JSON.stringify(t1.json));
  await wait();
  const job1 = String(t1.json.job), thread = String(t1.json.thread);
  const m1 = (await readIndex(ws, M, DATE)).messages.find((m) => m.job === job1);
  check('第一条:base 是 workbook,参数记着那一册', m1?.base === 'workbook' && JSON.stringify(m1.activity) === JSON.stringify({ name: '做练习册', params: { 练习册: '表内乘法' } }), JSON.stringify(m1));
  const lessonNow = async (): Promise<Lesson> => ((await route('GET', `/api/kid/lesson?tutor=${M}&date=${DATE}&thread=${thread}`, ctx)).json as { lesson: Lesson }).lesson;
  check('一节课的状态:铺的是练习册', (await lessonNow()).at === '练习册#表内乘法', JSON.stringify((await lessonNow()).at));
  const p1 = await prompt(job1);
  check('上下文包:底是练习册;两页各一条 <page>,有题和题面;窗里第 1 题的练什么、答案在「给老师的」,第 2 题的答案还不给', p1.includes('底: "练习册《表内乘法（一）练习册》2 页') && p1.includes('name="《表内乘法（一）练习册》第1页"') && p1.includes('第 2 题 圈出一盘草莓') && p1.includes('第 1 题:练 12 个积木分成 3 组') && p1.includes('答案 组数:3') && !p1.includes('3×4 或 4×3'), p1.slice(p1.indexOf('board:'), p1.indexOf('board:') + 1200));

  // 做题:看第 2 题、圈一盘、请写
  const t2 = await kidSend(ctx, M, { text: '我们做题吧', thread });
  await wait();
  const l2 = await lessonNow();
  const pg2 = lessonPage(l2)!;
  check('做题:看着第 2 题,「一盘」圈上了,请了写', l2.look?.label === '第2题' && pg2.teacher.marks.some((m) => m.k === '圈' && m.text === '一盘') && pg2.open.join() === '写', JSON.stringify({ look: l2.look, marks: pg2.teacher.marks, open: pg2.open }));
  check('第二轮不重给页的字', !(await prompt(String(t2.json.job))).includes('<page id="练习册#表内乘法#1"'));
  // 在第 2 页乘号左边那格写了 3(填空):请着写,替他交;下一轮说一句
  const cell = await ctx.runner.boardEvent(M, DATE, { k: 'cell', thread, base: '练习册#表内乘法', id: '2.q2-a', strokes: [[[300, 100], [300, 900]]], blank: true });
  check('写进格子:落进孩子那一层,请着写就替他交', cell?.asked === true && (lessonPage(await lessonNow())!.kid.cells?.['2.q2-a']?.length ?? 0) === 1, JSON.stringify(cell));
  // 直接在页上圈(第 1 页的积木)
  await ctx.runner.boardEvent(M, DATE, { k: 'stroke', thread, base: '练习册#表内乘法', pts: ring(130, 294, 50, 60) });
  const t3 = await kidSend(ctx, M, { text: '我写好了', thread });
  await wait();
  check('下一轮:孩子做的里说圈住了几个', (await prompt(String(t3.json.job))).includes('在「第 1 题的积木区」圈了 1 圈,各围住 1 个积木'), (await prompt(String(t3.json.job))).slice((await prompt(String(t3.json.job))).indexOf('孩子做的'), (await prompt(String(t3.json.job))).indexOf('孩子做的') + 300));
  check('老师看了第 2 题:下一轮给老师的有第 2 题的答案', (await prompt(String(t3.json.job))).includes('答案 乘号左边、乘号右边:3×4 或 4×3'));
  check('下一轮:孩子做的里说填了哪一处', (await prompt(String(t3.json.job))).includes('在页上的空(方框、括号)里填了 1 处:「第 2 题的乘号左边」'), (await prompt(String(t3.json.job))).slice((await prompt(String(t3.json.job))).indexOf('孩子做的'), (await prompt(String(t3.json.job))).indexOf('孩子做的') + 120));

  // 记住翻到哪:挪窗停下记在「练习册#<名>」上;下次进门铺这一册,窗摆回那里
  await ctx.runner.boardEvent(M, DATE, { k: 'view', thread, base: '练习册#表内乘法', box: [0, 1400, 1000, 2100] });
  const door = await route('POST', `/api/kid/enter?tutor=${M}`, ctx, { via: { home: kid.home, button: 0 } });
  const th2 = String((door.json as { thread?: string }).thread ?? '');
  const lDoor = ((await route('GET', `/api/kid/lesson?tutor=${M}&date=${DATE}&thread=${th2}`, ctx)).json as { lesson: Lesson }).lesson;
  check('再进门:铺这一册,窗摆回上次停的地方', door.status === 200 && lDoor.at === '练习册#表内乘法' && JSON.stringify(lDoor.view) === '[0,1400,1000,2100]', JSON.stringify([door.status, lDoor.at, lDoor.view]));
} finally {
  await teacher.close();
}

done();
