/**
 * 测试跑手:tests/*.test.ts 每个文件一个子进程(HOME 注入、chdir 互不干扰),任一失败 exit 1。
 * 加测试 = 放一个文件进 tests/,不用登记。
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../tests/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.test.ts')).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) {
    failed++;
    console.error(`FAIL ${f} (exit ${r.status})`);
  } else console.log(`ok   ${f}`);
}
console.log(failed ? `${failed}/${files.length} 个测试文件失败` : `${files.length} 个测试文件全部通过`);
process.exit(failed ? 1 : 0);
