/**
 * --sandbox(src/app/cli/sandbox.ts):从真 workspace 分出试用的那份——设置照拷、状态不带、外面的 vault 拷一份;
 * cotutor.json 标题加「试用 · 」、端口 +1、paths 指进 sandbox;有了接着用,--fresh 重新分;真 workspace 一个字节都不动。
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-sandbox-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { openSandbox, sandboxRootOf } = await import('../src/app/cli/sandbox.ts');
const { UsageError, homeWorkspaces, loadWorkspace } = await import('../src/app/workspace.ts');
const { main } = await import('../src/app/cli/main.ts');
const { doctorWorkspace } = await import('../src/app/cli/doctor.ts');

const write = (p: string, text: string): void => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text);
};
const patchConfig = (root: string, f: (c: Record<string, unknown>) => void): void => {
  const file = join(root, 'cotutor.json');
  const c = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  f(c);
  writeFileSync(file, JSON.stringify(c, null, 2));
};
/** 目录下所有文件(相对路径),看真 workspace 动没动 */
const listAll = (dir: string, base = dir): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? listAll(join(dir, d.name), base) : [join(dir, d.name).slice(base.length + 1)])).sort();
async function threw(f: () => Promise<unknown>, like: string): Promise<boolean> {
  try {
    await f();
    return false;
  } catch (e) {
    return e instanceof UsageError && e.message.includes(like);
  }
}

// ---- 真的那个:vault 在外面(像 ray),带着对话、照片、听写、设备表这些状态 ----
const { root: real } = await initWorkspace({ slug: 'ray', name: 'Ray', port: 5190 });
const vault = join(home, 'ray-vault');
write(join(vault, 'profile.md'), '---\ncotutor: profile\n---\n# Ray\n');
write(join(vault, '日记', '2026-11-01.md'), '真日记\n');
write(join(vault, '记忆', '数学老师.md'), '- 真记忆\n');
write(join(vault, '.git', 'HEAD'), 'ref: refs/heads/main\n');
patchConfig(real, (c) => {
  c.paths = { vault, profile: 'profile.md' };
  c.vault = { keepScore: 3, autoBookkeep: true };
  c._mine = '家长留的键';
});
write(join(real, 'conversations', 'math-tutor', '2026-11-01.json'), '{}');
write(join(real, 'captures', '2026-11-01', 'p.jpg'), 'jpg');
write(join(real, 'dictation', '2026-11-01-1000.json'), '{}');
write(join(real, 'talk', 't1', 'talk.json'), '{}');
write(join(real, 'ledger', 'artifacts.jsonl'), '{"真":1}\n');
write(join(real, '.cotutor', 'devices.json'), '{}');
write(join(real, '.cotutor', 'kid-log', 'x.jsonl'), '{}');
write(join(real, 'home', 'published.json'), '{"id":"h1"}');
write(join(real, 'agents', 'math-tutor', 'activities', '自家的.md'), '家长写的 activity\n');
const realBefore = listAll(real);
const vaultBefore = listAll(vault);

const box = sandboxRootOf(real);
check('sandbox 在真 workspace 旁边的 .sandbox/<目录名>', box === join(home, 'cotutor', '.sandbox', 'ray'), box);

const first = await openSandbox(real);
check('第一次:分出来', first.created && first.root === box && first.from === real, JSON.stringify(first));
check('设置照拷:老师文件、activity、首页、技能、shipped', existsSync(join(box, 'agents', 'math-tutor.md')) && readFileSync(join(box, 'agents', 'math-tutor', 'activities', '自家的.md'), 'utf8') === '家长写的 activity\n' && existsSync(join(box, 'home', 'published.json')) && existsSync(join(box, '.agents', 'skills')) && existsSync(join(box, '.cotutor', 'shipped.json')));
check('.claude/skills 还是相对链,指 sandbox 自己那份', lstatSync(join(box, '.claude', 'skills')).isSymbolicLink() && readlinkSync(join(box, '.claude', 'skills')) === '../.agents/skills' && realpathSync(join(box, '.claude', 'skills')) === join(box, '.agents', 'skills'));
check('状态不带:对话、照片、听写、口语课、设备表、流水', listAll(join(box, 'conversations')).length === 0 && !existsSync(join(box, 'captures')) && !existsSync(join(box, 'dictation')) && !existsSync(join(box, 'talk')) && !existsSync(join(box, '.cotutor', 'devices.json')) && !existsSync(join(box, '.cotutor', 'kid-log')));
check('账本是空的新账本', readFileSync(join(box, 'ledger', 'artifacts.jsonl'), 'utf8') === '');
check('vault 拷了一份(不带 .git)', readFileSync(join(box, 'vault', '日记', '2026-11-01.md'), 'utf8') === '真日记\n' && existsSync(join(box, 'vault', '记忆', '数学老师.md')) && !existsSync(join(box, 'vault', '.git')));

