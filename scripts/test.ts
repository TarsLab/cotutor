/**
 * 测试跑手:tests/*.test.ts 每个文件一个子进程(HOME 注入、chdir 互不干扰),任一失败 exit 1。
 * 几个文件一起跑:缺省 4 个(核少的机器少一些),COTUTOR_TEST_JOBS=<n> 改,1 = 一个一个跑。
 * 一个文件的输出攒着,跑完整段打出来,几个文件的行不会搅在一起。
 * ALONE 里的排在最后一个一个跑:port 占着真端口、断言选中了哪个端口,旁边有别的测试在试绑端口(每次 init 都试)就会看错;
 * probe 起固定端口的 mock 与 Chrome;play 看真时钟(几十毫秒的先后),机器忙的时候会差出去(8 个一起跑时红过一次)。
 * 加测试 = 放一个文件进 tests/,不用登记;占固定端口、掐真时间的才进 ALONE。
 * 只跑几个:pnpm test <名字里的一段>...(如 pnpm test live board)。
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALONE = new Set(['port.test.ts', 'probe.test.ts', 'play.test.ts']);

const dir = fileURLToPath(new URL('../tests/', import.meta.url));
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => !only.length || only.some((o) => f.includes(o)))
  .sort();
if (!files.length) {
  console.error(`没有名字里带 ${only.join('、')} 的测试文件`);
  process.exit(2);
}

const asked = Number(process.env.COTUTOR_TEST_JOBS);
const jobs = Number.isInteger(asked) && asked >= 1 ? asked : Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));

let failed = 0;
function run(f: string): Promise<void> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', join(dir, f)], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => chunks.push(c));
    const finish = (status: number | null, why = ''): void => {
      process.stdout.write(Buffer.concat(chunks));
      if (status !== 0) {
        failed++;
        console.error(`FAIL ${f} (exit ${status}${why})`);
      } else console.log(`ok   ${f}`);
      resolve();
    };
    child.on('error', (err) => finish(null, ` ${err.message}`));
    child.on('close', (status, signal) => finish(status, signal ? ` ${signal}` : ''));
  });
}

async function pool(list: readonly string[], n: number): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (next < list.length) await run(list[next++]);
  }));
}

const t0 = Date.now();
await pool(files.filter((f) => !ALONE.has(f)), jobs);
await pool(files.filter((f) => ALONE.has(f)), 1);
const secs = Math.round((Date.now() - t0) / 1000);
console.log(failed ? `${failed}/${files.length} 个测试文件失败(${secs} 秒)` : `${files.length} 个测试文件全部通过(${secs} 秒,${jobs > 1 ? `${jobs} 个一起跑` : '一个一个跑'})`);
process.exit(failed ? 1 : 0);
