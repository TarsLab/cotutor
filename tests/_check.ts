/** 测试小工具:与 drawtell / growth-apps 同款的 check(),零依赖。 */
// 配音缺省指到一个没人听的端口:没起假百炼(_fake-tts.ts)的测试合成就失败,不会拿本机的 key 去真合成、花钱
process.env.COTUTOR_TTS_ENDPOINT ??= 'http://127.0.0.1:9/tts';
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
