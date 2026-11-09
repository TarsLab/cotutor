/**
 * CLI 入口的旗标与用法:--version 报版本(不是用法),--help 与裸跑报短的顶层帮助,cotutor <命令> --help 报那条命令的;
 * 参数写错(未知命令、打错的旗标、用错子命令的旗标、多余的参数)exit 2,一句话 + 去哪看用法,不倒出整篇帮助。
 * 命令表(src/app/cli/commands.ts)和代码读的旗标对得上,例子照表都能过。
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

// init 在没配过的机器上会写 ~/.config/cotutor/config.json:HOME 指到临时目录,不碰真的(要在 import 之前,路径是载入时算的)
process.env.HOME = mkdtempSync(join(tmpdir(), 'cotutor-main-home-'));
const { main } = await import('../src/app/cli/main.ts');
const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string };

/** 跑一次 main,收走两股输出与 exitCode(main 不 process.exit,只置码)。 */
async function run(argv: string[]): Promise<{ out: string; err: string; code: number }> {
  const [outw, errw] = [process.stdout.write, process.stderr.write];
  let out = '';
  let err = '';
  process.stdout.write = ((c: string) => ((out += c), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string) => ((err += c), true)) as typeof process.stderr.write;
  process.exitCode = 0;
  try {
    await main(argv);
  } finally {
    [process.stdout.write, process.stderr.write] = [outw, errw];
  }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return { out, err, code };
}

