/**
 * cotutor textbook(src/app/cli/textbook.ts):给编程助手整册出课本分块的 list、prep、check、preview、push。
 * 书是 tests/_book.ts 造的那本(PDF 第 1 页目录,印的页码 = PDF 页 − 1),第 2 页加两格(一个填空、一个空着的田字格)当候选;PDF 是假文件、
 * 指纹对上事先写好的索引缓存,所以页图出不来(prep 说一句),preview 用一张自己画的白图。
 * 编程助手从空着的分块写起:这里拿规则出的当它写的(字行有的换成行号),再照编程助手会犯的错一样一样改,check 要说中,push 要等 check 干净才写 vault。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bookIndexOf } from './_book.ts';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-textbook-cli-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { listCommand, prepCommand, checkZoneDir, previewZoneDir, pushZoneDir } = await import('../src/app/cli/textbook.ts');
const { ruleZones } = await import('../src/memory/textbook-zones-rules.ts');
const { bookZones, forgetZones, readZoneBook, vaultZonesDir } = await import('../src/memory/textbook-zones.ts');
const { forgetBooks } = await import('../src/memory/textbook-pdf.ts');
const { decodePng, encodePng } = await import('../src/ui/shared/png.ts');
const { pickZones, walkZones } = await import('../src/schema/index.ts');
type ZonePage = import('../src/schema/index.ts').ZonePage;
type Zone = import('../src/schema/index.ts').Zone;

const { root } = await initWorkspace({ slug: 'book', name: '小书', dir: join(home, 'ws') });
const ws = loadWorkspace(root);
const pdf = Buffer.from('%PDF-1.4 假的,只为算指纹\n');
mkdirSync(ws.paths.textbooks, { recursive: true });
writeFileSync(join(ws.paths.textbooks, '语文一年级下册.pdf'), pdf);
const sha = createHash('sha1').update(pdf).digest('hex').slice(0, 16);
const ix = bookIndexOf();
const p2 = ix.pages.find((p) => p.n === 2)!;
p2.cells = [{ x1: 300, y1: 600, x2: 330, y2: 620, kind: 'blank' }, { x1: 100, y1: 640, x2: 139, y2: 679, kind: 'empty', m: '泡' }];
mkdirSync(join(root, '.cotutor', 'textbooks'), { recursive: true });
writeFileSync(join(root, '.cotutor', 'textbooks', `${sha}.json`), JSON.stringify({ ...ix, sha }));

// ---- list ----
const l = await listCommand(ws, '语文');
const fish = l.books[0]?.lessons.find((x) => x.title === '小鱼吹泡泡');
check('list:每一课在 PDF 的哪几页、印的页码、现在用规则出的', l.books.length === 1 && fish?.pages.join() === '2,3' && fish.printed.join() === '1,2' && fish.zones === 'rules' && l.books[0].lessons.find((x) => x.title === '静夜思')?.depth === 1, JSON.stringify(l));

// ---- prep ----
const dir = join(home, 'work');
const prepped = await prepCommand(ws, '语文', { out: dir });
check('prep:整册摊开,每页一份页面数据、一份空着的分块;book.md、styles.json、progress.json', prepped.pages === ix.pages.length && prepped.drafts === ix.pages.length && ['book.md', 'prep.json', 'progress.json', 'styles.json', '目录-1.json', '001.md', '001.data.json', '001.json', '002.json'].every((f) => existsSync(join(dir, f))), JSON.stringify(prepped));
check('prep:假 PDF 出不了页图,说一句', prepped.noImages && prepped.images === 0);
const md = readFileSync(join(dir, 'book.md'), 'utf8');
check('book.md:PDF 页、页名、种类一页一行;课、样式表', md.includes('| 1 | 目录-1 | 目录 |') && md.includes('| 2 | 1 | 正文 | 小鱼吹泡泡 |') && md.includes('| 小鱼吹泡泡 | 1–2 | 2–3 | 1、2 |') && /\| body 18 \| \d+ \|/.test(md), md.slice(0, 600));
const data = JSON.parse(readFileSync(join(dir, '001.data.json'), 'utf8')) as { name: string; kind: string; lines: { id: string; y: number; style: string; gap: number | null; text: string }[]; cells: { id: string; kind: string }[] };
check('页面数据:行号、离页顶、样式、离上一行的空;能写的格的 id 就是作答区的 id', data.name === '1' && data.kind === '正文' && data.lines[0]?.id === 'L0' && data.lines[0].gap === null && typeof data.lines[1]?.gap === 'number' && data.lines.some((x) => x.style === 'body 18') && data.cells.map((c) => `${c.id}:${c.kind}`).join() === '1-格0:blank,1-格1:empty', JSON.stringify(data).slice(0, 600));
const pageMd = readFileSync(join(dir, '001.md'), 'utf8');
check('001.md:一行一条的表,上一页最后一行', pageMd.startsWith('# 页 1') && pageMd.includes('| 行 | 离顶 | 缩进 | 样式 | 空 | 字 |') && pageMd.includes('上一页最后一行') && pageMd.includes('| 1-格0 | 填空 |'), pageMd.slice(0, 500));
const empty = JSON.parse(readFileSync(join(dir, '001.json'), 'utf8')) as ZonePage;
check('空着的分块:写好协议版本、PDF 页、页名、种类', empty.v === 3 && empty.page === 2 && empty.name === '1' && empty.kind === '正文' && empty.zones.length === 0);

// ---- 空着的就 check:有字的行、能写的格都没人认领 ----
{
  const all = await checkZoneDir(ws, dir);
  check('整册 check 允许有字的目录页只记种类', all.pages === ix.pages.length && !all.problems.some((p) => p.includes('页 目录-1')), JSON.stringify(all.problems));
  const c = await checkZoneDir(ws, dir, { lesson: '小鱼吹泡泡' });
  check('check 空着的一课:有字的行没有块认领、候选没有作答区认领', c.problems.some((p) => p.includes('L1「') && p.includes('没有块认领')) && c.problems.some((p) => p.includes('候选 1-格0(填空)没有作答区认领')), JSON.stringify(c.problems.slice(0, 4)));
}

// 编程助手写的:拿规则出的那份当它写的,字行有的写成行号
const rules = ruleZones({ ...ix, sha });
const write = (n: number, z: ZonePage): void => writeFileSync(join(dir, `00${n - 1}.json`), JSON.stringify(z));
const draft = structuredClone(rules.find((z) => z.page === 2)!);
const paraBox = draft.zones.find((z) => z.kind === 'para')!.box;
const draft3 = structuredClone(rules.find((z) => z.page === 3)!);
{
  const para1 = draft.zones.find((z) => z.kind === 'para')!;
  const i = p2.lines.findIndex((x) => x.text === '小鱼在水里吹泡泡。');
  (para1 as unknown as { rows: unknown[] }).rows = [`L${i}`];
  // 框不写:照字行撑出来
  delete (para1 as Partial<Zone>).box;
}
write(2, draft);
write(3, draft3);
const read = (): ZonePage => JSON.parse(readFileSync(join(dir, '001.json'), 'utf8')) as ZonePage;
/** 挂着这个作答区的块;挂在页上的当页是一块(regions 同一个数组) */
const hostOf = (z: ZonePage, id: string): Pick<Zone, 'regions' | 'label'> => { let h: Pick<Zone, 'regions' | 'label'> | null = null; walkZones(z.zones, (x) => { if (x.regions?.some((r) => r.id === id)) h = x; }); if (h) return h; const page = { label: '页上', get regions() { return z.regions; }, set regions(v) { z.regions = v; } }; return page; };
const problems = async (): Promise<string[]> => (await checkZoneDir(ws, dir, { lesson: '小鱼吹泡泡' })).problems;
const has = async (s: string): Promise<boolean> => (await problems()).some((p) => p.includes(s));

