/**
 * 练习册(src/schema/workbook.ts):一份小册子过形状与检查;各种写错报到页和题;下发给孩子端的一页不带作答区和答案。
 * 出练习册的技能(skills/cotutor-workbook/references/格式.md):里面那份例子能用,schema 的每个字段都讲到;
 * cotutor workbook check 一次列全(形状、检查、页图的宽高与 sha256),glyph 给字母的笔顺。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { WorkbookSchema, workbookKidPage, workbookProblems, type Workbook } from '../src/schema/index.ts';
import { PACKAGE_SKILLS_DIR } from '../src/app/cli/skills.ts';
import { checkWorkbook, checkWorkbooks, glyphData } from '../src/app/cli/workbook.ts';
import { check, done } from './_check.ts';

const sample = (): Workbook => ({
  version: 1, id: '表内乘法一', title: '表内乘法（一）练习册', subject: '数学', grade: 2, term: '上',
  source: { edition: '人教版小学数学二年级上册', unit: '表内乘法（一）', printed: [48, 53] },
  pages: [{
    image: { file: '01.png', w: 2600, h: 3678, sha256: 'a'.repeat(64) },
    lines: [{ text: '圈出一盘草莓，再填一填。', box: [146, 130, 480, 150] }],
    terms: [{ text: '一盘', box: [230, 130, 280, 150], kind: 'other' }],
    questions: [{
      no: '1', box: [86, 120, 914, 343], prompt: '圈出一盘草莓，再填一填。',
      regions: [
        { id: 'q1-circle', kind: 'circle', label: '四盘草莓', box: [145, 164, 893, 248] },
        { id: 'q1-a', kind: 'write', label: '乘号左边', box: [270, 300, 320, 330] },
        { id: 'q1-b', kind: 'write', label: '乘号右边', box: [370, 300, 420, 330] },
      ],
      objects: [{ id: 'q1-berry-1', label: '草莓', box: [163, 192, 200, 222], center: [182, 208], region: 'q1-circle', group: 1 }],
      teacher: {
        goal: '从图里读出 4 盘，每盘 3 个',
        answers: [
          { at: ['q1-circle'], note: '圈出一盘,一盘 3 个' },
          { at: ['q1-a', 'q1-b'], ok: ['3×4', '4×3'] },
        ],
      },
    }],
  }],
});

const good = sample();
check('样本过形状', WorkbookSchema.safeParse(good).success, JSON.stringify(WorkbookSchema.safeParse(good).error?.issues));
check('样本过检查', workbookProblems(good).length === 0, workbookProblems(good).join('\n'));

/** 改一处再查,回检查出的那几条 */
const after = (edit: (wb: Workbook) => void): string[] => {
  const wb = sample();
  edit(wb);
  return workbookProblems(wb);
};
const q = (wb: Workbook) => wb.pages[0]!.questions[0]!;

// ——— 形状 ———
check('框出了 0–1000:形状不过', !WorkbookSchema.safeParse({ ...good, pages: [{ ...good.pages[0], lines: [{ text: '字', box: [0, 0, 1200, 10] }] }] }).success);
check('答案没有 ok、links、note:形状不过', !WorkbookSchema.safeParse((() => { const wb = sample(); (q(wb).teacher.answers[0] as Record<string, unknown>).note = undefined; return wb; })()).success);
check('题号不是数字:形状不过', !WorkbookSchema.safeParse((() => { const wb = sample(); q(wb).no = '一'; return wb; })()).success);

