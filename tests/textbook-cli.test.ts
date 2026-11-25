/**
 * cotutor textbook(src/app/cli/textbook.ts):给编程助手改课本分块的 list、pull、check、preview、push。
 * 书是 tests/_book.ts 造的那本,第 2 页加两格(一个填空、一个空着的田字格)当候选;PDF 是假文件、指纹对上事先写好的索引缓存,所以页图出不来(pull 说一句),
 * preview 用一张自己画的白图。改分块照编程助手会犯的错一样一样改,check 要说中,push 要等 check 干净才写 vault。
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
const { listCommand, pullCommand, checkZoneDir, previewZoneDir, pushZoneDir } = await import('../src/app/cli/textbook.ts');
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

// ---- pull ----
const dir = join(home, 'work');
const pulled = await pullCommand(ws, '语文', { pages: '2', out: dir });
check('pull:给第 2 页,把这一课(2–3 页)都取全;每页一份草稿、一份候选', pulled.meta.pages.join() === '2,3' && pulled.meta.lessons.map((x) => x.title).join() === '小鱼吹泡泡' && ['p002.json', 'p002.candidates.json', 'p003.json', 'pull.json'].every((f) => existsSync(join(dir, f))), JSON.stringify(pulled.meta));
check('pull:假 PDF 出不了页图,说一句', pulled.noImages && pulled.images === 0);
const cand = JSON.parse(readFileSync(join(dir, 'p002.candidates.json'), 'utf8')) as { lines: { id: string; text: string; box: number[] }[]; cells: { id: string; kind: string }[] };
check('候选:文字层的行 L0…、能写的格编号就是规则出的作答区 id', cand.lines[0]?.id === 'L0' && cand.cells.map((c) => `${c.id}:${c.kind}`).join() === '0:blank,1:empty', JSON.stringify(cand.cells));
const again = await pullCommand(ws, '语文', { lesson: '小鱼吹泡泡', out: dir });
check('pull:同一本取到同一个目录可以再取;按课名取也一样', again.meta.pages.join() === '2,3');
writeFileSync(join(home, 'busy.txt'), 'x');
let refused = '';
try { await pullCommand(ws, '语文', { pages: '2', out: home }); } catch (e) { refused = (e as Error).message; }
check('pull:目录不空、也不是 pull 出来的:不写', refused.includes('不是空的'), refused);

// ---- check:草稿本身是干净的;再照编程助手会犯的错一样一样改 ----
const c0 = await checkZoneDir(ws, dir);
check('check:规则出的草稿干净', c0.problems.length === 0 && c0.pages === 2 && c0.regions === 2, JSON.stringify(c0.problems));
const read = (): ZonePage => JSON.parse(readFileSync(join(dir, 'p002.json'), 'utf8')) as ZonePage;
const write = (z: ZonePage): void => writeFileSync(join(dir, 'p002.json'), JSON.stringify(z));
const draft = read();
/** 挂着这个作答区的块;挂在页上的当页是一块(regions 同一个数组) */
const hostOf = (z: ZonePage, id: string): Pick<Zone, 'regions' | 'label'> => { let h: Pick<Zone, 'regions' | 'label'> | null = null; walkZones(z.zones, (x) => { if (x.regions?.some((r) => r.id === id)) h = x; }); if (h) return h; const page = { label: '页上', get regions() { return z.regions; }, set regions(v) { z.regions = v; } }; return page; };
const has = async (s: string): Promise<boolean> => (await checkZoneDir(ws, dir)).problems.some((p) => p.includes(s));
{
  const z = structuredClone(draft);
  const h = hostOf(z, '0'); h.regions = h.regions!.filter((r) => r.id !== '0');
  write(z);
  check('check:候选的空格没人认领,说漏了', await has('候选 0(blank)没有作答区认领'));
  write({ ...z, ignore: ['0'] });
  check('check:不是孩子要写的,写进 ignore 就不说', !(await has('候选 0')));
}
{
  const z = structuredClone(draft);
  const r = hostOf(z, '0').regions!.find((x) => x.id === '0')!;
  r.id = '填空甲';
  write(z);
  check('check:作答区就是候选却换了 id,要写回候选的编号', await has('就是候选 0'));
  r.box = [10, 10, 20, 20];
  write(z);
  check('check:框不在候选里又没说是量的', await has('框不在候选里'));
  r.src = 'measured';
  write(z);
  check('check:量的(src: measured)不说', !(await has('框不在候选里')) && !(await has('「填空」')));
}
{
  const z = structuredClone(draft);
  const r = hostOf(z, '1').regions!.find((x) => x.id === '1')!;
  r.box = [r.box[0] + 30, r.box[1], r.box[2] + 30, r.box[3]];
  write(z);
  check('check:id 是候选的编号、框和候选对不上', await has('框和候选 1 对不上'));
}
{
  const z = structuredClone(draft);
  const ps = z.zones.filter((x) => x.kind === 'para');
  ps[1].label = ps[0].label;
  ps[0].rows![0] = [0, 0, 5, 5];
  write(z);
  const c = await checkZoneDir(ws, dir);
  check('check:一课里两块同名、字行对不上文字层', c.problems.some((p) => p.includes('都叫「第 1 段」')) && c.problems.some((p) => p.includes('对不上文字层的行')), JSON.stringify(c.problems));
  const pushed = await pushZoneDir(ws, dir);
  check('push:有要改的不写 vault', pushed.wrote === 0 && !existsSync(vaultZonesDir(ws.paths.textbooks, sha)));
}
const p3 = readFileSync(join(dir, 'p003.json'), 'utf8');
writeFileSync(join(dir, 'p003.json'), '{"page": 3, "zones": [{"id": "x"}]}');
check('check:形状不对的页把出错的字段列出来', (await checkZoneDir(ws, dir)).problems.some((p) => p.startsWith('第 3 页:zones.0')));
writeFileSync(join(dir, 'p003.json'), p3);

