/** CLI 入口的旗标与用法:--version 报版本(不是用法),--help 与裸跑报用法,未知命令 exit 2。 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

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

  check('--help 报用法', (await run(['--help'])).out.includes('用法:'));
  check('-h 报用法', (await run(['-h'])).out.includes('用法:'));
  check('裸跑报用法', (await run([])).out.includes('用法:'));
  check('子命令后的 --help 也报用法', (await run(['doctor', '--help'])).out.includes('用法:'));

  const bad = await run(['nosuch']);
  check('未知命令 exit 2', bad.code === 2, String(bad.code));
  check('未知命令写 stderr 附用法', bad.err.includes("未知命令 'nosuch'") && bad.err.includes('用法:'));
  const badJson = await run(['nosuch', '--json']);
  check('--json 时用法错误走 stdout 的 JSON', JSON.parse(badJson.out.trim()).error === 'usage');
  const noValue = await run(['doctor', '--workspace']);
  check('缺值的选项报用法错误', noValue.code === 2 && noValue.err.includes('--workspace 需要一个值'));

  // README 的第一条命令(2026-10-31:--grade 没进带值的选项表,init 一律报「要是 1–6 的整数」)
  const dir = mkdtempSync(join(tmpdir(), 'cotutor-main-'));
  const init = await run(['init', 'ming', '--name', '小明', '--grade', '2', '--dir', join(dir, 'ming')]);
  check('init --grade 2 建得起来', init.code === 0 && init.out.includes('cotutor init →') && existsSync(join(dir, 'ming', 'cotutor.json')), init.err || init.out.slice(0, 300));
  const badGrade = await run(['init', 'ming', '--grade', '9', '--dir', join(dir, 'x')]);
  check('init --grade 9 报用法错误', badGrade.code === 2 && badGrade.err.includes('--grade 要是 1–6 的整数'), badGrade.err);
} finally {
  done();
}