// ——— 检查 ———
const has = (issues: string[], word: string): boolean => issues.some((s) => s.includes('第 1 页第 1 题') && s.includes(word));
check('作答区出了题框', has(after((wb) => { q(wb).regions[1]!.box = [270, 300, 320, 400]; }), '出了题框'));
check('框左右倒了', has(after((wb) => { q(wb).regions[1]!.box = [320, 300, 270, 330]; }), '不是左上到右下'));
check('id 重复', has(after((wb) => { q(wb).regions[2]!.id = 'q1-a'; }), '重复'));
check('题号重复', after((wb) => { wb.pages.push({ ...structuredClone(wb.pages[0]!), questions: [{ ...structuredClone(q(wb)), regions: [], objects: [], teacher: { goal: '目标', answers: [] } }] }); }).some((s) => s.includes('第 2 页第 1 题') && s.includes('题号重复')));
check('物件的中心不在框里', has(after((wb) => { q(wb).objects[0]!.center = [100, 100]; }), '中心不在框里'));
check('物件指了没有的作答区', has(after((wb) => { q(wb).objects[0]!.region = 'q9-x'; }), '不在这道题里'));
check('只是图的物件可以不指作答区', after((wb) => { delete q(wb).objects[0]!.region; }).length === 0);
check('答案指了没有的作答区', has(after((wb) => { q(wb).teacher.answers[1]!.at = ['q1-a', 'q1-c']; }), '「q1-c」不在这道题里'));
check('描写区没带 model', has(after((wb) => { q(wb).regions[1]!.kind = 'trace'; }), '要带 model'));
check('画图区带 model', has(after((wb) => { q(wb).regions[0]!.model = { glyph: 'A', strokes: [[[1, 1], [2, 2]]] }; }), '只有描写、书写'));
check('四线不是从上往下', has(after((wb) => { q(wb).regions[1]!.fourLine = [310, 305, 320, 325]; }), '四线'));

// 连线:两头带 side,答案的 links 左连右
const linked = (wb: Workbook): void => {
  q(wb).regions.push({ id: 'q1-links', kind: 'link', label: '连线区', box: [100, 250, 900, 340] });
  q(wb).objects.push(
    { id: 'q1-l', label: 'A', box: [110, 260, 130, 280], center: [120, 270], region: 'q1-links', side: 'left' },
    { id: 'q1-r', label: 'a', box: [800, 260, 820, 280], center: [810, 270], region: 'q1-links', side: 'right' },
  );
  q(wb).teacher.answers.push({ at: ['q1-links'], links: [['q1-l', 'q1-r']] });
};
check('连线写对了', after(linked).length === 0, after(linked).join('\n'));
check('连线的端点没写 side', has(after((wb) => { linked(wb); delete q(wb).objects[1]!.side; }), '要写 side'));
check('连线区缺一头', has(after((wb) => { linked(wb); q(wb).objects[2]!.side = 'left'; }), '左右两头都要有'));
check('答案左右连反了', has(after((wb) => { linked(wb); q(wb).teacher.answers[2]!.links = [['q1-r', 'q1-l']]; }), '不是连线的左端'));
check('不是连线区的物件写了 side', has(after((wb) => { q(wb).objects[0]!.side = 'left'; }), '只有连线的端点写 side'));
check('links 挂在非连线区上', has(after((wb) => { linked(wb); q(wb).teacher.answers[2]!.at = ['q1-a']; }), 'links 只挂在连线区上'));

// ——— 下发 ———
const kid = workbookKidPage(good.pages[0]!);
check('孩子端的一页:只有图和文字层', Object.keys(kid).sort().join() === 'image,lines,terms' && !JSON.stringify(kid).includes('3×4'), JSON.stringify(kid));

// ——— 出练习册的技能:格式.md ———
const formatDoc = readFileSync(join(PACKAGE_SKILLS_DIR, 'cotutor-workbook', 'references', '格式.md'), 'utf8');
const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(formatDoc)?.[1] ?? 'null') as unknown;
const exParsed = WorkbookSchema.safeParse(example);
check('格式.md 的例子过形状', exParsed.success, JSON.stringify(exParsed.error?.issues));
check('格式.md 的例子过检查', exParsed.success && workbookProblems(exParsed.data).length === 0, exParsed.success ? workbookProblems(exParsed.data).join('\n') : '');
check('格式.md 的例子每种作答区之外也有物件、连线、田字格、说着答', /"kind": "circle"/.test(formatDoc) && /"side": "left"/.test(formatDoc) && /"tian": true/.test(formatDoc) && /"say": true/.test(formatDoc));
/** schema 里出现的每个字段名(对象一层层往下走) */
const fieldNames = (s: z.ZodType, out = new Set<string>()): Set<string> => {
  if (s instanceof z.ZodObject) for (const [k, v] of Object.entries(s.shape as Record<string, z.ZodType>)) { out.add(k); fieldNames(v, out); }
  else if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) fieldNames(s.unwrap() as z.ZodType, out);
  else if (s instanceof z.ZodArray) fieldNames(s.element as z.ZodType, out);
  else if (s instanceof z.ZodTuple) for (const x of s.def.items) fieldNames(x as z.ZodType, out);
  return out;
};
const fields = [...fieldNames(WorkbookSchema)];
const unexplained = fields.filter((k) => !formatDoc.includes(`\`${k}\``));
check('格式.md 讲到 schema 的每个字段(加了字段忘了写,这里红)', fields.length > 30 && unexplained.length === 0, JSON.stringify(unexplained));

