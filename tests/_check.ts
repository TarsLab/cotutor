/** 测试小工具:与 drawtell / growth-apps 同款的 check(),零依赖。 */
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
