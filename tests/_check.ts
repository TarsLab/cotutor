/** 测试小工具:与 drawtell / growth-apps 同款的 check(),零依赖。 */
import { mkdtempSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 配音缺省指到一个没人听的端口:没起假百炼(_fake-tts.ts)的测试合成就失败,不会拿本机的 key 去真合成、花钱
process.env.COTUTOR_TTS_ENDPOINT ??= 'http://127.0.0.1:9/tts';

// Windows 上 os.homedir() 读 USERPROFILE,测试只设 HOME 隔离不住,会写进真的用户目录(2026-11-06 sandbox.test 单独跑,把那台机器上真的 workspace 改了,靠卷影副本才还原)。
// 这里让 homedir 跟着 HOME 走,没设 HOME 就落到临时目录;子进程继承的 USERPROFILE 也指过去,碰不到真的家。环境里原来的 HOME(Git Bash 会设成真的家)不算数
if (process.platform === 'win32') {
  const os = createRequire(import.meta.url)('node:os') as typeof import('node:os');
  const scratch = mkdtempSync(join(tmpdir(), 'cotutor-test-home-'));
  delete process.env.HOME;
  process.env.USERPROFILE = scratch;
  os.homedir = () => process.env.HOME || scratch;
  syncBuiltinESMExports();
}
let failed = 0;
let passed = 0;
export function check(name: string, ok: unknown, detail = ''): void {
  if (ok) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}: ${detail}`);
  }
}
export function done(): never {
  console.log(`${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}