// ---- preview ----
{
  const z = structuredClone(draft);
  const h = hostOf(z, '0'); h.regions = h.regions!.filter((r) => r.id !== '0');
  write(z);
  const none = await previewZoneDir(ws, dir);
  check('preview:没有页图的页说一声', none.files.length === 0 && none.missing.join() === '2,3');
  const W = 520, H = 736;
  writeFileSync(join(dir, 'p002.png'), encodePng(W, Buffer.alloc(W * H * 3, 255), 3, H));
  const pv = await previewZoneDir(ws, dir);
  const img = decodePng(readFileSync(join(dir, 'p002.preview.png')))!;
  const at = (x: number, y: number): number[] => { const o = (y * img.w + x) * 3; return [img.px[o], img.px[o + 1], img.px[o + 2]]; };
  check('preview:叠出 p002.preview.png,没人认领的候选(填空)描红框', pv.files.length === 1 && img.w === W && img.h === H && at(300, 600).join() === '255,0,0', JSON.stringify(at(300, 600)));
}

// ---- push ----
{
  const z = structuredClone(draft);
  const r = hostOf(z, '1').regions!.find((x) => x.id === '1')!;
  r.box = [r.box[0] + 0.8, r.box[1] + 0.5, r.box[2] + 0.8, r.box[3]];
  r.label = '照着「泡」写';
  const para = z.zones.find((x) => x.kind === 'para')!;
  para.say = '小鱼在水里吹泡泡。';
  para.teacher = { goal: '读通第一段', note: '「泡」读轻声' };
  write(z);
  const pushed = await pushZoneDir(ws, dir, new Date('2026-11-25T10:00:00Z'));
  check('push:check 干净才写,一课两页一起写进 vault 的 教材/.zones/<指纹>/', pushed.wrote === 2 && pushed.lessons.join() === '小鱼吹泡泡' && existsSync(join(vaultZonesDir(ws.paths.textbooks, sha), 'p002.json')) && existsSync(join(vaultZonesDir(ws.paths.textbooks, sha), 'p003.json')), JSON.stringify(pushed.check.problems));
  const meta = await readZoneBook(vaultZonesDir(ws.paths.textbooks, sha));
  check('push:book.json 记 agent 和时间', meta?.pages.p002?.by === 'agent' && meta.pages.p002.at === '2026-11-25T10:00:00.000Z', JSON.stringify(meta));
  const saved = JSON.parse(readFileSync(join(vaultZonesDir(ws.paths.textbooks, sha), 'p002.json'), 'utf8')) as ZonePage;
  const snapped = hostOf(saved, '1').regions!.find((x) => x.id === '1')!;
  check('push:作答区的框吸到候选上(差一点的换成候选的框)', JSON.stringify(snapped.box) === JSON.stringify(hostOf(draft, '1').regions!.find((x) => x.id === '1')!.box) && snapped.label === '照着「泡」写', JSON.stringify(snapped));
  forgetBooks(); forgetZones();
  const zones = await bookZones(ws.paths.textbooks, join(root, '.cotutor', 'textbooks'), { ...ix, sha });
  check('push 以后这一课用 vault 的(运行时一课挑一份)', pickZones(zones, [2, 3]).which === 'vault' && pickZones(zones, [2, 3]).pages[0].zones.some((x) => x.say === '小鱼在水里吹泡泡。'));
  check('list:这一课标着 vault', (await listCommand(ws, '语文')).books[0].lessons.find((x) => x.title === '小鱼吹泡泡')?.zones === 'vault');
}

done();