const ws = loadWorkspace(box);
check('标题前加「试用 · 」', ws.config.title === '试用 · Ray的老师们', ws.config.title);
check('自动记账关掉,别的记账政策照留,并说一声', ws.config.vault.autoBookkeep === false && ws.config.vault.keepScore === 3 && first.notes.some((n) => n.includes('自动记账')) && loadWorkspace(real).config.vault.autoBookkeep === true, JSON.stringify(first.notes));
check('端口 +1', ws.config.server.port === 5191, String(ws.config.server.port));
check('vault 与 vault 侧的角色指进 sandbox', ws.paths.vault === join(box, 'vault') && ws.paths.profile === join(box, 'vault', 'profile.md') && ws.paths.diary === join(box, 'vault', '日记') && ws.paths.captures === join(box, 'captures'), JSON.stringify(ws.paths));
const boxCfg = JSON.parse(readFileSync(join(box, 'cotutor.json'), 'utf8')) as { paths: Record<string, string>; _mine?: string };
check('paths 写相对的,机器不认识的键照留', boxCfg.paths.vault === 'vault' && boxCfg.paths.profile === 'profile.md' && boxCfg._mine === '家长留的键', JSON.stringify(boxCfg));
check('Workspace 认得出 sandbox,记着从哪分出来的', ws.sandbox?.from === real && ws.sandbox.vault === vault && loadWorkspace(real).sandbox === undefined);
const doc = await doctorWorkspace(box, { probeEnv: false });
check('doctor:sandbox 不催 git,说一句从哪分出来', doc.checks.some((c) => c.name === 'sandbox' && c.ok) && !doc.checks.some((c) => c.name === 'git'), JSON.stringify(doc.checks.filter((c) => ['git', 'sandbox'].includes(c.name))));
check('~/cotutor 下「唯一目录」的兜底看不见 sandbox', JSON.stringify(homeWorkspaces(join(home, 'cotutor'))) === JSON.stringify([real]));

// ---- 接着用 / 重新分 ----
write(join(box, 'vault', '记忆', '数学老师.md'), '- 试用时记的\n');
write(join(box, 'conversations', 'math-tutor', '2026-11-04.json'), '{}');
const again = await openSandbox(real);
check('有了就接着用,试过的留着', !again.created && again.root === box && readFileSync(join(box, 'vault', '记忆', '数学老师.md'), 'utf8') === '- 试用时记的\n');
const inside = await openSandbox(box);
check('--workspace 指着 sandbox 就用它,不套娃', !inside.created && inside.root === box && inside.from === real && !existsSync(join(home, 'cotutor', '.sandbox', '.sandbox')));
const fresh = await openSandbox(real, { fresh: true });
check('--fresh 重新分:试过的丢掉,vault 重拷', fresh.created && readFileSync(join(box, 'vault', '记忆', '数学老师.md'), 'utf8') === '- 真记忆\n' && !existsSync(join(box, 'conversations', 'math-tutor', '2026-11-04.json')));
const freshInside = await openSandbox(box, { fresh: true });
check('在 sandbox 里 --fresh:从它记着的真 workspace 重新分', freshInside.created && freshInside.root === box && freshInside.from === real);
check('不留临时目录', readdirSync(join(home, 'cotutor', '.sandbox')).join() === 'ray');

check('真 workspace 一个文件都没多、没少', JSON.stringify(listAll(real)) === JSON.stringify(realBefore));
check('真 vault 没动', JSON.stringify(listAll(vault)) === JSON.stringify(vaultBefore) && readFileSync(join(vault, '记忆', '数学老师.md'), 'utf8') === '- 真记忆\n');

// ---- init 的缺省(2026-11-09):vault 在旁边的 <目录名>-vault,和 sandbox 外面的 vault 一样整份拷进 vault/ ----
{
  const { root: su } = await initWorkspace({ slug: 'su', dir: join(home, 'kids', 'su') });
  write(join(home, 'kids', 'su-vault', '日记', '2026-11-01.md'), '苏的日记\n');
  const s1 = await openSandbox(su);
  const s1ws = loadWorkspace(s1.root);
  check('缺省布局:vault 拷进 sandbox 的 vault/,档案、日记都在,真的那份不动', s1ws.paths.vault === join(s1.root, 'vault') && existsSync(join(s1.root, 'vault', '孩子.md')) && readFileSync(join(s1.root, 'vault', '日记', '2026-11-01.md'), 'utf8') === '苏的日记\n' && !existsSync(join(s1.root, '孩子.md')), s1ws.paths.vault);
}

// ---- 旧版的布局:vault 就是 workspace 根(没写 paths.vault):根下的档案、参考跟着拷,vault 还是根 ----
const { root: ming } = await initWorkspace({ slug: 'ming', dir: join(home, 'kids', 'ming') });
patchConfig(ming, (c) => { c.paths = {}; });
await initWorkspace({ slug: 'ming', dir: join(home, 'kids', 'ming') });
write(join(ming, '日记', '2026-11-01.md'), '明的日记\n');
write(join(ming, 'conversations', 'math-tutor', '2026-11-01.json'), '{}');
const m = await openSandbox(ming);
const mws = loadWorkspace(m.root);
check('vault 在根:sandbox 在 kids/.sandbox/ming', m.root === join(home, 'kids', '.sandbox', 'ming'));
check('vault 在根:档案、参考、日记跟着拷,vault 还是 sandbox 的根', mws.paths.vault === m.root && existsSync(join(m.root, '孩子.md')) && existsSync(join(m.root, '参考', 'README.md')) && readFileSync(join(m.root, '日记', '2026-11-01.md'), 'utf8') === '明的日记\n');
check('vault 在根:对话照样不带', listAll(join(m.root, 'conversations')).length === 0);

