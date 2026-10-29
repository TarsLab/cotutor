/**
 * 工作台改老师文件:「新话题」照的提示词,和 activity 同一个编辑器。
 * 检查(lintAgentFile)、节;接口:列、读、边改边查(写法 / 首页上照它带的按钮 / 老师收到什么 / 和出厂比,不落盘)、
 * 存(hash 对不上 409,要改的不存 400)、恢复出厂(留 .bak,别的老师不碰)、cotutor.json 里没有的老师 404。
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-dev-tf-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
const { publishHome } = await import('../src/runtime/home/store.ts');
const { lintAgentFile } = await import('../src/runtime/agent-file.ts');
const { tutorFileSections } = await import('../src/app/http/dev-tutor-files.ts');
const { DEV_PAGE } = await import('../src/ui/dev/dev-page.ts');

try {
  // ---- 纯函数:检查、节 ----
  const okFile = '---\nname: math-tutor\ndescription: 数学\nmaxTurns: 40\n---\n你是数学老师。\n\n## 数学这一科\n\n```text\n## 围栏里的不算\n```\n';
  check('lint:好好的没有一条', lintAgentFile(okFile, 'math-tutor').length === 0, JSON.stringify(lintAgentFile(okFile, 'math-tutor')));
  const wrong = lintAgentFile(okFile.replace('name: math-tutor', 'name: maths'), 'math-tutor');
  check('lint:name 不对 = 要改,指到 name 那行', wrong.length === 1 && wrong[0].level === 'fix' && wrong[0].line === 2, JSON.stringify(wrong));
  check('lint:没有 frontmatter = 要改', lintAgentFile('你是数学老师。\n', 'math-tutor').some((i) => i.level === 'fix' && i.line === 1));
  check('lint:正文空 = 要改', lintAgentFile('---\nname: math-tutor\n---\n\n', 'math-tutor').some((i) => i.level === 'fix' && i.text.includes('正文')));
  const notes = lintAgentFile(okFile.replace('maxTurns: 40', 'voice: x\ntools: Read'), 'math-tutor');
  check('lint:cotutor.json 的键、两家不都认的键只提醒', notes.length === 2 && notes.every((i) => i.level === 'note') && notes[0].text.includes('cotutor.json') && notes[1].line === 5, JSON.stringify(notes));
  const secs = tutorFileSections(okFile);
  check('节:头、开头、每个 ##,围栏里的不算', secs.map((x) => x.title + '@' + x.line).join(' ') === '头@1 开头@6 数学这一科@8' && secs[1].reader === '老师的系统提示', JSON.stringify(secs));

  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const ctx = createContext(loadWorkspace(root));
  const file = join(root, '.claude', 'agents', 'math-tutor.md');
  const shipped = readFileSync(file, 'utf8');
  const base = '/api/dev/tutor-files/math-tutor';

  // ---- 列 ----
  type Row = { kind: string; tutor: string; name: string; state: string; fixes: number; buttons: number };
  const rows = async (): Promise<Row[]> => (await route('GET', '/api/dev/tutor-files', ctx)).json as Row[];
  const list = await rows();
  const math = list.find((r) => r.tutor === 'math-tutor');
  check('列:cotutor.json 里每位老师一行,有脸的叫「新话题」', list.length === Object.keys(ctx.ws.config.tutors).length && list.every((r) => r.kind === 'tutor' && r.name === '新话题'), JSON.stringify(list));
  check('列:没发布首页 = 缺省首页,新话题一个按钮;出厂最新', math?.state === 'latest' && math.buttons === 1 && math.fixes === 0, JSON.stringify(math));
  check('activity 的列表不变(老师文件另走一条)', ((await route('GET', '/api/dev/activities', ctx)).json as Row[]).every((r) => r.kind === undefined));

  // ---- 读 ----
  const doc = (await route('GET', base, ctx)).json as { kind: string; text: string; hash: string; state: string; path: string; shipped: boolean; name: string };
  check('读:原文、hash、相对路径、是出厂的', doc.kind === 'tutor' && doc.name === '新话题' && doc.text === shipped && doc.hash.startsWith('sha256:') && doc.path === '.claude/agents/math-tutor.md' && doc.shipped && doc.state === 'latest', JSON.stringify({ ...doc, text: undefined }));
  check('cotutor.json 里没有的老师 404;拼路径的不匹配', (await route('GET', '/api/dev/tutor-files/nobody-tutor', ctx)).status === 404 && (await route('GET', '/api/dev/tutor-files/..%2Fcotutor', ctx)).status !== 200);

  // ---- 首页上照它带的按钮:新话题 + 开场按钮,activity 按钮不算 ----
  mkdirSync(join(root, 'home'), { recursive: true });
  writeFileSync(join(root, 'home', 'draft.md'), '```tutor math-tutor\n今天的口算\n讲法: 先出两道\nactivity 小课堂\n```\n\n## 为什么这么排\n\n试\n');
  const pub = await publishHome(ctx.ws, { now: new Date() });
  check('发布了', pub.ok, JSON.stringify(pub.check.issues));

  // ---- 边改边查(不落盘) ----
  type Chk = { issues: { level: string; line?: number }[]; sections: { title: string }[]; buttons: { label: string; kind: string }[]; preview: { text: string; chars: number; board: { chars: number } | null; rules: { text: string; path: string } | null }; diff: { at: number; now: string[] }[] | null };
  const edited = shipped.replace('说话慢,一次只讲一个想法', '说话慢,一次只讲一个想法,多夸一句');
  const c1 = (await route('POST', base + '/check', ctx, { text: edited })).json as Chk;
  check('查:首页上照它带的是新话题与开场按钮', c1.buttons.map((b) => b.kind + ':' + b.label).join(',') === 'new:新话题,start:今天的口算', JSON.stringify(c1.buttons));
  check('查:老师收到的是去掉 frontmatter 的正文 + 板书写法,话题第一条带守则', c1.preview.text.startsWith('你是这个家的数学老师') && c1.preview.text.includes('多夸一句') && !c1.preview.text.includes('maxTurns') && (c1.preview.board?.chars ?? 0) > 100 && c1.preview.rules?.path === '.claude/skills/cotutor-tutor/SKILL.md' && (c1.preview.rules?.text.length ?? 0) > 100, JSON.stringify({ ...c1.preview, text: c1.preview.text.slice(0, 40), rules: undefined }));
  check('查:和出厂比一块', c1.diff?.length === 1 && c1.diff[0].now[0].includes('多夸一句'), JSON.stringify(c1.diff));
  check('查:不落盘', readFileSync(file, 'utf8') === shipped);
  const c2 = (await route('POST', base + '/check', ctx, { text: shipped.replace('name: math-tutor', 'name: maths') })).json as Chk;
  check('查:name 改坏了标要改', c2.issues.some((i) => i.level === 'fix' && i.line === 2), JSON.stringify(c2.issues));

  // ---- 存 ----
  const bad = await route('PUT', base, ctx, { text: edited, base: 'sha256:不对' });
  check('存:hash 对不上 409,文件不动', bad.status === 409 && readFileSync(file, 'utf8') === shipped, JSON.stringify(bad.json));
  const broken = await route('PUT', base, ctx, { text: shipped.replace('name: math-tutor', 'name: maths'), base: doc.hash });
  check('存:有要改的不存(400),文件不动', broken.status === 400 && readFileSync(file, 'utf8') === shipped, JSON.stringify(broken.json));
  const ok = await route('PUT', base, ctx, { text: edited, base: doc.hash });
  check('存:写进去,变成改过', ok.status === 200 && readFileSync(file, 'utf8') === edited && (ok.json as { state: string }).state === 'custom', JSON.stringify(ok.json));
  check('存:存完再用旧 hash 存 409', (await route('PUT', base, ctx, { text: shipped, base: doc.hash })).status === 409);
  check('列:改过', (await rows()).find((r) => r.tutor === 'math-tutor')?.state === 'custom');

  // ---- 恢复出厂 ----
  const chinese = join(root, '.claude', 'agents', 'chinese-tutor.md');
  writeFileSync(chinese, readFileSync(chinese, 'utf8') + '\n别的老师的改动\n');
  const rs = await route('POST', base + '/restore', ctx, {});
  check('恢复出厂:换回出厂那份,你这份留 .bak,状态回最新', rs.status === 200 && readFileSync(file, 'utf8') === shipped && readFileSync(file + '.bak', 'utf8') === edited && (rs.json as { bak: string }).bak === '.claude/agents/math-tutor.md.bak' && ((await route('GET', base, ctx)).json as { state: string }).state === 'latest', JSON.stringify(rs.json));
  check('恢复出厂:别的老师不碰', readFileSync(chinese, 'utf8').includes('别的老师的改动'));

  check('页面:老师文件走这条接口,老师团跳过来', DEV_PAGE.includes("'/api/dev/tutor-files/'") && DEV_PAGE.includes('改老师文件 →'));
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