const c0 = await checkZoneDir(ws, dir, { lesson: '小鱼吹泡泡' });
check('check:写好的一课干净(字行写行号也认)', c0.problems.length === 0 && c0.pages === 2 && c0.regions === 2, JSON.stringify(c0.problems));
{
  const again = await prepCommand(ws, '语文', { out: dir });
  check('prep 再跑:写过的分块不动', again.drafts === 0 && JSON.stringify(read()) === JSON.stringify(draft));
}
{
  const z = structuredClone(draft);
  const h = hostOf(z, '1-格0'); h.regions = h.regions!.filter((r) => r.id !== '1-格0');
  write(2, z);
  check('check:候选的空格没人认领,说漏了', await has('候选 1-格0(填空)没有作答区认领'));
  write(2, { ...z, ignore: ['1-格0'] });
  check('check:不是孩子要写的,写进 ignore 就不说', !(await has('候选 1-格0')));
}
{
  const z = structuredClone(draft);
  const r = hostOf(z, '1-格0').regions!.find((x) => x.id === '1-格0')!;
  r.id = '1-填空甲';
  write(2, z);
  check('check:作答区就是候选却换了 id,要写回候选的', await has('就是候选 1-格0'));
  r.box = [10, 10, 20, 20];
  write(2, z);
  check('check:框不在候选里又没说是量的', await has('框不在候选里'));
  r.src = 'measured';
  write(2, z);
  check('check:量的(src: measured)不说', !(await has('框不在候选里')) && !(await has('「填空」')));
  r.id = '填空甲';
  write(2, z);
  check('check:id 不照页名起头', await has('id「填空甲」要照页名起头'));
}
{
  const z = structuredClone(draft);
  const r = hostOf(z, '1-格1').regions!.find((x) => x.id === '1-格1')!;
  r.box = [r.box[0] + 30, r.box[1], r.box[2] + 30, r.box[3]];
  write(2, z);
  check('check:id 是候选的、框和候选对不上', await has('框和候选 1-格1 对不上'));
}
{
  const z = structuredClone(draft);
  const ps = z.zones.filter((x) => x.kind === 'para');
  ps[1].label = ps[0].label;
  (ps[0] as unknown as { rows: unknown[] }).rows = ['L99'];
  ps[0].box = paraBox;
  write(2, z);
  const c = await problems();
  check('check:一课里两块同名、行号这一页没有', c.some((p) => p.includes('都叫「第 1 段」')) && c.some((p) => p.includes('「L99」:这一页没有这一行')), JSON.stringify(c));
  const pushed = await pushZoneDir(ws, dir, { lesson: '小鱼吹泡泡' });
  check('push:有要改的不写 vault', pushed.results.length === 1 && !pushed.results[0].wrote && !existsSync(vaultZonesDir(ws.paths.textbooks, sha)), JSON.stringify(pushed));
}
{
  // 跨页的第 2 段:下一页那一截 cont 指着上一页那块;指错了说
  const z3 = structuredClone(draft3);
  const cont = z3.zones.find((x) => x.cont)!;
  check('规则出的第 2 段跨页:第 2 页那一截写着 cont', Boolean(cont) && cont.cont!.startsWith('1-'), JSON.stringify(z3.zones.map((x) => [x.id, x.cont])));
  cont.cont = '1-99';
  write(3, z3);
  check('check:cont 不是上一页的块', await has('cont「1-99」不是上一页(1)的块'));
  write(3, draft3);
  check('check:接着上一页的那一截和它同名不算重名', !(await has('都叫「第 2 段」')));
}
{
  // 小题只在同一道题里不重名:两道题下面各有一个「7×2」不说;同一道题下面两个才说
  const z = structuredClone(draft);
  const row = p2.lines.findIndex((x) => x.text === '小鱼在水里吹泡泡。');
  const box = paraBox;
  const sub = (id: string): Zone => ({ id, kind: 'sub', label: '7×2', box, rows: [] });
  z.zones.push({ id: '1-8', kind: 'problem', label: '甲题', box, rows: [], children: [sub('1-8.1')] }, { id: '1-9', kind: 'problem', label: '乙题', box, rows: [], children: [sub('1-9.1')] });
  write(2, z);
  check('check:两道题下面各有一个同名的小题,不说', !(await has('7×2')) && row >= 0);
  z.zones[z.zones.length - 1].children!.push(sub('1-9.2'));
  write(2, z);
  check('check:同一道题下面两个同名的小题,说', await has('下面有 2 个小题都叫「7×2」'));
  write(2, draft);
}
writeFileSync(join(dir, '002.json'), '{"v": 3, "page": 3, "name": "2", "kind": "正文", "zones": [{"id": "x"}]}');
check('check:形状不对的页把出错的字段列出来', (await problems()).some((p) => p.startsWith('页 2(PDF 第 3 页):zones.0')));
writeFileSync(join(dir, '002.json'), '{"v": 3, "page": 3, "name": "3", "kind": "正文", "zones": []}');
check('check:页名照 book.md', await has('page、name、kind 照 book.md 写'));
write(3, draft3);

