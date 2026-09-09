/** 假配音命令:模仿 voxtell say 的接口(<text> --voice <v> --json -o <out>),把一小段字节写到 -o;--voice fail 时失败。 */
import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
const out = argv[argv.indexOf('-o') + 1];
const voice = argv[argv.indexOf('--voice') + 1];
if (voice === 'fail') {
  process.stderr.write('voxtell: 音色不存在\n');
  process.exit(1);
}
writeFileSync(out, Buffer.from(`fake-mp3:${voice}:${argv[0]}`));
process.stdout.write(JSON.stringify({ ok: true, file: out }) + '\n');
