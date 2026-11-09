/**
 * 家长端「还差几步」(src/app/http/parent-setup.ts)、init --grade 自动算学期、cotutor doctor --fix(doctor-fix.ts)。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-setup-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
delete process.env.COTUTOR_LIVE_ENDPOINT;

const { schoolStartFor, semesterAt, setSchoolStart, frontmatter } = await import('../src/memory/vault-notes.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
const { doctorWorkspace } = await import('../src/app/cli/doctor.ts');
const { parseCmd, runFixes } = await import('../src/app/cli/doctor-fix.ts');
const { PARENT_HOME_PAGE } = await import('../src/ui/parent/parent-home-page.ts');
const { cliLine } = await import('../src/shared/upgrade.ts');
const { recordKidLog } = await import('../src/runtime/journal/kid-log.ts');

// ---- 年级 → 读一年级的年月 ----
{
  const at = (y: number, m: number): Date => new Date(y, m - 1, 15);
  const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
  check('11 月读二年级:去年 9 月上的一年级', schoolStartFor(2, at(2026, 11)) === '2025-09');
  check('3 月读二年级:还是同一学年', schoolStartFor(2, at(2027, 3)) === '2025-09');
  check('9 月读一年级:今年', schoolStartFor(1, at(2026, 9)) === '2026-09');
  for (const [y, m, g, want] of [[2026, 11, 2, '二年级上'], [2027, 3, 2, '二年级下'], [2026, 9, 6, '六年级上'], [2026, 7, 3, '三年级暑假']] as const) {
    check(`和 semesterAt 对得上:${y}-${m} 读 ${g} 年级 → ${want}`, semesterAt(schoolStartFor(g, at(y, m)), iso(at(y, m))) === want, String(semesterAt(schoolStartFor(g, at(y, m)), iso(at(y, m)))));
  }
  check('写进档案:填空着的那行,别的不动', setSchoolStart('---\ncotutor: profile\nnickname: 小明\nschool_start:\ncity: 北京\n---\n\n正文 school_start: x\n', '2025-09') === '---\ncotutor: profile\nnickname: 小明\nschool_start: 2025-09\ncity: 北京\n---\n\n正文 school_start: x\n');
  check('写进档案:没有那一行就加上,读得出来', frontmatter(setSchoolStart('---\ncotutor: profile\n---\n正文\n', '2025-09')).school_start === '2025-09');
}

// ---- init ----
{
  const { root } = await initWorkspace({ slug: 'g2', name: '小二', grade: 2, now: new Date(2026, 10, 7) });
  const profile = readFileSync(join(`${root}-vault`, '孩子.md'), 'utf8');
  check('init --grade:档案里算好了 school_start', frontmatter(profile).school_start === '2025-09', profile);
  const vp = (await doctorWorkspace(root, { probeEnv: false, now: new Date(2026, 10, 7) })).checks.find((c) => c.name === 'vault.profile');
  check('doctor:学期算得出,这一项不用家长管', vp?.ok === true && vp.detail.includes('二年级上'), JSON.stringify(vp));
  const { root: r2 } = await initWorkspace({ slug: 'nog', name: '小无' });
  check('没给年级:不猜(教学包的缺省年级不等于孩子的年级)', !frontmatter(readFileSync(join(`${r2}-vault`, '孩子.md'), 'utf8')).school_start);
  writeFileSync(join(`${root}-vault`, '孩子.md'), '---\ncotutor: profile\nschool_start: 2020-09\n---\n家长写的\n');
  await initWorkspace({ slug: 'g2', name: '小二', grade: 2, now: new Date(2026, 10, 7) });
  check('再 init 一次:家长写的不动', readFileSync(join(`${root}-vault`, '孩子.md'), 'utf8').includes('2020-09'));
}

// ---- 还差几步 ----
{
  const { root } = await initWorkspace({ slug: 'setup', name: '小步' });
  const envNoKey = { HOME: home };
  const ctx = createContext(loadWorkspace(root), { env: envNoKey });
  type Step = { id: string; done: boolean; required: boolean; title: string; detail: string; commands?: string[]; grades?: boolean };
  const steps = async (): Promise<Step[]> => ((await route('GET', '/api/parent/setup', ctx, undefined, 'local')).json as { steps: Step[] }).steps;
  const by = (list: Step[], id: string): Step | undefined => list.find((s) => s.id === id);
  let s = await steps();
  check('刚装好:百炼、证书、平板、年级都还没好,都是必需的', ['bailian', 'https', 'tablet', 'semester'].every((id) => by(s, id)?.done === false && by(s, id)?.required === true), JSON.stringify(s.map((x) => [x.id, x.done])));
  check('排得有先后:先填百炼', s[0].id === 'bailian');
  check('证书:给要跑的命令,按系统带不带 .cmd,有说明的链接', by(s, 'https')?.commands?.includes(cliLine('cotutor cert')) === true && Boolean((by(s, 'https') as Step & { link?: { href: string } }).link?.href.includes('iPad')));
  check('密码是建议,不算必需', by(s, 'pin')?.required === false);
  check('说家长的话:没有 doctor 的字段名', s.every((x) => !/school_start|server\.access|vault\.profile/.test(`${x.title}${x.id === 'sleep' ? '' : x.detail}`)), JSON.stringify(s));

  check('年级:页面上能选', by(s, 'semester')?.grades === true);
  const bad = await route('POST', '/api/parent/setup/grade', ctx, { grade: 9 }, 'local');
  check('年级不在 1-6:不收', bad.status === 400);
  const ok = await route('POST', '/api/parent/setup/grade', ctx, { grade: 3 }, 'local');
  check('选了年级:写进档案,这一步好了', ok.status === 200 && by(await steps(), 'semester')?.done === true, JSON.stringify(ok.json));
  const file = join(`${root}-vault`, '孩子.md');
  check('档案里只多了学期,别的没动', frontmatter(readFileSync(file, 'utf8')).nickname === '小步' && Boolean(frontmatter(readFileSync(file, 'utf8')).school_start));
  const again = await route('POST', '/api/parent/setup/grade', ctx, { grade: 5 }, 'local');
  check('已经写了:不覆盖(家长可能手写过)', again.status === 409);

  await recordKidLog(ctx.ws, { k: 'open', page: 'kid', v: '1', ua: 'iPad', touch: 5, standalone: false, w: 1, h: 1, vw: 1, vh: 1, dpr: 2, lang: 'zh' } as never, { device: 'abc123abc123' }, new Date());
  check('平板连过了:这一步好了', by(await steps(), 'tablet')?.done === true);
  mkdirSync(join(home, '.config', 'cotutor'), { recursive: true });
  writeFileSync(join(home, '.config', 'cotutor', 'bailian.json'), JSON.stringify({ apiKey: 'sk-0123456789abcdef0123', workspaceId: 'llm-x' }));
  check('填了百炼:这一步好了', by(await steps(), 'bailian')?.done === true);
  rmSync(join(home, '.config', 'cotutor', 'bailian.json'));

  const bk = (await route('GET', '/api/parent/backups', ctx, undefined, 'local')).json as { dir: string; list: unknown[]; commands: { list: string; restore: string } };
  check('备份接口:给位置(家目录写成 $HOME)和要抄的命令(按系统带不带 .cmd)', bk.dir.startsWith('$HOME') && bk.commands.list === cliLine('cotutor backup list') && bk.commands.restore.includes('--yes') && Array.isArray(bk.list), JSON.stringify(bk));
  check('家长端首页:有这一块,读这个接口,知道了以后不再提', PARENT_HOME_PAGE.includes('id="setupbar"') && PARENT_HOME_PAGE.includes("'/api/parent/setup'") && PARENT_HOME_PAGE.includes('cotutor.setupHidden'));
  check('家长端首页:必需的没好时不给「知道了」(不能把它关掉)', PARENT_HOME_PAGE.includes("left.length ? null : h('button'"));
  check('Windows 的命令带 .cmd', cliLine('cotutor cert', 'win32') === 'cotutor.cmd cert' && cliLine('npm i -g cotutor', 'win32') === 'npm.cmd i -g cotutor' && cliLine('cotutor cert', 'darwin') === 'cotutor cert' && cliLine('git init', 'win32') === 'git init');
}

// ---- doctor --fix ----
{
  check('拆命令:引号里算一段,$HOME 换成真的', JSON.stringify(parseCmd('git init "$HOME/a b/c"', '/h')) === JSON.stringify(['git', 'init', '/h/a b/c']));
  check('拆命令:Windows 路径的反斜杠留着', JSON.stringify(parseCmd('cotutor service install --no-open --workspace "$HOME\\cotutor\\小明"', 'C:\\Users\\u')) === JSON.stringify(['cotutor', 'service', 'install', '--no-open', '--workspace', 'C:\\Users\\u\\cotutor\\小明']));
  const report = (checks: { name: string; ok: boolean; cmd?: string; human?: true; required?: boolean; detail?: string }[]) => ({ ok: true, root: '/w', source: 'flag', checks: checks.map((c) => ({ required: false, detail: '', ...c })) });
  {
    const queue = [
      report([{ name: 'a', ok: false, cmd: 'cotutor upgrade' }, { name: 'b', ok: false, cmd: 'git init "$HOME/x"' }, { name: 'c', ok: false, human: true }]),
      report([{ name: 'a', ok: true }, { name: 'b', ok: false, cmd: 'git init "$HOME/x"' }, { name: 'c', ok: false, human: true }]),
      report([{ name: 'a', ok: true }, { name: 'b', ok: true }, { name: 'c', ok: false, human: true }]),
    ];
    const ran: string[] = [];
    const out: string[] = [];
    const final = await runFixes({ doctor: async () => queue.shift() as never, run: async (a) => { ran.push(a.join(' ')); return { code: 0, out: '' }; }, print: (l) => out.push(l) });
    check('一条条修,修完再查,要人来的不碰', ran.length === 2 && ran[0] === 'cotutor upgrade' && ran[1].startsWith('git init ') && final.checks.find((c) => c.name === 'c')?.ok === false, ran.join('|'));
    check('说修了什么', out.length === 2 && out[0].includes('✓') && out[0].includes('a'), out.join('|'));
  }
  {
    let runs = 0;
    const stuck = report([{ name: 'a', ok: false, cmd: 'cotutor cert' }]);
    const out: string[] = [];
    await runFixes({ doctor: async () => stuck as never, run: async () => { runs++; return { code: 1, out: 'mkcert 不在\n' }; }, print: (l) => out.push(l) });
    check('修不好的:只试一次,不死循环,说原因', runs === 1 && out.join('\n').includes('✗') && out.join('\n').includes('mkcert 不在'), out.join('|'));
  }
  {
    let runs = 0;
    const out: string[] = [];
    await runFixes({ doctor: async () => report([{ name: 'x', ok: false, cmd: 'rm -rf /' }]) as never, run: async () => { runs++; return { code: 0, out: '' }; }, print: (l) => out.push(l) });
    check('只认 cotutor 和 git:别的命令不跑', runs === 0 && out.join().includes('不认识'), out.join());
  }
  {
    const { root } = await initWorkspace({ slug: 'fixme', name: '小修' });
    rmSync(join(root, 'agents', 'math-tutor'), { recursive: true });
    const { runArgv } = await import('../src/app/cli/doctor-fix.ts');
    // 这里真的起子进程:Windows 上子进程的家看 USERPROFILE,_check.ts 把它指到另一个临时目录了,对齐到这个测试的家(还是临时的,碰不到真的)
    if (process.platform === 'win32') process.env.USERPROFILE = home;
    const out: string[] = [];
    const final = await runFixes({ doctor: () => doctorWorkspace(root, { probeEnv: false }), run: runArgv, print: (l) => out.push(l) });
    check('真跑:老师的家没了,补回来(真的起 cotutor 子进程)', existsSync(join(root, 'agents', 'math-tutor')) && final.checks.find((c) => c.name === 'tutor.math-tutor.home')?.ok === true, out.join('\n'));
  }
}

done();