// ——— cotutor workbook check ———
/** 只有文件头的 PNG(IHDR 带宽高),够 check 读宽高、算 sha256 */
const png = (w: number, h: number): Buffer => {
  const b = Buffer.from('89504e470d0a1a0a0000000d49484452000000000000000008060000000000', 'hex');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const books = mkdtempSync(join(tmpdir(), 'cotutor-workbook-check-'));
const put = (name: string, wb: unknown, images: Record<string, Buffer>): void => {
  mkdirSync(join(books, name), { recursive: true });
  writeFileSync(join(books, name, 'workbook.json'), JSON.stringify(wb));
  for (const [f, b] of Object.entries(images)) writeFileSync(join(books, name, f), b);
};
{
  const img = png(2600, 3678);
  const ok = structuredClone(example) as Workbook;
  ok.pages[0]!.image.sha256 = sha(img);
  put('好的', ok, { '01.png': img });
  const r = await checkWorkbook(books, '好的');
  check('check:例子配上对的图,没有要改的;打印版不在只提醒', r.problems.length === 0 && r.title === ok.title && r.pages === 1 && r.questions === 4 && r.notes.some((n) => n.includes('打印版')), JSON.stringify(r));

  put('图不对', ok, { '01.png': png(2000, 3678) });
  const bad = await checkWorkbook(books, '图不对');
  check('check:图的宽高、sha256 和 json 对不上都报,带第几页', bad.problems.some((p) => p.startsWith('第 1 页') && p.includes('2000×3678')) && bad.problems.some((p) => p.includes('sha256')), JSON.stringify(bad.problems));

  put('没有图', ok, {});
  check('check:图不在', (await checkWorkbook(books, '没有图')).problems.some((p) => p.includes('01.png 不在')));

  const shape = structuredClone(ok);
  shape.pages[0]!.questions[0]!.box[2] = 1200;
  shape.pages[0]!.questions[1]!.no = '二';
  put('形状', shape, { '01.png': img });
  const sp = (await checkWorkbook(books, '形状')).problems;
  check('check:形状不对的一次列全(不只第一条),页从 1 数', sp.length === 2 && sp.every((p) => p.startsWith('第 1 页 questions.')), JSON.stringify(sp));

  const logic = structuredClone(ok);
  logic.pages[0]!.questions[0]!.regions[1]!.id = 'q1-1';
  logic.pages[0]!.questions[2]!.teacher.answers[0]!.at = ['q3-没有'];
  put('检查', logic, { '01.png': img });
  const lp = (await checkWorkbook(books, '检查')).problems;
  check('check:workbookProblems 的也一次列全', lp.some((p) => p.includes('重复')) && lp.some((p) => p.includes('q3-没有')), JSON.stringify(lp));

  mkdirSync(join(books, '坏的'));
  writeFileSync(join(books, '坏的', 'workbook.json'), '{');
  check('check:不是 JSON', (await checkWorkbook(books, '坏的')).problems[0]?.includes('不是 JSON') === true);
  const all = await checkWorkbooks(books);
  check('check 不给名字:练习册/ 下每一册(有 workbook.json 的文件夹)都查', all.map((x) => x.name).join() === '图不对,坏的,好的,形状,检查,没有图'.split(',').sort().join(), all.map((x) => x.name).join());
}

// ——— cotutor workbook glyph ———
{
  const g = glyphData('Aa1');
  const A = g.glyphs.A;
  check('glyph:认的字母给字宽和一笔一串点,四线是 -2 -1 0 1;不认的另说', A?.advance === 1.5 && A.strokes.length === 3 && A.strokes[0]![0]!.join() === '0.75,-2' && Boolean(g.glyphs.a) && g.unknown.join() === '1' && Object.values(g.guides).join() === '-2,-1,0,1', JSON.stringify({ A: A?.strokes[0]?.slice(0, 2), u: g.unknown }));
}

done();