// ---- paths 指到外面 ----
const shared = join(home, 'shared-textbooks');
mkdirSync(shared);
patchConfig(ming, (c) => { c.paths = { textbooks: shared }; });
const tb = await openSandbox(ming, { fresh: true });
check('教材指在外面:只读,照旧指那份,并说一声', loadWorkspace(tb.root).paths.textbooks === shared && tb.notes.some((n) => n.includes('paths.textbooks')), JSON.stringify(tb.notes));
patchConfig(ming, (c) => { c.paths = { diary: join(home, 'elsewhere-diary') }; });
const beforeBlocked = listAll(tb.root);
check('日记指在外面:拦下(试用记账会写进去)', await threw(() => openSandbox(ming, { fresh: true }), 'paths.diary'));
check('拦下时旧的 sandbox 原样在,不留临时目录', JSON.stringify(listAll(tb.root)) === JSON.stringify(beforeBlocked) && readdirSync(join(home, 'kids', '.sandbox')).sort().join() === 'ming,su');

// ---- 挡路的不是 sandbox:不动它 ----
const { root: hong } = await initWorkspace({ slug: 'hong', dir: join(home, 'kids', 'hong') });
write(join(home, 'kids', '.sandbox', 'hong', 'mine.txt'), '别人的东西');
check('同名目录不是 sandbox:报错,不动它', (await threw(() => openSandbox(hong), '不是 sandbox')) && readFileSync(join(home, 'kids', '.sandbox', 'hong', 'mine.txt'), 'utf8') === '别人的东西');

// ---- 命令行:--sandbox 换 workspace;不用 workspace 的命令、单独的 --fresh 报用法错 ----
async function run(argv: string[]): Promise<{ out: string; err: string; code: number }> {
  const w = process.stdout.write;
  const e = process.stderr.write;
  let out = '';
  let err = '';
  process.stdout.write = ((c: string) => ((out += c), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string) => ((err += c), true)) as typeof process.stderr.write;
  process.exitCode = 0;
  try {
    await main(argv);
  } finally {
    process.stdout.write = w;
    process.stderr.write = e;
  }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return { out, err, code };
}
// 真的搬了端口,试用下次打开跟过去:规矩只有一条「+1」
{
  const { root: moved } = await initWorkspace({ slug: 'mover', dir: join(home, 'kids', 'mover'), port: 5180 });
  const fork1 = await openSandbox(moved);
  const portOf = (r: string): number => (JSON.parse(readFileSync(join(r, 'cotutor.json'), 'utf8')) as { server: { port: number } }).server.port;
  check('分出来是 +1', portOf(fork1.root) === 5181);
  write(join(fork1.root, 'conversations', 'math-tutor', '2026-11-06.json'), '{}');
  patchConfig(moved, (c) => { c.server = { port: 443 }; });
  const fork2 = await openSandbox(moved);
  check('真的搬到 443:试用跟到 444,说一句', portOf(fork2.root) === 444 && !fork2.created && fork2.notes.some((n) => n.includes('444')), JSON.stringify(fork2.notes));
  check('跟端口不动试用里的东西', existsSync(join(fork2.root, 'conversations', 'math-tutor', '2026-11-06.json')));
  const fork3 = await openSandbox(moved);
  check('没再变:不说话', fork3.notes.length === 0 && portOf(fork3.root) === 444);
  patchConfig(moved, (c) => { c.server = 'bad'; });
  const fork4 = await openSandbox(moved);
  check('真的那份坏了:试用照旧', portOf(fork4.root) === 444 && fork4.notes.length === 0);
}

const { root: lan } = await initWorkspace({ slug: 'lan', dir: join(home, 'kids', 'lan') });
const pack = await run(['pack', 'math-tutor', '你好', '--sandbox', '--workspace', lan]);
check('cotutor pack --sandbox:分出来并在 sandbox 里跑', pack.code === 0 && pack.err.includes('分出试用 workspace') && existsSync(join(home, 'kids', '.sandbox', 'lan', '.cotutor', 'sandbox.json')), pack.err + pack.out.slice(0, 300));
const pack2 = await run(['pack', 'math-tutor', '你好', '--sandbox', '--workspace', lan]);
check('第二次:只说用的是哪个', pack2.code === 0 && pack2.err.startsWith('试用 workspace ') && !pack2.err.includes('分出'), pack2.err);
const initSb = await run(['init', 'x', '--sandbox']);
check('init --sandbox:用法错', initSb.code === 2 && initSb.err.includes('不用 workspace'), initSb.err);
const lone = await run(['doctor', '--fresh', '--workspace', lan]);
check('单独 --fresh:用法错', lone.code === 2 && lone.err.includes('--fresh 只跟 --sandbox'), lone.err);

done();
