/**
 * 工作台「分块」页的接口(src/app/http/dev-zones.ts):列课本和每一课用的哪份、读一课(挑好的分块、候选、语文的字)、边改边查、
 * 一课一起存(规则出的那一课整课写进 vault,记 workbench;别处改过 409;查出要改的不存)、还原成规则出的、换过的课本留下的旧分块;
 * 页面里内联的分块脚本能解析。书是 tests/_book.ts 造的那本(第 2 页加两格当候选),PDF 是假文件、指纹对上事先写好的索引缓存。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bookIndexOf } from './_book.ts';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-dev-zones-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
const { readZoneBook, vaultZonesDir } = await import('../src/memory/textbook-zones.ts');
const { walkZones } = await import('../src/schema/index.ts');
const { DEV_PAGE } = await import('../src/ui/dev/dev-page.ts');
type ZonePage = import('../src/schema/index.ts').ZonePage;

const { root } = await initWorkspace({ slug: 'book', name: '小书', dir: join(home, 'ws') });
const ws = loadWorkspace(root);
const ctx = createContext(ws);
const pdf = Buffer.from('%PDF-1.4 假的,只为算指纹\n');
mkdirSync(ws.paths.textbooks, { recursive: true });
const FILE = '语文一年级下册.pdf';
writeFileSync(join(ws.paths.textbooks, FILE), pdf);
const sha = createHash('sha1').update(pdf).digest('hex').slice(0, 16);
const ix = bookIndexOf();
const p2 = ix.pages.find((p) => p.n === 2)!;
p2.cells = [{ x1: 300, y1: 600, x2: 330, y2: 620, kind: 'blank' }, { x1: 100, y1: 640, x2: 139, y2: 679, kind: 'empty', m: '泡' }];
mkdirSync(join(root, '.cotutor', 'textbooks'), { recursive: true });
writeFileSync(join(root, '.cotutor', 'textbooks', `${sha}.json`), JSON.stringify({ ...ix, sha }));

interface Row { title: string; key: string; leaf: boolean; which: string; by?: string; pages: number[]; depth: number }
interface List { books: { file: string; sha: string; lessons: Row[] }[]; stale: { sha: string; title: string | null; pages: number }[]; unreadable: string[] }
interface Lesson { which: string; version: string; layout: string; lessons: { title: string }[]; pages: { n: number; zones: ZonePage; cand: { lines: { id: string; ch?: number[][] }[]; cells: { id: string; kind: string }[] }; by?: string }[] }
const get = async <T>(p: string): Promise<{ status: number; json: T }> => { const r = await route('GET', p, ctx); return { status: r.status, json: r.json as T }; };

// ---- 列 ----
const list = (await get<List>('/api/dev/zones')).json;
const fish = list.books[0]?.lessons.find((l) => l.title === '小鱼吹泡泡');
check('列:课本、每一课的 key(课名@头一页)、最里一层能点开、现在用规则出的', list.books.length === 1 && list.books[0].file === FILE && fish?.key === '小鱼吹泡泡@2' && fish.leaf && fish.which === 'rules' && list.books[0].lessons.some((l) => !l.leaf && l.title === '古诗两首'), JSON.stringify(list.books[0]?.lessons.map((l) => [l.title, l.key, l.leaf, l.which])));
check('列:没有旧分块、没有读不出的', list.stale.length === 0 && list.unreadable.length === 0);

// ---- 读一课 ----
const L = '/api/dev/zones/lesson?b=' + encodeURIComponent(FILE) + '&l=' + encodeURIComponent('小鱼吹泡泡@2');
const one = (await get<Lesson>(L)).json;
check('读一课:2–3 页、规则出的分块、候选(能写的格编号同作答区 id)', one.which === 'rules' && one.pages.map((p) => p.n).join() === '2,3' && one.pages[0].cand.cells.map((c) => c.id + ':' + c.kind).join() === '0:blank,1:empty' && one.pages[0].zones.zones.length > 0, JSON.stringify(one.pages.map((p) => p.n)));
check('读一课:语文的行带每个字的左右(当孩子点认字)', one.layout === 'prose' && one.pages[0].cand.lines.some((l) => (l.ch?.length ?? 0) > 1));
check('认不出的课 404', (await get('/api/dev/zones/lesson?b=' + encodeURIComponent(FILE) + '&l=没有这课@9')).status === 404 && (await get('/api/dev/zones/lesson?b=../x.pdf&l=小鱼吹泡泡@2')).status === 404);

// ---- 边改边查 ----
const pages = one.pages.map((p) => structuredClone(p.zones));
const body = (ps: ZonePage[]) => ({ b: FILE, l: '小鱼吹泡泡@2', pages: ps });
const chk = async (ps: ZonePage[]): Promise<{ problems: string[]; notes: string[] }> => (await route('POST', '/api/dev/zones/check', ctx, body(ps))).json as { problems: string[]; notes: string[] };
check('查:原样是干净的', (await chk(pages)).problems.length === 0, JSON.stringify((await chk(pages)).problems));
const dup = structuredClone(pages);
const firstTwo: { label: string }[] = [];
walkZones(dup[0].zones, (z, d) => { if (d === 0 && firstTwo.length < 2) firstTwo.push(z); });
firstTwo[1].label = firstTwo[0].label;
check('查:一课里叫法重名,说出来(同 cotutor textbook check)', (await chk(dup)).problems.some((p) => p.includes('都叫「' + firstTwo[0].label + '」')), JSON.stringify((await chk(dup)).problems));
check('查:少交一页,说一课的页要一起存', (await chk([pages[0]])).problems.some((p) => p.includes('第 3 页') && p.includes('一起存')));

// ---- 存:查出要改的不存 ----
const bad = (await route('PUT', '/api/dev/zones/lesson', ctx, { ...body(dup), version: one.version })).json as { ok: boolean; problems: string[] };
check('存:有要改的不存', !bad.ok && bad.problems.length > 0 && !existsSync(vaultZonesDir(ws.paths.textbooks, sha)));

// ---- 存:规则出的那一课整课写进 vault,记 workbench ----
const mine = structuredClone(pages);
let said = '';
walkZones(mine[0].zones, (z) => { if (!said && z.kind === 'para') { z.say = '小鱼吹泡泡。'; z.teacher = { goal: '读通第 1 段' }; said = z.id; } });
const ok = (await route('PUT', '/api/dev/zones/lesson', ctx, { ...body(mine), version: one.version })).json as { ok: boolean; wrote: number; problems: string[] };
const vdir = vaultZonesDir(ws.paths.textbooks, sha);
const meta = await readZoneBook(vdir);
check('存:没改的第 3 页也照规则出的抄进去,一课凑齐;book.json 记工作台', ok.ok && ok.wrote === 2 && existsSync(join(vdir, 'p002.json')) && existsSync(join(vdir, 'p003.json')) && meta?.pages.p002?.by === 'workbench' && meta?.pages.p003?.by === 'workbench', JSON.stringify(ok));
const saved = JSON.parse(readFileSync(join(vdir, 'p002.json'), 'utf8')) as ZonePage;
let got = '';
walkZones(saved.zones, (z) => { if (z.id === said) got = (z.say ?? '') + '|' + (z.teacher?.goal ?? ''); });
check('存:念法、给老师的写进去了', got === '小鱼吹泡泡。|读通第 1 段', got);
const after = (await get<Lesson>(L)).json;
const row = (await get<List>('/api/dev/zones')).json.books[0].lessons.find((l) => l.key === '小鱼吹泡泡@2');
check('存完:这一课用 vault 的,每页记着谁存的;列表上也标工作台', after.which === 'vault' && after.pages.every((p) => p.by === 'workbench') && row?.which === 'vault' && row.by === 'workbench', JSON.stringify(row));

// ---- 别处改过:409 ----
const stale = (await route('PUT', '/api/dev/zones/lesson', ctx, { ...body(mine), version: one.version }));
check('存:拿着旧的 version(别处改过了)409', stale.status === 409, String(stale.status));
const again = (await route('PUT', '/api/dev/zones/lesson', ctx, { ...body(after.pages.map((p) => p.zones)), version: after.version })).json as { ok: boolean };
check('存:拿新的 version 能接着存', again.ok);

// ---- 还原成规则出的 ----
const del = (await route('DELETE', L, ctx)).json as { removed: number };
const back = (await get<Lesson>(L)).json;
check('还原:删掉 vault 里这一课的两页,回到规则出的', del.removed === 2 && back.which === 'rules' && !existsSync(join(vdir, 'p002.json')), JSON.stringify(del));

// ---- 课本换过:旧指纹的分块 ----
const old = vaultZonesDir(ws.paths.textbooks, 'abcdef0123456789');
mkdirSync(old, { recursive: true });
writeFileSync(join(old, 'p002.json'), JSON.stringify({ page: 2, zones: [] }));
writeFileSync(join(old, 'book.json'), JSON.stringify({ title: '语文一年级下册', sha: 'abcdef0123456789', pages: { p002: { by: 'agent', at: '2026-11-20T00:00:00.000Z' } } }));
const l2 = (await get<List>('/api/dev/zones')).json;
check('换过的课本:列出旧指纹的分块(册名、几页)', l2.stale.length === 1 && l2.stale[0].sha === 'abcdef0123456789' && l2.stale[0].title === '语文一年级下册' && l2.stale[0].pages === 1, JSON.stringify(l2.stale));
{
  const { doctorWorkspace } = await import('../src/app/cli/doctor.ts');
  const { staleZoneDirs } = await import('../src/memory/textbook-zones.ts');
  const st = await staleZoneDirs(ws.paths.textbooks);
  const z = (await doctorWorkspace(ws.root, { probeEnv: false, env: {} })).checks.find((c) => c.name === 'textbook.zones');
  check('doctor:换过的课本说一句(册名、几页),不挡用;现在用着的指纹不算', st.map((d) => d.sha).join() === 'abcdef0123456789' && z?.ok === false && z.required === false && z.detail.includes('《语文一年级下册》(1 页)') && Boolean(z.fix?.includes('工作台')), JSON.stringify([st, z]));
}
check('删旧的:现在用着的指纹不删', (await route('DELETE', '/api/dev/zones/stale?sha=' + sha, ctx)).status === 404);
check('删旧的:旧指纹的整个目录删掉', (await route('DELETE', '/api/dev/zones/stale?sha=abcdef0123456789', ctx)).status === 200 && !existsSync(old));
{
  const { doctorWorkspace } = await import('../src/app/cli/doctor.ts');
  check('doctor:删掉以后不再说', !(await doctorWorkspace(ws.root, { probeEnv: false, env: {} })).checks.some((c) => c.name === 'textbook.zones'));
}

// ---- 念一遍:没配声音 404,不出错 ----
const say = await route('POST', '/api/dev/zones/say', ctx, { b: FILE, text: '' });
check('念一遍:没有字 400', say.status === 400);

// ---- 练习册:只看(块是排版脚本写的) ----
{
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000000000000008060000000000', 'hex');
  PNG.writeUInt32BE(2000, 16);
  PNG.writeUInt32BE(2800, 20);
  const wbDir = join(ws.paths.workbooks, '表内乘法');
  mkdirSync(wbDir, { recursive: true });
  writeFileSync(join(wbDir, '01.png'), PNG);
  writeFileSync(join(wbDir, 'workbook.json'), JSON.stringify({
    version: 2, id: '表内乘法', title: '表内乘法练习册', subject: '语文', grade: 2, term: '上',
    source: { edition: '统编', unit: '第一单元', printed: [1, 2] },
    pages: [{
      image: { file: '01.png', w: 2000, h: 2800, sha256: createHash('sha256').update(PNG).digest('hex') },
      lines: [{ text: '看拼音写词。', box: [100, 100, 400, 130] }],
      terms: [],
      zones: [{ id: 'q1', kind: 'problem', label: '第 1 题', box: [60, 80, 940, 480], say: '看拼音写词。', teacher: { goal: '会写办法' },
        children: [{ id: 'q1-小题1', kind: 'sub', label: 'bàn fǎ', box: [100, 200, 300, 300], regions: [{ id: 'q1-1', kind: 'write', label: '第 1 格', box: [110, 210, 190, 290], tian: true }], teacher: { answers: [{ at: ['q1-1'], ok: ['办'] }] } }] }],
    }],
  }));
  mkdirSync(join(ws.paths.workbooks, '旧的'), { recursive: true });
  writeFileSync(join(ws.paths.workbooks, '旧的', 'workbook.json'), JSON.stringify({ version: 1 }));
  interface WbRow { name: string; title?: string; pages: number; questions: number; at?: string; why?: string }
  const wl = (await get<{ workbooks: WbRow[] }>('/api/dev/zones')).json.workbooks;
  const good = wl.find((w) => w.name === '表内乘法'), bad = wl.find((w) => w.name === '旧的');
  check('列:练习册/ 下每一册,几页几题、什么时候写的;读不出来的带一句为什么', good?.title === '表内乘法练习册' && good.pages === 1 && good.questions === 1 && Boolean(good.at) && !good.why && Boolean(bad?.why?.includes('version')), JSON.stringify(wl));
  const one = await get<Lesson & { kind: string; check: { problems: string[]; notes: string[] }; says: number }>('/api/dev/zones/workbook?w=' + encodeURIComponent('表内乘法'));
  const pg = one.json.pages?.[0];
  check('读一册:同一课的样子,页号是第几页,分块带答案(工作台只看),行是文字层、语文带字的左右;检查同 cotutor workbook check', one.status === 200 && one.json.kind === 'workbook' && one.json.which === 'workbook' && pg?.n === 1 && pg.zones.zones[0]?.children?.[0]?.teacher?.answers?.[0]?.ok?.[0] === '办' && pg.cand.lines[0]?.id === 'L1' && pg.cand.lines[0]?.ch?.length === 5 && pg.cand.cells.length === 0 && one.json.check.problems.length === 0 && one.json.says === 1, JSON.stringify(one.json).slice(0, 400));
  check('读一册:没有这一册、读不出来的 404', (await route('GET', '/api/dev/zones/workbook?w=nope', ctx)).status === 404 && (await route('GET', '/api/dev/zones/workbook?w=' + encodeURIComponent('旧的'), ctx)).status === 404 && (await route('GET', '/api/dev/zones/workbook?w=' + encodeURIComponent('../表内乘法'), ctx)).status === 404);
  const wsay = await Promise.all([route('POST', '/api/dev/zones/say', ctx, { w: 'nope', text: '看拼音写词。' }), route('POST', '/api/dev/zones/say', ctx, { w: '表内乘法', text: '' })]);
  check('念一遍(练习册):没有这一册 404,没有字 400', wsay[0].status === 404 && wsay[1].status === 400, JSON.stringify(wsay.map((r) => r.status)));
}

// ---- 页面 ----
const scripts = [...DEV_PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let parsed = true;
for (const s of scripts) { try { new Function(s); } catch { parsed = false; } }
check('工作台:有「分块」一项,内联的分块脚本剥了类型、能解析;认练习册', DEV_PAGE.includes('data-tab="zones"') && DEV_PAGE.includes('renderZones') && DEV_PAGE.includes('znOpenWorkbook') && !/^\s*declare const /m.test(DEV_PAGE) && parsed);

done();