// ---- preview ----
{
  const z = structuredClone(draft);
  const h = hostOf(z, '1-格0'); h.regions = h.regions!.filter((r) => r.id !== '1-格0');
  write(2, z);
  const none = await previewZoneDir(ws, dir, { lesson: '小鱼吹泡泡' });
  check('preview:没有页图的页说一声', none.files.length === 0 && none.missing.join() === '1,2', JSON.stringify(none.missing));
  const W = 520, H = 736;
  writeFileSync(join(dir, '001.png'), encodePng(W, Buffer.alloc(W * H * 3, 255), 3, H));
  const pv = await previewZoneDir(ws, dir, { lesson: '小鱼吹泡泡' });
  const img = decodePng(readFileSync(join(dir, '001.preview.png')))!;
  const at = (x: number, y: number): number[] => { const o = (y * img.w + x) * 3; return [img.px[o], img.px[o + 1], img.px[o + 2]]; };
  check('preview:叠出 001.preview.png,没人认领的候选(填空)描红框', pv.files.length === 1 && img.w === W && img.h === H && at(300, 600).join() === '255,0,0', JSON.stringify(at(300, 600)));
}

// ---- push ----
{
  const z = structuredClone(draft);
  const r = hostOf(z, '1-格1').regions!.find((x) => x.id === '1-格1')!;
  r.box = [r.box[0] + 0.8, r.box[1] + 0.5, r.box[2] + 0.8, r.box[3]];
  r.label = '照着「泡」写';
  const para = z.zones.find((x) => x.kind === 'para')!;
  para.say = '小鱼在水里吹泡泡。';
  write(2, z);
  writeFileSync(join(dir, 'styles.json'), JSON.stringify({ 'body 18': '课文正文', 'title 27.5': '' }));
  const pushed = await pushZoneDir(ws, dir, { lesson: '小鱼吹泡泡' }, new Date('2026-11-25T10:00:00Z'));
  const vdir = vaultZonesDir(ws.paths.textbooks, sha);
  check('push:check 干净才写,一课两页一起写进 vault 的 教材/.zones/<指纹>/,文件照页名', pushed.results.length === 1 && pushed.results[0].wrote && pushed.results[0].title === '小鱼吹泡泡' && existsSync(join(vdir, '001.json')) && existsSync(join(vdir, '002.json')), JSON.stringify(pushed));
  const meta = await readZoneBook(vdir);
  check('push:book.json 记 agent、时间、PDF 页;样式表写了的那几种跟着', meta?.pages['1']?.by === 'agent' && meta.pages['1'].pdf === 2 && meta.pages['1'].at === '2026-11-25T10:00:00.000Z' && meta.styles?.['body 18'] === '课文正文' && !('title 27.5' in meta.styles), JSON.stringify(meta));
  const saved = JSON.parse(readFileSync(join(vdir, '001.json'), 'utf8')) as ZonePage;
  const snapped = hostOf(saved, '1-格1').regions!.find((x) => x.id === '1-格1')!;
  check('push:作答区的框吸到候选上(差一点的换成候选的框)', JSON.stringify(snapped.box) === JSON.stringify(hostOf(draft, '1-格1').regions!.find((x) => x.id === '1-格1')!.box) && snapped.label === '照着「泡」写', JSON.stringify(snapped));
  const sp = saved.zones.find((x) => x.say === '小鱼在水里吹泡泡。')!;
  check('push:行号换成框,没写的框照字行撑出来,每块记上样式', Array.isArray(sp.rows?.[0]) && sp.rows![0].length === 4 && JSON.stringify(sp.box) === JSON.stringify(sp.rows![0]) && sp.style === 'body 18', JSON.stringify(sp));
  const progress = JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8')) as { done: Record<string, { pages: string[] }> };
  check('push:progress.json 记下这一课,book.md 打上勾', progress.done['小鱼吹泡泡@2']?.pages.join() === '1,2' && readFileSync(join(dir, 'book.md'), 'utf8').includes('| 小鱼吹泡泡 | 1–2 | 2–3 | 1、2 | ✓ |'), JSON.stringify(progress));
  forgetBooks(); forgetZones();
  const zones = await bookZones(ws.paths.textbooks, join(root, '.cotutor', 'textbooks'), { ...ix, sha });
  check('push 以后这一课用 vault 的(运行时一课挑一份)', pickZones(zones, [2, 3]).which === 'vault' && pickZones(zones, [2, 3]).pages[0].zones.some((x) => x.say === '小鱼在水里吹泡泡。'));
  check('list:这一课标着 vault', (await listCommand(ws, '语文')).books[0].lessons.find((x) => x.title === '小鱼吹泡泡')?.zones === 'vault');
}
{
  writeFileSync(join(dir, 'prep.json'), JSON.stringify({ file: '语文一年级下册.pdf', sha: 'ffffffffffffffff', title: 'x', layout: 'prose' }));
  let refused = '';
  try { await prepCommand(ws, '语文', { out: dir }); } catch (e) { refused = (e as Error).message; }
  check('prep:目录是另一本(或换过的 PDF)摊开的,不写', refused.includes('另一本课本'), refused);
}

done();
