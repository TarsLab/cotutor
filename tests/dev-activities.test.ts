/**
 * 工作台改 activity(《工作台设计.md》拍板 6–9):孩子端首页的护栏(写坏了、参数解析不出的按钮不出);
 * 接口:列、读、边改边查(检查 / 首页按钮 / 预览 / 和出厂比,不落盘)、存(hash 对不上 409)、恢复出厂(留 .bak)、只认列得出的名字。
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-dev-act-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { publishHome } = await import('../src/server/home.ts');
const { diffHunks, activitySections } = await import('../src/server/dev-activities.ts');
const { DEV_PAGE } = await import('../src/server/dev-page.ts');

try {
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const ctx = createContext(loadWorkspace(root));
  const file = join(root, 'agents', 'chinese-tutor', 'activities', '你说我画.md');
  const shipped = readFileSync(file, 'utf8');
  mkdirSync(join(root, 'home'), { recursive: true });
  writeFileSync(join(root, 'home', 'draft.md'), '```tutor chinese-tutor\nactivity 你说我画\nactivity 你说我画 我来出题\n词: 播种、睡大觉、羞愧\n```\n\n## 为什么这么排\n\n试\n');
  const pub = await publishHome(ctx.ws, { now: new Date() });
  check('发布了', pub.ok, JSON.stringify(pub.check.issues));
  const labels = async (): Promise<string> => {
    const kid = (await route('GET', '/api/kid/home', ctx)).json as { cards: { props: { tutor?: string; buttons?: { label: string }[] } }[] };
    return (kid.cards.find((c) => c.props.tutor === 'chinese-tutor')?.props.buttons ?? []).map((b) => b.label).join(',');
  };

  // ---- 护栏:孩子端只出用得了的 activity 按钮 ----
  check('好好的:两个按钮都出', (await labels()) === '新话题,你说我画,我来出题', await labels());
  writeFileSync(file, shipped.replace('最多画: 数,缺省 2,1 到 4', '最多画: 整数,缺省 2'));
  check('写坏了(检查有要改):两个都不出', (await labels()) === '新话题', await labels());
  writeFileSync(file, shipped.replace('词: 词表,可空', '词: 数,可空'));
  check('参数解析不出(「词」改成了数):只有带词的那个不出', (await labels()) === '新话题,你说我画', await labels());
  writeFileSync(file, shipped);
  check('改回来:又都出', (await labels()) === '新话题,你说我画,我来出题');

  // ---- 纯函数:按行比、节 ----
  check('diffHunks:改一行、加一行、删一行,行号按现在这份', JSON.stringify(diffHunks('a\nb\nc\nd', 'a\nB\nc\nx\nd')) === JSON.stringify([{ at: 2, oldAt: 2, old: ['b'], now: ['B'] }, { at: 4, oldAt: 4, old: [], now: ['x'] }]) && JSON.stringify(diffHunks('a\nb', 'a')) === JSON.stringify([{ at: 2, oldAt: 2, old: ['b'], now: [] }]) && diffHunks('a', 'a').length === 0, JSON.stringify(diffHunks('a\nb\nc\nd', 'a\nB\nc\nx\nd')));
  const secs = activitySections(shipped);
  check('节:头 + 每个 ## 一节,读者标对,围栏里的 ## 不算', secs[0].title === '头' && secs.some((x) => x.title === '老师怎么带' && x.reader === '老师的系统提示') && secs.some((x) => x.title === '画家收到什么' && x.reader === '百炼文生图') && secs.find((x) => x.title === '家长填的')?.line === 16, JSON.stringify(secs));

  // ---- 列 ----
  type Row = { tutor: string; name: string; state: string; fixes: number; buttons: number; examples: number; page: string | null };
  const list = (await route('GET', '/api/dev/activities', ctx)).json as Row[];
  const row = (t: string, n: string) => list.find((r) => r.tutor === t && r.name === n);
  check('列:出厂七个,例子文件不算 activity', list.length === 7 && !list.some((r) => r.name.endsWith('.例子')), JSON.stringify(list.map((r) => r.tutor + '/' + r.name)));
  check('列:你说我画 出厂最新、首页 2 个按钮、5 个例子', row('chinese-tutor', '你说我画')?.state === 'latest' && row('chinese-tutor', '你说我画')?.buttons === 2 && row('chinese-tutor', '你说我画')?.examples === 5, JSON.stringify(row('chinese-tutor', '你说我画')));
  check('列:听写不起老师,标出进哪一页', (row('chinese-tutor', '听写')?.page ?? '').includes('/dictation'));

  // ---- 读 ----
  const base = '/api/dev/activities/chinese-tutor/' + encodeURIComponent('你说我画');
  const doc = (await route('GET', base, ctx)).json as { text: string; hash: string; state: string; path: string; shipped: boolean };
  check('读:原文、hash、相对路径、是出厂的', doc.text === shipped && doc.hash.length > 10 && doc.path === 'agents/chinese-tutor/activities/你说我画.md' && doc.shipped && doc.state === 'latest', JSON.stringify({ ...doc, text: undefined }));
  check('不认得的名字 404;拼路径的 404', (await route('GET', '/api/dev/activities/chinese-tutor/' + encodeURIComponent('没有这个'), ctx)).status === 404 && (await route('GET', '/api/dev/activities/chinese-tutor/' + encodeURIComponent('../../cotutor'), ctx)).status === 404 && (await route('GET', '/api/dev/activities/nobody-tutor/x', ctx)).status === 404);

  // ---- 边改边查(不落盘) ----
  type Chk = { issues: { level: string; line?: number }[]; buttons: { label: string; ok: boolean; detail: string }[]; diff: { at: number; old: string[]; now: string[] }[] | null; preview: { text: string | null; cards: string[] }; summary: { params: { name: string }[] } };
  const broken = shipped.replace('最多画: 数,缺省 2,1 到 4', '最多画: 整数,缺省 2');
  const c1 = (await route('POST', base + '/check', ctx, { text: broken })).json as Chk;
  check('查:要改的带行号', c1.issues.some((i) => i.level === 'fix' && i.line === 20), JSON.stringify(c1.issues));
  check('查:首页两个按钮都标孩子端不出', c1.buttons.length === 2 && c1.buttons.every((b) => !b.ok && b.detail.includes('不出')), JSON.stringify(c1.buttons));
  check('查:和出厂比一块,在第 20 行', c1.diff?.length === 1 && c1.diff[0].at === 20 && c1.diff[0].now[0].startsWith('最多画: 整数'), JSON.stringify(c1.diff));
  check('查:不落盘', readFileSync(file, 'utf8') === shipped);
  const c2 = (await route('POST', base + '/check', ctx, { text: shipped, params: { 词: '播种、羞愧' } })).json as Chk;
  const c3 = (await route('POST', base + '/check', ctx, { text: shipped })).json as Chk;
  check('预览:填了词「我来出题」那段在,没填不在;注释剥了;卡带上 text', (c2.preview.text ?? '').includes('### 我来出题') && !(c3.preview.text ?? '').includes('### 我来出题') && !(c2.preview.text ?? '').includes('<!--') && c2.preview.cards.join(' ') === 'text read paint', JSON.stringify(c2.preview.cards));
  check('查:按钮解析好的值(补缺省)', c3.buttons[1].ok && c3.buttons[1].detail.includes('最多画 2(缺省)'), JSON.stringify(c3.buttons));

  // ---- 存 ----
  const edited = shipped.replace('请孩子先说是谁的故事。', '先问孩子:这是谁的故事?');
  const bad = await route('PUT', base, ctx, { text: edited, base: 'sha256:不对' });
  check('存:hash 对不上 409,文件不动', bad.status === 409 && (bad.json as { error: string }).error === 'conflict' && readFileSync(file, 'utf8') === shipped, JSON.stringify(bad.json));
  const ok = await route('PUT', base, ctx, { text: edited, base: doc.hash });
  check('存:写进去,变成改过', ok.status === 200 && readFileSync(file, 'utf8') === edited && (ok.json as { state: string }).state === 'custom', JSON.stringify(ok.json));
  check('存:存完再用旧 hash 存 409(别处改过就是这样)', (await route('PUT', base, ctx, { text: shipped, base: doc.hash })).status === 409);
  check('列:改过', ((await route('GET', '/api/dev/activities', ctx)).json as Row[]).find((r) => r.name === '你说我画')?.state === 'custom');

  // ---- 恢复出厂 ----
  const rs = await route('POST', base + '/restore', ctx, {});
  check('恢复出厂:换回出厂那份,你这份留 .bak,状态回最新', rs.status === 200 && readFileSync(file, 'utf8') === shipped && readFileSync(file + '.bak', 'utf8') === edited && (rs.json as { bak: string }).bak === 'agents/chinese-tutor/activities/你说我画.md.bak' && ((await route('GET', base, ctx)).json as { state: string }).state === 'latest', JSON.stringify(rs.json));
  writeFileSync(join(root, 'agents', 'math-tutor', 'activities', '自家的.md'), '---\nname: 自家的\ndescription: 试\ncards: read\n---\n\n## 老师怎么带\n\n你是数学老师。\n');
  const own = '/api/dev/activities/math-tutor/' + encodeURIComponent('自家的');
  check('自家加的:列得出、没有出厂那份可比、恢复出厂 400', ((await route('GET', own, ctx)).json as { state: string; shipped: boolean }).state === 'untracked' && ((await route('POST', own + '/check', ctx, { text: '---\nname: 自家的\n---\n' })).json as Chk).diff === null && (await route('POST', own + '/restore', ctx, {})).status === 400);

  check('页面:侧栏有 activity 标签,地址能直达某一个', DEV_PAGE.includes('data-tab="activity"') && DEV_PAGE.includes("q.get('a')"));

} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