try {
  const v = await run(['--version']);
  check('--version 报版本', v.out.trim() === version, JSON.stringify(v.out));
  check('--version 不是用法', !v.out.includes('用法:'));
  check('-v 同样报版本', (await run(['-v'])).out.trim() === version);
  check('版本跟得上 package.json', /^\d+\.\d+\.\d+/.test(version), version);

  const top = await run(['--help']);
  check('--help 报顶层帮助', top.out.includes('用法:cotutor <命令>') && top.out.includes('cotutor <命令> --help'));
  check('顶层帮助短(以前 9.5 KB、一行五百多字)', Buffer.byteLength(top.out) < 2500 && top.out.split('\n').every((l) => l.length <= 100), String(Buffer.byteLength(top.out)));
  check('顶层帮助写了退出码', top.out.includes('退出码'));
  check('-h、裸跑、cotutor help 都是顶层帮助', (await run(['-h'])).out === top.out && (await run([])).out === top.out && (await run(['help'])).out === top.out);
  check('开发与调试的命令缺省不列,--help --all 才列', !/^  pack /m.test(top.out) && /^  pack /m.test((await run(['--help', '--all'])).out));
  const doctorHelp = await run(['doctor', '--help']);
  check('cotutor doctor --help 是 doctor 自己的', doctorHelp.out.startsWith('cotutor doctor —') && doctorHelp.out.includes('--fix') && doctorHelp.out.includes('例子:'));
  check('cotutor help doctor 同上', (await run(['help', 'doctor'])).out === doctorHelp.out);
  check('写了花钱的', doctorHelp.out.includes('花一分钱'));

  const bad = await run(['nosuch']);
  check('未知命令 exit 2', bad.code === 2, String(bad.code));
  check('未知命令一句话 + 去看顶层帮助,不倒出整篇', bad.err.includes("没有 'nosuch'") && bad.err.includes('cotutor --help') && !bad.err.includes('安装与设置') && bad.err.length < 200, bad.err);
  check('打错的命令给最像的', (await run(['servce', 'status'])).err.includes('是不是 cotutor service'));
  const badJson = await run(['nosuch', '--json']);
  check('--json 时用法错误走 stdout 的 JSON', JSON.parse(badJson.out.trim()).error === 'usage');
  const noValue = await run(['doctor', '--workspace']);
  check('缺值的选项报用法错误', noValue.code === 2 && noValue.err.includes('--workspace 需要一个值'));

  // 打错的旗标不能悄悄当没看见(agent 以为生效了):以前 grades --josn --bogus 照常 exit 0
  const typo = await run(['grades', '--josn']);
  check('不认识的旗标 exit 2,给最像的', typo.code === 2 && typo.err.includes('不认识 --josn') && typo.err.includes('--json') && typo.err.includes('cotutor grades --help'), typo.err);
  const typoJson = await run(['service', 'install', '--no-opne', '--json']);
  check('打错的旗标在 --json 下也报,带 help', typoJson.code === 2 && JSON.parse(typoJson.out.trim()).help === 'cotutor service --help', typoJson.out);
  const wrongSub = await run(['service', 'status', '--lines', '5']);
  check('用错子命令的旗标:说只给谁用', wrongSub.code === 2 && wrongSub.err.includes('--lines 只给 service logs 用'), wrongSub.err);
  const extra = await run(['init', 'ming', '小明']);
  check('多余的参数 exit 2(以前悄悄丢掉)', extra.code === 2 && extra.err.includes("多余的参数 '小明'"), extra.err);
  check('不带参数的命令多给了也报', (await run(['doctor', 'x'])).code === 2);
  const badSub = await run(['service', 'statsu']);
  check('不认识的子命令给最像的', badSub.code === 2 && badSub.err.includes('是不是 status'), badSub.err);
  check('旧的特别说明还在:upgrade --grade', (await run(['upgrade', '--grade', '3'])).err.includes('不能用 --grade 切换年级'));

  // 命令表与代码同源:代码读的每个旗标都在表里,表里每条的例子照表都过
  const { COMMANDS } = await import('../src/app/cli/commands.ts');
  const { checkCommandLine, commandHelp } = await import('../src/app/cli/usage.ts');
  const src = ['main.ts', 'chalk/main.ts'].map((f) => readFileSync(fileURLToPath(new URL(`../src/app/cli/${f}`, import.meta.url)), 'utf8')).join('\n');
  const read = new Set([...src.matchAll(/flags(?:\.([a-zA-Z]+)|\['([a-z-]+)'\])/g)].map((m) => m[1] ?? m[2]));
  const declared = new Set(['workspace', 'sandbox', 'fresh', 'json', 'help', 'version', 'all', ...COMMANDS.flatMap((c) => (c.flags ?? []).map((f) => f.name))]);
  const missing = [...read].filter((f) => !declared.has(f));
  check('代码读的旗标都在命令表里(不然会被当成打错的拦掉)', missing.length === 0, missing.join(' '));
  for (const c of COMMANDS) {
    for (const e of c.examples.filter((x) => x.startsWith('cotutor '))) check(`例子照表能过:${e}`, checkCommandLine(e.replace(/<[^>]+>/g, 'x')) === null, checkCommandLine(e) ?? '');
    const h = commandHelp(c.name);
    check(`${c.name} 的帮助:用法、例子都有,一行不超过 160 字`, h.includes('用法:') && h.includes('例子:') && h.split('\n').every((l) => l.length <= 160), h.split('\n').find((l) => l.length > 160));
  }

  // README 的第一条命令(2026-10-31:--grade 没进带值的选项表,init 一律报「要是 1–6 的整数」)
  const dir = process.env.HOME!;
  const init = await run(['init', 'ming', '--name', '小明', '--grade', '2', '--dir', join(dir, 'ming')]);
  check('init --grade 2 建得起来', init.code === 0 && init.out.includes('cotutor init →') && existsSync(join(dir, 'ming', 'cotutor.json')), init.err || init.out.slice(0, 300));
  const badGrade = await run(['init', 'ming', '--grade', '9', '--dir', join(dir, 'x')]);
  check('init --grade 9 报用法错误', badGrade.code === 2 && badGrade.err.includes('--grade 要是 1–6 的整数'), badGrade.err);

  // ---- update / refresh / reset:「升级」只有 update 一条;upgrade 是旧名,不进帮助但一直认 ----
  const ws = join(dir, 'ming');
  const all = (await run(['--help', '--all'])).out;
  check('帮助里有 refresh、reset,没有 upgrade', /^  refresh /m.test(all) && /^  reset /m.test(all) && !/^  upgrade /m.test(all));
  check('打错的命令不往旧名上引', !(await run(['upgrad'])).err.includes('cotutor upgrade'));
  check('refresh 换新出厂文件', (await run(['refresh', '--workspace', ws])).code === 0);
  // 0.4.x 的 cotutor update 换完程序,用新程序跑的就是这一条(src/app/cli/update-cmd.ts 旧版)
  const legacy = await run(['upgrade', '--workspace', ws]);
  check('旧名 upgrade --workspace 照样跑通(旧版本的 update 靠它)', legacy.code === 0, legacy.err);
  check('refresh 不收老师名(回出厂是 reset 的事)', (await run(['refresh', 'math-tutor', '--workspace', ws])).code === 2);
  check('reset 不说换哪份:用法错', (await run(['reset', '--workspace', ws])).code === 2);
  const mathFile = join(ws, 'agents', 'math-tutor.md');
  const shipped = readFileSync(mathFile, 'utf8');
  writeFileSync(mathFile, `${shipped}\n家长加的一句\n`);
  const reset = await run(['reset', 'math-tutor', '--workspace', ws, '--json']);
  const resetOut = JSON.parse(reset.out.trim()) as { ok: boolean; reset: { name: string; bak: string | null }[] };
  check('reset 换回出厂的,你那份存 .bak', reset.code === 0 && resetOut.ok && resetOut.reset[0].bak !== null && readFileSync(mathFile, 'utf8') === shipped && readFileSync(`${mathFile}.bak`, 'utf8').includes('家长加的一句'), reset.out + reset.err);
  check('reset 自家没有的老师:说清楚,不动', (await run(['reset', 'nobody-tutor', '--workspace', ws])).code === 2);

  // ---- backup --json:做一份、恢复(不加 --yes 只说会做什么) ----
  const made = await run(['backup', '--workspace', ws, '--json']);
  const madeOut = JSON.parse(made.out.trim()) as { ok: boolean; backup: { name: string; why: string } };
  check('backup --json:名字、原因', made.code === 0 && madeOut.ok && madeOut.backup.why === 'manual' && madeOut.backup.name.length > 0, made.out + made.err);
  const ask = await run(['backup', 'restore', madeOut.backup.name, '--workspace', ws, '--json']);
  const askOut = JSON.parse(ask.out.trim()) as { ok: boolean; needsYes: boolean };
  check('restore --json 不加 --yes:needsYes,以 1 退,什么都不动', ask.code === 1 && !askOut.ok && askOut.needsYes, ask.out);
  check('report 不出 --json:报错并指去 doctor / service status', (await run(['report', '--json', '--workspace', ws])).code === 2 && (await run(['report', '--help'])).out.includes('doctor --json'));
} finally {
  done();
}
