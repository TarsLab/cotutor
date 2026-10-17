/**
 * 工作台改 activity(《工作台设计.md》拍板 6–9):孩子端首页的护栏(写坏了、参数解析不出的按钮不出)。
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
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
