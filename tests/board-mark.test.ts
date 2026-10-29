/**
 * 板书底纹(src/ui/kid/board-mark.ts):三门主科照课本封面在板右边竖写学科名,别的老师不写字;
 * 字是烤好的轮廓(board-mark-art.ts,scripts/bake-board-marks.py);板不铺纸纹;老师页三处换老师都跟着换字,首页数据带 mark。
 */
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-board-mark-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { boardMarkOf, BOARD_MARK_PLACE, BOARD_MARK_BOTTOM, BOARD_MARK_JS, BOARD_MARK_CSS } = await import('../src/ui/kid/board-mark.ts');
const { BOARD_MARK_ART } = await import('../src/ui/kid/board-mark-art.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');

// ---- 哪位老师写什么 ----
const want: [string | null, string | null][] = [['语文', 'yuwen'], ['中文', 'yuwen'], ['Chinese', 'yuwen'], ['数学', 'shuxue'], ['math', 'shuxue'], ['英语', 'english'], ['English', 'english'], ['英文', 'english'], ['口播', null], ['科学', null], ['', null], [null, null]];
for (const [subject, id] of want) check(`学科 ${JSON.stringify(subject)} → ${id}`, boardMarkOf(subject) === id, String(boardMarkOf(subject)));

// ---- 烤好的轮廓 ----
const ids = Object.keys(BOARD_MARK_ART).sort();
check('三个字都烤了', JSON.stringify(ids) === JSON.stringify(['english', 'shuxue', 'yuwen']), ids.join());
check('每个字都有摆法', ids.every((id) => id in BOARD_MARK_PLACE));
for (const id of ids) {
  const a = BOARD_MARK_ART[id as keyof typeof BOARD_MARK_ART];
  check(`${id} 竖着:高比宽长得多`, a.w > 0 && a.h > a.w * 1.8, `${a.w} × ${a.h}`);
  check(`${id} 路径只有命令与数(插进模板字符串不出事)`, /^[MLHVQCZ0-9 .-]+$/.test(a.d) && a.d.length > 500, a.d.slice(0, 40));
  const nums = a.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  // 外框是贴着曲线算的,控制点可以略出一点
  check(`${id} 路径坐标都在外框里`, Math.min(...nums) >= -30 && Math.max(...nums) <= Math.max(a.w, a.h) * 1000 + 30, `${Math.min(...nums)}..${Math.max(...nums)}`);
  check(`${id} 很淡`, BOARD_MARK_PLACE[id as keyof typeof BOARD_MARK_PLACE].o <= 0.08);
  // 实时页回首页胶囊下沿 64(kid-page.ts 的 .tb、#back),「更多」更矮:字从它们下面起,空出十几 px
  check(`${id} 从两角按钮下面起`, BOARD_MARK_PLACE[id as keyof typeof BOARD_MARK_PLACE].top >= 76, String(BOARD_MARK_PLACE[id as keyof typeof BOARD_MARK_PLACE].top));
}
check('字太高就缩,不出板的底边', BOARD_MARK_BOTTOM > 0 && (BOARD_MARK_CSS.match(/var\(--bm-top\) \* 1px - 16px\) \/ var\(--bm-h\)/g) ?? []).length === 2);

// ---- 插进老师页的脚本与样式 ----
check('脚本没有反斜杠与反引号', !/[\\`]/.test(BOARD_MARK_JS));
check('样式没有反斜杠与反引号', !/[\\`]/.test(BOARD_MARK_CSS));
let parsed = true;
try { new Function(BOARD_MARK_JS); } catch { parsed = false; }
check('脚本能解析', parsed);
// 在假 DOM 上跑一遍:三门主科放字,别的老师收起来
const fakeEl = () => {
  const attrs: Record<string, string> = {};
  const props: Record<string, string> = {};
  return { hidden: true, innerHTML: '', textContent: '', attrs, props, setAttribute(k: string, v: string) { attrs[k] = v; }, getAttribute(k: string) { return attrs[k] ?? null; }, removeAttribute(k: string) { delete attrs[k]; }, get firstChild() { return { style: { setProperty: (k: string, v: unknown) => { props[k] = String(v); } } }; } };
};
const markBoard = new Function(`${BOARD_MARK_JS}; return markBoard;`)() as (el: unknown, t: unknown) => void;
const el = fakeEl();
markBoard(el, { name: 'chinese-tutor', mark: 'yuwen' });
check('语文老师:板上有字', !el.hidden && el.attrs['data-mark'] === 'yuwen' && el.innerHTML.includes('<path') && el.props['--bm-o'] === String(BOARD_MARK_PLACE.yuwen.o), JSON.stringify({ h: el.hidden, a: el.attrs }));
markBoard(el, { name: 'science-tutor', mark: null });
check('副科老师:收起来、不写字', el.hidden && !('data-mark' in el.attrs) && el.textContent === '', JSON.stringify(el.attrs));
markBoard(el, null);
check('还不知道是谁:收起来', el.hidden);

// ---- 真页面与首页数据 ----
const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const ctx = createContext(loadWorkspace(root));
const page = await route('GET', '/', ctx);
const html = typeof page.html === 'string' ? page.html : '';
check('老师页有垫底的 #bmark', html.includes('<div id="bmark" hidden></div>'));
check('板不铺纸纹:平的纸色,没有 SVG 噪声', !html.includes('feTurbulence') && !html.includes('--paper-tex'));
check('换老师的两处都跟着换字(开老师、录像;家长端 10-28 拆成自己的一页)', (html.match(/markBoard\(\$\('#bmark'\), /g) ?? []).length === 2, String((html.match(/markBoard\(\$\('#bmark'\), /g) ?? []).length));
check('左撇子横屏字挪到左边', html.includes('body.live.hand-left #bmark svg'));
const kh = (await route('GET', '/api/kid/home', ctx)).json as { tutors: { name: string; mark: string | null }[] };
const marks = Object.fromEntries(kh.tutors.map((t) => [t.name, t.mark]));
check('首页数据:三门主科带 mark', marks['chinese-tutor'] === 'yuwen' && marks['math-tutor'] === 'shuxue' && marks['english-tutor'] === 'english', JSON.stringify(marks));

done();
