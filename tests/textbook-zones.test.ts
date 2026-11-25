/**
 * 课本的分块(src/schema/zones.ts 的形状,src/memory/textbook-zones-rules.ts 规则出,src/memory/textbook-zones.ts 读写与挑哪份,src/chalk/kit/book.ts 的 zoneBlocks 读回成块)。
 * 书是 tests/_book.ts、tests/_math-book.ts、tests/_science-book.ts 造的;读回来的块一课一课对得上的那些断言在 tests/textbook.test.ts(它的块都是规则出了再读回来的)。
 * 真课本逐课比规则出的读回来和以前运行时现分的一处不差(2026-11-25)记在 docs/dev/课本.md。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bookCellsOf, bookSheets, zoneBlocks } from '../src/chalk/index.ts';
import { ruleLessonZones, ruleZones } from '../src/memory/textbook-zones-rules.ts';
import { bookZones, forgetZones, readZoneBook, ruleZonesDir, vaultZonesDir, writeZonePages } from '../src/memory/textbook-zones.ts';
import { ZonePageSchema, pickZones, walkZones, zonePageProblems, zonesKidPage, type BookPage, type ZonePage } from '../src/schema/index.ts';
import { bookIndexOf } from './_book.ts';
import { mathIndexOf } from './_math-book.ts';
import { scienceIndexOf } from './_science-book.ts';
import { check, done } from './_check.ts';

// ---- 规则出的:形状、检查都过,一页一份,每页都有 ----
for (const ix of [bookIndexOf(), mathIndexOf(), scienceIndexOf()]) {
  const zs = ruleZones(ix);
  const bad = zs.flatMap((z) => { const r = ZonePageSchema.safeParse(JSON.parse(JSON.stringify(z))); return r.success ? zonePageProblems(r.data) : [`第 ${z.page} 页形状不对`]; });
  check(`规则出的(${ix.layout}):每页一份,过形状和检查`, zs.length === ix.pages.length && zs.every((z, k) => z.page === ix.pages[k].n) && bad.length === 0, bad.join(';'));
}

const ix = bookIndexOf();
const L = (t: string) => ix.lessons.find((l) => l.title === t)!;
const lp = (t: string): BookPage[] => ix.pages.filter((p) => p.n >= L(t).pages[0] && p.n <= L(t).pages[1]);
const fish = lp('小鱼吹泡泡');
const fz = ruleLessonZones(fish, 'prose');
{
  const ids = fz.map((p) => p.zones.map((z) => `${z.id}:${z.kind}:${z.label}`));
  const para2 = fz.flatMap((p) => p.zones.filter((z) => z.label === '第 2 段'));
  check('跨页的一段:两页上各一块、同一个 id;叫法照书上的号(第 2 段)', para2.length === 2 && para2[0].id === para2[1].id && para2.every((z) => z.kind === 'para' && z.rows!.length > 0), JSON.stringify(ids));
  const back = zoneBlocks(fish, fz, 'prose').filter((b) => b.kind === 'para');
  check('读回来:跨页那段连成一段,行照先后', back.length === 3 && back[1].refs.map((r) => r.n).join() === '2,2,3', JSON.stringify(back));
}

// ---- 数学:栏目下面的题成它的小块;读回来题记着栏目 ----
{
  const mx = mathIndexOf();
  const zs = ruleZones(mx);
  const cols = zs.flatMap((p) => p.zones.filter((z) => z.kind === 'column' && z.children?.length));
  check('数学:做一做、练一练下面的题是它的小块,叫「练一练第 3 题」', cols.length > 0 && cols.every((c) => c.children!.every((k) => k.kind === 'problem' && k.label.startsWith(c.label))), JSON.stringify(cols.map((c) => [c.label, c.children!.map((k) => k.label)])));
  const p = mx.pages.find((x) => zs.find((z) => z.page === x.n)?.zones.some((z) => z.kind === 'column' && z.children?.length))!;
  const back = zoneBlocks([p], zs.filter((z) => z.page === p.n), 'math');
  check('数学读回来:题号、栏目名从叫法和上一层来', back.some((b) => b.kind === 'problem' && b.no !== undefined && b.head && b.head.length > 0), JSON.stringify(back.map((b) => [b.kind, b.no, b.head])));
}

// ---- 没写 rows 的块(编程助手改的):框里没被占的行归框住它中心的最里面那块 ----
{
  const p = fish[0];
  const pm = (l: BookPage['lines'][number]): [number, number, number, number] => [l.x1 / p.w * 1000, l.y1 / p.h * 1000, l.x2 / p.w * 1000, l.y2 / p.h * 1000];
  const body = p.lines.map((l, i) => ({ l, i })).filter((x) => x.l.text.startsWith('小鱼在水里'));
  const all = pm(body[0].l);
  const hand: ZonePage = { page: p.n, zones: [{ id: 'a', kind: 'example', label: '例 1', box: [0, 0, 1000, 1000], children: [{ id: 'a-1', kind: 'para', label: '第 1 段', box: [all[0] - 2, all[1] - 2, all[2] + 2, all[3] + 2] }] }] };
  const back = zoneBlocks([p], [hand], 'prose');
  const one = back.find((b) => b.kind === 'para');
  check('没写 rows:框里的行归最里面那块,别的归外面那块', one?.no === 1 && one.refs.length === 1 && one.refs[0].i === body[0].i && back[0].kind === 'example' && back[0].refs.length > 1 && !back[0].refs.some((r) => r.i === body[0].i), JSON.stringify(back));
}

// ---- 能写的格:规则出的作答区 id 是这一页第几格,换到场景里和照索引的一样 ----
{
  const p: BookPage = { n: 3, printed: 2, w: 520, h: 736, lines: [{ text: '处', x1: 100, x2: 130, y1: 100, y2: 130, z: 30, f: 'a', chars: [{ c: '处', x1: 100, x2: 130 }] }], cells: [{ x1: 96, y1: 96, x2: 135, y2: 135, kind: 'model', ch: '处' }, { x1: 140, y1: 96, x2: 179, y2: 135, kind: 'empty', m: '处' }, { x1: 300, y1: 500, x2: 340, y2: 520, kind: 'blank' }] };
  const zs = ruleLessonZones([p], 'prose');
  const sh = bookSheets([p]);
  const a = bookCellsOf([p], sh), b = bookCellsOf([p], sh, zs);
  check('格:id、种类、字和照索引的一样,框差不到 0.1', a.length === 3 && b.length === 3 && a.every((c, k) => c.id === b[k].id && c.kind === b[k].kind && c.ch === b[k].ch && c.m === b[k].m && c.box.every((v, j) => Math.abs(v - b[k].box[j]) <= 0.1)), JSON.stringify([a, b]));
  const hosted: string[] = [];
  walkZones(zs[0].zones, (z) => { for (const r of z.regions ?? []) hosted.push(r.id); });
  check('格挂在框住它中心的那块上(范字格落在「处」那一行上),块外面的(右边的空格、下面的填空)挂在页上', hosted.join() === '0' && (zs[0].regions ?? []).map((r) => `${r.id}:${r.cell}`).join() === '1:empty,2:blank', JSON.stringify(zs[0]));
  check('挂了格的块过检查(框撑大了)', zonePageProblems(zs[0]).length === 0, zonePageProblems(zs[0]).join(';'));
}

// ---- 孩子端那份:给老师的、答案、物件、作答区的名字不下发 ----
{
  const full: ZonePage = { page: 9, zones: [{ id: 'q', kind: 'problem', label: '练一练第 3 题', box: [10, 10, 500, 500], say: '第 3 题。', regions: [{ id: 'q-a', kind: 'write', label: '乘号左边', box: [20, 20, 60, 60] }], objects: [{ id: 'o', label: '积木', box: [100, 100, 120, 120], center: [110, 110] }], teacher: { goal: '七的乘法口诀', answers: [{ at: ['q-a'], ok: ['14'] }] } }] };
  const kid = JSON.stringify(zonesKidPage(full));
  check('孩子端:框、种类、叫法(书上的号)在;teacher、答案、物件、作答区的名字不在', kid.includes('练一练第 3 题') && kid.includes('"write"') && !kid.includes('七的乘法口诀') && !kid.includes('14') && !kid.includes('积木') && !kid.includes('乘号左边'), kid);
}

// ---- 文件:规则出的写进缓存、再读不重出;vault 里一课的页齐了才用 vault 的;读不出的页报一行 ----
{
  const tmp = mkdtempSync(join(tmpdir(), 'cotutor-zones-'));
  const cache = join(tmp, 'cache'), books = join(tmp, '教材');
  const index = { ...ix, sha: '0123456789abcdef' };
  const z1 = await bookZones(books, cache, index);
  const meta = await readZoneBook(ruleZonesDir(cache, index.sha));
  check('规则出的:一页一份写进 .cotutor/textbooks/zones/<指纹>/,book.json 记规则和索引的版本', Object.keys(z1.rules).length === index.pages.length && meta?.rules?.index === index.v && Object.values(meta!.pages).every((x) => x.by === 'rules') && Object.keys(z1.vault).length === 0, JSON.stringify(meta));
  const ns = fish.map((p) => p.n);
  check('vault 里没有:这一课用规则出的', pickZones(z1, ns).which === 'rules');
  const edited = ns.map((n) => ({ ...z1.rules[n], zones: z1.rules[n].zones.map((z) => (z.kind === 'para' ? { ...z, say: '改过的念法' } : z)) }));
  await writeZonePages(vaultZonesDir(books, index.sha), index, edited.slice(0, 1), 'agent');
  forgetZones();
  const z2 = await bookZones(books, cache, index);
  check('vault 里只有这一课的一页:一课里不混,还用规则出的', pickZones(z2, ns).which === 'rules' && Object.keys(z2.vault).length === 1);
  await writeZonePages(vaultZonesDir(books, index.sha), index, edited.slice(1), 'workbench');
  const z3 = await bookZones(books, cache, index);
  const vmeta = await readZoneBook(vaultZonesDir(books, index.sha));
  check('vault 里这一课的页齐了:用 vault 的;book.json 记每页谁写的', pickZones(z3, ns).which === 'vault' && pickZones(z3, ns).pages[0].zones.some((z) => z.say === '改过的念法') && vmeta?.pages[`p00${ns[0]}`]?.by === 'agent' && vmeta?.pages[`p00${ns[1]}`]?.by === 'workbench' && !vmeta.rules, JSON.stringify(vmeta));
  writeFileSync(join(vaultZonesDir(books, index.sha), `p00${ns[0]}.json`), '{"page": "坏了"}');
  const z4 = await bookZones(books, cache, index);
  check('vault 里读不出的一页:当没有,这一课退回规则出的,报一行', pickZones(z4, ns).which === 'rules' && z4.problems.length === 1 && z4.problems[0].includes('.zones'), JSON.stringify(z4.problems));
}

done();
