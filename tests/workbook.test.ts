/** 练习册(src/schema/workbook.ts):一份小册子过形状与检查;各种写错报到页和题;下发给孩子端的一页不带作答区和答案。 */
import { WorkbookSchema, workbookKidPage, workbookProblems, type Workbook } from '../src/schema/index.ts';
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

done();
